/*!
 * gdrive.js — Google Drive 純前端儲存（Google Identity Services + Drive API v3）
 *
 * 設計：
 *   - 不需要後端。使用 GIS token model（OAuth 2.0 implicit / token client）。
 *   - scope 只用 drive.file：只能存取「本程式自己建立」的檔案，看不到使用者其他雲端硬碟內容。
 *   - 首次存檔時自動建立資料夾「營建查驗資料」與檔案 inspection-data.json；
 *     之後以 fileId 覆寫同一份檔案，不會每次新增。
 *   - localStorage 只存 Client ID 與 fileId（不是資料本身），資料仍由各頁面自己保存。
 *
 * 瀏覽器：window.GDrive
 */
(function (global) {
  'use strict';

  var CID_KEY    = 'inspection-gdrive-clientid';
  var FID_KEY    = 'inspection-gdrive-fileid';
  var SYNC_KEY   = 'inspection-gdrive-lastsync';
  var FOLDER_NAME = '營建查驗資料';
  var FILE_NAME   = 'inspection-data.json';
  var SCOPE       = 'https://www.googleapis.com/auth/drive.file';
  var GIS_SRC     = 'https://accounts.google.com/gsi/client';

  var st = { state: 'idle', message: '', lastSync: '', email: '' };
  var listeners = [];
  var tokenClient = null;
  var accessToken = null;
  var gisLoading = null;

  /* ---------------- 狀態 ---------------- */

  function emit() {
    listeners.forEach(function (f) { try { f(st); } catch (e) {} });
  }

  function setState(s, msg) {
    st.state = s;
    if (msg !== undefined) st.message = msg;
    emit();
  }

  function getStatus() { return st; }

  function onStatus(fn) {
    if (typeof fn === 'function') { listeners.push(fn); fn(st); }
  }

  /* ---------------- 設定 ---------------- */

  function getClientId() {
    try { return localStorage.getItem(CID_KEY) || ''; } catch (e) { return ''; }
  }

  function setClientId(v) {
    try { localStorage.setItem(CID_KEY, String(v || '').trim()); } catch (e) {}
    tokenClient = null;
    accessToken = null;
    setState(getClientId() ? 'idle' : 'unauthorized', getClientId() ? '已設定 Client ID，尚未連線' : '尚未設定 Client ID');
  }

  function isConfigured() { return !!getClientId(); }

  function hasToken() { return !!accessToken; }

  function getLastSync() {
    try { return localStorage.getItem(SYNC_KEY) || ''; } catch (e) { return ''; }
  }

  function resetFileId() {
    try { localStorage.removeItem(FID_KEY); } catch (e) {}
  }

  /* ---------------- GIS 載入 ---------------- */

  function loadGIS() {
    if (gisLoading) return gisLoading;
    gisLoading = new Promise(function (res, rej) {
      if (global.google && global.google.accounts && global.google.accounts.oauth2) return res();
      var s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () {
        if (global.google && global.google.accounts && global.google.accounts.oauth2) res();
        else rej(new Error('Google 登入服務載入不完整'));
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

  function connect() {
    var cid = getClientId();
    if (!cid) {
      setState('unauthorized', '請先完成 Google Drive 設定');
      return Promise.reject(new Error('NO_CLIENT_ID'));
    }
    setState('connecting', '正在連線 Google…');

    return loadGIS().then(function () {
      return new Promise(function (res, rej) {
        var settled = false;
        function done(tok) { if (settled) return; settled = true; res(tok); }
        function fail(msg) { if (settled) return; settled = true; setState('error', msg); rej(new Error(msg)); }

        tokenClient = global.google.accounts.oauth2.initTokenClient({
          client_id: cid,
          scope: SCOPE,
          callback: function (resp) {
            if (resp && resp.access_token) {
              accessToken = resp.access_token;
              setState('connected', '已連線 Google Drive');
              done(accessToken);
            } else {
              fail('授權失敗：' + ((resp && resp.error) || '未知錯誤'));
            }
          },
          error_callback: function (err) {
            fail('授權未完成：' + ((err && (err.type || err.message)) || '視窗已關閉'));
          }
        });

        try {
          tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
        } catch (e) {
          fail('無法開啟授權視窗：' + (e && e.message ? e.message : e));
        }
      });
    }).catch(function (e) {
      if (e && e.message === 'NO_CLIENT_ID') throw e;
      if (st.state !== 'error') setState('error', e && e.message ? e.message : '連線失敗');
      throw e;
    });
  }

  function disconnect() {
    accessToken = null;
    tokenClient = null;
    setState('idle', '已中斷連線（資料仍在瀏覽器本機）');
  }

  /* ---------------- Drive API ---------------- */

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    headers['Authorization'] = 'Bearer ' + accessToken;
    return fetch('https://www.googleapis.com' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body
    }).then(function (r) {
      if (r.status === 401) {
        accessToken = null;
        setState('unauthorized', '授權已過期，請重新連線');
        throw new Error('授權已過期，請重新連線');
      }
      if (!r.ok) {
        return r.text().then(function (t) {
          var msg = 'Drive API ' + r.status;
          try {
            var j = JSON.parse(t);
            if (j && j.error && j.error.message) msg += '：' + j.error.message;
          } catch (e) { msg += '：' + String(t).slice(0, 160); }
          throw new Error(msg);
        });
      }
      if (r.status === 204) return null;
      return r.json();
    });
  }

  function ensureFolder() {
    var q = "name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
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
    var cached = null;
    try { cached = localStorage.getItem(FID_KEY); } catch (e) {}
    if (cached) return Promise.resolve(cached);

    var q = "name='" + FILE_NAME + "' and '" + folderId + "' in parents and trashed=false";
    return api('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)')
      .then(function (j) {
        if (j && j.files && j.files.length) {
          try { localStorage.setItem(FID_KEY, j.files[0].id); } catch (e) {}
          return j.files[0].id;
        }
        return api('/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FILE_NAME, parents: [folderId], mimeType: 'application/json' })
        }).then(function (f) {
          try { localStorage.setItem(FID_KEY, f.id); } catch (e) {}
          return f.id;
        });
      });
  }

  function stamp() {
    st.lastSync = new Date().toISOString();
    try { localStorage.setItem(SYNC_KEY, st.lastSync); } catch (e) {}
  }

  /** 上傳（覆寫同一份檔案） */
  function save(data) {
    if (!accessToken) {
      return connect().then(function () { return save(data); });
    }
    setState('syncing', '同步中…');
    return ensureFolder()
      .then(function (fid) { return ensureFile(fid); })
      .then(function (fileId) {
        return fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
          method: 'PATCH',
          headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json; charset=UTF-8'
          },
          body: JSON.stringify(data)
        }).then(function (r) {
          if (r.status === 401) {
            accessToken = null;
            setState('unauthorized', '授權已過期，請重新連線');
            throw new Error('授權已過期，請重新連線');
          }
          if (!r.ok) {
            return r.text().then(function (t) {
              throw new Error('上傳失敗 ' + r.status + '：' + String(t).slice(0, 160));
            });
          }
          return r.json();
        });
      })
      .then(function () {
        stamp();
        setState('connected', '已存到 Google Drive');
        return true;
      })
      .catch(function (e) {
        setState('error', e && e.message ? e.message : '同步失敗');
        throw e;
      });
  }

  /** 下載 */
  function load() {
    if (!accessToken) {
      return connect().then(function () { return load(); });
    }
    setState('syncing', '讀取中…');
    return ensureFolder()
      .then(function (fid) { return ensureFile(fid); })
      .then(function (fileId) {
        return fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
          headers: { 'Authorization': 'Bearer ' + accessToken }
        }).then(function (r) {
          if (r.status === 401) {
            accessToken = null;
            setState('unauthorized', '授權已過期，請重新連線');
            throw new Error('授權已過期，請重新連線');
          }
          if (!r.ok) {
            return r.text().then(function (t) {
              throw new Error('讀取失敗 ' + r.status + '：' + String(t).slice(0, 160));
            });
          }
          return r.json();
        });
      })
      .then(function (j) {
        stamp();
        setState('connected', '已從 Google Drive 載入');
        return j;
      })
      .catch(function (e) {
        setState('error', e && e.message ? e.message : '讀取失敗');
        throw e;
      });
  }

  /* ---------------- 狀態列 UI ---------------- */

  var LABELS = {
    idle:         { t: '未授權',   c: '#6b7a8d', bg: '#f2f5f9', bd: '#dde4ec' },
    unauthorized: { t: '未授權',   c: '#c47f17', bg: '#fdf6e7', bd: '#f0dfb8' },
    connecting:   { t: '連線中…', c: '#2c5282', bg: '#eef4fb', bd: '#d3e2f2' },
    syncing:      { t: '同步中…', c: '#2c5282', bg: '#eef4fb', bd: '#d3e2f2' },
    connected:    { t: '已連線',   c: '#1f7a4d', bg: '#e9f5ee', bd: '#cfe6da' },
    error:        { t: '同步失敗', c: '#b3261e', bg: '#fdf3f2', bd: '#f0cfcc' }
  };

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * 把狀態列掛到指定容器。
   * opts: { onSave, onLoad, settingsHref }
   */
  function mountStatus(el, opts) {
    if (!el) return;
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
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectStyle);
    } else {
      injectStyle();
    }
  }

  /* ---------------- 匯出 ---------------- */

  global.GDrive = {
    FOLDER_NAME: FOLDER_NAME,
    FILE_NAME: FILE_NAME,
    SCOPE: SCOPE,
    getClientId: getClientId,
    setClientId: setClientId,
    isConfigured: isConfigured,
    hasToken: hasToken,
    getStatus: getStatus,
    getLastSync: getLastSync,
    onStatus: onStatus,
    connect: connect,
    disconnect: disconnect,
    save: save,
    load: load,
    resetFileId: resetFileId,
    mountStatus: mountStatus,
    fmtTime: fmtTime
  };
})(typeof window !== 'undefined' ? window : this);
