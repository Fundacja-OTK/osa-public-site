// Moduł „Zamówienia”: lista z filtrami i akcjami masowymi (#/zamowienia?status=..&q=..&page=..) oraz szczegóły (#/zamowienia/<id>).
// Dane i zapisy: backend Cloudflare (akcje orders:meta, orders:list, orders:get, orders:setStatus).
import { el, plural, debounce, store, flash, progressToast, norm, menuButton, downloadXlsx, downloadCsv, tableMatrix, copyToClipboard } from '../core/ui.js';
import { api, ctx } from '../core/client.js';
import { go } from '../core/router.js';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const SORTS = ['date', 'number', 'status', 'total'];
const SIZES = [25, 50, 100, 200];
// Eksport czyta z bazy panelu (nie z Selly — nie zużywa limitu API); górna granica tylko jako bezpiecznik
const EXPORT_MAX = 50000;
const MSG_UNAVAILABLE = 'Moduł Zamówienia wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = {
  root: null, metaBox: null, listBox: null, detailBox: null, ui: {},
  meta: null, metaErr: null, metaLoading: false,
  Q: null, data: null, loading: false, err: '',
  sel: new Map(),            // id → wiersz listy (zaznaczenie zostaje przy zmianie filtrów i stron)
  listHash: '#/zamowienia',  // ostatni adres listy (powrót ze szczegółów)
  seq: 0, routeSeq: 0,
};

// ─── Pomocnicze ─────────────────────────────────────────────────────────────

const adminUrl = () => (S.meta && S.meta.adminUrl) || (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const money = v => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dateStr = d => (d ? String(d).replace('T', ' ').slice(0, 16) : '');
const dayStr = d => (d ? String(d).slice(0, 10) : '');
const fullName = (a, b) => [a, b].filter(Boolean).join(' ').trim();
const statusName = id => { const s = S.meta && S.meta.statuses.find(x => String(x.id) === String(id)); return s ? s.name : (id == null || id === '' ? '—' : 'Status ' + id); };
const cnt = (n, one, few, many) => n + ' ' + plural(n, one, few, many);
const isUnavailable = e => e && (e.code === 501 || /nieznana akcja|unknown action/i.test(e.message || ''));
const sellyOrderUrl = id => adminUrl() + '?a=zamowienia.view&id=' + encodeURIComponent(id);

function statusTone(name) {
  const n = norm(name);
  if (/anul|zwrot|odrzuc/.test(n)) return 'bad';
  if (/nieoplac|zlozon|oczek|nowe|nowy/.test(n)) return 'warn';
  if (/zrealiz|wyslan|dostarcz|odebran|zakoncz/.test(n)) return 'ok';
  if (/oplac|realizacj|przygot|pakow/.test(n)) return 'acc';
  return 'neutral';
}
const statusPill = (id, name) => { const nm = name || statusName(id); return el('span', { class: 'ord-st ' + statusTone(nm), title: 'Status zamówienia: ' + nm }, nm); };

function loadingBox(text) {
  return el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), text),
    el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' }));
}
const sellyLink = (text, url, tip) => el('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn-link', title: tip }, text);

function unavailableBox(extra) {
  return el('div', { class: 'card' }, el('div', { class: 'empty error' },
    el('p', null, el('strong', null, extra || MSG_UNAVAILABLE)),
    el('p', null, sellyLink('Otwórz zamówienia w panelu Selly ↗', adminUrl() + '?a=zamowienia', 'Otwiera listę zamówień w panelu administracyjnym Selly w nowej karcie')),
    el('p', null, el('button', { type: 'button', class: 'secondary', onclick: () => { S.meta = null; mountRoute(); } }, 'Spróbuj ponownie'))));
}

// ─── Stan filtrów ↔ adres ───────────────────────────────────────────────────

