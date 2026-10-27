// Doğrulama: OSM tabanlı bina yüksekliklerini ve sonuçları yetkili 3D veriyle karşılaştırır.
//   node tools/validate/ref.mjs ams [duvar=80]        Amsterdam: 3DBAG (WFS, CC BY 4.0) — NL'de OSM yükseklikleri çoğu zaman BAG'den
//                                                     gelir, bu yüzden burada yalnız etiketsiz kaynaklar (median/guess/gba) anlamlı
//   node tools/validate/ref.mjs muc <gml klasörü>     Münih: Bavyera LoD2 CityGML paftaları (CC BY 4.0), etiketli kaynaklar için
// Ortam: API=https://sunpeek.uk (OSM hücreleri buradan; GBA vb. sunucu katkıları dahil gelir).
// Çıktı: kaynak başına yükseklik oranı (referans/model) dağılımı, önerilen pay (p10–p90) ve rastgele duvarlarda sonuç hatası,
// gerçek sonucun gösterilen aralığa düşme oranı. Referans yükseklik = çatının %70'lik yüksekliği − zemin (3DBAG h_70p tanımı):
// düz blok olarak çizilen bir binanın gölgesine en yakın değer; mahya (en üst) beşik çatıda gölgeyi abartır.
import { readFileSync, readdirSync } from 'node:fs';
import { localize, pickEdge, frame, facadeDay, facadeRange, heightBounds } from '../../sun.js';

const [, , city = 'ams', arg2] = process.argv, API = process.env.API ?? 'https://sunpeek.uk', CELL = 0.005;
// CENTER=lat,lon ile merkez değiştirilebilir (ör. Münih dış semtleri: daha az OSM etiketi)
const C = process.env.CENTER ? process.env.CENTER.split(',').map(Number) : { ams: [52.3730, 4.8900], muc: [48.1370, 11.5750] }[city];
if (!C) throw new Error('şehir: ams | muc');
const [la0, lo0] = C, DLA = 0.006, DLO = 0.009;
const F = frame(la0, lo0);

// ---------- OSM (SunPeek sunucusu) ----------
async function osm() {
  const keys = [];
  for (let i = Math.floor((la0 - DLA) / CELL); i <= Math.floor((la0 + DLA) / CELL); i++)
    for (let j = Math.floor((lo0 - DLO) / CELL); j <= Math.floor((lo0 + DLO) / CELL); j++) keys.push(`${i}:${j}`);
  const r = await (await fetch(`${API}/api/cells?k=${keys.join(',')}`)).json();
  if (r.missing?.length) console.warn('eksik hücre', r.missing.length);
  return Object.values(r.cells).flat();
}

// ---------- referans ----------
// 3DBAG WFS: EPSG:4326 taban + b3_h_70p (çatının %70'lik yüksekliği, NAP) − b3_h_maaiveld (zemin, NAP)
async function bag() {
  const out = [];
  for (let start = 0; ; start += 1000) {
    const u = `https://data.3dbag.nl/api/BAG3D/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=BAG3D:lod13&outputFormat=application/json&srsName=EPSG:4326&count=1000&startIndex=${start}&bbox=${la0 - DLA},${lo0 - DLO},${la0 + DLA},${lo0 + DLO},urn:ogc:def:crs:EPSG::4326`;
    const j = await (await fetch(u)).json();
    for (const f of j.features ?? []) {
      const p = f.properties, g = f.geometry?.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry?.coordinates?.[0]?.[0];
      if (!g || p.b3_h_70p == null || p.b3_h_maaiveld == null) continue;
      out.push({ ring: g.map(([x, y]) => F.to(y, x)), h: p.b3_h_70p - p.b3_h_maaiveld });
    }
    if ((j.features?.length ?? 0) < 1000) break;
  }
  return out;
}
// UTM 32N (ETRS89 ≈ WGS84) → enlem/boylam (Snyder)
function utm32(E, N) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), x = E - 500000, M = N / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256)), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return [lat * 180 / Math.PI, 9 + lon * 180 / Math.PI];
}
// Bavyera LoD2 CityGML: her bldg:Building için zemin yüzeyleri (taban) ve çatı: saçak + 0,7 × (mahya − saçak) (3DBAG h_70p'ye denk)
function lod2(dir) {
  const out = [], pos = s => [...s.matchAll(/<gml:posList[^>]*>([^<]+)</g)].map(m => { const v = m[1].trim().split(/\s+/).map(Number), r = []; for (let i = 0; i + 2 < v.length; i += 3) r.push(v.slice(i, i + 3)); return r; });
  for (const f of readdirSync(dir).filter(f => f.endsWith('.gml'))) {
    const t = readFileSync(`${dir}/${f}`, 'utf8');
    for (const b of t.split('<bldg:Building ').slice(1)) {
      const body = b.split('</bldg:Building>')[0], roof = body.split('<bldg:RoofSurface').slice(1).flatMap(r => pos(r.split('</bldg:RoofSurface>')[0]).flat());
      if (!roof.length) continue;
      const zs = roof.map(p => p[2]), eave = Math.min(...zs), ridge = Math.max(...zs), zmax = eave + 0.7 * (ridge - eave);
      for (const g of body.split('<bldg:GroundSurface').slice(1)) {
        const ring = pos(g.split('</bldg:GroundSurface>')[0])[0];
        if (!ring) continue;
        const z0 = Math.min(...ring.map(p => p[2]));
        out.push({ ring: ring.map(([E, N]) => F.to(...utm32(E, N))), h: zmax - z0 });
      }
    }
  }
  return out;
}

