#!/bin/sh
# Duman testi: uygulama başsız Chrome'da açılır, app.js sonuna kadar hatasız çalıştı mı (data-ready) bakılır.
# Kullanım: sh e2e/smoke.sh   (deploy.sh yayından önce çağırır)
cd "$(dirname "$0")/.."
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
python3 -m http.server 8799 --bind 127.0.0.1 >/dev/null 2>&1 & S=$!
sleep 1
"$CH" --headless=new --disable-gpu --virtual-time-budget=8000 --dump-dom "http://127.0.0.1:8799/?smoke" 2>/dev/null | grep -q 'data-ready="1"'; r=$?
kill $S
[ $r -eq 0 ] && echo "smoke ok" || { echo "SMOKE FAIL: app did not finish loading"; exit 1; }
