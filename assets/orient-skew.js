/*!
 * orient-skew.js — 細部傾斜角偵測（文字傾斜 ±45° 以內）
 *
 * 目的：現有的自動轉正只判斷 0／90／180／270 這四種方向。實務上手機拍照
 *       常常是「大致擺正、但歪了 3°～15°」，這種小角度傾斜用四方向判斷
 *       完全看不出來，照片就一直是歪的。
 *
 * 做法（標準 deskew，投影法）：
 *   1. 縮到長邊 <= edge 的灰階圖，用 Otsu 門檻取出「墨水像素」。
 *   2. 對候選角度 θ ∈ [-45°, +45°]，把每個墨水像素投影到「旋轉後的列座標」
 *      v = -x·sinθ + y·cosθ，統計列投影直方圖。
 *   3. 文字排列整齊時，列投影會出現明顯的「峰與谷」→ 變異數最大。
 *      因此取變異數最大的 θ 就是讓文字回到水平所需的角度。
 *   4. 先 1° 粗掃，再在最佳值 ±1° 內以 0.1° 細掃。
 *
 * 回傳 { ok, delta, confidence, ink, coarse, reason }
 *   delta = 需要「再」旋轉的角度（度，正值＝順時針），範圍約 ±45。
 *   判斷不出來時 ok:false、delta:0，呼叫端維持原本行為（不亂轉）。
 *
 * 零侵入：只提供 window.OrientSkew，不改任何既有檔案的行為。
 * 只有 /drive/ 載入本檔。
 */
