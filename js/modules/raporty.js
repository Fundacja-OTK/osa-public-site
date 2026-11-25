// Raporty sprzedaży (zastępują ekran Selly „Raporty sprzedaży” i „Analizę OSA” z rozszerzenia). Dane z D1 (akcje reports:sales / reports:years / reports:product).
// Dwa widoki: „Okres” (okres kontra poprzedni okres albo ten sam okres rok temu) i „Lata” (kilka lat obok siebie: wykres rok do roku, mapa miesięcy, produkty).
// Cały stan raportu siedzi w adresie (#/raporty?od=…&do=…&cmp=…): link można wysłać dalej, a „wstecz / dalej” w przeglądarce działa.
// Na górze zawsze pasek „co oglądasz”: zakres, porównanie, statusy, grupowanie — każdy element to przycisk otwierający odpowiednie ustawienie.
import { el, isUnavailable, loadingBox, syncedLabel, sortTh, downloadMenuButton, menuButton, dateRange, pageToolbar, isoDate, sellyLink, filterLayout, filterSection, columnMenu } from '../core/ui.js?v=a2fbbbf';
import { api, ctx } from '../core/client.js?v=a2fbbbf';
import { go } from '../core/router.js?v=a2fbbbf';
import { wojLabel } from '../core/osa.js?v=a2fbbbf';
import { shortcuts } from '../core/shortcuts.js?v=a2fbbbf';
import { svg, zl, zl0, int, qty, ddmm, dmy, addDays, addYears, daysBetween, validIso, rangeText, daysText, deltaEl, pctText, pctFmt, niceMax, tile, MONTHS_LONG } from './raportyKit.js?v=a2fbbbf';
import { zyskRender } from './raportyZysk.js?v=a2fbbbf';
import { costShown, costValue, costDefs, costBar, costTip, costLegend } from './chartCost.js?v=a2fbbbf';
import { lataPeriods, lataRequest, lataRender, lataSummary } from './raportyLata.js?v=a2fbbbf';
import { rodzinyFetch, rodzinyRender } from './raportyRodziny.js?v=a2fbbbf';
import { zestawFetch, zestawRender, parseSet } from './raportyZestaw.js?v=a2fbbbf';

/** Domyślne wartości ustawień — w adresie zapisujemy tylko to, co się od nich różni. */
const DEF = { v: 'okres', od: '', do: '', cmp: 'prev', gr: 'auto', st: '', tab: 'series', met: 'value', yf: '', yt: '', per: 'year', ss: '10', ytd: '1', lm: 'value', cm: 'monthly', dim: 'payments', dm: 'qty', q: '', so: '', item: '', fam: '', set: '', fm: '', sum: '' };
const OK = { v: ['okres', 'lata', 'zysk', 'rodziny', 'zestaw'], fm: ['qty', 'value', 'orders', 'avg'], sum: ['0', '1'], cmp: ['prev', 'year', 'off'], gr: ['auto', 'day', 'week', 'month'], met: ['value', 'orders', 'avg'], per: ['year', 'season', 'window'], ytd: ['1', '0'], lm: ['value', 'orders', 'avg', 'units', 'ship'], cm: ['monthly', 'cumulative'], dim: ['payments', 'deliveries', 'statuses', 'categories', 'producers'], dm: ['qty', 'value', 'orders'] };
/** Ustawienia, których zmiana wymaga ponownego policzenia raportu (reszta to tylko widok: zakładka, sortowanie, szukanie). */
const isYears = v => v === 'lata' || v === 'rodziny';
const dataKeys = Q => { const y = ['v', 'yf', 'yt', 'per', 'ss', 'ytd', 'gr', 'st'].concat(Q.per === 'window' ? ['od', 'do'] : []); return Q.v === 'lata' ? y : Q.v === 'rodziny' ? y.concat('fam') : Q.v === 'zestaw' ? ['v', 'od', 'do', 'gr', 'st', 'set'] : ['v', 'od', 'do', 'cmp', 'gr', 'st']; };
/** Grupy ustawień pokazywane w pasku i w podświetleniu „co się zmieniło”. */
const GROUP_OF = { v: 'view', od: 'range', do: 'range', yf: 'range', yt: 'range', per: 'range', ss: 'range', ytd: 'range', fam: 'view', set: 'view', cmp: 'cmp', st: 'status', gr: 'group' };
const GROUP_NAME = { view: 'widok', range: 'zakres', cmp: 'porównanie', status: 'statusy', group: 'grupowanie' };

const S = { root: null, built: false, alive: false, Q: { ...DEF }, E: null, dataKey: '', data: null, seq: 0, timer: 0, shown: null, changed: new Set(), statuses: null, ui: {} };

const GROUPS = [['auto', 'Automatycznie', 'Dni dla krótkich zakresów, tygodnie dla średnich, miesiące dla długich'], ['day', 'Dni', 'Jedna pozycja na dzień'], ['week', 'Tygodnie', 'Tygodnie ISO od poniedziałku (z numerami tygodni w widoku „Lata” i porównaniach)'], ['month', 'Miesiące', 'Miesiące kalendarzowe']];
const GROUP_WORD = { day: 'dni', week: 'tygodnie', month: 'miesiące' };
const METRICS = [['value', 'Wartość', 'Suma wartości zamówień (pozycje + dostawa, brutto)'], ['orders', 'Zamówienia', 'Liczba zamówień'], ['avg', 'Średni koszyk', 'Wartość zamówień podzielona przez ich liczbę']];
const CMP_OPTS = [['prev', 'Poprzedni okres (tyle samo dni)', 'Okres o tej samej długości, bezpośrednio przed wybranym'], ['year', 'Ten sam okres rok temu', 'Te same dni kalendarzowe rok wcześniej'], ['off', 'Bez porównania', 'Tylko wybrany okres']];

// ─── Stan ↔ adres ───────────────────────────────────────────────────────────

function readQ(query) {
  const Q = { ...DEF };
  for (const k of Object.keys(DEF)) {
    const v = (query && query.get(k)) || '';
    if (!v) continue;
    const ok = OK[k] ? OK[k].includes(v) : (k === 'od' || k === 'do') ? validIso(v) : (k === 'yf' || k === 'yt') ? /^\d{4}$/.test(v) : k === 'ss' ? /^(1[0-2]|[1-9])$/.test(v) : k === 'so' ? /^\w+:(asc|desc)$/.test(v) : true;
    if (ok) Q[k] = v;
  }
  return Q;
}
const qsOf = Q => { const p = new URLSearchParams(); for (const k of Object.keys(DEF)) if (Q[k] !== DEF[k]) p.set(k, Q[k]); const s = p.toString(); return s ? '?' + s : ''; };
/** Zmiana ustawienia = nowy adres (cofnięcie przeglądarki wraca do poprzedniego widoku); replace — bez wpisu w historii (zakładki, sortowanie). */
function setQ(patch, replace) {
  const n = { ...S.Q, ...patch };
  const h = '/raporty' + qsOf(n);
  if (location.hash === '#' + h) { S.Q = n; sync(); } else go(h, replace ? { replace: true } : undefined);
}
const isDefault = Q => Object.keys(DEF).every(k => Q[k] === DEF[k]);

