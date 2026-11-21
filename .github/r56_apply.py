#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re, os

M = {
    "#1f3a5f": "#976666", "#2c5282": "#7a4f4e", "#24446b": "#6b4443",
    "#2f5597": "#7a4f4e", "#2c3e50": "#3a3a3e",
    "#c47f17": "#93939b", "#a86b10": "#7c7c85", "#d99a1f": "#93939b",
    "#8a5a0c": "#5f5f66", "#8a5a00": "#5f5f66", "#6d4708": "#4a4a50",
    "#fdf6e7": "#f0eff1", "#fff8e6": "#f0eff1", "#fdf1e0": "#f0eff1",
    "#f0dfb8": "#dcd8d4", "#f0d08a": "#dcd8d4", "#f6ecd2": "#e8e6e9",
    "#fdfaf3": "#faf9fa", "#fffaf0": "#faf9fa",
    "#1f7a4d": "#5f7a63", "#2f7d54": "#5f7a63", "#15803d": "#5f7a63",
    "#e9f5ee": "#edf1ed", "#e4f2ea": "#edf1ed", "#e6f4ec": "#edf1ed",
    "#f2f8f4": "#f2f5f2", "#cfe6da": "#d3ded5", "#d5e8dd": "#d3ded5",
    "#b3261e": "#a34a45", "#d92d20": "#a34a45",
    "#fdf3f2": "#f8edec", "#fdf2f1": "#f8edec", "#fdecea": "#f8edec",
    "#f0cfcc": "#e5cfcd", "#e8c4c1": "#e5cfcd", "#f5c9c4": "#e5cfcd",
    "#1b2430": "#1b1b1d", "#3d4a5c": "#3a3a3e", "#4a5b6e": "#4a4a50",
    "#6b7a8d": "#6e6e74", "#8b98a8": "#8a8a90", "#8a97a8": "#8a8a90",
    "#9aa6b4": "#9a9aa0", "#b9c8da": "#f0e6e5", "#c3d2e4": "#f0e6e5",
    "#d8dee7": "#dcd8d4", "#dde4ec": "#dcd8d4", "#e8edf3": "#eae7e3",
    "#eef1f5": "#f4f3f0", "#f2f5f9": "#f7f5f3", "#dbe6f2": "#e6e2de",
    "#c3cedb": "#d5d0cb", "#c3ccd8": "#d5d0cb", "#d7e0ea": "#dcd8d4",
    "#eef2f7": "#f2f0ed", "#f0f3f7": "#f2f0ed", "#f7f9fc": "#f8f6f4",
    "#f8fafc": "#f9f7f5", "#f8fafd": "#f9f7f5", "#fbfcfe": "#fbfaf9",
    "#fcfdfe": "#fcfbfa", "#fafcfe": "#fbfaf9", "#f5f8fb": "#f6f4f2",
    "#eef4fb": "#f6edec", "#eef4fc": "#f6edec", "#eef3fb": "#f6edec",
    "#e8effa": "#f2e8e7", "#e8f0fa": "#f2e8e7", "#e8f1fa": "#f2e8e7",
    "#d3e2f2": "#e3d2d0", "#c9d9f0": "#dccbc9", "#cfe0f5": "#e3d2d0",
    "#f4f8fc": "#faf5f4", "#f2f7fc": "#f8f3f2", "#f4f7fb": "#f9f4f3",
    "#f4f7fc": "#f9f4f3", "#f7fbff": "#fbf7f6", "#f4f9ff": "#faf5f4",
}

FILES = [
    "index.html", "form/index.html", "photo/index.html", "log/index.html",
    "progress/index.html", "settings/index.html",
    "assets/drive-page.css", "assets/drive-v2.css", "assets/photo-edit.css",
]

hex6 = re.compile(r"#([0-9a-fA-F]{6})(?![0-9a-fA-F])")
hex8 = re.compile(r"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})(?![0-9a-fA-F])")

total = 0
for f in FILES:
    if not os.path.exists(f):
        print("SKIP missing", f); continue
    s = open(f, encoding="utf-8").read()
    orig = s
    n = 0
    def r8(m):
        global n
        b = "#" + m.group(1).lower()
        if b in M:
            n += 1
            return M[b] + m.group(2).lower()
        return m.group(0)
    s = hex8.sub(r8, s)
    def r6(m):
        global n
        b = "#" + m.group(1).lower()
        if b in M:
            n += 1
            return M[b]
        return m.group(0)
    s = hex6.sub(r6, s)

    s = s.replace("--amber:#93939b;--amberBg:#f0eff1;",
                  "--amber:#93939b;--amber-ink:#5f5f66;--amberBg:#f0eff1;")
    s = s.replace("--amber:#93939b;",
                  "--amber:#93939b;--amber-ink:#5f5f66;")
    s = s.replace("color:var(--amber);", "color:var(--amber-ink);")
    s = s.replace("color:var(--amber)}", "color:var(--amber-ink)}")
    s = s.replace("color:var(--amber) ", "color:var(--amber-ink) ")
    s = s.replace(".btn-amber{background:var(--amber);color:#fff}",
                  ".btn-amber{background:var(--amber);color:#1b1b1d}")
    s = s.replace("border-bottom:3px solid var(--amber)",
                  "border-bottom:3px solid #c09d9b")
    for a, b in [("#f2f7fd","#faf5f4"),("#e6ecf3","#eae7e3"),("#c9d3df","#d5d0cb"),
                 ("#dbe7f4","#e6e2de"),("#b9cdea","#dccbc9"),("#e2ecfa","#f0e4e3"),
                 ("#e8c4c0","#e5cfcd"),("#fdf1f0","#f8edec"),("#d9a29c","#dcc0bd")]:
        s = re.sub(re.escape(a), b, s, flags=re.I)

    if s != orig:
        open(f, "w", encoding="utf-8").write(s)
    print(f"{f}: {n}")
    total += n
print("TOTAL", total)
