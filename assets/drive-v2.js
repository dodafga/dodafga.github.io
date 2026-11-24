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
    DATEF_KEY="inspection-drive-photo-datefilter",
    MAX_EDGE=2000,
    THUMB_EDGE=320,
    OCR_BUDGET=20000,
    stage=[],doneList=[],wmOn=!0,orientOn=!0,uploading=!1,seq=0,dateFilterOn=!0;

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
/* 依所選日期篩選照片（預設開啟；使用者手動取消後會記住其選擇） */
function loadDateFilter(){var v=C.store.get(DATEF_KEY,"");v==="0"?dateFilterOn=!1:dateFilterOn=!0}
function saveDateFilter(){C.store.set(DATEF_KEY,dateFilterOn?"1":"0")}
function applyDateFilterUI(){
  var chk=$("chkDateFilter");chk&&(chk.checked=dateFilterOn);
  var h=$("dfHint");
  if(!h)return;
  var d=$("fDate")&&$("fDate").value||"";
  if(dateFilterOn){
    h.textContent=d?("已開啟：選照片時只會加入 "+d+" 拍攝的照片（讀 EXIF 拍攝日期，讀不到才用檔案日期），其他日期自動略過並列出原因。")
                   :"已開啟：請先選擇日期，選照片時才會依該日期篩選。";
    h.className="dfhint on";
  }else{
    h.textContent="依照片的 EXIF 拍攝日期比對（讀不到才用檔案修改日期）；開啟後選照片時會自動略過其他日期的照片。";
    h.className="dfhint";
  }
}
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

/* ================= EXIF 拍攝日期（優先） =================
   為什麼需要：iPhone 從 iCloud／相簿匯出、或經 App 轉存的照片，
   file.lastModified 常常是「今天」（複製／下載當天），不是拍攝當天。
   只比對 lastModified 會把 11/5 拍的照片判成不是 11/5 而全部略過。
   所以改成先讀 EXIF 的 DateTimeOriginal（拍攝時間），讀不到才退回 lastModified。

   解析方式：JPEG 的 APP1 與 HEIC 的 Exif item 內容都以 "Exif\0\0" + TIFF header 開頭，
   所以直接在檔案前 3MB 內找這個標記，再依 TIFF 結構走 IFD，兩種格式共用同一支解析器。 */
