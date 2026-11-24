// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=79172be';
import licencje from './modules/licencje.js?v=79172be';
import magazyny from './modules/magazyny.js?v=79172be';
import produkty from './modules/produkty.js?v=79172be';
import klienci from './modules/klienci.js?v=79172be';
import uzytkownicy from './modules/uzytkownicy.js?v=79172be';
import zamowienia from './modules/zamowienia.js?v=79172be';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
