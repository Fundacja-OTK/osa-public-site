// Moduł „Uprawnienia” (Konto i administracja; tylko administrator panelu): edytor uprawnień grup administratorów Selly.
// Otwarcie grupy: kopia panelu (perms:cached, D1 — bez zapytań do Selly) od razu; moduły starsze niż 6 h / brakujące — z Selly w tle, kilka wywołań naraz.
// Dane i zapis: formularze Selly na sesji Selly zalogowanego użytkownika (Worker: perms:groups / perms:cached / perms:read / perms:save → modules/permsEditor.js,
// silnik shared/sellyNative.js). Selly sam egzekwuje swoje prawa. Nie zmienia członkostwa grup ani kont. Logika: modules/uprawnieniaLogika.js.
// Trasy: #/uprawnienia (lista grup), #/uprawnienia/<id grupy> (edytor).
import { el, flash, loadingBox, debounce, plural, menuButton } from '../core/ui.js?v=a9a0d42';
import { api, ctx } from '../core/client.js?v=a9a0d42';
import { addLeaveGuard } from '../core/router.js?v=a9a0d42';
import { sellyUrl } from './_placeholder.js?v=a9a0d42';
import * as L from './uprawnieniaLogika.js?v=a9a0d42';

const CHUNK = 2;            // stron modułów na wywołanie (≤ PERM_MAX_MODULES w silniku; mało = lekkie wywołania Workera, szybkie pierwsze wyniki)
const PARALLEL = 5;         // wywołań naraz (każde w swoim limicie zapytań i CPU Workera; budżet Selly P1 pilnuje serwer)
const PAGE_TTL = 6 * 3600e3;          // kopia strony modułu starsza niż 6 h → odświeżenie w tle
const LIST_TTL = 7 * 24 * 3600e3;     // lista modułów grupy zmienia się rzadko — tydzień
const PAUSE_MS = 250;       // przerwa między zapisami modułów
const S = { root: null, seq: 0, groups: null, gid: '', model: null, modulesMs: 0, job: null, filter: 'all', q: '', open: new Set(), saving: false, ui: null, raf: 0 };
const isAdmin = () => !!(ctx.boot && ctx.boot.isAdmin);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const adminBase = () => (ctx.boot && ctx.boot.adminUrl) || '';
const dirty = () => !!(S.model && L.totals(S.model).changed);
const n = (x, one, few, many) => x + ' ' + plural(x, one, few, many);
const hhmm = ms => { const d = new Date(ms), t = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' }) + ' ' + t; };

addLeaveGuard(h => (S.saving ? 'Trwa zapis uprawnień w Selly — opuszczenie ekranu przerwie go po bieżącym module. Opuścić?' : null));
addLeaveGuard(h => (dirty() && String(h || '').split('?')[0] !== '#/uprawnienia/' + S.gid ? 'Masz niezapisane zmiany uprawnień grupy. Opuścić ekran bez zapisywania w Selly?' : null));
if (typeof window !== 'undefined') window.addEventListener('beforeunload', ev => { if (dirty()) { ev.preventDefault(); ev.returnValue = ''; } });

/** Wywołanie akcji → data albo wyjątek z komunikatem (błąd serwera, odmowa, błąd silnika; przy konflikcie — świeża strona modułu w `page`). */
async function call(action, params) {
  let r;
  try { r = await api(action, params); } catch (e) { throw Object.assign(new Error(e.message || 'błąd serwera'), { code: e.code }); }
  if (r && r.ok === false) throw Object.assign(new Error(r.error || 'błąd'), { code: r.code, page: r.page || null, ms: r.ms || 0 });
  return r && r.data !== undefined ? r.data : r;
}

// ─── Odczyt z Selly: kilka wywołań naraz, po CHUNK modułów, wyniki od razu w modelu ───────────────
/** job: { queue, total, done, error, waiting, prioritize(m), stop(), promise }. onPage(moduł) po każdej stronie, onProgress(job). */
function startLoad(model, modules, onPage, onProgress) {
  const job = { queue: [...new Set(modules)], total: 0, done: 0, error: null, waiting: '', stopped: false, fails: 0 };
  job.total = job.queue.length;
  job.prioritize = m => { const i = job.queue.indexOf(m); if (i > 0) { job.queue.splice(i, 1); job.queue.unshift(m); } };
  job.stop = () => { job.stopped = true; };
  const worker = async () => {
    while (!job.stopped && !job.error && job.queue.length) {
      const part = job.queue.splice(0, CHUNK);
      try {
        const d = await call('perms:read', { groupId: model.groupId, modules: part });
        if (job.stopped) return;
        if (d.paused) { job.queue.unshift(...part); job.waiting = d.message || 'Limit zapytań do Selly — czekam'; onProgress(job); await sleep(Math.min(60, Math.max(2, d.waitS || 5)) * 1000); job.waiting = ''; continue; }
        const got = new Set();
        for (const pg of d.pages || []) { L.applyPage(model, pg, d.ms || Date.now()); got.add(pg.module); job.done++; onPage(pg.module); }
        const rest = part.filter(m => !got.has(m));
        if (rest.length) { if (!got.size && ++job.fails > 3) throw new Error('Selly nie oddało stron modułów — spróbuj ponownie'); job.queue.push(...rest); }
        onProgress(job);
      } catch (e) { if (!job.stopped) { job.error = e; onProgress(job); } return; }
    }
  };
  job.promise = Promise.all(Array.from({ length: PARALLEL }, worker)).then(() => job);
  onProgress(job);
  return job;
}

/** Cała grupa (np. źródło „Jak inna grupa”): kopia panelu + odczyt z Selly tylko brakujących / starych modułów. */
async function loadGroupFull(gid, onProgress) {
  const c = await call('perms:cached', { groupId: gid });
  let modules = c.modules;
  if (!modules || Date.now() - (c.modulesMs || 0) > LIST_TTL) modules = (await call('perms:read', { groupId: gid })).modules || [];
  const model = L.buildModel(gid, modules, c.pages || []);
  const todo = L.staleModules(model, Date.now(), PAGE_TTL);
  if (todo.length) {
    const job = startLoad(model, todo, () => {}, j => onProgress(j.done, j.total, j.waiting));
    await job.promise;
    if (job.error) throw job.error;
  }
  return model;
}

// ─── Lista grup ───────────────────────────────────────────────────────────
async function showGroups() {
  const my = ++S.seq;
  S.root.replaceChildren(toolbar('Wybierz grupę, której uprawnienia chcesz zobaczyć lub zmienić.'), el('div', { class: 'card', id: 'peGroups' }, loadingBox('Pobieram grupy z Selly…')));
  try {
    const d = await call('perms:groups', {});
    if (my !== S.seq) return;
    S.groups = d.groups || [];
    S.root.querySelector('#peGroups').replaceChildren(groupList(''));
  } catch (e) { if (my === S.seq) S.root.querySelector('#peGroups').replaceChildren(errBox('Nie udało się pobrać grup: ' + e.message, showGroups)); }
}
function groupList(current) {
  if (!S.groups || !S.groups.length) return el('div', { class: 'empty' }, 'Selly nie pokazało żadnej grupy.');
  return el('ul', { class: 'pe-groups', id: 'peGroupList' }, S.groups.map(g => el('li', null,
    el('a', { href: '#/uprawnienia/' + g.id, class: 'chip', 'aria-current': g.id === current ? 'page' : null, title: 'Uprawnienia grupy „' + g.name + '”' }, g.name,
      g.users == null ? null : el('span', { class: 'ord-n tip', title: 'Liczba kont administratorów w tej grupie (wg Selly)' }, ' · ' + n(g.users, 'konto', 'konta', 'kont'))))));
}
function toolbar(sub) {
  return el('div', { class: 'page-toolbar' }, el('div', { class: 'pt-title' }, el('h2', null, 'Uprawnienia grup'), el('div', { class: 'sub' }, sub)),
    el('div', { class: 'pt-actions' }, el('a', { class: 'btn-secondary', href: sellyUrl(adminBase(), '?a=actions.perm'), target: '_blank', rel: 'noopener', title: 'Ta sama strona w panelu Selly (nowa karta)' }, 'Selly ↗')));
}
function errBox(text, retry) {
  return el('div', { class: 'empty error' }, text, retry ? el('div', null, el('button', { type: 'button', class: 'secondary', onclick: retry }, 'Spróbuj ponownie')) : null);
}

// ─── Edytor grupy: kopia panelu od razu, odczyt z Selly w tle ──────────────────
async function showGroup(gid) {
  const my = ++S.seq;
  if (S.model && S.model.groupId === gid) { renderEditor(); return; }
  if (S.job) S.job.stop();
  S.model = null; S.job = null; S.gid = gid; S.open.clear(); S.filter = 'all'; S.q = '';
  S.root.replaceChildren(toolbar(''), el('div', { class: 'card' }, loadingBox('Wczytuję uprawnienia grupy…')));
  try {
    const c = await call('perms:cached', { groupId: gid });
    if (my !== S.seq) return;
    if (!S.groups && c.groups) S.groups = c.groups;   // nazwy grup z kopii (lista grup odświeża się na ekranie #/uprawnienia)
    if (!S.groups) call('perms:groups', {}).then(d => { S.groups = d.groups || []; if (S.model && my === S.seq) renderEditor(); }).catch(() => {});
    if (c.modules && c.modules.length) {
      S.model = L.buildModel(gid, c.modules, c.pages || []); S.modulesMs = c.modulesMs || 0;
      renderEditor();
      if (Date.now() - S.modulesMs > LIST_TTL) refreshLive(true);
      else { const stale = L.staleModules(S.model, Date.now(), PAGE_TTL); if (stale.length) liveLoad(stale); }
      return;
    }
    const meta = await call('perms:read', { groupId: gid });   // pierwsze otwarcie: lista modułów z Selly, strony w tle
    if (my !== S.seq) return;
    S.model = L.buildModel(gid, meta.modules || [], []); S.modulesMs = meta.ms || Date.now();
    renderEditor();
    liveLoad(S.model.modules.map(m => m.module));
  } catch (e) {
    if (my !== S.seq) return;
    S.root.replaceChildren(toolbar(''), el('div', { class: 'card' }, errBox('Nie udało się wczytać uprawnień grupy: ' + e.message, () => showGroup(gid))));
  }
}

/** Odczyt modułów z Selly w tle (sekcje wypełniają się w miarę nadchodzenia stron). */
function liveLoad(modules) {
  if (S.job) S.job.stop();
  const my = S.seq, model = S.model;
  S.job = startLoad(model, modules, mod => { if (my === S.seq && S.model === model) scheduleRefresh(mod); }, () => { if (my === S.seq && S.model === model) renderState(); });
  S.job.promise.then(() => { if (my === S.seq && S.model === model && S.ui) { renderState(); renderRo(); } });
}
/** ↻ Odśwież z Selly: lista modułów (gdy listToo) i wszystkie strony; zmiany w edytorze zostają. */
async function refreshLive(listToo) {
  const my = S.seq, model = S.model;
  if (listToo) {
    try {
      const meta = await call('perms:read', { groupId: model.groupId });
      if (my !== S.seq || S.model !== model) return;
      const old = new Map(model.modules.map(m => [m.module, m]));
      model.modules = (meta.modules || []).map(m => old.get(m.module) ? Object.assign(old.get(m.module), { title: m.title || m.module })
        : { module: m.module, title: m.title || m.module, loaded: false, empty: false, canSave: false, reason: '', rows: [], ms: 0 });
      S.modulesMs = meta.ms || Date.now();
    } catch (e) { flash('', 'Nie udało się odświeżyć listy modułów: ' + e.message, 'error'); return; }
  }
  liveLoad(model.modules.map(m => m.module));
  scheduleRefresh();
}
/** Odświeżenie widoku po nadejściu stron: tylko sekcje tych modułów (reszta — także pole szukania i kliknięte wiersze — zostaje); mod pominięty = całość. */
const pendingMods = new Set();
let pendingAll = false;
function scheduleRefresh(mod) {
  if (mod) pendingMods.add(mod); else pendingAll = true;
  if (S.raf) return;
  const run = () => {
    S.raf = 0;
    const all = pendingAll || !!S.q.trim() || S.filter !== 'all', mods = [...pendingMods];
    pendingAll = false; pendingMods.clear();
    if (!S.ui || !S.model) return;
    if (all) { refresh(); return; }
    for (const id of mods) {
      const mod = S.model.modules.find(x => x.module === id), old = S.ui.list.querySelector('.pe-mod[data-module="' + CSS.escape(id) + '"]');
      if (mod && old) old.replaceWith(moduleSection(mod, mod.rows, false)); else { refresh(); return; }
    }
    renderFilters(); renderBar(); renderState(); renderRo();
  };
  S.raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16);
}
function renderState() {
  if (!S.ui || !S.ui.state || !S.model) return;
  const m = S.model, j = S.job, loaded = m.modules.filter(x => x.loaded).length;
  const busy = !!(j && !j.stopped && !j.error && j.done < j.total);
  const oldest = L.oldestMs(m);
  const parts = [];
  if (busy) parts.push(el('span', { id: 'peLive' }, j.waiting || ('wczytano ' + j.done + '/' + j.total + ' modułów z Selly…')));
  else if (j && j.error) parts.push(el('span', { class: 'pe-res bad' }, 'Odczyt z Selly przerwany: ' + j.error.message));
  if (oldest) parts.push(el('span', { class: 'tip', id: 'peAge', title: 'Kiedy panel odczytał te uprawnienia z Selly (najstarszy moduł). Kopię panelu odświeża w tle, gdy ma ponad 6 godzin; zapis zawsze sprawdza moduł w Selly na żywo.' },
    (parts.length ? ' · ' : '') + 'stan z ' + hhmm(oldest)));
  if (loaded < m.modules.length && !busy) parts.push(' · niewczytane: ' + (m.modules.length - loaded));
  parts.push(' · ', el('button', { type: 'button', class: 'link', id: 'peRefresh', disabled: busy, title: busy ? 'Trwa odczyt z Selly' : 'Odczytuje listę modułów i wszystkie uprawnienia grupy z Selly (zmiany w edytorze zostają)',
    onclick: () => refreshLive(true) }, '↻ Odśwież z Selly'));
  S.ui.state.replaceChildren(...parts);
}
/** Rozwinięcie niewczytanego modułu: najpierw on (w trwającym odczycie albo osobno). */
function wantModule(mod) {
  if (mod.loaded) return;
  if (S.job && !S.job.stopped && !S.job.error && S.job.queue.includes(mod.module)) S.job.prioritize(mod.module);
  else if (!(S.job && !S.job.stopped && !S.job.error && S.job.done < S.job.total)) liveLoad([mod.module]);
}

