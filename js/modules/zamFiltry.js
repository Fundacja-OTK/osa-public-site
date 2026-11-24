// Zamówienia — logika filtrów złożonych (bez DOM, testowana w Node): grupy statusów, stan płatności, wykluczenia (NIE),
// szybkie widoki, zdanie opisujące filtr i zapisane widoki.
// Semantyka: w obrębie jednego filtra wartości są łączone LUB, wykluczenia to „bez (a LUB b)”, różne filtry łączy ORAZ.
// Wartości list to CSV w adresie (#/zamowienia?status=9,3&xstatus=7&pay=paid&trk=without&min=50&older=7).

const normTxt = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Klucze filtrów złożonych w adresie / stanie Q (wszystkie jako tekst). */
export const FKEYS = ['status', 'xstatus', 'pay', 'xpay', 'trk', 'min', 'max', 'older'];

export const PAY_STATES = [
  { key: 'paid', label: 'Opłacone', low: 'opłacone', tip: 'Wpłacono co najmniej całą wartość zamówienia z dostawą (pole „wpłacono” w Selly ≥ wartość − 1 gr). Zamówienia za 0 zł nie są zaliczane.' },
  { key: 'unpaid', label: 'Nieopłacone', low: 'nieopłacone', tip: 'Nic nie wpłacono (pole „wpłacono” w Selly = 0), a zamówienie ma wartość większą od zera.' },
  { key: 'partial', label: 'Częściowo', low: 'częściowo opłacone', tip: 'Wpłacono coś, ale mniej niż wartość zamówienia z dostawą.' },
  { key: 'over', label: 'Nadpłata', low: 'z nadpłatą', tip: 'Wpłacono więcej niż wartość zamówienia (to podzbiór „Opłacone” — do sprawdzenia lub zwrotu).' },
  { key: 'cod', label: 'Pobranie', low: 'za pobraniem', tip: 'Sposób płatności zawiera słowo „pobranie” (płatność u kuriera). Selly nie ma osobnej flagi, więc rozpoznajemy to po nazwie sposobu płatności.' },
];
export const TRACK_STATES = [
  { key: 'with', label: 'Z numerem przesyłki', low: 'z numerem przesyłki', tip: 'W zamówieniu jest wpisany numer przesyłki (list przewozowy).' },
  { key: 'without', label: 'Bez numeru przesyłki', low: 'bez numeru przesyłki', tip: 'W zamówieniu nie ma jeszcze numeru przesyłki — zwykle czeka na nadanie.' },
];
export const OLDER_OPTIONS = [1, 3, 7, 14, 30, 60];

export const STATUS_GROUPS = [
  { key: 'new', label: 'Nowe i oczekujące', tip: 'Złożone, czekające na płatność lub pierwsze działanie (nazwy zawierające np. „złożone”, „nowe”, „nieopłacone”, „oczekuje”).' },
  { key: 'work', label: 'W realizacji', tip: 'Opłacone, przyjęte do realizacji, pakowane (nazwy z „opłacone”, „realizacji”, „pakowanie”…).' },
  { key: 'sent', label: 'Wysłane', tip: 'Nadane i w drodze (nazwy z „wysłane”, „nadane”, „kurier”, „w drodze”).' },
  { key: 'done', label: 'Zakończone', tip: 'Zrealizowane, dostarczone, odebrane.' },
  { key: 'bad', label: 'Anulowane i zwroty', tip: 'Anulowane, zwrócone, odrzucone.' },
  { key: 'other', label: 'Inne', tip: 'Statusy, których nazwy nie pasują do żadnej grupy. Możesz je przypisać ręcznie w „Zaawansowane → Grupy statusów”.' },
];
const GROUP_KEYS = STATUS_GROUPS.map(g => g.key);

/** Grupa, do której domyślnie trafia status o tej nazwie (po słowach kluczowych; kolejność ma znaczenie). */
export function statusGroupOf(name) {
  const n = normTxt(name);
  if (/anul|zwrot|odrzuc|rezygn/.test(n)) return 'bad';
  if (/nieoplac|zlozon|oczek|nowe|nowy|przyjet.*zamow/.test(n)) return 'new';
  if (/wyslan|nadan|kurier|w drodze/.test(n)) return 'sent';
  if (/zrealiz|dostarcz|odebran|zakoncz/.test(n)) return 'done';
  if (/oplac|realizacj|przygot|pakow|spakow/.test(n)) return 'work';
  return 'other';
}

