// Raporty sprzedaży (zastępują ekran Selly „Raporty sprzedaży”): sprzedaż w czasie, produkty, kategorie, producenci, statusy, płatności, dostawy,
// województwa, klienci nowi i powracający — z porównaniem do poprzedniego okresu. Dane z D1 (akcja reports:sales, wynik w cache 5 min).
import { el, store, money, cnt, isUnavailable, loadingBox, syncedLabel, sortTh, downloadMenuButton, dateRange, pageToolbar, isoDate, sellyLink } from '../core/ui.js?v=7182c5b';
import { api, ctx } from '../core/client.js?v=7182c5b';
import { wojLabel } from '../core/osa.js?v=7182c5b';
import { shortcuts } from '../core/shortcuts.js?v=7182c5b';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c);
  return n;
};
const zl = v => money(v) + ' zł';
const zl0 = v => Math.round(Number(v) || 0).toLocaleString('pl-PL') + ' zł';
const int = v => Math.round(Number(v) || 0).toLocaleString('pl-PL');
const qty = v => (Number(v) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 });
const ddmm = d => d.slice(8, 10) + '.' + d.slice(5, 7);
const dmy = d => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);
const STORE_KEY = 'osa-raporty';

const S = { root: null, body: null, from: '', to: '', compare: true, group: 'auto', statusIds: null, tab: 'series', metric: 'value', sort: {}, data: null, seq: 0, timer: 0 };

const GROUPS = [['auto', 'Automatycznie', 'Dni dla krótkich zakresów, tygodnie dla średnich, miesiące dla długich'], ['day', 'Dni', 'Jedna pozycja na dzień'], ['week', 'Tygodnie', 'Tygodnie od poniedziałku'], ['month', 'Miesiące', 'Miesiące kalendarzowe']];
const METRICS = [['value', 'Wartość', 'Suma wartości zamówień (pozycje + dostawa, brutto)'], ['orders', 'Zamówienia', 'Liczba zamówień'], ['avg', 'Średni koszyk', 'Wartość zamówień podzielona przez ich liczbę']];

function bucketLabel(key, group) {
  if (group === 'month') return key.slice(5, 7) + '.' + key.slice(0, 4);
  if (group === 'week') return ddmm(key) + '–' + ddmm(new Date(new Date(key + 'T12:00:00Z').getTime() + 6 * 86400e3).toISOString().slice(0, 10));
  return ddmm(key);
}

/** Opis liczonych statusów — nazwy zależne od ustawień (domyślnie: wszystkie poza anulowanymi). */
function statusSummary(d) {
  const sel = d.statuses.filter(s => s.selected), nonCancelled = d.statuses.filter(s => !s.cancelled);
  const isDefault = sel.length === nonCancelled.length && sel.every(s => !s.cancelled);
  if (isDefault) return { short: 'bez anulowanych', long: 'Liczone są zamówienia we wszystkich statusach poza anulowanymi.' };
  if (sel.length <= 3) return { short: 'statusy: ' + sel.map(s => s.name).join(', '), long: 'Liczone statusy: ' + sel.map(s => s.name).join(', ') + '.' };
  return { short: 'wybrane statusy (' + sel.length + ')', long: 'Liczone statusy (' + sel.length + '): ' + sel.map(s => s.name).join(', ') + '.' };
}

function trend(cur, prev, what, d) {
  if (!d.range.compare) return null;
  const tip = 'Poprzedni okres: ' + dmy(d.range.prevFrom) + ' – ' + dmy(d.range.prevTo) + ' (tyle samo dni). ' + what + ': ' + prev + ' → ' + cur + '.';
  if (!prev) return el('span', { class: 'rp-trend flat tip', title: 'Brak sprzedaży w poprzednim okresie — nie ma z czym porównać. ' + tip }, 'brak porównania');
  const pct = Math.round((cur - prev) / prev * 1000) / 10;
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return el('span', { class: 'rp-trend tip ' + cls, title: tip }, (pct > 0 ? '▲ +' : pct < 0 ? '▼ ' : '● ') + String(pct).replace('.', ',') + '% vs poprzedni okres');
}

