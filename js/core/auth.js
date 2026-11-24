// Logowanie do panelu OSA własnym kontem Selly (docs/auth.md). Ekran logowania (login + hasło, potem ewentualnie kod 2FA) jest w index.html
// (#cardSignIn); hasło idzie wyłącznie do serwera głównego (Worker), który przekazuje je do Selly i nigdzie go nie zapisuje.
// Po zalogowaniu: token sesji (256 bitów) w localStorage — wspólny dla kart (nowa karta otwiera panel od razu; zalogowanie / wylogowanie
// w jednej karcie dociera do pozostałych przez zdarzenie „storage”) + krótki token dla serwera zapasowego (Apps Script), odświeżany w tle.
import { $ } from './ui.js?v=786f98f';

const ENV = () => window.OSA_CONFIG || {};
export const SESSION_KEY = 'osa-sess';
const LEGACY_KEYS = ['osa-idt'];   // dawny token Google — usuwany przy starcie
const GAS_MIN_LEFT_MS = 5 * 60 * 1000;
const AUTH_TIMEOUT_MS = 45000;      // logowanie sprawdza uprawnienia w Selly (kilka stron) — może potrwać kilka sekund

let sess = null, waiters = [], pending = null, refreshing = null;

const store = () => { try { return localStorage; } catch (e) { try { return sessionStorage; } catch (e2) { return null; } } };
function read(raw) {
  try { const s = JSON.parse(raw || 'null'); return s && typeof s.t === 'string' && s.t.length >= 40 ? s : null; } catch (e) { return null; }
}
function save(s) {
  sess = s;
  try { const st = store(); if (st) { if (s) st.setItem(SESSION_KEY, JSON.stringify(s)); else st.removeItem(SESSION_KEY); } } catch (e) { /* bez zapisu */ }
}
try {
  const st = store();
  if (st) { sess = read(st.getItem(SESSION_KEY)); for (const k of LEGACY_KEYS) st.removeItem(k); }
} catch (e) { /* bez magazynu — logowanie przy każdym otwarciu */ }

if (typeof window !== 'undefined') window.addEventListener('storage', ev => {
  if (ev.key !== SESSION_KEY) return;
  const s = read(ev.newValue);
  if (s) { sess = s; hideLogin(); flush(); }           // inna karta się zalogowała
  else if (sess) { sess = null; location.reload(); }   // inna karta się wylogowała
});

function flush() { const w = waiters; waiters = []; w.forEach(f => f(sess.t)); }

/** Serwer główny (Cloudflare Worker) — tylko on loguje do Selly. */
export function authUrl(config = ENV()) {
  const list = Array.isArray(config.backends) && config.backends.length ? config.backends : [];
  const b = list.find(x => x && x.url && x.kind === 'cloudflare');
  return b ? b.url : '';
}

/** POST do Workera (bez sesji: logowanie; z sesją: Authorization). → data albo wyjątek { message, code }. */
export async function authCall(action, params, token, { fetchImpl = (...a) => fetch(...a), config = ENV(), timeoutMs = AUTH_TIMEOUT_MS } = {}) {
  const url = authUrl(config);
  if (!url) throw Object.assign(new Error('Logowanie wymaga serwera głównego panelu, którego nie ma w konfiguracji strony.'), { code: 'config' });
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'text/plain;charset=UTF-8' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify({ action, params: params || {} }), signal: ctl ? ctl.signal : undefined });
  } catch (e) {
    throw Object.assign(new Error('Serwer główny panelu nie odpowiada, więc nie można się teraz zalogować (serwer zapasowy nie obsługuje logowania). Sprawdź internet i spróbuj za kilka minut.'), { code: 'network' });
  } finally { clearTimeout(timer); }
  let body = null;
  try { body = await res.json(); } catch (e) { /* niżej */ }
  if (!body || typeof body !== 'object' || res.status >= 500) throw Object.assign(new Error('Serwer główny panelu chwilowo nie działa — logowanie jest niemożliwe (serwer zapasowy go nie obsługuje). Spróbuj za kilka minut.'), { code: 'network' });
  if (!body.ok) throw Object.assign(new Error(body.code === 'd1_unavailable' ? 'Baza serwera głównego chwilowo nie działa — logowanie jest niemożliwe. Spróbuj za kilka minut.' : (body.error || 'Nie udało się zalogować.')), { code: body.code });
  return body.data;
}

