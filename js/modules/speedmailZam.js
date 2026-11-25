// „Wysyłka SpeedMail” → zakładka Zamówienia: tabela wszystkich otwartych zamówień z podpowiedzią „SpeedMail / pakujemy sami” i powodem
// (reguły 1–5 specyfikacji). Sortowanie po każdej kolumnie, filtry i wyszukiwanie zapisane w adresie, zaznaczanie zbiorcze, ręczna zmiana
// decyzji w obie strony, przekazanie paczki zleceń (sm:batch) + status w Selly, „zostają u nas” (sm:keep + status „Złożone OTK”).
import { el, cnt, norm, sortTh, pager, multiSelect, filterLayout, filterSection, dateRange, statusPill, menuButton } from '../core/ui.js?v=6d8ea70';
import { go } from '../core/router.js?v=6d8ea70';
import { S, SM, WRITE, STATUS_WRITE, plan, nf, dmy, notice, statusName, prodOf, needText, liveCtl, save, reload, runStatus, jobBusy, downloadBatch } from './speedmailKit.js?v=6d8ea70';

const KEYS = ['dec', 'reason', 'status', 'delivery', 'from', 'to', 'product', 'stock', 'pre', 'q'];
const SORTS = ['num', 'date', 'status', 'delivery', 'items', 'stock', 'dec', 'reason'];
const PAGE = 100;
const DEC = { sm: ['do SpeedMail', 'ok', 'SpeedMail pakuje to zamówienie w całości'], my: ['pakujemy sami', 'neutral', 'Zamówienie zostaje u nas — pakujemy je w całości sami'], sent: ['przekazane', 'acc', 'Zamówienie jest już w paczce zleceń przekazanej do SpeedMail'] };
const DEC_ORDER = { sm: 0, my: 1, sent: 2 }, STOCK_ORDER = { ok: 0, brak: 1, '': 2 };
const set = csv => new Set(String(csv || '').split(',').filter(Boolean));

