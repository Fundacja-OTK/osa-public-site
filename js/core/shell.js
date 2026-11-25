// Powłoka aplikacji: górny pasek (wyszukiwarki, Selly ↗, konto i motyw), boczne menu: Pulpit, krótka lista codzienna,
// zwijane grupy z resztą ekranów (pełne menu panelu Selly — core/nav.js), „Ostatnie”, szybkie wyszukiwanie (Ctrl+K lub „/”),
// okruszki i tytuł strony, logowanie/start, stopka.
import { $, el, store, pageError, refreshWriteGates, loadingBox } from './ui.js?v=1e8eef7';
import { api, ctx, ENV, apiInfo, onApiInfo, canWriteSection, READONLY_TIP } from './client.js?v=1e8eef7';
import { signOut, freshToken, hasToken, sessionLogin, sessionEmergency, adoptBoot, completePerms } from './auth.js?v=1e8eef7';
import { canSee } from '../lib/panelAuth.js?v=1e8eef7';
import { register, getModule, go, startRouter, parseHash, leaveMessage, prefetch } from './router.js?v=1e8eef7';
import { initErrorReporting } from './errors.js?v=1e8eef7';
import { initSellyExits } from './sellyExits.js?v=1e8eef7';
import { setReporter } from './errorHook.js?v=1e8eef7';
import { initFeedback } from './feedback.js?v=1e8eef7';
import { watchVersion, showNewVersion } from './update.js?v=1e8eef7';
import { createPlaceholder, SELLY_ADMIN } from '../modules/_placeholder.js?v=1e8eef7';
import { ITEMS, itemById, icon, menuModel, groupOf, groupById } from './nav.js?v=1e8eef7';
import { initPalette, openPalette } from './palette.js?v=1e8eef7';
import { installShortcuts, shortcuts } from './shortcuts.js?v=1e8eef7';
import { loadRecents, noteVisit, hashOf, TYPES, RECENT_MAX, RECENT_DAYS, bindRecents } from './recents.js?v=1e8eef7';
import { warmModule, moduleUrlOf, prefetchOnIntent, importRetry } from './preload.js?v=1e8eef7';

const ROUTE_KEY = 'osa-route';
const RECORD_MODS = new Set(['zamowienia', 'klienci', 'produkty']);   // karta rekordu zapisuje się sama (z nazwą)
const BOOT_KEY = 'osa-boot';   // ostatni start: login Selly, rola, sekcje, adres Selly i rok — do natychmiastowego otwarcia panelu
const COLLAPSE_KEY = 'osa-sb-collapsed';
const MODPATH_KEY = 'osa-modpath';   // { trasa: 'js/modules/x.js' } — pliki modułów tras do wstępnego pobrania (js/preboot.js); bez danych osobowych

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_ADMIN;
export const sellyHref = a => adminUrl() + (a ? '?a=' + a : '');

/**
 * Moduły ładowane przy pierwszym wejściu na trasę (brak pozycji → strona „w planie”): () => import('…') albo [() => import('…'), m => moduł trasy]
 * (gdy plik ma kilka ekranów). Każda funkcja to dosłownie import('…') —
 * scripts/bust-cache.js dopisuje do literału ?v=<wersja>, a core/preload.js odczytuje z niego adres pliku (wstępne pobranie zależności).
 */
