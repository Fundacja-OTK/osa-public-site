// Klienci — grupy: ekran „Grupy klientów” (kopia panelu + nazwy i dodawanie grup przez natywny ekran Selly `klienci-grupy`),
// przypisanie do grupy na karcie klienta i masowo z listy (podgląd → zapis po kolei z przerwami → wynik dla każdego klienta → ponów nieudane),
// limit zamówień klienta (natywny ekran `klient-limit`: formularz klienta w Selly, tylko 4 pola limitu).
// Przypisanie: Selly REST API (PUT /api/clients/{id}, pole group_id) przez clients:save. Tworzenie / nazwy / limity grup: API ich nie ma —
// natywny ekran na sesji Selly użytkownika; edycja istniejącej grupy → „↗ Selly” (adres karty grupy nieopisany w docs/selly-screens).
import { el, flash, loadingBox, sellyLink, cnt } from '../core/ui.js?v=a5f5e19';
import { confirmDialog } from '../core/confirm.js?v=a5f5e19';
import { api } from '../core/client.js?v=a5f5e19';
import { sellyCall, createNative } from './sellyNative.js?v=a5f5e19';
import { lazyFold } from './klienciExtra.js?v=a5f5e19';
import { runThrottled, GROUP_GAP_MS } from './klienciImportLogic.js?v=a5f5e19';

const SCREEN = 'klienci-grupy';
let sellyCache = null;   // { ms, groups } — nazwy grup z Selly (5 min), wspólne dla listy, karty i importu

/** Grupy z Selly (natywna lista: Id | Nazwa grupy | Liczba klientów). Nie rzuca: { ok, groups, error }. */
export async function sellyGroups(force) {
  if (!force && sellyCache && Date.now() - sellyCache.ms < 300e3) return { ok: true, groups: sellyCache.groups };
  const r = await sellyCall({ op: 'read', screen: SCREEN, view: 'list' });
  if (!r || !r.ok) return { ok: false, groups: [], error: (r && r.error) || 'Nie udało się pobrać grup z Selly' };
  const h = r.data.headers || [], at = re => h.findIndex(x => re.test(String(x).trim()));
  const iId = at(/^id$/i), iName = at(/nazwa/i), iCount = at(/liczba/i);
  const groups = iId < 0 ? [] : (r.data.rows || []).map(row => {
    const t = i => (i >= 0 && row.cells[i] ? String(row.cells[i].text || '').trim() : '');
    return { id: t(iId), name: t(iName), count: /^\d+$/.test(t(iCount)) ? Number(t(iCount)) : null };
  }).filter(g => /^\d+$/.test(g.id));
  sellyCache = { ms: Date.now(), groups };
  return { ok: true, groups };
}

