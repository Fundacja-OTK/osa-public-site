// Dostarczanie zgłoszeń i raportów błędów dwiema niezależnymi ścieżkami:
//   A = Worker (Cloudflare: D1 + mail przez Apps Script), B = Apps Script bezpośrednio (mail + arkusz „Zgłoszenia”).
// B jest używana, gdy A zawiedzie: błąd sieci, timeout, HTTP 5xx, odpowiedź nie-JSON, ok:false z kodem ≥ 500, 501 albo 403.
// Błędy „merytoryczne” (4xx: zła treść, limit) NIE przełączają ścieżki — na B byłyby takie same.
// Bez zależności od przeglądarki — fetch, token i zegar wstrzykiwane (testy w node).

import { backendList, requestFor } from './api.js?v=79bd162';

export const TIMEOUT_MS = 10000;

// 403: uprawnienia Workera i Apps Script mogą się chwilowo różnić (odświeżenie uprawnień) — druga ścieżka ma własną ocenę
const fallbackWorthy = e => e.network || e.code >= 500 || e.code === 501 || e.code === 403;

async function post(b, action, params, token, { fetchImpl, timeoutMs }) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchImpl(b.url, requestFor(b, token, action, params, ctl ? ctl.signal : undefined));
  } catch (e) {
    throw Object.assign(new Error(e && e.name === 'AbortError' ? 'przekroczono czas oczekiwania' : 'brak połączenia'), { network: true });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status >= 500) throw Object.assign(new Error('HTTP ' + res.status), { code: res.status });
  let body = null;
  try { body = await res.json(); } catch (e) { /* poniżej */ }
  if (!body || typeof body !== 'object') throw Object.assign(new Error('nieoczekiwana odpowiedź serwera'), { code: 502 });
  if (!body.ok) throw Object.assign(new Error(body.error || 'błąd serwera'), { code: body.code || 500 });
  return body.data;
}

/**
 * @param {{ config, getToken: (force:boolean, kind:'cloudflare'|'gas')=>Promise<string>, action: string, params: object, fetchImpl?, timeoutMs?, only?: 'A'|'B' }} o
 * @returns {Promise<{ ok: true, path: 'A'|'B', via: string, data: any, errorA?: string } | { ok: false, errors: { A?: string, B?: string }, fatal?: string }>}
 */
export async function deliver(o) {
  const fetchImpl = o.fetchImpl || ((...a) => fetch(...a));
  const opts = { fetchImpl, timeoutMs: o.timeoutMs || TIMEOUT_MS };
  const all = backendList(o.config);
  const paths = [['A', all.find(b => b.kind === 'cloudflare')], ['B', all.find(b => b.kind === 'gas')]].filter(([k, b]) => b && (!o.only || o.only === k));
  const errors = {};
  if (!paths.length) return { ok: false, errors, fatal: 'brak skonfigurowanych serwerów' };
  for (const [key, b] of paths) {
    let token;
    try { token = await o.getToken(false, b.kind); } catch (e) { return { ok: false, errors, fatal: 'nie jesteś zalogowany' }; }
    try {
      let data;
      try { data = await post(b, o.action, o.params, token, opts); }
      catch (e) {
        if (e.code !== 401) throw e;
        token = await o.getToken(true, b.kind);  // token wygasł — jedno ponowienie z nowym
        data = await post(b, o.action, o.params, token, opts);
      }
      return { ok: true, path: key, via: b.kind === 'cloudflare' ? 'cloudflare' : 'apps script', data, errorA: errors.A };
    } catch (e) {
      errors[key] = e.message;
      if (!fallbackWorthy(e)) return { ok: false, errors, fatal: e.message, code: e.code };
    }
  }
  return { ok: false, errors };
}
