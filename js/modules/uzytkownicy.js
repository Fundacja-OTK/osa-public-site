// Moduł „Użytkownicy” (tylko administrator): lista dostępu do panelu OSA (akcje users:list, users:save).
import { el, flash, loadingBox, isUnavailable, dateStr, field } from '../core/ui.js?v=094b3e3';
import { api, ctx } from '../core/client.js?v=094b3e3';

const MSG_UNAVAILABLE = 'Moduł Użytkownicy wymaga backendu Cloudflare — chwilowo niedostępny.';
const OWNER_TIP = 'Właściciel panelu ma dostęp zawsze — niezależnie od tej listy. Odebranie sobie roli administratora nie odetnie właściciela, ale inne konto straci uprawnienia.';
const ROLES = { admin: 'Administrator', user: 'Użytkownik' };
const ROLE_TIP = 'Administrator zarządza tą listą i widzi moduł „Użytkownicy”. Użytkownik korzysta z pozostałych modułów panelu.';

const MIRROR_TIP = 'Ta lista = dostęp do panelu OSA i rozszerzenia przeglądarki. Jest automatycznie kopiowana do pierwszej zakładki arkusza „whitelista” (tylko do odczytu — ręczne zmiany w niej zostaną nadpisane). Dostęp do raportu licencji to osobna lista, edytowana ręcznie w zakładce „Raport licencji” tego arkusza (nie tutaj). Osoba wpisana na obu listach ma oba dostępy.';
const LR_TIP = 'Raport licencji ma własną listę dostępu: zakładka „Raport licencji” w arkuszu „whitelista”, edytowana ręcznie w arkuszu (nie w panelu). Ta lista (panel OSA i rozszerzenie) jest niezależna — osoba wpisana na obu listach ma oba dostępy.';

const S = { root: null, ui: null, users: null, mirror: null, mirrorOn: true, sort: 'email', dir: 'asc', seq: 0 };

const COLS = [
  { key: 'email', label: 'E-mail', tip: 'Adres konta Google, którym użytkownik loguje się do panelu' },
  { key: 'name', label: 'Imię', tip: 'Imię lub opis osoby (tylko dla czytelności listy)' },
  { key: 'role', label: 'Rola', tip: ROLE_TIP, tipHeader: true },
  { key: 'active', label: 'Aktywny', tip: 'Wyłączone konto nie może wejść do panelu (wpis zostaje na liście)', tipHeader: true },
  { key: 'addedMs', label: 'Dodany', tip: 'Kiedy konto trafiło na listę', firstDir: 'desc' },
];

const myEmail = () => String((ctx.boot && ctx.boot.email) || '').toLowerCase();
const isAdmin = () => !!(ctx.boot && ctx.boot.isAdmin);

function sorted() {
  const k = S.sort, m = S.dir === 'asc' ? 1 : -1;
  return S.users.slice().sort((a, b) => {
    const x = a[k], y = b[k];
    const ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;  // puste zawsze na końcu
    return (typeof x === 'number' || typeof y === 'number' ? Number(x) - Number(y) : String(x).localeCompare(String(y), 'pl')) * m;
  });
}

async function save(u, patch, confirmed) {
  const next = Object.assign({ email: u.email, name: u.name || '', active: !!Number(u.active), role: u.role }, patch);
  const self = u.email.toLowerCase() === myEmail();
  if (!confirmed && self && ((patch.role && u.role === 'admin' && patch.role !== 'admin') || (patch.active === false))) { askSelf(u, patch); return false; }
  try { await api('users:save', next); flash('', 'Zapisano: ' + u.email); await load(); return true; }
  catch (e) { flash('', 'Nie udało się zapisać: ' + (e.message || 'błąd')); await load(); return false; }
}

