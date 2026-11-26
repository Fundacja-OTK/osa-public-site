// Moduł „Zamówienia”: lista z filtrami i akcjami masowymi (#/zamowienia?status=..&q=..&page=..), szczegóły (#/zamowienia/<id>) i lista faktur (#/zamowienia/faktury).
// Lista = wspólny komponent core/listView.js (tabela, sortowanie, strony, zaznaczenie z dolnym paskiem, stan w adresie, świeżość).
// Dane i zapisy: backend Cloudflare (akcje orders:meta, orders:list, orders:get, orders:setStatus).
import { payState } from '../lib/payState.js?v=9e50e6d';
import { itemsCell, commentsCell, commentColumns, deliveryTag, paymentTag, viewControls, normView, priceLevelName } from '../lib/orderCells.js?v=9e50e6d';
import { applyPrefs } from '../lib/orderCells.js?v=9e50e6d';
import { photoSrc } from '../core/photo.js?v=9e50e6d';
import { gateWrite, el, plural, store, flash, menuButton, downloadXlsx, downloadCsv, tableMatrix, copyToClipboard, money, dateStr, fullName, cnt, isUnavailable, loadingBox, sellyLink, dl, fetchAllRows, multiSelect, dateRange, orderStatusTone } from '../core/ui.js?v=9e50e6d';
import { askConfirm } from '../core/confirm.js?v=9e50e6d';
import { setStatusInChunks } from '../lib/statusBatch.js?v=9e50e6d';
import { api, ctx } from '../core/client.js?v=9e50e6d';
import { go, setLeaveGuard } from '../core/router.js?v=9e50e6d';
import { noteVisit } from '../core/recents.js?v=9e50e6d';
import { registerListKeys } from '../core/listKeys.js?v=9e50e6d';
import { changedIds } from '../core/liveRefresh.js?v=9e50e6d';
import { cachedRead } from '../core/cache.js?v=9e50e6d';
import { listView } from '../core/listView.js?v=9e50e6d';
import { parseOrderQuery, yearNote } from '../core/recents.js?v=9e50e6d';
import * as LL from '../core/listLogic.js?v=9e50e6d';
import { buildOrderCard, productPicker } from './zamowieniaKarta.js?v=9e50e6d';
import { createFilterUi } from './zamowieniaFiltry.js?v=9e50e6d';
import { FKEYS, EMPTY_F, readFilters, writeFilters, filterParams, effectiveDateTo, clausesOf, anyFilter } from './zamFiltry.js?v=9e50e6d';
import { readOsa, writeOsa, osaParams, osaActive, osaBar, osaBadges, osaExport, licenseExport, osaDetailPairs, applyBadgePrefs, OSA_CLEAR } from '../core/osa.js?v=9e50e6d';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const SIZES = [25, 50, 100, 200];
const SIZE_STORE = 'osa-ord-size';
const NOUN = ['zamówienie', 'zamówienia', 'zamówień'];
const EXTRA_CLEAR = { payment: '', delivery: '', product: '', pname: '', rfrom: '', rto: '' };
const CLEAR_ALL = () => ({ q: '', from: '', to: '', ...EXTRA_CLEAR, ...EMPTY_F, ...OSA_CLEAR });
// Eksport czyta z bazy panelu (nie z Selly — nie zużywa limitu API); górna granica tylko jako bezpiecznik
const EXPORT_MAX = 50000;
const MSG_UNAVAILABLE = 'Moduł Zamówienia wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = {
  root: null, metaBox: null, listBox: null, detailBox: null, ui: {}, lv: null,
  meta: null, metaErr: null, metaLoading: false,
  loading: false, pre: null,
  listHash: '#/zamowienia',  // ostatni adres listy (powrót ze szczegółów)
  routeSeq: 0, guard: null,
  touchedAt: 0, metaAt: 0, flashIds: null,   // świeżość: ostatnia interakcja z listą, ostatnie liczniki, wiersze do podświetlenia
};
const META_BG_MS = 5 * 60 * 1000;   // liczniki statusów w tle najwyżej co 5 min (skan tabeli); kliknięcie „Odśwież” — zawsze
window.addEventListener('beforeunload', ev => { if (S.guard && S.guard()) { ev.preventDefault(); ev.returnValue = ''; } });
// Ta sama ochrona przy przejściu w panelu (menu modułów, linki, Wstecz)
setLeaveGuard(() => (S.guard && S.guard() ? 'W karcie zamówienia są niezapisane zmiany. Opuścić ją i je odrzucić?' : null));

// ─── Pomocnicze ─────────────────────────────────────────────────────────────

