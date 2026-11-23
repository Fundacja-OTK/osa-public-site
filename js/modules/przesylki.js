// Moduł „Przesyłki”: kolejka zamówień do nadania per przewoźnik (InPost, DPD, DHL, Orlen Paczka, UPS), tworzenie listów przewozowych
// w porcjach, etykiety, zmiana statusu nadanych oraz przypisanie sposobów dostawy do przewoźników (#/przesylki/ustawienia).
// Dane i zapisy: backend Cloudflare (shipping:meta, shipping:setMap, shipping:queue, shipping:create, shipping:label, orders:meta, orders:setStatus).
import { el, plural, store, flash, norm, menuButton, money, dateStr, fullName, cnt, isUnavailable, loadingBox, sellyLink, sortTh, saveBlob, zipStored, today, dateInput } from '../core/ui.js?v=5aa9759';
import { api, ctx } from '../core/client.js?v=5aa9759';
import { go } from '../core/router.js?v=5aa9759';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const MSG_UNAVAILABLE = 'Moduł Przesyłki wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';
const COURIER_FALLBACK = [{ key: 'inpost', name: 'InPost' }, { key: 'dpd', name: 'DPD' }, { key: 'dhl', name: 'DHL' }, { key: 'orlenpaczka', name: 'Orlen Paczka' }, { key: 'ups', name: 'UPS' }];
const OTHER = {
  fedex: { name: 'FedEx', title: 'FedEx — przez magazyn SpeedMail', text: 'Przesyłki FedEx nie są nadawane z panelu — idą przez magazyn SpeedMail, poza Selly. Zamówienia do wysyłki SpeedMail przygotujesz w module Magazyny.',
    href: '#/magazyny/speedmail', link: 'Otwórz wysyłkę SpeedMail →', tip: 'Przechodzi do wysyłki SpeedMail w module Magazyny', external: false },
  furgonetka: { name: 'Furgonetka', title: 'Furgonetka — tylko w panelu Selly', text: 'Furgonetka to pośrednik bez API, więc listów nie utworzymy stąd. Użyj listy „Przesyłki Furgonetka” w panelu Selly.',
    query: '?a=furgonetka.przesylki', link: 'Otwórz Furgonetkę w panelu Selly ↗', tip: 'Otwiera listę przesyłek Furgonetki w panelu administracyjnym Selly w nowej karcie', external: true },
};

