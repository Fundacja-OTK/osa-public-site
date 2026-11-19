// Most z rozszerzeniem OSA: rozszerzenie (content/panelBridge.js) ustawia <html data-osa-ext="wersja">.
// Wiadomości przyjmujemy wyłącznie z własnego okna i własnego pochodzenia strony.
export function hasExtension() { return !!extVersion(); }
export function extVersion() { return (document.documentElement.getAttribute('data-osa-ext') || '').trim(); }

/** Czy wiadomość pochodzi z tej strony (a nie z innej ramki/okna)? Czysta funkcja — testowana jednostkowo. */
export function isTrustedMessage(ev, win = window) {
  return !!ev && ev.source === win && ev.origin === win.location.origin;
}

/** Ping → wersja rozszerzenia albo null po timeoutcie (np. rozszerzenie wyłączone). */
export function pingExtension(timeoutMs = 800) {
  return new Promise(resolve => {
    const done = v => { clearTimeout(t); window.removeEventListener('message', on); resolve(v); };
    const on = ev => { if (isTrustedMessage(ev) && ev.data && ev.data.osa === 'pong') done(String(ev.data.version || '')); };
    const t = setTimeout(() => done(null), timeoutMs);
    window.addEventListener('message', on);
    window.postMessage({ osa: 'ping' }, window.location.origin);
  });
}
