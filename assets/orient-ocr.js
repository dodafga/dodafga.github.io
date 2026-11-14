/*!
 * orient-ocr.js — /drive/ 查驗單照片自動轉正（OCR 兩段式）
 *
 *   第一段：對照片 OCR，在「原方向」找欄位標題（工程名稱／檢查項目／檢查日期／監察人員…）。
 *           找不到就把照片轉 90°、再轉 270° 各試一次，先把畫面轉成「橫式表單」。
 *   第二段：在已轉橫的畫面上，用「工程名稱（上）→ 檢查項目（中）→ 檢查日期（下）」
 *           的上下相對位置判斷是否上下顛倒，需要就再轉 180°。
 *   判不出來回傳 ok:false，由 UI 顯示「這樣對嗎？」並提供一鍵轉 180°。
 *
 * 關鍵細節：tesseract 對中文會把「工程名稱」切成「工程／名／稱」多個 word，
 *   所以必須先「同一列的詞按 x 排序合併成字串」再做標題比對，不能逐詞比對。
 *
 * 零侵入：只提供 window.PhotoOrientOCR，不改 watermark.js / orient.js / gdrive-photo.js。
 * 其他頁面（/、/form/、/photo/、/log/、/progress/、/settings/）不載入本檔。
 */
(function (global) {
  'use strict';

  /* ================= 本地資產（完全不依賴外部 CDN） =================
     所有 OCR 需要的檔案都放在本站 assets/ocr/ 底下：
       tesseract.min.js                   辨識程式本體
       worker.min.js                      背景執行緒腳本
       tesseract-core-simd-lstm.wasm.js   辨識核心（wasm 已內嵌）
       tesseract-core-lstm.wasm.js        辨識核心（裝置不支援 SIMD 時的備援）
       lang/chi_tra.traineddata.gz        繁體中文語言模型
     第一次載入後全部存進 Cache Storage，語言模型另外寫進 tesseract 自己
     使用的 IndexedDB，之後「完全斷網」也能直接 OCR。 */
  var ASSET_BASE = (function () {
    try {
      var cur = global.document && document.currentScript && document.currentScript.src;
      if (cur) return new URL('ocr/', cur).href;
    } catch (e) {}
    try { return new URL('../assets/ocr/', global.location.href).href; } catch (e) {}
    return 'assets/ocr/';
  })();

  var LANG = 'chi_tra';
  var LIB_URL = ASSET_BASE + 'tesseract.min.js';
  var WORKER_URL = ASSET_BASE + 'worker.min.js';
  var CORE_SIMD_URL = ASSET_BASE + 'tesseract-core-simd-lstm.wasm.js';
  var CORE_PLAIN_URL = ASSET_BASE + 'tesseract-core-lstm.wasm.js';
  var LANG_PATH = ASSET_BASE + 'lang';
  var LANG_FILE = LANG_PATH + '/' + LANG + '.traineddata.gz';

  var CACHE_NAME = 'photo-ocr-v1';
  var IDB_NAME = 'keyval-store', IDB_STORE = 'keyval';
  var IDB_KEY = './' + LANG + '.traineddata';

  /* 各檔案大約的位元組數，只用來算準備進度，不影響正確性。
     核心只下載「這台裝置真的用得到」的那一份：支援 SIMD 的裝置（幾乎所有
     近年手機與桌機）只抓 simd 版，避免一次下載 7.9 MB。 */
  function assetList() {
    var simd = hasSIMD();
    return [
      { key: 'lib',    url: LIB_URL,    size: 67000,  label: '辨識程式' },
      { key: 'worker', url: WORKER_URL, size: 124000, label: '背景執行緒' },
      { key: 'core',   url: simd ? CORE_SIMD_URL : CORE_PLAIN_URL,
        size: 3939000, label: '辨識核心' },
      { key: 'lang',   url: LANG_FILE,  size: 1668000, label: '繁體中文模型' }
    ];
  }

  var PROBE_EDGE = 1200;
  var MIN_KEYS = 2;
  var LIB_TIMEOUT = 25000;

  var TOP_LABELS = ['工程名稱', '工程地點', '主辦機關', '專案管理', '監造單位', '施工廠商'];
  var BODY_LABELS = ['檢查項目', '查驗項目', '檢查內容', '查驗內容', '施工項目', '檢查重點'];
  var DATE_LABELS = ['檢查日期', '查驗日期', '施作日期', '日期'];
  var PERSON_LABELS = ['檢查人員', '監察人員', '查驗人員', '品管人員', '施工人員'];

  var _libPromise = null, _libFailed = null, _worker = null, _workerPromise = null;
  var _prepPromise = null, _prepFailed = null;
  var _blobUrl = {};      /* key → blob: URL（只在本瀏覽階段有效，重新載入會重建） */
  var _prepState = { pct: 0, msg: '尚未準備', ready: false, failed: false, offline: false };

  /* ---------------- 本機快取（Cache Storage + IndexedDB） ---------------- */

  function cachesOK() {
    try { return !!(global.caches && global.caches.open && global.Response); } catch (e) { return false; }
  }

  function cacheGet(url) {
    if (!cachesOK()) return Promise.resolve(null);
    return global.caches.open(CACHE_NAME).then(function (c) {
      return c.match(url).then(function (r) { return r ? r.blob() : null; });
    }).catch(function () { return null; });
  }

  function cachePut(url, blob) {
    if (!cachesOK() || !blob) return Promise.resolve();
    return global.caches.open(CACHE_NAME).then(function (c) {
      return c.put(url, new global.Response(blob));
    }).catch(function () {});
  }

  /** 下載並回報位元組進度（拿不到 content-length 時以檔案大小估算）。 */
  function fetchProgress(url, onBytes) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      var total = Number(r.headers.get('content-length') || 0);
      if (!r.body || !r.body.getReader) {
        return r.blob().then(function (b) { onBytes(b.size, b.size); return b; });
      }
      var reader = r.body.getReader(), parts = [], got = 0;
      function pump() {
        return reader.read().then(function (s) {
          if (s.done) { onBytes(got, total || got); return new Blob(parts); }
          parts.push(s.value); got += s.value.length;
          onBytes(got, total);
          return pump();
        });
      }
      return pump();
    });
  }

  function idbOpen() {
    return new Promise(function (res, rej) {
      var rq = global.indexedDB.open(IDB_NAME);
      rq.onupgradeneeded = function () { try { rq.result.createObjectStore(IDB_STORE); } catch (e) {} };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var rq = tx.objectStore(IDB_STORE).get(key);
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      });
    }).then(function (v) { return v; }, function () { return undefined; });
  }

  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () { return false; });
  }

  function gunzip(blob) {
    if (!global.DecompressionStream) return Promise.reject(new Error('no DecompressionStream'));
    return new global.Response(blob.stream().pipeThrough(new global.DecompressionStream('gzip'))).arrayBuffer();
  }

  function hasSIMD() {
    try {
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
        3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
      ]));
    } catch (e) { return false; }
  }

  function makeBlobUrl(blob, type) {
    if (!blob) return null;
    try { return URL.createObjectURL(type ? new Blob([blob], { type: type }) : blob); } catch (e) { return null; }
  }

  /**
   * prepare(onProgress) → Promise<state>
   * 依序把 5 個資產帶進本機快取；已快取的不再上網。
   * 完成後建立 blob: URL，之後 loadLib／createWorker 一律使用本機檔案。
   */
  function prepare(onProgress) {
    function rep(pct, msg, extra) {
      _prepState.pct = Math.max(0, Math.min(100, Math.round(pct || 0)));
      if (msg) _prepState.msg = msg;
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) _prepState[k] = extra[k];
        }
      }
      if (typeof onProgress === 'function') {
        try {
          onProgress({ pct: _prepState.pct, msg: _prepState.msg, ready: _prepState.ready,
                       failed: _prepState.failed, offline: _prepState.offline });
        } catch (e) {}
      }
    }

    if (_prepPromise) {
      if (typeof onProgress === 'function') {
        try {
          onProgress({ pct: _prepState.pct, msg: _prepState.msg, ready: _prepState.ready,
                       failed: _prepState.failed, offline: _prepState.offline });
        } catch (e) {}
      }
      return _prepPromise;
    }

    var ASSETS = assetList();
    var totalW = 0, i;
    for (i = 0; i < ASSETS.length; i++) totalW += ASSETS[i].size;
    var doneW = 0, fromCacheN = 0, fetchedN = 0;

    _prepPromise = (async function () {
      var got = {}, j, a, blob, label, base;
      for (j = 0; j < ASSETS.length; j++) {
        a = ASSETS[j];
        label = '正在準備 OCR 模型…（' + (j + 1) + '/' + ASSETS.length + '）' + a.label;
        rep(doneW / totalW * 100, label);

        blob = await cacheGet(a.url);
        if (blob) {
          fromCacheN++;
        } else {
          base = doneW;
          blob = await fetchProgress(a.url, function (b, t) {
            var f = t ? Math.min(1, b / t) : (b ? 0.5 : 0);
            rep((base + a.size * f) / totalW * 100, label);
          });
          await cachePut(a.url, blob);
          fetchedN++;
        }
        got[a.key] = blob;
        doneW += a.size;
        rep(doneW / totalW * 100, label);
      }

      if (got.lib) _blobUrl.lib = makeBlobUrl(got.lib, 'text/javascript') || _blobUrl.lib;
      if (got.worker) _blobUrl.worker = makeBlobUrl(got.worker, 'text/javascript') || _blobUrl.worker;
      if (got.core) _blobUrl.core = makeBlobUrl(got.core, 'text/javascript') || _blobUrl.core;

      /* 語言模型另外塞進 tesseract 自己的 IndexedDB 快取：
         這樣即使瀏覽器把 HTTP 快取清掉，worker 也會優先讀本機資料。 */
      rep(96, '正在準備 OCR 模型…寫入語言模型快取');
      try {
        var cur = await idbGet(IDB_KEY);
        if (cur === undefined || cur === null) {
          if (got.lang) {
            var buf = await gunzip(got.lang);
            await idbSet(IDB_KEY, new Uint8Array(buf));
          }
        }
      } catch (e) {}

      var tail = fetchedN ? ('已下載 ' + fetchedN + ' 項，其餘用本機快取') : '全部使用本機快取';
      rep(100, 'OCR 模型已就緒（' + tail + '）', { ready: true, failed: false, offline: false });
      return _prepState;
    })().catch(function (e) {
      _prepFailed = e;
      _prepState.failed = true;
      _prepState.offline = (typeof global.navigator !== 'undefined' && global.navigator.onLine === false);
      rep(_prepState.pct, _prepState.offline ? '目前離線且模型尚未下載，改用人工確認' : 'OCR 模型載入失敗，改用人工確認', { failed: true });
      throw e;
    });

    return _prepPromise;
  }

  /** 供 createWorker 使用的選項：本機 blob 優先，其次才回頭用站內 URL。 */
  function workerOpts() {
    var opts = { langPath: LANG_PATH, gzip: true, workerBlobURL: true };
    if (_blobUrl.worker) opts.workerPath = _blobUrl.worker;
    var coreBlob = _blobUrl.core;
    if (coreBlob) {
      /* tesseract 以「結尾是不是 js」判斷 corePath 是單一檔案還是資料夾；
         blob: URL 不結尾 js，補一個 fragment 讓它認得，fetch 時會被忽略。 */
      opts.corePath = coreBlob + '#.js';
    } else {
      opts.corePath = hasSIMD() ? CORE_SIMD_URL : CORE_PLAIN_URL;
    }
    return opts;
  }

  /** 建立 worker；本機 blob 核心失敗時自動退回站內 URL（需要連線）。 */
  function newWorker(lib) {
    var list = [workerOpts()];
    if (_blobUrl.core) {
      var alt = workerOpts();
      alt.corePath = hasSIMD() ? CORE_SIMD_URL : CORE_PLAIN_URL;
      list.push(alt);
    }
    var idx = 0;
    function tryNext() {
      var o = list[idx++];
      return lib.createWorker(LANG, 1, o).catch(function (e) {
        if (idx < list.length) return tryNext();
        throw e;
      });
    }
    return tryNext();
  }

  /* ---------------- 載入 ---------------- */

  function loadScript(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var s = document.createElement('script');
      s.src = url; s.async = true;
      var timer = setTimeout(function () {
        if (done) return; done = true;
        reject(new Error('OCR 程式載入逾時'));
      }, timeoutMs || LIB_TIMEOUT);
      s.onload = function () { if (done) return; done = true; clearTimeout(timer); resolve(); };
      s.onerror = function () { if (done) return; done = true; clearTimeout(timer); reject(new Error('OCR 程式載入失敗')); };
      document.head.appendChild(s);
    });
  }

  function loadLib() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);
    if (_libFailed) return Promise.reject(_libFailed);
    if (_libPromise) return _libPromise;
    _libPromise = prepare(null).then(function () {
      return loadScript(_blobUrl.lib || LIB_URL, LIB_TIMEOUT);
    }).then(function () {
      if (!global.Tesseract) throw new Error('OCR 程式不可用');
      return global.Tesseract;
    }).catch(function (e) {
      _libFailed = e; _libPromise = null;
      throw e;
    });
    return _libPromise;
  }

  /** 暖機：預先下載程式與語言資料，讓第一次選照片不用等。 */
  /**
   * 取得「唯一一個」OCR worker 並重複使用。
   * 為什麼一定要共用：tesseract.js 的 Tesseract.recognize() 每次呼叫
   * 都會新建一個 worker，連續呼叫多次（多趟偵測）會把瀏覽器資源吃光而卡死。
   * 共用同一個 worker 連續辨識 12 張照片實測正常。
   */
  function getWorker(lib) {
    if (_worker) return Promise.resolve(_worker);
    if (_workerPromise) return _workerPromise;
    _workerPromise = newWorker(lib)
      .then(function (w) { _worker = w; return w; })
      .catch(function (e) { _workerPromise = null; throw e; });
    return _workerPromise;
  }

  /** 丟棄目前 worker（卡住或逾時時用），下次呼叫會重建一個乾淨的。 */
  function dropWorker() {
    var w = _worker;
    _worker = null; _workerPromise = null;
    if (w && w.terminate) { try { w.terminate(); } catch (e) {} }
  }

  /** 暖機＝把 5 個資產全部帶進本機快取（不建立 worker，避免與辨識流程衝突）。 */
  function warmup(onProgress) {
    return prepare(onProgress).then(function (st) { return st; })
      .catch(function () { return null; });
  }

  /* ---------------- 影像 ---------------- */

  function loadImageEl(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('圖片載入失敗')); };
      img.src = src;
    });
  }

  /**
   * 依 angle（0/90/180/270）旋轉，可選擇先裁到紙張範圍，再縮到長邊 <= edge。
   * 白底輸出 PNG dataURL。
   * opts: { crop: {x,y,w,h} 正規化, edge: number }
   */
  function renderRot(imgEl, angle, edgeOrOpts) {
    var edge = PROBE_EDGE, crop = null;
    if (typeof edgeOrOpts === 'object' && edgeOrOpts) {
      if (edgeOrOpts.edge) edge = edgeOrOpts.edge;
      crop = edgeOrOpts.crop || null;
    } else if (edgeOrOpts) {
      edge = edgeOrOpts;
    }

    var w0 = imgEl.naturalWidth || imgEl.width || 0;
    var h0 = imgEl.naturalHeight || imgEl.height || 0;
    if (!w0 || !h0) throw new Error('圖片尺寸無效');

    var sx = 0, sy = 0, sw = w0, sh = h0;
    if (crop) {
      sx = Math.max(0, Math.round(crop.x * w0));
      sy = Math.max(0, Math.round(crop.y * h0));
      sw = Math.min(w0 - sx, Math.round(crop.w * w0));
      sh = Math.min(h0 - sy, Math.round(crop.h * h0));
      if (sw < 8 || sh < 8) { sx = 0; sy = 0; sw = w0; sh = h0; }
    }

    var swap = (angle === 90 || angle === 270);
    var ow = swap ? sh : sw;
    var oh = swap ? sw : sh;
    var scale = Math.min(1, edge / Math.max(ow, oh));
    var w = Math.max(1, Math.round(ow * scale));
    var h = Math.max(1, Math.round(oh * scale));
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    if (!ctx) throw new Error('無法建立畫布');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    var dw = Math.round(sw * scale), dh = Math.round(sh * scale);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    if (angle) ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(imgEl, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return { url: cv.toDataURL('image/png'), w: w, h: h, canvas: cv, crop: crop || null };
  }

  /* ---------------- 紙張偵測（先裁到紙再 OCR） ---------------- */

  /**
   * 手機拍的照片裡，表格只佔畫面一小塊。若直接縮到 1400px 再 OCR，
   * 印刷標題會小到認不出來。所以先找出「一片明亮的大區塊」（紙），
   * 裁切放大後才 OCR —— 這是準確率的關鍵。
   * 回傳 {x,y,w,h} 正規化 0..1，找不到回 null。
   */
  function findPaper(imgEl) {
    var W = 300;
    var w0 = imgEl.naturalWidth || imgEl.width || 0;
    var h0 = imgEl.naturalHeight || imgEl.height || 0;
    if (!w0 || !h0) return null;
    var s = Math.min(1, W / Math.max(w0, h0));
    var cw = Math.max(1, Math.round(w0 * s)), ch = Math.max(1, Math.round(h0 * s));
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    cx.drawImage(imgEl, 0, 0, cw, ch);
    var data;
    try { data = cx.getImageData(0, 0, cw, ch).data; } catch (e) { return null; }

    var n = cw * ch, lum = new Uint8Array(n), i;
    for (i = 0; i < n; i++) {
      var o = i * 4;
      lum[i] = (data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114) | 0;
    }
    /* Otsu */
    var hist = new Float64Array(256);
    for (i = 0; i < n; i++) hist[lum[i]]++;
    var tot = n, sum = 0;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    var sumB = 0, wB = 0, best = -1, thr = 150;
    for (var t = 1; t < 255; t++) {
      wB += hist[t]; if (!wB) continue;
      var wF = tot - wB; if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    var cut = Math.max(150, thr + 8);

    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = lum[i] >= cut ? 1 : 0;

    /* 連通元件（4 鄰），取面積最大的亮塊 */
    var comp = new Int32Array(n), stack = new Int32Array(n), label = 0;
    var bestArea = 0, bestLabel = 0;
    var minX = 0, minY = 0, maxX = 0, maxY = 0;
    for (i = 0; i < n; i++) {
      if (!mask[i] || comp[i]) continue;
      label++;
      var sp = 0; stack[sp++] = i; comp[i] = label;
      var area = 0, bx0 = cw, by0 = ch, bx1 = 0, by1 = 0;
      while (sp > 0) {
        var p = stack[--sp]; area++;
        var px = p % cw, py = (p / cw) | 0;
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
        if (py < by0) by0 = py; if (py > by1) by1 = py;
        if (px > 0 && mask[p - 1] && !comp[p - 1]) { comp[p - 1] = label; stack[sp++] = p - 1; }
        if (px < cw - 1 && mask[p + 1] && !comp[p + 1]) { comp[p + 1] = label; stack[sp++] = p + 1; }
        if (py > 0 && mask[p - cw] && !comp[p - cw]) { comp[p - cw] = label; stack[sp++] = p - cw; }
        if (py < ch - 1 && mask[p + cw] && !comp[p + cw]) { comp[p + cw] = label; stack[sp++] = p + cw; }
      }
      if (area > bestArea) {
        bestArea = area; bestLabel = label;
        minX = bx0; minY = by0; maxX = bx1; maxY = by1;
      }
    }
    if (!bestLabel) return null;
    var areaFrac = bestArea / n;
    /* 只有「紙張明顯只是畫面的一小塊」才需要裁切放大。
       若亮區已經佔了畫面一大半（例如掃描檔、或拍照時已貼近整張表單），
       裁切反而會把表頭切掉，導致認不出「工程名稱」——此時直接用整張圖。 */
    if (areaFrac < 0.06) return null;
    if (areaFrac > 0.55) return null;
    var bw = (maxX - minX + 1) / cw, bh = (maxY - minY + 1) / ch;
    if (bw < 0.20 || bh < 0.20) return null;
    if (bw > 0.97 && bh > 0.97) return null;

    /* 外擴 2%（避免切掉框線） */
    var pad = 0.02;
    var x = Math.max(0, minX / cw - pad), y = Math.max(0, minY / ch - pad);
    var W2 = Math.min(1 - x, bw + pad * 2), H2 = Math.min(1 - y, bh + pad * 2);
    return { x: x, y: y, w: W2, h: H2, area: areaFrac };
  }

  /* ---------------- 取詞 → 併列 ---------------- */

  function norm(s) { return String(s == null ? '' : s).replace(/[\s\u3000]+/g, ''); }

  function rawWords(res) {
    var out = [];
    var ws = res && res.data && res.data.words;
    if (Array.isArray(ws) && ws.length) {
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        if (!w || !w.bbox) continue;
        var t = norm(w.text);
        if (!t) continue;
        out.push({ t: t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, c: w.confidence || 0 });
      }
      return out;
    }
    var ls = (res && res.data && res.data.lines) || [];
    for (var j = 0; j < ls.length; j++) {
      var l = ls[j];
      if (!l || !l.bbox) continue;
      var lt = norm(l.text);
      if (!lt) continue;
      out.push({ t: lt, x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, c: l.confidence || 0 });
    }
    return out;
  }

  /**
   * 把詞依「垂直中心」聚成列，每列再按 x 排序合併成一個字串。
   * 這是中文 OCR 的必要步驟（否則「工程名稱」會被拆成三個詞而比對失敗）。
   */
  function groupRows(words) {
    if (!words.length) return [];
    var hs = words.map(function (w) { return Math.max(1, w.y1 - w.y0); }).sort(function (a, b) { return a - b; });
    var medH = hs[Math.floor(hs.length / 2)] || 12;
    var tol = Math.max(6, medH * 0.6);
    var sorted = words.slice().sort(function (a, b) {
      var ay = (a.y0 + a.y1) / 2, by = (b.y0 + b.y1) / 2;
      if (Math.abs(ay - by) > tol) return ay - by;
      return a.x0 - b.x0;
    });
    var rows = [], cur = null;
    for (var i = 0; i < sorted.length; i++) {
      var w = sorted[i];
      var cy = (w.y0 + w.y1) / 2;
      if (cur && Math.abs(cy - cur.cy) <= tol) {
        cur.items.push(w);
        cur.cy = (cur.cy * (cur.items.length - 1) + cy) / cur.items.length;
      } else {
        cur = { cy: cy, items: [w] };
        rows.push(cur);
      }
    }
    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x0 - b.x0; });
      r.text = r.items.map(function (w) { return w.t; }).join('');
      r.x0 = Math.min.apply(null, r.items.map(function (w) { return w.x0; }));
      r.x1 = Math.max.apply(null, r.items.map(function (w) { return w.x1; }));
    });
    return rows;
  }

  function findLabel(rows, list) {
    for (var k = 0; k < list.length; k++) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].text.indexOf(list[k]) >= 0) {
          return { label: list[k], row: rows[i] };
        }
      }
    }
    return null;
  }

  /** OCR 一張（已旋轉）圖 → 標題位置（正規化 0..1）。 */
  function ocrOnce(lib, imgEl, angle, crop, wkr) {
    var pr;
    try { pr = renderRot(imgEl, angle, { edge: PROBE_EDGE, crop: crop || null }); }
    catch (e) { return Promise.reject(e); }
    /* 用 Tesseract.recognize：它每次自建 worker 並在完成後釋放。
       共用長期 worker 在連續辨識第二張時會永遠不 resolve（實測），
       而每次新建雖然慢一些但一定會結束，對手機端更可靠。 */
    var run = (wkr ? Promise.resolve(wkr) : getWorker(lib))
      .then(function (w) { return w.recognize(pr.url); });

    /* 單趟逾時保護（手機慢也給足 25 秒），逾時就當這一趟失敗、換下一趟 */
    run = Promise.race([
      run,
      new Promise(function (resolve, reject) {
        setTimeout(function () { reject(new Error('OCR 單趟逾時')); }, 25000);
      })
    ]);

    return run.then(function (res) {
      var rows = groupRows(rawWords(res));
      var found = {};
      function put(prefix, hit) {
        if (!hit) return;
        var key = prefix + ':' + hit.label;
        if (found[key]) return;
        found[key] = {
          y: (hit.row.cy) / pr.h,
          x: ((hit.row.x0 + hit.row.x1) / 2) / pr.w,
          text: hit.row.text.slice(0, 24)
        };
      }
      put('top', findLabel(rows, TOP_LABELS));
      put('body', findLabel(rows, BODY_LABELS));
      put('date', findLabel(rows, DATE_LABELS));
      put('person', findLabel(rows, PERSON_LABELS));

      var nTop = 0, nBody = 0, nDate = 0, nPerson = 0, k;
      for (k in found) {
        if (!Object.prototype.hasOwnProperty.call(found, k)) continue;
        if (k.indexOf('top:') === 0) nTop++;
        else if (k.indexOf('body:') === 0) nBody++;
        else if (k.indexOf('date:') === 0) nDate++;
        else nPerson++;
      }
      return {
        angle: angle, w: pr.w, h: pr.h, found: found, rows: rows.length,
        nTop: nTop, nBody: nBody, nDate: nDate, nPerson: nPerson,
        keys: nTop + nBody + nDate + nPerson
      };
    });
  }

  /* ---------------- 第二段：判 180 ---------------- */

  function firstOf(found, prefix) {
    for (var k in found) {
      if (Object.prototype.hasOwnProperty.call(found, k) && k.indexOf(prefix + ':') === 0) return found[k];
    }
    return null;
  }

  /**
   * 在「已轉成橫向」的畫面上判斷是否上下顛倒。
   *   正立：工程名稱在上（y 小）、檢查項目在中、檢查日期在下（y 大）
   */
  function decideFlip(found) {
    var top = firstOf(found, 'top');
    var body = firstOf(found, 'body');
    var date = firstOf(found, 'date');
    var person = firstOf(found, 'person');

    if (top && body && date) {
      var votes = 0;
      if (body.y > top.y) votes++; else votes--;
      if (date.y > top.y) votes++; else votes--;
      if (date.y > body.y) votes++; else votes--;
      return { flip: votes < 0, why: 'tri:' + votes };
    }
    if (top && body) return { flip: body.y < top.y, why: 'body-vs-name' };
    if (top && date) return { flip: date.y < top.y, why: 'date-vs-name' };
    if (body && date) return { flip: date.y < body.y, why: 'date-vs-body' };
    if (top && person) return { flip: person.y < top.y, why: 'person-vs-name' };
    if (top) return { flip: top.y > 0.55, why: 'name-only' };
    if (date) return { flip: date.y < 0.35, why: 'date-only' };
    if (body) return { flip: body.y > 0.60, why: 'body-only' };
    return null;
  }

  /* ---------------- 主流程 ---------------- */

  /**
   * detect(imgEl) → Promise<{ angle, ok, reason, keys, detail, tried, passes, ms }>
   *   angle = 需要施加到「原始照片」上的順時針旋轉角度（0/90/180/270）
   */
  /* 一張照片最多花多少時間做方向判斷。超過就放棄並交回使用者確認，
     寧可問使用者，也絕不能讓上傳鍵卡在 disabled。 */
  var DETAIL_BUDGET = 22000;

  function detect(imgEl) {
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var tried = [], used = 0;

    /* 外層硬性上限：不論內部進行到哪一趟，時間到就回一個「判不出來」的結果。 */
    var hard = new Promise(function (resolve) {
      setTimeout(function () {
        dropWorker();   /* 卡住的 worker 直接丟掉，避免拖累下一張 */
        resolve({
          angle: 0, ok: false, reason: 'budget-exceeded', keys: 0, detail: null,
          tried: tried.slice(), passes: used, budgetMs: DETAIL_BUDGET,
          ms: Math.round(((global.performance && performance.now) ? performance.now() : Date.now()) - t0)
        });
      }, DETAIL_BUDGET);
    });

    var inner = detectInner(imgEl, t0);
    return Promise.race([inner, hard]).then(function (res) {
      return refineSkew(imgEl, res, t0);
    });
  }

  /**
   * 細部傾斜修正：四方向（0/90/180/270）判出來之後，再量「文字行還歪幾度」。
   *
   *   1. 先把照片依粗角度轉正（renderRot），得到一張「大致擺正」的畫面。
   *   2. 用 OrientSkew 量這張畫面的文字行傾斜（±45° 內）。
   *   3. 最終角度 = 粗角度 + 細部角度（可為小數）。
   *
   * 只有 ok===true 才做＋判不出方向時完全不動，維持「這樣對嗎？」的原本行為。
   * 任何例外都吞掉，退回粗角度，絕不讓自動轉正失敗。
   */
  function refineSkew(imgEl, res, t0) {
    if (!res || !res.ok) return res;
    var SK = global.OrientSkew;
    if (!SK || typeof SK.estimate !== 'function') return res;
    try {
      var coarse = Number(res.angle) || 0;
      var pr = renderRot(imgEl, coarse, { edge: 900 });
      var est = SK.estimate(pr.canvas, 640);
      if (!est || !est.ok || !est.delta) {
        res.skew = est ? { ok: !!est.ok, delta: 0, reason: est.reason } : null;
        return res;
      }
      var total = coarse + Number(est.delta);
      total = ((total % 360) + 360) % 360;
      /* 取到 0.1 度，避免浮點尾數 */
      total = Math.round(total * 10) / 10;
      res.angle = total;
      res.coarseAngle = coarse;
      res.skew = { ok: true, delta: est.delta, confidence: est.confidence, reason: est.reason };
      res.reason = (res.reason || '') + '+skew' + est.delta;
      res.ms = Math.round(((global.performance && performance.now) ? performance.now() : Date.now()) - t0);
      return res;
    } catch (e) {
      res.skew = { ok: false, delta: 0, reason: 'skew-error' };
      return res;
    }
  }

  function detectInner(imgEl, t0) {
    var tried = [], used = 0;

    function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
    function done(res, ok, reason) {
      return {
        angle: res ? res.angle : 0,
        ok: !!ok,
        reason: reason || (res ? res.reason : 'no-ocr'),
        keys: res ? res.keys : 0,
        detail: res ? { nTop: res.nTop, nBody: res.nBody, nDate: res.nDate, nPerson: res.nPerson } : null,
        tried: tried.slice(), passes: used, ms: Math.round(now() - t0)
      };
    }

    return loadLib().then(function (lib) {
      /* 每張照片都用「全新的 worker」，辨識完立刻 terminate。
         實測：共用 worker 連續辨識第二張會永遠不 resolve；
         每張新建則穩定（多花約 0.3 秒）。 */
      return newWorker(lib).then(function (w) {
      /* 紙張裁切只是「可能更好」的前處理，不是必要的。
         實測發現：對整張都是表單的照片，紙張偵測會誤抓到表格中段，
         裁切後反而把表頭（工程名稱）切掉。所以策略改成
         「先試不裁切；不裁切認不出足夠標題，才去試裁切版本」。
         兩種都只在必要時才跑，總趟數上限仍是 4 趟 × 2 種 = 最多 8 趟，
         但實務上第一種就幾乎都會成功（常見情況只跑 1 趟）。 */
      var crop = null;
      try { crop = findPaper(imgEl); } catch (e) { crop = null; }
      var cropMode = 0;   /* 0 = 不裁切, 1 = 裁切 */

      function stop() { try { w.terminate(); } catch (e) {} }

      function pass(a, useCrop) {
        used++; tried.push(a);
        return ocrOnce(lib, imgEl, a, useCrop ? crop : null, w).catch(function () { return null; });
      }
      function judge(r, base) {
        if (!r || r.keys < MIN_KEYS) return null;
        var d = decideFlip(r.found);
        if (!d) return { fail: true, r: r };
        var a = (base + (d.flip ? 180 : 0)) % 360;
        return { angle: a, keys: r.keys, why: d.why };
      }

      /* 依序試 0 → 90 → 180 → 270。
         0 與 180 都是「橫向」候選；哪一趟先認出足夠標題，就用那一趟的相對位置判 180。
         這比「先判橫直、再判上下」更穩：OCR 對倒字幾乎完全認不出來，
         所以「認得出字」本身就是上下方向的最強證據。 */
      var ANGLES = [0, 90, 270, 180];
      var results = [];
      var passIdx = 0, cropMode = 0;

      /* 決定先試哪一種：
         - 紙張明顯只是畫面一小塊（area 小）→ 先試「裁切放大」，因為不裁切時字太小認不出。
         - 紙張幾乎佔滿畫面（例如整張都是表單）→ 先試「不裁切」，避免裁掉表頭。
         這樣兩種常見情況都只要跑 1~2 趟就中，不必每次都跑滿 8 趟。 */
      var preferCrop = !!(crop && crop.area <= 0.30);

      function nextPass() {
        if (passIdx >= ANGLES.length) {
          if (cropMode === 0 && crop && !preferCrop) { cropMode = 1; passIdx = 0; }
          else if (cropMode === 0 && crop && preferCrop) { cropMode = 2; passIdx = 0; }
          else return finish();
        }
        if (passIdx >= ANGLES.length) return finish();
        var base = ANGLES[passIdx++];
        var useCrop = (cropMode === 1) || (cropMode === 0 && preferCrop);
        return pass(base, useCrop).then(function (r) {
          results.push({ base: base, r: r, crop: useCrop ? 1 : 0 });
          var j = judge(r, base);
          if (j && !j.fail) {
            return done({ angle: j.angle, keys: j.keys }, true,
              'rot' + base + ':' + j.why + (useCrop ? ':crop' : ''));
          }
          return nextPass();
        });
      }

      function finish() {
        var nonNull = results.filter(function (x) { return !!x.r; });
        var best = nonNull.slice().sort(function (a, b) {
          return (b.r.keys - a.r.keys) || (a.base - b.base) || (a.crop - b.crop);
        })[0];
        var anyKeys = nonNull.some(function (x) { return x.r.keys >= MIN_KEYS; });
        return done(best ? best.r : null, false, anyKeys ? 'keys-but-ambiguous' : 'no-labels');
      }

      return nextPass().then(function (r) { stop(); return r; },
                             function (e) { stop(); throw e; });
      }).catch(function (e) {
        return {
          angle: 0, ok: false, reason: 'ocr-unavailable', keys: 0, detail: null,
          tried: tried.slice(), passes: used,
          error: e && e.message ? e.message : String(e),
          ms: Math.round(now() - t0)
        };
      });
    });
  }

  function isAvailable() { return !_libFailed; }
  function reset() {
    _libFailed = null; _libPromise = null;
    _prepPromise = null; _prepFailed = null;
    _prepState = { pct: 0, msg: '尚未準備', ready: false, failed: false, offline: false };
  }

  global.PhotoOrientOCR = {
    detect: detect,
    warmup: warmup,
    isAvailable: isAvailable,
    reset: reset,
    renderRot: renderRot,
    loadImageEl: loadImageEl,
    _decideFlip: decideFlip,
    _ocrOnce: ocrOnce,
    _groupRows: groupRows,
    _findPaper: findPaper,
    _rawWords: rawWords,
    prepare: prepare,
    state: function () {
      return { pct: _prepState.pct, msg: _prepState.msg, ready: _prepState.ready,
               failed: _prepState.failed, offline: _prepState.offline };
    },
    assetBase: ASSET_BASE,
    hasSIMD: hasSIMD,
    isPrepared: function () { return _prepState.ready; },
    MIN_KEYS: MIN_KEYS,
    PROBE_EDGE: PROBE_EDGE,
    VERSION: '2.0.0-offline'
  };
})(typeof window !== 'undefined' ? window : this);