// ---------- eşleştirme ----------
const area = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s / 2); };
const pip = (x, y, r) => { let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) if ((r[a][1] > y) !== (r[b][1] > y) && x < (r[b][0] - r[a][0]) * (y - r[a][1]) / (r[b][1] - r[a][1]) + r[a][0]) c = !c; return c; };
function match(buildings, ref) {
  const grid = new Map(), key = (x, y) => `${Math.floor(x / 50)}:${Math.floor(y / 50)}`;
  for (const r of ref) { const xs = r.ring.map(p => p[0]), ys = r.ring.map(p => p[1]); r.a = area(r.ring);
    for (let gx = Math.floor(Math.min(...xs) / 50); gx <= Math.floor(Math.max(...xs) / 50); gx++) for (let gy = Math.floor(Math.min(...ys) / 50); gy <= Math.floor(Math.max(...ys) / 50); gy++) { const k = `${gx}:${gy}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r); } }
  const m = new Map();
  for (const b of buildings) {
    const A = area(b.ring), cands = (grid.get(key(b.cx, b.cy)) ?? []).filter(r => pip(b.cx, b.cy, r.ring) && r.a / A > 0.5 && r.a / A < 2);
    if (cands.length === 1 && cands[0].h > 1.5) m.set(b.id, cands[0].h);
  }
  return m;
}

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const els = await osm();
const ref = city === 'ams' ? await bag() : lod2(arg2 ?? '.');
const L = localize(els, la0, lo0, null), all = L.buildings.concat(L.own), M = match(all, ref);
console.log(`${city}: OSM ${all.length} bina, referans ${ref.length}, eşleşen ${M.size}`);

// 1) kaynak başına yükseklik: oran = referans / model; pay önerisi = [1 − p10, p90 − 1]; mevcut HB içinde kalan oran
const by = {};
for (const b of all) { const h = M.get(b.id); if (h == null || b.part) continue; (by[b.src] ??= []).push({ r: h / b.h, b }); }
const rows = {};
for (const [src, a] of Object.entries(by)) {
  const r = a.map(x => x.r), inB = a.filter(({ r, b }) => { const [lo, hi] = heightBounds(b); return r * b.h >= b.h - lo && r * b.h <= b.h + hi; }).length;
  rows[src] = { n: a.length, 'oran p10': q(r, 0.1).toFixed(2), medyan: q(r, 0.5).toFixed(2), 'oran p90': q(r, 0.9).toFixed(2), 'MAE m': (a.reduce((s, x) => s + Math.abs(x.r * x.b.h - x.b.h), 0) / a.length).toFixed(1), 'mevcut pay içinde %': Math.round(100 * inB / a.length) };
}
console.table(rows);

// 1b) GBA'nın katkısı: GBA alan her bina, GBA olmasaydı kullanılacak değerle (komşu ortancası / tür varsayılanı / küçük yapı) karşılaştırılır
const noGba = els.map(e => e.tags?.['gba:height'] == null ? e : { ...e, tags: Object.fromEntries(Object.entries(e.tags).filter(([k]) => k !== 'gba:height')) });
const L1 = localize(noGba, la0, lo0, null), alt = new Map(L1.buildings.concat(L1.own).map(b => [b.id, b]));
const cmp = {};
for (const b of all) { const h = M.get(b.id), o = alt.get(b.id); if (h == null || b.part || b.src !== 'gba' || !o) continue;
  const c = cmp[o.src] ??= { n: 0, gba: 0, without: 0, better: 0 }; c.n++; c.gba += Math.abs(b.h - h); c.without += Math.abs(o.h - h); if (Math.abs(b.h - h) < Math.abs(o.h - h)) c.better++; }
console.log('GBA yerine geçtiği değer (GBA olmasaydı kaynak) → ortalama mutlak hata, m');
console.table(Object.fromEntries(Object.entries(cmp).map(([k, c]) => [k, { n: c.n, 'GBA MAE m': (c.gba / c.n).toFixed(1), 'GBA\'sız MAE m': (c.without / c.n).toFixed(1), 'GBA daha iyi %': Math.round(100 * c.better / c.n) }])));

// 2) sonuç: rastgele duvar, 2. kat, ekinoks ve kış; gerçek = referans yükseklikleriyle hesap
const N = +(city === 'ams' ? arg2 : process.argv[4]) || 80;
const truthEls = els.map(e => { const h = M.get(e.id); if (h == null) return e; const tags = { ...e.tags, height: h.toFixed(1) }; delete tags['building:levels']; return { ...e, tags }; });
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const res = [];
for (let n = 0; res.length < N && n < N * 20; n++) {
  const pla = la0 + (rnd() - 0.5) * DLA, plo = lo0 + (rnd() - 0.5) * DLO;
  const B = localize(els, pla, plo, null), e = pickEdge(B.buildings.concat(B.own), 0, 0, 20);
  if (!e || !M.has(e.b.id)) continue;
  const G = frame(pla, plo), [flat, flon] = G.from(e.x, e.y), f = { lat: flat, lon: flon, az: e.az, id: e.b.id };
  const env = { el: els, ground: null, hz: null }, tenv = { el: truthEls, ground: null, hz: null }, envs = { lo: { ...env, hs: 1 }, hi: { ...env, hs: -1 }, base: env }, eye = 7.5;
  for (const [m, d] of [[3, 20], [12, 21]]) {
    const mod = facadeDay(env, f, eye, 2025, m, d, 5).visH, tru = facadeDay(tenv, f, eye, 2025, m, d, 5).visH, rg = facadeRange(envs, f, eye, 2025, m, d);
    const ng = facadeDay({ el: noGba, ground: null, hz: null }, f, eye, 2025, m, d, 5).visH;
    res.push({ m, err: mod - tru, errNoGba: ng - tru, inR: tru >= rg.lo - 1 / 12 && tru <= rg.hi + 1 / 12, w: rg.hi - rg.lo });
  }
}
const sum = m => { const a = res.filter(r => r.m === m); return { duvar: a.length, 'MAE sa': (a.reduce((s, r) => s + Math.abs(r.err), 0) / a.length).toFixed(2), '>1 sa hata %': Math.round(100 * a.filter(r => Math.abs(r.err) > 1).length / a.length), 'aralık içinde %': Math.round(100 * a.filter(r => r.inR).length / a.length), 'aralık genişliği medyan sa': q(a.map(r => r.w), 0.5).toFixed(2), 'GBA\'sız MAE sa': (a.reduce((s, r) => s + Math.abs(r.errNoGba), 0) / a.length).toFixed(2), 'GBA\'sız >1 sa %': Math.round(100 * a.filter(r => Math.abs(r.errNoGba) > 1).length / a.length) }; };
console.table({ ekinoks: sum(3), kış: sum(12) });