/** Lista grup do wyboru: kopia panelu (liczniki, nazwy własne) + Selly (nazwy, także grupy bez klientów). → [{ id, name, count, sellyName, localName }] */
export function mergeGroups(meta, selly) {
  const by = new Map();
  for (const g of meta || []) by.set(String(g.id), { id: String(g.id), localName: g.name || '', sellyName: '', count: g.count || 0, sellyCount: null });
  for (const g of selly || []) {
    const x = by.get(g.id) || { id: g.id, localName: '', count: 0 };
    by.set(g.id, Object.assign(x, { sellyName: g.name, sellyCount: g.count }));
  }
  return [...by.values()].map(g => ({ ...g, name: g.sellyName || g.localName || 'Grupa nr ' + g.id })).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export const groupName = (groups, id) => {
  if (!id || String(id) === '0') return 'bez grupy';
  const g = (groups || []).find(x => String(x.id) === String(id));
  return g ? g.name : 'grupa nr ' + id;
};

/** Okno potwierdzenia (to samo zachowanie co w natywnych ekranach): Esc / Anuluj zamyka, onOk(close). */
export function confirmModal(id, title, body, okLabel, onOk) {
  return confirmDialog({ id, title, body, confirmLabel: okLabel, focus: 'cancel', onConfirm: ({ close }) => onOk(close) }).close;
}

// ─── Masowe przypisanie do grupy ────────────────────────────────────────────

/**
 * Dialog w `host`: podgląd zmiany → zapis po kolei (clients:save, pole group_id, z przerwą GROUP_GAP_MS) → wynik dla każdego klienta → ponów nieudane.
 * clients: [{ id, name, groupId }], target: { id ('0' = bez grupy), name }, groups: lista do nazw, onDone(ids zapisanych).
 */
export function bulkGroupDialog(host, clients, target, { groups, onDone }) {
  const todo = clients.filter(c => String(c.groupId || '0') !== String(target.id));
  const skipped = clients.length - todo.length;
  const close = () => { stop = true; host.replaceChildren(); };
  if (!todo.length) { flash('', 'Wszyscy zaznaczeni klienci są już w grupie „' + target.name + '”.'); return; }
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', id: 'cliGrpDlg', 'aria-label': 'Przypisanie klientów do grupy' });
  host.replaceChildren(box);
  const runId = Date.now().toString(36);
  const result = new Map();   // id → { ok, error }
  let stop = false;
  const secs = Math.ceil(todo.length * GROUP_GAP_MS / 1000);
  const PREVIEW = 30;

  const confirmStep = () => box.replaceChildren(
    el('h3', null, (target.id === '0' ? 'Usunąć z grupy ' : 'Przypisać do grupy „' + target.name + '” ') + cnt(todo.length, 'klienta', 'klientów', 'klientów') + '?'),
    el('div', { class: 'table-wrap' }, el('table', { id: 'cliGrpPreview' }, el('thead', null, el('tr', null,
      el('th', { title: 'Klient' }, 'Klient'), el('th', { title: 'Grupa klienta teraz (z kopii panelu)' }, 'Teraz'), el('th', { title: 'Grupa po zapisie' }, 'Po zmianie'))),
    el('tbody', null, todo.slice(0, PREVIEW).map(c => el('tr', null, el('td', null, c.name || 'Klient ' + c.id), el('td', { class: 'muted' }, groupName(groups, c.groupId)), el('td', null, el('strong', null, target.name)))),
      todo.length > PREVIEW ? el('tr', null, el('td', { colspan: '3', class: 'muted' }, '… i ' + (todo.length - PREVIEW) + ' więcej')) : null))),
    skipped ? el('p', { class: 'muted small', id: 'cliGrpSkipped' }, cnt(skipped, 'klient jest', 'klientów jest', 'klientów jest') + ' już w tej grupie — pominięto.') : null,
    el('p', { class: 'muted small' }, 'Zapis w Selly po jednym kliencie, z przerwą (oszczędzamy limit zapytań sklepu) — potrwa ok. ' + (secs < 90 ? secs + ' s' : Math.ceil(secs / 60) + ' min') + '. Możesz przerwać w każdej chwili.'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', id: 'cliGrpCancel', onclick: close }, 'Anuluj'),
      el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'cliGrpConfirm', title: 'Zapisuje grupę w Selly dla każdego klienta z listy', onclick: () => run(todo) }, 'Zapisz w Selly')));

  async function run(list) {
    stop = false;
    const bar = el('progress', { max: String(list.length), value: '0', id: 'cliGrpProgress', 'aria-label': 'Postęp przypisywania do grupy' });
    const label = el('div', { class: 'muted small', role: 'status', id: 'cliGrpStatus' }, 'Zapisuję: 0 z ' + list.length);
    const log = el('ul', { class: 'ord-fails', id: 'cliGrpLog' });
    box.replaceChildren(el('h3', null, 'Przypisuję do grupy „' + target.name + '”…'), bar, label,
      el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'cliGrpStop', title: 'Kończy po bieżącym kliencie; reszta zostanie bez zmian', onclick: ev => { stop = true; ev.target.disabled = true; } }, 'Przerwij')), log);
    let n = 0;
    const res = await runThrottled(list, c => api('clients:save', { id: c.id, fields: { group_id: target.id === '0' ? '0' : target.id }, opId: 'cli-grp-' + runId + '-' + c.id }), {
      gapMs: GROUP_GAP_MS, shouldStop: () => stop,
      onItem: (c, r, e) => {
        result.set(c.id, e ? { ok: false, error: e.message || 'błąd' } : { ok: true });
        bar.value = ++n; label.textContent = 'Zapisuję: ' + n + ' z ' + list.length;
        log.append(el('li', { class: e ? 'bad' : 'ok' }, e ? '✗ ' : '✓ ', el('strong', null, c.name || 'Klient ' + c.id), e ? ' — ' + (e.message || 'błąd') : ''));
      } });
    const ok = todo.filter(c => result.get(c.id) && result.get(c.id).ok);
    if (onDone && res.done.length) onDone(res.done.map(c => c.id));
    summary(res, ok.length);
  }

  function summary(res, okAll) {
    const failed = todo.filter(c => result.get(c.id) && !result.get(c.id).ok);
    const rest = res.rest || [];
    box.replaceChildren(
      el('h3', null, failed.length || rest.length ? 'Przypisanie zakończone częściowo' : 'Zapisano grupę w Selly'),
      el('p', { id: 'cliGrpSummary' }, 'Zapisano: ', el('strong', null, String(okAll)), ' · nieudane: ', el('strong', null, String(failed.length)),
        rest.length ? [' · nie wykonano: ', el('strong', null, String(rest.length))] : null),
      res.paused ? el('p', { class: 'notice warn' }, 'Wstrzymano po kilku błędach z rzędu (np. limit zapytań Selly albo wylogowanie). Sprawdź komunikaty i wznów.') : null,
      failed.length ? el('ul', { class: 'ord-fails' }, failed.slice(0, 30).map(c => el('li', null, el('strong', null, c.name || 'Klient ' + c.id), ' — ' + result.get(c.id).error)),
        failed.length > 30 ? el('li', { class: 'muted' }, '… i ' + (failed.length - 30) + ' więcej') : null) : null,
      el('div', { class: 'ord-actions' },
        failed.length ? el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'cliGrpRetry', title: 'Spróbuj ponownie tylko dla klientów, którym nie udało się zapisać grupy', onclick: () => run(failed) }, 'Ponów nieudane (' + failed.length + ')') : null,
        rest.length ? el('button', { type: 'button', class: 'secondary', write: 'klienci', id: 'cliGrpResume', title: 'Zapisz grupę pozostałym klientom', onclick: () => run(rest) }, 'Wznów (' + rest.length + ')') : null,
        el('button', { type: 'button', class: 'secondary', id: 'cliGrpClose', onclick: close }, 'Zamknij')));
  }
  confirmStep();
  if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
}

