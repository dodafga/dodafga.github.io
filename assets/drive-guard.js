/* drive-guard.js — Google Drive 存取白名單（集中一處定義，所有讀寫必經此檢查）
 *
 * 目的：把 Drive 存取範圍收斂到只碰「指定資料夾」，其他一律拒絕並記錄。
 *
 * 允許的資料夾（名稱）：
 *   backup                 每日備份
 *   營造助手資料            查驗資料（inspection-data.json）
 *   義力 / 施工照片 / <日期> / 待補日期    相片歸檔
 *
 * 允許的檔案（名稱）：
 *   inspection-data.json
 *   YYYY-MM-DD.json（備份檔）
 *   20261127_055800_01.png（相片）
 *   pending_055800_01.png（待補日期相片）
 *
 * 檢查方式：
 *   1. 名稱白名單 —— 所有 list 查詢的 name='X'、所有建立請求的 name 都要在白名單內
 *   2. 資料夾 ID 註冊表 —— 只有「由白名單名稱取得或建立」的資料夾 ID 才被承認；
 *      對未註冊 ID 的 'X' in parents 查詢或 parents:[X] 建立，一律拒絕
 *   3. 檔案 ID 註冊表 —— 只有本模組放行的檔案 ID 才可被讀取／更新／刪除
 *
 * 被拒絕的呼叫：不執行、寫入 console.warn、記到 localStorage 環狀緩衝（最近 50 筆），
 * 並丟出 code='DRIVE_BLOCKED' 的錯誤，讓上層顯示而不是靜默失敗。
 *
 * 本檔不含任何 secret。
 */
