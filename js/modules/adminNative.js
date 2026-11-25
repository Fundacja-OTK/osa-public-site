// Administracja i system (podgląd) — ekrany Selly tylko do odczytu (bez zapisu): konta administratorów, grupy, uprawnienia, dane osobowe (zdarzenia),
// zgłoszenia, płatności, zlecenia, usługi, rozszerzenia, wizyty, pliki, automatyzacje, integrator, Rest API / Front API (bez wartości kluczy), przesyłki
// Furgonetka i Suus. Dane: serwer główny czyta Selly sesją użytkownika; sekrety są maskowane po stronie serwera (extension/lib/sellyNative.js).
// Konfiguracja: screen = id ekranu (SCREENS), headerTips = wyjaśnienia kolumn. Nowy ekran: wpis tu + SCREENS + nav.js + shell.js (LAZY).
import { createNative } from './sellyNative.js?v=c5a69db';

const ro = (id, title, a, noun, headerTips, extra) => createNative({ id, title, screen: id, a, noun, recordTitle: i => title + ' nr ' + i, headerTips: headerTips || {}, ...extra });

export const views = {
  'allegro-aukcje-lista': ro('allegro-aukcje-lista', 'Allegro — aukcje', 'allegro.auctionsDB', 'aukcje', { 'Podstawowe dane o aukcji': 'Numer aukcji, tytuł i status oferty na Allegro', 'Ilość w magazynie': 'Stan produktu w sklepie' }),
  'allegro-zdarzenia': ro('allegro-zdarzenia', 'Allegro — zdarzenia aukcji', 'allegro.events', 'zdarzenia', { 'Rodzaj zdarzenia': 'Co się wydarzyło z aukcją (wystawienie, zakończenie, błąd) i ile to trwało' }),
  admini: ro('admini', 'Konta administratorów Selly', 'users', 'konta', {
    'ID': 'Numer konta w Selly',
    'LoginImię i nazwisko': 'Login i imię konta administratora',
    'Ostatnie logowanie': 'Kiedy konto ostatnio zalogowało się do panelu Selly',
    'Ostatnie złe logowanie': 'Ostatnia nieudana próba logowania na to konto',
  }, { recordRoute: 'users.edit' }),
  grupy: ro('grupy', 'Grupy użytkowników', 'groups', 'grupy', { 'Ilość kont': 'Ile kont administratorów należy do grupy' }, { recordRoute: 'groups.view' }),
  uprawnienia: ro('uprawnienia', 'Uprawnienia', 'actions.perm', 'grupy', { 'Liczba użytkowników': 'Ile kont ma uprawnienia tej grupy' }, { recordRoute: 'actions.perm' }),
  odo: ro('odo', 'Dane osobowe', 'odo', 'zdarzenia', { 'Dane o zdarzeniu': 'Co zostało zrobione z danymi osobowymi (np. anonimizacja, eksport)', 'Administrator': 'Kto wykonał czynność' }),
  zgloszenia: ro('zgloszenia', 'Zgłoszenia', 'support', 'zgłoszenia', { 'Dział zgłoszeń': 'Dział Selly, do którego trafiło zgłoszenie', 'Ostatnia zmiana': 'Kiedy ktoś ostatnio dopisał się do zgłoszenia' }),
  platnosci: ro('platnosci', 'Płatności', 'billing', 'płatności', { 'Kwota netto': 'Kwota bez VAT', 'VAT': 'Kwota podatku VAT', 'Kwota brutto': 'Kwota z VAT' }),
  zlecenia: ro('zlecenia', 'Zlecenia', 'billing.settlements', 'zlecenia', {
    'Czas (abonament)': 'Godziny pracy zużyte lub dodane z abonamentu', 'Czas (dodatkowy)': 'Godziny pracy dokupione dodatkowo',
    'Pozostały czas (abonament)': 'Ile godzin z abonamentu zostało po tym wpisie', 'Pozostały czas (dodatkowy)': 'Ile dokupionych godzin zostało po tym wpisie' }),
  uslugi: ro('uslugi', 'Usługi dodatkowe', 'billing.addons', 'usługi'),
  'uslugi-partnerow': ro('uslugi-partnerow', 'Usługi partnerów', 'partnerzy', 'usługi'),
  rozszerzenia: ro('rozszerzenia', 'Rozszerzenia sklepu', 'billing.extensions', 'rozszerzenia'),
  wizyty: ro('wizyty', 'Śledzenie ostatnich wizyt', 'statistics.hits', 'wizyty', { 'Adres IP': 'Adres IP odwiedzającego', 'Użytkownik': 'Zalogowany klient (jeśli był zalogowany)', 'Strona': 'Adres wyświetlonej strony sklepu' }),
  pliki: ro('pliki', 'Menadżer plików', 'filemanager', 'pliki'),
  automatyzacje: ro('automatyzacje', 'Automatyzacje zadań', 'automation', 'automatyzacje'),
  'ceny-auto': ro('ceny-auto', 'Automatyzacje zmian cen', 'promotionalPrices', 'automatyzacje'),
  integrator: ro('integrator', 'Integrator XML/CSV', 'integrator', 'integracje'),
  api: ro('api', 'Rest API', 'api', 'klucze', { 'Scope': 'Zakres uprawnień klucza: odczyt (READ), zapis (WRITE) albo oba (READWRITE)', 'Aktywny': 'Czy klucz jest włączony' }),
  frontapi: ro('frontapi', 'Front API — Agentic Commerce', 'frontapi', 'ustawienia'),
  furgonetka: ro('furgonetka', 'Przesyłki Furgonetka.pl', 'furgonetka.przesylki', 'przesyłki'),
  suus: ro('suus', 'Przesyłki Suus', 'suus.przesylki', 'przesyłki'),
};