const adminUrl = () => (S.meta && S.meta.adminUrl) || (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
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

// ─── Stan listy ↔ adres (listLogic: q, page, size, sort, dir + parametry zamówień w `extra`) ──────────

const PANEL_KEYS = ['payment', 'delivery', 'product', 'from', 'to', 'rfrom', 'rto', 'woj', 'kind', 'title', 'tag', 'lic', ...FKEYS];
const EXTRA = {
  read: g => ({ from: g('from'), to: g('to'), rfrom: g('rfrom'), rto: g('rto'), payment: g('payment'), delivery: g('delivery'), product: g('product'), pname: g('pname'), ...readFilters(g), ...readOsa(g) }),
  write: (Q, p) => {
    writeFilters(Q, p);
    if (Q.from) p.set('from', Q.from);
    if (Q.to) p.set('to', Q.to);
    if (Q.rfrom) p.set('rfrom', Q.rfrom);
    if (Q.rto) p.set('rto', Q.rto);
    if (Q.payment) p.set('payment', Q.payment);
    if (Q.delivery) p.set('delivery', Q.delivery);
    if (Q.product) { p.set('product', Q.product); if (Q.pname) p.set('pname', Q.pname); }
    writeOsa(Q, p);
  },
  clear: CLEAR_ALL(),
  active: Q => (anyFilter(Q, osaActive(Q)) ? 1 : 0),
  panel: Q => PANEL_KEYS.filter(k => Q[k]).length,   // „Filtry (3)”: płatność, dostawa, produkt, daty, dane z notatek, filtry złożone
};
// Te same sortowania co kolumny listy (odczyt stanu przed zbudowaniem listy — wczytanie równoległe z orders:meta)
const SPEC = { sorts: [{ key: 'number' }, { key: 'date', firstDir: 'desc' }, { key: 'status' }, { key: 'total', num: true }],
  defaultSort: { key: 'date', dir: 'desc' }, filters: [], sizes: SIZES, defaultSize: 50, extra: EXTRA };
const stateOf = query => LL.readState(k => (query && query.get(k)) || '', SPEC, store(SIZE_STORE));
/** Zapytanie adresu dla stanu (bez rozmiaru strony — zapisane widoki i linki go nie niosą). */
const qsOf = Q => LL.writeState({ filters: {}, page: 1, sort: 'date', dir: 'desc', ...Q, size: 0 }, SPEC);
const listParams = (Q, extra) => {
  const p = { sort: Q.sort, dir: Q.dir, pageSize: Q.size || 50, page: Q.page };
  Object.assign(p, filterParams(Q));
  if (Q.q) p.q = Q.q;
  if (Q.q && S.broad === Q.q) p.broad = 1;   // „pokaż też zawierające”: szukanie wielopolowe zamiast samego numeru
  if (Q.from) p.dateFrom = Q.from;
  const to = effectiveDateTo(Q.to, Q.older);
  if (to) p.dateTo = to;
  if (Q.rfrom) p.requiredFrom = Q.rfrom;
  if (Q.rto) p.requiredTo = Q.rto;
  if (Q.payment) p.paymentId = Q.payment;
  if (Q.delivery) p.deliveryId = Q.delivery;
  if (Q.product) p.productId = Q.product;
  return Object.assign(p, osaParams(Q), extra);
};
const curQ = () => S.lv.state;
/** Zmiana filtrów: nowy adres (cofnięcie przeglądarki wraca do poprzedniego widoku); replace — bez wpisu w historii. */
const setQ = (patch, replace) => S.lv.set(patch, replace ? { replace: true } : undefined);

// ─── Meta ───────────────────────────────────────────────────────────────────

async function ensureMeta() {
  if (S.meta) return true;
  if (S.metaLoading) return false;
  S.metaLoading = true; S.metaErr = null;
  try { S.meta = await cachedRead('orders:meta', {}, { personal: true }); S.metaAt = Date.now(); applyPrefs(S.meta.prefs); } catch (e) { S.metaErr = e; }
  S.metaLoading = false;
  return !!S.meta;
}
const countOf = id => { const c = S.meta.counts.find(x => String(x.id) === String(id)); return c ? Number(c.n) || 0 : 0; };

// ─── Lista: kolumny i komórki ───────────────────────────────────────────────

// Wygląd wierszy: wspólne komórki z Wysyłką SpeedMail (lib/orderCells.js); opcje widoku (zdjęcia, symbol, ceny) w Kolumny ▾ → „Widok produktów”
const VIEW_KEY = 'osa-ord-view';
S.view = normView(store(VIEW_KEY), store('osa-ord-thumbs') === 0);
const prefs = () => (S.meta && S.meta.prefs) || {};
const itemsOpts = { get view() { return S.view; }, photo: x => photoSrc(x.ph, adminUrl()), onMore: r => openOrder(r.id) };
function paidBadge(r) {
  const ps = payState(r.paid, r.total);
  return el('span', { class: 'ord-ico ' + ps.cls, title: ps.tip }, ps.label);
}
const COLS = [
  { key: 'nr', label: 'Nr i status', locked: true, tipHeader: true,
    tip: 'Numer zamówienia, data złożenia, status w Selly oraz stan płatności (opłacone / nieopłacone / nadpłata / niedopłata). Kliknij Nr, Data lub Status, aby sortować.',
    sorts: [{ label: 'Nr', sort: 'number', tip: 'Sortuj po numerze zamówienia' }, { label: 'Data', sort: 'date', firstDir: 'desc', tip: 'Sortuj po dacie i godzinie złożenia' }, { label: 'Status', sort: 'status', tip: 'Sortuj po statusie zamówienia' }],
    cell: r => el('div', { class: 'ord-cell-no' },
      el('a', { href: '#/zamowienia/' + encodeURIComponent(r.id), class: 'big-id ord-no', title: 'Otwórz zamówienie', onclick: () => { S.listHash = location.hash; } }, r.number || r.id),
      el('div', { class: 'ord-meta nw', title: 'Data i godzina złożenia zamówienia' }, dateStr(r.date)),
      statusPill(r.statusId), paidBadge(r)) },
  { key: 'client', label: 'Klient', def: false, tipHeader: true, tip: 'Nazwisko klienta (z faktury), firma i miasto. Najedź na nazwisko, aby zobaczyć e-mail i telefon. Plakietki: dane z notatki orszaku klienta.',
    cell: r => {
      const nm = fullName(r.firstName, r.lastName), contact = [r.email, r.phone].filter(Boolean).join('\n');
      return [el('div', { title: contact || null }, el('div', { class: 'cell-name' }, nm || r.company || r.email || '—'), r.company && nm ? el('div', { class: 'cell-sub' }, r.company) : null,
        r.city ? el('div', { class: 'cell-sub', title: 'Miasto z danych zamówienia' }, r.city) : null),
      osaBadges(r, patch => setQ(patch), true, S.meta && S.meta.facets)];
    } },
  { key: 'level', label: 'Poziom cen', def: false, tipHeader: true,
    tip: 'Poziom cen klienta z jego konta w Selly (detaliczny / hurtowy 1–3). Nazwy poziomów zmienisz w „Kolumny ▾ → Ustawienia listy…” (administrator). Puste = zamówienie bez konta klienta.',
    cell: r => { const n = priceLevelName(r.priceLevel, prefs().levels); return n ? el('span', { class: 'ord-lvl', title: 'Poziom cen klienta: ' + n + ' (poziom ' + r.priceLevel + ' w Selly)' }, n) : ''; } },
  { key: 'items', label: 'Zamówione produkty', cls: 'ord-prods', tipHeader: true, tip: 'Produkty z zamówienia z ilościami (jak w Selly). Po trzech pozycjach reszta jest zwinięta. Zdjęcia, symbol, cenę, wartość i rabat włączysz w „Kolumny ▾ → Widok produktów”.', cell: r => itemsCell(r, itemsOpts) },
  { key: 'total', label: 'Wartość', sort: true, num: true, locked: true, tipHeader: true, tip: 'Wartość zamówienia z dostawą, w złotych; pod spodem forma dostawy (🚚, z kosztem) i forma płatności (💳)',
    cell: r => [el('div', { class: 'ord-sum nw' }, money(r.total) + ' zł'),
      el('div', { class: 'ord-tags' }, deliveryTag(r.delivery, r.deliveryPrice), paymentTag(r.payment))] },
  { key: 'info', label: 'Informacje dodatkowe', def: false, tipHeader: true,
    tip: 'Komentarz klienta, notatka wewnętrzna (uwagi do zamówienia) i numer przesyłki — jeden pod drugim, każdy rodzaj w swoim kolorze. Osobne kolumny dla każdego rodzaju włączysz w „Kolumny ▾”.',
    cell: r => commentsCell(r, null, [r.tracking ? el('div', { class: 'cell-sub', title: 'Numer przesyłki' }, '📦 ' + r.tracking) : null]) },
  ...commentColumns(),
];

// ─── Lista: budowa ──────────────────────────────────────────────────────────

function buildList() {
  const u = S.ui;
  u.range = dateRange({ idFrom: 'ordFrom', idTo: 'ordTo', labelFrom: 'Od dnia', labelTo: 'Do dnia', titleFrom: 'Zamówienia złożone od tego dnia (włącznie)', titleTo: 'Zamówienia złożone do tego dnia (włącznie)', onChange: r => setQ(r) });
  u.from = u.range.from; u.to = u.range.to;
  u.reqRange = dateRange({ idFrom: 'ordReqFrom', idTo: 'ordReqTo', labelFrom: 'Wymagana data od', labelTo: 'Wymagana data do', titleFrom: 'Zamówienia z wymaganą datą realizacji od tego dnia (włącznie); zamówienia bez wymaganej daty są pomijane', titleTo: 'Zamówienia z wymaganą datą realizacji do tego dnia (włącznie); zamówienia bez wymaganej daty są pomijane', onChange: r => setQ({ rfrom: r.from, rto: r.to }) });
  const mkMs = (id, all, short, noun, tip, field) => multiSelect({ id, all, short, noun, tip, none: false, onChange: csv => setQ({ [field]: csv }) });
  u.payment = mkMs('ordPayment', 'Wszystkie płatności', 'Płatność', 'Płatność', 'Tylko zamówienia z wybranymi sposobami płatności — można zaznaczyć kilka', 'payment');
  u.deliverySel = mkMs('ordDelivery', 'Wszystkie dostawy', 'Dostawa', 'Dostawa', 'Tylko zamówienia z wybranymi sposobami dostawy — można zaznaczyć kilka', 'delivery');
  u.prodLabel = el('span', { class: 'ord-prod-on', id: 'ordProdOn', hidden: true });
  u.prodPick = productPicker({ id: 'ordProdSearch', placeholder: 'Szukaj produktu…', tip: 'Tylko zamówienia zawierające wybrany produkt. Wpisz nazwę, kod lub EAN i wybierz produkt z listy.', onPick: p => setQ({ product: String(p.id), pname: p.name || '' }) });
  u.prodClear = el('button', { type: 'button', class: 'ghost', id: 'ordProdClear', title: 'Usuń filtr produktu', onclick: () => setQ({ product: '', pname: '' }) }, 'Usuń');
  u.fx = createFilterUi({ Q: curQ, meta: () => S.meta, setQ: patch => setQ(patch), osaOn: () => osaActive(curQ()), osaClear: OSA_CLEAR, qsOf, clearAll: () => setQ(CLEAR_ALL()),
    openPanel: () => { if (!S.lv.u.layout.isOpen()) S.lv.openFilters(true); },
    goQs: qs => go('/zamowienia' + (qs ? '?' + qs : '')), linkFor: qs => location.href.split('#')[0] + '#/zamowienia' + (qs ? '?' + qs : '') });
  u.filtersInner = el('div', { class: 'opts-box ord-filters' });
  u.osa = osaBar({ prefix: 'ordOsa', withLicense: true, plain: true, getQ: curQ, apply: patch => setQ(patch), facets: () => S.meta && S.meta.facets });
  u.filtersInner.append(...u.fx.panelNodes({
    moreTitle: 'Klient i produkt', moreTip: 'Dane z notatek klientów (województwo, rodzaj podmiotu, tytuł, tagi, licencja) i produkt w zamówieniu', moreActive: () => !!(curQ().product || osaActive(curQ())),
    payMethod: el('div', { class: 'field-inline' }, 'Sposób płatności', u.payment.node), delivery: el('div', { class: 'field-inline' }, 'Sposób dostawy', u.deliverySel.node), range: u.range.node, reqRange: u.reqRange.node,
    more: [el('div', { class: 'fx-clients' }, u.osa.node, el('div', { class: 'field-inline ord-prodf' }, 'Produkt', u.prodPick.node, u.prodLabel, u.prodClear))],
  }));
  u.segs = el('div', { class: 'ord-segs', role: 'group', 'aria-label': 'Status zamówienia' });
  u.exportBtn = menuButton({ id: 'ordExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz zamówienia z tabeli do pliku Excel lub CSV — zaznaczone albo cały wynik filtra', items: exportItems });
  u.info = el('div', { class: 'muted small ord-info' });
  u.dlg = el('div', { id: 'ordDlg' });
  S.lv = listView({
    id: 'ord', route: '/zamowienia', storeKey: 'zamowienia', title: 'Zamówienia', noun: NOUN, tableClass: 'rich',
    intro: [el('div', { class: 'sub' }, 'Lista zamówień ze sklepu — zmiany z Selly pojawiają się same (zwykle w ciągu minuty, od razu po „Odśwież”). Kliknij numer zamówienia, aby zobaczyć szczegóły.'), u.segs],
    headActions: [el('a', { class: 'btn-secondary', id: 'ordInvoicesLink', href: '#/zamowienia/faktury',
      title: 'Faktury ze wszystkich zamówień: filtry (okres, numer, rozliczone / do zapłaty), rozliczenia, wydruk i eksport' }, 'Faktury'),
    el('a', { class: 'btn-secondary', id: 'ordSpeedMail', href: '#/speedmail',
      title: 'Kreator wysyłki do magazynu SpeedMail: wybór zamówień, sprawdzenie stanu SM, podział, plik dla SpeedMail i zmiana statusów w Selly. Środkowy przycisk myszy albo Ctrl+klik otwiera w nowej karcie.' }, 'Wysyłka SpeedMail'),
    el('a', { class: 'btn-primary', id: 'ordAdd', href: '#/zamowienia/nowe', write: 'zamowienia',
      title: 'Dodaj zamówienie ręcznie: klient, produkty, dostawa i płatność (formularz w panelu)' }, '+ Nowe zamówienie')],
    columns: COLS, columnsStore: 'osa-ord-cols2', columnsId: 'ordColsBtn', columnsExtra: [
      viewControls({ id: 'ordCols', view: () => S.view, set: patch => { S.view = { ...S.view, ...patch }; store(VIEW_KEY, S.view); if (S.lv.data) S.lv.render(); } }),
      el('div', { class: 'menu-sec' }, el('button', { type: 'button', class: 'link', id: 'ordPrefsBtn', title: 'Kolory komentarzy (dla siebie albo — administrator — dla całego sklepu) i nazwy poziomów cen',
        onclick: () => import('./zamowieniaUst.js?v=9e50e6d').then(m => m.openPrefs(S.ui.dlg, { prefs: () => S.meta && S.meta.prefs, onSaved: pr => { if (pr && S.meta) S.meta.prefs = pr; if (S.lv.data) S.lv.render(); } })) }, 'Ustawienia listy…'))],   // okno wczytywane dopiero po kliknięciu   // v2: Klient i Informacje dodatkowe domyślnie wyłączone
    defaultSort: SPEC.defaultSort, sizes: SIZES, defaultSize: 50, sizeStore: SIZE_STORE, extra: EXTRA,
    search: { placeholder: 'Szukaj: numer, e-mail, telefon, nazwisko, firma, miasto, nr przesyłki', label: 'Szukaj zamówień',
      tip: 'Szuka w numerze zamówienia, e-mailu, telefonie, imieniu i nazwisku (faktura i wysyłka), firmie, mieście i numerze przesyłki' },
    filtersTip: 'Pokaż lub ukryj panel filtrów po lewej: płatność, dostawa, produkt, zakres dat, dane z notatek klientów. Wybór jest zapamiętywany.',
    actions: [u.fx.viewsMenu, u.exportBtn], info: u.info, panelNodes: [u.filtersInner], top: [u.fx.sum, u.dlg],
    loadingText: 'Pobieram zamówienia…', load: loadOrders, onData, onSync: syncList,
    rowClass: r => (S.flashIds && S.flashIds.has(String(r.id)) ? 'live-chg' : ''),
    open: r => openOrder(r.id),
    emptyBox,
    errorBox: (e, retry) => el('div', { class: 'empty error' }, isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać zamówień.'), ' ',
      sellyLink('Panel Selly ↗', adminUrl() + '?a=zamowienia', 'Otwiera listę zamówień w panelu Selly w nowej karcie'),
      el('div', null, el('button', { type: 'button', class: 'secondary', id: 'ordRetry', onclick: retry }, 'Spróbuj ponownie'))),
    // Świeżość listy: znacznik wersji co 30 s, powrót do karty, „Odśwież” (core/liveRefresh.js); zaznaczenie nie wstrzymuje odświeżania
    live: { pauseOnSelect: false, busy: listBusy },
    select: { noun: NOUN, label: r => 'zamówienie ' + (r.number || r.id), actions: bulkActions },
  });
  // Enter przy numerze zamówienia (jak w Selly) otwiera to zamówienie; bez roku: bieżący rok, a gdy go brak — najnowszy wcześniejszy
  if (S.lv.u.search) S.lv.u.search.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const v = S.lv.u.search.value.trim();
    if (!parseOrderQuery(v)) return;
    e.preventDefault();
    try {
      const r = await api('orders:resolve', { q: v });
      if (!r.found) { flash('', 'Nie znaleziono zamówienia o numerze ' + v + '.', 'error'); return; }
      const note = yearNote(r);
      if (note) flash('', note);
      openOrder(r.id);
    } catch (err) { flash('', 'Nie udało się wyszukać zamówienia: ' + (err.message || 'błąd')); }
  });
  S.listBox = el('div', { class: 'ord-list' }, S.lv.node);
  S.root.append(S.listBox);
  // Klik / klawisz w liście = użytkownik pracuje — odświeżenie w tle czeka chwilę (nie przestawia wierszy pod kursorem)
  for (const t of ['pointerdown', 'keydown']) S.listBox.addEventListener(t, () => { S.touchedAt = Date.now(); }, true);
}

