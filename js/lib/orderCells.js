// Wspólne komórki wierszy zamówień — lista Zamówienia (modules/zamowienia.js) i Wysyłka SpeedMail → Zamówienia (modules/speedmailZam.js)
// wyglądają tak samo: produkty (zdjęcia w 3 rozmiarach, symbol, cena, wartość, rabat), komentarze w kolorach rodzaju,
// wyróżnione formy dostawy i płatności. Treść z Selly tylko przez el() / textContent. Czysta logika i komórki w jednym pliku (mniej plików do wczytania list).
import { el, money, cnt, thumb, store } from '../core/ui.js?v=9e50e6d';


// ─── Czysta logika (bez DOM; testy: tests/unit/orderView.test.js) ───
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = v => Math.round(v * 100) / 100;

/**
 * Pozycje z wiersza listy: itemsJson (n nazwa, q ilość, ph zdjęcie, s symbol, pr cena jedn. brutto, b cena przed rabatem, v wartość)
 * albo — starszy backend — tekst „nazwa × ilość • …”.
 */
export function parseItems(r) {
  try {
    const a = JSON.parse((r && r.itemsJson) || '');
    if (Array.isArray(a) && a.length) return a.map(x => ({ n: x.n, q: num(x.q), ph: x.ph, s: x.s || '', pr: num(x.pr), b: num(x.b), v: num(x.v) }));
  } catch (e) { /* brak danych strukturalnych */ }
  return String((r && r.productsText) || '').split(' • ').filter(Boolean).map(t => { const m = t.match(/^(.*) × (\d+)$/); return m ? { n: m[1], q: Number(m[2]) } : { n: t, q: null }; });
}
/** Cena jednostkowa brutto: z pozycji albo wartość / ilość. */
export function unitPrice(x) {
  if (x.pr != null) return x.pr;
  return x.v != null && x.q ? r2(x.v / x.q) : null;
}
/** Wartość pozycji brutto: z pozycji albo cena × ilość. */
export function lineValue(x) {
  if (x.v != null) return x.v;
  const p = unitPrice(x);
  return p != null && x.q != null ? r2(p * x.q) : null;
}
/** Rabat w % (0–100, jedno miejsce po przecinku) z ceny przed rabatem; null = brak rabatu / brak danych. */
export function discountPct(x) {
  const p = unitPrice(x);
  if (x.b == null || !(x.b > 0) || p == null || p >= x.b) return null;
  return Math.round((1 - p / x.b) * 1000) / 10;
}

// Poziomy cen klienta jak w Selly (klient detaliczny / hurtowy poziom 1–3). Nazwy można zmienić w ustawieniach listy (sklep).
export const PRICE_LEVELS = ['Klient detaliczny', 'Klient hurtowy – poziom 1', 'Klient hurtowy – poziom 2', 'Klient hurtowy – poziom 3'];
/** Nazwy poziomów: własne sklepu (niepuste) albo domyślne. */
export function levelNames(custom) {
  const c = Array.isArray(custom) ? custom : [];
  return PRICE_LEVELS.map((d, i) => (typeof c[i] === 'string' && c[i].trim() ? c[i].trim().slice(0, 60) : d));
}
/** Nazwa poziomu cen klienta (0–3) albo '' (brak klienta / nieznany poziom). */
export function priceLevelName(level, custom) {
  if (level === '' || level == null) return '';
  const n = Number(level);
  return Number.isInteger(n) && n >= 0 && n < PRICE_LEVELS.length ? levelNames(custom)[n] : '';
}

// Opcje widoku listy (Kolumny ▾ → „Widok”): rozmiar zdjęć i dodatki w kolumnie „Zamówione produkty”. Zapis w localStorage modułu.
export const PHOTO_SIZES = { off: 0, s: 32, m: 48, l: 72 };
export const VIEW_DEFAULTS = { photo: 's', symbol: false, price: false, value: false, disc: false };
/** Opcje z pamięci przeglądarki → poprawny obiekt (nieznane / błędne wartości = domyślne). `thumbsOff` — stare ustawienie „bez zdjęć”. */
export function normView(v, thumbsOff) {
  const o = v && typeof v === 'object' ? v : {};
  const out = { ...VIEW_DEFAULTS, photo: thumbsOff ? 'off' : VIEW_DEFAULTS.photo };
  if (Object.hasOwn(PHOTO_SIZES, o.photo)) out.photo = o.photo;
  for (const k of ['symbol', 'price', 'value', 'disc']) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}

