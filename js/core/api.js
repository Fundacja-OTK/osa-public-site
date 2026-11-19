// Klient API panelu OSA: POST { idToken, action, params } → { ok, data } | { ok:false, error, code }.
// Lista backendów z zapasowym: akcja idzie do pierwszego zdrowego; błąd sieci, HTTP 5xx albo odpowiedź,
// której nie da się sparsować, przełącza na następny (a niedziałający jest pomijany przez 5 min).
// Błędy aplikacyjne (ok:false z kodem, np. 401/403) NIE przełączają backendu.
// Bez zależności od przeglądarki — fetch, storage i zegar można wstrzyknąć (testy w node).

export const D1_UNAVAILABLE = 'd1_unavailable';
export const DOWN_KEY = 'osa-be-down';
export const DOWN_MS = 5 * 60 * 1000;

export const MSG_NOT_CONFIGURED = 'Strona nie jest skonfigurowana (brak config.js). Administrator: wdróż panel skryptem scripts/deploy-panel.ps1.';
export const MSG_NETWORK = 'Brak połączenia z serwerem raportu. Sprawdź internet i odśwież stronę.';
export const MSG_TIMEOUT_WRITE = 'Serwer nie odpowiedział na czas. Zmiana mogła się zapisać — odśwież widok i sprawdź, zanim spróbujesz ponownie.';
// Limit czasu jednej próby (ms): zawieszony backend nie blokuje strony — odczyty przechodzą na zapasowy
export const TIMEOUT_MS = { cloudflare: 20000, gas: 60000 };
// Odczyty (bezpieczne do powtórzenia na innym backendzie po przekroczeniu czasu); reszta to zapisy — bez powtórzenia
export const READ_ACTION = /^(init|whoami|report|orszaki|changes)$|:(list|get|meta|facets|queue|options|latest|history|init|orders|moves|invoices|addresses|prices|affiliate|extra|groups|dicts)$/;
// Zapisy, które wolno powtórzyć na innym backendzie po błędzie sieci: ustawiają wartość (PUT w Selly), więc powtórka daje ten sam stan.
// Reszta (np. dodanie pozycji, tworzenie przesyłki) nie jest powtarzana na drugim backendzie — każdy backend pamięta opId osobno.
export const WRITE_RETRY_SAFE = /^(orders:(setStatus|update|updateItem)|products:(update|setStock)|clients:update)$/;
// Wyłącznik obwodu: BREAKER_FAILS błędów w BREAKER_WINDOW_MS otwiera obwód backendu na BREAKER_OPEN_MS (potem próba „half-open”)
export const BREAKER_FAILS = 3, BREAKER_WINDOW_MS = 60 * 1000, BREAKER_OPEN_MS = 2 * 60 * 1000;
export const MSG_BAD_REPLY = 'Serwer raportu zwrócił nieoczekiwaną odpowiedź. Administrator: sprawdź wdrożenie backendu („Wykonuj jako: Ja”, „Kto ma dostęp: Każdy”).';

/** Lista backendów z konfiguracji: OSA_CONFIG.backends albo [{ url: backendUrl }]. */
export function backendList(config) {
  const c = config || {};
  const list = Array.isArray(c.backends) && c.backends.length ? c.backends : (c.backendUrl ? [{ url: c.backendUrl }] : []);
  return list.filter(b => b && b.url).map(b => ({ url: b.url, kind: b.kind || 'gas' }));
}

export function backendLabel(b) {
  return b.kind === 'cloudflare' ? 'cloudflare' : 'apps script';
}

