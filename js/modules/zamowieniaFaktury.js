// Lista „Faktury” (#/zamowienia/faktury): faktury ze wszystkich zamówień — filtry (okres, numer, stan rozliczenia), sortowanie, eksport,
// wydruk i rozliczenie. Selly API nie ma listy faktur sklepu, więc lista czyta kopię w bazie panelu (orders:invoiceList), a przycisk
// „Uzupełnij z Selly” sprawdza porcjami zamówienia jeszcze niesprawdzone (orders:invoiceScan; po jednym zapytaniu do Selly na zamówienie,
// z przerwami i bezpiecznikiem limitu API). „Do wystawienia”: zamówienia z dokumentem „faktura” bez faktury (orders:invoiceTodo) — wystawianie
// formularzem Selly po jednym albo partią ≤ BATCH_MAX z jednym potwierdzeniem (fakturaWystaw.js; numerację prowadzi Selly).
import { el, gateWrite, debounce, money, cnt, plural, sortTh, pager, pageToolbar, loadingBox, downloadMenuButton, sellyLink, syncedLabel, flash } from '../core/ui.js?v=196affa';
import { dateRange } from '../core/datepicker.js?v=196affa';
import { api, ctx } from '../core/client.js?v=196affa';
import { INV_STATUS, invStatusPill, isOverdue, invoiceEditor, printButton } from './zamowieniaFakturyKit.js?v=196affa';
const BATCH_MAX = 10;   // = fakturaWystaw.BATCH_MAX (moduł wczytywany leniwie przy wystawianiu)
const wystaw = () => import('./fakturaWystaw.js?v=196affa');

const SIZE = 50;
const PAUSE_MS = 4000;   // przerwa między porcjami „Uzupełnij z Selly” (≤ 15 zapytań / 4 s — z zapasem pod limitem Selly ~500/min)
const STATES = [
  ['', 'Wszystkie', 'Wszystkie faktury z okresu'],
  ['open', 'Do zapłaty', 'Nierozliczone i częściowo rozliczone'],
  ['overdue', 'Po terminie', 'Do zapłaty, a termin płatności już minął'],
  ['settled', 'Rozliczone', 'Faktury zapłacone w całości'],
];
const MORE_STATES = [['unsettled', 'tylko nierozliczone (bez częściowych)'], ['partial', 'tylko częściowo rozliczone'], ['cancelled', 'anulowane']];
const V = {
  box: null, visible: false, built: false, seq: 0, ui: {},
  Q: { q: '', from: '', to: '', state: '', scope: 'faktura', sort: 'date', dir: 'desc', page: 1 },
  data: null, scan: null,
};
const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || 'https://takimarket.pl/adm/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plDay = v => { const d = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : d; };
const params = () => ({ q: V.Q.q, from: V.Q.from, to: V.Q.to, state: V.Q.state, scope: V.Q.scope, sort: V.Q.sort, dir: V.Q.dir });

/** Pokazuje / chowa listę faktur w kontenerze modułu Zamówienia (jak showNewOrder). */
export function showInvoices(host, on) {
  if (!V.box && !on) return null;
  if (!V.box) { V.box = el('div', { id: 'invRoot', class: 'inv-root' }); host.append(V.box); }
  V.box.hidden = !on; V.visible = !!on;
  if (!on) { if (V.scan) V.scan.stop = true; return V.box; }
  if (!V.built) build();
  load();
  return V.box;
}