// ─── Kolory komentarzy ───
// Kolory komentarzy zamówienia (lista Zamówienia, Wysyłka SpeedMail, karta zamówienia): każdy rodzaj ma własny kolor,
// żeby się nie zlewały. Domyślne kolory = tokeny CSS (--cm-client / --cm-internal / --cm-groups, czytelne w jasnym i ciemnym motywie).
// Ustawienie sklepu (administrator, D1 — orders:prefsSave, w orders:meta jako `prefs.colors`) i własne tej przeglądarki (localStorage)
// nadpisują je zmiennymi --cm-*-u na <html>. Tekst zawsze w kolorze tekstu motywu — kolor = pasek po lewej i lekkie tło.
// Bez zależności (testowalne w Node): applyCommentColors dostaje element z `style.setProperty`.

export const COMMENT_TYPES = [
  { key: 'client', label: 'Komentarz klienta', short: 'Klient', icon: '💬', tip: 'Komentarz wpisany przez klienta przy składaniu zamówienia' },
  { key: 'internal', label: 'Notatka wewnętrzna', short: 'Wewn.', icon: '📝', tip: 'Uwagi do zamówienia dla obsługi sklepu — klient ich nie widzi' },
  { key: 'groups', label: 'Notatki dla grup administratorów', short: 'Grupy', icon: '👥', tip: 'Notatki widoczne dla wybranych grup administratorów Selly' },
];
export const COMMENT_KEYS = COMMENT_TYPES.map(t => t.key);
/** Wartości startowe próbnika (odpowiadają tokenom jasnego motywu). */
export const DEFAULT_COLORS = { client: '#2f6f9f', internal: '#b06a00', groups: '#7b4fa3' };
export const USER_COLORS_KEY = 'osa-cm-colors';
const HEX = /^#[0-9a-f]{6}$/i;

/** Tylko znane rodzaje i kolory #rrggbb (małe litery); reszta pominięta. */
export function normColors(obj) {
  const out = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const k of COMMENT_KEYS) if (typeof obj[k] === 'string' && HEX.test(obj[k].trim())) out[k] = obj[k].trim().toLowerCase();
  return out;
}
/** Kolory obowiązujące: domyślne motywu ← sklepu ← własne użytkownika (puste = motyw). */
export function effectiveColors(shop, user) {
  return { ...normColors(shop), ...normColors(user) };
}
/** Ustawia (albo usuwa) zmienne --cm-<rodzaj>-u na elemencie (zwykle document.documentElement) — CSSOM, zgodne z CSP. */
export function applyCommentColors(colors, root) {
  const r = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!r || !r.style) return;
  const c = normColors(colors);
  for (const k of COMMENT_KEYS) { if (c[k]) r.style.setProperty('--cm-' + k + '-u', c[k]); else r.style.removeProperty('--cm-' + k + '-u'); }
}
/** Komentarze zamówienia z wiersza listy / zamówienia Selly → [{ key, text }] w stałej kolejności, bez pustych. */
function groupLabel(r) {
  const ids = String((r && (r.groupNoteIds || r.id_group_notes)) || '').split(/[,;s]+/).filter(Boolean);
  if (!ids.length) return null;
  const names = Array.isArray(r.groupNoteNames) ? r.groupNoteNames : [];
  const named = ids.map((id, i) => names[i] || '').filter(Boolean);
  return { text: named.length ? named.join(', ') : 'grupy: ' + ids.join(', '), tip: 'Notatka widoczna dla grup administratorów: ' + (named.length ? named.join(', ') + ' (numery ' + ids.join(', ') + ')' : 'numery grup w Selly ' + ids.join(', ')) };
}
export function commentsOf(r) {
  const pick = (...ks) => { for (const k of ks) { const v = r && r[k]; if (typeof v === 'string' && v.trim()) return v.trim(); } return ''; };
  return [
    { key: 'client', text: pick('comment', 'client_comment') },
    { key: 'internal', text: pick('attention', 'order_attention') },
    { key: 'groups', text: pick('groupNotes', 'group_notes'), groups: groupLabel(r) },
  ].filter(x => x.text);
}
export const typeOf = key => COMMENT_TYPES.find(t => t.key === key) || null;

