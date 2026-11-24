(function(){"use strict";var C=window.Core;if(!C||!C.on)return;var $=C.$,esc=C.esc,pad2=C.pad2,todayISO=C.todayISO,safeName=C.safeName,toast=C.makeToast("toast",2800),K_TODO="build-assistant-todo",K_EVENT="build-assistant-event",K_WM="build-assistant-wm",K_ITEM="build-assistant-item",K_VENDOR="build-assistant-vendor",K_STAFF="build-assistant-staff",MAX_EDGE=2e3,THUMB_EDGE=300,tabs=C.toArray(document.querySelectorAll(".tab[data-panel]")),panels=C.toArray(document.querySelectorAll(".panel"));function showPanel(key){panels.forEach(function(p){p.classList.toggle("on",p.id==="p-"+key)}),tabs.forEach(function(t){var on=t.getAttribute("data-panel")===key;t.classList.toggle("on",on),t.setAttribute("aria-selected",on?"true":"false")});try{history.replaceState(null,"","#"+key)}catch(e){}}tabs.forEach(function(t){t.addEventListener("click",function(){showPanel(t.getAttribute("data-panel"))})});var initKey=(location.hash||"").replace("#","");showPanel(/^(photo|todo|event)$/.test(initKey)?initKey:"photo");function isoAddDays(iso,n){var p=String(iso||"").split("-");if(p.length!==3)return iso;var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));return d.setDate(d.getDate()+n),d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate())}function daysBetween(a,b){var pa=String(a||"").split("-"),pb=String(b||"").split("-");if(pa.length!==3||pb.length!==3)return null;var da=new Date(Number(pa[0]),Number(pa[1])-1,Number(pa[2])),db=new Date(Number(pb[0]),Number(pb[1])-1,Number(pb[2]));return Math.round((db-da)/864e5)}function fmtMD(iso){var p=String(iso||"").split("-");return p.length!==3?iso||"":Number(p[1])+"/"+Number(p[2])}function weekday(iso){var p=String(iso||"").split("-");if(p.length!==3)return"";var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));return"日一二三四五六".charAt(d.getDay())}var stage=[],seq=0,uploading=!1,wmOn=!0;function loadWm(){var v=C.store.get(K_WM,"");v==="0"?wmOn=!1:v==="1"&&(wmOn=!0)}function saveWm(){C.store.set(K_WM,wmOn?"1":"0")}var fDate=$("fDate"),fItem=$("fItem"),fVendor=$("fVendor"),chkWm=$("chkWm"),pgrid=$("pgrid"),pEmpty=$("pEmpty"),pProg=$("pProg"),btnUpload=$("btnUpload"),btnClear=$("btnClear"),btnDownload=$("btnDownload");fDate&&!fDate.value&&(fDate.value=todayISO()),fItem&&(fItem.value=C.store.get(K_ITEM,"")),fVendor&&(fVendor.value=C.store.get(K_VENDOR,"")),loadWm(),chkWm&&(chkWm.checked=wmOn),C.on(chkWm,"change",function(){wmOn=!!chkWm.checked,saveWm(),renderStage()}),C.on(fItem,"change",function(){C.store.set(K_ITEM,fItem.value||"")}),C.on(fVendor,"change",function(){C.store.set(K_VENDOR,fVendor.value||""),paintShareText()}),C.on(fVendor,"input",function(){paintShareText()}),C.on(fItem,"input",function(){paintShareText()});var K_CREW="build-assistant-crew",TYPE_OPTS=["技術工","水電工","鋼筋工","模板工","混凝土工","其他"],MACH_OPTS=["excavator","傾洩卡車","卡車","吊卡","吊車","水車","其他"],MACH_LABEL={excavator:"（　）型挖土機"},crew={types:[],machs:[]},crewSeq=0;function crewLoad(){var v=C.store.getJSON(K_CREW,null);v&&typeof v=="object"&&(crew.types=Array.isArray(v.types)?v.types:[],crew.machs=Array.isArray(v.machs)?v.machs:[]);var old=C.store.get(K_STAFF,"");old&&!crew.types.length&&!crew.machs.length&&crew.types.push({id:++crewSeq,sel:"其他",custom:old})}function crewSave(){C.store.setJSON(K_CREW,crew);try{paintShareText()}catch(e){}}function crewRowHTML(kind,row){var opts=kind==="type"?TYPE_OPTS:MACH_OPTS,html='<div class="crewrow" data-kind="'+kind+'" data-id="'+row.id+'"><select class="crewsel" aria-label="'+(kind==="type"?"工種":"機具")+'">';return html+='<option value="">— 請選擇 —</option>',opts.forEach(function(o){var label=MACH_LABEL[o]||o;html+='<option value="'+esc(o)+'"'+(row.sel===o?" selected":"")+">"+esc(label)+"</option>"}),html+="</select>",kind==="mach"&&(html+='<input type="text" class="crewmodel" inputmode="numeric" maxlength="6" placeholder="型號，例：200" value="'+esc(row.model||"")+'"'+(row.sel==="excavator"?"":' style="display:none"')+">"),html+='<input type="text" class="crewcustom" maxlength="40" placeholder="請填寫" value="'+esc(row.custom||"")+'"'+(row.sel==="其他"?"":' style="display:none"')+">",html+='<input type="number" class="crewqty" inputmode="numeric" min="0" max="999" step="1" placeholder="數量" title="數量" value="'+esc(row.qty||"")+'">',html+='<button type="button" class="crewdel" title="刪除這一列" aria-label="刪除這一列">✕</button>',html+="</div>",html}function crewRender(){[["type","typeRows","typeEmpty",crew.types],["mach","machRows","machEmpty",crew.machs]].forEach(function(cfg){var box=$(cfg[1]),empty=$(cfg[2]),list=cfg[3];box&&(box.innerHTML=list.map(function(r){return crewRowHTML(cfg[0],r)}).join(""),empty&&(empty.style.display=list.length?"none":"block"))})}function crewAdd(kind){var list=kind==="type"?crew.types:crew.machs;list.push({id:++crewSeq,sel:"",custom:"",model:"",qty:""}),crewSave(),crewRender();var box=$(kind==="type"?"typeRows":"machRows");if(box){var rows=box.querySelectorAll(".crewrow"),last=rows[rows.length-1];if(last){var s=last.querySelector(".crewsel");s&&s.focus()}}}function crewFind(kind,id){for(var list=kind==="type"?crew.types:crew.machs,i=0;i<list.length;i++)if(String(list[i].id)===String(id))return list[i];return null}function crewBind(boxId,kind){var box=$(boxId);box&&(C.on(box,"change",function(e){var t=e.target,rowEl=t.closest?t.closest(".crewrow"):null;if(rowEl){var row=crewFind(kind,rowEl.getAttribute("data-id"));if(row){if(t.classList.contains("crewsel")){row.sel=t.value;var model=rowEl.querySelector(".crewmodel"),custom=rowEl.querySelector(".crewcustom");model&&(model.style.display=t.value==="excavator"?"":"none"),custom&&(custom.style.display=t.value==="其他"?"":"none"),t.value==="excavator"&&model&&model.focus(),t.value==="其他"&&custom&&custom.focus()}else t.classList.contains("crewmodel")?row.model=t.value:t.classList.contains("crewqty")?row.qty=t.value:t.classList.contains("crewcustom")&&(row.custom=t.value);crewSave()}}}),C.on(box,"input",function(e){var t=e.target,rowEl=t.closest?t.closest(".crewrow"):null;if(rowEl){var row=crewFind(kind,rowEl.getAttribute("data-id"));row&&(t.classList.contains("crewmodel")?row.model=t.value:t.classList.contains("crewqty")?row.qty=t.value:t.classList.contains("crewcustom")&&(row.custom=t.value),crewSave())}}),C.on(box,"click",function(e){var btn=e.target.closest?e.target.closest(".crewdel"):null;if(btn){var rowEl=btn.closest(".crewrow");if(rowEl){for(var id=rowEl.getAttribute("data-id"),list=kind==="type"?crew.types:crew.machs,i=0;i<list.length;i++)if(String(list[i].id)===String(id)){list.splice(i,1);break}crewSave(),crewRender()}}}))}function crewRowText(kind,row){if(!row||!row.sel)return"";var base;if(kind==="mach"&&row.sel==="excavator"){var m=String(row.model||"").trim();base=(m?m+"型":"（未填型號）型")+"挖土機"}else base=row.sel==="其他"?String(row.custom||"").trim():row.sel;if(!base)return"";var q=String(row.qty==null?"":row.qty).trim();return q&&Number(q)>0?base+" ×"+q:base}function crewTexts(kind){var list=kind==="type"?crew.types:crew.machs,out=[];return list.forEach(function(r){var t=crewRowText(kind,r);t&&out.push(t)}),out}
/* ---- 分享附文字 ---- */
var chkShareText=$("chkShareText"),shareTextPreview=$("shareTextPreview");
function shareTextStar(kind){var list=kind==="type"?crew.types:crew.machs,out=[];return list.forEach(function(r){if(!r||!r.sel)return;var base;if(kind==="mach"&&r.sel==="excavator"){var m=String(r.model||"").trim();base=(m?m+"型":"（未填型號）型")+"挖土機"}else base=r.sel==="其他"?String(r.custom||"").trim():r.sel;if(!base)return;var q=String(r.qty==null?"":r.qty).trim();out.push(q&&Number(q)>0?base+"*"+q:base)}),out}
function buildShareText(){
  var item=(fItem&&fItem.value||"").trim(),vendor=(fVendor&&fVendor.value||"").trim();
  var t=shareTextStar("type"),m=shareTextStar("mach"),crewTxt=t.concat(m).join("、");
  var head=item||vendor?((item||"")+(item&&vendor?"，":"")+(vendor||"")):"";
  if(!head&&!crewTxt)return"";
  return head+(head&&crewTxt?" ":"")+crewTxt;
}
function paintShareText(){
  if(!shareTextPreview)return;
  var on=!!(chkShareText&&chkShareText.checked),txt=buildShareText();
  if(!on||!txt){shareTextPreview.style.display="none";shareTextPreview.textContent="";return}
  shareTextPreview.style.display="block";shareTextPreview.textContent="照片送出後附上："+txt;
}
C.on(chkShareText,"change",function(){C.store.set("build-assistant-sharetext",chkShareText.checked?"1":"0"),paintShareText()});
/* ---- 分享：照片先送完，文字說明在照片送出後才附 ---- */
var pendingShareText="",btnShareText=$("btnShareText");
function copyText(txt){
  return new Promise(function(res){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(txt).then(function(){res(true)}).catch(function(){res(false)});
    }else res(false);
  });
}
function showShareTextBtn(txt){
  pendingShareText=txt||"";
  if(!btnShareText)return;
  if(!pendingShareText){btnShareText.style.display="none";return}
  btnShareText.style.display="";
  btnShareText.textContent="附上文字說明";
}
function shareTextOnly(txt){
  if(!txt)return Promise.resolve("none");
  var pr;
  try{pr=navigator.share({text:txt})}
  catch(e){return copyText(txt).then(function(ok){return ok?"copied":"fail"})}
  return Promise.resolve(pr).then(function(){return "shared"}).catch(function(e){
    if(e&&e.name==="AbortError")return "abort";
    return copyText(txt).then(function(ok){return ok?"copied":"fail"});
  });
}
/* 第一段只送照片（不帶 text、不帶 title）；照片送出後才送文字 */
function sharePhotosThenText(files){
  var txt=(chkShareText&&chkShareText.checked)?buildShareText():"";
  var pr;
  try{pr=navigator.share({files:files})}
  catch(e){return Promise.reject(e)}
  return Promise.resolve(pr).then(function(){
    if(!txt)return "photos";
    showShareTextBtn(txt);
    return shareTextOnly(txt).then(function(r){
      if(r==="shared"){showShareTextBtn("");toast("照片已送出，文字說明已附上")}
      else if(r==="copied"){toast("照片已送出，文字已複製，貼到 LINE 即可")}
      else if(r==="abort"){toast("照片已送出；文字未附，可按「附上文字說明」")}
      return "photos+text";
    });
  });
}
C.on(btnShareText,"click",function(){
  var txt=pendingShareText||buildShareText();
  if(!txt){toast("沒有可附的文字",!0);return}
  shareTextOnly(txt).then(function(r){
    if(r==="shared"){showShareTextBtn("");toast("文字說明已附上")}
    else if(r==="copied"){toast("文字已複製，貼到 LINE 即可")}
  });
});
(function(){var v=C.store.get("build-assistant-sharetext","");chkShareText&&(chkShareText.checked=v==="1");paintShareText()})();crewLoad(),crewRender(),crewBind("typeRows","type"),crewBind("machRows","mach"),C.on($("btnAddType"),"click",function(){crewAdd("type")}),C.on($("btnAddMach"),"click",function(){crewAdd("mach")});
/* ---- 常用班組 ---- */
var K_PRESET="build-assistant-presets",presets=[],presetSeq=0;
function presetLoad(){var v=C.store.getJSON(K_PRESET,null);presets=Array.isArray(v)?v:[],presets.forEach(function(p){p.id=Number(p.id)||++presetSeq,presetSeq=Math.max(presetSeq,p.id)})}
function presetSaveStore(){C.store.setJSON(K_PRESET,presets)}
function presetClone(list){return (list||[]).map(function(r){return{id:++crewSeq,sel:r.sel||"",custom:r.custom||"",model:r.model||"",qty:r.qty==null?"":String(r.qty)}})}
function presetSummary(p){var t=(p.types||[]).map(function(r){return crewRowText("type",r)}).filter(Boolean),m=(p.machs||[]).map(function(r){return crewRowText("mach",r)}).filter(Boolean),out=[];return t.length&&out.push("工種："+t.join("、")),m.length&&out.push("機具："+m.join("、")),out.join("｜")||"（空白班組）"}
function presetRender(){var box=$("presetList"),empty=$("presetEmpty");if(box){if(!presets.length){box.innerHTML="",empty&&(empty.style.display="block");return}empty&&(empty.style.display="none"),box.innerHTML=presets.map(function(p){return'<div class="presetitem" data-id="'+p.id+'"><button type="button" class="papply" data-act="apply" data-id="'+p.id+'" title="套用到工種與機具"><b>'+esc(p.name)+'</b><span class="psum">'+esc(presetSummary(p))+'</span></button><button type="button" class="pmini" data-act="rename" data-id="'+p.id+'" title="重新命名">✎</button><button type="button" class="pmini del" data-act="del" data-id="'+p.id+'" title="刪除">✕</button></div>'}).join("")}}
function presetFind(id){for(var i=0;i<presets.length;i++)if(String(presets[i].id)===String(id))return presets[i];return null}
C.on($("btnPresetSave"),"click",function(){var nameEl=$("presetName"),name=(nameEl&&nameEl.value||"").trim();if(!name){toast("請先輸入班組名稱",!0),nameEl&&nameEl.focus();return}if(!crew.types.length&&!crew.machs.length){toast("工種與機具都還是空的，沒有東西可存",!0);return}var dup=null;presets.forEach(function(p){p.name===name&&(dup=p)});if(dup){if(!confirm("已有同名班組「"+name+"」，要覆蓋嗎？"))return;dup.types=presetClone(crew.types),dup.machs=presetClone(crew.machs)}else presets.push({id:++presetSeq,name:name,types:presetClone(crew.types),machs:presetClone(crew.machs)});presetSaveStore(),presetRender(),nameEl&&(nameEl.value=""),toast("已存成常用班組「"+name+"」")});
C.on($("presetList"),"click",function(e){var b=e.target.closest?e.target.closest("button[data-act]"):null;if(!b)return;var act=b.getAttribute("data-act"),p=presetFind(b.getAttribute("data-id"));if(!p)return;if(act==="apply"){crew.types=presetClone(p.types),crew.machs=presetClone(p.machs),crewSave(),crewRender(),toast("已套用「"+p.name+"」")}else if(act==="rename"){var nn=prompt("重新命名班組",p.name);if(nn===null)return;nn=String(nn).trim();if(!nn){toast("名稱不能空白",!0);return}p.name=nn,presetSaveStore(),presetRender(),toast("已更名為「"+nn+"」")}else if(act==="del"){if(!confirm("要刪除常用班組「"+p.name+"」嗎？"))return;for(var i=0;i<presets.length;i++)if(presets[i]===p){presets.splice(i,1);break}presetSaveStore(),presetRender(),toast("已刪除「"+p.name+"」")}});
presetLoad(),presetRender();
/* ---- 常用廠商 ---- */
var K_VPRESET="build-assistant-vendor-presets",vpresets=[],vpresetSeq=0;
function vpresetLoad(){var v=C.store.getJSON(K_VPRESET,null);vpresets=Array.isArray(v)?v:[],vpresets.forEach(function(p){p.id=Number(p.id)||++vpresetSeq,vpresetSeq=Math.max(vpresetSeq,p.id)})}
function vpresetSaveStore(){C.store.setJSON(K_VPRESET,vpresets)}
function vpresetRender(){var box=$("vendorList"),empty=$("vendorEmpty");if(!box)return;if(!vpresets.length){box.innerHTML="",empty&&(empty.style.display="block");return}empty&&(empty.style.display="none"),box.innerHTML=vpresets.map(function(p){return'<div class="presetitem" data-id="'+p.id+'"><button type="button" class="papply" data-act="vapply" data-id="'+p.id+'" title="套用到廠商名稱"><b>'+esc(p.name)+'</b></button><button type="button" class="pmini" data-act="vrename" data-id="'+p.id+'" title="重新命名">✎</button><button type="button" class="pmini del" data-act="vdel" data-id="'+p.id+'" title="刪除">✕</button></div>'}).join("")}
function vpresetFind(id){for(var i=0;i<vpresets.length;i++)if(String(vpresets[i].id)===String(id))return vpresets[i];return null}
C.on($("btnVendorSave"),"click",function(){var el=$("vendorPresetName"),name=(el&&el.value||"").trim();if(!name){toast("請先輸入廠商名稱",!0),el&&el.focus();return}var dup=null;vpresets.forEach(function(p){p.name===name&&(dup=p)});if(dup){toast("已有同名廠商「"+name+"」",!0);return}vpresets.push({id:++vpresetSeq,name:name}),vpresetSaveStore(),vpresetRender(),el&&(el.value=""),toast("已存成常用廠商「"+name+"」")});
C.on($("vendorList"),"click",function(e){var b=e.target.closest?e.target.closest("button[data-act]"):null;if(!b)return;var act=b.getAttribute("data-act"),p=vpresetFind(b.getAttribute("data-id"));if(!p)return;if(act==="vapply"){fVendor&&(fVendor.value=p.name),C.store.set(K_VENDOR,p.name),paintShareText(),toast("已套用廠商「"+p.name+"」")}else if(act==="vrename"){var nn=prompt("重新命名廠商",p.name);if(nn===null)return;nn=String(nn).trim();if(!nn){toast("名稱不能空白",!0);return}p.name=nn,vpresetSaveStore(),vpresetRender(),toast("已更名為「"+nn+"」")}else if(act==="vdel"){if(!confirm("要刪除常用廠商「"+p.name+"」嗎？"))return;for(var i=0;i<vpresets.length;i++)if(vpresets[i]===p){vpresets.splice(i,1);break}vpresetSaveStore(),vpresetRender(),toast("已刪除「"+p.name+"」")}});
vpresetLoad(),vpresetRender();
function loadBitmap(file){return window.createImageBitmap?createImageBitmap(file,{imageOrientation:"from-image"}).catch(function(){return createImageBitmap(file)}):new Promise(function(res,rej){var u=URL.createObjectURL(file),im=new Image;im.onload=function(){URL.revokeObjectURL(u),res(im)},im.onerror=function(){URL.revokeObjectURL(u),rej(new Error("讀取失敗"))},im.src=u})}function freeBmp(b){try{b&&b.close&&b.close()}catch(e){}}function drawTo(bmp,angle,maxEdge){var w0=bmp.width,h0=bmp.height,swap=angle===90||angle===270,ow=swap?h0:w0,oh=swap?w0:h0,s=Math.min(1,maxEdge/Math.max(1,ow,oh)),w=Math.max(1,Math.round(ow*s)),h=Math.max(1,Math.round(oh*s)),cv=document.createElement("canvas");cv.width=w,cv.height=h;var ctx=cv.getContext("2d");if(ctx.fillStyle="#fff",ctx.fillRect(0,0,w,h),angle){var dw=Math.round(w0*s),dh=Math.round(h0*s);ctx.save(),ctx.translate(w/2,h/2),ctx.rotate(angle*Math.PI/180),ctx.drawImage(bmp,-dw/2,-dh/2,dw,dh),ctx.restore()}else ctx.drawImage(bmp,0,0,w,h);return cv}function canvasToPng(cv){return new Promise(function(res,rej){try{cv.toBlob(function(b){b?res(b):rej(new Error("影像輸出失敗"))},"image/png")}catch(e){rej(e)}})}function thumbURL(cv){try{var s=Math.min(1,THUMB_EDGE/Math.max(cv.width,cv.height)),t=document.createElement("canvas");return t.width=Math.max(1,Math.round(cv.width*s)),t.height=Math.max(1,Math.round(cv.height*s)),t.getContext("2d").drawImage(cv,0,0,t.width,t.height),t.toDataURL("image/jpeg",.72)}catch(e){return""}}function stampDate(cv,dateISO){var txt=String(dateISO||"");if(!txt)return!1;var PW=window.PhotoWatermark;return PW&&typeof PW.drawWatermark=="function"?(PW.drawWatermark(cv.getContext("2d"),cv.width,cv.height,txt),!0):!1}function renderStage(){if(pgrid){if(!stage.length){pgrid.innerHTML="",pEmpty&&(pEmpty.style.display="block"),pProg&&(pProg.textContent=""),updateBtns();return}pEmpty&&(pEmpty.style.display="none");var html="";stage.forEach(function(it,i){var bd="",bdtxt="";it.status==="done"?(bd="ok",bdtxt="已上傳"):it.status==="busy"?(bd="wait",bdtxt="處理中"):it.status==="err"?(bd="err",bdtxt="失敗"):(bd="",bdtxt="待上傳"),html+='<figure class="ph" data-id="'+it.id+'"><div class="phimg">'+(it.thumb?'<img src="'+it.thumb+'" alt="第 '+(i+1)+' 張">':'<span class="phno">第 '+(i+1)+" 張</span>")+'<span class="bd '+bd+'">'+bdtxt+'</span></div><figcaption title="'+esc(it.name||"")+'">'+esc(it.name||"第 "+(i+1)+" 張")+'</figcaption><div class="phact"><button type="button" class="mini" data-act="rot" data-id="'+it.id+'">↻ 旋轉</button><button type="button" class="mini del" data-act="del" data-id="'+it.id+'" title="移除">×</button></div></figure>'}),pgrid.innerHTML=html,updateBtns()}}function updateBtns(){var n=stage.length,pc=$("pCount");pc&&(pc.textContent=String(n)),btnUpload&&(btnUpload.disabled=uploading||n===0,btnUpload.classList.toggle("busy",!!uploading),btnUpload.title=uploading?"上傳中…":"上傳至 Google Drive（"+n+" 張）");var uc=$("upCount");uc&&(uc.textContent=String(n)),btnClear&&(btnClear.disabled=uploading||n===0),btnDownload&&(btnDownload.disabled=uploading||n===0);var sl=$("btnStageLine");if(sl){var pn=0;stage.forEach(function(x){if(x.pngFile)pn++});sl.disabled=uploading||n===0||pn<n;sl.title=n?(pn<n?("正在準備 PNG "+pn+"/"+n):("分享 "+n+" 張 PNG 到 LINE")):"分享到 LINE"}}function addFiles(files){var list=C.toArray(files||[]).filter(function(f){return f&&/^image\//.test(f.type||"")||/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name||"")});if(!list.length){toast("沒有可加入的圖片檔",!0);return}list.forEach(function(f){var it={id:"q"+ ++pendSeq,file:f,thumb:""};pend.push(it),loadBitmap(f).then(function(bmp){var cv=drawTo(bmp,0,THUMB_EDGE);it.thumb=thumbURL(cv),freeBmp(bmp)}).catch(function(){}).then(pendRender)}),pendRender()}
/* ---- 待加入緩衝：一次多張，再一次丟進暫存區 ---- */
var pend=[],pendSeq=0;
function pendRender(){
  var box=$("pendBox"),grid=$("pendGrid"),cnt=$("pendCount"),btn=$("btnPendAdd");
  if(!box)return;
  if(!pend.length){box.style.display="none";grid&&(grid.innerHTML="");cnt&&(cnt.textContent="0");btn&&(btn.textContent="加入暫存區（0）");return}
  box.style.display="block";
  cnt&&(cnt.textContent=String(pend.length));
  btn&&(btn.textContent="加入暫存區（"+pend.length+"）");
  if(grid){var html="";pend.forEach(function(it,i){html+='<figure class="ph pend" data-id="'+it.id+'"><div class="phimg">'+(it.thumb?'<img src="'+it.thumb+'" alt="第 '+(i+1)+' 張">':'<span class="phno">第 '+(i+1)+" 張</span>")+'</div><div class="phact"><button type="button" class="mini del" data-act="pdel" data-id="'+it.id+'" title="移除">×</button></div></figure>'});grid.innerHTML=html}
}
C.on($("btnPendAdd"),"click",function(){
  if(!pend.length)return;
  var files=pend.map(function(p){return p.file});
  pend=[],pendRender(),stageAddFiles(files);
  toast("已加入暫存區 "+files.length+" 張");
  var pc=$("pCount");if(pc&&pc.scrollIntoView)try{pc.scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}
});
C.on($("btnPendClear"),"click",function(){if(!pend.length)return;pend=[],pendRender(),toast("已清除待加入的照片")});
C.on($("pendGrid"),"click",function(e){var b=e.target.closest?e.target.closest("button[data-act]"):null;if(!b)return;for(var id=b.getAttribute("data-id"),i=0;i<pend.length;i++)if(pend[i].id===id){pend.splice(i,1);break}pendRender()});
function stageAddFiles(list){list.forEach(function(f){var it={id:"p"+ ++seq,file:f,thumb:"",blob:null,status:"idle",msg:"",angle:0,name:f.name||"",pngFile:null};stage.push(it),loadBitmap(f).then(function(bmp){var cv=drawTo(bmp,0,THUMB_EDGE);it.thumb=thumbURL(cv),freeBmp(bmp)}).catch(function(){}).then(function(){renderStage()}),stagePreparePng(it)}),renderStage()}
function stagePngName(it,idx){var d=String((fDate&&fDate.value)||todayISO()).replace(/-/g,""),mid=safeName((fItem&&fItem.value||"").trim(),24)||"photo";return d+"_"+mid+"_"+pad2(idx+1)+".png"}
function stagePreparePng(it){
  if(!it||!it.file)return Promise.resolve(null);
  var ang=it.angle||0;
  return loadBitmap(it.file).then(function(bmp){
    var cv=drawTo(bmp,ang,MAX_EDGE);freeBmp(bmp);
    return canvasToPng(cv);
  }).then(function(blob){
    var idx=stage.indexOf(it);
    var nm=stagePngName(it,idx<0?0:idx);
    try{it.pngFile=new File([blob],nm,{type:"image/png"})}catch(e){it.pngFile=null}
    updateBtns();
    return it.pngFile;
  }).catch(function(){it.pngFile=null;updateBtns();return null});
}C.on($("filePick"),"change",function(e){addFiles(e.target.files),e.target.value=""});
/* ---- 拍照：改用「手機本機相機 App」，可連拍多張，拍完按「使用照片」一次帶入 ---- */
var camBuf=[],camSeq=0;
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
/* 開手機本機相機 App（capture=environment）。一次只會回一張，所以拍完回到頁面後
   自動把「再拍一張」的提示留在緩衝區，讓使用者可以連續拍。 */
function camOpenNative(){
  var inp=$("camInput");
  if(!inp){toast("找不到相機入口",!0);return}
  try{inp.value=""}catch(e){}
  inp.click();
}
C.on($("btnCam"),"click",camOpenNative);
C.on($("camShootMore"),"click",camOpenNative);
C.on($("camBufClear"),"click",function(){if(!camBuf.length)return;camBufClear();toast("已清除剛拍的照片")});
C.on($("camBufGrid"),"click",function(e){
  var b=e.target.closest?e.target.closest("button[data-cx]"):null;
  if(!b)return;
  var i=Number(b.getAttribute("data-cx"));
  if(isNaN(i)||!camBuf[i])return;
  try{URL.revokeObjectURL(camBuf[i].url)}catch(e2){}
  camBuf.splice(i,1);camBufRender();
});
C.on($("camUse"),"click",function(){
  if(!camBuf.length)return;
  var files=camBuf.map(function(s){return s.file});
  camBufClear();
  stageAddFiles(files);
  toast("已帶入暫存區 "+files.length+" 張");
  var pc=$("pCount");if(pc&&pc.scrollIntoView)try{pc.scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}
});
/* 本機相機 App 拍完回傳 */
C.on($("camInput"),"change",function(e){
  var fs=C.toArray(e.target.files||[]);
  e.target.value="";
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
C.on(pgrid,"click",function(e){var b=e.target.closest?e.target.closest("button[data-act]"):null;if(b){for(var id=b.getAttribute("data-id"),idx=-1,i=0;i<stage.length;i++)if(stage[i].id===id){idx=i;break}if(!(idx<0)){var act=b.getAttribute("data-act");if(act==="del")stage.splice(idx,1),renderStage();else if(act==="rot"){var it=stage[idx];it.angle=(it.angle+90)%360,it.status="idle",it.pngFile=null,loadBitmap(it.file).then(function(bmp){var cv=drawTo(bmp,it.angle,THUMB_EDGE);it.thumb=thumbURL(cv),freeBmp(bmp),renderStage()}).catch(function(){renderStage()}),stagePreparePng(it).then(function(){updateBtns()})}}}}),C.on(btnClear,"click",function(){stage.length&&confirm("要清空目前暫存的 "+stage.length+" 張照片嗎？（已上傳到 Drive 的不受影響）")&&(stage=[],renderStage())});function buildName(dateISO,item,n){var d=String(dateISO||todayISO()).replace(/-/g,""),mid=safeName(item||"",24);if(!mid){var now=new Date;mid=pad2(now.getHours())+pad2(now.getMinutes())+pad2(now.getSeconds())}return d+"_"+mid+"_"+pad2(n)+".png"}function finalize(it,dateISO,index){return loadBitmap(it.file).then(function(bmp){var cv=drawTo(bmp,it.angle,MAX_EDGE);freeBmp(bmp);var applied=!1;if(wmOn)try{applied=stampDate(cv,dateISO)}catch(e){applied=!1}return canvasToPng(cv).then(function(blob){return{blob,applied,width:cv.width,height:cv.height}})})}C.on(btnUpload,"click",function(){if(uploading||!stage.length)return;var G=window.GDrivePhoto;if(!G){toast("Drive 模組未載入",!0);return}var dateISO=fDate&&fDate.value||todayISO(),item=(fItem&&fItem.value||"").trim(),vendor=(fVendor&&fVendor.value||"").trim(),typeTxt=crewTexts("type").join("、"),machTxt=crewTexts("mach").join("、");uploading=!0,updateBtns(),pProg&&(pProg.textContent="正在連線 Google Drive…");var okN=0,errN=0,i=0;function step(){if(i>=stage.length){if(uploading=!1,updateBtns(),pProg&&(pProg.textContent="完成：成功 "+okN+" 張"+(errN?"，失敗 "+errN+" 張":"")+"。"),toast(errN?"上傳完成，成功 "+okN+" 張、失敗 "+errN+" 張":"已上傳 "+okN+" 張到 Google Drive",!!errN),okN)try{window.__buildLibRefresh&&window.__buildLibRefresh()}catch(e){}return}var it=stage[i];if(it.status==="done"){i++,step();return}it.status="busy",renderStage(),pProg&&(pProg.textContent="處理第 "+(i+1)+" / "+stage.length+" 張…"),finalize(it,dateISO,i+1).then(function(fin){var name=buildName(dateISO,item,i+1),desc=[];return item&&desc.push("工項："+item),vendor&&desc.push("廠商："+vendor),typeTxt&&desc.push("工種："+typeTxt),machTxt&&desc.push("機具："+machTxt),desc.push("浮水印："+(fin.applied?dateISO:"未套用")),G.uploadPhoto({blob:fin.blob,filename:name,date:dateISO,mime:"image/png",description:desc.join("｜")}).then(function(res){it.status="done",it.msg=res.name||name,it.name=res.name||name,okN++})}).catch(function(e){it.status="err",it.msg=e&&e.message?e.message:"上傳失敗",errN++}).then(function(){i++,renderStage(),step()})}G.ensureToken?G.ensureToken().then(step).catch(function(e){uploading=!1,updateBtns();var msg=e&&e.message?e.message:"需要授權";pProg&&(pProg.textContent="⚠ "+msg),toast(msg,!0)}):step()}),C.on(btnDownload,"click",function(){if(uploading||!stage.length)return;var dateISO=fDate&&fDate.value||todayISO(),item=(fItem&&fItem.value||"").trim(),i=0;function step(){if(i>=stage.length){toast("已下載 "+stage.length+" 張");return}var it=stage[i];finalize(it,dateISO,i+1).then(function(fin){C.download(buildName(dateISO,item,i+1),fin.blob,"image/png"),i++,setTimeout(step,320)}).catch(function(){i++,step()})}step()});var connDot=$("connDot"),connTxt=$("connTxt"),connBtn=$("connBtn");function paintConn(st){if(!(!connDot||!connTxt)){var map={connected:["ok","已連線 Google Drive"],connecting:["wait","連線中…"],silent:["wait","自動連線…"],syncing:["wait","同步中…"],expired:["warn","授權已過期，請重新連線"],unauthorized:["warn","尚未授權"],idle:["","尚未連線"],error:["err","連線失敗"]},m=map[st&&st.state]||map.idle;connDot.className="dot "+m[0],connTxt.textContent=m[1]+(st&&st.email?"（"+st.email+"）":""),connBtn&&(connBtn.textContent=st&&st.state==="connected"?"↻ 重新連線":"🔗 連線 Google Drive")}}var G0=window.GDrivePhoto;if(G0&&G0.onStatus&&(G0.onStatus(paintConn),G0.restoreToken&&G0.restoreToken()))try{G0.silentConnect().catch(function(){})}catch(e){}C.on(connBtn,"click",function(){var G=window.GDrivePhoto;if(!G){toast("Drive 模組未載入",!0);return}G.connect().then(function(){toast("已連線 Google Drive")}).catch(function(e){toast(e&&e.message||"連線失敗",!0)})}),renderStage();var libDate=$("libDate"),libItem=$("libItem"),libGrid=$("libGrid"),libEmpty=$("libEmpty"),libBar=$("libBar"),libSel=$("libSel"),libSum=$("libSum"),libAll=[],libPicked={},libLoading=!1;libDate&&!libDate.value&&(libDate.value=todayISO());function libItemOf(rec){var it=rec.item||"";if(!it){var m=/^\d{8}_(.+?)_\d{2}\.[a-z0-9]+$/i.exec(rec.name||"");if(m){var mid=m[1];/^\d{6}$/.test(mid)||(it=mid)}}return it}function libFillItems(){if(libItem){var seen={},list=[];libAll.forEach(function(r){var it=libItemOf(r);it&&!seen[it]&&(seen[it]=1,list.push(it))}),list.sort();var cur=libItem.value,html='<option value="">全部工項</option>';list.forEach(function(it){html+='<option value="'+esc(it)+'">'+esc(it)+"</option>"}),libItem.innerHTML=html,cur&&seen[cur]&&(libItem.value=cur)}}function libVisible(){var want=libItem?libItem.value:"";return want?libAll.filter(function(r){return libItemOf(r)===want}):libAll}function libCount(){var n=0;for(var k in libPicked)libPicked[k]&&n++;return n}function libRender(){if(libGrid){var vis=libVisible();if(!vis.length){libGrid.innerHTML="",libEmpty&&(libEmpty.style.display="block",libEmpty.textContent=libAll.length?"此工項無照片":"此日期無照片"),libBar&&(libBar.style.display="none"),libSum&&(libSum.textContent=libAll.length?libAll.length+" 張":"");return}libEmpty&&(libEmpty.style.display="none"),libBar&&(libBar.style.display="flex");var html="";vis.forEach(function(r,i){var on=!!libPicked[r.id];html+='<figure class="libitem'+(on?" sel":"")+'" data-id="'+esc(r.id)+'"><div class="limg"><span class="lchk" aria-hidden="true">✓</span><span class="lno">第 '+(i+1)+' 張</span></div><figcaption title="'+esc(r.name)+'">'+esc(r.name)+'</figcaption><div class="lmeta">'+esc(libItemOf(r)||"（未填工項）")+"</div>"+(r.crewType||r.crewMach?'<div class="lcrew">'+(r.crewType?'<span class="lc lct">工種：'+esc(r.crewType)+"</span>":"")+(r.crewMach?'<span class="lc lcm">機具：'+esc(r.crewMach)+"</span>":"")+"</div>":"")+"</figure>"}),libGrid.innerHTML=html;for(var figs=libGrid.querySelectorAll(".libitem"),j=0;j<figs.length;j++)(function(fig,rec){var box=fig.querySelector(".limg"),G=window.GDrivePhoto;!G||!G.makeThumb||G.makeThumb(rec.id,260).then(function(url){if(url){var img=document.createElement("img");img.src=url,img.alt=rec.name||"",img.loading="lazy";var no=box.querySelector(".lno");no&&no.remove(),box.insertBefore(img,box.firstChild)}}).catch(function(){})})(figs[j],vis[j]);libSum&&(libSum.textContent=(libItem&&libItem.value?vis.length+"/"+libAll.length:libAll.length)+" 張"),libUpdateSel()}}function libUpdateSel(){var n=libCount();libSel&&(libSel.textContent="已選 "+n+" 張");var recs=libPickedRecs();try{recs.forEach(function(r){libPrepare(r)})}catch(e){}libRenderReady();libUpdateShareBtn()}function libLoad(){var G=window.GDrivePhoto;if(!G||!G.listDayPhotos){toast("Drive 模組未載入",!0);return}if(!libLoading){var d=libDate&&libDate.value||"";if(!d){toast("請先選日期",!0);return}libLoading=!0,libSum&&(libSum.textContent=""),libEmpty&&(libEmpty.style.display="block",libEmpty.textContent="讀取中…"),libGrid&&(libGrid.innerHTML=""),libBar&&(libBar.style.display="none"),G.listDayPhotos(d).then(function(res){if(libAll=res&&res.records||[],libPicked={},libBlobCache={},libReady={},libThumbURL={},libLastShare=null,libLastErr="",libAdded={},libFillItems(),libRender(),!libAll.length){var why=res&&res.reason;libEmpty&&(libEmpty.style.display="block",libEmpty.textContent=why==="no-parent"?"Drive 尚無「義力」資料夾":why==="no-root"?"尚無「施工照片」資料夾":"此日期無資料夾")}toast("已讀取 "+libAll.length+" 張")}).catch(function(e){libEmpty&&(libEmpty.style.display="block",libEmpty.textContent="讀取失敗"),toast(e&&e.message||"讀取失敗",!0)}).then(function(){libLoading=!1})}}C.on($("btnLibLoad"),"click",libLoad),C.on(libItem,"change",function(){libRender()}),C.on(libDate,"change",function(){libAll=[],libPicked={},libRender()}),C.on(libGrid,"click",function(e){var fig=e.target.closest?e.target.closest(".libitem"):null;if(fig){var id=fig.getAttribute("data-id");id&&(libPicked[id]?delete libPicked[id]:libPicked[id]=!0,fig.classList.toggle("sel",!!libPicked[id]),libUpdateSel())}}),C.on($("btnLibAll"),"click",function(){libVisible().forEach(function(r){libPicked[r.id]=!0}),libRender(),libUpdateSel()}),C.on($("btnLibNone"),"click",function(){libPicked={},libRender(),libRenderReady(),libUpdateShareBtn()});function libPickedRecs(){return libAll.filter(function(r){return libPicked[r.id]})}C.on($("btnLibCopy"),"click",function(){var recs=libPickedRecs();if(!recs.length)return;var txt=recs.map(function(r){return r.name+"\n"+r.link}).join("\n\n");function done(){toast("已複製 "+recs.length+" 張的連結")}navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(txt).then(done).catch(function(){C.download("photo-links.txt",txt,"text/plain"),done()}):(C.download("photo-links.txt",txt,"text/plain"),done())});var libBlobCache={},libPrefetching={};
function libPngName(rec){var nm=rec&&rec.name?String(rec.name):("photo_"+(rec&&rec.id||"x")+".png");return nm.replace(/\.[a-z0-9]+$/i,"")+".png"}
function libToPngBlob(blob){return new Promise(function(res,rej){if(!blob)return rej(new Error("沒有檔案內容"));if(blob.type==="image/png")return res(blob);var WM=window.PhotoWatermark,load=WM&&WM.loadImageFromBlob?WM.loadImageFromBlob(blob):new Promise(function(r2,j2){var u=URL.createObjectURL(blob),im=new Image;im.onload=function(){URL.revokeObjectURL(u),r2({el:im,width:im.naturalWidth,height:im.naturalHeight,release:function(){}})};im.onerror=function(){URL.revokeObjectURL(u),j2(new Error("讀取失敗"))};im.src=u});load.then(function(img){try{var w=img.width||img.el&&img.el.naturalWidth||0,h=img.height||img.el&&img.el.naturalHeight||0;if(!w||!h)throw new Error("影像尺寸為 0");var cv=document.createElement("canvas");cv.width=w,cv.height=h;var ctx=cv.getContext("2d");ctx.fillStyle="#fff",ctx.fillRect(0,0,w,h),ctx.drawImage(img.el||img,0,0,w,h),cv.toBlob(function(b){b?res(b):rej(new Error("PNG 轉檔失敗"))},"image/png")}catch(e){rej(e)}finally{try{img.release&&img.release()}catch(e){}}},rej)})}
function libPngFile(rec,blob){return libToPngBlob(blob).then(function(png){var nm=libPngName(rec),f;try{f=new File([png],nm,{type:"image/png",lastModified:Date.now()})}catch(e){f=png;try{f.name=nm,f.lastModified=Date.now()}catch(e2){}}if(!f||f.type!=="image/png"||!/\.png$/i.test(f.name||""))throw new Error("不是 PNG 檔");return f})}
var libBlobCache={},libPrefetching={},libReady={},libThumbURL={},libLastShare=null,libLastErr="";
function libCanShareFiles(files){try{return!!(navigator.canShare&&navigator.share&&files&&files.length&&navigator.canShare({files:files}))}catch(e){return!1}}
function libSetMode(txt){var el=$("libShareMode");el&&(el.textContent=txt||"")}
function libThumbOf(rec,file){if(libThumbURL[rec.id])return libThumbURL[rec.id];try{var u=URL.createObjectURL(file);libThumbURL[rec.id]=u;return u}catch(e){return""}}
function libPrepare(rec){
  if(!rec)return Promise.resolve(null);
  if(libBlobCache[rec.id]){libReady[rec.id]={status:"ready",file:libBlobCache[rec.id]};return Promise.resolve(libBlobCache[rec.id])}
  if(libPrefetching[rec.id])return libPrefetching[rec.id];
  var G=window.GDrivePhoto;
  if(!G||!G.fetchFile){libReady[rec.id]={status:"error",msg:"Drive 模組未載入"};libRenderReady();return Promise.resolve(null)}
  libReady[rec.id]={status:"loading"};
  libRenderReady();libUpdateShareBtn();
  var p=G.fetchFile(rec.id).then(function(b){return libPngFile(rec,b)}).then(function(f){
    if(!f)throw new Error("轉檔失敗");
    libBlobCache[rec.id]=f;libReady[rec.id]={status:"ready",file:f};libPushToStage(rec,f);return f;
  }).catch(function(e){libReady[rec.id]={status:"error",msg:(e&&e.message)||"讀取失敗"};return null}).then(function(f){
    delete libPrefetching[rec.id];libRenderReady();libUpdateShareBtn();return f;
  });
  libPrefetching[rec.id]=p;
  return p;
}
function libReadyCount(recs){var n=0;recs.forEach(function(r){var s=libReady[r.id];if(s&&s.status==="ready")n++});return n}
function libRenderReady(){
  /* 已就緒的圖片直接進暫存區，不再另外顯示區塊 */
  var box=$("libReady");if(box){box.style.display="none";box.innerHTML=""}
}
var libAdded={};
function libPushToStage(rec,f){
  if(!rec||!f||libAdded[rec.id])return false;
  libAdded[rec.id]=1;
  var it={id:"p"+ ++seq,file:f,thumb:"",blob:null,status:"idle",msg:"",angle:0,name:f.name||"",pngFile:f};
  stage.push(it);
  try{var u=URL.createObjectURL(f);it.thumb=u}catch(e){}
  renderStage();updateBtns();
  return true;
}
function libUpdateShareBtn(){
  var recs=libPickedRecs(),n=recs.length,ready=libReadyCount(recs);
  var b=$("btnLibLine");
  if(b){
    b.disabled=n===0;
    b.classList.toggle("busy",false);b.title=n?("到暫存區分享 "+n+" 張 PNG"):"分享 PNG 到 LINE";
  }
  var d=$("btnLibDl");d&&(d.disabled=!(n&&ready===n));
  var c=$("btnLibCopy");c&&(c.disabled=n===0);
  
}
function libDiagRender(){
  var body=$("libDiagBody");if(!body)return;
  var recs=libPickedRecs(),ready=libReadyCount(recs);
  var hasShare=typeof navigator.share==="function";
  var hasCan=typeof navigator.canShare==="function";
  var canFiles=!1;
  try{canFiles=!!(hasCan&&recs.length&&libCanShareFiles(recs.map(function(r){var s=libReady[r.id];return s&&s.file}).filter(Boolean)))}catch(e){}
  var lines=[];
  lines.push("navigator.share："+(hasShare?"有 ✅":"沒有 ❌"));
  lines.push("navigator.canShare："+(hasCan?"有 ✅":"沒有 ❌"));
  lines.push("canShare({files})："+(canFiles?"支援 ✅":"不支援 ❌"));
  lines.push("已選 / 已就緒："+recs.length+" / "+ready+" 張");
  if(libLastShare){
    lines.push("上次帶入：共 "+libLastShare.n+" 個檔案");
    lines.push("　型別："+libLastShare.types.join("、"));
    lines.push("　檔名："+libLastShare.names.join("、"));
  }else lines.push("上次帶入：（尚未分享）");
  lines.push("最後錯誤："+(libLastErr||"（無）"));
  lines.push("UA："+String(navigator.userAgent||"").slice(0,120));
  body.innerHTML=lines.map(function(t){return '<div class="dgline">'+esc(t)+'</div>'}).join("");
}
function libDownloadPngs(files,why){if(!files||!files.length)return;var i=0;function step(){if(i>=files.length){toast("已下載 "+files.length+" 張 PNG，請從相簿／檔案選取後貼進 LINE",!1);libSetMode("已下載 "+files.length+" 張 PNG");return}var f=files[i];C.download(f.name||("photo_"+(i+1)+".png"),f,"image/png"),i++,setTimeout(step,420)}step()}
C.on($("btnLibLine"),"click",function(){
  var recs=libPickedRecs();
  if(!recs.length){toast("請先勾選照片",!0);return}
  var files=[],missing=0;
  recs.forEach(function(r){var s=libReady[r.id];if(s&&s.status==="ready"&&s.file)files.push(s.file);else missing++});
  if(missing||!files.length){
    libSetMode("尚有 "+missing+" 張載入中");
    toast("照片還在載入，請稍候",!0);
    return;
  }
  // 已就緒的圖片已在 libPrepare 時自動放進暫存區，這裡只負責帶到暫存區
  var added=0;
  recs.forEach(function(r){if(libAdded[r.id])added++});
  libSetMode("已放入暫存區 "+added+" 張");
  toast("已放進暫存區 "+added+" 張，請到暫存區按 LINE 分享");
  var pc=$("pCount");if(pc&&pc.scrollIntoView)try{pc.scrollIntoView({behavior:"smooth",block:"center"})}catch(e){}
  return;
  /* 以下為舊的直接分享流程，保留不用 */
  var _unused=0;
  var bad=files.filter(function(f){return !(f&&f.type==="image/png"&&/\.png$/i.test(f.name||""))});
  if(bad.length){libLastErr="有 "+bad.length+" 張不是 PNG";libSetMode("格式不符，已停止");toast("檔案格式不是 PNG，已停止分享",!0);return}
  libLastShare={n:files.length,types:files.map(function(f){return f.type}),names:files.map(function(f){return f.name})};
  libLastErr="";
  if(!libCanShareFiles(files)){
    libSetMode("已改為下載 "+files.length+" 張 PNG");
    toast("此瀏覽器不支援直接分享圖片檔，已改為下載 PNG（"+files.length+" 張）",!0);
    
    libDownloadPngs(files,"此瀏覽器不支援直接分享檔案");
    return;
  }
  libSetMode("分享 "+files.length+" 張 PNG");
  
  var pr;
  try{pr=sharePhotosThenText(files)}
  catch(e){libLastErr=(e&&e.name||"Error")+"："+(e&&e.message||"");libSetMode("已改為下載 "+files.length+" 張 PNG");libDownloadPngs(files,"分享面板無法使用");return}
  if(pr&&pr.then)pr.then(function(){toast("照片已送出（"+files.length+" 張）")}).catch(function(e){
    if(e&&e.name==="AbortError"){libSetMode("");return}
    libLastErr=(e&&e.name||"Error")+"："+(e&&e.message||"");
    libSetMode("已改為下載 "+files.length+" 張 PNG");
    
    libDownloadPngs(files,"分享面板無法使用");
  });
}),C.on($("btnStageLine"),"click",function(){
  if(uploading||!stage.length)return;
  var files=[],missing=0;
  stage.forEach(function(it){if(it.pngFile&&it.pngFile.type==="image/png")files.push(it.pngFile);else missing++});
  if(missing||!files.length){toast("還有 "+missing+" 張正在準備 PNG，請稍候",!0);return}
  if(!libCanShareFiles(files)){
    toast("此瀏覽器不支援直接分享圖片檔，已改為下載 PNG（"+files.length+" 張）",!0);
    libDownloadPngs(files,"此瀏覽器不支援直接分享檔案");
    return;
  }
  var pr;
  try{pr=sharePhotosThenText(files)}
  catch(e){toast("分享失敗，已改為下載 PNG",!0);libDownloadPngs(files,"分享面板無法使用");return}
  if(pr&&pr.then)pr.then(function(){toast("照片已送出（"+files.length+" 張）")}).catch(function(e){
    if(e&&e.name==="AbortError")return;
    toast("分享面板無法使用，已改為下載 PNG",!0);
    libDownloadPngs(files,"分享面板無法使用");
  });
}),C.on($("btnLibDl"),"click",function(){var recs=libPickedRecs();if(!recs.length)return;var files=[];recs.forEach(function(r){var s=libReady[r.id];if(s&&s.status==="ready"&&s.file)files.push(s.file)});if(!files.length){toast("照片尚未載入完成",!0);return}libDownloadPngs(files,"手動下載")}),C.on($("btnLibDiagRefresh"),"click",function(){libDiagRender()});
window.__buildLibRefresh=function(){libDate&&fDate&&fDate.value&&(libDate.value=fDate.value),libLoad()};var todo=[];function readTodo(){var a=C.store.getJSON(K_TODO,[]);todo=Array.isArray(a)?a:[]}function writeTodo(){C.store.setJSON(K_TODO,todo)}var tTitle=$("tTitle"),tType=$("tType"),tDue=$("tDue"),tRepeat=$("tRepeat"),tDueWrap=$("tDueWrap"),tRepeatWrap=$("tRepeatWrap"),todoList=$("todoList"),todoEmpty=$("todoEmpty"),todoSum=$("todoSum");function syncTypeUI(){var v=tType?tType.value:"due";tDueWrap&&(tDueWrap.style.display=v==="due"?"":"none"),tRepeatWrap&&(tRepeatWrap.style.display=v==="repeat"?"":"none")}C.on(tType,"change",syncTypeUI),syncTypeUI(),tDue&&!tDue.value&&(tDue.value=todayISO());function repeatLabel(v){return{daily:"每天",weekly:"每週",monthly:"每月",workday:"每工作日"}[v]||"每週"}function nextOccur(iso,rep){if(!iso)return"";if(rep==="daily")return isoAddDays(iso,1);if(rep==="weekly")return isoAddDays(iso,7);if(rep==="monthly"){var p=String(iso).split("-");if(p.length!==3)return iso;var y=Number(p[0]),m=Number(p[1]),d=Number(p[2]);return m+=1,m>12&&(m=1,y+=1),y+"-"+pad2(m)+"-"+pad2(d)}if(rep==="workday"){for(var n=isoAddDays(iso,1),p2=String(n).split("-"),wd=new Date(Number(p2[0]),Number(p2[1])-1,Number(p2[2])).getDay();wd===0||wd===6;)n=isoAddDays(n,1),p2=String(n).split("-"),wd=new Date(Number(p2[0]),Number(p2[1])-1,Number(p2[2])).getDay();return n}return iso}function renderTodo(){if(!todoList)return;var today=todayISO(),due=[],rep=[];todo.forEach(function(t){(t.type==="repeat"?rep:due).push(t)}),due.sort(function(a,b){return!!a.done!=!!b.done?a.done?1:-1:String(a.due||"9999").localeCompare(String(b.due||"9999"))}),rep.sort(function(a,b){return String(a.title).localeCompare(String(b.title))});var html="";function row(t){var meta="";if(t.type==="repeat")meta="🔁 "+repeatLabel(t.repeat)+(t.lastDone?"　上次完成 "+fmtMD(t.lastDone):"　尚未完成過");else if(t.due){var dd=daysBetween(today,t.due),cls="",txt="";dd===null?txt=t.due:dd<0?(cls="od",txt="已逾期 "+Math.abs(dd)+" 天（"+fmtMD(t.due)+"）"):dd===0?(cls="od",txt="今天到期"):dd<=3?(cls="soon",txt=dd+" 天後到期（"+fmtMD(t.due)+"）"):txt=fmtMD(t.due)+"（"+dd+" 天後）",meta="📅 "+(cls?'<span class="'+cls+'">'+esc(txt)+"</span>":esc(txt))}else meta="📅 未設定期限";return'<li class="ti'+(t.done?" done":"")+'" data-id="'+t.id+'"><label class="tick"><input type="checkbox" data-act="done" data-id="'+t.id+'"'+(t.done?" checked":"")+'></label><div class="tmain"><div class="ttitle">'+esc(t.title)+'</div><div class="tmeta">'+meta+'</div></div><button type="button" class="mini del" data-act="del" data-id="'+t.id+'" title="刪除">×</button></li>'}due.length&&(html+='<li style="list-style:none;font-size:11.5px;font-weight:800;letter-spacing:.08em;color:#6b7a8d;padding:2px 2px 0">期限</li>',due.forEach(function(t){html+=row(t)})),rep.length&&(html+='<li style="list-style:none;font-size:11.5px;font-weight:800;letter-spacing:.08em;color:#6b7a8d;padding:10px 2px 0">重複性任務</li>',rep.forEach(function(t){html+=row(t)})),todoList.innerHTML=html,todoEmpty&&(todoEmpty.style.display=todo.length?"none":"block");var odBox=$("odBox"),odList=$("odList"),odCount=$("odCount");if(odBox&&odList){var overdue=todo.filter(function(t){if(t.done||t.type==="repeat"||!t.due)return!1;var d=daysBetween(today,t.due);return d!==null&&d<0}).sort(function(a,b){return String(a.due).localeCompare(String(b.due))});if(!overdue.length)odBox.style.display="none",odList.innerHTML="";else{odBox.style.display="block",odCount&&(odCount.textContent=overdue.length+" 筆");var oh="";overdue.forEach(function(t){var d=daysBetween(today,t.due);oh+='<li data-id="'+t.id+'"><span class="odt">'+esc(t.title)+'</span><span class="odd">逾期 '+Math.abs(d)+" 天（"+esc(fmtMD(t.due))+'）</span><button type="button" class="mini" data-act="oddone" data-id="'+t.id+'">完成</button></li>'}),odList.innerHTML=oh}}if(todoSum){var open=todo.filter(function(t){return!t.done}).length,over=todo.filter(function(t){if(t.done||t.type==="repeat"||!t.due)return!1;var d=daysBetween(today,t.due);return d!==null&&d<0}).length;todoSum.textContent=todo.length?"共 "+todo.length+" 筆，未完成 "+open+" 筆"+(over?"，其中逾期 "+over+" 筆":""):""}}C.on($("btnAddTodo"),"click",function(){var title=(tTitle&&tTitle.value||"").trim();if(!title){toast("請先填寫代辦內容",!0),tTitle&&tTitle.focus();return}var type=tType&&tType.value||"due",rec={id:"t"+Date.now()+Math.floor(Math.random()*1e3),title:title,type:type,done:!1,lastDone:""};type==="due"?rec.due=tDue&&tDue.value||"":rec.repeat=tRepeat&&tRepeat.value||"weekly",todo.push(rec),writeTodo(),tTitle&&(tTitle.value=""),renderTodo(),toast("已新增代辦")}),C.on(todoList,"click",function(e){var el=e.target,act=el.getAttribute&&el.getAttribute("data-act");if(act){for(var id=el.getAttribute("data-id"),idx=-1,i=0;i<todo.length;i++)if(todo[i].id===id){idx=i;break}if(!(idx<0)){if(act==="del")todo.splice(idx,1),writeTodo(),renderTodo();else if(act==="done"){var t=todo[idx];t.type==="repeat"?el.checked&&(t.lastDone=todayISO(),t.done=!1,toast("已完成一次，下次："+fmtMD(nextOccur(t.lastDone,t.repeat)))):t.done=!!el.checked,writeTodo(),renderTodo()}}}}),C.on($("odList"),"click",function(e){var el=e.target;if(!(!el.getAttribute||el.getAttribute("data-act")!=="oddone")){for(var id=el.getAttribute("data-id"),i=0;i<todo.length;i++)if(todo[i].id===id){todo[i].done=!0;break}writeTodo(),renderTodo(),toast("已標記完成")}}),readTodo(),renderTodo();var events=[];function readEvents(){var a=C.store.getJSON(K_EVENT,[]);events=Array.isArray(a)?a:[]}function writeEvents(){C.store.setJSON(K_EVENT,events)}var eDate=$("eDate"),eTitle=$("eTitle"),eNote=$("eNote"),evList=$("evList"),evEmpty=$("evEmpty"),evSum=$("evSum");eDate&&!eDate.value&&(eDate.value=todayISO());function renderEvents(){if(evList){var today=todayISO(),arr=events.slice().sort(function(a,b){return String(a.date||"").localeCompare(String(b.date||""))}),html="";if(arr.forEach(function(ev){var dd=daysBetween(today,ev.date),cls="";dd!==null&&dd<0?cls="past":dd===0&&(cls="today");var tag="";dd===0?tag='　<b style="color:#c47f17">今天</b>':dd!==null&&dd>0?tag="　"+dd+" 天後":dd!==null&&dd<0&&(tag="　"+Math.abs(dd)+" 天前"),html+='<div class="ev '+cls+'" data-id="'+ev.id+'"><div class="evdate"><b>'+esc(fmtMD(ev.date))+"</b><span>週"+esc(weekday(ev.date))+'</span></div><div class="evmain"><div class="evtitle">'+esc(ev.title)+tag+"</div>"+(ev.note?'<div class="evnote">'+esc(ev.note)+"</div>":"")+'</div><button type="button" class="mini del" data-act="del" data-id="'+ev.id+'" title="刪除">×</button></div>'}),evList.innerHTML=html,evEmpty&&(evEmpty.style.display=events.length?"none":"block"),evSum){var up=events.filter(function(e){var d=daysBetween(today,e.date);return d!==null&&d>=0}).length;evSum.textContent=events.length?"共 "+events.length+" 筆，未到期 "+up+" 筆":""}}}C.on($("btnAddEvent"),"click",function(){var d=eDate&&eDate.value||"",title=(eTitle&&eTitle.value||"").trim();if(!d){toast("請選擇日期",!0);return}if(!title){toast("請填寫事項內容",!0),eTitle&&eTitle.focus();return}events.push({id:"e"+Date.now()+Math.floor(Math.random()*1e3),date:d,title:title,note:(eNote&&eNote.value||"").trim()}),writeEvents(),eTitle&&(eTitle.value=""),eNote&&(eNote.value=""),renderEvents(),toast("已新增日期事項")}),C.on(evList,"click",function(e){var el=e.target;if(!(!el.getAttribute||el.getAttribute("data-act")!=="del")){for(var id=el.getAttribute("data-id"),i=0;i<events.length;i++)if(events[i].id===id){events.splice(i,1);break}writeEvents(),renderEvents()}}),readEvents(),renderEvents(),window.addEventListener("focus",function(){renderTodo(),renderEvents()})})();