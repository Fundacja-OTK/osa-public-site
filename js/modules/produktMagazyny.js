// Produkty a magazyny Selly:
//  - karta produktu → zakładka „Magazyn”: stan i cena zakupu w każdym magazynie, przypięcie do nowego magazynu, odpięcie
//    (PUT/POST/DELETE /api/products/{id}/warehouses[/{wh}] — products:setStock / stockAdd / stockRemove),
//  - ekran #/produkty/magazyny: lista magazynów Selly z ustawieniami (domyślny, sprzedaż mimo braku, ukrywanie przy braku, czas dostawy),
//    edycja i dodawanie (GET/POST/PUT /api/warehouses — products:warehouses / warehouseSave; zapis wymaga prawa do sekcji „Magazyny”),
//  - usuwanie produktu (DELETE /api/products/{id} — products:delete, tylko administrator panelu).
// Każdy zapis: walidacja → podgląd zmian → potwierdzenie. Fizyczne stany i ruchy prowadzi osobny moduł Magazyny (js/modules/magazyny.js).
import { el, flash, money, filterSection, loadingBox, sellyLink, isUnavailable, sortMark } from '../core/ui.js?v=a0c413f';
import { api, ctx } from '../core/client.js?v=a0c413f';
import { previewModal } from './produktPodglad.js?v=a0c413f';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const sellyRoute = route => ((ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK) + '?a=' + route;
const str = v => (v == null ? '' : String(v));
const num = v => (v == null || v === '' || isNaN(Number(v)) ? '—' : String(Number(v)));
const th = (label, tip, cls) => el('th', { class: cls || null }, el('span', { title: tip || label, class: tip && tip !== label ? 'tip' : null }, label));
const STOCK_TIP = 'Stan zapisany w Selly dla tego produktu. Stan fizyczny prowadzi moduł Magazyny (ruchy: przyjęcia, wydania, inwentaryzacja) — tutaj poprawiasz tylko liczbę w Selly, bez zapisu ruchu.';

/** '' = poprawna liczba ≥ 0 (albo puste, gdy allowEmpty). */
export function checkAmount(v, label, { int = false, allowEmpty = false } = {}) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return allowEmpty ? '' : label + ': podaj liczbę.';
  const n = Number(s.replace(',', '.'));
  if (!isFinite(n) || n < 0) return label + ': podaj liczbę nie mniejszą niż 0.';
  if (int && !Number.isInteger(n)) return label + ': podaj liczbę całkowitą.';
  return '';
}

