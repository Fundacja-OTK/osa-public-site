// „Wysyłka SpeedMail” → zakładka Zamówienia: tabela wszystkich otwartych zamówień z podpowiedzią „SpeedMail / pakujemy sami” i powodem
// (reguły 1–5 specyfikacji). Sortowanie po każdej kolumnie, filtry i wyszukiwanie zapisane w adresie, zaznaczanie zbiorcze, ręczna zmiana
// decyzji w obie strony, przekazanie paczki zleceń (sm:batch) + status w Selly, „zostają u nas” (sm:keep + status „Złożone OTK”).
import { el, cnt, norm, sortTh, multiSelect, filterLayout, filterSection, dateRange, statusPill, menuButton, store } from '../core/ui.js?v=04d1829';
import { go } from '../core/router.js?v=04d1829';
import { S, SM, WRITE, STATUS_WRITE, plan, planSel, nf, dmy, notice, statusName, prodOf, needText, liveCtl, save, reload, runStatus, jobBusy, downloadBatch } from './speedmailKit.js?v=04d1829';

const KEYS = ['dec', 'reason', 'status', 'delivery', 'from', 'to', 'product', 'stock', 'pre', 'q'];
const SORTS = ['num', 'date', 'status', 'delivery', 'items', 'stock', 'dec', 'reason'];
// Bez stronicowania: cała lista pasująca do filtrów to jeden zbiór roboczy. Wiersze rysujemy porcjami (kolejne przy przewijaniu),
// żeby przerysowanie po kliknięciu pola wyboru było szybkie także przy ~3000 zamówień.
const CHUNK = 300;
const DEC = { sm: ['do SpeedMail', 'ok', 'SpeedMail pakuje to zamówienie w całości'], my: ['pakujemy sami', 'neutral', 'Zamówienie zostaje u nas — pakujemy je w całości sami'], sent: ['przekazane', 'acc', 'Zamówienie jest już w paczce zleceń przekazanej do SpeedMail'] };
const DEC_ORDER = { sm: 0, my: 1, sent: 2 }, STOCK_ORDER = { ok: 0, brak: 1, '': 2 };
const set = csv => new Set(String(csv || '').split(',').filter(Boolean));

function readQ(q) {
  const g = k => q.get(k) || '', sort = SORTS.includes(g('sort')) ? g('sort') : 'date';
  return { ...Object.fromEntries(KEYS.map(k => [k, g(k)])), sort, dir: g('dir') === 'desc' ? 'desc' : 'asc' };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  for (const k of KEYS) if (Q[k]) p.set(k, Q[k]);
  if (Q.sort !== 'date' || Q.dir !== 'asc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  return s ? '?' + s : '';
}
/** Zmiana filtrów / sortowania = nowy adres (da się go skopiować, dodać do zakładek, cofnąć). */
function setQ(patch, replace) {
  const Q = { ...readQ(S.query), ...patch };
  go('/speedmail/zamowienia' + qsOf(Q), replace ? { replace: true } : undefined);
}
const activeFilters = Q => KEYS.filter(k => Q[k]).length;

/**
 * Wiersze widoku z wierszy decyzji (przy zaznaczeniu: plan, w którym zaznaczone dostają towar pierwsze). `b` = decyzja, powód i towar
 * BEZ uwzględnienia zaznaczenia (zwykła kolejność od najstarszych) — według niej działają filtry, zakładki i przyciski „Zaznacz …”, żeby
 * samo zaznaczanie nie przesuwało zamówień między filtrami (inaczej zaznaczone znikało z widoku, a pasek liczył niewidoczne).
 */
function rowsOf(p, base) {
  const v = S.d.v, b0 = new Map(base.rows.map(r => [String(r.o.orderId), { result: r.result, code: r.code, stock: r.stock, reason: r.reason }]));
  return p.rows.map(r => {
    const id = String(r.o.orderId), prev = v.sent[id] && v.sent[id].cancelled ? v.sent[id].no : 0;
    return { r, id, num: r.o.orderNumber, day: String(r.o.date || '').slice(0, 10), statusId: r.o.statusId, status: statusName(r.o.statusId), delivery: r.o.delivery || '—',
      items: r.o.items.filter(i => i.qty > 0).map(i => i.name + ' × ' + nf(i.qty)).join(', '), result: r.result, code: r.code, reason: r.reason, stock: r.stock, presale: r.presale, prev,
      b: b0.get(id) || { result: r.result, code: r.code, stock: r.stock, reason: r.reason } };
  });
}
function match(x, Q, f) {
  if (f.dec.size && !f.dec.has(x.b.result)) return false;
  if (f.reason.size && !f.reason.has(x.b.code)) return false;
  if (f.status.size && !f.status.has(String(x.statusId))) return false;
  if (f.delivery.size && !f.delivery.has(x.delivery)) return false;
  if (Q.from && x.day < Q.from) return false;
  if (Q.to && x.day > Q.to) return false;
  if (f.product.size && ![...f.product].some(k => x.r.need[k])) return false;
  if (Q.stock && x.b.stock !== Q.stock) return false;
  if (Q.pre && (Q.pre === '1') !== !!x.presale) return false;
  if (f.q && !norm(x.num).includes(f.q)) return false;
  return true;
}
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
// Kto pakuje / towar / powód — wg decyzji bez zaznaczenia (x.b), żeby zaznaczanie nie przestawiało wierszy między stronami
const SORT_VAL = { num: x => x.num, date: x => x.r.o.date, status: x => x.status, delivery: x => x.delivery, items: x => x.items, stock: x => STOCK_ORDER[x.b.stock], dec: x => DEC_ORDER[x.b.result], reason: x => x.b.reason };
function sortRows(rows, Q) {
  const val = SORT_VAL[Q.sort], sign = Q.dir === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    const c = typeof va === 'number' ? va - vb : collator.compare(String(va), String(vb));
    return (c || collator.compare(a.r.o.date, b.r.o.date) || collator.compare(a.id, b.id)) * (c ? sign : 1);
  });
}

