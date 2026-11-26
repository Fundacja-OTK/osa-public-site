// Widok „Zestaw” raportów sprzedaży: dowolny zestaw produktów (albo całych rodzin, kategorii, producentów) obok siebie w wybranym zakresie dat.
// Wybór: wyszukiwarka + chipy; zestaw siedzi w adresie (set=p11,p12,c5,r3), więc link można wysłać; nazwane zestawy zapamiętuje przeglądarka (localStorage).
import { el, downloadMenuButton, debounce, sortTh, store, flash, copyToClipboard } from '../core/ui.js?v=13a6ef5';
import { zl, zl0, int, qty } from './raportyKit.js?v=13a6ef5';
import { lineChart, sortState, sortRows } from './raportyLata.js?v=13a6ef5';
import { partialWeek } from './raportyDaty.js?v=13a6ef5';
import { MAX_SET, parseSet, setKeys, axisLabels } from './raportyZestawLogika.js?v=13a6ef5';
export { MAX_SET, parseSet, setKeys, axisLabels };

const SETS_KEY = 'osa.raporty.zestawy';
const KIND = { p: 'Produkt', c: 'Kategoria', r: 'Producent' };
const MEAS = { value: ['Wartość', zl0, 1, 'Suma wartości pozycji (bez dostawy, brutto)'], qty: ['Sztuki', qty, 0, 'Suma sprzedanych sztuk'], orders: ['Zamówienia', int, 2, 'W ilu zamówieniach wystąpił produkt (zamówienie z kilkoma produktami liczy się przy każdym)'] };
const NAMES = new Map();   // klucz elementu (p11) → nazwa, z wyszukiwarki i odpowiedzi serwera

export function loadSaved() { const v = store(SETS_KEY); return Array.isArray(v) ? v.filter(x => x && typeof x.name === 'string' && typeof x.set === 'string') : []; }
export function saveSaved(list) { store(SETS_KEY, list.slice(0, 50)); }

export async function zestawFetch(api, E, Q) {
  const items = parseSet(Q.set);
  if (!items.length) return { mode: 'empty' };
  const d = await api('reports:compare', { items: items.map(x => ({ k: x.k, id: x.id })), from: E.from, to: E.to, group: E.group === 'auto' ? undefined : E.group, statusIds: E.ids });
  for (const s of d.series) NAMES.set(s.key, s.name);
  return { mode: 'data', ...d };
}