function build() {
  const u = V.ui;
  u.search = el('input', { type: 'search', id: 'invSearch', placeholder: 'Szukaj: numer faktury, nr zamówienia, nabywca…', 'aria-label': 'Szukaj faktur', autocomplete: 'off',
    title: 'Szuka w numerze faktury, numerze zamówienia i nazwie nabywcy (firma albo imię i nazwisko)',
    oninput: debounce(() => { V.Q.q = u.search.value.trim(); V.Q.page = 1; load(); }, 300) });
  u.seg = el('div', { class: 'seg', id: 'invStates', role: 'group', 'aria-label': 'Stan rozliczenia' },
    STATES.map(([v, label, tip]) => el('button', { type: 'button', 'data-v': v, title: tip, onclick: () => setState(v) }, label)));
  u.range = dateRange({ idFrom: 'invFrom', idTo: 'invTo', titleFrom: 'Data wystawienia faktury od', titleTo: 'Data wystawienia faktury do',
    onChange: ({ from, to }) => { V.Q.from = from; V.Q.to = to; V.Q.page = 1; load(); } });
  u.more = el('select', { id: 'invMoreState', title: 'Dokładniejszy stan rozliczenia (zastępuje wybór z przycisków)',
    onchange: () => setState(u.more.value) }, el('option', { value: '' }, '— jak w przyciskach —'), MORE_STATES.map(([v, l]) => el('option', { value: v }, l)));
  u.scope = el('select', { id: 'invScope', title: 'Które zamówienia sprawdzać w Selly przy „Uzupełnij z Selly”',
    onchange: () => { V.Q.scope = u.scope.value; load(); } },
  el('option', { value: 'faktura' }, 'zamówienia, w których klient wybrał fakturę'), el('option', { value: 'all' }, 'wszystkie zamówienia (wolniej, więcej zapytań do Selly)'));
  u.recheck = el('button', { type: 'button', class: 'secondary small-btn', id: 'invRecheck', title: 'Sprawdza w Selly jeszcze raz także zamówienia już sprawdzone (np. gdy faktury wystawiono lub zmieniono w Selly). Zużywa jedno zapytanie do Selly na zamówienie.',
    onclick: () => runScan(true) }, 'Sprawdź ponownie cały okres');
  u.opts = el('details', { class: 'inv-opts', id: 'invOpts' },
    el('summary', { title: 'Dokładniejsze filtry i ustawienia uzupełniania listy z Selly' }, 'Więcej opcji ▾'),
    el('div', { class: 'inv-opts-body' },
      el('label', { class: 'field-inline' }, 'Stan rozliczenia', u.more),
      el('label', { class: 'field-inline' }, el('span', { class: 'tip', title: 'Selly nie ma listy wszystkich faktur — panel sprawdza zamówienia po kolei. Domyślnie tylko te, w których klient wybrał dokument „faktura”.' }, 'Uzupełniaj z'), u.scope),
      u.recheck));
  u.cover = el('div', { id: 'invCoverage', class: 'inv-cover' });
  u.sum = el('div', { id: 'invSum', class: 'muted small inv-sum' });
  u.results = el('div', { id: 'invResults' });
  u.dl = downloadMenuButton('invExport', () => V.exportTable || { columns: [], rows: [], file: 'faktury', sheet: 'Faktury' }, 'ordToast', false,
    { label: 'Eksport', cls: 'secondary', title: 'Pobierz faktury z bieżącymi filtrami (wszystkie strony) jako Excel lub CSV' });
  // Eksport pobiera wszystkie strony z bazy panelu przed otwarciem menu (bez zapytań do Selly)
  u.dl.querySelector('button').addEventListener('click', ev => { if (!V.exportTable || V.exportKey !== JSON.stringify(params())) { ev.stopImmediatePropagation(); prepareExport(ev.currentTarget); } }, true);
  V.box.replaceChildren(el('div', { class: 'card' },
    pageToolbar({ title: 'Faktury', sub: 'Faktury ze wszystkich zamówień: rozliczenia, wydruk i eksport. Nowe faktury: „Zamówienia bez faktury” niżej albo karta zamówienia (numer nadaje Selly).',
      actions: [el('a', { href: '#/zamowienia', class: 'btn-secondary', id: 'invBack', title: 'Wraca do listy zamówień' }, '← Zamówienia'), u.dl,
        sellyLink('Zamówienia w Selly ↗', adminUrl() + '?a=zamowienia', 'Otwiera zamówienia w panelu Selly — tam wystawisz fakturę (karta zamówienia → faktura)')] }),
    el('div', { class: 'toolbar inv-toolbar' }, u.search, u.seg),
    el('div', { class: 'toolbar inv-toolbar' }, u.range.node),
    u.opts, u.cover, todoCard(), u.sum, u.results));
  V.built = true;
  syncControls();
}

