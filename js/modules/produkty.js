// Moduł „Produkty”: lista z filtrami (#/produkty?q=..&seg=..&page=..) i szczegóły (#/produkty/<id>).
// Dane i zapisy: backend Cloudflare (akcje products:list, products:get, products:update, products:setStock).
import { el, debounce, store, flash, menuButton, downloadXlsx, downloadCsv, tableMatrix, money, dateStr, cnt, isUnavailable, loadingBox, sellyLink, dl, sortTh, pager, syncedLabel, fetchAllRows, field, pageToolbar, filterLayout, filterSection, saveBar, inlineInput, columnMenu, thumb, rowActions } from '../core/ui.js?v=ead81e8';
import { api, ctx } from '../core/client.js?v=ead81e8';
import { go } from '../core/router.js?v=ead81e8';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const SORTS = ['name', 'code', 'price', 'qty', 'id', 'loc', 'ean', 'symbol'];
const SEGS = ['', 'zero', 'low', 'hidden'];
const SIZES = [25, 50, 100, 200];
// Eksport czyta z bazy panelu (nie z Selly — nie zużywa limitu API); górna granica tylko jako bezpiecznik
const EXPORT_MAX = 50000;
const LOW_DEFAULT = 5;
const MSG_UNAVAILABLE = 'Moduł Produkty wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = { root: null, listBox: null, detailBox: null, ui: {}, edits: new Map(), facets: undefined, Q: null, data: null, err: '', listHash: '#/produkty', seq: 0, routeSeq: 0, route: null };

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const sellyProductUrl = id => adminUrl() + '?a=produkty.zmienProdukt&id=' + encodeURIComponent(id);
const isUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v);
const isOn = v => v === true || v === 1 || v === '1' || v === 'true';
const num = v => (v == null || v === '' || isNaN(Number(v)) ? '—' : String(Number(v)));

function unavailableBox(extra) {
  return el('div', { class: 'card' }, el('div', { class: 'empty error' },
    el('p', null, el('strong', null, extra || MSG_UNAVAILABLE)),
    el('p', null, sellyLink('Otwórz produkty w panelu Selly ↗', adminUrl() + '?a=produkty', 'Otwiera listę produktów w panelu administracyjnym Selly w nowej karcie')),
    el('p', null, el('button', { type: 'button', class: 'secondary', onclick: () => mountRoute() }, 'Spróbuj ponownie'))));
}

// ─── Stan filtrów ↔ adres ───────────────────────────────────────────────────