const groupName = gid => ((S.groups || []).find(g => g.id === gid) || {}).name || ('grupa ' + gid);

function renderEditor() {
  const m = S.model;
  const search = el('input', { type: 'search', id: 'peSearch', placeholder: 'Szukaj trasy lub opisu…', value: S.q, 'aria-label': 'Szukaj trasy lub opisu',
    title: 'Szuka w kluczach tras (np. enadawca.przesylka), opisach z Selly i nazwach modułów', oninput: debounce(ev => { S.q = ev.target.value; renderModules(); }, 150) });
  const filters = el('div', { class: 'pe-filters', id: 'peFilters', role: 'group', 'aria-label': 'Filtr tras' });
  const presets = menuButton({ id: 'pePresets', label: 'Szablony', cls: 'secondary', title: 'Gotowe ustawienia całej grupy — zmieniają tylko edytor; do Selly nic nie idzie przed „Zapisz”',
    items: () => [
      { label: 'Tylko podgląd', title: 'Każda trasa wg podpowiedzi: strony podglądu „Tak”, wszystko, co zmienia dane, i niejednoznaczne „Nie”', desc: 'podgląd = Tak, reszta = Nie', run: () => preset(() => L.presetViewOnly(m), 'Tylko podgląd') },
      { label: 'Jak inna grupa…', title: 'Kopiuje ustawienia z innej grupy (te same moduły i trasy)', disabled: !(S.groups || []).some(g => g.id !== m.groupId), run: copyDialog },
      { label: 'Cofnij wszystkie zmiany', title: 'Przywraca w edytorze stan z Selly z chwili wczytania', disabled: !dirty(), run: () => { const k = L.resetChanges(m); refresh(); flash('', 'Cofnięto ' + n(k, 'zmianę', 'zmiany', 'zmian')); } },
    ] });
  const fold = el('button', { type: 'button', class: 'ghost small', id: 'peFold', title: 'Rozwija albo zwija wszystkie moduły', onclick: () => {
    const all = S.open.size < m.modules.length;
    S.open = new Set(all ? m.modules.map(x => x.module) : []); renderModules();
  } }, 'Rozwiń / zwiń wszystko');
  S.ui = { search, filters, list: el('div', { id: 'peModules', class: 'pe-modules' }), bar: el('div', { class: 'pe-savebar', id: 'peSaveBar' }),
    state: el('div', { class: 'small muted pe-state', id: 'peState', role: 'status' }), ro: el('div') };
  S.root.replaceChildren(
    toolbar('Grupa „' + groupName(m.groupId) + '” — ' + n(m.modules.length, 'moduł', 'moduły', 'modułów') + '. Zmiany trafiają do Selly dopiero po „Zapisz”.'),
    el('div', { class: 'card pe-head' }, S.groups ? el('details', { class: 'pe-other' }, el('summary', { title: 'Przełącz na inną grupę' }, 'Inne grupy'), groupList(m.groupId)) : null,
      S.ui.state, el('div', { class: 'pe-tools' }, search, presets, fold), filters, S.ui.ro),
    S.ui.list, S.ui.bar);
  refresh();
}