// ─── Parametry listu wg przewoźnika ─────────────────────────────────────────
// type: select | checks | flag | text | date; adv — schowane w „Więcej opcji”. Wartości: select/text/date → tekst, checks → tablica, flag → bool.
const o3 = (v, l, t) => [v, l, t];
const PARAMS = {
  inpost: [
    { key: 'service', label: 'Usługa', type: 'select', def: 'inpost_locker_standard', tip: 'Rodzaj przesyłki InPost: do paczkomatu albo kurierska',
      options: [o3('inpost_locker_standard', 'Paczkomat (standard)', 'Paczka odbierana przez klienta w paczkomacie'), o3('inpost_courier_standard', 'Kurier (standard)', 'Paczka doręczana kurierem pod adres')] },
    { key: 'parcel_template', label: 'Gabaryt paczki', type: 'select', def: 'small', tip: 'Rozmiar skrytki w paczkomacie (A, B lub C)',
      options: [o3('small', 'A — mała', 'Skrytka A: najmniejsza (8 × 38 × 64 cm)'), o3('medium', 'B — średnia', 'Skrytka B: średnia (19 × 38 × 64 cm)'), o3('large', 'C — duża', 'Skrytka C: największa (41 × 38 × 64 cm)')] },
    { key: 'sending_method', label: 'Jak nadasz paczkę', type: 'select', def: '', tip: 'Gdzie fizycznie oddasz paczki InPost (zostaw „wg ustawień konta”, jeśli nie wiesz)',
      options: [o3('', 'wg ustawień konta w InPost', 'Bez wskazania — obowiązuje domyślna metoda z konta InPost'), o3('parcel_locker', 'nadam w paczkomacie', 'Zaniesiesz paczki do dowolnego paczkomatu'), o3('pok', 'nadam w punkcie obsługi (POK)', 'Punkt Obsługi Klienta InPost'),
        o3('pop', 'nadam w punkcie partnerskim (POP)', 'Punkt Obsługi Paczek — sklep lub punkt partnera'), o3('branch', 'nadam w oddziale', 'Oddział InPost'), o3('dispatch_order', 'odbiór przez kuriera', 'Kurier InPost odbierze paczki z Twojego adresu (wymaga zamówienia odbioru)')] },
    { key: 'additional_service', label: 'Usługi dodatkowe', type: 'checks', tip: 'Dodatkowe usługi InPost (płatne według cennika)',
      options: [o3('insurance', 'ubezpieczenie', 'Ubezpieczenie przesyłki'), o3('cod', 'pobranie', 'Płatność za pobraniem przy odbiorze'), o3('end_of_week_collection', 'paczka w weekend', 'Nadanie z odbiorem w weekend (Paczka w Weekend)')] },
    { key: 'service_custom', label: 'Własny kod usługi', type: 'text', adv: true, tip: 'Jeśli wpiszesz tu kod usługi InPost (np. inpost_locker_pass_thru), zastąpi wybór „Usługa” powyżej', ph: 'np. inpost_locker_pass_thru' },
  ],
  dpd: [
    { key: 'guarantee_type', label: 'Gwarancja doręczenia', type: 'select', def: '', tip: 'Gwarantowana godzina lub dzień doręczenia (usługa płatna)',
      options: [o3('', 'brak (standard)', 'Zwykłe doręczenie bez gwarancji'), o3('TIME0930', 'do 9:30', 'Doręczenie do godz. 9:30'), o3('TIME1200', 'do 12:00', 'Doręczenie do godz. 12:00'), o3('TIMEFIXED', 'w ustalonej godzinie', 'Doręczenie o wskazanej godzinie'),
        o3('SATURDAY', 'w sobotę', 'Doręczenie w sobotę'), o3('INTER', 'międzynarodowa', 'Gwarancja dla przesyłek zagranicznych')] },
    { key: 'package_services', label: 'Usługi dodatkowe', type: 'checks', adv: true, tip: 'Dodatkowe usługi DPD wg specyfikacji (kody usług)',
      options: [o3('CarryIn', 'wniesienie (CarryIn)', 'Wniesienie przesyłki do wnętrza budynku'), o3('CUD', 'potwierdzenie doręczenia (CUD)', 'Kod usługi DPD CUD'), o3('DOX', 'dokumenty (DOX)', 'Przesyłka dokumentowa'), o3('Duty', 'cło / opłaty (Duty)', 'Obsługa opłat celnych'),
        o3('InPers', 'do rąk własnych (InPers)', 'Doręczenie do rąk wskazanej osoby'), o3('PrivPers', 'osoba prywatna (PrivPers)', 'Doręczenie do osoby prywatnej'), o3('ROD', 'zwrot dokumentów (ROD)', 'Zwrot podpisanych dokumentów do nadawcy'),
        o3('SelfCol', 'odbiór własny (SelfCol)', 'Odbiór własny przez odbiorcę'), o3('Pickup', 'odbiór od nadawcy (Pickup)', 'Kurier odbiera paczkę od nadawcy')] },
  ],
  dhl: [
    { key: 'incomingDate', label: 'Data nadania', type: 'date', def: '', tip: 'Dzień, w którym DHL odbierze lub przyjmie paczki (domyślnie dziś)' },
    { key: 'selectedDropOffType', label: 'Sposób przekazania', type: 'select', def: 'REQUEST_COURIER', tip: 'Jak przekażesz paczki DHL',
      options: [o3('REQUEST_COURIER', 'zamów kuriera', 'Kurier DHL odbierze paczki w dniu nadania'), o3('REGULAR_PICKUP', 'stały odbiór', 'Masz stałą umowę na regularny odbiór')] },
    { key: 'selectedPackage', label: 'Rodzaj paczki', type: 'select', def: 'PACKAGE', tip: 'Typ przesyłki',
      options: [o3('PACKAGE', 'paczka', 'Standardowa paczka'), o3('ENVELOPE', 'koperta', 'Przesyłka płaska/dokumenty'), o3('PALLET', 'paleta', 'Przesyłka paletowa')] },
    { key: 'shipTypes', label: 'Produkt DHL', type: 'select', def: 'AH', tip: 'Kod produktu DHL wg specyfikacji',
      options: [o3('AH', 'AH — krajowa standard', 'Kod produktu DHL: AH'), o3('09', '09 — do 9:00', 'Doręczenie do 9:00'), o3('12', '12 — do 12:00', 'Doręczenie do 12:00'), o3('EK', 'EK', 'Kod produktu DHL: EK'),
        o3('PI', 'PI', 'Kod produktu DHL: PI'), o3('PR', 'PR', 'Kod produktu DHL: PR'), o3('CP', 'CP', 'Kod produktu DHL: CP'), o3('CM', 'CM', 'Kod produktu DHL: CM')] },
    { key: 'services', label: 'Usługi dodatkowe', type: 'checks', adv: true, tip: 'Dodatkowe usługi DHL (płatne według cennika)',
      options: [o3('PDI', 'PDI', 'Kod usługi DHL: PDI'), o3('POD', 'potwierdzenie doręczenia (POD)', 'Potwierdzenie doręczenia'), o3('deliveryEvening', 'doręczenie wieczorem', 'Doręczenie w godzinach wieczornych'),
        o3('deliveryOnSaturday', 'doręczenie w sobotę', 'Doręczenie w sobotę'), o3('pickupOnSaturday', 'odbiór w sobotę', 'Odbiór paczki w sobotę'), o3('receiverPreaviso', 'powiadomienie odbiorcy', 'Awizo (preaviso) dla odbiorcy')] },
  ],
  orlenpaczka: [
    { key: 'box_size', label: 'Rozmiar paczki', type: 'select', def: 'S', tip: 'Rozmiar skrytki w punkcie Orlen Paczka',
      options: [o3('S', 'S — mała', 'Skrytka S'), o3('M', 'M — średnia', 'Skrytka M'), o3('L', 'L — duża', 'Skrytka L')] },
    { key: 'insurance', label: 'Ubezpieczenie', type: 'flag', def: false, tip: 'Dodaje ubezpieczenie paczki' },
    { key: 'transfer_description', label: 'Opis przesyłki', type: 'text', adv: true, tip: 'Krótki opis zawartości widoczny na przesyłce', ph: 'np. materiały orszakowe' },
  ],
  ups: [
    { key: 'notification_enable', label: 'Powiadomienia dla odbiorcy', type: 'flag', def: false, tip: 'UPS wyśle odbiorcy powiadomienia o przesyłce' },
    { key: 'saturday_delivery_indicator', label: 'Doręczenie w sobotę', type: 'flag', def: false, tip: 'Doręczenie przesyłki w sobotę' },
    { key: 'saturday_pickup_indicator', label: 'Odbiór w sobotę', type: 'flag', def: false, tip: 'Odbiór paczki od nadawcy w sobotę' },
  ],
};

