// Powłoka aplikacji: górny pasek (wyszukiwarki, Selly ↗, konto i motyw), boczne menu sekcji z wysuwanymi listami
// (pełne menu panelu Selly — core/nav.js), „Ostatnie”, szybkie wyszukiwanie (Ctrl+K), okruszki i tytuł strony, logowanie/start, stopka.
import { $, el, store, pageError, refreshWriteGates } from './ui.js?v=abc9fbd';
import { api, ctx, ENV, apiInfo, onApiInfo, canWriteSection, READONLY_TIP } from './client.js?v=abc9fbd';
import { signOut, freshToken, hasToken, sessionLogin, adoptBoot, completePerms } from './auth.js?v=abc9fbd';
import { canSee } from '../lib/panelAuth.js?v=abc9fbd';
import { register, getModule, go, startRouter, parseHash, leaveMessage } from './router.js?v=abc9fbd';
import { initErrorReporting } from './errors.js?v=abc9fbd';
import { initSellyExits } from './sellyExits.js?v=abc9fbd';
import { setReporter } from './errorHook.js?v=abc9fbd';
import { initFeedback } from './feedback.js?v=abc9fbd';
import { watchVersion, showNewVersion } from './update.js?v=abc9fbd';
import { createPlaceholder, SELLY_ADMIN } from '../modules/_placeholder.js?v=abc9fbd';
import { SECTIONS, ITEMS, itemById, icon } from './nav.js?v=abc9fbd';
import { initPalette, openPalette } from './palette.js?v=abc9fbd';
import { installShortcuts, shortcuts } from './shortcuts.js?v=abc9fbd';
import { loadRecents, noteVisit, hashOf, TYPES, RECENT_MAX, RECENT_DAYS } from './recents.js?v=abc9fbd';

const ROUTE_KEY = 'osa-route';
const RECORD_MODS = new Set(['zamowienia', 'klienci', 'produkty']);   // karta rekordu zapisuje się sama (z nazwą)
const BOOT_KEY = 'osa-boot';   // ostatni start: login Selly, rola, sekcje, adres Selly i rok — do natychmiastowego otwarcia panelu
const COLLAPSE_KEY = 'osa-sb-collapsed';

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_ADMIN;
export const sellyHref = a => adminUrl() + (a ? '?a=' + a : '');

