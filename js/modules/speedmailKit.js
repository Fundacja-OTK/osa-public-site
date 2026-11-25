// „Wysyłka SpeedMail” — wspólny stan i klocki zakładek (speedmail.js + speedmailZam / Stan / Paczki / Tempo / Ust).
// Dane (sm:init / sm:list / sm:pace) są trzymane w pamięci i w sessionStorage (same numery zamówień, daty, produkty i liczby —
// żadnych danych klientów), więc strona rysuje się od razu z ostatniej kopii i odświeża w tle. Bez odpytywania w pętli.
import { $, el, flash, buildXlsx, saveBlob, tableTsv, tableHtml, copyToClipboard } from '../core/ui.js?v=f06e90b';
import { api, ctx } from '../core/client.js?v=f06e90b';
import { setStatusInChunks } from '../lib/statusBatch.js?v=f06e90b';
import { liveRefresh, changedIds } from '../core/liveRefresh.js?v=f06e90b';
import { SM } from '../lib/speedmailLogic.js?v=f06e90b';

export { SM };
export const WRITE = ['magazyny'];                       // jak reguła sm:* (shared/panelAuth.js)
export const STATUS_WRITE = ['zamowienia', 'przesylki'];   // jak reguła orders:setStatus
export const FRESH_MS = 60e3;                            // młodszych danych nie odświeżamy przy przełączaniu zakładek

export const S = {
  view: 'zamowienia', query: new URLSearchParams(), err: '', rerender: () => {},
  d: null, list: null, pace: null,                       // wpisy pamięci: { t, v }
  loading: { init: false, list: false, pace: false }, errs: { init: '', list: '', pace: '' },
  since: { init: 0, list: 0, pace: 0 }, retryAt: { init: 0, list: 0, pace: 0 }, mounted: false,   // początek pobierania; kiedy automatyczne ponowienie
  sel: new Set(), dlg: null, job: null, busy: false, lastBatch: null, flashIds: null,
};

// ─── Pamięć podręczna (stale-while-revalidate) ──────────────────────────────
// SNAP — wersja układu kopii w sessionStorage; kopia innej wersji albo bez wymaganych pól (np. sprzed wdrożenia, które zmieniło sm:init)
// jest pomijana — inaczej widok rysowany ze starej kopii rzucał wyjątkiem i ekran zostawał pusty (bez błędu, bez ponowienia).
export const SNAP = 2;
const SHAPE = {
  init: v => !!(v && v.cfg && Array.isArray(v.cfg.products) && Array.isArray(v.orders) && Array.isArray(v.statuses) && v.use && Array.isArray(v.use.open) && typeof v.today === 'string'),
  list: v => !!(v && Array.isArray(v.batches) && Array.isArray(v.moves)),
  pace: v => !!(v && Array.isArray(v.rows)),
};
export const validSnapshot = (kind, e) => !!(e && e.t && e.s === SNAP && SHAPE[kind] && SHAPE[kind](e.v));
const mem = new Map();
const keyOf = k => 'osa-sm:' + ((ctx.boot && ctx.boot.email) || '') + ':' + k;
/** Ostatnia kopia danych. Kopia sprzed przeładowania strony (stored) jest pokazywana, ale zawsze odświeżana w tle. */
function cached(k) {
  const key = keyOf(k);
  if (mem.has(key)) return mem.get(key);
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const e = JSON.parse(raw);
      if (validSnapshot(k, e)) { e.stored = true; mem.set(key, e); return e; }
      sessionStorage.removeItem(key);   // stary układ — pobierzemy świeże dane
    }
  } catch (e) { /* brak pamięci sesji albo uszkodzony wpis */ }
  return null;
}
function remember(k, v) {
  const key = keyOf(k), e = { t: Date.now(), s: SNAP, v };
  mem.set(key, e);
  try { const s = JSON.stringify(e); if (s.length < 1.5e6) sessionStorage.setItem(key, s); else sessionStorage.removeItem(key); } catch (x) { /* pełna pamięć — zostaje kopia w pamięci karty */ }
  return e;
}
function forget(k) { mem.delete(keyOf(k)); try { sessionStorage.removeItem(keyOf(k)); } catch (e) { /* ok */ } }

