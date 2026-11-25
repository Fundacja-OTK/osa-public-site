// Widok „Zysk i marża” raportów sprzedaży (odpowiednik raportu 15 w Selly: wartości netto, koszty zakupu netto, zysk, marża).
// Dane: akcja reports:profit (D1). Koszt = BIEŻĄCA cena zakupu produktu z karty, nie historyczna — dlatego widok mówi to wprost.
import { el, sortTh } from '../core/ui.js?v=fb40452';
import { zl, zl0, qty, pct1, rangeText, deltaEl, tile } from './raportyKit.js?v=fb40452';

const pc = v => (v == null ? '—' : pct1(v) + '%');
const ppFmt = v => (v > 0 ? '+' : v < 0 ? '−' : '') + pct1(Math.abs(v)) + ' p.p.';
const bucketText = (key, g) => (g === 'month' ? key.slice(5, 7) + '.' + key.slice(0, 4) : g === 'week' ? 'od ' + key.slice(8, 10) + '.' + key.slice(5, 7) : key.slice(8, 10) + '.' + key.slice(5, 7) + '.' + key.slice(0, 4));

/** Różnica marży w punktach procentowych (p.p.), nie w % — jak w raporcie Selly. */
function ppDelta(cur, prev, cmp) {
  if (!cmp) return el('span', { class: 'rp-delta off tip', title: 'Porównanie jest wyłączone w ustawieniach.' }, 'bez porównania');
  if (cur == null || prev == null) return el('span', { class: 'rp-delta off tip', title: 'Brak marży w jednym z okresów (żadna sprzedana pozycja nie ma ceny zakupu).' }, 'porównanie niedostępne');
  const d = Math.round((cur - prev) * 100) / 100;
  return el('span', { class: 'rp-delta tip ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'flat'), title: 'Różnica marży w punktach procentowych (p.p.): marża bieżąca minus marża z porównania. To nie jest zmiana procentowa marży.' },
    (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '● ') + (d ? ppFmt(d) : 'bez zmian'));
}

export function zyskRender(c) {
  const { Q, d, setQ, legend } = c, r = d.range, cmp = r.compare, cur = d.summary.cur, prev = d.summary.prev;
  const top = el('div', { class: 'rp-top muted' }, 'Dane z ostatniej synchronizacji z Selly. Wynik raportu jest zapamiętywany na 5 minut.');
  const note = el('div', { class: 'notice warn', id: 'rpCostNote' }, el('b', null, 'Skąd koszt? '),
    'Koszt zakupu to BIEŻĄCA cena zakupu produktu z jego karty (nie cena z dnia sprzedaży) × sprzedana ilość; wartości netto to cena pozycji bez VAT (stawka produktu). Gdy zmieniałeś ceny zakupu, zysk dawnych okresów jest przybliżony. ',
    'Pozycje bez ceny zakupu są pominięte w zysku i marży — pokazujemy je osobno.');
  if (!cur.net) return [top, legend, el('div', { class: 'card' }, el('div', { class: 'empty', id: 'rpEmpty' }, 'Brak sprzedaży w okresie ' + rangeText(r.from, r.to) + ' przy ustawieniu „statusy: ' + c.statusPhrase().text + '”.'))];
  const ss = c.statusPhrase().tip, lbl = rangeText(r.from, r.to), plb = cmp ? rangeText(r.prevFrom, r.prevTo) : '';
  const prevLine = (txt, tip) => el('div', { class: 'rp-prevline tip', title: tip }, el('i', { class: 'rp-sw cmp' }), 'porównanie: ' + txt);
  const t = (k, label, tip, v, pv, fmt) => tile(k, label, tip + ' ' + ss, fmt(v), [cmp && pv != null ? prevLine(fmt(pv), 'Wartość w okresie porównawczym ' + plb) : null, deltaEl(v, pv, { fmt, cmp, curLabel: lbl, prevLabel: plb })]);
  const marginTile = tile('margin', 'Marża', 'Zysk podzielony przez wartość netto pozycji, które mają cenę zakupu (pozycje bez kosztu nie są liczone). Różnica względem porównania jest w punktach procentowych (p.p.).',
    pc(cur.margin), [cmp && prev && prev.margin != null ? prevLine(pc(prev.margin), 'Marża w okresie porównawczym ' + plb) : null, ppDelta(cur.margin, prev && prev.margin, cmp)]);
  const tiles = el('div', { class: 'rp-tiles', id: 'rpKpi' },
    t('net', 'Wartość netto', 'Wartość sprzedanych pozycji bez VAT (wszystkie pozycje, także bez ceny zakupu; bez dostawy).', cur.net, prev && prev.net, zl0),
    t('cost', 'Koszty zakupu netto', 'Sprzedane sztuki × bieżąca cena zakupu produktu, tylko dla pozycji, które mają cenę zakupu.', cur.cost, prev && prev.cost, zl0),
    t('profit', 'Zysk', 'Wartość netto pozycji z ceną zakupu minus ich koszt zakupu.', cur.profit, prev && prev.profit, zl0), marginTile);
  const cov = cur.uncovNet > 0 ? el('div', { class: 'notice warn', id: 'rpCovNote' }, 'Zysk i marża liczą ' + pct1(cur.coverage) + '% wartości netto sprzedaży. ',
    el('b', { class: 'tip', title: 'Wartość netto pozycji produktów bez ceny zakupu w karcie produktu (lub produktów, których nie ma w kopii panelu)' }, 'Bez ceny zakupu: ' + zl0(cur.uncovNet) + ' (' + qty(cur.unitsNoCost) + ' szt., ' + d.missingTotal + ' produktów)'),
    ' — uzupełnij „Cenę zakupu” w kartach tych produktów, a raport doliczy je od razu. ', el('button', { type: 'button', class: 'secondary small', id: 'rpShowMissing', onclick: () => setQ({ tab: 'missing', so: '' }, true) }, 'Pokaż te produkty'))
    : el('div', { class: 'muted rp-note', id: 'rpCovNote' }, 'Wszystkie sprzedane pozycje mają cenę zakupu.');
  const vat = cur.vatAssumedNet > 0 ? el('p', { class: 'muted rp-note' }, 'Dla części produktów (netto ' + zl0(cur.vatAssumedNet) + ') brak stawki VAT w karcie — przyjęto 23%.') : null;

  const nameCol = { key: 'name', label: 'Produkt', tip: 'Nazwa produktu (link do karty produktu)', text: true, link: x => (x.id ? '#/produkty/' + encodeURIComponent(x.id) : null) };
  const T = {
    series: { label: 'Zysk w czasie', tip: 'Wartość netto, koszt, zysk i marża w kolejnych przedziałach okresu bieżącego (tylko pozycje z ceną zakupu liczą się do kosztu i zysku)',
      cols: [{ key: 'label', label: r.group === 'month' ? 'Miesiąc' : r.group === 'week' ? 'Tydzień (pon.–niedz.)' : 'Dzień', tip: 'Przedział okresu bieżącego', text: true },
        { key: 'net', label: 'Wartość netto', tip: 'Wartość netto wszystkich sprzedanych pozycji', num: true, fmt: zl }, { key: 'cost', label: 'Koszt zakupu netto', tip: 'Koszt zakupu pozycji z ceną zakupu', num: true, fmt: zl },
        { key: 'profit', label: 'Zysk', tip: 'Wartość netto pozycji z ceną zakupu minus koszt', num: true, fmt: zl }, { key: 'margin', label: 'Marża', tip: 'Zysk / wartość netto pozycji z ceną zakupu', num: true, fmt: pc }],
      rows: d.series.map(s => ({ ...s, label: bucketText(s.key, r.group) })), first: ['key', 'asc'] },
    products: { label: 'Produkty', tip: 'Produkty z ceną zakupu wg zysku' + (d.productsTotal > d.products.length + d.missingTotal ? ' (pokazano najlepsze ' + d.products.length + ')' : ''),
      cols: [nameCol, { key: 'qty', label: 'Sztuki', tip: 'Sprzedane sztuki', num: true, fmt: qty },
        { key: 'net', label: 'Wartość netto', tip: 'Wartość netto sprzedanych pozycji', num: true, fmt: zl }, { key: 'cost', label: 'Koszt zakupu netto', tip: 'Sztuki × bieżąca cena zakupu', num: true, fmt: zl },
        { key: 'profit', label: 'Zysk', tip: 'Wartość netto minus koszt zakupu', num: true, fmt: zl }, { key: 'margin', label: 'Marża', tip: 'Zysk / wartość netto', num: true, fmt: pc }], rows: d.products, first: ['profit', 'desc'] },
    missing: { label: 'Bez ceny zakupu', tip: 'Sprzedane produkty, którym brakuje ceny zakupu w karcie — nie liczą się do zysku i marży' + (d.missingTotal > d.missing.length ? ' (pokazano ' + d.missing.length + ' z ' + d.missingTotal + ')' : ''),
      cols: [nameCol, { key: 'qty', label: 'Sztuki', tip: 'Sprzedane sztuki', num: true, fmt: qty }, { key: 'net', label: 'Wartość netto', tip: 'Wartość netto sprzedanych pozycji', num: true, fmt: zl }], rows: d.missing, first: ['net', 'desc'] },
  };
  const tab = T[Q.tab] ? Q.tab : 'series', def = T[tab];
  const [qs, qd] = Q.so ? Q.so.split(':') : [], known = def.cols.some(x => x.key === qs), sort = known ? qs : def.first[0], dir = known ? qd : def.first[1];
  const rows = def.rows.slice().sort((a, b) => {
    const x = a[sort], y = b[sort], ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;   // puste zawsze na końcu
    const k = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pl');
    return dir === 'asc' ? k : -k;
  });
  const head = el('tr', null, def.cols.map(x => sortTh({ label: x.label, sort: x.key, num: x.num, tip: x.tip, tipHeader: x.tip !== x.label, firstDir: x.num ? 'desc' : 'asc' }, { sort, dir }, (k, dd) => setQ({ so: k + ':' + dd }, true))));
  const tr = row => el('tr', { 'data-key': row.key || row.id || row.name }, def.cols.map(x => {
    const v = row[x.key], txt = x.fmt ? x.fmt(v) : v == null ? '' : String(v), href = x.link && x.link(row);
    return el('td', { class: x.num ? 'n' : null }, href ? el('a', { href }, txt) : txt);
  }));
  const card = el('section', { class: 'card rp-card', id: 'rpTables' },
    el('div', { class: 'rp-head' }, el('h2', null, def.label), el('span', { class: 'muted tip', title: def.tip }, rows.length + ' ' + (rows.length === 1 ? 'pozycja' : 'pozycji')),
      el('div', { class: 'rp-tabs', role: 'group', 'aria-label': 'Podział zysku' }, Object.entries(T).map(([k, x]) => el('button', { type: 'button', class: 'chip', 'data-tab': k, 'aria-pressed': String(tab === k), title: x.tip, onclick: () => setQ({ tab: k, so: '' }, true) }, x.label)))),
    rows.length ? el('div', { class: 'table-wrap rp-wrap' }, el('table', { id: 'rpTable', 'data-tab': tab }, el('thead', null, head), el('tbody', null, rows.map(tr)))) : el('div', { class: 'empty' }, 'Brak pozycji w tej tabeli.'));
  return [top, legend, note, tiles, cov, vat, card];
}
