// Moduł „Wysyłka SpeedMail” (#/speedmail/<krok>): kreator przekazania zamówień do magazynu zewnętrznego SpeedMail (SM).
// Kroki: 1. wybór zamówień (kandydaci + czy SM ma towar) → status „Złożone SpeedMail”; 2. sprawdzenie i podział (SM / na miejscu
// → „Złożone OTK”); 3. plik dla SM w kompletach (układ kolumn zapamiętany); 4. zatwierdzenie: wydanie z magazynu SM + status
// „Przyjęte SpeedMail”; historia wysyłek (+ przyjęcie dostawy do SM wklejonej z Excela).
// Dane: mag:init / mag:settled / mag:confirm / mag:packs / mag:moves (Apps Script: Warehouses.gs, SpeedMail.gs), mag:orders
// (Worker — świeże statusy z D1; zapasowo Apps Script), zmiana statusu: orders:setStatus porcjami (lib/statusBatch.js).
// Logika bez DOM: speedmailLogic.js. Bez danych osobowych — tylko numery zamówień, daty i pozycje.
import { $, el, plural, store, flash, norm, tableTsv, tableHtml, downloadXlsx, copyToClipboard, today, cnt } from '../core/ui.js?v=c46bdf1';
import { api, canWriteSection } from '../core/client.js?v=c46bdf1';
import { go } from '../core/router.js?v=c46bdf1';
import { setStatusInChunks } from '../lib/statusBatch.js?v=c46bdf1';
import * as L from './speedmailLogic.js?v=c46bdf1';

const STATUS_WRITE = ['zamowienia', 'przesylki'];   // jak reguła orders:setStatus (shared/panelAuth.js)
const STEPS = [
  ['kandydaci', '1. Wybór zamówień', 'Zamówienia czekające na realizację: które SpeedMail może zrealizować z bieżącego stanu — zaznacz i oznacz w Selly jako „Złożone SpeedMail”'],
  ['podzial', '2. Sprawdź i podziel', 'Zamówienia „Złożone SpeedMail”: automatyczny podział na wysyłane do SpeedMail i realizowane na miejscu („Złożone OTK”)'],
  ['plik', '3. Plik dla SM', 'Tabela dla SpeedMail w kompletach (nie w sztukach): podgląd, układ kolumn, pobranie .xlsx'],
  ['zatwierdz', '4. Zatwierdź', 'Zapis wydania z magazynu SpeedMail i zmiana statusu w Selly na „Przyjęte SpeedMail”'],
  ['historia', 'Historia wysyłek', 'Poprzednie wysyłki do SpeedMail (numer referencyjny, data, zamówienia, komplety) i przyjęcie dostawy do SM'],
];
const VIEW_KEYS = new Set(STEPS.map(s => s[0]));
const FILE_DEFAULT = { rows: 'orders', orderNo: true, date: true, ref: false, total: true };

const S = {
  view: 'kandydaci', mag: null, orders: null, loading: false, err: '', settledErr: '', truncated: false,
  sel: new Set(), onlyFits: false, q: '', forced: new Map(), ref: '', job: null, busy: false, shipErr: '', lastShip: null,
  editPid: '', draft: null, imp: { text: '', unit: 'kits', rows: null }, sort: { key: 'name', dir: 1 },
};

const nf = n => (n == null || n === '' ? '—' : String(Math.round(n * 1000) / 1000).replace('.', ','));
const statusName = id => { const s = S.mag && S.mag.statuses.find(x => String(x.id) === String(id)); return s ? s.name : (id ? '#' + id : '—'); };
const whName = id => { const w = S.mag && S.mag.warehouses.find(x => x.id === id); return w ? w.name : ''; };
const packs = () => (S.mag && S.mag.packs) || {};
const isPartial = () => !(S.mag && S.mag.startMs);
const notice = (kind, ...c) => el('div', { class: 'notice ' + kind, role: kind === 'error' ? 'alert' : null }, ...c);
const th = (label, tip, num) => el('th', { class: num ? 'n' : null }, el('span', { class: tip ? 'tip' : null, title: tip || label }, label));
const itemsText = items => items.filter(i => !i.settled).map(i => i.name + ' × ' + nf(i.qty)).join(', ');
const kitsText = (pid, q) => { const k = q / L.packOf(packs(), pid).size; return nf(k) + ' kpl.'; };

// ─── Ustawienia (zapamiętane w przeglądarce; domyślne z nazw statusów i magazynów) ────────────
function cfg() {
  const d = L.defaultSettings(S.mag.statuses, S.mag.warehouses);
  const ids = new Set(S.mag.statuses.map(s => String(s.id)));
  const pick = (k, def) => { const v = store(k); return v != null && ids.has(String(v)) ? String(v) : def; };
  const st = pick('osa-sm-status', d.st), acc = pick('osa-sm-acc', d.acc), otk = pick('osa-sm-otk', d.otk);
  let wh = store('osa-sm-wh'); if (!S.mag.warehouses.some(w => w.id === wh)) wh = d.wh;
  let open = store('osa-sm-open'); open = Array.isArray(open) ? open.map(String).filter(x => ids.has(x)) : d.open;
  open = open.filter(x => x !== st && x !== acc && x !== otk);
  return { st, acc, otk, wh, open };
}
const fileOpts = () => Object.assign({}, FILE_DEFAULT, store('osa-sm-file') || {});

// ─── Dane ───────────────────────────────────────────────────────────────────
async function load(full) {
  S.loading = true; S.err = '';
  render();
  try {
    if (full || !S.mag) S.mag = await api('mag:init', {});
    await loadOrders();
  } catch (e) { S.err = e.message || 'Nie udało się pobrać danych.'; }
  S.loading = false;
  render();
}

/** Zamówienia w statusach kandydatów i „Złożone SpeedMail” — jedno zapytanie; wydane pozycje dopytane w Apps Script, gdy listę dał Worker. */
async function loadOrders() {
  const c = cfg();
  const ids = [...new Set(c.open.concat(c.st ? [c.st] : []))];
  S.settledErr = ''; S.truncated = false;
  if (!ids.length) { S.orders = []; return; }
  const r = await api('mag:orders', { statusIds: ids });
  const orders = r.orders || [];
  S.truncated = !!r.truncated;
  if (r.settledKnown === false) {
    const smIds = orders.filter(o => o.statusId === c.st).map(o => o.orderId);
    if (smIds.length) {
      try {
        const s = await api('mag:settled', { orderIds: smIds });
        const set = new Set((s.settled || []).map(String));
        for (const o of orders) for (const i of o.items) if (set.has(String(i.productOrderId))) i.settled = true;
      } catch (e) { S.settledErr = e.message || 'błąd'; }
    }
  }
  S.orders = orders;
  const cand = new Set(orders.filter(o => c.open.includes(o.statusId)).map(o => o.orderId));
  for (const id of [...S.sel]) if (!cand.has(id)) S.sel.delete(id);
  for (const id of [...S.forced.keys()]) if (!orders.some(o => o.orderId === id && o.statusId === c.st)) S.forced.delete(id);
}

function model() {
  const c = cfg();
  const stock = L.stockOf(S.mag.products, c.wh);
  const smAll = (S.orders || []).filter(o => o.statusId === c.st);
  const smOpen = smAll.filter(o => o.items.some(i => !i.settled));
  const candidates = (S.orders || []).filter(o => c.open.includes(o.statusId));
  const chk = L.checkCandidates(candidates, smOpen, stock);
  const split = L.splitOrders(smOpen, stock, S.forced);
  return { c, stock, smAll, smOpen, stuck: L.stuckOrders(smAll), chk, split };
}

