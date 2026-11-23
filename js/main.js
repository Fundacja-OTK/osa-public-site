// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=8725b34';
import licencje from './modules/licencje.js?v=8725b34';
import magazyny from './modules/magazyny.js?v=8725b34';
import produkty from './modules/produkty.js?v=8725b34';
import klienci from './modules/klienci.js?v=8725b34';
import uzytkownicy from './modules/uzytkownicy.js?v=8725b34';
import zamowienia from './modules/zamowienia.js?v=8725b34';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