/** Czy odświeżenie w tle ma poczekać: lista niewidoczna / wczytuje się, otwarte okno zmiany statusu lub menu, świeża interakcja. */
function listBusy() {
  const u = S.ui;
  return !S.listBox || S.listBox.hidden || S.loading || !S.lv.data || (u.dlg && u.dlg.childElementCount > 0)
    || !!S.listBox.querySelector('.menu-pop:not([hidden])') || Date.now() - S.touchedAt < 5000;
}

/** Kontrolki modułu po zmianie stanu listy (wyszukiwarkę, sortowanie i strony ustawia listView). */
function syncList(Q) {
  const u = S.ui;
  u.from.value = Q.from; u.to.value = Q.to; u.reqRange.from.value = Q.rfrom; u.reqRange.to.value = Q.rto;
  u.payment.set((S.meta.payments || []).map(x => ({ key: String(x.id), label: x.name })), Q.payment);
  u.deliverySel.set((S.meta.deliveries || []).map(x => ({ key: String(x.id), label: x.name })), Q.delivery);
  u.prodLabel.hidden = u.prodClear.hidden = !Q.product; u.prodLabel.textContent = Q.product ? '„' + (Q.pname || 'produkt #' + Q.product) + '”' : '';
  // filtr ustawiany w panelu (nie plakietką statusu) — panel otwieramy, żeby było go widać
  if ((Q.from || Q.to || Q.rfrom || Q.rto || Q.payment || Q.delivery || Q.product) && !S.lv.u.layout.isOpen()) S.lv.openFilters(true);
  renderSegs();
  u.osa.sync();
  u.fx.sync();
}

