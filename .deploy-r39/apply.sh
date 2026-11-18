#!/usr/bin/env bash
set -euo pipefail

fetch() {
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

fetch "https://paste.rs/jT4SW" "photo/index.html" \
  "e82742befe40ff09d073959953e7ea9a2579a4946f517c4b48f0a559a5abf21a"

fetch "https://paste.rs/cCuYP" "photo/photobuilder.js" \
  "1fd2692c0c0cd73f76811d96948ed8ecce4a449bfaaa6f1759315a3498a2a7e9"

echo "--- final sizes ---"
wc -c photo/index.html photo/photobuilder.js
echo "--- final sha ---"
sha256sum photo/index.html photo/photobuilder.js
