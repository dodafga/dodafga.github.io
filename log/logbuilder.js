/*!
 * logbuilder.js — 查驗紀錄表 Excel 產生器（範本 XML 手術式）
 *
 * 設計原則：不重建格式。直接讀入「inspection-log.xlsx」範本，
 * 只重寫 xl/worksheets/sheet1.xml 與 xl/sharedStrings.xml，
 * styles.xml / theme1.xml / workbook.xml 其餘部分原封不動，
 * 因此標題列深藍底白字粗體置中、欄寬、框線、日期格式、
 * 列高、凍結窗格、列印設定全部與範本同源。
 *
 * 範本結構：
 *   A 日期      width 16  numFmt 176 (yyyy/mm/dd)  置中
 *   B 查驗人員  width 18  標楷體 11pt              置中
 *   C 監造派員  width 18  標楷體 11pt              置中
 *   D 查驗位置  width 46  標楷體 11pt              靠左
 *   標題列：填色 FF2F5597、白色粗體 12pt 標楷體、置中、列高 26.1
 *   資料列：列高 21.95、框線 FF9E9E9E thin
 *   列印：A4 橫向、水平置中、fitToWidth、重複標題列、範圍 A1:D{n}
 *
 * 瀏覽器：window.LogBuilder
 * Node  ：require('./logbuilder.js')
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.LogBuilder = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INSPECTORS  = ['乘恩', '順昔', '火木', '佩璇'];
  var SUPERVISORS = ['振源', '旭程', '慧欣'];
  var HEADERS     = ['日期', '查驗人員', '監造派員', '查驗位置'];

  var FIXED_PROJECT    = '布袋商港聯外道路新闢工程';
  var FIXED_CONTRACTOR = '義力營造股份有限公司';
  var FIXED_SITE       = '王振國';

  var SHEET_NAME = '查驗紀錄表';

  /* ---------------- helpers ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** ISO yyyy-mm-dd → Excel 序列值（1900 日期系統，基準 1899-12-30） */
  function excelSerial(iso) {
    if (!iso) return null;
    var p = String(iso).split('-');
    if (p.length !== 3) return null;
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    if (!y || !m || !d) return null;
    var utc  = Date.UTC(y, m - 1, d);
    var base = Date.UTC(1899, 11, 30);
    var n = Math.round((utc - base) / 86400000);
    return n > 0 ? n : null;
  }

  /** 正規化列資料 */
  function normRows(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      r = r || {};
      out.push({
        date:       String(r.date || '').trim(),
        inspector:  String(r.inspector || '').trim(),
        supervisor: String(r.supervisor || '').trim(),
        location:   String(r.location || '').trim()
      });
    });
    if (!out.length) out.push({ date: '', inspector: '', supervisor: '', location: '' });
    return out;
  }

  /* ---------------- sharedStrings ---------------- */

  function buildSharedStrings(rows) {
    var list = [], map = {};
    function add(s) {
      s = String(s == null ? '' : s);
      if (!s) return;
      if (Object.prototype.hasOwnProperty.call(map, s)) return;
      map[s] = list.length;
      list.push(s);
    }
    HEADERS.forEach(add);
    rows.forEach(function (r) {
      add(r.inspector);
      add(r.supervisor);
      add(r.location);
    });

    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
      list.length + '" uniqueCount="' + list.length + '">';
    list.forEach(function (s) {
      xml += '<si><t>' + esc(s) + '</t><phoneticPr fontId="3" type="noConversion"/></si>';
    });
    xml += '</sst>';
    return { xml: xml, map: map };
  }

  /* ---------------- sheet1.xml ---------------- */

  function buildSheet(rows, sstMap) {
    var n = rows.length;
    var last = n + 1;                 // 最後一列列號（含標題列）
    var out = [];

    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"' +
      ' mc:Ignorable="x14ac"' +
      ' xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">');
    out.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    out.push('<dimension ref="A1:D' + last + '"/>');
    out.push('<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15.75" x14ac:dyDescent="0.25"/>');

    /* 欄寬：與範本完全相同 */
    out.push('<cols>' +
      '<col min="1" max="1" width="16" customWidth="1"/>' +
      '<col min="2" max="3" width="18" customWidth="1"/>' +
      '<col min="4" max="4" width="46" customWidth="1"/>' +
      '</cols>');

    out.push('<sheetData>');

    /* 標題列：s=1（深藍底白字粗體置中）、列高 26.1 */
    out.push('<row r="1" spans="1:4" ht="26.1" customHeight="1" x14ac:dyDescent="0.25">');
    ['A', 'B', 'C', 'D'].forEach(function (col, i) {
      out.push('<c r="' + col + '1" s="1" t="s"><v>' + sstMap[HEADERS[i]] + '</v></c>');
    });
    out.push('</row>');

    /* 資料列：列高 21.95；A s=2（日期格式）、B/C s=3（置中）、D s=4（靠左） */
    rows.forEach(function (r, i) {
      var rn = i + 2;
      out.push('<row r="' + rn + '" spans="1:4" ht="21.95" customHeight="1" x14ac:dyDescent="0.25">');

      var serial = excelSerial(r.date);
      if (serial != null) {
        out.push('<c r="A' + rn + '" s="2"><v>' + serial + '</v></c>');
      } else {
        out.push('<c r="A' + rn + '" s="2"/>');
      }

      if (r.inspector && sstMap[r.inspector] != null) {
        out.push('<c r="B' + rn + '" s="3" t="s"><v>' + sstMap[r.inspector] + '</v></c>');
      } else {
        out.push('<c r="B' + rn + '" s="3"/>');
      }

      if (r.supervisor && sstMap[r.supervisor] != null) {
        out.push('<c r="C' + rn + '" s="3" t="s"><v>' + sstMap[r.supervisor] + '</v></c>');
      } else {
        out.push('<c r="C' + rn + '" s="3"/>');
      }

      if (r.location && sstMap[r.location] != null) {
        out.push('<c r="D' + rn + '" s="4" t="s"><v>' + sstMap[r.location] + '</v></c>');
      } else {
        out.push('<c r="D' + rn + '" s="4"/>');
      }

      out.push('</row>');
    });

    out.push('</sheetData>');
    out.push('<phoneticPr fontId="3" type="noConversion"/>');

    /* 下拉選單：B 查驗人員、C 監造派員（沿用範本 dataValidation 結構） */
    out.push('<dataValidations count="2">');
    out.push('<dataValidation type="list" allowBlank="1" errorTitle="輸入錯誤"' +
      ' error="請選擇查驗人員" promptTitle="查驗人員" prompt="請選擇查驗人員"' +
      ' sqref="B2:B' + last + '"><formula1>"' + INSPECTORS.join(',') + '"</formula1></dataValidation>');
    out.push('<dataValidation type="list" allowBlank="1" errorTitle="輸入錯誤"' +
      ' error="請選擇監造人員" promptTitle="監造派員" prompt="請選擇監造人員"' +
      ' sqref="C2:C' + last + '"><formula1>"' + SUPERVISORS.join(',') + '"</formula1></dataValidation>');
    out.push('</dataValidations>');

    out.push('<printOptions horizontalCentered="1"/>');
    out.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.5" footer="0.5"/>');
    out.push('<pageSetup paperSize="9" fitToHeight="0" orientation="landscape"/>');
    out.push('</worksheet>');

    return out.join('');
  }

  /* ---------------- workbook.xml（只更新列印範圍） ---------------- */

  function patchWorkbook(xml, last) {
    return String(xml).replace(
      /(<definedName name="_xlnm\.Print_Area"[^>]*>)[^<]*(<\/definedName>)/g,
      function (m, open, close) {
        return open + SHEET_NAME + '!$A$1:$D$' + last + close;
      }
    );
  }

  /* ---------------- 主流程 ---------------- */

  /**
   * @param {ArrayBuffer|Uint8Array} templateBuf 範本 xlsx 位元組
   * @param {Object} opts { rows:[{date,inspector,supervisor,location}] }
   * @param {Object} JSZipRef JSZip 建構子（瀏覽器可省略，用全域 JSZip）
   * @returns {Promise<Blob|Uint8Array>}
   */
  function buildXlsx(templateBuf, opts, JSZipRef) {
    opts = opts || {};
    var rows = normRows(opts.rows);
    var last = rows.length + 1;

    var Z = JSZipRef || (typeof JSZip !== 'undefined' ? JSZip : null);
    if (!Z) return Promise.reject(new Error('JSZip 未載入'));

    var sst = buildSharedStrings(rows);
    var sheetXml = buildSheet(rows, sst.map);

    return Z.loadAsync(templateBuf).then(function (zip) {
      zip.file('xl/worksheets/sheet1.xml', sheetXml);
      zip.file('xl/sharedStrings.xml', sst.xml);
      var wbFile = zip.file('xl/workbook.xml');
      var chain = wbFile
        ? wbFile.async('string').then(function (wb) { zip.file('xl/workbook.xml', patchWorkbook(wb, last)); })
        : Promise.resolve();
      return chain.then(function () {
        return zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          compression: 'DEFLATE',
          compressionOptions: { level: 6 }
        });
      });
    });
  }

  return {
    INSPECTORS: INSPECTORS,
    SUPERVISORS: SUPERVISORS,
    HEADERS: HEADERS,
    FIXED_PROJECT: FIXED_PROJECT,
    FIXED_CONTRACTOR: FIXED_CONTRACTOR,
    FIXED_SITE: FIXED_SITE,
    SHEET_NAME: SHEET_NAME,
    excelSerial: excelSerial,
    buildSheet: buildSheet,
    buildSharedStrings: buildSharedStrings,
    patchWorkbook: patchWorkbook,
    buildXlsx: buildXlsx
  };
});
