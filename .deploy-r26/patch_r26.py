#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
r26 patch (idempotent): 讓 /drive/ 的自動轉正支援 ±45° 內的細部傾斜。

在 repo 根目錄執行（GitHub Actions runner 的 checkout 目錄）。
只改 3 個既有檔案；orient-skew.js 由 workflow 另外寫入。其餘一律不動。

每一步都是「已套用就跳過、未套用才替換」，所以重跑安全。
任何一步的舊字串不是剛好出現一次就整支中止（不寫半套）。
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


def ensure(text, marker, old, new, label):
    """marker 已存在 → 視為已套用，跳過；否則要求 old 剛好出現一次並替換。"""
    if marker in text:
        print('skip [%s] (already applied)' % label)
        return text
    n = text.count(old)
    if n != 1:
        print('FAIL [%s]: old string found %d times (need exactly 1)' % (label, n))
        sys.exit(1)
    print('ok   [%s]' % label)
    return text.replace(old, new, 1)


# ================================================================ 1. drive-v2.js
p = 'assets/drive-v2.js'
s = read(p)

FMTDEG = (
    'function compactDate(iso){return String(iso||"").replace(/-/g,"")}\n'
    '/* \u89d2\u5ea6\u986f\u793a\uff1a\u7d30\u90e8\u50be\u659c\u6703\u662f\u5c0f\u6578\uff08\u4f8b\u5982 3.7\u00b0\uff09\uff0c\u56db\u65b9\u5411\u6642\u4ecd\u662f\u6574\u6578 90\u00b0\u3002\n'
    '   \u53d6\u5230\u5c0f\u6578\u7b2c\u4e00\u4f4d\uff0c\u4e26\u53bb\u6389\u591a\u9918\u7684 .0\u3002 */\n'
    'function fmtDeg(a){\n'
    '  var v=Number(a)||0;\n'
    '  v=Math.round(v*10)/10;\n'
    '  return (v%1===0)?String(v):v.toFixed(1);\n'
    '}'
)
s = ensure(s, 'function fmtDeg(',
           'function compactDate(iso){return String(iso||"").replace(/-/g,"")}',
           FMTDEG, 'drive-v2.js fmtDeg')

DRAWROT_OLD = (
    'function drawRot(bmp,angle,maxEdge){\n'
    '  var s=bSize(bmp),W=s.w,H=s.h;\n'
    '  if(!W||!H)throw new Error("\u5716\u7247\u5c3a\u5bf8\u7121\u6548");\n'
    '  var sw=(angle===90||angle===270);\n'
    '  var ow=sw?H:W, oh=sw?W:H;\n'
    '  var sc=Math.min(1,(maxEdge||MAX_EDGE)/Math.max(ow,oh));'
)
DRAWROT_NEW = (
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
    '  var sc=Math.min(1,(maxEdge||MAX_EDGE)/Math.max(ow,oh));'
)
s = ensure(s, 'var ca=Math.abs(Math.cos(rad)),sa=Math.abs(Math.sin(rad));',
           DRAWROT_OLD, DRAWROT_NEW, 'drive-v2.js drawRot')

s = ensure(s, 'fmtDeg(it.autoAngle)',
           "  else if(it.ocr&&it.ocr.ok)bd=it.autoAngle?'<span class=\"badge ok\">\u5df2\u81ea\u52d5\u8f49 '+it.autoAngle+\"\u00b0</span>\":'<span class=\"badge ok\">\u65b9\u5411\u6b63\u78ba</span>';",
           "  else if(it.ocr&&it.ocr.ok)bd=it.autoAngle?'<span class=\"badge ok\">\u5df2\u81ea\u52d5\u8f49 '+fmtDeg(it.autoAngle)+\"\u00b0</span>\":'<span class=\"badge ok\">\u65b9\u5411\u6b63\u78ba</span>';",
           'drive-v2.js badge auto')

s = ensure(s, 'fmtDeg(it.manualAngle)',
           "  if(it.manualAngle)bd+='<span class=\"badge mut\">\u5df2\u8f49 '+it.manualAngle+\"\u00b0</span>\";",
           "  if(it.manualAngle)bd+='<span class=\"badge mut\">\u5df2\u8f49 '+fmtDeg(it.manualAngle)+\"\u00b0</span>\";",
           'drive-v2.js badge manual')

s = ensure(s, 'fmtDeg(it.autoAngle||0)',
           '            it.ocr&&it.ocr.ok?("\u81ea\u52d5\u8f49\u6b63\uff1a"+(it.autoAngle||0)+"\u00b0"):"\u81ea\u52d5\u8f49\u6b63\uff1a\u672a\u5224\u5b9a",',
           '            it.ocr&&it.ocr.ok?("\u81ea\u52d5\u8f49\u6b63\uff1a"+fmtDeg(it.autoAngle||0)+"\u00b0"):"\u81ea\u52d5\u8f49\u6b63\uff1a\u672a\u5224\u5b9a",',
           'drive-v2.js desc')

