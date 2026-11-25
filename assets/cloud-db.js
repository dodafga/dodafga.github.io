/* cloud-db.js — 全站資料整合與雲端存放／載入（共用模組）
 * 整合：樁位進度＋查驗紀錄、材料、樁位資料（緩存區）、已上傳紀錄、當日人員。
 */
(function (global) {
  'use strict';

  var C = global.Core;
  if (!C) return;

  var $ = C.$, esc = C.esc;
  var K = {
    suite: 'inspection-suite-data-v1',
    mats: 'inspection-materials-v1',
    pile: 'inspection-pile-measure-v1',
    hist: 'inspection-drive-photo-history',
    imported: 'inspection-drive-photo-imported',
    staff: 'inspection-daily-staff-v1',
    cur: 'inspection-daily-current-v1'
  };

  var PAYLOAD_KIND = 'full-backup';
  var PAYLOAD_VERSION = 4;

  function readJSON(key, dflt) {
    var raw = '';
    try { raw = localStorage.getItem(key) || ''; } catch (e) { raw = ''; }
    if (!raw) return dflt;
    try { return JSON.parse(raw); } catch (e) { return dflt; }
  }

  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }

  function collect() {
    var suite = obj(readJSON(K.suite, null)) || { piles: [], logs: [] };
    var mats = arr(readJSON(K.mats, []));
    var pile = arr(readJSON(K.pile, []));
    var hist = arr(readJSON(K.hist, []));
    var imported = obj(readJSON(K.imported, null)) || {};
    var staff = obj(readJSON(K.staff, null)) || {};
    var cur = obj(readJSON(K.cur, null)) || {};

    return {
      app: 'inspection-suite',
      kind: PAYLOAD_KIND,
      version: PAYLOAD_VERSION,
      savedAt: new Date().toISOString(),
      counts: {
        piles: arr(suite.piles).length,
        logs: arr(suite.logs).length,
        materials: mats.length,
        pileMeasure: pile.length,
        photos: hist.length
      },
      data: {
        version: suite.version || 3,
        piles: arr(suite.piles),
        logs: arr(suite.logs),
        materials: mats,
        pile: pile,
        hist: hist,
        imported: imported,
        staff: staff,
        cur: cur
      }
    };
  }

  function stats() { return collect().counts; }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function apply(payload) {
    if (!payload) return null;
    var d = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
    if (!d || typeof d !== 'object') return null;

    var out = { suite: 0, mats: 0, pile: 0, hist: 0, gaps: [] };
    var wrote = false;

    var s = obj(d.suite);
    var piles = arr(s ? s.piles : d.piles);
    var logs = arr(s ? s.logs : d.logs);
    if (piles.length || logs.length) {
      if (write(K.suite, { version: (s && s.version) || d.version || 3, piles: piles, logs: logs })) {
        out.suite = piles.length; wrote = true;
      }
    } else { out.gaps.push('piles/logs'); }

    var mats = Array.isArray(d.materials) ? d.materials
      : (s && Array.isArray(s.materials) ? s.materials : null);
    if (mats && write(K.mats, mats)) { out.mats = mats.length; wrote = true; }

    if (Array.isArray(d.pile) && write(K.pile, d.pile)) { out.pile = d.pile.length; wrote = true; }
    if (Array.isArray(d.hist) && write(K.hist, d.hist)) { out.hist = d.hist.length; wrote = true; }

    var imp = obj(d.imported); if (imp) write(K.imported, imp);
    var stf = obj(d.staff); if (stf && stf.date) write(K.staff, stf);
    var cur = obj(d.cur); if (cur && (cur.date || cur.pile)) write(K.cur, cur);

    if (!wrote) return null;
    refresh();
    return out;
  }

  function safe(fn) { try { fn(); } catch (e) {} }

  function refresh() {
    safe(function () { if (global.SuiteStore && global.SuiteStore.invalidate) global.SuiteStore.invalidate(); });
    safe(function () { if (global.__drivePageRefresh) global.__drivePageRefresh(); });
    safe(function () { if (global.__driveLibRefresh) global.__driveLibRefresh(); });
    safe(function () { if (global.__drivePendingRefresh) global.__drivePendingRefresh(); });
    safe(function () { global.dispatchEvent(new CustomEvent('cloud-applied')); });
  }

  function gd() { return global.GDrive || null; }

  function save() {
    var G = gd();
    if (!G || !G.isConfigured || !G.isConfigured()) {
      return Promise.reject(new Error('尚未設定 Google OAuth Client ID，請先到「設定」完成設定'));
    }
    var payload = collect();
    return G.save(payload).then(function () { return payload.counts; });
  }

  function load() {
    var G = gd();
    if (!G || !G.isConfigured || !G.isConfigured()) {
      return Promise.reject(new Error('尚未設定 Google OAuth Client ID，請先到「設定」完成設定'));
    }
    return G.load().then(function (j) {
      var payload = (j && j.data) ? j : (j || {});
      var res = apply(payload);
      if (!res) throw new Error('雲端檔案沒有任何可用的資料');
      res.savedAt = (payload && payload.savedAt) || '';
      return res;
    });
  }

  function summaryText(c) {
    if (!c) return '';
    return '樁位進度 ' + (c.piles || 0) + ' 支　·　查驗紀錄 ' + (c.logs || 0) +
      ' 筆　·　樁位資料 ' + (c.pileMeasure || 0) + ' 筆　·　材料 ' + (c.materials || 0) +
      ' 筆　·　已上傳照片 ' + (c.photos || 0) + ' 張';
  }

  var CSS = [
    '.cdb{display:flex;flex-direction:column;gap:10px}',
    '.cdb-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:700;color:#3a3a3e}',
    '.cdb-dot{width:9px;height:9px;border-radius:50%;background:#1f7a4d;flex:0 0 9px}',
    '.cdb-dot.busy{background:#c47f17;animation:cdbpulse 1s ease-in-out infinite}',
    '@keyframes cdbpulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '.cdb-sp{margin-left:auto}',
    '.cdb-line #cdbCounts{font-size:12px;font-weight:600;color:#6e6e74}',
    '.cdb-note{font-size:12.5px;line-height:1.65;color:#6e6e74}',
    '.cdb-note.ok{color:#1f7a4d;font-weight:700}',
    '.cdb-note.err{color:#b3261e;font-weight:700}',
    '.cdb-btns{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media(max-width:360px){.cdb-btns{grid-template-columns:1fr}}'
  ].join('');

  function injectCSS() {
    if (document.getElementById('cdb-style')) return;
    var st = document.createElement('style');
    st.id = 'cdb-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function mount(el, opts) {
    if (!el) return null;
    opts = opts || {};
    var node = (typeof el === 'string') ? $(el) : el;
    if (!node) return null;
    if (node.getAttribute('data-cdb-mounted') === '1') return node.__cdb;
    injectCSS();

    var toast = C.makeToast ? C.makeToast('toast', 3200) : function (m) { try { console.log(m); } catch (e) {} };

    node.setAttribute('data-cdb-mounted', '1');
    node.innerHTML = [
      '<div class="cdb">',
      '  <div class="cdb-line"><span class="cdb-dot" id="cdbDot"></span><span id="cdbState">本機資料</span><span class="cdb-sp"></span><span id="cdbCounts"></span></div>',
      '  <div class="cdb-note" id="cdbNote">' + esc(opts.note || '把本機全部資料（樁位進度、查驗紀錄、樁位資料、材料、已上傳紀錄）整合成一份存到 Google Drive；換裝置按「載入」就全部回來。') + '</div>',
      '  <div class="cdb-btns">',
      '    <button type="button" class="btn" id="cdbSave">☁ 存入雲端</button>',
      '    <button type="button" class="btn ghost" id="cdbLoad">⬇ 從雲端載入</button>',
      '  </div>',
      '  <div class="cdb-note" id="cdbMsg"></div>',
      '</div>'
    ].join('');

    var btnSave = $('cdbSave'), btnLoad = $('cdbLoad');
    var msg = $('cdbMsg'), cnt = $('cdbCounts'), st2 = $('cdbState'), dot = $('cdbDot');

    function paint() {
      var s = stats();
      if (cnt) cnt.textContent = summaryText(s);
    }

    function say(text, isErr) {
      if (!msg) return;
      msg.textContent = text || '';
      msg.className = 'cdb-note' + (isErr ? ' err' : (text ? ' ok' : ''));
    }

    function busy(on) {
      if (btnSave) btnSave.disabled = on;
      if (btnLoad) btnLoad.disabled = on;
      if (st2) st2.textContent = on ? '處理中…' : '本機資料';
      if (dot) dot.className = 'cdb-dot' + (on ? ' busy' : '');
    }

    C.on(btnSave, 'click', function () {
      busy(true); say('正在存到 Google Drive…');
      save().then(function (c) {
        say('已存入 Google Drive：' + summaryText(c));
        toast('已存入雲端（' + (c.piles || 0) + ' 支樁位進度、' + (c.logs || 0) + ' 筆查驗紀錄、' +
          (c.pileMeasure || 0) + ' 筆樁位資料）');
      }).catch(function (e) {
        var m = (e && e.message) ? e.message : '存入失敗';
        say('存入失敗：' + m, true); toast('存入雲端失敗：' + m, true);
      }).then(function () { busy(false); paint(); });
    });

    C.on(btnLoad, 'click', function () {
      var mine = stats();
      var warn = '將以雲端資料覆蓋本機目前內容。\n本機：' + summaryText(mine) +
        '\n\n雲端與本機若有不同，載入後一律以雲端為準。\n\n確定要載入嗎？';
      if (!global.confirm(warn)) return;
      busy(true); say('正在從 Google Drive 載入…');
      load().then(function (r) {
        say('已從雲端載入：樁位進度 ' + r.suite + ' 支、樁位資料 ' + r.pile +
          ' 筆、材料 ' + r.mats + ' 筆、已上傳照片 ' + r.hist + ' 張');
        toast('已從雲端載入全部資料');
      }).catch(function (e) {
        var m = (e && e.message) ? e.message : '載入失敗';
        say('載入失敗：' + m, true); toast('從雲端載入失敗：' + m, true);
      }).then(function () { busy(false); paint(); });
    });

    paint();
    var api = { paint: paint, refresh: function () { refresh(); paint(); } };
    node.__cdb = api;
    return api;
  }

  global.CloudDB = {
    KEYS: K,
    collect: collect,
    apply: apply,
    save: save,
    load: load,
    stats: stats,
    refresh: refresh,
    mount: mount,
    summary: summaryText
  };
})(typeof window !== 'undefined' ? window : this);
