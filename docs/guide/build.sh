#!/usr/bin/env bash
# Rebuild docs/SRE-Copilot-Beginners-Guide.pdf (and the copy the landing page serves) from guide.html.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --allow-file-access-from-files \
  --print-to-pdf="../SRE-Copilot-Beginners-Guide.pdf" "file://$PWD/guide.html" 2>/dev/null
cp ../SRE-Copilot-Beginners-Guide.pdf ../../frontend/public/guide.pdf
echo "Wrote $(cd .. && pwd)/SRE-Copilot-Beginners-Guide.pdf and frontend/public/guide.pdf"
