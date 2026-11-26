// Pamięć odczytów API (słowniki, liczniki, listy) — szybszy start ekranów bez zmiany gwarancji świeżości.
//
//   cachedRead(action, params, { ttl, personal, fresh, onUpdate })  → Promise<dane>
//     • ten sam odczyt w toku = jedno zapytanie (wspólny Promise);
//     • wynik pobrany w tej karcie i młodszy niż ttl (ms, domyślnie 60 s) — od razu z pamięci, bez zapytania;
//     • starszy albo z sessionStorage (poprzednie wczytanie strony — przeładowanie ma dawać świeże dane): z onUpdate — od razu stary wynik
//       (stale-while-revalidate) + odświeżenie w tle, onUpdate(świeże) tylko, gdy dane się zmieniły; bez onUpdate — czeka na świeże dane;
//     • stamp — znacznik wersji danych (np. orders:stamp / pole `stamp` z orders:list; core/liveRefresh.js): wpis z innym znacznikiem
//       jest nieaktualny niezależnie od ttl (serwer trzyma własne pamięci pod tym samym znacznikiem — Worker lib/cache.js stampedValue);
//     • fresh: true — zawsze świeże dane z serwera (np. przed zapisem albo decyzją: stan magazynu, status) — wynik też trafia do pamięci;
//     • personal (domyślnie TRUE) — dane tylko w pamięci karty (znikają po przeładowaniu). Do sessionStorage trafia wyłącznie
//       personal: false ORAZ akcja z listy PERSIST (słowniki bez danych osobowych); inne akcje są trzymane tylko w pamięci.
//   peekCached(action, params, { ttl, personal }) → { data, at, stale } | null — do natychmiastowego pokazania (np. lista z poprzedniej wizyty) przed odświeżeniem
//   invalidate(prefix)  — po zapisie: usuwa wpisy akcji zaczynających się od prefix (np. 'products:')
//   clearReadCache()    — wszystko (wylogowanie)
//
// Zamówienia: widoczne odświeżanie i wykrywanie zmian robi core/liveRefresh.js — tu najwyżej pamięć w karcie (personal) ze znacznikiem `stamp`.
// Zasady: dane z pamięci pokazuj z widocznym odświeżaniem (np. „odświeżam…” / czas danych), a do zapisów i decyzji bierz fresh: true.
// Klucze w sessionStorage: „osa-c:<akcja>|<parametry JSON>” = { v: wersja panelu, u: login, at, data } (inna wersja/login → pomijane).

import { api, ENV } from './client.js?v=5281496';
import { sessionLogin } from './auth.js?v=5281496';

export const DEFAULT_TTL = 60 * 1000;
export const KEY_PREFIX = 'osa-c:';
const MAX_STORED = 256 * 1024;   // większych odpowiedzi nie zapisujemy w sessionStorage (limit ~5 MB na stronę)

/** Akcje, które wolno zapisać w sessionStorage (personal: false): słowniki bez danych osobowych. Funkcja = warunek na parametrach. */
const SAFE_RES = new Set(['kategorie', 'statusy', 'dostawy', 'atrybuty', 'producenci', 'platnosci-formy']);
export const PERSIST = {
  'products:facets': () => true,     // kategorie, producenci, magazyny (z licznikami)
  'products:dicts': () => true,      // pełne ścieżki kategorii, producenci
  'res:options': p => SAFE_RES.has(p && p.res),   // słowniki z Selly (każde odświeżenie = zapytania do Selly)
  'shipping:meta': () => true,       // kurierzy i mapowanie dostaw
};

const mem = new Map();        // klucz → { at, data }
const inflight = new Map();   // klucz → Promise

const stable = v => (v && typeof v === 'object' ? (Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}') : JSON.stringify(v === undefined ? null : v));
export const cacheKey = (action, params) => action + '|' + stable(params || {});
const persistable = (action, params, personal) => personal === false && !!PERSIST[action] && !!PERSIST[action](params || {});
const login = () => { try { return String(sessionLogin() || ''); } catch (e) { return ''; } };

function readStored(key) {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + key);
    if (!raw) return null;
    const e = JSON.parse(raw);
    return e && e.v === (ENV.version || '') && e.u === login() && typeof e.at === 'number' ? { at: e.at, data: e.data, stored: true } : null;
  } catch (e) { return null; }
}
function writeStored(key, entry) {
  try {
    const raw = JSON.stringify({ v: ENV.version || '', u: login(), at: entry.at, data: entry.data });
    if (raw.length <= MAX_STORED) sessionStorage.setItem(KEY_PREFIX + key, raw);
  } catch (e) { /* pełny lub zablokowany magazyn — zostaje pamięć */ }
}

function entryOf(action, params, personal) {
  const key = cacheKey(action, params);
  let e = mem.get(key);
  if (!e && persistable(action, params, personal)) { e = readStored(key); if (e) mem.set(key, e); }
  return e || null;
}

function fetchFresh(action, params, personal) {
  const key = cacheKey(action, params);
  if (inflight.has(key)) return inflight.get(key);
  const p = api(action, params).then(data => {
    const e = { at: Date.now(), data, stamp: data && data.stamp != null ? data.stamp : undefined };
    mem.set(key, e);
    if (persistable(action, params, personal)) writeStored(key, e);
    return data;
  });
  inflight.set(key, p);
  const drop = () => { if (inflight.get(key) === p) inflight.delete(key); };
  p.then(drop, drop);
  return p;
}

export function cachedRead(action, params, opts) {
  const o = opts || {}, ttl = o.ttl === undefined ? DEFAULT_TTL : o.ttl, personal = o.personal !== false;
  if (o.fresh) return fetchFresh(action, params, personal);
  const e = entryOf(action, params, personal);
  const sameStamp = o.stamp == null || (e && e.stamp === o.stamp);
  if (e && !e.stored && sameStamp && Date.now() - e.at < ttl) return Promise.resolve(e.data);
  if (e && typeof o.onUpdate === 'function') {
    const before = JSON.stringify(e.data);
    fetchFresh(action, params, personal).then(d => { if (JSON.stringify(d) !== before) o.onUpdate(d); }).catch(() => { /* zostają stare dane; błąd pokaże następne odświeżenie */ });
    return Promise.resolve(e.data);
  }
  return fetchFresh(action, params, personal);
}

export function peekCached(action, params, opts) {
  const o = opts || {}, ttl = o.ttl === undefined ? DEFAULT_TTL : o.ttl;
  const e = entryOf(action, params, o.personal !== false);
  return e ? { data: e.data, at: e.at, stale: !!e.stored || Date.now() - e.at >= ttl } : null;
}

export function invalidate(prefix) {
  const p = String(prefix || '');
  for (const k of [...mem.keys()]) if (k.startsWith(p)) mem.delete(k);
  try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k && k.startsWith(KEY_PREFIX + p)) sessionStorage.removeItem(k); } } catch (e) { /* bez magazynu */ }
}

export function clearReadCache() { invalidate(''); }
