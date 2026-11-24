// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js?v=0b00058';
import licencje from './modules/licencje.js?v=0b00058';
import magazyny from './modules/magazyny.js?v=0b00058';
import produkty from './modules/produkty.js?v=0b00058';
import klienci from './modules/klienci.js?v=0b00058';
import uzytkownicy from './modules/uzytkownicy.js?v=0b00058';
import zamowienia from './modules/zamowienia.js?v=0b00058';

startShell([licencje, magazyny, zamowienia, produkty, klienci, uzytkownicy]);
