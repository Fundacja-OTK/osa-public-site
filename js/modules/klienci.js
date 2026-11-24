// Moduł „Klienci”: lista z wyszukiwarką (#/klienci?q=..&page=..) i szczegóły (#/klienci/<id>).
// Dane i zapisy: backend Cloudflare (akcje clients:list, clients:get, clients:update — notatka klienta).
import { el, tapOpen, debounce, store, flash, menuButton, columnMenu, downloadXlsx, downloadCsv, tableMatrix, dateStr, fullName, isUnavailable, loadingBox, sellyLink, dl, sortTh, pager, syncedLabel, fetchAllRows, field } from '../core/ui.js?v=d317124';
import { api, ctx } from '../core/client.js?v=d317124';
import { go, setLeaveGuard } from '../core/router.js?v=d317124';
import { noteVisit } from '../core/recents.js?v=d317124';
import { registerListKeys } from '../core/listKeys.js?v=d317124';
import { clientForm } from './klienciForm.js?v=d317124';
import { mountBlockToggle } from './klienciBlokada.js?v=d317124';
import { addressesFold, pricesFold, affiliateFold, relatedBlock, sellyOnlyBlock, renderGroups } from './klienciExtra.js?v=d317124';
import { OSA_CLEAR, readOsa, writeOsa, osaParams, osaActive, osaBar, osaBadges, osaExport, osaDetailPairs, applyBadgePrefs } from '../core/osa.js?v=d317124';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const SORTS = ['name', 'email', 'created', 'modified', 'orders', 'id', 'login', 'city'];
// Filtry z Selly (lista klientów): nazwy jak w parametrach akcji clients:list
const FILTERS = ['registered', 'nip', 'level', 'group', 'country', 'type', 'newsletter'];
const FILTER_CLEAR = Object.fromEntries(FILTERS.map(k => [k, '']));
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
  return { ...readOsa(g), ...Object.fromEntries(FILTERS.map(k => [k, g(k)])), q: g('q'), page: Math.max(1, parseInt(g('page'), 10) || 1), sort, dir: g('dir') === 'asc' ? 'asc' : g('dir') === 'desc' ? 'desc' : (sort === 'name' || sort === 'email' ? 'asc' : 'desc') };
}
function qsOf(Q) {
  const p = new URLSearchParams();
  if (Q.q) p.set('q', Q.q);
  writeOsa(Q, p);
  for (const k of FILTERS) if (Q[k]) p.set(k, Q[k]);
  if (Q.page > 1) p.set('page', String(Q.page));
  if (Q.sort !== 'created' || Q.dir !== 'desc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  return s ? '?' + s : '';
}
const advActive = Q => FILTERS.filter(k => Q[k]).length;
const pageSize = () => { const v = store('osa-cli-size'); return SIZES.includes(v) ? v : 50; };
const listParams = (Q, extra) => Object.assign({ sort: Q.sort, dir: Q.dir, pageSize: pageSize(), page: Q.page }, Q.q ? { q: Q.q } : {}, osaParams(Q), Object.fromEntries(FILTERS.filter(k => Q[k]).map(k => [k, Q[k]])), extra);
function setQ(patch, replace) {
  const n = Object.assign({}, S.Q, patch);
  if (!('page' in patch)) n.page = 1;
  const h = '/klienci' + qsOf(n);
  if (replace) go(h, { replace: true });
  else if (location.hash === '#' + h) { S.Q = n; loadList(); } else go(h);
}

// ─── Lista ──────────────────────────────────────────────────────────────────

function fSelect(key, label, tip, options) {
  const sel = el('select', { id: 'cliF_' + key, 'aria-label': label, onchange: () => setQ({ [key]: sel.value }) },
    options.map(([v, t]) => el('option', { value: v }, t)));
  return { sel, node: field(label, sel, tip) };
}

function buildList() {
  const u = S.ui;
  u.search = el('input', { type: 'search', id: 'cliSearch', placeholder: 'Szukaj: nazwisko, e-mail, telefon, firma, miasto, NIP, notatka', 'aria-label': 'Szukaj klientów',
    title: 'Szuka w nazwie, e-mailu, telefonie, firmie, mieście wysyłki, NIP, notatce klienta i numerze ID',
    oninput: debounce(() => { const v = u.search.value.trim(); if (v !== S.Q.q) setQ({ q: v }, true); }, 350) });
  u.size = el('select', { id: 'cliSize', 'aria-label': 'Wierszy na stronie', onchange: () => { store('osa-cli-size', Number(u.size.value)); setQ({}); } },
    SIZES.map(n => el('option', { value: String(n) }, String(n))));
  u.filtersBtn = el('button', { type: 'button', class: 'secondary', id: 'cliFiltersBtn', 'aria-expanded': 'false', 'aria-controls': 'cliFilters',
    title: 'Dodatkowe filtry (NIP, poziom cen, grupa, kraj, typ konta, newsletter) i liczba wierszy na stronie', onclick: () => toggleFilters() }, 'Filtry ▾');
  u.adv = {
    registered: fSelect('registered', 'Rejestracja', 'Klient zarejestrowany ma konto z loginem w sklepie; niezarejestrowany to dane z zamówienia gościa', [['', 'wszyscy'], ['yes', 'zarejestrowani'], ['no', 'niezarejestrowani']]),
    nip: fSelect('nip', 'NIP', 'Czy klient ma wpisany NIP w danych do faktury', [['', 'bez ograniczeń'], ['yes', 'z NIP'], ['no', 'bez NIP']]),
    level: fSelect('level', 'Poziom cen', 'Który cennik stosuje sklep wobec klienta; „z indywidualnym rabatem” = rabat procentowy większy od zera', [['', 'wszystkie'], ['0', 'detaliczny'], ['1', 'rabaty — poziom 1'], ['2', 'rabaty — poziom 2'], ['3', 'rabaty — poziom 3'], ['custom', 'z indywidualnym rabatem']]),
    group: fSelect('group', 'Grupa', 'Grupa klientów w Selly (liczba w nawiasie = klientów w grupie)', [['', 'wszystkie']]),
    country: fSelect('country', 'Państwo', 'Państwo z adresu klienta', [['', 'wszystkie']]),
    type: fSelect('type', 'Rodzaj konta', 'Konto podstawowe albo subkonto (podrzędne konto firmy)', [['', 'wszystkie'], ['CLIENT', 'konta podstawowe'], ['SUBACCOUNT_CLIENT', 'subkonta']]),
    newsletter: fSelect('newsletter', 'Newsletter', 'Czy klient zapisał się na newsletter', [['', 'bez ograniczeń'], ['yes', 'zapisani'], ['no', 'niezapisani']]),
  };
  u.filters = el('div', { class: 'opts-box ord-filters', id: 'cliFilters', hidden: true },
    el('div', { class: 'ord-filter-row' }, Object.values(u.adv).map(f => f.node)),
    el('div', { class: 'ord-filter-row' }, field('Wierszy na stronie', u.size, 'Ile klientów pokazać na jednej stronie listy'),
      el('button', { type: 'button', class: 'ghost', id: 'cliClear', title: 'Usuń wyszukiwanie i wszystkie filtry', onclick: () => setQ({ q: '', ...OSA_CLEAR, ...FILTER_CLEAR }) }, 'Wyczyść wyszukiwanie i filtry')));
  u.cols = columnMenu({ id: 'cliCols', storeKey: 'osa-cli-cols', cols: COLS.map(c => ({ key: c.key, label: c.label, tip: c.tip, def: c.def, locked: c.locked })), onChange: () => S.data && renderList() });
  u.exportBtn = menuButton({ id: 'cliExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz cały wynik wyszukiwania do pliku Excel lub CSV', items: () => {
    const tot = Math.min(S.data ? S.data.total : 0, EXPORT_MAX);
    const tip = 'Wszyscy klienci pasujący do wyszukiwania, nie tylko ta strona';
    return [{ label: 'Cały wynik — Excel (.xlsx)', count: tot, title: tip, run: () => exportAll('xlsx') }, { label: 'Cały wynik — CSV (.csv)', count: tot, title: tip, run: () => exportAll('csv') }];
  } });
  u.moreBtn = menuButton({ id: 'cliMore', label: 'Więcej', cls: 'secondary', title: 'Grupy klientów i funkcje dostępne tylko w panelu Selly', items: () => [
    { label: 'Grupy klientów', title: 'Lista grup z liczbą klientów i nazwami własnymi', run: () => go('/klienci/grupy') },
    { label: 'Importuj klientów z pliku CSV w Selly ↗', title: 'Import klientów z pliku jest dostępny tylko w panelu Selly', run: () => window.open(adminUrl() + '?a=klienci', '_blank', 'noopener') },
    { label: 'Eksport CSV w Selly ↗', title: 'Oryginalny eksport Selly (z polami, których panel nie pokazuje)', run: () => window.open(adminUrl() + '?a=klienci', '_blank', 'noopener') }] });
  u.addBtn = el('a', { write: 'klienci', href: '#/klienci/nowy', class: 'btn primary', id: 'cliAdd', title: 'Dodaj nowego klienta (konto w sklepie)' }, '+ Dodaj klienta');
  u.osa = osaBar({ prefix: 'cliOsa', withLicense: false, getQ: () => S.Q, apply: patch => setQ(patch), facets: () => S.facets });
  u.info = el('div', { class: 'muted small ord-info' });
  u.notice = el('div');
  u.results = el('div', { id: 'cliResults' });
  S.listBox = el('div', { class: 'ord-list' }, el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', null, 'Klienci'), el('div', { class: 'sub' }, 'Klienci sklepu (kopia odświeżana w tle). Kliknij klienta, aby zobaczyć dane, zamówienia i notatkę.')),
    el('div', { class: 'toolbar' }, u.search, u.filtersBtn, u.cols.node, u.exportBtn, u.moreBtn, u.addBtn, el('span', { class: 'spacer' }), u.info), u.osa.node, u.filters, u.notice, u.results));
  S.root.append(S.listBox);
}
function toggleFilters(force) {
  const u = S.ui, open = force != null ? force : u.filters.hidden;
  u.filters.hidden = !open;
  u.filtersBtn.setAttribute('aria-expanded', String(open));
  u.filtersBtn.textContent = 'Filtry' + (S.Q && advActive(S.Q) ? ' (' + advActive(S.Q) + ')' : '') + (open ? ' ▴' : ' ▾');
}
function syncFacets() {
  const u = S.ui, f = S.meta || {};
  const fill = (key, head, opts) => { const sel = u.adv[key].sel; if (sel.options.length === head.length + opts.length) return; sel.replaceChildren(...[...head, ...opts].map(([v, t]) => el('option', { value: v }, t))); sel.value = S.Q[key] || ''; };
  fill('group', [['', 'wszystkie'], ['none', 'bez grupy']], (f.groups || []).map(g => [String(g.id), (g.name || 'Grupa nr ' + g.id) + ' (' + g.count + ')']));
  fill('country', [['', 'wszystkie']], (f.countries || []).map(c => [c.name, c.name + ' (' + c.n + ')']));
}
function syncList() {
  const u = S.ui;
  if (u.search.value.trim() !== S.Q.q) u.search.value = S.Q.q;
  u.size.value = String(pageSize());
  u.osa.sync();
  syncFacets();
  for (const k of Object.keys(u.adv)) u.adv[k].sel.value = S.Q[k] || '';
  const extra = pageSize() !== 50 || advActive(S.Q) > 0;
  u.filtersBtn.classList.toggle('on', extra);
  if (extra && u.filters.hidden) toggleFilters(true); else toggleFilters(!u.filters.hidden);
}

