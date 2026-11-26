// Moduł „Magazyny”. Źródłem prawdy o stanach jest Selly: „Stany” pokazują stany Selly w każdym magazynie (kopia Workera odświeżana w tle —
// oglądanie nie odpytuje Selly), „Zmień stan” zapisuje w Selly (products:setStock / products:stockAdd — ta sama ścieżka co karta produktu,
// z podglądem „było → będzie” na stanie odczytanym na żywo: mag:sellyLive). Magazyn SpeedMail prowadzi moduł „Wysyłka SpeedMail” (#/speedmail).
// Ewidencja fizyczna panelu (mag:init / mag:moves: porównanie z Selly, inwentaryzacja, do rozliczenia, ruchy, historia) jest OPCJONALNA
// — osobna sekcja #/magazyny/ewidencja; nie zmienia stanów w Selly.
// Trasy: #/magazyny/stany, #/magazyny/zmiana[?p=<id>], #/magazyny/ewidencja, #/magazyny/{porownanie,inwentaryzacja,rozliczenie,ruch,historia,start};
// dawne #/magazyny/speedmail → #/speedmail.
import { $, el, plural, store, flash, norm, dateInput, sortMark, filterSection } from '../core/ui.js?v=63d59bb';
import { api } from '../core/client.js?v=63d59bb';
import { listView } from '../core/listView.js?v=63d59bb';
import { go } from '../core/router.js?v=63d59bb';

const TEMPLATE = `<div id="modMag"><nav class="viewnav" aria-label="Widok magazynów" id="magnav"></nav><div id="magBody"></div></div>`;

const mag = {
  data: null, loading: false, view: 'stany', err: '',
  hideEmpty: false, query: null, lvs: {},   // lvs: listy widoków Stany / Porównanie / Historia (core/listView.js); query: parametry adresu bieżącej trasy
  sel: new Map(),                      // „Do rozliczenia”: klucz pozycji → { on, wh }
  form: { type: 'przyjecie', product: '', qty: '', from: '', to: '', note: '' },
  inv: { wh: '', counts: {}, q: '', paste: '', unmatched: [], startDate: '', sort: { key: 'name', dir: 1 } },
  ss: null, ssErr: '',                 // stany wg Selly per magazyn (mag:sellyStock; null = niedostępne)
  showSellyWh: false,                  // porównanie: pokaż pod stanem z ewidencji stan wg Selly
  pv: null, pvErr: '', pvLoading: false, pvConfirm: false, pvOp: '',   // ewidencja: wszystkie magazyny wg Selly (#/magazyny/start)
  rf: null,                            // uzupełnianie stanów z Selly: { running, stop, checked, remaining, msg }
  chg: { type: 'przyjecie', product: '', qty: '', from: '', to: '', plan: null, err: '', busy: false, result: null },   // „Zmień stan” (zapis w Selly)
};
const MAG_VIEWS = [
  ['stany', 'Stany', 'Ile sztuk każdego produktu jest w każdym magazynie wg Selly'],
  ['zmiana', 'Zmień stan', 'Przyjęcie, przesunięcie między magazynami albo poprawka stanu — zapis od razu w Selly, z podglądem „było → będzie”'],
  ['wysylka', 'Wysyłka SpeedMail ↗', 'Kreator wysyłki do SpeedMail (osobny ekran) — tam jest też stan towaru w SpeedMail'],
  ['ewidencja', 'Ewidencja fizyczna (opcjonalnie)', 'Dla chętnych: własne liczenie towaru w panelu i porównanie z Selly. Nie zmienia stanów w Selly'],
];
const LEDGER_VIEWS = [
  ['porownanie', 'Porównanie z Selly', 'Stan z ewidencji panelu (policzony i zapisany w panelu) obok stanu w Selly, z różnicą'],
  ['inwentaryzacja', 'Inwentaryzacja', 'Policz towar w magazynie i wpisz, ile faktycznie jest — panel sam wyliczy korekty w ewidencji'],
  ['rozliczenie', 'Do rozliczenia', 'Wysłane zamówienia, z których w ewidencji jeszcze nie zapisano wydania towaru'],
  ['ruch', 'Ruch w ewidencji', 'Przyjęcie, przesunięcie albo korekta zapisane tylko w ewidencji panelu (Selly bez zmian)'],
  ['historia', 'Historia', 'Ostatnie ruchy w ewidencji (przyjęcia, przesunięcia, wydania, korekty)'],
];
const LEDGER_KEYS = new Set([...LEDGER_VIEWS.map(v => v[0]), 'start']);
const MOVE_NAMES = { przyjecie: 'Przyjęcie', przesuniecie: 'Przesunięcie', wydanie: 'Wydanie', korekta: 'Korekta' };
const MOVE_TIPS = {
  przyjecie: 'Towar dotarł do magazynu (np. dostawa, produkcja) — stan wybranego magazynu rośnie',
  przesuniecie: 'Towar przenosisz z jednego magazynu do drugiego — razem nic się nie zmienia',
  korekta: 'Ręczna poprawka stanu jednego magazynu (np. zgubiony lub znaleziony towar): + dodaje, − odejmuje',
};

const nf = n => (n == null || n === '' ? '—' : String(Math.round(n * 1000) / 1000).replace('.', ','));
const whName = id => { const w = mag.data && mag.data.warehouses.find(x => x.id === id); return w ? w.name : (id || ''); };
const prodLabel = p => p.name + (p.code ? ' · ' + p.code : '');
const isPartial = () => !(mag.data && mag.data.startMs);
const magDate = ms => (ms ? new Date(ms).toLocaleDateString('pl-PL') : '—');
const magKey = it => it.orderId + '|' + it.productOrderId;
const magTime = ms => (ms ? new Date(ms).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const isSm = w => /speed\s*mail/i.test(norm(w && w.name));
const LEDGER_TIP = 'Ewidencja fizyczna to Twoje własne liczenie towaru w panelu: pokazuje, gdzie to, co faktycznie leży na półce, nie zgadza się z Selly. Stanów w Selly nie zmienia.';
const SM_TIP = 'Stan magazynu SpeedMail w Selly nie mówi, co faktycznie leży w SpeedMail (Selly nie wie, kto pakuje) — towar w SpeedMail śledzi moduł „Wysyłka SpeedMail”.';
const STALE_TIP = 'Stan z wcześniejszego sprawdzenia — produkt zmienił się albo był zamówiony później. Odświeży się sam w tle (albo „Uzupełnij z Selly”).';
const UNKNOWN_TIP = 'Selly jeszcze nie sprawdzone dla tego produktu — panel uzupełnia stany magazynów w tle, kilka produktów na minutę.';

/** Stany wg Selly produktu: undefined = funkcja niedostępna (np. serwer zapasowy), null = jeszcze nie sprawdzony, { wh, ms, stale }. */
const sellyOf = p => (mag.ss && mag.ss.stock ? mag.ss.stock[p.id] || null : undefined);
const sellyWhQty = (s, wid) => (s && s.wh && s.wh[wid] != null ? Number(s.wh[wid]) : 0);

async function magLoadSelly() {
  try {
    const r = await api('mag:sellyStock', {});
    mag.ss = r && r.stock ? r : null; mag.ssErr = '';
  } catch (e) { mag.ss = null; mag.ssErr = e.message || 'błąd'; }
}

async function magLoad(extra) {
  mag.loading = true; mag.err = '';
  magRender();
  try {
    const ids = store('osa-mag-shipped');
    const p = Object.assign({}, extra);
    if (Array.isArray(ids)) p.shippedStatusIds = ids;
    const sel = magLoadSelly();   // równolegle; błąd nie blokuje widoku
    mag.data = Object.assign({ warehouses: [], products: [], pending: [], moves: [], statuses: [] }, await api('mag:init', p));   // brakujące listy = puste
    await sel;
    const keys = new Set(mag.data.pending.map(magKey));
    for (const k of [...mag.sel.keys()]) if (!keys.has(k)) mag.sel.delete(k);
    if (!mag.inv.wh && mag.data.warehouses.length) mag.inv.wh = (mag.data.warehouses.find(w => w.isDefault) || mag.data.warehouses[0]).id;
  } catch (e) { mag.err = e.message || 'Nie udało się pobrać danych magazynów.'; }
  mag.loading = false;
  magRender();
}

/** Zapis ruchów ewidencji → toast, odświeżenie danych. Zwraca true przy sukcesie; błąd (np. walidacji backendu) pokazuje w msgBox. */
async function magSave(moves, msgBox, btn, startMs) {
  msgBox.replaceChildren();
  if (btn) btn.disabled = true;
  try {
    const params = { moves };
    if (startMs != null) params.startMs = startMs;
    const r = await api('mag:moves', params);
    flash('', 'Zapisano w ewidencji: ' + r.saved + (r.skipped ? ' (pominięto ' + r.skipped + ' — już rozliczone)' : ''));
    await magLoad();
    return true;
  } catch (e) {
    msgBox.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, e.message));
    if (btn) btn.disabled = false;
    return false;
  }
}

