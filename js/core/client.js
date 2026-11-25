// Wspólny klient API panelu (konfiguracja z config.js + sesja z logowania kontem Selly — core/auth.js) i kontekst sesji.
import { createApi } from './api.js?v=6d8ea70';
import { freshToken } from './auth.js?v=6d8ea70';
import { reportApiFailure } from './errorHook.js?v=6d8ea70';
import { bindWriteState } from './ui.js?v=6d8ea70';
import { denyReason, isWriteAction, GRANTABLE } from '../lib/panelAuth.js?v=6d8ea70';

export const ENV = window.OSA_CONFIG || {}; // { backendUrl, version, backends } — config.js
const client = createApi({ config: ENV, getToken: freshToken, onFailure: reportApiFailure });
/**
 * Zapis bez prawa zmian (zgoda administratora — docs/auth.md) kończy się od razu tym samym komunikatem co na serwerze, bez zapytania.
 * Serwer sprawdza to i tak (to tylko szybsza i czytelniejsza odpowiedź).
 */
export function api(action, params, retried) {
  const b = ctx.boot;
  if (b && Array.isArray(b.write) && isWriteAction(action)) {
    const msg = denyReason({ perms: b.perms || [], write: b.write, admin: !!b.isAdmin }, action, params || {});
    if (msg) return Promise.reject(Object.assign(new Error(msg), { code: 403 }));
  }
  return client.api(action, params, retried);
}
/** Czy w sekcji wolno zmieniać (administrator albo zgoda administratora; natywne ekrany i sekcje tylko do odczytu — zawsze). */
export const canWriteSection = id => { const b = ctx.boot; return !b || !Array.isArray(b.write) || !GRANTABLE.includes(id) || !!b.isAdmin || b.write.includes(id); };   // bez listy (stary backend) — decyduje serwer
export const READONLY_TIP = 'Zmiany w tej sekcji wymagają zgody administratora panelu. Podgląd masz z uprawnień w Selly; zgodę nadaje administrator w Konto → Kto się logował.';
export const apiInfo = client.apiInfo;
export const onApiInfo = client.onInfo;

/** Kontekst sesji: boot = odpowiedź akcji „init” (email, year, statuses, products, sync, adminUrl…). */
export const ctx = { boot: null };
bindWriteState(() => ctx.boot, GRANTABLE);
