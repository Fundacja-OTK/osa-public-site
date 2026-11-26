// „Ostatnie”: ostatnio otwarte miejsca (ekrany i konkretne rekordy), najnowsze pierwsze, w localStorage tej przeglądarki.
// Przechowujemy tylko to, co i tak widać w panelu: nazwę ekranu, numer zamówienia, nazwę klienta / produktu (bez e-maili i telefonów).

export const RECENT_KEY = 'osa-recent';
export const RECENT_MAX = 8;
export const RECENT_DAYS = 7;   // starsze wpisy wypadają same — lista nie rośnie w nieskończoność
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
export function addRecent(list, entry, max, now) {
  if (!entry || !TYPES[entry.t] || entry.id == null || entry.id === '') return list || [];
  const e = { t: entry.t, id: String(entry.id), label: String(entry.label || entry.id).slice(0, 80), ts: now || Date.now() };
  if (entry.path) e.path = String(entry.path);
  return [e, ...(list || []).filter(x => keyOf(x) !== keyOf(e))].slice(0, max || RECENT_MAX);
}

/** Tylko poprawne i świeże (≤ RECENT_DAYS dni; wpisy bez czasu — z dawnej wersji — liczą się jako świeże raz). */
export const fresh = (l, now) => (Array.isArray(l) ? l.filter(e => e && TYPES[e.t] && e.id != null && (!e.ts || (now || Date.now()) - e.ts <= RECENT_DAYS * 864e5)).slice(0, RECENT_MAX) : []);
const sane = l => fresh(l);

function ls() { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch (e) { return null; } }

export function loadRecents(storage) {
  try { const s = storage || ls(); return s ? sane(JSON.parse(s.getItem(RECENT_KEY) || '[]')) : []; } catch (e) { return []; }
}
export function saveRecents(list, storage) { try { const s = storage || ls(); if (s) s.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* brak zapisu — lista tylko na tę sesję */ } }

function changed() { try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('osa-recents')); } catch (e) { /* bez okna */ } }

/** Zapisuje wejście (ekran albo rekord) i powiadamia menu boczne. */
export function noteVisit(entry, storage) { saveRecents(addRecent(loadRecents(storage), entry), storage); changed(); }
export function clearRecents(storage) { saveRecents([], storage); changed(); }

export const RECENT_OWNER_KEY = 'osa-recent-who';
/**
 * „Ostatnie” należą do jednego loginu: lista zawiera nazwy klientów i numery zamówień, więc po zalogowaniu INNEGO konta w tej samej przeglądarce
 * (wspólny komputer, konto bez dostępu do Klientów) jest czyszczona. Wołane po starcie panelu z loginem z serwera. → true, gdy wyczyszczono.
 */
export function bindRecents(login, storage) {
  const who = String(login || '').trim().toLowerCase();
  if (!who) return false;
  try {
    const s = storage || ls(); if (!s) return false;
    const prev = s.getItem(RECENT_OWNER_KEY);
    if (prev === who) return false;
    const had = !!s.getItem(RECENT_KEY) && s.getItem(RECENT_KEY) !== '[]';
    // wpisy bez właściciela (sprzed tej zmiany) też znikają — nie wiadomo, czyje są
    s.setItem(RECENT_KEY, '[]'); s.setItem(RECENT_OWNER_KEY, who);
    if (had) changed();
    return had;
  } catch (e) { return false; }
}
/** Wylogowanie: lista znika z przeglądarki razem z sesją. */
export function forgetRecents(storage) {
  try { const s = storage || ls(); if (s) { s.removeItem(RECENT_KEY); s.removeItem(RECENT_OWNER_KEY); } } catch (e) { /* brak magazynu */ }
}

// Numer zamówienia w wyszukiwarce (lustro panel/worker/src/lib/orderNumber.js): „1021”, „1021/2026”, „#1021”.
export function parseOrderQuery(q) {
  const m = /^#?\s*(\d{1,9})\s*(?:\/\s*(\d{4}))?$/.exec(String(q == null ? '' : q).trim());
  return m ? { num: String(Number(m[1])), year: m[2] ? Number(m[2]) : null } : null;
}

/** Komunikat po przejściu do zamówienia z poprzedniego roku (numeracja w bieżącym roku jeszcze tam nie doszła); '' gdy nie dotyczy. */
export function yearNote(res) {
  return res && res.found && res.fallback ? res.number + ' — w tym roku jeszcze nie ma nr ' + res.num : '';
}