function magRender() {
  const root = $('magBody'), nav = $('magnav');
  if (!root) return;
  const inLedger = LEDGER_KEYS.has(mag.view) || mag.view === 'ewidencja';
  nav.replaceChildren(...MAG_VIEWS.map(([k, label, tip]) => el('a', { href: k === 'wysylka' ? '#/speedmail' : '#/magazyny/' + k,
    'aria-current': mag.view === k || (k === 'ewidencja' && inLedger) ? 'page' : null, title: tip }, label)));
  if (mag.loading && !mag.data) { root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), 'Pobieram stany magazynów…')))); return; }
  if (!mag.data) {
    root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się otworzyć magazynów: ' + mag.err, el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => magLoad() }, 'Spróbuj ponownie')))));
    return;
  }
  const v = { stany: magStany, zmiana: magZmiana, ewidencja: magEwidencja, porownanie: magPorownanie, rozliczenie: magRozliczenie, ruch: magRuch,
    inwentaryzacja: magInwent, historia: magHistoria, start: magStart }[mag.view];
  const parts = [];
  if (mag.err) parts.push(el('div', { class: 'notice error' }, mag.err));
  if (inLedger) parts.push(magLedgerNav());
  if (isPartial() && ['porownanie', 'rozliczenie', 'historia'].includes(mag.view)) parts.push(magLedgerOff());
  else parts.push(v());
  root.replaceChildren(...parts);
}

/** Podnawigacja ewidencji fizycznej (linki). */
function magLedgerNav() {
  return el('nav', { class: 'viewnav', id: 'magLedgerNav', 'aria-label': 'Ewidencja fizyczna' }, LEDGER_VIEWS.map(([k, label, tip]) => {
    const cnt = k === 'rozliczenie' && !isPartial() ? ' (' + mag.data.pending.length + ')' : '';
    return el('a', { href: '#/magazyny/' + k, 'aria-current': mag.view === k ? 'page' : null, title: tip + (cnt ? '\n\nLiczba w nawiasie = pozycje zamówień czekające na rozliczenie' : '') }, label + cnt);
  }));
}

/** Ewidencja fizyczna nie jest prowadzona — jak ją zacząć (opcjonalnie). */
function magLedgerOff() {
  return el('div', { class: 'card', id: 'magLedgerOff' }, el('div', { class: 'empty' },
    el('p', null, el('strong', null, 'Ewidencja fizyczna nie jest prowadzona')),
    el('p', null, 'To opcja dla chętnych — stany magazynów są w Selly (zakładka „Stany”). Jeśli chcesz porównywać z Selly to, co policzysz na półkach, zacznij od inwentaryzacji.'),
    magLedgerLinks()));
}
function magLedgerLinks() {
  return el('div', { class: 'row' },
    el('a', { class: 'btn-secondary', href: '#/magazyny/inwentaryzacja', id: 'magManualLink', title: 'Policz towar w magazynie i wpisz ilości (formularz można wypełnić stanami z Selly i poprawić różnice)' }, 'Policz towar (inwentaryzacja)'),
    el('a', { class: 'btn-secondary', href: '#/magazyny/start', id: 'magAllFromSelly', title: 'Wypełnia liczenie wszystkich magazynów naraz stanami z Selly (z podglądem) — gdy wiesz, że na półkach jest tyle, ile w Selly' }, 'Wszystkie magazyny wg Selly…'));
}

function magEwidencja() {
  const d = mag.data;
  return el('div', { class: 'card', id: 'magEwidencja' },
    el('h2', null, 'Ewidencja fizyczna (opcjonalnie)'),
    el('p', null, LEDGER_TIP),
    el('p', { class: 'muted small' }, 'Stany, które widzi sklep, są zawsze w Selly — zmieniaj je w zakładce „Zmień stan”. Towar w SpeedMail śledzi ', el('a', { href: '#/speedmail' }, 'Wysyłka SpeedMail'), '.'),
    isPartial() ? magLedgerLinks()
      : [el('p', null, 'Ewidencja prowadzona od ' + magDate(d.startMs) + '. Do rozliczenia: ' + d.pending.length + ' ' + plural(d.pending.length, 'pozycja', 'pozycje', 'pozycji') + '.'),
        el('div', { class: 'row' }, el('a', { class: 'btn-secondary', href: '#/magazyny/porownanie' }, 'Porównanie z Selly'), el('a', { class: 'btn-secondary', href: '#/magazyny/inwentaryzacja' }, 'Inwentaryzacja'))]);
}


/** Tabela z sortowaniem po kliknięciu w nagłówek. cols: { key, label, tip, num, val(row), cell(row) }. */
function magTable(cols, rows, sort, redraw, empty) {
  const c = cols.find(x => x.key === sort.key);
  if (c) rows = rows.slice().sort((a, b) => {
    const x = c.val(a), y = c.val(b), ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    return (c.num ? x - y : String(x).localeCompare(String(y), 'pl')) * sort.dir;
  });
  const head = el('tr', null, cols.map(col => {
    const active = sort.key === col.key, tip = col.tip || col.label;
    return el('th', { class: col.num ? 'n' : null, 'aria-sort': active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: col.tip ? 'tip' : null, title: tip + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
        onclick: () => { sort.dir = active ? -sort.dir : (col.num ? -1 : 1); sort.key = col.key; redraw(); } },
        col.label, sortMark(active, sort.dir > 0)));
  }));
  const body = el('tbody');
  if (!rows.length) body.append(el('tr', null, el('td', { colspan: String(cols.length), class: 'empty' }, empty || 'Brak danych.')));
  for (const r of rows) body.append(el('tr', null, cols.map(col => el('td', { class: col.num ? 'n' : null }, col.cell(r)))));
  return el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, head), body));
}

const prodCell = p => [el('div', { class: 'cell-name' }, p.name), p.code ? el('div', { class: 'muted small' }, p.code) : null];

// ── Stany (wg Selly) ─────────────────────────────────────────────────────
const unknownCell = () => el('span', { class: 'muted tip', title: UNKNOWN_TIP }, '?');
/** Komórka stanu wg Selly w magazynie: ? = nieznany, ≈ = starsze dane, ujemny wyróżniony. */
function sellyCell(s, wid) {
  if (s === undefined) return el('span', { class: 'muted' }, '—');
  if (!s) return unknownCell();
  const x = sellyWhQty(s, wid);
  if (x < 0) return el('span', { class: 'diffbad tip', title: 'Stan ujemny w Selly' }, nf(x));
  return s.stale ? el('span', { class: 'tip', title: STALE_TIP }, '≈ ' + nf(x)) : nf(x);
}

/** Lista widoku (Stany / Porównanie / Historia) przeżywa przerysowania widoku: nowa dopiero po nowych danych (mag.data / mag.ss). */
function magLv(view, make) {
  const c = mag.lvs[view];
  if (c && c.data === mag.data && c.ss === mag.ss) return c.lv;
  const lv = make();
  mag.lvs[view] = { data: mag.data, ss: mag.ss, lv };
  return lv;
}
const PRODUCTS_NOUN = ['produkt', 'produkty', 'produktów'];
const PRODUCT_SEARCH = { placeholder: 'Szukaj po nazwie lub kodzie…', label: 'Szukaj produktu', tip: 'Szuka w nazwie i kodzie produktu' };
const SIZES = [50, 100, 200, 500];

function magStany() {
  const d = mag.data, sm = d.warehouses.find(isSm);
  const whEmpty = w => !d.products.some(p => sellyWhQty(sellyOf(p), w.id) !== 0);
  const hide = el('input', { type: 'checkbox', id: 'magHideEmpty', checked: mag.hideEmpty, onchange: ev => { mag.hideEmpty = ev.target.checked; lv.render(); } });
  const lv = magLv('stany', () => listView({
    id: 'magSt', route: '/magazyny/stany', noun: PRODUCTS_NOUN, search: PRODUCT_SEARCH, sizes: SIZES, defaultSize: 100, sizeStore: 'osa-mag-size',
    columns: [
      { key: 'name', label: 'Produkt', sort: true, tip: 'Nazwa produktu i jego kod', value: p => p.name, cell: prodCell },
      ...d.warehouses.map(w => ({ key: 'wh:' + w.id, wh: w, label: w.name + (isSm(w) ? ' *' : ''), sort: true, num: true,
        tip: 'Ile sztuk jest w magazynie „' + w.name + '” wg Selly (z ostatniego sprawdzenia). ? = jeszcze nie sprawdzone, ≈ = starsze dane' + (isSm(w) ? '\n\n* ' + SM_TIP : ''),
        value: p => { const s = sellyOf(p); return s ? sellyWhQty(s, w.id) : null; }, cell: p => sellyCell(sellyOf(p), w.id) })),
      { key: 'selly', label: 'Razem', sort: true, num: true, tip: 'Stan produktu wg Selly łącznie (wszystkie magazyny) — z listy produktów, aktualizowany na bieżąco', value: p => p.selly, cell: p => el('strong', null, nf(p.selly)) },
      { key: 'act', label: '', tip: 'Zmień stan tego produktu w Selly',
        cell: p => el('a', { href: '#/magazyny/zmiana?p=' + encodeURIComponent(p.id), class: 'btn-quiet small', title: 'Przyjęcie, przesunięcie albo poprawka stanu „' + p.name + '” — zapis w Selly z podglądem' }, 'Zmień') },
    ],
    defaultSort: { key: 'name', dir: 'asc' }, local: { searchFields: p => [p.name, p.code] }, load: () => ({ rows: mag.data.products }),
    hideCol: c => !!(mag.hideEmpty && c.wh && whEmpty(c.wh)),
    empty: 'Brak produktów w kopii panelu — pojawią się po najbliższej synchronizacji z Selly.', emptyFiltered: 'Żaden produkt nie pasuje do wyszukiwania — zmień lub wyczyść wyszukiwanie.',
    actions: [el('a', { class: 'btn-secondary', href: '#/magazyny/zmiana', title: 'Przyjęcie, przesunięcie między magazynami albo poprawka stanu — zapis w Selly z podglądem' }, 'Zmień stan'),
      el('button', { type: 'button', class: 'secondary', title: 'Pobierz ponownie kopię stanów z panelu (bez obciążania Selly)', onclick: () => magLoad() }, '↻ Odśwież')],
    above: () => [d.stockError ? el('div', { class: 'notice warn' }, 'Nie udało się pobrać stanów z Selly: ' + d.stockError) : null, magCoverage()],
    panelNodes: [filterSection('Ustawienia zaawansowane', el('label', { title: 'Chowa kolumny magazynów, w których wszystkie produkty mają stan 0 (kolumna „Razem” nadal liczy wszystkie magazyny)' }, hide, 'Ukryj magazyny, w których wszędzie jest 0'), { fold: true })],
  }));
  hide.checked = mag.hideEmpty;
  lv.mount(mag.query);
  return el('div', null, lv.node,
    sm ? el('p', { class: 'muted small', id: 'magSmNote' }, '* ' + sm.name + ': stan w Selly nie mówi, co faktycznie leży w SpeedMail — to śledzi ', el('a', { href: '#/speedmail' }, 'Wysyłka SpeedMail'), '.') : null);
}

