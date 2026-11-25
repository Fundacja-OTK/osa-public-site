// Moduł „Przesyłki”: kolejka zamówień do nadania per przewoźnik (InPost, DPD, DHL, Orlen Paczka, UPS — listy przez API; Furgonetka,
// Rohlig Suus, Poczta Polska — „Utwórz przesyłkę” / „Prześlij do bufora” formularzem panelu Selly, jak robi to Selly), filtry / strony /
// sortowanie w adresie, tworzenie listów w porcjach, etykiety, zmiana statusu oraz przypisanie sposobów dostawy (#/przesylki/ustawienia).
// Dane i zapisy: backend Cloudflare (shipping:meta, shipping:setMap, shipping:queue, shipping:create, shipping:label, shipping:manualForm,
// shipping:manualCreate, orders:meta, orders:setStatus).
import { el, store, flash, norm, money, dateStr, fullName, cnt, isUnavailable, loadingBox, sellyLink, sortTh, saveBlob, zipStored, today, dateInput, debounce, pager, filterLayout, filterSection, multiSelect, dateRange, statusPill, orderStatusTone } from '../core/ui.js?v=fb40452';
import { api, ctx } from '../core/client.js?v=fb40452';
import { go } from '../core/router.js?v=fb40452';
import { registerListKeys } from '../core/listKeys.js?v=fb40452';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const MSG_UNAVAILABLE = 'Moduł Przesyłki wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';
const COURIER_FALLBACK = [{ key: 'inpost', name: 'InPost' }, { key: 'dpd', name: 'DPD' }, { key: 'dhl', name: 'DHL' }, { key: 'orlenpaczka', name: 'Orlen Paczka' }, { key: 'ups', name: 'UPS' }];
const OTHER = {
  fedex: { name: 'FedEx', title: 'FedEx — przez magazyn SpeedMail', text: 'Przesyłki FedEx nie są nadawane z panelu — idą przez magazyn SpeedMail, poza Selly. Zamówienia do wysyłki SpeedMail przygotujesz w module Magazyny.',
    href: '#/speedmail', link: 'Otwórz wysyłkę SpeedMail →', tip: 'Przechodzi do kreatora wysyłki SpeedMail', external: false },
};
// Przewoźnicy bez tworzenia listów przez API (jak MANUAL w Workerze); native = podgląd listy z Selly w panelu (adminNative.js)
const MANUAL_FALLBACK = [{ key: 'furgonetka', name: 'Furgonetka.pl', screen: 'furgonetka.przesylki' }, { key: 'suus', name: 'Rohlig Suus', screen: 'suus.przesylki' }, { key: 'poczta', name: 'Poczta Polska', screen: 'enadawca.przesylki' }];
const NATIVE = { furgonetka: 'furgonetka', suus: 'suus' };
// Akcje formularzem Selly (Worker: SHIP_FORMS). Dostępne dopiero, gdy meta.manual[].ship[kind] = true (struktura potwierdzona sondą shipprobe).
const MANUAL_KINDS = { furgonetka: ['create', 'buffer'], suus: ['create'], poczta: ['create', 'buffer'] };
const KIND = {
  create: { one: 'Utwórz przesyłkę', many: 'Utwórz przesyłki', doing: 'Tworzę przesyłki…', done: 'Przesyłki utworzone', fail: 'Przesyłki utworzone z błędami', id: 'shipManCreate',
    tip: 'Utworzy przesyłkę u przewoźnika tak, jak przycisk „Utwórz przesyłkę” w Selly (formularz Selly na Twojej sesji). Najpierw pokażemy formularz i podsumowanie.' },
  buffer: { one: 'Prześlij do bufora', many: 'Prześlij do bufora', doing: 'Przesyłam do bufora…', done: 'Przesłano do bufora', fail: 'Przesłano do bufora z błędami', id: 'shipManBuffer',
    tip: 'Przekaże zamówienie do bufora przesyłek przewoźnika tak, jak „Prześlij do bufora” w Selly. Najpierw poprosimy o potwierdzenie.' },
};
const MSG_UNVERIFIED = 'Wymaga potwierdzenia struktury formularza Selly (administrator: uruchom shipprobe). Do tego czasu zrób to w Selly — „Utwórz w Selly ↗” w menu ▾ wiersza.';
const DL_KEY = 'osa-ship-dl';   // identyfikatory zamówień, których etykiety pobrano w tej przeglądarce

// ─── Parametry listu wg przewoźnika ─────────────────────────────────────────
// type: select | checks | flag | text | date; adv — schowane w „Więcej opcji”. Wartości: select/text/date → tekst, checks → tablica, flag → bool.
// Domyślnie NIC nie wysyłamy (wartość '' = „wg ustawień integracji w Selly”): Selly bierze wtedy usługę, gabaryt, sposób nadania itd.
// z konfiguracji integracji przewoźnika (Konfiguracja → Integracje). Nazwy parametrów są ze specyfikacji Selly API 1.10;
// NIEZWERYFIKOWANE na żywym API (utworzenie listu kosztuje): dokładne WARTOŚCI opcji poniżej — przyjęte za API przewoźników
// (InPost ShipX: inpost_locker_standard, small/medium/large, parcel_locker/pok/pop/branch/dispatch_order; DHL24: kody produktów,
// ENVELOPE/PACKAGE/PALLET; DPD: TIME0930…), a formularze integracji w Selly (docs/selly-screens/configuration.integracja*.md)
// pokazują tylko etykiety, np. „Kurier doręczenie 10:00 (courier_express_1000)”, „[AM] przesyłka krajowa” (DHL24: AH).
// Potwierdzone etykietami Selly: DHL selectedDropOffType (REQUEST_COURIER / REGULAR_PICKUP), gabaryty A/B/C i skrytki S/M/L.
const o3 = (v, l, t) => [v, l, t];
const BY_SELLY = o3('', 'wg ustawień integracji w Selly', 'Bez wskazania — obowiązuje ustawienie zapisane w konfiguracji integracji przewoźnika w Selly');
const PARAMS = {
  inpost: [
    { key: 'service', label: 'Usługa', type: 'select', def: '', tip: 'Rodzaj przesyłki InPost: do paczkomatu albo kurierska. „Wg ustawień integracji” = usługa z konfiguracji InPost w Selly.',
      options: [BY_SELLY, o3('inpost_locker_standard', 'Paczkomat (standard)', 'Paczka odbierana przez klienta w paczkomacie'), o3('inpost_courier_standard', 'Kurier (standard)', 'Paczka doręczana kurierem pod adres')] },
    { key: 'parcel_template', label: 'Gabaryt paczki', type: 'select', def: '', tip: 'Rozmiar skrytki w paczkomacie (A, B lub C). „Wg ustawień integracji” = gabaryt z konfiguracji InPost w Selly.',
      options: [BY_SELLY, o3('small', 'A — mała', 'Skrytka A: najmniejsza (8 × 38 × 64 cm)'), o3('medium', 'B — średnia', 'Skrytka B: średnia (19 × 38 × 64 cm)'), o3('large', 'C — duża', 'Skrytka C: największa (41 × 38 × 64 cm)')] },
    { key: 'sending_method', label: 'Jak nadasz paczkę', type: 'select', def: '', tip: 'Gdzie fizycznie oddasz paczki InPost (zostaw „wg ustawień integracji”, jeśli nie wiesz)',
      options: [BY_SELLY, o3('parcel_locker', 'nadam w paczkomacie', 'Zaniesiesz paczki do dowolnego paczkomatu'), o3('pok', 'nadam w punkcie obsługi (POK)', 'Punkt Obsługi Klienta InPost'),
        o3('pop', 'nadam w punkcie partnerskim (POP)', 'Punkt Obsługi Paczek — sklep lub punkt partnera'), o3('branch', 'nadam w oddziale', 'Oddział InPost'), o3('dispatch_order', 'odbiór przez kuriera', 'Kurier InPost odbierze paczki z Twojego adresu (wymaga zamówienia odbioru)')] },
    { key: 'additional_service', label: 'Usługi dodatkowe', type: 'checks', tip: 'Dodatkowe usługi InPost (płatne według cennika)',
      options: [o3('insurance', 'ubezpieczenie', 'Ubezpieczenie przesyłki'), o3('cod', 'pobranie', 'Płatność za pobraniem przy odbiorze'), o3('end_of_week_collection', 'paczka w weekend', 'Nadanie z odbiorem w weekend (Paczka w Weekend)')] },
    { key: 'sending_point', label: 'Punkt nadania', type: 'text', adv: true, tip: 'Kod paczkomatu lub punktu, w którym NADASZ paczki (np. przy „nadam w paczkomacie”). To nie jest paczkomat odbiorcy — ten jest w kolumnie „Paczkomat”.', ph: 'np. WAW01M' },
    { key: 'service_custom', label: 'Własny kod usługi', type: 'text', adv: true, tip: 'Jeśli wpiszesz tu kod usługi InPost (np. inpost_locker_pass_thru), zastąpi wybór „Usługa” powyżej', ph: 'np. inpost_locker_pass_thru' },
  ],
  dpd: [
    { key: 'guarantee_type', label: 'Gwarancja doręczenia', type: 'select', def: '', tip: 'Gwarantowana godzina lub dzień doręczenia (usługa płatna)',
      options: [o3('', 'brak / wg ustawień integracji', 'Zwykłe doręczenie bez gwarancji (albo ustawienie z integracji DPD w Selly)'), o3('TIME0930', 'do 9:30', 'Doręczenie do godz. 9:30'), o3('TIME1200', 'do 12:00', 'Doręczenie do godz. 12:00'), o3('TIMEFIXED', 'w ustalonej godzinie', 'Doręczenie o wskazanej godzinie'),
        o3('SATURDAY', 'w sobotę', 'Doręczenie w sobotę'), o3('INTER', 'międzynarodowa', 'Gwarancja dla przesyłek zagranicznych')] },
    { key: 'package_services', label: 'Usługi dodatkowe', type: 'checks', adv: true, tip: 'Dodatkowe usługi DPD wg specyfikacji (kody usług)',
      options: [o3('CarryIn', 'wniesienie (CarryIn)', 'Wniesienie przesyłki do wnętrza budynku'), o3('CUD', 'potwierdzenie doręczenia (CUD)', 'Kod usługi DPD CUD'), o3('DOX', 'dokumenty (DOX)', 'Przesyłka dokumentowa'), o3('Duty', 'cło / opłaty (Duty)', 'Obsługa opłat celnych'),
        o3('InPers', 'do rąk własnych (InPers)', 'Doręczenie do rąk wskazanej osoby'), o3('PrivPers', 'osoba prywatna (PrivPers)', 'Doręczenie do osoby prywatnej'), o3('ROD', 'zwrot dokumentów (ROD)', 'Zwrot podpisanych dokumentów do nadawcy'),
        o3('SelfCol', 'odbiór własny (SelfCol)', 'Odbiór własny przez odbiorcę'), o3('Pickup', 'odbiór od nadawcy (Pickup)', 'Kurier odbiera paczkę od nadawcy')] },
  ],
  dhl: [
    { key: 'incomingDate', label: 'Data nadania', type: 'date', def: '', tip: 'Dzień, w którym DHL odbierze lub przyjmie paczki (domyślnie dziś)' },
    { key: 'selectedDropOffType', label: 'Sposób przekazania', type: 'select', def: '', tip: 'Jak przekażesz paczki DHL',
      options: [BY_SELLY, o3('REQUEST_COURIER', 'zamów kuriera', 'Kurier DHL odbierze paczki w dniu nadania'), o3('REGULAR_PICKUP', 'stały odbiór', 'Masz stałą umowę na regularny odbiór')] },
    { key: 'selectedPackage', label: 'Rodzaj paczki', type: 'select', def: '', tip: 'Typ przesyłki',
      options: [BY_SELLY, o3('PACKAGE', 'paczka', 'Standardowa paczka'), o3('ENVELOPE', 'koperta', 'Przesyłka płaska/dokumenty'), o3('PALLET', 'paleta', 'Przesyłka paletowa')] },
    { key: 'shipTypes', label: 'Produkt DHL', type: 'select', def: '', adv: true, tip: 'Kod produktu DHL wg specyfikacji',
      options: [BY_SELLY, o3('AH', 'AH — krajowa standard', 'Kod produktu DHL: AH'), o3('09', '09 — do 9:00', 'Doręczenie do 9:00'), o3('12', '12 — do 12:00', 'Doręczenie do 12:00'), o3('EK', 'EK', 'Kod produktu DHL: EK'),
        o3('PI', 'PI', 'Kod produktu DHL: PI'), o3('PR', 'PR', 'Kod produktu DHL: PR'), o3('CP', 'CP', 'Kod produktu DHL: CP'), o3('CM', 'CM', 'Kod produktu DHL: CM')] },
    { key: 'services', label: 'Usługi dodatkowe', type: 'checks', adv: true, tip: 'Dodatkowe usługi DHL (płatne według cennika)',
      options: [o3('PDI', 'PDI', 'Kod usługi DHL: PDI'), o3('POD', 'potwierdzenie doręczenia (POD)', 'Potwierdzenie doręczenia'), o3('deliveryEvening', 'doręczenie wieczorem', 'Doręczenie w godzinach wieczornych'),
        o3('deliveryOnSaturday', 'doręczenie w sobotę', 'Doręczenie w sobotę'), o3('pickupOnSaturday', 'odbiór w sobotę', 'Odbiór paczki w sobotę'), o3('receiverPreaviso', 'powiadomienie odbiorcy', 'Awizo (preaviso) dla odbiorcy')] },
  ],
  orlenpaczka: [
    { key: 'box_size', label: 'Rozmiar paczki', type: 'select', def: '', tip: 'Rozmiar skrytki w punkcie Orlen Paczka',
      options: [BY_SELLY, o3('S', 'S — mała', 'Skrytka S'), o3('M', 'M — średnia', 'Skrytka M'), o3('L', 'L — duża', 'Skrytka L')] },
    { key: 'insurance', label: 'Ubezpieczenie', type: 'flag', def: false, tip: 'Dodaje ubezpieczenie paczki' },
    { key: 'transfer_description', label: 'Opis przesyłki', type: 'text', adv: true, tip: 'Krótki opis zawartości widoczny na przesyłce', ph: 'np. materiały orszakowe' },
  ],
  ups: [
    { key: 'notification_enable', label: 'Powiadomienia dla odbiorcy', type: 'flag', def: false, tip: 'UPS wyśle odbiorcy powiadomienia o przesyłce' },
    { key: 'saturday_delivery_indicator', label: 'Doręczenie w sobotę', type: 'flag', def: false, tip: 'Doręczenie przesyłki w sobotę' },
    { key: 'saturday_pickup_indicator', label: 'Odbiór w sobotę', type: 'flag', def: false, tip: 'Odbiór paczki od nadawcy w sobotę' },
  ],
};

