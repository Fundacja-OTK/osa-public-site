// Czysta (bez DOM) logika widoku „Zestaw”: zapis zestawu w adresie i etykiety osi czasu — wydzielone do testów jednostkowych.
import { isoWeekOf, weekLabel } from './raportyDaty.js?v=ecaba1a';

export const MAX_SET = 12;
const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/** „p11,p12,c5” → [{ k, id, key }] (bez powtórzeń, maks. MAX_SET). p = produkt, c = kategoria, r = producent. */
export function parseSet(s) {
  const seen = new Set(), out = [];
  for (const t of String(s || '').split(',')) {
    const m = /^([pcr])([\w.-]{1,40})$/.exec(t.trim());
    if (m && !seen.has(t.trim())) { seen.add(t.trim()); out.push({ k: m[1], id: m[2], key: t.trim() }); }
  }
  return out.slice(0, MAX_SET);
}
export const setKeys = items => items.map(x => x.key).join(',');

/** Etykiety osi z kluczy przedziałów (dzień yyyy-MM-dd / poniedziałek tygodnia / miesiąc yyyy-MM). */
export function axisLabels(group, axis) {
  if (group === 'month') return { short: k => MONTHS[Number(axis[k].slice(5, 7)) - 1], full: k => MONTHS[Number(axis[k].slice(5, 7)) - 1] + ' ' + axis[k].slice(0, 4) };
  if (group === 'week') return { short: k => 't' + isoWeekOf(axis[k]).w, full: k => { const w = isoWeekOf(axis[k]); return weekLabel(w.y, w.w); } };
  return { short: k => axis[k].slice(8, 10) + '.' + axis[k].slice(5, 7), full: k => axis[k].slice(8, 10) + '.' + axis[k].slice(5, 7) + '.' + axis[k].slice(0, 4) };
}