// ─── Zamówienia bez faktury (do wystawienia) ─────────────────────────────────
function todoCard() {
  const T = V.todo = { rows: [], sel: new Set(), loaded: false, total: 0 };
  T.count = el('span', { id: 'invTodoCount', class: 'muted' });
  T.body = el('div', { id: 'invTodoBody' }, el('p', { class: 'muted small' }, 'Wczytuję…'));
  T.box = el('details', { class: 'inv-todo', id: 'invTodo' },
    el('summary', { title: 'Zamówienia, w których klient wybrał fakturę, sprawdzone w Selly i jeszcze bez faktury — tu wystawisz fakturę (po jednej albo kilka naraz)' },
      'Zamówienia bez faktury ', T.count, ' ▾'), T.body);
  T.box.addEventListener('toggle', () => { if (T.box.open && !T.loaded) loadTodo(); });
  return T.box;
}
async function loadTodo() {
  const T = V.todo;
  try {
    const r = await api('orders:invoiceTodo', { from: V.Q.from, to: V.Q.to });
    T.rows = r.rows || []; T.total = r.total || 0; T.loaded = true;
    T.sel = new Set([...T.sel].filter(id => T.rows.some(x => x.orderId === id)));
    renderTodo();
  } catch (e) { T.body.replaceChildren(el('div', { class: 'empty error' }, 'Nie udało się wczytać zamówień bez faktury: ' + (e.message || 'błąd'))); }
}
function renderTodo() {
  const T = V.todo;
  T.count.textContent = '(' + T.total + ')';
  if (!T.rows.length) {
    T.body.replaceChildren(el('div', { class: 'empty', id: 'invTodoEmpty' }, 'Brak — sprawdzone zamówienia z dokumentem „faktura” mają faktury. Niesprawdzone uzupełnisz przyciskiem „Uzupełnij z Selly”.'));
    return;
  }
  const panelHost = el('div', { id: 'invTodoIssueHost' });
  const msg = el('span', { class: 'muted small', id: 'invTodoMsg', role: 'status' }, T.note || '');   // wynik ostatniej partii przetrwa odświeżenie listy
  T.note = '';
  const batch = gateWrite(el('button', { type: 'button', class: 'secondary small-btn', id: 'invTodoBatch',
    title: 'Wystawia faktury dla zaznaczonych zamówień (najwyżej ' + BATCH_MAX + ' naraz): najpierw podgląd każdej, potem jedno potwierdzenie z listą i kwotami' }, 'Wystaw zaznaczone…'), 'faktury');
  const mailTip = 'Selly wyśle klientom wystawione faktury na adresy z zamówień. Domyślnie wyłączone — faktury tylko powstają w Selly.';
  const mailCb = el('input', { type: 'checkbox', id: 'invTodoEmail', title: mailTip });
  const mailLbl = el('label', { class: 'check', title: mailTip }, mailCb, el('span', { class: 'tip', title: mailTip }, ' Wyślij faktury klientom e-mailem'));
  const syncBatch = () => { batch.disabled = !T.sel.size; batch.textContent = T.sel.size ? 'Wystaw zaznaczone (' + T.sel.size + ')…' : 'Wystaw zaznaczone…'; };
  const refreshAll = () => { V.exportTable = null; load(); loadTodo(); };
  batch.addEventListener('click', async () => {
    const rows = T.rows.filter(x => T.sel.has(x.orderId)).slice(0, BATCH_MAX);
    batch.disabled = true;
    try {
      const r = await (await wystaw()).issueBatch(rows, t => { msg.textContent = t; }, { sendEmail: mailCb.checked });
      if (!r.cancelled) {
        const parts = [];
        if (r.done.length) parts.push('Wystawiono: ' + cnt(r.done.length, 'fakturę', 'faktury', 'faktur') + '.');
        if (r.failed.length) parts.push('Nie udało się: ' + r.failed.map(x => (x.orderNumber || x.orderId) + ' (' + x.why + ')').join('; ') + '.');
        if (r.skipped.length) parts.push('Pominięte: ' + r.skipped.map(x => (x.orderNumber || x.orderId) + ' (' + x.why + ')').join('; ') + '.');
        msg.textContent = T.note = parts.join(' ') || 'Nic do wystawienia.';
        if (r.done.length) { T.sel.clear(); refreshAll(); }
        if (r.done.length) flash('ordToast', parts[0]);
      }
    } catch (e) { msg.textContent = 'Partia przerwana: ' + (e.message || 'błąd'); }
    finally { syncBatch(); }
  });
  const tbody = el('tbody', null, T.rows.map(x => {
    const cb = el('input', { type: 'checkbox', id: 'invTodoSel-' + x.orderId, 'aria-label': 'Zaznacz zamówienie ' + (x.orderNumber || x.orderId), checked: T.sel.has(x.orderId) || null });
    cb.addEventListener('change', () => {
      if (cb.checked && T.sel.size >= BATCH_MAX) { cb.checked = false; msg.textContent = 'Najwyżej ' + BATCH_MAX + ' faktur w jednej partii.'; return; }
      if (cb.checked) T.sel.add(x.orderId); else T.sel.delete(x.orderId);
      syncBatch();
    });
    const one = gateWrite(el('button', { type: 'button', class: 'small-btn secondary', id: 'invTodoIssue-' + x.orderId, title: 'Podgląd faktury przygotowanej przez Selly i wystawienie po potwierdzeniu',
      onclick: async () => { const { issuePanel } = await wystaw(); panelHost.replaceChildren(issuePanel({ orderId: x.orderId, onDone: refreshAll, onClose: () => panelHost.replaceChildren() })); } }, 'Wystaw…'), 'faktury');
    return el('tr', { 'data-order': x.orderId }, el('td', null, cb),
      el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(x.orderId), title: 'Otwórz kartę zamówienia' }, x.orderNumber || x.orderId)),
      el('td', { class: 'nw' }, plDay(x.date)), el('td', { class: 'inv-buyer' }, x.buyer || el('span', { class: 'muted' }, '—')), el('td', { class: 'nw' }, one));
  }));
  const th = (t, tip) => el('th', null, el('span', { title: tip || t, class: tip ? 'tip' : null }, t));
  T.body.replaceChildren(
    el('p', { class: 'muted small' }, 'Faktura powstaje w Selly (kolejny numer, dane sprzedawcy) — przed wystawieniem zobaczysz podgląd z kwotami. Partia: najwyżej ' + BATCH_MAX + ' zamówień, jedno potwierdzenie.'),
    el('div', { class: 'table-wrap' }, el('table', { id: 'invTodoTable', class: 'inv-table' },
      el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Zaznacz zamówienia do wystawienia partią (najwyżej ' + BATCH_MAX + ')' }, '✓')),
        th('Zamówienie', 'Numer zamówienia — kliknij, aby otworzyć kartę'), th('Data', 'Data zamówienia'), th('Nabywca', 'Firma albo imię i nazwisko z danych do faktury zamówienia'), th('Działania'))),
      tbody)),
    T.total > T.rows.length ? el('p', { class: 'muted small' }, 'Pokazano ' + T.rows.length + ' najnowszych z ' + T.total + '.') : null,
    el('div', { class: 'ord-actions' }, batch, mailLbl, msg), panelHost);
  syncBatch();
}

