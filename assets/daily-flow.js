/*!
 * daily-flow.js — 當日查驗流程（人員固定 → 逐樁紀錄 → 完成寫入紀錄表）
 *
 * 流程：
 *   1. 今日查驗卡：日期＋查驗人員＋監造人員，只問一次，問過就固定（存在本機）
 *   2. 目前樁號：一支一支做，選好後同步「設定歸檔資料」與「樁位資料表」
 *   3. 完成今日查驗：把當日每支樁號寫進紀錄表的「查驗位置」
 *
 * 對外：
 *   window.DailyFlow.mountDaily(el)    今日查驗卡
 *   window.DailyFlow.mountRecords(el)  查驗紀錄表（新增＋已累積）
 *   window.DailyFlow.staff()           目前固定的人員
 *   window.DailyFlow.currentPile()     目前樁號
 *   window.DailyFlow.finishDay()       完成今日查驗
 */
(function (global) {
  'use strict';

  var C = global.Core;
  if (!C) return;

  var $ = C.$, esc = C.esc, on = C.on;
  var todayISO = C.todayISO, isoToSlash = C.isoToSlash;

  var STAFF_KEY = 'inspection-daily-staff-v1';
  var CUR_KEY = 'inspection-daily-current-v1';
  var HIST_KEY = 'inspection-drive-photo-history';

  /* ---------------- 小工具 ---------------- */

  function toast(msg, isErr) {
    var t = $('toast');
    if (!t) { try { console.log(msg); } catch (e) {} return; }
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.className = 'toast'; }, 3400);
  }

  function S() { return global.SuiteStore || null; }

  function pierOfPile(no) {
    var m = String(no || '').match(/^(.+?)-\d+$/);
    return m ? m[1] : '';
  }

  function uniq(arr) {
    var out = [], seen = {};
    (arr || []).forEach(function (v) {
      var s = String(v == null ? '' : v).trim();
      if (!s || seen[s]) return;
      seen[s] = 1; out.push(s);
    });
    return out;
  }

  function sortPiles(list) {
    function key(s) {
      var m = String(s || '').match(/^(.*?)-(\d+)$/);
      return m ? [m[1], parseInt(m[2], 10)] : [String(s || ''), 0];
    }
    return list.slice().sort(function (a, b) {
      var ka = key(a), kb = key(b);
      if (ka[0] !== kb[0]) {
        var na = parseInt(String(ka[0]).replace(/\D/g, ''), 10);
        var nb = parseInt(String(kb[0]).replace(/\D/g, ''), 10);
        if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
        return String(ka[0]).localeCompare(String(kb[0]));
      }
      return ka[1] - kb[1];
    });
  }

  function inspectors() {
    var LB = global.LogBuilder || {};
    return LB.INSPECTORS || ['乘恩', '順昔', '火木', '佩璇'];
  }
  function supervisors() {
    var LB = global.LogBuilder || {};
    return LB.SUPERVISORS || ['振源', '旭程', '慧欣'];
  }

  function fillSelect(sel, list, placeholder) {
    if (!sel) return;
    sel.innerHTML = '';
    var o0 = document.createElement('option');
    o0.value = ''; o0.textContent = placeholder || '— 請選擇 —';
    sel.appendChild(o0);
    list.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }

  /* ---------------- 資料層 ---------------- */

  function staffLoad() {
    var o = C.store.getJSON(STAFF_KEY, null);
    if (!o || typeof o !== 'object') return { date: '', inspector: '', supervisor: '' };
    return {
      date: String(o.date || ''),
      inspector: String(o.inspector || ''),
      supervisor: String(o.supervisor || '')
    };
  }
  function staffSave(o) {
    C.store.setJSON(STAFF_KEY, o);
    try { window.dispatchEvent(new CustomEvent('daily-staff-changed', { detail: o })); } catch (e) {}
  }

  function curLoad() {
    var o = C.store.getJSON(CUR_KEY, null);
    if (!o || typeof o !== 'object') return { date: '', pier: '', pile: '' };
    return {
      date: String(o.date || ''),
      pier: String(o.pier || ''),
      pile: String(o.pile || '')
    };
  }
  function curSave(o) { C.store.setJSON(CUR_KEY, o); }

  /** 當日已固定的人員（只有日期相符才算固定） */
  function staffFor(dateISO) {
    var s = staffLoad();
    if (!dateISO || s.date !== dateISO) return { date: dateISO, inspector: '', supervisor: '', fixed: false };
    return { date: s.date, inspector: s.inspector, supervisor: s.supervisor, fixed: !!(s.inspector && s.supervisor) };
  }

  function currentPile() {
    var c = curLoad();
    return c.pile || '';
  }

  /* ---------------- 紀錄表資料 ---------------- */

  function readLogs() {
    var s = S();
    if (!s) return [];
    try {
      var d = s.load();
      return (d.logs || []).map(function (r) {
        return {
          id: String(r.id || ''),
          date: String(r.date || ''),
          inspector: String(r.inspector || ''),
          supervisor: String(r.supervisor || ''),
          location: String(r.location || ''),
          piers: (r.piers || []).slice(),
          piles: (r.piles || []).slice()
        };
      });
    } catch (e) { return []; }
  }

  function writeLogs(rows) {
    var s = S();
    if (!s) return false;
    try {
      var d = s.load();
      d.logs = rows.map(function (r) {
        return {
          id: r.id || s.uid(),
          date: r.date || '',
          inspector: r.inspector || '',
          supervisor: r.supervisor || '',
          location: r.location || '',
          pier: (r.piers && r.piers[0]) || '',
          piers: (r.piers || []).slice(),
          piles: (r.piles || []).slice()
        };
      });
      s.recompute(d);
      s.save(d);
      s.invalidate && s.invalidate();
      return true;
    } catch (e) { return false; }
  }

  /** 當日有紀錄的樁號（樁位資料表 ＋ 已上傳照片） */
  function pilesOfDay(dateISO) {
    var out = [];
    try {
      var PM = global.PileMeasure;
      if (PM && PM.rows) {
        PM.rows().forEach(function (r) {
          if (String(r.date || '') === String(dateISO) && r.pile) out.push(r.pile);
        });
      }
    } catch (e) {}
    try {
      var hist = C.store.getJSON(HIST_KEY, []);
      if (Array.isArray(hist)) {
        hist.forEach(function (h) {
          if (!h) return;
          if (String(h.date || '') !== String(dateISO)) return;
          var it = String(h.item || '').trim();
          if (it) out.push(it);
        });
      }
    } catch (e) {}
    return sortPiles(uniq(out));
  }

  /* ---------------- 樣式 ---------------- */

  function injectCss() {
    if ($('dfCss')) return;
    var st = document.createElement('style');
    st.id = 'dfCss';
    st.textContent = [
      '.df-wrap{font-size:14px}',
      '.df-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}',
      '.df-grid .full{grid-column:1/-1}',
      '.df-fld{display:flex;flex-direction:column;gap:5px}',
      '.df-fld>span{font-size:12.5px;font-weight:600;color:#3a3a3e}',
      '.df-fld>span .h{font-weight:400;color:#6e6e74;font-size:11.5px;margin-left:5px}',
      '.df-fld input,.df-fld select{width:100%;padding:9px 11px;font-size:14px;border:1px solid #dcd8d4;',
      '  border-radius:7px;background:#fcfbfa;color:#1b1b1d;font-family:inherit;line-height:1.5}',
      '.df-fld input:focus,.df-fld select:focus{outline:none;border-color:#6b4443;background:#fff;',
      '  box-shadow:0 0 0 3px rgba(122,79,78,.12)}',
      '.df-fld input[readonly]{background:#f2f0ed;color:#6b4443;font-weight:700}',
      '.df-pick{display:flex;gap:7px}',
      '.df-pick select{flex:1;min-width:0}',
      '.df-lock{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:12px;',
      '  background:#f2f7f3;border:1px solid #d3ded5;border-radius:9px;padding:11px 13px;font-size:13px;color:#2f4a35}',
      '.df-lock b{color:#1f3a26}',
      '.df-lock .sp{margin-left:auto}',
      '.df-btn{font-family:inherit;font-size:13.5px;font-weight:600;padding:10px 16px;border-radius:8px;',
      '  border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;',
      '  justify-content:center;gap:7px;transition:.15s}',
      '.df-btn.primary{background:#7a4f4e;color:#fff}',
      '.df-btn.primary:hover{background:#6b4443}',
      '.df-btn.ghost{background:#fff;color:#3a3a3e;border-color:#dcd8d4}',
      '.df-btn.ghost:hover{background:#f6f4f2}',
      '.df-btn.done{background:#15803d;color:#fff}',
      '.df-btn.done:hover{background:#126b33}',
      '.df-btn.sm{font-size:12px;padding:6px 11px;border-radius:6px}',
      '.df-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.df-row{display:flex;gap:8px;margin-top:13px;flex-wrap:wrap}',
      '.df-cur{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;',
      '  background:#f9f4f3;border:1px solid #e3d2d0;border-radius:9px;padding:11px 13px;font-size:13px}',
      '.df-cur b{font-size:15px;color:#6b4443}',
      '.df-cur .sp{margin-left:auto}',
      '.df-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}',
      '.df-chip{font-size:12px;font-weight:700;background:#fff;border:1px solid #dcd8d4;color:#3a3a3e;',
      '  border-radius:20px;padding:4px 11px;cursor:pointer;font-family:inherit}',
      '.df-chip:hover{background:#f6edec;border-color:#6b4443;color:#6b4443}',
      '.df-chip.on{background:#7a4f4e;border-color:#7a4f4e;color:#fff}',
      '.df-tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #dcd8d4;',
      '  border-radius:8px;margin-top:14px}',
      'table.df-rec{width:100%;border-collapse:collapse;min-width:620px}',
      'table.df-rec th{background:#f2f0ed;color:#3a3a3e;font-size:12px;font-weight:700;',
      '  padding:8px;text-align:left;border-bottom:1px solid #dcd8d4;white-space:nowrap}',
      'table.df-rec td{padding:7px 8px;border-bottom:1px solid #eae7e3;font-size:13px;vertical-align:top}',
      'table.df-rec tr:last-child td{border-bottom:none}',
      'table.df-rec tr:hover td{background:#fbfaf9}',
      'table.df-rec .seq{font-weight:700;color:#5f5f66;font-size:12.5px;width:44px;text-align:center}',
      'table.df-rec .loc{font-weight:700;color:#6b4443}',
      'table.df-rec .c{text-align:center}',
      'table.df-rec .del{background:none;border:none;color:#a34a45;cursor:pointer;font-size:16px;',
      '  line-height:1;padding:3px 7px;border-radius:5px}',
      'table.df-rec .del:hover{background:#f8edec}',
      'table.df-rec .daytag{display:inline-block;margin-left:6px;font-size:10px;font-weight:700;',
      '  color:#5f7a63;background:rgba(21,128,61,.12);border-radius:20px;padding:0 6px}',
      '.df-empty{text-align:center;padding:24px 12px;color:#6e6e74;font-size:13px}',
      '.df-note{font-size:12px;color:#6e6e74;line-height:1.7;margin-top:12px;background:#f8f6f4;',
      '  border:1px solid #eae7e3;border-radius:8px;padding:11px 13px}',
      '.df-note b{color:#3a3a3e}',
      '@media (max-width:760px){.df-grid{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------- 今日查驗卡 ---------------- */

  function mountDaily(el) {
    if (!el) return null;
    injectCss();

    el.innerHTML = [
      '<div class="df-wrap">',
      '  <div class="df-grid">',
      '    <label class="df-fld"><span>查驗日期 <span class="h">yyyy/mm/dd</span></span>',
      '      <input type="date" id="dfDate"></label>',
      '    <label class="df-fld"><span>查驗人員 <span class="h">當日只問一次</span></span>',
      '      <select id="dfInspector"></select></label>',
      '    <label class="df-fld"><span>監造人員 <span class="h">當日只問一次</span></span>',
      '      <select id="dfSupervisor"></select></label>',
      '    <label class="df-fld"><span>目前樁號 <span class="h">一支一支做</span></span>',
      '      <div class="df-pick"><select id="dfPier"></select><select id="dfPile" disabled></select></div></label>',
      '  </div>',
      '  <div class="df-lock" id="dfLock" style="display:none"></div>',
      '  <div class="df-cur" id="dfCur" style="display:none"></div>',
      '  <div class="df-chips" id="dfChips"></div>',
      '  <div class="df-row">',
      '    <button type="button" class="df-btn primary" id="dfStart">開始今日查驗</button>',
      '    <button type="button" class="df-btn done" id="dfFinish">✓ 完成今日查驗</button>',
      '    <button type="button" class="df-btn ghost" id="dfUnlock" style="display:none">更改人員</button>',
      '  </div>',
      '  <div class="df-note">',
      '    <b>流程：</b>① 先確認今日查驗人員與監造人員（問過就固定，之後不用再問）',
      '    → ② 選一支樁號，拍照歸檔並記錄樁位資料（一支一支做）',
      '    → ③ 當日結束按「完成今日查驗」，系統會把當日每支樁號自動寫進紀錄表的「查驗位置」。',
      '  </div>',
      '</div>'
    ].join('\n');

    fillSelect($('dfInspector'), inspectors(), '— 請選擇 —');
    fillSelect($('dfSupervisor'), supervisors(), '— 請選擇 —');
    fillSelect($('dfPier'), (S() && S().pierList) ? S().pierList() : [], '— 選擇墩號 —');

    var dateEl = $('dfDate');
    var insEl = $('dfInspector');
    var supEl = $('dfSupervisor');
    var pierEl = $('dfPier');
    var pileEl = $('dfPile');

    dateEl.value = todayISO();

    function refreshPile() {
      var pier = pierEl.value, prev = pileEl.value;
      pileEl.innerHTML = '';
      if (!pier) {
        pileEl.disabled = true;
        var o = document.createElement('option');
        o.value = ''; o.textContent = '— 請先選墩號 —';
        pileEl.appendChild(o);
        return;
      }
      var nos = (S() && S().pileNosOf) ? S().pileNosOf(S().load(), pier) : [];
      var o0 = document.createElement('option');
      o0.value = ''; o0.textContent = '— 選擇樁號 —';
      pileEl.appendChild(o0);
      nos.forEach(function (no) {
        var op = document.createElement('option');
        op.value = no; op.textContent = no;
        pileEl.appendChild(op);
      });
      pileEl.disabled = !nos.length;
      if (prev && nos.indexOf(prev) >= 0) pileEl.value = prev;
    }

    /* 同步「設定歸檔資料」的樁號：只補上目前樁號，不重建整個清單
       （清單由 drive-v2.js 的 buildStations() 依日期維護，重建會互搶） */
    function syncStation(pile) {
      var sel = $('fStation');
      if (!sel || !pile) return;
      var found = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === pile) { found = true; break; }
      }
      if (!found) {
        var op = document.createElement('option');
        op.value = pile; op.textContent = pile;
        sel.appendChild(op);
      }
      sel.disabled = false;
      sel.value = pile;
      try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }

    function paintLock() {
      var d = dateEl.value;
      var st = staffFor(d);
      var lock = $('dfLock'), cur = $('dfCur'), chips = $('dfChips');
      var startBtn = $('dfStart'), unlockBtn = $('dfUnlock');

      if (st.fixed) {
        insEl.value = st.inspector;
        supEl.value = st.supervisor;
        insEl.setAttribute('readonly', 'readonly');
        insEl.disabled = true;
        supEl.disabled = true;
        lock.style.display = 'flex';
        lock.innerHTML = '<span>✓ 今日人員已固定：<b>' + esc(st.inspector) + '</b>（查驗）／<b>' +
          esc(st.supervisor) + '</b>（監造）</span><span class="sp"></span>' +
          '<span style="font-size:12px;color:#5f7a63">' + esc(isoToSlash(d)) + '</span>';
        startBtn.style.display = 'none';
        unlockBtn.style.display = '';
      } else {
        insEl.disabled = false;
        supEl.disabled = false;
        lock.style.display = 'none';
        startBtn.style.display = '';
        unlockBtn.style.display = 'none';
      }

      /* 目前樁號 */
      var c = curLoad();
      var pile = (c.date === d) ? c.pile : '';
      if (pile) {
        cur.style.display = 'flex';
        cur.innerHTML = '<span>目前樁號</span><b>' + esc(pile) + '</b>' +
          '<span class="sp"></span><span style="font-size:12px;color:#6e6e74">' +
          esc(isoToSlash(d)) + '　·　拍照歸檔與樁位資料表都會用這支</span>';
      } else {
        cur.style.display = 'none';
      }

      /* 當日已做的樁號 */
      var done = pilesOfDay(d);
      chips.innerHTML = '';
      if (done.length) {
        var lab = document.createElement('span');
        lab.style.cssText = 'font-size:12px;color:#6e6e74;align-self:center;margin-right:2px';
        lab.textContent = '當日已做 ' + done.length + ' 支：';
        chips.appendChild(lab);
        done.forEach(function (no) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'df-chip' + (no === pile ? ' on' : '');
          b.textContent = no;
          b.addEventListener('click', function () {
            setPile(no);
          });
          chips.appendChild(b);
        });
      }
    }

    function setPile(pile) {
      var d = dateEl.value;
      curSave({ date: d, pier: pierOfPile(pile), pile: pile });
      pierEl.value = pierOfPile(pile);
      refreshPile();
      pileEl.value = pile;
      syncStation(pile);
      paintLock();
      /* 樁位資料表同步 */
      var pmPier = $('pmPier'), pmPile = $('pmPile');
      if (pmPier && pmPile) {
        pmPier.value = pierOfPile(pile);
        try { pmPier.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
        pmPile.value = pile;
      }
      /* 讓「設定歸檔資料」的樁號清單把這支納入 */
      try { if (global.__driveStationsRefresh) global.__driveStationsRefresh(); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('daily-staff-changed', { detail: staffLoad() })); } catch (e) {}
    }

    dateEl.addEventListener('change', function () {
      refreshPile();
      paintLock();
      var c = curLoad();
      if (c.date === dateEl.value && c.pile) syncStation(c.pile);
    });

    pierEl.addEventListener('change', function () { refreshPile(); pileEl.value = ''; });

    pileEl.addEventListener('change', function () {
      var pile = pileEl.value;
      if (!pile) return;
      setPile(pile);
      toast('目前樁號：' + pile + '（拍照歸檔與樁位資料表已同步）');
    });

    $('dfStart').addEventListener('click', function () {
      var d = dateEl.value;
      var ins = insEl.value, sup = supEl.value;
      if (!d) { toast('請選擇查驗日期', true); dateEl.focus(); return; }
      if (!ins) { toast('請選擇查驗人員', true); insEl.focus(); return; }
      if (!sup) { toast('請選擇監造人員', true); supEl.focus(); return; }
      staffSave({ date: d, inspector: ins, supervisor: sup });
      paintLock();
      toast('今日人員已固定：' + ins + '（查驗）／' + sup + '（監造），之後不用再問');
    });

    $('dfUnlock').addEventListener('click', function () {
      if (!window.confirm('要更改今日的查驗人員／監造人員嗎？')) return;
      staffSave({ date: '', inspector: '', supervisor: '' });
      paintLock();
      toast('已解除固定，請重新選擇人員');
    });

    $('dfFinish').addEventListener('click', function () { finishDay(); });

    refreshPile();
    paintLock();
    global.DailyFlow._dailyRefresh = paintLock;

    /* 其他頁面改動時同步 */
    window.addEventListener('storage', function (e) {
      if (e.key === STAFF_KEY || e.key === CUR_KEY || e.key === HIST_KEY) paintLock();
    });

    return { refresh: paintLock, setPile: setPile };
  }

  /* ---------------- 完成今日查驗 ---------------- */

  function finishDay() {
    var dateEl = $('dfDate');
    var d = dateEl ? dateEl.value : todayISO();
    if (!d) { toast('請先選擇查驗日期', true); return; }

    var st = staffFor(d);
    if (!st.fixed) {
      toast('請先按「開始今日查驗」固定今日人員', true);
      return;
    }

    var piles = pilesOfDay(d);
    if (!piles.length) {
      toast('當日還沒有任何樁號紀錄（樁位資料表或已上傳照片），無法完成', true);
      return;
    }

    var rows = readLogs();
    var id = 'day-' + d;
    var target = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id) { target = rows[i]; break; }
    }

    var loc = piles.join('、');
    if (target) {
      target.date = d;
      target.inspector = st.inspector;
      target.supervisor = st.supervisor;
      target.piles = piles;
      target.piers = uniq(piles.map(pierOfPile));
      target.location = loc;
    } else {
      rows.push({
        id: id, date: d, inspector: st.inspector, supervisor: st.supervisor,
        location: loc, piles: piles, piers: uniq(piles.map(pierOfPile))
      });
    }

    if (!writeLogs(rows)) { toast('寫入紀錄表失敗（本機儲存空間可能已滿）', true); return; }

    toast('已完成今日查驗：' + piles.length + ' 支樁號已寫入紀錄表的「查驗位置」');
    try { if (global.DailyFlow && global.DailyFlow._recRefresh) global.DailyFlow._recRefresh(); } catch (e) {}
    try { if (global.PileMeasure) { /* 進度頁查詢會自己重讀 */ } } catch (e) {}
    var el = $('dfLock');
    if (el) {
      el.style.display = 'flex';
      el.innerHTML = '<span>✓ 今日查驗已完成：<b>' + piles.length + '</b> 支樁號已寫入紀錄表</span>' +
        '<span class="sp"></span><span style="font-size:12px;color:#5f7a63">' + esc(isoToSlash(d)) + '</span>';
    }
  }

  /* ---------------- 查驗紀錄表 ---------------- */

  function mountRecords(el) {
    if (!el) return null;
    injectCss();

    el.innerHTML = [
      '<div class="df-wrap">',
      '  <div class="df-grid">',
      '    <label class="df-fld"><span>查驗日期 <span class="h">yyyy/mm/dd</span></span>',
      '      <input type="date" id="dfrDate"></label>',
      '    <label class="df-fld"><span>查驗人員</span><select id="dfrInspector"></select></label>',
      '    <label class="df-fld"><span>監造人員</span><select id="dfrSupervisor"></select></label>',
      '    <label class="df-fld"><span>查驗位置 <span class="h">樁號自動併入</span></span>',
      '      <div class="df-pick"><select id="dfrPier"></select><select id="dfrPile" disabled></select></div></label>',
      '    <label class="df-fld full"><span>補充說明 <span class="h">選填</span></span>',
      '      <input type="text" id="dfrNote" placeholder="例：橋墩基礎"></label>',
      '  </div>',
      '  <div class="df-row">',
      '    <button type="button" class="df-btn primary" id="dfrAdd">＋ 新增紀錄</button>',
      '    <button type="button" class="df-btn ghost" id="dfrReset">清空欄位</button>',
      '  </div>',
      '  <div class="df-tblwrap"><table class="df-rec"><thead><tr>',
      '    <th class="c" style="width:44px">序號</th><th style="width:112px">日期</th>',
      '    <th style="width:78px">查驗人員</th><th style="width:78px">監造派員</th>',
      '    <th>查驗位置</th><th class="c" style="width:60px">操作</th>',
      '  </tr></thead><tbody id="dfrBody"></tbody></table></div>',
      '  <div class="df-empty" id="dfrEmpty">尚無紀錄</div>',
      '  <div class="df-note">',
      '    <b>說明：</b>按「完成今日查驗」會自動把當日每支樁號寫成一筆（標記「當日彙整」）；',
      '    也可以在這裡手動補單筆。資料與「紀錄表」頁共用同一份，改哪邊都同步。',
      '  </div>',
      '</div>'
    ].join('\n');

    fillSelect($('dfrInspector'), inspectors(), '— 請選擇 —');
    fillSelect($('dfrSupervisor'), supervisors(), '— 請選擇 —');
    fillSelect($('dfrPier'), (S() && S().pierList) ? S().pierList() : [], '— 選擇墩號 —');

    var dateEl = $('dfrDate'), insEl = $('dfrInspector'), supEl = $('dfrSupervisor');
    var pierEl = $('dfrPier'), pileEl = $('dfrPile'), noteEl = $('dfrNote');

    dateEl.value = todayISO();

    function refreshPile() {
      var pier = pierEl.value, prev = pileEl.value;
      pileEl.innerHTML = '';
      if (!pier) {
        pileEl.disabled = true;
        var o = document.createElement('option');
        o.value = ''; o.textContent = '— 請先選墩號 —';
        pileEl.appendChild(o);
        return;
      }
      var nos = (S() && S().pileNosOf) ? S().pileNosOf(S().load(), pier) : [];
      var o0 = document.createElement('option');
      o0.value = ''; o0.textContent = '— 選擇樁號 —';
      pileEl.appendChild(o0);
      nos.forEach(function (no) {
        var op = document.createElement('option');
        op.value = no; op.textContent = no;
        pileEl.appendChild(op);
      });
      pileEl.disabled = !nos.length;
      if (prev && nos.indexOf(prev) >= 0) pileEl.value = prev;
    }
    refreshPile();

    pierEl.addEventListener('change', function () { refreshPile(); pileEl.value = ''; });

    function applyStaff() {
      var st = staffFor(dateEl.value);
      if (st.fixed) {
        insEl.value = st.inspector;
        supEl.value = st.supervisor;
      }
    }
    dateEl.addEventListener('change', applyStaff);
    applyStaff();

    function render() {
      var rows = readLogs();
      rows.sort(function (a, b) {
        var c = String(a.date || '').localeCompare(String(b.date || ''));
        if (c) return c;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
      var body = $('dfrBody');
      body.innerHTML = '';
      $('dfrEmpty').style.display = rows.length ? 'none' : 'block';

      rows.forEach(function (r, i) {
        var tr = document.createElement('tr');

        var td0 = document.createElement('td');
        td0.className = 'c seq';
        td0.textContent = (i + 1);
        tr.appendChild(td0);

        var td1 = document.createElement('td');
        td1.textContent = isoToSlash(r.date) || '—';
        tr.appendChild(td1);

        var td2 = document.createElement('td');
        td2.textContent = r.inspector || '—';
        tr.appendChild(td2);

        var td3 = document.createElement('td');
        td3.textContent = r.supervisor || '—';
        tr.appendChild(td3);

        var td4 = document.createElement('td');
        td4.className = 'loc';
        var loc = r.location || '';
        if (!loc && r.piles && r.piles.length) loc = r.piles.join('、');
        if (!loc && r.piers && r.piers.length) loc = r.piers.join('、') + ' 墩';
        td4.textContent = loc || '—';
        if (String(r.id || '').indexOf('day-') === 0) {
          var tg = document.createElement('span');
          tg.className = 'daytag';
          tg.textContent = '當日彙整';
          td4.appendChild(tg);
        }
        tr.appendChild(td4);

        var td5 = document.createElement('td');
        td5.className = 'c';
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'del';
        del.title = '刪除本筆';
        del.textContent = '×';
        del.addEventListener('click', function () {
          if (!window.confirm('確定刪除「' + (isoToSlash(r.date) || '') + '　' + (loc || '') + '」這筆紀錄？')) return;
          var keep = readLogs().filter(function (x) { return x.id !== r.id; });
          if (!writeLogs(keep)) { toast('刪除失敗', true); return; }
          render();
          toast('已刪除紀錄');
        });
        td5.appendChild(del);
        tr.appendChild(td5);

        body.appendChild(tr);
      });
    }

    $('dfrAdd').addEventListener('click', function () {
      var d = dateEl.value, ins = insEl.value, sup = supEl.value, pile = pileEl.value;
      if (!d) { toast('請填寫查驗日期', true); dateEl.focus(); return; }
      if (!ins) { toast('請選擇查驗人員', true); insEl.focus(); return; }
      if (!sup) { toast('請選擇監造人員', true); supEl.focus(); return; }
      if (!pile) { toast('請選擇樁號', true); pileEl.focus(); return; }

      var note = String(noteEl.value || '').trim();
      var loc = [pile, note].filter(Boolean).join(' ');
      var rows = readLogs();
      rows.push({
        id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
        date: d, inspector: ins, supervisor: sup,
        location: loc, piles: [pile], piers: [pierOfPile(pile)]
      });
      if (!writeLogs(rows)) { toast('新增失敗（本機儲存空間可能已滿）', true); return; }
      render();
      noteEl.value = '';
      pileEl.value = '';
      toast('已新增紀錄：' + loc);
    });

    $('dfrReset').addEventListener('click', function () {
      dateEl.value = todayISO();
      insEl.value = '';
      supEl.value = '';
      pierEl.value = '';
      pileEl.value = '';
      noteEl.value = '';
      refreshPile();
      applyStaff();
    });

    window.addEventListener('storage', function (e) {
      if (e.key === STAFF_KEY) applyStaff();
    });

    render();
    global.DailyFlow._recRefresh = render;

    return { refresh: render };
  }

  global.DailyFlow = {
    STAFF_KEY: STAFF_KEY,
    CUR_KEY: CUR_KEY,
    mountDaily: mountDaily,
    mountRecords: mountRecords,
    staff: function () { return staffFor(todayISO()); },
    staffFor: staffFor,
    currentPile: currentPile,
    pilesOfDay: pilesOfDay,
    finishDay: finishDay,
    _recRefresh: null
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
