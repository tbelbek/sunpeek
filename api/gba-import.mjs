// GBA.LoD1 Avrupa paftalarından (HuggingFace zhu-xlab/GBA.LoD1, CC BY-NC 4.0) yalnız bizim etiketsiz binalarımızın yüksekliğini
// gba tablosuna yükler. Pafta biçimi: tek JSON nesnesi {"osm<yol id><ülke>": {"height": m, "var": m²}, …}, 0,03–2 GB.
//   docker compose run --rm --no-deps -v D:/gba:/gba api node gba-import.mjs /gba
// Tekrar çalıştırılabilir: tablo baştan doldurulur (yeni osm_cells içe aktarımından sonra da çalıştırılmalı).
import fs from 'node:fs';
import postgres from 'postgres';

const dir = process.argv[2] ?? '/gba', sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
// içe aktarılmış alanlarda yüksekliği/kat sayısı etiketsiz yol binaları (ilişkiler hariç: GBA anahtarı yalnız yol kimliği taşır)
const ids = (await sql`select distinct (e->>'id')::bigint as id from osm_cells, jsonb_array_elements(data) e
  where e->>'type' = 'way' and e->'tags' ? 'building' and not (e->'tags' ? 'height') and not (e->'tags' ? 'building:levels')`.values()).map(r => Number(r[0]));
const want = Float64Array.from(ids).sort();
const has = id => { let lo = 0, hi = want.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (want[m] === id) return true; want[m] < id ? lo = m + 1 : hi = m - 1; } return false; };
console.log(`etiketsiz bina: ${want.length}`);

await sql`truncate gba`;
const re = /"osm(\d+)[A-Z]{3}": \{"height": (-?[\d.eE+-]+), "var": (-?[\d.eE+-]+)\}/g;
let batch = [], total = 0;
const flush = async () => { if (!batch.length) return; const b = batch; batch = [];
  await sql`insert into gba (id, h, v) select * from unnest(${b.map(r => r[0])}::bigint[], ${b.map(r => r[1])}::real[], ${b.map(r => r[2])}::real[]) on conflict (id) do nothing`; total += b.length; };
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  let tail = '', seen = 0;
  for await (const chunk of fs.createReadStream(`${dir}/${f}`, { encoding: 'utf8', highWaterMark: 1 << 22 })) {
    const s = tail + chunk; let m, last = 0; re.lastIndex = 0;
    while ((m = re.exec(s))) { last = re.lastIndex; seen++; const id = +m[1], h = +m[2];
      if (h >= 2 && h < 400 && has(id)) { batch.push([id, h, +m[3]]); if (batch.length >= 5000) await flush(); } }
    tail = s.slice(Math.max(last, s.length - 300)); // eşleşmeyen son parça bir sonraki parçayla birleşir
  }
  await flush();
  console.log(`${f}: ${seen} kayıt okundu, toplam yüklenen ${total}`);
}
console.log(`bitti: ${total} / ${want.length} etiketsiz binaya GBA yüksekliği`);
await sql.end();
