// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=abc9fbd';
import licencje from './modules/licencje.js?v=abc9fbd';
import magazyny from './modules/magazyny.js?v=abc9fbd';
import produkty from './modules/produkty.js?v=abc9fbd';
import klienci from './modules/klienci.js?v=abc9fbd';
import uzytkownicy from './modules/uzytkownicy.js?v=abc9fbd';
import zamowienia from './modules/zamowienia.js?v=abc9fbd';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