// ─── Karta klienta: zmiana grupy ────────────────────────────────────────────

/** Wiersz „Grupa klienta” z przyciskiem „Zmień”: wybór → podgląd „było → będzie” → zapis (clients:save, group_id). */
export function cardGroup(id, currentId, { meta: meta0, onSaved }) {
  let meta = meta0 || [];
  const cur = String(currentId == null || currentId === '' ? '0' : currentId);
  const host = el('span', { id: 'cliGroupBox' });
  let selly = [], groups = mergeGroups(meta, selly);
  const label = () => el('span', { id: 'cliGroup' }, groupName(groups, cur));
  const show = () => host.replaceChildren(label(), ' ', el('button', { type: 'button', class: 'ghost small-btn', write: 'klienci', id: 'cliGroupEdit', title: 'Przypisz klienta do innej grupy albo usuń go z grupy (zapis w Selly)', onclick: edit }, 'Zmień'));
  const refresh = () => { groups = mergeGroups(meta, selly); if (!host.querySelector('select')) show(); };
  /** Nowsza lista grup z kopii panelu (np. z clients:extra — z nazwami własnymi). */
  host.update = list => { meta = list || meta; refresh(); };
  sellyGroups().then(r => { if (r.ok) { selly = r.groups; refresh(); } });
  function edit() {
    const sel = el('select', { id: 'cliGroupSel', 'aria-label': 'Nowa grupa klienta' }, el('option', { value: '0' }, 'bez grupy'),
      groups.map(g => el('option', { value: g.id, selected: g.id === cur }, g.name + (g.count ? ' (' + g.count + ')' : ''))));
    const prev = el('span', { class: 'muted small', id: 'cliGroupPrev', role: 'status' });
    const save = el('button', { type: 'button', class: 'primary small-btn', write: 'klienci', id: 'cliGroupSave', disabled: true, title: 'Zapisuje nową grupę w Selly' }, 'Zapisz');
    sel.value = cur;
    sel.addEventListener('change', () => { const ch = sel.value !== cur; save.disabled = !ch; prev.textContent = ch ? groupName(groups, cur) + ' → ' + groupName(groups, sel.value) : ''; });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { await api('clients:save', { id, fields: { group_id: sel.value } }); flash('', 'Grupa zapisana w Selly'); onSaved && onSaved(); }
      catch (e) { save.disabled = false; prev.textContent = 'Nie udało się: ' + (e.message || 'błąd'); }
    });
    host.replaceChildren(sel, ' ', save, ' ', el('button', { type: 'button', class: 'ghost small-btn', id: 'cliGroupCancel', onclick: show }, 'Anuluj'), ' ', prev);
    sel.focus();
  }
  show();
  return host;
}

