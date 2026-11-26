// Widok „Lata” raportów sprzedaży — odpowiednik „Analizy OSA” z rozszerzenia (extension/content/reportsAnalysis.js), ale z danych D1:
// kilka okresów (lat, sezonów albo tych samych dni w każdym roku) obok siebie. Ostatni okres = „bieżący”, przedostatni = „porównanie”.
// Kolory jak w widoku „Okres”: bieżący = pełna brązowa linia, porównanie = przerywana niebieska, wcześniejsze = cienkie.
import { el, loadingBox, sortTh, downloadMenuButton, debounce } from '../core/ui.js?v=a9a0d42';
import { svg, zl, zl0, int, qty, addDays, addYears, daysBetween, rangeText, deltaEl, pctText, pctFmt, niceMax, sparkline, tile, MONTHS, MONTHS_LONG } from './raportyKit.js?v=a9a0d42';

import { lataPeriods, partialMonth, weekLabel, isoWeekStart, weekRangeText } from './raportyDaty.js?v=a9a0d42';
export { lataPeriods, partialMonth };
const nfCompact = new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 });
const pad = n => String(n).padStart(2, '0');
/** Okres w formie wysyłanej do Workera (z polami tygodniowymi: isoY, toAt, cutAt, gdy są). */
export const periodReq = p => ({ from: p.from, to: p.to, axisTo: p.fullTo, label: p.label, ...(p.cutFrom ? { cutFrom: p.cutFrom, cutTo: p.cutTo } : {}), ...(p.cutAt ? { cutAt: p.cutAt } : {}), ...(p.toAt ? { toAt: p.toAt } : {}), ...(p.isoY ? { isoY: p.isoY } : {}) });
export const lataRequest = E => ({ periods: E.periods.map(periodReq), statusIds: E.ids, group: ['day', 'week', 'month'].includes(E.group) ? E.group : 'auto' });
const GROUP_UNIT = { day: 'dzień', week: 'tydzień', month: 'miesiąc' };
/** Etykiety osi: krótka („t47”, „lis”, „17.11”) i pełna do podpowiedzi („tydz. 47 (17–23.11)”) dla przedziału k okresu ref. */
export function slotLabels(group, ref) {
  if (group === 'week') {
    const start = k => (ref.isoY ? isoWeekStart(ref.isoY, k + 1) : addDays(ref.from, 7 * k));
    return { short: k => (ref.isoY ? 't' + (k + 1) : addDays(ref.from, 7 * k).slice(8, 10) + '.' + addDays(ref.from, 7 * k).slice(5, 7)), full: k => (ref.isoY ? weekLabel(ref.isoY, k + 1) : 'tydzień ' + weekRangeText(start(k), addDays(start(k), 6))) };
  }
  if (group === 'month') { const m0 = Number(ref.from.slice(5, 7)) - 1, y0 = Number(ref.from.slice(0, 4)); return { short: k => MONTHS[(m0 + k) % 12], full: k => MONTHS[(m0 + k) % 12] + ' ' + (y0 + Math.floor((m0 + k) / 12)) }; }
  return { short: k => addDays(ref.from, k).slice(8, 10) + '.' + addDays(ref.from, k).slice(5, 7), full: k => rangeText(addDays(ref.from, k), addDays(ref.from, k)) };
}

const cutNote = p => (p.cutFrom ? ' (bez ' + rangeText(p.cutFrom, p.cutTo).replace(/\.\d{4}/g, '') + ')' : p.to < p.fullTo ? ' (do ' + rangeText(p.to, p.to).replace(/\.\d{4}$/, '') + ')' : '');
const roleOf = (i, n) => (i === n - 1 ? 'bieżący' : i === n - 2 ? 'porównanie' : 'wcześniejszy');

/** Elementy paska „co oglądasz” dla widoku „Lata”. */
export const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
/** Pasek „co oglądasz” widoku „Lata”: text = szczegóły, short = krótkie zdanie (bez dat bieżącego okresu i ucięcia miesiąca — są w szczegółach). */
export function lataSummary(E, d, sp, GW) {
  const P = E.periods, n = P.length, last = P[n - 1], prev = P[n - 2];
  if (!n) return [{ k: 'range', text: 'Brak okresów do pokazania (rok jest w przyszłości)', short: 'Brak okresów do pokazania (rok jest w przyszłości)', tip: 'Zmień zakres lat.' }];
  const mode = E.per === 'year' ? 'pełne lata kalendarzowe' : E.per === 'season' ? 'sezony od: ' + MONTHS_LONG[E.ss - 1] : 'te same dni (' + rangeText(E.from, E.to).replace(/\.\d{4}$/, '') + ') w każdym roku';
  const g = d ? d.group : E.group === 'day' || E.group === 'week' ? E.group : E.group === 'month' ? 'month' : Math.max(...P.map(p => daysBetween(p.from, p.fullTo))) > 62 ? 'month' : 'day';
  const span = P[0].label + (n > 1 ? '–' + last.label : '');
  const short = E.per === 'year' ? (n > 1 ? 'Lata ' : 'Rok ') + span : E.per === 'season' ? (n > 1 ? 'Sezony ' : 'Sezon ') + span + ' (od ' + MONTHS_GEN[E.ss - 1] + ')' : 'Te same dni (' + rangeText(E.from, E.to).replace(/\.\d{4}$/, '') + ') w latach ' + span;
  return [
    { k: 'range', short, text: 'Sprzedaż w latach ' + P[0].label + (n > 1 ? '–' + last.label : '') + ' (' + mode + ')', tip: 'Okresy obok siebie: ' + P.map(p => p.label + ' ' + rangeText(p.from, p.to)).join('; ') + '. Kliknij, aby zmienić lata lub rodzaj okresów.' },
    { k: 'range', sw: 'cur', text: 'bieżący ' + last.label + ': ' + rangeText(last.from, last.to), tip: 'Okres bieżący — ostatni z wybranych. Na wykresie: gruba brązowa linia.' },
    { k: 'cmp', sw: n > 1 ? 'cmp' : null, text: n > 1 ? 'porównanie z ' + prev.label + ': ' + rangeText(prev.from, prev.to) : 'bez porównania (jeden okres)', short: n > 1 ? 'porównanie z ' + prev.label + (E.ytd && last.partial ? ' (do tego samego dnia)' : '') : 'bez porównania', tip: n > 1 ? 'Okres porównawczy — przedostatni z wybranych; wszystkie zmiany („vs porównanie”) liczone są względem niego. Na wykresie: przerywana niebieska linia. ' + (E.ytd ? 'Bieżący okres jest liczony do dziś, więc wcześniejsze lata też kończą się tego samego dnia kalendarzowego.' : 'Okresy są pełne (bez przycinania do dzisiejszego dnia).') : 'Wybrano tylko jeden okres — zwiększ zakres lat, aby coś porównać.' },
    ...(last.partial ? [{ k: 'range', text: last.partial.w ? last.partial.range + ' w każdym roku' : MONTHS_LONG[Number(E.today.slice(5, 7)) - 1] + ': do ' + last.partial.short + ' w każdym roku', tip: last.partial.note + (last.partial.w ? '. Bieżący tydzień jest jeszcze niepełny, więc wcześniejsze lata liczymy do tego samego dnia tygodnia i godziny — pozostałe tygodnie są pełne. Tygodnie liczone wg ISO 8601 (poniedziałek = początek).' : '. Bieżący miesiąc jest jeszcze niepełny, więc wcześniejsze lata liczymy do tego samego dnia — pozostałe miesiące są pełne.') }] : []),
    { k: 'status', text: 'statusy: ' + sp.text, short: sp.short, tip: sp.tip + ' Kliknij, aby zmienić.' },
    { k: 'group', text: 'oś czasu: ' + GW[g], short: E.group === 'auto' ? undefined : 'po ' + { day: 'dniach', week: 'tygodniach', month: 'miesiącach' }[E.group], tip: 'Na jakie przedziały dzielimy czas na wykresie i w mapie' + (E.group === 'auto' ? ' — wybrane automatycznie (miesiące dla okresów dłuższych niż 62 dni).' : '.') },
  ];
}

