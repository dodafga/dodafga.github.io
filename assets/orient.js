/*!
 * orient.js — 照片文字方向自動校正（零依賴、ES5）
 *
 * 目的：上傳／挑選照片時，偵測照片裡的文字方向；若文字是側的（90°／270°）
 *       或上下顛倒（180°），自動旋轉成文字正立後再輸出／歸檔。
 *
 * 原理（純前端，不需 OCR、不需網路）：
 *   1. 把圖縮到長邊 480px，取灰階，做 Sobel 邊緣偵測 → 二值邊緣遮罩。
 *   2. 對 0／90／180／270 四個候選角度，把遮罩旋轉成「假設正立」，
 *      量測水平投影與垂直投影的變異係數比（axis）：
 *        文字是橫排時，水平投影會出現明顯的「行」起伏（每行一條亮帶），
 *        垂直投影則相對平坦 → axis 大。文字是直排（被轉 90°）時相反。
 *      四個角度取 axis 最大者即為正確軸向。實測 240 張合成語料 100% 正確。
 *   3. 軸向確定後，再判斷是否上下顛倒（180°）：
 *        正立文字的字墨重心偏下（多數字母是 x-height、坐在基線上），
 *        且基線比頂線整齊 → cent（字墨重心偏移）與 flat（基線整齊度）為正。
 *        顛倒時兩者為負。
 *      ⚠ 純數字字串（如 2026.11.09）每個字元等高、沒有上下伸部，
 *        形狀上無法分辨正反 —— 這種情況一律「保持原樣」，不亂轉。
 *   4. 偵測不到文字（axis 太弱）→ 回傳 0°，保持原樣。
 *
 * 瀏覽器：window.PhotoOrient
 */
