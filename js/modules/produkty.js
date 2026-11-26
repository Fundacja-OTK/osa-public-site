// Moduł „Produkty”: lista z filtrami (#/produkty?q=..&seg=..&page=..) i szczegóły (#/produkty/<id>).
// Dane i zapisy: backend Cloudflare (akcje products:list, products:get, products:update, products:setStock).
import { el, flash, menuButton, downloadXlsx, downloadCsv, tableMatrix, money, cnt, isUnavailable, sellyLink, syncedLabel, fetchAllRows, field, filterSection, saveBar, inlineInput, thumb, rowActions } from '../core/ui.js?v=802d849';
import { listView } from '../core/listView.js?v=802d849';
import { api, ctx } from '../core/client.js?v=802d849';
import { cachedRead } from '../core/cache.js?v=802d849';
import { go, addLeaveGuard } from '../core/router.js?v=802d849';
import { renderProductCard, closeProductCard } from './produktKarta.js?v=802d849';
import { warehousesScreen } from './produktMagazyny.js?v=802d849';
import { registerListKeys } from '../core/listKeys.js?v=802d849';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const SEGS = ['', 'zero', 'low', 'hidden', 'incomplete'];
const INCOMPLETE_TIP = 'Brakuje którejś z podstawowych rzeczy: zdjęcia głównego, opisu, kategorii, ceny (większej od 0) lub kodu EAN. Dokładniejszy wybór braków: filtr „Czego brakuje” w panelu filtrów.';
const MISSING_OPTS = [['photo', 'zdjęcia'], ['desc', 'opisu'], ['short', 'opisu skróconego'], ['addname', 'dopisku do nazwy'], ['promo', 'tekstu promocyjnego'],
  ['delivery', 'terminu wysyłki'], ['seotitle', 'tytułu SEO'], ['seodesc', 'opisu SEO'], ['seokeys', 'słów kluczowych'], ['ean', 'kodu EAN'], ['code', 'kodu producenta'],
  ['symbol', 'symbolu'], ['price', 'ceny'], ['category', 'kategorii'], ['producer', 'producenta']].map(([v, t]) => [v, 'brak ' + t]);
const SIZES = [25, 50, 100, 200];
// Eksport czyta z bazy panelu (nie z Selly — nie zużywa limitu API); górna granica tylko jako bezpiecznik
const EXPORT_MAX = 50000;
const LOW_DEFAULT = 5;
const MSG_UNAVAILABLE = 'Moduł Produkty wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = { root: null, listBox: null, detailBox: null, lv: null, ui: {}, edits: new Map(), ctx: new Map(), facets: null, facetsP: null, listHash: '#/produkty', routeSeq: 0, route: null };

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

// ─── Stan filtrów ↔ adres (core/listView.js; adres jak dawniej: ?q=&seg=&cat=&prd=&wh=&vis=&zdj=&lok=&low=&page=&sort=&dir=) ──────

// Segmenty i próg niskiego stanu to własne parametry adresu (extra); reszta filtrów to zwykłe filtry listy
const EXTRA = {
  read: get => ({ seg: SEGS.includes(get('seg')) ? get('seg') : '', low: Math.max(1, parseInt(get('low'), 10) || LOW_DEFAULT) }),
  write: (st, p) => { if (st.seg) p.set('seg', st.seg); if (st.low !== LOW_DEFAULT) p.set('low', String(st.low)); },
  clear: { seg: '' },
  active: st => (st.seg ? 1 : 0),
};
function listParams(st, extra) {
  const f = st.filters || {};
  const p = { sort: st.sort, dir: st.dir, pageSize: st.size, page: st.page };
  if (st.q) p.q = st.q;
  if (st.seg === 'zero') p.stock = 'zero';
  if (st.seg === 'low') { p.stock = 'low'; p.lowBelow = st.low; }
  if (st.seg === 'hidden' || f.vis === 'off') p.visible = false;
  else if (f.vis === 'on') p.visible = true;
  if (f.zdj) p.photo = f.zdj === 'on';
  if (f.cat) p.categoryId = f.cat;
  if (f.prd) p.producerId = f.prd;
  if (f.wh) p.whId = f.wh;
  if (f.lok) p.location = f.lok;
  if (st.seg === 'incomplete') p.missing = 'any';
  else if (f.brak) p.missing = f.brak;
  return Object.assign(p, extra);
}

