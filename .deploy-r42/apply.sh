#!/usr/bin/env bash
set -euo pipefail
SRC="https://paste.rs/TbCMS"
EXPECT="349d1671d945f3a94189e4a5661b0a7ea9a4d3392e481b78fa777f7916cda8c2"
TARGET="log/index.html"
echo "== download =="
curl -fsSL "$SRC" -o /tmp/incoming.html
GOT=$(sha256sum /tmp/incoming.html | awk '{print $1}')
echo "expect=$EXPECT"; echo "got   =$GOT"
if [ "$GOT" != "$EXPECT" ]; then echo "SHA256 MISMATCH - aborting"; exit 1; fi
echo "== write =="
cp /tmp/incoming.html "$TARGET"
FINAL=$(sha256sum "$TARGET" | awk '{print $1}')
echo "final =$FINAL"
if [ "$FINAL" != "$EXPECT" ]; then echo "POST-WRITE MISMATCH - aborting"; exit 1; fi
wc -c "$TARGET"
echo "== commit =="
git config user.name "dodafga"
git config user.email "dodafga@users.noreply.github.com"
git add "$TARGET"
if git diff --cached --quiet; then echo "no change"; else
  git commit -m "fix(log): 鋼筋頂EL1.2 移除 -20.45 下限，照實際 a-b-c 顯示，<= -20.45 以紅字提醒"
  git push origin HEAD:main
fi
echo "DONE"