const LAZY = {
  pulpit: () => import('../modules/pulpit.js?v=1e8eef7'),
  zamowienia: () => import('../modules/zamowienia.js?v=1e8eef7'), produkty: () => import('../modules/produkty.js?v=1e8eef7'), klienci: () => import('../modules/klienci.js?v=1e8eef7'),
  magazyny: () => import('../modules/magazyny.js?v=1e8eef7'), licencje: () => import('../modules/licencje.js?v=1e8eef7'), uzytkownicy: () => import('../modules/uzytkownicy.js?v=1e8eef7'),
  speedmail: () => import('../modules/speedmail.js?v=1e8eef7'),
  przesylki: () => import('../modules/przesylki.js?v=1e8eef7'),
  dropshipping: () => import('../modules/dropshipping.js?v=1e8eef7'),
  wplaty: () => import('../modules/wplaty.js?v=1e8eef7'),
  'zgloszenia-osa': () => import('../modules/zgloszeniaOsa.js?v=1e8eef7'),
  'selly-zmiany': () => import('../modules/sellyZmiany.js?v=1e8eef7'),
  raporty: () => import('../modules/raporty.js?v=1e8eef7'),
  // konfiguracja sklepu — natywne ekrany „strona ustawień” (modules/konfSklepu.js)
  konf: [() => import('../modules/konfSklepu.js?v=1e8eef7'), m => m.konf], 'panel-konf': [() => import('../modules/konfSklepu.js?v=1e8eef7'), m => m.panelKonf],
  'wyglad-konf': [() => import('../modules/konfSklepu.js?v=1e8eef7'), m => m.wygladKonf], znaki: [() => import('../modules/konfSklepu.js?v=1e8eef7'), m => m.znaki],
  jezyki: [() => import('../modules/konfSklepu.js?v=1e8eef7'), m => m.jezyki], dostepnosc: [() => import('../modules/konfSklepu.js?v=1e8eef7'), m => m.dostepnosc],
  // marketplace, integracje, treści, konfiguracja zamówień — natywne ekrany „strona ustawień” (modules/konfSklepu.js)
  ...Object.fromEntries(['allegro', 'allegro-aukcje', 'empik', 'allegro-wysylka', 'allegro-operatorzy', 'allegro-szablony', 'ceneo-opinie', 'ceneo-mapa', 'int-porownywarki', 'int-przesylki', 'int-fk', 'int-dodatkowe', 'ai', 'slajdy', 'ksztalty', 'dostawy-konf', 'statusy-konf']
    .map(id => [id, [() => import('../modules/konfSklepu.js?v=1e8eef7'), m => m.extra[id]]])),
  reklamacje: () => import('../modules/reklamacje.js?v=1e8eef7'), oferty: () => import('../modules/oferty.js?v=1e8eef7'),
  // === administracja i system (podgląd): ekrany tylko do odczytu, jeden moduł (modules/adminNative.js) ===
  ...Object.fromEntries(['allegro-aukcje-lista', 'allegro-zdarzenia', 'admini', 'grupy', 'uprawnienia', 'odo', 'zgloszenia', 'platnosci', 'zlecenia', 'uslugi', 'uslugi-partnerow', 'rozszerzenia', 'wizyty', 'pliki', 'automatyzacje', 'ceny-auto', 'integrator', 'api', 'frontapi'].map(id => [id, [() => import('../modules/adminNative.js?v=1e8eef7'), m => m.views[id]]])),
  // treści (CMS): natywne ekrany z jednego pliku
  ...Object.fromEntries(['cms', 'aktualnosci', 'menu-ed', 'bloki', 'formularze', 'przekierowania', 'gwarancje', 'opisy'].map(id => [id, [() => import('../modules/tresci.js?v=1e8eef7'), m => m.screens[id]]])),
  // === sprzedaż (kupony, koszyki) ===
  kupony: () => import('../modules/kupony.js?v=1e8eef7'), koszyki: () => import('../modules/koszyki.js?v=1e8eef7'),
  'zmiana-cen': () => import('../modules/masowe.js?v=1e8eef7'), 'zmiana-danych': [() => import('../modules/masowe.js?v=1e8eef7'), m => m.modes.dane], 'zmiana-kategorii': [() => import('../modules/masowe.js?v=1e8eef7'), m => m.modes.kat],
};

/**
 * Moduł wczytywany przy pierwszym wejściu: przed import() dodaje <link rel="modulepreload"> dla całego drzewa zależności pliku
 * (mapa z wdrożenia — core/preload.js), więc zależności pobierają się równolegle, a nie kaskadą. Ten sam Promise dla trasy i dla
 * wstępnego pobrania po najechaniu na pozycję menu (prefetch); po błędzie można spróbować ponownie. Nieudane pobranie pliku jest ponawiane
 * raz pod adresem omijającym pamięć (core/preload.js importRetry); gdy i to zawiedzie — router pokazuje komunikat z „Spróbuj ponownie”.
 * loader = dosłownie () => import('…'), pick = moduł ES → obiekt modułu trasy (domyślnie m.default).
 */
