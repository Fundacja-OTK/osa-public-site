// Skróty ekranu „lista → karta” (Zamówienia, Produkty, Klienci): F filtry, E eksport, C kolumny, / szukaj, ↑↓ / J K wiersz,
// Enter otwiera, X zaznacza, Esc wraca z karty. Moduł podaje tylko id istniejących kontrolek.
import { shortcuts, addKeyTip } from './shortcuts.js?v=5a962d8';

const byId = id => (id ? document.getElementById(id) : null);
const shown = n => !!n && !n.disabled && n.offsetParent !== null;
const HL = 'kb-hl';

/** Podświetlenie wiersza klawiaturą: delta ±1 (od bieżącego, po przeładowaniu tabeli zaczyna od początku). */
export function moveRow(tableId, delta) {
  const rows = [...document.querySelectorAll('#' + tableId + ' tbody tr[data-id]')];
  if (!rows.length) return false;
  const cur = rows.findIndex(r => r.classList.contains(HL));
  rows.forEach(r => r.classList.remove(HL));
  const i = Math.min(rows.length - 1, Math.max(0, cur < 0 ? (delta > 0 ? 0 : rows.length - 1) : cur + delta));
  rows[i].classList.add(HL);
  rows[i].scrollIntoView({ block: 'nearest' });
  return true;
}
const hlRow = tableId => document.querySelector('#' + tableId + ' tbody tr.' + HL);

/**
 * ids: { screen, table, filters, export, cols, search, back, select? (true = X zaznacza pole wyboru) }.
 * Dopisuje też klawisze do podpowiedzi przycisków.
 */
export function registerListKeys(ids) {
  const click = (id, expand) => () => { const n = byId(id); if (!shown(n)) return false; n.click(); return true; };
  const entries = [];
  const add = (keys, label, desc, run) => entries.push({ keys, label, desc, run });
  if (ids.filters) { add(['f'], 'F', 'Pokaż lub ukryj panel filtrów', click(ids.filters)); addKeyTip(byId(ids.filters), 'F'); }
  if (ids.export) { add(['e'], 'E', 'Otwórz menu eksportu', click(ids.export)); addKeyTip(byId(ids.export), 'E'); }
  if (ids.cols) { add(['c'], 'C', 'Otwórz menu kolumn', click(ids.cols)); addKeyTip(byId(ids.cols), 'C'); }
  if (ids.search) {
    add(['/'], '/', 'Przejdź do pola wyszukiwania', () => { const n = byId(ids.search); if (!shown(n)) return false; n.focus(); n.select && n.select(); return true; });
    addKeyTip(byId(ids.search), '/');
  }
  add(['arrowdown', 'j'], '↓ / J', 'Następny wiersz listy', () => moveRow(ids.table, 1));
  add(['arrowup', 'k'], '↑ / K', 'Poprzedni wiersz listy', () => moveRow(ids.table, -1));
  add(['enter'], 'Enter', 'Otwórz podświetlony wiersz', e => {
    const r = hlRow(ids.table); if (!r || (e && e.target && /^(BUTTON|A|SUMMARY)$/.test(e.target.tagName))) return false;
    const a = r.querySelector('a[href^="#/"]'); (a || r).click(); return true;
  });
  if (ids.select) add(['x'], 'X', 'Zaznacz lub odznacz podświetlony wiersz', () => {
    const r = hlRow(ids.table), c = r && r.querySelector('input[type=checkbox]'); if (!c) return false; c.click(); return true;
  });
  if (ids.back) add(['escape'], 'Esc', 'Wróć z karty do listy', () => {
    if (document.querySelector('.menu-pop:not([hidden]), .ms-pop:not([hidden])')) return false;
    const n = byId(ids.back); if (!shown(n)) return false; n.click(); return true;
  });
  // ids.extra: [{ keys, label, desc, id }] — dodatkowe przyciski modułu (np. „Dodaj klienta”)
  for (const x of ids.extra || []) { add(x.keys, x.label, x.desc, click(x.id)); addKeyTip(byId(x.id), x.label); }
  shortcuts.scope(ids.screen, entries);
}
