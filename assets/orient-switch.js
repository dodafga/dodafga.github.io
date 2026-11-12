/*
 * orient-switch.js — 「文字方向自動轉正」開關（僅 /drive/ 載入）
 *
 * 設計原則：零侵入。完全不修改 watermark.js / gdrive-photo.js / drive-page.js。
 *   - 載入後把 window.PhotoOrient.detect 包一層：
 *       開關「關」時 → 直接回傳 angle:0（不偵測、不旋轉、原樣輸出）
 *       開關「開」時 → 原封不動呼叫原本的 detect（四步判別照舊）
 *   - 因此 Drive 頁面的預覽與上傳（兩者都經 watermark.render()）同時生效，
 *     不會出現「預覽轉了、上傳沒轉」或相反的不一致。
 *   - 其他頁面（/、/form/、/photo/、/log/、/progress/、/settings/）不載入此檔，
 *     detect 保持原樣，行為與登錄格式完全不變。
 *   - 狀態存 localStorage（inspection-drive-photo-autoorient：'1' 開、'0' 關，預設開）。
 *   - 任何例外都吞掉，最壞情況退回「保持原樣」。
 */
(function (global) {
  'use strict';

  var KEY = 'inspection-drive-photo-autoorient';
  var ON = true;
  var patched = false;
  var origDetect = null;

  function $(id) { return global.document ? global.document.getElementById(id) : null; }

  function load() {
    try {
      var v = global.localStorage ? global.localStorage.getItem(KEY) : null;
      if (v === '0') ON = false;
      else if (v === '1') ON = true;
    } catch (e) { /* 無痕模式／被封鎖 → 保持預設開啟 */ }
  }

  function save() {
    try {
      if (global.localStorage) global.localStorage.setItem(KEY, ON ? '1' : '0');
    } catch (e) { /* 寫不進去不影響本次瀏覽 */ }
  }

  /* 關閉時回傳的「不旋轉」結果；欄位與 detect() 一致，避免呼叫端取不到值 */
  function offResult() {
    return {
      angle: 0, confidence: 0, reason: 'switch-off',
      axis: 0, glyphs: 0, dateScore: 0,
      layout: 0, layoutRows: 0, dateRank: -1,
      cent: 0, flat: 0, votes: 0
    };
  }

  /**
   * 包一層 detect。以 window.PhotoOrient 為主；若它較晚載入，
   * 用 defineProperty 攔截賦值，載入當下立刻補包。
   */
  function patch() {
    if (patched) return true;
    var PO = global.PhotoOrient;
    if (!PO || typeof PO.detect !== 'function') return false;

    origDetect = PO.detect;
    PO.detect = function (imgEl, srcW, srcH) {
      if (!ON) return offResult();
      try {
        return origDetect.call(PO, imgEl, srcW, srcH);
      } catch (e) {
        /* 偵測本身出錯 → 視為判不出方向，保持原樣 */
        return offResult();
      }
    };
    patched = true;
    return true;
  }

  function watchPhotoOrient() {
    if (patch()) return;
    /* PhotoOrient 尚未定義 → 攔截它的賦值，一出現就補包 */
    try {
      var desc = Object.getOwnPropertyDescriptor(global, 'PhotoOrient');
      if (!desc || desc.configurable) {
        var holder = global.PhotoOrient;
        Object.defineProperty(global, 'PhotoOrient', {
          configurable: true,
          enumerable: true,
          get: function () { return holder; },
          set: function (v) {
            holder = v;
            patched = false;
            patch();
          }
        });
      }
    } catch (e) { /* 無法攔截就等 init 再試 */ }
  }

  function isOn() { return ON; }

  function syncUI() {
    var chk = $('chkOrient');
    /* 未存過任何值時，首次進入即預設「開啟」 */
    if (chk && chk.checked !== ON) chk.checked = ON;
    var st = $('orientState');
    if (st) st.textContent = ON ? '開啟' : '關閉';
  }

  function toast(msg) {
    var box = $('toast');
    if (!box) return;
    box.textContent = msg;
    box.className = 'toast on';
    setTimeout(function () { box.className = 'toast'; }, 2200);
  }

  /* 切換後重畫目前那張預覽（等同按「重新預覽」） */
  function refreshPreview() {
    var b = $('btnPrevRefresh');
    if (b) { try { b.click(); } catch (e) {} }
  }

  function setOn(v, silent) {
    ON = !!v;
    save();
    syncUI();
    if (!silent) refreshPreview();
    return ON;
  }

  function bind() {
    var chk = $('chkOrient');
    if (!chk) return;
    chk.addEventListener('change', function () {
      var on = setOn(this.checked, true);
      refreshPreview();
      toast(on
        ? '已開啟文字方向自動轉正'
        : '已關閉自動轉正（照片不做方向偵測、原樣上傳）');
    });
  }

  function init() {
    load();
    watchPhotoOrient();
    patch();
    bind();
    syncUI();
  }

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  } else {
    load();
    watchPhotoOrient();
  }

  global.PhotoOrientSwitch = {
    isOn: isOn,
    setOn: setOn,
    init: init
  };

})(typeof window !== 'undefined' ? window : this);
