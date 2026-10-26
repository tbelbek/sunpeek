// node test.mjs — sun.js'i bağımsız bir NOAA (Python) uygulamasına ve sunrise-sunset.org değerlerine karşı doğrular.
import assert from 'node:assert/strict';
import { sunpos, dayEvents, blocked, blocker, shadowRing, facadeRange, localize, frame, pickEdge, rayEdge, facadeDay, height, maxFloor, zoned, hmIn, heightConfidence, incidence, clearSkyDNI, annualPOA, pvYield, iam, gridPoints, makeGround, horizonPoints, makeHorizon, horizonAlt, HZ_D, HZ_STEP } from './sun.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} != ${b}`);
const utcHM = t => new Date(Math.floor(t / 60000) * 60000).toISOString().slice(11, 16); // saniyeyi keser

// Bağımsız NOAA uygulamasından referanslar (alt, az)
for (const [lat, lon, iso, alt, az] of [
  [51.4779, -0.0015, '2026-06-21T15:00Z', 45.948, 247.698],         // Greenwich Gözlemevi
  [69.65, 18.96, '2026-06-21T22:00Z', 3.664, 349.424],              // Tromsø, gece yarısı güneşi
  [-33.87, 151.21, '2026-01-15T03:30Z', 67.235, 298.496],           // Sidney
  [40.99, 29.02, '2026-03-20T09:00Z', 45.86, 153.899],              // İstanbul
]) {
  const p = sunpos(lat, lon, new Date(iso));
  near(p.alt, alt, 0.01, `alt ${iso}`); near(p.az, az, 0.01, `az ${iso}`);
}

// Greenwich 21 Haziran, sunrise-sunset.org (UTC): doğum 03:42:44, batım 20:20:56, öğle 12:01:50
const g = dayEvents(51.4779, -0.0015, 2026, 6, 21);
assert.equal(utcHM(g.sunrise), '03:42'); assert.equal(utcHM(g.sunset), '20:20'); assert.equal(utcHM(g.noon), '12:01');

// Kutup günü / gecesi
assert.equal(dayEvents(69.65, 18.96, 2026, 6, 21).polar, 'day');
assert.equal(dayEvents(69.65, 18.96, 2026, 12, 21).polar, 'night');

// Gölge: güneyde 10 m ötede 20 m'lik bina. 30°'de keser (1.5+10*tan30≈7.3<20), kuzeyden bakınca kesmez.
const sq = (cx, cy, r, ry = r) => [[cx - r, cy - ry], [cx + r, cy - ry], [cx + r, cy + ry], [cx - r, cy + ry], [cx - r, cy - ry]];
const el = (ring, tags, id) => ({ type: 'way', id, tags, geometry: ring.map(([x, y]) => ({ lon: 18 + x / (111320 * Math.cos(60 * Math.PI / 180)), lat: 60 + y / 110574 })) });
const { buildings, own } = localize([el(sq(0, -15, 5), { height: '20' }, 1), el(sq(0, 0, 3), { building: 'house' }, 2)], 60, 18);
assert.ok(own.length === 1 && buildings.length === 1, 'gözlemcinin kendi binası ayrılmalı');
assert.equal(blocked(buildings, 30, 180, 1.5), true);
assert.equal(blocked(buildings, 30, 0, 1.5), false);
assert.equal(blocked(buildings, 70, 180, 1.5), false); // 1.5+10*tan70≈29>20
assert.equal(blocker(buildings, 30, 180, 1.5)?.h, 20, 'güneşi kesen bina döner'); assert.equal(blocker(buildings, 30, 0, 1.5), null);
{ // gölge: 10 m bina, güneş güneyde 45° → gölge 10 m kuzeye uzanır, tabanı kapsar
  const r = shadowRing({ h: 10, ring: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] }, 45, 180), ys = r.map(p => p[1]), xs = r.map(p => p[0]);
  const n = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(n(Math.max(...ys), 20) && n(Math.min(...ys), 0) && n(Math.min(...xs), 0) && n(Math.max(...xs), 10), JSON.stringify(r));
}

