/*!
 * gdrive.js — Google Drive 純前端儲存（Google Identity Services + Drive API v3）
 *
 * 設計：
 *   - 不需要後端。使用 GIS token model（OAuth 2.0 implicit / token client）。
 *   - scope 只用 drive.file：只能存取「本程式自己建立」的檔案。
 *   - 首次存檔時自動建立資料夾「營建查驗資料」與檔案 inspection-data.json；
 *     之後以 fileId 覆寫同一份檔案，不會每次新增。
 *   - localStorage 只存 Client ID 與 fileId（不是資料本身）。
 *
 * 本版重點（相對前一版）：
 *   1. tokenClient 只初始化一次並重複使用（原本每次請求都新建一個，會累積 iframe 與監聽）。
 *   2. 401／網路錯誤／5xx 的處理收斂到單一 _request()，不再在 save/load/api 各抄一份。
 *   3. 暫時性失敗（網路中斷、5xx、429）自動重試（指數退避），避免一次抖動就失敗。
 *   4. 401 只清權杖、不再順手把使用者「登出」（原本會設 signedout，變成永久需要重新按授權）。
 *   5. 所有 Drive 呼叫集中在此，其他模組（gdrive-photo.js）改為呼叫 api()/fetchBlob()，不重複實作。
 *
 * 瀏覽器：window.GDrive
 */