function renderSegs() {
  const u = S.ui, Q = curQ(), M = S.meta;
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

/** Strona listy dla listView. kind: { background } — odświeżenie w tle (bez migania), { manual } — przycisk „Odśwież”. */
async function loadOrders(Q, kind) {
  const quiet = !!(kind.background || kind.manual);
  // Liczniki statusów: po kliknięciu „Odśwież” zawsze, w tle najwyżej co META_BG_MS
  if (quiet && (kind.manual || Date.now() - S.metaAt >= META_BG_MS)) {
    S.metaAt = Date.now();
    api('orders:meta', kind.manual ? {} : { bg: 1 }).then(m => { if (m && m.statuses) { S.meta = m; if (S.listBox && !S.listBox.hidden) renderSegs(); } }).catch(() => {});
  }
  const prev = S.lv.data;
  S.loading = true;
  try {
    const pre = S.pre; S.pre = null;   // pierwsze wczytanie: zapytanie wysłane równolegle z orders:meta (mountRoute)
    const r = await (!quiet && pre && pre.k === 'list' ? pre.p : api('orders:list', listParams(Q, kind.background ? { bg: 1 } : undefined)));
    S.flashIds = quiet && prev && prev.page === r.page ? changedIds(prev.rows, r.rows) : null;
    return r;
  } finally { S.loading = false; }
}
function onData(d) {
  const sel = S.lv.selection;
  for (const row of d.rows || []) if (sel.has(String(row.id))) sel.set(String(row.id), row);   // zaznaczenie zostaje, z aktualnym statusem
  S.ui.info.replaceChildren(d.sumTotal != null ? el('span', { class: 'tip', id: 'ordSum', title: 'Suma wartości wszystkich zamówień pasujących do filtrów (nie tylko tej strony), z kosztami dostawy' }, 'Suma na liście: ' + money(d.sumTotal) + ' zł') : null);
  const qn = curQ().q, exact = qn && S.broad !== qn && parseOrderQuery(qn);
  if (exact) S.ui.info.prepend(el('span', { class: 'tip', id: 'ordExactNote', title: 'Wpisany numer pokazuje tylko zamówienia o takim numerze (z każdego roku). Enter otwiera zamówienie od razu.' }, 'Tylko numer ' + qn + ' · '),
    el('a', { href: '#', id: 'ordBroad', title: 'Szuka wpisanej wartości we wszystkich polach: numerze, e-mailu, telefonie, nazwisku, firmie, mieście i przesyłce',
      onclick: e => { e.preventDefault(); S.broad = qn; S.lv.reload({ manual: true }); } }, 'pokaż też zawierające „' + qn + '”'), ' · ');
  queueMicrotask(() => { S.flashIds = null; });   // podświetlenie tylko w tym jednym renderze
}

/** Pusty wynik: podpowiedz kolejny krok — zwolnij któryś z filtrów (każdy przycisk usuwa jeden warunek) albo wyczyść wszystko. */
function emptyBox(Q) {
  if (!anyFilter(Q, osaActive(Q))) return 'Brak zamówień. Nowe zamówienia ze sklepu pojawią się tu same (panel sprawdza Selly co minutę).';
  const cl = clausesOf(Q, { statusName, payName: id => nameIn(S.meta.payments, id), deliveryName: id => nameIn(S.meta.deliveries, id), osaOn: osaActive(Q), osaClear: OSA_CLEAR });
  return ['Brak zamówień pasujących do wybranych filtrów.', el('div', { class: 'fx-relax' }, el('span', { class: 'muted small' }, 'Spróbuj poluzować filtry:'),
    ...cl.map(c => el('button', { type: 'button', class: 'chip', title: 'Usuń ten warunek i pokaż więcej zamówień', onclick: () => setQ(c.clear) }, 'Usuń: ' + c.name)),
    el('button', { type: 'button', class: 'secondary', onclick: () => setQ(CLEAR_ALL()) }, 'Wyczyść filtry'))];
}

function openOrder(id) { S.listHash = location.hash; go('/zamowienia/' + encodeURIComponent(id)); }

// ─── Akcje masowe (wspólny dolny pasek zaznaczenia listView) ────────────────

function bulkActions(rows) {
  const u = S.ui, n = rows.length;
  return [
    el('button', { type: 'button', class: 'secondary', id: 'ordCopyNums', title: 'Kopiuje numery zaznaczonych zamówień, po jednym w wierszu',
      onclick: () => copyToClipboard(rows.map(r => r.number).join('\n'), null, 'Skopiowano ' + cnt(n, 'numer', 'numery', 'numerów'), '') }, 'Kopiuj numery'),
    el('button', { type: 'button', class: 'secondary', id: 'ordPickList', title: 'Otwiera widok do druku: zbiorcza lista produktów z zaznaczonych zamówień (do zbierania z półek) i kartki pakowania, po jednej na zamówienie (do 100 zamówień)',
      onclick: () => go('zamowienia/kompletacja?ids=' + rows.slice(0, 100).map(r => r.id).join(',')) }, 'Lista kompletacyjna'),
    menuButton({ id: 'ordStatusMenu', label: 'Zmień status', cls: 'primary', write: ['zamowienia', 'przesylki'], title: 'Ustaw wybrany status dla wszystkich zaznaczonych zamówień (przed zmianą pokażemy podsumowanie do potwierdzenia)',
      items: () => S.meta.statuses.map(s => ({ label: s.name, title: 'Ustaw status „' + s.name + '” dla zaznaczonych zamówień', run: () => startStatusChange(u.dlg, rows, String(s.id), onStatusDone) })) }),
  ];
}

function onStatusDone(doneIds) {
  for (const id of doneIds) S.lv.selection.delete(String(id));
  api('orders:meta').then(m => { S.meta = m; if (S.listBox && !S.listBox.hidden) renderSegs(); }).catch(() => {});
  S.lv.reload();
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
    const { rows: part, total } = await fetchAllRows(page => api('orders:list', listParams(curQ(), { page, pageSize: 200 })), EXPORT_MAX, 'zamówienia');
    saveTable(exportTable(part), kind);
    if (total > EXPORT_MAX) flash('', 'Plik zawiera pierwsze ' + EXPORT_MAX + ' z ' + total + ' zamówień — zawęź filtry, aby dostać resztę');
  } catch (e) { flash('', 'Nie udało się pobrać zamówień: ' + (e.message || 'błąd')); }
}