// ─── Zmiana statusu w Selly (porcje, postęp, nieudane + ponowienie) ─────────
async function runStatus(job) {
  job.running = true; job.n = 0; job.done = job.done || []; job.failed = [];
  S.job = job; render();
  const r = await setStatusInChunks(api, job.ids, job.target, { onProgress: (n) => { job.n = n; const b = $('smJobBar'); if (b) b.value = n; const t = $('smJobTxt'); if (t) t.textContent = 'Zapisuję: ' + n + ' z ' + job.ids.length; } });
  job.done.push(...r.done); job.failed = r.failed; job.running = false;
  if (r.done.length) flash('', 'Zmieniono status na „' + statusName(job.target) + '”: ' + r.done.length);
  try { await loadOrders(); } catch (e) { S.err = e.message || ''; }
  render();
  if (!r.failed.length && job.then) job.then();
}

function startStatus(ids, target, title, numOf, then) {
  if (!target) { flash('', 'Wybierz status w ustawieniach wysyłki.'); return; }
  runStatus({ ids, target, title, numOf, then });
}

function jobCard() {
  const j = S.job;
  if (!j) return null;
  const tn = statusName(j.target);
  const body = j.running
    ? [el('progress', { id: 'smJobBar', max: String(j.ids.length), value: String(j.n || 0), 'aria-label': 'Postęp zmiany statusu' }), el('div', { class: 'muted small', id: 'smJobTxt', role: 'status' }, 'Zapisuję: ' + (j.n || 0) + ' z ' + j.ids.length)]
    : [el('p', { id: 'smJobSum' }, 'Zmieniono: ', el('strong', null, String(j.done.length)), ' · nieudane: ', el('strong', null, String(j.failed.length))),
      j.failed.length ? el('ul', { class: 'ord-fails' }, j.failed.slice(0, 30).map(f => el('li', null, el('strong', null, (j.numOf && j.numOf.get(f.id)) || f.id), ' — ' + f.error)),
        j.failed.length > 30 ? el('li', { class: 'muted' }, '… i ' + (j.failed.length - 30) + ' więcej') : null) : null,
      el('div', { class: 'ord-actions' },
        j.failed.length ? el('button', { type: 'button', class: 'primary', id: 'smJobRetry', write: STATUS_WRITE, title: 'Spróbuj ponownie tylko dla zamówień, którym nie udało się zmienić statusu',
          onclick: () => runStatus({ ids: j.failed.map(f => f.id), target: j.target, title: j.title, numOf: j.numOf, then: j.then, done: j.done }) }, 'Ponów nieudane (' + j.failed.length + ')') : null,
        el('button', { type: 'button', class: 'secondary', id: 'smJobClose', onclick: () => { S.job = null; render(); } }, 'Zamknij'))];
  return el('div', { class: 'card ord-dialog', id: 'smJob', role: 'region', 'aria-label': 'Zmiana statusu w Selly' },
    el('h3', null, j.running ? 'Zmieniam status na „' + tn + '”…' : j.failed.length ? 'Zmiana statusu na „' + tn + '” — część się nie udała' : 'Status zmieniony na „' + tn + '”'),
    j.title ? el('div', { class: 'muted small' }, j.title) : null, body);
}
const jobBusy = () => !!(S.job && S.job.running) || S.busy;

// ─── Widok ─────────────────────────────────────────────────────────────────
function render() {
  const root = $('smBody'), nav = $('smNav');
  if (!root) return;
  const m = S.mag && S.orders ? model() : null;
  const counts = m ? { kandydaci: m.chk.rows.length, podzial: m.split.rows.length, plik: m.split.send.length, zatwierdz: m.split.send.length } : {};
  nav.replaceChildren(...STEPS.map(([k, label, tip]) => el('button', { type: 'button', 'aria-pressed': String(S.view === k), title: tip + (counts[k] != null ? '\n\nLiczba w nawiasie = zamówienia w tym kroku' : ''),
    onclick: () => go('/speedmail/' + k) }, label + (counts[k] ? ' (' + counts[k] + ')' : ''))));
  if (!S.mag) {
    root.replaceChildren(el('div', { class: 'card' }, S.loading || !S.err ? el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), 'Pobieram stany magazynów i zamówienia…'))
      : el('div', { class: 'empty error' }, 'Nie udało się otworzyć wysyłki SpeedMail: ' + S.err, el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => load(true) }, 'Spróbuj ponownie')))));
    return;
  }
  const parts = [settingsCard()];
  const c = cfg();
  if (!c.st || !c.wh) { parts.push(el('div', { class: 'card' }, el('div', { class: 'empty' }, !c.wh ? 'Wybierz w ustawieniach magazyn SpeedMail.' : 'Wybierz w ustawieniach status „Złożone SpeedMail”.'))); root.replaceChildren(...parts); return; }
  if (S.err) parts.push(notice('error', S.err));
  if (S.job) parts.push(jobCard());
  if (!m) { parts.push(el('div', { class: 'card' }, el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), 'Pobieram zamówienia…')))); root.replaceChildren(...parts); return; }
  if (isPartial()) parts.push(notice('warn', 'Stan magazynu SpeedMail jest nieznany — nie było jeszcze inwentaryzacji, więc panel uzna, że SM nic nie ma. ',
    el('a', { href: '#/magazyny/inwentaryzacja' }, 'Przejdź do inwentaryzacji')));
  if (S.settledErr) parts.push(notice('warn', 'Nie udało się sprawdzić, które zamówienia mają już zapisane wydanie (' + S.settledErr + '). Zatwierdzenie i tak nie zapisze wydania tej samej pozycji drugi raz.'));
  if (S.truncated) parts.push(notice('warn', 'Zamówień w wybranych statusach jest bardzo dużo — pokazano najstarsze 3000. Zawęź statusy kandydatów w ustawieniach.'));
  const v = { kandydaci: viewCandidates, podzial: viewSplit, plik: viewFile, zatwierdz: viewConfirm, historia: viewHistory }[S.view];
  parts.push(v(m));
  root.replaceChildren(...parts);
}

function settingsCard() {
  const d = S.mag, c = cfg();
  const sel = (key, value, label, tip) => {
    const s = el('select', { 'aria-label': label }, el('option', { value: '' }, '— wybierz —'), d.statuses.map(x => el('option', { value: String(x.id) }, x.name)));
    s.value = value;
    s.addEventListener('change', async () => { store(key, s.value); await reloadOrders(); });
    return el('label', { title: tip }, el('span', { class: 'tip' }, label), s);
  };
  const whSel = el('select', { 'aria-label': 'Magazyn SpeedMail' }, el('option', { value: '' }, '— wybierz —'), d.warehouses.map(w => el('option', { value: w.id }, w.name)));
  whSel.value = c.wh;
  whSel.addEventListener('change', () => { store('osa-sm-wh', whSel.value); render(); });
  const special = new Set([c.st, c.acc, c.otk]);
  const openBox = el('div', { class: 'statuses' }, d.statuses.filter(s => !special.has(String(s.id))).map(s => {
    const cb = el('input', { type: 'checkbox', value: String(s.id) }); cb.checked = c.open.includes(String(s.id));
    cb.addEventListener('change', async () => { store('osa-sm-open', [...openBox.querySelectorAll('input:checked')].map(i => i.value)); await reloadOrders(); });
    return el('label', null, cb, s.name);
  }));
  const missing = !c.st || !c.wh || !c.acc || !c.open.length;
  return el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' },
      el('div', null, el('h2', { style: 'margin:0' }, 'Wysyłka do SpeedMail'),
        el('div', { class: 'muted small' }, 'Wybierz zamówienia → sprawdź, czy SpeedMail ma towar → pobierz plik → zatwierdź. Statusy w Selly zmieniają się stąd, bez przepisywania numerów.')),
      el('span', { class: 'sp' }),
      el('button', { type: 'button', class: 'secondary', id: 'smRefresh', title: 'Pobierz ponownie zamówienia, stany magazynów i historię wysyłek', disabled: jobBusy(), onclick: () => load(true) }, '↻ Odśwież')),
    el('details', { class: 'fold', id: 'smSettings', open: missing },
      el('summary', null, el('span', null, 'Ustawienia wysyłki'), el('span', { class: 'sum' }, ' magazyn: ', el('b', null, whName(c.wh) || '—'), ' · kandydaci: ', el('b', null, c.open.map(statusName).join(', ') || '—'))),
      el('div', { class: 'mag-form' },
        el('label', { title: 'Magazyn, z którego liczymy towar SpeedMail i z którego zapisujemy wydanie' }, el('span', { class: 'tip' }, 'Magazyn SpeedMail'), whSel),
        sel('osa-sm-status', c.st, 'Status „Złożone SpeedMail”', 'Zamówienia przekazane do SpeedMail, czekające na wysyłkę pliku (krok 2–4)'),
        sel('osa-sm-acc', c.acc, 'Status „Przyjęte SpeedMail”', 'Status ustawiany po zatwierdzeniu wysyłki (SpeedMail przyjął zamówienia do realizacji)'),
        sel('osa-sm-otk', c.otk, 'Status „Złożone OTK”', 'Status dla zamówień, których SpeedMail nie zrealizuje — realizujesz je na miejscu')),
      el('p', { class: 'muted small', style: 'margin-top:var(--s3)' }, el('span', { class: 'tip', title: 'Zamówienia w tych statusach pokazujemy w kroku 1 jako kandydatów do SpeedMail. Statusy SpeedMail i OTK są pomijane.' }, 'Statusy kandydatów (krok 1):')),
      openBox,
      el('p', { class: 'muted small' }, 'Ustawienia zapamiętuje ta przeglądarka. Przeliczniki (sztuk w komplecie) i układ kolumn pliku są wspólne dla wszystkich. ',
        el('a', { href: '#/magazyny/stany', title: 'Stany fizyczne wszystkich magazynów, przyjęcia, przesunięcia i inwentaryzacja' }, 'Stany magazynów →'))));
}

