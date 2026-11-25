// Moduł „Zamówienia”: lista z filtrami i akcjami masowymi (#/zamowienia?status=..&q=..&page=..), szczegóły (#/zamowienia/<id>) i lista faktur (#/zamowienia/faktury).
// Dane i zapisy: backend Cloudflare (akcje orders:meta, orders:list, orders:get, orders:setStatus).
import { photoSrc } from '../core/photo.js?v=d6bfd64';
import { gateWrite, el, tapOpen, plural, debounce, store, flash, norm, menuButton, downloadXlsx, downloadCsv, tableMatrix, copyToClipboard, money, dateStr, fullName, cnt, isUnavailable, loadingBox, sellyLink, dl, sortTh, pager, fetchAllRows, pageToolbar, filterLayout, thumb, columnMenu, multiSelect, dateRange, orderStatusTone, selOffNote } from '../core/ui.js?v=d6bfd64';
import { setStatusInChunks } from '../lib/statusBatch.js?v=d6bfd64';
import { api, ctx } from '../core/client.js?v=d6bfd64';
import { go, setLeaveGuard } from '../core/router.js?v=d6bfd64';
import { noteVisit } from '../core/recents.js?v=d6bfd64';
import { registerListKeys } from '../core/listKeys.js?v=d6bfd64';
import { liveRefresh, changedIds } from '../core/liveRefresh.js?v=d6bfd64';
import { cachedRead } from '../core/cache.js?v=d6bfd64';
import { buildOrderCard, productPicker } from './zamowieniaKarta.js?v=d6bfd64';
import { showNewOrder } from './zamowienieNowe.js?v=d6bfd64';
import { showInvoices } from './zamowieniaFaktury.js?v=d6bfd64';
import { showPick } from './zamowieniaKompletacja.js?v=d6bfd64';
import { createFilterUi } from './zamowieniaFiltry.js?v=d6bfd64';
import { FKEYS, EMPTY_F, readFilters, writeFilters, filterParams, effectiveDateTo, clausesOf, anyFilter } from './zamFiltry.js?v=d6bfd64';
import { readOsa, writeOsa, osaParams, osaActive, osaBar, osaBadges, osaExport, licenseExport, osaDetailPairs, applyBadgePrefs, OSA_CLEAR } from '../core/osa.js?v=d6bfd64';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const SORTS = ['date', 'number', 'status', 'total'];
const SIZES = [25, 50, 100, 200];
const EXTRA_CLEAR = { payment: '', delivery: '', product: '', pname: '' };
const CLEAR_ALL = () => ({ status: '', q: '', from: '', to: '', ...EXTRA_CLEAR, ...EMPTY_F, ...OSA_CLEAR });
// Eksport czyta z bazy panelu (nie z Selly — nie zużywa limitu API); górna granica tylko jako bezpiecznik
const EXPORT_MAX = 50000;
const MSG_UNAVAILABLE = 'Moduł Zamówienia wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = {
  root: null, metaBox: null, listBox: null, detailBox: null, ui: {},
  meta: null, metaErr: null, metaLoading: false,
  Q: null, data: null, loading: false, err: '',
  sel: new Map(),            // id → wiersz listy (zaznaczenie zostaje przy zmianie filtrów i stron)
  listHash: '#/zamowienia',  // ostatni adres listy (powrót ze szczegółów)
  seq: 0, routeSeq: 0, guard: null,
  touchedAt: 0, metaAt: 0, flashIds: null,   // świeżość: ostatnia interakcja z listą, ostatnie liczniki, wiersze do podświetlenia
};
const META_BG_MS = 5 * 60 * 1000;   // liczniki statusów w tle najwyżej co 5 min (skan tabeli); kliknięcie „Odśwież” — zawsze
window.addEventListener('beforeunload', ev => { if (S.guard && S.guard()) { ev.preventDefault(); ev.returnValue = ''; } });
// Ta sama ochrona przy przejściu w panelu (menu modułów, linki, Wstecz)
setLeaveGuard(() => (S.guard && S.guard() ? 'W karcie zamówienia są niezapisane zmiany. Opuścić ją i je odrzucić?' : null));

// ─── Pomocnicze ─────────────────────────────────────────────────────────────

