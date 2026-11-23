// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=be6c33d';
import licencje from './modules/licencje.js?v=be6c33d';
import magazyny from './modules/magazyny.js?v=be6c33d';
import produkty from './modules/produkty.js?v=be6c33d';
import klienci from './modules/klienci.js?v=be6c33d';
import uzytkownicy from './modules/uzytkownicy.js?v=be6c33d';
import zamowienia from './modules/zamowienia.js?v=be6c33d';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
