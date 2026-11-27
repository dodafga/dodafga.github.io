(function(global){"use strict";var CORE=global.Core||null,CID_KEY="inspection-gdrive-clientid",FID_KEY="inspection-gdrive-fileid",SYNC_KEY="inspection-gdrive-lastsync",TOKEN_KEY="inspection-gdrive-token",OFF_KEY="inspection-gdrive-signedout",FOLDER_NAME="ç‡Ÿå»ºæŸ¥é©—è³‡æ–™",FILE_NAME="inspection-data.json",SCOPE="https://www.googleapis.com/auth/drive.file",GIS_SRC="https://accounts.google.com/gsi/client",API_BASE="https://www.googleapis.com",UPLOAD_BASE="https://www.googleapis.com/upload/drive/v3/files",FIXED_CLIENT_ID="401815954786-jn3vqu7riudvpcmvirl17rhsa4tp0mgp.apps.googleusercontent.com",TOKEN_SKEW=6e4,RETRY_TIMES=CORE&&CORE.LIMITS.RETRY_TIMES||2,RETRY_DELAY=CORE&&CORE.LIMITS.RETRY_DELAY||600,st={state:"idle",message:"",lastSync:"",email:""},listeners=[],tokenClient=null,tokenClientCid="",accessToken=null,tokenExpAt=0,gisLoading=null,pending=null,store=CORE&&CORE.store?CORE.store:{get:function(k,d){try{var v=localStorage.getItem(k);return v==null?d||"":v}catch(e){return d||""}},set:function(k,v){try{return localStorage.setItem(k,v),!0}catch(e){return!1}},remove:function(k){try{return localStorage.removeItem(k),!0}catch(e){return!1}}};function emit(){for(var i=0;i<listeners.length;i++)try{listeners[i](st)}catch(e){}}function setState(s,msg){st.state===s&&(msg===void 0||msg===st.message)||(st.state=s,msg!==void 0&&(st.message=msg),emit())}function getStatus(){return st}function onStatus(fn){if(typeof fn=="function"){listeners.indexOf(fn)<0&&listeners.push(fn);try{fn(st)}catch(e){}}}function getClientId(){return store.get(CID_KEY,"")!==FIXED_CLIENT_ID&&store.set(CID_KEY,FIXED_CLIENT_ID),FIXED_CLIENT_ID}function setClientId(){store.set(CID_KEY,FIXED_CLIENT_ID),tokenClient=null,tokenClientCid="",clearStoredToken(),setState("idle","å·²è¨­å®š Client IDï¼Œå°šæœªé€£ç·š")}function isConfigured(){return!!FIXED_CLIENT_ID}function isSignedOut(){return store.get(OFF_KEY,"")==="1"}function setSignedOut(v){v?store.set(OFF_KEY,"1"):store.remove(OFF_KEY)}function saveToken(resp){var ttl=(resp&&resp.expires_in?Number(resp.expires_in):3600)*1e3;tokenExpAt=Date.now()+(isFinite(ttl)&&ttl>0?ttl:36e5),store.set(TOKEN_KEY,JSON.stringify({access_token:resp.access_token,expires_at:tokenExpAt,email:st.email||""}))}function clearStoredToken(){tokenExpAt=0,accessToken=null,store.remove(TOKEN_KEY)}function tokenFresh(){return!(!accessToken||tokenExpAt&&Date.now()>=tokenExpAt-TOKEN_SKEW)}function restoreToken(){if(tokenFresh())return!0;var raw=store.get(TOKEN_KEY,"");if(!raw)return!1;var o=null;try{o=JSON.parse(raw)}catch(e){return clearStoredToken(),!1}return!o||!o.access_token||!o.expires_at||Date.now()>=Number(o.expires_at)-TOKEN_SKEW?(clearStoredToken(),!1):(accessToken=o.access_token,tokenExpAt=Number(o.expires_at),o.email&&!st.email&&(st.email=o.email),!0)}function hasToken(){return tokenFresh()}function tokenExpiresAt(){return tokenExpAt}function getEmail(){return st.email||""}function setEmail(v){if(st.email=v||"",!!st.email){var raw=store.get(TOKEN_KEY,"");if(raw)try{var o=JSON.parse(raw);o.email=st.email,store.set(TOKEN_KEY,JSON.stringify(o))}catch(e){}}}function getLastSync(){return store.get(SYNC_KEY,"")}function resetFileId(){store.remove(FID_KEY)}function loadGIS(){return gisLoading||(gisLoading=new Promise(function(res,rej){if(global.google&&global.google.accounts&&global.google.accounts.oauth2)return res();var existing=document.querySelector('script[src="'+GIS_SRC+'"]');if(existing){existing.addEventListener("load",function(){global.google&&global.google.accounts&&global.google.accounts.oauth2?res():(gisLoading=null,rej(new Error("Google ç™»å…¥æœå‹™è¼‰å…¥ä¸å®Œæ•´")))}),existing.addEventListener("error",function(){gisLoading=null,rej(new Error("ç„¡æ³•è¼‰å…¥ Google ç™»å…¥æœå‹™ï¼ˆå¯èƒ½è¢«ç¶²è·¯æˆ–å»£å‘Šå°é–å™¨é˜»æ“‹ï¼‰"))});return}var s=document.createElement("script");s.src=GIS_SRC,s.async=!0,s.defer=!0,s.onload=function(){global.google&&global.google.accounts&&global.google.accounts.oauth2?res():(gisLoading=null,rej(new Error("Google ç™»å…¥æœå‹™è¼‰å…¥ä¸å®Œæ•´")))},s.onerror=function(){gisLoading=null,rej(new Error("ç„¡æ³•è¼‰å…¥ Google ç™»å…¥æœå‹™ï¼ˆå¯èƒ½è¢«ç¶²è·¯æˆ–å»£å‘Šå°é–å™¨é˜»æ“‹ï¼‰"))},document.head.appendChild(s)}),gisLoading)}function ensureTokenClient(cid){return tokenClient&&tokenClientCid===cid||(tokenClient=global.google.accounts.oauth2.initTokenClient({client_id:cid,scope:SCOPE,ux_mode:"popup",callback:function(resp){settleToken(resp)},error_callback:function(err){failToken(err)}}),tokenClientCid=cid),tokenClient}function settleToken(resp){var p=pending;if(pending=null,!!p)if(resp&&resp.access_token)accessToken=resp.access_token,saveToken(resp),setSignedOut(!1),p.resolve(accessToken);else{var e=new Error("æˆæ¬Šå¤±æ•—ï¼š"+(resp&&resp.error||"æœªçŸ¥éŒ¯èª¤"));e.code=p.silent?"SILENT_FAILED":"CONNECT_FAILED",p.reject(e)}}function failToken(err){var p=pending;if(pending=null,!!p){var t=err&&(err.type||err.message)||"è¦–çª—å·²é—œé–‰",e=new Error(p.silent?"éœ€è¦äº’å‹•æˆæ¬Šï¼ˆ"+t+"ï¼‰":"æˆæ¬Šæœªå®Œæˆï¼š"+t);e.code=p.silent?"SILENT_FAILED":"CONNECT_FAILED",e.reason=t,p.reject(e)}}function requestToken(opts){opts=opts||{};var silent=!!opts.silent,cid=getClientId();return cid?loadGIS().then(function(){return new Promise(function(res,rej){if(pending){var prev=pending;pending=null;var ec=new Error("å·²ç”±æ–°çš„æˆæ¬Šè«‹æ±‚å–ä»£");ec.code=prev.silent?"SILENT_FAILED":"CONNECT_FAILED";try{prev.reject(ec)}catch(e){}}pending={resolve:res,reject:rej,silent};try{ensureTokenClient(cid),tokenClient.requestAccessToken(silent?{prompt:""}:{prompt:accessToken?"":"consent"})}catch(e){pending=null;var e2=new Error("ç„¡æ³•é–‹å•Ÿæˆæ¬Šè¦–çª—ï¼š"+(e&&e.message?e.message:e));e2.code=silent?"SILENT_FAILED":"CONNECT_FAILED",rejLŠ__J_JNŠÙ]İ]J[˜]]Üš^™Y‹º*âùab9k£9¢$ÛÛÙÛHš]™H:*+yk¦ˆŠK›ÛZ\ÙKœ™Z™Xİ
™]È\œ›ÜŠ““×ĞÓQS•ÒQŠJJ_Y[˜İ[Ûˆ™Yœ™\Ú[XZ[

^Ü™]\›ˆ\ÕÚÙ[Š
OÙÙ]\Ù\Š
K[Š[˜İ[ÛŠJ^Ü™]\›ˆI‰K™[XZ[Y™\ÜÉ‰ŠÙ][XZ[
K™[XZ[Y™\ÜÊK[Z]

JKİ™[XZ[ˆŸJK˜Ø]Ú
[˜İ[ÛŠ
^Ü™]\›ˆİ™[XZ[ˆŸJN”›ÛZ\ÙKœ™\ÛÛ™JˆŠ_Y[˜İ[ÛˆÛÛ›™Xİ

^Ü™]\›ˆÙ]İ]J˜ÛÛ›™Xİ[™È‹¹«hùg*:`(ùíæˆÛÛÙÛx )ˆŠK™\]Y\İÚÙ[ŠÜÚ[[ˆL_JK[Š[˜İ[ÛŠÚÊ^Ü™]\›ˆÙ]İ]J˜ÛÛ›™XİY‹¹mìº`(ùíæˆÛÛÙÛHš]™HŠK™Yœ™\Ú[XZ[

KÚßJK˜Ø]Ú
[˜İ[ÛŠJ^İ›İÈI‰™K›Y\ÜØYÙOOOH““×ĞÓQS•ÒQŸÙ]İ]J™\œ›Üˆ‹I‰™K›Y\ÜØYÙOÙK›Y\ÜØYÙNˆº`(ùíæ¹i,y¥eÈŠK_J_Y[˜İ[ÛˆÚ[[ÛÛ›™Xİ

^ÚYŠÚÙ[‘œ™\Ú

J\™]\›ˆ›ÛZ\ÙKœ™\ÛÛ™JXØÙ\ÜÕÚÙ[ŠNÚYŠ\ÔÚYÛ™Yİ]

J^İ˜\ˆ[Ï[™]È\œ›ÜŠ¹mì¹ænùaî»ï#:*âù£"xà#:`(ùíæˆÛÛÙÛHš]™xà#zaãy¥¬9£¢9«"ˆŠNÜ™]\›ˆ[Ë˜ÛÙOH”ÒQÓ‘QÓÕU‹›ÛZ\ÙKœ™Z™Xİ
[Ê_ZYŠ\İÜ™K™Ù]
ÒÑS—ÒÑVKˆŠJ^İ˜\ˆ[[™]È\œ›ÜŠ¹l&¹§*¹£¢9«"ˆÛÛÙÛHš]™HŠNÙ[‹˜ÛÙOH““×Ô’SÔ—ĞUUÜÙ]İ]JšYH‹¹l&¹§*¹£¢9«"ˆÛÛÙÛHš]™HŠNÜ™]\›ˆ›ÛZ\ÙKœ™Z™Xİ
[Š_\™]\›ˆÙ]İ]JœÚ[[‹¹«hùg*:!ê¹båz`(ùíæ¸ )ˆŠK™\]Y\İÚÙ[ŠÜÚ[[ˆLJK[Š[˜İ[ÛŠÚÊ^Ü™]\›ˆÙ]İ]J˜ÛÛ›™XİY‹¹mìº!ê¹båz`(ùíæˆÛÛÙÛHš]™HŠK™Yœ™\Ú[XZ[

KÚßJK˜Ø]Ú
[˜İ[ÛŠJ^İ›İÈK˜ÛÙ_
K˜ÛÙOH”ÒSS•ÑRSQŠKÙ]İ]JK˜ÛÙOOOH”ÒQÓ‘QÓÕUÈšYHˆ™^\™Y‹K›Y\ÜØYÙJK_J_Y[˜İ[Ûˆ[œİ\™UÚÙ[Š
^Ü™]\›ˆÚÙ[‘œ™\Ú

OÔ›ÛZ\ÙKœ™\ÛÛ™JXØÙ\ÜÕÚÙ[ŠNœ™\İÜ™UÚÙ[Š
I‰ÚÙ[‘œ™\Ú

OÊÙ]İ]J˜ÛÛ›™XİY‹¹mì¹¬¯ùå*9ab9bcyæ¡9£¢9«"ˆŠK™Yœ™\Ú[XZ[

K›ÛZ\ÙKœ™\ÛÛ™JXØÙ\ÜÕÚÙ[ŠJNœÚ[[ÛÛ›™Xİ

_Y[˜İ[Ûˆ\ØÛÛ›™Xİ

^İ˜\ˆÚÏXXØÙ\ÜÕÚÙ[ÚYŠÛX\”İÜ™YÚÙ[Š
KÚÙ[ÛY[[[ÚÙ[ÛY[ÚYHˆ‹Ù]ÚYÛ™Yİ]
L
Kİ™[XZ[Hˆ‹Ù]İ]JšYH‹¹mì¹.+y¥­ú`(ùíæ»ï":,áù¥¦y.ãyg*9à#ú)¯yfj9§+9ªgûï"HŠKÚÉ‰™ÛØ˜[™ÛÛÙÛI‰™ÛØ˜[™ÛÛÙÛK˜XØÛİ[É‰™ÛØ˜[™ÛÛÙÛK˜XØÛİ[Ë›Ø]]‰‰™ÛØ˜[™ÛÛÙÛK˜XØÛİ[Ë›Ø]]‹œ™]›ÚÙJ]^ÙÛØ˜[™ÛÛÙÛK˜XØÛİ[Ë›Ø]]‹œ™]›ÚÙJÚË[˜İ[ÛŠ
^ßJ_XØ]Ú
J^ß_Y[˜İ[ÛˆÛY\
\Ê^Ü™]\›ˆ™]È›ÛZ\ÙJ[˜İ[ÛŠŠ^ÜÙ][Y[İ]
‹\Ê_J_Y[˜İ[Ûˆ\Õ˜[œÚY[
İ]\Ê^Ü™]\›ˆİ]\ÏOOMİ]\ÏOOM_İ]\ÏOOMLİ]\ÏOOMLŸİ]\ÏOOMLßİ]\ÏOOMLY[˜İ[Ûˆ™XY\œ›ÜŠŠ^Ü™]\›ˆ‹^

K[Š[˜İ[ÛŠ
^İ˜\ˆ\ÙÏH‘š]™HTHŠÜ‹œİ]\Îİ^İ˜\ˆR”ÓÓ‹œ\œÙJ
NÚ‰‰š‹™\œ›Ü‰‰š‹™\œ›Ü‹›Y\ÜØYÙI‰Š\ÙÊÏH»ï&ˆŠÚ‹™\œ›Ü‹›Y\ÜØYÙJ_XØ]Ú
J^İ	‰Š\ÙÊÏH»ï&ˆŠÔİš[™Ê
KœÛXÙJMŒ
J_]˜\ˆ\œ[™]È\œ›ÜŠ\ÙÊNÜ™]\›ˆ\œ‹œİ]\Ï\‹œİ]\Ë\œŸJ_Y[˜İ[ÛˆÜ™\]Y\İ
\›ÜÊ^ÛÜÏ[ÜßßNİ˜\ˆ][\ÏLX^™]O[ÜËœ™]OOOHLOÌ”‘U–WÕSQTÎÙ[˜İ[Ûˆ][\
ÚÊ^Ø][\ÊÊÎİ˜\ˆXY\œÏ^ßKÎÙ›ÜŠÈ[ˆÜËšXY\œßßJSØš™Xİœ›İİ\Kš\ÓİÛ”›Ü\K˜Ø[
ÜËšXY\œËÊI‰ŠXY\œÖÚ×O[ÜËšXY\œÖÚ×JNÜ™]\›ˆÚÉ‰ŠXY\œË]]Üš^˜][ÛH™X\™\ˆŠİÚÊK™]Ú
\›ÛY]Ù›ÜË›Y]Ù‘ÑU‹XY\œË›ÙN›ÜË˜›Ù_JK[Š[˜İ[ÛŠŠ^ÚYŠ‹œİ]\ÏOOMJ^ÚYŠ[ÜË—×Ü™[™]ÙY
^ÛÜË—×Ü™[™]ÙYHLØÛX\”İÜ™YÚÙ[Š
NÜ™]\›ˆÚ[[ÛÛ›™Xİ

K[Š[˜İ[ÛŠ
^Ü™]\›ˆ][\
XØÙ\ÜÕÚÙ[Š_JK˜Ø]Ú
[˜İ[ÛŠ
^İ˜\ˆMO[™]È\œ›ÜŠ¹£¢9«"¹mìº`c¹§'ûï#:*âúaãy¥¬:`(ùíæˆŠNİ›İÈMK˜ÛÙOH“‘QQÒS•TPÕU‘H‹MKœİ]\ÏMKM_J_[ÜËœÚ[[Ù]İ]J™^\™Y‹¹£¢9«"¹mìº`c¹§'ûï#:*âúaãy¥¬:`(ùíæˆŠNİ˜\ˆMO[™]È\œ›ÜŠ¹£¢9«"¹mìº`c¹§'ûï#:*âúaãy¥¬:`(ùíæˆŠNİ›İÈMK˜ÛÙOH“‘QQÒS•TPÕU‘H‹MKœİ]\ÏMKM_ZYŠ\‹›ÚÊ\™]\›ˆ™XY\œ›ÜŠŠK[Š[˜İ[ÛŠ\œŠ^ÚYŠ\Õ˜[œÚY[
‹œİ]\ÊI‰˜][\Ï[X^™]J\™]\›ˆÛY\
‘U–WÑSVJ˜][\ÊK[Š[˜İ[ÛŠ
^Ü™]\›ˆ][\
ÚÊ_JNİ›İÈ\œŸJNÚYŠÜËœ˜]Ê\™]\›ˆÚYŠ‹œİ]\ÏOOLŒ
\™]\›ˆ[İ˜\ˆİ\‹šXY\œË™Ù]
˜ÛÛ[]\HŠ_ˆÜ™]\›ˆİš[™^ÙŠ˜\XØ][Û‹ÚœÛÛˆŠOÜ‹^

K[Š[˜İ[ÛŠ
^İ^Ü™]\›ˆ”ÓÓ‹œ\œÙJ
_XØ]Ú
J^Ü™]\›ˆ_JNœ‹šœÛÛŠ
_K[˜İ[ÛŠ™]\œŠ^ÚYŠ][\Ï[X^™]J\™]\›ˆÛY\
‘U–WÑSVJ˜][\ÊK[Š[˜İ[ÛŠ
^Ü™]\›ˆ][\
ÚÊ_JNİ˜\ˆO[™]È\œ›ÜŠ¹í¬º-ëúc+ú*©;ï&ˆŠÊ™]\œ‰‰›™]\œ‹›Y\ÜØYÙ_¹á(y¬åz`(ùíæˆŠJNİ›İÈK˜ÛÙOH“‘UÓÔ’È‹_J_\™]\›ˆ[œİ\™UÚÙ[Š
K[Š][\
_Y[˜İ[Ûˆ\J]ÜÊ^Ü™]\›ˆÜ™\]Y\İ
TWĞTÑJÜ]ÜÊ_Y[˜İ[Ûˆ™]Ú›ØŠš[RY
^Ü™]\›ˆš[RYØ\J‹Ùš]™KİŒËÙš[\ËÈŠÙ[˜ÛÙUT’PÛÛ\Û™[
š[RY
JÈØ[[YYXH‹Ü˜]ÎˆLJK[Š[˜İ[ÛŠŠ^Ü™]\›ˆ‹˜›ØŠ
_JN”›ÛZ\ÙKœ™Z™Xİ
™]È\œ›ÜŠ¹ï.¹l$Hš]™H9ª¥9¨bQŠJ_Y[˜İ[Ûˆ\ØY][\\
›Ü›KšY[Ê^İ˜\ˆ\›UTĞQĞTÑJÈİ\ØY\O[][\\ŠÊšY[ÏÈ‰™šY[ÏHŠÙ[˜ÛÙUT’PÛÛ\Û™[
šY[ÊNˆˆŠNÜ™]\›ˆÜ™\]Y\İ
\›ÛY]Ùˆ”ÔÕ‹›ÙN™›Ü›_J_Y[˜İ[Ûˆ\]Qš[PÛÛ[
š[RY›Ø‹Z[YJ^ÚYŠYš[RY
\™]\›ˆ›ÛZ\ÙKœ™Z™Xİ
™]È\œ›ÜŠ¹ï.¹l$Hš]™H9ª¥9¨bQŠJNÚYŠX›ØŠ\™]\›ˆ›ÛZ\ÙKœ™Z™Xİ
™]È\œ›ÜŠ¹¬¤¹§"ycëùkêùaiyæ¡9ª¥9¨b9aiùk®HŠJNİ˜\ˆ\›UTĞQĞTÑJÈ‹ÈŠÙ[˜ÛÙUT’PÛÛ\Û™[
š[RY
JÈİ\ØY\O[YYXI™šY[ÏHŠÙ[˜ÛÙUT’PÛÛ\Û™[
šY˜[YKÚ^™KÙX•šY]Ó[šÈŠNÜ™]\›ˆÜ™\]Y\İ
\›ÛY]Ùˆ”UÒ‹XY\œÎÈÛÛ[U\H›Z[Y_š[XYÙKÜ™ÈŸK›ÙN˜›ØŸJ_Y[˜İ[Ûˆ[]Qš[Jš[RY\›X[™[
^ÚYŠYš[RY
\™]\›ˆ›ÛZ\ÙKœ™Z™Xİ
™]È\œ›ÜŠ¹ï.¹l$Hš]™H9ª¥9¨bQŠJNİ˜\ˆ]H‹Ùš]™KİŒËÙš[\ËÈŠÙ[˜ÛÙUT’PÛÛ\Û™[
š[RY
NÜ™]\›ˆ\›X[™[Ø\J]ÛY]Ùˆ‘SUHŸJN˜\J]ÛY]Ùˆ”UÒ‹XY\œÎÈÛÛ[U\Hˆ˜\XØ][Û‹ÚœÛÛˆŸK›ÙN’”ÓÓ‹œİš[™ÚYJİ˜\ÚYˆLJ_J_Y[˜İ[ÛˆÙ]\Ù\Š
^Ü™]\›ˆ\J‹Ùš]™KİŒËØX›İ]ÙšY[Ï]\Ù\Š\Ü^S˜[YK[XZ[Y™\ÜË\›Z\ÜÚ[Û’Y
H‹ÜÚ[[ˆLJK[Š[˜İ[ÛŠŠ^Ü™]\›ˆ‰‰š‹\Ù\Ÿ[JK˜Ø]Ú
[˜İ[ÛŠ
^Ü™]\›ˆ[J_Y[˜İ[Ûˆ\ØÔJÊ^Ü™]\›ˆİš[™ÊÊKœ™\XÙJ×ÙË—ŠKœ™\XÙJÉËÙË—	ÈŠ_Y[˜İ[Ûˆ[œİ\™Q›Û\Š
^İ˜\ˆOH›˜[YOIÈŠÙ\ØÔJ“ÓT—ÓSQJJÈ‰È[™Z[YU\OIØ\XØ][Û‹İ›™™ÛÛÙÛKX\Ë™›Û\‰È[™˜\ÚYY˜[ÙHÜ™]\›ˆ\J‹Ùš]™KİŒËÙš[\ÏÜOHŠÙ[˜ÛÙUT’PÛÛ\Û™[
JJÈ‰™šY[ÏYš[\ÊY˜[YJIœÜXÙ\ÏYš]™HŠK[Š[˜İ[ÛŠŠ^Ü™]\›ˆ‰‰š‹™š[\É‰š‹™š[\Ë›[™İÚ‹™š[\ÖÌKšY˜\J‹Ùš]™KİŒËÙš[\È‹ÛY]Ùˆ”ÔÕ‹XY\œÎÈÛÛ[U\Hˆ˜\XØ][Û‹ÚœÛÛˆŸK›ÙN’”ÓÓ‹œİš[™ÚYJÛ˜[YN‘“ÓT—ÓSQKZ[YU\Nˆ˜\XØ][Û‹İ›™™ÛÛÙÛKX\Ë™›Û\ˆŸJ_JK[Š[˜İ[ÛŠŠ^Ü™]\›ˆ‹šYJ_J_Y[˜İ[Ûˆ[œİ\™Qš[J›Û\’Y
^İ˜\ˆØXÚY\İÜ™K™Ù]
’QÒÑVKˆŠNÚYŠØXÚY
\™]\›ˆ›ÛZ\ÙKœ™\ÛÛ™JØXÚY
Nİ˜\ˆOH›˜[YOIÈŠÑ’SWÓSQJÈ‰È[™	ÈŠÙ›Û\’Y
È‰È[ˆ\™[È[™˜\ÚYY˜[ÙHÜ™]\›ˆ\J‹Ùš]™KİŒËÙš[\ÏÜOHŠÙ[˜ÛÙUT’PÛÛ\Û™[
JJÈ‰™šY[ÏYš[\ÊY˜[YJHŠK[Š[˜İ[ÛŠŠ^Ü™]\›ˆ‰‰š‹™š[\É‰š‹™š[\Ë›[™İÊİÜ™KœÙ]
’QÒÑVK‹™š[\ÖÌKšY
K‹™š[\ÖÌKšY
N˜\J‹Ùš]™KİŒËÙš[\È‹ÛY]Ùˆ”ÔÕ‹XY\œÎÈÛÛ[U\Hˆ˜\XØ][Û‹ÚœÛÛˆŸK›ÙN’”ÓÓ‹œİš[™ÚYJÛ˜[YN‘’SWÓSQK\™[Î–Ù›Û\’YKZ[YU\Nˆ˜\XØ][Û‹ÚœÛÛˆŸJ_JK[Š[˜İ[ÛŠŠ^Ü™]\›ˆİÜ™KœÙ]
’QÒÑVK‹šY
K‹šYJ_J_Y[˜İ[Ûˆİ[\

^Üİ›\İŞ[˜Ï[™]È]J
KÒTÓÔİš[™Ê
KİÜ™KœÙ]
ÖS×ÒÑVKİ›\İŞ[˜Ê_Y[˜İ[ÛˆÚ][\˜Xİ]™Q˜[˜XÚÊ˜XİÜK[İÒ[\˜Xİ]™J^Ü™]\›ˆ[œİ\™UÚÙ[Š
K˜Ø]Ú
[˜İ[ÛŠJ^ÚYŠ[İÒ[\˜Xİ]™I‰™I‰ŠK˜ÛÙOOOH”ÒQÓ‘QÓÕUŸK˜ÛÙOOOH“‘QQÒS•TPÕU‘HŸK˜ÛÙOOOH”ÒSS•ÑRSQŸK˜ÛÙOOOHÓÓ“‘PÕÑRSQŸK˜ÛÙOOOH““×Ô’SÔ—ĞUUŠJ\™]\›ˆÛÛ›™Xİ

Nİ›İÈ_JK[Š˜XİÜJ_Y[˜İ[ÛˆØ]™J]J^Ü™]\›ˆÙ]İ]JœŞ[˜Ú[™È‹¹d#9«iy.+x )ˆŠKÚ][\˜Xİ]™Q˜[˜XÚÊ[˜İ[ÛŠ
^Ü™]\›ˆ[œİ\™Q›Û\Š
K[Š[œİ\™Qš[JK[Š[˜İ[ÛŠš[RY
^Ü™]\›ˆÜ™\]Y\İ
TĞQĞTÑJÈ‹ÈŠÙ[˜ÛÙUT’PÛÛ\Û™[
š[RY
JÈİ\ØY\O[YYXH‹ÛY]Ùˆ”UÒ‹XY\œÎÈÛÛ[U\Hˆ˜\XØ][Û‹ÚœÛÛÈÚ\œÙ]UU‹NŸK›ÙN’”ÓÓ‹œİš[™ÚYJ]J_J_J_KL
K[Š[˜İ[ÛŠ
^Ü™]\›ˆİ[\

KÙ]İ]J˜ÛÛ›™XİY‹¹mì¹kf9b,ÛÛÙÛHš]™HŠKLJK˜Ø]Ú
[˜İ[ÛŠJ^İ›İÈÙ]İ]J™\œ›Üˆ‹I‰™K›Y\ÜØYÙOÙK›Y\ÜØYÙNˆ¹d#9«iyi,y¥eÈŠK_J_Y[˜İ[ÛˆØY

^Ü™]\›ˆÙ]İ]JœŞ[˜Ú[™È‹º+ 9cå¹.+x )ˆŠKÚ][\˜Xİ]™Q˜[˜XÚÊ[˜İ[ÛŠ
^Ü™]\›ˆ[œİ\™Q›Û\Š
K[Š[œİ\™Qš[JK[Š[˜İ[ÛŠš[RY
^Ü™]\›ˆ\J‹Ùš]™KİŒËÙš[\ËÈŠÙ[˜ÛÙUT’PÛÛ\Û™[
š[RY
JÈØ[[YYXHŠ_J_KL
K[Š[˜İ[ÛŠŠ^Ü™]\›ˆİ[\

KÙ]İ]J˜ÛÛ›™XİY‹¹mì¹o§ˆÛÛÙÛHš]™H:/"yaiHŠKŸJK˜Ø]Ú
[˜İ[ÛŠJ^İ›İÈÙ]İ]J™\œ›Üˆ‹I‰™K›Y\ÜØYÙOÙK›Y\ÜØYÙNˆº+ 9cå¹i,y¥eÈŠK_J_]˜\ˆP‘SÏ^ÚYNİˆ¹§*¹£¢9«"ˆ‹ÎˆˆÍ˜ØN‹™ÎˆˆÙŒ™YH‹™ˆˆÙMXÈŸKÚ[[İˆº!ê¹båz`(ùíæ¸ )ˆ‹ÎˆˆÌ˜ÍLˆ‹™ÎˆˆÙYY˜ˆ‹™ˆˆÙÙL™ŒˆŸK^\™Yİˆºg :aãy¥¬:`(ùíæˆ‹ÎˆˆØÍÙŒMÈ‹™ÎˆˆÙ™™MÈ‹™ˆˆÙŒ˜ŸK[˜]]Üš^™Yİˆ¹§*¹£¢9«"ˆ‹ÎˆˆØÍÙŒMÈ‹™ÎˆˆÙ™™MÈ‹™ˆˆÙŒ˜ŸKÛÛ›™Xİ[™Îİˆº`(ùíæ¹.+x )ˆ‹ÎˆˆÌ˜ÍLˆ‹™ÎˆˆÙYY˜ˆ‹™ˆˆÙÙL™ŒˆŸKŞ[˜Ú[™Îİˆ¹d#9«iy.+x )ˆ‹ÎˆˆÌ˜ÍLˆ‹™ÎˆˆÙYY˜ˆ‹™ˆˆÙÙL™ŒˆŸKÛÛ›™XİYİˆ¹mìº`(ùíæˆ‹ÎˆˆÌYØM‹™ÎˆˆÙNYYYH‹™ˆˆØÙ™M™HŸK\œ›Üİˆ¹d#9«iyi,y¥eÈ‹ÎˆˆØŒÌŒYH‹™ÎˆˆÙ™ŒÙŒˆ‹™ˆˆÙŒÙ˜ØÈŸ_NÙ[˜İ[Ûˆ›][YJ\ÛÊ^ÚYŠZ\ÛÊ\™]\›ˆ¸ %İ˜\ˆ[™]È]J\ÛÊNÚYŠ\Ó˜SŠ™Ù][YJ
JJ\™]\›ˆ¸ %İ˜\ˆPÓÔ‘I‰ÓÔ‘KœYĞÓÔ‘KœY™[˜İ[ÛŠŠ^Ü™]\›ˆLÈŒŠÛˆˆŠÛŸNÜ™]\›ˆ™Ù][YX\Š
JÈ‹ÈŠÜ
™Ù][Û

JÌJJÈ‹ÈŠÜ
™Ù]]J
JJÈˆŠÜ
™Ù]İ\œÊ
JJÈˆŠÜ
™Ù]Z[]\Ê
J_Y[˜İ[Ûˆ[İ[İ]\Ê[ÜÊ^ÚYŠY[
\[Ùˆ[OHœİš[™È‰‰Š[YØİ[Y[™Ù][[Y[RY
[
JKY[
_[™Ù]]šX]J™]KYÙ[[İ[YŠOOOHŒHŠ\™]\›Ù[œÙ]]šX]J™]KYÙ[[İ[Y‹ŒHŠKÜÏ[ÜßßK[š[›™\’SIÏ]ˆÛ\ÜÏH™ÙX˜\ˆÜ[ˆÛ\ÜÏH™ÙYİÜÜ[Ü[ˆÛ\ÜÏH™Ù]ÜÜ[Ü[ˆÛ\ÜÏH™Ù][YHÜÜ[Ü[ˆÛ\ÜÏH™Ù\ÜÜÜ[]Ûˆ\OH˜]ÛˆˆÛ\ÜÏH™ÙXˆÙ\Ø]™H¸¦ H9kf9b,ÛÛÙÛHš]™OØ]Û]Ûˆ\OH˜]ÛˆˆÛ\ÜÏH™ÙXˆÙ[ØY¸«!È9o§ˆÛÛÙÛHš]™H:/"yaiOØ]ÛHÛ\ÜÏH™Ù[[šÈˆ™YH‰ÊÊÜËœÙ][™ÜÒ™YŸ‹‹‹ÜÙ][™ÜËÚ[™^š[ŠJÉÈ¸¦¦H:*+yk¦ØOÙ]]ˆÛ\ÜÏH™Ù[\ÙÈÙ]‰Îİ˜\ˆİY[œ]Y\TÙ[XİÜŠ‹™ÙYİŠKY[œ]Y\TÙ[XİÜŠ‹™Ù]ŠK[YOY[œ]Y\TÙ[XİÜŠ‹™Ù][YHŠK\ÙÏY[œ]Y\TÙ[XİÜŠ‹™Ù[\ÙÈŠK”Ø]™OY[œ]Y\TÙ[XİÜŠ‹™Ù\Ø]™HŠK“ØYY[œ]Y\TÙ[XİÜŠ‹™Ù[ØYŠNÙ[˜İ[Ûˆ™[™\ŠÊ^İ˜\ˆSP‘SÖÜËœİ]W_P‘SËšYNÙİœİ[K˜˜XÚÙÜ›İ[™S˜Ë^ÛÛ[Sœİ[K˜ÛÛÜS˜Ë[YK^ÛÛ[H¹§ 9o£9d#9«i{ï&ˆŠÙ›][YJË›\İŞ[˜ßÙ]\İŞ[˜Ê
JKËœİ]OOOH™\œ›Üˆ‰‰œË›Y\ÜØYÙOÊ\ÙË^ÛÛ[H¸¦¨ŠÜË›Y\ÜØYÙK\ÙËœİ[K™\Ü^OH˜›ØÚÈŠNš\ĞÛÛ™šYİ\™Y

OÛ\ÙËœİ[K™\Ü^OH››Û™HŠ\ÙË^ÛÛ[H¹l&¹§*º*+yk¦ˆÛÛÙÛHĞ]]ÛY[Q;ï#:*âùab9b,8à#8¦¦H:*+yk¦¸à#yk£9¢$:*+yk¦»ï"9í!H9b!ºd&;ï#:fa9g%¹¥¡ù«izjgûï"xà ˆ‹\ÙËœİ[K™\Ü^OH˜›ØÚÈŠNİ˜\ˆ\ŞO\Ëœİ]OOOHœŞ[˜Ú[™ÈŸËœİ]OOOH˜ÛÛ›™Xİ[™ÈØ”Ø]™K™\ØX›YX\ŞK“ØY™\ØX›YX\Ş_[Û”İ]\Ê™[™\ŠNÙ[˜İ[ÛˆİX\™
›Š^ÚYŠZ\ĞÛÛ™šYİ\™Y

J^ÛÜË›Û“™YYÙ]\ÛÜË›Û“™YYÙ]\

N™ÛØ˜[˜ÛÛ™š\›J9l&¹§*º*+yk¦ˆÛÛÙÛHĞ]]ÛY[Q8à ‚º) yãï¹g*9bcyo :*+yk¦ºh yeã»ï'Ø
I‰ŠØØ][Û‹š™Y[ÜËœÙ][™ÜÒ™YŸ‹‹‹ÜÙ][™ÜËÚ[™^š[ŠNÜ™]\›ŸY›Š
_X”Ø]™K˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[ÛŠ
^ÙİX\™
[˜İ[ÛŠ
^ÛÜË›Û”Ø]™I‰›ÜË›Û”Ø]™J
_J_JK“ØY˜Y]™[\İ[™\Š˜ÛXÚÈ‹[˜İ[ÛŠ
^ÙİX\™
[˜İ[ÛŠ
^ÛÜË›Û“ØY	‰›ÜË›Û“ØY

_J_J_Y[˜İ[Ûˆ[š™Xİİ[J
^ÚYŠYØİ[Y[™Ù][[Y[RY
™Ù\İ[HŠJ^İ˜\ˆÜÜÏH‹™ÙX˜\Ù\Ü^N™›^Ø[YÛ‹Z][\Î˜Ù[\ÙØ\\Ù›^]Ü˜\Ü˜\ÜY[™ÎŒLLœØ›Ü™\Œ\ÛÛYÙMXÎØ›Ü™\‹\˜Y]\Î\Ø˜XÚÙÜ›İ[™ˆÙ˜Y˜ÎÙ›Û\Ú^™NŒL‹\ßK™ÙYİİÚY\ÚZYÚ\Ø›Ü™\‹\˜Y]\ÎL	NØ˜XÚÙÜ›İ[™ˆÍ˜ØNÙ›^Œ\ßK™Ù]Ù›Û]ÙZYÚÌßK™Ù][Y^ØÛÛÜˆÍ˜ØNÙ›Û\Ú^™NŒLK\ßK™Ù\ÜÛX\™Ú[‹[Y˜]]ÎßK™ÙXÙ›ÛY˜[Z[Nš[š\š]Ù›Û\Ú^™NŒL‹\Ù›Û]ÙZYÚŒÜY[™ÎÜLœØ›Ü™\‹\˜Y]\ÎÜØ›Ü™\Œ\ÛÛYÙYMÎØ˜XÚÙÜ›İ[™ˆÙ™™ØÛÛÜˆÌÙMXÎØİ\œÛÜœÚ[\İ˜[œÚ][Û‹ŒM\ÎßK™ÙXšİ™\››İ
™\ØX›Y
^Ø˜XÚÙÜ›İ[™ˆÙŒY˜Ø›Ü™\‹XÛÛÜˆØÌØÙYßK™ÙX™\ØX›YÛÜXÚ]N‹NØİ\œÛÜ››İX[İÙYßK™Ù[[šŞÙ›Û\Ú^™NŒLœØÛÛÜˆÌ˜ÍLİ^YXÛÜ˜][Û››Û™NÙ›Û]ÙZYÚŒÜY[™ÎœØ›Ü™\‹\˜Y]\ÎœßK™Ù[[šÎšİ™\Ø˜XÚÙÜ›İ[™ˆÙYY˜ßK™Ù[\ÙŞÙ\Ü^N››Û™NÛX\™Ú[‹]ÜÜÙ›Û\Ú^™NŒLœØÛÛÜˆØŒÌŒYNÛ[™KZZYÚŒKØ˜XÚÙÜ›İ[™ˆÙ™ŒÙŒØ›Ü™\Œ\ÛÛYÙŒÙ˜ØÎØ›Ü™\‹\˜Y]\ÎÜÜY[™ÎL\ßH‹ÏYØİ[Y[˜Ü™X]Q[[Y[
œİ[HŠNÜËšYH™Ù\İ[H‹Ë^ÛÛ[XÜÜËØİ[Y[šXY˜\[™Ú[
Ê__]\[ÙˆØİ[Y[OH[™Yš[™Y‰‰ŠØİ[Y[œ™XYTİ]OOOH›ØY[™ÈÙØİ[Y[˜Y]™[\İ[™\Š‘ÓPÛÛ[ØYY‹[š™Xİİ[JNš[š™Xİİ[J
JKÛØ˜[‘Ñš]™O^Ñ“ÓT—ÓSQK’SWÓSQKĞÓÔK’VQĞÓQS•ÒQÙ]ÛY[YÙ]ÛY[Y\ĞÛÛ™šYİ\™Y\ÕÚÙ[‹Ù]İ]\ËÙ]\İŞ[˜ËÛ”İ]\ËÛÛ›™XİÚ[[ÛÛ›™Xİ[œİ\™UÚÙ[‹™\İÜ™UÚÙ[‹\ÔÚYÛ™Yİ]Ù][XZ[Ù][XZ[ÚÙ[‘^\™\Ğ]ÛX\”İÜ™YÚÙ[‹\ØÛÛ›™XİÙ]\Ù\‹Ø]™KØY™\Ù]š[RY[İ[İ]\Ë›][YK\K™]Ú›Ø‹\ØY][\\\]Qš[PÛÛ[[]Qš[K\ØÔKØYÒTË™[™]ÔÚ[[N™[˜İ[ÛŠ
^Ü™]\›ˆÚ[[ÛÛ›™Xİ

K[Š[˜İ[ÛŠ
^Ü™]\›ˆK[˜İ[ÛŠJ^Ü™]\›ˆ[J___JJ\[ÙˆÚ[™İÈOH[™Yš[™YİÚ[™İÎ\ÊNÂ‚‹ÊˆKKKH:!ê¹båz/"yaiHš]™H9æoyd#ye«¹k¢:e ;ï":fá¹.+y. :&e{ï#9acy¥.yd!:h HS;ï"HKKKH
‹ÂŠ[˜İ[Ûˆ
ÛØ˜[
HÂˆ	İ\ÙHİšXİ	ÎÂˆYˆ
ÛØ˜[—×Ùš]™QİX\™ØY\ŠH™]\›ÂˆÛØ˜[—×Ùš]™QİX\™ØY\ˆHYNÂˆ[˜İ[Ûˆ[š™Xİ

HÂˆYˆ
ÛØ˜[‘š]™QİX\™
HÈHÈÛØ˜[‘š]™QİX\™Ü˜\

NÈHØ]Ú
JHßH™]\›ÈBˆ˜\ˆÈHÛØ˜[™Øİ[Y[˜Ü™X]Q[[Y[
	ÜØÜš\	ÊNÂˆËœÜ˜ÈH	Ë‹‹Ø\ÜÙ]ËÙš]™KYİX\™šœÏİLŒŒLLØIÎÂˆË˜\Ş[˜ÈH˜[ÙNÂˆË›Û›ØYH[˜İ[Ûˆ

HÈHÈYˆ
ÛØ˜[‘š]™QİX\™
HÛØ˜[‘š]™QİX\™Ü˜\

NÈHØ]Ú
JHßHNÂˆË›Û™\œ›ÜˆH[˜İ[Ûˆ

HÈHÈÛÛœÛÛKØ\›Š	ÖÑš]™QİX\™H:/"yaiyi,y¥eûï#š]™H9kf9cå¹§*¹cåùæoyd#ye«¹/çz+mÉÊNÈHØ]Ú
JHßHNÂˆÛØ˜[™Øİ[Y[šXY˜\[™Ú[
ÊNÂˆBˆYˆ
ÛØ˜[™Øİ[Y[
HÂˆYˆ
ÛØ˜[™Øİ[Y[œ™XYTİ]HOOH	ÛØY[™ÉÊHÛØ˜[™Øİ[Y[˜Y]™[\İ[™\Š	ÑÓPÛÛ[ØYY	Ë[š™Xİ
NÂˆ[ÙH[š™Xİ

NÂˆBŸJJ\[ÙˆÚ[™İÈOOH	İ[™Yš[™Y	ÈÈÚ[™İÈˆ\ÊNÂ