function lazyModule(id, title, loader, pick) {
  let p = null;
  const load = () => {
    if (!p) {
      const url = moduleUrlOf(loader, import.meta.url);
      warmModule(url);
      rememberModPath(id, url);
      p = importRetry(loader, import.meta.url).then(pick);
      p.catch(() => { p = null; });
    }
    return p;
  };
  return { id, title, load, prefetch: () => load().catch(() => {}) };
}

/** Plik modułu trasy (bez ?v=) w „osa-modpath” — js/preboot.js pobiera go zawczasu przy następnym otwarciu panelu na tej trasie. */
function rememberModPath(id, url) {
  try {
    const base = new URL('.', document.baseURI).pathname, p = url ? new URL(url).pathname : '';
    if (!p.startsWith(base)) return;
    const rel = p.slice(base.length), m = store(MODPATH_KEY) || {};
    if (m[id] !== rel) { m[id] = rel; store(MODPATH_KEY, m); }
  } catch (e) { /* tylko przyspieszenie */ }
}

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

// ─── Boczne menu: Szukaj (Ctrl+K), Pulpit, „Ostatnie”, krótka lista codzienna, zwijane grupy ───
// Układ (główne / grupy / synonimy) — core/nav.js (PRIMARY, GROUPS, GROUP_OF, SYNONYMS, menuModel).

const isAdminNow = () => !!(ctx.boot && ctx.boot.isAdmin);
/** Pozycja widoczna: sekcje OSA wg uprawnień z Selly (shared/panelAuth.js), administracyjne tylko dla administratora; linki do Selly zawsze. */
const visible = i => i !== '-' && (!i.admin || isAdminNow()) && canSee({ perms: (ctx.boot && ctx.boot.perms) || [], admin: isAdminNow() }, i.id);

const KIND_TIP = {
  soon: 'W planie w panelu OSA — na razie strona z linkiem do panelu Selly',
  selly: 'Tylko w panelu Selly (brak API) — otwiera Selly w nowej karcie',
};
const PULPIT_TIP = 'Pulpit — sprzedaż, zamówienia do zrobienia i najnowsze zmiany';

/** Link pozycji menu: ekran OSA → #/id; tylko Selly → Selly w nowej karcie; w planie → #/id (strona z linkiem do Selly). */
function itemLink(i, cls, ico) {
  const text = el('span', { class: cls === 'fly-item' ? 'fly-text' : 'sb-text' }, i.label || i.title);
  const tip = (i.label && i.label !== i.title ? i.title + ' — ' : '') + (i.tip || KIND_TIP[i.kind] || (i.label ? '' : i.title));
  if (i.kind === 'selly') {
    return el('a', { href: sellyHref(i.a), target: '_blank', rel: 'noopener', class: cls + ' ext', 'data-nav': i.id, title: tip },
      ico ? icon(ico) : null, text, el('span', { class: 'fly-badge sb-text', 'aria-hidden': 'true' }, '↗'));
  }
  return el('a', { href: '#/' + i.id, class: cls + (i.kind === 'soon' ? ' soon' : ''), 'data-nav': i.id, title: tip, 'aria-current': 'false' },
    ico ? icon(ico) : null, text, i.kind === 'soon' ? el('span', { class: 'fly-badge soon', 'aria-hidden': 'true' }, 'wkrótce') : null);
}

let isAdminNav = false;

const RC_OPEN_KEY = 'osa-rc-open';
const OPEN_KEY = 'osa-nav-open';   // rozwinięte grupy (id)
const loadOpen = () => { const v = store(OPEN_KEY); return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []); };

