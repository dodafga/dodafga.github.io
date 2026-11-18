#!/usr/bin/env bash
set -euo pipefail

SRC="https://paste.rs/mZsxp"
EXPECT="8b668a94883fe0a25b8d7692db11a8ef46c9898109435c019ced336261cc06ee"
TARGET="log/index.html"

echo "== download =="
curl -fsSL "$SRC" -o /tmp/incoming.html
GOT=$(sha256sum /tmp/incoming.html | awk '{print $1}')
echo "expect=$EXPECT"
echo "got   =$GOT"
if [ "$GOT" != "$EXPECT" ]; then
  echo "SHA256 MISMATCH — aborting, nothing written"
  exit 1
fi

echo "== write =="
cp /tmp/incoming.html "$TARGET"

echo "== verify on disk =="
FINAL=$(sha256sum "$TARGET" | awk '{print $1}')
echo "final =$FINAL"
if [ "$FINAL" != "$EXPECT" ]; then
  echo "POST-WRITE MISMATCH — aborting"
  exit 1
fi
wc -c "$TARGET"

echo "== commit =="
git config user.name "dodafga"
git config user.email "dodafga@users.noreply.github.com"
git add "$TARGET"
if git diff --cached --quiet; then
  echo "no change to commit"
else
  git commit -m "fix(log): 鋼筋頂EL1.2 算式改為 a − b − c（b 保持原值，c = 深度 + 0.1）"
  git push origin HEAD:main
fi
echo "DONE"
