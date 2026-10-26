// SunPeek paylaşılan bina önbelleği. Bir kullanıcının indirdiği bölge diğerine anında gelir.
// GET /api/cells?k=i:j,i:j  → { cells: { "i:j": [OSM öğeleri] }, missing: ["i:j"] }
//   Taze (<90 gün) hücreler veritabanından; eksikleri sunucu Overpass'tan kendisi çeker ve saklar.
//   İstemci hiçbir zaman veri yazmaz (önbellek zehirlenemez). Bayat hücre hemen döner, arka planda yenilenir.
// GET /api/health → 200 "ok"
// IP ya da kullanıcı bilgisi saklanmaz; yalnız hücre kimlikleri (~550 m) gelir.
import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { overtureTile, OVERTURE } from '../tiles.js'; // istemciyle aynı okuyucu

const DAY = 864e5;
// Bina dışı önbellek: kaynak → [TTL gün, günlük bütçe]. Arazi durağan; Overture anahtarı sürümü içerir; ışınım anahtarı yılları içerir.
const TTL = { terrain: 365, overture: 60, irr: 400, search: 30, reverse: 90 }, KV_PREFIX = { overture: 'ovt:', irr: 'irr:', search: 's:', reverse: 'r:' }, LIMIT = { terrain: 20000, overture: 5000, irr: 1000, search: 3000, reverse: 3000 };
const PHOTON = process.env.PHOTON_URL ?? 'https://photon.komoot.io', NOMINATIM = process.env.NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org', TERRAIN = process.env.TERRAIN_URL ?? 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const ARCHIVE = process.env.ARCHIVE_URL ?? 'https://archive-api.open-meteo.com/v1/archive';
export const CELL = 0.005, TTL_DAYS = 90, MAX_CELLS = 40, MAX_SPAN = 6;
// Sunucu herkes adına tek IP'den Overpass'a gider: günlük çekim bütçesi (aşılırsa istemci kendi yedeğine geçer) ve
// eksik hücre için en çok WAIT ms beklenir; sonra yanıt döner, çekim arka planda sürer (sonraki kullanıcıya hazır olur).
const BUDGET = +(process.env.OVERPASS_DAILY_BUDGET ?? 3000), WAIT = +(process.env.MISS_WAIT_MS ?? 8000);
const UA = 'SunPeek/1.0 (+https://sunpeek.uk)';
const OVERPASS = (process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass.private.coffee/api/interpreter').split(',');

export function createServer(sql, { log = console } = {}) {
  // Versiyonlu göçler: migrations/NNN_*.sql sırayla, tek işlemde, danışma kilidiyle (birden çok kopya aynı anda başlarsa)
  async function migrate() {
    await sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(54210)`;
      await tx`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
      const done = new Set((await tx`select version from schema_migrations`).map(r => r.version));
      const dir = new URL('./migrations/', import.meta.url);
      for (const f of (await readdir(dir)).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
        if (done.has(f)) continue;
        await tx.unsafe(await readFile(new URL(f, dir), 'utf8'));
        await tx`insert into schema_migrations (version) values (${f})`;
        log.info?.(`migration ${f} applied`);
      }
    });
  }

  // Overpass: tek kutu sorgusu, aynalar sırayla; en çok 2 eşzamanlı istek (paylaşılan sunucuyu yormamak için)
  let active = 0; const queue = [];
  const slot = () => new Promise(r => active < 2 ? (active++, r()) : queue.push(r));
  const free = () => { const n = queue.shift(); n ? n() : active--; };
  let spent = 0, day = new Date().toDateString();
  async function overpass([s, w, n, e]) {
    if (day !== new Date().toDateString()) { day = new Date().toDateString(); spent = 0; }
    if (++spent > BUDGET) throw new Error('daily Overpass budget used');
    const a = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`;
    const q = `[out:json][timeout:60];(way(${a})["building"];way(${a})["building:part"];relation(${a})["building"];);out tags geom;`;
    await slot();
    try {
      let err;
      for (const url of OVERPASS) {
        try {
          const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(65000) });
          if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
          const j = await r.json();
          if (j.remark || !Array.isArray(j.elements)) throw new Error(`${new URL(url).host} incomplete: ${String(j.remark).slice(0, 80)}`); // kısmi yanıt saklanmaz
          return j.elements;
        } catch (e) { err = e; log.warn?.(`overpass ${e.message}`); }
      }
      throw err;
    } finally { free(); }
  }

  // Aynı hücre için eşzamanlı istekler tek Overpass çağrısında birleşir
  const inflight = new Map();
  async function fetchCells(keys) {
    const todo = keys.filter(k => !inflight.has(k));
    if (todo.length) {
      const ij = todo.map(k => k.split(':').map(Number)), is = ij.map(x => x[0]), js = ij.map(x => x[1]);
      const p = (async () => {
        const el = await overpass([Math.min(...is) * CELL, Math.min(...js) * CELL, (Math.max(...is) + 1) * CELL, (Math.max(...js) + 1) * CELL]);
        const by = new Map(todo.map(k => [k, []]));
        for (const e of el) { const g = e.geometry?.[0] ?? e.members?.find(m => m.geometry)?.geometry?.[0]; if (!g) continue;
          by.get(`${Math.floor(g.lat / CELL)}:${Math.floor(g.lon / CELL)}`)?.push(e); }
        for (const [k, v] of by) { const [i, j] = k.split(':').map(Number);
          await sql`insert into cells (i, j, fetched_at, data) values (${i}, ${j}, now(), ${sql.json(v)})
                    on conflict (i, j) do update set fetched_at = excluded.fetched_at, data = excluded.data`; }
        return by;
      })();
      for (const k of todo) inflight.set(k, p);
      p.catch(() => {}).finally(() => { for (const k of todo) if (inflight.get(k) === p) inflight.delete(k); });
    }
    const out = new Map();
    for (const p of new Set(keys.map(k => inflight.get(k)))) for (const [k, v] of await p) if (keys.includes(k)) out.set(k, v);
    return out;
  }

  function parse(q) {
    const keys = [...new Set(String(q ?? '').split(',').filter(Boolean))];
    if (!keys.length || keys.length > MAX_CELLS || !keys.every(k => /^-?\d{1,5}:-?\d{1,5}$/.test(k))) return null;
    const ij = keys.map(k => k.split(':').map(Number));
    if (ij.some(([i, j]) => Math.abs(i * CELL) > 90 || Math.abs(j * CELL) > 180)) return null;
    const span = f => Math.max(...ij.map(f)) - Math.min(...ij.map(f));
    if (span(x => x[0]) > MAX_SPAN || span(x => x[1]) > MAX_SPAN) return null; // tek bir bölge olmalı (Overpass'ı dev kutuyla yormasın)
    return keys;
  }

  let osmDownUntil = 0;
  async function cells(keys) {
    const ij = keys.map(k => k.split(':').map(Number));
    const rows = await sql`select c.i, c.j, c.data, c.fetched_at > now() - make_interval(days => ${TTL_DAYS}) as fresh
      from cells c join unnest(${ij.map(x => x[0])}::int[], ${ij.map(x => x[1])}::int[]) as k(i, j) on c.i = k.i and c.j = k.j`;
    const found = new Map(rows.map(r => [`${r.i}:${r.j}`, r]));
    const stale = [...found].filter(([, r]) => !r.fresh).map(([k]) => k), missing = keys.filter(k => !found.has(k));
    if (stale.length) fetchCells(stale).catch(e => log.warn?.(`refresh ${e.message}`)); // arka planda tazele
    const out = Object.fromEntries([...found].map(([k, r]) => [k, r.data]));
    let still = [];
    if (missing.length) {
      // devre kesici: Overpass son 10 dakikada çöktüyse beklemeden "eksik" denir, istemci hemen yedeğe geçer (çekim arka planda sürer)
      const job = fetchCells(missing); job.then(() => { osmDownUntil = 0; }, e => { osmDownUntil = Date.now() + 600000; log.warn?.(`fetch ${e.message}`); });
      const got = await Promise.race([job.catch(() => null), new Promise(r => setTimeout(r, Date.now() < osmDownUntil ? 0 : WAIT, null))]);
      if (got) for (const [k, v] of got) out[k] = v;
      still = missing.filter(k => !(k in out)); // gelmeyenler: istemci kendi yedeğine geçer, sunucu çekmeye devam eder
    }
    return { cells: out, missing: still };
  }

  // Kaynak başına günlük bütçe (sunucu tek IP'den herkes adına gider) ve aynı anahtar için tek eşzamanlı çekim
  const used = {}; let usedDay = '';
  const spend = src => { const d = new Date().toDateString(); if (d !== usedDay) { usedDay = d; for (const k in used) used[k] = 0; } if ((used[src] = (used[src] ?? 0) + 1) > LIMIT[src]) throw new Error(`daily ${src} budget used`); };
  const once = new Map();
  const single = (key, fn) => { if (!once.has(key)) once.set(key, fn().finally(() => once.delete(key))); return once.get(key); };
  async function cachedJSON(src, key, fn) {
    const [hit] = await sql`select value, fetched_at > now() - make_interval(days => ${TTL[src]}) as fresh from kv where key = ${key}`;
    if (hit?.fresh) return hit.value;
    try { return await single(key, async () => { spend(src); const v = await fn(); await sql`insert into kv (key, value) values (${key}, ${sql.json(v)}) on conflict (key) do update set value = excluded.value, fetched_at = now()`; return v; }); }
    catch (e) { if (hit) return hit.value; throw e; } // kaynak yoksa bayat kayıt yine işe yarar
  }
  async function cachedBlob(src, key, url) {
    const [hit] = await sql`select content_type, body, fetched_at > now() - make_interval(days => ${TTL[src]}) as fresh from blobs where key = ${key}`;
    if (hit?.fresh) return hit;
    try { return await single(key, async () => {
      spend(src); const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`${src} HTTP ${r.status}`);
      const v = { content_type: r.headers.get('content-type') ?? 'application/octet-stream', body: Buffer.from(await r.arrayBuffer()) };
      await sql`insert into blobs (key, content_type, body) values (${key}, ${v.content_type}, ${v.body}) on conflict (key) do update set body = excluded.body, content_type = excluded.content_type, fetched_at = now()`;
      return v; }); }
    catch (e) { if (hit) return hit; throw e; }
  }
  // Adres: Photon (komoot) ana kaynak, Nominatim yedek. Nominatim kullanım koşulu uygulama genelinde en çok 1 istek/sn:
  // bütün istemciler bu tek sıradan geçer (tarayıcı Nominatim'e doğrudan gitmez); sıra 5 sn'yi aşarsa istek hemen reddedilir.
  let nomNext = 0;
  async function nominatim(path) {
    const wait = Math.max(0, nomNext - Date.now());
    if (wait > 5000) throw new Error('nominatim busy');
    nomNext = Math.max(Date.now(), nomNext) + 1100;
    if (wait) await new Promise(r => setTimeout(r, wait));
    const r = await fetch(NOMINATIM + path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`nominatim HTTP ${r.status}`);
    return r.json();
  }
  async function photonJSON(path) {
    const r = await fetch(PHOTON + path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`photon HTTP ${r.status}`);
    return (await r.json()).features ?? [];
  }
  const PH_LANG = new Set(['en', 'de', 'fr']); // Photon'un desteklediği diller; diğerlerinde yerel ad
  // Photon sonuçları Nominatim biçimine çevrilir: istemci tek biçim görür
  const phSearch = f => { const p = f.properties ?? {}, [lon, lat] = f.geometry?.coordinates ?? [];
    return { lat: String(lat), lon: String(lon), osm_type: { W: 'way', R: 'relation', N: 'node' }[p.osm_type], osm_id: p.osm_id,
      display_name: [[p.name, [p.street, p.housenumber].filter(Boolean).join(' ')].filter(Boolean).join(', '), p.city ?? p.town ?? p.village, p.country].filter(Boolean).join(', ') }; };
  const phAddr = f => { const p = f?.properties ?? {}; return { address: { road: p.street ?? (p.housenumber ? p.name : undefined), house_number: p.housenumber, city: p.city ?? p.town ?? p.village ?? p.district } }; };
  const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  const LANGS = new Set(['en', 'sv', 'tr', 'de', 'es', 'fr']);
  const routes = {
    // /api/terrain/13/4367/2480.png — AWS Terrain Tiles (terrarium) PNG
    async terrain(m, send, raw) {
      const z = int(m[1], 0, 15), x = int(m[2], 0, 2 ** 15), y = int(m[3], 0, 2 ** 15);
      if (z == null || x == null || y == null || x >= 2 ** z || y >= 2 ** z) return send(400, { error: 'bad tile' });
      const b = await cachedBlob('terrain', `tr:${z}/${x}/${y}`, `${TERRAIN}/${z}/${x}/${y}.png`);
      raw(b.content_type, b.body);
    },
    // /api/overture/14/8740/5121 — Overture binaları (çözülmüş, Overpass biçiminde)
    async overture(m, send) {
      const z = int(m[1], 10, 14), x = int(m[2], 0, 2 ** 14), y = int(m[3], 0, 2 ** 14);
      if (z == null || x == null || y == null || x >= 2 ** z || y >= 2 ** z) return send(400, { error: 'bad tile' });
      send(200, await cachedJSON('overture', `ovt:${OVERTURE.split('/').at(-2)}:${z}/${x}/${y}`, () => overtureTile(z, x, y, AbortSignal.timeout(30000))));
    },
    // /api/irr?lat=57.7&lon=11.9&y1=2023&y2=2025 — Open-Meteo arşivi, saatlik DNI/DHI (0,1° hücre)
    async irr(m, send, raw, u) {
      const lat = Math.round(+u.searchParams.get('lat') * 10) / 10, lon = Math.round(+u.searchParams.get('lon') * 10) / 10;
      const y1 = int(u.searchParams.get('y1'), 1950, 2100), y2 = int(u.searchParams.get('y2'), 1950, 2100);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || y1 == null || y2 == null || y2 < y1 || y2 - y1 > 4) return send(400, { error: 'bad irr' });
      send(200, await cachedJSON('irr', `irr:${y1}-${y2}:${lat.toFixed(1)},${lon.toFixed(1)}`, async () => {
        const r = await fetch(`${ARCHIVE}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start_date=${y1}-01-01&end_date=${y2}-12-31&hourly=direct_normal_irradiance,diffuse_radiation&timezone=GMT&timeformat=unixtime`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`archive HTTP ${r.status}`);
        const h = (await r.json()).hourly;
        if (!h?.time?.length) throw new Error('archive empty');
        return { t0: h.time[0] * 1000, dni: h.direct_normal_irradiance.map(v => Math.round(v || 0)), dhi: h.diffuse_radiation.map(v => Math.round(v || 0)) };
      }));
    },
    // /api/search?q=...&lang=tr — Nominatim arama (normalize edilmiş metin anahtarıyla)
    async search(m, send, raw, u) {
      const q = String(u.searchParams.get('q') ?? '').trim().replace(/\s+/g, ' ').slice(0, 200), lang = LANGS.has(u.searchParams.get('lang')) ? u.searchParams.get('lang') : 'en';
      if (q.length < 2) return send(400, { error: 'bad query' });
      send(200, await cachedJSON('search', `s:${lang}:${q.toLowerCase()}`, async () => {
        try { const r = (await photonJSON(`/api/?limit=5&q=${encodeURIComponent(q)}${PH_LANG.has(lang) ? '&lang=' + lang : ''}`)).map(phSearch); if (r.length) return r; } catch (e) { log.warn?.(e.message); }
        return nominatim(`/search?format=jsonv2&limit=5&accept-language=${lang}&q=${encodeURIComponent(q)}`);
      }));
    },
    // /api/reverse?lat=..&lon=..&lang=tr — Nominatim adres çözme (~1 m'ye yuvarlanmış)
    async reverse(m, send, raw, u) {
      const lat = +(+u.searchParams.get('lat')).toFixed(5), lon = +(+u.searchParams.get('lon')).toFixed(5), lang = LANGS.has(u.searchParams.get('lang')) ? u.searchParams.get('lang') : 'en';
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return send(400, { error: 'bad point' });
      send(200, await cachedJSON('reverse', `r:${lang}:${lat},${lon}`, async () => {
        try { const [f] = await photonJSON(`/reverse?lat=${lat}&lon=${lon}&limit=1${PH_LANG.has(lang) ? '&lang=' + lang : ''}`); const a = phAddr(f); if (a.address.road) return a; } catch (e) { log.warn?.(e.message); }
        return nominatim(`/reverse?format=jsonv2&zoom=18&accept-language=${lang}&lat=${lat}&lon=${lon}`);
      }));
    },
  };
  const ROUTES = [[/^\/api\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/, 'terrain'], [/^\/api\/overture\/(\d+)\/(\d+)\/(\d+)$/, 'overture'],
    [/^\/api\/irr$/, 'irr'], [/^\/api\/search$/, 'search'], [/^\/api\/reverse$/, 'reverse']];

  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    try {
      const u = new URL(req.url, 'http://x');
      if (req.method !== 'GET') return send(405, { error: 'method' });
      if (u.pathname === '/api/health') { await sql`select 1`; return send(200, 'ok', 'text/plain'); }
      if (u.pathname === '/api/cells') { const keys = parse(u.searchParams.get('k')); return keys ? send(200, await cells(keys)) : send(400, { error: 'bad cells' }); }
      const raw = (type, body) => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
      for (const [re, name] of ROUTES) { const m = u.pathname.match(re); if (m) return await routes[name](m, send, raw, u); }
      send(404, { error: 'not found' });
    } catch (e) { log.warn?.(e.message); if (!res.headersSent) send(502, { error: 'upstream' }); }
  });
  const purge = () => Promise.all([
    sql`delete from cells where fetched_at < now() - make_interval(days => ${TTL_DAYS})`,
    // her kaynak kendi süresiyle (arama 30 gün, adres 90 gün); önce en uzun süre kullanılıyordu, aramalar 400 gün kalıyordu
    ...Object.entries(KV_PREFIX).map(([src, pre]) => sql`delete from kv where key like ${pre + '%'} and fetched_at < now() - make_interval(days => ${TTL[src]})`),
    sql`delete from blobs where fetched_at < now() - make_interval(days => ${TTL.terrain})`]).catch(e => log.warn?.(`purge ${e.message}`));
  return { server, migrate, purge };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = postgres(process.env.DATABASE_URL, { max: 5, onnotice: () => {} });
  const { server, migrate, purge } = createServer(sql);
  for (let n = 0; ; n++) { try { await migrate(); break; } catch (e) { if (n > 20) throw e; console.warn('db not ready', e.message); await new Promise(r => setTimeout(r, 3000)); } }
  purge(); setInterval(purge, 864e5); // günlük: 90 günden eski hücreler silinir
  server.listen(+(process.env.PORT ?? 8081), () => console.log('sunpeek-api listening'));
  for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => server.close(() => sql.end().then(() => process.exit(0))));
}
