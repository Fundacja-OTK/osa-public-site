// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=7182c5b';
import licencje from './modules/licencje.js?v=7182c5b';
import magazyny from './modules/magazyny.js?v=7182c5b';
import produkty from './modules/produkty.js?v=7182c5b';
import klienci from './modules/klienci.js?v=7182c5b';
import uzytkownicy from './modules/uzytkownicy.js?v=7182c5b';
import zamowienia from './modules/zamowienia.js?v=7182c5b';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