/** Ważność tokenu zapasowego wg zegara przeglądarki (serwer podaje swój czas — różnica zegarów nie przeszkadza). */
const gasExp = d => (d.gasExpMs && d.serverNow ? Date.now() + (d.gasExpMs - d.serverNow) : 0);

/**
 * Dokończenie sprawdzania uprawnień w Selly: serwer sprawdza je porcjami (limit zapytań na wywołanie), więc gdy permsComplete:false,
 * wołamy auth:perms, aż będzie komplet. → dane startowe z uprawnieniami (z tokenem sesji). Błąd (np. brak dostępu) = wyjątek.
 * onStep — informacja dla interfejsu („Sprawdzam uprawnienia w Selly…”).
 */
export async function completePerms(data, onStep) {
  let d = data;
  const token = data.session || (sess && sess.t);
  for (let i = 0; i < 12 && d.permsComplete === false; i++) {
    if (onStep) onStep(i);
    const n = await authCall('auth:perms', {}, token);
    d = n.permsComplete === false ? { ...d } : { ...n, session: data.session };
  }
  if (d.permsComplete === false) throw Object.assign(new Error('Nie udało się sprawdzić uprawnień w Selly — spróbuj zalogować się ponownie.'), { code: 'perms' });
  return d;
}

/** Zapamiętanie sesji po zalogowaniu (data = odpowiedź auth:login). */
export function adoptLogin(data) {
  save({ t: data.session, login: data.login || '', g: data.gasToken || '', gExp: gasExp(data) });
  hideLogin();
  flush();
}
/** Świeży token zapasowy z whoami / auth:refresh. */
export function adoptBoot(data) {
  if (!sess || !data || !data.gasToken) return;
  save({ ...sess, g: data.gasToken, gExp: gasExp(data) });
}

export const sessionLogin = () => (sess ? sess.login : '');
/** Czy jesteśmy zalogowani (bez pokazywania ekranu logowania) — dla raportów w tle. */
export const hasToken = () => !!sess;
/** Login bieżącej sesji (nazwa z czasów logowania Google — używana przez zapamiętany start). */
export const tokenEmail = sessionLogin;

function refreshGas() {
  if (!refreshing) refreshing = authCall('auth:refresh', {}, sess.t, { timeoutMs: 15000 }).then(adoptBoot).catch(() => {}).finally(() => { refreshing = null; });
  return refreshing;
}

/**
 * Token dla backendu: kind 'cloudflare' (domyślnie) → token sesji; 'gas' → token zapasowy (odświeżany przez Worker, gdy kończy się ważność;
 * gdy Worker nie działa — zostaje dotychczasowy, ważny do 2 h). force = poprzedni token odrzucony (401): sesja się skończyła →
 * ekran logowania; obietnica czeka na ponowne zalogowanie (także w innej karcie).
 */
export async function freshToken(force, kind) {
  if (kind === 'gas') {
    if (!sess) await waitLogin();
    if (force || !sess.g || sess.gExp - Date.now() < GAS_MIN_LEFT_MS) await refreshGas();
    return (sess && sess.g) || '';
  }
  if (sess && !force) return sess.t;
  if (sess && force) save(null);
  return waitLogin(force ? 'Sesja wygasła — zaloguj się ponownie.' : '');
}

function waitLogin(message) {
  return new Promise(resolve => { waiters.push(resolve); showLogin(message); });
}

/* ———————————— ekran logowania ———————————— */

let wired = false;
function busy(form, on, label) {
  for (const x of form.querySelectorAll('input, button')) x.disabled = on;
  const b = form.querySelector('button[type=submit]');
  if (b) b.textContent = on && label ? label : b.dataset.label;
}
function showError(id, msg) { const e = $(id); if (!e) return; e.textContent = msg || ''; e.hidden = !msg; }

function hideLogin() {
  const c = $('cardSignIn');
  if (!c || c.hidden) return;
  c.hidden = true;
  const m = $('modules'); if (m) m.hidden = false;   // ekran logowania je ukrył; start panelu (shell.begin) pokaże resztę
}

export function showLogin(message) {
  const card = $('cardSignIn');
  if (!card) return;
  for (const id of ['cardStart', 'modules', 'pageHead']) { const x = $(id); if (x) x.hidden = true; }
  card.hidden = false;
  wire();
  showStep('login');
  showError('loginErr', message || '');
  const u = $('loginUser');
  if (u && !u.value) { try { u.value = localStorage.getItem('osa-last-login') || ''; } catch (e) { /* ok */ } }
  setTimeout(() => { const f = u && u.value ? $('loginPass') : u; if (f) f.focus(); }, 0);
}

