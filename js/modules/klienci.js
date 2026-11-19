// Moduł „Klienci”: lista z wyszukiwarką (#/klienci?q=..&page=..) i szczegóły (#/klienci/<id>).
// Dane i zapisy: backend Cloudflare (akcje clients:list, clients:get, clients:update — notatka klienta).
import { el, tapOpen, debounce, store, flash, menuButton, downloadXlsx, downloadCsv, tableMatrix, dateStr, fullName, isUnavailable, loadingBox, sellyLink, dl, sortTh, pager, syncedLabel, fetchAllRows, field } from '../core/ui.js';
import { api, ctx } from '../core/client.js';
import { go } from '../core/router.js';
import { OSA_CLEAR, readOsa, writeOsa, osaParams, osaActive, osaBar, osaBadges, osaExport, osaDetailPairs, applyBadgePrefs } from '../core/osa.js';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const SORTS = ['name', 'email', 'created', 'modified', 'orders'];
const SIZES = [25, 50, 100, 200];
// Eksport czyta z bazy panelu (nie z Selly — nie zużywa limitu API); górna granica tylko jako bezpiecznik
const EXPORT_MAX = 50000;
const MSG_UNAVAILABLE = 'Moduł Klienci wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = { facets: null, root: null, listBox: null, detailBox: null, ui: {}, Q: null, data: null, err: '', listHash: '#/klienci', seq: 0, routeSeq: 0, route: null };

const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const sellyClientUrl = id => adminUrl() + '?a=klienci.view&id=' + encodeURIComponent(id);
const isOn = v => v === true || v === 1 || v === '1' || v === 'true';
const dayStr = d => (d ? String(d).slice(0, 10) : '');

function unavailableBox(extra) {
  return el('div', { class: 'card' }, el('div', { class: 'empty error' },
    el('p', null, el('strong', null, extra || MSG_UNAVAILABLE)),
    el('p', null, sellyLink('Otwórz klientów w panelu Selly ↗', adminUrl() + '?a=klienci', 'Otwiera listę klientów w panelu administracyjnym Selly w nowej karcie')),
    el('p', null, el('button', { type: 'button', class: 'secondary', onclick: () => mountRoute() }, 'Spróbuj ponownie'))));
}

// ─── Stan filtrów ↔ adres ───────────────────────────────────────────────────

