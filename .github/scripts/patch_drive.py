import io, sys

p = 'drive/index.html'
s = open(p, encoding='utf-8').read()

# 1) cam.js 版本號（破除 iPhone 舊快取）
s = s.replace('<script src="../assets/cam.js"></script>',
              '<script src="../assets/cam.js?v=20261126c"></script>', 1)

# 2) 白屏保險：第一次繪製前清掉殘留 camopen
guard = ('<body>\n<script>\n'
         '(function(){try{var de=document.documentElement;'
         'if(de.classList.contains("camopen")){'
         'var m=document.getElementById("camModal");'
         'if(!m||!m.classList.contains("on")){'
         'de.classList.remove("camopen");'
         'if(document.body)document.body.style.overflow="";'
         '}}}catch(e){}})();\n</script>')
if '白屏保險' not in s and 'camopen");if(document.body)' not in s:
    s = s.replace('<body>\n', guard + '\n', 1)

open(p, 'w', encoding='utf-8').write(s)
print('patched drive/index.html ->', len(s), 'bytes')
