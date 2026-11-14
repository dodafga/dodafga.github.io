#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r26 patch: 讓 /drive/ 的自動轉正支援 ±45° 內的細部傾斜。

在 repo 根目錄執行（GitHub Actions runner 的 checkout 目錄）。
只改 3 個既有檔案 + 新增 1 個檔案，其餘一律不動。
每一步都驗證「舊字串剛好出現一次」，任何一步不符就整支中止（不寫半套）。
"""
import io
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)  # .deploy-r26/ 的上一層


def read(rel):
    with io.open(os.path.join(REPO, rel), encoding='utf-8') as f:
        return f.read()


def write(rel, text):
    p = os.path.join(REPO, rel)
    d = os.path.dirname(p)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with io.open(p, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def sub(text, old, new, label):
    n = text.count(old)
    if n != 1:
        print('FAIL [%s]: old string found %d times (need exactly 1)' % (label, n))
        sys.exit(1)
    print('ok   [%s]' % label)
    return text.replace(old, new, 1)


# ---------------------------------------------------------------- 1. drive-v2.js
p = 'assets/drive-v2.js'
s = read(p)

s = sub(s,
        'function compactDate(iso){return String(iso||"").replace(/-/g,"")}',
        'function compactDate(iso){return String(iso||"").replace(/-/g,"")}\n'
        '/* \u89d2\u5ea6\u986f\u793a\uff1a\u7d30\u90e8\u50be\u659c\u6703\u662f\u5c0f\u6578\uff08\u4f8b\u5982 3.7\u00b0\uff09\uff0c\u56db\u65b9\u5411\u6642\u4ecd\u662f\u6574\u6578 90\u00b0\u3002\n'
        '   \u53d6\u5230\u5c0f\u6578\u7b2c\u4e00\u4f4d\uff0c\u4e26\u53bb\u6389\u591a\u9918\u7684 .0\u3002 */\n'
        'function fmtDeg(a){\n'
        '  var v=Number(a)||0;\n'
        '  v=Math.round(v*10)/10;\n'
        '  return (v%1===0)?String(v):v.toFixed(1);\n'
        '}',
        'drive-v2.js fmtDeg')

s = sub(s,
        'function drawRot(bmp,angle,maxEdge){\n'
        '  var s=bSize(bmp),W=s.w,H=s.h;\n'
        '  if(!W||!H)throw new Error("\u5716\u7247\u5c3a\u5bf8\u7121\u6548");\n'
        '  var sw=(angle===90||angle===270);\n'
        '  var ow=sw?H:W, oh=sw?W:H;\n'
        '  var sc=Math.min(1,(maxEdge||MAX_EDGE)/Math.max(ow,oh));',
        '/* \u4efb\u610f\u89d2\u5ea6\u65cb\u8f49\uff08\u542b \u00b145\u00b0 \u5167\u7684\u7d30\u90e8\u50be\u659c\uff09\u3002\n'
        '   \u5916\u6846\u5c3a\u5bf8\u7528\u65cb\u8f49\u5f8c\u7684\u300c\u5916\u63a5\u77e9\u5f62\u300d\u8a08\u7b97\uff0c90/270 \u6642 cos=0 \u6703\u81ea\u52d5\u9000\u5316\u6210\u539f\u672c\u7684\u9577\u5bec\u4e92\u63db\uff0c\n'
        '   \u6240\u4ee5\u56db\u65b9\u5411\u65cb\u8f49\u7684\u7d50\u679c\u8207\u820a\u7248\u9010\u4f4d\u5143\u76f8\u540c\u3002 */\n'
        'function drawRot(bmp,angle,maxEdge){\n'
        '  var s=bSize(bmp),W=s.w,H=s.h;\n'
        '  if(!W||!H)throw new Error("\u5716\u7247\u5c3a\u5bf8\u7121\u6548");\n'
        '  var rad=(Number(angle)||0)*Math.PI/180;\n'
        '  var ca=Math.abs(Math.cos(rad)),sa=Math.abs(Math.sin(rad));\n'
        '  var ow=Math.round(W*ca+H*sa), oh=Math.round(W*sa+H*ca);\n'
        '  if(!ow||!oh){ow=W;oh=H}\n'
        '  var sc=Math.min(1,(maxEdge||MAX_EDGE)/Math.max(ow,oh));',
        'drive-v2.js drawRot')

s = sub(s,
        "  else if(it.ocr&&it.ocr.ok)bd=it.autoAngle?'<span class=\"badge ok\">\u5df2\u81ea\u52d5\u8f49 '+it.autoAngle+\"\u00b0</span>\":'<span class=\"badge ok\">\u65b9\u5411\u6b63\u78ba</span>';",
        "  else if(it.ocr&&it.ocr.ok)bd=it.autoAngle?'<span class=\"badge ok\">\u5df2\u81ea\u52d5\u8f49 '+fmtDeg(it.autoAngle)+\"\u00b0</span>\":'<span class=\"badge ok\">\u65b9\u5411\u6b63\u78ba</span>';",
        'drive-v2.js badge auto')

s = sub(s,
        "  if(it.manualAngle)bd+='<span class=\"badge mut\">\u5df2\u8f49 '+it.manualAngle+\"\u00b0</span>\";",
        "  if(it.manualAngle)bd+='<span class=\"badge mut\">\u5df2\u8f49 '+fmtDeg(it.manualAngle)+\"\u00b0</span>\";",
        'drive-v2.js badge manual')

s = sub(s,
        '            it.ocr&&it.ocr.ok?("\u81ea\u52d5\u8f49\u6b63\uff1a"+(it.autoAngle||0)+"\u00b0"):"\u81ea\u52d5\u8f49\u6b63\uff1a\u672a\u5224\u5b9a",',
        '            it.ocr&&it.ocr.ok?("\u81ea\u52d5\u8f49\u6b63\uff1a"+fmtDeg(it.autoAngle||0)+"\u00b0"):"\u81ea\u52d5\u8f49\u6b63\uff1a\u672a\u5224\u5b9a",',
        'drive-v2.js desc')

s = sub(s,
        '      toast("\u81ea\u52d5\u5224\u65b7\uff1a\u8f49 "+(it.autoAngle||0)+"\u00b0");',
        '      toast("\u81ea\u52d5\u5224\u65b7\uff1a\u8f49 "+fmtDeg(it.autoAngle||0)+"\u00b0");',
        'drive-v2.js toast')

write(p, s)

# ---------------------------------------------------------------- 2. orient-ocr.js
p = 'assets/orient-ocr.js'
s = read(p)

s = sub(s,
        '    var inner = detectInner(imgEl, t0);\n'
        '    return Promise.race([inner, hard]);\n'
        '  }',
        '    var inner = detectInner(imgEl, t0);\n'
        '    return Promise.race([inner, hard]).then(function (res) {\n'
        '      return refineSkew(imgEl, res, t0);\n'
        '    });\n'
        '  }\n'
        '\n'
        '  /**\n'
        '   * \u7d30\u90e8\u50be\u659c\u4fee\u6b63\uff1a\u56db\u65b9\u5411\uff080/90/180/270\uff09\u5224\u51fa\u4f86\u4e4b\u5f8c\uff0c\u518d\u91cf\u300c\u6587\u5b57\u884c\u9084\u6b6a\u5e7e\u5ea6\u300d\u3002\n'
        '   *\n'
        '   *   1. \u5148\u628a\u7167\u7247\u4f9d\u7c97\u89d2\u5ea6\u8f49\u6b63\uff08renderRot\uff09\uff0c\u5f97\u5230\u4e00\u5f35\u300c\u5927\u81f4\u64fa\u6b63\u300d\u7684\u756b\u9762\u3002\n'
        '   *   2. \u7528 OrientSkew \u91cf\u9019\u5f35\u756b\u9762\u7684\u6587\u5b57\u884c\u50be\u659c\uff08\u00b145\u00b0 \u5167\uff09\u3002\n'
        '   *   3. \u6700\u7d42\u89d2\u5ea6 = \u7c97\u89d2\u5ea6 + \u7d30\u90e8\u89d2\u5ea6\uff08\u53ef\u70ba\u5c0f\u6578\uff09\u3002\n'
        '   *\n'
        '   * \u53ea\u6709 ok===true \u624d\u505a\uff0b\u5224\u4e0d\u51fa\u65b9\u5411\u6642\u5b8c\u5168\u4e0d\u52d5\uff0c\u7dad\u6301\u300c\u9019\u6a23\u5c0d\u55ce\uff1f\u300d\u7684\u539f\u672c\u884c\u70ba\u3002\n'
        '   * \u4efb\u4f55\u4f8b\u5916\u90fd\u541e\u6389\uff0c\u9000\u56de\u7c97\u89d2\u5ea6\uff0c\u7d55\u4e0d\u8b93\u81ea\u52d5\u8f49\u6b63\u5931\u6557\u3002\n'
        '   */\n'
        '  function refineSkew(imgEl, res, t0) {\n'
        '    if (!res || !res.ok) return res;\n'
        '    var SK = global.OrientSkew;\n'
        '    if (!SK || typeof SK.estimate !== \'function\') return res;\n'
        '    try {\n'
        '      var coarse = Number(res.angle) || 0;\n'
        '      var pr = renderRot(imgEl, coarse, { edge: 900 });\n'
        '      var est = SK.estimate(pr.canvas, 640);\n'
        '      if (!est || !est.ok || !est.delta) {\n'
        '        res.skew = est ? { ok: !!est.ok, delta: 0, reason: est.reason } : null;\n'
        '        return res;\n'
        '      }\n'
        '      var total = coarse + Number(est.delta);\n'
        '      total = ((total % 360) + 360) % 360;\n'
        '      /* \u53d6\u5230 0.1 \u5ea6\uff0c\u907f\u514d\u6d6e\u9ede\u5c3e\u6578 */\n'
        '      total = Math.round(total * 10) / 10;\n'
        '      res.angle = total;\n'
        '      res.coarseAngle = coarse;\n'
        '      res.skew = { ok: true, delta: est.delta, confidence: est.confidence, reason: est.reason };\n'
        '      res.reason = (res.reason || \'\') + \'+skew\' + est.delta;\n'
        '      res.ms = Math.round(((global.performance && performance.now) ? performance.now() : Date.now()) - t0);\n'
        '      return res;\n'
        '    } catch (e) {\n'
        '      res.skew = { ok: false, delta: 0, reason: \'skew-error\' };\n'
        '      return res;\n'
        '    }\n'
        '  }',
        'orient-ocr.js refineSkew')

write(p, s)

# ---------------------------------------------------------------- 3. drive/index.html
p = 'drive/index.html'
s = read(p)
s = sub(s,
        '<script src="../assets/orient-struct3.js"></script>\n'
        '<script src="../assets/orient-ocr.js"></script>',
        '<script src="../assets/orient-struct3.js"></script>\n'
        '<script src="../assets/orient-skew.js"></script>\n'
        '<script src="../assets/orient-ocr.js"></script>',
        'drive/index.html script tag')
write(p, s)

print('\nALL PATCHES APPLIED')
