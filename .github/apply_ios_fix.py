# -*- coding: utf-8 -*-
import io, os, sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else "."

def edit(path, pairs):
    p = os.path.join(ROOT, path)
    s = io.open(p, encoding="utf-8").read()
    for old, new in pairs:
        if s.count(old) != 1:
            raise SystemExit("ANCHOR %d in %s: %s" % (s.count(old), path, old[:80]))
        s = s.replace(old, new)
    io.open(p, "w", encoding="utf-8", newline="").write(s)
    print("patched", path)

edit("assets/store.js", [
("""  function load() {
    var d = null;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) d = JSON.parse(raw);
    } catch (e) { d = null; }
""",
"""  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }

    /* 快取：load() 原本每次呼叫都 JSON.parse＋normalize＋recompute（iPhone 約 30ms／次）。
       log 頁的 refreshPileSelect() 會為每個墩號各呼叫一次（19 墩 → 約 570ms／次按鍵），
       打字時主執行緒被卡住，畫面因此「出不來」。以原始字串為鍵快取，內容沒變就不重算。 */
    if (raw !== null && raw === cacheRaw && cacheData) return cacheData;

    var d = null;
    if (raw) { try { d = JSON.parse(raw); } catch (e) { d = null; } }
"""),
("""    d = normalize(d);
    recompute(d);
    return d;
  }

  /**
   * 儲存。回傳 true／false。""",
"""    d = normalize(d);
    recompute(d);

    cacheRaw = raw;
    cacheData = d;
    return d;
  }

  /** 清掉 load() 快取（save() 之後呼叫） */
  function invalidate() { cacheRaw = null; cacheData = null; }

  /**
   * 儲存。回傳 true／false。"""),
("""  var lastError = '';

  function save(d) {
    lastError = '';
    try {
""",
"""  var lastError = '';

  /* load() 快取（見 load 內的說明） */
  var cacheRaw = null;
  var cacheData = null;

  function save(d) {
    lastError = '';
    invalidate();
    try {
"""),
("""  function logsOf(d, pier) {
    return (d.logs || []).filter(function (l) {
      if (logPiers(d, l).indexOf(pier) >= 0) return true;
      var nos = logPileNos(d, l);
      for (var i = 0; i < nos.length; i++) {
        var p = (d.piles || []).filter(function (x) { return x.pileNo === nos[i]; })[0];
        if (p && p.pier === pier) return true;
      }
      return false;
    })""",
"""  function logsOf(d, pier) {
    /* 原本在迴圈裡對每個樁號再 filter 一次 d.piles（O(logs×piles×piles)），
       121 支樁 × 300 筆紀錄在 iPhone 上約 10ms／次。先建 pileNo → pier 索引表即降為線性。 */
    var byNo = {};
    (d.piles || []).forEach(function (p) { byNo[p.pileNo] = p.pier; });
    return (d.logs || []).filter(function (l) {
      if (logPiers(d, l).indexOf(pier) >= 0) return true;
      var nos = logPileNos(d, l);
      for (var i = 0; i < nos.length; i++) {
        if (byNo[nos[i]] === pier) return true;
      }
      return false;
    })"""),
("""    LOG_WIDTHS: LOG_WIDTHS
  };""",
"""    LOG_WIDTHS: LOG_WIDTHS,
    invalidate: invalidate
  };"""),
])