function _u16(b,o,le){return le?(b[o]|(b[o+1]<<8)):((b[o]<<8)|b[o+1])}
function _u32(b,o,le){
  return le?((b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0)
           :(((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0);
}
function _ascii(b,o,n){var s="",i,c;for(i=0;i<n;i++){c=b[o+i];if(!c)break;s+=String.fromCharCode(c)}return s}

/* 在指定 IFD 裡找 tag，回傳 YYYY-MM-DD */
function _ifdDate(buf,t,le,ifdOff,want){
  if(ifdOff<=0||t+ifdOff+2>buf.length)return "";
  var n=_u16(buf,t+ifdOff,le);
  if(!n||n>600)return "";
  var i,e,tag,type,cnt,vo,s,m;
  for(i=0;i<n;i++){
    e=t+ifdOff+2+i*12;
    if(e+12>buf.length)break;
    tag=_u16(buf,e,le);
    if(want.indexOf(tag)<0)continue;
    type=_u16(buf,e+2,le);cnt=_u32(buf,e+4,le);
    if(type!==2||!cnt||cnt>64)continue;
    vo=(cnt<=4)?(e+8):(t+_u32(buf,e+8,le));
    if(vo+cnt>buf.length)continue;
    s=_ascii(buf,vo,cnt);
    m=/^(\d{4})[:\-\/](\d{1,2})[:\-\/](\d{1,2})/.exec(s);
    if(m){
      var yy=+m[1],mm=+m[2],dd=+m[3];
      if(yy>=1900&&yy<=2200&&mm>=1&&mm<=12&&dd>=1&&dd<=31)
        return yy+"-"+pad2(mm)+"-"+pad2(dd);
    }
  }
  return "";
}

/* 從檔案位元組解析拍攝日期；失敗回空字串 */
function exifDateFromBuffer(buf){
  var i,limit=Math.min(buf.length-6,3*1024*1024),start=-1;
  for(i=0;i<limit;i++){
    if(buf[i]===0x45&&buf[i+1]===0x78&&buf[i+2]===0x69&&buf[i+3]===0x66&&buf[i+4]===0&&buf[i+5]===0){
      start=i+6;break;
    }
  }
  if(start<0)return "";
  var t=start;
  if(t+8>buf.length)return "";
  var b0=buf[t],b1=buf[t+1];
  var le=(b0===0x49&&b1===0x49);
  if(!le&&!(b0===0x4D&&b1===0x4D))return "";
  var ifd0=_u32(buf,t+4,le);
  if(!ifd0||t+ifd0+2>buf.length)return "";

  /* IFD0 直接就有 DateTimeOriginal 的情況（少見但存在） */
  var d=_ifdDate(buf,t,le,ifd0,[0x9003,0x9004,0x0132]);
  if(d)return d;

  /* 標準路徑：IFD0 → ExifIFD(0x8769) → DateTimeOriginal(0x9003) */
  var n=_u16(buf,t+ifd0,le);
  if(!n||n>600)return "";
  var k,e,tag,off;
  for(k=0;k<n;k++){
    e=t+ifd0+2+k*12;
    if(e+12>buf.length)break;
    tag=_u16(buf,e,le);
    if(tag===0x8769){
      off=_u32(buf,e+8,le);
      d=_ifdDate(buf,t,le,off,[0x9003,0x9004,0x0132]);
      if(d)return d;
    }
  }
  return "";
}

/* 讀單一檔案的拍攝日期（非同步，最多等 4 秒，逾時就當作讀不到） */
function readPhotoDate(f){
  return new Promise(function(res){
    var done=!1;
    function fin(v){if(done)return;done=!0;res(v||"")}
    var tm=setTimeout(function(){fin("")},4000);
    try{
      var blob=f.slice(0,3*1024*1024);
      if(!blob.arrayBuffer){clearTimeout(tm);fin("");return}
      blob.arrayBuffer().then(function(ab){
        clearTimeout(tm);
        var d="";
        try{d=exifDateFromBuffer(new Uint8Array(ab))}catch(e){d=""}
        fin(d);
      }).catch(function(){clearTimeout(tm);fin("")});
    }catch(e){clearTimeout(tm);fin("")}
  });
}

/* 供除錯／自動測試使用（唯讀，不影響任何流程） */
try{window.__driveDateDebug={exifDateFromBuffer:exifDateFromBuffer,readPhotoDate:readPhotoDate,fileDateISO:fileDateISO}}catch(e){}

/* 檔案的修改日期 → YYYY-MM-DD（本地時區）。只在 EXIF 讀不到時當備援。 */
function fileDateISO(f){
  var t=0;
  try{t=Number(f.lastModified)||0}catch(e){t=0}
  if(!t)return "";
  var d=new Date(t);
  if(isNaN(d.getTime()))return "";
  return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
}

/* 11/05 這種短格式，給提示訊息用 */
function shortMD(iso){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||""));
  return m?(+m[2])+"/"+(+m[3]):String(iso||"");
}

/* 把照片實際放進暫存區 */
function pushFiles(files){
  files.forEach(function(f){
    var it={
      key:"s"+Date.now()+"_"+seq++,
      srcFile:f,baseBlob:null,thumbUrl:"",
      manualAngle:0,autoAngle:0,ocr:null,
      photoDate:f.__photoDate||"",dateSrc:f.__dateSrc||"",
      busy:!0,ocrBusy:!1,err:"",upBusy:!1,upFailed:!1,
      note:"",
      name:f.name||("photo_"+seq+".jpg"),size:f.size||0
    };
    stage.push(it);prepQ.push(it);
  });
  renderStage();
  prepQueue();
}

function addFiles(list){
  var files=[],i;
  for(i=0;i<list.length;i++){var f=list[i];f&&/^image\//.test(f.type)&&files.push(f)}
  if(!files.length){toast("沒有可用的圖片檔",!0);return}

  var want=dateFilterOn?($("fDate")&&$("fDate").value||""):"";

  /* 沒有要篩選：直接加入（仍會讀日期，讓每張照片顯示拍攝日期） */
  if(!want){
    toast("讀取照片拍攝日期…");
    Promise.all(files.map(function(f){return readPhotoDate(f)})).then(function(ds){
      files.forEach(function(f,idx){
        f.__photoDate=ds[idx]||fileDateISO(f);
        f.__dateSrc=ds[idx]?"exif":"mtime";
      });
      pushFiles(files);
      toast("已加入 "+files.length+" 張照片");
    });
    return;
  }

  /* 要篩選：先讀完所有照片的拍攝日期，再依所選日期比對 */
  toast("讀取照片拍攝日期…");
  Promise.all(files.map(function(f){return readPhotoDate(f)})).then(function(ds){
    var keep=[],skipMap={},skipOrder=[],noDate=0,exifHit=0;
    files.forEach(function(f,idx){
      var ex=ds[idx]||"";
      var d=ex||fileDateISO(f);
      f.__photoDate=d;
      f.__dateSrc=ex?"exif":"mtime";
      if(ex)exifHit++;
      if(!d){noDate++;keep.push(f);return}      /* 完全取不到日期：保留，不默默丟掉 */
      if(d===want){keep.push(f);return}
      if(!skipMap[d]){skipMap[d]=0;skipOrder.push(d)}
      skipMap[d]++;
    });

    var skipped=0;
    skipOrder.forEach(function(d){skipped+=skipMap[d]});

    if(!keep.length){
      var why=skipOrder.map(function(d){return shortMD(d)+"（"+skipMap[d]+" 張）"}).join("、");
      toast("所選日期（"+shortMD(want)+"）沒有符合的照片，已略過 "+skipped+" 張"+(why?"：拍攝日期 "+why:""),!0);
      return;
    }

    pushFiles(keep);

    var msg="已加入 "+keep.length+" 張照片";
    if(skipped){
      var why2=skipOrder.map(function(d){return shortMD(d)+"（"+skipMap[d]+" 張）"}).join("、");
      msg+="；已略過 "+skipped+" 張（拍攝日期 "+why2+"）";
    }
    if(noDate)msg+="；另有 "+noDate+" 張讀不到拍攝日期，已保留";
    toast(msg,!!skipped);
  });
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
    box.innerHTML='<div class="empty2">尚未選取照片。<br>點上方「拍照」或「本機上傳」，照片會先自動轉正並排在這裡。</div>';
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
      (it.photoDate?'<span class="vdate'+(it.dateSrc==="exif"?" ex":"")+'" title="'+(it.dateSrc==="exif"?"EXIF 拍攝日期":"檔案修改日期（讀不到 EXIF）")+'">📅 '+esc(it.photoDate)+(it.dateSrc==="exif"?"":"（檔案日期）")+"</span>":'<span class="vdate warn" title="這張讀不到拍攝日期，不會被日期篩選略過">📅 讀不到拍攝日期</span>')+
    "</div>"+
    '<div class="vstage">'+
      (it.thumbUrl?'<img src="'+it.thumbUrl+'" alt="">':'<div class="vload">處理中…</div>')+
      wmPrev+
      '<div class="bwrap">'+bd+"</div>"+
    "</div>"+
    qb+
    /* 每張照片自己的手動轉向按鍵（不需依賴自動判斷） */
    '<div class="rotbar">'+
      '<span class="rblab">手動轉向</span>'+
      '<button type="button" class="rb" data-rotl="'+it.key+'" title="向左旋轉 90 度" aria-label="向左旋轉 90 度">↺ 左轉 90°</button>'+
      '<button type="button" class="rb main" data-rot="'+it.key+'" title="向右旋轉 90 度" aria-label="向右旋轉 90 度">↻ 右轉 90°</button>'+
      '<button type="button" class="rb ghost" data-ocr="'+it.key+'" title="自動判斷方向（OCR）" aria-label="自動判斷方向">◎ 自動判斷</button>'+
      '<span class="rbdeg">'+(it.manualAngle?("已手動轉 "+fmtDeg(it.manualAngle)+"°"):"未手動轉向")+'</span>'+
      '<span class="rbspacer"></span>'+
      (it.upFailed?'<button type="button" class="rb retry" data-retry="'+it.key+'" title="重新上傳這張" aria-label="重新上傳這張">↻ 重試上傳</button>':"")+
      '<button type="button" class="rb rm" data-rm="'+it.key+'" title="移除這張" aria-label="移除這張">× 移除</button>'+
    "</div>"+
    (it.upFailed?'<div class="uperr">⚠ 上傳失敗（已自動重試 '+MAX_TRY+' 次）：'+esc(it.err||"未知原因")+"　可按「↻ 重試上傳」再試一次。</div>":"")+
    /* 這一張自己的說明：綁在 it.note 上，換張／旋轉／移除都不會跑到別張 */
    '<div class="vnote">'+
      '<label class="vnote-l" for="vnotein">第 '+(stageIdx+1)+' 張說明</label>'+
      '<textarea id="vnotein" class="vnote-in" rows="2" data-note="'+it.key+'" placeholder="這一張的說明（選填，只會跟著這一張）">'+esc(it.note||"")+'</textarea>'+
    '</div>'+
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
    else msg="將上傳到 義力 / 查驗照片 / "+d+" / "+s+" /"+(wmOn?"（壓日期浮水印）":"（不壓浮水印）");
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
  return G.ensureNamedFolder("義力").then(function(parentId){return G.ensureNamedFolder("查驗照片",parentId).then(function(rootId){
    return G.ensureNamedFolder(dateISO,rootId).then(function(dayId){
      return G.ensureNamedFolder(station,dayId).then(function(stId){
        return {parentId:parentId,rootId:rootId,dayId:dayId,stationId:stId};
      });
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

/* ================= 背景分批上傳 + 失敗自動重試 =================
   分批：每 BATCH_SIZE 張為一批，批次之間依序進行，批內逐張處理並讓出主執行緒，
         所以上傳期間頁面仍可操作（可繼續選照片、看已上傳紀錄、切換檢視）。
   重試：單張失敗自動重試，最多 MAX_TRY 次（含第一次），每次間隔遞增；
         次數用完仍失敗才標記失敗，並保留「↻ 重試上傳」手動按鈕。 */
var BATCH_SIZE=3, MAX_TRY=3, RETRY_DELAY=900;
var upJob=null;

function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function showProg(on){
  var pw=$("progWrap");if(!pw)return;
  on?pw.classList.add("on"):pw.classList.remove("on");
}
function progTick(job,msg){
  var pb=$("progBar"),pt=$("progTxt"),pbt=$("progBatch");
  var fin=job.done+job.fail;
  var pct=job.total?Math.round(fin/job.total*100):0;
  pb&&(pb.style.width=pct+"%");
  pt&&(pt.textContent=msg||("已完成 "+job.done+" / "+job.total+" 張"+(job.fail?"（失敗 "+job.fail+" 張）":"")));
  if(pbt){
    pbt.textContent="第 "+Math.max(1,job.batch)+" / "+job.batches+" 批　·　已完成 "+job.done+" 張　·　剩 "+(job.total-fin)+" 張"+(job.fail?"　·　失敗 "+job.fail+" 張":"");
  }
}
/* 單張上傳 + 自動重試。onTry(第幾次) 讓進度列顯示重試狀態。 */
function uploadOneRetry(blob,name,folderId,desc,onTry){
  var attempt=0;
  function go(){
    attempt++;
    onTry&&onTry(attempt);
    return uploadOne(blob,name,folderId,desc).catch(function(e){
      if(attempt>=MAX_TRY)throw e;
      return sleep(RETRY_DELAY*attempt).then(go);
    });
  }
  return go();
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
  var list=stage.filter(function(s){return !s.busy&&s.baseBlob&&!s.upBusy});
  if(!list.length){toast("暫存區沒有可上傳的照片",!0);return}

  uploading=!0;updateGo();
  var job={total:list.length,done:0,fail:0,batch:0,batches:Math.ceil(list.length/BATCH_SIZE)};
  upJob=job;
  showProg(!0);
  progTick(job,"準備資料夾…");

  var n=1;
  ensureStationFolder(dateISO,station).then(function(folder){
    var bi=0;
    function nextBatch(){
      if(bi>=job.batches)return Promise.resolve();
      var slice=list.slice(bi*BATCH_SIZE,(bi+1)*BATCH_SIZE);
      job.batch=bi+1;bi++;
      progTick(job,"第 "+job.batch+" / "+job.batches+" 批：開始上傳…");
      var chain=Promise.resolve();
      slice.forEach(function(it){
        chain=chain.then(function(){
          if(stage.indexOf(it)<0)return;      /* 上傳途中被移除就跳過 */
          it.upBusy=!0;it.err="";it.upFailed=!1;
          progTick(job,"處理中："+(it.name||""));
          return renderFinal(it.baseBlob,dateISO,it.manualAngle).then(function(fin){
            var name=buildName(dateISO,station,n);n++;
            var desc=["樁號："+station,"歸檔日期："+dateISO,
              String(it.note||"").trim()?("說明："+String(it.note).trim()):"",
              it.ocr&&it.ocr.ok?("自動轉正："+fmtDeg(it.autoAngle||0)+"°"):"自動轉正：未判定",
              it.manualAngle?("手動旋轉："+it.manualAngle+"°"):"",
              wmOn?(fin.applied?"已壓日期浮水印":"未壓浮水印"):"未壓浮水印"].filter(Boolean).join("｜");
            return uploadOneRetry(fin.blob,name,folder.stationId,desc,function(a){
              progTick(job,"上傳中（第 "+a+" / "+MAX_TRY+" 次嘗試）："+name);
            }).then(function(res){
              var hist=readHist();
              hist.unshift({id:res.id,name:res.name,link:res.link,date:dateISO,
                item:station,note:String(it.note||"").trim(),size:res.size||0,
                watermark:wmOn?(fin.applied?"applied":"off"):"off",
                uploadedAt:new Date().toISOString()});
              writeHist(hist);
              doneList.unshift({name:res.name,link:res.link,date:dateISO,station:station,thumbUrl:it.thumbUrl||"",size:res.size||0});
              saveDone();
              var idx=stage.indexOf(it);idx>=0&&stage.splice(idx,1);
              job.done++;renderStage();renderDone();progTick(job);
              /* 讓已上傳紀錄（drive-page.js）即時更新，不必重整頁面 */
              try{window.__drivePageRefresh&&window.__drivePageRefresh()}catch(e){}
            });
          }).catch(function(e){
            it.upBusy=!1;it.upFailed=!0;
            it.err=(e&&e.message?e.message:String(e))||"上傳失敗";
            job.fail++;renderStage();progTick(job);
          }).then(function(){
            it.upBusy=!1;
            return sleep(40);   /* 讓出主執行緒，維持介面可操作 */
          });
        });
      });
      return chain.then(function(){return sleep(60)}).then(nextBatch);
    }
    return nextBatch();
  }).then(function(){
    uploading=!1;upJob=null;updateGo();
    if(job.fail){
      progTick(job,"已完成：成功 "+job.done+" 張，失敗 "+job.fail+" 張（可單張重試）");
      toast("上傳完成：成功 "+job.done+" 張，失敗 "+job.fail+" 張（失敗的留在暫存區，可單張重試）",!0);
    }else{
      progTick(job,"已完成 "+job.done+" / "+job.total+" 張　✓ 全部完成");
      toast("已上傳 "+job.done+" 張到 義力 / 查驗照片 / "+dateISO+" / "+station+" /");
    }
    renderStage();renderDone();
  }).catch(function(e){
    uploading=!1;upJob=null;updateGo();
    var msg=e&&e.message?e.message:String(e);
    toast("上傳失敗："+msg,!0);progTick(job,"失敗："+msg);
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
  /* ===== 拍照：站內相機，同一個畫面可連續拍多張 =====
     開一次相機 → 一直按快門 → 照片累積在下方縮圖列（可單張刪除）
     → 按「使用照片」一次全部帶入。不會每拍一張就跳出相機再重開。 */
  var camBuf=[],camSeq=0,camStream=null,camBusy=!1;

  function camBufRender(){
    var box=$("camBuf"),grid=$("camBufGrid"),cnt=$("camBufCount"),use=$("camUse");
    if(!box)return;
    if(!camBuf.length){box.style.display="none";grid&&(grid.innerHTML="");cnt&&(cnt.textContent="0");use&&(use.textContent="使用照片（0）");return}
    box.style.display="block";
    cnt&&(cnt.textContent=String(camBuf.length));
    use&&(use.textContent="使用照片（"+camBuf.length+"）");
    if(grid){var html="";camBuf.forEach(function(s,i){
      html+='<div class="camshot" data-i="'+i+'"><img src="'+s.url+'" alt="第 '+(i+1)+' 張">'+
        '<button type="button" class="cx" data-cx="'+i+'" aria-label="移除第 '+(i+1)+' 張">✕</button></div>';
    });grid.innerHTML=html}
  }
  function camBufClear(){
    camBuf.forEach(function(s){try{URL.revokeObjectURL(s.url)}catch(e){}});
    camBuf=[];camBufRender();
  }

  /* ---- 站內相機視窗 ---- */
  function camStripRender(){
    var strip=$("camStrip"),cnt=$("camModalCount"),u1=$("camUse2");
    if(cnt)cnt.textContent=camBuf.length+" 張";
    if(u1)u1.textContent="使用照片（"+camBuf.length+"）";
    if(!strip)return;
    var html="";
    camBuf.forEach(function(s,i){
      html+='<div class="camshot" data-i="'+i+'"><img src="'+s.url+'" alt="第 '+(i+1)+' 張">'+
        '<button type="button" class="cx" data-cx="'+i+'" aria-label="移除第 '+(i+1)+' 張">✕</button></div>';
    });
    strip.innerHTML=html;
    try{strip.scrollLeft=strip.scrollWidth}catch(e){}
  }
  function camStop(){
    if(camStream){try{camStream.getTracks().forEach(function(t){t.stop()})}catch(e){}camStream=null}
    var v=$("camVideo");
    if(v){try{v.pause()}catch(e){}try{v.srcObject=null}catch(e){}}
  }
  function camClose(){
    camStop();
    var m=$("camModal");
    if(m)m.classList.remove("on");
    document.body.style.overflow="";
  }
  function camErrShow(title,msg){
    var view=$("camView");
    if(!view)return;
    view.innerHTML='<div class="camerr"><b>'+esc(title)+"</b>"+esc(msg)+"</div>";
    var sh=$("camShutter");if(sh)sh.disabled=!0;
  }
  function camOpen(){
    var m=$("camModal");
    if(!m)return;
    m.classList.add("on");
    document.body.style.overflow="hidden";
    camStripRender();
    var sh=$("camShutter");if(sh)sh.disabled=!1;
    var view=$("camView");
    /* 若先前顯示過錯誤訊息，先把 video 還原回來 */
    if(view&&!$("camVideo")){
      view.innerHTML='<video id="camVideo" playsinline autoplay muted></video><div class="camflash" id="camFlash"></div>';
    }
    var v=$("camVideo");
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){
      camErrShow("這個瀏覽器不支援站內相機","請改用「本機上傳」，或用手機的相機 App 拍好再選照片。");
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},
      audio:!1
    }).then(function(st){
      camStream=st;
      if(!v)return;
      v.srcObject=st;
      var p=v.play&&v.play();
      if(p&&p.catch)p.catch(function(){});
    }).catch(function(e){
      var name=e&&e.name?e.name:"";
      var why=name==="NotAllowedError"?"相機權限被拒絕。請在瀏覽器網址列左側允許相機，或改用「本機上傳」。":
              name==="NotFoundError"?"找不到可用的相機。請改用「本機上傳」。":
              name==="NotReadableError"?"相機被其他程式占用中。請關閉其他相機 App 後再試。":
              "無法開啟相機（"+(e&&e.message?e.message:name||"未知原因")+"）。";
      camErrShow("開不了相機",why);
    });
  }
  function camShoot(){
    if(camBusy)return;
    var v=$("camVideo");
    if(!v||!v.videoWidth){toast("相機還沒準備好，請稍候",!0);return}
    camBusy=!0;
    var sh=$("camShutter");if(sh)sh.disabled=!0;
    var fl=$("camFlash");
    if(fl){fl.classList.add("on");setTimeout(function(){fl.classList.remove("on")},110)}
    try{
      var w=v.videoWidth,h=v.videoHeight;
      var cv=document.createElement("canvas");
      cv.width=w;cv.height=h;
      cv.getContext("2d").drawImage(v,0,0,w,h);
      cv.toBlob(function(blob){
        if(!blob){camBusy=!1;if(sh)sh.disabled=!1;toast("拍照失敗，請再試一次",!0);return}
        var nm="cam_"+(++camSeq)+"_"+Date.now()+".jpg";
        var file;
        try{file=new File([blob],nm,{type:"image/jpeg",lastModified:Date.now()})}
        catch(e){blob.name=nm;file=blob}
        camBuf.push({file:file,url:URL.createObjectURL(blob)});
        camStripRender();camBufRender();
        camBusy=!1;if(sh)sh.disabled=!1;
      },"image/jpeg",0.92);
    }catch(e){
      camBusy=!1;if(sh)sh.disabled=!1;
      toast("拍照失敗："+(e&&e.message?e.message:"未知原因"),!0);
    }
  }
  function camUseAll(){
    if(!camBuf.length){toast("還沒有拍到照片",!0);return}
    var files=camBuf.map(function(s){return s.file});
    camBufClear();camStripRender();
    camClose();
    addFiles(files);
    toast("已帶入 "+files.length+" 張");
  }

  C.on("tileCam","click",camOpen);
  C.on("camShootMore","click",camOpen);
  C.on("camClose","click",camClose);
  C.on("camCancel","click",camClose);
  C.on("camShutter","click",camShoot);
  C.on("camUse2","click",camUseAll);
  C.on("camStrip","click",function(e){
    var b=e.target.closest?e.target.closest("button[data-cx]"):null;
    if(!b)return;
    var i=Number(b.getAttribute("data-cx"));
    if(isNaN(i)||!camBuf[i])return;
    try{URL.revokeObjectURL(camBuf[i].url)}catch(e2){}
    camBuf.splice(i,1);camStripRender();camBufRender();
  });
  /* 關閉視窗時一定要放掉相機，否則鏡頭指示燈會一直亮 */
  window.addEventListener("pagehide",camStop);
  document.addEventListener("visibilitychange",function(){
    if(document.hidden&&camStream)camStop();
  });

  C.on("camBufClear","click",function(){if(!camBuf.length)return;camBufClear();toast("已清除剛拍的照片")});
  C.on("camBufGrid","click",function(e){
    var b=e.target.closest?e.target.closest("button[data-cx]"):null;
    if(!b)return;
    var i=Number(b.getAttribute("data-cx"));
    if(isNaN(i)||!camBuf[i])return;
    try{URL.revokeObjectURL(camBuf[i].url)}catch(e2){}
    camBuf.splice(i,1);camBufRender();
  });
  C.on("camUse","click",function(){
    if(!camBuf.length)return;
    var files=camBuf.map(function(s){return s.file});
    camBufClear();
    addFiles(files);
    toast("已帶入 "+files.length+" 張");
  });
  /* 後備：站內相機不支援時，仍可用手機相機 App 拍單張 */
  ci&&C.on(ci,"change",function(){
    var fs=ci.files?C.toArray(ci.files):[];
    ci.value="";
    if(!fs.length)return;
    fs.forEach(function(f){
      var nm=f.name||("cam_"+(++camSeq)+"_"+Date.now()+".jpg");
      var file=f;
      try{file=new File([f],nm,{type:f.type||"image/jpeg",lastModified:Date.now()})}catch(err){try{f.name=nm}catch(e2){}}
      camBuf.push({file:file,url:URL.createObjectURL(f)});
    });
    camBufRender();
    toast("已拍 "+camBuf.length+" 張，可再拍或按「使用照片」");
  });
  C.on("tilePick","click",function(){fi&&fi.click()});

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

  /* 每張照片自己的說明：輸入即時寫回「那一張」的 it.note（用 data-note 的 key 對應），
     所以換張、旋轉、移除、切換到別張都不會把說明留在原本那張上。 */
  C.on("stageGrid","input",function(e){
    var t=e.target;
    if(!t||!t.classList||!t.classList.contains("vnote-in"))return;
    var key=t.getAttribute("data-note");
    if(!key)return;
    for(var i=0;i<stage.length;i++){
      if(stage[i].key===key){stage[i].note=t.value;break}
    }
  });
  /* 失焦時再寫一次，避免行動鍵盤 composition 結束才定稿 */
  C.on("stageGrid","change",function(e){
    var t=e.target;
    if(!t||!t.classList||!t.classList.contains("vnote-in"))return;
    var key=t.getAttribute("data-note");
    if(!key)return;
    for(var i=0;i<stage.length;i++){
      if(stage[i].key===key){stage[i].note=t.value;break}
    }
  });

  C.on("stageGrid","click",function(e){
    var t=e.target;
    /* 跳到第 N 張 */
    var jb=t&&t.closest?t.closest("[data-jump]"):null;
    if(jb){doJump();return}
    /* 上一張 / 下一張 */
    var nav=t&&t.closest?t.closest("[data-prev],[data-next]"):null;
    if(nav){
      if(nav.hasAttribute("data-prev")){
        if(stageIdx>0){stageIdx--;renderStage()}
      }else{
        if(stageIdx<stage.length-1){stageIdx++;renderStage()}
      }
      return;
    }
    var el=t&&t.closest?t.closest("[data-rot],[data-rotl],[data-rot180],[data-rm],[data-ocr],[data-retry]"):null;
    if(!el)return;
    var key=el.getAttribute("data-rot")||el.getAttribute("data-rotl")||el.getAttribute("data-rot180")||
            el.getAttribute("data-rm")||el.getAttribute("data-ocr")||el.getAttribute("data-retry");
    var it=null,i;
    for(i=0;i<stage.length;i++){if(stage[i].key===key){it=stage[i];break}}
    if(!it)return;

    /* 單張重試上傳：只重傳這一張，不影響其他張 */
    if(el.hasAttribute("data-retry")){
      if(uploading){toast("上傳中，請稍候再重試",!0);return}
      if(!it.baseBlob){toast("這張照片尚未處理完成，請稍候",!0);return}
      var d0=$("fDate")&&$("fDate").value||"",s0=$("fStation")&&$("fStation").value||"";
      if(!d0||!s0){toast("請先選擇日期與樁號",!0);return}
      it.upFailed=!1;it.err="";it.upBusy=!0;renderStage();
      toast("正在重新上傳這張…");
      ensureStationFolder(d0,s0).then(function(folder){
        return renderFinal(it.baseBlob,d0,it.manualAngle).then(function(fin){
          var name=buildName(d0,s0,1);
          var desc=["樁號："+s0,"歸檔日期："+d0,
            String(it.note||"").trim()?("說明："+String(it.note).trim()):"",
            it.ocr&&it.ocr.ok?("自動轉正："+fmtDeg(it.autoAngle||0)+"°"):"自動轉正：未判定",
            it.manualAngle?("手動旋轉："+it.manualAngle+"°"):"",
            wmOn?(fin.applied?"已壓日期浮水印":"未壓浮水印"):"未壓浮水印"].filter(Boolean).join("｜");
          return uploadOneRetry(fin.blob,name,folder.stationId,desc,function(a){
            if(a>1)toast("第 "+a+" 次嘗試…");
          }).then(function(res){
            var hist=readHist();
            hist.unshift({id:res.id,name:res.name,link:res.link,date:d0,item:s0,note:String(it.note||"").trim(),size:res.size||0,
              watermark:wmOn?(fin.applied?"applied":"off"):"off",uploadedAt:new Date().toISOString()});
            writeHist(hist);
            doneList.unshift({name:res.name,link:res.link,date:d0,station:s0,thumbUrl:it.thumbUrl||"",size:res.size||0});
            saveDone();
            var idx=stage.indexOf(it);idx>=0&&stage.splice(idx,1);
            it.upBusy=!1;renderStage();renderDone();
            try{window.__drivePageRefresh&&window.__drivePageRefresh()}catch(e){}
            toast("已重新上傳成功："+res.name);
          });
        });
      }).catch(function(e){
        it.upBusy=!1;it.upFailed=!0;
        it.err=(e&&e.message?e.message:String(e))||"上傳失敗";
        renderStage();toast("重試仍失敗："+it.err,!0);
      });
      return;
    }

    if(el.hasAttribute("data-ocr")){runOneOcr(it.key);return}
    if(el.hasAttribute("data-rm")){
      if(it.upBusy){toast("這張正在上傳，請稍候",!0);return}
      var idx2=stage.indexOf(it);idx2>=0&&stage.splice(idx2,1);
      renderStage();toast("已從暫存區移除");return;
    }
    if(it.busy||!it.baseBlob){toast("照片還在處理，請稍候",!0);return}
    if(it.upBusy){toast("這張正在上傳，請稍候",!0);return}
    /* 轉向：右轉 90°（預設）／左轉 90°／轉 180°；角度一律正規化到 0~359，
       負角度（左轉）也能正確顯示，不會出現 -90°。 */
    var delta=el.hasAttribute("data-rot180")?180:(el.hasAttribute("data-rotl")?-90:90);
    it.manualAngle=((it.manualAngle||0)+delta)%360;
    if(it.manualAngle<0)it.manualAngle+=360;
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
  C.on("fDate","change",function(){buildStations();renderStage();updateGo();applyDateFilterUI()});
  C.on("fDate","input",function(){buildStations();renderStage();updateGo();applyDateFilterUI()});

  /* 只加入所選日期的照片 */
  var chkDF=$("chkDateFilter");
  if(chkDF){
    chkDF.checked=dateFilterOn;
    C.on(chkDF,"change",function(){
      dateFilterOn=!!chkDF.checked;saveDateFilter();applyDateFilterUI();
      toast(dateFilterOn?"已開啟：只加入所選日期的照片":"已關閉日期篩選，所有照片都會加入");
    });
  }
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
  loadWm();loadOrient();loadDone();loadDateFilter();
  var d=$("fDate");d&&!d.value&&(d.value=todayISO());
  buildStations();   /* 日期先設好，再依該日查驗紀錄建立樁號選單 */
  var chk=$("chkWm2");chk&&(chk.checked=wmOn);
  var st=$("wmState2");st&&(st.textContent=wmOn?"開啟":"關閉");
  var chkO=$("chkOrient2");chkO&&(chkO.checked=orientOn);
  var stO=$("orientState2");stO&&(stO.textContent=orientOn?"開啟":"關閉");
  bind();renderStage();renderDone();updateGo();applyDateFilterUI();
  try{
    var O=window.PhotoOrientOCR;
    if(O&&O.prepare)setTimeout(startPrep,600);
  }catch(e){}
}
document.readyState==="loading"
  ?document.addEventListener("DOMContentLoaded",init)
  :init();
})();