// ─── Stałe elementy widoku (filtry zostają otwarte przy przerysowaniu) ───────
let u = null;
function build() {
  u = {};
  u.search = el('input', { type: 'search', id: 'smQ', placeholder: 'Szukaj numeru zamówienia…', 'aria-label': 'Szukaj numeru zamówienia', title: 'Fragment numeru zamówienia' });
  u.search.addEventListener('input', () => setQ({ q: u.search.value.trim() }, true));
  const ms = (id, all, short, noun, tip, field) => multiSelect({ id, all, short, noun, tip, none: false, onChange: csv => setQ({ [field]: csv }) });
  u.reason = ms('smFReason', 'Każdy powód', 'Powód', 'powody decyzji', 'Pokaż tylko zamówienia z wybranym powodem decyzji (np. forma dostawy, brak towaru w SpeedMail)', 'reason');
  u.status = ms('smFStatus', 'Każdy status', 'Status', 'statusy zamówień', 'Status zamówienia w Selly', 'status');
  u.delivery = ms('smFDelivery', 'Każda dostawa', 'Dostawa', 'formy dostawy', 'Forma dostawy wybrana w zamówieniu', 'delivery');
  u.product = ms('smFProduct', 'Każdy produkt', 'Produkt', 'produkty SpeedMail', 'Zamówienia zawierające wybrany produkt z listy SpeedMail (także w zestawie, np. korony w licencji)', 'product');
  const pick = (id, label, tip, field, opts) => {
    const s = el('select', { id, 'aria-label': label, title: tip }, opts.map(([v, t]) => el('option', { value: v }, t)));
    s.addEventListener('change', () => setQ({ [field]: s.value }));
    return s;
  };
  u.dec = pick('smFDec', 'Decyzja', 'Kto pakuje zamówienie wg podpowiedzi (albo ręcznego oznaczenia)', 'dec', [['', 'Każda decyzja'], ['sm', 'Do SpeedMail'], ['my', 'Pakujemy sami'], ['sent', 'Już przekazane']]);
  u.stock = pick('smFStock', 'Towar w SpeedMail', 'Czy SpeedMail ma towar na całe zamówienie (po odjęciu wcześniejszych zamówień)', 'stock', [['', 'Bez znaczenia'], ['ok', 'Towar jest'], ['brak', 'Towaru brakuje']]);
  u.pre = pick('smFPre', 'Przedsprzedaż', 'Zamówienia z produktami z przedsprzedaży (korony, śpiewniki OTK, naklejki, identyfikatory) — SpeedMail wysyła je od dnia startu przedsprzedaży', 'pre', [['', 'Bez znaczenia'], ['1', 'Z przedsprzedażą'], ['0', 'Bez przedsprzedaży']]);
  u.range = dateRange({ idFrom: 'smFFrom', idTo: 'smFTo', labelFrom: 'Od dnia', labelTo: 'Do dnia', titleFrom: 'Zamówienia złożone od tego dnia (włącznie)', titleTo: 'Zamówienia złożone do tego dnia (włącznie)',
    onChange: ({ from, to }) => setQ({ from, to }) });
  u.filtersBtn = el('button', { type: 'button', class: 'secondary', id: 'smFiltersBtn', 'aria-controls': 'smFilters', title: 'Pokaż albo ukryj filtry: decyzja, powód, status, dostawa, data, produkt, towar w SpeedMail, przedsprzedaż',
    onclick: () => { u.layout.setOpen(!u.layout.isOpen()); S.rerender(); } });
  u.clear = el('button', { type: 'button', class: 'ghost small', id: 'smFClear', title: 'Usuń wszystkie filtry i wyszukiwanie', onclick: () => setQ(Object.fromEntries(KEYS.map(k => [k, ''])) ) }, 'Wyczyść filtry');
  u.segs = el('div', { class: 'toolbar sm-segs', id: 'smSegs', role: 'group', 'aria-label': 'Decyzja' });
  u.results = el('div', { id: 'smResults' });
  u.layout = filterLayout({ key: 'speedmail', panelId: 'smFilters', mainNodes: [u.segs, el('div', { class: 'toolbar' }, u.search, u.filtersBtn, u.clear), u.results],
    panelNodes: [
      filterSection('Decyzja', u.dec), filterSection('Powód decyzji', u.reason.node, { tip: 'Która reguła zdecydowała' }), filterSection('Towar w SpeedMail', u.stock),
      filterSection('Status w Selly', u.status.node), filterSection('Forma dostawy', u.delivery.node), filterSection('Data zamówienia', u.range.node),
      filterSection('Produkt', u.product.node), filterSection('Przedsprzedaż', u.pre)] });
  u.root = el('div', { id: 'smOrders' });
}

const countBy = (rows, f) => { const m = new Map(); for (const x of rows) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); } return m; };
const opts = (m, labelOf) => [...m].map(([key, n]) => ({ key: String(key), label: labelOf(key), n })).sort((a, b) => collator.compare(a.label, b.label));

export function viewOrders() {
  if (!u) build();
  const v = S.d.v, Q = readQ(S.query);
  const base = plan(), f = { dec: set(Q.dec), reason: set(Q.reason), status: set(Q.status), delivery: set(Q.delivery), product: set(Q.product), q: norm(Q.q) };
  // Zbiór roboczy = zamówienia pasujące do filtrów (cała lista, bez stron). Zaznaczenie jest zawsze jego podzbiorem: po zmianie filtrów,
  // odświeżeniu albo przekazaniu reszta jest odznaczana (z krótką notką) — liczba w pasku = zaznaczone pola wyboru.
  const pickable = new Set(rowsOf(base, base).filter(x => x.b.result !== 'sent' && match(x, Q, f)).map(x => x.id));
  let dropped = 0;
  for (const id of [...S.sel]) if (!pickable.has(id)) { S.sel.delete(id); dropped++; }
  if (dropped) u.dropped = (u.dropped || 0) + dropped;
  const all = rowsOf(planSel(S.sel), base);
  const shown = sortRows(all.filter(x => match(x, Q, f)), Q);

  // filtry: wartości z adresu + listy z liczbą zamówień
  if (u.search.value.trim() !== Q.q) u.search.value = Q.q;
  u.dec.value = Q.dec; u.stock.value = Q.stock; u.pre.value = Q.pre;
  if (u.range.from.value !== Q.from) u.range.from.value = Q.from;
  if (u.range.to.value !== Q.to) u.range.to.value = Q.to;
  u.reason.set(opts(countBy(all, x => x.b.code), k => SM.REASONS[k].label), Q.reason);
  u.status.set(opts(countBy(all, x => String(x.statusId)), statusName), Q.status);
  u.delivery.set(opts(countBy(all, x => x.delivery), k => k), Q.delivery);
  const prodN = new Map();
  for (const x of all) for (const k in x.r.need) prodN.set(k, (prodN.get(k) || 0) + 1);
  u.product.set(opts(prodN, k => (prodOf(k) || { name: k }).name), Q.product);
  const nf2 = activeFilters(Q);
  u.filtersBtn.textContent = (u.layout.isOpen() ? 'Ukryj filtry' : 'Filtry') + (nf2 ? ' (' + nf2 + ')' : '');
  u.filtersBtn.setAttribute('aria-expanded', String(u.layout.isOpen()));
  u.clear.hidden = !nf2;

  const nDec = countBy(all, x => x.b.result);
  const seg = (key, label, tip) => el('button', { type: 'button', class: 'chip', id: 'smSeg' + (key || 'All'), 'aria-pressed': String(Q.dec === key), title: tip, onclick: () => setQ({ dec: key }) },
    label, el('span', { class: 'ord-n' }, String(key ? nDec.get(key) || 0 : all.length)));
  u.segs.replaceChildren(
    seg('', 'Wszystkie', 'Wszystkie zamówienia w statusach: ' + (v.use.open.concat(v.use.sm ? [v.use.sm] : []).map(statusName).join(', ') || '—') + '. Statusy zmienisz w Ustawieniach.'),
    seg('sm', 'Do SpeedMail', 'Zamówienia, które wg reguł (albo ręcznego oznaczenia) pakuje SpeedMail i na które SpeedMail ma towar — w zwykłej kolejności (od najstarszych), bez uwzględniania zaznaczenia'),
    seg('my', 'Pakujemy sami', 'Zamówienia, które zostają u nas — powód w kolumnie „Dlaczego”. Decyzja w zwykłej kolejności (od najstarszych), bez uwzględniania zaznaczenia'),
    seg('sent', 'Już przekazane', 'Zamówienia zapisane w paczce zleceń, które nie zmieniły jeszcze statusu w Selly'),
    el('span', { class: 'spacer' }),
    S.loading.init ? el('span', { class: 'muted small', id: 'smFresh', role: 'status', title: 'Pokazuję ostatnią kopię, a w tle pobieram świeże dane' }, el('span', { class: 'spinner' }), ' odświeżam…') : null,
    liveCtl().node);

  u.results.replaceChildren(...results(v, Q, all, shown));
  u.root.replaceChildren(...head(v, all), u.layout.node);
  return u.root;
}

function head(v, all) {
  const out = [];
  const noStock = v.cfg.products.every(p => !p.sent) && !Object.keys(v.totals).length;
  if (noStock) out.push(notice('warn', 'Nie wpisano jeszcze, ile towaru wysłano do SpeedMail — panel uznaje, że SpeedMail nic nie ma, więc każde zamówienie zostaje u nas z powodu „brak towaru”. ',
    el('a', { href: '#/speedmail/ustawienia' }, 'Wpisz ilości w Ustawieniach →')));
  if (v.truncated) out.push(notice('warn', 'Zamówień w wybranych statusach jest bardzo dużo — pokazano najstarsze 3000. Zawęź w Ustawieniach statusy, z których wybierasz.'));
  if (!v.use.open.length && !all.length) out.push(notice('warn', 'Nie wybrano statusów, z których panel ma brać zamówienia. ', el('a', { href: '#/speedmail/ustawienia' }, 'Ustaw je w Ustawieniach →')));
  return out;
}