function askSelf(u, patch) {
  const what = patch.active === false ? 'wyłączyć własne konto' : 'odebrać sobie rolę administratora';
  const close = () => S.ui.dlg.replaceChildren();
  S.ui.dlg.replaceChildren(el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-label': 'Potwierdzenie zmiany własnego konta' },
    el('h3', null, 'Na pewno ' + what + '?'),
    el('p', null, 'Dotyczy konta ', el('strong', null, u.email), '. Stracisz dostęp do tego modułu (zmiana wejdzie w życie po odświeżeniu strony). Właściciel panelu zachowuje dostęp zawsze.'),
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'primary', id: 'usrSelfConfirm', onclick: () => { close(); save(u, patch, true); } }, 'Tak, zmień'),
      el('button', { type: 'button', class: 'secondary', id: 'usrSelfCancel', onclick: () => { close(); render(); } }, 'Anuluj'))));
}

function mirrorLine() {
  const m = S.mirror, t = m && m.ms ? new Date(Number(m.ms)).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  let text, cls = 'notice';
  if (!S.mirrorOn) { text = 'Kopia w arkuszu: wyłączona (brak adresu Apps Script w konfiguracji Workera).'; cls += ' warn'; }
  else if (!m) text = 'Kopia w arkuszu: jeszcze nie utworzona (powstanie przy pierwszym zapisie na liście).';
  else if (m.status === 'synced') text = 'Kopia w arkuszu: zsynchronizowana ' + t;
  else if (m.status === 'refused') { text = 'Kopia w arkuszu: wstrzymana (' + t + ') — ' + (m.msg || 'arkusz zawiera adresy, których nie ma na tej liście; zaimportuj je: node scripts/import-users.js'); cls += ' warn'; }
  else { text = 'Kopia w arkuszu: błąd (' + t + ') — ' + (m.msg || 'nie udało się zapisać') + '. Spróbuje ponownie przy następnym zapisie lub w ciągu godziny.'; cls += ' error'; }
  return el('div', { class: cls + ' tip', id: 'usrMirror', title: MIRROR_TIP }, text);
}

function render() {
  const u = S.ui;
  const head = el('tr', null, COLS.map(c => {
    const active = S.sort === c.key;
    return el('th', { 'aria-sort': active ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: c.tipHeader ? 'tip' : null, title: c.tip + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
        onclick: () => { S.dir = active ? (S.dir === 'asc' ? 'desc' : 'asc') : (c.firstDir || 'asc'); S.sort = c.key; render(); } }, c.label + (active ? (S.dir === 'asc' ? ' ↑' : ' ↓') : '')));
  }));
  const body = el('tbody');
  for (const x of sorted()) {
    const self = x.email.toLowerCase() === myEmail();
    const role = el('select', { 'aria-label': 'Rola: ' + x.email, title: ROLE_TIP + (self ? '\n\n' + OWNER_TIP : ''), 'data-email': x.email, class: 'usr-role',
      onchange: ev => { if (ev.target.value !== x.role) save(x, { role: ev.target.value }); } }, Object.entries(ROLES).map(([v, l]) => el('option', { value: v, selected: x.role === v }, l)));
    const act = el('input', { type: 'checkbox', class: 'usr-active', 'data-email': x.email, checked: !!Number(x.active), 'aria-label': 'Aktywny: ' + x.email, title: 'Wyłączone konto nie może wejść do panelu',
      onchange: ev => { const v = ev.target.checked; save(x, { active: v }).then(ok => { if (!ok) ev.target.checked = !v; }); } });
    body.append(el('tr', null, el('td', null, el('span', { class: 'cell-name' }, x.email), self ? el('span', { class: 'tag tip', title: 'To Twoje konto. ' + OWNER_TIP }, 'Ty') : null),
      el('td', null, x.name || ''), el('td', null, role), el('td', { class: 'c' }, act), el('td', { class: 'nw' }, x.addedMs ? dateStr(new Date(Number(x.addedMs)).toISOString()) : '')));
  }
  if (!S.users.length) body.append(el('tr', null, el('td', { colspan: '5', class: 'empty' }, 'Lista jest pusta — dodaj pierwszego użytkownika poniżej.')));
  u.mirror.replaceChildren(mirrorLine());
  u.table.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'usrTable' }, el('thead', null, head), body)));
}

