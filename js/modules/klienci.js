// Moduł „Klienci”: lista z wyszukiwarką (#/klienci?q=..&page=..) i szczegóły (#/klienci/<id>).
// Dane i zapisy: backend Cloudflare (akcje clients:list, clients:get, clients:update — notatka klienta).
// Grupy (ekran, zmiana na karcie, masowo z listy) i limit zamówień: klienciGrupy.js; import CSV (#/klienci/import): klienciImport.js.
import { el, flash, menuButton, downloadXlsx, downloadCsv, tableMatrix, dateStr, fullName, isUnavailable, loadingBox, sellyLink, dl, syncedLabel, fetchAllRows } from '../core/ui.js?v=13a6ef5';
import { listView } from '../core/listView.js?v=13a6ef5';
import { api, ctx } from '../core/client.js?v=13a6ef5';
import { go, setLeaveGuard } from '../core/router.js?v=13a6ef5';
import { noteVisit } from '../core/recents.js?v=13a6ef5';
import { registerListKeys } from '../core/listKeys.js?v=13a6ef5';
import { clientForm } from './klienciForm.js?v=13a6ef5';
import { mountBlockToggle } from './klienciBlokada.js?v=13a6ef5';
import { addressesFold, pricesFold, affiliateFold, relatedBlock, sellyOnlyBlock } from './klienciExtra.js?v=13a6ef5';
import { renderGroups, cardGroup, limitFold, bulkGroupDialog, sellyGroups, mergeGroups, groupName } from './klienciGrupy.js?v=13a6ef5';
import { renderImport } from './klienciImport.js?v=13a6ef5';
import { OSA_CLEAR, readOsa, writeOsa, osaParams, osaActive, osaBar, osaBadges, osaExport, osaDetailPairs, applyBadgePrefs } from '../core/osa.js?v=13a6ef5';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
// Filtry z Selly (lista klientów): nazwy jak w parametrach akcji clients:list
const FILTERS = ['registered', 'nip', 'level', 'group', 'country', 'type', 'newsletter'];
const SIZES = [25, 50, 100, 200];
// Eksport czyta z bazy panelu (nie z Selly — nie zużywa limitu API); górna granica tylko jako bezpiecznik
const EXPORT_MAX = 50000;
const MSG_UNAVAILABLE = 'Moduł Klienci wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = { groupOpts: null, facets: null, meta: null, root: null, lv: null, ui: {}, detailBox: null, listHash: '#/klienci', routeSeq: 0, route: null };

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

// ─── Lista (wspólny komponent core/listView.js) ─────────────────────────────

/** Parametry clients:list ze stanu listy (filtry z Selly płasko, jak w akcji). */
const listParams = (st, extra) => Object.assign({ sort: st.sort, dir: st.dir, pageSize: st.size, page: st.page }, st.q ? { q: st.q } : {}, osaParams(st),
  Object.fromEntries(FILTERS.filter(k => st.filters[k]).map(k => [k, st.filters[k]])), extra);

