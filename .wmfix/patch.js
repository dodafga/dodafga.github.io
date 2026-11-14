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
