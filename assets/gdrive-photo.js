/*!
 * gdrive-photo.js — 相片上傳歸檔模組（Google Drive）
 *
 * 設計：
 *   - 完全沿用 assets/gdrive.js 的 Google OAuth（同一個固定 Client ID、同一個 drive.file scope），
 *     不另外做一套登入；本模組只負責「相片上傳 + 依日期歸檔 + 讀回紀錄」。
 *   - 所有 HTTP 都走 GDrive.api() / GDrive.fetchBlob() / GDrive.uploadMultipart()，
 *     不再自己複製一份 fetch + 401 處理（原本三處各抄一份，行為還不一致）。
 *   - 資料夾結構：營建相片 / YYYY-MM-DD，已存在就沿用，不重複建立。
 *
 * 本版重點：
 *   1. 移除重複的 api()/401 處理，改用 gdrive.js 的單一入口（含重試）。
 *   2. 新增 makeThumb()：挑選照片時只下載一次原圖並縮成小縮圖，
 *      避免把每張 1～3MB 的 PNG 以 dataURL 塞進記憶體（原本 60 張就吃掉上百 MB）。
 *   3. 紀錄解析支援 .png / .jpg / .jpeg，並保留舊資料相容。
 *
 * 瀏覽器：window.GDrivePhoto（同時併入 window.GDrive）
 */
