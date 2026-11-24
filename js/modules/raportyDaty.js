// Czyste (bez DOM) funkcje dat i okresów raportów sprzedaży — wydzielone, żeby dało się je testować jednostkowo.
const DAY = 86400e3;
export const pad = n => String(n).padStart(2, '0');
const parse = s => new Date(s + 'T12:00:00Z');
export const isoOf = d => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
export const addDays = (iso, n) => isoOf(new Date(parse(iso).getTime() + n * DAY));
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY) + 1;
export const addYears = (iso, n) => { const y = Number(iso.slice(0, 4)) + n, m = iso.slice(5, 7), d = iso.slice(8, 10); return y + '-' + m + '-' + (m === '02' && d === '29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? '28' : d); };
export const validIso = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(parse(s));

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
/** Ostatni dzień miesiąca, w którym wypada podana data. */
const monthEnd = iso => addDays(nextMonth(iso), -1);
const nextMonth = iso => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); return m === 12 ? (y + 1) + '-01-01' : y + '-' + pad(m + 1) + '-01'; };

/** Opis niepełnego (bieżącego) miesiąca: do którego dnia liczymy go we wszystkich latach. Null, gdy dzisiaj jest ostatni dzień miesiąca. */
export function partialMonth(today) {
  if (today >= monthEnd(today)) return null;
  const d = Number(today.slice(8, 10)), mo = Number(today.slice(5, 7));
  return { day: d, short: ddmmOf(today), range: (d === 1 ? '1' : '1–' + d) + ' ' + MONTHS_GEN[mo - 1], note: 'Porównanie do tego samego dnia miesiąca: ' + (d === 1 ? '1' : '1–' + d) + ' ' + MONTHS_GEN[mo - 1] + ' w każdym roku' };
}
const ddmmOf = iso => iso.slice(8, 10) + '.' + iso.slice(5, 7);

// ─── Okresy ─────────────────────────────────────────────────────────────────

/** Okresy do porównania. Okres obejmujący dzisiejszy dzień kończy się dziś, a przy „do dzisiejszego dnia” wcześniejsze lata też (ten sam dzień kalendarzowy). */
export function lataPeriods(E) {
  const out = [];
  for (let Y = E.yf; Y <= E.yt; Y++) {
    let from, fullTo;
    if (E.per === 'year') { from = Y + '-01-01'; fullTo = Y + '-12-31'; }
    else if (E.per === 'season') { from = Y + '-' + pad(E.ss) + '-01'; fullTo = addDays((Y + 1) + '-' + pad(E.ss) + '-01', -1); }
    else { const s = Y - Number(E.from.slice(0, 4)); from = addYears(E.from, s); fullTo = addYears(E.to, s); }
    if (from > E.today) continue;
    out.push({ Y, from, to: fullTo, fullTo, label: from.slice(0, 4) === fullTo.slice(0, 4) ? from.slice(0, 4) : from.slice(0, 4) + '/' + fullTo.slice(2, 4) });
  }
  const cur = out.find(p => p.from <= E.today && E.today <= p.fullTo);
  if (cur) for (const p of out) {
    if (p === cur) { p.to = E.today; p.partial = partialMonth(E.today); }
    else if (E.ytd) { const t = addYears(E.today, p.Y - cur.Y); p.to = t > p.fullTo ? p.fullTo : t < p.from ? p.from : t; }
    else {
      // pełne okresy: miesiąc, w którym jest dziś, wcześniejsze lata liczymy tylko do tego samego dnia (reszta miesięcy zostaje pełna)
      const t = addYears(E.today, p.Y - cur.Y), me = monthEnd(t);
      if (t >= p.from && t < me && t < p.to) { p.cutFrom = addDays(t, 1); p.cutTo = me < p.to ? me : p.to; }
    }
  }
  if (cur) for (const p of out) if (cur.partial && p !== cur) p.partial = cur.partial;
  return out;
}