/** Statusy pogrupowane tematycznie: [{ key, label, tip, statuses:[{id,name,...}] }] (puste grupy pominięte). overrides: { [statusId]: groupKey }. */
export function groupStatuses(statuses, overrides) {
  const ov = overrides || {};
  const by = new Map(GROUP_KEYS.map(k => [k, []]));
  for (const s of statuses || []) {
    const forced = ov[String(s.id)];
    by.get(GROUP_KEYS.includes(forced) ? forced : statusGroupOf(s.name)).push(s);
  }
  return STATUS_GROUPS.map(g => ({ ...g, statuses: by.get(g.key) })).filter(g => g.statuses.length);
}

// ─── CSV ────────────────────────────────────────────────────────────────────

export const csvList = v => [...new Set(String(v == null ? '' : v).split(',').map(x => x.trim()).filter(Boolean))];
export const csvWith = (v, k) => { const a = csvList(v); if (!a.includes(k)) a.push(k); return a.join(','); };
export const csvWithout = (v, k) => csvList(v).filter(x => x !== k).join(',');
export const csvHas = (v, k) => csvList(v).includes(k);
const sameSet = (a, b) => { const x = csvList(a), y = csvList(b); return x.length === y.length && x.every(k => y.includes(k)); };

/** Klik w opcję filtra: tryb 'in' (pokaż) / 'out' (wyklucz). Ta sama opcja po raz drugi → wyłączona; z przeciwnej listy → przeniesiona. */
export function toggleOption(F, key, xkey, value, mode) {
  const mine = mode === 'out' ? xkey : key, other = mode === 'out' ? key : xkey;
  const on = csvHas(F[mine], value);
  return { [mine]: on ? csvWithout(F[mine], value) : csvWith(F[mine], value), [other]: csvWithout(F[other], value) };
}
/** Zaznacz / odznacz całą grupę naraz (wszystkie statusy grupy = „LUB”). */
export function toggleMany(F, key, xkey, values, mode) {
  const mine = mode === 'out' ? xkey : key, other = mode === 'out' ? key : xkey;
  const all = values.every(v => csvHas(F[mine], v));
  let cur = F[mine];
  for (const v of values) cur = all ? csvWithout(cur, v) : csvWith(cur, v);
  let oth = F[other];
  if (!all) for (const v of values) oth = csvWithout(oth, v);
  return { [mine]: cur, [other]: oth };
}

// ─── Adres ↔ filtry ─────────────────────────────────────────────────────────

const clean = (v, re) => { const s = String(v == null ? '' : v).trim().replace(',', '.'); return re.test(s) ? s : ''; };
const NUM = /^\d+(\.\d{1,2})?$/;
const validPay = v => csvList(v).filter(k => PAY_STATES.some(p => p.key === k)).join(',');
const validTrk = v => csvList(v).filter(k => TRACK_STATES.some(p => p.key === k)).join(',');
export function readFilters(g) {
  const older = clean(g('older'), /^\d{1,3}$/);
  return { status: csvList(g('status')).join(','), xstatus: csvList(g('xstatus')).join(','), pay: validPay(g('pay')), xpay: validPay(g('xpay')), trk: validTrk(g('trk')),
    min: clean(g('min'), NUM), max: clean(g('max'), NUM), older: older && Number(older) > 0 ? older : '' };
}
export function writeFilters(F, p) { for (const k of FKEYS) if (F[k]) p.set(k, F[k]); }

/** Parametry zapytania do backendu (orders:list). */
export function filterParams(F) {
  const p = {}, arr = v => csvList(v);
  if (F.status) p.statusIds = arr(F.status);
  if (F.xstatus) p.notStatusIds = arr(F.xstatus);
  if (F.pay) p.payState = arr(F.pay);
  if (F.xpay) p.notPayState = arr(F.xpay);
  if (F.trk) p.trackState = arr(F.trk);
  if (F.min) p.minTotal = F.min;
  if (F.max) p.maxTotal = F.max;
  return p;
}

