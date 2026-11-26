// Reklamacje (Selly ?a=reklamacje) — natywny ekran: serwer główny czyta i zapisuje Selly sesją zalogowanego użytkownika (docs/selly-embed.md, docs/auth.md).
// Lista, karta z historią zdarzeń, zmiana statusu / pracownika / RMA / uwag i dodawanie reklamacji (podgląd → potwierdzenie → zapis).
// Zdarzenia wszystkich reklamacji i słownik statusów — osobne widoki tylko do podglądu (eksporty `zdarzenia`, `statusy`). Usuwanie zostaje w Selly.
import { createNative } from './sellyNative.js?v=1c81125';
import { createSettings } from './sellyNativeSettings.js?v=1c81125';
import { panelLink } from './koszyki.js?v=1c81125';

const LINKS = [
  { href: '#/reklamacje', label: 'Reklamacje', tip: 'Lista reklamacji' },
  { href: '#/reklamacje-zdarzenia', label: 'Zdarzenia', tip: 'Historia zdarzeń wszystkich reklamacji (kto, kiedy, co zmienił; czy wysłano list)' },
  { href: '#/reklamacje-statusy', label: 'Statusy', tip: 'Słownik statusów reklamacji z Selly (tylko podgląd)' },
];
const others = id => LINKS.filter(l => l.href !== '#/' + id);

export default createNative({
  id: 'reklamacje', title: 'Reklamacje', screen: 'reklamacje', a: 'reklamacje', recordRoute: 'reklamacje.edycja', noun: 'reklamacji',
  recordTitle: id => 'Reklamacja nr ' + id,
  cellLink: panelLink,
  links: others('reklamacje'),
  remove: { title: 'Usunąć reklamację?', tip: 'Usuwa tę reklamację z Selly (tylko administrator panelu, po potwierdzeniu)', body: id => 'Reklamacja nr ' + id + ' zostanie usunięta z Selly.' },   // serwer: native:delete = ADMIN
  create: { label: '+ Dodaj reklamację', title: 'Nowa reklamacja', tip: 'Otwiera pusty formularz reklamacji z Selly; przed wysłaniem pokażemy podsumowanie (bez e-maila do klienta)' },
  labels: {
    user_id: 'ID klienta', produkt: 'Produkt', numer_seryjny: 'Numer seryjny', producent_id: 'Producent', zamowienie_numer: 'Numer zamówienia',
    status_id: 'Status reklamacji', odbior_id: 'Sposób odbioru po reklamacji', numer_rma: 'RMA serwisu', pracownik_id: 'Przypisany pracownik',
    wyposazenie: 'Wyposażenie', opis_naprawy: 'Opis naprawy', uwagi: 'Uwagi wewnętrzne', komentarz_mail: 'Komentarz do e-maila',
  },
  fieldTips: {
    user_id: 'Numer (ID) konta klienta w Selly — zostaw puste, jeśli reklamujący nie ma konta',
    zamowienie_numer: 'Numer zamówienia, którego dotyczy reklamacja (np. 12/2026)',
    status_id: 'Zmiana statusu może w Selly wysłać klientowi automatyczne powiadomienie (jeśli status ma szablon listu)',
    uwagi: 'Notatka widoczna tylko dla obsługi sklepu',
  },
  advanced: ['numer_seryjny', 'producent_id'],
  advancedTitle: 'Więcej pól reklamacji',
  headerTips: {
    'Data wpisania': 'Kiedy reklamacja została wpisana w Selly',
    'Dane reklamacji': 'Numer RMA, numer seryjny i inne dane zgłoszenia',
    'Zamówienie': 'Zamówienie, którego dotyczy reklamacja',
    'Status': 'Etap obsługi reklamacji (nowa, przyjęta, w trakcie, zakończona…)',
    'Działanie': 'Dostępne czynności w Selly',
  },
});

export const zdarzenia = createNative({
  id: 'reklamacje-zdarzenia', title: 'Reklamacje — zdarzenia', screen: 'reklamacje-zdarzenia', a: 'reklamacje.zdarzenia', noun: 'zdarzenia',
  recordTitle: id => 'Zdarzenie ' + id, links: others('reklamacje-zdarzenia'),
  headerTips: {
    'Data zdarzenia': 'Kiedy zdarzenie zostało zapisane w Selly',
    'Numer reklamacji': 'Reklamacja, której dotyczy zdarzenie',
    'Osoba': 'Kto wykonał czynność (pracownik albo klient)',
    'Opis': 'Co się wydarzyło: wpisanie, korespondencja, zmiana danych, komentarz…',
    'Wysłano list': 'Czy Selly wysłało przy tym e-mail do reklamującego',
  },
});

export const statusy = createSettings({ id: 'reklamacje-statusy', title: 'Statusy reklamacji', screen: 'reklamacje-statusy', a: 'reklamacje.statusy',
  intro: 'Statusy, przez które przechodzi reklamacja, z kolorami i szablonami listów. Zmiany i usuwanie — w Selly.', links: others('reklamacje-statusy') });
