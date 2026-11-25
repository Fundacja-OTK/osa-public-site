// Słupek kosztu zakupu wewnątrz słupka sprzedaży (tryb „wartość”): raport „Okres”, rodziny rok do roku i wykres 30 dni na pulpicie.
// Węższy słupek na tej samej podstawie = koszt zakupu brutto sprzedanego towaru; widoczna reszta słupka ≈ marża (i dostawa).
// Brak ceny zakupu części towaru → słupek kreskowany (koszt zaniżony), brak ceny dla całości → kreskowany obrys całego słupka („nieznany”).
// Włącznik „Pokaż koszt zakupu” w legendzie, zapamiętany w przeglądarce (domyślnie włączony). Logika liczb: chartCostLogic.js.
import { el, money, store } from '../core/ui.js?v=889153d';
import { costInfo } from './chartCostLogic.js?v=889153d';

export { costInfo, costValue } from './chartCostLogic.js?v=889153d';

const KEY = 'osa-chart-cost';
const zl = v => money(v) + ' zł';
const pct = v => (Math.round(v * 10) / 10).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + '%';
const qtyTxt = v => (Number(v) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + ' szt.';
let seq = 0;

export const costShown = () => store(KEY) !== false;
export const COST_SOURCE = 'Koszt zakupu = sprzedane sztuki × BIEŻĄCA cena zakupu z karty produktu (nie cena z dnia sprzedaży). Cena zakupu jest netto, '
  + 'więc doliczamy stawkę VAT produktu (brak stawki → 23%) — koszt jest brutto, porównywalny z wartością na wykresie.';

/** Wzór kreskowania (koszt niepełny / nieznany) — osobne id na wykres, bo na stronie może być kilka wykresów. */
export function costDefs(svg) {
  const id = 'ccHatch' + (++seq);
  const defs = svg('defs', null, svg('pattern', { id, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
    svg('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'cc-hatch-line' })));
  return { defs, fill: 'url(#' + id + ')' };
}

/**
 * Słupek kosztu dla słupka wartości: x, w = pozycja i szerokość słupka wartości, base = y podstawy, k = piksele na złotówkę,
 * barH = wysokość słupka wartości, top = najwyższe dozwolone y (koszt większy od skali jest przycinany).
 */
export function costBar(svg, { x, w, base, k, barH, top, cost, hatch }) {
  const i = costInfo(cost);
  if (i.state === 'none') return null;
  const cw = Math.max(w * 0.5, 1), cx = x + (w - cw) / 2;
  if (i.state === 'unknown') return barH > 0 ? svg('rect', { x: cx, y: base - barH, width: cw, height: barH, class: 'cc-bar unk', fill: hatch }) : null;
  const h = Math.min(Math.max(i.gross * k, i.gross > 0 ? 1.5 : 0), base - top);
  if (!(h > 0)) return null;
  return svg('rect', { x: cx, y: base - h, width: cw, height: h, class: 'cc-bar' + (i.state === 'partial' ? ' part' : ''), fill: i.state === 'partial' ? hatch : null });
}

/** Linie podpowiedzi słupka: koszt, marża, ostrzeżenie o niepełnym koszcie. value = wartość słupka (z dostawą, gdy withShipping). */
export function costTip(cost, { value, withShipping } = {}) {
  const i = costInfo(cost);
  if (i.state === 'none') return [];
  const out = [];
  if (withShipping && value != null && value - i.goods > 0.5) out.push(el('div', { class: 'cc-tip-sub' }, 'w tym towar: ' + zl(i.goods) + ' (reszta to dostawa)'));
  if (i.state === 'unknown') {
    out.push(el('div', { class: 'cc-tip-line' }, el('i', { class: 'cc-sw part', 'aria-hidden': 'true' }), 'koszt zakupu: nieznany'),
      el('div', { class: 'cc-tip-warn' }, 'Żaden sprzedany produkt nie ma ceny zakupu w karcie (' + qtyTxt(i.missQty) + ') — nie liczymy kosztu ani marży.'));
    return out;
  }
  out.push(el('div', { class: 'cc-tip-line' }, el('i', { class: 'cc-sw' + (i.state === 'partial' ? ' part' : ''), 'aria-hidden': 'true' }), 'koszt zakupu: ' + zl(i.gross) + ' brutto (netto ' + zl(i.net) + ')'),
    el('div', { class: 'cc-tip-margin' }, 'marża na towarze: ' + zl(i.margin) + ' (' + pct(i.marginPct) + ')'));
  if (i.state === 'partial') out.push(el('div', { class: 'cc-tip-warn' }, 'Koszt niepełny: ' + qtyTxt(i.missQty) + ' bez ceny zakupu (' + pct(i.missShare * 100) + ' wartości towaru, ' + zl(i.missValue)
    + ') — koszt jest zaniżony, marża liczona tylko z pozycji z ceną zakupu.'));
  return out;
}

/** To samo co costTip, jako zwykły tekst (do <title> słupka SVG). */
export function costTipText(cost) {
  const i = costInfo(cost);
  if (i.state === 'none') return '';
  if (i.state === 'unknown') return '\nKoszt zakupu: nieznany — żaden sprzedany produkt nie ma ceny zakupu w karcie (' + qtyTxt(i.missQty) + ').';
  return '\nKoszt zakupu: ' + zl(i.gross) + ' brutto (netto ' + zl(i.net) + ')\nMarża na towarze: ' + zl(i.margin) + ' (' + pct(i.marginPct) + ')'
    + (i.state === 'partial' ? '\nKoszt niepełny: ' + qtyTxt(i.missQty) + ' bez ceny zakupu (' + pct(i.missShare * 100) + ' wartości towaru, ' + zl(i.missValue) + ') — koszt zaniżony, marża tylko z pozycji z ceną zakupu.' : '');
}

/**
 * Pozycje legendy: włącznik „Pokaż koszt zakupu” ze wzorem słupka i (gdy jakiś przedział ma braki) wzór „koszt niepełny”.
 * costs = koszty przedziałów wykresu (do sprawdzenia, czy są braki); onToggle(shown) przerysowuje wykres.
 */
export function costLegend(costs, onToggle, id) {
  const infos = (costs || []).map(costInfo), any = infos.some(x => x.state !== 'none');
  if (!any) return null;
  const shown = costShown(), gaps = infos.filter(x => x.state === 'partial' || x.state === 'unknown').length;
  const box = el('input', { type: 'checkbox', checked: shown, onchange: ev => { store(KEY, ev.target.checked); onToggle(ev.target.checked); } });
  return el('span', { class: 'cc-legend', id: id || null },
    el('label', { class: 'menu-check cc-toggle tip', title: 'Pokaż koszt zakupu: węższy, ciemny słupek wewnątrz każdego słupka wartości. Widoczna reszta słupka to marża (oraz dostawa). ' + COST_SOURCE + ' Ustawienie zapamiętywane w tej przeglądarce.' },
      box, el('i', { class: 'cc-sw', 'aria-hidden': 'true' }), el('span', null, 'Pokaż koszt zakupu')),
    shown && gaps ? el('span', { class: 'tip cc-gap', title: 'Kreskowany słupek = koszt niepełny: części sprzedanego towaru brakuje ceny zakupu w karcie produktu, więc pokazany koszt jest zaniżony. '
      + 'Kreskowany obrys całego słupka = koszt nieznany (żaden produkt nie ma ceny zakupu). Szczegóły po najechaniu na słupek. Przedziałów z brakami: ' + gaps + '.' },
    el('i', { class: 'cc-sw part', 'aria-hidden': 'true' }), 'koszt niepełny') : null);
}