function tiles(d) {
  const c = d.summary.cur, p = d.summary.prev, ss = statusSummary(d);
  const t = (k, label, main, tip, tr) => el('div', { class: 'rp-tile', 'data-k': k }, el('div', { class: 'rp-tile-label tip', title: tip }, label), el('div', { class: 'rp-big' }, main), tr);
  return el('div', { class: 'rp-tiles', id: 'rpKpi' },
    t('value', 'Sprzedaż', zl0(c.value), 'Suma wartości zamówień w okresie (pozycje + dostawa, brutto). ' + ss.long, p ? trend(c.value, p.value, 'wartość', d) : null),
    t('orders', 'Zamówienia', int(c.orders), 'Liczba zamówień złożonych w okresie. ' + ss.long, p ? trend(c.orders, p.orders, 'zamówienia', d) : null),
    t('avg', 'Średni koszyk', zl(c.avg), 'Wartość sprzedaży podzielona przez liczbę zamówień.', p ? trend(c.avg, p.avg, 'średni koszyk', d) : null),
    t('customers', 'Klienci', int(c.customers), 'Liczba różnych klientów (adresów e-mail), którzy złożyli zamówienia w okresie.', null),
    t('units', 'Sprzedane sztuki', qty(c.units), 'Suma ilości produktów we wszystkich liczonych zamówieniach okresu.', null));
}

// ─── Wykres ─────────────────────────────────────────────────────────────────

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function chart(d, metric) {
  const W = 760, H = 260, L = 58, R = 10, T = 10, B = 30, iw = W - L - R, ih = H - T - B;
  const valOf = (s, prev) => (metric === 'orders' ? (prev ? s.prevOrders : s.orders) : metric === 'avg' ? (prev ? (s.prevOrders ? s.prevValue / s.prevOrders : 0) : s.avg) : (prev ? s.prevValue : s.value));
  const cmp = d.range.compare;
  const vals = d.series.map(s => valOf(s)), pv = d.series.map(s => valOf(s, true));
  const max = niceMax(Math.max(...vals, ...(cmp ? pv : []), 0));
  const fmt = metric === 'orders' ? v => String(Math.round(v)) : zl0;
  const label = METRICS.find(m => m[0] === metric)[1];
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rp-svg', role: 'img', 'aria-label': 'Wykres: ' + label + ' w okresie ' + dmy(d.range.from) + ' – ' + dmy(d.range.to) + (cmp ? ', z porównaniem do poprzedniego okresu' : '') + '. Te same dane są w tabeli „Sprzedaż w czasie”.' });
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - ih * i / 4;
    s.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'rp-grid' }), svg('text', { x: L - 6, y: y + 4, class: 'rp-axis', 'text-anchor': 'end' }, fmt(max * i / 4)));
  }
  const n = d.series.length, bw = iw / n, tip = el('div', { class: 'rp-tip', hidden: true });
  const wrap = el('div', { class: 'rp-chart-wrap', id: 'rpChart' }, s, tip);
  const every = Math.max(1, Math.ceil(n / 12));
  const pts = [];
  d.series.forEach((x, i) => {
    const v = vals[i], h = max ? ih * v / max : 0, bx = L + i * bw;
    const g = svg('g', { class: 'rp-barg', 'data-key': x.key });
    g.append(svg('rect', { x: bx, y: T, width: bw, height: ih, class: 'rp-hit' }),
      svg('rect', { x: bx + bw * 0.14, y: T + ih - h, width: Math.max(bw * 0.72, 1), height: Math.max(h, v > 0 ? 1.5 : 0), rx: Math.min(3, bw * 0.2), class: 'rp-bar' + (v ? '' : ' zero') }));
    const show = () => {
      tip.replaceChildren(el('strong', null, bucketLabel(x.key, d.range.group) + (d.range.group === 'day' ? '.' + x.key.slice(0, 4) : '')),
        el('div', null, int(x.orders) + ' zam. · ' + zl(x.value)), el('div', null, 'średni koszyk: ' + zl(x.avg)),
        cmp ? el('div', { class: 'muted' }, 'poprzednio (' + bucketLabel(x.prevKey, d.range.group) + '): ' + int(x.prevOrders) + ' zam. · ' + zl(x.prevValue)) : null);
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((bx + bw / 2) / W * 100, 14), 86) + '%';
    };
    g.addEventListener('mouseenter', show); g.addEventListener('focus', show);
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
    s.append(g);
    pts.push((bx + bw / 2).toFixed(1) + ',' + (T + ih - (max ? ih * pv[i] / max : 0)).toFixed(1));
    if (i % every === 0) s.append(svg('text', { x: bx + bw / 2, y: H - 9, class: 'rp-axis', 'text-anchor': 'middle' }, bucketLabel(x.key, d.range.group)));
  });
  if (cmp && n > 1) s.append(svg('polyline', { points: pts.join(' '), class: 'rp-prev' }));
  return wrap;
}