function preset(fn, label) {
  const k = fn();
  refresh();
  flash('', label + ': ' + (k ? 'zmieniono ' + n(k, 'trasę', 'trasy', 'tras') + ' w edytorze — sprawdź i zapisz' : 'nic do zmiany'));
}

function refresh() { renderFilters(); renderModules(); renderBar(); renderState(); renderRo(); }
function renderRo() {
  const ro = S.model.modules.filter(x => x.loaded && !x.canSave && !x.empty).length;
  S.ui.ro.replaceChildren(...(ro ? [el('div', { class: 'notice warn' }, n(ro, 'moduł jest', 'moduły są', 'modułów jest') + ' tylko do podglądu — formularz Selly wygląda inaczej niż oczekiwano (szczegóły w module). Te zmienisz w Selly.')] : []));
}

function renderFilters() {
  const t = L.totals(S.model);
  const cnt = { all: t.total, tak: t.tak, nie: t.nie, changed: t.changed, amb: t.amb };
  S.ui.filters.replaceChildren(...Object.entries(L.FILTERS).map(([k, f]) => el('button', { type: 'button', class: 'chip', 'data-filter': k, 'aria-pressed': S.filter === k ? 'true' : 'false', title: f.tip,
    onclick: () => { S.filter = k; renderFilters(); renderModules(); } }, f.label, el('span', { class: 'ord-n' }, ' ' + cnt[k]))));
}

