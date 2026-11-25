// Katalog menu panelu OSA: wszystkie sekcje panelu Selly (docs/selly-admin-map.md) + dodatki OSA.
// Pozycja: { id, title, a?, kind, tip?, admin? }
//   kind 'osa'      — własny ekran panelu OSA (moduł o tym id)
//   kind 'resource' — ekran uniwersalny (lista / karta / formularz ze specyfikacji API; modules/zasob.js)
//   kind 'soon'     — Selly ma API, ekran OSA w planie; do tego czasu strona z linkiem do Selly
//   kind 'selly'    — tylko panel Selly (brak API) — otwiera Selly w nowej karcie
//   a — trasa panelu Selly (?a=...), do linku „otwórz w Selly” i przekierowań z rozszerzenia
// Widoczność sekcji OSA zależy od uprawnień konta Selly (shared/panelAuth.js → canSee; docs/auth.md).
// '-' w liście pozycji = separator grupy.
// Układ menu bocznego (krótka lista codzienna, zwijane grupy, synonimy do szukania) — PRIMARY / GROUPS / GROUP_OF / SYNONYMS niżej;
// pozycje dopisuj tu jak dotąd (jedna na linię) — nowa pozycja trafia sama do grupy swojej sekcji.

export const SECTIONS = [
  { id: 'sprzedaz', title: 'Sprzedaż', icon: 'bag', items: [
    { id: 'zamowienia', title: 'Zamówienia', a: 'zamowienia', kind: 'osa', tip: 'Lista zamówień, karta z edycją, statusy (także masowo), eksport' },
    { id: 'speedmail', title: 'Wysyłka SpeedMail', kind: 'osa', tip: 'Kto pakuje zamówienie — SpeedMail czy my — z powodem, przekazanie paczek zleceń (plik Excel, statusy w Selly), stan towaru w SpeedMail z alertami i tempo sprzedaży' },
    { id: 'oferty', title: 'Oferty', a: 'offersAdm', kind: 'osa', tip: 'Oferty z Selly: lista, filtry, karta oferty i zmiana statusu / opiekuna / notatek (na Twojej sesji Selly)' },
    { id: 'subskrypcje', title: 'Subskrypcje', a: 'subskrypcje', kind: 'resource' },
    '-',
    { id: 'dropshipping', title: 'Dropshipping', a: 'zamowienia.dropshipping', kind: 'osa', tip: 'Paczki dropshipping i produkty w paczkach: lista, karta, statusy, dodawanie i edycja' },
    { id: 'klienci', title: 'Klienci', a: 'klienci', kind: 'osa', tip: 'Lista klientów, karta, zamówienia klienta, notatki' },
    { id: 'wplaty', title: 'Import wpłat bankowych', a: 'zamowienia.importWplat', kind: 'osa', tip: 'Wczytaj wyciąg z banku (CSV), zobacz dopasowanie wpłat do zamówień i oznacz opłacone — wyciąg zostaje w przeglądarce' },
    '-',
    { id: 'przesylki', title: 'Przesyłki — do nadania', a: 'inpost.listOrders', kind: 'osa', tip: 'Kolejka zamówień do nadania u wszystkich przewoźników naraz (InPost, DPD, DHL, Orlen Paczka, UPS), masowe etykiety' },
    { id: 'furgonetka', title: 'Przesyłki Furgonetka.pl', a: 'furgonetka.przesylki', kind: 'osa', menu: false, tip: 'Przesyłki nadane przez Furgonetkę (tylko podgląd, dane z Selly na Twojej sesji)' },
    { id: 'suus', title: 'Przesyłki Suus', a: 'suus.przesylki', kind: 'osa', menu: false, tip: 'Przesyłki Suus / Rohlig (tylko podgląd, dane z Selly na Twojej sesji)' },
    '-',
    { id: 'reklamacje', title: 'Reklamacje', a: 'reklamacje', kind: 'osa', tip: 'Reklamacje z Selly: lista, filtry, karta i zmiana statusu, pracownika, RMA i uwag (na Twojej sesji Selly)' },
    { id: 'zwroty', title: 'Zwroty', a: 'zwroty', kind: 'resource' },
  ] },
  { id: 'marketplace', title: 'Marketplace', icon: 'store', items: [
    { id: 'allegro', title: 'Allegro — synchronizacja', a: 'allegro', kind: 'osa', tip: 'Podgląd ustawień synchronizacji ofert Allegro (ceny, stany, kończenie aukcji); dane dostępowe ukryte, zmiany w Selly' },
    { id: 'allegro-aukcje', title: 'Allegro — domyślne aukcje', a: 'allegro', kind: 'osa', tip: 'Domyślne ustawienia nowych aukcji Allegro: czas trwania, jednostka, EAN, rozmiar zdjęć — z podglądem zmian przed zapisem' },
    { id: 'allegro-aukcje-lista', title: 'Allegro — aukcje', a: 'allegro.auctionsDB', kind: 'osa', tip: 'Lista aukcji Allegro z Selly z filtrami (tylko podgląd; synchronizacja i zmiany w Selly)' },
    { id: 'allegro-zdarzenia', title: 'Allegro — zdarzenia', a: 'allegro.events', kind: 'osa', tip: 'Dziennik zdarzeń aukcji Allegro: wystawienia, zakończenia, błędy synchronizacji (tylko podgląd)' },
    { id: 'allegro-wysylka', title: 'Allegro — czas wysyłki', a: 'allegro.shippingTime', kind: 'osa', tip: 'Mapowanie czasów wysyłki sklepu na czasy w ofertach Allegro — z podglądem zmian przed zapisem' },
    { id: 'allegro-operatorzy', title: 'Allegro — operatorzy przesyłek', a: 'allegro.packageOperators', kind: 'osa', tip: 'Któremu operatorowi Allegro odpowiada każda forma dostawy — z podglądem zmian przed zapisem' },
    { id: 'allegro-szablony', title: 'Allegro — szablony aukcji', a: 'allegro.templates', kind: 'osa', tip: 'Podgląd szablonów aukcji Allegro (tylko podgląd; zmiany w Selly)' },
    { id: 'empik', title: 'Empik', a: 'marketplace', kind: 'osa', tip: 'Podgląd konta Empik (klucz API ukryty); zmiany w Selly' },
    { id: 'erli', title: 'Erli', a: 'marketplace', kind: 'selly' },
    { id: 'ceneo', title: 'Ceneo', a: 'marketplace', kind: 'selly' },
    { id: 'ceneo-opinie', title: 'Ceneo — ankieta po zakupie', a: 'scripts.integracjaCeneo', kind: 'osa', tip: 'Podgląd integracji z Ceneo (ankieta po zakupie; GUID ukryty), zmiany w Selly' },
    { id: 'ceneo-mapa', title: 'Ceneo — mapowanie kategorii', a: 'configuration.ceneoMap', kind: 'osa', tip: 'Podgląd mapowania kategorii sklepu na kategorie Ceneo (tylko podgląd; zmiany w Selly)' },
    { id: 'kaufland', title: 'Kaufland', a: 'marketplace', kind: 'selly' },
    { id: 'tiktok', title: 'TikTok', a: 'marketplace', kind: 'selly' },
  ] },
  { id: 'asortyment', title: 'Asortyment', icon: 'box', items: [
    { id: 'produkty', title: 'Produkty', a: 'produkty', kind: 'osa', tip: 'Lista produktów, stany, ceny, karta produktu' },
    { id: 'zestawy', title: 'Zestawy', a: 'zestawy', kind: 'resource' },
    { id: 'kategorie', title: 'Kategorie', a: 'kategorie', kind: 'resource' },
    { id: 'magazyny', title: 'Magazyny', a: 'magazyny', kind: 'osa', tip: 'Stany fizyczne, wydania do zamówień, przesunięcia, inwentaryzacja; wysyłka SpeedMail ma własny kreator w „Sprzedaży”' },
    { id: 'producenci', title: 'Producenci', a: 'producenci', kind: 'resource' },
    '-',
    { id: 'gpsr', title: 'Dane GPSR', a: 'bezpieczenstwoProduktu', kind: 'selly' },
    { id: 'dostepnosc', title: 'Statusy dostępności', a: 'configuration.productsAvailability', kind: 'osa', tip: 'Które statusy dostępności są w filtrze sklepu — z podglądem zmian przed zapisem (na Twojej sesji Selly)' },
    { id: 'hurt', title: 'Sprzedaż hurtowa', a: 'rabaty.grupyRabatowe', kind: 'selly' },
    { id: 'atrybuty', title: 'Warianty i opcje', a: 'produkty.atrybutyGrupy', kind: 'resource' },
    { id: 'opisy', title: 'Opisy zaawansowane', a: 'wzorceCech', kind: 'osa', tip: 'Wzorce cech produktów: lista i edycja nazwy, opisu, jednostki, grupy' },
    { id: 'tagi', title: 'Tagi', a: 'tags', kind: 'resource' },
    { id: 'ksztalty', title: 'Kształty produktów', a: 'configuration.shapes', kind: 'osa', tip: 'Kolejność kształtów produktów i włączenie wymiarów — z podglądem zmian przed zapisem (na Twojej sesji Selly)' },
    { id: 'gwarancje', title: 'Gwarancje', a: 'gwarancje', kind: 'osa', tip: 'Gwarancje i ich ceny: lista i edycja zasad (progi cenowe w Selly)' },
  ] },
  { id: 'marketing', title: 'Marketing', icon: 'megaphone', items: [
    // === sprzedaż (kupony, koszyki) ===
    { id: 'koszyki', title: 'Koszyki', a: 'carts', kind: 'osa', tip: 'Porzucone koszyki z Selly: lista z filtrami, produkty i dane klienta, linki do klienta i zamówienia (tylko odczyt, na Twojej sesji Selly)' },
    { id: 'kupony', title: 'Kupony rabatowe', a: 'rabaty.kuponyRabatowe', kind: 'osa', tip: 'Kupony rabatowe z Selly: lista, karta kuponu, dodawanie i edycja rabatu, ważności i limitów (na Twojej sesji Selly)' },
    { id: 'newsletter', title: 'Newsletter', a: 'newsletter', kind: 'selly' },
    { id: 'sms', title: 'Kampania SMS', a: 'sms.campaign', kind: 'selly' },
    { id: 'partnerzy', title: 'Program partnerski i lojalnościowy', a: 'partners', kind: 'selly' },
    { id: 'powiadomienia', title: 'Powiadomienia o dostępności', a: 'scripts.productsNotifications', kind: 'selly' },
    { id: 'opinie', title: 'Opinie o produktach', a: 'opinie', kind: 'resource' },
    '-',
    { id: 'raporty', title: 'Raporty sprzedaży', a: 'statistics.orders', kind: 'osa', tip: 'Sprzedaż w czasie, produkty, kategorie, klienci i regiony — z porównaniem do poprzedniego okresu, eksport do Excela' },
    { id: 'licencje', title: 'Raport licencji', kind: 'osa', tip: 'Raport licencji członkowskich: przedłużenia, orszaki wg województw (tylko w panelu OSA)' },
    { id: 'wyszukiwarka', title: 'Statystyki wyszukiwarki', a: 'statistics.search', kind: 'selly' },
    { id: 'wizyty', title: 'Śledzenie ostatnich wizyt', a: 'statistics.hits', kind: 'osa', tip: 'Ostatnio wyświetlane strony sklepu: czas, adres IP, strona (tylko podgląd)' },
    { id: 'ankieta', title: 'Ankieta do zamówień', a: 'sondy', kind: 'selly' },
  ] },
  { id: 'narzedzia', title: 'Narzędzia i importy', icon: 'wrench', items: [
    { id: 'pliki', title: 'Menadżer plików', a: 'filemanager', kind: 'osa', tip: 'Przegląd menadżera plików sklepu (tylko podgląd; zarządzanie w Selly)' },
    { id: 'integrator', title: 'Integrator XML/CSV', a: 'integrator', kind: 'osa', tip: 'Przegląd integracji XML/CSV (tylko podgląd; konfiguracja w Selly)' },
    { id: 'integracje-ind', title: 'Integracje indywidualne', a: 'importXML', kind: 'selly' },
    { id: 'import-allegro', title: 'Import produktów z Allegro', a: 'allegro.import', kind: 'selly' },
    { id: 'migracja', title: 'Migracja sklepu', a: 'migrator', kind: 'selly' },
    { id: 'eksport', title: 'Eksport produktów', a: 'exporter', kind: 'selly' },
    '-',
    { id: 'automatyzacje', title: 'Automatyzacje zadań', a: 'automation', kind: 'osa', tip: 'Przegląd automatyzacji zadań (tylko podgląd; zmiany w Selly)' },
    { id: 'ceny-auto', title: 'Automatyzacje zmian cen', a: 'promotionalPrices', kind: 'osa', tip: 'Przegląd automatycznych zmian cen (tylko podgląd; zmiany w Selly)' },
    { id: 'zmiana-cen', title: 'Masowa zmiana cen', a: 'produkty.zmianaCen', kind: 'osa', tip: 'Zmiana cen wielu produktów naraz: ±%, ±kwota, zaokrąglanie, podgląd przed zapisem i cofanie' },
    { id: 'zmiana-danych', title: 'Masowa zmiana danych', a: 'scripts.produktyZmianaDanych', kind: 'osa', tip: 'Dostępność, widoczność, „Nowość” i lokalizacja wielu produktów naraz — z podglądem przed zapisem i cofaniem' },
    { id: 'zmiana-kategorii', title: 'Masowa zmiana kategorii', a: 'scripts.produktyZmianaKategorii', kind: 'osa', tip: 'Przenoszenie wybranych produktów do innej kategorii lub ustawianie producenta — z podglądem i cofaniem' },
    { id: 'usuwanie', title: 'Masowe usuwanie', a: 'scripts.produktyUsun', kind: 'selly' },
    '-',
    { id: 'ai', title: 'Narzędzia AI', a: 'narzedziaAI', kind: 'osa', tip: 'Styl i długość opisów AI oraz dane produktu przekazywane do AI — z podglądem zmian przed zapisem' },
    { id: 'indeksacja', title: 'Ustawienia indeksacji', a: 'scripts.ustawieniaIndeksacji', kind: 'selly' },
    { id: 'przekierowania', title: 'Przekierowania SEO', a: 'redirection', kind: 'osa', tip: 'Przekierowania adresów: lista, edycja i dodawanie (na Twojej sesji Selly)' },
    { id: 'cache', title: 'Czyszczenie pamięci cache', a: 'cache', kind: 'selly' },
    { id: 'ip', title: 'Restrykcje IP', a: 'ipblock', kind: 'selly' },
  ] },
  { id: 'wyglad', title: 'Wygląd i treści', icon: 'palette', items: [
    { id: 'wyglad-konf', title: 'Konfiguracja wyglądu', a: 'configuration.displayOptions', kind: 'osa', tip: 'Zgody cookies: włączenie, układ i pozycja baneru — z podglądem zmian przed zapisem (na Twojej sesji Selly)' },
    { id: 'szablon', title: 'Zarządzanie szablonem', a: 'configuration.templates', kind: 'selly' },
    '-',
    { id: 'cms', title: 'Strony informacyjne', a: 'cms', kind: 'osa', tip: 'Strony sklepu (regulamin, kontakt…): widoczność, SEO i treść HTML z podglądem' },
    { id: 'blog', title: 'Blog', a: 'artykulyAdm', kind: 'resource' },
    { id: 'aktualnosci', title: 'Aktualności', a: 'news', kind: 'osa', tip: 'Aktualności sklepu z Selly: lista i dodawanie nowej (edycja i wycofanie w Selly)' },
    { id: 'slajdy', title: 'Pokaz slajdów', a: 'scripts.slider', kind: 'osa', tip: 'Slajdy strony głównej: pozycja, zdjęcia, odnośnik, czas wyświetlania — z podglądem zmian przed zapisem' },
    '-',
    { id: 'menu-ed', title: 'Edytor menu', a: 'menu.main', kind: 'osa', tip: 'Lista menu sklepu z Selly (podgląd; edycja w Selly)' },
    { id: 'szablony-ed', title: 'Edytor szablonów', a: 'menadzer.templateEditor', kind: 'selly' },
    { id: 'email-ed', title: 'Edytor wiadomości e-mail', a: 'menadzer.emailEditor', kind: 'selly' },
    { id: 'tlumaczenia', title: 'Edytor tłumaczeń', a: 'translations', kind: 'selly' },
    { id: 'bloki', title: 'Edytor bloków HTML', a: 'znaczniki', kind: 'osa', tip: 'Bloki HTML sklepu: opis, widoczność i treść HTML z podglądem' },
    '-',
    { id: 'formularze', title: 'Formularze online', a: 'form.lista', kind: 'osa', tip: 'Zgłoszenia z formularzy sklepu (podgląd listy z filtrami)' },
    { id: 'rejestracja', title: 'Formularze rejestracji', a: 'registerform', kind: 'selly' },
  ] },
  { id: 'konfiguracja', title: 'Konfiguracja', icon: 'sliders', items: [
    { id: 'konf', title: 'Konfiguracja podstawowa', a: 'configuration', kind: 'osa', tip: 'Podgląd ustawień sklepu (dane firmy, faktury, pozycjonowanie, moduły); wartości poufne ukryte, zmiany w Selly' },
    { id: 'smtp', title: 'Konfiguracja e-mail SMTP', a: 'configuration.smtpOptions', kind: 'selly' },
    { id: 'domena', title: 'Konfiguracja domeny', a: 'configuration.changeDomain', kind: 'selly' },
    { id: 'panel-konf', title: 'Konfiguracja panelu', a: 'configuration.panelOptions', kind: 'osa', tip: 'Podgląd ustawień panelu administracyjnego Selly; zmiany w Selly' },
    '-',
    { id: 'statusy', title: 'Statusy zamówień', a: 'statusy', kind: 'resource', tip: 'Lista statusów zamówień (nazwa, pozycja, ID) — podgląd; edycja tylko w Selly (API bez zapisu)' },
    { id: 'statusy-konf', title: 'Statusy zamówień — konfiguracja', a: 'configuration.ordersStatuses', kind: 'osa', tip: 'Kolejność i kolory statusów zamówień — z podglądem zmian przed zapisem; reszta tylko w podglądzie' },
    { id: 'platnosci-formy', title: 'Formy płatności', a: 'platnosci-formy', kind: 'resource', tip: 'Lista form płatności (nazwa, ID) — podgląd; edycja tylko w Selly (API bez zapisu)' },
    { id: 'dostawy', title: 'Formy dostawy', a: 'dostawy', kind: 'resource', tip: 'Lista form dostawy (nazwa, ID) — podgląd; edycja tylko w Selly (API bez zapisu)' },
    { id: 'dostawy-konf', title: 'Formy dostawy — konfiguracja', a: 'configuration.deliveries', kind: 'osa', tip: 'Kolejność i aktywność form dostawy oraz domyślny kraj — z podglądem zmian przed zapisem' },
    '-',
    { id: 'int-porownywarki', title: 'Integracje — porównywarki', a: 'configuration.integracje', kind: 'osa', tip: 'Eksporty do porównywarek: zakres i ceny w podglądzie, włączanie opisów w eksporcie do zmiany' },
    { id: 'int-przesylki', title: 'Integracje — przesyłki', a: 'configuration.shipping', kind: 'osa', tip: 'Podgląd integracji z Apaczką (dane nadawcy ukryte); zmiany w Selly' },
    { id: 'int-fk', title: 'Integracje — programy F/K', a: 'configuration.programsFK', kind: 'osa', tip: 'Podgląd integracji z wFirma (dane dostępowe ukryte); zmiany w Selly' },
    { id: 'int-dodatkowe', title: 'Integracje — dodatkowe', a: 'scripts.integracjaOpcje', kind: 'osa', tip: 'Włączanie narzędzi Google w sklepie (GA4, GTM, remarketing); identyfikatory ukryte' },
    '-',
    { id: 'sms-pow', title: 'Powiadomienia SMS', a: 'sms', kind: 'selly' },
    { id: 'znaki', title: 'Znaki wodne', a: 'watermarks', kind: 'osa', tip: 'Znaki wodne dla nowych zdjęć produktów: pozycja i pokrycie — z podglądem zmian przed zapisem (na Twojej sesji Selly)' },
    { id: 'jezyki', title: 'Języki i waluty', a: 'configuration.localization', kind: 'osa', tip: 'Ukrywanie cen i przycisku „Kupuj”, wybór kraju dostawy; języki i kursy walut tylko w podglądzie (na Twojej sesji Selly)' },
    { id: 'api', title: 'Rest API', a: 'api', kind: 'osa', tip: 'Klucze API: nazwa, zakres, daty, aktywność — bez wartości kluczy (tylko podgląd; zmiany w Selly)' },
    { id: 'frontapi', title: 'Front API — Agentic Commerce', a: 'frontapi', kind: 'osa', tip: 'Stan Front API i statystyki zapytań (tylko podgląd; zmiany w Selly)' },
  ] },
  { id: 'dodatki', title: 'Dodatki i usługi', icon: 'puzzle', items: [
    { id: 'grafika', title: 'Grafika sklepu', a: 'billing.templates', kind: 'selly' },
    { id: 'rozszerzenia', title: 'Rozszerzenia sklepu', a: 'billing.extensions', kind: 'osa', tip: 'Rozszerzenia sklepu wykupione w Selly (tylko podgląd)' },
    { id: 'uslugi', title: 'Usługi dodatkowe', a: 'billing.addons', kind: 'osa', tip: 'Usługi dodatkowe sklepu w Selly (tylko podgląd; zamawianie w Selly)' },
    { id: 'uslugi-partnerow', title: 'Usługi partnerów', a: 'partnerzy', kind: 'osa', tip: 'Usługi partnerów Selly (tylko podgląd)' },
  ] },
  { id: 'konto', title: 'Konto', icon: 'user', items: [
    { id: 'uzytkownicy', title: 'Kto się logował', kind: 'osa', admin: true, tip: 'Konta Selly, które logowały się do panelu OSA, i do czego mają dostęp (tylko administrator; dostęp nadaje się w Selly)' },
    { id: 'selly-zmiany', title: 'Zmiany w Selly', kind: 'osa', admin: true, tip: 'Co zmieniło się w panelu Selly po jego aktualizacjach (wykrywa rozszerzenie; tylko administrator)' },
    { id: 'zgloszenia-osa', title: 'Zgłoszenia z panelu', kind: 'osa', admin: true, tip: 'Uwagi i błędy zgłoszone przyciskiem „Zgłoś” w panelu OSA oraz błędy z przeglądarek (tylko administrator)' },
    '-',
    { id: 'zgloszenia', title: 'Zgłoszenia', a: 'support', kind: 'osa', tip: 'Zgłoszenia do wsparcia Selly: numer, temat, status (tylko podgląd; nowe zgłoszenie w Selly)' },
    { id: 'platnosci', title: 'Płatności', a: 'billing', kind: 'osa', tip: 'Plan abonamentowy, usługi i opłacone faktury Selly (tylko podgląd)' },
    { id: 'zlecenia', title: 'Zlecenia', a: 'billing.settlements', kind: 'osa', tip: 'Godziny pracy i rozliczenia zleceń u Selly (tylko podgląd; zamawianie godzin w Selly)' },
    { id: 'admini', title: 'Konta administratorów Selly', a: 'users', kind: 'osa', tip: 'Lista kont administratorów Selly i ich ostatnie logowania (tylko podgląd; sekrety niewidoczne, zmiany w Selly)' },
    { id: 'grupy', title: 'Grupy użytkowników', a: 'groups', kind: 'osa', tip: 'Grupy kont administratorów i liczba kont (tylko podgląd; zmiany w Selly)' },
    { id: 'uprawnienia', title: 'Uprawnienia', a: 'actions.perm', kind: 'osa', admin: true, tip: 'Edytor uprawnień grup administratorów Selly: wyszukiwanie, szablony („Tylko podgląd”, „Jak inna grupa”), podgląd zmian przed zapisem (tylko administrator)' },
    { id: 'odo', title: 'Dane osobowe', a: 'odo', kind: 'osa', tip: 'Dziennik zdarzeń dotyczących danych osobowych (tylko podgląd)' },
  ] },
];

