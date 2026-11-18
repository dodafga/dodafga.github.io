/*!
 * photobuilder.js — 查驗相片表 Word 產生器（範本 XML 手術式）
 *
 * 設計原則：不重建版面。直接讀入「查驗相片表(範本).docx」，
 * 只複製／填寫表格與標題段落，其餘 styles.xml / fontTable.xml /
 * settings.xml / theme 全部原封不動，因此輸出的每一段 pPr、
 * 每一個 run 的 rPr、照片的 wp:extent 都與範本同源。
 *
 * 範本結構（每頁）：
 *   標題段 1：工程名稱（置中、標楷體、行高 360）
 *   標題段 2：照片記錄表（置中、標楷體、行高 360）
 *   表格 4 欄（2136 / 4947 / 1417 / 1956 twips）
 *     R0 照片地點 | 值 | 拍攝編號 | 編號值
 *     R1 拍攝項目 | 值（跨 3 欄）
 *     R2 日期     | 值 | 說明（跨 2 欄）
 *     R3 照片（跨 2 欄，7083）| 說明（跨 2 欄，3373，vMerge restart）
 *     R4 照片（跨 2 欄）      | 說明（vMerge 續）
 *     R5 照片（跨 2 欄）      | 說明（vMerge 續）
 *   照片尺寸：cx=3605858 cy=2700000 EMU（約 9.53 × 7.14 cm），列高 4252 twips
 *
 * 瀏覽器：window.PhotoBuilder
 * Node  ：require('./photobuilder.js')（需 @xmldom/xmldom + jszip）
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.PhotoBuilder = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var XML_NS = 'http://www.w3.org/XML/1998/namespace';

  var FIXED_PROJECT = '布袋商港聯外道路新闢工程';
  var FIXED_CONTRACTOR = '義力營造股份有限公司';
  var FIXED_SITE = '王振國';
  var DEFAULT_TITLE = '照片記錄表';
  var PHOTO_PER_PAGE = 3;

  /* ---------------- XML helpers ---------------- */

  var injected = null;
  function setParsers(p) { injected = p || null; }

  function parseXml(str) {
    if (injected && injected.DOMParser) return new injected.DOMParser().parseFromString(str, 'text/xml');
    if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(str, 'application/xml');
    throw new Error('No XML parser available — call PhotoBuilder.setParsers({DOMParser, XMLSerializer}) first');
  }
  function serializeXml(doc) {
    if (injected && injected.XMLSerializer) return new injected.XMLSerializer().serializeToString(doc);
    if (typeof XMLSerializer !== 'undefined') return new XMLSerializer().serializeToString(doc);
    throw new Error('No XML serializer available');
  }

  function kids(el, name) {
    var out = [], n = el.childNodes || [], i;
    for (i = 0; i < n.length; i++) {
      if (n[i] && n[i].nodeType === 1 && n[i].localName === name) out.push(n[i]);
    }
    return out;
  }
  function first(el, name) { var a = kids(el, name); return a.length ? a[0] : null; }
  function descendants(el, name) {
    var out = [], i, list;
    if (el.getElementsByTagNameNS) {
      list = el.getElementsByTagNameNS(W_NS, name);
      for (i = 0; i < list.length; i++) out.push(list[i]);
      return out;
    }
    list = el.getElementsByTagName('*');
    for (i = 0; i < list.length; i++) if (list[i].localName === name) out.push(list[i]);
    return out;
  }

  function el(doc, name) { return doc.createElementNS(W_NS, 'w:' + name); }

  /** 建立一個標楷體 run（與範本內文 run 同字型） */
  function makeRun(doc, text) {
    var r = el(doc, 'r');
    var rPr = el(doc, 'rPr');
    var f = el(doc, 'rFonts');
    f.setAttributeNS(W_NS, 'w:ascii', '標楷體');
    f.setAttributeNS(W_NS, 'w:eastAsia', '標楷體');
    f.setAttributeNS(W_NS, 'w:hAnsi', '標楷體');
    f.setAttributeNS(W_NS, 'w:hint', 'eastAsia');
    rPr.appendChild(f);
    r.appendChild(rPr);
    var t = el(doc, 't');
    t.textContent = text == null ? '' : String(text);
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    r.appendChild(t);
    return r;
  }

  /** 把某「段落」的文字換成 text（保留該段 pPr 與第一個 run 的 rPr） */
  function setParaText(p, text) {
    var rs = kids(p, 'r'), i;
    var srcRun = rs.length ? rs[0] : null;
    for (i = 0; i < rs.length; i++) if (rs[i].parentNode === p) p.removeChild(rs[i]);
    var r;
    if (srcRun) {
      r = srcRun.cloneNode(true);
      var ts = kids(r, 't');
      for (i = 1; i < ts.length; i++) r.removeChild(ts[i]);
      var t = ts.length ? ts[0] : el(p.ownerDocument, 't');
      if (!ts.length) r.appendChild(t);
      t.textContent = text == null ? '' : String(text);
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    } else {
      r = makeRun(p.ownerDocument, text);
    }
    p.appendChild(r);
    return p;
  }

  /** 把某儲存格第一段的文字換成 text */
  function setCellText(tc, text) {
    var p = first(tc, 'p');
    if (!p) {
      p = el(tc.ownerDocument, 'p');
      tc.appendChild(p);
    }
    return setParaText(p, text);
  }

  /** 把儲存格內容換成多段（每段一個說明） */
  function setCellParagraphs(tc, lines) {
    var ps = kids(tc, 'p'), i;
    var tpl = ps.length ? ps[0] : null;
    for (i = 0; i < ps.length; i++) if (ps[i].parentNode === tc) tc.removeChild(ps[i]);
    var arr = (lines && lines.length) ? lines : [''];
    arr.forEach(function (ln) {
      var p = tpl ? tpl.cloneNode(true) : el(tc.ownerDocument, 'p');
      var rs = kids(p, 'r');
      for (var k = 0; k < rs.length; k++) if (rs[k].parentNode === p) p.removeChild(rs[k]);
      p.appendChild(makeRun(p.ownerDocument, ln));
      tc.appendChild(p);
    });
  }

  /* ---------------- 日期 ---------------- */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /** ISO yyyy-mm-dd → 範本格式 115.10.05（民國年.月.日） */
  function rocDot(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    var y = parseInt(p[0], 10);
    if (isNaN(y)) return String(iso);
    return (y - 1911) + '.' + pad2(parseInt(p[1], 10)) + '.' + pad2(parseInt(p[2], 10));
  }

  /* ---------------- 分頁 ---------------- */

  /**
   * 在標題段落最前面插入分頁符（與範本完全相同的做法）。
   * 範本第 2 頁以後的標題段，開頭就是一個 <w:r><w:br w:type="page"/></w:r>，
   * 不是靠 pageBreakBefore、也不是靠獨立的分頁段落。
   * 照範本這樣做，分頁位置與 Word 的排版結果才會一致。
   */
  function prependPageBreak(p) {
    var doc = p.ownerDocument;
    var r = el(doc, 'r');
    var rPr = el(doc, 'rPr');
    var f = el(doc, 'rFonts');
    f.setAttributeNS(W_NS, 'w:ascii', '標楷體');
    f.setAttributeNS(W_NS, 'w:eastAsia', '標楷體');
    f.setAttributeNS(W_NS, 'w:hAnsi', '標楷體');
    rPr.appendChild(f);
    r.appendChild(rPr);
    var br = el(doc, 'br');
    br.setAttributeNS(W_NS, 'w:type', 'page');
    r.appendChild(br);
    /* 插在第一個 run 之前（pPr 之後） */
    var anchor = first(p, 'pPr');
    if (anchor && anchor.nextSibling) p.insertBefore(r, anchor.nextSibling);
    else if (anchor) p.appendChild(r);
    else p.insertBefore(r, p.firstChild);
    return p;
  }
  /**
   * 依「照片地點 + 拍攝項目 + 日期」分組，同組最多 3 張放同一頁。
   * 這樣每頁表頭（地點／項目／日期）都是同一組的值，不會張冠李戴；
   * 說明則逐張寫入右側合併儲存格（每張一段）。
   */
  function paginate(photos) {
    var pages = [], cur = null, key = null;
    (photos || []).forEach(function (ph) {
      var k = [ph.place || '', ph.item || '', ph.date || ''].join('\u0001');
      if (!cur || k !== key || cur.length >= PHOTO_PER_PAGE) {
        cur = [];
        pages.push(cur);
        key = k;
      }
      cur.push(ph);
    });
    return pages;
  }

  /* ---------------- 主流程 ---------------- */

  /**
   * 改寫 document.xml
   * @param {string} xml  範本 word/document.xml
   * @param {object} data { project, title, startNo, photos:[{place,item,date,desc,imgIndex}] }
   * @returns {string}
   */
  function patchDocumentXml(xml, data) {
    data = data || {};
    var photos = data.photos || [];
    var doc = parseXml(xml);
    var body = descendants(doc, 'body')[0];
    if (!body) throw new Error('document.xml 找不到 w:body');

    var sectPr = first(body, 'sectPr');
    var allP = kids(body, 'p');
    var allTbl = kids(body, 'tbl');
    if (allP.length < 2 || !allTbl.length) {
      throw new Error('範本結構不如預期（段落 ' + allP.length + '、表格 ' + allTbl.length + '），請確認是否為查驗相片表原檔');
    }

    var titleTpl = allP[0];      /* 工程名稱 */
    var subTpl = allP[1];        /* 照片記錄表 */
    var tblTpl = allTbl[0];      /* 單頁表格母版 */

    var project = data.project || FIXED_PROJECT;
    var docTitle = (data.title != null && String(data.title) !== '') ? String(data.title) : DEFAULT_TITLE;
    var startNo = (data.startNo != null && !isNaN(parseInt(data.startNo, 10)) && parseInt(data.startNo, 10) > 0)
      ? parseInt(data.startNo, 10) : 1;
    var pages = paginate(photos);
    if (!pages.length) pages = [[]];   /* 至少輸出一頁空白表 */

    var out = [];
    var seq = 0;

    var pageDescs = data.pageDescs || [];

    pages.forEach(function (pagePhotos, pageIdx) {
      /* 標題 1：工程名稱（第 2 頁起，開頭插入分頁符，與範本一致） */
      var p1 = titleTpl.cloneNode(true);
      setParaText(p1, project);
      if (pageIdx > 0) prependPageBreak(p1);
      out.push(p1);

      /* 標題 2：照片記錄表 */
      var p2 = subTpl.cloneNode(true);
      setParaText(p2, docTitle);
      out.push(p2);

      /* 表格 */
      var tbl = tblTpl.cloneNode(true);
      var rows = kids(tbl, 'tr');
      var head = pagePhotos[0] || {};

      /* R0：照片地點 | 值 | 拍攝編號 | 編號 */
      var r0 = kids(rows[0], 'tc');
      setCellText(r0[1], head.place || '');
      setCellText(r0[3], pagePhotos.length ? String(startNo + seq) : '');

      /* R1：拍攝項目 | 值（跨 3 欄） */
      var r1 = kids(rows[1], 'tc');
      setCellText(r1[1], head.item || '');

      /* R2：日期 | 值 | 說明（跨 2 欄，標題保留） */
      var r2 = kids(rows[2], 'tc');
      setCellText(r2[1], rocDot(head.date));

      /* R3..R5：照片列 */
      var photoRowTpl = rows[3];
      var descLines = [];
      /* 說明欄為多段合併儲存格。
         說明改為「一頁一個」：只採用本頁說明（pageDescs[pageIdx]），
         不再逐張照片各寫一段。留空則說明欄保持空白。 */
      var pageDesc = pageDescs[pageIdx];
      if (pageDesc != null && String(pageDesc).trim() !== '') {
        String(pageDesc).split(/\r?\n/).forEach(function (ln) { descLines.push(ln); });
      }

      /* 先移除多餘的照片列（保留實際張數，至少 1 列） */
      var keep = Math.max(1, pagePhotos.length);
      for (var ri = rows.length - 1; ri >= 3 + keep; ri--) {
        tbl.removeChild(rows[ri]);
      }

      var liveRows = kids(tbl, 'tr');
      for (var i = 0; i < keep; i++) {
        var tr = liveRows[3 + i];
        var tcs = kids(tr, 'tc');
        var ph = pagePhotos[i] || {};

        /* 左：照片（跨 2 欄）。段落間距完全沿用範本，不覆寫。 */
        var picCell = tcs[0];
        var blip = null;
        var list = picCell.getElementsByTagName('*');
        for (var b = 0; b < list.length; b++) if (list[b].localName === 'blip') { blip = list[b]; break; }
        if (blip) {
          if (ph.data || ph.imgIndex != null) {
            var idx = (ph.imgIndex != null) ? ph.imgIndex : (seq + i);
            blip.setAttributeNS(R_NS, 'r:embed', 'rIdPhoto' + (idx + 1));
          } else {
            /* 無照片：移除整個 drawing，留空白儲存格 */
            var pEl = first(picCell, 'p');
            if (pEl) {
              var dr = pEl.getElementsByTagName('*');
              for (var d = dr.length - 1; d >= 0; d--) {
                if (dr[d].localName === 'drawing' && dr[d].parentNode) dr[d].parentNode.removeChild(dr[d]);
              }
            }
          }
        }

        /* 右：說明（vMerge 合併儲存格，只在第一列寫入全部說明） */
        if (i === 0) {
          var descCell = tcs[1];
          setCellParagraphs(descCell, descLines);
        }
      }

      seq += pagePhotos.length;

      /* 表格內段落間距完全沿用範本，不做任何覆寫。
         先前版本為了把 3 張照片塞進同一頁，把每個段落的 spacing 改成
         after=0 / line=240，結果下載下來的檔案行高、段落間距都與範本不同，
         版面看起來「跑掉」。現在改回與範本一致：分頁交給範本自己的
         分頁符（見 prependPageBreak），間距一律不動。 */

      out.push(tbl);
    });

    /* 重排 body */
    var cn = body.childNodes, i;
    for (i = cn.length - 1; i >= 0; i--) {
      if (cn[i].nodeType === 1) body.removeChild(cn[i]);
    }
    out.forEach(function (n) { body.appendChild(n); });
    if (sectPr) body.appendChild(sectPr);

    return serializeXml(doc);
  }

  /** 在 document.xml.rels 加入照片關聯（Id 固定 rIdPhoto1..N，不會撞號） */
  function patchRels(relsXml, count) {
    var doc = parseXml(relsXml);
    var root = doc.documentElement;
    var NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
    for (var i = 1; i <= count; i++) {
      var rel = doc.createElementNS(NS, 'Relationship');
      rel.setAttribute('Id', 'rIdPhoto' + i);
      rel.setAttribute('Type', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image');
      rel.setAttribute('Target', 'media/photo_' + i + '.jpeg');
      root.appendChild(rel);
    }
    return serializeXml(doc);
  }

  /**
   * 產生 .docx
   * @param {object} opts { JSZip, templateBuffer, data, outputType }
   *   data.photos[i].data = ArrayBuffer / Uint8Array（JPEG 位元組）
   */
  function build(opts) {
    var JSZip = opts.JSZip;
    var outputType = opts.outputType || 'blob';
    if (!JSZip) return Promise.reject(new Error('缺少 JSZip'));
    var data = opts.data || {};
    var photos = data.photos || [];

    return JSZip.loadAsync(opts.templateBuffer).then(function (zip) {
      var f = zip.file('word/document.xml');
      if (!f) throw new Error('範本缺少 word/document.xml');
      return f.async('string').then(function (xml) {
        var patched = patchDocumentXml(xml, data);
        zip.file('word/document.xml', patched);

        var relsF = zip.file('word/_rels/document.xml.rels');
        var relsP = relsF ? relsF.async('string').then(function (rx) {
          zip.file('word/_rels/document.xml.rels', patchRels(rx, photos.length));
        }) : Promise.resolve();

        return relsP.then(function () {
          var jobs = [];
          photos.forEach(function (ph, i) {
            if (ph.data) {
              jobs.push(zip.file('word/media/photo_' + (i + 1) + '.jpeg', ph.data, { binary: true }));
            }
          });
          return Promise.all(jobs).then(function () {
            return zip.generateAsync({
              type: outputType,
              compression: 'DEFLATE',
              compressionOptions: { level: 6 },
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            });
          });
        });
      });
    });
  }

  return {
    build: build,
    setParsers: setParsers,
    patchDocumentXml: patchDocumentXml,
    patchRels: patchRels,
    paginate: paginate,
    rocDot: rocDot,
    DEFAULT_TITLE: DEFAULT_TITLE,
    FIXED_PROJECT: FIXED_PROJECT,
    FIXED_CONTRACTOR: FIXED_CONTRACTOR,
    FIXED_SITE: FIXED_SITE,
    PHOTO_PER_PAGE: PHOTO_PER_PAGE
  };
});
