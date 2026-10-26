// SunPeek uygulama mantığı (index.html'den ayrıldı: CSP satır içi betiğe izin vermesin diye)
import { t as tr, lang, LANGS, dirs, dirsLong, applyStatic } from './i18n.js';
import { zoned, hmIn, maxFloor, sunpos, dayEvents, blocked, localize, frame, pickEdge, rayEdge, facadeDay, gridPoints, makeGround, horizonPoints, makeHorizon, horizonAlt, heightConfidence, pip, annualPOA, pvYield, PV } from './sun.js';

const $ = id => document.getElementById(id);
const icon = (n, c = 'ic') => `<svg class="${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const map = L.map('map', { rotate: true, touchRotate: false, rotateControl: false, bearing: 0, zoomControl: false }).setView([51.4779, -0.0015], 17);
L.control.zoom({ position: 'topright' }).addTo(map); // telefonda gizli (iki parmak); sol üst arama, sağ alt düğmeler
// Veri şeffaflığı: bu oturumda hangi servise kaç istek gitti (SunPeek'in kendi sunucusuna hiçbiri gitmez)
const NET = { overpass: 0, elev: 0, tz: 0, nom: 0, tiles: 0, irr: 0 };
// Servis sağlığı: her istek buradan geçer; hata/yanıtsızlık servis başına saklanır, konsola yazılır, döküm kartında görünür
const NETERR = {};
function svcFail(k, msg) { NETERR[k] = { msg: String(msg).slice(0, 80), t: new Date() }; console.warn('[SunPeek] servis sorunu:', k, msg); }
async function sfetch(k, url, opt) {
  net(k);
  try { const r = await fetch(url, opt); if (!r.ok) svcFail(k, 'HTTP ' + r.status); return r; }
  catch (e) { svcFail(k, e.name === 'TimeoutError' ? 'timeout' : e.message); throw e; }
}
function net(k) { NET[k]++; const el = document.getElementById('nettxt'); if (el) el.textContent = tr('netLine', { n: Object.values(NET).reduce((a, b) => a + b, 0) }); }
const tiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 20, maxNativeZoom: 19, attribution: 'Esri World Imagery · buildings © OpenStreetMap'
});
tiles.on('tileloadstart', () => net('tiles')).on('tileerror', () => svcFail('tiles', 'tile error')).addTo(map); // dinleyici önce: ilk karolar da sayılır
const bLayer = L.layerGroup().addTo(map), rLayer = L.layerGroup().addTo(map);
const marker = L.marker([51.4779, -0.0015], { draggable: true }).addTo(map);
const cone = L.polygon([], { color: '#4af', weight: 1, fillOpacity: 0.25, interactive: false }).addTo(map);
let acc = null, pt = null, accM = null, gAlt = null, gAltAcc = null, B = { buildings: [], own: [] }, req = 0;
let last = null; // son çekim: {el, ground, hz, lat, lng} — binalar + zemin kotu + ufuk
let cmpState = 'off'; // off | asking | waiting | nodata | denied | none — üstteki okta görünür
let solar = false; // enerji bölümü onay kutusuyla açılır (tercih saklanır; lsGet tanımlanınca okunur)
let tilt = 90; // yüzey: 90 = duvar, daha küçük = aynı yöne bakan çatı paneli
let follow = false; // GPS takip modu (konum düğmesi); elle seçimde kapanır
let raw = null, heading = null, headAcc = null, compassOn = false, watchId = null, house = null, lastRender = 0, wake = null, gpsPt = null;
let katSrc = null, katFix = null; // katSrc 'gps': kat GPS'ten geldi; katFix: önerilen düzeltme
let cmpOff = +(localStorage.getItem('cmpOff') || 0); // pusula düzeltmesi (manyetik sapma + cihaz hatası), duvara göre kalibre edilir

let TZ = null; // konumun saat dilimi (Open-Meteo); gelene kadar tarayıcınınki
const hm = t => t.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', timeZone: TZ ?? undefined });
const pad = n => String(n).padStart(2, '0');
const dirName = a => dirs[Math.round(a / 45) % 8];
const dm = md => new Date(2000, +md.slice(0, 2) - 1, +md.slice(3)).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
// Mevsim tarihleri yarımküreye göre: güneyde Haziran kıştır
const SEASON = lat => lat < 0 ? { spring: '09-23', summer: '12-21', autumn: '03-20', winter: '06-21' } : { spring: '03-20', summer: '06-21', autumn: '09-23', winter: '12-21' };
applyStatic();
for (const [k, v] of Object.entries(LANGS)) $('lang').add(new Option(v, k, false, k === lang));
$('lang').onchange = () => { localStorage.setItem('lang', $('lang').value); location.reload(); };
const today = new Date();
$('date').value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
$('time').value = today.getHours() * 60 + today.getMinutes();
let todayStr = $('date').value; // konumun saat dilimi gelince o yerin bugününe çekilir (fetchTZ)
let dateTouched = false;
// localStorage sarmalayıcıları: bozuk JSON silinir, dolu depo/erişimsizlik uygulamayı çökertmez
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
solar = !!lsGet('solar');
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsJSON = (k, ok = () => true) => { const v = lsGet(k); if (v == null) return null; try { const x = JSON.parse(v); if (ok(x)) return x; } catch {} try { localStorage.removeItem(k); } catch {} return null; };
const ymd = () => $('date').value.split('-').map(Number);
const timeAt = min => { const [y, m, d] = ymd(); return zoned(y, m, d, min, TZ); };
const kat = () => Math.max(0, Math.round(parseFloat($('kat').value) || 0));
const eye = () => 1.5 + kat() * 2.8; // göz/pencere zeminden ~1,5 m, kat yüksekliği ~2,8 m
const z0 = () => last?.ground ? last.ground(pt.lat, pt.lng) : null; // gözlemcinin zemin kotu (DEM)

// Bir noktadan az yönünde, ekranda ~px piksel uzunluğunda (metreye çevrilmiş) uç nokta. Harita dönse de doğru kalır.
function dest(from, az, px) {
  const m = px * 40075016.686 * Math.cos(from.lat * Math.PI / 180) / 2 ** (map.getZoom() + 8), F = frame(from.lat, from.lng);
  return F.from(Math.sin(az * Math.PI / 180) * m, Math.cos(az * Math.PI / 180) * m);
}
function ray(from, az, px, style) { const end = dest(from, az, px); L.polyline([from, end], style).addTo(rLayer); return end; }
function label(at, text) { L.marker(at, { icon: L.divIcon({ className: 'lbl', html: text, iconSize: null }), interactive: false }).addTo(rLayer); }
// 1.08 sa -> "1 sa 5 dk" (dile göre)
const dur = h => { const t = Math.round(h * 60); return tr('dayLenFmt', { h: Math.floor(t / 60), m: t % 60 }); };
const cap = s => s.charAt(0).toLocaleUpperCase(lang) + s.slice(1);
const floorName = k => k === 0 ? tr('groundFloor') : tr('floorN', { k });
const COL = { vis: '#1ad940', block: '#f7332a', terrain: '#a0522d', behind: '#dddddd' };

// ---------- çizim ----------
function draw() {
  if (!pt) return;
  rLayer.clearLayers();
  const [y, m, d] = ymd(), ev = dayEvents(pt.lat, pt.lng, y, m, d);
  const origin = house ? L.latLng(house.lat, house.lon) : pt;

  if (house) { // cephe modu: ışınlar cepheden çıkar
    house.day = facadeCached($('date').value, () => facadeDay(house.env, house, surfEye(), y, m, d, 5, TZ, tilt));
    for (const s of house.day.slots) { const lt = hmIn(s.t, TZ); if (lt.m % 30) continue;
      const full = lt.m === 0, end = ray(origin, s.az, full ? 150 : 120, { color: COL[s.state], weight: full ? 3 : 2, opacity: s.state === 'behind' ? 0.5 : 0.85 });
      if (full) label(end, lt.h);
    }
  } else {
    const state = obsState;
    const t0 = ev.sunrise ?? (ev.polar === 'day' ? timeAt(0) : null), t1 = ev.sunset ?? (ev.polar === 'day' ? timeAt(1440) : null);
    if (t0 && t1) for (let t = new Date(Math.ceil(t0 / 1800000) * 1800000); t <= t1; t = new Date(+t + 1800000)) {
      const p = sunpos(pt.lat, pt.lng, t);
      if (p.alt <= 0) continue;
      const lt = hmIn(t, TZ), full = lt.m === 0;
      const end = ray(pt, p.az, full ? 150 : 120, { color: COL[state(p.alt, p.az)], weight: full ? 3 : 2, opacity: full ? 0.9 : 0.6 });
      if (full) label(end, lt.h);
    }
  }
  for (const [t, sym] of [[ev.sunrise, '↑'], [ev.sunset, '↓']]) if (t)
    label(ray(origin, sunpos(pt.lat, pt.lng, t).az, 190, { color: '#ff9900', weight: 3, dashArray: '6 6' }), sym + hm(t));

  // Seçili saat
  const t = timeAt(+$('time').value), p = sunpos(origin.lat, origin.lng, t);
  $('tval').textContent = hm(t);
  $('altaz').textContent = `${p.alt.toFixed(1)}° · ${p.az.toFixed(0)}° ${dirName(p.az)}`;
  if (p.alt > 0) ray(origin, p.az, 230, { color: '#ffe600', weight: 5 });
  let st, cls;
  if (p.alt <= 0) { st = tr('belowHorizon'); cls = 'night'; }
  else if (house) {
    const s = house.day.slots.find(s => Math.abs(s.t - t) <= 150000)?.state ?? 'behind'; // 5 dk'lık dilim
    cls = s; st = tr({ vis: 'fVis', block: 'fBlock', terrain: 'fTerrain', behind: 'fBehind' }[s]);
  } else { cls = obsState(p.alt, p.az); st = tr({ vis: 'oVis', block: 'oBlock', terrain: 'oTerrain' }[cls]); }
  $('now').innerHTML = `<span class="dot ${cls}"></span><span>${st}</span>`;
  $('sumdot').className = 'dot ' + cls;
  // Cephe seçiliyse başlık günün cevabını verir; anlık durum saat kaydırıcısının altında (#now)
  $('sum').textContent = house ? (getConf()?.level !== 'ok' && getConf() ? '≈ ' : '') + tr('sumHours', { h: dur(house.day.visH), d: $('date').value === todayStr ? tr('todayLower') : dm(`${pad(m)}-${pad(d)}`) }) : st;
  $('eyeM').textContent = `≈ ${eye().toFixed(1)} m`;
  checkKat();

  const polar = { day: tr('polarDay'), night: tr('polarNight') }[ev.polar];
  $('riseset').textContent = ev.sunrise && ev.sunset ? `${hm(ev.sunrise)} / ${hm(ev.sunset)}` : polar ?? '—';
  $('noon').textContent = ev.noon ? `${hm(ev.noon)} · ${ev.maxAlt.toFixed(1)}°` : '—';
  const len = ev.sunrise && ev.sunset ? (ev.sunset - ev.sunrise) / 60000 : ev.polar === 'day' ? 1440 : ev.polar ? 0 : null;
  $('len').textContent = len == null ? '—' : tr('dayLenFmt', { h: Math.floor(len / 60), m: Math.round(len % 60) });
  drawHouse(); drawHeading(); drawConf();
}

// Kat, binanın kat sayısıyla uyuşuyor mu? Cephe seçiliyse o bina, değilse içinde durduğun bina (en yüksek parça).
// Uymuyorsa kat alanının yanında ❗ ve dokununca uygulanan öneri.
function checkKat() {
  const own = B.own.reduce((a, b) => !a || b.h > a.h ? b : a, null), b = house ?? own, k = kat(), gps = katSrc === 'gps';
  let msg = ''; katFix = null;
  if (b) {
    const mx = maxFloor(b);
    if (k > mx) {
      katFix = mx;
      msg = tr('kTooHigh', { k, which: tr(house ? 'whichSel' : 'whichOwn'), n: mx + 1, est: b.levels == null ? tr('estFromHeight') : '', mx }) +
        (gps ? tr(k - mx >= 8 ? 'gpsEllipsoid' : 'gpsOff') : '');
    }
  } else if (gps && k > 0) {
    katFix = 0; msg = tr('notInside', { k });
  }
  $('katwarn').style.display = $('katmsg').style.display = msg ? '' : 'none';
  $('katmsg').innerHTML = msg ? `${icon('triangle-alert')}<span>${esc(msg)}</span>` : '';
}

// Gözlemcinin bulunduğu nokta için güneş durumu: tepe (ufuk) ya da bina kesiyor mu?
function obsState(alt, az) {
  if (last?.hz && z0() != null && alt < horizonAlt(last.hz, az, z0() + eye())) return 'terrain';
  return blocked(B.buildings, alt, az, eye()) ? 'block' : 'vis';
}
// Cephe hesabı ağır (3 gün × 288 dilim): tarih+kat değişmedikçe yeniden hesaplama
function facadeCached(key, fn) { key += '|' + kat() + '|' + TZ + '|' + tilt; return (house.cache[key] ??= fn()); }
// Yıllık potansiyel: geçen yılın ölçülmüş saatlik ışınımı (Open-Meteo arşivi, ~10 km hücre, tarayıcıda saklanır)
// + bizim gölge/geliş açısı hesabı. Cephe+eğim başına bir kez hesaplanır.
const IRR_YEAR = new Date().getUTCFullYear() - 1, IRR_YEARS = 3; // tek yıl yanıltır (ör. 2025 rekor güneşliydi): son 3 yılın ortalaması
// Ortalama AB hanesinin yıllık elektrik tüketimi (ODYSSEE-MURE, Kasım 2025: 3,6 MWh/konut) ve tipik bir ev sistemi
const HOME_KWH = 3600, HOME_KWP = 5, SOLAR_LOW = 0.8;
async function fetchIrr(lat, lon) {
  const key = `irr:${IRR_YEAR - IRR_YEARS + 1}-${IRR_YEAR}:${lat.toFixed(1)},${lon.toFixed(1)}`;
  const hit = lsJSON(key, x => x && Array.isArray(x.dni) && x.dni.length > 8000 * IRR_YEARS);
  if (hit) return hit;
  const r = await sfetch('irr', `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start_date=${IRR_YEAR - IRR_YEARS + 1}-01-01&end_date=${IRR_YEAR}-12-31&hourly=direct_normal_irradiance,diffuse_radiation&timezone=GMT&timeformat=unixtime`, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const h = (await r.json()).hourly;
  const d = { t0: h.time[0] * 1000, dni: h.direct_normal_irradiance.map(v => Math.round(v || 0)), dhi: h.diffuse_radiation.map(v => Math.round(v || 0)) };
  if (!d.dni.length) throw new Error('no data');
  lsSet(key, JSON.stringify(d));
  return d;
}
function showAnnual() {
  const el = $('annual'); if (!el || !house) return;
  const h = house, k = String(tilt);
  h.annual ??= {};
  const render = v => { if ($('annual') && house === h && String(tilt) === k) $('annual').innerHTML = v; };
  if (h.annual[k]?.html) return render(h.annual[k].html);
  render(`<span class="muted">${esc(tr('annualLoading'))}</span>`);
  if (h.annual[k]?.pending) return;
  h.annual[k] = { pending: true };
  fetchIrr(h.lat, h.lon).then(d => {
    const H = { t: d.dni.map((_, i) => d.t0 + i * 3600000), dni: d.dni, dhi: d.dhi };
    const eyeH = tilt < 90 ? h.h + 0.5 : eye(), poa = annualPOA(h.env, h, eyeH, tilt, H), y = pvYield(poa.total / IRR_YEARS);
    // ihtiyatlı aralık: üst = model, alt = %20 düşük (zayıf yıl, kir, yaşlanma, model hatası)
    const kwh = y.perKWp * HOME_KWP, lo = kwh * SOLAR_LOW, n = v => Math.round(v).toLocaleString(lang), r100 = v => n(Math.round(v / 100) * 100);
    h.annual[k] = { html: `<div class="muted">${esc(tr('annualTitle'))}${tip([tr('avgNote'), tr('annualRow', { y: n(y.perKWp), m: n(y.perM2) }), tr('annualNeed', { lo: n(HOME_KWH / y.perM2), hi: n(HOME_KWH / (y.perM2 * SOLAR_LOW)) }), tr('annualNote', { year: `${IRR_YEAR - IRR_YEARS + 1}–${IRR_YEAR}` })].join(' '))}</div>
      <div class="big">≈ ${r100(lo)}–${r100(kwh)} kWh</div><div>${esc(tr('annualSys', { kwp: HOME_KWP, m2: n(HOME_KWP / PV.eff) }))}</div><div>${esc(tr('annualHome', { lo: n(100 * lo / HOME_KWH), hi: n(100 * kwh / HOME_KWH), home: n(HOME_KWH) }))}</div>` };
    render(h.annual[k].html);
  }).catch(e => { h.annual[k] = null; render(`<span class="muted">${esc(tr('annualFail', { e: e.message }))}</span>`); });
}
// Duvar: seçili kattaki pencere; çatı paneli: binanın tepesi
const surfEye = () => tilt < 90 ? house.h + 0.5 : eye();

function drawHouse() {
  const el = $('house');
  $('empty').style.display = house ? 'none' : '';
  if (!house) { el.style.display = 'none'; return; }
  const [y] = ymd(), fmt = r => r.windows.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(', ') || tr('none');
  const S = SEASON(house.lat), on = md => { const [mm, dd] = md.split('-').map(Number); return facadeCached(`${y}-${md}`, () => facadeDay(house.env, house, surfEye(), y, mm, dd, 5, TZ, tilt)); };
  const sum = on(S.summer), win = on(S.winter);
  el.style.display = '';
  saveHist({ day: house.day, sum, win, fmt });
  // Önce cevap: üç büyük kutucuk (seçili gün / yaz / kış), altında saat aralıkları
  const [, mo, da] = ymd(), dayLbl = $('date').value === todayStr ? tr('today') : dm(`${pad(mo)}-${pad(da)}`);
  const c = getConf(), est = c && c.level !== 'ok', ap = est ? '≈ ' : '';
  const tSel = timeAt(+$('time').value), sl = house.day.slots.find(s => Math.abs(s.t - tSel) <= 150000);
  const incTxt = sl && sl.state !== 'behind' && sl.inc < 90 ? tr('incAt', { t: hm(tSel), a: sl.inc.toFixed(0) }) : tr('incNone', { t: hm(tSel) });
  const tile = (lbl, r) => `<div class="tile"><b>${ap}${dur(r.visH)}</b><span>${lbl}</span></div>`;
  const addr = hist().find(e => e.key === `${house.id}:${Math.round(house.az)}`)?.addr;
  el.innerHTML = `${est ? `<button id="estrow" class="estrow" type="button">${icon('triangle-alert')}<span>${tr('estRow')}</span><u>${tr('details')}</u></button>` : ''}<div class="tiles">${tile(dayLbl, house.day)}${tile(tr('summerSol', { d: dm(S.summer) }), sum)}${tile(tr('winterSol', { d: dm(S.winter) }), win)}</div>
    <div class="wins"><span>${dayLbl}</span><span>${fmt(house.day)}</span><span>${tr('summer')}</span><span>${fmt(sum)}</span><span>${tr('winter')}</span><span>${fmt(win)}</span></div>
    <div class="facrow">${icon('house')}<div><div class="st">${esc(cap(tr('wallFacing', { dir: dirsLong[Math.round(house.az / 45) % 8] })))} · ${esc(floorName(kat()))}</div>
      ${addr ? `<div>${esc(addr)}</div>` : ''}<div class="muted">${esc(tr('facadeDetail', { az: house.az.toFixed(0), h: house.h.toFixed(0), est: house.guessed ? tr('estimated') : '', e: eye().toFixed(1) }))}</div></div>
      <button id="unpick" class="iconbtn" aria-label="${tr('unpick')}" title="${tr('unpick')}">${icon('x')}</button></div>
    <label class="chk"><input type="checkbox" id="solarchk"${solar ? ' checked' : ''}> ${esc(tr('solarToggle'))}</label>
    ${solar ? `<section class="solarcard" aria-labelledby="solarh"><h3 id="solarh">${icon('sun')}${esc(tr('solarTitle'))}</h3><div class="field"><label for="surf">${tr('surface')}</label><select id="surf">${[90, 60, 45, 35, 30, 15, 0].map(v => `<option value="${v}"${v === tilt ? ' selected' : ''}>${esc(v === 90 ? tr('surfWall') : v === 0 ? tr('surfFlat') : tr('surfRoof', { t: v }))}</option>`).join('')}</select></div>
    <div class="energy">${tip(tr('energyNote') + (tilt < 90 ? ' ' + tr('roofNote', { h: (house.h + 0.5).toFixed(0) }) : ''))}${esc(incTxt)}<br>${esc(tr('energyRow', { d: dayLbl, e: house.day.energy.toFixed(1), s: sum.energy.toFixed(1), w: win.energy.toFixed(1) }))}</div>

    <div id="annual" class="annual"></div></section>` : ''}
    ${compassOn ? `<div class="calrow"><button id="calib" class="btn">${icon('ruler')}${tr('calib')}</button>${tip(tr('calibHelp', { c: (cmpOff >= 0 ? '+' : '') + cmpOff.toFixed(0) }))}</div>` : ''}`;
  $('unpick').onclick = () => { house = null; drawBuildings(); draw(); };
  $('estrow')?.addEventListener('click', openConf);
  if ($('surf')) $('surf').onchange = () => { tilt = +$('surf').value; draw(); };
  if (solar) showAnnual();
  $('solarchk').onchange = () => { solar = $('solarchk').checked; lsSet('solar', solar ? '1' : ''); if (!solar) tilt = 90; draw(); };
  if ($('calib')) $('calib').onclick = () => { // duvara bakan telefonun gerçek yönü = cephe yönü + 180°
    if (raw == null) return;
    cmpOff = ((house.az + 180 - raw + 540) % 360) - 180; localStorage.setItem('cmpOff', cmpOff); heading = null;
    say(tr('calibSaved', { c: cmpOff.toFixed(0) }), 'ok'); drawHouse();
  };
}

// ---------- geçmiş (tarama yapılan binalar) ----------
// Telefonda saklanır (localStorage). iOS Safari 7 gün girilmeyen sitenin verisini silebilir: kalıcılık istenir;
// ana ekrana eklenen site bundan muaf.
navigator.storage?.persist?.().catch(() => {});
const HKEY = 'gecmis', HMAX = 200;
// Geçmiş yalnız beklenen biçimdeki kayıtlarla okunur (sayılar sonlu, kat tam sayı); bozuk kayıt atılır
const fin = (...v) => v.every(Number.isFinite);
const validEntry = e => e && typeof e === 'object' && typeof e.key === 'string' && fin(e.lat, e.lon, e.az, e.h, e.todayH, e.summerH, e.winterH)
  && Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180 && Number.isInteger(e.kat) && e.kat >= 0 && e.kat < 300;
const hist = () => (lsJSON(HKEY, Array.isArray) ?? []).filter(validEntry);
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Bilgi ipucu: (i) düğmesi. Dokununca açılır/kapanır (fareyle üzerine gelince de); kutu her zaman ekranın içinde kalır.
// Durum satırı: renk kodlu kısa cümle (ok/info/warn/bad); uzun metnin tamamı (i) içinde, kaybolmaz
function say(text, kind = 'info') {
  const el = $('gstat'), m = text.length > 48 && text.slice(12).match(/[.:;]\s|\s[—–(]/);
  el.className = 'say ' + kind;
  el.innerHTML = m ? esc(text.slice(0, 12 + m.index + (text[12 + m.index] === '.' ? 1 : 0))) + tip(text) : esc(text);
}
const tip = text => `<button type="button" class="tipbtn" data-tip="${esc(text)}" aria-label="${esc(tr('info'))}" aria-expanded="false">${icon('info')}</button>`;
const tipEl = Object.assign(document.createElement('div'), { id: 'tip', role: 'tooltip', hidden: true });
let tipFor = null;
function showTip(b) {
  tipFor?.setAttribute('aria-expanded', 'false'); tipFor = b; b.setAttribute('aria-expanded', 'true');
  (b.closest('dialog') || document.body).append(tipEl); // açık kartın (üst katman) içinde de görünsün
  tipEl.textContent = b.dataset.tip; tipEl.hidden = false; tipEl.style.left = tipEl.style.top = '0px';
  const r = b.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = document.documentElement.clientWidth, vh = innerHeight;
  let top = r.bottom + 6; if (top + h > vh - 8) top = r.top - h - 6; // altta yer yoksa üstte
  tipEl.style.top = Math.max(8, Math.min(top, vh - h - 8)) + 'px';
  tipEl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8)) + 'px';
}
function hideTip() { if (!tipFor) return; tipFor.setAttribute('aria-expanded', 'false'); tipFor = null; tipEl.hidden = true; }
document.addEventListener('click', e => { const b = e.target.closest?.('.tipbtn'); if (!b) return hideTip(); e.preventDefault(); e.stopPropagation(); b === tipFor ? hideTip() : showTip(b); }, true);
document.addEventListener('pointerover', e => { const b = e.pointerType === 'mouse' && e.target.closest?.('.tipbtn'); if (b && b !== tipFor) showTip(b); });
document.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && tipFor && e.target.closest?.('.tipbtn') === tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
addEventListener('scroll', hideTip, true); addEventListener('resize', hideTip);
function putHist(list) { lsSet(HKEY, JSON.stringify(list.slice(0, HMAX))); renderHist(); }
// Seçili cephenin son sonuçlarını yaz; aynı bina+cephe varsa günceller ve başa alır.
function saveHist({ day, sum, win, fmt }) {
  const key = `${house.id}:${Math.round(house.az)}`, list = hist(), old = list.find(e => e.key === key);
  if (old && old.kat === kat() && old.date === $('date').value && old.todayH === day.visH && list[0] === old) return; // değişiklik yok (saat kaydırıcısı)
  const e = { key, lat: house.lat, lon: house.lon, az: house.az, h: house.h, guessed: house.guessed, kat: kat(), date: $('date').value,
    todayH: day.visH, today: fmt(day), summerH: sum.visH, summer: fmt(sum), winterH: win.visH, winter: fmt(win), addr: old?.addr ?? null, savedAt: new Date().toISOString() };
  putHist([e, ...list.filter(x => x.key !== key)]);
  if (!e.addr) lookupAddr(e);
}
// Nominatim kullanım politikası: uygulama genelinde ≤1 istek/sn, toplu sorgu yok. Tüm çağrılar bu kuyruktan geçer.
let nomChain = Promise.resolve();
function nominatim(url) {
  const run = nomChain.then(() => { return sfetch('nom', url, { signal: AbortSignal.timeout(10000) }); });
  nomChain = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, 1100)));
  return run;
}
const addrPending = new Set();
async function lookupAddr(e, retried = false) {
  if (addrPending.has(e.key)) return; // aynı kayıt için tek istek
  addrPending.add(e.key);
  try {
    const r = await nominatim(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=${lang}&lat=${e.lat.toFixed(6)}&lon=${e.lon.toFixed(6)}`);
    const a = (await r.json()).address ?? {};
    const addr = [[a.road, a.house_number].filter(Boolean).join(' '), a.city ?? a.town ?? a.village ?? a.suburb].filter(Boolean).join(', ');
    if (addr) putHist(hist().map(x => x.key === e.key ? { ...x, addr: addr.slice(0, 200) } : x));
    addrPending.delete(e.key);
  } catch { addrPending.delete(e.key); if (!retried) setTimeout(() => lookupAddr(e, true), 5000); } // yanıt yoksa bir kez daha dene
}
function renderHist() {
  const list = hist();
  $('hcount').textContent = list.length;
  $('hist').innerHTML = list.map((e, i) => `<div class="hrow"><button class="hgo" type="button" data-i="${i}"><b>${esc(e.addr ?? `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}`)}</b>
      <div class="muted">${esc(tr('histFacade', { dir: dirName(e.az), az: Math.round(e.az), k: e.kat, h: Math.round(e.h), est: e.guessed ? tr('estimated') : '' }))}</div>
      <div class="muted">${esc(tr('histHours', { date: e.date, t: e.todayH.toFixed(1), s: e.summerH.toFixed(1), sw: e.summer, w: e.winterH.toFixed(1), ww: e.winter }))}</div>
      <div class="muted">${esc(new Date(e.savedAt).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }))}</div></button>
      <button data-del="${i}" class="iconbtn" aria-label="${tr('del')}" title="${tr('del')}">${icon('trash-2')}</button></div>`).join('') +
    (list.length ? `<button id="hclear" class="btn" style="width:100%;margin-top:8px">${tr('clearAll')}</button>` : `<div class="muted" style="padding-bottom:8px">${tr('histEmpty')}</div>`);
  $('hclear')?.addEventListener('click', () => { if (confirm(tr('confirmClear'))) putHist([]); });
}
$('hist').onclick = ev => {
  const del = ev.target.closest('[data-del]'), row = ev.target.closest('.hgo');
  if (del) { const l = hist(); l.splice(+del.dataset.del, 1); putHist(l); return; }
  if (!row) return;
  const e = hist()[+row.dataset.i]; // dokun: oraya git, katı geri yükle; sonuçlar satırda
  $('kat').value = e.kat; katSrc = null; follow = false; house = null; drawBuildings();
  setPoint(e.lat, e.lon); map.setView([e.lat, e.lon], 18);
};
renderHist();

