// Kalıcı önbellek (IndexedDB): bina hücreleri, arazi karoları, ışınım arşivi. localStorage 5 MB ile sınırlı ve senkron.
// Her kayıt { t: kayıt zamanı, v: değer }; tazeliği çağıran karar verir (TTL), eskiler açılışta budanır.
// IndexedDB yoksa (gizli pencere, eski tarayıcı) önbellek sessizce devre dışı kalır, uygulama ağdan çalışır.
// IndexedDB açılışı hata vermeden takılı kalabiliyor (bekleyen silme, bozuk depolama, bazı gizli pencereler): açılış 1 sn'de, her
// işlem 3 sn'de vazgeçer. Açılış takılırsa önbellek bu oturumda kapalı kalır; yoksa sayfa "yükleniyor"da sonsuza kadar bekliyordu.
// Açılış sınırı kısa: ilk veri isteği önbellek cevabını bekler, normal açılış birkaç ms sürer.
const within = (p, ms = 3000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('idb timeout')), ms))]);
const open = () => within(new Promise((res, rej) => {
  const r = indexedDB.open('sunpeek', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('c');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('idb blocked'));
}), 1000);
let db = null;
const tx = async (mode, fn) => {
  db ??= open();
  const d = await db;
  return within(new Promise((res, rej) => { const t = d.transaction('c', mode), q = fn(t.objectStore('c')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }));
};
export const DAY = 864e5;
export const cget = k => tx('readonly', s => s.get(k)).catch(() => undefined);
export const cput = (k, v) => tx('readwrite', s => s.put({ t: Date.now(), v }, k)).catch(() => {});
// Hücre/karo grubu: hepsi TTL içinde varsa değerleri, eksik ya da bayatları ayrı döner
export async function cmany(keys, ttl) {
  const now = Date.now(), got = await Promise.all(keys.map(cget)), fresh = new Map(), stale = new Map(), missing = [];
  keys.forEach((k, i) => { const r = got[i]; if (!r) missing.push(k); else (now - r.t < ttl ? fresh : stale).set(k, r.v); });
  return { fresh, stale, missing };
}
// Açılışta: maxAge'den eski kayıtları ve eskimiş sürüm öneklerini (drop) sil (hiçbir TTL maxAge'den uzun değil)
export const cprune = (maxAge, drop = []) => tx('readwrite', s => {
  const lim = Date.now() - maxAge, q = s.openCursor();
  q.onsuccess = () => { const c = q.result; if (!c) return; if (c.value.t < lim || drop.some(p => String(c.key).startsWith(p))) c.delete(); c.continue(); };
}).catch(() => {});