async function loadList() {
  const my = ++S.seq, u = S.ui;
  S.err = '';
  if (!S.facets && !S.facetsLoading) { S.facetsLoading = true; api('clients:meta').then(m => { S.meta = m || {}; S.facets = (m && m.facets) || {}; if (S.ui.osa) { syncFacets(); S.ui.osa.sync(); }}).catch(() => {}).then(() => { S.facetsLoading = false; }); }
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
  { key: 'name', label: 'Nazwa', sort: 'name', locked: true, tip: 'Imię i nazwisko klienta oraz firma. Najedź na nazwę, aby zobaczyć notatkę klienta.' },
  { key: 'id', label: 'ID', sort: 'id', def: false, num: true, tip: 'Numer klienta w Selly' },
  { key: 'email', label: 'E-mail', sort: 'email', tip: 'Adres e-mail klienta (login w sklepie)' },
  { key: 'phone', label: 'Telefon', tip: 'Numer telefonu klienta' },
  { key: 'city', label: 'Miasto', sort: 'city', tip: 'Miasto z adresu wysyłki klienta' },
  { key: 'nip', label: 'NIP', def: false, tip: 'NIP z danych do faktury' },
  { key: 'group', label: 'Grupa', def: false, tip: 'Numer grupy klienta w Selly (nazwy własne grup: Więcej ▾ → Grupy klientów)' },
  { key: 'country', label: 'Państwo', def: false, tip: 'Państwo z adresu klienta' },
  { key: 'login', label: 'Ostatnie logowanie', sort: 'login', firstDir: 'desc', def: false, tip: 'Kiedy klient ostatnio zalogował się do sklepu' },
  { key: 'orders', label: 'Zamówień', sort: 'orders', num: true, tip: 'Liczba zamówień klienta w kopii zamówień panelu (dopasowanie po koncie klienta lub e-mailu)', tipHeader: true },
  { key: 'created', label: 'Utworzony', sort: 'created', firstDir: 'desc', tip: 'Data założenia konta klienta w sklepie' },
];
const groupLabel = r => { const g = ((S.meta && S.meta.groups) || []).find(x => String(x.id) === String(r.groupId)); return g && g.name ? g.name : (r.groupId && String(r.groupId) !== '0' ? 'nr ' + r.groupId : ''); };

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
  const cols = COLS.filter(c => u.cols.isOn(c.key));
  const head = el('tr', null, cols.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir }))));
  const body = el('tbody');
  const cell = (c, r) => {
    switch (c.key) {
      case 'name': return el('td', { title: r.notes ? 'Notatka: ' + r.notes : null },
        el('a', { href: '#/klienci/' + encodeURIComponent(r.id), class: 'cell-name', onclick: () => { S.listHash = location.hash; } }, r.name || r.email || ('Klient ' + r.id)),
        r.company ? el('div', { class: 'cell-sub' }, r.company) : null,
        r.clientType === 'SUBACCOUNT_CLIENT' ? el('span', { class: 'tag', title: 'Subkonto — konto podrzędne innego klienta' }, 'subkonto') : null,
        osaBadges(r, patch => setQ(patch), false, S.facets),
        r.notes ? el('div', { class: 'cell-sub cli-note' }, String(r.notes).length > 60 ? String(r.notes).slice(0, 60) + '…' : String(r.notes)) : null);
      case 'id': return el('td', { class: 'n nw' }, String(r.id));
      case 'email': return el('td', null, r.email || '');
      case 'phone': return el('td', { class: 'nw' }, r.phone || '');
      case 'city': return el('td', null, r.city || '');
      case 'nip': return el('td', { class: 'nw' }, r.nip || '');
      case 'group': return el('td', null, groupLabel(r));
      case 'country': return el('td', null, r.country || '');
      case 'login': return el('td', { class: 'nw' }, dayStr(r.lastLogin));
      case 'orders': return el('td', { class: 'n' }, String(r.orders == null ? 0 : r.orders));
      default: return el('td', { class: 'nw' }, dayStr(r.created));
    }
  };
  for (const r of d.rows) {
    body.append(el('tr', { class: 'pick', 'data-id': r.id, onclick: tapOpen(() => openClient(r.id)) }, cols.map(c => cell(c, r))));
  }
  const filtered = Q.q || osaActive(Q) || FILTERS.some(k => Q[k]);
  if (!d.rows.length) body.append(el('tr', null, el('td', { colspan: String(cols.length), class: 'empty' },
    filtered ? 'Brak klientów pasujących do wyszukiwania i filtrów.' : 'Brak klientów.', ' ',
    filtered ? el('button', { type: 'button', class: 'secondary', onclick: () => setQ({ q: '', ...OSA_CLEAR, ...FILTER_CLEAR }) }, 'Wyczyść filtry') : null)));
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
      columns: [{ header: 'ID', type: 'text' }, { header: 'Nazwa', type: 'text' }, { header: 'Firma', type: 'text' }, { header: 'NIP', type: 'text' }, { header: 'E-mail', type: 'text' }, { header: 'Telefon', type: 'text' },
        { header: 'Miasto', type: 'text' }, { header: 'Państwo', type: 'text' }, { header: 'Grupa', type: 'text' }, { header: 'Zamówień', type: 'number' }, { header: 'Utworzony', type: 'text' }, { header: 'Ostatnie logowanie', type: 'text' },
        { header: 'Notatka', type: 'text' },
        { header: 'Województwo', type: 'text' }, { header: 'Rodzaj podmiotu', type: 'text' }, { header: 'Tytuł orszaku', type: 'text' }, { header: 'Tagi', type: 'text' }],
      rows: rows.map(r => [r.id, r.name || '', r.company || '', r.nip || '', r.email || '', r.phone || '', r.city || '', r.country || '', groupLabel(r), Number(r.orders) || 0, dayStr(r.created), dayStr(r.lastLogin),
        r.notes || '', osaExport(r).woj, osaExport(r).kind, osaExport(r).title, osaExport(r).tags]),
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
  noteVisit({ t: 'client', id, label: fullName(c.first_name, c.last_name) || c.invoice_company || ('Klient ' + id) });   // bez e-maila w „Ostatnich”
  const stName = sid => { const s = (r.statuses || []).find(x => String(x.id) === String(sid)); return s ? s.name : (sid == null || sid === '' ? '—' : 'Status ' + sid); };

  // Notatka z edycją
  const noteHost = el('div', { id: 'cliNoteBox' });
  const showNote = () => noteHost.replaceChildren(
    c.notes ? el('p', { class: 'cli-note-text', id: 'cliNoteText' }, c.notes) : el('p', { class: 'muted', id: 'cliNoteText' }, 'Brak notatki.'),
    el('button', { type: 'button', class: 'secondary', write: 'klienci', id: 'cliNoteEdit', title: 'Edytuj notatkę klienta (zapisze się w Selly)', onclick: editNote }, 'Edytuj notatkę'));
  function editNote() {
    const ta = el('textarea', { id: 'cliNoteInput', rows: '5', maxlength: '5000', 'aria-label': 'Notatka klienta' });
    ta.value = c.notes || '';
    const msg = el('div', { role: 'status' });
    const save = el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'cliNoteSave', title: 'Zapisuje notatkę w Selly', onclick: async () => {
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

  const osaCard = el('div', { id: 'cliOsaCard' }), relHost = el('div'), blockHost = el('span', { id: 'cliBlockHost' });
  mountBlockToggle(blockHost, id, () => sellyLink('Blokada zamówień w Selly ↗', sellyClientUrl(id), 'Otwiera kartę klienta w Selly — tam ustawisz blokadę składania zamówień'));
  fillOsa(osaCard, id, my);
  box.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'ord-detail-top' },
        el('a', { href: S.listHash, class: 'btn-link', id: 'cliBack', title: 'Wróć do listy z zachowanym wyszukiwaniem i stroną' }, '← Wróć do listy'), el('span', { class: 'spacer' }),
        el('span', { class: 'muted small tip', title: 'Dane z kopii klientów synchronizowanej z Selly w tle' }, 'dane z: ' + syncedLabel(r.syncedMs)),
        el('a', { write: 'klienci', href: '#/klienci/' + encodeURIComponent(id) + '/edytuj', class: 'btn primary', id: 'cliEdit', title: 'Edytuj dane klienta (zapis do Selly)' }, 'Edytuj dane'),
        sellyLink('Otwórz w panelu Selly ↗', sellyClientUrl(id), 'Otwiera kartę klienta w panelu administracyjnym Selly'),
        blockHost),
      el('div', { class: 'card-head' }, el('h2', { id: 'cliTitle' }, name), el('div', { class: 'sub' }, 'ID ' + id)),),
    el('div', { class: 'ord-grid' },
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Dane kontaktowe')),
        dl([['E-mail', c.email ? el('a', { href: 'mailto:' + c.email }, c.email) : ''], ['Telefon', c.phone ? el('a', { href: 'tel:' + String(c.phone).replace(/[^\d+]/g, '') }, c.phone) : ''],
          ['Konto utworzone', dateStr(c.created_at)], ['Ostatnie logowanie', dateStr(c.last_login_at)], ['Newsletter', c.newsletter != null && c.newsletter !== '' ? (isOn(c.newsletter) ? 'tak' : 'nie') : '', 'Czy klient zapisał się na newsletter'],
          ['Grupa klienta', c.group_id != null && c.group_id !== '' && String(c.group_id) !== '0' ? el('span', { id: 'cliGroup' }, 'nr ' + c.group_id) : '', 'Grupa klienta w Selly (nazwa własna z panelu pojawi się po chwili; grupy: Więcej ▾ na liście)'],
          ['Poziom cen', c.price_level != null && c.price_level !== '' ? (Number(c.price_level) === 0 ? 'detaliczny' : 'rabaty — poziom ' + c.price_level) : '', 'Cennik stosowany wobec klienta'],
          ['Indywidualny rabat', Number(c.discount) > 0 ? String(c.discount).replace('.', ',') + '%' : '', 'Rabat procentowy klienta na zamówienia'],
          ['Opiekun (ID)', Number(c.salesperson_id) > 0 ? String(c.salesperson_id) : '', 'Numer pracownika opiekującego się klientem w Selly'],
          ['Rodzaj konta', c.client_type === 'SUBACCOUNT_CLIENT' ? 'subkonto' : '', 'Subkonto należy do konta głównego'],
          ['Zgody', [isOn(c.marketing_agree) ? 'marketingowa' : '', isOn(c.vat_ue) ? 'VAT UE' : ''].filter(Boolean).join(', '), 'Zgoda marketingowa i status klienta VAT UE']])),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Adresy')),
        dl([['Dane do faktury', addressBlock(c, 'invoice')], ['Adres wysyłki', addressBlock(c, 'ship')]]))),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Notatka'), el('div', { class: 'sub tip', title: 'W sklepie notatka klienta to zwykle opis orszaku: województwo, miejscowość itp. Zapis trafia do Selly.' }, 'Opis orszaku i uwagi — widoczne w panelu')), noteHost),
    osaCard, relHost, addressesFold(id, adminUrl()), pricesFold(id, adminUrl()), affiliateFold(id), sellyOnlyBlock(id, adminUrl()), ordersCard);
  fillExtra(id, my, relHost);
}

