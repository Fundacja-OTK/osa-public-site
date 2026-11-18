// Powłoka aplikacji: górny pasek (wyszukiwarki, Selly ↗, konto i motyw), boczne menu sekcji z wysuwanymi listami
// (pełne menu panelu Selly — core/nav.js), „Moje skróty”, okruszki i tytuł strony, logowanie/start, stopka.
import { $, el, store, pageError } from './ui.js';
import { api, ctx, ENV, apiInfo, onApiInfo } from './client.js';
import { signOut } from './auth.js';
import { register, getModule, go, startRouter, parseHash } from './router.js';
import { createPlaceholder, SELLY_ADMIN } from '../modules/_placeholder.js';
import { SECTIONS, ITEMS, itemById, DEFAULT_PINS, icon } from './nav.js';

const ROUTE_KEY = 'osa-route';
const PIN_KEY = 'osa-pins';
const COLLAPSE_KEY = 'osa-sb-collapsed';

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_ADMIN;
export const sellyHref = a => adminUrl() + (a ? '?a=' + a : '');

/** Moduły ładowane przy pierwszym wejściu (nowe ekrany; brak pliku → strona „w planie”). */
const LAZY = {
  pulpit: () => import('../modules/pulpit.js'),
  przesylki: () => import('../modules/przesylki.js'),
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
  $('who').textContent = data.email ? 'Zalogowano: ' + data.email : '';
  $('avatar').textContent = (data.email || '?').slice(0, 1).toUpperCase();
  popup($('userBtn'), $('userMenu'));
  const form = $('tbSearch');
  form.hidden = false;
  form.addEventListener('submit', e => e.preventDefault());
  for (const inp of form.querySelectorAll('input[data-route]')) {
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = inp.value.trim();
      go('/' + inp.dataset.route + (v ? '?q=' + encodeURIComponent(v) : ''));
      inp.blur();
    });
  }
}

// ─── Boczne menu: sekcje + wysuwane listy pozycji ───────────────────────────

const pins = () => { const p = store(PIN_KEY); return Array.isArray(p) ? p.filter(id => itemById(id)) : DEFAULT_PINS.slice(); };
const visible = (i, isAdmin) => i !== '-' && (!i.admin || isAdmin);

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

function renderNav(isAdmin) {
  isAdminNav = isAdmin;
  const nav = $('modNav');
  const pinned = pins();
  const pinBtn = i => el('button', { type: 'button', class: 'pin', 'aria-pressed': String(pinned.includes(i.id)),
    title: pinned.includes(i.id) ? 'Usuń z „Moich skrótów”' : 'Dodaj do „Moich skrótów” (na górze menu)',
    onclick: e => { e.preventDefault(); e.stopPropagation(); togglePin(i.id); } }, '★');

  const home = el('div', { class: 'sb-group sb-home' }, el('a', { href: '#/pulpit', class: 'sb-label sb-home-link', 'data-nav': 'pulpit', title: 'Pulpit — sprzedaż, zamówienia do zrobienia i najnowsze zmiany', 'aria-current': 'false' }, icon('home'), el('span', { class: 'sb-text' }, 'Pulpit')));
  const shortcuts = el('div', { class: 'sb-group sb-pins' },
    el('div', { class: 'sb-label', title: 'Przypnij dowolną pozycję gwiazdką ★ w menu sekcji' }, icon('star'), el('span', { class: 'sb-text' }, 'Moje skróty')),
    el('div', { class: 'pin-list' }, ...pinned.map(id => itemById(id)).filter(i => visible(i, isAdmin)).map(i =>
      el('a', { href: i.kind === 'selly' ? sellyHref(i.a) : '#/' + i.id, target: i.kind === 'selly' ? '_blank' : null, rel: i.kind === 'selly' ? 'noopener' : null,
        class: 'pin-item', 'data-pin': i.id, title: i.title + (i.kind === 'selly' ? ' (panel Selly ↗)' : '') }, i.title))));

  const secs = SECTIONS.map(s => {
    const items = s.items.filter((i, k, arr) => i === '-' ? k > 0 && arr[k - 1] !== '-' : visible(i, isAdmin));
    const ours = items.filter(i => i !== '-' && i.kind !== 'selly').length;
    const btn = el('button', { type: 'button', class: 'sb-sec', 'data-sec': s.id, 'aria-expanded': 'false',
      title: s.title + ' — ' + ours + ' z ' + items.filter(i => i !== '-').length + ' pozycji w panelu OSA, reszta otwiera panel Selly' },
      icon(s.icon), el('span', { class: 'sb-text' }, s.title));
    const fly = el('div', { class: 'flyout', 'data-fly': s.id, hidden: true },
      el('div', { class: 'fly-head' }, s.title),
      ...items.map(i => i === '-' ? el('hr', { class: 'fly-sep' }) : el('div', { class: 'fly-row' }, itemLink(i), pinBtn(i))));
    btn.addEventListener('click', e => { e.stopPropagation(); openSection(fly.hidden ? s.id : null); });
    return el('div', { class: 'sb-group', 'data-group': s.id }, btn, fly);
  });
  nav.replaceChildren(home, shortcuts, ...secs);
  if (navId) markNav(navId);
}