// ─── Komórki (DOM) ───
/** Jeden komentarz: pasek i tło w kolorze rodzaju (lib/orderCells.js), ikona + krótka etykieta, tekst przycięty do 3 linii (całość w tooltipie). */
export function commentNote(key, text, opts, groups) {
  const t = typeOf(key);
  if (!t || !text) return null;
  return el('div', { class: 'cm cm-' + key + (opts && opts.full ? ' full' : ''), 'data-cm': key, title: t.label + ': ' + text },
    el('span', { class: 'cm-h' }, t.icon + ' ' + t.short + ':'), el('span', { class: 'cm-t' }, text),
    groups ? el('span', { class: 'tag tip', title: groups.tip }, groups.text) : null);
}
/** Komentarze jeden pod drugim (`keys` — tylko te rodzaje); `extra` = dodatkowe węzły (np. numer przesyłki). */
export function commentsCell(r, keys, extra) {
  const list = commentsOf(r).filter(c => !keys || keys.includes(c.key));
  return el('div', { class: 'ord-info-cell' }, list.map(c => commentNote(c.key, c.text, null, c.groups)), ...(extra || []));
}
/** Kolumny „po jednej na rodzaj” (wybierane w Kolumny ▾): definicje komórek dla listView. */
export const commentColumns = (opts) => COMMENT_TYPES.map(t => ({
  key: 'cm_' + t.key, label: t.label, def: false, tipHeader: true, tip: t.tip + (opts && opts.tipSuffix ? opts.tipSuffix(t.key) : ''),
  unavailable: opts && opts.unavailable ? opts.unavailable(t.key) : '',
  cell: r => commentsCell(r, [t.key]),
}));

/** Forma dostawy — plakietka z ikoną ciężarówki (ten sam wygląd na wszystkich listach). */
export function deliveryTag(name, price) {
  if (!name) return null;
  const p = Number(price) ? ' · ' + money(price) + ' zł' : '';
  return el('span', { class: 'ord-tag dlv', title: 'Forma dostawy: ' + name + (p ? ' (koszt ' + money(price) + ' zł)' : '') },
    el('span', { class: 'ord-tag-i', 'aria-hidden': 'true' }, '🚚'), name + p);
}
/** Forma płatności — plakietka z ikoną karty (inny kolor niż dostawa). */
export function paymentTag(name) {
  if (!name) return null;
  return el('span', { class: 'ord-tag pay', title: 'Forma płatności: ' + name },
    el('span', { class: 'ord-tag-i', 'aria-hidden': 'true' }, '💳'), name);
}

/**
 * Zamówione produkty: po trzech pozycjach reszta zwinięta („+ N więcej”).
 * o: { view (lib/orderCells.js normView), photo(x) → adres zdjęcia, onMore(r) — gdy brak reszty w wierszu (np. otwórz kartę), title? }
 */