async function load() {
  const my = ++S.seq, u = S.ui;
  if (!S.users) u.table.replaceChildren(loadingBox('Pobieram użytkowników…'));
  try {
    const r = await api('users:list');
    if (my !== S.seq) return;
    S.users = r.users || [];
    S.mirror = r.mirror || null; S.mirrorOn = r.mirrorConfigured !== false;
    render();
  } catch (e) {
    if (my !== S.seq) return;
    u.table.replaceChildren(el('div', { class: 'empty error' }, isUnavailable(e) ? MSG_UNAVAILABLE : (e.code === 403 ? 'Tylko administrator panelu może zarządzać użytkownikami.' : 'Nie udało się pobrać użytkowników: ' + (e.message || 'błąd')),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => { S.users = null; load(); } }, 'Spróbuj ponownie'))));
  }
}

function build() {
  const email = el('input', { type: 'email', id: 'usrEmail', placeholder: 'adres@gmail.com', 'aria-label': 'E-mail nowego użytkownika', required: true });
  const name = el('input', { type: 'text', id: 'usrName', placeholder: 'np. Anna', 'aria-label': 'Imię nowego użytkownika', maxlength: '100' });
  const role = el('select', { id: 'usrRole', 'aria-label': 'Rola nowego użytkownika' }, Object.entries(ROLES).map(([v, l]) => el('option', { value: v }, l)));
  role.value = 'user';
  const msg = el('div', { role: 'status' });
  const add = el('button', { type: 'button', class: 'primary', id: 'usrAdd', title: 'Dodaje konto do listy dostępu (albo aktualizuje je, jeśli już jest na liście)', onclick: async () => {
    const em = email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { msg.replaceChildren(el('div', { class: 'notice error' }, 'Wpisz poprawny adres e-mail.')); email.focus(); return; }
    add.disabled = true; msg.replaceChildren();
    try { await api('users:save', { email: em, name: name.value.trim(), active: true, role: role.value }); flash('', 'Dodano: ' + em); email.value = ''; name.value = ''; role.value = 'user'; await load(); }
    catch (e) { msg.replaceChildren(el('div', { class: 'notice error' }, 'Nie udało się dodać: ' + (e.message || 'błąd'))); }
    add.disabled = false;
  } }, 'Dodaj użytkownika');
  const table = el('div', { id: 'usrBody' });
  const dlg = el('div', { id: 'usrDlg' });
  const mirror = el('div');
  S.ui = { table, dlg, mirror };
  S.root.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Użytkownicy panelu'),
        el('div', { class: 'sub' }, 'To lista dostępu do panelu OSA i rozszerzenia przeglądarki. Wpisz adres konta Google osoby, która ma z nich korzystać.')),
      el('div', { class: 'notice warn tip', title: OWNER_TIP }, 'Właściciel panelu ma dostęp zawsze, nawet bez wpisu na liście.'),
      el('div', { class: 'sub tip', title: MIRROR_TIP }, 'Pierwsza zakładka arkusza „whitelista” jest tylko automatyczną kopią tej listy (do odczytu) — zmiany wprowadzaj wyłącznie tutaj.'),
      el('div', { class: 'notice tip', id: 'usrLrNote', title: LR_TIP }, 'Dostęp do raportu licencji nadajesz osobno — w arkuszu „whitelista”, zakładka „Raport licencji”.'), mirror, dlg, table),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Dodaj użytkownika')),
      el('div', { class: 'ord-filter-row' }, field('E-mail (konto Google)', email, 'Adres, którym osoba loguje się przez Google'), field('Imię', name, 'Opcjonalnie — dla czytelności listy'), field('Rola', role, ROLE_TIP), add), msg));
}

export default {
  id: 'uzytkownicy',
  title: 'Użytkownicy',
  routes: [''],
  mount(el0) {
    if (!S.root) S.root = el0;
    if (!isAdmin()) {
      S.ui = null;
      S.root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Ten moduł jest dostępny tylko dla administratora panelu.')));
      return;
    }
    if (!S.ui || !S.ui.table.isConnected) build();
    load();
  },
  unmount() { S.seq++; },
};