function readQ(query) {
  const g = k => (query && query.get(k)) || '';
  const sort = SORTS.includes(g('sort')) ? g('sort') : 'created';
  return { ...readOsa(g), q: g('q'), page: Math.max(1, parseInt(g('page'), 10) || 1), sort, dir: g('dir') === 'asc' ? 'asc' : g('dir') === 'desc' ? 'desc' : (sort === 'name' || sort === 'email' ? 'asc' : 'desc') };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  if (Q.q) p.set('q', Q.q);
  writeOsa(Q, p);
  if (Q.page > 1) p.set('page', String(Q.page));
  if (Q.sort !== 'created' || Q.dir !== 'desc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  return s ? '?' + s : '';
}
const pageSize = () => { const v = store('osa-cli-size'); return SIZES.includes(v) ? v : 50; };
const listParams = (Q, extra) => Object.assign({ sort: Q.sort, dir: Q.dir, pageSize: pageSize(), page: Q.page }, Q.q ? { q: Q.q } : {}, osaParams(Q), extra);
function setQ(patch, replace) {
  const n = Object.assign({}, S.Q, patch);
  if (!('page' in patch)) n.page = 1;
  const h = '/klienci' + qsOf(n);
  if (replace) go(h, { replace: true });
  else if (location.hash === '#' + h) { S.Q = n; loadList(); } else go(h);
}

// ─── Lista ──────────────────────────────────────────────────────────────────

function buildList() {
  const u = S.ui;
  u.search = el('input', { type: 'search', id: 'cliSearch', placeholder: 'Szukaj: nazwisko, e-mail, telefon, firma, miasto, NIP, notatka', 'aria-label': 'Szukaj klientów',
    title: 'Szuka w nazwie, e-mailu, telefonie, firmie, mieście wysyłki, NIP, notatce klienta i numerze ID',
    oninput: debounce(() => { const v = u.search.value.trim(); if (v !== S.Q.q) setQ({ q: v }, true); }, 350) });
  u.size = el('select', { id: 'cliSize', 'aria-label': 'Wierszy na stronie', onchange: () => { store('osa-cli-size', Number(u.size.value)); setQ({}); } },
    SIZES.map(n => el('option', { value: String(n) }, String(n))));
  u.filtersBtn = el('button', { type: 'button', class: 'secondary', id: 'cliFiltersBtn', 'aria-expanded': 'false', 'aria-controls': 'cliFilters',
    title: 'Dodatkowe ustawienia: liczba wierszy na stronie', onclick: () => toggleFilters() }, 'Filtry ▾');
  u.filters = el('div', { class: 'opts-box ord-filters', id: 'cliFilters', hidden: true },
    el('div', { class: 'ord-filter-row' }, field('Wierszy na stronie', u.size, 'Ile klientów pokazać na jednej stronie listy'),
      el('button', { type: 'button', class: 'ghost', id: 'cliClear', title: 'Usuń wyszukiwanie', onclick: () => setQ({ q: '' }) }, 'Wyczyść wyszukiwanie')));
  u.exportBtn = menuButton({ id: 'cliExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz cały wynik wyszukiwania do pliku Excel lub CSV', items: () => {
    const tot = Math.min(S.data ? S.data.total : 0, EXPORT_MAX);
    const tip = 'Wszyscy klienci pasujący do wyszukiwania, nie tylko ta strona';
    return [{ label: 'Cały wynik — Excel (.xlsx)', count: tot, title: tip, run: () => exportAll('xlsx') }, { label: 'Cały wynik — CSV (.csv)', count: tot, title: tip, run: () => exportAll('csv') }];
  } });
  u.osa = osaBar({ prefix: 'cliOsa', withLicense: false, getQ: () => S.Q, apply: patch => setQ(patch), facets: () => S.facets });
  u.info = el('div', { class: 'muted small ord-info' });
  u.notice = el('div');
  u.results = el('div', { id: 'cliResults' });
  S.listBox = el('div', { class: 'ord-list' }, el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', null, 'Klienci'), el('div', { class: 'sub' }, 'Klienci sklepu (kopia odświeżana w tle). Kliknij klienta, aby zobaczyć dane, zamówienia i notatkę.')),
    el('div', { class: 'toolbar' }, u.search, u.filtersBtn, u.exportBtn, el('span', { class: 'spacer' }), u.info), u.osa.node, u.filters, u.notice, u.results));
  S.root.append(S.listBox);
}
function toggleFilters(force) {
  const u = S.ui, open = force != null ? force : u.filters.hidden;
  u.filters.hidden = !open;
  u.filtersBtn.setAttribute('aria-expanded', String(open));
  u.filtersBtn.textContent = open ? 'Filtry ▴' : 'Filtry ▾';
}
function syncList() {
  const u = S.ui;
  if (u.search.value.trim() !== S.Q.q) u.search.value = S.Q.q;
  u.size.value = String(pageSize());
  u.osa.sync();
  const extra = pageSize() !== 50;
  u.filtersBtn.classList.toggle('on', extra);
  if (extra && u.filters.hidden) toggleFilters(true);
}

async function loadList() {
  const my = ++S.seq, u = S.ui;
  S.err = '';
  if (!S.facets && !S.facetsLoading) { S.facetsLoading = true; api('clients:meta').then(m => { S.facets = (m && m.facets) || {}; if (S.ui.osa) S.ui.osa.sync(); }).catch(() => {}).then(() => { S.facetsLoading = false; }); }
  syncList();
  if (!S.data) u.results.replaceChildren(loadingBox('Pobieram klientów…'));
  else u.results.classList.add('fade');
  try {
    const r = await api('clients:list', listParams(S.Q));
    if (my !== S.seq) return;
    S.data = r;
    const pages = Math.max(1, Math.ceil((r.total || 0) / (r.pageSize || 50)));
    if (S.Q.page > pages && r.total > 0) { setQ({ page: pages }, true); return; }
  } catch (e) {
    if (my !== S.seq) return;
    S.err = isUnavailable(e) ? MSG_UNAVAILABLE : (e.message || 'Nie udało się pobrać klientów.');
  }
  u.results.classList.remove('fade');
  renderList();
}

const COLS = [
  { label: 'Nazwa', sort: 'name', tip: 'Imię i nazwisko klienta oraz firma. Najedź na nazwę, aby zobaczyć notatkę klienta.' },
  { label: 'E-mail', sort: 'email', tip: 'Adres e-mail klienta (login w sklepie)' },
  { label: 'Telefon', tip: 'Numer telefonu klienta' },
  { label: 'Miasto', tip: 'Miasto z adresu wysyłki klienta' },
  { label: 'Zamówień', sort: 'orders', num: true, tip: 'Liczba zamówień klienta w kopii zamówień panelu (dopasowanie po koncie klienta lub e-mailu)', tipHeader: true },
  { label: 'Utworzony', sort: 'created', firstDir: 'desc', tip: 'Data założenia konta klienta w sklepie' },
];