// v2: wcześniejsze wersje zapamiętywały zgadnięte wartości domyślne (np. usługa, gabaryt) — teraz domyślnie „wg ustawień integracji”
const PARAMS_KEY = 'osa-ship-params2-';
const S = {
  root: null, ui: {}, meta: null, metaErr: null, metaLoading: false, ordMeta: null,
  view: 'inpost', route: null, Q: null, built: '', loaded: false,
  rows: [], total: 0, note: '', loading: false, err: '', sel: new Map(), lockers: new Map(), numOf: new Map(),
  counts: {}, seq: 0, routeSeq: 0, params: {}, dl: new Set((() => { const v = store(DL_KEY); return Array.isArray(v) ? v.map(String) : []; })()),
};

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const couriers = () => (S.meta && S.meta.couriers && S.meta.couriers.length ? S.meta.couriers : COURIER_FALLBACK);
const manuals = () => ((S.meta && S.meta.manual && S.meta.manual.length ? S.meta.manual : MANUAL_FALLBACK).map(m => Object.assign({ native: NATIVE[m.key] || '' }, m)));
const manualOf = k => manuals().find(x => x.key === k) || null;
const manKinds = k => MANUAL_KINDS[k] || ['create'];
/** Akcja formularzem Selly potwierdzona (SHIP_FORMS verified) — inaczej przycisk wyłączony z wyjaśnieniem. */
const shipReady = (k, kind) => { const m = manualOf(k); return !!(m && m.ship && m.ship[kind] === true); };
const courierName = k => { const c = couriers().find(x => x.key === k) || manualOf(k); return c ? c.name : k; };
const maxBatch = () => Math.max(1, Number(S.meta && S.meta.maxBatch) || 10);
const statuses = () => (S.ordMeta && S.ordMeta.statuses) || [];
const statusName = id => { const s = statuses().find(x => String(x.id) === String(id)); return s ? s.name : (id == null || id === '' ? '—' : 'Status ' + id); };
const lockerOf = r => (S.lockers.has(String(r.id)) ? S.lockers.get(String(r.id)) : (r.locker || ''));
const safeFile = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '-');
const isCourier = k => !!k && couriers().some(c => c.key === k);
const isCarrier = k => isCourier(k) || !!manualOf(k);
const LOCKER_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/i;   // jak w Workerze (shipping.js)
/** Paczkomat zmieniony w kolejce względem zamówienia (pusty / taki sam → null). */
const lockerChange = r => { const v = S.lockers.has(String(r.id)) ? S.lockers.get(String(r.id)).toUpperCase() : ''; return v && v !== String(r.locker || '').toUpperCase() ? v : null; };
const isCourierService = key => key === 'inpost' && /courier/.test(buildParams('inpost').service || '');

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
  const saved = store(PARAMS_KEY + key) || {}, v = {};
  for (const d of PARAMS[key] || []) {
    const s = saved[d.key];
    v[d.key] = d.type === 'checks' ? (Array.isArray(s) ? s : []) : d.type === 'flag' ? (s == null ? !!d.def : !!s) : (s == null ? (d.def || '') : String(s));
  }
  return (S.params[key] = v);
}
function saveParams(key) {
  const v = Object.assign({}, S.params[key]); delete v.incomingDate;
  store(PARAMS_KEY + key, v);
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
  return parts.join(' · ') || 'wg ustawień integracji w Selly';
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

// ─── Stan widoku ↔ adres: #/przesylki/<kurier>?status=3,5&q=..&page=2&size=50&sort=total&dir=desc ──
// Filtry, strona i sortowanie żyją w adresie (link do widoku działa, „Wstecz” wraca do poprzedniego).

const SIZES = [10, 25, 50, 100], DEF_SIZE = 25;
const SORTS = ['date', 'age', 'number', 'client', 'total', 'status', 'tracking', 'delivery', 'locker'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const numStr = s => (s !== '' && Number.isFinite(Number(s)) ? s : '');
const csvIds = s => String(s || '').split(',').map(x => x.trim()).filter(x => /^\d{1,12}$/.test(x)).slice(0, 50).join(',');

function readQ(query) {
  const g = k => String((query && query.get(k)) || '').slice(0, 300);
  const size = Number(g('size'));
  return {
    q: g('q').trim().slice(0, 100), status: csvIds(g('status')), from: DAY.test(g('from')) ? g('from') : '', to: DAY.test(g('to')) ? g('to') : '',
    vmin: numStr(g('vmin')), vmax: numStr(g('vmax')), deliv: csvIds(g('deliv')),
    label: ['with', 'all'].includes(g('label')) ? g('label') : 'none', locker: ['bad', 'missing'].includes(g('locker')) ? g('locker') : '',
    page: Math.max(1, parseInt(g('page'), 10) || 1), size: SIZES.includes(size) ? size : DEF_SIZE,
    sort: SORTS.includes(g('sort')) ? g('sort') : 'date', dir: g('dir') === 'desc' ? 'desc' : 'asc',
  };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  for (const k of ['q', 'status', 'from', 'to', 'vmin', 'vmax', 'deliv', 'locker']) if (Q[k]) p.set(k, Q[k]);
  if (Q.label && Q.label !== 'none') p.set('label', Q.label);
  if (Q.size && Q.size !== DEF_SIZE) p.set('size', String(Q.size));
  if (Q.sort !== 'date' || Q.dir !== 'asc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  if (Q.page > 1) p.set('page', String(Q.page));
  const s = p.toString();
  return s ? '?' + s : '';
}
/** Zakładki przewoźników niosą filtry wspólne (status, daty, etykieta, rozmiar strony) — reszta dotyczy jednego przewoźnika. */
const tabQs = () => (S.Q ? qsOf({ status: S.Q.status, from: S.Q.from, to: S.Q.to, label: S.Q.label, size: S.Q.size, sort: 'date', dir: 'asc', page: 1 }) : '');
const activeFilters = Q => ['status', 'from', 'to', 'vmin', 'vmax', 'deliv', 'locker'].filter(k => Q[k]).length + (Q.label !== 'none' ? 1 : 0);

/** Zmiana filtrów / strony: nowy adres (replace — bez wpisu w historii, np. pisanie w wyszukiwarce). */
function setQ(patch, replace) {
  const n = Object.assign({}, S.Q, patch);
  if (!('page' in patch)) n.page = 1;
  const h = '/przesylki/' + S.view + qsOf(n);
  if (location.hash === '#' + h) { S.Q = n; loadQueue(); return; }
  go(h, replace ? { replace: true } : undefined);
}

// ─── Powłoka: zakładki przewoźników ────────────────────────────────────────

const MONO = { inpost: 'IP', dpd: 'DPD', dhl: 'DHL', orlenpaczka: 'OP', ups: 'UPS', furgonetka: 'F', suus: 'RS', poczta: 'PP', fedex: 'FX' };
// Ekrany przesyłek przewoźnika w panelu Selly (docs/selly-screens; wyszukiwanie po numerze zamówienia: parametr `st`)
const SELLY_SCREEN = { inpost: 'inpost.listOrders', dpd: 'dpd.przesylki', orlenpaczka: 'pwr.przesylki' };
const screenOf = k => (manualOf(k) && manualOf(k).screen) || SELLY_SCREEN[k] || '';
// Śledzenie u przewoźnika (strony publiczne; numer w parametrze, zakodowany)
const TRACK_URL = { inpost: 'https://inpost.pl/sledzenie-przesylek?number=', dpd: 'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=',
  dhl: 'https://www.dhl.com/pl-pl/home/sledzenie.html?tracking-id=', ups: 'https://www.ups.com/track?loc=pl_PL&tracknum=', poczta: 'https://emonitoring.poczta-polska.pl/?numer=' };

function build() {
  const u = S.ui;
  u.segs = el('nav', { class: 'ord-segs ship-segs', 'aria-label': 'Przewoźnik' });
  u.body = el('div', { class: 'ship-body' });
  S.root.append(el('div', { class: 'ship-wrap' },
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', { id: 'shipTitle' }, 'Przesyłki'), el('div', { class: 'sub' }, 'Zamówienia do nadania, listy przewozowe i etykiety — osobno dla każdego przewoźnika. Liczba przy przewoźniku = zamówienia bez etykiety.')),
      u.segs),
    u.body));
}

function renderSegs() {
  const qs = tabQs(), withSt = !!(S.Q && (S.Q.status || S.Q.from || S.Q.to));
  const seg = (id, label, tip, n) => el('a', { class: 'chip ship-seg', id: 'shipSeg-' + id, href: '#/przesylki/' + id + (id === 'ustawienia' || OTHER[id] ? '' : qs), 'aria-current': S.view === id ? 'page' : null, title: tip },
    MONO[id] ? el('span', { class: 'ship-ico', 'aria-hidden': 'true' }, MONO[id]) : null, label,
    n != null ? el('span', { class: 'ord-n', title: cnt(n, 'zamówienie', 'zamówienia', 'zamówień') + ' bez etykiety (numeru przesyłki)' + (withSt ? ' w wybranych statusach / datach' : '') + ' ze sposobem dostawy przypisanym do ' + label }, String(n)) : null);
  S.ui.segs.replaceChildren(
    ...couriers().map(c => seg(c.key, c.name, 'Kolejka do nadania przez ' + c.name + ' — listy przewozowe tworzysz stąd (przez integrację w Selly)', S.counts[c.key])),
    ...manuals().map(c => seg(c.key, c.name, c.name + ': kolejka zamówień do nadania; przesyłkę tworzymy formularzem panelu Selly (jak przycisk w Selly — ten przewoźnik nie ma tego w API Selly)', S.counts[c.key])),
    seg('fedex', 'FedEx', 'FedEx idzie przez magazyn SpeedMail — poza Selly'),
    seg('ustawienia', 'Ustawienia przewoźników ⚙', 'Przypisz sposoby dostawy ze sklepu do przewoźników — od tego zależy, co trafia do kolejki'));
}

// ─── Kolejka: dane ──────────────────────────────────────────────────────────

function queueParams(Q) {
  const p = { courier: S.view, page: Q.page, pageSize: Q.size, sort: Q.sort, dir: Q.dir, label: Q.label };
  if (Q.q) p.q = Q.q;
  if (Q.status) p.statusIds = Q.status.split(',');
  if (Q.from) p.dateFrom = Q.from;
  if (Q.to) p.dateTo = Q.to;
  if (Q.vmin) p.valueMin = Number(Q.vmin);
  if (Q.vmax) p.valueMax = Number(Q.vmax);
  if (Q.deliv) p.deliveryIds = Q.deliv.split(',');
  if (Q.locker) p.locker = Q.locker;
  return p;
}

const SORT_VAL = {
  number: r => Number(r.id), date: r => r.date, age: r => r.date, client: r => norm(fullName(r.lastName, r.firstName) || r.company), city: r => r.city, locker: r => lockerOf(r),
  status: r => statusName(r.statusId), total: r => (r.total == null || r.total === '' ? null : Number(r.total)), tracking: r => r.tracking, delivery: r => r.delivery,
};
/** Zapasowy backend zwraca całą kolejkę bez `total` — wtedy filtrujemy, sortujemy i dzielimy na strony tutaj (te same reguły co Worker). */
function localPage(all, Q) {
  const st = Q.status ? Q.status.split(',') : [], dv = Q.deliv ? Q.deliv.split(',') : [], q = norm(Q.q);
  const rows = all.filter(r => (!st.length || st.includes(String(r.statusId))) && (!dv.length || dv.includes(String(r.deliveryId)))
    && (Q.label === 'all' || (Q.label === 'with' ? !!r.tracking : !r.tracking))
    && (!Q.from || String(r.date).slice(0, 10) >= Q.from) && (!Q.to || String(r.date).slice(0, 10) <= Q.to)
    && (!Q.vmin || Number(r.total) >= Number(Q.vmin)) && (!Q.vmax || Number(r.total) <= Number(Q.vmax))
    && (Q.locker !== 'bad' || (lockerOf(r) && !LOCKER_RE.test(lockerOf(r)))) && (Q.locker !== 'missing' || !lockerOf(r))
    && (!q || norm([r.number, r.firstName, r.lastName, r.company, r.city, r.postcode, r.tracking, r.locker, r.delivery].join(' ')).includes(q)));
  const f = SORT_VAL[Q.sort] || SORT_VAL.date, k = (Q.dir === 'asc' ? 1 : -1) * (Q.sort === 'age' ? -1 : 1);
  rows.sort((a, b) => {
    const x = f(a), y = f(b), ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex && ey ? 0 : ex ? 1 : -1;
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'pl', { numeric: true })) * k;
  });
  return { rows: rows.slice((Q.page - 1) * Q.size, Q.page * Q.size), total: rows.length, waiting: all.filter(r => !r.tracking).length };
}

