/* mat-side.js — 材料岸別自動歸類（未分類 → 右岸）
 *
 * 用途：既有水泥／濕細沙紀錄若沒有岸別（side 為空），一律歸到「右岸」。
 * 在資料進度頁載入時自動檢查一次；也可以在「材料管控」卡片按按鈕手動執行。
 *
 * 只改 side 欄位，不動數量、日期、備註。
 * 執行前會保留一份快照（inspection-mat-side-snapshot），可按「復原」退回。
 */
(function (global) {
  'use strict';

  var KEY = 'inspection-materials-v1';
  var SNAP = 'inspection-mat-side-snapshot';
  var DONE = 'inspection-mat-side-migrated-v1';
  var TARGET = '右岸';

  function ls() { return global.localStorage; }
  function getRaw(k) { try { return ls().getItem(k); } catch (e) { return null; } }
  function setRaw(k, v) { try { ls().setItem(k, v); return true; } catch (e) { return false; } }
  function parse(raw, d) {
    if (!raw) return d;
    try { var o = JSON.parse(raw); return o == null ? d : o; } catch (e) { return d; }
  }

  /* 找出所有「沒有岸別」的水泥／濕細沙紀錄 */
  function findEmpty(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    list.forEach(function (r) {
      if (!r) return;
      var s = String(r.side || r.sideOf || '').trim();
      var kind = String(r.kind || r.type || r.mat || '');
      var isCement = /水泥|cement/i.test(kind);
      var isSand = /濕細沙|濕細砂|細砂|細沙|sand/i.test(kind);
      /* 若沒有 kind 欄位，只要沒有岸別也要歸類（材料紀錄本來就只有水泥與濕細沙） */
      if (!s && (isCement || isSand || !kind)) out.push(r);
    });
    return out;
  }

  function inventory() {
    var list = parse(getRaw(KEY), []);
    var all = Array.isArray(list) ? list : [];
    var empty = findEmpty(all);
    var counts = { cement: 0, sand: 0, other: 0 };
    empty.forEach(function (r) {
      var kind = String(r.kind || r.type || r.mat || '');
      if (/水泥|cement/i.test(kind)) counts.cement++;
      else if (/濕細沙|濕細砂|細砂|細沙|sand/i.test(kind)) counts.sand++;
      else counts.other++;
    });
    return { total: all.length, empty: empty.length, counts: counts };
  }

  function run(opts) {
    opts = opts || {};
    var list = parse(getRaw(KEY), []);
    if (!Array.isArray(list)) return { ok: false, msg: '沒有材料資料' };
    var empty = findEmpty(list);
    if (!empty.length) {
      setRaw(DONE, '1');
      return { ok: true, changed: 0, msg: '所有材料都已經有岸別，不需要歸類' };
    }

    /* 保留快照（可復原） */
    setRaw(SNAP, JSON.stringify({ at: new Date().toISOString(), data: getRaw(KEY), target: TARGET }));

    var changed = 0;
    for (var i = 0; i < empty.length; i++) {
      var r = empty[i];
      if ('side' in r || !('sideOf' in r)) r.side = TARGET;
      else r.sideOf = TARGET;
      changed++;
    }
    if (!setRaw(KEY, JSON.stringify(list))) {
      return { ok: false, msg: '寫入失敗（可能是隱私模式或空間已滿）' };
    }
    setRaw(DONE, '1');

    try {
      global.dispatchEvent(new CustomEvent('material-side-migrated', {
        detail: { changed: changed, target: TARGET }
      }));
    } catch (e) {}

    return { ok: true, changed: changed, msg: '已把 ' + changed + ' 筆未分類的材料歸到「' + TARGET + '」' };
  }

  function snapshot() { return parse(getRaw(SNAP), null); }

  function restore() {
    var s = snapshot();
    if (!s || s.data == null) return { ok: false, msg: '沒有可復原的紀錄' };
    if (!setRaw(KEY, s.data)) return { ok: false, msg: '復原寫入失敗' };
    try { ls().removeItem(SNAP); } catch (e) {}
    try { ls().removeItem(DONE); } catch (e) {}
    try { global.dispatchEvent(new CustomEvent('material-side-migrated', { detail: { restored: true } })); } catch (e) {}
    return { ok: true };
  }

  function fmtAt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* 第一次進入時自動歸類（只做一次，之後不再重複動資料） */
  function autoRunOnce() {
    if (getRaw(DONE) === '1') return null;
    var inv = inventory();
    if (!inv.empty) { setRaw(DONE, '1'); return null; }
    return run();
  }

  /* ---------- UI（材料管控卡片內的小工具列） ---------- */
  function mount(el) {
    var node = (typeof el === 'string') ? document.getElementById(el) : el;
    if (!node || node.getAttribute('data-mside') === '1') return null;
    node.setAttribute('data-mside', '1');

    if (!document.getElementById('mside-style')) {
      var st = document.createElement('style');
      st.id = 'mside-style';
      st.textContent = [
        '.mside{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;',
        'border:1px solid #DDE4EC;border-radius:10px;background:#FBFCFE;font-size:12.5px;line-height:1.6;color:#4A5056}',
        '.mside b{color:#1F7A4D}',
        '.mside .sp{margin-left:auto}',
        '.mside button{font-size:12px;padding:7px 11px;border-radius:8px;border:1px solid #DDE4EC;background:#fff;cursor:pointer}',
        '.mside button.main{background:#1F7A4D;color:#fff;border-color:#1F7A4D;font-weight:700}',
        '.mside button:disabled{opacity:.45;cursor:default}'
      ].join('');
      document.head.appendChild(st);
    }

    function paint() {
      var inv = inventory();
      var snap = snapshot();
      var bits = [];
      if (inv.counts.cement) bits.push('水泥 ' + inv.counts.cement);
      if (inv.counts.sand) bits.push('濕細沙 ' + inv.counts.sand);
      if (inv.counts.other) bits.push('其他 ' + inv.counts.other);

      var html = '<div class="mside">';
      if (inv.empty) {
        html += '<span>還有 <b>' + inv.empty + '</b> 筆未標岸別' +
          (bits.length ? '（' + bits.join('、') + '）' : '') + '</span>';
        html += '<span class="sp"></span>';
        html += '<button type="button" class="main" data-act="run">全部歸到右岸</button>';
      } else {
        html += '<span>所有材料都已標岸別 ✅</span>';
      }
      if (snap) {
        html += '<button type="button" data-act="undo" title="復原 ' + fmtAt(snap.at) + '">↩ 復原歸類</button>';
      }
      html += '</div>';
      node.innerHTML = html;

      var btnRun = node.querySelector('[data-act="run"]');
      if (btnRun) btnRun.addEventListener('click', function () {
        var r = run();
        if (!r.ok) { alert(r.msg); return; }
        global.alert(r.msg + '。');
        paint();
        try { global.location.reload(); } catch (e) {}
      });
      var btnUndo = node.querySelector('[data-act="undo"]');
      if (btnUndo) btnUndo.addEventListener('click', function () {
        var s = snapshot();
        if (!global.confirm('要復原 ' + fmtAt(s.at) + ' 的岸別歸類嗎？')) return;
        var r = restore();
        if (!r.ok) { alert(r.msg); return; }
        paint();
        try { global.location.reload(); } catch (e) {}
      });
    }

    paint();
    return { refresh: paint };
  }

  global.MatSide = {
    inventory: inventory,
    run: run,
    restore: restore,
    snapshot: snapshot,
    autoRunOnce: autoRunOnce,
    mount: mount,
    TARGET: TARGET
  };
})(typeof window !== 'undefined' ? window : this);