function chartCard(d) {
  const body = el('div', { id: 'rpChartBody' });
  const draw = () => body.replaceChildren(chart(d, S.metric));
  const segs = el('div', { class: 'rp-segs', role: 'group', 'aria-label': 'Co pokazać na wykresie' });
  for (const [k, label, tip] of METRICS) segs.append(el('button', { type: 'button', class: 'rp-seg', 'data-metric': k, 'aria-pressed': String(S.metric === k), title: tip,
    onclick: () => { S.metric = k; for (const b of segs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.metric === k)); draw(); } }, label));
  draw();
  const legend = el('div', { class: 'rp-legend muted' }, el('span', null, el('i', { class: 'rp-sw cur' }), 'ten okres'),
    d.range.compare ? el('span', { class: 'tip', title: 'Linia przerywana: poprzedni okres o tej samej długości, nałożony na ten sam układ dni / tygodni / miesięcy' }, el('i', { class: 'rp-sw prev' }), 'poprzedni okres') : null);
  return el('section', { class: 'card rp-card' }, el('div', { class: 'rp-head' }, el('h2', null, 'Sprzedaż w czasie'), segs), body, legend);
}

// ─── Tabele ─────────────────────────────────────────────────────────────────

/** Definicje zakładek: kolumny (klucz, nagłówek, tooltip, typ) i wiersze z odpowiedzi serwera. */
function tabs(d) {
  const g = d.range.group;
  const valueCol = { key: 'value', label: 'Wartość', num: true, tip: 'Suma wartości zamówień (pozycje + dostawa, brutto)', fmt: zl, bar: true, type: 'number' };
  const ordersCol = { key: 'orders', label: 'Zamówienia', num: true, tip: 'Liczba zamówień', fmt: int, type: 'number' };
  const avgCol = { key: 'avg', label: 'Średni koszyk', num: true, tip: 'Wartość podzielona przez liczbę zamówień', fmt: zl, type: 'number' };
  const nameCol = (label, tip) => ({ key: 'name', label, tip: tip || label, text: true, type: 'text' });
  const prodCols = [{ key: 'qty', label: 'Sztuki', num: true, tip: 'Suma ilości sprzedanych sztuk w okresie', fmt: qty, type: 'number' }, { key: 'orders', label: 'Zamówienia', num: true, tip: 'W ilu zamówieniach wystąpił produkt', fmt: int, type: 'number' },
    { ...valueCol, tip: 'Suma wartości pozycji produktu (bez dostawy)' }];
  return {
    series: { label: 'Sprzedaż w czasie', tip: 'Wartość, liczba zamówień i średni koszyk w kolejnych ' + (g === 'month' ? 'miesiącach' : g === 'week' ? 'tygodniach' : 'dniach'),
      cols: [{ key: 'label', label: g === 'month' ? 'Miesiąc' : g === 'week' ? 'Tydzień (pon.–niedz.)' : 'Dzień', tip: 'Okres', text: true, type: 'text' }, ordersCol, valueCol, avgCol,
        ...(d.range.compare ? [{ key: 'prevValue', label: 'Poprzednio (wartość)', num: true, tip: 'Wartość w odpowiadającym okresie wcześniejszego zakresu', fmt: zl, type: 'number' },
          { key: 'delta', label: 'Zmiana', num: true, tip: 'Zmiana wartości względem odpowiadającego okresu poprzedniego zakresu', fmt: v => (v == null ? '—' : (v > 0 ? '+' : '') + String(v).replace('.', ',') + '%'), type: 'text' }] : [])],
      rows: d.series.map(s => ({ ...s, label: bucketLabel(s.key, g), delta: s.prevValue ? Math.round((s.value - s.prevValue) / s.prevValue * 1000) / 10 : null })), first: { sort: 'key', dir: 'asc' } },
    products: { label: 'Produkty', tip: 'Najlepiej sprzedające się produkty w okresie' + (d.productsTotal > d.products.length ? ' (pokazano ' + d.products.length + ' z ' + d.productsTotal + ')' : ''),
      cols: [{ ...nameCol('Produkt'), link: r => (r.id ? '#/produkty/' + encodeURIComponent(r.id) : null) }, { key: 'code', label: 'Kod', tip: 'Kod producenta', text: true, type: 'text' }, ...prodCols], rows: d.products },
    categories: { label: 'Kategorie', tip: 'Sprzedaż wg kategorii produktu (kategoria główna z karty produktu)', cols: [nameCol('Kategoria'), { key: 'products', label: 'Produkty', num: true, tip: 'Ile różnych produktów z tej kategorii sprzedano', fmt: int, type: 'number' }, ...prodCols.slice(0, 1), valueCol], rows: d.categories },
    producers: { label: 'Producenci', tip: 'Sprzedaż wg producenta produktu', cols: [nameCol('Producent'), { key: 'products', label: 'Produkty', num: true, tip: 'Ile różnych produktów tego producenta sprzedano', fmt: int, type: 'number' }, ...prodCols.slice(0, 1), valueCol], rows: d.producers },
    statuses: { label: 'Statusy', tip: 'Wszystkie zamówienia okresu wg statusu — także te, których nie liczą kafelki (kolumna „Liczone”)',
      cols: [{ ...nameCol('Status'), link: r => '#/zamowienia?status=' + encodeURIComponent(r.id) }, { key: 'counted', label: 'Liczone', tip: 'Czy zamówienia w tym statusie wchodzą do sum powyżej (wg ustawienia „Liczone statusy”)', text: true, fmt: v => (v ? 'tak' : 'nie'), type: 'text' }, ordersCol, valueCol], rows: d.byStatus },
    payments: { label: 'Formy płatności', tip: 'Liczone zamówienia wg formy płatności', cols: [nameCol('Forma płatności'), ordersCol, valueCol, avgCol], rows: d.payments },
    deliveries: { label: 'Formy dostawy', tip: 'Liczone zamówienia wg formy dostawy', cols: [nameCol('Forma dostawy'), ordersCol, valueCol, avgCol], rows: d.deliveries },
    woj: { label: 'Województwa', tip: 'Liczone zamówienia wg województwa klienta: z notatki klienta, a gdy jej brak — przybliżone z kodu pocztowego dostawy',
      cols: [nameCol('Województwo', 'Województwo klienta (notatka orszaku albo kod pocztowy dostawy)'), { key: 'approx', label: 'Z kodu poczt.', num: true, tip: 'Ile zamówień przypisano do województwa tylko na podstawie kodu pocztowego (bez notatki klienta)', fmt: int, type: 'number' }, ordersCol, valueCol],
      rows: d.woj.map(w => ({ ...w, name: w.key ? wojLabel(w.key) : '— nie ustalono —' })) },
  };
}

