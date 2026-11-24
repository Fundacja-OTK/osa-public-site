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
  return E.group === 'week' ? applyWeekly(out, E) : out;
}

// ─── Tygodnie ISO (kopia panel/worker/src/lib/weeks.js — testy pilnują zgodności) ──────────────────────────────
export const weekday = iso => ((parse(iso).getUTCDay() + 6) % 7) + 1;
export function isoWeekOf(iso) {
  const thu = addDays(iso, 4 - weekday(iso)), y = Number(thu.slice(0, 4));
  return { y, w: Math.floor((daysBetween(y + '-01-01', thu) - 1) / 7) + 1 };
}
export const isoWeeksInYear = y => isoWeekOf(y + '-12-28').w;
export const isoWeekStart = (y, w) => addDays(addDays(y + '-01-04', 1 - weekday(y + '-01-04')), (w - 1) * 7);
export const isoWeekDate = (y, w, wd) => addDays(isoWeekStart(y, w), wd - 1);
export function weekSlot(iso, per) {
  if (per.isoY) { const { y, w } = isoWeekOf(iso); return y < per.isoY ? 0 : y > per.isoY ? isoWeeksInYear(per.isoY) - 1 : w - 1; }
  return Math.floor((daysBetween(per.from, iso) - 1) / 7);
}
export const weekSlotCount = (per, axisTo) => (per.isoY ? isoWeeksInYear(per.isoY) : Math.floor((daysBetween(per.from, axisTo) - 1) / 7) + 1);
const WD = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];
export const weekdayName = wd => WD[wd - 1];
/** „17–23.11” albo „27.10–2.11”. */
export function weekRangeText(a, b) {
  const d = s => Number(s.slice(8, 10)), m = s => Number(s.slice(5, 7));
  return m(a) === m(b) ? d(a) + '–' + d(b) + '.' + m(b) : d(a) + '.' + m(a) + '–' + d(b) + '.' + m(b);
}
/** Etykieta tygodnia ISO: „tydz. 47 (17–23.11)”. */
export const weekLabel = (y, w) => 'tydz. ' + w + ' (' + weekRangeText(isoWeekStart(y, w), isoWeekDate(y, w, 7)) + ')';

/** Niepełny (bieżący) tydzień: do którego dnia tygodnia i godziny liczymy go we wszystkich latach. */
export function partialWeek(today, nowTime) {
  const { y, w } = isoWeekOf(today), wd = weekday(today), hm = String(nowTime || '23:59:59').slice(0, 5);
  const short = weekdayName(wd) + ' ' + hm;
  return { y, w, wd, nowTime: nowTime || '23:59:59', short, range: 'tydz. ' + w + ' do ' + short, note: 'Porównanie do tego samego dnia tygodnia i godziny: tydzień ' + w + ' do ' + short + ' w każdym roku' };
}

/** Okresy „Lata” z tygodniami: okres roku kalendarzowego dostaje isoY (oś = numery tygodni ISO), a bieżący tydzień jest ucinany do tego samego dnia i godziny. */
export function applyWeekly(out, E) {
  const cur = out.find(p => p.from <= E.today && E.today <= p.fullTo);
  const pw = partialWeek(E.today, E.nowTime);
  for (const p of out) { if (E.per === 'year') p.isoY = p.Y; delete p.cutFrom; delete p.cutTo; delete p.cutAt; delete p.toAt; delete p.partial; }
  if (!cur) return out;
  cur.to = E.today; cur.partial = pw;
  for (const p of out) {
    if (p === cur) continue;
    p.partial = pw;
    if (E.per === 'year') {
      const iy = p.isoY + (pw.y - cur.Y);
      if (pw.w > isoWeeksInYear(iy)) { p.weekNA = true; continue; }   // tygodnia 53 nie ma w tym roku
      const d = isoWeekDate(iy, pw.w, pw.wd);
      if (E.ytd) { p.to = d > p.fullTo ? p.fullTo : d < p.from ? p.from : d; if (d >= p.from && d <= p.fullTo) p.toAt = pw.nowTime; }
      else if (d >= p.from && d <= p.fullTo) { p.cutFrom = d; p.cutAt = pw.nowTime; const sun = isoWeekDate(iy, pw.w, 7); p.cutTo = sun < p.to ? sun : p.to; }
    } else if (E.ytd) { const t = addYears(E.today, p.Y - cur.Y); p.to = t > p.fullTo ? p.fullTo : t < p.from ? p.from : t; }
  }
  return out;
}
