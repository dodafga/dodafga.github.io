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

mkdir -p drive assets

fetch "https://paste.rs/U6HFQ" "assets/drive-v2.js" \
  "75c835b067d4aed911fe55bccb68404650bb115d46836d8be4d0d085f41c996d"

fetch "https://paste.rs/fNtOr" "assets/drive-v2.css" \
  "3ae0a10ea5f10853be18d939841ba6e016b4e1b48d090aad68a4a22f1709f015"

echo "--- final sizes ---"
wc -c assets/drive-v2.js assets/drive-v2.css
echo "--- final sha ---"
sha256sum assets/drive-v2.js assets/drive-v2.css
