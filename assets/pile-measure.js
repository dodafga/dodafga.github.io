/*!
 * pile-measure.js — 樁位資料表（共用模組）
 *
 * 同一份資料（localStorage: inspection-pile-measure-v1）在兩個頁面使用：
 *   - drive/index.html    ：樁位資料表（表單＋樁位資料緩存區），放在相片歸檔最下方
 *   - progress/index.html ：樁位資料查詢（單日日期／樁號），放在「樁位明細」後面
 *
 * 對外：
 *   window.PileMeasure.mount(el, opts)      建立「樁位資料表」整塊
 *   window.PileMeasure.mountQuery(el, opts) 建立「樁位資料查詢」整塊
 *   window.PileMeasure.rows()               讀出全部紀錄
 */
(function (global) {
  'use strict';

  var KEY = 'inspection-pile-measure-v1';

  var M_KEYS = ['el', 'upCm', 'upCnt', 'lowCm', 'lowCnt', 'depth', 'lap',
                'weldCm', 'weldCnt', 'stirLap', 'weld2Cm', 'weld2Cnt',
                'plumb', 'topA', 'topB', 'dia'];

  var M_LABEL = {
    el: '儀器高 EL', upCm: '上D19 ㎝', upCnt: '上D19 支數',
    lowCm: '下D19 ㎝', lowCnt: '下D19 支數', depth: '深度', lap: '主筋搭接 Ld',
    weldCm: '銲道 ㎝', weldCnt: '銲道處數', plumb: '垂直度',
    topA: '鋼筋頂 EL(a)', topB: '鋼筋頂 EL(b)', dia: 'D'
  };

  var TOP_WARN = -20.45;

  /* ---------------- 小工具 ---------------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    var C = global.Core;
    if (C && C.esc) return C.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function todayISO() {
    var C = global.Core;
    if (C && C.todayISO) return C.todayISO();
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function isoToSlash(s) {
    var C = global.Core;
    if (C && C.isoToSlash) return C.isoToSlash(s);
    return String(s || '').replace(/-/g, '/');
  }

  function uid() {
    var C = global.Core;
    if (C && C.uid) return C.uid();
    return 'p' + Date.now() + Math.random().toString(36).slice(2, 7);
  }

  function numClean(v) {
    var s = String(v == null ? '' : v), out = '', dot = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c >= '0' && c <= '9') out += c;
      else if (c === '.' && !dot && out !== '') { out += c; dot = true; }
    }
    return out;
  }

  function depthToC(depth) {
    var d = parseFloat(String(depth == null ? '' : depth).replace(/[^\d.\-]/g, ''));
    if (!isFinite(d)) return '';
    return String(Math.round((d + 0.1) * 1000) / 1000);
  }

  function topCalcValue(a, b, c) {
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return null;
    return Math.round((a - b - c) * 1000) / 1000;
  }

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

  function toast(msg, isErr) {
    var t = $('toast');
    if (!t) { try { console.log(msg); } catch (e) {} return; }
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  /* ---------------- 資料層 ---------------- */

  function emptyM() {
    var m = {};
    M_KEYS.forEach(function (k) { m[k] = ''; });
    return m;
  }

  function normM(src) {
    var m = emptyM();
    if (src && typeof src === 'object') {
      M_KEYS.forEach(function (k) { if (src[k] != null) m[k] = String(src[k]); });
      Object.keys(src).forEach(function (k) {
        if (M_KEYS.indexOf(k) < 0 && src[k] != null) m[k] = String(src[k]);
      });
    }
    return m;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(function (r) {
        r = r || {};
        var pile = String(r.pile || '');
        return {
          id: String(r.id || uid()),
          date: String(r.date || ''),
          inspector: String(r.inspector || ''),
          supervisor: String(r.supervisor || ''),
          pier: String(r.pier || pierOfPile(pile)),
          pile: pile,
          note: String(r.note || ''),
          m: normM(r.m)
        };
      });
    } catch (e) { return []; }
  }

  function save(rows) {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); return true; }
    catch (e) { return false; }
  }

  function sortRows(rows) {
    rows.sort(function (a, b) {
      var c = String(a.date || '').localeCompare(String(b.date || ''));
      if (c) return c;
      return String(a.pile || '').localeCompare(String(b.pile || ''));
    });
    return rows;
  }

  /* ---------------- 共用：人員清單 ---------------- */

  function inspectors() {
    var LB = global.LogBuilder || {};
    return LB.INSPECTORS || ['乘恩', '順昔', '火木', '佩璇'];
  }
  function supervisors() {
    var LB = global.LogBuilder || {};
    return LB.SUPERVISORS || ['振源', '旭程', '慧欣'];
  }
  function pierList() {
    var S = global.SuiteStore;
    return (S && S.pierList) ? S.pierList() : [];
  }
  function pileNosOf(pier) {
    var S = global.SuiteStore;
    if (!S || !S.pileNosOf) return [];
    try { return S.pileNosOf(S.load(), pier); } catch (e) { return []; }
  }

  function fillSelect(sel, list, placeholder) {
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

  /* ---------------- 摘要 ---------------- */

  function summary(r) {
    var m = r.m || {}, bits = [];
    if (m.depth) bits.push('深度 ' + m.depth + 'm');
    if (m.dia) bits.push('D ' + m.dia + 'cm');
    if (m.lap) bits.push('Ld ' + m.lap + 'm');
    if (m.weldCm) bits.push('銲道 ' + m.weldCm + 'cm' + (m.weldCnt ? '×' + m.weldCnt : ''));
    if (m.stirLap) bits.push('箍筋Ld ' + m.stirLap + 'cm');
    if (m.weld2Cm) bits.push('銲道2 ' + m.weld2Cm + 'cm' + (m.weld2Cnt ? '×' + m.weld2Cnt : ''));
    if (m.upCm) bits.push('上D19 ' + m.upCm + 'cm' + (m.upCnt ? '×' + m.upCnt : ''));
    if (m.lowCm) bits.push('下D19 ' + m.lowCm + 'cm' + (m.lowCnt ? '×' + m.lowCnt : ''));
    if (m.el) bits.push('EL ' + m.el);
    return bits.length ? bits.join('　·　') : '—';
  }

  function detailHtml(r) {
    var m = r.m || {};
    function di(k, v) {
      if (!v) return '';
      return '<div class="pm-di"><b>' + esc(k) + '</b><span>' + esc(v) + '</span></div>';
    }
    function diRaw(k, vHtml) {
      if (!vHtml) return '';
      return '<div class="pm-di"><b>' + esc(k) + '</b><span>' + vHtml + '</span></div>';
    }
    var h = '<div class="pm-dgrid">';
    h += di('儀器高 EL', m.el);
    h += di('上D19', m.upCm ? (m.upCm + ' cm' + (m.upCnt ? ' ／ ' + m.upCnt + ' 支' : '')) : '');
    h += di('下D19', m.lowCm ? (m.lowCm + ' cm' + (m.lowCnt ? ' ／ ' + m.lowCnt + ' 支' : '')) : '');
    h += di('深度', m.depth ? (m.depth + ' m') : '');
    h += di('主筋搭接 Ld', m.lap ? (m.lap + ' m') : '');
    h += di('銲道', m.weldCm ? (m.weldCm + ' cm' + (m.weldCnt ? ' ／ ' + m.weldCnt + ' 處' : '')) : '');
    h += di('箍筋搭接 Ld', m.stirLap ? (m.stirLap + ' cm') : '');
    h += di('兩處銲道', m.weld2Cm ? (m.weld2Cm + ' cm' + (m.weld2Cnt ? ' ／ ' + m.weld2Cnt + ' 處' : '')) : '');
    h += di('垂直度', m.plumb);
    var topA = m.topA || m.el || '';
    var topB = (m.topB == null ? '' : String(m.topB));
    var topC = depthToC(m.depth) || (m.topC == null ? '' : String(m.topC));
    if (topA || topB || topC) {
      var a = parseFloat(topA), b = parseFloat(topB), c = parseFloat(topC);
      var cv = topCalcValue(a, b, c);
      var txt = esc(topA) + ' － ' + esc(topB === '' ? '—' : topB) + ' － ' + esc(topC === '' ? '—' : topC) +
        (cv !== null ? ' ＝ ' + (cv <= TOP_WARN ? '<span class="pm-warnv">' + esc(String(cv)) + '</span>' : esc(String(cv))) : '');
      h += diRaw('鋼筋頂 EL', txt);
    }
    h += di('D', m.dia ? (m.dia + ' cm') : '');
    h += di('備註', r.note);
    h += '</div>';
    return h;
  }

  /* ---------------- 樣式（只注入一次） ---------------- */

  function injectCss() {
    if ($('pmCss')) return;
    var st = document.createElement('style');
    st.id = 'pmCss';
    st.textContent = [
      '.pm-wrap{font-size:14px}',
      '.pm-entry{display:grid;grid-template-columns:1fr 1fr;gap:11px}',
      '.pm-entry .full{grid-column:1/-1}',
      '.pm-fld{display:flex;flex-direction:column;gap:5px}',
      '.pm-fld>span{font-size:12.5px;font-weight:600;color:#3a3a3e}',
      '.pm-fld>span .h{font-weight:400;color:#6e6e74;font-size:11.5px;margin-left:5px}',
      '.pm-fld input,.pm-fld select{width:100%;padding:9px 11px;font-size:14px;border:1px solid #dcd8d4;',
      '  border-radius:7px;background:#fcfbfa;color:#1b1b1d;font-family:inherit;line-height:1.5}',
      '.pm-fld input:focus,.pm-fld select:focus{outline:none;border-color:#6b4443;background:#fff;',
      '  box-shadow:0 0 0 3px rgba(122,79,78,.12)}',
      '.pm-pick{display:flex;gap:7px}',
      '.pm-pick select{flex:1;min-width:0}',
      '.pm-mtable{width:100%;border-collapse:collapse;margin-top:4px}',
      '.pm-mtable th{background:#f2f0ed;color:#3a3a3e;font-size:12px;font-weight:700;',
      '  padding:8px 10px;text-align:left;border:1px solid #dcd8d4;white-space:nowrap}',
      '.pm-mtable td{border:1px solid #eae7e3;padding:7px 10px;font-size:13px;vertical-align:middle}',
      '.pm-mtable td.design{background:#f8f6f4;color:#3a3a3e;font-weight:600;width:38%}',
      '.pm-mtable .rowno{width:34px;text-align:center;color:#6e6e74;font-size:11.5px;font-weight:700}',
      '.pm-mtable input{font-size:13px;padding:6px 8px;width:88px;border:1px solid #dcd8d4;',
      '  border-radius:6px;background:#fff;font-family:inherit}',
      '.pm-mtable input[readonly]{background:#f2f0ed;color:#6b4443;font-weight:700}',
      '.pm-inline{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.pm-inline .u{font-size:12px;color:#6e6e74;white-space:nowrap}',
      '.pm-inline .sep{color:#6e6e74;font-size:12px}',
      '.pm-calc{font-weight:700;color:#6b4443;min-width:52px;display:inline-block}',
      '.pm-calc.warn{color:#a34a45}',
      '.pm-auto{font-size:10.5px;font-weight:700;color:#5f7a63;background:rgba(21,128,61,.12);',
      '  border-radius:20px;padding:1px 7px;white-space:nowrap}',
      '.pm-btnrow{display:flex;gap:8px;margin-top:13px;flex-wrap:wrap}',
      '.pm-btn{font-family:inherit;font-size:13.5px;font-weight:600;padding:10px 16px;border-radius:8px;',
      '  border:1px solid transparent;cursor:pointer;display:inline-flex;align-items:center;',
      '  justify-content:center;gap:7px;transition:.15s}',
      '.pm-btn.primary{background:#7a4f4e;color:#fff}',
      '.pm-btn.primary:hover{background:#6b4443}',
      '.pm-btn.ghost{background:#fff;color:#3a3a3e;border-color:#dcd8d4}',
      '.pm-btn.ghost:hover{background:#f6f4f2}',
      '.pm-btn.danger{background:#fff;color:#a34a45;border-color:#e5cfcd}',
      '.pm-btn.sm{font-size:12px;padding:6px 11px;border-radius:6px}',
      '.pm-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.pm-editbar{display:none;margin:0 0 11px;font-size:12.5px;line-height:1.7;color:#3a3a3e;',
      '  background:#f6edec;border:1px solid #e3d2d0;border-radius:8px;padding:10px 13px}',
      '.pm-editbar.on{display:block}',
      '.pm-editbar b{color:#7a4f4e}',
      '.pm-tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #dcd8d4;',
      '  border-radius:8px;margin-top:14px}',
      'table.pm-rec{width:100%;border-collapse:collapse;min-width:640px}',
      'table.pm-rec th{background:#f2f0ed;color:#3a3a3e;font-size:12px;font-weight:700;',
      '  padding:8px;text-align:left;border-bottom:1px solid #dcd8d4;white-space:nowrap}',
      'table.pm-rec td{padding:6px 8px;border-bottom:1px solid #eae7e3;font-size:13px;vertical-align:top}',
      'table.pm-rec tr:last-child td{border-bottom:none}',
      'table.pm-rec tr:hover td{background:#fbfaf9}',
      'table.pm-rec .seq{font-weight:700;color:#5f5f66;font-size:12.5px;width:44px;text-align:center}',
      'table.pm-rec .pile{font-weight:700;color:#6b4443}',
      'table.pm-rec .c{text-align:center}',
      'table.pm-rec .exp{background:#fff;border:1px solid #d5d0cb;color:#6b4443;cursor:pointer;',
      '  font-size:13px;font-weight:700;padding:7px 15px;border-radius:7px;font-family:inherit;min-width:68px}',
      'table.pm-rec .exp:hover{background:#f6edec;border-color:#6b4443}',
      'table.pm-rec .del{background:none;border:none;color:#a34a45;cursor:pointer;font-size:16px;',
      '  line-height:1;padding:3px 7px;border-radius:5px}',
      'table.pm-rec .del:hover{background:#f8edec}',
      'table.pm-rec .dup{display:inline-block;margin-left:5px;font-size:10px;font-weight:700;',
      '  color:#a34a45;background:#f8edec;border:1px solid #e5cfcd;border-radius:20px;padding:0 6px}',
      'tr.pm-detail td{background:#fbfaf9;padding:0!important}',
      '.pm-dbox{padding:16px 18px}',
      '.pm-dgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px 22px}',
      '.pm-di{font-size:13.5px;color:#3a3a3e;line-height:1.7}',
      '.pm-di b{color:#6e6e74;font-weight:600;margin-right:6px;font-size:12.5px}',
      '.pm-di span{font-weight:700;color:#1b1b1d;font-size:14px}',
      '.pm-warnv{color:#a34a45}',
      '.pm-cachebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px;padding-top:13px;border-top:1px dashed #dcd8d2}',
      '.pm-cachehint{font-size:11.5px;color:#8a8a90}',
      '.pm-cache{margin-top:11px}',
      '.pm-empty{text-align:center;padding:26px 12px;color:#6e6e74;font-size:13px}',
      '.pm-note{font-size:12px;color:#6e6e74;line-height:1.7;margin-top:12px;background:#f8f6f4;',
      '  border:1px solid #eae7e3;border-radius:8px;padding:11px 13px}',
      '.pm-note b{color:#3a3a3e}',
      '.pm-qbar{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}',
      '.pm-qbar .pm-fld{flex:1;min-width:180px}',
      '.pm-qbar .pm-fld.wide{flex:1.4;min-width:220px}',
      '.pm-qlist{margin-top:12px;border:1px solid #dcd8d4;border-radius:9px;overflow:hidden;background:#fff}',
      '.pm-qlist-h{display:flex;align-items:center;justify-content:space-between;gap:10px;',
      '  padding:9px 13px;background:#f9f4f3;border-bottom:1px solid #dcd8d4;font-size:12.5px;color:#3a3a3e}',
      '.pm-qlist-h b{font-size:13px;color:#1b1b1d}',
      '.pm-qmode{font-size:11.5px;font-weight:700;border-radius:20px;padding:2px 9px;',
      '  background:rgba(21,128,61,.12);color:#5f7a63;white-space:nowrap}',
      '.pm-qmode.search{background:rgba(37,99,235,.12);color:#1d4ed8}',
      '.pm-qlist-b{max-height:360px;overflow-y:auto}',
      '.pm-qitem{display:flex;align-items:center;gap:10px;padding:9px 13px;',
      '  border-bottom:1px solid #eae7e3;font-size:13px;line-height:1.5}',
      '.pm-qitem:last-child{border-bottom:0}',
      '.pm-qitem:hover{background:#f9f7f5}',
      '.pm-qi-no{flex:0 0 26px;text-align:right;color:#6e6e74;font-size:12px}',
      '.pm-qi-date{flex:0 0 84px;color:#3a3a3e}',
      '.pm-qi-pile{flex:0 0 92px;font-weight:700;color:#6b4443}',
      '.pm-qi-sum{flex:1;min-width:0;color:#3a3a3e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pm-qi-btn{flex:0 0 auto;font-size:12px;font-weight:700;padding:5px 12px;border-radius:6px;',
      '  border:1px solid #dcd8d4;background:#fff;color:#6b4443;cursor:pointer;font-family:inherit}',
      '.pm-qi-btn:hover{background:#f6edec;border-color:#6b4443}',
      '.pm-qdetail{padding:10px 0 4px 36px}',
      '.pm-qlist-e{padding:16px 13px;text-align:center;color:#6e6e74;font-size:13px}',
      '@media (max-width:760px){',
      '  .pm-entry{grid-template-columns:1fr}',
      '  .pm-mtable td.design{width:44%;font-size:12px}',
      '  .pm-mtable input{width:70px}',
      '  .pm-qitem{flex-wrap:wrap}',
      '  .pm-qi-sum{flex-basis:100%;white-space:normal}',
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ---------------- 樁位資料表（drive/） ---------------- */

  function mount(el, opts) {
    if (!el) return null;
    injectCss();
    opts = opts || {};

    var rows = sortRows(load());
    var editingId = null;
    var expanded = {};

    el.innerHTML = [
      '<div class="pm-wrap">',
      '  <div class="pm-entry">',
      '    <label class="pm-fld"><span>查驗日期 <span class="h">yyyy/mm/dd</span></span>',
      '      <input type="date" id="pmDate"></label>',
      '    <label class="pm-fld"><span>樁號 <span class="h">先選墩號再選樁號</span></span>',
      '      <div class="pm-pick"><select id="pmPier"></select><select id="pmPile" disabled></select></div>',
      '    </label>',
      '  </div>',
      '  <div class="pm-editbar" id="pmEditBar"></div>',
      '  <table class="pm-mtable"><thead><tr>',
      '    <th class="rowno">#</th><th>設計／標準值</th><th>實際量測值</th>',
      '  </tr></thead><tbody>',
      '    <tr><td class="rowno">1</td><td class="design">上D19◎12cm</td>',
      '      <td><div class="pm-inline"><span class="u">上D19；</span>',
      '        <input type="text" id="pmUpCm" placeholder="cm"><span class="u">cm／</span>',
      '        <input type="text" id="pmUpCnt" placeholder="支"><span class="u">支</span></div></td></tr>',
      '    <tr><td class="rowno">2</td><td class="design">下D19◎20cm</td>',
      '      <td><div class="pm-inline"><span class="u">下D19；</span>',
      '        <input type="text" id="pmLowCm" placeholder="cm"><span class="u">cm／</span>',
      '        <input type="text" id="pmLowCnt" placeholder="支"><span class="u">支</span></div></td></tr>',
      '    <tr><td class="rowno">3</td><td class="design">深度L=21.55m</td>',
      '      <td><div class="pm-inline"><span class="u">深度＝</span>',
      '        <input type="text" id="pmDepth" placeholder="m"><span class="u">m</span></div></td></tr>',
      '    <tr><td class="rowno">4</td><td class="design">主筋搭接Ld=1m</td>',
      '      <td><div class="pm-inline"><span class="u">主筋搭接Ld＝</span>',
      '        <input type="text" id="pmLap" placeholder="m"><span class="u">m</span></div></td></tr>',
      '    <tr><td class="rowno">5</td><td class="design">銲道≧4.5cm，三處</td>',
      '      <td><div class="pm-inline"><span class="u">銲道＝</span>',
      '        <input type="text" id="pmWeldCm" placeholder="cm"><span class="u">cm，</span>',
      '        <input type="text" id="pmWeldCnt" placeholder="處"><span class="u">處</span></div></td></tr>',
      '    <tr><td class="rowno">6</td><td class="design">箍筋搭接Ld=60cm</td>',
      '      <td><div class="pm-inline"><span class="u">箍筋搭接Ld＝</span>',
      '        <input type="text" id="pmStirLap" placeholder="cm"><span class="u">cm</span></div></td></tr>',
      '    <tr><td class="rowno">7</td><td class="design">兩處焊道≧10cm</td>',
      '      <td><div class="pm-inline"><span class="u">焊道＝</span>',
      '        <input type="text" id="pmWeld2Cm" placeholder="cm"><span class="u">cm，</span>',
      '        <input type="text" id="pmWeld2Cnt" placeholder="處"><span class="u">處</span></div></td></tr>',
      '    <tr><td class="rowno">8</td><td class="design">儀器高：EL</td>',
      '      <td><div class="pm-inline"><span class="u">EL＝</span>',
      '        <input type="text" id="pmEl" placeholder="0.000"><span class="pm-auto">自動帶入下格 a</span></div></td></tr>',
      '    <tr><td class="rowno">9</td><td class="design">垂直度≦1/100</td>',
      '      <td><div class="pm-inline"><span class="u">垂直度≦1/100</span>',
      '        <input type="text" id="pmPlumb" placeholder="實測值"></div></td></tr>',
      '    <tr><td class="rowno">10</td><td class="design">鋼筋頂EL1.2</td>',
      '      <td><div class="pm-inline"><span class="u">EL：</span>',
      '        <input type="text" id="pmTopA" placeholder="a" readonly title="自動帶入上方「儀器高 EL」的數值"><span class="sep">－</span>',
      '        <input type="text" id="pmTopB" placeholder="b" title="b：自行填寫（不自動帶入）"><span class="sep">－</span>',
      '        <input type="text" id="pmTopC" placeholder="c" readonly title="自動帶入該樁「深度 ＋ 0.1」"><span class="pm-auto">深度＋0.1</span>',
      '        <span class="sep">＝</span><span class="pm-calc" id="pmTopCalc">—</span></div></td></tr>',
      '    <tr><td class="rowno">11</td><td class="design">D≧60cm</td>',
      '      <td><div class="pm-inline"><span class="u">D＝</span>',
      '        <input type="text" id="pmDia" placeholder="cm"><span class="u">cm</span></div></td></tr>',
      '  </tbody></table>',
      '  <div class="pm-entry" style="margin-top:13px">',
      '    <label class="pm-fld full"><span>備註 <span class="h">選填</span></span>',
      '      <input type="text" id="pmNote" placeholder="例：樁頭打除後複測"></label>',
      '  </div>',
      '  <div class="pm-btnrow">',
      '    <button type="button" class="pm-btn primary" id="pmAdd">＋ 新增樁位檢查</button>',
      '    <button type="button" class="pm-btn ghost" id="pmReset">清空欄位</button>',
      '  </div>',
      '  <div class="pm-note" style="margin-top:14px">',
      '    <b>樁位資料緩存區：</b>下面每一筆都存在這台裝置，隨時可按「明細 → ✎ 載入修改」把資料調出來改，',
      '    改完按「儲存修改」覆蓋原紀錄。拍照上傳歸檔後可直接接著作紀錄。',
      '  </div>',
      '  <div class="pm-cachebar">',
      '    <button type="button" class="pm-btn ghost" id="pmCacheToggle">📂 顯示樁位資料緩存區（<span id="pmCacheCnt">0</span> 筆）</button>',
      '    <span class="pm-cachehint">預設隱藏，需要時再叫出來</span>',
      '  </div>',
      '  <div class="pm-cache" id="pmCache" style="display:none">',
      '  <div class="pm-tblwrap"><table class="pm-rec"><thead><tr>',
      '    <th class="c" style="width:44px">序號</th><th style="width:112px">日期</th>',
      '    <th style="width:96px">樁號</th><th>重點量測</th><th class="c" style="width:96px">操作</th>',
      '  </tr></thead><tbody id="pmBody"></tbody></table></div>',
      '  <div class="pm-empty" id="pmEmpty">尚無樁位檢查紀錄，請於上方填寫後按「＋ 新增樁位檢查」</div>',
      '  </div>',
      '</div>'
    ].join('\n');

    var IDS = {
      el: 'pmEl', upCm: 'pmUpCm', upCnt: 'pmUpCnt', lowCm: 'pmLowCm', lowCnt: 'pmLowCnt',
      depth: 'pmDepth', lap: 'pmLap', weldCm: 'pmWeldCm', weldCnt: 'pmWeldCnt',
      stirLap: 'pmStirLap', weld2Cm: 'pmWeld2Cm', weld2Cnt: 'pmWeld2Cnt',
      plumb: 'pmPlumb', topA: 'pmTopA', topB: 'pmTopB', dia: 'pmDia'
    };

    fillSelect($('pmPier'), pierList(), '— 選擇墩號 —');
    $('pmDate').value = todayISO();

    /* 人員不另設欄位：直接沿用「今日查驗」已固定的人員（依日期代入） */
    function dailyStaff() {
      var DF = global.DailyFlow;
      if (!DF || !DF.staffFor) return { inspector: '', supervisor: '' };
      var d = $('pmDate').value || todayISO();
      var st = DF.staffFor(d);
      return { inspector: (st && st.inspector) || '', supervisor: (st && st.supervisor) || '' };
    }

    /* 量測值只接受數字 */
    Object.keys(IDS).forEach(function (k) {
      var inp = $(IDS[k]);
      if (!inp) return;
      inp.setAttribute('inputmode', 'decimal');
      inp.setAttribute('autocomplete', 'off');
      inp.addEventListener('input', function () {
        var before = String(this.value || ''), after = numClean(before);
        if (after !== before) this.value = after;
      });
    });

    function syncTop() {
      var a = $('pmTopA'), c = $('pmTopC');
      if (a) a.value = numClean(String($('pmEl').value || ''));
      if (c) c.value = depthToC($('pmDepth').value);
      updateCalc();
    }

    function updateCalc() {
      var a = parseFloat(String($('pmTopA').value || '').replace(/[^\d.\-]/g, ''));
      var b = parseFloat(String($('pmTopB').value || '').replace(/[^\d.\-]/g, ''));
      var c = parseFloat(String($('pmTopC').value || '').replace(/[^\d.\-]/g, ''));
      var out = $('pmTopCalc');
      var v = topCalcValue(a, b, c);
      if (v !== null) {
        out.textContent = String(v);
        out.classList.toggle('warn', v <= TOP_WARN);
        out.title = 'a － b － c ＝ ' + a + ' － ' + b + ' － ' + c + ' ＝ ' + v;
      } else {
        out.textContent = '—';
        out.classList.remove('warn');
        out.title = '';
      }
    }

    $('pmEl').addEventListener('input', syncTop);
    $('pmDepth').addEventListener('input', syncTop);
    $('pmTopB').addEventListener('input', updateCalc);

    function refreshPile() {
      var sel = $('pmPile'), pier = $('pmPier').value, prev = sel.value;
      sel.innerHTML = '';
      if (!pier) {
        sel.disabled = true;
        var o = document.createElement('option');
        o.value = ''; o.textContent = '— 請先選墩號 —';
        sel.appendChild(o);
        return;
      }
      var nos = pileNosOf(pier);
      var o0 = document.createElement('option');
      o0.value = ''; o0.textContent = '— 選擇樁號 —';
      sel.appendChild(o0);
      nos.forEach(function (no) {
        var op = document.createElement('option');
        op.value = no; op.textContent = no;
        sel.appendChild(op);
      });
      sel.disabled = !nos.length;
      if (prev && nos.indexOf(prev) >= 0) sel.value = prev;
    }

    $('pmPier').addEventListener('change', function () { refreshPile(); $('pmPile').value = ''; });
    refreshPile();

    function readM() {
      var m = {};
      M_KEYS.forEach(function (k) {
        var inp = $(IDS[k]);
        m[k] = inp ? String(inp.value || '').trim() : '';
      });
      m.topA = m.el;
      m.topC = depthToC(m.depth);
      return m;
    }

    function clearM() {
      M_KEYS.forEach(function (k) { var inp = $(IDS[k]); if (inp) inp.value = ''; });
      syncTop();
    }

    function setEdit(r) {
      editingId = r ? r.id : null;
      $('pmAdd').textContent = r ? '💾 儲存修改' : '＋ 新增樁位檢查';
      var bar = $('pmEditBar');
      if (r) {
        bar.className = 'pm-editbar on';
        bar.innerHTML = '<b>正在修改：</b>' + esc(r.pile || '') + '　' + esc(isoToSlash(r.date) || '') +
          '　按「儲存修改」覆蓋原紀錄，或按「清空欄位」放棄修改。';
      } else {
        bar.className = 'pm-editbar';
        bar.innerHTML = '';
      }
    }

    function loadForEdit(r) {
      $('pmDate').value = r.date || todayISO();
      var pier = r.pier || pierOfPile(r.pile);
      $('pmPier').value = pier;
      refreshPile();
      if (r.pile) {
        var found = false, opts2 = $('pmPile').options;
        for (var i = 0; i < opts2.length; i++) { if (opts2[i].value === r.pile) { found = true; break; } }
        if (!found) {
          var op = document.createElement('option');
          op.value = r.pile; op.textContent = r.pile + '（原紀錄）';
          $('pmPile').appendChild(op);
          $('pmPile').disabled = false;
        }
      }
      $('pmPile').value = r.pile || '';
      $('pmNote').value = r.note || '';
      var m = r.m || {};
      M_KEYS.forEach(function (k) {
        var inp = $(IDS[k]);
        if (inp) inp.value = (m[k] == null) ? '' : numClean(String(m[k]));
      });
      syncTop();
      setEdit(r);
      try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
      toast('已載入 ' + (r.pile || '') + ' 的紀錄，修改後按「儲存修改」');
    }

    function render() {
      var body = $('pmBody');
      body.innerHTML = '';
      $('pmEmpty').style.display = rows.length ? 'none' : 'block';
      var cntEl = $('pmCacheCnt');
      if (cntEl) cntEl.textContent = String(rows.length);

      var dupCount = {};
      rows.forEach(function (r) {
        var k = String(r.pile || '') + '@' + String(r.date || '');
        dupCount[k] = (dupCount[k] || 0) + 1;
      });

      rows.forEach(function (r, i) {
        var tr = document.createElement('tr');

        var tdSeq = document.createElement('td');
        tdSeq.className = 'c seq';
        tdSeq.textContent = (i + 1);
        tr.appendChild(tdSeq);

        var tdDate = document.createElement('td');
        tdDate.textContent = isoToSlash(r.date) || '—';
        tr.appendChild(tdDate);

        var tdPile = document.createElement('td');
        tdPile.className = 'pile';
        tdPile.textContent = r.pile || r.pier || '—';
        var dk = String(r.pile || '') + '@' + String(r.date || '');
        if (dupCount[dk] > 1) {
          var dtag = document.createElement('span');
          dtag.className = 'dup';
          dtag.textContent = '重複';
          dtag.title = '此樁號在此日期有 ' + dupCount[dk] + ' 筆紀錄';
          tdPile.appendChild(dtag);
        }
        tr.appendChild(tdPile);

        var tdSum = document.createElement('td');
        tdSum.textContent = summary(r);
        tr.appendChild(tdSum);

        var tdOp = document.createElement('td');
        tdOp.className = 'c';
        var exp = document.createElement('button');
        exp.type = 'button';
        exp.className = 'exp';
        exp.textContent = expanded[r.id] ? '收合' : '明細';
        exp.addEventListener('click', function () {
          expanded[r.id] = !expanded[r.id];
          render();
        });
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'del';
        del.title = '刪除本筆';
        del.textContent = '×';
        del.addEventListener('click', function () {
          if (!window.confirm('確定刪除「' + (r.pile || r.pier || '') + '　' + isoToSlash(r.date) + '」這筆樁位紀錄？')) return;
          rows = rows.filter(function (x) { return x.id !== r.id; });
          if (editingId === r.id) setEdit(null);
          save(rows);
          render();
          toast('已刪除樁位紀錄');
        });
        tdOp.appendChild(exp);
        tdOp.appendChild(del);
        tr.appendChild(tdOp);
        body.appendChild(tr);

        if (expanded[r.id]) {
          var dtr = document.createElement('tr');
          dtr.className = 'pm-detail';
          var dtd = document.createElement('td');
          dtd.colSpan = 5;
          dtd.innerHTML = '<div class="pm-dbox">' + detailHtml(r) +
            '<button type="button" class="exp" style="margin-top:9px" data-edit="' + esc(r.id) + '">✎ 載入修改</button></div>';
          dtr.appendChild(dtd);
          body.appendChild(dtr);
        }
      });

      Array.prototype.forEach.call(body.querySelectorAll('[data-edit]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-edit');
          for (var i = 0; i < rows.length; i++) if (rows[i].id === id) { loadForEdit(rows[i]); return; }
        });
      });
    }

    $('pmAdd').addEventListener('click', function () {
      var d = $('pmDate').value;
      var pile = $('pmPile').value;

      if (!d) { toast('請填寫查驗日期', true); $('pmDate').focus(); return; }
      if (!pile) { toast('請選擇樁號', true); $('pmPile').focus(); return; }

      /* 人員直接沿用「今日查驗」已固定的人員（依日期代入，不另設欄位） */
      var st = dailyStaff();
      var ins = st.inspector, sup = st.supervisor;

      var m = readM();
      for (var i = 0; i < M_KEYS.length; i++) {
        var k = M_KEYS[i], v = String(m[k] == null ? '' : m[k]).trim();
        if (v === '') continue;
        if (!/^\d+(?:\.\d+)?$/.test(v)) {
          toast('「' + (M_LABEL[k] || k) + '」只能填數字（目前是「' + v + '」）', true);
          var badEl = $(IDS[k]);
          if (badEl) { badEl.focus(); badEl.select && badEl.select(); }
          return;
        }
      }

      var dup = null;
      for (var j = 0; j < rows.length; j++) {
        var r0 = rows[j];
        if (editingId && r0.id === editingId) continue;
        if (String(r0.pile || '') === String(pile) && String(r0.date || '') === String(d)) { dup = r0; break; }
      }
      if (dup) {
        toast(pile + ' 在 ' + isoToSlash(d) + ' 已有樁位檢查紀錄，請用「明細 → ✎ 載入修改」或先刪除原紀錄', true);
        return;
      }

      var note = $('pmNote').value.trim();

      if (editingId) {
        for (var k2 = 0; k2 < rows.length; k2++) {
          if (rows[k2].id !== editingId) continue;
          rows[k2].date = d;
          rows[k2].inspector = ins;
          rows[k2].supervisor = sup;
          rows[k2].pier = pierOfPile(pile);
          rows[k2].pile = pile;
          rows[k2].note = note;
          rows[k2].m = normM(m);
          break;
        }
        sortRows(rows);
        save(rows);
        render();
        setEdit(null);
        toast('已儲存 ' + pile + ' 的樁位檢查修改（共 ' + rows.length + ' 筆）');
      } else {
        rows.push({
          id: uid(), date: d, inspector: ins, supervisor: sup,
          pier: pierOfPile(pile), pile: pile, note: note, m: normM(m)
        });
        sortRows(rows);
        save(rows);
        render();
        toast('已新增 ' + pile + ' 的樁位檢查紀錄（共 ' + rows.length + ' 筆）');
      }

      $('pmPile').value = '';
      $('pmNote').value = '';
      clearM();
      $('pmPile').focus();
      /* 讓「設定歸檔資料」的樁號清單與今日查驗同步 */
      try { if (global.__driveStationsRefresh) global.__driveStationsRefresh(); } catch (e) {}
      try { if (global.DailyFlow && global.DailyFlow._dailyRefresh) global.DailyFlow._dailyRefresh(); } catch (e) {}
    });

    $('pmReset').addEventListener('click', function () {
      $('pmDate').value = todayISO();
      $('pmPier').value = '';
      $('pmPile').value = '';
      $('pmNote').value = '';
      refreshPile();
      clearM();
      setEdit(null);
      $('pmDate').focus();
    });

    /* 跨頁／跨分頁同步 */
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      rows = sortRows(load());
      render();
    });

    render();

    var cacheBtn = $('pmCacheToggle'), cacheBox = $('pmCache');
    if (cacheBtn && cacheBox) cacheBtn.addEventListener('click', function () {
      var open = cacheBox.style.display !== 'none';
      cacheBox.style.display = open ? 'none' : 'block';
      cacheBtn.innerHTML = (open ? '📂 顯示樁位資料緩存區（' : '📁 隱藏樁位資料緩存區（') +
        '<span id="pmCacheCnt">' + rows.length + '</span> 筆）';
    });

    return {
      reload: function () { rows = sortRows(load()); render(); },
      rows: function () { return rows.slice(); }
    };
  }
  /* ---------------- 樁位資料查詢（progress/） ---------------- */

  function mountQuery(el, opts) {
    if (!el) return null;
    injectCss();
    opts = opts || {};

    var rows = sortRows(load());
    var q = { date: '', pile: '', text: '' };
    var expanded = {};

    el.innerHTML = [
      '<div class="pm-wrap">',
      '  <div class="pm-qbar">',
      '    <label class="pm-fld"><span>單日日期 <span class="h">選一天，列出當天所有樁位紀錄</span></span>',
      '      <input type="date" id="pmqDate"></label>',
      '    <label class="pm-fld"><span>樁號 <span class="h">先選墩號，再選樁號</span></span>',
      '      <div class="pm-pick"><select id="pmqPier"></select><select id="pmqPile" disabled></select></div></label>',
      '    <label class="pm-fld wide"><span>關鍵字 <span class="h">樁號、備註、量測值都可搜</span></span>',
      '      <input type="text" id="pmqText" placeholder="例：PR4-1　或　樁頭　或　12.5"></label>',
      '    <button type="button" class="pm-btn ghost" id="pmqClear">清除查詢</button>',
      '  </div>',
      '  <div class="pm-qlist">',
      '    <div class="pm-qlist-h">',
      '      <span><b id="pmqTitle">樁位資料表紀錄</b>　<span id="pmqSub"></span></span>',
      '      <span class="pm-qmode" id="pmqMode">全部</span>',
      '    </div>',
      '    <div class="pm-qlist-b" id="pmqBody"></div>',
      '  </div>',
      '</div>'
    ].join('\n');

    fillSelect($('pmqPier'), pierList(), '— 選擇墩號 —');

    function refreshPile() {
      var sel = $('pmqPile'), pier = $('pmqPier').value, prev = sel.value;
      sel.innerHTML = '';
      if (!pier) {
        sel.disabled = true;
        var o = document.createElement('option');
        o.value = ''; o.textContent = '— 請先選墩號 —';
        sel.appendChild(o);
        return;
      }
      var nos = pileNosOf(pier);
      var o0 = document.createElement('option');
      o0.value = ''; o0.textContent = '— 全部樁號 —';
      sel.appendChild(o0);
      nos.forEach(function (no) {
        var op = document.createElement('option');
        op.value = no; op.textContent = no;
        sel.appendChild(op);
      });
      sel.disabled = !nos.length;
      if (prev && nos.indexOf(prev) >= 0) sel.value = prev;
    }
    refreshPile();

    function match(r) {
      if (q.date && String(r.date || '') !== String(q.date)) return false;
      if (q.pile) {
        var no = String(r.pile || '').toUpperCase();
        if (no !== q.pile.toUpperCase() && no.indexOf(q.pile.toUpperCase()) < 0) return false;
      }
      if (q.text) {
        var kw = q.text.trim().toUpperCase();
        if (kw) {
          var hay = [r.pile, r.pier, r.note, r.inspector, r.supervisor,
                     summary(r), isoToSlash(r.date), r.date].join(' ').toUpperCase();
          if (hay.indexOf(kw) < 0) return false;
        }
      }
      return true;
    }

    function render() {
      var body = $('pmqBody');
      body.innerHTML = '';
      var list = rows.filter(match);
      var hasQuery = !!(q.date || q.pile || (q.text && q.text.trim()));

      $('pmqMode').textContent = hasQuery ? '搜尋結果' : '全部';
      $('pmqMode').className = 'pm-qmode' + (hasQuery ? ' search' : '');
      $('pmqTitle').textContent = hasQuery ? '搜尋結果' : '樁位資料表紀錄';
      $('pmqSub').textContent = hasQuery
        ? '共 ' + list.length + ' 筆'
        : '共 ' + list.length + ' 筆（未輸入條件，列出全部）';

      if (!list.length) {
        var e = document.createElement('div');
        e.className = 'pm-qlist-e';
        e.textContent = rows.length
          ? '查無符合條件的樁位紀錄，請調整日期或樁號。'
          : '尚無樁位檢查紀錄，請到「相片歸檔」頁面最下方新增。';
        body.appendChild(e);
        return;
      }

      list.forEach(function (r, i) {
        var row = document.createElement('div');
        row.className = 'pm-qitem';

        var no = document.createElement('span');
        no.className = 'pm-qi-no';
        no.textContent = (i + 1);
        row.appendChild(no);

        var dt = document.createElement('span');
        dt.className = 'pm-qi-date';
        dt.textContent = isoToSlash(r.date) || '—';
        row.appendChild(dt);

        var pl = document.createElement('span');
        pl.className = 'pm-qi-pile';
        pl.textContent = r.pile || r.pier || '—';
        row.appendChild(pl);

        var sm = document.createElement('span');
        sm.className = 'pm-qi-sum';
        sm.textContent = summary(r);
        sm.title = summary(r);
        row.appendChild(sm);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pm-qi-btn';
        btn.textContent = expanded[r.id] ? '收合' : '明細';
        btn.addEventListener('click', function () {
          expanded[r.id] = !expanded[r.id];
          render();
        });
        row.appendChild(btn);
        body.appendChild(row);

        if (expanded[r.id]) {
          var d = document.createElement('div');
          d.className = 'pm-qitem';
          var inner = document.createElement('div');
          inner.className = 'pm-qdetail';
          inner.innerHTML = detailHtml(r);
          d.appendChild(inner);
          body.appendChild(d);
        }
      });
    }

    $('pmqDate').addEventListener('change', function () { q.date = String(this.value || ''); render(); });
    $('pmqPier').addEventListener('change', function () {
      refreshPile();
      q.pile = '';
      render();
    });
    $('pmqPile').addEventListener('change', function () { q.pile = String(this.value || '').trim(); render(); });
    $('pmqText').addEventListener('input', function () { q.text = String(this.value || ''); render(); });
    $('pmqClear').addEventListener('click', function () {
      q = { date: '', pile: '', text: '' };
      $('pmqDate').value = '';
      $('pmqPier').value = '';
      $('pmqPile').value = '';
      $('pmqText').value = '';
      refreshPile();
      render();
    });

    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      rows = sortRows(load());
      render();
    });

    render();

    return {
      reload: function () { rows = sortRows(load()); render(); }
    };
  }

  global.PileMeasure = {
    KEY: KEY,
    rows: function () { return sortRows(load()); },
    mount: mount,
    mountQuery: mountQuery
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
