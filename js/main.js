// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=2b127e1';
import licencje from './modules/licencje.js?v=2b127e1';
import magazyny from './modules/magazyny.js?v=2b127e1';
import produkty from './modules/produkty.js?v=2b127e1';
import klienci from './modules/klienci.js?v=2b127e1';
import uzytkownicy from './modules/uzytkownicy.js?v=2b127e1';
import zamowienia from './modules/zamowienia.js?v=2b127e1';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
