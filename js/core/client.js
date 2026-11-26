// Wspólny klient API panelu (konfiguracja z config.js + sesja z logowania kontem Selly — core/auth.js) i kontekst sesji.
import { createApi } from './api.js?v=9f53658';
import { freshToken } from './auth.js?v=9f53658';
import { reportApiFailure } from './errorHook.js?v=9f53658';
import { bindWriteState } from './ui.js?v=9f53658';
import { denyReason, isWriteAction, GRANTABLE } from '../lib/panelAuth.js?v=9f53658';

export const ENV = window.OSA_CONFIG || {}; // { backendUrl, version, backends } — config.js
// Jeden klient i jeden kontekst na kartę (globalThis): gdy w karcie miesza się kod dwóch wdrożeń (client.js pod innym ?v= — core/router.js),
// druga kopia pliku korzysta z tych samych danych startowych (ctx.boot) i stanu backendów, zamiast zaczynać od pustych.
const G = typeof globalThis !== 'undefined' ? globalThis : window;
const client = G.__osaClient || (G.__osaClient = createApi({ config: ENV, getToken: freshToken, onFailure: reportApiFailure, timeouts: ENV.timeouts }));
/**
 * Zapis bez prawa zmian (zgoda administratora — docs/auth.md) kończy się od razu tym samym komunikatem co na serwerze, bez zapytania.
 * Serwer sprawdza to i tak (to tylko szybsza i czytelniejsza odpowiedź).
 */
export function api(action, params, retried) {
  const b = ctx.boot;
  const write = isWriteAction(action);
  if (b && Array.isArray(b.write) && write) {
    const msg = denyReason({ perms: b.perms || [], write: b.write, admin: !!b.isAdmin }, action, params || {});
    if (msg) return Promise.reject(Object.assign(new Error(msg), { code: 403 }));
  }
  const p = client.api(action, params, retried);
  if (write) busyWhile(p);
  return p;
}

// ─── Natychmiastowa informacja zwrotna: przycisk, który uruchomił zapis, jest „zajęty” do końca zapisu ───
// (wszystkie moduły naraz; drugi klik nie wyśle zapisu drugi raz). Przycisk = ostatnio kliknięty w ciągu 1,5 s
// albo kliknięty w tym samym zdarzeniu (np. po oknie potwierdzenia). Bez zmiany wymiarów — tylko wygląd i kursor (base.css .is-busy).
let lastBtn = null, lastAt = 0;
if (typeof document !== 'undefined') document.addEventListener('click', ev => {
  const t = ev.target && ev.target.closest && ev.target.closest('button, [role=menuitem]');
  lastBtn = !t ? null : t.matches('[role=menuitem]') ? ((t.closest('.menu') || {}).querySelector?.(':scope > button') || t) : t;
  lastAt = Date.now();
}, true);
function busyWhile(p) {
  const btn = lastBtn;
  const sameClick = typeof window !== 'undefined' && window.event && window.event.type === 'click';   // np. zapis zaraz po confirm()
  if (!btn || !btn.isConnected || (!sameClick && Date.now() - lastAt > 1500)) return;
  btn.__busy = (btn.__busy || 0) + 1;
  btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true');
  const end = () => { if (--btn.__busy > 0) return; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); };
  p.then(end, end);
}
/** Czy w sekcji wolno zmieniać (administrator albo zgoda administratora; natywne ekrany i sekcje tylko do odczytu — zawsze). */
export const canWriteSection = id => { const b = ctx.boot; return !b || !Array.isArray(b.write) || !GRANTABLE.includes(id) || !!b.isAdmin || b.write.includes(id); };   // bez listy (stary backend) — decyduje serwer
export const READONLY_TIP = 'Zmiany w tej sekcji wymagają zgody administratora panelu. Podgląd masz z uprawnień w Selly; zgodę nadaje administrator w Konto → Kto się logował.';
export const apiInfo = client.apiInfo;
export const onApiInfo = client.onInfo;

/** Kontekst sesji: boot = odpowiedź akcji „init” (email, year, statuses, products, sync, adminUrl…). */
export const ctx = G.__osaCtx || (G.__osaCtx = { boot: null });
bindWriteState(() => ctx.boot, GRANTABLE);