const pad = n => String(n).padStart(2, '0');
const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
/** „Starsze niż N dni” → ostatni dzień zakresu (RRRR-MM-DD): zamówienia złożone N dni temu lub wcześniej. */
export function olderToDate(days, now) {
  const n = Number(days);
  if (!(n > 0)) return '';
  const d = new Date(now || Date.now());
  d.setDate(d.getDate() - n);
  return isoDay(d);
}
/** Górna granica dat dla zapytania: mniejsza z ręcznego „Do dnia” i granicy „starsze niż N dni”. */
export function effectiveDateTo(to, older, now) {
  const o = olderToDate(older, now);
  return o && (!to || o < to) ? o : (to || '');
}

// ─── Opis filtra: „Pokazuję zamówienia: płatność: opłacone ORAZ status: (Złożone LUB W realizacji)” ───

const joinOr = (labels, neg) => {
  const body = labels.length > 1 ? '(' + labels.join(' LUB ') + ')' : labels[0];
  return neg ? 'bez ' + body : body;
};
const money0 = v => String(v).replace('.', ',');

/**
 * Składniki zdania: [{ id, name, neg, items:[{ label, patch }], clear }]. Każdy `patch` (obiekt zmian Q) usuwa jedną wartość;
 * `clear` usuwa cały składnik. ctx: { statusName(id), payName(id), deliveryName(id), osaOn: bool, osaClear: obj }.
 */
export function clausesOf(Q, ctx) {
  const out = [];
  const list = (id, name, key, neg, csv, label) => {
    const vals = csvList(csv);
    if (!vals.length) return;
    out.push({ id, name, neg, items: vals.map(v => ({ label: label(v), patch: { [key]: csvWithout(csv, v) } })), clear: { [key]: '' } });
  };
  const payLabel = v => (PAY_STATES.find(p => p.key === v) || { low: v }).low;
  const trkLabel = v => (TRACK_STATES.find(p => p.key === v) || { low: v }).low;
  list('pay', 'płatność', 'pay', false, Q.pay, payLabel);
  list('xpay', 'płatność', 'xpay', true, Q.xpay, payLabel);
  list('status', 'status', 'status', false, Q.status, v => ctx.statusName(v));
  list('xstatus', 'status', 'xstatus', true, Q.xstatus, v => ctx.statusName(v));
  list('payment', 'sposób płatności', 'payment', false, Q.payment, v => ctx.payName(v));
  list('delivery', 'dostawa', 'delivery', false, Q.delivery, v => ctx.deliveryName(v));
  list('trk', 'przesyłka', 'trk', false, Q.trk, trkLabel);
  const plain = (id, name, label, clear) => out.push({ id, name, neg: false, items: [{ label, patch: clear }], clear });
  if (Q.min || Q.max) plain('total', 'wartość', (Q.min ? 'od ' + money0(Q.min) + ' zł' : '') + (Q.min && Q.max ? ' ' : '') + (Q.max ? 'do ' + money0(Q.max) + ' zł' : ''), { min: '', max: '' });
  if (Q.older) plain('older', 'złożone', 'co najmniej ' + Q.older + ' ' + (Number(Q.older) === 1 ? 'dzień' : 'dni') + ' temu', { older: '' });
  if (Q.from || Q.to) plain('dates', 'data', (Q.from ? 'od ' + Q.from : '') + (Q.from && Q.to ? ' ' : '') + (Q.to ? 'do ' + Q.to : ''), { from: '', to: '' });
  if (Q.product) plain('product', 'produkt', '„' + (Q.pname || '#' + Q.product) + '”', { product: '', pname: '' });
  if (Q.q) plain('q', 'szukane', '„' + Q.q + '”', { q: '' });
  if (ctx.osaOn) plain('osa', 'klient', 'filtry z notatek klientów', ctx.osaClear || {});
  return out;
}

/** Zdanie dla człowieka: pusty filtr → „Pokazuję wszystkie zamówienia.” */
export function sentenceOf(clauses) {
  if (!clauses.length) return 'Pokazuję wszystkie zamówienia.';
  return 'Pokazuję zamówienia: ' + clauses.map(c => c.name + ': ' + joinOr(c.items.map(i => i.label), c.neg)).join(' ORAZ ') + '.';
}

/** Czy jakikolwiek filtr (poza sortowaniem i stroną) jest aktywny. */
export const anyFilter = (Q, osaOn) => !!(Q.q || Q.from || Q.to || Q.payment || Q.delivery || Q.product || osaOn || FKEYS.some(k => Q[k]));

// ─── Szybkie widoki ─────────────────────────────────────────────────────────

/** Wartości zerujące wszystkie filtry złożone (do składania patchy). */
export const EMPTY_F = Object.fromEntries(FKEYS.map(k => [k, '']));

