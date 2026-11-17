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

mkdir -p drive assets

fetch "https://paste.rs/TQSm9" "drive/index.html" \
  "8d0a756eb11b6500a8878a2fe4edc6e16a97140b5aa3a3c1986c4b5ab567f1fd"

fetch "https://paste.rs/K3XNo" "assets/drive-v2.js" \
  "d897151d12dc00c204942dcf4d868c3f3d43f2f4c4e1818f9192138c87c0562a"

echo "--- final sizes ---"
wc -c drive/index.html assets/drive-v2.js
echo "--- final sha ---"
sha256sum drive/index.html assets/drive-v2.js