function readQ(query) {
  const g = k => (query && query.get(k)) || '';
  const sort = SORTS.includes(g('sort')) ? g('sort') : 'date';
  return {
    status: g('status'), q: g('q'), from: g('from'), to: g('to'),
    page: Math.max(1, parseInt(g('page'), 10) || 1), sort, dir: g('dir') === 'asc' ? 'asc' : g('dir') === 'desc' ? 'desc' : (sort === 'date' || sort === 'total' ? 'desc' : 'asc'),
  };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  if (Q.status) p.set('status', Q.status);
  if (Q.q) p.set('q', Q.q);
  if (Q.from) p.set('from', Q.from);
  if (Q.to) p.set('to', Q.to);
  if (Q.page > 1) p.set('page', String(Q.page));
  if (Q.sort !== 'date' || Q.dir !== 'desc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  return s ? '?' + s : '';
}
const pageSize = () => { const v = store('osa-ord-size'); return SIZES.includes(v) ? v : 50; };
const listParams = (Q, extra) => {
  const p = { sort: Q.sort, dir: Q.dir, pageSize: pageSize(), page: Q.page };
  if (Q.status) p.statusIds = Q.status.split(',').filter(Boolean);
  if (Q.q) p.q = Q.q;
  if (Q.from) p.dateFrom = Q.from;
  if (Q.to) p.dateTo = Q.to;
  return Object.assign(p, extra);
};

/** Zmiana filtrów: nowy adres (cofnięcie przeglądarki wraca do poprzedniego widoku); replace — bez wpisu w historii (pisanie w wyszukiwarce). */
function setQ(patch, replace) {
  const n = Object.assign({}, S.Q, patch);
  if (!('page' in patch)) n.page = 1;
  const h = '/zamowienia' + qsOf(n);
  const same = location.hash === '#' + h;
  if (replace) go(h, { replace: true });
  else if (same) { S.Q = n; loadList(); } else go(h);
}

// ─── Meta ───────────────────────────────────────────────────────────────────

async function ensureMeta() {
  if (S.meta) return true;
  if (S.metaLoading) return false;
  S.metaLoading = true; S.metaErr = null;
  try { S.meta = await api('orders:meta'); } catch (e) { S.metaErr = e; }
  S.metaLoading = false;
  return !!S.meta;
}
const countOf = id => { const c = S.meta.counts.find(x => String(x.id) === String(id)); return c ? Number(c.n) || 0 : 0; };

// ─── Lista: budowa ──────────────────────────────────────────────────────────

function buildList() {
  const u = S.ui;
  u.search = el('input', { type: 'search', id: 'ordSearch', placeholder: 'Szukaj: numer, e-mail, telefon, nazwisko, firma, miasto, nr przesyłki', 'aria-label': 'Szukaj zamówień',
    title: 'Szuka w numerze zamówienia, e-mailu, telefonie, imieniu i nazwisku (faktura i wysyłka), firmie, mieście i numerze przesyłki',
    oninput: debounce(() => { const v = u.search.value.trim(); if (v !== S.Q.q) setQ({ q: v }, true); }, 350) });
  u.from = el('input', { type: 'date', id: 'ordFrom', 'aria-label': 'Data od', title: 'Zamówienia złożone od tego dnia (włącznie)', onchange: () => setQ({ from: u.from.value }) });
  u.to = el('input', { type: 'date', id: 'ordTo', 'aria-label': 'Data do', title: 'Zamówienia złożone do tego dnia (włącznie)', onchange: () => setQ({ to: u.to.value }) });
  u.size = el('select', { id: 'ordSize', 'aria-label': 'Wierszy na stronie', title: 'Ile zamówień pokazać na jednej stronie listy',
    onchange: () => { store('osa-ord-size', Number(u.size.value)); setQ({}); } },
    SIZES.map(n => el('option', { value: String(n) }, String(n))));
  u.filtersBtn = el('button', { type: 'button', class: 'secondary', id: 'ordFiltersBtn', 'aria-expanded': 'false', 'aria-controls': 'ordFilters',
    title: 'Dodatkowe filtry: zakres dat i liczba wierszy na stronie', onclick: () => toggleFilters() }, 'Filtry ▾');
  u.filters = el('div', { class: 'opts-box ord-filters', id: 'ordFilters', hidden: true },
    el('div', { class: 'ord-filter-row' },
      el('label', { class: 'field-inline' }, 'Od dnia', u.from),
      el('label', { class: 'field-inline' }, 'Do dnia', u.to),
      el('label', { class: 'field-inline' }, 'Wierszy na stronie', u.size),
      el('button', { type: 'button', class: 'ghost', id: 'ordClear', title: 'Usuń wyszukiwanie, zakres dat i wybrany status', onclick: () => setQ({ status: '', q: '', from: '', to: '' }) }, 'Wyczyść filtry')));
  u.segs = el('div', { class: 'ord-segs', role: 'group', 'aria-label': 'Status zamówienia' });
  u.exportBtn = menuButton({ id: 'ordExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz zamówienia z tabeli do pliku Excel lub CSV — zaznaczone albo cały wynik filtra', items: exportItems });
  u.info = el('div', { class: 'muted small ord-info' });
  u.dlg = el('div', { id: 'ordDlg' });
  u.bulk = el('div', { class: 'ord-bulk', id: 'ordBulk', hidden: true });
  u.results = el('div', { id: 'ordResults' });
  S.listBox = el('div', { class: 'ord-list' },
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Zamówienia'), el('div', { class: 'sub' }, 'Lista zamówień ze sklepu (kopia odświeżana co minutę). Kliknij zamówienie, aby zobaczyć szczegóły.')),
      u.segs,
      el('div', { class: 'toolbar' }, u.search, u.filtersBtn, u.exportBtn, el('span', { class: 'spacer' }), u.info),
      u.filters, u.dlg, u.bulk, u.results));
  S.root.append(S.listBox);
}

function toggleFilters(force) {
  const u = S.ui, open = force != null ? force : u.filters.hidden;
  u.filters.hidden = !open;
  u.filtersBtn.setAttribute('aria-expanded', String(open));
  u.filtersBtn.textContent = open ? 'Filtry ▴' : 'Filtry ▾';
}

function syncList() {
  const u = S.ui, Q = S.Q;
  if (u.search.value.trim() !== Q.q) u.search.value = Q.q;
  u.from.value = Q.from; u.to.value = Q.to; u.size.value = String(pageSize());
  const extra = !!(Q.from || Q.to) || pageSize() !== 50;
  u.filtersBtn.classList.toggle('on', extra);
  if (extra && u.filters.hidden) toggleFilters(true);
  renderSegs();
}