// ─── Edycja w tabeli (zmiany zbierane i zapisywane naraz) ────────────────────

const dirtyRows = () => [...S.edits.values()].filter(e => e.fields().length);
const dirtyCount = () => dirtyRows().length;
function refreshDirty() {
  const rows = dirtyRows();
  for (const e of S.edits.values()) { const tr = e.el.closest('tr'); if (tr) tr.classList.toggle('dirty-row', e.fields().length > 0); }
  if (S.ui.bar) S.ui.bar.set(rows.length);
}
// Niezapisane zmiany w tabeli: przejście gdziekolwiek indziej (zmiana filtra, strony, karta produktu) wymaga potwierdzenia
addLeaveGuard(() => (dirtyCount() ? 'Masz niezapisane zmiany w tabeli produktów. Odrzucić je i przejść dalej?' : null));
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
  await reloadList();
  if (fail.length) S.ui.bar.say('Nie zapisano: ' + fail.join('; '));
}

// ─── Lista ──────────────────────────────────────────────────────────────────

const facetOpts = (F, key, noun) => ((F && F[key]) || []).map(x => [String(x.id), (x.name || noun + ' #' + x.id) + ' (' + x.n + ')']);
const FACET_KEYS = { cat: ['categories', 'Kategoria'], prd: ['producers', 'Producent'], wh: ['warehouses', 'Magazyn'] };
// słownik filtrów (bez danych osobowych): z pamięci karty / sessionStorage od razu, odświeżany w tle (liczniki mogą się zmienić)
function facetsOf(key) {
  if (!S.facetsP) {
    S.facetsP = cachedRead('products:facets', {}, { ttl: 2 * 60e3, personal: false, onUpdate: f => { S.facets = f; for (const k of Object.keys(FACET_KEYS)) S.lv.setOptions(k, facetOpts(f, FACET_KEYS[k][0], FACET_KEYS[k][1])); } })
      .then(f => { S.facets = f; return f; }, () => null);
  }
  return S.facetsP.then(F => facetOpts(F, FACET_KEYS[key][0], FACET_KEYS[key][1]));
}

function segChips() {
  const st = S.lv && S.lv.state;
  if (!st) return;
  const seg = (id, key, label, tip) => el('button', { type: 'button', class: 'chip', id, 'aria-pressed': String(st.seg === key), title: tip, onclick: () => S.lv.set({ seg: key }) }, label);
  S.ui.segs.replaceChildren(
    seg('prodSegAll', '', 'Wszystkie', 'Wszystkie produkty, bez względu na stan i widoczność'),
    seg('prodSegZero', 'zero', 'Brak na stanie', 'Produkty ze stanem 0 (lub mniejszym) w Selly'),
    seg('prodSegLow', 'low', 'Niski stan (1–' + st.low + ')', 'Produkty, których stan w Selly jest większy od 0 i nie większy niż ' + st.low + ' szt. Próg zmienisz w panelu filtrów (Niski stan).'),
    seg('prodSegHidden', 'hidden', 'Ukryte', 'Produkty niewidoczne w sklepie'),
    seg('prodSegIncomplete', 'incomplete', 'Niekompletne', INCOMPLETE_TIP));
}