function results(v, Q, all, shown) {
  // Porcje wierszy: liczba narysowanych rośnie przy przewijaniu; nowe filtry / sortowanie zaczynają od pierwszej porcji
  const viewKey = qsOf(Q);
  if (u.viewKey !== viewKey) { u.viewKey = viewKey; u.limit = CHUNK; }
  const visible = shown.slice(0, u.limit);
  const byId = new Map(all.map(x => [x.id, x]));
  const selRows = [...S.sel].map(id => byId.get(id)).filter(Boolean);
  const selSm = selRows.filter(x => x.result === 'sm'), selMy = selRows.filter(x => x.result === 'my');
  const work = [...new Set(shown.filter(x => x.b.result !== 'sent').map(x => x.id))];   // zbiór roboczy (do zaznaczenia): pasujące do filtrów, bez już przekazanych
  const setSel = ids => { S.sel = new Set(ids); u.dropped = 0; S.rerender(); };
  const clearSel = () => setSel([]);

  // Pole w nagłówku = wszystkie zamówienia pasujące do filtrów (cała lista). Gdy wszystkie są zaznaczone, klik = „Wyczyść zaznaczenie” (to samo działanie)
  const nSel = work.filter(id => S.sel.has(id)).length;
  const allCb = el('input', { type: 'checkbox', id: 'smSelAll', 'aria-label': 'Zaznacz wszystkie zamówienia pasujące do filtrów',
    title: work.length ? 'Zaznacza wszystkie zamówienia pasujące do filtrów (' + work.length + ', cała lista), a gdy wszystkie są zaznaczone — czyści zaznaczenie' : 'Brak zamówień do zaznaczenia (już przekazanych nie da się zaznaczyć)' });
  allCb.checked = work.length > 0 && nSel === work.length;
  allCb.indeterminate = nSel > 0 && nSel < work.length;
  allCb.disabled = !work.length;
  allCb.addEventListener('change', () => (nSel === work.length ? clearSel() : setSel(work)));
  const cols = [
    { label: 'Zamówienie', sort: 'num', tip: 'Numer zamówienia w Selly — klik otwiera kartę zamówienia' },
    { label: 'Data', sort: 'date', tip: 'Data złożenia zamówienia (od niej zależy reguła terminów)', firstDir: 'asc' },
    { label: 'Status', sort: 'status', tip: 'Obecny status zamówienia w Selly' },
    { label: 'Dostawa', sort: 'delivery', tip: 'Forma dostawy z zamówienia. Do SpeedMail idą tylko: ' + (v.cfg.couriers.join(', ') || '—') + ' (zmienisz w Ustawieniach)', tipHeader: true },
    { label: 'Produkty', sort: 'items', tip: 'Pozycje zamówienia. Najedź na komórkę, aby zobaczyć je przeliczone na produkty SpeedMail (zestawy rozbite na składniki)', tipHeader: true },
    { label: 'Towar w SM', sort: 'stock', tip: 'Czy SpeedMail ma towar na CAŁE zamówienie: stan przed tym zamówieniem, produkt ograniczający pierwszy. Panel przydziela towar od najstarszych zamówień (zaznaczone dostają go pierwsze), a wcześniej przekazane już go zmniejszyły', tipHeader: true },
    { label: 'Kto pakuje', sort: 'dec', tip: 'Podpowiedź panelu: SpeedMail albo my. Zamówienia nie dzielimy — pakuje je w całości jedna strona. Decyzję możesz zmienić w ostatniej kolumnie', tipHeader: true },
    { label: 'Dlaczego', sort: 'reason', tip: 'Powód decyzji: która reguła zdecydowała (forma dostawy, lista produktów, terminy, ręczne oznaczenie, stan SpeedMail)', tipHeader: true },
  ];
  const sel = S.sel.size > 0;
  // Braki przy zaznaczeniu idącym do SpeedMail: zaznaczone, które się nie mieszczą (reguła 5 — zostają u nas; sm:batch ich nie przyjmie),
  // zaznaczone ręcznie „do SM” mimo braku (serwer przyjmie, stan zejdzie poniżej zera) i inne, którym zabraknie przez zaznaczenie
  const short = shortInfo(v, selRows, selSm, all);
  u.shortIds = short.ids;
  const ths = cols.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir })));
  // Znacznik zawsze w nagłówku (niewidoczny bez zaznaczenia) — zaznaczenie nie zmienia wysokości nagłówka ani układu tabeli
  ths[5].append(el('span', { class: 'sm-selnote tip' + (sel ? ' on' : ''), id: 'smSelNote', 'aria-hidden': sel ? null : 'true', title: 'Liczby i decyzje uwzględniają zaznaczone zamówienia: dostają one towar jako pierwsze (tak policzy go serwer przy przekazaniu), a pozostałe — z tego, co zostanie. Wyczyść zaznaczenie, aby wrócić do zwykłej kolejności (od najstarszych).' }, '◆'));
  const head = el('tr', null, el('th', null, allCb), ...ths, el('th', null, el('span', { class: 'tip', title: 'Ręczna zmiana decyzji dla jednego zamówienia (z powodem, który zostaje w tabeli)' }, 'Zmień')));
  const more = shown.length - visible.length;
  const moreRow = more > 0 ? el('tr', { id: 'smMore' }, el('td', { colspan: '10', class: 'muted small' }, 'Pokazano ' + visible.length + ' z ' + shown.length + ' — kolejne pojawią się przy przewijaniu. ',
    el('button', { type: 'button', class: 'link', id: 'smMoreBtn', title: 'Dorysuj kolejne zamówienia (zaznaczanie i liczby i tak obejmują całą listę)', onclick: () => { u.limit += CHUNK; S.rerender(); } }, 'Pokaż kolejne ' + Math.min(CHUNK, more)))) : null;
  const body = el('tbody', null, visible.length ? visible.map(x => rowEl(x)) : el('tr', null, el('td', { colspan: '10', class: 'empty' },
    all.length ? 'Żadne zamówienie nie pasuje do filtrów. ' : 'Brak otwartych zamówień w wybranych statusach.', all.length ? el('button', { type: 'button', class: 'link', onclick: () => setQ(Object.fromEntries(KEYS.map(k => [k, '']))) }, 'Wyczyść filtry') : null)), moreRow);
  if (u.moreObs) u.moreObs.disconnect();
  if (moreRow && typeof IntersectionObserver !== 'undefined') {
    u.moreObs = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && moreRow.isConnected) { u.moreObs.disconnect(); u.limit += CHUNK; S.rerender(); } }, { rootMargin: '600px 0px' });
    u.moreObs.observe(moreRow);
  }

  // Gotowe zaznaczenia: ZASTĘPUJĄ zaznaczenie wszystkimi zamówieniami z listy o danej decyzji — wg decyzji BEZ zaznaczenia (x.b): zaznaczenie
  // daje zaznaczonym towar pierwsze i zmienia decyzje innych, więc wybór wg decyzji po zaznaczeniu zmieniałby się przy każdym kliknięciu
  // Liczone z tego samego zbioru roboczego co pole w nagłówku (pasujące do filtrów, bez przekazanych, bez powtórzeń) — liczba przy przycisku = ile zaznaczy
  const inWork = new Set(work), pickOf = dec => [...new Set(shown.filter(x => x.b.result === dec && inWork.has(x.id)).map(x => x.id))];
  const smAll = pickOf('sm'), myAll = pickOf('my');
  const dropNote = u.dropped ? el('span', { class: 'muted small tip', id: 'smSelDropped', title: 'Zaznaczenie obejmuje tylko zamówienia pasujące do bieżących filtrów — po zmianie filtrów albo odświeżeniu danych ukryte i już przekazane są odznaczane' },
    'Odznaczono ' + cnt(u.dropped, 'zamówienie ukryte', 'zamówienia ukryte', 'zamówień ukrytych') + ' przez filtry lub odświeżenie.') : null;
  const picks = el('div', { class: 'toolbar sm-picks', id: 'smPicks' },
    el('span', { class: 'muted small tip', title: 'Gotowe zaznaczenia: zastępują bieżące zaznaczenie wszystkimi zamówieniami z listy (pasującymi do filtrów) o danej decyzji. Pojedyncze zamówienia zaznaczysz polami wyboru, całą listę — polem w nagłówku tabeli' }, 'Zaznacz:'),
    el('button', { type: 'button', class: 'secondary small', id: 'smPickSm', disabled: !smAll.length,
      title: smAll.length ? 'Zastępuje zaznaczenie: zaznacza wszystkie zamówienia z listy (' + smAll.length + '), które w zwykłej kolejności (od najstarszych, bez uwzględniania zaznaczenia) idą do SpeedMail' : 'Na liście nie ma zamówień „do SpeedMail”',
      onclick: () => setSel(smAll) }, 'wszystkie „do SpeedMail” (' + smAll.length + ')'),
    el('button', { type: 'button', class: 'secondary small', id: 'smPickMy', disabled: !myAll.length,
      title: myAll.length ? 'Zastępuje zaznaczenie: zaznacza wszystkie zamówienia z listy (' + myAll.length + '), które w zwykłej kolejności (od najstarszych, bez uwzględniania zaznaczenia) pakujemy sami. W pasku część z nich może wyjść „do SpeedMail”, bo zaznaczone dostają towar pierwsze' : 'Na liście nie ma zamówień „pakujemy sami”',
      onclick: () => setSel(myAll) }, 'wszystkie „pakujemy sami” (' + myAll.length + ')'),
    el('span', { class: 'spacer' }), dropNote,
    el('span', { class: 'muted small', id: 'smShown', title: 'Ile zamówień pasuje do filtrów / ile jest wszystkich' }, 'Pokazano ' + shown.length + ' z ' + all.length));

  return [picks,
    el('div', { class: 'table-wrap' }, el('table', { id: 'smTable', class: 'sm-table' }, el('thead', null, head), body)),
    el('p', { class: 'muted small' }, 'Reguła 4 (wysyłka pilna, prośba o innego kuriera niż FedEx) nie ma jeszcze źródła danych w zamówieniu — takie zamówienia oznacz ręcznie: „Zmień” → „pakujemy sami”.'),
    selBar(v, selRows, selSm, selMy, short, clearSel), modal(v)];
}

