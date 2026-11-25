// Edytor uprawnień grup Selly — czysta logika (bez DOM; testy: tests/unit/uprawnienia.test.js). Ekran: modules/uprawnienia.js.
// Model: { groupId, modules:[{ module, title, empty, canSave, reason, rows:[{ name, key, desc, orig, value, hint:{ value, reason, ambiguous } }] }] }
// orig = stan w Selly z chwili wczytania (do diffu i do kontroli konfliktu przy zapisie); value = stan w edytorze.

export const VALUES = ['Tak', 'Nie'];
export const FILTERS = {
  all: { label: 'Wszystkie', tip: 'Wszystkie trasy grupy' },
  tak: { label: 'Tak', tip: 'Tylko trasy, do których grupa ma (albo będzie mieć) dostęp' },
  nie: { label: 'Nie', tip: 'Tylko trasy bez dostępu' },
  changed: { label: 'Zmienione', tip: 'Tylko trasy zmienione w edytorze, jeszcze niezapisane w Selly' },
  amb: { label: 'Niejednoznaczne', tip: 'Trasy, których nazwa i opis nie mówią jasno, czy tylko pokazują dane, czy je zmieniają — warto sprawdzić ręcznie' },
};
/** Podpowiedź klasyfikatora (extension/lib/actionSafety.js) → etykieta, klasa i tooltip. */
export function hintBadge(h) {
  if (!h) return { label: '', cls: '', tip: '' };
  if (h.ambiguous) return { label: 'niejednoznaczne', cls: 'warn', tip: 'Nie wiadomo na pewno, czy ta trasa tylko pokazuje dane (' + h.reason + '). Szablon „Tylko podgląd” ustawia ją na „Nie”.' };
  if (h.value === 'Tak') return { label: 'podgląd', cls: 'ok', tip: 'Wygląda na stronę tylko do podglądu (' + h.reason + '). Szablon „Tylko podgląd” ustawia „Tak”.' };
  return { label: 'zmienia dane', cls: 'bad', tip: 'Ta trasa zmienia dane albo jest wyłączana w całości (' + h.reason + '). Szablon „Tylko podgląd” ustawia „Nie”.' };
}

export const normText = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Model z listy modułów grupy (perms:read bez modules) i stron modułów (perms:read z modules). */
export function buildModel(groupId, modules, pages) {
  const byMod = new Map((pages || []).map(p => [p.module, p]));
  return {
    groupId: String(groupId),
    modules: (modules || []).filter(m => byMod.has(m.module)).map(m => {
      const p = byMod.get(m.module);
      return { module: m.module, title: m.title || m.module, empty: !!p.empty, canSave: !!p.canSave, reason: p.reason || '',
        rows: (p.rows || []).map(r => ({ name: r.name, key: r.key, desc: r.desc || '', orig: r.value || '', value: r.value || '', hint: r.hint || null })) };
    }),
  };
}

export const isChanged = r => r.value !== r.orig;
/** Czy wiersz pasuje do wyszukiwania (klucz trasy, opis Selly, nazwa modułu) i filtra. */
export function rowMatches(r, mod, q, filter) {
  if (filter === 'tak' && r.value !== 'Tak') return false;
  if (filter === 'nie' && r.value !== 'Nie') return false;
  if (filter === 'changed' && !isChanged(r)) return false;
  if (filter === 'amb' && !(r.hint && r.hint.ambiguous)) return false;
  const words = normText(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = normText(r.key + ' ' + r.desc + ' ' + (mod ? mod.title + ' ' + mod.module : ''));
  return words.every(w => hay.includes(w));
}
export function moduleCounts(mod) {
  const c = { total: mod.rows.length, tak: 0, nie: 0, changed: 0, amb: 0 };
  for (const r of mod.rows) { if (r.value === 'Tak') c.tak++; else if (r.value === 'Nie') c.nie++; if (isChanged(r)) c.changed++; if (r.hint && r.hint.ambiguous) c.amb++; }
  return c;
}
export function totals(model) {
  const t = { total: 0, tak: 0, nie: 0, changed: 0, amb: 0 };
  for (const m of model.modules) { const c = moduleCounts(m); for (const k of Object.keys(t)) t[k] += c[k]; }
  return t;
}

const settable = m => m.canSave && !m.empty;
/** Ustawia wartość wierszy (tylko moduły z zapisem). → liczba zmienionych pozycji. */
function setRows(rows, fn) {
  let n = 0;
  for (const r of rows) { const v = fn(r); if (VALUES.includes(v) && v !== r.value) { r.value = v; n++; } }
  return n;
}
/** Szablon „Tylko podgląd”: każda trasa wg klasyfikatora (podgląd = Tak, zmienia dane / niejednoznaczne = Nie). */
export const presetViewOnly = model => model.modules.filter(settable).reduce((n, m) => n + setRows(m.rows, r => r.hint && r.hint.value), 0);
/** Cały moduł Tak (pełny dostęp do modułu) albo Nie. */
export function presetModule(model, module, value) {
  const m = model.modules.find(x => x.module === module);
  return m && settable(m) ? setRows(m.rows, () => value) : 0;
}
/** „Jak inna grupa”: wartości z modelu innej grupy (te same moduł + trasa); trasy, których tam nie ma, bez zmian. → { changed, missing } */
export function presetCopy(model, other) {
  const src = new Map();
  for (const m of other.modules) for (const r of m.rows) if (r.orig) src.set(m.module + '\u0000' + r.name, r.orig);
  let changed = 0, missing = 0;
  for (const m of model.modules.filter(settable)) {
    changed += setRows(m.rows, r => { const v = src.get(m.module + '\u0000' + r.name); if (!v) missing++; return v; });
  }
  return { changed, missing };
}
/** Cofnięcie zmian w edytorze (wszystkich albo jednego modułu). */
export function resetChanges(model, module) {
  let n = 0;
  for (const m of model.modules) if (!module || m.module === module) for (const r of m.rows) if (isChanged(r)) { r.value = r.orig; n++; }
  return n;
}

/** Różnice do zapisu, per moduł: [{ module, title, diff:[{ name, key, before, after }], toYes, toNo }]. */
export function changesByModule(model) {
  return model.modules.map(m => {
    const diff = m.rows.filter(isChanged).map(r => ({ name: r.name, key: r.key, before: r.orig || '—', after: r.value }));
    return { module: m.module, title: m.title, diff, toYes: diff.filter(d => d.after === 'Tak').length, toNo: diff.filter(d => d.after === 'Nie').length };
  }).filter(x => x.diff.length);
}
/** Parametry perms:save dla modułu: zmiany (tylko zmienione) + stan WSZYSTKICH tras z chwili wczytania (kontrola konfliktu). */
export function saveParams(model, module) {
  const m = model.modules.find(x => x.module === module);
  return { groupId: model.groupId, module, changes: Object.fromEntries(m.rows.filter(isChanged).map(r => [r.name, r.value])),
    expect: Object.fromEntries(m.rows.map(r => [r.name, r.orig])) };
}
/** Po zweryfikowanym zapisie modułu: stan w Selly = stan edytora. */
export function markSaved(model, module) {
  const m = model.modules.find(x => x.module === module);
  if (m) for (const r of m.rows) r.orig = r.value;
}
/** Kolejka porcji odczytu (≤ size modułów na wywołanie). */
export function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