function tableCard(d) {
  const T = tabs(d);
  if (!T[S.tab]) S.tab = 'series';
  const box = el('section', { class: 'card rp-card', id: 'rpTables' });
  const draw = () => {
    const def = T[S.tab], st = S.sort[S.tab] || (def.first || { sort: def.cols.find(c => c.bar) ? 'value' : def.cols[0].key, dir: 'desc' });
    const sort = st.sort, dir = st.dir;
    const rows = def.rows.slice().sort((a, b) => {
      const x = a[sort], y = b[sort], ex = x == null || x === '', ey = y == null || y === '';
      if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;   // puste zawsze na końcu
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pl');
      return dir === 'asc' ? c : -c;
    });
    const max = Math.max(...def.rows.map(r => Number(r.value) || 0), 1);
    const head = el('tr', null, def.cols.map(c => sortTh({ label: c.label, sort: c.key, num: c.num, tip: c.tip, tipHeader: c.tip !== c.label, firstDir: c.num ? 'desc' : 'asc' }, { sort, dir },
      (k, dd) => { S.sort[S.tab] = { sort: k, dir: dd }; draw(); })));
    const tr = r => el('tr', { 'data-key': r.key || r.id || r.name }, def.cols.map(c => {
      const v = r[c.key], txt = c.fmt ? c.fmt(v, r) : v == null ? '' : String(v);
      const href = c.link && c.link(r);
      const inner = href ? el('a', { href }, txt) : txt;
      if (c.bar) return el('td', { class: 'n rp-vcell' }, el('span', { class: 'rp-vbar', style: 'width:' + Math.round((Number(v) || 0) / max * 100) + '%', 'aria-hidden': 'true' }), el('span', { class: 'rp-vnum' }, inner));
      return el('td', { class: c.num ? 'n' : null }, inner);
    }));
    box.replaceChildren(el('div', { class: 'rp-head' }, el('h2', null, def.label), el('span', { class: 'muted tip', title: def.tip }, def.rows.length + ' ' + (def.rows.length === 1 ? 'pozycja' : 'pozycji')), tabBar(T, draw),
      el('span', { class: 'rp-grow' }), downloadMenuButton('rpDl', () => exportTable(d, def, rows), null, !rows.length, { cls: 'secondary', label: 'Pobierz tabelę', title: 'Pobierz widoczną tabelę jako Excel albo CSV' })),
      rows.length ? el('div', { class: 'table-wrap rp-wrap' }, el('table', { id: 'rpTable', 'data-tab': S.tab }, el('thead', null, head), el('tbody', null, rows.map(tr))))
        : el('div', { class: 'empty' }, 'Brak danych w tym okresie.'));
  };
  S.redraw = draw;
  draw();
  return box;
}

