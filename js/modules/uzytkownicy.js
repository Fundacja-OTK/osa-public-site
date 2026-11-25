// „Kto się logował” (tylko administrator panelu): konta Selly, które logowały się do panelu OSA — login, kiedy, do których części
// panelu miały dostęp (wg uprawnień w Selly). Tylko do odczytu: dostęp nadaje się w Selly (Konto → Uprawnienia), nie tutaj (docs/auth.md).
import { el, loadingBox, isUnavailable, dateStr } from '../core/ui.js?v=9174fa9';
import { api, ctx } from '../core/client.js?v=9174fa9';
import { TITLES, GRANTABLE } from '../lib/panelAuth.js?v=9174fa9';

const MSG_UNAVAILABLE = 'Ten widok wymaga serwera głównego panelu (Cloudflare) — chwilowo niedostępny.';
const PERMS_TIP = 'Panel OSA nie ma własnej listy uprawnionych: każdy loguje się swoim kontem Selly i widzi te części panelu, do których ma dostęp w Selly. Zmiany danych — kolumna „Może zmieniać”. Uprawnienia zmienia administrator sklepu w Selly (Konto → Grupy użytkowników / Uprawnienia); panel odczytuje je przy logowaniu i co godzinę.';
const ADMIN_TIP = 'Administrator panelu OSA = konto, które w Selly ma dostęp do „Konta administratorów” (albo jest wpisane w konfiguracji Workera, ADMIN_LOGINS). Widzi zgłoszenia, zmiany w Selly i ten widok.';

const COLS = [
  { key: 'login', label: 'Login Selly', tip: 'Login Selly' },
  { key: 'lastMs', label: 'Ostatnio aktywny', tip: 'Ostatnie użycie panelu OSA (dokładność kilku minut)', tipHeader: true, firstDir: 'desc' },
  { key: 'lastLoginMs', label: 'Ostatnie logowanie', tip: 'Kiedy ostatnio wpisano login i hasło (oraz ewentualny kod 2FA)', tipHeader: true, firstDir: 'desc' },
  { key: 'sessions', label: 'Aktywne sesje', tip: 'Na ilu urządzeniach / w ilu przeglądarkach to konto jest teraz zalogowane do panelu OSA', tipHeader: true, firstDir: 'desc' },
  { key: 'logins', label: 'Logowań', tip: 'Ile razy w sumie to konto zalogowało się do panelu OSA', tipHeader: true, firstDir: 'desc' },
  { key: 'perms', label: 'Dostępne części panelu', tip: PERMS_TIP, tipHeader: true, firstDir: 'desc' },
  { key: 'grants', label: 'Może zmieniać', tip: 'Gdzie ta osoba może zmieniać dane w panelu. Podgląd wynika z uprawnień w Selly; zmiany (zapisy przez API sklepu) — tylko administrator panelu albo za Twoją zgodą tutaj. Reklamacje i Oferty zapisują się kontem Selly tej osoby (sprawdza Selly).', tipHeader: true, firstDir: 'desc' },
];
const GRANT_TIP = 'Zaznacz, aby ta osoba mogła zmieniać dane w tej sekcji (zapisy przez API sklepu). Podgląd nadal wynika z uprawnień w Selly. Zmiana działa od razu i jest zapisywana w dzienniku.';

const S = { root: null, rows: null, sort: 'lastMs', dir: 'desc', seq: 0, body: null };
const isAdmin = () => !!(ctx.boot && ctx.boot.isAdmin);
const when = ms => (ms ? dateStr(new Date(Number(ms)).toISOString()) : '');
const permsText = r => (r.perms || []).map(p => TITLES[p] || p).sort((a, b) => a.localeCompare(b, 'pl'));

/** Komórka „Może zmieniać”: administrator — wszędzie; inni — rozwijana lista sekcji z podglądem i polami „może zmieniać”. */
function grantsCell(r) {
  if (r.isAdmin) return el('span', { class: 'tip', title: 'Administrator panelu (dostęp do „Konta administratorów” w Selly) zmienia dane we wszystkich swoich sekcjach' }, 'wszędzie (administrator)');
  const sections = (r.perms || []).filter(p => GRANTABLE.includes(p)).sort((a, b) => (TITLES[a] || a).localeCompare(TITLES[b] || b, 'pl'));
  if (!sections.length) return el('span', { class: 'muted' }, '—');
  const on = new Set(r.grants || []);
  const box = el('details', { class: 'usr-grants' }, el('summary', { title: GRANT_TIP }, on.size ? 'w ' + [...on].filter(x => sections.includes(x)).length + ' z ' + sections.length + ' ▾' : 'tylko podgląd ▾'),
    ...sections.map(sec => el('label', { class: 'usr-grant', title: GRANT_TIP },
      el('input', { type: 'checkbox', checked: on.has(sec), 'data-login': r.login, 'data-section': sec, onchange: async ev => {
        const cb = ev.target; cb.disabled = true;
        try { const g = await api('grants:set', { login: r.login, section: sec, allow: cb.checked }); r.grants = g.grants || []; }
        catch (e) { cb.checked = !cb.checked; alert('Nie udało się zapisać zgody: ' + (e.message || 'błąd')); }
        cb.disabled = false;
      } }), ' ' + (TITLES[sec] || sec))));
  return box;
}

