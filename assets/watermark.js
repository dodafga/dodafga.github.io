/*!
 * watermark.js — 歸檔日期浮水印（右下角）
 *
 * 樣式依參考照片量測：
 *   - 顏色：橘色 #FF7505（實測核心色 255,117,5）
 *   - 字重：粗體、無襯線、字距略緊
 *   - 陰影：黑色、右下微偏移、輕微模糊（無底色塊）
 *   - 位置：右下角，右邊距約 1.9% 圖寬、下邊距約 2.4% 圖高
 *   - 字高：約 3.5% 圖高（cap height），文字總寬約 16.7% 圖寬
 *
 * 功能：
 *   - detectExisting()：偵測照片是否已有相機 App 壓的日期時間戳，避免重複壓
 *   - render()：把浮水印壓進 canvas
 *   - toBlob()：輸出 JPEG（預覽用）
 *   - toPng()：輸出 PNG（上傳到 Google Drive 用，無損）
 *   - previewDataURL()：直接以預覽尺寸繪製（不再先算 2000px 再縮小）
 *
 * 本版效能重點：
 *   1. previewDataURL 直接以 720px 繪製 —— 原本先 render 2000px 再縮成 720px，
 *      等於每張預覽都做了 7.7 倍的多餘像素運算（手機上非常明顯）。
 *   2. 連通元件與字元分群加上上限，避免雜訊多的照片讓 BFS／O(n²) 分群爆掉。
 *   3. 偵測用的 canvas 用完即釋放（寬高歸零），避免 Safari 保留大塊記憶體。
 *
 * 瀏覽器：window.PhotoWatermark
 */
