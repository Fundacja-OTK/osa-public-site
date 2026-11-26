// WYGENEROWANE z shared/panelAuth.js i shared/native/*.js przez scripts/sync-parser.sh — nie edytuj ręcznie.

globalThis.OSA_NATIVE_ACCESS = {"gpsr":{"access":"write"},"produkt-gpsr":{"access":"write"},"produkt-opcje":{"access":"write","perm":["produkty"]},"produkt-wymiary":{"access":"write","perm":["produkty"]},"produkt-historia-ceny":{"access":"read","perm":["produkty"]},"produkt-zdarzenia":{"access":"read","perm":["produkty"]},"produkt-polecane":{"access":"read","perm":["produkty"]},"produkt-kategorie-dod":{"access":"read","perm":["produkty"]},"produkt-ceny-indyw":{"access":"read","perm":["produkty"]},"produkt-subskrypcje":{"access":"read","perm":["produkty"]},"produkt-aukcje":{"access":"read","perm":["produkty"]},"gwarancje":{"access":"write"},"opisy":{"access":"write"},"dostepnosc":{"access":"write"},"ksztalty":{"access":"write"},"uslugi":{"access":"read"},"uslugi-partnerow":{"access":"read"},"rozszerzenia":{"access":"read"},"int-apaczka":{"access":"read"},"int-furgonetka":{"access":"read"},"int-inpost":{"access":"read"},"int-orlen":{"access":"read"},"int-dpd":{"access":"read"},"int-ups":{"access":"read"},"int-dhl":{"access":"read"},"int-schenker":{"access":"read"},"int-suus":{"access":"read"},"int-gls":{"access":"read"},"int-wfirma":{"access":"read"},"int-ifirma":{"access":"read"},"int-fakturownia":{"access":"read"},"int-pcmarket":{"access":"read"},"int-subiekt":{"access":"read"},"int-wfmag":{"access":"read"},"int-apilo":{"access":"read"},"int-baselinker":{"access":"read"},"int-head":{"access":"read"},"int-google":{"access":"read"},"int-facebook":{"access":"read"},"int-edrone":{"access":"read"},"int-salesmanago":{"access":"read"},"int-webepartners":{"access":"read"},"int-pragmago":{"access":"read"},"int-subskrypcje":{"access":"read"},"int-raty":{"access":"read"},"int-opineo":{"access":"read"},"int-okazjeinfo":{"access":"read"},"int-trustisto":{"access":"read"},"int-trustmate":{"access":"read"},"int-eopisy":{"access":"read"},"int-easyprotect":{"access":"read"},"hurt":{"access":"write"},"tlumaczenia":{"access":"write"},"klient-blokada":{"access":"write"},"klient-limit":{"access":"write"},"klienci-grupy":{"access":"write"},"klient-notatka":{"access":"write"},"klienci-notatki":{"access":"read"},"klient-rabaty-prod":{"access":"write"},"klient-producenci":{"access":"read"},"subkonta-uprawnienia":{"access":"write"},"api":{"access":"read"},"frontapi":{"access":"read"},"konf":{"access":"read"},"panel-konf":{"access":"read"},"znaki":{"access":"write"},"jezyki":{"access":"write"},"int-porownywarki":{"access":"write"},"int-przesylki":{"access":"read"},"int-fk":{"access":"read"},"int-dodatkowe":{"access":"write"},"dostawy-konf":{"access":"write"},"statusy-konf":{"access":"write"},"admini":{"access":"read"},"grupy":{"access":"read"},"uprawnienia":{"access":"read"},"odo":{"access":"read"},"zgloszenia":{"access":"read"},"platnosci":{"access":"read"},"zlecenia":{"access":"read"},"wizyty":{"access":"read"},"kupony":{"access":"write"},"koszyki":{"access":"read"},"koszyki-powiadomienia":{"access":"read"},"kupony-auto":{"access":"write"},"newsletter":{"access":"read"},"powiadomienia":{"access":"read"},"partnerzy":{"access":"read"},"partnerzy-prowizje":{"access":"read"},"partnerzy-konf":{"access":"read"},"ankieta":{"access":"read"},"wyszukiwarka":{"access":"read"},"allegro":{"access":"read"},"allegro-aukcje":{"access":"write"},"empik":{"access":"read"},"allegro-aukcje-lista":{"access":"read"},"allegro-zdarzenia":{"access":"read"},"allegro-wysylka":{"access":"write"},"allegro-operatorzy":{"access":"write"},"allegro-szablony":{"access":"read"},"ceneo-opinie":{"access":"write"},"ceneo-mapa":{"access":"read"},"pliki":{"access":"read"},"automatyzacje":{"access":"read"},"ceny-auto":{"access":"read"},"integrator":{"access":"read"},"przekierowania":{"access":"write"},"ai":{"access":"write"},"reklamacje":{"access":"write"},"reklamacje-zdarzenia":{"access":"read"},"reklamacje-statusy":{"access":"read"},"zwroty-obsluga":{"access":"write","perm":["zwroty"]},"zwroty-zdarzenia":{"access":"read","perm":["zwroty"]},"zwroty-statusy":{"access":"read","perm":["zwroty"]},"oferty":{"access":"write"},"furgonetka":{"access":"read"},"suus":{"access":"read"},"zamowienie-karta":{"access":"write","perm":["zamowienia"]},"cms":{"access":"write"},"aktualnosci":{"access":"write"},"menu-ed":{"access":"write"},"bloki":{"access":"write"},"formularze":{"access":"read"},"rejestracja":{"access":"write"},"blog-kategorie":{"access":"write"},"blog-tagi":{"access":"write"},"blog-komentarze":{"access":"read"},"przekierowania-grupy":{"access":"write"},"wyglad-konf":{"access":"write"},"slajdy":{"access":"write"}};   // WYGENEROWANE z shared/native/*.js (scripts/sync-parser.sh)
/**
 * Panel OSA — uprawnienia z sesji Selly (wspólne dla Workera, Apps Script i frontendu panelu).
 * Źródło: shared/panelAuth.js; kopie generuje scripts/sync-parser.sh:
 *   panel/backend/PanelAuth.gs          (Apps Script, wspólny zakres globalny)
 *   panel/worker/src/lib/panelAuth.js   (moduł ES)
 *   panel/app/js/lib/panelAuth.js       (moduł ES, przeglądarka)
 * Nie edytuj kopii ręcznie. Opis całości: docs/auth.md. Testy: tests/unit/panelAuth.test.js.
 *
 * Model:
 *   - Przy logowaniu Worker otwiera (GET, bez skutków ubocznych) stronę Selly każdej sekcji z SECTION_ROUTES sesją użytkownika.
 *     Przekierowanie na ekran logowania = brak uprawnienia w Selly (tak Selly traktuje strony zabronione). Wynik: lista sekcji (perms).
 *   - Sekcje pochodne (DERIVED) wynikają z innych (np. „Raport licencji” = zamówienia + klienci).
 *   - Administrator panelu: dostęp do „Konta administratorów” w Selly (ADMIN_ROUTE) albo login z ADMIN_LOGINS (konfiguracja).
 *   - Każda akcja API ma regułę (RULES): które sekcje ją dopuszczają. Akcja bez reguły = odmowa.
 *     Zapisy wymagają sekcji „domowej”, odczyty — dowolnej sekcji, która z tych danych korzysta (np. lista produktów w karcie zamówienia).
 *   - Prawo ZAPISU (write) — decyzja właściciela (docs/auth.md → „Prawo zapisu”): zapisy przez API Selly (token sklepu) tylko dla
 *     administratorów panelu i dla loginów, którym administrator nadał zgodę na sekcję w panelu (panel_write_grants) — Selly nie daje
 *     wiarygodnego sygnału prawa zapisu bez wysłania formularza. Natywne ekrany (SESSION_WRITE) zapisują sesją użytkownika, więc tam
 *     sprawdza samo Selly i w panelu wystarcza podgląd. Akcja zapisu (isWriteAction) wymaga prawa zapisu sekcji.
 */
