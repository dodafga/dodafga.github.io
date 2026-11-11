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
 *   - detectExisting()：偵測相片是否已有相機 App 壓的日期時間戳，避免重複壓
 *   - render()：把浮水印壓進 canvas（實際輸出 JPEG 會帶浮水印）
 *   - toBlob()：輸出 JPEG
 *
 * 瀏覽器：window.PhotoWatermark
 */
(function (global) {
  'use strict';

  var COLOR = '#FF7505';
  var FONT_STACK = '"Arial Black","Helvetica Neue",Arial,"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif';

  /* 樣式比例（依參考圖量測） */
  var RATIO = {
    fontSize: 0.048,   /* 字級 = 短邊 × 0.048（cap height 約 3.5% 圖高） */
    margin:   0.025,   /* 邊距 = 短邊 × 0.025（右 1.9% 圖寬、下 2.4% 圖高） */
    maxWidth: 0.34,    /* 文字最寬不超過圖寬 34% */
    shadowBlur: 0.10,  /* 陰影模糊 = 字級 × 0.10 */
    shadowOff:  0.045  /* 陰影偏移 = 字級 × 0.045 */
  };

  /* ---------------- 影像載入 ---------------- */

  function loadImageFromBlob(blob) {
    if (global.createImageBitmap) {
      return global.createImageBitmap(blob).then(function (bmp) {
        return { el: bmp, width: bmp.width, height: bmp.height, release: function () { try { bmp.close(); } catch (e) {} } };
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
   * 偵測相片底部是否已有日期時間戳（相機 App 常見：橘黃色或白色文字 + 深色描邊）。
   * 回傳 { found:boolean, reason:string, box:{x,y,w,h}|null }
   *
   * 演算法（在縮小到寬 480px 的畫布上做，速度快）：
   *   1. 只掃描畫面下方 28% 帶狀區域
   *   2. 建立「文字樣」遮罩：高飽和暖色（橘／黃）或近白
   *   3. 連通元件分析，取出「字元大小」的元件
   *   4. 依基線（底部 y）與字高把字元分群，要求：
   *        - 同群至少 5 個字元（日期時間戳一定有 5 個以上字元）
   *        - 字高一致（差異 ≤ 30%）
   *        - 字元間距緊密（無大缺口）
   *        - 整串寬度 7%~55% 圖寬
   *        - 位於畫面下方 25% 內
   *   5. 符合即判定「已有時間戳」，不再重複壓浮水印
   */
  function detectExisting(img) {
    var MAXW = 480;
    var scale = Math.min(1, MAXW / Math.max(1, img.width));
    var w = Math.max(1, Math.round(img.width * scale));
    var h = Math.max(1, Math.round(img.height * scale));

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { found: false, reason: 'no-ctx', box: null };
    ctx.drawImage(img.el, 0, 0, w, h);

    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; }
    catch (e) { return { found: false, reason: 'no-data', box: null }; }

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
    for (var sy = 0; sy < sh; sy++) {
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
      var hs = grp.map(function (q) { return q.ch; });
      var hMin = Math.min.apply(null, hs), hMax = Math.max.apply(null, hs);
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
    var margin = Math.max(6, Math.round(minDim * RATIO.margin));

    ctx.save();
    ctx.font = '700 ' + fs + 'px ' + FONT_STACK;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';

    /* 字距略緊，貼近參考圖的緊湊感（Chrome 99+ 支援 letterSpacing） */
    try { ctx.letterSpacing = (-fs * 0.02).toFixed(2) + 'px'; } catch (e) {}

    /* 太寬就縮字級，避免壓到畫面中央 */
    var tw = 0;
    try { tw = ctx.measureText(text).width; } catch (e) { tw = 0; }
    var maxW = w * RATIO.maxWidth;
    if (tw > maxW && tw > 0) {
      fs = Math.max(10, Math.floor(fs * (maxW / tw)));
      ctx.font = '700 ' + fs + 'px ' + FONT_STACK;
      try { ctx.letterSpacing = (-fs * 0.02).toFixed(2) + 'px'; } catch (e) {}
    }

    /* 黑色陰影（無底色塊） */
    ctx.shadowColor = 'rgba(0,0,0,0.88)';
    ctx.shadowBlur = Math.max(2, Math.round(fs * RATIO.shadowBlur));
    ctx.shadowOffsetX = Math.max(1, Math.round(fs * RATIO.shadowOff));
    ctx.shadowOffsetY = Math.max(1, Math.round(fs * RATIO.shadowOff));

    ctx.fillStyle = COLOR;
    ctx.fillText(text, w - margin, h - margin);
    ctx.restore();

    return { fontSize: fs, margin: margin };
  }

  /* ---------------- 主流程 ---------------- */

  /**
   * 把相片畫到 canvas（可同時縮圖），必要時壓上浮水印。
   * opts: { maxEdge:2000, date:'YYYY-MM-DD', watermark:true, detect:true }
   * 回傳 { canvas, width, height, applied, detected, box }
   */
  function render(img, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge || 2000;
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
        }, 'image/jpeg', quality == null ? 0.88 : quality);
      } catch (e) { reject(e); }
    });
  }

  /**
   * 產生預覽用 dataURL（小圖，僅供畫面顯示）
   */
  function previewDataURL(img, opts) {
    var r = render(img, opts);
    var maxPrev = 720;
    var s = Math.min(1, maxPrev / Math.max(r.width, r.height));
    var out = r.canvas;
    if (s < 1) {
      var c2 = document.createElement('canvas');
      c2.width = Math.max(1, Math.round(r.width * s));
      c2.height = Math.max(1, Math.round(r.height * s));
      var x2 = c2.getContext('2d');
      x2.drawImage(r.canvas, 0, 0, c2.width, c2.height);
      out = c2;
    }
    return {
      url: out.toDataURL('image/jpeg', 0.82),
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
    previewDataURL: previewDataURL
  };

})(typeof window !== 'undefined' ? window : this);
