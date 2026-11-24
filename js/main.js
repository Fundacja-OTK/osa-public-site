// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=7fa4a02';
import licencje from './modules/licencje.js?v=7fa4a02';
import magazyny from './modules/magazyny.js?v=7fa4a02';
import produkty from './modules/produkty.js?v=7fa4a02';
import klienci from './modules/klienci.js?v=7fa4a02';
import uzytkownicy from './modules/uzytkownicy.js?v=7fa4a02';
import zamowienia from './modules/zamowienia.js?v=7fa4a02';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