const VIS = ['', 'on', 'off'];
function readQ(query) {
  const g = k => (query && query.get(k)) || '';
  const sort = SORTS.includes(g('sort')) ? g('sort') : 'name';
  return {
    q: g('q'), seg: SEGS.includes(g('seg')) ? g('seg') : '', low: Math.max(1, parseInt(g('low'), 10) || LOW_DEFAULT),
    cat: g('cat'), prd: g('prd'), lok: g('lok'), zdj: ['', 'on', 'off'].includes(g('zdj')) ? g('zdj') : '', wh: g('wh'), vis: VIS.includes(g('vis')) ? g('vis') : '',
    page: Math.max(1, parseInt(g('page'), 10) || 1), sort, dir: g('dir') === 'desc' ? 'desc' : g('dir') === 'asc' ? 'asc' : (sort === 'qty' || sort === 'price' ? 'desc' : 'asc'),
  };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  if (Q.q) p.set('q', Q.q);
  if (Q.seg) p.set('seg', Q.seg);
  for (const k of ['cat', 'prd', 'wh', 'vis', 'zdj', 'lok']) if (Q[k]) p.set(k, Q[k]);
  if (Q.low !== LOW_DEFAULT) p.set('low', String(Q.low));
  if (Q.page > 1) p.set('page', String(Q.page));
  if (Q.sort !== 'name' || Q.dir !== 'asc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  return s ? '?' + s : '';
}
const pageSize = () => { const v = store('osa-prod-size'); return SIZES.includes(v) ? v : 50; };
function listParams(Q, extra) {
  const p = { sort: Q.sort, dir: Q.dir, pageSize: pageSize(), page: Q.page };
  if (Q.q) p.q = Q.q;
  if (Q.seg === 'zero') p.stock = 'zero';
  if (Q.seg === 'low') { p.stock = 'low'; p.lowBelow = Q.low; }
  if (Q.seg === 'hidden' || Q.vis === 'off') p.visible = false;
  else if (Q.vis === 'on') p.visible = true;
  if (Q.zdj) p.photo = Q.zdj === 'on';
  if (Q.cat) p.categoryId = Q.cat;
  if (Q.prd) p.producerId = Q.prd;
  if (Q.wh) p.whId = Q.wh;
  if (Q.lok) p.location = Q.lok;
  return Object.assign(p, extra);
}
const FILTER_KEYS = ['q', 'seg', 'cat', 'prd', 'wh', 'vis', 'zdj', 'lok'];
const CLEAR = { q: '', seg: '', cat: '', prd: '', wh: '', vis: '', zdj: '', lok: '' };
function setQ(patch, replace) {
  if (dirtyCount() && !replace && !confirm('Masz niezapisane zmiany w tabeli. Odrzucić je i przejść dalej?')) { syncList(); return; }
  const n = Object.assign({}, S.Q, patch);
  if (!('page' in patch)) n.page = 1;
  const h = '/produkty' + qsOf(n);
  if (replace) go(h, { replace: true });
  else if (location.hash === '#' + h) { S.Q = n; loadList(); } else go(h);
}

// ─── Edycja w tabeli (zmiany zbierane i zapisywane naraz) ────────────────────

const dirtyRows = () => [...S.edits.values()].filter(e => e.fields().length);
const dirtyCount = () => dirtyRows().length;
function refreshDirty() {
  const rows = dirtyRows();
  for (const e of S.edits.values()) e.tr.classList.toggle('dirty-row', e.fields().length > 0);
  if (S.ui.bar) S.ui.bar.set(rows.length);
}
function undoAll() {
  for (const e of S.edits.values()) e.reset();
  S.ui.bar.say(''); refreshDirty();
}
async function saveAll() {
  const rows = dirtyRows();
  const bad = [];
  for (const e of rows) {
    const f = e.values();
    if ('price' in f && !(Number(f.price) >= 0 && String(f.price).trim() !== '')) bad.push(e.label + ': cena musi być liczbą nie mniejszą niż 0');
    if ('name' in f && !String(f.name).trim()) bad.push(e.label + ': nazwa nie może być pusta');
  }
  if (bad.length) { S.ui.bar.say(bad[0]); return; }
  S.ui.bar.busy(true); S.ui.bar.say('Zapisuję…');
  let ok = 0; const fail = [];
  for (const e of rows) {
    try { const v = e.values(); if ('price' in v) v.price = Number(v.price); if ('warehouse_localisation' in v) v.warehouse_localisation = String(v.warehouse_localisation).trim(); await api('products:update', { id: e.id, fields: v }); ok++; } catch (err) { fail.push(e.label + ': ' + (err.message || 'błąd')); }
  }
  S.ui.bar.busy(false);
  flash('', 'Zapisano w Selly: ' + cnt(ok, 'produkt', 'produkty', 'produktów') + (fail.length ? ' · błędy: ' + fail.length : ''));
  S.ui.bar.say(fail.length ? 'Nie zapisano: ' + fail.join('; ') : '');
  S.edits.clear();
  await loadList();
  if (fail.length) S.ui.bar.say('Nie zapisano: ' + fail.join('; '));
}

// ─── Lista ──────────────────────────────────────────────────────────────────

const selOpt = (label, items, cur, mk) => [el('option', { value: '' }, label), ...items.map(mk), ...(cur && !items.some(x => String(x.id) === cur) ? [el('option', { value: cur }, '#' + cur)] : [])];

function buildList() {
  const u = S.ui;
  u.search = el('input', { type: 'search', id: 'prodSearch', placeholder: 'Szukaj: nazwa, kod, symbol, EAN, ID', 'aria-label': 'Szukaj produktów',
    title: 'Szuka w nazwie, kodzie producenta, symbolu, kodzie EAN i numerze ID produktu',
    oninput: debounce(() => { const v = u.search.value.trim(); if (v !== S.Q.q) setQ({ q: v }, true); }, 350) });
  u.low = el('input', { type: 'number', id: 'prodLow', min: '1', step: '1', 'aria-label': 'Próg niskiego stanu',
    onchange: () => setQ({ low: Math.max(1, parseInt(u.low.value, 10) || LOW_DEFAULT) }) });
  u.cat = el('select', { id: 'prodCat', 'aria-label': 'Kategoria', onchange: ev => setQ({ cat: ev.target.value }) });
  u.prd = el('select', { id: 'prodPrd', 'aria-label': 'Producent', onchange: ev => setQ({ prd: ev.target.value }) });
  u.lok = el('input', { type: 'search', id: 'prodLok', placeholder: 'np. A1', 'aria-label': 'Lokalizacja zaczyna się od',
    oninput: debounce(() => { const v = u.lok.value.trim(); if (v !== S.Q.lok) setQ({ lok: v }, true); }, 350) });
  u.wh = el('select', { id: 'prodWh', 'aria-label': 'Magazyn', onchange: ev => setQ({ wh: ev.target.value }) });
  u.vis = el('select', { id: 'prodVis', 'aria-label': 'Widoczność w sklepie', onchange: ev => setQ({ vis: ev.target.value }) },
    el('option', { value: '' }, 'Wszystkie'), el('option', { value: 'on' }, 'Wyświetlane w sklepie'), el('option', { value: 'off' }, 'Ukryte'));
  u.zdj = el('select', { id: 'prodZdj', 'aria-label': 'Zdjęcie produktu', onchange: ev => setQ({ zdj: ev.target.value }) },
    el('option', { value: '' }, 'Wszystkie'), el('option', { value: 'on' }, 'ze zdjęciem'), el('option', { value: 'off' }, 'bez zdjęcia'));
  u.filtersBtn = el('button', { type: 'button', class: 'secondary', id: 'prodFiltersBtn', 'aria-controls': 'prodFilters',
    title: 'Pokaż lub ukryj panel filtrów po lewej (kategoria, producent, magazyn, widoczność, próg niskiego stanu). Wybór jest zapamiętywany.', onclick: () => { L.setOpen(!L.isOpen()); syncFiltersBtn(); } });
  u.clear = el('button', { type: 'button', class: 'ghost', id: 'prodClear', title: 'Usuń wyszukiwanie i wszystkie filtry', onclick: () => setQ({ ...CLEAR }) }, 'Wyczyść filtry');
  u.segs = el('div', { class: 'ord-segs', role: 'group', 'aria-label': 'Które produkty pokazać' });
  u.colMenu = columnMenu({ id: 'prodColsBtn', storeKey: 'osa-prod-cols', onChange: () => { if (S.data) renderList(); },
    cols: [
      { key: 'prod', label: 'Produkt', locked: true }, { key: 'price', label: 'Ceny i magazyn', locked: true },
      { key: 'opts', label: 'Opcje', tip: 'Widoczność produktu w sklepie (pole do zmiany w tabeli)' },
      { key: 'act', label: 'Działanie', tip: 'Skróty: szczegóły, podgląd w sklepie, zamówienia produktu, Selly' }] });
  u.exportBtn = menuButton({ id: 'prodExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz cały wynik filtra do pliku Excel lub CSV', items: () => {
    const tot = Math.min(S.data ? S.data.total : 0, EXPORT_MAX);
    const tip = 'Wszystkie produkty pasujące do bieżących filtrów, nie tylko ta strona';
    return [{ label: 'Cały wynik filtra — Excel (.xlsx)', count: tot, title: tip, run: () => exportAll('xlsx') }, { label: 'Cały wynik filtra — CSV (.csv)', count: tot, title: tip, run: () => exportAll('csv') }];
  } });
  u.info = el('div', { class: 'muted small ord-info' });
  u.notice = el('div');
  u.results = el('div', { id: 'prodResults' });
  u.bar = saveBar({ id: 'prodBar', noun: 'produktów', onSave: saveAll, onUndo: undoAll });
  const panelNodes = [
    filterSection('Widok', el('div', { class: 'fp-list' },
      el('div', { class: 'muted small' }, 'Podział listy jak „Produkty wg kategorii / producentów / magazynów”. Dostępne tylko podziały, które umiemy zbudować z danych sklepu.'),
      field('Kategoria', u.cat, 'Tylko produkty z wybranej kategorii głównej. Nazwy kategorii nie są dostępne w API sklepu — widzisz numer (i liczbę produktów).'),
      field('Producent', u.prd, 'Tylko produkty wybranego producenta. API sklepu nie podaje nazw producentów — widzisz numer (i liczbę produktów).'),
      field('Magazyn', u.wh, 'Tylko produkty, których magazynem domyślnym jest wybrany magazyn'),
      field('Lokalizacja zaczyna się od', u.lok, 'Tylko produkty, których lokalizacja magazynowa (regał, półka) zaczyna się od wpisanego tekstu, np. „A1” pokaże A1, A1-3, A12'))),
    filterSection('Status produktu', el('div', { class: 'fp-list' }, field('Widoczność', u.vis, 'Czy produkt jest widoczny dla klientów w sklepie'),
      field('Zdjęcie', u.zdj, 'Produkty, które mają (lub nie mają) zdjęcia głównego w sklepie — przydatne do uzupełniania braków'))),
    filterSection('Niski stan', field('Niski stan: do (szt.)', u.low, 'Segment „Niski stan” pokazuje produkty, których stan w Selly jest większy od 0 i nie większy niż ta wartość'), { fold: true, tip: 'Ustawienia zaawansowane' }),
    u.clear];
  const L = filterLayout({ key: 'produkty', panelId: 'prodFilters', panelNodes,
    mainNodes: [u.segs, el('div', { class: 'toolbar' }, u.search, u.exportBtn, u.colMenu.node, el('span', { class: 'spacer' }), u.info), u.notice, u.results, u.bar.node] });
  u.layout = L;
  const syncFiltersBtn = () => { const n = ['cat', 'prd', 'wh', 'vis', 'zdj', 'lok'].filter(k => S.Q && S.Q[k]).length; u.filtersBtn.setAttribute('aria-expanded', String(L.isOpen())); u.filtersBtn.textContent = 'Filtry' + (n ? ' (' + n + ')' : '') + (L.isOpen() ? ' ◂' : ' ▸'); u.filtersBtn.classList.toggle('on', n > 0); };
  u.syncFiltersBtn = syncFiltersBtn;
  u.filters = L.panel;
  S.listBox = el('div', { class: 'ord-list' }, el('div', { class: 'card' },
    pageToolbar({ title: 'Produkty', sub: 'Lista produktów ze sklepu (kopia odświeżana w tle). Ceny i widoczność poprawisz bezpośrednio w tabeli i zapiszesz wszystko naraz.',
      actions: [u.filtersBtn, el('a', { class: 'btn-primary', id: 'prodAdd', href: adminUrl() + '?a=produkty.nowyProdukt', target: '_blank', rel: 'noopener',
        title: 'Dodawanie produktów odbywa się w panelu Selly (panel OSA nie tworzy nowych produktów). Otwiera się w nowej karcie.' }, '+ Dodaj produkt')] }),
    L.node));
  S.root.append(S.listBox);
}
async function loadFacets() {
  if (S.facets !== undefined) return;
  S.facets = null;
  try { S.facets = await api('products:facets'); } catch (e) { S.facets = null; }
  if (S.ui.cat) syncList();
}
function syncList() {
  const u = S.ui, Q = S.Q;
  if (u.search.value.trim() !== Q.q) u.search.value = Q.q;
  u.low.value = String(Q.low);
  const F = S.facets || { categories: [], producers: [], warehouses: [] };
  u.cat.replaceChildren(...selOpt('Wszystkie kategorie', F.categories, Q.cat, x => el('option', { value: String(x.id) }, (x.name || 'Kategoria #' + x.id) + ' (' + x.n + ')'))); u.cat.value = Q.cat;
  u.prd.replaceChildren(...selOpt('Wszyscy producenci', F.producers, Q.prd, x => el('option', { value: String(x.id) }, (x.name || 'Producent #' + x.id) + ' (' + x.n + ')'))); u.prd.value = Q.prd;
  u.wh.replaceChildren(...selOpt('Wszystkie magazyny', F.warehouses, Q.wh, x => el('option', { value: String(x.id) }, (x.name || 'Magazyn #' + x.id) + ' (' + x.n + ')'))); u.wh.value = Q.wh;
  u.vis.value = Q.vis; u.zdj.value = Q.zdj; if (u.lok.value.trim() !== Q.lok) u.lok.value = Q.lok;
  u.clear.hidden = !FILTER_KEYS.some(k => Q[k]);
  u.syncFiltersBtn();
  const seg = (id, key, label, tip) => el('button', { type: 'button', class: 'chip', id, 'aria-pressed': String(Q.seg === key), title: tip, onclick: () => setQ({ seg: key }) }, label);
  u.segs.replaceChildren(
    seg('prodSegAll', '', 'Wszystkie', 'Wszystkie produkty, bez względu na stan i widoczność'),
    seg('prodSegZero', 'zero', 'Brak na stanie', 'Produkty ze stanem 0 (lub mniejszym) w Selly'),
    seg('prodSegLow', 'low', 'Niski stan (1–' + Q.low + ')', 'Produkty, których stan w Selly jest większy od 0 i nie większy niż ' + Q.low + ' szt. Próg zmienisz w panelu filtrów (Niski stan).'),
    seg('prodSegHidden', 'hidden', 'Ukryte', 'Produkty niewidoczne w sklepie'));
}

async function loadList() {
  const my = ++S.seq, u = S.ui;
  S.err = '';
  syncList();
  loadFacets();
  if (!S.data) u.results.replaceChildren(loadingBox('Pobieram produkty…'));
  else u.results.classList.add('fade');
  try {
    const r = await api('products:list', listParams(S.Q));
    if (my !== S.seq) return;
    S.data = r;
    const pages = Math.max(1, Math.ceil((r.total || 0) / (r.pageSize || 50)));
    if (S.Q.page > pages && r.total > 0) { setQ({ page: pages }, true); return; }
  } catch (e) {
    if (my !== S.seq) return;
    S.err = isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać produktów.');
  }
  u.results.classList.remove('fade');
  renderList();
}

function renderList() {
  const u = S.ui, d = S.data, Q = S.Q;
  S.edits.clear();
  if (S.err && !d) {
    u.info.textContent = ''; u.notice.replaceChildren();
    u.results.replaceChildren(el('div', { class: 'empty error' }, S.err, ' ', sellyLink('Panel Selly ↗', adminUrl() + '?a=produkty', 'Otwiera listę produktów w panelu Selly w nowej karcie'),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => loadList() }, 'Spróbuj ponownie'))));
    return;
  }
  const size = d.pageSize || pageSize(), pages = Math.max(1, Math.ceil(d.total / size));
  u.info.replaceChildren(el('span', { class: 'tip', title: 'Lista pochodzi z kopii produktów synchronizowanej z Selly w tle — najświeższe zmiany mogą pojawić się z opóźnieniem.' }, 'dane z: ' + syncedLabel(d.syncedMs)));
  u.notice.replaceChildren(d.loading ? el('div', { class: 'notice warn', id: 'prodLoading', role: 'status' }, 'Trwa pierwsze pobieranie produktów ze sklepu — lista może być niepełna. Odśwież stronę za chwilę.') : null);
  const COLS = [
    { key: 'prod', label: 'Produkt', tip: 'ID, zdjęcie, nazwa (do poprawienia w tabeli), kod, symbol i EAN produktu', tipHeader: true, sorts: [
      { label: 'Nazwa', sort: 'name', tip: 'Sortuj po nazwie produktu' }, { label: 'ID', sort: 'id', num: true, tip: 'Sortuj po numerze ID produktu' }, { label: 'Kod', sort: 'code', tip: 'Sortuj po kodzie producenta' },
      { label: 'EAN', sort: 'ean', tip: 'Sortuj po kodzie EAN (puste na końcu)' }] },
    { key: 'price', label: 'Ceny i magazyn', tip: 'Cena brutto (do poprawienia w tabeli), cena poprzednia, stan wg Selly (suma ze wszystkich magazynów) oraz lokalizacja magazynowa (regał, półka — do poprawienia w tabeli). Czerwony stan: brak; żółty: niski (do ' + Q.low + ' szt.).', tipHeader: true, sorts: [
      { label: 'Cena', sort: 'price', num: true, tip: 'Sortuj po cenie brutto w złotych' }, { label: 'Stan', sort: 'qty', num: true, tip: 'Sortuj po stanie wg Selly' },
      { label: 'Lok.', sort: 'loc', tip: 'Sortuj po lokalizacji magazynowej (regał, półka); puste lokalizacje są zawsze na końcu' }] },
    { key: 'opts', label: 'Opcje', tip: 'Widoczność produktu w sklepie (do zmiany w tabeli). Pozostałe opcje z Selly (hit dnia, promocje, porównywarki) zmienisz w panelu Selly — API sklepu ich nie udostępnia.', tipHeader: true },
    { key: 'act', label: 'Działanie', tip: 'Skróty: szczegóły produktu, podgląd w sklepie, zamówienia z tym produktem, otwarcie w Selly', tipHeader: true },
  ];
  const cols = COLS.filter(c => u.colMenu.isOn(c.key));
  const head = el('tr', null, cols.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir }))));
  const body = el('tbody');
  for (const r of d.rows) body.append(productRow(r));
  const filtered = FILTER_KEYS.some(k => Q[k]);
  if (!d.rows.length) body.append(el('tr', null, el('td', { colspan: String(cols.length), class: 'empty' },
    filtered ? 'Brak produktów pasujących do wybranych filtrów.' : 'Brak produktów.', ' ',
    filtered ? el('button', { type: 'button', class: 'secondary', onclick: () => setQ({ ...CLEAR }) }, 'Wyczyść filtry') : null)));
  u.results.replaceChildren(S.err ? el('div', { class: 'notice error' }, S.err) : null,
    el('div', { class: 'table-wrap' }, el('table', { id: 'prodTable', class: 'rich' }, el('thead', null, head), body)),
    pager({ prefix: 'prod', page: Q.page, pages, total: d.total, noun: ['produkt', 'produkty', 'produktów'], onPage: p => setQ({ page: p }),
      sizes: SIZES, size: pageSize(), onSize: n => { store('osa-prod-size', n); setQ({}); } }));
  refreshDirty();
}