function renderSegs() {
  const u = S.ui, Q = S.Q, M = S.meta;
  const withN = M.statuses.map(s => ({ ...s, n: countOf(s.id) }));
  const total = withN.reduce((a, s) => a + s.n, 0);
  const top = withN.filter(s => s.n > 0).sort((a, b) => b.n - a.n).slice(0, 5);
  if (Q.status && !Q.status.includes(',') && !top.some(s => String(s.id) === Q.status)) { const c = withN.find(s => String(s.id) === Q.status); if (c) top.push(c); }
  top.sort((a, b) => a.position - b.position);
  const rest = withN.filter(s => !top.includes(s) && s.n > 0);
  const chip = (label, n, active, tip, onclick, id) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(active), title: tip, id, onclick },
    label, el('span', { class: 'ord-n' }, String(n)));
  const parts = [chip('Wszystkie', total, !Q.status, 'Wszystkie zamówienia, w każdym statusie: ' + total + ' (liczba z ostatniej synchronizacji, niezależna od wyszukiwania i dat)', () => setQ({ status: '' }), 'ordSegAll')];
  for (const s of top) parts.push(chip(s.name, s.n, Q.status === String(s.id), 'Zamówienia w statusie „' + s.name + '”: ' + s.n + ' (liczba z ostatniej synchronizacji, niezależna od wyszukiwania i dat)', () => setQ({ status: String(s.id) }), 'ordSeg' + s.id));
  if (rest.length) {
    parts.push(menuButton({ id: 'ordSegMore', label: 'Pozostałe statusy', cls: 'secondary', title: 'Pozostałe, rzadziej używane statusy z liczbą zamówień',
      items: () => rest.map(s => ({ label: s.name, count: s.n, title: 'Pokaż zamówienia w statusie „' + s.name + '”', run: () => setQ({ status: String(s.id) }) })) }));
  }
  u.segs.replaceChildren(...parts);
}

// ─── Lista: dane ────────────────────────────────────────────────────────────

async function loadList() {
  const my = ++S.seq, u = S.ui;
  S.loading = true; S.err = '';
  syncList();
  if (!S.data) u.results.replaceChildren(loadingBox('Pobieram zamówienia…'));
  else u.results.classList.add('fade');
  try {
    const r = await api('orders:list', listParams(S.Q));
    if (my !== S.seq) return;
    S.data = r;
    // strona poza zakresem (np. po zawężeniu filtra) → ostatnia strona
    const pages = Math.max(1, Math.ceil((r.total || 0) / (r.pageSize || 50)));
    if (S.Q.page > pages && r.total > 0) { setQ({ page: pages }, true); return; }
  } catch (e) {
    if (my !== S.seq) return;
    S.err = isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać zamówień.');
  }
  S.loading = false;
  u.results.classList.remove('fade');
  renderList();
}

const COLS = [
  { key: 'number', label: 'Nr', sort: 'number', tip: 'Numer zamówienia' },
  { key: 'date', label: 'Data', sort: 'date', tip: 'Data i godzina złożenia zamówienia' },
  { key: 'client', label: 'Klient', tip: 'Nazwisko klienta (z faktury) i firma. Najedź na nazwisko, aby zobaczyć e-mail i telefon.', tipHeader: true },
  { key: 'city', label: 'Miasto', tip: 'Miasto z danych zamówienia' },
  { key: 'status', label: 'Status', sort: 'status', tip: 'Aktualny status zamówienia w Selly' },
  { key: 'delivery', label: 'Dostawa', tip: 'Wybrany sposób dostawy' },
  { key: 'total', label: 'Wartość (zł)', sort: 'total', num: true, tip: 'Wartość zamówienia z dostawą, w złotych', tipHeader: true },
  { key: 'items', label: 'Pozycji', num: true, tip: 'Liczba pozycji (linii produktowych) w zamówieniu', tipHeader: true },
];

