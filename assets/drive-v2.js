(function(){
"use strict";
var C=window.Core;
if(!C||!C.on)return;
var $=C.$,esc=C.esc,pad2=C.pad2,todayISO=C.todayISO,fmtSize=C.fmtSize,safeName=C.safeName,
    toast=C.makeToast("toast",2600),
    HIST_KEY="inspection-drive-photo-history",
    DONE_KEY="inspection-drive-photo-done-session",
    WM_KEY="inspection-drive-photo-watermark",
    ORIENT_KEY="inspection-drive-photo-autoorient",
    MAX_EDGE=2000,
    THUMB_EDGE=320,
    OCR_BUDGET=20000,
    stage=[],doneList=[],wmOn=!0,orientOn=!0,uploading=!1,seq=0;

function compactDate(iso){return String(iso||"").replace(/-/g,"")}
/* 角度顯示：細部傾斜會是小數（例如 3.7°），四方向時仍是整數 90°。
   取到小數第一位，並去掉多餘的 .0。 */
function fmtDeg(a){
  var v=Number(a)||0;
  v=Math.round(v*10)/10;
  return (v%1===0)?String(v):v.toFixed(1);
}
function loadWm(){var v=C.store.get(WM_KEY,"");v==="0"?wmOn=!1:v==="1"&&(wmOn=!0)}
function saveWm(){C.store.set(WM_KEY,wmOn?"1":"0")}
function loadOrient(){var v=C.store.get(ORIENT_KEY,"");v==="0"?orientOn=!1:v==="1"&&(orientOn=!0)}
function saveOrient(){C.store.set(ORIENT_KEY,orientOn?"1":"0")}
function loadDone(){try{var r=sessionStorage.getItem(DONE_KEY);if(!r)return;var a=JSON.parse(r);Array.isArray(a)&&(doneList=a.slice(0,30))}catch(e){}}
function saveDone(){try{sessionStorage.setItem(DONE_KEY,JSON.stringify(doneList.slice(0,30)))}catch(e){}}
function readHist(){var a=C.store.getJSON(HIST_KEY,[]);return Array.isArray(a)?a:[]}
function writeHist(a){var L=C.LIMITS||{};L.HISTORY_LIMIT&&a.length>L.HISTORY_LIMIT&&(a=a.slice(0,L.HISTORY_LIMIT)),C.store.setJSON(HIST_KEY,a)||toast("本機儲存空間不足，較舊的紀錄可能無法保存",!0)}

/* ================= 影像（全部自有 canvas，不依賴 watermark.js） ================= */
function loadBitmap(file){
  if(window.createImageBitmap){
    return createImageBitmap(file,{imageOrientation:"from-image"}).catch(function(){
      return createImageBitmap(file);
    });
  }
  return new Promise(function(res,rej){
    var u=URL.createObjectURL(file),im=new Image();
    im.onload=function(){URL.revokeObjectURL(u);res(im)};
    im.onerror=function(){URL.revokeObjectURL(u);rej(new Error("圖片載入失敗"))};
    im.src=u;
  });
}
function bSize(b){return {w:b.width||b.naturalWidth||0,h:b.height||b.naturalHeight||0}}
function bFree(b){try{b&&b.close&&b.close()}catch(e){}}

/* 任意角度旋轉（含 ±45° 內的細部傾斜）。
   外框尺寸用旋轉後的「外接矩形」計算，90/270 時 cos=0 會自動退化成原本的長寬互換，
   所以四方向旋轉的結果與舊版逐位元相同。 */
function drawRot(bmp,angle,maxEdge){
  var s=bSize(bmp),W=s.w,H=s.h;
  if(!W||!H)throw new Error("圖片尺寸無效");
  var rad=(Number(angle)||0)*Math.PI/180;
  var ca=Math.abs(Math.cos(rad)),sa=Math.abs(Math.sin(rad));
  var ow=Math.round(W*ca+H*sa), oh=Math.round(W*sa+H*ca);
  if(!ow||!oh){ow=W;oh=H}
  var sc=Math.min(1,(maxEdge||MAX_EDGE)/Math.max(ow,oh));
  var w=Math.max(1,Math.round(ow*sc)),h=Math.max(1,Math.round(oh*sc));
  var cv=document.createElement("canvas");
  cv.width=w;cv.height=h;
  var cx=cv.getContext("2d");
  cx.fillStyle="#fff";cx.fillRect(0,0,w,h);
  var dw=Math.round(W*sc),dh=Math.round(H*sc);
  cx.save();cx.translate(w/2,h/2);
  if(angle)cx.rotate(angle*Math.PI/180);
  cx.drawImage(bmp,-dw/2,-dh/2,dw,dh);
  cx.restore();
  return cv;
}
function canvasToBlob(cv){
  return new Promise(function(res,rej){
    if(cv.toBlob)cv.toBlob(function(b){b?res(b):rej(new Error("轉檔失敗"))},"image/png");
    else{try{res(dataURLtoBlob(cv.toDataURL("image/png")))}catch(e){rej(e)}}
  });
}
function dataURLtoBlob(u){
  var p=u.split(","),m=p[0].match(/:(.*?);/)[1],bin=atob(p[1]),n=bin.length,a=new Uint8Array(n);
  for(var i=0;i<n;i++)a[i]=bin.charCodeAt(i);
  return new Blob([a],{type:m});
}
function thumbDataURL(bmp,angle){
  var cv=drawRot(bmp,angle,THUMB_EDGE);
  try{return cv.toDataURL("image/jpeg",0.72)}catch(e){return ""}
}
function thumbFromBlob(blob,angle){
  return loadBitmap(blob).then(function(b){
    var u="";
    try{u=thumbDataURL(b,angle||0)}catch(e){}
    bFree(b);return u;
  }).catch(function(){return ""});
}
/* 日期浮水印：一律走 assets/watermark.js 的 PhotoWatermark.drawWatermark()
   （2026-11-11 依範本 F-24-03 校正版：橘色 #FF7505、字級 3.5% 短邊、
     點號日期 2026.11.14、右下角、淡黑影、無底塊、逐字字距）。
   本檔不再自繪，避免與範本格式分歧。 */
function stampDate(cv,dateISO){
  var txt=String(dateISO||"");
  if(!txt)return;
  var cx=cv.getContext("2d"),W=cv.width,H=cv.height;
  var PW=window.PhotoWatermark;
  if(PW&&typeof PW.drawWatermark==="function"){
    PW.drawWatermark(cx,W,H,txt);
    return;
  }
  /* 極端備援（watermark.js 未載入時）：仍維持橘色、右下角、點號日期 */
  var s=txt.replace(/-/g,".");
  var fs=Math.max(11,Math.round(Math.min(W,H)*0.035));
  var mR=Math.max(6,Math.round(Math.min(W,H)*0.025));
  var mB=Math.max(6,Math.round(Math.min(W,H)*0.035));
  cx.save();
  cx.font="700 "+fs+"px \"Arial Black\",\"Helvetica Neue\",Arial,\"Noto Sans TC\",\"PingFang TC\",\"Microsoft JhengHei\",sans-serif";
  cx.textAlign="right";cx.textBaseline="alphabetic";
  cx.shadowColor="rgba(0,0,0,0.45)";
  cx.shadowBlur=Math.max(1,Math.round(fs*0.06));
  cx.shadowOffsetX=Math.max(1,Math.round(fs*0.03));
  cx.shadowOffsetY=Math.max(1,Math.round(fs*0.03));
  cx.fillStyle="#FF7505";
  cx.fillText(s,W-mR,H-mB);
  cx.restore();
}
function renderFinal(blob,dateISO,angle){
  return loadBitmap(blob).then(function(bmp){
    var cv=drawRot(bmp,angle||0,MAX_EDGE);
    bFree(bmp);
    var applied=!1;
    if(wmOn){try{stampDate(cv,dateISO);applied=!0}catch(e){}}
    return canvasToBlob(cv).then(function(b){return {blob:b,applied:applied}});
  }).catch(function(){return {blob:blob,applied:!1}});
}

/* ================= 樁號下拉（依日期連動） =================
   只列出「查驗紀錄表」中該日期有查驗紀錄的樁號。
   資料來源：SuiteStore 的 logs（每筆紀錄的 piles 陣列）。
   換日期即重算；該日期沒有查驗紀錄時明確提示，不讓使用者選到不存在的樁號。 */
function stationsForDate(dateISO){
  var S=window.SuiteStore;
  if(!S||!S.load||!dateISO)return [];
  var d;
  try{d=S.load()}catch(e){return []}
  var out=[],seen={};
  (d.logs||[]).forEach(function(l){
    if(!l||String(l.date||"")!==String(dateISO))return;
    var nos=(S.logPileNos?S.logPileNos(d,l):(l.piles||[]))||[];
    nos.forEach(function(no){
      var s=String(no||"").trim();
      if(!s||seen[s])return;seen[s]=1;out.push(s);
    });
  });
  /* 依墩號、樁號序號排序，讓下拉好找 */
  out.sort(function(a,b){
    var pa=pierOfStation(a),pb=pierOfStation(b);
    if(pa!==pb)return pa.localeCompare(pb);
    return (parseInt(String(a).split("-").pop(),10)||0)-(parseInt(String(b).split("-").pop(),10)||0);
  });
  return out;
}
function pierOfStation(no){
  var m=String(no||"").match(/^(.+?)-\d+$/);
  return m?m[1]:String(no||"");
}
function allStations(){
  var S=window.SuiteStore,defs=(S&&S.PIER_DEFS)||[],out=[];
  defs.forEach(function(d){var n=Number(d.count)||0;for(var i=1;i<=n;i++)out.push(d.pier+"-"+i)});
  return out;
}
function buildStations(){
  var sel=$("fStation");
  if(!sel)return;
  var hint=$("stationHint");
  var dateISO=$("fDate")&&$("fDate").value||"";
  var prev=sel.value||"";

  if(!dateISO){
    var all=allStations();
    if(!all.length){
      sel.innerHTML='<option value="">— 請選擇樁號 —</option>';
      sel.disabled=!0;
      if(hint){hint.textContent="樁位資料未載入，無法列出樁號。";hint.className="hint2 bad";}
      return;
    }
    var g0={},o0=[];
    all.forEach(function(no){var q=pierOfStation(no);if(!g0[q]){g0[q]=[];o0.push(q)}g0[q].push(no)});
    var h0='<option value="">— 請選擇樁號 —</option>';
    o0.forEach(function(q){h0+='<optgroup label="'+esc(q)+'">';g0[q].forEach(function(no){h0+='<option value="'+esc(no)+'">'+esc(no)+"</option>"});h0+="</optgroup>"});
    sel.innerHTML=h0;sel.disabled=!1;
    if(prev&&all.indexOf(prev)>=0)sel.value=prev;
    if(hint){hint.textContent="尚未選擇日期，樁號列出全部 "+all.length+" 支；選了日期後只會列出該日有查驗的樁號。";hint.className="hint2";}
    return;
  }

  var list=stationsForDate(dateISO);

  if(!list.length){
    sel.innerHTML='<option value="">— 此日期尚無查驗紀錄 —</option>';
    sel.disabled=!0;
    if(hint){
      hint.textContent="此日期尚無查驗紀錄，請先到「查驗紀錄表」新增該日期的查驗，或改選其他日期。";
      hint.className="hint2 bad";
    }
    return;
  }

  /* 依墩號分組 */
  var groups={},order=[];
  list.forEach(function(no){
    var p=pierOfStation(no);
    if(!groups[p]){groups[p]=[];order.push(p)}
    groups[p].push(no);
  });

  var html='<option value="">— 請選擇樁號 —</option>';
  order.forEach(function(p){
    html+='<optgroup label="'+esc(p)+'">';
    groups[p].forEach(function(no){html+='<option value="'+esc(no)+'">'+esc(no)+"</option>"});
    html+="</optgroup>";
  });
  sel.innerHTML=html;
  sel.disabled=!1;

  /* 盡量保留原本選取（若該樁號當日仍有查驗） */
  if(prev&&list.indexOf(prev)>=0)sel.value=prev;

  if(hint){
    hint.textContent="本日有查驗的樁號共 "+list.length+" 支（"+order.length+" 個墩號）。";
    hint.className="hint2";
  }
}

/* ================= 加入照片（階段一：EXIF 轉正 + 縮圖） ================= */
var prepQ=[],prepBusy=!1;

function addFiles(list){
  var files=[],i;
  for(i=0;i<list.length;i++){var f=list[i];f&&/^image\//.test(f.type)&&files.push(f)}
  if(!files.length){toast("沒有可用的圖片檔",!0);return}
  files.forEach(function(f){
    var it={
      key:"s"+Date.now()+"_"+seq++,
      srcFile:f,baseBlob:null,thumbUrl:"",
      manualAngle:0,autoAngle:0,ocr:null,
      busy:!0,ocrBusy:!1,err:"",
      name:f.name||("photo_"+seq+".jpg"),size:f.size||0
    };
    stage.push(it);prepQ.push(it);
  });
  renderStage();
  toast("已加入 "+files.length+" 張照片");
  prepQueue();
}

function prepQueue(){
  if(prepBusy)return;
  var it=prepQ.shift();
  if(!it){prepBusy=!1;return}
  prepBusy=!0;

  /* 每張最多 12 秒。瀏覽器的影像解碼偶爾會卡住（尤其連續處理多張時），
     時間到就直接採用原檔並用 objectURL 當縮圖，寧可少一次轉檔也不能卡住整頁。 */
  var settled=!1;
  function settle(){
    if(settled)return;settled=!0;
    prepBusy=!1;          /* 一定要先放鎖，否則 prepQueue 會因為 prepBusy 還是 true 而直接 return，整條佇列死鎖 */
    renderStage();prepQueue();
  }
  /* 解碼 + OCR 合計上限。OCR 自己有 20 秒預算，這裡留 32 秒緩衝，
     確保「一定」會 settle，不會讓整條佇列卡死。 */
  var guard=setTimeout(function(){
    if(it.busy){
      it.busy=!1;
      it.err=it.err||"處理逾時，已使用原檔";
      it.baseBlob=it.baseBlob||it.srcFile;
      if(!it.thumbUrl){try{it.thumbUrl=URL.createObjectURL(it.srcFile)}catch(e){}}
    }
    settle();
  },32000);

  prepOne(it).then(function(){clearTimeout(guard);settle()},function(){clearTimeout(guard);settle()});
}
/* 單張 OCR 方向判斷。一定有結果（成功／逾時／失敗），永不 reject、永不卡住。 */
function ocrOne(it,budgetMs){
  var O=window.PhotoOrientOCR;
  if(!O||!O.detect)return Promise.resolve({ok:!1,reason:"no-module"});
  var done=!1;
  return new Promise(function(resolve){
    var t=setTimeout(function(){
      if(done)return;done=!0;
      resolve({ok:!1,reason:"timeout"});
    },budgetMs||OCR_BUDGET);
    loadBitmap(it.srcFile).then(function(bmp){
      return O.detect(bmp).then(function(r){bFree(bmp);return r},function(e){bFree(bmp);throw e});
    }).then(function(r){
      if(done)return;done=!0;clearTimeout(t);
      resolve(r||{ok:!1,reason:"empty"});
    },function(e){
      if(done)return;done=!0;clearTimeout(t);
      resolve({ok:!1,reason:"error",error:e&&e.message?e.message:String(e)});
    });
  });
}

/* 階段一：EXIF 轉正 → 縮圖 → （可選）OCR 自動判斷方向 → 依判斷結果重出圖 */
function prepOne(it){
  return loadBitmap(it.srcFile).then(function(bmp){
    var th="";
    try{th=thumbDataURL(bmp,0)}catch(e){}
    return canvasToBlob(drawRot(bmp,0,MAX_EDGE)).then(function(blob){
      bFree(bmp);
      it.baseBlob=blob;it.thumbUrl=th;it.err="";
      if(!orientOn){it.ocr={ok:!1,reason:"switch-off"};it.busy=!1;return}
      return ocrOne(it,OCR_BUDGET).then(function(res){
        if(res&&res.ok&&res.angle){
          it.autoAngle=Number(res.angle)||0;it.ocr=res;
          return loadBitmap(it.baseBlob).then(function(b2){
            var t2="";try{t2=thumbDataURL(b2,it.autoAngle)}catch(e){}
            return canvasToBlob(drawRot(b2,it.autoAngle,MAX_EDGE)).then(function(nb){
              bFree(b2);it.baseBlob=nb;if(t2)it.thumbUrl=t2;
            },function(e){bFree(b2);throw e});
          }).catch(function(){});
        }
        it.ocr=res||{ok:!1,reason:"unknown"};
      }).then(function(){it.busy=!1},function(){it.busy=!1});
    },function(e){bFree(bmp);throw e});
  }).catch(function(e){
    it.busy=!1;it.err=e&&e.message?e.message:"轉檔失敗";
    it.baseBlob=it.baseBlob||it.srcFile;
    return thumbFromBlob(it.srcFile,0).then(function(u){if(u)it.thumbUrl=u});
  });
}

/* ================= 暫存區（一次只顯示一張，可左右切換） ================= */
var stageIdx=0;
function clampStageIdx(){
  if(!stage.length){stageIdx=0;return}
  if(stageIdx<0)stageIdx=0;
  if(stageIdx>stage.length-1)stageIdx=stage.length-1;
}
/* 跳到第 N 張：超出範圍一律夾回 1..總張數，不會跳到不存在的張 */
function doJump(){
  if(!stage.length)return;
  var inp=$("vjumpin");
  if(!inp)return;
  var raw=String(inp.value==null?"":inp.value).replace(/[^0-9]/g,"");
  if(!raw){toast("請輸入要跳到的張數（1 ~ "+stage.length+"）",!0);inp.value=stageIdx+1;return}
  var want=parseInt(raw,10);
  if(isNaN(want)){toast("請輸入數字",!0);inp.value=stageIdx+1;return}
  var lo=1,hi=stage.length,clamped=want;
  if(want<lo)clamped=lo;
  if(want>hi)clamped=hi;
  if(clamped!==want)toast("只有 "+hi+" 張，已跳到第 "+clamped+" 張");
  stageIdx=clamped-1;
  clampStageIdx();
  renderStage();
}
function renderStage(){
  var box=$("stageGrid"),c1=$("stageCount"),c2=$("stageCount2");
  if(c1)c1.textContent=stage.length+" 張";
  if(c2)c2.textContent=stage.length+" 張";
  if(!box)return;
  clampStageIdx();
  if(!stage.length){
    box.className="grid2t";
    box.innerHTML='<div class="empty2">尚未選取照片。<br>點上方「選擇照片」或「直接拍照」，照片會先自動轉正並排在這裡。</div>';
    renderUncertain();updateGo();return;
  }
  box.className="grid2t single";
  var it=stage[stageIdx],n=stage.length;

  var bd="";
  if(it.busy)bd='<span class="badge">處理中…</span>';
  else if(it.err)bd='<span class="badge warn">原樣</span>';
  else if(!orientOn)bd='<span class="badge mut">未自動轉正</span>';
  else if(it.ocr&&it.ocr.ok)bd=it.autoAngle?'<span class="badge ok">已自動轉 '+fmtDeg(it.autoAngle)+"°</span>":'<span class="badge ok">方向正確</span>';
  else bd='<span class="badge q">這樣對嗎？</span>';
  if(it.manualAngle)bd+='<span class="badge mut">已轉 '+fmtDeg(it.manualAngle)+"°</span>";

  var qb="";
  if(!it.busy&&orientOn){
    qb='<div class="q180"><span>'+(it.ocr&&it.ocr.ok?"方向已判定":"這樣對嗎？")+"</span>"+
       '<button type="button" data-rot180="'+it.key+'">轉 180°</button></div>';
  }

  var wmPrev="";
  if(wmOn){
    var dv=($("fDate")&&$("fDate").value)||"";
    if(dv)wmPrev='<div class="vwm">'+esc(dv.replace(/-/g,"."))+"</div>";
  }

  var html='<div class="viewer">'+
    '<div class="vhead">'+
      '<span class="vpos">'+(stageIdx+1)+" / "+n+"</span>"+
      '<span class="vname">'+esc(it.name||"")+"</span>"+
    "</div>"+
    '<div class="vstage">'+
      (it.thumbUrl?'<img src="'+it.thumbUrl+'" alt="">':'<div class="vload">處理中…</div>')+
      wmPrev+
      '<div class="bwrap">'+bd+"</div>"+
      '<div class="ops">'+
        '<button type="button" data-ocr="'+it.key+'" title="自動判斷方向">◎</button>'+
        '<button type="button" data-rot="'+it.key+'" title="旋轉 90 度">↻</button>'+
        '<button type="button" class="rm" data-rm="'+it.key+'" title="移除">×</button>'+
      "</div>"+
    "</div>"+
    qb+
    '<div class="vnav">'+
      '<button type="button" class="vbtn" data-prev="1"'+(stageIdx<=0?" disabled":"")+">‹ 上一張</button>"+
      '<span class="vcount">'+(stageIdx+1)+" / "+n+"</span>"+
      '<button type="button" class="vbtn" data-next="1"'+(stageIdx>=n-1?" disabled":"")+">下一張 ›</button>"+
    "</div>"+
    '<div class="vjump">'+
      '<label for="vjumpin">跳到第</label>'+
      '<input type="number" id="vjumpin" class="vjumpin" inputmode="numeric" pattern="[0-9]*" min="1" max="'+n+'" step="1" value="'+(stageIdx+1)+'" aria-label="跳到第幾張">'+
      '<span class="vjumpof">/ '+n+' 張</span>'+
      '<button type="button" class="vjumpgo" data-jump="1">前往</button>'+
    "</div>"+
  "</div>";
  box.innerHTML=html;
  renderUncertain();updateGo();
}
function renderUncertain(){
  var bar=$("uncertainBar");
  if(!bar)return;
  var n=stage.filter(function(s){return !s.busy&&orientOn&&s.ocr&&!s.ocr.ok}).length;
  if(!n){bar.style.display="none";bar.innerHTML="";return}
  bar.style.display="";
  bar.innerHTML='<b>有 '+n+" 張方向不確定</b>　請確認是否需要轉正：按「<b>轉 180°</b>」一鍵轉正，或用「<b>↻</b>」每次轉 90°。";
}
function updateGo(){
  var btn=$("btnGo"),hint=$("goHint"),
      d=$("fDate")&&$("fDate").value||"",
      s=$("fStation")&&$("fStation").value||"",
      ready=stage.filter(function(x){return !x.busy&&x.baseBlob}).length,
      busy=stage.some(function(x){return x.busy});
  if(btn){
    btn.disabled=uploading||busy||ready===0||!d||!s;
    btn.textContent=uploading?"☁ 上傳中…":(ready?"☁ 確認上傳（"+ready+"）":"☁ 確認上傳");
  }
  if(hint){
    var msg="",bad=!1;
    if(uploading)msg="上傳中，請勿關閉頁面…";
    else if(busy)msg="正在處理照片…";
    else if(!stage.length)msg="請先加入照片";
    else if(!d){msg="請先選擇日期";bad=!0}
    else if(!s){msg="請先選擇樁號";bad=!0}
    else msg="將上傳到 營建相片 / "+d+" / "+s+" /"+(wmOn?"（壓日期浮水印）":"（不壓浮水印）");
    hint.textContent=msg;
    hint.className="hint2"+(bad?" bad":"");
  }
}

/* ================= 檔名 ================= */
function buildName(dateISO,station,n){
  var d=compactDate(dateISO)||compactDate(todayISO()),
      mid=safeName(station)||"photo",taken={};
  readHist().forEach(function(h){h&&h.date===dateISO&&h.name&&(taken[h.name]=1)});
  var name;
  do{name=d+"_"+mid+"_"+pad2(n)+".png";n++}while(taken[name]&&n<1000);
  return name;
}

/* ================= 資料夾 / 上傳 ================= */
function ensureStationFolder(dateISO,station){
  var G=window.GDrivePhoto;
  if(!G||!G.ensureNamedFolder)return Promise.reject(new Error("Drive 模組未載入"));
  return G.ensureNamedFolder("營建相片").then(function(rootId){
    return G.ensureNamedFolder(dateISO,rootId).then(function(dayId){
      return G.ensureNamedFolder(station,dayId).then(function(stId){
        return {rootId:rootId,dayId:dayId,stationId:stId};
      });
    });
  });
}
function uploadOne(blob,name,folderId,desc){
  var G=window.GDrive;
  if(!G||!G.uploadMultipart)return Promise.reject(new Error("Drive 模組未載入"));
  var meta={name:name,parents:[folderId]};
  desc&&(meta.description=desc);
  var form=new FormData;
  form.append("metadata",new Blob([JSON.stringify(meta)],{type:"application/json"}));
  var b=blob;
  if(b.type!=="image/png"){try{b=new Blob([b],{type:"image/png"})}catch(e){b=blob}}
  form.append("file",b,name);
  return G.uploadMultipart(form,"id,name,webViewLink,size").then(function(j){
    return {id:j.id,name:j.name,link:j.webViewLink||("https://drive.google.com/file/d/"+j.id+"/view"),size:j.size?Number(j.size):(blob.size||0)};
  });
}

function runUpload(){
  if(uploading)return;
  var G=window.GDrive;
  if(!G||!G.hasToken||!G.hasToken()){
    toast("請先連線 Google Drive",!0);
    var w=$("connWarn");w&&(w.style.display="");return;
  }
  var dateISO=$("fDate")&&$("fDate").value||"",
      station=$("fStation")&&$("fStation").value||"";
  if(!dateISO){toast("請先選擇日期",!0);return}
  if(!station){toast("請先選擇樁號",!0);return}
  var list=stage.filter(function(s){return !s.busy&&s.baseBlob});
  if(!list.length){toast("暫存區沒有可上傳的照片",!0);return}

  uploading=!0;updateGo();
  var pw=$("progWrap"),pb=$("progBar"),pt=$("progTxt");
  pw&&pw.classList.add("on");
  var total=list.length,ok=0,fail=0,n=1;
  function tick(m){
    var pct=Math.round((ok+fail)/total*100);
    pb&&(pb.style.width=pct+"%");
    pt&&(pt.textContent=m||("已完成 "+ok+" / "+total+" 張"+(fail?"（失敗 "+fail+" 張）":"")));
  }
  tick("準備資料夾…");

  ensureStationFolder(dateISO,station).then(function(folder){
    var chain=Promise.resolve();
    list.forEach(function(it){
      chain=chain.then(function(){
        tick("處理 "+(ok+fail+1)+" / "+total+"：壓浮水印…");
        return renderFinal(it.baseBlob,dateISO,it.manualAngle).then(function(fin){
          var name=buildName(dateISO,station,n);n++;
          var desc=["樁號："+station,"歸檔日期："+dateISO,
            it.ocr&&it.ocr.ok?("自動轉正："+fmtDeg(it.autoAngle||0)+"°"):"自動轉正：未判定",
            it.manualAngle?("手動旋轉："+it.manualAngle+"°"):"",
            wmOn?(fin.applied?"已壓日期浮水印":"未壓浮水印"):"未壓浮水印"].filter(Boolean).join("｜");
          tick("上傳 "+(ok+fail+1)+" / "+total+"："+name);
          return uploadOne(fin.blob,name,folder.stationId,desc).then(function(res){
            var hist=readHist();
            hist.unshift({id:res.id,name:res.name,link:res.link,date:dateISO,
              item:station,note:"",size:res.size||0,
              watermark:wmOn?(fin.applied?"applied":"off"):"off",
              uploadedAt:new Date().toISOString()});
            writeHist(hist);
            doneList.unshift({name:res.name,link:res.link,date:dateISO,station:station,thumbUrl:it.thumbUrl||"",size:res.size||0});
            saveDone();
            var idx=stage.indexOf(it);idx>=0&&stage.splice(idx,1);
            ok++;renderStage();renderDone();tick();
          });
        }).catch(function(e){
          fail++;it.err=e&&e.message?e.message:"上傳失敗";renderStage();
          tick("第 "+(ok+fail)+" 張失敗："+it.err);
        });
      });
    });
    return chain;
  }).then(function(){
    uploading=!1;updateGo();
    pw&&pw.classList.remove("on");
    if(fail)toast("已完成：成功 "+ok+" 張，失敗 "+fail+" 張（失敗的留在暫存區可重試）",!0);
    else toast("已上傳 "+ok+" 張到 營建相片 / "+dateISO+" / "+station+" /");
    ok>0&&setTimeout(function(){try{window.location.reload()}catch(e){}},1100);
  }).catch(function(e){
    uploading=!1;updateGo();
    pw&&pw.classList.remove("on");
    var msg=e&&e.message?e.message:String(e);
    toast("上傳失敗："+msg,!0);tick("失敗："+msg);
  });
}

/* ================= 完成區 ================= */
function renderDone(){
  var box=$("doneList"),cnt=$("doneCount");
  if(cnt)cnt.textContent=doneList.length+" 張";
  if(!box)return;
  if(!doneList.length){box.innerHTML='<div class="empty2">尚無上傳完成的照片。上傳成功後會列在這裡。</div>';return}
  var html="";
  doneList.forEach(function(d){
    html+='<div class="row2"><div class="th3">'+(d.thumbUrl?'<img src="'+d.thumbUrl+'" alt="">':"")+"</div>"+
      '<div class="info"><div class="nm2">'+esc(d.name)+"</div>"+
      '<div class="sub3">'+esc(d.date)+"　"+esc(d.station)+"　"+esc(fmtSize(d.size||0))+"</div></div>"+
      '<span class="ok2">已上傳</span>'+
      '<a class="open2" href="'+esc(d.link||"#")+'" target="_blank" rel="noopener">開啟</a></div>';
  });
  box.innerHTML=html;
}

/* ================= 單張 OCR ================= */
function runOneOcr(key){
  var it=null,i;
  for(i=0;i<stage.length;i++){if(stage[i].key===key){it=stage[i];break}}
  if(!it)return;
  var O=window.PhotoOrientOCR;
  if(!O||!O.detect){toast("自動判斷模組未載入",!0);return}
  if(it.busy){toast("這張還在處理，請稍候",!0);return}

  it.busy=!0;it.ocrBusy=!0;renderStage();
  var doneFlag=!1;
  function finish(res){
    if(doneFlag)return;doneFlag=!0;
    it.busy=!1;it.ocrBusy=!1;
    if(res&&res.ok){
      it.autoAngle=Number(res.angle)||0;it.ocr=res;
      loadBitmap(it.srcFile).then(function(bmp){
        var th="";try{th=thumbDataURL(bmp,it.autoAngle)}catch(e){}
        return canvasToBlob(drawRot(bmp,it.autoAngle,MAX_EDGE)).then(function(b){
          bFree(bmp);it.baseBlob=b;if(th)it.thumbUrl=th;renderStage();
        },function(e){bFree(bmp);throw e});
      }).catch(function(){renderStage()});
      toast("自動判斷：轉 "+fmtDeg(it.autoAngle||0)+"°");
    }else{
      it.ocr=res||{ok:!1,reason:"unknown"};renderStage();
      toast("判不出方向，請自行確認（可按「轉 180°」）",!0);
    }
  }
  var guard=setTimeout(function(){finish({ok:!1,reason:"timeout"})},OCR_BUDGET+2000);
  loadBitmap(it.srcFile).then(function(bmp){
    return O.detect(bmp).then(function(r){bFree(bmp);return r},function(e){bFree(bmp);throw e});
  }).then(function(res){clearTimeout(guard);finish(res)})
    .catch(function(e){clearTimeout(guard);finish({ok:!1,reason:"error",error:e&&e.message?e.message:String(e)})});
}

/* ================= 事件 ================= */
function bind(){
  var fi=$("fileInput2");
  fi&&C.on(fi,"change",function(){fi.files&&fi.files.length&&addFiles(fi.files);fi.value=""});
  var ci=$("camInput2");
  ci&&C.on(ci,"change",function(){ci.files&&ci.files.length&&addFiles(ci.files);ci.value=""});
  C.on("tilePick","click",function(){fi&&fi.click()});
  C.on("tileCam","click",function(){ci&&ci.click()});

  var dz=$("dropZone");
  if(dz){
    ["dragenter","dragover"].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.add("drag")})});
    ["dragleave","drop"].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.remove("drag")})});
    dz.addEventListener("drop",function(e){e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files.length&&addFiles(e.dataTransfer.files)});
  }

  C.on("stageGrid","keydown",function(e){
    var t=e.target;
    if(!t||!t.id||t.id!=="vjumpin")return;
    if(e.key==="Enter"||e.keyCode===13){e.preventDefault();doJump()}
  });

  C.on("stageGrid","click",function(e){
    var t=e.target;
    /* 跳到第 N 張 */
    var jb=t&&t.closest?t.closest("[data-jump]"):null;
    if(jb){doJump();return}
    /* 上一張 / 下一張 */
    var nav=t&&t.closest?t.closest("[data-prev],[data-next]"):null;
    if(nav){
      if(uploading){toast("上傳中，請稍候",!0);return}
      if(nav.hasAttribute("data-prev")){
        if(stageIdx>0){stageIdx--;renderStage()}
      }else{
        if(stageIdx<stage.length-1){stageIdx++;renderStage()}
      }
      return;
    }
    var el=t&&t.closest?t.closest("[data-rot],[data-rot180],[data-rm],[data-ocr]"):null;
    if(!el)return;
    var key=el.getAttribute("data-rot")||el.getAttribute("data-rot180")||
            el.getAttribute("data-rm")||el.getAttribute("data-ocr");
    var it=null,i;
    for(i=0;i<stage.length;i++){if(stage[i].key===key){it=stage[i];break}}
    if(!it)return;
    if(uploading){toast("上傳中，請稍候",!0);return}

    if(el.hasAttribute("data-ocr")){runOneOcr(it.key);return}
    if(el.hasAttribute("data-rm")){
      var idx=stage.indexOf(it);idx>=0&&stage.splice(idx,1);
      renderStage();toast("已從暫存區移除");return;
    }
    if(it.busy||!it.baseBlob){toast("照片還在處理，請稍候",!0);return}
    var delta=el.hasAttribute("data-rot180")?180:90;
    it.manualAngle=((it.manualAngle||0)+delta)%360;
    it.busy=!0;renderStage();
    thumbFromBlob(it.baseBlob,it.manualAngle).then(function(u){
      if(u)it.thumbUrl=u;it.busy=!1;renderStage();
    }).catch(function(){it.busy=!1;renderStage()});
  });

  var chk=$("chkWm2");
  if(chk){
    chk.checked=wmOn;
    C.on(chk,"change",function(){
      wmOn=!!chk.checked;saveWm();
      var st=$("wmState2");st&&(st.textContent=wmOn?"開啟":"關閉");
      renderStage();updateGo();
      toast(wmOn?"上傳時會壓上日期浮水印":"上傳時不壓日期浮水印");
    });
  }

  var chkO=$("chkOrient2");
  if(chkO){
    chkO.checked=orientOn;
    C.on(chkO,"change",function(){
      orientOn=!!chkO.checked;saveOrient();
      var st=$("orientState2");st&&(st.textContent=orientOn?"開啟":"關閉");
      if(orientOn&&!prepDone)startPrep();
      renderStage();
      toast(orientOn?"新加入的照片會自動判斷方向（OCR）":"已關閉自動轉正，照片保持原方向");
    });
  }

  /* 日期變更 → 樁號選單依該日查驗紀錄重算，再更新按鈕狀態 */
  C.on("fDate","change",function(){buildStations();renderStage();updateGo()});
  C.on("fDate","input",function(){buildStations();renderStage();updateGo()});
  C.on("fStation","change",updateGo);
  /* 三重保險：C.on + onclick + document 代理，
     確保任何情況下點「確認上傳」都會真的執行（不會被別的 handler 吃掉）。 */
  C.on("btnGo","click",runUpload);
  var bg=$("btnGo"); if(bg) bg.onclick=runUpload;
  document.addEventListener("click",function(e){
    var t=e.target;
    if(t && (t.id==="btnGo" || (t.closest && t.closest("#btnGo")))){
      if(!runUpload.__delegated){ runUpload(); }
    }
  },true);

  C.on("btnClearStage","click",function(){
    if(uploading){toast("上傳中，請稍候",!0);return}
    if(!stage.length){toast("暫存區已經是空的");return}
    if(window.confirm("要清空暫存區的 "+stage.length+" 張照片嗎？（不會影響已上傳的紀錄）")){
      stage=[];prepQ=[];renderStage();toast("已清空暫存區");
    }
  });
  C.on("btnClearDone","click",function(){
    if(!doneList.length){toast("上傳完成區已經是空的");return}
    doneList=[];saveDone();renderDone();
    toast("已清空上傳完成區（已上傳紀錄不受影響）");
  });
}