// ─── Miary ──────────────────────────────────────────────────────────────────

const MEAS = {
  value: { label: 'Sprzedaż (brutto)', short: 'Sprzedaż', i: 1, kind: 'money', tip: 'Suma wartości zamówień (pozycje + dostawa, brutto)' },
  orders: { label: 'Zamówienia', short: 'Zamówienia', i: 0, kind: 'int', tip: 'Liczba zamówień' },
  avg: { label: 'Średni koszyk', short: 'Średni koszyk', kind: 'money', tip: 'Wartość zamówień podzielona przez ich liczbę' },
  units: { label: 'Sprzedane sztuki', short: 'Sztuki', i: 3, kind: 'qty', tip: 'Suma ilości produktów w liczonych zamówieniach' },
  ship: { label: 'Koszty dostawy', short: 'Dostawa', i: 2, kind: 'money', tip: 'Suma kosztów dostawy doliczonych w zamówieniach (brutto)', neutral: true },
};
const FMT = { money: zl0, int, qty };
const DETAIL = { qty: ['Zamówione sztuki', 'Suma sztuk produktu w liczonych zamówieniach', qty], value: ['Wartość', 'Suma wartości pozycji produktu (bez dostawy)', zl0], orders: ['Zamówienia z produktem', 'W ilu zamówieniach wystąpił produkt (zamówienie z kilkoma produktami liczy się przy każdym)', int] };

const totalOf = (m, p) => (m === 'avg' ? p.avg : m === 'value' ? p.value : m === 'orders' ? p.orders : m === 'units' ? p.units : p.ship);
function bucketVal(m, p, k) {
  if (k > p.last || k >= p.buckets.length) return null;
  if (p.cutKs && p.cutKs[0] <= k && k <= p.cutKs[1]) return null;   // dni wycięte z niepełnego miesiąca (widok dzienny)
  const b = p.buckets[k];
  return m === 'avg' ? (b[0] ? b[1] / b[0] : 0) : b[MEAS[m].i];
}
function style(i, n) {
  if (i === n - 1) return { color: 'var(--accent)', w: 3, dash: '' };
  if (i === n - 2) return { color: 'var(--tone-2)', w: 2.5, dash: '7 4' };
  return { color: 'var(--tone-' + (3 + (n - 3 - i) % 4) + ')', w: 1.6, dash: '' };
}
const swatch = (i, n) => { const s = style(i, n); return el('i', { class: 'rp-swl', style: 'border-top:' + Math.min(s.w, 3) + 'px ' + (s.dash ? 'dashed' : 'solid') + ' ' + s.color, 'aria-hidden': 'true' }); };

// ─── Wykres liniowy (rok do roku) ───────────────────────────────────────────

export function lineChart({ labels, series, fmt, id, aria, titleOf, partial }) {
  const W = 760, H = 280, L = 64, R = 14, T = 12, B = 30, iw = W - L - R, ih = H - T - B, N = labels.length;
  const max = niceMax(Math.max(0, ...series.flatMap(s => s.values.filter(v => v != null))));
  const x = k => L + (N > 1 ? iw * k / (N - 1) : iw / 2), y = v => T + ih - (max ? ih * v / max : 0);
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rp-svg', role: 'img', 'aria-label': aria });
  for (let i = 0; i <= 4; i++) s.append(svg('line', { x1: L, x2: W - R, y1: T + ih - ih * i / 4, y2: T + ih - ih * i / 4, class: 'rp-grid' }), svg('text', { x: L - 6, y: T + ih - ih * i / 4 + 4, class: 'rp-axis', 'text-anchor': 'end' }, fmt(max * i / 4)));
  const every = Math.max(1, Math.ceil(N / 12));
  labels.forEach((l, k) => { if (k % every === 0) s.append(svg('text', { x: x(k), y: H - 9, class: 'rp-axis', 'text-anchor': 'middle' }, l)); });
  const tip = el('div', { class: 'rp-tip', hidden: true });
  for (const se of series) {
    let seg = [];
    const flush = () => { if (seg.length > 1) s.append(svg('polyline', { points: seg.join(' '), class: 'rp-line', 'data-p': se.name, stroke: se.color, 'stroke-width': se.w, 'stroke-dasharray': se.dash || null })); seg = []; };
    se.values.forEach((v, k) => { if (v == null) flush(); else seg.push(x(k).toFixed(1) + ',' + y(v).toFixed(1)); });
    const single = seg.length === 1 ? seg : [];
    flush();
    for (const pt of single) { const [cx, cy] = pt.split(','); s.append(svg('circle', { cx, cy, r: 3.5, fill: se.color })); }
    const lastK = se.values.reduce((a, v, k) => (v != null ? k : a), -1);
    if (lastK >= 0 && N > 1) s.append(svg('circle', { cx: x(lastK).toFixed(1), cy: y(se.values[lastK]).toFixed(1), r: se.w > 2 ? 4 : 3, fill: se.color, class: 'rp-endpt' }));
  }
  if (partial && partial.k >= 0 && partial.k < N) {
    const px = x(partial.k), lx = Math.min(Math.max(px, L + 26), W - R - 26);
    s.append(svg('line', { x1: px, x2: px, y1: T, y2: T + ih, class: 'rp-partial-line' }), svg('text', { x: lx, y: T + 10, class: 'rp-partial-label', 'text-anchor': 'middle' }, partial.label));
    for (const se of series) { const v = se.values[partial.k]; if (v != null) s.append(svg('circle', { cx: px.toFixed(1), cy: y(v).toFixed(1), r: 6, class: 'rp-partial-pt', stroke: se.color })); }
  }
  const cw = N > 1 ? iw / (N - 1) : iw;
  for (let k = 0; k < N; k++) {
    const g = svg('g', { class: 'rp-col', 'data-k': k });
    g.append(svg('rect', { x: x(k) - cw / 2, y: T, width: cw, height: ih, class: 'rp-hit' }));
    g.addEventListener('mouseenter', () => {
      tip.replaceChildren(el('strong', null, titleOf ? titleOf(k) : labels[k]), ...series.map(se => el('div', { class: se.cls || null }, el('i', { class: 'rp-swl', style: 'border-top:3px ' + (se.dash ? 'dashed ' : 'solid ') + se.color }), se.name + ': ' + (se.values[k] == null ? '—' : fmt(se.values[k])))), ...(partial && partial.k === k ? [el('div', { class: 'rp-tip-partial' }, partial.note)] : []));
      tip.hidden = false; tip.style.left = Math.min(Math.max(x(k) / W * 100, 16), 84) + '%';
    });
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
    s.append(g);
  }
  return el('div', { class: 'rp-chart-wrap', id }, s, tip);
}