function picker(c) {
  const { Q, setQ, api } = c, items = parseSet(Q.set);
  const apply = list => setQ({ set: setKeys(list.slice(0, MAX_SET)) }, true);
  const add = (list, note) => { const cur = parseSet(Q.set), keys = new Set(cur.map(x => x.key)); for (const x of list) if (!keys.has(x.key)) { cur.push(x); NAMES.set(x.key, x.name); } if (cur.length > MAX_SET) flash('', 'Zestaw może mieć maks. ' + MAX_SET + ' elementów — reszta pominięta'); apply(cur); };
  const chips = el('div', { class: 'rp-chipset', id: 'zsChips', role: 'list', 'aria-label': 'Wybrane elementy zestawu' }, items.length ? items.map(x => el('span', { class: 'rp-setchip', role: 'listitem', 'data-key': x.key, title: KIND[x.k] + ' (ID ' + x.id + ')' }, (x.k === 'p' ? '' : KIND[x.k] + ': ') + (NAMES.get(x.key) || KIND[x.k] + ' ' + x.id),
    el('button', { type: 'button', class: 'rp-chipx', 'aria-label': 'Usuń z zestawu', title: 'Usuń z zestawu', onclick: () => apply(items.filter(y => y.key !== x.key)) }, '×'))) : el('span', { class: 'muted small' }, 'Zestaw jest pusty — wyszukaj produkt poniżej.'));
  const found = el('div', { class: 'rp-found', id: 'zsFound', hidden: true });
  const input = el('input', { type: 'search', id: 'zsSearch', placeholder: 'Szukaj produktu, rodziny, kategorii lub producenta', 'aria-label': 'Szukaj do zestawu', title: 'Wpisz co najmniej 2 znaki. Wyniki: produkty, całe rodziny (ten sam produkt w kolejnych latach), kategorie i producenci — jeden klik dodaje do zestawu.', autocomplete: 'off',
    oninput: debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) { found.hidden = true; return; }
      const r = await api('reports:productSearch', { q });
      const row = (label, tip, fn) => el('button', { type: 'button', class: 'rp-foundrow', title: tip, onclick: () => { fn(); found.hidden = true; input.value = ''; } }, label);
      const parts = [
        ...r.families.map(f => row('Cała rodzina: ' + f.name + ' (' + f.members.length + ')', 'Dodaje wszystkie produkty rodziny: ' + f.members.map(m => m.name).join(', '), () => add(f.members.map(m => ({ k: 'p', id: m.id, key: 'p' + m.id, name: m.name }))))),
        ...r.categories.map(x => row('Kategoria: ' + x.name, 'Dodaje całą kategorię jako jedną serię', () => add([{ k: 'c', id: x.id, key: 'c' + x.id, name: 'Kategoria: ' + x.name }]))),
        ...r.producers.map(x => row('Producent: ' + x.name, 'Dodaje wszystkich produktów producenta jako jedną serię', () => add([{ k: 'r', id: x.id, key: 'r' + x.id, name: 'Producent: ' + x.name }]))),
        ...r.products.map(p => row(p.name + (p.code ? ' · ' + p.code : ''), 'Dodaje produkt do zestawu', () => add([{ k: 'p', id: p.id, key: 'p' + p.id, name: p.name }])))];
      found.replaceChildren(...(parts.length ? parts : [el('div', { class: 'muted small rp-foundrow' }, 'Nic nie znaleziono dla „' + q + '”.')]));
      found.hidden = false;
    }, 300) });
  // zapisane zestawy (localStorage, per użytkownik/przeglądarka)
  const saved = loadSaved(), nameIn = el('input', { type: 'text', id: 'zsName', placeholder: 'Nazwa zestawu', maxlength: 60, 'aria-label': 'Nazwa zestawu do zapisania', title: 'Nazwa, pod którą zestaw zapamięta ta przeglądarka' });
  const savedSel = el('select', { id: 'zsSaved', 'aria-label': 'Zapisane zestawy', title: 'Zapisane zestawy (tylko w tej przeglądarce). Wybór wczytuje zestaw.', onchange: ev => { const s = saved.find(x => x.name === ev.target.value); if (s) { for (const k of parseSet(s.set)) if (s.names && s.names[k.key]) NAMES.set(k.key, s.names[k.key]); setQ({ set: s.set }, true); } } },
    el('option', { value: '' }, saved.length ? '— zapisane zestawy (' + saved.length + ') —' : '— brak zapisanych zestawów —'), saved.map(s => el('option', { value: s.name }, s.name)));
  const advanced = el('details', { class: 'rp-opts', id: 'zsAdv' }, el('summary', { title: 'Opcje zaawansowane: zapisywanie zestawów i udostępnianie linku' }, 'Zapisane zestawy i link'),
    el('div', { class: 'rp-stack' }, el('div', { class: 'rp-field' }, nameIn, el('button', { type: 'button', class: 'secondary', id: 'zsSave', disabled: !items.length, title: items.length ? 'Zapisuje bieżący zestaw pod podaną nazwą (tylko w tej przeglądarce)' : 'Zestaw jest pusty — nie ma czego zapisać', onclick: () => {
      const name = nameIn.value.trim().slice(0, 60); if (!name) { flash('', 'Podaj nazwę zestawu'); nameIn.focus(); return; }
      const names = Object.fromEntries(items.map(x => [x.key, NAMES.get(x.key)]).filter(x => x[1])), list = loadSaved().filter(x => x.name !== name); list.unshift({ name, set: setKeys(items), names }); saveSaved(list); flash('', 'Zapisano zestaw „' + name + '”'); setQ({}, true);
    } }, 'Zapisz zestaw')),
    el('div', { class: 'rp-field' }, savedSel, el('button', { type: 'button', class: 'secondary', id: 'zsDel', disabled: !saved.length, title: 'Usuwa wybrany zapisany zestaw z tej przeglądarki', onclick: () => { if (savedSel.value) { saveSaved(loadSaved().filter(x => x.name !== savedSel.value)); setQ({}, true); } } }, 'Usuń zapisany')),
    el('div', { class: 'rp-field' }, el('button', { type: 'button', class: 'secondary', id: 'zsLink', title: 'Kopiuje adres z całym zestawem, zakresem dat i statusami — można go wysłać innym użytkownikom panelu', onclick: () => copyToClipboard(location.href, null, 'Skopiowano link do zestawu') }, 'Kopiuj link do zestawu'))));
  return el('section', { class: 'card rp-card', id: 'zsPicker' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Do ' + MAX_SET + ' elementów: produkty, całe rodziny (jako osobne produkty), kategorie i producenci. Zestaw jest zapisany w adresie.' }, 'Zestaw do porównania (' + items.length + ')'), el('span', { class: 'rp-grow' }),
    items.length ? el('button', { type: 'button', class: 'secondary', id: 'zsClear', title: 'Usuwa wszystkie elementy z zestawu', onclick: () => apply([]) }, 'Wyczyść') : null),
    chips, el('div', { class: 'rp-searchbox' }, input, found), advanced);
}