/* ================= OCR 模型準備進度 ================= */
var prepDone=!1;
function showPrep(st){
  var box=$("ocrPrep");if(!box||!st)return;
  if(st.ready){prepDone=!0;box.style.display="none";return}
  if(st.failed){
    prepDone=!0;box.style.display="";box.className="ocrprep bad";
    var t=$("ocrPrepTxt"),p=$("ocrPrepPct"),b=$("ocrPrepBar"),s=$("ocrPrepSub");
    t&&(t.textContent=st.offline?"目前離線，OCR 模型尚未下載":"OCR 模型載入失敗");
    p&&(p.textContent="");
    b&&(b.style.width="100%");
    s&&(s.textContent="不影響上傳：照片會直接進暫存區，請自行確認方向（可按「轉 180°」或「↻」）。");
    return;
  }
  box.style.display="";box.className="ocrprep";
  var t2=$("ocrPrepTxt"),p2=$("ocrPrepPct"),b2=$("ocrPrepBar"),s2=$("ocrPrepSub");
  t2&&(t2.textContent=st.msg||"正在準備 OCR 模型…");
  p2&&(p2.textContent=(st.pct||0)+"%");
  b2&&(b2.style.width=Math.max(2,st.pct||0)+"%");
  s2&&(s2.textContent="首次使用需下載約 5.8 MB，之後完全離線也能用。");
}
function startPrep(){
  var O=window.PhotoOrientOCR;
  if(!O||!O.prepare||!orientOn)return;
  O.prepare(showPrep).then(function(st){showPrep(st||{ready:!0})},function(){
    showPrep(O.state?O.state():{failed:!0});
  });
}

function init(){
  window.__v2init="yes";
  loadWm();loadOrient();loadDone();
  var d=$("fDate");d&&!d.value&&(d.value=todayISO());
  buildStations();   /* 日期先設好，再依該日查驗紀錄建立樁號選單 */
  var chk=$("chkWm2");chk&&(chk.checked=wmOn);
  var st=$("wmState2");st&&(st.textContent=wmOn?"開啟":"關閉");
  var chkO=$("chkOrient2");chkO&&(chkO.checked=orientOn);
  var stO=$("orientState2");stO&&(stO.textContent=orientOn?"開啟":"關閉");
  bind();renderStage();renderDone();updateGo();
  try{
    var O=window.PhotoOrientOCR;
    if(O&&O.prepare)setTimeout(startPrep,600);
  }catch(e){}
}
document.readyState==="loading"
  ?document.addEventListener("DOMContentLoaded",init)
  :init();
})();
