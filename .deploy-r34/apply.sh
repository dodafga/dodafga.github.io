#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "--- payload ---"
sha256sum .deploy-r34/photo.b64
echo "7d69d053cfac9d848b6e7ef31fcea955e58d43f6ad07cec2eb677b15e1d53eb7  .deploy-r34/photo.b64" | sha256sum -c -
cp .deploy-r34/photo.b64 /tmp/photo.patch
git apply -v /tmp/photo.patch
echo "--- verify sha256 ---"
echo "9a687593b4fc7bf8a29bbb53a2ae89cf3e55a488efbc1c669c6a86c6cca3668a  photo/index.html" | sha256sum -c -
echo "--- sizes ---"
wc -c photo/index.html
echo "--- rotbar check ---"
grep -c "rotbar" photo/index.html
grep -c "applyRot" photo/index.html
grep -c "rotateDataUrl" photo/index.html
