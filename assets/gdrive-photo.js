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

  /* 本模組自己的 token 快取（base 的 accessToken 在閉包內取不到，故自行保留）
     改版後優先向 base 要權杖，讓 gdrive.js 的 localStorage 持久化與靜默續期生效。 */
  var myToken = null;
  var myEmail = '';

  /* ---------------- 錯誤訊息 ---------------- */

  function friendlyError(e) {
    var m = (e && e.message) ? String(e.message) : String(e || '');
    if (/NO_CLIENT_ID/.test(m)) return '尚未設定 Google OAuth Client ID';
    /* 只認真正的 401 狀態，避免專案編號（如 401815954786）被誤判 */
    if (/Drive API 401/.test(m) || /授權已過期/.test(m)) return '授權已過期，請重新按「🔗 連線 Google Drive」';
    if (/需要互動授權|interaction_required|popup|SILENT_FAILED/i.test(m)) {
      return '需要重新授權（瀏覽器已封鎖自動授權），請按「🔗 連線 Google Drive」';
    }
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

  /**
   * 取得權杖。
   * 優先用 base（gdrive.js）的 ensureToken：它會 1) 用記憶體 2) 用 localStorage 未過期的權杖
   * 3) 靜默 prompt:'' 續期；因此重新整理、再次進入頁面都不必使用者重新授權。
   * 只有全部失敗（需互動）才會 reject，錯誤碼 NEED_INTERACTIVE。
   */
  function getToken() {
    if (base && base.ensureToken) {
      return base.ensureToken().then(function (t) {
        myToken = t;
        return t;
      }, function (e) {
        myToken = null;
        var err = new Error(friendlyError(e));
        err.code = (e && e.code) || 'NEED_INTERACTIVE';
        err.raw = e;
        throw err;
      });
    }
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

  /** 靜默授權：重新整理／再次進入頁面時自動取回權杖，不彈窗 */
  function silentConnect() {
    if (base && base.silentConnect) {
      return base.silentConnect().then(function (t) {
        myToken = t;
        return t;
      });
    }
    return getToken();
  }

  /** 沿用本機未過期的權杖（同步，不發網路動作） */
  function restoreToken() {
    if (base && base.restoreToken) {
      var ok = base.restoreToken();
      if (ok && base.hasToken && base.hasToken()) myToken = null;
      return ok;
    }
    return !!myToken;
  }

  function disconnect() {
    myToken = null;
    myEmail = '';
    if (base && base.disconnect) base.disconnect();
  }

  function hasToken() {
    if (base && base.hasToken) return !!base.hasToken();
    return !!myToken;
  }

  function getEmail() {
    return myEmail || (base && base.getEmail ? base.getEmail() : '') || '';
  }

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
          /* silent 模式（例如查詢帳號 Email）不因暫時性失敗就清掉授權，
             避免一次網路異常或端點問題讓使用者被迫重新授權。 */
          if (!opts.silent) {
            myToken = null;
            if (base && base.clearStoredToken) base.clearStoredToken();
            if (base && base.disconnect) base.disconnect();
            var e401 = new Error('授權已過期，請重新連線');
            e401.code = 'NEED_INTERACTIVE';
            throw e401;
          }
          throw new Error('Drive API 401');
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
    return api('/drive/v3/about?fields=user(displayName,emailAddress,permissionId)', { silent: true })
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
      /* 一律以 PNG 上傳：若 blob 型別不是 image/png，重新包一層確保 MIME 正確 */
      var fileBlob = opts.blob;
      if (opts.mime && fileBlob.type !== opts.mime) {
        try { fileBlob = new Blob([fileBlob], { type: opts.mime }); } catch (e) { fileBlob = opts.blob; }
      }
      form.append('file', fileBlob, opts.filename);

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
          if (base && base.clearStoredToken) base.clearStoredToken();
          if (base && base.disconnect) base.disconnect();
          var eu = new Error('授權已過期，請重新連線');
          eu.code = 'NEED_INTERACTIVE';
          throw eu;
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

  /**
   * 取回單一 Drive 檔案的二進位內容（批次／打包下載用）
   * 只讀，不會重新上傳、也不會修改 Drive 上的檔案。
   * 回傳 Promise<Blob>
   */
  function fetchFile(fileId) {
    if (!fileId) return Promise.reject(new Error('缺少 Drive 檔案 ID'));
    return getToken().then(function (tok) {
      return fetch('https://www.googleapis.com/drive/v3/files/' +
                   encodeURIComponent(fileId) + '?alt=media', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + tok }
      });
    }).then(function (r) {
      if (r.status === 401) {
        myToken = null;
        if (base && base.clearStoredToken) base.clearStoredToken();
        if (base && base.disconnect) base.disconnect();
        var ef = new Error('授權已過期，請重新連線');
        ef.code = 'NEED_INTERACTIVE';
        throw ef;
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
      return r.blob();
    }).catch(function (e) {
      var err = new Error(friendlyError(e));
      err.raw = e;
      throw err;
    });
  }

  /* ---------------- 從 Drive 匯入已上傳紀錄 ---------------- */

  /** 列出單一資料夾內所有檔案（自動分頁） */
  function listAllFiles(query, fields, maxPages) {
    var out = [];
    var pageToken = '';
    var pages = 0;
    var limit = maxPages || 20; /* 每頁 1000 筆，最多 2 萬筆，足以保護瀏覽器 */

    function step() {
      if (pages >= limit) return Promise.resolve(out);
      pages++;
      var url = '/drive/v3/files?q=' + encodeURIComponent(query) +
        '&fields=' + encodeURIComponent(fields || 'nextPageToken,files(id,name,size,createdTime,description,webViewLink)') +
        '&pageSize=1000&spaces=drive' +
        (pageToken ? ('&pageToken=' + encodeURIComponent(pageToken)) : '');
      return api(url).then(function (j) {
        if (j && j.files && j.files.length) {
          for (var i = 0; i < j.files.length; i++) out.push(j.files[i]);
        }
        pageToken = (j && j.nextPageToken) || '';
        if (pageToken) return step();
        return out;
      });
    }
    return step();
  }

  /**
   * 從 Drive 讀回「營建相片 / YYYY-MM-DD / *.jpg」結構，組成可與本機合併的紀錄。
   *
   * 回傳 Promise<{ records:[], folders:{}, scanned:number, rootId:string }>
   * record = { id, name, link, date, item, note, size, uploadedAt, source:'drive' }
   *
   * 注意：drive.file scope 只能看到「本程式建立」的檔案，使用者自己丟進去的相片不會出現在這裡。
   */
  function listPhotoRecords(opts) {
    opts = opts || {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    var rootId = '';

    onProgress({ phase: 'root', message: '正在找「' + PHOTO_ROOT + '」資料夾…' });

    var q = "name='" + escQ(PHOTO_ROOT) + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    return api('/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)&spaces=drive')
      .then(function (j) {
        if (!(j && j.files && j.files.length)) {
          onProgress({ phase: 'done', message: 'Drive 上尚無「' + PHOTO_ROOT + '」資料夾' });
          return { records: [], folders: {}, scanned: 0, rootId: '' };
        }
        rootId = j.files[0].id;
        onProgress({ phase: 'folders', message: '正在讀取日期資料夾…' });

        var fq = "'" + rootId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
        return listAllFiles(fq, 'nextPageToken,files(id,name)').then(function (folders) {
          /* 只處理 YYYY-MM-DD 形式的日期資料夾 */
          var dayFolders = [];
          for (var i = 0; i < folders.length; i++) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(folders[i].name)) dayFolders.push(folders[i]);
          }
          dayFolders.sort(function (a, b) { return a.name < b.name ? 1 : (a.name > b.name ? -1 : 0); });

          if (!dayFolders.length) {
            onProgress({ phase: 'done', message: '尚無日期資料夾' });
            return { records: [], folders: {}, scanned: 0, rootId: rootId };
          }

          var records = [];
          var folderMap = {};
          var idx = 0;

          function nextFolder() {
            if (idx >= dayFolders.length) return Promise.resolve();
            var f = dayFolders[idx];
            onProgress({
              phase: 'files',
              message: '讀取 ' + f.name + '（' + (idx + 1) + ' / ' + dayFolders.length + '）',
              current: idx + 1,
              total: dayFolders.length
            });
            var fq2 = "'" + f.id + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'";
            return listAllFiles(fq2, 'nextPageToken,files(id,name,size,createdTime,description,webViewLink,mimeType)')
              .then(function (files) {
                folderMap[f.name] = f.id;
                for (var k = 0; k < files.length; k++) {
                  var it = files[k];
                  records.push(toRecord(it, f.name));
                }
                idx++;
                return nextFolder();
              });
          }

          return nextFolder().then(function () {
            onProgress({ phase: 'done', message: '已讀取 ' + records.length + ' 筆' });
            return { records: records, folders: folderMap, scanned: dayFolders.length, rootId: rootId };
          });
        });
      })
      .catch(function (e) {
        var err = new Error(friendlyError(e));
        err.code = (e && e.code) || 'IMPORT_FAILED';
        err.raw = e;
        throw err;
      });
  }

  /** 把 Drive 檔案物件轉成本頁紀錄（僅 JPG／PNG 相片） */
  function toRecord(it, dateISO) {
    var name = it.name || '';
    var item = '';
    var note = '';

    /* 檔名規則 日期_工項_序號.jpg → 把工項抓回來 */
    var m = /^\d{8}_(.+?)_\d{2}\.[a-z0-9]+$/i.exec(name);
    if (m) {
      var mid = m[1];
      /* 純時間（6 位數字或含連字號的時間）代表當初沒填工項，不當作工項 */
      if (!/^\d{6}$/.test(mid) && !/^\d{2}-?\d{2}-?\d{2}$/.test(mid)) item = mid;
    }

    /* 描述格式：說明｜工項：xxx｜歸檔日期：yyyy-mm-dd */
    var desc = it.description || '';
    if (desc) {
      var parts = desc.split('｜');
      if (parts.length) note = parts[0] || '';
      for (var i = 0; i < parts.length; i++) {
        var mm = /^工項：(.*)$/.exec(parts[i]);
        if (mm && !item) item = mm[1];
      }
    }

    return {
      id: it.id,
      name: name,
      link: it.webViewLink || ('https://drive.google.com/file/d/' + it.id + '/view'),
      date: dateISO || '',
      item: item,
      note: note,
      size: it.size ? Number(it.size) : 0,
      uploadedAt: it.createdTime || '',
      source: 'drive'
    };
  }

  /* ---------------- 相片前置處理（壓縮 + 浮水印） ---------------- */

  /**
   * 把原始檔壓成 PNG（長邊 ≤ maxEdge），並依需要壓上歸檔日期浮水印。
   * 浮水印會壓進實際輸出的 PNG，上傳到 Drive 的檔案本身（image/png）就帶浮水印。
   *
   * opts: { date:'YYYY-MM-DD', watermark:true, maxEdge:2000, detect:true }
   * 回傳 Promise<{ blob, applied, detected, width, height, box }>
   *
   * 若瀏覽器不支援 canvas 或解碼失敗，會退回原檔（不中斷上傳）。
   */
  function preparePhotoBlob(file, opts) {
    opts = opts || {};
    var WM = global.PhotoWatermark;
    if (!WM) return Promise.resolve({ blob: file, applied: false, detected: false, fallback: true });

    return WM.loadImageFromBlob(file).then(function (img) {
      var r;
      try {
        r = WM.render(img, {
          maxEdge: opts.maxEdge || 2000,
          date: opts.date,
          watermark: opts.watermark !== false,
          detect: opts.detect !== false
        });
      } finally {
        try { img.release(); } catch (e) {}
      }
      return WM.toPng(r.canvas).then(function (blob) {
        return {
          blob: blob,
          applied: r.applied,
          detected: r.detected,
          width: r.width,
          height: r.height,
          box: r.box
        };
      });
    }).catch(function () {
      /* 解碼／畫布失敗：退回原檔，讓上傳照常進行 */
      return { blob: file, applied: false, detected: false, fallback: true };
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
  merged.silentConnect   = silentConnect;
  merged.restoreToken    = restoreToken;
  merged.disconnect      = disconnect;
  merged.hasToken        = hasToken;
  merged.getUser         = getUser;
  merged.getEmail        = getEmail;
  merged.ensureNamedFolder     = ensureNamedFolder;
  merged.ensurePhotoDateFolder = ensurePhotoDateFolder;
  merged.uploadPhoto     = uploadPhoto;
  merged.fetchFile       = fetchFile;
  merged.listPhotoRecords      = listPhotoRecords;
  merged.listAllFiles    = listAllFiles;
  merged.preparePhotoBlob = preparePhotoBlob;
  merged.friendlyError   = friendlyError;

  global.GDrivePhoto = merged;
  global.GDrive = merged;

})(typeof window !== 'undefined' ? window : this);
