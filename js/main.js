// Punkt wejścia panelu OSA: rejestruje moduły i uruchamia powłokę (logowanie → nawigacja → router).
import { startShell } from './core/shell.js';
import licencje from './modules/licencje.js';
import magazyny from './modules/magazyny.js';

startShell([licencje, magazyny]);