function buildList() {
  const u = S.ui;
  u.segs = el('div', { class: 'ord-segs', role: 'group', 'aria-label': 'Które produkty pokazać' });
  u.info = el('div', { class: 'muted small ord-info' });
  u.low = el('input', { type: 'number', id: 'prodLow', min: '1', step: '1', 'aria-label': 'Próg niskiego stanu', value: String(LOW_DEFAULT),
    onchange: () => S.lv.set({ low: Math.max(1, parseInt(u.low.value, 10) || LOW_DEFAULT) }) });
  u.bar = saveBar({ id: 'prodBar', write: 'produkty', noun: 'produktów', onSave: saveAll, onUndo: undoAll });
  const exportBtn = menuButton({ id: 'prodExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz cały wynik filtra do pliku Excel lub CSV', items: () => {
    const tot = Math.min(S.lv.data ? S.lv.data.total : 0, EXPORT_MAX);
    const tip = 'Wszystkie produkty pasujące do bieżących filtrów, nie tylko ta strona';
    return [{ label: 'Cały wynik filtra — Excel (.xlsx)', count: tot, title: tip, run: () => exportAll('xlsx') }, { label: 'Cały wynik filtra — CSV (.csv)', count: tot, title: tip, run: () => exportAll('csv') }];
  } });
  const ID = { cat: 'prodCat', prd: 'prodPrd', wh: 'prodWh', lok: 'prodLok', vis: 'prodVis', zdj: 'prodZdj' };   // identyfikatory jak przed migracją
  const sel = (key, label, tip, all) => ({ key, id: ID[key], label, tip, all, section: 'Widok', type: 'select', options: () => facetsOf(key) });
  const lv = S.lv = listView({
    id: 'prod', route: '/produkty', title: 'Produkty', noun: ['produkt', 'produkty', 'produktów'], tableClass: 'rich',
    intro: [el('p', { class: 'muted small' }, 'Lista produktów ze sklepu (kopia odświeżana w tle). Ceny i widoczność poprawisz bezpośrednio w tabeli i zapiszesz wszystko naraz.')],
    headActions: [el('a', { class: 'btn-secondary', id: 'prodWhSettings', href: '#/produkty/magazyny', title: 'Magazyny Selly z ustawieniami: domyślny, sprzedaż mimo braku, ukrywanie przy braku, czas dostawy' }, 'Ustawienia magazynów'),
      el('a', { class: 'btn-primary', id: 'prodAdd', href: '#/produkty/nowy',
        title: 'Otwiera formularz nowego produktu (powstaje jako ukryty, dopóki go nie włączysz). Pełny formularz Selly jest dostępny z jego poziomu.' }, '+ Dodaj produkt')],
    search: { placeholder: 'Szukaj: nazwa, kod, symbol, EAN, ID', label: 'Szukaj produktów', tip: 'Szuka w nazwie, kodzie producenta, symbolu, kodzie EAN i numerze ID produktu' },
    filtersTip: 'Pokaż lub ukryj panel filtrów po lewej (kategoria, producent, magazyn, widoczność, próg niskiego stanu). Wybór jest zapamiętywany.',
    actions: [exportBtn], info: u.info, top: [u.segs], storeKey: 'produkty', columnsStore: 'osa-prod-cols',
    sizes: SIZES, defaultSize: 50, sizeStore: 'osa-prod-size', extra: EXTRA,
    defaultSort: { key: 'name', dir: 'asc' },
    columns: [
      { key: 'prod', label: 'Produkt', locked: true, tip: 'ID, zdjęcie, nazwa (do poprawienia w tabeli), kod, symbol i EAN produktu', tipHeader: true, sorts: [
        { label: 'Nazwa', sort: 'name', tip: 'Sortuj po nazwie produktu' }, { label: 'ID', sort: 'id', num: true, tip: 'Sortuj po numerze ID produktu' }, { label: 'Kod', sort: 'code', tip: 'Sortuj po kodzie producenta' },
        { label: 'EAN', sort: 'ean', tip: 'Sortuj po kodzie EAN (puste na końcu)' }], cell: r => ctxOf(r).prod },
      { key: 'price', label: 'Ceny i magazyn', locked: true, tip: PRICE_TIP, tipHeader: true, sorts: [
        { label: 'Cena', sort: 'price', num: true, tip: 'Sortuj po cenie brutto w złotych' }, { label: 'Stan', sort: 'qty', num: true, tip: 'Sortuj po stanie wg Selly' },
        { label: 'Lok.', sort: 'loc', tip: 'Sortuj po lokalizacji magazynowej (regał, półka); puste lokalizacje są zawsze na końcu' }], cell: r => ctxOf(r).price },
      { key: 'opts', label: 'Opcje', tip: 'Widoczność produktu w sklepie (do zmiany w tabeli). Pozostałe opcje z Selly (hit dnia, promocje, porównywarki) zmienisz w panelu Selly — API sklepu ich nie udostępnia.', tipHeader: true, cell: r => ctxOf(r).opts },
      { key: 'act', label: 'Działanie', tip: 'Skróty: szczegóły produktu, podgląd w sklepie, zamówienia z tym produktem, otwarcie w Selly', tipHeader: true, cell: r => ctxOf(r).act },
    ],
    filters: [
      sel('cat', 'Kategoria', 'Tylko produkty z wybranej kategorii głównej. Nazwy kategorii nie są dostępne w API sklepu — widzisz numer (i liczbę produktów).', 'Wszystkie kategorie'),
      sel('prd', 'Producent', 'Tylko produkty wybranego producenta. API sklepu nie podaje nazw producentów — widzisz numer (i liczbę produktów).', 'Wszyscy producenci'),
      sel('wh', 'Magazyn', 'Tylko produkty, których magazynem domyślnym jest wybrany magazyn', 'Wszystkie magazyny'),
      { key: 'lok', id: ID.lok, label: 'Lokalizacja zaczyna się od', section: 'Widok', type: 'text', placeholder: 'np. A1',
        tip: 'Tylko produkty, których lokalizacja magazynowa (regał, półka) zaczyna się od wpisanego tekstu, np. „A1” pokaże A1, A1-3, A12' },
      { key: 'brak', id: 'prodBrak', label: 'Czego brakuje', section: 'Status produktu', fold: true, all: 'Dowolnie', options: MISSING_OPTS,
        tip: 'Produkty bez wybranej rzeczy (zdjęcie, opis, kod EAN, kod producenta, symbol, pola SEO…) — widok „wg braków” z Selly, liczony na kopii produktów. Gdy włączone jest „Niekompletne”, ten wybór jest pomijany.' },
      { key: 'vis', id: ID.vis, label: 'Widoczność', section: 'Status produktu', tip: 'Czy produkt jest widoczny dla klientów w sklepie', all: 'Wszystkie', options: [['on', 'Wyświetlane w sklepie'], ['off', 'Ukryte']] },
      { key: 'zdj', id: ID.zdj, label: 'Zdjęcie', section: 'Status produktu', tip: 'Produkty, które mają (lub nie mają) zdjęcia głównego w sklepie — przydatne do uzupełniania braków', all: 'Wszystkie', options: [['on', 'ze zdjęciem'], ['off', 'bez zdjęcia']] },
    ],
    panelNodes: [filterSection('Niski stan', field('Niski stan: do (szt.)', u.low, 'Segment „Niski stan” pokazuje produkty, których stan w Selly jest większy od 0 i nie większy niż ta wartość'), { fold: true, tip: 'Ustawienia zaawansowane' })],
    load: st => api('products:list', listParams(st)),
    view: rows => { S.edits.clear(); S.ctx.clear(); queueMicrotask(refreshDirty); return rows; },   // nowy zestaw wierszy = bez niezapisanych zmian (pasek chowa się po wyrenderowaniu)
    onSync: () => { u.low.value = String(lv.state.low); segChips(); },
    onData: d => {
      u.info.replaceChildren(el('span', { class: 'tip', title: 'Lista pochodzi z kopii produktów synchronizowanej z Selly w tle — najświeższe zmiany mogą pojawić się z opóźnieniem.' }, 'dane z: ' + syncedLabel(d.syncedMs)));
    },
    above: d => (d.loading ? el('div', { class: 'notice warn', id: 'prodLoading', role: 'status' }, 'Trwa pierwsze pobieranie produktów ze sklepu — lista może być niepełna. Odśwież stronę za chwilę.') : null),
    empty: 'Brak produktów w kopii panelu — pojawią się po najbliższej synchronizacji z Selly.', emptyFiltered: 'Brak produktów pasujących do wybranych filtrów.',
    loadingText: 'Pobieram produkty…',
    errorBox: (e, retry) => el('div', { class: 'empty error', role: 'alert' }, isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać produktów.'), ' ',
      sellyLink('Panel Selly ↗', adminUrl() + '?a=produkty', 'Otwiera listę produktów w panelu Selly w nowej karcie'), el('div', null, el('button', { type: 'button', class: 'secondary', id: 'prodRetry', onclick: retry }, 'Spróbuj ponownie'))),
  });
  lv.u.results.after(u.bar.node);   // pasek niezapisanych zmian pod tabelą (lista bez zaznaczania nie ma własnego paska)
  S.listBox = lv.node;
  S.root.append(S.listBox);
}
const reloadList = () => S.lv.reload();

