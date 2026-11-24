// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=5b9e0d7';
import licencje from './modules/licencje.js?v=5b9e0d7';
import magazyny from './modules/magazyny.js?v=5b9e0d7';
import produkty from './modules/produkty.js?v=5b9e0d7';
import klienci from './modules/klienci.js?v=5b9e0d7';
import uzytkownicy from './modules/uzytkownicy.js?v=5b9e0d7';
import zamowienia from './modules/zamowienia.js?v=5b9e0d7';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
