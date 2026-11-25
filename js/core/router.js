// Router hash: #/<moduł>[/<podwidok>...], np. #/licencje, #/licencje/orszaki, #/magazyny/stany.
// Moduł rejestruje się obiektem { id, title, icon?, routes, mount(el, params), unmount() }:
//   routes  — lista podwidoków (pierwszy = domyślny), tylko informacyjnie / do nawigacji
//   mount   — pokaż moduł w kontenerze `el`; wołane przy każdej zmianie trasy w obrębie modułu (ma być idempotentne)
//   unmount — moduł przestaje być widoczny (stan zostaje; kontener jest tylko ukrywany)
//   load    — (zamiast mount) moduł wczytywany przy pierwszym wejściu: async () => moduł; podmieniany w rejestrze.
//             Na czas wczytywania kontener modułu pokazuje szkielet (hooks.loading) i nagłówek strony (onLoading) — nigdy pusty obszar.
//   prefetch — (opcjonalnie, przy load) wstępne wczytanie bez pokazywania, np. po najechaniu na pozycję menu (prefetch(id))
// params = { parts: ['orszaki'], view: 'orszaki' | '', query: URLSearchParams } (query = część po „?” w hashu, np. #/zamowienia?status=9).

//
// Odporność (ekran nigdy nie zostaje pusty ani ze szkieletem na zawsze):
//   • błąd wczytania kodu modułu (load) albo wyjątek w mount (także odrzucony Promise z async mount) → w kontenerze modułu komunikat
//     z przyciskiem „Spróbuj ponownie” (hooks.failed), a nie cichy powrót na trasę domyślną;
//   • jeden router na kartę: stan trzymany w globalThis.__osaRouter. Po wdrożeniu nowej wersji przy otwartej karcie (albo ze starym index.html
//     z pamięci przeglądarki) leniwie wczytany moduł może zaimportować router.js pod nowym ?v= — druga kopia pliku korzysta wtedy z tego
//     samego stanu (rejestr modułów, kontener, bieżąca trasa), więc go('/x', { replace: true }) z nowego modułu dalej działa,
//     a powłoka dostaje zdarzenie „osa:skew” (pasek „Jest nowa wersja panelu”).

