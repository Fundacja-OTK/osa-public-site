// Wspólne drobiazgi ekranu „Raporty sprzedaży” (raporty.js = powłoka i widok „Okres”, raportyLata.js = widok „Lata”): formaty liczb i dat,
// różnica między okresem bieżącym a porównawczym, wykresy SVG w kolorach motywu.
import { el, money } from '../core/ui.js?v=64a1b3e';

const SVG = 'http://www.w3.org/2000/svg';
export const svg = (tag, attrs, ...kids) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c);
  return n;
};
export const zl = v => money(v) + ' zł';
export const zl0 = v => Math.round(Number(v) || 0).toLocaleString('pl-PL') + ' zł';
export const int = v => Math.round(Number(v) || 0).toLocaleString('pl-PL');
export const qty = v => (Number(v) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 });
export const pct1 = v => String(Math.round(v * 10) / 10).replace('.', ',');
export const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export const MONTHS_LONG = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

// ─── Daty (yyyy-MM-dd, południe UTC — bez przesunięć strefy) ────────────────
export { isoOf, addDays, daysBetween, addYears, validIso } from './raportyDaty.js?v=64a1b3e';
import { isoOf, addDays, daysBetween, addYears, validIso } from './raportyDaty.js?v=64a1b3e';
const pad = n => String(n).padStart(2, '0');
const parse = s => new Date(s + 'T12:00:00Z');
export const ddmm = d => d.slice(8, 10) + '.' + d.slice(5, 7);
export const dmy = d => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);
const dm = d => Number(d.slice(8, 10)) + '.' + Number(d.slice(5, 7));
/** Zakres po ludzku: „1.10–31.10.2026”, „5.11.2026”, „1.12.2025–31.01.2026”. */
export function rangeText(a, b) {
  if (!a || !b) return '—';
  if (a === b) return dm(a) + '.' + a.slice(0, 4);
  return a.slice(0, 4) === b.slice(0, 4) ? dm(a) + '–' + dm(b) + '.' + a.slice(0, 4) : dm(a) + '.' + a.slice(0, 4) + '–' + dm(b) + '.' + b.slice(0, 4);
}
export const daysText = n => n + ' ' + (n === 1 ? 'dzień' : 'dni');

// ─── Różnica bieżący ↔ porównanie ───────────────────────────────────────────
/**
 * Pokazuje zmianę: strzałka, znak, kwota i procent. Styl neutralny, gdy porównanie jest wyłączone, brak danych albo baza = 0.
 * o: { fmt (formatuje kwotę/liczbę), cmp (czy porównanie włączone), curLabel, prevLabel, neutral (kolor bez oceny wzrost = dobrze) }
 */
export function deltaEl(cur, prev, o) {
  const fmt = o.fmt || int, who = (o.curLabel ? 'bieżący (' + o.curLabel + ')' : 'bieżący') + ' ' + fmt(cur) + ' · ' + (o.prevLabel ? 'porównanie (' + o.prevLabel + ')' : 'porównanie') + ' ' + (prev == null ? '—' : fmt(prev));
  if (o.cmp === false) return el('span', { class: 'rp-delta off tip', title: 'Porównanie jest wyłączone (ustawienie „Porównanie”). Wartości widać tylko dla okresu bieżącego.' }, 'bez porównania');
  if (prev == null) return el('span', { class: 'rp-delta off tip', title: 'Ta liczba jest liczona tylko dla okresu bieżącego — nie ma jej dla okresu porównawczego.' }, 'porównanie niedostępne');
  const diff = Math.round((cur - prev) * 100) / 100, sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  if (!prev) {
    return el('span', { class: 'rp-delta flat tip', title: 'W okresie porównawczym było 0, więc zmiany procentowej nie da się policzyć. ' + who }, '● ' + sign + fmt(Math.abs(diff)) + ' · brak % (porównanie = 0)');
  }
  const p = Math.round((cur - prev) / prev * 1000) / 10, cls = !diff ? 'flat' : o.neutral ? 'flat' : diff > 0 ? 'up' : 'down';
  return el('span', { class: 'rp-delta tip ' + cls, title: 'Zmiana bieżącego względem porównania: ' + who + '.' },
    (diff > 0 ? '▲ ' : diff < 0 ? '▼ ' : '● ') + (diff ? sign + fmt(Math.abs(diff)) + ' (' + (p > 0 ? '+' : p < 0 ? '−' : '') + pct1(Math.abs(p)) + '%)' : 'bez zmian'));
}
/** Sama zmiana procentowa (do tabel): „+12,5%” / „−3,0%” / „—”. */
export const pctText = (cur, prev) => (prev ? (cur - prev) / prev * 100 : null);
export const pctFmt = v => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + pct1(Math.abs(v)) + '%');

export function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Kolor roku / okresu z palety motywu (zmienne CSS, więc działa w jasnym i ciemnym). */
export const periodColor = i => 'var(--tone-' + (i % 6 + 1) + ')';
/** Mała linia trendu (kolor = currentColor). */
export function sparkline(values) {
  const v = values.map(x => x || 0);
  if (v.length < 2) return null;
  const W = 84, H = 22, max = Math.max(...v), min = Math.min(0, ...v);
  const pts = v.map((val, i) => [((W - 4) * i) / (v.length - 1) + 2, H - 3 - ((H - 6) * (val - min)) / (max - min || 1)]);
  return svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'rp-spark', 'aria-hidden': 'true' },
    svg('polyline', { points: pts.map(p => p.join(',')).join(' ') }), svg('circle', { cx: pts[pts.length - 1][0], cy: pts[pts.length - 1][1], r: 2.5 }));
}

/** Wiersz-kafelek: etykieta (tooltip), duża liczba, linia „porównanie” i zmiana. */
export function tile(k, label, tip, main, extra) {
  return el('div', { class: 'rp-tile', 'data-k': k }, el('div', { class: 'rp-tile-label tip', title: tip }, label), el('div', { class: 'rp-big' }, main), ...(extra || []).filter(Boolean));
}
