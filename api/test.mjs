// API testi: gerçek PostgreSQL (DATABASE_URL, boş bir test veritabanı) + sahte Overpass.
//   docker run -d --rm --name sp-pg -p 55432:5432 -e POSTGRES_PASSWORD=t postgres:17-alpine
//   DATABASE_URL=postgres://postgres:t@127.0.0.1:55432/postgres node test.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import postgres from 'postgres';

let hits = 0, mode = 'ok';
const fake = http.createServer((req, res) => {
  hits++;
  if (mode === 'down') { res.writeHead(502); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (mode === 'remark') return res.end(JSON.stringify({ elements: [], remark: 'runtime error: timeout' }));
  if (mode === 'slow') return setTimeout(() => res.end(JSON.stringify({ elements: [] })), 1500);
  // iki bina: biri 11904:2384 hücresinde (Ärlegatan), biri bitişik hücrede
  res.end(JSON.stringify({ elements: [
    { type: 'way', id: 1, tags: { building: 'apartments' }, geometry: [{ lat: 57.6889, lon: 11.9223 }, { lat: 57.6890, lon: 11.9223 }, { lat: 57.6890, lon: 11.9224 }, { lat: 57.6889, lon: 11.9223 }] },
    { type: 'way', id: 2, tags: { building: 'yes', height: '9' }, geometry: [{ lat: 57.6905, lon: 11.9223 }, { lat: 57.6906, lon: 11.9223 }, { lat: 57.6906, lon: 11.9224 }, { lat: 57.6905, lon: 11.9223 }] },
  ] }));
}).listen(0);
process.env.OVERPASS_URLS = `http://127.0.0.1:${fake.address().port}/`;
// Diğer kaynaklar için sahte sunucu: arazi PNG, ışınım arşivi, Nominatim
let up = 0, photonDown = false, nomHits = 0;
const up2 = http.createServer((req, res) => {
  up++; const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/photon/')) { // Photon: ana adres kaynağı (GeoJSON)
    if (photonDown) { res.writeHead(503); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ features: [{ geometry: { coordinates: [11.9223, 57.6889] }, properties: { street: 'Ärlegatan', housenumber: '40', city: 'Göteborg', osm_type: 'W', osm_id: 7 } }] }));
  }
  if (u.pathname === '/search' || u.pathname === '/reverse') nomHits++;
  if (u.pathname.startsWith('/terrarium/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from([137, 80, 78, 71])); }
  if (u.pathname === '/archive') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ hourly: { time: [1700000000], direct_normal_irradiance: [500.4], diffuse_radiation: [null] } })); }
  if (u.pathname === '/search') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([{ lat: '57.6889', lon: '11.9223', display_name: 'Ärlegatan 40' }])); }
  if (u.pathname === '/reverse') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ address: { road: 'Ärlegatan', house_number: '40' } })); }
  res.writeHead(404); res.end();
}).listen(0);
const U2 = `http://127.0.0.1:${up2.address().port}`;
process.env.TERRAIN_URL = U2 + '/terrarium'; process.env.ARCHIVE_URL = U2 + '/archive'; process.env.NOMINATIM_URL = U2; process.env.PHOTON_URL = U2 + '/photon';
process.env.MISS_WAIT_MS = '800';
const { createServer } = await import('./server.js');

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres:t@127.0.0.1:55432/postgres', { onnotice: () => {} });
await sql`drop table if exists cells, kv, blobs, feedback, stats, gba, floor_reports, osm_cells, osm_cells_new, osm_stage, osm_cover, schema_migrations`;
const quiet = { info() {}, warn() {}, error: console.error };
const { server, migrate, purge } = createServer(sql, { log: quiet });
await migrate(); await migrate(); // göç iki kez: ikincisi bir şey yapmamalı
assert.deepEqual((await sql`select version from schema_migrations`).map(r => r.version), ['001_cells.sql', '002_kv_blobs.sql', '003_feedback.sql', '004_osm_import.sql', '005_stats.sql', '006_gba.sql', '007_floors.sql']);