const S = {
  root: null, ui: {}, meta: null, metaErr: null, metaLoading: false, ordMeta: null,
  view: 'inpost', route: null,
  rows: [], note: '', loading: false, err: '', sel: new Map(), lockers: new Map(), numOf: new Map(),
  sort: { sort: 'date', dir: 'asc' }, counts: {}, seq: 0, routeSeq: 0, params: {},
};

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const couriers = () => (S.meta && S.meta.couriers && S.meta.couriers.length ? S.meta.couriers : COURIER_FALLBACK);
const courierName = k => { const c = couriers().find(x => x.key === k); return c ? c.name : k; };
const maxBatch = () => Math.max(1, Number(S.meta && S.meta.maxBatch) || 10);
const statuses = () => (S.ordMeta && S.ordMeta.statuses) || [];
const statusName = id => { const s = statuses().find(x => String(x.id) === String(id)); return s ? s.name : (id == null || id === '' ? '—' : 'Status ' + id); };
const lockerOf = r => (S.lockers.has(r.id) ? S.lockers.get(r.id) : (r.locker || ''));
const safeFile = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '-');
const isCourier = k => !!k && couriers().some(c => c.key === k);

function unavailableBox(extra) {
  return el('div', { class: 'card' }, el('div', { class: 'empty error' },
    el('p', null, el('strong', null, extra || MSG_UNAVAILABLE)),
    el('p', null, sellyLink('Otwórz przesyłki w panelu Selly ↗', adminUrl() + '?a=zamowienia', 'Otwiera panel administracyjny Selly w nowej karcie')),
    el('p', null, el('button', { type: 'button', class: 'secondary', onclick: () => { S.meta = null; mountRoute(); } }, 'Spróbuj ponownie'))));
}

// ─── Meta ───────────────────────────────────────────────────────────────────

async function ensureMeta() {
  if (S.meta) return true;
  if (S.metaLoading) return false;
  S.metaLoading = true; S.metaErr = null;
  try { S.meta = await api('shipping:meta'); } catch (e) { S.metaErr = e; }
  S.metaLoading = false;
  if (S.meta && !S.ordMeta) { try { S.ordMeta = await api('orders:meta'); } catch (e) { S.ordMeta = null; } }
  return !!S.meta;
}

// ─── Parametry: stan, zapamiętanie, budowa ──────────────────────────────────

function loadParams(key) {
  if (S.params[key]) return S.params[key];
  const saved = store('osa-ship-params-' + key) || {}, v = {};
  for (const d of PARAMS[key] || []) {
    const s = saved[d.key];
    v[d.key] = d.type === 'checks' ? (Array.isArray(s) ? s : []) : d.type === 'flag' ? (s == null ? !!d.def : !!s) : (s == null ? (d.def || '') : String(s));
  }
  return (S.params[key] = v);
}
function saveParams(key) {
  const v = Object.assign({}, S.params[key]); delete v.incomingDate;
  store('osa-ship-params-' + key, v);
}
function buildParams(key) {
  const v = loadParams(key), out = {};
  for (const d of PARAMS[key] || []) {
    const x = v[d.key];
    if (d.type === 'checks') { if (x.length) out[d.key] = x.join(','); }
    else if (d.type === 'flag') { if (x) out[d.key] = '1'; }
    else if (d.type === 'date') out[d.key] = x || today();
    else if (x !== '' && d.key !== 'service_custom') out[d.key] = x;
  }
  if (key === 'inpost' && v.service_custom && v.service_custom.trim()) out.service = v.service_custom.trim();
  return out;
}
function paramsText(key) {
  const v = loadParams(key), parts = [];
  for (const d of PARAMS[key] || []) {
    const x = v[d.key];
    if (d.type === 'checks') { if (x.length) parts.push(d.label + ': ' + x.map(c => (d.options.find(o => o[0] === c) || [0, c])[1]).join(', ')); }
    else if (d.type === 'flag') { if (x) parts.push(d.label); }
    else if (d.type === 'select') { const o = d.options.find(q => q[0] === x); if (x !== '' && o) parts.push(d.label + ': ' + o[1]); }
    else if (d.type === 'date') parts.push(d.label + ': ' + (x || today()));
    else if (x) parts.push(d.label + ': ' + x);
  }
  return parts.join(' · ') || 'domyślne';
}

function paramField(key, d) {
  const v = loadParams(key), id = 'shipP-' + d.key, upd = val => { v[d.key] = val; saveParams(key); };
  if (d.type === 'select') {
    const sel = el('select', { id, 'aria-label': d.label, title: d.tip, onchange: ev => upd(ev.target.value) },
      d.options.map(o => el('option', { value: o[0], title: o[2] }, o[1])));
    sel.value = v[d.key];
    return el('label', { class: 'ship-f' }, el('span', { class: 'ord-f-l tip', title: d.tip }, d.label), sel);
  }
  if (d.type === 'checks') {
    return el('fieldset', { class: 'ship-f ship-checks', id }, el('legend', { class: 'ord-f-l tip', title: d.tip }, d.label),
      d.options.map(o => el('label', { class: 'ship-check', title: o[2] }, el('input', { type: 'checkbox', value: o[0], checked: v[d.key].includes(o[0]),
        onchange: ev => { const cur = new Set(v[d.key]); if (ev.target.checked) cur.add(o[0]); else cur.delete(o[0]); upd(d.options.map(q => q[0]).filter(c => cur.has(c))); } }), ' ' + o[1])));
  }
  if (d.type === 'flag') {
    return el('label', { class: 'ship-f ship-check', title: d.tip }, el('input', { type: 'checkbox', id, checked: !!v[d.key], onchange: ev => upd(ev.target.checked) }), ' ' + d.label);
  }
  const inp = d.type === 'date' ? dateInput({ id, label: d.label, title: d.tip, value: v[d.key], onChange: x => upd(x) }) : el('input', { type: 'text', id, 'aria-label': d.label, title: d.tip, placeholder: d.ph || (d.type === 'date' ? '' : null), value: v[d.key],
    oninput: ev => upd(ev.target.value) });
  return el('label', { class: 'ship-f' }, el('span', { class: 'ord-f-l tip', title: d.tip }, d.label), inp);
}