function tabBar(T, draw) {
  const wrap = el('div', { class: 'rp-tabs', role: 'group', 'aria-label': 'Podział sprzedaży' });
  for (const [k, def] of Object.entries(T)) wrap.append(el('button', { type: 'button', class: 'chip', 'data-tab': k, 'aria-pressed': String(S.tab === k), title: def.tip,
    onclick: () => { S.tab = k; draw(); } }, def.label));
  return wrap;
}

function exportTable(d, def, rows) {
  const cols = def.cols;
  return { sheet: def.label, file: 'raport-sprzedazy-' + S.tab + '-' + d.range.from + '_' + d.range.to,
    columns: cols.map(c => ({ header: c.label, type: c.type === 'number' ? 'number' : 'text', width: c.text ? 28 : 14 })),
    rows: rows.map(r => cols.map(c => (c.type === 'number' ? Number(r[c.key]) || 0 : c.fmt ? c.fmt(r[c.key], r) : r[c.key] == null ? '' : r[c.key]))),
    note: 'Okres ' + dmy(d.range.from) + ' – ' + dmy(d.range.to) + ' · ' + statusSummary(d).long + ' · dane z synchronizacji: ' + syncedLabel(d.syncedMs) };
}

function clientsCard(d) {
  const c = d.clients, tot = c.newOrders + c.returningOrders;
  const row = (id, label, tip, n, orders, value) => el('tr', { id }, el('th', { scope: 'row', class: 'tip', title: tip }, label), el('td', { class: 'n' }, int(n)), el('td', { class: 'n' }, int(orders)), el('td', { class: 'n' }, zl(value)),
    el('td', { class: 'n' }, tot ? Math.round(orders / tot * 100) + '%' : '—'));
  return el('section', { class: 'card rp-card', id: 'rpClients' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Powracający = klient, który miał zamówienie (poza anulowanymi) przed początkiem wybranego okresu. Klient jest rozpoznawany po adresie e-mail.' }, 'Nowi i powracający klienci')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'rp-small' }, el('thead', null, el('tr', null, el('th', null, 'Klienci'), el('th', { class: 'n' }, 'Osób'), el('th', { class: 'n' }, 'Zamówień'), el('th', { class: 'n' }, 'Wartość'), el('th', { class: 'n' }, 'Udział zamówień'))),
      el('tbody', null, row('rpNew', 'Nowi', 'Pierwsze zamówienie w tym okresie', c.newCustomers, c.newOrders, c.newValue), row('rpRet', 'Powracający', 'Mieli zamówienie przed początkiem okresu', c.returning, c.returningOrders, c.returningValue)))),
    c.noEmailOrders ? el('p', { class: 'muted rp-note' }, c.noEmailOrders + ' zamówień bez adresu e-mail pominięto w tym podziale.') : null);
}

