// „Wysyłka SpeedMail” → zakładka Tempo sprzedaży (sekcja 8 specyfikacji): sprzedaż narastająco wobec prognozy dla produktów SpeedMail
// (zestawy rozbite na składniki, np. korony z licencji), sygnał „szybciej / wolniej niż prognoza o > próg %”, dla wybranego produktu wykres
// i liczby: prognoza sezonu, sprzedane, brak towaru wobec prognozy. Prognozy i kształt krzywej wpisuje administrator w Ustawieniach.
// Porównanie z poprzednimi sezonami (sm:history — dane z D1, bez Selly): domyślnie poprzedni sezon; w zwiniętym „Porównanie” wybrany rok,
// średnia z kilku lat albo bez porównania (adres: cmp = rok | avg (+ a, b) | none). Wyrównanie: ten sam dzień i miesiąc rok wcześniej.
import { el, sortTh, statusPill } from '../core/ui.js?v=5281496';
import { go } from '../core/router.js?v=5281496';
import { tile } from './raportyKit.js?v=5281496';
import { lineChart } from './raportyLata.js?v=5281496';
import { S, SM, nf, dmy, notice, prodOf, freshBar, loadError, skeleton, fold } from './speedmailKit.js?v=5281496';

const SIG = { fast: ['szybciej', 'warn', 'Sprzedaż wyprzedza prognozę o więcej niż próg — rozważ dodruk albo (po 15.12) zmianę ceny'], slow: ['wolniej', 'bad', 'Sprzedaż jest poniżej prognozy o więcej niż próg'],
  ok: ['zgodnie', 'ok', 'Sprzedaż mieści się w progu wokół prognozy'], none: ['brak prognozy', 'neutral', 'Nie wpisano prognozy sezonu dla tego produktu (Ustawienia → Produkty SpeedMail)'] };
const SIG_ORDER = { fast: 0, slow: 1, ok: 2, none: 3 };
const SORTS = { name: r => r.name, sold: r => r.sold, expected: r => r.expected, diff: r => r.diffPct, signal: r => SIG_ORDER[r.signal], forecast: r => r.forecast || null, left: r => r.left };
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
const int = n => Math.round(Number(n) || 0).toLocaleString('pl-PL');
const pct = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.round(Math.abs(v) * 10) / 10) + '%');

