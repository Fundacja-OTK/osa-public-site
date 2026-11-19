// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=26278f6';
import licencje from './modules/licencje.js?v=26278f6';
import magazyny from './modules/magazyny.js?v=26278f6';
import produkty from './modules/produkty.js?v=26278f6';
import klienci from './modules/klienci.js?v=26278f6';
import uzytkownicy from './modules/uzytkownicy.js?v=26278f6';
import zamowienia from './modules/zamowienia.js?v=26278f6';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
