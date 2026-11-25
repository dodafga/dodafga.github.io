/* build-photo-move.js — 把營造助手早期上傳到「義力／施工照片」的舊照片
 * 搬到營造自己的「義力／營造照片」，兩邊不再混在一起。
 *
 * 只做搬移（addParents / removeParents）：
 *   - 不改檔名
 *   - 不刪任何檔案或資料夾
 *   - 搬錯了可以再搬回來（同一個工具換方向）
 *
 * 判定方式（畫面上可選）：
 *   auto — 檔案說明含「廠商：」「工種：」「機具：」任一個，視為營造照片
 *   all  — 該日期資料夾內全部搬
 */
(function (global) {
  'use strict';

  var PARENT = '義力';
  var FROM = '施工照片';
  var TO = '營造照片';
  var MARKS = ['廠商：', '工種：', '機具：'];

  function G() { return global.GDrive || null; }
  function q(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

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

  function findFolder(name, parentId) {
    var g = G();
    var s = "name='" + q(name) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    s += parentId ? " and '" + parentId + "' in parents" : " and 'root' in parents";
    return g.api('/drive/v3/files?q=' + encodeURIComponent(s) + '&fields=files(id,name)&spaces=drive')
      .then(function (j) { return (j && j.files && j.files.length) ? j.files[0].id : ''; });
  }

  function ensureFolder(name, parentId) {
    return findFolder(name, parentId).then(function (id) {
      if (id) return id;
      var g = G();
      var body = { name: name, mimeType: 'application/vnd.google-apps.folder' };
      if (parentId) body.parents = [parentId];
      return g.api('/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (f) { return f.id; });
    });
  }

  function listAll(query, fields) {
    var g = G(), out = [], tok = '', pages = 0;
    function step() {
      if (pages >= 30) return Promise.resolve(out);
      pages++;
      var url = '/drive/v3/files?q=' + encodeURIComponent(query) +
        '&fields=' + encodeURIComponent(fields) + '&pageSize=1000&spaces=drive' +
        (tok ? '&pageToken=' + encodeURIComponent(tok) : '');
      return g.api(url).then(function (j) {
        if (j && j.files) for (var i = 0; i < j.files.length; i++) out.push(j.files[i]);
        tok = (j && j.nextPageToken) || '';
        return tok ? step() : out;
      });
    }
    return step();
  }

  function isImg(f) {
    var mt = String(f.mimeType || '');
    if (mt) return /^image\//.test(mt);
    return /\.(png|jpe?g|webp|heic|heif)$/i.test(String(f.name || ''));
  }

  function looksBuild(d) {
    var s = String(d || '');
    for (var i = 0; i < MARKS.length; i++) if (s.indexOf(MARKS[i]) >= 0) return true;
    return false;
  }

  function scan(mode, onProgress) {
    return token().then(function () {
      return findFolder(PARENT).then(function (pid) {
        if (!pid) throw new Error('Drive 上找不到「' + PARENT + '」資料夾');
        return findFolder(FROM, pid).then(function (fromId) {
          if (!fromId) throw new Error('找不到「' + PARENT + '／' + FROM + '」資料夾（可能已搬完）');
          return findFolder(TO, pid).then(function (toId) {
            var dayQ = "'" + fromId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
            return listAll(dayQ, 'nextPageToken,files(id,name)').then(function (folders) {
              var days = folders.filter(function (f) { return /^\d{4}-\d{2}-\d{2}$/.test(f.name); });
              var moves = [], skip = 0, i = 0;

              function next() {
                if (i >= days.length) return Promise.resolve();
                var day = days[i];
                var fqQ = "'" + day.id + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'";
                return listAll(fqQ, 'nextPageToken,files(id,name,description,mimeType)').then(function (files) {
                  for (var k = 0; k < files.length; k++) {
                    var f = files[k];
                    if (!isImg(f)) continue;
                    var ok = (mode === 'all') ? true : looksBuild(f.description);
                    if (ok) moves.push({ id: f.id, name: f.name, date: day.name, fromDayId: day.id });
                    else skip++;
                  }
                  i++;
                  if (onProgress) { try { onProgress(i, days.length); } catch (e) {} }
                  return next();
                });
              }
              return next().then(function () {
                return { toId: toId || '', days: days.length, moves: moves, skipped: skip, mode: mode };
              });
            });
          });
        });
      });
    });
  }

  function move(opts, onProgress) {
    var moves = (opts && opts.moves) || [];
    if (!moves.length) return Promise.resolve({ moved: 0, failed: 0, errors: [] });
    return token().then(function () {
      var g = G(), cache = {}, moved = 0, failed = 0, errs = [], i = 0;

      function toDay(date) {
        if (cache[date]) return Promise.resolve(cache[date]);
        return ensureFolder(date, opts.toId).then(function (id) { cache[date] = id; return id; });
      }

      function step() {
        if (i >= moves.length) return Promise.resolve({ moved: moved, failed: failed, errors: errs });
        var m = moves[i];
        return toDay(m.date).then(function (tid) {
          return g.api('/drive/v3/files/' + encodeURIComponent(m.id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addParents: [tid], removeParents: [m.fromDayId] })
          }).then(function () { moved++; }, function (e) {
            failed++;
            if (errs.length < 8) errs.push((m.name || m.id) + '：' + ((e && e.message) || e));
          });
        }, function (e) {
          failed++;
          if (errs.length < 8) errs.push((m.name || m.id) + '：' + ((e && e.message) || e));
        }).then(function () {
          i++;
          if (onProgress) { try { onProgress(i, moves.length); } catch (e) {} }
          return step();
        });
      }
      return step();
    });
  }

  var CSS = [
    '.bpm{display:flex;flex-direction:column;gap:10px}',
    '.bpmrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:700;color:#3A3A3E}',
    '.bpmdot{width:9px;height:9px;border-radius:50%;background:#8A8F98;flex:0 0 9px}',
    '.bpmdot.busy{background:#C47F17;animation:bpmP 1s ease-in-out infinite}',
    '.bpmdot.ok{background:#1F7A4D}',
    '@keyframes bpmP{0%,100%{opacity:1}50%{opacity:.35}}',
    '.bpmsp{margin-left:auto}',
    '.bpmnote{font-size:12.5px;line-height:1.65;color:#6E6E74}',
    '.bpmnote.ok{color:#1F7A4D;font-weight:700}',
    '.bpmnote.err{color:#B3261E;font-weight:700}',
    '.bpmmode{display:flex;gap:8px;flex-wrap:wrap}',
    '.bpmmode label{display:flex;align-items:center;gap:6px;font-size:13px;padding:9px 12px;border:1px solid #DDE4EC;border-radius:10px;background:#fff;cursor:pointer;line-height:1.4}',
    '.bpmmode label.on{border-color:#1F7A4D;background:#F1F8F4;font-weight:700}',
    '.bpmlist{max-height:200px;overflow:auto;border:1px solid #E7ECF2;border-radius:10px;background:#FBFCFE;padding:8px 10px;font-size:12px;line-height:1.7;color:#4A5056}',
    '.bpmlist div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bpmbtns{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media(max-width:380px){.bpmbtns{grid-template-columns:1fr}}',
    '.bpmbar{height:6px;border-radius:3px;background:#E7ECF2;overflow:hidden}',
    '.bpmbar i{display:block;height:100%;width:0;background:#1F7A4D;transition:width .2s}'
  ].join('');

  function mount(el) {
    var node = (typeof el === 'string') ? document.getElementById(el) : el;
    if (!node || node.getAttribute('data-bpm') === '1') return null;
    node.setAttribute('data-bpm', '1');

    if (!document.getElementById('bpm-style')) {
      var s = document.createElement('style');
      s.id = 'bpm-style'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    node.innerHTML = [
      '<div class="bpm">',
      '  <div class="bpmrow"><span class="bpmdot" id="bpmDot"></span>',
      '    <span id="bpmState">尚未掃描</span><span class="bpmsp"></span><span id="bpmCount"></span></div>',
      '  <div class="bpmnote">把早期上傳到 <b>' + PARENT + '／' + FROM + '</b> 的營造照片，搬到 <b>' +
      PARENT + '／' + TO + '</b>。只改位置，不改檔名、不刪檔案。</div>',
      '  <div class="bpmmode" id="bpmMode">',
      '    <label data-mode="auto" class="on"><input type="radio" name="bpmmode" value="auto" checked>只搬營造照片（看說明）</label>',
      '    <label data-mode="all"><input type="radio" name="bpmmode" value="all">整批搬（該日期全部）</label>',
      '  </div>',
      '  <div class="bpmbtns">',
      '    <button type="button" class="btn ghost" id="bpmScan">🔍 掃描舊照片</button>',
      '    <button type="button" class="btn" id="bpmGo" disabled>➡ 開始搬移</button>',
      '  </div>',
      '  <div class="bpmbar" id="bpmBarWrap" style="display:none"><i id="bpmBar"></i></div>',
      '  <div class="bpmlist" id="bpmList" style="display:none"></div>',
      '  <div class="bpmnote" id="bpmMsg"></div>',
      '</div>'
    ].join('');

    var dot = node.querySelector('#bpmDot');
    var stEl = node.querySelector('#bpmState');
    var cnt = node.querySelector('#bpmCount');
    var listEl = node.querySelector('#bpmList');
    var msg = node.querySelector('#bpmMsg');
    var barW = node.querySelector('#bpmBarWrap');
    var bar = node.querySelector('#bpmBar');
    var bScan = node.querySelector('#bpmScan');
    var bGo = node.querySelector('#bpmGo');
    var modeBox = node.querySelector('#bpmMode');
    var res = null, busy = false;

    function say(t, kind) {
      if (!msg) return;
      msg.textContent = t || '';
      msg.className = 'bpmnote' + (kind ? ' ' + kind : '');
    }
    function paint(on, done) {
      if (dot) dot.className = 'bpmdot' + (on ? ' busy' : (done ? ' ok' : ''));
      if (stEl) stEl.textContent = on ? '處理中…' : (done ? '完成' : '尚未掃描');
      if (bScan) bScan.disabled = on;
      if (bGo) bGo.disabled = on || !res || !res.moves.length;
    }
    function toast(t, bad) {
      var C = global.Core;
      if (C && C.makeToast) {
        if (!node.__t) node.__t = C.makeToast('toast', 3000);
        node.__t(t, bad);
      }
    }
    function mode() {
      var r = node.querySelector('input[name="bpmmode"]:checked');
      return r ? r.value : 'auto';
    }

    if (modeBox) modeBox.addEventListener('click', function (e) {
      var lab = e.target.closest ? e.target.closest('label[data-mode]') : null;
      if (!lab) return;
      var all = modeBox.querySelectorAll('label[data-mode]');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === lab);
      res = null;
      if (cnt) cnt.textContent = '';
      if (listEl) listEl.style.display = 'none';
      if (bGo) bGo.disabled = true;
      say('模式已改變，請重新掃描。');
    });

    if (bScan) bScan.addEventListener('click', function () {
      if (busy) return;
      busy = true; res = null; paint(true);
      say('正在掃描 ' + FROM + ' 內的舊照片…');
      if (barW) barW.style.display = 'none';
      if (listEl) listEl.style.display = 'none';
      scan(mode(), function (i, n) { say('掃描中… ' + i + ' / ' + n + ' 個日期資料夾'); })
        .then(function (r) {
          res = r;
          if (cnt) cnt.textContent = r.moves.length + ' 張可搬' + (r.skipped ? '　·　' + r.skipped + ' 張不符判定' : '');
          if (r.moves.length) {
            var h = '';
            for (var i = 0; i < r.moves.length && i < 200; i++) h += '<div>' + esc(r.moves[i].date) + '　' + esc(r.moves[i].name) + '</div>';
            if (r.moves.length > 200) h += '<div>… 另有 ' + (r.moves.length - 200) + ' 張</div>';
            listEl.innerHTML = h; listEl.style.display = 'block';
            say('共 ' + r.moves.length + ' 張可搬到 ' + TO + '（' + r.days + ' 個日期資料夾）。按「開始搬移」才會真的搬。', 'ok');
          } else {
            say('沒有符合條件的照片。若確定整批都要搬，請改選「整批搬」再掃描一次。');
          }
          paint(false, true);
          if (stEl) stEl.textContent = '已掃描';
          if (bGo) bGo.disabled = !r.moves.length;
        })
        .catch(function (e) {
          var m = (e && e.message) || String(e);
          say('掃描失敗：' + m, 'err'); toast('掃描失敗：' + m, true);
          paint(false, false);
        })
        .then(function () { busy = false; });
    });

    if (bGo) bGo.addEventListener('click', function () {
      if (busy || !res || !res.moves.length) return;
      var n = res.moves.length;
      if (!global.confirm('要把 ' + n + ' 張照片從「' + PARENT + '／' + FROM + '」搬到「' + PARENT + '／' + TO +
        '」嗎？\n\n只會改變檔案所在的資料夾，不會刪除檔案，也不會改檔名。')) return;
      busy = true; paint(true);
      if (barW) barW.style.display = '';
      say('搬移中…');
      move({ moves: res.moves, toId: res.toId }, function (i, t) {
        if (bar) bar.style.width = Math.round(i / Math.max(1, t) * 100) + '%';
        say('搬移中… ' + i + ' / ' + t);
      }).then(function (r) {
        if (bar) bar.style.width = '100%';
        say('已搬 ' + r.moved + ' 張' + (r.failed ? '，失敗 ' + r.failed + ' 張' : '') +
          (r.errors.length ? '\n' + r.errors.join('\n') : ''), r.failed ? 'err' : 'ok');
        toast('舊照片搬移完成：' + r.moved + ' 張' + (r.failed ? '（失敗 ' + r.failed + '）' : ''), !!r.failed);
        res = null;
        if (cnt) cnt.textContent = '';
        if (listEl) listEl.style.display = 'none';
        if (stEl) stEl.textContent = '已搬移';
        if (bGo) bGo.disabled = true;
      }).catch(function (e) {
        var m = (e && e.message) || String(e);
        say('搬移失敗：' + m, 'err'); toast('搬移失敗：' + m, true);
      }).then(function () { busy = false; paint(false, true); });
    });

    return { scan: scan, move: move };
  }

  global.BuildPhotoMove = { scan: scan, move: move, mount: mount, FROM: FROM, TO: TO };
})(typeof window !== 'undefined' ? window : this);