(function (global) {
  'use strict';

  var CORE = global.Core || null;
  var base = global.GDrive || null;

  var PHOTO_ROOT = '營建相片';
  var MAX_EDGE = (CORE && CORE.LIMITS.MAX_EDGE) || 2000;
  var THUMB_EDGE = 200;   /* 挑選清單縮圖長邊 */

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
    if (/網路錯誤|Failed to fetch|NetworkError|network error/i.test(m)) return '網路錯誤，請確認連線後重試';
    if (/檔案過大|too large|exceed/i.test(m)) return '檔案過大，請縮小後再上傳';
    return m || '未知錯誤';
  }

  function wrap(e) {
    var err = new Error(friendlyError(e));
    err.code = (e && e.code) || 'NEED_INTERACTIVE';
    err.raw = e;
    return err;
  }

  /* ---------------- token ---------------- */

  function getToken() {
    if (base && base.ensureToken) {
      return base.ensureToken().catch(function (e) { throw wrap(e); });
    }
    if (!base) return Promise.reject(new Error('NO_CLIENT_ID'));
    return base.connect();
  }

  function connect() {
    if (!base) return Promise.reject(new Error('NO_CLIENT_ID'));
    return base.connect().then(function (t) {
      getUser().then(function (u) {
        if (u && u.emailAddress) myEmail = u.emailAddress;
      }).catch(function () {});
      return t;
    });
  }

  function silentConnect() {
    if (base && base.silentConnect) return base.silentConnect();
    return getToken();
  }

  function restoreToken() {
    if (base && base.restoreToken) return base.restoreToken();
    return false;
  }

  function disconnect() {
    myEmail = '';
    if (base && base.disconnect) base.disconnect();
  }

  function hasToken() {
    if (base && base.hasToken) return !!base.hasToken();
    return false;
  }

  function getEmail() {
    return myEmail || (base && base.getEmail ? base.getEmail() : '') || '';
  }

  /* ---------------- Drive API（全部轉呼叫 gdrive.js） ---------------- */

  function api(path, opts) {
    if (!base || !base.api) return Promise.reject(new Error('Drive 模組未載入'));
    return base.api(path, opts).catch(function (e) { throw wrap(e); });
  }

  function fetchFile(fileId) {
    if (!base || !base.fetchBlob) return Promise.reject(new Error('Drive 模組未載入'));
    return base.fetchBlob(fileId).catch(function (e) { throw wrap(e); });
  }

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
   * opts: { blob, filename, date, description, mime }
   * 回傳 { id, name, webViewLink, size }
   */
  function uploadPhoto(opts) {
    opts = opts || {};
    if (!opts.blob) return Promise.reject(new Error('沒有可上傳的檔案內容'));
    if (!base || !base.uploadMultipart) return Promise.reject(new Error('Drive 模組未載入'));

    return ensurePhotoDateFolder(opts.date).then(function (f) {
      var meta = { name: opts.filename, parents: [f.dayId] };
      if (opts.description) meta.description = opts.description;

      var form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));

      /* 一律以 PNG 上傳：若 blob 型別不是 image/png，重新包一層確保 MIME 正確 */
      var fileBlob = opts.blob;
      var wantMime = opts.mime || 'image/png';
      if (fileBlob.type !== wantMime) {
        try { fileBlob = new Blob([fileBlob], { type: wantMime }); } catch (e) { fileBlob = opts.blob; }
      }
      form.append('file', fileBlob, opts.filename);

      return base.uploadMultipart(form, 'id,name,webViewLink,size');
    }).then(function (j) {
      return {
        id: j.id,
        name: j.name,
        webViewLink: j.webViewLink || ('https://drive.google.com/file/d/' + j.id + '/view'),
        size: j.size ? Number(j.size) : (opts.blob ? opts.blob.size : 0)
      };
    }).catch(function (e) { throw wrap(e); });
  }

  /* ---------------- 從 Drive 匯入已上傳紀錄 ---------------- */

  /** 列出符合 query 的所有檔案（自動分頁） */
  function listAllFiles(query, fields, maxPages) {
    var out = [];
    var pageToken = '';
    var pages = 0;
    var limit = maxPages || (CORE && CORE.LIMITS.IMPORT_MAX_PAGES) || 20;

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
   * 從 Drive 讀回「營建相片 / YYYY-MM-DD / *」結構，組成可與本機合併的紀錄。
   * 回傳 Promise<{ records:[], folders:{}, scanned:number, rootId:string }>
   * record = { id, name, link, date, item, note, size, uploadedAt, source:'drive' }
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
                  var rec = toRecord(files[k], f.name);
                  if (rec) records.push(rec);
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
        var err = wrap(e);
        err.code = (e && e.code) || 'IMPORT_FAILED';
        throw err;
      });
  }

  /** 只認圖片檔（PNG／JPG），其他（例如清單 TXT）不當成相片紀錄 */
  function isImageFile(it) {
    var mt = String(it.mimeType || '');
    if (mt) return /^image\//.test(mt);
    return /\.(png|jpe?g|webp)$/i.test(String(it.name || ''));
  }

  /** 把 Drive 檔案物件轉成本頁紀錄（僅 JPG／PNG 相片） */
  function toRecord(it, dateISO) {
    if (!it || !it.id) return null;
    if (!isImageFile(it)) return null;

    var name = it.name || '';
    var item = '';
    var note = '';

    /* 檔名規則 日期_工項_序號.png → 把工項抓回來 */
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
   */
  function preparePhotoBlob(file, opts) {
    opts = opts || {};
    var WM = global.PhotoWatermark;
    if (!WM) return Promise.resolve({ blob: file, applied: false, detected: false, fallback: true });

    return WM.loadImageFromBlob(file).then(function (img) {
      var r;
      try {
        r = WM.render(img, {
          maxEdge: opts.maxEdge || MAX_EDGE,
          date: opts.date,
          watermark: opts.watermark !== false,
          detect: opts.detect !== false,
          orient: opts.orient !== false
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
          box: r.box,
          rotated: r.rotated || 0,
          orient: r.orient || null
        };
      });
    }).catch(function () {
      /* 解碼／畫布失敗：退回原檔，讓上傳照常進行 */
      return { blob: file, applied: false, detected: false, fallback: true };
    });
  }

  /* ---------------- 縮圖（挑選清單用） ---------------- */

  /**
   * 把 Drive 上的原圖縮成小縮圖 dataURL。
   * 原本的做法是把整張原圖（PNG 可能 1～3MB）轉成 dataURL 存進記憶體，
   * 60 張就吃掉上百 MB，手機很容易被系統砍掉。這裡只留 200px 的縮圖。
   *
   * 回傳 Promise<string dataURL>
   */
  function makeThumb(fileId, maxEdge) {
    var edge = maxEdge || THUMB_EDGE;
    return fetchFile(fileId).then(function (blob) {
      var WM = global.PhotoWatermark;
      if (WM && WM.loadImageFromBlob) {
        return WM.loadImageFromBlob(blob).then(function (img) {
          try {
            /* 縮圖直接反映 Drive 上的歸檔檔（該檔在上傳前已依文字方向轉正）。
               這裡刻意「不再偵測一次」：對已轉正的成品重複偵測，可能因雜訊
               得到不同角度而二次旋轉，造成縮圖與實際歸檔方向不一致。 */
            var angle = 0;
            var swap = false;
            var ow = img.width;
            var oh = img.height;
            var s = Math.min(1, edge / Math.max(1, ow, oh));
            var w = Math.max(1, Math.round(ow * s));
            var h = Math.max(1, Math.round(oh * s));
            var cv = document.createElement('canvas');
            cv.width = w; cv.height = h;
            var ctx = cv.getContext('2d');
            if (!ctx) throw new Error('no-ctx');
            if (angle) {
              var dw = Math.round(img.width * s);
              var dh = Math.round(img.height * s);
              ctx.save();
              ctx.translate(w / 2, h / 2);
              ctx.rotate(angle * Math.PI / 180);
              ctx.drawImage(img.el, -dw / 2, -dh / 2, dw, dh);
              ctx.restore();
            } else {
              ctx.drawImage(img.el, 0, 0, w, h);
            }
            return cv.toDataURL('image/jpeg', 0.72);
          } finally {
            try { img.release(); } catch (e) {}
          }
        });
      }
      /* 沒有浮水印模組時退回 FileReader（仍會是原尺寸，但至少能顯示） */
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = function () { rej(new Error('讀取失敗')); };
        fr.readAsDataURL(blob);
      });
    });
  }

  /* ---------------- 併入 window.GDrive ---------------- */

  var merged = {};
  var k;
  if (base) {
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) merged[k] = base[k]; }
  }
  merged.PHOTO_ROOT            = PHOTO_ROOT;
  merged.connect               = connect;
  merged.silentConnect         = silentConnect;
  merged.restoreToken          = restoreToken;
  merged.disconnect            = disconnect;
  merged.hasToken              = hasToken;
  merged.getUser               = getUser;
  merged.getEmail              = getEmail;
  merged.ensureNamedFolder     = ensureNamedFolder;
  merged.ensurePhotoDateFolder = ensurePhotoDateFolder;
  merged.uploadPhoto           = uploadPhoto;
  merged.fetchFile             = fetchFile;
  merged.listPhotoRecords      = listPhotoRecords;
  merged.listAllFiles          = listAllFiles;
  merged.preparePhotoBlob      = preparePhotoBlob;
  merged.makeThumb             = makeThumb;
  merged.friendlyError         = friendlyError;

  global.GDrivePhoto = merged;
  global.GDrive = merged;

})(typeof window !== 'undefined' ? window : this);
