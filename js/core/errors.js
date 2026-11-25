// Zbieranie błędów przeglądarki (window error / unhandledrejection / nieudane wywołania API) i wysyłka do backendu:
// deduplikacja po sygnaturze (komunikat + szczyt stosu), limit zdarzeń na minutę, paczki co najmniej minutę od siebie.
// Rdzeń bez zależności od przeglądarki (zegar, timery i wysyłka wstrzykiwane — testy w node); okablowanie: initErrorReporting.
import { deliver } from './delivery.js?v=bdda14c';

export const MAX_EVENTS_PER_MIN = 30;     // więcej zdarzeń w minucie jest tylko liczone (dropped)
export const FLUSH_DELAY_MS = 15000;      // zbieranie zdarzeń przed wysyłką
export const MIN_FLUSH_GAP_MS = 60000;    // odstęp między paczkami
export const MAX_SIGS = 20;               // sygnatur w paczce
export const MAX_ATTEMPTS = 3;
const RING = 20;

/** Komunikat bez „szumu”: liczby i adresy nie zmieniają sygnatury (np. „… po 1234 ms”). */
const normMsg = m => String(m || '').replace(/https?:\/\/\S+/g, '<url>').replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Szczyt stosu: pierwsza ramka z nazwą funkcji / pliku, bez numerów linii (zmieniają się przy każdym wdrożeniu). */
export function stackTop(stack) {
  for (const line of String(stack || '').split('\n').slice(0, 6)) {
    const m = /^\s*(?:at\s+)?([^\s(@]+)?\s*[(@]?\s*(?:https?:\/\/[^/\s]+)?([^\s:()]*\/[^\s:()]+|[^\s:()]+\.js)/.exec(line);
    if (m && m[2]) return (m[1] || '') + '@' + m[2].split('/').pop();
  }
  return '';
}

export function errorSignature(message, stack) {
  const s = normMsg(message) + '|' + stackTop(stack);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return 'e' + (h >>> 0).toString(16);
}

/**
 * @param {{ send: (payload:{version,errors,dropped})=>Promise<boolean>, now?: ()=>number, setTimer?: Function, clearTimer?: Function,
 *           version?: string, getRoute?: ()=>string }} o
 */
export function createErrorReporter(o) {
  const now = o.now || Date.now;
  const setTimer = o.setTimer || ((f, ms) => setTimeout(f, ms));
  const clearTimer = o.clearTimer || (t => clearTimeout(t));
  const pending = new Map();      // sig → { sig, message, kind, route, count, attempts }
  const ring = [];                // ostatnie zdarzenia (do informacji technicznych w zgłoszeniu)
  let stamps = [], dropped = 0, lastFlush = 0, timer = null, inFlight = false;

  function schedule() {
    if (timer || !pending.size) return;
    const wait = Math.max(o.flushDelayMs || FLUSH_DELAY_MS, lastFlush + MIN_FLUSH_GAP_MS - now());
    timer = setTimer(() => { timer = null; flush(); }, wait);
  }

  /** report({ message, stack?, kind?: 'js'|'promise'|'api' }) — zwraca sygnaturę (albo '' gdy odrzucone limitem). */
  function report(e) {
    const t = now();
    const message = String((e && e.message) || e || 'nieznany błąd').slice(0, 300);
    const sig = errorSignature(message, e && e.stack);
    ring.push({ sig, message, at: new Date(t).toISOString().slice(11, 19) });
    if (ring.length > RING) ring.shift();
    stamps = stamps.filter(x => t - x < 60000);
    if (stamps.length >= MAX_EVENTS_PER_MIN) { dropped++; return ''; }
    stamps.push(t);
    const cur = pending.get(sig);
    if (cur) cur.count++;
    else if (pending.size < MAX_SIGS) pending.set(sig, { sig, message, kind: (e && e.kind) || 'js', route: o.getRoute ? o.getRoute() : '', count: 1, attempts: 0 });
    else dropped++;
    schedule();
    return sig;
  }

  async function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    if (inFlight || !pending.size) return false;
    inFlight = true;
    const batch = [...pending.values()];
    pending.clear();
    lastFlush = now();
    let ok = false;
    try {
      ok = await o.send({ version: o.version || '', errors: batch.map(b => ({ sig: b.sig, message: b.message, kind: b.kind, route: b.route, count: b.count })), dropped });
    } catch (e) { ok = false; }
    inFlight = false;
    if (ok) dropped = 0;
    else {
      // Nie dotarło żadną ścieżką: zachowujemy liczniki na kolejną próbę (maks. MAX_ATTEMPTS), potem porzucamy
      for (const b of batch) {
        b.attempts++;
        if (b.attempts >= MAX_ATTEMPTS) continue;
        const cur = pending.get(b.sig);
        if (cur) cur.count += b.count; else if (pending.size < MAX_SIGS) pending.set(b.sig, b);
      }
    }
    schedule();
    return ok;
  }

  /** Ostatnie zdarzenia zgrupowane po sygnaturze (do „informacji technicznych”). */
  function recent() {
    const m = new Map();
    for (const r of ring) { const c = m.get(r.sig); if (c) { c.count++; c.at = r.at; } else m.set(r.sig, { message: r.message, count: 1, at: r.at }); }
    return [...m.values()];
  }

  return { report, flush, recent, pendingCount: () => pending.size };
}

/** Okablowanie w przeglądarce: nasłuch błędów + wysyłka dwiema ścieżkami (A: Worker, B: Apps Script). */
export function initErrorReporting({ config, getToken, hasToken, getRoute }) {
  const r = createErrorReporter({
    version: config.version || '',
    flushDelayMs: config.errFlushMs,  // tylko testy (e2e)
    getRoute,
    send: async payload => {
      const res = await deliver({ config, getToken: (f, k) => (hasToken() ? getToken(f, k) : Promise.reject(new Error('niezalogowany'))), action: 'client:errors', params: payload });
      return !!res.ok;
    },
  });
  window.addEventListener('error', ev => {
    // Błędy ładowania zasobów (img/script) nie mają message — zgłaszamy tylko błędy skryptów
    if (ev.message) r.report({ message: ev.message, stack: ev.error && ev.error.stack, kind: 'js' });
  });
  window.addEventListener('unhandledrejection', ev => {
    const x = ev.reason;
    r.report({ message: (x && x.message) || String(x), stack: x && x.stack, kind: 'promise' });
  });
  return r;
}