s = ensure(s, 'toast("\u81ea\u52d5\u5224\u65b7\uff1a\u8f49 "+fmtDeg',
           '      toast("\u81ea\u52d5\u5224\u65b7\uff1a\u8f49 "+(it.autoAngle||0)+"\u00b0");',
           '      toast("\u81ea\u52d5\u5224\u65b7\uff1a\u8f49 "+fmtDeg(it.autoAngle||0)+"\u00b0");',
           'drive-v2.js toast')

write(p, s)

# ================================================================ 2. orient-ocr.js
p = 'assets/orient-ocr.js'
s = read(p)

RACE_OLD = (
    '    var inner = detectInner(imgEl, t0);\n'
    '    return Promise.race([inner, hard]);\n'
    '  }'
)

REFINE_BLOCK = (
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
    '   * \u53ea\u6709 ok===true \u624d\u505a\uff1b\u5224\u4e0d\u51fa\u65b9\u5411\u6642\u5b8c\u5168\u4e0d\u52d5\uff0c\u7dad\u6301\u300c\u9019\u6a23\u5c0d\u55ce\uff1f\u300d\u7684\u539f\u672c\u884c\u70ba\u3002\n'
    '   * \u4efb\u4f55\u4f8b\u5916\u90fd\u545e\u6389\uff0c\u9000\u56de\u7c97\u89d2\u5ea6\uff0c\u7d55\u4e0d\u8b93\u81ea\u52d5\u8f49\u6b63\u5931\u6557\u3002\n'
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
    '  }'
)
s = ensure(s, 'function refineSkew(', RACE_OLD, REFINE_BLOCK, 'orient-ocr.js refineSkew')

RESCUE_OLD = (
    '    var inner = detectInner(imgEl, t0);\n'
    '    return Promise.race([inner, hard]).then(function (res) {\n'
    '      return refineSkew(imgEl, res, t0);\n'
    '    });\n'
    '  }'
)
RESCUE_BLOCK = (
    '    var inner = detectInner(imgEl, t0);\n'
    '    return Promise.race([inner, hard]).then(function (res) {\n'
    '      if (res && res.ok) return refineSkew(imgEl, res, t0);\n'
    '      /* \u56db\u65b9\u5411\u5224\u4e0d\u51fa\u4f86\u6642\uff0c\u5148\u91cf\u300c\u6587\u5b57\u6b6a\u5e7e\u5ea6\u300d\u518d\u91cd\u8a66\u4e00\u6b21\u3002\n'
    '         \u624b\u6a5f\u62cd\u6b6a 10\u00b0\uff5e45\u00b0 \u7684\u7167\u7247\uff0cOCR \u9023\u6a19\u7c64\u90fd\u8b80\u4e0d\u5230\uff0c\u56db\u65b9\u5411\u5fc5\u7136\u5931\u6557\uff1b\n'
    '         \u5148\u628a\u5b83\u8f49\u6b63\u518d OCR\uff0c\u624d\u6551\u5f97\u56de\u4f86\u3002 */\n'
    '      return rescueBySkew(imgEl, res, t0);\n'
    '    });\n'
    '  }\n'
    '\n'
    '  /**\n'
    '   * \u50be\u659c\u6551\u63f4\uff1a\u56db\u65b9\u5411\u5224\u4e0d\u51fa\u4f86\u6642\uff0c\u7528 OrientSkew \u91cf\u51fa\u50be\u659c\u89d2\uff0c\u5148\u628a\u7167\u7247\u8f49\u6b63\uff0c\n'
    '   * \u518d\u8dd1\u4e00\u6b21\u539f\u672c\u7684\u56db\u65b9\u5411\u5224\u65b7\u3002\n'
    '   *\n'
    '   *   - \u91cf\u4e0d\u5230\u53ef\u4fe1\u89d2\u5ea6\uff08\u7a7a\u767d\u7d19\u3001\u7d14\u98a8\u666f\u300190\u00b0 \u8f49\u5411\u7684\u8868\u55ae\uff09\u2192 \u539f\u5c01\u4e0d\u52d5\u56de\u50b3 ok:false\uff0c\n'
    '   *     \u7dad\u6301\u300c\u9019\u6a23\u5c0d\u55ce\uff1f\u300d\u7684\u539f\u672c\u884c\u70ba\uff0c\u7d55\u4e0d\u4e82\u8f49\u3002\n'
    '   *   - \u8f49\u6b63\u5f8c\u4ecd\u5224\u4e0d\u51fa\u65b9\u5411 \u2192 \u4e00\u6a23\u56de\u50b3\u539f\u672c\u7684 ok:false\u3002\n'
    '   *   - \u6210\u529f \u2192 \u6700\u7d42\u89d2\u5ea6 = \u50be\u659c\u89d2 + \u56db\u65b9\u5411\u89d2\u5ea6\u3002\n'
    '   */\n'
    '  function rescueBySkew(imgEl, res, t0) {\n'
    '    var SK = global.OrientSkew;\n'
    '    if (!SK || typeof SK.estimate !== \'function\') return res;\n'
    '    var now = function () {\n'
    '      return (global.performance && performance.now) ? performance.now() : Date.now();\n'
    '    };\n'
    '    /* \u5269\u9918\u6642\u9593\u4e0d\u5920\u5c31\u5225\u5192\u96aa\uff0c\u76f4\u63a5\u7dad\u6301\u539f\u672c\u7d50\u679c */\n'
    '    if (now() - t0 > DETAIL_BUDGET * 0.45) return res;\n'
    '    try {\n'
    '      var est = SK.estimate(imgEl, 640);\n'
    '      if (!est || !est.ok || !est.delta) {\n'
    '        if (res) res.skew = est ? { ok: !!est.ok, delta: 0, reason: est.reason } : null;\n'
    '        return res;\n'
    '      }\n'
    '      var delta = Number(est.delta);\n'
    '      var pr = renderRot(imgEl, delta, { edge: PROBE_EDGE });\n'
    '      return detectInner(pr.canvas, t0).then(function (r2) {\n'
    '        if (!r2 || !r2.ok) {\n'
    '          if (res) res.skew = { ok: true, delta: delta, confidence: est.confidence, reason: \'skew-rescue-failed\' };\n'
    '          return res;\n'
    '        }\n'
    '        var total = delta + (Number(r2.angle) || 0);\n'
    '        total = ((total % 360) + 360) % 360;\n'
    '        total = Math.round(total * 10) / 10;\n'
    '        r2.angle = total;\n'
    '        r2.coarseAngle = Math.round((total - delta) * 10) / 10;\n'
    '        r2.skew = { ok: true, delta: delta, confidence: est.confidence, reason: \'skew-rescue\' };\n'
    '        r2.reason = (r2.reason || \'\') + \'+rescue\' + delta;\n'
    '        r2.ms = Math.round(now() - t0);\n'
    '        return r2;\n'
    '      }, function () {\n'
    '        if (res) res.skew = { ok: true, delta: delta, confidence: est.confidence, reason: \'skew-rescue-error\' };\n'
    '        return res;\n'
    '      });\n'
    '    } catch (e) {\n'
    '      if (res) res.skew = { ok: false, delta: 0, reason: \'skew-rescue-error\' };\n'
    '      return res;\n'
    '    }\n'
    '  }'
)
s = ensure(s, 'function rescueBySkew(', RESCUE_OLD, RESCUE_BLOCK, 'orient-ocr.js rescueBySkew')