edit("index.html", [
("""    font-size:15px;line-height:1.6;display:flex;flex-direction:column;height:100vh;overflow:hidden;""",
"""    font-size:15px;line-height:1.6;display:flex;flex-direction:column;overflow:hidden;
    /* iOS Safari 的 100vh 是「工具列收起時」的高度，載入當下比可視區高，搭配 overflow:hidden
       會把 iframe 底部推到畫面外、內容看起來「出不來」。先給 100vh 後備，再用 dvh 覆蓋；
       不支援 dvh 的舊機由 JS 以 --app-h 補上實際 innerHeight。 */
    height:100vh;height:100dvh;height:var(--app-h,100vh);"""),
("""    if(prev && (key === "progress" || key === "log")){
      try{ frames[key].contentWindow.location.reload(); }catch(e){}
    }""",
"""    /* 原本這裡直接 location.reload()，在 iPhone 上等於每次切頁都重新下載＋解析＋重繪
       整個頁面（紀錄表 300 筆時約 1.5 秒白畫面）。兩個子頁本身都已監聽 storage 與 focus
       會自行重讀，因此改為「只通知、不重載」；只有子頁尚未載入完成時才重載。 */
    if(prev && (key === "progress" || key === "log")){
      try{
        var w = frames[key].contentWindow;
        if(w && typeof w.SuiteStore !== "undefined"){
          try{ w.dispatchEvent(new Event("focus")); }catch(e2){}
        }else{
          frames[key].contentWindow.location.reload();
        }
      }catch(e){}
    }"""),
("""  var initial = (location.hash || "").replace("#","");""",
"""  /* 可視高度（iOS Safari 工具列）：100vh 在工具列顯示時比實際可視區高，會把 iframe
     底部推出畫面。把實際 innerHeight 寫進 --app-h，轉向／工具列伸縮時更新；
     只在高度真的變化時才寫入，避免 iOS 捲動時因網址列伸縮造成版面抖動。 */
  var lastH = 0;
  function syncAppHeight(){
    var h = window.innerHeight || 0;
    if (!h || Math.abs(h - lastH) < 2) return;
    lastH = h;
    document.documentElement.style.setProperty("--app-h", h + "px");
  }
  syncAppHeight();
  window.addEventListener("resize", syncAppHeight);
  window.addEventListener("orientationchange", function(){ setTimeout(syncAppHeight, 120); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncAppHeight);

  var initial = (location.hash || "").replace("#","");"""),
])

edit("log/index.html", [
("""<meta name="viewport" content="width=device-width, initial-scale=1.0">""",
"""<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="format-detection" content="telephone=no">"""),
("""  html,body{margin:0;padding:0;}
  body{""",
"""  html,body{margin:0;padding:0;}
  html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
  body{"""),
("""  .tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px;}""",
"""  .tblwrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:8px;}"""),
("""  .paper-wrap{background:#dfe4ea;border-radius:10px;padding:18px;overflow:auto;}""",
"""  .paper-wrap{background:#dfe4ea;border-radius:10px;padding:18px;overflow:auto;-webkit-overflow-scrolling:touch;}"""),
("""  function pileNosOfPier(pier){
    if (!S) return [];
    return S.pileNosOf(S.load(), pier);
  }""",
"""  /* 一次快照：原本每個墩號都呼叫 S.load() 一次（19 墩 → 19 次完整
     parse＋normalize＋recompute，iPhone 上約 570ms／次按鍵），
     改成只取一次並沿用，refreshPileSelect 立即降為毫秒級。 */
  var dataCache = null;
  function snapshot(){
    if (!dataCache) dataCache = S ? S.load() : null;
    return dataCache;
  }
  function invalidateSnapshot(){ dataCache = null; }

  function pileNosOfPier(pier){
    if (!S) return [];
    return S.pileNosOf(snapshot(), pier);
  }"""),
("""      S.recompute(d);
      S.save(d);
      return;""",
"""      S.recompute(d);
      S.save(d);
      invalidateSnapshot();
      return;"""),
("""  function load(){
    if (S) {
      try{
        var d = S.load();""",
"""  function load(){
    if (S) {
      try{
        var d = snapshot();"""),
("""  loadTemplate().catch(function(){ /* 延後到按下載時再提示 */ });""",
"""  /* 跨頁籤同步：進度表改了樁號／查驗狀態後，切回本頁要看到最新內容。
     原本本頁沒有監聽，只能靠外殼強制 reload（iOS 上等於整頁重載）。
     這裡改為自行監聽 storage 與 focus，外殼就不必再 reload。 */
  function reloadFromStore(){
    invalidateSnapshot();
    if (S) S.invalidate();
    var rows = load();
    if (!rows) return;
    state.rows = rows;
    render();
  }
  window.addEventListener('storage', function(e){
    if (e.key === STORE_KEY || (S && e.key === S.KEY)) reloadFromStore();
  });
  window.addEventListener('focus', function(){
    /* 只在資料真的變動時才重繪，避免切換 App 就整表重建 */
    var before = state.rows.length;
    var d = S ? S.load() : null;
    var after = d ? (d.logs || []).length : before;
    if (after !== before) reloadFromStore();
  });

  loadTemplate().catch(function(){ /* 延後到按下載時再提示 */ });"""),
])

