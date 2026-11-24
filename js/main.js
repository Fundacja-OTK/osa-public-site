// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=a73af4a';
import licencje from './modules/licencje.js?v=a73af4a';
import magazyny from './modules/magazyny.js?v=a73af4a';
import produkty from './modules/produkty.js?v=a73af4a';
import klienci from './modules/klienci.js?v=a73af4a';
import uzytkownicy from './modules/uzytkownicy.js?v=a73af4a';
import zamowienia from './modules/zamowienia.js?v=a73af4a';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
