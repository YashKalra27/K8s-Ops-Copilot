#!/usr/bin/env bash
# Rebuild docs/EnterpriseRAG-Beginners-Guide.pdf from guide.html with headless Chrome.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --allow-file-access-from-files \
  --print-to-pdf="../EnterpriseRAG-Beginners-Guide.pdf" "file://$PWD/guide.html" 2>/dev/null
echo "Wrote $(cd .. && pwd)/EnterpriseRAG-Beginners-Guide.pdf"
