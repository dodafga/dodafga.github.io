#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""在 GitHub runner 內對 log/index.html 套用「已建檔／未建檔」標記修補。
來源檔為 repo 內的原始版本，不依賴任何私有連結。
"""
import sys, hashlib

SRC = sys.argv[1] if len(sys.argv) > 1 else 'log/index.html'
EXPECT_SHA = '8fd171344329ee419e8ca95cf541c53f32cd35f0c2dea58c290efc24283ee09a'

h = open(SRC, 'rb').read()
got = hashlib.sha256(h).hexdigest()
if got != EXPECT_SHA:
    print('SOURCE SHA MISMATCH: %s (expected %s)' % (got, EXPECT_SHA))
    sys.exit(1)
print('source sha ok:', got)

s = h.decode('utf-8')

EDITS = [
# 1) CSS
("""  .phint{font-size:11.5px;line-height:1.6;margin-top:6px;color:var(--muted);}
  .phint.warn{color:var(--danger);font-weight:600;}""",
 """  .phint{font-size:11.5px;line-height:1.6;margin-top:6px;color:var(--muted);}
  .phint.warn{color:var(--danger);font-weight:600;}
  /* 樁號「已建檔／未建檔」標記 */
  .plegend{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:11.5px;
    color:var(--muted);margin-top:6px;line-height:1.55;}
  .plegend .lg{display:inline-flex;align-items:center;gap:4px;font-weight:800;
    padding:1px 8px;border-radius:20px;font-size:11px;white-space:nowrap;}
  .plegend .lg-done{background:rgba(21,128,61,.13);color:#15803d;}
  .plegend .lg-todo{background:rgba(107,122,141,.14);color:#5d6b7d;}
  option.optDone{color:#15803d;font-weight:700;}
  option.optTodo{color:#6b7a8d;}"""),

# 2) 圖例 HTML
("""          <div class="phint" id="pPileHint" style="display:none;"></div>""",
 """          <div class="phint" id="pPileHint" style="display:none;"></div>
          <div class="plegend" id="pPileLegend" style="display:none;">
            <span><span class="lg lg-done">✓ 已建檔</span> 該樁號本日已有樁位資料表紀錄（仍可載入修改）</span>
            <span><span class="lg lg-todo">○ 未建檔</span> 該樁號本日尚無紀錄</span>
          </div>"""),

# 3) 保留原選取值
("""  function refreshPPileSelect(){
    var sel = $('pPile');
    sel.innerHTML = '';""",
 """  function refreshPPileSelect(){
    var sel = $('pPile');
    var prev = sel.value;
    sel.innerHTML = '';"""),

# 4) 選項標記
("""    var nos = pileNosOfPier(pier);
    /* 選了日期：樁號只列「當日查驗的樁號」 */
    if (d) {
      var today = pilesInspectedOn(d);
      nos = nos.filter(function(no){ return today.indexOf(no) >= 0; });
    }
    var o0 = document.createElement('option');
    o0.value = ''; o0.textContent = '— 選擇樁號 —';
    sel.appendChild(o0);
    nos.forEach(function(no){
      var op = document.createElement('option');
      op.value = no; op.textContent = no;
      sel.appendChild(op);
    });
    sel.disabled = !nos.length;""",
 """    var nos = pileNosOfPier(pier);
    /* 選了日期：樁號只列「當日查驗的樁號」 */
    if (d) {
      var today = pilesInspectedOn(d);
      nos = nos.filter(function(no){ return today.indexOf(no) >= 0; });
    }

    /* 該日期在「樁位資料表」已建檔的樁號（同一份 pstate.rows，含雲端載入） */
    var filed = {};
    if (d) {
      pstate.rows.forEach(function(r){
        if (String(r.date || '') === String(d)) filed[String(r.pile || '')] = true;
      });
    }

    var o0 = document.createElement('option');
    o0.value = ''; o0.textContent = '— 選擇樁號 —';
    sel.appendChild(o0);
    nos.forEach(function(no){
      var op = document.createElement('option');
      op.value = no;
      /* 有日期才標記；已建檔仍可選、可載入修改，只是加上辨識用的符號與顏色 */
      if (d && filed[no]) { op.textContent = '✓ ' + no; op.className = 'optDone'; }
      else if (d)         { op.textContent = '○ ' + no; op.className = 'optTodo'; }
      else                { op.textContent = no; }
      sel.appendChild(op);
    });
    sel.disabled = !nos.length;
    /* 原本選的樁號若仍在新清單中，保留選取（避免標記刷新把選好的樁號清掉） */
    if (prev && nos.indexOf(prev) >= 0) sel.value = prev;"""),

# 5) 提示文字 + 圖例顯示
("""        } else {
          hint.style.display = '';
          hint.className = 'phint';
          hint.textContent = '本日有查驗的樁號共 ' + all.length + ' 支：' + all.join('、');
        }
      } else {
        hint.style.display = 'none';
        hint.textContent = '';
      }
    }
  }""",
 """        } else {
          var nDone = nos.filter(function(no){ return filed[no]; }).length;
          hint.style.display = '';
          hint.className = 'phint';
          hint.textContent = '本日有查驗的樁號共 ' + all.length + ' 支：' + all.join('、') +
            '。本墩已建檔 ' + nDone + ' 支、未建檔 ' + (nos.length - nDone) + ' 支（已建檔仍可載入修改）。';
        }
      } else {
        hint.style.display = 'none';
        hint.textContent = '';
      }
    }
    /* 圖例：只有在「已選日期且有樁號可選」時才顯示，避免無意義的說明 */
    var lg = $('pPileLegend');
    if (lg) lg.style.display = (d && nos.length) ? '' : 'none';
  }"""),

# 6) pRender 後刷新標記
("""  function pRender(){
    var body = $('pBody');
    body.innerHTML = '';""",
 """  function pRender(){
    var body = $('pBody');
    body.innerHTML = '';
    /* 樁位紀錄增／刪／改、雲端載入後，樁號的「已建檔／未建檔」標記要跟著更新 */
    if (typeof refreshPPileSelect === 'function') refreshPPileSelect();"""),
]

for i, (old, new) in enumerate(EDITS, 1):
    n = s.count(old)
    if n != 1:
        print('EDIT %d: expected 1 occurrence, found %d' % (i, n))
        sys.exit(1)
    s = s.replace(old, new, 1)
    print('edit %d applied' % i)

open(SRC, 'w', encoding='utf-8').write(s)
print('written', len(s.encode('utf-8')), 'bytes')
