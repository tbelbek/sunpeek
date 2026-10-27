// GBA yüksekliklerini OSM kimliği tutmayan alanlara mekânsal eşleştirmeyle ekler (ör. Sevilla, Lizbon: GBA orada OSM yerine
// Microsoft bina tabanlarını kullanmış). GBA poligonu (GBA.ODbLPolygon, EPSG:3857, satır başına bir özellik) bizim etiketsiz OSM
// binamızın içine düşüyor ve alanları 0,5–2 kat içindeyse, LoD1'deki yüksekliği (anahtar <kaynak><kimlik><ülke>, ör. msSpain_…ESP,
// ours285SOVESP) o binaya verilir. Poligon dosyası: GBA.ODbLPolygon (ms, osm) ya da GBA.LoD1/Polygon (ours, google).
// Yalnız gba tablosunda henüz satırı olmayan binalar; mevcut kimlik eşleşmelerine dokunulmaz.
//   docker compose run --rm --no-deps -v D:/gba:/gba api node gba-spatial.mjs /gba/poly/<pafta>.geojson /gba/<pafta>.json Seville Lisbon
import fs from 'node:fs';
import readline from 'node:readline';
import postgres from 'postgres';

const [, , polyFile, lodFile, ...names] = process.argv, sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} }), CELL = 0.005;
const R = 6378137, toLL = (x, y) => [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, x / R * 180 / Math.PI]; // 3857 → enlem, boylam
const pip = (x, y, r) => { let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) if ((r[a][1] > y) !== (r[b][1] > y) && x < (r[b][0] - r[a][0]) * (y - r[a][1]) / (r[b][1] - r[a][1]) + r[a][0]) c = !c; return c; };
const areaLL = g => { const k = Math.cos(g[0][0] * Math.PI / 180) * 111320; let s = 0; for (let i = 0; i < g.length - 1; i++) s += g[i][1] * k * g[i + 1][0] * 110574 - g[i + 1][1] * k * g[i][0] * 110574; return Math.abs(s / 2); };

// 1) alanlar ve içlerindeki GBA'sız etiketsiz binalar (halka [enlem, boylam])
const boxes = [];
for (const n of names) { const [r] = await sql`select ring from osm_cover where name = ${n}`; if (!r) throw new Error('alan yok: ' + n);
  const la = r.ring.map(p => p[0]), lo = r.ring.map(p => p[1]); boxes.push({ n, la0: Math.min(...la), la1: Math.max(...la), lo0: Math.min(...lo), lo1: Math.max(...lo) }); }
const inBox = (la, lo) => boxes.some(b => la >= b.la0 && la <= b.la1 && lo >= b.lo0 && lo <= b.lo1);
const ours = [], grid = new Map(), gk = (la, lo) => `${Math.floor(la / 0.001)}:${Math.floor(lo / 0.001)}`;
for (const b of boxes) {
  const rows = await sql`select e from osm_cells o, jsonb_array_elements(o.data) e
    where o.i between ${Math.floor(b.la0 / CELL)} and ${Math.floor(b.la1 / CELL)} and o.j between ${Math.floor(b.lo0 / CELL)} and ${Math.floor(b.lo1 / CELL)}
      and e->>'type' = 'way' and e->'tags' ? 'building' and not (e->'tags' ? 'height') and not (e->'tags' ? 'building:levels')
      and not exists (select 1 from gba g where g.id = (e->>'id')::bigint)`;
  for (const { e } of rows) {
    const g = e.geometry.map(p => [p.lat, p.lon]), la = g.map(p => p[0]), lo = g.map(p => p[1]);
    const o = { id: e.id, g, a: areaLL(g), la0: Math.min(...la), la1: Math.max(...la), lo0: Math.min(...lo), lo1: Math.max(...lo) };
    ours.push(o);
    for (let i = Math.floor(o.la0 / 0.001); i <= Math.floor(o.la1 / 0.001); i++) for (let j = Math.floor(o.lo0 / 0.001); j <= Math.floor(o.lo1 / 0.001); j++) { const k = `${i}:${j}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(o); }
  }
}
console.log(`GBA'sız etiketsiz bina: ${ours.length}`);

// 2) GBA poligonları: merkez bizim binanın içinde ve alan oranı 0,5–2 → ms<kimlik> → bizim kimlik (bina başına en yakın alan oranı)
const want = new Map(), best = new Map(); let seen = 0;
for await (const l of readline.createInterface({ input: fs.createReadStream(polyFile), crlfDelay: Infinity })) {
  if (!l.startsWith('{ "type": "Feature"')) continue;
  const id = /"id": "([^"]+)"/.exec(l)?.[1], src = /"source": "([^"]+)"/.exec(l)?.[1] ?? '', reg = /"region": "([A-Z]{3})"/.exec(l)?.[1] ?? '', c = /"coordinates": \[ \[ (.*?) \] \] \}/.exec(l)?.[1];
  if (!id || !c) continue;
  const ring = [...c.matchAll(/\[ (-?[\d.]+), (-?[\d.]+) \]/g)].map(m => toLL(+m[1], +m[2]));
  const cla = ring.reduce((s, p) => s + p[0], 0) / ring.length, clo = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  if (!inBox(cla, clo)) continue; seen++;
  const a = areaLL(ring);
  for (const o of grid.get(gk(cla, clo)) ?? []) {
    if (cla < o.la0 || cla > o.la1 || clo < o.lo0 || clo > o.lo1 || !pip(cla, clo, o.g)) continue;
    const r = a / o.a; if (r < 0.5 || r > 2) continue;
    const d = Math.abs(Math.log(r)); if (!best.has(o.id) || d < best.get(o.id).d) { best.set(o.id, { d, key: src + id + reg }); }
  }
}
for (const [oid, { key }] of best) want.set(key, oid);
console.log(`alandaki GBA poligonu: ${seen}, eşleşen bina: ${want.size}`);

// 3) LoD1 yükseklikleri: yalnız eşleşen ms<kimlik> anahtarları
const re = /"([^"\s]{3,80})": \{"height": (-?[\d.eE+-]+), "var": (-?[\d.eE+-]+)\}/g, out = [];
let tail = '';
for await (const chunk of fs.createReadStream(lodFile, { encoding: 'utf8', highWaterMark: 1 << 22 })) {
  const s = tail + chunk; let m, last = 0; re.lastIndex = 0;
  while ((m = re.exec(s))) { last = re.lastIndex; const oid = want.get(m[1]), h = +m[2]; if (oid != null && h >= 2 && h < 400) out.push([oid, h, +m[3]]); }
  tail = s.slice(Math.max(last, s.length - 300));
}
for (let i = 0; i < out.length; i += 5000) { const b = out.slice(i, i + 5000);
  await sql`insert into gba (id, h, v) select * from unnest(${b.map(r => r[0])}::bigint[], ${b.map(r => r[1])}::real[], ${b.map(r => r[2])}::real[]) on conflict (id) do nothing`; }
console.log(`bitti: ${out.length} binaya mekânsal eşleştirmeyle GBA yüksekliği`);
await sql.end();
