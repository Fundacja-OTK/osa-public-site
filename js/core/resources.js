// Definicje uniwersalnych zasobów Selly (ekran js/modules/zasob.js): lista → karta → dodawanie / edycja / usuwanie.
// Pola i nazwy pochodzą ze specyfikacji Selly REST API (OpenAPI 1.11, https://www.selly.pl/rest-api/); pole, którego spec nie potwierdza,
// jest pominięte albo tylko do odczytu. Backend ma własną białą listę pól (worker/src/modules/resources.js) — test pilnuje zgodności.
//
// Zasób: { id, a (trasa Selly), idField, one/many/addLabel (PL), canCreate/canEdit/canDelete, tree?, searchHint, columns, sections,
//          filters?, noGet?, items?, defaultSort }
// Kolumna: { key, label, tip, num?, type?: 'bool'|'date'|'enum'|'ref', sort? (domyślnie true), options?, ref? }
// Pole formularza: { key, label, type: text|textarea|html|number|money|bool|select|date|ref|rows, options?, ref?, required?, help?, readOnly?, wide? }

const YESNO = [[1, 'tak'], [0, 'nie']];
const flag = (key, label, help, extra) => ({ key, label, type: 'bool', help, ...extra });
const VISIBLE = [['sklep', 'sklep'], ['partner', 'partner'], ['18lat', '18 lat'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ['s' + n, 'sklep dodatkowy ' + n])];

