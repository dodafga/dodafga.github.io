/*!
 * orient-ocr.js — /drive/ 查驗單照片自動轉正（OCR 兩段式，完全離線）
 *
 *   ️ 第一段：對照片 OCR，在「原方向」找欄位標題（工程名稱／檢查項目／檢查日期／監察人員…）。
 *           找不到就把照片轉 90°、再轉 270° 各試一次，先把畫面轉成「橫式表單」。
 *   第二段：在已轉橫的畫面上，用「工程名稱（上）→ 檢查項目（中）→ 檢查日期（下）」
 *           的上下相對位置判斷是否上下顛倒，需要就再轉 180°。
 *   判不出來回傳 ok:false，由 UI 顯示「這樣對嗎？」並提供一鍵轉 180°。
 *
 * 離線設計（v2.0）：
 *   所有資產（程式、worker、core、繁中模型）都放在本站 assets/ocr/ 底下，
 *   以相對路徑載入，完全不依賴外部 CDN。
 *   第一次載入後全部存進 Cache Storage，繁中模型另外寫進 tesseract 自己使用的
 *   IndexedDB，之後即使完全斷網也能直接 OCR。
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

  var PROBE_EDGE = 1200;
  var MIN_KEYS = 2;
  var LIB_TIMEOUT = 25000;

  var TOP_LABELS = ['工程名稱', '工程地點', '主辦機關', '專案管理', '監造單位', '施工廠商'];
  var BODY_LABELS = ['檢查項目', '查驗項目', '檢查內容', '查驗內容', '施工項目', '檢查重點'];
  var DATE_LABELS = ['檢查日期', '查驗日期', '施作日期', '日期'];
  var PERSON_LABELS = ['檢查人員', '監察人員', '查驗人員', '品管人員', '施工人員'];

  var _libPromise = null, _libFailed = null, _worker = null, _workerPromise = null;
  var _prepPromise = null, _prepFailed = null;
  var _blobUrl = {};
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

  /* 核心只下載「這台裝置真的用得到」的那一份，避免一次下載 7.9 MB。 */
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

  /**
   * prepare(onProgress) → Promise<state>
   * 依序把資產帶進本機快取；已快取的不再上網。
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
      rep(_prepState.pct, null);
      return _prepPromise;
    }

    var ASSETS = assetList();
    var totalW = 0, i;
    for (i = 0; i < ASSETS.length; i++) totalW += ASSETS[i].size;
    var doneW = 0, fetchedN = 0;

    _prepPromise = (async function () {
      var got = {}, j, a, blob, label, base;
      for (j = 0; j < ASSETS.length; j++) {
        a = ASSETS[j];
        label = '正在準備 OCR 模型…（' + (j + 1) + '/' + ASSETS.length + '）' + a.label;
        rep(doneW / totalW * 100, label);

        blob = await cacheGet(a.url);
        if (!blob) {
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

      /* 語言模型另外塞進 tesseract 自己的 IndexedDB 快取。 */
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
    if (_blobUrl.core) {
      /* tesseract 以「結尾是不是 js」判斷 corePath 是單一檔案還是資料夾；
         blob: URL 不結尾 js，補一個 fragment 讓它認得，fetch 時會被忽略。 */
      opts.corePath = _blobUrl.core + '#.js';
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

  /**
   * 取得「唯一一個」OCR worker 並重複使用。
   * tesseract.js 的 Tesseract.recognize() 每次呼叫都會新建 worker，
   * 連續呼叫多次會把瀏覽器資源吃光而卡死。
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

  /** 暖機＝把資產全部帶進本機快取（不建立 worker，避免與辨識流程衝突）。 */
  function warmup(onProgress) {
    return prepare(onProgress).then(function (st) { return st; })
      .catch(function () { return null; });
  }
