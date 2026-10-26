// Şehir binalarını (osm-prep.sh çıktısı: <ad>.opl + <ad>.poly) osm_cells'e yükler; bu alanlarda Overpass'a gidilmez.
// Overpass'ın `out tags geom` biçimini aynen üretir (yol: tags + geometry; ilişki: üyeler rol + geometry) ve her öğe, sunucudaki
// gibi ilk noktasının hücresine yazılır. Yeni tabloya yüklenip tek işlemde değiştirilir: API yükleme boyunca eskisiyle çalışır.
//   docker compose run --rm --no-deps -v D:/Docker/sunpeek-osm:/d api node import.mjs /d
import fs from 'node:fs';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import postgres from 'postgres';

export const CELL = 0.005;
const unesc = s => s.replace(/%([0-9a-f]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16))); // OPL kaçışı: %<onaltılık>%
const field = (p, c) => p.find(x => x[0] === c)?.slice(1) ?? '';
const tags = t => Object.fromEntries(t ? t.split(',').map(kv => { const i = kv.indexOf('='); return [unesc(kv.slice(0, i)), unesc(kv.slice(i + 1))]; }) : []);
const geom = n => { // n1x13.1y55.7,n2x… ; konumu olmayan düğüm varsa yol atlanır
  if (!n) return null;
  const g = [];
  for (const r of n.split(',')) { const m = /x(-?[\d.]+)y(-?[\d.]+)$/.exec(r); if (!m) return null; g.push({ lat: +m[2], lon: +m[1] }); }
  return g;
};
const cell = g => `${Math.floor(g.lat / CELL)}\t${Math.floor(g.lon / CELL)}`;
const copyRow = (g, k, el) => `${cell(g)}\t${k}\t${JSON.stringify(el).replace(/\\/g, '\\\\')}\n`; // COPY metin biçimi: \ çiftlenir
const lines = f => readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });

// İki geçiş: önce ilişkilerin üye yolları, sonra öğeler (OPL sıralı: yollar ilişkilerden önce gelir)
export async function* rows(f) {
  const want = new Set(), ways = new Map();
  for await (const l of lines(f)) if (l[0] === 'r') for (const m of field(l.split(' '), 'M').split(',')) if (m[0] === 'w') want.add(+m.slice(1, m.indexOf('@')));
  for await (const l of lines(f)) {
    const p = l.split(' '), id = +p[0].slice(1);
    if (p[0][0] === 'w') {
      const g = geom(field(p, 'N')); if (!g) continue;
      const t = tags(field(p, 'T'));
      if (want.has(id)) ways.set(id, g);
      if ('building' in t || 'building:part' in t) yield copyRow(g[0], 'w' + id, { type: 'way', id, tags: t, geometry: g });
    } else if (p[0][0] === 'r') {
      const t = tags(field(p, 'T')); if (!('building' in t)) continue;
      const members = field(p, 'M').split(',').filter(m => m[0] === 'w').map(m => {
        const at = m.indexOf('@'), ref = +m.slice(1, at);
        return { type: 'way', ref, role: unesc(m.slice(at + 1)), geometry: ways.get(ref) };
      }).filter(m => m.geometry);
      if (members.length) yield copyRow(members[0].geometry[0], 'r' + id, { type: 'relation', id, tags: t, members });
    }
  }
}
// Osmosis .poly: ilk satır ad; her bölüm bir halka ("!" ile başlayan bölüm delik, atlanır), END ile biter. Çıktı [[lat, lon]…]
export function polys(text) {
  const out = []; let ring = null, hole = false;
  for (const l of text.split('\n').slice(1).map(s => s.trim()).filter(Boolean)) {
    if (l === 'END') { if (ring && !hole && ring.length > 2) out.push(ring); ring = null; continue; }
    if (!ring) { ring = []; hole = l.startsWith('!'); continue; }
    const [lon, lat] = l.split(/\s+/).map(Number); ring.push([lat, lon]);
  }
  return out;
}

export async function importDir(sql, dir, log = console.log) {
  const names = fs.readdirSync(dir).filter(f => f.endsWith('.opl')).map(f => f.slice(0, -4)).filter(n => fs.existsSync(`${dir}/${n}.poly`)).sort();
  if (!names.length) throw new Error('no <name>.opl + <name>.poly in ' + dir);
  await sql`drop table if exists osm_stage`;
  await sql`create unlogged table osm_stage (i int, j int, k text, el jsonb)`;
  for (const n of names) {
    await pipeline(Readable.from(rows(`${dir}/${n}.opl`)), await sql`copy osm_stage (i, j, k, el) from stdin`.writable());
    log(`${n} loaded`);
  }
  await sql`drop table if exists osm_cells_new`;
  // şehir alanları kesişebilir (Ruhr, Öresund): aynı öğe bir kez
  await sql`create table osm_cells_new as select i, j, jsonb_agg(el) as data from (select distinct on (i, j, k) i, j, k, el from osm_stage) s group by i, j`;
  await sql`alter table osm_cells_new add primary key (i, j)`;
  const cover = names.flatMap(n => polys(fs.readFileSync(`${dir}/${n}.poly`, 'utf8')).map((r, x) => ({ name: x ? `${n}#${x}` : n, ring: r })));
  await sql.begin(async t => {
    await t`drop table osm_cells`;
    await t`alter table osm_cells_new rename to osm_cells`;
    await t`alter index osm_cells_new_pkey rename to osm_cells_pkey`; // sonraki içe aktarma aynı adı yeniden kurabilsin
    await t`delete from osm_cover`;
    for (const c of cover) await t`insert into osm_cover (name, ring) values (${c.name}, ${t.json(c.ring)})`;
  });
  await sql`drop table osm_stage`;
  const [s] = await sql`select count(*)::int as cells, coalesce(sum(jsonb_array_length(data)), 0)::int as els, pg_size_pretty(pg_total_relation_size('osm_cells')) as size from osm_cells`;
  log(`done: ${names.length} areas, ${s.cells} cells, ${s.els} buildings, ${s.size}`);
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
  await importDir(sql, process.argv[2] ?? '/d').finally(() => sql.end());
}
