#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "--- patch ---"
sha256sum .deploy-r35/log.patch
echo "f3122baf89fb07074ca88536ba43c42cd313138943875645ff9303fd0ba2bb67  .deploy-r35/log.patch" | sha256sum -c -
git apply -v .deploy-r35/log.patch
echo "--- verify ---"
echo "1ad3b17953f2ca7571750b7e49e640a3f4a3e81b958fcd9d76702ec166a47615  log/index.html" | sha256sum -c -
wc -c log/index.html
echo "depthToB=$(grep -c depthToB log/index.html) clampTop=$(grep -c clampTop log/index.html) TOP_MIN=$(grep -c TOP_MIN log/index.html)"
