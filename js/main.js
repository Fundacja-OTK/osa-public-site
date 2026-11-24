// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=dc14c8f';
import licencje from './modules/licencje.js?v=dc14c8f';
import magazyny from './modules/magazyny.js?v=dc14c8f';
import produkty from './modules/produkty.js?v=dc14c8f';
import klienci from './modules/klienci.js?v=dc14c8f';
import uzytkownicy from './modules/uzytkownicy.js?v=dc14c8f';
import zamowienia from './modules/zamowienia.js?v=dc14c8f';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
