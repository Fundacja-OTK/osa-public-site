// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js';
import licencje from './modules/licencje.js';
import magazyny from './modules/magazyny.js';
import produkty from './modules/produkty.js';
import klienci from './modules/klienci.js';
import uzytkownicy from './modules/uzytkownicy.js';
import zamowienia from './modules/zamowienia.js';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
