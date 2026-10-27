# SunPeek paylaşılan önbellek API'si. Derleme bağlamı depo kökü (tiles.js istemciyle ortak).
FROM node:22-alpine
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY api/server.js api/prewarm.mjs api/import.mjs api/gba-import.mjs api/gba-spatial.mjs ./
COPY api/migrations ./migrations
COPY tiles.js /app/tiles.js
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8081/api/health || exit 1
CMD ["node", "server.js"]