// 0. şehir içe aktarma (import.mjs): OPL → Overpass biçimi, ilk noktanın hücresi; alan içindeki boş hücre = [] (Overpass'a gidilmez)
const { importDir, polys } = await import('./import.mjs');
const fs = await import('node:fs'), os = await import('node:os'), dir = fs.mkdtempSync(os.tmpdir() + '/osm-');
fs.writeFileSync(dir + '/T.opl', [
  'w10 Tbuilding=yes,name=A%20%B%2c%C Nn1x11.0011y61.0011,n2x11.0012y61.0011,n3x11.0012y61.0012,n1x11.0011y61.0011',
  'w11 T Nn4x11.0061y61.0061,n5x11.0062y61.0061,n6x11.0062y61.0062,n4x11.0061y61.0061', // yalnız ilişki üyesi: tek başına yazılmaz
  'w12 Tbuilding:part=yes,height=12 Nn1x11.0011y61.0011,n2x11.0012y61.0011,n3x11.0012y61.0012,n1x11.0011y61.0011',
  'w13 Tbuilding=yes Nn7x y', // konumsuz düğüm: atlanır
  'r20 Tbuilding=yes,type=multipolygon Mw11@outer,w99@inner'].join('\n') + '\n');
fs.writeFileSync(dir + '/T.poly', 'T\n1\n 11.0 61.0\n 11.02 61.0\n 11.02 61.02\n 11.0 61.02\n 11.0 61.0\nEND\n!2\n 11.01 61.01\n 11.011 61.01\n 11.011 61.011\nEND\nEND\n');
assert.equal(polys(fs.readFileSync(dir + '/T.poly', 'utf8')).length, 1, 'delik bölümü alan sayılmaz');
await importDir(sql, dir, () => {}); const imp = await importDir(sql, dir, () => {}); // ikinci kez: tablo değişimi tekrarlanabilir
assert.deepEqual({ cells: imp.cells, els: imp.els }, { cells: 2, els: 3 });
server.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = async q => { const r = await fetch(base + q); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text(), cc: r.headers.get('cache-control') }; };

{ const h0 = hits, r0 = await get('/api/cells?k=12200:2200,12201:2201,12203:2203');
  const a = r0.body.cells['12200:2200'], w = a.find(e => e.id === 10);
  assert.deepEqual(r0.body.missing, []); assert.equal(hits, h0, 'içe aktarılan alanda Overpass yok');
  assert.equal(a.length, 2); assert.equal(w.tags.name, 'A B,C'); assert.deepEqual(w.geometry[0], { lat: 61.0011, lon: 11.0011 }); assert.equal(w.type, 'way');
  const rel = r0.body.cells['12201:2201'][0]; assert.equal(rel.type, 'relation'); assert.deepEqual(rel.members.map(m => [m.ref, m.role]), [[11, 'outer']]);
  assert.deepEqual(r0.body.cells['12203:2203'], [], 'alan içinde binasız hücre'); }

// 1. ilk istek: eksik hücreler Overpass'tan (tek çağrı), hücrelere dağıtılır, boş hücre de saklanır
const k = '11537:2384,11538:2384,11537:2385'; // i = floor(lat/0.005), j = floor(lon/0.005)
let r = await get('/api/cells?k=' + k);
assert.equal(r.status, 200); assert.equal(r.cc, 'no-store'); assert.equal(hits, 1, 'üç hücre tek Overpass çağrısı');
assert.equal(r.body.cells['11537:2384'].length, 1); assert.equal(r.body.cells['11537:2384'][0].id, 1);
assert.equal(r.body.cells['11538:2384'][0].id, 2); assert.equal(r.body.cells['11537:2385'].length, 0, 'boş hücre de geçerli sonuç'); assert.deepEqual(r.body.missing, []);
assert.equal((await sql`select count(*)::int as n from cells`)[0].n, 3);

