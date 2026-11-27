/* build-sep.js — 營造助手資料隔離（與查驗助手完全分開）
 *
 * 這個檔案必須在 gdrive.js 之前載入（見 build/index.html）。
 *
 * 做四件事：
 *   1. Google 授權／權杖改用 build-gdrive-* 命名空間，不再讀寫 inspection-gdrive-*。
 *      首次載入時若 build 端沒有權杖、而舊的 inspection-gdrive-token 還在，
 *      會「一次性」複製過來，讓你不必重新登入；之後兩邊各自獨立。
 *   2. 遮蔽所有 inspection-* 資料：營造頁讀到的一律是空值，也寫不進去。
 *      → 查驗的當日已做、已上傳記錄、樁位資料、材料…等，在營造頁完全看不到。
 *      → 只「遮住」，不刪除、不修改；查驗助手本身完全不受影響。
 *   3. 查驗專用模組（daily-flow 等）若被載入，立刻移除。
 *   4. 查驗專屬元素若出現在營造頁，立刻移除；並在文字層移除任何「當日已做」字樣。
 */
(function (global) {
  'use strict';

  var IS_BUILD = /\/build\//.test(String((global.location && global.location.pathname) || ''));
  if (!IS_BUILD) return;

  var AUTH_PREFIX = 'inspection-gdrive-';
  var AUTH_TO = 'build-gdrive-';
  var DATA_PREFIX = 'inspection-';

  var proto = null;
  try { proto = global.Storage && global.Storage.prototype; } catch (e) { proto = null; }
  if (!proto || proto.__buildSep) return;

  var _get = proto.getItem, _set = proto.setItem, _rm = proto.removeItem;

  /* ---------- 1. 授權鍵改名（inspection-gdrive-* → build-gdrive-*） ---------- */
  function mapAuth(k) {
    var s = String(k == null ? '' : k);
    if (s.indexOf(AUTH_PREFIX) === 0) return AUTH_TO + s.slice(AUTH_PREFIX.length);
    return s;
  }

  /* 一次性把舊權杖搬過來（只複製，不動原本的鍵） */
  try {
    var seedKeys = ['clientid', 'token', 'signedout', 'fileid', 'lastsync'];
    for (var si = 0; si < seedKeys.length; si++) {
      var oldK = AUTH_PREFIX + seedKeys[si];
      var newK = AUTH_TO + seedKeys[si];
      if (_get.call(global.localStorage, newK) == null) {
        var v = _get.call(global.localStorage, oldK);
        if (v != null) _set.call(global.localStorage, newK, v);
      }
    }
  } catch (e) {}

  var blockedReads = {};

  proto.getItem = function (k) {
    var name = String(k == null ? '' : k);
    /* 授權鍵：轉到 build 命名空間 */
    if (name.indexOf(AUTH_PREFIX) === 0) {
      return _get.call(this, mapAuth(name));
    }
    /* 查驗資料：一律遮蔽 */
    if (name.indexOf(DATA_PREFIX) === 0) {
      blockedReads[name] = (blockedReads[name] || 0) + 1;
      return null;
    }
    return _get.call(this, k);
  };

  proto.setItem = function (k, v) {
    var name = String(k == null ? '' : k);
    if (name.indexOf(AUTH_PREFIX) === 0) {
      return _set.call(this, mapAuth(name), v);
    }
    if (name.indexOf(DATA_PREFIX) === 0) {
      return undefined;                 /* 不讓營造頁寫進查驗命名空間 */
    }
    return _set.call(this, k, v);
  };

  proto.removeItem = function (k) {
    var name = String(k == null ? '' : k);
    if (name.indexOf(AUTH_PREFIX) === 0) {
      return _rm.call(this, mapAuth(name));
    }
    if (name.indexOf(DATA_PREFIX) === 0) {
      return undefined;
    }
    return _rm.call(this, k);
  };

  proto.__buildSep = true;

  /* ---------- 3. 查驗專用模組封鎖 ---------- */
  var BLOCKED = ['daily-flow', 'cloud-db', 'pile-measure', 'store', 'drive-page',
    'drive-v2', 'drive-lib', 'batch-del', 'orient-switch', 'orient-ocr'];

  function blockName(src) {
    var s = String(src || '');
    for (var i = 0; i < BLOCKED.length; i++) {
      if (new RegExp('/' + BLOCKED[i] + '\\.js(\\?|$)', 'i').test(s)) return BLOCKED[i];
    }
    return '';
  }

  function killScripts(root) {
    var scope = (root && root.querySelectorAll) ? root : document;
    var ss;
    try { ss = scope.querySelectorAll('script[src]'); } catch (e) { return; }
    for (var i = 0; i < ss.length; i++) {
      if (blockName(ss[i].getAttribute('src'))) {
        try { ss[i].parentNode.removeChild(ss[i]); } catch (e) {}
      }
    }
  }

  /* ---------- 4. 查驗專屬元素移除 ---------- */
  var SEL = ['#p-check', '#p-daily', '#dailyFlow', '#dfChips', '#dfCur', '#dfLock',
    '#dfrBody', '[data-app="inspection"]', '[data-inspection="1"]',
    '.chk-only', '.inspection-only'].join(',');

  function scrub(root) {
    var scope = (root && root.querySelectorAll) ? root : document;
    try {
      var bad = scope.querySelectorAll(SEL);
      for (var i = 0; i < bad.length; i++) {
        try { bad[i].parentNode.removeChild(bad[i]); } catch (e) {}
      }
    } catch (e) {}
    /* 文字層保險：任何殘留「當日已做」字樣的節點一律移除（含動態插入） */
    try { scrubText(scope); } catch (e) {}
  }

  /* 掃描文字節點，把含「當日已做」的最外層可移除容器拿掉 */
  var BAD_TEXT = '當日已做';
  function scrubText(scope) {
    if (!scope || !scope.querySelectorAll) return;
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null, false);
    var hits = [], n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.indexOf(BAD_TEXT) >= 0) hits.push(n);
    }
    for (var i = 0; i < hits.length; i++) {
      var el = hits[i].parentNode;
      /* 往上找一個「區塊級」容器再移除，避免只刪掉文字留下空殼 */
      var target = el;
      for (var up = 0; up < 4 && target && target.parentNode && target.parentNode !== document.body; up++) {
        if (target.id === 'dfChips' || target.id === 'dfCur' || target.id === 'dfLock' ||
            target.classList && (target.classList.contains('dfchips') || target.classList.contains('card'))) break;
        target = target.parentNode;
      }
      if (target && target.parentNode) {
        try { target.parentNode.removeChild(target); } catch (e) {}
      }
    }
  }

  function boot() {
    killScripts(document);
    scrub(document);
    if (!global.MutationObserver) return;
    try {
      /* 修正（卡死）：這個 observer 會同步 scrub 整個 document。
       * 若被觀察範圍內的節點又被其他模組（例如備份時間文字）反覆改寫，
       * 就會形成「改寫 → scrub → 改寫」的無限迴圈把主執行緒鎖死。
       * 這裡加兩道保險：① 重入保護；② 只處理「新增節點」，
       * 忽略純文字變更（characterData），避免自己觸發自己。 */
      var _busy = false;
      var mo = new MutationObserver(function (recs) {
        if (_busy) return;
        _busy = true;
        try {
          for (var i = 0; i < recs.length; i++) {
            var added = recs[i].addedNodes;
            for (var j = 0; j < added.length; j++) {
              var n = added[j];
              if (!n || n.nodeType !== 1) continue;
              if (n.tagName === 'SCRIPT') {
                if (blockName(n.getAttribute('src'))) {
                  try { n.parentNode.removeChild(n); } catch (e) {}
                }
                continue;
              }
              killScripts(n);
              scrub(n);
              if (n.matches && n.matches(SEL)) {
                try { n.parentNode.removeChild(n); } catch (e) {}
              }
            }
          }
        } finally { _busy = false; }
      });
      mo.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
  global.addEventListener('load', boot);

  /* ---------- 5. 「從雲端載入」前自動備份本機、可還原 ---------- */
  var SNAP_KEY = 'build-snapshot-local';   /* 刻意不用 build-assistant- 前綴，才不會被備份／清空 */

  function lsGet(k) { try { var v = _get.call(global.localStorage, k); return v == null ? '' : v; } catch (e) { return ''; } }
  function lsSet(k, v) { try { _set.call(global.localStorage, k, v); return true; } catch (e) { return false; } }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function getSnap() {
    var raw = lsGet(SNAP_KEY);
    if (!raw) return null;
    try {
      var o = JSON.parse(raw);
      return (o && o.data) ? o : null;
    } catch (e) { return null; }
  }

  function snapText() {
    var s = getSnap();
    if (!s) return '尚無載入前的本機備份';
    return '本機備份：' + fmt(s.at);
  }

  function installSnapshot(BC) {
    if (!BC || BC.__snapWrapped) return;
    BC.__snapWrapped = true;

    var origLoad = BC.load;
    var origMount = BC.mount;

    function takeSnap() {
      try {
        var p = BC.collect ? BC.collect() : null;
        if (!p || !p.data) return null;
        var rec = { at: new Date().toISOString(), data: p.data };
        return lsSet(SNAP_KEY, JSON.stringify(rec)) ? rec : null;
      } catch (e) { return null; }
    }

    BC.load = function () {
      takeSnap();                        /* 先備份本機，再進行雲端載入 */
      return origLoad.apply(BC, arguments);
    };

    BC.restoreLocalSnapshot = function () {
      var s = getSnap();
      if (!s) return { ok: false, msg: '沒有可還原的本機備份' };
      try {
        var r = BC.apply({ data: s.data });
        if (!r) return { ok: false, msg: '本機備份內容無法還原' };
        return { ok: true, at: s.at };
      } catch (e) {
        return { ok: false, msg: (e && e.message) || '還原失敗' };
      }
    };

    BC.getLocalSnapshot = getSnap;
    BC.snapshotText = snapText;

    BC.mount = function (el) {
      var r = origMount.apply(BC, arguments);
      var node = (typeof el === 'string') ? document.getElementById(el) : el;
      if (!node || node.getAttribute('data-snap') === '1') return r;
      node.setAttribute('data-snap', '1');

      var box = document.createElement('div');
      box.className = 'bc-snapbox';
      box.innerHTML =
        '<div class="bcnote bc-last" id="bcSnapAt">' + snapText() + '</div>' +
        '<button type="button" class="btn ghost" id="bcRestore" style="width:100%;margin-top:8px">' +
        '↩ 還原載入前的本機資料</button>';
      node.appendChild(box);

      var atEl = box.querySelector('#bcSnapAt');
      var btn = box.querySelector('#bcRestore');

      /* 每次點「從雲端載入」都會更新備份時間，用 MutationObserver 追。
       *
       * 修正（白屏／卡死）：原本這裡還有一個 setInterval 每 2.5 秒寫 atEl.textContent，
       * 而 atEl 就在被觀察的 node 子樹裡 → 寫入觸發 observer → observer 又寫 → 無限迴圈，
       * 加上本檔上方 boot() 的 MutationObserver 會同步 scrub 整個 document，
       * 兩者互相觸發把主執行緒鎖死，/build/ 就整頁卡住（iPhone Safari 看起來像白屏）。
       * 現在：① 移除 setInterval；② observer 只在文字真的變了才寫；
       *       ③ 寫入時先 disconnect，寫完再 observe，避免自己觸發自己。 */
      try {
        var mo = new MutationObserver(function () {
          if (!atEl) return;
          var next = snapText();
          if (atEl.textContent === next) return;   /* 沒變就不寫，斷開迴圈 */
          try { mo.disconnect(); } catch (e) {}
          atEl.textContent = next;
          try { mo.observe(node, { childList: true, subtree: true, characterData: true }); } catch (e) {}
        });
        mo.observe(node, { childList: true, subtree: true, characterData: true });
      } catch (e) {}

      if (btn) btn.addEventListener('click', function () {
        var s = getSnap();
        if (!s) { alert('沒有可還原的本機備份。'); return; }
        if (!global.confirm('要把本機營造資料還原成 ' + fmt(s.at) + ' 的備份嗎？\n\n目前的機營造資料會被這份備份取代。')) return;
        var res = BC.restoreLocalSnapshot();
        if (!res.ok) { alert(res.msg); return; }
        alert('已還原 ' + fmt(res.at) + ' 的本機備份，頁面將重新整理。');
        setTimeout(function () { try { global.location.reload(); } catch (e) {} }, 500);
      });
      return r;
    };

    /* 樣式 */
    try {
      if (!document.getElementById('build-sep-style')) {
        var st = document.createElement('style');
        st.id = 'build-sep-style';
        st.textContent = '.bc-snapbox{margin-top:10px;padding-top:10px;border-top:1px dashed #E7ECF2}';
        document.head.appendChild(st);
      }
    } catch (e) {}
  }

  global.__buildSepInstallSnapshot = installSnapshot;

  global.BuildSep = {
    isBuild: true,
    blockedModules: function () { return BLOCKED.slice(); },
    blockedReads: function () { return blockedReads; },
    authNamespace: AUTH_TO,
    scrub: function () { scrub(document); killScripts(document); },
    scrubText: function () { scrubText(document); }
  };
})(typeof window !== 'undefined' ? window : this);
