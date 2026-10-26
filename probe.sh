#!/bin/sh
# SunPeek'in veri çektiği servisleri düzenli yoklar ve sonucu stdout'a (docker logs) yazar.
# Her turda sorunlu servis FAIL satırı üretir; düzelen servis bir kez RECOVERED yazar; saatte bir özet OK satırı.
# Kullanım: docker logs sunpeek-probe | grep -v ' OK '
INTERVAL=${INTERVAL:-600}
UA='SunPeek-healthcheck (+https://sunpeek.uk)'
Q='[out:json][timeout:20];way(around:30,51.4779,-0.0015)["building"];out ids 1;'
D=$(date -u -d @$(( $(date +%s) - 10*86400 )) +%F 2>/dev/null || date -u +%F)

check() { # ad, beklenen metin, curl argümanları...
  name=$1 want=$2; shift 2
  out=$(curl -sS -m 30 -A "$UA" -w '\n%{http_code} %{time_total}' "$@" 2>&1)
  code=$(echo "$out" | tail -n1 | cut -d' ' -f1) t=$(echo "$out" | tail -n1 | cut -d' ' -f2)
  if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 400 ] && echo "$out" | grep -q -- "$want"; then
    [ -f "/tmp/$name.fail" ] && { rm -f "/tmp/$name.fail"; log RECOVERED "$name" "$code" "$t"; }
    ok="$ok $name"
  else
    touch "/tmp/$name.fail"; log FAIL "$name" "$code" "$t" "$(echo "$out" | head -n1 | cut -c1-120)"
  fi
}
log() { echo "$(date -u +%FT%TZ) $1 $2 http=$3 ${4}s ${5:-}"; }

n=0
while :; do
  ok=
  check overpass-main  '"elements"' --data-urlencode "data=$Q" https://overpass-api.de/api/interpreter
  check overpass-mailru '"elements"' --data-urlencode "data=$Q" https://maps.mail.ru/osm/tools/overpass/api/interpreter
  check overpass-coffee '"elements"' --data-urlencode "data=$Q" https://overpass.private.coffee/api/interpreter
  check openmeteo-elev  '"elevation"' 'https://api.open-meteo.com/v1/elevation?latitude=51.4779&longitude=-0.0015'
  check openmeteo-tz    '"timezone"' 'https://api.open-meteo.com/v1/forecast?latitude=51.48&longitude=0&timezone=auto&forecast_days=1&daily=sunrise'
  check openmeteo-archive '"direct_normal_irradiance"' "https://archive-api.open-meteo.com/v1/archive?latitude=51.48&longitude=0&start_date=$D&end_date=$D&hourly=direct_normal_irradiance"
  check nominatim       '"display_name"' 'https://nominatim.openstreetmap.org/reverse?format=json&lat=51.4779&lon=-0.0015'
  check esri-tiles      '' -o /dev/null 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/21790/32767'
  check unpkg           '' -o /dev/null -I 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
  [ $((n % (3600 / INTERVAL))) -eq 0 ] && echo "$(date -u +%FT%TZ) OK$ok"
  n=$((n + 1))
  sleep "$INTERVAL"
done
