// „Wysyłka SpeedMail” — import plików (czysta logika, bez DOM i bez sieci; przeglądarka i Node):
//   1) plik dostawy od dostawcy (towar wysłany do SpeedMail) → dosyłki sm:move (podgląd, potem zapis porcjami z opId),
//   2) raport wysyłek SpeedMail (nadane paczki: numer zamówienia / paczki zleceń, nr przesyłki) → porównanie z paczkami w D1 (sm:shipMatch).
// Układ obu plików NIE jest znany (właściciel nie przekazał wzorów): kolumny rozpoznajemy po nazwach i zawartości, a użytkownik może je
// przypisać ręcznie — przypisanie zapamiętujemy po „podpisie” nagłówków (headerSignature). Plik czytamy WYŁĄCZNIE w przeglądarce:
// raport wysyłek może zawierać dane odbiorców — na serwer idą tylko numery zamówień / paczek, a potem (po potwierdzeniu) numery przesyłek.
// Parser CSV, kodowanie, kwoty i maskowanie: wspólne z importem wpłat (wplatyCsv.js); .xlsx: lib/xlsxRead.js.
import { decodeBytes, detectSeparator, parseCsv, normHeader, headerSignature, parseAmount, maskCell } from './wplatyCsv.js?v=9f53658';
import { readXlsx, isZip } from '../lib/xlsxRead.js?v=9f53658';

export { headerSignature, maskCell };
export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 3000;          // wierszy danych w jednym pliku
export const MOVE_CHUNK = 200;         // = LIMITS.moves w sm:move
export const SHIP_CHUNK = 1000;        // numerów w jednym sm:shipMatch (serwer przyjmuje do 2000)

const plain = s => String(s == null ? '' : s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const cellOf = (r, i) => (i >= 0 && r && i < r.length ? String(r[i] == null ? '' : r[i]).replace(/\s+/g, ' ').trim() : '');
const SUMMARY = /^(suma|razem|lacznie|total|podsumowanie|sum)\b/;

// ─── Plik → wiersze ─────────────────────────────────────────────────────────

/** Bajty pliku (CSV / TXT / XLSX) → { kind, encoding, separator, rows: [[tekst]], total, truncated }. */
export async function readTable(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length > MAX_BYTES) throw new Error('Plik jest za duży (ponad ' + (MAX_BYTES >> 20) + ' MB) — podziel go na części.');
  let rows, kind, encoding = '', separator = '';
  if (isZip(u8)) { rows = (await readXlsx(u8, { maxRows: MAX_ROWS + 60 })).rows; kind = 'xlsx'; }
  else {
    const d = decodeBytes(u8);
    separator = detectSeparator(d.text); encoding = d.encoding; kind = 'csv';
    rows = parseCsv(d.text, separator, true);   // puste wiersze zostają — „wiersz N” jak w pliku
  }
  rows = rows.map(r => r.map(x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim()));
  return { kind, encoding, separator, rows, total: rows.length };
}

// ─── Pola i rozpoznawanie kolumn ────────────────────────────────────────────