function renderList() {
  const u = S.ui, d = S.data, Q = S.Q;
  if (S.err && !d) {
    u.info.textContent = ''; u.notice.replaceChildren();
    u.results.replaceChildren(el('div', { class: 'empty error' }, S.err, ' ', sellyLink('Panel Selly ↗', adminUrl() + '?a=klienci', 'Otwiera listę klientów w panelu Selly w nowej karcie'),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => loadList() }, 'Spróbuj ponownie'))));
    return;
  }
  const size = d.pageSize || pageSize(), pages = Math.max(1, Math.ceil(d.total / size));
  u.info.replaceChildren(el('span', { class: 'tip', title: 'Lista pochodzi z kopii klientów synchronizowanej z Selly w tle — najświeższe zmiany mogą pojawić się z opóźnieniem.' }, 'dane z: ' + syncedLabel(d.syncedMs)));
  u.notice.replaceChildren(d.loading ? el('div', { class: 'notice warn', id: 'cliLoading', role: 'status' }, 'Trwa pierwsze pobieranie klientów ze sklepu — lista może być niepełna. Odśwież stronę za chwilę.') : null);
  const head = el('tr', null, COLS.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir }))));
  const body = el('tbody');
  for (const r of d.rows) {
    const blocked = isOn(r.blocked);
    body.append(el('tr', { class: 'pick' + (blocked ? ' blocked' : ''), 'data-id': r.id, onclick: tapOpen(() => openClient(r.id)) },
      el('td', { title: r.notes ? 'Notatka: ' + r.notes : null },
        el('a', { href: '#/klienci/' + encodeURIComponent(r.id), class: 'cell-name', onclick: () => { S.listHash = location.hash; } }, r.name || r.email || ('Klient ' + r.id)),
        r.company ? el('div', { class: 'cell-sub' }, r.company) : null,
        blocked ? el('span', { class: 'tag bad', title: 'Konto klienta jest zablokowane w sklepie' }, 'zablokowany') : null,
        osaBadges(r, patch => setQ(patch), false, S.facets),
        r.notes ? el('div', { class: 'cell-sub cli-note' }, String(r.notes).length > 60 ? String(r.notes).slice(0, 60) + '…' : String(r.notes)) : null),
      el('td', null, r.email || ''), el('td', { class: 'nw' }, r.phone || ''), el('td', null, r.city || ''),
      el('td', { class: 'n' }, String(r.orders == null ? 0 : r.orders)), el('td', { class: 'nw' }, dayStr(r.created))));
  }
  if (!d.rows.length) body.append(el('tr', null, el('td', { colspan: String(COLS.length), class: 'empty' },
    Q.q || osaActive(Q) ? 'Brak klientów pasujących do wyszukiwania i filtrów.' : 'Brak klientów.', ' ',
    Q.q || osaActive(Q) ? el('button', { type: 'button', class: 'secondary', onclick: () => setQ({ q: '', ...OSA_CLEAR }) }, 'Wyczyść filtry') : null)));
  u.results.replaceChildren(S.err ? el('div', { class: 'notice error' }, S.err) : null,
    el('div', { class: 'table-wrap' }, el('table', { id: 'cliTable' }, el('thead', null, head), body)),
    pager({ prefix: 'cli', page: Q.page, pages, total: d.total, noun: ['klient', 'klienci', 'klientów'], onPage: p => setQ({ page: p }) }));
}
function openClient(id) { S.listHash = location.hash; go('/klienci/' + encodeURIComponent(id)); }

async function exportAll(kind) {
  try {
    const { rows, total } = await fetchAllRows(page => api('clients:list', listParams(S.Q, { page, pageSize: 200 })), EXPORT_MAX, 'klientów');
    const t = {
      file: 'klienci', sheet: 'Klienci',
      columns: [{ header: 'ID', type: 'text' }, { header: 'Nazwa', type: 'text' }, { header: 'Firma', type: 'text' }, { header: 'E-mail', type: 'text' }, { header: 'Telefon', type: 'text' },
        { header: 'Miasto', type: 'text' }, { header: 'Zamówień', type: 'number' }, { header: 'Utworzony', type: 'text' }, { header: 'Zablokowany', type: 'center' }, { header: 'Notatka', type: 'text' },
        { header: 'Województwo', type: 'text' }, { header: 'Rodzaj podmiotu', type: 'text' }, { header: 'Tytuł orszaku', type: 'text' }, { header: 'Tagi', type: 'text' }],
      rows: rows.map(r => [r.id, r.name || '', r.company || '', r.email || '', r.phone || '', r.city || '', Number(r.orders) || 0, dayStr(r.created), isOn(r.blocked) ? 'tak' : 'nie', r.notes || '', osaExport(r).woj, osaExport(r).kind, osaExport(r).title, osaExport(r).tags]),
    };
    if (kind === 'xlsx') downloadXlsx(t, ''); else downloadCsv(tableMatrix(t), t.file, '');
    if (total > EXPORT_MAX) flash('', 'Plik zawiera pierwsze ' + EXPORT_MAX + ' z ' + total + ' klientów — zawęź wyszukiwanie, aby dostać resztę');
  } catch (e) { flash('', 'Nie udało się pobrać klientów: ' + (e.message || 'błąd')); }
}