export const RESOURCES = {
  kategorie: {
    id: 'kategorie', a: 'kategorie', idField: 'category_id', one: 'kategoria', many: 'Kategorie', addLabel: 'Dodaj kategorię', newTitle: 'Nowa kategoria',
    canCreate: true, canEdit: true, canDelete: true, tree: true, titleField: 'name', defaultSort: null,
    searchHint: 'Szukaj kategorii po nazwie lub adresie',
    deleteWarn: 'Produkty w tej kategorii i jej podkategorie mogą zostać bez kategorii — sprawdź to w Selly przed usunięciem.',
    columns: [
      { key: 'name', label: 'Nazwa', tip: 'Nazwa kategorii; wcięcie pokazuje, że to podkategoria (drzewo kategorii). Kliknij nagłówek, aby posortować płasko.', tree: true },
      { key: 'url_rewrite', label: 'Adres (URL)', tip: 'Końcówka adresu strony kategorii w sklepie' },
      { key: 'visible', label: 'Widoczność', tip: 'Gdzie kategoria jest widoczna (wartość „visible” z Selly: sklep, partner, 18 lat albo sklep dodatkowy)' },
      { key: 'category_id', label: 'ID', tip: 'Numer kategorii w Selly', num: true },
    ],
    sections: [
      { title: 'Podstawowe', fields: [
        { key: 'name', label: 'Nazwa', type: 'text', required: true, help: 'Nazwa kategorii widoczna w sklepie i w menu' },
        { key: 'parent_id', label: 'Kategoria nadrzędna', type: 'ref', ref: 'kategorie', rootLabel: '— główna (bez kategorii nadrzędnej) —', tree: true,
          help: 'Wybierz, pod którą kategorią ma się znaleźć ta kategoria. „Główna” = najwyższy poziom.' },
        { key: 'url_rewrite', label: 'Adres (URL)', type: 'text', help: 'Końcówka adresu strony kategorii (np. „kubki”). Puste = Selly utworzy sam z nazwy.' },
        { key: 'visible', label: 'Widoczność', type: 'select', options: VISIBLE, help: 'Dla kogo / w którym sklepie kategoria jest widoczna (wartość z Selly)' },
      ] },
      { title: 'Opisy', fields: [
        { key: 'description', label: 'Opis nad listą produktów', type: 'html', wide: true, help: 'Opis (HTML) wyświetlany nad produktami kategorii' },
        { key: 'description2', label: 'Opis pod listą produktów', type: 'html', wide: true, help: 'Opis (HTML) wyświetlany pod produktami kategorii' },
        { key: 'productTitle', label: 'Tytuł produktów', type: 'text', help: 'Nagłówek nad listą produktów w kategorii' },
      ] },
      { title: 'SEO', advanced: true, fields: [
        { key: 'metaTitle', label: 'Tytuł strony (meta title)', type: 'text', help: 'Tytuł w wynikach wyszukiwarek' },
        { key: 'metaDescription', label: 'Opis strony (meta description)', type: 'textarea', help: 'Krótki opis w wynikach wyszukiwarek' },
        { key: 'h1', label: 'Nagłówek H1', type: 'text', help: 'Główny nagłówek strony kategorii' },
      ] },
    ],
  },

  producenci: {
    id: 'producenci', a: 'producenci', idField: 'producer_id', one: 'producent', many: 'Producenci', addLabel: 'Dodaj producenta', newTitle: 'Nowy producent',
    canCreate: true, canEdit: true, canDelete: true, titleField: 'name', defaultSort: { key: 'name', dir: 'asc' },
    searchHint: 'Szukaj producenta po nazwie',
    deleteWarn: 'Produkty tego producenta stracą przypisanie do producenta.',
    columns: [
      { key: 'name', label: 'Nazwa', tip: 'Nazwa producenta' },
      { key: 'show_on_home', label: 'Na stronie głównej', tip: 'Czy producent jest pokazywany na stronie głównej sklepu', type: 'bool' },
      { key: 'free_delivery_from', label: 'Darmowa dostawa od', tip: 'Wartość zamówienia, od której dostawa produktów tego producenta jest darmowa', num: true, type: 'money' },
      { key: 'url_rewrite', label: 'Adres (URL)', tip: 'Końcówka adresu strony producenta' },
      { key: 'producer_id', label: 'ID', tip: 'Numer producenta w Selly', num: true },
    ],
    sections: [
      { title: 'Podstawowe', fields: [
        { key: 'name', label: 'Nazwa', type: 'text', required: true, help: 'Nazwa producenta' },
        { key: 'image_url', label: 'Logo (adres)', type: 'text', readOnly: true, help: 'Adres logo producenta. Logo zmienisz w panelu Selly (przesyłanie plików nie jest jeszcze w panelu OSA).' },
        flag('show_on_home', 'Pokaż na stronie głównej', 'Czy producent ma być pokazywany na stronie głównej sklepu'),
        { key: 'url_rewrite', label: 'Adres (URL)', type: 'text', help: 'Końcówka adresu strony producenta' },
        { key: 'promotion_text', label: 'Tekst promocyjny', type: 'text', help: 'Krótki tekst promocyjny przy produktach producenta' },
      ] },
      { title: 'Dostawa', fields: [
        { key: 'free_delivery_from', label: 'Darmowa dostawa od (zł)', type: 'money', help: 'Wartość zamówienia, od której dostawa jest darmowa' },
        { key: 'delivery_time_for_available_product', label: 'Czas dostawy — produkt dostępny (dni)', type: 'number', help: 'Liczba dni dostawy dla produktów dostępnych' },
        { key: 'delivery_time_for_unavailable_product', label: 'Czas dostawy — produkt niedostępny (dni)', type: 'number', help: 'Liczba dni dostawy dla produktów niedostępnych' },
      ] },
      { title: 'Opisy', fields: [
        { key: 'page_products_description', label: 'Opis nad produktami', type: 'html', wide: true, help: 'Opis (HTML) na stronie producenta, nad listą produktów' },
        { key: 'description_below_products', label: 'Opis pod produktami', type: 'html', wide: true, help: 'Opis (HTML) na stronie producenta, pod listą produktów' },
        { key: 'show_description_type', label: 'Sposób pokazywania opisu', type: 'select', options: [[0, '0'], [1, '1']], help: 'Wartość „show_description_type” z Selly (0 albo 1); znaczenie zależy od szablonu sklepu' },
      ] },
      { title: 'Marże wg poziomów cen', advanced: true, fields: [1, 2, 3, 4, 5].map(n => ({ key: 'commission_' + n, label: 'Marża — poziom cen ' + n, type: 'number',
        help: 'Pole „commission_' + n + '” z Selly. Wpisz −1, aby wyłączyć.' })) },
      { title: 'SEO', advanced: true, fields: [
        { key: 'html_title', label: 'Tytuł strony', type: 'text', help: 'Tytuł strony producenta w wyszukiwarkach' },
        { key: 'html_title_add_shop_name', label: 'Dodaj nazwę sklepu do tytułu', type: 'text', help: 'Pole „html_title_add_shop_name” z Selly (wartość tekstowa)' },
        { key: 'html_description', label: 'Opis strony', type: 'textarea', help: 'Opis w wynikach wyszukiwarek' },
        { key: 'html_keywords', label: 'Słowa kluczowe', type: 'text', help: 'Słowa kluczowe strony' },
        { key: 'html_h1', label: 'Nagłówek H1', type: 'text', help: 'Główny nagłówek strony producenta' },
      ] },
    ],
  },

  tagi: {
    id: 'tagi', a: 'tags', idField: 'tag_id', one: 'tag', many: 'Tagi', addLabel: 'Dodaj tag', newTitle: 'Nowy tag',
    canCreate: true, canEdit: true, canDelete: true, titleField: 'name', defaultSort: { key: 'name', dir: 'asc' },
    searchHint: 'Szukaj tagu — nazwa zaczyna się od wpisanych liter',
    searchTip: 'Selly szuka tagów, których nazwa ZACZYNA SIĘ od wpisanego tekstu',
    deleteWarn: 'Tag zostanie odpięty od wszystkich produktów.',
    columns: [
      { key: 'name', label: 'Nazwa', tip: 'Nazwa tagu' },
      { key: 'slug', label: 'Adres (slug)', tip: 'Końcówka adresu strony tagu; tworzona z nazwy, jeśli nie podano' },
      { key: 'display', label: 'Widoczny', tip: 'Czy tag jest wyświetlany w sklepie', type: 'bool' },
      { key: 'meta_noindex', label: 'Bez indeksowania', tip: 'Czy strona tagu ma być ukryta przed wyszukiwarkami (noindex)', type: 'bool' },
      { key: 'tag_id', label: 'ID', tip: 'Numer tagu w Selly', num: true },
    ],
    sections: [
      { title: 'Podstawowe', fields: [
        { key: 'name', label: 'Nazwa', type: 'text', required: true, help: 'Nazwa tagu' },
        { key: 'slug', label: 'Adres (slug)', type: 'text', help: 'Końcówka adresu strony tagu. Puste = Selly utworzy z nazwy.' },
        flag('display', 'Widoczny w sklepie', 'Czy tag jest wyświetlany w sklepie'),
        flag('meta_noindex', 'Ukryj przed wyszukiwarkami (noindex)', 'Strona tagu nie będzie indeksowana przez wyszukiwarki'),
      ] },
      { title: 'Opisy', fields: [
        { key: 'description', label: 'Opis nad listą produktów', type: 'html', wide: true, help: 'Opis (HTML) nad listą produktów tagu' },
        { key: 'description2', label: 'Opis pod listą produktów', type: 'html', wide: true, help: 'Opis (HTML) pod listą produktów tagu' },
      ] },
      { title: 'SEO', advanced: true, fields: [
        { key: 'html_title', label: 'Tytuł strony', type: 'text', help: 'Tytuł strony tagu w wyszukiwarkach' },
        { key: 'html_description', label: 'Opis strony', type: 'textarea', help: 'Opis w wynikach wyszukiwarek' },
        { key: 'html_keywords', label: 'Słowa kluczowe', type: 'text', help: 'Słowa kluczowe strony' },
      ] },
    ],
  },

  atrybuty: {
    id: 'atrybuty', a: 'produkty.atrybutyGrupy', idField: 'attribute_id', one: 'grupa wariantów', many: 'Warianty i opcje', addLabel: 'Dodaj grupę', newTitle: 'Nowa grupa wariantów i opcji',
    canCreate: true, canEdit: true, canDelete: true, titleField: 'name', defaultSort: { key: 'position', dir: 'asc' },
    searchHint: 'Szukaj grupy po nazwie',
    deleteWarn: 'Razem z grupą znikną jej wartości, a produkty z tymi wariantami mogą przestać działać poprawnie.',
    columns: [
      { key: 'name', label: 'Nazwa grupy', tip: 'Nazwa grupy wariantów lub opcji (np. „Rozmiar”, „Kolor”)' },
      { key: 'position', label: 'Kolejność', tip: 'Pozycja grupy na liście — mniejsza liczba = wyżej', num: true, firstDir: 'asc' },
      { key: 'filter_enabled', label: 'Filtr w sklepie', tip: 'Czy i jak grupa jest filtrem w sklepie (pole „filter_enabled” z Selly)', type: 'enum',
        options: [[0, 'nie'], [1, 'tak — lista rozwijalna'], [2, 'tak — pole wyboru']] },
      { key: 'attribute_id', label: 'ID', tip: 'Numer grupy w Selly', num: true },
    ],
    sections: [
      { title: 'Grupa', fields: [
        { key: 'name', label: 'Nazwa grupy', type: 'text', required: true, help: 'Np. „Rozmiar”, „Kolor”' },
        { key: 'position', label: 'Kolejność', type: 'number', help: 'Pozycja grupy na liście — mniejsza liczba = wyżej' },
        { key: 'filter_enabled', label: 'Filtr w sklepie', type: 'select', options: [[0, 'nie'], [1, 'tak — wybór jednej wartości, lista rozwijalna'], [2, 'tak — pole wyboru']],
          help: 'Czy grupa jest filtrem w sklepie. Wg dokumentacji Selly wartość 2 oznacza pole wyboru (radio albo checkbox).' },
        { key: 'description', label: 'Opis', type: 'textarea', wide: true, help: 'Opis grupy' },
        flag('do_not_show_in_configuration', 'Nie pokazuj w konfiguratorze opcji', 'Grupa nie będzie widoczna w konfiguratorze opcji produktu'),
      ] },
    ],
    items: { title: 'Wartości w grupie', noun: 'wartość', addLabel: 'Dodaj wartość', idField: 'attribute_id',
      columns: [{ key: 'name', label: 'Nazwa', tip: 'Nazwa wartości (np. „XL”, „czerwony”)' }, { key: 'position', label: 'Kolejność', tip: 'Pozycja wartości — mniejsza liczba = wyżej', num: true }] },
  },

  zestawy: {
    id: 'zestawy', a: 'zestawy', idField: 'set_id', one: 'zestaw', many: 'Zestawy', addLabel: null, canCreate: false, canEdit: false, canDelete: false, titleField: 'name',
    defaultSort: null, searchHint: 'Szukaj zestawu na bieżącej stronie (nazwa, kod)',
    readOnlyNote: 'Zestawy są w panelu OSA tylko do podglądu. Tworzenie i edycję (skład, ceny) zrobisz w panelu Selly.',
    columns: [
      { key: 'name', label: 'Nazwa', tip: 'Nazwa zestawu' },
      { key: 'product_code', label: 'Kod', tip: 'Kod produktu (zestaw jest w Selly produktem)' },
      { key: 'price', label: 'Cena', tip: 'Cena zestawu (brutto), zł', num: true, type: 'money' },
      { key: 'quantity', label: 'Stan', tip: 'Dostępna ilość (wszystkie magazyny zsumowane)', num: true },
      { key: 'visible', label: 'Widoczny', tip: 'Czy zestaw jest widoczny w sklepie', type: 'bool' },
      { key: 'set_id', label: 'ID', tip: 'Numer zestawu w Selly', num: true },
    ],
    sections: [
      { title: 'Zestaw', fields: [
        { key: 'name', label: 'Nazwa', type: 'text', readOnly: true },
        { key: 'product_code', label: 'Kod produktu', type: 'text', readOnly: true },
        { key: 'price', label: 'Cena (zł)', type: 'money', readOnly: true, help: 'Cena zestawu; stała albo wyliczana ze składników (zależnie od „sposobu liczenia ceny”)' },
        { key: 'price_type', label: 'Sposób liczenia ceny', type: 'select', readOnly: true, options: [[0, 'stała cena zestawu'], [1, 'zależna od cen składników']], help: 'Pole „price_type” z Selly' },
        { key: 'discount_type', label: 'Rodzaj rabatu', type: 'text', readOnly: true, help: 'Pole „discount_type” z Selly (procent albo kwota)' },
        { key: 'discount_value', label: 'Wartość rabatu', type: 'number', readOnly: true },
        { key: 'quantity', label: 'Stan (szt.)', type: 'number', readOnly: true },
        { key: 'visible', label: 'Widoczny w sklepie', type: 'bool', readOnly: true },
        { key: 'kit', label: 'Zestaw (kit)', type: 'bool', readOnly: true, help: 'Pole „kit” z Selly' },
        { key: 'category_id', label: 'Kategoria (ID)', type: 'text', readOnly: true },
        { key: 'producer_id', label: 'Producent (ID)', type: 'text', readOnly: true },
      ] },
      { title: 'Składniki zestawu', fields: [
        { key: 'products', label: 'Produkty w zestawie', type: 'rows', wide: true, readOnly: true,
          columns: [{ key: 'product_id', label: 'ID produktu', tip: 'Numer produktu w Selly' }, { key: 'variant_id', label: 'ID wariantu', tip: 'Numer wariantu (0 = bez wariantu)' },
            { key: 'quantity', label: 'Ilość', tip: 'Ilość tego produktu w jednym zestawie', num: true }] },
      ] },
    ],
  },

  zwroty: {
    id: 'zwroty', a: 'zwroty', idField: 'return_id', one: 'zwrot', many: 'Zwroty', addLabel: null, canCreate: false, canEdit: false, canDelete: false, noGet: true, titleField: 'return_number',
    defaultSort: null, searchHint: 'Wpisz numer zamówienia (np. 1/2026), aby znaleźć zwrot',
    searchTip: 'Selly szuka po dokładnym numerze zamówienia, np. 1/2026',
    readOnlyNote: 'Zwroty są w panelu OSA tylko do podglądu (Selly API udostępnia je tylko do odczytu). Statusy zwrotów zmienisz w panelu Selly.',
    columns: [
      { key: 'return_number', label: 'Numer zwrotu', tip: 'Numer zwrotu nadany w Selly' },
      { key: 'created_at', label: 'Data', tip: 'Data zgłoszenia zwrotu', type: 'date' },
      { key: 'order_number', label: 'Zamówienie', tip: 'Numer zamówienia, którego dotyczy zwrot' },
      { key: 'email', label: 'E-mail', tip: 'E-mail osoby zgłaszającej zwrot' },
      { key: 'status_id', label: 'Status', tip: 'Numer statusu zwrotu w Selly (nazwy statusów zwrotów zmienisz w panelu Selly)', num: true },
    ],
    sections: [
      { title: 'Zwrot', fields: [
        { key: 'return_number', label: 'Numer zwrotu', type: 'text', readOnly: true }, { key: 'return_code', label: 'Kod zwrotu', type: 'text', readOnly: true },
        { key: 'created_at', label: 'Data zgłoszenia', type: 'text', readOnly: true }, { key: 'status_id', label: 'Status (numer)', type: 'text', readOnly: true },
        { key: 'order_number', label: 'Numer zamówienia', type: 'text', readOnly: true }, { key: 'order_id', label: 'ID zamówienia', type: 'text', readOnly: true },
        { key: 'buy_place', label: 'Miejsce zakupu', type: 'text', readOnly: true }, { key: 'buy_place_other', label: 'Miejsce zakupu (inne)', type: 'text', readOnly: true },
        { key: 'allegro_login', label: 'Login Allegro', type: 'text', readOnly: true }, { key: 'buy_at', label: 'Data zakupu', type: 'text', readOnly: true },
        { key: 'doc_number', label: 'Numer dokumentu', type: 'text', readOnly: true }, { key: 'iban', label: 'Rachunek do zwrotu', type: 'text', readOnly: true },
        { key: 'reason', label: 'Powód zwrotu', type: 'textarea', wide: true, readOnly: true }, { key: 'attenction', label: 'Uwagi', type: 'textarea', wide: true, readOnly: true,
          help: 'Pole „attenction” (tak w Selly) — uwagi do zwrotu' },
      ] },
      { title: 'Zgłaszający', fields: [
        { key: 'firstname', label: 'Imię', type: 'text', readOnly: true }, { key: 'lastname', label: 'Nazwisko', type: 'text', readOnly: true },
        { key: 'email', label: 'E-mail', type: 'text', readOnly: true }, { key: 'phone', label: 'Telefon', type: 'text', readOnly: true },
        { key: 'address', label: 'Adres', type: 'text', readOnly: true }, { key: 'postcode', label: 'Kod pocztowy', type: 'text', readOnly: true }, { key: 'city', label: 'Miasto', type: 'text', readOnly: true },
      ] },
    ],
  },

  subskrypcje: {
    id: 'subskrypcje', a: 'subskrypcje', idField: 'subscription_id', one: 'subskrypcja', many: 'Subskrypcje', addLabel: null, canCreate: false, canEdit: true, canDelete: false, titleField: 'number',
    defaultSort: null, searchHint: 'Szukaj na bieżącej stronie (numer, e-mail, nazwisko)',
    readOnlyNote: null,
    editNote: 'Zmiany zapisują się w Selly bez powiadamiania klienta. Subskrypcji nie można tu dodać ani usunąć (API Selly na to nie pozwala); pozycje subskrypcji są tylko do podglądu.',
    filters: [{ key: 'status_id', label: 'Status', type: 'ref', ref: 'statusy', tip: 'Pokaż tylko subskrypcje o wybranym statusie zamówienia' }],
    columns: [
      { key: 'number', label: 'Numer', tip: 'Numer subskrypcji z panelu Selly, np. 12/2026' },
      { key: 'email', label: 'E-mail', tip: 'E-mail klienta subskrypcji' },
      { key: 'status_id', label: 'Status', tip: 'Status subskrypcji ze słownika statusów zamówień. Status „Anulowane” (10) zatrzymuje wywoływanie subskrypcji.', type: 'ref', ref: 'statusy' },
      { key: 'period', label: 'Okres', tip: 'Jak często subskrypcja tworzy zamówienie', type: 'enum', options: [] },
      { key: 'next_date', label: 'Następne wywołanie', tip: 'Dzień, w którym subskrypcja utworzy kolejne zamówienie (0000-00-00 = brak)' },
      { key: 'run_count', label: 'Zamówień', tip: 'Ile zamówień utworzyła już ta subskrypcja', num: true },
    ],
    sections: [
      { title: 'Subskrypcja', fields: [
        { key: 'number', label: 'Numer', type: 'text', readOnly: true }, { key: 'date', label: 'Utworzona', type: 'text', readOnly: true },
        { key: 'status_id', label: 'Status', type: 'ref', ref: 'statusy', help: 'Zmienia tylko status „Anulowane” (10) — subskrypcja przestaje być wywoływana. Pozostałe statusy są informacyjne.' },
        { key: 'period', label: 'Okres', type: 'select', options: [['1', 'co poniedziałek'], ['2', 'co wtorek'], ['3', 'co środę'], ['4', 'co czwartek'], ['5', 'co piątek'], ['14', 'co poniedziałek i czwartek'],
          ['P1M', 'co miesiąc'], ['P2M', 'co 2 miesiące'], ['P3M', 'co 3 miesiące'], ['P6M', 'co 6 miesięcy'], ['P12M', 'co 12 miesięcy']], help: 'Dozwolone tylko okresy wspólne dla wszystkich produktów subskrypcji' },
        { key: 'next_date', label: 'Następne wywołanie', type: 'date', help: 'Od jutra. Wartość 0000-00-00 oznacza brak zaplanowanego wywołania.' },
        { key: 'run_count', label: 'Utworzone zamówienia', type: 'text', readOnly: true }, { key: 'minimum_months', label: 'Minimalny czas (mies.)', type: 'text', readOnly: true },
        { key: 'parent_order_id', label: 'Zamówienie źródłowe (ID)', type: 'text', readOnly: true }, { key: 'last_order_id', label: 'Ostatnie zamówienie (ID)', type: 'text', readOnly: true },
      ] },
      { title: 'Płatność i dostawa', fields: [
        { key: 'payment_price', label: 'Koszt płatności (zł)', type: 'money', help: 'Najwyżej 2 miejsca po przecinku' },
        { key: 'delivery_id', label: 'Forma dostawy', type: 'ref', ref: 'dostawy', help: 'Forma dostawy przypisana do sklepu subskrypcji' },
        { key: 'delivery_price', label: 'Koszt dostawy (zł)', type: 'money', help: 'Najwyżej 2 miejsca po przecinku' },
        { key: 'invoice_type', label: 'Dokument', type: 'select', options: [['faktura', 'faktura'], ['paragon', 'paragon']] },
      ] },
      { title: 'Kontakt i uwagi', fields: [
        { key: 'email', label: 'E-mail', type: 'text' }, { key: 'phone', label: 'Telefon', type: 'text' },
        { key: 'order_attention', label: 'Uwagi dla personelu', type: 'textarea', wide: true },
      ] },
      { title: 'Adres wysyłki', fields: [
        { key: 'ship_company', label: 'Firma', type: 'text' }, { key: 'ship_nip', label: 'NIP', type: 'text', help: 'Zapisuje też NIP do faktury' },
        { key: 'ship_first_name', label: 'Imię', type: 'text' }, { key: 'ship_last_name', label: 'Nazwisko', type: 'text' },
        { key: 'ship_address', label: 'Ulica i numer', type: 'text' }, { key: 'ship_postcode', label: 'Kod pocztowy', type: 'text' }, { key: 'ship_city', label: 'Miasto', type: 'text' },
      ] },
      { title: 'Dane do faktury', fields: [
        { key: 'invoice_company', label: 'Firma', type: 'text' }, { key: 'invoice_first_name', label: 'Imię', type: 'text' }, { key: 'invoice_last_name', label: 'Nazwisko', type: 'text' },
        { key: 'invoice_address', label: 'Ulica i numer', type: 'text' }, { key: 'invoice_postcode', label: 'Kod pocztowy', type: 'text' }, { key: 'invoice_city', label: 'Miasto', type: 'text' },
      ] },
      { title: 'Pozycje subskrypcji', fields: [
        { key: 'products', label: 'Produkty', type: 'rows', wide: true, readOnly: true,
          columns: [{ key: 'name', label: 'Nazwa', tip: 'Nazwa produktu' }, { key: 'quantity', label: 'Ilość', tip: 'Ilość w jednym zamówieniu', num: true },
            { key: 'price_with_tax', label: 'Cena brutto', tip: 'Cena jednostkowa brutto po rabacie (zł)', num: true, type: 'money' }, { key: 'variant_features', label: 'Wariant', tip: 'Wybrany wariant produktu' }] },
      ] },
    ],
  },

  opinie: {
    id: 'opinie', a: 'opinie', idField: 'review_id', one: 'opinia', many: 'Opinie o produktach', addLabel: null, canCreate: false, canEdit: false, canDelete: false, noGet: true, titleField: 'signature',
    defaultSort: { key: 'created_at', dir: 'desc' }, searchHint: 'Szukaj na bieżącej stronie (treść, podpis)',
    readOnlyNote: 'Opinie są w panelu OSA tylko do podglądu: lista opinii z Selly API nie podaje, do którego produktu należy opinia, więc nie da się jej bezpiecznie edytować ani usunąć. Moderacja — w panelu Selly.',
    filters: [{ key: 'active', label: 'Widoczność', type: 'select', options: [[1, 'tylko wyświetlane'], [0, 'tylko ukryte']], tip: 'Pokaż tylko opinie wyświetlane albo ukryte w sklepie' },
      { key: 'rate', label: 'Ocena', type: 'select', options: [[5, '5 gwiazdek'], [4, '4 gwiazdki'], [3, '3 gwiazdki'], [2, '2 gwiazdki'], [1, '1 gwiazdka']], tip: 'Pokaż tylko opinie z wybraną oceną' }],
    columns: [
      { key: 'created_at', label: 'Data', tip: 'Data dodania opinii', type: 'date' },
      { key: 'rate', label: 'Ocena', tip: 'Ocena w skali 1–5', type: 'stars', num: true },
      { key: 'text', label: 'Treść', tip: 'Treść opinii (skrót)', type: 'excerpt' },
      { key: 'signature', label: 'Podpis', tip: 'Podpis autora opinii' },
      { key: 'active', label: 'Wyświetlana', tip: 'Czy opinia jest widoczna w sklepie', type: 'bool' },
    ],
    sections: [
      { title: 'Opinia', fields: [
        { key: 'created_at', label: 'Data dodania', type: 'text', readOnly: true }, { key: 'rate', label: 'Ocena (1–5)', type: 'text', readOnly: true },
        { key: 'signature', label: 'Podpis', type: 'text', readOnly: true }, { key: 'active', label: 'Wyświetlana w sklepie', type: 'bool', readOnly: true },
        { key: 'ip', label: 'Adres IP autora', type: 'text', readOnly: true, help: 'Adres IP, z którego dodano opinię' },
        { key: 'text', label: 'Treść', type: 'textarea', wide: true, readOnly: true },
      ] },
    ],
  },

  blog: {
    id: 'blog', a: 'artykulyAdm', idField: 'id', one: 'wpis', many: 'Blog', addLabel: 'Dodaj wpis', newTitle: 'Nowy wpis na blogu', canCreate: true, canEdit: true, canDelete: true, titleField: 'title',
    defaultSort: null, searchHint: 'Szukaj wpisu po tytule', searchTip: 'Selly szuka we wpisach po tytule',
    deleteWarn: 'Zostaną usunięte także wersje językowe wpisu, powiązania i zdjęcie.',
    columns: [
      { key: 'title', label: 'Tytuł', tip: 'Tytuł wpisu' },
      { key: 'active', label: 'Opublikowany', tip: 'Czy wpis jest widoczny na blogu', type: 'bool' },
      { key: 'pinned', label: 'Przypięty', tip: 'Czy wpis jest przypięty na stronie głównej', type: 'bool' },
      { key: 'published_at', label: 'Data publikacji', tip: 'Data publikacji wpisu', type: 'date' },
      { key: 'id', label: 'ID', tip: 'Numer wpisu w Selly', num: true },
    ],
    sections: [
      { title: 'Treść', fields: [
        { key: 'title', label: 'Tytuł', type: 'text', required: true, wide: true, help: 'Tytuł wpisu' },
        { key: 'excerpt', label: 'Zajawka', type: 'textarea', wide: true, help: 'Krótki skrót wpisu pokazywany na liście' },
        { key: 'content', label: 'Treść', type: 'html', wide: true, help: 'Treść wpisu (HTML)' },
        { key: 'image', label: 'Zdjęcie wyróżniające (adres)', type: 'text', readOnly: true, help: 'Zdjęcie zmienisz w panelu Selly (przesyłanie plików nie jest jeszcze w panelu OSA)' },
        { key: 'image_alt', label: 'Opis zdjęcia (alt)', type: 'text', help: 'Opis alternatywny zdjęcia wyróżniającego' },
      ] },
      { title: 'Publikacja', fields: [
        flag('active', 'Opublikowany', 'Czy wpis jest widoczny na blogu'),
        flag('pinned', 'Przypięty na stronie głównej', 'Wpis jest przypięty na stronie głównej sklepu'),
        flag('comments_enabled', 'Komentarze włączone', 'Czy czytelnicy mogą komentować wpis'),
        flag('logged_in_only', 'Tylko dla zalogowanych', 'Wpis widoczny tylko dla zalogowanych klientów'),
        { key: 'published_at', label: 'Data publikacji', type: 'text', readOnly: true }, { key: 'modified_at', label: 'Ostatnia zmiana', type: 'text', readOnly: true },
        { key: 'lang_id', label: 'Wersja językowa', type: 'text', readOnly: true }, { key: 'shops', label: 'Sklepy (ID)', type: 'text', readOnly: true, help: 'Lista identyfikatorów sklepów, w których wpis jest widoczny' },
      ] },
      { title: 'Adres i SEO', advanced: true, fields: [
        { key: 'slug', label: 'Adres (slug)', type: 'text', help: 'Końcówka adresu wpisu. Puste = Selly utworzy z tytułu.' },
        { key: 'html_title', label: 'Tytuł strony', type: 'text' }, { key: 'html_description', label: 'Opis strony', type: 'textarea' }, { key: 'html_keywords', label: 'Słowa kluczowe', type: 'text' },
      ] },
    ],
  },
};

/** Pola zapisywalne zasobu (bez readOnly i rows) — używane przy zapisie i w teście zgodności z backendem. */
export const writableKeys = def => def.sections.flatMap(s => s.fields).filter(f => !f.readOnly && f.type !== 'rows').map(f => f.key);
export const getResource = id => RESOURCES[id] || null;
export { YESNO };