// Mesafe sınırı yok: 300 m güneyde 60 m kule, 10°'de keser (1.5+300*tan10≈54<60); eski 180 m sınırı kaçırırdı
assert.equal(blocked(localize([el(sq(0, -305, 5), { height: '60' })], 60, 18).buildings, 10, 180, 1.5), true);
// İnce duvar (0,8 m) 20 m'de: tam kesişim kaçırmaz
assert.equal(blocked(localize([el(sq(0, -20, 10, 0.4), { height: '10' })], 60, 18).buildings, 10, 180, 1.5), true);

// Eğimli arazi: 50 m güneyde 10 m bina, 15°'de düz zeminde kesmez (1.5+50*tan15≈14,9), 10 m yukarıda dururken keser
{
  const zOf = ([la]) => -(la - 60) * 110574 * 0.2; // güneye doğru yükselen yamaç, %20
  const ground = makeGround(60, 18, gridPoints(60, 18).map(zOf));
  near(ground(60 - 50 / 110574, 18), 10, 0.01, 'zemin enterpolasyonu');
  const b = [el(sq(0, -55, 5), { height: '10' })];
  assert.equal(blocked(localize(b, 60, 18).buildings, 15, 180, 1.5), false);
  assert.equal(blocked(localize(b, 60, 18, ground).buildings, 15, 180, 1.5), true);
}

// building:part: parçalar dış çizginin çoğunu kaplıyorsa etiketsiz dış çizgi (tahmini 12 m) atılır, 3 m'lik parça kalır -> 30°'de kesmez
{
  const r = localize([el(sq(0, -15, 5), { building: 'yes' }, 10), el(sq(0, -15, 4.8), { 'building:part': 'yes', height: '3' }, 11)], 60, 18);
  assert.deepEqual(r.buildings.map(b => b.id), [11]);
  assert.equal(blocked(r.buildings, 30, 180, 1.5), false);
  // parça yalnız bir köşeyi kaplıyorsa dış çizgi kalır (yoksa binanın geri kalanı hiç gölge yapmaz)
  const q = localize([el(sq(0, -15, 5), { building: 'yes' }, 10), el(sq(3, -12, 2), { 'building:part': 'yes', height: '3' }, 11)], 60, 18);
  assert.deepEqual(q.buildings.map(b => b.id).sort(), [10, 11]);
}
// min_height: havada başlayan yapının (köprü) altından ışık geçer, üstüne çarpar
{
  const br = localize([el(sq(0, -20, 5), { height: '12', min_height: '8' })], 60, 18).buildings;
  assert.equal(blocked(br, 5, 180, 1.5), false, 'ışın 1,5 m + 15 m·tan5° ≈ 3 m: köprünün altından');
  assert.equal(blocked(br, 25, 180, 1.5), true, 'ışın ≈ 8,5–11 m: köprüye çarpar');
}
// Çok-poligon (relation) bina sayılır
{
  const w = el(sq(0, -15, 5), {});
  const r = localize([{ type: 'relation', id: 20, tags: { building: 'yes', height: '20' }, members: [{ role: 'outer', geometry: w.geometry }] }], 60, 18);
  assert.equal(r.buildings.length, 1); assert.equal(blocked(r.buildings, 30, 180, 1.5), true);
}
// Yükseklik etiketleri
near(height({ height: '12,5' }).h, 12.5, 1e-9, 'virgül'); near(height({ height: "40'" }).h, 12.192, 1e-3, 'feet');
near(height({ 'building:levels': '4', 'roof:levels': '1' }).h, 14.5, 1e-9, 'çatı katı'); assert.equal(height({ building: 'house' }).guessed, true);
assert.equal(maxFloor(height({ 'building:levels': '4' })), 3); assert.equal(maxFloor(height({ building: 'apartments' })), 3); // 12 m tahmini
assert.equal(maxFloor(height({ height: '6' })), 1);

