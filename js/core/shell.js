// Powłoka aplikacji: nagłówek, nawigacja modułów, motyw, logowanie/start, stopka (wersja, backend).
import { $, el, store, pageError } from './ui.js';
import { api, ctx, ENV, apiInfo, onApiInfo } from './client.js';
import { signOut } from './auth.js';
import { register, getModule, go, startRouter, parseHash } from './router.js';
import { createPlaceholder, SELLY_ADMIN, BUILDING_TIP } from '../modules/_placeholder.js';

const ROUTE_KEY = 'osa-route';

/** Pozycje nawigacji. `module` = id modułu z implementacją; bez niego pozycja jest wyszarzona i prowadzi do Selly. */
export const NAV = [
  { id: 'zamowienia', title: 'Zamówienia', sellyQuery: '?a=zamowienia' },
  { id: 'produkty', title: 'Produkty', sellyQuery: '?a=produkty' },
  { id: 'klienci', title: 'Klienci', sellyQuery: '?a=klienci' },
  { id: 'magazyny', title: 'Magazyny', module: true, tip: 'Stany magazynowe, wydania do zamówień, inwentaryzacja' },
  { id: 'licencje', title: 'Licencje', module: true, tip: 'Raport licencji członkowskich (przedłużenia, orszaki wg województw)' },
  { id: 'raporty', title: 'Raporty', sellyQuery: '' },
  { id: 'uzytkownicy', title: 'Użytkownicy', sellyQuery: '', admin: true },
];

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_ADMIN;

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

// ─── Nawigacja modułów ──────────────────────────────────────────────────────

function renderNav(isAdmin) {
  const nav = $('modNav');
  const items = NAV.filter(n => !n.admin || isAdmin).map(n => {
    if (n.module) {
      return el('a', { href: '#/' + n.id, 'data-nav': n.id, title: n.tip, 'aria-current': 'false' }, n.title);
    }
    const href = adminUrl() + (n.sellyQuery || '');
    return el('a', { href, target: '_blank', rel: 'noopener', class: 'soon', 'data-nav': n.id, title: BUILDING_TIP + ' (otworzy odpowiednią stronę panelu Selly w nowej karcie)' }, n.title);
  });
  nav.replaceChildren(...items);
  const toggle = $('navToggle');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', () => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); });
}

let navId = null;  // moduł bieżącej trasy (do odświeżenia nawigacji)

function markNav(modId) {
  for (const a of $('modNav').querySelectorAll('a[data-nav]')) a.setAttribute('aria-current', a.dataset.nav === modId ? 'page' : 'false');
  const n = NAV.find(x => x.id === modId);
  $('modSub').textContent = n ? '· ' + n.title : '';
}

// ─── Trasa domyślna ─────────────────────────────────────────────────────────

/** Ostatnio używana trasa; starsze zapamiętane ustawienia (osa-module, otk-view) przeliczane na trasę. */
export function defaultRoute() {
  const saved = store(ROUTE_KEY);
  if (typeof saved === 'string') { const m = getModule(saved.split('/')[0]); if (m && !m.placeholder) return '/' + saved; }
  if (store('osa-module') === 'magazyny') return '/magazyny';
  return store('otk-view') === 'orszaki' ? '/licencje/orszaki' : '/licencje';
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
}

// ─── Start ──────────────────────────────────────────────────────────────────

export function startShell(modules) {
  setupErrors();
  setupTheme();
  renderFoot();
  onApiInfo(renderFoot);
  for (const m of modules) register(m);
  for (const n of NAV) if (!n.module) register(createPlaceholder({ id: n.id, title: n.title, sellyQuery: n.sellyQuery, adminUrl }));
  $('signOut').addEventListener('click', signOut);

  api('init')
    .then(data => {
      ctx.boot = data;
      $('cardSignIn').hidden = true; $('cardStart').hidden = true; $('signOut').hidden = false;
      $('who').textContent = data.email ? 'Zalogowano: ' + data.email : '';
      renderNav(!!data.isAdmin);
      // Rola z Cloudflare (Apps Script jej nie zna): „Użytkownicy” dla administratora; brak Workera → bez zmian
      if (!data.isAdmin) api('whoami').then(w => { if (w && w.isAdmin) { ctx.boot.isAdmin = true; renderNav(true); if (navId) markNav(navId); } }).catch(() => {});
      startRouter({
        container: $('modules'),
        fallback: defaultRoute,
        onRoute: (mod, params) => {
          navId = mod.id;
          markNav(mod.id);
          if (!mod.placeholder) store(ROUTE_KEY, [mod.id, ...params.parts].join('/'));
        },
      });
    })
    .catch(err => {
      $('cardSignIn').hidden = true; $('cardStart').hidden = false;
      if (err.code === 403) $('signOut').hidden = false;  // inne konto Google
      $('cardStart').replaceChildren(el('div', { class: 'empty' + (err.code !== 403 ? ' error' : '') },
        err.code === 403 ? err.message + ' Możesz wylogować się i wybrać inne konto.' : 'Nie udało się otworzyć raportu: ' + err.message));
    });
}

export { go, parseHash };