// ─── Karta klienta: limit zamówień (natywny ekran klient-limit) ──────────────

const LIMIT_LABELS = { zamowienia_limit_wartosc: 'Limit wartości zamówień (zł)', zamowienia_limit_wybor: 'Okres limitu', zamowienia_limit_dni: 'Liczba dni', zamowienia_limit_data: 'Data końcowa' };
const LIMIT_TIPS = {
  zamowienia_limit_wartosc: 'Łączna wartość zamówień, po której przekroczeniu klient nie złoży kolejnego. Puste = bez limitu.',
  zamowienia_limit_wybor: 'Jak liczyć limit: z ostatnich N dni albo do wskazanej daty (po niej zamówienia są blokowane)',
  zamowienia_limit_dni: 'Dla okresu „z ostatnich dni”: ile dni wstecz liczyć zamówienia',
  zamowienia_limit_data: 'Dla okresu „do daty”: po tej dacie składanie zamówień zostanie zablokowane',
};
const shown = f => f.type === 'select' || f.type === 'radio' ? (((f.options || []).find(o => o.value === f.value) || {}).text || f.value) : f.value;

function control(f, prefix) {
  const common = { 'data-field': f.name, id: prefix + f.name, title: LIMIT_TIPS[f.name] || f.label || f.name, 'aria-label': LIMIT_LABELS[f.name] || f.label || f.name };
  if (f.type === 'checkbox') return el('input', { ...common, type: 'checkbox', 'data-on': f.onValue || '1', checked: f.value !== '' || null });
  if (f.type === 'select' || f.type === 'radio') return el('select', common, [f.value === '' ? el('option', { value: '' }, '— nie ustawiono —') : null,
    (f.options || []).map(o => el('option', { value: o.value, selected: o.value === f.value || null }, o.text || o.value))]);
  return el('input', { ...common, type: f.type === 'date' ? 'date' : 'text', value: f.value, inputmode: /wartosc|dni/.test(f.name) ? 'decimal' : null });
}

