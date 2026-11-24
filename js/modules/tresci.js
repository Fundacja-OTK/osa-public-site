// Treści (CMS) — natywne ekrany Selly z jednego pliku: strony, aktualności, menu, bloki HTML, formularze online, przekierowania SEO, gwarancje, opisy zaawansowane.
// Lista + karta rekordu na sesji zalogowanego użytkownika (docs/selly-embed.md, docs/auth.md); zapis tylko z allowlisty pól (extension/lib/sellyNative.js, blok „treści (CMS)”).
// Treści HTML (strona, blok) są tylko do odczytu (oczyszczone) z linkiem „Edytuj w Selly ↗”. Usuwania nie ma — zawsze w Selly.
import { createNative } from './sellyNative.js?v=2b127e1';

export const screens = {
  cms: createNative({
    id: 'cms', title: 'Strony informacyjne', screen: 'cms', a: 'cms', recordRoute: 'cms.page', noun: 'strony',
    recordTitle: id => 'Strona nr ' + id,
    labels: { page: 'Nazwa strony', html_title: 'Tytuł (title)', page_h1: 'Nagłówek H1', page_htaccess: 'Adres (URL) strony', html_description: 'Opis dla wyszukiwarek (description)', html_keywords: 'Słowa kluczowe (keywords)',
      meta_noindex: 'Ukryj przed wyszukiwarkami (noindex)', template: 'Szablon', display: 'Strona wyświetlana', html_editor: 'Uruchamiaj edytor HTML przy edycji', for_logged_only: 'Dostępna dla', html_body: 'Treść strony' },
    fieldTips: { meta_noindex: 'Dodaje znacznik noindex — wyszukiwarki nie pokażą tej strony', display: 'Czy strona jest widoczna w sklepie', for_logged_only: 'Czy stronę widzą wszyscy, czy tylko zalogowani klienci', page_htaccess: 'Końcówka adresu strony w sklepie — zmiana zmienia link' },
    headerTips: { 'Id': 'Numer strony w Selly', 'Nazwa strony': 'Nazwa strony informacyjnej', 'Podgląd': 'Link do strony w sklepie', 'Wyświetlanie': 'Czy strona jest widoczna w sklepie', 'Zmodyfikowano': 'Data ostatniej zmiany', 'Działanie': 'Dostępne czynności w Selly' },
  }),
  aktualnosci: createNative({
    id: 'aktualnosci', title: 'Aktualności', screen: 'aktualnosci', a: 'news', recordRoute: null, noun: 'aktualności',
    recordTitle: id => 'Aktualność ' + id,
    headerTips: { 'Id': 'Numer aktualności', 'Data publikacji': 'Od kiedy aktualność jest widoczna', 'Data wycofania': 'Do kiedy jest widoczna (puste = bez końca)', 'Status *': 'Widoczna albo wycofana', 'Autor': 'Kto dodał aktualność', 'Działanie': 'Dostępne czynności w Selly' },
  }),
  'menu-ed': createNative({
    id: 'menu-ed', title: 'Edytor menu', screen: 'menu-ed', a: 'menu.main', recordRoute: null, noun: 'menu',
    recordTitle: id => 'Menu ' + id,
    headerTips: { 'Nazwa': 'Nazwa menu', 'Zmienna w szablonach': 'Nazwa zmiennej, którą szablon sklepu wstawia w tym miejscu', 'Wyświetlanie': 'Czy menu jest włączone' },
  }),
  bloki: createNative({
    id: 'bloki', title: 'Bloki HTML', screen: 'bloki', a: 'znaczniki', recordRoute: 'znaczniki.edycja', noun: 'bloku',
    recordTitle: id => 'Blok nr ' + id,
    labels: { znacznik: 'Znacznik', sklep_id: 'Sklep', opis: 'Opis bloku', tresc: 'Treść bloku', status_aktywny: 'Blok widoczny na stronie', status_edytor: 'Uruchamiaj edytor HTML przy edycji' },
    fieldTips: { status_aktywny: 'Gdy odznaczone, blok znika ze sklepu', status_edytor: 'Tylko wygoda w Selly — nie zmienia wyglądu sklepu' },
    headerTips: { 'Znacznik': 'Nazwa znacznika, którą szablon sklepu zamienia na treść bloku', 'Opis': 'Do czego służy blok', 'Widoczny': 'Czy blok jest włączony w sklepie', 'Zmodyfikowano': 'Data ostatniej zmiany', 'Działanie': 'Dostępne czynności w Selly' },
  }),
  formularze: createNative({
    id: 'formularze', title: 'Formularze online', screen: 'formularze', a: 'form.lista', recordRoute: null, noun: 'zgłoszenia',
    recordTitle: id => 'Zgłoszenie ' + id,
    headerTips: { 'Id': 'Numer zgłoszenia', 'Datazgłoszenia': 'Kiedy klient wysłał formularz', 'Typ formularza': 'Który formularz sklepu został wypełniony', 'IP': 'Adres IP nadawcy', 'Nr zamówienia': 'Zamówienie, którego dotyczy zgłoszenie', 'Status': 'Etap obsługi zgłoszenia', 'Działanie': 'Dostępne czynności w Selly' },
  }),
  przekierowania: createNative({
    id: 'przekierowania', title: 'Przekierowania SEO', screen: 'przekierowania', a: 'redirection', recordRoute: 'redirection.edit', noun: 'przekierowania',
    recordTitle: id => 'Przekierowanie nr ' + id,
    create: { title: 'Nowe przekierowanie', label: 'Dodaj przekierowanie', tip: 'Dodaje przekierowanie ze starego adresu na nowy (po potwierdzeniu, od razu w sklepie)' },
    labels: { match: 'Stary adres', match_action: 'Nowy adres', code: 'Kod przekierowania', group: 'Grupa', 'sklepy[]': 'Sklep podstawowy' },
    fieldTips: { code: '301 = stałe (zalecane dla SEO), 302/303 = tymczasowe', group: 'Grupa przekierowań w Selly', match: 'Adres, który ma być przekierowany' },
    headerTips: { 'Stary adres': 'Adres, który jest przekierowywany', 'Nowy adres': 'Adres docelowy', 'Kod przekierowania': '301 = stałe, 302/303 = tymczasowe', 'Ilość wywołań': 'Ile razy przekierowanie zadziałało', 'Data odpytania': 'Kiedy ostatnio ktoś wszedł na stary adres', 'Działanie': 'Dostępne czynności w Selly' },
  }),
  gwarancje: createNative({
    id: 'gwarancje', title: 'Gwarancje', screen: 'gwarancje', a: 'gwarancje', recordRoute: 'gwarancje.gwarancja', noun: 'gwarancji',
    recordTitle: id => 'Gwarancja nr ' + id,
    labels: { gwarancja: 'Nazwa', gwarancja_typ: 'Typ gwarancji', produkt_id: 'Przypisany produkt', okres_gwarancji: 'Okres gwarancji', stawka_procentowa: 'Stawka procentowa', minimalna_wartosc_produktu: 'Minimalna wartość produktu', maksymalna_wartosc_produktu: 'Maksymalna wartość produktu', rabat_procentowy: 'Rabat procentowy', zerowy_transport: 'Zerowanie kosztu dostawy' },
    fieldTips: { zerowy_transport: 'Opcjonalne zerowanie kosztu dostawy przy tej gwarancji', stawka_procentowa: 'Cena gwarancji jako procent wartości produktu', okres_gwarancji: 'Na jak długo (w miesiącach) wg Selly' },
    headerTips: { 'Id': 'Numer gwarancji', 'Typ': 'Rodzaj gwarancji', 'Okres gwarancji': 'Na jak długo jest gwarancja', 'Wartości produktu': 'Przedział wartości produktu, którego dotyczy', 'Cena gwarancji': 'Ile kosztuje gwarancja', 'Działanie': 'Dostępne czynności w Selly' },
  }),
  opisy: createNative({
    id: 'opisy', title: 'Opisy zaawansowane', screen: 'opisy', a: 'wzorceCech', recordRoute: 'wzorceCech.edit', noun: 'wzorca',
    recordTitle: id => 'Wzorzec cechy nr ' + id,
    labels: { nazwa: 'Nazwa', opis: 'Opis', jednostka: 'Jednostka', grupa_cech_id: 'Grupa cech' },
    fieldTips: { jednostka: 'Jednostka podawana przy wartości cechy (np. cm, kg)', grupa_cech_id: 'W której grupie cech wzorzec jest pokazywany' },
    headerTips: {},
  }),
};