/** Ustawienia po uwzględnieniu domyślnych (zakres = ostatnie 30 dni, lata = 3 ostatnie). */
function effective(Q) {
  const today = isoDate(new Date());
  let to = validIso(Q.do) ? Q.do : today, from = validIso(Q.od) ? Q.od : addDays(to, Q.v === 'zestaw' ? -89 : -29);
  if (from > to) [from, to] = [to, from];
  const days = daysBetween(from, to), ids = Q.st ? Q.st.split(',').filter(Boolean) : [];
  const now = new Date(), E = { v: Q.v, from, to, days, today, ids, defaultRange: !Q.od && !Q.do, cmp: Q.cmp, group: Q.gr, nowTime: [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':') };
  if (!isYears(Q.v)) {
    const [pf, pt] = Q.cmp === 'year' ? [addYears(from, -1), addYears(to, -1)] : [addDays(from, -days), addDays(from, -1)];
    Object.assign(E, { prevFrom: pf, prevTo: pt });
  } else {
    const cy = Number(today.slice(0, 4));
    E.yt = Number(Q.yt) || cy; E.yf = Number(Q.yf) || E.yt - 2;
    if (E.yf > E.yt) [E.yf, E.yt] = [E.yt, E.yf];
    if (E.yt - E.yf > 11) E.yf = E.yt - 11;
    Object.assign(E, { per: Q.per, ss: Number(Q.ss), ytd: Q.ytd === '1' });
    E.periods = lataPeriods(E);
  }
  return E;
}
const autoGroup = days => (days <= 62 ? 'day' : days <= 400 ? 'week' : 'month');

// ─── Pasek „co oglądasz” ────────────────────────────────────────────────────

function statusPhrase() {
  const st = S.statuses, ids = S.E.ids;
  if (!st) return ids.length ? { text: 'wybrane statusy (' + ids.length + ')', tip: 'Liczone są zamówienia w ' + ids.length + ' wybranych statusach.' } : { text: 'wszystkie poza anulowanymi', tip: 'Liczone są zamówienia we wszystkich statusach poza anulowanymi.' };
  const sel = st.filter(s => s.selected), nc = st.filter(s => !s.cancelled), n = ' (' + sel.length + ' z ' + st.length + ')';
  if (sel.length === nc.length && sel.every(s => !s.cancelled)) return { text: 'wszystkie poza anulowanymi' + n, tip: 'Liczone są zamówienia we wszystkich statusach poza anulowanymi: ' + sel.map(s => s.name).join(', ') + '.' };
  if (sel.length === st.length) return { text: 'wszystkie, także anulowane' + n, tip: 'Liczone są zamówienia we wszystkich statusach, także anulowanych.' };
  if (sel.length <= 3) return { text: 'tylko: ' + sel.map(s => s.name).join(', ') + n, tip: 'Liczone statusy: ' + sel.map(s => s.name).join(', ') + '.' };
  return { text: 'wybrane statusy' + n, tip: 'Liczone statusy (' + sel.length + '): ' + sel.map(s => s.name).join(', ') + '.' };
}

/** Elementy paska: [{ k (grupa ustawień), text, tip, sw (znacznik koloru: cur | cmp) }]. */
function summaryParts() {
  const E = S.E, d = S.data && S.data.kind === E.v ? S.data : null, sp = statusPhrase();
  if (isYears(E.v) && (E.v === 'lata' || (d && d.mode === 'years'))) { const parts = lataSummary(E, d && d.group ? d : null, sp, GROUP_WORD); return E.v === 'rodziny' ? [{ k: 'view', text: 'Rodzina: ' + d.family.name, tip: 'Rodzina produktów oglądana rok do roku. Kliknij, aby zmienić widok.' }, ...parts] : parts; }
  if (E.v === 'rodziny') return [{ k: 'view', text: 'Rodziny produktów', tip: 'Wybierz rodzinę, aby zobaczyć ją rok do roku.' }, { k: 'status', text: 'statusy: ' + sp.text, tip: sp.tip }];
  if (E.v === 'zestaw') { const g = d && d.group ? d.group : E.group === 'auto' ? autoGroup(E.days) : E.group, n = parseSet(S.Q.set).length; return [
    { k: 'view', text: 'Zestaw: ' + n + ' elem.', tip: 'Liczba produktów / rodzin / kategorii w porównaniu. Zestaw jest zapisany w adresie.' },
    { k: 'range', sw: 'cur', text: 'Sprzedaż ' + rangeText(E.from, E.to) + ' (' + daysText(E.days) + ')', tip: 'Zakres dat porównania. Kliknij, aby zmienić daty.' },
    { k: 'status', text: 'statusy: ' + sp.text, tip: sp.tip + ' Kliknij, aby zmienić.' },
    { k: 'group', text: 'grupowanie: ' + GROUP_WORD[g] + (E.group === 'auto' ? ' (auto)' : ''), tip: 'Na jakie przedziały dzielimy czas na wykresie' }]; }
  const g = d ? d.range.group : E.group === 'auto' ? autoGroup(E.days) : E.group;
  const cmpTip = E.cmp === 'off' ? 'Porównanie jest wyłączone — pokazujemy tylko wybrany okres. Włączysz je w ustawieniach.' : 'Okres porównawczy — z nim zestawiane są wszystkie liczby i wykres (' + (E.cmp === 'year' ? 'te same dni rok wcześniej' : 'tyle samo dni bezpośrednio przed wybranym okresem') + '). Na wykresie to linia przerywana.';
  return [
    { k: 'range', sw: 'cur', text: (E.v === 'zysk' ? 'Zysk i marża ' : 'Sprzedaż ') + rangeText(E.from, E.to) + ' (' + daysText(E.days) + ')', tip: 'Okres bieżący — to, co pokazuje raport (słupki w kolorze brązowym). Kliknij, aby zmienić daty.' },
    { k: 'cmp', sw: E.cmp === 'off' ? null : 'cmp', text: E.cmp === 'off' ? 'bez porównania' : 'porównanie z ' + rangeText(E.prevFrom, E.prevTo) + (E.cmp === 'year' ? ' (rok temu)' : ' (poprzedni okres)'), tip: cmpTip },
    { k: 'status', text: 'statusy: ' + sp.text, tip: sp.tip + ' Kliknij, aby zmienić.' },
    { k: 'group', text: 'grupowanie: ' + GROUP_WORD[g] + (E.group === 'auto' ? ' (auto)' : ''), tip: 'Na jakie przedziały dzielimy czas na wykresie i w tabeli „Sprzedaż w czasie”' + (E.group === 'auto' ? ' — wybrane automatycznie na podstawie długości zakresu.' : '.') },
  ];
}
const sentence = () => summaryParts().map(p => p.text).join(' · ');

