# SunPeek

**→ [sunpeek.uk](https://sunpeek.uk)**

**How much direct sun does this facade get?** Tap a building wall on the map, or point your phone at it, and SunPeek tells you how many hours of direct sun it gets today, at midsummer and at midwinter, with the exact time windows. It is built for house hunting: *does that balcony get afternoon sun in winter?*

<img src="docs/screenshot.png" width="320" alt="SunPeek on a phone: rays coloured by sun/shade, season buttons, compass arrow and sky plot">

## Features

- **Search** an address (OpenStreetMap Nominatim) or paste `lat, lon`. Tapping anywhere else on the map moves your position there and centres the map; **Back to my location** appears once you're more than 30 m from your GPS fix.
- **Light and dark mode** follow the system setting; flat icon set, 44 px touch targets.
- **Tap a wall, get the answer:** today / summer / winter hours as big tiles, time windows below. Tapping open ground (or dragging the pin) moves your own position.
- **Facade sun hours** for the selected day, summer solstice and winter solstice, with time windows (e.g. `13:40–18:10`).
- **Shadows from surrounding buildings** (OpenStreetMap footprints and heights, multipolygons and building parts), using exact ray–polygon intersection up to 400 m.
- **Sloping ground and distant hills.** Building base elevation and a horizon profile (600 m – 8 km) come from the Copernicus GLO-90 elevation model.
- **Floor / window height**, with an optional estimate from GPS altitude and a ❗ warning when the floor doesn't fit the building.
- **Compass mode:** the map rotates with the phone, a "house I'm facing" picker, and wall-based compass calibration that covers magnetic declination and device error.
- **Season buttons** (spring/summer/autumn/winter, hemisphere-aware) and **▶ day animation**.
- **Sky plot** with the day's sun path, the horizon profile and the facade plane.
- **Local time of the place**, not of your browser: the time zone is looked up per location, so checking a flat in another country gives correct times.
- **History** of checked facades, kept on the device (localStorage).
- **Height confidence ❗:** when most buildings that could shade the selected spot have no height in OpenStreetMap, a ❗ appears on the map; tapping it explains what was assumed and links to OpenStreetMap to fix it.
- **First-run card** explaining each permission and why it's needed, before the browser asks. Reopen it any time with ℹ️.
- **Retry:** if a data service doesn't respond, the app says so, offers ↻ Try again and retries once by itself. Successful downloads are cached on the device.
- **Languages:** English, Svenska, Türkçe, Deutsch, Español, Français, picked automatically from the browser and switchable in the panel.

## How it works

Everything runs in the browser. There is no backend and no build step.

| What | Source |
|---|---|
| Sun position, sunrise/sunset, solar noon | NOAA solar calculator algorithm with Bennett refraction (`sun.js`) |
| Buildings | OpenStreetMap via the Overpass API |
| Ground elevation, horizon | Copernicus GLO-90 via the Open-Meteo elevation API |
| Time zone of the location | Open-Meteo (`timezone=auto`) |
| Addresses in history | Nominatim reverse geocoding (one request per saved facade) |
| Imagery | Esri World Imagery |
| Map | Leaflet + leaflet-rotate |
| Address search | Nominatim (on submit only, per its usage policy) |
| Icons | [Lucide](https://lucide.dev) (ISC License), inlined as an SVG sprite |

A facade is blocked by a building when the sun ray enters that building's footprint below its top: `height + base elevation − window height > distance × tan(sun elevation)`. A facade is blocked by terrain when the sun is below the horizon profile in that direction. When the sun is more than 85° off the facade normal, it counts as "behind" the facade.

## Accuracy and limits

- **Building heights are the main source of error.** Where OSM has no `height` / `building:levels`, a type-based default is used. If at least 10 buildings nearby do have heights, their median is used instead. Coverage varies a lot by country. Share of buildings with a height or level tag within 400 m, measured October 2026:

  | Area | Buildings | With height/levels |
  |---|---|---|
  | Stockholm, Södermalm | 332 | 93 % |
  | Berlin, Prenzlauer Berg | 525 | 83 % |
  | Madrid, Chamberí | 520 | 31 % |
  | Malmö | 202 | 26 % |
  | Valencia | 712 | 21 % |
  | Barcelona, Eixample | 774 | 14 % |
  | İstanbul, Kadıköy | 1791 | 6 % |
  | İzmir, Karşıyaka | 899 | 0.2 % |

  Where coverage is low, shadows from tall blocks are likely underestimated. Dashed outlines on the map mark estimated heights. Adding `building:levels` in OpenStreetMap improves results for everyone.
- **Trees are not modelled.**
- The elevation model has 90 m resolution and includes vegetation and buildings, so the horizon starts at 600 m to avoid counting nearby buildings twice.
- **Phone compasses** can be off by 10–15° near steel and concrete. Use tap-to-pick for the facade and calibrate against a wall.
- **GPS altitude** is often off by 10–30 m, and some Android devices report ellipsoidal height. The floor estimate is only a suggestion.

## Run locally

Geolocation and the compass need a secure context, and `localhost` counts as one.

```sh
python3 -m http.server 8765
# open http://localhost:8765
```

Tests (Node 20+):

```sh
node test.mjs
```

They check the sun position against an independent NOAA implementation and published sunrise/sunset times, the shadow and terrain logic, time zones, height confidence, and that every language has every key and placeholder.

End-to-end tests (`e2e/run.js`, 17 scenarios / ~120 checks) drive the real app in a phone-sized iframe: first-run card, all six languages, tapping walls and open ground (map recentres), address search, back to my location, seasons and day animation (both hemispheres), polar night, compass and calibration, floor stepper and warning, touch-target sizes and aria-labels, the ❗ card, history, offline + retry, language switch and desktop layout. With the local server running, open any page on `http://localhost:8765`, evaluate `e2e/run.js` in the console, then `await E2E.run('tapping')` (names in `E2E.names`). They use live data services, so the first run is slow.

## Permissions on phones

| Permission | Why | Without it |
|---|---|---|
| 📍 Location | Puts you on the map; optional floor estimate from GPS altitude | Tap the map or type coordinates |
| 🧭 Motion & orientation | Rotates the map with the phone, finds the house you're facing | Map stays north-up; tap walls instead |

On iPhone the compass permission is asked when you tap **Allow & start** (or the arrow at the top). If you denied it, reload the page and tap the arrow. Location on iPhone: Settings › Privacy & Security › Location Services › Safari Websites.

## Privacy

There is no account and no server-side storage. History and settings stay in your browser's localStorage. To fetch data, the browser sends the selected coordinates to Overpass, Open-Meteo, Nominatim and Esri.

## License

All rights reserved. The source is published for reference. Contact the author for any other use.

Third-party: icons from [Lucide](https://lucide.dev) — ISC License, Copyright (c) Lucide Icons and Contributors.