/** Wszystkie pozycje (bez separatorów), z odnośnikiem do sekcji. */
export const ITEMS = SECTIONS.flatMap(s => s.items.filter(i => i !== '-').map(i => ({ ...i, section: s.id })));
export const itemById = id => ITEMS.find(i => i.id === id) || null;
export const sectionOf = id => { const i = itemById(id); return i ? SECTIONS.find(s => s.id === i.section) : null; };


/** Mapowanie trasy Selly (?a=...) na trasę panelu OSA — dla przekierowań z rozszerzenia. Tylko ekrany OSA. */
export function routeForSelly(a) {
  const i = ITEMS.find(x => x.a === a && (x.kind === 'osa' || x.kind === 'resource'));
  return i ? '/' + i.id : null;
}

// ─── Układ menu bocznego: krótka lista codzienna + zwijane grupy ────────────
// SECTIONS (wyżej) zostaje katalogiem 1:1 z Selly; tu tylko UKŁAD. Nowa pozycja w SECTIONS trafia sama do grupy swojej
// sekcji (GROUPS[].from) — nie trzeba nic dopisywać. Do głównego menu: dopisz id do PRIMARY; inna grupa niż sekcja: GROUP_OF.

/** Główne menu: codzienna praca w małym sklepie, w kolejności częstości użycia (Pulpit jest zawsze nad nimi). label = krótsza nazwa w menu (pełna w tooltipie). */
export const PRIMARY = [
  { id: 'zamowienia', icon: 'receipt' },
  { id: 'speedmail', icon: 'send' },
  { id: 'przesylki', icon: 'truck', label: 'Przesyłki' },
  { id: 'produkty', icon: 'box' },
  { id: 'magazyny', icon: 'warehouse' },
  { id: 'klienci', icon: 'users' },
  { id: 'wplaty', icon: 'bank', label: 'Import wpłat' },
  { id: 'raporty', icon: 'chart' },
  { id: 'licencje', icon: 'badge' },
];

