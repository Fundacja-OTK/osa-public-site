// Logowanie Google Identity Services. Token tożsamości (ważny ~1 h) trzymany w localStorage — wspólny dla wszystkich kart
// (nowa karta otwiera panel od razu, bez ponownego logowania; odświeżony token trafia do pozostałych kart przez zdarzenie „storage”);
// po wygaśnięciu GIS wydaje nowy bez klikania (auto_select), a gdy nie może — pokazujemy przycisk „Zaloguj się”.
import { $ } from './ui.js?v=be6c33d';

const ENV = () => window.OSA_CONFIG || {};
export const TOKEN_KEY = 'osa-idt';
let token = null, tokenExp = 0, waiters = [], gisInit = null, signInTimer = 0;

function jwtPayload(jwt) {
  const b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(atob(b).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
}

const tokenStore = () => { try { return localStorage; } catch (e) { try { return sessionStorage; } catch (e2) { return null; } } };
function adopt(raw) {
  try {
    const saved = JSON.parse(raw || 'null');
    if (saved && saved.exp - Date.now() > 5 * 60 * 1000) { token = saved.t; tokenExp = saved.exp; return true; }
  } catch (e) { /* uszkodzony wpis — zaloguje przez GIS */ }
  return false;
}
try {
  const st = tokenStore();
  if (!(st && adopt(st.getItem(TOKEN_KEY)))) adopt(sessionStorage.getItem(TOKEN_KEY));   // dawny zapis tylko dla karty
} catch (e) { /* bez magazynu — zaloguje przez GIS */ }
// Inna karta zalogowała się albo odświeżyła token — przejmij go (także dla czekających zapytań)
if (typeof window !== 'undefined') window.addEventListener('storage', ev => {
  if (ev.key !== TOKEN_KEY || !adopt(ev.newValue)) return;
  clearTimeout(signInTimer);
  const w = waiters; waiters = [];
  w.forEach(f => f(token));
});

function gis() {
  return gisInit || (gisInit = new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function wait() {
      if (window.google && google.accounts && google.accounts.id) {
        google.accounts.id.initialize({ client_id: ENV().clientId, callback: onCredential, auto_select: true,
          cancel_on_tap_outside: false, use_fedcm_for_prompt: true, itp_support: true });
        resolve();
      } else if (Date.now() - t0 > 15000) {
        gisInit = null;
        reject(new Error('Nie udało się wczytać logowania Google. Sprawdź połączenie (albo blokery skryptów) i odśwież stronę.'));
      } else setTimeout(wait, 100);
    })();
  }));
}

function onCredential(resp) {
  try {
    const p = jwtPayload(resp.credential);
    token = resp.credential; tokenExp = p.exp * 1000;
    try { const st = tokenStore(); if (st) st.setItem(TOKEN_KEY, JSON.stringify({ t: token, exp: tokenExp })); } catch (e) { /* bez zapisu */ }
  } catch (e) { return; }
  clearTimeout(signInTimer);
  $('cardSignIn').hidden = true;
  const w = waiters; waiters = [];
  w.forEach(f => f(token));
}

function showSignIn() {
  $('cardStart').hidden = true;
  $('cardSignIn').hidden = false;
  google.accounts.id.renderButton($('signInBtn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'pl' });
}

/** E-mail z bieżącego tokenu (małymi literami) albo '' — do sprawdzenia, czy zapamiętany start należy do tego konta. */
export function tokenEmail() {
  try { return token ? String(jwtPayload(token).email || '').toLowerCase() : ''; } catch (e) { return ''; }
}

/** Czy mamy ważny token (bez wywoływania logowania) — dla raportów w tle. */
export const hasToken = () => !!token && tokenExp - Date.now() > 60 * 1000;

export function freshToken(force) {
  if (!force && token && tokenExp - Date.now() > 5 * 60 * 1000) return Promise.resolve(token);
  token = null;
  return gis().then(() => new Promise(resolve => {
    waiters.push(resolve);
    if (waiters.length > 1) return;  // logowanie już trwa
    google.accounts.id.prompt();
    // Gdy GIS nie zaloguje sam (pierwsza wizyta, kilka kont, zablokowane okienko) — przycisk
    clearTimeout(signInTimer);
    signInTimer = setTimeout(() => { if (!token) showSignIn(); }, 1500);
  }));
}

export function signOut() {
  try { const st = tokenStore(); if (st) st.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nic */ }
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  location.reload();
}
