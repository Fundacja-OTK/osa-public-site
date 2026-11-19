// Wspólny klient API panelu (konfiguracja z config.js + logowanie GIS) i kontekst sesji.
import { createApi } from './api.js?v=7182c5b';
import { freshToken } from './auth.js?v=7182c5b';
import { reportApiFailure } from './errorHook.js?v=7182c5b';

export const ENV = window.OSA_CONFIG || {}; // { backendUrl, clientId, version, backends? } — config.js
const client = createApi({ config: ENV, getToken: freshToken, onFailure: reportApiFailure });
export const api = client.api;
export const apiInfo = client.apiInfo;
export const onApiInfo = client.onInfo;

/** Kontekst sesji: boot = odpowiedź akcji „init” (email, year, statuses, products, sync, adminUrl…). */
export const ctx = { boot: null };