const ACTION = { init: 'sm:init', list: 'sm:list', pace: 'sm:pace' }, SLOT = { init: 'd', list: 'list', pace: 'pace' };
const running = {};
// Automatyczne ponowienie po błędzie pobrania (sieć, przekroczony czas, serwer zapasowy bez nadzoru SpeedMail): po 3 s, 10 s, potem co 30 s,
// tylko gdy ekran jest otwarty. Ostatnia kopia (jeśli jest) zostaje na ekranie z komunikatem; „Spróbuj ponownie” — od razu.
export const RETRY_MS = [3000, 10000, 30000];
// Gdy pierwsze pobranie (bez kopii) trwa dłużej — komunikat „serwer odpowiada wolniej”, zamiast samego szkieletu
export const SLOW_MS = 8000;
const retries = { init: 0, list: 0, pace: 0 }, retryTimer = {};
function scheduleRetry(kind) {
  clearTimeout(retryTimer[kind]);
  const ms = RETRY_MS[Math.min(retries[kind], RETRY_MS.length - 1)];
  retries[kind]++;
  S.retryAt[kind] = Date.now() + ms;
  retryTimer[kind] = setTimeout(() => { S.retryAt[kind] = 0; if (S.mounted && S.errs[kind]) ensure(kind, true); }, ms);
}
/** Po wejściu na ekran: zaległe ponowienie (ekran był zamknięty, gdy minął jego czas) — od razu. */
export function resumeRetries() { for (const k of Object.keys(retries)) if (S.errs[k] && !running[k] && !S.retryAt[k]) ensure(k, true); }
/**
 * Dane zakładki: od razu ostatnia kopia (jeśli jest), a w tle świeże — chyba że kopia ma mniej niż minutę (force = zawsze pobierz).
 * Równoległe wywołania tej samej akcji łączą się w jedno zapytanie.
 */
export function ensure(kind, force) {
  const slot = SLOT[kind];
  if (!S[slot]) S[slot] = cached(kind);
  if (!force && S[slot] && !S[slot].stored && Date.now() - S[slot].t < FRESH_MS) return Promise.resolve(S[slot]);
  if (running[kind]) return running[kind];
  S.loading[kind] = true; S.since[kind] = Date.now();
  clearTimeout(retryTimer[kind]); S.retryAt[kind] = 0;
  if (kind === 'init') S.flashIds = null;
  const slow = setTimeout(() => { if (running[kind]) S.rerender(); }, SLOW_MS);
  running[kind] = Promise.resolve().then(() => api(ACTION[kind], {})).then(v => {
    S[slot] = remember(kind, v); S.errs[kind] = ''; retries[kind] = 0; plans.clear(); if (kind === 'init' && live) live.loaded(v.stamp);
  }, e => {
    S.errs[kind] = (e && e.message) || 'Nie udało się pobrać danych.';
    if (e && (e.code === 403 || e.code === 401)) { S[slot] = null; forget(kind); }   // bez uprawnień nie pokazujemy starej kopii
    else scheduleRetry(kind);
  }).then(() => { clearTimeout(slow); S.loading[kind] = false; running[kind] = null; S.rerender(); return S[slot]; })
    .catch(e => { console.error(e); return S[slot]; });   // błąd rysowania obsługuje render() — tu tylko, by Promise zawsze się rozstrzygnął
  return running[kind];
}
/** Po zapisie: pobierz ponownie to, co zapis zmienił (równolegle). */
export const reload = (...kinds) => Promise.all(kinds.map(k => ensure(k, true)));

// ─── Świeżość zamówień (core/liveRefresh.js): znacznik wersji co 30 s, powrót do karty, „Odśwież” = zmiany z Selly teraz ──
let live = null;
/** Kontrolka świeżości zakładki Zamówienia; zmienione wiersze krótko podświetlone (changedIds). Nie przerywa okna ani zmiany statusu. */
export function liveCtl() {
  if (!live) {
    live = liveRefresh({ id: 'sm', busy: () => !!S.dlg || jobBusy() || S.view !== 'zamowienia', reload: async ({ background }) => {
      const prev = S.d && S.d.v.orders;
      await ensure('init', true);
      if (background && prev && S.d) S.flashIds = changedIds(prev, S.d.v.orders, r => r.orderId);
      S.rerender();
    } });
    if (S.d) live.loaded(S.d.v.stamp);
  }
  return live;
}
export const liveStop = () => { if (live) live.stop(); };