// ─── Sortowanie tabel w adresie (so=<tabela>_<kolumna>:<kierunek>) ──────────

export function sortState(Q, tbl, def) {
  const [id, dir] = (Q.so || '').split(':'), i = id ? id.indexOf('_') : -1;
  return i > 0 && id.slice(0, i) === tbl ? { sort: id.slice(i + 1), dir } : def;
}
export function sortRows(rows, st, get) {
  return rows.slice().sort((a, b) => {
    const x = get(a, st.sort), y = get(b, st.sort), ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pl');
    return st.dir === 'asc' ? c : -c;
  });
}

// ─── Widok ──────────────────────────────────────────────────────────────────

const L = { more: 0, product: null, productKey: '' };

export function lataRender(c) {
  const { Q, E, d, setQ } = c, P = d.periods, n = P.length;
  if (!n) return [el('div', { class: 'card' }, el('div', { class: 'empty', id: 'rpEmpty' }, 'Wybrane lata są w przyszłości — nie ma czego porównać.'))];
  const last = n - 1, prev = n - 2, cmp = n > 1, m = Q.lm, M = MEAS[m], fmt = FMT[M.kind];
  const pLabel = (i, long) => P[i].label + (long ? ' (' + roleOf(i, n) + ')' : '');
  const rangeOf = i => rangeText(E.periods[i].from, E.periods[i].to);
  const none = P.every(p => !p.orders);
  if (d.group === 'day') P.forEach((p, i) => { const e = E.periods[i]; p.cutKs = e.cutFrom ? [daysBetween(e.from, e.cutFrom) - 1, daysBetween(e.from, e.cutTo) - 1] : null; });
  const pm = E.periods[last].partial, partial = pm ? { k: P[last].last, label: 'do ' + pm.short, note: pm.note } : null;
  const legend = el('div', { class: 'rp-legend', id: 'rpLegend', role: 'group', 'aria-label': 'Oznaczenia kolorów' }, ...P.map((p, i) => el('span', { class: 'tip', title: 'Okres ' + roleOf(i, n) + ': ' + p.label + ', ' + rangeOf(i) + '. Razem: ' + zl0(p.value) + ', ' + int(p.orders) + ' zam.' }, swatch(i, n), el('b', null, p.label + ' '), roleOf(i, n) + ' · ' + rangeOf(i))));
  const top = el('div', { class: 'rp-top muted' }, 'Dane z ostatniej synchronizacji z Selly. Okresy zakończone dawno temu są zapamiętywane na kilka godzin, bieżący na 10 minut.');
  if (none) return [top, legend, el('div', { class: 'card' }, el('div', { class: 'empty', id: 'rpEmpty' }, 'Brak zamówień w okresach ' + P.map(p => p.label).join(', ') + ' przy ustawieniu „statusy: ' + c.statusPhrase().text + '”.',
    el('p', { class: 'muted' }, 'Zmień lata albo liczone statusy („Więcej opcji”) — w „Ustawieniach” (albo kliknij fragment paska „Co oglądasz”).')))];

  // ── wspólna oś
  const longest = P.reduce((a, p) => (p.buckets.length > a.buckets.length ? p : a), P[0]), N = longest.buckets.length, ref = E.periods[P.indexOf(longest)];
  const SL = slotLabels(d.group, ref), SLlast = slotLabels(d.group, E.periods[last]);
  const axis = Array.from({ length: N }, (_, k) => {
    return SL.short(k);
  });
  const axisFull = k => (d.group === 'week' && E.periods[last].isoY ? SL.full(k) : SLlast.full(k));
  const unit = GROUP_UNIT[d.group];

  // ── kafelki
  const dl = (cur, pv, f, neutral) => deltaEl(cur, pv, { fmt: f, cmp, neutral, curLabel: pLabel(last) + ' ' + rangeOf(last), prevLabel: cmp ? pLabel(prev) + ' ' + rangeOf(prev) : '' });
  const prevLine = (txt) => (cmp ? el('div', { class: 'rp-prevline tip', title: 'Wartość w okresie porównawczym ' + pLabel(prev) + ' (' + rangeOf(prev) + ')' }, el('i', { class: 'rp-sw cmp' }), 'porównanie ' + pLabel(prev) + ': ' + txt) : null);
  const kt = (k, label, tip, cur, pv, f, neutral) => tile(k, label, tip, f(cur), [prevLine(pv == null ? '—' : f(pv)), dl(cur, pv, f, neutral)]);
  const tiles = [kt('main', M.short + ' · ' + pLabel(last, true), M.tip + '. Okres bieżący ' + P[last].label + ': ' + rangeOf(last) + '. Statusy: ' + c.statusPhrase().text, totalOf(m, P[last]), cmp ? totalOf(m, P[prev]) : null, fmt, M.neutral)];
  if (m !== 'orders') tiles.push(kt('orders', 'Zamówienia · ' + P[last].label, 'Liczba liczonych zamówień w okresie ' + P[last].label, P[last].orders, cmp ? P[prev].orders : null, int));
  if (m !== 'units') tiles.push(kt('units', 'Sprzedane sztuki · ' + P[last].label, 'Suma ilości produktów w liczonych zamówieniach okresu ' + P[last].label, P[last].units, cmp ? P[prev].units : null, qty));
  tiles.push(kt('products', 'Produkty ze sprzedażą · ' + P[last].label, 'Ile różnych produktów sprzedano w okresie ' + P[last].label + ' (z listy do 500 najlepszych na okres)', P[last].productsTotal, cmp ? P[prev].productsTotal : null, int));
  const filledAvg = i => { const k = P[i].last + 1; return k ? (m === 'avg' ? totalOf(m, P[i]) : totalOf(m, P[i]) / k) : 0; };
  tiles.push(kt('avgper', 'Średnio na ' + unit, 'Wartość miary „' + M.short + '” podzielona przez liczbę ' + (d.group === 'month' ? 'miesięcy' : d.group === 'week' ? 'tygodni' : 'dni') + ' okresu (do dziś w okresie bieżącym)', filledAvg(last), cmp ? filledAvg(prev) : null, fmt, M.neutral));
  const vals = P[last].buckets.map((_, k) => bucketVal(m, P[last], k)), best = vals.reduce((a, v, k) => (v != null && (a < 0 || v > vals[a]) ? k : a), -1);
  if (best >= 0 && m !== 'avg') tiles.push(tile('best', 'Najlepszy ' + unit + ' · ' + P[last].label, 'Przedział z największą wartością miary „' + M.short + '” w okresie ' + P[last].label, fmt(vals[best]), [el('div', { class: 'muted small' }, axisFull(best))]));
  if (n >= 3 && m !== 'avg') tiles.push(kt('growth', 'Zmiana ' + P[0].label + ' → ' + P[last].label, 'Suma miary w pierwszym i w ostatnim okresie — jak bardzo zmieniła się przez cały zakres lat', totalOf(m, P[last]), totalOf(m, P[0]), fmt, M.neutral));
  const kpis = el('div', { class: 'rp-tiles', id: 'lataKpi' }, ...tiles.slice(0, 6));

  // ── wykres
  const cumulative = Q.cm === 'cumulative' && m !== 'avg';
  const series = P.map((p, i) => {
    let acc = 0;
    const values = p.buckets.map((_, k) => { const v = bucketVal(m, p, k); if (v == null) return null; if (!cumulative) return v; acc += v; return acc; });
    return { name: p.label + ' (' + roleOf(i, n) + ')', values, ...style(i, n) };
  });
  const metricSel = el('select', { id: 'lataMetric', 'aria-label': 'Miara', title: 'Co pokazać na wykresie i w mapie miesięcy', onchange: ev => setQ({ lm: ev.target.value }, true) }, Object.entries(MEAS).map(([k, v]) => el('option', { value: k, selected: k === m, title: v.tip }, v.label)));
  const modeSeg = el('div', { class: 'rp-segs', role: 'group', 'aria-label': 'Sposób liczenia' }, [['monthly', d.group === 'month' ? 'Miesięcznie' : d.group === 'week' ? 'Tygodniowo' : 'Dziennie', 'Wartość w każdym przedziale osobno'], ['cumulative', 'Narastająco', m === 'avg' ? 'Niedostępne dla średniego koszyka' : 'Suma od początku okresu — widać, kto „wyprzedza” ten sam dzień rok wcześniej']]
    .map(([k, l, t]) => el('button', { type: 'button', class: 'rp-seg', id: 'lataMode-' + k, 'data-mode': k, 'aria-pressed': String((Q.cm === 'cumulative' && m !== 'avg' ? 'cumulative' : 'monthly') === k), title: t, disabled: k === 'cumulative' && m === 'avg', onclick: () => setQ({ cm: k }, true) }, l)));
  const chart = lineChart({ labels: axis, series, fmt, titleOf: axisFull, partial, id: 'lataChart', aria: 'Wykres liniowy: ' + M.label + ' w okresach ' + P.map(p => p.label).join(', ') + ' (' + (cumulative ? 'narastająco' : unit + ' po ' + unit + 'u') + '). Te same dane są w tabeli „Dane wykresu” poniżej.' });
  const chartCard = el('section', { class: 'card rp-card' }, el('div', { class: 'rp-head' }, el('h2', null, M.label + ' — rok do roku'), el('span', { class: 'rp-grow' }), el('label', { class: 'field-inline' }, 'Miara', metricSel), modeSeg),
    legend, chart);

  // ── mapa miesięcy
  const heatMax = Math.max(0, ...P.flatMap(p => p.buckets.map((_, k) => bucketVal(m, p, k)).filter(v => v != null && v > 0)));
  const heat = el('section', { class: 'card rp-card' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Wiersz = okres, kolumna = ' + unit + '. Im ciemniejsze pole, tym większa wartość miary „' + M.short + '” (najciemniejsze = największa wartość ze wszystkich pól).' }, 'Mapa ' + (d.group === 'month' ? 'miesięcy' : 'dni')), el('span', { class: 'muted small' }, M.label + ' — im ciemniej, tym więcej')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'rp-heat', id: 'lataHeat' },
      el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Okres' }, 'Okres')), axis.map((a, k) => el('th', { class: 'n' }, el('span', { title: axisFull(k) }, a))), el('th', { class: 'n' }, el('span', { class: 'tip', title: 'Suma (albo średnia — dla średniego koszyka) miary w całym okresie' }, 'Razem')))),
      el('tbody', null, [...P.keys()].reverse().map(i => el('tr', { 'data-p': P[i].label }, el('th', { scope: 'row' }, swatch(i, n), P[i].label), axis.map((a, k) => {
        const v = bucketVal(m, P[i], k);
        if (v == null) return el('td', { class: 'n rp-hna', title: 'Po zakończeniu okresu (tego dnia jeszcze nie było)' }, '·');
        if (!heatMax || v <= 0) return el('td', { class: 'n rp-hzero', title: P[i].label + ', ' + a + ': ' + fmt(v) }, '0');
        const f = v / heatMax;
        return el('td', { class: 'n rp-hcell', style: 'background:color-mix(in srgb, var(--accent) ' + Math.round(f * 78) + '%, var(--surface));' + (f > 0.5 ? 'color:var(--accent-text)' : ''), title: P[i].label + ', ' + a + ': ' + fmt(v) }, M.kind === 'money' || M.kind === 'qty' ? nfCompact.format(v) : int(v));
      }), el('td', { class: 'n rp-htotal' }, fmt(totalOf(m, P[i])))))))));

  // ── podsumowanie okresów
  const sumCols = [['value', 'Sprzedaż', 'Suma wartości zamówień (brutto)', zl0], ['orders', 'Zamówienia', 'Liczba zamówień', int], ['avg', 'Średni koszyk', 'Wartość / liczba zamówień', zl], ['units', 'Sztuki', 'Suma sprzedanych sztuk', qty], ['ship', 'Dostawa', 'Suma kosztów dostawy', zl0]];
  const summary = el('section', { class: 'card rp-card', id: 'lataSum' }, el('div', { class: 'rp-head' }, el('h2', null, 'Podsumowanie okresów'), el('span', { class: 'rp-grow' }),
    downloadMenuButton('lataSumDl', () => ({ sheet: 'Okresy', file: 'raport-sprzedazy-lata-podsumowanie', columns: [{ header: 'Okres', type: 'text', width: 14 }, { header: 'Rola', type: 'text', width: 14 }, { header: 'Zakres', type: 'text', width: 24 }, ...sumCols.map(s => ({ header: s[1], type: 'number', width: 14 }))],
      rows: P.map((p, i) => [p.label, roleOf(i, n), rangeOf(i), ...sumCols.map(s => totalOf(s[0], p))]), note: c.sentence() }), null, false, { cls: 'secondary', label: 'Pobierz', title: 'Pobierz podsumowanie okresów jako Excel albo CSV' })),
    el('div', { class: 'table-wrap' }, el('table', { class: 'rp-small' }, el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Okres i jego rola w porównaniu' }, 'Okres')), el('th', null, el('span', { title: 'Dokładne daty okresu' }, 'Zakres')),
      ...sumCols.map(s => el('th', { class: 'n' }, el('span', { class: 'tip', title: s[2] }, s[1]))), cmp ? el('th', { class: 'n' }, el('span', { class: 'tip', title: 'Zmiana sprzedaży względem poprzedniego okresu z listy' }, 'Zmiana sprzedaży')) : null)),
      el('tbody', null, P.map((p, i) => el('tr', { 'data-p': p.label }, el('th', { scope: 'row' }, swatch(i, n), p.label, el('span', { class: 'rp-role' }, ' ' + roleOf(i, n))), el('td', null, rangeOf(i) + cutNote(E.periods[i])),
        ...sumCols.map(s => el('td', { class: 'n' }, s[3](totalOf(s[0], p)))), cmp ? el('td', { class: 'n' }, i ? deltaEl(p.value, P[i - 1].value, { fmt: zl0, cmp: true, curLabel: p.label, prevLabel: P[i - 1].label }) : '—') : null))))));

  // ── produkty
  const items = new Map();
  P.forEach((p, i) => { for (const r of p.products) { const k = r.id || 'n:' + r.name; let it = items.get(k); if (!it) items.set(k, it = { key: r.id || '', k, name: r.name, code: r.code, per: new Array(n).fill(null) }); it.per[i] = r; it.name = r.name || it.name; it.code = r.code || it.code; } });
  const dm = Q.dm, [dmLabel, dmTip, dmFmt] = DETAIL[dm];
  const mv = (it, i) => (it.per[i] ? it.per[i][dm] : 0) || 0;
  const lastTotal = [...items.values()].reduce((s, it) => s + mv(it, last), 0);
  const q = (Q.q || '').trim().toLowerCase();
  let rows = [...items.values()].filter(it => it.per.some(v => v && v[dm])).filter(it => !q || it.name.toLowerCase().includes(q) || String(it.key).includes(q) || (it.code || '').toLowerCase().includes(q)).map(it => {
    const vs = P.map((_, i) => mv(it, i)), cur = vs[last], before = cmp ? vs[prev] : null, everBefore = vs.slice(0, last).some(v => v > 0);
    return { it, vs, sum: vs.reduce((a, b) => a + b, 0), cur, before, chg: cmp ? pctText(cur, before) : null, share: lastTotal ? cur / lastTotal : 0, badge: !everBefore && cur > 0 && last > 0 ? 'nowy' : cur === 0 && everBefore ? 'wycofany' : '' };
  });
  const st = sortState(Q, 'prod', { sort: 'p' + last, dir: 'desc' });
  const getP = (r, col) => (col === 'name' ? r.it.name.toLowerCase() : col === 'code' ? r.it.code : col === 'chg' ? r.chg : col === 'share' ? r.share : col === 'sum' ? r.sum : /^p\d+$/.test(col) ? r.vs[Number(col.slice(1))] : null);
  rows = sortRows(rows, st, getP);
  const shown = rows.slice(0, 100 + L.more);
  const th = (key, label, tip, num, firstDir) => sortTh({ label, sort: key, num, tip, tipHeader: tip !== label, firstDir }, st, (k, dd) => setQ({ so: 'prod_' + k + ':' + dd }, true));
  const bad = r => (r.badge ? el('span', { class: 'rp-badge ' + r.badge, title: r.badge === 'nowy' ? 'Nie było sprzedaży w wcześniejszych okresach, a w okresie bieżącym jest' : 'Sprzedawał się wcześniej, a w okresie bieżącym nie ma sprzedaży' }, r.badge) : null);
  const openItem = key => setQ({ item: key }, true);
  const itemTable = el('table', { id: 'lataItemsTable' }, el('thead', null, el('tr', null, th('name', 'Produkt', 'Nazwa produktu. Kliknij, aby zobaczyć kartę szczegółów produktu pod tabelą', false, 'asc'), th('code', 'Kod', 'Kod producenta', false, 'asc'),
    ...P.map((p, i) => th('p' + i, p.label, dmLabel + ' w okresie ' + p.label + ' (' + roleOf(i, n) + ', ' + rangeOf(i) + ')', true, 'desc')), th('sum', 'Razem', dmLabel + ' we wszystkich okresach razem', true, 'desc'),
    cmp ? th('chg', 'Zmiana', 'Zmiana względem okresu porównawczego (' + pLabel(prev) + '): ' + dmLabel + ' w ' + pLabel(last) + ' kontra ' + pLabel(prev) + '. Puste, gdy w porównaniu było 0', true, 'desc') : null,
    th('share', 'Udział ' + P[last].label, 'Jaką część całej miary „' + dmLabel + '” w okresie ' + P[last].label + ' dał ten produkt', true, 'desc'))),
  el('tbody', null, shown.map(r => el('tr', { 'data-key': r.it.key || r.it.k, class: String(Q.item) === String(r.it.key) && r.it.key ? 'is-sel' : null },
    el('td', null, r.it.key ? el('a', { href: '#/raporty' + itemHash(Q, r.it.key), class: 'rp-pname', title: 'Pokaż kartę szczegółów produktu (przebieg miesięczny, porównanie okresów)', onclick: ev => { ev.preventDefault(); openItem(r.it.key); } }, r.it.name) : r.it.name, bad(r)),
    el('td', null, r.it.code || ''), ...r.vs.map(v => el('td', { class: 'n' }, v ? dmFmt(v) : '—')), el('td', { class: 'n' }, dmFmt(r.sum)),
    cmp ? el('td', { class: 'n ' + (r.chg > 0 ? 'rp-up' : r.chg < 0 ? 'rp-down' : '') }, pctFmt(r.chg)) : null,
    el('td', { class: 'n' }, lastTotal ? (r.share * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + '%' : '—')))));
  const dmSel = el('select', { id: 'lataDm', 'aria-label': 'Miara produktów', title: 'Co zestawiać w tabeli produktów i w „wzrostach / spadkach”', onchange: ev => setQ({ dm: ev.target.value }, true) }, Object.entries(DETAIL).map(([k, v]) => el('option', { value: k, selected: k === dm, title: v[1] }, v[0])));
  const search = el('input', { type: 'search', id: 'lataSearch', value: Q.q, placeholder: 'Szukaj produktu: nazwa, kod, ID', 'aria-label': 'Szukaj produktu', title: 'Filtruje tabelę produktów po nazwie, kodzie producenta albo ID',
    oninput: debounce(() => setQ({ q: search.value.trim() }, true), 300) });
  const prodCard = el('section', { class: 'card rp-card', id: 'lataItems' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Produkty z listy do ' + 500 + ' najlepszych (wg wartości) w każdym okresie. Wiersz = produkt, kolumny = okresy.' }, 'Produkty'), el('span', { class: 'muted small' }, rows.length + ' pozycji'),
    el('span', { class: 'rp-grow' }), el('label', { class: 'field-inline' }, 'Miara', dmSel), search,
    downloadMenuButton('lataItemsDl', () => ({ sheet: 'Produkty', file: 'raport-sprzedazy-lata-produkty', columns: [{ header: 'ID', type: 'text', width: 10 }, { header: 'Produkt', type: 'text', width: 40 }, { header: 'Kod', type: 'text', width: 14 }, ...P.map(p => ({ header: dmLabel + ' ' + p.label, type: 'number', width: 14 }))],
      rows: rows.map(r => [r.it.key, r.it.name, r.it.code || '', ...r.vs]), note: c.sentence() + ' · miara: ' + dmLabel }), null, !rows.length, { cls: 'secondary', label: 'Pobierz tabelę', title: 'Pobierz tabelę produktów (wszystkie wiersze po filtrze) jako Excel albo CSV' })),
    rows.length ? el('div', { class: 'table-wrap rp-wrap' }, itemTable) : el('div', { class: 'empty' }, q ? 'Żaden produkt nie pasuje do „' + Q.q + '” w okresach ' + P.map(p => p.label).join(', ') + '.' : 'Brak sprzedaży produktów w tych okresach.'),
    rows.length > shown.length ? el('button', { type: 'button', class: 'secondary', id: 'lataMore', title: 'Pokaż kolejne 100 produktów', onclick: () => { L.more += 100; setQ({}, true); } }, 'Pokaż więcej (' + (rows.length - shown.length) + ')') : null);

  // ── wzrosty i spadki
  let movers = null;
  if (cmp) {
    const diffs = [...items.values()].map(it => ({ it, cur: mv(it, last), before: mv(it, prev) })).map(x => ({ ...x, diff: x.cur - x.before }));
    const list = (arr, title, cls, id, tip) => el('div', { class: 'card rp-card', id }, el('h2', { class: 'tip', title: tip }, title), el('p', { class: 'muted small' }, dmLabel + ': ' + pLabel(last) + ' kontra ' + pLabel(prev)),
      arr.length ? el('ol', { class: 'rp-movers' }, arr.map(x => el('li', { 'data-key': x.it.key }, x.it.key ? el('a', { href: '#/raporty' + itemHash(Q, x.it.key), onclick: ev => { ev.preventDefault(); openItem(x.it.key); }, title: 'Pokaż kartę szczegółów produktu' }, x.it.name) : el('span', null, x.it.name),
        el('span', { class: 'muted rp-mv' }, dmFmt(x.before) + ' → '), el('b', null, dmFmt(x.cur)), el('span', { class: 'rp-delta ' + cls }, (x.diff > 0 ? '▲ +' : '▼ −') + dmFmt(Math.abs(x.diff)))))) : el('p', { class: 'muted' }, 'Brak'));
    movers = el('div', { class: 'rp-grid2', id: 'lataMovers' },
      list(diffs.filter(x => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 6), 'Największe wzrosty', 'up', 'lataUp', 'Produkty, których miara „' + dmLabel + '” najbardziej wzrosła względem okresu porównawczego'),
      list(diffs.filter(x => x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 6), 'Największe spadki', 'down', 'lataDown', 'Produkty, których miara „' + dmLabel + '” najbardziej spadła względem okresu porównawczego'));
  }

  // ── rozbicie wg kategorii
  const DIMS = { payments: ['Formy płatności', 'Liczone zamówienia wg formy płatności'], deliveries: ['Formy dostawy', 'Liczone zamówienia wg formy dostawy'], statuses: ['Statusy zamówień', 'Wszystkie zamówienia okresu wg statusu — także te, których nie liczą pozostałe kafelki'], categories: ['Kategorie produktów', 'Sprzedaż wg kategorii głównej produktu'], producers: ['Producenci', 'Sprzedaż wg producenta produktu'] };
  const catMap = new Map();
  P.forEach((p, i) => { for (const r of p[Q.dim]) { const key = r.id != null ? r.id : r.name; let e = catMap.get(key); if (!e) catMap.set(key, e = { name: r.name, vs: new Array(n).fill(0) }); e.vs[i] = r.value; } });
  const catTotal = [...catMap.values()].reduce((s, e) => s + e.vs[last], 0);
  let cats = [...catMap.values()].map(e => ({ ...e, chg: cmp ? pctText(e.vs[last], e.vs[prev]) : null, share: catTotal ? e.vs[last] / catTotal : 0 }));
  const cst = sortState(Q, 'cat', { sort: 'p' + last, dir: 'desc' });
  cats = sortRows(cats, cst, (r, col) => (col === 'name' ? r.name.toLowerCase() : col === 'chg' ? r.chg : col === 'share' ? r.share : /^p\d+$/.test(col) ? r.vs[Number(col.slice(1))] : null));
  const cth = (key, label, tip, num, fd) => sortTh({ label, sort: key, num, tip, tipHeader: tip !== label, firstDir: fd }, cst, (k, dd) => setQ({ so: 'cat_' + k + ':' + dd }, true));
  const dimSel = el('select', { id: 'lataDim', 'aria-label': 'Rozbicie sprzedaży', title: 'Według czego rozbić sprzedaż', onchange: ev => setQ({ dim: ev.target.value, so: '' }, true) }, Object.entries(DIMS).map(([k, v]) => el('option', { value: k, selected: k === Q.dim, title: v[1] }, v[0])));
  const catCard = el('section', { class: 'card rp-card', id: 'lataCats' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: DIMS[Q.dim][1] + '. Wartość = suma wartości (dla produktów — pozycji bez dostawy).' }, 'Rozbicie: ' + DIMS[Q.dim][0]), el('span', { class: 'rp-grow' }), el('label', { class: 'field-inline' }, 'Rozbij według', dimSel)),
    cats.length ? el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, cth('name', 'Nazwa', 'Nazwa grupy', false, 'asc'), ...P.map((p, i) => cth('p' + i, p.label, 'Wartość w okresie ' + p.label + ' (' + roleOf(i, n) + ', ' + rangeOf(i) + ')', true, 'desc')),
      el('th', null, el('span', { class: 'tip', title: 'Kształt zmian w kolejnych okresach (ostatnia kropka = okres bieżący)' }, 'Trend')), cmp ? cth('chg', 'Zmiana', 'Zmiana wartości względem okresu porównawczego (' + pLabel(prev) + ')', true, 'desc') : null,
      cth('share', 'Udział ' + P[last].label, 'Jaką część całej wartości okresu ' + P[last].label + ' stanowi ta grupa', true, 'desc'))),
    el('tbody', null, cats.map(r => el('tr', { 'data-name': r.name }, el('td', null, r.name), ...r.vs.map(v => el('td', { class: 'n' }, v ? zl0(v) : '—')), el('td', null, sparkline(r.vs)),
      cmp ? el('td', { class: 'n ' + (r.chg > 0 ? 'rp-up' : r.chg < 0 ? 'rp-down' : '') }, pctFmt(r.chg)) : null,
      el('td', { class: 'n' }, (r.share * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + '%', el('span', { class: 'rp-share', 'aria-hidden': 'true' }, el('span', { style: 'width:' + (r.share * 100).toFixed(1) + '%' }))))))))
      : el('div', { class: 'empty' }, 'Brak danych do rozbicia.'));

  // ── dane wykresu (zaawansowane)
  const raw = el('details', { class: 'card rp-card rp-raw', id: 'lataRaw' }, el('summary', { title: 'Opcja zaawansowana: dokładne liczby z wykresu, przedział po przedziale' }, 'Dane wykresu (tabela) — ' + M.label),
    el('div', { class: 'rp-head' }, el('span', { class: 'rp-grow' }), downloadMenuButton('lataRawDl', () => ({ sheet: 'Dane wykresu', file: 'raport-sprzedazy-lata-' + m, columns: [{ header: unit[0].toUpperCase() + unit.slice(1), type: 'text', width: 16 }, ...P.map(p => ({ header: p.label, type: 'number', width: 14 }))],
      rows: axis.map((a, k) => [axisFull(k), ...P.map(p => { const v = bucketVal(m, p, k); return v == null ? '' : v; })]), note: c.sentence() + ' · miara: ' + M.label }), null, false, { cls: 'secondary', label: 'Pobierz', title: 'Pobierz dane wykresu jako Excel albo CSV' })),
    el('div', { class: 'table-wrap rp-wrap' }, el('table', { class: 'rp-small' }, el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Przedział osi czasu (według okresu bieżącego)' }, unit[0].toUpperCase() + unit.slice(1))), ...P.map((p, i) => el('th', { class: 'n' }, el('span', { class: 'tip', title: M.label + ' w okresie ' + p.label + ' (' + roleOf(i, n) + ')' }, p.label))))),
      el('tbody', null, axis.map((a, k) => el('tr', null, el('th', { scope: 'row' }, axisFull(k)), ...P.map(p => { const v = bucketVal(m, p, k); return el('td', { class: 'n' }, v == null ? '·' : fmt(v)); }))),
        el('tr', { class: 'rp-total' }, el('th', { scope: 'row' }, 'Razem'), ...P.map(p => el('td', { class: 'n' }, fmt(totalOf(m, p)))))))));

  const itemBox = el('div', { id: 'lataItemBox' });
  const nodes = [top, legend, kpis, chartCard, heat, summary, ...(movers ? [movers] : []), catCard, prodCard, itemBox, raw];
  if (Q.item) showItem(c, itemBox, items.get(Q.item) || { key: Q.item, name: 'Produkt ID ' + Q.item, per: new Array(n).fill(null) }, { P, E, n, last, prev, cmp, dm, dmLabel, dmFmt, rangeOf, pLabel, d });
  return nodes;
}