// ─── Karta produktu: stany w magazynach ────────────────────────────────────────────────────────
export function stockPanel(o) {
  const { id, stock, stockError, warehouses, whName, reload, textVal } = o;
  const list = Array.isArray(stock) ? stock : [];
  const err = el('div', { class: 'pk-err', role: 'alert', hidden: true, id: 'prodStockErr' });
  const say = t => { err.textContent = t || ''; err.hidden = !t; };
  const done = (okMsg, close) => async () => { close(); flash('', okMsg); reload(); };
  const rows = list.map(s => {
    const wid = str(s.warehouse_id != null ? s.warehouse_id : s.id), name = s.name || whName(wid);
    const qty = el('input', { type: 'number', min: '0', step: '1', value: str(s.quantity == null ? 0 : s.quantity), 'aria-label': 'Nowy stan w magazynie ' + name, 'data-wh': wid, class: 'qty-in' });
    const pp = el('input', { type: 'number', min: '0', step: '0.01', value: s.purchase_price == null ? '' : str(s.purchase_price), 'aria-label': 'Cena zakupu w magazynie ' + name, 'data-pp': wid, class: 'qty-in', title: 'Cena zakupu (netto) tego produktu w tym magazynie — do liczenia marży' });
    const set = el('button', { type: 'button', class: 'secondary', write: 'produkty', 'data-wh': wid, title: 'Zapisuje wpisany stan i cenę zakupu (najpierw pokażemy podgląd). ' + STOCK_TIP, onclick: () => {
      const bad = checkAmount(qty.value, 'Stan w „' + name + '”') || checkAmount(pp.value, 'Cena zakupu w „' + name + '”', { allowEmpty: true });
      say(bad); if (bad) return;
      const ch = [];
      const q0 = Number(s.quantity) || 0, q1 = Number(qty.value);
      if (q1 !== q0) ch.push({ label: 'Stan (szt.)', before: num(q0), after: num(q1) });
      const p0 = s.purchase_price == null || s.purchase_price === '' ? '' : Number(s.purchase_price), p1 = pp.value.trim() === '' ? '' : Number(pp.value.replace(',', '.'));
      if (p1 !== '' && p1 !== p0) ch.push({ label: 'Cena zakupu (zł)', before: p0 === '' ? '—' : money(p0), after: money(p1) });
      if (!ch.length) { say('Nic nie zmieniono w magazynie „' + name + '”.'); return; }
      previewModal({ id: 'prodStockConfirm', title: 'Zmienić dane w magazynie „' + name + '”?', rows: ch, write: 'produkty', okLabel: 'Zapisz w Selly',
        note: 'Zmiana trafi do Selly. Nie tworzy ruchu w module Magazyny.',
        onOk: async (close, fail) => {
          const params = { id, whId: wid };
          if (q1 !== q0) params.qty = q1;
          if (p1 !== '' && p1 !== p0) params.purchasePrice = p1;
          try { await api('products:setStock', params); await done('Zapisano w Selly', close)(); } catch (e) { fail('Nie udało się zapisać: ' + (e.message || 'błąd')); }
        } });
    } }, 'Ustaw');
    const rm = el('button', { type: 'button', class: 'secondary small danger', write: 'produkty', 'data-whdel': wid, title: 'Odpina produkt od tego magazynu w Selly (zapytamy o potwierdzenie)', 'aria-label': 'Odepnij od magazynu ' + name, onclick: () =>
      previewModal({ id: 'prodStockDel', title: 'Odpiąć produkt od magazynu „' + name + '”?', danger: true, write: 'produkty', okLabel: 'Odepnij',
        intro: 'Produkt przestanie być prowadzony w tym magazynie w Selly' + (Number(s.quantity) ? ' — jego stan (' + num(s.quantity) + ' szt.) zniknie z sumy' : '') + '.',
        note: 'Ruchy w module Magazyny zostają bez zmian. Produkt możesz przypiąć ponownie.',
        onOk: async (close, fail) => { try { await api('products:stockRemove', { id, whId: wid }); await done('Odpięto od magazynu', close)(); } catch (e) { fail('Nie udało się odpiąć: ' + (e.message || 'błąd')); } } }) }, 'Odepnij');
    return el('tr', null, el('td', null, name), el('td', { class: 'n' }, num(s.quantity)), el('td', { class: 'n nw' }, s.purchase_price != null && s.purchase_price !== '' ? money(s.purchase_price) : ''),
      el('td', { class: 'nw' }, qty), el('td', { class: 'nw' }, pp), el('td', { class: 'nw pk-vact' }, set, rm));
  });
  // Przypięcie do magazynu, w którym produktu jeszcze nie ma
  const have = new Set(list.map(s => str(s.warehouse_id != null ? s.warehouse_id : s.id)));
  const free = (warehouses || []).filter(w => !have.has(str(w.id)));
  let addBox = null;
  if (!stockError && free.length) {
    const wsel = el('select', { id: 'prodStockAddWh', 'aria-label': 'Magazyn' }, el('option', { value: '' }, '— wybierz magazyn —'), free.map(w => el('option', { value: str(w.id) }, w.name || 'Magazyn ' + w.id)));
    const aq = el('input', { type: 'number', min: '0', step: '1', value: '0', id: 'prodStockAddQty', 'aria-label': 'Stan początkowy', class: 'qty-in' });
    const ap = el('input', { type: 'number', min: '0', step: '0.01', id: 'prodStockAddPp', 'aria-label': 'Cena zakupu', class: 'qty-in', placeholder: 'opcjonalnie' });
    const addBtn = el('button', { type: 'button', class: 'secondary', write: 'produkty', id: 'prodStockAddGo', title: 'Przypina produkt do wybranego magazynu w Selly (z podglądem)', onclick: () => {
      const wName = wsel.value ? wsel.options[wsel.selectedIndex].textContent : '';
      const bad = (!wsel.value ? 'Wybierz magazyn.' : '') || checkAmount(aq.value, 'Stan początkowy', { int: true }) || checkAmount(ap.value, 'Cena zakupu', { allowEmpty: true });
      say(bad); if (bad) return;
      previewModal({ id: 'prodStockAddConfirm', title: 'Przypiąć produkt do magazynu „' + wName + '”?', write: 'produkty', okLabel: 'Przypnij w Selly',
        rows: [{ label: 'Magazyn', before: '', after: wName }, { label: 'Stan (szt.)', before: '', after: num(aq.value) }].concat(ap.value.trim() ? [{ label: 'Cena zakupu (zł)', before: '', after: money(ap.value.replace(',', '.')) }] : []),
        onOk: async (close, fail) => {
          try { await api('products:stockAdd', { id, whId: wsel.value, qty: Number(aq.value), ...(ap.value.trim() ? { purchasePrice: Number(ap.value.replace(',', '.')) } : {}) }); await done('Produkt przypięty do magazynu', close)(); }
          catch (e) { fail('Nie udało się przypiąć: ' + (e.message || 'błąd')); }
        } });
    } }, 'Przypnij');
    addBox = filterSection('Przypnij do innego magazynu', el('div', { class: 'pk-upload' },
      el('label', { class: 'pk-f', title: 'Magazyn Selly, w którym produktu jeszcze nie ma' }, el('span', { class: 'pk-l tip' }, 'Magazyn'), wsel),
      el('label', { class: 'pk-f', title: 'Ile sztuk jest w tym magazynie na start' }, el('span', { class: 'pk-l tip' }, 'Stan (szt.)'), aq),
      el('label', { class: 'pk-f', title: 'Cena zakupu (netto) w tym magazynie — do liczenia marży' }, el('span', { class: 'pk-l tip' }, 'Cena zakupu (zł)'), ap), addBtn), { fold: true, tip: 'Opcje dodatkowe' });
  }
  return el('div', { class: 'pk-sec' }, el('h3', null, 'Stany w magazynach ', el('span', { class: 'sub tip', title: STOCK_TIP }, '(na żywo z Selly)')),
    stockError || !Array.isArray(stock) ? el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać stanów z Selly' + (stockError ? ' (' + textVal(stockError) + ')' : '') + '. Reszta danych jest aktualna.')
      : rows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'prodStock' }, el('thead', null, el('tr', null, th('Magazyn', 'Magazyn'), th('Stan', 'Stan w Selly (szt.)', 'n'),
        th('Cena zakupu (zł)', 'Cena zakupu przypisana do tego magazynu w Selly', 'n'), th('Nowy stan', STOCK_TIP), th('Nowa cena zakupu', 'Cena zakupu (netto) do zapisania; puste = bez zmiany'), th('Akcje', 'Zapis zmian albo odpięcie produktu od magazynu'))), el('tbody', null, rows)))
        : el('div', { class: 'empty' }, 'Produkt nie jest przypisany do żadnego magazynu.'),
    err, addBox,
    el('div', { class: 'pk-note' }, 'Ustawienia magazynów (domyślny, sprzedaż mimo braku, ukrywanie przy braku, czas dostawy): ', el('a', { href: '#/produkty/magazyny', class: 'btn-link', id: 'prodWhSettingsLink', title: 'Lista magazynów Selly z ustawieniami — podgląd i edycja' }, 'Ustawienia magazynów →')));
}