/** Pola pliku dostawy. Kolejność = pierwszeństwo przy rozpoznawaniu nazw kolumn („szt. w kartonie” to nie „ilość”). */
export const DELIVERY_FIELDS = [
  { key: 'perBox', label: 'Sztuk w kartonie', tip: 'Ile sztuk (albo kg) jest w jednym kartonie / opakowaniu zbiorczym — potrzebne, gdy ilość jest podana w kartonach', re: /\b(w|na|per) (karton|opak|paczk|pudel|box)|pakowani|units per|szt (karton|opak)/ },
  { key: 'boxes', label: 'Liczba kartonów', tip: 'Ile kartonów / opakowań zbiorczych wysłano — razem z „sztuk w kartonie” daje ilość, gdy w pliku nie ma kolumny z sumą', re: /^(liczba |ilosc )?(kartonow|kartony|karton|opakowan|opakowania|paczek|pudel|boxes|cartons|ctn)\b/ },
  { key: 'sellyId', label: 'ID produktu w Selly', tip: 'Numer produktu w Selly (jak w Ustawieniach → Produkty SpeedMail) — najpewniejsze dopasowanie', re: /^(id|id selly|selly id|id produktu|id towaru|indeks|index|sku|symbol|kod|kod produktu|kod towaru)$/ },
  { key: 'location', label: 'Paleta / miejsce', tip: 'Numer palety albo miejsce w magazynie SpeedMail — trafia do opisu dosyłki', re: /palet|lokaliz|miejsce|regal|polozen|pallet|location/ },
  { key: 'unit', label: 'Jednostka', tip: 'Jednostka ilości w wierszu: szt., kg, opakowania (wiązki, paczki, rolki) albo kartony', re: /^(jednostka|jm|j m|jedn|unit|uom)\b/ },
  { key: 'qty', label: 'Ilość', tip: 'Ile wysłano (w jednostce z kolumny „Jednostka”, a gdy jej nie ma — w jednostce wybranej niżej)', req: true, re: /^(ilosc|liczba|sztuk|szt|qty|quantity|wyslano|ilosc wyslana)\b/ },
  { key: 'note', label: 'Uwagi', tip: 'Dowolny opis — trafia do opisu dosyłki', re: /uwag|komentarz|notat|^note|remarks/ },
  { key: 'product', label: 'Produkt', tip: 'Nazwa produktu (dopasowanie do listy produktów SpeedMail; nierozpoznane nazwy przypiszesz ręcznie)', req: true, re: /produkt|nazwa|towar|artykul|asortyment|product|item|opis/ },
];
/** Pola raportu wysyłek SpeedMail. Kolumn z danymi odbiorców nie przypisujemy — nie są nigdzie używane ani wysyłane. */
export const SHIP_FIELDS = [
  { key: 'tracking', label: 'Nr przesyłki', tip: 'Numer listu przewozowego / śledzenia przesyłki (np. FedEx) — można go wpisać w zamówieniu w Selly', re: /list przewoz|przesylk|tracking|track|waybill|awb|nr listu|numer listu|parcel|nr kuriera/ },
  { key: 'ref', label: 'Paczka zleceń', tip: 'Numer paczki zleceń z pliku dla SpeedMail (np. SM-20261124-007) — gdy SpeedMail go odsyła', re: /paczk|batch|zlecen|referenc|^ref\b|nr ref/ },
  { key: 'number', label: 'Nr zamówienia', tip: 'Numer zamówienia z Selly (kolumna „Nr zamówienia” z pliku dla SpeedMail)', req: true, re: /zamowien|order|^nr$|^numer$|^zam\b/ },
  { key: 'status', label: 'Status wysyłki', tip: 'Opcjonalnie: status z raportu SpeedMail. Wiersze ze statusem typu „brak towaru”, „anulowano”, „nie wysłano” liczą się jako NIEwysłane', re: /^status|^stan\b|wynik|zrealiz/ },
];
const FIELDS = { delivery: DELIVERY_FIELDS, ship: SHIP_FIELDS };
const fieldOf = (kind, header) => { const h = plain(header); return h ? FIELDS[kind].find(f => f.re.test(h)) || null : null; };

/** Wiersz nagłówków: pierwszy z pierwszych 15, w którym ≥ 2 nazwy pasują do pól (albo ≥ 2 niepuste teksty bez liczb); −1 = brak nagłówka. */
export function guessHeaderRow(rows, kind) {
  const top = rows.slice(0, 15);
  let i = top.findIndex(r => new Set(r.map(h => (fieldOf(kind, h) || {}).key).filter(Boolean)).size >= 2);
  if (i < 0) i = top.findIndex(r => r.filter(x => x && !/\d/.test(x)).length >= 2 && r.filter(Boolean).length >= 2);
  return i;
}

