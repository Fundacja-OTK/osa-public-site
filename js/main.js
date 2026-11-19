// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=fdce023';
import licencje from './modules/licencje.js?v=fdce023';
import magazyny from './modules/magazyny.js?v=fdce023';
import produkty from './modules/produkty.js?v=fdce023';
import klienci from './modules/klienci.js?v=fdce023';
import uzytkownicy from './modules/uzytkownicy.js?v=fdce023';
import zamowienia from './modules/zamowienia.js?v=fdce023';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