// ─── Filtry i ładowanie ─────────────────────────────────────────────────────

function statusPanel(d) {
  const box = el('details', { class: 'rp-opts', id: 'rpStatuses' }, el('summary', { title: 'Wybierz, które statusy zamówień mają być liczone w kafelkach, wykresie i tabelach' }, 'Które zamówienia liczyć: ', el('b', null, statusSummary(d).short)));
  const checks = d.statuses.map(s => { const cb = el('input', { type: 'checkbox', value: s.id, checked: s.selected }); return el('label', { class: 'menu-check', title: s.cancelled ? 'Status anulowania — domyślnie niezaznaczony' : null }, cb, el('span', null, s.name)); });
  const apply = () => { const ids = checks.map(l => l.firstChild).filter(cb => cb.checked).map(cb => cb.value); S.statusIds = ids.length ? ids : null; save(); load(); };
  box.append(el('div', { class: 'rp-checks' }, ...checks),
    el('div', { class: 'rp-opts-actions' }, el('button', { type: 'button', class: 'primary', id: 'rpApplyStatuses', onclick: apply, title: 'Przelicz raport dla zaznaczonych statusów' }, 'Zastosuj'),
      el('button', { type: 'button', class: 'secondary', onclick: () => { S.statusIds = null; save(); load(); }, title: 'Wróć do ustawienia domyślnego: wszystkie statusy poza anulowanymi' }, 'Domyślne (bez anulowanych)')));
  return box;
}

const save = () => store(STORE_KEY, { compare: S.compare, group: S.group, statusIds: S.statusIds, tab: S.tab, metric: S.metric });

function controls() {
  const range = dateRange({ idFrom: 'rpFrom', idTo: 'rpTo', from: S.from, to: S.to, labelFrom: 'Od dnia', labelTo: 'Do dnia', titleFrom: 'Pierwszy dzień raportu', titleTo: 'Ostatni dzień raportu (włącznie)',
    onChange: ({ from, to }) => { if (from && to) { S.from = from; S.to = to; clearTimeout(S.timer); S.timer = setTimeout(load, 200); } } });
  const cmp = el('label', { class: 'field-inline', title: 'Porównuje z poprzednim okresem o tej samej długości, bezpośrednio przed wybranym' }, el('input', { type: 'checkbox', id: 'rpCompare', checked: S.compare, onchange: ev => { S.compare = ev.target.checked; save(); load(); } }), 'Porównaj z poprzednim okresem');
  const grp = el('label', { class: 'field-inline', title: 'Jak grupować sprzedaż na wykresie i w tabeli „Sprzedaż w czasie”' }, 'Grupuj',
    el('select', { id: 'rpGroup', 'aria-label': 'Grupowanie', onchange: ev => { S.group = ev.target.value; save(); load(); } }, GROUPS.map(([k, l, t]) => el('option', { value: k, selected: S.group === k, title: t }, l))));
  return el('section', { class: 'card rp-card rp-controls' }, el('div', { class: 'rp-ctl-row' }, range.node, cmp, grp), el('div', { id: 'rpStatusBox' }));
}

