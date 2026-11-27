/* daily-backup.js — 每日自動雲端備份（Supabase → Google Drive）
 *
 * 1. 每天把 Supabase app_state 全部鍵值匯出成 backup/YYYY-MM-DD.json
 * 2. 同一天重複執行覆蓋當天那份，不產生多份
 * 3. 只保留最近 30 份，較舊的移到垃圾桶
 * 4. 提供「從備份還原」：選日期寫回 Supabase（還原前確認）
 * 5. 原本「存入雲端／載入雲端」按鈕保留，本模組只負責每日自動備份
 *
 * 觸發方式：本站是純靜態網站，沒有後端，無法在你完全不開網頁時執行。
 * 因此採「開站即檢查」：任何一台已授權 Google 的裝置打開本站，
 * 若今天還沒備份過就自動跑一次。當天只做一次。
 *
 * 資料來源是 Supabase app_state 全表（含 build-assistant-* 與 inspection-*），
 * 不是只讀本機，所以換裝置也能拿到完整資料。
 * 不使用任何 sb_secret_*；只用可公開的 publishable key。
 */
(function (global) {
  'use strict';

  var SB_URL = 'https://ohwrzcrmdmqnxbxjfuus.supabase.co';
  var SB_KEY = 'sb_publishable_QRBZ59wj7F4iTJTCraJzHQ_SvL8AbMv';
  var SB_TABLE = 'app_state';
  var FOLDER_NAME = 'backup';
  var MAX_KEEP = 30;

  /* 裝置專屬狀態：刻意不同步，避免兩台互相蓋掉「今天備份過了」的判斷 */
  var ST_KEY = 'backup-daily-state-v1';
  var FOLDER_ID_KEY = 'backup-daily-folder-v1';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';

  var listeners = [];
  var state = { running: false, lastRunAt: '', lastDate: '', lastError: '', lastCounts: null, fileCount: 0 };

  /* ---------- 工具 ---------- */
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function readState() {
    try { var o = JSON.parse(global.localStorage.getItem(ST_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; }
    catch (e) { return {}; }
  }
  function writeState(o) { try { global.localStorage.setItem(ST_KEY, JSON.stringify(o || {})); } catch (e) {} }
  function getFolderCache() { try { return global.localStorage.getItem(FOLDER_ID_KEY) || ''; } catch (e) { return ''; } }
  function setFolderCache(id) { try { global.localStorage.setItem(FOLDER_ID_KEY, id || ''); } catch (e) {} }
  function emit(evt, detail) {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](evt, detail); } catch (e) {} }
    try { global.dispatchEvent(new CustomEvent('daily-backup', { detail: { evt: evt, info: detail } })); } catch (e) {}
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  /* ---------- Supabase ---------- */
  function sbFetch(path, opts) {
    opts = opts || {};
    var h = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
    /* 合併呼叫端 headers：upsert 的 Prefer 不可被預設值蓋掉 */
    if (opts.headers) { for (var k in opts.headers) { if (Object.prototype.hasOwnProperty.call(opts.headers, k)) h[k] = opts.headers[k]; } }
    var init = { method: opts.method || 'GET', headers: h, cache: 'no-store' };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(SB_URL + '/rest/v1/' + path, init).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('Supabase HTTP ' + r.status + ' ' + String(t || '').slice(0, 200)); });
      if (r.status === 204) return null;
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  function readAllRows() {
    var PAGE = 1000, out = [];
    function page(off) {
      return sbFetch(SB_TABLE + '?select=key,value,updated_at&order=key.asc&limit=' + PAGE + '&offset=' + off)
        .then(function (rows) {
          rows = rows || [];
          for (var i = 0; i < rows.length; i++) out.push(rows[i]);
          return (rows.length < PAGE) ? out : page(off + PAGE);
        });
    }
    return page(0);
  }

  function scopeOf(k) {
    k = String(k || '');
    if (k.indexOf('build-assistant-') === 0) return 'build';
    if (k.indexOf('inspection-') === 0) return 'inspection';
    return 'other';
  }

  function buildPayload(rows) {
    var data = {}, sc = { build: 0, inspection: 0, other: 0 };
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.key) continue;
      data[r.key] = r.value;
      sc[scopeOf(r.key)]++;
    }
    return {
      app: 'dodafga.github.io', kind: 'daily-backup', version: 1,
      date: todayISO(), exportedAt: new Date().toISOString(),
      project: 'ohwrzcrmdmqnxbxjfuus', table: SB_TABLE,
      counts: { keys: rows.length, scopes: sc }, rows: data
    };
  }

  /* ---------- Google Drive ---------- */
  function G() {
    var g = global.GDrive;
    if (!g) throw new Error('GDrive 模組未載入');
    if (!g.isConfigured || !g.isConfigured()) throw new Error('尚未設定 Google OAuth Client ID');
    return g;
  }
  function driveApi(p, o) { return G().api(p, o); }
  function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  function findFolder() {
    var q = "name='" + esc(FOLDER_NAME) + "' and mimeType='" + FOLDER_MIME + "' and trashed=false and 'root' in parents";
    return driveApi('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent('files(id,name)')).then(function (j) {
      var f = j && j.files && j.files[0];
      return f ? f.id : '';
    });
  }
  function createFolder() {
    return driveApi('/drive/v3/files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] })
    }).then(function (f) {
      if (!f || !f.id) throw new Error('無法建立 backup 資料夾');
      return f.id;
    });
  }
  function ensureFolder() {
    var c = getFolderCache();
    if (c) {
      return driveApi('/drive/v3/files/' + encodeURIComponent(c) + '?fields=' + encodeURIComponent('id,trashed'))
        .then(function (f) {
          if (f && f.id && !f.trashed) return f.id;
          setFolderCache(''); return ensureFolder();
        })
        .catch(function () { setFolderCache(''); return ensureFolder(); });
    }
    return findFolder().then(function (id) {
      if (id) { setFolderCache(id); return id; }
      return createFolder().then(function (n) { setFolderCache(n); return n; });
    });
  }

  function listBackups(fid) {
    var q = "'" + fid + "' in parents and trashed=false";
    return driveApi('/drive/v3/files?q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('files(id,name,size,modifiedTime,createdTime,mimeType)') +
      '&orderBy=' + encodeURIComponent('name desc') + '&pageSize=200').then(function (j) {
      var fs = (j && j.files) || [];
      return fs.filter(function (f) { return f && /^\d{4}-\d{2}-\d{2}\.json$/.test(String(f.name || '')); })
        .sort(function (a, b) { return String(b.name).localeCompare(String(a.name)); });
    });
  }

  function findByName(fid, name) {
    var q = "'" + fid + "' in parents and name='" + esc(name) + "' and trashed=false";
    return driveApi('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=' + encodeURIComponent('files(id,name)'))
      .then(function (j) {
        var f = j && j.files && j.files[0];
        return f ? f.id : '';
      });
  }

  /* 同一天重複執行覆蓋同一個檔案 */
  function writeJson(fid, name, text) {
    var body = String(text);
    var up = function (id) {
      return driveApi('/upload/drive/v3/files/' + encodeURIComponent(id) +
        '?uploadType=media&fields=' + encodeURIComponent('id,name,size'), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: body
      });
    };
    return findByName(fid, name).then(function (id) {
      if (id) return up(id).then(function () { return { id: id, created: false }; });
      return driveApi('/drive/v3/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, parents: [fid], mimeType: 'application/json' })
      }).then(function (f) {
        if (!f || !f.id) throw new Error('無法建立備份檔');
        return up(f.id).then(function () { return { id: f.id, created: true }; });
      });
    });
  }

  function prune(fid, keep) {
    return listBackups(fid).then(function (fs) {
      var extra = fs.slice(keep);
      if (!extra.length) return { removed: 0 };
      var n = 0, chain = Promise.resolve();
      extra.forEach(function (f) {
        chain = chain.then(function () {
          return G().deleteFile(f.id, false).then(function () { n++; }).catch(function () {});
        });
      });
      return chain.then(function () { return { removed: n }; });
    });
  }

  /* ---------- 備份 ---------- */
  function backup(force) {
    if (state.running) return Promise.resolve({ skipped: true, reason: 'running' });
    var today = todayISO(), st = readState();
    if (!force && st.lastDate === today) return Promise.resolve({ skipped: true, reason: 'already-today' });

    state.running = true; state.lastError = '';
    emit('start', { date: today });
    var payload, fid;

    return ensureFolder().then(function (f) {
      fid = f; return readAllRows();
    }).then(function (rows) {
      if (!rows || !rows.length) throw new Error('Supabase app_state 沒有任何資料，取消備份以免產生空檔');
      payload = buildPayload(rows);
      state.lastCounts = payload.counts;
      return writeJson(fid, today + '.json', JSON.stringify(payload));
    }).then(function (res) {
      return prune(fid, MAX_KEEP).then(function (pr) {
        var now = new Date().toISOString(), cur = readState();
        cur.lastDate = today; cur.lastRunAt = now; cur.lastError = '';
        cur.lastCounts = payload.counts; cur.lastFileName = today + '.json';
        writeState(cur);
        state.running = false; state.lastDate = today; state.lastRunAt = now;
        state.lastCounts = payload.counts;
        emit('done', { date: today, counts: payload.counts, created: res.created, removed: pr.removed });
        return { ok: true, date: today, counts: payload.counts, removed: pr.removed, created: res.created };
      });
    }).catch(function (e) {
      state.running = false; state.lastError = String((e && e.message) || e);
      var cur = readState(); cur.lastError = state.lastError; writeState(cur);
      emit('error', { message: state.lastError });
      throw e;
    });
  }

  /* ---------- 還原 ---------- */
  function listRestorePoints() {
    return ensureFolder().then(listBackups).then(function (fs) {
      state.fileCount = fs.length;
      return fs.map(function (f) {
        return {
          id: f.id, name: f.name, date: String(f.name).replace(/\.json$/, ''),
          size: Number(f.size || 0), modifiedTime: f.modifiedTime || f.createdTime || ''
        };
      });
    });
  }

  function fetchJson(id) {
    return driveApi('/drive/v3/files/' + encodeURIComponent(id) + '?alt=media').then(function (j) {
      if (typeof j === 'string') {
        try { return JSON.parse(j); } catch (e) { throw new Error('備份檔不是有效的 JSON'); }
      }
      return j;
    });
  }

  function previewRestore(id) {
    return fetchJson(id).then(function (p) {
      if (!p || !p.rows || typeof p.rows !== 'object') throw new Error('備份檔缺少 rows 內容，無法還原');
      var ks = Object.keys(p.rows), sc = { build: 0, inspection: 0, other: 0 };
      for (var i = 0; i < ks.length; i++) sc[scopeOf(ks[i])]++;
      return { date: p.date || '', exportedAt: p.exportedAt || '', keys: ks.length, scopes: sc };
    });
  }

  function restore(id, opts) {
    opts = opts || {};
    var removeExtra = opts.removeExtra !== false, payload;

    return fetchJson(id).then(function (p) {
      if (!p || !p.rows || typeof p.rows !== 'object') throw new Error('備份檔缺少 rows 內容，無法還原');
      payload = p;
      var rows = [], now = new Date().toISOString();
      Object.keys(p.rows).forEach(function (k) { rows.push({ key: k, value: p.rows[k], updated_at: now }); });
      if (!rows.length) throw new Error('備份檔沒有任何鍵值');

      var CH = 200, chain = Promise.resolve();
      for (var i = 0; i < rows.length; i += CH) {
        (function (part) {
          chain = chain.then(function () {
            return sbFetch(SB_TABLE + '?on_conflict=key', {
              method: 'POST', headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }, body: part
            });
          });
        })(rows.slice(i, i + CH));
      }

      return chain.then(function () {
        if (!removeExtra) return { removed: 0 };
        return sbFetch(SB_TABLE + '?select=key').then(function (cur) {
          cur = cur || [];
          var keep = {};
          Object.keys(p.rows).forEach(function (k) { keep[k] = 1; });
          var ex = cur.map(function (r) { return r.key; }).filter(function (k) { return !keep[k]; });
          if (!ex.length) return { removed: 0 };
          var dc = Promise.resolve();
          for (var i2 = 0; i2 < ex.length; i2 += 100) {
            (function (part) {
              var q = part.map(function (k) { return '"' + String(k).replace(/"/g, '\\"') + '"'; }).join(',');
              dc = dc.then(function () {
                return sbFetch(SB_TABLE + '?key=in.(' + encodeURIComponent(q) + ')', { method: 'DELETE' });
              });
            })(ex.slice(i2, i2 + 100));
          }
          return dc.then(function () { return { removed: ex.length }; });
        });
      });
    }).then(function (r) {
      var s = global.SupabaseSync;
      var after = (s && s.syncNow) ? s.syncNow() : Promise.resolve(null);
      return after.then(function () {
        emit('restored', { keys: Object.keys(payload.rows).length, removed: (r && r.removed) || 0 });
        return { ok: true, date: payload.date || '', keys: Object.keys(payload.rows).length, removed: (r && r.removed) || 0 };
      });
    });
  }

  /* ---------- 自動觸發 ---------- */
  function hasToken() {
    try { var g = global.GDrive; return !!(g && g.hasToken && g.hasToken()); } catch (e) { return false; }
  }

  /* 權杖約 1 小時失效，不能用「有沒有現成權杖」判斷；
     要先試 ensureToken()（沿用舊權杖，再用 silent 模式換新的，不跳視窗）。 */
  function autoRun() {
    var today = todayISO(), st = readState();
    if (st.lastDate === today) {
      state.lastDate = today; state.lastRunAt = st.lastRunAt || ''; state.lastCounts = st.lastCounts || null;
      emit('idle', { date: today });
      return Promise.resolve({ skipped: true, reason: 'already-today' });
    }
    var g = global.GDrive;
    if (!g || !g.isConfigured || !g.isConfigured()) {
      emit('idle', { date: today, needAuth: true });
      return Promise.resolve({ skipped: true, reason: 'no-config' });
    }
    return Promise.resolve(g.ensureToken()).then(function () {
      return backup(false);
    }).catch(function (e) {
      var code = (e && e.code) || '';
      if (code === 'SIGNED_OUT' || code === 'SILENT_FAILED' || code === 'NEED_INTERACTIVE') {
        emit('idle', { date: today, needAuth: true });
        return { skipped: true, reason: 'need-auth' };
      }
      state.lastError = String((e && e.message) || e);
      emit('idle', { date: today, error: state.lastError });
      return { skipped: true, reason: 'error', error: state.lastError };
    });
  }

  function info() {
    var st = readState();
    return {
      today: todayISO(),
      lastDate: state.lastDate || st.lastDate || '',
      lastRunAt: state.lastRunAt || st.lastRunAt || '',
      lastError: state.lastError || st.lastError || '',
      lastCounts: state.lastCounts || st.lastCounts || null,
      running: state.running, folder: FOLDER_NAME, maxKeep: MAX_KEEP,
      fileCount: state.fileCount, authorized: hasToken(),
      backedUpToday: (state.lastDate || st.lastDate) === todayISO()
    };
  }

  global.DailyBackup = {
    FOLDER_NAME: FOLDER_NAME, MAX_KEEP: MAX_KEEP,
    todayISO: todayISO, fmtTime: fmtTime,
    backup: backup, autoRun: autoRun,
    listRestorePoints: listRestorePoints,
    previewRestore: previewRestore, restore: restore,
    info: info, onChange: onChange,
    _readAllRows: readAllRows, _buildPayload: buildPayload
  };

  /* ---------- 設定頁自動注入 UI ---------- */
  /* 只在 /settings/ 注入，其他頁面完全不動 DOM，因此不必修改 HTML。 */
  function injectUI() {
    var doc = global.document;
    if (!doc) return;
    if (String(global.location.pathname || '').indexOf('/settings') < 0) return;
    if (doc.getElementById('bkCard')) return;
    var wrap = doc.querySelector('.wrap');
    if (!wrap) return;

    var H = '';
    H += '<div class="card-h"><h2>每日自動雲端備份</h2><span class="tag" id="bkTag">檢查中</span></div>';
    H += '<div class="card-b">';
    H += '<div class="statusbox"><span class="dot" id="bkDot"></span><span class="t" id="bkTxt">—</span><span class="m" id="bkMsg"></span></div>';
    H += '<div class="note" style="margin-top:12px;">';
    H += '<b>備份位置：</b>你的 Google 雲端硬碟 <code>backup/</code> 資料夾　';
    H += '<b>檔名：</b><code>YYYY-MM-DD.json</code>（例：<code id="bkEx">' + todayISO() + '.json</code>）<br>';
    H += '<b>內容：</b>Supabase 裡全部資料鍵值（含營造 <code>build-assistant-*</code> 與查驗 <code>inspection-*</code> 兩套），不是只讀本機，所以換裝置也能拿到完整資料。<br>';
    H += '<b>頻率：</b>每天一次。同一天重複執行會<b>覆蓋</b>當天那份，不會產生多份；只保留最近 <b>30 份</b>，較舊的移到垃圾桶。';
    H += '</div>';
    H += '<div class="row"><button class="btn btn-primary btn-sm" id="btnBkNow" type="button">☁ 立即備份一次</button>';
    H += '<button class="btn btn-ghost btn-sm" id="btnBkList" type="button">📂 查看備份清單</button></div>';
    H += '<div id="bkListWrap" style="display:none;margin-top:14px;"><label>備份清單 <span class="hint">選一份可預覽並還原</span></label>';
    H += '<div id="bkList" style="max-height:260px;overflow:auto;border:1px solid #dcd8d4;border-radius:8px;background:#fcfbfa;"></div></div>';
    H += '<div id="bkRestoreWrap" style="display:none;margin-top:14px;">';
    H += '<div class="warn" style="background:#fdf3f2;border-color:#f0cfcc;color:#8a3b36;">';
    H += '<b>⚠ 還原前請確認</b><br>還原會把所選備份的內容<b>覆寫回 Supabase</b>，目前雲端的資料會被取代。';
    H += '備份當下不存在、但現在存在的鍵也會一併刪除（讓雲端回到備份當時的狀態）。兩台裝置重新整理後都會變成備份當下的內容。<br>';
    H += '<span id="bkPreview" style="display:block;margin-top:8px;font-weight:700;"></span></div>';
    H += '<div class="row"><button class="btn btn-danger btn-sm" id="btnBkOk" type="button">確認還原這份備份</button>';
    H += '<button class="btn btn-ghost btn-sm" id="btnBkCancel" type="button">取消</button></div></div>';
    H += '<div class="note" style="margin-top:12px;background:#f8f6f4;">';
    H += '<b>為什麼是「開站時自動檢查」：</b>本站是純靜態網站，沒有後端伺服器，不可能在你完全沒開網頁時自己執行。';
    H += '所以做法是——任何一台已授權 Google 的裝置打開本站，若當天還沒備份過就自動跑一次；當天只做一次，重複開站不會多備份。';
    H += '<b>原本「存入雲端／載入雲端」按鈕保留</b>，但日常不需要再手動按。</div></div>';

    var card = doc.createElement('div');
    card.className = 'card';
    card.id = 'bkCard';
    card.innerHTML = H;

    var first = wrap.querySelector('.card');
    if (first && first.nextSibling) wrap.insertBefore(card, first.nextSibling);
    else wrap.appendChild(card);

    var $ = function (id) { return doc.getElementById(id); };
    function toast(m, err) {
      var t = $('toast');
      if (!t) return;
      t.textContent = m;
      t.className = 'toast show' + (err ? ' err' : '');
      clearTimeout(t._tm);
      t._tm = setTimeout(function () { t.className = 'toast'; }, 3000);
    }

    function render(i) {
      if (!i) return;
      var txt = '—', col = '#6e6e74', tag = '檢查中';
      if (i.running) { txt = '備份中…'; col = '#7a4f4e'; tag = '備份中'; }
      else if (i.lastError) { txt = '備份失敗'; col = '#a34a45'; tag = '失敗'; }
      else if (i.backedUpToday) { txt = '今日已備份'; col = '#5f7a63'; tag = '今日已備份'; }
      else if (!i.authorized) { txt = '待授權 Google'; col = '#93939b'; tag = '待授權'; }
      else { txt = '今日尚未備份'; col = '#c47f17'; tag = '待備份'; }
      $('bkDot').style.background = col;
      $('bkTxt').textContent = txt;
      $('bkTxt').style.color = col;
      $('bkTag').textContent = tag;
      $('bkTag').className = 'tag' + (i.backedUpToday && !i.lastError ? ' ok' : '');
      var b = [i.lastRunAt ? '最後備份：' + fmtTime(i.lastRunAt) : '尚未備份'];
      if (i.lastCounts && i.lastCounts.keys != null) {
        var sc = i.lastCounts.scopes || {};
        b.push('共 ' + i.lastCounts.keys + ' 個鍵（營造 ' + (sc.build || 0) + '／查驗 ' + (sc.inspection || 0) + '）');
      }
      if (i.lastError) b.push('⚠ ' + i.lastError);
      $('bkMsg').textContent = b.join('　·　');
    }

    onChange(function (evt, d) {
      if (evt === 'done') toast('已備份今日資料（' + (d && d.counts ? d.counts.keys : 0) + ' 個鍵）');
      else if (evt === 'error') toast('備份失敗：' + (d && d.message ? d.message : ''), true);
      render(info());
    });
    render(info());

    var sel = null;

    $('btnBkNow').addEventListener('click', function () {
      var btn = this;
      if (!hasToken()) { toast('請先按「🔗 連線 Google Drive」完成授權', true); return; }
      btn.disabled = true; btn.textContent = '備份中…';
      backup(true).then(function (r) {
        toast('已備份 ' + r.date + '.json（' + r.counts.keys + ' 個鍵）');
      }).catch(function (e) {
        toast('備份失敗：' + (e && e.message ? e.message : e), true);
      }).then(function () {
        btn.disabled = false; btn.textContent = '☁ 立即備份一次';
        render(info());
      });
    });

    $('btnBkList').addEventListener('click', function () {
      var w = $('bkListWrap'), list = $('bkList');
      if (w.style.display !== 'none') { w.style.display = 'none'; return; }
      if (!hasToken()) { toast('請先連線 Google Drive', true); return; }
      list.innerHTML = '<div style="padding:14px;font-size:13px;color:#6e6e74;">讀取中…</div>';
      w.style.display = 'block';

      listRestorePoints().then(function (items) {
        if (!items.length) {
          list.innerHTML = '<div style="padding:14px;font-size:13px;color:#6e6e74;">目前沒有備份檔。按「☁ 立即備份一次」建立第一份。</div>';
          return;
        }
        var html = '';
        for (var i = 0; i < items.length; i++) {
          var it = items[i], kb = it.size ? Math.round(it.size / 1024) + ' KB' : '';
          html += '<div class="bkrow" data-id="' + it.id + '" data-date="' + it.date + '" style="display:flex;align-items:center;gap:10px;padding:10px 13px;border-bottom:1px solid #eae7e3;cursor:pointer;">';
          html += '<span style="font-weight:700;font-size:13px;">' + it.date + '.json</span>';
          html += '<span style="font-size:11.5px;color:#6e6e74;">' + kb + '</span>';
          html += '<span style="margin-left:auto;font-size:11.5px;color:#7a4f4e;font-weight:600;">選擇還原 ›</span></div>';
        }
        list.innerHTML = html;
        Array.prototype.forEach.call(list.querySelectorAll('.bkrow'), function (row) {
          row.addEventListener('click', function () {
            sel = row.getAttribute('data-id');
            var date = row.getAttribute('data-date');
            $('bkRestoreWrap').style.display = 'block';
            $('bkPreview').textContent = '預覽中…';
            previewRestore(sel).then(function (p) {
              $('bkPreview').textContent = '所選備份：' + date + '.json　·　共 ' + p.keys + ' 個鍵（營造 ' + p.scopes.build +
                '／查驗 ' + p.scopes.inspection + (p.scopes.other ? '／其他 ' + p.scopes.other : '') + '）　·　匯出於 ' + p.exportedAt;
            }).catch(function (e) {
              $('bkPreview').textContent = '無法讀取這份備份：' + (e && e.message ? e.message : e);
            });
          });
        });
      }).catch(function (e) {
        list.innerHTML = '<div style="padding:14px;font-size:13px;color:#a34a45;">讀取失敗：' + (e && e.message ? e.message : e) + '</div>';
      });
    });

    $('btnBkCancel').addEventListener('click', function () {
      sel = null;
      $('bkRestoreWrap').style.display = 'none';
      $('bkPreview').textContent = '';
    });

    $('btnBkOk').addEventListener('click', function () {
      if (!sel) return;
      if (!global.confirm('確定要把這份備份還原回 Supabase 嗎？\n\n目前雲端的資料會被備份當下的內容取代，無法自動復原。\n建議先按「☁ 立即備份一次」把現況存一份再還原。')) return;
      var btn = this;
      btn.disabled = true; btn.textContent = '還原中…';
      restore(sel, { removeExtra: true }).then(function (r) {
        toast('已還原 ' + (r.date || '') + '（' + r.keys + ' 個鍵）');
        $('bkRestoreWrap').style.display = 'none';
        sel = null;
      }).catch(function (e) {
        toast('還原失敗：' + (e && e.message ? e.message : e), true);
      }).then(function () {
        btn.disabled = false; btn.textContent = '確認還原這份備份';
      });
    });
  }

  function boot() {
    try { injectUI(); } catch (e) {}
    setTimeout(function () {
      try { autoRun(); } catch (e) { state.lastError = String((e && e.message) || e); }
    }, 3000);
  }
  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
