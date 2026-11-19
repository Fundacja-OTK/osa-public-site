// Wspólny rejestr skrótów klawiszowych. Skróty globalne i skróty ekranu (moduł rejestruje je z opisem — widać je w oknie „?”).
// Ignorowane podczas pisania w polach (input / textarea / select / contenteditable) — poza Ctrl/Cmd+K.
// Nigdy nie nadpisują skrótów przeglądarki (Ctrl/Cmd/Alt + klawisz poza Ctrl/Cmd+K).

/** „G, potem Z/P/K/M” = przejście do ekranu. */
export const GOTO = { z: 'zamowienia', p: 'produkty', k: 'klienci', m: 'magazyny' };
const SEQ_MS = 1500;

export function isTyping(t) {
  if (!t) return false;
  const tag = String(t.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !/^(checkbox|radio|button|submit|reset|file|range|color|image)$/i.test(t.type || 'text');
  return !!t.isContentEditable;
}

const normKey = k => (k === ' ' ? 'space' : String(k || '').toLowerCase());

/**
 * Wpis: { keys: ['f'] | ['g z'] | ['arrowdown', 'j'] | ['ctrl+k'], label: 'F', desc, run(e) — false = nie obsłużono }.
 * opts: { blocked(): bool — np. otwarte okno dialogowe, now(): ms }.
 */
export function createRegistry(opts) {
  const o = opts || {};
  const now = o.now || (() => Date.now());
  const scopes = new Map();   // 'global' | id ekranu → wpisy
  let screen = '';
  let pending = null;         // { k, t } — pierwszy klawisz sekwencji

  const active = () => (scopes.get(screen) || []).concat(scopes.get('global') || []);
  const find = key => active().find(e => e.keys.includes(key));

  return {
    /** Zastępuje komplet skrótów danego zakresu (idempotentne — moduł może wołać przy każdym mount). */
    scope(id, entries) { scopes.set(id, entries.map(e => ({ ...e, keys: e.keys.map(k => k.toLowerCase()) }))); },
    setScreen(id) { screen = id || ''; pending = null; },
    screen: () => screen,
    list(id) { return (scopes.get(id) || []).map(e => ({ label: e.label, desc: e.desc, keys: e.keys })); },
    /** Zwraca true, gdy zdarzenie obsłużono. */
    handle(e) {
      if (e.defaultPrevented || e.isComposing) return false;
      const key = normKey(e.key), mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && key === 'k') {
        const en = (scopes.get('global') || []).find(x => x.keys.includes('ctrl+k'));
        if (!en) return false;
        e.preventDefault(); en.run(e); return true;
      }
      if (mod || e.altKey) return false;
      if (o.blocked && o.blocked()) return false;
      if (isTyping(e.target)) { pending = null; return false; }
      if (key === 'shift' || key === 'control' || key === 'alt' || key === 'meta') return false;
      if (pending && now() - pending.t <= SEQ_MS) {
        const en = find(pending.k + ' ' + key);
        pending = null;
        if (en && en.run(e) !== false) { e.preventDefault(); return true; }
        return false;
      }
      pending = null;
      if (active().some(x => x.keys.some(k => k.startsWith(key + ' ')))) { pending = { k: key, t: now() }; return false; }
      const en = find(key);
      if (!en || en.run(e) === false) return false;
      e.preventDefault();
      return true;
    },
  };
}

/** Dopisuje klawisz do podpowiedzi (title) elementu: „Filtry…” → „Filtry… (skrót: F)”. */
export function addKeyTip(node, label) {
  if (!node || !label) return node;
  const t = node.getAttribute('title') || '';
  if (!t.includes('(skrót:')) node.setAttribute('title', (t ? t + ' ' : '') + '(skrót: ' + label + ')');
  return node;
}

export const shortcuts = createRegistry({ blocked: () => typeof document !== 'undefined' && !!document.querySelector('.pal-overlay') });
export function installShortcuts(doc) { (doc || document).addEventListener('keydown', e => shortcuts.handle(e)); }
