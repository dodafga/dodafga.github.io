/*!
 * photo-edit.js — 照片編輯（僅 /drive/ 載入）
 *
 * 兩個功能，彼此完全獨立，也與「文字方向自動轉正」完全獨立：
 *
 *   1) 手動旋轉 90°
 *      - 由使用者按鈕決定，每次 +90°（可左轉／右轉／重設）
 *      - 只是一個「最終角度」參數，交給 watermark.render() 在
 *        自動轉正之後、壓浮水印之前套用
 *      - 自動轉正關閉時，手動旋轉照樣可用
 *
 *   2) 消除簽名
 *      - 在照片上框出簽名範圍（可自動偵測建議框，也可手動拖曳調整）
 *      - 以「周圍紙面顏色內插」把框內筆跡抹掉，保留紙張明暗漸層
 *      - 結果會變成該張照片的新工作檔（PNG），後續預覽與上傳都用它
 *
 * 瀏覽器：window.PhotoEdit
 */
(function (global) {
  'use strict';

  var C = global.Core || null;
  var $ = C ? C.$ : function (id) { return document.getElementById(id); };

  /* ============================================================
   * 影像基礎工具
   * ============================================================ */

  function loadImage(blob) {
    var WM = global.PhotoWatermark;
    if (!WM || !WM.loadImageFromBlob) return Promise.reject(new Error('影像模組未載入'));
    return WM.loadImageFromBlob(blob);
  }

  /** 把圖片畫到 canvas（可同時縮到 maxEdge 以內），白底。 */
  function canvasFromImage(img, maxEdge) {
    var w0 = img.width, h0 = img.height;
    if (!w0 || !h0) throw new Error('圖片尺寸無效');
    var s = Math.min(1, (maxEdge || 2000) / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * s));
    var h = Math.max(1, Math.round(h0 * s));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('無法建立畫布');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img.el, 0, 0, w, h);
    return cv;
  }

  function canvasToBlob(cv) {
    return new Promise(function (resolve, reject) {
      try {
        cv.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('影像輸出失敗'));
        }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  /* ============================================================
   * 簽名偵測（啟發式，僅提供「建議框」，使用者可自行調整）
   *
   * 思路：簽名是「深色、細筆畫、非長直線」的連通元件群。
   *   1. 縮到 900px 內求灰階
   *   2. 以全圖平均亮度推門檻，取深色遮罩
   *   3. 移除長直線（表格格線）—— 整列／整欄連續過長者剔除
   *   4. 連通元件，濾掉過大／過小／過度細長者
   *   5. 依水平鄰近度分群，取「元件數多、寬度合理、位置偏下」的一群
   * ============================================================ */

  function detectSignature(img) {
    var cv;
    try { cv = canvasFromImage(img, 900); } catch (e) { return null; }
    var w = cv.width, h = cv.height;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    var data;
    try { data = ctx.getImageData(0, 0, w, h).data; }
    catch (e) { cv.width = 0; cv.height = 0; return null; }

    var n = w * h;
    var gray = new Uint8Array(n);
    var sum = 0;
    for (var i = 0, p = 0; i < data.length; i += 4, p++) {
      var g = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      gray[p] = g;
      sum += g;
    }
    var mean = sum / n;
    /* 紙面通常很亮；門檻取平均的 0.72，且不低於 90，避免整張偏暗時全被當筆跡 */
    var thr = Math.max(90, Math.min(170, mean * 0.72));

    var mask = new Uint8Array(n);
    for (var k = 0; k < n; k++) if (gray[k] < thr) mask[k] = 1;

    /* --- 移除長直線（表格格線） --- */
    var runLimitX = Math.max(24, Math.round(w * 0.30));
    var runLimitY = Math.max(24, Math.round(h * 0.30));
    var x, y, run, start;
    for (y = 0; y < h; y++) {
      run = 0; start = 0;
      for (x = 0; x <= w; x++) {
        var on = (x < w && mask[y * w + x]) ? 1 : 0;
        if (on) { if (!run) start = x; run++; }
        else {
          if (run >= runLimitX) for (var rx = start; rx < start + run; rx++) mask[y * w + rx] = 0;
          run = 0;
        }
      }
    }
    for (x = 0; x < w; x++) {
      run = 0; start = 0;
      for (y = 0; y <= h; y++) {
        var on2 = (y < h && mask[y * w + x]) ? 1 : 0;
        if (on2) { if (!run) start = y; run++; }
        else {
          if (run >= runLimitY) for (var ry = start; ry < start + run; ry++) mask[ry * w + x] = 0;
          run = 0;
        }
      }
    }

    /* --- 連通元件（8 連通，迭代式） --- */
    var seen = new Uint8Array(n);
    var stack = new Int32Array(n);
    var comps = [];
    var MAXC = 3000;
    for (var sy = 0; sy < h; sy++) {
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
            if (ny < 0 || ny >= h) continue;
            for (var dx = -1; dx <= 1; dx++) {
              var nx = cx + dx;
              if (nx < 0 || nx >= w) continue;
              var ni = ny * w + nx;
              if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack[sp++] = ni; }
            }
          }
        }
        var cw = maxX - minX + 1, ch = maxY - minY + 1;
        /* 濾掉：太小（雜點）、太大（整塊深色）、過度細長（殘留線段） */
        if (area < 12) continue;
        if (cw * ch > n * 0.06) continue;
        if (cw > w * 0.45 || ch > h * 0.45) continue;
        if (cw / ch > 14 || ch / cw > 14) continue;
        comps.push({ x0: minX, y0: minY, x1: maxX, y1: maxY, area: area });
        if (comps.length >= MAXC) break;
      }
      if (comps.length >= MAXC) break;
    }
    cv.width = 0; cv.height = 0;
    if (comps.length < 3) return null;

    /* --- 先依「垂直帶」分列，再在每一列內依水平鄰近度分群 ---
       簽名的手寫字之間常有較大空隙，若只用水平間距分群，
       三個字會被拆成三群而被「元件數 ≥ 3」的條件濾掉。
       因此先按 y 重疊把同一列的字收在一起，再在列內分群。 */
    comps.sort(function (a, b) { return a.y0 - b.y0; });
    var bands = [];
    var band = null;
    for (var bi = 0; bi < comps.length; bi++) {
      var bc = comps[bi];
      var bcy = (bc.y0 + bc.y1) / 2;
      if (!band) { band = { items: [bc], y0: bc.y0, y1: bc.y1 }; continue; }
      var bandMid = (band.y0 + band.y1) / 2;
      var bandH = Math.max(1, band.y1 - band.y0);
      /* 中心落在同一水平帶（容忍 0.6 倍字高）就視為同一列 */
      if (Math.abs(bcy - bandMid) <= bandH * 0.6 + h * 0.012) {
        band.items.push(bc);
        if (bc.y0 < band.y0) band.y0 = bc.y0;
        if (bc.y1 > band.y1) band.y1 = bc.y1;
      } else {
        bands.push(band);
        band = { items: [bc], y0: bc.y0, y1: bc.y1 };
      }
    }
    if (band) bands.push(band);

    /* 每一列內再依水平間距分群（間距容忍放寬到 0.09 倍寬，容納手寫字距） */
    var groups = [];
    for (var bj = 0; bj < bands.length; bj++) {
      var row = bands[bj].items.slice().sort(function (a, b) { return a.x0 - b.x0; });
      var gapTol = Math.max(8, Math.round(w * 0.09));
      var cur2 = null;
      for (var ci = 0; ci < row.length; ci++) {
        var c = row[ci];
        if (!cur2) { cur2 = { items: [c], x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 }; continue; }
        if (c.x0 - cur2.x1 <= gapTol) {
          cur2.items.push(c);
          if (c.x1 > cur2.x1) cur2.x1 = c.x1;
          if (c.y0 < cur2.y0) cur2.y0 = c.y0;
          if (c.y1 > cur2.y1) cur2.y1 = c.y1;
        } else {
          groups.push(cur2);
          cur2 = { items: [c], x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 };
        }
      }
      if (cur2) groups.push(cur2);
    }

    /* --- 挑最像簽名的一群 ---
       簽名特徵：元件數多（筆畫多）、寬度佔畫面一定比例、位於下方、
       且「高度不大」（不是整段文字段落）。 */
    var best = null, bestScore = 0;
    for (var gi = 0; gi < groups.length; gi++) {
      var gr = groups[gi];
      var gw = gr.x1 - gr.x0 + 1, gh = gr.y1 - gr.y0 + 1;
      if (gr.items.length < 3) continue;
      if (gw < w * 0.05 || gw > w * 0.55) continue;
      if (gh < h * 0.012 || gh > h * 0.30) continue;
      /* 位置偏好：畫面下半部（簽名幾乎都在下方） */
      var cyMid = (gr.y0 + gr.y1) / 2 / h;
      var posBonus = cyMid > 0.55 ? 1.6 : (cyMid > 0.40 ? 1.0 : 0.45);
      /* 筆畫密度：元件數多但面積不大 → 手寫字 */
      var score = gr.items.length * posBonus * (1 + gw / w);
      if (score > bestScore) { bestScore = score; best = gr; }
    }
    if (!best) return null;

    /* 換算回原圖座標，並留一點邊界 */
    var scale = img.width / w;
    var padX = Math.max(4, Math.round((best.x1 - best.x0) * 0.06));
    var padY = Math.max(4, Math.round((best.y1 - best.y0) * 0.22));
    var bx = Math.max(0, Math.round(best.x0 * scale) - padX);
    var by = Math.max(0, Math.round(best.y0 * scale) - padY);
    var bw = Math.min(img.width - bx, Math.round((best.x1 - best.x0 + 1) * scale) + padX * 2);
    var bh = Math.min(img.height - by, Math.round((best.y1 - best.y0 + 1) * scale) + padY * 2);
    return { x: bx, y: by, w: bw, h: bh, parts: best.items.length, score: bestScore };
  }

  /* ============================================================
   * 消除框內內容（紙面顏色內插）
   *
   * 對框內每一點，取「框外左右」與「框外上下」最近的紙面顏色，
   * 依距離加權混合。這樣可以保留紙張的明暗漸層與陰影，
   * 不會留下一塊死白的方塊。
   * ============================================================ */

  function eraseRegion(cv, box) {
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return cv;
    var w = cv.width, h = cv.height;
    var x0 = Math.max(0, Math.round(box.x));
    var y0 = Math.max(0, Math.round(box.y));
    var x1 = Math.min(w, Math.round(box.x + box.w));
    var y1 = Math.min(h, Math.round(box.y + box.h));
    if (x1 - x0 < 2 || y1 - y0 < 2) return cv;

    var imgData;
    try { imgData = ctx.getImageData(0, 0, w, h); }
    catch (e) { return cv; }
    var d = imgData.data;

    var pad = Math.max(3, Math.round(Math.min(w, h) * 0.008));
    var lx = Math.max(0, x0 - pad);
    var rx = Math.min(w - 1, x1 + pad - 1);
    var ty = Math.max(0, y0 - pad);
    var by = Math.min(h - 1, y1 + pad - 1);

    function px(x, y) { var i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; }

    /* 先把左右兩條邊界顏色取出來（避免邊界本身也被改到） */
    var leftCol = new Uint8Array((y1 - y0) * 3);
    var rightCol = new Uint8Array((y1 - y0) * 3);
    for (var yy = y0; yy < y1; yy++) {
      var lc = px(lx, yy), rc = px(rx, yy);
      var o = (yy - y0) * 3;
      leftCol[o] = lc[0]; leftCol[o + 1] = lc[1]; leftCol[o + 2] = lc[2];
      rightCol[o] = rc[0]; rightCol[o + 1] = rc[1]; rightCol[o + 2] = rc[2];
    }
    var topRow = new Uint8Array((x1 - x0) * 3);
    var botRow = new Uint8Array((x1 - x0) * 3);
    for (var xx = x0; xx < x1; xx++) {
      var tc = px(xx, ty), bc = px(xx, by);
      var o2 = (xx - x0) * 3;
      topRow[o2] = tc[0]; topRow[o2 + 1] = tc[1]; topRow[o2 + 2] = tc[2];
      botRow[o2] = bc[0]; botRow[o2 + 1] = bc[1]; botRow[o2 + 2] = bc[2];
    }

    var bw = x1 - x0, bh = y1 - y0;
    for (var y = y0; y < y1; y++) {
      var ty2 = (y - y0 + 0.5) / bh;
      var oy = (y - y0) * 3;
      for (var x = x0; x < x1; x++) {
        var tx = (x - x0 + 0.5) / bw;
        var ox = (x - x0) * 3;
        var i2 = (y * w + x) * 4;
        for (var ch = 0; ch < 3; ch++) {
          var horiz = leftCol[oy + ch] * (1 - tx) + rightCol[oy + ch] * tx;
          var vert = topRow[ox + ch] * (1 - ty2) + botRow[ox + ch] * ty2;
          /* 水平與垂直各佔一半權重 */
          d[i2 + ch] = Math.round((horiz + vert) / 2);
        }
        d[i2 + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return cv;
  }

  /* ============================================================
   * 對外：把一張 blob 的指定區域消除，回傳新 blob
   * ============================================================ */

  function eraseSignature(blob, box, maxEdge) {
    return loadImage(blob).then(function (img) {
      var cv;
      try { cv = canvasFromImage(img, maxEdge || 2000); }
      finally { try { img.release(); } catch (e) {} }
      /* box 是「原圖座標」，canvas 可能已縮放，需換算 */
      var s = cv.width / (img.width || cv.width);
      var scaled = { x: box.x * s, y: box.y * s, w: box.w * s, h: box.h * s };
      eraseRegion(cv, scaled);
      return canvasToBlob(cv);
    });
  }

  /* ============================================================
   * 簽名消除對話框（動態建立，不佔 index.html 版面）
   * ============================================================ */

  var modal = null;
  var mState = null;

  function buildModal() {
    if (modal) return modal;
    var wrap = document.createElement('div');
    wrap.className = 'pe-mask';
    wrap.innerHTML =
      '<div class="pe-dlg" role="dialog" aria-modal="true" aria-label="消除簽名">' +
        '<div class="pe-h">' +
          '<b>✎ 消除簽名</b>' +
          '<span class="pe-sub">在照片上拖曳框出要消除的範圍</span>' +
          '<span class="pe-sp"></span>' +
          '<button type="button" class="pe-x" data-pe="close" aria-label="關閉">✕</button>' +
        '</div>' +
        '<div class="pe-b">' +
          '<div class="pe-stage" id="peStage">' +
            '<canvas id="peCanvas"></canvas>' +
            '<div class="pe-sel" id="peSel" hidden></div>' +
          '</div>' +
          '<div class="pe-tools">' +
            '<button type="button" class="btn btn-ghost btn-sm" data-pe="auto">🔍 自動偵測簽名</button>' +
            '<button type="button" class="btn btn-ghost btn-sm" data-pe="clear">清除框選</button>' +
            '<span class="pe-sp"></span>' +
            '<span class="pe-info" id="peInfo">尚未框選</span>' +
          '</div>' +
          '<div class="pe-note">' +
            '自動偵測是<b>啟發式</b>（找深色細筆畫、排除表格格線），只提供建議框；' +
            '請自行確認框是否完整蓋住簽名，必要時拖曳調整。消除後會以周圍紙面顏色填補。' +
          '</div>' +
        '</div>' +
        '<div class="pe-f">' +
          '<button type="button" class="btn btn-ghost" data-pe="close">取消</button>' +
          '<button type="button" class="btn btn-amber" data-pe="apply" id="peApply" disabled>消除並套用</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    modal = wrap;

    wrap.addEventListener('click', function (e) {
      var t = e.target;
      if (t === wrap) { closeModal(); return; }
      var b = t.closest ? t.closest('[data-pe]') : null;
      if (!b) return;
      var act = b.getAttribute('data-pe');
      if (act === 'close') closeModal();
      else if (act === 'auto') autoDetect();
      else if (act === 'clear') { mState.box = null; drawSel(); }
      else if (act === 'apply') applyErase();
    });

    bindDrag();
    return wrap;
  }

  function bindDrag() {
    var stage = modal.querySelector('#peStage');
    var sel = modal.querySelector('#peSel');
    var dragging = false, sx = 0, sy = 0;

    function pos(e) {
      var r = stage.getBoundingClientRect();
      var pt = (e.touches && e.touches[0]) ? e.touches[0] : e;
      return {
        x: Math.max(0, Math.min(r.width, pt.clientX - r.left)),
        y: Math.max(0, Math.min(r.height, pt.clientY - r.top))
      };
    }

    function down(e) {
      if (!mState || !mState.ready) return;
      e.preventDefault();
      dragging = true;
      var p = pos(e);
      sx = p.x; sy = p.y;
      mState.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      drawSel();
    }
    function move(e) {
      if (!dragging || !mState || !mState.drag) return;
      e.preventDefault();
      var p = pos(e);
      mState.drag.x1 = p.x; mState.drag.y1 = p.y;
      drawSel();
    }
    function up(e) {
      if (!dragging) return;
      dragging = false;
      if (!mState || !mState.drag) return;
      var d = mState.drag;
      var x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
      var w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
      mState.drag = null;
      if (w < 8 || h < 8) { mState.box = null; drawSel(); return; }
      /* 顯示座標 → 原圖座標 */
      var s = mState.imgW / mState.dispW;
      mState.box = { x: x * s, y: y * s, w: w * s, h: h * s };
      drawSel();
    }

    stage.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    stage.addEventListener('touchstart', down, { passive: false });
    stage.addEventListener('touchmove', move, { passive: false });
    stage.addEventListener('touchend', up);
    stage.addEventListener('touchcancel', up);
  }

  function drawSel() {
    if (!mState) return;
    var sel = modal.querySelector('#peSel');
    var info = modal.querySelector('#peInfo');
    var apply = modal.querySelector('#peApply');
    var box = null;

    if (mState.drag) {
      var d = mState.drag;
      box = {
        x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1),
        w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0)
      };
    } else if (mState.box) {
      var s = mState.dispW / mState.imgW;
      box = { x: mState.box.x * s, y: mState.box.y * s, w: mState.box.w * s, h: mState.box.h * s };
    }

    if (!box || box.w < 2 || box.h < 2) {
      sel.hidden = true;
      info.textContent = '尚未框選';
      apply.disabled = true;
      return;
    }
    sel.hidden = false;
    sel.style.left = box.x + 'px';
    sel.style.top = box.y + 'px';
    sel.style.width = box.w + 'px';
    sel.style.height = box.h + 'px';
    info.textContent = '已框選 ' + Math.round(box.w) + ' × ' + Math.round(box.h) + ' px';
    apply.disabled = false;
  }

  function autoDetect() {
    if (!mState || !mState.ready) return;
    var box = detectSignature(mState.img);
    if (!box) {
      mState.box = null;
      drawSel();
      if (C && C.makeToast) { /* 由呼叫端 toast */ }
      mState.onInfo && mState.onInfo('自動偵測找不到明顯簽名，請手動拖曳框選');
      return;
    }
    mState.box = box;
    drawSel();
    mState.onInfo && mState.onInfo('已自動框選，請確認範圍是否完整');
  }

  function applyErase() {
    if (!mState || !mState.box) return;
    var apply = modal.querySelector('#peApply');
    apply.disabled = true;
    apply.textContent = '處理中…';
    var box = mState.box;
    var src = mState.blob;
    eraseSignature(src, box, 2000).then(function (blob) {
      var cb = mState.onDone;
      closeModal();
      if (cb) cb(blob);
    }).catch(function () {
      apply.disabled = false;
      apply.textContent = '消除並套用';
      mState.onInfo && mState.onInfo('處理失敗，請再試一次');
    });
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove('on');
    mState = null;
  }

  /**
   * 開啟簽名消除對話框
   * opts: { blob, onDone(newBlob), onInfo(msg) }
   */
  function openErase(opts) {
    buildModal();
    modal.classList.add('on');
    var cv = modal.querySelector('#peCanvas');
    var stage = modal.querySelector('#peStage');
    var apply = modal.querySelector('#peApply');
    apply.disabled = true;
    apply.textContent = '消除並套用';
    modal.querySelector('#peInfo').textContent = '載入中…';

    mState = {
      blob: opts.blob, onDone: opts.onDone, onInfo: opts.onInfo,
      ready: false, box: null, drag: null, img: null,
      imgW: 0, imgH: 0, dispW: 0, dispH: 0
    };

    loadImage(opts.blob).then(function (img) {
      if (!mState) { try { img.release(); } catch (e) {} return; }
      mState.img = img;
      mState.imgW = img.width;
      mState.imgH = img.height;
      /* 顯示尺寸：配合視窗，最寬 900、最高 62vh */
      var maxW = Math.min(900, window.innerWidth - 60);
      var maxH = Math.max(220, Math.round(window.innerHeight * 0.62));
      var s = Math.min(1, maxW / img.width, maxH / img.height);
      var dw = Math.max(1, Math.round(img.width * s));
      var dh = Math.max(1, Math.round(img.height * s));
      cv.width = dw; cv.height = dh;
      cv.style.width = dw + 'px';
      cv.style.height = dh + 'px';
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, dw, dh);
      ctx.drawImage(img.el, 0, 0, dw, dh);
      mState.dispW = dw;
      mState.dispH = dh;
      mState.ready = true;
      modal.querySelector('#peInfo').textContent = '尚未框選';
      drawSel();
    }).catch(function () {
      modal.querySelector('#peInfo').textContent = '此檔案無法解碼';
    });
  }

  /* ============================================================
   * 對外 API
   * ============================================================ */

  global.PhotoEdit = {
    detectSignature: detectSignature,
    eraseRegion: eraseRegion,
    eraseSignature: eraseSignature,
    openErase: openErase,
    canvasFromImage: canvasFromImage,
    canvasToBlob: canvasToBlob
  };

})(typeof window !== 'undefined' ? window : this);
