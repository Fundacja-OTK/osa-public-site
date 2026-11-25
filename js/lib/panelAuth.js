// WYGENEROWANE z shared/panelAuth.js przez scripts/sync-parser.sh — nie edytuj ręcznie.

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
    'subskrypcje', 'zwroty', 'zestawy', 'kategorie', 'producenci', 'atrybuty', 'tagi', 'opinie', 'blog', 'wplaty'];
  // Strona sekcji przekierowuje w Selly na stronę tego samego modułu, która też jest podglądem (potwierdzone na prawdziwym Selly)
  const VIEW_REDIRECTS = { kategorie: ['kategorie.edycja'] };
  // Sekcje tylko z odczytami (zapis nieszkodliwy, np. „Odśwież dane” = synchronizacja) — zapis = podgląd
  const READONLY_SECTIONS = ['licencje', 'pulpit', 'raporty'];
  // Klasyfikacja akcji — JAWNE listy (bez zgadywania po końcówce nazwy). Akcja spoza READ_ACTIONS = zapis (fail closed: wymaga prawa zmian).
  // Test: tests/unit/actionClassification.test.js — każda akcja z kodu (Worker, Apps Script, frontend) jest na dokładnie jednej liście.
  // Uwaga: mag:moves DODAJE ruchy magazynowe (Warehouses.gs addMoves) — to zapis; historia ruchów przychodzi w mag:init.
  const READ_ACTIONS = [
    'init', 'whoami', 'report', 'orszaki', 'changes', 'refresh', 'auth:refresh', 'auth:perms',
    'orders:list', 'orders:get', 'orders:meta', 'orders:invoices', 'orders:stamp', 'orders:refresh', 'orders:invoiceList', 'orders:invoiceScan',
    'clients:list', 'clients:get', 'clients:meta', 'clients:addresses', 'clients:affiliate', 'clients:extra', 'clients:groups', 'clients:prices', 'clients:emailsExist',
    'products:list', 'products:get', 'products:facets', 'products:dicts', 'products:extra', 'products:warehouses',
    'shipping:meta', 'shipping:queue', 'shipping:label', 'shipping:manualForm', 'shipping:inspect',
    'dropshipping:list', 'dropshipping:get',
    'payments:candidates',
    'reports:sales', 'reports:years', 'reports:product', 'reports:profit', 'reports:families', 'reports:familyYears', 'reports:productSearch', 'reports:compare',
    'dashboard:get',
    'bulk:list', 'bulk:get', 'bulk:meta', 'bulk:preview', 'bulk:select',
    'mag:init', 'mag:orders', 'mag:settled',
    'sm:init', 'sm:list', 'sm:get', 'sm:pace', 'sm:shipMatch',
    // stany wg Selly per magazyn (kopia D1) i podgląd startu; mag:sellyRefresh — jak orders:invoiceScan: tylko odczyt w Selly, porcja ≤ 15, budżet minutowy
    'mag:sellyStock', 'mag:sellyPreview', 'mag:sellyRefresh', 'mag:sellyLive',
    'res:list', 'res:get', 'res:options',
    'native:read',
    // edytor uprawnień grup Selly (Konto → Uprawnienia): lista grup i macierz modułów — strony Selly sesją użytkownika, tylko administrator panelu
    'perms:groups', 'perms:read', 'perms:cached',
    'feedback:list', 'client:errors:list', 'client:exits:list', 'health:get', 'logins:list', 'map:latest', 'map:history',
  ];
  const WRITE_ACTIONS = [
    'auth:logout', 'feedback:send', 'feedback:status', 'client:errors', 'client:exits', 'grants:set', 'map:report', 'map:retry',
    'orders:setStatus', 'orders:update', 'orders:addItem', 'orders:updateItem', 'orders:create', 'orders:invoiceUpdate',
    'clients:save', 'clients:create', 'clients:update', 'clients:setBlock', 'clients:addressSave', 'clients:addressDelete', 'clients:affiliateAdd',
    'clients:affiliateDelete', 'clients:groupName', 'clients:priceSave', 'clients:priceDelete',
    'products:create', 'products:update', 'products:duplicate', 'products:setCategories', 'products:setFeatures', 'products:setMeta', 'products:setStock',
    'products:variantUpdate', 'products:photoAdd', 'products:photoUpdate', 'products:photoDelete',
    'products:variantAdd', 'products:variantDelete', 'products:stockAdd', 'products:stockRemove', 'products:delete', 'products:warehouseSave',
    'shipping:create', 'shipping:setMap', 'shipping:manualCreate', 'shipping:inspectSave', 'shipping:inspectApprove',
    'dropshipping:save', 'dropshipping:delete', 'dropshipping:productsAdd', 'dropshipping:productSave', 'dropshipping:productDelete',
    'payments:apply', 'payments:undo',
    'bulk:start', 'bulk:step', 'bulk:pause', 'bulk:resume', 'bulk:stop', 'bulk:undo',
    'mag:moves', 'mag:packs', 'mag:confirm',
    'sm:configSave', 'sm:recount', 'sm:mark', 'sm:keep', 'sm:batch', 'sm:cancel', 'sm:move',
    'mag:sellyStart',
    'res:save', 'res:delete', 'res:itemSave', 'res:itemDelete', 'res:marginsSave',
    'reports:familySave',
    'native:save', 'native:create',
    'perms:save',
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
  };
  // Sekcje tylko dla administratora panelu
  const ADMIN_SECTIONS = ['uzytkownicy', 'selly-zmiany', 'zgloszenia-osa', 'uprawnienia'];
  // Słowniki (res:*) czytelne dla każdego zalogowanego — potrzebne w formularzach innych sekcji
  const DICTS = ['kategorie', 'producenci', 'tagi', 'atrybuty', 'statusy', 'dostawy', 'platnosci-formy'];

  // === Natywne ekrany Selly (extension/lib/sellyNative.js → SCREENS; ta sama lista, test: tests/unit/nativeEngine.test.js) ===
  // Działają na sesji Selly zalogowanego użytkownika — Selly sam egzekwuje podgląd i zapis (brak uprawnień = ekran logowania / przekierowanie /
  // odmowa zapisu → kod 'login' z jasnym komunikatem). Dlatego NIE są sondami logowania (SECTION_ROUTES / WRITE_ROUTES) — oszczędza ~100 zapytań.
  // Reguła NATIVE: native:read / native:save / native:create dla ekranu z listy wolno każdej KOMPLETNEJ sesji (sprawdzanie uprawnień zakończone);
  // ekrany z NATIVE_READ_ONLY odrzucają zapis i dodawanie już tutaj (403), niezależnie od silnika (który też je odrzuca).
  // Nowy ekran: SCREENS + tu (+ NATIVE_READ_ONLY, jeśli bez pól edytowalnych i bez dodawania) + nav.js + shell.js.
  const NATIVE_SCREENS = [
    'reklamacje', 'oferty',
    'admini', 'grupy', 'uprawnienia', 'odo', 'zgloszenia', 'platnosci', 'zlecenia', 'uslugi', 'uslugi-partnerow', 'rozszerzenia', 'wizyty', 'pliki',
    'automatyzacje', 'ceny-auto', 'integrator', 'api', 'frontapi', 'furgonetka', 'suus',
    'cms', 'aktualnosci', 'menu-ed', 'bloki', 'formularze', 'przekierowania', 'gwarancje', 'opisy',
    'kupony', 'koszyki', 'klient-blokada', 'klient-limit', 'klienci-grupy',
    'konf', 'panel-konf', 'wyglad-konf', 'znaki', 'jezyki', 'dostepnosc',
    'allegro', 'allegro-aukcje', 'empik', 'allegro-aukcje-lista', 'allegro-zdarzenia', 'allegro-wysylka', 'allegro-operatorzy', 'allegro-szablony', 'ceneo-opinie', 'ceneo-mapa', 'int-porownywarki', 'int-przesylki', 'int-fk', 'int-dodatkowe', 'ai', 'slajdy', 'ksztalty', 'dostawy-konf', 'statusy-konf',
  ];
  const NATIVE_READ_ONLY = [
    'admini', 'grupy', 'uprawnienia', 'odo', 'zgloszenia', 'platnosci', 'zlecenia', 'uslugi', 'uslugi-partnerow', 'rozszerzenia', 'wizyty', 'pliki',
    'automatyzacje', 'ceny-auto', 'integrator', 'api', 'frontapi', 'furgonetka', 'suus',
    'menu-ed', 'formularze', 'koszyki', 'konf', 'panel-konf', 'allegro', 'empik', 'allegro-aukcje-lista', 'allegro-zdarzenia', 'allegro-szablony', 'ceneo-opinie', 'ceneo-mapa', 'int-przesylki', 'int-fk',
  ];
  const NATIVE = 'native';
  // Wejście awaryjne (docs/auth.md → „Wejście awaryjne”): sesja bez ciasteczek Selly — akcje, które otwierają strony Selly sesją użytkownika
  // (natywne ekrany, formularze przesyłek przewoźników bez API), są niedostępne; nadawanie zgód też (decyzje o uprawnieniach tylko po zwykłym logowaniu).
  // Odczyty i zapisy przez REST API (token sklepu) działają wg uprawnień z ostatniego zwykłego logowania.
  const EMERGENCY_BLOCKED = /^(native:\w+|shipping:manual\w+|grants:set|perms:\w+)$/;
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
    // orders:stamp (znacznik wersji, 1 wiersz D1) i orders:refresh (synchronizacja zamówień teraz — pisze tylko do kopii panelu w D1, nigdy do Selly;
    // limit globalny i budżet Selly: panel/worker/src/lib/liveSync.js) — jak odczyt listy
    [/^orders:(list|get|meta|invoices|stamp|refresh)$/, ORD],
    [/^orders:setStatus$/, ['zamowienia', 'przesylki']],
    [/^orders:\w+$/, ['zamowienia']],
    [/^clients:(list|get|meta|addresses|affiliate|extra|groups|prices)$/, CLI],
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
    [/^native:(read|save|create)$/, p => NATIVE_SCREENS.includes(String((p && p.screen) || '')) ? NATIVE : []],
    [/^native:\w+$/, () => []],
  ];

  const TITLES = {
    zamowienia: 'Zamówienia', dropshipping: 'Dropshipping', klienci: 'Klienci', przesylki: 'Przesyłki', produkty: 'Produkty', magazyny: 'Magazyny',
    raporty: 'Raporty sprzedaży', 'zmiana-cen': 'Masowa zmiana cen', 'zmiana-danych': 'Masowa zmiana danych', 'zmiana-kategorii': 'Masowa zmiana kategorii',
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
  function denyReason(who, action, params) {
    const rule = ruleFor(action, params);
    if (rule === null) return 'Ta operacja nie jest dostępna w panelu OSA (' + String(action).slice(0, 60) + ').';
    if (who && who.emergency && EMERGENCY_BLOCKED.test(String(action || ''))) return EMERGENCY_MSG;
    if (rule === ANY) return '';
    if (rule === ADMIN) return who && who.admin ? '' : 'Tylko administrator panelu OSA może to zrobić.';
    if (rule === NATIVE) {   // natywny ekran: kompletna sesja; zapis tylko na ekranach z polami edytowalnymi; resztę rozstrzyga Selly (sesja użytkownika)
      if (!who || who.complete !== true) return 'Sprawdzam uprawnienia w Selly — chwilę, potem spróbuj ponownie.';
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