// ─── Szczegóły ──────────────────────────────────────────────────────────────

function addressBlock(o, p) {
  const g = k => o[p + '_' + k] || '';
  const lines = [fullName(g('first_name'), g('last_name')), g('company'), g('nip') ? 'NIP: ' + g('nip') : '', g('address'), fullName(g('postcode'), g('city'))].filter(Boolean);
  return lines.length ? el('div', null, lines.map(l => el('div', null, l))) : el('span', { class: 'muted' }, 'brak danych');
}

async function renderDetail(id) {
  const my = ++S.routeSeq, box = S.detailBox;
  box.replaceChildren(el('div', { class: 'card' }, loadingBox('Pobieram klienta…')));
  let r;
  try { r = await api('clients:get', { id }); } catch (e) {
    if (my !== S.routeSeq) return;
    box.replaceChildren(isUnavailable(e) ? unavailableBox() : el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się pobrać klienta: ' + (e.message || 'błąd'),
      el('div', null, el('a', { href: S.listHash, class: 'btn-link' }, '← Wróć do listy'), ' ', el('button', { type: 'button', class: 'secondary', onclick: () => renderDetail(id) }, 'Spróbuj ponownie')))));
    return;
  }
  if (my !== S.routeSeq) return;
  const c = r.client || {};
  const name = fullName(c.first_name, c.last_name) || c.invoice_company || c.email || ('Klient ' + id);
  const stName = sid => { const s = (r.statuses || []).find(x => String(x.id) === String(sid)); return s ? s.name : (sid == null || sid === '' ? '—' : 'Status ' + sid); };

  // Notatka z edycją
  const noteHost = el('div', { id: 'cliNoteBox' });
  const showNote = () => noteHost.replaceChildren(
    c.notes ? el('p', { class: 'cli-note-text', id: 'cliNoteText' }, c.notes) : el('p', { class: 'muted', id: 'cliNoteText' }, 'Brak notatki.'),
    el('button', { type: 'button', class: 'secondary', id: 'cliNoteEdit', title: 'Edytuj notatkę klienta (zapisze się w Selly)', onclick: editNote }, 'Edytuj notatkę'));
  function editNote() {
    const ta = el('textarea', { id: 'cliNoteInput', rows: '5', maxlength: '5000', 'aria-label': 'Notatka klienta' });
    ta.value = c.notes || '';
    const msg = el('div', { role: 'status' });
    const save = el('button', { type: 'button', class: 'primary', id: 'cliNoteSave', title: 'Zapisuje notatkę w Selly', onclick: async () => {
      save.disabled = true;
      try { await api('clients:update', { id, notes: ta.value }); flash('', 'Notatka zapisana w Selly'); S.data = null; renderDetail(id); }
      catch (e) { save.disabled = false; msg.replaceChildren(el('div', { class: 'notice error' }, 'Nie udało się zapisać: ' + (e.message || 'błąd'))); }
    } }, 'Zapisz');
    noteHost.replaceChildren(ta, msg, el('div', { class: 'ord-actions' }, save, el('button', { type: 'button', class: 'secondary', id: 'cliNoteCancel', onclick: showNote }, 'Anuluj')));
    ta.focus();
  }
  showNote();

  const orders = r.orders || [];
  const ordersCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Zamówienia klienta (' + orders.length + ')'), el('div', { class: 'sub' }, 'Dopasowane po koncie klienta lub e-mailu; najnowsze pierwsze (do 200).')),
    orders.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'cliOrders' }, el('thead', null, el('tr', null,
      el('th', null, el('span', { title: 'Numer zamówienia — kliknij, aby zobaczyć szczegóły' }, 'Numer')), el('th', null, el('span', { title: 'Data złożenia zamówienia' }, 'Data')),
      el('th', null, el('span', { title: 'Aktualny status zamówienia w Selly' }, 'Status')), el('th', { class: 'n' }, el('span', { title: 'Kwota uznana w Selly za zapłaconą, w złotych' }, 'Zapłacono (zł)')))),
      el('tbody', null, orders.map(o => el('tr', null, el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(o.id), class: 'cell-name' }, o.number || o.id)), el('td', { class: 'nw' }, dateStr(o.date)),
        el('td', null, stName(o.statusId)), el('td', { class: 'n nw' }, o.paid != null && o.paid !== '' && !isNaN(Number(o.paid)) ? Number(o.paid).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'))))))
      : el('div', { class: 'empty' }, 'Klient nie ma zamówień.'));

  const osaCard = el('div', { id: 'cliOsaCard' });
  fillOsa(osaCard, id, my);
  box.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'ord-detail-top' },
        el('a', { href: S.listHash, class: 'btn-link', id: 'cliBack', title: 'Wróć do listy z zachowanym wyszukiwaniem i stroną' }, '← Wróć do listy'), el('span', { class: 'spacer' }),
        el('span', { class: 'muted small tip', title: 'Dane z kopii klientów synchronizowanej z Selly w tle' }, 'dane z: ' + syncedLabel(r.syncedMs)),
        sellyLink('Otwórz w panelu Selly ↗', sellyClientUrl(id), 'Otwiera kartę klienta w panelu administracyjnym Selly')),
      el('div', { class: 'card-head' }, el('h2', { id: 'cliTitle' }, name), el('div', { class: 'sub' }, 'ID ' + id)),
      isOn(c.block) ? el('div', { class: 'notice error', id: 'cliBlocked' }, 'Konto klienta jest zablokowane w sklepie.') : null),
    el('div', { class: 'ord-grid' },
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Dane kontaktowe')),
        dl([['E-mail', c.email ? el('a', { href: 'mailto:' + c.email }, c.email) : ''], ['Telefon', c.phone ? el('a', { href: 'tel:' + String(c.phone).replace(/[^\d+]/g, '') }, c.phone) : ''],
          ['Konto utworzone', dateStr(c.created_at)], ['Ostatnie logowanie', dateStr(c.last_login_at)], ['Newsletter', c.newsletter != null && c.newsletter !== '' ? (isOn(c.newsletter) ? 'tak' : 'nie') : '', 'Czy klient zapisał się na newsletter'],
          ['Grupa klienta (nr)', c.group_id != null && c.group_id !== '' ? String(c.group_id) : '', 'Numer grupy klienta w Selly']])),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Adresy')),
        dl([['Dane do faktury', addressBlock(c, 'invoice')], ['Adres wysyłki', addressBlock(c, 'ship')]]))),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Notatka'), el('div', { class: 'sub tip', title: 'W sklepie notatka klienta to zwykle opis orszaku: województwo, miejscowość itp. Zapis trafia do Selly.' }, 'Opis orszaku i uwagi — widoczne w panelu')), noteHost),
    osaCard, ordersCard);
}

