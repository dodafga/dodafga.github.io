/* supabase-sync.js — 全站資料雲端同步（Supabase）
 *
 * 讓手機與電腦看到同一份資料。
 *
 * 做法：既有模組照舊讀寫 localStorage，本模組在 localStorage 這一層攔截，
 *       寫入即推上雲端、載入即從雲端拉回。因此不必改動任何既有模組。
 *
 * 雲端為主、本機為離線快取：
 *   讀 → 先回本機（畫面立刻出來），雲端回來後若較新就覆蓋並通知頁面重繪
 *   寫 → 立刻寫本機（離線可用），同時推上雲端
 *
 * 首次載入把本機既有資料一次性 upsert 上傳（以 key 去重，不覆蓋雲端較新資料）。
 * 只同步使用者資料，絕不同步 Google 授權權杖等裝置專屬資料。
 * 尊重 build-sep.js 的資料隔離：營造頁只同步 build-assistant-*，查驗頁只同步 inspection-*。
 *
 * 資料表：public.app_state (key text primary key, value jsonb, updated_at timestamptz)
 */
(function (global) {
  'use strict';

  var URL_BASE = 'https://ohwrzcrmdmqnxbxjfuus.supabase.co';
  var KEY = 'sb_publishable_QRBZ59wj7F4iTJTCraJzHQ_SvL8AbMv';
  var TABLE = 'app_state';

  var PATH = String((global.location && global.location.pathname) || '');
  var IS_BUILD = /\/build\//.test(PATH);
  var PREFIXES = IS_BUILD ? ['build-assistant-'] : ['inspection-'];

  /* 裝置專屬／中繼資料：即使前綴符合也絕不同步 */
  var SKIP = [
    'inspection-gdrive-', 'build-gdrive-',
    'inspection-cloud-last-backup',
    'build-assistant-cloud-fileid', 'build-assistant-cloud-last-backup',
    'inspection-drive-photo-autoorient',
    'inspection-mat-side-migrated-v1', 'inspection-mat-side-snapshot',
    'inspection-pile-rename-snapshot', 'build-snapshot-local',
    'inspection-supabase-', 'build-assistant-supabase-'
  ];

  function isSyncKey(k) {
    var s = String(k == null ? '' : k);
    if (!s) return false;
    for (var i = 0; i < SKIP.length; i++) if (s.indexOf(SKIP[i]) === 0) return false;
    for (var j = 0; j < PREFIXES.length; j++) if (s.indexOf(PREFIXES[j]) === 0) return true;
    return false;
  }

  var META_LWW = 'inspection-supabase-lww';
  var META_SEEDED = 'inspection-supabase-seeded';

  var state = { ready: false, online: true, lastError: '', lastPull: '', lastPush: '', pending: 0, seeded: false };
  var listeners = [];

  function emit(evt, detail) {
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](evt, detail); } catch (e) {} }
    try { global.dispatchEvent(new CustomEvent('supabase-sync', { detail: { evt: evt, info: detail } })); } catch (e) {}
  }

  /* 原始 localStorage（繞過 build-sep.js 的遮罩） */
  var proto = null;
  try { proto = global.Storage && global.Storage.prototype; } catch (e) { proto = null; }
  var _get = proto ? proto.getItem : null;
  var _set = proto ? proto.setItem : null;

  function rawGet(k) {
    try { return _get ? _get.call(global.localStorage, k) : global.localStorage.getItem(k); } catch (e) { return null; }
  }
  function rawSet(k, v) {
    try { if (_set) { _set.call(global.localStorage, k, v); } else { global.localStorage.setItem(k, v); } return true; } catch (e) { return false; }
  }

  /* 本機最後寫入時間（衝突解析用） */
  function lwwRead() {
    var raw = rawGet(META_LWW);
    if (!raw) return {};
    try { var o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }
  function lwwWrite(m) { try { rawSet(META_LWW, JSON.stringify(m)); } catch (e) {} }
  function lwwTouch(k) { var m = lwwRead(); m[k] = new Date().toISOString(); lwwWrite(m); }
  function lwwGet(k) { return lwwRead()[k] || ''; }

  function api(path, opts) {
    opts = opts || {};
    var h = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
    if (opts.headers) { for (var k in opts.headers) { if (opts.headers.hasOwnProperty(k)) h[k] = opts.headers[k]; } }
    var init = { method: opts.method || 'GET', headers: h, cache: 'no-store' };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(URL_BASE + '/rest/v1/' + path, init).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + String(t || '').slice(0, 200)); });
      }
      if (r.status === 204) return null;
      return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
    });
  }

  /* localStorage 一律存字串；雲端 value 存 jsonb。
     為完整還原（純字串／數字／JSON），統一存成 {t:'s'|'j', v:...} */
  function encode(raw) {
    if (raw == null) return null;
    var s = String(raw), t = s.replace(/^\s+/, '');
    if (t && (t.charAt(0) === '{' || t.charAt(0) === '[')) {
      try { return { t: 'j', v: JSON.parse(s) }; } catch (e) {}
    }
    return { t: 's', v: s };
  }
  function decode(val) {
    if (val == null) return null;
    if (typeof val === 'object' && val.t) {
      if (val.t === 'j') { try { return JSON.stringify(val.v); } catch (e) { return null; } }
      return String(val.v == null ? '' : val.v);
    }
    if (typeof val === 'string') return val;
    try { return JSON.stringify(val); } catch (e) { return null; }
  }

  /* 既有頁面只監聽 window 的 storage 事件，而同頁寫入不會觸發它。
     這裡替每個變更的鍵補送一個 StorageEvent，讓頁面自己重繪。 */
  function fireStorageEvent(key) {
    try {
      var ev;
      try {
        ev = new StorageEvent('storage', {
          key: key, newValue: rawGet(key), oldValue: null,
          url: String((global.location && global.location.href) || '')
        });
      } catch (e) {
        ev = global.document.createEvent('Event');
        ev.initEvent('storage', false, false);
        ev.key = key; ev.newValue = rawGet(key); ev.oldValue = null;
      }
      global.dispatchEvent(ev);
    } catch (e) {}
  }

  function localKeys() {
    var out = [], ls = global.localStorage;
    if (!ls) return out;
    try {
      for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k && isSyncKey(k)) out.push(k); }
    } catch (e) {}
    return out;
  }

  /* 雲端拉取（含衝突解析） */
  function pull() {
    return api(TABLE + '?select=key,value,updated_at&order=updated_at.asc', { method: 'GET' })
      .then(function (rows) {
        rows = rows || [];
        var changed = [], toPush = [], cloudKeys = {};
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (!r || !isSyncKey(r.key)) continue;
          cloudKeys[r.key] = 1;
          var incoming = decode(r.value);
          if (incoming == null) continue;
          var cur = rawGet(r.key);
          if (cur === incoming) continue;
          /* 本機有未推送的較新編輯 → 保留本機，改推上去 */
          var localAt = lwwGet(r.key), cloudAt = String(r.updated_at || '');
          if (cur != null && localAt && cloudAt && localAt > cloudAt) { toPush.push(r.key); continue; }
          if (rawSet(r.key, incoming)) changed.push(r.key);
        }
        state.ready = true; state.online = true; state.lastError = '';
        state.lastPull = new Date().toISOString();
        emit('pull', { changed: changed, count: rows.length });
        for (var ci = 0; ci < changed.length; ci++) fireStorageEvent(changed[ci]);
        if (toPush.length) pushKeys(toPush);
        return { changed: changed, cloudKeys: cloudKeys };
      })
      .catch(function (e) {
        state.online = false;
        state.lastError = String((e && e.message) || e);
        emit('error', { where: 'pull', message: state.lastError });
        return { changed: [], cloudKeys: null };
      });
  }

  /* 雲端推送（upsert，以 key 去重） */
  function pushKeys(keys) {
    keys = (keys || []).filter(isSyncKey);
    if (!keys.length) return Promise.resolve(0);
    var rows = [];
    for (var i = 0; i < keys.length; i++) {
      var raw = rawGet(keys[i]);
      if (raw == null) continue;
      rows.push({ key: keys[i], value: encode(raw), updated_at: new Date().toISOString() });
    }
    if (!rows.length) return Promise.resolve(0);
    state.pending += rows.length;
    return api(TABLE + '?on_conflict=key', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: rows
    }).then(function () {
      state.pending = Math.max(0, state.pending - rows.length);
      state.online = true; state.lastError = '';
      state.lastPush = new Date().toISOString();
      emit('push', { count: rows.length });
      return rows.length;
    }).catch(function (e) {
      state.pending = Math.max(0, state.pending - rows.length);
      state.online = false;
      state.lastError = String((e && e.message) || e);
      emit('error', { where: 'push', message: state.lastError });
      return 0;
    });
  }

  /* 首次：只在「雲端完全沒有這個鍵」時才上傳，避免蓋掉另一台裝置較新的資料 */
  function seed(cloudKeys) {
    var keys = localKeys();
    if (!keys.length) { rawSet(META_SEEDED, '1'); state.seeded = true; return Promise.resolve(0); }
    var fresh = keys.filter(function (k) { return !cloudKeys || !cloudKeys[k]; });
    if (!fresh.length) { rawSet(META_SEEDED, '1'); state.seeded = true; return Promise.resolve(0); }
    return pushKeys(fresh).then(function (n) {
      if (n > 0) { rawSet(META_SEEDED, '1'); state.seeded = true; }
      emit('seed', { count: n });
      return n;
    });
  }

  /* 攔截 localStorage 寫入 */
  var pushTimer = null, dirty = {};

  function schedulePush(key) {
    dirty[key] = 1;
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      var keys = Object.keys(dirty);
      dirty = {};
      pushKeys(keys);
    }, 400);
  }

  function installHooks() {
    if (!proto || proto.__supabaseSync) return;
    proto.__supabaseSync = true;
    var origSet = proto.setItem, origRemove = proto.removeItem;

    proto.setItem = function (k, v) {
      var r = origSet.call(this, k, v);
      try { if (isSyncKey(k)) { lwwTouch(String(k)); schedulePush(String(k)); } } catch (e) {}
      return r;
    };

    proto.removeItem = function (k) {
      var r = origRemove.call(this, k);
      try {
        if (isSyncKey(k)) {
          /* 本機刪除 → 雲端也刪，否則下次拉取會復活 */
          var m = lwwRead(); delete m[String(k)]; lwwWrite(m);
          api(TABLE + '?key=eq.' + encodeURIComponent(String(k)), { method: 'DELETE' }).catch(function () {});
        }
      } catch (e) {}
      return r;
    };
  }

  /* 跨裝置：20 秒輪詢 + 回到前景即拉取 */
  var POLL_MS = 20000, pollTimer = null;

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (global.document && global.document.hidden) return;
      pull();
    }, POLL_MS);
  }
  function onVisible() {
    if (!global.document || global.document.hidden) return;
    pull();
  }

  function info() {
    return {
      ready: state.ready, online: state.online, seeded: state.seeded,
      lastError: state.lastError, lastPull: state.lastPull, lastPush: state.lastPush,
      pending: state.pending, localKeys: localKeys().length,
      scope: IS_BUILD ? 'build' : 'inspection', url: URL_BASE
    };
  }

  function init() {
    installHooks();
    var first = pull().then(function (res) {
      return seed(res && res.cloudKeys);
    }).then(function () {
      state.ready = true;
      emit('ready', { info: info() });
      return info();
    });
    startPolling();
    try {
      global.addEventListener('online', function () { pull(); });
      global.addEventListener('focus', onVisible);
      global.addEventListener('pageshow', onVisible);
      if (global.document) global.document.addEventListener('visibilitychange', onVisible);
    } catch (e) {}
    return first;
  }

  function syncNow() {
    return pull().then(function (res) { return seed(res && res.cloudKeys); }).then(function () { return info(); });
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  global.SupabaseSync = {
    init: init, pull: pull, push: pushKeys, seed: seed, syncNow: syncNow,
    info: info, onChange: onChange, isSyncKey: isSyncKey, URL: URL_BASE
  };

  function autoStart() {
    try { init(); } catch (e) { state.lastError = String((e && e.message) || e); }
  }
  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', autoStart);
  } else {
    autoStart();
  }
})(typeof window !== 'undefined' ? window : this);