async function reloadOrders() {
  S.orders = null; render();
  try { await loadOrders(); } catch (e) { S.err = e.message || ''; S.orders = []; }
  render();
}

const tile = (n, label, title, id) => el('div', { class: 'tab static', title, id: id || null }, el('b', null, String(n)), el('span', null, label));

// ── Krok 1: wybór zamówień ───────────────────────────────────────────────────
function viewCandidates(m) {
  const { rows, avail, reserved } = m.chk;
  const fitsN = rows.filter(r => r.fits).length;
  const box = el('div');
  box.append(el('div', { class: 'tabs', style: 'margin-top:var(--s3)' },
    tile(rows.length, 'kandydatów', 'Zamówienia w statusach: ' + m.c.open.map(statusName).join(', ') + ' (z pozycjami do wysłania)'),
    tile(fitsN, 'SM zrealizuje', 'Zamówienia, które — każde osobno — mieszczą się w towarze dostępnym w SpeedMail (stan minus to, co już zarezerwowały zamówienia „Złożone SpeedMail”)'),
    tile(m.smOpen.length, 'już w „Złożone SpeedMail”', 'Zamówienia przekazane wcześniej, jeszcze bez zatwierdzonej wysyłki — ich towar jest zarezerwowany')));
  if (!m.c.open.length) { box.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Wybierz w ustawieniach wysyłki statusy kandydatów (np. „Złożone”, „Opłacone”).'))); return box; }

  const qn = norm(S.q);
  const shown = rows.filter(r => (!S.onlyFits || r.fits) && (!qn || norm(r.o.orderNumber).includes(qn)));
  const q = el('input', { type: 'search', placeholder: 'Szukaj numeru…', 'aria-label': 'Szukaj numeru zamówienia', value: S.q });
  q.addEventListener('input', () => { S.q = q.value; const p = q.selectionStart; render(); const n = $('smCandQ'); if (n) { n.focus(); n.setSelectionRange(p, p); } });
  q.id = 'smCandQ';
  const of = el('input', { type: 'checkbox', id: 'smOnlyFits' }); of.checked = S.onlyFits;
  of.addEventListener('change', () => { S.onlyFits = of.checked; render(); });
  const pick = el('button', { type: 'button', class: 'secondary', id: 'smPickFits', disabled: !fitsN,
    title: 'Zaznacza zamówienia od najstarszych, dopóki SpeedMail ma na nie ŁĄCZNIE dość towaru (pozostałe odznacza)',
    onclick: () => { S.sel = new Set(L.autoPick(rows, avail)); render(); } }, 'Zaznacz wszystkie, które SM zrealizuje');
  const none = el('button', { type: 'button', class: 'secondary', disabled: !S.sel.size, onclick: () => { S.sel.clear(); render(); } }, 'Odznacz wszystkie');

  const { use, over } = L.selectionUse(rows, S.sel, avail);
  const body = el('tbody', null, shown.length ? shown.map(r => {
    const cb = el('input', { type: 'checkbox', 'aria-label': 'Zaznacz zamówienie ' + r.o.orderNumber }); cb.checked = S.sel.has(r.o.orderId);
    cb.addEventListener('change', () => { if (cb.checked) S.sel.add(r.o.orderId); else S.sel.delete(r.o.orderId); render(); });
    return el('tr', { 'data-id': r.o.orderId },
      el('td', null, cb), el('td', null, r.o.orderNumber), el('td', { class: 'nw' }, String(r.o.date || '').slice(0, 10)), el('td', null, statusName(r.o.statusId)),
      el('td', null, itemsText(r.o.items)),
      el('td', null, r.fits ? el('span', { class: 'ok-txt', title: 'Każda pozycja mieści się w towarze dostępnym w SpeedMail' }, '✓ tak')
        : el('span', { class: 'diffbad', title: 'SpeedMail nie ma dość towaru (po odjęciu rezerwacji zamówień „Złożone SpeedMail”)' }, '✗ brakuje: ' + r.missing.map(x => x.name + ' (' + nf(x.lack) + ' szt.)').join(', '))));
  }) : el('tr', null, el('td', { colspan: '6', class: 'empty' }, rows.length ? 'Brak zamówień pasujących do filtra.' : 'Brak zamówień w statusach kandydatów.')));
  const table = el('div', { class: 'table-wrap' }, el('table', { id: 'smCandTable' },
    el('thead', null, el('tr', null, th('✓', 'Zaznacz zamówienia, które przekazujesz do SpeedMail'), th('Zamówienie', 'Numer zamówienia w Selly'), th('Data'), th('Status', 'Obecny status w Selly'),
      th('Pozycje', 'Produkty zamówienia w sztukach'), th('SM ma towar?', 'Czy samo to zamówienie zmieści się w towarze dostępnym w SpeedMail: stan magazynu SM minus zamówienia już w „Złożone SpeedMail”'))), body));

  const n = S.sel.size;
  const go1 = el('button', { type: 'button', class: 'primary', id: 'smMarkSm', write: STATUS_WRITE, disabled: !n || jobBusy(),
    title: 'Zmienia w Selly status zaznaczonych zamówień na „' + statusName(m.c.st) + '” (porcjami, z podsumowaniem i ponowieniem nieudanych)',
    onclick: () => {
      const ids = [...S.sel], numOf = new Map(rows.map(r => [r.o.orderId, r.o.orderNumber]));
      if (!confirm('Zmienić w Selly status ' + cnt(ids.length, 'zamówienia', 'zamówień', 'zamówień') + ' na „' + statusName(m.c.st) + '”?\n\nZmiana może wysłać klientom powiadomienie, jeśli tak skonfigurowano ten status w Selly.')) return;
      startStatus(ids, m.c.st, 'Przekazanie do SpeedMail', numOf, () => { S.sel.clear(); go('/speedmail/podzial'); });
    } }, 'Oznacz jako „' + statusName(m.c.st) + '”' + (n ? ' (' + n + ')' : ''));
  const sumBox = n ? el('div', { class: 'muted small', id: 'smSelSum', style: 'margin-top:var(--s2)' },
    'Zaznaczono ' + cnt(n, 'zamówienie', 'zamówienia', 'zamówień') + '. Razem: ' + Object.keys(use).map(pid => (rows.find(r => r.names[pid]) || { names: {} }).names[pid] + ' ' + nf(use[pid]) + ' szt. (' + kitsText(pid, use[pid]) + ')').join(', ') + '.') : null;
  box.append(el('div', { class: 'card' },
    el('h3', null, 'Które zamówienia przekazać do SpeedMail?'),
    el('div', { class: 'toolbar', style: 'margin-top:0' }, q, el('label', { title: 'Ukrywa zamówienia, na które SpeedMail nie ma dość towaru' }, of, 'tylko te, które SM zrealizuje'),
      el('span', { class: 'sp' }), pick, none),
    table, sumBox,
    over.length ? notice('warn', 'Zaznaczone zamówienia razem przekraczają towar dostępny w SpeedMail: ' + over.map(pid => (rows.find(r => r.names[pid]) || { names: {} }).names[pid]).join(', ') + '. Część trafi w kroku 2 do realizacji na miejscu.') : null,
    el('div', { class: 'ord-actions' }, go1)));

  // Dostępny towar (zaawansowane)
  const pids = [...new Set(Object.keys(reserved).concat(Object.keys(m.stock).filter(pid => m.stock[pid] > 0)))];
  const nameOf = pid => { const p = S.mag.products.find(x => x.id === pid); return p ? p.name : pid; };
  box.append(el('div', { class: 'card' }, el('details', { class: 'fold', style: 'margin-top:0;border-top:0' },
    el('summary', null, el('span', null, 'Towar dostępny w SpeedMail'), el('span', { class: 'sum' }, ' — stan minus rezerwacje')),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smAvail' },
      el('thead', null, el('tr', null, th('Produkt'), th('Stan SM (szt.)', 'Stan magazynu SpeedMail wg panelu (inwentaryzacja + ruchy)', true),
        th('Zarezerwowane (szt.)', 'Niewydane pozycje zamówień w „Złożone SpeedMail”', true), th('Dostępne (szt.)', 'Stan minus zarezerwowane — tyle zostaje dla nowych zamówień', true),
        th('Dostępne (komplety)', 'Dostępne sztuki ÷ sztuk w komplecie', true))),
      el('tbody', null, pids.length ? pids.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'pl')).map(pid => {
        const a = (m.stock[pid] || 0) - (reserved[pid] || 0);
        return el('tr', null, el('td', null, nameOf(pid)), el('td', { class: 'n' }, nf(m.stock[pid] || 0)), el('td', { class: 'n' }, nf(reserved[pid] || 0)),
          el('td', { class: 'n' }, el('span', { class: a < 0 ? 'diffbad' : null }, nf(a))), el('td', { class: 'n' }, nf(a / L.packOf(packs(), pid).size)));
      }) : el('tr', null, el('td', { colspan: '5', class: 'empty' }, 'Magazyn SpeedMail jest pusty.'))))))));
  return box;
}

