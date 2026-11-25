// Masowa zmiana cen / danych / kategorii: jeden ekran w trzech trybach (pozycje menu „Masowa zmiana cen”, „…danych”, „…kategorii”).
// Przebieg: 1) wybór produktów (filtry albo zaznaczenie) → 2) co zmienić → 3) OBOWIĄZKOWY podgląd „przed → po” → potwierdzenie z liczbą →
// 4) wykonanie partiami z paskiem postępu (wstrzymaj / zatrzymaj, błędy per produkt) → 5) podsumowanie i „Cofnij” (do 7 dni).
// Backend: akcje bulk:* (Worker, token READWRITE, tempo ≤ 120 zapisów/min do Selly).
import { el, money, cnt, plural, isUnavailable, loadingBox, pageToolbar, flash, dateStr, sellyLink } from '../core/ui.js?v=650da05';
import { api, ctx } from '../core/client.js?v=650da05';
import { shortcuts, addKeyTip } from '../core/shortcuts.js?v=650da05';

const BULK_W = ['zmiana-cen', 'zmiana-danych', 'zmiana-kategorii'];   // jak reguła serwera (bulk:*): dowolna z trzech sekcji
const zl = v => money(v) + ' zł';
const STEP = 4;   // produktów na jedno wywołanie (każdy = 2 zapytania do Selly)
const PAGE = 100;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MODES = {
  cen: { id: 'zmiana-cen', title: 'Masowa zmiana cen', sub: 'Podnieś lub obniż ceny wybranych produktów — najpierw zobaczysz podgląd każdej zmiany', a: 'produkty.zmianaCen' },
  dane: { id: 'zmiana-danych', title: 'Masowa zmiana danych', sub: 'Dostępność, widoczność w sklepie, oznaczenie „Nowość” i lokalizacja w magazynie dla wielu produktów naraz', a: 'scripts.produktyZmianaDanych' },
  kat: { id: 'zmiana-kategorii', title: 'Masowa zmiana kategorii', sub: 'Przenieś wybrane produkty do innej kategorii albo ustaw im producenta', a: 'scripts.produktyZmianaKategorii' },
};
const FIELD_LABEL = { price: 'Cena', previous_price: 'Cena poprzednia', visible: 'Widoczność w sklepie', availability_id: 'Dostępność', warehouse_localisation: 'Lokalizacja', promotion_new: 'Nowość', category_id: 'Kategoria', producer_id: 'Producent' };
const PRICE_MODES = [['percent', 'Zmień o procent', 'Np. −10 obniża o 10%, 5 podnosi o 5%'], ['amount', 'Zmień o kwotę', 'Np. −2,50 obniża o 2,50 zł, 3 podnosi o 3 zł'], ['set', 'Ustaw jedną cenę', 'Wszystkie wybrane produkty dostaną tę samą cenę'], ['fromPrevious', 'Przywróć cenę poprzednią', 'Cena aktualna = cena poprzednia (sprzed obniżki); produkty bez ceny poprzedniej są pomijane'], ['keep', 'Nie zmieniaj ceny (tylko cena poprzednia)', 'Zmienia wyłącznie cenę poprzednią — wybierz niżej, co z nią zrobić']];
const ROUNDS = [['none', 'bez zaokrąglania (do groszy)'], ['zl', 'do pełnych złotych (x,00)'], ['dec1', 'do 10 groszy (x,x0)'], ['half', 'do 50 groszy (x,00 / x,50)'], ['x99', 'na końcówkę ,99 (najbliższa)'], ['x99up', 'na końcówkę ,99 (w górę)']];
const PREVIOUS = [['leave', 'nie ruszaj ceny poprzedniej', 'Cena poprzednia (przekreślona) zostaje jak jest'], ['oldAsPrevious', 'zapisz dotychczasową cenę jako poprzednią', 'Przy zmianie ceny stara cena trafia do pola „cena poprzednia” (pokaże się jako przekreślona)'],
  ['oldIfLower', 'jak wyżej, ale tylko przy obniżce (przy podwyżce wyczyść)', 'Przekreślona cena tylko przy obniżkach'], ['clear', 'wyczyść cenę poprzednią', 'Usuwa przekreśloną cenę'], ['toCurrent', 'ustaw cenę poprzednią = nowa cena', 'Cena poprzednia równa nowej cenie']];
const DATA_FIELDS = [['availability_id', 'Dostępność', 'Status dostępności widoczny przy produkcie (np. „dostępny”, „na zamówienie”)'], ['visible', 'Widoczność w sklepie', 'Czy produkt jest widoczny dla klientów'], ['promotion_new', 'Oznaczenie „Nowość”', 'Czy produkt ma etykietę „Nowość”'], ['warehouse_localisation', 'Lokalizacja w magazynie', 'Miejsce na półce (np. A-12); puste pole czyści lokalizację']];