function renderSummary() {
  const box = S.ui.summary;
  if (!box) return;
  box.replaceChildren(el('div', { class: 'rp-sum-title muted' }, 'Co oglądasz'), granSwitch(),
    ...summaryParts().map((p, i) => [i ? el('span', { class: 'rp-dot', 'aria-hidden': 'true' }, '·') : null,
      el('button', { type: 'button', class: 'rp-chip tip' + (S.changed.has(p.k) ? ' chg' : ''), 'data-k': p.k, title: p.tip + (S.changed.has(p.k) ? ' (zmienione przed chwilą)' : ''), onclick: () => focusSetting(p.k) },
        p.sw ? el('i', { class: 'rp-sw ' + p.sw, 'aria-hidden': 'true' }) : null, p.text)]).flat(),
    S.changed.size ? el('span', { class: 'rp-changed', role: 'status' }, 'Zmieniono: ' + [...S.changed].map(k => GROUP_NAME[k]).join(', ')) : null);
  document.querySelectorAll('#rpSettings [data-sec]').forEach(f => f.classList.toggle('chg', S.changed.has(f.dataset.sec)));
}

/** Przełącznik ziarnistości osi czasu (dzień / tydzień / miesiąc) w pasku „co oglądasz”; stan w adresie (gr=). */
function granSwitch() {
  const E = S.E, d = S.data && S.data.kind === E.v ? S.data : null;
  if (E.v === 'zysk' && false) return null;
  const eff = E.group !== 'auto' ? E.group : d && (d.group || (d.range && d.range.group)) ? (d.group || d.range.group) : E.v === 'lata' || E.v === 'rodziny' ? 'month' : autoGroup(E.days);
  return el('span', { class: 'rp-segs rp-gran', id: 'rpGran', role: 'group', 'aria-label': 'Ziarnistość osi czasu' }, [['day', 'Dzień', 'Jedna pozycja na dzień'], ['week', 'Tydzień', 'Tygodnie ISO (poniedziałek = początek), z numerami tygodni; bieżący niepełny tydzień porównywany do tego samego dnia tygodnia i godziny'], ['month', 'Miesiąc', 'Miesiące kalendarzowe']]
    .map(([k, l, t]) => el('button', { type: 'button', class: 'rp-seg', 'data-gr': k, 'aria-pressed': String(eff === k), title: t, onclick: () => setQ({ gr: k }) }, l)));
}

function focusSetting(k) {
  const u = S.ui;
  if (!u.layout.isOpen()) toggleSettings(true);
  const sec = [...u.panelEl.querySelectorAll('[data-sec="' + k + '"]')].find(n => n.offsetParent !== null) || u.panelEl.querySelector('[data-sec="' + k + '"]');
  if (!sec) return;
  const fold = sec.closest('details');
  if (fold) fold.open = true;
  sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const f = sec.matches('input,select,button') ? sec : sec.querySelector('input,select,button');
  if (f) f.focus({ preventScroll: true });
  sec.classList.add('flash'); setTimeout(() => sec.classList.remove('flash'), 1600);
}

// ─── Okres: kafelki, wykres, tabele ─────────────────────────────────────────

function legendNode(d, id) {
  const r = d.range;
  return el('div', { class: 'rp-legend', id, role: 'group', 'aria-label': 'Oznaczenia kolorów' },
    el('span', { class: 'tip', title: 'Okres bieżący — to, co wybrano w ustawieniach. Na wykresie: słupki.' }, el('i', { class: 'rp-sw cur' }), el('b', null, 'bieżący '), rangeText(r.from, r.to)),
    r.compare ? el('span', { class: 'tip', title: 'Okres porównawczy — z nim zestawiana jest każda liczba. Na wykresie: linia przerywana.' }, el('i', { class: 'rp-sw cmp' }), el('b', null, 'porównanie '), rangeText(r.prevFrom, r.prevTo))
      : el('span', { class: 'muted tip', title: 'Porównanie jest wyłączone w ustawieniach.' }, 'porównanie wyłączone'));
}

function tiles(d) {
  const c = d.summary.cur, p = d.summary.prev, r = d.range, cmp = r.compare;
  const prevLine = (txt, tip) => el('div', { class: 'rp-prevline tip', title: tip }, el('i', { class: 'rp-sw cmp' }), 'porównanie: ' + txt);
  const t = (k, label, tip, main, pv, fmt, cur) => tile(k, label, tip, main, [cmp && pv != null ? prevLine(fmt(pv), 'Wartość w okresie porównawczym ' + rangeText(r.prevFrom, r.prevTo)) : null,
    deltaEl(cur, pv, { fmt, cmp, curLabel: rangeText(r.from, r.to), prevLabel: cmp ? rangeText(r.prevFrom, r.prevTo) : '' })]);
  const ss = statusPhrase().tip;
  return el('div', { class: 'rp-tiles', id: 'rpKpi' },
    t('value', 'Sprzedaż', 'Suma wartości zamówień w okresie bieżącym (pozycje + dostawa, brutto). ' + ss, zl0(c.value), p && p.value, zl0, c.value),
    t('orders', 'Zamówienia', 'Liczba zamówień złożonych w okresie bieżącym. ' + ss, int(c.orders), p && p.orders, int, c.orders),
    t('avg', 'Średni koszyk', 'Wartość sprzedaży podzielona przez liczbę zamówień.', zl(c.avg), p && p.avg, zl, c.avg),
    t('customers', 'Klienci', 'Liczba różnych klientów (adresów e-mail), którzy złożyli zamówienia w okresie bieżącym. Dla okresu porównawczego tej liczby nie liczymy (oszczędza odczyty bazy).', int(c.customers), null, int, c.customers),
    t('units', 'Sprzedane sztuki', 'Suma ilości produktów we wszystkich liczonych zamówieniach okresu bieżącego. Dla okresu porównawczego tej liczby nie liczymy.', qty(c.units), null, qty, c.units));
}

function bucketLabel(key, group) {
  if (!key) return '—';
  if (group === 'month') return key.slice(5, 7) + '.' + key.slice(0, 4);
  if (group === 'week') return ddmm(key) + '–' + ddmm(addDays(key, 6));
  return ddmm(key);
}