// Ufuk: güneyde ~1 km'de 200 m tepe; doğuda düz -> ~0°
const hill = makeHorizon(horizonPoints(60, 18).map((_, i) => (i === (180 / HZ_STEP) * HZ_D.length + 1 ? 200 : 0)));
const D1 = HZ_D[1]; // tepe ikinci mesafede
near(horizonAlt(hill, 180, 0), Math.atan2(200 - D1 ** 2 / (2 * 6371000) * 0.87, D1) * 180 / Math.PI, 1e-9, 'tepe');
near(horizonAlt(hill, 90, 0), 0, 0.05, 'düz ufuk');
console.log('ok');

// Cephe: gözlemcinin 5 m kuzeyinde, güneye bakan duvar (60°K)
{
  const target = el([[-5, 5], [5, 5], [5, 15], [-5, 15], [-5, 5]], { height: '10' }, 1);
  const wall = el([[-20, -30], [20, -30], [20, -10], [-20, -10], [-20, -30]], { height: '40' }, 2);
  const { buildings } = localize([target], 60, 18), F = frame(60, 18);
  const tap = pickEdge(buildings, 0, 5.5), ray = rayEdge(buildings, 0);
  assert.equal(pickEdge(buildings, 0, 3, 1), null, 'duvarın 2 m dışı, 1 m toleransta seçilmez');
  near(pickEdge(buildings, 0, 3, 3).az, 180, 0.5, 'duvarın 2 m dışı, 3 m toleransta seçilir');
  for (const e of [tap, ray]) { near(e.az, 180, 0.5, 'cephe güneye'); near(e.y, 4.6, 0.01, 'cephe noktası 0,4 m dışarıda'); }
  const [flat, flon] = F.from(tap.x, tap.y), f = { lat: flat, lon: flon, az: tap.az, id: 1 };
  const noon = r => r.slots.reduce((a, s) => s.alt > a.alt ? s : a);
  const open = facadeDay({ el: [target] }, f, 1.5, 2026, 6, 21);
  assert.equal(noon(open).state, 'vis'); assert.ok(open.visH > 8 && Math.abs(open.visH - open.frontH) < 5 / 60, `açık cephe ${open.visH}`);
  { // geçiş inceltmesi: güneşin güneye bakan duvara girdiği an (azimut 90°) saniyelik bağımsız taramayla ±30 sn içinde
    const [s0] = open.windows[0]; let t = +s0 - 15 * 60000; while (sunpos(f.lat, f.lon, new Date(t)).az < 90) t += 1000;
    assert.ok(Math.abs(t - s0) < 30000, `pencere başlangıcı ${new Date(s0).toISOString()} vs ${new Date(t).toISOString()}`); }
  assert.ok(open.slots.some(s => s.state === 'behind'), 'sabah/akşam güneş arkada');
  const shaded = facadeDay({ el: [target, wall] }, f, 1.5, 2026, 6, 21);
  { // güven aralığı: alt ≤ sonuç ≤ üst; tahmini yükseklikte aralık ölçülmüşten geniş, güven düşük
    const near = el([[-20, -30], [20, -30], [20, -14], [-20, -14], [-20, -30]], { height: '14' }, 2), guess = el([[-20, -30], [20, -30], [20, -14], [-20, -14], [-20, -30]], { building: 'apartments' }, 2);
    const rng = e => facadeRange({ lo: { el: e, hs: 1 }, hi: { el: e, hs: -1 } }, f, 1.5, 2026, 12, 21);
    const base = facadeDay({ el: [target, near] }, f, 1.5, 2026, 12, 21).visH, a = rng([target, near]), b = rng([target, guess]);
    assert.ok(a.lo <= base && base <= a.hi, JSON.stringify([a, base]));
    assert.ok(b.hi - b.lo >= a.hi - a.lo && b.conf <= a.conf, JSON.stringify([a, b]));
  }
  assert.equal(noon(shaded).state, 'block'); assert.ok(shaded.visH < open.visH);
  // Belirsizlik: yüksekliği tahmin edilen bina env.gs ile ölçeklenir; etiketli bina etkilenmez
  const gw = el([[-20, -30], [20, -30], [20, -10], [-20, -10], [-20, -30]], { building: 'yes' }, 3);
  const g = gs => facadeDay({ el: [target, gw], gs }, f, 1.5, 2026, 6, 21).visH;
  assert.ok(g(0.3) >= g(1) && g(1) >= g(3) && g(3) < g(0.3), `tahmini yükseklik aralığı ${g(0.3)} ${g(1)} ${g(3)}`);
  assert.equal(facadeDay({ el: [target, wall], gs: 3 }, f, 1.5, 2026, 6, 21).visH, shaded.visH, 'etiketli bina ölçeklenmez');
  // Aralık öğlesi ~6,6°: güneydeki ~9°'lik tepe keser
  const dec = facadeDay({ el: [target], hz: hill }, f, 1.5, 2026, 12, 21);
  assert.equal(noon(dec).state, 'terrain');
  assert.ok(dec.visH < facadeDay({ el: [target] }, f, 1.5, 2026, 12, 21).visH, 'tepe yalnız güney dilimini keser');
}
console.log('cephe ok');

