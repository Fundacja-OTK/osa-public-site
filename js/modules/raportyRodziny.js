// Widok „Rodziny” raportów sprzedaży: ten sam produkt „kanoniczny” w kolejnych latach (np. „Śpiewnik OTK 2021 … 2026” to osobne produkty w Selly).
// Lista rodzin (grupowanie automatyczne po nazwie bez roku — Worker, lib/families.js) → wybór rodziny → porównanie rok do roku: wykres, tabela, produkty-członkowie.
// Zaawansowane (ukryte, tylko administrator): scalanie, podział, dodawanie / usuwanie produktów, zmiana nazwy rodziny — zapis w D1, wspólny dla wszystkich.
import { el, loadingBox, sortTh, downloadMenuButton, debounce, flash } from '../core/ui.js?v=650da05';
import { svg, zl, zl0, int, qty, pctText, pctFmt, deltaEl, niceMax, tile } from './raportyKit.js?v=650da05';
import { lineChart, sortState, sortRows, slotLabels, periodReq } from './raportyLata.js?v=650da05';
import { costShown, costValue, costDefs, costBar, costTipText, costLegend } from './chartCost.js?v=650da05';

const MEAS = {
  qty: { label: 'Sprzedane sztuki', short: 'Sztuki', i: 0, fmt: qty, tip: 'Suma sztuk wszystkich produktów rodziny w liczonych zamówieniach' },
  value: { label: 'Wartość', short: 'Wartość', i: 1, fmt: zl0, tip: 'Suma wartości pozycji (bez dostawy, brutto)' },
  orders: { label: 'Zamówienia', short: 'Zamówienia', i: 2, fmt: int, tip: 'W ilu zamówieniach wystąpił któryś produkt rodziny (zamówienie z kilkoma produktami rodziny liczy się przy każdym)' },
  avg: { label: 'Średnia cena', short: 'Średnia cena', fmt: zl, tip: 'Wartość podzielona przez liczbę sztuk' },
};
const totalOf = (m, p) => (m === 'avg' ? p.avg : p[m]);
const bucketVal = (m, p, k) => { if (k > p.last || k >= p.buckets.length) return null; const b = p.buckets[k]; return m === 'avg' ? (b[0] ? b[1] / b[0] : 0) : b[MEAS[m].i]; };
const FL = { list: null, mine: 0 };   // pamięć listy rodzin (czyszczona po zapisie)
export const resetFamilies = () => { FL.list = null; };

/** Pobiera dane widoku: lista rodzin albo rodzina rok do roku. */
export async function rodzinyFetch(api, E, Q, lataRequest) {
  if (!Q.fam) {
    if (!FL.list) FL.list = await api('reports:families', {});
    return { mode: 'list', ...FL.list };
  }
  const req = lataRequest(E);
  const d = await api('reports:familyYears', { familyId: Q.fam, periods: req.periods, statusIds: req.statusIds, group: req.group === 'auto' ? 'month' : req.group });
  return { mode: 'years', ...d };
}