function chart(d, metric) {
  const W = 760, H = 260, L = 58, R = 10, T = 10, B = 30, iw = W - L - R, ih = H - T - B;
  const valOf = (s, prev) => (metric === 'orders' ? (prev ? s.prevOrders : s.orders) : metric === 'avg' ? (prev ? (s.prevOrders ? s.prevValue / s.prevOrders : 0) : s.avg) : (prev ? s.prevValue : s.value));
  const cmp = d.range.compare, g = d.range.group;
  const vals = d.series.map(s => valOf(s)), pv = d.series.map(s => valOf(s, true));
  const withCost = metric === 'value' && costShown() && d.series.some(s => s.cost);   // słupek kosztu zakupu w słupku wartości (chartCost.js)
  const max = niceMax(Math.max(...vals, ...(cmp ? pv : []), ...(withCost ? d.series.map(s => costValue(s.cost)) : []), 0));
  const fmt = metric === 'orders' ? v => String(Math.round(v)) : zl0;
  const label = METRICS.find(m => m[0] === metric)[1];
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rp-svg', role: 'img', 'aria-label': 'Wykres: ' + label + ' w okresie bieżącym ' + rangeText(d.range.from, d.range.to) + (cmp ? ', z porównaniem do ' + rangeText(d.range.prevFrom, d.range.prevTo) : '') + '. Te same dane są w tabeli „Sprzedaż w czasie”.' });
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - ih * i / 4;
    s.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'rp-grid' }), svg('text', { x: L - 6, y: y + 4, class: 'rp-axis', 'text-anchor': 'end' }, fmt(max * i / 4)));
  }
  const n = d.series.length, bw = iw / n, tip = el('div', { class: 'rp-tip', hidden: true }), hatch = withCost ? costDefs(svg) : null;
  if (hatch) s.append(hatch.defs);
  const wrap = el('div', { class: 'rp-chart-wrap', id: 'rpChart' }, s, tip);
  const every = Math.max(1, Math.ceil(n / 12)), pts = [];
  d.series.forEach((x, i) => {
    const v = vals[i], h = max ? ih * v / max : 0, bx = L + i * bw;
    const gEl = svg('g', { class: 'rp-barg', 'data-key': x.key });
    gEl.append(svg('rect', { x: bx, y: T, width: bw, height: ih, class: 'rp-hit' }),
      svg('rect', { x: bx + bw * 0.14, y: T + ih - h, width: Math.max(bw * 0.72, 1), height: Math.max(h, v > 0 ? 1.5 : 0), rx: Math.min(3, bw * 0.2), class: 'rp-bar' + (v ? '' : ' zero') }),
      withCost ? costBar(svg, { x: bx + bw * 0.14, w: Math.max(bw * 0.72, 1), base: T + ih, k: max ? ih / max : 0, barH: h, top: T, cost: x.cost, hatch: hatch.fill }) : null);
    const show = () => {
      tip.replaceChildren(el('strong', null, 'bieżący: ' + bucketLabel(x.key, g) + (g === 'day' ? '.' + x.key.slice(0, 4) : '')),
        el('div', null, int(x.orders) + ' zam. · ' + zl(x.value)), ...(withCost ? costTip(x.cost, { value: x.value, withShipping: true }) : []), el('div', null, 'średni koszyk: ' + zl(x.avg)),
        cmp ? el('div', { class: 'rp-tip-cmp' }, 'porównanie (' + bucketLabel(x.prevKey, g) + '): ' + int(x.prevOrders) + ' zam. · ' + zl(x.prevValue)) : null);
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((bx + bw / 2) / W * 100, 14), 86) + '%';
    };
    gEl.addEventListener('mouseenter', show); gEl.addEventListener('focus', show);
    gEl.addEventListener('mouseleave', () => { tip.hidden = true; });
    s.append(gEl);
    pts.push([bx + bw / 2, T + ih - (max ? ih * pv[i] / max : 0)]);
    if (i % every === 0) s.append(svg('text', { x: bx + bw / 2, y: H - 9, class: 'rp-axis', 'text-anchor': 'middle' }, bucketLabel(x.key, g)));
  });
  if (cmp && n > 1) s.append(svg('polyline', { points: pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '), class: 'rp-prev' }));
  if (cmp && n <= 45) for (const p of pts) s.append(svg('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 2.6, class: 'rp-prev-dot' }));
  return wrap;
}

function chartCard(d) {
  const segs = el('div', { class: 'rp-segs', role: 'group', 'aria-label': 'Co pokazać na wykresie' });
  for (const [k, label, tip] of METRICS) segs.append(el('button', { type: 'button', class: 'rp-seg', 'data-metric': k, 'aria-pressed': String(S.Q.met === k), title: tip, onclick: () => setQ({ met: k }, true) }, label));
  const legend = legendNode(d, null);
  const card = el('section', { class: 'card rp-card' }, el('div', { class: 'rp-head' }, el('h2', null, 'Sprzedaż w czasie'), segs), legend, el('div', { id: 'rpChartBody' }, chart(d, S.Q.met)));
  const cl = S.Q.met === 'value' ? costLegend(d.series.map(x => x.cost), () => card.replaceWith(chartCard(d)), 'rpCostLegend') : null;
  if (cl) legend.append(cl);
  return card;
}

/** Definicje zakładek: kolumny (klucz, nagłówek, tooltip, typ) i wiersze z odpowiedzi serwera. */
function tabs(d) {
  const g = d.range.group, r = d.range, cmp = r.compare, cur = 'Okres bieżący (' + rangeText(r.from, r.to) + '). ', cm = cmp ? 'Okres porównawczy (' + rangeText(r.prevFrom, r.prevTo) + '). ' : '';
  const valueCol = { key: 'value', label: 'Wartość', num: true, tip: cur + 'Suma wartości zamówień (pozycje + dostawa, brutto)', fmt: zl, bar: true, type: 'number' };
  const ordersCol = { key: 'orders', label: 'Zamówienia', num: true, tip: cur + 'Liczba zamówień', fmt: int, type: 'number' };
  const avgCol = { key: 'avg', label: 'Średni koszyk', num: true, tip: cur + 'Wartość podzielona przez liczbę zamówień', fmt: zl, type: 'number' };
  const nameCol = (label, tip) => ({ key: 'name', label, tip: tip || label, text: true, type: 'text', locked: true });
  const prodCols = [{ key: 'qty', label: 'Sztuki', num: true, tip: cur + 'Suma ilości sprzedanych sztuk', fmt: qty, type: 'number' }, { key: 'orders', label: 'Zamówienia', num: true, tip: cur + 'W ilu zamówieniach wystąpił produkt', fmt: int, type: 'number' },
    { ...valueCol, tip: cur + 'Suma wartości pozycji produktu (bez dostawy)' }];
  return {
    series: { label: 'Sprzedaż w czasie', tip: 'Wartość, liczba zamówień i średni koszyk w kolejnych ' + (g === 'month' ? 'miesiącach' : g === 'week' ? 'tygodniach' : 'dniach') + ' — z odpowiednikiem z okresu porównawczego',
      cols: [{ key: 'label', label: g === 'month' ? 'Miesiąc' : g === 'week' ? 'Tydzień (pon.–niedz.)' : 'Dzień', tip: 'Przedział okresu bieżącego', text: true, type: 'text', locked: true }, ordersCol, valueCol, { ...avgCol, adv: true },
        ...(cmp ? [{ key: 'prevLabel', label: 'Porównanie: przedział', tip: cm + 'Przedział, z którym zestawiono wiersz', text: true, type: 'text', adv: true },
          { key: 'prevOrders', label: 'Porównanie: zamówienia', num: true, tip: cm + 'Liczba zamówień w odpowiadającym przedziale', fmt: int, type: 'number', adv: true },
          { key: 'prevValue', label: 'Porównanie: wartość', num: true, tip: cm + 'Wartość w odpowiadającym przedziale', fmt: zl, type: 'number' },
          { key: 'diff', label: 'Zmiana (zł)', num: true, tip: 'Wartość bieżąca minus wartość z porównania, ze znakiem', fmt: v => (v > 0 ? '+' : v < 0 ? '−' : '') + zl(Math.abs(v)), type: 'number' },
          { key: 'delta', label: 'Zmiana (%)', num: true, tip: 'Zmiana wartości względem porównania. „—”, gdy w porównaniu było 0 (nie da się policzyć %)', fmt: pctFmt, type: 'number' }] : [])],
      rows: d.series.map(s => ({ ...s, label: bucketLabel(s.key, g), prevLabel: bucketLabel(s.prevKey, g), diff: Math.round((s.value - s.prevValue) * 100) / 100, delta: pctText(s.value, s.prevValue) })), first: { sort: 'key', dir: 'asc' } },
    products: { label: 'Produkty', tip: 'Najlepiej sprzedające się produkty w okresie bieżącym' + (d.productsTotal > d.products.length ? ' (pokazano ' + d.products.length + ' z ' + d.productsTotal + ')' : ''),
      cols: [{ ...nameCol('Produkt'), link: x => (x.id ? '#/produkty/' + encodeURIComponent(x.id) : null) }, { key: 'code', label: 'Kod', tip: 'Kod producenta', text: true, type: 'text', adv: true }, ...prodCols], rows: d.products },
    categories: { label: 'Kategorie', tip: 'Sprzedaż wg kategorii produktu (kategoria główna z karty produktu)', cols: [nameCol('Kategoria'), { key: 'products', label: 'Produkty', num: true, tip: 'Ile różnych produktów z tej kategorii sprzedano', fmt: int, type: 'number', adv: true }, ...prodCols.slice(0, 1), valueCol], rows: d.categories },
    producers: { label: 'Producenci', tip: 'Sprzedaż wg producenta produktu', cols: [nameCol('Producent'), { key: 'products', label: 'Produkty', num: true, tip: 'Ile różnych produktów tego producenta sprzedano', fmt: int, type: 'number', adv: true }, ...prodCols.slice(0, 1), valueCol], rows: d.producers },
    statuses: { label: 'Statusy', tip: 'Wszystkie zamówienia okresu wg statusu — także te, których nie liczą kafelki (kolumna „Liczone”)',
      cols: [{ ...nameCol('Status'), link: x => '#/zamowienia?status=' + encodeURIComponent(x.id) }, { key: 'counted', label: 'Liczone', tip: 'Czy zamówienia w tym statusie wchodzą do sum (wg ustawienia „Które zamówienia liczyć”)', text: true, fmt: v => (v ? 'tak' : 'nie'), type: 'text', locked: true }, ordersCol, valueCol], rows: d.byStatus },
    payments: { label: 'Formy płatności', tip: 'Liczone zamówienia wg formy płatności', cols: [nameCol('Forma płatności'), ordersCol, valueCol, { ...avgCol, adv: true }], rows: d.payments },
    deliveries: { label: 'Formy dostawy', tip: 'Liczone zamówienia wg formy dostawy', cols: [nameCol('Forma dostawy'), ordersCol, valueCol, { ...avgCol, adv: true }], rows: d.deliveries },
    woj: { label: 'Województwa', tip: 'Liczone zamówienia wg województwa klienta: z notatki klienta, a gdy jej brak — przybliżone z kodu pocztowego dostawy',
      cols: [nameCol('Województwo', 'Województwo klienta (notatka orszaku albo kod pocztowy dostawy)'), { key: 'approx', label: 'Z kodu poczt.', num: true, tip: 'Ile zamówień przypisano do województwa tylko na podstawie kodu pocztowego (bez notatki klienta)', fmt: int, type: 'number', adv: true }, ordersCol, valueCol],
      rows: d.woj.map(w => ({ ...w, name: w.key ? wojLabel(w.key) : '— nie ustalono —' })) },
  };
}

const colMenus = {};
function tableCard(d) {
  const T = tabs(d), tab = T[S.Q.tab] ? S.Q.tab : 'series', def = T[tab];
  const [qs, qd] = S.Q.so ? S.Q.so.split(':') : [], known = def.cols.some(c => c.key === qs), first = def.first || { sort: def.cols.find(c => c.bar) ? 'value' : def.cols[0].key, dir: 'desc' };
  const sort = known ? qs : first.sort, dir = known ? qd : first.dir;
  const optional = def.cols.filter(c => !c.locked);
  const mkey = tab + ':' + def.cols.map(c => c.key).join();
  const cm = optional.length ? (colMenus[mkey] = colMenus[mkey] || columnMenu({ id: 'rpCols', storeKey: 'osa-rp-cols-' + tab, cols: def.cols.map(c => ({ key: c.key, label: c.label, tip: c.tip, locked: !!c.locked, def: !c.adv })), onChange: () => setQ({}, true) })) : null;
  const cols = def.cols.filter(c => !cm || c.locked || cm.isOn(c.key));
  const rows = def.rows.slice().sort((a, b) => {
    const x = a[sort], y = b[sort], ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;   // puste zawsze na końcu
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pl');
    return dir === 'asc' ? c : -c;
  });
  const max = Math.max(...def.rows.map(r => Number(r.value) || 0), 1);
  const head = el('tr', null, cols.map(c => sortTh({ label: c.label, sort: c.key, num: c.num, tip: c.tip, tipHeader: c.tip !== c.label, firstDir: c.num ? 'desc' : 'asc' }, { sort, dir }, (k, dd) => setQ({ so: k + ':' + dd }, true))));
  const tr = r => el('tr', { 'data-key': r.key || r.id || r.name }, cols.map(c => {
    const v = r[c.key], txt = c.fmt ? c.fmt(v, r) : v == null ? '' : String(v), href = c.link && c.link(r), inner = href ? el('a', { href }, txt) : txt;
    if (c.bar) return el('td', { class: 'n rp-vcell' }, el('span', { class: 'rp-vbar', style: 'width:' + Math.round((Number(v) || 0) / max * 100) + '%', 'aria-hidden': 'true' }), el('span', { class: 'rp-vnum' }, inner));
    const cls = (c.num ? 'n' : '') + (c.key === 'delta' || c.key === 'diff' ? (v > 0 ? ' rp-up' : v < 0 ? ' rp-down' : '') : '');
    return el('td', { class: cls || null }, inner);
  }));
  return el('section', { class: 'card rp-card', id: 'rpTables' },
    el('div', { class: 'rp-head' }, el('h2', null, def.label), el('span', { class: 'muted tip', title: def.tip }, def.rows.length + ' ' + (def.rows.length === 1 ? 'pozycja' : 'pozycji')),
      el('div', { class: 'rp-tabs', role: 'group', 'aria-label': 'Podział sprzedaży' }, Object.entries(T).map(([k, t]) => el('button', { type: 'button', class: 'chip', 'data-tab': k, 'aria-pressed': String(tab === k), title: t.tip, onclick: () => setQ({ tab: k, so: '' }, true) }, t.label))),
      el('span', { class: 'rp-grow' }), cm ? cm.node : null,
      downloadMenuButton('rpDl', () => exportTable(d, def, cols, rows, tab), null, !rows.length, { cls: 'secondary', label: 'Pobierz tabelę', title: 'Pobierz widoczną tabelę jako Excel albo CSV' })),
    rows.length ? el('div', { class: 'table-wrap rp-wrap' }, el('table', { id: 'rpTable', 'data-tab': tab }, el('thead', null, head), el('tbody', null, rows.map(tr))))
      : el('div', { class: 'empty' }, 'Brak danych w okresie ' + rangeText(d.range.from, d.range.to) + ' dla tej tabeli (statusy: ' + statusPhrase().text + ').'));
}

function exportTable(d, def, cols, rows, tab) {
  return { sheet: def.label, file: 'raport-sprzedazy-' + tab + '-' + d.range.from + '_' + d.range.to,
    columns: cols.map(c => ({ header: c.label, type: c.type === 'number' ? 'number' : 'text', width: c.text ? 28 : 14 })),
    rows: rows.map(r => cols.map(c => (c.type === 'number' ? (r[c.key] == null ? '' : Number(r[c.key]) || 0) : c.fmt ? c.fmt(r[c.key], r) : r[c.key] == null ? '' : r[c.key]))),
    note: 'Okres bieżący ' + dmy(d.range.from) + ' – ' + dmy(d.range.to) + (d.range.compare ? ' · porównanie ' + dmy(d.range.prevFrom) + ' – ' + dmy(d.range.prevTo) : ' · bez porównania') + ' · statusy: ' + statusPhrase().text + ' · dane z synchronizacji: ' + syncedLabel(d.syncedMs) };
}

function clientsCard(d) {
  const c = d.clients, tot = c.newOrders + c.returningOrders;
  const row = (id, label, tip, n, orders, value) => el('tr', { id }, el('th', { scope: 'row', class: 'tip', title: tip }, label), el('td', { class: 'n' }, int(n)), el('td', { class: 'n' }, int(orders)), el('td', { class: 'n' }, zl(value)),
    el('td', { class: 'n' }, tot ? Math.round(orders / tot * 100) + '%' : '—'));
  const th = (t, tip, n) => el('th', { class: n ? 'n' : null }, el('span', { class: 'tip', title: tip }, t));
  return el('section', { class: 'card rp-card', id: 'rpClients' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Powracający = klient, który miał zamówienie (poza anulowanymi) przed początkiem okresu bieżącego. Klient jest rozpoznawany po adresie e-mail. Liczone tylko dla okresu bieżącego.' }, 'Nowi i powracający klienci')),
    el('div', { class: 'table-wrap' }, el('table', { class: 'rp-small' }, el('thead', null, el('tr', null, th('Klienci', 'Grupa klientów w okresie bieżącym'), th('Osób', 'Ilu różnych klientów (adresów e-mail)', 1), th('Zamówień', 'Ile zamówień złożyła ta grupa', 1), th('Wartość', 'Suma wartości zamówień tej grupy', 1), th('Udział zamówień', 'Jaką część zamówień z adresem e-mail złożyła ta grupa', 1))),
      el('tbody', null, row('rpNew', 'Nowi', 'Pierwsze zamówienie w tym okresie', c.newCustomers, c.newOrders, c.newValue), row('rpRet', 'Powracający', 'Mieli zamówienie przed początkiem okresu', c.returning, c.returningOrders, c.returningValue)))),
    c.noEmailOrders ? el('p', { class: 'muted rp-note' }, c.noEmailOrders + ' zamówień bez adresu e-mail pominięto w tym podziale.') : null);
}

function emptyBox(what) {
  const widen = el('button', { type: 'button', class: 'secondary', id: 'rpWiden', title: 'Ustaw zakres na ostatnie 90 dni', onclick: () => { const t = isoDate(new Date()); setQ({ od: addDays(t, -89), do: t }); } }, 'Pokaż ostatnie 90 dni');
  return el('div', { class: 'card' }, el('div', { class: 'empty', id: 'rpEmpty' }, 'Brak zamówień w okresie ' + what + ' przy ustawieniu „statusy: ' + statusPhrase().text + '”.',
    el('p', { class: 'muted' }, 'Zmień zakres dat albo ustawienie statusów (np. dołącz anulowane) — przyciski w pasku powyżej.'), el('div', null, widen)));
}

function renderOkres(d) {
  const top = el('div', { class: 'rp-top muted' }, el('span', { class: 'tip', title: 'Dane z ostatniej synchronizacji z Selly. Wynik raportu jest zapamiętywany na 5 minut.' }, 'Dane z synchronizacji: ' + syncedLabel(d.syncedMs)));
  if (!d.summary.cur.orders) return [top, legendNode(d, 'rpLegend'), emptyBox(rangeText(d.range.from, d.range.to))];
  return [top, legendNode(d, 'rpLegend'), tiles(d), chartCard(d), tableCard(d), clientsCard(d)];
}

// ─── Ustawienia (panel po lewej) ────────────────────────────────────────────

const mk = (sec, label, tip, control) => el('label', { class: 'field-inline rp-field', 'data-sec': sec, title: tip }, label, control);

function presets() {
  const t = isoDate(new Date()), ms = t.slice(0, 8) + '01', pm = addDays(ms, -1), qStart = d => d.slice(0, 5) + String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0') + '-01';
  const qs = qStart(t), pqe = addDays(qs, -1), y = t.slice(0, 4), py = String(Number(y) - 1);
  return [['Dziś', t, t], ['Wczoraj', addDays(t, -1), addDays(t, -1)], ['Ostatnie 7 dni', addDays(t, -6), t], ['Ostatnie 30 dni', addDays(t, -29), t], ['Ostatnie 90 dni', addDays(t, -89), t],
    ['Ten miesiąc (do dziś)', ms, t], ['Poprzedni miesiąc', pm.slice(0, 8) + '01', pm], ['Ten kwartał (do dziś)', qs, t], ['Poprzedni kwartał', qStart(pqe), pqe], ['Ten rok (do dziś)', y + '-01-01', t], ['Poprzedni rok', py + '-01-01', py + '-12-31'],
    ['Ostatnie 12 miesięcy', addDays(addYears(t, -1), 1), t]];
}

function buildSettings() {
  const u = S.ui;
  u.range = dateRange({ idFrom: 'rpFrom', idTo: 'rpTo', from: '', to: '', labelFrom: 'Od dnia', labelTo: 'Do dnia', titleFrom: 'Pierwszy dzień okresu bieżącego', titleTo: 'Ostatni dzień okresu bieżącego (włącznie)',
    onChange: ({ from, to }) => { if (from && to) { clearTimeout(S.timer); S.timer = setTimeout(() => setQ({ od: from, do: to }), 250); } } });
  u.range.menu.remove();   // własne gotowe zakresy — z dokładnymi datami
  u.presets = menuButton({ id: 'rpFromPresets', label: 'Gotowe zakresy', cls: 'secondary small', title: 'Gotowe zakresy dat — przy każdym widać dokładne daty', items: () => presets().map(([label, a, b]) => ({ label: label + ' · ' + rangeText(a, b), title: 'Ustaw zakres ' + rangeText(a, b), run: () => setQ({ od: a, do: b }) })) });
  const cy = Number(isoDate(new Date()).slice(0, 4)), years = Array.from({ length: 11 }, (_, i) => cy - i);
  const sel = (id, opts, onch, title) => el('select', { id, 'aria-label': title, onchange: ev => onch(ev.target.value) }, opts.map(([v, l, t]) => el('option', { value: v, title: t || null }, l)));
  u.viewSeg = el('div', { class: 'rp-viewsw', role: 'group', 'aria-label': 'Widok raportu' }, [['okres', 'Okres', 'Jeden okres zestawiony z poprzednim okresem albo z rokiem wcześniej: kafelki, wykres, tabele, klienci'], ['lata', 'Lata (rok do roku)', 'Kilka lat obok siebie: wykres miesięczny rok do roku, mapa miesięcy, kategorie, produkty z kartą szczegółów'], ['zysk', 'Zysk i marża', 'Wartość netto, koszty zakupu, zysk i marża okresu (z bieżących cen zakupu produktów), z porównaniem w punktach procentowych'],
    ['rodziny', 'Rodziny produktów', 'Ten sam produkt w kolejnych latach (np. „Śpiewnik OTK 2021 … 2026” — osobne produkty w Selly): sprzedaż rodziny rok do roku'], ['zestaw', 'Zestaw produktów', 'Dowolne produkty, rodziny, kategorie lub producenci obok siebie w wybranym zakresie dat']]
    .map(([k, l, t]) => el('button', { type: 'button', class: 'chip', id: 'rpView-' + k, 'data-v': k, title: t, 'aria-pressed': 'false', onclick: () => setQ({ v: k, tab: 'series', so: '', item: '' }) }, l)));
  u.cmp = sel('rpCmp', CMP_OPTS, v => setQ({ cmp: v }), 'Porównanie');
  u.group = sel('rpGroup', GROUPS, v => setQ({ gr: v }), 'Grupowanie');
  u.yf = sel('rpYf', years.map(y => [String(y), String(y)]), v => setQ({ yf: v }), 'Od roku'); u.yt = sel('rpYt', years.map(y => [String(y), String(y)]), v => setQ({ yt: v }), 'Do roku');
  u.per = sel('rpPer', [['year', 'Lata kalendarzowe', '1.01–31.12 każdego roku'], ['season', 'Sezony (od wybranego miesiąca)', 'Dwanaście miesięcy zaczynających się od wybranego miesiąca'], ['window', 'Te same dni w każdym roku', 'Dni z pól „Od dnia – Do dnia” powtórzone w każdym roku']], v => setQ({ per: v }), 'Rodzaj okresów');
  u.ss = sel('rpSs', MONTHS_LONG.map((m, i) => [String(i + 1), m]), v => setQ({ ss: v }), 'Sezon od miesiąca');
  u.ytd = el('input', { type: 'checkbox', id: 'rpYtd', onchange: ev => setQ({ ytd: ev.target.checked ? '1' : '0' }) });
  u.statusBox = el('div', { class: 'muted small', id: 'rpStatusBox' }, 'Statusy pojawią się po pierwszym policzeniu raportu.');
  u.reset = el('button', { type: 'button', class: 'secondary', id: 'rpReset', onclick: () => { clearTimeout(S.timer); go('/raporty'); }, title: 'Wraca do ustawień domyślnych: ostatnie 30 dni, porównanie z poprzednim okresem, statusy bez anulowanych, wykres wartości' }, 'Resetuj ustawienia');
  u.ssField = mk('range', 'Sezon od miesiąca', 'Pierwszy miesiąc sezonu', u.ss);
  u.lataBlock = el('div', { class: 'rp-stack' },
    mk('range', 'Od roku', 'Pierwszy rok porównania', u.yf), mk('range', 'Do roku', 'Ostatni rok — jest „bieżący”, a poprzedni to „porównanie”', u.yt),
    mk('range', 'Rodzaj okresów', 'Jak wyznaczyć okres w każdym roku', u.per), u.ssField,
    el('label', { class: 'menu-check rp-field', 'data-sec': 'cmp', title: 'Bieżący okres liczony do dzisiejszego dnia, a wcześniejsze lata do tego samego dnia kalendarzowego — uczciwe porównanie. Wyłączone = pełne okresy.' }, u.ytd, el('span', null, 'Porównuj do dzisiejszego dnia')));
  u.okresBlock = el('div', { class: 'rp-stack' }, mk('cmp', 'Porównanie', 'Z czym zestawić okres bieżący', u.cmp));
  u.rangeBlock = el('div', { class: 'rp-stack rp-field', 'data-sec': 'range' }, u.range.node, u.presets);
  u.panelNodes = [
    filterSection('Widok', u.viewSeg, { tip: 'Jeden okres albo kilka lat obok siebie' }),
    filterSection('Zakres i porównanie', el('div', { class: 'rp-stack' }, u.lataBlock, u.rangeBlock, u.okresBlock), { tip: 'Co raport pokazuje i z czym to porównuje' }),
    filterSection('Grupowanie osi czasu', mk('group', 'Grupuj po', 'Jak grupować sprzedaż na wykresie i w tabeli czasu', u.group), { fold: true, tip: 'Opcja zaawansowana: dni, tygodnie albo miesiące. Domyślnie wybierane automatycznie.' }),
    filterSection('Które zamówienia liczyć', el('div', { 'data-sec': 'status', class: 'rp-field' }, u.statusBox), { fold: true, tip: 'Opcja zaawansowana: wybór statusów zamówień wchodzących do sum. Domyślnie wszystkie poza anulowanymi.' }),
    el('div', { class: 'rp-reset' }, u.reset)];
}

function statusPanel(statuses) {
  const box = S.ui.statusBox;
  const checks = statuses.map(s => { const cb = el('input', { type: 'checkbox', value: s.id, checked: s.selected }); return el('label', { class: 'menu-check', title: s.cancelled ? 'Status anulowania — domyślnie niezaznaczony' : null }, cb, el('span', null, s.name)); });
  const apply = () => { const ids = checks.map(l => l.firstChild).filter(cb => cb.checked).map(cb => cb.value), def = statuses.filter(s => !s.cancelled).map(s => s.id); setQ({ st: ids.length && ids.slice().sort().join() !== def.slice().sort().join() ? ids.join() : '' }); };
  box.replaceChildren(el('div', { class: 'rp-checks' }, ...checks),
    el('div', { class: 'rp-opts-actions' }, el('button', { type: 'button', class: 'primary', id: 'rpApplyStatuses', onclick: apply, title: 'Przelicz raport dla zaznaczonych statusów' }, 'Zastosuj'),
      el('button', { type: 'button', class: 'secondary', onclick: () => setQ({ st: '' }), title: 'Wróć do ustawienia domyślnego: wszystkie statusy poza anulowanymi' }, 'Domyślne (bez anulowanych)')));
}

/** Ustawia kontrolki panelu według adresu (bez wywoływania zdarzeń). */
function syncControls() {
  const u = S.ui, Q = S.Q, E = S.E, lata = isYears(Q.v), zest = Q.v === 'zestaw';
  u.range.from.value = E.from; u.range.to.value = E.to;
  u.cmp.value = Q.cmp; u.group.value = Q.gr; u.yf.value = String(E.yf || Number(E.today.slice(0, 4)) - 2); u.yt.value = String(E.yt || E.today.slice(0, 4)); u.per.value = Q.per; u.ss.value = Q.ss; u.ytd.checked = Q.ytd === '1';
  for (const b of u.viewSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === Q.v));
  u.lataBlock.hidden = !lata; u.okresBlock.hidden = lata || zest;
  u.rangeBlock.hidden = lata && Q.per !== 'window';
  u.ssField.hidden = Q.per !== 'season';
  const lbl = (ctl, t) => { const l = ctl.closest('label'); if (l && l.firstChild) l.firstChild.textContent = t; };
  lbl(u.range.from, lata ? 'Pierwszy dzień (w każdym roku)' : 'Od dnia'); lbl(u.range.to, lata ? 'Ostatni dzień (w każdym roku)' : 'Do dnia');
    u.reset.disabled = isDefault(Q);
  if (S.statuses) statusPanel(S.statuses);
}

function toggleSettings(force) {
  const u = S.ui, open = force != null ? force : !u.layout.isOpen();
  u.layout.setOpen(open, force == null);
  u.settingsBtn.setAttribute('aria-expanded', String(open));
  u.settingsBtn.textContent = open ? 'Ustawienia ▴' : 'Ustawienia ▾';
}

// ─── Ładowanie i odświeżanie ────────────────────────────────────────────────

/** Po zmianie ustawień: podświetl, co się zmieniło, i przelicz albo tylko przerysuj widok. */
function sync() {
  const prev = S.shown;
  S.E = effective(S.Q);
  S.changed = new Set();
  if (prev) {
    if (prev.v !== S.Q.v) S.changed.add('view');
    else for (const k of dataKeys(S.Q)) if (prev[k] !== S.Q[k] && GROUP_OF[k]) S.changed.add(GROUP_OF[k]);
  }
  S.shown = { ...S.Q };
  syncControls();
  const key = JSON.stringify(dataKeys(S.Q).map(k => S.Q[k]));
  if (key !== S.dataKey || !S.data) { S.dataKey = key; load(); } else { renderSummary(); renderBody(); }
}

function load() {
  const my = ++S.seq, E = S.E;
  S.data = null;
  renderSummary();
  S.ui.body.replaceChildren(loadingBox('Liczenie raportu: ' + sentence() + '…'));
  const req = E.v === 'rodziny' ? rodzinyFetch(api, E, S.Q, lataRequest) : E.v === 'zestaw' ? zestawFetch(api, E, S.Q) : E.v === 'lata' ? api('reports:years', lataRequest(E)) : api(E.v === 'zysk' ? 'reports:profit' : 'reports:sales', { from: E.from, to: E.to, group: E.group, compare: E.cmp !== 'off', compareTo: E.cmp === 'year' ? 'year' : 'prev', statusIds: E.ids });
  req.then(d => {
    if (my !== S.seq || !S.alive) return;
    d.kind = E.v; S.data = d;
    S.statuses = d.statuses || S.statuses;
    if (d.statuses) statusPanel(d.statuses);
    renderSummary(); renderBody();
  }).catch(err => {
    if (my !== S.seq || !S.alive) return;
    const adm = (ctx.boot && ctx.boot.adminUrl) || 'https://takimarket.pl/adm/';
    S.ui.body.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error', id: 'rpError' },
      isUnavailable(err) ? 'Raporty sprzedaży potrzebują backendu Cloudflare — ten serwer ich nie obsługuje.' : 'Nie udało się policzyć raportu (' + sentence() + '): ' + err.message,
      el('p', null, sellyLink('Otwórz raporty w panelu Selly ↗', adm + '?a=statistics.orders', 'Raporty sprzedaży w panelu Selly (nowa karta)')),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: load }, 'Spróbuj ponownie')))));
  });
}

