#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r30: leave 施工單位 blank in the attachment footer (preview side).
Only touches form/index.html, exactly two lines. Fails loudly if the
expected source text is not found, so a silent no-op can never be committed.
"""
import sys, hashlib

P = "form/index.html"
src = open(P, encoding="utf-8").read()
before = hashlib.sha256(src.encode()).hexdigest()

OLD1 = """'<td class="f1">施工單位: ' + esc(FIXED_CONTRACTOR) + '</td>' +"""
NEW1 = """'<td class="f1">施工單位: </td>' +"""

OLD2 = """        contractor: FIXED_CONTRACTOR,"""
NEW2 = """        contractor: "",   /* 留空供施工單位手寫簽名（依使用者要求） */"""

if OLD1 not in src:
    print("FAIL: OLD1 not found (施工單位 preview line)")
    sys.exit(1)
if OLD2 not in src:
    print("FAIL: OLD2 not found (contractor data field)")
    sys.exit(1)

src = src.replace(OLD1, NEW1, 1)
src = src.replace(OLD2, NEW2, 1)

# Guard: the unrelated 承包商 line must still use FIXED_CONTRACTOR
if """LB('承包商：') + DT(FIXED_CONTRACTOR)""" not in src:
    print("FAIL: 承包商 line was damaged")
    sys.exit(1)
# Guard: 監造單位 must be untouched
if """'<td>監造單位:' + esc(state.attach.supervisor || "") + '</td></tr></table>'""" not in src:
    print("FAIL: 監造單位 line was damaged")
    sys.exit(1)

open(P, "w", encoding="utf-8").write(src)
after = hashlib.sha256(src.encode()).hexdigest()
print("OK  before=%s" % before)
print("OK  after =%s" % after)
print("OK  bytes =%d" % len(src.encode()))