function listView(c, d) {
  const { Q, setQ } = c, q = (Q.q || '').trim().toLowerCase();
  const all = d.families, rows0 = all.filter(f => !q || f.name.toLowerCase().includes(q) || f.members.some(m => m.name.toLowerCase().includes(q)));
  const st = sortState(Q, 'fl', { sort: 'n', dir: 'desc' });
  const rows = sortRows(rows0, st, (f, k) => (k === 'name' ? f.name.toLowerCase() : k === 'n' ? f.members.length : k === 'y' ? f.members.map(m => m.year).filter(Boolean).sort()[0] || null : null));
  const th = (key, label, tip, num, fd) => sortTh({ label, sort: key, num, tip, tipHeader: tip !== label, firstDir: fd }, st, (k, dd) => setQ({ so: 'fl_' + k + ':' + dd }, true));
  const search = el('input', { type: 'search', id: 'famSearch', value: Q.q, placeholder: 'Szukaj rodziny lub produktu', 'aria-label': 'Szukaj rodziny', title: 'Filtruje rodziny po nazwie rodziny albo nazwie dowolnego produktu w niej', oninput: debounce(() => setQ({ q: search.value.trim() }, true), 300) });
  const yearsOf = f => f.members.map(m => m.label || '?').join(', ');
  const tbl = el('table', { id: 'famTable' }, el('thead', null, el('tr', null, th('name', 'Rodzina', 'Nazwa wspólna produktów (bez roku). Kliknij, aby zobaczyć porównanie rok do roku', false, 'asc'), th('n', 'Produktów', 'Ile osobnych produktów Selly należy do rodziny', true, 'desc'),
    el('th', null, el('span', { class: 'tip', title: 'Lata (albo sezony) wyciągnięte z nazw produktów' }, 'Lata')), el('th', null, el('span', { class: 'tip', title: 'Automatyczna = zgrupowana po nazwie; ręczna = poprawiona przez administratora' }, 'Typ')))),
    el('tbody', null, rows.slice(0, 200).map(f => el('tr', { 'data-id': f.id }, el('td', null, el('a', { href: '#/raporty?v=rodziny&fam=' + encodeURIComponent(f.id), class: 'rp-pname', title: 'Pokaż rodzinę rok do roku', onclick: ev => { ev.preventDefault(); setQ({ fam: f.id, q: '', so: '' }); } }, f.name)),
      el('td', { class: 'n' }, String(f.members.length)), el('td', { class: 'small' }, yearsOf(f)), el('td', null, f.edited ? el('span', { class: 'rp-badge nowy', title: 'Rodzina poprawiona ręcznie (nazwa albo skład)' }, 'ręczna') : el('span', { class: 'muted small', title: 'Zgrupowana automatycznie po nazwie' }, 'auto'))))));
  return [el('div', { class: 'rp-top muted' }, 'Rodzina to ten sam produkt w kolejnych latach (np. „Śpiewnik OTK 2021”, „… 2022”). Rodziny są wykrywane automatycznie po nazwie bez roku i słów o edycji.'),
    el('section', { class: 'card rp-card', id: 'famList' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Rodziny złożone z co najmniej dwóch produktów, które różnią się tylko rokiem / edycją w nazwie' }, 'Rodziny produktów (' + all.length + ')'), el('span', { class: 'rp-grow' }), search,
      downloadMenuButton('famDl', () => ({ sheet: 'Rodziny', file: 'raport-rodziny-produktow', columns: [{ header: 'Rodzina', type: 'text', width: 36 }, { header: 'ID produktu', type: 'text', width: 12 }, { header: 'Produkt', type: 'text', width: 44 }, { header: 'Rok / sezon', type: 'text', width: 12 }], rows: all.flatMap(f => f.members.map(m => [f.name, m.id, m.name, m.label || ''])), note: 'Rodziny produktów (automatyczne i ręczne)' }), null, !all.length, { cls: 'secondary', label: 'Pobierz rodziny', title: 'Pobierz wszystkie rodziny z ich produktami jako Excel albo CSV' })),
      rows.length ? el('div', { class: 'table-wrap' }, tbl) : el('div', { class: 'empty', id: 'famEmpty' }, all.length ? 'Żadna rodzina nie pasuje do „' + Q.q + '”.' : 'Nie znaleziono rodzin — potrzeba co najmniej dwóch produktów o tej samej nazwie i różnych rokach.'))];
}

function barChart(P, m, fmt, id, aria) {
  const withCost = m === 'value' && costShown() && P.some(p => p.cost);   // koszt zakupu w słupku wartości (wartość pozycji brutto bez dostawy = towar)
  const W = 560, H = 220, L = 64, R = 10, T = 14, B = 34, iw = W - L - R, ih = H - T - B, vals = P.map(p => totalOf(m, p)), bw = Math.min(64, iw / P.length * 0.62);
  const max = niceMax(Math.max(0, ...vals, ...(withCost ? P.map(p => costValue(p.cost)) : [])));
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rp-svg', role: 'img', 'aria-label': aria }), hatch = withCost ? costDefs(svg) : null;
  if (hatch) s.append(hatch.defs);
  for (let i = 0; i <= 4; i++) s.append(svg('line', { x1: L, x2: W - R, y1: T + ih - ih * i / 4, y2: T + ih - ih * i / 4, class: 'rp-grid' }), svg('text', { x: L - 6, y: T + ih - ih * i / 4 + 4, class: 'rp-axis', 'text-anchor': 'end' }, fmt(max * i / 4)));
  P.forEach((p, i) => {
    const cx = L + iw * (i + 0.5) / P.length, h = max ? ih * vals[i] / max : 0, cur = i === P.length - 1;
    s.append(svg('rect', { x: cx - bw / 2, y: T + ih - h, width: bw, height: h, class: 'rp-fbar', fill: cur ? 'var(--accent)' : 'var(--tone-' + (i % 4 + 3) + ')', 'data-p': p.label }, svg('title', null, p.label + ': ' + fmt(vals[i]) + (withCost ? costTipText(p.cost) : ''))),
      withCost ? costBar(svg, { x: cx - bw / 2, w: bw, base: T + ih, k: max ? ih / max : 0, barH: h, top: T, cost: p.cost, hatch: hatch.fill }) : null,
      svg('text', { x: cx, y: T + ih - h - 4, class: 'rp-axis', 'text-anchor': 'middle' }, fmt(vals[i])), svg('text', { x: cx, y: H - 10, class: 'rp-axis', 'text-anchor': 'middle' }, p.label));
  });
  return el('div', { class: 'rp-chart-wrap', id }, s);
}

