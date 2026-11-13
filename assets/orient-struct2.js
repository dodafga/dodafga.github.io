/* 查驗單欄位結構辨識（第 9 項）
 *
 * 為什麼需要這個模組：
 *   原 orient.js 用「封閉空白格」找表格欄位，但實拍的查驗單是手持斜拍，
 *   表格線不是水平直線、格子不封閉，實測 cells 常為 0，結構辨識完全失效。
 *
 * 改用什麼：
 *   查驗單的固定結構是 —— 上段密集 5~6 條細規則線（工程名稱／主辦機關／
 *   專案管理／監造單位／施工廠商…），中段一個特別大的欄位（檢查項目），
 *   下段只有 2 條寬扁欄位（檢查人員、日期）。
 *   因此「上段規則線數 明顯多於 下段」就是正立；反過來就是上下顛倒。
 *   手寫筆跡不會形成貫穿全寬的規則線，所以這個訊號不受手寫干擾。
 *
 * 只覆寫「欄位結構」這條路徑：命中時採用，未命中就交回原 orient.js 的
 * 既有判斷，因此舊案例（乾淨表單、風景照）完全不受影響、零退步。
 */
(function (global) {
  'use strict';

  var EDGE = 700;          // 辨識用的縮圖長邊
  var PAPER_LUMA = 70;     // 紙張最低亮度
  var PAPER_MED = 0.72;    // 紙張亮度 = 中位數 × 此係數
  var PAPER_ROW = 0.30;    // 該列至少此比例寬度是紙，才算紙張列
  var INK_DELTA = 18;      // 墨跡門檻（比局部背景暗多少）
  var RULE_PCT = 95;       // 規則線門檻：列墨跡率的百分位
  var RULE_MIN_REL = 0.25; // 規則線門檻不得低於最大值的此比例
  var TOP_BAND = 0.34;     // 上段佔比
  var BOT_BAND = 0.34;     // 下段佔比
  var MIN_RULES = 4;       // 至少幾條規則線才算有效表格
  var TOP_ADV = 1.5;       // 上段需為下段的幾倍

  var _cv = null, _ctx = null;

  /* ---------- 灰階 ---------- */
  function toGray(imgEl, srcW, srcH) {
    var w0 = srcW || imgEl.width || imgEl.naturalWidth || 0;
    var h0 = srcH || imgEl.height || imgEl.naturalHeight || 0;
    if (!w0 || !h0) return null;
    var s = Math.min(1, EDGE / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * s));
    var h = Math.max(1, Math.round(h0 * s));
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
    var w = g.w, h = g.h;
    var out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        out[x * h + (h - 1 - y)] = g.gray[y * w + x];
      }
    }
    return { gray: out, w: h, h: w };
  }

  /* ---------- 局部背景（分離式 box blur） ---------- */
  function boxBlur2D(a, w, h, r) {
    if (r < 1) return a;
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    var x, y, sum;
    for (y = 0; y < h; y++) {
      sum = 0;
      for (x = 0; x <= r && x < w; x++) sum += a[y * w + x];
      for (x = 0; x < w; x++) {
        var add = x + r, sub = x - r - 1;
        if (add < w) sum += a[y * w + add];
        if (sub >= 0) sum -= a[y * w + sub];
        var n = Math.min(w - 1, x + r) - Math.max(0, x - r) + 1;
        tmp[y * w + x] = sum / n;
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (y = 0; y <= r && y < h; y++) sum += tmp[y * w + x];
      for (y = 0; y < h; y++) {
        var addY = y + r, subY = y - r - 1;
        if (addY < h) sum += tmp[addY * w + x];
        if (subY >= 0) sum -= tmp[subY * w + x];
        var n2 = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
        out[y * w + x] = sum / n2;
      }
    }
    return out;
  }

  function median(arr, n) {
    var a = Array.prototype.slice.call(arr, 0, n).sort(function (p, q) { return p - q; });
    if (!a.length) return 0;
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /* ---------- 量測：紙張範圍 + 橫規則線分布 ---------- */
  function measure(g) {
    var w = g.w, h = g.h;
    if (w < 60 || h < 60) return null;

    // 1. 紙張遮罩
    var sample = [], i;
    var stepS = Math.max(1, Math.floor(g.gray.length / 4000));
    for (i = 0; i < g.gray.length; i += stepS) sample.push(g.gray[i]);
    var med = median(sample, sample.length);
    var pThr = Math.max(PAPER_LUMA, med * PAPER_MED);
    var paper = new Uint8Array(w * h);
    for (i = 0; i < paper.length; i++) paper[i] = g.gray[i] >= pThr ? 1 : 0;

    // 2. 紙張垂直／水平範圍
    var py0 = -1, py1 = -1, pcnt = 0, x, y;
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

    // 3. 墨跡遮罩（只在紙張內，且比局部背景暗）
    var r = Math.max(4, Math.round(Math.min(w, h) * 0.05));
    var bg = boxBlur2D(g.gray, w, h, r);
    var ink = new Uint8Array(w * h);
    for (i = 0; i < ink.length; i++) {
      ink[i] = (paper[i] && (bg[i] - g.gray[i] > INK_DELTA)) ? 1 : 0;
    }

    // 4. 逐列墨跡率（正規化到紙張寬度）
    var sw = px1 - px0 + 1;
    var prof = new Float32Array(h);
    for (y = py0; y <= py1; y++) {
      var s2 = 0;
      for (x = px0; x <= px1; x++) if (ink[y * w + x]) s2++;
      prof[y] = s2 / sw;
    }
    // 輕微平滑（3 點）
    var sm = new Float32Array(h);
    for (y = 0; y < h; y++) {
      sm[y] = prof[y];
      if (y > 0) sm[y] = (prof[y - 1] + prof[y] + (y + 1 < h ? prof[y + 1] : prof[y])) / 3;
    }

    // 5. 規則線門檻 = 紙張範圍內的第 95 百分位
    var vals = [];
    for (y = py0; y <= py1; y++) vals.push(sm[y]);
    vals.sort(function (p, q) { return p - q; });
    var mx = vals[vals.length - 1] || 0;
    if (mx <= 0.03) return null;
    var q = vals[Math.min(vals.length - 1, Math.floor(vals.length * RULE_PCT / 100))] || 0;
    var thr = Math.max(q, mx * RULE_MIN_REL);

    // 6. 找規則線（連續高於門檻的區段中心）
    var lines = [];
    y = py0;
    while (y <= py1) {
      if (sm[y] >= thr) {
        var st = y;
        while (y <= py1 && sm[y] >= thr) y++;
        lines.push((st + y - 1) / 2);
      } else y++;
    }
    // 去除過密的（同一條線被切碎）
    var ded = [];
    for (i = 0; i < lines.length; i++) {
      if (!ded.length || lines[i] - ded[ded.length - 1] > 3) ded.push(lines[i]);
    }

    var span = py1 - py0;
    var te = py0 + span * TOP_BAND;
    var bs = py1 - span * BOT_BAND;
    var nt = 0, nb = 0;
    for (i = 0; i < ded.length; i++) {
      if (ded[i] <= te) nt++;
      if (ded[i] >= bs) nb++;
    }
    return { n: ded.length, top: nt, bot: nb, mx: mx, span: span, py0: py0, py1: py1 };
  }

  /* ---------- 主判斷 ---------- */
  function detect(imgEl, srcW, srcH) {
    var none = { hit: false, angle: 0, reason: 'struct2-none', top: 0, bot: 0, rules: 0 };
    var g = toGray(imgEl, srcW, srcH);
    if (!g) return none;
    if (g.w < 60 || g.h < 60) return none;

    var cands = [];
    var cur = g;
    for (var i = 0; i < 4; i++) {
      // 只接受「轉正後為橫向」的候選
      if (cur.w > cur.h * 1.05) {
        var m = measure(cur);
        if (m && m.n >= MIN_RULES) {
          m.base = i * 90;
          m.w = cur.w; m.h = cur.h;
          cands.push(m);
        }
      }
      cur = rotateGray(cur);
    }
    if (!cands.length) return none;

    // 取「上段規則線明顯多於下段」的候選
    for (var j = 0; j < cands.length; j++) {
      var c = cands[j];
      if (c.top >= 3 && c.top >= c.bot * TOP_ADV) {
        return {
          hit: true, angle: c.base, reason: 'field-struct2',
          top: c.top, bot: c.bot, rules: c.n, mx: c.mx,
          w: c.w, h: c.h
        };
      }
    }
    // 沒有正立候選 → 檢查是否有「上段極少、下段很多」的候選（= 顛倒）
    for (var k = 0; k < cands.length; k++) {
      var d = cands[k];
      if (d.bot >= 3 && d.bot >= d.top * TOP_ADV) {
        return {
          hit: true, angle: (d.base + 180) % 360, reason: 'field-struct2-flip',
          top: d.top, bot: d.bot, rules: d.n, mx: d.mx,
          w: d.w, h: d.h
        };
      }
    }
    return none;
  }

  /* ---------- 掛上覆寫 ---------- */
  function install() {
    var PO = global.PhotoOrient;
    if (!PO || PO.__struct2) return;
    var orig = PO.detect;
    PO.detect = function (imgEl, srcW, srcH) {
      var r = null;
      try { r = detect(imgEl, srcW, srcH); } catch (e) { r = null; }
      if (r && r.hit) {
        return {
          angle: r.angle, confidence: 0.92, reason: r.reason,
          axis: 1, glyphs: 0, fieldUsed: true, structOk: true,
          structScore: 1,
          topRules: r.top, botRules: r.bot, ruleCount: r.rules
        };
      }
      return orig.apply(this, arguments);
    };
    PO.__struct2 = true;
    PO.struct2Detect = detect;
  }

  global.PhotoOrientStruct2 = { detect: detect, install: install, EDGE: EDGE };
  install();
})(typeof window !== 'undefined' ? window : this);