const adminUrl = () => (S.meta && S.meta.adminUrl) || (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const dayStr = d => (d ? String(d).slice(0, 10) : '');
const statusName = id => { const s = S.meta && S.meta.statuses.find(x => String(x.id) === String(id)); return s ? s.name : (id == null || id === '' ? '—' : 'Status ' + id); };
const nameIn = (list, id) => { const x = (list || []).find(y => String(y.id) === String(id)); return x ? x.name : String(id); };
const sellyOrderUrl = id => adminUrl() + '?a=zamowienia.view&id=' + encodeURIComponent(id);

const statusTone = orderStatusTone;
const statusPill = (id, name) => { const nm = name || statusName(id); return el('span', { class: 'ord-st ' + statusTone(nm), title: 'Status zamówienia: ' + nm }, nm); };

function unavailableBox(extra) {
  return el('div', { class: 'card' }, el('div', { class: 'empty error' },
    el('p', null, el('strong', null, extra || MSG_UNAVAILABLE)),
    el('p', null, sellyLink('Otwórz zamówienia w panelu Selly ↗', adminUrl() + '?a=zamowienia', 'Otwiera listę zamówień w panelu administracyjnym Selly w nowej karcie')),
    el('p', null, el('button', { type: 'button', class: 'secondary', onclick: () => { S.meta = null; mountRoute(); } }, 'Spróbuj ponownie'))));
}

// ─── Stan filtrów ↔ adres ───────────────────────────────────────────────────

function readQ(query) {
  const g = k => (query && query.get(k)) || '';
  const sort = SORTS.includes(g('sort')) ? g('sort') : 'date';
  return {
    status: g('status'), q: g('q'), from: g('from'), to: g('to'), payment: g('payment'), delivery: g('delivery'), product: g('product'), pname: g('pname'), ...readFilters(g), ...readOsa(g),
    page: Math.max(1, parseInt(g('page'), 10) || 1), sort, dir: g('dir') === 'asc' ? 'asc' : g('dir') === 'desc' ? 'desc' : (sort === 'date' || sort === 'total' ? 'desc' : 'asc'),
  };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  writeFilters(Q, p);
  if (Q.q) p.set('q', Q.q);
  if (Q.from) p.set('from', Q.from);
  if (Q.to) p.set('to', Q.to);
  if (Q.payment) p.set('payment', Q.payment);
  if (Q.delivery) p.set('delivery', Q.delivery);
  if (Q.product) { p.set('product', Q.product); if (Q.pname) p.set('pname', Q.pname); }
  writeOsa(Q, p);
  if (Q.page > 1) p.set('page', String(Q.page));
  if (Q.sort !== 'date' || Q.dir !== 'desc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  return s ? '?' + s : '';
}
const pageSize = () => { const v = store('osa-ord-size'); return SIZES.includes(v) ? v : 50; };
const listParams = (Q, extra) => {
  const p = { sort: Q.sort, dir: Q.dir, pageSize: pageSize(), page: Q.page };
  Object.assign(p, filterParams(Q));
  if (Q.q) p.q = Q.q;
  if (Q.from) p.dateFrom = Q.from;
  const to = effectiveDateTo(Q.to, Q.older);
  if (to) p.dateTo = to;
  if (Q.payment) p.paymentId = Q.payment;
  if (Q.delivery) p.deliveryId = Q.delivery;
  if (Q.product) p.productId = Q.product;
  return Object.assign(p, osaParams(Q), extra);
};

/** Zmiana filtrów: nowy adres (cofnięcie przeglądarki wraca do poprzedniego widoku); replace — bez wpisu w historii (pisanie w wyszukiwarce). */
function setQ(patch, replace) {
  S.only = false;   // zmiana filtrów / strony kończy widok „tylko zaznaczone”
  const n = Object.assign({}, S.Q, patch);
  if (!('page' in patch)) n.page = 1;
  const h = '/zamowienia' + qsOf(n);
  const same = location.hash === '#' + h;
  if (replace) go(h, { replace: true });
  else if (same) { S.Q = n; loadList(); } else go(h);
}

// ─── Meta ───────────────────────────────────────────────────────────────────

async function ensureMeta() {
  if (S.meta) return true;
  if (S.metaLoading) return false;
  S.metaLoading = true; S.metaErr = null;
  try { S.meta = await cachedRead('orders:meta', {}, { personal: true }); S.metaAt = Date.now(); } catch (e) { S.metaErr = e; }
  S.metaLoading = false;
  return !!S.meta;
}
const countOf = id => { const c = S.meta.counts.find(x => String(x.id) === String(id)); return c ? Number(c.n) || 0 : 0; };

// ─── Lista: budowa ──────────────────────────────────────────────────────────

function buildList() {
  const u = S.ui;
  u.search = el('input', { type: 'search', id: 'ordSearch', placeholder: 'Szukaj: numer, e-mail, telefon, nazwisko, firma, miasto, nr przesyłki', 'aria-label': 'Szukaj zamówień',
    title: 'Szuka w numerze zamówienia, e-mailu, telefonie, imieniu i nazwisku (faktura i wysyłka), firmie, mieście i numerze przesyłki',
    oninput: debounce(() => { const v = u.search.value.trim(); if (v !== S.Q.q) setQ({ q: v }, true); }, 350) });
  u.range = dateRange({ idFrom: 'ordFrom', idTo: 'ordTo', labelFrom: 'Od dnia', labelTo: 'Do dnia', titleFrom: 'Zamówienia złożone od tego dnia (włącznie)', titleTo: 'Zamówienia złożone do tego dnia (włącznie)', onChange: r => setQ(r) });
  u.from = u.range.from; u.to = u.range.to;
  u.size = el('select', { id: 'ordSize', 'aria-label': 'Wierszy na stronie', title: 'Ile zamówień pokazać na jednej stronie listy',
    onchange: () => { store('osa-ord-size', Number(u.size.value)); setQ({}); } },
    SIZES.map(n => el('option', { value: String(n) }, String(n))));
  const mkMs = (id, all, short, noun, tip, field) => multiSelect({ id, all, short, noun, tip, none: false, onChange: csv => setQ({ [field]: csv }) });
  u.payment = mkMs('ordPayment', 'Wszystkie płatności', 'Płatność', 'Płatność', 'Tylko zamówienia z wybranymi sposobami płatności — można zaznaczyć kilka', 'payment');
  u.deliverySel = mkMs('ordDelivery', 'Wszystkie dostawy', 'Dostawa', 'Dostawa', 'Tylko zamówienia z wybranymi sposobami dostawy — można zaznaczyć kilka', 'delivery');
  u.prodLabel = el('span', { class: 'ord-prod-on', id: 'ordProdOn', hidden: true });
  u.prodPick = productPicker({ id: 'ordProdSearch', placeholder: 'Szukaj produktu…', tip: 'Tylko zamówienia zawierające wybrany produkt. Wpisz nazwę, kod lub EAN i wybierz produkt z listy.', onPick: p => setQ({ product: String(p.id), pname: p.name || '' }) });
  u.prodClear = el('button', { type: 'button', class: 'ghost', id: 'ordProdClear', title: 'Usuń filtr produktu', onclick: () => setQ({ product: '', pname: '' }) }, 'Usuń');
  u.filtersBtn = el('button', { type: 'button', class: 'secondary', id: 'ordFiltersBtn', 'aria-expanded': 'false', 'aria-controls': 'ordFilters',
    title: 'Pokaż lub ukryj panel filtrów po lewej: płatność, dostawa, produkt, zakres dat, dane z notatek klientów. Wybór jest zapamiętywany.', onclick: () => toggleFilters() }, 'Filtry');
  u.fx = createFilterUi({ Q: () => S.Q, meta: () => S.meta, setQ: patch => setQ(patch), osaOn: () => osaActive(S.Q), osaClear: OSA_CLEAR, qsOf, clearAll: () => setQ(CLEAR_ALL()), openPanel: () => { if (u.layout && !u.layout.isOpen()) toggleFilters(true); },
    goQs: qs => go('/zamowienia' + (qs ? '?' + qs : '')), linkFor: qs => location.href.split('#')[0] + '#/zamowienia' + (qs ? '?' + qs : '') });
  u.filtersInner = el('div', { class: 'opts-box ord-filters' });
  u.thumbs = el('input', { type: 'checkbox', id: 'ordThumbs', checked: thumbsOn(), onchange: () => { store('osa-ord-thumbs', u.thumbs.checked ? 1 : 0); if (S.data) renderList(); } });
  u.osa = osaBar({ prefix: 'ordOsa', withLicense: true, plain: true, getQ: () => S.Q, apply: patch => setQ(patch), facets: () => S.meta && S.meta.facets });
  u.filtersInner.append(...u.fx.panelNodes({
    moreTitle: 'Klient i produkt', moreTip: 'Dane z notatek klientów (województwo, rodzaj podmiotu, tytuł, tagi, licencja) i produkt w zamówieniu', moreActive: () => !!(S.Q.product || osaActive(S.Q)),
    payMethod: el('div', { class: 'field-inline' }, 'Sposób płatności', u.payment.node), delivery: el('div', { class: 'field-inline' }, 'Sposób dostawy', u.deliverySel.node), range: u.range.node,
    more: [el('div', { class: 'fx-clients' }, u.osa.node, el('div', { class: 'field-inline ord-prodf' }, 'Produkt', u.prodPick.node, u.prodLabel, u.prodClear))],
  }));
  u.filtersInner.append(el('div', { class: 'ord-filter-row' },
    el('label', { class: 'field-inline' }, 'Wierszy na stronie', u.size),
    el('label', { class: 'field-inline', style: 'flex-direction:row;align-items:center;gap:6px', title: 'Pokazuje lub ukrywa miniatury zdjęć przy produktach w kolumnie „Zamówione produkty”' }, u.thumbs, 'Pokazuj małe zdjęcia produktów')));
  u.segs = el('div', { class: 'ord-segs', role: 'group', 'aria-label': 'Status zamówienia' });
  u.exportBtn = menuButton({ id: 'ordExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz zamówienia z tabeli do pliku Excel lub CSV — zaznaczone albo cały wynik filtra', items: exportItems });
  u.colMenu = columnMenu({ id: 'ordColsBtn', storeKey: 'osa-ord-cols2',   // v2: Klient i Informacje dodatkowe domyślnie wyłączone
    onChange: () => { if (S.data) renderList(); },
    cols: [
      { key: 'nr', label: 'Nr i status', locked: true },
      { key: 'client', label: 'Klient', def: false, tip: 'Nazwisko, firma, miasto i plakietki z notatki klienta' },
      { key: 'items', label: 'Zamówione produkty', tip: 'Pozycje zamówienia z ilościami i miniaturami' },
      { key: 'total', label: 'Wartość', locked: true },
      { key: 'info', label: 'Informacje dodatkowe', def: false, tip: 'Komentarz klienta, uwaga do zamówienia i numer przesyłki' }] });
  u.info = el('div', { class: 'muted small ord-info' });
  u.dlg = el('div', { id: 'ordDlg' });
  // Pasek „Zaznaczono” przyklejony u dołu, POD tabelą — jego pojawienie się nie przesuwa wierszy (klik w pole wyboru nie „skacze”)
  u.bulk = el('div', { class: 'ord-bulk sel-bar', id: 'ordBulk', role: 'region', 'aria-label': 'Akcje dla zaznaczonych zamówień', hidden: true });
  u.results = el('div', { id: 'ordResults' });
  // Świeżość listy: znacznik wersji co 30 s, powrót do karty, „Odśwież” (core/liveRefresh.js)
  u.live = liveRefresh({ id: 'ord', reload: kind => loadList(kind), busy: listBusy });
  u.layout = filterLayout({ key: 'zamowienia', panelId: 'ordFilters', panelNodes: [u.filtersInner],
    mainNodes: [u.segs, el('div', { class: 'toolbar' }, u.search, u.fx.viewsMenu, u.exportBtn, u.colMenu.node, el('span', { class: 'spacer' }), u.info, u.live.node), u.fx.sum, u.results, u.bulk, u.dlg] });
  u.filters = u.layout.panel;
  S.listBox = el('div', { class: 'ord-list' },
    el('div', { class: 'card' },
      pageToolbar({ title: 'Zamówienia', sub: 'Lista zamówień ze sklepu — zmiany z Selly pojawiają się same (zwykle w ciągu minuty, od razu po „Odśwież”). Kliknij numer zamówienia, aby zobaczyć szczegóły.',
        actions: [u.filtersBtn, el('a', { class: 'btn-secondary', id: 'ordInvoicesLink', href: '#/zamowienia/faktury',
          title: 'Faktury ze wszystkich zamówień: filtry (okres, numer, rozliczone / do zapłaty), rozliczenia, wydruk i eksport' }, 'Faktury'),
          el('a', { class: 'btn-secondary', id: 'ordSpeedMail', href: '#/speedmail',
          title: 'Kreator wysyłki do magazynu SpeedMail: wybór zamówień, sprawdzenie stanu SM, podział, plik dla SpeedMail i zmiana statusów w Selly. Środkowy przycisk myszy albo Ctrl+klik otwiera w nowej karcie.' }, 'Wysyłka SpeedMail'),
          el('a', { class: 'btn-primary', id: 'ordAdd', href: '#/zamowienia/nowe', write: 'zamowienia',
          title: 'Dodaj zamówienie ręcznie: klient, produkty, dostawa i płatność (formularz w panelu)' }, '+ Nowe zamówienie')] }),
      u.layout.node));
  S.root.append(S.listBox);
  // Klik / klawisz w liście = użytkownik pracuje — odświeżenie w tle czeka chwilę (nie przestawia wierszy pod kursorem)
  for (const t of ['pointerdown', 'keydown']) S.listBox.addEventListener(t, () => { S.touchedAt = Date.now(); }, true);
}

/** Czy odświeżenie w tle ma poczekać: lista niewidoczna / wczytuje się, otwarte okno zmiany statusu lub menu, świeża interakcja. */
function listBusy() {
  const u = S.ui;
  return !S.listBox || S.listBox.hidden || S.loading || !S.data || (u.dlg && u.dlg.childElementCount > 0)
    || !!S.listBox.querySelector('.menu-pop:not([hidden])') || Date.now() - S.touchedAt < 5000;
}

function toggleFilters(force) {
  const u = S.ui, open = force != null ? force : !u.layout.isOpen();
  u.layout.setOpen(open, force == null);
  u.filtersBtn.setAttribute('aria-expanded', String(open));
  u.filtersBtn.textContent = filtersLabel(open);
}

/** „Filtry (3) ▾” — liczba aktywnych filtrów z panelu (płatność, dostawa, produkt, daty, dane z notatek klientów). */
function filtersLabel(open) {
  const Q = S.Q || {};
  const n = ['payment', 'delivery', 'product', 'from', 'to', 'woj', 'kind', 'title', 'tag', 'lic', ...FKEYS].filter(k => Q[k]).length;
  return 'Filtry' + (n ? ' (' + n + ')' : '') + (open ? ' ◂' : ' ▸');
}

function syncList() {
  const u = S.ui, Q = S.Q;
  if (u.search.value.trim() !== Q.q) u.search.value = Q.q;
  u.from.value = Q.from; u.to.value = Q.to; u.size.value = String(pageSize());
  u.filtersBtn.textContent = filtersLabel(u.layout.isOpen());
  u.payment.set((S.meta.payments || []).map(x => ({ key: String(x.id), label: x.name })), Q.payment);
  u.deliverySel.set((S.meta.deliveries || []).map(x => ({ key: String(x.id), label: x.name })), Q.delivery);
  u.prodLabel.hidden = u.prodClear.hidden = !Q.product; u.prodLabel.textContent = Q.product ? '„' + (Q.pname || 'produkt #' + Q.product) + '”' : '';
  const extra = !!(Q.from || Q.to || Q.payment || Q.delivery || Q.product) || pageSize() !== 50;
  u.filtersBtn.classList.toggle('on', extra);
  if (extra && u.filters.hidden) toggleFilters(true);
  renderSegs();
  u.osa.sync();
  u.fx.sync();
}

function renderSegs() {
  const u = S.ui, Q = S.Q, M = S.meta;
  const withN = M.statuses.map(s => ({ ...s, n: countOf(s.id) }));
  const total = withN.reduce((a, s) => a + s.n, 0);
  const top = withN.filter(s => s.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
  if (Q.status && !Q.status.includes(',') && !top.some(s => String(s.id) === Q.status)) { const c = withN.find(s => String(s.id) === Q.status); if (c) top.push(c); }
  top.sort((a, b) => a.position - b.position);
  const rest = withN.filter(s => !top.includes(s) && s.n > 0);
  const chip = (label, n, active, tip, onclick, id) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(active), title: tip, id, onclick },
    label, el('span', { class: 'ord-n' }, String(n)));
  const parts = [chip('Wszystkie', total, !Q.status && !Q.xstatus, 'Wszystkie zamówienia, w każdym statusie: ' + total + ' (liczba z ostatniej synchronizacji, niezależna od wyszukiwania i dat)', () => setQ({ status: '', xstatus: '' }), 'ordSegAll')];
  for (const s of top) parts.push(chip(s.name, s.n, Q.status === String(s.id), 'Zamówienia w statusie „' + s.name + '”: ' + s.n + ' (liczba z ostatniej synchronizacji, niezależna od wyszukiwania i dat)', () => setQ({ status: String(s.id), xstatus: '' }), 'ordSeg' + s.id));
  if (rest.length) {
    parts.push(menuButton({ id: 'ordSegMore', label: 'Pozostałe statusy', cls: 'secondary', title: 'Pozostałe, rzadziej używane statusy z liczbą zamówień',
      items: () => rest.map(s => ({ label: s.name, count: s.n, title: 'Pokaż zamówienia w statusie „' + s.name + '”', run: () => setQ({ status: String(s.id), xstatus: '' }) })) }));
  }
  u.segs.replaceChildren(...parts);
}

// ─── Lista: dane ────────────────────────────────────────────────────────────

/** kind: { background } — odświeżenie w tle (bez migania, z zachowaniem przewinięcia), { manual } — przycisk „Odśwież”. */
async function loadList(kind = {}) {
  const my = ++S.seq, u = S.ui, quiet = !!(kind.background || kind.manual);
  S.loading = true; S.err = '';
  if (!quiet) syncList();
  if (!S.data) u.results.replaceChildren(loadingBox('Pobieram zamówienia…'));
  else if (!quiet) u.results.classList.add('fade');
  const prev = S.data;
  // Liczniki statusów: po kliknięciu „Odśwież” zawsze, w tle najwyżej co META_BG_MS
  if (quiet && (kind.manual || Date.now() - S.metaAt >= META_BG_MS)) {
    S.metaAt = Date.now();
    api('orders:meta', kind.manual ? {} : { bg: 1 }).then(m => { if (m && m.statuses) { S.meta = m; if (S.listBox && !S.listBox.hidden) renderSegs(); } }).catch(() => {});
  }
  try {
    const pre = S.pre; S.pre = null;
    const r = await (!quiet && pre && pre.k === 'list' ? pre.p : api('orders:list', listParams(S.Q, kind.background ? { bg: 1 } : undefined)));
    if (my !== S.seq) return;
    S.data = r;
    u.live.loaded(r.stamp);
    if (quiet && prev && prev.page === r.page) S.flashIds = changedIds(prev.rows, r.rows);
    for (const row of r.rows) if (S.sel.has(row.id)) S.sel.set(row.id, row);   // zaznaczenie zostaje, z aktualnym statusem
    // strona poza zakresem (np. po zawężeniu filtra) → ostatnia strona
    const pages = Math.max(1, Math.ceil((r.total || 0) / (r.pageSize || 50)));
    if (S.Q.page > pages && r.total > 0) { setQ({ page: pages }, true); return; }
  } catch (e) {
    if (my !== S.seq) return;
    S.err = isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać zamówień.');
  }
  S.loading = false;
  u.results.classList.remove('fade');
  if (quiet) keepScroll(() => renderList()); else renderList();
  S.flashIds = null;
}

/** Przebudowa tabeli bez skoku: przewinięcie strony i poziome przewinięcie tabeli zostają. */
function keepScroll(fn) {
  const y = window.scrollY, wrap = S.ui.results.querySelector('.table-wrap'), x = wrap ? wrap.scrollLeft : 0;
  fn();
  const w2 = S.ui.results.querySelector('.table-wrap');
  if (w2 && x) w2.scrollLeft = x;
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(window.scrollX, y);
}

const COLS = [
  { key: 'nr', label: 'Nr i status', tip: 'Numer zamówienia, data złożenia, status w Selly oraz stan płatności (opłacone / nieopłacone). Kliknij Nr, Data lub Status, aby sortować.', tipHeader: true, sorts: [
    { label: 'Nr', sort: 'number', tip: 'Sortuj po numerze zamówienia' }, { label: 'Data', sort: 'date', firstDir: 'desc', tip: 'Sortuj po dacie i godzinie złożenia' }, { label: 'Status', sort: 'status', tip: 'Sortuj po statusie zamówienia' }] },
  { key: 'client', label: 'Klient', tip: 'Nazwisko klienta (z faktury), firma i miasto. Najedź na nazwisko, aby zobaczyć e-mail i telefon. Plakietki: dane z notatki orszaku klienta.', tipHeader: true },
  { key: 'items', label: 'Zamówione produkty', tip: 'Produkty z zamówienia z ilościami (jak w Selly). Po trzech pozycjach reszta jest zwinięta.', tipHeader: true },
  { key: 'total', label: 'Wartość', sort: 'total', num: true, tip: 'Wartość zamówienia z dostawą, w złotych; pod spodem koszt dostawy i sposób płatności', tipHeader: true },
  { key: 'info', label: 'Informacje dodatkowe', tip: 'Komentarz klienta, uwaga do zamówienia i numer przesyłki (jeśli są)', tipHeader: true },
];

const parseItems = r => {
  try { const a = JSON.parse(r.itemsJson || ''); if (Array.isArray(a) && a.length) return a.map(x => ({ n: x.n, q: x.q, ph: x.ph })); } catch (e) { /* brak danych strukturalnych */ }
  return String(r.productsText || '').split(' • ').filter(Boolean).map(t => { const m = t.match(/^(.*) × (\d+)$/); return m ? { n: m[1], q: Number(m[2]) } : { n: t, q: null }; });
};
const thumbsOn = () => store('osa-ord-thumbs') !== 0;
const thumbS = x => { const t = thumb(photoSrc(x.ph, adminUrl()), x.n, 32); t.classList.add('thumb-s'); return t; };
function itemsCell(r) {
  const items = parseItems(r), total = Number(r.itemCount) || items.length;
  const li = x => el('li', null, thumbsOn() ? thumbS(x) : null, el('span', { class: 'nm' }, x.n), ' ', x.q != null ? el('span', { class: 'q' }, '× ' + x.q) : null);
  const shown = items.slice(0, 3), rest = items.slice(3);
  const ul = el('ul', { class: 'ord-items', title: r.productsText || null }, shown.map(li));
  const hidden = Math.max(0, total - 3);
  if (hidden > 0) {
    const more = el('button', { type: 'button', class: 'more', title: rest.length ? 'Pokaż pozostałe pozycje zamówienia' : 'Pozostałe pozycje zobaczysz w szczegółach zamówienia',
      onclick: ev => { ev.stopPropagation(); if (!rest.length) { openOrder(r.id); return; } more.remove(); ul.append(...rest.map(li)); } }, '+ ' + cnt(hidden, 'pozycja', 'pozycje', 'pozycji') + ' więcej');
    ul.append(el('li', null, more));
  }
  return ul;
}
function paidBadge(r) {
  const paid = Number(r.paid) || 0, total = Number(r.total) || 0;
  if (total > 0 && paid >= total - 0.01) return el('span', { class: 'ord-ico yes', title: 'Zamówienie opłacone w całości (wpłacono ' + money(paid) + ' zł)' }, '✓ opłacone');
  if (paid > 0) return el('span', { class: 'ord-ico', title: 'Wpłacono ' + money(paid) + ' z ' + money(total) + ' zł' }, '◐ częściowo');
  return el('span', { class: 'ord-ico no', title: 'Brak wpłaty w Selly (dla płatności przy odbiorze to normalne)' }, '✗ nieopłacone');
}

function renderList() {
  const u = S.ui, Q = S.Q;
  if (S.only && !S.sel.size) S.only = false;
  // Widok „tylko zaznaczone” (z paska „Zaznaczono… · Pokaż zaznaczone”): wszystkie zaznaczone, także z innych stron, bez stronicowania
  const d = S.only && S.data ? { ...S.data, rows: [...S.sel.values()] } : S.data;
  if (S.err && !d) {
    u.info.textContent = '';
    u.results.replaceChildren(el('div', { class: 'empty error' }, S.err, ' ', sellyLink('Panel Selly ↗', adminUrl() + '?a=zamowienia', 'Otwiera listę zamówień w panelu Selly w nowej karcie'),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => loadList() }, 'Spróbuj ponownie'))));
    renderBulk();
    return;
  }
  const size = d.pageSize || pageSize(), pages = Math.max(1, Math.ceil(d.total / size));
  u.info.replaceChildren(d.sumTotal != null ? el('span', { class: 'tip', id: 'ordSum', title: 'Suma wartości wszystkich zamówień pasujących do filtrów (nie tylko tej strony), z kosztami dostawy' }, 'Suma na liście: ' + money(d.sumTotal) + ' zł') : null);
  const cols = COLS.filter(c => u.colMenu.isOn(c.key));
  const head = el('tr', null,
    el('th', { class: 'c' }, el('input', { type: 'checkbox', id: 'ordSelAll', 'aria-label': 'Zaznacz wszystkie na tej stronie', title: 'Zaznacz lub odznacz wszystkie zamówienia na tej stronie',
      onchange: ev => { for (const r of d.rows) { if (ev.target.checked) S.sel.set(r.id, r); else S.sel.delete(r.id); } refreshSel(); } })),
    cols.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir }))));
  const body = el('tbody');
  const cell = (key, td) => (u.colMenu.isOn(key) ? td : null);
  for (const r of d.rows) {
    const nm = fullName(r.firstName, r.lastName), name = nm || r.company || r.email || '—';
    const contact = [r.email, r.phone].filter(Boolean).join('\n');
    const deliv = r.delivery ? r.delivery + (Number(r.deliveryPrice) ? ' (' + money(r.deliveryPrice) + ' zł)' : '') : '';
    const tr = el('tr', { class: 'pick' + (S.sel.has(r.id) ? ' sel' : '') + (S.flashIds && S.flashIds.has(String(r.id)) ? ' live-chg' : ''), 'data-id': r.id, onclick: tapOpen(() => openOrder(r.id)) },
      el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Zaznacz zamówienie ' + r.number, checked: S.sel.has(r.id), onchange: ev => { if (ev.target.checked) S.sel.set(r.id, r); else S.sel.delete(r.id); refreshSel(); } })),
      el('td', null, el('div', { class: 'ord-cell-no' },
        el('a', { href: '#/zamowienia/' + encodeURIComponent(r.id), class: 'big-id ord-no', title: 'Otwórz zamówienie', onclick: () => { S.listHash = location.hash; } }, r.number || r.id),
        el('div', { class: 'ord-meta nw', title: 'Data i godzina złożenia zamówienia' }, dateStr(r.date)),
        statusPill(r.statusId), paidBadge(r))),
      cell('client', el('td', null, el('div', { title: contact || null }, el('div', { class: 'cell-name' }, name), r.company && nm ? el('div', { class: 'cell-sub' }, r.company) : null,
        r.city ? el('div', { class: 'cell-sub', title: 'Miasto z danych zamówienia' }, r.city) : null),
        osaBadges(r, patch => setQ(patch), true, S.meta && S.meta.facets))),
      cell('items', el('td', { class: 'ord-prods' }, itemsCell(r))),
      el('td', { class: 'n' }, el('div', { class: 'ord-sum nw' }, money(r.total) + ' zł'),
        deliv ? el('div', { class: 'cell-sub', title: 'Sposób i koszt dostawy' }, deliv) : null,
        r.payment ? el('div', { class: 'cell-sub', title: 'Sposób płatności' }, r.payment) : null),
      cell('info', el('td', null, el('div', { class: 'ord-info-cell' },
        r.comment ? el('div', { class: 'note', title: 'Komentarz klienta: ' + r.comment }, '💬 ' + r.comment) : null,
        r.attention ? el('div', { class: 'note attn', title: 'Uwaga do zamówienia: ' + r.attention }, '⚠ ' + r.attention) : null,
        r.tracking ? el('div', { class: 'cell-sub', title: 'Numer przesyłki' }, '📦 ' + r.tracking) : null))));
    body.append(tr);
  }
  const filtered = anyFilter(Q, osaActive(Q));
  if (!d.rows.length) {
    // Pusty wynik: podpowiedz kolejny krok — zwolnij któryś z filtrów (każdy przycisk usuwa jeden warunek) albo wyczyść wszystko
    const cl = clausesOf(Q, { statusName, payName: id => nameIn(S.meta.payments, id), deliveryName: id => nameIn(S.meta.deliveries, id), osaOn: osaActive(Q), osaClear: OSA_CLEAR });
    body.append(el('tr', null, el('td', { colspan: String(cols.length + 1), class: 'empty', id: 'ordEmpty' },
      filtered ? 'Brak zamówień pasujących do wybranych filtrów.' : 'Brak zamówień. Nowe zamówienia ze sklepu pojawią się tu same (panel sprawdza Selly co minutę).',
      filtered ? el('div', { class: 'fx-relax' }, el('span', { class: 'muted small' }, 'Spróbuj poluzować filtry:'),
        ...cl.map(c => el('button', { type: 'button', class: 'chip', title: 'Usuń ten warunek i pokaż więcej zamówień', onclick: () => setQ(c.clear) }, 'Usuń: ' + c.name)),
        el('button', { type: 'button', class: 'secondary', onclick: () => setQ(CLEAR_ALL()) }, 'Wyczyść filtry')) : null)));
  }
  const pg = pager({ prefix: 'ord', page: Q.page, pages, total: d.total, noun: ['zamówienie', 'zamówienia', 'zamówień'], onPage: p => setQ({ page: p }),
    sizes: SIZES, size: pageSize(), onSize: n => { store('osa-ord-size', n); setQ({}); } });
  u.results.replaceChildren(
    S.err ? el('div', { class: 'notice error' }, S.err) : null,
    S.only ? el('div', { class: 'notice info', id: 'ordOnlySel', role: 'status' }, 'Pokazuję tylko zaznaczone (' + d.rows.length + ') — ze wszystkich stron. ',
      el('button', { type: 'button', class: 'link', onclick: () => { S.only = false; renderList(); } }, 'Wróć do listy')) : null,
    el('div', { class: 'table-wrap' }, el('table', { id: 'ordTable', class: 'rich' }, el('thead', null, head), body)), S.only ? null : pg);
  renderBulk();
  refreshSel();
}