// ─── Usuwanie produktu ─────────────────────────────────────────────────────────────────────────
export function deleteProductDialog({ id, name, onDone }) {
  previewModal({ id: 'prodDelConfirm', title: 'Usunąć produkt „' + (name || id) + '”?', danger: true, write: 'produkty', okLabel: 'Usuń na stałe', confirmText: String(id),
    confirmLabel: 'Wpisz numer ID produktu (' + id + '), aby potwierdzić',
    intro: 'Produkt zniknie z Selly razem ze zdjęciami, wariantami i stanami. Tej operacji nie da się cofnąć.',
    note: 'Jeśli chcesz tylko wycofać produkt ze sprzedaży, zamiast usuwać ukryj go (odznacz „Widoczny w sklepie”). Złożone zamówienia zostają bez zmian.',
    onOk: async (close, fail) => {
      try { await api('products:delete', { id, confirm: String(id) }); close(); flash('', 'Produkt usunięty z Selly'); onDone(); }
      catch (e) { fail('Nie udało się usunąć: ' + (e.message || 'błąd')); }
    } });
}

// ─── Ekran #/produkty/magazyny: magazyny Selly z ustawieniami ──────────────────────────────────
const WH_FIELDS = [
  ['name', 'Nazwa magazynu', 'text', 'Nazwa widoczna w panelu i (zależnie od szablonu) w sklepie'],
  ['position', 'Pozycja', 'int', 'Kolejność magazynu na listach (mniejsza = wyżej)'],
  ['delivery_time_day', 'Czas dostawy (dni)', 'int', 'Ile dni trwa dostawa z tego magazynu (liczba, 0–365)'],
  ['delivery_time_text', 'Czas dostawy (tekst)', 'text', 'Tekst o czasie dostawy, np. „wysyłka w 24 h”'],
];
const WH_FLAGS = [
  ['default', 'Magazyn domyślny dla nowych produktów', 'Nowe produkty trafiają do tego magazynu. Domyślny może być tylko jeden — Selly zdejmie oznaczenie z poprzedniego.'],
  ['allow_order_zero_product', 'Sprzedaż mimo braku w magazynie', 'Klient może zamówić produkt, nawet gdy stan w tym magazynie wynosi 0'],
  ['auto_hide_zero_product', 'Ukrywaj produkty przy braku', 'Selly automatycznie ukrywa produkt, gdy jego stan w tym magazynie spadnie do 0'],
];
const WH_TEXTS = [
  ['description', 'Opis magazynu', 'Opis magazynu (np. dla klientów przy dostępności)'],
  ['description_inaccessibility', 'Opis przy braku produktu', 'Tekst pokazywany, gdy produktu z tego magazynu brakuje'],
];
const WH_LABEL = Object.fromEntries([...WH_FIELDS, ...WH_FLAGS, ...WH_TEXTS].map(x => [x[0], x[1]]));

