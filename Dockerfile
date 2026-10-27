# SunPeek — statik uygulama, root olmayan nginx.
# 1) derleme: modül adlarına içerik özeti (Cloudflare .js'i saatlerce önbellekler), E2E test kancası üretimden çıkar
FROM node:22-alpine AS build
# E2E=1 yalnız test imajı içindir: test kancası (window.__sp) kalır
ARG E2E=0
# ESRI_KEY: ArcGIS Location Platform API anahtarı (sunucunun .env'inden); repoda tutulmaz
ARG ESRI_KEY=
WORKDIR /w
COPY index.html app.js sun.js i18n.js tiles.js tz.js cache.js og.jpg privacy.html terms.html privacy.sv.html privacy.tr.html privacy.de.html privacy.es.html privacy.fr.html terms.sv.html terms.tr.html terms.de.html terms.es.html terms.fr.html legal.css llms.txt robots.txt manifest.webmanifest seo.mjs icons/ ./
RUN set -eu; \
    if [ "$E2E" != 1 ]; then sed -i '/window.__sp = /d' app.js; ! grep -q '__sp' app.js; fi; \
    if [ -n "$ESRI_KEY" ]; then sed -i "s#'__ESRI_KEY__'#'$ESRI_KEY'#g" app.js; grep -q "$ESRI_KEY" app.js; fi; \
    for f in sun.js i18n.js tiles.js tz.js cache.js; do v=$(sha1sum "$f" | cut -c1-10); sed -i "s#'./$f'#'./$f?v=$v'#" app.js; grep -q "$f?v=$v" app.js; done; \
    v=$(sha1sum app.js | cut -c1-10); sed -i "s#\"/app.js\"#\"/app.js?v=$v\"#" index.html; grep -q "app.js?v=$v" index.html; \
    node seo.mjs . && rm seo.mjs

# Cloudflare Workers'a yüklenen statik paket: docker buildx build --target static -o dist .
FROM scratch AS static
COPY --from=build /w/ /
COPY _headers /

# 2) çalışma: yetkisiz kullanıcıyla 8080'de nginx
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /w/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
