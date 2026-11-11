(function(){
  'use strict';

  var HIST_KEY = 'inspection-drive-photo-history';
  var FILTER_KEY = 'inspection-drive-photo-filter';
  var WM_KEY = 'inspection-drive-photo-watermark';
  var IMPORTED_KEY = 'inspection-drive-photo-imported';

  var $ = function(id){ return document.getElementById(id); };
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  /* ---------- 小工具 ---------- */
  function pad2(n){ return (n < 10 ? '0' : '') + n; }
  function todayISO(){
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function compactDate(iso){ return String(iso || '').replace(/-/g, ''); }
  function hhmmss(){
    var d = new Date();
    return pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }
  function fmtSize(b){
    if (!b || b < 0) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }
  function safeName(s){
    return String(s || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 40);
  }

  var toastTimer = null;
  function toast(msg, isErr){
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.className = 'toast'; }, 3000);
  }

  /* ---------- 狀態 ---------- */
  var queue = [];
  var history = [];
  var uploading = false;
  var wmOn = true;
  var previewKey = null;
  var selected = {};
  var filter = { mode: 'all', from: '', to: '' };

  /* ---------- 儲存 ---------- */
  function loadHist(){
    try {
      var raw = localStorage.getItem(HIST_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      history = Array.isArray(arr) ? arr : [];
    } catch (e) { history = []; }
  }
  function saveHist(){
    try { localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(0, 800))); } catch (e) {}
  }
  function loadFilter(){
    try {
      var raw = localStorage.getItem(FILTER_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (o && (o.mode === 'all' || o.mode === 'day' || o.mode === 'range')) {
        filter.mode = o.mode;
        filter.from = o.from || '';
        filter.to = o.to || '';
      }
    } catch (e) {}
  }
  function saveFilter(){
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch (e) {}
  }
  function loadWm(){
    try {
      var v = localStorage.getItem(WM_KEY);
      if (v === '0') wmOn = false;
      else if (v === '1') wmOn = true;
    } catch (e) {}
  }
  function saveWm(){
    try { localStorage.setItem(WM_KEY, wmOn ? '1' : '0'); } catch (e) {}
  }

  /* ---------- 連線狀態 ---------- */
  var lastConnState = null;
  function tokenSpill(){
    try {
      var raw = localStorage.getItem('inspection-gdrive-token');
      if (!raw) return '';
      var o = JSON.parse(raw);
      if (!o || !o.expires_at) return '';
      var left = Number(o.expires_at) - Date.now();
      if (left <= 0) return '<span class="tokenspill warn">權杖已過期</span>';
      var m = Math.ceil(left / 60000);
      return '<span class="tokenspill">權杖尚餘 ' + (m > 60 ? Math.floor(m / 60) + ' 小時 ' + (m % 60) + ' 分' : m + ' 分鐘') + '</span>';
    } catch (e) { return ''; }
  }

  function renderConn(){
    var G = window.GDrive || {};
    var st = (G.getStatus ? G.getStatus() : {}) || {};
    var connected = !!(G.hasToken && G.hasToken());
    var email = st.email || (G.getEmail ? G.getEmail() : '') || '';
    var tag = $('connTag');

    if (connected) {
      $('connDot').className = 'dot on';
      $('connTxt').innerHTML = '已連線 Google Drive ' + tokenSpill();
      $('connMail').textContent = email ? email : '（已取得授權）';
      tag.textContent = '已連線';
      tag.className = 'tag ok';
      $('connWarn').style.display = 'none';
      $('relinkWarn').style.display = 'none';
      $('btnConnect').style.display = 'none';
      $('btnSwitch').style.display = '';
      $('btnLogout').style.display = '';
    } else {
      /* 未連線：只有「真的需要重新授權」才顯示失效；已登出或從未連線都算未連線 */
      var signedOut = !!(G.isSignedOut && G.isSignedOut());
      var needRelink = !signedOut && (st.state === 'expired' || st.state === 'unauthorized');
      $('connDot').className = 'dot';
      $('connTxt').textContent = needRelink ? '授權已失效' : '尚未連線';
      $('connMail').textContent = '需要授權一次才能上傳到你的 Google Drive';
      tag.textContent = needRelink ? '需重新連線' : '未連線';
      tag.className = needRelink ? 'tag bad' : 'tag';
      $('connWarn').style.display = needRelink ? 'none' : '';
      $('btnConnect').style.display = '';
      $('btnSwitch').style.display = 'none';
      $('btnLogout').style.display = needRelink ? '' : 'none';
    }
    $('connErr').style.display = 'none';
  }
  function connErr(msg){
    var e = $('connErr');
    e.textContent = msg;
    e.style.display = 'block';
  }

  /* ---------- 自動連線／匯入提示框 ---------- */
  function syncBoxShow(title, msg, opts){
    opts = opts || {};
    var b = $('syncBox');
    b.className = 'syncbox on' + (opts.err ? ' err' : (opts.warn ? ' warn' : ''));
    $('syncIcon').textContent = opts.icon || '⏳';
    $('syncTitle').textContent = title;
    $('syncMsg').textContent = msg || '';
    var barWrap = $('syncBarWrap');
    if (opts.pct === null || opts.pct === undefined) {
      barWrap.style.display = 'none';
    } else {
      barWrap.style.display = '';
      $('syncBar').style.width = Math.max(0, Math.min(100, opts.pct)) + '%';
    }
  }
  function syncBoxHide(){
    $('syncBox').className = 'syncbox';
    $('syncBarWrap').style.display = '';
    $('syncBar').style.width = '0%';
  }

  $('btnConnect').addEventListener('click', function(){
    var G = window.GDrive;
    if (!G || !G.connect) { connErr('Google 授權模組未載入，請重新整理頁面。'); return; }
    var self = this;
    self.disabled = true;
    syncBoxShow('正在連線 Google Drive…', '請在彈出的視窗選擇你的 Google 帳號並同意授權。', { pct: null });
    G.connect().then(function(){
      syncBoxHide();
      $('relinkWarn').style.display = 'none';
      renderConn();
      toast('已連線 Google Drive');
      return G.getUser ? G.getUser() : null;
    }).then(function(){
      renderConn();
      importFromDrive(true);
    }).catch(function(err){
      syncBoxHide();
      connErr((G.friendlyError ? G.friendlyError(err) : String((err && err.message) || err)));
      toast('連線失敗', true);
    }).then(function(){ self.disabled = false; });
  });

  function doDisconnect(reconnect){
    var G = window.GDrive;
    try { if (G && G.disconnect) G.disconnect(); } catch (e) {}
    renderConn();
    if (reconnect && G && G.connect) {
      syncBoxShow('正在切換帳號…', '請在彈出的視窗選擇另一個 Google 帳號。', { pct: null });
      G.connect().then(function(){
        syncBoxHide();
        renderConn();
        toast('已切換帳號');
        return G.getUser ? G.getUser() : null;
      }).then(function(){ renderConn(); importFromDrive(true); }).catch(function(){ syncBoxHide(); });
    } else {
      syncBoxHide();
      $('relinkWarn').style.display = 'none';
      $('connWarn').style.display = '';
      toast('已登出 Google Drive（本機權杖已清除）');
    }
  }
  $('btnLogout').addEventListener('click', function(){ doDisconnect(false); });
  $('btnSwitch').addEventListener('click', function(){ doDisconnect(true); });

  /* ---------- 從 Drive 匯入已上傳紀錄 ---------- */
  var importing = false;
  var lastImportAt = '';

  function importFromDrive(manual){
    var G = window.GDrive;
    if (importing) return;
    if (!G || !G.listPhotoRecords) { if (manual) toast('匯入模組未載入', true); return; }
    if (!G.hasToken || !G.hasToken()) {
      if (manual) toast('請先連線 Google Drive 才能匯入紀錄', true);
      return;
    }
    importing = true;
    var btn = $('btnSyncNow');
    btn.disabled = true;
    btn.textContent = '↻ 匯入中…';
    syncBoxShow('正在從 Google Drive 匯入紀錄…', '尋找「營建相片」資料夾…', { pct: 8 });

    G.listPhotoRecords({
      onProgress: function(p){
        var pct = 8;
        if (p.phase === 'folders') pct = 15;
        else if (p.phase === 'files') pct = 15 + Math.round((p.current / Math.max(1, p.total)) * 80);
        else if (p.phase === 'done') pct = 100;
        syncBoxShow('正在從 Google Drive 匯入紀錄…', p.message, { pct: pct });
      }
    }).then(function(res){
      var stats = mergeImported(res.records || []);
      lastImportAt = new Date().toISOString();
      try { localStorage.setItem(IMPORTED_KEY, JSON.stringify({
        at: lastImportAt,
        folders: res.scanned || 0,
        found: (res.records || []).length,
        added: stats.added,
        updated: stats.updated
      })); } catch (e) {}

      applyFilterUI();
      renderHist();
      var msg = stats.added || stats.updated
        ? ('新增 ' + stats.added + ' 筆、更新 ' + stats.updated + ' 筆')
        : '沒有新紀錄（本機已是最新）';
      syncBoxShow('已從 Google Drive 同步完成',
        '讀取 ' + (res.scanned || 0) + ' 個日期資料夾、' + (res.records || []).length + ' 個檔案；' + msg + '。',
        { icon: '✓', pct: 100 });
      setTimeout(syncBoxHide, 6000);
      if (manual) toast('已從 Drive 匯入：' + msg);
    }).catch(function(e){
      var why = (G.friendlyError ? G.friendlyError(e) : ((e && e.message) || String(e)));
      syncBoxShow('匯入失敗（本機紀錄已保留）', why, { icon: '⚠', err: true, pct: null });
      toast('匯入失敗，已保留本機紀錄', true);
      if (e && (e.code === 'NEED_INTERACTIVE' || /授權已過期/.test(why))) {
        $('relinkWhy').textContent = why;
        $('relinkWarn').style.display = '';
        renderConn();
      }
    }).then(function(){
      importing = false;
      btn.disabled = false;
      btn.textContent = '↻ 從 Drive 匯入';
    });
  }

  /**
   * 把 Drive 讀回來的紀錄併入本機：以 Drive 檔案 ID 為鍵去重。
   * - 本機已有的（同 ID）只補空欄位（日期／工項／說明／大小），不覆蓋既有值
   * - 本機沒有的才新增
   */
  function mergeImported(recs){
    var byId = {};
    history.forEach(function(h){ if (h && h.id) byId[h.id] = h; });
    var added = 0, updated = 0;

    recs.forEach(function(r){
      if (!r || !r.id) return;
      var cur = byId[r.id];
      if (!cur) {
        history.push({
          id: r.id,
          name: r.name || '',
          link: r.link || ('https://drive.google.com/file/d/' + r.id + '/view'),
          date: r.date || '',
          item: r.item || '',
          note: r.note || '',
          size: r.size || 0,
          watermark: '',
          uploadedAt: r.uploadedAt || '',
          source: 'drive'
        });
        byId[r.id] = history[history.length - 1];
        added++;
      } else {
        var ch = false;
        if (!cur.date && r.date) { cur.date = r.date; ch = true; }
        if (!cur.item && r.item) { cur.item = r.item; ch = true; }
        if (!cur.note && r.note) { cur.note = r.note; ch = true; }
        if (!cur.size && r.size) { cur.size = r.size; ch = true; }
        if (!cur.link && r.link) { cur.link = r.link; ch = true; }
        if (!cur.uploadedAt && r.uploadedAt) { cur.uploadedAt = r.uploadedAt; ch = true; }
        if (ch) updated++;
      }
    });

    if (added || updated) {
      /* 依歸檔日期新→舊、同日再依上傳時間新→舊排序 */
      history.sort(function(a, b){
        if (a.date !== b.date) return a.date < b.date ? 1 : -1;
        return String(b.uploadedAt || '') < String(a.uploadedAt || '') ? -1 : 1;
      });
      saveHist();
    }
    return { added: added, updated: updated };
  }

  $('btnSyncNow').addEventListener('click', function(){ importFromDrive(true); });

  /* ---------- 浮水印 ---------- */
  function applyWmUI(){
    $('chkWm').checked = wmOn;
    $('wmState').textContent = wmOn ? '開啟' : '關閉';
  }
  $('chkWm').addEventListener('change', function(){
    wmOn = this.checked;
    saveWm();
    applyWmUI();
    renderPreview();
    toast(wmOn ? '已開啟歸檔日期浮水印' : '已關閉浮水印（相片原樣上傳）');
  });

  var previewBusy = false;
  function renderPreview(){
    var wrap = $('prevWrap');
    var q = null;
    if (previewKey) q = queue.filter(function(x){ return x.key === previewKey; })[0];
    if (!q) q = queue[0];
    if (!q) { wrap.classList.remove('on'); previewKey = null; return; }
    previewKey = q.key;
    wrap.classList.add('on');

    var dateISO = $('fDate').value || todayISO();
    var WM = window.PhotoWatermark;
    if (!WM) {
      $('prevTag').textContent = '無法預覽';
      $('prevTag').className = 'tag';
      $('prevNote').textContent = '浮水印模組未載入。';
      return;
    }
    if (previewBusy) return;
    previewBusy = true;
    $('prevTag').textContent = '產生中…';
    $('prevTag').className = 'tag';

    WM.loadImageFromBlob(q.file).then(function(img){
      var out;
      try {
        out = WM.previewDataURL(img, {
          maxEdge: 2000, date: dateISO, watermark: wmOn, detect: true
        });
      } finally { try { img.release(); } catch (e) {} }
      $('prevImg').src = out.url;
      if (out.detected) {
        $('prevTag').textContent = '未壓（已有時間戳）';
        $('prevTag').className = 'tag';
        $('prevNote').innerHTML = '偵測到相片底部<b>已有相機時間戳</b>，依需求<b>不重複壓</b>，將原樣上傳。';
      } else if (out.applied) {
        $('prevTag').textContent = '已壓浮水印';
        $('prevTag').className = 'tag ok';
        $('prevNote').innerHTML = '浮水印已壓在<b>右下角</b>，日期 <b>' + esc(dateISO) +
          '</b>；上傳到 Drive 的 JPEG 檔本身就帶此浮水印。';
      } else {
        $('prevTag').textContent = '未壓浮水印';
        $('prevTag').className = 'tag';
        $('prevNote').innerHTML = '浮水印開關為<b>關閉</b>，相片將原樣（僅壓縮）上傳。';
      }
    }).catch(function(){
      $('prevTag').textContent = '無法預覽';
      $('prevTag').className = 'tag';
      $('prevNote').textContent = '此檔案無法解碼預覽（仍會嘗試上傳）。';
    }).then(function(){ previewBusy = false; });
  }
  $('btnPrevRefresh').addEventListener('click', function(){ renderPreview(); });
  $('fDate').addEventListener('change', function(){ renderPreview(); });

  /* ---------- 檔名 ---------- */
  function buildFilename(dateISO, item, seq){
    var d = compactDate(dateISO) || compactDate(todayISO());
    var mid = safeName(item);
    if (!mid) mid = hhmmss();
    var n = pad2(seq);
    var base = d + '_' + mid + '_' + n;
    var taken = {};
    history.forEach(function(h){ if (h.date === dateISO) taken[h.name] = 1; });
    var guard = 0;
    while (taken[base + '.jpg'] && guard < 200) {
      seq++;
      n = pad2(seq);
      base = d + '_' + mid + '_' + n;
      guard++;
    }
    return base + '.jpg';
  }

  /* ---------- 佇列 ---------- */
  function addFiles(fileList){
    var added = 0;
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (!f || !/^image\//.test(f.type)) continue;
      queue.push({
        key: 'q' + Date.now() + '_' + i,
        file: f,
        url: URL.createObjectURL(f),
        status: 'wait',
        msg: '',
        result: null,
        wm: null
      });
      added++;
    }
    if (!added) { toast('沒有可用的圖片檔', true); return; }
    renderQueue();
    if (!previewKey) previewKey = queue[0].key;
    renderPreview();
    toast('已加入 ' + added + ' 張相片');
  }

  function updateUploadBtn(){
    var waiting = queue.filter(function(q){ return q.status === 'wait' || q.status === 'fail'; }).length;
    var btn = $('btnUpload');
    btn.disabled = uploading || waiting === 0;
    btn.textContent = waiting ? ('☁ 開始上傳（' + waiting + '）') : '☁ 開始上傳';
    $('queueTag').textContent = queue.length + ' 張';
    var done = queue.filter(function(q){ return q.status === 'done'; }).length;
    $('uploadHint').textContent = uploading
      ? '上傳中，請勿關閉頁面…'
      : (queue.length ? ('待上傳 ' + waiting + ' 張 · 已完成 ' + done + ' 張') : '請先加入相片');
  }

  function statusPill(q){
    if (q.status === 'done') return '<span class="pill done">已上傳</span>';
    if (q.status === 'up') return '<span class="pill up">上傳中…</span>';
    if (q.status === 'fail') return '<span class="pill fail">失敗</span>';
    return '<span class="pill wait">待上傳</span>';
  }
  function wmPill(q){
    if (!q.wm) return '';
    if (q.wm.applied) return '　<span class="pill up">已壓浮水印</span>';
    if (q.wm.detected) return '　<span class="pill wait">已有時間戳，未重複壓</span>';
    return '　<span class="pill wait">未壓浮水印</span>';
  }

  function renderQueue(){
    var box = $('queueList');
    if (!queue.length) {
      box.innerHTML = '<div class="empty">尚未加入相片。<br>點上方虛線區選取，或按「📷 直接拍攝」。</div>';
      $('prevWrap').classList.remove('on');
      previewKey = null;
      updateUploadBtn();
      return;
    }
    var html = '';
    queue.forEach(function(q){
      var retry = (q.status === 'fail')
        ? '<button type="button" data-retry="' + q.key + '">重試</button>' : '';
      html +=
        '<div class="item' + (q.key === previewKey ? ' sel' : '') + '" data-key="' + q.key + '">' +
          '<div class="thumb" data-prev="' + q.key + '" title="點此預覽浮水印">' +
            '<img src="' + q.url + '" alt="">' +
          '</div>' +
          '<div class="meta">' +
            '<div class="nm">' + esc(q.file.name) + '</div>' +
            '<div class="dt">' + fmtSize(q.file.size) + '　' + statusPill(q) + wmPill(q) +
              (q.msg ? '　<span style="color:#b3261e;">' + esc(q.msg) + '</span>' : '') +
              (q.result ? '　<span style="color:#1f7a4d;">' + esc(q.result.name) + '</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="acts">' + retry +
            '<button type="button" data-remove="' + q.key + '">移除</button>' +
          '</div>' +
        '</div>';
    });
    box.innerHTML = html;

    box.querySelectorAll('[data-prev]').forEach(function(b){
      b.addEventListener('click', function(){
        previewKey = b.getAttribute('data-prev');
        renderQueue();
        renderPreview();
      });
    });
    box.querySelectorAll('[data-retry]').forEach(function(b){
      b.addEventListener('click', function(){
        if (uploading) { toast('上傳中，請稍候', true); return; }
        var k = b.getAttribute('data-retry');
        var q = queue.filter(function(x){ return x.key === k; })[0];
        if (!q) return;
        q.status = 'wait'; q.msg = '';
        renderQueue();
        runUpload([q]);
      });
    });
    box.querySelectorAll('[data-remove]').forEach(function(b){
      b.addEventListener('click', function(){
        if (uploading) { toast('上傳中，請稍候', true); return; }
        var k = b.getAttribute('data-remove');
        queue = queue.filter(function(x){
          if (x.key === k) { try { URL.revokeObjectURL(x.url); } catch (e) {} return false; }
          return true;
        });
        if (previewKey === k) previewKey = queue.length ? queue[0].key : null;
        renderQueue();
        renderPreview();
      });
    });
    updateUploadBtn();
  }

  /* ---------- 上傳 ---------- */
  function prepareBlob(file, dateISO){
    var G = window.GDrive;
    if (G && G.preparePhotoBlob) {
      return G.preparePhotoBlob(file, {
        date: dateISO, watermark: wmOn, maxEdge: 2000, quality: 0.88, detect: true
      });
    }
    return Promise.resolve({ blob: file, applied: false, detected: false });
  }

  function runUpload(list){
    if (uploading) return;
    if (!window.GDrive || !window.GDrive.hasToken || !window.GDrive.hasToken()) {
      toast('請先連線 Google Drive', true);
      $('connWarn').style.display = '';
      return;
    }
    if (!list || !list.length) return;

    var dateISO = $('fDate').value || todayISO();
    var item = $('fItem').value.trim();
    var note = $('fNote').value.trim();

    uploading = true;
    updateUploadBtn();
    $('progWrap').classList.add('on');

    var total = list.length;
    var done = 0, failed = 0;

    function tick(){
      var pct = Math.round((done + failed) / total * 100);
      $('progBar').style.width = pct + '%';
      $('progTxt').textContent = '已完成 ' + done + ' / ' + total + ' 張' +
        (failed ? '（失敗 ' + failed + ' 張，可單張重試）' : '');
    }
    tick();

    var seqBase = history.filter(function(h){ return h.date === dateISO; }).length;

    var chain = Promise.resolve();
    list.forEach(function(q, idx){
      chain = chain.then(function(){
        if (q.status === 'done') { done++; tick(); return; }
        q.status = 'up'; q.msg = '';
        renderQueue();
        return prepareBlob(q.file, dateISO).then(function(prep){
          var seq = seqBase + idx + 1;
          var name = buildFilename(dateISO, item, seq);
          var desc = [note, item ? ('工項：' + item) : '', '歸檔日期：' + dateISO].filter(Boolean).join('｜');
          q.wm = { applied: !!prep.applied, detected: !!prep.detected };
          return window.GDrive.uploadPhoto({
            blob: prep.blob, filename: name, date: dateISO, description: desc
          });
        }).then(function(res){
          q.status = 'done';
          q.result = res;
          history.unshift({
            id: res.id,
            name: res.name,
            link: res.webViewLink || ('https://drive.google.com/file/d/' + res.id + '/view'),
            date: dateISO,
            item: item,
            note: note,
            size: res.size || 0,
            watermark: q.wm ? (q.wm.applied ? 'applied' : (q.wm.detected ? 'skipped-existing' : 'off')) : 'off',
            uploadedAt: new Date().toISOString()
          });
          saveHist();
          done++;
        }).catch(function(e){
          q.status = 'fail';
          q.msg = (window.GDrive.friendlyError ? window.GDrive.friendlyError(e)
            : ((e && e.message) ? e.message : String(e))) || '未知錯誤';
          failed++;
        }).then(function(){
          tick();
          renderQueue();
          renderHist();
        });
      });
    });

    chain.then(function(){
      uploading = false;
      updateUploadBtn();
      $('progTxt').textContent = '已完成 ' + done + ' / ' + total + ' 張' +
        (failed ? '（失敗 ' + failed + ' 張，可單張重試）' : '　✓ 全部完成');
      if (!failed) {
        queue.forEach(function(q){ try { URL.revokeObjectURL(q.url); } catch (e) {} });
        queue = [];
        renderQueue();
      }
      toast(failed ? ('上傳完成，' + failed + ' 張失敗可重試') : ('已上傳 ' + done + ' 張到 Google Drive'), !!failed);
    });
  }

  $('btnUpload').addEventListener('click', function(){
    var list = queue.filter(function(q){ return q.status === 'wait' || q.status === 'fail'; });
    runUpload(list);
  });

  $('btnClear').addEventListener('click', function(){
    if (uploading) { toast('上傳中，請稍候', true); return; }
    queue.forEach(function(q){ try { URL.revokeObjectURL(q.url); } catch (e) {} });
    queue = [];
    previewKey = null;
    renderQueue();
    $('progWrap').classList.remove('on');
  });

  $('btnCamera').addEventListener('click', function(){ $('camInput').click(); });
  $('camInput').addEventListener('change', function(){
    if (this.files && this.files.length) addFiles(this.files);
    this.value = '';
  });

  var drop = $('drop');
  drop.addEventListener('click', function(){ $('fileInput').click(); });
  $('fileInput').addEventListener('change', function(){
    if (this.files && this.files.length) addFiles(this.files);
    this.value = '';
  });
  ['dragenter','dragover'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave','drop'].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function(e){
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  /* ---------- 日期篩選 ---------- */
  function applyFilterUI(){
    [].forEach.call($('segFilter').children, function(b){
      b.classList.toggle('on', b.getAttribute('data-mode') === filter.mode);
    });
    var isDay = filter.mode === 'day';
    var isRange = filter.mode === 'range';
    $('fFrom').style.display = (isDay || isRange) ? '' : 'none';
    $('sepRange').style.display = isRange ? '' : 'none';
    $('fTo').style.display = isRange ? '' : 'none';
    $('fFrom').value = filter.from || '';
    $('fTo').value = filter.to || '';
    $('btnClearFilter').disabled = (filter.mode === 'all');
  }

  function filtered(){
    if (filter.mode === 'all') return history;
    if (filter.mode === 'day') {
      if (!filter.from) return history;
      return history.filter(function(h){ return h.date === filter.from; });
    }
    var a = filter.from, b = filter.to;
    if (a && b && a > b) { var t = a; a = b; b = t; }
    return history.filter(function(h){
      if (a && h.date < a) return false;
      if (b && h.date > b) return false;
      return true;
    });
  }

  $('segFilter').addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('button[data-mode]') : null;
    if (!b) return;
    filter.mode = b.getAttribute('data-mode');
    if (filter.mode === 'day' && !filter.from) filter.from = todayISO();
    if (filter.mode === 'range') {
      if (!filter.from) filter.from = todayISO();
      if (!filter.to) filter.to = todayISO();
    }
    saveFilter();
    applyFilterUI();
    renderHist();
  });

  $('fFrom').addEventListener('change', function(){
    filter.from = this.value;
    if (filter.mode === 'range' && filter.to && filter.from && filter.from > filter.to) {
      filter.to = filter.from;
      $('fTo').value = filter.to;
      toast('起日晚於迄日，已自動調整為同一天');
    }
    saveFilter();
    renderHist();
  });
  $('fTo').addEventListener('change', function(){
    filter.to = this.value;
    if (filter.from && filter.to && filter.to < filter.from) {
      filter.from = filter.to;
      $('fFrom').value = filter.from;
      toast('迄日早於起日，已自動調整為同一天');
    }
    saveFilter();
    renderHist();
  });

  $('btnClearFilter').addEventListener('click', function(){
    filter = { mode: 'all', from: '', to: '' };
    saveFilter();
    applyFilterUI();
    renderHist();
    toast('已顯示全部紀錄');
  });

  /* ---------- 勾選與批次 ---------- */
  function selectedList(){
    var f = filtered();
    return f.filter(function(h){ return selected[h.id]; });
  }
  function updateSelUI(){
    var n = Object.keys(selected).filter(function(k){ return selected[k]; }).length;
    var sc = $('selCount');
    sc.textContent = '已選 ' + n + ' 筆';
    sc.className = 'selcount' + (n ? '' : ' zero');
    ['btnCopy','btnTxt','btnCsv','btnZip'].forEach(function(id){
      $(id).disabled = (n === 0);
    });
    var f = filtered();
    var allSel = f.length > 0 && f.every(function(h){ return selected[h.id]; });
    $('chkAll').checked = allSel;
    $('chkAll').disabled = (f.length === 0);
  }

  $('chkAll').addEventListener('change', function(){
    var on = this.checked;
    filtered().forEach(function(h){ if (on) selected[h.id] = true; else delete selected[h.id]; });
    renderHist();
  });

  /* ---------- 紀錄清單 ---------- */
  function histWmPill(h){
    if (h.watermark === 'applied') return '　<span class="pill up">已壓浮水印</span>';
    if (h.watermark === 'skipped-existing') return '　<span class="pill wait">已有時間戳</span>';
    return '';
  }

  function renderHist(){
    var box = $('histList');
    var f = filtered();
    $('histTag').textContent = history.length + ' 筆';
    $('fCount').textContent = '符合 ' + f.length + ' 筆 / 共 ' + history.length + ' 筆';

    var ids = {};
    history.forEach(function(h){ ids[h.id] = 1; });
    Object.keys(selected).forEach(function(k){ if (!ids[k]) delete selected[k]; });

    if (!history.length) {
      box.innerHTML = '<div class="empty">尚無上傳紀錄。<br>上傳成功的相片會列在這裡，並保留 Drive 連結。</div>';
      updateSelUI();
      return;
    }
    if (!f.length) {
      var desc = filter.mode === 'day'
        ? ('單日 ' + (filter.from || '—'))
        : (filter.mode === 'range'
            ? ('區間 ' + (filter.from || '—') + ' ～ ' + (filter.to || '—'))
            : '目前條件');
      box.innerHTML = '<div class="empty">' +
        '<b>此日期條件下沒有符合的紀錄</b><br>' +
        '目前篩選：' + esc(desc) + ' · 共有 ' + history.length + ' 筆紀錄<br>' +
        '可按「清除篩選／顯示全部」回到全部紀錄。' +
        '</div>';
      updateSelUI();
      return;
    }

    var html = '';
    f.forEach(function(h){
      var on = !!selected[h.id];
      html +=
        '<div class="item' + (on ? ' selon' : '') + '">' +
          '<label class="ck"><input type="checkbox" data-sel="' + esc(h.id) + '"' +
            (on ? ' checked' : '') + '></label>' +
          '<div class="meta">' +
            '<div class="nm">' + esc(h.name) + '</div>' +
            '<div class="dt">' + esc(h.date) + '　' + fmtSize(h.size) +
              (h.item ? '　' + esc(h.item) : '') +
              (h.note ? '　' + esc(h.note) : '') +
              '　<span class="pill done">已上傳</span>' + histWmPill(h) +
            '</div>' +
          '</div>' +
          '<div class="acts">' +
            '<a href="' + esc(h.link) + '" target="_blank" rel="noopener">在 Google Drive 開啟</a>' +
          '</div>' +
        '</div>';
    });
    box.innerHTML = html;

    box.querySelectorAll('[data-sel]').forEach(function(cb){
      cb.addEventListener('change', function(){
        var id = cb.getAttribute('data-sel');
        if (cb.checked) selected[id] = true; else delete selected[id];
        renderHist();
      });
    });
    updateSelUI();
  }

  /* ---------- 清單文字 ---------- */
  function buildText(items){
    var lines = [];
    lines.push('預壘樁查驗相片 — Google Drive 連結清單');
    lines.push('產生時間：' + new Date().toLocaleString('zh-TW'));
    lines.push('筆數：' + items.length + ' 筆');
    lines.push('根資料夾：營建相片');
    lines.push('');
    items.forEach(function(h, i){
      lines.push((i + 1) + '. ' + h.name);
      lines.push('   歸檔日期：' + h.date +
        (h.item ? '　工項／墩號樁號：' + h.item : '') +
        (h.note ? '　說明：' + h.note : '') +
        '　大小：' + fmtSize(h.size));
      lines.push('   Google Drive：' + h.link);
    });
    return lines.join('\r\n');
  }
  function buildCsv(items){
    function q(v){
      var s = String(v == null ? '' : v);
      return '"' + s.replace(/"/g, '""') + '"';
    }
    var rows = ['序號,檔名,歸檔日期,工項／墩號樁號,說明,檔案大小,Google Drive 連結'];
    items.forEach(function(h, i){
      rows.push([i + 1, q(h.name), q(h.date), q(h.item || ''), q(h.note || ''),
        q(fmtSize(h.size)), q(h.link)].join(','));
    });
    return '\ufeff' + rows.join('\r\n');
  }
  function download(name, text, mime){
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }
  function stamp(){
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '_' +
      pad2(d.getHours()) + pad2(d.getMinutes());
  }

  $('btnCopy').addEventListener('click', function(){
    var items = selectedList();
    if (!items.length) { toast('請先勾選至少一筆紀錄', true); return; }
    var text = buildText(items);
    function fallback(){
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? ('已複製 ' + items.length + ' 筆連結') : '複製失敗，請改用「下載 TXT」', !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){
        toast('已複製 ' + items.length + ' 筆連結');
      }).catch(fallback);
    } else fallback();
  });

  $('btnTxt').addEventListener('click', function(){
    var items = selectedList();
    if (!items.length) { toast('請先勾選至少一筆紀錄', true); return; }
    download('相片連結清單_' + stamp() + '.txt', buildText(items), 'text/plain');
    toast('已下載 ' + items.length + ' 筆的 TXT 清單');
  });

  $('btnCsv').addEventListener('click', function(){
    var items = selectedList();
    if (!items.length) { toast('請先勾選至少一筆紀錄', true); return; }
    download('相片連結清單_' + stamp() + '.csv', buildCsv(items), 'text/csv');
    toast('已下載 ' + items.length + ' 筆的 CSV 清單');
  });

  /* ---------- 打包下載 ---------- */
  function fileNameOf(h, idx){
    var n = safeName(h.name) || ('photo_' + (idx + 1) + '.jpg');
    if (!/\.jpe?g$/i.test(n)) n += '.jpg';
    return n;
  }

  $('btnZip').addEventListener('click', function(){
    var items = selectedList();
    if (!items.length) { toast('請先勾選至少一筆紀錄', true); return; }
    if (!window.JSZip) { toast('打包模組未載入，請重新整理頁面', true); return; }
    if (!window.GDrive || !window.GDrive.hasToken || !window.GDrive.hasToken()) {
      toast('請先連線 Google Drive 才能取回原始檔', true);
      return;
    }

    var btn = this;
    btn.disabled = true;
    $('batchProg').classList.add('on');
    $('batchBar').style.width = '0%';
    $('batchTxt').textContent = '準備打包 0 / ' + items.length + ' 張…';

    var zip = new window.JSZip();
    var okCount = 0;
    var failItems = [];
    var i = 0;

    function next(){
      if (i >= items.length) return finish();
      var h = items[i];
      $('batchTxt').textContent = '取回 ' + (i + 1) + ' / ' + items.length + ' 張：' + h.name;
      window.GDrive.fetchFile(h.id).then(function(blob){
        zip.file(fileNameOf(h, i), blob);
        okCount++;
      }).catch(function(){
        failItems.push(h);
      }).then(function(){
        i++;
        $('batchBar').style.width = Math.round(i / items.length * 100) + '%';
        setTimeout(next, 0);
      });
    }

    function finish(){
      zip.file('連結清單.txt', buildText(items));
      zip.file('連結清單.csv', buildCsv(items));

      zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
        .then(function(blob){
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = '營建相片_' + stamp() + '.zip';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function(){ URL.revokeObjectURL(url); }, 8000);

          $('batchTxt').textContent = '已完成：打包 ' + okCount + ' 張' +
            (failItems.length ? ('，' + failItems.length + ' 張取回失敗，改為逐張開啟 Drive 連結') : '') +
            '（ZIP 內含連結清單 TXT／CSV）';
          toast('已打包 ' + okCount + ' 張相片', failItems.length > 0);

          if (failItems.length) {
            failItems.forEach(function(h, k){
              setTimeout(function(){
                try { window.open(h.link, '_blank', 'noopener'); } catch (e) {}
              }, k * 350);
            });
          }
        })
        .catch(function(err){
          $('batchTxt').textContent = '打包失敗：' + ((err && err.message) ? err.message : '未知錯誤');
          toast('打包失敗，可改勾單筆後逐張下載', true);
        })
        .then(function(){
          btn.disabled = false;
        });
    }

    next();
  });

  /* ---------- 匯出 JSON ---------- */
  $('btnExport').addEventListener('click', function(){
    var payload = {
      exportedAt: new Date().toISOString(),
      rootFolder: '營建相片',
      total: history.length,
      filter: filter,
      photos: history.map(function(h){
        return {
          id: h.id,
          name: h.name,
          link: h.link,
          date: h.date,
          item: h.item || '',
          note: h.note || '',
          size: h.size || 0,
          watermark: h.watermark || 'off',
          uploadedAt: h.uploadedAt || ''
        };
      })
    };
    download('相片歸檔記錄_' + stamp() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    toast('已匯出 ' + history.length + ' 筆紀錄（含 Drive 檔案 ID／連結）');
  });

  /* ---------- 啟動 ---------- */
  $('fDate').value = todayISO();
  loadHist();
  loadFilter();
  loadWm();
  applyWmUI();
  applyFilterUI();
  renderHist();
  renderQueue();
  renderConn();

  /*
   * 進入頁面自動連線：
   *   1. 先用本機尚未過期的權杖（同步，零網路）→ 直接進入已連線狀態
   *   2. 沒有可用權杖 → 靜默授權 prompt:'' 取回（不彈窗、不需按鈕）
   *   3. 靜默失敗（需互動／已登出／瀏覽器封鎖）→ 顯示「重新連線」並說明原因
   * 連線成功後自動從 Drive 匯入紀錄。
   */
  function autoConnectAndImport(){
    var G = window.GDrive;
    if (!G) { syncBoxHide(); return; }

    if (G.isSignedOut && G.isSignedOut()) {
      syncBoxHide();
      renderConn();
      $('connWarn').style.display = '';
      return;
    }

    /* 第一步：沿用本機權杖（未過期就不做任何網路授權） */
    if (G.restoreToken && G.restoreToken() && G.hasToken && G.hasToken()) {
      syncBoxShow('已沿用先前的授權', '正在從 Google Drive 匯入已上傳紀錄…', { icon: '✓', pct: 10 });
      renderConn();
      if (G.getUser) { G.getUser().then(function(){ renderConn(); }).catch(function(){}); }
      importFromDrive(false);
      return;
    }

    /* 第二步：靜默授權 */
    if (!G.silentConnect) { syncBoxHide(); renderConn(); return; }
    syncBoxShow('正在自動連線 Google Drive…', '使用先前的授權，不會開啟任何視窗。', { pct: null });

    G.silentConnect().then(function(){
      renderConn();
      return (G.getUser ? G.getUser() : null);
    }).then(function(){
      renderConn();
      return importFromDrive(false);
    }).catch(function(e){
      renderConn();
      var code = (e && e.code) || '';
      var why = (G.friendlyError ? G.friendlyError(e) : ((e && e.message) || String(e)));

      if (code === 'SIGNED_OUT') {
        syncBoxHide();
        $('connWarn').style.display = '';
        $('relinkWarn').style.display = 'none';
        renderConn();
        return;
      }

      /* 靜默續期失敗：需要使用者互動 */
      syncBoxHide();
      $('relinkWhy').textContent = why;
      $('relinkWarn').style.display = '';
      renderConn();
    });
  }

  window.addEventListener('focus', function(){
    renderConn();
    var G = window.GDrive;
    if (!G || !G.tokenExpiresAt) return;
    /* 回到頁面時若權杖即將過期（< 2 分鐘），自動靜默續期，不必使用者動手 */
    var exp = G.tokenExpiresAt();
    if (exp && (exp - Date.now()) < 120000 && G.ensureToken) {
      G.ensureToken().then(function(){ renderConn(); }).catch(function(){ renderConn(); });
    }
  });
  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) renderConn();
  });
  setTimeout(renderConn, 500);

  /* 頁面載入後立即嘗試自動連線 + 匯入 */
  autoConnectAndImport();

  /* 定時檢查權杖剩餘時間；快到期就靜默續期 */
  setInterval(function(){
    var G = window.GDrive;
    if (!G || !G.hasToken || !G.hasToken()) return;
    var exp = G.tokenExpiresAt ? G.tokenExpiresAt() : 0;
    if (exp && (exp - Date.now()) < 5 * 60 * 1000 && G.ensureToken) {
      G.ensureToken().then(function(){ renderConn(); }).catch(function(){ renderConn(); });
    }
    renderConn();
  }, 60000);
})();