const idsOf = (groups, keys) => groups.filter(g => keys.includes(g.key)).flatMap(g => g.statuses.map(s => String(s.id))).join(',');

/** Gotowe widoki dla początkujących. groups = groupStatuses(...). build() zwraca pełny zestaw FKEYS (puste = bez filtra). */
export function presetsOf(groups) {
  const open = idsOf(groups, ['new', 'work']), bad = idsOf(groups, ['bad']), sent = idsOf(groups, ['sent']);
  return [
    { id: 'paid-todo', label: 'Opłacone do wysłania', tip: 'Płatność: opłacone w całości ORAZ status z grup „Nowe i oczekujące” lub „W realizacji” ORAZ bez numeru przesyłki. Czyli: klient zapłacił, a paczka jeszcze nie ma listu przewozowego.',
      build: () => ({ ...EMPTY_F, pay: 'paid', status: open, trk: 'without' }) },
    { id: 'to-send', label: 'Do nadania dziś', tip: 'Płatność: opłacone LUB za pobraniem ORAZ status z grup „Nowe i oczekujące” lub „W realizacji” ORAZ bez numeru przesyłki — wszystko, co można dziś nadać (bez anulowanych).',
      build: () => ({ ...EMPTY_F, pay: 'paid,cod', status: open, trk: 'without' }) },
    { id: 'unpaid-old', label: 'Nieopłacone starsze niż 7 dni', tip: 'Płatność: nieopłacone ORAZ złożone 7 dni temu lub wcześniej ORAZ status inny niż anulowane/zwroty — kandydaci do przypomnienia o płatności.',
      build: () => ({ ...EMPTY_F, pay: 'unpaid', older: '7', xstatus: bad }) },
    { id: 'partial', label: 'Częściowo opłacone', tip: 'Wpłacono mniej niż wartość zamówienia (bez anulowanych) — do dopłaty lub wyjaśnienia.',
      build: () => ({ ...EMPTY_F, pay: 'partial', xstatus: bad }) },
    { id: 'over', label: 'Nadpłaty', tip: 'Wpłacono więcej niż wartość zamówienia (bez anulowanych) — do zwrotu lub sprawdzenia.',
      build: () => ({ ...EMPTY_F, pay: 'over', xstatus: bad }) },
    sent ? { id: 'sent-no-tracking', label: 'Wysłane bez numeru przesyłki', tip: 'Status z grupy „Wysłane”, ale w zamówieniu nie ma numeru przesyłki — warto uzupełnić, żeby klient mógł śledzić paczkę.',
      build: () => ({ ...EMPTY_F, status: sent, trk: 'without' }) } : null,
  ].filter(Boolean);
}
/** Czy bieżące filtry złożone są dokładnie takie jak w widoku (kolejność wartości bez znaczenia). */
export const presetActive = (preset, Q) => { const b = preset.build(); return FKEYS.every(k => (k === 'min' || k === 'max' || k === 'older' ? (b[k] || '') === (Q[k] || '') : sameSet(b[k], Q[k]))); };

// ─── Zapisane widoki ────────────────────────────────────────────────────────

/** Filtry (bez strony i sortowania) jako tekst zapytania adresu — to jest treść zapisanego widoku. */
export function viewQs(qs) {
  const p = new URLSearchParams(String(qs || '').replace(/^\?/, ''));
  for (const k of ['page', 'sort', 'dir']) p.delete(k);
  return p.toString();
}
/** Odczyt listy widoków z surowej wartości (odporny na uszkodzone dane). */
export function cleanViews(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.qs === 'string').slice(0, 50)
    .map(v => ({ id: v.id.slice(0, 40), name: v.name.slice(0, 60), qs: viewQs(v.qs) }));
}
export function addView(views, name, qs, now) {
  const nm = String(name || '').trim().slice(0, 60);
  if (!nm) return views;
  return [...views.filter(v => v.name.toLowerCase() !== nm.toLowerCase()), { id: 'v' + (now || Date.now()).toString(36) + Math.floor(Math.random() * 1e4).toString(36), name: nm, qs: viewQs(qs) }];
}
export const renameView = (views, id, name) => { const nm = String(name || '').trim().slice(0, 60); return nm ? views.map(v => (v.id === id ? { ...v, name: nm } : v)) : views; };
export const removeView = (views, id) => views.filter(v => v.id !== id);