function createRouter() {
  const modules = new Map();
  const hooks = { container: null, onRoute: null, onLoading: null, loading: null, fallback: null, failed: null };
  let current = null; // { mod, el }
  let leaveGuard = null, lastHash = null;
  const extraGuards = [];
  let resolveSeq = 0;

  function register(mod) {
    if (!mod || !mod.id) throw new Error('Moduł bez id');
    modules.set(mod.id, mod);
    return mod;
  }
  const getModule = id => modules.get(id) || null;
  function prefetch(id) {
    const m = modules.get(id);
    if (m && m.load && !m.mount && m.prefetch) m.prefetch();
  }
  const listModules = () => [...modules.values()];

  function go(path, opts) {
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

  // Strażnik wyjścia (np. niezapisane zmiany w karcie): zwraca komunikat → potwierdzenie; „Anuluj” przywraca poprzedni adres.
  // Dodatkowe strażniki (kilka modułów naraz, np. karta produktu obok karty zamówienia): każdy zwraca komunikat albo null.
  function guardMessage(hash) {
    for (const g of [leaveGuard, ...extraGuards]) { const m = g && g(hash); if (m) return m; }
    return null;
  }

  /** Ukrywa bieżący moduł i pokazuje kontener `el` (moduł `mod`). */
  function switchTo(mod, el) {
    if (current && current.mod !== mod && current.el !== el) {
      try { current.mod.unmount && current.mod.unmount(); } catch (e) { /* nie blokuje przejścia */ }
      current.el.hidden = true;
    }
    el.hidden = false;
  }

  /** Szkielet w kontenerze modułu na czas pobierania jego kodu (zamiast pustego obszaru); usuwany przed mount(). */
  function showLoading(stub, params) {
    if (!hooks.loading) return null;
    const el = containerFor(stub);
    switchTo(stub, el);
    current = { mod: stub, el };
    if (hooks.onLoading) { try { hooks.onLoading(stub, params); } catch (e) { /* tylko nagłówek */ } }
    const box = hooks.loading();
    box.setAttribute('data-router-loading', '');
    el.prepend(box);
    return box;
  }

  const clearFailure = el => { for (const n of el.querySelectorAll(':scope > [data-router-error]')) n.remove(); };
  /** Komunikat o błędzie wczytania / pokazania ekranu z „Spróbuj ponownie” (ponawia bieżącą trasę) — zamiast pustej strony. */
  function showFailure(mod, el, err, phase) {
    try { console.error(err); } catch (e) { /* bez konsoli */ }
    clearFailure(el);
    const retry = () => { clearFailure(el); resolve(); };
    let box = null;
    try { box = hooks.failed && hooks.failed({ mod, err, phase, retry }); } catch (e) { box = null; }
    if (!box) {
      box = document.createElement('div');
      box.className = 'notice error';
      box.textContent = 'Nie udało się ' + (phase === 'load' ? 'wczytać' : 'pokazać') + ' ekranu. ';
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'secondary'; b.textContent = 'Spróbuj ponownie'; b.onclick = retry;
      box.append(b);
    }
    box.setAttribute('data-router-error', phase);
    el.prepend(box);
  }

  async function resolve() {
    const seq = ++resolveSeq;
    if (lastHash !== null && location.hash !== lastHash) {
      const msg = guardMessage(location.hash);
      if (msg && !confirm(msg)) { history.replaceState(null, '', lastHash); return; }
    }
    lastHash = location.hash;
    const { id, parts, query } = parseHash(location.hash);
    const params = { parts, view: parts[0] || '', query };
    let mod = modules.get(id);
    if (mod && mod.load && !mod.mount) {
      const stub = mod, box = showLoading(stub, params);
      let err = null;
      try {
        const m = await stub.load();
        if (!m || typeof m.mount !== 'function') throw new Error('Moduł „' + id + '” nie ma funkcji mount');
        modules.set(id, m); mod = m;
      } catch (e) { err = e; }
      if (box) box.remove();
      if (seq !== resolveSeq) return;
      // kod ekranu się nie wczytał (sieć, chwilowy błąd serwera plików) — komunikat z ponowieniem w miejscu ekranu, adres zostaje
      if (err) {
        const el = containerFor(stub);
        switchTo(stub, el); current = { mod: stub, el };
        showFailure(stub, el, err, 'load');
        return;
      }
    }
    if (!mod) { const d = hooks.fallback && hooks.fallback(); if (d) go(d, { replace: true }); return; }
    const el = containerFor(mod);
    switchTo(mod, el);
    current = { mod, el };
    clearFailure(el);
    if (hooks.onRoute) { try { hooks.onRoute(mod, params); } catch (e) { console.error(e); } }
    const failed = e => { if (seq === resolveSeq) showFailure(mod, el, e, 'mount'); else console.error(e); };
    try {
      const r = mod.mount(el, params);
      if (r && typeof r.then === 'function') r.then(null, failed);   // async mount: błąd po pierwszym await też kończy się komunikatem
    } catch (e) { failed(e); }
  }

  function startRouter(o) {
    hooks.container = o.container; hooks.fallback = o.fallback; hooks.onRoute = o.onRoute || null;
    hooks.onLoading = o.onLoading || null; hooks.loading = o.loading || null; hooks.failed = o.failed || null;
    window.addEventListener('hashchange', resolve);
    resolve();
  }

  return {
    register, getModule, prefetch, listModules, go, startRouter,
    setLeaveGuard: fn => { leaveGuard = fn; },
    addLeaveGuard: fn => { extraGuards.push(fn); },
    leaveMessage: () => guardMessage(location.hash),
  };
}

export function parseHash(hash) {
  const full = String(hash || '').replace(/^#\/?/, '');
  const qi = full.indexOf('?');
  const query = new URLSearchParams(qi < 0 ? '' : full.slice(qi + 1));
  const parts = (qi < 0 ? full : full.slice(0, qi)).split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  return { id: parts[0] || '', parts: parts.slice(1), query };
}

const G = typeof globalThis !== 'undefined' ? globalThis : window;
const SELF = import.meta.url;
if (!G.__osaRouter) G.__osaRouter = Object.assign(createRouter(), { url: SELF });
else if (G.__osaRouter.url !== SELF) {
  // druga kopia router.js pod innym adresem (?v= innej wersji) = w karcie miesza się kod dwóch wdrożeń
  try { window.dispatchEvent(new CustomEvent('osa:skew', { detail: { file: 'router.js' } })); } catch (e) { /* tylko informacja */ }
}
const R = G.__osaRouter;

export const register = mod => R.register(mod);
export const getModule = id => R.getModule(id);
/** Wstępne wczytanie modułu trasy (bez pokazywania); nic nie robi dla modułów już wczytanych i nieznanych tras. */
export const prefetch = id => R.prefetch(id);
export const listModules = () => R.listModules();
/** Przejście do trasy: go('/magazyny/stany'). Ta sama trasa nie wywoła zdarzenia — wołamy ręcznie. */
export const go = (path, opts) => R.go(path, opts);
export const setLeaveGuard = fn => R.setLeaveGuard(fn);
export const addLeaveGuard = fn => R.addLeaveGuard(fn);
/** Komunikat strażnika dla bieżącego adresu (np. niezapisane zmiany) albo null — dla odświeżenia strony poza routerem. */
export const leaveMessage = () => R.leaveMessage();
/**
 * @param {{ container: HTMLElement, fallback: () => string, onRoute?: (mod, params) => void }} o
 *   fallback — trasa domyślna (np. '/licencje'), gdy hash jest pusty albo nieznany
 *   loading  — () => element szkieletu na czas wczytywania kodu modułu; onLoading(stub, params) — np. tytuł strony od razu
 *   failed   — ({ mod, err, phase: 'load'|'mount', retry }) => element komunikatu o błędzie (z przyciskiem wołającym retry)
 */
export const startRouter = o => R.startRouter(o);
