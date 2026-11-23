// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=9fd5e04';
import licencje from './modules/licencje.js?v=9fd5e04';
import magazyny from './modules/magazyny.js?v=9fd5e04';
import produkty from './modules/produkty.js?v=9fd5e04';
import klienci from './modules/klienci.js?v=9fd5e04';
import uzytkownicy from './modules/uzytkownicy.js?v=9fd5e04';
import zamowienia from './modules/zamowienia.js?v=9fd5e04';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
