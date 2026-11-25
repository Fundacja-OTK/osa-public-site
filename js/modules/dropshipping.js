// Moduł „Dropshipping”: paczki dropshipping i produkty w paczkach (Selly REST API /api/dropshipping/packages…).
// Lista paczek (filtr dat utworzenia, status, sortowanie, strony) → karta paczki (edycja danych, zmiana statusu, produkty: dodawanie,
// zmiana ilości i magazynu, usuwanie) → nowa paczka (#/dropshipping/nowa). Backend: dropshipping:* (Worker, token READWRITE do zapisów).
import { el, cnt, isUnavailable, loadingBox, pageToolbar, flash, dateStr, norm, statusPill, field, dateInput } from '../core/ui.js?v=2a82ee9';
import { confirmDialog as coreConfirm } from '../core/confirm.js?v=2a82ee9';
import { listView } from '../core/listView.js?v=2a82ee9';
import { sortRows } from '../core/listLogic.js?v=2a82ee9';
import { api } from '../core/client.js?v=2a82ee9';
import { go } from '../core/router.js?v=2a82ee9';
import { registerListKeys } from '../core/listKeys.js?v=2a82ee9';

const STATUS = {
  '-1': { label: 'skasowana', tone: 'bad', tip: 'Paczka skasowana / ignorowana — nie jest brana pod uwagę.' },
  '0': { label: 'wstępna', tone: 'warn', tip: 'Paczka wstępna — jeszcze nie zatwierdzona ani wysłana; można ją swobodnie zmieniać.' },
  '1': { label: 'zatwierdzona / wysłana', tone: 'ok', tip: 'Paczka zatwierdzona i wysłana do dostawcy.' },
};
const pill = id => { const s = STATUS[String(id)]; return statusPill(s ? s.label : 'status ' + id, s ? s.tone : 'neutral', s ? s.tip : 'Nieznany status paczki'); };
const opId = () => 'ds-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const MSG_UNAVAILABLE = 'Dropshipping wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';

const S = { root: null, seq: 0, route: '', card: null, err: '' };
const $ = id => document.getElementById(id);
const fail = (e, what) => { flash(null, (what || 'Nie udało się') + ': ' + (e && e.message ? e.message : e)); };

function errorBox(e) {
  return el('div', { class: 'card' }, el('div', { class: 'empty error', id: 'dsError' }, isUnavailable(e) ? MSG_UNAVAILABLE : 'Nie udało się wczytać: ' + (e.message || e), ' ',
    el('button', { type: 'button', class: 'secondary', onclick: () => mountRoute() }, 'Spróbuj ponownie')));
}