// ── Krok 2: sprawdź i podziel ─────────────────────────────────────────────────
function viewSplit(m) {
  const res = m.split, box = el('div');
  if (m.stuck.length) box.append(stuckCard(m));
  if (!res.rows.length) {
    box.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Brak zamówień w statusie „' + statusName(m.c.st) + '” do wysłania. ',
      el('a', { href: '#/speedmail/kandydaci' }, 'Wybierz zamówienia w kroku 1'))));
    return box;
  }
  const prods = productRows(m.smOpen);
  const lacking = prods.filter(p => p.total > (m.stock[p.id] || 0)).length;
  box.append(el('div', { class: 'tabs', style: 'margin-top:var(--s3)' },
    tile(res.send.length, 'do SpeedMail', 'Zamówienia, które w całości mieszczą się w stanie magazynu SpeedMail (lub zostały tam ręcznie przeniesione)', 'smTileSend'),
    tile(res.local.length, 'na miejscu (Złożone OTK)', 'Zamówienia, których SpeedMail nie zrealizuje w całości — realizujesz je u siebie', 'smTileLocal'),
    tile(lacking, 'produktów z brakiem', 'Produkty, których w zamówieniach jest więcej niż w magazynie SpeedMail')));
  const settledN = m.smAll.length - m.smOpen.length - m.stuck.length;
  if (settledN > 0) box.append(el('div', { class: 'muted small', style: 'margin-top:8px' }, 'Pominięto ' + cnt(settledN, 'zamówienie', 'zamówienia', 'zamówień') + ' z już zapisanym wydaniem.'));

  const flip = (r, to) => { if (to === r.auto) S.forced.delete(r.o.orderId); else S.forced.set(r.o.orderId, to); render(); };
  const ordTable = (rows, toSm) => el('div', { class: 'table-wrap' }, el('table', { id: toSm ? 'smSendTable' : 'smLocalTable' },
    el('thead', null, el('tr', null, th('Zamówienie', 'Numer zamówienia w Selly'), th('Data'), th('Pozycje', 'Pozycje zamówienia w sztukach'),
      th(toSm ? 'Uwagi' : 'Powód', toSm ? 'Ostrzeżenie pojawia się, gdy zamówienie przeniesiono do SpeedMail mimo braku towaru' : 'Które produkty nie mieszczą się w stanie SpeedMail'),
      th('Przenieś', 'Ręczne przeniesienie zamówienia do drugiej grupy'))),
    el('tbody', null, rows.length ? rows.map(r => el('tr', { 'data-id': r.o.orderId },
      el('td', null, r.o.orderNumber), el('td', { class: 'nw' }, String(r.o.date || '').slice(0, 10)), el('td', null, itemsText(r.o.items)),
      el('td', null, toSm ? (r.over.length ? el('span', { class: 'diffbad', title: 'SpeedMail nie ma tyle towaru — przeniesiono ręcznie mimo braku' }, '⚠ brak towaru: ' + r.over.map(pid => r.names[pid]).join(', ')) : (r.forced ? 'przeniesiono ręcznie' : ''))
        : (r.forced ? 'przeniesiono ręcznie' : r.missing.map(x => x.name + ' (brakuje ' + nf(x.lack) + ' szt.)').join(', '))),
      el('td', null, el('button', { type: 'button', class: 'secondary', title: toSm ? 'Przenieś to zamówienie do realizacji na miejscu (Złożone OTK)' : 'Przenieś to zamówienie do SpeedMail (nawet gdy brakuje towaru)', onclick: () => flip(r, toSm ? 'otk' : 'sm') }, toSm ? '→ na miejscu' : '→ do SM')))) :
      el('tr', null, el('td', { colspan: '5', class: 'empty' }, 'Brak zamówień w tej grupie.')))));
  box.append(el('div', { class: 'card' }, el('h3', null, 'Wyślij do SpeedMail (' + res.send.length + ')'), ordTable(res.send, true)));
  const nLocal = res.local.length;
  box.append(el('div', { class: 'card' }, el('h3', null, 'Na miejscu — Złożone OTK (' + nLocal + ')'), ordTable(res.local, false),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'primary', id: 'smSetOtk', write: STATUS_WRITE, disabled: !nLocal || !m.c.otk || jobBusy(),
        title: m.c.otk ? 'Zmienia w Selly status tych zamówień na „' + statusName(m.c.otk) + '” — znikną z wysyłki do SpeedMail' : 'Wybierz status „Złożone OTK” w ustawieniach wysyłki',
        onclick: () => {
          if (!confirm('Zmienić w Selly status ' + cnt(nLocal, 'zamówienia', 'zamówień', 'zamówień') + ' na „' + statusName(m.c.otk) + '”? Będą realizowane na miejscu.')) return;
          startStatus(res.local.map(r => r.o.orderId), m.c.otk, 'Realizacja na miejscu', new Map(res.local.map(r => [r.o.orderId, r.o.orderNumber])));
        } }, 'Ustaw w Selly „' + (statusName(m.c.otk) || 'Złożone OTK') + '”' + (nLocal ? ' (' + nLocal + ')' : '')),
      el('button', { type: 'button', class: 'secondary', title: 'Kopiuje numery tych zamówień, po jednym w wierszu', disabled: !nLocal,
        onclick: () => copyToClipboard(res.local.map(r => r.o.orderNumber).join('\n'), null, 'Skopiowano ' + nLocal + ' numerów zamówień') }, 'Kopiuj numery'))));

  box.append(productsCard(m, prods));
  box.append(el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'primary', disabled: !res.send.length, onclick: () => go('/speedmail/plik') }, 'Dalej: plik dla SpeedMail →')));
  return box;
}