function renderModules() {
  const m = S.model, active = !!S.q.trim() || S.filter !== 'all';
  const out = [];
  for (const mod of m.modules) {
    const rows = mod.rows.filter(r => L.rowMatches(r, mod, S.q, S.filter));
    if (active && !rows.length) continue;
    out.push(moduleSection(mod, rows, active));
  }
  S.ui.list.replaceChildren(...(out.length ? out : [el('div', { class: 'empty', id: 'peNone' }, 'Żadna trasa nie pasuje do wyszukiwania i filtra.')]));
}

function moduleSection(mod, rows, active) {
  const c = L.moduleCounts(mod), can = mod.loaded && mod.canSave && !mod.empty;
  const why = !mod.loaded ? 'Moduł jeszcze nie wczytany z Selly' : mod.empty ? 'Ten moduł nie ma w Selly tras do ustawienia' : mod.reason;
  const allBtn = (v, label, tip) => el('button', { type: 'button', class: 'ghost small', 'data-all': v, disabled: !can, title: can ? tip : why,
    onclick: ev => { ev.preventDefault(); ev.stopPropagation(); const k = L.presetModule(S.model, mod.module, v); S.open.add(mod.module); refresh(); if (k) flash('', mod.title + ': ' + n(k, 'zmiana', 'zmiany', 'zmian') + ' w edytorze'); } }, label);
  const det = el('details', { class: 'pe-mod' + (c.changed ? ' changed' : ''), 'data-module': mod.module, open: active || S.open.has(mod.module) },
    el('summary', { title: 'Moduł Selly „' + mod.module + '” — kliknij, żeby rozwinąć trasy' },
      el('span', { class: 'pe-mtitle' }, mod.title), el('code', { class: 'pe-mkey' }, mod.module),
      el('span', { class: 'pe-counts' },
        el('span', { class: 'tag ok tip', title: 'Trasy z dostępem („Tak”)' }, 'Tak ' + c.tak),
        el('span', { class: 'tag tip', title: 'Trasy bez dostępu („Nie”)' }, 'Nie ' + c.nie),
        c.changed ? el('span', { class: 'tag warn tip', title: 'Zmienione w edytorze, jeszcze niezapisane w Selly' }, 'zmienione ' + c.changed) : null,
        !mod.loaded ? el('span', { class: 'tag tip pe-wait', title: 'Uprawnienia tego modułu są właśnie odczytywane z Selly (rozwiń, żeby wczytać go jako pierwszy)' }, 'wczytuję…')
          : can ? null : el('span', { class: 'tag tip', title: why }, mod.empty ? 'brak tras' : 'tylko podgląd')),
      el('span', { class: 'pe-mact' }, allBtn('Tak', 'Wszystko Tak', 'Pełny dostęp do modułu: wszystkie trasy „Tak” (w edytorze)'), allBtn('Nie', 'Wszystko Nie', 'Brak dostępu do modułu: wszystkie trasy „Nie” (w edytorze)'))));
  det.addEventListener('toggle', () => { if (det.open) wantModule(mod); if (!active) { if (det.open) S.open.add(mod.module); else S.open.delete(mod.module); } if (det.open && !det.querySelector('.pe-rows')) det.append(rowsOf(mod, rows, can, why)); });
  if (det.open) det.append(rowsOf(mod, rows, can, why));
  return det;
}