function readQ(q) {
  const g = k => q.get(k) || '', sort = SORTS.includes(g('sort')) ? g('sort') : 'date';
  return { ...Object.fromEntries(KEYS.map(k => [k, g(k)])), sort, dir: g('dir') === 'desc' ? 'desc' : 'asc', page: Math.max(1, parseInt(g('page'), 10) || 1) };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  for (const k of KEYS) if (Q[k]) p.set(k, Q[k]);
  if (Q.sort !== 'date' || Q.dir !== 'asc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  if (Q.page > 1) p.set('page', String(Q.page));
  const s = p.toString();
  return s ? '?' + s : '';
}
/** Zmiana filtrów / sortowania = nowy adres (da się go skopiować, dodać do zakładek, cofnąć). */
function setQ(patch, replace) {
  const Q = { ...readQ(S.query), page: 1, ...patch };
  go('/speedmail/zamowienia' + qsOf(Q), replace ? { replace: true } : undefined);
}
const activeFilters = Q => KEYS.filter(k => Q[k]).length;

/** Wiersze widoku z wierszy decyzji. */
function rowsOf() {
  const v = S.d.v;
  return plan().rows.map(r => {
    const id = String(r.o.orderId), prev = v.sent[id] && v.sent[id].cancelled ? v.sent[id].no : 0;
    return { r, id, num: r.o.orderNumber, day: String(r.o.date || '').slice(0, 10), statusId: r.o.statusId, status: statusName(r.o.statusId), delivery: r.o.delivery || '—',
      items: r.o.items.filter(i => i.qty > 0).map(i => i.name + ' × ' + nf(i.qty)).join(', '), result: r.result, code: r.code, reason: r.reason, stock: r.stock, presale: r.presale, prev };
  });
}
function match(x, Q, f) {
  if (f.dec.size && !f.dec.has(x.result)) return false;
  if (f.reason.size && !f.reason.has(x.code)) return false;
  if (f.status.size && !f.status.has(String(x.statusId))) return false;
  if (f.delivery.size && !f.delivery.has(x.delivery)) return false;
  if (Q.from && x.day < Q.from) return false;
  if (Q.to && x.day > Q.to) return false;
  if (f.product.size && ![...f.product].some(k => x.r.need[k])) return false;
  if (Q.stock && x.stock !== Q.stock) return false;
  if (Q.pre && (Q.pre === '1') !== !!x.presale) return false;
  if (f.q && !norm(x.num).includes(f.q)) return false;
  return true;
}
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
const SORT_VAL = { num: x => x.num, date: x => x.r.o.date, status: x => x.status, delivery: x => x.delivery, items: x => x.items, stock: x => STOCK_ORDER[x.stock], dec: x => DEC_ORDER[x.result], reason: x => x.reason };
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
  const v = S.d.v, Q = readQ(S.query), all = rowsOf();
  const f = { dec: set(Q.dec), reason: set(Q.reason), status: set(Q.status), delivery: set(Q.delivery), product: set(Q.product), q: norm(Q.q) };
  const shown = sortRows(all.filter(x => match(x, Q, f)), Q);
  const live = new Set(all.filter(x => x.result !== 'sent').map(x => x.id));
  for (const id of [...S.sel]) if (!live.has(id)) S.sel.delete(id);

  // filtry: wartości z adresu + listy z liczbą zamówień
  if (u.search.value.trim() !== Q.q) u.search.value = Q.q;
  u.dec.value = Q.dec; u.stock.value = Q.stock; u.pre.value = Q.pre;
  if (u.range.from.value !== Q.from) u.range.from.value = Q.from;
  if (u.range.to.value !== Q.to) u.range.to.value = Q.to;
  u.reason.set(opts(countBy(all, x => x.code), k => SM.REASONS[k].label), Q.reason);
  u.status.set(opts(countBy(all, x => String(x.statusId)), statusName), Q.status);
  u.delivery.set(opts(countBy(all, x => x.delivery), k => k), Q.delivery);
  const prodN = new Map();
  for (const x of all) for (const k in x.r.need) prodN.set(k, (prodN.get(k) || 0) + 1);
  u.product.set(opts(prodN, k => (prodOf(k) || { name: k }).name), Q.product);
  const nf2 = activeFilters(Q);
  u.filtersBtn.textContent = (u.layout.isOpen() ? 'Ukryj filtry' : 'Filtry') + (nf2 ? ' (' + nf2 + ')' : '');
  u.filtersBtn.setAttribute('aria-expanded', String(u.layout.isOpen()));
  u.clear.hidden = !nf2;

  const nDec = countBy(all, x => x.result);
  const seg = (key, label, tip) => el('button', { type: 'button', class: 'chip', id: 'smSeg' + (key || 'All'), 'aria-pressed': String(Q.dec === key), title: tip, onclick: () => setQ({ dec: key }) },
    label, el('span', { class: 'ord-n' }, String(key ? nDec.get(key) || 0 : all.length)));
  u.segs.replaceChildren(
    seg('', 'Wszystkie', 'Wszystkie zamówienia w statusach: ' + (v.use.open.concat(v.use.sm ? [v.use.sm] : []).map(statusName).join(', ') || '—') + '. Statusy zmienisz w Ustawieniach.'),
    seg('sm', 'Do SpeedMail', 'Zamówienia, które wg reguł (albo ręcznego oznaczenia) pakuje SpeedMail i na które SpeedMail ma towar'),
    seg('my', 'Pakujemy sami', 'Zamówienia, które zostają u nas — powód w kolumnie „Dlaczego”'),
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
  if (S.lastBatch) out.push(batchDone());
  if (S.dlg && (S.dlg.kind === 'mark' || S.dlg.kind === 'batch')) out.push(dialog(v));
  return out;
}

function results(v, Q, all, shown) {
  const pages = Math.max(1, Math.ceil(shown.length / PAGE)), page = Math.min(Q.page, pages);
  const visible = shown.slice((page - 1) * PAGE, page * PAGE);
  const byId = new Map(all.map(x => [x.id, x]));
  const selRows = [...S.sel].map(id => byId.get(id)).filter(Boolean);
  const selSm = selRows.filter(x => x.result === 'sm'), selMy = selRows.filter(x => x.result === 'my');
  const pickable = x => x.result !== 'sent';
  const toggle = (ids, on) => { for (const id of ids) { if (on) S.sel.add(id); else S.sel.delete(id); } S.rerender(); };

  const allCb = el('input', { type: 'checkbox', id: 'smSelPage', 'aria-label': 'Zaznacz wszystkie zamówienia widoczne na tej stronie', title: 'Zaznacz albo odznacz wszystkie zamówienia widoczne na tej stronie' });
  const pageIds = visible.filter(pickable).map(x => x.id);
  allCb.checked = pageIds.length > 0 && pageIds.every(id => S.sel.has(id));
  allCb.addEventListener('change', () => toggle(pageIds, allCb.checked));
  const cols = [
    { label: 'Zamówienie', sort: 'num', tip: 'Numer zamówienia w Selly — klik otwiera kartę zamówienia' },
    { label: 'Data', sort: 'date', tip: 'Data złożenia zamówienia (od niej zależy reguła terminów)', firstDir: 'asc' },
    { label: 'Status', sort: 'status', tip: 'Obecny status zamówienia w Selly' },
    { label: 'Dostawa', sort: 'delivery', tip: 'Forma dostawy z zamówienia. Do SpeedMail idą tylko: ' + (v.cfg.couriers.join(', ') || '—') + ' (zmienisz w Ustawieniach)', tipHeader: true },
    { label: 'Produkty', sort: 'items', tip: 'Pozycje zamówienia. Najedź na komórkę, aby zobaczyć je przeliczone na produkty SpeedMail (zestawy rozbite na składniki)', tipHeader: true },
    { label: 'Towar w SM', sort: 'stock', tip: 'Czy SpeedMail ma towar na CAŁE zamówienie. Panel przydziela towar od najstarszych zamówień, a wcześniej przekazane już go zmniejszyły', tipHeader: true },
    { label: 'Kto pakuje', sort: 'dec', tip: 'Podpowiedź panelu: SpeedMail albo my. Zamówienia nie dzielimy — pakuje je w całości jedna strona. Decyzję możesz zmienić w ostatniej kolumnie', tipHeader: true },
    { label: 'Dlaczego', sort: 'reason', tip: 'Powód decyzji: która reguła zdecydowała (forma dostawy, lista produktów, terminy, ręczne oznaczenie, stan SpeedMail)', tipHeader: true },
  ];
  const head = el('tr', null, el('th', null, allCb), ...cols.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir, page: 1 }))), el('th', null, el('span', { class: 'tip', title: 'Ręczna zmiana decyzji dla jednego zamówienia (z powodem, który zostaje w tabeli)' }, 'Zmień')));
  const body = el('tbody', null, visible.length ? visible.map(x => rowEl(x)) : el('tr', null, el('td', { colspan: '10', class: 'empty' },
    all.length ? 'Żadne zamówienie nie pasuje do filtrów. ' : 'Brak otwartych zamówień w wybranych statusach.', all.length ? el('button', { type: 'button', class: 'link', onclick: () => setQ(Object.fromEntries(KEYS.map(k => [k, '']))) }, 'Wyczyść filtry') : null)));

  const smAll = shown.filter(x => x.result === 'sm').map(x => x.id), myAll = shown.filter(x => x.result === 'my').map(x => x.id);
  const use = SM.selectionUse(selSm.map(x => x.r), new Set(selSm.map(x => x.id)), v.totals, v.cfg);
  const cfgSt = v.use;
  const bar = el('div', { class: 'sm-bulk', id: 'smBulk' },
    el('div', { class: 'toolbar', style: 'margin-top:0' },
      el('button', { type: 'button', class: 'secondary', id: 'smPickSm', disabled: !smAll.length, title: 'Zaznacza wszystkie zamówienia z decyzją „do SpeedMail” pasujące do filtrów (na wszystkich stronach); pozostałe odznacza',
        onclick: () => { S.sel = new Set(smAll); S.rerender(); } }, 'Zaznacz do SpeedMail (' + smAll.length + ')'),
      el('button', { type: 'button', class: 'secondary', id: 'smPickMy', disabled: !myAll.length, title: 'Zaznacza wszystkie zamówienia z decyzją „pakujemy sami” pasujące do filtrów (na wszystkich stronach); pozostałe odznacza',
        onclick: () => { S.sel = new Set(myAll); S.rerender(); } }, 'Zaznacz „pakujemy sami” (' + myAll.length + ')'),
      el('button', { type: 'button', class: 'secondary', id: 'smPickNone', disabled: !S.sel.size, onclick: () => { S.sel.clear(); S.rerender(); } }, 'Odznacz wszystkie'),
      el('span', { class: 'spacer' }),
      el('span', { class: 'muted small', id: 'smShown', title: 'Ile zamówień pasuje do filtrów / ile jest wszystkich' }, 'Pokazano ' + shown.length + ' z ' + all.length)),
    el('div', { class: 'sm-sel', id: 'smSelSum', role: 'status' }, S.sel.size
      ? ['Zaznaczono ', el('strong', null, cnt(selRows.length, 'zamówienie', 'zamówienia', 'zamówień')), ': do SpeedMail ', el('strong', null, String(selSm.length)), ' · pakujemy sami ', el('strong', null, String(selMy.length)),
        selSm.length ? el('span', { class: 'muted' }, ' · razem do SpeedMail: ' + needText(use.use)) : null]
      : el('span', { class: 'muted' }, 'Zaznacz zamówienia, aby przekazać je do SpeedMail albo oznaczyć jako pakowane u nas.')),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', id: 'smKeep', write: STATUS_WRITE, disabled: !selMy.length || !cfgSt.otk || jobBusy(),
        title: cfgSt.otk ? 'Zapisuje decyzję „pakujemy sami” i zmienia w Selly status na „' + statusName(cfgSt.otk) + '” — zamówienia znikną z tej listy' : 'Wybierz w Ustawieniach status dla zamówień pakowanych u nas (np. „Złożone OTK”)',
        onclick: () => keep(selMy, cfgSt.otk) }, 'Zostają u nas → „' + (cfgSt.otk ? statusName(cfgSt.otk) : 'Złożone OTK') + '”' + (selMy.length ? ' (' + selMy.length + ')' : '')),
      menuButton({ id: 'smMarkMenu', label: 'Zmień decyzję', cls: 'secondary', write: WRITE, disabled: !S.sel.size || jobBusy(), title: 'Ręczna zmiana decyzji dla zaznaczonych zamówień — w obie strony, z powodem',
        items: () => [
          { label: 'Pakujemy sami (np. wysyłka pilna, inny kurier)…', title: 'Zaznaczone zamówienia zostają u nas niezależnie od reguł', run: () => { S.dlg = { kind: 'mark', to: 'my', ids: [...S.sel] }; S.rerender(); } },
          { label: 'Do SpeedMail mimo reguł…', title: 'Zaznaczone zamówienia idą do SpeedMail mimo formy dostawy, terminu albo braku towaru. Nie działa dla produktów spoza listy SpeedMail', run: () => { S.dlg = { kind: 'mark', to: 'sm', ids: [...S.sel] }; S.rerender(); } },
          { label: 'Usuń ręczne oznaczenie', title: 'Wraca do podpowiedzi wg reguł', run: () => mark([...S.sel], '', '') }] }),
      el('button', { type: 'button', class: 'primary', id: 'smSend', write: WRITE, disabled: !selSm.length || jobBusy(),
        title: 'Zapisuje paczkę zleceń (stan SpeedMail zmniejsza się o te zamówienia)' + (cfgSt.sm ? ' i zmienia w Selly status na „' + statusName(cfgSt.sm) + '”' : '') + '. Potem pobierzesz plik Excel dla SpeedMail.',
        onclick: () => { S.dlg = { kind: 'batch', ids: selSm.map(x => x.id) }; S.rerender(); } }, 'Przekaż do SpeedMail' + (selSm.length ? ' (' + selSm.length + ')' : ''))));

  return [bar,
    el('div', { class: 'table-wrap' }, el('table', { id: 'smTable', class: 'sm-table' }, el('thead', null, head), body)),
    pages > 1 ? pager({ prefix: 'sm', page, pages, total: shown.length, noun: ['zamówienie', 'zamówienia', 'zamówień'], onPage: p => setQ({ page: p }) }) : null,
    el('p', { class: 'muted small' }, 'Reguła 4 (wysyłka pilna, prośba o innego kuriera niż FedEx) nie ma jeszcze źródła danych w zamówieniu — takie zamówienia oznacz ręcznie: „Zmień” → „pakujemy sami”.')];
}

