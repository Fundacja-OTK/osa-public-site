// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=3a6189b';
import licencje from './modules/licencje.js?v=3a6189b';
import magazyny from './modules/magazyny.js?v=3a6189b';
import produkty from './modules/produkty.js?v=3a6189b';
import klienci from './modules/klienci.js?v=3a6189b';
import uzytkownicy from './modules/uzytkownicy.js?v=3a6189b';
import zamowienia from './modules/zamowienia.js?v=3a6189b';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