/** Moduły ładowane przy pierwszym wejściu (nowe ekrany; brak pliku → strona „w planie”). */
const LAZY = {
  pulpit: () => import('../modules/pulpit.js?v=abc9fbd'),
  speedmail: () => import('../modules/speedmail.js?v=abc9fbd'),
  przesylki: () => import('../modules/przesylki.js?v=abc9fbd'),
  dropshipping: () => import('../modules/dropshipping.js?v=abc9fbd'),
  wplaty: () => import('../modules/wplaty.js?v=abc9fbd'),
  'zgloszenia-osa': () => import('../modules/zgloszeniaOsa.js?v=abc9fbd'),
  'selly-zmiany': () => import('../modules/sellyZmiany.js?v=abc9fbd'),
  raporty: () => import('../modules/raporty.js?v=abc9fbd'),
  // konfiguracja sklepu — natywne ekrany „strona ustawień” (modules/konfSklepu.js)
  konf: () => import('../modules/konfSklepu.js?v=abc9fbd').then(m => ({ default: m.konf })), 'panel-konf': () => import('../modules/konfSklepu.js?v=abc9fbd').then(m => ({ default: m.panelKonf })),
  'wyglad-konf': () => import('../modules/konfSklepu.js?v=abc9fbd').then(m => ({ default: m.wygladKonf })), znaki: () => import('../modules/konfSklepu.js?v=abc9fbd').then(m => ({ default: m.znaki })),
  jezyki: () => import('../modules/konfSklepu.js?v=abc9fbd').then(m => ({ default: m.jezyki })), dostepnosc: () => import('../modules/konfSklepu.js?v=abc9fbd').then(m => ({ default: m.dostepnosc })),
  // marketplace, integracje, treści, konfiguracja zamówień — natywne ekrany „strona ustawień” (modules/konfSklepu.js)
  ...Object.fromEntries(['allegro', 'allegro-aukcje', 'empik', 'allegro-wysylka', 'allegro-operatorzy', 'allegro-szablony', 'ceneo-opinie', 'ceneo-mapa', 'int-porownywarki', 'int-przesylki', 'int-fk', 'int-dodatkowe', 'ai', 'slajdy', 'ksztalty', 'dostawy-konf', 'statusy-konf']
    .map(id => [id, () => import('../modules/konfSklepu.js?v=abc9fbd').then(m => ({ default: m.extra[id] }))])),
  reklamacje: () => import('../modules/reklamacje.js?v=abc9fbd'), oferty: () => import('../modules/oferty.js?v=abc9fbd'),
  // === administracja i system (podgląd): ekrany tylko do odczytu, jeden moduł (modules/adminNative.js) ===
  ...Object.fromEntries(['allegro-aukcje-lista', 'allegro-zdarzenia', 'admini', 'grupy', 'uprawnienia', 'odo', 'zgloszenia', 'platnosci', 'zlecenia', 'uslugi', 'uslugi-partnerow', 'rozszerzenia', 'wizyty', 'pliki', 'automatyzacje', 'ceny-auto', 'integrator', 'api', 'frontapi', 'furgonetka', 'suus'].map(id => [id, () => import('../modules/adminNative.js?v=abc9fbd').then(m => ({ default: m.views[id] }))])),
  // treści (CMS): natywne ekrany z jednego pliku
  ...Object.fromEntries(['cms', 'aktualnosci', 'menu-ed', 'bloki', 'formularze', 'przekierowania', 'gwarancje', 'opisy'].map(id => [id, () => import('../modules/tresci.js?v=abc9fbd').then(m => ({ default: m.screens[id] }))])),
  // === sprzedaż (kupony, koszyki) ===
  kupony: () => import('../modules/kupony.js?v=abc9fbd'), koszyki: () => import('../modules/koszyki.js?v=abc9fbd'),
  'zmiana-cen': () => import('../modules/masowe.js?v=abc9fbd'), 'zmiana-danych': () => import('../modules/masowe.js?v=abc9fbd').then(m => ({ default: m.modes.dane })), 'zmiana-kategorii': () => import('../modules/masowe.js?v=abc9fbd').then(m => ({ default: m.modes.kat })),
};

// ─── Błędy strony ───────────────────────────────────────────────────────────

function setupErrors() {
  window.addEventListener('error', ev => pageError(ev.message + (ev.lineno ? ' [linia ' + ev.lineno + ']' : '')));
  window.addEventListener('unhandledrejection', ev => pageError(ev.reason && (ev.reason.message || ev.reason)));
}

// ─── Motyw: system (domyślnie) / jasny / ciemny ─────────────────────────────

function setupTheme() {
  let cur = 'system';
  try { const t = JSON.parse(localStorage.getItem('otk-theme') || 'null'); if (t === 'light' || t === 'dark') cur = t; } catch (e) {}
  const apply = t => {
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    for (const b of $('themeSw').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.themeOpt === t));
  };
  apply(cur);
  for (const b of $('themeSw').querySelectorAll('button')) b.addEventListener('click', () => {
    apply(b.dataset.themeOpt);
    try { localStorage.setItem('otk-theme', JSON.stringify(b.dataset.themeOpt === 'system' ? null : b.dataset.themeOpt)); } catch (e) {}
  });
}

// ─── Menu użytkownika i wyszukiwarki w górnym pasku ─────────────────────────

function popup(btn, menu) {
  const set = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', e => { e.stopPropagation(); set(menu.hidden); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
}

