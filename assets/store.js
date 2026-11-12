/*!
 * store.js — 查驗整合版共用資料層（localStorage + 聯動 + 匯出）
 *
 * 資料結構（version 3）：
 * {
 *   version: 3,
 *   piles: [ { pier, pileNo, type, side, plannedStart, plannedEnd,
 *              workDate, status, inspectStatus, inspectDate,
 *              progressDate, note } ],
 *
 *   workDate = 施作日期（單一日期，取代舊版 actualStart／actualEnd）
 *   舊資料相容：載入時 workDate = actualEnd || actualStart
 *   logs:  [ { id, date, inspector, supervisor, location, pier, piers:[...], piles:[pileNo...] } ]
 * }
 *
 * 相容性：
 *   - version 1 的 logs 沒有 piles 陣列 → 自動以 pier 推導（該墩全部樁號）
 *   - 舊格式 pier: "PR4、PR3" → 自動拆成多墩
 *   - 匯入舊 JSON 亦可正常讀取
 *
 * 聯動規則（recompute）：
 *   1. 每筆查驗紀錄若有 piles，只把「該筆列出的樁號」標記為已查驗
 *   2. 若無 piles 但有 pier（舊資料），則該墩全部樁號標記為已查驗
 *   3. 多筆紀錄時，以「最新日期」為準
 *   4. 完成狀態優先順序：已查驗 → 已完成；未查驗但有施作日期 → 施作中；都沒有 → 未施作
 *   5. 進度日期（progressDate）：以查驗日期為基準，沒有查驗才回退施作日期（workDate）
 *
 * 瀏覽器：window.SuiteStore
 */
