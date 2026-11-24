// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=3befa2d';
import licencje from './modules/licencje.js?v=3befa2d';
import magazyny from './modules/magazyny.js?v=3befa2d';
import produkty from './modules/produkty.js?v=3befa2d';
import klienci from './modules/klienci.js?v=3befa2d';
import uzytkownicy from './modules/uzytkownicy.js?v=3befa2d';
import zamowienia from './modules/zamowienia.js?v=3befa2d';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