function openOrder(id) { S.listHash = location.hash; go('/zamowienia/' + encodeURIComponent(id)); }

// ─── Zaznaczenie i akcje masowe ─────────────────────────────────────────────

function refreshSel() {
  const u = S.ui, d = S.data;
  if (d) {
    for (const tr of u.results.querySelectorAll('tbody tr[data-id]')) {
      const on = S.sel.has(tr.dataset.id);
      tr.classList.toggle('sel', on);
      const cb = tr.querySelector('input[type=checkbox]'); if (cb) cb.checked = on;
    }
    const all = u.results.querySelector('#ordSelAll');
    const ids = [...u.results.querySelectorAll('#ordTable tbody tr[data-id]')].map(t => t.dataset.id);
    if (all) { const n = ids.filter(id => S.sel.has(id)).length; all.checked = ids.length > 0 && n === ids.length; all.indeterminate = n > 0 && n < ids.length; }
  }
  renderBulk();
}

function renderBulk() {
  const u = S.ui, n = S.sel.size;
  u.bulk.hidden = n === 0;
  if (!n) { u.bulk.replaceChildren(); return; }
  const rows = [...S.sel.values()];
  const pageIds = [...u.results.querySelectorAll('#ordTable tbody tr[data-id]')].map(t => t.dataset.id);
  const off = S.only ? 0 : rows.filter(r => !pageIds.includes(String(r.id))).length;
  u.bulk.replaceChildren(
    el('span', null, el('strong', { id: 'ordSelCount' }, 'Zaznaczono: ' + n),
      selOffNote({ prefix: 'ord', off, only: S.only, onShow: () => { S.only = true; renderList(); }, onBack: () => { S.only = false; renderList(); },
        onUnselOff: () => { for (const k of [...S.sel.keys()]) if (!pageIds.includes(String(k))) S.sel.delete(k); refreshSel(); } })),
    menuButton({ id: 'ordStatusMenu', label: 'Zmień status', cls: 'primary', write: ['zamowienia', 'przesylki'], title: 'Ustaw wybrany status dla wszystkich zaznaczonych zamówień (przed zmianą pokażemy podsumowanie do potwierdzenia)',
      items: () => S.meta.statuses.map(s => ({ label: s.name, title: 'Ustaw status „' + s.name + '” dla zaznaczonych zamówień', run: () => startStatusChange(u.dlg, rows, String(s.id), onStatusDone) })) }),
    el('button', { type: 'button', class: 'secondary', id: 'ordCopyNums', title: 'Kopiuje numery zaznaczonych zamówień, po jednym w wierszu',
      onclick: () => copyToClipboard(rows.map(r => r.number).join('\n'), null, 'Skopiowano ' + cnt(n, 'numer', 'numery', 'numerów'), '') }, 'Kopiuj numery'),
    el('button', { type: 'button', class: 'secondary', id: 'ordPickList', title: 'Otwiera widok do druku: zbiorcza lista produktów z zaznaczonych zamówień (do zbierania z półek) i kartki pakowania, po jednej na zamówienie (do 100 zamówień)',
      onclick: () => go('zamowienia/kompletacja?ids=' + rows.slice(0, 100).map(r => r.id).join(',')) }, 'Lista kompletacyjna'),
    el('button', { type: 'button', class: 'ghost', id: 'ordSelClear', title: 'Odznacz wszystkie zaznaczone zamówienia (na wszystkich stronach)', onclick: () => { S.sel.clear(); refreshSel(); } }, 'Wyczyść zaznaczenie'));
}