/** Sekcja „Orszak (z notatki)”: pola wyliczone z notatki (wiersz listy klientów, wyszukany po ID). */
async function fillOsa(host, id, my) {
  let row = S.data && S.data.rows.find(x => String(x.id) === String(id));
  if (!row) { try { const r = await api('clients:list', { q: String(id), pageSize: 10 }); row = r.rows.find(x => String(x.id) === String(id)) || null; } catch (e) { row = null; } }
  if (my !== S.routeSeq) return;
  const d = row ? dl(osaDetailPairs(row)) : null;
  host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Orszak (z notatki)'), el('div', { class: 'sub' }, 'Pola odczytane z notatki klienta')),
    d && d.children.length ? d : el('p', { class: 'muted', id: 'cliOsaNone' }, 'Notatka klienta nie zawiera danych orszaku (województwo, rodzaj podmiotu, tytuł, tagi).')));
}

// ─── Trasa ──────────────────────────────────────────────────────────────────

function mountRoute() {
  const route = S.route;
  if (!S.ui.search) buildList();
  S.listBox.hidden = !!route.id; S.detailBox.hidden = !route.id;
  if (route.id) { renderDetail(route.id); return; }
  S.routeSeq++;
  S.Q = route.Q;
  S.listHash = location.hash || '#/klienci';
  loadList();
}

export default {
  id: 'klienci',
  title: 'Klienci',
  routes: ['', '<id>'],
  mount(el0, params) {
    applyBadgePrefs();
    if (!S.root) { S.root = el0; S.detailBox = el('div'); S.detailBox.hidden = true; el0.append(S.detailBox); }
    S.route = { id: (params && params.parts && params.parts[0]) || '', Q: readQ(params && params.query) };
    mountRoute();
  },
  unmount() { S.seq++; S.routeSeq++; },
};