/** Zwijane grupy (kolejność w menu); from = sekcje SECTIONS, których pozycje trafiają do grupy (w tej kolejności). */
export const GROUPS = [
  { id: 'sprzedaz', title: 'Sprzedaż', icon: 'bag', from: ['sprzedaz'], tip: 'Oferty, subskrypcje, dropshipping, przesyłki Furgonetki i Suus, reklamacje, zwroty' },
  { id: 'katalog', title: 'Katalog', icon: 'tag', from: ['asortyment'], tip: 'Kategorie, zestawy, producenci, warianty, tagi, gwarancje i masowe zmiany produktów' },
  { id: 'marketing', title: 'Marketing', icon: 'megaphone', from: ['marketing'], tip: 'Kupony, koszyki, newsletter, SMS, opinie, statystyki sklepu' },
  { id: 'marketplace', title: 'Marketplace', icon: 'store', from: ['marketplace'], tip: 'Allegro, Empik, Erli, Ceneo, Kaufland, TikTok' },
  { id: 'tresci', title: 'Wygląd i treści', icon: 'palette', from: ['wyglad'], tip: 'Wygląd sklepu, strony, blog, slajdy, menu, bloki HTML, formularze, SEO' },
  { id: 'integracje', title: 'Integracje i importy', icon: 'plug', from: ['narzedzia'], tip: 'Integrator XML/CSV, importy, eksport, porównywarki, przesyłki, księgowość, Rest API' },
  { id: 'konfiguracja', title: 'Konfiguracja', icon: 'sliders', from: ['konfiguracja'], tip: 'Ustawienia sklepu: statusy, płatności, dostawy, języki, e-mail, automatyzacje' },
  { id: 'administracja', title: 'Konto i administracja', icon: 'shield', from: ['konto', 'dodatki'], tip: 'Konta i uprawnienia, płatności i zlecenia u Selly, usługi dodatkowe, administracja panelu OSA' },
];

