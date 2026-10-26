# SunPeek

**→ [sunpeek.uk](https://sunpeek.uk)**

**How much direct sun does this wall get?** Search an address or tap a building wall on the map, and SunPeek tells you how many hours of direct sun it gets today, at midsummer and at midwinter, with the exact time windows and a confidence range. It is built for house hunting: *does that balcony get afternoon sun in winter?*

<img src="docs/screenshot.png" width="320" alt="SunPeek on a phone: rays coloured by sun/shade, season buttons, floor picker and result tiles">

## What you get

- **The answer first:** today / summer / winter hours as big tiles, the time windows below, and a **confidence chip** ("Confidence: medium · 4 h 56 m – 7 h 53 m"). Tap it to see the range for each day and what was assumed.
- **Your floor, front and centre.** The selected wall (direction and address) and the floor picker sit above the result; floor 0 reads "ground floor". SunPeek also finds the **first floor with no shadow from other buildings**, so it tells you when a higher floor would make no difference.
- **Rays with a key:** green and red hourly rays from the wall, with a small "sun reaches / building blocks" key on the map.
- **Shadows you can see:** a map layer draws every building's shadow at the selected time; the buildings that shade the selected wall during the day are outlined red, the one shading it right now is filled.
- **Seasons and time:** season buttons (hemisphere-aware), a time slider, a day animation, and the sky plot with the sun's path, the horizon and the wall.
- **Search or tap:** address search (or `lat, lon`); searching picks the building and its most sun-facing long wall automatically. Links of the form `https://sunpeek.uk/?at=57.6889,11.9223` open straight on that wall.
- **Phone compass:** the map rotates with the phone, and a "house I'm facing" picker finds the wall in front of you.
- **Solar energy (optional, folded away):** angle of incidence, clear-sky energy per m², and a conservative yearly range per installed kWp from three years of measured sunshine, including the share of an average EU household's electricity.
- **Honest about uncertainty:** a warning when most nearby building heights are unknown, the confidence range above, and short notes kept in (i) tips so the screen stays light.
- **Local time of the place**, 12/24-hour setting, six languages (English, Svenska, Türkçe, Deutsch, Español, Français), light and dark mode.

## How it works

The calculation runs in the browser; a small shared cache on the server makes data arrive faster for everyone.

| What | Source (primary → backup) |
|---|---|
| Sun position, sunrise/sunset | NOAA solar algorithm with Bennett refraction (`sun.js`) |
| Buildings | SunPeek shared cache → OpenStreetMap via Overpass (mirrors) → Overture Maps building tiles |
| Ground elevation, distant hills | SunPeek cache → AWS Terrain Tiles (terrarium) → Open-Meteo (Copernicus GLO-90) |
| Time zone of the place | embedded [tz-lookup](https://github.com/photostructure/tz-lookup) (no request) → Open-Meteo |
| Address search / address of a saved wall | SunPeek cache → Nominatim → Photon (komoot) |
| Yearly sunshine for the solar estimate | SunPeek cache → Open-Meteo archive (3 years) |
| Imagery / map | Esri World Imagery, Leaflet + leaflet-rotate |
| Icons | [Lucide](https://lucide.dev) (ISC), inlined |

**Shadows.** A wall is in a building's shadow when the sun ray from the window enters that building below its top: `distance × tan(sun elevation) < height + base elevation − window height` (above any `min_height`). Only buildings in front of the wall within 600 m are considered, using their nearest corner. A wall is in terrain shadow when the sun is below the horizon profile (600 m – 8 km, Earth curvature and refraction included). The sun counts as on the wall while it is less than 90° off the wall's normal. Sunlight windows are found on a 5-minute grid and every sun/shade transition is then refined to about 20 seconds.

**Building heights.** Measured `height` first, then `building:levels` × 3 m (or the building's own storey height when both are tagged), then the median of nearby buildings of the same type (at least three, never lowering apartments below their default), then a type default. `building:part` replaces its outline only when the parts cover most of it.

**Confidence.** Every height carries an uncertainty by source: measured ±1.5 m, from floors ±(1 + 0.3 × floors) m, neighbourhood median ±35 %, type default ±45 %. The range is the lowest and highest direct sun over four corners: all surrounding buildings at the tall or the low edge, with the window 0.5 m lower or higher (raising the window can *reduce* sun under overhangs, so no direction is assumed). Confidence = 100 × (1 − range / 2 h), clamped to 0–100: high ≥ 75, medium ≥ 45. It measures how stable the answer is against the data we have, not the chance of being right: **trees and buildings missing from the map are not included.**

## Data, storage and privacy

- **On your device:** history and settings (localStorage); map data in IndexedDB — building cells (~550 m) 90 days, terrain tiles one year; stale data is shown at once and refreshed in the background.
- **SunPeek's shared cache (server):** receives only what is needed to fetch map data — area cell ids (~550 m), map tile numbers, the ~10 km cell for sunshine data, your search text and, for saved walls, the wall's coordinates to look up its address. It stores the public map data it fetched (buildings 90 days, terrain one year, searches 30 days). **No IP address, account or history is stored**, and the server never accepts data from browsers, so the cache cannot be poisoned.
- **Third parties:** if the cache cannot answer, the browser asks the sources above directly. The data card in the app (*More › SunPeek cache …*) shows every service and how many requests went to each.

## Accuracy and limits

- **Building heights are the main source of error.** OSM height coverage within 400 m, measured October 2026: Stockholm Södermalm 93 %, Berlin Prenzlauer Berg 83 %, Madrid Chamberí 31 %, Malmö 26 %, Valencia 21 %, Barcelona Eixample 14 %, İstanbul Kadıköy 6 %, İzmir Karşıyaka 0.2 %. Overture Maps adds heights in some places. Adding `building:levels` in OpenStreetMap improves results for everyone.
- **Trees, balconies, eaves and roof shapes are not modelled** (buildings are flat-topped prisms).
- Terrain tiles are bare earth at ~15 m (near) and ~60 m (far); hills closer than 600 m come from the ground grid.
- Phone compasses can be off by 10–15° near steel and concrete; GPS altitude by 10–30 m, so the floor estimate is only a suggestion.

## Run it

```sh
python3 -m http.server 8765                 # the app alone (no shared cache; falls back to the sources directly)
# full stack: web + cache API + PostgreSQL, test hook on, http://localhost:8090/?e2e
docker network create proxy_network 2>/dev/null
PG_PASSWORD=test docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
```

Production uses `docker-compose.yml` alone: `sunpeek` (nginx-unprivileged, static files, `/api/` proxied), `sunpeek-api` (Node 22, `api/server.js`), `sunpeek-db` (PostgreSQL 17 on an internal network, named volume) and `sunpeek-probe` (checks every data source every 10 minutes and logs failures). Database migrations are versioned SQL files in `api/migrations`, applied in order at start-up. All containers run read-only where possible, with `cap_drop: ALL` and `no-new-privileges`; nginx sends a strict CSP and security headers, rate-limits `/api/` per visitor and keeps no access log for it.

## Tests

```sh
node test.mjs                                   # math, shadows, heights, confidence, time zones, i18n
(cd api && DATABASE_URL=postgres://… node test.mjs)  # cache API against a real PostgreSQL and fake upstreams
sh e2e/smoke.sh                                 # headless Chrome: the app loads, places a point and draws
# end-to-end: open http://localhost:8090/?e2e in a browser, add <script src=/e2e/run.js>, then
#   await E2E_LOAD(); for (const n of E2E.names) console.log(n, await E2E.run(n))
```

The unit tests check the sun position against an independent NOAA implementation and published sunrise times, shadow and terrain logic, refined transition times (±30 s against a one-second scan), confidence ranges, building parts and `min_height`, the PMTiles tile ids and every language for missing keys. The end-to-end suite (22 scenarios) drives the real app: search and tapping, floors, seasons and polar night, compass, confidence card, history, offline and backup sources, the data card, languages, `?at=` links and the desktop layout. The deploy script runs the unit and smoke tests first.

## License

All rights reserved. The source is published for reference. Contact the author for any other use.

Third-party: icons from [Lucide](https://lucide.dev) — ISC License. Time-zone lookup from [@photostructure/tz-lookup](https://github.com/photostructure/tz-lookup) — CC0. Map data © OpenStreetMap contributors (ODbL), © Overture Maps Foundation.