let autoGrp = null;   // grupa rozwinięta sama, bo zawiera bieżący ekran (niezapamiętywana)
let lastGrp;          // grupa bieżącego ekranu przy ostatnim markNav
let flyGrp = null;    // zwinięte menu (same ikony): grupa wysunięta obok paska
const drawerMode = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;
const iconMode = () => document.documentElement.classList.contains('sb-collapsed') && !drawerMode();

/** Rozwinięcie grup: zapamiętane + grupa bieżącego ekranu; w zwiniętym menu — jedna wysunięta grupa. */
function applyGroups() {
  const open = loadOpen(), icons = iconMode();
  for (const b of $('modNav').querySelectorAll('[data-sec]')) {
    const g = b.dataset.sec, on = icons ? flyGrp === g : open.has(g) || autoGrp === g;
    b.setAttribute('aria-expanded', String(on));
    const list = $('grp-' + g);
    if (list) list.hidden = !on;
  }
}

function toggleGroup(g) {
  if (iconMode()) { flyGrp = flyGrp === g ? null : g; applyGroups(); return; }
  const open = loadOpen(), was = open.has(g) || autoGrp === g;
  if (was) { open.delete(g); if (autoGrp === g) autoGrp = null; } else open.add(g);
  store(OPEN_KEY, [...open]);
  applyGroups();
}