// ─── Lista paczek (wspólny komponent core/listView.js) ───────────────────────
// Selly zwraca strony paczek (filtr dat utworzenia po stronie API); status, szukanie i sortowanie działają na wczytanej stronie.
const PAGE = 50;
const SORT = { id: p => Number(p.id), name: p => norm(p.package_name), status: p => Number(p.status_id), sent: p => p.sent_date || '', created: p => p.created_at || '' };
let cache = null;   // ostatnia strona z API: zmiana statusu / szukania / sortowania nie pobiera jej ponownie
const lv = listView({
  id: 'ds', route: '/dropshipping', storeKey: 'dropshipping', noun: ['paczka', 'paczki', 'paczek'], loadingText: 'Wczytuję paczki…',
  columns: [
    { key: 'id', label: 'ID', sort: true, num: true, tip: 'Numer paczki w Selly', cell: p => String(p.id) },
    { key: 'name', label: 'Nazwa', sort: true, tip: 'Nazwa paczki dropshipping', cell: p => el('a', { href: '#/dropshipping/' + p.id, class: 'cell-name' }, p.package_name || '(bez nazwy)') },
    { key: 'status', label: 'Status', sort: true, tip: 'Wstępna → zatwierdzona / wysłana; skasowana = ignorowana', cell: p => pill(p.status_id) },
    { key: 'sent', label: 'Data wysyłki', sort: true, firstDir: 'desc', tip: 'Data, kiedy paczka została (lub ma zostać) wysłana do dostawcy', cell: p => (p.sent_date ? dateStr(p.sent_date).slice(0, 10) : '—') },
    { key: 'created', label: 'Utworzona', sort: true, firstDir: 'desc', tip: 'Kiedy paczkę utworzono', cell: p => dateStr(p.created_at) || '—' },
    { key: 'desc', label: 'Opis', tip: 'Opis paczki (pierwsze znaki)', cell: p => el('td', { class: 'ds-desc', title: p.package_description || null }, (p.package_description || '').slice(0, 80)) },
  ],
  defaultSort: { key: 'created', dir: 'desc' }, sizes: [PAGE], defaultSize: PAGE,
  search: { placeholder: 'Szukaj na stronie: nazwa lub opis', label: 'Szukaj na stronie', tip: 'Filtruje paczki widoczne na tej stronie wyników po nazwie, opisie i numerze' },
  filters: [
    { key: 'status', label: 'Status', tip: 'Pokaż tylko paczki w wybranym statusie (na tej stronie wyników)', options: Object.entries(STATUS).map(([k, s]) => [k, s.label]), all: 'wszystkie' },
    { key: 'from', label: 'Utworzona od', type: 'date', id: 'dsFrom', tip: 'Pokaż paczki utworzone od tego dnia' },
    { key: 'to', label: 'Utworzona do', type: 'date', id: 'dsTo', tip: 'Pokaż paczki utworzone do tego dnia (włącznie)' },
  ],
  load: async st => {
    const key = [st.page, st.filters.from || '', st.filters.to || ''].join('|');
    if (cache && cache.key === key) return cache.d;
    const r = await api('dropshipping:list', { page: st.page, limit: PAGE, from: st.filters.from || undefined, to: st.filters.to || undefined });
    const rows = r.rows || [], meta = r.meta || {};
    const d = { rows, total: Math.max(Number(meta.total_count) || 0, rows.length), pageSize: PAGE };
    cache = { key, d };
    return d;
  },
  view: rows => {
    const st = lv.state, q = norm(st.q || '');
    const out = rows.filter(p => (!st.filters.status || String(p.status_id) === st.filters.status) && (!q || norm([p.package_name, p.package_description, p.id].join(' ')).includes(q)));
    const key = SORT[st.sort];
    return key ? sortRows(out, { value: key, dir: st.dir }) : out;
  },
  open: p => go('dropshipping/' + p.id),
  empty: 'Brak paczek w wybranym okresie.', emptyFiltered: 'Żadna paczka nie pasuje do filtra.',
  errorBox: (e, retry) => el('div', { class: 'empty error', id: 'dsError' }, isUnavailable(e) ? MSG_UNAVAILABLE : 'Nie udało się wczytać: ' + (e.message || e), ' ',
    el('button', { type: 'button', class: 'secondary', onclick: () => { cache = null; retry(); } }, 'Spróbuj ponownie')),
});

// ─── Karta paczki ───────────────────────────────────────────────────────
async function loadCard(id) {
  const my = ++S.seq;
  $('dsBody').replaceChildren(el('div', { class: 'card' }, loadingBox('Wczytuję paczkę…')));
  try { const r = await api('dropshipping:get', { id }); if (my !== S.seq) return; S.card = r; paintCard(); }
  catch (e) { if (my === S.seq) $('dsBody').replaceChildren(errorBox(e)); }
}

function packageForm(pk, isNew) {
  const f = { package_name: pk.package_name || '', package_description: pk.package_description || '', sent_date: pk.sent_date ? String(pk.sent_date).slice(0, 10) : '', status_id: String(pk.status_id == null ? '0' : pk.status_id) };
  const save = async () => {
    if (!f.package_name.trim()) { flash(null, 'Podaj nazwę paczki.'); return; }
    const b = $('dsSave'); b.disabled = true;
    try {
      const fields = isNew ? { ...f } : Object.fromEntries(Object.entries(f).filter(([k, v]) => String(v) !== String(k === 'sent_date' ? (pk.sent_date ? String(pk.sent_date).slice(0, 10) : '') : pk[k] == null ? '' : pk[k])));
      if (!isNew && !Object.keys(fields).length) { flash(null, 'Nic nie zmieniono.'); b.disabled = false; return; }
      const r = await api('dropshipping:save', { id: isNew ? undefined : pk.id, fields, opId: opId() });
      flash(null, isNew ? 'Paczka utworzona.' : 'Zapisano zmiany.');
      if (isNew) { const nid = r.package && r.package.id; go(nid ? 'dropshipping/' + nid : 'dropshipping'); } else loadCard(pk.id);
    } catch (e) { b.disabled = false; fail(e, 'Nie zapisano'); }
  };
  return el('div', { class: 'ds-form', id: 'dsForm' },
    field('Nazwa paczki', el('input', { type: 'text', id: 'dsName', value: f.package_name, maxlength: '200', oninput: ev => { f.package_name = ev.target.value; } }), 'Nazwa, pod którą paczka jest widoczna w Selly (wymagana)'),
    field('Status', el('select', { id: 'dsStatus', onchange: ev => { f.status_id = ev.target.value; } }, Object.entries(STATUS).map(([k, s]) => el('option', { value: k, selected: k === f.status_id, title: s.tip }, s.label))),
      'Wstępna = w przygotowaniu; zatwierdzona / wysłana = gotowa; skasowana = ignorowana'),
    field('Data wysyłki', dateInput({ id: 'dsSent', value: f.sent_date, label: 'Data wysyłki', title: 'Kiedy paczka została lub zostanie wysłana do dostawcy (może być pusta)', onChange: v => { f.sent_date = v; } }), 'Kiedy paczka została lub zostanie wysłana do dostawcy (może być pusta)'),
    field('Opis', el('textarea', { id: 'dsDesc', rows: '3', maxlength: '2000', oninput: ev => { f.package_description = ev.target.value; } }, f.package_description), 'Notatka do paczki — widoczna w Selly (maks. 2000 znaków)'),
    el('div', { class: 'bm-row' }, el('button', { type: 'button', class: 'primary', write: 'dropshipping', id: 'dsSave', onclick: save }, isNew ? 'Utwórz paczkę' : 'Zapisz zmiany'),
      el('a', { class: 'btn-secondary', id: 'dsCancel', href: '#/dropshipping' }, isNew ? 'Anuluj' : 'Wróć do listy')));
}