// Saat dilimi: konumun yerel günü (yaz saati dahil)
assert.equal(zoned(2026, 6, 21, 0, 'Australia/Sydney').toISOString(), '2026-06-20T14:00:00.000Z');
assert.equal(zoned(2026, 6, 21, 12 * 60, 'Europe/Istanbul').toISOString(), '2026-06-21T09:00:00.000Z');
assert.equal(zoned(2026, 3, 29, 3 * 60, 'Europe/Stockholm').toISOString(), '2026-03-29T01:00:00.000Z'); // yaz saatine geçiş günü
assert.deepEqual(hmIn(new Date('2026-12-21T19:40:00Z'), 'Australia/Sydney'), { h: 6, m: 40 });
{ // Sidney cephesi, Stockholm saatindeki tarayıcıdan bakılsa da gün Sidney gecesinde bölünmemeli
  const F = frame(-33.8568, 151.2153), f = { lat: -33.8568, lon: 151.2153, az: 0, id: 0 }; // kuzeye bakan cephe (güney yarımkürede güneşli)
  const r = facadeDay({ el: [] }, f, 1.5, 2026, 12, 21, 5, 'Australia/Sydney');
  const first = hmIn(r.slots[0].t, 'Australia/Sydney'), lastS = hmIn(r.slots.at(-1).t, 'Australia/Sydney');
  assert.ok(first.h >= 5 && first.h <= 6 && lastS.h >= 19 && lastS.h <= 20, `Sidney günü ${JSON.stringify([first, lastS])}`);
}
console.log('saat dilimi ok');

// Bölge ortancası: 10 ölçülü 24 m bina varsa etiketsiz apartman 12 m değil 24 m sayılır; garaj 3 m kalır
{
  const tagged = Array.from({ length: 10 }, (_, i) => el(sq(100 + i * 20, 100, 5), { building: 'apartments', height: '24' }, 100 + i));
  const r = localize([...tagged, el(sq(0, -30, 5), { building: 'apartments' }, 1), el(sq(30, -30, 3), { building: 'garage' }, 2)], 60, 18);
  assert.equal(r.buildings.find(b => b.id === 1).h, 24); assert.equal(r.buildings.find(b => b.id === 2).h, 3);
  const few = localize([...tagged.slice(0, 2), el(sq(0, -30, 5), { building: 'apartments' }, 1)], 60, 18);
  assert.equal(few.buildings.find(b => b.id === 1).h, 12, '3 örnekten azında varsayılan kalır');
  // Türler karışmaz (Ärlegatan hatası): 10 küçük "yes" bina apartmanı alçaltmaz; az katlı apartman komşular varsayılanın altına çekemez
  const sheds = Array.from({ length: 10 }, (_, i) => el(sq(100 + i * 20, 200, 3), { building: 'yes', height: '4' }, 200 + i));
  const low = Array.from({ length: 5 }, (_, i) => el(sq(100 + i * 20, 300, 5), { building: 'apartments', height: '10' }, 300 + i));
  const mix = localize([...sheds, ...low, el(sq(0, -30, 5), { building: 'apartments' }, 1), el(sq(0, 60, 3), { building: 'yes' }, 2)], 60, 18);
  assert.equal(mix.buildings.find(b => b.id === 1).h, 12, 'apartman küçük binalarla alçalmaz'); assert.equal(mix.buildings.find(b => b.id === 2).h, 4, '"yes" kendi türünün ortancası');
  // Kat yüksekliği: tek sabit; yükseklik + kat sayısı varsa binanın kendisi (sınırlı)
  assert.equal(maxFloor({ h: 16, levels: null }), 4); assert.equal(maxFloor({ h: 12, levels: null }), 3); assert.equal(maxFloor({ h: 10, levels: null }), 2);
  assert.equal(height({ building: 'apartments', height: '20', 'building:levels': '5' }).storey, 4); assert.equal(height({ height: '30', 'building:levels': '5' }).storey, 4.2);
}
console.log('ortanca ok');

