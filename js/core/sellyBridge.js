// Natywne ekrany Selly (etap 2): żądania do rozszerzenia OSA przez most (extension/content/panelBridge.js).
// {osa:'sel-req', id, req} → {osa:'sel-res', id, res}. Dane Selly zostają w tej przeglądarce (Selly → rozszerzenie → ta strona).
import { isTrustedMessage } from './extBridge.js?v=58f006c';

let seq = 0;
const TIMEOUT_MS = 30000;

/** Czy rozszerzenie obsługuje natywne ekrany (nowsze wersje ustawiają data-osa-native)? */
export function hasNative() { return document.documentElement.getAttribute('data-osa-native') === '1'; }

/** Odpowiedź tylko z tego okna/pochodzenia, z pasującym id. Czysta funkcja — testowana jednostkowo. */
export function matchesResponse(ev, id, win = window) {
  return isTrustedMessage(ev, win) && !!ev.data && ev.data.osa === 'sel-res' && ev.data.id === id;
}

/** Wysyła żądanie; zwraca { ok, data } albo { ok:false, code, error } (nigdy nie rzuca). */
export function sellyCall(req, timeoutMs = TIMEOUT_MS) {
  return new Promise(resolve => {
    const id = 's' + (++seq) + '-' + Math.random().toString(36).slice(2, 10);
    const done = r => { clearTimeout(t); window.removeEventListener('message', on); resolve(r); };
    const on = ev => { if (matchesResponse(ev, id)) done(ev.data.res || { ok: false, code: 'ext', error: 'Pusta odpowiedź rozszerzenia' }); };
    const t = setTimeout(() => done({ ok: false, code: 'timeout', error: 'Rozszerzenie OSA nie odpowiada — przeładuj rozszerzenie i kartę panelu' }), timeoutMs);
    window.addEventListener('message', on);
    window.postMessage({ osa: 'sel-req', id, req }, window.location.origin);
  });
}