async function loadQueue() {
  const my = ++S.seq, u = S.ui, Q = S.Q, key = S.view;
  S.loading = true; S.err = '';
  if (u.results) { if (!S.loaded) u.results.replaceChildren(loadingBox('Pobieram zamówienia do nadania…')); else u.results.setAttribute('aria-busy', 'true'); }
  try {
    const r = await api('shipping:queue', queueParams(Q));
    if (my !== S.seq) return;
    S.note = r.note || '';
    if (r.total == null) {   // zapas / starszy backend: cała kolejka naraz
      const v = localPage(r.rows || [], Q);
      S.rows = v.rows; S.total = v.total; S.counts[key] = v.waiting;
    } else {
      S.rows = r.rows || []; S.total = Number(r.total) || 0;
      if (r.counts) Object.assign(S.counts, r.counts);
    }
    for (const x of S.rows) { S.numOf.set(String(x.id), x.number || x.id); if (S.sel.has(String(x.id))) S.sel.set(String(x.id), x); }
    S.loaded = true;
  } catch (e) {
    if (my !== S.seq) return;
    S.rows = []; S.total = 0; S.err = isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać kolejki.');
  }
  S.loading = false;
  if (u.results) u.results.removeAttribute('aria-busy');
  const pages = Math.max(1, Math.ceil(S.total / Q.size));
  if (!S.err && Q.page > pages && S.total > 0) { setQ({ page: pages }, true); return; }
  renderSegs();
  renderQueue();
}

// ─── Kolejka: tabela ────────────────────────────────────────────────────────

const ageDays = d => { const t = Date.parse(String(d || '').replace(' ', 'T')); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : null; };
const ageText = n => (n == null ? '—' : n === 0 ? 'dziś' : cnt(n, 'dzień', 'dni', 'dni'));
const isDownloaded = id => S.dl.has(String(id));
function markDownloaded(ids) {
  for (const id of ids) S.dl.add(String(id));
  store(DL_KEY, [...S.dl].slice(-3000));   // tylko identyfikatory zamówień (bez danych klientów)
}
const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

function columns(key) {
  const manual = !!manualOf(key);
  const cols = [
    { label: 'Zamówienie', sorts: [{ sort: 'number', label: 'Nr', tip: 'Sortuj po numerze zamówienia' }, { sort: 'date', label: 'Data', tip: 'Sortuj po dacie złożenia (najpierw najstarsze)', firstDir: 'asc' }],
      tip: 'Numer zamówienia (otwiera szczegóły w panelu), data złożenia i zamówione produkty' },
    { label: 'Wiek', sort: 'age', num: true, tip: 'Ile dni minęło od złożenia zamówienia. Wyróżnione — czeka 3 dni lub dłużej.', tipHeader: true },
    { label: 'Odbiorca', sort: 'client', tip: 'Dane do wysyłki z zamówienia: imię i nazwisko lub firma, ulica, kod pocztowy i miejscowość', tipHeader: true },
    { label: 'Dostawa', sort: 'delivery', tip: 'Sposób dostawy wybrany przez klienta (od niego zależy przewoźnik — patrz „Ustawienia przewoźników”)', tipHeader: true },
  ];
  if (key === 'inpost') cols.push({ label: 'Paczkomat', sort: 'locker', tip: 'Paczkomat odbiorcy wybrany w zamówieniu. Możesz go poprawić — przy tworzeniu listu nowy kod zapiszemy w zamówieniu w Selly (stamtąd czyta go integracja InPost). Nieprawidłowy kod jest podświetlony.', tipHeader: true });
  cols.push(
    { label: 'Wartość', sort: 'total', num: true, tip: 'Wartość zamówienia z dostawą (zł) i informacja, czy jest opłacone', tipHeader: true },
    { label: 'Status', sort: 'status', tip: 'Aktualny status zamówienia w Selly (kolor wg rodzaju statusu)', tipHeader: true },
    { label: 'Notatki', tip: 'Uwaga do zamówienia (⚑, wpisana w panelu) i komentarz klienta. Najedź, aby zobaczyć całość.', tipHeader: true },
    { label: 'Przesyłka', sort: 'tracking', tip: manual ? 'Numer przesyłki, jeśli została już utworzona w Selly. Puste = jeszcze nienadane.'
      : 'Stan listu przewozowego: brak, utworzony (numer przesyłki) albo etykieta już pobrana w tej przeglądarce', tipHeader: true },
    { label: 'Akcje', tip: manual ? 'Utworzenie przesyłki w panelu Selly i inne akcje dla zamówienia' : 'Utworzenie listu przewozowego, pobranie etykiety i inne akcje dla zamówienia', tipHeader: true });
  return cols;
}