const PRICE_TIP = 'Cena brutto (do poprawienia w tabeli), cena poprzednia, stan wg Selly (suma ze wszystkich magazynów) oraz lokalizacja magazynowa (regał, półka — do poprawienia w tabeli). Czerwony stan: brak; żółty: niski (do progu z panelu filtrów).';

const STOCK_NOTE = 'Stany w poszczególnych magazynach odświeżają się w tle (co kilka dni, szybciej po zmianach), więc mogą być nieco nieaktualne; dokładne wartości są w szczegółach produktu.';
function stockTip(r) {
  let t = 'Stan wg Selly (suma ze wszystkich magazynów). Stan w poszczególnych magazynach zmienisz w szczegółach produktu.';
  if (r.stockWh && Object.keys(r.stockWh).length) t += '\n' + Object.entries(r.stockWh).map(([id, q]) => whName(id) + ': ' + num(q)).join('\n');
  return t + '\n' + STOCK_NOTE;
}

function ctxOf(r) {
  let c = S.ctx.get(r.id); if (!c) S.ctx.set(r.id, c = buildCtx(r)); return c;
}
function buildCtx(r) {
  const cell = (key, td) => td;
  const low = S.lv.state.low, qty = Number(r.qty), stCls = qty <= 0 ? 'stk-zero' : qty <= low ? 'stk-low' : '';
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
    id: r.id, el: inName, label,
    fields: () => [inName.isDirty() && 'name', inPrice.isDirty() && 'price', inLoc.isDirty() && 'warehouse_localisation', inVis.checked !== visOrig && 'visible'].filter(Boolean),
    values() { const o = {}; if (inName.isDirty()) o.name = inName.value; if (inPrice.isDirty()) o.price = inPrice.value; if (inLoc.isDirty()) o.warehouse_localisation = inLoc.value; if (inVis.checked !== visOrig) o.visible = inVis.checked; return o; },
    reset() { inName.reset(); inPrice.reset(); inLoc.reset(); inVis.checked = visOrig; },
  });
  const k = tr.cells; return { prod: k[0], price: k[1], opts: k[2], act: k[3] };
}
function openProduct(id) { S.listHash = location.hash; go('/produkty/' + encodeURIComponent(id)); }

