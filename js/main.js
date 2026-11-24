// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=e5c8181';
import licencje from './modules/licencje.js?v=e5c8181';
import magazyny from './modules/magazyny.js?v=e5c8181';
import produkty from './modules/produkty.js?v=e5c8181';
import klienci from './modules/klienci.js?v=e5c8181';
import uzytkownicy from './modules/uzytkownicy.js?v=e5c8181';
import zamowienia from './modules/zamowienia.js?v=e5c8181';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
