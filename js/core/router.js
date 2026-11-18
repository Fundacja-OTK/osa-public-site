// Router hash: #/<moduł>[/<podwidok>...], np. #/licencje, #/licencje/orszaki, #/magazyny/stany.
// Moduł rejestruje się obiektem { id, title, icon?, routes, mount(el, params), unmount() }:
//   routes  — lista podwidoków (pierwszy = domyślny), tylko informacyjnie / do nawigacji
//   mount   — pokaż moduł w kontenerze `el`; wołane przy każdej zmianie trasy w obrębie modułu (ma być idempotentne)
//   unmount — moduł przestaje być widoczny (stan zostaje; kontener jest tylko ukrywany)
// params = { parts: ['orszaki'], view: 'orszaki' | '', query: URLSearchParams } (query = część po „?” w hashu, np. #/zamowienia?status=9).

const modules = new Map();
const hooks = { container: null, onRoute: null, fallback: null };
let current = null; // { mod, el }

export function register(mod) {
  if (!mod || !mod.id) throw new Error('Moduł bez id');
  modules.set(mod.id, mod);
  return mod;
}
export const getModule = id => modules.get(id) || null;
export const listModules = () => [...modules.values()];

export function parseHash(hash) {
  const full = String(hash || '').replace(/^#\/?/, '');
  const qi = full.indexOf('?');
  const query = new URLSearchParams(qi < 0 ? '' : full.slice(qi + 1));
  const parts = (qi < 0 ? full : full.slice(0, qi)).split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  return { id: parts[0] || '', parts: parts.slice(1), query };
}

/** Przejście do trasy: go('/magazyny/stany'). Ta sama trasa nie wywoła zdarzenia — wołamy ręcznie. */
export function go(path, opts) {
  const h = '#/' + String(path).replace(/^[#/]+/, '');
  if (opts && opts.replace) history.replaceState(null, '', h); else if (location.hash !== h) location.hash = h;
  if (opts && opts.replace) resolve();
}

function containerFor(mod) {
  let el = document.getElementById('mod-' + mod.id);
  if (!el) {
    el = document.createElement('section');
    el.id = 'mod-' + mod.id;
    el.className = 'module';
    el.hidden = true;
    el.setAttribute('aria-label', mod.title || mod.id);
    hooks.container.append(el);
  }
  return el;
}

function resolve() {
  const { id, parts, query } = parseHash(location.hash);
  const mod = modules.get(id);
  if (!mod) { const d = hooks.fallback && hooks.fallback(); if (d) go(d, { replace: true }); return; }
  const el = containerFor(mod);
  if (current && current.mod !== mod) {
    try { current.mod.unmount && current.mod.unmount(); } catch (e) { /* nie blokuje przejścia */ }
    current.el.hidden = true;
  }
  el.hidden = false;
  current = { mod, el };
  const params = { parts, view: parts[0] || '', query };
  if (hooks.onRoute) hooks.onRoute(mod, params);
  mod.mount(el, params);
}

/**
 * @param {{ container: HTMLElement, fallback: () => string, onRoute?: (mod, params) => void }} o
 *   fallback — trasa domyślna (np. '/licencje'), gdy hash jest pusty albo nieznany
 */
export function startRouter(o) {
  hooks.container = o.container; hooks.fallback = o.fallback; hooks.onRoute = o.onRoute || null;
  window.addEventListener('hashchange', resolve);
  resolve();
}