// Gökyüzü: merkez tepe noktası, kenar ufuk. Pusula açıkken yukarısı baktığın yön.
function drawSky() {
  if (!pt) return;
  const rot = compassOn && heading != null ? heading : 0, R = 100;
  const P = (alt, az) => { const r = (90 - Math.max(alt, 0)) / 90 * R, a = (az - rot) * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
  const o = house ? { lat: house.lat, lng: house.lon } : pt;
  let s = `<circle r="${R}" fill="#123" stroke="#999"/><circle r="${R * 2 / 3}" fill="none" stroke="#fff3"/><circle r="${R / 3}" fill="none" stroke="#fff3"/>`;
  if (house) { // cephe çizgisi; güneşin cepheye vuramadığı yarım gri
    const a = (house.az - rot) * Math.PI / 180, ux = Math.cos(a) * R, uy = Math.sin(a) * R;
    s += `<path d="M${-ux},${-uy} A${R},${R} 0 0 0 ${ux},${uy}Z" fill="#9999"/><line x1="${-ux}" y1="${-uy}" x2="${ux}" y2="${uy}" stroke="#0ef" stroke-width="3"/>`;
  }
  if (last?.hz && z0() != null) { // tepeler: ufuk profili ile ufuk çemberi arası kahverengi
    const hp = []; for (let a = 0; a < 360; a += 5) hp.push(P(horizonAlt(last.hz, a, z0() + eye()), a).map(v => v.toFixed(1)).join(','));
    s += `<path d="M${hp.join('L')}Z M${R},0 A${R},${R} 0 1 0 ${-R},0 A${R},${R} 0 1 0 ${R},0Z" fill-rule="evenodd" fill="#a0522dcc"/>`;
  }
  for (const az of [0, 90, 180, 270]) { const [x, y] = P(-8, az).map(v => v * 1.08); s += `<text x="${x}" y="${y + 4}" fill="${az ? '#fff' : '#f55'}" font-size="12" text-anchor="middle" font-weight="700">${dirs[az / 45]}</text>`; }
  const pts = [], [y, m, d] = ymd();
  for (let k = 0; k <= 1440; k += 10) {
    const t = zoned(y, m, d, k, TZ), p = sunpos(o.lat, o.lng, t);
    if (p.alt > 0) { const [x, yy] = P(p.alt, p.az); pts.push(`${x.toFixed(1)},${yy.toFixed(1)}`); if (k % 120 === 0) s += `<text x="${x}" y="${yy - 4}" fill="#ffd" font-size="9" text-anchor="middle">${k / 60}</text>`; }
  }
  if (pts.length) s += `<polyline points="${pts.join(' ')}" fill="none" stroke="#fc0" stroke-width="2"/>`;
  const p = sunpos(o.lat, o.lng, timeAt(+$('time').value));
  if (p.alt > 0) { const [x, yy] = P(p.alt, p.az); s += `<circle cx="${x}" cy="${yy}" r="8" fill="#ffe600" stroke="#000"/>`; }
  if (compassOn && heading != null) s += `<path d="M0,${-R + 1} l-7,-12 h14z" fill="#4af"/>`;
  $('sky').innerHTML = s;

  // Güneş, baktığın yöne göre şu an nerede?
  const live = sunpos(o.lat, o.lng, new Date());
  if (!compassOn || heading == null) $('rel').textContent = '';
  else if (live.alt <= 0) $('rel').textContent = tr('relBelow');
  else { const dd = ((live.az - heading + 540) % 360) - 180, d = Math.abs(dd).toFixed(0);
    $('rel').textContent = tr('relFmt', { where: Math.abs(dd) < 5 ? tr('relFront') : tr(dd > 0 ? 'relRight' : 'relLeft', { d }), alt: live.alt.toFixed(0) }); }
}

function drawHeading() {
  const zg = pt && z0();
  $('pos').textContent = pt ? `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}${accM ? ` (±${Math.round(accM)} m)` : ''}` + (TZ ? ` · ${TZ}` : '') +
    (zg != null ? ' · ' + tr('ground', { z: zg.toFixed(0) }) : '') + (gAlt != null ? ' · ' + tr('gpsAlt', { a: gAlt.toFixed(0) }) + (gAltAcc ? ` ±${Math.round(gAltAcc)}` : '') : '') +
    (heading != null && headAcc > 0 ? ` · ±${Math.round(headAcc)}°` : '') : '';
  const live = compassOn && heading != null;
  if (live && pt) cone.setLatLngs([pt, dest(pt, heading - 15, 90), dest(pt, heading, 100), dest(pt, heading + 15, 90)]); else cone.setLatLngs([]);
  map.setBearing(live ? -heading : 0); // pusula açık = baktığın yön yukarı, kapalı = kuzey yukarı
  $('arrowtxt').textContent = live ? `${heading.toFixed(0)}° ${dirName(heading)}` :
    tr({ off: 'aOff', asking: 'aAsking', waiting: 'aWaiting', nodata: 'aNodata', denied: 'aDenied', none: 'aNone' }[cmpState] ?? 'aOff');
  drawSky();
}

function drawBuildings() {
  bLayer.clearLayers();
  for (const b of B.buildings.concat(B.own)) if (Math.hypot(b.cx, b.cy) < 200) // telefonda hız: yalnız yakındakiler çizilir
    L.polygon(b.geom.map(g => [g.lat, g.lon]), { color: '#fff', weight: 1, fill: false, dashArray: b.guessed ? '3 3' : null, interactive: false }).addTo(bLayer);
  if (house) L.polyline(house.edge, { color: '#00e5ff', weight: 6 }).addTo(bLayer);
}

// ---------- binalar ----------
// Tarayıcıda saklanır (yer dolarsa eski bina önbellekleri silinir); aynı bölgeye dönünce anında gelir.
async function fetchEls(lat, lng) {
  const key = `ov:${lat},${lng}`, hit = lsJSON(key, Array.isArray);
  if (hit) return hit;
  const el = await fetchOverpass(lat, lng), txt = JSON.stringify(el);
  for (let i = 0; i < 2; i++) try { localStorage.setItem(key, txt); break; }
    catch { Object.keys(localStorage).filter(k => k.startsWith('ov:')).forEach(k => localStorage.removeItem(k)); }
  return el;
}
async function fetchOverpass(lat, lng) {
  const a = `around:400,${lat},${lng}`; // kış güneşi alçak: 30 m bina ~340 m'ye gölge düşürür
  const q = `[out:json][timeout:60];(way(${a})["building"];way(${a})["building:part"];relation(${a})["building"];);out tags geom;`;
  let err;
  for (const url of OVERPASS) { // ana sunucu yavaş (30+ sn) ya da 429/502/504 verebilir, sırayla aynalar
    try {
      const r = await sfetch('overpass', url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(url === OVERPASS[0] ? 60000 : 30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return (await r.json()).elements;
    } catch (e) { err = e; }
  }
  throw err;
}
// Open-Meteo yükseklik API'si (Copernicus GLO-90), 100 noktalık parçalar halinde.
// Sonuç tarayıcıda saklanır (aynı yere tekrar gelince istek yok); 429'da bekleyip tekrar dener.
async function fetchElev(pts, key) {
  const hit = key && lsJSON(key, x => Array.isArray(x) && x.length === pts.length && x.every(Number.isFinite));
  if (hit) return hit;
  const out = [];
  for (let i = 0; i < pts.length; i += 100) {
    const c = pts.slice(i, i + 100), url = `https://api.open-meteo.com/v1/elevation?latitude=${c.map(p => p[0].toFixed(5))}&longitude=${c.map(p => p[1].toFixed(5))}`;
    for (let k = 0; ; k++) {
      const r = await sfetch('elev', url, { signal: AbortSignal.timeout(20000) });
      if (r.ok) { out.push(...(await r.json()).elevation); break; }
      if (r.status !== 429 || k === 2) throw new Error('elevation HTTP ' + r.status);
      await new Promise(res => setTimeout(res, 3000 * (k + 1)));
    }
  }
  if (key) try { localStorage.setItem(key, JSON.stringify(out)); } catch {}
  return out;
}
// Son çekimin merkezinden 120 m içindeysek aynı veriyi yeni noktaya göre yeniden hesapla (yürürken her adımda çekme).
// Yanıt vermeyen servis: başarısız kısım kaydedilmez (sonraki harekette yeniden denenir), görünür uyarı + ↻ düğmesi,
// 8 sn sonra bir kez de kendiliğinden yeniden denenir. Başarılı parçalar localStorage'dan gelir, tekrar indirilmez.
let autoRetry = null;
// Adres/koordinatla gidince: o adresteki binayı bul (Nominatim OSM kimliği, yoksa noktayı içeren ya da 25 m içindeki bina)
// ve cepheyi otomatik seç. Varsayılan: güneşe en çok bakan uzun duvar; kullanıcı başka duvara dokunarak değiştirir.
let pendingPick = null;
function autoPick() {
  const p = pendingPick;
  if (!p || !pt || !last || pt.distanceTo([p.lat, p.lon]) > 5) return;
  pendingPick = null;
  const all = B.buildings.concat(B.own);
  let b = (p.osmId != null && all.find(x => x.id === p.osmId && Math.hypot(x.cx, x.cy) < 60)) || B.own[0] || pickEdge(all, 0, 0, 25)?.b;
  if (!b) return;
  const want = pt.lat >= 0 ? 180 : 0, r = b.ring;
  let best = null;
  for (let i = 0; i < r.length - 1; i++) {
    const [ax, ay] = r[i], [bx, by] = r[i + 1], L = Math.hypot(bx - ax, by - ay);
    if (L < 5) continue;
    const e = pickEdge([b], (ax + bx) / 2, (ay + by) / 2, 1);
    if (!e || e.i !== i) continue;
    const d = Math.abs(((e.az - want + 540) % 360) - 180);
    if (!best || d < best.d - 1 || (Math.abs(d - best.d) <= 1 && L > best.L)) best = { e, d, L };
  }
  if (best) { setHouse(best.e); say(tr('autoWall'), 'ok'); }
}
async function refreshBuildings(force = false, attempt = 0) {
  const id = ++req; // her konum geçişi: bekleyen eski yanıt artık uygulanmaz
  if (!force && last?.complete && pt.distanceTo([last.lat, last.lng]) < 120) { B = localize(last.el, pt.lat, pt.lng, last.ground); statB(); drawBuildings(); draw(); return autoPick(); }
  clearTimeout(autoRetry);
  // Çekim merkezi ~100 m'lik ızgaraya oturtulur: önbellek isabeti için; 400 m yarıçap yine de bolca kapsar
  const lat = +pt.lat.toFixed(3), lng = +pt.lng.toFixed(3);
  $('bstat').textContent = tr('loading');
  if ($('retry')) say(tr('loading'), 'info');
  // Ufuk ~100 m'lik ızgaraya oturtulur: 600 m+ uzaklıkta fark yok, yakın yerlere dönünce önbellekten gelir
  const hlat = +lat.toFixed(3), hlng = +lng.toFixed(3);
  const [el, gr, hz] = await Promise.allSettled([fetchEls(lat, lng), fetchElev(gridPoints(lat, lng), `zg:${lat.toFixed(4)},${lng.toFixed(4)}`),
    fetchElev(horizonPoints(hlat, hlng), `hz:${hlat},${hlng}`)]);
  if (id !== req) return;
  last = { el: el.value ?? [], ground: gr.value ? makeGround(lat, lng, gr.value) : null, hz: hz.value ? makeHorizon(hz.value) : null, lat, lng,
           complete: el.status === 'fulfilled' && !!gr.value && !!hz.value };
  B = localize(last.el, pt.lat, pt.lng, last.ground); statB();
  const fails = [];
  if (el.status === 'rejected') fails.push(tr('bFail', { e: el.reason.message }));
  if (!last.ground) fails.push(tr('gFail', { e: gr.reason.message }).trim());
  if (!last.hz) fails.push(tr('hFail', { e: hz.reason.message }).trim());
  if (fails.length) {
    $('gstat').className = 'say bad'; $('gstat').innerHTML = `${esc(fails.join(' '))}<br><button id="retry" class="btn">${icon('rotate-ccw')}${tr('retry')}</button>`;
    $('retry').onclick = () => refreshBuildings(true, 1);
    if (attempt === 0) autoRetry = setTimeout(() => refreshBuildings(true, 1), 8000);
  } else if ($('retry')) $('gstat').textContent = '';
  drawBuildings(); draw(); autoPick();
}
function statB() {
  const g = B.buildings.filter(b => b.guessed).length;
  $('bstat').textContent = tr('bStat', { n: B.buildings.length, p: Math.round(100 * g / Math.max(1, B.buildings.length)) }) +
    (B.own.length ? tr('bOwn') : '.') + (last?.ground ? tr('slopeOn') : '') + (last?.hz ? tr('hillsOn') : '');
}

// ---------- ev seçimi ----------
function setHouse(e) {
  if (!e) { say(tr('noEdge'), 'warn'); return; }
  const F = frame(pt.lat, pt.lng), [lat, lon] = F.from(e.x, e.y), r = e.b.ring;
  house = { lat, lon, az: e.az, id: e.b.id, h: e.b.h, levels: e.b.levels, guessed: e.b.guessed, env: last, cache: {}, edge: [F.from(...r[e.i]), F.from(...r[(e.i + 1) % r.length])] };
  say(tr('facadePicked'), 'ok');
  drawBuildings(); draw();
}
$('look').onclick = () => {
  if (heading == null || !last) return;
  setHouse(rayEdge(B.buildings, heading)); // pusula ±15° şaşabilir: sonuç vurgulanır, gerekirse dokunarak düzeltilir
};

// ---------- konum ----------
function setPoint(lat, lng, pan = true) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  pt = L.latLng(lat, lng);
  // seçili cephe uzakta kaldıysa bırak: ışınlar yeni yerde çizilsin (adres aramasında okların görünmemesinin nedeni)
  if (house && pt.distanceTo([house.lat, house.lon]) > 300) { house = null; drawBuildings(); }
  marker.setLatLng(pt);
  if (pan) map.setView(pt, Math.max(map.getZoom(), 17));
  draw(); refreshBuildings(); fetchTZ(lat, lng); updateBack();
}
// Konumun saat dilimi (Open-Meteo, ~10 km ızgarada önbellekli). Başarısızsa tarayıcının saat dilimi kalır.
let timeTouched = false;
const validTZ = z => { if (typeof z !== 'string' || z.length > 64) return false; try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };
let tzSeq = 0;
async function fetchTZ(lat, lng, retried = false) {
  const key = `tz:${lat.toFixed(1)},${lng.toFixed(1)}`, seq = retried ? tzSeq : ++tzSeq;
  let tz = lsGet(key);
  if (tz && !validTZ(tz)) { try { localStorage.removeItem(key); } catch {} tz = null; }
  if (!tz) try {
    const r = await sfetch('tz', `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&timezone=auto&forecast_days=1&daily=sunrise`, { signal: AbortSignal.timeout(10000) });
    tz = (await r.json()).timezone;
    if (validTZ(tz)) lsSet(key, tz); else tz = null; // doğrulanmadan saklanmaz
  } catch { tz = null; }
  if (seq !== tzSeq) return; // bu arada başka yere gidildi: eski yanıt uygulanmaz
  if (!tz) {
    if (TZ) { TZ = null; draw(); } // bilinmiyorsa önceki yerin saat dilimi kalmasın
    if (!retried) setTimeout(() => { if (seq === tzSeq) fetchTZ(lat, lng, true); }, 6000); // yanıt yok/429: bir kez daha dene
    return;
  }
  if (tz === TZ) return;
  TZ = tz;
  // "bugün" o yerin takvimine göre: tarayıcıda gece yarısı geçmiş olsa da o yerde hâlâ dün olabilir
  const pTZ = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const tzToday = `${pTZ.year}-${pTZ.month}-${pTZ.day}`;
  if (!dateTouched && $('date').value !== tzToday) { $('date').value = tzToday; }
  todayStr = tzToday; seasonMark?.();
  if (!timeTouched && $('date').value === todayStr) { const x = hmIn(new Date(), TZ); $('time').value = x.h * 60 + x.m; }
  draw();
}
function gotPos(pos, pan) {
  const { latitude, longitude, accuracy, altitude, altitudeAccuracy } = pos.coords;
  accM = accuracy; gAlt = altitude; gAltAcc = altitudeAccuracy;
  if (acc) acc.remove();
  acc = L.circle([latitude, longitude], { radius: accuracy, color: '#4af', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
  gpsPt = L.latLng(latitude, longitude);
  // Takip modu: konum düğmesi / "konumuma dön" ile açılır; arama, dokunma, sürükleme, geçmiş kapatır.
  // Kapalıyken GPS güncellemesi aranan/seçilen yeri ezmez (adres aramasında "konuma geri dönüyor" hatası).
  if (pan) { follow = true; say(tr('gotPos', { a: Math.round(accuracy) }), 'ok'); }
  if (follow) { setPoint(latitude, longitude, pan); if (!pan) map.panTo(gpsPt); } else updateBack();
}
// GPS konumundan >30 m uzaklaşınca "Konumuma dön" görünür; konum düğmesi GPS'teyken mavi
function updateBack() {
  const away = !!(gpsPt && pt && pt.distanceTo(gpsPt) > 30);
  $('backbtn').hidden = !away;
  $('geo').classList.toggle('on', !!(gpsPt && pt && !away));
}
function backToMe() { if (!gpsPt) return locate(); follow = true; setPoint(gpsPt.lat, gpsPt.lng, false); map.flyTo(gpsPt, Math.max(map.getZoom(), 17), { duration: .6 }); }
function locate() {
  if (!navigator.geolocation) { say(tr('noGeo'), 'bad'); return; }
  say(tr('askingPos'), 'info');
  navigator.geolocation.getCurrentPosition(p => gotPos(p, true), err => {
    say(tr('posFail', { e: err.message }), 'bad');
    if (!pt) setPoint(51.4779, -0.0015);
  }, { enableHighAccuracy: true, timeout: 15000 });
}

// ---------- pusula ----------
function onOrient(e) {
  let h = e.webkitCompassHeading; // iOS: kuzeyden saat yönü
  if (h == null) { if (!(e.absolute || e.type === 'deviceorientationabsolute') || e.alpha == null) return; h = 360 - e.alpha; }
  h = (h + (screen.orientation?.angle ?? 0) + 360) % 360;
  headAcc = e.webkitCompassAccuracy ?? null; cmpState = 'live';
  // Alçak geçiren süzgeç (359→0 sarmasını doğru ele alır); ekranı ~5 Hz güncelle
  raw = raw == null ? h : (raw + 0.25 * (((h - raw + 540) % 360) - 180) + 360) % 360;
  heading = (raw + cmpOff + 360) % 360;
  if (performance.now() - lastRender > 200) { lastRender = performance.now(); drawHeading(); }
}
// iOS izni yalnızca bir dokunuşun içinde istenebilir; Android/diğerlerinde izin gerekmez.
function requestCompass() {
  if (compassOn || cmpState === 'asking') return;
  const D = window.DeviceOrientationEvent;
  if (!D) { cmpState = 'none'; say(tr('noCompass'), 'warn'); return drawHeading(); }
  if (typeof D.requestPermission !== 'function') return compassStart();
  cmpState = 'asking'; drawHeading();
  D.requestPermission().then(r => {
    if (r === 'granted') return compassStart();
    cmpState = 'denied'; drawHeading();
    say(tr('cmpDenied'), 'bad');
  }).catch(e => { cmpState = 'off'; drawHeading(); say(tr('cmpErr', { e: e.message }), 'bad'); });
}
function compassStart() {
  compassOn = true; cmpState = 'waiting'; $('arrow').classList.add('on'); $('arrow').setAttribute('aria-pressed', 'true'); $('look').hidden = false;
  navigator.wakeLock?.request('screen').then(w => wake = w).catch(() => {}); // sahada ekran kararmasın
  drawHouse(); // kalibrasyon düğmesi
  // İkisini de dinle: Android Chrome 'absolute' verir, iOS ve bazı Android'ler düz 'deviceorientation' (onOrient mutlak olmayanı eler)
  window.addEventListener('deviceorientationabsolute', onOrient); window.addEventListener('deviceorientation', onOrient);
  drawHeading();
  setTimeout(() => { if (compassOn && heading == null) { cmpState = 'nodata'; drawHeading(); say(tr('cmpNoData'), 'warn'); } }, 3000);
  // Yürürken konumu izle ve haritayı takip et
  if (navigator.geolocation) watchId = navigator.geolocation.watchPosition(p => gotPos(p, false), () => {}, { enableHighAccuracy: true });
}
function compassStop() {
  compassOn = false; cmpState = 'off'; heading = null; raw = null; wake?.release(); wake = null; $('arrow').classList.remove('on'); $('arrow').setAttribute('aria-pressed', 'false'); $('look').hidden = true;
  window.removeEventListener('deviceorientationabsolute', onOrient); window.removeEventListener('deviceorientation', onOrient);
  if (watchId != null) navigator.geolocation.clearWatch(watchId); // pil: izlemeyi bırak
  watchId = null; drawHeading(); drawHouse();
}
// Üstteki ok: pusula kapalıysa açar; açıksa yön-yukarı ↔ kuzey-yukarı
$('arrow').onclick = () => compassOn ? compassStop() : requestCompass();
document.addEventListener('visibilitychange', () => { if (compassOn && document.visibilityState === 'visible') navigator.wakeLock?.request('screen').then(w => wake = w).catch(() => {}); });
$('sheet').ontoggle = () => { document.body.classList.toggle('closed', !$('sheet').open); if (!$('sheet').open) document.body.classList.remove('expanded'); map.invalidateSize(); };
// Telefonda paneli büyüt/küçült (başlıktaki ok); başlığa dokunmak ise paneli kapatır/açar
$('expandbtn').onclick = e => { e.preventDefault(); e.stopPropagation(); document.body.classList.toggle('expanded'); setTimeout(() => map.invalidateSize(), 60); };
$('gpskat').onclick = () => {
  if (gAlt == null) { say(tr('noGpsAlt'), 'warn'); return; }
  if (z0() == null) { say(tr('noGround'), 'warn'); return; }
  const k = Math.max(0, Math.round((gAlt - z0() - 1.5) / 2.8));
  $('kat').value = k; katSrc = 'gps'; draw();
  say(tr('gpsFloor', { a: gAlt.toFixed(0), acc: gAltAcc ? ` (±${Math.round(gAltAcc)})` : '', z: z0().toFixed(0), k }), 'info');
};

// ---------- olaylar ----------
$('geo').onclick = () => gpsPt && pt && pt.distanceTo(gpsPt) > 30 ? backToMe() : locate();
$('backbtn').onclick = backToMe;
// Arama: "lat, lon" doğrudan; değilse adres (Nominatim, yalnız gönderince — politikası tuş başına sorguya izin vermiyor)
let searchSeq = 0;
$('sform').onsubmit = async e => {
  e.preventDefault();
  const q = $('coord').value.trim(), box = $('sresults');
  if (!q) return;
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  const seq = ++searchSeq;
  const jump = (la, lo, osmId = null) => { follow = false; house = null; drawBuildings(); pendingPick = { lat: la, lon: lo, osmId }; setPoint(la, lo); };
  if (m && Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180) { box.innerHTML = ''; $('coord').blur(); return jump(+m[1], +m[2]); }
  box.innerHTML = `<span class="muted">${tr('loading')}</span>`;
  try {
    const r = await nominatim(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=${lang}&q=${encodeURIComponent(q.slice(0, 200))}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const res = (await r.json()).filter(x => Number.isFinite(+x.lat) && Number.isFinite(+x.lon) && Math.abs(+x.lat) <= 90 && Math.abs(+x.lon) <= 180);
    if (seq !== searchSeq) return; // daha yeni bir arama ya da seçim var
    box.innerHTML = res.length ? '' : `<span class="muted">${tr('noResults')}</span>`;
    for (const x of res) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = String(x.display_name).slice(0, 300);
      b.onclick = () => { searchSeq++; box.innerHTML = ''; $('coord').value = b.textContent; $('coord').blur(); jump(+x.lat, +x.lon, /^(way|relation)$/.test(x.osm_type) ? +x.osm_id : null); };
      box.appendChild(b);
    }
  } catch (err) { if (seq === searchSeq) box.innerHTML = `<span class="muted">${esc(tr('searchErr', { e: err.message }))}</span>`; }
};
$('coord').addEventListener('input', () => { if (!$('coord').value) $('sresults').innerHTML = ''; });
// Kat: − / + düğmeleri
for (const [id, d] of [['katminus', -1], ['katplus', 1]]) $(id).onclick = () => { $('kat').value = Math.max(0, kat() + d); katSrc = null; draw(); };
// Binaya dokun = o binanın en yakın duvarı seçilir; açık alana dokun = kendi konumunu oraya taşı (iğne de sürüklenebilir)
map.on('click', e => {
  if (pt && last) {
    const [x, y] = frame(pt.lat, pt.lng).to(e.latlng.lat, e.latlng.lng), all = B.buildings.concat(B.own), hit = all.filter(b => pip(x, y, b.ring));
    if (hit.length) { map.panTo(e.latlng); return setHouse(pickEdge(hit, x, y)); }
    // parmak duvarın biraz dışına düştüyse: ekranda ~14 px içindeki duvar da seçilir
    const snap = pickEdge(all, x, y, 14 * 40075016.686 * Math.cos(pt.lat * Math.PI / 180) / 2 ** (map.getZoom() + 8));
    if (snap) { map.panTo(e.latlng); return setHouse(snap); }
  }
  follow = false;
  setPoint(e.latlng.lat, e.latlng.lng, false);
  map.panTo(e.latlng); // uzak bir noktaya dokununca harita oraya gidip ortalansın
});
marker.on('dragend', () => { const p = marker.getLatLng(); follow = false; setPoint(p.lat, p.lng, false); });
map.on('zoomend', draw);
for (const id of ['date', 'time']) $(id).oninput = () => { if (id === 'time') timeTouched = true; else dateTouched = true; draw(); };

// ---------- mevsim simülasyonu ----------
// Haritadaki düğmeler: tarihi ekinoks/gündönümüne alır (ışınlar, gölgeler, cephe saatleri o güne göre); ▶ günü oynatır.
// Mevsim → tarih, bulunulan yarımküreye göre (güneyde "Yaz" = 21 Aralık)
const seasonDate = k => k === 'today' ? todayStr : $('date').value.slice(0, 5) + SEASON(pt?.lat ?? 1)[k];
function seasonMark() { for (const b of $('seasons').querySelectorAll('[data-s]')) { const on = $('date').value === seasonDate(b.dataset.s); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } }
$('seasons').onclick = e => {
  const b = e.target.closest('[data-s]');
  if (!b) return;
  $('date').value = seasonDate(b.dataset.s);
  seasonMark(); draw();
};
let playT = null;
function stopPlay() { clearInterval(playT); playT = null; $('play').innerHTML = icon('play'); $('play').classList.remove('on'); $('play').setAttribute('aria-label', tr('playTitle')); $('play').setAttribute('aria-pressed', 'false'); }
$('play').onclick = () => {
  if (playT) return stopPlay();
  if (!pt) return;
  const [y, m, d] = ymd(), ev = dayEvents(pt.lat, pt.lng, y, m, d);
  const mins = t => { const x = hmIn(t, TZ); return x.h * 60 + x.m; };
  const a = ev.sunrise ? mins(ev.sunrise) : 0, z = ev.sunset ? mins(ev.sunset) : ev.polar === 'night' ? 0 : 1439;
  if (z <= a) { say(tr('noSunrise'), 'warn'); return; }
  let t = a; $('play').innerHTML = icon('pause'); $('play').classList.add('on'); $('play').setAttribute('aria-label', tr('pauseTitle')); $('play').setAttribute('aria-pressed', 'true');
  playT = setInterval(() => { // ~6 sn'de doğumdan batıma, 5 dk adım
    $('time').value = t; draw(); t += 5;
    if (t > z) stopPlay();
  }, 6000 / ((z - a) / 5));
};
$('date').addEventListener('input', seasonMark);
// Mevsim çubuğu küçültülebilir (yalnız seçili mevsim + ▶ kalır); tercih saklanır
function seasonsMin(on) {
  $('seasons').classList.toggle('min', on);
  $('seasonsToggle').innerHTML = icon(on ? 'chevron-right' : 'chevron-left');
  const l = tr(on ? 'seasonsShow' : 'seasonsHide');
  $('seasonsToggle').setAttribute('aria-label', l); $('seasonsToggle').title = l; $('seasonsToggle').setAttribute('aria-expanded', String(!on));
}
$('seasonsToggle').onclick = () => { const on = !$('seasons').classList.contains('min'); lsSet('seasonsMin', on ? '1' : ''); seasonsMin(on); };
seasonsMin(!!lsGet('seasonsMin'));
seasonMark();
$('kat').oninput = () => { katSrc = null; draw(); };
$('katwarn').onclick = $('katmsg').onclick = e => { e.preventDefault(); if (katFix == null) return; $('kat').value = katFix; katSrc = null; draw(); };
setInterval(drawSky, 60000); // "şu an" göstergesi
// ---------- tanıtım / yardım kartı, yükseklik güveni ----------
const legend = [['#1ad940', 'lgVis'], ['#f7332a', 'lgBlock'], ['#a0522d', 'lgTerrain'], ['#ddd', 'lgBehind'], ['#ff9900', 'lgRiseSet'], ['#ffe600', 'lgSel'], ['#4af', 'lgHeading']]
  .map(([c, k]) => `<span style="white-space:nowrap;margin-right:8px"><span class="leg" style="background:${c}"></span>${tr(k)}</span>`).join(' ');
// Native <dialog>: odak kapanı, Escape ve kapanınca odağın geri dönmesi tarayıcıdan gelir
function openCard(html) { $('card').innerHTML = html; if (!$('modal').open) $('modal').showModal(); $('card').querySelector('button')?.focus(); }
function closeCard() { if ($('modal').open) $('modal').close(); }
$('modal').onclick = e => { if (e.target === $('modal')) closeCard(); }; // arka plana dokununca kapan
// İzinler kullanım anında değil, nedenleri anlatıldıktan sonra tek düğmeyle istenir (iOS izni dokunuşun içinde ister).
function showIntro(help = false) {
  openCard(`<h2 id="cardtitle">${help ? tr('helpTitle') : tr('introTitle')}</h2><p>${tr('introLead')}</p>
    <p>${tr('step1')}<br>${tr('step2')}<br>${tr('step3')}</p>
    <h3>${tr('permTitle')}</h3><p class="perm">${icon('locate')}<span>${tr('permLoc')}</span></p><p class="perm">${icon('compass')}<span>${tr('permMotion')}</span></p>
    <p class="muted">${tr('permData')}</p>
    ${help ? `<p class="muted">${tr('permDenied')}</p><h3>${tr('legendTitle')}</h3><p class="muted">${legend}</p><h3>${tr('aboutTitle')}</h3><p class="muted">${tr('note')}</p>` : ''}
    <div class="actions"><button class="btn" id="introSkip">${help ? tr('close') : tr('searchInstead')}</button>${compassOn && pt ? '' : `<button class="btn primary" id="introGo">${icon('locate')}${tr('useMyLoc')}</button>`}</div>`);
  // iOS: pusula izni bu dokunuşun içinde istenmeli (await'ten önce)
  $('introGo')?.addEventListener('click', () => { lsSet('introSeen', 1); requestCompass(); locate(); closeCard(); });
  $('introSkip').onclick = () => { lsSet('introSeen', 1); closeCard(); if (!help) { if (!pt) setPoint(51.4779, -0.0015); $('coord').focus(); } };
}
$('helpbtn').onclick = () => showIntro(true);
$('netbtn').onclick = () => {
  const errOf = { dsOverpass: 'overpass', dsElev: 'elev', dsTZ: 'tz', dsNom: 'nom', dsIrr: 'irr', dsTiles: 'tiles' };
  const row = (k, n) => { const e = NETERR[errOf[k]]; return `<tr><td>${esc(tr(k))}${e ? `<div class="bad">${esc(tr('svcErr', { e: e.msg, t: e.t.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) }))}</div>` : ''}</td><td>${n == null ? '' : esc(tr('reqs', { n }))}</td></tr>`; };
  openCard(`<h2 id="cardtitle">${tr('netTitle')}</h2><p>${tr('netOwn')}</p>
    <table class="net">${row('dsOverpass', NET.overpass)}${row('dsElev', NET.elev)}${row('dsTZ', NET.tz)}${row('dsNom', NET.nom)}${row('dsIrr', NET.irr)}${row('dsTiles', NET.tiles)}${row('dsCdn')}${row('dsCf')}</table>
    <div class="actions"><button class="btn" id="netClose">${tr('close')}</button></div>`);
  $('netClose').onclick = closeCard;
};
net('tiles'); NET.tiles--; // ilk metni yaz
// ❗ Yükseklik güveni: gölge düşürebilecek binaların çoğunun yüksekliği tahminiyse haritada uyar
let conf = null;
// seçili cepheye / bina listesine bağlı önbellek: kaydırıcı ve oynatma her karede yeniden hesaplatmasın
function getConf() {
  if (!pt || !last) return null;
  if (house) return house.conf ??= (() => {
    const L0 = localize(house.env.el, house.lat, house.lon, house.env.ground), all = L0.buildings.concat(L0.own);
    return heightConfidence(all, house.az, all.find(b => b.id === house.id));
  })();
  return B.conf ??= heightConfidence(B.buildings, pt.lat >= 0 ? 180 : 0);
}
function drawConf() {
  conf = getConf();
  const show = conf && conf.level !== 'ok';
  const was = $('conf').style.display !== 'none';
  $('conf').style.display = show ? '' : 'none';
  if (!show) return;
  // ilk görünüşte metinle açık, birkaç saniye sonra yalnız ünleme katlanır (yer açmak için); dokununca açıklama
  if (!was) { $('conf').classList.remove('mini'); clearTimeout(drawConf.t); drawConf.t = setTimeout(() => $('conf').classList.add('mini'), 5000); }
  $('conf').classList.toggle('low', conf.level === 'low');
  $('conftxt').textContent = tr(conf.level === 'low' ? 'confLow' : 'confMid');
  $('conf').setAttribute('aria-label', tr('confTitle'));
}
$('conf').onclick = () => openConf();
function openConf() {
  conf = getConf();
  if (!conf) return;
  const o = house ? { lat: house.lat, lng: house.lon } : pt;
  openCard(`<h2 id="cardtitle">${tr('confTitle')}</h2><p>${tr('confBody', { g: conf.guessed, n: conf.n })}</p>
    ${conf.targetGuessed ? `<p>${tr('confTarget')}</p>` : ''}<p>${tr('confFix')}</p>
    <p><a href="https://www.openstreetmap.org/edit#map=19/${o.lat.toFixed(5)}/${o.lng.toFixed(5)}" target="_blank" rel="noopener">${tr('confEdit')} ↗</a></p>
    <div class="actions"><button class="btn" id="confClose">${tr('close')}</button></div>`);
  $('confClose').onclick = closeCard;
};

// Açılış: ilk ziyarette tanıtım kartı (izinler oradan istenir). Sonraki ziyaretlerde izin zaten verilmişse doğrudan başla.
// E2E test kancası (yalnız ?e2e ile): iç duruma salt okunur erişim, e2e/run.js kullanır
if (new URLSearchParams(location.search).has('e2e')) window.__sp = { map, frame, get pt() { return pt; }, get house() { return house; }, get B() { return B; } };
drawHeading(); // üstteki ok, konum gelmeden de durumunu göstersin
if (!localStorage.getItem('introSeen')) showIntro();
else {
  navigator.permissions?.query({ name: 'geolocation' }).then(p => p.state === 'granted' ? locate() : setPoint(51.4779, -0.0015)).catch(() => locate()) ?? locate();
  // izin gerektirmeyen cihazlarda (Android) pusula kendiliğinden açılır; iOS'ta üstteki oka dokunulur
  if (matchMedia('(pointer: coarse)').matches && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') requestCompass();
}
