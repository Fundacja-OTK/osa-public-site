// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=5ee428c';
import licencje from './modules/licencje.js?v=5ee428c';
import magazyny from './modules/magazyny.js?v=5ee428c';
import produkty from './modules/produkty.js?v=5ee428c';
import klienci from './modules/klienci.js?v=5ee428c';
import uzytkownicy from './modules/uzytkownicy.js?v=5ee428c';
import zamowienia from './modules/zamowienia.js?v=5ee428c';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