function readQ(q) {
  const sort = SORTS[q.get('sort')] ? q.get('sort') : 'signal';
  return { p: q.get('p') || '', sort, dir: q.get('dir') === 'desc' ? 'desc' : 'asc', cmp: q.get('cmp') || '', a: q.get('a') || '', b: q.get('b') || '' };
}
function hrefOf(Q) {
  const p = new URLSearchParams();
  if (Q.p) p.set('p', Q.p);
  if (Q.sort !== 'signal' || Q.dir !== 'asc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  if (Q.cmp) p.set('cmp', Q.cmp);
  if (Q.cmp === 'avg') { if (Q.a) p.set('a', Q.a); if (Q.b) p.set('b', Q.b); }
  const s = p.toString();
  return '#/speedmail/tempo' + (s ? '?' + s : '');
}

export function viewPace() {
  const box = el('div', { id: 'smPace' }), e = S.pace, err = loadError('pace', 'sprzedaż produktów SpeedMail');
  if (err) box.append(err);
  if (!e) { if (!err) box.append(skeleton(7)); return box; }
  const v = S.d.v, cfg = v.cfg, Q = readQ(S.query), today = e.v.today;
  const rows = SM.pace(cfg, e.v.rows, today);
  const cur = rows.find(r => r.key === Q.p) || rows.find(r => r.key === 'korona') || rows[0];
  if (!cur) { box.append(notice('warn', 'Lista produktów SpeedMail jest pusta.')); return box; }
  if (rows.every(r => !r.forecast)) {
    box.append(notice('warn', 'Nie wpisano jeszcze prognoz sezonu — panel pokazuje samą sprzedaż, bez sygnałów. ', el('a', { href: '#/speedmail/ustawienia' }, 'Wpisz prognozy w Ustawieniach →'),
      ' (można wstawić propozycję ze specyfikacji i poprawić).'));
  }
  const sel = el('select', { id: 'smPaceProd', 'aria-label': 'Produkt', title: 'Produkt, dla którego rysujemy wykres' }, SM.tableProducts(cfg).map(p => el('option', { value: p.key }, p.name)));
  sel.value = cur.key;
  sel.addEventListener('change', () => go(hrefOf({ ...Q, p: sel.value }).slice(1)));
  const p = prodOf(cur.key), st = SM.stockRows(cfg, e.v.totals, today).find(r => r.key === cur.key);
  const inSm = st ? st.sent + st.topups + st.corr : 0, lack = cur.forecast > 0 ? Math.max(0, cur.forecast - inSm) : null;
  const s = SIG[cur.signal], u = ' ' + cur.unit;
  const H = S.hist && S.hist.v && Array.isArray(S.hist.v.seasons) && S.hist.v.from === cfg.pace.from ? S.hist.v : null, cmp = compareOf(Q, H, cur.key);
  const hv = cmp && cmp.values, hk = hv ? Math.min(Math.max(0, SM.dayNum(today) - SM.dayNum(cfg.pace.from)), hv.length - 1) : -1;
  const hNow = hv ? hv[hk] : null, hDiff = hNow > 0 ? (cur.sold - hNow) / hNow * 100 : null;
  box.append(el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('h3', { style: 'margin:0' }, 'Sprzedaż wobec prognozy'), el('label', { class: 'field-inline' }, 'Produkt', sel), statusPill(s[0], s[1], s[2]), el('span', { class: 'spacer' }), freshBar('pace')),
    el('div', { class: 'rp-tiles' },
      tile('sold', 'Sprzedano od ' + dmy(cfg.pace.from), 'Suma z zamówień w statusach liczonych jako zakup, z rozbiciem zestawów (np. licencja = 150 koron). Zamówienia ze wszystkich form dostawy — nie tylko SpeedMail.', int(cur.sold) + u),
      tile('expected', 'Prognoza na dziś', 'Tyle powinno być sprzedane do dziś, gdyby sprzedaż szła zgodnie z prognozą sezonu i krzywą z Ustawień', cur.forecast ? int(cur.expected) + u : '—',
        [cur.diffPct == null ? null : el('div', { class: cur.diffPct >= 0 ? 'rp-up' : 'rp-down', title: 'Sprzedaż wobec prognozy na dziś. Sygnał pojawia się powyżej ±' + nf(cfg.thresholds.pacePct) + '%' }, pct(cur.diffPct) + ' wobec prognozy')]),
      tile('forecast', 'Prognoza sezonu', 'Prognoza sprzedaży tego produktu do końca sezonu (' + dmy(cfg.pace.to) + ') — z Ustawień', cur.forecast ? int(cur.forecast) + u : '—',
        [cur.left == null ? null : el('div', { class: 'muted small' }, cur.left >= 0 ? 'zostało ' + int(cur.left) + u : 'prognoza przekroczona o ' + int(-cur.left) + u)]),
      tile('lack', 'Brak towaru wobec prognozy', 'Prognoza sezonu minus towar, który trafił do SpeedMail (wysłane + dosyłki ± korekty). Powyżej zera = tyle trzeba dosłać albo dodrukować, żeby SpeedMail obsłużył całą prognozę.',
        lack == null ? '—' : int(lack) + u, [el('div', { class: 'muted small' }, 'w SpeedMail było ' + int(inSm) + u)]),
      cmp ? tile('hist', cmp.label + ' — do tego dnia', 'Ile sprzedano do tego samego dnia i miesiąca ' + (cmp.pick.year != null ? 'w sezonie ' + cmp.pick.year : 'średnio w sezonach ' + (cmp.years.join(', ') || '—')) +
        '. Te same produkty (ID z Ustawień), statusy liczone jako zakup, zestawy rozbite — jak tegoroczna sprzedaż. Z kopii zamówień w panelu, bez zapytań do Selly.', hv ? int(hNow) + u : '—',
        [hDiff == null ? null : el('div', { class: hDiff >= 0 ? 'rp-up' : 'rp-down', title: 'Tegoroczna sprzedaż do dziś wobec porównania (' + cmp.label + ') do tego samego dnia' }, pct(hDiff) + ' w tym roku'),
          hv ? el('div', { class: 'muted small', title: 'Sprzedaż w całym sezonie porównawczym' }, 'cały sezon: ' + int(hv[hv.length - 1]) + u) : null]) : null),
    compareCtl(Q, H, cmp, cur),
    ...chart(cfg, cur, today, cmp),
    el('p', { class: 'muted small' }, 'Linia przerywana to prognoza: ' + (cfg.pace.points.length ? 'przechodzi przez punkty wpisane w Ustawieniach' : 'na razie prosta od ' + dmy(cfg.pace.from) + ' do ' + dmy(cfg.pace.to) + ' — to założenie; rozkład sprzedaży w czasie (np. z poprzedniego sezonu) wpiszesz w Ustawieniach → Tempo sprzedaży') + '.')));

  const val = SORTS[Q.sort], sign = Q.dir === 'desc' ? -1 : 1;
  const list = rows.slice().sort((a, b) => {
    const x = val(a), y = val(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;
    const c = x == null ? 0 : typeof x === 'number' ? x - y : collator.compare(String(x), String(y));
    return c * sign || Math.abs(b.diffPct || 0) - Math.abs(a.diffPct || 0) || collator.compare(a.name, b.name);
  });
  const cols = [
    { label: 'Produkt', sort: 'name', tip: 'Produkt z listy SpeedMail — klik pokazuje jego wykres' },
    { label: 'Sygnał', sort: 'signal', tip: 'Szybciej / wolniej niż prognoza o więcej niż ' + nf(cfg.thresholds.pacePct) + '% (próg z Ustawień)', tipHeader: true },
    { label: 'Sprzedano', sort: 'sold', num: true, tip: 'Sprzedaż narastająco od ' + dmy(cfg.pace.from) + ', w jednostce produktu', tipHeader: true },
    { label: 'Prognoza na dziś', sort: 'expected', num: true, tip: 'Część prognozy sezonu, która powinna być sprzedana do dziś', tipHeader: true },
    { label: 'Różnica', sort: 'diff', num: true, tip: 'Sprzedaż wobec prognozy na dziś, w procentach', tipHeader: true },
    { label: 'Prognoza sezonu', sort: 'forecast', num: true, tip: 'Prognoza sprzedaży do końca sezonu — z Ustawień', tipHeader: true },
    { label: 'Zostało', sort: 'left', num: true, tip: 'Prognoza sezonu minus sprzedaż (ujemne = prognoza przekroczona)', tipHeader: true },
  ];
  box.append(el('div', { class: 'card' }, el('h3', null, 'Wszystkie produkty SpeedMail'),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smPaceTable' },
      el('thead', null, el('tr', null, cols.map(c => sortTh(c, Q, (sort, dir) => go(hrefOf({ ...Q, sort, dir }).slice(1)))))),
      el('tbody', null, list.map(r => {
        const g = SIG[r.signal];
        return el('tr', { 'data-key': r.key, 'data-signal': r.signal, class: r.key === cur.key ? 'sel' : null },
          el('td', null, el('a', { href: hrefOf({ ...Q, p: r.key }), title: 'Pokaż wykres: ' + r.name }, r.name)), el('td', { class: 'nw' }, statusPill(g[0], g[1], g[2])),
          el('td', { class: 'n' }, int(r.sold)), el('td', { class: 'n' }, r.forecast ? int(r.expected) : '—'),
          el('td', { class: 'n' }, el('span', { class: r.signal === 'fast' || r.signal === 'slow' ? 'diffbad' : null }, pct(r.diffPct))),
          el('td', { class: 'n' }, r.forecast ? int(r.forecast) : '—'), el('td', { class: 'n' }, r.left == null ? '—' : int(r.left)));
      }))))));
  return box;
}

