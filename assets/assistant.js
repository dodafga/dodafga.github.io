/*! assistant.js — 營造助手：施工照片歸檔 / 代辦事項 / 日期事項 */
(function () {
  "use strict";
  var C = window.Core;
  if (!C || !C.on) return;
  var $ = C.$, esc = C.esc, pad2 = C.pad2, todayISO = C.todayISO, safeName = C.safeName;
  var toast = C.makeToast("toast", 2800);

  var K_TODO = "build-assistant-todo";
  var K_EVENT = "build-assistant-event";
  var K_WM = "build-assistant-wm";
  var K_ITEM = "build-assistant-item";
  var K_STAFF = "build-assistant-staff";

  var MAX_EDGE = 2000;
  var THUMB_EDGE = 300;

  /* ================= 分頁 ================= */
  var tabs = C.toArray(document.querySelectorAll(".tab[data-panel]"));
  var panels = C.toArray(document.querySelectorAll(".panel"));
  function showPanel(key) {
    panels.forEach(function (p) { p.classList.toggle("on", p.id === "p-" + key); });
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-panel") === key;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    try { history.replaceState(null, "", "#" + key); } catch (e) {}
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { showPanel(t.getAttribute("data-panel")); });
  });
  var initKey = (location.hash || "").replace("#", "");
  showPanel(/^(photo|todo|event)$/.test(initKey) ? initKey : "photo");

  /* ================= 共用：日期 ================= */
  function isoAddDays(iso, n) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return iso;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function daysBetween(a, b) {
    var pa = String(a || "").split("-"), pb = String(b || "").split("-");
    if (pa.length !== 3 || pb.length !== 3) return null;
    var da = new Date(Number(pa[0]), Number(pa[1]) - 1, Number(pa[2]));
    var db = new Date(Number(pb[0]), Number(pb[1]) - 1, Number(pb[2]));
    return Math.round((db - da) / 86400000);
  }
  function fmtMD(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return iso || "";
    return Number(p[1]) + "/" + Number(p[2]);
  }
  function weekday(iso) {
    var p = String(iso || "").split("-");
    if (p.length !== 3) return "";
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return "日一二三四五六".charAt(d.getDay());
  }

  /* ================= 一、施工照片歸檔 ================= */
  var stage = [];
  var seq = 0;
  var uploading = false;
  var wmOn = true;

  function loadWm() { var v = C.store.get(K_WM, ""); if (v === "0") wmOn = false; else if (v === "1") wmOn = true; }
  function saveWm() { C.store.set(K_WM, wmOn ? "1" : "0"); }

  var fDate = $("fDate"), fItem = $("fItem"), fStaff = $("fStaff");
  var chkWm = $("chkWm"), pgrid = $("pgrid"), pEmpty = $("pEmpty"), pProg = $("pProg");
  var btnUpload = $("btnUpload"), btnClear = $("btnClear"), btnDownload = $("btnDownload");

  if (fDate && !fDate.value) fDate.value = todayISO();
  if (fItem) fItem.value = C.store.get(K_ITEM, "");
  if (fStaff) fStaff.value = C.store.get(K_STAFF, "");
  loadWm();
  if (chkWm) chkWm.checked = wmOn;

  C.on(chkWm, "change", function () { wmOn = !!chkWm.checked; saveWm(); renderStage(); });
  C.on(fItem, "change", function () { C.store.set(K_ITEM, fItem.value || ""); });
  C.on(fStaff, "change", function () { C.store.set(K_STAFF, fStaff.value || ""); });

  /* ---- 影像工具 ---- */
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(function () {
        return createImageBitmap(file);
      });
    }
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(u); res(im); };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("讀取失敗")); };
      im.src = u;
    });
  }
  function freeBmp(b) { try { if (b && b.close) b.close(); } catch (e) {} }

  function drawTo(bmp, angle, maxEdge) {
    var w0 = bmp.width, h0 = bmp.height;
    var swap = (angle === 90 || angle === 270);
    var ow = swap ? h0 : w0, oh = swap ? w0 : h0;
    var s = Math.min(1, maxEdge / Math.max(1, ow, oh));
    var w = Math.max(1, Math.round(ow * s)), h = Math.max(1, Math.round(oh * s));
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    if (angle) {
      var dw = Math.round(w0 * s), dh = Math.round(h0 * s);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle * Math.PI / 180);
      ctx.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(bmp, 0, 0, w, h);
    }
    return cv;
  }
  function canvasToPng(cv) {
    return new Promise(function (res, rej) {
      try {
        cv.toBlob(function (b) { b ? res(b) : rej(new Error("影像輸出失敗")); }, "image/png");
      } catch (e) { rej(e); }
    });
  }
  function thumbURL(cv) {
    try {
      var s = Math.min(1, THUMB_EDGE / Math.max(cv.width, cv.height));
      var t = document.createElement("canvas");
      t.width = Math.max(1, Math.round(cv.width * s));
      t.height = Math.max(1, Math.round(cv.height * s));
      t.getContext("2d").drawImage(cv, 0, 0, t.width, t.height);
      return t.toDataURL("image/jpeg", 0.72);
    } catch (e) { return ""; }
  }

  /* 壓浮水印：一律走 assets/watermark.js 的 PhotoWatermark.drawWatermark()
     → 與查驗助手完全同一套格式（橘色 #FF7505、字級 3.5% 短邊、點號日期、右下角、淡黑影） */
  function stampDate(cv, dateISO) {
    var txt = String(dateISO || "");
    if (!txt) return false;
    var PW = window.PhotoWatermark;
    if (PW && typeof PW.drawWatermark === "function") {
      PW.drawWatermark(cv.getContext("2d"), cv.width, cv.height, txt);
      return true;
    }
    return false;
  }

  function renderStage() {
    if (!pgrid) return;
    if (!stage.length) {
      pgrid.innerHTML = "";
      if (pEmpty) pEmpty.style.display = "block";
      if (pProg) pProg.textContent = "";
      updateBtns();
      return;
    }
    if (pEmpty) pEmpty.style.display = "none";
    var html = "";
    stage.forEach(function (it, i) {
      var bd = "", bdtxt = "";
      if (it.status === "done") { bd = "ok"; bdtxt = "已上傳"; }
      else if (it.status === "busy") { bd = "wait"; bdtxt = "處理中"; }
      else if (it.status === "err") { bd = "err"; bdtxt = "失敗"; }
      else { bd = ""; bdtxt = "待上傳"; }
      html += '<figure class="ph" data-id="' + it.id + '">' +
        '<div class="phimg">' +
        (it.thumb ? '<img src="' + it.thumb + '" alt="第 ' + (i + 1) + ' 張">' : '<span class="phno">第 ' + (i + 1) + ' 張</span>') +
        '<span class="bd ' + bd + '">' + bdtxt + '</span>' +
        '</div>' +
        '<figcaption title="' + esc(it.name || "") + '">' + esc(it.name || ("第 " + (i + 1) + " 張")) + '</figcaption>' +
        '<div class="phact">' +
        '<button type="button" class="mini" data-act="rot" data-id="' + it.id + '">↻ 旋轉</button>' +
        '<button type="button" class="mini del" data-act="del" data-id="' + it.id + '" title="移除">×</button>' +
        '</div></figure>';
    });
    pgrid.innerHTML = html;
    updateBtns();
  }

  function updateBtns() {
    var n = stage.length;
    if (btnUpload) {
      btnUpload.disabled = uploading || n === 0;
      btnUpload.textContent = uploading ? "☁ 上傳中…" : ("☁ 上傳至 Google Drive（" + n + "）");
    }
    if (btnClear) btnClear.disabled = uploading || n === 0;
    if (btnDownload) btnDownload.disabled = uploading || n === 0;
  }

  function addFiles(files) {
    var list = C.toArray(files || []).filter(function (f) {
      return f && /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || "");
    });
    if (!list.length) { toast("沒有可加入的圖片檔", true); return; }
    var pending = list.length;
    list.forEach(function (f) {
      var it = { id: "p" + (++seq), file: f, thumb: "", blob: null, status: "idle", msg: "", angle: 0, name: f.name || "" };
      stage.push(it);
      loadBitmap(f).then(function (bmp) {
        var cv = drawTo(bmp, 0, THUMB_EDGE);
        it.thumb = thumbURL(cv);
        freeBmp(bmp);
      }).catch(function () {}).then(function () {
        if (--pending === 0) renderStage(); else renderStage();
      });
    });
    renderStage();
  }

  C.on($("filePick"), "change", function (e) {
    addFiles(e.target.files);
    e.target.value = "";
  });
  C.on($("fileCam"), "change", function (e) {
    addFiles(e.target.files);
    e.target.value = "";
  });

  C.on(pgrid, "click", function (e) {
    var b = e.target.closest ? e.target.closest("button[data-act]") : null;
    if (!b) return;
    var id = b.getAttribute("data-id");
    var idx = -1;
    for (var i = 0; i < stage.length; i++) if (stage[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    var act = b.getAttribute("data-act");
    if (act === "del") {
      stage.splice(idx, 1);
      renderStage();
    } else if (act === "rot") {
      var it = stage[idx];
      it.angle = (it.angle + 90) % 360;
      it.status = "idle";
      loadBitmap(it.file).then(function (bmp) {
        var cv = drawTo(bmp, it.angle, THUMB_EDGE);
        it.thumb = thumbURL(cv);
        freeBmp(bmp);
        renderStage();
      }).catch(function () { renderStage(); });
    }
  });

  C.on(btnClear, "click", function () {
    if (!stage.length) return;
    if (!confirm("要清空目前暫存的 " + stage.length + " 張照片嗎？（已上傳到 Drive 的不受影響）")) return;
    stage = [];
    renderStage();
  });

  /* ---- 檔名 ---- */
  function buildName(dateISO, item, staff, n) {
    var d = String(dateISO || todayISO()).replace(/-/g, "");
    var mid = safeName(item || "", 24);
    if (!mid) {
      var now = new Date();
      mid = pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
    }
    return d + "_" + mid + "_" + pad2(n) + ".png";
  }

  /* ---- 產生最終影像（含浮水印） ---- */
  function finalize(it, dateISO, index) {
    return loadBitmap(it.file).then(function (bmp) {
      var cv = drawTo(bmp, it.angle, MAX_EDGE);
      freeBmp(bmp);
      var applied = false;
      if (wmOn) { try { applied = stampDate(cv, dateISO); } catch (e) { applied = false; } }
      return canvasToPng(cv).then(function (blob) {
        return { blob: blob, applied: applied, width: cv.width, height: cv.height };
      });
    });
  }

  /* ---- 上傳 ---- */
  C.on(btnUpload, "click", function () {
    if (uploading || !stage.length) return;
    var G = window.GDrivePhoto;
    if (!G) { toast("Drive 模組未載入", true); return; }
    var dateISO = (fDate && fDate.value) || todayISO();
    var item = (fItem && fItem.value || "").trim();
    var staff = (fStaff && fStaff.value || "").trim();
    uploading = true;
    updateBtns();
    if (pProg) pProg.textContent = "正在連線 Google Drive…";

    var okN = 0, errN = 0, i = 0;
    function step() {
      if (i >= stage.length) {
        uploading = false;
        updateBtns();
        if (pProg) pProg.textContent = "完成：成功 " + okN + " 張" + (errN ? "，失敗 " + errN + " 張" : "") + "。";
        toast(errN ? ("上傳完成，成功 " + okN + " 張、失敗 " + errN + " 張") : ("已上傳 " + okN + " 張到 Google Drive"), !!errN);
        return;
      }
      var it = stage[i];
      if (it.status === "done") { i++; step(); return; }
      it.status = "busy";
      renderStage();
      if (pProg) pProg.textContent = "處理第 " + (i + 1) + " / " + stage.length + " 張…";
      finalize(it, dateISO, i + 1).then(function (fin) {
        var name = buildName(dateISO, item, staff, i + 1);
        var desc = [];
        if (item) desc.push("工項：" + item);
        if (staff) desc.push("人員：" + staff);
        desc.push("浮水印：" + (fin.applied ? dateISO : "未套用"));
        return G.uploadPhoto({
          blob: fin.blob, filename: name, date: dateISO,
          mime: "image/png", description: desc.join("｜")
        }).then(function (res) {
          it.status = "done"; it.msg = res.name || name; it.name = res.name || name;
          okN++;
        });
      }).catch(function (e) {
        it.status = "err";
        it.msg = (e && e.message) ? e.message : "上傳失敗";
        errN++;
      }).then(function () {
        i++;
        renderStage();
        step();
      });
    }
    G.ensureToken ? G.ensureToken().then(step).catch(function (e) {
      uploading = false; updateBtns();
      var msg = (e && e.message) ? e.message : "需要授權";
      if (pProg) pProg.textContent = "⚠ " + msg;
      toast(msg, true);
    }) : step();
  });

  /* ---- 下載到本機（不上傳時可用） ---- */
  C.on(btnDownload, "click", function () {
    if (uploading || !stage.length) return;
    var dateISO = (fDate && fDate.value) || todayISO();
    var item = (fItem && fItem.value || "").trim();
    var i = 0;
    function step() {
      if (i >= stage.length) { toast("已下載 " + stage.length + " 張"); return; }
      var it = stage[i];
      finalize(it, dateISO, i + 1).then(function (fin) {
        C.download(buildName(dateISO, item, "", i + 1), fin.blob, "image/png");
        i++;
        setTimeout(step, 320);
      }).catch(function () { i++; step(); });
    }
    step();
  });

  /* ---- Drive 連線狀態 ---- */
  var connDot = $("connDot"), connTxt = $("connTxt"), connBtn = $("connBtn");
  function paintConn(st) {
    if (!connDot || !connTxt) return;
    var map = {
      connected: ["ok", "已連線 Google Drive"],
      connecting: ["wait", "連線中…"],
      silent: ["wait", "自動連線…"],
      syncing: ["wait", "同步中…"],
      expired: ["warn", "授權已過期，請重新連線"],
      unauthorized: ["warn", "尚未授權"],
      idle: ["", "尚未連線"],
      error: ["err", "連線失敗"]
    };
    var m = map[st && st.state] || map.idle;
    connDot.className = "dot " + m[0];
    connTxt.textContent = m[1] + (st && st.email ? "（" + st.email + "）" : "");
    if (connBtn) connBtn.textContent = (st && st.state === "connected") ? "↻ 重新連線" : "🔗 連線 Google Drive";
  }
  var G0 = window.GDrivePhoto;
  if (G0 && G0.onStatus) {
    G0.onStatus(paintConn);
    if (G0.restoreToken && G0.restoreToken()) { try { G0.silentConnect().catch(function () {}); } catch (e) {} }
  }
  C.on(connBtn, "click", function () {
    var G = window.GDrivePhoto;
    if (!G) { toast("Drive 模組未載入", true); return; }
    G.connect().then(function () { toast("已連線 Google Drive"); })
      .catch(function (e) { toast((e && e.message) || "連線失敗", true); });
  });

  renderStage();

  /* ================= 二、代辦事項紀錄 ================= */
  var todo = [];
  function readTodo() {
    var a = C.store.getJSON(K_TODO, []);
    todo = Array.isArray(a) ? a : [];
  }
  function writeTodo() { C.store.setJSON(K_TODO, todo); }

  var tTitle = $("tTitle"), tType = $("tType"), tDue = $("tDue"), tRepeat = $("tRepeat");
  var tDueWrap = $("tDueWrap"), tRepeatWrap = $("tRepeatWrap");
  var todoList = $("todoList"), todoEmpty = $("todoEmpty"), todoSum = $("todoSum");

  function syncTypeUI() {
    var v = tType ? tType.value : "due";
    if (tDueWrap) tDueWrap.style.display = (v === "due") ? "" : "none";
    if (tRepeatWrap) tRepeatWrap.style.display = (v === "repeat") ? "" : "none";
  }
  C.on(tType, "change", syncTypeUI);
  syncTypeUI();
  if (tDue && !tDue.value) tDue.value = todayISO();

  function repeatLabel(v) {
    return ({ daily: "每天", weekly: "每週", monthly: "每月", workday: "每工作日" })[v] || "每週";
  }
  function nextOccur(iso, rep) {
    if (!iso) return "";
    if (rep === "daily") return isoAddDays(iso, 1);
    if (rep === "weekly") return isoAddDays(iso, 7);
    if (rep === "monthly") {
      var p = String(iso).split("-");
      if (p.length !== 3) return iso;
      var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
      m += 1; if (m > 12) { m = 1; y += 1; }
      return y + "-" + pad2(m) + "-" + pad2(d);
    }
    if (rep === "workday") {
      var n = isoAddDays(iso, 1);
      var p2 = String(n).split("-");
      var wd = new Date(Number(p2[0]), Number(p2[1]) - 1, Number(p2[2])).getDay();
      while (wd === 0 || wd === 6) { n = isoAddDays(n, 1); p2 = String(n).split("-"); wd = new Date(Number(p2[0]), Number(p2[1]) - 1, Number(p2[2])).getDay(); }
      return n;
    }
    return iso;
  }

  function renderTodo() {
    if (!todoList) return;
    var today = todayISO();
    var due = [], rep = [];
    todo.forEach(function (t) { (t.type === "repeat" ? rep : due).push(t); });

    due.sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return String(a.due || "9999").localeCompare(String(b.due || "9999"));
    });
    rep.sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });

    var html = "";
    function row(t) {
      var meta = "";
      if (t.type === "repeat") {
        meta = "🔁 " + repeatLabel(t.repeat) + (t.lastDone ? "　上次完成 " + fmtMD(t.lastDone) : "　尚未完成過");
      } else if (t.due) {
        var dd = daysBetween(today, t.due);
        var cls = "", txt = "";
        if (dd === null) { txt = t.due; }
        else if (dd < 0) { cls = "od"; txt = "已逾期 " + Math.abs(dd) + " 天（" + fmtMD(t.due) + "）"; }
        else if (dd === 0) { cls = "od"; txt = "今天到期"; }
        else if (dd <= 3) { cls = "soon"; txt = dd + " 天後到期（" + fmtMD(t.due) + "）"; }
        else { txt = fmtMD(t.due) + "（" + dd + " 天後）"; }
        meta = "📅 " + (cls ? '<span class="' + cls + '">' + esc(txt) + "</span>" : esc(txt));
      } else {
        meta = "📅 未設定期限";
      }
      return '<li class="ti' + (t.done ? " done" : "") + '" data-id="' + t.id + '">' +
        '<label class="tick"><input type="checkbox" data-act="done" data-id="' + t.id + '"' + (t.done ? " checked" : "") + '></label>' +
        '<div class="tmain"><div class="ttitle">' + esc(t.title) + '</div><div class="tmeta">' + meta + '</div></div>' +
        '<button type="button" class="mini del" data-act="del" data-id="' + t.id + '" title="刪除">×</button>' +
        '</li>';
    }

    if (due.length) {
      html += '<li style="list-style:none;font-size:11.5px;font-weight:800;letter-spacing:.08em;color:#6b7a8d;padding:2px 2px 0">期限</li>';
      due.forEach(function (t) { html += row(t); });
    }
    if (rep.length) {
      html += '<li style="list-style:none;font-size:11.5px;font-weight:800;letter-spacing:.08em;color:#6b7a8d;padding:10px 2px 0">重複性任務</li>';
      rep.forEach(function (t) { html += row(t); });
    }
    todoList.innerHTML = html;
    if (todoEmpty) todoEmpty.style.display = todo.length ? "none" : "block";

    if (todoSum) {
      var open = todo.filter(function (t) { return !t.done; }).length;
      var over = todo.filter(function (t) {
        if (t.done || t.type === "repeat" || !t.due) return false;
        var d = daysBetween(today, t.due);
        return d !== null && d < 0;
      }).length;
      todoSum.textContent = todo.length
        ? ("共 " + todo.length + " 筆，未完成 " + open + " 筆" + (over ? "，其中逾期 " + over + " 筆" : ""))
        : "";
    }
  }

  C.on($("btnAddTodo"), "click", function () {
    var title = (tTitle && tTitle.value || "").trim();
    if (!title) { toast("請先填寫代辦內容", true); if (tTitle) tTitle.focus(); return; }
    var type = (tType && tType.value) || "due";
    var rec = { id: "t" + Date.now() + Math.floor(Math.random() * 1000), title: title, type: type, done: false, lastDone: "" };
    if (type === "due") rec.due = (tDue && tDue.value) || "";
    else rec.repeat = (tRepeat && tRepeat.value) || "weekly";
    todo.push(rec);
    writeTodo();
    if (tTitle) tTitle.value = "";
    renderTodo();
    toast("已新增代辦");
  });

  C.on(todoList, "click", function (e) {
    var el = e.target;
    var act = el.getAttribute && el.getAttribute("data-act");
    if (!act) return;
    var id = el.getAttribute("data-id");
    var idx = -1;
    for (var i = 0; i < todo.length; i++) if (todo[i].id === id) { idx = i; break; }
    if (idx < 0) return;
    if (act === "del") {
      todo.splice(idx, 1);
      writeTodo(); renderTodo();
    } else if (act === "done") {
      var t = todo[idx];
      if (t.type === "repeat") {
        if (el.checked) {
          t.lastDone = todayISO();
          t.done = false;
          toast("已完成一次，下次：" + fmtMD(nextOccur(t.lastDone, t.repeat)));
        }
      } else {
        t.done = !!el.checked;
      }
      writeTodo(); renderTodo();
    }
  });

  readTodo();
  renderTodo();

  /* ================= 三、日期事項紀錄 ================= */
  var events = [];
  function readEvents() {
    var a = C.store.getJSON(K_EVENT, []);
    events = Array.isArray(a) ? a : [];
  }
  function writeEvents() { C.store.setJSON(K_EVENT, events); }

  var eDate = $("eDate"), eTitle = $("eTitle"), eNote = $("eNote");
  var evList = $("evList"), evEmpty = $("evEmpty"), evSum = $("evSum");
  if (eDate && !eDate.value) eDate.value = todayISO();

  function renderEvents() {
    if (!evList) return;
    var today = todayISO();
    var arr = events.slice().sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
    var html = "";
    arr.forEach(function (ev) {
      var dd = daysBetween(today, ev.date);
      var cls = "";
      if (dd !== null && dd < 0) cls = "past";
      else if (dd === 0) cls = "today";
      var tag = "";
      if (dd === 0) tag = "　<b style=\"color:#c47f17\">今天</b>";
      else if (dd !== null && dd > 0) tag = "　" + dd + " 天後";
      else if (dd !== null && dd < 0) tag = "　" + Math.abs(dd) + " 天前";
      html += '<div class="ev ' + cls + '" data-id="' + ev.id + '">' +
        '<div class="evdate"><b>' + esc(fmtMD(ev.date)) + '</b><span>週' + esc(weekday(ev.date)) + '</span></div>' +
        '<div class="evmain"><div class="evtitle">' + esc(ev.title) + tag + '</div>' +
        (ev.note ? '<div class="evnote">' + esc(ev.note) + '</div>' : '') +
        '</div>' +
        '<button type="button" class="mini del" data-act="del" data-id="' + ev.id + '" title="刪除">×</button>' +
        '</div>';
    });
    evList.innerHTML = html;
    if (evEmpty) evEmpty.style.display = events.length ? "none" : "block";
    if (evSum) {
      var up = events.filter(function (e) { var d = daysBetween(today, e.date); return d !== null && d >= 0; }).length;
      evSum.textContent = events.length ? ("共 " + events.length + " 筆，未到期 " + up + " 筆") : "";
    }
  }

  C.on($("btnAddEvent"), "click", function () {
    var d = (eDate && eDate.value) || "";
    var title = (eTitle && eTitle.value || "").trim();
    if (!d) { toast("請選擇日期", true); return; }
    if (!title) { toast("請填寫事項內容", true); if (eTitle) eTitle.focus(); return; }
    events.push({
      id: "e" + Date.now() + Math.floor(Math.random() * 1000),
      date: d, title: title, note: (eNote && eNote.value || "").trim()
    });
    writeEvents();
    if (eTitle) eTitle.value = "";
    if (eNote) eNote.value = "";
    renderEvents();
    toast("已新增日期事項");
  });

  C.on(evList, "click", function (e) {
    var el = e.target;
    if (!el.getAttribute || el.getAttribute("data-act") !== "del") return;
    var id = el.getAttribute("data-id");
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === id) { events.splice(i, 1); break; }
    }
    writeEvents(); renderEvents();
  });

  readEvents();
  renderEvents();

  /* 跨分頁回來時重繪（日期相對天數會變） */
  window.addEventListener("focus", function () { renderTodo(); renderEvents(); });
})();