/** Okno potwierdzenia (zmiana decyzji, przekazanie) i wynik przekazania — zwykłe okno modalne nad stroną, nie w pasku. */
function modal(v) {
  const box = S.dlg && (S.dlg.kind === 'mark' || S.dlg.kind === 'batch') ? dialog(v) : S.lastBatch ? batchDone() : null;
  if (!box) return null;
  box.setAttribute('aria-modal', 'true');
  return el('div', { class: 'sm-modal', id: 'smModal' }, box);
}

/**
 * Braki zaznaczenia: rows — zaznaczone bez towaru (zostają u nas), forced — zaznaczone ręcznie „do SM” mimo braku, other — inne zamówienia,
 * którym zabraknie przez zaznaczenie; lack — produkt → ile brakuje, żeby wszystkie zaznaczone poszły do SpeedMail (potrzeba − stan).
 * Tylko gdy zaznaczenie idzie do SpeedMail (same „pakujemy sami” nie zużywają stanu, więc nie ostrzegamy).
 */
function shortInfo(v, selRows, selSm, all) {
  const none = { any: false, rows: [], forced: [], other: [], lack: [], ids: new Set() };
  if (!selSm.length) return none;
  const rows = selRows.filter(x => x.result === 'my' && x.code === 'stock'), forced = selSm.filter(x => x.r.missing && x.r.missing.length), other = all.filter(x => x.r.bySel);
  if (!rows.length && !forced.length && !other.length) return none;
  const want = selSm.concat(rows), u2 = SM.selectionUse(want.map(x => x.r), new Set(want.map(x => x.id)), v.totals, v.cfg);
  const lack = u2.over.map(k => ({ k, p: prodOf(k) || { name: k, unit: '' }, n: u2.lack[k] })).sort((a, b) => b.n - a.n);
  return { any: true, rows, forced, other, lack, ids: new Set(rows.concat(forced, other).map(x => x.id)) };
}

/** Tekst ostrzeżenia o brakach: { what: „Lizak −250 szt. · Korona −1 200 szt.”, who: „2 zaznaczone zamówienia się nie mieszczą …”, tip }. */
function shortText(sh) {
  const shown = sh.lack.slice(0, 4), rest = sh.lack.length - shown.length;
  const what = shown.map(x => shortName(x.p.name) + ' −' + nf(x.n) + ' ' + x.p.unit).join(' · ') + (rest ? ' · +' + rest + ' ' + (rest === 1 ? 'produkt' : rest < 5 ? 'produkty' : 'produktów') : '');
  const who = [
    sh.rows.length ? cnt(sh.rows.length, 'zaznaczone zamówienie się nie mieści', 'zaznaczone zamówienia się nie mieszczą', 'zaznaczonych zamówień się nie mieści') + ' — zostaje u nas' : '',
    sh.forced.length ? cnt(sh.forced.length, 'zamówienie', 'zamówienia', 'zamówień') + ' przekazujesz mimo braku' : '',
    sh.other.length ? cnt(sh.other.length, 'innemu zamówieniu', 'innym zamówieniom', 'innym zamówieniom') + ' zabraknie przez zaznaczenie' : ''].filter(Boolean).join(' · ');
  const NL = String.fromCharCode(10);
  const tip = 'Ile towaru brakuje w SpeedMail, żeby wszystkie zaznaczone zamówienia poszły do SpeedMail (potrzeba zaznaczonych − stan SpeedMail)' +
    (sh.lack.length ? ':' + NL + sh.lack.map(x => x.p.name + ': brakuje ' + nf(x.n) + ' ' + x.p.unit).join(NL) : ' — zaznaczone się mieszczą, ale zabierają towar innym zamówieniom.') +
    NL + NL + (who ? who + '.' + NL : '') + 'Wiersze z brakiem są podświetlone w tabeli. Kliknij, aby zobaczyć „Szczegóły braków”.';
  return { what, who, tip, head: sh.lack.length ? 'Brakuje towaru: ' : 'Zaznaczenie zabiera towar innym zamówieniom' };
}

const BAR_OPEN = 'osa.sm.barOpen';
/**
 * Przyklejony dolny pasek zaznaczenia — domyślnie JEDNA linia (liczba wg decyzji · ostrzeżenie o brakach · akcje), żeby nie zasłaniał listy.
 * Resztę (stan SpeedMail, „Szczegóły braków”, wyjaśnienia) pokazuje panel rozwijany w górę przyciskiem „Szczegóły ▴” (zapamiętane w przeglądarce).
 * Pasek stoi w układzie strony pod tabelą (sticky), więc koniec listy nigdy nie jest nim zasłonięty.
 */
