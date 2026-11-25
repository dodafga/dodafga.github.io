/*!
 * core.js — 全站共用小工具（零依賴）
 *
 * 目的：把原本在 6～7 個頁面各自複製一份的小函式收斂到一處，
 *       並集中管理「魔術數字」（長邊上限、紀錄上限、偵測寬度…）。
 *
 * 相容性：全部 ES5 語法（var / function），不使用 arrow、const、optional chaining，
 *         以維持原本 Safari 舊版與手機瀏覽器的可用性。
 *
 * 瀏覽器：window.Core
 */
(function (global) {
  'use strict';

  /* ================= 集中管理的常數（原本散落各頁的魔術數字） ================= */

  var LIMITS = {
    /* 相片處理 */
    MAX_EDGE: 2000,          /* 上傳長邊上限（px） */
    PREVIEW_EDGE: 720,       /* 預覽長邊上限（px）——只需顯示用，不必算到 2000 */
    JPEG_QUALITY: 0.88,      /* 預覽用 JPEG 品質 */

    /* 浮水印偵測 */
    DETECT_WIDTH: 480,       /* 偵測時把圖縮到這個寬度再掃（固定成本） */
    DETECT_MAX_GLYPHS: 400,  /* 參與「字元分群」的最大元件數（避免 O(n²) 爆炸） */
    DETECT_MAX_COMPONENTS: 4000, /* 連通元件總數上限（保護記憶體） */

    /* 資料量 */
    HISTORY_LIMIT: 800,      /* 已上傳紀錄本機保留上限 */
    THUMB_CACHE: 60,         /* 相片挑選縮圖快取上限（張） */

    /* Drive 匯入 */
    IMPORT_MAX_PAGES: 20,    /* 每批查詢最多 20 頁 × 1000 筆 */
    RETRY_TIMES: 2,          /* 暫時性失敗重試次數 */
    RETRY_DELAY: 600,        /* 重試基礎延遲（ms，逐次加倍） */

    /* UI */
    TOAST_MS: 3200,
    CONN_POLL_MS: 60000,     /* 權杖狀態檢查間隔 */
    TOKEN_WARN_MS: 300000    /* 剩餘 5 分鐘即提前續期 */
  };

  /* ================= 日期 ================= */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /** 本機今天 yyyy-mm-dd（不用 toISOString，避免時區位移） */
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** yyyy-mm-dd → yyyy/mm/dd */
  function isoToSlash(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    return p[0] + '/' + p[1] + '/' + p[2];
  }

  /** yyyy-mm-dd → 民國 115.10.05 */
  function rocDot(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return String(iso);
    var y = parseInt(p[0], 10);
    if (isNaN(y)) return String(iso);
    var m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    return (y - 1911) + '.' + pad2(m) + '.' + pad2(d);
  }

  /** 現在時間戳 yyyymmdd_hhmm（下載檔名用） */
  function stampNow() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  /** 現在時間 hhmmss（檔名序號備援） */
  function hhmmss() {
    var d = new Date();
    return pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  /* ================= 字串 / HTML ================= */

  /** HTML escape（含單引號，屬性值也安全） */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /**
   * 只允許安全的連結：http / https / 相對路徑。
   * 擋掉 javascript:、data:、vbscript: 等（避免 JSON 匯入或舊資料夾帶惡意連結）。
   */
  function safeUrl(u, fallback) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return fallback || '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return fallback || '';  /* 其他 scheme 一律拒絕 */
    return s;                                                    /* 相對路徑／#hash 允許 */
  }

  /** 只允許 data:image/*（給 dataURL 縮圖用） */
  function safeDataUrl(u, fallback) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return fallback || '';
    if (/^data:image\//i.test(s)) return s;
    if (/^https?:\/\//i.test(s) || /^blob:/i.test(s)) return s;
    return fallback || '';
  }

  /** 檔名淨化（去非法字元、空白轉 -、長度上限） */
  function safeName(s, max) {
    return String(s || '').trim()
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, max || 40);
  }

  /** 位元組 → 人類可讀 */
  function fmtSize(b) {
    if (!b || b < 0) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ================= 數值 ================= */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ================= 時間工具 ================= */

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms || 150);
    };
  }

  /** 合併同一輪事件內的多個呼叫（下一個 tick 只跑一次） */
  function coalesce(fn) {
    var queued = false, self = null, args = null;
    return function () {
      self = this; args = arguments;
      if (queued) return;
      queued = true;
      var run = function () { queued = false; fn.apply(self, args); };
      if (typeof Promise !== 'undefined') Promise.resolve().then(run);
      else setTimeout(run, 0);
    };
  }

  /* ================= Toast ================= */

  /**
   * 產生一個 toast(msg, isErr) 函式。
   * 原本 6 個頁面各自實作一份（有的用 className、有的用 classList、時間還不一樣），
   * 這裡統一成同一份；時間長度由呼叫端指定，維持各頁原感。
   *
   * @param {string|Element} target 元素或 id
   * @param {number} ms 顯示毫秒
   */
  function makeToast(target, ms) {
    var timer = null;
    var dur = ms || LIMITS.TOAST_MS;
    return function (msg, isErr) {
      var el = (typeof target === 'string') ? document.getElementById(target) : target;
      if (!el) return;
      el.textContent = msg;
      el.className = 'toast show' + (isErr ? ' err' : '');
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { el.className = 'toast'; }, dur);
    };
  }

  /* ================= localStorage（含容量保護） ================= */

  var store = {
    get: function (k, dflt) {
      try {
        var v = localStorage.getItem(k);
        return v == null ? (dflt === undefined ? '' : dflt) : v;
      } catch (e) { return dflt === undefined ? '' : dflt; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
    },
    remove: function (k) {
      try { localStorage.removeItem(k); return true; } catch (e) { return false; }
    },
    /** 讀 JSON；格式錯誤回傳 dflt（並清掉壞資料，避免每次載入都失敗） */
    getJSON: function (k, dflt) {
      var raw = store.get(k, '');
      if (!raw) return dflt;
      try { return JSON.parse(raw); } catch (e) { store.remove(k); return dflt; }
    },
    setJSON: function (k, obj) {
      try { return store.set(k, JSON.stringify(obj)); } catch (e) { return false; }
    }
  };

  /* ================= 下載 ================= */

  /** 觸發瀏覽器下載（文字或 Blob） */
  function download(filename, content, mime) {
    var blob = (content instanceof Blob)
      ? content
      : new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 4000);
  }

  /* ================= DOM ================= */

  function $(id) { return document.getElementById(id); }

  /**
   * 安全取元素：缺少元素時回傳 null，不讓整支程式在 addEventListener 就爆掉。
   * （原本各頁直接 $('x').addEventListener，一旦 HTML 改動就會整頁白屏）
   */
  function on(el, ev, fn, opts) {
    if (!el) return false;
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el || !el.addEventListener) return false;
    el.addEventListener(ev, fn, opts);
    return true;
  }

  /** NodeList → 真陣列（舊 Safari 的 NodeList 沒有 forEach） */
  function toArray(list) {
    var out = [], i;
    if (!list) return out;
    for (i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  global.Core = {
    LIMITS: LIMITS,
    pad2: pad2,
    todayISO: todayISO,
    isoToSlash: isoToSlash,
    rocDot: rocDot,
    stampNow: stampNow,
    hhmmss: hhmmss,
    esc: esc,
    safeUrl: safeUrl,
    safeDataUrl: safeDataUrl,
    safeName: safeName,
    fmtSize: fmtSize,
    clamp: clamp,
    debounce: debounce,
    coalesce: coalesce,
    makeToast: makeToast,
    store: store,
    download: download,
    $: $,
    on: on,
    toArray: toArray
  };
})(typeof window !== 'undefined' ? window : this);