function sorted() {
  const k = S.sort, m = S.dir === 'asc' ? 1 : -1;
  return S.rows.slice().sort((a, b) => {
    const len = (r, kk) => (kk === 'perms' || kk === 'grants' ? (r[kk] || []).length : r[kk]);
    const x = len(a, k), y = len(b, k);
    const ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;  // puste zawsze na końcu
    return (typeof x === 'number' || typeof y === 'number' ? Number(x) - Number(y) : String(x).localeCompare(String(y), 'pl')) * m;
  });
}

function render() {
  const head = el('tr', null, COLS.map(c => {
    const active = S.sort === c.key;
    return el('th', { 'aria-sort': active ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: c.tipHeader ? 'tip' : null, title: c.tip + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
        onclick: () => { S.dir = active ? (S.dir === 'asc' ? 'desc' : 'asc') : (c.firstDir || 'asc'); S.sort = c.key; render(); } }, c.label + (active ? (S.dir === 'asc' ? ' ↑' : ' ↓') : '')));
  }));
  const body = el('tbody');
  const me = String((ctx.boot && ctx.boot.login) || '').toLowerCase();
  for (const r of sorted()) {
    const names = permsText(r);
    body.append(el('tr', { 'data-login': r.login },
      el('td', null, el('span', { class: 'cell-name' }, r.login),
        r.isAdmin ? el('span', { class: 'tag tip', title: ADMIN_TIP }, 'admin') : null,
        r.login === me ? el('span', { class: 'tag', title: 'To Twoje konto' }, 'Ty') : null),
      el('td', { class: 'nw' }, when(r.lastMs)), el('td', { class: 'nw' }, when(r.lastLoginMs)),
      el('td', { class: 'num' }, String(r.sessions || 0)), el('td', { class: 'num' }, String(r.logins || 0)),
      el('td', { class: 'small', title: names.join(', ') || 'Brak dostępu do sekcji panelu OSA' }, names.length > 4 ? names.slice(0, 4).join(', ') + ' i ' + (names.length - 4) + ' więcej' : (names.join(', ') || '—')),
      el('td', { class: 'small' }, grantsCell(r))));
  }
  if (!S.rows.length) body.append(el('tr', null, el('td', { colspan: String(COLS.length), class: 'empty' }, 'Nikt jeszcze nie zalogował się kontem Selly.')));
  S.body.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'usrTable' }, el('thead', null, head), body)));
}

async function load() {
  const my = ++S.seq;
  if (!S.rows) S.body.replaceChildren(loadingBox('Pobieram listę logowań…'));
  try {
    const r = await api('logins:list');
    if (my !== S.seq) return;
    S.rows = r.logins || [];
    render();
  } catch (e) {
    if (my !== S.seq) return;
    S.body.replaceChildren(el('div', { class: 'empty error' }, isUnavailable(e) ? MSG_UNAVAILABLE : (e.code === 403 ? 'Ten widok jest dostępny tylko dla administratora panelu.' : 'Nie udało się pobrać listy: ' + (e.message || 'błąd')),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => { S.rows = null; load(); } }, 'Spróbuj ponownie'))));
  }
}

export default {
  id: 'uzytkownicy',
  title: 'Kto się logował',
  routes: [''],
  mount(host) {
    S.root = host;
    if (!isAdmin()) {
      host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Ten widok jest dostępny tylko dla administratora panelu.')));
      return;
    }
    S.body = el('div', { id: 'usrBody' });
    host.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Kto się logował'),
        el('div', { class: 'sub' }, 'Konta Selly, które korzystały z panelu OSA. Bez haseł — panel ich nie zna.')),
      el('div', { class: 'notice tip', id: 'usrPermsNote', title: PERMS_TIP }, 'Dostęp do panelu nadajesz w Selly: każdy loguje się swoim kontem Selly i widzi to, na co pozwalają jego uprawnienia w Selly.'),
      el('div', { class: 'sub tip', id: 'usrLrNote', title: 'Stary raport licencji (osobna strona) nadal korzysta z listy w arkuszu „whitelista”, zakładka „Raport licencji” — edytowanej ręcznie w arkuszu.' },
        'Dostęp do starego raportu licencji: arkusz „whitelista”, zakładka „Raport licencji”.'),
      S.body));
    S.rows = null;
    load();
  },
  unmount() { S.seq++; },
};