export function itemsCell(r, o) {
  const v = o.view, items = r.items || parseItems(r), total = Number(r.itemCount) || items.length;
  const px = PHOTO_SIZES[v.photo] || 0;
  const pic = x => { const t = thumb(o.photo ? o.photo(x) : '', x.n, px); t.classList.add('thumb-s'); return t; };   // rozmiar: .ord-items.ph-s|m|l
  const extras = x => {
    const out = [];
    if (v.symbol && x.s) out.push(el('span', { class: 'it-sym', title: 'Symbol produktu' }, x.s));
    const p = unitPrice(x), val = lineValue(x), d = discountPct(x);
    if (v.price && p != null) out.push(el('span', { class: 'it-pr', title: 'Cena sprzedaży za sztukę (brutto, po rabacie)' }, money(p) + ' zł/szt.'));
    if (v.value && val != null) out.push(el('span', { class: 'it-val', title: 'Wartość pozycji w koszyku (brutto): cena × ilość' }, '= ' + money(val) + ' zł'));
    if (v.disc && d != null) out.push(el('span', { class: 'it-disc', title: 'Rabat na pozycję: ' + money(x.b) + ' zł → ' + money(p) + ' zł za sztukę' }, '−' + String(d).replace('.', ',') + '%'));
    return out.length ? el('span', { class: 'it-x' }, out) : null;
  };
  const li = x => el('li', null, px ? pic(x) : null,
    el('span', { class: 'it-main' }, el('span', { class: 'nm' }, x.n), ' ', x.q != null ? el('span', { class: 'q' }, '× ' + x.q) : null, extras(x)));
  const shown = items.slice(0, 3), rest = items.slice(3);
  const ul = el('ul', { class: 'ord-items ph-' + v.photo, title: o.title || r.productsText || null }, shown.map(li));
  const hidden = Math.max(0, total - 3);
  if (hidden > 0) {
    const more = el('button', { type: 'button', class: 'more', title: rest.length ? 'Pokaż pozostałe pozycje zamówienia' : 'Pozostałe pozycje zobaczysz w szczegółach zamówienia',
      onclick: ev => { ev.stopPropagation(); if (!rest.length) { if (o.onMore) o.onMore(r); return; } more.remove(); ul.append(...rest.map(li)); } }, '+ ' + cnt(hidden, 'pozycja', 'pozycje', 'pozycji') + ' więcej');
    ul.append(el('li', null, more));
  }
  return ul;
}

/** Kontrolki „Widok” do menu Kolumny ▾ (rozmiar zdjęć + dodatki przy produktach). o: { id, view(), set(patch) } → węzeł. */
export function viewControls(o) {
  const v = o.view();
  const size = el('select', { id: o.id + 'Photo', 'aria-label': 'Zdjęcia produktów', title: 'Rozmiar miniatur zdjęć przy produktach w kolumnie „Zamówione produkty”',
    onchange: () => o.set({ photo: size.value }) },
  [['off', 'bez zdjęć'], ['s', 'małe'], ['m', 'średnie'], ['l', 'duże']].map(([k, t]) => el('option', { value: k, selected: v.photo === k }, t)));
  const chk = (k, label, tip) => {
    const cb = el('input', { type: 'checkbox', id: o.id + 'V_' + k, checked: !!v[k], onchange: () => o.set({ [k]: cb.checked }) });
    return el('label', { class: 'menu-check', title: tip }, cb, el('span', null, label));
  };
  return el('div', { class: 'menu-sec', id: o.id + 'View' },
    el('div', { class: 'menu-h', title: 'Co pokazywać przy każdym produkcie w kolumnie „Zamówione produkty”' }, 'Widok produktów'),
    el('label', { class: 'menu-row', title: 'Rozmiar miniatur zdjęć przy produktach' }, el('span', null, 'Zdjęcia'), size),
    chk('symbol', 'Symbol produktu', 'Pokazuje symbol (kod) produktu przy nazwie'),
    chk('price', 'Cena za sztukę', 'Cena, po jakiej produkt został sprzedany (brutto, po rabacie)'),
    chk('value', 'Wartość pozycji', 'Wartość pozycji w koszyku (brutto): cena × ilość'),
    chk('disc', 'Rabat %', 'Procent rabatu na pozycję — gdy cena sprzedaży jest niższa od ceny przed rabatem'));
}

// Kolory komentarzy: ustawienia sklepu (orders:meta / sm:init → prefs) + własne tej przeglądarki → zmienne CSS na <html>
let shopPrefs = {};
export const shopPrefsNow = () => shopPrefs;
/** Po wczytaniu orders:meta albo sm:init (prefs) i po zmianie ustawień (bez argumentu = tylko ponowne nałożenie). */
export function applyPrefs(prefs) {
  if (prefs) shopPrefs = prefs;
  applyCommentColors(effectiveColors(shopPrefs.colors, store(USER_COLORS_KEY)));
}