const STOCK_NOTE = 'Stany w poszczególnych magazynach odświeżają się w tle (co kilka dni, szybciej po zmianach), więc mogą być nieco nieaktualne; dokładne wartości są w szczegółach produktu.';
function stockTip(r) {
  let t = 'Stan wg Selly (suma ze wszystkich magazynów). Stan w poszczególnych magazynach zmienisz w szczegółach produktu.';
  if (r.stockWh && Object.keys(r.stockWh).length) t += '\n' + Object.entries(r.stockWh).map(([id, q]) => whName(id) + ': ' + num(q)).join('\n');
  return t + '\n' + STOCK_NOTE;
}

function productRow(r) {
  const cell = (key, td) => (S.ui.colMenu.isOn(key) ? td : null);
  const Q = S.Q, qty = Number(r.qty), stCls = qty <= 0 ? 'stk-zero' : qty <= Q.low ? 'stk-low' : '';
  const label = (r.name || ('Produkt ' + r.id)).slice(0, 40);
  const inName = inlineInput({ value: r.name || '', cls: 'name', label: 'Nazwa produktu ' + r.id, tip: 'Nazwa produktu w sklepie — popraw i zapisz paskiem na dole', onChange: refreshDirty, attrs: { maxlength: '500', 'data-f': 'name' } });
  const inPrice = inlineInput({ value: r.price == null ? '' : String(r.price), type: 'number', cls: 'num', label: 'Cena brutto produktu ' + r.id, tip: 'Cena brutto w złotych — popraw i zapisz paskiem na dole', onChange: refreshDirty, attrs: { min: '0', step: '0.01', 'data-f': 'price' } });
  const inLoc = inlineInput({ value: r.location || '', cls: 'loc', label: 'Lokalizacja magazynowa produktu ' + r.id, tip: 'Lokalizacja magazynowa (np. regał, półka) — popraw i zapisz paskiem na dole', onChange: refreshDirty, attrs: { maxlength: '500', 'data-f': 'warehouse_localisation' } });
  const visOrig = !!Number(r.visible);
  const inVis = el('input', { type: 'checkbox', 'aria-label': 'Wyświetlany w sklepie: produkt ' + r.id, checked: visOrig, 'data-f': 'visible', onchange: refreshDirty });
  const detailHref = '#/produkty/' + encodeURIComponent(r.id);
  const keepList = () => { S.listHash = location.hash; };
  const tr = el('tr', { 'data-id': r.id },
    el('td', null, el('div', { class: 'prow' },
      el('div', { class: 'prow-id' }, el('div', { class: 'id-line' },
        el('a', { href: detailHref, class: 'big-id', title: 'Otwórz szczegóły produktu (stany w magazynach, warianty, ruchy)', onclick: keepList }, r.id),
        el('a', { href: detailHref, class: 'mini-ico', title: 'Edytuj produkt: szczegóły, stany w magazynach, warianty', 'aria-label': 'Edytuj produkt ' + r.id, onclick: keepList }, '✎')),
        thumb(r.photo, r.name)),
      el('div', { class: 'grow' }, inName,
        el('div', { class: 'cell-sub' }, [r.code && 'kod: ' + r.code, r.symbol && 'symbol: ' + r.symbol, r.ean && 'EAN: ' + r.ean].filter(Boolean).join(' · ')),
        r.hasVariants || r.isKit ? el('div', { class: 'cell-sub' },
          r.hasVariants ? el('span', { class: 'tag', title: 'Produkt ma warianty (np. rozmiary) — stany są w szczegółach' }, 'warianty') : null,
          r.isKit ? el('span', { class: 'tag', title: 'Zestaw złożony z kilku produktów' }, 'zestaw') : null) : null))),
    el('td', null, el('div', { class: 'price-box' },
      el('label', { class: 'pb-row', title: 'Cena brutto w sklepie, w złotych' }, 'Cena brutto (zł)', inPrice),
      Number(r.prevPrice) ? el('div', { class: 'pb-row', title: 'Cena przed obniżką (tylko do odczytu — zmienisz ją w panelu Selly)' }, el('span', { class: 'tip' }, 'Poprzednia'), el('span', { class: 'v' }, money(r.prevPrice))) : null,
      el('div', { class: 'pb-row', title: stockTip(r) }, el('span', { class: 'tip' }, 'Stan'),
        el('span', { class: 'v ' + stCls }, num(r.qty) + ' szt.')),
      el('label', { class: 'pb-row', title: 'Lokalizacja magazynowa (np. regał, półka) — popraw i zapisz paskiem na dole' }, el('span', { class: 'tip' }, 'Lokalizacja'), inLoc))),
    cell('opts', el('td', null, el('div', { class: 'opt-list' },
      el('label', { title: 'Czy produkt jest widoczny dla klientów w sklepie' }, inVis, 'wyświetlany'),
      Number(r.visible) ? null : el('span', { class: 'tag bad', title: 'Produkt jest ukryty w sklepie' }, 'ukryty')))),
    cell('act', el('td', null, rowActions([
      { label: 'edytuj produkt', href: detailHref, icon: '✎', tip: 'Szczegóły produktu: stany w magazynach, warianty, ruchy magazynowe', onclick: () => openProduct(r.id) },
      /^https?:\/\//i.test(r.uri || '') ? { label: 'podgląd', href: r.uri, icon: '👁', ext: true, tip: 'Strona produktu w sklepie (nowa karta)' } : null,
      { label: ['zamówienia produktu ', el('span', { class: 'muted' }, '(' + (r.ordersCount || 0) + ')')], href: '#/zamowienia?product=' + encodeURIComponent(r.id) + '&pname=' + encodeURIComponent(r.name || ''), icon: '🧾', tip: 'Zamówienia zawierające ten produkt: ' + (r.ordersCount || 0) },
      { label: 'w panelu Selly', href: sellyProductUrl(r.id), icon: '↗', ext: true, tip: 'Otwiera produkt w panelu Selly (tam: hit dnia, promocje, porównywarki, Allegro, usuwanie)' }]))));
  S.edits.set(r.id, {
    id: r.id, tr, label,
    fields: () => [inName.isDirty() && 'name', inPrice.isDirty() && 'price', inLoc.isDirty() && 'warehouse_localisation', inVis.checked !== visOrig && 'visible'].filter(Boolean),
    values() { const o = {}; if (inName.isDirty()) o.name = inName.value; if (inPrice.isDirty()) o.price = inPrice.value; if (inLoc.isDirty()) o.warehouse_localisation = inLoc.value; if (inVis.checked !== visOrig) o.visible = inVis.checked; return o; },
    reset() { inName.reset(); inPrice.reset(); inLoc.reset(); inVis.checked = visOrig; },
  });
  return tr;
}
function openProduct(id) { S.listHash = location.hash; go('/produkty/' + encodeURIComponent(id)); }