function exportItems() {
  const sel = S.lv.selectedRows(), total = S.lv.data ? S.lv.data.total || 0 : 0, tot = Math.min(total, EXPORT_MAX);
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
    items: () => S.meta.statuses.map(s => ({ label: s.name, title: String(s.id) === stId ? 'Aktualny status' : 'Ustaw status „' + s.name + '”', run: async () => { if (card && card.C.dirty() && !await askConfirm('W karcie są niezapisane zmiany — zmiana statusu przeładuje kartę i je odrzuci. Kontynuować?', { title: 'Niezapisane zmiany', confirmLabel: 'Kontynuuj' })) return; startStatusChange(dlg, order1, String(s.id), () => { S.lv.selection.delete(String(id)); reload(); }); } })) });

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

  card = buildOrderCard({ id, order: o, meta: S.meta, sellyUrl: sellyOrderUrl(id), onSaved: () => {} });
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
          onclick: async () => { if (card && card.C.dirty() && !await askConfirm('W karcie są niezapisane zmiany — odświeżenie je odrzuci. Kontynuować?', { title: 'Niezapisane zmiany', confirmLabel: 'Kontynuuj' })) return; renderDetail(id); } }, '↻ Odśwież'),
        sellyLink('Otwórz w panelu Selly ↗', sellyOrderUrl(id), 'Otwiera to zamówienie w panelu administracyjnym Selly')),
      el('div', { class: 'card-head' }, el('h2', { id: 'ordTitle' }, 'Zamówienie ' + number), el('div', { class: 'sub' }, dateStr(o.date))),
      el('div', { class: 'ord-detail-status' }, 'Status: ', statusPill(stId, o.status_name || statusName(stId)), statusMenu, el('span', { class: 'spacer' }), card.toggle),
      dlg),
    card.notes,
    el('div', { class: 'ord-grid' }, card.grid),
    card.items, card.totals, card.invoices, card.sellyFields, card.sellyOnly,
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
  let row = S.lv && S.lv.data && (S.lv.data.rows || []).find(x => String(x.number) === String(number));
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
    else S.pre = { k: 'list', p: api('orders:list', listParams(stateOf(route.query))) };
    S.pre.p.catch(() => {});
    await ensureMeta();
    if (my !== S.routeSeq) return;
    if (!S.meta) {
      S.pre = null;
      S.metaBox.replaceChildren(S.metaErr && isUnavailable(S.metaErr) ? unavailableBox() : unavailableBox(S.metaErr ? 'Nie udało się otworzyć zamówień: ' + S.metaErr.message : MSG_UNAVAILABLE));
      return;
    }
  }
  if (!S.lv) buildList();
  registerListKeys({ screen: 'zamowienia', table: 'ordTable', filters: 'ordFiltersBtn', export: 'ordExport', cols: 'ordColsBtn', search: 'ordSearch', back: 'ordBack', select: true });
  S.guard = null;
  if (route.id) { S.lv.stop(); show('detail'); renderDetail(route.id); return; }
  show('list');
  S.listHash = location.hash || '#/zamowienia';
  S.lv.mount(route.query);
}