// ── Porównanie ewidencji fizycznej z Selly ───────────────────────────────
function magPorownanie() {
  const d = mag.data, hasSs = !!(mag.ss && mag.ss.stock);
  const tot = p => d.warehouses.reduce((s, w) => s + (p.phys[w.id] || 0), 0);
  const diff = p => (p.selly == null ? null : tot(p) - p.selly);
  const sw = el('input', { type: 'checkbox', id: 'magShowSellyWh', disabled: !hasSs || null, checked: mag.showSellyWh, onchange: ev => { mag.showSellyWh = ev.target.checked; lv.render(); } });
  const lv = magLv('porownanie', () => listView({
    id: 'magCmp', route: '/magazyny/porownanie', noun: PRODUCTS_NOUN, search: PRODUCT_SEARCH, sizes: SIZES, defaultSize: 100, sizeStore: 'osa-mag-size',
    columns: [
      { key: 'name', label: 'Produkt', sort: true, tip: 'Nazwa produktu i jego kod', value: p => p.name, cell: prodCell },
      ...d.warehouses.map(w => ({ key: 'wh:' + w.id, label: w.name, sort: true, num: true,
        tip: 'Ile sztuk jest w magazynie „' + w.name + '” wg ewidencji panelu (policzone i ruchy od ' + magDate(d.startMs) + '); po włączeniu „Pokaż stan wg Selly” pod spodem — stan wg Selly',
        value: p => (p.phys[w.id] || 0), cell: p => {
          const ph = nf(p.phys[w.id] || 0);
          if (!mag.showSellyWh || !hasSs) return ph;
          const s = sellyOf(p), x = s ? sellyWhQty(s, w.id) : null;
          return [el('div', null, ph), el('div', { class: 'small ' + (x != null && x !== (p.phys[w.id] || 0) ? 'diffbad' : 'muted') }, 'Selly: ', s ? sellyCell(s, w.id) : unknownCell())];
        } })),
      { key: 'tot', label: 'Razem w ewidencji', sort: true, num: true, tip: 'Suma ze wszystkich magazynów wg ewidencji panelu', value: tot, cell: p => el('strong', null, nf(tot(p))) },
      { key: 'selly', label: 'Selly', sort: true, num: true, tip: 'Stan produktu wg Selly (łącznie, wszystkie magazyny)', value: p => p.selly, cell: p => nf(p.selly) },
      { key: 'diff', label: 'Różnica', sort: true, num: true, tip: 'Ewidencja − Selly. Różna od zera = to, co policzono w panelu, nie zgadza się z Selly', value: diff,
        cell: p => { const x = diff(p); return x == null ? '—' : el('span', { class: x !== 0 ? 'diffbad' : 'muted', title: x !== 0 ? (x > 0 ? 'W ewidencji jest więcej niż w Selly' : 'W ewidencji jest mniej niż w Selly') : null }, (x > 0 ? '+' : '') + nf(x)); } },
    ],
    defaultSort: { key: 'name', dir: 'asc' }, local: { searchFields: p => [p.name, p.code], match: (p, st) => !st.filters.diff || (diff(p) != null && diff(p) !== 0) },
    filters: [{ key: 'diff', label: 'Zgodność z Selly', tip: 'Pokaż tylko produkty, w których ewidencja różni się od Selly', all: 'wszystkie', options: [['1', 'tylko z różnicą']] }],
    load: () => ({ rows: mag.data.products }),
    empty: 'Brak produktów.', emptyFiltered: 'Brak wyników — przy filtrze „tylko z różnicą” oznacza to, że ewidencja zgadza się z Selly.',
    intro: [el('div', { class: 'muted small' }, 'Ewidencja panelu od ' + magDate(d.startMs) + ' (Twoje liczenie i ruchy) obok stanu w Selly. ', el('span', { class: 'tip', title: LEDGER_TIP }, 'Po co?'))],
    panelNodes: [filterSection('Widok', el('label', { title: hasSs ? 'W każdej komórce magazynu dopisuje stan wg Selly — różnice są wyróżnione' : 'Stany wg Selly w magazynach są chwilowo niedostępne' }, sw, 'Pokaż stan wg Selly w każdym magazynie'))],
  }));
  sw.checked = mag.showSellyWh;
  lv.mount(mag.query);
  return lv.node;
}

// ── Zmień stan (zapis w Selly) ────────────────────────────────────────────
const CHG_TIPS = {
  przyjecie: 'Towar dotarł (dostawa, produkcja) — stan w Selly w wybranym magazynie rośnie o podaną ilość',
  przesuniecie: 'Towar przenosisz między magazynami — w Selly ubywa w jednym, przybywa w drugim (dwa zapisy)',
  ustaw: 'Policzyłeś towar — stan w Selly w wybranym magazynie zostanie ustawiony na podaną liczbę',
};
const CHG_NAMES = { przyjecie: 'Przyjęcie', przesuniecie: 'Przesunięcie', ustaw: 'Popraw stan' };

/** Plan zapisów w Selly z bieżącego stanu (odczyt na żywo): [{ wh, was, will, attached }] albo błąd. */
function chgPlan(f, live) {
  const qty = parseFloat(String(f.qty).replace(',', '.'));
  const was = wid => Number(live.wh[wid]) || 0, att = wid => live.attached.includes(wid);
  if (!isFinite(qty) || (f.type !== 'ustaw' && qty <= 0) || qty < 0) return { err: f.type === 'ustaw' ? 'Wpisz stan (liczba ≥ 0).' : 'Wpisz ilość większą od zera.' };
  if (f.type === 'przyjecie') return { rows: [{ wh: f.to, was: was(f.to), will: was(f.to) + qty, attached: att(f.to) }] };
  if (f.type === 'ustaw') return { rows: [{ wh: f.to, was: was(f.to), will: qty, attached: att(f.to) }] };
  if (was(f.from) < qty) return { err: 'W magazynie „' + whName(f.from) + '” wg Selly jest teraz ' + nf(was(f.from)) + ' szt. — nie da się przesunąć ' + nf(qty) + '.' };
  return { rows: [{ wh: f.from, was: was(f.from), will: was(f.from) - qty, attached: att(f.from) }, { wh: f.to, was: was(f.to), will: was(f.to) + qty, attached: att(f.to) }] };
}