function onStatusDone(doneIds) {
  for (const id of doneIds) S.sel.delete(id);
  api('orders:meta').then(m => { S.meta = m; if (S.listBox && !S.listBox.hidden) renderSegs(); }).catch(() => {});
  loadList();
}

// ─── Zmiana statusu (1 lub wiele zamówień; porcje + postęp + ponowienie) ─────

/** orders: [{ id, number, statusId }]; host: element, w którym pokazujemy potwierdzenie, postęp i podsumowanie. */
function startStatusChange(host, orders, targetId, onDone) {
  const target = statusName(targetId);
  const todo = orders.filter(o => String(o.statusId) !== String(targetId));
  const skipped = orders.length - todo.length;
  if (!todo.length) { flash('', 'Wszystkie wybrane zamówienia mają już status „' + target + '”.'); return; }
  const numOf = new Map(orders.map(o => [String(o.id), o.number || o.id]));
  const byStatus = new Map();
  for (const o of todo) byStatus.set(String(o.statusId), (byStatus.get(String(o.statusId)) || 0) + 1);
  const from = [...byStatus].map(([id, n]) => statusName(id) + ' (' + n + ')').join(', ');
  const close = () => host.replaceChildren();
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Zmiana statusu zamówień' });
  host.replaceChildren(box);
  const doneAll = [];

  const confirmStep = () => box.replaceChildren(
    el('h3', null, 'Zmienić status ' + cnt(todo.length, 'zamówienie', 'zamówienia', 'zamówień') + '?'),
    el('p', null, 'Z: ', el('strong', null, from), el('br'), 'Na: ', statusPill(targetId, target)),
    skipped ? el('p', { class: 'muted small' }, skipped + ' ' + plural(skipped, 'zamówienie ma', 'zamówienia mają', 'zamówień ma') + ' już ten status — pominięto.') : null,
    el('p', { class: 'muted small' }, 'Zmiana zostanie zapisana w Selly (może uruchomić powiadomienia dla klientów, jeśli tak skonfigurowano status).'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', id: 'ordCancel', onclick: close }, 'Anuluj'),
      gateWrite(el('button', { type: 'button', class: 'primary', id: 'ordConfirm', onclick: () => run(todo.map(o => String(o.id))) }, 'Zmień status na „' + target + '”'), ['zamowienia', 'przesylki'])));

  async function run(ids) {
    const batch = Math.max(1, Number(S.meta && S.meta.maxStatusBatch) || 50);
    const bar = el('progress', { max: String(ids.length), value: '0', id: 'ordProgress', 'aria-label': 'Postęp zmiany statusu' });
    const label = el('div', { class: 'muted small', role: 'status' }, 'Zapisuję: 0 z ' + ids.length);
    box.replaceChildren(el('h3', null, 'Zmieniam status na „' + target + '”…'), bar, label);
    const { done, failed } = await setStatusInChunks(api, ids, targetId, { batch, onProgress: (n, all) => { bar.value = n; label.textContent = 'Zapisuję: ' + n + ' z ' + all; } });
    doneAll.push(...done);
    summary(failed);
    if (done.length && onDone) onDone(done);
  }

  function summary(failed) {
    box.replaceChildren(
      el('h3', null, failed.length ? 'Zmiana statusu zakończona z błędami' : 'Status zmieniony'),
      el('p', { id: 'ordSummary' }, 'Zmieniono: ', el('strong', null, String(doneAll.length)), ' · nieudane: ', el('strong', null, String(failed.length))),
      failed.length ? el('ul', { class: 'ord-fails' }, failed.slice(0, 20).map(f => el('li', null, el('strong', null, numOf.get(f.id) || f.id), ' — ' + f.error)),
        failed.length > 20 ? el('li', { class: 'muted' }, '… i ' + (failed.length - 20) + ' więcej') : null) : null,
      el('div', { class: 'ord-actions' },
        failed.length ? el('button', { type: 'button', class: 'primary', id: 'ordRetry', title: 'Spróbuj ponownie tylko dla zamówień, którym nie udało się zmienić statusu', onclick: () => run(failed.map(f => f.id)) }, 'Ponów nieudane (' + failed.length + ')') : null,
        el('button', { type: 'button', class: 'secondary', id: 'ordClose', onclick: close }, 'Zamknij')));
  }
  confirmStep();
  box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
}

