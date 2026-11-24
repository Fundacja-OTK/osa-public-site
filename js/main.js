// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=28c8ac7';
import licencje from './modules/licencje.js?v=28c8ac7';
import magazyny from './modules/magazyny.js?v=28c8ac7';
import produkty from './modules/produkty.js?v=28c8ac7';
import klienci from './modules/klienci.js?v=28c8ac7';
import uzytkownicy from './modules/uzytkownicy.js?v=28c8ac7';
import zamowienia from './modules/zamowienia.js?v=28c8ac7';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