/** Małe menu „▾” w wierszu: linki (<a>, działa Ctrl+klik) i akcje. items: [{ label, href?, ext?, run?, tip, write? }] */
function rowMenu(r, items) {
  const btn = el('button', { type: 'button', class: 'ghost small-btn ship-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Więcej akcji dla zamówienia ' + (r.number || r.id),
    title: 'Więcej akcji: zamówienie w panelu i w Selly, śledzenie, zmiana statusu' }, '▾');
  const pop = el('div', { class: 'menu-pop', role: 'menu', hidden: true }, items.filter(Boolean).map(it => (it.href
    ? el('a', { class: 'menu-item', role: 'menuitem', href: it.href, title: it.tip || null, target: it.ext ? '_blank' : null, rel: it.ext ? 'noopener' : null, onclick: () => close() }, it.label)
    : el('button', { type: 'button', class: 'menu-item', role: 'menuitem', title: it.tip || null, write: it.write || null, disabled: !!it.disabled, onclick: () => { close(); it.run(); } }, it.label))));
  const wrap = el('span', { class: 'menu ship-rowmenu' }, btn, pop);
  const onDoc = ev => { if (!wrap.contains(ev.target)) close(); };
  function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', onDoc, true); }
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); document.addEventListener('mousedown', onDoc, true);
    const f = pop.querySelector('.menu-item'); if (f) f.focus();
  });
  wrap.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !pop.hidden) { ev.stopPropagation(); close(); btn.focus(); } });
  return wrap;
}

function sellyScreenUrl(key, r) {
  const scr = screenOf(key);
  return scr ? adminUrl() + '?a=' + scr + (r ? '&st=' + encodeURIComponent(r.number || r.id) : '') : '';
}

function rowActions(key, r) {
  const m = manualOf(key), name = courierName(key), scr = screenOf(key);
  const orderSelly = adminUrl() + '?a=zamowienia.view&id=' + encodeURIComponent(r.id);
  let main;
  if (m && r.tracking) {
    main = el('a', { class: 'btn-secondary small ship-selly', 'data-id': r.id, href: sellyScreenUrl(key, r) || orderSelly, target: '_blank', rel: 'noopener',
      title: 'Otwiera w nowej karcie ekran „Przesyłki ' + name + '” w panelu Selly wyszukany po numerze ' + (r.number || r.id) }, 'Zobacz w Selly ↗');
  } else if (m) {
    const ready = shipReady(key, 'create');
    main = el('button', { type: 'button', class: 'primary small-btn ship-mk ship-man', write: 'przesylki', 'data-id': r.id, disabled: !ready,
      title: ready ? KIND.create.tip : 'Utwórz przesyłkę: ' + MSG_UNVERIFIED, onclick: () => startManual([r], 'create') }, 'Utwórz przesyłkę');
  } else if (r.tracking) {
    main = el('button', { type: 'button', class: 'secondary small-btn ship-lbl', 'data-id': r.id, title: 'Pobierz etykietę PDF tej przesyłki (nr ' + r.tracking + ')',
      onclick: ev => downloadLabels([{ id: r.id, tracking: r.tracking }], ev.target) }, 'Pobierz etykietę');
  } else {
    main = el('button', { type: 'button', class: 'primary small-btn ship-mk', write: 'przesylki', 'data-id': r.id,
      title: 'Utworzy list przewozowy ' + name + ' dla tego zamówienia (najpierw pokażemy podsumowanie do potwierdzenia)', onclick: () => startCreate([r]) }, 'Utwórz przesyłkę');
  }
  const track = r.tracking && TRACK_URL[key] ? TRACK_URL[key] + encodeURIComponent(r.tracking) : '';
  return el('div', { class: 'ship-acts' }, main, rowMenu(r, [
    { label: 'Otwórz zamówienie', href: '#/zamowienia/' + encodeURIComponent(r.id), tip: 'Szczegóły zamówienia w panelu (Ctrl+klik — nowa karta)' },
    { label: 'Zamówienie w Selly ↗', href: orderSelly, ext: true, tip: 'Otwiera to zamówienie w panelu administracyjnym Selly w nowej karcie' },
    m && !r.tracking && manKinds(key).includes('buffer') ? { label: 'Prześlij do bufora', write: 'przesylki', disabled: !shipReady(key, 'buffer'),
      tip: shipReady(key, 'buffer') ? KIND.buffer.tip : 'Prześlij do bufora: ' + MSG_UNVERIFIED, run: () => startManual([r], 'buffer') } : null,
    m && !r.tracking && scr ? { label: 'Utwórz w Selly ↗', href: sellyScreenUrl(key, r), ext: true, tip: 'Otwiera w nowej karcie ekran „Przesyłki ' + name + '” w Selly wyszukany po numerze ' + (r.number || r.id) + ' — tam „Utwórz przesyłkę” lub „Prześlij do bufora”' } : null,
    !m && scr ? { label: 'Przesyłki ' + name + ' w Selly ↗', href: sellyScreenUrl(key, r), ext: true, tip: 'Ekran przesyłek ' + name + ' w Selly, wyszukany po numerze zamówienia' } : null,
    track ? { label: 'Śledź przesyłkę ↗', href: track, ext: true, tip: 'Strona śledzenia przesyłki u przewoźnika ' + name + ' (nowa karta)' } : null,
    { label: 'Zmień status…', write: ['przesylki', 'zamowienia'], tip: 'Zmień status tego zamówienia w Selly', run: () => startStatus([String(r.id)]) },
  ]));
}

function shipState(key, r) {
  const m = manualOf(key);
  if (!r.tracking) return el('span', { class: 'muted ship-none', title: m ? 'Przesyłka nie została jeszcze utworzona (brak numeru przesyłki w zamówieniu)' : 'List przewozowy jeszcze nie utworzony' }, m ? 'nienadana' : 'brak listu');
  const got = !m && isDownloaded(r.id);
  return [el('div', { class: 'nw ship-trk' }, r.tracking),
    el('div', { class: 'cell-sub' }, el('span', { class: 'ship-st' + (got ? ' ok' : ''), title: m ? 'Przesyłka utworzona (numer zapisany w zamówieniu w Selly)' : got ? 'Etykieta tej przesyłki była już pobrana w tej przeglądarce' : 'List utworzony — etykiety jeszcze nie pobierano w tej przeglądarce' },
      m ? 'utworzona w Selly' : got ? 'etykieta pobrana' : 'list utworzony'))];
}

function renderQueue() {
  const u = S.ui, key = S.view, Q = S.Q;
  if (!u.results) return;
  syncControls();
  const note = document.getElementById('shipNote');
  if (note) note.replaceChildren(S.note ? el('div', { class: 'notice warn', role: 'status' }, S.note) : '');
  if (S.err) {
    u.results.replaceChildren(el('div', { class: 'empty error' }, S.err, el('div', null, el('button', { type: 'button', class: 'secondary', onclick: loadQueue }, 'Spróbuj ponownie'))));
    u.pagerTop.replaceChildren(); u.pagerBot.replaceChildren();
    renderBar(); return;
  }
  const rows = S.rows, isIn = key === 'inpost', cols = columns(key);
  const head = el('tr', null,
    el('th', { class: 'c' }, el('input', { type: 'checkbox', id: 'shipSelAll', 'aria-label': 'Zaznacz wszystkie na tej stronie', title: 'Zaznacz lub odznacz wszystkie zamówienia na tej stronie. Zaznaczenie z innych stron zostaje.',
      onchange: ev => { for (const r of S.rows) { if (ev.target.checked) S.sel.set(String(r.id), r); else S.sel.delete(String(r.id)); } syncSel(); } })),
    cols.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir }))));
  const body = el('tbody');
  for (const r of rows) {
    const name = fullName(r.firstName, r.lastName), age = ageDays(r.date), notes = [r.attention ? '⚑ ' + r.attention : '', r.comment || ''].filter(Boolean).join(' · ');
    const st = statusName(r.statusId);
    body.append(el('tr', { 'data-id': r.id, class: S.sel.has(String(r.id)) ? 'sel' : null },
      el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Zaznacz zamówienie ' + (r.number || r.id), onchange: ev => { if (ev.target.checked) S.sel.set(String(r.id), r); else S.sel.delete(String(r.id)); syncSel(); } })),
      el('td', { class: 'ship-no' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(r.id), class: 'cell-name', title: 'Otwórz zamówienie ' + (r.number || r.id) }, r.number || r.id),
        el('div', { class: 'cell-sub nw' }, dateStr(r.date)),
        r.productsText ? el('div', { class: 'cell-sub ship-prods', title: r.productsText }, short(r.productsText, 60)) : null),
      el('td', { class: 'n nw' + (age != null && age >= 3 ? ' ship-old' : ''), title: age == null ? null : 'Złożone ' + (age === 0 ? 'dziś' : ageText(age) + ' temu') + ' (' + dateStr(r.date) + ')' }, ageText(age)),
      el('td', { class: 'ship-addr' }, el('div', { class: 'cell-name' }, name || r.company || '—'), name && r.company ? el('div', { class: 'cell-sub' }, r.company) : null,
        r.street ? el('div', { class: 'cell-sub' }, r.street) : null, el('div', { class: 'cell-sub' }, [r.postcode, r.city].filter(Boolean).join(' '))),
      el('td', null, el('div', null, r.delivery || '—'), !isIn && r.locker ? el('div', { class: 'cell-sub', title: 'Punkt odbioru wybrany w zamówieniu' }, 'punkt: ' + r.locker) : null),
      isIn ? el('td', null, el('input', { type: 'text', class: 'ship-locker' + (lockerOf(r) && !LOCKER_RE.test(lockerOf(r)) ? ' bad' : ''), 'data-id': r.id, value: lockerOf(r), placeholder: 'brak', 'aria-label': 'Paczkomat dla zamówienia ' + (r.number || r.id),
        title: 'Paczkomat odbiorcy (np. WAW01M), wybrany przez klienta w zamówieniu. Jeśli go poprawisz, przy tworzeniu listu zapiszemy nowy kod w zamówieniu w Selly. Czerwona ramka = nieprawidłowy kod.',
        oninput: ev => { const v = ev.target.value.trim(); S.lockers.set(String(r.id), v); ev.target.classList.toggle('bad', !!v && !LOCKER_RE.test(v)); } })) : null,
      el('td', { class: 'n nw' }, r.total == null || r.total === '' ? null : money(r.total), el('div', { class: 'cell-sub' }, Number(r.paid) > 0 ? 'opłacone' : 'nieopłacone')),
      el('td', null, statusPill(st, orderStatusTone(st), 'Status zamówienia: ' + st)),
      el('td', { class: 'ship-notes' }, notes ? el('span', { title: notes, class: r.attention ? 'ship-attn' : null }, short(notes, 80)) : ''),
      el('td', null, shipState(key, r)),
      el('td', { class: 'ship-act' }, rowActions(key, r))));
  }
  if (!rows.length) body.append(el('tr', null, el('td', { colspan: String(cols.length + 1), class: 'empty' }, emptyText())));
  u.results.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'shipTable', class: 'ship-table' }, el('thead', null, head), body)));
  const pages = Math.max(1, Math.ceil(S.total / Q.size));
  const pg = (prefix, sizes) => pager({ prefix, page: Q.page, pages, total: S.total, noun: ['zamówienie', 'zamówienia', 'zamówień'], onPage: p => setQ({ page: p }),
    sizes: sizes ? SIZES : null, size: Q.size, onSize: n => setQ({ size: n }) });
  u.pagerTop.replaceChildren(pg('ship', true));
  u.pagerBot.replaceChildren(S.total > Q.size ? pg('shipB', false) : '');
  syncSel();
}