function productRows(orders) {
  const prods = new Map();
  for (const o of orders) for (const it of o.items) {
    if (it.settled) continue;
    if (!prods.has(it.productId)) prods.set(it.productId, { id: it.productId, name: it.name, code: it.code || '', total: 0 });
    prods.get(it.productId).total += Number(it.qty) || 0;
  }
  return [...prods.values()];
}

/** Tabela z sortowaniem po kliknięciu w nagłówek (jak w Magazynach). cols: { key, label, tip, num, val(row), cell(row) }. */
function sortTable(cols, rows, sort, id) {
  const c = cols.find(x => x.key === sort.key);
  if (c) rows = rows.slice().sort((a, b) => {
    const x = c.val(a), y = c.val(b), ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    return (c.num ? x - y : String(x).localeCompare(String(y), 'pl')) * sort.dir;
  });
  const head = el('tr', null, cols.map(col => {
    const active = sort.key === col.key;
    return el('th', { class: col.num ? 'n' : null, 'aria-sort': active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: col.tip ? 'tip' : null, title: (col.tip || col.label) + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
        onclick: () => { sort.dir = active ? -sort.dir : (col.num ? -1 : 1); sort.key = col.key; render(); } }, col.label + (active ? (sort.dir > 0 ? ' ↑' : ' ↓') : '')));
  }));
  return el('div', { class: 'table-wrap' }, el('table', { id }, el('thead', null, head),
    el('tbody', null, rows.length ? rows.map(r => el('tr', null, cols.map(col => el('td', { class: col.num ? 'n' : null }, col.cell(r))))) : el('tr', null, el('td', { colspan: String(cols.length), class: 'empty' }, 'Brak produktów.')))));
}

function productsCard(m, prods) {
  const res = m.split, size = pid => L.packOf(packs(), pid).size;
  const cols = [
    { key: 'name', label: 'Produkt', tip: 'Nazwa produktu i jego kod', val: p => p.name, cell: p => [el('div', { class: 'cell-name' }, p.name), p.code ? el('div', { class: 'muted small' }, p.code) : null,
      el('button', { type: 'button', write: 'magazyny', class: 'secondary', style: 'margin-top:4px', title: 'Edytuj przelicznik: ile sztuk jest w komplecie i jak produkt nazywa się w pliku dla SpeedMail',
        onclick: () => { S.editPid = S.editPid === p.id ? '' : p.id; render(); } }, '✎ komplet: ' + size(p.id) + ' szt.')] },
    { key: 'need', label: 'Potrzeba (szt.)', num: true, tip: 'Ile sztuk tego produktu jest w zamówieniach z grupy „Wyślij do SpeedMail”', val: p => res.use[p.id] || 0, cell: p => nf(res.use[p.id] || 0) },
    { key: 'needK', label: 'Potrzeba (komplety)', num: true, tip: 'Sztuki ÷ sztuk w komplecie — tyle kompletów trafia do pliku dla SpeedMail. Wyróżnione, gdy zamówienie nie jest wielokrotnością kompletu', val: p => (res.use[p.id] || 0) / size(p.id),
      cell: p => { const k = (res.use[p.id] || 0) / size(p.id); return Number.isInteger(k) ? nf(k) : el('span', { class: 'diffbad', title: 'Zamówienie nie jest wielokrotnością kompletu (' + size(p.id) + ' szt.) — sprawdź przelicznik' }, nf(k)); } },
    { key: 'stock', label: 'Stan SM (szt.)', num: true, tip: 'Ile sztuk jest w magazynie SpeedMail wg panelu (z inwentaryzacji i ruchów)', val: p => m.stock[p.id] || 0, cell: p => nf(m.stock[p.id] || 0) },
    { key: 'stockK', label: 'Stan SM (komplety)', num: true, tip: 'Stan magazynu SpeedMail w kompletach', val: p => (m.stock[p.id] || 0) / size(p.id), cell: p => nf((m.stock[p.id] || 0) / size(p.id)) },
    { key: 'left', label: 'Zostanie po wysyłce (szt.)', num: true, tip: 'Stan SpeedMail minus potrzeba. Ujemny = brakuje towaru', val: p => (m.stock[p.id] || 0) - (res.use[p.id] || 0),
      cell: p => { const x = (m.stock[p.id] || 0) - (res.use[p.id] || 0); return el('span', { class: x < 0 ? 'diffbad' : null }, nf(x)); } },
  ];
  const card = el('div', { class: 'card' }, el('h3', null, 'Podsumowanie produktów'), sortTable(cols, prods, S.sort, 'smProducts'));
  const ep = S.editPid && prods.find(p => p.id === S.editPid);
  if (ep) {
    const pk = L.packOf(packs(), ep.id);
    const sz = el('input', { type: 'number', min: '1', step: '1', value: String(pk.size), 'aria-label': 'Sztuk w komplecie' });
    const nm = el('input', { type: 'text', value: pk.smName, placeholder: ep.name, 'aria-label': 'Nazwa w pliku dla SpeedMail' });
    const pmsg = el('div');
    const save = el('button', { type: 'button', write: 'magazyny', id: 'smPackSave', onclick: async () => {
      const n = Number(sz.value);
      if (!Number.isInteger(n) || n < 1) { pmsg.replaceChildren(notice('error', 'Liczba sztuk w komplecie musi być całkowita, co najmniej 1.')); return; }
      save.disabled = true;
      try { await api('mag:packs', { packs: [{ productId: ep.id, name: ep.name, size: n, smName: nm.value.trim() }] }); flash('', 'Zapisano przelicznik'); S.editPid = ''; await load(true); }
      catch (e) { pmsg.replaceChildren(notice('error', e.message)); save.disabled = false; }
    } }, 'Zapisz przelicznik');
    card.append(el('div', { class: 'mag-form', id: 'smPackEdit' }, el('strong', null, 'Przelicznik: ' + ep.name),
      el('label', { title: 'Ile sztuk sklepu to jeden komplet w SpeedMail (np. 50 chorągiewek)' }, el('span', { class: 'tip' }, 'Sztuk w komplecie'), sz),
      el('label', { title: 'Nazwa produktu w nagłówku kolumny pliku dla SpeedMail; puste = nazwa ze sklepu' }, el('span', { class: 'tip' }, 'Nazwa w pliku dla SM'), nm), pmsg,
      el('div', { class: 'toolbar', style: 'margin-top:0' }, save, el('button', { type: 'button', class: 'secondary', onclick: () => { S.editPid = ''; render(); } }, 'Anuluj'))));
  }
  return card;
}

// ── Krok 3: plik dla SM ────────────────────────────────────────────────────────
/** Przeliczniki z niezapisanym szkicem układu kolumn (kolejność i nazwy w pliku) — podgląd i pobranie działają przed zapisem. */
function effPacks() {
  const base = packs();
  if (!S.draft) return base;
  const out = {};
  for (const k in base) out[k] = Object.assign({}, base[k]);
  S.draft.order.forEach((pid, i) => { out[pid] = Object.assign({ size: 1, smName: '' }, out[pid], { pos: i + 1, smName: S.draft.names[pid] != null ? S.draft.names[pid] : ((out[pid] || {}).smName || '') }); });
  return out;
}
function refInput(id) {
  if (!S.ref) S.ref = L.nextRef(S.mag.shipments, today());
  const i = el('input', { type: 'text', id, value: S.ref, maxlength: '60', 'aria-label': 'Numer referencyjny wysyłki', title: 'Unikalny numer, który nadajesz wysyłce — po nim zidentyfikujesz paczki w raporcie SpeedMail. Panel proponuje SM-RRRRMMDD-kolejny' });
  i.addEventListener('input', () => { S.ref = i.value; });
  i.addEventListener('change', () => render());
  return i;
}