function showStep(step) {
  $('loginForm').hidden = step !== 'login';
  $('codeForm').hidden = step !== 'code';
}

function wire() {
  if (wired) return;
  wired = true;
  const form = $('loginForm'), codeForm = $('codeForm');
  for (const b of [form, codeForm].map(f => f.querySelector('button[type=submit]'))) b.dataset.label = b.textContent;
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const login = $('loginUser').value.trim(), pass = $('loginPass').value;
    if (!login || !pass) { showError('loginErr', 'Podaj login i hasło do panelu Selly.'); return; }
    showError('loginErr', '');
    busy(form, true, 'Loguję do Selly…');
    let r = null;
    try {
      r = await authCall('auth:login', { login, password: pass });
      try { localStorage.setItem('osa-last-login', login); } catch (e) { /* ok */ }
      if (!r.need2fa) r = await completePerms(r, () => { $('loginBtn').textContent = 'Sprawdzam uprawnienia w Selly…'; });
    } catch (e) {
      showError('loginErr', e.message);
    } finally {
      $('loginPass').value = '';
      busy(form, false);
    }
    if (!r) { $('loginPass').focus(); return; }
    if (r.need2fa) { pending = r.pending; startCode(r); return; }
    adoptLogin(r);
  });
  codeForm.addEventListener('submit', async ev => {
    ev.preventDefault();
    const code = $('loginCode').value.replace(/\s+/g, '');
    if (!/^[0-9A-Za-z-]{4,12}$/.test(code)) { showError('codeErr', 'Wpisz kod z aplikacji lub wiadomości (zwykle 6 cyfr).'); return; }
    showError('codeErr', '');
    busy(codeForm, true, 'Sprawdzam kod…');
    let r = null, err = null;
    try {
      r = await authCall('auth:2fa', { pending, code });
      if (!r.need2fa) r = await completePerms(r, () => { $('codeBtn').textContent = 'Sprawdzam uprawnienia w Selly…'; });
    } catch (e) { err = e; }
    $('loginCode').value = '';
    busy(codeForm, false);
    if (err) { pending = null; showStep('login'); showError('loginErr', err.message); $('loginPass').focus(); return; }
    if (r.need2fa) { pending = r.pending; showError('codeErr', r.error || 'Nieprawidłowy kod — spróbuj ponownie.'); $('loginCode').focus(); return; }
    pending = null;
    adoptLogin(r);
  });
  $('codeBack').addEventListener('click', () => { pending = null; showStep('login'); showError('loginErr', ''); $('loginPass').focus(); });
}

function startCode(r) {
  showStep('code');
  showError('codeErr', '');
  const min = Math.max(1, Math.round((r.ttlSec || 300) / 60));
  $('codeHint').textContent = r.codeHint === 'app'
    ? 'Selly prosi o kod z aplikacji uwierzytelniającej (logowanie dwuetapowe, 2FA). Wpisz aktualny kod — masz na to ' + min + ' min.'
    : 'Selly prosi o dodatkowy kod weryfikacyjny (logowanie dwuetapowe). Wpisz go poniżej — masz na to ' + min + ' min.';
  setTimeout(() => $('loginCode').focus(), 0);
}

/** Wylogowanie: koniec sesji w panelu (i w Selly — po stronie serwera), na wszystkich kartach tej przeglądarki. */
export async function signOut() {
  const t = sess && sess.t;
  save(null);
  // dane startowe i „Ostatnie” (nazwy klientów, numery zamówień) nie zostają w przeglądarce po wylogowaniu
  try { for (const k of ['osa-recent', 'osa-recent-who', 'osa-boot']) localStorage.removeItem(k); } catch (e) { /* brak magazynu */ }
  // pamięć odczytów (core/cache.js, klucze „osa-c:…”) — bez importu cache.js (cykl auth ↔ client)
  try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k && k.startsWith('osa-c:')) sessionStorage.removeItem(k); } } catch (e) { /* bez magazynu */ }
  if (t) { try { await authCall('auth:logout', {}, t, { timeoutMs: 4000 }); } catch (e) { /* sesja i tak wygaśnie */ } }
  location.reload();
}
