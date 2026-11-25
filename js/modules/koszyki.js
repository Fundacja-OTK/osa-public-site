// Porzucone koszyki (Selly ?a=carts) — natywny ekran tylko do odczytu: lista z filtrami (sklep, klient, sortowanie), produkty i dane z Selly.
// Dane właścicieli koszyków są pokazane tak jak w Selly zalogowanemu użytkownikowi; linki do klienta i zamówienia prowadzą do panelu OSA.
import { createNative } from './sellyNative.js?v=82b7f36';

/** Link z Selly (?a=klienci.*&id= / ?a=zamowienia.*&id=) → trasa panelu OSA; inne linki zostają linkami do Selly. */
export function panelLink(href) {
  let u; try { u = new URL(href); } catch (e) { return null; }
  const a = u.searchParams.get('a') || '', id = u.searchParams.get('id') || '';
  if (!/^\d{1,12}$/.test(id)) return null;
  if (/^klienci\.(view|edit|edycja|klient|karta)?$/i.test(a) || a === 'klienci') return { href: '#/klienci/' + id, tip: 'Otwiera klienta w panelu OSA' };
  if (/^zamowienia\.(view|edit|edycja)$/i.test(a)) return { href: '#/zamowienia/' + id, tip: 'Otwiera zamówienie w panelu OSA' };
  return null;
}

export default createNative({
  id: 'koszyki', title: 'Porzucone koszyki', screen: 'koszyki', a: 'carts', noun: 'koszyka',
  recordTitle: id => 'Koszyk ' + id,
  cellLink: panelLink,
  headerTips: {
    'Data wpisania D.modyfikacji': 'Kiedy koszyk powstał i kiedy klient ostatnio go zmieniał',
    'Nazwa sklepu': 'Sklep, w którym klient zostawił koszyk',
    'Produkty w koszyku': 'Produkty z ilością i wartością (z Selly)',
    'Data powiadomienia': 'Kiedy Selly wysłało klientowi przypomnienie o koszyku',
    'Dane ogólne': 'Klient (jeśli był zalogowany) i dane kontaktowe z koszyka — widoczne tak jak w Selly',
  },
});