function renderList() {
  const u = S.ui, d = S.data, Q = S.Q;
  if (S.err && !d) {
    u.info.textContent = '';
    u.results.replaceChildren(el('div', { class: 'empty error' }, S.err, ' ', sellyLink('Panel Selly ↗', adminUrl() + '?a=zamowienia', 'Otwiera listę zamówień w panelu Selly w nowej karcie'),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => loadList() }, 'Spróbuj ponownie'))));
    renderBulk();
    return;
  }
  const size = d.pageSize || pageSize(), pages = Math.max(1, Math.ceil(d.total / size));
  const synced = d.syncedMs ? new Date(d.syncedMs).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  u.info.replaceChildren(el('span', { class: 'tip', title: 'Lista pochodzi z kopii zamówień, którą panel synchronizuje z Selly co minutę — najświeższe zmiany mogą pojawić się z opóźnieniem do ok. minuty.' }, 'dane z: ' + synced));
  const head = el('tr', null,
    el('th', { class: 'c' }, el('input', { type: 'checkbox', id: 'ordSelAll', 'aria-label': 'Zaznacz wszystkie na tej stronie', title: 'Zaznacz lub odznacz wszystkie zamówienia na tej stronie',
      onchange: ev => { for (const r of d.rows) { if (ev.target.checked) S.sel.set(r.id, r); else S.sel.delete(r.id); } refreshSel(); } })),
    COLS.map(c => {
      const cls = c.num ? 'n' : null;
      if (!c.sort) return el('th', { class: cls }, el('span', { title: c.tip, class: c.tipHeader ? 'tip' : null }, c.label));
      const active = Q.sort === c.sort;
      return el('th', { class: cls, 'aria-sort': active ? (Q.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        el('button', { type: 'button', class: c.tipHeader ? 'tip' : null, title: c.tip + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
          onclick: () => setQ({ sort: c.sort, dir: active ? (Q.dir === 'asc' ? 'desc' : 'asc') : (c.num || c.sort === 'date' ? 'desc' : 'asc') }) },
          c.label + (active ? (Q.dir === 'asc' ? ' ↑' : ' ↓') : '')));
    }));
  const body = el('tbody');
  for (const r of d.rows) {
    const name = fullName(r.firstName, r.lastName) || r.company || r.email || '—';
    const contact = [r.email, r.phone].filter(Boolean).join('\n');
    const tr = el('tr', { class: 'pick' + (S.sel.has(r.id) ? ' sel' : ''), 'data-id': r.id, onclick: ev => { if (ev.target.closest('input,a,button')) return; openOrder(r.id); } },
      el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Zaznacz zamówienie ' + r.number, checked: S.sel.has(r.id), onchange: ev => { if (ev.target.checked) S.sel.set(r.id, r); else S.sel.delete(r.id); refreshSel(); } })),
      el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(r.id), class: 'cell-name', onclick: () => { S.listHash = location.hash; } }, r.number || r.id)),
      el('td', { class: 'nw' }, dateStr(r.date)),
      el('td', { title: contact || null }, el('div', { class: 'cell-name' }, name), r.company && fullName(r.firstName, r.lastName) ? el('div', { class: 'cell-sub' }, r.company) : null,
        r.attention || r.comment ? el('span', { class: 'ord-flag', title: 'Zamówienie ma komentarz klienta lub uwagę — zobacz w szczegółach' }, '!') : null),
      el('td', null, r.city || ''),
      el('td', null, statusPill(r.statusId)),
      el('td', null, r.delivery || ''),
      el('td', { class: 'n nw' }, money(r.total)),
      el('td', { class: 'n' }, String(r.itemCount == null ? '' : r.itemCount)));
    body.append(tr);
  }
  const filtered = !!(Q.status || Q.q || Q.from || Q.to);
  if (!d.rows.length) body.append(el('tr', null, el('td', { colspan: '9', class: 'empty' },
    filtered ? 'Brak zamówień pasujących do wybranych filtrów.' : 'Brak zamówień.', ' ',
    filtered ? el('button', { type: 'button', class: 'secondary', onclick: () => setQ({ status: '', q: '', from: '', to: '' }) }, 'Wyczyść filtry') : null)));
  const pager = el('div', { class: 'ord-pager' },
    el('button', { type: 'button', class: 'secondary', id: 'ordPrev', disabled: Q.page <= 1, title: Q.page <= 1 ? 'To pierwsza strona' : 'Poprzednia strona', onclick: () => setQ({ page: Q.page - 1 }) }, '← Poprzednia'),
    el('span', { class: 'muted' }, 'Strona ' + Math.min(Q.page, pages) + ' z ' + pages + ' · ' + cnt(d.total, 'zamówienie', 'zamówienia', 'zamówień')),
    el('button', { type: 'button', class: 'secondary', id: 'ordNext', disabled: Q.page >= pages, title: Q.page >= pages ? 'To ostatnia strona' : 'Następna strona', onclick: () => setQ({ page: Q.page + 1 }) }, 'Następna →'));
  u.results.replaceChildren(
    S.err ? el('div', { class: 'notice error' }, S.err) : null,
    el('div', { class: 'table-wrap' }, el('table', { id: 'ordTable' }, el('thead', null, head), body)), pager);
  renderBulk();
  refreshSel();
}

function openOrder(id) { S.listHash = location.hash; go('/zamowienia/' + encodeURIComponent(id)); }

// ─── Zaznaczenie i akcje masowe ─────────────────────────────────────────────

function refreshSel() {
  const u = S.ui, d = S.data;
  if (d) {
    for (const tr of u.results.querySelectorAll('tbody tr[data-id]')) {
      const on = S.sel.has(tr.dataset.id);
      tr.classList.toggle('sel', on);
      const cb = tr.querySelector('input[type=checkbox]'); if (cb) cb.checked = on;
    }
    const all = u.results.querySelector('#ordSelAll');
    if (all) { const n = d.rows.filter(r => S.sel.has(r.id)).length; all.checked = d.rows.length > 0 && n === d.rows.length; all.indeterminate = n > 0 && n < d.rows.length; }
  }
  renderBulk();
}

