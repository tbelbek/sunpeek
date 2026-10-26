// Güneş hesabı — NOAA güneş hesaplayıcı algoritması (SunCalc.org ile uyumlu).
const rad = Math.PI / 180, deg = 180 / Math.PI;

// -> {alt: kırılmalı yükseklik, altTrue: geometrik yükseklik, az: kuzeyden saat yönü}, derece
export function sunpos(lat, lon, date) {
  const jd = date.getTime() / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T), Mr = M * rad;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
  const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
  const y = Math.tan(eps * rad / 2) ** 2;
  const eqt = 4 * deg * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * Mr));
  const mins = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = (((mins + eqt + 4 * lon) % 1440) + 1440) % 1440, ha = (tst / 4 - 180) * rad;
  const la = lat * rad;
  const cz = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha);
  const altTrue = 90 - deg * Math.acos(Math.max(-1, Math.min(1, cz)));
  const az = (deg * Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) + 180 + 360) % 360;
  let alt = altTrue;
  if (alt > -0.5) alt += 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * rad) / 60; // Bennett kırılması
  return { alt, altTrue, az, ha: tst / 4 - 180 };
}

// Gün doğumu/batımı/öğle: güneş öğlesine ortalı 24 saatlik pencerede dakika taraması.
// Saat dilimi bağımsız: tıklanan nokta tarayıcının saat diliminden uzak olsa da doğumu kaçırmaz.
// Kutup günü/gecesi -> sunrise/sunset null, polar: 'day' | 'night'.
export function dayEvents(lat, lon, y, m, d) {
  const noonGuess = Date.UTC(y, m - 1, d, 12) - lon / 15 * 3600000;
  let sunrise = null, sunset = null, noon = null, prev = null, up = 0;
  for (let k = -720; k <= 720; k++) {
    const t = noonGuess + k * 60000, p = sunpos(lat, lon, new Date(t));
    const h = p.altTrue + 0.833, above = h > 0; // üst kenar ufukta
    if (above) up++;
    if (prev !== null && prev.ha < 0 && p.ha >= 0 && p.ha < 90) noon = new Date(t - 60000 * p.ha / (p.ha - prev.ha)); // saat açısı 0 = güneş öğlesi
    if (prev !== null && above !== prev.h > 0) { // iki dakika arasında doğrusal interpolasyon
      const x = new Date(t - 60000 * h / (h - prev.h));
      if (above) sunrise ??= x; else sunset = x;
    }
    prev = { h, ha: p.ha };
  }
  const polar = sunrise || sunset ? null : up ? 'day' : 'night';
  return { sunrise, sunset, noon, maxAlt: noon && sunpos(lat, lon, noon).alt, polar };
}

// OSM sayı etiketi: "12", "12,5", "12 m", "40'" / "40 ft" (feet -> metre).
// OSM'yi herkes düzenleyebilir: sonlu ve makul olmayan değerler (Infinity, negatif, 1 km+) yok sayılır.
const num = v => { if (v == null) return NaN; const s = String(v).trim().replace(',', '.').slice(0, 32), n = parseFloat(s), m = /'|ft|feet/.test(s) ? n * 0.3048 : n; return Number.isFinite(m) && m >= 0 && m <= 1000 ? m : NaN; };

// Döşemeden döşemeye kat yüksekliği (Avrupa konutlarında tipik 2,8–3,2 m); her yerde aynı sabit
export const STOREY = 3;
// OSM etiketinden bina yüksekliği. guessed: etiket yoksa true (bina türüne göre varsayılan).
export function height(t) {
  const h = num(t.height);
  const lv = num(t['building:levels']), levels = isNaN(lv) || lv > 300 ? null : lv;
  // kat yüksekliği: hem yükseklik hem kat sayısı varsa binanın kendi değeri (eski binalarda tavan yüksek), yoksa STOREY
  if (!isNaN(h)) return { h, levels, storey: levels ? Math.min(4.2, Math.max(2.6, h / levels)) : STOREY, guessed: false };
  if (levels != null) { const rh = num(t['roof:height']), rl = num(t['roof:levels']); return { h: lv * STOREY + (!isNaN(rh) ? rh : !isNaN(rl) ? rl * 2.5 : 1), levels, storey: STOREY, guessed: false }; }
  const def = { garage: 3, garages: 3, shed: 3, carport: 3, roof: 3, hut: 3, house: 6, detached: 6, semidetached_house: 6, terrace: 6, apartments: 12, residential: 12 };
  return { h: Object.hasOwn(def, t.building) ? def[t.building] : 9, levels: null, storey: STOREY, guessed: true }; // hasOwn: "constructor" gibi etiketler prototipe çözülmesin
}

// Binada olabilecek en üst kat (0 = zemin): kat etiketi varsa ondan, yoksa yükseklikten (~2,8 m/kat).
// En üst kat (0 = zemin). Kat sayısı yoksa yükseklikten: çatı payı ~1 m düşülür
export const maxFloor = b => b.levels != null ? Math.max(0, Math.round(b.levels) - 1) : Math.max(0, Math.round((b.h - 1) / (b.storey ?? STOREY)) - 1);

export function pip(x, y, r) {
  let c = false;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % n];
    if ((y1 > y) !== (y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) c = !c;
  }
  return c;
}

