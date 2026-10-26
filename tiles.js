// Yedek veri kaynakları — kütüphanesiz, tarayıcıda okunan statik karolar (API ve hız sınırı yok):
//  - Overture Maps binaları: tek bir PMTiles arşivinden HTTP aralık istekleriyle vektör karolar (MVT)
//  - AWS Terrain Tiles (terrarium PNG): zemin kotu
// Ana kaynaklar (Overpass, Open-Meteo) yanıt vermezse app.js bunları dener.

// Overture sürümleri aylık; eski sürümler bir süre sonra silinir. Sunucudaki yoklama (probe.sh) adres düşünce uyarır.
export const OVERTURE = 'https://overturemaps-extras-us-west-2.s3.amazonaws.com/tiles/2026-10-21.0/buildings.pmtiles';
const TERRARIUM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
const x2lon = (x, z) => x / 2 ** z * 360 - 180;
const y2lat = (y, z) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;

// ---------- PMTiles v3 ----------
// Karo kimliği: yakınlaştırma düzeyine göre ötelenmiş Hilbert eğrisi sırası (PMTiles belirtimi)
export function tileId(z, x, y) {
  let d = 0, s = 2 ** z / 2;
  const xy = [x, y];
  for (; s >= 1; s /= 2) {
    const rx = (xy[0] & s) > 0 ? 1 : 0, ry = (xy[1] & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { xy[0] = s - 1 - xy[0]; xy[1] = s - 1 - xy[1]; } xy.reverse(); }
  }
  return (4 ** z - 1) / 3 + d;
}
// 64 bite kadar varint (Number: 2^53'e kadar kesin; dosya ofsetleri bunun çok altında)
function varint(b, p) { let v = 0, m = 1, c; do { c = b[p.i++]; v += (c & 0x7f) * m; m *= 128; } while (c & 0x80); return v; }
const gunzip = async buf => new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
async function range(url, o, n, signal) {
  const r = await fetch(url, { headers: { Range: `bytes=${o}-${o + n - 1}` }, signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
function dir(b) {
  const p = { i: 0 }, n = varint(b, p), e = Array.from({ length: n }, () => ({}));
  let id = 0;
  for (const x of e) x.id = id += varint(b, p);
  for (const x of e) x.run = varint(b, p);
  for (const x of e) x.len = varint(b, p);
  e.forEach((x, k) => { const v = varint(b, p); x.off = v === 0 && k > 0 ? e[k - 1].off + e[k - 1].len : v - 1; });
  return e;
}
function find(e, id) {
  let m = 0, n = e.length - 1;
  while (m <= n) { const k = (m + n) >> 1, c = id - e[k].id; if (c > 0) m = k + 1; else if (c < 0) n = k - 1; else return e[k]; }
  return n >= 0 && (e[n].run === 0 || id - e[n].id < e[n].run) ? e[n] : null;
}
const archives = new Map(); // url -> başlık + kök dizin (oturum boyunca bir kez)
async function header(url, signal) {
  if (!archives.has(url)) archives.set(url, (async () => {
    const b = await range(url, 0, 16384, signal), v = new DataView(b.buffer), u = o => Number(v.getBigUint64(o, true));
    if (String.fromCharCode(...b.slice(0, 7)) !== 'PMTiles' || b[7] !== 3) throw new Error('not PMTiles v3');
    const h = { rootOff: u(8), rootLen: u(16), leafOff: u(40), dataOff: u(56), ic: b[97], tc: b[98], maxZ: b[101] };
    const raw = b.slice(h.rootOff, h.rootOff + h.rootLen);
    h.root = dir(h.ic === 2 ? await gunzip(raw) : raw);
    return h;
  })().catch(e => { archives.delete(url); throw e; }));
  return archives.get(url);
}
export async function getTile(url, z, x, y, signal) {
  const h = await header(url, signal), id = tileId(z, x, y);
  let d = h.root;
  for (let depth = 0; depth < 4; depth++) {
    const e = find(d, id);
    if (!e) return null;
    if (e.run > 0) { const t = await range(url, h.dataOff + e.off, e.len, signal); return h.tc === 2 ? gunzip(t) : t; }
    const raw = await range(url, h.leafOff + e.off, e.len, signal);
    d = dir(h.ic === 2 ? await gunzip(raw) : raw);
  }
  return null;
}

// ---------- Mapbox Vector Tile (protobuf) ----------
function fields(b, s, e, cb) {
  const p = { i: s };
  while (p.i < e) {
    const t = varint(b, p), f = Math.floor(t / 8), w = t & 7;
    if (w === 0) cb(f, varint(b, p));
    else if (w === 2) { const n = varint(b, p); cb(f, null, p.i, p.i + n); p.i += n; }
    else if (w === 1) { cb(f, new DataView(b.buffer, b.byteOffset + p.i, 8).getFloat64(0, true)); p.i += 8; }
    else if (w === 5) { cb(f, new DataView(b.buffer, b.byteOffset + p.i, 4).getFloat32(0, true)); p.i += 4; }
    else throw new Error('MVT wire type ' + w);
  }
}
const packed = (b, s, e) => { const p = { i: s }, o = []; while (p.i < e) o.push(varint(b, p)); return o; };
const zz = n => n % 2 ? -(n + 1) / 2 : n / 2;
const td = new TextDecoder();
// Katmanlar: { ad: [{ props, rings: [[[x,y]...]] (karo birimi), extent }] }
export function decodeMVT(b) {
  const out = {};
  fields(b, 0, b.length, (f, _v, s, e) => {
    if (f !== 3) return;
    let name = '', extent = 4096; const keys = [], vals = [], feats = [];
    fields(b, s, e, (lf, lv, ls, le) => {
      if (lf === 1) name = td.decode(b.subarray(ls, le));
      else if (lf === 3) keys.push(td.decode(b.subarray(ls, le)));
      else if (lf === 4) { let val = null; fields(b, ls, le, (vf, vv, vs, ve) => { val = vf === 1 ? td.decode(b.subarray(vs, ve)) : vf === 6 ? zz(vv) : vf === 7 ? !!vv : vv; }); vals.push(val); }
      else if (lf === 5) extent = lv;
      else if (lf === 2) { const ft = {}; fields(b, ls, le, (ff, fv, fs, fe) => { if (ff === 2) ft.tags = packed(b, fs, fe); else if (ff === 3) ft.type = fv; else if (ff === 4) ft.geom = packed(b, fs, fe); }); feats.push(ft); }
    });
    out[name] = feats.filter(ft => ft.type === 3).map(ft => {
      const props = {}, rings = []; let x = 0, y = 0, ring = null;
      for (let k = 0; k < (ft.tags?.length ?? 0); k += 2) props[keys[ft.tags[k]]] = vals[ft.tags[k + 1]];
      for (let i = 0; i < ft.geom.length;) {
        const c = ft.geom[i++], cmd = c & 7, n = c >> 3;
        if (cmd === 7) { if (ring) { ring.push(ring[0]); rings.push(ring); ring = null; } continue; }
        for (let j = 0; j < n; j++) { x += zz(ft.geom[i++]); y += zz(ft.geom[i++]); if (cmd === 1) ring = []; ring.push([x, y]); }
      }
      return { props, rings, extent };
    });
  });
  return out;
}
// Dış halka: karo koordinatında (y aşağı) alan pozitif. Delikler (avlu) atlanır — gölge için ihmal edilebilir.
const area = r => { let a = 0; for (let i = 1; i < r.length; i++) a += r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1]; return a / 2; };
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };

// Overture binaları → Overpass biçiminde öğeler (way + tags + geometry), böylece hesap aynı kalır.
// Karo (z14 ≈ 1–2 km) bütün olarak önbelleğe girer: yakında başka bir bina seçilince ağ isteği olmaz.
// cache: { get(key) → öğeler | undefined, put(key, öğeler) }; anahtar sürümü içerir, yeni Overture sürümünde kendiliğinden yenilenir.
// ponytail: karo sınırında kesilen bina iki parça olur; aynı kimlikten en büyük parça tutulur (sınırdaki bina biraz kısalabilir).
export async function overtureBuildings(lat, lon, r = 400, signal, cache = null) {
  const h = await header(OVERTURE, signal), z = Math.min(14, h.maxZ);
  const dLat = r / 111320, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
  const x0 = Math.floor(lon2x(lon - dLon, z)), x1 = Math.floor(lon2x(lon + dLon, z)), y0 = Math.floor(lat2y(lat + dLat, z)), y1 = Math.floor(lat2y(lat - dLat, z));
  const all = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const key = `ovt:${OVERTURE.split('/').at(-2)}:${z}/${x}/${y}`;
    let els = await cache?.get(key);
    if (!els) { els = await overtureTile(z, x, y, signal); cache?.put(key, els); }
    all.push(...els);
  }
  const near = e => e.geometry.some(g => Math.abs(g.lat - lat) < dLat && Math.abs(g.lon - lon) < dLon); // karo yarıçaptan geniş
  const seen = new Map(); for (const e of all) if (near(e) && (seen.get(e.id)?.geometry.length ?? 0) < e.geometry.length) seen.set(e.id, e);
  return [...seen.values()];
}
async function overtureTile(z, x, y, signal) {
  const best = new Map();
  {
    const t = await getTile(OVERTURE, z, x, y, signal);
    if (!t) return [];
    const L = decodeMVT(t);
    for (const [layer, part] of [['building', false], ['building_part', true]]) for (const f of L[layer] ?? []) for (const ring of f.rings) {
      const a = area(ring); if (a <= 0) continue;
      const key = (f.props.id ?? hash(JSON.stringify(ring[0]) + x + y)) + (part ? 'p' : ''), prev = best.get(key);
      if (prev && prev.a >= a) continue;
      const geometry = ring.map(([px, py]) => ({ lat: y2lat(y + py / f.extent, z), lon: x2lon(x + px / f.extent, z) }));
      const tags = { building: typeof f.props.class === 'string' ? f.props.class : 'yes' };
      if (Number.isFinite(f.props.height)) tags.height = String(f.props.height);
      if (Number.isFinite(f.props.num_floors)) tags['building:levels'] = String(f.props.num_floors);
      if (part) tags['building:part'] = 'yes';
      best.set(key, { a, el: { type: 'way', id: 1e15 + hash(key), tags, geometry } });
    }
  }
  return [...best.values()].map(v => v.el);
}