function setupTopbar(data) {
  $('tbUser').hidden = false;
  $('tbFeedback').hidden = false;
  const login = data.login || data.email || '';
  $('who').textContent = login ? 'Zalogowano do Selly jako: ' + login : '';
  $('who').title = 'Panel pokazuje sekcje, do których to konto ma dostęp w Selly (' + (data.perms || []).length + '). Uprawnienia zmienia administrator sklepu w Selly; po zmianie wyloguj się i zaloguj ponownie.';
  $('avatar').textContent = (login || '?').slice(0, 1).toUpperCase();
  popup($('userBtn'), $('userMenu'));
  $('tbSearch').hidden = false;
}

// ─── Boczne menu: sekcje + wysuwane listy pozycji ───────────────────────────

/** Pozycja widoczna: sekcje OSA wg uprawnień z Selly (shared/panelAuth.js), administracyjne tylko dla administratora; linki do Selly zawsze. */
const visible = i => i !== '-' && canSee({ perms: (ctx.boot && ctx.boot.perms) || [], admin: !!(ctx.boot && ctx.boot.isAdmin) }, i.id);

const KIND_TIP = {
  soon: 'W planie w panelu OSA — na razie strona z linkiem do panelu Selly',
  selly: 'Tylko w panelu Selly (brak API) — otwiera Selly w nowej karcie',
};

/** Link pozycji menu: ekran OSA → #/id; tylko Selly → Selly w nowej karcie; w planie → #/id (strona z linkiem do Selly). */
function itemLink(i) {
  if (i.kind === 'selly') {
    return el('a', { href: sellyHref(i.a), target: '_blank', rel: 'noopener', class: 'fly-item ext', 'data-nav': i.id, title: i.tip || KIND_TIP.selly },
      el('span', { class: 'fly-text' }, i.title), el('span', { class: 'fly-badge', 'aria-hidden': 'true' }, '↗'));
  }
  return el('a', { href: '#/' + i.id, class: 'fly-item' + (i.kind === 'soon' ? ' soon' : ''), 'data-nav': i.id, title: i.tip || KIND_TIP[i.kind] || i.title, 'aria-current': 'false' },
    el('span', { class: 'fly-text' }, i.title), i.kind === 'soon' ? el('span', { class: 'fly-badge soon', 'aria-hidden': 'true' }, 'wkrótce') : null);
}

let isAdminNav = false;

const RC_OPEN_KEY = 'osa-rc-open';