/** Wyjątki: pozycja w innej grupie niż jej sekcja w Selly (dopisywane na końcu grupy). */
export const GROUP_OF = {
  'zmiana-cen': 'katalog', 'zmiana-danych': 'katalog', 'zmiana-kategorii': 'katalog', usuwanie: 'katalog', ai: 'katalog',
  'ceny-auto': 'marketing',
  pliki: 'tresci', przekierowania: 'tresci', indeksacja: 'tresci',
  automatyzacje: 'konfiguracja', cache: 'konfiguracja', ip: 'konfiguracja',
  'int-porownywarki': 'integracje', 'int-przesylki': 'integracje', 'int-fk': 'integracje', 'int-dodatkowe': 'integracje', api: 'integracje', frontapi: 'integracje',
};

/** Synonimy do wyszukiwania w menu: słowa, których ktoś może szukać, i nazwy z panelu Selly (bez polskich znaków też zadziała). */
export const SYNONYMS = {
  zamowienia: 'sprzedaż lista zamówień', speedmail: 'magazyn zewnętrzny SM paczka zleceń stan alert dosyłka korekta tempo sprzedaży prognoza wysyłka', przesylki: 'InPost DPD DHL UPS Orlen paczka paczkomat etykiety nadanie kurier list przewozowy',
  furgonetka: 'kurier przesyłki', suus: 'Rohlig kurier przesyłki', produkty: 'asortyment towary ceny stany', magazyny: 'stany magazynowe inwentaryzacja przesunięcia wydania',
  klienci: 'kontrahenci kupujący odbiorcy', wplaty: 'przelewy bank wyciąg płatności opłacone CSV', raporty: 'statystyki wykresy obroty sprzedaż', licencje: 'członkowie przedłużenia orszaki składki',
  oferty: 'zapytania ofertowe wyceny', subskrypcje: 'abonament cykliczne', dropshipping: 'hurtownia dostawca paczki', reklamacje: 'RMA gwarancja reklamacja', zwroty: 'odstąpienie zwrot towaru',
  kupony: 'rabaty promocje kody rabatowe vouchery zniżki', hurt: 'grupy rabatowe rabaty hurtownia ceny hurtowe', koszyki: 'porzucone koszyki', newsletter: 'mailing subskrybenci e-mail',
  sms: 'kampania SMS wiadomości', partnerzy: 'afiliacja lojalność punkty', opinie: 'recenzje oceny komentarze', powiadomienia: 'dostępność powiadom mnie', ankieta: 'sondy',
  wyszukiwarka: 'frazy szukane statystyki', wizyty: 'odwiedziny ruch statystyki', 'ceny-auto': 'promocje ceny promocyjne',
  kategorie: 'drzewo kategorii', atrybuty: 'atrybuty rozmiary kolory opcje', opisy: 'cechy parametry wzorce cech', gpsr: 'bezpieczeństwo produktu producent odpowiedzialny',
  dostepnosc: 'dostępny niedostępny', tagi: 'etykiety', gwarancje: 'rękojmia', 'zmiana-cen': 'ceny podwyżka obniżka masowo', 'zmiana-danych': 'masowo widoczność dostępność',
  'zmiana-kategorii': 'masowo przenieś kategorie', usuwanie: 'masowo usuń produkty', ai: 'sztuczna inteligencja opisy generowanie',
  allegro: 'aukcje', 'allegro-aukcje': 'aukcje', 'allegro-aukcje-lista': 'aukcje oferty allegro', 'ceneo-mapa': 'kategorie porównywarka', 'ceneo-opinie': 'opinie zaufane',
  'wyglad-konf': 'cookies zgody RODO wygląd', szablon: 'szata graficzna motyw', cms: 'strony regulamin polityka prywatności', blog: 'artykuły wpisy', aktualnosci: 'news wiadomości',
  slajdy: 'slider karuzela', 'menu-ed': 'nawigacja sklepu', 'email-ed': 'szablony wiadomości maile', tlumaczenia: 'języki teksty', bloki: 'znaczniki HTML',
  formularze: 'zgłoszenia formularz kontaktowy', przekierowania: 'redirect 301 SEO adresy', indeksacja: 'SEO Google robots sitemap', pliki: 'zdjęcia obrazki upload',
  konf: 'ustawienia sklepu dane firmy faktury VAT', smtp: 'poczta e-mail serwer', domena: 'adres sklepu DNS', 'panel-konf': 'ustawienia panelu',
  statusy: 'statusy zamówień', 'statusy-konf': 'kolory statusów', 'platnosci-formy': 'płatności przelew pobranie PayU Przelewy24', dostawy: 'kurier koszty wysyłki metody dostawy',
  'dostawy-konf': 'kurier koszty wysyłki metody dostawy', 'sms-pow': 'SMS powiadomienia klienta', znaki: 'watermark zdjęcia', jezyki: 'waluty kursy tłumaczenia',
  automatyzacje: 'reguły automat zadania', cache: 'pamięć podręczna odśwież', ip: 'blokada IP',
  integrator: 'import XML CSV hurtownia', 'integracje-ind': 'import XML', 'import-allegro': 'import', migracja: 'przeniesienie sklepu', eksport: 'eksport XML CSV',
  'int-porownywarki': 'Ceneo porównywarki eksport', 'int-przesylki': 'Apaczka kurier', 'int-fk': 'faktury wFirma księgowość', 'int-dodatkowe': 'Google Analytics GA4 GTM remarketing',
  api: 'klucze API tokeny', frontapi: 'agentic commerce',
  uzytkownicy: 'logowania konta panel OSA', 'selly-zmiany': 'aktualizacje Selly', 'zgloszenia-osa': 'uwagi błędy feedback', zgloszenia: 'support pomoc wsparcie',
  platnosci: 'faktury Selly abonament rachunki', zlecenia: 'godziny pracy rozliczenia', admini: 'użytkownicy konta pracownicy', grupy: 'grupy kont', uprawnienia: 'dostęp role',
  odo: 'RODO dane osobowe', grafika: 'szablon graficzny', rozszerzenia: 'dodatki moduły', uslugi: 'dodatki', 'uslugi-partnerow': 'partnerzy Selly',
};