function paramsPanel(key) {
  const defs = PARAMS[key] || [], main = defs.filter(d => !d.adv), adv = defs.filter(d => d.adv);
  return el('details', { class: 'ship-params', id: 'shipParams' },
    el('summary', { title: 'Ustawienia listu przewozowego: usługa, gabaryt, sposób nadania. Zapamiętujemy je osobno dla każdego przewoźnika.' }, 'Parametry przesyłki'),
    el('p', { class: 'muted small' }, 'Stosowane do wszystkich zaznaczonych zamówień. Ostatnie wybory są zapamiętywane dla ' + courierName(key) + '.'),
    el('div', { class: 'ship-form' }, main.map(d => paramField(key, d))),
    adv.length ? el('details', { class: 'ship-more' }, el('summary', { title: 'Rzadziej potrzebne opcje tego przewoźnika' }, 'Więcej opcji'),
      el('div', { class: 'ship-form' }, adv.map(d => paramField(key, d)))) : null);
}

// ─── Powłoka: segmenty ──────────────────────────────────────────────────────

function build() {
  const u = S.ui;
  u.segs = el('div', { class: 'ord-segs', role: 'group', 'aria-label': 'Przewoźnik' });
  u.body = el('div', { class: 'ship-body' });
  S.root.append(el('div', { class: 'ship-wrap' },
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Przesyłki'), el('div', { class: 'sub' }, 'Zamówienia do nadania, listy przewozowe i etykiety — osobno dla każdego przewoźnika.')),
      u.segs),
    u.body));
}

function renderSegs() {
  const seg = (id, label, tip) => el('button', { type: 'button', class: 'chip', id: 'shipSeg-' + id, 'aria-pressed': String(S.view === id), title: tip, onclick: () => go('/przesylki/' + id) }, label);
  S.ui.segs.replaceChildren(
    ...couriers().map(c => seg(c.key, c.name + (S.counts[c.key] != null ? ' (' + S.counts[c.key] + ')' : ''), 'Kolejka zamówień do nadania przez ' + c.name)),
    seg('fedex', 'FedEx', 'FedEx idzie przez magazyn SpeedMail — poza Selly'),
    seg('furgonetka', 'Furgonetka', 'Furgonetka to pośrednik bez API — tylko panel Selly'),
    seg('ustawienia', 'Ustawienia przewoźników ⚙', 'Przypisz sposoby dostawy ze sklepu do przewoźników — od tego zależy, co trafia do kolejki'));
}

// ─── Kolejka ────────────────────────────────────────────────────────────────

async function loadQueue() {
  const my = ++S.seq, u = S.ui, key = S.view;
  S.loading = true; S.err = '';
  if (u.results) u.results.replaceChildren(loadingBox('Pobieram zamówienia do nadania…'));
  const p = { courier: key, withTracking: !!store('osa-ship-withtrack') };
  const st = store('osa-ship-status'); if (st) p.statusIds = [String(st)];
  try {
    const r = await api('shipping:queue', p);
    if (my !== S.seq) return;
    S.rows = r.rows || []; S.note = r.note || ''; S.counts[key] = S.rows.length;
    for (const x of S.rows) S.numOf.set(String(x.id), x.number || x.id);
    for (const id of [...S.sel.keys()]) if (!S.rows.some(x => String(x.id) === String(id))) S.sel.delete(id);
  } catch (e) {
    if (my !== S.seq) return;
    S.rows = []; S.err = isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać kolejki.');
  }
  S.loading = false; renderSegs();
  renderQueue();
}

const SORT_VAL = {
  number: r => r.number, date: r => r.date, client: r => fullName(r.firstName, r.lastName) || r.company, city: r => r.city, locker: r => lockerOf(r),
  status: r => statusName(r.statusId), total: r => (r.total == null || r.total === '' ? null : Number(r.total)), tracking: r => r.tracking,
};
function sortedRows() {
  const { sort, dir } = S.sort, f = SORT_VAL[sort] || SORT_VAL.date, k = dir === 'asc' ? 1 : -1;
  return S.rows.slice().sort((a, b) => {
    const x = f(a), y = f(b), ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pl', { numeric: true })) * k;
  });
}

function columns(key) {
  const cols = [
    { label: 'Zamówienie', sort: 'date', firstDir: 'asc', tip: 'Numer zamówienia i data złożenia. Kliknij numer, aby otworzyć zamówienie.' },
    { label: 'Klient (wysyłka)', sort: 'client', tip: 'Odbiorca przesyłki — dane z adresu wysyłki zamówienia' },
    { label: 'Miasto, kod', sort: 'city', tip: 'Miejscowość i kod pocztowy z adresu wysyłki' },
  ];
  if (key === 'inpost') cols.push({ label: 'Paczkomat', sort: 'locker', tip: 'Paczkomat docelowy wybrany w zamówieniu. Możesz go poprawić — zmiana dotyczy tylko tej przesyłki i nie zmienia zamówienia w Selly.', tipHeader: true });
  cols.push(
    { label: 'Produkty', tip: 'Zamówione produkty z ilościami. Najedź na tekst, aby zobaczyć pełną listę.', tipHeader: true },
    { label: 'Wartość', sort: 'total', num: true, tip: 'Wartość zamówienia (zł) i informacja, czy jest opłacone', tipHeader: true },
    { label: 'Status', sort: 'status', tip: 'Aktualny status zamówienia w Selly' },
    { label: 'Nr przesyłki', sort: 'tracking', tip: 'Numer przesyłki po utworzeniu listu przewozowego. Puste = jeszcze nienadane.', tipHeader: true });
  return cols;
}

