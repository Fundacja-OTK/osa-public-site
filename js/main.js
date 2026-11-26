// Punkt wejścia panelu OSA: uruchamia powłokę (logowanie → nawigacja → router). Moduły ekranów wczytuje router przy pierwszym
// wejściu na trasę (core/shell.js, LAZY) — start pobiera tylko rdzeń, a nie kod wszystkich ekranów.
import { startShell } from './core/shell.js?v=9f53658';

startShell();
