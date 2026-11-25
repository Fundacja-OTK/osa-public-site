// „Jest nowa wersja panelu”: co 10 min pobiera config.js (generowany przy każdym wdrożeniu, zawiera version)
// i porównuje z wersją załadowaną w tej karcie. Pasek jest dyskretny; „Odśwież” respektuje strażnika wyjścia routera
// (niezapisane zmiany w karcie → pytanie o potwierdzenie), żeby nie zgubić edycji.
import { el } from './ui.js?v=0e25d7c';

export const POLL_MS = 10 * 60 * 1000;

/** Wyciąga version z treści config.js (window.OSA_CONFIG = {…}); '' gdy się nie da. */
export function parseVersion(js) {
  const m = /"version"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(js || ''));
  if (!m) return '';
  try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return m[1]; }
}

/**
 * @param {{ current: string, fetchImpl?: Function, url?: string, onNew: (version:string)=>void, setTimer?: Function }} o
 * @returns {{ check: ()=>Promise<boolean> }}
 */
export function watchVersion(o) {
  const fetchImpl = o.fetchImpl || ((...a) => fetch(...a));
  const url = o.url || 'config.js';
  let found = false;
  async function check() {
    if (found || !o.current) return false;
    try {
      const res = await fetchImpl(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return false;
      const v = parseVersion(await res.text());
      if (v && v !== o.current) { found = true; o.onNew(v); return true; }
    } catch (e) { /* offline / chwilowy błąd — następna próba za 10 min */ }
    return false;
  }
  if (!o.noTimer) (o.setTimer || ((f, ms) => setInterval(f, ms)))(check, POLL_MS);
  return { check };
}

/** Pasek na dole ekranu; reload przez callback strażnika (zwraca true, gdy można odświeżyć). */
export function showNewVersion({ canLeave, reload }) {
  if (document.getElementById('newVer')) return;
  const bar = el('div', { id: 'newVer', class: 'newver', role: 'status' },
    el('span', null, 'Jest nowa wersja panelu.'),
    el('button', { type: 'button', class: 'primary small', id: 'newVerReload', title: 'Wczytuje nową wersję. Jeśli masz niezapisane zmiany, najpierw zapytamy.', onclick: () => { if (canLeave()) reload(); } }, 'Odśwież'),
    el('button', { type: 'button', class: 'secondary small', id: 'newVerLater', title: 'Ukrywa ten komunikat do czasu odświeżenia strony', onclick: () => bar.remove() }, 'Później'));
  document.body.append(bar);
}