function magZmiana() {
  if (mag.chgPid) { const p = mag.data.products.find(x => x.id === mag.chgPid); if (p) mag.chg.product = prodLabel(p); mag.chgPid = null; }
  const f = mag.chg, d = mag.data, box = el('div'), fields = el('div', { class: 'mag-form' }), msg = el('div', { id: 'magChgMsg' });
  const dl = el('datalist', { id: 'magChgProducts' }, d.products.map(p => el('option', { value: prodLabel(p) })));
  const reset = () => { f.plan = null; f.err = ''; f.result = null; };
  const field = (label, tip, input) => el('label', { class: 'field' }, el('span', { class: 'label' }, el('span', { class: tip ? 'tip' : null, title: tip }, label)), input);
  const prod = el('input', { type: 'text', list: 'magChgProducts', value: f.product, placeholder: 'Zacznij pisać nazwę lub kod…', autocomplete: 'off', id: 'magChgProduct' });
  prod.addEventListener('input', () => { f.product = prod.value; reset(); paintPlan(); });
  const qty = el('input', { type: 'number', step: 'any', min: '0', value: f.qty, inputmode: 'decimal', id: 'magChgQty' });
  qty.addEventListener('input', () => { f.qty = qty.value; reset(); paintPlan(); });
  const whSel = (value, key, label, id) => { const s = el('select', { 'aria-label': label, id }, el('option', { value: '' }, '— wybierz —'), d.warehouses.map(w => el('option', { value: w.id }, w.name)));
    s.value = value; s.addEventListener('change', () => { f[key] = s.value; reset(); magRender(); }); return s; };
  const kinds = el('div', { class: 'seg wrap', role: 'group', 'aria-label': 'Rodzaj zmiany' }, ['przyjecie', 'przesuniecie', 'ustaw'].map(k =>
    el('button', { type: 'button', 'aria-pressed': String(f.type === k), title: CHG_TIPS[k], onclick: () => { f.type = k; reset(); magRender(); } }, CHG_NAMES[k])));
  fields.replaceChildren(field('Rodzaj zmiany', null, kinds), el('div', { class: 'muted small' }, CHG_TIPS[f.type]),
    field('Produkt', 'Wybierz z listy podpowiedzi: „nazwa · kod”', prod),
    field(f.type === 'ustaw' ? 'Stan po policzeniu (szt.)' : 'Ilość (szt.)', f.type === 'ustaw' ? 'Tyle sztuk będzie w Selly w wybranym magazynie' : null, qty),
    f.type === 'przesuniecie' ? field('Z magazynu', 'Magazyn, z którego zabierasz towar', whSel(f.from, 'from', 'Z magazynu', 'magChgFrom')) : null,
    field(f.type === 'przesuniecie' ? 'Do magazynu' : 'Magazyn', null, whSel(f.to, 'to', 'Magazyn', 'magChgTo')));
  const planBox = el('div', { id: 'magChgPlan' });
  const smWarn = [f.from, f.to].filter(Boolean).map(id => d.warehouses.find(w => w.id === id)).find(isSm);
  const preview = el('button', { type: 'button', class: 'secondary', id: 'magChgPreview', title: 'Odczytuje stan produktu w Selly na żywo (1 zapytanie) i pokazuje, co się zmieni — nic jeszcze nie zapisuje' }, 'Pokaż podgląd');
  const save = el('button', { type: 'button', class: 'primary', id: 'magChgSave', write: 'produkty', title: 'Zapisuje nowy stan w Selly (wymaga prawa zmian w sekcji „Produkty”)' }, 'Zapisz w Selly');
  const findP = () => findProduct(f.product);
  function paintPlan() {
    save.disabled = !(f.plan && f.plan.rows) || f.busy;
    if (!save.classList.contains('write-locked')) save.title = save.disabled ? 'Najpierw „Pokaż podgląd” — zapis idzie dokładnie według podglądu' : 'Zapisuje nowy stan w Selly (wymaga prawa zmian w sekcji „Produkty”)';
    if (f.result) { planBox.replaceChildren(f.result); return; }
    if (f.err) { planBox.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, f.err)); return; }
    if (!f.plan || !f.plan.rows) { planBox.replaceChildren(); return; }
    const th = (t, tip, n) => el('th', { class: n ? 'n' : null }, el('span', { class: tip === t ? null : 'tip', title: tip }, t));
    planBox.replaceChildren(
      el('div', { class: 'muted small' }, 'Stan w Selly odczytany ' + magTime(f.plan.ms) + ' — ' + f.plan.name + '.'),
      el('div', { class: 'table-wrap' }, el('table', { id: 'magChgTable' },
        el('thead', null, el('tr', null, th('Magazyn', 'Magazyn'), th('Było', 'Stan w Selly teraz (odczyt na żywo)', true), th('Będzie', 'Stan w Selly po zapisie', true))),
        el('tbody', null, f.plan.rows.map(r => el('tr', null, el('td', null, whName(r.wh), r.attached ? null : el('span', { class: 'muted small', title: 'Produkt nie jest jeszcze przypięty do tego magazynu w Selly — zapis go przypnie' }, ' (przypnie)')),
          el('td', { class: 'n' }, nf(r.was)), el('td', { class: 'n' }, el('strong', null, nf(r.will)))))))),
      f.plan.rows.length > 1 ? el('div', { class: 'muted small' }, 'Selly nie ma przesunięcia jednym zapisem — panel zapisze najpierw ubytek, potem przybytek. Jeśli drugi zapis się nie uda, zobaczysz to tutaj.') : null);
  }
  preview.addEventListener('click', async () => {
    reset();
    const p = findP();
    if (!p) { f.err = 'Wybierz produkt z listy podpowiedzi.'; return paintPlan(); }
    if (f.type === 'przesuniecie' && !f.from) { f.err = 'Wybierz magazyn, z którego przesuwasz.'; return paintPlan(); }
    if (!f.to) { f.err = 'Wybierz magazyn' + (f.type === 'przesuniecie' ? ' docelowy.' : '.'); return paintPlan(); }
    if (f.type === 'przesuniecie' && f.from === f.to) { f.err = 'Magazyn źródłowy i docelowy muszą być różne.'; return paintPlan(); }
    preview.disabled = true; planBox.replaceChildren(el('div', { class: 'loading' }, el('span', { class: 'spinner' }), ' Odczytuję stan w Selly…'));
    try {
      const live = await api('mag:sellyLive', { id: p.id });
      const plan = chgPlan(f, live);
      if (plan.err) f.err = plan.err; else f.plan = { ...plan, id: p.id, name: p.name, ms: live.ms };
    } catch (e) { f.err = 'Nie udało się odczytać stanu z Selly: ' + (e.message || 'błąd'); }
    preview.disabled = false; paintPlan();
  });
  save.addEventListener('click', async () => {
    const plan = f.plan; if (!plan || !plan.rows) return;
    f.busy = true; paintPlan();
    const done = [], failed = [];
    for (const r of plan.rows) {   // ubytek pierwszy (przesunięcie): przy błędzie drugiego zapisu towar nie „rozmnaża się” w Selly
      try {
        if (r.attached) await api('products:setStock', { id: plan.id, whId: r.wh, qty: r.will });
        else await api('products:stockAdd', { id: plan.id, whId: r.wh, qty: r.will });
        done.push(r);
      } catch (e) { failed.push({ r, msg: e.message || 'błąd' }); break; }
    }
    const left = plan.rows.slice(done.length + failed.length);
    f.busy = false; f.plan = null;
    f.result = failed.length
      ? el('div', { class: 'notice error', role: 'alert' }, (done.length ? 'Zapisano w Selly: ' + done.map(r => whName(r.wh) + ' = ' + nf(r.will)).join(', ') + '. ' : '') +
        'Nie zapisano: ' + whName(failed[0].r.wh) + ' (' + failed[0].msg + ')' + (left.length ? ' ani ' + left.map(r => whName(r.wh)).join(', ') : '') + '. Sprawdź stan w Selly i popraw go tutaj.')
      : el('div', { class: 'notice', role: 'status' }, 'Zapisano w Selly: ' + done.map(r => whName(r.wh) + ' ' + nf(r.was) + ' → ' + nf(r.will)).join(', ') + '.');
    if (!failed.length) { flash('', 'Zapisano w Selly'); f.qty = ''; }
    await magLoadSelly();
    magRender();
  });
  box.append(el('div', { class: 'card', id: 'magZmiana' }, el('h2', null, 'Zmień stan w Selly'),
    el('p', { class: 'muted small' }, 'Zmiana trafia od razu do Selly — sklep i wszystkie ekrany zobaczą nowy stan. Przed zapisem zobaczysz „było → będzie” według stanu odczytanego z Selly w tej chwili.'),
    dl, fields,
    smWarn ? el('div', { class: 'notice warn', id: 'magChgSm' }, SM_TIP + ' ', el('a', { href: '#/speedmail' }, 'Przejdź do Wysyłki SpeedMail')) : null,
    el('div', { class: 'row' }, preview, save), planBox, msg));
  paintPlan();
  return box;
}

/** Ile produktów ma już znane stany magazynów wg Selly, jak świeże są dane i „Uzupełnij z Selly”. */
function magCoverage() {
  const ss = mag.ss;
  if (!ss || !ss.stock) return el('div', { class: 'notice warn', id: 'magSellyCov' }, 'Stany magazynów wg Selly są chwilowo niedostępne' + (mag.ssErr ? ' (' + mag.ssErr + ')' : '') + '. Widać tylko stan łączny z Selly.');
  const left = ss.total - ss.known;
  const mins = left > 0 ? Math.ceil(left / Math.max(1, ss.perMin || 5)) : 0;
  return el('div', { id: 'magSellyCov', style: 'margin-top:8px' },
    el('div', { class: 'small' },
      el('span', { class: 'tip', title: 'Selly podaje stany magazynów osobno dla każdego produktu, więc panel sprawdza je w tle i trzyma kopię — oglądanie tej strony nie obciąża Selly' },
        'Stany magazynów znane dla ' + ss.known + ' z ' + ss.total + ' ' + plural(ss.total, 'produktu', 'produktów', 'produktów')),
      left ? ' · reszta uzupełni się sama w ok. ' + (mins < 60 ? mins + ' min' : Math.ceil(mins / 60) + ' godz.') : '',
      ss.stale ? [' · ', el('span', { class: 'tip', title: STALE_TIP }, plural(ss.stale, 'jeden ze starszymi danymi (≈)', ss.stale + ' ze starszymi danymi (≈)', ss.stale + ' ze starszymi danymi (≈)'))] : '',
      ss.oldestMs ? el('span', { class: 'muted' }, ' · dane z ' + (magTime(ss.oldestMs) === magTime(ss.newestMs) ? magTime(ss.newestMs) : magTime(ss.oldestMs) + ' – ' + magTime(ss.newestMs))) : ''),
    left ? el('progress', { max: String(ss.total), value: String(ss.known), 'aria-label': 'Sprawdzone stany magazynów' }) : null,
    left + ss.stale ? magRefreshBox(left + ss.stale, async () => { await magLoadSelly(); magRender(); }) : null);
}

