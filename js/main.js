// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=5aa9759';
import licencje from './modules/licencje.js?v=5aa9759';
import magazyny from './modules/magazyny.js?v=5aa9759';
import produkty from './modules/produkty.js?v=5aa9759';
import klienci from './modules/klienci.js?v=5aa9759';
import uzytkownicy from './modules/uzytkownicy.js?v=5aa9759';
import zamowienia from './modules/zamowienia.js?v=5aa9759';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