function setState(v) {
  V.Q.state = v; V.Q.page = 1;
  syncControls();
  load();
}
function syncControls() {
  const u = V.ui;
  for (const b of u.seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === V.Q.state));
  u.more.value = MORE_STATES.some(([v]) => v === V.Q.state) ? V.Q.state : '';
  u.scope.value = V.Q.scope;
}

async function load() {
  const my = ++V.seq, u = V.ui;
  if (!V.data) u.results.replaceChildren(loadingBox('Wczytuję faktury…'));
  else u.results.classList.add('is-loading');
  try {
    const r = await api('orders:invoiceList', { ...params(), page: V.Q.page, pageSize: SIZE });
    if (my !== V.seq) return;
    V.data = r;
    render();
  } catch (e) {
    if (my !== V.seq) return;
    u.results.replaceChildren(el('div', { class: 'empty error' }, 'Nie udało się wczytać faktur: ' + (e.message || 'błąd') + '. ',
      el('button', { type: 'button', class: 'secondary small-btn', onclick: () => load() }, 'Spróbuj ponownie')));
  } finally { u.results.classList.remove('is-loading'); }
}

function coverage() {
  const u = V.ui, d = V.data || {}, s = V.scan;
  const who = V.Q.scope === 'all' ? 'zamówień' : 'zamówień z dokumentem „faktura”';
  const range = V.Q.from || V.Q.to ? ' z wybranego okresu' : '';
  if (s && !s.stop) {
    u.cover.className = 'inv-cover notice';
    u.cover.replaceChildren(el('span', { id: 'invScanMsg', role: 'status' }, s.msg),
      el('button', { type: 'button', class: 'secondary small-btn', id: 'invScanStop', title: 'Zatrzymuje uzupełnianie — to, co już sprawdzono, zostaje w liście', onclick: () => { s.stop = true; coverage(); } }, 'Zatrzymaj'));
    return;
  }
  const btn = el('button', { type: 'button', class: 'primary small-btn', id: 'invScan', onclick: () => runScan(false),
    title: 'Sprawdza w Selly faktury zamówień jeszcze niesprawdzonych (po ' + (d.scanMax || 15) + ' naraz, z przerwami — oszczędza limit API Selly). Tylko odczyt: nic w Selly się nie zmienia.' }, 'Uzupełnij z Selly');
  if (d.pending > 0) {
    u.cover.className = 'inv-cover notice warn';
    const n = d.pending, what = plural(n, 'zamówienie', 'zamówienia', 'zamówień') + (V.Q.scope === 'all' ? '' : ' z dokumentem „faktura”');
    u.cover.replaceChildren(el('span', { id: 'invPending' }, n + ' ' + what + range + ' ' + plural(n, 'czeka', 'czekają', 'czeka') + ' na sprawdzenie w Selly — lista może być niepełna.'), btn);
  } else {
    u.cover.className = 'inv-cover muted small';
    u.cover.replaceChildren(el('span', { id: 'invPending', title: 'Zamówienia zmienione po sprawdzeniu są sprawdzane ponownie. Fakturę wystawioną w Selly bez zmiany zamówienia pokaże „Sprawdź ponownie cały okres” w „Więcej opcji” albo otwarcie karty zamówienia.' },
      'Sprawdzono wszystkie ' + who + range + (d.lastScanMs ? ' (ostatnio: ' + syncedLabel(d.lastScanMs) + ')' : '') + '.'));
  }
}