/** „Uzupełnij z Selly”: porcje mag:sellyRefresh po kolei (z przerwami, gdy minuta Selly jest zajęta); można przerwać i wznowić. */
function magRefreshBox(needed, onDone) {
  const status = el('span', { class: 'muted small', id: 'magRefreshStatus', role: 'status' });
  const btn = el('button', { type: 'button', class: 'secondary', id: 'magRefreshGo',
    title: 'Sprawdza teraz w Selly stany produktów nieznanych i ze starszymi danymi: jedno zapytanie na produkt, porcjami i z przerwami, żeby nie zużyć limitu Selly. Można przerwać i wznowić później.' });
  const paint = () => {
    const rf = mag.rf;
    if (rf && rf.running) { btn.textContent = 'Zatrzymaj'; status.textContent = rf.msg || ('Sprawdzam w Selly… sprawdzono ' + rf.checked + (rf.remaining != null ? ', zostało ' + rf.remaining : '')); }
    else { btn.textContent = 'Uzupełnij z Selly (' + needed + ')'; status.textContent = (rf && rf.msg) || ''; }
  };
  btn.addEventListener('click', () => {
    if (mag.rf && mag.rf.running) { mag.rf.stop = true; mag.rf.msg = 'Zatrzymuję…'; paint(); return; }
    magRunRefresh(onDone);
  });
  paint();
  mag.rfPaint = paint;
  return el('div', { class: 'toolbar', id: 'magRefresh' }, btn, status);
}

async function magRunRefresh(onDone) {
  const rf = mag.rf = { running: true, stop: false, checked: 0, remaining: null, msg: '' };
  const paint = () => mag.rfPaint && mag.rfPaint();
  const pause = async s => { for (let t = 0; t < s * 2 && !rf.stop; t++) await new Promise(r => setTimeout(r, 500)); };
  let last = Infinity;
  paint();
  try {
    while (!rf.stop) {
      const r = await api('mag:sellyRefresh', { limit: 15 });
      if (r.paused) { rf.remaining = r.remaining; rf.msg = 'Selly ma teraz dużo zapytań — czekam ' + r.waitS + ' s i wznawiam sam…'; paint(); await pause(r.waitS); rf.msg = ''; continue; }
      rf.checked += r.checked || 0; rf.remaining = r.remaining; paint();
      if (!r.remaining || r.remaining >= last || !r.checked) break;
      last = r.remaining;
    }
    rf.msg = rf.stop ? 'Przerwano po sprawdzeniu ' + rf.checked + ' — możesz wznowić w każdej chwili.'
      : rf.remaining ? 'Sprawdzono ' + rf.checked + '; ' + rf.remaining + ' nie udało się teraz sprawdzić — panel spróbuje sam w tle.' : 'Gotowe — sprawdzono ' + rf.checked + '.';
  } catch (e) { rf.msg = 'Nie udało się: ' + (e.message || 'błąd'); }
  rf.running = false;
  await onDone();
  paint();
}

// ── Do rozliczenia ─────────────────────────────────────────────────────────
/** Magazyny wg Selly przeliczone na id naszych magazynów (backend może podać id albo nazwę). */
function sellyParts(it) {
  const ws = mag.data.warehouses;
  return (it.selly || []).map(s => { const w = ws.find(x => x.id === s.wh) || ws.find(x => norm(x.name) === norm(s.wh)); return { wh: w ? w.id : '', qty: s.qty, name: w ? w.name : String(s.wh) }; });
}
function selFor(it) {
  const k = magKey(it);
  if (!mag.sel.has(k)) {
    const parts = sellyParts(it);
    mag.sel.set(k, { on: false, wh: parts.length > 1 && parts.every(p => p.wh) ? 'split' : (parts.length === 1 ? parts[0].wh : '') });
  }
  return mag.sel.get(k);
}

function magRozliczenie() {
  const d = mag.data, box = el('div'), msg = el('div');
  const groups = new Map();
  for (const it of d.pending) { if (!groups.has(it.orderId)) groups.set(it.orderId, []); groups.get(it.orderId).push(it); }
  const checks = [];
  const ok = el('button', { type: 'button', write: 'magazyny',  title: 'Zapisuje wydanie towaru z wybranych magazynów dla zaznaczonych pozycji' }, 'Zatwierdź zaznaczone');
  const all = el('button', { type: 'button', class: 'secondary', title: 'Zaznacza (albo odznacza, gdy wszystkie są już zaznaczone) wszystkie pozycje na liście' }, 'Zaznacz wszystkie');
  const updBtn = () => { const n = d.pending.filter(it => selFor(it).on).length; ok.textContent = 'Zatwierdź zaznaczone' + (n ? ' (' + n + ')' : ''); ok.disabled = !n; };
  all.addEventListener('click', () => {
    const on = !d.pending.every(it => selFor(it).on);
    for (const it of d.pending) selFor(it).on = on;
    for (const c of checks) c.checked = on;
    updBtn();
  });
  ok.addEventListener('click', async () => {
    const moves = [];
    for (const it of d.pending) {
      const s = selFor(it); if (!s.on) continue;
      const base = { type: 'wydanie', productId: it.productId, productName: it.name, to: '', orderId: it.orderId, orderNumber: it.orderNumber, productOrderId: it.productOrderId, note: '' };
      if (s.wh === 'split') for (const p of sellyParts(it)) moves.push(Object.assign({}, base, { qty: p.qty, from: p.wh }));
      else if (!s.wh) { msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Wybierz magazyn („Wydano z”) przy pozycji: ' + it.name + ' (zamówienie ' + it.orderNumber + ').')); return; }
      else moves.push(Object.assign({}, base, { qty: it.qty, from: s.wh }));
    }
    await magSave(moves, msg, ok);
  });

  const list = el('div');
  const th = (t, tip, n) => el('th', { class: n ? 'n' : null }, el('span', { class: 'tip', title: tip }, t));
  for (const items of groups.values()) {
    const rows = items.map(it => {
      const s = selFor(it), parts = sellyParts(it);
      const cb = el('input', { type: 'checkbox', 'aria-label': 'Zaznacz: ' + it.name }); cb.checked = s.on;
      cb.addEventListener('change', () => { s.on = cb.checked; updBtn(); });
      checks.push(cb);
      const sel = el('select', { 'aria-label': 'Wydano z — ' + it.name });
      if (parts.length > 1) sel.append(el('option', { value: 'split' }, 'wg Selly: ' + parts.map(p => p.qty + '×' + p.name).join(' + ')));
      if (!s.wh) sel.append(el('option', { value: '' }, '— wybierz magazyn —'));
      for (const w of d.warehouses) sel.append(el('option', { value: w.id }, w.name));
      sel.value = s.wh;
      sel.addEventListener('change', () => { s.wh = sel.value; });
      return el('tr', null, el('td', null, cb), el('td', null, prodCell(it), it.variant ? el('div', { class: 'muted small' }, it.variant) : null), el('td', { class: 'n' }, nf(it.qty)), el('td', null, sel));
    });
    list.append(el('section', { class: 'card' },
      el('h3', null, 'Zamówienie ' + items[0].orderNumber, el('span', { class: 'muted small', style: 'font-weight:400' }, ' · ' + items[0].date)),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, th('✓', 'Zaznacz, aby zatwierdzić tę pozycję'), th('Produkt', 'Produkt z zamówienia'), th('Ilość', 'Ile sztuk w zamówieniu', true), th('Wydano z', 'Z którego magazynu wyszedł towar. Domyślnie tak, jak w Selly; wybór jednego magazynu zapisuje całą ilość z niego'))),
        el('tbody', null, rows)))));
  }
  const ids = store('osa-mag-shipped'), set = new Set(Array.isArray(ids) ? ids : d.statuses.filter(s => s.shipped).map(s => s.id));
  const stBox = el('div', { class: 'statuses' }, d.statuses.map(s => {
    const c = el('input', { type: 'checkbox', value: s.id }); c.checked = set.has(s.id);
    c.addEventListener('change', () => { store('osa-mag-shipped', [...stBox.querySelectorAll('input:checked')].map(i => i.value)); magLoad(); });
    return el('label', null, c, s.name);
  }));
  box.append(el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('strong', { class: 'count' }, d.pending.length + ' ' + plural(d.pending.length, 'pozycja', 'pozycje', 'pozycji') + ' do rozliczenia'), el('span', { class: 'sp' }), all, ok),
    el('div', { class: 'muted small' }, 'Wysłane zamówienia od ' + magDate(d.startMs) + ', z których nie zapisano jeszcze wydania towaru.'),
    msg,
    el('details', { class: 'fold' }, el('summary', null, el('span', null, 'Ustawienia zaawansowane')),
      el('p', { class: 'muted small' }, 'Które statusy zamówień uznajemy za „wysłane”. Zmiana odświeża listę.'), stBox)),
    d.pending.length ? list : el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Wszystko rozliczone.')));
  updBtn();
  return box;
}