function renderBulk() {
  const u = S.ui, n = S.sel.size;
  u.bulk.hidden = n === 0;
  if (!n) { u.bulk.replaceChildren(); return; }
  const rows = [...S.sel.values()];
  u.bulk.replaceChildren(
    el('strong', { id: 'ordSelCount' }, 'Zaznaczono: ' + n),
    menuButton({ id: 'ordStatusMenu', label: 'Zmień status', cls: 'primary', title: 'Ustaw wybrany status dla wszystkich zaznaczonych zamówień (przed zmianą pokażemy podsumowanie do potwierdzenia)',
      items: () => S.meta.statuses.map(s => ({ label: s.name, title: 'Ustaw status „' + s.name + '” dla zaznaczonych zamówień', run: () => startStatusChange(u.dlg, rows, String(s.id), onStatusDone) })) }),
    el('button', { type: 'button', class: 'secondary', id: 'ordCopyNums', title: 'Kopiuje numery zaznaczonych zamówień, po jednym w wierszu',
      onclick: () => copyToClipboard(rows.map(r => r.number).join('\n'), null, 'Skopiowano ' + cnt(n, 'numer', 'numery', 'numerów'), '') }, 'Kopiuj numery'),
    el('button', { type: 'button', class: 'ghost', id: 'ordSelClear', title: 'Odznacz wszystkie zaznaczone zamówienia (na wszystkich stronach)', onclick: () => { S.sel.clear(); refreshSel(); } }, 'Wyczyść zaznaczenie'));
}

function onStatusDone(doneIds) {
  for (const id of doneIds) S.sel.delete(id);
  api('orders:meta').then(m => { S.meta = m; if (S.listBox && !S.listBox.hidden) renderSegs(); }).catch(() => {});
  loadList();
}

// ─── Zmiana statusu (1 lub wiele zamówień; porcje + postęp + ponowienie) ─────

/** orders: [{ id, number, statusId }]; host: element, w którym pokazujemy potwierdzenie, postęp i podsumowanie. */
function startStatusChange(host, orders, targetId, onDone) {
  const target = statusName(targetId);
  const todo = orders.filter(o => String(o.statusId) !== String(targetId));
  const skipped = orders.length - todo.length;
  if (!todo.length) { flash('', 'Wszystkie wybrane zamówienia mają już status „' + target + '”.'); return; }
  const numOf = new Map(orders.map(o => [String(o.id), o.number || o.id]));
  const byStatus = new Map();
  for (const o of todo) byStatus.set(String(o.statusId), (byStatus.get(String(o.statusId)) || 0) + 1);
  const from = [...byStatus].map(([id, n]) => statusName(id) + ' (' + n + ')').join(', ');
  const close = () => host.replaceChildren();
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Zmiana statusu zamówień' });
  host.replaceChildren(box);
  const doneAll = [];

  const confirmStep = () => box.replaceChildren(
    el('h3', null, 'Zmienić status ' + cnt(todo.length, 'zamówienie', 'zamówienia', 'zamówień') + '?'),
    el('p', null, 'Z: ', el('strong', null, from), el('br'), 'Na: ', statusPill(targetId, target)),
    skipped ? el('p', { class: 'muted small' }, skipped + ' ' + plural(skipped, 'zamówienie ma', 'zamówienia mają', 'zamówień ma') + ' już ten status — pominięto.') : null,
    el('p', { class: 'muted small' }, 'Zmiana zostanie zapisana w Selly (może uruchomić powiadomienia dla klientów, jeśli tak skonfigurowano status).'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'primary', id: 'ordConfirm', onclick: () => run(todo.map(o => String(o.id))) }, 'Zmień status'),
      el('button', { type: 'button', class: 'secondary', id: 'ordCancel', onclick: close }, 'Anuluj')));

  async function run(ids) {
    const batch = Math.max(1, Number(S.meta && S.meta.maxStatusBatch) || 50);
    const chunks = []; for (let i = 0; i < ids.length; i += batch) chunks.push(ids.slice(i, i + batch));
    const bar = el('progress', { max: String(ids.length), value: '0', id: 'ordProgress', 'aria-label': 'Postęp zmiany statusu' });
    const label = el('div', { class: 'muted small', role: 'status' }, 'Zapisuję: 0 z ' + ids.length);
    box.replaceChildren(el('h3', null, 'Zmieniam status na „' + target + '”…'), bar, label);
    const done = [], failed = [];
    for (const chunk of chunks) {
      try {
        const r = await api('orders:setStatus', { ids: chunk, statusId: targetId });
        const ok = new Set((r.done || []).map(String));
        done.push(...ok);
        for (const f of r.failed || []) failed.push({ id: String(f.id), error: f.error || 'błąd' });
        for (const id of chunk) if (!ok.has(id) && !(r.failed || []).some(f => String(f.id) === id)) failed.push({ id, error: 'brak potwierdzenia z serwera' });
      } catch (e) { for (const id of chunk) failed.push({ id, error: e.message || 'błąd połączenia' }); }
      bar.value = done.length + failed.length;
      label.textContent = 'Zapisuję: ' + (done.length + failed.length) + ' z ' + ids.length;
    }
    doneAll.push(...done);
    summary(failed);
    if (done.length && onDone) onDone(done);
  }

  function summary(failed) {
    box.replaceChildren(
      el('h3', null, failed.length ? 'Zmiana statusu zakończona z błędami' : 'Status zmieniony'),
      el('p', { id: 'ordSummary' }, 'Zmieniono: ', el('strong', null, String(doneAll.length)), ' · nieudane: ', el('strong', null, String(failed.length))),
      failed.length ? el('ul', { class: 'ord-fails' }, failed.slice(0, 20).map(f => el('li', null, el('strong', null, numOf.get(f.id) || f.id), ' — ' + f.error)),
        failed.length > 20 ? el('li', { class: 'muted' }, '… i ' + (failed.length - 20) + ' więcej') : null) : null,
      el('div', { class: 'ord-actions' },
        failed.length ? el('button', { type: 'button', class: 'primary', id: 'ordRetry', title: 'Spróbuj ponownie tylko dla zamówień, którym nie udało się zmienić statusu', onclick: () => run(failed.map(f => f.id)) }, 'Ponów nieudane (' + failed.length + ')') : null,
        el('button', { type: 'button', class: 'secondary', id: 'ordClose', onclick: close }, 'Zamknij')));
  }
  confirmStep();
  box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
}