function selectedRows() { return [...S.sel.values()]; }

function renderQueue() {
  const u = S.ui, key = S.view;
  if (!u.results) return;
  if (S.err) {
    u.results.replaceChildren(el('div', { class: 'empty error' }, S.err, el('div', null, el('button', { type: 'button', class: 'secondary', onclick: loadQueue }, 'Spróbuj ponownie'))));
    renderBar(); return;
  }
  const rows = sortedRows(), isIn = key === 'inpost';
  const head = el('tr', null,
    el('th', { class: 'c' }, el('input', { type: 'checkbox', id: 'shipSelAll', 'aria-label': 'Zaznacz wszystkie', title: 'Zaznacz lub odznacz wszystkie zamówienia w kolejce',
      onchange: ev => { for (const r of S.rows) { if (ev.target.checked) S.sel.set(r.id, r); else S.sel.delete(r.id); } syncSel(); } })),
    columns(key).map(c => sortTh(c, S.sort, (sort, dir) => { S.sort = { sort, dir }; renderQueue(); })));
  const body = el('tbody');
  for (const r of rows) {
    const name = fullName(r.firstName, r.lastName) || r.company || '—';
    body.append(el('tr', { 'data-id': r.id, class: S.sel.has(r.id) ? 'sel' : null },
      el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Zaznacz zamówienie ' + r.number, onchange: ev => { if (ev.target.checked) S.sel.set(r.id, r); else S.sel.delete(r.id); syncSel(); } })),
      el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(r.id), class: 'cell-name', title: 'Otwórz zamówienie ' + r.number }, r.number || r.id), el('div', { class: 'cell-sub' }, dateStr(r.date))),
      el('td', null, el('div', { class: 'cell-name' }, name), r.company && fullName(r.firstName, r.lastName) ? el('div', { class: 'cell-sub' }, r.company) : null),
      el('td', null, [r.postcode, r.city].filter(Boolean).join(' ')),
      isIn ? el('td', null, el('input', { type: 'text', class: 'ship-locker', 'data-id': r.id, value: lockerOf(r), placeholder: 'brak', 'aria-label': 'Paczkomat dla zamówienia ' + r.number,
        title: 'Paczkomat docelowy (np. WAW01M). Zmiana dotyczy tylko tworzonej przesyłki. Przy usłudze kurierskiej pole jest pomijane.', oninput: ev => { S.lockers.set(r.id, ev.target.value.trim()); } })) : null,
      el('td', { class: 'ord-prods' }, r.productsText ? el('span', { title: r.productsText }, r.productsText.length > 60 ? r.productsText.slice(0, 58).trimEnd() + '…' : r.productsText) : ''),
      el('td', { class: 'n nw' }, r.total == null || r.total === '' ? null : money(r.total), el('div', { class: 'cell-sub' }, r.paid ? 'opłacone' : 'nieopłacone')),
      el('td', null, el('span', { class: 'ord-st neutral', title: 'Status zamówienia: ' + statusName(r.statusId) }, statusName(r.statusId))),
      el('td', { class: 'nw' }, r.tracking ? [el('span', null, r.tracking), ' ', el('button', { type: 'button', class: 'ghost small-btn ship-lbl', 'data-id': r.id, title: 'Pobierz etykietę PDF tej przesyłki',
        onclick: ev => downloadLabels([{ id: r.id, tracking: r.tracking }], ev.target) }, 'Etykieta')] : '')));
  }
  if (!rows.length) body.append(el('tr', null, el('td', { colspan: String(columns(key).length + 1), class: 'empty' }, emptyText())));
  u.results.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'shipTable' }, el('thead', null, head), body)));
  syncSel();
}

function emptyText() {
  const mapped = ((S.meta && S.meta.deliveries) || []).some(d => d.courier === S.view);
  if (!mapped) return el('span', { id: 'shipNoMap' }, 'Żaden sposób dostawy nie jest przypisany do przewoźnika ' + courierName(S.view) + ', więc kolejka jest pusta. ',
    el('a', { href: '#/przesylki/ustawienia', title: 'Przypisz sposoby dostawy do przewoźników' }, 'Przypisz sposoby dostawy w ustawieniach →'));
  return 'Brak zamówień do nadania.' + (store('osa-ship-withtrack') ? '' : ' Zamówienia z numerem przesyłki są ukryte — włącz „Pokaż także nadane”.');
}

function syncSel() {
  const u = S.ui;
  for (const tr of u.results.querySelectorAll('tbody tr[data-id]')) {
    const on = S.sel.has(tr.dataset.id); tr.classList.toggle('sel', on);
    const cb = tr.querySelector('input[type=checkbox]'); if (cb) cb.checked = on;
  }
  const all = u.results.querySelector('#shipSelAll');
  if (all) { const n = S.rows.filter(r => S.sel.has(r.id)).length; all.checked = S.rows.length > 0 && n === S.rows.length; all.indeterminate = n > 0 && n < S.rows.length; }
  renderBar();
}

function renderBar() {
  const u = S.ui, n = S.sel.size;
  if (!u.bar) return;
  u.bar.replaceChildren(
    el('strong', { id: 'shipSelCount' }, n ? 'Zaznaczono: ' + n : 'Nic nie zaznaczono'),
    el('button', { type: 'button', class: 'primary', id: 'shipCreate', disabled: !n, title: n ? 'Utworzy listy przewozowe u przewoźnika dla zaznaczonych zamówień (najpierw poprosimy o potwierdzenie)' : 'Najpierw zaznacz zamówienia w tabeli',
      onclick: startCreate }, 'Utwórz listy przewozowe (' + n + ')'),
    el('button', { type: 'button', class: 'ghost', id: 'shipSelClear', disabled: !n, title: n ? 'Odznacz wszystkie zamówienia' : 'Nic nie jest zaznaczone', onclick: () => { S.sel.clear(); syncSel(); } }, 'Wyczyść zaznaczenie'));
}

