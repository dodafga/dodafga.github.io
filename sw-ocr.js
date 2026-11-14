/*!
 * sw-ocr.js — /drive/ 照片上傳頁的離線快取
 *
 * 目的：讓 /drive/ 在「完全沒有網路」時也能開啟並使用 OCR。
 *
 * 安全邊界（很重要）：
 *   只攔截「/drive/ 頁面本身」＋「/drive/ 用到的 assets」＋「/assets/ocr/ 模型」。
 *   其餘請求一律不呼叫 respondWith，直接交回瀏覽器預設行為。
 *   因此 /、/form/、/photo/、/log/、/progress/、/settings/ 完全不受影響
 *   （它們不會被這個 service worker 攔到，也不會拿到這裡的快取）。
 *
 * 策略（v3 起改版，修正「改了程式但使用者永遠看到舊版」的問題）：
 *   1. 頁面 HTML 與程式／樣式（/drive/、drive-v2.js、drive-v2.css …）→ network-first
 *      先上網拿最新版，成功就順手存起來；離線才退回快取。
 *      這樣只要一部署，使用者重新整理就會拿到新程式，不會被舊快取黏住。
 *   2. OCR 模型（/assets/ocr/）→ cache-first
 *      檔案大又不常變動，先本機、沒有才上網，離線也一定載得到。
 *   3. 快取版本號 CACHE 每次改版都要往上加；activate 會清掉所有舊版快取，
 *      並在「確實清掉舊版」時把已開啟的 /drive/ 分頁重新載入一次，
 *      讓修正立刻生效（只會發生一次，不會造成重載迴圈）。
 */
'use strict';

var CACHE = 'drive-offline-v3';

/* /drive/ 頁面本身（兩種寫法都收） */
var PAGE_URLS = ['/drive/', '/drive/index.html'];

/* /drive/ 會載入的資產（白名單，逐一列出，避免影響其他頁面） */
var DRIVE_ASSETS = [
  '/assets/jszip.min.js',
  '/assets/core.js',
  '/assets/store.js',
  '/assets/gdrive.js',
  '/assets/watermark.js',
  '/assets/orient.js',
  '/assets/orient-struct3.js',
  '/assets/orient-ocr.js',
  '/assets/orient-switch.js',
  '/assets/photo-edit.js',
  '/assets/gdrive-photo.js',
  '/assets/drive-page.js',
  '/assets/batch-del.js',
  '/assets/drive-v2.js',
  '/assets/drive-v2.css',
  '/assets/drive-page.css',
  '/assets/photo-edit.css'
];

/* OCR 模型：整個資料夾都收，且採 cache-first */
var OCR_PREFIX = '/assets/ocr/';

function inScope(url) {
  var p = url.pathname;
  if (PAGE_URLS.indexOf(p) >= 0) return true;
  if (p.indexOf(OCR_PREFIX) === 0) return true;
  if (DRIVE_ASSETS.indexOf(p) >= 0) return true;
  return false;
}

function isOcr(pathname) {
  return pathname.indexOf(OCR_PREFIX) === 0;
}

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 安裝時就把「頁面 + 頁面用到的所有程式 + OCR 模型」全部抓下來。
         這樣即使瀏覽器把 HTTP 快取清掉，斷網重開也一定開得起來。
         任何一項失敗都不會讓安裝失敗（例如某個檔案暫時 404）。 */
      var list = PAGE_URLS.concat(DRIVE_ASSETS).concat([
        OCR_PREFIX + 'tesseract.min.js',
        OCR_PREFIX + 'worker.min.js',
        OCR_PREFIX + 'tesseract-core-simd-lstm.wasm.js',
        OCR_PREFIX + 'tesseract-core-lstm.wasm.js',
        OCR_PREFIX + 'lang/chi_tra.traineddata.gz'
      ]);
      return Promise.all(list.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      var old = keys.filter(function (k) {
        return k.indexOf('drive-offline-') === 0 && k !== CACHE;
      });
      return Promise.all(old.map(function (k) { return caches.delete(k); }))
        .then(function () { return old.length; });
    }).then(function (oldCount) {
      return self.clients.claim().then(function () {
        /* 只有「這次真的清掉了舊版快取」才重載已開啟的分頁（一次性遷移）。
           這樣使用者不必自己按重新整理，就能離開被舊快取黏住的畫面；
           也不會在正常情況下造成重載迴圈。 */
        if (!oldCount) return null;
        return self.clients.matchAll({ type: 'window' }).then(function (cs) {
          cs.forEach(function (cl) {
            try { cl.navigate(cl.url); } catch (err) {}
          });
        });
      });
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   /* 跨網域一律放行 */
  if (!inScope(url)) return;                          /* 其他頁面一律放行 */

  /* ---- OCR 模型：cache-first（先本機、沒有才上網）---- */
  if (isOcr(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(function (c) {
        return c.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
            return res;
          }).catch(function () { return Response.error(); });
        });
      })
    );
    return;
  }

  /* ---- 頁面與程式／樣式：network-first（先上網拿最新版，離線才用快取）---- */
  e.respondWith(
    caches.open(CACHE).then(function (c) {
      var net = req.mode === 'navigate'
        ? fetch(req, { cache: 'no-cache' })
        : fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      return net.then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          try { c.put(req, res.clone()); } catch (err) {}
        }
        return res;
      }).catch(function () {
        /* 離線：退回快取。導覽請求連頁面快取都沒有時，回頁面快取的最後手段。 */
        return c.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') {
            return c.match(PAGE_URLS[0], { ignoreSearch: true }).then(function (pg) {
              return pg || Response.error();
            });
          }
          return Response.error();
        });
      });
    })
  );
});
