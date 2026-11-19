// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=dbba09c';
import licencje from './modules/licencje.js?v=dbba09c';
import magazyny from './modules/magazyny.js?v=dbba09c';
import produkty from './modules/produkty.js?v=dbba09c';
import klienci from './modules/klienci.js?v=dbba09c';
import uzytkownicy from './modules/uzytkownicy.js?v=dbba09c';
import zamowienia from './modules/zamowienia.js?v=dbba09c';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
