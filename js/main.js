// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=58f006c';
import licencje from './modules/licencje.js?v=58f006c';
import magazyny from './modules/magazyny.js?v=58f006c';
import produkty from './modules/produkty.js?v=58f006c';
import klienci from './modules/klienci.js?v=58f006c';
import uzytkownicy from './modules/uzytkownicy.js?v=58f006c';
import zamowienia from './modules/zamowienia.js?v=58f006c';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