async function runScan(recheck) {
  if (V.scan && !V.scan.stop) return;
  const s = V.scan = { stop: false, done: 0, found: 0, msg: 'Sprawdzam faktury w Selly…' };
  coverage();
  let rc = recheck ? true : 0, idle = 0;
  try {
    while (!s.stop && V.visible) {
      const r = await api('orders:invoiceScan', { from: V.Q.from, to: V.Q.to, scope: V.Q.scope, recheck: rc });
      if (r.recheckMs) rc = r.recheckMs;
      if (r.paused) {
        s.msg = 'Przerwa: limit zapytań do Selly w tej minucie jest prawie wykorzystany — wznowię za ' + (r.waitS || 30) + ' s.';
        coverage(); await sleep((r.waitS || 30) * 1000); continue;
      }
      s.done += r.scanned; s.found += r.found;
      s.msg = 'Sprawdzono ' + cnt(s.done, 'zamówienie', 'zamówienia', 'zamówień') + ', znaleziono ' + cnt(s.found, 'fakturę', 'faktury', 'faktur') +
        (r.remaining ? '; zostało ' + r.remaining + '…' : '.') + (r.failed ? ' Błędy odczytu: ' + r.failed + '.' : '');
      coverage();
      if (!r.remaining) break;
      if (!r.scanned) { if (++idle >= 2) { s.msg += ' Przerywam — Selly nie odpowiada poprawnie, spróbuj później.'; break; } } else idle = 0;
      await sleep(PAUSE_MS);
    }
  } catch (e) {
    flash('ordToast', 'Uzupełnianie przerwane: ' + (e.message || 'błąd'));
  } finally {
    const msg = s.msg;
    s.stop = true; V.scan = null; V.exportTable = null;
    if (V.visible) { flash('ordToast', msg); load(); }
  }
}

