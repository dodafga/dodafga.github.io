/*!
 * store.js — 查驗整合版共用資料層（localStorage + 聯動 + 匯出）
 *
 * 資料結構：
 * {
 *   version: 1,
 *   piles: [ { pier, pileNo, type, side, plannedStart, plannedEnd,
 *              actualStart, actualEnd, status, inspectStatus, inspectDate, note } ],
 *   logs:  [ { id, date, inspector, supervisor, location, pier } ]
 * }
 *
 * 聯動規則（recompute）：
 *   1. 每筆查驗紀錄若有 pier，該墩號下所有樁 → inspectStatus='已查驗'、inspectDate=紀錄日期
 *   2. 多筆紀錄時，以「最新日期」為準
 *   3. 完成狀態由實際日期自動推導（有實際完成→已完成；有實際開始→施作中）
 *
 * 瀏覽器：window.SuiteStore
 */
(function (global) {
  'use strict';

  var KEY = 'inspection-suite-data-v1';
  var LEGACY_LOG_KEY = 'inspection-log-rows-v1';

  /* 墩號定義：沿用「預壘樁進度管控表.xlsx」的墩號、樁數、類型、岸別、預定日期 */
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

  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function todayISO() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function isoToSlash(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[0] + '/' + p[1] + '/' + p[2];
  }

  function esc(s) {
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
          actualStart: '',
          actualEnd: '',
          status: '未施作',
          inspectStatus: '未查驗',
          inspectDate: '',
          note: ''
        });
      }
    });
    return out;
  }

  function defaultData() {
    return { version: 1, piles: defaultPiles(), logs: [] };
  }

  /* ---------------- 讀寫 ---------------- */

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
        actualStart: String(p.actualStart || ''),
        actualEnd: String(p.actualEnd || ''),
        status: String(p.status || '未施作'),
        inspectStatus: String(p.inspectStatus || '未查驗'),
        inspectDate: String(p.inspectDate || ''),
        note: String(p.note || '')
      };
    });

    /* 若匯入資料缺少某些樁，補回預設（避免進度表不完整） */
    var have = {};
    piles.forEach(function (p) { have[p.pileNo] = true; });
    base.forEach(function (p) { if (!have[p.pileNo]) piles.push(p); });

    var logs = (Array.isArray(d.logs) ? d.logs : []).map(function (l) {
      l = l || {};
      return {
        id: String(l.id || uid()),
        date: String(l.date || ''),
        inspector: String(l.inspector || ''),
        supervisor: String(l.supervisor || ''),
        location: String(l.location || ''),
        pier: String(l.pier || '')
      };
    });

    return { version: 1, piles: piles, logs: logs };
  }

  function load() {
    var d = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) d = JSON.parse(raw);
    } catch (e) { d = null; }

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
                pier: ''
              };
            });
          }
        }
      } catch (e2) { /* 忽略 */ }
    }

    d = normalize(d);
    recompute(d);
    return d;
  }

  function save(d) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 聯動核心 ---------------- */

  function recompute(d) {
    if (!d) return d;

    /* 1. 查驗狀態歸零後，依查驗紀錄重算 */
    d.piles.forEach(function (p) {
      p.inspectStatus = '未查驗';
      p.inspectDate = '';
    });

    var logs = (d.logs || []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });

    logs.forEach(function (l) {
      if (!l.pier) return;
      d.piles.forEach(function (p) {
        if (p.pier !== l.pier) return;
        p.inspectStatus = '已查驗';
        p.inspectDate = l.date || '';
      });
    });

    /* 2. 完成狀態：有實際日期就自動推導，否則保留原值 */
    d.piles.forEach(function (p) {
      if (p.actualEnd) p.status = '已完成';
      else if (p.actualStart) p.status = '施作中';
      else if (p.status === '已完成' || p.status === '施作中') p.status = '未施作';
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

  function logsOf(d, pier) {
    return (d.logs || []).filter(function (l) { return l.pier === pier; })
      .sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
  }

  function summary(d) {
    var total = (d.piles || []).length;
    var done = 0, doing = 0, inspected = 0;
    var today = todayISO();
    var plannedToDate = 0;

    (d.piles || []).forEach(function (p) {
      if (p.status === '已完成') done++;
      else if (p.status === '施作中') doing++;
      if (p.inspectStatus === '已查驗') inspected++;
      if (p.plannedEnd && p.plannedEnd <= today) plannedToDate++;
    });

    return {
      total: total,
      done: done,
      doing: doing,
      notStarted: total - done - doing,
      inspected: inspected,
      notInspected: total - inspected,
      plannedToDate: plannedToDate,
      diff: done - plannedToDate,
      percent: total ? Math.round(done / total * 1000) / 10 : 0
    };
  }

  /* ---------------- JSON 匯出／匯入 ---------------- */

  function exportJSON(d) {
    var payload = {
      app: 'inspection-suite',
      kind: 'progress+logs',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: { version: 1, piles: d.piles, logs: d.logs }
    };
    return JSON.stringify(payload, null, 2);
  }

  function importJSON(text) {
    var obj = JSON.parse(text);
    var d = obj && obj.data ? obj.data : obj;
    if (!d || (!Array.isArray(d.piles) && !Array.isArray(d.logs))) {
      throw new Error('檔案格式不符：找不到 piles 或 logs');
    }
    d = normalize(d);
    recompute(d);
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
    var Z = JSZipRef || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!Z) return Promise.reject(new Error('JSZip 未載入'));

    var zip = new Z();
    var name = sheetName || '工作表1';

    zip.file('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>');

    zip.file('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');

    zip.file('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + esc(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>');

    zip.file('xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');

    zip.file('xl/styles.xml', STYLES_XML);
    zip.file('xl/worksheets/sheet1.xml', sheetXml(rows, widths));

    return zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
  }

  /* 進度管控表 → 列資料 */
  function progressRows(d) {
    var head = ['墩號', '樁號', '類型', '岸別', '預定開始', '預定完成',
      '實際開始', '實際完成', '完成狀態', '查驗狀態', '查驗日期', '備註'];
    var rows = [head];
    (d.piles || []).forEach(function (p) {
      rows.push([
        p.pier, p.pileNo, p.type, p.side,
        isoToSlash(p.plannedStart), isoToSlash(p.plannedEnd),
        isoToSlash(p.actualStart), isoToSlash(p.actualEnd),
        p.status, p.inspectStatus, isoToSlash(p.inspectDate), p.note
      ]);
    });
    return rows;
  }

  var PROGRESS_WIDTHS = [9, 11, 9, 7, 12, 12, 12, 12, 10, 10, 12, 22];

  /* 查驗紀錄表 → 列資料（含墩號） */
  function logRows(d) {
    var head = ['日期', '查驗人員', '監造派員', '查驗位置', '墩號'];
    var rows = [head];
    (d.logs || []).forEach(function (l) {
      rows.push([isoToSlash(l.date), l.inspector, l.supervisor, l.location, l.pier]);
    });
    return rows;
  }

  var LOG_WIDTHS = [16, 18, 18, 46, 14];

  global.SuiteStore = {
    KEY: KEY,
    PIER_DEFS: PIER_DEFS,
    STATUS_LIST: STATUS_LIST,
    INSPECT_LIST: INSPECT_LIST,
    uid: uid,
    todayISO: todayISO,
    isoToSlash: isoToSlash,
    defaultPiles: defaultPiles,
    defaultData: defaultData,
    normalize: normalize,
    load: load,
    save: save,
    recompute: recompute,
    pierList: pierList,
    pierDef: pierDef,
    pilesOf: pilesOf,
    logsOf: logsOf,
    summary: summary,
    exportJSON: exportJSON,
    importJSON: importJSON,
    buildXlsx: buildXlsx,
    progressRows: progressRows,
    PROGRESS_WIDTHS: PROGRESS_WIDTHS,
    logRows: logRows,
    LOG_WIDTHS: LOG_WIDTHS
  };
})(typeof window !== 'undefined' ? window : this);
