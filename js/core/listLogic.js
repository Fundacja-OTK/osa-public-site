// Czysta logika wspólnej listy (core/listView.js): stan ↔ adres, sortowanie, stronicowanie, zaznaczenie.
// Bez DOM i bez importów — testy: tests/unit/listView.test.js. Opis API: docs/list-view.md.

export const isEmptyVal = v => v == null || (typeof v === 'string' && v.trim() === '');
const str = v => (v == null ? '' : String(v));
export const normText = s => str(s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Klucz sortowania kolumny: `sort: true` = klucz kolumny, napis = własny klucz, brak = kolumna bez sortowania. */
export const sortKeyOf = c => (c.sort === true ? c.key : typeof c.sort === 'string' ? c.sort : '');
/** Pierwszy kierunek po kliknięciu nowej kolumny (CLAUDE.md): liczby malejąco, tekst rosnąco; `firstDir` nadpisuje (np. daty). */
export const firstDir = c => c.firstDir || (c.num ? 'desc' : 'asc');
/** Klik w nagłówek: ta sama kolumna → odwrócenie kolejności, inna → jej pierwszy kierunek. */
export function nextSort(col, cur) {
  const key = sortKeyOf(col) || col.key;
  if (cur && cur.sort === key) return { sort: key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { sort: key, dir: firstDir(col) };
}

const toNum = v => (typeof v === 'number' ? v : Number(str(v).replace(/\s/g, '').replace(',', '.')));
let coll = null;
const collator = () => coll || (coll = new Intl.Collator('pl', { sensitivity: 'base', numeric: true }));

/**
 * Sortowanie (zwraca kopię, stabilne): puste wartości ZAWSZE na końcu (w obu kierunkach), liczby liczbowo,
 * tekst po polsku bez rozróżniania wielkości liter. o: { value: klucz | r => wartość, num, dir }.
 */
export function sortRows(rows, o) {
  const get = typeof o.value === 'function' ? o.value : r => r[o.value];
  const m = o.dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => ({ r, i, v: get(r) })).sort((x, y) => {
    const ex = isEmptyVal(x.v), ey = isEmptyVal(y.v);
    if (ex || ey) return ex && ey ? x.i - y.i : ex ? 1 : -1;
    let c = o.num ? toNum(x.v) - toNum(y.v) : NaN;
    if (Number.isNaN(c)) c = collator().compare(str(x.v), str(y.v));
    return c * m || x.i - y.i;
  }).map(x => x.r);
}

export const pageCount = (total, size) => Math.max(1, Math.ceil((Number(total) || 0) / (Number(size) || 1)));
export const clampPage = (page, total, size) => Math.min(Math.max(1, parseInt(page, 10) || 1), pageCount(total, size));
export const pageSlice = (rows, page, size) => rows.slice((page - 1) * size, page * size);

// ─── Stan ↔ adres ──────────────────────────────────────────────────────────────
// spec: { sorts: [{ key, num?, firstDir? }], defaultSort: { key, dir } | null, filters: [{ key, param? }], filterPrefix: '',
//         sizes: [25, 50, …], defaultSize, extra?: { read(get) → obj, write(state, URLSearchParams), clear: obj, active(state) → liczba } }
// Stan: { q, page, size, sort, dir, filters: { klucz: napis }, …pola z extra.read }

const paramOf = (spec, f) => f.param || (spec.filterPrefix || '') + f.key;
export const defaultSizeOf = spec => spec.defaultSize || (spec.sizes && spec.sizes[0]) || 50;

/** Stan z adresu. get(k) → napis z zapytania; storedSize — zapamiętany wybór „Na stronie” (gdy adres go nie podaje). */
export function readState(get, spec, storedSize) {
  const g = k => str(get(k));
  const sorts = spec.sorts || [], ds = spec.defaultSort || null;
  const col = sorts.find(c => c.key === g('sort'));
  const sort = col ? col.key : ds ? ds.key : '';
  const dq = g('dir');
  const scol = sorts.find(c => c.key === sort);
  const dir = dq === 'asc' || dq === 'desc' ? dq : ds && sort === ds.key ? ds.dir : scol ? firstDir(scol) : 'asc';
  const filters = {};
  for (const f of spec.filters || []) { const v = g(paramOf(spec, f)); if (v !== '') filters[f.key] = v; }
  const sizes = spec.sizes || [], qs = parseInt(g('size'), 10);
  const size = sizes.includes(qs) ? qs : sizes.includes(storedSize) ? storedSize : defaultSizeOf(spec);
  return { q: g('q'), page: Math.max(1, parseInt(g('page'), 10) || 1), size, sort, dir, filters, ...(spec.extra ? spec.extra.read(g) : {}) };
}

/** Stan → „?q=…&f_x=…&page=2&size=100&sort=…&dir=…” (tylko wartości różne od domyślnych; '' gdy nic). */
export function writeState(st, spec) {
  const p = new URLSearchParams();
  if (st.q) p.set('q', st.q);
  if (spec.extra) spec.extra.write(st, p);
  for (const f of spec.filters || []) { const v = st.filters && st.filters[f.key]; if (!isEmptyVal(v)) p.set(paramOf(spec, f), str(v)); }
  if (st.page > 1) p.set('page', String(st.page));
  if (st.size && st.size !== defaultSizeOf(spec)) p.set('size', String(st.size));
  const ds = spec.defaultSort;
  if (st.sort && (!ds || st.sort !== ds.key || st.dir !== ds.dir)) { p.set('sort', st.sort); p.set('dir', st.dir); }
  const s = p.toString();
  return s ? '?' + s : '';
}

/** Zmiana stanu: każda zmiana poza samą stroną wraca na stronę 1; `filters` w patch zastępuje cały obiekt filtrów. */
export function patchState(st, patch) {
  const n = { ...st, ...patch, filters: patch.filters ? { ...patch.filters } : { ...(st.filters || {}) } };
  if (!('page' in patch)) n.page = 1;
  return n;
}
/** Stan „bez wyszukiwania i filtrów” (sortowanie i rozmiar strony zostają). */
export const clearedState = (st, spec) => patchState(st, { q: '', filters: {}, ...((spec.extra && spec.extra.clear) || {}) });
/** Liczba aktywnych filtrów z panelu (bez wyszukiwania). */
export const activeFilters = st => Object.values(st.filters || {}).filter(v => !isEmptyVal(v)).length;
/** Czy lista jest zawężona (wyszukiwanie, filtry albo filtry modułu z extra.active). */
export const isFiltered = (st, spec) => !!st.q || activeFilters(st) > 0 || !!(spec.extra && spec.extra.active && spec.extra.active(st));

// ─── Zaznaczenie (Map / Set id → wiersz; przetrwa zmianę strony) ─────────────────

/** Usuwa z zaznaczenia id spoza `ids` (np. po zawężeniu listy wczytanej w całości). Zwraca liczbę usuniętych. */
export function pruneSelection(sel, ids) {
  const keep = new Set([...ids].map(String));
  let n = 0;
  for (const k of [...sel.keys()]) if (!keep.has(String(k))) { sel.delete(k); n++; }
  return n;
}
/** Podsumowanie dla paska i pola „zaznacz stronę”: n, ile na tej stronie, ile z innych stron, all / some (stan pola). */
export function selectionInfo(sel, pageIds) {
  const ids = [...pageIds].map(String);
  const onPage = ids.filter(id => sel.has(id)).length;
  return { n: sel.size, onPage, off: sel.size - onPage, all: ids.length > 0 && onPage === ids.length, some: onPage > 0 && onPage < ids.length };
}

/** Wyszukiwanie po stronie przeglądarki (lista wczytana w całości): każde słowo musi wystąpić w którymś z pól. */
export function matchQuery(row, q, fields) {
  const words = normText(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = normText((typeof fields === 'function' ? fields(row) : fields.map(f => row[f])).join(' '));
  return words.every(w => hay.includes(w));
}