function yearsView(c, d) {
  const { Q, E, setQ, api } = c, P = d.periods, n = P.length, last = n - 1, prev = n - 2, cmp = n > 1, m = MEAS[Q.fm] ? Q.fm : 'qty', M = MEAS[m], fam = d.family;
  const back = el('button', { type: 'button', class: 'secondary', id: 'famBack', title: 'Wróć do listy rodzin', onclick: () => setQ({ fam: '', so: '' }) }, '← Wszystkie rodziny');
  const msel = el('select', { id: 'famMeas', 'aria-label': 'Miara', title: 'Co pokazać na wykresach', onchange: ev => setQ({ fm: ev.target.value }, true) }, Object.entries(MEAS).map(([k, v]) => el('option', { value: k, selected: k === m, title: v.tip }, v.label)));
  const head = el('section', { class: 'card rp-card', id: 'famHead' }, el('div', { class: 'rp-head' }, back, el('div', null, el('span', { class: 'rp-eyebrow' }, 'Rodzina produktów · ' + fam.members.length + ' prod.' + (fam.edited ? ' · ręcznie poprawiona' : ' · automatyczna')), el('h2', { id: 'famTitle' }, fam.name)), el('span', { class: 'rp-grow' }), el('label', { class: 'field-inline' }, 'Miara', msel)),
    el('p', { class: 'muted small', id: 'famMembers' }, 'Produkty: ' + fam.members.map(x => x.name).join(' · ')));
  const none = P.every(p => !p.orders);
  const pm = E.periods[last] && E.periods[last].partial;
  const note = pm ? el('p', { class: 'muted small rp-note', id: 'famCut' }, 'Uczciwe porównanie: ' + pm.note + '.') : null;
  if (!n) return [head, el('div', { class: 'card' }, el('div', { class: 'empty', id: 'rpEmpty' }, 'Wybrane lata są w przyszłości.'))];
  const dl = (cur, pv, f) => deltaEl(cur, pv, { fmt: f, cmp, curLabel: P[last].label, prevLabel: cmp ? P[prev].label : '' });
  const kt = (k, label, tip, cur, pv, f) => tile('f-' + k, label + ' · ' + P[last].label, tip, f(cur), [cmp ? el('div', { class: 'rp-prevline' }, el('i', { class: 'rp-sw cmp' }), 'porównanie ' + P[prev].label + ': ' + (pv == null ? '—' : f(pv))) : null, dl(cur, cmp ? pv : null, f)]);
  const kpis = el('div', { class: 'rp-tiles', id: 'famKpi' }, ...Object.entries(MEAS).map(([k, v]) => kt(k, v.short, v.tip, totalOf(k, P[last]), cmp ? totalOf(k, P[prev]) : null, v.fmt)));
  if (none) return [head, kpis, el('div', { class: 'card' }, el('div', { class: 'empty', id: 'rpEmpty' }, 'Brak sprzedaży tej rodziny w okresach ' + P.map(p => p.label).join(', ') + ' przy ustawieniu „statusy: ' + c.statusPhrase().text + '”.'))];
  const barsCard = () => el('section', { class: 'card rp-card', id: 'famBars' }, el('div', { class: 'rp-head' }, el('h2', null, M.label + ' — rok do roku'), el('span', { class: 'rp-grow' }),
    m === 'value' ? costLegend(P.map(p => p.cost), () => { const nb = barsCard(); bars.replaceWith(nb); bars = nb; }, 'famCostLegend') : null),
  barChart(P, m, M.fmt, 'famBarChart', 'Wykres słupkowy: ' + M.label + ' rodziny ' + fam.name + ' w okresach ' + P.map(p => p.label).join(', ')), note);
  let bars = barsCard();
  // wykres przebiegu (dni / tygodnie / miesiące) — linia na rok
  const longest = P.reduce((a, p, i) => (p.buckets.length > P[a].buckets.length ? i : a), 0), ref = E.periods[longest], SL = slotLabels(d.group, ref), N = P[longest].buckets.length;
  const labels = Array.from({ length: N }, (_, k) => SL.short(k));
  const col = i => (i === last ? { color: 'var(--accent)', w: 3, dash: '' } : i === prev ? { color: 'var(--tone-2)', w: 2.5, dash: '7 4' } : { color: 'var(--tone-' + (3 + (n - 3 - i) % 4) + ')', w: 1.6, dash: '' });
  const series = P.map((p, i) => ({ name: p.label + (i === last ? ' (bieżący)' : i === prev ? ' (porównanie)' : ''), values: p.buckets.map((_, k) => bucketVal(m, p, k)), ...col(i) }));
  const pl = E.periods[last].partial, partial = pl && pl.w ? { k: P[last].last, label: 'do ' + pl.short, note: pl.note } : pl ? { k: P[last].last, label: 'do ' + pl.short, note: pl.note } : null;
  const gword = { day: 'dniami', week: 'tygodniami', month: 'miesiącami' }[d.group];
  const line = el('section', { class: 'card rp-card', id: 'famLine' }, el('div', { class: 'rp-head' }, el('h2', null, M.label + ' ' + gword)),
    lineChart({ labels, series, fmt: M.fmt, id: 'famLineChart', aria: 'Wykres liniowy: ' + M.label + ' rodziny ' + fam.name + ' ' + gword, titleOf: SL.full, partial }));
  // tabela rok do roku
  const rows = P.map((p, i) => ({ p, i, name: p.members.filter(x => x.qty).map(x => x.name).join(' · ') || '—', qty: p.qty, value: p.value, orders: p.orders, avg: p.avg, chg: i ? pctText(totalOf(m, p), totalOf(m, P[i - 1])) : null }));
  const st = sortState(Q, 'fy', { sort: 'year', dir: 'desc' });
  const sorted = sortRows(rows, st, (r, k) => (k === 'year' ? r.i : k === 'name' ? r.name.toLowerCase() : k === 'chg' ? r.chg : r[k]));
  const th = (key, label, tip, num, fd) => sortTh({ label, sort: key, num, tip, tipHeader: tip !== label, firstDir: fd }, st, (k, dd) => setQ({ so: 'fy_' + k + ':' + dd }, true));
  const tbl = el('table', { id: 'famYears' }, el('thead', null, el('tr', null, th('year', 'Rok', 'Okres (rok, sezon albo te same dni). Kolejność chronologiczna', false, 'desc'), th('name', 'Produkt w tym roku', 'Produkty rodziny, które sprzedały się w tym okresie', false, 'asc'),
    th('qty', 'Sztuki', MEAS.qty.tip, true, 'desc'), th('value', 'Wartość', MEAS.value.tip, true, 'desc'), th('orders', 'Zamówienia', MEAS.orders.tip, true, 'desc'), th('avg', 'Średnia cena', MEAS.avg.tip, true, 'desc'),
    cmp ? th('chg', 'Zmiana', 'Zmiana miary „' + M.short + '” względem poprzedniego okresu z listy', true, 'desc') : null)),
    el('tbody', null, sorted.map(r => el('tr', { 'data-p': r.p.label, class: r.i === last ? 'is-sel' : null }, el('th', { scope: 'row' }, r.p.label, r.i === last ? el('span', { class: 'rp-role' }, ' bieżący') : null), el('td', { class: 'small' }, r.name),
      el('td', { class: 'n' }, qty(r.qty)), el('td', { class: 'n' }, zl0(r.value)), el('td', { class: 'n' }, int(r.orders)), el('td', { class: 'n' }, r.qty ? zl(r.avg) : '—'),
      cmp ? el('td', { class: 'n ' + (r.chg > 0 ? 'rp-up' : r.chg < 0 ? 'rp-down' : '') }, pctFmt(r.chg)) : null))));
  const table = el('section', { class: 'card rp-card', id: 'famYearsCard' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Wiersz = okres. Sumy obejmują wszystkie produkty rodziny. Bieżący okres liczony jest do dziś, wcześniejsze do tego samego dnia (opcja „Porównuj do dzisiejszego dnia”).' }, 'Rodzina rok do roku'), el('span', { class: 'rp-grow' }),
    downloadMenuButton('famYearsDl', () => ({ sheet: 'Rodzina', file: 'raport-rodzina-' + fam.name.replace(/[^\w]+/g, '-').slice(0, 30), columns: [{ header: 'Okres', type: 'text', width: 12 }, { header: 'Produkty', type: 'text', width: 44 }, { header: 'Sztuki', type: 'number', width: 12 }, { header: 'Wartość', type: 'number', width: 14 }, { header: 'Zamówienia', type: 'number', width: 12 }, { header: 'Średnia cena', type: 'number', width: 12 }],
      rows: rows.map(r => [r.p.label, r.name, r.qty, r.value, r.orders, r.avg]), note: 'Rodzina: ' + fam.name + ' · ' + c.sentence() }), null, false, { cls: 'secondary', label: 'Pobierz', title: 'Pobierz tabelę rodziny rok do roku jako Excel albo CSV' })),
    el('div', { class: 'table-wrap' }, tbl));
  // produkty-członkowie × okresy
  const memRows = fam.members.map(x => ({ x, vs: P.map(p => { const e = p.members.find(y => y.id === x.id); return e ? e[m === 'avg' ? 'avg' : m] : 0; }) }));
  const mt = el('table', { id: 'famMemTable' }, el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Produkt Selly należący do rodziny' }, 'Produkt')), el('th', null, el('span', { title: 'Rok albo sezon wyciągnięty z nazwy' }, 'Rok')), ...P.map(p => el('th', { class: 'n' }, el('span', { class: 'tip', title: M.label + ' w okresie ' + p.label }, p.label))))),
    el('tbody', null, memRows.map(r => el('tr', { 'data-id': r.x.id }, el('td', null, el('a', { href: '#/produkty/' + encodeURIComponent(r.x.id), title: 'Karta produktu w panelu' }, r.x.name)), el('td', null, r.x.label || '—'), ...r.vs.map(v => el('td', { class: 'n' }, v ? M.fmt(v) : '—'))))));
  const mem = el('section', { class: 'card rp-card', id: 'famMem' }, el('div', { class: 'rp-head' }, el('h2', { class: 'tip', title: 'Który produkt Selly „niósł” rodzinę w danym roku' }, 'Produkty rodziny w poszczególnych latach')), el('div', { class: 'table-wrap' }, mt));
  return [head, kpis, bars, line, table, mem, editBox(c, d)];
}