const COLS = [
  { key: 'name', label: 'Nazwa', sort: true, locked: true, tip: 'Imię i nazwisko klienta oraz firma. Najedź na nazwę, aby zobaczyć notatkę klienta.', tipHeader: false, cell: r => el('td', { title: r.notes ? 'Notatka: ' + r.notes : null },
    el('a', { href: '#/klienci/' + encodeURIComponent(r.id), class: 'cell-name', onclick: () => { S.listHash = location.hash; } }, r.name || r.email || ('Klient ' + r.id)),
    r.company ? el('div', { class: 'cell-sub' }, r.company) : null,
    r.clientType === 'SUBACCOUNT_CLIENT' ? el('span', { class: 'tag', title: 'Subkonto — konto podrzędne innego klienta' }, 'subkonto') : null,
    osaBadges(r, patch => S.lv.set(patch), false, S.facets),
    r.notes ? el('div', { class: 'cell-sub cli-note' }, String(r.notes).length > 60 ? String(r.notes).slice(0, 60) + '…' : String(r.notes)) : null) },
  { key: 'id', label: 'ID', sort: true, def: false, num: true, cls: 'nw', tip: 'Numer klienta w Selly', tipHeader: false },
  { key: 'email', label: 'E-mail', sort: true, tip: 'Adres e-mail klienta (login w sklepie)', tipHeader: false },
  { key: 'phone', label: 'Telefon', cls: 'nw', tip: 'Numer telefonu klienta', tipHeader: false },
  { key: 'city', label: 'Miasto', sort: true, tip: 'Miasto z adresu wysyłki klienta', tipHeader: false },
  { key: 'nip', label: 'NIP', def: false, cls: 'nw', tip: 'NIP z danych do faktury', tipHeader: false },
  { key: 'group', label: 'Grupa', def: false, tip: 'Grupa klienta (nazwa z Selly albo nazwa własna panelu; grupy: Więcej ▾ → Grupy klientów)', tipHeader: false, cell: r => groupLabel(r) },
  { key: 'country', label: 'Państwo', def: false, tip: 'Państwo z adresu klienta', tipHeader: false },
  { key: 'login', label: 'Ostatnie logowanie', sort: true, firstDir: 'desc', def: false, cls: 'nw', tip: 'Kiedy klient ostatnio zalogował się do sklepu', tipHeader: false, cell: r => dayStr(r.lastLogin) },
  { key: 'orders', label: 'Zamówień', sort: true, num: true, tip: 'Liczba zamówień klienta w kopii zamówień panelu (dopasowanie po koncie klienta lub e-mailu)', cell: r => String(r.orders == null ? 0 : r.orders) },
  { key: 'created', label: 'Utworzony', sort: true, firstDir: 'desc', cls: 'nw', tip: 'Data założenia konta klienta w sklepie', tipHeader: false, cell: r => dayStr(r.created) },
];
// Filtry z Selly; pierwsza opcja („wszyscy”, „bez ograniczeń”) = brak filtra
const fsel = (key, label, tip, options) => ({ key, label, tip, options, id: 'cliF_' + key, all: false });
const FILTER_DEFS = [
  fsel('registered', 'Rejestracja', 'Klient zarejestrowany ma konto z loginem w sklepie; niezarejestrowany to dane z zamówienia gościa', [['', 'wszyscy'], ['yes', 'zarejestrowani'], ['no', 'niezarejestrowani']]),
  fsel('nip', 'NIP', 'Czy klient ma wpisany NIP w danych do faktury', [['', 'bez ograniczeń'], ['yes', 'z NIP'], ['no', 'bez NIP']]),
  fsel('level', 'Poziom cen', 'Który cennik stosuje sklep wobec klienta; „z indywidualnym rabatem” = rabat procentowy większy od zera', [['', 'wszystkie'], ['0', 'detaliczny'], ['1', 'rabaty — poziom 1'], ['2', 'rabaty — poziom 2'], ['3', 'rabaty — poziom 3'], ['custom', 'z indywidualnym rabatem']]),
  fsel('group', 'Grupa', 'Grupa klientów w Selly (liczba w nawiasie = klientów w grupie)', [['', 'wszystkie']]),
  fsel('country', 'Państwo', 'Państwo z adresu klienta', [['', 'wszystkie']]),
  fsel('type', 'Rodzaj konta', 'Konto podstawowe albo subkonto (podrzędne konto firmy)', [['', 'wszystkie'], ['CLIENT', 'konta podstawowe'], ['SUBACCOUNT_CLIENT', 'subkonta']]),
  fsel('newsletter', 'Newsletter', 'Czy klient zapisał się na newsletter', [['', 'bez ograniczeń'], ['yes', 'zapisani'], ['no', 'niezapisani']]),
];
const groupOpts = () => mergeGroups((S.meta && S.meta.groups) || [], S.groupOpts || []);
const groupLabel = r => (r.groupId && String(r.groupId) !== '0' ? groupName(groupOpts(), r.groupId) : '');
/** Nazwy grup z Selly (natywna lista, raz na 5 min) — do kolumny „Grupa” i menu „Przypisz do grupy”. Błąd = zostają numery / nazwy własne. */
function loadGroupOpts() {
  if (S.groupOptsLoading || S.groupOpts) return;
  S.groupOptsLoading = true;
  sellyGroups().then(r => { S.groupOpts = r.ok ? r.groups : []; if (S.lv && S.lv.data && !S.lv.node.hidden) S.lv.render(); }).finally(() => { S.groupOptsLoading = false; });
}
function syncFacets() {
  const f = S.meta || {};
  S.lv.setOptions('group', [['', 'wszystkie'], ['none', 'bez grupy'], ...(f.groups || []).map(g => [String(g.id), (g.name || 'Grupa nr ' + g.id) + ' (' + g.count + ')'])]);
  S.lv.setOptions('country', [['', 'wszystkie'], ...(f.countries || []).map(c => [c.name, c.name + ' (' + c.n + ')'])]);
}
function loadMeta() {
  if (S.facets || S.facetsLoading) return;
  S.facetsLoading = true;
  api('clients:meta').then(m => { S.meta = m || {}; S.facets = (m && m.facets) || {}; syncFacets(); S.ui.osa.sync(); }).catch(() => {}).then(() => { S.facetsLoading = false; });
}