// ─── Eksport ────────────────────────────────────────────────────────────────

const whName = id => { const w = S.facets && S.facets.warehouses && S.facets.warehouses.find(x => String(x.id) === String(id)); return w ? (w.name || 'Magazyn #' + id) : (id ? 'Magazyn #' + id : ''); };

async function exportAll(kind) {
  try {
    let whs = [];
    const { rows, total } = await fetchAllRows(async page => { const d = await api('products:list', listParams(S.Q, { page, pageSize: 200 })); if (d.warehouses) whs = d.warehouses; return d; }, EXPORT_MAX, 'produkty');
    const dateOf = ms => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '');
    const t = {
      file: 'produkty', sheet: 'Produkty',
      columns: [{ header: 'ID', type: 'text' }, { header: 'Nazwa', type: 'text' }, { header: 'Kod', type: 'text' }, { header: 'Symbol', type: 'text' }, { header: 'EAN', type: 'text' },
        { header: 'Kategoria', type: 'text' }, { header: 'Producent', type: 'text' }, { header: 'Cena (zł)', type: 'number' }, { header: 'Stan (suma)', type: 'number' },
        { header: 'Magazyn domyślny', type: 'text' }, { header: 'Lokalizacja magazynowa', type: 'text' }, { header: 'Dostępność', type: 'text' }, { header: 'Widoczny', type: 'center' },
        ...whs.map(w => ({ header: 'Stan: ' + (w.name || 'Magazyn #' + w.id), type: 'number' })), { header: 'Stany magazynów z (odświeżane w tle)', type: 'text' }],
      rows: rows.map(r => [r.id, r.name || '', r.code || '', r.symbol || '', r.ean || '', r.categoryName || r.categoryId || '', r.producerName || r.producerId || '', r.price == null ? '' : Number(r.price), r.qty == null ? '' : Number(r.qty),
        whName(r.whId), r.location || '', r.availability || '', Number(r.visible) ? 'tak' : 'nie',
        ...whs.map(w => (r.stockWh && r.stockWh[w.id] != null ? Number(r.stockWh[w.id]) : '')), dateOf(r.stockMs)]),
    };
    if (kind === 'xlsx') downloadXlsx(t, ''); else downloadCsv(tableMatrix(t), t.file, '');
    if (total > EXPORT_MAX) flash('', 'Plik zawiera pierwsze ' + EXPORT_MAX + ' z ' + total + ' produktów — zawęź filtry, aby dostać resztę');
  } catch (e) { flash('', 'Nie udało się pobrać produktów: ' + (e.message || 'błąd')); }
}

