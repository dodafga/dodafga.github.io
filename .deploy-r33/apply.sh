#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
fetch(){ curl -fsSL --max-time 60 --retry 3 "$1" -o "$2"; }
fetch "https://paste.rs/wmuKB" drive/index.html
fetch "https://paste.rs/Rt7cI" assets/drive-v2.js
fetch "https://paste.rs/AFxh9" assets/drive-v2.css
echo "--- verify sha256 ---"
echo "a5b66c975d2422420d14533b101cdcec968a0d895848fa2fbd9143a587524e03  drive/index.html" | sha256sum -c -
echo "92d042d384cb0e7d5e7f851749c6e23a7746ee83621f372b16d7cfb81b9491fe  assets/drive-v2.js" | sha256sum -c -
echo "1625073f67a06ca56add206c25f001acb45bebed105fb509e3899cca1a334885  assets/drive-v2.css" | sha256sum -c -
echo "--- sizes ---"
wc -c drive/index.html assets/drive-v2.js assets/drive-v2.css
echo "--- rotbar check ---"
grep -c "rotbar" assets/drive-v2.js assets/drive-v2.css
grep -c "data-rotl" assets/drive-v2.js