(() => {
  // Sekcja panelu → trasa Selly, którą sprawdzamy (tylko strony do podglądu; actionSafety.isSafeRouteName)
  const SECTION_ROUTES = {
    zamowienia: 'zamowienia',
    dropshipping: 'zamowienia.dropshipping',
    klienci: 'klienci',
    przesylki: 'inpost.listOrders',
    produkty: 'produkty',
    magazyny: 'magazyny',
    raporty: 'statistics.orders',
    'zmiana-cen': 'produkty.zmianaCen',
    'zmiana-danych': 'scripts.produktyZmianaDanych',
    'zmiana-kategorii': 'scripts.produktyZmianaKategorii',
    subskrypcje: 'subskrypcje',
    zwroty: 'zwroty',
    zestawy: 'zestawy',
    kategorie: 'kategorie',
    producenci: 'producenci',
    atrybuty: 'produkty.atrybutyGrupy',
    tagi: 'tags',
    opinie: 'opinie',
    blog: 'artykulyAdm',
    // Natywne ekrany Selly (Reklamacje, Oferty, treści, konfiguracja…) NIE są tu sprawdzane — działają na sesji Selly użytkownika,
    // więc odczyt i zapis egzekwuje sam Selly (NATIVE_SCREENS niżej). Sondy logowania tylko dla sekcji z danymi z API (token sklepu).
  };
  // Sekcje z sondą podglądu, których zapis idzie sesją użytkownika w Selly. Dziś pusta: wszystkie natywne ekrany (także Reklamacje i Oferty)
  // mają regułę NATIVE (NATIVE_SCREENS niżej) zamiast sondy logowania — ich zapis sprawdza Selly, bez zgód administratora (panel_write_grants).
  const SESSION_WRITE = [];
  // Sekcje, na które administrator może nadać zgodę na zmiany (zapisy przez API Selly tokenem sklepu); reszta to odczyty / natywne ekrany
  const GRANTABLE = ['zamowienia', 'dropshipping', 'klienci', 'przesylki', 'produkty', 'magazyny', 'zmiana-cen', 'zmiana-danych', 'zmiana-kategorii',
    'subskrypcje', 'zwroty', 'zestawy', 'kategorie', 'producenci', 'atrybuty', 'tagi', 'opinie', 'blog', 'wplaty', 'faktury'];
  // Strona sekcji przekierowuje w Selly na stronę tego samego modułu, która też jest podglądem (potwierdzone na prawdziwym Selly)
  const VIEW_REDIRECTS = { kategorie: ['kategorie.edycja'] };
  // Sekcje tylko z odczytami (zapis nieszkodliwy, np. „Odśwież dane” = synchronizacja) — zapis = podgląd
  const READONLY_SECTIONS = ['licencje', 'pulpit', 'raporty'];
  // Klasyfikacja akcji — JAWNE listy (bez zgadywania po końcówce nazwy). Akcja spoza READ_ACTIONS = zapis (fail closed: wymaga prawa zmian).
  // Test: tests/unit/actionClassification.test.js — każda akcja z kodu (Worker, Apps Script, frontend) jest na dokładnie jednej liście.
  // Uwaga: mag:moves DODAJE ruchy magazynowe (Warehouses.gs addMoves) — to zapis; historia ruchów przychodzi w mag:init.
  const READ_ACTIONS = [
    'init', 'whoami', 'report', 'orszaki', 'changes', 'refresh', 'auth:refresh', 'auth:perms',
    'orders:list', 'orders:resolve', 'orders:get', 'orders:meta', 'orders:invoices', 'orders:stamp', 'orders:refresh', 'orders:invoiceList', 'orders:invoiceScan', 'orders:invoiceTodo',
    // wystawianie faktur: podgląd faktury wypełnionej przez Selly (GET formularza sesją użytkownika, nic nie wysyła)
    'invoices:issueForm',
    // karta zamówienia: pola bez zapisu w API (formularz Selly zamowienia.view na sesji użytkownika, tylko odczyt; ekran natywny zamowienie-karta)
    'orders:cardForm',
    'clients:list', 'clients:get', 'clients:meta', 'clients:addresses', 'clients:affiliate', 'clients:extra', 'clients:groups', 'clients:prices', 'clients:emailsExist',
    'products:list', 'products:get', 'products:facets', 'products:dicts', 'products:extra', 'products:warehouses',
    'shipping:meta', 'shipping:queue', 'shipping:label', 'shipping:manualForm', 'shipping:inspect',
    'dropshipping:list', 'dropshipping:get',
    'payments:candidates',
    'reports:sales', 'reports:years', 'reports:product', 'reports:profit', 'reports:families', 'reports:familyYears', 'reports:productSearch', 'reports:compare',
    'dashboard:get', 'ceneo:overview',
    'bulk:list', 'bulk:get', 'bulk:meta', 'bulk:preview', 'bulk:select',
    'mag:init', 'mag:orders', 'mag:settled',
    'sm:init', 'sm:list', 'sm:get', 'sm:pace', 'sm:history', 'sm:shipMatch',
    // stany wg Selly per magazyn (kopia D1) i podgląd startu; mag:sellyRefresh — jak orders:invoiceScan: tylko odczyt w Selly, porcja ≤ 15, budżet minutowy
    'mag:sellyStock', 'mag:sellyPreview', 'mag:sellyRefresh', 'mag:sellyLive',
    'res:list', 'res:get', 'res:options',
    'native:read',
    // edytor uprawnień grup Selly (Konto → Uprawnienia): lista grup i macierz modułów — strony Selly sesją użytkownika, tylko administrator panelu
    'perms:groups', 'perms:read', 'perms:cached',
    'feedback:list', 'client:errors:list', 'client:exits:list', 'health:get', 'logins:list', 'map:latest', 'map:history',
    // Strażnik Selly: stan pilnowanych stron i znalezione trasy (same nazwy) — tylko administrator
    'guard:status',
  ];
  const WRITE_ACTIONS = [
    'auth:logout', 'feedback:send', 'feedback:status', 'client:errors', 'client:exits', 'grants:set', 'map:report', 'map:retry',
    'orders:setStatus', 'orders:update', 'orders:addItem', 'orders:updateItem', 'orders:create', 'orders:invoiceUpdate',
    // ustawienia listy zamówień wspólne dla sklepu (kolory komentarzy, nazwy poziomów cen) — tylko D1, tylko administrator
    'orders:prefsSave',
    'clients:save', 'clients:create', 'clients:update', 'clients:setBlock', 'clients:addressSave', 'clients:addressDelete', 'clients:affiliateAdd',
    'clients:affiliateDelete', 'clients:groupName', 'clients:priceSave', 'clients:priceDelete', 'clients:noteDelete',
    'products:create', 'products:update', 'products:duplicate', 'products:setCategories', 'products:setFeatures', 'products:setMeta', 'products:setStock',
    'products:variantUpdate', 'products:photoAdd', 'products:photoUpdate', 'products:photoDelete',
    'products:variantAdd', 'products:variantDelete', 'products:stockAdd', 'products:stockRemove', 'products:delete', 'products:warehouseSave',
    'shipping:create', 'shipping:setMap', 'shipping:manualCreate', 'shipping:inspectSave', 'shipping:inspectApprove',
    // Furgonetka (tryb dwuetapowy): wycena POST getPrices na sesji Selly — nic nie zamawia, ale to krok przed płatnym utworzeniem (prawo zmian Przesyłek)
    'shipping:manualQuote',
    'dropshipping:save', 'dropshipping:delete', 'dropshipping:productsAdd', 'dropshipping:productSave', 'dropshipping:productDelete',
    'payments:apply', 'payments:undo',
    'bulk:start', 'bulk:step', 'bulk:pause', 'bulk:resume', 'bulk:stop', 'bulk:undo',
    'mag:moves', 'mag:packs', 'mag:confirm',
    'sm:configSave', 'sm:recount', 'sm:mark', 'sm:keep', 'sm:batch', 'sm:cancel', 'sm:move',
    'mag:sellyStart',
    'res:save', 'res:delete', 'res:itemSave', 'res:itemDelete', 'res:marginsSave',
    'reports:familySave',
    'native:save', 'native:create', 'native:delete',
    'perms:save',
    // wystawienie faktury formularzem Selly (dokument księgowy: prawo zmian „Wystawianie faktur” — administrator albo zgoda; opId, blokada duplikatu)
    'invoices:issue',
    // karta zamówienia formularzem Selly (opiekun, data sprzedaży, paczka…): zapis tylko zmienionych pól, opId; usuwanie pozycji: administrator + Zamówienia
    'orders:cardSave', 'orders:itemDelete',
    // Strażnik Selly: ponowne automatyczne sprawdzenie strony (kasuje wzorzec; obejście diagnostyczne, tylko administrator)
    'guard:reset',
  ];
  const READ_SET = new Set(READ_ACTIONS);

  // „Konta administratorów” w Selly — kto tam wchodzi, zarządza kontami Selly, więc jest też administratorem panelu OSA
  const ADMIN_ROUTE = 'users';
  // Sekcje bez własnej strony w Selly: dostęp, gdy użytkownik ma wszystkie wymienione
  const DERIVED = {
    licencje: ['zamowienia', 'klienci'],
    wplaty: ['zamowienia'],          // import wpłat: dopasowanie wpłat do zamówień i oznaczanie opłaconych
    pulpit: ['zamowienia'],
    speedmail: ['zamowienia', 'magazyny'],   // kreator wysyłki do SpeedMail: statusy zamówień (Selly) + ruchy magazynu SM
    // wystawianie faktur z panelu (modules/invoiceIssue.js): podgląd z zamówień; WYSTAWIENIE (zapis) tylko administrator albo login ze zgodą „faktury”
    // (GRANTABLE) — osobno od zgody na zamówienia, bo to dokument księgowy z numeracją
    faktury: ['zamowienia'],
  };
  // Sekcje tylko dla administratora panelu
  const ADMIN_SECTIONS = ['uzytkownicy', 'selly-zmiany', 'straznik-selly', 'zgloszenia-osa', 'uprawnienia'];
  // Słowniki (res:*) czytelne dla każdego zalogowanego — potrzebne w formularzach innych sekcji
  const DICTS = ['kategorie', 'producenci', 'tagi', 'atrybuty', 'statusy', 'dostawy', 'platnosci-formy'];

  // === Natywne ekrany Selly (definicje: shared/native/<obszar>.js → SCREENS w shared/sellyNative.js; test: tests/unit/nativeEngine.test.js) ===
  // Działają na sesji Selly zalogowanego użytkownika — Selly sam egzekwuje podgląd i zapis (brak uprawnień = ekran logowania / przekierowanie /
  // odmowa zapisu → kod 'login' z jasnym komunikatem). Dlatego NIE są sondami logowania (SECTION_ROUTES / WRITE_ROUTES) — oszczędza ~100 zapytań.
  // Reguła NATIVE: native:read / native:save / native:create dla ekranu z listy wolno każdej KOMPLETNEJ sesji (sprawdzanie uprawnień zakończone);
  // ekrany z NATIVE_READ_ONLY odrzucają zapis i dodawanie już tutaj (403), niezależnie od silnika (który też je odrzuca); ekran z `perm`
  // wymaga dodatkowo jednej z tych sekcji. Listy WYLICZANE z wpisów (access: 'read' | 'write', perm?) — mapa { id: { access, perm? } }:
  // w Node z shared/nativeScreens.js, w kopiach (Apps Script, Worker, frontend) wstawiona przez scripts/sync-parser.sh jako
  // globalThis.OSA_NATIVE_ACCESS. Brak mapy = pusta lista = odmowa dla każdego natywnego ekranu (bezpieczny domyślny stan).
  // Nowy ekran: wpis w pliku obszaru shared/native/ + nav.js + shell.js (docs/AGENT-BRIEF.md → „Nowy natywny ekran”).
  const NATIVE_ACCESS = globalThis.OSA_NATIVE_ACCESS || (typeof require === 'function' ? null.access : null) || {};
  const nativeOk = id => Object.prototype.hasOwnProperty.call(NATIVE_ACCESS, id) && NATIVE_ACCESS[id] && (NATIVE_ACCESS[id].access === 'read' || NATIVE_ACCESS[id].access === 'write');
  const NATIVE_SCREENS = Object.freeze(Object.keys(NATIVE_ACCESS).filter(nativeOk));
  const NATIVE_READ_ONLY = Object.freeze(NATIVE_SCREENS.filter(id => NATIVE_ACCESS[id].access === 'read'));
  const nativePerm = id => NATIVE_SCREENS.includes(id) && Array.isArray(NATIVE_ACCESS[id].perm) ? NATIVE_ACCESS[id].perm : null;
  const NATIVE = 'native';
  // Wejście awaryjne (docs/auth.md → „Wejście awaryjne”): sesja bez ciasteczek Selly — akcje, które otwierają strony Selly sesją użytkownika
  // (natywne ekrany, formularze przesyłek przewoźników bez API), są niedostępne; nadawanie zgód też (decyzje o uprawnieniach tylko po zwykłym logowaniu).
  // Odczyty i zapisy przez REST API (token sklepu) działają wg uprawnień z ostatniego zwykłego logowania.
  const EMERGENCY_BLOCKED = /^(native:\w+|shipping:manual\w+|invoices:issue\w*|orders:(cardForm|cardSave|itemDelete)|grants:set|perms:\w+)$/;
  const EMERGENCY_MSG = 'Niedostępne w trybie awaryjnym — ten ekran działa na Twojej sesji w Selly, a w trybie awaryjnym jej nie ma. Skorzystaj z panelu Selly albo poczekaj, aż zwykłe logowanie znowu zadziała.';

  const ORD = ['zamowienia', 'dropshipping', 'przesylki', 'wplaty', 'klienci', 'raporty', 'magazyny', 'licencje'];
  const CLI = ['klienci', 'zamowienia', 'wplaty', 'dropshipping', 'licencje'];
  const PRD = ['produkty', 'zamowienia', 'dropshipping', 'magazyny', 'raporty', 'zestawy', 'zmiana-cen', 'zmiana-danych', 'zmiana-kategorii'];
  const BULK = ['zmiana-cen', 'zmiana-danych', 'zmiana-kategorii'];
  const ANY = '*', ADMIN = 'admin';
  // Rodzaj operacji masowej → sekcja, której prawo zmian jest potrzebne (zgoda na „Masową zmianę cen” nie pozwala masowo zmieniać kategorii ani danych)
  const BULK_KIND = { price: 'zmiana-cen', field: 'zmiana-danych', category: 'zmiana-kategorii', producer: 'zmiana-kategorii' };
  const bulkSection = kind => (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(BULK_KIND, kind) ? BULK_KIND[kind] : '');

  // [wzorzec akcji, sekcje (dowolna z nich wystarcza) | ANY | ADMIN | funkcja(params) → sekcje]
  const RULES = [
    [/^(whoami|init|auth:(logout|refresh|perms)|feedback:send|client:errors|client:exits)$/, ANY],
    [/^(feedback:(list|status)|client:errors:list|client:exits:list|health:get|map:\w+|logins:list|grants:set|users:\w+)$/, ADMIN],
    // edytor uprawnień grup Selly: tylko administrator panelu (Konta administratorów w Selly); zapis i tak sprawdza Selly (sesja użytkownika)
    [/^perms:(groups|read|cached|save)$/, ADMIN],
    [/^guard:(status|reset)$/, ADMIN],   // Strażnik Selly (panel/worker/src/modules/sellyGuard.js)
    // orders:stamp (znacznik wersji, 1 wiersz D1) i orders:refresh (synchronizacja zamówień teraz — pisze tylko do kopii panelu w D1, nigdy do Selly;
    // limit globalny i budżet Selly: panel/worker/src/lib/liveSync.js) — jak odczyt listy
    [/^orders:(list|resolve|get|meta|invoices|stamp|refresh)$/, ORD],
    [/^orders:prefsSave$/, ADMIN],   // ustawienia listy wspólne dla sklepu (panel/worker/src/modules/orders.js)
    [/^orders:setStatus$/, ['zamowienia', 'przesylki']],
    // wystawianie faktur: tylko sekcja „faktury” (pochodna zamówień); zapis wymaga prawa zmian tej sekcji (administrator albo zgoda)
    [/^invoices:(issueForm|issue)$/, ['faktury']],
    [/^orders:\w+$/, ['zamowienia']],
    [/^clients:(list|get|meta|addresses|affiliate|extra|groups|prices)$/, CLI],
    [/^clients:noteDelete$/, ['klienci']],   // usuwanie notatki klienta: administrator panelu (decyzja właściciela, P6) I dostęp do sekcji Klienci (ADMIN_AND_RULE w denyReason)
    [/^clients:\w+$/, ['klienci']],
    [/^products:(list|get|facets|dicts|extra|warehouses)$/, PRD],
    // ustawienia magazynów Selly (trasa „magazyny” w Selly) — zapis tylko z prawem do sekcji Magazyny
    [/^products:warehouseSave$/, ['magazyny']],
    [/^products:\w+$/, ['produkty']],
    [/^shipping:inspect(Save|Approve)?$/, ADMIN],   // budowa formularza przewoźnika z sesji administratora (modules/shipInspect.js)
    [/^shipping:\w+$/, ['przesylki']],
    [/^dropshipping:\w+$/, ['dropshipping']],
    [/^payments:\w+$/, ['wplaty']],
    // rodziny produktów w raportach: zmiana wspólna dla wszystkich — tylko administrator panelu (Selly „Konta administratorów” albo ADMIN_LOGINS)
    [/^reports:familySave$/, ADMIN],
    [/^reports:\w+$/, ['raporty']],
    [/^dashboard:\w+$/, ['pulpit']],
    [/^ceneo:\w+$/, ['produkty']],
    // start / podgląd: sekcja wg rodzaju operacji (nieznany rodzaj — dowolna z trzech; operację i tak odrzuca walidacja 400);
    // kroki, wstrzymanie, cofanie istniejącej partii: dowolna z trzech + kontrola rodzaju partii w module (bulk.js needBatchWrite)
    [/^bulk:(start|preview)$/, p => { const s = bulkSection(p && p.op && p.op.kind); return s ? [s] : BULK; }],
    [/^bulk:\w+$/, BULK],
    [/^mag:\w+$/, ['magazyny']],
    // nadzór stanów SpeedMail (Worker + D1): ustawienia wspólne dla wszystkich i przeliczenie sum — tylko administrator panelu
    [/^sm:(configSave|recount)$/, ADMIN],
    [/^sm:\w+$/, ['magazyny']],
    [/^(report|orszaki|changes|refresh)$/, ['licencje']],
    [/^res:(list|get|options)$/, p => { const r = String((p && p.res) || ''); return DICTS.includes(r) ? ANY : [r]; }],
    [/^res:\w+$/, p => [String((p && p.res) || '')]],
    // natywne ekrany: tylko z allowlisty; nieznany ekran / operacja = brak dostępu (pusta lista sekcji → 403)
    // usuwanie wpisu (ekran z `del`: gpsr, zwroty, reklamacje): tylko administrator panelu, tylko ekran z allowlisty z zapisem; trasę i przycisk sprawdza silnik
    [/^native:delete$/, p => { const id = String((p && p.screen) || ''); return NATIVE_SCREENS.includes(id) && !NATIVE_READ_ONLY.includes(id) ? NATIVE : []; }],   // + administrator (ADMIN_AND_RULE) oraz complete i perm ekranu jak przy zapisie
    [/^native:(read|save|create)$/, p => NATIVE_SCREENS.includes(String((p && p.screen) || '')) ? NATIVE : []],
    [/^native:\w+$/, () => []],
  ];

  const TITLES = {
    zamowienia: 'Zamówienia', dropshipping: 'Dropshipping', klienci: 'Klienci', przesylki: 'Przesyłki', produkty: 'Produkty', magazyny: 'Magazyny',
    raporty: 'Raporty sprzedaży', faktury: 'Wystawianie faktur', 'zmiana-cen': 'Masowa zmiana cen', 'zmiana-danych': 'Masowa zmiana danych', 'zmiana-kategorii': 'Masowa zmiana kategorii',
    subskrypcje: 'Subskrypcje', zwroty: 'Zwroty', zestawy: 'Zestawy', kategorie: 'Kategorie', producenci: 'Producenci',
    atrybuty: 'Warianty i opcje', tagi: 'Tagi', opinie: 'Opinie o produktach', blog: 'Blog', licencje: 'Raport licencji', wplaty: 'Import wpłat bankowych', pulpit: 'Pulpit', speedmail: 'Wysyłka SpeedMail',
  };

  /** Sekcje z wyniku sprawdzenia tras: probe = { trasa: true|false }. → posortowana lista id sekcji (z pochodnymi). */
  function sectionsFromProbe(probe) {
    const out = Object.keys(SECTION_ROUTES).filter(id => probe[SECTION_ROUTES[id]] === true);
    for (const id of Object.keys(DERIVED)) if (DERIVED[id].every(x => out.includes(x))) out.push(id);
    return out.sort();
  }

  /**
   * Prawo zapisu: sekcje z podglądem (z Selly), w których wolno zmieniać: administrator — wszystkie; inni — tylko te ze zgodą administratora
   * (grants); natywne ekrany i sekcje tylko z odczytami — zawsze (Selly sprawdza zapis samo / brak zapisów).
   */
  function computeWrite(perms, admin, grants) {
    const g = grants || [];
    return (perms || []).filter(id => SESSION_WRITE.includes(id) || READONLY_SECTIONS.includes(id) || (GRANTABLE.includes(id) && (admin || g.includes(id)))).sort();
  }
  /** Czy akcja zmienia dane (wymaga prawa zapisu sekcji). */
  const isWriteAction = action => !READ_SET.has(String(action || ''));   // spoza jawnej listy odczytów = zapis (fail closed)

  /** Czy login jest na liście administratorów z konfiguracji (ADMIN_LOGINS: „jan, ewa”; wielkość liter bez znaczenia). */
  function isAdminLogin(list, login) {
    const l = String(login || '').trim().toLowerCase();
    return !!l && String(list || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean).includes(l);
  }

  /** Reguła akcji → sekcje | ANY | ADMIN | null (brak reguły). */
  function ruleFor(action, params) {
    for (const [re, who] of RULES) if (re.test(String(action || ''))) return typeof who === 'function' ? who(params || {}) : who;
    return null;
  }

  /**
   * Czy wolno: who = { perms: [sekcje], admin: bool }. → '' (wolno) albo komunikat odmowy po polsku (kod 403).
   * Administrator panelu NIE dostaje automatycznie sekcji, których nie widzi w Selly — uprawnienia danych idą za Selly.
   */
  const ADMIN_AND_RULE = /^(native:delete|clients:noteDelete|orders:itemDelete)$/;   // orders:itemDelete: usunięcie pozycji zamówienia (formularz Selly)
  function denyReason(who, action, params) {
    const rule = ruleFor(action, params);
    if (rule === null) return 'Ta operacja nie jest dostępna w panelu OSA (' + String(action).slice(0, 60) + ').';
    if (who && who.emergency && EMERGENCY_BLOCKED.test(String(action || ''))) return EMERGENCY_MSG;
    if (rule === ANY) return '';
    if (ADMIN_AND_RULE.test(String(action || '')) && !(who && who.admin)) return 'Tylko administrator panelu OSA może to zrobić.';   // dodatkowo do reguły sekcji / ekranu poniżej
    if (rule === ADMIN) return who && who.admin ? '' : 'Tylko administrator panelu OSA może to zrobić.';
    if (rule === NATIVE) {   // natywny ekran: kompletna sesja; zapis tylko na ekranach z polami edytowalnymi; resztę rozstrzyga Selly (sesja użytkownika)
      if (!who || who.complete !== true) return 'Sprawdzam uprawnienia w Selly — chwilę, potem spróbuj ponownie.';
      const np = nativePerm(String((params && params.screen) || ''));   // ekran z perm: dodatkowo jedna z tych sekcji (wg uprawnień z Selly)
      if (np && !np.some(s => (who.perms || []).includes(s))) return 'Twoje konto Selly nie ma dostępu do tego ekranu (potrzebny dostęp do: ' + np.slice(0, 3).map(s => '„' + (TITLES[s] || s) + '”').join(' lub ') + '). Uprawnienia nadaje administrator sklepu w Selly (Konto → Uprawnienia); po zmianie wyloguj się i zaloguj ponownie.';
      if (isWriteAction(action) && NATIVE_READ_ONLY.includes(String((params && params.screen) || ''))) return 'Ten ekran w panelu OSA jest tylko do podglądu — zmiany wprowadzisz w Selly.';
      return '';
    }
    const perms = (who && who.perms) || [];
    const names = rule.filter(s => TITLES[s]).map(s => '„' + TITLES[s] + '”');
    if (rule.some(s => perms.includes(s))) {
      if (!isWriteAction(action)) return '';
      const write = (who && who.write) || [];
      if (rule.some(s => perms.includes(s) && write.includes(s))) return '';
      return 'Zmiany w tej sekcji wymagają zgody administratora panelu' + (names.length ? ' (' + names.slice(0, 3).join(' lub ') + ')' : '') +
        '. Podgląd masz z uprawnień Selly; zgodę na zmiany nadaje administrator w panelu: Konto → Kto się logował.';
    }
    return 'Twoje konto Selly nie ma dostępu do tej części panelu' + (names.length ? ' (potrzebny dostęp do: ' + names.slice(0, 3).join(' lub ') + ')' : '') +
      '. Uprawnienia nadaje administrator sklepu w Selly (Konto → Uprawnienia); po zmianie wyloguj się i zaloguj ponownie.';
  }

  /** Czy sekcja menu jest dostępna (frontend): sekcje spoza mapy (np. linki do Selly) — zawsze; admina — tylko adminowi. */
  function canSee(who, sectionId) {
    if (ADMIN_SECTIONS.includes(sectionId)) return !!(who && who.admin);
    if (!(sectionId in SECTION_ROUTES) && !(sectionId in DERIVED)) return true;
    return ((who && who.perms) || []).includes(sectionId);
  }

  /** Trasy do sprawdzenia przy logowaniu (bez powtórzeń), z trasą administratora. */
  function probeRoutes() {
    const set = [];
    for (const id of Object.keys(SECTION_ROUTES)) if (!set.includes(SECTION_ROUTES[id])) set.push(SECTION_ROUTES[id]);
    set.push(ADMIN_ROUTE);
    return set;
  }

  // Token dla zapasowego backendu (Apps Script): base64url(JSON ładunku) + '.' + base64url(HMAC-SHA256). Podpis liczy platforma.
  // Krótki (20 min, odświeżany przez Workera) i z identyfikatorem sesji (s) — Apps Script odrzuca tokeny sesji unieważnionej
  // (wylogowanie, śmierć sesji Selly, odebrane uprawnienia) wydane przed chwilą unieważnienia (PanelSession.gs).
  const GAS_TOKEN_TTL_MS = 20 * 60e3;
  function gasPayload(login, perms, admin, nowMs, ttlMs, write, sid) {
    return { v: 1, l: String(login), s: String(sid || ''), p: (perms || []).slice(), w: (write || []).slice(), a: !!admin, iat: Math.floor(nowMs / 1000), exp: Math.floor((nowMs + (ttlMs || GAS_TOKEN_TTL_MS)) / 1000) };
  }
  /** Sprawdzenie ładunku po weryfikacji podpisu: → { login, perms, admin } albo { error, code }. */
  function checkPayload(p, nowMs) {
    if (!p || p.v !== 1 || typeof p.l !== 'string' || !p.l || !Array.isArray(p.p) || typeof p.exp !== 'number') return { error: 'Nieprawidłowa sesja — zaloguj się ponownie.', code: 401 };
    if (p.exp * 1000 <= nowMs) return { error: 'Sesja wygasła — zaloguj się ponownie.', code: 401 };
    if (p.iat && p.iat * 1000 > nowMs + 5 * 60e3) return { error: 'Nieprawidłowa sesja — zaloguj się ponownie.', code: 401 };
    if (typeof p.s !== 'string' || !p.s) return { error: 'Nieprawidłowa sesja — zaloguj się ponownie.', code: 401 };   // bez identyfikatora sesji nie da się unieważnić
    return { login: p.l, perms: p.p.map(String), write: Array.isArray(p.w) ? p.w.map(String) : [], admin: p.a === true, sid: p.s, iat: p.iat || 0 };
  }

  const api = { EMERGENCY_BLOCKED, EMERGENCY_MSG, bulkSection, SECTION_ROUTES, SESSION_WRITE, GRANTABLE, VIEW_REDIRECTS, READONLY_SECTIONS, ADMIN_ROUTE, DERIVED, ADMIN_SECTIONS, DICTS, RULES, TITLES, ANY, ADMIN, NATIVE, NATIVE_SCREENS, NATIVE_READ_ONLY, READ_ACTIONS, WRITE_ACTIONS, GAS_TOKEN_TTL_MS,
    sectionsFromProbe, computeWrite, isWriteAction, isAdminLogin, ruleFor, denyReason, canSee, probeRoutes, gasPayload, checkPayload };
  globalThis.OSA_PANEL_AUTH = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

const _pa = globalThis.OSA_PANEL_AUTH;
export const { bulkSection, SECTION_ROUTES, SESSION_WRITE, GRANTABLE, VIEW_REDIRECTS, READONLY_SECTIONS, computeWrite, isWriteAction, ADMIN_ROUTE, DERIVED, ADMIN_SECTIONS, DICTS, TITLES, ANY, ADMIN, NATIVE, NATIVE_SCREENS, NATIVE_READ_ONLY, READ_ACTIONS, WRITE_ACTIONS, GAS_TOKEN_TTL_MS, sectionsFromProbe, isAdminLogin, ruleFor, denyReason, canSee, probeRoutes, gasPayload, checkPayload } = _pa;