// ── Nowy ruch ──────────────────────────────────────────────────────────────
function whSelect(value, onchange, label) {
  const s = el('select', { 'aria-label': label }, el('option', { value: '' }, '— wybierz —'), mag.data.warehouses.map(w => el('option', { value: w.id }, w.name)));
  s.value = value; s.addEventListener('change', () => onchange(s.value));
  return s;
}
function findProduct(text) {
  const t = norm(text.trim()); if (!t) return null;
  const ps = mag.data.products;
  return ps.find(p => norm(prodLabel(p)) === t) || ps.find(p => p.code && norm(p.code) === t) || ps.find(p => norm(p.name) === t) || null;
}

function magRuch() {
  const f = mag.form, d = mag.data, box = el('div'), msg = el('div'), fields = el('div', { class: 'mag-form' });
  const dl = el('datalist', { id: 'magProducts' }, d.products.map(p => el('option', { value: prodLabel(p) })));
  const draw = () => {
    const field = (label, tip, input) => el('label', { class: 'field' }, el('span', { class: 'label' }, el('span', { class: tip ? 'tip' : null, title: tip }, label)), input);
    const prod = el('input', { type: 'text', list: 'magProducts', value: f.product, placeholder: 'Zacznij pisać nazwę lub kod…', autocomplete: 'off' });
    prod.addEventListener('input', () => { f.product = prod.value; });
    const qty = el('input', { type: 'number', step: 'any', value: f.qty, inputmode: 'decimal' });
    qty.addEventListener('input', () => { f.qty = qty.value; });
    const note = el('input', { type: 'text', value: f.note, maxlength: '200', placeholder: 'np. dostawa od producenta (opcjonalnie)' });
    note.addEventListener('input', () => { f.note = note.value; });
    const kinds = el('div', { class: 'seg wrap', role: 'group', 'aria-label': 'Rodzaj ruchu' }, ['przyjecie', 'przesuniecie', 'korekta'].map(k =>
      el('button', { type: 'button', 'aria-pressed': String(f.type === k), title: MOVE_TIPS[k], onclick: () => { f.type = k; draw(); } }, MOVE_NAMES[k])));
    fields.replaceChildren(
      field('Rodzaj ruchu', null, kinds), el('div', { class: 'muted small' }, MOVE_TIPS[f.type]),
      field('Produkt', 'Wybierz z listy podpowiedzi: „nazwa · kod”', prod),
      field(f.type === 'korekta' ? 'Zmiana ilości (+ dodaje, − odejmuje)' : 'Ilość', f.type === 'korekta' ? 'Np. -2 gdy brakuje dwóch sztuk, 3 gdy znalazły się trzy' : null, qty),
      f.type === 'przesuniecie' ? field('Z magazynu', 'Magazyn, z którego zabierasz towar', whSelect(f.from, v => { f.from = v; }, 'Z magazynu')) : null,
      field(f.type === 'korekta' ? 'Magazyn' : 'Do magazynu', null, whSelect(f.to, v => { f.to = v; }, 'Magazyn docelowy')),
      field('Notatka', null, note));
  };
  const go = el('button', { type: 'button', write: 'magazyny' }, 'Zapisz ruch');
  go.addEventListener('click', async () => {
    const err = t => msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, t));
    const p = findProduct(f.product), q = parseFloat(String(f.qty).replace(',', '.'));
    if (!p) return err('Wybierz produkt z listy podpowiedzi.');
    if (!isFinite(q) || q === 0) return err('Wpisz ilość (różną od zera).');
    if (f.type !== 'korekta' && q < 0) return err('Ilość musi być dodatnia.');
    if (f.type === 'przesuniecie' && !f.from) return err('Wybierz magazyn, z którego przesuwasz.');
    if (!f.to) return err('Wybierz magazyn' + (f.type === 'przesuniecie' ? ' docelowy.' : '.'));
    if (f.type === 'przesuniecie' && f.from === f.to) return err('Magazyn źródłowy i docelowy muszą być różne.');
    const ok = await magSave([{ type: f.type, productId: p.id, productName: p.name, qty: q, from: f.type === 'przesuniecie' ? f.from : '', to: f.to, orderId: '', productOrderId: '', note: f.note }], msg, go);
    if (ok) { f.product = ''; f.qty = ''; f.note = ''; }
  });
  draw();
  box.append(el('div', { class: 'card' }, el('h2', null, 'Ruch w ewidencji'), el('p', { class: 'muted small' }, 'Zapis tylko w ewidencji fizycznej panelu — Selly się nie zmienia. Żeby zmienić stan w Selly, użyj ', el('a', { href: '#/magazyny/zmiana' }, 'Zmień stan'), '.'), dl, fields, msg, el('div', { class: 'row' }, go)));
  return box;
}