// ─── Decyzje (wspólna logika z serwerem) ────────────────────────────────────
const plans = new Map();
/** Zamówienia bez powtórzeń (to samo id dwa razy — np. z nakładających się stron synchronizacji): inaczej liczby przy przyciskach „Zaznacz …”
 *  i w zakładce liczyły duplikaty, a zaznaczenie (zbiór id) — nie. Liczone raz na dane. */
function uniqOrders(e) {
  const hit = plans.get('u');
  if (hit && hit.of === e) return hit.plan;
  const seen = new Set(), out = e.v.orders.filter(o => { const id = String(o.orderId); if (seen.has(id)) return false; seen.add(id); return true; });
  plans.set('u', { of: e, plan: out });
  return out;
}
/** Wiersze decyzji dla bieżących danych sm:init (liczone raz na pobranie danych). */
export function plan() {
  const e = S.d;
  if (!e) return null;
  const hit = plans.get('p');
  if (hit && hit.of === e) return hit.plan;
  const v = e.v, active = Object.fromEntries(Object.entries(v.sent || {}).filter(([, x]) => !x.cancelled));
  const p = SM.plan(uniqOrders(e), { cfg: v.cfg, today: v.today, totals: v.totals, marks: v.marks, sent: active });
  plans.set('p', { of: e, plan: p });
  return p;
}
/**
 * Plan z zaznaczeniem: zaznaczone zamówienia dostają towar PIERWSZE (tak samo liczy serwer w sm:batch), potem reszta w zwykłej kolejności.
 * Bez zaznaczenia = plan(). Liczone raz na dane + zestaw zaznaczonych (bez pobierania danych).
 */
export function planSel(sel) {
  const base = plan();
  if (!base || !sel || !sel.size) return base;
  const e = S.d, key = [...sel].sort().join(','), hit = plans.get('s');
  if (hit && hit.of === e && hit.key === key) return hit.plan;
  const v = e.v, active = Object.fromEntries(Object.entries(v.sent || {}).filter(([, x]) => !x.cancelled));
  const p = SM.plan(uniqOrders(e), { cfg: v.cfg, today: v.today, totals: v.totals, marks: v.marks, sent: active, priority: sel });
  plans.set('s', { of: e, key, plan: p });
  return p;
}

// ─── Drobne klocki widoku ───────────────────────────────────────────────────
// Jeden obiekt formatu (toLocaleString z opcjami tworzy go przy każdym wywołaniu — przy ~3000 zamówień to setki ms na przerysowanie)
const NF = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 });
export const nf = n => (n == null || n === '' || isNaN(n) ? '—' : NF.format(Math.round(Number(n) * 1000) / 1000));
export const dmy = d => (d ? String(d).slice(8, 10) + '.' + String(d).slice(5, 7) + '.' + String(d).slice(0, 4) : '—');
export const notice = (kind, ...c) => el('div', { class: 'notice ' + kind, role: kind === 'error' ? 'alert' : null }, ...c);
export const th = (label, tip, num) => el('th', { class: num ? 'n' : null }, el('span', { class: tip ? 'tip' : null, title: tip || label }, label));
export const tile = (n, label, title, id) => el('div', { class: 'tab static', title, id: id || null }, el('b', null, String(n)), el('span', null, label));
export const statusName = id => { const s = S.d && S.d.v.statuses.find(x => String(x.id) === String(id)); return s ? s.name : (id ? '#' + id : '—'); };
export const prodOf = key => (S.d ? S.d.v.cfg.products.find(p => p.key === key) : null);
export const needText = need => Object.keys(need || {}).map(k => { const p = prodOf(k); return (p ? p.name : k) + ' × ' + nf(need[k]) + (p && p.unit !== 'szt.' ? ' ' + p.unit : ''); }).join(', ');
export const skeleton = (rows = 6) => el('div', { class: 'card loading', 'aria-busy': 'true', 'aria-label': 'Wczytuję dane SpeedMail' }, Array.from({ length: rows }, () => el('div', { class: 'skel' })));
export const timeOf = ms => (ms ? new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '—');

