// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=a359485';
import licencje from './modules/licencje.js?v=a359485';
import magazyny from './modules/magazyny.js?v=a359485';
import produkty from './modules/produkty.js?v=a359485';
import klienci from './modules/klienci.js?v=a359485';
import uzytkownicy from './modules/uzytkownicy.js?v=a359485';
import zamowienia from './modules/zamowienia.js?v=a359485';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