// ---------- Arazi: terrarium PNG karoları ----------
// yükseklik = R·256 + G + B/256 − 32768. Yakın noktalar için z13 (~15 m), uzak ufuk için z11 (~60 m) yeter.
// cache: { get(key) → Blob | undefined, put(key, Blob) } — karolar durağan, uzun süre saklanabilir
export async function terrariumElev(pts, signal, cache = null) {
  const lats = pts.map(p => p[0]), lons = pts.map(p => p[1]);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
  const z = span < 0.03 ? 13 : 11, tiles = new Map();
  const px = async (lat, lon) => {
    const fx = lon2x(lon, z), fy = lat2y(lat, z), tx = Math.floor(fx), ty = Math.floor(fy), k = `${tx}/${ty}`;
    if (!tiles.has(k)) tiles.set(k, (async () => {
      let blob = await cache?.get(`tr:${z}/${k}`);
      if (!blob) {
        const r = await fetch(TERRARIUM(z, tx, ty), { signal });
        if (!r.ok) throw new Error('terrain HTTP ' + r.status);
        blob = await r.blob(); cache?.put(`tr:${z}/${k}`, blob);
      }
      const img = await createImageBitmap(blob), c = new OffscreenCanvas(256, 256), g = c.getContext('2d');
      g.drawImage(img, 0, 0); return g.getImageData(0, 0, 256, 256).data;
    })());
    const d = await tiles.get(k), i = (Math.min(255, Math.floor((fy - ty) * 256)) * 256 + Math.min(255, Math.floor((fx - tx) * 256))) * 4;
    return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
  };
  return Promise.all(pts.map(([la, lo]) => px(la, lo)));
}
