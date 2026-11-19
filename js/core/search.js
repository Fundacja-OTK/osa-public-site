// Czyste funkcje szybkiego wyszukiwania (paleta Ctrl+K): dopasowanie bez polskich znaków i wielkości liter, podświetlanie, prefiksy.
// Bez zależności od DOM (testy jednostkowe). Wzór `norm` jak w core/ui.js (ł→l, bez znaków diakrytycznych; długość tekstu bez zmian).

export const norm = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036F]/g, '');

/** Prefiksy zawężające wyszukiwanie: „zam: kowalski” → tylko zamówienia. */
export const PREFIXES = [
  { key: 'zam', scope: 'orders', title: 'Zamówienia', example: 'zam: 1234', tip: 'Szukaj tylko wśród zamówień (numer, nazwisko, e-mail…)' },
  { key: 'kli', scope: 'clients', title: 'Klienci', example: 'kli: kowalski', tip: 'Szukaj tylko wśród klientów (nazwisko, firma, miasto…)' },
  { key: 'prod', scope: 'products', title: 'Produkty', example: 'prod: flaga', tip: 'Szukaj tylko wśród produktów (nazwa, kod, EAN…)' },
  { key: 'ekran', scope: 'screens', title: 'Ekrany', example: 'ekran: magazyny', tip: 'Szukaj tylko wśród ekranów i sekcji panelu' },
];

/** „zam: abc” → { scope: 'orders', q: 'abc', prefix: 'zam' }; bez prefiksu scope = null. */
export function parseQuery(raw) {
  const s = String(raw || '');
  const m = /^\s*(zam|kli|prod|ekran)\s*:\s*(.*)$/i.exec(s);
  if (!m) return { scope: null, q: s.trim(), prefix: '' };
  const p = PREFIXES.find(x => x.key === m[1].toLowerCase());
  return { scope: p.scope, q: m[2].trim(), prefix: p.key };
}

const tokens = q => norm(q).split(/\s+/).filter(Boolean);

/** 0 = brak dopasowania; 3 = początek tekstu, 2 = początek słowa, 1 = gdziekolwiek. Wszystkie słowa zapytania muszą pasować. */
export function score(text, q) {
  const t = norm(text), ts = tokens(q);
  if (!ts.length) return 0;
  let total = 0;
  for (const w of ts) {
    const i = t.indexOf(w);
    if (i < 0) return 0;
    total += i === 0 ? 3 : /[\s\-_/.,(]/.test(t[i - 1]) ? 2 : 1;
  }
  return total / ts.length;
}

/** Dzieli tekst na kawałki { t, hit } do podświetlenia dopasowanych słów (bez względu na polskie znaki). */
export function highlightParts(text, q) {
  const s = String(text == null ? '' : text), t = norm(s), ts = tokens(q);
  if (!ts.length || t.length !== s.length) return [{ t: s, hit: false }];
  const hit = new Array(s.length).fill(false);
  for (const w of ts) for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + w.length)) for (let k = i; k < i + w.length; k++) hit[k] = true;
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === hit[i]) last.t += s[i]; else out.push({ t: s[i], hit: hit[i] });
  }
  return out.length ? out : [{ t: s, hit: false }];
}

/** Ekrany pasujące do zapytania (najlepsze pierwsze). items: [{ id, title, section?, ... }], sectionTitle(item) → nazwa sekcji. */
export function matchScreens(items, q, sectionTitle, limit) {
  const out = [];
  for (const it of items) {
    const a = score(it.title, q), b = sectionTitle ? score(sectionTitle(it), q) * .3 : 0;
    const sc = Math.max(a, b);
    if (sc > 0) out.push({ it, sc });
  }
  out.sort((x, y) => y.sc - x.sc || x.it.title.localeCompare(y.it.title, 'pl'));
  return out.slice(0, limit || 8).map(x => x.it);
}
