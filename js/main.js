// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=91371e0';
import licencje from './modules/licencje.js?v=91371e0';
import magazyny from './modules/magazyny.js?v=91371e0';
import produkty from './modules/produkty.js?v=91371e0';
import klienci from './modules/klienci.js?v=91371e0';
import uzytkownicy from './modules/uzytkownicy.js?v=91371e0';
import zamowienia from './modules/zamowienia.js?v=91371e0';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