const SEASON_TIP = 'Sezon = ten sam zakres dat co w tym roku (Ustawienia → Tempo sprzedaży), przesunięty o rok wstecz; rok = rok początku sezonu.';
/** Krzywa porównawcza z adresu: domyślnie poprzedni sezon; cmp = rok | avg (a, b) | none. → { pick, label, values, years, skipped } | null */
function compareOf(Q, H, key) {
  if (!H || Q.cmp === 'none') return null;
  const years = H.seasons.map(x => x.year);
  if (!years.length) return null;
  let pick;
  if (Q.cmp === 'avg' && years.length > 1) {
    const a = years.includes(+Q.a) ? +Q.a : years[years.length - 1], b = years.includes(+Q.b) ? +Q.b : years[0];
    pick = { a: Math.min(a, b), b: Math.max(a, b) };
  } else pick = { year: years.includes(+Q.cmp) ? +Q.cmp : years[0] };
  const label = pick.year != null ? 'Sezon ' + pick.year : pick.a === pick.b ? 'Sezon ' + pick.a : 'Średnia ' + pick.a + '–' + pick.b;
  return Object.assign({ pick, label }, SM.histCurve(H, key, pick));
}

/** Zwinięte „Porównanie”: z którym sezonem (albo średnią lat) zestawić tegoroczną sprzedaż. */
function compareCtl(Q, H, cmp, cur) {
  if (!H) {
    if (S.loading.hist) return el('p', { class: 'muted small', id: 'smPaceCmpWait', role: 'status' }, el('span', { class: 'spinner' }), ' wczytuję sprzedaż z poprzednich sezonów…');
    return loadError('hist', 'sprzedaż z poprzednich sezonów');
  }
  const years = H.seasons.map(x => x.year);
  if (!years.length) return null;
  const set = q => go(hrefOf(Object.assign({}, Q, q)).slice(1));
  const mode = el('select', { id: 'smPaceCmp', 'aria-label': 'Z czym porównać', title: 'Z czym zestawić tegoroczną sprzedaż na wykresie. ' + SEASON_TIP },
    el('option', { value: '' }, 'Poprzedni sezon (' + years[0] + ')'), years.slice(1).map(y => el('option', { value: String(y) }, 'Sezon ' + y)),
    years.length > 1 ? el('option', { value: 'avg' }, 'Średnia z kilku sezonów') : null, el('option', { value: 'none' }, 'Bez porównania'));
  mode.value = Q.cmp === 'none' || (Q.cmp === 'avg' && years.length > 1) || years.slice(1).includes(+Q.cmp) ? Q.cmp : '';
  mode.addEventListener('change', () => set({ cmp: mode.value }));
  const ysel = (id, label, v, field) => {
    const x = el('select', { id, 'aria-label': label, title: label }, years.slice().reverse().map(y => el('option', { value: String(y) }, String(y))));
    x.value = String(v);
    x.addEventListener('change', () => set({ cmp: 'avg', [field]: x.value }));
    return x;
  };
  const avg = mode.value === 'avg' && cmp && cmp.pick.a != null
    ? el('span', { class: 'field-inline' }, 'z lat', ysel('smPaceAvgA', 'Średnia od sezonu', cmp.pick.a, 'a'), '–', ysel('smPaceAvgB', 'Średnia do sezonu', cmp.pick.b, 'b')) : null;
  return fold('smPaceCmpFold', ['Porównanie', ' — ' + (cmp ? cmp.label.toLowerCase() : 'wyłączone')],
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('label', { class: 'field-inline' }, 'Porównaj z', mode), avg),
    cmp && cmp.skipped.length ? el('p', { class: 'muted small', id: 'smPaceSkip' }, 'Bez sprzedaży „' + cur.name + '” w sezonie ' + cmp.skipped.join(', ') +
      (cmp.pick.year != null ? '' : ' — pominięte w średniej') + '. Jeśli produkt miał wtedy w Selly inne ID, dopisz je w ', el('a', { href: '#/speedmail/ustawienia' }, 'Ustawieniach → Produkty SpeedMail'), '.') : null,
    el('p', { class: 'muted small' }, 'Linia porównawcza to sprzedaż narastająco z poprzednich lat w tych samych datach (np. 15.11 sprzed roku nad 15.11 tego roku). ' +
      'Średnia liczy tylko sezony, w których produkt się sprzedawał. Dane z kopii zamówień w panelu — bez zapytań do Selly.'));
}