(function (global) {
  'use strict';

  var LOG_KEY = 'drive-guard-log-v1';
  var LOG_MAX = 50;

  /* ---------- 白名單定義（唯一一處） ---------- */
  var FOLDER_NAMES = ['backup', '營造助手資料', '義力', '施工照片', '待補日期'];
  var DATE_FOLDER_RE = /^\d{4}-\d{2}-\d{2}$/;
  var FILE_RES = [
    /^inspection-data\.json$/,
    /^\d{4}-\d{2}-\d{2}\.json$/,
    /^\d{8}_.+_\d{2}\.(png|jpe?g|webp)$/i,
    /^pending_.+_\d{2}\.png$/i
  ];

  function isAllowedFolderName(n) {
    n = String(n == null ? '' : n);
    if (!n) return false;
    if (FOLDER_NAMES.indexOf(n) >= 0) return true;
    return DATE_FOLDER_RE.test(n);
  }

  function isAllowedFileName(n) {
    n = String(n == null ? '' : n);
    if (!n) return false;
    for (var i = 0; i < FILE_RES.length; i++) if (FILE_RES[i].test(n)) return true;
    return false;
  }

  /* ---------- 註冊表 ---------- */
  var folderIds = {};   /* id -> name */
  var fileIds = {};     /* id -> name */

  function regFolder(id, name) {
    if (id && isAllowedFolderName(name)) folderIds[String(id)] = String(name);
  }
  function regFile(id, name) {
    if (id && isAllowedFileName(name)) fileIds[String(id)] = String(name);
  }
  function isKnownFolder(id) {
    id = String(id == null ? '' : id);
    return id === 'root' || !!folderIds[id];
  }
  function isKnownFile(id) { return !!fileIds[String(id == null ? '' : id)]; }

  /* ---------- 記錄 ---------- */
  var memLog = [];

  function record(kind, detail) {
    var row = { at: new Date().toISOString(), kind: kind, detail: String(detail || '').slice(0, 300) };
    memLog.push(row);
    if (memLog.length > LOG_MAX) memLog.shift();
    try {
      var arr = JSON.parse(global.localStorage.getItem(LOG_KEY) || '[]');
      if (!Array.isArray(arr)) arr = [];
      arr.push(row);
      while (arr.length > LOG_MAX) arr.shift();
      global.localStorage.setItem(LOG_KEY, JSON.stringify(arr));
    } catch (e) {}
    try { console.warn('[DriveGuard] 已阻擋 ' + kind + '：' + row.detail); } catch (e) {}
  }

  function blocked(kind, detail) {
    record(kind, detail);
    var e = new Error('Drive 存取被白名單阻擋（' + kind + '）：' + detail);
    e.code = 'DRIVE_BLOCKED';
    return e;
  }

  /* ---------- 解析 Drive 請求 ---------- */
  function decodeQ(path) {
    var i = String(path).indexOf('?');
    if (i < 0) return '';
    try { return decodeURIComponent(String(path).slice(i + 1)); } catch (e) { return String(path).slice(i + 1); }
  }

  /* 從 q 字串取出所有 name='X' 與 'ID' in parents */
  function parseQuery(q) {
    var names = [], parents = [], m, re1 = /name\s*=\s*'((?:[^'\\]|\\.)*)'/g;
    while ((m = re1.exec(q))) names.push(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    var re2 = /'([A-Za-z0-9_\-]{6,})'\s+in\s+parents/g;
    while ((m = re2.exec(q))) parents.push(m[1]);
    return { names: names, parents: parents };
  }

  /* 檢查一個 list 查詢；回傳 null 表示放行，否則回傳錯誤 */
  function checkList(path) {
    var q = decodeQ(path);
    if (!q) return null;
    var p = parseQuery(q);
    var i;
    for (i = 0; i < p.names.length; i++) {
      var n = p.names[i];
      if (!isAllowedFolderName(n) && !isAllowedFileName(n)) {
        return blocked('list', "查詢名稱不在白名單：" + n);
      }
    }
    for (i = 0; i < p.parents.length; i++) {
      if (!isKnownFolder(p.parents[i])) {
        return blocked('list', "查詢未註冊的資料夾 ID：" + p.parents[i]);
      }
    }
    return null;
  }

  /* 檢查建立請求的 metadata */
  function checkCreate(meta) {
    if (!meta || typeof meta !== 'object') return blocked('create', '缺少 metadata');
    var name = meta.name;
    if (!isAllowedFolderName(name) && !isAllowedFileName(name)) {
      return blocked('create', "建立名稱不在白名單：" + name);
    }
    var ps = meta.parents || [];
    for (var i = 0; i < ps.length; i++) {
      if (!isKnownFolder(ps[i])) {
        return blocked('create', "建立於未註冊的資料夾 ID：" + ps[i]);
      }
    }
    return null;
  }

  /* 從 list 回應學習資料夾／檔案 ID（只學白名單內的） */
  function learnFromList(json) {
    if (!json || !json.files) return;
    for (var i = 0; i < json.files.length; i++) {
      var f = json.files[i];
      if (!f || !f.id) continue;
      if (f.mimeType === 'application/vnd.google-apps.folder') regFolder(f.id, f.name);
      else regFile(f.id, f.name);
    }
  }

  /* ---------- 包裝 GDrive ---------- */
  var wrapped = false;

  function wrap() {
    var G = global.GDrive;
    if (!G || G.__driveGuarded) return G;
    G.__driveGuarded = true;
    wrapped = true;

    var origApi = G.api;
    var origUpload = G.uploadMultipart;
    var origUpdate = G.updateFileContent;
    var origDelete = G.deleteFile;
    var origFetch = G.fetchBlob;

    /* api(path, opts) */
    G.api = function (path, opts) {
      opts = opts || {};
      var p = String(path || '');
      var method = String(opts.method || 'GET').toUpperCase();

      /* 1) list 查詢 */
      if (p.indexOf('/drive/v3/files?') === 0 || p.indexOf('/drive/v3/files/?') === 0) {
        var err = checkList(p);
        if (err) return Promise.reject(err);
        return origApi.call(G, path, opts).then(function (j) { learnFromList(j); return j; });
      }

      /* 2) 建立檔案／資料夾 */
      if ((p === '/drive/v3/files' || p === '/drive/v3/files/') && method === 'POST') {
        var meta = null;
        try { meta = opts.body ? JSON.parse(opts.body) : null; } catch (e) { meta = null; }
        var e2 = checkCreate(meta);
        if (e2) return Promise.reject(e2);
        return origApi.call(G, path, opts).then(function (j) {
          if (j && j.id) {
            if (j.mimeType === 'application/vnd.google-apps.folder') regFolder(j.id, j.name || (meta && meta.name));
            else regFile(j.id, j.name || (meta && meta.name));
          }
          return j;
        });
      }

      /* 3) 單一檔案操作（讀／改／刪） */
      var mf = /^\/drive\/v3\/files\/([^\/\?]+)/.exec(p);
      if (mf) {
        var fid = mf[1];
        if (!isKnownFile(fid)) {
          return Promise.reject(blocked(method.toLowerCase(), "未註冊的檔案 ID：" + fid));
        }
        return origApi.call(G, path, opts);
      }

      /* 4) about 等唯讀端點：放行 */
      return origApi.call(G, path, opts);
    };

    /* uploadMultipart(form, fields) */
    if (typeof origUpload === 'function') {
      G.uploadMultipart = function (form, fields) {
        return readMeta(form).then(function (meta) {
          var e = checkCreate(meta);
          if (e) return Promise.reject(e);
          return origUpload.call(G, form, fields).then(function (j) {
            if (j && j.id) regFile(j.id, j.name || (meta && meta.name));
            return j;
          });
        });
      };
    }

    /* updateFileContent(fileId, blob, mime) */
    if (typeof origUpdate === 'function') {
      G.updateFileContent = function (fileId, blob, mime) {
        if (!isKnownFile(fileId)) return Promise.reject(blocked('update', "未註冊的檔案 ID：" + fileId));
        return origUpdate.call(G, fileId, blob, mime);
      };
    }

    /* deleteFile(fileId, permanent) */
    if (typeof origDelete === 'function') {
      G.deleteFile = function (fileId, permanent) {
        if (!isKnownFile(fileId)) return Promise.reject(blocked('delete', "未註冊的檔案 ID：" + fileId));
        return origDelete.call(G, fileId, permanent);
      };
    }

    /* fetchBlob(fileId) */
    if (typeof origFetch === 'function') {
      G.fetchBlob = function (fileId) {
        if (!isKnownFile(fileId)) return Promise.reject(blocked('read', "未註冊的檔案 ID：" + fileId));
        return origFetch.call(G, fileId);
      };
    }

    return G;
  }

  function readMeta(form) {
    try {
      var m = form && form.get ? form.get('metadata') : null;
      if (!m) return Promise.resolve(null);
      if (typeof m === 'string') {
        try { return Promise.resolve(JSON.parse(m)); } catch (e) { return Promise.resolve(null); }
      }
      if (m.text) return m.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } });
    } catch (e) {}
    return Promise.resolve(null);
  }

  /* ---------- 對外 ---------- */
  global.DriveGuard = {
    FOLDER_NAMES: FOLDER_NAMES,
    isAllowedFolderName: isAllowedFolderName,
    isAllowedFileName: isAllowedFileName,
    registerFolder: regFolder,
    registerFile: regFile,
    isKnownFolder: isKnownFolder,
    isKnownFile: isKnownFile,
    checkList: checkList,
    checkCreate: checkCreate,
    log: function () { return memLog.slice(); },
    clearLog: function () { memLog = []; try { global.localStorage.removeItem(LOG_KEY); } catch (e) {} },
    wrap: wrap,
    _parseQuery: parseQuery
  };

  /* gdrive-photo.js 會把 GDrive 換成 merged 物件，所以載入後與 DOM 就緒時各包一次 */
  wrap();
  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', wrap);
    } else {
      setTimeout(wrap, 0);
    }
  }
})(typeof window !== 'undefined' ? window : this);
