/*!
 * formbuilder.js — F-24-03 查驗單 Word 產生器（範本 XML 手術式）
 *
 * 設計原則：不重建版面，直接讀入 F-24-03 範本 .docx，只替換/複製指定的段落，
 * 其餘 styles.xml / numbering.xml / fontTable.xml / settings.xml / theme 全部原封不動，
 * 因此輸出的每一段 pPr、每一個 run 的 rPr 都與範本同源，格式必然一致。
 *
 * 瀏覽器：window.FormBuilder
 * Node  ：require('./formbuilder.js')  （需 @xmldom/xmldom + jszip）
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.FormBuilder = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  /* ---------------- XML helpers ---------------- */

  /* 解析器可由外部注入（Node 端用 @xmldom/xmldom），瀏覽器端用原生 DOMParser */
  var injected = null;

  function setParsers(p) {
    injected = p || null;
  }

  function parseXml(str) {
    if (injected && injected.DOMParser) {
      return new injected.DOMParser().parseFromString(str, 'text/xml');
    }
    if (typeof DOMParser !== 'undefined') {
      return new DOMParser().parseFromString(str, 'application/xml');
    }
    throw new Error('No XML parser available — call FormBuilder.setParsers({DOMParser, XMLSerializer}) first');
  }

  function serializeXml(doc) {
    if (injected && injected.XMLSerializer) {
      return new injected.XMLSerializer().serializeToString(doc);
    }
    if (typeof XMLSerializer !== 'undefined') {
      return new XMLSerializer().serializeToString(doc);
    }
    throw new Error('No XML serializer available');
  }

  function kids(el, name) {
    var out = [], n = el.childNodes || [], i;
    for (i = 0; i < n.length; i++) {
      if (n[i] && n[i].nodeType === 1 && n[i].localName === name) out.push(n[i]);
    }
    return out;
  }

  function first(el, name) {
    var a = kids(el, name);
    return a.length ? a[0] : null;
  }

  function descendants(el, name) {
    var out = [], i, list;
    if (el.getElementsByTagNameNS) {
      list = el.getElementsByTagNameNS(W_NS, name);
      for (i = 0; i < list.length; i++) out.push(list[i]);
      return out;
    }
    list = el.getElementsByTagName('*');
    for (i = 0; i < list.length; i++) {
      if (list[i].localName === name) out.push(list[i]);
    }
    return out;
  }

  /**
   * 把一段的文字換成 text，保留「第一個 run」的 rPr，刪掉其餘 run。
   * 這樣該段沿用範本自己的字型/字級/色彩設定，不會被統一值覆蓋。
   */
  function setText(p, text) {
    var rs = kids(p, 'r');
    if (!rs.length) {
      var r = p.ownerDocument.createElementNS(W_NS, 'w:r');
      var t = p.ownerDocument.createElementNS(W_NS, 'w:t');
      r.appendChild(t);
      p.appendChild(r);
      rs = [r];
    }
    var keep = rs[0], i;
    for (i = 1; i < rs.length; i++) {
      if (rs[i].parentNode === p) p.removeChild(rs[i]);
    }
    var ts = kids(keep, 't'), t2;
    for (i = 1; i < ts.length; i++) keep.removeChild(ts[i]);
    if (ts.length) {
      t2 = ts[0];
    } else {
      t2 = p.ownerDocument.createElementNS(W_NS, 'w:t');
      keep.appendChild(t2);
    }
    t2.textContent = text == null ? '' : String(text);
    t2.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    return p;
  }

  /**
   * 找出一段裡「使用者打字內容」的 run（rFonts ascii=標楷體）。
   * F-24-03 範本的規律：固定標籤用 Times New Roman，使用者輸入的資料用標楷體（中西文同一套字）。
   * 若找不到就退回第一個 run。
   */
  function pickRun(p, fontName) {
    fontName = fontName || '標楷體';
    var rs = kids(p, 'r'), i;
    for (i = 0; i < rs.length; i++) {
      if (runAsciiFont(rs[i]) === fontName) return rs[i];
    }
    for (i = 0; i < rs.length; i++) {
      if (runAsciiFont(rs[i])) return rs[i];
    }
    return rs.length ? rs[0] : null;
  }

  function runAsciiFont(r) {
    var rPr = first(r, 'rPr');
    if (!rPr) return null;
    var f = first(rPr, 'rFonts');
    if (!f) return null;
    return f.getAttributeNS(W_NS, 'ascii') || f.getAttribute('w:ascii') || null;
  }

  /**
   * 用指定 run 當字型母版重建段落文字：保留該 run 的 rPr（字級／字型／粗體全部照抄），
   * 其餘 run 一律移除。這樣輸出內容的字型必然與範本該處同源。
   */
  function setTextWithRun(p, text, srcRun) {
    var rs = kids(p, 'r'), i;
    for (i = 0; i < rs.length; i++) {
      if (rs[i].parentNode === p) p.removeChild(rs[i]);
    }
    var r = srcRun.cloneNode(true);
    var ts = kids(r, 't');
    for (i = 1; i < ts.length; i++) r.removeChild(ts[i]);
    var t = ts.length ? ts[0] : p.ownerDocument.createElementNS(W_NS, 'w:t');
    if (!ts.length) r.appendChild(t);
    t.textContent = text == null ? '' : String(text);
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    p.appendChild(r);
    return p;
  }

  /**
   * 以「段落的 pPr + 指定來源 run」組出一個全新段落（不動原段，避免污染母版）。
   */
  function cloneParagraphWithRun(baseP, srcRun, text) {
    var p = baseP.cloneNode(true);
    return setTextWithRun(p, text, srcRun);
  }

  /** 追加一個 run（沿用來源 run 的 rPr，只換文字） */
  function appendRun(p, srcRun, text) {
    var r = srcRun.cloneNode(true);
    var ts = kids(r, 't'), i;
    for (i = 1; i < ts.length; i++) r.removeChild(ts[i]);
    var t = ts.length ? ts[0] : p.ownerDocument.createElementNS(W_NS, 'w:t');
    if (!ts.length) r.appendChild(t);
    t.textContent = text == null ? '' : String(text);
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    p.appendChild(r);
    return p;
  }

  /**
   * 保留範本該段的「全部 run 結構」（run 數量、順序、每個 run 的 rPr 一律不動），
   * 只把新文字放進第一個 run，其餘 run 的文字清空。
   *
   * 為什麼這樣做：Word 的格式來自每個 run 的 rPr。只要 run 清單與 rPr 與範本逐項相同，
   * 輸出的字型／字級／字元間距／kern／ligatures 就必然與範本一致（0 差異），
   * 而空 run 在 Word 中不佔寬度、不影響版面。
   *
   * @param {Element} p    目標段落（通常是範本段落的 clone）
   * @param {string} text  新文字；含 \n 時以 w:br 在同一段落內換行
   */
  function setTextKeepRuns(p, text) {
    var rs = kids(p, 'r'), i, j;
    if (!rs.length) {
      var r0 = p.ownerDocument.createElementNS(W_NS, 'w:r');
      p.appendChild(r0);
      rs = [r0];
    }
    /* 先把所有 run 的 w:t 清空（保留 rPr 與其他子節點結構） */
    for (i = 0; i < rs.length; i++) {
      var ts = kids(rs[i], 't');
      for (j = 0; j < ts.length; j++) {
        if (ts[j].parentNode === rs[i]) rs[i].removeChild(ts[j]);
      }
    }
    /* 文字全部放進第一個 run，換行用 w:br */
    var host = rs[0];
    var segs = String(text == null ? '' : text).split(/\r?\n/);
    for (i = 0; i < segs.length; i++) {
      if (i > 0) host.appendChild(p.ownerDocument.createElementNS(W_NS, 'w:br'));
      var t = p.ownerDocument.createElementNS(W_NS, 'w:t');
      t.textContent = segs[i];
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      host.appendChild(t);
    }
    return p;
  }

  /**
   * 保留範本該段全部 run 的 rPr，但把文字「分兩個 run」寫入：
   *   標籤（label）→ 第一個 run（範本為 Times New Roman）
   *   資料（value）→ 第一個 ascii 字型為「標楷體」的 run（範本為標楷體）
   * 其餘 run 的文字清空（rPr 保留，不佔寬度）。
   *
   * 為什麼需要分開：F-24-03 的「查驗位置:」「查驗內容:」是「標籤 Times + 資料標楷體」
   * 的雙字型結構。若把整串文字塞進第一個 run，中文會用 Times 渲染，
   * 字形與範本不同（實測 PDF 疊圖差 6,124 像素）。
   */
  function setTextSplitRuns(p, label, value) {
    var rs = kids(p, 'r'), i, j;
    if (!rs.length) {
      p.appendChild(p.ownerDocument.createElementNS(W_NS, 'w:r'));
      rs = kids(p, 'r');
    }
    for (i = 0; i < rs.length; i++) {
      var ts = kids(rs[i], 't');
      for (j = 0; j < ts.length; j++) {
        if (ts[j].parentNode === rs[i]) rs[i].removeChild(ts[j]);
      }
    }
    function put(run, text) {
      if (!run) return;
      var segs = String(text == null ? '' : text).split(/\r?\n/), k;
      for (k = 0; k < segs.length; k++) {
        if (k > 0) run.appendChild(p.ownerDocument.createElementNS(W_NS, 'w:br'));
        var t = p.ownerDocument.createElementNS(W_NS, 'w:t');
        t.textContent = segs[k];
        t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
        run.appendChild(t);
      }
    }
    /* 資料 run：優先找 ascii=標楷體 的 run，找不到就用最後一個 run */
    var dataRun = null;
    for (i = 0; i < rs.length; i++) {
      if (runAsciiFont(rs[i]) === '\u6a19\u6977\u9ad4') { dataRun = rs[i]; break; }
    }
    if (!dataRun) dataRun = rs[rs.length - 1];
    put(rs[0], label);
    if (dataRun !== rs[0]) put(dataRun, value);
    else put(rs[0], String(label || '') + String(value == null ? '' : value));
    return p;
  }

  /** 清掉某段的全部 run */
  function clearRuns(p) {
    var rs = kids(p, 'r'), i;
    for (i = 0; i < rs.length; i++) if (rs[i].parentNode === p) p.removeChild(rs[i]);
    return p;
  }

  /** 移除某段的 numPr（用於「不自動編號」模式） */
  function stripNumbering(p) {
    var pPr = first(p, 'pPr');
    if (!pPr) return;
    var np = first(pPr, 'numPr');
    if (np) pPr.removeChild(np);
    var ind = first(pPr, 'ind');
    if (!ind) {
      ind = p.ownerDocument.createElementNS(W_NS, 'w:ind');
      pPr.appendChild(ind);
    }
    ind.setAttributeNS(W_NS, 'w:left', '1976');
    ind.setAttributeNS(W_NS, 'w:right', '10');
  }

  /* ---------------- 日期 ---------------- */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function rocDate(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return (parseInt(p[0], 10) - 1911) + '年' + parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日';
  }

  function rocDateTime(iso, time) {
    var d = rocDate(iso);
    if (!d) return '';
    if (!time) return d;
    var t = String(time).split(':');
    return d + parseInt(t[0], 10) + '時' + parseInt(t[1], 10) + '分';
  }

  /** 國字數字（預覽用；Word 端由 taiwaneseCountingThousand 自動產生） */
  var CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  function cnNum(n) {
    if (n <= 10) return CN[n];
    if (n < 20) return '十' + CN[n - 10];
    var t = Math.floor(n / 10), o = n % 10;
    return CN[t] + '十' + (o ? CN[o] : '');
  }

  /* ---------------- 主流程 ---------------- */

  var FIXED_CONTRACTOR = '義力營造股份有限公司';
  var FIXED_SITE = '振國'.replace('振國', '王振國'); // 保持單一來源，避免錯字

  /* 工程名稱固定值：一律由本常數帶入，不受 data.project 影響 */
  var FIXED_PROJECT = '布袋商港聯外道路新闢工程';

  var DEFAULT_TITLE_TAIL = '         '; // 範本「編號:」後的空白（純 ASCII 空白）

  /* ==========================================================================
     固定欄位配置器（v14）
     --------------------------------------------------------------------------
     使用者分兩個輸入框填寫，輸出固定「兩列」：
       (一) 查驗位置   固定一列：承接「位置」的全部內容（多筆以「、」串接）
       (二) 查驗內容   固定一列：承接「內容」的全部內容（多筆以「；」串接）

     v14 起移除 (三)(四) 續行欄位：整段文字原樣放入該列，由 Word 依欄寬自動換行
     （同一段落內），段落數固定為 2，不隨輸入行數改變。
     ========================================================================== */

  /* v14：不再需要 (三)(四) 續行欄位，容量常數僅保留供舊版相容與 wrapWidth() 使用。 */
  var HEAD_UNITS = 54;   /* (一)(二)：標籤之後的可用寬度（實測上限 60，取 54 留安全邊際） */
  var TAIL_UNITS = 62;   /* 保留供舊版相容（v14 已不使用） */

  /** 單一字元的顯示寬度（半形 1、全形 2） */
  function charW(ch) {
    var c = ch.codePointAt ? ch.codePointAt(0) : ch.charCodeAt(0);
    if (c < 0x1100) return 1;                       /* ASCII / 拉丁 */
    if (c >= 0xFF61 && c <= 0xFF9F) return 1;       /* 半形片假名 */
    return 2;                                        /* CJK / 全形標點 */
  }

  /** 依顯示寬度斷行；優先落在標點（，、；。）之後，避免把「280kgf」切成兩半 */
  function wrapWidth(text, maxUnits) {
    var out = [], rest = String(text == null ? '' : text);
    var PUNCT = '，、；。！？：';
    while (rest.length) {
      var w = 0, cut = 0, i, cw, ch;
      for (i = 0; i < rest.length; i++) {
        ch = rest.charAt(i);
        cw = charW(ch);
        if (w + cw > maxUnits) break;
        w += cw;
        cut = i + 1;
      }
      if (cut >= rest.length) { out.push(rest); break; }
      /* 回退到最近一個標點之後，但不要退超過半行，避免行變得太短 */
      var soft = -1;
      for (i = cut - 1; i >= Math.max(0, Math.floor(cut / 2)); i--) {
        if (PUNCT.indexOf(rest.charAt(i)) >= 0) { soft = i + 1; break; }
      }
      if (soft > 0) cut = soft;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    return out.length ? out : [''];
  }

  /** 把多行文字切成非空行（去尾端空白） */
  function splitLines(v) {
    return String(v == null ? '' : v)
      .split(/\r?\n/)
      .map(function (s) { return s.replace(/\s+$/, ''); })
      .filter(function (s) { return s.trim().length > 0; });
  }

  /**
   * 把「查驗位置」與「查驗內容」兩個獨立輸入框分配到兩個固定欄位。
   *
   * v10 起改為兩欄獨立輸入：
   *   input = { pos: '位置多行文字', desc: '內容多行文字' }
   * 仍保留舊版相容：傳入字串時視為單一合併文字框，逐行依「查驗位置：／查驗內容：」前綴歸類。
   *
   * @returns {{posHead:string, descHead:string, posTail:string, descTail:string, stats:object}}
   *          v14：posTail / descTail 恆為空字串（已移除 (三)(四) 續行欄位）
   */
  function allocate(input) {
    var posText, descText;

    if (input && typeof input === 'object') {
      /* 多筆位置以「、」串接、多筆內容以「；」串接，再依寬度斷行。
         這樣 3 個樁號會落在同一列，而不是變成 3 個新列。 */
      posText = splitLines(input.pos).join('、');
      descText = splitLines(input.desc).join('；');
    } else {
      /* ---- 舊版相容：單一文字框 ---- */
      var raw = splitLines(input);
      var LABEL = /^\s*(查驗位置|查驗內容|位置|內容)\s*[：:]\s*/;
      var posSegs = [], descSegs = [], cur = null, i, m, key, rest;

      for (i = 0; i < raw.length; i++) {
        m = String(raw[i]).match(LABEL);
        if (m) {
          key = m[1];
          rest = String(raw[i]).slice(m[0].length);
          if (key === '查驗位置' || key === '位置') { posSegs.push(rest); cur = 'pos'; }
          else { descSegs.push(rest); cur = 'desc'; }
        } else if (cur === 'desc') {
          descSegs.push(raw[i]);
        } else {
          posSegs.push(raw[i]);          /* 未標示時，預設歸入「查驗位置」 */
          cur = 'pos';
        }
      }
      posText = posSegs.filter(function (s) { return s.length; }).join('、');
      descText = descSegs.filter(function (s) { return s.length; }).join('；');
    }

    /* v14：只保留 (一)(二) 兩列，不再有 (三)(四) 續行欄位。
       整段文字原樣放入該列，由 Word 依欄寬自動換行（同一段落內），
       段落數固定為 2，不隨輸入行數改變。 */
    function slot(text) {
      if (!text) return { head: '', lines: 0, chars: 0 };
      return { head: text, lines: 1, chars: text.length };
    }

    var P = slot(posText);
    var D = slot(descText);

    return {
      posHead: P.head, posTail: '',
      descHead: D.head, descTail: '',
      allLines: [P.head, D.head],
      stats: {
        posChars: P.chars, descChars: D.chars,
        posLines: P.lines, descLines: D.lines,
        posOver: 0, descOver: 0,
        paragraphs: 2
      }
    };
  }

  /* ==========================================================================
     v11：施工項目那一列的內容順序
     --------------------------------------------------------------------------
     使用者要求：該列排列改為
       契約項次及契約名稱 → 單元位置 →（契約細項，若有填）
     仍輸出成「單一段落」（範本第 3 段：12pt／標楷體／行距 240 auto／
     left 2127 right 10 hanging 567），段落數不變，格式與範本同源。

     分隔慣例（沿用範本「各段直接並列、細項前加全形逗號」的寫法）：
       契約項次及契約名稱  ─ 多行以全形空格「　」串接
       單元位置            ─ 多行以頓號「、」串接
       契約細項            ─ 多行以全形逗號「，」串接，且前面補一個「，」
     契約與單元位置之間以一個全形空格隔開，避免「預壘樁PR1-1」黏在一起。

     相容：若三個新欄位都空、但仍有舊的 itemUnit，則原樣輸出 itemUnit。
     ========================================================================== */
  function splitClean(v) {
    return String(v == null ? '' : v)
      .split(/\r?\n/)
      .map(function (s) { return s.replace(/^\s+|\s+$/g, ''); })
      .filter(function (s) { return s.length > 0; });
  }

  function composeItem(data) {
    data = data || {};

    /* v15：契約項次與契約名稱拆成兩個輸入框，輸出時合併成同一格、項次在前。
       兩者以「半形空格」相接（不是全形空格），讓「壹.二.43 預壘樁，280kgf/cm²」
       讀起來是同一句話；全形空格則保留給「契約 → 單元位置」的欄位分界。
       舊版單一欄位 data.contract 仍保留為相容後援，避免舊呼叫端壞掉。 */
    var no = splitClean(data.itemNo).join('　');
    var name = splitClean(data.itemName).join('　');
    var c = splitClean(data.contract).join('　');
    if (!no && !name && c) { name = c; }
    var contract = [no, name].filter(function (s) { return s; }).join(' ');

    var u = splitClean(data.unit).join('\u3001');
    var d = splitClean(data.detail).join('\uff0c');

    if (!contract && !u && !d) {
      return data.itemUnit == null ? '' : String(data.itemUnit);
    }

    var head = [contract, u].filter(function (s) { return s; }).join('　');
    if (d) head = head ? head + '\uff0c' + d : d;
    return head;
  }

  /* ==========================================================================
     附件表單（v8 新增）
     --------------------------------------------------------------------------
     依參考檔「活頁簿1.xlsx」的實際欄位與版面：
       標題列（A1:E1 合併、16pt 標楷體、置中）
       表頭：契約項次 / 項目及說明 / 單位 / 查驗數量 / 監造覆核（14pt 標楷體、細框線、置中）
       內容列：12pt 標楷體、細框線
       表尾：施工單位：____（A:B 合併）／監造單位：____（C:E 合併）
     欄寬依參考檔比例換算為 twips（總寬 10466 = A4 可用寬度）。
     ========================================================================== */

  var ATT_COLS = [
    { key: 'no',    label: '契約項次',   w: 1298, align: 'center' },
    { key: 'desc',  label: '項目及說明', w: 4914, align: 'left'   },
    { key: 'unit',  label: '單位',       w: 1124, align: 'center' },
    { key: 'qty',   label: '查驗數量',   w: 1471, align: 'center' },
    { key: 'check', label: '監造覆核',   w: 1659, align: 'center' }
  ];
  var ATT_TOTAL_W = 10466;

  function mkRun(doc, text, sizeHalfPt, bold) {
    var r = doc.createElementNS(W_NS, 'w:r');
    var rPr = doc.createElementNS(W_NS, 'w:rPr');
    var f = doc.createElementNS(W_NS, 'w:rFonts');
    f.setAttributeNS(W_NS, 'w:ascii', '標楷體');
    f.setAttributeNS(W_NS, 'w:eastAsia', '標楷體');
    f.setAttributeNS(W_NS, 'w:hAnsi', '標楷體');
    f.setAttributeNS(W_NS, 'w:hint', 'eastAsia');
    rPr.appendChild(f);
    if (bold) rPr.appendChild(doc.createElementNS(W_NS, 'w:b'));
    var sz = doc.createElementNS(W_NS, 'w:sz');
    sz.setAttributeNS(W_NS, 'w:val', String(sizeHalfPt));
    rPr.appendChild(sz);
    var szCs = doc.createElementNS(W_NS, 'w:szCs');
    szCs.setAttributeNS(W_NS, 'w:val', String(sizeHalfPt));
    rPr.appendChild(szCs);
    r.appendChild(rPr);
    var t = doc.createElementNS(W_NS, 'w:t');
    t.textContent = text == null ? '' : String(text);
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    r.appendChild(t);
    return r;
  }

  function mkCell(doc, text, width, align, sizeHalfPt, bold, span) {
    var tc = doc.createElementNS(W_NS, 'w:tc');
    var tcPr = doc.createElementNS(W_NS, 'w:tcPr');
    var tcW = doc.createElementNS(W_NS, 'w:tcW');
    tcW.setAttributeNS(W_NS, 'w:w', String(width));
    tcW.setAttributeNS(W_NS, 'w:type', 'dxa');
    tcPr.appendChild(tcW);
    if (span && span > 1) {
      var gs = doc.createElementNS(W_NS, 'w:gridSpan');
      gs.setAttributeNS(W_NS, 'w:val', String(span));
      tcPr.appendChild(gs);
    }
    var va = doc.createElementNS(W_NS, 'w:vAlign');
    va.setAttributeNS(W_NS, 'w:val', 'center');
    tcPr.appendChild(va);
    tc.appendChild(tcPr);

    var p = doc.createElementNS(W_NS, 'w:p');
    var pPr = doc.createElementNS(W_NS, 'w:pPr');
    var sp = doc.createElementNS(W_NS, 'w:spacing');
    sp.setAttributeNS(W_NS, 'w:before', '0');
    sp.setAttributeNS(W_NS, 'w:after', '0');
    sp.setAttributeNS(W_NS, 'w:line', '240');
    sp.setAttributeNS(W_NS, 'w:lineRule', 'auto');
    pPr.appendChild(sp);
    var jc = doc.createElementNS(W_NS, 'w:jc');
    jc.setAttributeNS(W_NS, 'w:val', align || 'center');
    pPr.appendChild(jc);
    p.appendChild(pPr);

    var segs = String(text == null ? '' : text).split(/\r?\n/);
    segs.forEach(function (seg, i) {
      if (i > 0) {
        var rs = kids(p, 'r');
        if (rs.length) rs[rs.length - 1].appendChild(doc.createElementNS(W_NS, 'w:br'));
      }
      if (seg !== '' || segs.length === 1) {
        p.appendChild(mkRun(doc, seg, sizeHalfPt || 24, bold));
      }
    });
    tc.appendChild(p);
    return tc;
  }

  function mkRow(doc, cells, height) {
    var tr = doc.createElementNS(W_NS, 'w:tr');
    var trPr = doc.createElementNS(W_NS, 'w:trPr');
    var h = doc.createElementNS(W_NS, 'w:trHeight');
    h.setAttributeNS(W_NS, 'w:val', String(height || 397));
    h.setAttributeNS(W_NS, 'w:hRule', 'atLeast');
    trPr.appendChild(h);
    tr.appendChild(trPr);
    cells.forEach(function (c) { tr.appendChild(c); });
    return tr;
  }

  /**
   * v16：附件表單的共用欄位表（唯讀，與查驗單同一份資料）
   * @param {Document} doc
   * @param {object} data 表單資料（含 inspector / supervisor / piers / piles / date / pos）
   */
  function buildSharedTable(doc, data) {
    data = data || {};
    var posTxt = String(data.pos || '').split(/\r?\n/).filter(function (s) { return s.trim(); }).join('、');

    var tbl = doc.createElementNS(W_NS, 'w:tbl');
    var tblPr = doc.createElementNS(W_NS, 'w:tblPr');

    var tblW = doc.createElementNS(W_NS, 'w:tblW');
    tblW.setAttributeNS(W_NS, 'w:w', String(ATT_TOTAL_W));
    tblW.setAttributeNS(W_NS, 'w:type', 'dxa');
    tblPr.appendChild(tblW);

    var jc = doc.createElementNS(W_NS, 'w:jc');
    jc.setAttributeNS(W_NS, 'w:val', 'center');
    tblPr.appendChild(jc);

    var borders = doc.createElementNS(W_NS, 'w:tblBorders');
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].forEach(function (side) {
      var b = doc.createElementNS(W_NS, 'w:' + side);
      b.setAttributeNS(W_NS, 'w:val', 'single');
      b.setAttributeNS(W_NS, 'w:sz', '4');
      b.setAttributeNS(W_NS, 'w:space', '0');
      b.setAttributeNS(W_NS, 'w:color', '000000');
      borders.appendChild(b);
    });
    tblPr.appendChild(borders);

    var layout = doc.createElementNS(W_NS, 'w:tblLayout');
    layout.setAttributeNS(W_NS, 'w:type', 'fixed');
    tblPr.appendChild(layout);

    var mar = doc.createElementNS(W_NS, 'w:tblCellMar');
    ['top', 'left', 'bottom', 'right'].forEach(function (side) {
      var m = doc.createElementNS(W_NS, 'w:' + side);
      m.setAttributeNS(W_NS, 'w:w', (side === 'left' || side === 'right') ? '85' : '0');
      m.setAttributeNS(W_NS, 'w:type', 'dxa');
      mar.appendChild(m);
    });
    tblPr.appendChild(mar);

    tbl.appendChild(tblPr);

    var half = Math.round(ATT_TOTAL_W / 2);
    var grid = doc.createElementNS(W_NS, 'w:tblGrid');
    [half, ATT_TOTAL_W - half].forEach(function (w) {
      var gc = doc.createElementNS(W_NS, 'w:gridCol');
      gc.setAttributeNS(W_NS, 'w:w', String(w));
      grid.appendChild(gc);
    });
    tbl.appendChild(grid);

    var dateTxt = data.date ? rocDate(data.date) : '';

    tbl.appendChild(mkRow(doc, [
      mkCell(doc, '工程名稱：' + FIXED_PROJECT, half, 'left', 24, false),
      mkCell(doc, '查驗日期：' + dateTxt, ATT_TOTAL_W - half, 'left', 24, false)
    ], 340));

    tbl.appendChild(mkRow(doc, [
      mkCell(doc, '查驗位置：' + posTxt, ATT_TOTAL_W, 'left', 24, false, 2)
    ], 340));

    return tbl;
  }

  /**
   * 建立附件表單的 w:tbl
   * @param {Document} doc
   * @param {object} att { title, rows:[{no,desc,unit,qty,check}], contractor, supervisor }
   */
  function buildAttachmentTable(doc, att, data) {
    att = att || {};
    data = data || {};
    var rows = att.rows || [];

    var tbl = doc.createElementNS(W_NS, 'w:tbl');
    var tblPr = doc.createElementNS(W_NS, 'w:tblPr');

    var tblW = doc.createElementNS(W_NS, 'w:tblW');
    tblW.setAttributeNS(W_NS, 'w:w', String(ATT_TOTAL_W));
    tblW.setAttributeNS(W_NS, 'w:type', 'dxa');
    tblPr.appendChild(tblW);

    var jc = doc.createElementNS(W_NS, 'w:jc');
    jc.setAttributeNS(W_NS, 'w:val', 'center');
    tblPr.appendChild(jc);

    var borders = doc.createElementNS(W_NS, 'w:tblBorders');
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].forEach(function (side) {
      var b = doc.createElementNS(W_NS, 'w:' + side);
      b.setAttributeNS(W_NS, 'w:val', 'single');
      b.setAttributeNS(W_NS, 'w:sz', '4');
      b.setAttributeNS(W_NS, 'w:space', '0');
      b.setAttributeNS(W_NS, 'w:color', '000000');
      borders.appendChild(b);
    });
    tblPr.appendChild(borders);

    var layout = doc.createElementNS(W_NS, 'w:tblLayout');
    layout.setAttributeNS(W_NS, 'w:type', 'fixed');
    tblPr.appendChild(layout);

    var mar = doc.createElementNS(W_NS, 'w:tblCellMar');
    ['top', 'left', 'bottom', 'right'].forEach(function (side) {
      var m = doc.createElementNS(W_NS, 'w:' + side);
      m.setAttributeNS(W_NS, 'w:w', (side === 'left' || side === 'right') ? '85' : '0');
      m.setAttributeNS(W_NS, 'w:type', 'dxa');
      mar.appendChild(m);
    });
    tblPr.appendChild(mar);

    tbl.appendChild(tblPr);

    var grid = doc.createElementNS(W_NS, 'w:tblGrid');
    ATT_COLS.forEach(function (c) {
      var gc = doc.createElementNS(W_NS, 'w:gridCol');
      gc.setAttributeNS(W_NS, 'w:w', String(c.w));
      grid.appendChild(gc);
    });
    tbl.appendChild(grid);

    /* 表頭列：14pt 標楷體、置中 */
    tbl.appendChild(mkRow(doc, ATT_COLS.map(function (c) {
      return mkCell(doc, c.label, c.w, 'center', 28, false);
    }), 390));

    /* 第一列：固定帶入查驗單的契約項次與契約名稱（項目及說明） */
    tbl.appendChild(mkRow(doc, [
      mkCell(doc, data.itemNo || '', ATT_COLS[0].w, 'center', 24, false),
      mkCell(doc, data.itemName || '', ATT_COLS[1].w, 'left', 24, false),
      mkCell(doc, '', ATT_COLS[2].w, 'center', 24, false),
      mkCell(doc, '', ATT_COLS[3].w, 'center', 24, false),
      mkCell(doc, '', ATT_COLS[4].w, 'center', 24, false)
    ], 900));

    /* 內容列：12pt 標楷體 */
    rows.forEach(function (r) {
      tbl.appendChild(mkRow(doc, ATT_COLS.map(function (c) {
        return mkCell(doc, r[c.key] == null ? '' : r[c.key], c.w, c.align, 24, false);
      }), 900));
    });

    /* 表尾：施工單位（A:B 合併）／監造單位（C:E 合併） */
    var footW1 = ATT_COLS[0].w + ATT_COLS[1].w;
    var footW2 = ATT_COLS[2].w + ATT_COLS[3].w + ATT_COLS[4].w;
    tbl.appendChild(mkRow(doc, [
      mkCell(doc, '施工單位：' + (att.contractor || ''), footW1, 'left', 24, false, 2),
      mkCell(doc, '監造單位：' + (att.supervisor || ''), footW2, 'left', 24, false, 3)
    ], 340));

    return tbl;
  }

  /**
   * 依據資料改寫範本 document.xml。
   * @param {string} xml  範本 word/document.xml 原字串
   * @param {object} data 表單資料
   * @returns {string}    改寫後的 document.xml
   */
  function patchDocumentXml(xml, data) {
    data = data || {};
    var doc = parseXml(xml);
    var body = descendants(doc, 'body')[0];
    if (!body) throw new Error('document.xml 找不到 w:body');

    var sectPr = first(body, 'sectPr');
    var paras = kids(body, 'p');
    if (paras.length < 19) {
      throw new Error('範本段落數不如預期（' + paras.length + '），請確認是否為 F-24-03 原檔');
    }

    /* v10：優先使用兩個獨立欄位；若呼叫端仍傳舊的 items 字串則自動相容 */
    var alloc = allocate(
      (data.pos != null || data.desc != null)
        ? { pos: data.pos, desc: data.desc }
        : data.items
    );
    var lines = alloc.allLines;

    var out = [];

    /* ---- [00] 標題：工程施工中請驗單(編號: ____) ---- */
    var pTitle = paras[0];
    var tRuns = kids(pTitle, 'r');
    if (tRuns.length >= 5) {
      setTextRunOnly(tRuns[2], '編號');
      setTextRunOnly(tRuns[3], data.no ? ': ' + data.no : ':' + DEFAULT_TITLE_TAIL);
    } else {
      setText(pTitle, '工程施工中請驗單(編號: ' + (data.no || '') + ')');
    }
    out.push(pTitle);

    /* ---- [01] 一、工程名稱（範本為 2 個 Times run：標籤 + 資料，結構原樣保留） ---- */
    var p1 = paras[1].cloneNode(true), r1 = kids(p1, 'r'), k;
    if (r1.length >= 2) {
      setTextRunOnly(r1[0], '工程名稱：');
      setTextRunOnly(r1[1], FIXED_PROJECT);
      for (k = 2; k < r1.length; k++) if (r1[k].parentNode === p1) p1.removeChild(r1[k]);
    } else {
      setTextWithRun(p1, '工程名稱：' + FIXED_PROJECT, pickRun(paras[1], 'Times New Roman'));
    }
    out.push(p1);

    /* ---- [02] 二、施工項目與單元位置 ---- */
    out.push(paras[2]);

    /* ---- [03][04] (一)(二)：範本該段全部 run 的西文都是標楷體 → 資料也用標楷體 ---- */
    var kaiSrc = pickRun(paras[3], '標楷體');
    var timesSrc = pickRun(paras[3], 'Times New Roman');
    var mkSub = function (label, value) {
      var p = clearRuns(paras[3].cloneNode(true));
      appendRun(p, timesSrc, label);
      appendRun(p, kaiSrc, value || '');
      return p;
    };
    /* 範本該段結構為「標籤 run（Times）+ 資料 run（標楷體）」，照它拆兩個 run */
    /* 施工項目與單元位置：合併為「單一段落」，格式完全照範本第 3 段
       （12pt／標楷體／行距 240 auto／left 2127 right 10 hanging 567）。
       使用者輸入什麼就原樣輸出：不加標籤、不補空白、不補標點；
       換行以 w:br 保留在同一段落內，段落數不變。 */
    var p3 = paras[3].cloneNode(true);
    /* 移除範本該段的自動編號（numId=3 → 會自動印出「（一）」）。
       合併成單一段落後只會剩下一個孤零零的「（一）」，且使用者要求「不自動加標籤」，
       因此拿掉 numPr；ind（left 2127 / right 10 / hanging 567）與 spacing、字級、字型全部保留。 */
    /* 範本第 4 段帶 numPr(numId=3) → Word 自動印出「(一)」。
       必須保留，否則輸出的 (一) 會消失（與範本不一致）。 */
    /* 保留範本該段 8 個 run 的 rPr（含 hint 差異），文字整段放進第一個 run。 */
    setTextKeepRuns(p3, composeItem(data));
    out.push(p3);

    /* ---- [05] 三、預定抽(查)驗日期：範本該段西文為 Times → 沿用 ---- */
    out.push(setTextKeepRuns(paras[4].cloneNode(true),
      '預定抽 (查)驗日期：' + rocDateTime(data.date, data.time)));

    /* ---- [05] 四、請驗項目(應填樁號里程或尺寸長度)： ---- */
    out.push(paras[5]);

    /* ---- [07..] 請驗項目：每行一段，母版取範本 [06]。
       範本 [06] 是「標籤 '查驗位置'（Times）+ ':'（Times）+ 資料（標楷體）」的混合結構。
       使用者每行可能自帶「查驗位置：」標籤，也可能純資料：
         - 有前綴「XXX：」→ 標籤用 Times run、內容用標楷體 run（與範本完全同構）
         - 沒有前綴 → 整行都用標楷體 run（它是純資料） ---- */
    /* ======================================================================
       固定兩列模型（v14）
       (一) 查驗位置  ─ 固定一列，承接「位置」全部內容（多筆以「、」串接）
       (二) 查驗內容  ─ 固定一列，承接「內容」全部內容（多筆以「；」串接）

       ⚠ 段落數固定為 2 段，永遠不隨輸入行數增加而新增列。
       整段文字原樣放入該列，由 Word 依欄寬自動換行（同一段落內）。
       ====================================================================== */
    var baseLine = paras[6];
    var lineKai = pickRun(baseLine, '標楷體');
    var lineTimes = pickRun(baseLine, 'Times New Roman');

    function mkSlot(base, label, value) {
      /* 保留範本該段全部 run 的 rPr（標籤 run 用 Times、資料 run 用標楷體），
         文字（標籤 + 資料）整段放進第一個 run；多行以 w:br 換行。
         注意：範本第 7 段有 5 個 run、第 8 段有 6 個 run，兩段結構不同，
         因此各自以「自己那一段」為母版，run 清單與 rPr 才能逐項相同。 */
      var p = base.cloneNode(true);
      setTextSplitRuns(p, label, value);
      if (data.autoNum === false) stripNumbering(p);
      return p;
    }

    /* 固定兩列：(一) 位置 → (二) 內容。兩段永遠存在，段落數不隨輸入行數改變。 */
    /* 範本第 7 段為「查驗位置: 」（半形冒號 + 一個空白），第 8 段為「查驗內容:」（半形冒號、無空白）。
       先前用全形「：」，與範本不符。 */
    /* 範本第 7 段：run0='查驗位置'(Times) run1=':'(Times) run2=' '(標楷體) run3='P'...
       → 冒號後的空白屬於「標楷體資料 run」，因此空白要放在 value 前面，不能留在 label。
       範本第 8 段：run0='查驗內容' run1=':' run2='預壘樁'... → 冒號後無空白。 */
    out.push(mkSlot(paras[6], '查驗位置:', ' ' + String(alloc.posHead == null ? '' : alloc.posHead)));
    out.push(mkSlot(paras[7], '查驗內容:', alloc.descHead));

    /* ---- [08][09] 空白間隔（照範本保留，位於「五、上列項目」之前） ---- */
    out.push(paras[8]);
    out.push(paras[9]);

    /* ---- [10] 五、上列項目報請監造單位查驗。 ---- */
    out.push(paras[10]);

    /* ---- [11][12][13] 空白間隔 ---- */
    out.push(paras[11]);
    out.push(paras[12]);
    out.push(paras[13]);

    /* ---- [19] 申請日期（範本西文為 Times，sz=28） ---- */
    out.push(setTextKeepRuns(paras[14].cloneNode(true),
      '申請日期： ' + rocDate(data.apply)));

    /* ---- [20] 承包商（固定；保留範本 2 個 run：標籤 + 名稱） ---- */
    var p20 = paras[15].cloneNode(true), r20 = kids(p20, 'r'), k20;
    if (r20.length >= 2) {
      setTextRunOnly(r20[0], '承包商：');
      setTextRunOnly(r20[1], FIXED_CONTRACTOR);
      for (k20 = 2; k20 < r20.length; k20++) if (r20[k20].parentNode === p20) p20.removeChild(r20[k20]);
    } else {
      setTextWithRun(p20, '承包商：' + FIXED_CONTRACTOR, pickRun(paras[15], 'Times New Roman'));
    }
    out.push(p20);

    /* ---- [21] 工地主任（固定）；尾端空白 run 原樣保留（範本該 run sz=22，
       若併入主 run 會變成 14pt 空白，行高與範本不同） ---- */
    /* 保留範本該段全部 8 個 run（含尾端 sz=22 的空白 run），
       文字整段放進第一個 run，尾端空白由範本 run 結構自然保留。 */
    var p21 = setTextKeepRuns(paras[16].cloneNode(true),
      '工地主任(負責人)：' + FIXED_SITE + '   ');
    out.push(p21);

    /* ---- [17] 此致（不動） ---- */
    out.push(paras[17]);

    /* ---- [18] 監造單位：（保持空白供簽名，不動） ---- */
    out.push(paras[18]);

    /* ---- 附件表單（v8）：勾選時接在查驗單之後，另起一頁 ---- */
    if (data.attach && data.attach.enabled) {
      var att = data.attach;

      /* 分頁符：讓附件表單從新的一頁開始 */
      var brkP = doc.createElementNS(W_NS, 'w:p');
      var brkR = doc.createElementNS(W_NS, 'w:r');
      var brk = doc.createElementNS(W_NS, 'w:br');
      brk.setAttributeNS(W_NS, 'w:type', 'page');
      brkR.appendChild(brk);
      brkP.appendChild(brkR);
      out.push(brkP);

      /* 附件表單標題（16pt 標楷體、置中） */
      var attTitle = att.title || '預壘樁工程-布袋港';
      var tp = doc.createElementNS(W_NS, 'w:p');
      var tpPr = doc.createElementNS(W_NS, 'w:pPr');
      var tsp = doc.createElementNS(W_NS, 'w:spacing');
      tsp.setAttributeNS(W_NS, 'w:before', '0');
      tsp.setAttributeNS(W_NS, 'w:after', '120');
      tsp.setAttributeNS(W_NS, 'w:line', '240');
      tsp.setAttributeNS(W_NS, 'w:lineRule', 'auto');
      tpPr.appendChild(tsp);
      var tjc = doc.createElementNS(W_NS, 'w:jc');
      tjc.setAttributeNS(W_NS, 'w:val', 'center');
      tpPr.appendChild(tjc);
      tp.appendChild(tpPr);
      tp.appendChild(mkRun(doc, attTitle, 32, false));
      out.push(tp);

      /* 附件表單表格 */
      out.push(buildSharedTable(doc, data));
      out.push(buildAttachmentTable(doc, att, data));
    }

    /* 依序重排 body 子節點 */
    var cn = body.childNodes, i;
    for (i = cn.length - 1; i >= 0; i--) {
      if (cn[i].nodeType === 1) body.removeChild(cn[i]);
    }
    out.forEach(function (p) { body.appendChild(p); });
    if (sectPr) body.appendChild(sectPr);

    return serializeXml(doc);
  }

  /** 只換單一 run 的文字（用於標題這種 run 拆分固定的情況） */
  function setTextRunOnly(run, text) {
    var ts = kids(run, 't'), t;
    if (ts.length) {
      t = ts[0];
      var i;
      for (i = 1; i < ts.length; i++) run.removeChild(ts[i]);
    } else {
      t = run.ownerDocument.createElementNS(W_NS, 'w:t');
      run.appendChild(t);
    }
    t.textContent = text;
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  }

  /**
   * 產生 .docx
   * @param {object} opts { JSZip, templateBuffer, data, outputType }
   * @returns {Promise<any>}
   */
  function build(opts) {
    var JSZip = opts.JSZip;
    var outputType = opts.outputType || 'blob';
    if (!JSZip) return Promise.reject(new Error('缺少 JSZip'));
    return JSZip.loadAsync(opts.templateBuffer).then(function (zip) {
      var f = zip.file('word/document.xml');
      if (!f) throw new Error('範本缺少 word/document.xml');
      return f.async('string').then(function (xml) {
        var patched = patchDocumentXml(xml, opts.data || {});
        zip.file('word/document.xml', patched);
        return zip.generateAsync({
          type: outputType,
          compression: 'DEFLATE',
          compressionOptions: { level: 6 },
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
      });
    });
  }

  return {
    build: build,
    setParsers: setParsers,
    patchDocumentXml: patchDocumentXml,
    rocDate: rocDate,
    rocDateTime: rocDateTime,
    cnNum: cnNum,
    FIXED_CONTRACTOR: FIXED_CONTRACTOR,
    FIXED_SITE: FIXED_SITE,
    FIXED_PROJECT: FIXED_PROJECT,
    allocate: allocate,
    composeItem: composeItem,
    buildAttachmentTable: buildAttachmentTable,
    buildSharedTable: buildSharedTable,
    ATT_COLS: ATT_COLS,
    ATT_TOTAL_W: ATT_TOTAL_W,
    wrapWidth: wrapWidth,
    HEAD_UNITS: HEAD_UNITS,
    TAIL_UNITS: TAIL_UNITS
  };
});