(function (global) {
  'use strict';

  var KEY = 'inspection-suite-data-v1';
  var LEGACY_LOG_KEY = 'inspection-log-rows-v1';
  var DATA_VERSION = 3;

  /* 樁號定義：沿用「預壘樁進度管控表.xlsx」的樁號、樁數、類型、岸別、預定日期 */
  var PIER_DEFS = [
    { pier: 'PR4',  count: 4, type: 'TYPE A', side: '右岸', start: '2026-10-26', end: '2026-10-27' },
    { pier: 'PR3',  count: 4, type: 'TYPE A', side: '右岸', start: '2026-10-29', end: '2026-10-29' },
    { pier: 'PR5',  count: 4, type: 'TYPE A', side: '右岸', start: '2026-10-31', end: '2026-10-31' },
    { pier: 'PR2',  count: 9, type: 'TYPE B', side: '右岸', start: '2026-11-02', end: '2026-11-03' },
    { pier: 'PR6',  count: 4, type: 'TYPE A', side: '右岸', start: '2026-11-05', end: '2026-11-05' },
    { pier: 'PR10', count: 9, type: 'TYPE B', side: '右岸', start: '2026-11-07', end: '2026-11-08' },
    { pier: 'PR7',  count: 4, type: 'TYPE A', side: '右岸', start: '2026-11-10', end: '2026-11-10' },
    { pier: 'PR1',  count: 9, type: 'TYPE B', side: '右岸', start: '2026-11-12', end: '2026-11-13' },
    { pier: 'PR8',  count: 4, type: 'TYPE A', side: '右岸', start: '2026-11-15', end: '2026-11-15' },
    { pier: 'PR9',  count: 9, type: 'TYPE B', side: '右岸', start: '2026-11-17', end: '2026-11-18' },
    { pier: 'PL7',  count: 4, type: 'TYPE A', side: '左岸', start: '2026-11-20', end: '2026-11-20' },
    { pier: 'PL6',  count: 4, type: 'TYPE A', side: '左岸', start: '2026-11-22', end: '2026-11-22' },
    { pier: 'PL5',  count: 4, type: 'TYPE A', side: '左岸', start: '2026-11-24', end: '2026-11-24' },
    { pier: 'PL4',  count: 9, type: 'TYPE C', side: '左岸', start: '2026-11-26', end: '2026-11-27' },
    { pier: 'PL3',  count: 9, type: 'TYPE C', side: '左岸', start: '2026-11-29', end: '2026-11-30' },
    { pier: 'PL2',  count: 9, type: 'TYPE C', side: '左岸', start: '2026-12-02', end: '2026-12-03' },
    { pier: 'PL1',  count: 9, type: 'TYPE C', side: '左岸', start: '2026-12-05', end: '2026-12-06' },
    { pier: 'PLAT', count: 9, type: 'TYPE C', side: '左岸', start: '2026-12-08', end: '2026-12-09' },
    { pier: 'RC1',  count: 4, type: 'TYPE A', side: '復舊', start: '2026-12-11', end: '2026-12-11' }
  ];

  var STATUS_LIST = ['未施作', '施作中', '已完成'];
  var INSPECT_LIST = ['未查驗', '已查驗'];

  /* ---------------- 基礎工具 ---------------- */

  /* 共用工具：優先用 assets/core.js（全站同一份），沒有才用本地備援。
     原本這四個函式在 store.js / 各頁 / gdrive 模組各有一份，行為還略有差異。 */
  var CORE = global.Core || null;

  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    if (CORE && CORE.todayISO) return CORE.todayISO();
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function isoToSlash(iso) {
    if (CORE && CORE.isoToSlash) return CORE.isoToSlash(iso);
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[0] + '/' + p[1] + '/' + p[2];
  }

  function esc(s) {
    if (CORE && CORE.esc) return CORE.esc(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------------- 預設資料 ---------------- */

  function defaultPiles() {
    var out = [];
    PIER_DEFS.forEach(function (d) {
      for (var i = 1; i <= d.count; i++) {
        out.push({
          pier: d.pier,
          pileNo: d.pier + '-' + i,
          type: d.type,
          side: d.side,
          plannedStart: d.start,
          plannedEnd: d.end,
          workDate: '',
          status: '未施作',
          inspectStatus: '未查驗',
          inspectDate: '',
          progressDate: '',
          note: ''
        });
      }
    });
    return out;
  }

  function defaultData() {
    return { version: DATA_VERSION, piles: defaultPiles(), logs: [] };
  }

  /* ---------------- 讀寫 ---------------- */

  /** 把任意來源的 piles 陣列正規化為字串陣列（去重、去空白） */
  function normPileList(arr) {
    var out = [], seen = {};
    (Array.isArray(arr) ? arr : (arr == null ? [] : [arr])).forEach(function (v) {
      /* 相容舊資料：單一字串內以「、」「，」「,」「;」「/」串接多筆 */
      String(v == null ? '' : v).split(/[、，,;；\/]+/).forEach(function (raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s || seen[s]) return;
        seen[s] = true;
        out.push(s);
      });
    });
    return out;
  }

  function normalize(d) {
    d = d || {};
    var base = defaultPiles();
    var byNo = {};
    base.forEach(function (p) { byNo[p.pileNo] = p; });

    var piles = (Array.isArray(d.piles) ? d.piles : []).map(function (p) {
      p = p || {};
      var def = byNo[p.pileNo] || {};
      return {
        pier: String(p.pier || def.pier || ''),
        pileNo: String(p.pileNo || def.pileNo || ''),
        type: String(p.type || def.type || ''),
        side: String(p.side || def.side || ''),
        plannedStart: String(p.plannedStart || def.plannedStart || ''),
        plannedEnd: String(p.plannedEnd || def.plannedEnd || ''),
        /* 施作日期：新格式 workDate；舊格式 actualEnd 優先、其次 actualStart */
        workDate: String(p.workDate || p.actualEnd || p.actualStart || ''),
        status: String(p.status || '未施作'),
        inspectStatus: String(p.inspectStatus || '未查驗'),
        inspectDate: String(p.inspectDate || ''),
        progressDate: String(p.progressDate || ''),
        note: String(p.note || '')
      };
    });

    /* 若匯入資料缺少某些樁，補回預設（避免進度表不完整） */
    var have = {};
    piles.forEach(function (p) { have[p.pileNo] = true; });
    base.forEach(function (p) { if (!have[p.pileNo]) piles.push(p); });

    var logs = (Array.isArray(d.logs) ? d.logs : []).map(function (l) {
      l = l || {};
      var list = normPileList(l.piles);
      var piers = normPileList(l.piers);
      var pier = String(l.pier || '');

      /* 舊資料（單一墩號字串，可能含「、」串接多墩）→ 轉為 piers 陣列 */
      if (!piers.length && pier) piers = normPileList(pier);

      /* 只有樁號清單時，由樁號推導墩號 */
      if (!piers.length && list.length) {
        list.forEach(function (no) {
          var p = byNo[no];
          if (p && piers.indexOf(p.pier) < 0) piers.push(p.pier);
        });
      }

      /* 有墩號但沒有樁號清單 → 保留空清單，於 recompute 展開為該墩全部樁號 */
      if (!pier && piers.length) pier = piers[0];

      return {
        id: String(l.id || uid()),
        date: String(l.date || ''),
        inspector: String(l.inspector || ''),
        supervisor: String(l.supervisor || ''),
        location: String(l.location || ''),
        pier: pier,
        piers: piers,
        piles: list
      };
    });

    return { version: DATA_VERSION, piles: piles, logs: logs };
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }

    /* 快取：load() 原本每次呼叫都 JSON.parse＋normalize＋recompute（iPhone 約 30ms／次）。
       log 頁的 refreshPileSelect() 會為每個墩號各呼叫一次（19 墩 → 約 570ms／次按鍵），
       打字時主執行緒被卡住，畫面因此「出不來」。以原始字串為鍵快取，內容沒變就不重算。 */
    if (raw !== null && raw === cacheRaw && cacheData) return cacheData;

    var d = null;
    if (raw) { try { d = JSON.parse(raw); } catch (e) { d = null; } }

    if (!d) {
      d = defaultData();
      /* 舊版查驗紀錄表資料搬移（只搬一次） */
      try {
        var legacy = localStorage.getItem(LEGACY_LOG_KEY);
        if (legacy) {
          var arr = JSON.parse(legacy);
          if (Array.isArray(arr) && arr.length) {
            d.logs = arr.map(function (r) {
              return {
                id: uid(),
                date: String((r && r.date) || ''),
                inspector: String((r && r.inspector) || ''),
                supervisor: String((r && r.supervisor) || ''),
                location: String((r && r.location) || ''),
                pier: String((r && r.pier) || ''),
                piles: normPileList(r && r.piles)
              };
            });
          }
        }
      } catch (e2) { /* 忽略 */ }
    }

    d = normalize(d);
    recompute(d);

    cacheRaw = raw;
    cacheData = d;
    return d;
  }

  /** 清掉 load() 快取（save() 之後呼叫） */
  function invalidate() { cacheRaw = null; cacheData = null; }

  /**
   * 儲存。回傳 true／false。
   * 原本只吞掉錯誤，使用者完全不知道資料沒存進去（配額爆掉時最常見）。
   * 現在把失敗原因記在 lastError，讓頁面可以提示。
   */
  var lastError = '';

  /* load() 快取（見 load 內的說明） */
  var cacheRaw = null;
  var cacheData = null;

  function save(d) {
    lastError = '';
    invalidate();
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (e) {
      var quota = /quota|exceed/i.test(String((e && e.name) || '') + String((e && e.message) || ''));
      lastError = quota
        ? '瀏覽器本機儲存空間已滿，請先匯出備份並清理舊資料'
        : ('儲存失敗：' + ((e && e.message) || e));
      return false;
    }
  }

  function getLastError() { return lastError; }

  /* ---------------- 聯動核心 ---------------- */

  /** 取得某筆紀錄涵蓋的墩號清單（相容舊資料的單一 pier） */
  function logPiers(d, l) {
    if (!l) return [];
    var out = normPileList(l.piers);
    if (out.length) return out;
    if (l.pier) return [String(l.pier)];
    /* 只有樁號清單時，由樁號推導墩號 */
    var byNo = {};
    (d && d.piles ? d.piles : []).forEach(function (p) { byNo[p.pileNo] = p; });
    normPileList(l.piles).forEach(function (no) {
      var p = byNo[no];
      if (p && out.indexOf(p.pier) < 0) out.push(p.pier);
    });
    return out;
  }

  /** 取得某筆紀錄實際涵蓋的樁號清單（含舊資料以墩號推導） */
  function logPileNos(d, l) {
    if (!l) return [];
    if (Array.isArray(l.piles) && l.piles.length) return l.piles.slice();
    var piers = logPiers(d, l);
    if (!piers.length) return [];
    var out = [];
    (d.piles || []).forEach(function (p) {
      if (piers.indexOf(p.pier) >= 0) out.push(p.pileNo);
    });
    return out;
  }

  /**
   * 查驗位置顯示字串：墩號／樁號自動併入位置文字（不再另設獨立欄位）
   *   有樁號 → 「PR4-1、PR4-2 橋墩基礎」
   *   只有墩號 → 「PR4 墩 橋墩基礎」
   */
  function composeLocation(d, l) {
    if (!l) return '';
    var piers = logPiers(d, l);
    var piles = logPileNos(d, l);
    var txt = String(l.location || '').trim();
    var head = '';
    if (piles.length) head = piles.join('、');
    else if (piers.length) head = piers.join('、') + ' 墩';
    return [head, txt].filter(Boolean).join(' ');
  }

  function recompute(d) {
    if (!d) return d;

    /* 1. 查驗狀態歸零後，依查驗紀錄重算 */
    d.piles.forEach(function (p) {
      p.inspectStatus = '未查驗';
      p.inspectDate = '';
    });

    var byNo = {};
    d.piles.forEach(function (p) { byNo[p.pileNo] = p; });

    var logs = (d.logs || []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });

    logs.forEach(function (l) {
      logPileNos(d, l).forEach(function (no) {
        var p = byNo[no];
        if (!p) return;
        p.inspectStatus = '已查驗';
        p.inspectDate = l.date || '';
      });
    });

    /* 2. 完成狀態判定（優先順序）：
     *      已查驗              → 已完成（不論施作日期是否填寫）
     *      未查驗但有施作日期   → 施作中
     *      都沒有              → 未施作
     */
    d.piles.forEach(function (p) {
      if (p.inspectStatus === '已查驗') p.status = '已完成';
      else if (p.workDate) p.status = '施作中';
      else p.status = '未施作';

      /* 3. 進度日期：以查驗日期為基準（有查驗就用查驗日期），
       *    沒有查驗才回退施作日期。進度差異與墩彙總都以此為準。 */
      p.progressDate = p.inspectDate || p.workDate || '';
    });

    return d;
  }

  /* ---------------- 查詢 ---------------- */

  function pierList() {
    return PIER_DEFS.map(function (d) { return d.pier; });
  }

  function pierDef(pier) {
    for (var i = 0; i < PIER_DEFS.length; i++) {
      if (PIER_DEFS[i].pier === pier) return PIER_DEFS[i];
    }
    return null;
  }

  function pilesOf(d, pier) {
    return (d.piles || []).filter(function (p) { return p.pier === pier; });
  }

  /** 某墩的樁號清單（字串陣列），供兩層下拉使用 */
  function pileNosOf(d, pier) {
    return pilesOf(d, pier).map(function (p) { return p.pileNo; });
  }

  /** 某墩相關的查驗紀錄（含 piles 交集者） */
  function logsOf(d, pier) {
    /* 原本在迴圈裡對每個樁號再 filter 一次 d.piles（O(logs×piles×piles)），
       121 支樁 × 300 筆紀錄在 iPhone 上約 10ms／次。先建 pileNo → pier 索引表即降為線性。 */
    var byNo = {};
    (d.piles || []).forEach(function (p) { byNo[p.pileNo] = p.pier; });
    return (d.logs || []).filter(function (l) {
      if (logPiers(d, l).indexOf(pier) >= 0) return true;
      var nos = logPileNos(d, l);
      for (var i = 0; i < nos.length; i++) {
        if (byNo[nos[i]] === pier) return true;
      }
      return false;
    }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  }

  /* ---------------- 墩彙總 ---------------- */

  function minOf(arr) {
    var m = '';
    arr.forEach(function (v) { if (v && (!m || v < m)) m = v; });
    return m;
  }

  function maxOf(arr) {
    var m = '';
    arr.forEach(function (v) { if (v && v > m) m = v; });
    return m;
  }

  /**
   * 墩號彙總：每個墩的樁數、已查驗支數、墩開始時間、整墩結束時間、墩狀態
   *   墩開始時間   = 該墩所有樁中最早的實際開始日期；若無實際開始，取最早的查驗日期
   *   整墩結束時間 = 該墩所有樁都完成時，取最晚的實際完成／查驗日期；
   *                  若還有樁未完成，end 為空、endText 顯示「進行中（未完成 N 支）」
   */
  function pierSummary(d) {
    var out = [];
    PIER_DEFS.forEach(function (def) {
      var piles = pilesOf(d, def.pier);
      if (!piles.length) return;

      var inspected = 0, done = 0, doing = 0;
      var starts = [], inspects = [], ends = [];

      piles.forEach(function (p) {
        if (p.inspectStatus === '已查驗') inspected++;
        if (p.status === '已完成') done++;
        else if (p.status === '施作中') doing++;
        if (p.workDate) starts.push(p.workDate);
        if (p.inspectDate) inspects.push(p.inspectDate);
        if (p.workDate) ends.push(p.workDate);
        if (p.inspectDate) ends.push(p.inspectDate);
      });

      var start = starts.length ? minOf(starts) : minOf(inspects);
      var allDone = done === piles.length;
      var end = allDone ? maxOf(ends) : '';
      var notDone = piles.length - done;
      var status = allDone ? '已完成' : ((done > 0 || doing > 0) ? '施作中' : '未施作');

      out.push({
        pier: def.pier,
        type: def.type,
        side: def.side,
        count: piles.length,
        inspected: inspected,
        done: done,
        doing: doing,
        notDone: notDone,
        start: start,
        end: end,
        allDone: allDone,
        status: status,
        startText: isoToSlash(start) || '—',
        endText: allDone ? (isoToSlash(end) || '—') : ('進行中（未完成 ' + notDone + ' 支）')
      });
    });
    return out;
  }

  function summary(d) {
    var total = (d.piles || []).length;
    var done = 0, doing = 0, inspected = 0, progressed = 0;
    var today = todayISO();
    var plannedToDate = 0;

    (d.piles || []).forEach(function (p) {
      if (p.status === '已完成') done++;
      else if (p.status === '施作中') doing++;
      if (p.inspectStatus === '已查驗') inspected++;
      /* 有實際進度日期（查驗日期優先）者視為已推進 */
      if (p.progressDate) progressed++;
      if (p.plannedEnd && p.plannedEnd <= today) plannedToDate++;
    });

    return {
      total: total,
      done: done,
      doing: doing,
      notStarted: total - done - doing,
      inspected: inspected,
      notInspected: total - inspected,
      progressed: progressed,
      plannedToDate: plannedToDate,
      /* 進度差異（實際－預定）：以查驗日期為基準的實際完成支數 － 已到預定完成日支數 */
      diff: progressed - plannedToDate,
      percent: total ? Math.round(done / total * 1000) / 10 : 0
    };
  }

  /* ---------------- 排序 ---------------- */

  /**
   * 排序樁位：
   *   mode='actual'（預設）→ 有實際開始日期者依日期由早到晚排前面，沒有實際日期的排後面
   *   mode='pier'          → 依墩號（原始順序）、樁號
   *   mode='inspect'       → 已查驗者依查驗日期由舊到新排前面，未查驗者排後面
   * 三種模式最後都以墩號、樁號作穩定次要排序。
   */
  function sortPiles(piles, mode) {
    var pierOrder = {};
    PIER_DEFS.forEach(function (d, i) { pierOrder[d.pier] = i; });

    function pileSeq(no) {
      var m = String(no).match(/-(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    }

    /* 次要排序：墩號（原始順序）→ 樁號 */
    function tieBreak(a, b) {
      var pa = pierOrder[a.pier] == null ? 999 : pierOrder[a.pier];
      var pb = pierOrder[b.pier] == null ? 999 : pierOrder[b.pier];
      if (pa !== pb) return pa - pb;
      return pileSeq(a.pileNo) - pileSeq(b.pileNo);
    }

    var arr = (piles || []).slice();

    if (mode === 'pier') {
      arr.sort(tieBreak);
      return arr;
    }

    /* mode === 'inspect'：已查驗者依查驗日期舊→新排前，未查驗者排後 */
    if (mode === 'inspect') {
      arr.sort(function (a, b) {
        var ia = a.inspectStatus === '已查驗';
        var ib = b.inspectStatus === '已查驗';
        if (ia !== ib) return ia ? -1 : 1;              /* 已查驗者優先 */
        if (ia && ib) {
          var da = a.inspectDate || '';
          var db = b.inspectDate || '';
          if (da !== db) return da < db ? -1 : 1;       /* 查驗日期舊→新 */
        }
        return tieBreak(a, b);
      });
      return arr;
    }

    /* mode === 'actual' */
    arr.sort(function (a, b) {
      var sa = a.workDate || '';
      var sb = b.workDate || '';
      var ha = !!sa, hb = !!sb;
      if (ha !== hb) return ha ? -1 : 1;          /* 有實際日期者優先 */
      if (ha && hb && sa !== sb) return sa < sb ? -1 : 1;  /* 日期早的在前 */
      return tieBreak(a, b);
    });
    return arr;
  }

  /* ---------------- 材料管控 ---------------- */

  /* 材料資料獨立存放於另一個 localStorage 鍵，完全不動 piles／logs 的既有結構，
     因此已上傳紀錄與舊版 JSON 匯出檔都不受影響。 */
  var MAT_KEY = 'inspection-materials-v1';

  /* 一支預壘樁的設計方數 */
  var DESIGN_M3_PER_PILE = 6;

  /* 方數換算：水泥 0.8 m³ = 1 T；濕細沙 0.59 m³ = 1 T */
  var MATERIAL_DEFS = [
    { key: 'cement', name: '水泥',   m3PerTon: 0.8  },
    { key: 'sand',   name: '濕細沙', m3PerTon: 0.59 }
  ];

  function materialDef(key) {
    for (var i = 0; i < MATERIAL_DEFS.length; i++) {
      if (MATERIAL_DEFS[i].key === key) return MATERIAL_DEFS[i];
    }
    return null;
  }

  function materialName(key) {
    var d = materialDef(key);
    return d ? d.name : String(key || '');
  }

  /** 噸數 → 方數（依材料別換算） */
  function tonsToM3(key, tons) {
    var d = materialDef(key);
    var t = parseFloat(tons);
    if (!d || !isFinite(t)) return 0;
    return t * d.m3PerTon;
  }

  function normalizeMaterials(arr) {
    return (Array.isArray(arr) ? arr : []).map(function (m) {
      m = m || {};
      var key = String(m.type || m.material || 'cement');
      if (!materialDef(key)) key = 'cement';
      var tons = parseFloat(m.tons);
      if (!isFinite(tons) || tons < 0) tons = 0;
      return {
        id: String(m.id || uid()),
        date: String(m.date || ''),
        type: key,
        tons: tons,
        note: String(m.note || '')
      };
    }).filter(function (m) { return m.tons > 0; });
  }

  function loadMaterials() {
    var raw = null;
    try { raw = localStorage.getItem(MAT_KEY); } catch (e) { raw = null; }
    if (!raw) return [];
    var arr = null;
    try { arr = JSON.parse(raw); } catch (e) { arr = null; }
    return normalizeMaterials(arr);
  }

  function saveMaterials(list) {
    try {
      localStorage.setItem(MAT_KEY, JSON.stringify(normalizeMaterials(list)));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 材料統計
   *   pileCount  = 全案樁數（設計需求方數 = pileCount × 6）
   *   回傳每種材料的噸數／方數、合計方數、與設計需求的差額與達成率
   */
  function materialSummary(list, pileCount, inspectedCount) {
    var byType = {};
    MATERIAL_DEFS.forEach(function (d) {
      byType[d.key] = { key: d.key, name: d.name, m3PerTon: d.m3PerTon, tons: 0, m3: 0, count: 0 };
    });

    var totalTons = 0, totalM3 = 0;
    (Array.isArray(list) ? list : []).forEach(function (m) {
      var d = materialDef(m.type);
      if (!d) return;
      var t = parseFloat(m.tons) || 0;
      var v = t * d.m3PerTon;
      byType[d.key].tons += t;
      byType[d.key].m3 += v;
      byType[d.key].count += 1;
      totalTons += t;
      totalM3 += v;
    });

    var piles = parseInt(pileCount, 10);
    if (!isFinite(piles) || piles < 0) piles = 0;
    var designM3 = piles * DESIGN_M3_PER_PILE;
    var diffM3 = totalM3 - designM3;
    var percent = designM3 > 0 ? Math.round(totalM3 / designM3 * 1000) / 10 : 0;

    /* 已查驗需求：已查驗樁支數 × 6 方（與全案需求並存，供兩種對照） */
    var insp = parseInt(inspectedCount, 10);
    if (!isFinite(insp) || insp < 0) insp = 0;
    if (insp > piles) insp = piles;
    var inspectedDesignM3 = insp * DESIGN_M3_PER_PILE;
    var inspectedDiffM3 = totalM3 - inspectedDesignM3;
    var inspectedPercent = inspectedDesignM3 > 0 ? Math.round(totalM3 / inspectedDesignM3 * 1000) / 10 : 0;

    return {
      piles: piles,
      designM3PerPile: DESIGN_M3_PER_PILE,
      designM3: designM3,
      totalTons: Math.round(totalTons * 1000) / 1000,
      totalM3: Math.round(totalM3 * 1000) / 1000,
      diffM3: Math.round(diffM3 * 1000) / 1000,
      percent: percent,
      /* 已查驗對照（新增欄位，舊資料與舊程式不受影響） */
      inspectedPiles: insp,
      inspectedDesignM3: inspectedDesignM3,
      inspectedDiffM3: Math.round(inspectedDiffM3 * 1000) / 1000,
      inspectedPercent: inspectedPercent,
      count: (Array.isArray(list) ? list : []).length,
      byType: MATERIAL_DEFS.map(function (d) {
        var o = byType[d.key];
        return {
          key: o.key, name: o.name, m3PerTon: o.m3PerTon, count: o.count,
          tons: Math.round(o.tons * 1000) / 1000,
          m3: Math.round(o.m3 * 1000) / 1000
        };
      })
    };
  }

  /** 材料紀錄 → Excel 列資料 */
  function materialRows(list) {
    var head = ['日期', '材料', '噸數', '換算方數', '備註'];
    var rows = [head];
    (Array.isArray(list) ? list : []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    }).forEach(function (m) {
      var d = materialDef(m.type);
      rows.push([
        isoToSlash(m.date),
        d ? d.name : String(m.type || ''),
        String(m.tons),
        String(Math.round((parseFloat(m.tons) || 0) * (d ? d.m3PerTon : 0) * 1000) / 1000),
        m.note || ''
      ]);
    });
    return rows;
  }

  var MATERIAL_WIDTHS = [14, 12, 10, 12, 30];

  /**
   * 材料紀錄 → 依材料分組的 Excel 列資料（水泥一組、濕細沙一組，各自獨立）
   * 每組欄位：日期／噸數／換算方數／備註（不再有「材料」欄，因為整張表就是同一種材料）
   */
  function materialRowsByType(list, typeKey) {
    var head = ['日期', '噸數', '換算方數', '備註'];
    var rows = [head];
    (Array.isArray(list) ? list : []).filter(function (m) {
      return String(m.type || 'cement') === typeKey;
    }).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    }).forEach(function (m) {
      var d = materialDef(m.type);
      rows.push([
        isoToSlash(m.date),
        String(m.tons),
        String(Math.round((parseFloat(m.tons) || 0) * (d ? d.m3PerTon : 0) * 1000) / 1000),
        m.note || ''
      ]);
    });
    return rows;
  }

  var MATERIAL_TYPE_WIDTHS = [14, 10, 12, 30];

  /**
   * 材料紀錄 → 依材料分組的結構化物件（供 JSON 匯出使用）
   * 水泥一組、濕細沙一組，各自有 records（日期／噸數／換算方數／備註）與小計。
   * 這是「新增的選用欄位」，原本的 data.materials 陣列仍完整保留，舊資料／舊程式不受影響。
   */
  function materialsByType(list) {
    var out = {};
    MATERIAL_DEFS.forEach(function (d) {
      out[d.key] = { key: d.key, name: d.name, m3PerTon: d.m3PerTon, count: 0, tons: 0, m3: 0, records: [] };
    });
    (Array.isArray(list) ? list : []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    }).forEach(function (m) {
      var d = materialDef(m.type);
      if (!d) return;
      var t = parseFloat(m.tons) || 0;
      var v = Math.round(t * d.m3PerTon * 1000) / 1000;
      var o = out[d.key];
      o.count += 1;
      o.tons = Math.round((o.tons + t) * 1000) / 1000;
      o.m3 = Math.round((o.m3 + v) * 1000) / 1000;
      o.records.push({ date: m.date, tons: t, m3: v, note: m.note || '' });
    });
    return out;
  }

  /* ---------------- JSON 匯出／匯入 ---------------- */

  function exportJSON(d) {
    var mats = loadMaterials();
    var payload = {
      app: 'inspection-suite',
      kind: 'progress+logs',
      version: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      /* materials 為新增的選用欄位；舊版程式讀到會忽略，舊檔沒有此欄位也能正常匯入 */
      data: { version: DATA_VERSION, piles: d.piles, logs: d.logs, materials: mats },
      /* 墩號彙總：墩開始時間、整墩結束時間、墩狀態 */
      pierSummary: pierSummary(d),
      materialSummary: materialSummary(mats, (d.piles || []).length,
        (d.piles || []).filter(function (p) { return p.inspectStatus === '已查驗'; }).length),
      /* 依材料分組（水泥一組、濕細沙一組）；新增的選用欄位，舊程式讀到會忽略 */
      materialsByType: materialsByType(mats)
    };
    return JSON.stringify(payload, null, 2);
  }

  function importJSON(text) {
    var obj = JSON.parse(text);
    var d = obj && obj.data ? obj.data : obj;
    if (!d || (!Array.isArray(d.piles) && !Array.isArray(d.logs))) {
      throw new Error('檔案格式不符：找不到 piles 或 logs');
    }
    /* 材料為選用欄位：舊檔沒有就維持空清單，不影響匯入 */
    var mats = null;
    if (Array.isArray(d.materials)) mats = d.materials;
    else if (obj && Array.isArray(obj.materials)) mats = obj.materials;

    d = normalize(d);
    recompute(d);
    if (mats) d.materials = normalizeMaterials(mats);
    return d;
  }

  /* ---------------- Excel（.xlsx）產生器 ---------------- */

  function colName(n) {
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="標楷體"/><charset val="136"/></font>' +
    '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="標楷體"/><charset val="136"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF2F5597"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FF9E9E9E"/></left><right style="thin"><color rgb="FF9E9E9E"/></right>' +
    '<top style="thin"><color rgb="FF9E9E9E"/></top><bottom style="thin"><color rgb="FF9E9E9E"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
    '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function sheetXml(rows, widths) {
    var nCol = rows[0].length;
    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    out.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    out.push('<dimension ref="A1:' + colName(nCol) + rows.length + '"/>');
    out.push('<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15.75"/>');
    out.push('<cols>' + widths.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join('') + '</cols>');
    out.push('<sheetData>');

    rows.forEach(function (r, ri) {
      var rn = ri + 1;
      out.push('<row r="' + rn + '"' + (ri === 0 ? ' ht="26.1" customHeight="1"' : ' ht="21.95" customHeight="1"') + '>');
      r.forEach(function (v, ci) {
        var ref = colName(ci + 1) + rn;
        var s = ri === 0 ? 1 : 2;
        if (v === '' || v == null) {
          out.push('<c r="' + ref + '" s="' + s + '"/>');
        } else {
          out.push('<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' +
            esc(v) + '</t></is></c>');
        }
      });
      out.push('</row>');
    });

    out.push('</sheetData>');
    out.push('<printOptions horizontalCentered="1"/>');
    out.push('<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.5" footer="0.5"/>');
    out.push('<pageSetup paperSize="9" fitToHeight="0" orientation="landscape"/>');
    out.push('</worksheet>');
    return out.join('');
  }

  function buildXlsx(rows, widths, sheetName, JSZipRef) {
    return buildXlsxMulti([{ name: sheetName || '工作表1', rows: rows, widths: widths }], JSZipRef);
  }

  /**
   * 多工作表 Excel：sheets = [{ name, rows, widths }, ...]
   */
  function buildXlsxMulti(sheets, JSZipRef) {
    var Z = JSZipRef || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!Z) return Promise.reject(new Error('JSZip 未載入'));
    if (!sheets || !sheets.length) return Promise.reject(new Error('沒有工作表'));

    var zip = new Z();
    var n = sheets.length;

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
    for (var i = 1; i <= n; i++) {
      ct += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    ct += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
    zip.file('[Content_Types].xml', ct);

    zip.file('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');

    var sheetTags = '', relTags = '';
    sheets.forEach(function (s, idx) {
      var id = idx + 1;
      sheetTags += '<sheet name="' + esc(s.name || ('工作表' + id)) + '" sheetId="' + id + '" r:id="rId' + id + '"/>';
      relTags += '<Relationship Id="rId' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + id + '.xml"/>';
    });
    relTags += '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';

    zip.file('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetTags + '</sheets></workbook>');

    zip.file('xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      relTags + '</Relationships>');

    zip.file('xl/styles.xml', STYLES_XML);

    sheets.forEach(function (s, idx) {
      zip.file('xl/worksheets/sheet' + (idx + 1) + '.xml', sheetXml(s.rows, s.widths));
    });

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
  }

  /* 進度管控表 → 列資料（「施作查驗日期」：以查驗日期為準，無查驗才顯示施作日期） */
  function progressRows(d) {
    var head = ['墩號', '樁號', '類型', '岸別', '預定開始', '預定完成',
      '施作查驗日期', '完成狀態', '查驗狀態', '備註'];
    var rows = [head];
    (d.piles || []).forEach(function (p) {
      rows.push([
        p.pier, p.pileNo, p.type, p.side,
        isoToSlash(p.plannedStart), isoToSlash(p.plannedEnd),
        isoToSlash(p.progressDate),
        p.status, p.inspectStatus, p.note
      ]);
    });
    return rows;
  }

  var PROGRESS_WIDTHS = [9, 11, 9, 7, 12, 12, 14, 10, 12, 22];

  /* 墩號彙總 → 列資料（墩開始時間、整墩結束時間、墩狀態） */
  function pierSummaryRows(d) {
    var head = ['墩號', '類型', '岸別', '樁數', '已完成', '已查驗', '墩開始時間', '墩完成時間', '墩狀態'];
    var rows = [head];
    pierSummary(d).forEach(function (s) {
      rows.push([
        s.pier, s.type, s.side, s.count, s.done, s.inspected,
        s.startText, s.endText, s.status
      ]);
    });
    return rows;
  }

  var PIER_WIDTHS = [9, 9, 7, 7, 8, 8, 14, 24, 10];

  /* 查驗紀錄表 → 列資料（墩號／樁號已併入查驗位置，不另設欄位） */
  function logRows(d) {
    var head = ['日期', '查驗人員', '監造派員', '查驗位置'];
    var rows = [head];
    (d.logs || []).forEach(function (l) {
      rows.push([
        isoToSlash(l.date), l.inspector, l.supervisor, composeLocation(d, l)
      ]);
    });
    return rows;
  }

  var LOG_WIDTHS = [16, 18, 18, 52];

  global.SuiteStore = {
    KEY: KEY,
    DATA_VERSION: DATA_VERSION,
    PIER_DEFS: PIER_DEFS,
    STATUS_LIST: STATUS_LIST,
    INSPECT_LIST: INSPECT_LIST,
    uid: uid,
    todayISO: todayISO,
    isoToSlash: isoToSlash,
    defaultPiles: defaultPiles,
    defaultData: defaultData,
    normPileList: normPileList,
    normalize: normalize,
    load: load,
    save: save,
    getLastError: getLastError,
    recompute: recompute,
    logPiers: logPiers,
    logPileNos: logPileNos,
    composeLocation: composeLocation,
    pierList: pierList,
    pierDef: pierDef,
    pilesOf: pilesOf,
    pileNosOf: pileNosOf,
    logsOf: logsOf,
    summary: summary,
    pierSummary: pierSummary,
    sortPiles: sortPiles,
    exportJSON: exportJSON,
    importJSON: importJSON,
    buildXlsx: buildXlsx,
    buildXlsxMulti: buildXlsxMulti,
    progressRows: progressRows,
    PROGRESS_WIDTHS: PROGRESS_WIDTHS,
    pierSummaryRows: pierSummaryRows,
    PIER_WIDTHS: PIER_WIDTHS,
    logRows: logRows,
    LOG_WIDTHS: LOG_WIDTHS,
    invalidate: invalidate,

    /* 材料管控 */
    MAT_KEY: MAT_KEY,
    DESIGN_M3_PER_PILE: DESIGN_M3_PER_PILE,
    MATERIAL_DEFS: MATERIAL_DEFS,
    materialDef: materialDef,
    materialName: materialName,
    tonsToM3: tonsToM3,
    normalizeMaterials: normalizeMaterials,
    loadMaterials: loadMaterials,
    saveMaterials: saveMaterials,
    materialSummary: materialSummary,
    materialRows: materialRows,
    materialRowsByType: materialRowsByType,
    MATERIAL_TYPE_WIDTHS: MATERIAL_TYPE_WIDTHS,
    materialsByType: materialsByType,
    MATERIAL_WIDTHS: MATERIAL_WIDTHS
  };
})(typeof window !== 'undefined' ? window : this);
