// Zwroty (Selly ?a=zwroty) — natywny ekran na sesji Selly użytkownika: lista z filtrami, karta z pozycjami zwrotu i historią zdarzeń,
// zmiana statusu i uwag wewnętrznych (podgląd → potwierdzenie → zapis; e-mail, etykieta i formularz zwrotu nie są wysyłane).
// API Selly podaje zwroty tylko do odczytu (bez pozycji i nazw statusów) — dawny widok z API zostaje pod #/zwroty (bez pozycji menu).
// Zdarzenia wszystkich zwrotów i słownik statusów — widoki tylko do podglądu (eksporty `zdarzenia`, `statusy`). Usuwanie zostaje w Selly.
import { createNative } from './sellyNative.js?v=9e50e6d';
import { createSettings } from './sellyNativeSettings.js?v=9e50e6d';
import { panelLink } from './koszyki.js?v=9e50e6d';

const LINKS = [
  { href: '#/zwroty-obsluga', label: 'Zwroty', tip: 'Lista zwrotów' },
  { href: '#/zwroty-zdarzenia', label: 'Zdarzenia', tip: 'Historia zdarzeń wszystkich zwrotów (kto, kiedy, co zmienił; czy wysłano list)' },
  { href: '#/zwroty-statusy', label: 'Statusy', tip: 'Słownik statusów zwrotów z Selly (tylko podgląd)' },
];
const others = id => LINKS.filter(l => l.href !== '#/' + id);

/** Pola pozycji zwrotu (produkt[n], produkt_ilosc[n]) → czytelna etykieta; inne pola → null (etykieta z Selly). */
export function returnLabel(f) {
  const m = /^(produkt|produkt_ilosc)\[(\d{1,3})\]$/.exec((f && f.name) || '');
  return m ? 'Pozycja ' + m[2] + ' — ' + (m[1] === 'produkt' ? 'produkt' : 'ilość') : null;
}

export default createNative({
  id: 'zwroty-obsluga', title: 'Zwroty', screen: 'zwroty-obsluga', a: 'zwroty', recordRoute: 'zwroty.edycja', noun: 'zwrotu',
  recordTitle: id => 'Zwrot nr ' + id,
  cellLink: panelLink,
  links: others('zwroty-obsluga'),
  remove: { title: 'Usunąć zwrot?', tip: 'Usuwa ten zwrot z Selly (tylko administrator panelu, po potwierdzeniu)', body: id => 'Zwrot nr ' + id + ' zostanie usunięty z Selly.' },   // serwer: native:delete = ADMIN
  labels: {
    zamowienie_numer: 'Numer zamówienia', kwota_zwrotu: 'Kwota zwrotu', numer_konta: 'Numer konta do zwrotu', user_id: 'ID zgłaszającego',
    status_id: 'Status zwrotu', uwagi: 'Uwagi wewnętrzne', komentarz_mail: 'Komentarz do e-maila',
    wyslij_mail: 'Wyślij e-mail', wyslij_zalaczniki: 'Wyślij etykietę i formularz zwrotu', powrot: 'Pozostań w edycji',
  },
  labelOf: returnLabel,
  fieldTips: {
    status_id: 'Zmiana statusu może w Selly wysłać klientowi automatyczne powiadomienie (jeśli status ma szablon listu)',
    uwagi: 'Notatka widoczna tylko dla obsługi sklepu',
  },
  headerTips: {
    'Data wpisania': 'Kiedy zwrot został zgłoszony w Selly',
    'Numer zwrotuKod kreskowy': 'Numer zwrotu i kod kreskowy z formularza zwrotu',
    'Klient': 'Kto zgłosił zwrot',
    'Produkty': 'Zwracane produkty i ilości',
    'Status': 'Etap obsługi zwrotu (nowy, przyjęty, zrealizowany, zwrócono pieniądze…)',
    'Działanie': 'Dostępne czynności w Selly',
  },
});

export const zdarzenia = createNative({
  id: 'zwroty-zdarzenia', title: 'Zwroty — zdarzenia', screen: 'zwroty-zdarzenia', a: 'zwroty.zdarzenia', noun: 'zdarzenia',
  recordTitle: id => 'Zdarzenie ' + id, links: others('zwroty-zdarzenia'),
  headerTips: {
    'Data zdarzenia': 'Kiedy zdarzenie zostało zapisane w Selly',
    'Numer zwrotu': 'Zwrot, którego dotyczy zdarzenie',
    'Osoba': 'Kto wykonał czynność (pracownik albo klient)',
    'Opis': 'Co się wydarzyło: formularz zwrotu, korespondencja, zmiana danych, komentarz…',
    'Wysłano list': 'Czy Selly wysłało przy tym e-mail do klienta',
  },
});

export const statusy = createSettings({ id: 'zwroty-statusy', title: 'Statusy zwrotów', screen: 'zwroty-statusy', a: 'zwroty.statusy',
  intro: 'Statusy, przez które przechodzi zwrot, z kolorami i szablonami listów. Zmiany i usuwanie — w Selly.', links: others('zwroty-statusy') });
