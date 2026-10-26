// SunPeek uçtan uca testi. Uygulamanın kendi kökeninde bir sayfada çalıştırılır (ör. Chrome DevTools'ta
// evaluate_script sourcePath ile, ya da konsola yapıştırıp çağırarak). window.E2E.run(<senaryo>) her senaryoyu
// telefon boyutunda ayrı bir iframe'de ?e2e ile açar, gerçek tıklama/olay gönderir ve sonuçları döndürür.
// Ağ gerektirir (Overpass, Open-Meteo, Nominatim); ilk yükleme yavaş olabilir, sonrası localStorage önbelleğinden gelir.
async () => {
  const sl = ms => new Promise(r => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: ok ? '' : String(detail).slice(0, 300) }); };
  const until = async (fn, ms = 90000, step = 300) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch {} await sl(step); } return null; };

  // Uygulamayı aç: storage = localStorage'a önceden yazılacaklar (aynı köken, iframe ile paylaşılır)
  async function open({ lang = 'sv', intro = true, w = 390, h = 844, storage = {}, clear = true } = {}) {
    if (clear) for (const k of Object.keys(localStorage)) if (!/^(ov:|zg:|hz:|tz:)/.test(k)) localStorage.removeItem(k); // veri önbellekleri kalsın
    if (lang) localStorage.setItem('lang', lang);
    if (intro) localStorage.setItem('introSeen', '1');
    for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    const f = document.createElement('iframe');
    f.style.cssText = `width:${w}px;height:${h}px;position:fixed;left:-${w + 50}px;top:0;border:0`;
    f.src = '/?e2e&' + Math.random();
    document.body.appendChild(f);
    await new Promise(r => f.onload = r);
    const win = f.contentWindow, d = f.contentDocument, $ = id => d.getElementById(id), errors = [];
    win.addEventListener('error', e => errors.push('error: ' + e.message));
    win.addEventListener('unhandledrejection', e => errors.push('rejection: ' + (e.reason?.message ?? e.reason)));
    await until(() => win.__sp, 10000);
    await sl(300);
    const app = {
      f, win, d, $, errors, sp: win.__sp,
      close() { f.remove(); },
      text: () => d.body.innerText,
      loaded: () => until(() => win.__sp.pt && $('bstat').textContent && !/…$/.test($('bstat').textContent.trim()) ? true : null),
      async go(lat, lng) { $('coord').value = `${lat}, ${lng}`; $('go').click(); await sl(200); await app.loaded(); await sl(400); },
      // Haritada bir enlem/boylama gerçek tıklama (Leaflet mousedown/mouseup/click)
      async tapLatLng(lat, lng) {
        const p = win.__sp.map.latLngToContainerPoint([lat, lng]), r = $('map').getBoundingClientRect();
        for (const t of ['mousedown', 'mouseup', 'click']) $('map').dispatchEvent(new win.MouseEvent(t, { clientX: r.left + p.x, clientY: r.top + p.y, bubbles: true }));
        await sl(600);
      },
      // Gözlemciye en yakın, tamamen ekranda olan binayı bul ve ortasına dokun
      nearestBuilding(minArea = 60) {
        const B = win.__sp.B, all = B.buildings.filter(b => (b.x1 - b.x0) * (b.y1 - b.y0) > minArea).sort((a, b) => Math.hypot(a.cx, a.cy) - Math.hypot(b.cx, b.cy));
        return all[0];
      },
      toLatLng(x, y) { const pt = win.__sp.pt; return win.__sp.frame(pt.lat, pt.lng).from(x, y); },
      orient(alpha, n = 25) { for (let i = 0; i < n; i++) win.dispatchEvent(new win.DeviceOrientationEvent('deviceorientationabsolute', { alpha, beta: 0, gamma: 0, absolute: true })); },
    };
    return app;
  }
  const noErr = (name, app) => check(`${name}: JS hatası yok`, !app.errors.length, app.errors.join(' | '));

  const S = {
    // 1. İlk açılış: tanıtım kartı, izin açıklaması, Geç
    async intro() {
      const a = await open({ lang: 'tr', intro: false });
      check('intro: kart açık', a.$('modal').open);
      const c = a.$('card').innerText;
      check('intro: izin açıklamaları var', /Konum/.test(c) && /Hareket ve yön/.test(c) && /sunucuda/.test(c), c);
      check('intro: iki düğme', a.$('introGo') && a.$('introSkip'));
      a.$('introSkip').click(); await sl(300);
      check('intro: Adres ara kartı kapatır ve aramaya odaklar', !a.$('modal').open && a.d.activeElement === a.$('coord'));
      check('intro: introSeen kaydedildi', a.win.localStorage.getItem('introSeen') === '1');
      check('intro: pusula düğmesi etiketli', /Pusula/.test(a.$('arrow').getAttribute('aria-label') || ''), a.$('arrow').getAttribute('aria-label'));
      await a.loaded();
      check('intro: Geç sonrası varsayılan konum', a.sp.pt && Math.abs(a.sp.pt.lat - 51.4779) < 1e-3);
      a.$('helpbtn').click(); await sl(200);
      check('yardım: ℹ️ kartı açar, renkler bölümü', a.$('modal').open && /Renkler/.test(a.$('card').innerText));
      a.$('introSkip').click(); await sl(100);
      check('yardım: Kapat kapatır', !a.$('modal').open);
      noErr('intro', a); a.close();
    },
    // 2. Diller: yer tutucu/anahtar sızıntısı yok, mevsim düğmeleri sığıyor
    async langs() {
      for (const l of ['en', 'sv', 'tr', 'de', 'es', 'fr']) {
        const a = await open({ lang: l });
        await a.go(51.4779, -0.0015);
        const txt = a.text();
        check(`dil ${l}: <html lang>`, a.d.documentElement.lang === l, a.d.documentElement.lang);
        check(`dil ${l}: {yer tutucu} sızmadı`, !/\{\w+\}/.test(txt), txt.match(/\{\w+\}/)?.[0]);
        check(`dil ${l}: ham anahtar görünmüyor`, !/\b(riseSet|emptyHint|floorLabel|lgVis|confBody|aOff)\b/.test(txt), txt.match(/\b(riseSet|emptyHint|floorLabel|lgVis|confBody|aOff)\b/)?.[0]);
        const s = a.$('seasons');
        check(`dil ${l}: mevsim düğmeleri sığıyor`, s.scrollWidth <= s.clientWidth + 1, `${s.scrollWidth}>${s.clientWidth}`);
        check(`dil ${l}: boş durum ipucu görünür`, a.$('empty').style.display !== 'none' && a.$('empty').textContent.length > 20);
        noErr(`dil ${l}`, a); a.close();
      }
    },
    // 3. Hesap: Greenwich 21 Haziran yerel saat (BST) gün doğumu/batımı
    async sunTimes() {
      const a = await open({ lang: 'sv' });
      a.$('date').value = '2026-06-21'; a.$('date').dispatchEvent(new a.win.Event('input'));
      await a.go(51.4779, -0.0015);
      await until(() => /Europe\/London/.test(a.$('pos').textContent), 15000);
      check('saat: Greenwich saat dilimi', /Europe\/London/.test(a.$('pos').textContent), a.$('pos').textContent);
      check('saat: doğum 04:42 / batım 21:20 (BST)', /04:42/.test(a.$('riseset').textContent) && /21:20/.test(a.$('riseset').textContent), a.$('riseset').textContent);
      noErr('saat', a); a.close();
    },
    // 4. Uzak yer: Stockholm saatli tarayıcıdan bile İstanbul'un yerel saati
    async remoteTZ() {
      const a = await open({ lang: 'sv' });
      a.$('date').value = '2026-06-21'; a.$('date').dispatchEvent(new a.win.Event('input'));
      await a.go(41.0255, 29.0150);
      await until(() => /Istanbul/.test(a.$('pos').textContent), 15000);
      check('saat dilimi: İstanbul doğum 05:31 / batım 20:39', /05:31/.test(a.$('riseset').textContent) && /20:39/.test(a.$('riseset').textContent), a.$('riseset').textContent);
      noErr('saat dilimi', a); a.close();
    },
    // 5. Dokunma: binaya dokun = cephe; duvarın 2 m dışı = yine cephe; açık alan = konum taşınır
    async tapping() {
      const a = await open({ lang: 'en' });
      await a.go(51.4779, -0.0015);
      const b = a.nearestBuilding();
      check('dokunma: yakında bina var', b, 'bina yok');
      if (!b) return a.close();
      await a.tapLatLng(...a.toLatLng(b.cx, b.cy));
      await until(() => a.$('house').style.display !== 'none', 8000);
      check('dokunma: binaya dokununca cephe seçildi', a.sp.house && a.sp.house.id === b.id, a.sp.house?.id);
      const tiles = [...a.d.querySelectorAll('.tile')].map(t => t.innerText);
      check('dokunma: 3 sonuç kutucuğu', tiles.length === 3 && tiles.every(t => /\d/.test(t)), tiles.join(' | '));
      check('dokunma: boş ipucu gizlendi', a.$('empty').style.display === 'none');
      // geçmişe kaydedildi ve kutucuktaki yaz değeriyle aynı
      const h = JSON.parse(a.win.localStorage.getItem('gecmis') || '[]');
      check('geçmiş: kayıt oluştu', h.length === 1, h.length);
      const mins = h[0] && Math.round(h[0].summerH * 60);
      check('geçmiş: yaz saati kutucukla aynı', h[0] && tiles[1].includes(`${Math.floor(mins / 60)} h ${mins % 60} min`), `${tiles[1]} vs ${h[0]?.summerH}`);
      await until(() => JSON.parse(a.win.localStorage.getItem('gecmis'))[0].addr, 15000);
      check('geçmiş: adres geldi (Nominatim)', JSON.parse(a.win.localStorage.getItem('gecmis'))[0].addr, 'adres yok');
      // serbest bırak, sonra duvarın 2 m dışına dokun
      a.d.getElementById('unpick').click(); await sl(300);
      // dışarısı boş bir duvar seç (bitişik nizamda ortak duvarın dışı komşunun içidir)
      const { pip } = await import('/sun.js'), allB = a.sp.B.buildings.concat(a.sp.B.own), r = b.ring;
      let target = null;
      for (let i = 0; i < r.length - 1 && !target; i++) {
        const [ax, ay] = r[i], [bx, by] = r[i + 1], L = Math.hypot(bx - ax, by - ay); if (L < 6) continue;
        let nx = (by - ay) / L, ny = -(bx - ax) / L; const mx = (ax + bx) / 2, my = (ay + by) / 2;
        if (pip(mx + nx, my + ny, r)) { nx = -nx; ny = -ny; }
        const px = mx + nx * 2, py = my + ny * 2;
        if (allB.every(q => !pip(px, py, q.ring)) && allB.every(q => q === b || q.ring.every(([qx, qy]) => Math.hypot(qx - px, qy - py) > 8))) target = [px, py];
      }
      a.sp.map.setZoom(18); await sl(600);
      if (target) await a.tapLatLng(...a.toLatLng(...target)); else check('dokunma: boş dışlı duvar yok (atlandı)', true);
      await until(() => a.sp.house, 5000);
      if (target) check('dokunma: duvarın 2 m dışı da cepheyi seçer', a.sp.house && a.sp.house.id === b.id, a.sp.house?.id);
      // açık alan: tüm binalardan ≥40 m uzak bir nokta ara
      const B = a.sp.B.buildings; let spot = null;
      for (let k = 0; k < 400 && !spot; k++) { const x = (Math.random() - 0.5) * 300, y = (Math.random() - 0.5) * 300; if (B.every(q => Math.hypot(q.cx - x, q.cy - y) > 40)) spot = [x, y]; }
      if (spot) {
        const before = a.sp.pt; a.sp.map.setZoom(17); await sl(500);
        const ll = a.toLatLng(...spot);
        await a.tapLatLng(...ll); await sl(900);
        check('dokunma: açık alana dokununca konum taşındı', a.sp.pt.distanceTo(before) > 20, a.sp.pt.distanceTo(before));
        check('dokunma: harita dokunulan yere ortalandı', a.sp.map.getCenter().distanceTo(ll) < 15, a.sp.map.getCenter().distanceTo(ll));
      } else check('dokunma: açık alan bulunamadı (atlandı)', true);
      noErr('dokunma', a); a.close();
    },
    // 6. Mevsimler: kuzeyde Yaz=06-21, güneyde (Sidney) Yaz=12-21; oynatma
    async seasons() {
      const a = await open({ lang: 'en' });
      await a.go(51.4779, -0.0015);
      const y = a.$('date').value.slice(0, 4), btn = s => a.d.querySelector(`[data-s="${s}"]`);
      btn('summer').click(); await sl(200);
      check('mevsim: kuzey Yaz = 21 Haziran', a.$('date').value === `${y}-06-21` && btn('summer').classList.contains('on'), a.$('date').value);
      btn('winter').click(); await sl(200);
      check('mevsim: kuzey Kış = 21 Aralık', a.$('date').value === `${y}-12-21`, a.$('date').value);
      btn('today').click(); await sl(200);
      check('mevsim: Bugün geri döner', btn('today').classList.contains('on'));
      btn('summer').click(); const t0 = a.$('tval').textContent;
      a.$('play').click(); await sl(1500);
      check('oynat: başlar ve saat ilerler', a.$('play').classList.contains('on') && /#i-pause/.test(a.$('play').innerHTML) && a.$('tval').textContent !== t0, `${t0}→${a.$('tval').textContent}`);
      a.$('play').click(); await sl(200);
      check('oynat: ikinci dokunuş durdurur', !a.$('play').classList.contains('on') && /#i-play/.test(a.$('play').innerHTML));
      await a.go(-33.8568, 151.2153);
      btn('summer').click(); await sl(200);
      check('mevsim: güney Yaz = 21 Aralık', a.$('date').value.endsWith('-12-21'), a.$('date').value);
      noErr('mevsim', a); a.close();
    },
    // 7. Kutup: Tromsø 21 Aralık, güneş doğmuyor
    async polar() {
      const a = await open({ lang: 'tr' });
      a.$('date').value = '2026-12-21'; a.$('date').dispatchEvent(new a.win.Event('input'));
      await a.go(69.6496, 18.9560);
      check('kutup: "doğmuyor"', /doğmuyor/.test(a.$('riseset').textContent), a.$('riseset').textContent);
      a.$('play').click(); await sl(300);
      check('kutup: oynatma uyarısı', /doğmuyor/.test(a.$('gstat').textContent) && !a.$('play').classList.contains('on'), a.$('gstat').textContent);
      noErr('kutup', a); a.close();
    },
    // 8. Pusula: yön, harita dönmesi, kuzey-yukarı, kalibrasyon
    async compass() {
      const a = await open({ lang: 'en' });
      await a.go(51.4779, -0.0015);
      a.$('arrow').click(); await sl(800);
      a.orient(270); await sl(700);
      check('pusula: yön 90° (alpha 270)', /^90° E/.test(a.$('arrowtxt').textContent), a.$('arrowtxt').textContent);
      const pane = a.d.querySelector('.leaflet-rotate-pane')?.style.transform || '';
      check('pusula: harita döndü', /rotate\((?!0rad)/.test(pane), pane);
      check('pusula: düğme mavi (açık), "baktığım ev" görünür', a.$('arrow').classList.contains('on') && !a.$('look').hidden);
      const b = a.nearestBuilding(); await a.tapLatLng(...a.toLatLng(b.cx, b.cy)); await until(() => a.sp.house, 5000);
      check('pusula: cephe seçiliyken kalibrasyon düğmesi', a.$('calib'));
      if (a.$('calib')) {
        const want = (a.sp.house.az + 180) % 360;
        a.orient(360 - ((want - 7 + 360) % 360), 40); await sl(400); // telefon 7° şaşıyor
        a.$('calib').click(); await sl(300);
        check('kalibrasyon: düzeltme ≈ +7° kaydedildi', Math.abs(+a.win.localStorage.getItem('cmpOff') - 7) < 1.5, a.win.localStorage.getItem('cmpOff'));
      }
      a.$('arrow').click(); await sl(400);
      const pane2 = a.d.querySelector('.leaflet-rotate-pane')?.style.transform || '';
      check('pusula: kapatınca kuzey yukarı ve etiket boş', !a.$('arrow').classList.contains('on') && a.$('arrowtxt').textContent === '' && !/rotate\((?!0)/.test(pane2.replace(/rotate\(0(rad|deg)?\)/, '')), `${a.$('arrowtxt').textContent} ${pane2}`);
      noErr('pusula', a); a.close();
    },
    // 9. Kat: mantıksız kat uyarısı ve düzeltme; GPS rakımından kat
    async floor() {
      const a = await open({ lang: 'en' });
      a.win.navigator.geolocation.getCurrentPosition = ok => ok({ coords: { latitude: 51.4779, longitude: -0.0015, accuracy: 8, altitude: null, altitudeAccuracy: null } });
      await a.go(51.4779, -0.0015);
      const b = a.nearestBuilding(); await a.tapLatLng(...a.toLatLng(b.cx, b.cy)); await until(() => a.sp.house, 5000);
      a.$('kat').value = 30; a.$('kat').dispatchEvent(new a.win.Event('input')); await sl(300);
      check('kat: 30. kat için ❗', a.$('katwarn').style.display !== 'none' && /implausible/.test(a.$('katmsg').textContent), a.$('katmsg').textContent);
      a.$('katmsg').click(); await sl(300);
      check('kat: dokununca en üst kata düzeldi', +a.$('kat').value < 30 && a.$('katwarn').style.display === 'none', a.$('kat').value);
      a.$('gpskat').click(); await sl(200);
      check('kat: GPS rakımı yoksa açıklama', /no altitude/.test(a.$('gstat').textContent), a.$('gstat').textContent);
      noErr('kat', a); a.close();
    },
    // 10. ❗ Yükseklik güveni: İstanbul Kadıköy'de uyarı ve açıklama kartı
    async confidence() {
      const a = await open({ lang: 'tr' });
      await a.go(40.9892, 29.0272);
      check('güven: ❗ çıktı', a.$('conf').style.display !== 'none', a.$('conf').style.display);
      a.$('conf').click(); await sl(200);
      const c = a.$('card').innerText, link = a.$('card').querySelector('a')?.href || '';
      check('güven: açıklama ve OSM linki', /OpenStreetMap/.test(c) && /openstreetmap\.org\/edit#map=19\//.test(link) && /\d+ binadan \d+/.test(c), c.slice(0, 120) + ' ' + link);
      check('güven: link yeni sekmede, noopener', a.$('card').querySelector('a')?.rel.includes('noopener'));
      a.$('confClose').click(); await sl(100);
      check('güven: kapat', !a.$('modal').open);
      // Stockholm'de (yükseklik verisi zengin) uyarı çıkmamalı
      await a.go(59.3150, 18.0700);
      check('güven: Stockholm\'de ❗ yok', a.$('conf').style.display === 'none', a.$('conftxt').textContent);
      noErr('güven', a); a.close();
    },
    // 11. Geçmiş: sil, dokun → oraya git
    async history() {
      const a = await open({ lang: 'en' });
      await a.go(51.4779, -0.0015);
      const bs = a.sp.B.buildings.filter(b => (b.x1 - b.x0) * (b.y1 - b.y0) > 60).sort((p, q) => Math.hypot(p.cx, p.cy) - Math.hypot(q.cx, q.cy)).slice(0, 2);
      for (const b of bs) { await a.tapLatLng(...a.toLatLng(b.cx, b.cy)); await until(() => a.sp.house?.id === b.id, 5000); }
      const n = () => JSON.parse(a.win.localStorage.getItem('gecmis') || '[]').length;
      check('geçmiş: iki kayıt', n() === 2, n());
      a.$('histbox').open = true; await sl(100);
      a.d.querySelector('[data-del="0"]').click(); await sl(200);
      check('geçmiş: sil', n() === 1 && a.$('hcount').textContent === '1', n());
      await a.go(51.50, -0.12);
      a.d.querySelector('.hgo').click(); await sl(800);
      check('geçmiş: dokun → konuma git', Math.abs(a.sp.pt.lat - 51.478) < 0.01, a.sp.pt.lat);
      noErr('geçmiş', a); a.close();
    },
    // 12. Ağ hatası: Overpass ve yükseklik servisi erişilemezse anlaşılır mesaj, çökme yok
    async offline() {
      const a = await open({ lang: 'en' });
      await a.go(51.4779, -0.0015);
      const realFetch = a.win.fetch;
      a.win.fetch = () => Promise.reject(new Error('offline'));
      await a.go(+(51.40 + Math.random() * 0.1).toFixed(4), +(-0.20 + Math.random() * 0.1).toFixed(4)); // her koşuda önbellekte olmayan bir yer
      await until(() => a.$('retry'), 15000);
      const t = a.$('gstat').textContent;
      check('ağ hatası: görünür bina mesajı', /Couldn't load buildings/.test(t), t);
      check('ağ hatası: arazi mesajı', /ground elevation|horizon/.test(t), t);
      check('ağ hatası: ↻ Tekrar dene düğmesi', a.$('retry'));
      check('ağ hatası: gün doğumu yine hesaplandı', /\d/.test(a.$('riseset').textContent), a.$('riseset').textContent);
      a.win.fetch = realFetch;
      a.$('retry').click();
      await until(() => a.sp.B.buildings.length > 0, 90000);
      // binalar gelmeli; arazi servisi o an hız sınırındaysa (429) onun uyarısı ve ↻ kalabilir — bu doğru davranış
      check('yeniden dene: bağlantı gelince binalar yüklendi', a.sp.B.buildings.length > 0 && !/Couldn't load buildings/.test(a.$('gstat').textContent), a.$('gstat').textContent);
      noErr('ağ hatası', a); a.close();
    },
    // 13. Dil değiştir: seçim kaydedilir, sayfa yeni dilde açılır
    async langSwitch() {
      const a = await open({ lang: 'en' });
      a.$('morebox').open = true; a.$('lang').value = 'de'; a.$('lang').dispatchEvent(new a.win.Event('change'));
      await sl(1500); await until(() => a.f.contentDocument.documentElement.lang === 'de', 8000);
      check('dil seçici: Almancaya geçti', a.f.contentDocument.documentElement.lang === 'de' && localStorage.getItem('lang') === 'de');
      a.close();
    },
    // 15. Adres arama (Nominatim) ve koordinatla arama
    async search() {
      const a = await open({ lang: 'en' });
      await a.go(51.4779, -0.0015);
      a.$('coord').value = 'Trafalgar Square, London'; a.$('go').click();
      await until(() => a.$('sresults').querySelector('button'), 15000);
      const n = a.$('sresults').querySelectorAll('button').length;
      check('arama: adres sonuçları listelendi', n > 0, a.$('sresults').innerText);
      a.$('sresults').querySelector('button').click(); await sl(800);
      check('arama: sonuca dokununca oraya gitti', a.sp.pt && a.sp.pt.distanceTo([51.508, -0.128]) < 300, a.sp.pt && a.sp.pt.distanceTo([51.508, -0.128]));
      check('arama: liste kapandı', !a.$('sresults').innerHTML);
      a.$('coord').value = 'qqqzzxxyy nowhere 12345'; a.$('go').click();
      await until(() => /No results/.test(a.$('sresults').innerText), 15000);
      check('arama: sonuç yoksa söyler', /No results/.test(a.$('sresults').innerText), a.$('sresults').innerText);
      a.$('coord').value = '59.315, 18.07'; a.$('go').click(); await sl(400);
      check('arama: "lat, lon" doğrudan gider', Math.abs(a.sp.pt.lat - 59.315) < 1e-6, a.sp.pt.lat);
      noErr('arama', a); a.close();
    },
    // 16. Konumuma dön: GPS konumundan uzaklaşınca düğme çıkar, dokununca geri döner
    async backToMe() {
      const a = await open({ lang: 'en' });
      a.win.navigator.geolocation.getCurrentPosition = ok => ok({ coords: { latitude: 51.4779, longitude: -0.0015, accuracy: 10, altitude: null, altitudeAccuracy: null } });
      a.$('geo').click(); await a.loaded(); await sl(500);
      check('geri dön: GPS\'teyken konum düğmesi mavi, geri düğmesi yok', a.$('geo').classList.contains('on') && a.$('backbtn').hidden);
      await a.go(51.4900, -0.0015); // ~1,3 km kuzeye
      check('geri dön: uzaklaşınca "Back to my location" görünür', !a.$('backbtn').hidden && !a.$('geo').classList.contains('on'));
      a.$('backbtn').click(); await sl(1200);
      check('geri dön: dokununca GPS konumuna döndü', a.sp.pt.distanceTo([51.4779, -0.0015]) < 1 && a.$('backbtn').hidden, a.sp.pt.distanceTo([51.4779, -0.0015]));
      noErr('geri dön', a); a.close();
    },
    // 17. Kat düğmeleri ve dokunma alanları
    async controls() {
      const a = await open({ lang: 'de' });
      await a.go(51.4779, -0.0015);
      a.$('katplus').click(); a.$('katplus').click(); a.$('katminus').click(); await sl(200);
      check('kat: + + − = 1', a.$('kat').value === '1', a.$('kat').value);
      a.$('kat').value = 0; a.$('katminus').click(); await sl(100);
      check('kat: 0\'ın altına inmez', a.$('kat').value === '0', a.$('kat').value);
      const small = [...a.d.querySelectorAll('#panel button, #fabs button, #sform button, #seasons button')].filter(b => b.offsetParent && (b.offsetHeight < 34 || b.offsetWidth < 34)).map(b => (b.id || b.className) + ':' + b.offsetWidth + 'x' + b.offsetHeight);
      check('dokunma alanları ≥ 34 px', !small.length, small.join(', '));
      const unl = [...a.d.querySelectorAll('button')].filter(b => b.offsetParent && !b.textContent.trim() && !b.getAttribute('aria-label')).map(b => b.id || b.className);
      check('ikon düğmelerinin hepsinde aria-label', !unl.length, unl.join(', '));
      noErr('kontroller', a); a.close();
    },
    // 18. Hata regresyonu: pusula açıkken (GPS izleniyor) adres aranınca nokta adreste kalmalı, eski cephe bırakılmalı, ışınlar çizilmeli
    async searchWhileTracking() {
      const a = await open({ lang: 'en' });
      const gps = { coords: { latitude: 51.4779, longitude: -0.0015, accuracy: 8, altitude: null, altitudeAccuracy: null } };
      a.win.navigator.geolocation.getCurrentPosition = ok => ok(gps);
      a.win.navigator.geolocation.watchPosition = ok => a.win.setInterval(() => ok(gps), 500);
      a.win.navigator.geolocation.clearWatch = id => a.win.clearInterval(id);
      a.$('geo').click(); await a.loaded();
      a.$('arrow').click(); await sl(600); a.orient(0);
      const b = a.nearestBuilding(); await a.tapLatLng(...a.toLatLng(b.cx, b.cy)); await until(() => a.sp.house, 5000);
      a.$('coord').value = 'Trafalgar Square, London'; a.$('go').click();
      await until(() => a.$('sresults').querySelector('button'), 15000);
      a.$('sresults').querySelector('button').click(); await sl(4000); await a.loaded(); await sl(600);
      const rays = Object.values(a.sp.map._layers).filter(l => l instanceof a.win.L.Polyline && !(l instanceof a.win.L.Polygon)).length;
      check('regresyon: GPS izlenirken arama sonucu ezilmiyor', a.sp.pt.distanceTo([51.508, -0.128]) < 300, a.sp.pt.distanceTo([51.508, -0.128]));
      check('regresyon: eski cephe bırakıldı', !a.sp.house);
      check('regresyon: yeni yerde güneş ışınları çizildi', rays > 10, rays);
      check('regresyon: "Konumuma dön" görünür', !a.$('backbtn').hidden);
      a.$('backbtn').click(); await sl(1200);
      check('regresyon: konumuma dön → takip yeniden açık', a.sp.pt.distanceTo([51.4779, -0.0015]) < 1 && a.$('geo').classList.contains('on'));
      noErr('regresyon', a); a.close();
    },
    // 14. Masaüstü düzeni
    async desktop() {
      const a = await open({ lang: 'en', w: 1280, h: 800 });
      await a.go(51.4779, -0.0015);
      const p = a.$('panel').getBoundingClientRect();
      const sea = a.$('seasons').getBoundingClientRect();
      check('masaüstü: panel solda 360 px, mevsimlerin altında', Math.round(p.width) === 360 && p.left < 20 && p.top > sea.bottom, `${p.width} ${p.left} ${p.top} vs ${sea.bottom}`);
      check('masaüstü: harita tam ekran', a.$('map').getBoundingClientRect().height === 800);
      noErr('masaüstü', a); a.close();
    },
  };

  window.E2E = {
    names: Object.keys(S),
    async run(name) { results.length = 0; try { await S[name](); } catch (e) { check(`${name}: istisna`, false, e.stack || e.message); } return results.slice(); },
  };
  return 'E2E yüklendi: ' + Object.keys(S).join(', ');
}