// ─── Eksport ────────────────────────────────────────────────────────────────

function exportTable(rows) {
  return {
    file: 'zamowienia', sheet: 'Zamówienia',
    columns: [
      { header: 'Numer', type: 'text' }, { header: 'Data', type: 'text' }, { header: 'Status', type: 'text' }, { header: 'Imię i nazwisko', type: 'text' }, { header: 'Firma', type: 'text' },
      { header: 'E-mail', type: 'text' }, { header: 'Telefon', type: 'text' }, { header: 'Miasto', type: 'text' }, { header: 'Dostawa', type: 'text' }, { header: 'Płatność', type: 'text' },
      { header: 'Zapłacono', type: 'center' }, { header: 'Nr przesyłki', type: 'text' }, { header: 'Wartość (zł)', type: 'number' }, { header: 'Pozycji', type: 'number' }, { header: 'Komentarz klienta', type: 'text' },
    ],
    rows: rows.map(r => [r.number, dateStr(r.date), statusName(r.statusId), fullName(r.firstName, r.lastName), r.company || '', r.email || '', r.phone || '', r.city || '', r.delivery || '', r.payment || '',
      r.paid ? 'tak' : 'nie', r.tracking || '', r.total == null ? '' : Number(r.total), r.itemCount == null ? '' : r.itemCount, r.comment || '']),
  };
}
const saveTable = (t, kind) => (kind === 'xlsx' ? downloadXlsx(t, '') : downloadCsv(tableMatrix(t), t.file, ''));

async function exportAll(kind) {
  const pt = progressToast('Pobieram zamówienia do pliku…');
  try {
    const rows = []; let total = 0;
    for (let page = 1; rows.length < EXPORT_MAX; page++) {
      const r = await api('orders:list', listParams(S.Q, { page, pageSize: 200 }));
      total = r.total; rows.push(...r.rows);
      if (total > 200) pt.set('Pobieram zamówienia do pliku… ' + Math.min(rows.length, total) + ' z ' + total);
      if (!r.rows.length || rows.length >= total) break;
    }
    const part = rows.slice(0, EXPORT_MAX);
    saveTable(exportTable(part), kind);
    pt.done('Gotowe: ' + part.length + ' zamówień w pliku');
    if (total > EXPORT_MAX) flash('', 'Plik zawiera pierwsze ' + EXPORT_MAX + ' z ' + total + ' zamówień — zawęź filtry, aby dostać resztę');
  } catch (e) { pt.done('Nie udało się pobrać zamówień: ' + (e.message || 'błąd')); }
}

function exportItems() {
  const sel = [...S.sel.values()], total = S.data ? S.data.total : 0, tot = Math.min(total, EXPORT_MAX);
  const noSel = 'Najpierw zaznacz zamówienia w tabeli';
  return [
    { label: 'Zaznaczone — Excel (.xlsx)', count: sel.length, title: sel.length ? 'Arkusz z zaznaczonymi zamówieniami' : noSel, run: () => saveTable(exportTable(sel), 'xlsx') },
    { label: 'Zaznaczone — CSV (.csv)', count: sel.length, title: sel.length ? 'Plik tekstowy (separator „;”, UTF-8) z zaznaczonymi zamówieniami' : noSel, run: () => saveTable(exportTable(sel), 'csv') },
    { label: 'Cały wynik filtra — Excel (.xlsx)', count: tot, title: 'Wszystkie zamówienia pasujące do bieżących filtrów, nie tylko ta strona', run: () => exportAll('xlsx') },
    { label: 'Cały wynik filtra — CSV (.csv)', count: tot, title: 'Wszystkie zamówienia pasujące do bieżących filtrów, nie tylko ta strona', run: () => exportAll('csv') },
  ];
}

// ─── Szczegóły ──────────────────────────────────────────────────────────────

const dl = pairs => el('dl', { class: 'ord-dl' }, pairs.filter(p => p && p[1] != null && p[1] !== '' && p[1] !== false).flatMap(([k, v, tip]) => [el('dt', { title: tip || null, class: tip ? 'tip' : null }, k), el('dd', null, v)]));
const textVal = v => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(textVal).filter(Boolean).join(', ') : Object.entries(v).map(([k, x]) => k + ': ' + textVal(x)).join(', ')) : String(v));

function addressBlock(o, p) {
  const g = k => o[p + '_' + k] || '';
  const name = fullName(g('first_name'), g('last_name'));
  const lines = [name, g('company'), g('nip') ? 'NIP: ' + g('nip') : '', g('address'), fullName(g('postcode'), g('city'))].filter(Boolean);
  return lines.length ? el('div', null, lines.map(l => el('div', null, l))) : el('span', { class: 'muted' }, 'brak danych');
}

