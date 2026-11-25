#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r74 patch: harden the iOS standalone fix.
1) sw-ocr.js: never intercept page navigations; drop the cached page-shell fallback;
   bump cache to v5.
2) drive/index.html: one-time self-heal for devices still controlled by the old SW.
Every replacement must match exactly once."""
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

# ---------- sw-ocr.js ----------
p = os.path.join(ROOT, "sw-ocr.js")
s = read(p)

s = sub_once(s, "var CACHE = 'drive-offline-v4';", "var CACHE = 'drive-offline-v5';", "cache version")

OLD_NAV = (
    "  /* ---- \u9801\u9762\u8207\u7a0b\u5f0f\uff0f\u6a23\u5f0f\uff1anetwork-first\uff08\u5148\u4e0a\u7db2\u62ff\u6700\u65b0\u7248\uff0c\u96e2\u7dda\u624d\u7528\u5feb\u53d6\uff09---- */\n"
    "  e.respondWith(\n"
    "    caches.open(CACHE).then(function (c) {\n"
    "      var net = req.mode === 'navigate'\n"
    "        ? fetch(req, { cache: 'no-cache' })\n"
    "        : fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });"
)
NEW_NAV = (
    "  /* ---- \u9801\u9762\u5c0e\u89bd\uff1a\u5b8c\u5168\u4e0d\u6514\u622a\uff0c\u4ea4\u7d66\u700f\u89bd\u5668\u76f4\u63a5\u4e0a\u7db2 ----\n"
    "     iOS\u300c\u52a0\u5230\u4e3b\u756b\u9762\u300d\u7684 standalone \u6a21\u5f0f\u5c0d SW \u56de\u61c9\u7684\u5c0e\u89bd\u7279\u5225\u654f\u611f\uff0c\n"
    "     \u4e00\u65e6\u62ff\u5230\u820a\u7684\u9801\u9762\u5916\u6bbc\u5c31\u6703\u767d\u5c4f\u4e14\u7121\u6cd5\u81ea\u884c\u6062\u5fa9\uff0c\u56e0\u6b64\u5c0e\u89bd\u4e00\u5f8b\u653e\u884c\u3002 */\n"
    "  if (req.mode === 'navigate') return;\n"
    "\n"
    "  /* ---- \u7a0b\u5f0f\uff0f\u6a23\u5f0f\uff1anetwork-first\uff08\u5148\u4e0a\u7db2\u62ff\u6700\u65b0\u7248\uff0c\u96e2\u7dda\u624d\u7528\u5feb\u53d6\uff09---- */\n"
    "  e.respondWith(\n"
    "    caches.open(CACHE).then(function (c) {\n"
    "      var net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });"
)
s = sub_once(s, OLD_NAV, NEW_NAV, "sw navigate passthrough")

OLD_CATCH = (
    "      }).catch(function () {\n"
    "        /* \u96e2\u7dda\uff1a\u9000\u56de\u5feb\u53d6\u3002\u5c0e\u89bd\u8acb\u6c42\u9023\u9801\u9762\u5feb\u53d6\u90fd\u6c92\u6709\u6642\uff0c\u56de\u9801\u9762\u5feb\u53d6\u7684\u6700\u5f8c\u624b\u6bb5\u3002 */\n"
    "        return c.match(req, { ignoreSearch: true }).then(function (hit) {\n"
    "          if (hit) return hit;\n"
    "          if (req.mode === 'navigate') {\n"
    "            return c.match(PAGE_URLS[0], { ignoreSearch: true }).then(function (pg) {\n"
    "              return pg || Response.error();\n"
    "            });\n"
    "          }\n"
    "          return Response.error();\n"
    "        });\n"
    "      });"
)
NEW_CATCH = (
    "      }).catch(function () {\n"
    "        /* \u96e2\u7dda\uff1a\u9000\u56de\u5feb\u53d6\uff08\u5c0e\u89bd\u8acb\u6c42\u5df2\u5728\u4e0a\u9762\u653e\u884c\uff0c\u4e0d\u6703\u8d70\u5230\u9019\u88e1\uff09\u3002 */\n"
    "        return c.match(req, { ignoreSearch: true }).then(function (hit) {\n"
    "          return hit || Response.error();\n"
    "        });\n"
    "      });"
)
s = sub_once(s, OLD_CATCH, NEW_CATCH, "sw offline fallback")

write(p, s)
print("patched sw-ocr.js")

# ---------- drive/index.html ----------
p = os.path.join(ROOT, "drive", "index.html")
h = read(p)

OLD_REG = (
    "    navigator.serviceWorker.register('../sw-ocr.js',{scope:'../'}).catch(function(){});\n"
    "  }catch(e){}\n"
    "})();\n"
    "</script>"
)
NEW_REG = (
    "    /* \u4e00\u822c\u700f\u89bd\u5668\uff1a\u82e5\u76ee\u524d\u88ab\u300c\u820a\u7248\u300dSW \u63a7\u5236\uff08\u820a\u7248\u6703\u5f37\u5236\u91cd\u8f09\u5206\u9801\u3001\u4e26\u7528\u5feb\u53d6\u56de\u61c9\u5c0e\u89bd\uff09\uff0c\n"
    "       \u5148\u89e3\u9664\u5b83\u4e26\u91cd\u8f09\u4e00\u6b21\uff1b\u91cd\u8f09\u5f8c\u5c31\u7531\u65b0\u7248 SW \u63a5\u624b\uff08\u65b0\u7248\u4e0d\u6514\u5c0e\u89bd\u3001\u4e0d\u5f37\u5236\u91cd\u8f09\uff09\u3002 */\n"
    "    try{\n"
    "      var ctrl = navigator.serviceWorker.controller;\n"
    "      var KEY='sw-selfheal-v5';\n"
    "      if(!sessionStorage.getItem(KEY) && ctrl && ctrl.scriptURL && ctrl.scriptURL.indexOf('sw-ocr.js') >= 0){\n"
    "        sessionStorage.setItem(KEY,'1');\n"
    "        navigator.serviceWorker.getRegistrations().then(function(rs){\n"
    "          return Promise.all(rs.map(function(r){ return r.unregister().catch(function(){}); }));\n"
    "        }).then(function(){ location.reload(); }).catch(function(){});\n"
    "        return;\n"
    "      }\n"
    "    }catch(e){}\n"
    "    navigator.serviceWorker.register('../sw-ocr.js',{scope:'../'}).catch(function(){});\n"
    "  }catch(e){}\n"
    "})();\n"
    "</script>"
)
h = sub_once(h, OLD_REG, NEW_REG, "index self-heal")
write(p, h)
print("patched drive/index.html")
print("ALL PATCHES OK")
