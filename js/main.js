// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=094b3e3';
import licencje from './modules/licencje.js?v=094b3e3';
import magazyny from './modules/magazyny.js?v=094b3e3';
import produkty from './modules/produkty.js?v=094b3e3';
import klienci from './modules/klienci.js?v=094b3e3';
import uzytkownicy from './modules/uzytkownicy.js?v=094b3e3';
import zamowienia from './modules/zamowienia.js?v=094b3e3';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