function emptyText() {
  const mapped = ((S.meta && S.meta.deliveries) || []).some(d => d.courier === S.view);
  if (!mapped) return el('span', { id: 'shipNoMap' }, 'Żaden sposób dostawy nie jest przypisany do przewoźnika ' + courierName(S.view) + ', więc kolejka jest pusta. ',
    el('a', { href: '#/przesylki/ustawienia', title: 'Przypisz sposoby dostawy do przewoźników' }, 'Przypisz sposoby dostawy w ustawieniach →'));
  if (activeFilters(S.Q) || S.Q.q) return el('span', null, 'Brak zamówień pasujących do filtrów. ', el('button', { type: 'button', class: 'link', onclick: clearFilters }, 'Wyczyść filtry'));
  return 'Brak zamówień do nadania — wszystkie mają już etykietę. Aby je zobaczyć, w „Filtruj” wybierz Etykieta: „z etykietą” lub „wszystkie”.';
}

function syncSel() {
  const u = S.ui;
  for (const tr of u.results.querySelectorAll('tbody tr[data-id]')) {
    const on = S.sel.has(tr.dataset.id); tr.classList.toggle('sel', on);
    const cb = tr.querySelector('input[type=checkbox]'); if (cb) cb.checked = on;
  }
  const all = u.results.querySelector('#shipSelAll');
  if (all) { const n = S.rows.filter(r => S.sel.has(String(r.id))).length; all.checked = S.rows.length > 0 && n === S.rows.length; all.indeterminate = n > 0 && n < S.rows.length; }
  renderBar();
}

/** Przyklejony dolny pasek akcji masowych (jak „Zapisz” w Selly): liczba zaznaczonych — także z innych stron. */
function renderBar() {
  const u = S.ui, n = S.sel.size, key = S.view, m = manualOf(key);
  if (!u.bar) return;
  const sel = selectedRows(), withT = sel.filter(r => r.tracking), noT = sel.filter(r => !r.tracking);
  const off = sel.filter(r => !S.rows.some(x => String(x.id) === String(r.id))).length;
  u.bar.replaceChildren(
    el('span', null, el('strong', { id: 'shipSelCount' }, n ? 'Zaznaczono: ' + n : 'Nic nie zaznaczono'),
      off ? el('span', { class: 'muted small', id: 'shipSelOff', title: 'Zaznaczenie zostaje po przejściu na inną stronę — akcje obejmą wszystkie zaznaczone' }, ' (w tym ' + off + ' z innych stron)') : null),
    el('button', { type: 'button', class: 'ghost', id: 'shipSelClear', disabled: !n, title: n ? 'Odznacz wszystkie zamówienia (na wszystkich stronach)' : 'Nic nie jest zaznaczone', onclick: () => { S.sel.clear(); syncSel(); } }, 'Wyczyść zaznaczenie'),
    el('span', { class: 'spacer' }),
    el('button', { type: 'button', class: 'secondary', write: ['przesylki', 'zamowienia'], id: 'shipStatusSel', disabled: !n,
      title: n ? 'Zmień status zaznaczonych zamówień w Selly (np. na „Nadane” po oddaniu paczek)' : 'Najpierw zaznacz zamówienia w tabeli',
      onclick: () => startStatus(selectedRows().map(r => String(r.id))) }, 'Zmień status (' + n + ')'),
    m ? (screenOf(key) ? sellyLink('Przesyłki ' + courierName(key) + ' w Selly ↗', sellyScreenUrl(key), 'Otwiera ekran przesyłek ' + courierName(key) + ' w panelu Selly w nowej karcie') : null)
      : el('button', { type: 'button', class: 'secondary', id: 'shipLabelsSel', disabled: !withT.length,
        title: withT.length ? 'Pobierz etykiety PDF zaznaczonych zamówień, które mają numer przesyłki (kilka — archiwum ZIP)' : 'Żadne z zaznaczonych zamówień nie ma jeszcze listu przewozowego',
        onclick: ev => downloadLabels(withT.map(r => ({ id: r.id, tracking: r.tracking })), ev.target) }, 'Pobierz etykiety (' + withT.length + ')'),
    ...(m ? manKinds(key).slice().reverse().map(kind => {
      const ready = shipReady(key, kind), K = KIND[kind];
      return el('button', { type: 'button', class: kind === 'create' ? 'primary' : 'secondary', write: 'przesylki', id: K.id, disabled: !ready || !noT.length,
        title: !ready ? K.many + ': ' + MSG_UNVERIFIED : noT.length ? (kind === 'create' ? 'Utworzy przesyłki ' + courierName(key) + ' dla zaznaczonych zamówień bez numeru przesyłki'
          : 'Przekaże do bufora ' + courierName(key) + ' zaznaczone zamówienia bez numeru przesyłki') + ' — formularzem Selly, po kolei, z wynikiem dla każdego (najpierw potwierdzenie)'
          : n ? 'Zaznaczone zamówienia mają już numer przesyłki' : 'Najpierw zaznacz zamówienia w tabeli',
        onclick: () => startManual(null, kind) }, K.many + ' (' + noT.length + ')');
    }) : []),
    m ? null : el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipCreate', disabled: !noT.length,
      title: noT.length ? 'Utworzy listy przewozowe u przewoźnika dla zaznaczonych zamówień bez numeru przesyłki (najpierw poprosimy o potwierdzenie)'
        : n ? 'Zaznaczone zamówienia mają już numer przesyłki — list przewozowy istnieje' : 'Najpierw zaznacz zamówienia w tabeli',
      onclick: () => startCreate() }, 'Utwórz listy przewozowe (' + noT.length + ')'));
}

// ─── Kolejka: filtry ────────────────────────────────────────────────────────

function clearFilters() { setQ({ q: '', status: '', from: '', to: '', vmin: '', vmax: '', deliv: '', locker: '', label: 'none' }); }

function buildFilters(key) {
  const f = S.ui.f = {};
  f.status = multiSelect({ id: 'shipStatusF', all: 'Wszystkie statusy', short: 'Status', noun: 'Status', none: false, tip: 'Tylko zamówienia w wybranych statusach (np. „Opłacone”) — można zaznaczyć kilka. Wpływa też na liczby przy przewoźnikach.', onChange: csv => setQ({ status: csv }) });
  f.label = el('select', { id: 'shipLabelF', 'aria-label': 'Etykieta', title: 'Domyślnie widać tylko zamówienia bez etykiety (do nadania). „Z etykietą” — np. aby pobrać etykiety jeszcze raz.', onchange: ev => setQ({ label: ev.target.value }) },
    el('option', { value: 'none' }, 'bez etykiety (do nadania)'), el('option', { value: 'with' }, 'z etykietą (nadane)'), el('option', { value: 'all' }, 'wszystkie'));
  f.range = dateRange({ idFrom: 'shipFrom', idTo: 'shipTo', titleFrom: 'Zamówienia złożone od tego dnia (włącznie)', titleTo: 'Zamówienia złożone do tego dnia (włącznie)', onChange: r => { if (r.from !== S.Q.from || r.to !== S.Q.to) setQ(r); } });
  const num = (id, label, tip, k) => el('input', { type: 'number', id, min: '0', step: '0.01', inputmode: 'decimal', class: 'ship-num', 'aria-label': label, title: tip, placeholder: label,
    onchange: ev => setQ({ [k]: numStr(ev.target.value.trim()) }) });
  f.vmin = num('shipVmin', 'od zł', 'Wartość zamówienia co najmniej (zł, z dostawą)', 'vmin');
  f.vmax = num('shipVmax', 'do zł', 'Wartość zamówienia najwyżej (zł, z dostawą)', 'vmax');
  f.deliv = multiSelect({ id: 'shipDelivF', all: 'Wszystkie sposoby dostawy', short: 'Dostawa', noun: 'Sposób dostawy', none: false, tip: 'Tylko wybrane sposoby dostawy spośród przypisanych do tego przewoźnika', onChange: csv => setQ({ deliv: csv }) });
  f.locker = key === 'inpost' ? el('select', { id: 'shipLockerF', 'aria-label': 'Paczkomat', title: 'Znajdź zamówienia z błędnym kodem paczkomatu (np. literówka) albo bez paczkomatu — przed utworzeniem listów', onchange: ev => setQ({ locker: ev.target.value }) },
    el('option', { value: '' }, 'wszystkie'), el('option', { value: 'bad' }, 'nieprawidłowy kod paczkomatu'), el('option', { value: 'missing' }, 'bez paczkomatu')) : null;
  return [
    filterSection('Etykieta', f.label, { tip: 'Czy zamówienie ma już list przewozowy (numer przesyłki)' }),
    filterSection('Status zamówienia', f.status.node),
    filterSection('Data zamówienia', f.range.node),
    filterSection('Wartość zamówienia', el('div', { class: 'ship-vrange' }, f.vmin, el('span', { class: 'muted' }, '–'), f.vmax), { tip: 'Zakres wartości zamówienia z dostawą, w złotych' }),
    filterSection('Sposób dostawy', f.deliv.node),
    f.locker ? filterSection('Paczkomat', f.locker, { tip: 'Sprawdzenie kodów paczkomatów odbiorców (InPost)' }) : null,
    el('button', { type: 'button', class: 'ghost', id: 'shipFClear', title: 'Usuń wszystkie filtry i wyszukiwanie (zostaje widok „bez etykiety”)', onclick: clearFilters }, 'Wyczyść filtry'),
  ].filter(Boolean);
}