function selBar(v, selRows, selSm, selMy, sh, clearSel) {
  const n = selRows.length;
  if (!n) return el('div', { class: 'save-bar lv-bar sm-bar', id: 'smBulk', hidden: true });
  // Zużycie stanu SM liczą tylko zaznaczone, które pójdą do SpeedMail (decyzja SM, także ręczne „do SM”) — tak samo jak sm:batch, który
  // przyjmuje tylko je (zaznaczone bez towaru zostają u nas; ręczne „do SM” mimo braku serwer przyjmuje i oznacza „mimo braku”).
  const selShort = sh.rows, bySel = sh.other.length;
  const use = SM.selectionUse(selSm.map(x => x.r), new Set(selSm.map(x => x.id)), v.totals, v.cfg);
  const cfgSt = v.use;
  let open = !!store(BAR_OPEN);
  const st = sh.any ? shortText(sh) : null;
  const panel = el('div', { class: 'sm-bar-panel', id: 'smBarPanel', hidden: !open || null },
    st ? el('div', { class: 'sm-short', id: 'smShortLine' }, el('span', { class: 'sm-short-ico', 'aria-hidden': 'true' }, '⚠'), ' ', el('strong', null, st.head), st.what, st.who ? ' (' + st.who + ')' : '') : null,
    el('div', { class: 'sm-sel', id: 'smSelFull' }, 'Zaznaczono ' + cnt(n, 'zamówienie', 'zamówienia', 'zamówień') + ': do SpeedMail ' + selSm.length + ' · pakujemy sami ' + selMy.length),
    selSm.length ? useLine(use) : null,
    el('div', { class: 'muted small', id: 'smSelHint' }, 'Kolumna „Towar w SM” i decyzje są liczone po uwzględnieniu zaznaczonych: dostają one towar pierwsze, pozostałe zamówienia — z tego, co zostanie.',
      selShort.length ? el('span', { id: 'smSelStockNote', class: 'tip', title: 'Na te zamówienia nie starcza towaru w SpeedMail nawet z pierwszeństwem — przy przekazaniu nie pójdą do SpeedMail i nie zmniejszą jego stanu. Szczegóły poniżej („Szczegóły braków”).' },
        ' ' + cnt(selShort.length, 'zaznaczone zostaje', 'zaznaczone zostają', 'zaznaczonych zostaje') + ' u nas z powodu braku towaru w SpeedMail.') : null,
      bySel ? el('strong', null, ' Przez zaznaczenie towaru zabraknie dla ' + cnt(bySel, 'innego zamówienia', 'innych zamówień', 'innych zamówień') + ' (oznaczone „brak po zaznaczeniu”).') : null),
    sh.any ? shortDetails(selShort, sh.other, sh.forced) : null,
    el('div', { class: 'sm-bar-sec2' },
      el('button', { type: 'button', class: 'ghost', id: 'smSelClearM', title: 'Odznacza wszystkie zamówienia (to samo co odznaczenie pola w nagłówku tabeli)', onclick: clearSel }, 'Wyczyść zaznaczenie')));
  const more = el('button', { type: 'button', class: 'ghost sm-bar-more', id: 'smBarMore', 'aria-controls': 'smBarPanel', 'aria-expanded': String(open), 'aria-label': 'Szczegóły zaznaczenia',
    title: 'Pokaż albo ukryj szczegóły zaznaczenia: zużycie stanu SpeedMail, braki i wyjaśnienia (wybór zapamiętany w tej przeglądarce)' }, el('span', { class: 'sm-more-l' }, 'Szczegóły '), el('span', { class: 'sm-more-a' }, open ? '▾' : '▴'));
  const setOpen = o => { open = o; panel.hidden = !o; more.setAttribute('aria-expanded', String(o)); more.querySelector('.sm-more-a').textContent = o ? '▾' : '▴'; bar.classList.toggle('open', o); store(BAR_OPEN, o); };
  more.addEventListener('click', () => setOpen(!open));
  const warn = st ? el('button', { type: 'button', class: 'sm-warn-badge', id: 'smShortWarn', title: st.tip, 'aria-controls': 'smBarPanel', onclick: () => setOpen(true) },
    el('span', { 'aria-hidden': 'true' }, '⚠ '), el('span', { class: 'sm-warn-t' }, st.head + st.what)) : null;
  const sendTail = selShort.length ? ' (' + selShort.length + ' bez towaru)' : sh.forced.length ? ' (' + sh.forced.length + ' mimo braku)' : '';
  const line = el('div', { class: 'sm-bar-line' },
    el('div', { class: 'sm-sel', id: 'smSelSum', role: 'status', title: 'Zaznaczono ' + cnt(n, 'zamówienie', 'zamówienia', 'zamówień') + ': do SpeedMail ' + selSm.length + ', pakujemy sami ' + selMy.length },
      el('span', { class: 'sm-sel-w' }, 'Zaznaczono '), el('strong', { id: 'smSelCount' }, cnt(n, 'zamówienie', 'zamówienia', 'zamówień')),
      el('span', { class: 'sm-sel-by' }, ': do SpeedMail ', el('strong', null, String(selSm.length)), ' · pakujemy sami ', el('strong', null, String(selMy.length)))),
    el('button', { type: 'button', class: 'ghost sm-clear', id: 'smSelClear', 'aria-label': 'Wyczyść zaznaczenie', title: 'Wyczyść zaznaczenie — odznacza wszystkie zamówienia (to samo co odznaczenie pola w nagłówku tabeli)', onclick: clearSel }, '✕'),
    warn, more,
    el('span', { class: 'spacer' }),
    el('div', { class: 'sm-bar-sec' },
      el('button', { type: 'button', class: 'secondary', id: 'smKeep', write: STATUS_WRITE, disabled: !selMy.length || !cfgSt.otk || jobBusy(),
        title: !cfgSt.otk ? 'Wybierz w Ustawieniach status dla zamówień pakowanych u nas (np. „Złożone OTK”)' : selMy.length ? 'Zapisuje decyzję „pakujemy sami” i zmienia w Selly status na „' + statusName(cfgSt.otk) + '” — zamówienia znikną z tej listy' : 'Żadne zaznaczone zamówienie nie jest „pakujemy sami”',
        onclick: () => keep(selMy, cfgSt.otk) }, 'Zostają u nas' + (selMy.length ? ' (' + selMy.length + ')' : '')),
      menuButton({ id: 'smMarkMenu', label: 'Zmień decyzję', cls: 'secondary', write: WRITE, disabled: jobBusy(), title: 'Ręczna zmiana decyzji dla zaznaczonych zamówień — w obie strony, z powodem',
        items: () => [
          { label: 'Pakujemy sami (np. wysyłka pilna, inny kurier)…', title: 'Zaznaczone zamówienia zostają u nas niezależnie od reguł', run: () => { S.dlg = { kind: 'mark', to: 'my', ids: [...S.sel] }; S.rerender(); } },
          { label: 'Do SpeedMail mimo reguł…', title: 'Zaznaczone zamówienia idą do SpeedMail mimo formy dostawy, terminu albo braku towaru. Nie działa dla produktów spoza listy SpeedMail', run: () => { S.dlg = { kind: 'mark', to: 'sm', ids: [...S.sel] }; S.rerender(); } },
          { label: 'Usuń ręczne oznaczenie', title: 'Wraca do podpowiedzi wg reguł', run: () => mark([...S.sel], '', '') }] })),
    el('button', { type: 'button', class: 'primary', id: 'smSend', write: WRITE, disabled: !selSm.length || jobBusy(),
      title: selSm.length ? (selShort.length ? 'Przekaże tylko ' + cnt(selSm.length, 'zamówienie', 'zamówienia', 'zamówień') + ' z towarem; ' + cnt(selShort.length, 'zaznaczone bez towaru zostaje', 'zaznaczone bez towaru zostają', 'zaznaczonych bez towaru zostaje') + ' u nas (serwer przyjmuje tylko zamówienia „do SpeedMail”). ' : '') +
        (sh.forced.length ? cnt(sh.forced.length, 'zamówienie oznaczone', 'zamówienia oznaczone', 'zamówień oznaczonych') + ' ręcznie „do SpeedMail” przekażesz mimo braku — stan zejdzie poniżej zera. ' : '') +
        'Zapisuje paczkę zleceń (stan SpeedMail zmniejsza się o te zamówienia)' + (cfgSt.sm ? ' i zmienia w Selly status na „' + statusName(cfgSt.sm) + '”' : '') + '. Potem pobierzesz plik Excel dla SpeedMail.' : 'Żadne zaznaczone zamówienie nie idzie do SpeedMail' + (selShort.length ? ' — na zaznaczone brakuje towaru' : ''),
      onclick: () => { S.dlg = { kind: 'batch', ids: selSm.map(x => x.id) }; S.rerender(); } },
      selSm.length ? ['Przekaż ' + selSm.length, el('span', { class: 'sm-send-l' }, ' do SpeedMail'), sendTail ? el('span', { class: 'sm-send-t' }, sendTail) : null] : 'Przekaż do SpeedMail'));
  const bar = el('div', { class: 'save-bar lv-bar sm-bar' + (sh.any ? ' sm-bar-warn' : '') + (open ? ' open' : ''), id: 'smBulk', role: 'region', 'aria-label': 'Akcje dla zaznaczonych zamówień' }, panel, line);
  return bar;
}