function renderNav(isAdmin) {
  isAdminNav = isAdmin;
  const nav = $('modNav');
  const model = menuModel(visible);

  const search = el('button', { type: 'button', class: 'sb-search', id: 'sbSearch', 'aria-haspopup': 'dialog', title: 'Szukaj ekranów (także po słowach, np. „rabaty”, „InPost”), zamówień, klientów i produktów (Ctrl+K lub /)', onclick: () => openPalette() },
    icon('search'), el('span', { class: 'sb-text sb-search-text' }, 'Szukaj…'), el('kbd', { class: 'sb-text sb-kbd' }, 'Ctrl K'));

  const home = el('div', { class: 'sb-group sb-home' }, el('a', { href: '#/pulpit', class: 'sb-label sb-home-link', 'data-nav': 'pulpit', title: PULPIT_TIP, 'aria-current': 'false' }, icon('home'), el('span', { class: 'sb-text' }, 'Pulpit')));

  const primary = el('div', { class: 'sb-primary', id: 'sbPrimary', role: 'group', 'aria-label': 'Menu główne' },
    ...model.primary.map(i => el('div', { class: 'sb-row' }, itemLink(i, 'sb-item', i.icon))));

  const groups = model.groups.map(g => {
    const n = g.items.filter(i => i !== '-').length;
    const btn = el('button', { type: 'button', class: 'sb-sec', 'data-sec': g.id, id: 'grpBtn-' + g.id, 'aria-expanded': 'false', 'aria-controls': 'grp-' + g.id,
      title: g.title + ': ' + g.tip + ' (' + n + ' ' + (n === 1 ? 'pozycja' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'pozycje' : 'pozycji') + '). Kliknij, aby rozwinąć lub zwinąć.' },
      icon(g.icon), el('span', { class: 'sb-text' }, g.title), el('span', { class: 'sb-text grp-chev', 'aria-hidden': 'true' }, '›'));
    btn.addEventListener('click', e => { e.stopPropagation(); toggleGroup(g.id); });
    const list = el('div', { class: 'grp-list flyout', id: 'grp-' + g.id, 'data-fly': g.id, role: 'group', 'aria-label': g.title, hidden: true },
      el('div', { class: 'fly-head' }, g.title),
      ...g.items.map(i => (i === '-' ? el('hr', { class: 'fly-sep' }) : el('div', { class: 'fly-row' }, itemLink(i, 'fly-item')))));
    return el('div', { class: 'sb-group', 'data-group': g.id }, btn, list);
  });
  const moreTip = 'Pozostałe ekrany panelu OSA i panelu Selly, w grupach. Kliknij grupę, aby ją rozwinąć (zapamiętamy to). Każdy ekran znajdziesz też przez „Szukaj…” (Ctrl+K).';
  const more = el('div', { class: 'sb-more sb-text tip', title: moreTip }, 'Więcej');

  // „Ostatnie” — zwijane/rozwijane W MIEJSCU: nagłówek ze strzałką, lista pod nim; stan pamiętany.
  // Bez ręcznego czyszczenia: max RECENT_MAX pozycji z ostatnich RECENT_DAYS dni.
  const rcOpen = store(RC_OPEN_KEY) !== 0;
  const rcList = el('div', { class: 'rc-list', id: 'rcList', hidden: !rcOpen });
  const rcBtn = el('button', { type: 'button', class: 'sb-sec rc-toggle', id: 'sbRecentBtn', 'aria-expanded': String(rcOpen), 'aria-controls': 'rcList',
    title: 'Ostatnio otwarte ekrany i rekordy (zamówienia, klienci, produkty): do ' + RECENT_MAX + ' pozycji z ostatnich ' + RECENT_DAYS + ' dni, tylko w tej przeglądarce. Kliknij, aby zwinąć lub rozwinąć.',
    onclick: e => { e.stopPropagation(); const open = rcList.hidden; rcList.hidden = !open; rcBtn.setAttribute('aria-expanded', String(open)); store(RC_OPEN_KEY, open ? 1 : 0); } },
    icon('clock'), el('span', { class: 'sb-text' }, 'Ostatnie'), el('span', { class: 'sb-text rc-chev', 'aria-hidden': 'true' }, '›'));
  const recent = el('div', { class: 'sb-group sb-recent', id: 'sbRecent' }, rcBtn, rcList);

  const main = el('div', { class: 'sb-main', id: 'sbMain' }, home, recent, primary, more, ...groups);   // „Ostatnie” zaraz pod Pulpitem (prośba właściciela)
  // Wyszukiwarka przyklejona u góry menu (zostaje widoczna po przewinięciu); cień pojawia się dopiero, gdy pod nią przewija się treść
  const searchWrap = el('div', { class: 'sb-search-wrap' }, search);
  nav.replaceChildren(searchWrap, main);
  if (!nav.dataset.stickyHook) { nav.dataset.stickyHook = '1'; nav.addEventListener('scroll', () => nav.classList.toggle('sb-scrolled', nav.scrollTop > 4), { passive: true }); }
  renderRecents();
  applyGroups();
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

// ─── Szuflada (telefon), zwijanie paska ─────────────────────────────────────

function setupSidebar() {
  const sb = $('sidebar'), toggle = $('navToggle');
  const setDrawer = open => { sb.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', e => { e.stopPropagation(); setDrawer(!sb.classList.contains('open')); });
  const closeFly = () => { if (flyGrp) { flyGrp = null; applyGroups(); } };
  // Klik w pozycję zamyka wysuniętą grupę (zwinięte menu) i szufladę na telefonie; klik poza menu — też
  sb.addEventListener('click', e => { if (e.target.closest('a')) { closeFly(); setDrawer(false); } });
  document.addEventListener('click', e => { if (!sb.contains(e.target)) { closeFly(); if (!toggle.contains(e.target)) setDrawer(false); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeFly(); setDrawer(false); } });
  const col = $('sbCollapse');
  const applyCol = c => { document.documentElement.classList.toggle('sb-collapsed', c); col.setAttribute('aria-pressed', String(c)); flyGrp = null; if ($('modNav').firstChild) applyGroups(); };
  applyCol(!!store(COLLAPSE_KEY));
  col.addEventListener('click', () => { const c = !document.documentElement.classList.contains('sb-collapsed'); store(COLLAPSE_KEY, c); applyCol(c); });
  if (typeof matchMedia === 'function') { const mq = matchMedia('(max-width: 900px)'); const re = () => { flyGrp = null; if ($('modNav').firstChild) applyGroups(); }; if (mq.addEventListener) mq.addEventListener('change', re); }
}

let navId = null;  // pozycja menu bieżącej trasy

function markNav(modId) {
  const item = itemById(modId);
  for (const a of $('modNav').querySelectorAll('a[data-nav]')) a.setAttribute('aria-current', a.dataset.nav === modId ? 'page' : 'false');
  // grupa bieżącego ekranu: wyróżniona i rozwinięta sama (pozycja w menu głównym / przypięta — bez grupy)
  const inMain = !!$('modNav').querySelector('#sbPrimary [data-nav="' + modId + '"]');
  const grp = item && !inMain ? groupOf(modId) : null;
  if (grp !== lastGrp) { lastGrp = grp; autoGrp = grp; applyGroups(); }
  for (const b of $('modNav').querySelectorAll('[data-sec]')) b.classList.toggle('on', !!grp && b.dataset.sec === grp);
  const g = item && groupById(groupOf(modId));
  const mod = getModule(modId);
  $('pageHead').hidden = !item && !mod;
  $('modSub').textContent = g ? g.title + ' ›' : '';
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
  watchVersion({ current: ENV.version || '', onNew: offerReload });
}
const offerReload = () => showNewVersion({ canLeave: () => { const m = leaveMessage(); return !m || confirm(m); }, reload: () => location.reload() });
// Kod dwóch wdrożeń w jednej karcie (leniwie wczytany ekran nowszej wersji przy starym rdzeniu — core/router.js): od razu pasek „Jest nowa wersja”
window.addEventListener('osa:skew', () => offerReload());

export function startShell(modules = []) {
  setupErrors();
  setupTheme();
  setupSidebar();
  initPalette({ sellyHref, isAdmin: () => !!(ctx.boot && ctx.boot.isAdmin), canSee: id => visible(itemById(id) || { id }) });
  installShortcuts();
  window.addEventListener('osa-recents', renderRecents);
  $('tbSearch').addEventListener('click', () => openPalette());
  renderFoot();
  onApiInfo(renderFoot);
  for (const m of modules) register(m);
  // Dawne osobne listy przesyłek Furgonetki i Suus → zakładki modułu Przesyłki (jak w Selly: jeden ekran, zakładki przewoźników)
  for (const k of ['furgonetka', 'suus']) register({ id: k, title: (itemById(k) || {}).title || k, mount: () => go('/przesylki/' + k, { replace: true }) });
  for (const [id, e] of Object.entries(LAZY)) if (!getModule(id)) register(lazyModule(id, (itemById(id) || {}).title || '', Array.isArray(e) ? e[0] : e, Array.isArray(e) ? e[1] : m => m.default));
  // Ekrany uniwersalne (lista → karta → formularz ze specyfikacji API): kind 'resource'
  const zasob = () => import('../modules/zasob.js?v=1e8eef7');
  for (const i of ITEMS) if (i.kind === 'resource' && !getModule(i.id)) register(lazyModule(i.id, i.title, zasob, m => m.createResource(i.id)));
  // Pozycje bez własnego ekranu: strona „w planie / tylko w Selly” z linkiem
  for (const i of ITEMS) if (!getModule(i.id)) register(createPlaceholder({ id: i.id, title: i.title, sellyQuery: i.a ? '?a=' + i.a : '', adminUrl, kind: i.kind, tip: i.tip }));
  $('signOut').addEventListener('click', signOut);

  startWithBoot();
}

// ─── Start: whoami (Worker) → natychmiast z zapamiętanego startu, sprawdzenie w tle ───────────────────────

const slimBoot = d => ({ login: d.login || d.email || '', email: d.login || d.email || '', role: d.role || (d.isAdmin ? 'admin' : 'user'), isAdmin: !!d.isAdmin, perms: Array.isArray(d.perms) ? d.perms : [], ...(Array.isArray(d.write) ? { write: d.write } : {}), adminUrl: d.adminUrl || '', year: d.year || null,
  emergency: d.emergency === true, emergencyUntilMs: d.emergency === true ? Number(d.emergencyUntilMs) || 0 : 0 });

/**
 * Tryb awaryjny (wejście kodem od właściciela — docs/auth.md): stały baner u góry treści, dopóki trwa sesja. Mówi, do kiedy, i czego brakuje
 * (ekranów działających na sesji Selly); serwer i tak odmawia tych akcji.
 */
function renderEmergency(boot) {
  const bar = $('emergencyBar');
  if (!bar) return;
  const untilMs = (boot && boot.emergency && boot.emergencyUntilMs) || sessionEmergency();
  const on = !!(boot && boot.emergency) || untilMs > 0;
  bar.hidden = !on;
  if (!on) { bar.replaceChildren(); return; }
  const until = untilMs > 1 ? new Date(untilMs).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  bar.title = 'Zwykłe logowanie przez Selly nie działa, więc wszedłeś jednorazowym kodem od właściciela panelu. Masz uprawnienia z ostatniego zwykłego logowania; '
    + 'zmiany tylko tam, gdzie wtedy miałeś prawo zmian. Ekrany otwierane w Selly (np. Reklamacje, treści, konfiguracja, formularze przewoźników) są niedostępne. '
    + 'Sesji nie da się przedłużyć — po terminie potrzebny będzie nowy kod albo działające logowanie przez Selly.';
  bar.replaceChildren(el('span', { class: 'tip' }, 'Tryb awaryjny' + (until ? ' — dostęp do ' + until : '')),
    ' · ekrany działające na sesji Selly są niedostępne.');
}
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
  bindRecents(data && data.login);   // „Ostatnie” (nazwy klientów, numery zamówień) tylko dla loginu, który je otwierał
  $('cardSignIn').hidden = true; $('cardStart').hidden = true; $('signOut').hidden = false;
  setupTopbar(data);
  renderEmergency(data);
  renderNav(!!data.isAdmin);
  startRouter({
    container: $('modules'),
    fallback: defaultRoute,
    loading: () => loadingBox('Wczytuję…'),
    // kod ekranu się nie wczytał / ekran rzucił wyjątkiem — komunikat z ponowieniem zamiast pustego obszaru (core/router.js)
    failed: ({ mod, phase, err, retry }) => el('div', { class: 'empty error', role: 'alert', id: 'routeError' },
      (phase === 'load' ? 'Nie udało się wczytać ekranu „' : 'Nie udało się pokazać ekranu „') + ((itemById(mod.id) || mod).title || mod.id) + '”. '
        + (phase === 'load' ? 'Sprawdź połączenie z internetem i spróbuj ponownie.' : 'Spróbuj ponownie; jeśli błąd wraca, zgłoś go (Uwagi) — szczegóły: ' + String((err && err.message) || err).slice(0, 160)) + ' ',
      el('button', { type: 'button', class: 'secondary', id: 'routeRetry', onclick: retry }, 'Spróbuj ponownie')),
    onLoading: mod => { navId = mod.id; markNav(mod.id); },
    onRoute: (mod, params) => {
      navId = mod.id;
      markNav(mod.id);
      shortcuts.setScreen(mod.id);
      if (mod.id !== 'pulpit' && !(RECORD_MODS.has(mod.id) && params.parts.length)) noteVisit({ t: 'screen', id: mod.id, label: (itemById(mod.id) || mod).title || mod.id, path: [mod.id, ...params.parts].join('/') });
      if (!mod.placeholder) store(ROUTE_KEY, [mod.id, ...params.parts].join('/'));
    },
  });
  defer(ensureReporting);   // błędy, uwagi, kontrola wersji — po pierwszym malowaniu
  // Najechanie / fokus / dotknięcie pozycji menu lub „Ostatnich” → kod ekranu wczytuje się zawczasu (bez danych — te pobiera ekran)
  prefetchOnIntent($('sidebar'), href => prefetch(parseHash(href).id));
}

/** Zmiana roli, uprawnień albo adresu Selly po sprawdzeniu w tle. */
function applyFresh(f) {
  store(BOOT_KEY, f);
  const was = JSON.stringify([!!ctx.boot.isAdmin, ctx.boot.perms || []]);
  ctx.boot = { ...ctx.boot, ...f, adminUrl: f.adminUrl || ctx.boot.adminUrl, emergency: !!f.emergency, emergencyUntilMs: f.emergencyUntilMs || 0 };
  renderEmergency(ctx.boot);
  if (bindRecents(ctx.boot.login)) renderRecents();
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