function rowsOf(mod, rows, can, why) {
  if (!mod.loaded) return el('div', { class: 'pe-rows empty' }, 'Wczytuję z Selly…');
  if (!rows.length) return el('div', { class: 'pe-rows empty' }, mod.empty ? 'Ten moduł nie ma w Selly tras do ustawienia.' : 'Brak tras.');
  return el('div', { class: 'pe-rows' }, !can && !mod.empty ? el('div', { class: 'notice warn' }, why) : null, rows.map(r => rowEl(mod, r, can, why)));
}

function rowEl(mod, r, can, why) {
  const b = L.hintBadge(r.hint);
  const tog = v => el('button', { type: 'button', 'data-v': v, 'aria-pressed': r.value === v ? 'true' : 'false', disabled: !can,
    title: can ? (v === 'Tak' ? 'Grupa ma dostęp do tej trasy' : 'Grupa nie ma dostępu do tej trasy') : why,
    onclick: () => { if (r.value === v) return; r.value = v; const row = S.ui.list.querySelector('[data-key="' + CSS.escape(mod.module + '|' + r.name) + '"]'); if (row) row.replaceWith(rowEl(mod, r, can, why)); renderFilters(); renderBar(); updateCounts(mod); } }, v);
  return el('div', { class: 'pe-row' + (L.isChanged(r) ? ' changed' : ''), 'data-key': mod.module + '|' + r.name },
    el('div', { class: 'pe-rkey' }, el('code', { title: 'Trasa Selly (parametr a=)' }, r.key),
      b.label ? el('span', { class: 'tag tip pe-hint ' + b.cls, title: b.tip }, b.label) : null,
      L.isChanged(r) ? el('span', { class: 'pe-was tip', title: 'Wartość w Selly z chwili wczytania' }, 'było: ' + (r.orig || '—')) : null),
    el('div', { class: 'pe-rdesc' }, r.desc || el('span', { class: 'muted' }, 'brak opisu w Selly')),
    el('div', { class: 'seg pe-tog', role: 'group', 'aria-label': 'Dostęp do ' + r.key }, tog('Tak'), tog('Nie')));
}