// ─── Szczegóły ──────────────────────────────────────────────────────────────

const MOVE = { przyjecie: 'Przyjęcie', przesuniecie: 'Przesunięcie', wydanie: 'Wydanie', korekta: 'Korekta' };
const textVal = v => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(textVal).filter(Boolean).join(', ') : Object.entries(v).map(([k, x]) => k + ': ' + textVal(x)).join(', ')) : String(v));
const th = (label, tip, cls) => el('th', { class: cls || null }, el('span', { title: tip || label }, label));

async function renderDetail(id) {
  const my = ++S.routeSeq, box = S.detailBox;
  box.replaceChildren(el('div', { class: 'card' }, loadingBox('Pobieram produkt…')));
  let r;
  try { r = await api('products:get', { id }); } catch (e) {
    if (my !== S.routeSeq) return;
    box.replaceChildren(isUnavailable(e) ? unavailableBox() : el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się pobrać produktu: ' + (e.message || 'błąd'),
      el('div', null, el('a', { href: S.listHash, class: 'btn-link' }, '← Wróć do listy'), ' ', el('button', { type: 'button', class: 'secondary', onclick: () => renderDetail(id) }, 'Spróbuj ponownie')))));
    return;
  }
  if (my !== S.routeSeq) return;
  const p = r.product || {};
  const whName = wid => { const w = (r.warehouses || []).find(x => String(x.id) === String(wid)); return w ? w.name : (wid ? 'Magazyn ' + wid : '—'); };
  const editable = new Set(r.editable || []);
  const reload = () => { S.data = null; if (my === S.routeSeq) renderDetail(id); };

  // Dane podstawowe + edycja
  const inputs = {};
  const dlgSave = el('div', { id: 'prodSaveMsg', role: 'status' });
  const initial = {
    name: p.name || '', price: p.price == null ? '' : String(p.price), visible: isOn(p.visible),
    availability_id: p.availability_id == null ? '' : String(p.availability_id), warehouse_localisation: p.warehouse_localisation || '', ean: p.ean || '',
  };
  // Dostępność: lista nazw zebrana z produktów w bazie (API Selly nie ma słownika); bez listy — numer
  const availField = () => {
    if (!editable.has('availability_id')) return null;
    const opts = (r.availabilities || []).slice();
    if (!opts.length) return mk('availability_id', 'Dostępność (nr w Selly)', 'Numer dostępności z Selly. Bieżąca: ' + (p.availability || 'brak danych') + '.', { type: 'number', min: '0', step: '1' });
    if (initial.availability_id !== '' && !opts.some(o => String(o.id) === initial.availability_id)) opts.push({ id: initial.availability_id, name: p.availability || 'Dostępność nr ' + initial.availability_id });
    const sel = el('select', { id: 'prodF_availability_id', 'aria-label': 'Dostępność' }, opts.map(o => el('option', { value: String(o.id), selected: String(o.id) === initial.availability_id }, o.name || 'Dostępność nr ' + o.id)));
    inputs.availability_id = sel;
    return field('Dostępność', sel, 'Komunikat o dostępności widoczny w sklepie. Lista pochodzi z produktów w sklepie — nowe rodzaje dostępności dodasz w panelu Selly.');
  };
  const mk = (key, label, tip, attrs) => {
    if (!editable.has(key)) return null;
    const inp = el('input', Object.assign({ id: 'prodF_' + key, value: initial[key], 'aria-label': label }, attrs));
    inputs[key] = inp;
    return field(label, inp, tip);
  };
  const visInp = editable.has('visible') ? el('input', { type: 'checkbox', id: 'prodF_visible', checked: initial.visible, 'aria-label': 'Widoczny w sklepie' }) : null;
  if (visInp) inputs.visible = visInp;
  const form = el('div', { class: 'prod-form' },
    mk('name', 'Nazwa', 'Nazwa produktu widoczna w sklepie (nie może być pusta)', { type: 'text', maxlength: '500' }),
    mk('price', 'Cena brutto (zł)', 'Cena produktu w sklepie, w złotych brutto. Liczba nie mniejsza niż 0.', { type: 'number', min: '0', step: '0.01' }),
    visInp ? field('Widoczny w sklepie', visInp, 'Odznacz, aby ukryć produkt przed klientami') : null,
    availField(),
    mk('warehouse_localisation', 'Lokalizacja w magazynie', 'Opis miejsca składowania, np. regał i półka', { type: 'text', maxlength: '500' }),
    mk('ean', 'Kod EAN', 'Kod kreskowy produktu', { type: 'text', maxlength: '500' }));
  const collect = () => {
    const changed = {};
    for (const k of Object.keys(inputs)) {
      if (k === 'visible') { if (inputs.visible.checked !== initial.visible) changed.visible = inputs.visible.checked; continue; }
      const v = inputs[k].value;
      if (k === 'price' || k === 'availability_id') { if (v !== '' && Number(v) !== Number(initial[k])) changed[k] = Number(v); else if (v === '' && initial[k] !== '') changed[k] = NaN; }
      else if (v !== initial[k]) changed[k] = v;
    }
    return changed;
  };
  const saveBtn = el('button', { type: 'button', class: 'primary', id: 'prodSave', title: 'Zapisuje w Selly tylko te pola, które zmieniłeś', onclick: async () => {
    const ch = collect();
    if (!Object.keys(ch).length) { dlgSave.replaceChildren(el('div', { class: 'muted small' }, 'Nic nie zmieniono.')); return; }
    if ('price' in ch && !(ch.price >= 0)) { dlgSave.replaceChildren(el('div', { class: 'notice error' }, 'Cena musi być liczbą nie mniejszą niż 0.')); return; }
    if ('availability_id' in ch && !(ch.availability_id >= 0)) { dlgSave.replaceChildren(el('div', { class: 'notice error' }, 'Numer dostępności musi być liczbą nie mniejszą niż 0.')); return; }
    if ('name' in ch && !String(ch.name).trim()) { dlgSave.replaceChildren(el('div', { class: 'notice error' }, 'Nazwa nie może być pusta.')); return; }
    saveBtn.disabled = true;
    try { const res = await api('products:update', { id, fields: ch }); flash('', 'Zapisano w Selly: ' + (res && res.saved ? res.saved.length : Object.keys(ch).length) + ' ' + 'zmian'); reload(); }
    catch (e) { saveBtn.disabled = false; dlgSave.replaceChildren(el('div', { class: 'notice error' }, 'Nie udało się zapisać: ' + (e.message || 'błąd'))); }
  } }, 'Zapisz zmiany');
  const resetBtn = el('button', { type: 'button', class: 'secondary', id: 'prodReset', title: 'Przywraca wartości z ostatniego odczytu', onclick: () => renderDetail(id) }, 'Anuluj zmiany');

  // Stany w magazynach (na żywo z Selly)
  const stockHost = el('div', { id: 'prodStockDlg' });
  const stock = Array.isArray(r.stock) ? r.stock : [];
  const stockTip = 'Stan magazynowy zapisany w Selly dla tego produktu. Uwaga: stan fizyczny prowadzi moduł Magazyny (ruchy: przyjęcia, wydania, inwentaryzacja) — tutaj poprawiasz tylko liczbę widoczną w Selly, bez zapisu ruchu.';
  const stockRows = stock.map(s => {
    const wid = String(s.warehouse_id != null ? s.warehouse_id : s.id);
    const name = s.name || whName(wid);
    const inp = el('input', { type: 'number', min: '0', step: '1', value: String(s.quantity == null ? 0 : s.quantity), 'aria-label': 'Nowy stan w magazynie ' + name, 'data-wh': wid, class: 'qty-in' });
    const btn = el('button', { type: 'button', class: 'secondary', 'data-wh': wid, title: 'Ustaw ' + name + ' na wpisaną liczbę (zapytamy o potwierdzenie). ' + stockTip, onclick: () => {
      const q = Number(inp.value);
      if (inp.value === '' || !isFinite(q) || q < 0) { flash('', 'Ilość musi być liczbą nie mniejszą niż 0'); return; }
      confirmStock(wid, name, Number(s.quantity) || 0, q);
    } }, 'Ustaw');
    return el('tr', null, el('td', null, name), el('td', { class: 'n' }, num(s.quantity)), el('td', { class: 'n nw' }, s.purchase_price != null && s.purchase_price !== '' ? money(s.purchase_price) : ''), el('td', { class: 'nw' }, inp, ' ', btn));
  });
  function confirmStock(wid, name, from, to) {
    const close = () => stockHost.replaceChildren();
    stockHost.replaceChildren(el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Zmiana stanu w magazynie' },
      el('h3', null, 'Zmienić stan w magazynie „' + name + '”?'),
      el('p', null, 'Z ', el('strong', null, String(from)), ' na ', el('strong', null, String(to)), ' szt.'),
      el('p', { class: 'muted small' }, 'Zmiana zostanie zapisana w Selly. Nie tworzy ruchu w module Magazyny.'),
      el('div', { class: 'ord-actions' },
        el('button', { type: 'button', class: 'primary', id: 'prodStockConfirm', onclick: async () => {
          try { await api('products:setStock', { id, whId: wid, qty: to }); flash('', 'Stan zapisany w Selly'); reload(); }
          catch (e) { close(); flash('', 'Nie udało się zapisać stanu: ' + (e.message || 'błąd')); }
        } }, 'Zmień stan'),
        el('button', { type: 'button', class: 'secondary', id: 'prodStockCancel', onclick: close }, 'Anuluj'))));
  }
  const stockCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Stany w magazynach'), el('div', { class: 'sub tip', title: stockTip }, 'Dane na żywo z Selly — czym różni się od modułu Magazyny?')),
    r.stockError || !Array.isArray(r.stock) ? el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać stanów z Selly' + (r.stockError ? ' (' + textVal(r.stockError) + ')' : '') + '. Reszta danych jest aktualna.')
      : stockRows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'prodStock' }, el('thead', null, el('tr', null, th('Magazyn', 'Magazyn w Selly'), th('Stan', 'Stan w Selly (szt.)', 'n'), th('Cena zakupu (zł)', 'Cena zakupu przypisana do tego magazynu w Selly', 'n'), th('Ustaw stan', stockTip))), el('tbody', null, stockRows)))
        : el('div', { class: 'empty' }, 'Produkt nie ma przypisanych magazynów.'),
    stockHost);

  // Warianty
  const vs = Array.isArray(r.variants) ? r.variants : [];
  const variantCard = (vs.length || r.variantsError || p.has_variants) ? el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Warianty' + (vs.length ? ' (' + vs.length + ')' : ''))),
    r.variantsError ? el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać wariantów z Selly (' + textVal(r.variantsError) + ').')
      : vs.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'prodVariants' }, el('thead', null, el('tr', null, th('Wariant', 'Nazwa lub cechy wariantu'), th('Kod', 'Kod producenta wariantu'), th('EAN', 'Kod EAN wariantu'), th('Cena (zł)', 'Cena wariantu', 'n'), th('Stan', 'Stan wariantu w Selly (szt.)', 'n'))),
        el('tbody', null, vs.map(v => el('tr', null, el('td', null, textVal(v.name || v.features || v.variant_features || v.variant_name) || ('Wariant ' + (v.variant_id || v.id || ''))), el('td', null, v.product_code || v.code || v.symbol || ''), el('td', null, v.ean || ''),
          el('td', { class: 'n nw' }, v.price != null && v.price !== '' ? money(v.price) : ''), el('td', { class: 'n' }, v.quantity != null ? num(v.quantity) : '')))))) : el('div', { class: 'empty' }, 'Brak wariantów.')) : null;

  // Sprzedaż i ruchy
  const sales = r.sales || {};
  const salesCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Sprzedaż')),
    dl([['Zamówień z tym produktem', String(sales.orders || 0), 'Liczba różnych zamówień w kopii zamówień panelu, w których jest ten produkt'], ['Sprzedanych sztuk', String(sales.qty || 0), 'Suma sztuk z tych zamówień (anulowane też wchodzą do sumy)']]));
  const moves = r.moves || [];
  const movesCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Ostatnie ruchy magazynowe'), el('div', { class: 'sub' }, 'Ruchy zapisane w panelu OSA (moduł Magazyny) dla tego produktu.')),
    moves.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'prodMoves' }, el('thead', null, el('tr', null, th('Czas', 'Kiedy zapisano ruch'), th('Rodzaj', 'Przyjęcie, przesunięcie, wydanie lub korekta'), th('Ilość', 'Liczba sztuk', 'n'), th('Z', 'Magazyn źródłowy'), th('Do', 'Magazyn docelowy'), th('Zamówienie', 'Numer zamówienia, którego dotyczył ruch'), th('Autor', 'Kto zapisał ruch'), th('Notatka', 'Notatka do ruchu'))),
      el('tbody', null, moves.map(m => el('tr', null, el('td', { class: 'nw' }, m.ms ? dateStr(new Date(m.ms).toISOString()) : ''), el('td', null, MOVE[m.type] || m.type || ''), el('td', { class: 'n' }, num(m.qty)),
        el('td', null, m.fromWh ? whName(m.fromWh) : ''), el('td', null, m.toWh ? whName(m.toWh) : ''), el('td', null, m.orderNumber || ''), el('td', null, m.author || ''), el('td', null, m.note || '')))))) : el('div', { class: 'empty' }, 'Brak ruchów magazynowych w panelu.'));

  box.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'ord-detail-top' },
        el('a', { href: S.listHash, class: 'btn-link', id: 'prodBack', title: 'Wróć do listy z zachowanymi filtrami, wyszukiwaniem i stroną' }, '← Wróć do listy'), el('span', { class: 'spacer' }),
        el('span', { class: 'muted small tip', title: 'Dane z kopii produktów synchronizowanej z Selly w tle' }, 'dane z: ' + syncedLabel(r.syncedMs)),
        sellyLink('Otwórz w panelu Selly ↗', sellyProductUrl(id), 'Otwiera ten produkt w panelu administracyjnym Selly (tam zmienisz pola niedostępne tutaj)')),
      el('div', { class: 'card-head' }, el('h2', { id: 'prodTitle' }, p.name || ('Produkt ' + id)), el('div', { class: 'sub' }, 'ID ' + id)),
      el('div', { class: 'prod-top' }, isUrl(p.main_photo) ? el('img', { class: 'photo', src: p.main_photo, alt: '' }) : null,
        dl([['Kod producenta', p.product_code], ['Symbol', p.product_symbol], ['Stan łącznie (Selly)', p.quantity != null ? num(p.quantity) : '', 'Suma stanów ze wszystkich magazynów wg Selly'],
          ['Cena poprzednia (zł)', Number(p.previous_price) ? money(p.previous_price) : '', 'Cena przed obniżką'], ['Cena zakupu (zł)', Number(p.price_purchase) ? money(p.price_purchase) : ''],
          ['Waga', Number(p.weight) ? String(p.weight) : ''], ['Dostępność', p.availability], ['Wariantowy', isOn(p.has_variants) ? 'tak' : ''], ['Zestaw', isOn(p.kit) ? 'tak' : ''],
          ['Strona w sklepie', isUrl(p.uri) ? el('a', { href: p.uri, target: '_blank', rel: 'noopener' }, 'Otwórz ↗') : '']]))),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Edycja'), el('div', { class: 'sub' }, 'Zapisujemy tylko pola, które zmienisz. Zmiany trafiają od razu do Selly.')),
      form, dlgSave, el('div', { class: 'ord-actions' }, saveBtn, resetBtn)),
    stockCard, variantCard, salesCard, movesCard);
}

// ─── Trasa ──────────────────────────────────────────────────────────────────

function mountRoute() {
  const route = S.route;
  if (!S.ui.search) buildList();
  S.listBox.hidden = !!route.id; S.detailBox.hidden = !route.id;
  if (route.id) { renderDetail(route.id); return; }
  S.routeSeq++;
  S.Q = route.Q;
  S.listHash = location.hash || '#/produkty';
  loadList();
}

export default {
  id: 'produkty',
  title: 'Produkty',
  routes: ['', '<id>'],
  mount(el0, params) {
    if (!S.root) { S.root = el0; S.detailBox = el('div'); S.detailBox.hidden = true; el0.append(S.detailBox); }
    S.route = { id: (params && params.parts && params.parts[0]) || '', Q: readQ(params && params.query) };
    mountRoute();
  },
  unmount() { S.seq++; S.routeSeq++; },
};
