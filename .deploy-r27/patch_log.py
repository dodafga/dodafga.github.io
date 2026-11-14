#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r27: 在樁位資料表標題旁加上「本日已建檔 N 支／未建檔 M 支」統計。
idempotent：已套用就跳過，未套用才替換。只動 log/index.html。"""
import io, sys

P = 'log/index.html'
s = io.open(P, encoding='utf-8').read()
orig = s
applied = []


def rep(name, old, new):
    global s
    if new in s:
        applied.append(name + ':already')
        return
    if old not in s:
        applied.append(name + ':ANCHOR-MISS')
        return
    if s.count(old) != 1:
        applied.append(name + ':NOT-UNIQUE(%d)' % s.count(old))
        return
    s = s.replace(old, new, 1)
    applied.append(name + ':ok')


rep('css',
    '  .card-h .tag.ok{background:#e9f5ee;color:var(--ok);border-color:#cfe6da;}\n'
    '  .card-h .spacer{margin-left:auto;}',
    '  .card-h .tag.ok{background:#e9f5ee;color:var(--ok);border-color:#cfe6da;}\n'
    '  /* \u6a01\u4f4d\u8cc7\u6599\u8868\u6a19\u984c\u65c1\u7684\u300c\u672c\u65e5\u5df2\u5efa\u6a94\uff0f\u672a\u5efa\u6a94\u300d\u7d71\u8a08 */\n'
    '  .card-h .tag.stat{background:#eef3fb;color:#2f5d9e;border-color:#d3e0f2;font-variant-numeric:tabular-nums;}\n'
    '  .card-h .tag.stat b{font-weight:700;}\n'
    '  .card-h .tag.stat .sd{color:var(--ok);}\n'
    '  .card-h .tag.stat .st{color:#8a6d1f;}\n'
    '  .card-h .spacer{margin-left:auto;}')

rep('html',
    '      <h2>\u6a01\u4f4d\u8cc7\u6599\u8868</h2>\n'
    '      <span class="tag">\u6bcf\u652f\u6a01\u4f4d\u4e00\u7b46\u6aa2\u67e5\u8cc7\u8a0a</span>',
    '      <h2>\u6a01\u4f4d\u8cc7\u6599\u8868</h2>\n'
    '      <span class="tag stat" id="pStatTag" style="display:none;">\u672c\u65e5\u5df2\u5efa\u6a94 0 \u652f\uff0f\u672a\u5efa\u6a94 0 \u652f</span>\n'
    '      <span class="tag">\u6bcf\u652f\u6a01\u4f4d\u4e00\u7b46\u6aa2\u67e5\u8cc7\u8a0a</span>')

FN = (
    '  /* \u6a19\u984c\u65c1\u7d71\u8a08\uff1a\u672c\u65e5\u5df2\u5efa\u6a94\uff0f\u672a\u5efa\u6a94\uff08\u4f9d\u76ee\u524d\u9078\u7684\u65e5\u671f\u5373\u6642\u8a08\u7b97\uff09\n'
    '     - \u672a\u9078\u65e5\u671f\uff1a\u96b1\u85cf\uff08\u6c92\u6709\u300c\u672c\u65e5\u300d\u53ef\u8a00\uff09\n'
    '     - \u7576\u65e5\u7121\u67e5\u9a57\u6a01\u865f\uff1a\u986f\u793a\u300c\u672c\u65e5\u7121\u67e5\u9a57\u6a01\u865f\u300d\n'
    '     - \u6709\u67e5\u9a57\u6a01\u865f\uff1a\u5df2\u5efa\u6a94 = \u7576\u65e5\u67e5\u9a57\u6a01\u865f\u4e2d\uff0c\u6a01\u4f4d\u8cc7\u6599\u8868\u5df2\u6709\u7d00\u9304\u7684\u652f\u6578 */\n'
    '  function updatePStatTag(){\n'
    "    var el = $('pStatTag');\n"
    '    if (!el) return;\n'
    "    var d = $('pDate') ? $('pDate').value : '';\n"
    "    if (!d) { el.style.display = 'none'; el.textContent = ''; return; }\n"
    '\n'
    '    var all = pilesInspectedOn(d);\n'
    '    if (!all.length) {\n'
    "      el.style.display = '';\n"
    "      el.className = 'tag stat';\n"
    "      el.textContent = '\u672c\u65e5\u7121\u67e5\u9a57\u6a01\u865f';\n"
    '      return;\n'
    '    }\n'
    '    var filed = {};\n'
    '    pstate.rows.forEach(function(r){\n'
    "      if (String(r.date || '') === String(d)) filed[String(r.pile || '')] = true;\n"
    '    });\n'
    '    var nDone = all.filter(function(no){ return filed[no]; }).length;\n'
    '    var nTodo = all.length - nDone;\n'
    "    el.style.display = '';\n"
    "    el.className = 'tag stat';\n"
    "    el.innerHTML = '\u672c\u65e5\u5df2\u5efa\u6a94 <b class=\"sd\">' + nDone + '</b> \u652f\uff0f\u672a\u5efa\u6a94 <b class=\"st\">' + nTodo + '</b> \u652f';\n"
    '  }\n'
    '\n'
)
rep('fn',
    '  function refreshPPileSelect(){\n'
    "    var sel = $('pPile');",
    FN + '  function refreshPPileSelect(){\n'
    "    var sel = $('pPile');")

rep('call-early',
    "    var pier = $('pPier').value;\n"
    "    var d = $('pDate').value;\n"
    '    if (!pier) {',
    "    var pier = $('pPier').value;\n"
    "    var d = $('pDate').value;\n"
    '    /* \u6a19\u984c\u65c1\u7d71\u8a08\u53ea\u4f9d\u300c\u65e5\u671f\u300d\u8a08\u7b97\uff0c\u8207\u58a9\u865f\u7121\u95dc \u2192 \u5fc5\u9808\u5728\u4e0b\u9762\u7684 early return \u4e4b\u524d\u5148\u66f4\u65b0\uff0c\n'
    '       \u5426\u5247\u672a\u9078\u58a9\u865f\u6642\u7d71\u8a08\u6c38\u9060\u4e0d\u6703\u5237\u65b0\uff08\u539f\u672c\u7684 bug\uff09 */\n'
    '    updatePStatTag();\n'
    '    if (!pier) {')

rep('call-tail',
    "    if (lg) lg.style.display = (d && nos.length) ? '' : 'none';\n"
    '  }',
    "    if (lg) lg.style.display = (d && nos.length) ? '' : 'none';\n"
    '    /* \u6a19\u984c\u65c1\u7d71\u8a08\u8ddf\u8457\u65e5\u671f\uff0f\u58a9\u865f\uff0f\u7d00\u9304\u4e00\u8d77\u66f4\u65b0 */\n'
    '    updatePStatTag();\n'
    '  }')

print(' | '.join(applied))
bad = [a for a in applied if 'ANCHOR-MISS' in a or 'NOT-UNIQUE' in a]
if bad:
    print('FAILED: ' + ', '.join(bad))
    sys.exit(1)

if s != orig:
    io.open(P, 'w', encoding='utf-8').write(s)
    print('WROTE %d bytes' % len(s.encode('utf-8')))
else:
    print('NO CHANGE (already applied)')
