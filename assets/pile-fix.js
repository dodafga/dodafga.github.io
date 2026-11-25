/* pile-fix.js — 樁號修正（查驗助手專用）
 *
 * 用途：已記錄的樁號（墩號＋樁號）若有錯，可以在這裡改。
 *       改完後，所有引用該樁號的地方同步更新：
 *         1. 查驗紀錄（inspection-suite-data-v1 → logs[].piles / pier）
 *         2. 樁位資料（inspection-pile-measure-v1 → pile / pier）
 *         3. 已上傳照片紀錄（inspection-drive-photo-history → item / name）
 *         4. 每日固定人員紀錄裡的樁號字串（inspection-daily-current-v1）
 *
 * 只改「樁號」，不動日期、人員、數量等其他欄位。
 * 改之前會列出影響筆數，改完可以按「復原」回到修改前（保留一份快照）。
 */
(function (global) {
  'use strict';

  var SUITE = 'inspection-suite-data-v1';
  var MEASURE = 'inspection-pile-measure-v1';
  var HIST = 'inspection-drive-photo-history';
  var CUR = 'inspection-daily-current-v1';
  var SNAP = 'inspection-pile-rename-snapshot';

  function ls() { return global.localStorage; }
  function getRaw(k) { try { return ls().getItem(k); } catch (e) { return null; } }
  function setRaw(k, v) { try { ls().setItem(k, v); return true; } catch (e) { return false; } }
  function parse(raw, dflt) {
    if (!raw) return dflt;
    try { var o = JSON.parse(raw); return (o == null) ? dflt : o; } catch (e) { return dflt; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function pierOf(no) {
    var m = String(no || '').match(/^(.+?)-\d+$/);
    return m ? m[1] : String(no || '');
  }
  /* 樁號合法：墩號-數字，例如 PR4-1、PLAT-12、RC1-3 */
  function validNo(no) {
    return /^[A-Za-z]{1,8}\d*-[0-9]{1,3}$/.test(String(no || '').trim());
  }
  function norm(no) { return String(no || '').trim().toUpperCase(); }

  /* ---------- 收集所有樁號與來源 ---------- */
  function inventory() {
    var map = {};   /* no -> {suite:n, logs:n, measure:n, photos:n} */

    function bump(no, kind) {
      var k = norm(no);
      if (!k) return;
      if (!map[k]) map[k] = { no: k, suite: 0, logs: 0, measure: 0, photos: 0, total: 0 };
      map[k][kind]++;
      map[k].total++;
    }

    var suite = parse(getRaw(SUITE), null);
    if (suite) {
      var piles = Array.isArray(suite.piles) ? suite.piles : [];
      piles.forEach(function (p) {
        if (!p) return;
        bump(p.pileNo || p.no || p.pile || '', 'suite');
      });
      var logs = Array.isArray(suite.logs) ? suite.logs : [];
      logs.forEach(function (l) {
        if (!l) return;
        var arr = Array.isArray(l.piles) ? l.piles : [];
        if (arr.length) {
          arr.forEach(function (no) { bump(no, 'logs'); });
        } else if (l.pier) {
          /* 舊資料只有 pier，記在墩號上，讓使用者可以改 */
          bump(String(l.pier), 'logs');
        }
      });
    }

    var meas = parse(getRaw(MEASURE), []);
    if (Array.isArray(meas)) {
      meas.forEach(function (r) {
        if (!r) return;
        bump(r.pile || r.pileNo || '', 'measure');
      });
    }

    var hist = parse(getRaw(HIST), []);
    if (Array.isArray(hist)) {
      hist.forEach(function (h) {
        if (!h) return;
        var it = String(h.item || '').trim();
        if (!it) return;
        /* item 可能是「PR4-1」或「工項 PR4-1」或整段文字，抓出裡面的樁號 */
        var m = it.match(/[A-Za-z]{1,8}\d*-[0-9]{1,3}/g);
        if (m) m.forEach(function (x) { bump(x, 'photos'); });
        else if (/^[A-Za-z]{1,8}\d*$/.test(it)) bump(it, 'photos');
      });
    }

    return Object.keys(map).sort(function (a, b) {
      return a.localeCompare(b, 'en', { numeric: true });
    }).map(function (k) { return map[k]; });
  }

  /* ---------- 預覽影響 ---------- */
  function preview(oldNo, newNo) {
    var O = norm(oldNo), N = norm(newNo);
    if (!O) return { ok: false, msg: '請先選擇要修正的樁號' };
    if (!N) return { ok: false, msg: '請輸入新的樁號' };
    if (O === N) return { ok: false, msg: '新舊樁號相同，不需要修改' };
    if (!validNo(N)) return { ok: false, msg: '新樁號格式不對，請用「墩號-數字」，例如 PR4-1' };

    var out = { ok: true, suite: 0, logs: 0, measure: 0, photos: 0, cur: 0, conflicts: [] };

    var suite = parse(getRaw(SUITE), null);
    if (suite) {
      (Array.isArray(suite.piles) ? suite.piles : []).forEach(function (p) {
        if (p && norm(p.pileNo || p.no || p.pile) === O) out.suite++;
      });
      (Array.isArray(suite.logs) ? suite.logs : []).forEach(function (l) {
        if (!l) return;
        (Array.isArray(l.piles) ? l.piles : []).forEach(function (no) {
          if (norm(no) === O) out.logs++;
        });
      });
    }
    var meas = parse(getRaw(MEASURE), []);
    if (Array.isArray(meas)) {
      meas.forEach(function (r) {
        if (r && norm(r.pile || r.pileNo) === O) out.measure++;
      });
    }
    var hist = parse(getRaw(HIST), []);
    if (Array.isArray(hist)) {
      hist.forEach(function (h) {
        if (!h) return;
        var it = String(h.item || '');
        var re = new RegExp('(^|[^A-Za-z0-9-])' + O.replace(/[-]/g, '\\-') + '($|[^0-9])', 'i');
        if (re.test(it) || norm(it) === O) out.photos++;
      });
    }
    var cur = parse(getRaw(CUR), null);
    if (cur) {
      var s = JSON.stringify(cur);
      if (s.indexOf('"' + O + '"') >= 0 || s.indexOf(O) >= 0) out.cur = 1;
    }

    /* 衝突檢查：新樁號已經存在 */
    var inv = inventory();
    var exist = null;
    for (var i = 0; i < inv.length; i++) if (inv[i].no === N) { exist = inv[i]; break; }
    if (exist) out.conflicts.push('新樁號「' + N + '」已經有 ' + exist.total + ' 筆資料');
    return out;
  }

  /* ---------- 執行修改 ---------- */
  function apply(oldNo, newNo) {
    var O = norm(oldNo), N = norm(newNo);
    var pv = preview(O, N);
    if (!pv.ok) return pv;

    /* 先存快照（可復原） */
    var snap = {
      at: new Date().toISOString(),
      from: O, to: N,
      suite: getRaw(SUITE),
      measure: getRaw(MEASURE),
      hist: getRaw(HIST),
      cur: getRaw(CUR)
    };
    setRaw(SNAP, JSON.stringify(snap));

    var res = { ok: true, from: O, to: N, suite: 0, logs: 0, measure: 0, photos: 0, cur: 0 };

    /* 1. 查驗紀錄（suite data） */
    var suite = parse(getRaw(SUITE), null);
    if (suite) {
      var touched = false;
      var piles = Array.isArray(suite.piles) ? suite.piles : null;
      if (piles) {
        piles.forEach(function (p) {
          if (!p) return;
          var curNo = norm(p.pileNo || p.no || p.pile);
          if (curNo === O) {
            if ('pileNo' in p) p.pileNo = N; else if ('no' in p) p.no = N; else p.pile = N;
            p.pier = pierOf(N);
            res.suite++; touched = true;
          }
        });
      }
      (Array.isArray(suite.logs) ? suite.logs : []).forEach(function (l) {
        if (!l) return;
        var arr = Array.isArray(l.piles) ? l.piles : null;
        if (arr) {
          var changed = 0;
          for (var i = 0; i < arr.length; i++) {
            if (norm(arr[i]) === O) { arr[i] = N; changed++; res.logs++; }
          }
          if (changed) {
            touched = true;
            var set = {};
            arr.forEach(function (x) { set[pierOf(x)] = 1; });
            l.piers = Object.keys(set);
            if (l.piers.length === 1) l.pier = l.piers[0];
            else if (l.piers.length > 1) l.pier = l.piers.join('、');
          }
        } else if (norm(l.pier) === O) {
          l.pier = N;
          if (Array.isArray(l.piers)) {
            l.piers = l.piers.map(function (x) { return norm(x) === O ? N : x; });
          }
          res.logs++; touched = true;
        }
      });
      if (touched) setRaw(SUITE, JSON.stringify(suite));
    }

    /* 2. 樁位資料 */
    var meas = parse(getRaw(MEASURE), []);
    if (Array.isArray(meas)) {
      var mTouched = false;
      meas.forEach(function (r) {
        if (!r) return;
        var c = norm(r.pile || r.pileNo);
        if (c === O) {
          if ('pile' in r) r.pile = N;
          if ('pileNo' in r) r.pileNo = N;
          r.pier = pierOf(N);
          res.measure++; mTouched = true;
        }
      });
      if (mTouched) setRaw(MEASURE, JSON.stringify(meas));
    }

    /* 3. 已上傳照片紀錄（item + 檔名） */
    var hist = parse(getRaw(HIST), []);
    if (Array.isArray(hist)) {
      var hTouched = false;
      hist.forEach(function (h) {
        if (!h) return;
        var it = String(h.item || '');
        var hit = false;
        if (it) {
          var re = new RegExp('(^|[^A-Za-z0-9-])(' + O.replace(/[-]/g, '\\-') + ')($|[^0-9])', 'gi');
          var next = it.replace(re, function (m, a, b, c) { return a + N + c; });
          if (next !== it) { h.item = next; hit = true; }
        }
        var nm = String(h.name || '');
        if (nm) {
          var reN = new RegExp('(^|[^A-Za-z0-9-])(' + O.replace(/[-]/g, '\\-') + ')($|[^0-9])', 'gi');
          var nm2 = nm.replace(reN, function (m, a, b, c) { return a + N + c; });
          if (nm2 !== nm) { h.name = nm2; hit = true; }
        }
        if (hit) { res.photos++; hTouched = true; }
      });
      if (hTouched) setRaw(HIST, JSON.stringify(hist));
    }

    /* 4. 目前樁號 / 當日人員紀錄裡的樁號字串 */
    var curRaw = getRaw(CUR);
    if (curRaw) {
      var reC = new RegExp('(^|[^A-Za-z0-9-])(' + O.replace(/[-]/g, '\\-') + ')($|[^0-9])', 'g');
      var nextC = curRaw.replace(reC, function (m, a, b, c) { return a + N + c; });
      if (nextC !== curRaw) { setRaw(CUR, nextC); res.cur = 1; }
    }

    res.snapshotAt = snap.at;
    try {
      global.dispatchEvent(new CustomEvent('pile-renamed', { detail: res }));
    } catch (e) {}
    return res;
  }

  /* ---------- 復原 ---------- */
  function snapshot() { return parse(getRaw(SNAP), null); }

  function restore() {
    var s = snapshot();
    if (!s) return { ok: false, msg: '沒有可復原的樁號修改紀錄' };
    if (s.suite != null) setRaw(SUITE, s.suite);
    if (s.measure != null) setRaw(MEASURE, s.measure);
    if (s.hist != null) setRaw(HIST, s.hist);
    if (s.cur != null) setRaw(CUR, s.cur);
    try { ls().removeItem(SNAP); } catch (e) {}
    try { global.dispatchEvent(new CustomEvent('pile-renamed', { detail: { restored: true } })); } catch (e) {}
    return { ok: true, from: s.from, to: s.to, at: s.at };
  }

  function fmtAt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  /* ---------- UI ---------- */
  var CSS = [
    '.pfx{display:flex;flex-direction:column;gap:10px}',
    '.pfxnote{font-size:12.5px;line-height:1.7;color:#6E6E74}',
    '.pfxnote.ok{color:#1F7A4D;font-weight:700}',
    '.pfxnote.err{color:#B3261E;font-weight:700}',
    '.pfxnote.warn{color:#C47F17;font-weight:700}',
    '.pfxlist{max-height:240px;overflow:auto;border:1px solid #E7ECF2;border-radius:10px;background:#FBFCFE}',
    '.pfxrow{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #EEF2F6;font-size:13px}',
    '.pfxrow:last-child{border-bottom:0}',
    '.pfxrow.on{background:#F1F8F4}',
    '.pfxno{font-weight:700;font-family:ui-monospace,Menlo,monospace;letter-spacing:.02em}',
    '.pfxcnt{margin-left:auto;font-size:11.5px;color:#6E6E74;text-align:right;line-height:1.4}',
    '.pfxempty{padding:16px;text-align:center;color:#8A8F98;font-size:12.5px}',
    '.pfxsel{padding:10px 12px;border:1px solid #DDE4EC;border-radius:10px;background:#fff}',
    '.pfxsel b{font-family:ui-monospace,Menlo,monospace}',
    '.pfxinput{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.pfxinput input{flex:1;min-width:120px;padding:10px 11px;border:1px solid #DDE4EC;border-radius:9px;font-size:15px;font-family:ui-monospace,Menlo,monospace;text-transform:uppercase}',
    '.pfxbtns{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media(max-width:380px){.pfxbtns{grid-template-columns:1fr}}'
  ].join('');

  function mount(el) {
    var node = (typeof el === 'string') ? document.getElementById(el) : el;
    if (!node || node.getAttribute('data-pfx') === '1') return null;
    node.setAttribute('data-pfx', '1');

    if (!document.getElementById('pfx-style')) {
      var s = document.createElement('style');
      s.id = 'pfx-style'; s.textContent = CSS;
      document.head.appendChild(s);
    }

    node.innerHTML = [
      '<div class="pfx">',
      '  <div class="pfxnote">樁號若記錯，選一個樁號 → 輸入正確樁號 → 按「確認修正」，',
      '    查驗紀錄、樁位資料、已上傳照片紀錄會一起改成正確樁號。</div>',
      '  <div class="pfxlist" id="pfxList"></div>',
      '  <div class="pfxsel" id="pfxSel" style="display:none">',
      '    <div style="margin-bottom:8px">已選：<b id="pfxOld"></b></div>',
      '    <div class="pfxinput">',
      '      <input type="text" id="pfxNew" placeholder="例：PR4-1" autocomplete="off" spellcheck="false">',
      '      <button type="button" class="btn ghost sm" id="pfxCheck">預覽影響</button>',
      '    </div>',
      '  </div>',
      '  <div class="pfxnote" id="pfxMsg"></div>',
      '  <div class="pfxbtns">',
      '    <button type="button" class="btn" id="pfxGo" disabled>✔ 確認修正</button>',
      '    <button type="button" class="btn ghost" id="pfxUndo" disabled>↩ 復原上次修正</button>',
      '  </div>',
      '</div>'
    ].join('');

    var listEl = node.querySelector('#pfxList');
    var selEl = node.querySelector('#pfxSel');
    var oldEl = node.querySelector('#pfxOld');
    var newEl = node.querySelector('#pfxNew');
    var msg = node.querySelector('#pfxMsg');
    var bGo = node.querySelector('#pfxGo');
    var bUndo = node.querySelector('#pfxUndo');
    var bCheck = node.querySelector('#pfxCheck');
    var picked = '';
    var lastPreview = null;

    function say(t, kind) {
      if (!msg) return;
      msg.textContent = t || '';
      msg.className = 'pfxnote' + (kind ? ' ' + kind : '');
    }
    function toast(t, bad) {
      var C = global.Core;
      if (C && C.makeToast) {
        if (!node.__t) node.__t = C.makeToast('toast', 3000);
        node.__t(t, bad);
      }
    }

    function paintList() {
      var inv = inventory();
      if (!inv.length) {
        listEl.innerHTML = '<div class="pfxempty">目前沒有任何樁號紀錄</div>';
        return;
      }
      var html = '';
      inv.forEach(function (it) {
        var bits = [];
        if (it.suite) bits.push('進度 ' + it.suite);
        if (it.logs) bits.push('查驗 ' + it.logs);
        if (it.measure) bits.push('樁位 ' + it.measure);
        if (it.photos) bits.push('照片 ' + it.photos);
        html += '<div class="pfxrow' + (it.no === picked ? ' on' : '') + '" data-no="' + esc(it.no) + '">' +
          '<span class="pfxno">' + esc(it.no) + '</span>' +
          '<span class="pfxcnt">' + bits.join('　') + '</span></div>';
      });
      listEl.innerHTML = html;
    }

    function refreshUndo() {
      var s = snapshot();
      if (bUndo) bUndo.disabled = !s;
      if (s) {
        var el = node.querySelector('#pfxUndo');
        if (el) el.title = '復原 ' + s.from + ' → ' + s.to + '（' + fmtAt(s.at) + '）';
      }
    }

    if (listEl) listEl.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.pfxrow') : null;
      if (!row) return;
      picked = row.getAttribute('data-no');
      oldEl.textContent = picked;
      selEl.style.display = '';
      if (newEl) { newEl.value = ''; newEl.focus(); }
      lastPreview = null;
      bGo.disabled = true;
      say('已選「' + picked + '」，請輸入正確樁號後按「預覽影響」。');
      paintList();
    });

    function doPreview() {
      if (!picked) return;
      var nv = (newEl.value || '').trim();
      if (!nv) { say('請先輸入新樁號。', 'warn'); bGo.disabled = true; return; }
      var pv = preview(picked, nv);
      lastPreview = pv;
      if (!pv.ok) { say(pv.msg, 'err'); bGo.disabled = true; return; }
      var parts = [];
      if (pv.suite) parts.push('進度表 ' + pv.suite + ' 筆');
      if (pv.logs) parts.push('查驗紀錄 ' + pv.logs + ' 筆');
      if (pv.measure) parts.push('樁位資料 ' + pv.measure + ' 筆');
      if (pv.photos) parts.push('照片紀錄 ' + pv.photos + ' 筆');
      if (pv.cur) parts.push('目前樁號 1 處');
      var total = pv.suite + pv.logs + pv.measure + pv.photos + pv.cur;
      var t = total ? ('會修改 ' + total + ' 處：' + parts.join('、')) : '找不到引用「' + picked + '」的資料';
      if (pv.conflicts.length) {
        say(t + '。\n注意：' + pv.conflicts.join('；') + '。修正後可能會有兩筆相同樁號。', 'warn');
      } else {
        say(t + '。按「確認修正」才會真的改。', total ? 'ok' : 'warn');
      }
      bGo.disabled = !total;
    }

    if (bCheck) bCheck.addEventListener('click', doPreview);
    if (newEl) {
      newEl.addEventListener('input', function () { lastPreview = null; bGo.disabled = true; });
      newEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doPreview(); } });
    }

    if (bGo) bGo.addEventListener('click', function () {
      if (!picked || !lastPreview || !lastPreview.ok) return;
      var nv = (newEl.value || '').trim();
      if (!global.confirm('要把「' + picked + '」全部改成「' + nv + '」嗎？\n\n' +
        '會一併更新查驗紀錄、樁位資料、已上傳照片紀錄。\n改完可以用「復原上次修正」退回。')) return;
      var r = apply(picked, nv);
      if (!r.ok) { say(r.msg, 'err'); return; }
      var parts = [];
      if (r.suite) parts.push('進度 ' + r.suite);
      if (r.logs) parts.push('查驗 ' + r.logs);
      if (r.measure) parts.push('樁位 ' + r.measure);
      if (r.photos) parts.push('照片 ' + r.photos);
      if (r.cur) parts.push('目前樁號 1');
      say('已把「' + r.from + '」改成「' + r.to + '」（' + (parts.join('、') || '無變更') + '）。', 'ok');
      toast('樁號已修正：' + r.from + ' → ' + r.to);
      picked = '';
      selEl.style.display = 'none';
      if (newEl) newEl.value = '';
      lastPreview = null;
      bGo.disabled = true;
      paintList();
      refreshUndo();
      try { if (global.__pmHandle && global.__pmHandle.render) global.__pmHandle.render(); } catch (e) {}
      setTimeout(function () { try { global.location.reload(); } catch (e) {} }, 1200);
    });

    if (bUndo) bUndo.addEventListener('click', function () {
      var s = snapshot();
      if (!s) { say('沒有可復原的紀錄。', 'warn'); return; }
      if (!global.confirm('要復原「' + s.from + ' → ' + s.to + '」這次修改嗎？\n（' + fmtAt(s.at) + '）')) return;
      var r = restore();
      if (!r.ok) { say(r.msg, 'err'); return; }
      say('已復原：' + r.to + ' 改回 ' + r.from + '。', 'ok');
      toast('已復原樁號修改');
      paintList();
      refreshUndo();
      setTimeout(function () { try { global.location.reload(); } catch (e) {} }, 1000);
    });

    paintList();
    refreshUndo();
    return { refresh: function () { paintList(); refreshUndo(); } };
  }

  global.PileFix = {
    inventory: inventory,
    preview: preview,
    apply: apply,
    restore: restore,
    snapshot: snapshot,
    mount: mount
  };
})(typeof window !== 'undefined' ? window : this);
