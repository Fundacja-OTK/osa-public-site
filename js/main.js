// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=d317124';
import licencje from './modules/licencje.js?v=d317124';
import magazyny from './modules/magazyny.js?v=d317124';
import produkty from './modules/produkty.js?v=d317124';
import klienci from './modules/klienci.js?v=d317124';
import uzytkownicy from './modules/uzytkownicy.js?v=d317124';
import zamowienia from './modules/zamowienia.js?v=d317124';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
