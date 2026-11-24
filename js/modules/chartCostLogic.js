// Czysta (bez DOM) logika słupka kosztu zakupu w słupkach sprzedaży — wydzielona do testów jednostkowych (rysuje chartCost.js).
// Dane z Workera (lib/purchaseCost.js): { goods, covered, net, gross, missQty } — goods = wartość towaru brutto, covered = jej część z ceną zakupu,
// net / gross = koszt zakupu netto / brutto (bieżąca cena zakupu z karty produktu × sztuki; brutto = + VAT produktu), missQty = sztuki bez ceny zakupu.

/**
 * Co pokazać dla przedziału. state: 'none' (brak sprzedanego towaru albo brak danych), 'unknown' (żadna pozycja nie ma ceny zakupu),
 * 'partial' (część pozycji bez ceny — koszt zaniżony), 'full'. Marża liczona tylko z pozycji z ceną zakupu: covered − gross, % od covered.
 */
export function costInfo(c) {
  if (!c || !(Number(c.goods) > 0)) return { state: 'none' };
  const goods = Number(c.goods), covered = Math.min(Number(c.covered) || 0, goods), gross = Number(c.gross) || 0, net = Number(c.net) || 0, missQty = Number(c.missQty) || 0;
  const missValue = Math.max(0, goods - covered), missShare = goods ? missValue / goods : 0;
  if (!(covered > 0)) return { state: 'unknown', goods, missQty, missValue, missShare: 1 };
  const margin = covered - gross;
  return { state: missValue > 0.005 || missQty > 0 ? 'partial' : 'full', goods, covered, gross, net, margin, marginPct: margin / covered * 100, missQty, missValue, missShare };
}

/** Wysokość słupka kosztu w jednostkach osi (koszt brutto); 0, gdy nie ma czego rysować. */
export const costValue = c => { const i = costInfo(c); return i.state === 'full' || i.state === 'partial' ? i.gross : 0; };