async function renderDetail(id) {
  const my = ++S.routeSeq, box = S.detailBox;
  box.replaceChildren(el('div', { class: 'card' }, loadingBox('Pobieram zamówienie…')));
  let r;
  try { r = await api('orders:get', { id }); } catch (e) {
    if (my !== S.routeSeq) return;
    box.replaceChildren(isUnavailable(e) ? unavailableBox() : el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się pobrać zamówienia: ' + (e.message || 'błąd'),
      el('div', null, el('a', { href: S.listHash, class: 'btn-link' }, '← Wróć do listy'), ' ', el('button', { type: 'button', class: 'secondary', onclick: () => renderDetail(id) }, 'Spróbuj ponownie')))));
    return;
  }
  if (my !== S.routeSeq) return;
  const o = r.order || {}, products = o.products || [];
  const number = o.number || o.order_number || ('#' + id);
  const dlg = el('div', { id: 'ordDetailDlg' });
  const reload = () => { api('orders:meta').then(m => { S.meta = m; }).catch(() => {}).then(() => { if (my === S.routeSeq) renderDetail(id); }); };
  const stId = String(o.status_id != null ? o.status_id : '');
  const order1 = [{ id: String(id), number, statusId: stId }];
  const statusMenu = menuButton({ id: 'ordDetailStatus', label: 'Zmień status', cls: 'secondary', title: 'Ustaw inny status tego zamówienia (przed zmianą pokażemy potwierdzenie)',
    items: () => S.meta.statuses.map(s => ({ label: s.name, title: String(s.id) === stId ? 'Aktualny status' : 'Ustaw status „' + s.name + '”', run: () => startStatusChange(dlg, order1, String(s.id), () => { S.sel.delete(String(id)); S.data = null; reload(); }) })) });

  const sum = products.reduce((a, p) => a + (Number(p.price_total) || 0), 0);
  const prodCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Pozycje (' + products.length + ')')),
    products.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'ordItems' }, el('thead', null, el('tr', null,
      el('th', null, el('span', { title: 'Nazwa produktu z zamówienia' }, 'Produkt')), el('th', null, el('span', { title: 'Kod producenta / symbol produktu' }, 'Kod')),
      el('th', null, el('span', { title: 'Wybrany wariant produktu (np. rozmiar, kolor)' }, 'Wariant')), el('th', { class: 'n' }, el('span', { title: 'Zamówiona liczba sztuk' }, 'Ilość')),
      el('th', { class: 'n' }, el('span', { title: 'Cena jednostkowa brutto' }, 'Cena (zł)')), el('th', { class: 'n' }, el('span', { title: 'Cena razy ilość' }, 'Wartość (zł)')),
      el('th', null, el('span', { class: 'tip', title: 'Z którego magazynu Selly pobiera towar (według przypisania w Selly, nie według ruchów z panelu)' }, 'Magazyn wg Selly')))),
      el('tbody', null, products.map(p => el('tr', null,
        el('td', null, el('div', { class: 'cell-name' }, p.name || '—')), el('td', null, p.producer_code || p.symbol || ''), el('td', null, textVal(p.variant_features)),
        el('td', { class: 'n' }, String(p.quantity == null ? '' : p.quantity)), el('td', { class: 'n nw' }, money(p.price_with_tax)), el('td', { class: 'n nw' }, money(p.price_total)),
        el('td', null, (p.warehouses || []).map(w => (w.name || w.warehouse_id) + ' × ' + w.quantity).join(', '))))),
      el('tfoot', null, el('tr', null, el('td', { colspan: '5' }, el('strong', null, 'Razem pozycje')), el('td', { class: 'n nw' }, el('strong', null, money(sum))), el('td', null)))))
      : el('div', { class: 'empty' }, 'Zamówienie nie ma pozycji.'));

  const moves = r.moves || [];
  const MOVE = { przyjecie: 'Przyjęcie', przesuniecie: 'Przesunięcie', wydanie: 'Wydanie', korekta: 'Korekta' };
  const movesCard = moves.length ? el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Ruchy magazynowe'), el('div', { class: 'sub' }, 'Wydania i inne ruchy zapisane w panelu OSA dla tego zamówienia.')),
    el('div', { class: 'table-wrap' }, el('table', { id: 'ordMoves' }, el('thead', null, el('tr', null, ['Czas', 'Rodzaj', 'Produkt', 'Ilość', 'Autor'].map(h => el('th', null, el('span', { title: h }, h))))),
      el('tbody', null, moves.map(m => el('tr', null, el('td', { class: 'nw' }, m.time || (m.ms ? dateStr(new Date(m.ms).toISOString()) : '')), el('td', null, MOVE[m.type] || m.type || ''),
        el('td', null, m.productName || m.productId || ''), el('td', { class: 'n' }, String(m.qty == null ? '' : m.qty)), el('td', null, m.author || '')))))) ) : null;

  const events = r.events;
  const evKey = (e, ks) => { for (const k of ks) if (e[k] != null && e[k] !== '') return e[k]; return ''; };
  const eventsCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Historia zdarzeń')),
    r.eventsError || events == null ? el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać historii zdarzeń z Selly' + (r.eventsError ? ' (' + textVal(r.eventsError) + ')' : '') + '. Reszta danych zamówienia jest aktualna.')
      : events.length ? el('ul', { class: 'ord-events', id: 'ordEvents' }, events.map(e => el('li', null,
        el('span', { class: 'muted nw' }, dateStr(evKey(e, ['date', 'created', 'created_at', 'time', 'datetime']))), ' ',
        el('strong', null, textVal(evKey(e, ['event_type', 'name', 'type', 'title', 'event', 'status_name', 'action']))), ' ',
        el('span', null, textVal(evKey(e, ['description', 'text', 'comment', 'message', 'content']))), ' ',
        evKey(e, ['user', 'author', 'admin', 'user_name']) ? el('span', { class: 'muted' }, '· ' + textVal(evKey(e, ['user', 'author', 'admin', 'user_name']))) : null)))
        : el('div', { class: 'empty' }, 'Brak zdarzeń dla tego zamówienia.'));

  const notes = [];
  if (o.client_comment) notes.push(el('div', { class: 'notice warn', id: 'ordClientComment' }, el('strong', null, 'Komentarz klienta: '), o.client_comment));
  if (o.order_attention) notes.push(el('div', { class: 'notice warn', id: 'ordAttention' }, el('strong', null, 'Uwagi do zamówienia: '), o.order_attention));

  const synced = r.syncedMs ? new Date(r.syncedMs).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  box.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'ord-detail-top' },
        el('a', { href: S.listHash, class: 'btn-link', id: 'ordBack', title: 'Wróć do listy z zachowanymi filtrami, wyszukiwaniem i stroną' }, '← Wróć do listy'),
        el('span', { class: 'spacer' }),
        el('span', { class: 'muted small tip', title: 'Dane z kopii zamówień synchronizowanej z Selly co minutę' }, 'dane z: ' + synced),
        sellyLink('Otwórz w panelu Selly ↗', sellyOrderUrl(id), 'Otwiera to zamówienie w panelu administracyjnym Selly')),
      el('div', { class: 'card-head' }, el('h2', { id: 'ordTitle' }, 'Zamówienie ' + number), el('div', { class: 'sub' }, dateStr(o.date))),
      el('div', { class: 'ord-detail-status' }, 'Status: ', statusPill(stId, o.status_name || statusName(stId)), statusMenu),
      dlg, ...notes),
    el('div', { class: 'ord-grid' },
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Klient')),
        dl([['E-mail', o.email ? el('a', { href: 'mailto:' + o.email }, o.email) : ''], ['Telefon', o.phone ? el('a', { href: 'tel:' + String(o.phone).replace(/[^\d+]/g, '') }, o.phone) : ''],
          ['Dane do faktury', addressBlock(o, 'invoice')], ['Adres wysyłki', addressBlock(o, 'ship')]])),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Dostawa i płatność')),
        dl([['Dostawa', o.delivery_name], ['Koszt dostawy (zł)', o.delivery_price != null && o.delivery_price !== '' ? money(o.delivery_price) : ''], ['Płatność', o.payment_name],
          ['Zapłacono (zł)', o.paid_price != null && o.paid_price !== '' ? money(o.paid_price) : '', 'Kwota, którą Selly uznaje za zapłaconą'], ['Rabat (zł)', Number(o.discount_price) ? money(o.discount_price) : ''],
          ['Nr przesyłki', o.tracking_code], ['Paczkomat', o.inpost_parcel_locker]]))),
    prodCard, movesCard, eventsCard);
}