export function limitFold(id, sellyUrl) {
  return lazyFold('cliLimitFold', 'Limit zamówień', 'Limit wartości zamówień klienta (z ostatnich dni albo do daty) — z Selly', async (body, reload) => {
    const r = await sellyCall({ op: 'read', screen: 'klient-limit', view: 'record', id });
    const link = sellyLink('Limit w Selly ↗', sellyUrl + '?a=klienci.edit&id=' + encodeURIComponent(id), 'Otwiera kartę klienta w Selly — sekcja z grupą i limitem zamówień');
    if (!r.ok) { body.replaceChildren(el('div', { class: 'notice warn', id: 'cliLimitErr' }, (r.error || 'Nie udało się odczytać limitu z Selly') + ' '), link); return; }
    const fields = (r.data.fields || []).filter(f => f.editable);
    if (!r.data.canSave || !fields.length) {
      body.replaceChildren(el('p', { class: 'muted', id: 'cliLimitNone' }, 'Formularz klienta w Selly nie ma pól limitu w oczekiwanym układzie — ustaw limit w Selly. '), link); return;
    }
    const orig = Object.fromEntries(fields.map(f => [f.name, f.value]));
    const form = el('div', { class: 'kf-grid', id: 'cliLimitForm' }, fields.map(f => el('label', { class: 'nat-field' },
      el('span', { class: 'nat-lbl tip', title: LIMIT_TIPS[f.name] || f.label }, LIMIT_LABELS[f.name] || f.label || f.name), control(f, 'cliLim_'))));
    const msg = el('div', { role: 'status', id: 'cliLimitMsg' });
    const collect = () => {
      const ch = {};
      for (const i of form.querySelectorAll('[data-field]')) { const v = i.type === 'checkbox' ? (i.checked ? i.dataset.on : '') : i.value; if (v !== orig[i.dataset.field]) ch[i.dataset.field] = v; }
      return ch;
    };
    const save = el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'cliLimitSave', disabled: true, title: 'Najpierw zmień któreś pole — przed zapisem pokażemy dokładnie, co trafi do Selly' }, 'Zapisz w Selly…');
    form.addEventListener('input', () => { save.disabled = !Object.keys(collect()).length; });
    form.addEventListener('change', () => { save.disabled = !Object.keys(collect()).length; });
    save.addEventListener('click', async () => {
      const changes = collect(), expect = Object.fromEntries(Object.keys(changes).map(k => [k, orig[k]]));
      save.disabled = true;
      const pre = await sellyCall({ op: 'save', screen: 'klient-limit', id, changes, expect, dryRun: true });
      save.disabled = false;
      if (!pre.ok) { msg.replaceChildren(el('div', { class: 'notice error' }, pre.error || 'Nie udało się przygotować zapisu')); return; }
      if (!pre.data.diff.length) { msg.replaceChildren(el('div', { class: 'notice' }, 'Bez zmian — wartości są już takie w Selly.')); return; }
      const table = el('table', { id: 'cliLimitDiff' }, el('thead', null, el('tr', null, el('th', null, 'Pole'), el('th', null, 'Było'), el('th', null, 'Będzie'))),
        el('tbody', null, pre.data.diff.map(d => el('tr', null, el('td', null, LIMIT_LABELS[d.name] || d.label), el('td', { class: 'nat-before' }, d.beforeText || '—'), el('td', null, el('strong', null, d.afterText || '—'))))));
      confirmModal('cliLimitConfirm', 'Zapisać limit zamówień w Selly?', el('div', null, table, pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null), 'Zapisz w Selly', async close => {
        const res = await sellyCall({ op: 'save', screen: 'klient-limit', id, changes, expect });
        close();
        if (!res.ok) { msg.replaceChildren(el('div', { class: 'notice error' }, (res.code === 'conflict' ? '' : 'Zapis nie powiódł się: ') + (res.error || 'błąd'))); return; }
        flash('', res.data.verified ? 'Limit zapisany w Selly i sprawdzony' : 'Selly przyjęło zapis, ale nie potwierdziło wszystkich pól — sprawdź w Selly');
        reload();
      });
    });
    const now = fields.map(f => (LIMIT_LABELS[f.name] || f.label) + ': ' + (shown(f) || '—')).join(' · ');
    body.replaceChildren(el('p', { class: 'muted small', id: 'cliLimitNow' }, 'Teraz w Selly: ' + now), form, msg,
      el('div', { class: 'ord-actions' }, save, link), r.data.warn ? el('p', { class: 'muted small' }, r.data.warn) : null);
  });
}

// ─── Ekran „Grupy klientów” ─────────────────────────────────────────────────