(function (global) {
  'use strict';

  var CORE = global.Core || null;

  /* ---------------- 常數 ---------------- */

  var CID_KEY     = 'inspection-gdrive-clientid';
  var FID_KEY     = 'inspection-gdrive-fileid';
  var SYNC_KEY    = 'inspection-gdrive-lastsync';
  var TOKEN_KEY   = 'inspection-gdrive-token';
  var OFF_KEY     = 'inspection-gdrive-signedout';

  var FOLDER_NAME = '營建查驗資料';
  var FILE_NAME   = 'inspection-data.json';
  var SCOPE       = 'https://www.googleapis.com/auth/drive.file';
  var GIS_SRC     = 'https://accounts.google.com/gsi/client';
  var API_BASE    = 'https://www.googleapis.com';
  var UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';

  /* 內建固定的 OAuth Client ID（由管理者指定，使用者不需手動貼上） */
  var FIXED_CLIENT_ID = '401815954786-jn3vqu7riudvpcmvirl17rhsa4tp0mgp.apps.googleusercontent.com';

  var TOKEN_SKEW    = 60000;   /* 提前 60 秒視為過期，避免邊界失敗 */
  var RETRY_TIMES   = (CORE && CORE.LIMITS.RETRY_TIMES) || 2;
  var RETRY_DELAY   = (CORE && CORE.LIMITS.RETRY_DELAY) || 600;

  /* ---------------- 狀態 ---------------- */

  var st = { state: 'idle', message: '', lastSync: '', email: '' };
  var listeners = [];
  var tokenClient = null;
  var tokenClientCid = '';
  var accessToken = null;
  var tokenExpAt = 0;
  var gisLoading = null;
  var pending = null;   /* 目前等待中的權杖請求 {resolve,reject,silent} */

  var store = (CORE && CORE.store) ? CORE.store : {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? (d || '') : v; } catch (e) { return d || ''; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove: function (k) { try { localStorage.removeItem(k); return true; } catch (e) { return false; } }
  };

  /* ---------------- 狀態廣播 ---------------- */

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](st); } catch (e) { /* 單一 listener 出錯不影響其他人 */ }
    }
  }

  function setState(s, msg) {
    /* 狀態沒變就不廣播，省掉多餘的 DOM 重繪 */
    if (st.state === s && (msg === undefined || msg === st.message)) return;
    st.state = s;
    if (msg !== undefined) st.message = msg;
    emit();
  }

  function getStatus() { return st; }

  function onStatus(fn) {
    if (typeof fn !== 'function') return;
    if (listeners.indexOf(fn) < 0) listeners.push(fn);
    try { fn(st); } catch (e) {}
  }

  /* ---------------- 設定 ---------------- */

  function getClientId() {
    if (store.get(CID_KEY, '') !== FIXED_CLIENT_ID) store.set(CID_KEY, FIXED_CLIENT_ID);
    return FIXED_CLIENT_ID;
  }

  /** 保留相容介面：寫入時一律寫固定值（不接受其他值） */
  function setClientId() {
    store.set(CID_KEY, FIXED_CLIENT_ID);
    tokenClient = null;
    tokenClientCid = '';
    clearStoredToken();
    setState('idle', '已設定 Client ID，尚未連線');
  }

  function isConfigured() { return !!FIXED_CLIENT_ID; }

  /* ---------------- 權杖持久化 ---------------- */

  function isSignedOut() { return store.get(OFF_KEY, '') === '1'; }

  function setSignedOut(v) {
    if (v) store.set(OFF_KEY, '1');
    else store.remove(OFF_KEY);
  }

  function saveToken(resp) {
    var ttl = (resp && resp.expires_in ? Number(resp.expires_in) : 3600) * 1000;
    tokenExpAt = Date.now() + (isFinite(ttl) && ttl > 0 ? ttl : 3600000);
    store.set(TOKEN_KEY, JSON.stringify({
      access_token: resp.access_token,
      expires_at: tokenExpAt,
      email: st.email || ''
    }));
  }

  function clearStoredToken() {
    tokenExpAt = 0;
    accessToken = null;
    store.remove(TOKEN_KEY);
  }

  function tokenFresh() {
    if (!accessToken) return false;
    if (tokenExpAt && Date.now() >= (tokenExpAt - TOKEN_SKEW)) return false;
    return true;
  }

  /** 從 localStorage 還原權杖；未過期才採用。同步、零網路。 */
  function restoreToken() {
    if (tokenFresh()) return true;
    var raw = store.get(TOKEN_KEY, '');
    if (!raw) return false;
    var o = null;
    try { o = JSON.parse(raw); } catch (e) { clearStoredToken(); return false; }
    if (!o || !o.access_token || !o.expires_at) { clearStoredToken(); return false; }
    if (Date.now() >= (Number(o.expires_at) - TOKEN_SKEW)) { clearStoredToken(); return false; }
    accessToken = o.access_token;
    tokenExpAt = Number(o.expires_at);
    if (o.email && !st.email) st.email = o.email;
    return true;
  }

  function hasToken() { return tokenFresh(); }
  function tokenExpiresAt() { return tokenExpAt; }
  function getEmail() { return st.email || ''; }

  function setEmail(v) {
    st.email = v || '';
    if (!st.email) return;
    var raw = store.get(TOKEN_KEY, '');
    if (!raw) return;
    try {
      var o = JSON.parse(raw);
      o.email = st.email;
      store.set(TOKEN_KEY, JSON.stringify(o));
    } catch (e) {}
  }

  function getLastSync() { return store.get(SYNC_KEY, ''); }

  function resetFileId() { store.remove(FID_KEY); }

  /* ---------------- GIS 載入 ---------------- */

  function loadGIS() {
    if (gisLoading) return gisLoading;
    gisLoading = new Promise(function (res, rej) {
      if (global.google && global.google.accounts && global.google.accounts.oauth2) return res();

      /* 已經有 <script> 標籤（例如頁面自己載入）就不重複插入 */
      var existing = document.querySelector('script[src="' + GIS_SRC + '"]');
      if (existing) {
        existing.addEventListener('load', function () {
          if (global.google && global.google.accounts && global.google.accounts.oauth2) res();
          else { gisLoading = null; rej(new Error('Google 登入服務載入不完整')); }
        });
        existing.addEventListener('error', function () {
          gisLoading = null;
          rej(new Error('無法載入 Google 登入服務（可能被網路或廣告封鎖器阻擋）'));
        });
        return;
      }

      var s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () {
        if (global.google && global.google.accounts && global.google.accounts.oauth2) res();
        else { gisLoading = null; rej(new Error('Google 登入服務載入不完整')); }
      };
      s.onerror = function () {
        gisLoading = null;
        rej(new Error('無法載入 Google 登入服務（可能被網路或廣告封鎖器阻擋）'));
      };
      document.head.appendChild(s);
    });
    return gisLoading;
  }

  /* ---------------- 授權 ---------------- */

  /**
   * tokenClient 只建立一次並重複使用。
   * GIS 的 callback 在建立時綁定，因此把「本次請求的 resolver」放在 pending，
   * 由固定 callback 轉派給目前等待中的請求。
   */
  function ensureTokenClient(cid) {
    if (tokenClient && tokenClientCid === cid) return tokenClient;
    tokenClient = global.google.accounts.oauth2.initTokenClient({
      client_id: cid,
      scope: SCOPE,
      /* 一律用彈出視窗，避免在沒有 Google session 時把整個頁面導向登入頁 */
      ux_mode: 'popup',
      callback: function (resp) { settleToken(resp); },
      error_callback: function (err) { failToken(err); }
    });
    tokenClientCid = cid;
    return tokenClient;
  }

  function settleToken(resp) {
    var p = pending;
    pending = null;
    if (!p) return;
    if (resp && resp.access_token) {
      accessToken = resp.access_token;
      saveToken(resp);
      setSignedOut(false);
      p.resolve(accessToken);
    } else {
      var e = new Error('授權失敗：' + ((resp && resp.error) || '未知錯誤'));
      e.code = p.silent ? 'SILENT_FAILED' : 'CONNECT_FAILED';
      p.reject(e);
    }
  }

  function failToken(err) {
    var p = pending;
    pending = null;
    if (!p) return;
    var t = (err && (err.type || err.message)) || '視窗已關閉';
    var e = new Error(p.silent ? ('需要互動授權（' + t + '）') : ('授權未完成：' + t));
    e.code = p.silent ? 'SILENT_FAILED' : 'CONNECT_FAILED';
    e.reason = t;
    p.reject(e);
  }

  function requestToken(opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    var cid = getClientId();
    if (!cid) {
      setState('unauthorized', '請先完成 Google Drive 設定');
      return Promise.reject(new Error('NO_CLIENT_ID'));
    }

    return loadGIS().then(function () {
      return new Promise(function (res, rej) {
        /* 同時只能有一個請求：舊的視為被取代，避免兩個 Promise 卡住 */
        if (pending) {
          var prev = pending;
          pending = null;
          var ec = new Error('已由新的授權請求取代');
          ec.code = prev.silent ? 'SILENT_FAILED' : 'CONNECT_FAILED';
          try { prev.reject(ec); } catch (e) {}
        }
        pending = { resolve: res, reject: rej, silent: silent };

        try {
          ensureTokenClient(cid);
          /* silent：prompt:'' 不顯示同意畫面、不彈窗，可直接取回或續期權杖 */
          tokenClient.requestAccessToken(
            silent ? { prompt: '' } : { prompt: accessToken ? '' : 'consent' }
          );
        } catch (e) {
          pending = null;
          var e2 = new Error('無法開啟授權視窗：' + (e && e.message ? e.message : e));
          e2.code = silent ? 'SILENT_FAILED' : 'CONNECT_FAILED';
          rej(e2);
        }
      });
    });
  }

  /** 取得目前授權帳號的 Email（寫回狀態列與權杖紀錄） */
  function refreshEmail() {
    if (!hasToken()) return Promise.resolve('');
    return getUser().then(function (u) {
      if (u && u.emailAddress) {
        setEmail(u.emailAddress);
        emit();
      }
      return st.email || '';
    }).catch(function () { return st.email || ''; });
  }

  /** 使用者主動按下「連線」：允許顯示同意畫面 */
  function connect() {
    setState('connecting', '正在連線 Google…');
    return requestToken({ silent: false }).then(function (tok) {
      setState('connected', '已連線 Google Drive');
      refreshEmail();
      return tok;
    }).catch(function (e) {
      if (e && e.message === 'NO_CLIENT_ID') throw e;
      setState('error', e && e.message ? e.message : '連線失敗');
      throw e;
    });
  }

  /** 靜默授權：prompt:'' 嘗試直接取回權杖，成功就不必使用者再按一次 */
  function silentConnect() {
    if (tokenFresh()) return Promise.resolve(accessToken);
    if (isSignedOut()) {
      var eo = new Error('已登出，請按「連線 Google Drive」重新授權');
      eo.code = 'SIGNED_OUT';
      return Promise.reject(eo);
    }
    setState('silent', '正在自動連線…');
    return requestToken({ silent: true }).then(function (tok) {
      setState('connected', '已自動連線 Google Drive');
      refreshEmail();
      return tok;
    }).catch(function (e) {
      if (!e.code) e.code = 'SILENT_FAILED';
      setState(e.code === 'SIGNED_OUT' ? 'idle' : 'expired', e.message);
      throw e;
    });
  }

  /** 取得可用權杖：記憶體 → localStorage（未過期）→ 靜默續期。全部失敗才需要互動。 */
  function ensureToken() {
    if (tokenFresh()) return Promise.resolve(accessToken);
    if (restoreToken() && tokenFresh()) {
      setState('connected', '已沿用先前的授權');
      refreshEmail();
      return Promise.resolve(accessToken);
    }
    return silentConnect();
  }

  /** 登出：清除記憶體與本機權杖，並盡力撤銷 Google 端授權 */
  function disconnect() {
    var tok = accessToken;
    clearStoredToken();
    tokenClient = null;
    tokenClientCid = '';
    setSignedOut(true);
    st.email = '';
    setState('idle', '已中斷連線（資料仍在瀏覽器本機）');
    if (tok && global.google && global.google.accounts &&
        global.google.accounts.oauth2 && global.google.accounts.oauth2.revoke) {
      try { global.google.accounts.oauth2.revoke(tok, function () {}); } catch (e) {}
    }
  }

  /* ---------------- HTTP 核心 ---------------- */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isTransient(status) {
    return status === 408 || status === 429 || status === 500 || status === 502 ||
           status === 503 || status === 504;
  }

  function readError(r) {
    return r.text().then(function (t) {
      var msg = 'Drive API ' + r.status;
      try {
        var j = JSON.parse(t);
        if (j && j.error && j.error.message) msg += '：' + j.error.message;
      } catch (e) { if (t) msg += '：' + String(t).slice(0, 160); }
      var err = new Error(msg);
      err.status = r.status;
      return err;
    });
  }

  /**
   * 單一 HTTP 入口：帶權杖、處理 401、重試暫時性錯誤。
   * opts: { method, headers, body, silent, retry, raw }
   *   silent=true → 401 不清權杖（給「順便查一下」的輔助請求）
   *   raw=true    → 回傳 Response（下載二進位用）
   */
  function _request(url, opts) {
    opts = opts || {};
    var attempts = 0;
    var maxRetry = opts.retry === false ? 0 : RETRY_TIMES;

    function attempt(tok) {
      attempts++;
      var headers = {};
      var k;
      for (k in (opts.headers || {})) {
        if (Object.prototype.hasOwnProperty.call(opts.headers, k)) headers[k] = opts.headers[k];
      }
      if (tok) headers['Authorization'] = 'Bearer ' + tok;

      return fetch(url, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body
      }).then(function (r) {
        if (r.status === 401) {
          if (!opts.silent) {
            /* 只清權杖；不設 signedout，下次進入仍可靜默續期 */
            clearStoredToken();
            setState('expired', '授權已過期，請重新連線');
          }
          var e401 = new Error('授權已過期，請重新連線');
          e401.code = 'NEED_INTERACTIVE';
          e401.status = 401;
          throw e401;
        }
        if (!r.ok) {
          return readError(r).then(function (err) {
            if (isTransient(r.status) && attempts <= maxRetry) {
              return sleep(RETRY_DELAY * attempts).then(function () { return attempt(tok); });
            }
            throw err;
          });
        }
        if (opts.raw) return r;
        if (r.status === 204) return null;
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('application/json') < 0) {
          return r.text().then(function (t) {
            try { return JSON.parse(t); } catch (e) { return t; }
          });
        }
        return r.json();
      }, function (netErr) {
        /* 網路層失敗（離線、DNS、CORS 前置失敗）：重試後才放棄 */
        if (attempts <= maxRetry) {
          return sleep(RETRY_DELAY * attempts).then(function () { return attempt(tok); });
        }
        var e = new Error('網路錯誤：' + ((netErr && netErr.message) || '無法連線'));
        e.code = 'NETWORK';
        throw e;
      });
    }

    return ensureToken().then(attempt);
  }

  /** Drive REST 呼叫（path 以 /drive/v3 開頭） */
  function api(path, opts) {
    return _request(API_BASE + path, opts);
  }

  /** 取得檔案二進位內容（批次下載／縮圖用） */
  function fetchBlob(fileId) {
    if (!fileId) return Promise.reject(new Error('缺少 Drive 檔案 ID'));
    return api('/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', { raw: true })
      .then(function (r) { return r.blob(); });
  }

  /** multipart 上傳（中繼資料 + 檔案） */
  function uploadMultipart(form, fields) {
    var url = UPLOAD_BASE + '?uploadType=multipart' +
      (fields ? ('&fields=' + encodeURIComponent(fields)) : '');
    return _request(url, { method: 'POST', body: form });
  }

  function getUser() {
    return api('/drive/v3/about?fields=user(displayName,emailAddress,permissionId)', { silent: true })
      .then(function (j) { return (j && j.user) || null; })
      .catch(function () { return null; });
  }

  function escQ(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function ensureFolder() {
    var q = "name='" + escQ(FOLDER_NAME) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    return api('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)&spaces=drive')
      .then(function (j) {
        if (j && j.files && j.files.length) return j.files[0].id;
        return api('/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
        }).then(function (f) { return f.id; });
      });
  }

  function ensureFile(folderId) {
    var cached = store.get(FID_KEY, '');
    if (cached) return Promise.resolve(cached);

    var q = "name='" + FILE_NAME + "' and '" + folderId + "' in parents and trashed=false";
    return api('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)')
      .then(function (j) {
        if (j && j.files && j.files.length) {
          store.set(FID_KEY, j.files[0].id);
          return j.files[0].id;
        }
        return api('/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FILE_NAME, parents: [folderId], mimeType: 'application/json' })
        }).then(function (f) {
          store.set(FID_KEY, f.id);
          return f.id;
        });
      });
  }

  function stamp() {
    st.lastSync = new Date().toISOString();
    store.set(SYNC_KEY, st.lastSync);
  }

  /** 需要互動時才彈授權：先試既有／靜默權杖，失敗才走 connect() */
  function withInteractiveFallback(factory) {
    return ensureToken().catch(function (e) {
      if (e && (e.code === 'SIGNED_OUT' || e.code === 'NEED_INTERACTIVE' ||
                e.code === 'SILENT_FAILED' || e.code === 'CONNECT_FAILED')) {
        return connect();
      }
      throw e;
    }).then(factory);
  }

  /** 上傳（覆寫同一份檔案） */
  function save(data) {
    setState('syncing', '同步中…');
    return withInteractiveFallback(function () {
      return ensureFolder()
        .then(ensureFile)
        .then(function (fileId) {
          return _request(UPLOAD_BASE + '/' + encodeURIComponent(fileId) + '?uploadType=media', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json; charset=UTF-8' },
            body: JSON.stringify(data)
          });
        });
    }).then(function () {
      stamp();
      setState('connected', '已存到 Google Drive');
      return true;
    }).catch(function (e) {
      setState('error', e && e.message ? e.message : '同步失敗');
      throw e;
    });
  }

  /** 下載 */
  function load() {
    setState('syncing', '讀取中…');
    return withInteractiveFallback(function () {
      return ensureFolder()
        .then(ensureFile)
        .then(function (fileId) {
          return api('/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media');
        });
    }).then(function (j) {
      stamp();
      setState('connected', '已從 Google Drive 載入');
      return j;
    }).catch(function (e) {
      setState('error', e && e.message ? e.message : '讀取失敗');
      throw e;
    });
  }

  /* ---------------- 狀態列 UI ---------------- */

  var LABELS = {
    idle:         { t: '未授權',     c: '#6b7a8d', bg: '#f2f5f9', bd: '#dde4ec' },
    silent:       { t: '自動連線…',  c: '#2c5282', bg: '#eef4fb', bd: '#d3e2f2' },
    expired:      { t: '需重新連線', c: '#c47f17', bg: '#fdf6e7', bd: '#f0dfb8' },
    unauthorized: { t: '未授權',     c: '#c47f17', bg: '#fdf6e7', bd: '#f0dfb8' },
    connecting:   { t: '連線中…',    c: '#2c5282', bg: '#eef4fb', bd: '#d3e2f2' },
    syncing:      { t: '同步中…',    c: '#2c5282', bg: '#eef4fb', bd: '#d3e2f2' },
    connected:    { t: '已連線',     c: '#1f7a4d', bg: '#e9f5ee', bd: '#cfe6da' },
    error:        { t: '同步失敗',   c: '#b3261e', bg: '#fdf3f2', bd: '#f0cfcc' }
  };

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var p = (CORE && CORE.pad2) ? CORE.pad2 : function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * 把狀態列掛到指定容器。opts: { onSave, onLoad, onNeedSetup, settingsHref }
   * 重複呼叫同一個容器不會重複綁事件（以 data-gd-mounted 標記）。
   */
  function mountStatus(el, opts) {
    if (!el) return;
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    if (el.getAttribute('data-gd-mounted') === '1') return;
    el.setAttribute('data-gd-mounted', '1');
    opts = opts || {};

    el.innerHTML =
      '<div class="gd-bar">' +
        '<span class="gd-dot"></span>' +
        '<span class="gd-txt"></span>' +
        '<span class="gd-time"></span>' +
        '<span class="gd-sp"></span>' +
        '<button type="button" class="gd-btn gd-save">☁ 存到 Google Drive</button>' +
        '<button type="button" class="gd-btn gd-load">⬇ 從 Google Drive 載入</button>' +
        '<a class="gd-link" href="' + (opts.settingsHref || '../settings/index.html') + '">⚙ 設定</a>' +
      '</div>' +
      '<div class="gd-msg"></div>';

    var dot  = el.querySelector('.gd-dot');
    var txt  = el.querySelector('.gd-txt');
    var time = el.querySelector('.gd-time');
    var msg  = el.querySelector('.gd-msg');
    var bSave = el.querySelector('.gd-save');
    var bLoad = el.querySelector('.gd-load');

    function render(s) {
      var L = LABELS[s.state] || LABELS.idle;
      dot.style.background = L.c;
      txt.textContent = L.t;
      txt.style.color = L.c;
      time.textContent = '最後同步：' + fmtTime(s.lastSync || getLastSync());
      if (s.state === 'error' && s.message) {
        msg.textContent = '⚠ ' + s.message;
        msg.style.display = 'block';
      } else if (!isConfigured()) {
        msg.textContent = '尚未設定 Google OAuth Client ID，請先到「⚙ 設定」完成設定（約 5 分鐘，附圖文步驟）。';
        msg.style.display = 'block';
      } else {
        msg.style.display = 'none';
      }
      var busy = (s.state === 'syncing' || s.state === 'connecting');
      bSave.disabled = busy;
      bLoad.disabled = busy;
    }

    onStatus(render);

    function guard(fn) {
      if (!isConfigured()) {
        if (opts.onNeedSetup) opts.onNeedSetup();
        else if (global.confirm('尚未設定 Google OAuth Client ID。\n要現在前往設定頁嗎？')) {
          location.href = opts.settingsHref || '../settings/index.html';
        }
        return;
      }
      fn();
    }

    bSave.addEventListener('click', function () {
      guard(function () { if (opts.onSave) opts.onSave(); });
    });
    bLoad.addEventListener('click', function () {
      guard(function () { if (opts.onLoad) opts.onLoad(); });
    });
  }

  /* ---------------- 樣式（自動注入一次） ---------------- */

  function injectStyle() {
    if (document.getElementById('gd-style')) return;
    var css =
      '.gd-bar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:10px 12px;' +
        'border:1px solid #dde4ec;border-radius:9px;background:#f8fafc;font-size:12.5px;}' +
      '.gd-dot{width:9px;height:9px;border-radius:50%;background:#6b7a8d;flex:0 0 9px;}' +
      '.gd-txt{font-weight:700;}' +
      '.gd-time{color:#6b7a8d;font-size:11.5px;}' +
      '.gd-sp{margin-left:auto;}' +
      '.gd-btn{font-family:inherit;font-size:12.5px;font-weight:600;padding:7px 12px;border-radius:7px;' +
        'border:1px solid #d8dee7;background:#fff;color:#3d4a5c;cursor:pointer;transition:.15s;}' +
      '.gd-btn:hover:not(:disabled){background:#f0f5fb;border-color:#c3cedb;}' +
      '.gd-btn:disabled{opacity:.5;cursor:not-allowed;}' +
      '.gd-link{font-size:12px;color:#2c5282;text-decoration:none;font-weight:600;padding:6px 8px;' +
        'border-radius:6px;}' +
      '.gd-link:hover{background:#eef4fb;}' +
      '.gd-msg{display:none;margin-top:7px;font-size:12px;color:#b3261e;line-height:1.6;' +
        'background:#fdf3f2;border:1px solid #f0cfcc;border-radius:7px;padding:8px 11px;}';
    var s = document.createElement('style');
    s.id = 'gd-style';
    s.textContent = css;
    document.head.appendChild(s);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyle);
    else injectStyle();
  }

  /* ---------------- 匯出 ---------------- */

  global.GDrive = {
    FOLDER_NAME: FOLDER_NAME,
    FILE_NAME: FILE_NAME,
    SCOPE: SCOPE,
    FIXED_CLIENT_ID: FIXED_CLIENT_ID,
    getClientId: getClientId,
    setClientId: setClientId,
    isConfigured: isConfigured,
    hasToken: hasToken,
    getStatus: getStatus,
    getLastSync: getLastSync,
    onStatus: onStatus,
    connect: connect,
    silentConnect: silentConnect,
    ensureToken: ensureToken,
    restoreToken: restoreToken,
    isSignedOut: isSignedOut,
    getEmail: getEmail,
    setEmail: setEmail,
    tokenExpiresAt: tokenExpiresAt,
    clearStoredToken: clearStoredToken,
    disconnect: disconnect,
    getUser: getUser,
    save: save,
    load: load,
    resetFileId: resetFileId,
    mountStatus: mountStatus,
    fmtTime: fmtTime,
    /* 供其他模組共用，避免各自再寫一份 Drive 呼叫 */
    api: api,
    fetchBlob: fetchBlob,
    uploadMultipart: uploadMultipart,
    escQ: escQ,
    loadGIS: loadGIS
  };
})(typeof window !== 'undefined' ? window : this);