// ─── Trasa ──────────────────────────────────────────────────────────────────

function show(which) {
  S.metaBox.hidden = which !== 'meta';
  if (S.listBox) S.listBox.hidden = which !== 'list';
  S.detailBox.hidden = which !== 'detail';
}

async function mountRoute() {
  const route = S.route, my = ++S.routeSeq;
  if (!S.meta) {
    show('meta');
    S.metaBox.replaceChildren(el('div', { class: 'card' }, loadingBox('Wczytuję zamówienia…')));
    await ensureMeta();
    if (my !== S.routeSeq) return;
    if (!S.meta) {
      S.metaBox.replaceChildren(S.metaErr && isUnavailable(S.metaErr) ? unavailableBox() : unavailableBox(S.metaErr ? 'Nie udało się otworzyć zamówień: ' + S.metaErr.message : MSG_UNAVAILABLE));
      return;
    }
  }
  if (!S.ui.search) buildList();
  if (route.id) { show('detail'); renderDetail(route.id); return; }
  show('list');
  S.Q = route.Q;
  S.listHash = location.hash || '#/zamowienia';
  loadList();
}

export default {
  id: 'zamowienia',
  title: 'Zamówienia',
  routes: ['', '<id>'],
  mount(el0, params) {
    if (!S.root) {
      S.root = el0;
      S.metaBox = el('div'); S.detailBox = el('div'); S.metaBox.hidden = S.detailBox.hidden = true;
      el0.append(S.metaBox, S.detailBox);
    }
    S.route = { id: params && params.parts && params.parts[0] || '', Q: readQ(params && params.query) };
    mountRoute();
  },
  unmount() { S.seq++; S.routeSeq++; },
};