// ── Inwentaryzacja ────────────────────────────────────────────────────────
function magInwent() {
  const d = mag.data, iv = mag.inv, box = el('div'), msg = el('div'), out = el('div'), info = el('div');
  if (!iv.startDate) { const t = new Date(); iv.startDate = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  const counts = () => (iv.counts[iv.wh] = iv.counts[iv.wh] || {});
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
  const now = p => (p.phys[iv.wh] || 0);
  const cnt = p => num(counts()[p.id]);
  const cor = p => { const c = cnt(p); return c == null ? null : c - now(p); };
  const corNode = p => { const x = cor(p); return x == null ? '—' : el('span', { class: x !== 0 ? 'diffbad' : 'muted' }, (x > 0 ? '+' : '') + nf(x)); };
  const diffs = () => d.products.map(p => ({ p, d: cor(p) })).filter(x => x.d != null && x.d !== 0);
  const save = el('button', { type: 'button', write: 'magazyny' }, 'Zapisz inwentaryzację');
  const upd = () => { const n = diffs().length; save.disabled = (!n && !first) || !iv.wh; info.textContent = n ? 'Do zapisania: ' + n + ' ' + plural(n, 'korekta', 'korekty', 'korekt') + '.' : 'Wpisz ilości w kolumnie „Policzono” — zapisane zostaną tylko produkty, w których różnią się od „Teraz”.'; };
  const draw = () => {
    const qn = norm(iv.q);
    const rows = d.products.filter(p => !qn || norm(p.name + ' ' + p.code).includes(qn));
    const cols = [
      { key: 'name', label: 'Produkt', tip: 'Nazwa produktu i jego kod', val: p => p.name, cell: prodCell },
      { key: 'now', label: 'Teraz (wg panelu)', num: true, tip: 'Stan tego magazynu wg panelu: ruchy wpisane od startu ewidencji', val: now, cell: p => nf(now(p)) },
      { key: 'cnt', label: 'Policzono', num: true, tip: 'Ile faktycznie naliczyłeś. Puste pole = nie liczyłeś tego produktu (bez zmian)', val: cnt,
        cell: p => { const i = el('input', { type: 'number', step: 'any', inputmode: 'decimal', style: 'width:90px', 'aria-label': 'Policzono: ' + p.name, value: counts()[p.id] == null ? '' : counts()[p.id] });
          i.addEventListener('input', () => { counts()[p.id] = i.value; i.closest('tr').querySelector('.cor').replaceChildren(corNode(p)); upd(); }); return i; } },
      { key: 'cor', label: 'Korekta', num: true, tip: 'Policzono − Teraz. Tyle panel doda (+) albo odejmie (−) po zapisie', val: cor, cell: p => el('span', { class: 'cor' }, corNode(p)) },
    ];
    out.replaceChildren(magTable(cols, rows, iv.sort, draw, 'Brak produktów.'));
    upd();
  };

  const whSel = el('select', { 'aria-label': 'Magazyn do inwentaryzacji' }, d.warehouses.map(w => el('option', { value: w.id }, w.name)));
  whSel.value = iv.wh; whSel.addEventListener('change', () => { iv.wh = whSel.value; draw(); });
  const q = el('input', { type: 'search', placeholder: 'Szukaj po nazwie lub kodzie…', 'aria-label': 'Szukaj produktu', value: iv.q });
  q.addEventListener('input', () => { iv.q = q.value; draw(); });

  const pasteBox = el('textarea', { rows: '5', style: 'width:100%', placeholder: 'kod lub nazwa [Tab] ilość — po jednym produkcie w wierszu', 'aria-label': 'Wklej z Excela' }, iv.paste);
  const unm = el('div');
  const showUnm = () => unm.replaceChildren(iv.unmatched.length ? el('div', { class: 'notice warn' }, el('div', null, 'Nie dopasowano wierszy: ' + iv.unmatched.length), el('ul', null, iv.unmatched.map(t => el('li', null, t)))) : '');
  const load = el('button', { type: 'button', class: 'secondary', title: 'Dopasowuje wiersze po kodzie, a gdy się nie uda — po nazwie, i wpisuje ilości w kolumnę „Policzono”' }, 'Wczytaj wklejone');
  load.addEventListener('click', () => {
    iv.paste = pasteBox.value; iv.unmatched = []; let n = 0;
    for (const line of iv.paste.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let key, qty;
      const tab = line.split('\t').map(s => s.trim()).filter(s => s !== '');
      if (tab.length >= 2) { key = tab[0]; qty = tab[tab.length - 1]; } else { const m = line.trim().match(/^(.*\S)\s+(-?[\d.,]+)$/); if (m) { key = m[1]; qty = m[2]; } }
      const c = key == null ? null : num(qty), k = key && norm(key);
      const p = k && (d.products.find(x => x.code && norm(x.code) === k) || d.products.find(x => norm(x.name) === k));
      if (!p || c == null) { iv.unmatched.push(line.trim().slice(0, 120)); continue; }
      counts()[p.id] = String(c); n++;
    }
    showUnm(); draw();
    if (n) flash('', 'Wczytano ilości: ' + n);
  });

  const first = isPartial();
  const dateIn = dateInput({ value: iv.startDate, label: 'Data startu ewidencji', required: true });
  dateIn.addEventListener('input', () => { iv.startDate = dateIn.value; });
  save.addEventListener('click', async () => {
    const list = diffs();
    if (!list.length && !first) return;
    let startMs;
    if (first) { startMs = new Date(iv.startDate + 'T00:00:00').getTime(); if (!isFinite(startMs)) { msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Wpisz poprawną datę startu ewidencji.')); return; } }
    const moves = list.map(x => ({ type: 'korekta', productId: x.p.id, productName: x.p.name, qty: x.d, from: '', to: iv.wh, orderId: '', productOrderId: '', note: 'Inwentaryzacja' }));
    const done = await magSave(moves, msg, save, startMs);
    if (done) { delete iv.counts[iv.wh]; iv.unmatched = []; iv.paste = ''; }
  });

  // „Wypełnij stanami z Selly”: wpisuje w „Policzono” stany wybranego magazynu wg Selly — do poprawienia; nieznane i ujemne zostają puste
  const fillMsg = el('div', { id: 'magInvFillMsg' });
  const hasSs = !!(mag.ss && mag.ss.stock);
  const fill = el('button', { type: 'button', class: 'secondary', id: 'magInvFill', disabled: !hasSs || null,
    title: hasSs ? 'Wpisuje w kolumnę „Policzono” stany tego magazynu wg Selly (z ostatniego sprawdzenia) — popraw tylko to, co się nie zgadza. Produkty bez znanego stanu i z ujemnym stanem w Selly zostają puste.'
      : 'Stany magazynów wg Selly są chwilowo niedostępne' }, 'Wypełnij stanami z Selly');
  fill.addEventListener('click', () => {
    let n = 0, unknown = 0, neg = 0;
    for (const p of d.products) {
      const s = sellyOf(p);
      if (!s) { unknown++; continue; }
      const x = sellyWhQty(s, iv.wh);
      if (x < 0) { neg++; continue; }
      counts()[p.id] = String(x); n++;
    }
    draw();
    fillMsg.replaceChildren(unknown || neg ? el('div', { class: 'notice warn' }, 'Wpisano stany z Selly: ' + n + '. Puste zostały: ' +
      [unknown ? unknown + ' bez sprawdzonego stanu w Selly' : '', neg ? neg + ' z ujemnym stanem w Selly' : ''].filter(Boolean).join(', ') + ' — policz je i wpisz ręcznie.') : '');
    flash('', 'Wpisano stany z Selly: ' + n + ' — popraw to, co się nie zgadza');
  });

  box.append(el('div', { class: 'card' },
    el('h2', null, 'Inwentaryzacja (ewidencja fizyczna)'),
    el('p', { class: 'muted small', id: 'magInvInfo' }, 'Liczenie trafia do ewidencji fizycznej panelu, żeby porównać je z Selly — stanów w Selly nie zmienia (do tego jest „Zmień stan”). ' +
      'Możesz wypełnić formularz stanami z Selly i poprawić tylko różnice' + (first ? ', albo ' : '.'), first ? el('a', { href: '#/magazyny/start' }, 'wypełnić wszystkie magazyny naraz') : null, first ? '.' : null),
    el('div', { class: 'toolbar' }, el('label', null, 'Magazyn: ', whSel), q, fill,
      first ? el('label', { class: 'tip', title: 'Data liczenia (godz. 00:00): od niej ewidencja pokazuje w „Do rozliczenia” wysłane zamówienia. Ustawiana tylko przy pierwszym zapisie ewidencji — zwykle dzień, w którym liczysz towar.' }, 'Data liczenia: ', dateIn) : null),
    fillMsg,
    el('details', { class: 'fold' }, el('summary', null, el('span', null, 'Wklej z Excela')),
      el('p', { class: 'muted small' }, 'Dwie kolumny: kod (albo nazwa produktu) i ilość. Dopasowanie najpierw po kodzie, potem po nazwie.'), pasteBox, el('div', { class: 'row' }, load), unm),
    out, el('div', { class: 'muted small', style: 'margin-top:8px' }, info), msg, el('div', { class: 'row' }, save)));
  showUnm(); draw();
  return box;
}

// ── Start ewidencji ze stanów Selly (#/magazyny/start) ──────────────────────
async function magLoadPreview() {
  mag.pvLoading = true; mag.pvErr = '';
  try { mag.pv = await api('mag:sellyPreview', {}); } catch (e) { mag.pv = null; mag.pvErr = e.message || 'Nie udało się przygotować podglądu.'; }
  mag.pvLoading = false;
  magRender();
}

function magStart() {
  const back = el('a', { class: 'btn-secondary', href: '#/magazyny/ewidencja' }, '← Ewidencja');
  if (!mag.pv && !mag.pvLoading && !mag.pvErr) { mag.pvLoading = true; Promise.resolve().then(magLoadPreview); }
  if (!mag.pv) {
    return el('div', { class: 'card', id: 'magStart' }, mag.pvErr
      ? el('div', { class: 'empty error' }, 'Nie udało się przygotować podglądu: ' + mag.pvErr,
        el('div', { class: 'row' }, el('button', { type: 'button', class: 'secondary', onclick: () => { mag.pvErr = ''; magRender(); } }, 'Spróbuj ponownie'), back))
      : el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), 'Przygotowuję podgląd ze stanów Selly…')));
  }
  const pv = mag.pv, started = pv.started, msg = el('div');
  const th = (t, tip, n) => el('th', { class: n ? 'n' : null }, el('span', { class: tip === t ? null : 'tip', title: tip }, t));
  const whRows = pv.warehouses.filter(w => w.products || w.pieces);
  const more = (n, shown) => (n > shown ? el('li', { class: 'muted' }, '… i ' + (n - shown) + ' więcej') : null);
  const notices = [];
  if (pv.unknown.count) notices.push(el('div', { class: 'notice warn', id: 'magPvUnknown' },
    el('div', null, pv.unknown.count + ' ' + plural(pv.unknown.count, 'produkt nie ma', 'produkty nie mają', 'produktów nie ma') + ' jeszcze sprawdzonych stanów w magazynach Selly — ' +
      (started ? 'w ewidencji zostaną bez zmian' : 'nie trafią do ewidencji (będą w niej 0)') + '. Uzupełnij je z Selly przed zapisem albo policz później ręcznie.'),
    el('details', null, el('summary', null, 'Pokaż'), el('ul', null, pv.unknown.list.map(x => el('li', null, x.name || 'Produkt ' + x.id)), more(pv.unknown.count, pv.unknown.list.length)))));
  if (pv.negative.count) notices.push(el('div', { class: 'notice warn', id: 'magPvNeg' },
    el('div', null, pv.negative.count + ' ' + plural(pv.negative.count, 'pozycja ma', 'pozycje mają', 'pozycji ma') + ' w Selly stan ujemny — panel go nie przepisze (' +
      (started ? 'w ewidencji zostanie bez zmian' : 'w ewidencji będzie 0') + '). Popraw stan w Selly albo policz te produkty ręcznie.'),
    el('details', null, el('summary', null, 'Pokaż'), el('ul', null, pv.negative.list.map(x => el('li', null, (x.name || 'Produkt ' + x.id) + ' · ' + x.whName + ': ' + (x.qty == null ? 'nieczytelny' : nf(x.qty)))), more(pv.negative.count, pv.negative.list.length)))));
  if (pv.stale) notices.push(el('div', { class: 'muted small', id: 'magPvStale' }, pv.stale + ' ' + plural(pv.stale, 'produkt ma', 'produkty mają', 'produktów ma') +
    ' starsze dane (≈) — zmienił się albo był zamówiony po ostatnim sprawdzeniu stanów. Warto je najpierw uzupełnić.'));
  if (pv.otherWh) notices.push(el('div', { class: 'muted small' }, 'Pominięto ' + pv.otherWh + ' ' + plural(pv.otherWh, 'stan', 'stany', 'stanów') + ' w magazynach Selly, których nie ma na liście magazynów panelu.'));
  let block = '';
  if (!pv.magD1) block = 'Start ze stanów Selly działa, gdy ewidencja magazynu jest w bazie Workera. Teraz użyj „Policz ręcznie”.';
  else if (pv.moves > pv.maxMoves) block = 'To ' + pv.moves + ' pozycji — więcej, niż panel zapisze naraz (' + pv.maxMoves + '). Policz magazyny ręcznie po kolei (formularz można wypełnić stanami z Selly).';
  else if (!started && !pv.products) block = 'Panel nie zna jeszcze stanów żadnego produktu w magazynach Selly — uzupełnij je z Selly albo policz towar ręcznie.';
  const confirm = el('input', { type: 'checkbox', id: 'magPvConfirm' }); confirm.checked = mag.pvConfirm;
  const startBtn = el('button', { type: 'button', class: 'primary', id: 'magStartGo', write: 'magazyny',
    title: 'Zapisuje stany z Selly jako wynik liczenia w ewidencji fizycznej (Selly bez zmian)' },
  'Zapisz jako inwentaryzację');
  const upd = () => {
    startBtn.disabled = !!block || (started && (!pv.moves || !confirm.checked));
    if (!startBtn.classList.contains('write-locked')) startBtn.title = block ? block : started && !pv.moves ? 'Nie ma czego zmieniać — ewidencja zgadza się z Selly'
      : started && !confirm.checked ? 'Najpierw zaznacz potwierdzenie powyżej' : 'Zapisuje stany z Selly jako wynik liczenia w ewidencji fizycznej (Selly bez zmian)';
  };
  confirm.addEventListener('change', () => { mag.pvConfirm = confirm.checked; upd(); });
  startBtn.addEventListener('click', async () => {
    msg.replaceChildren(); startBtn.disabled = true;
    if (mag.pvOpKey !== pv.key) { mag.pvOp = 'sellystart-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); mag.pvOpKey = pv.key; }   // ten sam opId przy ponowieniu
    try {
      const r = await api('mag:sellyStart', Object.assign({ key: pv.key, opId: mag.pvOp }, started ? { newInventory: true } : {}));
      flash('', started ? 'Zapisano w ewidencji: ' + r.saved + ' ' + plural(r.saved, 'korekta', 'korekty', 'korekt')
        : 'Zapisano w ewidencji: ' + r.products + ' ' + plural(r.products, 'produkt', 'produkty', 'produktów') + ', ' + nf(r.pieces) + ' szt.');
      mag.pv = null; mag.pvOpKey = ''; mag.pvConfirm = false; mag.pvNote = '';
      await magLoad();
      go('/magazyny/porownanie');
    } catch (e) {
      if (/zmieniły się od podglądu/.test(e.message || '')) { mag.pvNote = e.message; mag.pv = null; mag.pvConfirm = false; magRender(); return; }
      msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, e.message || 'Nie udało się zapisać.'));
      upd();
    }
  });
  upd();
  const note = mag.pvNote; mag.pvNote = '';
  return el('div', { class: 'card', id: 'magStart' },
    el('h2', null, 'Ewidencja fizyczna: wszystkie magazyny wg Selly'),
    note ? el('div', { class: 'notice warn', role: 'status' }, note) : null,
    el('p', null, 'Zapisze obecne stany z Selly jako wynik liczenia we wszystkich magazynach ewidencji — tak, jakbyś je policzył i wpisał w inwentaryzacji. ' +
      (started ? 'Ewidencja jest prowadzona od ' + magDate(pv.startMs) + '; różnice zapiszą się jako korekty. ' : '') + 'Stany w Selly się nie zmieniają.'),
    el('p', { id: 'magPvSum' }, el('strong', null, started
      ? (pv.moves ? 'Do zmiany: ' + pv.moves + ' ' + plural(pv.moves, 'pozycja', 'pozycje', 'pozycji') + ' (w górę: ' + pv.up + ', w dół: ' + pv.down + ').' : 'Ewidencja zgadza się z Selly — nie ma czego zmieniać.')
      : 'Zapiszemy ' + pv.products + ' ' + plural(pv.products, 'produkt', 'produkty', 'produktów') + ' w ' + pv.pairs + ' ' + plural(pv.pairs, 'pozycji', 'pozycjach', 'pozycjach') +
        ' (produkt × magazyn), razem ' + nf(pv.pieces) + ' szt.')),
    whRows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'magPvWh' },
      el('thead', null, el('tr', null, th('Magazyn', 'Magazyn'), th('Produktów', 'Ile produktów ma w tym magazynie stan większy od 0 wg Selly', true), th('Sztuk', 'Suma sztuk w tym magazynie wg Selly', true))),
      el('tbody', null, whRows.map(w => el('tr', null, el('td', null, w.name), el('td', { class: 'n' }, String(w.products)), el('td', { class: 'n' }, nf(w.pieces))))))) : null,
    notices,
    pv.refresh.needed ? [magRefreshBox(pv.refresh.needed, async () => { await magLoadSelly(); await magLoadPreview(); }),
      el('div', { class: 'muted small' }, 'Uzupełnianie: ok. jedno zapytanie do Selly na produkt, porcjami po ' + pv.refresh.perCall + ' i z przerwami — reszta sklepu działa normalnie.')] : null,
    block ? el('div', { class: 'notice warn', id: 'magPvBlock' }, block) : null,
    started && pv.moves && !block ? el('label', { style: 'display:block;margin-top:8px', title: 'Potwierdzenie jest wymagane, bo ewidencja już trwa — zapis zmieni policzone wcześniej stany' }, confirm,
      ' Rozumiem: stany w ewidencji panelu zostaną zastąpione stanami z Selly (różnice zapiszą się jako korekty).') : null,
    msg,
    el('div', { class: 'row' }, startBtn,
      el('a', { class: 'btn-secondary', href: '#/magazyny/inwentaryzacja', title: 'Policz towar w jednym magazynie i wpisz ilości (formularz można wypełnić stanami z Selly)' }, 'Policz ręcznie'), back));
}

