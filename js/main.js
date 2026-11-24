// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=79bd162';
import licencje from './modules/licencje.js?v=79bd162';
import magazyny from './modules/magazyny.js?v=79bd162';
import produkty from './modules/produkty.js?v=79bd162';
import klienci from './modules/klienci.js?v=79bd162';
import uzytkownicy from './modules/uzytkownicy.js?v=79bd162';
import zamowienia from './modules/zamowienia.js?v=79bd162';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
