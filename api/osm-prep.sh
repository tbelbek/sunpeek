#!/bin/sh
# Şehir bina verisini hazırlar (kırsal yok): BBBike şehir dosyaları + İsveç dosyasından şehir kutuları → yalnız binalar →
# yollara düğüm konumları → <ad>.opl ve <ad>.poly. Ardından import.mjs yükler. Sunucuda (yeniden çalıştırmak güvenli):
#   docker run --rm -v D:/Docker/sunpeek-osm:/d -v D:/Docker/sunpeek/api/osm-prep.sh:/prep.sh:ro debian:bookworm-slim sh /prep.sh
set -eu
apt-get update -qq && apt-get install -y -qq --no-install-recommends osmium-tool curl ca-certificates >/dev/null
cd /d
BBBIKE='London Paris Berlin Madrid Barcelona Muenchen Hamburg Wien Amsterdam Bruessel Copenhagen Stockholm Oslo Helsinki
Goeteborg Malmoe Dublin Lisbon Porto Prag Warsaw Cracow Budapest Zuerich Genf Lyon Marseille Frankfurt Koeln Rotterdam
Istanbul Turin Edinburgh Manchester Sofia Zagreb Ljubljana Riga Tallinn Aarhus Trondheim'
for c in $BBBIKE; do
  [ -s "$c.osm.pbf" ] || { curl -sSfL -o "$c.osm.pbf.part" "https://download.bbbike.org/osm/bbbike/$c/$c.osm.pbf" && mv "$c.osm.pbf.part" "$c.osm.pbf"; sleep 2; }
  [ -s "$c.poly" ] || curl -sSfL -o "$c.poly" "https://download.bbbike.org/osm/bbbike/$c/$c.poly"
done
# BBBike'ta olmayan şehirler: Geofabrik ülke dosyasından merkez ±~6 km kutu (ülke, ad, batı, güney, doğu, kuzey). Kırsal saklanmaz.
while read -r cc n w s e N; do
  [ -s "$cc-latest.osm.pbf" ] || { curl -sSfL -o "$cc.part" "https://download.geofabrik.de/europe/$cc-latest.osm.pbf" && mv "$cc.part" "$cc-latest.osm.pbf"; }
  [ -s "$n.osm.pbf" ] || osmium extract -s smart -b "$w,$s,$e,$N" "$cc-latest.osm.pbf" -O -o "$n.osm.pbf"
  printf '%s\n1\n %s %s\n %s %s\n %s %s\n %s %s\n %s %s\nEND\nEND\n' "$n" $w $s $e $s $e $N $w $N $w $s > "$n.poly"
done <<'L'
sweden Uppsala 17.53 59.80 17.75 59.91
sweden Vasteras 16.43 59.57 16.65 59.66
sweden Orebro 15.10 59.22 15.31 59.32
sweden Linkoping 15.52 58.37 15.72 58.44
sweden Helsingborg 12.65 56.00 12.78 56.09
sweden Lund 13.13 55.67 13.25 55.74
sweden Norrkoping 16.08 58.55 16.27 58.63
sweden Jonkoping 14.08 57.74 14.25 57.81
sweden Umea 20.17 63.80 20.35 63.85
italy Rome 12.42 41.85 12.57 41.95
italy Milan 9.10 45.42 9.28 45.51
italy Naples 14.19 40.81 14.33 40.89
greece Athens 23.66 37.93 23.80 38.04
spain Valencia -0.44 39.43 -0.31 39.51
spain Seville -6.05 37.35 -5.92 37.43
romania Bucharest 26.02 44.38 26.19 44.48
lithuania Vilnius 25.19 54.65 25.36 54.73
L
for f in *.osm.pbf; do
  n=${f%.osm.pbf}; case $n in *-latest) continue;; esac
  [ -s "$n.opl" ] && [ "$n.opl" -nt "$f" ] && continue
  osmium tags-filter "$f" w/building w/building:part r/building -O -o "/tmp/$n.pbf"
  osmium add-locations-to-ways "/tmp/$n.pbf" -O -f opl,add_metadata=false -o "$n.opl.part" && mv "$n.opl.part" "$n.opl"
  rm -f "/tmp/$n.pbf"; echo "$n $(wc -l < "$n.opl")"
done