/** Pasek zaznaczenia: przypisanie do grupy (podgląd → potwierdzenie → zapis po kolei, klienciGrupy.js). */
function bulkActions(rows) {
  const u = S.ui;
  const picked = () => rows.map(r => ({ id: String(r.id), name: r.name || r.email || 'Klient ' + r.id, groupId: r.groupId }));
  const start = (id, name) => bulkGroupDialog(u.dlg, picked(), { id, name }, { groups: groupOpts(), onDone: ids => { for (const x of ids) S.lv.selection.delete(x); S.lv.reload(); } });
  return [
    el('a', { href: '#/klienci/grupy', class: 'btn-link', title: 'Brakuje grupy? Utwórz ją na ekranie „Grupy klientów”' }, 'Nowa grupa…'),
    menuButton({ id: 'cliGroupMenu', label: 'Przypisz do grupy', cls: 'primary', write: 'klienci', title: 'Ustaw grupę wszystkim zaznaczonym klientom (najpierw pokażemy podgląd zmiany do potwierdzenia)',
      items: () => [...groupOpts().map(g => ({ label: g.name, count: g.count || null, title: 'Przypisz zaznaczonych klientów do grupy „' + g.name + '”', run: () => start(g.id, g.name) })),
        { label: 'Usuń z grupy (bez grupy)', title: 'Zaznaczeni klienci nie będą należeć do żadnej grupy', run: () => start('0', 'bez grupy') }] })];
}

function buildList() {
  const u = S.ui;
  u.exportBtn = menuButton({ id: 'cliExport', label: 'Eksport', cls: 'secondary', title: 'Pobierz cały wynik wyszukiwania do pliku Excel lub CSV', items: () => {
    const tot = Math.min(S.lv.data ? S.lv.data.total : 0, EXPORT_MAX);
    const tip = 'Wszyscy klienci pasujący do wyszukiwania, nie tylko ta strona';
    return [{ label: 'Cały wynik — Excel (.xlsx)', count: tot, title: tip, run: () => exportAll('xlsx') }, { label: 'Cały wynik — CSV (.csv)', count: tot, title: tip, run: () => exportAll('csv') }];
  } });
  u.moreBtn = menuButton({ id: 'cliMore', label: 'Więcej', cls: 'secondary', title: 'Grupy klientów, import z pliku CSV i funkcje dostępne tylko w panelu Selly', items: () => [
    { label: 'Grupy klientów', title: 'Grupy z Selly: nazwy, liczba klientów, dodawanie nowej grupy', run: () => go('/klienci/grupy') },
    { label: 'Importuj klientów z pliku CSV', title: 'Plik czytany w przeglądarce → sprawdzenie bez zapisu (błędy, duplikaty) → dodanie po potwierdzeniu', run: () => go('/klienci/import') },
    { label: 'Import CSV w Selly ↗', title: 'Oryginalny import Selly (inny układ pliku, bez podglądu przed zapisem)', run: () => window.open(adminUrl() + '?a=klienci', '_blank', 'noopener') },
    { label: 'Eksport CSV w Selly ↗', title: 'Oryginalny eksport Selly (z polami, których panel nie pokazuje)', run: () => window.open(adminUrl() + '?a=klienci', '_blank', 'noopener') }] });
  u.addBtn = el('a', { write: 'klienci', href: '#/klienci/nowy', class: 'btn primary', id: 'cliAdd', title: 'Dodaj nowego klienta (konto w sklepie)' }, '+ Dodaj klienta');
  u.osa = osaBar({ prefix: 'cliOsa', withLicense: false, getQ: () => S.lv.state, apply: patch => S.lv.set(patch), facets: () => S.facets });
  u.info = el('div', { class: 'muted small ord-info' });
  u.dlg = el('div', { id: 'cliDlg' });
  const sellyList = () => sellyLink('Panel Selly ↗', adminUrl() + '?a=klienci', 'Otwiera listę klientów w panelu Selly w nowej karcie');
  S.lv = listView({
    id: 'cli', route: '/klienci', title: 'Klienci', storeKey: 'klienci',
    intro: [el('div', { class: 'sub' }, 'Klienci sklepu (kopia odświeżana w tle). Kliknij klienta, aby zobaczyć dane, zamówienia i notatkę.')],
    columns: COLS, columnsStore: 'osa-cli-cols', defaultSort: { key: 'created', dir: 'desc' }, sizes: SIZES, defaultSize: 50, sizeStore: 'osa-cli-size',
    search: { placeholder: 'Szukaj: nazwisko, e-mail, telefon, firma, miasto, NIP, notatka', label: 'Szukaj klientów', tip: 'Szuka w nazwie, e-mailu, telefonie, firmie, mieście wysyłki, NIP, notatce klienta i numerze ID' },
    filters: FILTER_DEFS, filtersTip: 'Dodatkowe filtry: rejestracja, NIP, poziom cen, grupa, kraj, rodzaj konta, newsletter',
    extra: { read: readOsa, write: writeOsa, clear: OSA_CLEAR, active: osaActive },
    actions: [u.exportBtn, u.moreBtn, u.addBtn], info: u.info, top: [u.osa.node, u.dlg],
    noun: ['klient', 'klienci', 'klientów'], loadingText: 'Pobieram klientów…', errorText: 'Nie udało się pobrać klientów',
    emptyFiltered: 'Brak klientów pasujących do wyszukiwania i filtrów.', empty: 'Brak klientów.',
    errorBox: (e, retry) => (isUnavailable(e) ? el('div', { class: 'empty error' }, MSG_UNAVAILABLE, ' ', sellyList(),
      el('div', null, el('button', { type: 'button', class: 'secondary', id: 'cliRetry', onclick: retry }, 'Spróbuj ponownie'))) : null),
    errorExtra: sellyList,
    load: st => api('clients:list', listParams(st)),
    onSync: () => { u.osa.sync(); if (S.meta) syncFacets(); },
    onData: d => u.info.replaceChildren(el('span', { class: 'tip', title: 'Lista pochodzi z kopii klientów synchronizowanej z Selly w tle — najświeższe zmiany mogą pojawić się z opóźnieniem.' }, 'dane z: ' + syncedLabel(d.syncedMs))),
    above: d => (d.loading ? el('div', { class: 'notice warn', id: 'cliLoading', role: 'status' }, 'Trwa pierwsze pobieranie klientów ze sklepu — lista może być niepełna. Odśwież stronę za chwilę.') : null),
    open: r => openClient(r.id),
    select: { noun: ['klienta', 'klientów', 'klientów'], label: r => 'klienta ' + (r.name || r.id), actions: bulkActions, onClear: () => u.dlg.replaceChildren() },
  });
  S.lv.node.classList.add('ord-list');
  S.root.append(S.lv.node);
}
function openClient(id) { S.listHash = location.hash; go('/klienci/' + encodeURIComponent(id)); }

