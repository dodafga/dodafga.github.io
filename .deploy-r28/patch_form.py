#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r28：移除查驗單附件表格的表頭列（預覽 + Word 輸出）。
idempotent：已套用則跳過，未套用才替換。"""
import io, sys

def read(p):
    return io.open(p, encoding='utf-8').read()

def write(p, s):
    io.open(p, 'w', encoding='utf-8', newline='').write(s)

changed = []

# ---------- 1) form/index.html：預覽的附件表頭列 ----------
P1 = 'form/index.html'
s = read(P1)
OLD1 = (
    "      h += '<tr class=\"att-head\">' +\n"
    "           '<td>契約項次</td><td>項目及說明</td><td>單位</td><td>查驗數量</td><td>監造覆核</td></tr>';\n"
)
NEW1 = "      /* v9：附件表格不列表頭，直接從資料列開始 */\n"

if OLD1 in s:
    s = s.replace(OLD1, NEW1, 1)
    write(P1, s)
    changed.append(P1 + ' (removed preview head row)')
elif NEW1 in s:
    print('SKIP %s already patched' % P1)
else:
    print('FAIL %s: anchor not found' % P1)
    sys.exit(1)

# ---------- 2) form/formbuilder.js：Word 輸出的附件表頭列 ----------
P2 = 'form/formbuilder.js'
s = read(P2)
OLD2 = (
    'tbl.appendChild(mkRow(doc,ATT_COLS.map(function(c){return mkCell(doc,c.label,c.w,"center",28,!1,1,ATT_H.head)}),ATT_H.head)),'
    'tbl.appendChild(mkRow(doc,[mkCell(doc,data.itemNo||"",ATT_COLS[0].w,"center",24,!1)'
)
NEW2 = (
    'tbl.appendChild(mkRow(doc,[mkCell(doc,data.itemNo||"",ATT_COLS[0].w,"center",24,!1)'
)

if OLD2 in s:
    s = s.replace(OLD2, NEW2, 1)
    write(P2, s)
    changed.append(P2 + ' (removed docx head row)')
elif 'mkCell(doc,c.label,c.w,"center",28,!1,1,ATT_H.head)' not in s:
    print('SKIP %s already patched' % P2)
else:
    print('FAIL %s: anchor not found' % P2)
    sys.exit(1)

print('CHANGED:', changed)
print('sizes:', len(read(P1).encode('utf-8')), len(read(P2).encode('utf-8')))