// Işının (0,0)'dan (sx,sy) yönünde halkaya ilk girdiği mesafe (t > tMin), yoksa null.
function entry(ring, sx, sy, tMin) {
  let best = null;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1], ex = bx - ax, ey = by - ay, den = sx * ey - sy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ey - ay * ex) / den, u = (ax * sy - ay * sx) / den;
    if (t > tMin && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

// Gözlemci (0,0, metre), güneş yönünde ışın. Bina engeller: ışının binaya GİRDİĞİ noktada
// (ışın en alçak orada) bina tepesi > göz + t*tan(alt). Tam kesişim, adım/mesafe sınırı yok.
// b.dz: bina zemininin gözlemci zeminine göre kotu (tepelik arazi). Gözlemciyi içeren binalar önceden çıkarılmış olmalı.
// skipId: hedef bina, ilk 1 m'deki kesişimleri yok sayılır (cephe noktası duvarın 0,4 m dışında).
// ponytail: min_height (havada duran kısımlar) yok sayılıyor, bina zeminden yükselen katı blok kabul ediliyor.
export const blocked = (...a) => !!blocker(...a);
// Güneşi kesen ilk bina (yoksa null): güneş açısı + binanın yüksekliği ve uzaklığı. Birden çok bina sırayla kesebilir; her an ayrı bakılır.
export function blocker(buildings, alt, az, eye, skipId = null) {
  const sx = Math.sin(az * rad), sy = Math.cos(az * rad), k = Math.tan(alt * rad);
  for (const b of buildings) {
    const top = b.h + (b.dz || 0) - eye;
    if (top <= 0) continue;
    if (Math.max(b.x0 * sx + b.y0 * sy, b.x1 * sx + b.y0 * sy, b.x0 * sx + b.y1 * sy, b.x1 * sx + b.y1 * sy) <= 0) continue; // tamamen arkada
    const t = entry(b.ring, sx, sy, b.id === skipId ? 1 : 0);
    if (t !== null && t * k < top) return b;
  }
  return null;
}

// Binanın seçili andaki yer gölgesi (yerel metre): taban + güneşin tersine h/tan(yükseklik) kaydırılmış taban, dışbükey zarf.
// ponytail: dışbükey zarf L/U biçimli binalarda iç köşeyi de gölge sayar; birleşik çokgen gerekirse kenar dörtgenlerinin birleşimi.
export function shadowRing(b, alt, az) {
  const L = b.h / Math.tan(Math.max(alt, 2) * rad), dx = -Math.sin(az * rad) * L, dy = -Math.cos(az * rad) * L;
  const pts = b.ring.concat(b.ring.map(([x, y]) => [x + dx, y + dy])).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]), half = list => {
    const h = []; for (const p of list) { while (h.length >= 2 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
  return half(pts).concat(half(pts.slice().reverse()));
}

// Yerel metre düzlemi. Boylam farkı ±180°'ye sarılır (antimeridyen); kutba çok yakın kx sıfıra inmesin diye sınırlanır.
export function frame(lat, lon) {
  const kx = 111320 * Math.max(0.01, Math.cos(lat * rad)), ky = 110574;
  return { kx, ky, to: (la, lo) => [((((lo - lon) % 360) + 540) % 360 - 180) * kx, (la - lat) * ky],
           from: (x, y) => [lat + y / ky, ((lon + x / kx + 540) % 360) - 180] };
}

// Overpass çıktısı -> halkalar. Çok-poligon (relation) binalardan kapalı dış halkalar alınır.
// ponytail: birden çok yoldan oluşan dış halkalar birleştirilmiyor (binalarda nadir).
function shapes(elements) {
  const out = [], closed = g => g.length >= 4 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
  for (const el of elements) {
    if (el.type === 'relation') { for (const m of el.members || []) if (m.role === 'outer' && m.geometry && closed(m.geometry)) out.push({ id: el.id, tags: el.tags || {}, geometry: m.geometry }); }
    else if (el.geometry && el.geometry.length >= 4) out.push({ id: el.id, tags: el.tags || {}, geometry: el.geometry });
  }
  return out;
}

// Binaları (lat,lon) merkezli metre düzlemine çevirir. ground(lat,lon) -> zemin kotu verilirse her binaya dz eklenir.
// building:part varsa, parça merkezini içeren dış çizgi atılır (yüksekliği parçalar taşır; çizginin tahmini 12 m'si ezmesin).
// own: noktayı içeren binalar (hesaptan çıkarılır).
const GENERIC = new Set(['yes', 'apartments', 'residential', 'commercial', 'office', 'retail', 'mixed_use']), RESI = new Set(['apartments', 'residential']);
export function localize(elements, lat, lon, ground = null) {
  const F = frame(lat, lon), z0 = ground ? ground(lat, lon) : 0, all = [];
  for (const s of shapes(elements)) {
    const ring = s.geometry.map(p => F.to(p.lat, p.lon)), xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    all.push({ id: s.id, ring, ...height(s.tags), type: s.tags.building ?? 'yes', part: !!s.tags['building:part'], geom: s.geometry, x0, x1, y0, y1, cx, cy,
               dz: ground ? ground(...F.from(cx, cy)) - z0 : 0 });
  }
  // Etiketsiz genel binalar için yakındaki AYNI TÜRDEN ölçülü binaların ortancası (≥3 örnek). Türler karıştırılmaz:
  // kulübe ve garajlar apartmanları alçaltmasın. Apartman/konut, tür varsayılanının altına inmez (komşu az örnek yanıltabilir).
  for (const type of GENERIC) {
    const known = all.filter(b => !b.guessed && b.type === type).map(b => b.h).sort((a, b) => a - b);
    if (known.length < 3) continue;
    const med = known[known.length >> 1];
    for (const b of all) if (b.guessed && b.type === type) b.h = RESI.has(type) ? Math.max(b.h, med) : med;
  }
  const parts = all.filter(b => b.part);
  const keep = all.filter(b => b.part || !parts.some(p => p.cx >= b.x0 && p.cx <= b.x1 && p.cy >= b.y0 && p.cy <= b.y1 && pip(p.cx, p.cy, b.ring)));
  const own = keep.filter(b => pip(0, 0, b.ring));
  return { buildings: keep.filter(b => !own.includes(b)), own };
}

// ---------- arazi ----------
// Zemin kotu ızgarası: merkez ±half m, n×n nokta (Open-Meteo / Copernicus GLO-90, ≤100 nokta/istek).
export function gridPoints(lat, lon, half = 450, n = 10) {
  const F = frame(lat, lon), pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push(F.from(-half + 2 * half * i / (n - 1), -half + 2 * half * j / (n - 1)));
  return pts;
}
// Izgaradan çift doğrusal enterpolasyonla zemin kotu fonksiyonu (dışarısı kenara kırpılır).
export function makeGround(lat, lon, zs, half = 450, n = 10) {
  const F = frame(lat, lon), step = 2 * half / (n - 1);
  return (la, lo) => {
    const [x, y] = F.to(la, lo), fx = Math.max(0, Math.min(n - 1.000001, (x + half) / step)), fy = Math.max(0, Math.min(n - 1.000001, (y + half) / step));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, z = (a, b) => zs[b * n + a];
    return (z(i, j) * (1 - u) + z(i + 1, j) * u) * (1 - v) + (z(i, j + 1) * (1 - u) + z(i + 1, j + 1) * u) * v;
  };
}
// Uzak ufuk (tepeler): 10°'de bir, 600 m–8 km. Yakın alan binalarla zaten hesaplanıyor; GLO-90 bir yüzey
// modeli (ağaç/bina dahil) olduğundan yakını örneklemek binaları iki kez sayardı.
export const HZ_D = [600, 1200, 2500, 4500, 8000], HZ_STEP = 10; // 180 nokta: Open-Meteo kotası için
export function horizonPoints(lat, lon) {
  const F = frame(lat, lon), pts = [];
  for (let a = 0; a < 360; a += HZ_STEP) for (const d of HZ_D) pts.push(F.from(Math.sin(a * rad) * d, Math.cos(a * rad) * d));
  return pts;
}
// zs: horizonPoints sırasıyla kotlar -> her azimut için [mesafe, kot − dünya eğriliği] (kırılma 0,13 ile).
export function makeHorizon(zs) {
  const H = [];
  for (let k = 0; k < 360 / HZ_STEP; k++) H.push(HZ_D.map((d, i) => [d, zs[k * HZ_D.length + i] - d * d / (2 * 6371000) * 0.87]));
  return H;
}
// Göz kotu zEye (deniz seviyesine göre) için az yönündeki ufuk yüksekliği, derece. Azimutlar arası doğrusal.
export function horizonAlt(H, az, zEye) {
  const one = k => Math.max(...H[k].map(([d, z]) => Math.atan2(z - zEye, d) * deg));
  const f = ((az % 360) + 360) % 360 / HZ_STEP, k = Math.floor(f) % H.length, u = f - Math.floor(f);
  return one(k) * (1 - u) + one((k + 1) % H.length) * u;
}

const azOf = (x, y) => (Math.atan2(x, y) * deg + 360) % 360;

// Kenarın dış normali (poligonun dışına bakan), azimut olarak.
function outward(b, i) {
  const [ax, ay] = b.ring[i], [bx, by] = b.ring[(i + 1) % b.ring.length], L = Math.hypot(bx - ax, by - ay);
  let nx = (by - ay) / L, ny = -(bx - ax) / L;
  if (pip((ax + bx) / 2 + nx * 0.5, (ay + by) / 2 + ny * 0.5, b.ring)) { nx = -nx; ny = -ny; }
  return [nx, ny];
}
const facade = (b, i, x, y) => { const [nx, ny] = outward(b, i); return { b, i, x: x + nx * 0.4, y: y + ny * 0.4, az: azOf(nx, ny) }; };

// Dokunulan noktaya (x,y) en yakın bina kenarı (maxD m içinde). Noktayı içeren bina önceliklidir.
export function pickEdge(buildings, x, y, maxD = 30) {
  const inside = buildings.filter(b => pip(x, y, b.ring)), list = inside.length ? inside : buildings;
  let best = null;
  for (const b of list) for (let i = 0; i < b.ring.length - 1; i++) {
    const [ax, ay] = b.ring[i], [bx, by] = b.ring[i + 1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    if (L2 < 1) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), cx = ax + t * dx, cy = ay + t * dy, dd = Math.hypot(x - cx, y - cy);
    if (!best || dd < best.dd) best = { dd, b, i, cx, cy };
  }
  return best && best.dd < maxD ? facade(best.b, best.i, best.cx, best.cy) : null;
}

// Gözlemciden (0,0) bakış yönünde ilk çarpılan bina kenarı (≤ maxD m).
export function rayEdge(buildings, heading, maxD = 200) {
  const sx = Math.sin(heading * rad), sy = Math.cos(heading * rad);
  let best = null;
  for (const b of buildings) for (let i = 0; i < b.ring.length - 1; i++) {
    const [ax, ay] = b.ring[i], [bx, by] = b.ring[i + 1], ex = bx - ax, ey = by - ay, den = sx * ey - sy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (ax * ey - ay * ex) / den, u = (ax * sy - ay * sx) / den; // t: ışın boyunca, u: kenar boyunca
    if (t > 0.5 && t < maxD && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, b, i };
  }
  return best && facade(best.b, best.i, sx * best.t, sy * best.t);
}

// ---------- saat dilimi ----------
// Konumun saat dilimi (IANA, ör. "Europe/Istanbul"); tz null ise tarayıcının saat dilimi.
// Uzaktaki bir eve bakarken gün ve saatler o yerin yerel saatine göre olmalı, tarayıcınınkine göre değil.
const fmts = new Map();
const offsetMin = (tz, d) => {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(fmts.get(tz).formatToParts(d).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000;
};
// tz'de y-m-d günü, gece yarısından min dakika sonrası (yaz saati geçişi dahil)
export function zoned(y, m, d, min, tz) {
  if (!tz) return new Date(y, m - 1, d, 0, min);
  const g = Date.UTC(y, m - 1, d, 0, min);
  let t = g - offsetMin(tz, new Date(g)) * 60000;
  return new Date(g - offsetMin(tz, new Date(t)) * 60000);
}
// Anın tz'deki saat ve dakikası
export function hmIn(date, tz) {
  if (!tz) return { h: date.getHours(), m: date.getMinutes() };
  const x = new Date(date.getTime() + offsetMin(tz, date) * 60000);
  return { h: x.getUTCHours(), m: x.getUTCMinutes() };
}

// ---------- güneş paneli ----------
// Geliş açısı: güneş ışını ile yüzey normali arasındaki açı (0° = dik vuruyor, 90° = sıyırıyor), derece.
// tilt: yüzeyin yataydan eğimi (90 = duvar, 0 = düz çatı), surfAz: yüzeyin baktığı yön.
export function incidence(alt, az, tilt, surfAz) {
  const c = Math.cos(alt * rad) * Math.sin(tilt * rad) * Math.cos((az - surfAz) * rad) + Math.sin(alt * rad) * Math.cos(tilt * rad);
  return Math.acos(Math.max(-1, Math.min(1, c))) * deg;
}
// Açık gökte doğrudan ışınım (DNI), W/m²: Meinel modeli 1353·0,7^(AM^0,678); hava kütlesi Kasten–Young.
// Bulut ve dağınık (diffuse) ışık dahil değil: üst sınır tahmini, gerçek üretim için PVGIS gibi bir model gerekir.
export function clearSkyDNI(alt) {
  if (alt <= 0) return 0;
  const z = 90 - alt, am = 1 / (Math.cos(z * rad) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
  return 1353 * Math.pow(0.7, Math.pow(am, 0.678));
}

// Yıllık yüzey ışınımı (kWh/m²): ölçülmüş saatlik doğrudan normal (DNI) ve dağınık yatay (DHI) ışınım, W/m².
// hourly: { t: [UTC ms, saat başı], dni: [], dhi: [] } — Open-Meteo değerleri önceki saatin ortalaması, bu yüzden güneş
// konumu saatin ortasında (t − 30 dk) alınır. Doğrudan kısım yalnız yüzey görüyorsa ve bina/tepe kesmiyorsa sayılır;
// dağınık kısım izotropik gök: DHI·(1+cos eğim)/2 (çevre binaların gökyüzünü kısmen kapatması ihmal edilir).
export function annualPOA(env, f, eye, tilt, hourly) {
  const { buildings, own } = localize(env.el, f.lat, f.lon, env.ground), all = buildings.concat(own);
  const zEye = (env.ground ? env.ground(f.lat, f.lon) : 0) + eye, sky = (1 + Math.cos(tilt * rad)) / 2;
  let beam = 0, diffuse = 0;
  for (let i = 0; i < hourly.t.length; i++) {
    const dni = hourly.dni[i] || 0, dhi = hourly.dhi[i] || 0;
    if (dni <= 0 && dhi <= 0) continue;
    diffuse += dhi * sky;
    if (dni <= 0) continue;
    const p = sunpos(f.lat, f.lon, new Date(hourly.t[i] - 1800000));
    if (p.alt <= 0) continue;
    const inc = incidence(p.alt, p.az, tilt, f.az);
    if (inc >= 90 || (tilt >= 90 && Math.abs(((p.az - f.az + 540) % 360) - 180) >= 85)) continue;
    if (env.hz && p.alt < horizonAlt(env.hz, p.az, zEye)) continue;
    if (blocked(all, p.alt, p.az, eye, f.id)) continue;
    beam += dni * Math.cos(inc * rad) * iam(inc);
  }
  return { beam: beam / 1000, diffuse: diffuse / 1000, total: (beam + diffuse) / 1000 };
}
// Panel camının eğik ışığı yansıtması (geliş açısı kaybı), ASHRAE modeli b0 = 0,05
export const iam = inc => inc >= 90 ? 0 : Math.max(0, 1 - 0.05 * (1 / Math.cos(inc * rad) - 1));
// Panel üretimi: kWh/kWp = yüzey ışınımı × performans oranı; m² başına = ışınım × modül verimi × performans oranı.
// PR 0,77: kablo/invertör/kirlilik (~%20) ve ortalama sıcaklık kaybını içerir. PVGIS (SARAH3, %20 kayıp) ile karşılaştırılarak seçildi.
export const PV = { pr: 0.77, eff: 0.21 };
export const pvYield = poa => ({ perKWp: poa * PV.pr, perM2: poa * PV.eff * PV.pr });

// Bir cephenin gün boyu güneşi. env: {el: Overpass elemanları, ground: zemin fn|null, hz: ufuk|null}.
// f: {lat, lon, az, id}, cephe noktası binanın 0,4 m dışında. eye: pencerenin zeminden yüksekliği.
// state: 'vis' güneş ulaşıyor, 'block' bina kesiyor, 'terrain' tepe kesiyor, 'behind' güneş cephenin arkasında;
// güneş ufkun altındaysa dilim yok. Gün (y, m, d), tz saat diliminde (null = tarayıcı).
// tilt: 90 = duvar (varsayılan); daha küçükse aynı yöne bakan çatı paneli (eye o zaman çatı yüksekliği olmalı).
// Her dilime geliş açısı (inc) eklenir; vis dilimlerinden açık gök doğrudan enerji kWh/m² (energy) toplanır.
// env.gs (isteğe bağlı): yüksekliği tahmin edilen binaları bu katsayıyla ölçekle (belirsizlik aralığı için)
export function facadeDay(env, f, eye, y, m, d, step = 5, tz = null, tilt = 90) {
  const { buildings, own } = localize(env.el, f.lat, f.lon, env.ground), all = buildings.concat(own);
  if (env.gs) for (const b of all) if (b.guessed) b.h *= env.gs;
  const zEye = (env.ground ? env.ground(f.lat, f.lon) : 0) + eye, slots = [];
  // Gerçek anlar üzerinden yerel gece yarısından ertesi gece yarısına: yaz saati günlerinde 23/25 saat doğru sayılır
  const n = new Date(Date.UTC(y, m - 1, d + 1)), t0 = +zoned(y, m, d, 0, tz), t1 = +zoned(n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate(), 0, tz);
  for (let ms = t0; ms < t1; ms += step * 60000) {
    const t = new Date(ms), p = sunpos(f.lat, f.lon, t);
    if (p.alt <= 0) continue;
    const inc = incidence(p.alt, p.az, tilt, f.az);
    // duvar: güneş cephe düzleminin 85° içinde olmalı (eski ölçüt korunur); eğik panel: geliş açısı < 85°
    const front = tilt >= 90 ? Math.abs(((p.az - f.az + 540) % 360) - 180) < 85 : inc < 85;
    const by = front && !(env.hz && p.alt < horizonAlt(env.hz, p.az, zEye)) ? blocker(all, p.alt, p.az, eye, f.id) : null;
    slots.push({ t, alt: p.alt, az: p.az, inc, by: by?.id ?? null, state: !front ? 'behind' : env.hz && p.alt < horizonAlt(env.hz, p.az, zEye) ? 'terrain' : by ? 'block' : 'vis' });
  }
  const windows = [];
  for (const s of slots) {
    const w = windows[windows.length - 1], end = new Date(+s.t + step * 60000);
    if (s.state !== 'vis') continue;
    if (w && +w[1] === +s.t) w[1] = end; else windows.push([s.t, end]);
  }
  const hours = st => slots.filter(s => st.includes(s.state)).length * step / 60;
  const energy = slots.reduce((e, s) => e + (s.state === 'vis' ? clearSkyDNI(s.alt) * Math.cos(s.inc * rad) * step / 60 : 0), 0) / 1000;
  return { slots, windows, visH: hours(['vis']), frontH: hours(['vis', 'block', 'terrain']), energy };
}

// Yükseklik güveni: sonucu etkileyebilecek binalardan kaçının yüksekliği tahmini (OSM'de etiket yok).
// Yalnız güneşin gelebileceği yarı düzlemdekiler sayılır: cephe için cephenin önü (dirAz = cephe yönü),
// serbest nokta için güneşin geldiği taraf (kuzey yarımkürede güney). buildings origin'e göre yerel olmalı.
export function heightConfidence(buildings, dirAz, target = null, maxD = 150) {
  const sx = Math.sin(dirAz * rad), sy = Math.cos(dirAz * rad);
  const rel = buildings.filter(b => b !== target && Math.hypot(b.cx, b.cy) < maxD && b.cx * sx + b.cy * sy > 0);
  const g = rel.filter(b => b.guessed).length, share = rel.length ? g / rel.length : 0, tg = !!target?.guessed;
  return { n: rel.length, guessed: g, share, targetGuessed: tg, level: share >= 0.75 ? 'low' : share >= 0.4 || tg ? 'mid' : 'ok' };
}
