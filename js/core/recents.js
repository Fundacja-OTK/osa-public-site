// „Ostatnie”: ostatnio otwarte miejsca (ekrany i konkretne rekordy), najnowsze pierwsze, w localStorage tej przeglądarki.
// Przechowujemy tylko to, co i tak widać w panelu: nazwę ekranu, numer zamówienia, nazwę klienta / produktu (bez e-maili i telefonów).

export const RECENT_KEY = 'osa-recent';
export const RECENT_MAX = 8;
export const TYPES = {
  screen: { icon: 'sliders', name: 'Ekran' },
  order: { route: 'zamowienia', icon: 'bag', name: 'Zamówienie' },
  client: { route: 'klienci', icon: 'user', name: 'Klient' },
  product: { route: 'produkty', icon: 'box', name: 'Produkt' },
};

const keyOf = e => e.t + ':' + e.id;
/** Adres (hash) wpisu. */
export function hashOf(e) {
  if (e.t === 'screen') return '#/' + (e.path || e.id);
  return '#/' + TYPES[e.t].route + '/' + encodeURIComponent(e.id);
}

/** Nowa lista po wejściu w `entry` { t, id, label, path? } — bez duplikatów, najnowszy pierwszy, max `max`. */
export function addRecent(list, entry, max) {
  if (!entry || !TYPES[entry.t] || entry.id == null || entry.id === '') return list || [];
  const e = { t: entry.t, id: String(entry.id), label: String(entry.label || entry.id).slice(0, 80) };
  if (entry.path) e.path = String(entry.path);
  return [e, ...(list || []).filter(x => keyOf(x) !== keyOf(e))].slice(0, max || RECENT_MAX);
}

const sane = l => (Array.isArray(l) ? l.filter(e => e && TYPES[e.t] && e.id != null).slice(0, RECENT_MAX) : []);

function ls() { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch (e) { return null; } }

export function loadRecents(storage) {
  try { const s = storage || ls(); return s ? sane(JSON.parse(s.getItem(RECENT_KEY) || '[]')) : []; } catch (e) { return []; }
}
export function saveRecents(list, storage) { try { const s = storage || ls(); if (s) s.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* brak zapisu — lista tylko na tę sesję */ } }

function changed() { try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('osa-recents')); } catch (e) { /* bez okna */ } }

/** Zapisuje wejście (ekran albo rekord) i powiadamia menu boczne. */
export function noteVisit(entry, storage) { saveRecents(addRecent(loadRecents(storage), entry), storage); changed(); }
export function clearRecents(storage) { saveRecents([], storage); changed(); }