/** Krótka nazwa produktu do komórki: bez roku, „OTK” i nawiasów; „Sztandar Trzech Króli – wielki” → „Sztandar wielki”; maks. ~18 znaków. */
function shortRaw(name) {
  let s = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/(^|\s)(OTK|20\d\d)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  const dash = s.split(/\s[–-]\s/);
  if (dash.length > 1) s = dash[0].split(' ')[0] + ' ' + dash.slice(1).join(' ');
  if (s.length > 18) {
    const w = s.split(' '), out = [w[0]];
    for (const x of w.slice(1)) { if ((out.join(' ') + ' ' + x).length > 17) break; out.push(x); }
    while (out.length > 1 && out[out.length - 1].length <= 2) out.pop();   // bez „z…”, „na…” na końcu
    s = out.join(' ') + '…';
  }
  return s || String(name || '');
}
// Skróty liczone dla całej listy produktów: gdy dwa skróty wychodzą takie same („Opaska silikonowa…”), bierzemy pierwsze i ostatnie słowo („Opaska zielona”)
let shortMemo = { of: null, map: new Map() };
function shortName(name) {
  const prods = S.d ? S.d.v.cfg.products : [];
  if (shortMemo.of !== prods) {
    const raw = prods.map(p => [p.name, shortRaw(p.name)]), n = new Map();
    for (const [, r] of raw) n.set(r, (n.get(r) || 0) + 1);
    shortMemo = { of: prods, map: new Map(raw.map(([full, r]) => { const w = full.split(' '); return [full, n.get(r) > 1 && w.length > 1 ? w[0] + ' ' + w[w.length - 1] : r]; })) };
  }
  return shortMemo.map.get(name) || shortRaw(name);
}

const USE_ALL = 'osa.sm.useAll', TIGHT = 0.9, INLINE_MAX = 4, FEW = 6;
/**
 * Suma zaznaczonych wobec stanu SM, zwięźle (przy ~30 produktach jedna linia wychodziła poza ekran): w linii najpierw produkty z brakiem
 * (czerwone, z ile brakuje) i zużyte > 90 % stanu; reszta jako „+N produktów w normie” z „Pokaż wszystkie” → siatka (nazwa, użyte / stan,
 * pasek zużycia), stan rozwinięcia zapamiętany. Do 6 produktów — wszystkie w linii (zawijane), bez rozwijania.
 */
