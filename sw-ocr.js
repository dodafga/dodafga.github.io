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
 * 策略：cache-first（先本機、沒有才上網），上網成功就順手存起來。
 */
'use strict';

var CACHE = 'drive-offline-v2';

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

/* OCR 模型：整個資料夾都收 */
var OCR_PREFIX = '/assets/ocr/';

function inScope(url) {
  var p = url.pathname;
  if (PAGE_URLS.indexOf(p) >= 0) return true;
  if (p.indexOf(OCR_PREFIX) === 0) return true;
  if (DRIVE_ASSETS.indexOf(p) >= 0) return true;
  return false;
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
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE && k.indexOf('drive-offline-') === 0) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   /* 跨網域一律放行 */
  if (!inScope(url)) return;                          /* 其他頁面一律放行 */

  e.respondWith(
    caches.open(CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) {
          /* 背景更新，讓下次拿到新版；離線時必然失敗，忽略即可。 */
          fetch(req).then(function (res) {
            if (res && res.ok) c.put(req, res.clone());
          }).catch(function () {});
          return hit;
        }
        return fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
          return res;
        }).catch(function () {
          /* 離線且沒快取：導覽請求就回頁面快取，其餘讓它失敗。 */
          if (req.mode === 'navigate') {
            return c.match(PAGE_URLS[0], { ignoreSearch: true }).then(function (p) {
              return p || Response.error();
            });
          }
          return Response.error();
        });
      });
    })
  );
});
