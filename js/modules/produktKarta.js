// Karta produktu (#/produkty/<id>) i dodawanie produktu (#/produkty/nowy): zakładki, pasek zapisu ze strażnikiem wyjścia, walidacja pól.
// Zapis: products:update (pola) + products:setMeta / setFeatures / setCategories; zdjęcia, warianty i stany magazynowe zapisują się od razu (osobne przyciski).
import { el, flash, field, money, dateStr, cnt, loadingBox, sellyLink, dl, syncedLabel, menuButton, saveBar, filterSection, isUnavailable } from '../core/ui.js?v=5aa9759';
import { api, ctx } from '../core/client.js?v=5aa9759';
import { go, addLeaveGuard } from '../core/router.js?v=5aa9759';
import { sanitizeHtml } from '../lib/htmlSanitize.js?v=5aa9759';
import { noteVisit } from '../core/recents.js?v=5aa9759';
import { isTyping, addKeyTip } from '../core/shortcuts.js?v=5aa9759';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const sellyRoute = (route, id) => adminUrl() + '?a=' + route + (id ? '&id=' + encodeURIComponent(id) : '');
const isUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v);
const isOn = v => v === true || v === 1 || v === '1' || v === 'true';
const str = v => (v == null ? '' : String(v));
const fid = key => 'prodF_' + key.replace(/promo/g, 'prm').replace(/ads_/g, 'cmp_');   // identyfikatory odporne na blokery reklam
const n0 = v => (Number(v) ? String(Number(v)) : '');           // 0 w danych Selly = „nie ustawiono”
const num = v => (v == null || v === '' || isNaN(Number(v)) ? '—' : String(Number(v)));
const textVal = v => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(textVal).filter(Boolean).join(', ') : Object.entries(v).map(([k, x]) => k + ': ' + textVal(x)).join(', ')) : String(v));
const th = (label, tip, cls) => el('th', { class: cls || null }, el('span', { title: tip || label }, label));
const MOVE = { przyjecie: 'Przyjęcie', przesuniecie: 'Przesunięcie', wydanie: 'Wydanie', korekta: 'Korekta' };
const UNITS = [[1, 'szt.'], [2, 'g'], [3, 'kg'], [4, 'mb'], [5, 'm²'], [6, 'm³'], [7, 'opak.']];
const PROMOS = [['hit', 'Hit dnia', 'Produkt w sekcji „hit dnia” w sklepie'], ['glowna', 'Promocja na głównej', 'Produkt w promocjach na stronie głównej sklepu'],
  ['wyprzedaz', 'Wyprzedaż', 'Oznaczenie „wyprzedaż”'], ['cena', 'Najlepsza cena', 'Oznaczenie „najlepsza cena”']];
const TABS_NEW = ['podstawowe', 'ceny', 'opisy', 'seo', 'wysylka'];
const TABS = [['podstawowe', 'Podstawowe'], ['ceny', 'Ceny'], ['magazyn', 'Magazyn'], ['opisy', 'Opisy'], ['seo', 'SEO'], ['wysylka', 'Wymiary i wysyłka'],
  ['zdjecia', 'Zdjęcia'], ['warianty', 'Warianty'], ['atrybuty', 'Atrybuty'], ['powiazane', 'Powiązane']];
const LAZY_TABS = new Set(['opisy', 'wysylka', 'zdjecia', 'atrybuty', 'powiazane']);   // te zakładki potrzebują danych „na żądanie” (products:extra)

// ─── Strażnik wyjścia (jak w karcie zamówienia) ──────────────────────────────
let cur = null;                       // { dirty() } aktualnie otwartej karty
addLeaveGuard(() => (cur && cur.dirty() ? 'W karcie produktu są niezapisane zmiany. Opuścić ją i je odrzucić?' : null));
if (typeof window !== 'undefined') window.addEventListener('beforeunload', ev => { if (cur && cur.dirty()) { ev.preventDefault(); ev.returnValue = ''; } });
// Skrót S (albo Ctrl+S) zapisuje kartę — poza polami tekstowymi; Esc wraca do listy (skróty listy: core/listKeys.js, przycisk #prodBack)
if (typeof document !== 'undefined') document.addEventListener('keydown', ev => {
  if (!cur || !cur.save || ev.defaultPrevented || ev.altKey) return;
  const k = String(ev.key).toLowerCase();
  const ctrl = (ev.ctrlKey || ev.metaKey) && k === 's';
  const plain = k === 's' && !ev.ctrlKey && !ev.metaKey && !isTyping(ev.target) && !document.querySelector('.pal-overlay');
  if (ctrl || plain) { ev.preventDefault(); cur.save(); }
});
export function closeProductCard() { cur = null; }

let dictsP = null;
const getDicts = () => { if (!dictsP) dictsP = api('products:dicts', {}).catch(e => { dictsP = null; throw e; }); return dictsP; };
let lastTab = { id: '', tab: 'podstawowe' };

const fileToBase64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => bad(new Error('Nie udało się odczytać pliku')); r.readAsDataURL(f); });

/** Lista wyboru z wyszukiwarką (dla setek kategorii). Zwraca { node, select }. */
function bigSelect(items, value, label, emptyLabel) {
  const select = el('select', { 'aria-label': label });
  const fill = q => {
    const keep = select.value || value;
    const qq = q.trim().toLowerCase();
    const list = items.filter(x => !qq || x.name.toLowerCase().includes(qq) || String(x.id) === qq || String(x.id) === String(keep));
    select.replaceChildren(el('option', { value: '' }, emptyLabel), ...list.map(x => el('option', { value: String(x.id), selected: String(x.id) === String(keep) }, x.name)),
      ...(keep && !items.some(x => String(x.id) === String(keep)) ? [el('option', { value: String(keep), selected: true }, '#' + keep)] : []));
    select.value = String(keep || '');
  };
  fill('');
  const search = items.length > 12 ? el('input', { type: 'search', placeholder: 'Szukaj na liście…', 'aria-label': label + ' — szukaj', title: 'Wpisz fragment nazwy, żeby zawęzić listę poniżej', oninput: () => fill(search.value) }) : null;
  return { node: el('div', { class: 'pk-big' }, search, select), select };
}

