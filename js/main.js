// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=ead81e8';
import licencje from './modules/licencje.js?v=ead81e8';
import magazyny from './modules/magazyny.js?v=ead81e8';
import produkty from './modules/produkty.js?v=ead81e8';
import klienci from './modules/klienci.js?v=ead81e8';
import uzytkownicy from './modules/uzytkownicy.js?v=ead81e8';
import zamowienia from './modules/zamowienia.js?v=ead81e8';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
