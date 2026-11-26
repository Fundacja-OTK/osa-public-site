// Świeżość danych zamówień w otwartym panelu (lista zamówień, pulpit; do użycia także w innych widokach zamówień).
//
//   • kontrolka „Odśwież · dane sprzed 40 s” — klik pobiera zmiany z Selly teraz (orders:refresh) i wczytuje widok od nowa,
//   • co pollMs (gdy karta przeglądarki jest widoczna) tani odczyt znacznika wersji (orders:stamp — 1 wiersz bazy, bez Selly);
//     widok wczytywany od nowa tylko, gdy znacznik się zmienił (i najwyżej raz na bgGapMs),
//   • powrót do karty / okna (visibilitychange, focus): gdy dane starsze niż maxAgeMs — pobranie zmian z Selly i ewentualnie widoku,
//   • nic nie dzieje się, gdy busy() (otwarty formularz, okno dialogowe, użytkownik właśnie klika w listę) — spróbujemy przy następnym takcie.
// Serwer pilnuje limitów (orders:refresh: raz na 20 s dla wszystkich, budżet Selly) — tu tylko uprzejme odstępy.
//
// Użycie:
//   const live = liveRefresh({ id: 'ord', reload: ({ background, manual }) => loadList(...), busy: () => … });
//   toolbar.append(live.node); live.start();   // po każdym wczytaniu danych: live.loaded(r.stamp); przy wyjściu z widoku: live.stop()

import { el } from './ui.js?v=5353574';
import { api as defaultApi } from './client.js?v=5353574';

const SEC = 1000;