function renderCourier() {
  const u = S.ui, key = S.view, name = courierName(key);
  const stSel = el('select', { id: 'shipStatus', 'aria-label': 'Status zamówień', title: 'Pokaż tylko zamówienia w wybranym statusie (np. „Opłacone”). Wybór jest zapamiętywany.',
    onchange: ev => { store('osa-ship-status', ev.target.value || null); loadQueue(); } },
    el('option', { value: '' }, 'Wszystkie statusy'), statuses().map(s => el('option', { value: String(s.id) }, s.name)));
  stSel.value = String(store('osa-ship-status') || '');
  const wt = el('input', { type: 'checkbox', id: 'shipWithTracking', checked: !!store('osa-ship-withtrack'), onchange: ev => { store('osa-ship-withtrack', ev.target.checked); loadQueue(); } });
  u.bar = el('div', { class: 'ord-bulk ship-bar', id: 'shipBar' });
  u.dlg = el('div', { id: 'shipDlg' });
  u.results = el('div', { id: 'shipResults' });
  u.body.replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', null, 'Do nadania — ' + name), el('div', { class: 'sub' }, 'Zamówienia ze sposobem dostawy przypisanym do przewoźnika ' + name + ', jeszcze bez numeru przesyłki.')),
    el('div', { class: 'toolbar' },
      el('label', { class: 'field-inline' }, 'Status', stSel),
      el('label', { class: 'field-inline', title: 'Domyślnie widzisz tylko zamówienia bez numeru przesyłki. Włącz, by zobaczyć także już nadane (np. aby pobrać etykietę).' }, wt, ' Pokaż także nadane'),
      el('button', { type: 'button', class: 'secondary', id: 'shipReload', title: 'Pobierz kolejkę ponownie z Selly', onclick: loadQueue }, 'Odśwież'),
      el('span', { class: 'spacer' }),
      el('a', { href: '#/przesylki/ustawienia', class: 'muted small', title: 'Zmień przypisanie sposobów dostawy do przewoźników' }, 'Ustawienia przewoźników')),
    S.note ? el('div', { class: 'notice warn', role: 'status' }, S.note) : null,
    paramsPanel(key), u.bar, u.dlg, u.results));
  renderBar();
  loadQueue().then(() => { const n = S.ui.body.querySelector('.card .notice'); if (n && !S.note) n.remove(); });
}

// ─── Tworzenie listów ───────────────────────────────────────────────────────

