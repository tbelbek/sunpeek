// Derlemede çalışır (Dockerfile): dil sayfaları /sv/ /tr/ /de/ /es/ /fr/ (başlık, açıklama, kanonik, og, JSON-LD, noscript çevrilmiş),
// sitemap.xml. Uygulama aynı; dili adresten okur (i18n.js). Bir metin bulunamazsa derleme durur.
// Kullanım: node seo.mjs <klasör>   (klasörde index.html olmalı)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const dir = process.argv[2] ?? '.', SITE = 'https://sunpeek.uk';
const L = {
  en: { locale: 'en_GB', title: 'SunPeek — how much sun does a balcony or window get?',
    desc: 'Free sun and shadow map for any address: hours of direct sun on a wall, window or balcony today, at midsummer and in winter, with shadows from nearby buildings and your floor.' },
  sv: { locale: 'sv_SE', title: 'SunPeek — hur mycket sol får balkongen och fönstren?',
    desc: 'Gratis sol- och skuggkarta för valfri adress: timmar med direkt sol på en fasad, ett fönster eller en balkong i dag, vid midsommar och på vintern, med skuggor från grannhusen och din våning.' },
  tr: { locale: 'tr_TR', title: 'SunPeek — balkon ve pencere ne kadar güneş alıyor?',
    desc: 'Her adres için ücretsiz güneş ve gölge haritası: bir cephe, pencere ya da balkon bugün, yaz ortasında ve kışın kaç saat doğrudan güneş alıyor; çevredeki binaların gölgesi ve katın hesaba katılır.' },
  de: { locale: 'de_DE', title: 'SunPeek — wie viel Sonne bekommen Balkon und Fenster?',
    desc: 'Kostenlose Sonnen- und Schattenkarte für jede Adresse: Stunden direkter Sonne auf Fassade, Fenster oder Balkon heute, zur Sommersonnenwende und im Winter, mit Schatten der Nachbargebäude und deinem Stockwerk.' },
  es: { locale: 'es_ES', title: 'SunPeek — ¿cuánto sol reciben el balcón y las ventanas?',
    desc: 'Mapa gratuito de sol y sombra para cualquier dirección: horas de sol directo en una fachada, ventana o balcón hoy, en pleno verano y en invierno, con la sombra de los edificios cercanos y tu planta.' },
  fr: { locale: 'fr_FR', title: 'SunPeek — combien de soleil reçoivent le balcon et les fenêtres ?',
    desc: "Carte gratuite du soleil et de l'ombre pour toute adresse : heures de soleil direct sur une façade, une fenêtre ou un balcon aujourd'hui, au solstice d'été et en hiver, avec l'ombre des bâtiments voisins et votre étage." },
};
const url = l => l === 'en' ? `${SITE}/` : `${SITE}/${l}/`;
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const en = readFileSync(`${dir}/index.html`, 'utf8');
const i18n = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8');

const swap = (s, from, to) => { if (!s.includes(from)) throw new Error(`seo.mjs: bulunamadı: ${from.slice(0, 80)}`); return s.split(from).join(to); };
for (const [l, d] of Object.entries(L)) {
  if (!i18n.includes(`'${d.title}'`) && !i18n.includes(`"${d.title}"`)) throw new Error(`seo.mjs: i18n.js başlığı farklı (${l}); ikisi aynı olmalı`);
  if (l === 'en') continue;
  let h = en;
  h = swap(h, '<html lang="en">', `<html lang="${l}">`);
  h = swap(h, `<title>${L.en.title}</title>`, `<title>${esc(d.title)}</title>`);
  h = swap(h, `content="${L.en.title}"`, `content="${esc(d.title)}"`);
  h = swap(h, `content="${L.en.desc}"`, `content="${esc(d.desc)}"`);
  h = swap(h, `<p>${L.en.desc} SunPeek needs JavaScript.</p>`, `<p>${esc(d.desc)}</p>`);
  h = swap(h, `"description":"${L.en.desc}"`, `"description":${JSON.stringify(d.desc)}`);
  h = swap(h, '"inLanguage":"en"', `"inLanguage":"${l}"`);
  h = swap(h, '<link rel="canonical" href="https://sunpeek.uk/">', `<link rel="canonical" href="${url(l)}">`);
  h = swap(h, '<meta property="og:url" content="https://sunpeek.uk/">', `<meta property="og:url" content="${url(l)}">`);
  h = swap(h, '"url":"https://sunpeek.uk/"', `"url":"${url(l)}"`);
  h = swap(h, `content="${L.en.locale}"`, `content="${d.locale}"`);
  mkdirSync(`${dir}/${l}`, { recursive: true });
  writeFileSync(`${dir}/${l}/index.html`, h);
}

// Site haritası: dil sayfaları (karşılıklı hreflang) ve yasal sayfalar
const alt = Object.keys(L).map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${url(l)}"/>`).join('') + `<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/"/>`;
const legal = ['privacy', 'terms'].flatMap(p => Object.keys(L).map(l => `${SITE}/${l === 'en' ? p : `${p}.${l}`}.html`));
writeFileSync(`${dir}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${Object.keys(L).map(l => `<url><loc>${url(l)}</loc>${alt}</url>`).join('\n')}
${legal.map(u => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`);
console.log(`seo: ${Object.keys(L).length - 1} dil sayfası, sitemap ${Object.keys(L).length + legal.length} adres`);