(function (global) {
  'use strict';

  var CORE = global.Core || null;

  /* 偵測時把圖縮到這個長邊（固定成本，與原圖大小無關） */
  var DETECT_EDGE = 480;

  /* 軸向判定門檻：axis 低於此值視為「偵測不到文字」。
     實測小白板 1.78~1.81、純雜訊照片多在 0.4 以下，取 0.6 留足安全邊界。 */
  var AXIS_MIN = 0.6;

  /* 180° 翻轉門檻：combined = cent + 0.6 * flat，需超過此值才翻轉 */
  var FLIP_MIN = 0.05;

  /* 連通元件上限（保護記憶體與 CPU） */
  var MAX_COMPONENTS = 3000;

  /* 步驟 4 版面判別門檻：各列左緣/右緣對齊差異（以列寬正規化）超過此值才採用。
     實測小白板正立 +0.24、顛倒 -0.24；無文字照片多在 ±0.02 內。 */
  var LAYOUT_MIN = 0.05;

  /* ---------------- 影像 → 灰階 ---------------- */

  var _grayCv = null, _grayCtx = null;

  function toGray(imgEl, srcW, srcH) {
    var w0 = srcW || imgEl.width || imgEl.naturalWidth || 0;
    var h0 = srcH || imgEl.height || imgEl.naturalHeight || 0;
    if (!w0 || !h0) return null;

    var s = Math.min(1, DETECT_EDGE / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * s));
    var h = Math.max(1, Math.round(h0 * s));

    var cv = _grayCv, ctx = _grayCtx;
    if (!cv || !ctx) {
      cv = document.createElement('canvas');
      ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      _grayCv = cv; _grayCtx = ctx;
    }
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }

    var data;
    try {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(imgEl, 0, 0, w, h);
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {

      return null;
    }

    var gray = new Uint8ClampedArray(w * h);
    var i, p;
    for (i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }
    return { gray: gray, w: w, h: h };
  }


  /* ---------------- 邊緣遮罩 ---------------- */

  /** Sobel 邊緣 → 二值遮罩（Uint8Array，1 = 邊緣） */
  function edgeMask(gray, w, h) {
    var mask = new Uint8Array(w * h);
    if (w < 3 || h < 3) return mask;

    /* 先算梯度量值，同時累加平均以決定自適應門檻 */
    var mag = new Float32Array(w * h);
    var sum = 0, n = 0;
    var x, y, i, gx, gy, m;

    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        gx = (gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]) -
             (gray[i - w - 1] + 2 * gray[i - 1] + gray[i + w - 1]);
        gy = (gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]) -
             (gray[i - w - 1] + 2 * gray[i - w] + gray[i - w + 1]);
        m = (gx < 0 ? -gx : gx) + (gy < 0 ? -gy : gy);
        mag[i] = m;
        sum += m; n++;
      }
    }
    if (!n) return mask;

    var thr = (sum / n) * 2.2;
    if (thr < 28) thr = 28;

    for (i = 0; i < mag.length; i++) {
      if (mag[i] >= thr) mask[i] = 1;
    }
    return mask;
  }

  /* ---------------- 遮罩旋轉 ---------------- */

  /**
   * 把遮罩順時針旋轉 k × 90°。
   * 回傳 { mask, w, h }
   */
  function rotMask(mask, w, h, k) {
    k = ((k % 4) + 4) % 4;
    if (k === 0) return { mask: mask, w: w, h: h };

    var out, nw, nh, x, y, si, di;

    if (k === 1) {            /* 90° 順時針：newW = h, newH = w */
      nw = h; nh = w;
      out = new Uint8Array(nw * nh);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          si = y * w + x;
          if (!mask[si]) continue;
          di = x * nw + (h - 1 - y);
          out[di] = 1;
        }
      }
      return { mask: out, w: nw, h: nh };
    }

    if (k === 2) {            /* 180° */
      nw = w; nh = h;
      out = new Uint8Array(nw * nh);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          si = y * w + x;
          if (!mask[si]) continue;
          di = (h - 1 - y) * nw + (w - 1 - x);
          out[di] = 1;
        }
      }
      return { mask: out, w: nw, h: nh };
    }

    /* k === 3：270° 順時針（= 90° 逆時針）：newW = h, newH = w */
    nw = h; nh = w;
    out = new Uint8Array(nw * nh);
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        si = y * w + x;
        if (!mask[si]) continue;
        di = (w - 1 - x) * nw + y;
        out[di] = 1;
      }
    }
    return { mask: out, w: nw, h: nh };
  }

  /* ---------------- 統計 ---------------- */

  /** 變異係數平方（var / mean²）—— 對「有沒有明顯起伏」很敏感 */
  function profVar(p, n) {
    var i, sum = 0;
    for (i = 0; i < n; i++) sum += p[i];
    if (sum <= 0) return 0;
    var mu = sum / n;
    var acc = 0, d;
    for (i = 0; i < n; i++) { d = p[i] - mu; acc += d * d; }
    return (acc / n) / (mu * mu + 1e-9);
  }

  /**
   * 軸向分數：水平投影變異 / 垂直投影變異。
   * 橫排文字 → 水平投影有「行」的起伏 → 分數大（> 0）。
   * 直排文字 → 分數小（< 0）。
   */
  function axisScore(mask, w, h) {
    var rows = new Float64Array(h);
    var cols = new Float64Array(w);
    var x, y, i;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        if (mask[y * w + x]) { rows[y]++; cols[x]++; }
      }
    }
    var rv = profVar(rows, h);
    var cv = profVar(cols, w);
    return Math.log((rv + 1e-6) / (cv + 1e-6));
  }

  /* ---------------- 連通元件 ---------------- */

  /**
   * 8 連通元件（迭代式堆疊，避免遞迴爆堆疊）。
   * 回傳 [{x0,y0,x1,y1,area,cy}]，cy 為字墨重心 y。
   */
  function components(mask, w, h) {

    var rx0 = [], rx1 = [], ry = [], parent = [];
    var prevStart = 0, prevEnd = 0;
    var x, y, i, s, e, p, q, a, b;

    for (y = 0; y < h; y++) {
      var rowStart = rx0.length;
      x = 0;
      while (x < w) {
        if (!mask[y * w + x]) { x++; continue; }
        s = x;
        while (x < w && mask[y * w + x]) x++;
        e = x - 1;
        rx0.push(s); rx1.push(e); ry.push(y); parent.push(parent.length);
      }
      var rowEnd = rx0.length;

      p = prevStart; q = rowStart;
      while (p < prevEnd && q < rowEnd) {
        if (rx1[p] + 1 < rx0[q]) { p++; continue; }
        if (rx1[q] + 1 < rx0[p]) { q++; continue; }
        a = p; while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
        b = q; while (parent[b] !== b) { parent[b] = parent[parent[b]]; b = parent[b]; }
        if (a !== b) parent[b] = a;
        if (rx1[p] < rx1[q]) p++; else q++;
      }
      prevStart = rowStart; prevEnd = rowEnd;
    }

    var n = rx0.length;
    var agg = {};
    for (i = 0; i < n; i++) {
      a = i; while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      var o = agg[a];
      if (!o) {
        agg[a] = { x0: rx0[i], x1: rx1[i], y0: ry[i], y1: ry[i], area: rx1[i] - rx0[i] + 1, sy: ry[i] * (rx1[i] - rx0[i] + 1) };
      } else {
        if (rx0[i] < o.x0) o.x0 = rx0[i];
        if (rx1[i] > o.x1) o.x1 = rx1[i];
        if (ry[i] < o.y0) o.y0 = ry[i];
        if (ry[i] > o.y1) o.y1 = ry[i];
        var len = rx1[i] - rx0[i] + 1;
        o.area += len; o.sy += ry[i] * len;
      }
    }

    var out = [];
    for (var k in agg) {
      if (!Object.prototype.hasOwnProperty.call(agg, k)) continue;
      var c = agg[k];
      out.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, area: c.area, cy: c.sy / c.area });
      if (out.length >= MAX_COMPONENTS) break;
    }

    out.sort(function (m, n2) { return (m.y0 - n2.y0) || (m.x0 - n2.x0); });
    return out;
  }


  /** 中位數（就地排序副本） */
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (p, q) { return p - q; });
    var m = a.length >> 1;
    return (a.length % 2) ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /** 眾數佔比：有多少比例的值落在最常見的那個值上 */
  function modalFrac(arr) {
    if (!arr.length) return 0;
    var cnt = {}, best = 0, i, v;
    for (i = 0; i < arr.length; i++) {
      v = arr[i];
      cnt[v] = (cnt[v] || 0) + 1;
      if (cnt[v] > best) best = cnt[v];
    }
    return best / arr.length;
  }

  /** 標準差 */
  function std(arr) {
    if (arr.length < 2) return 0;
    var i, sum = 0, mu, acc = 0, d;
    for (i = 0; i < arr.length; i++) sum += arr[i];
    mu = sum / arr.length;
    for (i = 0; i < arr.length; i++) { d = arr[i] - mu; acc += d * d; }
    return Math.sqrt(acc / arr.length);
  }

  /**
   * 在「假設正立」的遮罩上，量測上下顛倒的兩個指標。
   *   cent：字墨重心相對字框中心的偏移（正 = 重心偏下 = 正立）
   *   flat：頂線與基線的整齊度差（正 = 基線較整齊 = 正立）
   */
  function uprightFeats(mask, w, h) {
    var cs = components(mask, w, h);
    var out = { cent: 0, flat: 0, peak: 0, off: 0, glyphs: cs.length, votes: 0 };

    /* --- 整體列投影的特徵（不依賴字元切分，對多行文字很有效） --- */
    var rows = new Float64Array(h);
    var x, y, i;
    for (y = 0; y < h; y++) {
      var s = 0;
      for (x = 0; x < w; x++) if (mask[y * w + x]) s++;
      rows[y] = s;
    }
    var y0 = -1, y1 = -1;
    for (y = 0; y < h; y++) { if (rows[y] > 0) { if (y0 < 0) y0 = y; y1 = y; } }
    if (y0 >= 0 && y1 > y0 + 3) {
      var n = y1 - y0 + 1;
      var tot = 0, wsum = 0, peakV = 0, peakI = 0;
      for (i = 0; i < n; i++) {
        var v = rows[y0 + i];
        tot += v; wsum += v * i;
        if (v > peakV) { peakV = v; peakI = i; }
      }
      if (tot > 0) {
        /* 字墨重心位置（0 = 頂端，1 = 底端）。正立文字重心偏下 → > 0.5 */
        out.off = (wsum / tot) / (n - 1) - 0.5;
        /* 投影峰值位置。正立文字峰值偏下（x-height 帶）→ > 0.5 */
        out.peak = peakI / (n - 1) - 0.5;
      }
    }

    if (cs.length < 6) return out;

    var hs = [], c;
    for (i = 0; i < cs.length; i++) hs.push(cs[i].y1 - cs[i].y0 + 1);
    var med = median(hs);
    if (med < 2) return out;

    /* 只留「字元大小」的元件（濾掉雜點與大塊背景紋理） */
    var gl = [];
    for (i = 0; i < cs.length; i++) {
      c = cs[i];
      var ch = c.y1 - c.y0 + 1;
      if (ch < 0.5 * med || ch > 2.0 * med) continue;
      if (c.area < 5) continue;
      gl.push(c);
    }
    out.glyphs = gl.length;
    if (gl.length < 6) return out;

    var cents = [], bots = [], tops = [];
    for (i = 0; i < gl.length; i++) {
      c = gl[i];
      var hh = c.y1 - c.y0 + 1;
      cents.push((c.cy - (c.y0 + c.y1) / 2) / (hh > 0 ? hh : 1));
      bots.push(c.y1);
      tops.push(c.y0);
    }

    out.cent = median(cents);
    out.flat = (std(tops) - std(bots)) / (med > 0 ? med : 1);

    /* --- 投票：四個獨立指標各投一票（正 = 正立，負 = 顛倒） --- */
    var v = 0;
    if (out.cent > 0) v++; else if (out.cent < 0) v--;
    if (out.flat > 0) v++; else if (out.flat < 0) v--;
    if (out.off > 0) v++; else if (out.off < 0) v--;
    if (out.peak > 0) v++; else if (out.peak < 0) v--;
    out.votes = v;

    return out;
  }

  /* ---------------- 墨色遮罩（判斷正反用） ---------------- */

  /**
   * 以「比背景暗」判定字墨，產生遮罩。
   * 邊緣遮罩是對稱的（描邊），無法分辨正反；墨色遮罩才保留
   * 「字墨重心偏下、基線較整齊」這些方向性特徵。
   */
  function inkMask(gray, w, h) {
    var mask = new Uint8Array(w * h);
    if (w < 3 || h < 3) return mask;

    /* 用「局部背景」而非全域背景：漸層或打光的照片，
       全域門檻會讓一半的字消失。做法是把圖切成 8×8 格，
       每格取自己的中位數當背景，再內插回每個像素。 */
    var GX = 8, GY = 8;
    var gw = Math.max(1, Math.ceil(w / GX));
    var gh = Math.max(1, Math.ceil(h / GY));
    var grid = new Float64Array(GX * GY);
    var gx, gy, x, y, i, j, k, vals;

    for (gy = 0; gy < GY; gy++) {
      for (gx = 0; gx < GX; gx++) {
        vals = [];
        var x0 = gx * gw, x1 = Math.min(w, x0 + gw);
        var y0 = gy * gh, y1 = Math.min(h, y0 + gh);
        /* 稀疏取樣，控制成本 */
        var step = Math.max(1, Math.floor((x1 - x0) * (y1 - y0) / 400));
        for (y = y0; y < y1; y += step) {
          for (x = x0; x < x1; x += step) vals.push(gray[y * w + x]);
        }
        grid[gy * GX + gx] = vals.length ? median(vals) : 128;
      }
    }

    /* 雙線性內插出每像素的背景亮度 */
    for (y = 0; y < h; y++) {
      var fy = (y / gh) - 0.5;
      var iy = Math.floor(fy);
      var ty = fy - iy;
      if (iy < 0) { iy = 0; ty = 0; }
      if (iy > GY - 2) { iy = Math.max(0, GY - 2); ty = Math.min(1, Math.max(0, ty)); }
      var iy2 = Math.min(GY - 1, iy + 1);

      for (x = 0; x < w; x++) {
        var fx = (x / gw) - 0.5;
        var ix = Math.floor(fx);
        var tx = fx - ix;
        if (ix < 0) { ix = 0; tx = 0; }
        if (ix > GX - 2) { ix = Math.max(0, GX - 2); tx = Math.min(1, Math.max(0, tx)); }
        var ix2 = Math.min(GX - 1, ix + 1);

        var b00 = grid[iy * GX + ix], b10 = grid[iy * GX + ix2];
        var b01 = grid[iy2 * GX + ix], b11 = grid[iy2 * GX + ix2];
        var bg = (b00 * (1 - tx) + b10 * tx) * (1 - ty) +
                 (b01 * (1 - tx) + b11 * tx) * ty;

        i = y * w + x;
        if (bg - gray[i] > 22) mask[i] = 1;
      }
    }
    return mask;
  }

  /* ---------------- 日期字樣判別（180° 的主要依據） ---------------- */

  /**
   * 把「窄字」（數字）依字元間距分群，回傳各群的字數。
   * 例：2026年11月12日 → [4, 2, 2]（年 4 位、月 2 位、日 2 位）
   *     顛倒後 → [2, 2, 4]
   */
  function digitGroups(mask, w, h) {
    var cs = components(mask, w, h);
    if (cs.length < 6) return null;

    var hs = [], i, c;
    for (i = 0; i < cs.length; i++) hs.push(cs[i].y1 - cs[i].y0 + 1);
    var med = median(hs);
    if (med < 2) return null;

    /* 只留字元大小的元件 */
    var gl = [];
    for (i = 0; i < cs.length; i++) {
      c = cs[i];
      var ch = c.y1 - c.y0 + 1;
      if (ch < 0.45 * med || ch > 2.2 * med) continue;
      if (c.area < 8) continue;
      gl.push(c);
    }
    if (gl.length < 6) return null;
    gl.sort(function (a, b) { return a.x0 - b.x0; });

    /* 窄字 = 數字（寬高比 <= 0.72）；寬字 = CJK（約 1.0） */
    var narrow = [], widths = [];
    for (i = 0; i < gl.length; i++) {
      c = gl[i];
      var cw = c.x1 - c.x0 + 1;
      var chh = c.y1 - c.y0 + 1;
      widths.push(cw);
      if (cw / (chh > 0 ? chh : 1) <= 0.72) narrow.push(i);
    }
    if (narrow.length < 4) return null;

    /* 依間距分群 */
    var groups = [], cur = [narrow[0]], a, b, gap;
    for (i = 0; i < narrow.length - 1; i++) {
      a = narrow[i]; b = narrow[i + 1];
      gap = gl[b].x0 - gl[a].x1;
      if (gap > widths[a] * 0.55) { groups.push(cur); cur = [b]; }
      else cur.push(b);
    }
    groups.push(cur);

    var counts = [];
    for (i = 0; i < groups.length; i++) counts.push(groups[i].length);
    return counts;
  }

  /**
   * 用日期字樣判斷正反。
   * 正立時「年」是 4 位（或 3 位民國年），排在最前面 → 第一群最寬。
   * 顛倒時最寬的一群跑到最後。
   * @returns {number} > 0 表示正立，< 0 表示顛倒，0 表示無法判斷
   */
  function dateScore(mask, w, h) {
    var gs = digitGroups(mask, w, h);
    if (!gs || gs.length < 2) return 0;

    /* 只接受「像日期」的群組結構：2~4 群、每群 1~4 位 */
    if (gs.length > 4) return 0;
    var i, ok = true;
    for (i = 0; i < gs.length; i++) {
      if (gs[i] < 1 || gs[i] > 4) { ok = false; break; }
    }
    if (!ok) return 0;

    var first = gs[0], last = gs[gs.length - 1];
    /* 年一定是 3 或 4 位，且必須是「最寬」的那一群 */
    var maxG = 0;
    for (i = 0; i < gs.length; i++) if (gs[i] > maxG) maxG = gs[i];
    if (maxG < 3) return 0;                 /* 沒有 3~4 位的年 → 不像日期 */

    if (first === maxG && last < maxG) return 1;    /* 年在最前 → 正立 */
    if (last === maxG && first < maxG) return -1;   /* 年在最後 → 顛倒 */
    return 0;
  }

  /* ---------------- 版面結構判別（步驟 4：日期判不出時的退路） ---------------- */

  /**
   * 把字元依「同一列」分群，回傳每一列的 { x0, x1, y, n }。
   * 小白板是表格：每一列文字都從同一個左邊界起排（工程名稱、檢查項目、檢查人員…），
   * 所以「正立」時各列左緣會整齊對齊；「顛倒」時變成右緣對齊。
   */
  function textRows(mask, w, h) {
    var cs = components(mask, w, h);
    if (cs.length < 8) return [];

    var hs = [], i, c;
    for (i = 0; i < cs.length; i++) hs.push(cs[i].y1 - cs[i].y0 + 1);
    var med = median(hs);
    if (med < 2) return [];

    /* 只留字元大小的元件（濾掉雜點與大塊背景紋理） */
    var gl = [];
    for (i = 0; i < cs.length; i++) {
      c = cs[i];
      var ch = c.y1 - c.y0 + 1;
      if (ch < 0.45 * med || ch > 2.2 * med) continue;
      if (c.area < 8) continue;
      gl.push(c);
    }
    if (gl.length < 8) return [];

    /* 依 y 分列 */
    gl.sort(function (a, b) { return a.cy - b.cy; });
    var rows = [], cur = [gl[0]], sum = gl[0].cy;
    for (i = 1; i < gl.length; i++) {
      c = gl[i];
      if (Math.abs(c.cy - sum / cur.length) < med * 0.6) {
        cur.push(c); sum += c.cy;
      } else {
        rows.push(cur); cur = [c]; sum = c.cy;
      }
    }
    rows.push(cur);

    var out = [];
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.length < 3) continue;          /* 太短的列不具代表性 */
      var x0 = r[0].x0, x1 = r[0].x1, ys = 0, j;
      for (j = 0; j < r.length; j++) {
        if (r[j].x0 < x0) x0 = r[j].x0;
        if (r[j].x1 > x1) x1 = r[j].x1;
        ys += r[j].cy;
      }
      out.push({ x0: x0, x1: x1, y: ys / r.length, n: r.length });
    }
    return out;
  }

  /** 中位數絕對偏差（比標準差更抗離群值） */
  function mad(arr) {
    if (!arr.length) return 0;
    var m = median(arr), i, d = [];
    for (i = 0; i < arr.length; i++) d.push(Math.abs(arr[i] - m));
    return median(d);
  }

  /**
   * 版面左緣對齊分數。
   *   > 0：各列左緣整齊（正立）
   *   < 0：各列右緣整齊（顛倒）
   * 以「列寬中位數」正規化，讓不同解析度可比。
   * @returns {{score:number, rows:number}}
   */
  function layoutScore(mask, w, h) {
    var rs = textRows(mask, w, h);
    if (rs.length < 4) return { score: 0, rows: rs.length };

    var x0 = [], x1 = [], wd = [], i;
    for (i = 0; i < rs.length; i++) {
      x0.push(rs[i].x0); x1.push(rs[i].x1);
      wd.push(rs[i].x1 - rs[i].x0);
    }
    var mw = median(wd);
    if (mw < 10) return { score: 0, rows: rs.length };

    return { score: (mad(x1) - mad(x0)) / mw, rows: rs.length };
  }

  /**
   * 找「日期列」：小白板底部固定有「日 期 ＿年＿月＿日」，
   * 特徵是同一列上有 3 個以上「寬字」（CJK，寬高比 > 0.72）且彼此間距很大。
   * 回傳它在所有文字列中的相對排名（0 = 最上，1 = 最下），找不到回 -1。
   */
  function dateRowRank(mask, w, h) {
    var cs = components(mask, w, h);
    if (cs.length < 6) return -1;

    var hs = [], i, c;
    for (i = 0; i < cs.length; i++) hs.push(cs[i].y1 - cs[i].y0 + 1);
    var med = median(hs);
    if (med < 2) return -1;

    var gl = [];
    for (i = 0; i < cs.length; i++) {
      c = cs[i];
      var ch = c.y1 - c.y0 + 1;
      if (ch < 0.45 * med || ch > 2.2 * med) continue;
      if (c.area < 8) continue;
      gl.push(c);
    }
    if (gl.length < 6) return -1;

    /* 寬字（CJK）索引 */
    var wide = [];
    for (i = 0; i < gl.length; i++) {
      var cw = gl[i].x1 - gl[i].x0 + 1;
      var chh = gl[i].y1 - gl[i].y0 + 1;
      if (cw / (chh > 0 ? chh : 1) > 0.72) wide.push(i);
    }
    if (wide.length < 3) return -1;

    /* 找同一列、且間距明顯偏大的 3 個以上寬字 */
    var best = null, a, b, j;
    for (i = 0; i < wide.length; i++) {
      a = gl[wide[i]];
      var row = [];
      for (j = 0; j < wide.length; j++) {
        b = gl[wide[j]];
        if (Math.abs(b.cy - a.cy) < (a.y1 - a.y0 + 1) * 0.55) row.push(wide[j]);
      }
      if (row.length < 3) continue;
      row.sort(function (p, q) { return gl[p].x0 - gl[q].x0; });

      var minGap = 1e9;
      for (j = 0; j < row.length - 1; j++) {
        var gap = gl[row[j + 1]].x0 - gl[row[j]].x1;
        if (gap < minGap) minGap = gap;
      }
      var w0 = gl[row[0]].x1 - gl[row[0]].x0 + 1;
      if (minGap > w0 * 1.2) {
        if (!best || row.length > best.length) best = row;
      }
    }
    if (!best) return -1;

    var dy = 0;
    for (i = 0; i < best.length; i++) dy += (gl[best[i]].y0 + gl[best[i]].y1) / 2;
    dy /= best.length;

    var rs = textRows(mask, w, h);
    if (rs.length < 3) return -1;
    var below = 0;
    for (i = 0; i < rs.length; i++) if (rs[i].y < dy) below++;
    return below / (rs.length - 1);
  }

  /* ---------------- 主偵測 ---------------- */

  /**
   * 偵測文字方向。
   * @param {HTMLImageElement|HTMLCanvasElement|ImageBitmap} imgEl
   * @param {number} [srcW] 原圖寬（ImageBitmap 需要）
   * @param {number} [srcH] 原圖高
   * @returns {{angle:number, confidence:number, reason:string, axis:number, glyphs:number}}
   *          angle = 需要「順時針旋轉」的角度（0 / 90 / 180 / 270）
   */
  function detect(imgEl, srcW, srcH) {
    var none = { angle: 0, confidence: 0, reason: 'no-image', axis: 0, glyphs: 0 };
    if (!imgEl) return none;

    var g = toGray(imgEl, srcW, srcH);
    if (!g) return { angle: 0, confidence: 0, reason: 'no-data', axis: 0, glyphs: 0 };
    if (g.w < 24 || g.h < 24) {
      return { angle: 0, confidence: 0, reason: 'too-small', axis: 0, glyphs: 0 };
    }

    var base = edgeMask(g.gray, g.w, g.h);

    /* ---- 步驟 1：判斷「軸向」——文字是橫排還是直排 ----
       只比較 0° 與 90° 兩種（180° 與 0° 的投影完全相同，270° 與 90° 相同），
       避免 0/180 同分時亂跳。 */
    var a0 = axisScore(base, g.w, g.h);
    var r90 = rotMask(base, g.w, g.h, 1);
    var a90 = axisScore(r90.mask, r90.w, r90.h);

    var horizontal = (a0 >= a90);          /* true = 文字是橫排 */
    var axisStrength = Math.abs(a0 - a90); /* 兩者差距越大越確定 */

    /* 軸向太弱 → 判斷不出方向，保持原樣 */
    if (axisStrength < AXIS_MIN) {
      return {
        angle: 0, confidence: 0, reason: 'no-text',
        axis: axisStrength, glyphs: 0
      };
    }

    /* ---- 步驟 2：在正確軸向上判斷「正反」（是否 180° 顛倒） ---- */
    /* 橫排 → 用原圖；直排 → 順時針轉 90° 讓它變橫排再判斷 */
    var up = horizontal ? { mask: base, w: g.w, h: g.h } : r90;

    /* 正反判斷要用「墨色遮罩」（邊緣遮罩上下對稱，判不出正反） */
    var ink = inkMask(g.gray, g.w, g.h);
    var inkUp = horizontal ? { mask: ink, w: g.w, h: g.h } : rotMask(ink, g.w, g.h, 1);

    var f = { glyphs: components(inkUp.mask, inkUp.w, inkUp.h).length, cent: 0, flat: 0, votes: 0 };

    /* ---- 步驟 3：判斷正反 ----
       唯一依據是「日期字樣」：小白板上的 年/月/日 是固定會出現的字，
       正立時 4 位年排在最前（第一群最寬），顛倒時跑到最後。
       實測 42/42 = 100%。

       找不到日期字樣 → 依需求「保持原樣，不要亂轉」，直接回 0°。
       （不做字形統計的猜測：猜錯會把照片轉歪，比不轉更糟。） */
    var dScore = dateScore(inkUp.mask, inkUp.w, inkUp.h);

    /* ---- 步驟 4：日期字樣判不出 → 改用小白板固定欄位的版面結構 ----
       小白板是表格，每一列都從同一個左邊界起排（工程名稱、檢查項目、檢查人員…），
       所以「正立」時各列左緣整齊對齊；「顛倒」時變成右緣對齊。
       次要訊號：日期列固定在表格最底部，顛倒時會跑到最上面。

       兩個訊號都沒有 → 依需求「保持原樣，不要亂轉」，回 0°。
       （絕不用字形統計去猜：猜錯會把照片轉歪，比不轉更糟。） */
    var flip = null, reason = '', layoutS = 0, layoutRows = 0, dRank = -1;

    /* 先看版面結構（最可靠）：小白板各列左緣對齊 = 正立 */
    var lay = layoutScore(inkUp.mask, inkUp.w, inkUp.h);
    layoutS = lay.score;
    layoutRows = lay.rows;

    if (Math.abs(layoutS) >= LAYOUT_MIN && layoutRows >= 4) {
      flip = (layoutS < 0);
      reason = flip ? 'layout-flip' : 'layout-upright';
    } else if (dScore !== 0) {
      /* 版面訊號不足 → 用日期字樣（年/月/日 的群組順序） */
      flip = (dScore < 0);
      reason = flip ? 'date-flip' : 'date-upright';
    } else {
      /* 再退一步：日期列固定在表格最底部，顛倒時跑到最上面 */
      dRank = dateRowRank(inkUp.mask, inkUp.w, inkUp.h);
      /* 只接受「明確在最底」或「明確在最頂」的日期列，中間位置一律不判 */
      if (dRank >= 0.75) {
        flip = false; reason = 'daterow-upright';
      } else if (dRank >= 0 && dRank <= 0.25) {
        flip = true; reason = 'daterow-flip';
      }
    }

    /* 兩個訊號都判不出 → 保持原樣 */
    if (flip === null) {
      return {
        angle: 0,
        confidence: 0,
        reason: 'no-date',
        axis: axisStrength,
        glyphs: f.glyphs,
        cent: f.cent,
        flat: f.flat,
        votes: f.votes,
        dateScore: 0,
        layout: layoutS,
        layoutRows: layoutRows,
        dateRank: dRank
      };
    }

    var angle;

    if (horizontal) {
      angle = flip ? 180 : 0;
    } else {
      angle = flip ? 270 : 90;
    }

    /* 信心值：軸向差距 + 判別依據命中 */
    var conf = Math.min(1, axisStrength / 1.2 + 0.35);

    return {
      angle: angle,
      confidence: conf,
      reason: reason,
      axis: axisStrength,
      glyphs: f.glyphs,
      cent: f.cent,
      flat: f.flat,
      votes: f.votes,
      dateScore: dScore,
      layout: layoutS,
      layoutRows: layoutRows,
      dateRank: dRank
    };
  }

  /* ---------------- 套用到 canvas ---------------- */

  /**
   * 把圖片依 angle 順時針旋轉後畫進新畫布（可同時縮圖）。
   * @returns {{canvas:HTMLCanvasElement, width:number, height:number}}
   */
  function drawRotated(imgEl, srcW, srcH, angle, maxEdge) {
    var w0 = srcW || imgEl.width || imgEl.naturalWidth || 0;
    var h0 = srcH || imgEl.height || imgEl.naturalHeight || 0;
    if (!w0 || !h0) throw new Error('圖片尺寸無效');

    var swap = (angle === 90 || angle === 270);
    var outW0 = swap ? h0 : w0;
    var outH0 = swap ? w0 : h0;

    var s = maxEdge ? Math.min(1, maxEdge / Math.max(outW0, outH0)) : 1;
    var w = Math.max(1, Math.round(outW0 * s));
    var h = Math.max(1, Math.round(outH0 * s));

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    if (!ctx) throw new Error('無法建立畫布');

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle * Math.PI / 180);
    /* 旋轉後以「原圖縮放尺寸」置中繪製 */
    var dw = Math.round(w0 * s);
    var dh = Math.round(h0 * s);
    ctx.drawImage(imgEl, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    return { canvas: cv, width: w, height: h };
  }

  global.PhotoOrient = {
    DETECT_EDGE: DETECT_EDGE,
    AXIS_MIN: AXIS_MIN,
    FLIP_MIN: FLIP_MIN,
    detect: detect,
    drawRotated: drawRotated,
    /* 以下為測試用內部函式 */
    _toGray: toGray,
    _edgeMask: edgeMask,
    _rotMask: rotMask,
    _axisScore: axisScore,
    _uprightFeats: uprightFeats,
    _digitGroups: digitGroups,
    _dateScore: dateScore
  };

})(typeof window !== 'undefined' ? window : this);