function renderNav(isAdmin) {
  isAdminNav = isAdmin;
  const nav = $('modNav');

  const home = el('div', { class: 'sb-group sb-home' }, el('a', { href: '#/pulpit', class: 'sb-label sb-home-link', 'data-nav': 'pulpit', title: 'Pulpit — sprzedaż, zamówienia do zrobienia i najnowsze zmiany', 'aria-current': 'false' }, icon('home'), el('span', { class: 'sb-text' }, 'Pulpit')));
  const search = el('button', { type: 'button', class: 'sb-search', id: 'sbSearch', 'aria-haspopup': 'dialog', title: 'Szukaj ekranów, zamówień, klientów i produktów (Ctrl+K)', onclick: () => openPalette() },
    icon('search'), el('span', { class: 'sb-text sb-search-text' }, 'Szukaj…'), el('kbd', { class: 'sb-text sb-kbd' }, 'Ctrl K'));
  // „Ostatnie” — zwijane/rozwijane W MIEJSCU (jak w Cloudflare): nagłówek ze strzałką, lista pod nim; stan pamiętany.
  // Bez ręcznego czyszczenia: max RECENT_MAX pozycji z ostatnich RECENT_DAYS dni.
  const rcOpen = store(RC_OPEN_KEY) !== 0;
  const rcList = el('div', { class: 'rc-list', id: 'rcList', hidden: !rcOpen });
  const rcBtn = el('button', { type: 'button', class: 'sb-sec rc-toggle', id: 'sbRecentBtn', 'aria-expanded': String(rcOpen), 'aria-controls': 'rcList',
    title: 'Ostatnio otwarte ekrany i rekordy (zamówienia, klienci, produkty): do ' + RECENT_MAX + ' pozycji z ostatnich ' + RECENT_DAYS + ' dni, tylko w tej przeglądarce. Kliknij, aby zwinąć lub rozwinąć.',
    onclick: e => { e.stopPropagation(); const open = rcList.hidden; rcList.hidden = !open; rcBtn.setAttribute('aria-expanded', String(open)); store(RC_OPEN_KEY, open ? 1 : 0); } },
    icon('clock'), el('span', { class: 'sb-text' }, 'Ostatnie'), el('span', { class: 'sb-text rc-chev', 'aria-hidden': 'true' }, '›'));
  const recent = el('div', { class: 'sb-group sb-recent', id: 'sbRecent' }, rcBtn, rcList);

  const secs = SECTIONS.map(s => {
    const items = s.items.filter(i => i === '-' || visible(i)).filter((i, k, arr) => i === '-' ? k > 0 && arr[k - 1] !== '-' && k < arr.length - 1 : true);
    const ours = items.filter(i => i !== '-' && i.kind !== 'selly').length;
    const btn = el('button', { type: 'button', class: 'sb-sec', 'data-sec': s.id, 'aria-expanded': 'false',
      title: s.title + ' — ' + ours + ' z ' + items.filter(i => i !== '-').length + ' pozycji w panelu OSA, reszta otwiera panel Selly' },
      icon(s.icon), el('span', { class: 'sb-text' }, s.title));
    const fly = el('div', { class: 'flyout', 'data-fly': s.id, hidden: true },
      el('div', { class: 'fly-head' }, s.title),
      ...items.map(i => i === '-' ? el('hr', { class: 'fly-sep' }) : el('div', { class: 'fly-row' }, itemLink(i))));
    btn.addEventListener('click', e => { e.stopPropagation(); openSection(fly.hidden ? s.id : null); });
    return el('div', { class: 'sb-group', 'data-group': s.id }, btn, fly);
  });
  nav.replaceChildren(search, home, recent, ...secs);
  renderRecents();
  if (navId) markNav(navId);
}

/** „Ostatnie”: ostatnio otwarte miejsca (ekrany i rekordy), najnowsze pierwsze. */
function renderRecents() {
  const host = $('rcList');
  if (!host) return;
  const list = loadRecents().filter(e => e.t !== 'screen' || itemById(e.id));
  host.replaceChildren(...(list.length ? list.map(e => el('a', { href: hashOf(e), class: 'rc-item', 'data-rc': e.t + ':' + e.id, title: TYPES[e.t].name + ': ' + e.label },
    icon(TYPES[e.t].icon, 'rc-ico'), el('span', { class: 'rc-text' }, e.label)))
    : [el('div', { class: 'rc-empty muted small', title: 'Tu pojawią się ostatnio otwarte ekrany, zamówienia, klienci i produkty' }, 'Brak — otwórz coś, a pojawi się tutaj')]));
}

let openSec = null;
function openSection(id) {
  openSec = id;
  for (const f of $('modNav').querySelectorAll('[data-fly]')) f.hidden = f.dataset.fly !== id;
  for (const b of $('modNav').querySelectorAll('[data-sec]')) b.setAttribute('aria-expanded', String(b.dataset.sec === id));
}

