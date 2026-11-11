/*!
 * gdrive-photo.js — 相片上傳歸檔模組（Google Drive）
 *
 * 設計：
 *   - 完全沿用 assets/gdrive.js 的 Google OAuth（同一個固定 Client ID、同一個 drive.file scope），
 *     不另外做一套登入；本模組只是把 token 拿來做「相片上傳 + 依日期歸檔」。
 *   - 載入時會把功能併進 window.GDrive，頁面可直接用 GDrive.uploadPhoto(...) 等。
 *   - 資料夾結構：營建相片 / YYYY-MM-DD，已存在就沿用，不重複建立。
 *
 * 瀏覽器：window.GDrive（原有 API + 相片 API）
 */
(function (global) {
  'use strict';

  var base = global.GDrive || null;

  var PHOTO_ROOT = '營建相片';

  /* 本模組自己的 token 快取（base 的 accessToken 在閉包內取不到，故自行保留） */
  var myToken = null;
  var myEmail = '';

  /* ---------------- 錯誤訊息 ---------------- */

  function friendlyError(e) {
    var m = (e && e.message) ? String(e.message) : String(e || '');
    if (/NO_CLIENT_ID/.test(m)) return '尚未設定 Google OAuth Client ID';
    /* 只認真正的 401 狀態，避免專案編號（如 401815954786）被誤判 */
    if (/Drive API 401/.test(m) || /授權已過期/.test(m)) return '授權已過期，請重新按「🔗 連線 Google Drive」';
    if (/Drive API 403|\b403\b/.test(m)) {
      if (/storageQuota|quota/i.test(m)) return 'Google Drive 空間不足，請清理後再試';
      if (/insufficient|insufficientPermissions/i.test(m)) return '權限不足：請重新授權並同意 Drive 檔案權限';
      if (/has not been used|disabled|not enabled|SERVICE_DISABLED/i.test(m)) {
        return 'Google Drive API 尚未啟用（403）：請到 Google Cloud Console 啟用 Drive API';
      }
      return '權限不足或 Drive API 未啟用（403）：' + m.replace(/^Drive API 403：/, '');
    }
    if (/404/.test(m)) return '找不到目標資料夾（404），請重試';
    if (/Failed to fetch|NetworkError|network error/i.test(m)) return '網路錯誤，請確認連線後重試';
    if (/檔案過大|too large|exceed/i.test(m)) return '檔案過大，請縮小後再上傳';
    return m || '未知錯誤';
  }

  /* ---------------- token ---------------- */

  function getToken() {
    if (myToken) return Promise.resolve(myToken);
    if (!base) return Promise.reject(new Error('NO_CLIENT_ID'));
    return base.connect().then(function (t) {
      myToken = t;
      return t;
    });
  }

  function connect() {
    if (!base) return Promise.reject(new Error('NO_CLIENT_ID'));
    return base.connect().then(function (t) {
      myToken = t;
      getUser().then(function (u) {
        if (u && u.emailAddress) myEmail = u.emailAddress;
      }).catch(function () {});
      return t;
    });
  }

  function disconnect() {
    myToken = null;
    myEmail = '';
    if (base && base.disconnect) base.disconnect();
  }

  function hasToken() {
    return !!myToken || !!(base && base.hasToken && base.hasToken());
  }

  function getEmail() { return myEmail; }

  /* ---------------- Drive API ---------------- */

  function api(path, opts) {
    opts = opts || {};
    return getToken().then(function (tok) {
      var headers = opts.headers || {};
      headers['Authorization'] = 'Bearer ' + tok;
      return fetch('https://www.googleapis.com' + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body
      }).then(function (r) {
        if (r.status === 401) {
          myToken = null;
          if (base && base.disconnect) base.disconnect();
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
    });
  }

  /** 目前授權的 Google 帳號 */
  function getUser() {
    if (!hasToken()) return Promise.resolve(null);
    return api('/drive/v3/about?fields=user(displayName,emailAddress,permissionId)')
      .then(function (j) { return (j && j.user) || null; })
      .catch(function () { return null; });
  }

  function escQ(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /** 依名稱（可指定父資料夾）尋找或建立資料夾，回傳 folderId */
  function ensureNamedFolder(name, parentId) {
    var q = "name='" + escQ(name) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (parentId) q += " and '" + parentId + "' in parents";
    return api('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)&spaces=drive')
      .then(function (j) {
        if (j && j.files && j.files.length) return j.files[0].id;
        var body = { name: name, mimeType: 'application/vnd.google-apps.folder' };
        if (parentId) body.parents = [parentId];
        return api('/drive/v3/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(function (f) { return f.id; });
      });
  }

  /** 建立／沿用「營建相片 / YYYY-MM-DD」，回傳 { rootId, dayId } */
  function ensurePhotoDateFolder(dateISO) {
    return ensureNamedFolder(PHOTO_ROOT).then(function (rootId) {
      return ensureNamedFolder(dateISO, rootId).then(function (dayId) {
        return { rootId: rootId, dayId: dayId };
      });
    });
  }

  /**
   * 上傳單張相片到「營建相片 / YYYY-MM-DD」
   * opts: { blob, filename, date, description }
   * 回傳 { id, name, webViewLink, size }
   */
  function uploadPhoto(opts) {
    opts = opts || {};
    if (!opts.blob) return Promise.reject(new Error('沒有可上傳的檔案內容'));

    return ensurePhotoDateFolder(opts.date).then(function (f) {
      var meta = { name: opts.filename, parents: [f.dayId] };
      if (opts.description) meta.description = opts.description;

      var form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      form.append('file', opts.blob, opts.filename);

      return getToken().then(function (tok) {
        return fetch('https://www.googleapis.com/upload/drive/v3/files' +
                     '?uploadType=multipart&fields=id,name,webViewLink,size', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + tok },
          body: form
        });
      }).then(function (r) {
        if (r.status === 401) {
          myToken = null;
          if (base && base.disconnect) base.disconnect();
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
        return r.json();
      });
    }).then(function (j) {
      return {
        id: j.id,
        name: j.name,
        webViewLink: j.webViewLink || ('https://drive.google.com/file/d/' + j.id + '/view'),
        size: j.size ? Number(j.size) : (opts.blob ? opts.blob.size : 0)
      };
    }).catch(function (e) {
      var err = new Error(friendlyError(e));
      err.raw = e;
      throw err;
    });
  }

  /* ---------------- 併入 window.GDrive ---------------- */

  var merged = {};
  var k;
  if (base) {
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k]; }
  }
  merged.PHOTO_ROOT      = PHOTO_ROOT;
  merged.connect         = connect;
  merged.disconnect      = disconnect;
  merged.hasToken        = hasToken;
  merged.getUser         = getUser;
  merged.getEmail        = getEmail;
  merged.ensureNamedFolder     = ensureNamedFolder;
  merged.ensurePhotoDateFolder = ensurePhotoDateFolder;
  merged.uploadPhoto     = uploadPhoto;
  merged.friendlyError   = friendlyError;

  global.GDrivePhoto = merged;
  global.GDrive = merged;

})(typeof window !== 'undefined' ? window : this);