// ─── Eksport ────────────────────────────────────────────────────────────────

function exportTable(rows) {
  return {
    file: 'zamowienia', sheet: 'Zamówienia',
    columns: [
      { header: 'Numer', type: 'text' }, { header: 'Data', type: 'text' }, { header: 'Status', type: 'text' }, { header: 'Imię i nazwisko', type: 'text' }, { header: 'Firma', type: 'text' },
      { header: 'E-mail', type: 'text' }, { header: 'Telefon', type: 'text' }, { header: 'Miasto', type: 'text' }, { header: 'Dostawa', type: 'text' }, { header: 'Płatność', type: 'text' },
      { header: 'Zapłacono', type: 'center' }, { header: 'Nr przesyłki', type: 'text' }, { header: 'Wartość (zł)', type: 'number' }, { header: 'Pozycji', type: 'number' }, { header: 'Komentarz klienta', type: 'text' }, { header: 'Zamówione produkty', type: 'text' },
      { header: 'Województwo', type: 'text' }, { header: 'Rodzaj podmiotu', type: 'text' }, { header: 'Tytuł orszaku', type: 'text' }, { header: 'Tagi', type: 'text' }, { header: 'Licencja → woj.', type: 'text' },
    ],
    rows: rows.map(r => [r.number, dateStr(r.date), statusName(r.statusId), fullName(r.firstName, r.lastName), r.company || '', r.email || '', r.phone || '', r.city || '', r.delivery || '', r.payment || '',
      r.paid ? 'tak' : 'nie', r.tracking || '', r.total == null ? '' : Number(r.total), r.itemCount == null ? '' : r.itemCount, r.comment || '', r.productsText || '',
      osaExport(r).woj, osaExport(r).kind, osaExport(r).title, osaExport(r).tags, licenseExport(r)]),
  };
}
const saveTable = (t, kind) => (kind === 'xlsx' ? downloadXlsx(t, '') : downloadCsv(tableMatrix(t), t.file, ''));