function viewFile(m) {
  const res = m.split, box = el('div');
  if (!res.send.length) { box.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Brak zamówień do wysłania do SpeedMail — wróć do kroku 2.'))); return box; }
  const o = fileOpts(), ep = effPacks();
  const tbl = L.fileTable(res.send, ep, o, S.ref);
  const setOpt = (k, v) => { store('osa-sm-file', Object.assign(fileOpts(), { [k]: v })); render(); };
  const chk = (k, label, tip, dis) => { const c = el('input', { type: 'checkbox', disabled: !!dis }); c.checked = !!o[k]; c.addEventListener('change', () => setOpt(k, c.checked)); return el('label', { title: tip, style: 'display:block' }, c, label); };
  const seg = el('div', { class: 'seg wrap', role: 'group', 'aria-label': 'Wiersze pliku' },
    el('button', { type: 'button', 'aria-pressed': String(o.rows === 'orders'), title: 'Jeden wiersz na zamówienie, kolumna na produkt', onclick: () => setOpt('rows', 'orders') }, 'Wiersz na zamówienie'),
    el('button', { type: 'button', 'aria-pressed': String(o.rows === 'total'), title: 'Jeden wiersz z sumą kompletów każdego produktu', onclick: () => setOpt('rows', 'total') }, 'Tylko suma'));

  // Podgląd (pierwsze wiersze)
  const prev = tbl.rows.slice(0, 8);
  const preview = el('div', { class: 'table-wrap' }, el('table', { id: 'smFilePreview' },
    el('thead', null, el('tr', null, tbl.columns.map(c => el('th', { class: c.type === 'number' ? 'n' : null, title: c.header }, c.header)))),
    el('tbody', null, prev.map(r => el('tr', null, r.map((v, i) => el('td', { class: tbl.columns[i].type === 'number' ? 'n' : null }, typeof v === 'number' ? nf(v) : (v == null ? '' : String(v)))))))));
  const more = tbl.rows.length - prev.length;

  // Układ kolumn: kolejność i nazwa w pliku (szkic → zapis wspólny dla wszystkich przez mag:packs)
  const prods = L.fileProducts(res.send, ep);
  const move = (i, d) => { const ord = prods.map(p => p.id); const j = i + d; if (j < 0 || j >= ord.length) return; [ord[i], ord[j]] = [ord[j], ord[i]]; S.draft = { order: ord, names: (S.draft && S.draft.names) || {} }; render(); };
  const colRows = prods.map((p, i) => {
    const pk = L.packOf(ep, p.id);
    const inp = el('input', { type: 'text', value: pk.smName, placeholder: p.name, 'aria-label': 'Nazwa w pliku: ' + p.name, maxlength: '200' });
    inp.addEventListener('change', () => { S.draft = { order: prods.map(x => x.id), names: Object.assign({}, S.draft && S.draft.names, { [p.id]: inp.value.trim() }) }; render(); });
    return el('tr', null, el('td', { class: 'n' }, String(i + 1)), el('td', null, p.name, el('div', { class: 'muted small' }, 'komplet: ' + pk.size + ' szt.')), el('td', null, inp),
      el('td', { class: 'nw' }, el('button', { type: 'button', class: 'secondary', title: 'Przesuń kolumnę w lewo (wyżej)', 'aria-label': 'W górę: ' + p.name, disabled: i === 0, onclick: () => move(i, -1) }, '↑'), ' ',
        el('button', { type: 'button', class: 'secondary', title: 'Przesuń kolumnę w prawo (niżej)', 'aria-label': 'W dół: ' + p.name, disabled: i === prods.length - 1, onclick: () => move(i, 1) }, '↓')));
  });
  const cmsg = el('div');
  const saveCols = el('button', { type: 'button', id: 'smColsSave', write: 'magazyny', disabled: !S.draft, title: 'Zapamiętuje kolejność kolumn i nazwy w pliku — wspólne dla wszystkich użytkowników panelu',
    onclick: async () => {
      saveCols.disabled = true;
      const list = prods.map((p, i) => ({ productId: p.id, name: p.name, pos: i + 1, smName: L.packOf(ep, p.id).smName }));
      try { await api('mag:packs', { packs: list }); S.draft = null; flash('', 'Zapisano układ kolumn pliku'); S.mag = await api('mag:init', {}); render(); }
      catch (e) { cmsg.replaceChildren(notice('error', e.message)); saveCols.disabled = false; }
    } }, 'Zapisz układ kolumn');

  box.append(el('div', { class: 'card' },
    el('h3', null, 'Plik dla SpeedMail'),
    el('div', { class: 'muted small' }, 'Liczby w KOMPLETACH (sztuki ÷ sztuk w komplecie). Wysyłka: ' + cnt(res.send.length, 'zamówienie', 'zamówienia', 'zamówień') + '.'),
    el('div', { class: 'mag-form' }, el('label', null, el('span', { class: 'tip', title: 'Unikalny numer wysyłki — wpisz go też w wiadomości do SpeedMail' }, 'Numer referencyjny wysyłki'), refInput('smRef3'))),
    el('div', { class: 'toolbar' }, seg),
    preview, more > 0 ? el('div', { class: 'muted small' }, '… i ' + cnt(more, 'wiersz', 'wiersze', 'wierszy') + ' więcej w pliku.') : null,
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'primary', id: 'smXlsx', title: 'Pobiera tabelę jako plik Excel (.xlsx)', onclick: () => downloadXlsx(tbl, '') }, 'Pobierz plik (.xlsx)'),
      el('button', { type: 'button', class: 'secondary', id: 'smCopy', title: 'Ta sama tabela jako tekst do wklejenia w arkusz lub e-mail', onclick: () => copyToClipboard(tableTsv(tbl), tableHtml(tbl), 'Skopiowano tabelę dla SpeedMail — wklej w arkuszu') }, 'Kopiuj tabelę'),
      el('button', { type: 'button', class: 'secondary', onclick: () => go('/speedmail/zatwierdz') }, 'Dalej: zatwierdź →')),
    el('details', { class: 'fold', id: 'smFileOpts', open: !!S.draft },
      el('summary', null, el('span', null, 'Układ pliku'), el('span', { class: 'sum' }, ' — kolumny, nazwy produktów w SM, kolejność')),
      el('div', { style: 'margin-top:var(--s2)' },
        chk('ref', 'Kolumna „Nr referencyjny”', 'Pierwsza kolumna z numerem referencyjnym wysyłki w każdym wierszu'),
        chk('orderNo', 'Kolumna „Nr zamówienia”', 'Numer zamówienia w każdym wierszu (tylko przy wierszu na zamówienie)', o.rows !== 'orders'),
        chk('date', 'Kolumna „Data”', 'Data zamówienia (tylko przy wierszu na zamówienie)', o.rows !== 'orders'),
        chk('total', 'Wiersz „Razem”', 'Ostatni wiersz z sumą kompletów każdego produktu (tylko przy wierszu na zamówienie)', o.rows !== 'orders'),
        el('p', { class: 'muted small' }, 'Te opcje zapamiętuje ta przeglądarka.')),
      el('h4', { style: 'margin:var(--s3) 0 var(--s1)' }, el('span', { class: 'tip', title: 'Kolejność kolumn produktów i nazwy, pod którymi SpeedMail zna produkty. Zapis jest wspólny dla wszystkich użytkowników.' }, 'Kolumny produktów')),
      el('div', { class: 'table-wrap' }, el('table', { id: 'smCols' },
        el('thead', null, el('tr', null, th('#', 'Kolejność kolumny w pliku', true), th('Produkt', 'Nazwa produktu w sklepie'), th('Nazwa w pliku dla SM', 'Nagłówek kolumny w pliku; puste = nazwa ze sklepu'), th('Kolejność', 'Przesuń kolumnę'))),
        el('tbody', null, colRows))),
      cmsg, el('div', { class: 'ord-actions' }, saveCols, S.draft ? el('button', { type: 'button', class: 'secondary', onclick: () => { S.draft = null; render(); } }, 'Cofnij zmiany') : null,
        S.draft ? el('span', { class: 'muted small' }, 'Niezapisane zmiany układu — podgląd i pobranie już je uwzględniają.') : null))));
  return box;
}

