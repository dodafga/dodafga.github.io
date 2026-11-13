/* 墩號彙總分組可折疊收合（第 2 項）
 *
 * 做法：不修改進度表核心檔（66KB），改用獨立模組在 DOM 層處理。
 *   進度表渲染後，每一組都有一個 <tr class="pier-group"> 標題列，
 *   其後緊接屬於該組的資料列，直到下一個 .pier-group 為止。
 *   本模組把「標題列 + 其後資料列」綁成一組，點標題列即可收合／展開。
 *
 * 資料完全沒有被改動：只切換 CSS class（.grp-hid / .collapsed），
 * 不影響 store.js 的資料、也不影響任何匯出格式。
 * 重新渲染（改篩選、改資料）時，會依記住的收合狀態重新套用。
 */
(function (global) {
  'use strict';

  var BODY_ID = 'pierBody';
  var CSS_ID = 'pcss-pier-collapse';

  /* 收合狀態記憶（key = 分組名稱），跨重新渲染保留 */
  var collapsed = Object.create(null);

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent =
      'table.piers tr.pier-group{cursor:pointer;-webkit-user-select:none;user-select:none;}' +
      'table.piers tr.pier-group:hover td{background:#e2e9f3;}' +
      'table.piers tr.pier-group td .gcaret{display:inline-block;width:13px;margin-right:3px;' +
      'font-size:10px;color:#4a6b96;transform:rotate(90deg);}' +
      'table.piers tr.pier-group.collapsed td .gcaret{transform:rotate(0deg);}' +
      'table.piers tr.pier-group td .ghint{font-size:11px;color:#8d97a6;margin-left:8px;opacity:.8;}' +
      'table.piers tr.pier-group td .gcount{font-size:11px;color:#4a6b96;margin-left:6px;' +
      'background:#dde6f2;border-radius:9px;padding:1px 7px;}' +
      'table.piers tr.grp-hid{display:none;}';
    document.head.appendChild(st);
  }

  /* 把 tbody 內的分組標題列與其後的資料列整理成組 */
  function buildGroups() {
    var body = document.getElementById(BODY_ID);
    if (!body) return [];
    var out = [];
    var rows = Array.prototype.slice.call(body.children);
    var cur = null;
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      if (tr.classList && tr.classList.contains('pier-group')) {
        cur = { head: tr, rows: [], key: null };
        var gn = tr.querySelector('.gname');
        cur.key = gn ? gn.textContent.trim() : ('g' + out.length);
        out.push(cur);
      } else if (cur) {
        cur.rows.push(tr);
      }
    }
    return out;
  }

  function apply(g, hid) {
    g.rows.forEach(function (r) { r.classList.toggle('grp-hid', hid); });
    g.head.classList.toggle('collapsed', hid);
    var hint = g.head.querySelector('.ghint');
    if (hint) hint.textContent = hid ? '點擊展開' : '點擊收合';
    var cnt = g.head.querySelector('.gcount');
    if (cnt) cnt.textContent = hid ? (g.rows.length + ' 列已收合') : '';
  }

  function decorate() {
    injectCSS();
    var groups = buildGroups();
    groups.forEach(function (g) {
      var td = g.head.firstElementChild;
      if (!td) return;
      // 箭頭與提示（只加一次）
      if (!g.head.querySelector('.gcaret')) {
        var caret = document.createElement('span');
        caret.className = 'gcaret';
        caret.textContent = '▸';
        td.insertBefore(caret, td.firstChild);

        var hint = document.createElement('span');
        hint.className = 'ghint';
        hint.textContent = '點擊收合';
        td.appendChild(hint);

        var cnt = document.createElement('span');
        cnt.className = 'gcount';
        td.appendChild(cnt);

        g.head.addEventListener('click', function (ev) {
          // 避免與列內其他點擊行為衝突
          ev.stopPropagation();
          var now = !g.head.classList.contains('collapsed');
          if (now) collapsed[g.key] = 1; else delete collapsed[g.key];
          // 重新取組（DOM 可能已重繪）
          buildGroups().forEach(function (gg) {
            if (gg.key === g.key) apply(gg, now);
          });
        });
      }
      // 依記住的狀態套用
      apply(g, !!collapsed[g.key]);
    });
    return groups.length;
  }

  /* 渲染後觸發：MutationObserver + 防抖 */
  var timer = null;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; try { decorate(); } catch (e) {} }, 60);
  }

  function install() {
    injectCSS();
    var body = document.getElementById(BODY_ID);
    if (!body) {
      // 頁面尚未渲染完，等 DOM 就緒
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install, { once: true });
      } else {
        setTimeout(install, 120);
      }
      return;
    }
    schedule();
    if (!body.__pierCollapseObs) {
      var mo = new MutationObserver(schedule);
      mo.observe(body, { childList: true });
      body.__pierCollapseObs = mo;
    }
  }

  global.PierCollapse = {
    install: install,
    decorate: decorate,
    expandAll: function () { collapsed = Object.create(null); decorate(); },
    collapseAll: function () {
      buildGroups().forEach(function (g) { collapsed[g.key] = 1; });
      decorate();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(typeof window !== 'undefined' ? window : this);
