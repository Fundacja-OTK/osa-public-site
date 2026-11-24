// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=b6155cb';
import licencje from './modules/licencje.js?v=b6155cb';
import magazyny from './modules/magazyny.js?v=b6155cb';
import produkty from './modules/produkty.js?v=b6155cb';
import klienci from './modules/klienci.js?v=b6155cb';
import uzytkownicy from './modules/uzytkownicy.js?v=b6155cb';
import zamowienia from './modules/zamowienia.js?v=b6155cb';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
