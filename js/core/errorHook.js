// Połączenie klienta API z raportowaniem błędów: client.js tworzy API przed startem powłoki, a raport powstaje później
// (shell.js → setReporter) — do tego czasu nieudane wywołania nie są zgłaszane.
let reporter = null;
export function setReporter(r) { reporter = r; }
export function reportApiFailure(f) {
  if (reporter) reporter.report({ message: 'api ' + f.action + ' [' + f.backend + ']: ' + f.message, kind: 'api' });
}