function render(d) {
  S.data = d;
  S.body.replaceChildren(
    el('div', { class: 'rp-top muted' }, el('span', { class: 'tip', title: 'Dane z ostatniej synchronizacji z Selly. Wynik raportu jest zapamiętywany na 5 minut.' }, 'Dane z synchronizacji: ' + syncedLabel(d.syncedMs)),
      el('span', null, ' · okres ' + dmy(d.range.from) + ' – ' + dmy(d.range.to) + ' (' + cnt(d.range.days, 'dzień', 'dni', 'dni') + ')')),
    tiles(d), chartCard(d), tableCard(d), clientsCard(d));
  const sb = document.getElementById('rpStatusBox');
  if (sb) sb.replaceChildren(statusPanel(d));
}

function load() {
  const my = ++S.seq;
  S.body.replaceChildren(loadingBox('Liczenie raportu…'));
  api('reports:sales', { from: S.from, to: S.to, group: S.group, compare: S.compare, statusIds: S.statusIds || [] }).then(d => { if (my === S.seq && S.root) render(d); }).catch(err => {
    if (my !== S.seq || !S.root) return;
    const adm = (ctx.boot && ctx.boot.adminUrl) || 'https://takimarket.pl/adm/';
    S.body.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error', id: 'rpError' },
      isUnavailable(err) ? 'Raporty sprzedaży potrzebują backendu Cloudflare — ten serwer ich nie obsługuje.' : 'Nie udało się policzyć raportu: ' + err.message,
      el('p', null, sellyLink('Otwórz raporty w panelu Selly ↗', adm + '?a=statistics.orders', 'Raporty sprzedaży w panelu Selly (nowa karta)')),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: load }, 'Spróbuj ponownie')))));
  });
}

export default {
  id: 'raporty',
  title: 'Raporty sprzedaży',
  routes: [],
  mount(el0) {
    S.root = el0;
    const saved = store(STORE_KEY) || {};
    S.compare = saved.compare !== false; S.group = GROUPS.some(g => g[0] === saved.group) ? saved.group : 'auto';
    S.statusIds = Array.isArray(saved.statusIds) && saved.statusIds.length ? saved.statusIds : null;
    S.tab = saved.tab || 'series'; S.metric = METRICS.some(m => m[0] === saved.metric) ? saved.metric : 'value';
    if (!S.from || !S.to) { const t = new Date(), f = new Date(); f.setDate(f.getDate() - 29); S.from = isoDate(f); S.to = isoDate(t); }
    S.body = el('div', { id: 'rpBody' });
    el0.replaceChildren(pageToolbar({ title: 'Raporty sprzedaży', sub: 'Sprzedaż, produkty, klienci i regiony z wybranego okresu — policzone z zamówień zapisanych w panelu' }), controls(), S.body);
    const click = id => () => { const n = document.getElementById(id); if (!n || n.disabled) return false; n.click(); return true; };
    shortcuts.scope('raporty', [
      { keys: ['d'], label: 'D', desc: 'Przejdź do pola daty „od dnia”', run: () => { const n = document.getElementById('rpFrom'); if (!n) return false; n.focus(); return true; } },
      { keys: ['c'], label: 'C', desc: 'Włącz lub wyłącz porównanie z poprzednim okresem', run: click('rpCompare') },
      { keys: ['f'], label: 'F', desc: 'Pokaż lub ukryj wybór liczonych statusów', run: () => { const n = document.querySelector('#rpStatuses summary'); if (!n) return false; n.click(); return true; } },
      { keys: ['e'], label: 'E', desc: 'Otwórz menu pobierania tabeli', run: click('rpDl') },
    ]);
    load();
  },
  unmount() { S.seq++; S.root = null; clearTimeout(S.timer); },
};