// ── Krok 4: zatwierdzenie ──────────────────────────────────────────────────────
function stuckCard(m) {
  const n = m.stuck.length;
  return el('div', { class: 'card ord-dialog', id: 'smStuck' },
    el('h3', null, 'Wydanie zapisane, status w Selly nadal „' + statusName(m.c.st) + '” (' + n + ')'),
    el('p', { class: 'muted small' }, 'Wysyłka tych zamówień jest zatwierdzona (towar zdjęty ze stanu SM), ale zmiana statusu się nie udała albo została przerwana. Dokończ — wydanie nie zapisze się drugi raz.'),
    el('div', { class: 'smnums muted small' }, m.stuck.map(o => o.orderNumber).join(', ')),
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'primary', id: 'smStuckFix', write: STATUS_WRITE, disabled: !m.c.acc || jobBusy(),
      title: m.c.acc ? 'Zmienia w Selly status tych zamówień na „' + statusName(m.c.acc) + '”' : 'Wybierz status „Przyjęte SpeedMail” w ustawieniach wysyłki',
      onclick: () => startStatus(m.stuck.map(o => o.orderId), m.c.acc, 'Dokończenie wysyłki', new Map(m.stuck.map(o => [o.orderId, o.orderNumber]))) },
    'Ustaw „' + (statusName(m.c.acc) || 'Przyjęte SpeedMail') + '” (' + n + ')')));
}

function viewConfirm(m) {
  const res = m.split, box = el('div');
  if (S.lastShip) box.append(el('div', { class: 'card', id: 'smDone' }, el('h3', null, 'Wysyłka ' + S.lastShip.ref + ' zatwierdzona'),
    el('p', null, S.lastShip.already ? 'Wydanie tej wysyłki było już zapisane — nie zapisano go drugi raz.' : 'Zapisano wydanie z magazynu SpeedMail: ' + cnt(S.lastShip.saved, 'pozycja', 'pozycje', 'pozycji') + '.'),
    el('div', { class: 'muted small smnums' }, 'Zamówienia: ' + S.lastShip.numbers.join(', '))));
  if (m.stuck.length) box.append(stuckCard(m));
  if (!res.send.length) { box.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Brak zamówień do zatwierdzenia.'))); return box; }
  const ep = packs(), prods = L.fileProducts(res.send, ep);
  const canStatus = canWriteSection('zamowienia') || canWriteSection('przesylki');
  const msg = el('div');
  if (S.shipErr) msg.append(notice('error', S.shipErr));
  const btn = el('button', { type: 'button', class: 'primary', id: 'smConfirm', write: 'magazyny', disabled: jobBusy(),
    title: 'Zapisuje wydanie towaru z magazynu SpeedMail dla zamówień z grupy „Wyślij do SpeedMail”, potem zmienia ich status w Selly na „' + statusName(m.c.acc) + '”',
    onclick: () => confirmShipment(m) }, S.busy ? 'Zapisuję…' : 'Zatwierdź wysyłkę (' + res.send.length + ')');
  box.append(el('div', { class: 'card' },
    el('h3', null, 'Zatwierdź wysyłkę do SpeedMail'),
    el('ol', { class: 'muted small' },
      el('li', null, 'Panel zapisze wydanie z magazynu „' + whName(m.c.wh) + '” — stan SpeedMail zmniejszy się o wysłane komplety.'),
      el('li', null, m.c.acc ? 'Potem zmieni w Selly status zamówień na „' + statusName(m.c.acc) + '”.' : 'Status w Selly: wybierz „Przyjęte SpeedMail” w ustawieniach, inaczej zmienisz go później.')),
    el('div', { class: 'mag-form' }, el('label', null, el('span', { class: 'tip', title: 'Unikalny numer wysyłki — ten sam co w pliku dla SpeedMail' }, 'Numer referencyjny wysyłki'), refInput('smRef'))),
    el('div', { class: 'table-wrap', style: 'margin-top:var(--s3)' }, el('table', { id: 'smConfirmTable' },
      el('thead', null, el('tr', null, th('Produkt'), th('Sztuk', 'Sztuki ze wszystkich zamówień wysyłki', true), th('Kompletów', 'Tyle kompletów SpeedMail wyda z magazynu', true), th('Zostanie w SM (szt.)', 'Stan SpeedMail po wysyłce', true))),
      el('tbody', null, prods.map(p => { const q = res.use[p.id] || 0, left = (m.stock[p.id] || 0) - q;
        return el('tr', null, el('td', null, p.name), el('td', { class: 'n' }, nf(q)), el('td', { class: 'n' }, nf(q / L.packOf(ep, p.id).size)), el('td', { class: 'n' }, el('span', { class: left < 0 ? 'diffbad' : null }, nf(left)))); })))),
    res.send.some(r => r.over.length) ? notice('warn', 'Część zamówień przeniesiono do SpeedMail mimo braku towaru — stan SM zejdzie poniżej zera.') : null,
    res.local.length ? notice('warn', cnt(res.local.length, 'zamówienie', 'zamówienia', 'zamówień') + ' z grupy „na miejscu” nadal ma status „' + statusName(m.c.st) + '”. ',
      el('a', { href: '#/speedmail/podzial' }, 'Ustaw „Złożone OTK” w kroku 2')) : null,
    !canStatus ? notice('warn', 'Nie masz prawa zmiany statusów zamówień — wydanie zapiszesz, status w Selly zmieni osoba z dostępem do „Zamówień”.') : null,
    msg, el('div', { class: 'ord-actions' }, btn)));
  return box;
}

async function confirmShipment(m) {
  const res = m.split, ref = S.ref.trim();
  S.shipErr = '';
  if (!ref) { S.shipErr = 'Wpisz numer referencyjny wysyłki.'; render(); return; }
  if (!confirm('Zatwierdzić wysyłkę ' + ref + ' (' + cnt(res.send.length, 'zamówienie', 'zamówienia', 'zamówień') + ')?\n\n1) Zapis wydania z magazynu „' + whName(m.c.wh) + '”\n2) Status w Selly: „' + statusName(m.c.acc) + '”')) return;
  const send = res.send.map(r => r.o);
  const items = send.flatMap(o => o.items.filter(i => !i.settled).map(i => ({ orderId: o.orderId, orderNumber: o.orderNumber, productOrderId: i.productOrderId, productId: i.productId, name: i.name, qty: i.qty })));
  S.busy = true; render();
  let out;
  try { out = await api('mag:confirm', { ref, whId: m.c.wh, orderIds: send.map(o => o.orderId), items }); }
  catch (e) { S.busy = false; S.shipErr = e.message || 'Nie udało się zapisać wydania.'; render(); return; }
  S.busy = false;
  S.lastShip = { ref: out.ref || ref, already: !!out.already, saved: out.saved || 0, numbers: send.map(o => o.orderNumber) };
  flash('', out.already ? 'Wysyłka ' + ref + ' była już zapisana' : 'Zapisano wydanie z magazynu SpeedMail (' + ref + ')');
  // Wydanie zapisane: te zamówienia mają pozycje „settled” — nawet przy błędzie statusu nie wrócą do podziału (zostaną w „Dokończ”)
  for (const o of send) for (const i of o.items) i.settled = true;
  S.forced.clear(); S.ref = '';
  try { S.mag = await api('mag:init', {}); } catch (e) { /* historia odświeży się przy następnym wejściu */ }
  if (m.c.acc) startStatus(send.map(o => o.orderId), m.c.acc, 'Wysyłka ' + S.lastShip.ref, new Map(send.map(o => [o.orderId, o.orderNumber])));
  else render();
}

// ── Historia wysyłek + przyjęcie dostawy do SM ────────────────────────────────
function viewHistory(m) {
  const list = S.mag.shipments || [], box = el('div');
  const ep = packs();
  const rows = list.map(s => {
    const k = L.shipmentKits(s, ep);
    return el('tr', null, el('td', null, el('strong', null, s.ref)), el('td', { class: 'nw' }, s.time || ''), el('td', { class: 'n' }, String(s.orders)),
      el('td', { class: 'n', title: k.per.map(p => p.name + ': ' + nf(p.kits) + ' kpl. (' + nf(p.qty) + ' szt.)').join('\n') }, nf(k.total)),
      el('td', null, el('details', null, el('summary', { title: 'Pokaż produkty i numery zamówień' }, cnt(k.per.length, 'produkt', 'produkty', 'produktów')),
        el('ul', { class: 'small' }, k.per.map(p => el('li', null, p.name + ': ' + nf(p.kits) + ' kpl. (' + nf(p.qty) + ' szt.)'))),
        el('div', { class: 'muted small smnums' }, 'Zamówienia: ' + (s.numbers || []).join(', ')))),
      el('td', null, s.author || '—'));
  });
  box.append(el('div', { class: 'card' }, el('h3', null, 'Historia wysyłek do SpeedMail'),
    el('div', { class: 'muted small' }, 'Z zapisanych wydań z numerem referencyjnym; najnowsze pierwsze (do 100).'),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smHistory' },
      el('thead', null, el('tr', null, th('Nr referencyjny', 'Numer nadany wysyłce przy zatwierdzeniu'), th('Data', 'Kiedy zatwierdzono wysyłkę'), th('Zamówień', 'Liczba zamówień w wysyłce', true),
        th('Komplety', 'Suma kompletów wszystkich produktów (najedź, aby zobaczyć podział)', true), th('Szczegóły'), th('Kto', 'Kto zatwierdził wysyłkę'))),
      el('tbody', null, rows.length ? rows : el('tr', null, el('td', { colspan: '6', class: 'empty' }, 'Nie zatwierdzono jeszcze żadnej wysyłki.')))))));
  box.append(importCard(m));
  return box;
}

