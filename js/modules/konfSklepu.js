// Konfiguracja sklepu — natywne ekrany „strona ustawień” (extension/lib/sellyNative.js, blok `// === konfiguracja sklepu ===`).
// Każdy eksport to moduł jednej pozycji menu (shell.js → LAZY). Edytowalne tylko proste, niskiego ryzyka ustawienia; reszta to podgląd + „Zmień w Selly ↗”.
import { createSettings } from './sellyNativeSettings.js?v=b64db56';

export const konf = createSettings({ id: 'konf', title: 'Konfiguracja podstawowa', screen: 'konf', a: 'configuration' });
export const panelKonf = createSettings({ id: 'panel-konf', title: 'Konfiguracja panelu', screen: 'panel-konf', a: 'configuration.panelOptions' });
export const wygladKonf = createSettings({ id: 'wyglad-konf', title: 'Konfiguracja wyglądu — zgody cookies', screen: 'wyglad-konf', a: 'configuration.displayOptions',
  intro: 'Baner zgód na pliki cookies widoczny dla klientów sklepu: włączenie, układ i pozycja.' });
export const znaki = createSettings({ id: 'znaki', title: 'Znaki wodne', screen: 'znaki', a: 'watermarks',
  intro: 'Znaki wodne nakładane na zdjęcia nowych produktów: gdzie i w jakim stopniu pokrywają zdjęcie.' });
export const jezyki = createSettings({ id: 'jezyki', title: 'Języki i waluty', screen: 'jezyki', a: 'configuration.localization',
  intro: 'Ukrywanie cen i przycisku „Kupuj” oraz wybór kraju dostawy. Języki i kursy walut zmieniasz w Selly.' });
export const dostepnosc = createSettings({ id: 'dostepnosc', title: 'Statusy dostępności — filtr', screen: 'dostepnosc', a: 'configuration.productsAvailability',
  intro: 'Które statusy dostępności klient widzi w filtrze produktów i jak filtr się wyświetla.' });

// Marketplace, integracje, treści, konfiguracja zamówień (extension/lib/sellyNative.js → blok „marketplace, integracje…”). Uprawnienia egzekwuje Selly (NATIVE_SCREENS).
const S = (id, title, a, intro) => [id, createSettings({ id, title, screen: id, a, intro })];
export const extra = Object.fromEntries([
  S('allegro', 'Allegro — synchronizacja', 'allegro', 'Co sklep synchronizuje z Allegro (ceny, stany, kończenie aukcji). Tylko podgląd: zmiana masowo zmienia oferty.'),
  S('allegro-aukcje', 'Allegro — domyślne ustawienia aukcji', 'allegro', 'Wartości domyślne dla nowo wystawianych aukcji.'),
  S('empik', 'Empik — konfiguracja konta', 'marketplace'),
  S('allegro-wysylka', 'Allegro — mapowanie czasu wysyłki', 'allegro.shippingTime', 'Jaki czas wysyłki z sklepu trafia do ofert Allegro.'),
  S('allegro-operatorzy', 'Allegro — operatorzy przesyłek', 'allegro.packageOperators', 'Którego operatora Allegro odpowiada każda forma dostawy w sklepie.'),
  S('allegro-szablony', 'Allegro — szablony aukcji', 'allegro.templates', 'Szablony aukcji (tylko podgląd).'),
  S('ceneo-opinie', 'Ceneo — ankieta po zakupie', 'scripts.integracjaCeneo', 'Integracja z Ceneo: ankieta po zakupie (tylko podgląd).'),
  S('ceneo-mapa', 'Ceneo — mapowanie kategorii', 'configuration.ceneoMap', 'Mapowanie kategorii sklepu na kategorie Ceneo (tylko podgląd).'),
  S('int-porownywarki', 'Integracje — porównywarki cen', 'configuration.integracje', 'Eksporty produktów do porównywarek. Z panelu zmienisz tylko eksport opisów.'),
  S('int-przesylki', 'Integracje — przesyłki (Apaczka)', 'configuration.shipping'),
  S('int-fk', 'Integracje — programy F/K (wFirma)', 'configuration.programsFK'),
  S('int-dodatkowe', 'Integracje — dodatkowe (Google)', 'scripts.integracjaOpcje', 'Które narzędzia Google są włączone w sklepie.'),
  S('ai', 'Narzędzia AI — konfiguracja', 'narzedziaAI'),
  S('slajdy', 'Pokaz slajdów', 'scripts.slider', 'Slajdy strony głównej sklepu.'),
  S('ksztalty', 'Kształty produktów', 'configuration.shapes'),
  S('dostawy-konf', 'Formy dostawy — konfiguracja', 'configuration.deliveries'),
  S('statusy-konf', 'Statusy zamówień — konfiguracja', 'configuration.ordersStatuses'),
]);