function rowEl(x) {
  const r = x.r, d = DEC[x.result];
  const cb = el('input', { type: 'checkbox', 'aria-label': 'Zaznacz zamówienie ' + x.num, disabled: x.result === 'sent', title: x.result === 'sent' ? 'To zamówienie jest już w paczce zleceń' : null });
  cb.checked = S.sel.has(x.id);
  cb.addEventListener('change', () => { if (cb.checked) S.sel.add(x.id); else S.sel.delete(x.id); S.rerender(); });
  // „jest” / „brak” z liczbami: ile SM ma (przed tym zamówieniem) albo ile brakuje — pierwsze 2 produkty w komórce, wszystkie w dymku
  const have = r.have || [];
  const packs = h => (h.pack > 1 ? nf(Math.round(h.have / h.pack * 10) / 10) + ' op.' : '');
  const haveTxt = h => h.name + ': ' + nf(h.have) + ' ' + h.unit + (h.pack > 1 ? ' (' + packs(h) + ' po ' + nf(h.pack) + (h.packName ? ', ' + h.packName : '') + ')' : '') + ', potrzeba ' + nf(h.need);
  const lackTxt = m => m.name + ' ' + nf(m.lack) + ' ' + m.unit;
  const brief = (list, f) => list.slice(0, 2).map(f).join(' · ') + (list.length > 2 ? ' · +' + (list.length - 2) : '');
  const stock = x.stock === 'ok' ? el('span', { class: 'ok-txt sm-qty', title: 'SpeedMail ma towar na całe zamówienie. Stan przed tym zamówieniem (po wcześniejszych):\n' + have.map(haveTxt).join('\n') },
      '✓ ' + (have.length ? brief(have, h => nf(h.have) + ' ' + h.unit + (packs(h) ? ' (' + packs(h) + ')' : '')) : 'jest'))
    : x.stock === 'brak' ? el('span', { class: 'diffbad sm-qty', title: 'Brakuje:\n' + r.missing.map(lackTxt).join('\n') + (have.length ? '\n\nSpeedMail ma:\n' + have.map(haveTxt).join('\n') : '') },
      '✗ brak ' + brief(r.missing, m => nf(m.lack) + ' ' + m.unit))
      : el('span', { class: 'muted', title: x.result === 'sent' ? 'Towar tego zamówienia jest już odjęty od stanu SpeedMail' : 'Nie dotyczy — zamówienie ma produkty spoza listy SpeedMail' }, '—');
  const change = x.result === 'sent'
    ? el('a', { href: '#/speedmail/paczki?paczka=' + r.batch, title: 'Otwórz paczkę zleceń nr ' + r.batch + ' (plik, statusy, anulowanie zlecenia)' }, 'paczka ' + r.batch)
    : r.manual ? el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Usuń ręczne oznaczenie — wróć do podpowiedzi wg reguł', onclick: () => mark([x.id], '', '') }, '↺ wg reguł')
      : x.result === 'sm' ? el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Oznacz ręcznie: to zamówienie pakujemy sami (np. wysyłka pilna, inny kurier)', onclick: () => { S.dlg = { kind: 'mark', to: 'my', ids: [x.id] }; S.rerender(); } }, '→ my')
        : r.canForce ? el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Oznacz ręcznie: to zamówienie idzie do SpeedMail mimo reguł', onclick: () => { S.dlg = { kind: 'mark', to: 'sm', ids: [x.id] }; S.rerender(); } }, '→ SM')
          : el('span', { class: 'muted small tip', title: 'Tego zamówienia nie da się przekazać do SpeedMail: ma produkt spoza listy SpeedMail (albo z lokalizacją). Dopisz produkt do listy w Ustawieniach, jeśli SpeedMail go ma.' }, 'nie da się');
  return el('tr', { 'data-id': x.id, 'data-dec': x.result, 'data-code': x.code, class: S.flashIds && S.flashIds.has(x.id) ? 'live-chg' : null },
    el('td', null, cb),
    el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(x.id), title: 'Otwórz kartę zamówienia ' + x.num }, x.num),
      x.prev ? el('span', { class: 'ord-st warn', title: 'To zamówienie było już w paczce nr ' + x.prev + ', a zlecenie anulowano. Ponowne przekazanie wymaga podania powodu.' }, 'było w paczce ' + x.prev) : null),
    el('td', { class: 'nw' }, dmy(x.day)), el('td', null, x.status), el('td', null, x.delivery),
    el('td', { class: 'sm-items', title: Object.keys(r.need).length ? 'W produktach SpeedMail: ' + needText(r.need) : null }, x.items || '—',
      r.presale ? el('span', { class: 'ord-st acc', title: 'Zawiera produkty z przedsprzedaży — SpeedMail wysyła je od ' + dmy(S.d.v.cfg.dates.presaleStart) }, 'przedsprzedaż') : null),
    el('td', { class: 'nw' }, stock),
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
  const rows = plan().rows.filter(r => d.ids.includes(String(r.o.orderId)));
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
      el('button', { type: 'button', class: 'secondary', onclick: () => { S.lastBatch = null; S.rerender(); } }, 'Zamknij'),
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