function confirmDialog({ id, title, text, ok, onOk }) {
  return coreConfirm({ id, title, body: text, confirmLabel: ok, danger: true, focus: 'cancel' }).then(yes => { if (yes) onOk(); });
}

function paintCard() {
  const C = S.card, pk = C.package;
  if (!pk) { $('dsBody').replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie znaleziono paczki.'))); return; }
  const whName = id => ((C.warehouses || []).find(w => String(w.id) === String(id)) || {}).name || (id ? 'magazyn ' + id : '—');
  const editable = String(pk.status_id) !== '-1';
  const prodRows = C.products.map(p => {
    const qty = el('input', { type: 'number', min: '1', max: '100000', class: 'ds-qty', value: String(p.quantity_ordered), 'aria-label': 'Ilość zamówiona', title: 'Ilość zamówiona u dostawcy. Po zmianie kliknij „Zapisz” przy wierszu.' });
    const wh = el('select', { class: 'ds-wh', 'aria-label': 'Magazyn', title: 'Magazyn, do którego trafi towar z paczki' }, el('option', { value: '0' }, '— brak —'), (C.warehouses || []).map(w => el('option', { value: String(w.id), selected: String(w.id) === String(p.warehouse_id) }, w.name)));
    const sv = el('button', { type: 'button', class: 'secondary small-btn', write: 'dropshipping', title: 'Zapisz ilość i magazyn tej pozycji', onclick: async () => {
      try { await api('dropshipping:productSave', { packageId: pk.id, id: p.id, fields: { quantity_ordered: Number(qty.value), warehouse_id: Number(wh.value) }, opId: opId() }); flash(null, 'Zapisano pozycję.'); loadCard(pk.id); } catch (e) { fail(e, 'Nie zapisano'); } } }, 'Zapisz');
    const del = el('button', { type: 'button', class: 'secondary danger small-btn', write: 'dropshipping', title: 'Usuń produkt z tej paczki (produkt w sklepie zostaje)', onclick: () => confirmDialog({ id: 'dsDelProd', title: 'Usunąć produkt z paczki?', text: (p.name || 'Produkt ' + p.product_id) + ' zniknie z tej paczki. Sam produkt w sklepie zostaje.', ok: 'Usuń z paczki',
      onOk: async () => { try { await api('dropshipping:productDelete', { packageId: pk.id, id: p.id, opId: opId() }); flash(null, 'Usunięto z paczki.'); loadCard(pk.id); } catch (e) { fail(e, 'Nie usunięto'); } } }) }, 'Usuń');
    return el('tr', { 'data-pid': String(p.id) }, el('td', null, p.name ? el('a', { href: '#/produkty/' + p.product_id, title: 'Otwórz kartę produktu' }, p.name) : el('span', { class: 'muted', title: 'Produktu nie ma jeszcze w kopii panelu (pojawi się po najbliższej synchronizacji z Selly)' }, 'produkt ' + p.product_id)),
      el('td', null, p.code || '—'), el('td', null, qty), el('td', null, wh), el('td', { class: 'ds-act' }, sv, ' ', del));
  });
  $('dsBody').replaceChildren(
    el('section', { class: 'card', id: 'dsCard' }, el('h2', null, pk.package_name || 'Paczka ' + pk.id, ' ', pill(pk.status_id)),
      el('p', { class: 'muted' }, 'Paczka nr ' + pk.id + (pk.created_at ? ' · utworzona ' + dateStr(pk.created_at) : '') + (pk.sent_date ? ' · wysyłka ' + String(pk.sent_date).slice(0, 10) : '')),
      packageForm(pk, false),
      el('details', { class: 'bm-opts', id: 'dsDanger' }, el('summary', { title: 'Operacje, których nie da się cofnąć' }, 'Więcej opcji'),
        el('p', { class: 'muted wp-hint' }, 'Usunięcie paczki kasuje ją w Selly razem z listą produktów. Jeśli paczka ma tylko przestać się liczyć, zmień jej status na „skasowana”.'),
        el('button', { type: 'button', class: 'secondary danger', write: 'dropshipping', id: 'dsDelete', title: 'Trwale usuwa paczkę w Selly', onclick: () => confirmDialog({ id: 'dsDelDlg', title: 'Usunąć paczkę?', text: 'Paczka „' + (pk.package_name || pk.id) + '” zostanie trwale usunięta w Selly (razem z ' + cnt(C.total, 'produktem', 'produktami', 'produktami') + '). Tego nie da się cofnąć.', ok: 'Usuń paczkę',
          onOk: async () => { try { await api('dropshipping:delete', { id: pk.id, opId: opId() }); flash(null, 'Paczka usunięta.'); go('dropshipping'); } catch (e) { fail(e, 'Nie usunięto'); } } }) }, 'Usuń paczkę'))),
    el('section', { class: 'card', id: 'dsProducts' }, el('h2', null, 'Produkty w paczce ', el('span', { class: 'muted', title: 'Liczba pozycji w tej paczce' }, '(' + C.total + ')')),
      C.truncated ? el('p', { class: 'muted' }, 'Pokazano pierwsze 400 pozycji.') : null,
      prodRows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'dsProdTable' }, el('thead', null, el('tr', null,
        el('th', null, el('span', { title: 'Nazwa produktu z kopii panelu (dane z Selly)' }, 'Produkt')), el('th', null, el('span', { title: 'Kod producenta' }, 'Kod')),
        el('th', null, el('span', { class: 'tip', title: 'Ile sztuk zamówiono u dostawcy w tej paczce' }, 'Ilość')), el('th', null, el('span', { class: 'tip', title: 'Magazyn, do którego trafi towar' }, 'Magazyn')), el('th', null, ''))),
        el('tbody', null, ...prodRows))) : el('div', { class: 'empty', id: 'dsNoProducts' }, 'Ta paczka nie ma jeszcze produktów.'),
      editable ? addProducts(pk, C) : el('p', { class: 'muted' }, 'Paczka jest skasowana — zmień jej status, aby dodawać produkty.')));
}