/** Subkonta / konto główne i nazwa grupy z kopii (jedno lekkie zapytanie, bez Selly). */
async function fillExtra(id, my, relHost) {
  let x = null;
  try { x = await api('clients:extra', { id }); } catch (e) { return; }
  if (my !== S.routeSeq || !x) return;
  const b = relatedBlock(x);
  if (b) relHost.replaceChildren(b);
  const g = document.getElementById('cliGroup');
  if (g && x.groupName) g.textContent = x.groupName;
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

// ─── Formularz: dodawanie i edycja ──────────────────────────────────────────

function dropGuard() { if (S.guard) { setLeaveGuard(null); S.guard = false; } }

async function renderForm(id) {
  const my = ++S.routeSeq, box = S.detailBox, creating = !id;
  box.replaceChildren(el('div', { class: 'card' }, loadingBox(creating ? 'Przygotowuję formularz…' : 'Pobieram klienta…')));
  let client = null, meta = S.meta;
  try {
    const [r, m] = await Promise.all([id ? api('clients:get', { id }) : null, meta ? meta : api('clients:meta').catch(() => ({}))]);
    client = r && r.client; meta = S.meta = m || {};
  } catch (e) {
    if (my !== S.routeSeq) return;
    box.replaceChildren(isUnavailable(e) ? unavailableBox() : el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się pobrać klienta: ' + (e.message || 'błąd'),
      el('div', null, el('a', { href: S.listHash, class: 'btn-link' }, '← Wróć do listy'), ' ', el('button', { type: 'button', class: 'secondary', onclick: () => renderForm(id) }, 'Spróbuj ponownie')))));
    return;
  }
  if (my !== S.routeSeq) return;
  const name = client ? (fullName(client.first_name, client.last_name) || client.invoice_company || client.email || ('Klient ' + id)) : '';
  const form = clientForm({ client, groups: (meta && meta.groups) || [], creating });
  const back = creating ? S.listHash : '#/klienci/' + encodeURIComponent(id);
  const msg = el('div', { role: 'alert', id: 'cliFormMsg' });
  let busy = false;
  const save = async () => {
    if (busy) return;
    msg.replaceChildren();
    if (!form.validate()) { msg.replaceChildren(el('div', { class: 'notice error' }, 'Popraw zaznaczone pola.')); return; }
    const changes = creating ? null : form.changed();
    if (!creating && !Object.keys(changes).length) { msg.replaceChildren(el('div', { class: 'notice warn' }, 'Nie zmieniono żadnego pola.')); return; }
    busy = true; for (const b of box.querySelectorAll('.kf-save')) b.disabled = true;
    try {
      if (creating) {
        const r = await api('clients:create', { fields: form.all(), password: form.password() || undefined });
        dropGuard(); S.data = null; flash('', r.generatedPassword ? 'Klient dodany. Hasło jest losowe — klient ustawi własne przez „Zapomniałem hasła” w sklepie.' : 'Klient dodany w Selly');
        go(r.id ? '/klienci/' + encodeURIComponent(r.id) : '/klienci');
      } else {
        await api('clients:save', { id, fields: changes });
        dropGuard(); S.data = null; flash('', 'Zmiany zapisane w Selly');
        go('/klienci/' + encodeURIComponent(id));
      }
    } catch (e) {
      busy = false; for (const b of box.querySelectorAll('.kf-save')) b.disabled = false;
      const dup = /ID (\d+)/.exec(e.message || '');
      msg.replaceChildren(el('div', { class: 'notice error' }, (e.message || 'Nie udało się zapisać.') + ' ', dup && /już istnieje/.test(e.message) ? el('a', { href: '#/klienci/' + dup[1], class: 'btn-link' }, 'Otwórz istniejącego klienta') : null));
    }
  };
  const actions = n => el('div', { class: 'ord-actions kf-actions' },
    el('button', { type: 'button', class: 'primary kf-save', write: 'klienci', id: 'cliFormSave' + n, title: creating ? 'Tworzy konto klienta w Selly' : 'Zapisuje tylko zmienione pola w Selly', onclick: save }, creating ? 'Dodaj klienta' : 'Zapisz zmiany'),
    el('a', { href: back, class: 'btn secondary', id: 'cliFormCancel' + n, title: 'Wróć bez zapisywania', onclick: () => dropGuard() }, 'Anuluj'));
  setLeaveGuard(h => (form.dirty() && !/^#\/klienci\/(nowy|\d+\/edytuj)/.test(h) ? 'Masz niezapisane zmiany klienta. Opuścić stronę bez zapisywania?' : null));
  S.guard = true;
  box.replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'ord-detail-top' }, el('a', { href: back, class: 'btn-link', id: 'cliBack', onclick: () => dropGuard() }, creating ? '← Wróć do listy' : '← Wróć do karty klienta'), el('span', { class: 'spacer' }),
      creating ? null : sellyLink('Edytuj w Selly ↗', sellyClientUrl(id), 'Otwiera kartę klienta w panelu Selly (np. dla pól, których panel nie edytuje)')),
    el('div', { class: 'card-head' }, el('h2', { id: 'cliTitle' }, creating ? 'Dodaj klienta' : 'Edycja: ' + name),
      el('div', { class: 'sub' }, creating ? 'Pola z gwiazdką są wymagane. Reszta jest w zwijanych sekcjach.' : 'Zapisują się tylko zmienione pola. Zaawansowane ustawienia są w zwijanych sekcjach.')), actions('')),
    form.node, el('div', { class: 'card' }, msg, actions('2')));
  const first = box.querySelector('#cf_first_name'); if (first && creating) first.focus();
}

