// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=c46bdf1';
import licencje from './modules/licencje.js?v=c46bdf1';
import magazyny from './modules/magazyny.js?v=c46bdf1';
import produkty from './modules/produkty.js?v=c46bdf1';
import klienci from './modules/klienci.js?v=c46bdf1';
import uzytkownicy from './modules/uzytkownicy.js?v=c46bdf1';
import zamowienia from './modules/zamowienia.js?v=c46bdf1';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