function useLine(u) {
  const items = Object.keys(u.use).map(k => {
    const p = prodOf(k) || { name: k, unit: '' }, used = u.use[k], have = u.have[k] || 0, bad = u.over.includes(k);
    const ratio = have > 0 ? used / have : (used > 0 ? Infinity : 0);
    return { k, p, used, have, bad, ratio, lvl: bad ? 'bad' : ratio > TIGHT ? 'warn' : 'ok',
      tip: p.name + ': zaznaczone potrzebują ' + nf(used) + ' ' + p.unit + ', SpeedMail ma ' + nf(have) + ' ' + p.unit + (bad ? ' — brakuje ' + nf(u.lack[k]) + ' ' + p.unit : ' (zużycie ' + Math.round(ratio * 100) + ' %)') };
  }).sort((a, b) => (b.bad - a.bad) || (b.ratio - a.ratio) || collator.compare(a.p.name, b.p.name));
  const few = items.length <= FEW, tight = items.filter(x => x.lvl !== 'ok');
  const inline = few ? items : tight.slice(0, INLINE_MAX), restTight = few ? 0 : tight.length - inline.length, restOk = few ? 0 : items.length - tight.length;
  const chip = x => el('span', { class: 'sm-use-i', 'data-key': x.k, title: x.tip }, shortName(x.p.name) + ' ',
    el('span', { class: x.bad ? 'diffbad' : x.lvl === 'warn' ? 'warn-txt' : 'ok-txt' }, nf(x.used) + ' z ' + nf(x.have) + ' ' + x.p.unit + (x.bad ? ' ✗ brakuje ' + nf(u.lack[x.k]) : '')));
  const label = el('span', { class: 'muted tip', title: 'Ile towaru potrzebują zaznaczone zamówienia, które pójdą do SpeedMail (decyzja „do SpeedMail”, także ręczna), wobec obecnego stanu SpeedMail. Zamówienia pakowane u nas nie zużywają stanu SpeedMail. Najpierw produkty, których brakuje albo zużywają ponad 90 % stanu' }, 'Razem ze stanu SpeedMail:');
  if (few) return el('div', { class: 'sm-use', id: 'smSelUse' }, label, ...inline.map(chip));

  let open = !!store(USE_ALL);
  const grid = el('div', { class: 'sm-ug', id: 'smUseGrid', hidden: !open || null }, items.map(x =>
    el('div', { class: 'sm-ug-c ' + x.lvl, 'data-key': x.k, title: x.tip },
      el('span', { class: 'sm-ug-n' }, shortName(x.p.name)),
      el('span', { class: 'sm-ug-v' }, nf(x.used) + ' / ' + nf(x.have) + (x.bad ? ' ✗' : '')),
      el('span', { class: 'sm-ug-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.min(100, Math.round((x.have > 0 ? x.ratio : 1) * 100)) + '%' })))));
  const btn = el('button', { type: 'button', class: 'link', id: 'smUseAll', 'aria-controls': 'smUseGrid', 'aria-expanded': String(open), title: 'Pokaż albo ukryj zużycie wszystkich produktów zaznaczonych zamówień (siatka; wybór zapamiętany)',
    onclick: () => { open = !open; grid.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Zwiń' : 'Pokaż wszystkie'; store(USE_ALL, open); } }, open ? 'Zwiń' : 'Pokaż wszystkie');
  const more = [restTight ? cnt(restTight, 'kolejny na styk', 'kolejne na styk', 'kolejnych na styk') : '', restOk ? (tight.length ? '+' : '') + cnt(restOk, 'produkt', 'produkty', 'produktów') + ' w normie' : ''].filter(Boolean);
  return el('div', { class: 'sm-use', id: 'smSelUse' }, label, ...inline.map(chip),
    el('span', { class: 'muted small tip sm-use-more', id: 'smUseMore', title: 'Produkty, których zaznaczone zamówienia zużywają najwyżej 90 % stanu SpeedMail — szczegóły w „Pokaż wszystkie”' },
      (tight.length ? '' : 'wszystkie mieszczą się w stanie: ') + (restTight ? '+' : '') + more.join(' · ')), btn, grid);
}

/**
 * „Towar w SM”: jeden produkt w wierszu (krótka nazwa + liczba), najpierw produkt ograniczający (brakujący, potem najbliższy wyczerpania);
 * kolor tylko na liczbie. Do 4 wierszy, potem „+N” (pełna lista w dymku). Niezaznaczone, którym zabrakło przez zaznaczenie: „brak po zaznaczeniu”.
 */
function stockCell(x) {
  const r = x.r;
  if (x.stock !== 'ok' && x.stock !== 'brak') {
    return el('span', { class: 'muted', title: x.result === 'sent' ? 'Towar tego zamówienia jest już odjęty od stanu SpeedMail' : 'Nie dotyczy — zamówienie ma produkty spoza listy SpeedMail' }, '—');
  }
  const lack = new Map((r.missing || []).map(m => [m.key, m.lack]));
  const lines = (r.have || []).map(h => ({ ...h, lack: lack.get(h.key) || 0, ratio: h.need > 0 ? h.have / h.need : Infinity }))
    .sort((a, b) => (b.lack > 0) - (a.lack > 0) || (b.lack / b.need - a.lack / a.need) || (a.ratio - b.ratio) || collator.compare(a.name, b.name));
  const opk = h => nf(Math.floor(h.have / h.pack + 1e-9));
  const val = h => (h.lack ? '✗ brak ' + nf(h.lack) + ' ' + h.unit : '✓ ' + nf(h.have) + ' ' + h.unit + (h.pack > 1 && h.have >= h.pack ? ' (' + opk(h) + ' op.)' : ''));
  const full = h => h.name + ': ' + (h.lack ? 'brakuje ' + nf(h.lack) + ' ' + h.unit + ' (SpeedMail ma ' + nf(h.have) + ')' : nf(h.have) + ' ' + h.unit) +
    (h.pack > 1 ? ' = ' + opk(h) + ' op. po ' + nf(h.pack) + (h.packName ? ' (' + h.packName + ')' : '') : '') + ', potrzeba ' + nf(h.need);
  const tip = (x.stock === 'ok' ? 'SpeedMail ma towar na całe zamówienie.' : 'SpeedMail nie ma towaru na całe zamówienie.') +
    ' Stan przed tym zamówieniem (po ' + (S.sel.size ? 'zaznaczonych i ' : '') + 'wcześniejszych):\n' + lines.map(full).join('\n') +
    (r.bySel ? '\n\nBez zaznaczenia towar by był — zabrakło go, bo zaznaczone zamówienia dostają towar pierwsze.' : '');
  const shown = lines.length > 4 ? lines.slice(0, 3) : lines, more = lines.length - shown.length;
  const line = h => el('div', { class: 'sm-ln' }, el('span', { class: 'sm-nm' }, shortName(h.name)), ' ', el('span', { class: 'sm-v ' + (h.lack ? 'diffbad' : 'ok-txt') }, val(h)));
  return el('div', { class: 'sm-have', title: tip, 'data-stock': x.stock },
    lines.length ? shown.map(line) : el('div', { class: 'sm-ln' }, el('span', { class: 'sm-v ' + (x.stock === 'ok' ? 'ok-txt' : 'diffbad') }, x.stock === 'ok' ? '✓ jest' : '✗ brak')),
    more ? el('div', { class: 'sm-ln muted small' }, '+' + more + ' ' + (more === 1 ? 'produkt' : more < 5 ? 'produkty' : 'produktów') + ' (w dymku)') : null,
    r.bySel ? el('div', { class: 'sm-ln' }, el('span', { class: 'ord-st warn sm-bysel' }, '⚠ brak po zaznaczeniu')) : null,
    !r.bySel && u.shortIds && u.shortIds.has(x.id) ? el('div', { class: 'sm-ln' }, el('span', { class: 'ord-st warn sm-bysel sm-selshort', title: x.result === 'sm' ? 'Zaznaczone ręcznie „do SpeedMail” mimo braku towaru — stan SpeedMail zejdzie poniżej zera' : 'Zaznaczone, ale towaru w SpeedMail nie starcza nawet z pierwszeństwem — przy przekazaniu zostanie u nas' },
      x.result === 'sm' ? '⚠ mimo braku' : '⚠ zaznaczone — brak towaru')) : null);
}

function rowEl(x) {
  const r = x.r, d = DEC[x.result];
  const cb = el('input', { type: 'checkbox', 'aria-label': 'Zaznacz zamówienie ' + x.num, disabled: x.result === 'sent', title: x.result === 'sent' ? 'To zamówienie jest już w paczce zleceń' : null });
  cb.checked = S.sel.has(x.id);
  cb.addEventListener('change', () => { if (cb.checked) S.sel.add(x.id); else S.sel.delete(x.id); u.dropped = 0; S.rerender(); });
  const stock = stockCell(x);
  const change = x.result === 'sent'
    ? el('a', { href: '#/speedmail/paczki?paczka=' + r.batch, title: 'Otwórz paczkę zleceń nr ' + r.batch + ' (plik, statusy, anulowanie zlecenia)' }, 'paczka ' + r.batch)
    : r.manual ? el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Usuń ręczne oznaczenie — wróć do podpowiedzi wg reguł', onclick: () => mark([x.id], '', '') }, '↺ wg reguł')
      : x.result === 'sm' ? el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Oznacz ręcznie: to zamówienie pakujemy sami (np. wysyłka pilna, inny kurier)', onclick: () => { S.dlg = { kind: 'mark', to: 'my', ids: [x.id] }; S.rerender(); } }, '→ my')
        : r.canForce ? el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Oznacz ręcznie: to zamówienie idzie do SpeedMail mimo reguł', onclick: () => { S.dlg = { kind: 'mark', to: 'sm', ids: [x.id] }; S.rerender(); } }, '→ SM')
          : el('span', { class: 'muted small tip', title: 'Tego zamówienia nie da się przekazać do SpeedMail: ma produkt spoza listy SpeedMail (albo z lokalizacją). Dopisz produkt do listy w Ustawieniach, jeśli SpeedMail go ma.' }, 'nie da się');
  const short = !!(u.shortIds && u.shortIds.has(x.id));
  return el('tr', { 'data-id': x.id, 'data-dec': x.result, 'data-code': x.code, 'data-short': short ? '1' : null, class: [S.flashIds && S.flashIds.has(x.id) ? 'live-chg' : '', short ? 'sm-row-short' : ''].filter(Boolean).join(' ') || null },
    el('td', null, cb),
    el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(x.id), title: 'Otwórz kartę zamówienia ' + x.num }, x.num),
      x.prev ? el('span', { class: 'ord-st warn', title: 'To zamówienie było już w paczce nr ' + x.prev + ', a zlecenie anulowano. Ponowne przekazanie wymaga podania powodu.' }, 'było w paczce ' + x.prev) : null),
    el('td', { class: 'nw' }, dmy(x.day)), el('td', null, x.status), el('td', null, x.delivery),
    el('td', { class: 'sm-items', title: Object.keys(r.need).length ? 'W produktach SpeedMail: ' + needText(r.need) : null }, x.items || '—',
      r.presale ? el('span', { class: 'ord-st acc', title: 'Zawiera produkty z przedsprzedaży — SpeedMail wysyła je od ' + dmy(S.d.v.cfg.dates.presaleStart) }, 'przedsprzedaż') : null),
    el('td', { class: 'sm-stock' }, stock),
    el('td', { class: 'nw' }, statusPill(d[0], d[1], d[2]), r.manual ? el('span', { class: 'ord-st warn', title: 'Decyzja oznaczona ręcznie' + ((S.d.v.marks[x.id] || {}).author ? ' przez: ' + S.d.v.marks[x.id].author : '') }, 'ręcznie') : null),
    el('td', { class: 'sm-why' }, r.rule ? el('span', { class: 'muted small tip', title: 'Numer reguły ze specyfikacji (1 forma dostawy, 2 lista produktów, 3 terminy, 4 ręcznie „my”, 5 stan SpeedMail)' }, 'reguła ' + r.rule + ' · ') : null, x.reason),
    el('td', { class: 'nw' }, change));
}

// ─── Okna potwierdzeń ───────────────────────────────────────────────────────
function dialog(v) {
  const d = S.dlg, close = () => { S.dlg = null; S.rerender(); };
  const noteIn = (ph, req) => el('input', { type: 'text', id: 'smDlgNote', maxlength: '200', placeholder: ph, 'aria-label': ph, required: req || null, style: 'width:100%' });
  const val = () => { const n = document.getElementById('smDlgNote'); return n ? n.value.trim() : ''; };
  if (d.kind === 'mark') {
    const my = d.to === 'my';
    return el('div', { class: 'card ord-dialog', id: 'smDlg', role: 'dialog', 'aria-label': 'Zmiana decyzji' },
      el('h3', null, (my ? 'Pakujemy sami: ' : 'Do SpeedMail mimo reguł: ') + cnt(d.ids.length, 'zamówienie', 'zamówienia', 'zamówień')),
      el('p', { class: 'muted small' }, my ? 'Zamówienie zostanie u nas niezależnie od reguł (np. wysyłka pilna albo klient prosi o innego kuriera niż FedEx). Powód zobaczysz w tabeli.'
        : 'Zamówienie pójdzie do SpeedMail mimo formy dostawy, terminu albo braku towaru. Zamówień z produktem spoza listy SpeedMail to nie obejmie.'),
      noteIn(my ? 'Powód, np. „pilne — DHL”' : 'Powód, np. „uzgodnione ze SpeedMail”'),
      el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'smDlgCancel', onclick: close }, 'Anuluj'),
        el('button', { type: 'button', class: 'primary', id: 'smDlgOk', onclick: () => mark(d.ids, d.to, val()) }, 'Zapisz oznaczenie')));
  }
  // paczka zleceń
  const rows = planSel(S.sel).rows.filter(r => d.ids.includes(String(r.o.orderId)));
  const again = d.ids.filter(id => v.sent[id]);
  const short = rows.filter(r => r.missing.length).length, waits = rows.filter(r => r.waits).length;
  const sum = SM.selectionUse(rows, new Set(d.ids), v.totals, v.cfg).use;
  const packs = Object.keys(sum).map(k => { const p = prodOf(k); return p.name + ': ' + nf(sum[k] / p.pack) + ' ' + (p.packName || p.unit) + (p.pack !== 1 ? ' (' + nf(sum[k]) + ' ' + p.unit + ')' : ''); });
  return el('div', { class: 'card ord-dialog', id: 'smDlg', role: 'dialog', 'aria-label': 'Przekazanie do SpeedMail' },
    el('h3', null, 'Przekazać do SpeedMail ' + cnt(d.ids.length, 'zamówienie', 'zamówienia', 'zamówień') + '?'),
    el('p', null, 'Panel zapisze paczkę zleceń — stan SpeedMail zmniejszy się o te zamówienia' + (v.use.sm ? ', a status w Selly zmieni się na „' + statusName(v.use.sm) + '” (klient może dostać powiadomienie, jeśli tak ustawiono ten status)' : '') + '. Potem pobierzesz plik Excel dla SpeedMail.'),
    el('details', { class: 'fold' }, el('summary', null, el('span', null, 'Co zawiera paczka'), el('span', { class: 'sum' }, ' — ' + packs.length + ' produktów, w opakowaniach SpeedMail')), el('ul', { class: 'small', id: 'smDlgSum' }, packs.map(t => el('li', null, t)))),
    waits ? el('p', { class: 'muted small' }, cnt(waits, 'zamówienie', 'zamówienia', 'zamówień') + ' z przedsprzedażą — SpeedMail wyśle je od ' + dmy(v.cfg.dates.presaleStart) + '.') : null,
    short ? notice('warn', 'Uwaga: ' + cnt(short, 'zamówienie przekazujesz', 'zamówienia przekazujesz', 'zamówień przekazujesz') + ' mimo braku towaru w SpeedMail (ręczne oznaczenie) — stan zejdzie poniżej zera.') : null,
    again.length ? el('div', null, notice('warn', cnt(again.length, 'zamówienie było', 'zamówienia były', 'zamówień było') + ' już w paczce zleceń (zlecenie anulowano). Żeby SpeedMail nie dostał tego samego zamówienia dwa razy przez pomyłkę, podaj powód ponownego przekazania.'),
      noteIn('Powód ponownego przekazania', true)) : null,
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', id: 'smDlgCancel', onclick: close }, 'Anuluj'),
      el('button', { type: 'button', class: 'primary', id: 'smDlgOk', disabled: jobBusy(), onclick: () => { if (again.length && !val()) { document.getElementById('smDlgNote').focus(); return; } send(d.ids, again, val()); } }, 'Przekaż i zapisz paczkę')));
}

function batchDone() {
  const b = S.lastBatch;
  return el('div', { class: 'card ord-dialog', id: 'smBatchDone', role: 'status' },
    el('h3', null, 'Paczka zleceń nr ' + b.no + ' zapisana (' + cnt(b.orders, 'zamówienie', 'zamówienia', 'zamówień') + ')'),
    el('p', { class: 'muted small' }, 'Pobierz plik i wyślij go do SpeedMail. Plik pobierzesz też później w zakładce „Paczki zleceń”.'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', id: 'smBatchClose', onclick: () => { S.lastBatch = null; S.rerender(); } }, 'Zamknij'),
      el('a', { class: 'btn-secondary', href: '#/speedmail/paczki?paczka=' + b.no }, 'Otwórz paczkę →'),
      el('button', { type: 'button', class: 'primary', id: 'smBatchFile', title: 'Tabela zleceń w stałym układzie kolumn, ilości w opakowaniach SpeedMail. Nazwa pliku: data i numer paczki.', onclick: () => downloadBatch(b.no) }, 'Pobierz plik dla SpeedMail (.xlsx)')));
}

// ─── Zapisy ─────────────────────────────────────────────────────────────────
async function mark(ids, to, note) {
  const r = await save('sm:mark', { orderIds: ids, result: to, note }, to ? 'Zapisano oznaczenie: ' + ids.length : 'Usunięto ręczne oznaczenie');
  if (!r) return;
  S.dlg = null;
  await reload('init');
}

async function send(ids, again, note) {
  const numOf = new Map(plan().rows.map(r => [String(r.o.orderId), r.o.orderNumber]));
  const p = { orderIds: ids };
  if (again.length) { p.resend = again; p.resendNote = note; }
  const r = await save('sm:batch', p);
  if (!r) { S.dlg = null; S.rerender(); return; }
  S.dlg = null; S.lastBatch = r;
  for (const id of ids) S.sel.delete(id);
  const st = S.d.v.use.sm;
  await reload('init', 'list');
  if (st) runStatus({ ids, target: st, title: 'Paczka zleceń nr ' + r.no + ' — przekazanie do SpeedMail', numOf });
}

async function keep(rows, otk) {
  const ids = rows.map(x => x.id);
  if (!confirm('Zmienić w Selly status ' + cnt(ids.length, 'zamówienia', 'zamówień', 'zamówień') + ' na „' + statusName(otk) + '”? Będą pakowane u nas i znikną z tej listy.')) return;
  const r = await save('sm:keep', { orderIds: ids });
  if (!r) return;
  for (const id of ids) S.sel.delete(id);
  runStatus({ ids, target: otk, title: 'Pakujemy sami', numOf: new Map(rows.map(x => [x.id, x.num])) });
}

/** „Szczegóły” braków: dla każdego zamówienia — których produktów brakuje, ile, ile SM ma i ile potrzeba. */
function shortDetails(selShort, bySelRows, forced) {
  const line = x => {
    const have = new Map((x.r.have || []).map(h => [h.key, h]));
    const miss = (x.r.missing || []).map(m => {
      const h = have.get(m.key);
      return m.name + ': brakuje ' + nf(m.lack) + ' ' + m.unit + (h ? ' (SpeedMail ma ' + nf(h.have) + ', potrzeba ' + nf(h.need) + ')' : '');
    });
    return el('li', null, el('a', { href: '#/zamowienia/' + x.id, title: 'Otwórz kartę zamówienia' }, x.num), ' — ', miss.join('; ') || 'brak szczegółów');
  };
  const block = (title, rows) => rows.length ? [el('div', { class: 'sm-det-h' }, title + ' (' + rows.length + ')'), el('ul', { class: 'sm-det' }, rows.slice(0, 50).map(line)),
    rows.length > 50 ? el('div', { class: 'muted small' }, '… i ' + (rows.length - 50) + ' więcej') : null] : null;
  const d = el('details', { class: 'sm-sel-det', id: 'smSelDetails', open: u.detClosed ? null : true },
    el('summary', { title: 'Pokaż, których produktów brakuje i ile — dla każdego zamówienia' }, 'Szczegóły braków'),
    block('Zaznaczone, które zostają u nas z braku towaru', selShort), block('Zaznaczone ręcznie „do SpeedMail” mimo braku', forced || []), block('Inne zamówienia, którym zabraknie przez zaznaczenie', bySelRows));
  d.addEventListener('toggle', () => { u.detClosed = !d.open; });
  return d;
}