function renderBody() {
  const d = S.data;
  if (!d) return;
  S.ui.body.replaceChildren(...(d.kind === 'rodziny' ? rodzinyRender({ Q: S.Q, E: S.E, d, setQ, api, statusPhrase, sentence, reload: load }) : d.kind === 'zestaw' ? zestawRender({ Q: S.Q, E: S.E, d, setQ, api, statusPhrase, sentence }) : d.kind === 'lata' ? lataRender({ Q: S.Q, E: S.E, d, setQ, api, statusPhrase, sentence }) : d.kind === 'zysk' ? zyskRender({ Q: S.Q, d, setQ, statusPhrase, legend: legendNode(d, 'rpLegend') }) : renderOkres(d)));
}

function build(el0) {
  const u = S.ui;
  buildSettings();
  u.summary = el('section', { class: 'rp-summary', id: 'rpSummary', 'aria-label': 'Co oglądasz: zakres, porównanie, statusy i grupowanie' });
  u.body = el('div', { id: 'rpBody' });
  u.layout = filterLayout({ key: 'raporty', panelId: 'rpSettings', panelNodes: u.panelNodes, mainNodes: [u.body], defaultOpen: window.innerWidth >= 980 });
  u.panelEl = u.layout.panel;
  u.settingsBtn = el('button', { type: 'button', class: 'secondary', id: 'rpSettingsBtn', 'aria-expanded': 'false', 'aria-controls': 'rpSettings', title: 'Pokaż lub ukryj ustawienia raportu: zakres, porównanie, grupowanie, statusy', onclick: () => toggleSettings() }, 'Ustawienia ▾');
  el0.replaceChildren(pageToolbar({ title: 'Raporty sprzedaży', sub: 'Sprzedaż, produkty, klienci i regiony — policzone z zamówień zapisanych w panelu. Aktualne ustawienia widać w pasku poniżej.', actions: [u.settingsBtn] }), u.summary, u.layout.node);
  toggleSettings(u.layout.isOpen());
  S.built = true;
}

export default {
  id: 'raporty',
  title: 'Raporty sprzedaży',
  routes: [],
  mount(el0, params) {
    S.alive = true;
    if (!S.built || S.root !== el0) { S.root = el0; S.dataKey = ''; S.data = null; S.shown = null; build(el0); }
    S.Q = readQ(params && params.query);
    const click = id => () => { const n = document.getElementById(id); if (!n || n.disabled) return false; n.click(); return true; };
    shortcuts.scope('raporty', [
      { keys: ['d'], label: 'D', desc: 'Przejdź do pola daty „od dnia”', run: () => { const n = document.getElementById('rpFrom'); if (!n || n.offsetParent === null) return false; n.focus(); return true; } },
      { keys: ['c'], label: 'C', desc: 'Przejdź do ustawienia porównania', run: () => { focusSetting('cmp'); return true; } },
      { keys: ['f'], label: 'F', desc: 'Przejdź do wyboru liczonych statusów', run: () => { focusSetting('status'); return true; } },
      { keys: ['e'], label: 'E', desc: 'Otwórz menu pobierania tabeli', run: click('rpDl') },
    ]);
    sync();
  },
  unmount() { S.seq++; S.alive = false; clearTimeout(S.timer); },
};
