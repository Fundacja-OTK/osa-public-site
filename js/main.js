// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=e0c65af';
import licencje from './modules/licencje.js?v=e0c65af';
import magazyny from './modules/magazyny.js?v=e0c65af';
import produkty from './modules/produkty.js?v=e0c65af';
import klienci from './modules/klienci.js?v=e0c65af';
import uzytkownicy from './modules/uzytkownicy.js?v=e0c65af';
import zamowienia from './modules/zamowienia.js?v=e0c65af';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