// #/zamowienia/kompletacja?ids=… → zamowieniaKompletacja.js, #/zamowienia/faktury → zamowieniaFaktury.js, #/zamowienia/nowe → zamowienieNowe.js
const SUBS = {
  kompletacja: { load: () => import('./zamowieniaKompletacja.js?v=9e50e6d'), show: (m, host, on, q) => m.showPick(host, on, q) },
  faktury: { load: () => import('./zamowieniaFaktury.js?v=9e50e6d'), show: (m, host, on) => m.showInvoices(host, on) },
  nowe: { load: () => import('./zamowienieNowe.js?v=9e50e6d'), show: (m, host, on) => m.showNewOrder(host, on) },
};
const SUB_MODS = {};
S.subSeq = 0;
const loadSub = async k => SUB_MODS[k] || (SUB_MODS[k] = await SUBS[k].load());

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
    S.route = { id: params && params.parts && params.parts[0] || '', query: params && params.query };
    // Podwidoki (kompletacja, faktury, nowe zamówienie) wczytywane dopiero przy wejściu na ich adres — lista ładuje mniej plików
    const key = SUBS[S.route.id] ? S.route.id : '', seq = ++S.subSeq;
    for (const k of Object.keys(SUB_MODS)) if (k !== key) SUBS[k].show(SUB_MODS[k], el0, false);
    if (key) {
      S.routeSeq++; S.guard = null; if (S.lv) S.lv.stop(); show('');
      loadSub(key).then(m => { if (seq === S.subSeq) SUBS[key].show(m, el0, true, params && params.query); }).catch(e => { if (seq === S.subSeq) flash('', 'Nie udało się wczytać widoku — odśwież stronę. ' + ((e && e.message) || ''), 'error'); });
      return;
    }
    mountRoute();
  },
  unmount() { S.routeSeq++; S.subSeq++; S.guard = null; if (S.lv) S.lv.stop(); },
};
