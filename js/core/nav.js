// Katalog menu panelu OSA: wszystkie sekcje panelu Selly (docs/selly-admin-map.md) + dodatki OSA.
// Pozycja: { id, title, a?, kind, tip?, admin? }
//   kind 'osa'      — własny ekran panelu OSA (moduł o tym id)
//   kind 'resource' — ekran uniwersalny (lista / karta / formularz ze specyfikacji API; modules/zasob.js)
//   kind 'soon'     — Selly ma API, ekran OSA w planie; do tego czasu strona z linkiem do Selly
//   kind 'selly'    — tylko panel Selly (brak API) — otwiera Selly w nowej karcie
//   a — trasa panelu Selly (?a=...), do linku „otwórz w Selly” i przekierowań z rozszerzenia
// '-' w liście pozycji = separator grupy.

export const SECTIONS = [
  { id: 'sprzedaz', title: 'Sprzedaż', icon: 'bag', items: [
    { id: 'zamowienia', title: 'Zamówienia', a: 'zamowienia', kind: 'osa', tip: 'Lista zamówień, karta z edycją, statusy (także masowo), eksport' },
    { id: 'oferty', title: 'Oferty', a: 'offersAdm', kind: 'selly' },
    { id: 'subskrypcje', title: 'Subskrypcje', a: 'subskrypcje', kind: 'resource' },
    '-',
    { id: 'dropshipping', title: 'Dropshipping', a: 'zamowienia.dropshipping', kind: 'soon' },
    { id: 'klienci', title: 'Klienci', a: 'klienci', kind: 'osa', tip: 'Lista klientów, karta, zamówienia klienta, notatki' },
    { id: 'wplaty', title: 'Import wpłat bankowych', a: 'zamowienia.importWplat', kind: 'soon', tip: 'W planie: import wyciągu z banku i automatyczne oznaczanie opłaconych zamówień' },
    '-',
    { id: 'przesylki', title: 'Przesyłki — do nadania', a: 'inpost.listOrders', kind: 'osa', tip: 'Kolejka zamówień do nadania u wszystkich przewoźników naraz (InPost, DPD, DHL, Orlen Paczka, UPS), masowe etykiety' },
    { id: 'furgonetka', title: 'Przesyłki Furgonetka.pl', a: 'furgonetka.przesylki', kind: 'selly' },
    { id: 'suus', title: 'Przesyłki Suus', a: 'suus.przesylki', kind: 'selly' },
    '-',
    { id: 'reklamacje', title: 'Reklamacje', a: 'reklamacje', kind: 'selly' },
    { id: 'zwroty', title: 'Zwroty', a: 'zwroty', kind: 'resource' },
  ] },
  { id: 'marketplace', title: 'Marketplace', icon: 'store', items: [
    { id: 'allegro', title: 'Allegro', a: 'allegro.auctionsDB', kind: 'soon', tip: 'W planie: podgląd aukcji Allegro (API Selly daje tylko odczyt)' },
    { id: 'empik', title: 'Empik', a: 'marketplace', kind: 'selly' },
    { id: 'erli', title: 'Erli', a: 'marketplace', kind: 'selly' },
    { id: 'ceneo', title: 'Ceneo', a: 'marketplace', kind: 'selly' },
    { id: 'kaufland', title: 'Kaufland', a: 'marketplace', kind: 'selly' },
    { id: 'tiktok', title: 'TikTok', a: 'marketplace', kind: 'selly' },
  ] },
  { id: 'asortyment', title: 'Asortyment', icon: 'box', items: [
    { id: 'produkty', title: 'Produkty', a: 'produkty', kind: 'osa', tip: 'Lista produktów, stany, ceny, karta produktu' },
    { id: 'zestawy', title: 'Zestawy', a: 'zestawy', kind: 'resource' },
    { id: 'kategorie', title: 'Kategorie', a: 'kategorie', kind: 'resource' },
    { id: 'magazyny', title: 'Magazyny', a: 'magazyny', kind: 'osa', tip: 'Stany fizyczne, wydania do zamówień, przesunięcia, inwentaryzacja, wysyłka SpeedMail' },
    { id: 'producenci', title: 'Producenci', a: 'producenci', kind: 'resource' },
    '-',
    { id: 'gpsr', title: 'Dane GPSR', a: 'bezpieczenstwoProduktu', kind: 'selly' },
    { id: 'dostepnosc', title: 'Statusy dostępności', a: 'configuration.productsAvailability', kind: 'selly' },
    { id: 'hurt', title: 'Sprzedaż hurtowa', a: 'rabaty.grupyRabatowe', kind: 'selly' },
    { id: 'atrybuty', title: 'Warianty i opcje', a: 'produkty.atrybutyGrupy', kind: 'resource' },
    { id: 'opisy', title: 'Opisy zaawansowane', a: 'wzorceCech', kind: 'selly' },
    { id: 'tagi', title: 'Tagi', a: 'tags', kind: 'resource' },
    { id: 'ksztalty', title: 'Kształty produktów', a: 'configuration.shapes', kind: 'selly' },
    { id: 'gwarancje', title: 'Gwarancje', a: 'gwarancje', kind: 'selly' },
  ] },
  { id: 'marketing', title: 'Marketing', icon: 'megaphone', items: [
    { id: 'koszyki', title: 'Koszyki', a: 'carts', kind: 'selly' },
    { id: 'kupony', title: 'Kupony rabatowe', a: 'rabaty.kuponyRabatowe', kind: 'selly' },
    { id: 'newsletter', title: 'Newsletter', a: 'newsletter', kind: 'selly' },
    { id: 'sms', title: 'Kampania SMS', a: 'sms.campaign', kind: 'selly' },
    { id: 'partnerzy', title: 'Program partnerski i lojalnościowy', a: 'partners', kind: 'selly' },
    { id: 'powiadomienia', title: 'Powiadomienia o dostępności', a: 'scripts.productsNotifications', kind: 'selly' },
    { id: 'opinie', title: 'Opinie o produktach', a: 'opinie', kind: 'resource' },
    '-',
    { id: 'raporty', title: 'Raporty sprzedaży', a: 'statistics.orders', kind: 'soon', tip: 'W planie: raporty sprzedaży liczone z zamówień (szybciej i z filtrami OSA)' },
    { id: 'licencje', title: 'Raport licencji', kind: 'osa', tip: 'Raport licencji członkowskich: przedłużenia, orszaki wg województw (tylko w panelu OSA)' },
    { id: 'wyszukiwarka', title: 'Statystyki wyszukiwarki', a: 'statistics.search', kind: 'selly' },
    { id: 'wizyty', title: 'Śledzenie ostatnich wizyt', a: 'statistics.hits', kind: 'selly' },
    { id: 'ankieta', title: 'Ankieta do zamówień', a: 'sondy', kind: 'selly' },
  ] },
  { id: 'narzedzia', title: 'Narzędzia i importy', icon: 'wrench', items: [
    { id: 'pliki', title: 'Menadżer plików', a: 'filemanager', kind: 'selly' },
    { id: 'integrator', title: 'Integrator XML/CSV', a: 'integrator', kind: 'selly' },
    { id: 'integracje-ind', title: 'Integracje indywidualne', a: 'importXML', kind: 'selly' },
    { id: 'import-allegro', title: 'Import produktów z Allegro', a: 'allegro.import', kind: 'selly' },
    { id: 'migracja', title: 'Migracja sklepu', a: 'migrator', kind: 'selly' },
    { id: 'eksport', title: 'Eksport produktów', a: 'exporter', kind: 'selly' },
    '-',
    { id: 'automatyzacje', title: 'Automatyzacje zadań', a: 'automation', kind: 'selly' },
    { id: 'ceny-auto', title: 'Automatyzacje zmian cen', a: 'promotionalPrices', kind: 'selly' },
    { id: 'zmiana-cen', title: 'Masowa zmiana cen', a: 'produkty.zmianaCen', kind: 'soon', tip: 'W planie: masowa zmiana cen z podglądem zmian przed zapisem' },
    { id: 'zmiana-danych', title: 'Masowa zmiana danych', a: 'scripts.produktyZmianaDanych', kind: 'soon', tip: 'W planie: masowa zmiana danych produktów z podglądem przed zapisem' },
    { id: 'zmiana-kategorii', title: 'Masowa zmiana kategorii', a: 'scripts.produktyZmianaKategorii', kind: 'soon' },
    { id: 'usuwanie', title: 'Masowe usuwanie', a: 'scripts.produktyUsun', kind: 'selly' },
    '-',
    { id: 'ai', title: 'Narzędzia AI', a: 'narzedziaAI', kind: 'selly' },
    { id: 'indeksacja', title: 'Ustawienia indeksacji', a: 'scripts.ustawieniaIndeksacji', kind: 'selly' },
    { id: 'przekierowania', title: 'Przekierowania SEO', a: 'redirection', kind: 'selly' },
    { id: 'cache', title: 'Czyszczenie pamięci cache', a: 'cache', kind: 'selly' },
    { id: 'ip', title: 'Restrykcje IP', a: 'ipblock', kind: 'selly' },
  ] },
  { id: 'wyglad', title: 'Wygląd i treści', icon: 'palette', items: [
    { id: 'wyglad-konf', title: 'Konfiguracja wyglądu', a: 'configuration.displayOptions', kind: 'selly' },
    { id: 'szablon', title: 'Zarządzanie szablonem', a: 'configuration.templates', kind: 'selly' },
    '-',
    { id: 'cms', title: 'Strony informacyjne', a: 'cms', kind: 'selly' },
    { id: 'blog', title: 'Blog', a: 'artykulyAdm', kind: 'resource' },
    { id: 'aktualnosci', title: 'Aktualności', a: 'news', kind: 'selly' },
    { id: 'slajdy', title: 'Pokaz slajdów', a: 'scripts.slider', kind: 'selly' },
    '-',
    { id: 'menu-ed', title: 'Edytor menu', a: 'menu.main', kind: 'selly' },
    { id: 'szablony-ed', title: 'Edytor szablonów', a: 'menadzer.templateEditor', kind: 'selly' },
    { id: 'email-ed', title: 'Edytor wiadomości e-mail', a: 'menadzer.emailEditor', kind: 'selly' },
    { id: 'tlumaczenia', title: 'Edytor tłumaczeń', a: 'translations', kind: 'selly' },
    { id: 'bloki', title: 'Edytor bloków HTML', a: 'znaczniki', kind: 'selly' },
    '-',
    { id: 'formularze', title: 'Formularze online', a: 'form.lista', kind: 'selly' },
    { id: 'rejestracja', title: 'Formularze rejestracji', a: 'registerform', kind: 'selly' },
  ] },
  { id: 'konfiguracja', title: 'Konfiguracja', icon: 'sliders', items: [
    { id: 'konf', title: 'Konfiguracja podstawowa', a: 'configuration', kind: 'selly' },
    { id: 'smtp', title: 'Konfiguracja e-mail SMTP', a: 'configuration.smtpOptions', kind: 'selly' },
    { id: 'domena', title: 'Konfiguracja domeny', a: 'configuration.changeDomain', kind: 'selly' },
    { id: 'panel-konf', title: 'Konfiguracja panelu', a: 'configuration.panelOptions', kind: 'selly' },
    '-',
    { id: 'statusy', title: 'Statusy zamówień', a: 'configuration.ordersStatuses', kind: 'selly' },
    { id: 'platnosci-formy', title: 'Formy płatności', a: 'configuration.payments', kind: 'selly' },
    { id: 'dostawy', title: 'Formy dostawy', a: 'configuration.deliveries', kind: 'selly' },
    '-',
    { id: 'int-porownywarki', title: 'Integracje — porównywarki', a: 'configuration.integracje', kind: 'selly' },
    { id: 'int-przesylki', title: 'Integracje — przesyłki', a: 'configuration.shipping', kind: 'selly' },
    { id: 'int-fk', title: 'Integracje — programy F/K', a: 'configuration.programsFK', kind: 'selly' },
    { id: 'int-dodatkowe', title: 'Integracje — dodatkowe', a: 'scripts.integracjaOpcje', kind: 'selly' },
    '-',
    { id: 'sms-pow', title: 'Powiadomienia SMS', a: 'sms', kind: 'selly' },
    { id: 'znaki', title: 'Znaki wodne', a: 'watermarks', kind: 'selly' },
    { id: 'jezyki', title: 'Języki i waluty', a: 'configuration.localization', kind: 'selly' },
    { id: 'api', title: 'Rest API', a: 'api', kind: 'selly' },
    { id: 'frontapi', title: 'Front API — Agentic Commerce', a: 'frontapi', kind: 'selly' },
  ] },
  { id: 'dodatki', title: 'Dodatki i usługi', icon: 'puzzle', items: [
    { id: 'grafika', title: 'Grafika sklepu', a: 'billing.templates', kind: 'selly' },
    { id: 'rozszerzenia', title: 'Rozszerzenia sklepu', a: 'billing.extensions', kind: 'selly' },
    { id: 'uslugi', title: 'Usługi dodatkowe', a: 'billing.addons', kind: 'selly' },
    { id: 'uslugi-partnerow', title: 'Usługi partnerów', a: 'partnerzy', kind: 'selly' },
  ] },
  { id: 'konto', title: 'Konto', icon: 'user', items: [
    { id: 'uzytkownicy', title: 'Dostęp do panelu OSA', kind: 'osa', admin: true, tip: 'Kto może logować się do panelu OSA (tylko administrator)' },
    { id: 'selly-zmiany', title: 'Zmiany w Selly', kind: 'osa', admin: true, tip: 'Co zmieniło się w panelu Selly po jego aktualizacjach (wykrywa rozszerzenie; tylko administrator)' },
    { id: 'zgloszenia-osa', title: 'Zgłoszenia z panelu', kind: 'osa', admin: true, tip: 'Uwagi i błędy zgłoszone przyciskiem „Zgłoś” w panelu OSA oraz błędy z przeglądarek (tylko administrator)' },
    '-',
    { id: 'zgloszenia', title: 'Zgłoszenia', a: 'support', kind: 'selly' },
    { id: 'platnosci', title: 'Płatności', a: 'billing', kind: 'selly' },
    { id: 'zlecenia', title: 'Zlecenia', a: 'billing.settlements', kind: 'selly' },
    { id: 'admini', title: 'Konta administratorów Selly', a: 'users', kind: 'selly' },
    { id: 'grupy', title: 'Grupy użytkowników', a: 'groups', kind: 'selly' },
    { id: 'uprawnienia', title: 'Uprawnienia', a: 'actions.perm', kind: 'selly' },
    { id: 'odo', title: 'Dane osobowe', a: 'odo', kind: 'selly' },
  ] },
];

/** Wszystkie pozycje (bez separatorów), z odnośnikiem do sekcji. */
export const ITEMS = SECTIONS.flatMap(s => s.items.filter(i => i !== '-').map(i => ({ ...i, section: s.id })));
export const itemById = id => ITEMS.find(i => i.id === id) || null;
export const sectionOf = id => { const i = itemById(id); return i ? SECTIONS.find(s => s.id === i.section) : null; };

/** Domyślne skróty („Moje skróty”), dopóki użytkownik nie przypnie własnych. */
export const DEFAULT_PINS = ['zamowienia', 'produkty', 'klienci', 'magazyny', 'licencje'];

/** Mapowanie trasy Selly (?a=...) na trasę panelu OSA — dla przekierowań z rozszerzenia. Tylko ekrany OSA. */
export function routeForSelly(a) {
  const i = ITEMS.find(x => x.a === a && (x.kind === 'osa' || x.kind === 'resource'));
  return i ? '/' + i.id : null;
}

// Ikony (własne, obrys 1.75 px, 24×24) — ścieżki SVG
export const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
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