async function exportAll(kind) {
  try {
    const { rows: part, total } = await fetchAllRows(page => api('orders:list', listParams(S.Q, { page, pageSize: 200 })), EXPORT_MAX, 'zamówienia');
    saveTable(exportTable(part), kind);
    if (total > EXPORT_MAX) flash('', 'Plik zawiera pierwsze ' + EXPORT_MAX + ' z ' + total + ' zamówień — zawęź filtry, aby dostać resztę');
  } catch (e) { flash('', 'Nie udało się pobrać zamówień: ' + (e.message || 'błąd')); }
}

function exportItems() {
  const sel = [...S.sel.values()], total = S.data ? S.data.total : 0, tot = Math.min(total, EXPORT_MAX);
  const noSel = 'Najpierw zaznacz zamówienia w tabeli';
  return [
    { label: 'Zaznaczone — Excel (.xlsx)', count: sel.length, title: sel.length ? 'Arkusz z zaznaczonymi zamówieniami' : noSel, run: () => saveTable(exportTable(sel), 'xlsx') },
    { label: 'Zaznaczone — CSV (.csv)', count: sel.length, title: sel.length ? 'Plik tekstowy (separator „;”, UTF-8) z zaznaczonymi zamówieniami' : noSel, run: () => saveTable(exportTable(sel), 'csv') },
    { label: 'Cały wynik filtra — Excel (.xlsx)', count: tot, title: 'Wszystkie zamówienia pasujące do bieżących filtrów, nie tylko ta strona', run: () => exportAll('xlsx') },
    { label: 'Cały wynik filtra — CSV (.csv)', count: tot, title: 'Wszystkie zamówienia pasujące do bieżących filtrów, nie tylko ta strona', run: () => exportAll('csv') },
  ];
}