// ─── Eksport ────────────────────────────────────────────────────────────────

const whName = id => { const w = S.facets && S.facets.warehouses && S.facets.warehouses.find(x => String(x.id) === String(id)); return w ? (w.name || 'Magazyn #' + id) : (id ? 'Magazyn #' + id : ''); };

async function exportAll(kind) {
  try {
    let whs = [];
    const { rows, total } = await fetchAllRows(async page => { const d = await api('products:list', listParams(S.lv.state, { page, pageSize: 200 })); if (d.warehouses) whs = d.warehouses; return d; }, EXPORT_MAX, 'produkty');
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


// Karta produktu i dodawanie (#/produkty/<id>, #/produkty/nowy): panel/app/js/modules/produktKarta.js
// Ustawienia magazynów Selly (#/produkty/magazyny): panel/app/js/modules/produktMagazyny.js
function renderDetail(id) {
  if (id === 'magazyny') { closeProductCard(); return warehousesScreen(S.detailBox, { listHash: S.listHash, unavailable: unavailableBox }); }
  return renderProductCard(S.detailBox, id, { listHash: S.listHash, unavailable: unavailableBox });
}

// ─── Trasa ──────────────────────────────────────────────────────────────────

function mountRoute() {
  const route = S.route;
  if (!S.lv) buildList();
  registerListKeys({ screen: 'produkty', table: 'prodTable', filters: 'prodFiltersBtn', export: 'prodExport', cols: 'prodCols', search: 'prodSearch', back: 'prodBack' });
  S.listBox.hidden = !!route.id; S.detailBox.hidden = !route.id;
  if (route.id) { S.lv.stop(); renderDetail(route.id); return; }
  S.routeSeq++;
  closeProductCard();
  S.listHash = location.hash || '#/produkty';
  S.lv.mount(route.query);
}

export default {
  id: 'produkty',
  title: 'Produkty',
  routes: ['', '<id>'],
  mount(el0, params) {
    if (!S.root) { S.root = el0; S.detailBox = el('div'); S.detailBox.hidden = true; el0.append(S.detailBox); }
    S.route = { id: (params && params.parts && params.parts[0]) || '', query: params && params.query };
    mountRoute();
  },
  unmount() { if (S.lv) S.lv.stop(); S.routeSeq++; closeProductCard(); },
};