/** Przyjęcie dostawy do magazynu SM: wklejone z Excela wiersze „kod / nazwa / nazwa w SM [Tab] ilość” → ruchy „przyjęcie”. */
function importCard(m) {
  const imp = S.imp, ps = S.mag.products, ep = packs();
  const ta = el('textarea', { rows: '5', style: 'width:100%', id: 'smImpText', placeholder: 'kod, nazwa albo nazwa w SM [Tab] ilość — po jednym produkcie w wierszu', 'aria-label': 'Wklej z Excela' }, imp.text);
  const unit = el('div', { class: 'seg', role: 'group', 'aria-label': 'Jednostka ilości' },
    el('button', { type: 'button', 'aria-pressed': String(imp.unit === 'kits'), title: 'Ilości w pliku to komplety — panel przeliczy na sztuki wg przelicznika', onclick: () => { imp.text = ta.value; imp.unit = 'kits'; imp.rows = null; render(); } }, 'komplety'),
    el('button', { type: 'button', 'aria-pressed': String(imp.unit === 'pcs'), title: 'Ilości w pliku to sztuki', onclick: () => { imp.text = ta.value; imp.unit = 'pcs'; imp.rows = null; render(); } }, 'sztuki'));
  const parse = () => {
    imp.text = ta.value; const out = [];
    for (const line of imp.text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const cells = line.split('\t').map(s => s.trim()).filter(Boolean);
      let key, qty;
      if (cells.length >= 2) { key = cells[0]; qty = cells[cells.length - 1]; } else { const mm = line.trim().match(/^(.*\S)\s+(-?[\d.,]+)$/); if (mm) { key = mm[1]; qty = mm[2]; } }
      const n = qty == null ? NaN : Number(String(qty).replace(/\s/g, '').replace(',', '.')), k = norm(key || '');
      const p = k && (ps.find(x => x.code && norm(x.code) === k) || ps.find(x => norm(x.name) === k) || ps.find(x => norm(L.packOf(ep, x.id).smName) === k));
      out.push({ line: line.trim().slice(0, 120), p, n, pcs: p && isFinite(n) && n > 0 ? n * (imp.unit === 'kits' ? L.packOf(ep, p.id).size : 1) : null });
    }
    imp.rows = out; render();
  };
  const ok = (imp.rows || []).filter(r => r.pcs), bad = (imp.rows || []).filter(r => !r.pcs);
  const msg = el('div');
  const save = el('button', { type: 'button', class: 'primary', id: 'smImpSave', write: 'magazyny', disabled: !ok.length || !m.c.wh, title: 'Zapisuje przyjęcie towaru do magazynu „' + whName(m.c.wh) + '”',
    onclick: async () => {
      if (!confirm('Zapisać przyjęcie ' + cnt(ok.length, 'produktu', 'produktów', 'produktów') + ' do magazynu „' + whName(m.c.wh) + '”?')) return;
      save.disabled = true;
      try {
        const r = await api('mag:moves', { moves: ok.map(x => ({ type: 'przyjecie', productId: x.p.id, productName: x.p.name, qty: x.pcs, from: '', to: m.c.wh, orderId: '', productOrderId: '', note: 'Dostawa do SpeedMail' })) });
        flash('', 'Zapisano przyjęcie: ' + r.saved); S.imp = { text: '', unit: imp.unit, rows: null }; await load(true);
      } catch (e) { msg.replaceChildren(notice('error', e.message)); save.disabled = false; }
    } }, 'Zapisz przyjęcie' + (ok.length ? ' (' + ok.length + ')' : ''));
  return el('div', { class: 'card' }, el('details', { class: 'fold', id: 'smImport', style: 'margin-top:0;border-top:0', open: !!imp.rows },
    el('summary', null, el('span', null, 'Przyjęcie dostawy do SpeedMail'), el('span', { class: 'sum' }, ' — wklej listę towaru wysłanego do SM')),
    el('p', { class: 'muted small' }, 'Dwie kolumny z Excela: produkt (kod, nazwa w sklepie albo nazwa w pliku SM) i ilość. Zwiększa stan magazynu „' + (whName(m.c.wh) || 'SpeedMail') + '”.'),
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('span', { class: 'tip', title: 'W jakiej jednostce są ilości we wklejonej liście' }, 'Ilości w:'), unit), ta,
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'smImpParse', onclick: parse }, 'Sprawdź wklejone')),
    imp.rows ? el('div', { id: 'smImpResult' },
      ok.length ? el('ul', { class: 'small' }, ok.map(r => el('li', null, r.p.name + ': +' + nf(r.pcs) + ' szt.' + (imp.unit === 'kits' ? ' (' + nf(r.n) + ' kpl.)' : '')))) : null,
      bad.length ? notice('warn', el('div', null, 'Nie dopasowano wierszy: ' + bad.length), el('ul', null, bad.map(r => el('li', null, r.line)))) : null) : null,
    msg, el('div', { class: 'ord-actions' }, save)));
}

// ─── Moduł ─────────────────────────────────────────────────────────────────
let root = null;
export default {
  id: 'speedmail',
  title: 'Wysyłka SpeedMail',
  routes: STEPS.map(s => s[0]),
  mount(host, params) {
    if (!root) { root = host; host.replaceChildren(el('div', { id: 'modSm' }, el('nav', { class: 'viewnav', id: 'smNav', 'aria-label': 'Kroki wysyłki SpeedMail' }), el('div', { id: 'smBody' }))); }
    const v = params && params.view;
    if (!VIEW_KEYS.has(v)) { go('/speedmail/' + S.view, { replace: true }); return; }
    S.view = v;
    if (!S.mag && !S.loading) load(true); else render();
  },
  unmount() { /* stan zostaje — kontener jest tylko ukrywany */ },
};