(function (global) {
  'use strict';

  var CORE = global.Core || null;

  var COLOR = '#FF7505';
  var FONT_STACK = '"Arial Black","Helvetica Neue",Arial,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

  var LIMITS = (CORE && CORE.LIMITS) || {};
  var MAX_EDGE_DEFAULT = LIMITS.MAX_EDGE || 2000;
  var PREVIEW_EDGE = LIMITS.PREVIEW_EDGE || 720;
  var PREVIEW_QUALITY = LIMITS.JPEG_QUALITY || 0.88;
  var DETECT_WIDTH = LIMITS.DETECT_WIDTH || 480;
  var DETECT_MAX_GLYPHS = LIMITS.DETECT_MAX_GLYPHS || 400;
  var DETECT_MAX_COMPONENTS = LIMITS.DETECT_MAX_COMPONENTS || 4000;

  /* 樣式比例（依範本照片 1600×1200 逐像素量測，見下方註解） */
  var RATIO = {
    /* 字級 = 短邊 × 0.035。實測：fs=42 時數字 cap height = 29px，
       29 / 1200 = 2.42% 圖高，而 42 / 1200 = 3.5% → 故比例取 0.035。 */
    fontSize: 0.035,
    /* 右邊距 = 短邊 × 0.025。實測文字右緣距圖右 30px，30 / 1200 = 2.5%。 */
    margin: 0.025,
    /* 基線距圖底 = 短邊 × 0.035。實測基線 y=1158，1200-1-1158 = 41px ≈ 3.4%。 */
    marginBottom: 0.035,
    /* 文字總寬 = 圖寬 × 0.1669。實測 267 / 1600 = 16.69%。 */
    textWidth: 0.1669,
    maxWidth: 0.34,    /* 文字最寬不超過圖寬 34% */
    /* 陰影：實測文字外圍 0–3px 環亮度 120、3–8px 環 131（僅暗約 8%），
       因此是「很淡的黑色陰影」，不是粗黑描邊。 */
    shadowAlpha: 0.45,
    shadowBlur: 0.06,  /* 陰影模糊 = 字級 × 0.06 */
    shadowOff:  0.03   /* 陰影偏移 = 字級 × 0.03 */
  };

  /* ---------------- 影像載入 ---------------- */

  function loadImageFromBlob(blob) {
    if (global.createImageBitmap) {
      return global.createImageBitmap(blob).then(function (bmp) {
        return {
          el: bmp,
          width: bmp.width,
          height: bmp.height,
          release: function () { try { bmp.close(); } catch (e) {} }
        };
      }).catch(function () { return loadViaObjectURL(blob); });
    }
    return loadViaObjectURL(blob);
  }

  function loadViaObjectURL(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        resolve({
          el: img,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          release: function () { try { URL.revokeObjectURL(url); } catch (e) {} }
        });
      };
      img.onerror = function () {
        try { URL.revokeObjectURL(url); } catch (e) {}
        reject(new Error('圖片載入失敗'));
      };
      img.src = url;
    });
  }

  /* ---------------- 既有浮水印偵測 ---------------- */

  /**
   * 偵測照片底部是否已有日期時間戳（相機 App 常見：橘黃色或白色文字 + 深色描邊）。
   * 回傳 { found:boolean, reason:string, box:{x,y,w,h}|null }
   */
  function detectExisting(img) {
    var scale = Math.min(1, DETECT_WIDTH / Math.max(1, img.width));
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { found: false, reason: 'no-ctx', box: null };
    ctx.drawImage(img.el, 0, 0, w, h);

    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; }
    catch (e) {
      /* 跨網域圖片會讓 getImageData 丟錯；釋放畫布後回報無法偵測 */
      cv.width = 0; cv.height = 0;
      return { found: false, reason: 'no-data', box: null };
    }
    /* 資料已取出，畫布可以立刻釋放（Safari 對大 canvas 很敏感） */
    cv.width = 0; cv.height = 0;

    var y0 = Math.floor(h * 0.72);
    var sh = h - y0;
    if (sh < 4) return { found: false, reason: 'too-small', box: null };

    /* 遮罩：高飽和暖色 或 近白 */
    var mask = new Uint8Array(w * sh);
    for (var y = y0; y < h; y++) {
      var rowOff = (y - y0) * w;
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        var orange = (r > 185 && (r - b) > 100 && g > 45 && g < 180 && b < 100);
        var white  = (mn > 222 && (mx - mn) < 25);
        if (orange || white) mask[rowOff + x] = 1;
      }
    }

    /* 連通元件（8 連通，迭代式 BFS，避免遞迴爆堆疊） */
    var seen = new Uint8Array(w * sh);
    var comps = [];
    var stack = new Int32Array(w * sh);
    var overflow = false;

    for (var sy = 0; sy < sh && !overflow; sy++) {
      for (var sx = 0; sx < w; sx++) {
        var si = sy * w + sx;
        if (!mask[si] || seen[si]) continue;
        var sp = 0;
        stack[sp++] = si; seen[si] = 1;
        var minX = sx, maxX = sx, minY = sy, maxY = sy, area = 0;
        while (sp > 0) {
          var cur = stack[--sp];
          var cy = (cur / w) | 0, cx = cur - cy * w;
          area++;
          if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
          for (var dy = -1; dy <= 1; dy++) {
            var ny = cy + dy;
            if (ny < 0 || ny >= sh) continue;
            for (var dx = -1; dx <= 1; dx++) {
              var nx = cx + dx;
              if (nx < 0 || nx >= w) continue;
              var ni = ny * w + nx;
              if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack[sp++] = ni; }
            }
          }
        }
        comps.push({ x0: minX, y0: minY, x1: maxX, y1: maxY, area: area });
        /* 保護：雜訊極多的照片（例如樹葉、碎石）會產生上萬個元件 */
        if (comps.length >= DETECT_MAX_COMPONENTS) { overflow = true; break; }
      }
    }

    /* 篩出「字元大小」的元件 */
    var minCh = Math.max(4, Math.round(h * 0.018));
    var maxCh = Math.round(h * 0.10);
    var maxCw = Math.round(w * 0.09);
    var glyphs = [];
    for (var ci = 0; ci < comps.length; ci++) {
      var c = comps[ci];
      var cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1;
      if (ch < minCh || ch > maxCh) continue;
      if (cw > maxCw) continue;
      if (c.area < 6) continue;
      glyphs.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, cw: cw, ch: ch });
      if (glyphs.length >= DETECT_MAX_GLYPHS) break;
    }
    if (glyphs.length < 5) return { found: false, reason: 'few-glyphs', box: null };

    /* 依基線與字高分群 */
    var baseTol = Math.max(2, Math.round(h * 0.012));
    var hTol = Math.max(2, Math.round(h * 0.02));
    var best = null;

    for (var gi = 0; gi < glyphs.length; gi++) {
      var g = glyphs[gi];
      var grp = [];
      for (var gj = 0; gj < glyphs.length; gj++) {
        var q = glyphs[gj];
        if (Math.abs(q.y1 - g.y1) <= baseTol && Math.abs(q.ch - g.ch) <= hTol) grp.push(q);
      }
      if (grp.length < 5) continue;

      grp.sort(function (a, b) { return a.x0 - b.x0; });

      var span = grp[grp.length - 1].x1 - grp[0].x0 + 1;
      if (span < Math.round(w * 0.07)) continue;
      if (span > Math.round(w * 0.55)) continue;

      /* 字元間距必須緊密（日期時間戳是連續字串） */
      var maxGap = 0;
      for (var gk = 1; gk < grp.length; gk++) {
        var gap = grp[gk].x0 - grp[gk - 1].x1;
        if (gap > maxGap) maxGap = gap;
      }
      if (maxGap > Math.round(w * 0.08)) continue;

      /* 字高必須一致 */
      var hMin = grp[0].ch, hMax = grp[0].ch;
      for (var gh = 1; gh < grp.length; gh++) {
        if (grp[gh].ch < hMin) hMin = grp[gh].ch;
        if (grp[gh].ch > hMax) hMax = grp[gh].ch;
      }
      if ((hMax - hMin) > Math.max(2, Math.round(hMax * 0.30))) continue;

      /* 必須位於畫面下方 25% 內 */
      var topY = grp[0].y0;
      for (var gt = 1; gt < grp.length; gt++) if (grp[gt].y0 < topY) topY = grp[gt].y0;
      if (topY + y0 < Math.round(h * 0.75)) continue;

      var score = grp.length * 10 + (span / w) * 20;
      if (!best || score > best.score) {
        best = {
          score: score,
          count: grp.length,
          box: {
            x: Math.round(grp[0].x0 / scale),
            y: Math.round((topY + y0) / scale),
            w: Math.round(span / scale),
            h: Math.round((g.y1 - topY + 1) / scale)
          }
        };
      }
    }

    if (best) return { found: true, reason: 'bottom-text', box: best.box, glyphs: best.count };
    return { found: false, reason: 'none', box: null };
  }

  /* ---------------- 繪製浮水印 ---------------- */

  function drawWatermark(ctx, w, h, text) {
    var minDim = Math.min(w, h);
    var fs = Math.max(11, Math.round(minDim * RATIO.fontSize));
    var marginR = Math.max(6, Math.round(minDim * RATIO.margin));
    var marginB = Math.max(6, Math.round(minDim * RATIO.marginBottom));

    /* 範本日期格式為「2026.11.09」（點號），不是 2026-11-09 */
    var str = String(text == null ? '' : text).replace(/-/g, '.');
    if (!str) return { fontSize: fs, margin: marginR };

    ctx.save();
    ctx.font = '700 ' + fs + 'px ' + FONT_STACK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    var chars = str.split('');
    var natural = 0, inkL = 0, inkR = 0;
    try {
      var mm = ctx.measureText(str);
      natural = mm.width;
      /* 用「墨跡邊界」而非「前進寬度」對齊，才能讓文字右緣精準落在邊距上
         （前進寬度含最後一字的右側留白，會讓右邊距多出 1～2px）。 */
      inkL = (mm.actualBoundingBoxLeft != null) ? mm.actualBoundingBoxLeft : 0;
      inkR = (mm.actualBoundingBoxRight != null) ? mm.actualBoundingBoxRight : natural;
    } catch (e) { natural = 0; inkL = 0; inkR = 0; }
    var inkW0 = inkR - inkL;
    if (!(inkW0 > 0)) inkW0 = natural;

    /* 逐字加字距，讓「文字墨跡寬 / 圖寬」與範本一致（16.69%）。
       為什麼要逐字畫：canvas 的 letterSpacing 只有 Chrome 99+ / Safari 17.4+ 支援，
       逐字畫在舊 Safari 也有一樣結果，且能精準控制總寬。 */
    var target = w * RATIO.textWidth;
    var maxW = w * RATIO.maxWidth;
    if (target > maxW) target = maxW;

    var spacing = 0;
    if (chars.length > 1 && inkW0 > 0) {
      spacing = (target - inkW0) / (chars.length - 1);
      var maxSp = fs * 0.22;
      var minSp = -fs * 0.05;
      if (spacing > maxSp) spacing = maxSp;
      if (spacing < minSp) spacing = minSp;
    }

    var total = inkW0 + spacing * (chars.length - 1);
    /* 起點：讓墨跡右緣剛好落在 w - marginR */
    var x = w - marginR - (inkR + spacing * (chars.length - 1));
    var y = h - marginB;

    /* 淡黑色陰影（無底色塊、無粗描邊） */
    ctx.shadowColor = 'rgba(0,0,0,' + RATIO.shadowAlpha + ')';
    ctx.shadowBlur = Math.max(1, Math.round(fs * RATIO.shadowBlur));
    ctx.shadowOffsetX = Math.max(1, Math.round(fs * RATIO.shadowOff));
    ctx.shadowOffsetY = Math.max(1, Math.round(fs * RATIO.shadowOff));

    ctx.fillStyle = COLOR;
    var i, cw;
    for (i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], x, y);
      try { cw = ctx.measureText(chars[i]).width; } catch (e) { cw = fs * 0.5; }
      x += cw + spacing;
    }
    ctx.restore();

    return { fontSize: fs, margin: marginR, spacing: spacing, width: total };
  }

  /* ---------------- 主流程 ---------------- */

  /**
   * 把照片畫到 canvas（可同時縮圖），必要時壓上浮水印。
   * opts: { maxEdge:2000, date:'YYYY-MM-DD', watermark:true, detect:true }
   * 回傳 { canvas, width, height, applied, detected, box }
   */
  function render(img, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge || MAX_EDGE_DEFAULT;
    var w0 = img.width, h0 = img.height;
    if (!w0 || !h0) throw new Error('圖片尺寸無效');

    var scale = Math.min(1, maxEdge / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * scale));
    var h = Math.max(1, Math.round(h0 * scale));

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    if (!ctx) throw new Error('無法建立畫布');

    /* 白底（避免 PNG 透明區變黑） */
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img.el, 0, 0, w, h);

    var detected = false, box = null;
    if (opts.detect !== false) {
      var d = detectExisting(img);
      detected = !!d.found;
      box = d.box;
    }

    var applied = false;
    if (opts.watermark !== false && !detected && opts.date) {
      drawWatermark(ctx, w, h, opts.date);
      applied = true;
    }

    return { canvas: cv, width: w, height: h, applied: applied, detected: detected, box: box };
  }

  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) {
          if (b) resolve(b);
          else reject(new Error('影像輸出失敗'));
        }, 'image/jpeg', quality == null ? PREVIEW_QUALITY : quality);
      } catch (e) { reject(e); }
    });
  }

  /** 輸出 PNG（無損）。上傳到 Google Drive 的照片一律用這個。 */
  function toPng(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) {
          if (b) resolve(b);
          else reject(new Error('影像輸出失敗'));
        }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  /**
   * 產生預覽用 dataURL。
   * 直接以預覽尺寸（720px）繪製 —— 不再先算 2000px 再縮小。
   * 浮水印比例是相對短邊計算，因此縮小後外觀與實際輸出完全一致。
   */
  function previewDataURL(img, opts) {
    opts = opts || {};
    var previewOpts = {
      maxEdge: Math.min(opts.maxEdge || MAX_EDGE_DEFAULT, PREVIEW_EDGE),
      date: opts.date,
      watermark: opts.watermark,
      detect: opts.detect
    };
    var r = render(img, previewOpts);
    return {
      url: r.canvas.toDataURL('image/jpeg', PREVIEW_QUALITY),
      applied: r.applied,
      detected: r.detected,
      width: r.width,
      height: r.height
    };
  }

  global.PhotoWatermark = {
    COLOR: COLOR,
    RATIO: RATIO,
    loadImageFromBlob: loadImageFromBlob,
    detectExisting: detectExisting,
    drawWatermark: drawWatermark,
    render: render,
    toBlob: toBlob,
    toPng: toPng,
    previewDataURL: previewDataURL
  };

})(typeof window !== 'undefined' ? window : this);