/** Tabela po wybraniu wiersza nagłówków (−1 = bez nagłówka). → { headers, body: [{ line, cells }], signature, truncated, total } */
export function tableOf(rows, headerRow) {
  const width = Math.max(0, ...rows.slice(Math.max(0, headerRow), Math.max(0, headerRow) + 200).map(r => r.length));
  const headers = headerRow >= 0 ? Array.from({ length: width }, (_, i) => cellOf(rows[headerRow], i) || 'kolumna ' + (i + 1)) : Array.from({ length: width }, (_, i) => 'kolumna ' + (i + 1));
  const body = [];
  for (let i = headerRow + 1; i < rows.length; i++) if (rows[i].some(Boolean)) body.push({ line: i + 1, cells: rows[i] });
  return { headers, body: body.slice(0, MAX_ROWS), total: body.length, truncated: body.length > MAX_ROWS, signature: headerRow >= 0 ? headerSignature(headers) : 'bez-' + width };
}

const share = (vals, test) => (vals.length ? vals.filter(test).length / vals.length : 0);
const isQty = v => isFinite(parseAmount(v)) && parseAmount(v) > 0 && !/^\d{9,}$/.test(v.replace(/\s/g, ''));
export const isTracking = v => /^[A-Z0-9][A-Z0-9-]{7,39}$/i.test(String(v).replace(/\s/g, '')) && String(v).replace(/\D/g, '').length >= 6;

/** Mapowanie: indeks kolumny → klucz pola ('' = pomiń). Najpierw nazwy kolumn, potem zawartość; każde pole najwyżej raz. */
export function autoMap(kind, tab) {
  const map = tab.headers.map(() => ''), used = new Set();
  tab.headers.forEach((h, i) => { const f = fieldOf(kind, h); if (f && !used.has(f.key)) { map[i] = f.key; used.add(f.key); } });
  const vals = i => tab.body.slice(0, 60).map(r => cellOf(r.cells, i)).filter(Boolean);
  const free = test => tab.headers.findIndex((h, i) => !map[i] && vals(i).length >= 1 && test(vals(i)));
  const put = (key, i) => { if (i >= 0 && !used.has(key)) { map[i] = key; used.add(key); } };
  if (kind === 'ship') {
    put('ref', free(v => share(v, x => /SM-?\d{8}-\d+/i.test(x)) >= 0.6));
    put('tracking', free(v => share(v, isTracking) >= 0.8));
  } else {
    put('product', free(v => share(v, x => /[a-ząćęłńóśźż]{3}/i.test(x)) >= 0.6));
    put('qty', free(v => share(v, isQty) >= 0.8));
  }
  return map;
}
export const missingFields = (kind, map) => FIELDS[kind].filter(f => f.req && !map.includes(f.key)).map(f => f.key)
  .filter(k => !(kind === 'delivery' && k === 'qty' && map.includes('boxes') && map.includes('perBox')))
  .filter(k => !(kind === 'ship' && k === 'number' && map.includes('ref')));
export const labelOf = (kind, key) => (FIELDS[kind].find(f => f.key === key) || { label: key }).label;