/** Wyszukiwarka produktów (baza panelu) + lista do dodania + zapis jednym zapytaniem. */
function addProducts(pk, C) {
  const picked = new Map();   // product_id → { id, name, code, qty, wh }
  const defWh = (C.warehouses || []).length ? String(C.warehouses[0].id) : '0';
  const results = el('div', { id: 'dsResults', class: 'ds-results' }), queue = el('div', { id: 'dsQueue', class: 'ds-queue' });
  const paintQueue = () => {
    queue.replaceChildren(...[...picked.values()].map(x => el('div', { class: 'ds-q', 'data-id': x.id }, el('span', { class: 'ds-q-name' }, x.name || 'produkt ' + x.id),
      el('input', { type: 'number', min: '1', max: '100000', value: String(x.qty), class: 'ds-qty', 'aria-label': 'Ilość', title: 'Ile sztuk dodać do paczki', oninput: ev => { x.qty = Number(ev.target.value); } }),
      el('select', { class: 'ds-wh', 'aria-label': 'Magazyn', title: 'Magazyn, do którego trafi towar', onchange: ev => { x.wh = ev.target.value; } }, el('option', { value: '0' }, '— brak —'), (C.warehouses || []).map(w => el('option', { value: String(w.id), selected: String(w.id) === x.wh }, w.name))),
      el('button', { type: 'button', class: 'secondary small-btn', title: 'Usuń z listy do dodania', onclick: () => { picked.delete(x.id); paintQueue(); } }, '✕'))));
    const b = $('dsAddBtn'); if (b) { b.disabled = !picked.size; b.textContent = picked.size ? 'Dodaj do paczki (' + picked.size + ')' : 'Dodaj do paczki'; }
  };
  const search = async q => {
    if (q.trim().length < 2) { results.replaceChildren(); return; }
    try {
      const r = await api('products:list', { q: q.trim(), pageSize: 10 });
      results.replaceChildren(...(r.rows || []).map(p => el('button', { type: 'button', class: 'secondary ds-res', 'data-id': String(p.id), title: 'Dodaj do listy produktów do paczki', onclick: () => { if (!picked.has(String(p.id))) picked.set(String(p.id), { id: String(p.id), name: p.name, code: p.code, qty: 1, wh: defWh }); paintQueue(); } }, p.name + (p.code ? ' · ' + p.code : ''))),
        (r.rows || []).length ? null : el('span', { class: 'muted' }, 'Nic nie znaleziono.'));
    } catch (e) { results.replaceChildren(el('span', { class: 'empty error' }, e.message)); }
  };
  let t = 0;
  const input = el('input', { type: 'search', id: 'dsSearch', placeholder: 'szukaj produktu: nazwa, kod, EAN', 'aria-label': 'Szukaj produktu do dodania', title: 'Wpisz co najmniej 2 znaki — szukamy w bazie produktów panelu',
    oninput: ev => { clearTimeout(t); t = setTimeout(() => search(ev.target.value), 300); } });
  const add = el('button', { type: 'button', class: 'primary', write: 'dropshipping', id: 'dsAddBtn', disabled: true, onclick: async () => {
    const items = [...picked.values()].map(x => ({ product_id: Number(x.id), quantity_ordered: Number(x.qty), warehouse_id: Number(x.wh) }));
    if (items.some(x => !(x.quantity_ordered >= 1))) { flash(null, 'Ilość musi być co najmniej 1.'); return; }
    add.disabled = true;
    try { await api('dropshipping:productsAdd', { packageId: pk.id, items, opId: opId() }); flash(null, 'Dodano ' + cnt(items.length, 'produkt', 'produkty', 'produktów') + ' do paczki.'); loadCard(pk.id); } catch (e) { add.disabled = false; fail(e, 'Nie dodano'); }
  } }, 'Dodaj do paczki');
  return el('details', { class: 'bm-opts', id: 'dsAdd', open: !C.products.length }, el('summary', { title: 'Dodaj produkty do tej paczki' }, 'Dodaj produkty do paczki'), el('div', { class: 'ds-add' }, input, results, queue, add));
}