function updateCounts(mod) {
  const det = S.ui.list.querySelector('.pe-mod[data-module="' + CSS.escape(mod.module) + '"]');
  if (!det) return;
  const c = L.moduleCounts(mod);
  const old = det.querySelector('summary');
  const fresh = moduleSection(mod, [], false).querySelector('summary');
  old.replaceWith(fresh);
  det.classList.toggle('changed', !!c.changed);
}

function renderBar() {
  const ch = L.changesByModule(S.model);
  const yes = ch.reduce((a, x) => a + x.toYes, 0), no = ch.reduce((a, x) => a + x.toNo, 0), total = yes + no;
  S.ui.bar.hidden = !total;
  S.ui.bar.replaceChildren(
    el('span', { class: 'pe-sum tip', title: 'Zmiany w edytorze, jeszcze niezapisane w Selly' }, 'Niezapisane: ' + n(total, 'zmiana', 'zmiany', 'zmian') + ' (→ Tak ' + yes + ', → Nie ' + no + ') w ' + n(ch.length, 'module', 'modułach', 'modułach')),
    el('button', { type: 'button', class: 'secondary', title: 'Przywraca w edytorze stan z Selly z chwili wczytania', onclick: () => { L.resetChanges(S.model); refresh(); } }, 'Odrzuć'),
    el('button', { type: 'button', class: 'primary', id: 'peReview', onclick: reviewDialog, title: 'Pokazuje „było → będzie” dla każdego modułu przed zapisem w Selly' }, 'Przejrzyj i zapisz…'));
}