function setupSidebar() {
  const sb = $('sidebar'), toggle = $('navToggle');
  const setDrawer = open => { sb.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', e => { e.stopPropagation(); setDrawer(!sb.classList.contains('open')); });
  // Klik w pozycję zamyka wysuniętą listę (i szufladę na telefonie); klik poza menu — też
  sb.addEventListener('click', e => { if (e.target.closest('a')) { openSection(null); setDrawer(false); } });
  document.addEventListener('click', e => { if (!sb.contains(e.target)) { openSection(null); if (!toggle.contains(e.target)) setDrawer(false); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { openSection(null); setDrawer(false); } });
  const col = $('sbCollapse');
  const applyCol = c => { document.documentElement.classList.toggle('sb-collapsed', c); col.setAttribute('aria-pressed', String(c)); };
  applyCol(!!store(COLLAPSE_KEY));
  col.addEventListener('click', () => { const c = !document.documentElement.classList.contains('sb-collapsed'); store(COLLAPSE_KEY, c); applyCol(c); });
}

let navId = null;  // pozycja menu bieżącej trasy

function markNav(modId) {
  const item = itemById(modId);
  for (const a of $('modNav').querySelectorAll('a[data-nav]')) a.setAttribute('aria-current', a.dataset.nav === modId ? 'page' : 'false');
  for (const b of $('modNav').querySelectorAll('[data-sec]')) b.classList.toggle('on', !!item && b.dataset.sec === item.section);
  const sec = item && SECTIONS.find(s => s.id === item.section);
  const mod = getModule(modId);
  $('pageHead').hidden = !item && !mod;
  $('modSub').textContent = sec ? sec.title + ' ›' : '';
  $('pageTitle').textContent = item ? item.title : mod ? mod.title || '' : '';
  // sekcja bez prawa zmian: znacznik „tylko podgląd” w nagłówku strony (zapisy i tak zablokuje serwer; client.api odpowiada od razu)
  let ro = $('roNotice');
  if (!ro) { ro = document.createElement('span'); ro.id = 'roNotice'; ro.className = 'tag tip ro-tag'; ro.textContent = 'tylko podgląd'; ro.title = READONLY_TIP; $('pageTitle').after(ro); }
  ro.hidden = !item || canWriteSection(item.id);
  document.documentElement.classList.toggle('osa-readonly', !!item && !canWriteSection(item.id));
  const sl = $('tbSelly');
  sl.hidden = !(item && item.a);
  if (item && item.a) { sl.href = sellyHref(item.a); sl.title = 'Otwiera „' + item.title + '” w panelu Selly (nowa karta)'; }
}

// ─── Trasa domyślna ─────────────────────────────────────────────────────────

/** Ostatnio używana trasa; starsze zapamiętane ustawienia (osa-module, otk-view) przeliczane na trasę. */
export function defaultRoute() {
  const saved = store(ROUTE_KEY);
  if (typeof saved === 'string') { const m = getModule(saved.split('/')[0]); if (m && !m.placeholder) return '/' + saved; }
  if (store('osa-module') === 'magazyny') return '/magazyny';
  return store('otk-view') === 'orszaki' ? '/licencje/orszaki' : '/pulpit';
}

// ─── Stopka: wersja i backend ───────────────────────────────────────────────

function renderFoot() {
  const foot = $('appFoot');
  foot.textContent = ENV.version ? 'Panel OSA · wersja ' + ENV.version : '';
  const info = apiInfo();
  const be = $('beInfo');
  if (!info) { be.hidden = true; $('beSep').hidden = true; return; }
  be.hidden = false; $('beSep').hidden = false;
  be.textContent = 'backend: ' + info.label + (info.fallback ? ' (zapasowy)' : '');
  be.title = info.fallback
    ? 'Dane pochodzą z zapasowego serwera, bo główny chwilowo nie odpowiada. Panel działa normalnie; główny serwer sprawdzimy ponownie za kilka minut.'
    : 'Z którego serwera pochodzą dane panelu (serwer główny).';
  be.classList.toggle('tip', true);
  renderDbNotice(info);
}

/** Pasek nad treścią, gdy baza panelu (D1) jest chwilowo niedostępna: dane z Selly na żywo albo z serwera zapasowego. */
function renderDbNotice(info) {
  let n = $('dbNotice');
  if (!info || !info.degraded) { if (n) n.hidden = true; return; }
  if (!n) {
    const anchor = $('pageErrors');
    if (!anchor || !anchor.parentNode) return;
    n = document.createElement('div'); n.id = 'dbNotice'; n.className = 'notice warn'; n.setAttribute('role', 'status');
    n.title = 'Dzienny limit bazy Cloudflare D1 został wyczerpany albo baza chwilowo nie odpowiada. Dane pokazujemy na żywo z Selly albo z serwera zapasowego (Apps Script); część widoków może być uboższa. Wróci samo po północy UTC lub po naprawie.';
    anchor.parentNode.insertBefore(n, anchor);
  }
  n.textContent = 'Baza panelu chwilowo niedostępna — dane z Selly na żywo / zapasowy serwer.';
  n.hidden = false;
}

// ─── Start ──────────────────────────────────────────────────────────────────

/** Zgłaszanie błędów i uwag, powiadomienie o nowej wersji (core/errors.js, feedback.js, update.js). */
function setupReporting() {
  const route = () => location.hash.replace(/^#/, '').split('?')[0] || '/';
  const reporter = initErrorReporting({ config: ENV, getToken: freshToken, hasToken, getRoute: route });
  setReporter(reporter);
  initSellyExits({ config: ENV, getToken: freshToken, hasToken, getAdminUrl: adminUrl });
  initFeedback({ button: $('tbFeedback'), config: ENV, getToken: freshToken, getRoute: route,
    getBackend: () => { const i = apiInfo(); return i ? i.label + (i.fallback ? ' (zapasowy)' : '') : ''; }, getErrors: () => reporter.recent() });
  watchVersion({ current: ENV.version || '', onNew: () => showNewVersion({
    canLeave: () => { const m = leaveMessage(); return !m || confirm(m); }, reload: () => location.reload() }) });
}

export function startShell(modules) {
  setupErrors();
  setupTheme();
  setupSidebar();
  initPalette({ sellyHref, isAdmin: () => !!(ctx.boot && ctx.boot.isAdmin), canSee: id => visible({ id }) });
  installShortcuts();
  window.addEventListener('osa-recents', renderRecents);
  $('tbSearch').addEventListener('click', () => openPalette());
  renderFoot();
  onApiInfo(renderFoot);
  for (const m of modules) register(m);
  for (const [id, load] of Object.entries(LAZY)) if (!getModule(id)) register({ id, title: (itemById(id) || {}).title || '', load: () => load().then(m => m.default) });
  // Ekrany uniwersalne (lista → karta → formularz ze specyfikacji API): kind 'resource'
  for (const i of ITEMS) if (i.kind === 'resource' && !getModule(i.id)) register({ id: i.id, title: i.title, load: () => import('../modules/zasob.js?v=abc9fbd').then(m => m.createResource(i.id)) });
  // Pozycje bez własnego ekranu: strona „w planie / tylko w Selly” z linkiem
  for (const i of ITEMS) if (!getModule(i.id)) register(createPlaceholder({ id: i.id, title: i.title, sellyQuery: i.a ? '?a=' + i.a : '', adminUrl, kind: i.kind, tip: i.tip }));
  $('signOut').addEventListener('click', signOut);

  startWithBoot();
}

// ─── Start: whoami (Worker) → natychmiast z zapamiętanego startu, sprawdzenie w tle ───────────────────────

const slimBoot = d => ({ login: d.login || d.email || '', email: d.login || d.email || '', role: d.role || (d.isAdmin ? 'admin' : 'user'), isAdmin: !!d.isAdmin, perms: Array.isArray(d.perms) ? d.perms : [], ...(Array.isArray(d.write) ? { write: d.write } : {}), adminUrl: d.adminUrl || '', year: d.year || null });
const defer = fn => { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 1500 }); else setTimeout(fn, 300); };
let reportingOn = false;
const ensureReporting = () => { if (!reportingOn) { reportingOn = true; setupReporting(); } };

/** Dane startowe: „whoami” z Workera (szybkie, odświeża też token serwera zapasowego); gdy go nie ma (501 / brak sieci) — „init” z Apps Script. */
const fetchBoot = () => api('whoami')
  .then(w => { if (!w || !(w.login || w.email)) throw Object.assign(new Error('whoami bez loginu'), { code: 501 }); return w; })
  // przeładowanie w trakcie sprawdzania uprawnień po logowaniu — dokończ je (do tego czasu sesja nie ma żadnych sekcji)
  .then(w => (w.permsComplete === false ? completePerms(w) : w))
  .then(w => { adoptBoot(w); return w; })
  .catch(e => (e && e.code === 403 ? Promise.reject(e) : api('init')))
  .then(slimBoot);

function cachedBoot() {
  if (!hasToken()) return null;
  const c = store(BOOT_KEY);
  return c && c.login && String(c.login).toLowerCase() === sessionLogin().toLowerCase() ? c : null;
}

function showStartError(err) {
  $('cardSignIn').hidden = true; $('cardStart').hidden = false;
  $('modules').hidden = true; $('pageHead').hidden = true;
  if (err.code === 403) store(BOOT_KEY, null);
  ensureReporting();
  $('tbFeedback').hidden = false;  // także przy błędzie startu — zgłoszenie albo „Kopiuj treść” zawsze dostępne
  if (err.code === 403) { $('signOut').hidden = false; $('tbUser').hidden = false; popup($('userBtn'), $('userMenu')); }  // konto Selly bez dostępu
  $('cardStart').replaceChildren(el('div', { class: 'empty' + (err.code !== 403 ? ' error' : '') },
    err.code === 403 ? err.message + ' Możesz wylogować się i zalogować innym kontem Selly.' : 'Nie udało się otworzyć panelu: ' + err.message));
}

function begin(data) {
  ctx.boot = data;
  $('cardSignIn').hidden = true; $('cardStart').hidden = true; $('signOut').hidden = false;
  setupTopbar(data);
  renderNav(!!data.isAdmin);
  startRouter({
    container: $('modules'),
    fallback: defaultRoute,
    onRoute: (mod, params) => {
      navId = mod.id;
      markNav(mod.id);
      shortcuts.setScreen(mod.id);
      if (mod.id !== 'pulpit' && !(RECORD_MODS.has(mod.id) && params.parts.length)) noteVisit({ t: 'screen', id: mod.id, label: (itemById(mod.id) || mod).title || mod.id, path: [mod.id, ...params.parts].join('/') });
      if (!mod.placeholder) store(ROUTE_KEY, [mod.id, ...params.parts].join('/'));
    },
  });
  defer(ensureReporting);   // błędy, uwagi, kontrola wersji — po pierwszym malowaniu
}

/** Zmiana roli, uprawnień albo adresu Selly po sprawdzeniu w tle. */
function applyFresh(f) {
  store(BOOT_KEY, f);
  const was = JSON.stringify([!!ctx.boot.isAdmin, ctx.boot.perms || []]);
  ctx.boot = { ...ctx.boot, ...f, adminUrl: f.adminUrl || ctx.boot.adminUrl };
  refreshWriteGates(); if (navId) markNav(navId);
  if (was !== JSON.stringify([!!f.isAdmin, f.perms || []])) {
    renderNav(!!f.isAdmin); if (navId) markNav(navId);
    if (navId === 'uzytkownicy') window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

function startWithBoot() {
  const cached = cachedBoot();
  if (cached) {   // panel od razu z zapamiętanymi danymi, sprawdzenie dostępu w tle
    begin(cached);
    fetchBoot().then(applyFresh).catch(err => { if (err && err.code === 403) showStartError(err); });
    return;
  }
  fetchBoot().then(f => { store(BOOT_KEY, f); begin(f); }).catch(showStartError);
}

export { go, parseHash };