export function createMode(modeKey) {
  const M = MODES[modeKey];
  const S = { root: null, meta: null, sel: null, sheet: [], selected: new Set(), shown: PAGE, preview: null, previewSig: '', batch: null, running: false, runSeq: 0, seq: 0, err: '', pvShown: PAGE, pvFilter: 'changed', history: null, busy: false };
  const F = { q: '', categoryId: '', producerId: '', stock: '', visible: '', priceFrom: '', priceTo: '', whId: '' };
  const O = { priceMode: 'percent', value: '', round: 'none', previous: 'leave', field: 'availability_id', fieldValue: '', target: 'category', catId: '', prodId: '' };
  const $ = id => document.getElementById(id);

  const catName = id => ((S.meta && S.meta.categories.find(c => String(c.id) === String(id))) || {}).name || (id ? 'ID ' + id : '—');
  const prodName = id => ((S.meta && S.meta.producers.find(c => String(c.id) === String(id))) || {}).name || (id && Number(id) ? 'ID ' + id : '— brak —');
  const availName = id => ((S.meta && S.meta.availabilities.find(c => String(c.id) === String(id))) || {}).name || (id ? 'ID ' + id : '—');

  /** Operacja z formularza (albo komunikat, czego brakuje). */
  function buildOp() {
    if (modeKey === 'cen') return { kind: 'price', mode: O.priceMode, value: O.value, round: O.round, previous: O.previous };
    if (modeKey === 'dane') {
      const v = O.field === 'visible' || O.field === 'promotion_new' ? O.fieldValue === '1' : O.fieldValue;
      return { kind: 'field', field: O.field, value: O.field === 'availability_id' ? Number(O.fieldValue) : v };
    }
    return O.target === 'category' ? { kind: 'category', value: O.catId } : { kind: 'producer', value: O.prodId };
  }
  function opProblem() {
    if (modeKey === 'cen') {
      if (['percent', 'amount', 'set'].includes(O.priceMode) && String(O.value).trim() === '') return 'Wpisz wartość zmiany ceny.';
      if (O.priceMode === 'keep' && O.previous === 'leave') return 'Wybierz, co zrobić z ceną poprzednią.';
    } else if (modeKey === 'dane') {
      if (O.field === 'availability_id' && !O.fieldValue) return 'Wybierz dostępność.';
      if ((O.field === 'visible' || O.field === 'promotion_new') && O.fieldValue === '') return 'Wybierz wartość.';
    } else if (O.target === 'category' && !O.catId) return 'Wybierz kategorię docelową.';
    return '';
  }
  const sig = () => JSON.stringify([[...S.selected].sort(), buildOp()]);
  const invalidate = () => { S.preview = null; paintPreview(); };

  // ─── Krok 1: wybór produktów ─────────────────────────────────────────────
  function filtersCard() {
    const inp = (id, key, ph, tip, type) => el('input', { id, type: type || 'search', value: F[key], placeholder: ph, title: tip, 'aria-label': tip, class: 'bm-in', onkeydown: ev => { if (ev.key === 'Enter') search(); }, oninput: ev => { F[key] = ev.target.value; } });
    const sel = (id, key, label, opts, tip) => el('label', { class: 'field-inline', title: tip }, label, el('select', { id, class: 'bm-in', onchange: ev => { F[key] = ev.target.value; } }, el('option', { value: '' }, 'wszystkie'), opts.map(o => el('option', { value: String(o.id), selected: String(o.id) === F[key] }, o.name))));
    return el('section', { class: 'card bm-card', id: 'bmStep1' },
      el('h2', null, el('span', { class: 'bm-num' }, '1'), 'Wybierz produkty'),
      el('div', { class: 'bm-row' },
        el('label', { class: 'field-inline', title: 'Szuka w nazwie, kodzie producenta, symbolu i EAN' }, 'Nazwa lub kod', inp('bmQ', 'q', 'np. flaga albo K-123', 'Szukaj po nazwie, kodzie, symbolu lub EAN')),
        sel('bmCat', 'categoryId', 'Kategoria', S.meta.categories, 'Tylko produkty z tej kategorii głównej (bez podkategorii)'),
        sel('bmProd', 'producerId', 'Producent', S.meta.producers, 'Tylko produkty tego producenta'),
        el('button', { type: 'button', class: 'primary', id: 'bmSearch', onclick: search, title: 'Pokaż produkty pasujące do filtrów' }, 'Pokaż produkty')),
      el('details', { class: 'bm-opts' }, el('summary', { title: 'Dodatkowe filtry: stan magazynowy, widoczność, zakres cen, magazyn' }, 'Więcej filtrów'),
        el('div', { class: 'bm-row' },
          el('label', { class: 'field-inline', title: 'Wg łącznego stanu produktu w Selly' }, 'Stan', el('select', { id: 'bmStock', class: 'bm-in', onchange: ev => { F.stock = ev.target.value; } }, [['', 'dowolny'], ['in', 'na stanie'], ['zero', 'brak (0 lub mniej)'], ['low', 'niski (1–5)']].map(([v, l]) => el('option', { value: v, selected: F.stock === v }, l)))),
          el('label', { class: 'field-inline', title: 'Czy produkt jest widoczny w sklepie' }, 'Widoczność', el('select', { id: 'bmVis', class: 'bm-in', onchange: ev => { F.visible = ev.target.value; } }, [['', 'dowolna'], ['1', 'widoczne'], ['0', 'ukryte']].map(([v, l]) => el('option', { value: v, selected: F.visible === v }, l)))),
          el('label', { class: 'field-inline', title: 'Cena aktualna produktu, od' }, 'Cena od', el('input', { id: 'bmPriceFrom', type: 'number', min: '0', step: '0.01', class: 'bm-in bm-num-in', value: F.priceFrom, oninput: ev => { F.priceFrom = ev.target.value; } })),
          el('label', { class: 'field-inline', title: 'Cena aktualna produktu, do' }, 'do', el('input', { id: 'bmPriceTo', type: 'number', min: '0', step: '0.01', class: 'bm-in bm-num-in', value: F.priceTo, oninput: ev => { F.priceTo = ev.target.value; } })),
          S.meta.warehouses.length ? sel('bmWh', 'whId', 'Magazyn domyślny', S.meta.warehouses, 'Tylko produkty z tym magazynem domyślnym') : null)),
      el('div', { id: 'bmList' }, el('p', { class: 'muted' }, 'Ustaw filtr i kliknij „Pokaż produkty” — potem możesz odznaczyć pojedyncze pozycje.')));
  }

  function filterParams() {
    const f = { q: F.q.trim(), categoryId: F.categoryId, producerId: F.producerId, whId: F.whId, stock: F.stock, priceFrom: F.priceFrom, priceTo: F.priceTo };
    if (F.visible !== '') f.visible = F.visible === '1';
    return f;
  }
  async function search() {
    const my = ++S.seq;
    $('bmList').replaceChildren(loadingBox('Szukanie produktów…'));
    try {
      const r = await api('bulk:select', { filters: filterParams() });
      if (my !== S.seq || !S.root) return;
      S.sheet = r.rows; S.truncated = r.truncated; S.selected = new Set(r.rows.map(x => x.id)); S.shown = PAGE;
      paintList(); invalidate();
    } catch (e) {
      if (my === S.seq && $('bmList')) $('bmList').replaceChildren(el('div', { class: 'empty error', id: 'bmListError' }, e.message));
    }
  }

  function paintList() {
    const box = $('bmList');
    if (!box) return;
    if (!S.sheet.length) { box.replaceChildren(el('div', { class: 'empty', id: 'bmEmpty' }, 'Żaden produkt nie pasuje do filtrów.')); return; }
    const all = S.sheet.length, n = S.selected.size;
    const master = el('input', { type: 'checkbox', id: 'bmAll', checked: n === all, 'aria-label': 'Zaznacz lub odznacz wszystkie', title: 'Zaznacz / odznacz wszystkie znalezione produkty',
      onchange: ev => { S.selected = ev.target.checked ? new Set(S.sheet.map(x => x.id)) : new Set(); paintList(); invalidate(); } });
    master.indeterminate = n > 0 && n < all;
    const rows = S.sheet.slice(0, S.shown).map(r => el('tr', { 'data-id': r.id },
      el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Wybierz ' + r.name, checked: S.selected.has(r.id), onchange: ev => { if (ev.target.checked) S.selected.add(r.id); else S.selected.delete(r.id); paintList(); invalidate(); } })),
      el('td', null, r.name), el('td', null, r.code || ''), el('td', { class: 'n' }, zl(r.price)), el('td', { class: 'n' }, String(Number(r.qty) || 0)), el('td', null, catName(r.categoryId)), el('td', null, r.visible ? '' : 'ukryty')));
    box.replaceChildren(
      el('div', { class: 'bm-count', id: 'bmCount' }, el('strong', null, 'Wybrano ' + n + ' z ' + all), ' ' + plural(all, 'znalezionego produktu', 'znalezionych produktów', 'znalezionych produktów'),
        S.truncated ? el('span', { class: 'bm-warn' }, ' — lista obcięta do ' + all + ' pozycji, zawęź filtry') : null),
      el('div', { class: 'table-wrap bm-wrap' }, el('table', { id: 'bmTable' }, el('thead', null, el('tr', null, el('th', { class: 'c' }, master), el('th', null, 'Produkt'), el('th', null, el('span', { class: 'tip', title: 'Kod producenta' }, 'Kod')),
        el('th', { class: 'n' }, el('span', { class: 'tip', title: 'Aktualna cena produktu (brutto)' }, 'Cena')), el('th', { class: 'n' }, el('span', { class: 'tip', title: 'Łączny stan magazynowy wg Selly' }, 'Stan')), el('th', null, 'Kategoria'), el('th', null, 'Uwagi'))),
        el('tbody', null, rows))),
      S.shown < all ? el('button', { type: 'button', class: 'secondary', id: 'bmMoreRows', onclick: () => { S.shown += PAGE; paintList(); } }, 'Pokaż więcej (' + Math.min(PAGE, all - S.shown) + ')') : null);
  }

  // ─── Krok 2: co zmienić ──────────────────────────────────────────────────
  function opCard() {
    const body = el('div', { id: 'bmOpBody' });
    const draw = () => {
      if (modeKey === 'cen') {
        const needsValue = ['percent', 'amount', 'set'].includes(O.priceMode);
        body.replaceChildren(
          el('div', { class: 'bm-row' },
            el('label', { class: 'field-inline', title: 'Jak zmienić cenę' }, 'Sposób', el('select', { id: 'bmPriceMode', class: 'bm-in', onchange: ev => { O.priceMode = ev.target.value; invalidate(); draw(); } }, PRICE_MODES.map(([v, l, t]) => el('option', { value: v, selected: O.priceMode === v, title: t }, l)))),
            needsValue ? el('label', { class: 'field-inline', title: O.priceMode === 'percent' ? 'Procent: minus obniża, plus podnosi (np. -10 albo 5,5)' : O.priceMode === 'amount' ? 'Kwota w zł: minus obniża, plus podnosi' : 'Nowa cena w zł' },
              O.priceMode === 'percent' ? 'Procent (%)' : O.priceMode === 'amount' ? 'Kwota (zł)' : 'Nowa cena (zł)',
              el('input', { id: 'bmValue', type: 'text', inputmode: 'decimal', class: 'bm-in bm-num-in', value: O.value, placeholder: O.priceMode === 'set' ? '19,99' : '-10', oninput: ev => { O.value = ev.target.value; invalidate(); } })) : null),
          el('details', { class: 'bm-opts', open: O.round !== 'none' || O.previous !== 'leave' || O.priceMode === 'keep' }, el('summary', { title: 'Zaokrąglanie nowej ceny (np. do ,99) i obsługa ceny poprzedniej (przekreślonej)' }, 'Zaokrąglanie i cena poprzednia'),
            el('div', { class: 'bm-row' },
              el('label', { class: 'field-inline', title: 'Nowa cena jest zaokrąglana po przeliczeniu' }, 'Zaokrąglij', el('select', { id: 'bmRound', class: 'bm-in', onchange: ev => { O.round = ev.target.value; invalidate(); } }, ROUNDS.map(([v, l]) => el('option', { value: v, selected: O.round === v }, l)))),
              el('label', { class: 'field-inline', title: 'Cena poprzednia to przekreślona cena „przed obniżką” widoczna w sklepie' }, 'Cena poprzednia', el('select', { id: 'bmPrevious', class: 'bm-in', onchange: ev => { O.previous = ev.target.value; invalidate(); } }, PREVIOUS.map(([v, l, t]) => el('option', { value: v, selected: O.previous === v, title: t }, l)))))));
      } else if (modeKey === 'dane') {
        const v = O.field;
        body.replaceChildren(el('div', { class: 'bm-row' },
          el('label', { class: 'field-inline', title: 'Które dane zmienić we wszystkich wybranych produktach' }, 'Zmień', el('select', { id: 'bmField', class: 'bm-in', onchange: ev => { O.field = ev.target.value; O.fieldValue = ''; invalidate(); draw(); } }, DATA_FIELDS.map(([k, l, t]) => el('option', { value: k, selected: v === k, title: t }, l)))),
          v === 'availability_id' ? el('label', { class: 'field-inline', title: 'Nowy status dostępności' }, 'na', el('select', { id: 'bmFieldValue', class: 'bm-in', onchange: ev => { O.fieldValue = ev.target.value; invalidate(); } }, el('option', { value: '' }, '— wybierz —'), S.meta.availabilities.map(a => el('option', { value: String(a.id), selected: O.fieldValue === String(a.id) }, a.name))))
          : v === 'warehouse_localisation' ? el('label', { class: 'field-inline', title: 'Pusta wartość czyści lokalizację' }, 'na', el('input', { id: 'bmFieldValue', type: 'text', class: 'bm-in', value: O.fieldValue, placeholder: 'np. A-12 (puste = wyczyść)', oninput: ev => { O.fieldValue = ev.target.value; invalidate(); } }))
          : el('label', { class: 'field-inline' }, 'na', el('select', { id: 'bmFieldValue', class: 'bm-in', onchange: ev => { O.fieldValue = ev.target.value; invalidate(); } }, [['', '— wybierz —'], ['1', v === 'visible' ? 'widoczny' : 'tak'], ['0', v === 'visible' ? 'ukryty' : 'nie']].map(([x, l]) => el('option', { value: x, selected: O.fieldValue === x }, l))))));
      } else {
        body.replaceChildren(el('div', { class: 'bm-row' },
          el('label', { class: 'field-inline', title: 'Co ustawić wybranym produktom' }, 'Ustaw', el('select', { id: 'bmTarget', class: 'bm-in', onchange: ev => { O.target = ev.target.value; invalidate(); draw(); } }, [['category', 'kategorię główną'], ['producer', 'producenta']].map(([x, l]) => el('option', { value: x, selected: O.target === x }, l)))),
          O.target === 'category' ? el('label', { class: 'field-inline', title: 'Produkty zostaną przeniesione do tej kategorii (stara kategoria główna zostanie zastąpiona)' }, 'na', el('select', { id: 'bmCatTo', class: 'bm-in', onchange: ev => { O.catId = ev.target.value; invalidate(); } }, el('option', { value: '' }, '— wybierz kategorię —'), S.meta.categories.map(c => el('option', { value: String(c.id), selected: O.catId === String(c.id) }, c.name))))
            : el('label', { class: 'field-inline', title: 'Producent, którego dostaną wybrane produkty' }, 'na', el('select', { id: 'bmProdTo', class: 'bm-in', onchange: ev => { O.prodId = ev.target.value; invalidate(); } }, el('option', { value: '' }, '— brak producenta —'), S.meta.producers.map(c => el('option', { value: String(c.id), selected: O.prodId === String(c.id) }, c.name))))),
          O.target === 'category' ? el('p', { class: 'muted bm-hint' }, 'Zmienia kategorię główną. Kategorie dodatkowe produktu zostają bez zmian.') : null);
      }
    };
    draw();
    return el('section', { class: 'card bm-card', id: 'bmStep2' }, el('h2', null, el('span', { class: 'bm-num' }, '2'), 'Co zmienić'), body);
  }

  // ─── Krok 3: podgląd ─────────────────────────────────────────────────────
  const fmtVal = (k, v) => (k === 'price' || k === 'previous_price' ? (Number(v) ? zl(v) : '—') : k === 'visible' ? (v ? 'widoczny' : 'ukryty') : k === 'promotion_new' ? (v ? 'tak' : 'nie')
    : k === 'category_id' ? catName(v) : k === 'producer_id' ? prodName(v) : k === 'availability_id' ? availName(v) : (v === '' || v == null ? '— pusto —' : String(v)));

  function previewCard() {
    return el('section', { class: 'card bm-card', id: 'bmStep3' }, el('h2', null, el('span', { class: 'bm-num' }, '3'), 'Podgląd zmian'),
      el('p', { class: 'muted' }, 'Nic nie zostanie zapisane, dopóki nie zatwierdzisz podglądu.'),
      el('div', { class: 'bm-row' }, el('button', { type: 'button', class: 'primary', id: 'bmPreviewBtn', onclick: doPreview, title: 'Policz zmiany dla zaznaczonych produktów — bez zapisu w Selly' }, 'Pokaż podgląd zmian'),
        el('span', { class: 'muted', id: 'bmPreviewHint' })),
      el('div', { id: 'bmPreview' }));
  }

  async function doPreview() {
    const prob = opProblem();
    if (!S.selected.size) { flash(null, 'Najpierw wybierz produkty (krok 1).'); return paintPreview('Najpierw wybierz produkty (krok 1).'); }
    if (prob) return paintPreview(prob);
    const my = ++S.seq;
    $('bmPreview').replaceChildren(loadingBox('Liczenie podglądu…'));
    try {
      const r = await api('bulk:preview', { ids: [...S.selected], op: buildOp() });
      if (my !== S.seq || !S.root) return;
      S.preview = r; S.previewSig = sig(); S.pvShown = PAGE; S.pvFilter = r.counts.changed ? 'changed' : 'all';
      paintPreview();
    } catch (e) { if (my === S.seq && $('bmPreview')) $('bmPreview').replaceChildren(el('div', { class: 'empty error', id: 'bmPreviewError' }, e.message)); }
  }

  function paintPreview(msg) {
    const box = $('bmPreview');
    if (!box) return;
    if (msg) { box.replaceChildren(el('div', { class: 'empty error', id: 'bmPreviewError' }, msg)); return; }
    if (!S.preview) { box.replaceChildren(); $('bmPreviewHint').textContent = ''; return; }
    $('bmPreviewHint').textContent = '';
    const p = S.preview, c = p.counts;
    const filt = S.pvFilter;
    const list = p.rows.filter(r => (filt === 'changed' ? r.changed : filt === 'warn' ? r.warn && r.changed : filt === 'skipped' ? r.skip || (!r.changed) : true));
    const chip = (k, label, n, tip) => el('button', { type: 'button', class: 'chip', 'data-f': k, 'aria-pressed': String(filt === k), title: tip, onclick: () => { S.pvFilter = k; S.pvShown = PAGE; paintPreview(); } }, label + ' ', el('b', null, String(n)));
    const tooMany = c.changed > p.maxItems;
    const rows = list.slice(0, S.pvShown).map(r => el('tr', { 'data-id': r.id, class: r.skip ? 'bm-skip' : r.changed ? null : 'bm-same' },
      el('td', null, r.name, el('div', { class: 'muted bm-code' }, r.code || '')),
      el('td', null, Object.keys(r.after).length ? Object.keys(r.after).map(k => el('div', { class: 'bm-chg', 'data-k': k }, el('span', { class: 'bm-k' }, FIELD_LABEL[k] || k), el('span', { class: 'bm-before' }, fmtVal(k, r.before[k])), el('span', { class: 'bm-arrow', 'aria-hidden': 'true' }, '→'), el('strong', { class: 'bm-after' }, fmtVal(k, r.after[k]))))
        : el('span', { class: 'muted' }, r.skip ? '—' : 'bez zmiany')),
      el('td', { class: 'n' }, r.after.price != null && r.before.price ? el('span', { class: 'bm-pct' }, (r.after.price >= r.before.price ? '+' : '') + String(Math.round((r.after.price - r.before.price) / r.before.price * 1000) / 10).replace('.', ',') + '%') : ''),
      el('td', null, r.skip ? el('span', { class: 'bm-skip-t', title: 'Ten produkt zostanie pominięty' }, 'pominięty: ' + r.skip) : r.warn ? el('span', { class: 'bm-warn', title: 'Sprawdź przed zapisem' }, '⚠ ' + r.warn) : '')));
    box.replaceChildren(
      el('div', { class: 'bm-summary', id: 'bmSummary', role: 'status' }, el('strong', null, 'Zmieni się ' + c.changed + ' z ' + c.total + ' ' + plural(c.total, 'produktu', 'produktów', 'produktów')),
        c.unchanged ? ' · ' + c.unchanged + ' bez zmiany' : '', c.skipped ? ' · ' + c.skipped + ' pominiętych' : '', c.warned ? ' · ' + c.warned + ' z ostrzeżeniem' : ''),
      el('div', { class: 'bm-row bm-chips' }, chip('changed', 'Zmienione', c.changed, 'Produkty, które zostaną zmienione'), chip('warn', 'Ostrzeżenia', c.warned, 'Duże zmiany lub produkty z wariantami'), chip('skipped', 'Bez zmiany / pominięte', c.unchanged + c.skipped, 'Produkty, których ta operacja nie dotyka'), chip('all', 'Wszystkie', c.total, 'Wszystkie wybrane produkty')),
      list.length ? el('div', { class: 'table-wrap bm-wrap' }, el('table', { id: 'bmPvTable' }, el('thead', null, el('tr', null, el('th', null, 'Produkt'), el('th', null, el('span', { class: 'tip', title: 'Wartość przed → po zmianie' }, 'Przed → po')),
        el('th', { class: 'n' }, el('span', { class: 'tip', title: 'Zmiana ceny w procentach' }, 'Zmiana')), el('th', null, 'Uwagi'))), el('tbody', null, rows)))
        : el('div', { class: 'empty' }, 'Brak pozycji w tym widoku.'),
      S.pvShown < list.length ? el('button', { type: 'button', class: 'secondary', onclick: () => { S.pvShown += PAGE; paintPreview(); } }, 'Pokaż więcej (' + Math.min(PAGE, list.length - S.pvShown) + ')') : null,
      tooMany ? el('p', { class: 'bm-warn', id: 'bmTooMany' }, 'Za dużo zmian naraz (maks. ' + p.maxItems + ' w jednej partii) — zawęź wybór.') : null,
      el('div', { class: 'bm-row bm-apply' }, el('button', { type: 'button', class: 'primary', write: BULK_W, id: 'bmApply', disabled: !c.changed || tooMany, onclick: confirmApply, title: c.changed ? 'Zapisz zmiany w Selly (poprosimy jeszcze o potwierdzenie)' : 'Nie ma żadnych zmian do zapisania' },
        'Zapisz zmiany (' + c.changed + ')'), el('span', { class: 'muted' }, 'Zmiany trafią do Selly w tempie ok. ' + perMinItems() + ' produktów na minutę; przez ' + S.meta.undoDays + ' dni możesz je cofnąć.')));
  }

  // ─── Potwierdzenia ───────────────────────────────────────────────────────
  function dialog({ id, title, body, ok, okClass, onOk }) {
    const prevFocus = document.activeElement;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    const cancel = el('button', { type: 'button', class: 'secondary', id: id + 'Cancel', onclick: close }, 'Anuluj');
    const wrap = el('div', { class: 'bm-modal', id }, el('div', { class: 'bm-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('h3', null, title), body, el('div', { class: 'bm-row bm-dlg-actions' }, cancel, el('button', { type: 'button', class: okClass || 'primary', id: id + 'Ok', onclick: () => { close(); onOk(); } }, ok))));
    document.addEventListener('keydown', onKey, true);
    document.body.append(wrap);
    cancel.focus();
    return close;
  }

  const reqPer = () => S.meta.reqPerItem || 1;
  const perMinItems = () => Math.max(1, Math.floor(S.meta.perMin / reqPer()));
  function etaText(n) { const min = Math.max(1, Math.ceil(n / perMinItems())); return 'ok. ' + min + ' ' + plural(min, 'minuta', 'minuty', 'minut'); }

  function confirmApply() {
    if (!S.preview || sig() !== S.previewSig) { paintPreview('Zmieniłeś wybór lub ustawienia — odśwież podgląd.'); return; }
    const n = S.preview.counts.changed;
    dialog({ id: 'bmConfirm', title: 'Zmienisz ' + n + ' ' + plural(n, 'produkt', 'produkty', 'produktów'),
      body: el('div', null, el('p', null, 'Zmiany zostaną zapisane w Selly (' + etaText(n) + ', zapisujemy po kolei, żeby nie przeciążyć sklepu). Możesz wstrzymać lub zatrzymać zapis w trakcie.'),
        el('p', { class: 'muted' }, 'Poprzednie wartości zapamiętamy — przez ' + S.meta.undoDays + ' dni cofniesz całą zmianę jednym kliknięciem.')),
      ok: 'Zmień ' + n + ' ' + plural(n, 'produkt', 'produkty', 'produktów'), onOk: start });
  }

  async function start() {
    try {
      const r = await api('bulk:start', { ids: [...S.selected], op: buildOp(), expect: S.preview.counts.changed, label: M.title });
      S.batch = r.batch; if (r.perMin) S.meta.perMin = r.perMin; if (r.reqPerItem) S.meta.reqPerItem = r.reqPerItem;
      paintBatch(); run(r.batch.id);
    } catch (e) { paintPreview(e.message); }
  }

  // ─── Wykonanie partii ────────────────────────────────────────────────────
  async function run(id) {
    if (S.running) return;
    S.running = true; const my = ++S.runSeq; S.err = '';
    try {
      while (S.root && my === S.runSeq) {
        const r = await api('bulk:step', { batchId: id, n: STEP });
        S.batch = r.batch; paintBatch();
        if (r.batch.status !== 'running' && r.batch.status !== 'undoing') break;
        const pace = r.wait || Math.round(r.processed * reqPer() * 60000 / (S.meta.perMin || 120));
        if (pace) await sleep(pace);
      }
    } catch (e) { S.err = e.message; }
    S.running = false;
    if (S.root) { paintBatch(); if (S.batch && S.batch.status === 'done') loadHistory(); }
  }

  async function ctl(action) {
    try { const r = await api(action, { batchId: S.batch.id }); S.batch = r.batch; if (action === 'bulk:resume') run(S.batch.id); paintBatch(); if (action === 'bulk:stop') loadHistory(); }
    catch (e) { S.err = e.message; paintBatch(); }
  }

  const STATUS_TXT = { running: 'Trwa zapisywanie…', undoing: 'Trwa cofanie…', paused: 'Wstrzymano', stopped: 'Zatrzymano', done: 'Gotowe' };
  function paintBatch() {
    const box = $('bmBatch');
    if (!box) return;
    const b = S.batch;
    if (!b) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    const undo = b.mode === 'undo', active = b.status === 'running' || b.status === 'undoing';
    const doneN = undo ? b.undone : b.ok + b.errors, total = undo ? b.undone + b.pending + b.errors : b.total;
    const pct = total ? Math.round(doneN / total * 100) : 100;
    const finished = !active && b.status !== 'paused';
    box.replaceChildren(
      el('h2', null, el('span', { class: 'bm-num' }, '4'), undo ? 'Cofanie zmian' : 'Zapisywanie zmian'),
      el('div', { class: 'bm-progress' }, el('progress', { id: 'bmProgress', max: '100', value: String(pct), 'aria-label': 'Postęp' }), el('span', { id: 'bmPct', class: 'bm-pctn' }, pct + '%')),
      el('div', { id: 'bmStatus', role: 'status', class: 'bm-status' }, el('strong', null, STATUS_TXT[b.status] || b.status), ' · ' + (undo ? 'cofnięto ' + b.undone + ' z ' + total : 'zapisano ' + b.ok + ' z ' + b.total),
        b.errors ? el('span', { class: 'bm-warn' }, ' · błędy: ' + b.errors) : '', b.pending ? ' · zostało ' + b.pending + ' (' + etaText(b.pending) + ')' : ''),
      b.note ? el('p', { class: 'bm-warn', id: 'bmNote' }, b.note) : null, S.err ? el('p', { class: 'bm-warn', id: 'bmErr' }, S.err) : null,
      el('div', { class: 'bm-row' },
        active && S.running ? el('button', { type: 'button', class: 'secondary', write: BULK_W, id: 'bmPause', onclick: () => ctl('bulk:pause'), title: 'Wstrzymaj zapisywanie — dotychczasowe zmiany zostają, możesz wznowić' }, 'Wstrzymaj') : null,
        (b.status === 'paused' || (active && !S.running)) ? el('button', { type: 'button', class: 'primary', write: BULK_W, id: 'bmResume', onclick: () => (active ? run(b.id) : ctl('bulk:resume')), title: 'Kontynuuj zapisywanie od miejsca, w którym przerwano' }, 'Wznów') : null,
        active || b.status === 'paused' ? el('button', { type: 'button', class: 'secondary', write: BULK_W, id: 'bmStop', onclick: () => ctl('bulk:stop'), title: 'Przerwij całkiem — niezapisane produkty zostają bez zmian, zapisane możesz cofnąć' }, 'Zatrzymaj') : null,
        finished && b.ok > 0 && b.mode === 'apply' ? el('button', { type: 'button', class: 'secondary', write: BULK_W, id: 'bmUndo', onclick: () => confirmUndo(b), title: 'Przywróć wartości sprzed zmiany (dla produktów zapisanych w tej partii)' }, 'Cofnij zmiany') : null,
        finished ? el('button', { type: 'button', class: 'secondary', id: 'bmNew', onclick: reset, title: 'Zacznij od nowa — wybierz inne produkty' }, 'Nowa zmiana') : null),
      finished ? summaryBox(b, undo) : null);
  }

  function summaryBox(b, undo) {
    const box = el('div', { id: 'bmSummaryDone', class: 'bm-done' }, el('p', null, el('strong', null, undo ? 'Cofnięto ' + b.undone + ' ' + plural(b.undone, 'produkt', 'produkty', 'produktów') + '.' : 'Zapisano zmiany w ' + b.ok + ' ' + plural(b.ok, 'produkcie', 'produktach', 'produktach') + '.'),
      b.errors ? ' Błędów: ' + b.errors + '.' : ' Bez błędów.'), el('div', { id: 'bmProblems' }));
    if (b.errors || b.status === 'stopped') api('bulk:get', { batchId: b.id, only: 'problems' }).then(r => {
      const pb = box.querySelector('#bmProblems');
      if (!pb || !r.items.length) return;
      pb.replaceChildren(el('div', { class: 'table-wrap bm-wrap' }, el('table', { id: 'bmProblemsTable' }, el('thead', null, el('tr', null, el('th', null, 'Produkt'), el('th', null, 'Co się stało'))),
        el('tbody', null, r.items.map(i => el('tr', { 'data-id': i.id }, el('td', null, i.name), el('td', null, ({ skipped: 'niezapisany (zatrzymano)', error: 'błąd: ' + i.error, undo_error: 'nie cofnięto: ' + i.error, conflict: 'pominięty: ' + i.error })[i.status] || i.status)))))));
    }).catch(() => {});
    return box;
  }

  function confirmUndo(b) {
    dialog({ id: 'bmUndoDlg', title: 'Cofnąć zmiany w ' + b.ok + ' ' + plural(b.ok, 'produkcie', 'produktach', 'produktach') + '?',
      body: el('div', null, el('p', null, 'Przywrócimy wartości sprzed zmiany (' + etaText(b.ok) + '). Produkty, które w międzyczasie ktoś jeszcze zmienił, zostaną pominięte — nie nadpiszemy nowszych zmian.')),
      ok: 'Cofnij zmiany (' + b.ok + ')', onOk: async () => {
        try { const r = await api('bulk:undo', { batchId: b.id }); S.batch = r.batch; if (r.perMin) S.meta.perMin = r.perMin; paintBatch(); run(b.id); } catch (e) { S.err = e.message; paintBatch(); }
      } });
  }

  function reset() { S.batch = null; S.preview = null; S.err = ''; paintBatch(); paintPreview(); loadHistory(); }

  // ─── Historia (cofanie starszych partii) ─────────────────────────────────
  async function loadHistory() {
    try { S.history = (await api('bulk:list')).batches; } catch (e) { S.history = null; }
    paintHistory();
  }
  function paintHistory() {
    const box = $('bmHistory');
    if (!box) return;
    const list = S.history || [];
    box.replaceChildren(el('summary', { title: 'Ostatnie zmiany masowe — każdą z nich można cofnąć przez ' + (S.meta ? S.meta.undoDays : 7) + ' dni' }, 'Ostatnie zmiany masowe (' + list.length + ')'),
      list.length ? el('div', { class: 'table-wrap bm-wrap' }, el('table', { id: 'bmHistTable' }, el('thead', null, el('tr', null, el('th', null, 'Kiedy'), el('th', null, 'Kto'), el('th', null, 'Co'), el('th', { class: 'n' }, 'Produkty'), el('th', null, 'Wynik'), el('th', null, ''))),
        el('tbody', null, list.map(b => el('tr', { 'data-id': b.id },
          el('td', null, dateStr(new Date(b.ms).toISOString())), el('td', null, b.email), el('td', null, b.label || (b.op && b.op.kind) || ''), el('td', { class: 'n' }, String(b.total)),
          el('td', null, (STATUS_TXT[b.status] || b.status) + (b.errors ? ' · błędy: ' + b.errors : '') + (b.undone ? ' · cofnięto: ' + b.undone : '')),
          el('td', null, b.canUndo ? el('button', { type: 'button', class: 'secondary small', write: BULK_W, 'data-undo': b.id, onclick: () => { S.batch = b; confirmUndo(b); }, title: 'Cofnij tę zmianę (do ' + dateStr(new Date(b.undoUntilMs).toISOString()) + ')' }, 'Cofnij') : '')))))) : el('p', { class: 'muted' }, 'Brak zmian masowych.'));
  }

  // ─── Moduł ───────────────────────────────────────────────────────────────
  async function init() {
    const my = ++S.seq;
    S.root.replaceChildren(loadingBox('Wczytywanie…'));
    try {
      S.meta = await api('bulk:meta');
    } catch (e) {
      if (my !== S.seq || !S.root) return;
      const adm = (ctx.boot && ctx.boot.adminUrl) || 'https://takimarket.pl/adm/';
      S.root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error', id: 'bmError' }, isUnavailable(e) ? M.title + ' wymaga backendu Cloudflare — ten serwer go nie obsługuje.' : 'Nie udało się wczytać: ' + e.message,
        el('p', null, sellyLink('Otwórz w panelu Selly ↗', adm + '?a=' + M.a, 'Ten sam ekran w panelu Selly (nowa karta)')), el('button', { type: 'button', class: 'secondary', onclick: init }, 'Spróbuj ponownie'))));
      return;
    }
    if (my !== S.seq || !S.root) return;
    S.root.replaceChildren(pageToolbar({ title: M.title, sub: M.sub }), filtersCard(), opCard(), previewCard(), el('section', { class: 'card bm-card', id: 'bmBatch', hidden: true }),
      el('details', { class: 'card bm-card bm-hist', id: 'bmHistory' }));
    addKeyTip($('bmPreviewBtn'), 'P'); addKeyTip($('bmQ'), '/');
    shortcuts.scope(M.id, [
      { keys: ['/'], label: '/', desc: 'Przejdź do pola wyszukiwania produktów', run: () => { const n = $('bmQ'); if (!n) return false; n.focus(); return true; } },
      { keys: ['p'], label: 'P', desc: 'Pokaż podgląd zmian', run: () => { const n = $('bmPreviewBtn'); if (!n) return false; n.click(); return true; } },
      { keys: ['a'], label: 'A', desc: 'Zaznacz lub odznacz wszystkie znalezione produkty', run: () => { const n = $('bmAll'); if (!n) return false; n.click(); return true; } },
    ]);
    paintList(); paintHistory(); loadHistory();
    if (S.meta.active) {   // partia przerwana (np. zamknięta karta) — pokaż postęp i pozwól wznowić
      try { const g = await api('bulk:get', { batchId: S.meta.active }); S.batch = g.batch; paintBatch(); } catch (e) { /* ok */ }
    }
  }

  return {
    id: M.id, title: M.title, routes: [],
    mount(el0) { S.root = el0; S.batch = null; S.preview = null; S.err = ''; init(); },
    unmount() { S.seq++; S.runSeq++; S.running = false; if (S.root) S.root.replaceChildren(); S.root = null; document.querySelectorAll('.bm-modal').forEach(n => n.remove()); },
  };
}

export const modes = { cen: createMode('cen'), dane: createMode('dane'), kat: createMode('kat') };
export default modes.cen;