// Yedek kaynak: PMTiles karo kimliği (Hilbert) belirtimdeki değerler; gömülü saat dilimi
{
  const { tileId } = await import('./tiles.js');
  assert.deepEqual([tileId(0, 0, 0), tileId(1, 0, 0), tileId(1, 0, 1), tileId(1, 1, 1), tileId(1, 1, 0), tileId(2, 0, 0), tileId(3, 7, 0)], [0, 1, 2, 3, 4, 5, 84]);
  const { default: tz } = await import('./tz.js');
  assert.deepEqual([tz(57.69, 11.92), tz(40.99, 29.03), tz(-33.86, 151.21)], ['Europe/Stockholm', 'Europe/Istanbul', 'Australia/Sydney']);
}
console.log('yedek ok');

// Güven: yalnız cephenin önündeki binalar sayılır
{
  const front = [0, 1, 2].map(i => el(sq(-20 + i * 20, -40, 5), { building: 'yes' }, 30 + i));          // güneyde, tahmini
  const behind = [0, 1, 2, 3].map(i => el(sq(-30 + i * 20, 40, 5), { building: 'yes', height: '9' }, 40 + i)); // kuzeyde, ölçülü
  const { buildings } = localize([...front, ...behind], 60, 18);
  const south = heightConfidence(buildings, 180), north = heightConfidence(buildings, 0);
  assert.deepEqual([south.n, south.guessed, south.level], [3, 3, 'low']);   // güneye bakan cephe: önündeki 3'ü de tahmini
  assert.deepEqual([north.n, north.guessed, north.level], [4, 0, 'ok']);    // kuzeye bakan: önünde ölçülü binalar
  assert.equal(heightConfidence(buildings, 0, { guessed: true }).level, 'mid', 'hedef binanın kendisi tahminiyse uyar');
}
console.log('güven ok');

// Sağlamlık: kötü OSM etiketleri, antimeridyen, kutup, yaz saati
assert.equal(height({ building: 'constructor' }).h, 9, 'prototip üyesi yükseklik olmaz');
assert.equal(height({ height: 'Infinity' }).h, 9); assert.equal(height({ height: '-5' }).h, 9); assert.equal(height({ height: '1e9' }).h, 9);
{
  const F = frame(0, 179.9995), [x] = F.to(0, -179.9995); near(x, 111.32, 0.5, 'antimeridyenin öbür yanı ~111 m doğuda');
  near(F.from(x, 0)[1], -179.9995, 1e-6, 'geri dönüşüm de sarılır');
  assert.ok(Number.isFinite(frame(90, 0).to(89.999, 10)[0]), 'kutupta sonlu');
}
{
  const f = { lat: 59.33, lon: 18.07, az: 180, id: 0 }, ok = r => r.slots.every((s, i) => i === 0 || s.t > r.slots[i - 1].t);
  const spring = facadeDay({ el: [] }, f, 1.5, 2026, 3, 29, 5, 'Europe/Stockholm'), fall = facadeDay({ el: [] }, f, 1.5, 2026, 10, 25, 5, 'Europe/Stockholm');
  assert.ok(ok(spring) && ok(fall), 'yaz saati günlerinde dilimler tekrar etmez, sıralı');
  const first = hmIn(spring.slots[0].t, 'Europe/Stockholm');
  assert.ok(first.h >= 5 && first.h <= 7, `29 Mart gün doğumu yerel ~06 ${JSON.stringify(first)}`);
}
console.log('sağlamlık ok');