function startCreate() {
  const host = S.ui.dlg, key = S.view, rows = selectedRows(), name = courierName(key);
  if (!rows.length) return;
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Tworzenie listów przewozowych' });
  host.replaceChildren(box);
  const doneAll = new Map();   // id → numer przesyłki
  const close = () => host.replaceChildren();
  const numOf = id => S.numOf.get(String(id)) || id;

  box.replaceChildren(
    el('h3', null, 'Utworzyć listy przewozowe dla ' + cnt(rows.length, 'zamówienia', 'zamówień', 'zamówień') + '?'),
    el('p', null, 'Przewoźnik: ', el('strong', null, name)),
    el('p', { class: 'muted small', id: 'shipParamsText' }, 'Parametry: ' + paramsText(key)),
    el('p', { class: 'muted small' }, 'Listy zostaną utworzone w Selly u przewoźnika (może to naliczyć opłaty). Porcje po ' + maxBatch() + ' zamówień.'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'primary', id: 'shipConfirm', onclick: () => run(rows.map(r => String(r.id))) }, 'Utwórz listy przewozowe'),
      el('button', { type: 'button', class: 'secondary', id: 'shipCancel', onclick: close }, 'Anuluj')));
  box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });

  async function run(ids) {
    const params = buildParams(key), chunks = [];
    for (let i = 0; i < ids.length; i += maxBatch()) chunks.push(ids.slice(i, i + maxBatch()));
    const bar = el('progress', { max: String(ids.length), value: '0', id: 'shipProgress', 'aria-label': 'Postęp tworzenia listów' });
    const label = el('div', { class: 'muted small', role: 'status' }, 'Tworzę: 0 z ' + ids.length);
    box.replaceChildren(el('h3', null, 'Tworzę listy przewozowe…'), bar, label);
    const failed = []; let handled = 0;
    for (const chunk of chunks) {
      const p = { courier: key, orderIds: chunk, params };
      if (key === 'inpost') {
        const per = {};
        for (const id of chunk) { const r = S.rows.find(x => String(x.id) === id); const v = r ? lockerOf(r) : ''; if (v) per[id] = { sending_point: v }; }
        if (Object.keys(per).length) p.perOrder = per;
      }
      try {
        const r = await api('shipping:create', p);
        const okIds = new Set();
        for (const d of r.done || []) { doneAll.set(String(d.id), d.tracking || ''); okIds.add(String(d.id)); S.sel.delete(String(d.id)); }
        for (const f of r.failed || []) { failed.push({ id: String(f.id), error: f.error || 'błąd' }); okIds.add(String(f.id)); }
        for (const id of chunk) if (!okIds.has(id)) failed.push({ id, error: 'brak potwierdzenia z serwera' });
      } catch (e) { for (const id of chunk) failed.push({ id, error: e.message || 'błąd połączenia' }); }
      handled += chunk.length;
      bar.value = handled; label.textContent = 'Tworzę: ' + handled + ' z ' + ids.length;
    }
    summary(failed);
    loadQueue();
  }

  function summary(failed) {
    const done = [...doneAll].map(([id, tracking]) => ({ id, tracking }));
    const stSel = el('select', { id: 'shipNewStatus', 'aria-label': 'Nowy status nadanych', title: 'Status, który ustawimy nadanym zamówieniom' }, statuses().map(s => el('option', { value: String(s.id) }, s.name)));
    const guess = statuses().find(s => /nadan/.test(norm(s.name))); if (guess) stSel.value = String(guess.id);
    box.replaceChildren(
      el('h3', null, failed.length ? 'Listy utworzone z błędami' : 'Listy przewozowe utworzone'),
      el('p', { id: 'shipSummary' }, 'Nadane: ', el('strong', null, String(done.length)), ' · nieudane: ', el('strong', null, String(failed.length))),
      done.length ? el('ul', { class: 'ship-done' }, done.slice(0, 30).map(d => el('li', null, el('strong', null, numOf(d.id)), ' — ' + (d.tracking || 'bez numeru'), ' ',
        el('button', { type: 'button', class: 'ghost small-btn ship-lbl', title: 'Pobierz etykietę PDF tej przesyłki', onclick: ev => downloadLabels([d], ev.target) }, 'Etykieta'))),
        done.length > 30 ? el('li', { class: 'muted' }, '… i ' + (done.length - 30) + ' więcej') : null) : null,
      failed.length ? el('ul', { class: 'ord-fails', id: 'shipFails' }, failed.slice(0, 20).map(f => el('li', null, el('strong', null, numOf(f.id)), ' — ' + f.error)),
        failed.length > 20 ? el('li', { class: 'muted' }, '… i ' + (failed.length - 20) + ' więcej') : null) : null,
      el('div', { class: 'ord-actions' },
        failed.length ? el('button', { type: 'button', class: 'primary', id: 'shipRetry', title: 'Spróbuj ponownie tylko dla zamówień, którym nie udało się utworzyć listu', onclick: () => run(failed.map(f => f.id)) }, 'Ponów nieudane (' + failed.length + ')') : null,
        done.length ? el('button', { type: 'button', class: failed.length ? 'secondary' : 'primary', id: 'shipLabels', title: 'Pobierz etykiety PDF wszystkich nadanych (jedna etykieta — plik PDF, kilka — archiwum ZIP)', onclick: ev => downloadLabels(done, ev.target) }, 'Pobierz etykiety (' + done.length + ')') : null,
        el('button', { type: 'button', class: 'secondary', id: 'shipClose', onclick: close }, 'Zamknij')),
      done.length && statuses().length ? el('div', { class: 'ship-status-row' },
        el('label', { class: 'field-inline', title: 'Ustaw wybrany status dla zamówień, które właśnie nadano (podpowiadamy status z „Nadane” w nazwie)' }, 'Status nadanych', stSel),
        el('button', { type: 'button', class: 'secondary', id: 'shipSetStatus', title: 'Zmienia status nadanych zamówień w Selly (może uruchomić powiadomienia dla klientów, jeśli tak skonfigurowano status)',
          onclick: ev => setStatusDone(box, done.map(d => String(d.id)), stSel.value, ev.target) }, 'Zmień status nadanych')) : null);
  }
}

async function setStatusDone(box, ids, statusId, btn) {
  const batch = Math.max(1, Number(S.ordMeta && S.ordMeta.maxStatusBatch) || 50);
  btn.disabled = true;
  const label = el('div', { class: 'muted small', role: 'status', id: 'shipStatusRes' }, 'Zmieniam status: 0 z ' + ids.length);
  box.append(el('progress', { max: String(ids.length), value: '0', 'aria-label': 'Postęp zmiany statusu' }), label);
  const bar = box.lastElementChild.previousElementSibling;
  let ok = 0, bad = 0;
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    try {
      const r = await api('orders:setStatus', { ids: chunk, statusId });
      const f = (r.failed || []).length;
      ok += (r.done || []).length; bad += f + Math.max(0, chunk.length - (r.done || []).length - f);
    } catch (e) { bad += chunk.length; }
    bar.value = ok + bad; label.textContent = 'Zmieniam status: ' + (ok + bad) + ' z ' + ids.length;
  }
  label.textContent = 'Status „' + statusName(statusId) + '”: zmieniono ' + ok + ', nieudane ' + bad + '.';
  btn.disabled = false;
  loadQueue();
}

// ─── Etykiety ───────────────────────────────────────────────────────────────

function b64Bytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, '')), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

/** items: [{ id, tracking }]. Jedna etykieta → PDF, więcej → ZIP z PDF-ami. */
async function downloadLabels(items, btn) {
  const key = S.view;
  if (btn) btn.disabled = true;
  const bar = items.length > 1 ? el('progress', { max: String(items.length), value: '0', 'aria-label': 'Postęp pobierania etykiet', id: 'shipLblProgress' }) : null;
  const slot = items.length > 1 ? (S.ui.dlg || document.body) : null;
  if (bar && slot) slot.append(bar);
  const files = [], errors = [];
  for (const it of items) {
    try {
      const r = await api('shipping:label', { courier: key, orderId: String(it.id) });
      files.push({ name: 'etykieta-' + safeFile(S.numOf.get(String(it.id)) || it.id) + '.pdf', data: b64Bytes(r.content), type: r.type || 'application/pdf' });
    } catch (e) { errors.push((S.numOf.get(String(it.id)) || it.id) + ': ' + (e.message || 'błąd')); }
    if (bar) bar.value = files.length + errors.length;
  }
  if (bar) bar.remove();
  if (btn) btn.disabled = false;
  if (errors.length) flash('', 'Nie pobrano etykiet: ' + errors.slice(0, 3).join('; ') + (errors.length > 3 ? ' …' : ''));
  if (!files.length) return;
  if (files.length === 1) saveBlob(new Blob([files[0].data], { type: files[0].type }), files[0].name, 'Pobrano etykietę');
  else saveBlob(zipStored(files.map(f => ({ name: f.name, data: f.data })), 'application/zip'), 'etykiety-' + key + '-' + today() + '.zip', 'Pobrano etykiety (' + files.length + ') w archiwum ZIP');
}

