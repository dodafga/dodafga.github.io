#!/usr/bin/env bash
set -euo pipefail

fetch() { # url dest sha
  local url="$1" dest="$2" want="$3"
  for i in 1 2 3 4 5; do
    curl -fsSL --retry 3 --retry-delay 2 -o "$dest" "$url" || true
    if [ -s "$dest" ]; then
      local got
      got=$(sha256sum "$dest" | awk '{print $1}')
      if [ "$got" = "$want" ]; then
        echo "OK  $dest  $got"
        return 0
      fi
      echo "SHA mismatch on $dest (try $i): got=$got want=$want"
    else
      echo "empty download on $dest (try $i)"
    fi
    sleep 3
  done
  echo "FAILED to fetch $dest"
  return 1
}

mkdir -p photo

fetch "https://paste.rs/tAnhk" "photo/index.html" \
  "59acf53c6951cb744af742b1c8aa85ea1aae4d6e69763f966cd409f40101d100"

fetch "https://paste.rs/UmKYN" "photo/photobuilder.js" \
  "c84db154de8756a5a23f0b6bea35d356bf1e989a7d63230d9a4127fceaf421d5"

echo "--- final sizes ---"
wc -c photo/index.html photo/photobuilder.js
echo "--- final sha ---"
sha256sum photo/index.html photo/photobuilder.js