function render() {
  const u = V.ui, d = V.data;
  coverage();
  u.sum.replaceChildren(el('span', { title: 'Liczba faktur spełniających filtry' }, cnt(d.total, 'faktura', 'faktury', 'faktur')),
    ' · ', el('span', { class: 'tip', title: 'Suma wartości brutto faktur spełniających filtry (bez anulowanych)' }, 'wartość ' + money(d.sumValue) + ' zł'),
    ' · ', el('span', { class: 'tip', id: 'invDue', title: 'Wartość minus zapłacono — dla faktur nierozliczonych i częściowo rozliczonych' }, 'do zapłaty ' + money(d.sumDue) + ' zł'));
  if (!d.rows.length) {
    const hint = d.pending > 0 ? 'Brak faktur w liście — kliknij „Uzupełnij z Selly”, aby sprawdzić zamówienia.' : (V.Q.q || V.Q.state || V.Q.from || V.Q.to ? 'Brak faktur spełniających filtry.' : 'Brak faktur.');
    u.results.replaceChildren(el('div', { class: 'empty', id: 'invEmpty' }, hint));
    return;
  }
  const st = { sort: V.Q.sort, dir: V.Q.dir };
  const onSort = (sort, dir) => { V.Q.sort = sort; V.Q.dir = dir; V.Q.page = 1; load(); };
  const cols = [
    { label: 'Numer', sort: 'number', tip: 'Numer faktury (prefiks + numer + sufiks, jak w Selly)', firstDir: 'desc' },
    { label: 'Data', sort: 'date', tip: 'Data wystawienia faktury', firstDir: 'desc' },
    { label: 'Zamówienie', sort: 'order', tip: 'Numer zamówienia — kliknij, aby otworzyć kartę zamówienia', tipHeader: true, firstDir: 'desc' },
    { label: 'Nabywca', tip: 'Firma albo imię i nazwisko z danych do faktury zamówienia', tipHeader: true },
    { label: 'Wartość (zł)', sort: 'value', num: true, tip: 'Wartość faktury brutto' },
    { label: 'Zapłacono (zł)', num: true, tip: 'Kwota zapłacona za fakturę (pole „Zapłacono za fakturę” w Selly)', tipHeader: true },
    { label: 'Termin', sort: 'deadline', tip: 'Termin płatności z faktury; czerwony = minął, a faktura nie jest rozliczona', tipHeader: true, firstDir: 'asc' },
    { label: 'Status', sort: 'status', tip: 'Stan rozliczenia faktury w Selly', firstDir: 'asc' },
    { label: 'Działania', tip: 'Działania' },
  ];
  const tbody = el('tbody');
  for (const r of d.rows) {
    const late = isOverdue(r.statusId, r.deadline);
    const tr = el('tr', { 'data-inv': r.invoiceId, 'data-order': r.orderId });
    const editRow = el('tr', { class: 'inv-edit-row', hidden: true }, el('td', { colspan: String(cols.length) }));
    const getInv = async () => {
      const x = await api('orders:invoices', { id: r.orderId });
      const inv = (x.invoices || []).find(i => String(i.invoice_id) === String(r.invoiceId));
      if (!inv) throw new Error('faktury nie ma już w Selly — odśwież listę');
      return inv;
    };
    const editBtn = Number(r.statusId) === 4 ? null : gateWrite(el('button', { type: 'button', class: 'small-btn secondary', id: 'invEdit-' + r.invoiceId,
      title: 'Zmień status rozliczenia, kwotę zapłaconą, termin lub formę płatności i uwagi. Najpierw pobiera aktualną fakturę z Selly.' }, 'Rozliczenie'), 'zamowienia');
    if (editBtn) editBtn.addEventListener('click', async () => {
      if (!editRow.hidden) { editRow.hidden = true; return; }
      editBtn.disabled = true;
      try {
        const inv = await getInv();
        editRow.firstChild.replaceChildren(invoiceEditor({ orderId: r.orderId, inv, key: 'l' + r.invoiceId,
          onSaved: () => { V.exportTable = null; load(); }, onClose: () => { editRow.hidden = true; } }));
        editRow.hidden = false;
      } catch (e) { flash('ordToast', 'Nie udało się pobrać faktury: ' + (e.message || 'błąd')); }
      finally { editBtn.disabled = false; }
    });
    tr.append(
      el('td', { class: 'nw' }, el('strong', null, r.number || '#' + r.invoiceId)),
      el('td', { class: 'nw' }, plDay(r.date)),
      el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(r.orderId), title: 'Otwórz kartę zamówienia' }, r.orderNumber || r.orderId)),
      el('td', { class: 'inv-buyer' }, r.buyer || el('span', { class: 'muted' }, '—')),
      el('td', { class: 'n nw' }, r.value == null ? '—' : money(r.value)),
      el('td', { class: 'n nw' }, r.paid == null ? '—' : money(r.paid)),
      el('td', { class: 'nw' + (late ? ' inv-late' : ''), title: late ? 'Termin płatności minął, a faktura nie jest rozliczona' : null }, plDay(r.deadline)),
      el('td', null, invStatusPill(r.statusId)),
      el('td', { class: 'nw inv-acts' }, printButton('invPrint-' + r.invoiceId, getInv, { orderNumber: r.orderNumber }), editBtn));
    tbody.append(tr, editRow);
  }
  const pages = Math.max(1, Math.ceil(d.total / SIZE));
  u.results.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'invTable', class: 'inv-table' },
    el('thead', null, el('tr', null, cols.map(c => sortTh(c, st, onSort)))), tbody)),
  pages > 1 ? pager({ prefix: 'inv', page: V.Q.page, pages, total: d.total, noun: ['faktura', 'faktury', 'faktur'], onPage: p => { V.Q.page = p; load(); } }) : null,
  el('p', { class: 'muted small' }, 'Nową fakturę wystawisz w „Zamówienia bez faktury” wyżej albo w karcie zamówienia (Selly nadaje kolejny numer).'));
}

