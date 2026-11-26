// Marketing (natywne ekrany Selly, definicje: shared/native/marketing.js): newsletter (zapisani), powiadomienia o dostępności, program partnerski
// (partnerzy, prowizje, konfiguracja), ankieta do zamówień, statystyki wyszukiwarki, powiadomienia o koszykach, automatyczna wysyłka kuponów.
// Listy z adresami e-mail / telefonami / IP maskuje serwer (maskPii) — pełne dane tylko w Selly. Wysyłka masowa (newsletter, kupony) zostaje w Selly.
import { createNative } from './sellyNative.js?v=196affa';
import { createSettings } from './sellyNativeSettings.js?v=196affa';

const ro = (id, title, a, noun, headerTips) => createNative({ id, title, screen: id, a, noun, recordTitle: i => title + ' nr ' + i, headerTips: headerTips || {} });
const MASK_TIP = ' — adres i dane kontaktowe są częściowo ukryte; pełne zobaczysz w Selly';

export const screens = {
  newsletter: ro('newsletter', 'Newsletter — zapisani', 'newsletter.recipients', 'zapisani', {
    'Adres e-mail': 'Zapisany adres' + MASK_TIP, 'Data wpisania': 'Kiedy adres zapisał się na newsletter', 'Adres IP': 'IP, z którego zapisano adres (zamaskowane)',
    'Usuń': 'Usuwanie zapisanych zostaje w Selly',
  }),
  powiadomienia: ro('powiadomienia', 'Powiadomienia o dostępności', 'scripts.productsNotifications', 'powiadomienia', {
    'Data wpisania': 'Kiedy klient poprosił o powiadomienie', 'Adres e-mail Telefon': 'Kontakt klienta' + MASK_TIP, 'Dane o kliencie': 'Klient, jeśli był zalogowany',
    'Produkt Sklep, język': 'Produkt, o którego dostępność pyta klient', 'Działanie': 'Czynności dostępne w Selly',
  }),
  partnerzy: ro('partnerzy', 'Program partnerski — partnerzy', 'partners', 'partnerzy', {
    'Partner': 'Partner programu partnerskiego', 'zdobyte': 'Wszystkie kredyty (prowizje) zdobyte przez partnera', 'naliczone': 'Prowizje naliczone, jeszcze niewypłacone',
    'do wypłaty': 'Prowizje gotowe do wypłaty', 'zrealizowane': 'Prowizje już wypłacone', 'anulowane': 'Prowizje anulowane (np. po zwrocie zamówienia)', 'Odnośniki': 'Linki partnera',
  }),
  'partnerzy-prowizje': ro('partnerzy-prowizje', 'Program partnerski — prowizje', 'partners.commissions', 'prowizje', {
    'Data wpisania': 'Kiedy naliczono prowizję', 'Partner': 'Komu należy się prowizja', 'Polecający / Zamówienie': 'Kto polecił i z jakiego zamówienia pochodzi prowizja',
    'Poziom': 'Poziom polecenia w programie', 'Prowizja': 'Kwota prowizji', 'Status': 'Naliczona, do wypłaty, zrealizowana albo anulowana',
  }),
  'partnerzy-konf': createSettings({ id: 'partnerzy-konf', title: 'Program partnerski — konfiguracja', screen: 'partnerzy-konf', a: 'partners.configuration',
    intro: 'Zasady prowizji, program lojalnościowy i opcje w koszyku (tylko podgląd).' }),
  ankieta: ro('ankieta', 'Ankieta do zamówień — wyniki', 'sondy', 'odpowiedzi', {
    'Id': 'Numer odpowiedzi w ankiecie', 'Odpowiedź': 'Treść odpowiedzi do wyboru', 'Liczba odpowiedzi': 'Ile razy klienci wybrali tę odpowiedź',
    'Odpowiedzi tekstowe': 'Odpowiedzi wpisane przez klientów własnymi słowami',
  }),
  wyszukiwarka: ro('wyszukiwarka', 'Statystyki wyszukiwarki', 'statistics.search', 'frazy', {
    'Data wyszukiwania': 'Kiedy ostatnio szukano tej frazy', 'Szukano': 'Fraza wpisana w wyszukiwarkę sklepu', 'Data wpisania': 'Kiedy fraza pojawiła się pierwszy raz',
    'Liczba wyszukiwań': 'Ile razy szukano tej frazy', 'Liczba wyników': 'Ile produktów sklep znalazł dla frazy (0 = klienci nie znajdują, warto dodać produkt lub synonim)',
  }),
  'koszyki-powiadomienia': ro('koszyki-powiadomienia', 'Powiadomienia o porzuconych koszykach', 'carts.notifications', 'powiadomienia', {
    'Data wpisania D.modyfikacji': 'Kiedy koszyk powstał i był ostatnio zmieniany', 'Nazwa sklepu': 'Sklep, w którym klient zostawił koszyk', 'Produkty w koszyku': 'Produkty z ilością i wartością',
    'Data powiadomienia': 'Kiedy Selly wysłało klientowi przypomnienie', 'Dane ogólne': 'Klient i kontakt' + MASK_TIP,
  }),
  'kupony-auto': createSettings({ id: 'kupony-auto', title: 'Kupony — automatyczna wysyłka', screen: 'kupony-auto', a: 'rabaty.kuponyRabatoweAutomatycznaWysylka',
    intro: 'Kiedy sklep sam wysyła klientom kupon (po zapisie do newslettera, po zamówieniu): na podstawie jakiego kuponu, z jakim prefiksem i od jakiej wartości zamówienia. Zmiany przechodzą przez podgląd i potwierdzenie.' }),
};