const itemHash = (Q, key) => { const p = new URLSearchParams(); for (const k of Object.keys(Q)) if (Q[k] && Q[k] !== { v: 'okres', cmp: 'prev', gr: 'auto', tab: 'series', met: 'value', per: 'year', ss: '9', ytd: '1', lm: 'value', cm: 'monthly', dim: 'payments', dm: 'qty' }[k]) p.set(k, Q[k]); p.set('item', key); return '?' + p; };

/** Karta produktu: liczby w okresach, słupki, przebieg miesięczny z osobnego zapytania. */
function showItem(c, box, it, x) {
  const { P, E, n, last, prev, cmp, dm, dmLabel, dmFmt, rangeOf, pLabel, d } = x, v = (i, k) => (it.per[i] && it.per[i][k]) || 0;
  const dl = (cur, pv, f) => deltaEl(cur, pv, { fmt: f, cmp, curLabel: pLabel(last), prevLabel: cmp ? pLabel(prev) : '' });
  const kp = (label, tip, cur, pv, f) => tile('i-' + label, label + ' · ' + P[last].label, tip, cur == null ? '—' : f(cur), [cmp ? el('div', { class: 'rp-prevline' }, el('i', { class: 'rp-sw cmp' }), 'porównanie: ' + (pv == null ? '—' : f(pv))) : null, dl(cur, pv, f)]);
  const avgP = i => (v(i, 'qty') ? v(i, 'value') / v(i, 'qty') : null), per = i => (v(i, 'orders') ? v(i, 'qty') / v(i, 'orders') : null);
  const maxBar = Math.max(1, ...P.map((_, i) => v(i, dm)));
  const lastP = E.periods[last];
  const sub = el('p', { class: 'muted small', id: 'lataItemSub' }, 'Wczytywanie przebiegu ' + (d.group === 'month' ? 'miesięcznego' : d.group === 'week' ? 'tygodniowego' : 'dziennego') + '…');
  const chartHost = el('div', { id: 'lataItemChart' }, loadingBox('Liczenie przebiegu produktu…'));
  box.replaceChildren(el('section', { class: 'card rp-card rp-item', id: 'lataItem' },
    el('div', { class: 'rp-head' }, el('div', null, el('span', { class: 'rp-eyebrow' }, 'Produkt' + (it.key ? ' · ID ' + it.key : '') + (it.code ? ' · kod ' + it.code : '')), el('h2', { id: 'lataItemTitle' }, it.name)), el('span', { class: 'rp-grow' }),
      it.key ? el('a', { href: '#/produkty/' + encodeURIComponent(it.key), class: 'btn-link', title: 'Otwiera kartę produktu w panelu' }, 'Karta produktu') : null,
      it.key ? el('a', { href: '#/zamowienia?product=' + encodeURIComponent(it.key) + '&pname=' + encodeURIComponent(it.name) + '&from=' + lastP.from + '&to=' + lastP.to, class: 'btn-link', title: 'Zamówienia zawierające ten produkt w okresie bieżącym (' + rangeOf(last) + ')' }, 'Zamówienia z produktem (' + P[last].label + ')') : null,
      el('button', { type: 'button', class: 'secondary', id: 'lataItemClose', 'aria-label': 'Zamknij kartę produktu', title: 'Zamknij kartę produktu', onclick: () => c.setQ({ item: '' }, true) }, '✕')),
    el('div', { class: 'rp-tiles' }, kp('Sztuki', 'Suma sprzedanych sztuk tego produktu', v(last, 'qty'), cmp ? v(prev, 'qty') : null, qty), kp('Wartość', 'Suma wartości pozycji produktu (bez dostawy)', v(last, 'value'), cmp ? v(prev, 'value') : null, zl0),
      kp('Zamówienia', 'W ilu zamówieniach wystąpił produkt', v(last, 'orders'), cmp ? v(prev, 'orders') : null, int), kp('Średnia cena', 'Wartość podzielona przez liczbę sztuk', avgP(last), cmp ? avgP(prev) : null, zl),
      kp('Sztuk na zamówienie', 'Średnia liczba sztuk produktu w jednym zamówieniu', per(last), cmp ? per(prev) : null, qty)),
    el('div', { class: 'rp-grid2' }, el('div', null, el('h3', null, dmLabel + ' w okresach'), el('div', { class: 'rp-bars' }, P.map((p, i) => el('div', { class: 'rp-barrow' }, el('span', null, swatch(i, n), p.label), el('div', { class: 'rp-bartrack' }, el('div', { style: 'width:' + (v(i, dm) / maxBar * 100) + '%;background:' + style(i, n).color })), el('b', null, dmFmt(v(i, dm))))))),
      el('div', null, el('h3', null, dmLabel + (d.group === 'month' ? ' miesiącami' : d.group === 'week' ? ' tygodniami' : ' dniami')), sub, chartHost))));
  if (!it.key) { chartHost.replaceChildren(el('p', { class: 'muted' }, 'Produkt bez ID — przebieg miesięczny niedostępny.')); sub.textContent = ''; return; }
  const my = box.dataset.seq = String((Number(box.dataset.seq) || 0) + 1);
  c.api('reports:product', { pid: it.key, periods: E.periods.map(periodReq), statusIds: E.ids, group: d.group }).then(r => {
    if (!box.isConnected || box.dataset.seq !== my) return;
    const idx = { qty: 0, value: 1, orders: 2 }[dm], N = Math.max(...r.periods.map(p => p.buckets.length)), ref = E.periods[0];
    const labels = Array.from({ length: N }, (_, k) => slotLabels(d.group, ref).short(k));
    const series = r.periods.map((p, i) => ({ name: P[i].label + ' (' + roleOf(i, n) + ')', values: p.buckets.map((b, k) => (k > P[i].last ? null : b[idx])), ...style(i, n) }));
    chartHost.replaceChildren(lineChart({ labels, series, fmt: dmFmt, id: 'lataItemLine', aria: 'Wykres liniowy: ' + dmLabel + ' produktu ' + it.name + ' w okresach' }));
    const off = r.periods.map((p, i) => ({ name: P[i].label, sum: p[['qty', 'value', 'orders'][idx]], want: v(i, dm) })).filter(o => Math.abs(o.sum - o.want) > Math.max(0.5, o.want * 0.001));
    sub.textContent = off.length ? 'Każda linia to jeden okres. Uwaga: suma przedziałów różni się od liczby w tabeli (' + off.map(o => o.name + ': ' + dmFmt(o.sum) + ' vs ' + dmFmt(o.want)).join(', ') + ') — produkt mógł nie mieścić się w liście najlepszych.' : 'Każda linia to jeden okres. Suma przedziałów = liczba okresu ✓';
  }).catch(err => { if (box.isConnected) { chartHost.replaceChildren(); sub.textContent = 'Nie udało się wczytać przebiegu: ' + err.message; } });
  box.scrollIntoView && setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
}