/** Kontrolki ← adres (po każdej zmianie trasy / wczytaniu). */
function syncControls() {
  const u = S.ui, f = u.f, Q = S.Q;
  if (!f) return;
  if (document.activeElement !== u.search) u.search.value = Q.q;
  f.label.value = Q.label;
  f.status.set(statuses().map(s => ({ key: String(s.id), label: s.name })), Q.status);
  f.range.from.value = Q.from; f.range.to.value = Q.to;
  f.vmin.value = Q.vmin; f.vmax.value = Q.vmax;
  f.deliv.set(((S.meta && S.meta.deliveries) || []).filter(d => d.courier === S.view).map(d => ({ key: String(d.id), label: d.name })), Q.deliv);
  if (f.locker) f.locker.value = Q.locker;
  const n = activeFilters(Q);
  u.filtersBtn.textContent = 'Filtruj' + (n ? ' (' + n + ')' : '');
  u.filtersBtn.classList.toggle('on', n > 0);
  u.filtersBtn.setAttribute('aria-expanded', String(u.layout.isOpen()));
}

function renderCourier() {
  const u = S.ui, key = S.view, name = courierName(key), m = manualOf(key);
  u.search = el('input', { type: 'search', id: 'shipSearch', placeholder: 'Szukaj: numer, nazwisko, firma, miasto, kod, paczkomat, nr przesyłki', 'aria-label': 'Szukaj w kolejce',
    title: 'Szuka w numerze zamówienia, imieniu i nazwisku odbiorcy, firmie, mieście, kodzie pocztowym, paczkomacie, numerze przesyłki i sposobie dostawy',
    oninput: debounce(() => { const v = u.search.value.trim(); if (v !== S.Q.q) setQ({ q: v }, true); }, 350) });
  u.filtersBtn = el('button', { type: 'button', class: 'secondary', id: 'shipFiltersBtn', 'aria-controls': 'shipFilters', 'aria-expanded': 'false',
    title: 'Pokaż lub ukryj filtry: etykieta, status, data, wartość, sposób dostawy' + (key === 'inpost' ? ', nieprawidłowy paczkomat' : '') + '. Liczba w nawiasie = aktywne filtry. Wybór jest zapamiętywany.',
    onclick: () => { u.layout.setOpen(!u.layout.isOpen()); syncControls(); } }, 'Filtruj');
  u.bar = el('div', { class: 'save-bar ship-bar', id: 'shipBar', role: 'region', 'aria-label': 'Akcje dla zaznaczonych zamówień' });
  u.dlg = el('div', { id: 'shipDlg' });
  u.results = el('div', { id: 'shipResults' });
  u.pagerTop = el('div', { class: 'ship-pager' }); u.pagerBot = el('div', { class: 'ship-pager' });
  u.layout = filterLayout({ key: 'przesylki', panelId: 'shipFilters', panelNodes: buildFilters(key), mainNodes: [u.pagerTop, u.dlg, u.results, u.pagerBot] });
  registerListKeys({ screen: 'przesylki', table: 'shipTable', select: true, extra: [{ keys: ['r'], label: 'R', desc: 'Odśwież kolejkę', id: 'shipReload' }] });
  u.body.replaceChildren(el('div', { class: 'card', id: 'shipCard' },
    el('div', { class: 'card-head' }, el('h2', null, (m ? 'Przesyłki — ' : 'Do nadania — ') + name),
      el('div', { class: 'sub' }, m ? 'Zamówienia ze sposobem dostawy przypisanym do ' + name + '. Zaznacz je i kliknij akcję na dole albo „Utwórz przesyłkę” w wierszu.'
        : 'Zamówienia ze sposobem dostawy przypisanym do przewoźnika ' + name + '. Zaznacz je i kliknij „Utwórz listy przewozowe” na dole albo „Utwórz przesyłkę” w wierszu.')),
    m ? el('div', { class: 'notice info', id: 'shipManualNote', role: 'note' }, manualNote(key, name),
      m.native ? [' ', el('a', { href: '#/' + m.native, title: 'Podgląd listy przesyłek ' + name + ' z Selly w panelu' }, 'Podgląd przesyłek ' + name + ' →')] : null) : null,
    el('div', { class: 'toolbar' }, u.search, u.filtersBtn,
      el('button', { type: 'button', class: 'secondary', id: 'shipReload', title: 'Wczytaj kolejkę ponownie (z kopii zamówień panelu — bez zapytań do Selly)', onclick: loadQueue }, 'Odśwież'),
      el('span', { class: 'spacer' }),
      el('a', { href: '#/przesylki/ustawienia', class: 'muted small', title: 'Zmień przypisanie sposobów dostawy do przewoźników' }, 'Ustawienia przewoźników')),
    el('div', { id: 'shipNote' }),
    m ? null : paramsPanel(key), u.layout.node, u.bar));
  S.built = key;
  syncControls();
  renderBar();
}

function selectedRows() { return [...S.sel.values()]; }

// ─── Przewoźnicy bez API: formularz Selly ───────────────────────────────────

function manualNote(key, name) {
  const ready = manKinds(key).filter(k => shipReady(key, k)), what = manKinds(key).map(k => '„' + KIND[k].one + '”').join(' i ');
  return ready.length === manKinds(key).length
    ? name + ': ' + what + ' działa tu tak jak w Selly — panel wypełnia formularz przewoźnika w Selly na Twojej sesji (Selly nie ma tego w API, ale ma w panelu). Utworzenie przesyłki jest płatne.'
    : name + ': ' + what + ' zrobimy tu tak jak Selly (formularzem panelu Selly), ale ' + (ready.length ? 'część akcji ' : '') + 'czeka na potwierdzenie struktury formularza Selly (administrator: shipprobe). '
      + 'Do tego czasu „Utwórz w Selly ↗” w menu ▾ wiersza otwiera ekran przewoźnika w Selly wyszukany po numerze zamówienia.';
}

/** Jedno pole formularza Selly do edycji (tylko pola z allowlisty serwera: parametry paczki). */
function manField(f) {
  const id = 'shipF-' + f.name.replace(/[^\w-]/g, '_'), common = { id, 'data-name': f.name, title: f.help || null };
  let input;
  if (f.type === 'select' || f.type === 'radio') input = el('select', common, (f.options || []).map(o => el('option', { value: o.value, selected: o.value === f.value ? true : null }, o.text || o.value || '—')));
  else if (f.type === 'checkbox') input = el('input', { ...common, type: 'checkbox', checked: f.checked ? true : null, 'data-on': f.onValue || '1' });
  else if (f.type === 'textarea') input = el('textarea', { ...common, rows: '2', maxlength: '200' }, f.value || '');
  else input = el('input', { ...common, type: f.type === 'date' || f.type === 'time' ? f.type : 'text', value: f.value || '', maxlength: '200' });
  return el('label', { class: 'field ship-man-field' }, el('span', null, f.label || f.name), input);
}
const manValue = i => (i.type === 'checkbox' ? (i.checked ? i.dataset.on : '') : i.value);

/**
 * „Utwórz przesyłkę” / „Prześlij do bufora” formularzem Selly. Jedno zamówienie (tworzenie): formularz wypełniony przez Selly → zmiany parametrów
 * paczki → podgląd „było → będzie” → potwierdzenie (płatne). Kilka zamówień: potwierdzenie i po kolei, z wynikiem dla każdego, „Ponów nieudane”.
 */
