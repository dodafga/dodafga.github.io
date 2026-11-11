# -*- coding: utf-8 -*-
"""一次性套用：把 log/ 與 progress/ 內嵌 script 的 pad2/esc/todayISO 改為 Core 版本。"""
import io, sys

def rd(p): return io.open(p, encoding='utf-8').read()
def wr(p, s): io.open(p, 'w', encoding='utf-8').write(s)

# ---------- log/index.html ----------
p = 'log/index.html'
s = rd(p)
old = """  function todayISO(){
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function isoToSlash(iso){
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[0] + '/' + p[1] + '/' + p[2];
  }

  function escHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }
"""
new = """  /* 共用工具一律取自 assets/core.js（core.js 已在本頁 inline script 之前載入）。
     原本本頁各自複製一份 todayISO / isoToSlash / escHtml：
       - todayISO 內嵌補零邏輯（等同 Core.pad2），與 Core 版本重複
       - escHtml 只跳脫 & < > "，漏了單引號，屬性值有注入風險
     現統一改為呼叫 Core 版本，行為一致且補上單引號跳脫。 */
  var CORE = window.Core;
  if (!CORE) { console.error('[log] assets/core.js 未載入，共用工具無法使用'); }
  var todayISO   = CORE.todayISO;
  var isoToSlash = CORE.isoToSlash;
  var escHtml    = CORE.esc;
"""
if old in s:
    s = s.replace(old, new, 1); wr(p, s); print('log: patched')
elif 'var escHtml    = CORE.esc;' in s:
    print('log: already patched')
else:
    print('log: PATTERN NOT FOUND'); sys.exit(1)

# ---------- progress/index.html ----------
p = 'progress/index.html'
s = rd(p)
old_head = """  var S = window.SuiteStore;
  var data = S.load();
  var filter = { side:'', status:'', inspect:'', q:'', sort:'actual' };

  function $(id){ return document.getElementById(id); }
"""
new_head = """  var S = window.SuiteStore;

  /* 共用工具一律取自 assets/core.js（core.js 已在本頁 inline script 之前載入）。
     本頁原本沒有自己的 pad2 / esc / todayISO，而是繞一層 SuiteStore 的包裝
     （S.todayISO / S.isoToSlash 內部再轉呼叫 Core），且組 HTML 時完全沒有跳脫。
     現改為直接呼叫 Core 版本，並補上 Core.esc 供組字串時使用。 */
  var CORE = window.Core;
  if (!CORE) { console.error('[progress] assets/core.js 未載入，共用工具無法使用'); }
  var todayISO   = CORE.todayISO;
  var isoToSlash = CORE.isoToSlash;
  var esc        = CORE.esc;

  var data = S.load();
  var filter = { side:'', status:'', inspect:'', q:'', sort:'actual' };

  function $(id){ return document.getElementById(id); }
"""
if old_head in s:
    s = s.replace(old_head, new_head, 1)
    s = s.replace('S.todayISO()', 'todayISO()').replace('S.isoToSlash(', 'isoToSlash(')
    old_dl = """  function downloadBlob(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
  }
"""
    new_dl = """  /* 原本自己 createObjectURL / revoke，與 assets/core.js 的 Core.download 重複；
     改為直接呼叫 Core.download（同樣會 revoke，且少了重複實作）。 */
  function downloadBlob(blob, filename){
    CORE.download(filename, blob);
  }
"""
    if old_dl in s:
        s = s.replace(old_dl, new_dl, 1)
    else:
        print('progress: downloadBlob pattern missing (skip)')

    # 抽屜（墩號詳情）組 HTML 時，使用者輸入完全沒有跳脫 → 補上 Core.esc
    esc_reps = [
        ("""<div class="k">墩號</div><div class="v">' + pier + '</div>""",
         """<div class="k">墩號</div><div class="v">' + esc(pier) + '</div>"""),
        ("""<div class="k">類型</div><div class="v">' + (def.type || '—') + '</div>""",
         """<div class="k">類型</div><div class="v">' + esc(def.type || '—') + '</div>"""),
        ("""<div class="k">岸別</div><div class="v">' + (def.side || '—') + '</div>""",
         """<div class="k">岸別</div><div class="v">' + esc(def.side || '—') + '</div>"""),
        ("""'<span class="lm">' + (lPiers.join('、') || '') + '</span></div>'""",
         """'<span class="lm">' + esc(lPiers.join('、') || '') + '</span></div>'"""),
        ("""'<div class="ll"><b>查驗人員：</b>' + (l.inspector || '—') +""",
         """'<div class="ll"><b>查驗人員：</b>' + esc(l.inspector || '—') +"""),
        ("""'　<b>監造派員：</b>' + (l.supervisor || '—') + '</div>'""",
         """'　<b>監造派員：</b>' + esc(l.supervisor || '—') + '</div>'"""),
        ("""'<div class="ll"><b>查驗位置：</b>' + ((S.composeLocation ? S.composeLocation(data, l) : l.location) || '—') + '</div>'""",
         """'<div class="ll"><b>查驗位置：</b>' + esc((S.composeLocation ? S.composeLocation(data, l) : l.location) || '—') + '</div>'"""),
        ("""return '<span class="pill i2" style="margin:1px 3px 1px 0;">' + p + '</span>';""",
         """return '<span class="pill i2" style="margin:1px 3px 1px 0;">' + esc(p) + '</span>';"""),
        ("""return '<span class="pill i1" style="margin:1px 3px 1px 0;">' + no + '</span>';""",
         """return '<span class="pill i1" style="margin:1px 3px 1px 0;">' + esc(no) + '</span>';"""),
        ("""h += '<div class="ditem"><div class="k">' + p.pileNo +""",
         """h += '<div class="ditem"><div class="k">' + esc(p.pileNo) +"""),
        ("""新增紀錄並選擇墩號 ' + pier + '</div></div>';""",
         """新增紀錄並選擇墩號 ' + esc(pier) + '</div></div>';"""),
    ]
    n = 0
    for a, b in esc_reps:
        if a in s:
            s = s.replace(a, b, 1); n += 1
    print('progress: esc applied', n, '/', len(esc_reps))

    wr(p, s); print('progress: patched')
elif 'var esc        = CORE.esc;' in s:
    print('progress: already patched')
else:
    print('progress: PATTERN NOT FOUND'); sys.exit(1)

# ---------- 驗證 ----------
for f in ['log/index.html', 'progress/index.html']:
    t = rd(f)
    assert 'function todayISO' not in t, f + ' still has local todayISO'
    assert 'function escHtml' not in t, f + ' still has local escHtml'
    assert 'function pad2' not in t, f + ' still has local pad2'
    assert 'assets/core.js' in t, f + ' missing core.js'
    ci = t.find('assets/core.js')
    import re
    m = re.search(r'<script(?![^>]*\bsrc=)[^>]*>', t)
    assert ci < m.start(), f + ' core.js must load before inline script'
    print(f, 'OK  core.js before inline:', ci < m.start())
print('ALL DONE')