// ─── Szczegóły ──────────────────────────────────────────────────────────────

const textVal = v => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(textVal).filter(Boolean).join(', ') : Object.entries(v).map(([k, x]) => k + ': ' + textVal(x)).join(', ')) : String(v));

async function renderDetail(id) {
  const my = ++S.routeSeq, box = S.detailBox;
  box.replaceChildren(el('div', { class: 'card' }, loadingBox('Pobieram zamówienie…')));
  let r;
  const pre = S.pre; S.pre = null;
  try { r = await (pre && pre.k === 'get' && pre.id === String(id) ? pre.p : api('orders:get', { id })); } catch (e) {
    if (my !== S.routeSeq) return;
    box.replaceChildren(isUnavailable(e) ? unavailableBox() : el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się pobrać zamówienia: ' + (e.message || 'błąd'),
      el('div', null, el('a', { href: S.listHash, class: 'btn-link' }, '← Wróć do listy'), ' ', el('button', { type: 'button', class: 'secondary', onclick: () => renderDetail(id) }, 'Spróbuj ponownie')))));
    return;
  }
  if (my !== S.routeSeq) return;
  const o = r.order || {}, products = o.products || [];
  const number = o.number || o.order_number || ('#' + id);
  noteVisit({ t: 'order', id, label: String(number) });
  const dlg = el('div', { id: 'ordDetailDlg' });
  const reload = () => { api('orders:meta').then(m => { S.meta = m; }).catch(() => {}).then(() => { if (my === S.routeSeq) renderDetail(id); }); };
  let card = null;
  const stId = String(o.status_id != null ? o.status_id : '');
  const order1 = [{ id: String(id), number, statusId: stId }];
  const statusMenu = menuButton({ id: 'ordDetailStatus', label: 'Zmień status', cls: 'secondary', title: 'Ustaw inny status tego zamówienia (przed zmianą pokażemy potwierdzenie)',
    items: () => S.meta.statuses.map(s => ({ label: s.name, title: String(s.id) === stId ? 'Aktualny status' : 'Ustaw status „' + s.name + '”', run: () => { if (card && card.C.dirty() && !confirm('W karcie są niezapisane zmiany — zmiana statusu przeładuje kartę i je odrzuci. Kontynuować?')) return; startStatusChange(dlg, order1, String(s.id), () => { S.sel.delete(String(id)); S.data = null; reload(); }); } })) });

  const moves = r.moves || [];
  const MOVE = { przyjecie: 'Przyjęcie', przesuniecie: 'Przesunięcie', wydanie: 'Wydanie', korekta: 'Korekta' };
  const movesCard = moves.length ? el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Ruchy magazynowe'), el('div', { class: 'sub' }, 'Wydania i inne ruchy zapisane w panelu OSA dla tego zamówienia.')),
    el('div', { class: 'table-wrap' }, el('table', { id: 'ordMoves' }, el('thead', null, el('tr', null, ['Czas', 'Rodzaj', 'Produkt', 'Ilość', 'Autor'].map(h => el('th', null, el('span', { title: h }, h))))),
      el('tbody', null, moves.map(m => el('tr', null, el('td', { class: 'nw' }, m.time || (m.ms ? dateStr(new Date(m.ms).toISOString()) : '')), el('td', null, MOVE[m.type] || m.type || ''),
        el('td', null, m.productName || m.productId || ''), el('td', { class: 'n' }, String(m.qty == null ? '' : m.qty)), el('td', null, m.author || '')))))) ) : null;

  const events = r.events;
  const evKey = (e, ks) => { for (const k of ks) if (e[k] != null && e[k] !== '') return e[k]; return ''; };
  const eventsCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Historia zdarzeń')),
    r.eventsError || events == null ? el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać historii zdarzeń z Selly' + (r.eventsError ? ' (' + textVal(r.eventsError) + ')' : '') + '. Reszta danych zamówienia jest aktualna.')
      : events.length ? el('ul', { class: 'ord-events', id: 'ordEvents' }, events.map(e => el('li', null,
        el('span', { class: 'muted nw' }, dateStr(evKey(e, ['date', 'created', 'created_at', 'time', 'datetime']))), ' ',
        el('strong', null, textVal(evKey(e, ['event_type', 'name', 'type', 'title', 'event', 'status_name', 'action']))), ' ',
        el('span', null, textVal(evKey(e, ['description', 'text', 'comment', 'message', 'content']))), ' ',
        evKey(e, ['user', 'author', 'admin', 'user_name']) ? el('span', { class: 'muted' }, '· ' + textVal(evKey(e, ['user', 'author', 'admin', 'user_name']))) : null)))
        : el('div', { class: 'empty' }, 'Brak zdarzeń dla tego zamówienia.'));

  card = buildOrderCard({ id, order: o, meta: S.meta, sellyUrl: sellyOrderUrl(id), onSaved: () => { S.data = null; } });
  S.guard = () => card.C.dirty();
  const osaHost = el('div', { id: 'ordOsaCard' });
  fillOsa(osaHost, o, number, my);
  box.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'ord-detail-top' },
        el('a', { href: S.listHash, class: 'btn-link', id: 'ordBack', title: 'Wróć do listy z zachowanymi filtrami, wyszukiwaniem i stroną', }, '← Wróć do listy'),  // potwierdzenie przy niezapisanych zmianach — strażnik routera
        el('span', { class: 'spacer' }),
        freshLabel(r),
        el('button', { type: 'button', class: 'ghost live-btn', id: 'ordDetailRefresh', title: 'Pobierz to zamówienie z Selly jeszcze raz',
          onclick: () => { if (card && card.C.dirty() && !confirm('W karcie są niezapisane zmiany — odświeżenie je odrzuci. Kontynuować?')) return; renderDetail(id); } }, '↻ Odśwież'),
        sellyLink('Otwórz w panelu Selly ↗', sellyOrderUrl(id), 'Otwiera to zamówienie w panelu administracyjnym Selly')),
      el('div', { class: 'card-head' }, el('h2', { id: 'ordTitle' }, 'Zamówienie ' + number), el('div', { class: 'sub' }, dateStr(o.date))),
      el('div', { class: 'ord-detail-status' }, 'Status: ', statusPill(stId, o.status_name || statusName(stId)), statusMenu, el('span', { class: 'spacer' }), card.toggle),
      dlg),
    card.notes,
    el('div', { class: 'ord-grid' }, card.grid),
    card.items, card.totals, card.invoices, card.sellyOnly,
    osaHost, movesCard, eventsCard);
}

