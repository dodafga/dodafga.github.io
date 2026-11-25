/* build-cloud.js — 營造助手專用雲端備份（與查驗助手完全分離）
 *
 * 分離原則：
 *   本機金鑰   營造助手一律 build-assistant-* ｜ 查驗助手一律 inspection-*
 *   雲端檔案   build-data.json               ｜ inspection-data.json
 *   雲端資料夾 營造助手資料                    ｜ 營建查驗資料
 *   照片資料夾 義力／營造照片                  ｜ 義力／施工照片
 *
 * 本模組只讀寫 build-assistant-* ，絕不觸碰任何 inspection-* 資料。
 */
(function (global) {
  'use strict';

  var PREFIX = 'build-assistant-';
  var META_FILEID = PREFIX + 'cloud-fileid';
  var META_LAST = PREFIX + 'cloud-last-backup';
  var FILE_NAME = 'build-data.json';
  var FOLDER_NAME = '營造助手資料';
  var KIND = 'build-backup';
  var VERSION = 1;

  /* 不屬於使用者資料的中繼金鑰，備份時排除 */
  var META_KEYS = [META_FILEID, META_LAST];

  function LS() { return global.localStorage; }

  function get(k, d) {
    try { var v = LS().getItem(k); return v == null ? (d == null ? '' : d) : v; }
    catch (e) { return d == null ? '' : d; }
  }
  function set(k, v) { try { LS().setItem(k, v); return true; } catch (e) { return false; } }
  function del(k) { try { LS().removeItem(k); return true; } catch (e) { return false; } }

  /* ---------- 時間 ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function getLastBackup() { return get(META_LAST, ''); }
  function setLastBackup(iso) { set(META_LAST, iso || new Date().toISOString()); }
  function lastBackupText() {
    var t = getLastBackup();
    return t ? '最後備份：' + fmtTime(t) : '尚未備份';
  }

  /* ---------- 收集／套用 ---------- */
  function userKeys() {
    var out = [], ls = LS();
    if (!ls) return out;
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (!k) continue;
      if (k.indexOf(PREFIX) !== 0) continue;
      if (META_KEYS.indexOf(k) >= 0) continue;
      out.push(k);
    }
    return out.sort();
  }

  function parse(raw, dflt) {
    if (raw == null || raw === '') return dflt;
    try { return JSON.parse(raw); } catch (e) { return dflt; }
  }

  /* 把一個值分類成「結構化資料」或「純字串」以便統計 */
  function isJSONText(v) {
    if (typeof v !== 'string') return false;
    var t = v.replace(/^\s+/, '');
    if (!t) return false;
    var c = t.charAt(0);
    return c === '{' || c === '[';
  }

  function collect() {
    var keys = userKeys();
    var entries = {}, counts = { todo: 0, event: 0, preset: 0, vendorPreset: 0, combo: 0, crew: 0 };
    keys.forEach(function (k) {
      var raw = get(k, '');
      entries[k] = isJSONText(raw) ? parse(raw, raw) : raw;
    });

    function len(k) { var v = entries[k]; return Array.isArray(v) ? v.length : 0; }
    counts.todo = len(PREFIX + 'todo');
    counts.event = len(PREFIX + 'event');
    counts.preset = len(PREFIX + 'presets');
    counts.vendorPreset = len(PREFIX + 'vendor-presets');
    counts.combo = len(PREFIX + 'combos-v1');
    var cr = entries[PREFIX + 'crew'];
    counts.crew = (cr && (Array.isArray(cr.types) ? cr.types.length : 0) +
      (Array.isArray(cr.machs) ? cr.machs.length : 0)) || 0;

    return {
      app: 'build-assistant',
      kind: KIND,
      version: VERSION,
      savedAt: new Date().toISOString(),
      counts: counts,
      keyCount: keys.length,
      data: entries
    };
  }

  function apply(payload) {
    if (!payload) return null;
    var d = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
    if (!d || typeof d !== 'object') return null;

    var written = 0, removed = 0;

    /* 先清掉所有既有的 build-assistant-* 使用者資料（保留中繼金鑰） */
    userKeys().forEach(function (k) { if (!(k in d)) { del(k); removed++; } });

    Object.keys(d).forEach(function (k) {
      if (k.indexOf(PREFIX) !== 0) return;        /* 只寫營造助手的鍵 */
      if (META_KEYS.indexOf(k) >= 0) return;
      var v = d[k];
      var raw = (typeof v === 'string') ? v : JSON.stringify(v);
      if (set(k, raw)) written++;
    });

    return { written: written, removed: removed };
  }

  /* 載入後把畫面重畫（直接呼叫營造助手已經有的 render 函式） */
  function refreshUI() {
    try {
      if (typeof global.__buildRefreshUI === 'function') { global.__buildRefreshUI(); return; }
    } catch (e) {}
    var names = ['renderTodo', 'renderEvents', 'crewRender', 'presetRender',
      'vpresetRender', 'comboRender', 'paintShareText'];
    for (var i = 0; i < names.length; i++) {
      try {
        var fn = global[names[i]];
        if (typeof fn === 'function') fn();
      } catch (e) { /* 個別函式不存在時忽略 */ }
    }
    try { paintLast(); } catch (e) {}
  }

  function stats() { return collect().counts; }

  function summaryText(c) {
    if (!c) return '';
    return '待辦 ' + (c.todo || 0) + ' 筆　·　日期事項 ' + (c.event || 0) + ' 筆　·　班組 ' +
      (c.preset || 0) + ' 組　·　廠商 ' + (c.vendorPreset || 0) + ' 家　·　常用項目 ' +
      (c.combo || 0) + ' 組';
  }

  /* ---------- Drive ---------- */
  function G() { return global.GDrive || null; }

  function needSetup() {
    var g = G();
    return !g || !g.isConfigured || !g.isConfigured();
  }

  function escQ(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  function token() {
    var g = G();
    if (!g) return Promise.reject(new Error('Drive 模組未載入'));
    return g.ensureToken().catch(function (e) {
      if (e && (e.code === 'SIGNED_OUT' || e.code === 'NEED_INTERACTIVE' ||
        e.code === 'SILENT_FAILED' || e.code === 'CONNECT_FAILED' || e.status === 401)) {
        return g.connect();
      }
      throw e;
    });
  }

  function ensureFolder() {
    var g = G();
    var q = "name='" + escQ(FOLDER_NAME) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    return g.api('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)&spaces=drive')
      .then(function (j) {
        if (j && j.files && j.files.length) return j.files[0].id;
        return g.api('/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
        }).then(function (f) { return f.id; });
      });
  }

  function ensureFile(folderId) {
    var g = G();
    var cached = get(META_FILEID, '');
    if (cached) return Promise.resolve(cached);
    var q = "name='" + escQ(FILE_NAME) + "' and '" + folderId + "' in parents and trashed=false";
    return g.api('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)')
      .then(function (j) {
        if (j && j.files && j.files.length) {
          set(META_FILEID, j.files[0].id);
          return j.files[0].id;
        }
        return g.api('/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: FILE_NAME, parents: [folderId], mimeType: 'application/json'
          })
        }).then(function (f) { set(META_FILEID, f.id); return f.id; });
      });
  }

  function writeJSON(fileId, obj) {
    var g = G();
    var blob;
    try {
      blob = new Blob([JSON.stringify(obj)], { type: 'application/json; charset=UTF-8' });
    } catch (e) {
      blob = null;
    }
    if (!blob) return Promise.reject(new Error('無法建立備份內容'));
    return g.updateFileContent(fileId, blob, 'application/json; charset=UTF-8');
  }

  function save() {
    if (needSetup()) {
      return Promise.reject(new Error('尚未設定 Google OAuth Client ID，請先到「設定」完成設定'));
    }
    var payload = collect();
    return token()
      .then(ensureFolder)
      .then(ensureFile)
      .then(function (fileId) { return writeJSON(fileId, payload); })
      .then(function () {
        setLastBackup(payload.savedAt);
        paintLast();
        return payload.counts;
      });
  }

  function load() {
    if (needSetup()) {
      return Promise.reject(new Error('尚未設定 Google OAuth Client ID，請先到「設定」完成設定'));
    }
    var g = G();
    return token()
      .then(ensureFolder)
      .then(ensureFile)
      .then(function (fileId) { return g.fetchBlob(fileId); })
      .then(function (blob) {
        if (!blob) throw new Error('雲端沒有任何備份內容');
        if (blob.text) return blob.text();
        return new Promise(function (res, rej) {
          var fr = new FileReader();
          fr.onload = function () { res(fr.result); };
          fr.onerror = function () { rej(new Error('讀取雲端檔案失敗')); };
          fr.readAsText(blob);
        });
      })
      .then(function (text) {
        var j;
        try { j = JSON.parse(text); } catch (e) { throw new Error('雲端檔案格式不正確'); }
        if (j && j.app && j.app !== 'build-assistant') {
          throw new Error('這個雲端檔不是營造助手的備份（' + j.app + '）');
        }
        var res = apply(j);
        if (!res || !res.written) throw new Error('雲端檔案沒有可用的營造資料');
        refreshUI();
        res.counts = stats();
        res.savedAt = j && j.savedAt || '';
        return res;
      });
  }

  /* ---------- UI ---------- */
  var lastEls = [];
  function paintLast() {
    var txt = lastBackupText();
    for (var i = 0; i < lastEls.length; i++) {
      var el = lastEls[i];
      if (el && el.parentNode) el.textContent = txt;
    }
  }

  function mount(el) {
    var node = (typeof el === 'string') ? document.getElementById(el) : el;
    if (!node || node.getAttribute('data-bc-mounted') === '1') return null;
    node.setAttribute('data-bc-mounted', '1');

    node.innerHTML = [
      '<div class="bcwrap">',
      '  <div class="bcline"><span class="bcdot" id="bcDot"></span>',
      '    <span id="bcState">營造資料（本機）</span>',
      '    <span class="bcsp"></span><span id="bcCounts"></span></div>',
      '  <div class="bcnote bc-last" id="bcLast">' + escapeHTML(lastBackupText()) + '</div>',
      '  <div class="bcnote">把營造助手的資料（待辦、日期事項、班組、廠商、常用項目、常用班組）整份存到 Google Drive 的 <b>營造助手資料／build-data.json</b>。',
      '    這份備份與查驗助手的 inspection-data.json <b>完全分開</b>，互不覆蓋。</div>',
      '  <div class="bcbtns">',
      '    <button type="button" class="btn" id="bcSave">☁ 存入雲端</button>',
      '    <button type="button" class="btn ghost" id="bcLoad">⬇ 從雲端載入</button>',
      '  </div>',
      '  <div class="bcnote" id="bcMsg"></div>',
      '</div>'
    ].join('');

    var btnSave = node.querySelector('#bcSave');
    var btnLoad = node.querySelector('#bcLoad');
    var msg = node.querySelector('#bcMsg');
    var cnt = node.querySelector('#bcCounts');
    var st = node.querySelector('#bcState');
    var dot = node.querySelector('#bcDot');
    var last = node.querySelector('#bcLast');
    lastEls.push(last);

    function paintCounts() {
      if (cnt) cnt.textContent = summaryText(stats());
      if (last) last.textContent = lastBackupText();
    }
    function say(t, isErr) {
      if (!msg) return;
      msg.textContent = t || '';
      msg.className = 'bcnote' + (isErr ? ' err' : (t ? ' ok' : ''));
    }
    function busy(on) {
      if (btnSave) btnSave.disabled = on;
      if (btnLoad) btnLoad.disabled = on;
      if (st) st.textContent = on ? '處理中…' : '營造資料（本機）';
      if (dot) dot.className = 'bcdot' + (on ? ' busy' : '');
    }
    function toast(t, isErr) {
      var C = global.Core;
      if (C && C.makeToast) {
        if (!node.__bcToast) node.__bcToast = C.makeToast('toast', 3000);
        node.__bcToast(t, isErr);
      }
    }

    if (btnSave) btnSave.addEventListener('click', function () {
      busy(true); say('正在存到 Google Drive…');
      save().then(function (c) {
        say('已存入 Google Drive：' + summaryText(c));
        toast('已存入雲端（營造資料）');
      }).catch(function (e) {
        var m = (e && e.message) ? e.message : '存入失敗';
        say('存入失敗：' + m, true); toast('存入雲端失敗：' + m, true);
      }).then(function () { busy(false); paintCounts(); });
    });

    if (btnLoad) btnLoad.addEventListener('click', function () {
      var mine = summaryText(stats());
      var warn = '將以雲端的營造資料覆蓋本機的營造資料。\n本機：' + mine +
        '\n\n查驗助手的資料（inspection-*）不會被影響。\n\n確定要載入嗎？';
      if (!global.confirm(warn)) return;
      busy(true); say('正在從 Google Drive 載入…');
      load().then(function (r) {
        say('已從雲端載入營造資料：' + summaryText(r.counts));
        toast('已從雲端載入營造資料，頁面將重新整理');
        setTimeout(function () { try { global.location.reload(); } catch (e) {} }, 800);
      }).catch(function (e) {
        var m = (e && e.message) ? e.message : '載入失敗';
        say('載入失敗：' + m, true); toast('從雲端載入失敗：' + m, true);
      }).then(function () { busy(false); paintCounts(); });
    });

    paintCounts();
    return { paint: paintCounts };
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  var CSS = [
    '.bcwrap{display:flex;flex-direction:column;gap:10px}',
    '.bcline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:700;color:#3A3A3E}',
    '.bcdot{width:9px;height:9px;border-radius:50%;background:#1F7A4D;flex:0 0 9px}',
    '.bcdot.busy{background:#C47F17;animation:bcpulse 1s ease-in-out infinite}',
    '@keyframes bcpulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '.bcsp{margin-left:auto}',
    '.bcline #bcCounts{font-size:12px;font-weight:600;color:#6E6E74}',
    '.bcnote{font-size:12.5px;line-height:1.65;color:#6E6E74}',
    '.bcnote.ok{color:#1F7A4D;font-weight:700}',
    '.bcnote.err{color:#B3261E;font-weight:700}',
    '.bc-last{color:#3A3A3E;font-weight:700}',
    '.bcbtns{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media(max-width:360px){.bcbtns{grid-template-columns:1fr}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('bc-style')) return;
    var s = document.createElement('style');
    s.id = 'bc-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  global.BuildCloud = {
    PREFIX: PREFIX,
    FILE_NAME: FILE_NAME,
    FOLDER_NAME: FOLDER_NAME,
    keys: userKeys,
    collect: collect,
    apply: apply,
    save: save,
    load: load,
    stats: stats,
    summary: summaryText,
    mount: function (el) { injectCSS(); return mount(el); },
    getLastBackup: getLastBackup,
    setLastBackup: setLastBackup,
    lastBackupText: lastBackupText,
    paintLast: paintLast
  };
})(typeof window !== 'undefined' ? window : this);