function startManual(given, kind) {
  const host = S.ui.dlg, key = S.view, name = courierName(key), K = KIND[kind];
  const rows = (given || selectedRows()).filter(r => !r.tracking);
  if (!rows.length || !shipReady(key, kind)) return;
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', id: 'shipManDlg', 'aria-label': K.many + ' — ' + name });
  host.replaceChildren(box);
  const close = () => host.replaceChildren();
  const numOf = id => S.numOf.get(String(id)) || id;
  const cancelBtn = () => el('button', { type: 'button', class: 'secondary', id: 'shipCancel', onclick: close }, 'Anuluj');
  const sellyBtn = r => (screenOf(key) ? sellyLink('Zrób to w Selly ↗', sellyScreenUrl(key, r), 'Otwiera ekran przesyłek ' + name + ' w Selly wyszukany po numerze zamówienia') : null);
  const costText = kind === 'create' ? 'Utworzenie przesyłki zamawia usługę u przewoźnika ' + name + ' — jest płatne i nie da się go cofnąć z panelu.'
    : 'Przesłanie do bufora przygotowuje przesyłkę u przewoźnika ' + name + ' (dalsze nadanie i opłaty — wg zasad przewoźnika). Z panelu nie da się tego cofnąć.';
  box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
  if (given && rows.length === 1 && kind === 'create') single(rows[0]); else confirmMany();   // z wiersza: formularz; z paska: potwierdzenie i po kolei

  async function single(r) {
    box.replaceChildren(el('h3', null, K.one + ' — ' + name + ', zamówienie ' + numOf(r.id)), loadingBox('Pobieram formularz przesyłki z Selly…'));
    let x;
    try { x = await api('shipping:manualForm', { carrier: key, kind, orderId: String(r.id) }); } catch (e) { x = { ok: false, error: e.message || 'błąd połączenia' }; }
    if (!x || !x.ok) {
      box.replaceChildren(el('h3', null, K.one + ' — ' + name), el('div', { class: 'notice error', role: 'alert', id: 'shipManErr' }, (x && x.error) || 'Nie udało się pobrać formularza z Selly.'),
        el('div', { class: 'ord-actions' }, sellyBtn(r), el('button', { type: 'button', class: 'secondary', id: 'shipClose', onclick: close }, 'Zamknij')));
      return;
    }
    const d = x.data, ed = d.fields.filter(f => f.editable), ro = d.fields.filter(f => !f.editable && f.type !== 'secret' && String(f.value || '') !== '');
    const before = Object.fromEntries(ed.map(f => [f.name, f.type === 'checkbox' ? (f.checked ? f.onValue : '') : f.value]));
    const inputs = ed.map(manField);
    box.replaceChildren(
      el('h3', null, K.one + ' — ' + name + ', zamówienie ' + numOf(r.id)),
      el('p', { class: 'muted small' }, 'Formularz wypełnił Selly (tak jak po kliknięciu „Utwórz przesyłkę” w Selly). Zmienić możesz tylko parametry paczki; resztę wyślemy dokładnie tak, jak podało Selly.'),
      d.note ? el('div', { class: 'notice warn', role: 'status' }, d.note) : null,
      (d.notices || []).length ? el('div', { class: 'notice info', role: 'status' }, d.notices.map(n => n.text).join(' · ')) : null,
      ed.length ? el('div', { class: 'ship-man-fields', id: 'shipManFields' }, inputs) : el('p', { class: 'muted small', id: 'shipManNoFields' }, 'Brak pól do zmiany — użyjemy ustawień wypełnionych przez Selly.'),
      ro.length ? el('details', { class: 'ship-man-ro' }, el('summary', { title: 'Dane, które Selly wpisało do formularza (np. odbiorca) — wyślemy je bez zmian; zmienisz je w zamówieniu' }, 'Pozostałe dane formularza Selly (' + ro.length + ', tylko podgląd)'),
        el('dl', null, ro.map(f => [el('dt', null, f.label || f.name), el('dd', null, f.type === 'select' || f.type === 'radio' ? ((f.options || []).find(o => o.value === f.value) || { text: f.value }).text : f.type === 'checkbox' ? (f.checked ? 'tak' : 'nie') : f.value)]))) : null,
      el('div', { class: 'ord-actions' },
        el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipManNext', disabled: !d.canSubmit, title: d.canSubmit ? 'Pokaż podsumowanie zmian przed utworzeniem przesyłki' : d.note || 'Formularza nie da się wysłać z panelu', onclick: () => preview() }, 'Dalej — podsumowanie'),
        sellyBtn(r), cancelBtn()));

    async function preview() {
      const values = {};
      for (const i of box.querySelectorAll('[data-name]')) { const v = manValue(i); if (v !== before[i.dataset.name]) values[i.dataset.name] = v; }
      const btn = box.querySelector('#shipManNext'); btn.disabled = true;
      let p;
      try { p = await api('shipping:manualCreate', { carrier: key, kind, orderId: String(r.id), values, expect: before, dryRun: true }); } catch (e) { p = { ok: false, error: e.message || 'błąd połączenia' }; }
      btn.disabled = false;
      const old = box.querySelector('#shipManPreview'); if (old) old.remove();
      if (!p || !p.ok) { box.querySelector('.ord-actions').before(el('div', { class: 'notice error', role: 'alert', id: 'shipManPreview' }, (p && p.error) || 'Nie udało się przygotować podsumowania.')); return; }
      const diff = p.data.diff || [];
      box.querySelector('.ord-actions').before(el('div', { class: 'card ship-man-preview', id: 'shipManPreview' },
        el('strong', null, diff.length ? 'Zmienisz względem formularza Selly:' : 'Bez zmian — użyjemy danych wypełnionych przez Selly.'),
        diff.length ? el('ul', { class: 'ship-man-diff' }, diff.map(x => el('li', null, el('span', null, x.label || x.name), ': ', el('s', null, x.beforeText || '(puste)'), ' → ', el('strong', null, x.afterText || '(puste)')))) : null,
        el('div', { class: 'notice warn', role: 'status' }, costText),
        el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipManConfirm', title: costText, onclick: () => run([String(r.id)], { [String(r.id)]: { values, expect: before } }) }, K.one + ' (płatne)'))));
    }
  }

  function confirmMany() {
    box.replaceChildren(
      el('h3', null, (kind === 'create' ? 'Utworzyć przesyłki ' + name + ' dla ' : 'Przesłać do bufora ' + name + ' ') + cnt(rows.length, 'zamówienia', 'zamówień', 'zamówień') + '?'),
      el('p', { class: 'small' }, 'Zamówienia: ' + rows.slice(0, 12).map(r => r.number || r.id).join(', ') + (rows.length > 12 ? ' …' : '')),
      el('p', { class: 'muted small' }, kind === 'create' ? 'Parametry paczki dla każdego zamówienia — tak, jak wypełni je Selly (ustawienia integracji przewoźnika). Aby zmienić wagę, wymiary czy usługę, użyj „Utwórz przesyłkę” w wierszu.'
        : 'Każde zamówienie przekażemy osobno, tak jak zaznaczenie go na ekranie przewoźnika w Selly i „Prześlij do bufora”.'),
      el('div', { class: 'notice warn', role: 'status', id: 'shipManCost' }, costText + ' Zamówienia idą po kolei; zobaczysz wynik dla każdego.'),
      el('div', { class: 'ord-actions' },
        el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipManConfirm', title: costText, onclick: () => run(rows.map(r => String(r.id)), {}) }, K.many + ' (' + rows.length + ')' + (kind === 'create' ? ' — płatne' : '')),
        cancelBtn()));
  }

  async function run(ids, per) {
    const bar = el('progress', { max: String(ids.length), value: '0', id: 'shipProgress', 'aria-label': 'Postęp' });
    const label = el('div', { class: 'muted small', role: 'status' }, K.doing + ' 0 z ' + ids.length);
    box.replaceChildren(el('h3', null, K.doing), bar, label);
    const done = [], failed = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], p = per[id] || {};
      try {
        const x = await api('shipping:manualCreate', { carrier: key, kind, orderId: id, values: p.values || {}, expect: p.expect });
        if (x && x.ok && x.data && x.data.created) { done.push({ id, tracking: x.data.tracking || '' }); S.sel.delete(id); }
        else failed.push({ id, error: (x && x.error) || ((x && x.data && x.data.notices) || []).filter(n => n.kind === 'error').map(n => n.text).join(' ') || 'Selly nie potwierdziło utworzenia — sprawdź w Selly' });
      } catch (e) { failed.push({ id, error: e.message || 'błąd połączenia — sprawdź w Selly, czy przesyłka nie powstała' }); }
      bar.value = i + 1; label.textContent = K.doing + ' ' + (i + 1) + ' z ' + ids.length;
    }
    summary(done, failed);
    loadQueue();
  }

  function summary(done, failed) {
    const stSel = el('select', { id: 'shipNewStatus', 'aria-label': 'Nowy status', title: 'Status, który ustawimy zamówieniom z udaną akcją' }, statuses().map(s => el('option', { value: String(s.id) }, s.name)));
    const guess = statuses().find(s => /nadan/.test(norm(s.name))); if (guess) stSel.value = String(guess.id);
    box.replaceChildren(
      el('h3', null, failed.length ? K.fail : K.done),
      el('p', { id: 'shipSummary' }, 'Udane: ', el('strong', null, String(done.length)), ' · nieudane: ', el('strong', null, String(failed.length))),
      done.length ? el('ul', { class: 'ship-done' }, done.slice(0, 30).map(d => el('li', null, el('strong', null, numOf(d.id)), ' — ',
        d.tracking ? 'nr przesyłki ' + d.tracking : el('span', { class: 'muted', title: 'Selly zapisuje numer przesyłki w zamówieniu — pojawi się w kolejce po synchronizacji' }, 'numer przesyłki pojawi się po synchronizacji'))),
        done.length > 30 ? el('li', { class: 'muted' }, '… i ' + (done.length - 30) + ' więcej') : null) : null,
      failed.length ? el('ul', { class: 'ord-fails', id: 'shipFails' }, failed.slice(0, 20).map(f => el('li', null, el('strong', null, numOf(f.id)), ' — ' + f.error)),
        failed.length > 20 ? el('li', { class: 'muted' }, '… i ' + (failed.length - 20) + ' więcej') : null) : null,
      el('div', { class: 'ord-actions' },
        failed.length ? el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipRetry', title: 'Spróbuj ponownie tylko dla nieudanych (z ustawieniami wypełnionymi przez Selly). Najpierw sprawdź w Selly, czy przesyłka nie powstała mimo błędu.', onclick: () => run(failed.map(f => f.id), {}) }, 'Ponów nieudane (' + failed.length + ')') : null,
        el('button', { type: 'button', class: 'secondary', id: 'shipClose', onclick: close }, 'Zamknij')),
      done.length && statuses().length ? el('div', { class: 'ship-status-row' },
        el('label', { class: 'field-inline', title: 'Ustaw wybrany status dla zamówień, którym akcja się udała (podpowiadamy status z „Nadane” w nazwie)' }, 'Status udanych', stSel),
        el('button', { type: 'button', class: 'secondary', write: ['przesylki', 'zamowienia'], id: 'shipSetStatus', title: 'Zmienia status w Selly (może uruchomić powiadomienia dla klientów, jeśli tak skonfigurowano status)',
          onclick: ev => setStatusDone(box, done.map(d => String(d.id)), stSel.value, ev.target) }, 'Zmień status udanych')) : null);
  }
}

// ─── Tworzenie listów ───────────────────────────────────────────────────────