const SEC_GROUP = Object.fromEntries(GROUPS.flatMap(g => g.from.map(s => [s, g.id])));
const isPrimary = id => PRIMARY.some(p => p.id === id);
/** Grupa pozycji (id grupy) — null dla pozycji głównego menu i nieznanych. */
export const groupOf = id => { const i = itemById(id); return !i || isPrimary(id) ? null : GROUP_OF[id] || SEC_GROUP[i.section] || GROUPS[GROUPS.length - 1].id; };
export const groupById = id => GROUPS.find(g => g.id === id) || null;
/** Słowa do wyszukiwania pozycji (oprócz nazwy): synonimy, nazwa sekcji w Selly, trasa Selly. */
export const keywordsOf = i => [SYNONYMS[i.id] || '', (SECTIONS.find(s => s.id === i.section) || {}).title || '', i.a || ''].join(' ');

/**
 * Model menu (bez DOM — testy jednostkowe): { primary: [pozycja + { icon, label? }], groups: [grupa + { items: [pozycja | '-'] }] }.
 * visible(pozycja) → bool (uprawnienia). Pozycje „w planie” (kind 'soon') są na końcu swojej grupy, nigdy w głównym menu.
 */
export function menuModel(visible) {
  const vis = i => !!i && i.menu !== false && (!visible || visible(i));   // menu:false = tylko przekierowanie (np. dawne listy przewoźników)
  const primary = PRIMARY.map(p => itemById(p.id) && { ...itemById(p.id), icon: p.icon, ...(p.label ? { label: p.label } : {}) }).filter(i => vis(i) && i.kind !== 'soon');
  const taken = new Set(primary.map(i => i.id));
  const groups = GROUPS.map(g => {
    const rows = [];
    for (const sid of g.from) {
      const s = SECTIONS.find(x => x.id === sid);
      if (s) { rows.push('-'); for (const i of s.items) rows.push(i === '-' ? '-' : { ...i, section: s.id }); }
    }
    rows.push('-');
    for (const i of ITEMS) if (GROUP_OF[i.id] === g.id) rows.push(i);
    const mine = i => vis(i) && !taken.has(i.id) && groupOf(i.id) === g.id;
    const soon = rows.filter(i => i !== '-' && mine(i) && i.kind === 'soon');
    const items = rows.filter(i => i === '-' || (mine(i) && i.kind !== 'soon')).concat(soon.length ? ['-', ...soon] : [])
      .filter((i, k, a) => i !== '-' || (a.slice(0, k).some(x => x !== '-') && a[k + 1] && a[k + 1] !== '-'));
    return { ...g, items };
  }).filter(g => g.items.length);
  return { primary, groups };
}