// ─── Trasa ──────────────────────────────────────────────────────────────────

function mountRoute() {
  const route = S.route;
  if (!S.ui.search) buildList();
  registerListKeys({ screen: 'klienci', table: 'cliTable', filters: 'cliFiltersBtn', export: 'cliExport', search: 'cliSearch', cols: 'cliCols', back: 'cliBack',
    extra: [{ keys: ['n'], label: 'N', desc: 'Dodaj klienta', id: 'cliAdd' }, { keys: ['r'], label: 'R', desc: 'Edytuj dane klienta (na karcie)', id: 'cliEdit' }, { keys: ['b'], label: 'B', desc: 'Zablokuj lub odblokuj konto (na karcie)', id: 'cliBlockBtn' }] });
  S.listBox.hidden = !!route.id; S.detailBox.hidden = !route.id;
  dropGuard();
  if (route.id === 'grupy') { S.routeSeq++; renderGroups(S.detailBox, { sellyUrl: adminUrl(), back: S.listHash }); return; }
  if (route.id === 'nowy' || (route.id && route.sub === 'edytuj')) { renderForm(route.id === 'nowy' ? '' : route.id); return; }
  if (route.id) { renderDetail(route.id); return; }
  S.routeSeq++;
  S.Q = route.Q;
  S.listHash = location.hash || '#/klienci';
  loadList();
}

export default {
  id: 'klienci',
  title: 'Klienci',
  routes: ['', '<id>', '<id>/edytuj', 'nowy', 'grupy'],
  mount(el0, params) {
    applyBadgePrefs();
    if (!S.root) { S.root = el0; S.detailBox = el('div'); S.detailBox.hidden = true; el0.append(S.detailBox); }
    S.route = { id: (params && params.parts && params.parts[0]) || '', sub: (params && params.parts && params.parts[1]) || '', Q: readQ(params && params.query) };
    mountRoute();
  },
  unmount() { S.seq++; S.routeSeq++; dropGuard(); },
};
