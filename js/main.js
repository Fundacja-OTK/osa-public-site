// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=ecaba1a';
import licencje from './modules/licencje.js?v=ecaba1a';
import magazyny from './modules/magazyny.js?v=ecaba1a';
import produkty from './modules/produkty.js?v=ecaba1a';
import klienci from './modules/klienci.js?v=ecaba1a';
import uzytkownicy from './modules/uzytkownicy.js?v=ecaba1a';
import zamowienia from './modules/zamowienia.js?v=ecaba1a';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
