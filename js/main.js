// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=1a6db82';
import licencje from './modules/licencje.js?v=1a6db82';
import magazyny from './modules/magazyny.js?v=1a6db82';
import produkty from './modules/produkty.js?v=1a6db82';
import klienci from './modules/klienci.js?v=1a6db82';
import uzytkownicy from './modules/uzytkownicy.js?v=1a6db82';
import zamowienia from './modules/zamowienia.js?v=1a6db82';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