/* ===== 樁號修正 / 材料岸別歸類：自動掛載（drive/ 與 progress/） =====
   由 core.js 統一載入，避免改動各頁 HTML。
   只在查驗助手（drive/、progress/）生效，營造助手（build/）不會載入。 */
(function (global) {
  'use strict';
  var path = String((global.location && global.location.pathname) || '');
  var isDrive = /\/drive\//.test(path);
  var isProgress = /\/progress\//.test(path);
  if (!isDrive && !isProgress) return;

  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { try { cb(); } catch (e) { console.error(e); } };
    s.onerror = function () { console.error('[core] 載入失敗', src); };
    document.head.appendChild(s);
  }

  function makeCard(title, tagText, mountId) {
    var card = document.createElement('div');
    card.className = 'card';
    card.id = mountId + 'Card';
    var hd = document.createElement('div');
    hd.className = 'cardhd';
    var h2 = document.createElement('h2');
    h2.textContent = title;
    hd.appendChild(h2);
    if (tagText) {
      var tg = document.createElement('span');
      tg.className = 'hintx';
      tg.textContent = tagText;
      hd.appendChild(tg);
    }
    var bd = document.createElement('div');
    var mount = document.createElement('div');
    mount.id = mountId;
    bd.appendChild(mount);
    card.appendChild(hd);
    card.appendChild(bd);
    return card;
  }

  function insertAfterCloudCard(card) {
    var cloud = document.getElementById('cloudCard') || document.getElementById('cdbMount');
    if (cloud && cloud.parentNode) {
      var anchor = cloud.id === 'cloudCard' ? cloud : cloud.closest('.card');
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(card, anchor.nextSibling);
        return true;
      }
    }
    var main = document.querySelector('main');
    if (main) { main.appendChild(card); return true; }
    return false;
  }

  function boot() {
    /* 樁號修正 */
    if (!document.getElementById('pfxMount')) {
      var c1 = makeCard('樁號修正', '樁號記錯可改', 'pfxMount');
      insertAfterCloudCard(c1);
    }
    loadScript('../assets/pile-fix.js', function () {
      if (global.PileFix && document.getElementById('pfxMount')) {
        global.PileFix.mount(document.getElementById('pfxMount'));
      }
    });

    /* 材料岸別歸類（只有資料進度頁有材料管控） */
    if (isProgress) {
      if (!document.getElementById('msideMount')) {
        var stats = document.getElementById('matStats');
        if (stats && stats.parentNode) {
          var wrap = document.createElement('div');
          wrap.style.margin = '10px 0 0';
          var m = document.createElement('div');
          m.id = 'msideMount';
          wrap.appendChild(m);
          stats.parentNode.insertBefore(wrap, stats.nextSibling);
        }
      }
      loadScript('../assets/mat-side.js', function () {
        if (!global.MatSide) return;
        try { global.MatSide.autoRunOnce(); } catch (e) { console.error('[mside]', e); }
        if (document.getElementById('msideMount')) {
          global.MatSide.mount(document.getElementById('msideMount'));
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})(typeof window !== 'undefined' ? window : this);
