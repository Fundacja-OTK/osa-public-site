// Stan płatności zamówienia z kwot (wspólny dla listy Zamówień i listy SpeedMail; bez DOM — testowane w Node).
// Reguły jak w SQL panelu (PAY_SQL w worker/modules/orders.js): opłacone = zapłacono ≥ wartość − 1 gr; nadpłata = > wartość + 1 gr;
// niedopłata = między 0 a wartością − 1 gr; nieopłacone = zapłacono ≤ 0.

const f2 = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');

/** → { state: 'paid'|'over'|'partial'|'unpaid', label, cls: 'yes'|'warn'|'no'|'info', tip } */
export function payState(paid, total) {
  const p = Number(paid) || 0, t = Number(total) || 0, d = Math.round((p - t) * 100) / 100;
  const sum = 'zapłacono ' + f2(p) + ' z ' + f2(t) + ' zł';
  if (p > t + 0.01 && p > 0) return { state: 'over', label: 'Nadpłata', cls: 'info', tip: 'Nadpłata: ' + sum + ', różnica +' + f2(d) + ' zł' };
  if (t > 0 && p >= t - 0.01) return { state: 'paid', label: 'Opłacone', cls: 'yes', tip: 'Opłacone: ' + sum };
  if (p > 0) return { state: 'partial', label: 'Niedopłata', cls: 'warn', tip: 'Niedopłata: ' + sum + ', brakuje ' + f2(-d) + ' zł' };
  return { state: 'unpaid', label: 'Nieopłacone', cls: 'no', tip: 'Nieopłacone: ' + sum + ' (przy płatności przy odbiorze to normalne)' };
}
