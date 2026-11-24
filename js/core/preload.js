// Szybsze wczytywanie kodu ekranów (bez kroku budowania):
//  • warmModule(url) — przed import() modułu dodaje <link rel="modulepreload"> dla całego drzewa jego statycznych importów, więc przeglądarka
//    pobiera je równolegle zamiast kaskadą (moduł → jego importy → ich importy…). Mapę importów (window.OSA_MODGRAPH) dopisuje do js/preboot.js
//    krok wdrożenia scripts/preload.js; bez mapy (praca lokalna) nic nie robi — import() działa jak zwykle.
//  • moduleUrlOf(loader, base) — adres pliku z funkcji ładującej „() => import('…')” (ten sam literał, który bust-cache.js uzupełnia o ?v=).
//  • prefetchOnIntent(root, onIntent) — najechanie (po chwili), fokus albo dotknięcie linku „#/…” wewnątrz root → onIntent(href).
// CSP: <link rel="modulepreload"> podlega script-src 'self' (tylko pliki tej strony).

const warmed = new Set();

/** Indeks mapy: adres bezwzględny → numer pliku. */
let index = null;
function graph() {
  const g = typeof window !== 'undefined' && window.OSA_MODGRAPH;
  if (!g || !Array.isArray(g.f) || !Array.isArray(g.d)) return null;
  if (!index) {
    index = new Map();
    g.f.forEach((f, i) => { try { index.set(new URL(f, document.baseURI).href, i); } catch (e) { /* zły wpis */ } });
  }
  return g;
}

/** Pliki z drzewa statycznych importów modułu `url` (bez niego samego i bez już pobranych). Czysta funkcja na mapie { f, d }. */
export function closureOf(g, start) {
  const out = [], seen = new Set([start]), q = [start];
  while (q.length) for (const j of g.d[q.shift()] || []) if (!seen.has(j)) { seen.add(j); out.push(j); q.push(j); }
  return out;
}

export function warmModule(url) {
  try {
    const g = url && graph();
    if (!g) return 0;
    const i = index.get(url);
    if (i === undefined) return 0;
    let n = 0;
    for (const j of [i, ...closureOf(g, i)]) {
      const href = new URL(g.f[j], document.baseURI).href;
      if (warmed.has(href)) continue;
      warmed.add(href);
      if (document.querySelector('link[rel="modulepreload"][href="' + g.f[j].replace(/"/g, '') + '"]')) continue;   // już w index.html (rdzeń)
      const l = document.createElement('link');
      l.rel = 'modulepreload'; l.href = g.f[j];
      document.head.append(l); n++;
    }
    return n;
  } catch (e) { return 0; }
}

/** Adres modułu z treści funkcji „() => import('…')” względem `base` (import.meta.url pliku, w którym jest funkcja); '' gdy brak literału. */
export function moduleUrlOf(loader, base) {
  const m = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/.exec(String(loader));
  if (!m) return '';
  try { return new URL(m[2], base).href; } catch (e) { return ''; }
}

export const INTENT_DELAY_MS = 80;

export function prefetchOnIntent(root, onIntent) {
  if (!root) return;
  let timer = 0;
  const target = e => { const a = e.target && e.target.closest && e.target.closest('a[href^="#/"]'); return a && root.contains(a) ? a : null; };
  const fire = a => { try { onIntent(a.getAttribute('href')); } catch (e) { /* tylko przyspieszenie */ } };
  root.addEventListener('pointerover', e => { const a = target(e); clearTimeout(timer); if (a) timer = setTimeout(() => fire(a), INTENT_DELAY_MS); });
  root.addEventListener('pointerout', () => clearTimeout(timer));
  root.addEventListener('focusin', e => { const a = target(e); if (a) fire(a); });
  root.addEventListener('touchstart', e => { const a = target(e); if (a) fire(a); }, { passive: true });
}