/** Walidacja formularza magazynu: '' albo komunikat. */
export function checkWarehouse(f, creating) {
  if ((creating || 'name' in f) && !String(f.name || '').trim()) return 'Podaj nazwę magazynu.';
  if ('name' in f && String(f.name).length > 255) return 'Nazwa magazynu: maks. 255 znaków.';
  if ('position' in f) { const m = checkAmount(f.position, 'Pozycja', { int: true, allowEmpty: true }); if (m) return m; }
  if ('delivery_time_day' in f) { const m = checkAmount(f.delivery_time_day, 'Czas dostawy (dni)', { int: true, allowEmpty: true }); if (m) return m; if (Number(f.delivery_time_day) > 365) return 'Czas dostawy (dni): najwyżej 365.'; }
  return '';
}

export function warehousesScreen(box, o) {
  const S = { list: null, sort: 'position', dir: 1, editing: null };
  const listHost = el('div', { id: 'whList' }), formHost = el('div', { id: 'whFormHost' });
  const addBtn = el('button', { type: 'button', class: 'btn-primary', write: 'magazyny', id: 'whAdd', title: 'Dodaje nowy magazyn w Selly (z podglądem przed zapisem)', onclick: () => openForm(null) }, '+ Dodaj magazyn');
  box.replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'ord-detail-top' }, el('a', { href: o.listHash, class: 'btn-link', id: 'prodBack', title: 'Wróć do listy produktów' }, '← Produkty'), el('span', { class: 'spacer' }), addBtn),
    el('div', { class: 'card-head' }, el('h2', { id: 'whTitle' }, 'Magazyny Selly — ustawienia'),
      el('div', { class: 'sub' }, 'Jak Selly traktuje produkty w każdym magazynie: który jest domyślny, czy wolno sprzedawać przy braku, czy ukrywać produkty i jaki jest czas dostawy. Fizyczne stany i ruchy prowadzisz w module Magazyny.')),
    formHost, listHost,
    el('div', { class: 'pk-note' }, 'Usuwanie magazynu, opcje wariantów (wyświetlanie niedostępnych, sprzedaż wariantów mimo braku), e-mail magazynu i ustawienia Ceneo — tylko w Selly (API ich nie udostępnia): ',
      sellyLink('Magazyny w Selly ↗', sellyRoute('magazyny'), 'Otwiera listę magazynów w panelu Selly'))));
  load();

  async function load() {
    listHost.replaceChildren(loadingBox('Pobieram magazyny z Selly…'));
    try { S.list = (await api('products:warehouses', {})).warehouses || []; draw(); }
    catch (e) {
      listHost.replaceChildren(isUnavailable(e) && o.unavailable ? o.unavailable() : el('div', { class: 'empty error' }, 'Nie udało się pobrać magazynów: ' + (e.message || 'błąd'), ' ',
        el('button', { type: 'button', class: 'secondary', onclick: load }, 'Spróbuj ponownie')));
    }
  }
  const yes = (v, tip) => el('span', { class: 'ord-st ' + (v ? 'ok' : 'neutral'), title: tip }, v ? 'tak' : 'nie');
  function draw() {
    const rows = S.list.slice().sort((a, b) => {
      const x = a[S.sort], y = b[S.sort];
      const ex = x === '' || x == null, ey = y === '' || y == null;
      if (ex !== ey) return ex ? 1 : -1;   // puste zawsze na końcu
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pl')) * S.dir;
    });
    const sortTh = (key, label, tip, numeric, cls) => {
      const on = S.sort === key;
      return el('th', { class: cls || null, 'aria-sort': on ? (S.dir > 0 ? 'ascending' : 'descending') : null }, el('button', { type: 'button', class: on ? 'th-sort on' : 'th-sort', title: tip + ' — kliknij, aby posortować', 'data-sort': key,
        onclick: () => { if (on) S.dir = -S.dir; else { S.sort = key; S.dir = numeric ? -1 : 1; } draw(); } }, label, sortMark(on, S.dir > 0)));
    };
    if (!rows.length) { listHost.replaceChildren(el('div', { class: 'empty' }, 'Selly nie zwróciło żadnego magazynu.')); return; }
    listHost.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'whTable' },
      el('thead', null, el('tr', null, sortTh('name', 'Nazwa', 'Nazwa magazynu'), sortTh('default', 'Domyślny', 'Magazyn domyślny dla nowych produktów', true),
        sortTh('allow_order_zero_product', 'Sprzedaż mimo braku', 'Czy klient może zamówić produkt, gdy stan w magazynie wynosi 0', true),
        sortTh('auto_hide_zero_product', 'Ukrywanie przy braku', 'Czy Selly ukrywa produkt, gdy jego stan w magazynie spadnie do 0', true),
        sortTh('delivery_time_day', 'Czas dostawy', 'Czas dostawy z magazynu (dni i tekst)', true, 'n'), sortTh('position', 'Poz.', 'Kolejność magazynu na listach', false, 'n'),
        el('th', null, el('span', { title: 'Edycja ustawień magazynu' }, 'Akcje')))),
      el('tbody', null, rows.map(w => el('tr', { 'data-wh': w.id, class: S.editing === w.id ? 'dirty-row' : null },
        el('td', null, el('strong', null, w.name || 'Magazyn ' + w.id), el('div', { class: 'muted small' }, 'ID ' + w.id)),
        el('td', null, yes(w.default, w.default ? 'Nowe produkty trafiają do tego magazynu' : 'Nie jest domyślny')),
        el('td', null, yes(w.allow_order_zero_product, w.allow_order_zero_product ? 'Można zamawiać przy stanie 0' : 'Przy stanie 0 produktu nie da się zamówić')),
        el('td', null, yes(w.auto_hide_zero_product, w.auto_hide_zero_product ? 'Produkt jest ukrywany przy stanie 0' : 'Produkt zostaje widoczny przy stanie 0')),
        el('td', { class: 'n' }, [w.delivery_time_day !== '' ? w.delivery_time_day + ' dni' : '', w.delivery_time_text].filter(Boolean).join(' · ') || '—'),
        el('td', { class: 'n' }, String(w.position)),
        el('td', null, el('button', { type: 'button', class: 'secondary small', write: 'magazyny', 'data-whedit': w.id, title: 'Edytuj ustawienia magazynu „' + (w.name || w.id) + '”', onclick: () => openForm(w) }, 'Edytuj'))))))));
  }

  function openForm(w) {
    const creating = !w;
    S.editing = creating ? null : w.id; if (S.list) draw();
    const init = creating ? { name: '', position: String((S.list || []).length + 1), default: 0, allow_order_zero_product: 0, auto_hide_zero_product: 0, delivery_time_day: '', delivery_time_text: '', description: '', description_inaccessibility: '' } : w;
    const ins = {};
    const err = el('div', { class: 'pk-err', role: 'alert', hidden: true, id: 'whFormErr' });
    const field = ([k, label, kind, tip]) => {
      ins[k] = el('input', { type: kind === 'int' ? 'number' : 'text', min: kind === 'int' ? '0' : null, step: kind === 'int' ? '1' : null, max: k === 'delivery_time_day' ? '365' : null, maxlength: kind === 'text' ? '255' : null,
        id: 'whF_' + k, value: str(init[k]), 'aria-label': label });
      return el('label', { class: 'pk-f', title: tip }, el('span', { class: 'pk-l tip' }, label), ins[k]);
    };
    const flag = ([k, label, tip]) => { ins[k] = el('input', { type: 'checkbox', id: 'whF_' + k, checked: !!Number(init[k]), 'aria-label': label }); return el('label', { class: 'pk-chk', title: tip }, ins[k], el('span', { class: 'tip' }, label)); };
    const area = ([k, label, tip]) => { ins[k] = el('textarea', { id: 'whF_' + k, rows: '3', maxlength: '5000', 'aria-label': label }); ins[k].value = str(init[k]); return el('label', { class: 'pk-f pk-wide', title: tip }, el('span', { class: 'pk-l tip' }, label), ins[k]); };
    const valOf = k => (ins[k].type === 'checkbox' ? (ins[k].checked ? 1 : 0) : ins[k].value);
    const changed = () => {
      const f = {};
      for (const k of Object.keys(ins)) {
        const v = valOf(k), before = ins[k].type === 'checkbox' ? (Number(init[k]) ? 1 : 0) : str(init[k]);
        if (creating ? (v !== '' && v !== 0) || k === 'name' : String(v) !== String(before)) f[k] = v;
      }
      return f;
    };
    const close = () => { S.editing = null; formHost.replaceChildren(); if (S.list) draw(); };
    const save = el('button', { type: 'button', class: 'primary', write: 'magazyny', id: 'whSave', title: 'Sprawdza dane i pokazuje podgląd zmian przed zapisem w Selly', onclick: () => {
      const f = changed();
      const bad = checkWarehouse(f, creating);
      err.textContent = bad; err.hidden = !bad;
      if (bad) return;
      if (!Object.keys(f).length) { err.textContent = 'Nic nie zmieniono.'; err.hidden = false; return; }
      const show = (k, v) => (WH_FLAGS.some(x => x[0] === k) ? (Number(v) ? 'tak' : 'nie') : v);
      previewModal({ id: 'whPreview', title: creating ? 'Dodać magazyn „' + f.name + '”?' : 'Zapisać magazyn „' + (w.name || w.id) + '”?', write: 'magazyny', okLabel: creating ? 'Dodaj w Selly' : 'Zapisz w Selly',
        rows: Object.keys(f).map(k => ({ label: WH_LABEL[k] || k, before: creating ? '' : show(k, init[k]), after: show(k, f[k]) })),
        note: f.default ? 'Ten magazyn stanie się domyślnym dla nowych produktów.' : (f.auto_hide_zero_product ? 'Produkty ze stanem 0 w tym magazynie zaczną znikać ze sklepu.' : 'Zmiana dotyczy wszystkich produktów w tym magazynie.'),
        onOk: async (closeDlg, fail) => {
          try {
            const res = await api('products:warehouseSave', creating ? { fields: f } : { id: w.id, fields: f });
            closeDlg(); flash('', creating ? 'Magazyn dodany w Selly' : 'Magazyn zapisany w Selly');
            close();
            if (res && Array.isArray(res.warehouses)) { S.list = res.warehouses; draw(); } else load();
          } catch (e) { fail('Nie udało się zapisać: ' + (e.message || 'błąd')); }
        } });
    } }, creating ? 'Dalej: podgląd' : 'Zapisz…');
    formHost.replaceChildren(el('div', { class: 'card ord-dialog', id: 'whForm', role: 'group', 'aria-label': creating ? 'Nowy magazyn' : 'Edycja magazynu' },
      el('h3', null, creating ? 'Nowy magazyn' : 'Magazyn „' + (w.name || w.id) + '”'),
      el('div', { class: 'pk-grid' }, WH_FIELDS.map(field)),
      el('div', { class: 'pk-chks pk-wide' }, WH_FLAGS.map(flag)),
      filterSection('Opisy magazynu', el('div', { class: 'pk-grid' }, WH_TEXTS.map(area)), { fold: true, tip: 'Opcje dodatkowe' }),
      err, el('div', { class: 'ord-actions' }, save, el('button', { type: 'button', class: 'secondary', id: 'whCancel', onclick: close }, 'Anuluj'))));
    ins.name.focus();
    formHost.scrollIntoView({ block: 'nearest' });
  }
}
