// Statystyka „wyjść do Selly”: zlicza kliknięcia w linki (↗) prowadzące do panelu administracyjnego Selly, żeby wiedzieć,
// które ekrany warto jeszcze wbudować w panel OSA. Jeden nasłuch kliknięć w całym dokumencie (nie trzeba zmieniać miejsc tworzenia linków).
// Wysyłamy WYŁĄCZNIE: trasę Selly (wartość a=, np. zamowienia.add) i trasę panelu bez identyfikatorów (np. /zamowienia/:id).
// Bez numerów rekordów, parametrów adresu, tekstu i danych użytkownika. Paczka co najwyżej raz na minutę i przy ukryciu strony; błędy są ciche.
import { deliver } from './delivery.js?v=6d8ea70';

export const FLUSH_MS = 60000;
export const MAX_ROWS = 20;        // zgodnie z limitem Workera (modules/exits.js)
const SELLY_RE = /^[a-z0-9][a-z0-9._-]{0,59}$/i;

/** Trasa Selly z adresu, gdy adres wskazuje panel Selly (ten sam host i ścieżka co adminUrl); inaczej null. Bez parametru a= → 'start'. */
export function sellyRouteOf(href, adminUrl, base) {
  let u, a;
  try { u = new URL(href, base || 'http://x.invalid/'); a = new URL(adminUrl); } catch (e) { return null; }
  if (u.host !== a.host || !u.pathname.startsWith(a.pathname)) return null;
  const route = u.searchParams.get('a') || 'start';
  return SELLY_RE.test(route) ? route.toLowerCase() : null;
}

/** Ekran panelu z hasha: bez parametrów; segmenty z cyfrą (numery, identyfikatory, numery zamówień) → :id. */
export function panelRouteOf(hash) {
  const path = String(hash || '').replace(/^#/, '').split('?')[0].split('#')[0];
  const segs = path.split('/').filter(Boolean).slice(0, 6).map(s => (/\d/.test(s) || s.length > 30 ? ':id' : s.toLowerCase()));
  return ('/' + segs.join('/')).slice(0, 80);
}

/** Rdzeń bez przeglądarki: licznik w pamięci + wysyłka co najmniej minutę od poprzedniej (czas, timer i wysyłka wstrzykiwane). */
export function createExitCounter(o) {
  const now = o.now || Date.now;
  const setTimer = o.setTimer || ((f, ms) => setTimeout(f, ms));
  const pending = new Map();   // 'trasaSelly\ntrasaPanelu' → n
  let timer = null, last = 0, inFlight = false;

  const schedule = () => { if (!timer && pending.size) timer = setTimer(() => { timer = null; flush(); }, Math.max(1000, last + FLUSH_MS - now())); };

  function note(sellyRoute, panelRoute) {
    const k = sellyRoute + '\n' + panelRoute;
    if (!pending.has(k) && pending.size >= MAX_ROWS) return;
    pending.set(k, Math.min(50, (pending.get(k) || 0) + 1));
    schedule();
  }

  async function flush(force) {
    if (inFlight || !pending.size) return false;
    if (!force && now() - last < FLUSH_MS && last) { schedule(); return false; }
    const rows = [...pending].map(([k, n]) => { const [s, p] = k.split('\n'); return { s, p, n }; });
    pending.clear();
    last = now(); inFlight = true;
    try { await o.send(rows); } catch (e) { /* ciche: statystyka nie jest warta błędu */ }
    inFlight = false;
    schedule();
    return true;
  }

  return { note, flush, pendingCount: () => pending.size };
}

/** Okablowanie w przeglądarce: nasłuch kliknięć (także środkowy przycisk), window.open i zdarzenia ukrycia strony. */
export function initSellyExits({ config, getToken, hasToken, getAdminUrl }) {
  const adminUrl = () => getAdminUrl();
  const c = createExitCounter({
    send: rows => deliver({ config, only: 'A', getToken: (f, k) => (hasToken() ? getToken(f, k) : Promise.reject(new Error('niezalogowany'))),
      action: 'client:exits', params: { rows }, fetchImpl: (u, opts) => fetch(u, { ...opts, keepalive: true }) }),   // keepalive: przeżywa zamknięcie karty
  });
  const note = href => { try { const s = sellyRouteOf(href, adminUrl(), location.href); if (s) c.note(s, panelRouteOf(location.hash)); } catch (e) { /* ignorujemy */ } };
  const onClick = ev => {
    if (ev.button > 1) return;   // lewy i środkowy; prawy (menu) nie otwiera strony
    const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (a) note(a.getAttribute('href'));
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);
  // Przyciski otwierające Selly przez window.open (bez elementu <a>)
  const open = window.open;
  window.open = function (u, ...rest) { if (u) note(String(u)); return open.call(this, u, ...rest); };
  const hide = () => { if (document.visibilityState === 'hidden') c.flush(true); };
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('pagehide', () => c.flush(true));
  return c;
}
