/*!
 * orient-struct3.js   /drive/
 *
 *  Stage 1: 90/270 -> landscape (field ratio)
 *  Stage 2: 0/180  (inspection field vertical position)
 *
 *  PhotoOrient.detect override, ES5
 */
(function (global) {
  'use strict';

  var EDGE = 600, PAPER_LUMA = 80, PAPER_MED = 0.80, PAPER_ROW = 0.35;
  var INK_DELTA = 15, RULE_PCT = 95, RULE_MIN_REL = 0.25;
  var TOP_BAND = 0.40, BOT_BAND = 0.40, MIN_RULES = 3, FLIP_ADV = 1.35;
  var MIN_MARGIN = 0.6;
  var FIELD_MIN_AREA = 0.05, FIELD_DOM = 2.2, BELOW_GAP = 0.30;
  var BELOW_OVERLAP = 0.50, OTHERS_RATIO = 1.18;

  var _cv = null, _ctx = null;

  function toGray(imgEl, srcW, srcH) {
    var w0 = srcW || imgEl.width || imgEl.naturalWidth || 0;
    var h0 = srcH || imgEl.height || imgEl.naturalHeight || 0;
    if (!w0 || !h0) return null;
    var s = Math.min(1, EDGE / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    if (!_cv || !_ctx) {
      _cv = document.createElement('canvas');
      _ctx = _cv.getContext('2d', { willReadFrequently: true });
      if (!_ctx) return null;
    }
    if (_cv.width !== w || _cv.height !== h) { _cv.width = w; _cv.height = h; }
    var data;
    try {
      _ctx.clearRect(0, 0, w, h);
      _ctx.drawImage(imgEl, 0, 0, w, h);
      data = _ctx.getImageData(0, 0, w, h).data;
    } catch (e) { return null; }
    var gray = new Float32Array(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    return { gray: gray, w: w, h: h };
  }

  function rotateGray(g) {
    var w = g.w, h = g.h, out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out[x * h + (h - 1 - y)] = g.gray[y * w + x];
    return { gray: out, w: h, h: w };
  }

  function boxBlur2D(a, w, h, r) {
    if (r < 1) return a;
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, sum;
    for (y = 0; y < h; y++) {
      sum = 0;
      for (x = 0; x <= r && x < w; x++) sum += a[y * w + x];
      for (x = 0; x < w; x++) {
        var add = x + r, sub = x - r - 1;
        if (add < w) sum += a[y * w + add];
        if (sub >= 0) sum -= a[y * w + sub];
        tmp[y * w + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (y = 0; y <= r && y < h; y++) sum += tmp[y * w + x];
      for (y = 0; y < h; y++) {
        var a2 = y + r, s2 = y - r - 1;
        if (a2 < h) sum += tmp[a2 * w + x];
        if (s2 >= 0) sum -= tmp[s2 * w + x];
        out[y * w + x] = sum / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
      }
    }
    return out;
  }

  function median(a, n) {
    var arr = Array.prototype.slice.call(a, 0, n).sort(function (p, q) { return p - q; });
    if (!arr.length) return 0;
    var m = arr.length >> 1;
    return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
  }

  function detectFields(ink, w, h, px0, px1, py0, py1) {
    var bw = px1 - px0 + 1, bh = py1 - py0 + 1;
    if (bw < 40 || bh < 40) return null;
    var rowInk = new Float32Array(h), y, x, i;
    for (y = py0; y <= py1; y++) {
      var c = 0;
      for (x = px0; x <= px1; x++) if (ink[y * w + x]) c++;
      rowInk[y] = c / bw;
    }
    var bands = [], cur = null;
    for (y = py0; y <= py1; y++) {
      if (rowInk[y] <= 0.012) { if (!cur) cur = { y0: y, y1: y }; else cur.y1 = y; }
      else if (cur) { if (cur.y1 - cur.y0 >= 2) bands.push(cur); cur = null; }
    }
    if (cur && cur.y1 - cur.y0 >= 2) bands.push(cur);

    var segs = [], prev = py0 - 1;
    for (i = 0; i < bands.length; i++) {
      if (bands[i].y0 - prev > 6) segs.push({ y0: prev + 1, y1: bands[i].y0 - 1 });
      prev = bands[i].y1;
    }
    if (py1 - prev > 6) segs.push({ y0: prev + 1, y1: py1 });
    if (segs.length < 2) return null;

    var boxes = [];
    for (i = 0; i < segs.length; i++) {
      var sy0 = segs[i].y0, sy1 = segs[i].y1, rows = sy1 - sy0 + 1;
      if (rows < 6) continue;
      var lx = -1, rx = -1, cnt = 0;
      for (y = sy0; y <= sy1; y++) {
        for (x = px0; x <= px1; x++) {
          if (ink[y * w + x]) { if (lx < 0 || x < lx) lx = x; if (x > rx) rx = x; cnt++; }
        }
      }
      if (lx < 0 || cnt < 30) continue;
      var fw = rx - lx + 1;
      if (fw < bw * 0.25) continue;
      boxes.push({ y0: sy0, y1: sy1, x0: lx, x1: rx, w: fw, h: rows,
        area: (fw * rows) / (bw * bh), ratio: fw / rows });
    }
    if (boxes.length < 2) return null;

    var bi = 0;
    for (i = 1; i < boxes.length; i++) if (boxes[i].area > boxes[bi].area) bi = i;
    var big = boxes[bi], others = [];
    for (i = 0; i < boxes.length; i++) if (i !== bi) others.push(boxes[i]);
    if (!others.length) return null;

    var ratios = others.map(function (b) { return b.ratio; }).sort(function (p, q) { return p - q; });
    var othersMed = ratios[ratios.length >> 1] || 0;
    var areas = others.map(function (b) { return b.area; }).sort(function (p, q) { return p - q; });
    var othersAreaMed = areas[areas.length >> 1] || 0.0001;
    var dominance = big.area / Math.max(0.0001, othersAreaMed);

    var below = null, bestGap = 1e9;
    for (i = 0; i < boxes.length; i++) {
      var b2 = boxes[i];
      if (b2 === big) continue;
      var gap = b2.y0 - big.y1;
      if (gap < 0 || gap > bh * BELOW_GAP) continue;
      var ov = Math.min(b2.x1, big.x1) - Math.max(b2.x0, big.x0) + 1;
      if (ov < big.w * BELOW_OVERLAP) continue;
      if (b2.h > b2.w * 0.9) continue;
      if (gap < bestGap) { bestGap = gap; below = b2; }
    }
    return { boxes: boxes, big: big, below: below, othersMedRatio: othersMed, dominance: dominance };
  }

  function measure(g) {
    var w = g.w, h = g.h, i, x, y;
    if (w < 60 || h < 60) return null;
    var sample = [], stepS = Math.max(1, Math.floor(g.gray.length / 4000));
    for (i = 0; i < g.gray.length; i += stepS) sample.push(g.gray[i]);
    var med = median(sample, sample.length);
    var pThr = Math.max(PAPER_LUMA, med * PAPER_MED);
    var paper = new Uint8Array(w * h);
    for (i = 0; i < paper.length; i++) paper[i] = g.gray[i] >= pThr ? 1 : 0;

    var py0 = -1, py1 = -1, pcnt = 0;
    for (y = 0; y < h; y++) {
      var c = 0;
      for (x = 0; x < w; x++) if (paper[y * w + x]) c++;
      if (c >= w * PAPER_ROW) { if (py0 < 0) py0 = y; py1 = y; pcnt++; }
    }
    if (py0 < 0 || pcnt < h * 0.25) { py0 = 0; py1 = h - 1; }
    if (py1 - py0 < h * 0.20) return null;

    var px0 = -1, px1 = -1;
    for (x = 0; x < w; x++) {
      var c2 = 0;
      for (y = 0; y < h; y++) if (paper[y * w + x]) c2++;
      if (c2 >= h * 0.25) { if (px0 < 0) px0 = x; px1 = x; }
    }
    if (px0 < 0) { px0 = 0; px1 = w - 1; }
    if (px1 - px0 < w * 0.20) return null;

    var r = Math.max(4, Math.round(Math.min(w, h) * 0.05));
    var bg = boxBlur2D(g.gray, w, h, r);
    var ink = new Uint8Array(w * h);
    for (i = 0; i < ink.length; i++) ink[i] = (paper[i] && (bg[i] - g.gray[i] > INK_DELTA)) ? 1 : 0;

    var sw = px1 - px0 + 1, prof = new Float32Array(h);
    for (y = py0; y <= py1; y++) {
      var s2 = 0;
      for (x = px0; x <= px1; x++) if (ink[y * w + x]) s2++;
      prof[y] = s2 / sw;
    }
    var sm = new Float32Array(h);
    for (y = 0; y < h; y++) {
      sm[y] = prof[y];
      if (y > 0) sm[y] = (prof[y - 1] + prof[y] + (y + 1 < h ? prof[y + 1] : prof[y])) / 3;
    }

    var vals = [];
    for (y = py0; y <= py1; y++) vals.push(sm[y]);
    vals.sort(function (p, q) { return p - q; });
    var mx = vals[vals.length - 1] || 0;
    if (mx <= 0.03) return null;
    var qv = vals[Math.min(vals.length - 1, Math.floor(vals.length * RULE_PCT / 100))] || 0;
    var thr = Math.max(qv, mx * RULE_MIN_REL);

    var lines = [];
    y = py0;
    while (y <= py1) {
      if (sm[y] >= thr) {
        var st = y;
        while (y <= py1 && sm[y] >= thr) y++;
        lines.push((st + y - 1) / 2);
      } else y++;
    }
    var ded = [];
    for (i = 0; i < lines.length; i++) if (!ded.length || lines[i] - ded[ded.length - 1] > 3) ded.push(lines[i]);

    var span = py1 - py0, te = py0 + span * TOP_BAND, bs = py1 - span * BOT_BAND;
    var nt = 0, nb = 0;
    for (i = 0; i < ded.length; i++) {
      if (ded[i] <= te) nt++;
      if (ded[i] >= bs) nb++;
    }
    return { n: ded.length, top: nt, bot: nb, w: w, h: h,
      fields: detectFields(ink, w, h, px0, px1, py0, py1) };
  }

  function landscapeScore(m) {
    if (!m) return -99;
    var s = 0;
    if (m.fields) {
      if (m.fields.dominance >= FIELD_DOM && m.fields.big.area >= FIELD_MIN_AREA) s += 2;
      if (m.fields.below) s += 2;
      if (m.fields.othersMedRatio >= OTHERS_RATIO) s += 1;
    }
    if (m.n >= MIN_RULES) s += 1;
    if (m.top >= 3 && m.top >= m.bot * FLIP_ADV) s += 1;
    if (m.bot >= 3 && m.bot >= m.top * FLIP_ADV) s -= 1;
    return s;
  }

  function uprightScore(m) {
    var sField = 0, sRule = 0, mid = -1;

    if (m.fields && m.fields.big) {
      mid = (m.fields.big.y0 + m.fields.big.y1) / 2 / m.h;
      if (mid >= 0.50) sField = 1;
      else if (mid <= 0.42) sField = -1;
    }

    if (m.top >= 3 && m.top >= m.bot * FLIP_ADV) sRule = 1;
    else if (m.bot >= 3 && m.bot >= m.top * FLIP_ADV) sRule = -1;

    m._mid = mid; m._sField = sField; m._sRule = sRule;

    if (sField !== 0) return sField * 2;
    if (sRule !== 0) return sRule * 2;
    return 0;
  }

  function detect(imgEl, srcW, srcH) {
    var none = { hit: false, angle: 0, reason: 'struct3-none' };
    var g = toGray(imgEl, srcW, srcH);
    if (!g || g.w < 60 || g.h < 60) return none;

    var cands = [], cur = g;
    for (var i = 0; i < 4; i++) {
      if (cur.w > cur.h * 1.02) {
        var m = measure(cur);
        if (m) { m.base = i * 90; cands.push(m); }
      }
      cur = rotateGray(cur);
    }
    if (cands.length < 2) return none;

    var best = null, bestS = -99, secondS = -99;
    for (var j = 0; j < cands.length; j++) {
      var sc = landscapeScore(cands[j]);
      if (sc > bestS) { secondS = bestS; bestS = sc; best = cands[j]; }
      else if (sc > secondS) secondS = sc;
    }
    if (!best || bestS < 3) return none;
    if (bestS - secondS < MIN_MARGIN) return none;

    var up = uprightScore(best), angle = best.base, reason = 'struct3-landscape';
    if (up <= -2) { angle = (best.base + 180) % 360; reason = 'struct3-flip180'; }
    else if (up === 0 && best.bot >= 3 && best.bot > best.top) {
      angle = (best.base + 180) % 360; reason = 'struct3-flip180-soft';
    }

    return {
      hit: true, angle: angle, reason: reason,
      stage1Angle: best.base, stage1Score: bestS,
      stage1Margin: +(bestS - secondS).toFixed(2), stage2Score: up,
      top: best.top, bot: best.bot, rules: best.n,
      fieldDominance: best.fields ? +best.fields.dominance.toFixed(2) : 0,
      fieldBelow: !!(best.fields && best.fields.below),
      othersMedRatio: best.fields ? +best.fields.othersMedRatio.toFixed(2) : 0,
      w: best.w, h: best.h
    };
  }

  function install() {
    var PO = global.PhotoOrient;
    if (!PO || PO.__struct3) return;
    var prev = PO.detect;
    PO.detect = function (imgEl, srcW, srcH) {
      var r = null;
      try { r = detect(imgEl, srcW, srcH); } catch (e) { r = null; }
      if (r && r.hit) {
        return {
          angle: r.angle, confidence: 0.9, reason: r.reason, axis: 1, glyphs: 0,
          fieldUsed: true, structOk: true, structScore: r.stage1Score,
          topRules: r.top, botRules: r.bot, ruleCount: r.rules,
          stage1Angle: r.stage1Angle, stage1Margin: r.stage1Margin,
          stage2Score: r.stage2Score
        };
      }
      return prev.apply(this, arguments);
    };
    PO.__struct3 = true;
    PO.struct3Detect = detect;
  }

  global.PhotoOrientStruct3 = { detect: detect, install: install, EDGE: EDGE, _measure: measure };
  install();
})(typeof window !== 'undefined' ? window : this);
