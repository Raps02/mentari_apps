#!/usr/bin/env bash
# Salin kode extension terbaru ke aplikasi Android (assets/ext), lalu commit & push untuk build APK baru.
# Pemakaian: ./sync-extension.sh [folder-extension]
set -euo pipefail
SRC="${1:-../mentari-extension-v1.7.0}"
DST="$(dirname "$0")/app/src/main/assets/ext"
for f in content.js background.js unblock.js pastemain.js; do
  cp "$SRC/$f" "$DST/$f"
  echo "✓ $f"
done
echo "Selesai. shim.js milik aplikasi tidak diubah."