async function prepareExport(btn) {
  btn.disabled = true;
  try {
    const r = await api('orders:invoiceList', { ...params(), export: true });
    const status = id => (INV_STATUS[Number(id)] || ['—'])[0];
    V.exportTable = { file: 'faktury', sheet: 'Faktury',
      note: r.rows.length < r.total ? 'Uwaga: eksport obejmuje pierwsze ' + r.rows.length + ' z ' + r.total + ' faktur.' : '',
      columns: [{ header: 'Numer faktury', type: 'text' }, { header: 'Data wystawienia', type: 'date' }, { header: 'Nr zamówienia', type: 'text' }, { header: 'Nabywca', type: 'text' },
        { header: 'Wartość brutto (zł)', type: 'number' }, { header: 'Zapłacono (zł)', type: 'number' }, { header: 'Do zapłaty (zł)', type: 'number' }, { header: 'Termin płatności', type: 'date' },
        { header: 'Forma płatności', type: 'text' }, { header: 'Status', type: 'text' }],
      rows: r.rows.map(x => [x.number, String(x.date || '').slice(0, 10), x.orderNumber || x.orderId, x.buyer || '', x.value, x.paid,
        [2, 3].includes(Number(x.statusId)) ? Math.max(0, Math.round(((x.value || 0) - (x.paid || 0)) * 100) / 100) : 0, x.deadline, x.method, status(x.statusId)]) };
    V.exportKey = JSON.stringify(params());
    btn.disabled = false;
    btn.click();
  } catch (e) { flash('ordToast', 'Nie udało się przygotować eksportu: ' + (e.message || 'błąd')); btn.disabled = false; }
}