function chart(cfg, cur, today, cmp) {
  const a = SM.dayNum(cfg.pace.from), b = SM.dayNum(cfg.pace.to), days = [];
  for (let n = a; n <= b && days.length < 400; n++) days.push(SM.addDays(cfg.pace.from, n - a));
  const at = new Map(cur.series.map(x => [x.day, x.cum]));
  let cum = 0;
  const actual = days.map(d => { if (at.has(d)) cum = at.get(d); return d <= today ? cum : null; });
  const series = [{ name: 'Sprzedaż narastająco', color: 'var(--accent)', w: 3, values: actual }];
  series[0].tip = 'Tegoroczna sprzedaż narastająco od ' + dmy(cfg.pace.from);
  if (cmp && cmp.values) series.unshift({ name: cmp.label, color: 'var(--tone-3)', w: 2, values: days.map((d, i) => (i < cmp.values.length ? cmp.values[i] : null)),
    tip: cmp.label + ': sprzedaż narastająco w tych samych datach' + (cmp.pick.year != null ? '' : ' — średnia z sezonów ' + cmp.years.join(', ')) + '. ' + SEASON_TIP });
  if (cur.forecast > 0) series.unshift({ name: 'Prognoza', color: 'var(--tone-2)', w: 2, dash: '7 4', values: days.map(d => Math.round(cur.forecast * SM.curveAt(cfg, d))), tip: 'Prognoza sezonu rozłożona w czasie wg krzywej z Ustawień' });
  const k = days.indexOf(today);
  const legend = el('div', { class: 'rp-legend', id: 'smPaceLegend', role: 'group', 'aria-label': 'Oznaczenia linii' }, series.slice().reverse().map(se => el('span', { class: 'tip', title: se.tip, 'data-p': se.name },
    el('i', { class: 'rp-swl', style: 'border-top:3px ' + (se.dash ? 'dashed ' : 'solid ') + se.color, 'aria-hidden': 'true' }), se.name)));
  return [lineChart({ labels: days.map(d => d.slice(8, 10) + '.' + d.slice(5, 7)), series, fmt: int, id: 'smPaceChart', titleOf: i => dmy(days[i]),
    aria: 'Sprzedaż narastająco i prognoza: ' + cur.name, partial: k >= 0 ? { k, label: 'dziś', note: 'Dzisiejszy dzień jeszcze trwa — sprzedaż z dziś jest niepełna' } : null }), legend];
}