/** „dane sprzed 40 s” / „sprzed 3 min” / „z 14:05”. */
export function ageText(ms) {
  const s = Math.max(0, Math.round(ms / SEC));
  if (s < 10) return 'dane aktualne';
  if (s < 60) return 'dane sprzed ' + s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return 'dane sprzed ' + m + ' min';
  return 'dane z ' + new Date(Date.now() - ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

/** Wynik orders:refresh → krótki komunikat dla użytkownika (albo '' — wtedy pokazujemy wiek danych). */
export function refreshMessage(r) {
  if (!r) return '';
  if (r.ran === false) return r.reason === 'recent' ? 'Sprawdzono przed chwilą' : (r.message || 'Odświeżenie wstrzymane');
  if (r.error) return r.error;
  if (r.changed) return 'Zaktualizowano: ' + r.changed + ' zam.';
  return 'Bez zmian w Selly';
}

export function liveRefresh(o) {
  const api = o.api || defaultApi;
  const pollMs = o.pollMs || 30 * SEC, maxAgeMs = o.maxAgeMs || 30 * SEC, bgGapMs = o.bgGapMs != null ? o.bgGapMs : 60 * SEC;
  const busy = () => { try { return !!(o.busy && o.busy()); } catch (e) { return true; } };
  const now = () => (o.now ? o.now() : Date.now());
  const S = { known: null, checkedAt: 0, lastBgAt: 0, active: false, inflight: false, pollTimer: 0, tickTimer: 0, retryTimer: 0,
    noStamp: false, noPull: false, msg: '', msgUntil: 0, backoff: 1 };

  const label = el('span', { class: 'live-age', id: o.id + 'LiveAge', 'aria-live': 'polite' });
  const btn = el('button', { type: 'button', class: 'ghost live-btn', id: o.id + 'LiveBtn',
    title: 'Pobierz zmiany z Selly teraz i odśwież widok. Panel sam sprawdza zmiany co ok. 30 s, gdy ta karta jest otwarta, oraz po powrocie do niej.',
    onclick: () => run({ manual: true }) }, '↻ Odśwież');
  const node = el('span', { class: 'live-ctl', id: o.id + 'Live',
    title: 'Dane pochodzą z kopii zamówień w panelu, synchronizowanej z Selly co minutę. Zmiany z Selly pojawiają się same; „Odśwież” pobiera je od razu.' }, btn, label);

  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  function render() {
    const t = now();
    if (S.msg && t < S.msgUntil) label.textContent = S.msg;
    else { S.msg = ''; label.textContent = S.checkedAt ? ageText(t - S.checkedAt) : ''; }
    label.classList.toggle('tip', !!S.checkedAt);
    label.title = S.checkedAt ? 'Ostatnie sprawdzenie zmian: ' + new Date(Date.now() - (t - S.checkedAt)).toLocaleTimeString('pl-PL') : '';
  }
  const say = (text, ms = 6 * SEC) => { S.msg = text; S.msgUntil = now() + ms; render(); };

  async function reload(kind) {
    S.lastBgAt = now();
    await o.reload(kind);   // moduł woła live.loaded(stamp) po udanym wczytaniu
  }

  /** Pobranie zmian z Selly (gdy wolno) + wczytanie widoku, gdy znacznik się zmienił (albo zawsze przy kliknięciu). */
  async function run({ manual = false } = {}) {
    if (S.inflight || !S.active) return;
    if (!manual && busy()) return;
    S.inflight = true;
    if (manual) { btn.disabled = true; btn.classList.add('busy'); say('Sprawdzam zmiany w Selly…', 60 * SEC); }
    try {
      let r = null;
      if (!S.noPull) {
        try { r = await api('orders:refresh', {}); }
        catch (e) { if (e && e.code === 501) S.noPull = true; r = null; }
      }
      const stamp = r && r.stamp != null ? r.stamp : null;
      if (manual) await reload({ background: false, manual: true });
      else if (stamp == null) { S.inflight = false; await poll(); }   // bez odświeżenia z Selly — przynajmniej znacznik
      else if (stamp !== S.known) { if (!busy()) await reload({ background: true }); }
      else S.checkedAt = now();
      if (r && r.ran === false && r.reason === 'recent' && r.retryInMs) later(r.retryInMs + 500);   // czyjeś odświeżenie w toku — sprawdzimy jego wynik
      if (manual) say(r ? refreshMessage(r) : 'Odświeżono z kopii panelu');
    } catch (e) {
      if (manual) say('Nie udało się odświeżyć — spróbuj za chwilę');
    } finally {
      S.inflight = false; btn.disabled = false; btn.classList.remove('busy'); render();
    }
  }

  /** Tani takt: znacznik wersji (bez Selly). */
  async function poll() {
    if (!S.active || S.inflight || S.noStamp || !visible() || busy()) return;
    S.inflight = true;
    try {
      const r = await api('orders:stamp', {});
      S.backoff = 1;
      if (r && r.stamp != null && r.stamp !== S.known) {
        if (now() - S.lastBgAt >= bgGapMs && !busy()) await reload({ background: true });
      } else S.checkedAt = now();
    } catch (e) {
      if (e && e.code === 501) S.noStamp = true;   // backend zapasowy nie zna znacznika — kontrolka działa dalej tylko na żądanie
      else S.backoff = Math.min(8, S.backoff * 2);
    } finally { S.inflight = false; render(); }
  }

  function later(ms) { clearTimeout(S.retryTimer); S.retryTimer = setTimeout(() => poll(), ms); }
  function schedule() {
    clearTimeout(S.pollTimer);
    if (!S.active) return;
    S.pollTimer = setTimeout(async () => { await poll(); schedule(); }, pollMs * S.backoff);
  }
  function onVisible() {
    if (!S.active || !visible()) return;
    render();
    if (now() - S.checkedAt > maxAgeMs) run();
  }

  return {
    node,
    /** Po każdym wczytaniu danych widoku (r.stamp z orders:list / orders:meta / dashboard:get). */
    loaded(stamp) { if (stamp != null) S.known = stamp; S.checkedAt = now(); render(); },
    start() {
      if (S.active) return;
      S.active = true; S.backoff = 1;
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', onVisible);
      S.tickTimer = setInterval(() => { if (visible()) render(); }, 10 * SEC);
      schedule(); render();
    },
    stop() {
      S.active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(S.tickTimer); clearTimeout(S.pollTimer); clearTimeout(S.retryTimer);
    },
    refresh: () => run({ manual: true }),
    poll, onVisible,
    get state() { return { ...S }; },
  };
}

/** Wiersze, które zmieniły się między dwoma wczytaniami (po id i treści) — do krótkiego podświetlenia. */
export function changedIds(prevRows, rows, key = r => r.id) {
  if (!prevRows) return new Set();
  const before = new Map(prevRows.map(r => [String(key(r)), JSON.stringify(r)]));
  const out = new Set();
  for (const r of rows || []) { const k = String(key(r)), b = before.get(k); if (b !== JSON.stringify(r)) out.add(k); }
  return out;
}