/** rows: jedno zamówienie z przycisku w wierszu albo (domyślnie) zaznaczone bez numeru przesyłki. */
function startCreate(given) {
  const host = S.ui.dlg, key = S.view, rows = (given || selectedRows()).filter(r => !r.tracking), name = courierName(key);
  if (manualOf(key)) return;
  if (!rows.length) return;
  const changed = key === 'inpost' ? rows.filter(r => lockerChange(r)) : [];
  const badLocker = key === 'inpost' ? rows.filter(r => { const v = lockerOf(r); return v && !LOCKER_RE.test(v); }) : [];
  const noLocker = key === 'inpost' && !isCourierService(key) ? rows.filter(r => !lockerOf(r)) : [];
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Tworzenie listów przewozowych' });
  host.replaceChildren(box);
  const doneAll = new Map();   // id → numer przesyłki
  const close = () => host.replaceChildren();
  const numOf = id => S.numOf.get(String(id)) || id;

  box.replaceChildren(
    el('h3', null, 'Utworzyć listy przewozowe dla ' + cnt(rows.length, 'zamówienia', 'zamówień', 'zamówień') + '?'),
    el('p', null, 'Przewoźnik: ', el('strong', null, name)),
    el('p', { class: 'muted small', id: 'shipParamsText' }, 'Parametry: ' + paramsText(key)),
    changed.length ? el('p', { class: 'small', id: 'shipLockerNote' }, 'Poprawione paczkomaty (' + changed.length + ') zapiszemy w zamówieniach: ' + changed.slice(0, 5).map(r => (r.number || r.id) + ' → ' + lockerChange(r)).join(', ') + (changed.length > 5 ? ' …' : '')) : null,
    badLocker.length ? el('div', { class: 'notice warn', role: 'status', id: 'shipBadLocker' }, 'Nieprawidłowy kod paczkomatu: ' + badLocker.map(r => r.number || r.id).join(', ') + ' — te listy się nie utworzą, popraw kod w tabeli.') : null,
    noLocker.length ? el('div', { class: 'notice warn', role: 'status', id: 'shipNoLocker' }, 'Bez paczkomatu: ' + noLocker.map(r => r.number || r.id).slice(0, 10).join(', ') + (noLocker.length > 10 ? ' …' : '') + '. Dla usługi paczkomatowej list może się nie utworzyć — wpisz paczkomat w tabeli albo wybierz usługę kurierską.') : null,
    el('p', { class: 'muted small' }, 'Listy zostaną utworzone w Selly u przewoźnika (może to naliczyć opłaty). Porcje po ' + maxBatch() + ' zamówień.'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipConfirm', onclick: () => run(rows.map(r => String(r.id))) }, 'Utwórz listy przewozowe'),
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
        // Paczkomat odbiorcy integracja Selly bierze z zamówienia — wysyłamy tylko poprawione (Worker zapisze je w zamówieniu)
        const per = {};
        for (const id of chunk) { const r = rows.find(x => String(x.id) === id) || S.rows.find(x => String(x.id) === id); const v = r ? lockerChange(r) : null; if (v) per[id] = { locker: v }; }
        if (Object.keys(per).length) p.perOrder = per;
      }
      try {
        const r = await api('shipping:create', p);
        const okIds = new Set();
        for (const d of r.done || []) { doneAll.set(String(d.id), d.tracking || ''); okIds.add(String(d.id)); S.sel.delete(String(d.id)); S.lockers.delete(String(d.id)); }
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
        failed.length ? el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipRetry', title: 'Spróbuj ponownie tylko dla zamówień, którym nie udało się utworzyć listu', onclick: () => run(failed.map(f => f.id)) }, 'Ponów nieudane (' + failed.length + ')') : null,
        done.length ? el('button', { type: 'button', class: failed.length ? 'secondary' : 'primary', id: 'shipLabels', title: 'Pobierz etykiety PDF wszystkich nadanych (jedna etykieta — plik PDF, kilka — archiwum ZIP)', onclick: ev => downloadLabels(done, ev.target) }, 'Pobierz etykiety (' + done.length + ')') : null,
        el('button', { type: 'button', class: 'secondary', id: 'shipClose', onclick: close }, 'Zamknij')),
      done.length && statuses().length ? el('div', { class: 'ship-status-row' },
        el('label', { class: 'field-inline', title: 'Ustaw wybrany status dla zamówień, które właśnie nadano (podpowiadamy status z „Nadane” w nazwie)' }, 'Status nadanych', stSel),
        el('button', { type: 'button', class: 'secondary', write: ['przesylki', 'zamowienia'], id: 'shipSetStatus', title: 'Zmienia status nadanych zamówień w Selly (może uruchomić powiadomienia dla klientów, jeśli tak skonfigurowano status)',
          onclick: ev => setStatusDone(box, done.map(d => String(d.id)), stSel.value, ev.target) }, 'Zmień status nadanych')) : null);
  }
}

/** Zmiana statusu zaznaczonych zamówień z kolejki (np. „Nadane” po oddaniu paczek kurierowi). */
function startStatus(ids) {
  const host = S.ui.dlg;
  if (!ids.length) return;
  if (!statuses().length) { flash('', 'Brak listy statusów — odśwież stronę.'); return; }
  const stSel = el('select', { id: 'shipNewStatus', 'aria-label': 'Nowy status', title: 'Status, który ustawimy zaznaczonym zamówieniom' }, statuses().map(s => el('option', { value: String(s.id) }, s.name)));
  const guess = statuses().find(s => /nadan/.test(norm(s.name))); if (guess) stSel.value = String(guess.id);
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Zmiana statusu' });
  box.append(
    el('h3', null, 'Zmienić status ' + cnt(ids.length, 'zamówienia', 'zamówień', 'zamówień') + '?'),
    el('div', { class: 'ship-status-row' }, el('label', { class: 'field-inline', title: 'Podpowiadamy status z „Nadane” w nazwie' }, 'Nowy status', stSel)),
    el('p', { class: 'muted small' }, 'Zmiana statusu w Selly może wysłać klientom powiadomienie, jeśli tak skonfigurowano status.'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'primary', write: ['przesylki', 'zamowienia'], id: 'shipSetStatus', onclick: ev => setStatusDone(box, ids, stSel.value, ev.target) }, 'Zmień status'),
      el('button', { type: 'button', class: 'secondary', id: 'shipClose', onclick: () => host.replaceChildren() }, 'Zamknij')));
  host.replaceChildren(box);
  box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
}

async function setStatusDone(box, ids, statusId, btn) {
  const batch = Math.max(1, Number(S.ordMeta && S.ordMeta.maxStatusBatch) || 50);
  btn.disabled = true;
  const label = el('div', { class: 'muted small', role: 'status', id: 'shipStatusRes' }, 'Zmieniam status: 0 z ' + ids.length);
  box.append(el('progress', { max: String(ids.length), value: '0', 'aria-label': 'Postęp zmiany statusu' }), label);
  const bar = box.lastElementChild.previousElementSibling;
  let ok = 0;
  const badIds = [], idOf = x => String(x && typeof x === 'object' ? (x.id != null ? x.id : x.orderId) : x);
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    try {
      const r = await api('orders:setStatus', { ids: chunk, statusId });
      const done = new Set((r.done || []).map(idOf));
      ok += done.size;
      badIds.push(...chunk.filter(id => !done.has(id)));
    } catch (e) { badIds.push(...chunk); }
    bar.value = ok + badIds.length; label.textContent = 'Zmieniam status: ' + (ok + badIds.length) + ' z ' + ids.length;
  }
  const numOf = id => S.numOf.get(String(id)) || id;
  label.replaceChildren('Status „' + statusName(statusId) + '”: zmieniono ' + ok + ', nieudane ' + badIds.length + '.',
    ...(badIds.length ? [' (' + badIds.slice(0, 10).map(numOf).join(', ') + (badIds.length > 10 ? ' …' : '') + ') ',
      el('button', { type: 'button', class: 'ghost small-btn', write: ['przesylki', 'zamowienia'], id: 'shipStatusRetry', title: 'Spróbuj ponownie zmienić status tylko tym zamówieniom, którym się nie udało',
        onclick: ev => { ev.target.remove(); setStatusDone(box, badIds.slice(), statusId, btn); } }, 'Ponów nieudane (' + badIds.length + ')')] : []));
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
      files.push({ id: String(it.id), name: 'etykieta-' + safeFile(S.numOf.get(String(it.id)) || it.id) + '.pdf', data: b64Bytes(r.content), type: r.type || 'application/pdf' });
    } catch (e) { errors.push({ it, msg: (S.numOf.get(String(it.id)) || it.id) + ': ' + (e.message || 'błąd') }); }
    if (bar) bar.value = files.length + errors.length;
  }
  if (bar) bar.remove();
  if (btn) btn.disabled = false;
  const old = document.getElementById('shipLblRes'); if (old) old.remove();
  if (errors.length) {
    // Wynik per zamówienie: które etykiety się nie pobrały + ponowienie tylko dla nich
    const host = S.ui.dlg && S.ui.dlg.isConnected ? S.ui.dlg : null;
    if (host) host.append(el('div', { class: 'notice warn', role: 'status', id: 'shipLblRes' },
      'Nie pobrano etykiet (' + errors.length + '): ' + errors.slice(0, 5).map(x => x.msg).join('; ') + (errors.length > 5 ? ' …' : '') + ' ',
      el('button', { type: 'button', class: 'ghost small-btn', id: 'shipLblRetry', title: 'Pobierz ponownie tylko etykiety, których nie udało się pobrać', onclick: ev => downloadLabels(errors.map(x => x.it), ev.target) }, 'Ponów (' + errors.length + ')')));
    else flash('', 'Nie pobrano etykiet: ' + errors.slice(0, 3).map(x => x.msg).join('; ') + (errors.length > 3 ? ' …' : ''));
  }
  if (!files.length) return;
  markDownloaded(files.map(f => f.id));
  if (S.ui.results && S.ui.results.isConnected && S.rows.length) renderQueue();
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
      el('option', { value: '' }, '— brak / automatycznie —'),
      el('optgroup', { label: 'Listy przewozowe z panelu' }, couriers().map(c => el('option', { value: c.key }, c.name))),
      el('optgroup', { label: 'Przesyłki tworzone w Selly' }, manuals().map(c => el('option', { value: c.key }, c.name))));
    sel.value = d.courier || ''; selects.set(String(d.id), sel);
    return el('tr', null, el('td', null, d.name), el('td', null, sel),
      el('td', { class: 'muted small' }, d.courier ? (d.manual ? el('span', { class: 'tip', title: 'Przypisane przez Ciebie ręcznie' }, 'ręcznie') : el('span', { class: 'tip', title: 'Przewoźnik rozpoznany po nazwie sposobu dostawy' }, 'wg nazwy')) : ''));
  });
  const res = el('span', { class: 'muted small', id: 'shipMapRes', role: 'status' }, msg || '');
  const save = el('button', { type: 'button', class: 'primary', write: 'przesylki', id: 'shipMapSave', title: 'Zapisuje zmiany przypisań — od razu wpływają na kolejki przewoźników', onclick: async () => {
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
    S.built = '';
    await ensureMeta();
    if (my !== S.routeSeq) return;
    if (!S.meta) { u.body.replaceChildren(unavailableBox(S.metaErr && !isUnavailable(S.metaErr) ? 'Nie udało się otworzyć przesyłek: ' + S.metaErr.message : MSG_UNAVAILABLE)); return; }
  }
  const part = S.route;
  const view = part === 'ustawienia' || OTHER[part] ? part : isCarrier(part) ? part : (isCarrier(store('osa-ship-courier')) ? store('osa-ship-courier') : 'inpost');
  if (view !== S.view) { S.sel.clear(); S.rows = []; S.total = 0; S.note = ''; S.lockers.clear(); S.loaded = false; S.built = ''; }
  S.view = view;
  S.Q = S.routeQ;
  if (isCarrier(view)) store('osa-ship-courier', view);
  renderSegs();
  if (view === 'ustawienia') { S.built = ''; renderSettings(); return; }
  if (OTHER[view]) { S.built = ''; renderOther(view); return; }
  // Ten sam przewoźnik, inne filtry / strona: bez przebudowy (wyszukiwarka nie traci fokusu), tylko nowe dane
  if (S.built !== view || !S.ui.results || !S.ui.results.isConnected) renderCourier();
  loadQueue();
}

export default {
  id: 'przesylki',
  title: 'Przesyłki',
  routes: ['', '<kurier>', 'ustawienia'],
  mount(el0, params) {
    if (!S.root) { S.root = el0; build(); }
    S.route = (params && params.parts && params.parts[0]) || '';
    S.routeQ = readQ(params && params.query);
    mountRoute();
  },
  unmount() { S.seq++; S.routeSeq++; },
};