// ─── Edycja rodzin (zaawansowane, administrator) ────────────────────────────

function editBox(c, d) {
  const { api, setQ } = c, fam = d.family, box = el('details', { class: 'card rp-card rp-raw', id: 'famEdit' }, el('summary', { title: 'Opcja zaawansowana: zmiana składu i nazwy rodziny. Zmiana jest wspólna dla wszystkich użytkowników i zapisywana w dzienniku zmian.' }, 'Edytuj rodzinę (zaawansowane)'));
  if (!FL.list || !FL.list.editable) { box.append(el('p', { class: 'muted', id: 'famNoEdit' }, 'Rodziny poprawia administrator panelu — ta zmiana jest wspólna dla wszystkich użytkowników.')); return box; }
  const msg = el('p', { class: 'muted small', id: 'famEditMsg', role: 'status' });
  const run = async (params, ok, after) => { msg.textContent = 'Zapisywanie…'; try { const r = await api('reports:familySave', params); resetFamilies(); flash('', ok); msg.textContent = ok; if (after) after(r); else c.reload(); } catch (e) { msg.textContent = 'Nie zapisano: ' + e.message; } };
  const checks = fam.members.map(x => el('label', { class: 'menu-check' }, el('input', { type: 'checkbox', value: x.id }), el('span', null, x.name + (x.label ? ' · ' + x.label : ''))));
  const picked = () => checks.map(l => l.firstChild).filter(cb => cb.checked).map(cb => cb.value);
  const nameIn = el('input', { type: 'text', id: 'famRename', value: fam.name, maxlength: 120, 'aria-label': 'Nazwa rodziny', title: 'Nazwa rodziny pokazywana w raportach' });
  const others = (FL.list.families || []).filter(f => f.id !== fam.id);
  const mergeSel = el('select', { id: 'famMergeSel', 'aria-label': 'Scal z rodziną', title: 'Rodzina, do której zostanie dołączony cały skład tej rodziny' }, el('option', { value: '' }, '— wybierz rodzinę —'), others.map(f => el('option', { value: f.id }, f.name + ' (' + f.members.length + ')')));
  const found = el('div', { class: 'rp-checks', id: 'famAddFound' });
  const addIn = el('input', { type: 'search', id: 'famAddSearch', placeholder: 'Szukaj produktu do dodania', 'aria-label': 'Dodaj produkt do rodziny', title: 'Wpisz co najmniej 2 znaki nazwy lub kodu produktu',
    oninput: debounce(async () => { if (addIn.value.trim().length < 2) { found.replaceChildren(); return; } const r = await api('reports:productSearch', { q: addIn.value.trim() }); found.replaceChildren(...r.products.filter(p => !fam.members.some(x => x.id === p.id)).map(p => el('button', { type: 'button', class: 'chip', title: 'Dodaj do rodziny', onclick: () => run({ op: 'move', productIds: [p.id], to: fam.id }, 'Dodano produkt do rodziny') }, '+ ' + p.name))); }, 300) });
  box.append(msg,
    el('div', { class: 'rp-stack' },
      el('div', { class: 'rp-field' }, el('label', null, 'Nazwa rodziny', nameIn), el('button', { type: 'button', class: 'secondary', id: 'famRenameBtn', title: 'Zapisz nową nazwę rodziny', onclick: () => run({ op: 'rename', id: fam.id, name: nameIn.value }, 'Zmieniono nazwę rodziny') }, 'Zapisz nazwę')),
      el('div', { class: 'rp-field' }, el('div', { class: 'small muted' }, 'Zaznacz produkty, aby je usunąć z rodziny albo wydzielić do nowej:'), el('div', { class: 'rp-checks' }, ...checks),
        el('div', { class: 'rp-opts-actions' }, el('button', { type: 'button', class: 'secondary', id: 'famRemoveBtn', title: 'Wyłącza zaznaczone produkty z rodziny (nie trafią do żadnej)', onclick: () => { const p = picked(); if (p.length) run({ op: 'move', productIds: p, to: '' }, 'Usunięto produkty z rodziny'); } }, 'Usuń z rodziny'),
          el('button', { type: 'button', class: 'secondary', id: 'famSplitBtn', title: 'Tworzy nową rodzinę z zaznaczonych produktów', onclick: () => { const p = picked(); if (p.length) run({ op: 'move', productIds: p, to: 'new', name: fam.name + ' (część)' }, 'Wydzielono nową rodzinę', r => setQ({ fam: r.id }, true)); } }, 'Wydziel do nowej rodziny'))),
      el('div', { class: 'rp-field' }, addIn, found),
      el('div', { class: 'rp-field' }, el('label', null, 'Scal z inną rodziną', mergeSel), el('button', { type: 'button', class: 'secondary', id: 'famMergeBtn', title: 'Dołącza wszystkie produkty tej rodziny do wybranej', onclick: () => { if (mergeSel.value) run({ op: 'merge', from: fam.id, into: mergeSel.value }, 'Scalono rodziny', () => setQ({ fam: mergeSel.value }, true)); } }, 'Scal')),
      fam.edited ? el('button', { type: 'button', class: 'secondary', id: 'famResetBtn', title: 'Usuwa ręczne poprawki tej rodziny i wraca do grupowania automatycznego', onclick: () => run({ op: 'reset', id: fam.id }, 'Przywrócono rodzinę automatyczną') }, 'Przywróć automatyczną') : null));
  return box;
}

export function rodzinyRender(c) {
  const d = c.d;
  if (d.mode === 'list') return listView(c, d);
  return yearsView(c, d);
}