async function exportAll(kind) {
  try {
    const { rows, total } = await fetchAllRows(page => api('clients:list', listParams(S.lv.state, { page, pageSize: 200 })), EXPORT_MAX, 'klientów');
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
      try { await api('clients:update', { id, notes: ta.value }); flash('', 'Notatka zapisana w Selly'); renderDetail(id); }
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
          ['Grupa klienta', cardGroup(id, c.group_id, { meta: (S.meta && S.meta.groups) || [], onSaved: () => { S.groupOpts = null; renderDetail(id); } }), 'Grupa klienta w Selly — „Zmień” przypisuje klienta do innej grupy (zapis w Selly). Nowe grupy: Więcej ▾ → Grupy klientów'],
          ['Poziom cen', c.price_level != null && c.price_level !== '' ? (Number(c.price_level) === 0 ? 'detaliczny' : 'rabaty — poziom ' + c.price_level) : '', 'Cennik stosowany wobec klienta'],
          ['Indywidualny rabat', Number(c.discount) > 0 ? String(c.discount).replace('.', ',') + '%' : '', 'Rabat procentowy klienta na zamówienia'],
          ['Opiekun (ID)', Number(c.salesperson_id) > 0 ? String(c.salesperson_id) : '', 'Numer pracownika opiekującego się klientem w Selly'],
          ['Rodzaj konta', c.client_type === 'SUBACCOUNT_CLIENT' ? 'subkonto' : '', 'Subkonto należy do konta głównego'],
          ['Zgody', [isOn(c.marketing_agree) ? 'marketingowa' : '', isOn(c.vat_ue) ? 'VAT UE' : ''].filter(Boolean).join(', '), 'Zgoda marketingowa i status klienta VAT UE']])),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Adresy')),
        dl([['Dane do faktury', addressBlock(c, 'invoice')], ['Adres wysyłki', addressBlock(c, 'ship')]]))),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Notatka'), el('div', { class: 'sub tip', title: 'W sklepie notatka klienta to zwykle opis orszaku: województwo, miejscowość itp. Zapis trafia do Selly.' }, 'Opis orszaku i uwagi — widoczne w panelu')), noteHost),
    osaCard, relHost, addressesFold(id, adminUrl()), pricesFold(id, adminUrl()), limitFold(id, adminUrl()), affiliateFold(id), sellyOnlyBlock(id, adminUrl()), ordersCard);
  fillExtra(id, my, relHost);
}

