#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
curl -fsSL --max-time 60 --retry 3 "https://paste.rs/fYkFC" -o photo/index.html
echo "--- verify sha256 ---"
echo "99414d657b042e11762b684a0a38ce19bf99600aefb287fc3ce905666476ed44  photo/index.html" | sha256sum -c -
echo "--- sizes ---"
wc -c photo/index.html
echo "--- rotbar check ---"
grep -c "rotbar" photo/index.html
grep -c "data-rotl" photo/index.html
grep -c "rotateDataUrl" photo/index.html
