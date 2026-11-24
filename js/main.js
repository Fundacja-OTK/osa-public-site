// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=64a1b3e';
import licencje from './modules/licencje.js?v=64a1b3e';
import magazyny from './modules/magazyny.js?v=64a1b3e';
import produkty from './modules/produkty.js?v=64a1b3e';
import klienci from './modules/klienci.js?v=64a1b3e';
import uzytkownicy from './modules/uzytkownicy.js?v=64a1b3e';
import zamowienia from './modules/zamowienia.js?v=64a1b3e';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