/** Klucz idempotencji zapisu: ten sam przy ponowieniu na innym backendzie (backend zwraca zapamiętany wynik zamiast powtarzać zapis). */
export function newOpId() {
  try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* zapas niżej */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

/**
 * @param {{ config, getToken: (force:boolean)=>Promise<string>, fetchImpl?, storage?, now?: ()=>number, onFailure?: (f:{action,backend,message,code?})=>void }} o
 *   onFailure — raport nieudanego wywołania (sieć, HTTP 5xx, zła odpowiedź, ok:false z kodem ≥ 500 poza 501); błędy 4xx i 501 to nie awarie
 * @returns {{ api: (action, params?, retried?) => Promise<any>, apiInfo: () => object|null, onInfo: (cb) => void }}
 */
export function createApi(o) {
  const config = o.config || {};
  const fetchImpl = o.fetchImpl || ((...a) => fetch(...a));
  const now = o.now || Date.now;
  let storage = o.storage;
  if (!storage) { try { storage = sessionStorage; } catch (e) { storage = null; } }
  if (!storage) storage = memoryStorage();
  const backends = backendList(config);
  let info = null;
  const listeners = [];
  const breaker = new Map();       // url → { fails: [ms], openUntil }
  const unsupported = new Set();   // „url|akcja” — backend odpowiedział 501 (nie zna akcji); pamiętane do końca sesji

  const readDown = () => {
    try { return JSON.parse(storage.getItem(DOWN_KEY) || '{}') || {}; } catch (e) { return {}; }
  };
  const markDown = url => {
    const br = breaker.get(url) || { fails: [], openUntil: 0 }, t = now();
    br.fails = br.fails.filter(x => t - x < BREAKER_WINDOW_MS).concat(t);
    if (br.fails.length >= BREAKER_FAILS) { br.openUntil = t + BREAKER_OPEN_MS; br.fails = []; }
    breaker.set(url, br);
    const d = readDown(); d[url] = now() + DOWN_MS;
    try { storage.setItem(DOWN_KEY, JSON.stringify(d)); } catch (e) { /* bez zapisu */ }
  };
  const markUp = url => {
    breaker.delete(url);
    const d = readDown();
    if (!(url in d)) return;
    delete d[url];
    try { storage.setItem(DOWN_KEY, JSON.stringify(d)); } catch (e) { /* bez zapisu */ }
  };
  /** Zdrowe najpierw (w kolejności z konfiguracji), niezdrowe na końcu — jako ostatnia deska ratunku. */
  const candidates = () => {
    const d = readDown(), t = now();
    const up = [], down = [], open = [];
    for (const b of backends) ((breaker.get(b.url) || {}).openUntil > t ? open : d[b.url] > t ? down : up).push(b);
    // obwód otwarty = ostatnia deska ratunku; po BREAKER_OPEN_MS backend wraca do kolejki (próba half-open: jedno powodzenie zamyka obwód)
    return up.concat(down, open);
  };

  const failed = (b, action, message, code) => { try { if (o.onFailure) o.onFailure({ action, backend: backendLabel(b), message, code }); } catch (e) { /* raport nie psuje zapytania */ } };

  async function api(action, params, retried) {
    if (!backends.length || !config.clientId) throw new Error(MSG_NOT_CONFIGURED);
    const idToken = await o.getToken(!!retried);
    const isWrite = !READ_ACTION.test(action);
    if (isWrite && !(params && params.opId)) params = Object.assign({}, params, { opId: newOpId() });
    let lastErr = new Error(MSG_NETWORK), d1Down = false;
    for (const b of candidates()) {
      if (unsupported.has(b.url + '|' + action)) { lastErr = Object.assign(new Error('Akcja niedostępna na żadnym backendzie: ' + action), { code: 501 }); continue; }
      let res, body, timer = 0, timedOut = false;
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const limit = (o.timeouts || TIMEOUT_MS)[b.kind] || TIMEOUT_MS.gas;
      // Jeden zegar na całą próbę (połączenie + treść): abort dla fetch, a wyścig — gdy fetch nie reaguje na abort
      const deadline = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; if (ctl) ctl.abort(); reject(new Error('timeout')); }, limit); });
      deadline.catch(() => {});
      const within = p => Promise.race([p, deadline]);
      try {
        // Treść jako tekst — bez nagłówków własnych, więc bez zapytania CORS preflight
        res = await within(fetchImpl(b.url, { method: 'POST', body: JSON.stringify({ idToken, action, params }), signal: ctl ? ctl.signal : undefined }));
      } catch (e) {
        clearTimeout(timer);
        markDown(b.url);
        if (timedOut) {
          failed(b, action, 'przekroczony czas (' + Math.round(limit / 1000) + ' s)');
          if (!READ_ACTION.test(action)) throw Object.assign(new Error(MSG_TIMEOUT_WRITE), { code: 'timeout' });
          lastErr = new Error(MSG_NETWORK); continue;
        }
        failed(b, action, 'brak połączenia'); lastErr = new Error(MSG_NETWORK);
        if (isWrite && !WRITE_RETRY_SAFE.test(action)) throw lastErr;   // zapis bez gwarancji powtarzalności: nie próbujemy drugiego backendu
        continue;
      }
      if (res.status >= 500) { clearTimeout(timer); markDown(b.url); failed(b, action, 'HTTP ' + res.status, res.status); lastErr = new Error(MSG_BAD_REPLY); continue; }
      try { body = await within(res.json()); } catch (e) {
        clearTimeout(timer);
        if (timedOut) { markDown(b.url); failed(b, action, 'przekroczony czas (' + Math.round(limit / 1000) + ' s)'); if (!READ_ACTION.test(action)) throw Object.assign(new Error(MSG_TIMEOUT_WRITE), { code: 'timeout' }); lastErr = new Error(MSG_NETWORK); continue; }
        markDown(b.url); failed(b, action, 'odpowiedź nie jest JSON-em'); lastErr = new Error(MSG_BAD_REPLY); continue; }
      clearTimeout(timer);
      if (!body || typeof body !== 'object') { markDown(b.url); failed(b, action, 'nieoczekiwana odpowiedź'); lastErr = new Error(MSG_BAD_REPLY); continue; }
      markUp(b.url);
      info = { url: b.url, kind: b.kind, label: backendLabel(b), fallback: b.url !== backends[0].url, at: now(),
        // baza panelu (D1) niedostępna: inny backend odpowiada za główny albo odpowiedź idzie z Selly na żywo / z kopii
        degraded: d1Down || !!(body.ok && body.data && body.data.degraded) };
      listeners.forEach(f => { try { f(info); } catch (e) { /* słuchacz nie psuje zapytania */ } });
      if (!body.ok) {
        if (body.code === 401 && !retried) return api(action, params, true);
        // 501 = ten backend nie zna (jeszcze) tej akcji — moduły przenoszone na Cloudflare pojedynczo;
        // próbujemy następnego backendu, bez oznaczania tego jako niezdrowy
        if (body.code === 501) { unsupported.add(b.url + '|' + action); lastErr = Object.assign(new Error(body.error), { code: 501 }); continue; }
        // d1_unavailable = baza panelu chwilowo niedostępna (np. dzienny limit Cloudflare D1) — jak 501: próbujemy zapasowego backendu
        if (body.code === D1_UNAVAILABLE) { d1Down = true; info.degraded = true; listeners.forEach(f => { try { f(info); } catch (e) { /* ok */ } }); lastErr = Object.assign(new Error(body.error), { code: D1_UNAVAILABLE }); continue; }
        if (body.code >= 500 && body.code !== 503) failed(b, action, String(body.error || 'błąd serwera').slice(0, 150), body.code);
        const err = new Error(body.error);
        err.code = body.code;
        throw err;
      }
      return body.data;
    }
    throw lastErr;
  }

  return { api, apiInfo: () => info, onInfo: cb => { listeners.push(cb); },
    /** Stan wyłącznika obwodu i zapamiętane braki akcji (diagnostyka, testy). */
    state: () => ({ open: backends.filter(b => (breaker.get(b.url) || {}).openUntil > now()).map(b => b.url), unsupported: [...unsupported] }) };
}
