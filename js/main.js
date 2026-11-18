// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js';
import licencje from './modules/licencje.js';
import magazyny from './modules/magazyny.js';
import zamowienia from './modules/zamowienia.js';

startShell([licencje, magazyny, zamowienia]);