// Ikony (własne, obrys 1.75 px, 24×24) — ścieżki SVG
export const ICONS = {
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  truck: 'M2 6h12v10H2zM14 9h4l3 3v4h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  warehouse: 'M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
  chart: 'M4 20h16M7 16v-4M12 16V7M17 16v-6',
  badge: 'M3 5h18v14H3zM9 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16a3.5 3.5 0 0 1 7 0M15 9h3M15 13h3',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  plug: 'M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  megaphone: 'M4 10v4h3l7 4V6L7 10zM17 9a4 4 0 0 1 0 6',
  wrench: 'M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5a4 4 0 0 0-2-2z',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.6 0-1.2-1-1.6-1-2.6 0-.9.7-1.3 1.7-1.3H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  puzzle: 'M9 4h4v2a1.5 1.5 0 0 0 3 0V4h4v5h-2a1.5 1.5 0 0 0 0 3h2v8h-5v-2a1.5 1.5 0 0 0-3 0v2H4v-6h2a1.5 1.5 0 0 0 0-3H4V4z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  chevronL: 'M15 5l-7 7 7 7',
  chevronR: 'M9 5l7 7-7 7',
  menu: 'M4 6h16M4 12h16M4 18h16',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10',
};

export function icon(name, cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.box);
  svg.append(p);
  return svg;
}
