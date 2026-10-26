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
# BBBike'ta olmayan İsveç şehirleri: merkez ±~6 km kutu (ad, batı, güney, doğu, kuzey)
if [ -s sweden-latest.osm.pbf ]; then
  while read -r n w s e N; do
    [ -s "$n.osm.pbf" ] || osmium extract -s smart -b "$w,$s,$e,$N" sweden-latest.osm.pbf -O -o "$n.osm.pbf"
    printf '%s\n1\n %s %s\n %s %s\n %s %s\n %s %s\n %s %s\nEND\nEND\n' "$n" $w $s $e $s $e $N $w $N $w $s > "$n.poly"
  done <<'L'
Uppsala 17.53 59.80 17.75 59.91
Vasteras 16.43 59.57 16.65 59.66
Orebro 15.10 59.22 15.31 59.32
Linkoping 15.52 58.37 15.72 58.44
Helsingborg 12.65 56.00 12.78 56.09
Lund 13.13 55.67 13.25 55.74
Norrkoping 16.08 58.55 16.27 58.63
Jonkoping 14.08 57.74 14.25 57.81
Umea 20.17 63.80 20.35 63.85
L
fi
for f in *.osm.pbf; do
  n=${f%.osm.pbf}; [ "$n" = sweden-latest ] && continue
  [ -s "$n.opl" ] && [ "$n.opl" -nt "$f" ] && continue
  osmium tags-filter "$f" w/building w/building:part r/building -O -o "/tmp/$n.pbf"
  osmium add-locations-to-ways "/tmp/$n.pbf" -O -f opl,add_metadata=false -o "$n.opl.part" && mv "$n.opl.part" "$n.opl"
  rm -f "/tmp/$n.pbf"; echo "$n $(wc -l < "$n.opl")"
done