edit("progress/index.html", [
("""<meta name="viewport" content="width=device-width, initial-scale=1.0">""",
"""<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="format-detection" content="telephone=no">"""),
("""  html,body{margin:0;padding:0;}
  body{""",
"""  html,body{margin:0;padding:0;}
  html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}
  body{"""),
("""  .tblwrap{overflow:auto;border:1px solid var(--line);border-radius:8px;max-height:70vh;}""",
"""  .tblwrap{overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:8px;max-height:70vh;}"""),
("""  .pierwrap{overflow:auto;border:1px solid var(--line);border-radius:8px;max-height:46vh;}""",
"""  .pierwrap{overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:8px;max-height:46vh;}"""),
("""  .drawer-b{padding:16px 18px 30px;overflow:auto;flex:1 1 auto;}""",
"""  .drawer-b{padding:16px 18px 30px;overflow:auto;-webkit-overflow-scrolling:touch;flex:1 1 auto;}"""),
("""  /* ---------- 統計 ---------- */""",
"""  /* 表格內每一格輸入都會呼叫 persist()，而 persist() 會 recompute 全部 121 支樁。
     在 iPhone 上連續輸入時會累積成明顯卡頓，這裡把「重算＋寫入」合併到同一輪
     事件迴圈只做一次（畫面仍即時更新，資料不會遺失）。 */
  var persistQueued = false;
  function persistSoon(){
    if (persistQueued) return;
    persistQueued = true;
    var run = function(){ persistQueued = false; persist(); };
    if (typeof Promise !== 'undefined') Promise.resolve().then(run);
    else setTimeout(run, 0);
  }

  /* ---------- 統計 ---------- */"""),
("""        p.workDate = inWD.value;
        persist(); renderStats(); renderPiers(); renderTable();""",
"""        p.workDate = inWD.value;
        persistSoon(); renderStats(); renderPiers(); renderTable();"""),
("""        p.note = inNote.value;
        S.save(data);""",
"""        p.note = inNote.value;
        persistSoon();"""),
("""  window.addEventListener('storage', function(e){
    if (e.key === S.KEY) { data = S.load(); render(); }
  });
  window.addEventListener('focus', function(){
    var fresh = S.load();
    if (JSON.stringify(fresh) !== JSON.stringify(data)) { data = fresh; render(); }
  });""",
"""  /* 原本每次 focus 都對整包資料做兩次 JSON.stringify（65KB 以上）再比對，
     iOS 上切換 App／分頁時會反覆觸發。改成先比對便宜的簽章，只有真的
     不同才重讀與重繪。 */
  function sig(d){
    return (d.piles ? d.piles.length : 0) + '|' + (d.logs ? d.logs.length : 0) + '|' +
      (d.logs && d.logs.length ? String(d.logs[d.logs.length - 1].date || '') : '');
  }
  var lastSig = sig(data);

  window.addEventListener('storage', function(e){
    if (e.key === S.KEY) { S.invalidate(); data = S.load(); lastSig = sig(data); render(); }
  });
  window.addEventListener('focus', function(){
    var fresh = S.load();
    var s = sig(fresh);
    if (s !== lastSig) { data = fresh; lastSig = s; render(); }
  });"""),
])
print("ALL OK")