// ─── Pamięć przypisań (localStorage przekazany z zewnątrz; wszystko w try/catch) ──
const MAP_KEY = 'osa-sm-imp-mapy', ALIAS_KEY = 'osa-sm-imp-nazwy';
const readJson = (st, k) => { try { const o = JSON.parse(st.getItem(k) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
const writeJson = (st, k, o) => { try { st.setItem(k, JSON.stringify(o)); return true; } catch (e) { return false; } };
export const loadMap = (st, kind, sig) => readJson(st, MAP_KEY)[kind + ':' + sig] || null;
export function saveMap(st, kind, sig, rec) {
  const o = readJson(st, MAP_KEY); o[kind + ':' + sig] = rec;
  const keys = Object.keys(o); if (keys.length > 40) delete o[keys[0]];
  return writeJson(st, MAP_KEY, o);
}
/** Ręczne przypisania nazw z pliku do produktów SM: { nazwa (plain) → klucz produktu }. */
export const loadAliases = st => readJson(st, ALIAS_KEY);
export function saveAlias(st, text, key) {
  const o = readJson(st, ALIAS_KEY), k = plain(text);
  if (!k) return false;
  if (key) o[k] = key; else delete o[k];
  const keys = Object.keys(o); if (keys.length > 300) delete o[keys[0]];
  return writeJson(st, ALIAS_KEY, o);
}

// ─── Dopasowanie produktu i jednostki ───────────────────────────────────────

/**
 * Nazwa / ID z pliku → produkt SM. Kolejność: przypisanie ręczne, ID Selly, klucz, nazwa (albo nazwa kolumny w tabeli SM) dokładnie,
 * potem jednoznaczne zawieranie (nazwa produktu w tekście albo tekst w nazwie). → { key, how } | { error, candidates: [key] }
 */
export function matchProduct(text, idText, cfg, aliases = {}) {
  const t = plain(text), prods = cfg.products;
  if (t && aliases[t] && prods.some(p => p.key === aliases[t])) return { key: aliases[t], how: 'przypisanie ręczne' };
  const ids = [idText, text].map(x => String(x || '').trim()).filter(x => /^\d{1,12}$/.test(x));
  for (const id of ids) { const p = prods.find(x => x.ids.some(y => y.id === id)); if (p) return { key: p.key, how: 'ID Selly ' + id, per: (p.ids.find(y => y.id === id) || {}).per || 1 }; }
  if (!t) return { error: ids.length ? 'ID ' + ids[0] + ' nie należy do żadnego produktu SpeedMail' : 'brak nazwy produktu', candidates: [] };
  let p = prods.find(x => plain(x.key) === t || plain(x.name) === t || (x.col && plain(x.col) === t));
  if (p) return { key: p.key, how: 'nazwa' };
  const hits = prods.filter(x => { const n = plain(x.name), c = plain(x.col); return (n.length >= 4 && (t.includes(n) || n.includes(t))) || (c.length >= 4 && (t.includes(c) || c.includes(t))); });
  // najdłuższa pasująca nazwa wygrywa („Sztandar Trzech Króli – wielki” przed „Sztandar…”), o ile jest jedna taka
  if (hits.length) {
    const len = x => Math.max(t.includes(plain(x.name)) ? plain(x.name).length : 0, x.col && t.includes(plain(x.col)) ? plain(x.col).length : 0);
    const best = Math.max(...hits.map(len)), top = hits.filter(x => len(x) === best);
    if (top.length === 1 && (best > 0 || hits.length === 1)) return { key: top[0].key, how: 'podobna nazwa' };
    return { error: 'nazwa pasuje do kilku produktów', candidates: hits.slice(0, 6).map(x => x.key) };
  }
  return { error: 'nie ma takiego produktu na liście SpeedMail', candidates: [] };
}

/** Rodzaj jednostki z tekstu: 'pcs' (szt., kpl) | 'kg' | 'g' | 'pack' (opakowanie SM: wiązka, paczka, rolka…) | 'box' (karton) | '' (pusto) | null (nieznana). */
export function unitKind(text, p) {
  const u = plain(text);
  if (!u) return '';
  if (/^(szt|sztuk|sztuki|sztuka|pcs|pc|st|ea|kpl|komplet|komplety|kompletow|zestaw|zest)\b/.test(u)) return 'pcs';
  if (/^(kg|kilogram)/.test(u)) return 'kg';
  if (/^(g|gr|gram|gramy|gramow)$/.test(u)) return 'g';
  if (/^(karton|kart|box|boxes|pudel|pudlo|ctn|carton)/.test(u)) return 'box';
  if (/^(op|opak|opakowan|paczk|paczek|wiazk|wiazek|rolk|rolek|bel|pack|bundle)/.test(u) || (p && p.packName && u.startsWith(plain(p.packName).slice(0, 4)))) return 'pack';
  return null;
}

/** Ilość z pliku → ilość w jednostce produktu SM (sztuki; OrszaKrówki w kg). → { qty } | { error } */
export function toUnits(p, qty, kind, perBox) {
  const kg = p.unit === 'kg';
  switch (kind) {
    case 'pcs': return kg ? { error: 'produkt liczony w kg, a w pliku sztuki — podaj kg albo opakowania' } : { qty };
    case 'kg': return kg ? { qty } : { error: 'w pliku kilogramy, a produkt liczony w ' + p.unit };
    case 'g': return kg ? { qty: qty / 1000 } : { error: 'w pliku gramy, a produkt liczony w ' + p.unit };
    case 'pack': return { qty: qty * p.pack };
    case 'box': return perBox > 0 ? { qty: qty * perBox } : { error: 'ilość w kartonach — brak liczby sztuk w kartonie' };
    default: return { error: 'nieznana jednostka' };
  }
}
const r3 = n => Math.round(n * 1000) / 1000;

/**
 * Plik dostawy → wiersze podglądu (bez zapisu). opts: { qtyUnit: 'unit' | 'pack' — jednostka ilości bez kolumny „Jednostka”, aliases, label (opis dostawy) }.
 * Wiersz: { line, text, key, name, unit, qty (w jednostce produktu), packs, status: 'ok' | 'unmatched' | 'invalid' | 'skip', reasons: [], warns: [], note }
 */
export function buildDelivery(tab, map, cfg, opts = {}) {
  const col = k => map.indexOf(k), aliases = opts.aliases || {}, def = opts.qtyUnit === 'pack' ? 'pack' : 'unit';
  const byKey = new Map(cfg.products.map(p => [p.key, p]));
  return tab.body.map(({ line, cells }) => {
    const g = k => cellOf(cells, col(k));
    const text = g('product'), idText = g('sellyId');
    const row = { line, text: text || idText, key: '', name: '', unit: '', qty: 0, packs: 0, status: 'ok', reasons: [], warns: [], note: '', location: g('location') };
    if (SUMMARY.test(plain(text)) || (!text && !idText && SUMMARY.test(plain(cells.join(' '))))) { row.status = 'skip'; row.reasons.push('wiersz podsumowania'); return row; }
    if (!text && !idText && !g('qty') && !g('boxes')) { row.status = 'skip'; row.reasons.push('pusty wiersz'); return row; }
    const m = matchProduct(text, idText, cfg, aliases);
    if (m.error) { row.status = 'unmatched'; row.reasons.push(m.error); row.candidates = m.candidates; }
    else {
      const p = byKey.get(m.key);
      Object.assign(row, { key: p.key, name: p.name, unit: p.unit, how: m.how });
      if (m.per && m.per !== 1) row.warns.push('ID Selly ' + idText + ' to zestaw (×' + m.per + ' w sprzedaży) — ilość z pliku przyjęta bez przeliczenia');
    }
    const rawQty = g('qty'), rawBoxes = g('boxes'), perBox = parseAmount(g('perBox'));
    const qty = parseAmount(rawQty), boxes = parseAmount(rawBoxes);
    let kind = col('unit') >= 0 ? unitKind(g('unit'), row.key ? byKey.get(row.key) : null) : '';
    if (kind === null) { row.status = row.status === 'ok' ? 'invalid' : row.status; row.reasons.push('nieznana jednostka „' + g('unit').slice(0, 20) + '”'); return row; }
    let n = qty, src = 'qty';
    if (!rawQty && rawBoxes) { n = boxes; src = 'boxes'; kind = 'box'; }
    if (!(isFinite(n) && n > 0)) {
      if (row.status === 'ok') row.status = 'invalid';
      row.reasons.push(rawQty || rawBoxes ? 'ilość „' + (rawQty || rawBoxes).slice(0, 20) + '” nie jest liczbą większą od zera' : 'brak ilości');
      return row;
    }
    if (row.status !== 'ok') return row;
    const p = byKey.get(row.key);
    if (!kind) kind = def === 'pack' ? 'pack' : p.unit === 'kg' ? 'kg' : 'pcs';
    const u = toUnits(p, n, kind, perBox);
    if (u.error) { row.status = 'invalid'; row.reasons.push(u.error); return row; }
    const q = r3(u.qty);
    if (p.unit !== 'kg' && Math.abs(q - Math.round(q)) > 1e-9) { row.status = 'invalid'; row.reasons.push('wychodzi ułamek sztuki (' + q + ') — sprawdź jednostkę'); return row; }
    if (q > 1e7) { row.status = 'invalid'; row.reasons.push('ilość za duża'); return row; }
    if (src === 'qty' && isFinite(boxes) && boxes > 0 && perBox > 0 && kind !== 'box' && Math.abs(boxes * perBox - q) > 1e-6) row.warns.push('kartony × sztuki w kartonie = ' + r3(boxes * perBox) + ', a ilość = ' + q);
    row.qty = q; row.packs = p.pack > 0 ? r3(q / p.pack) : q;
    if (p.pack > 1 && Math.abs(row.packs - Math.round(row.packs)) > 1e-6) row.warns.push('niepełne opakowanie SpeedMail (' + row.packs + ' × ' + (p.packName || 'opak.') + ' po ' + p.pack + ')');
    row.note = noteOf(opts.label, row.location, g('note'), line);
    return row;
  });
}
/** Opis dosyłki (≤ 200 znaków): opis dostawy · paleta · uwagi · wiersz pliku. */
export const noteOf = (label, location, note, line) => ['Import dosyłki' + (label ? ': ' + String(label).trim() : ''), location ? 'paleta/miejsce ' + location : '', note, 'wiersz ' + line]
  .filter(Boolean).join(' · ').replace(/[\u0000-\u001f]/g, ' ').slice(0, 200);

/** Podsumowanie podglądu: liczby wierszy wg statusu i suma na produkt (tylko „ok”). */
export function deliverySummary(rows) {
  const n = { ok: 0, unmatched: 0, invalid: 0, skip: 0, warn: 0 }, per = new Map();
  for (const r of rows) {
    n[r.status]++;
    if (r.status !== 'ok') continue;
    if (r.warns.length) n.warn++;
    const x = per.get(r.key) || { key: r.key, name: r.name, unit: r.unit, qty: 0, rows: 0 };
    x.qty = r3(x.qty + r.qty); x.rows++; per.set(r.key, x);
  }
  return { ...n, products: [...per.values()] };
}

/** Wiersze „ok” → porcje dla sm:move (≤ 200 ruchów; jeden wiersz pliku = jeden ruch „dosyłka”, więc wynik jest per wiersz). */
export function moveChunks(rows, size = MOVE_CHUNK) {
  const ok = rows.filter(r => r.status === 'ok'), out = [];
  for (let i = 0; i < ok.length; i += size) {
    const part = ok.slice(i, i + size);
    out.push({ n: out.length, lines: part.map(r => r.line), moves: part.map(r => ({ key: r.key, kind: 'dosylka', qty: r.qty, note: r.note })) });
  }
  return out;
}
/** Klucz idempotencji porcji: ten sam przebieg importu + ta sama porcja → ponowienie nie dopisuje drugi raz. */
export const moveOpId = (runId, n) => 'sm-imp-' + runId + '-' + n;

/** Odcisk treści pliku (ostrzeżenie „ten plik już importowano”) — FNV-1a z rozpoznanych wierszy, nie z danych osobowych. */
export function contentPrint(rows) {
  const s = rows.filter(r => r.status === 'ok').map(r => r.key + ':' + r.qty + ':' + r.line).join('|');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return s ? 'p' + h.toString(36) + '-' + s.length : '';
}
const DONE_KEY = 'osa-sm-imp-zrobione';
export const importedAt = (st, print) => (print ? readJson(st, DONE_KEY)[print] || null : null);
export function rememberImport(st, print, rec) {
  if (!print) return false;
  const o = readJson(st, DONE_KEY); o[print] = rec;
  const keys = Object.keys(o); if (keys.length > 50) delete o[keys[0]];
  return writeJson(st, DONE_KEY, o);
}

// ─── Raport wysyłek SpeedMail ───────────────────────────────────────────────

const NOT_SHIPPED = /brak|nie ?wysl|niewysl|anul|wstrzym|zwrot|blad|odrzuc|oczekuj|nie ?zrealiz|cancel|fail|hold|missing|error/;
/** Numer zamówienia z komórki: bez spacji na brzegach, bez „#”/„nr” na początku. */
export const cleanNumber = v => String(v == null ? '' : v).trim().replace(/^(#|nr\.?\s*|zam\.?\s*)/i, '').trim().slice(0, 40);

/**
 * Raport → wiersze: { line, number, refNo, tracking, trackOk, shipped, statusText }. Zostają tylko przypisane kolumny — reszta pliku
 * (np. imiona, adresy) nie jest nigdzie zapisywana ani wysyłana.
 */
export function buildShipping(tab, map, parseRef) {
  const col = k => map.indexOf(k);
  const out = [];
  for (const { line, cells } of tab.body) {
    const g = k => cellOf(cells, col(k));
    const number = cleanNumber(g('number')), refNo = col('ref') >= 0 ? parseRef(g('ref')) : 0, tr = g('tracking').replace(/\s/g, '').toUpperCase();
    if (!number && !refNo) continue;
    if (SUMMARY.test(plain(number))) continue;
    const st = g('status');
    out.push({ line, number, refNo, tracking: tr, trackOk: !!tr && isTracking(tr), shipped: !st || !NOT_SHIPPED.test(plain(st)), statusText: st.slice(0, 40) });
  }
  return out;
}
/** Dane dla serwera: TYLKO numery zamówień i numery paczek (porcje po SHIP_CHUNK numerów). */
export function shipRequests(rows) {
  const numbers = [...new Set(rows.map(r => r.number).filter(Boolean))], refs = [...new Set(rows.map(r => r.refNo).filter(Boolean))].slice(0, 50);
  const out = [];
  for (let i = 0; i < numbers.length || (i === 0 && refs.length); i += SHIP_CHUNK) out.push({ numbers: numbers.slice(i, i + SHIP_CHUNK), refs: i === 0 ? refs : [] });
  return out;
}
/** Złączenie odpowiedzi kilku porcji sm:shipMatch. */
export function mergeMatch(parts) {
  const batches = new Map(), outside = new Map(), missing = new Set();
  let truncated = false;
  for (const r of parts) {
    for (const b of r.batches || []) if (!batches.has(b.no)) batches.set(b.no, b);
    for (const o of r.outside || []) outside.set(o.orderId, o);
    for (const n of r.missingRefs || []) missing.add(n);
    truncated = truncated || !!r.truncated;
  }
  for (const n of batches.keys()) missing.delete(n);
  return { batches: [...batches.values()].sort((a, b) => a.no - b.no), outside: [...outside.values()], missingRefs: [...missing], truncated };
}

/**
 * Porównanie raportu z paczkami: per paczka — wysłane / niewysłane (wg raportu) / anulowane; numery nieznane; zamówienia spoza paczek.
 * Zamówienie przekazane ponownie (n > 0) liczy się w paczce z czynnym zleceniem.
 * → { batches: [{ no, ref, day, orders: [{ …, shipped, tracking (z raportu), notShippedText, line }], shipped, notShipped, cancelled }],
 *     unknown: [numer], outside: [...], notShippedRows, multi: [numer z kilkoma przesyłkami], refMismatch: [numer] }
 */
export function analyseShipping(rows, match) {
  const rep = new Map();   // numer → { trackings: Set, shipped, statusText, line, refNo }
  for (const r of rows) {
    if (!r.number) continue;
    const x = rep.get(r.number) || { trackings: [], shipped: false, notShipped: false, statusText: '', line: r.line, refNo: r.refNo };
    if (r.trackOk && !x.trackings.includes(r.tracking)) x.trackings.push(r.tracking);
    if (r.shipped) x.shipped = true; else { x.notShipped = true; x.statusText = r.statusText; }
    rep.set(r.number, x);
  }
  const seen = new Set(), multi = [], refMismatch = [];
  const batches = match.batches.map(b => {
    const orders = b.orders.map(o => {
      const x = rep.get(o.orderNumber) || rep.get(o.orderId);
      const key = x ? (rep.has(o.orderNumber) ? o.orderNumber : o.orderId) : '';
      if (x) seen.add(key);
      const shipped = !!x && x.shipped && !o.cancelled;
      if (x && x.trackings.length > 1 && !multi.includes(key)) multi.push(key);
      if (x && x.refNo && x.refNo !== b.no && !o.cancelled && !refMismatch.includes(key)) refMismatch.push(key);
      return { ...o, inReport: !!x, shipped, reportedNotShipped: !!x && !x.shipped, statusText: x ? x.statusText : '', newTracking: x && x.trackings[0] ? x.trackings[0] : '', line: x ? x.line : 0 };
    });
    const act = orders.filter(o => !o.cancelled);
    return { no: b.no, ref: b.ref, day: b.day, orders, total: act.length, shipped: act.filter(o => o.shipped).length, notShipped: act.filter(o => !o.shipped).length,
      cancelled: orders.length - act.length, cancelledInReport: orders.filter(o => o.cancelled && o.inReport).length };
  });
  const outNums = new Set();
  for (const o of match.outside) { if (rep.has(o.orderNumber)) outNums.add(o.orderNumber); if (rep.has(o.orderId)) outNums.add(o.orderId); }
  const outside = match.outside.map(o => { const x = rep.get(o.orderNumber) || rep.get(o.orderId); return { ...o, newTracking: x && x.trackings[0] ? x.trackings[0] : '', shipped: !!x && x.shipped }; });
  const unknown = [...rep.keys()].filter(k => !seen.has(k) && !outNums.has(k));
  return { batches, outside, unknown, multi, refMismatch, missingRefs: match.missingRefs || [], truncated: !!match.truncated,
    notShippedRows: rows.filter(r => !r.shipped).length, badTracking: rows.filter(r => r.tracking && !r.trackOk).length };
}

/**
 * Plan wpisania numerów przesyłek (bez zapisu): dla wysłanych zamówień z paczek (opcjonalnie także spoza paczek).
 * action: 'set' (puste pole w Selly) | 'replace' (inny numer, tylko gdy overwrite) | 'same' (już jest) | 'differs' (inny numer — pominięte) | 'none' (brak numeru w raporcie)
 */
export function trackingPlan(an, { overwrite = false, outside = false } = {}) {
  const list = [];
  const add = (o, no) => {
    const cur = String(o.tracking || '').trim(), nw = o.newTracking;
    const action = !nw ? 'none' : cur.toUpperCase() === nw ? 'same' : !cur ? 'set' : overwrite ? 'replace' : 'differs';
    list.push({ orderId: o.orderId, orderNumber: o.orderNumber, no, current: cur, tracking: nw, action });
  };
  const seen = new Set();
  for (const b of an.batches) for (const o of b.orders) if (o.shipped && !seen.has(o.orderId)) { seen.add(o.orderId); add(o, b.no); }
  if (outside) for (const o of an.outside) if (o.shipped && !seen.has(o.orderId)) { seen.add(o.orderId); add(o, 0); }
  return list;
}
/** Zamówienia do zmiany statusu: wysłane wg raportu, z czynnym zleceniem, z innym statusem niż docelowy. */
export function statusPlan(an, target, { outside = false } = {}) {
  const ids = new Map();
  for (const b of an.batches) for (const o of b.orders) if (o.shipped && o.statusId !== String(target)) ids.set(o.orderId, o.orderNumber);
  if (outside) for (const o of an.outside) if (o.shipped && o.statusId !== String(target)) ids.set(o.orderId, o.orderNumber);
  return [...ids].map(([orderId, orderNumber]) => ({ orderId, orderNumber }));
}
export const trackOpId = (runId, orderId) => 'sm-trk-' + runId + '-' + orderId;