// Güneş paneli: geliş açısı ve açık gök ışınımı
near(incidence(30, 180, 90, 180), 30, 1e-9, 'güneye bakan duvar, güneş güneyde 30° → geliş 30°');
near(incidence(90, 0, 0, 180), 0, 1e-9, 'düz çatı, güneş tepede → geliş 0°');
near(incidence(30, 180, 60, 180), 0, 1e-9, '60° eğik panel güneye, güneş 30° → dik');
near(incidence(30, 90, 90, 180), Math.acos(0) * 180 / Math.PI, 1e-9, 'yandan gelen ışın → 90°');
assert.equal(clearSkyDNI(-1), 0);
assert.ok(clearSkyDNI(60) > 850 && clearSkyDNI(60) < 1000, `öğle DNI ~900 W/m² ${clearSkyDNI(60)}`);
assert.ok(clearSkyDNI(5) < clearSkyDNI(30), 'alçak güneş daha zayıf');
{
  const f = { lat: 51.48, lon: 0, az: 180, id: 0 };
  const wall = facadeDay({ el: [] }, f, 1.5, 2026, 6, 21, 5, 'Europe/London'), roof = facadeDay({ el: [] }, f, 1.5, 2026, 6, 21, 5, 'Europe/London', 35);
  assert.ok(roof.energy > wall.energy && wall.energy > 0, `yazın 35° çatı > duvar: ${roof.energy.toFixed(2)} > ${wall.energy.toFixed(2)} kWh/m²`);
  assert.ok(roof.energy > 4 && roof.energy < 9, `açık gök yaz günü 35° güney panel ~6-8 kWh/m²: ${roof.energy.toFixed(2)}`);
}
console.log('panel ok');

// Yıllık: sentetik saatlik veri. Her saat DNI 500 / DHI 100 W/m² ve gölge yoksa, güneye bakan 35° panel duvardan fazla toplar;
// güneydeki yüksek duvar doğrudan kısmı keser, dağınık kısım kalır.
{
  const t = [], dni = [], dhi = []; const t0 = Date.UTC(2025, 0, 1);
  for (let h = 0; h < 24 * 365; h++) { t.push(t0 + h * 3600000); dni.push(500); dhi.push(100); }
  const H = { t, dni, dhi }, f = { lat: 51.48, lon: 0, az: 180, id: 0 };
  const roof = annualPOA({ el: [] }, f, 1.5, 35, H), wall = annualPOA({ el: [] }, f, 1.5, 90, H);
  assert.ok(roof.beam > wall.beam && wall.beam > 0, `çatı ${roof.beam.toFixed(0)} > duvar ${wall.beam.toFixed(0)}`);
  near(wall.diffuse, 876 * 0.5, 1, 'duvar gökyüzünün yarısını görür'); // 8760 h × 0,1 kWh × 0,5
  const target = el([[-5, 5], [5, 5], [5, 15], [-5, 15], [-5, 5]], { height: '10' }, 1);
  const wallEl = el([[-200, -60], [200, -60], [200, -10], [-200, -10], [-200, -60]], { height: '300' }, 2);
  const F = frame(60, 18), [la, lo] = F.from(0, 4.6), g = { lat: la, lon: lo, az: 180, id: 1 };
  const open = annualPOA({ el: [target] }, g, 1.5, 90, H), shaded = annualPOA({ el: [target, wallEl] }, g, 1.5, 90, H);
  assert.ok(shaded.beam < open.beam * 0.2 && near(shaded.diffuse, open.diffuse, 1e-9, 'dağınık aynı') === undefined, `gölge doğrudanı keser ${shaded.beam.toFixed(0)}/${open.beam.toFixed(0)}`);
  near(pvYield(1000).perKWp, 770, 1e-9, 'PR 0,77'); near(pvYield(1000).perM2, 161.7, 1e-9, '%21 × 0,77');
  assert.equal(iam(0), 1); assert.ok(iam(60) > 0.9 && iam(85) < iam(60) && iam(90) === 0, 'IAM eğik ışıkta azalır');
}
console.log('yıllık ok');

