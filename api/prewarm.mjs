// Paylaşılan önbelleği Avrupa'nın büyük şehir merkezleriyle önceden doldurur: ilk ziyaretçi Overpass'ı beklemesin.
// API kapsayıcısında çalışır ve sunucunun kendi /api/cells uç noktasını kullanır (çekme, saklama, bütçe sunucuda):
//   docker exec -d sunpeek-api node prewarm.mjs          (arka planda; ilerleme: docker exec sunpeek-api cat /tmp/prewarm.log)
// Zaten saklı hücreler sunucuda atlanır, yarıda kalırsa yeniden çalıştırmak güvenlidir. Overpass'ı yormamak için bloklar sırayla
// ve aralıklı gider; Overpass günlük bütçesi (sunucuda 3000) dolarsa ertesi gün kaldığı yerden devam edilir.
import fs from 'node:fs';
const API = process.env.API ?? 'http://127.0.0.1:8081', R = +(process.env.RADIUS_KM ?? 2.5), CELL = 0.005, PAUSE = +(process.env.PAUSE_MS ?? 8000);
const LOG = '/tmp/prewarm.log', log = m => fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const CITIES = {
  London: [51.507, -0.128], Paris: [48.857, 2.352], Berlin: [52.520, 13.405], Madrid: [40.417, -3.704], Rome: [41.903, 12.496],
  Barcelona: [41.389, 2.165], Milan: [45.464, 9.190], Munich: [48.137, 11.575], Hamburg: [53.551, 9.993], Vienna: [48.208, 16.373],
  Amsterdam: [52.373, 4.893], Brussels: [50.847, 4.357], Copenhagen: [55.676, 12.568], Stockholm: [59.329, 18.069], Oslo: [59.914, 10.752],
  Helsinki: [60.170, 24.938], Gothenburg: [57.707, 11.967], Malmo: [55.605, 13.004], Uppsala: [59.858, 17.639], Dublin: [53.350, -6.260],
  Lisbon: [38.722, -9.139], Porto: [41.150, -8.611], Prague: [50.075, 14.438], Warsaw: [52.230, 21.012], Krakow: [50.065, 19.945],
  Budapest: [47.498, 19.040], Zurich: [47.377, 8.540], Geneva: [46.204, 6.143], Lyon: [45.764, 4.836], Marseille: [43.296, 5.370],
  Frankfurt: [50.110, 8.682], Cologne: [50.938, 6.960], Rotterdam: [51.924, 4.478], Athens: [37.984, 23.728], Istanbul: [41.015, 28.979],
  Valencia: [39.470, -0.376], Seville: [37.389, -5.984], Naples: [40.852, 14.268], Turin: [45.070, 7.687], Edinburgh: [55.953, -3.188],
  Manchester: [53.481, -2.243], Bucharest: [44.426, 26.103], Sofia: [42.698, 23.322], Zagreb: [45.815, 15.982], Ljubljana: [46.057, 14.506],
  Riga: [56.950, 24.105], Tallinn: [59.437, 24.754], Vilnius: [54.687, 25.280],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function block(keys) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${API}/api/cells?k=${keys.join(',')}`).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    if (j && !j.missing.length) return true;
    if (r?.status === 400) { log(`bad block ${keys[0]}`); return false; }
    await sleep(25000); // sunucu arka planda çekmeye devam ediyor
  }
  return false;
}
const only = process.argv[2]?.split(',');
for (const [name, [lat, lon]] of Object.entries(CITIES)) {
  if (only && !only.includes(name)) continue;
  const di = Math.ceil(R / (CELL * 111.32)), dj = Math.ceil(R / (CELL * 111.32 * Math.cos(lat * Math.PI / 180)));
  const i0 = Math.floor(lat / CELL), j0 = Math.floor(lon / CELL);
  let ok = 0, n = 0;
  for (let i = i0 - di; i <= i0 + di; i += 6) for (let j = j0 - dj; j <= j0 + dj; j += 6) {
    const keys = []; for (let a = i; a < Math.min(i + 6, i0 + di + 1); a++) for (let b = j; b < Math.min(j + 6, j0 + dj + 1); b++) keys.push(`${a}:${b}`);
    n++; if (await block(keys)) ok++; await sleep(PAUSE);
  }
  log(`${name}: ${ok}/${n} blocks`);
}
log('done');