const openFolds = new Set();
/** Zwijany panel, który pamięta, czy jest otwarty (widok jest przerysowywany po każdej zmianie). summary: [tytuł, dopisek?]. */
export function fold(id, summary, ...body) {
  return el('details', { class: 'fold', id, open: openFolds.has(id) || null, ontoggle: ev => { if (ev.target.open) openFolds.add(id); else openFolds.delete(id); } },
    el('summary', null, el('span', null, summary[0]), summary[1] ? el('span', { class: 'sum' }, summary[1]) : null), ...body);
}

/** Pasek „dane z 12:04 · odświeżam…” + przycisk odświeżenia (kind = init | list | pace). */
export function freshBar(kind, extra) {
  const e = S[SLOT[kind]], busy = S.loading[kind];
  return el('div', { class: 'sm-fresh muted small', id: 'smFresh' },
    e ? el('span', { title: 'Kiedy panel pobrał te dane z serwera. Zamówienia na serwerze odświeżają się z Selly co minutę.' + (kind === 'init' && e.v.syncedMs ? '\nOstatnia synchronizacja zamówień z Selly: ' + timeOf(e.v.syncedMs) : '') }, 'Dane z ' + timeOf(e.t)) : null,
    busy ? el('span', { role: 'status' }, el('span', { class: 'spinner' }), ' odświeżam…') : null, extra || null,
    el('button', { type: 'button', class: 'ghost small', id: 'smRefresh', disabled: busy, title: 'Pobierz dane ponownie (panel robi to też sam przy wejściu na zakładkę, gdy dane mają ponad minutę)', onclick: () => ensure(kind, true) }, '↻ Odśwież'));
}

/** Rozmiar listy / błąd pobrania: komunikat z ponowieniem albo null. */
export function loadError(kind, what) {
  if (!S.errs[kind]) return null;
  const unavailable = /niedostępna|nieznana akcja|501/i.test(S.errs[kind]);
  return notice('error', (S[SLOT[kind]] ? 'Nie udało się odświeżyć (' + what + ') — pokazuję ostatnią kopię. ' : 'Nie udało się pobrać: ' + what + '. ') +
    (unavailable ? 'Nadzór SpeedMail działa tylko na serwerze głównym, który chwilowo nie odpowiada — spróbuj za chwilę. ' : S.errs[kind] + ' '),
  S.retryAt[kind] ? el('span', { class: 'muted small', title: 'Panel sam ponawia pobranie po chwili (najpierw po 3 s, potem rzadziej), dopóki ten ekran jest otwarty' }, 'Ponowię automatycznie. ') : null,
  el('button', { type: 'button', class: 'secondary', id: 'smRetry' + kind, onclick: () => ensure(kind, true) }, 'Spróbuj ponownie'));
}

// ─── Zmiana statusu w Selly (porcje, postęp, nieudane + ponowienie) ─────────
export async function runStatus(job) {
  job.running = true; job.n = 0; job.done = job.done || []; job.failed = [];
  S.job = job; S.rerender();
  const r = await setStatusInChunks(api, job.ids, job.target, { onProgress: (n) => { job.n = n; const b = $('smJobBar'); if (b) b.value = n; const t = $('smJobTxt'); if (t) t.textContent = 'Zapisuję: ' + n + ' z ' + job.ids.length; } });
  job.done.push(...r.done); job.failed = r.failed; job.running = false;
  if (r.done.length) flash('', 'Zmieniono status na „' + statusName(job.target) + '”: ' + r.done.length);
  await reload('init');
  S.rerender();
  if (!r.failed.length && job.then) job.then();
}

