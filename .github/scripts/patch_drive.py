import sys

p = 'drive/index.html'
s = open(p, encoding='utf-8').read()

if len(s) < 5000:
    raise SystemExit('drive/index.html 看起來是壞的（%d bytes），中止' % len(s))

# 1) cam.js 版本號（破除 iPhone 舊快取）
s = s.replace('<script src="../assets/cam.js"></script>',
              '<script src="../assets/cam.js?v=20261126c"></script>', 1)

# 2) 白屏保險：第一次繪製前清掉殘留 camopen
MARK = '/* 白屏保險 */'
if MARK not in s:
    guard = ('<body>\n<script>' + MARK + '\n'
             '(function(){try{var de=document.documentElement;'
             'if(de.classList.contains("camopen")){var m=document.getElementById("camModal");'
             'if(!m||!m.classList.contains("on")){de.classList.remove("camopen");'
             'if(document.body)document.body.style.overflow="";}}}catch(e){}})();\n</script>')
    s = s.replace('<body>\n', guard + '\n', 1)

open(p, 'w', encoding='utf-8').write(s)
print('patched drive/index.html ->', len(s), 'bytes')