export async function renderGroups(box, { sellyUrl, back, isCurrent }) {
  box.replaceChildren(el('div', { class: 'card' }, loadingBox('Pobieram grupy…')));
  let g;
  try { g = await api('clients:groups', {}); } catch (e) { box.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, e.message || 'Nie udało się pobrać grup.'))); return; }
  if (isCurrent && !isCurrent()) return;
  const meta = (g && g.groups) || [];
  const tableHost = el('div', { id: 'grpTableHost' });
  const sellyNote = el('div', { id: 'grpSellyNote', class: 'muted small' }, 'Pobieram nazwy grup z Selly…');
  const nativeHost = el('div', { id: 'grpNative' });
  const native = createNative({ id: SCREEN, title: 'Grupy klientów w Selly (na żywo)', screen: SCREEN, a: 'klienci.klienciGrupy', recordRoute: null, noun: 'grupy',
    headerTips: { Id: 'Numer grupy w Selly', 'Nazwa grupy': 'Nazwa grupy w Selly', 'Liczba klientów': 'Liczba klientów w grupie według Selly' },
    labels: { klienci_grupa: 'Nazwa grupy', ...LIMIT_LABELS }, fieldTips: { klienci_grupa: 'Nazwa nowej grupy w Selly (wymagana)', ...LIMIT_TIPS },
    create: { label: '+ Nowa grupa', title: 'Nowa grupa klientów', tip: 'Tworzy grupę w Selly (z opcjonalnym limitem zamówień). Przed wysłaniem pokażemy podsumowanie.' } });
  const fold = el('details', { class: 'card fold', id: 'grpSellyFold' },
    el('summary', { title: 'Lista grup prosto z Selly i dodawanie nowej grupy (na Twojej sesji Selly)' }, el('h2', null, 'Grupy w Selly i nowa grupa'), el('span', { class: 'muted small' }, 'Dodawanie grupy z limitem zamówień; edycja istniejącej grupy — w Selly')), nativeHost);
  let mounted = false;
  const openNative = () => { if (!mounted) { mounted = true; native.mount(nativeHost); } };
  fold.addEventListener('toggle', () => { if (fold.open) openNative(); });

  const paint = selly => {
    const rows = mergeGroups(meta, selly);
    tableHost.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'grpTable' }, el('thead', null, el('tr', null,
      el('th', null, el('span', { title: 'Numer grupy w Selly' }, 'Nr')),
      el('th', null, el('span', { class: 'tip', title: 'Nazwa grupy w Selly (odczyt na Twojej sesji Selly); „—”, gdy Selly jej nie podało' }, 'Nazwa w Selly')),
      el('th', { class: 'n' }, el('span', { class: 'tip', title: 'Liczba klientów z tej grupy w kopii panelu (odświeżanej w tle)' }, 'Klientów')),
      el('th', null, el('span', { class: 'tip', title: 'Nazwa własna widoczna tylko w panelu OSA (nie zmienia Selly) — przydaje się, gdy Selly nie poda nazwy' }, 'Nazwa w panelu')),
      el('th', null, el('span', { title: 'Działania' }, 'Działania')))),
    el('tbody', null, rows.map(r => {
      const name = el('input', { type: 'text', value: r.localName, maxlength: '80', placeholder: r.sellyName || 'Grupa nr ' + r.id, 'aria-label': 'Nazwa w panelu dla grupy ' + r.id, 'data-gid': r.id });
      return el('tr', { 'data-gid': r.id }, el('td', { class: 'nw' }, r.id), el('td', null, r.sellyName || el('span', { class: 'muted' }, '—')), el('td', { class: 'n' }, String(r.count || 0)), el('td', null, name),
        el('td', { class: 'nw' }, el('button', { type: 'button', class: 'secondary', write: 'klienci', title: 'Zapisz nazwę grupy w panelu OSA (Selly bez zmian)', onclick: async () => {
          try { await api('clients:groupName', { groupId: r.id, name: name.value }); flash('', 'Nazwa grupy zapisana w panelu'); } catch (e) { flash('', e.message || 'Nie udało się zapisać'); }
        } }, 'Zapisz nazwę'), ' ', el('a', { class: 'btn-link', href: '#/klienci?group=' + encodeURIComponent(r.id), title: 'Pokaż klientów z tej grupy (tam zaznaczysz klientów i przypiszesz ich do innej grupy)' }, 'Klienci grupy')));
    }), rows.length ? null : el('tr', null, el('td', { colspan: '5', class: 'empty' }, 'Brak grup.'))))));
  };
  paint([]);
  box.replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'ord-detail-top' }, el('a', { href: back, class: 'btn-link', id: 'grpBack' }, '← Wróć do listy klientów'), el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'grpNew', title: 'Utwórz nową grupę w Selly (nazwa i opcjonalny limit zamówień)', onclick: () => { fold.open = true; openNative(); fold.scrollIntoView && fold.scrollIntoView({ block: 'start' }); } }, '+ Nowa grupa'),
      sellyLink('Edytuj grupy w Selly ↗', sellyUrl + '?a=klienci.klienciGrupy', 'Zmiana nazwy i limitu istniejącej grupy oraz usuwanie — w panelu Selly')),
    el('div', { class: 'card-head' }, el('h2', { id: 'grpTitle' }, 'Grupy klientów'),
      el('div', { class: 'sub' }, 'Nazwy z Selly, liczba klientów z kopii panelu. Przypisanie: na liście klientów zaznacz klientów → „Przypisz do grupy”, albo na karcie klienta → „Zmień”.')),
    sellyNote, tableHost,
    el('p', { class: 'muted small' }, 'Klientów bez grupy: ' + (g.noGroup == null ? '—' : g.noGroup) + '.')), fold);
  const s = await sellyGroups(true);
  if (isCurrent && !isCurrent()) return;
  if (s.ok) { sellyNote.replaceChildren(); paint(s.groups); }
  else sellyNote.replaceChildren(el('span', { class: 'tip', title: s.error }, 'Nazwy grup z Selly niedostępne — pokazuję numery i nazwy własne panelu. Szczegóły: ' + s.error));
}