// 2. ikinci kullanıcı: aynı bölge veritabanından, Overpass'a gidilmez
r = await get('/api/cells?k=' + k); assert.equal(hits, 1); assert.equal(r.body.cells['11537:2384'][0].id, 1);
// 2b. GBA: etiketsiz binaya yanıtta 'gba:height' eklenir; etiketli binaya (id 2, height 9) eklenmez, veritabanındaki veri değişmez
await sql`insert into gba (id, h, v) values (1, 21.4, 3), (2, 50, 1)`;
r = await get('/api/cells?k=' + k);
assert.equal(r.body.cells['11537:2384'][0].tags['gba:height'], '21.4');
assert.ok(!Object.values(r.body.cells).flat().some(e => e.id === 2 && e.tags['gba:height']), 'etiketli binaya GBA yazılmaz');
assert.ok(!JSON.stringify((await sql`select data from cells`).map(x => x.data)).includes('gba:'), 'önbellekteki OSM verisine yazılmaz');
await sql`delete from gba`;
// 2c. kat sayısı bildirimi: yalnız etiketsiz, bilinen bina; iki farklı kişi ±1 içinde uyuşunca yanıtta 'sp:levels' (ortanca)
{
  const post = (b, ip = '1.1.1.1') => fetch(base + '/api/floors', { method: 'POST', headers: { 'cf-connecting-ip': ip }, body: JSON.stringify(b) });
  const ok = { id: 1, lat: 57.6889, lon: 11.9223, floors: 5 };
  assert.equal((await post(ok)).status, 204);
  assert.equal((await post({ ...ok, floors: 6 })).status, 204, 'aynı kişi cevabını değiştirebilir (tek oy)');
  r = await get('/api/cells?k=' + k); assert.equal(r.body.cells['11537:2384'][0].tags['sp:levels'], undefined, 'tek kişi yetmez');
  assert.equal((await post({ ...ok, floors: 5 }, '2.2.2.2')).status, 204);
  r = await get('/api/cells?k=' + k); assert.equal(r.body.cells['11537:2384'][0].tags['sp:levels'], '5', 'iki kişi (5, 6) → ortanca');
  assert.equal((await post({ ...ok, floors: 20 }, '3.3.3.3')).status, 204);
  r = await get('/api/cells?k=' + k); assert.equal(r.body.cells['11537:2384'][0].tags['sp:levels'], undefined, 'uyuşmazlık (>1 kat) → uygulanmaz');
  assert.equal((await post({ id: 2, lat: 57.6905, lon: 11.9223, floors: 3 })).status, 400, 'etiketli bina (height 9) bildirilemez');
  assert.equal((await post({ ...ok, id: 999 })).status, 400, 'bilinmeyen bina');
  for (const bad of [{ ...ok, floors: 0 }, { ...ok, floors: 81 }, { ...ok, floors: 2.5 }, { ...ok, id: -1 }, { ...ok, lat: 'x' }]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  const rows = await sql`select * from floor_reports`;
  assert.ok(rows.every(x => !/\d+\.\d+\.\d+\.\d+/.test(x.who) && x.who.length === 16), 'ham IP saklanmaz');
  await sql`delete from floor_reports`;
}

// 3. bayat hücre (90 günden eski): hemen döner, arka planda yenilenir
await sql`update cells set fetched_at = now() - interval '91 days' where i = 11537 and j = 2384`;
r = await get('/api/cells?k=11537:2384'); assert.equal(r.body.cells['11537:2384'][0].id, 1);
await new Promise(res => setTimeout(res, 300));
assert.equal(hits, 2, 'bayat hücre arka planda yenilendi');
assert.ok((await sql`select fetched_at > now() - interval '1 minute' as f from cells where i = 11537 and j = 2384`)[0].f);

// 4. Overpass kısmi yanıt (remark): saklanmaz, istemciye "missing" döner
mode = 'remark'; r = await get('/api/cells?k=11600:2400');
assert.deepEqual(r.body.missing, ['11600:2400']); assert.equal((await sql`select count(*)::int as n from cells where i = 11600`)[0].n, 0);

// 5. yavaş Overpass: bekleme süresi dolunca eksik döner, çekim sürer ve sonraki istek önbellekten gelir
mode = 'slow'; const before = hits; r = await get('/api/cells?k=11700:2400');
assert.deepEqual(r.body.missing, ['11700:2400'], 'beklemeden döner');
await new Promise(res => setTimeout(res, 1800)); mode = 'ok'; // yavaş çekim (1,5 sn) arka planda bitsin (devre açıksa istek hiç beklemeden dönmüştü)
r = await get('/api/cells?k=11700:2400'); assert.deepEqual(r.body.missing, []); assert.equal(hits, before + 1, 'aynı çekim tamamlanıp saklandı');

// 6. doğrulama: kötü/büyük/dağınık istekler reddedilir, Overpass'a gidilmez
const h0 = hits;
for (const q of ['', 'x', '1:2;drop', '99999:1', Array.from({ length: 41 }, (_, i) => `1:${i}`).join(','), '100:100,120:100', '1:1,1:8'])
  assert.equal((await get('/api/cells?k=' + encodeURIComponent(q))).status, 400, `reddedilmeli: ${q.slice(0, 30)}`);
assert.equal(hits, h0);
assert.equal((await fetch(base + '/api/cells?k=1:1', { method: 'POST' })).status, 405);
assert.equal((await get('/api/nope')).status, 404);
assert.equal((await get('/api/health')).body, 'ok');

// 8. diğer kaynaklar: ilk istek kaynaktan, ikincisi veritabanından; doğrulama
{
  const png = async q => { const r = await fetch(base + q); return { status: r.status, type: r.headers.get('content-type'), body: Buffer.from(await r.arrayBuffer()) }; };
  let t = await png('/api/terrain/13/4367/2480.png'); assert.equal(t.status, 200); assert.equal(t.type, 'image/png'); assert.equal(t.body[1], 80);
  t = await png('/api/terrain/13/4367/2480.png'); assert.equal(up, 1, 'arazi karosu ikinci kez kaynağa gitmez');
  for (const q of ['/api/terrain/16/1/1.png', '/api/terrain/2/9/1.png', '/api/terrain/a/1/1.png']) assert.notEqual((await png(q)).status, 200);
  let r1 = await get('/api/irr?lat=57.68&lon=11.92&y1=2023&y2=2025'); assert.equal(r1.body.dni[0], 500); assert.equal(r1.body.dhi[0], 0);
  await get('/api/irr?lat=57.71&lon=11.94&y1=2023&y2=2025'); assert.equal(up, 2, 'aynı 0,1° hücre önbellekten');
  assert.equal((await get('/api/irr?lat=57&lon=11&y1=2020&y2=2026')).status, 400);
  r1 = await get('/api/search?q=%C3%84rlegatan%20%2040&lang=tr'); assert.equal(r1.body[0].display_name, 'Ärlegatan 40, Göteborg'); assert.equal(r1.body[0].osm_type, 'way');
  assert.equal(nomHits, 0, 'Photon ana kaynak: Nominatim\'e gidilmedi');
  await get('/api/search?q=%C3%A4rlegatan%2040&lang=tr'); assert.equal(up, 3, 'aynı arama (büyük/küçük harf, boşluk) önbellekten');
  assert.equal((await get('/api/search?q=a')).status, 400);
  r1 = await get('/api/reverse?lat=57.688938&lon=11.922345&lang=sv'); assert.equal(r1.body.address.house_number, '40'); assert.equal(r1.body.address.road, 'Ärlegatan');
  await get('/api/reverse?lat=57.688938&lon=11.922345&lang=sv'); assert.equal(up, 4);
  // Photon çökerse Nominatim yedeği (sunucunun tek, hız sınırlı sırasıyla)
  photonDown = true;
  r1 = await get('/api/search?q=other%20street&lang=en'); assert.equal(r1.body[0].display_name, 'Ärlegatan 40'); assert.equal(nomHits, 1);
  r1 = await get('/api/reverse?lat=57.6&lon=11.9&lang=en'); assert.equal(r1.body.address.house_number, '40'); assert.equal(nomHits, 2);
  photonDown = false;
  assert.equal((await get('/api/overture/9/1/1')).status, 400); assert.equal((await get('/api/overture/14/99999/1')).status, 400);
  // kaynak düşerse bayat kayıt yine döner
  await sql`update kv set fetched_at = now() - interval '500 days' where key like 's:%'`; up2.close();
  r1 = await get('/api/search?q=%C3%84rlegatan%2040&lang=tr'); assert.equal(r1.status, 200); assert.equal(r1.body[0].display_name, 'Ärlegatan 40, Göteborg');
}

// 6b. devre kesici: Overpass çökünce sonraki eksik istekler WAIT kadar beklemez, hemen "eksik" döner
mode = 'down';
let t = Date.now(); r = await get('/api/cells?k=12001:3001'); assert.deepEqual(r.body.missing, ['12001:3001']);
await new Promise(res => setTimeout(res, 300)); // çekim hatası işlensin
t = Date.now(); r = await get('/api/cells?k=12002:3002'); assert.deepEqual(r.body.missing, ['12002:3002']);
assert.ok(Date.now() - t < 400, `devre açıkken bekleme yok: ${Date.now() - t} ms`);
mode = 'ok';

// 6d. ağaçlar: ~100 m ızgarasında, Overpass'tan bir kez, sonra önbellekten
{
  mode = 'ok'; const before = hits;
  let r = await get('/api/trees?lat=57.68941&lon=11.92231'); assert.equal(r.status, 200); assert.ok(Array.isArray(r.body)); assert.equal(hits, before + 1);
  r = await get('/api/trees?lat=57.68949&lon=11.92239'); assert.equal(hits, before + 1, 'aynı 100 m hücre önbellekten');
  assert.equal((await get('/api/trees?lat=999&lon=1')).status, 400);
}

// 6c. sahada doğrulama cevabı: tek POST yolu, sıkı doğrulama, konum ~10 m'ye yuvarlanır, IP yok
{
  const post = (b, raw) => fetch(base + '/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(b) });
  const good = { lat: 57.6935123, lon: 11.9575987, az: 210, floor: 2, answer: 'sun', predicted: 'vis', conf: 1, src: 'osm', sunAlt: 12.3, sunAz: 201.5 };
  assert.equal((await post(good)).status, 201);
  const [row] = await sql`select * from feedback`;
  assert.equal(row.lat, 57.6935); assert.equal(row.lon, 11.9576); assert.equal(row.answer, 'sun');
  assert.ok(!Object.keys(row).some(k => /ip|addr|agent/i.test(k)), 'kayıtta IP/cihaz alanı yok');
  for (const bad of [{ ...good, answer: 'maybe' }, { ...good, lat: 200 }, { ...good, floor: 1.5 }, { ...good, predicted: 'x' }, {}]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await post(null, '{bad')).status, 400);
  assert.equal((await post(null, JSON.stringify({ ...good, pad: 'x'.repeat(3000) }))).status, 413);
  assert.equal((await fetch(base + '/api/feedback')).status, 405);
  assert.equal((await fetch(base + '/api/cells?k=1:1', { method: 'POST' })).status, 405, 'önbellek yolları POST kabul etmez');
  await sql`update feedback set at = now() - interval '800 days'`; await purge();
  assert.equal((await sql`select count(*)::int as n from feedback`)[0].n, 0, '2 yıldan eski cevap silinir');
}

// 6d. kullanım sayacı: yalnız izinli olaylar, günlük toplam, ref biçimi sıkı, IP yok
{
  const post = (b, raw) => fetch(base + '/api/event', { method: 'POST', body: raw ?? JSON.stringify(b) });
  assert.equal((await post({ e: 'visit', ref: 'reddit-gbg' })).status, 204);
  assert.equal((await post({ e: 'visit', ref: 'reddit-gbg' })).status, 204);
  assert.equal((await post({ e: 'result' })).status, 204);
  assert.equal((await post({ e: 'share', ref: 'Bad Ref!' })).status, 204, 'geçersiz ref boş sayılır');
  const rows = await sql`select event, ref, n from stats order by event, ref`;
  assert.deepEqual(rows.map(r => [r.event, r.ref, r.n]), [['result', '', 1], ['share', '', 1], ['visit', 'reddit-gbg', 2]]);
  assert.ok(!Object.keys(rows[0]).some(k => /ip|addr|agent/i.test(k)));
  for (const bad of [{ e: 'hack' }, {}, null]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  assert.equal((await post(null, JSON.stringify({ e: 'visit', pad: 'x'.repeat(300) }))).status, 413);
  assert.equal((await fetch(base + '/api/event')).status, 405);
}

// 7. temizlik: 90 günden eskiler silinir
await sql`update cells set fetched_at = now() - interval '100 days' where i = 11538`;
await purge(); assert.equal((await sql`select count(*)::int as n from cells where i = 11538`)[0].n, 0);
// kaynak başına saklama: 31 günlük arama silinir, 100 günlük ışınım verisi (400 gün) kalır
await sql`update kv set fetched_at = now() - interval '31 days' where key like 's:%' or key like 'irr:%'`;
await purge();
assert.equal((await sql`select count(*)::int as n from kv where key like 's:%'`)[0].n, 0, 'arama 30 günden fazla tutulmaz');
assert.ok((await sql`select count(*)::int as n from kv where key like 'irr:%'`)[0].n > 0, 'ışınım verisi kalır');

console.log('api ok');
server.close(); fake.close(); await sql.end();