/** Subkonta / konto główne i nazwa grupy z kopii (jedno lekkie zapytanie, bez Selly). */
async function fillExtra(id, my, relHost) {
  let x = null;
  try { x = await api('clients:extra', { id }); } catch (e) { return; }
  if (my !== S.routeSeq || !x) return;
  const b = relatedBlock(x);
  if (b) relHost.replaceChildren(b);
  const gb = document.getElementById('cliGroupBox');
  if (gb && gb.update && x.groups) gb.update(x.groups);
}

/** Sekcja „Orszak (z notatki)”: pola wyliczone z notatki (wiersz listy klientów, wyszukany po ID). */
async function fillOsa(host, id, my) {
  let row = S.lv && S.lv.data && (S.lv.data.rows || []).find(x => String(x.id) === String(id));
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
    if (!creating && !Object.keys(changes).length) { msg.replaceChildren(el('div', { class: 'notice info', role: 'status' }, 'Nie zmieniono żadnego pola — nie ma czego zapisywać.')); return; }
    busy = true; for (const b of box.querySelectorAll('.kf-save')) b.disabled = true;
    try {
      if (creating) {
        const r = await api('clients:create', { fields: form.all(), password: form.password() || undefined });
        dropGuard(); flash('', r.generatedPassword ? 'Klient dodany. Hasło jest losowe — klient ustawi własne przez „Zapomniałem hasła” w sklepie.' : 'Klient dodany w Selly');
        go(r.id ? '/klienci/' + encodeURIComponent(r.id) : '/klienci');
      } else {
        await api('clients:save', { id, fields: changes });
        dropGuard(); flash('', 'Zmiany zapisane w Selly');
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
  if (!S.lv) buildList();
  registerListKeys({ screen: 'klienci', table: 'cliTable', filters: 'cliFiltersBtn', export: 'cliExport', search: 'cliSearch', cols: 'cliCols', back: 'cliBack',
    extra: [{ keys: ['n'], label: 'N', desc: 'Dodaj klienta', id: 'cliAdd' }, { keys: ['r'], label: 'R', desc: 'Edytuj dane klienta (na karcie)', id: 'cliEdit' }, { keys: ['b'], label: 'B', desc: 'Zablokuj lub odblokuj konto (na karcie)', id: 'cliBlockBtn' }] });
  S.lv.node.hidden = !!route.id; S.detailBox.hidden = !route.id;
  dropGuard();
  if (route.id === 'grupy') { const my = ++S.routeSeq; renderGroups(S.detailBox, { sellyUrl: adminUrl(), back: S.listHash, isCurrent: () => my === S.routeSeq }); return; }
  if (route.id === 'import') {
    const my = ++S.routeSeq;
    const meta = S.meta ? Promise.resolve(S.meta) : api('clients:meta').then(m => (S.meta = m || {})).catch(() => ({}));
    meta.then(m => { if (my === S.routeSeq) renderImport(S.detailBox, { back: S.listHash, meta: m, isCurrent: () => my === S.routeSeq }); });
    return;
  }
  if (route.id === 'nowy' || (route.id && route.sub === 'edytuj')) { renderForm(route.id === 'nowy' ? '' : route.id); return; }
  if (route.id) { renderDetail(route.id); return; }
  S.routeSeq++;
  S.listHash = location.hash || '#/klienci';
  loadMeta(); loadGroupOpts();
  S.lv.mount(route.query);
}

export default {
  id: 'klienci',
  title: 'Klienci',
  routes: ['', '<id>', '<id>/edytuj', 'nowy', 'grupy', 'import'],
  mount(el0, params) {
    applyBadgePrefs();
    if (!S.root) { S.root = el0; S.detailBox = el('div'); S.detailBox.hidden = true; el0.append(S.detailBox); }
    S.route = { id: (params && params.parts && params.parts[0]) || '', sub: (params && params.parts && params.parts[1]) || '', query: params && params.query };
    mountRoute();
  },
  unmount() { if (S.lv) S.lv.stop(); S.routeSeq++; dropGuard(); },
};