export function jobCard() {
  const j = S.job;
  if (!j) return null;
  const tn = statusName(j.target);
  const body = j.running
    ? [el('progress', { id: 'smJobBar', max: String(j.ids.length), value: String(j.n || 0), 'aria-label': 'Postęp zmiany statusu' }), el('div', { class: 'muted small', id: 'smJobTxt', role: 'status' }, 'Zapisuję: ' + (j.n || 0) + ' z ' + j.ids.length)]
    : [el('p', { id: 'smJobSum' }, 'Zmieniono: ', el('strong', null, String(j.done.length)), ' · nieudane: ', el('strong', null, String(j.failed.length))),
      j.failed.length ? el('ul', { class: 'ord-fails' }, j.failed.slice(0, 30).map(f => el('li', null, el('strong', null, (j.numOf && j.numOf.get(f.id)) || f.id), ' — ' + f.error)),
        j.failed.length > 30 ? el('li', { class: 'muted' }, '… i ' + (j.failed.length - 30) + ' więcej') : null) : null,
      el('div', { class: 'ord-actions' },
        el('button', { type: 'button', class: 'secondary', id: 'smJobClose', onclick: () => { S.job = null; S.rerender(); } }, 'Zamknij'),
        j.failed.length ? el('button', { type: 'button', class: 'primary', id: 'smJobRetry', write: STATUS_WRITE, title: 'Spróbuj ponownie tylko dla zamówień, którym nie udało się zmienić statusu',
          onclick: () => runStatus({ ids: j.failed.map(f => f.id), target: j.target, title: j.title, numOf: j.numOf, then: j.then, done: j.done }) }, 'Ponów nieudane (' + j.failed.length + ')') : null)];
  return el('div', { class: 'card ord-dialog', id: 'smJob', role: 'region', 'aria-label': 'Zmiana statusu w Selly' },
    el('h3', null, j.running ? 'Zmieniam status na „' + tn + '”…' : j.failed.length ? 'Zmiana statusu na „' + tn + '” — część się nie udała' : 'Status zmieniony na „' + tn + '”'),
    j.title ? el('div', { class: 'muted small' }, j.title) : null, body);
}
export const jobBusy = () => !!(S.job && S.job.running) || S.busy;

/** Zapis z blokadą przycisków i komunikatem błędu w oknie zakładki. → wynik albo null (błąd pokazany). */
export async function save(action, params, okMsg) {
  if (S.busy) return null;
  S.busy = true; S.err = ''; S.rerender();
  try {
    const r = await api(action, params);
    if (okMsg) flash('', typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return r;
  } catch (e) { S.err = (e && e.message) || 'Zapis się nie udał.'; return null; } finally { S.busy = false; S.rerender(); }
}

// ─── Plik dla SpeedMail ─────────────────────────────────────────────────────
/** Paczka z serwera → tabela zleceń w stałym układzie kolumn (bez anulowanych zamówień). */
export async function batchTable(no) {
  const r = await api('sm:get', { no });
  return { t: SM.smTable(S.d.v.cfg, r.orders.filter(o => !o.cancelled), r.batch), r };
}
const partialWarn = t => { if (t.partial.length) flash('', 'Uwaga: ' + t.partial.length + ' pozycji to niepełne opakowania — sprawdź przeliczniki w Ustawieniach'); };
/** Pobranie pliku .xlsx paczki (nazwa: data + numer paczki). */
export async function downloadBatch(no) {
  try {
    const { t } = await batchTable(no);
    saveBlob(buildXlsx({ sheetName: t.sheet, columns: t.columns, rows: t.rows }), t.file + '.xlsx', 'Pobrano plik dla SpeedMail: ' + t.file + '.xlsx');
    partialWarn(t);
  } catch (e) { S.err = (e && e.message) || 'Nie udało się przygotować pliku.'; S.rerender(); }
}
export async function copyBatch(no) {
  try { const { t } = await batchTable(no); copyToClipboard(tableTsv(t), tableHtml(t), 'Skopiowano tabelę paczki nr ' + no); partialWarn(t); } catch (e) { S.err = (e && e.message) || 'Nie udało się przygotować tabeli.'; S.rerender(); }
}