// ─── Moduł ──────────────────────────────────────────────────────────────
function header() {
  const r = S.route;
  const actions = [];
  if (r) actions.push(el('a', { class: 'btn-secondary', id: 'dsBack', href: '#/dropshipping', title: 'Wróć do listy paczek' }, '← Lista paczek'));
  if (r !== 'nowa') actions.push(el('a', { class: 'btn-primary', write: 'dropshipping', id: 'dsNew', href: '#/dropshipping/nowa', title: 'Utwórz nową paczkę dropshipping w Selly' }, 'Nowa paczka'));
  return pageToolbar({ title: 'Dropshipping', sub: 'Paczki zamawiane u dostawców i produkty w paczkach — zmiany zapisują się w Selly', actions });
}
function mountRoute() {
  S.seq++; lv.stop();
  const r = S.route;
  S.root.replaceChildren(header(), el('div', { id: 'dsBody' }));
  registerListKeys({ screen: 'dropshipping', table: 'dsTable', back: 'dsBack', extra: [{ keys: ['n'], label: 'N', desc: 'Nowa paczka', id: 'dsNew' }] });
  if (r === 'nowa') { $('dsBody').replaceChildren(el('section', { class: 'card', id: 'dsCard' }, el('h2', null, 'Nowa paczka'), packageForm({ status_id: '0' }, true))); return; }
  if (/^\d+$/.test(r)) { loadCard(r); return; }
  cache = null;
  $('dsBody').replaceChildren(lv.node);
  lv.mount(S.query);
}
export default {
  id: 'dropshipping',
  title: 'Dropshipping',
  routes: ['', '<id>', 'nowa'],
  mount(root, params) {
    S.root = root; S.route = (params && params.parts && params.parts[0]) || ''; S.query = params && params.query;
    mountRoute();
  },
  unmount() { S.seq++; lv.stop(); },
};