/** „odświeżono teraz” (zamówienie pobrane z Selly przy otwarciu karty) albo „dane z HH:MM” (kopia panelu — z powodem). */
function freshLabel(r) {
  const hm = ms => new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (r.liveMs) {
    return el('span', { class: 'muted small tip', id: 'ordFresh', 'data-live': '1', title: 'Zamówienie pobrane z Selly przy otwarciu karty (' + new Date(r.liveMs).toLocaleTimeString('pl-PL') + ') — dane są aktualne.' + (r.changed ? ' Kopia w panelu została przy tym zaktualizowana.' : '') },
      Date.now() - r.liveMs < 60000 ? 'odświeżono teraz' : 'odświeżono o ' + hm(r.liveMs));
  }
  const when = r.syncedMs ? new Date(r.syncedMs).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  return el('span', { class: 'muted small tip', id: 'ordFresh', 'data-live': '0', title: (r.liveError || 'Nie udało się teraz zapytać Selly.') + ' Pokazujemy kopię zamówienia z panelu (synchronizowaną z Selly co minutę).' },
    'dane z ' + when);
}

/** Sekcja „Orszak (z notatki)”: dane klienta przypisanego do zamówienia (wiersz z listy zamówień ma dołączone pola notatki). */
async function fillOsa(host, o, number, my) {
  let row = S.data && S.data.rows.find(x => String(x.number) === String(number));
  if (!row) { try { const r = await api('orders:list', { q: String(number), pageSize: 10 }); row = r.rows.find(x => String(x.number) === String(number)) || null; } catch (e) { row = null; } }
  if (my !== S.routeSeq) return;
  const head = el('div', { class: 'card-head' }, el('h2', null, 'Orszak (z notatki)'), el('div', { class: 'sub' }, 'Dane z notatki klienta przypisanego do zamówienia'));
  if (!row || !row.clientId) { host.replaceChildren(el('div', { class: 'card' }, head, el('p', { class: 'muted', id: 'ordOsaNone' }, 'To zamówienie nie jest powiązane z klientem z notatką (np. zakup bez konta), więc nie ma danych orszaku.'))); return; }
  const pairs = osaDetailPairs(row);
  if (Number(row.hasLicense)) pairs.push(['Licencja → woj.', licenseExport(row), 'Zamówienie z licencją: województwo z notatki albo przybliżone z kodu pocztowego dostawy']);
  const dlEl = dl(pairs);
  host.replaceChildren(el('div', { class: 'card' }, head, dlEl.children.length ? dlEl : el('p', { class: 'muted', id: 'ordOsaNone' }, 'Klient nie ma w notatce danych orszaku.'),
    el('a', { href: '#/klienci/' + encodeURIComponent(row.clientId), class: 'btn-link', title: 'Otwiera kartę klienta przypisanego do zamówienia' }, 'Karta klienta →')));
}

// ─── Trasa ──────────────────────────────────────────────────────────────────

function show(which) {
  S.metaBox.hidden = which !== 'meta';
  if (S.listBox) S.listBox.hidden = which !== 'list';
  S.detailBox.hidden = which !== 'detail';
}

async function mountRoute() {
  const route = S.route, my = ++S.routeSeq;
  if (!S.meta) {
    show('meta');
    S.metaBox.replaceChildren(el('div', { class: 'card' }, loadingBox('Wczytuję zamówienia…')));
    // lista / karta startują równolegle z orders:meta (bez dodatkowej rundy); renderują się po obu odpowiedziach
    S.pre = null;
    if (route.id) S.pre = { k: 'get', id: String(route.id), p: api('orders:get', { id: route.id }) };
    else { S.Q = route.Q; S.pre = { k: 'list', p: api('orders:list', listParams(S.Q)) }; }
    S.pre.p.catch(() => {});
    await ensureMeta();
    if (my !== S.routeSeq) return;
    if (!S.meta) {
      S.pre = null;
      S.metaBox.replaceChildren(S.metaErr && isUnavailable(S.metaErr) ? unavailableBox() : unavailableBox(S.metaErr ? 'Nie udało się otworzyć zamówień: ' + S.metaErr.message : MSG_UNAVAILABLE));
      return;
    }
  }
  if (!S.ui.search) buildList();
  registerListKeys({ screen: 'zamowienia', table: 'ordTable', filters: 'ordFiltersBtn', export: 'ordExport', cols: 'ordColsBtn', search: 'ordSearch', back: 'ordBack', select: true });
  S.guard = null;
  if (route.id) { S.ui.live.stop(); show('detail'); renderDetail(route.id); return; }
  show('list');
  S.ui.live.start();
  S.Q = route.Q;
  S.listHash = location.hash || '#/zamowienia';
  loadList();
}

export default {
  id: 'zamowienia',
  title: 'Zamówienia',
  routes: ['', '<id>'],
  mount(el0, params) {
    applyBadgePrefs();
    if (!S.root) {
      S.root = el0;
      S.metaBox = el('div'); S.detailBox = el('div'); S.metaBox.hidden = S.detailBox.hidden = true;
      el0.append(S.metaBox, S.detailBox);
    }
    S.route = { id: params && params.parts && params.parts[0] || '', Q: readQ(params && params.query) };
    if (showPick(el0, S.route.id === 'kompletacja', params && params.query) && S.route.id === 'kompletacja') { S.routeSeq++; S.guard = null; showInvoices(el0, false); showNewOrder(el0, false); show(''); if (S.ui.live) S.ui.live.stop(); return; }   // #/zamowienia/kompletacja?ids=… → zamowieniaKompletacja.js
    showInvoices(el0, S.route.id === 'faktury');   // #/zamowienia/faktury → zamowieniaFaktury.js
    if (S.ui.live && (S.route.id === 'faktury' || S.route.id === 'nowe')) S.ui.live.stop();
    if (S.route.id === 'faktury') { S.routeSeq++; S.guard = null; showNewOrder(el0, false); show(''); return; }
    if (showNewOrder(el0, S.route.id === 'nowe') && S.route.id === 'nowe') { S.routeSeq++; S.guard = null; show(''); return; }   // #/zamowienia/nowe → zamowienieNowe.js
    mountRoute();
  },
  unmount() { S.seq++; S.routeSeq++; S.guard = null; if (S.ui.live) S.ui.live.stop(); },
};