// Çeviriler: her dilde İngilizcedeki tüm anahtarlar ve aynı {yer tutucular} olmalı
{
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null }, configurable: true });
  const { allKeys } = await import('./i18n.js');
  const src = (await import('node:fs')).readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');
  const K = allKeys(), en = new Set(K.en);
  for (const [l, ks] of Object.entries(K)) {
    const missing = [...en].filter(k => !ks.includes(k)), extra = ks.filter(k => !en.has(k));
    assert.deepEqual([missing, extra], [[], []], `${l}: eksik/fazla anahtar`);
  }
  // index.html'de kullanılan her anahtar sözlükte olmalı
  const html = (await import('node:fs')).readFileSync(new URL('./index.html', import.meta.url), 'utf8') + (await import('node:fs')).readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const used = new Set([...html.matchAll(/data-t(?:-title)?="(\w+)"/g), ...html.matchAll(/\btr\('(\w+)'/g), ...html.matchAll(/'(a(?:Off|Asking|Waiting|Nodata|Denied|None)|which(?:Sel|Own)|rel(?:Right|Left)|gps(?:Ellipsoid|Off))'/g)].map(m => m[1]));
  for (const k of used) assert.ok(en.has(k), `index.html'deki '${k}' anahtarı sözlükte yok`);
  // yer tutucular dil başına aynı (metin bloklarını kaba ayrıştırma)
  const blocks = Object.fromEntries([...src.matchAll(/^  (\w\w): \{([\s\S]*?)^  \},/gm)].map(m => [m[1], m[2]]));
  const ph = (b, k) => { const m = b.match(new RegExp(`\\b${k}: (['"])((?:\\\\.|(?!\\1).)*)\\1`)); return m ? [...m[2].matchAll(/\{(\w+)\}/g)].map(x => x[1]).sort().join() : null; };
  for (const k of en) for (const l of Object.keys(blocks)) assert.equal(ph(blocks[l], k), ph(blocks.en, k), `${l}.${k} yer tutucuları farklı`);
}
console.log('çeviri ok');

// Düz ikon seti: hiçbir çeviri emoji ile başlamaz ve emoji içermez (ikonlar arayüzde SVG)
{
  const src = (await import('node:fs')).readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');
  const emo = src.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.equal(emo, null, `i18n.js'te emoji kaldı: ${emo?.[0]}`);
}
console.log('emoji yok ok');

// Codex doğruluk incelemesi regresyonları
{
  // havada duran yapı (köprü/çıkma): taban 10 m, tepe 20 m, 10–30 m ileride
  const slab = { id: 9, ring: [[-5, 10], [5, 10], [5, 30], [-5, 30], [-5, 10]], x0: -5, x1: 5, y0: 10, y1: 30, h: 20, minH: 10 };
  assert.ok(blocked([slab], 30, 0, 0), 'alttan girip içinde yükselen ışın keser');
  assert.ok(!blocked([slab], 70, 0, 0), 'tepeden geçen ışın kesmez');
  assert.ok(!blocked([slab], 10, 0, 0), 'altından geçen ışın kesmez');
  // gece yarısını aşan güneş (80°K, 21 Haziran): pencere tam gün sonunda kapanır, 23:59:50'de değil
  const day = facadeDay({ el: [] }, { lat: 80, lon: 0, az: 180, id: null }, 1.5, 2026, 6, 21, 5, 'UTC', 0);
  assert.equal(day.windows.length, 1); assert.equal(+day.windows[0][1], Date.UTC(2026, 5, 22), 'pencere sonu');
  assert.equal(+day.windows[0][0], Date.UTC(2026, 5, 21), 'pencere başı');
  // adım günü tam bölmüyor (7 dk): son parça da sayılır
  assert.equal(+facadeDay({ el: [] }, { lat: 80, lon: 0, az: 180, id: null }, 1.5, 2026, 6, 21, 7, 'UTC', 0).windows[0][1], Date.UTC(2026, 5, 22));
}
console.log('codex regresyonları ok');