// ─── Okna: podgląd zmian + zapis, kopiowanie z innej grupy ───────────────────
function modal(title, body, actions) {
  const wrap = el('div', { class: 'nat-modal', id: 'peModal' }, el('div', { class: 'nat-dialog card pe-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('h3', null, title), body, el('div', { class: 'nat-actions nat-dlg-actions' }, ...actions)));
  document.body.append(wrap);
  return wrap;
}

function reviewDialog() {
  const ch = L.changesByModule(S.model);
  if (!ch.length) return;
  const yes = ch.reduce((a, x) => a + x.toYes, 0), no = ch.reduce((a, x) => a + x.toNo, 0);
  const list = el('div', { class: 'pe-diff', id: 'peDiff' }, ch.map(x => el('details', { 'data-module': x.module, open: ch.length <= 3 },
    el('summary', null, el('b', null, x.title), ' ', el('code', null, x.module), ' — ', el('span', { class: 'tag ok' }, '→ Tak ' + x.toYes), el('span', { class: 'tag bad' }, '→ Nie ' + x.toNo),
      el('span', { class: 'pe-res', 'data-res': x.module })),
    el('ul', null, x.diff.map(d => el('li', null, el('code', null, d.key), ': ', el('span', { class: 'nat-before' }, d.before), ' → ', el('b', null, d.after)))))));
  const cancel = el('button', { type: 'button', class: 'secondary', onclick: () => wrap.remove() }, 'Anuluj');
  const ok = el('button', { type: 'button', class: 'primary', id: 'peConfirm' }, 'Zapisz w Selly (' + n(yes + no, 'zmiana', 'zmiany', 'zmian') + ')');
  const info = el('p', { class: 'small muted' }, 'Grupa „' + groupName(S.model.groupId) + '”: → Tak ' + yes + ', → Nie ' + no + ' w ' + n(ch.length, 'module', 'modułach', 'modułach')
    + '. Zapis moduł po module formularzem Selly; przed każdym panel sprawdza, czy nikt nie zmienił modułu w Selly od wczytania, a po nim — czy Selly zapisało.');
  const wrap = modal('Zapis uprawnień — było → będzie', el('div', null, info, list), [cancel, ok]);
  ok.onclick = async () => {
    ok.disabled = true; cancel.disabled = true; S.saving = true;
    const res = [];
    for (const x of ch) {
      const cell = wrap.querySelector('[data-res="' + CSS.escape(x.module) + '"]');
      cell.textContent = ' · zapisuję…';
      try {
        const d = await call('perms:save', L.saveParams(S.model, x.module));
        if (d.page) L.applyPage(S.model, d.page, d.ms || Date.now());
        if (d.verified) { if (!d.page) L.markSaved(S.model, x.module); res.push({ x, ok: true }); cell.textContent = ' · ✓ zapisano i sprawdzono'; cell.className = 'pe-res ok'; }
        else { res.push({ x, ok: false, msg: 'Selly nie potwierdziło: ' + (d.mismatches || []).length + ' poz.' }); cell.textContent = ' · ⚠ zapisano, ale ponowny odczyt pokazuje inne wartości (' + (d.mismatches || []).length + ') — wczytaj grupę ponownie'; cell.className = 'pe-res warn'; }
      } catch (e) {
        if (e.page) L.applyPage(S.model, e.page, e.ms || Date.now());   // konflikt: aktualny stan z Selly, zamiary użytkownika zostają
        res.push({ x, ok: false, conflict: e.code === 'conflict', msg: e.message });
        cell.textContent = ' · ✗ ' + e.message; cell.className = 'pe-res bad';
        if (e.code === 'login' || e.code === 403) break;
      }
      if (x !== ch[ch.length - 1]) await sleep(PAUSE_MS);
    }
    S.saving = false;
    const good = res.filter(r => r.ok).length, bad = res.length - good, conflict = res.some(r => r.conflict);
    ok.remove(); cancel.disabled = false; cancel.textContent = 'Zamknij';
    cancel.onclick = () => { wrap.remove(); refresh(); };
    const sum = el('div', { class: 'notice ' + (bad ? 'warn' : 'ok'), id: 'peResult', role: 'status' }, 'Zapisano i sprawdzono ' + good + ' z ' + ch.length + ' modułów.'
      + (bad ? ' Niezapisane / niepotwierdzone: ' + bad + ' — zmiany zostały w edytorze.' : ''));
    if (conflict) sum.append(' Moduły z konfliktem mają już aktualny stan z Selly — sprawdź zmiany i zapisz ponownie.');
    else if (bad) sum.append(' ', el('button', { type: 'button', class: 'secondary small', onclick: () => { wrap.remove(); refreshLive(true); } }, '↻ Odśwież z Selly'));
    wrap.querySelector('.pe-dialog h3').after(sum);
    refresh();
  };
}

function copyDialog() {
  const others = (S.groups || []).filter(g => g.id !== S.model.groupId);
  const sel = el('select', { id: 'peCopyFrom', 'aria-label': 'Grupa źródłowa' }, others.map(g => el('option', { value: g.id }, g.name)));
  const prog = el('div', { class: 'small muted', role: 'status' });
  const cancel = el('button', { type: 'button', class: 'secondary' }, 'Anuluj');
  const ok = el('button', { type: 'button', class: 'primary', id: 'peCopyGo' }, 'Ustaw jak w tej grupie');
  const wrap = modal('Ustaw jak inna grupa', el('div', null, el('p', { class: 'small' }, 'Weźmie uprawnienia wybranej grupy (z kopii panelu; brakujące moduły z Selly) i ustawi tak samo w edytorze tej grupy (nic nie zapisuje — zapis po przejrzeniu zmian).'),
    el('label', { class: 'nat-field' }, 'Kopiuj z grupy', sel), prog), [cancel, ok]);
  let my = 0;
  cancel.onclick = () => { my = -1; wrap.remove(); };
  ok.onclick = async () => {
    ok.disabled = true; sel.disabled = true; my = 1;
    try {
      const other = await loadGroupFull(sel.value, (d, t, w) => { prog.textContent = w || ('Wczytuję moduły grupy źródłowej z Selly: ' + d + ' / ' + t); });
      if (my !== 1) return;
      const r = L.presetCopy(S.model, other);
      wrap.remove(); refresh();
      flash('', 'Jak „' + (others.find(g => g.id === sel.value) || {}).name + '”: zmieniono ' + n(r.changed, 'trasę', 'trasy', 'tras') + (r.missing ? '; ' + r.missing + ' bez odpowiednika (bez zmian)' : '') + ' — sprawdź i zapisz');
    } catch (e) { if (my === 1) { prog.textContent = 'Nie udało się wczytać grupy źródłowej: ' + e.message; ok.disabled = false; sel.disabled = false; } }
  };
}

export default {
  id: 'uprawnienia',
  title: 'Uprawnienia',
  routes: ['', '<id>'],
  mount(root, params) {
    S.root = root;
    if (!isAdmin()) { S.root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Edytor uprawnień jest dostępny tylko dla administratora panelu.'))); return; }
    const id = (params && params.parts && params.parts[0]) || '';
    if (/^\d{1,12}$/.test(id)) showGroup(id); else { S.model = null; showGroups(); }   // zmiany porzucone dopiero po potwierdzeniu strażnika wyjścia
  },
  unmount() { S.seq++; if (S.job) S.job.stop(); S.job = null; S.model = null; S.saving = false; },   // wyjście potwierdzone strażnikiem = zmiany porzucone
};