RENDERROT_OLD = (
    '    var swap = (angle === 90 || angle === 270);\n'
    '    var ow = swap ? sh : sw;\n'
    '    var oh = swap ? sw : sh;'
)
RENDERROT_NEW = (
    '    /* \u4efb\u610f\u89d2\u5ea6\uff1a\u5916\u6846\u7528\u65cb\u8f49\u5f8c\u7684\u5916\u63a5\u77e9\u5f62\u300290/270 \u6642 cos=0\uff0c\u6703\u81ea\u52d5\u9000\u5316\u6210\u539f\u672c\u7684\u9577\u5bec\u4e92\u63db\uff0c\n'
    '       \u6240\u4ee5\u56db\u65b9\u5411\u65cb\u8f49\u7684\u7d50\u679c\u8207\u820a\u7248\u5b8c\u5168\u76f8\u540c\u3002 */\n'
    '    var rad = (Number(angle) || 0) * Math.PI / 180;\n'
    '    var ca = Math.abs(Math.cos(rad)), sa = Math.abs(Math.sin(rad));\n'
    '    var ow = Math.round(sw * ca + sh * sa);\n'
    '    var oh = Math.round(sw * sa + sh * ca);\n'
    '    if (!ow || !oh) { ow = sw; oh = sh; }'
)
s = ensure(s, 'var ca = Math.abs(Math.cos(rad)), sa = Math.abs(Math.sin(rad));',
           RENDERROT_OLD, RENDERROT_NEW, 'orient-ocr.js renderRot')

write(p, s)

# ================================================================ 3. drive/index.html
p = 'drive/index.html'
s = read(p)
s = ensure(s, 'orient-skew.js',
           '<script src="../assets/orient-struct3.js"></script>\n'
           '<script src="../assets/orient-ocr.js"></script>',
           '<script src="../assets/orient-struct3.js"></script>\n'
           '<script src="../assets/orient-skew.js"></script>\n'
           '<script src="../assets/orient-ocr.js"></script>',
           'drive/index.html script tag')
write(p, s)

print('\nALL PATCHES APPLIED')
