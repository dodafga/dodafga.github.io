#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r73 patch: fix iOS "add to home screen" standalone mode failing to open.
Edits drive/index.html and sw-ocr.js in place. Every replacement must match
exactly once, otherwise it fails loudly."""
import io, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."

def read(p):
    with io.open(p, "r", encoding="utf-8") as f:
        return f.read()

def write(p, s):
    with io.open(p, "w", encoding="utf-8", newline="") as f:
        f.write(s)

def sub_once(text, old, new, label):
    n = text.count(old)
    if n != 1:
        raise SystemExit("PATCH FAIL [%s]: expected 1 occurrence, found %d" % (label, n))
    return text.replace(old, new, 1)

# ---------- drive/index.html ----------
p = os.path.join(ROOT, "drive", "index.html")
h = read(p)

OLD_HEAD = '<meta name="theme-color" content="#7A848D">\n<title>'
NEW_HEAD = (
    '<meta name="theme-color" content="#7A848D">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
    '<meta name="apple-mobile-web-app-title" content="\u65bd\u5de5\u7167\u7247\u6b78\u6a94">\n'
    '<meta name="mobile-web-app-capable" content="yes">\n'
    '<link rel="apple-touch-icon" href="../assets/icon-180.png">\n'
    '<link rel="manifest" href="../manifest.json">\n'
    '<title>'
)
h = sub_once(h, OLD_HEAD, NEW_HEAD, "index head meta")

OLD_SW = (
    "<script>\n"
    "(function(){\n"
    "  if(!('serviceWorker' in navigator))return;\n"
    "  try{navigator.serviceWorker.register('../sw-ocr.js',{scope:'../'}).catch(function(){});}catch(e){}\n"
    "})();\n"
    "</script>"
)
NEW_SW = (
    "<script>\n"
    "/* \u96e2\u7dda\u5feb\u53d6\uff08OCR \u6a21\u578b\uff09\u8a3b\u518a\u3002\n"
    "   iOS\u300c\u52a0\u5230\u4e3b\u756b\u9762\u300d\u7684 standalone \u6a21\u5f0f\u5c0d service worker \u6514\u622a\u5c0e\u89bd\u6709\u5df2\u77e5\u554f\u984c\uff0c\n"
    "   \u6703\u9020\u6210\u767d\u5c4f\uff0f\u6253\u4e0d\u958b\uff0c\u56e0\u6b64 standalone \u6a21\u5f0f\u4e00\u5f8b\u4e0d\u8a3b\u518a\uff0c\u6539\u7528\u4e00\u822c\u7db2\u8def\u8f09\u5165\u3002 */\n"
    "(function(){\n"
    "  if(!('serviceWorker' in navigator))return;\n"
    "  try{\n"
    "    var standalone = (window.navigator.standalone===true) ||\n"
    "      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);\n"
    "    if(standalone){\n"
    "      /* app \u6a21\u5f0f\uff1a\u4e0d\u8a3b\u518a\uff0c\u4e26\u4e3b\u52d5\u89e3\u9664\u5148\u524d\u5df2\u8a3b\u518a\u7684 SW\uff08\u8b93\u5df2\u5361\u4f4f\u7684\u88dd\u7f6e\u81ea\u6211\u4fee\u5fa9\uff09 */\n"
    "      try{ navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ try{ r.unregister(); }catch(e){} }); }).catch(function(){}); }catch(e){}\n"
    "      return;\n"
    "    }\n"
    "    navigator.serviceWorker.register('../sw-ocr.js',{scope:'../'}).catch(function(){});\n"
    "  }catch(e){}\n"
    "})();\n"
    "</script>"
)
h = sub_once(h, OLD_SW, NEW_SW, "index sw registration")
write(p, h)
print("patched drive/index.html")

# ---------- sw-ocr.js ----------
p = os.path.join(ROOT, "sw-ocr.js")
s = read(p)

s = sub_once(s, "var CACHE = 'drive-offline-v3';", "var CACHE = 'drive-offline-v4';", "sw cache version")

OLD_ACT = (
    "    }).then(function (oldCount) {\n"
    "      return self.clients.claim().then(function () {\n"
    "        /* \u53ea\u6709\u300c\u9019\u6b21\u771f\u7684\u6e05\u6389\u4e86\u820a\u7248\u5feb\u53d6\u300d\u624d\u91cd\u8f09\u5df2\u958b\u555f\u7684\u5206\u9801\uff08\u4e00\u6b21\u6027\u9077\u79fb\uff09\u3002\n"
    "           \u9019\u6a23\u4f7f\u7528\u8005\u4e0d\u5fc5\u81ea\u5df1\u6309\u91cd\u65b0\u6574\u7406\uff0c\u5c31\u80fd\u96e2\u958b\u88ab\u820a\u5feb\u53d6\u9ecf\u4f4f\u7684\u756b\u9762\uff1b\n"
    "           \u4e5f\u4e0d\u6703\u5728\u6b63\u5e38\u60c5\u6cc1\u4e0b\u9020\u6210\u91cd\u8f09\u8ff4\u5708\u3002 */\n"
    "        if (!oldCount) return null;\n"
    "        return self.clients.matchAll({ type: 'window' }).then(function (cs) {\n"
    "          cs.forEach(function (cl) {\n"
    "            try { cl.navigate(cl.url); } catch (err) {}\n"
    "          });\n"
    "        });\n"
    "      });\n"
    "    })"
)
NEW_ACT = (
    "    }).then(function () {\n"
    "      /* \u53ea\u63a5\u7ba1\u63a7\u5236\u6b0a\uff0c\u4e0d\u518d\u5f37\u5236\u91cd\u8f09\u4efb\u4f55\u5df2\u958b\u555f\u7684\u5206\u9801\u3002\n"
    "         \u820a\u7248\u6703\u5728\u6e05\u6389\u820a\u5feb\u53d6\u6642\u5c0d\u6240\u6709\u5206\u9801\u547c\u53eb cl.navigate()\uff0c\n"
    "         \u9019\u5728 iOS\u300c\u52a0\u5230\u4e3b\u756b\u9762\u300d\u7684 standalone \u6a21\u5f0f\u6703\u9020\u6210\u767d\u5c4f\uff0f\u91cd\u8f09\u8ff4\u5708\uff0c\n"
    "         \u56e0\u6b64\u79fb\u9664\u5f37\u5236\u91cd\u8f09\uff1b\u65b0\u7248\u672c\u6539\u7531 network-first \u81ea\u7136\u53d6\u5f97\u3002 */\n"
    "      return self.clients.claim();\n"
    "    })"
)
s = sub_once(s, OLD_ACT, NEW_ACT, "sw activate forced-navigate")
write(p, s)
print("patched sw-ocr.js")
print("ALL PATCHES OK")