// ─── Ustawienia przewoźników ────────────────────────────────────────────────

function renderSettings(msg) {
  const dels = (S.meta && S.meta.deliveries) || [];
  const orig = new Map(dels.map(d => [String(d.id), d.courier || '']));
  const selects = new Map();
  const rows = dels.map(d => {
    const sel = el('select', { id: 'shipMap-' + d.id, 'aria-label': 'Przewoźnik dla: ' + d.name, title: 'Przewoźnik, którego listy przewozowe dotyczą zamówień z tym sposobem dostawy' },
      el('option', { value: '' }, '— brak / automatycznie —'), couriers().map(c => el('option', { value: c.key }, c.name)));
    sel.value = d.courier || ''; selects.set(String(d.id), sel);
    return el('tr', null, el('td', null, d.name), el('td', null, sel),
      el('td', { class: 'muted small' }, d.courier ? (d.manual ? el('span', { class: 'tip', title: 'Przypisane przez Ciebie ręcznie' }, 'ręcznie') : el('span', { class: 'tip', title: 'Przewoźnik rozpoznany po nazwie sposobu dostawy' }, 'wg nazwy')) : ''));
  });
  const res = el('span', { class: 'muted small', id: 'shipMapRes', role: 'status' }, msg || '');
  const save = el('button', { type: 'button', class: 'primary', id: 'shipMapSave', title: 'Zapisuje zmiany przypisań — od razu wpływają na kolejki przewoźników', onclick: async () => {
    const map = {};
    for (const [id, sel] of selects) if (sel.value !== orig.get(id)) map[id] = sel.value;
    if (!Object.keys(map).length) { res.textContent = 'Brak zmian do zapisania.'; return; }
    save.disabled = true; res.textContent = 'Zapisuję…';
    try { await api('shipping:setMap', { map }); S.meta = null; S.sel.clear(); await ensureMeta(); flash('', 'Zapisano przypisania przewoźników'); renderSegs(); renderSettings('Zapisano (' + Object.keys(map).length + ').'); }
    catch (e) { res.textContent = 'Nie udało się zapisać: ' + (e.message || 'błąd'); save.disabled = false; }
  } }, 'Zapisz przypisania');
  S.ui.body.replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', null, 'Ustawienia przewoźników'), el('div', { class: 'sub' }, 'Wskaż, którym przewoźnikiem wysyłasz zamówienia z danym sposobem dostawy. Bez przypisania kolejka przewoźnika jest pusta.')),
    dels.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'shipMapTable' },
      el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Sposób dostawy skonfigurowany w sklepie' }, 'Sposób dostawy')), el('th', null, el('span', { title: 'Przewoźnik, który realizuje ten sposób dostawy' }, 'Przewoźnik')),
        el('th', null, el('span', { title: 'Skąd wiadomo, jaki to przewoźnik: z nazwy sposobu dostawy albo z Twojego ręcznego wyboru' }, 'Źródło')))),
      el('tbody', null, rows))) : el('div', { class: 'empty' }, 'Sklep nie ma jeszcze skonfigurowanych sposobów dostawy.'),
    el('div', { class: 'ord-actions' }, save, res)));
}

function renderOther(key) {
  const o = OTHER[key], href = o.external ? adminUrl() + o.query : o.href;
  S.ui.body.replaceChildren(el('div', { class: 'card', id: 'shipOther' },
    el('div', { class: 'card-head' }, el('h2', null, o.title)),
    el('p', null, o.text),
    o.external ? sellyLink(o.link, href, o.tip) : el('a', { href, class: 'btn-link', title: o.tip }, o.link)));
}

// ─── Trasa ──────────────────────────────────────────────────────────────────

async function mountRoute() {
  const my = ++S.routeSeq, u = S.ui;
  if (!S.meta) {
    u.body.replaceChildren(el('div', { class: 'card' }, loadingBox('Wczytuję przesyłki…')));
    await ensureMeta();
    if (my !== S.routeSeq) return;
    if (!S.meta) { u.body.replaceChildren(unavailableBox(S.metaErr && !isUnavailable(S.metaErr) ? 'Nie udało się otworzyć przesyłek: ' + S.metaErr.message : MSG_UNAVAILABLE)); return; }
  }
  const part = S.route;
  const view = part === 'ustawienia' || OTHER[part] ? part : isCourier(part) ? part : (isCourier(store('osa-ship-courier')) ? store('osa-ship-courier') : 'inpost');
  if (view !== S.view) { S.sel.clear(); S.rows = []; S.note = ''; S.lockers.clear(); }
  S.view = view;
  if (isCourier(view)) store('osa-ship-courier', view);
  renderSegs();
  if (view === 'ustawienia') renderSettings();
  else if (OTHER[view]) renderOther(view);
  else renderCourier();
}

export default {
  id: 'przesylki',
  title: 'Przesyłki',
  routes: ['', '<kurier>', 'ustawienia'],
  mount(el0, params) {
    if (!S.root) { S.root = el0; build(); }
    S.route = (params && params.parts && params.parts[0]) || '';
    mountRoute();
  },
  unmount() { S.seq++; S.routeSeq++; },
};
