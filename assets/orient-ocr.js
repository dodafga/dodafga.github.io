/*!
 * orient-ocr.js — 查驗單照片 OCR 方向判斷（本輪未完成上線，保留安全空模組）
 *
 * 狀態說明（2026-11-14）：
 *   此檔在本次執行中僅推入了佔位內容，正式版本尚未完成驗證與部署，
 *   因此改為「安全空模組」：即使被任何頁面引用，也不會拋錯、不會影響既有功能。
 *   detect() 一律回傳 {ok:false}，呼叫端會退回「請使用者自行確認方向」。
 *
 * 目前 /drive/ 頁面【沒有】引用本檔，網站行為與上一版完全相同。
 */
(function (global) {
  'use strict';
  global.PhotoOrientOCR = {
    detect: function () {
      return Promise.resolve({ angle: 0, ok: false, reason: 'not-deployed', keys: 0 });
    },
    warmup: function () { return Promise.resolve(null); },
    isAvailable: function () { return false; },
    reset: function () {},
    VERSION: '0.0.0-stub'
  };
})(typeof window !== 'undefined' ? window : this);