(function (global) {
  'use strict';

  var EDGE = 640;        /* 分析用長邊（夠解析文字行，又夠快） */
  var RANGE = 45;        /* 搜尋範圍 ±45° */
  var STEP = 1;          /* 粗掃 1° */
  var FINE = 0.1;        /* 細掃 0.1° */
  var BINS = 256;        /* 投影直方圖的固定 bin 數（各角度可比） */
  var MIN_INK_FRAC = 0.004;  /* 墨水像素至少佔畫面 0.4% */
  var MAX_INK_FRAC = 0.45;   /* 超過 45% 就不是文字，是整片暗面 */
  var MIN_POINTS = 300;
  var MAX_POINTS = 30000;    /* 取樣上限，控制運算量 */
  var MIN_CONF = 1.06;       /* 最佳角度至少要贏過「遠處」1.06 倍才算可信 */
  var MIN_DELTA = 0.35;      /* 小於 0.35° 視為不需要轉 */

  var _cv = null, _ctx = null;

  function toGray(imgEl, edge) {
    var w0 = imgEl.naturalWidth || imgEl.width || 0;
    var h0 = imgEl.naturalHeight || imgEl.height || 0;
    if (!w0 || !h0) return null;
    var s = Math.min(1, (edge || EDGE) / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * s));
    var h = Math.max(1, Math.round(h0 * s));
    if (!_cv) {
      _cv = document.createElement('canvas');
      _ctx = _cv.getContext('2d', { willReadFrequently: true });
    }
    if (!_ctx) return null;
    if (_cv.width !== w || _cv.height !== h) { _cv.width = w; _cv.height = h; }
    var data;
    try {
      _ctx.clearRect(0, 0, w, h);
      _ctx.fillStyle = '#ffffff';
      _ctx.fillRect(0, 0, w, h);
      _ctx.drawImage(imgEl, 0, 0, w, h);
      data = _ctx.getImageData(0, 0, w, h).data;
    } catch (e) { return null; }
    var gray = new Uint8ClampedArray(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    return { gray: gray, w: w, h: h };
  }

  /* Otsu：白紙黑字最穩，不受整體曝光影響 */
  function otsu(gray) {
    var hist = new Float64Array(256), i, n = gray.length;
    for (i = 0; i < n; i++) hist[gray[i] | 0]++;
    var total = n, sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = -1, thr = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }

  /* 固定 bin 數的列投影變異數（除以平均值的平方 → 與尺度無關，各角度可比） */
  function profileScore(xs, ys, n, ang, vs, bins) {
    var rad = ang * Math.PI / 180;
    var sn = Math.sin(rad), cs = Math.cos(rad);
    var i, v, minV = 1e18, maxV = -1e18;
    for (i = 0; i < n; i++) {
      v = -xs[i] * sn + ys[i] * cs;
      vs[i] = v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    var span = maxV - minV;
    if (!(span > 1)) return 0;
    for (i = 0; i < BINS; i++) bins[i] = 0;
    var k = (BINS - 1) / span;
    for (i = 0; i < n; i++) {
      var b = ((vs[i] - minV) * k) | 0;
      if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
      bins[b]++;
    }
    var sum = 0;
    for (i = 0; i < BINS; i++) sum += bins[i];
    var mu = sum / BINS;
    if (!(mu > 0)) return 0;
    var acc = 0, d;
    for (i = 0; i < BINS; i++) { d = bins[i] - mu; acc += d * d; }
    return (acc / BINS) / (mu * mu);
  }

  /**
   * estimate(imgEl, edge) → { ok, delta, confidence, ink, coarse, reason }
   *   delta：需要「再」旋轉的角度（度）。正值＝順時針。
   */
  function estimate(imgEl, edge) {
    var none = { ok: false, delta: 0, confidence: 0, ink: 0, coarse: 0, reason: 'no-image' };
    if (!imgEl) return none;
    var g = toGray(imgEl, edge);
    if (!g) { none.reason = 'no-data'; return none; }
    var w = g.w, h = g.h, gray = g.gray;
    if (w < 40 || h < 40) { none.reason = 'too-small'; return none; }

    var thr = otsu(gray);
    var total = w * h;
    var xs = [], ys = [], i, x, y;
    for (y = 0; y < h; y++) {
      var row = y * w;
      for (x = 0; x < w; x++) {
        if (gray[row + x] <= thr) { xs.push(x); ys.push(y); }
      }
    }
    var n = xs.length;
    if (n < MIN_POINTS || n < total * MIN_INK_FRAC) {
      return { ok: false, delta: 0, confidence: 0, ink: n, coarse: 0, reason: 'too-little-ink' };
    }
    if (n > total * MAX_INK_FRAC) {
      return { ok: false, delta: 0, confidence: 0, ink: n, coarse: 0, reason: 'too-much-ink' };
    }

    /* 取樣上限：等距抽樣，保留空間分布 */
    if (n > MAX_POINTS) {
      var stride = n / MAX_POINTS, nx = [], ny = [], j = 0;
      for (i = 0; i < n && j < MAX_POINTS; i += stride, j++) {
        var ii = i | 0;
        nx.push(xs[ii]); ny.push(ys[ii]);
      }
      xs = nx; ys = ny; n = xs.length;
    }

    var vs = new Float32Array(n);
    var bins = new Float64Array(BINS);

    /* 粗掃 1° */
    var bestA = 0, bestS = -1, a, s;
    var coarseScores = [];
    for (a = -RANGE; a <= RANGE; a += STEP) {
      s = profileScore(xs, ys, n, a, vs, bins);
      coarseScores.push({ a: a, s: s });
      if (s > bestS) { bestS = s; bestA = a; }
    }

    /* 細掃 0.1°（在最佳值 ±1° 內） */
    var fineA = bestA, fineS = bestS;
    for (a = bestA - 1; a <= bestA + 1 + 1e-9; a += FINE) {
      s = profileScore(xs, ys, n, a, vs, bins);
      if (s > fineS) { fineS = s; fineA = a; }
    }

    /* 可信度：最佳角度要明顯贏過「離它 3° 以上」的最佳分數，
       否則代表這張圖沒有明顯的文字行方向（例如空白紙、純風景）。 */
    var far = 0;
    for (i = 0; i < coarseScores.length; i++) {
      if (Math.abs(coarseScores[i].a - fineA) >= 3 && coarseScores[i].s > far) far = coarseScores[i].s;
    }
    var conf = far > 0 ? fineS / far : 0;

    /* fineA 是「文字行本身」的傾斜角；要把它轉回水平，必須施加相反的角度。
       canvas 的 rotate() 正值＝順時針，所以 delta = -fineA。 */
    var delta = Math.round(-fineA * 10) / 10;
    if (Math.abs(delta) < MIN_DELTA) {
      return { ok: true, delta: 0, confidence: conf, ink: n, coarse: bestA, reason: 'skew-negligible' };
    }
    if (!(conf >= MIN_CONF)) {
      return { ok: false, delta: 0, confidence: conf, ink: n, coarse: bestA, reason: 'skew-weak' };
    }
    return { ok: true, delta: delta, confidence: conf, ink: n, coarse: bestA, reason: 'skew' };
  }

  global.OrientSkew = {
    estimate: estimate,
    EDGE: EDGE,
    RANGE: RANGE,
    _toGray: toGray,
    _otsu: otsu,
    _profileScore: profileScore
  };
})(typeof window !== 'undefined' ? window : this);