function togglePin(id) {
  const p = pins();
  const k = p.indexOf(id);
  if (k < 0) p.push(id); else p.splice(k, 1);
  store(PIN_KEY, p);
  const open = openSec;
  renderNav(isAdminNav);
  openSection(open);
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
  for (const a of $('modNav').querySelectorAll('a[data-nav], a[data-pin]')) {
    const on = (a.dataset.nav || a.dataset.pin) === modId;
    if (a.dataset.nav) a.setAttribute('aria-current', on ? 'page' : 'false'); else a.classList.toggle('on', on);
  }
  for (const b of $('modNav').querySelectorAll('[data-sec]')) b.classList.toggle('on', !!item && b.dataset.sec === item.section);
  const sec = item && SECTIONS.find(s => s.id === item.section);
  const mod = getModule(modId);
  $('pageHead').hidden = !item && !mod;
  $('modSub').textContent = sec ? sec.title + ' ›' : '';
  $('pageTitle').textContent = item ? item.title : mod ? mod.title || '' : '';
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
}

// ─── Start ──────────────────────────────────────────────────────────────────

export function startShell(modules) {
  setupErrors();
  setupTheme();
  setupSidebar();
  renderFoot();
  onApiInfo(renderFoot);
  for (const m of modules) register(m);
  for (const [id, load] of Object.entries(LAZY)) if (!getModule(id)) register({ id, title: (itemById(id) || {}).title || '', load: () => load().then(m => m.default) });
  // Ekrany uniwersalne (lista → karta → formularz ze specyfikacji API): kind 'resource'
  for (const i of ITEMS) if (i.kind === 'resource' && !getModule(i.id)) register({ id: i.id, title: i.title, load: () => import('../modules/zasob.js').then(m => m.createResource(i.id)) });
  // Pozycje bez własnego ekranu: strona „w planie / tylko w Selly” z linkiem
  for (const i of ITEMS) if (!getModule(i.id)) register(createPlaceholder({ id: i.id, title: i.title, sellyQuery: i.a ? '?a=' + i.a : '', adminUrl, kind: i.kind, tip: i.tip }));
  $('signOut').addEventListener('click', signOut);

  api('init')
    .then(data => {
      ctx.boot = data;
      $('cardSignIn').hidden = true; $('cardStart').hidden = true; $('signOut').hidden = false;
      setupTopbar(data);
      renderNav(!!data.isAdmin);
      // Rola z Cloudflare (Apps Script jej nie zna): „Dostęp do panelu OSA” dla administratora; brak Workera → bez zmian
      if (!data.isAdmin) api('whoami').then(w => { if (w && w.isAdmin) { ctx.boot.isAdmin = true; renderNav(true); if (navId) markNav(navId); if (navId === 'uzytkownicy') window.dispatchEvent(new HashChangeEvent('hashchange')); } }).catch(() => {});
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
      if (err.code === 403) { $('signOut').hidden = false; $('tbUser').hidden = false; popup($('userBtn'), $('userMenu')); }  // inne konto Google
      $('cardStart').replaceChildren(el('div', { class: 'empty' + (err.code !== 403 ? ' error' : '') },
        err.code === 403 ? err.message + ' Możesz wylogować się i wybrać inne konto.' : 'Nie udało się otworzyć panelu: ' + err.message));
    });
}

export { go, parseHash };