// ── Historia ───────────────────────────────────────────────────────────────
function magHistoria() {
  const lv = magLv('historia', () => listView({
    id: 'magHist', route: '/magazyny/historia', noun: ['ruch', 'ruchy', 'ruchów'], search: false, sizes: SIZES, defaultSize: 100, sizeStore: 'osa-mag-size',
    title: 'Historia ewidencji', intro: [el('div', { class: 'muted small' }, 'Ostatnie ruchy w ewidencji panelu (do 200), najnowsze pierwsze. Zmiany stanów w Selly są w historii produktu w Selly.')],
    columns: [
      { key: 'ms', label: 'Czas', sort: true, num: true, tip: 'Kiedy ruch został zapisany', value: m => m.ms, cell: m => el('span', { class: 'nw' }, m.time) },
      { key: 'type', label: 'Rodzaj', sort: true, tip: 'Przyjęcie, przesunięcie, wydanie (zamówienie) albo korekta', value: m => MOVE_NAMES[m.type] || m.type, cell: m => MOVE_NAMES[m.type] || m.type },
      { key: 'prod', label: 'Produkt', sort: true, tip: 'Produkt, którego dotyczy ruch', value: m => m.productName, cell: m => m.productName },
      { key: 'qty', label: 'Ilość', sort: true, num: true, tip: 'Ile sztuk (przy korekcie ze znakiem + lub −)', value: m => m.qty, cell: m => nf(m.qty) },
      { key: 'from', label: 'Z', sort: true, tip: 'Magazyn, z którego towar ubył', value: m => whName(m.from), cell: m => whName(m.from) || '—' },
      { key: 'to', label: 'Do', sort: true, tip: 'Magazyn, do którego towar trafił', value: m => whName(m.to), cell: m => whName(m.to) || '—' },
      { key: 'order', label: 'Zamówienie', sort: true, tip: 'Zamówienie, z którego pochodzi wydanie', value: m => m.orderNumber || m.orderId, cell: m => m.orderNumber || m.orderId || '—' },
      { key: 'author', label: 'Autor', sort: true, tip: 'Kto zapisał ruch', value: m => m.author, cell: m => m.author || '—' },
      { key: 'note', label: 'Notatka', sort: true, tip: 'Notatka wpisana przy ruchu', value: m => m.note, cell: m => m.note || '' },
    ],
    defaultSort: { key: 'ms', dir: 'desc' }, local: {}, load: () => ({ rows: mag.data.moves }), rowId: m => m.id != null ? m.id : m.ms + '|' + m.productName + '|' + m.type,
    empty: 'Nie zapisano jeszcze żadnych ruchów.',
  }));
  lv.mount(mag.query);
  return lv.node;
}

let root = null;
const VIEW_KEYS = new Set([...MAG_VIEWS.map(v => v[0]).filter(k => k !== 'wysylka'), ...LEDGER_KEYS]);   // start = ewidencja: wszystkie magazyny wg Selly (bez zakładki)

export default {
  id: 'magazyny',
  title: 'Magazyny',
  routes: [...VIEW_KEYS],
  mount(el, params) {
    if (!root) { root = el; el.innerHTML = TEMPLATE; }
    const v = params && params.view;
    if (v === 'speedmail' || v === 'wysylka') { go('/speedmail', { replace: true }); return; }   // dawny adres wysyłki SpeedMail
    if (!VIEW_KEYS.has(v)) { go('/magazyny/' + mag.view, { replace: true }); return; } // brak/nieznany podwidok → ostatni
    if (v === 'start' && mag.view !== 'start') { mag.pv = null; mag.pvErr = ''; mag.pvConfirm = false; }   // świeży podgląd przy każdym wejściu
    if (v === 'zmiana' && params.query && params.query.get('p')) { mag.chgPid = params.query.get('p'); mag.chg.plan = null; mag.chg.result = null; mag.chg.err = ''; }   // „Zmień” przy produkcie
    mag.view = v; mag.query = (params && params.query) || null;
    if (!mag.data && !mag.loading) magLoad(); else magRender();
  },
  unmount() { /* stan i DOM zostają — kontener jest tylko ukrywany */ },
};