export async function renderProductCard(box, id, o) {
  const creating = id === 'nowy';
  const my = (renderProductCard.seq = (renderProductCard.seq || 0) + 1);
  const live = () => my === renderProductCard.seq;
  cur = null;
  box.replaceChildren(el('div', { class: 'card' }, loadingBox(creating ? 'Przygotowuję formularz…' : 'Pobieram produkt…')));
  let r = { product: {}, editable: [], warehouses: [], availabilities: [], moves: [], sales: {} }, dicts = { categories: [], producers: [] };
  try {
    const [g, d] = await Promise.all([creating ? null : api('products:get', { id }), getDicts().catch(() => null)]);
    if (g) r = g;
    if (d) dicts = d;
  } catch (e) {
    if (!live()) return;
    box.replaceChildren(isUnavailable(e) ? o.unavailable() : el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się pobrać produktu: ' + (e.message || 'błąd'),
      el('div', null, el('a', { href: o.listHash, class: 'btn-link' }, '← Wróć do listy'), ' ', el('button', { type: 'button', class: 'secondary', onclick: () => renderProductCard(box, id, o) }, 'Spróbuj ponownie')))));
    return;
  }
  if (!live()) return;
  const p = r.product || {};
  const stockList = Array.isArray(r.stock) ? r.stock : [];
  const whName = wid => { const w = (r.warehouses || []).find(x => String(x.id) === String(wid)); return w ? w.name : (wid ? 'Magazyn ' + wid : '—'); };
  const reload = () => { if (live()) renderProductCard(box, id, o); };
  const tabs = creating ? TABS.filter(t => TABS_NEW.includes(t[0])) : TABS;

  // ── Rejestr pól: każde ma isDirty / reset / validate / tab ────────────────────────────
  const reg = new Map();
  const bar = saveBar({ id: 'prodCardBar', noun: 'pól', onSave: () => save(), onUndo: () => undo() });
  addKeyTip(bar.node.querySelector('#prodCardBarSave'), 'S');
  const tabBtns = new Map();
  const dirtyKeys = () => [...reg.values()].filter(e => e.isDirty()).map(e => e.key);
  const refresh = () => {
    const d = dirtyKeys();
    bar.set(creating ? 0 : d.length);
    if (creating) bar.node.hidden = true;
    const per = new Map();
    for (const k of d) { const t = reg.get(k).tab; per.set(t, (per.get(t) || 0) + 1); }
    for (const [t, b] of tabBtns) { const n = per.get(t) || 0; b.classList.toggle('dirty', n > 0); b.querySelector('.pk-dot').hidden = n === 0; b.querySelector('.pk-dot').title = n ? 'Zmienione pola w tej zakładce: ' + n : ''; }
    for (const e of reg.values()) if (e.wrap) e.wrap.classList.toggle('pk-changed', !creating && e.isDirty());
  };
  cur = { dirty: () => !creating && dirtyKeys().length > 0, save: () => save() };
  if (!creating) noteVisit({ t: 'product', id, label: p.name || ('Produkt ' + id) });
  const wrapField = (e, label, control, tip, hint) => {
    e.err = el('div', { class: 'pk-err', role: 'alert', hidden: true });
    e.wrap = el('label', { class: 'pk-f', title: tip || null }, el('span', { class: tip ? 'pk-l tip' : 'pk-l' }, label), control, hint ? el('span', { class: 'pk-hint' }, hint) : null, e.err);
    return e.wrap;
  };
  const add = (key, tab, e) => { e.key = key; e.tab = tab; reg.set(key, e); return e; };
  /** Pole tekstowe / liczbowe / lista: kind 'text' | 'num' | 'int' | 'select' | 'area' */
  const inp = (key, tab, label, { tip, hint, kind = 'text', init, attrs, check, max, list, ro, wide }) => {
    const initial = init != null ? String(init) : str(p[key]);
    const tag = kind === 'area' ? 'textarea' : 'input';
    const c = el(tag, Object.assign({ id: fid(key), 'aria-label': label, value: kind === 'area' ? null : initial, maxlength: max ? String(max) : null,
      type: kind === 'num' || kind === 'int' ? 'number' : kind === 'area' ? null : 'text', min: kind === 'num' || kind === 'int' ? '0' : null, step: kind === 'num' ? '0.01' : kind === 'int' ? '1' : null,
      list: list || null, disabled: ro ? true : null }, attrs || {}));
    if (kind === 'area') c.value = initial;
    const e = add(key, tab, { kind, input: c, initial, isDirty: () => c.value !== initial, reset: () => { c.value = initial; e.show(''); },
      value: () => c.value, validate: () => { const v = c.value.trim(); if (check) return check(v); return ''; }, show: m => { e.err.textContent = m; e.err.hidden = !m; c.setAttribute('aria-invalid', m ? 'true' : 'false'); } });
    c.addEventListener('input', () => { refresh(); if (e.err.textContent) e.show(e.validate()); });
    const w = wrapField(e, label, c, tip, hint);
    if (wide) w.classList.add('pk-wide');
    return w;
  };
  const numCheck = (label, { max = 1e9, int = false } = {}) => v => { if (v === '') return ''; const n = Number(v.replace(',', '.')); if (!isFinite(n) || n < 0) return label + ': podaj liczbę nie mniejszą niż 0.'; if (n > max) return label + ': wartość za duża.'; if (int && !Number.isInteger(n)) return label + ': podaj liczbę całkowitą.'; return ''; };
  const chk = (key, tab, label, tip, init) => {
    const initial = init != null ? !!init : isOn(p[key]);
    const c = el('input', { type: 'checkbox', id: fid(key), checked: initial, 'aria-label': label });
    const e = add(key, tab, { kind: 'check', input: c, initial, isDirty: () => c.checked !== initial, reset: () => { c.checked = initial; }, value: () => c.checked, validate: () => '' });
    c.addEventListener('change', refresh);
    e.wrap = el('label', { class: 'pk-chk', title: tip || null }, c, el('span', { class: tip ? 'tip' : null }, label));
    return e.wrap;
  };
  const sel = (key, tab, label, options, { tip, init, emptyLabel }) => {
    const initial = init != null ? String(init) : str(p[key]);
    const opts = options.slice();
    if (initial && !opts.some(x => String(x[0]) === initial)) opts.push([initial, '#' + initial]);
    const c = el('select', { id: fid(key), 'aria-label': label }, emptyLabel != null ? el('option', { value: '' }, emptyLabel) : null, opts.map(x => el('option', { value: String(x[0]), selected: String(x[0]) === initial }, x[1])));
    c.value = initial;
    const e = add(key, tab, { kind: 'select', input: c, initial, isDirty: () => c.value !== initial, reset: () => { c.value = initial; }, value: () => c.value, validate: () => '' });
    c.addEventListener('change', refresh);
    return wrapField(e, label, c, tip);
  };
  const big = (key, tab, label, items, { tip, emptyLabel, required }) => {
    const initial = str(p[key]) === '0' ? '' : str(p[key]);
    const b = bigSelect(items, initial, label, emptyLabel);
    b.select.id = 'prodF_' + key;
    const e = add(key, tab, { kind: 'select', input: b.select, initial, isDirty: () => b.select.value !== initial, reset: () => { b.select.value = initial; e.show(''); }, value: () => b.select.value,
      validate: () => (required && !b.select.value ? label + ': wybierz z listy.' : ''), show: m => { e.err.textContent = m; e.err.hidden = !m; } });
    b.select.addEventListener('change', () => { refresh(); if (e.err.textContent) e.show(e.validate()); });
    return wrapField(e, label, b.node, tip);
  };

  // ── Podstawowe ─────────────────────────────────────────────────────────────────────────────────
  const promoNow = new Set(str(p.promotion).split(',').map(x => x.trim()).filter(Boolean));
  const promoChecks = PROMOS.map(([k, label, tip]) => chk('flag:' + k, 'podstawowe', label, tip, promoNow.has(k)));
  const slugFromName = () => { const n = reg.get('name'); return n ? String(n.input.value).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : ''; };
  const availOpts = (r.availabilities || []).map(a => [a.id, a.name || 'Dostępność nr ' + a.id]);
  const panels = {};
  panels.podstawowe = el('div', { class: 'pk-grid' },
    inp('name', 'podstawowe', 'Nazwa produktu', { tip: 'Nazwa widoczna w sklepie. Nie może być pusta.', max: 500, check: v => (v ? '' : 'Podaj nazwę produktu.'), wide: true }),
    big('category_id', 'podstawowe', 'Kategoria główna', dicts.categories || [], { tip: 'Główna kategoria produktu w sklepie (pełna ścieżka). Kategorie dodatkowe dodasz w zakładce „Powiązane”.', emptyLabel: '— wybierz kategorię —', required: creating }),
    big('producer_id', 'podstawowe', 'Producent', dicts.producers || [], { tip: 'Producent produktu (lista z Selly). Nowego producenta dodasz w panelu Selly.', emptyLabel: '— bez producenta —' }),
    inp('product_code', 'podstawowe', 'Kod producenta', { tip: 'Kod produktu nadany przez producenta (używany też w raportach licencji)', max: 100 }),
    inp('product_symbol', 'podstawowe', 'Symbol', { tip: 'Wewnętrzny symbol produktu (np. do magazynu i faktur)', max: 100 }),
    inp('ean', 'podstawowe', 'Kod EAN', { tip: 'Kod kreskowy produktu — zwykle 8 lub 13 cyfr', max: 100, check: v => (v && !/^\d{8,14}$/.test(v) ? 'EAN to zwykle 8–14 cyfr — sprawdź, czy kod jest poprawny.' : '') }),
    availOpts.length ? sel('availability_id', 'podstawowe', 'Dostępność', availOpts, { tip: 'Komunikat o dostępności w sklepie. Lista pochodzi z produktów w sklepie — nowe rodzaje dodasz w panelu Selly.', emptyLabel: '— bez zmiany / brak —' })
      : inp('availability_id', 'podstawowe', 'Dostępność (nr w Selly)', { tip: 'Numer dostępności z Selly. Bieżąca: ' + (p.availability || 'brak danych'), kind: 'int', check: numCheck('Dostępność', { int: true }) }),
    el('div', { class: 'pk-f' }, el('span', { class: 'pk-l' }, 'Widoczność'), chk('visible', 'podstawowe', 'Widoczny w sklepie', creating ? 'Nowy produkt jest domyślnie ukryty — włącz, gdy uzupełnisz dane i zdjęcia.' : 'Odznacz, aby ukryć produkt przed klientami', creating ? false : isOn(p.visible))),
    el('div', { class: 'pk-f pk-wide' }, el('span', { class: 'pk-l tip', title: 'Oznaczenia wyróżniające produkt w sklepie' }, 'Wyróżnienia'),
      el('div', { class: 'pk-chks' }, chk('promotion_new', 'podstawowe', 'Nowość', 'Oznaczenie „nowość”'), ...promoChecks,
        chk('promotion_category', 'podstawowe', 'Promocja w kategorii', 'Produkt wyróżniony na liście swojej kategorii', Number(p.promotion_category) > 0)),
      el('span', { class: 'pk-hint' }, 'Bestseller, przedsprzedaż i negocjację ceny ustawisz tylko w Selly: ', sellyLink('Edytuj w Selly ↗', sellyRoute(creating ? 'produkty.nowyProdukt' : 'produkty.zmienProdukt', creating ? '' : id), 'Otwiera pełny formularz produktu w Selly (te oznaczenia nie są dostępne w API)'))),
    filterSection('Opcje dodatkowe', el('div', { class: 'pk-grid' },
      inp('product_name_additional', 'podstawowe', 'Dopisek do nazwy', { tip: 'Krótki tekst dopisany do nazwy (np. wariant lub rozmiar)', max: 500 }),
      inp('provider_code', 'podstawowe', 'Kod dostawcy', { tip: 'Kod produktu u dostawcy / w hurtowni', max: 100 }),
      inp('note', 'podstawowe', 'Notatka wewnętrzna', { tip: 'Notatka widoczna tylko w panelu — nie w sklepie', kind: 'area', max: 2000, attrs: { rows: '2' } }),
      inp('promotion_text', 'podstawowe', 'Tekst promocyjny', { tip: 'Krótki napis przy produkcie, np. „-20% do niedzieli”', max: 500 }),
      inp('promotion_icon', 'podstawowe', 'Ikona promocji', { tip: 'Nazwa ikony promocji z szablonu sklepu', max: 100 }),
      inp('order_in_category', 'podstawowe', 'Kolejność w kategorii', { tip: 'Im mniejsza liczba, tym wyżej na liście kategorii', kind: 'num', check: numCheck('Kolejność') }),
      chk('ads_compare_export', 'podstawowe', 'Eksportuj do porównywarek cen', 'Czy produkt trafia do plików dla porównywarek cen (np. Ceneo)'),
      inp('ads_compare', 'podstawowe', 'Porównywarki (lista)', { tip: 'Lista porównywarek, do których eksportujemy produkt', max: 500 })), { fold: true, tip: 'Opcje dodatkowe' }));

  // ── Ceny ───────────────────────────────────────────────────────────────────────────────────────
  const netHint = el('span', { class: 'pk-net', id: 'prodNet' });
  const updNet = () => {
    const pr = Number(String(reg.get('price').input.value).replace(',', '.')), vat = Number(reg.get('vat_rate').input.value);
    netHint.textContent = isFinite(pr) && reg.get('price').input.value !== '' && isFinite(vat) && reg.get('vat_rate').input.value !== '' ? 'netto ≈ ' + money(pr / (1 + vat / 100)) + ' zł' : '';
  };
  panels.ceny = el('div', { class: 'pk-grid' },
    inp('price', 'ceny', 'Cena brutto (zł)', { tip: 'Cena produktu w sklepie, w złotych brutto', kind: 'num', check: v => (v === '' ? 'Podaj cenę (może być 0).' : numCheck('Cena')(v)), hint: netHint }),
    inp('vat_rate', 'ceny', 'Stawka VAT (%)', { tip: 'Stawka VAT jako liczba (np. 23, 8, 5, 0). Służy do pokazania ceny netto obok.', kind: 'int', init: p.vat_rate == null ? '' : p.vat_rate, check: numCheck('VAT', { max: 100, int: true }), list: 'prodVatList', attrs: { max: '100' } }),
    el('datalist', { id: 'prodVatList' }, ['0', '5', '8', '23'].map(v => el('option', { value: v }))),
    inp('previous_price', 'ceny', 'Cena poprzednia (zł)', { tip: 'Cena przed obniżką — sklep pokaże ją przekreśloną', kind: 'num', init: n0(p.previous_price), check: numCheck('Cena poprzednia') }),
    filterSection('Poziomy cenowe (hurt) i pozostałe ceny', el('div', { class: 'pk-grid' },
      ...[1, 2, 3].map(i => inp('discount_price_level_' + i, 'ceny', 'Cena – poziom ' + i + ' (zł)', { tip: 'Cena dla klientów z przypisanym poziomem cenowym ' + i + ' (np. hurtownicy). Puste = bez osobnej ceny.', kind: 'num', init: n0(p['discount_price_level_' + i]), check: numCheck('Poziom ' + i) })),
      inp('price_purchase', 'ceny', 'Cena zakupu (zł)', { tip: 'Ile kosztuje Cię produkt — do liczenia marży', kind: 'num', init: n0(p.price_purchase), check: numCheck('Cena zakupu') }),
      inp('price_accounting', 'ceny', 'Cena ewidencyjna (zł)', { tip: 'Cena do ewidencji księgowej', kind: 'num', init: n0(p.price_accounting), check: numCheck('Cena ewidencyjna') }),
      inp('fixed_standard_price', 'ceny', 'Cena standardowa stała (zł)', { tip: 'Stała cena standardowa produktu', kind: 'num', init: n0(p.fixed_standard_price), check: numCheck('Cena standardowa') }),
      inp('min_margin', 'ceny', 'Marża minimalna (%)', { tip: 'Najniższa dopuszczalna marża', kind: 'num', init: n0(p.min_margin), check: numCheck('Marża') })), { fold: true, tip: 'Opcje dodatkowe' }),
    el('div', { class: 'pk-note' }, 'Ceny indywidualne klientów, historię cen i ceny wg wymiarów edytujesz w Selly: ', sellyLink('Ceny indywidualne ↗', sellyRoute('produkty.indywidualneCeny', id), 'Otwiera ceny indywidualne tego produktu w Selly'), ' ', sellyLink('Historia cen ↗', sellyRoute('produkty.historiaCeny', id), 'Otwiera historię zmian ceny w Selly')));
  panels.ceny.addEventListener('input', updNet);

  // ── Magazyn ────────────────────────────────────────────────────────────────────────────────────
  const stockHost = el('div', { id: 'prodStockDlg' });
  const stockTip = 'Stan magazynowy zapisany w Selly dla tego produktu. Uwaga: stan fizyczny prowadzi moduł Magazyny (ruchy: przyjęcia, wydania, inwentaryzacja) — tutaj poprawiasz tylko liczbę widoczną w Selly, bez zapisu ruchu.';
  function confirmStock(wid, name, from, to) {
    const close = () => stockHost.replaceChildren();
    stockHost.replaceChildren(el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Zmiana stanu w magazynie' },
      el('h3', null, 'Zmienić stan w magazynie „' + name + '”?'),
      el('p', null, 'Z ', el('strong', null, String(from)), ' na ', el('strong', null, String(to)), ' szt.'),
      el('p', { class: 'muted small' }, 'Zmiana zostanie zapisana w Selly. Nie tworzy ruchu w module Magazyny.'),
      el('div', { class: 'ord-actions' },
        el('button', { type: 'button', class: 'primary', id: 'prodStockConfirm', onclick: async () => {
          try { await api('products:setStock', { id, whId: wid, qty: to }); flash('', 'Stan zapisany w Selly'); reload(); } catch (e) { close(); flash('', 'Nie udało się zapisać stanu: ' + (e.message || 'błąd')); }
        } }, 'Zmień stan'),
        el('button', { type: 'button', class: 'secondary', id: 'prodStockCancel', onclick: close }, 'Anuluj'))));
  }
  const stockRows = stockList.map(s => {
    const wid = String(s.warehouse_id != null ? s.warehouse_id : s.id), name = s.name || whName(wid);
    const i = el('input', { type: 'number', min: '0', step: '1', value: String(s.quantity == null ? 0 : s.quantity), 'aria-label': 'Nowy stan w magazynie ' + name, 'data-wh': wid, class: 'qty-in' });
    const b = el('button', { type: 'button', class: 'secondary', 'data-wh': wid, title: 'Ustaw ' + name + ' na wpisaną liczbę (zapytamy o potwierdzenie). ' + stockTip, onclick: () => {
      const q = Number(i.value);
      if (i.value === '' || !isFinite(q) || q < 0) { flash('', 'Ilość musi być liczbą nie mniejszą niż 0'); return; }
      confirmStock(wid, name, Number(s.quantity) || 0, q);
    } }, 'Ustaw');
    return el('tr', null, el('td', null, name), el('td', { class: 'n' }, num(s.quantity)), el('td', { class: 'n nw' }, s.purchase_price != null && s.purchase_price !== '' ? money(s.purchase_price) : ''), el('td', { class: 'nw' }, i, ' ', b));
  });
  const stockCard = el('div', { class: 'pk-sec' }, el('h3', null, 'Stany w magazynach ', el('span', { class: 'sub tip', title: stockTip }, '(na żywo z Selly)')),
    r.stockError || !Array.isArray(r.stock) ? el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać stanów z Selly' + (r.stockError ? ' (' + textVal(r.stockError) + ')' : '') + '. Reszta danych jest aktualna.')
      : stockRows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'prodStock' }, el('thead', null, el('tr', null, th('Magazyn', 'Magazyn w Selly'), th('Stan', 'Stan w Selly (szt.)', 'n'), th('Cena zakupu (zł)', 'Cena zakupu przypisana do tego magazynu w Selly', 'n'), th('Ustaw stan', stockTip))), el('tbody', null, stockRows)))
        : el('div', { class: 'empty' }, 'Produkt nie ma przypisanych magazynów.'),
    stockHost);
  const sales = r.sales || {}, moves = r.moves || [];
  panels.magazyn = el('div', null, stockCard,
    el('div', { class: 'pk-sec' }, el('h3', null, 'Lokalizacja i jednostki'), el('div', { class: 'pk-grid' },
      inp('warehouse_localisation', 'magazyn', 'Lokalizacja w magazynie', { tip: 'Opis miejsca składowania, np. regał i półka', max: 500 }),
      sel('warehouse_id', 'magazyn', 'Magazyn domyślny', (r.warehouses || []).map(w => [w.id, w.name]), { tip: 'Magazyn, z którego Selly domyślnie pobiera produkt', emptyLabel: '— bez zmiany —' }),
      sel('unit_of_measure', 'magazyn', 'Jednostka miary', UNITS, { tip: 'W czym liczymy ilość produktu (szt., kg, mb…)', emptyLabel: '—' }),
      filterSection('Opcje ilości', el('div', { class: 'pk-grid' },
        inp('quantity_minimum', 'magazyn', 'Minimalna ilość w zamówieniu', { tip: 'Najmniejsza liczba, jaką klient może zamówić', kind: 'num', init: n0(p.quantity_minimum), check: numCheck('Minimalna ilość') }),
        inp('quantity_increase', 'magazyn', 'Przyrost ilości', { tip: 'Co ile sztuk klient może zwiększać ilość (np. 6 = po 6 szt.)', kind: 'num', init: n0(p.quantity_increase), check: numCheck('Przyrost') }),
        inp('quantity_precision', 'magazyn', 'Miejsca po przecinku (0–3)', { tip: 'Ile miejsc po przecinku ma ilość: 0 = tylko całe sztuki', kind: 'int', check: numCheck('Dokładność', { max: 3, int: true }) })), { fold: true, tip: 'Opcje dodatkowe' }))),
    creating ? null : el('div', { class: 'pk-sec' }, el('h3', null, 'Sprzedaż'),
      dl([['Zamówień z tym produktem', String(sales.orders || 0), 'Liczba różnych zamówień w kopii zamówień panelu, w których jest ten produkt'], ['Sprzedanych sztuk', String(sales.qty || 0), 'Suma sztuk z tych zamówień (anulowane też wchodzą do sumy)']])),
    creating ? null : el('div', { class: 'pk-sec' }, el('h3', null, 'Ostatnie ruchy magazynowe ', el('span', { class: 'sub' }, '(moduł Magazyny)')),
      moves.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'prodMoves' }, el('thead', null, el('tr', null, th('Czas', 'Kiedy zapisano ruch'), th('Rodzaj', 'Przyjęcie, przesunięcie, wydanie lub korekta'), th('Ilość', 'Liczba sztuk', 'n'), th('Z', 'Magazyn źródłowy'), th('Do', 'Magazyn docelowy'), th('Zamówienie', 'Numer zamówienia, którego dotyczył ruch'), th('Autor', 'Kto zapisał ruch'), th('Notatka', 'Notatka do ruchu'))),
        el('tbody', null, moves.map(m => el('tr', null, el('td', { class: 'nw' }, m.ms ? dateStr(new Date(m.ms).toISOString()) : ''), el('td', null, MOVE[m.type] || m.type || ''), el('td', { class: 'n' }, num(m.qty)),
          el('td', null, m.fromWh ? whName(m.fromWh) : ''), el('td', null, m.toWh ? whName(m.toWh) : ''), el('td', null, m.orderNumber || ''), el('td', null, m.author || ''), el('td', null, m.note || '')))))) : el('div', { class: 'empty' }, 'Brak ruchów magazynowych w panelu.')));

  // ── Opisy (HTML ze sprawdzaniem + podgląd) ─────────────────────────────────────────────────────
  function htmlEditor(key, label, tip, rows) {
    const initial = str(p[key]);
    const ta = el('textarea', { id: fid(key), rows: String(rows), class: 'pk-code', 'aria-label': label, spellcheck: 'false' });
    ta.value = initial;
    const prev = el('div', { class: 'pk-preview', id: 'prodPrev_' + key, 'aria-label': 'Podgląd: ' + label });
    const warn = el('div', { class: 'notice warn', hidden: true, role: 'status' }, 'Część treści (np. skrypty, ramki, atrybuty zdarzeń) jest niedozwolona i zostanie usunięta przy zapisie — podgląd pokazuje wynik po oczyszczeniu.');
    const render = () => { const clean = sanitizeHtml(ta.value); prev.innerHTML = clean || ''; if (!clean) prev.replaceChildren(el('span', { class: 'muted small' }, 'Podgląd pojawi się tutaj.')); warn.hidden = clean.replace(/\s+/g, '') === ta.value.replace(/\s+/g, '') || !ta.value.trim(); };
    const wrapSel = (open, close) => { const s = ta.selectionStart, e2 = ta.selectionEnd, v = ta.value; ta.value = v.slice(0, s) + open + v.slice(s, e2) + close + v.slice(e2); ta.focus(); ta.selectionStart = s + open.length; ta.selectionEnd = e2 + open.length; ta.dispatchEvent(new Event('input')); };
    const tb = (t, tipText, a, b) => el('button', { type: 'button', class: 'secondary small', title: tipText, onclick: () => wrapSel(a, b) }, t);
    const bar2 = el('div', { class: 'pk-tb', role: 'toolbar', 'aria-label': 'Formatowanie: ' + label },
      tb('B', 'Pogrubienie zaznaczonego tekstu', '<strong>', '</strong>'), tb('I', 'Kursywa', '<em>', '</em>'), tb('Nagłówek', 'Nagłówek (h3)', '<h3>', '</h3>'), tb('Akapit', 'Akapit', '<p>', '</p>'),
      tb('• Lista', 'Lista punktowana — każdy punkt w osobnym <li>', '<ul>\n<li>', '</li>\n</ul>'), tb('Link', 'Odnośnik: wstawia adres https://', '<a href="https://">', '</a>'), tb('↵', 'Nowa linia', '', '<br>'));
    const e = add(key, 'opisy', { kind: 'html', input: ta, initial, isDirty: () => ta.value !== initial, reset: () => { ta.value = initial; render(); e.show(''); }, value: () => ta.value,
      validate: () => (ta.value.length > (key === 'content_html' ? 200000 : 20000) ? label + ': za długi tekst.' : ''), show: m => { e.err.textContent = m; e.err.hidden = !m; } });
    ta.addEventListener('input', () => { render(); refresh(); });
    render();
    e.err = el('div', { class: 'pk-err', role: 'alert', hidden: true });
    e.wrap = el('div', { class: 'pk-f pk-wide', title: tip }, el('span', { class: 'pk-l tip' }, label), bar2, ta, warn, el('div', { class: 'pk-prevhead' }, 'Podgląd'), prev, e.err);
    return e.wrap;
  }
  const extraState = { loaded: false, loading: false, error: '', data: null };
  const metaInit = () => { const m = (extraState.data && extraState.data.meta) || []; const f = k => m.find(x => x && x.meta_key === k); return { free: f('free_delivery') ? isOn(f('free_delivery').meta_value) : false, over: f('produkt_opis_nadpisz_sekcjami') ? isOn(f('produkt_opis_nadpisz_sekcjami').meta_value) : false, rel: f('produkt_powiazany') ? str(f('produkt_powiazany').meta_value) : '' }; };
  const metaOverHost = el('div', { class: 'pk-f pk-wide', id: 'prodMetaOver' }), metaFreeHost = el('div', { class: 'pk-f', id: 'prodMetaFree' });
  panels.opisy = el('div', { class: 'pk-grid' },
    htmlEditor('content_html_short', 'Opis skrócony', 'Krótki opis widoczny przy produkcie na liście i w karcie', 5),
    htmlEditor('content_html', 'Opis pełny', 'Pełny opis produktu na stronie sklepu. Wolno: akapity, nagłówki, listy, tabele, linki, obrazy. Skrypty i ramki są usuwane.', 14),
    inp('video_description', 'opisy', 'Filmy (adresy lub kod osadzenia)', { tip: 'Pole „filmy” z Selly — adresy filmów do wyświetlenia przy produkcie', kind: 'area', max: 2000, attrs: { rows: '2' }, wide: true }),
    metaOverHost);

  // ── SEO ────────────────────────────────────────────────────────────────────────────────────────
  const seoPrev = el('div', { class: 'pk-serp', id: 'prodSerp', 'aria-label': 'Podgląd wyniku w wyszukiwarce' });
  const upSerp = () => {
    const t = (reg.get('html_title').input.value || reg.get('name').input.value || 'Tytuł strony'), d = reg.get('html_description').input.value || 'Opis strony — wpisz opis SEO, aby kontrolować, co pokaże wyszukiwarka.';
    const slug = reg.get('product_rewrite').input.value;
    let base = isUrl(p.uri) ? p.uri : adminUrl().replace(/adm\/?$/, '');
    if (slug && isUrl(p.uri)) base = p.uri.replace(/[^/]*$/, '') + slug;
    seoPrev.replaceChildren(el('div', { class: 'pk-serp-t' }, t.slice(0, 70)), el('div', { class: 'pk-serp-u' }, base), el('div', { class: 'pk-serp-d' }, d.slice(0, 170)));
  };
  const counter = (key, ideal) => { const e = () => reg.get(key); return el('span', { class: 'pk-count', id: 'prodCnt_' + key }, ''); };
  panels.seo = el('div', { class: 'pk-grid' },
    inp('html_title', 'seo', 'Tytuł strony (SEO)', { tip: 'Tytuł w wynikach wyszukiwarki i na karcie przeglądarki. Zalecane do ok. 60 znaków; puste = nazwa produktu.', max: 255, hint: counter('html_title') }),
    inp('html_description', 'seo', 'Opis strony (SEO)', { tip: 'Opis pod tytułem w wynikach wyszukiwarki. Zalecane do ok. 160 znaków.', kind: 'area', max: 500, attrs: { rows: '3' }, hint: counter('html_description') }),
    inp('html_keywords', 'seo', 'Słowa kluczowe', { tip: 'Słowa kluczowe oddzielone przecinkami (dziś mają małe znaczenie dla wyszukiwarek)', max: 500 }),
    inp('product_rewrite', 'seo', 'Adres produktu (końcówka URL)', { tip: 'Końcówka adresu strony produktu: małe litery bez polskich znaków, cyfry i myślniki. Zmiana adresu zmienia link do produktu!', max: 255,
      check: v => (v && !/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(v) ? 'Adres: tylko litery bez polskich znaków, cyfry, „-”, „_”, „.” i „/”.' : ''),
      hint: el('button', { type: 'button', class: 'linkbtn', title: 'Wstawia adres utworzony z nazwy produktu', onclick: () => { const e = reg.get('product_rewrite'); e.input.value = slugFromName(); e.input.dispatchEvent(new Event('input')); } }, 'Utwórz z nazwy') }),
    el('div', { class: 'pk-f pk-wide' }, el('span', { class: 'pk-l tip', title: 'Orientacyjny wygląd wyniku w wyszukiwarce' }, 'Podgląd w wyszukiwarce'), seoPrev));
  panels.seo.addEventListener('input', () => {
    upSerp();
    for (const [k, ideal] of [['html_title', 60], ['html_description', 160]]) { const c = document.getElementById('prodCnt_' + k), n = reg.get(k).input.value.length; if (c) { c.textContent = n + ' / ' + ideal + ' znaków'; c.classList.toggle('over', n > ideal); } }
  });

  // ── Wymiary i wysyłka ──────────────────────────────────────────────────────────────────────────
  panels.wysylka = el('div', { class: 'pk-grid' },
    inp('weight', 'wysylka', 'Waga (kg)', { tip: 'Waga produktu — używana do wyliczenia kosztu dostawy', kind: 'num', init: n0(p.weight), check: numCheck('Waga') }),
    inp('length', 'wysylka', 'Długość (cm)', { tip: 'Wymiar produktu w centymetrach', kind: 'num', init: n0(p.length), check: numCheck('Długość') }),
    inp('width', 'wysylka', 'Szerokość (cm)', { tip: 'Wymiar produktu w centymetrach', kind: 'num', init: n0(p.width), check: numCheck('Szerokość') }),
    inp('height', 'wysylka', 'Wysokość (cm)', { tip: 'Wymiar produktu w centymetrach', kind: 'num', init: n0(p.height), check: numCheck('Wysokość') }),
    chk('overall_dimensions', 'wysylka', 'Produkt gabarytowy', 'Zaznacz, jeśli paczka jest ponadgabarytowa (inne stawki przewoźników)'),
    inp('delivery', 'wysylka', 'Czas dostawy (tekst)', { tip: 'Tekst o czasie realizacji pokazywany przy produkcie, np. „2–3 dni robocze”', max: 255 }),
    metaFreeHost,
    el('div', { class: 'pk-note pk-wide' }, 'Cennik dostaw i opcje przewoźników ustawiasz w module Przesyłki oraz w Selly: ', sellyLink('Opcje produktu w Selly ↗', sellyRoute('produkty.produktOpcje', id), 'Otwiera dodatkowe opcje sprzedaży produktu w Selly')));

  // ── Dane „na żądanie”: meta, zdjęcia, atrybuty, powiązane ──────────────────────────────────────
  let photos = [], feats = [], cats = [], catsInitial = [];
  const photosHost = el('div', { id: 'prodPhotos' }), featHost = el('div', { id: 'prodFeats' }), relHost = el('div', { id: 'prodRelated' });
  const lazyNote = t => el('div', { class: 'notice warn', role: 'status' }, t);

  function photosView() {
    const list = photos.slice().sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
    const mainIdx = Math.max(0, (Number(p.photo_nr) || 1) - 1);
    const act = async (fn, okMsg) => { try { await fn(); if (okMsg) flash('', okMsg); await loadExtra(true); } catch (e) { flash('', 'Nie udało się: ' + (e.message || 'błąd')); } };
    const move = (i, d) => act(async () => {
      const j = i + d; if (j < 0 || j >= list.length) return;
      await api('products:photoUpdate', { id, photoId: list[i].photo_id, fields: { position: j + 1 } });
      await api('products:photoUpdate', { id, photoId: list[j].photo_id, fields: { position: i + 1 } });
    });
    const cards = list.map((ph, i) => {
      const dsc = el('input', { type: 'text', value: str(ph.description), maxlength: '255', 'aria-label': 'Opis zdjęcia ' + (i + 1), placeholder: 'Opis (tekst alternatywny)', title: 'Opis zdjęcia — tekst alternatywny dla wyszukiwarek i czytników ekranu' });
      const saveDsc = el('button', { type: 'button', class: 'secondary small', hidden: true, title: 'Zapisuje opis tego zdjęcia w Selly', onclick: () => act(() => api('products:photoUpdate', { id, photoId: ph.photo_id, fields: { description: dsc.value } }), 'Opis zapisany') }, 'Zapisz opis');
      dsc.addEventListener('input', () => { saveDsc.hidden = dsc.value === str(ph.description); });
      return el('li', { class: 'pk-photo' + (i === mainIdx ? ' main' : ''), 'data-photo': String(ph.photo_id) },
        isUrl(ph.image_url) ? el('img', { src: ph.image_url, alt: ph.description || 'Zdjęcie ' + (i + 1), loading: 'lazy' }) : el('div', { class: 'pk-noimg' }, 'brak podglądu'),
        i === mainIdx ? el('span', { class: 'pk-badge', title: 'To zdjęcie jest główne — pokazuje się na listach produktów' }, 'Główne') : null,
        dsc, saveDsc,
        el('div', { class: 'pk-photo-act' },
          el('button', { type: 'button', class: 'secondary small', disabled: i === 0, title: i === 0 ? 'To zdjęcie jest już pierwsze' : 'Przesuń zdjęcie wcześniej w galerii', 'aria-label': 'Przesuń zdjęcie ' + (i + 1) + ' wcześniej', onclick: () => move(i, -1) }, '◀'),
          el('button', { type: 'button', class: 'secondary small', disabled: i === list.length - 1, title: i === list.length - 1 ? 'To zdjęcie jest ostatnie' : 'Przesuń zdjęcie później w galerii', 'aria-label': 'Przesuń zdjęcie ' + (i + 1) + ' później', onclick: () => move(i, 1) }, '▶'),
          el('button', { type: 'button', class: 'secondary small', disabled: i === mainIdx, title: i === mainIdx ? 'To zdjęcie jest już główne' : 'Ustaw jako zdjęcie główne produktu', onclick: () => act(async () => { await api('products:update', { id, fields: { photo_nr: i + 1 } }); p.photo_nr = i + 1; }, 'Zdjęcie główne zmienione') }, '★ Główne'),
          el('button', { type: 'button', class: 'secondary small danger', title: 'Usuwa to zdjęcie z produktu w Selly (zapytamy o potwierdzenie)', onclick: () => { if (confirm('Usunąć to zdjęcie z produktu w Selly?')) act(() => api('products:photoDelete', { id, photoId: ph.photo_id }), 'Zdjęcie usunięte'); } }, 'Usuń')));
    });
    const fileIn = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, id: 'prodPhotoFile', 'aria-label': 'Wybierz zdjęcia z dysku' });
    const urlIn = el('input', { type: 'url', id: 'prodPhotoUrl', placeholder: 'https://… adres zdjęcia', 'aria-label': 'Adres zdjęcia w internecie', title: 'Selly pobierze zdjęcie z podanego adresu' });
    const msg = el('div', { class: 'muted small', role: 'status', id: 'prodPhotoMsg' });
    const upBtn = el('button', { type: 'button', class: 'primary', id: 'prodPhotoUp', title: 'Wysyła wybrane pliki do Selly (JPG, PNG, WebP lub GIF, do 6 MB każdy)', onclick: async () => {
      const files = [...fileIn.files];
      if (!files.length) { msg.textContent = 'Najpierw wybierz plik.'; return; }
      upBtn.disabled = true;
      let okN = 0;
      for (const f of files) {
        if (f.size > 6 * 1024 * 1024) { msg.textContent = f.name + ': plik większy niż 6 MB.'; continue; }
        try { msg.textContent = 'Wysyłam ' + f.name + '…'; await api('products:photoAdd', { id, name: f.name, mime: f.type, base64: await fileToBase64(f) }); okN++; } catch (e) { msg.textContent = f.name + ': ' + (e.message || 'błąd'); }
      }
      upBtn.disabled = false; fileIn.value = '';
      if (okN) { flash('', 'Dodano zdjęć: ' + okN); await loadExtra(true); }
    } }, 'Wyślij zdjęcia');
    const urlBtn = el('button', { type: 'button', class: 'secondary', id: 'prodPhotoUrlBtn', title: 'Dodaje zdjęcie z podanego adresu', onclick: async () => {
      if (!/^https?:\/\//i.test(urlIn.value.trim())) { msg.textContent = 'Podaj adres zaczynający się od http:// lub https://'; return; }
      urlBtn.disabled = true;
      try { await api('products:photoAdd', { id, url: urlIn.value.trim() }); urlIn.value = ''; flash('', 'Zdjęcie dodane'); await loadExtra(true); } catch (e) { msg.textContent = e.message || 'błąd'; }
      urlBtn.disabled = false;
    } }, 'Dodaj z adresu');
    photosHost.replaceChildren(
      list.length ? el('ul', { class: 'pk-photos' }, cards) : el('div', { class: 'empty' }, 'Produkt nie ma jeszcze zdjęć.'),
      el('div', { class: 'pk-sec' }, el('h3', null, 'Dodaj zdjęcia'), el('div', { class: 'pk-upload' }, fileIn, upBtn), el('div', { class: 'pk-upload' }, urlIn, urlBtn), msg),
      el('div', { class: 'pk-note' }, 'Zdjęcia zapisują się od razu (nie przez pasek zapisu). Kolejność: strzałki ◀ ▶. Blokady w aukcjach i opisy AI — w Selly: ',
        sellyLink('Zdjęcia w Selly ↗', sellyRoute('produkty.zmienProdukt', id), 'Otwiera produkt w Selly')));
  }

  function featuresView() {
    const rows = feats.map((f, i) => {
      const nm = el('input', { type: 'text', value: f.name, maxlength: '200', 'aria-label': 'Nazwa atrybutu ' + (i + 1), placeholder: 'np. Kolor', oninput: () => { f.name = nm.value; refresh(); } });
      const vl = el('input', { type: 'text', value: f.values, maxlength: '2000', 'aria-label': 'Wartości atrybutu ' + (i + 1), placeholder: 'wartości po przecinku, np. czerwony, biały', title: 'Jedna lub kilka wartości oddzielonych przecinkami', oninput: () => { f.values = vl.value; refresh(); } });
      return el('div', { class: 'pk-feat' }, nm, vl, el('button', { type: 'button', class: 'secondary small', title: 'Usuń ten atrybut (zmiana zapisze się po kliknięciu „Zapisz zmiany”)', 'aria-label': 'Usuń atrybut ' + (i + 1), onclick: () => { feats.splice(i, 1); featuresView(); refresh(); } }, '✕'));
    });
    featHost.replaceChildren(el('div', { class: 'pk-note' }, 'Atrybuty (cechy) opisują produkt w sklepie, np. Kolor, Materiał. ', el('strong', null, 'Zapis zastępuje całą listę atrybutów produktu'), ' — dlatego widzisz tu wszystkie.'),
      rows.length ? el('div', null, rows) : el('div', { class: 'empty' }, 'Produkt nie ma atrybutów.'),
      el('button', { type: 'button', class: 'secondary', id: 'prodFeatAdd', title: 'Dodaje pusty wiersz atrybutu', onclick: () => { feats.push({ name: '', values: '' }); featuresView(); refresh(); } }, '+ Dodaj atrybut'),
      el('div', { class: 'pk-note' }, 'Definicje atrybutów i grupy wariantów — w Selly: ', sellyLink('Atrybuty produktu ↗', sellyRoute('produkty.produktAtrybuty', id), 'Otwiera atrybuty tego produktu w Selly')));
  }

  function relatedView() {
    const d = extraState.data || {};
    const chips = cats.map(c => el('span', { class: 'pk-chip' }, c.name || '#' + c.id, el('button', { type: 'button', class: 'linkbtn', title: 'Usuń kategorię dodatkową (zapis po kliknięciu „Zapisz zmiany”)', 'aria-label': 'Usuń kategorię ' + (c.name || c.id), onclick: () => { cats = cats.filter(x => String(x.id) !== String(c.id)); relatedView(); refresh(); } }, '✕')));
    const addable = (dicts.categories || []).filter(x => !cats.some(c => String(c.id) === String(x.id)) && String(x.id) !== str(p.category_id));
    const bs = bigSelect(addable, '', 'Dodaj kategorię dodatkową', '— wybierz kategorię —');
    bs.select.id = 'prodCatAdd';
    bs.select.addEventListener('change', () => { const v = bs.select.value; if (!v) return; const it = (dicts.categories || []).find(x => String(x.id) === v); cats.push({ id: v, name: it ? it.name : '#' + v }); relatedView(); refresh(); });
    const same = (d.sameBinding || []);
    relHost.replaceChildren(
      el('div', { class: 'pk-sec' }, el('h3', null, 'Kategorie dodatkowe'), el('div', { class: 'pk-chips', id: 'prodCats' }, chips.length ? chips : el('span', { class: 'muted small' }, 'Brak kategorii dodatkowych.')), bs.node),
      el('div', { class: 'pk-sec' }, el('h3', null, 'Produkty powiązane'),
        el('div', { class: 'pk-grid' }, panelsRel.binding, panelsRel.rel),
        (d.relatedNamed || []).length ? el('div', { class: 'pk-chips' }, 'Wskazane produkty: ', d.relatedNamed.map(x => el('a', { class: 'pk-chip', href: '#/produkty/' + encodeURIComponent(x.id), title: 'Otwiera kartę produktu' }, x.name || '#' + x.id))) : null,
        same.length ? el('div', null, el('div', { class: 'muted small' }, 'Inne produkty z tym samym kodem powiązania (' + same.length + '):'), el('ul', { class: 'pk-chips', id: 'prodSame' }, same.map(x => el('li', null, el('a', { class: 'pk-chip', href: '#/produkty/' + encodeURIComponent(x.id), title: 'Otwiera kartę produktu' }, x.name || '#' + x.id, x.code ? ' · ' + x.code : ''))))) : null),
      (d.shops || []).length ? el('div', { class: 'pk-sec' }, el('h3', null, 'Sklepy'), el('div', { class: 'pk-chips' }, d.shops.map(s => el('span', { class: 'pk-chip', title: 'Sklep, w którym produkt jest dostępny (multisklep) — zmiana w Selly' }, s.shop_name || '#' + s.shop_id)))) : null,
      el('div', { class: 'pk-note' }, 'Produkty polecane w koszyku, tagi i subskrypcje — w Selly: ', sellyLink('Polecane w koszyku ↗', sellyRoute('produkty.koszykPolecane', ''), 'Otwiera ustawienia produktów polecanych w koszyku w Selly'), ' ', sellyLink('Tagi ↗', sellyRoute('produkty.produktTagi', id), 'Otwiera tagi produktu w Selly')));
  }
  const panelsRel = {
    binding: inp('binding_code', 'powiazane', 'Kod powiązania', { tip: 'Produkty z tym samym kodem są łączone w sklepie (np. ten sam model w różnych kolorach)', max: 100 }),
    rel: null,
  };
  panels.zdjecia = el('div', null, photosHost);
  panels.warianty = el('div', null);
  panels.atrybuty = el('div', null, featHost);
  panels.powiazane = el('div', null, relHost);

  // meta: opis blokowy, darmowa dostawa, produkty powiązane (wskazane ręcznie) — rejestrowane po wczytaniu extra
  function mountMeta() {
    const m = metaInit();
    const mk = (key, mkey, label, tip, initial, host, tab) => {
      const c = el('input', { type: 'checkbox', id: fid(key), checked: initial, 'aria-label': label });
      const e = add(key, tab, { kind: 'meta', input: c, initial, meta: mkey, isDirty: () => c.checked !== initial, reset: () => { c.checked = initial; }, value: () => c.checked, validate: () => '' });
      c.addEventListener('change', refresh);
      e.wrap = el('label', { class: 'pk-chk', title: tip }, c, el('span', { class: 'tip' }, label));
      host.replaceChildren(e.wrap);
    };
    mk('meta:free_delivery', 'free_delivery', 'Darmowa dostawa', 'Produkt z darmową dostawą (nie dolicza kosztu wysyłki)', m.free, metaFreeHost, 'wysylka');
    mk('meta:over', 'produkt_opis_nadpisz_sekcjami', 'Opis blokowy zastępuje opis HTML', 'Gdy w Selly zbudowano opis z bloków, pokazuje go zamiast opisu HTML na stronie produktu', m.over, metaOverHost, 'opisy');
    const relInit = m.rel;
    const ri = el('input', { type: 'text', id: fid('meta:rel'), value: relInit, maxlength: '2000', 'aria-label': 'Produkty powiązane (ID)' });
    const e = add('meta:rel', 'powiazane', { kind: 'meta', input: ri, initial: relInit, meta: 'produkt_powiazany', isDirty: () => ri.value !== relInit, reset: () => { ri.value = relInit; e.show(''); }, value: () => ri.value,
      validate: () => (ri.value.trim() && !/^[\d\s,;]+$/.test(ri.value.trim()) ? 'Produkty powiązane: podaj numery ID produktów oddzielone przecinkami.' : ''), show: m2 => { e.err.textContent = m2; e.err.hidden = !m2; } });
    ri.addEventListener('input', () => { refresh(); if (e.err.textContent) e.show(e.validate()); });
    panelsRel.rel = wrapField(e, 'Produkty powiązane (numery ID)', ri, 'Numery ID produktów wyświetlanych jako powiązane, oddzielone przecinkami (ID widać na liście produktów)');
    // atrybuty i kategorie dodatkowe jako pola „własne”
    const d = extraState.data || {};
    feats = (d.features || []).map(f => ({ name: str(f.name), values: (Array.isArray(f.values) ? f.values : [f.values]).filter(v => v != null).map(String).join(', ') }));
    const fInit = JSON.stringify(feats);
    add('features', 'atrybuty', { kind: 'custom', isDirty: () => JSON.stringify(feats) !== fInit, reset: () => { feats = JSON.parse(fInit); featuresView(); }, validate: () => (feats.some(f => !f.name.trim() && f.values.trim()) ? 'Atrybut z wartościami musi mieć nazwę.' : '') });
    cats = (d.multiCat || []).map(c => ({ id: String(c.id), name: c.name || '' }));
    const named = c => { const it = (dicts.categories || []).find(x => String(x.id) === String(c.id)); return { id: c.id, name: it ? it.name : c.name }; };
    cats = cats.map(named);
    catsInitial = cats.map(c => c.id).sort();
    add('multicat', 'powiazane', { kind: 'custom', isDirty: () => JSON.stringify(cats.map(c => c.id).sort()) !== JSON.stringify(catsInitial), reset: () => { cats = catsInitial.map(i => named({ id: i, name: '' })); relatedView(); }, validate: () => '' });
    photos = d.photos || [];
    photosView(); featuresView(); relatedView(); refresh();
  }

  async function loadExtra(force) {
    if (creating || extraState.loading || (extraState.loaded && !force)) return;
    extraState.loading = true;
    try {
      extraState.data = await api('products:extra', { id });
      if (!live()) return;
      if (!extraState.loaded) mountMeta(); else { photos = extraState.data.photos || []; photosView(); }
      extraState.loaded = true;
    } catch (e) {
      extraState.error = e.message || 'błąd';
      for (const h of [photosHost, featHost, relHost]) h.replaceChildren(lazyNote('Nie udało się pobrać tych danych z Selly: ' + extraState.error + '. '), el('button', { type: 'button', class: 'secondary', onclick: () => { extraState.error = ''; extraState.loading = false; loadExtra(true); } }, 'Spróbuj ponownie'));
    } finally { extraState.loading = false; }
  }
  for (const h of [photosHost, featHost, relHost]) h.replaceChildren(loadingBox('Pobieram dane z Selly…'));

  // ── Warianty (edycja w wierszu, zapis od razu) ─────────────────────────────────────────────────
  const vs = Array.isArray(r.variants) ? r.variants : [];
  if (r.variantsError) panels.warianty.append(el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać wariantów z Selly (' + textVal(r.variantsError) + ').'));
  else if (!vs.length) panels.warianty.append(el('div', { class: 'empty' }, 'Produkt nie ma wariantów.'));
  else {
    const rowsV = vs.map(v => {
      const vid = String(v.variant_id != null ? v.variant_id : v.id);
      const orig = { code: str(v.code), ean: str(v.ean), price: str(v.price), quantity: str(v.quantity), position: str(v.position), default: isOn(v.default), is_promotion: isOn(v.is_promotion) };
      const mkIn = (k, t, w, lab) => el('input', { type: t, value: orig[k], 'aria-label': lab + ' — wariant ' + vid, class: 'pk-vin ' + (w || ''), min: t === 'number' ? '0' : null, step: k === 'price' ? '0.01' : t === 'number' ? '1' : null, 'data-k': k });
      const ins = { code: mkIn('code', 'text', 'w', 'Kod'), ean: mkIn('ean', 'text', 'w', 'EAN'), price: mkIn('price', 'number', 'n', 'Cena'), quantity: mkIn('quantity', 'number', 'n', 'Stan'), position: mkIn('position', 'number', 'n', 'Pozycja') };
      const def = el('input', { type: 'checkbox', checked: orig.default, 'aria-label': 'Wariant domyślny ' + vid, 'data-k': 'default' }), promo = el('input', { type: 'checkbox', checked: orig.is_promotion, 'aria-label': 'Promocja ' + vid, 'data-k': 'is_promotion' });
      const save = el('button', { type: 'button', class: 'secondary small', 'data-variant': vid, disabled: true, title: 'Zapisuje zmiany tego wariantu w Selly', onclick: async () => {
        const f = {};
        for (const k of Object.keys(ins)) if (ins[k].value !== orig[k]) { if (['price', 'quantity', 'position'].includes(k) && (ins[k].value === '' || !(Number(ins[k].value) >= 0))) { flash('', 'Wariant ' + vid + ': pole „' + k + '” musi być liczbą nie mniejszą niż 0'); return; } f[k] = ins[k].value; }
        if (def.checked !== orig.default) f.default = def.checked; if (promo.checked !== orig.is_promotion) f.is_promotion = promo.checked;
        save.disabled = true;
        try { await api('products:variantUpdate', { id, variantId: vid, fields: f }); flash('', 'Wariant zapisany w Selly'); reload(); } catch (e) { save.disabled = false; flash('', 'Nie udało się zapisać wariantu: ' + (e.message || 'błąd')); }
      } }, 'Zapisz');
      const chg = () => { const d = Object.keys(ins).some(k => ins[k].value !== orig[k]) || def.checked !== orig.default || promo.checked !== orig.is_promotion; save.disabled = !d; tr.classList.toggle('dirty-row', d); };
      const tr = el('tr', { 'data-variant': vid }, el('td', null, textVal(v.features || v.name || v.variant_name) || 'Wariant ' + vid), el('td', null, ins.code), el('td', null, ins.ean), el('td', { class: 'n' }, ins.price), el('td', { class: 'n' }, ins.quantity), el('td', { class: 'n' }, ins.position), el('td', null, def), el('td', null, promo), el('td', null, save));
      tr.addEventListener('input', chg); tr.addEventListener('change', chg);
      return tr;
    });
    panels.warianty.append(el('div', { class: 'table-wrap' }, el('table', { id: 'prodVariants' }, el('thead', null, el('tr', null,
      th('Wariant', 'Cechy wariantu (np. kolor, rozmiar)'), th('Kod', 'Kod producenta wariantu'), th('EAN', 'Kod EAN wariantu'), th('Cena (zł)', 'Cena brutto wariantu', 'n'), th('Stan', 'Stan wariantu w Selly (szt.) — ustawia przyjęcia/wydania, tu tylko korekta', 'n'),
      th('Poz.', 'Pozycja na liście wariantów', 'n'), th('Domyślny', 'Wariant wybrany domyślnie w sklepie'), th('Promocja', 'Wariant oznaczony jako promowany'), th('', 'Zapis wiersza'))), el('tbody', null, rowsV))));
  }
  if (!creating) panels.warianty.append(el('div', { class: 'pk-note' }, 'Zmiany w wierszu zapisujesz przyciskiem „Zapisz” (od razu w Selly). Dodawanie i usuwanie wariantów oraz grupy cech — w Selly: ',
    sellyLink('Warianty w Selly ↗', sellyRoute('produkty.produktWarianty', id), 'Otwiera warianty tego produktu w Selly (dodawanie, usuwanie, kolejność)')));

  // ── Zapis ──────────────────────────────────────────────────────────────────────────────────────
  const msgBox = el('div', { id: 'prodSaveMsg', role: 'status' });
  const goTab = t => { const b = tabBtns.get(t); if (b) b.click(); };
  function validate() {
    const errs = [];
    for (const e of reg.values()) { if (!e.show) continue; if (!creating && !e.isDirty() && e.kind !== 'html') continue; const m = e.validate(); e.show(m); if (m && !/^EAN to zwykle/.test(m)) errs.push({ tab: e.tab, key: e.key, msg: m }); }
    if (creating) for (const k of ['name', 'category_id']) { const e = reg.get(k), m = e.validate(); e.show(m); if (m && !errs.some(x => x.key === k)) errs.push({ tab: 'podstawowe', key: k, msg: m }); }
    return errs;
  }
  function productFields(onlyDirty) {
    const out = {};
    for (const e of reg.values()) {
      if (e.kind === 'custom' || e.kind === 'meta' || e.key.startsWith('flag:') || e.key === 'promotion_category') continue;
      if (onlyDirty && !e.isDirty()) continue;
      const v = e.value();
      if (e.kind === 'check') out[e.key] = !!v;
      else if (e.kind === 'num' || e.kind === 'int') { if (v === '' && !onlyDirty) continue; out[e.key] = v === '' ? 0 : Number(String(v).replace(',', '.')); }
      else if (e.kind === 'select') { if (v === '' && !onlyDirty) continue; out[e.key] = ['category_id', 'producer_id', 'availability_id', 'unit_of_measure', 'warehouse_id'].includes(e.key) ? Number(v) || 0 : v; }
      else { if (v === '' && !onlyDirty) continue; out[e.key] = v; }
    }
    const pk = [...PROMOS.map(x => 'flag:' + x[0])];
    if (pk.some(k => reg.get(k).isDirty()) || (!onlyDirty && pk.some(k => reg.get(k).value()))) out.promotion = PROMOS.filter(x => reg.get('flag:' + x[0]).value()).map(x => x[0]).join(',');
    const pc = reg.get('promotion_category');
    if (pc.isDirty() || (!onlyDirty && pc.value())) out.promotion_category = pc.value() ? (Number(p.promotion_category) > 0 ? Number(p.promotion_category) : 1) : 0;
    return out;
  }
  async function save() {
    const errs = validate();
    if (errs.length) { goTab(errs[0].tab); msgBox.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, errs[0].msg + (errs.length > 1 ? ' (i ' + (errs.length - 1) + ' inne)' : ''))); bar.say(errs[0].msg); return; }
    const dirty = new Set(dirtyKeys());
    if (!creating && !dirty.size) { msgBox.replaceChildren(el('div', { class: 'muted small' }, 'Nic nie zmieniono.')); return; }
    bar.busy(true); msgBox.replaceChildren(el('div', { class: 'muted small' }, 'Zapisuję…'));
    const failed = []; let done = 0;
    try {
      if (creating) {
        const res = await api('products:create', { fields: productFields(false) });
        flash('', 'Produkt dodany w Selly (ukryty, dopóki go nie włączysz)');
        cur = null;
        if (res && res.id) go('/produkty/' + encodeURIComponent(res.id)); else go('/produkty');
        return;
      }
      const f = productFields(true);
      if (Object.keys(f).length) { try { const res = await api('products:update', { id, fields: f }); done += res && res.saved ? res.saved.length : Object.keys(f).length; } catch (e) { failed.push(e.message || 'błąd zapisu pól'); } }
      const metas = [...reg.values()].filter(e => e.kind === 'meta' && e.isDirty());
      if (metas.length) { try { await api('products:setMeta', { id, items: metas.map(e => ({ key: e.meta, value: e.input.type === 'checkbox' ? e.input.checked : e.input.value })) }); done += metas.length; } catch (e) { failed.push('Ustawienia dodatkowe: ' + (e.message || 'błąd')); } }
      if (dirty.has('features')) { try { await api('products:setFeatures', { id, features: feats.map(x => ({ name: x.name, values: x.values.split(',').map(s => s.trim()).filter(Boolean) })).filter(x => x.name.trim()) }); done++; } catch (e) { failed.push('Atrybuty: ' + (e.message || 'błąd')); } }
      if (dirty.has('multicat')) {
        const now = cats.map(c => c.id), was = catsInitial;
        try { await api('products:setCategories', { id, add: now.filter(x => !was.includes(x)), remove: was.filter(x => !now.includes(x)) }); done++; } catch (e) { failed.push('Kategorie dodatkowe: ' + (e.message || 'błąd')); }
      }
    } catch (e) { failed.push(e.message || 'błąd'); }
    bar.busy(false);
    if (failed.length) { msgBox.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Nie wszystko się zapisało: ' + failed.join('; '))); bar.say('Nie zapisano: ' + failed[0]); refresh(); return; }
    flash('', 'Zapisano w Selly: ' + cnt(done, 'zmiana', 'zmiany', 'zmian'));
    cur = null;
    reload();
  }
  function undo() { for (const e of reg.values()) e.reset(); updNet(); upSerp(); msgBox.replaceChildren(); bar.say(''); refresh(); }

  // ── Nagłówek, zakładki, akcje ──────────────────────────────────────────────────────────────────
  const tabList = el('div', { class: 'pk-tabs', role: 'tablist', 'aria-label': 'Sekcje karty produktu' });
  const tabPanels = el('div', { class: 'pk-panels' });
  const activate = t => {
    lastTab = { id, tab: t };
    for (const [k, b] of tabBtns) { const on = k === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); panels[k].hidden = !on; }
    if (LAZY_TABS.has(t)) loadExtra(false);
  };
  for (const [k, label] of tabs) {
    const b = el('button', { type: 'button', role: 'tab', id: 'prodTab_' + k, 'data-tab': k, 'aria-selected': 'false', 'aria-controls': 'prodPanel_' + k, class: 'pk-tab', onclick: () => activate(k),
      onkeydown: ev => { const ks = tabs.map(x => x[0]), i = ks.indexOf(k); const n = ev.key === 'ArrowRight' ? ks[(i + 1) % ks.length] : ev.key === 'ArrowLeft' ? ks[(i + ks.length - 1) % ks.length] : null; if (n) { ev.preventDefault(); activate(n); tabBtns.get(n).focus(); } } },
      label, el('span', { class: 'pk-dot', hidden: true, 'aria-label': 'zmienione' }, '●'));
    tabBtns.set(k, b); tabList.append(b);
    panels[k].id = 'prodPanel_' + k; panels[k].setAttribute('role', 'tabpanel'); panels[k].setAttribute('aria-labelledby', 'prodTab_' + k); panels[k].classList.add('pk-panel'); panels[k].hidden = true;
    tabPanels.append(panels[k]);
  }

  const dupHost = el('div', { id: 'prodDupHost' });
  function duplicateDialog() {
    const nm = el('input', { type: 'text', id: 'prodDupName', value: (p.name || '') + ' (kopia)', maxlength: '500', 'aria-label': 'Nazwa kopii' });
    const go2 = el('button', { type: 'button', class: 'primary', id: 'prodDupGo', onclick: async () => {
      if (!nm.value.trim()) { flash('', 'Podaj nazwę kopii'); return; }
      go2.disabled = true;
      try { const res = await api('products:duplicate', { id, name: nm.value.trim() }); flash('', 'Utworzono kopię (ukrytą)' + (res && res.notCopied && res.notCopied.length ? ' — nie skopiowano: ' + res.notCopied.join(', ') : '')); cur = null; go('/produkty/' + encodeURIComponent(res.id)); }
      catch (e) { go2.disabled = false; flash('', 'Nie udało się zduplikować: ' + (e.message || 'błąd')); }
    } }, 'Utwórz kopię');
    dupHost.replaceChildren(el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Duplikowanie produktu' }, el('h3', null, 'Zduplikować produkt?'),
      el('p', { class: 'muted small' }, 'Skopiujemy dane, opisy, ceny, kategorie i atrybuty. Nie kopiujemy: zdjęć, wariantów, stanów magazynowych, EAN i symbolu. Kopia jest ukryta w sklepie, dopóki jej nie włączysz.'),
      field('Nazwa kopii', nm), el('div', { class: 'ord-actions' }, go2, el('button', { type: 'button', class: 'secondary', onclick: () => dupHost.replaceChildren() }, 'Anuluj'))));
    nm.focus(); nm.select();
  }
  const sellyMenu = menuButton({ id: 'prodSellyMenu', label: 'Więcej w Selly', cls: 'secondary', title: 'Funkcje produktu, których nie ma w panelu OSA — otwierają się w Selly w nowej karcie', items: () => [
    ['Pełny formularz produktu', 'produkty.zmienProdukt'], ['Warianty', 'produkty.produktWarianty'], ['Atrybuty', 'produkty.produktAtrybuty'], ['Ceny indywidualne', 'produkty.indywidualneCeny'], ['Historia cen', 'produkty.historiaCeny'],
    ['Wymiary i cennik wg wymiarów', 'produkty.produktWymiary'], ['Aukcje', 'produkty.produktAukcje'], ['Subskrypcje', 'produkty.produktSubskrypcje'], ['Tagi', 'produkty.produktTagi'], ['Zdarzenia produktu', 'produkty.produktZdarzenia'], ['Bezpieczeństwo produktu (GPSR)', 'produkty.bezpieczenstwoProduktu'], ['Usuń produkt', 'produkty.zmienProdukt']]
    .map(([label, route]) => ({ label: label + ' ↗', title: 'Otwiera w Selly: ' + label, run: () => window.open(sellyRoute(route, id), '_blank', 'noopener') })) });

  const head = el('div', { class: 'card' },
    el('div', { class: 'ord-detail-top' },
      el('a', { href: o.listHash, class: 'btn-link', id: 'prodBack', title: 'Wróć do listy z zachowanymi filtrami, wyszukiwaniem i stroną' }, '← Wróć do listy'), el('span', { class: 'spacer' }),
      creating ? null : el('span', { class: 'muted small tip', title: 'Dane z kopii produktów synchronizowanej z Selly w tle' }, 'dane z: ' + syncedLabel(r.syncedMs)),
      creating ? sellyLink('Pełny formularz w Selly ↗', sellyRoute('produkty.nowyProdukt', ''), 'Otwiera dodawanie produktu w Selly (np. dla opcji, których tu nie ma)')
        : el('span', { class: 'pk-actions' }, el('button', { type: 'button', class: 'secondary', id: 'prodDup', title: 'Tworzy ukrytą kopię tego produktu (bez zdjęć, wariantów i stanów)', onclick: duplicateDialog }, 'Duplikuj'),
          isUrl(p.uri) ? sellyLink('Zobacz w sklepie ↗', p.uri, 'Otwiera stronę produktu w sklepie') : null, sellyMenu)),
    dupHost,
    el('div', { class: 'card-head' }, el('h2', { id: 'prodTitle' }, creating ? 'Nowy produkt' : (p.name || 'Produkt ' + id)), el('div', { class: 'sub' }, creating ? 'Uzupełnij dane i zapisz. Produkt powstanie jako ukryty; zdjęcia, warianty i stany dodasz w jego karcie.' : 'ID ' + id + (isOn(p.visible) ? '' : ' · ukryty w sklepie') + (isOn(p.has_variants) ? ' · z wariantami' : '') + (isOn(p.kit) ? ' · zestaw' : ''))),
    creating ? null : el('div', { class: 'prod-top' }, isUrl(p.main_photo) ? el('img', { class: 'photo', src: p.main_photo, alt: '' }) : null,
      dl([['Stan łącznie (Selly)', p.quantity != null ? num(p.quantity) : '', 'Suma stanów ze wszystkich magazynów wg Selly'], ['Dostępność', p.availability], ['Kod producenta', p.product_code], ['Symbol', p.product_symbol]])));

  const body = el('div', { class: 'card pk-card' }, tabList, msgBox, tabPanels,
    creating ? el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'primary', id: 'prodCreate', title: 'Tworzy produkt w Selly (ukryty w sklepie, dopóki go nie włączysz)', onclick: () => save() }, 'Dodaj produkt'), el('a', { href: o.listHash, class: 'btn-link' }, 'Anuluj')) : null);
  box.replaceChildren(head, body, bar.node);
  const startTab = lastTab.id === id && tabs.some(t => t[0] === lastTab.tab) ? lastTab.tab : 'podstawowe';
  upSerp(); updNet(); panels.seo.dispatchEvent(new Event('input'));
  activate(startTab);
  refresh();
  if (!creating) bar.node.hidden = true;
}
