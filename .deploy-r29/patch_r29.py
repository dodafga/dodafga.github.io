#!/usr/bin/env python3
import base64, gzip, json, sys, hashlib, os

B64 = """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"""

H = json.loads(gzip.decompress(base64.b64decode(B64)).decode("utf-8"))

def apply(path, ops):
    src = open(path, encoding="utf-8").read()
    s = src
    for item in ops:
        old, new = item[0], item[1]
        mode = item[2] if len(item) > 2 else "one"
        c = s.count(old)
        if c == 0:
            if new and new in s:
                continue          # 已套用
            raise SystemExit("MISSING in %s: %r" % (path, old[:80]))
        s = s.replace(old, new) if mode == "all" else s.replace(old, new, 1)
    if s != src:
        open(path, "w", encoding="utf-8").write(s)
        print("patched", path, len(src), "->", len(s))
    else:
        print("unchanged", path)

for path, ops in H.items():
    apply(path, ops)

for p in H:
    print(p, os.path.getsize(p), hashlib.sha256(open(p,"rb").read()).hexdigest())