export function zestawRender(c) {
  const { Q, E, d, setQ } = c, nodes = [picker(c)];
  if (d.mode === 'empty') return [...nodes, el('div', { class: 'card' }, el('div', { class: 'empty', id: 'zsEmpty' }, 'Wybierz co najmniej dwa produkty (albo rodzinę, kategorię, producenta), aby zestawić je obok siebie w wybranym zakresie.'))];
  const S = d.series, m = Q.fm in MEAS ? Q.fm : 'value', [mLabel, fmt, mi] = MEAS[m], sum = Q.sum === '1', LB = axisLabels(d.group, d.axis);
  const tot = S.reduce((s, x) => s + (m === 'qty' ? x.qty : m === 'value' ? x.value : x.orders), 0), val = x => (m === 'qty' ? x.qty : m === 'value' ? x.value : x.orders);
  if (S.every(x => !x.orders)) return [...nodes, el('div', { class: 'card' }, el('div', { class: 'empty', id: 'rpEmpty' }, 'Brak sprzedaży wybranych elementów w tym zakresie przy ustawieniu „statusy: ' + c.statusPhrase().text + '”.'))];
  const msel = el('select', { id: 'zsMeas', 'aria-label': 'Miara', title: 'Co pokazać na wykresie i w udziałach', onchange: ev => setQ({ fm: ev.target.value }, true) }, Object.entries(MEAS).map(([k, v]) => el('option', { value: k, selected: k === m, title: v[3] }, v[0])));
  const sumBox = el('input', { type: 'checkbox', id: 'zsSum', checked: sum, onchange: ev => setQ({ sum: ev.target.checked ? '1' : '0' }, true) });
  const colors = i => 'var(--tone-' + (i % 6 + 1) + ')';
  const nb = d.axis.length, bv = (x, k) => x.buckets[k][mi];
  const series = sum ? [{ name: 'Razem (' + S.length + ')', values: d.axis.map((_, k) => S.reduce((a, x) => a + bv(x, k), 0)), color: 'var(--accent)', w: 3, dash: '' }]
    : S.map((x, i) => ({ name: x.name, values: d.axis.map((_, k) => bv(x, k)), color: colors(i), w: i === 0 ? 2.6 : 2, dash: i > 5 ? '6 4' : '' }));
  const today = E.today, pw = E.to >= today && d.group !== 'day' ? (d.group === 'week' ? partialWeek(today, E.nowTime) : { short: today.slice(8, 10) + '.' + today.slice(5, 7), note: 'Bieżący miesiąc jest niepełny' }) : null;
  const partial = pw && d.last != null ? { k: d.last, label: d.group === 'week' ? 'niepełny tydzień (do ' + pw.short + ')' : 'niepełny miesiąc (do ' + pw.short + ')', note: d.group === 'week' ? 'Bieżący tydzień trwa — wartości do ' + pw.short : pw.note } : null;
  const gword = { day: 'dniami', week: 'tygodniami', month: 'miesiącami' }[d.group];
  const chartCard = el('section', { class: 'card rp-card', id: 'zsChart' }, el('div', { class: 'rp-head' }, el('h2', null, mLabel + ' ' + gword), el('span', { class: 'rp-grow' }), el('label', { class: 'field-inline' }, 'Miara', msel),
    el('label', { class: 'menu-check', title: 'Zamiast osobnej linii dla każdego elementu pokaż jedną linię z sumą wszystkich' }, sumBox, el('span', null, 'Razem (suma zestawu)'))),
    el('div', { class: 'rp-legend', id: 'zsLegend' }, ...(sum ? [] : S.map((x, i) => el('span', { class: 'tip', title: x.name + ': ' + fmt(val(x)) + ' w całym zakresie' }, el('i', { class: 'rp-swl', style: 'border-top:3px solid ' + colors(i), 'aria-hidden': 'true' }), x.name)))),
    lineChart({ labels: d.axis.map((_, k) => LB.short(k)), series, fmt, id: 'zsLine', aria: 'Wykres liniowy: ' + mLabel + ' ' + gword + ' dla ' + S.length + ' elementów zestawu', titleOf: LB.full, partial }));
  const rows = S.map(x => ({ x, qty: x.qty, value: x.value, orders: x.orders, avg: x.avg, share: tot ? val(x) / tot : 0 }));
  const st = sortState(Q, 'zs', { sort: m, dir: 'desc' });
  const sorted = sortRows(rows, st, (r, k) => (k === 'name' ? r.x.name.toLowerCase() : r[k]));
  const th = (key, label, tip, num, fd) => sortTh({ label, sort: key, num, tip, tipHeader: tip !== label, firstDir: fd }, st, (k, dd) => setQ({ so: 'zs_' + k + ':' + dd }, true));
  const tbl = el('table', { id: 'zsTable' }, el('thead', null, el('tr', null, th('name', 'Element', 'Produkt, kategoria albo producent z zestawu', false, 'asc'), th('qty', 'Sztuki', MEAS.qty[3], true, 'desc'), th('value', 'Wartość', MEAS.value[3], true, 'desc'), th('orders', 'Zamówienia', MEAS.orders[3], true, 'desc'),
    th('avg', 'Średnia cena', 'Wartość podzielona przez liczbę sztuk', true, 'desc'), th('share', 'Udział', 'Jaką część sumy miary „' + mLabel + '” w całym zestawie ma ten element', true, 'desc'))),
    el('tbody', null, sorted.map(r => el('tr', { 'data-key': r.x.key }, el('td', null, r.x.kind === 'p' ? el('a', { href: '#/produkty/' + encodeURIComponent(r.x.id), title: 'Karta produktu w panelu' }, r.x.name) : r.x.name), el('td', { class: 'n' }, qty(r.qty)), el('td', { class: 'n' }, zl0(r.value)), el('td', { class: 'n' }, int(r.orders)),
      el('td', { class: 'n' }, r.qty ? zl(r.avg) : '—'), el('td', { class: 'n' }, (r.share * 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + '%', el('span', { class: 'rp-share', 'aria-hidden': 'true' }, el('span', { style: 'width:' + (r.share * 100).toFixed(1) + '%' })))))),
    el('tfoot', null, el('tr', { class: 'rp-total', id: 'zsTotal' }, el('th', { scope: 'row' }, 'Razem'), el('td', { class: 'n' }, qty(S.reduce((a, x) => a + x.qty, 0))), el('td', { class: 'n' }, zl0(S.reduce((a, x) => a + x.value, 0))), el('td', { class: 'n' }, int(S.reduce((a, x) => a + x.orders, 0))), el('td', { class: 'n' }, '—'), el('td', { class: 'n' }, '100%'))));
  const tableCard = el('section', { class: 'card rp-card', id: 'zsTableCard' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Sumy w całym wybranym zakresie. Uwaga: jeśli produkt jest w zestawie także przez kategorię albo producenta, jego sprzedaż liczy się w obu wierszach, więc „Razem” może się nakładać.' }, 'Zestawienie w zakresie'), el('span', { class: 'rp-grow' }),
    downloadMenuButton('zsDl', () => ({ sheet: 'Zestaw', file: 'raport-zestaw-produktow', columns: [{ header: 'Element', type: 'text', width: 44 }, { header: 'Sztuki', type: 'number', width: 12 }, { header: 'Wartość', type: 'number', width: 14 }, { header: 'Zamówienia', type: 'number', width: 12 }, { header: 'Średnia cena', type: 'number', width: 12 }, { header: 'Udział', type: 'number', width: 10 }],
      rows: rows.map(r => [r.x.name, r.qty, r.value, r.orders, r.avg, Math.round(r.share * 1000) / 10]), note: c.sentence() + ' · udział wg miary: ' + mLabel }), null, false, { cls: 'secondary', label: 'Pobierz', title: 'Pobierz zestawienie jako Excel albo CSV' })),
    el('div', { class: 'table-wrap' }, tbl));
  return [...nodes, chartCard, tableCard];
}
