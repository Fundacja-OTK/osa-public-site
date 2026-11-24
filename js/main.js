// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=ff05c52';
import licencje from './modules/licencje.js?v=ff05c52';
import magazyny from './modules/magazyny.js?v=ff05c52';
import produkty from './modules/produkty.js?v=ff05c52';
import klienci from './modules/klienci.js?v=ff05c52';
import uzytkownicy from './modules/uzytkownicy.js?v=ff05c52';
import zamowienia from './modules/zamowienia.js?v=ff05c52';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
