// Moduł „Zgłoszenia z panelu” (tylko administrator): uwagi z przycisku „Zgłoś” (feedback:list / feedback:status),
// błędy z przeglądarek z ostatnich 7 dni (client:errors:list) i stan zdrowia Workera (health:get).
import { el, flash, loadingBox, isUnavailable, dateStr, field } from '../core/ui.js?v=ff05c52';
import { api, ctx } from '../core/client.js?v=ff05c52';

const STATUS = { nowe: 'Nowe', w_toku: 'W toku', zamkniete: 'Zamknięte' };
const STATUS_TIP = 'Nowe — jeszcze nikt się nie zajął; W toku — ktoś nad tym pracuje; Zamknięte — załatwione (zostaje na liście).';
const TYPE = { blad: 'Błąd', pomysl: 'Pomysł', pytanie: 'Pytanie' };
const KIND_TIP = { js: 'Błąd skryptu na stronie', promise: 'Nieobsłużony błąd operacji w tle', api: 'Nieudane wywołanie serwera (sieć, błąd 5xx)' };

const S = { root: null, ui: null, filter: '', seq: 0, loaded: false };
const isAdmin = () => !!(ctx.boot && ctx.boot.isAdmin);
const ms = v => dateStr(new Date(Number(v)).toISOString());

function renderItems(items) {
  const list = items.filter(x => !S.filter || x.status === S.filter);
  if (!list.length) return el('div', { class: 'empty' }, S.filter ? 'Brak zgłoszeń o tym statusie.' : 'Brak zgłoszeń. Użytkownicy zgłaszają uwagi przyciskiem „Zgłoś” w górnym pasku.');
  return el('div', { id: 'fbkList' }, list.map(x => {
    const sel = el('select', { class: 'fbk-status', 'data-id': String(x.id), 'aria-label': 'Status zgłoszenia ' + x.id, title: STATUS_TIP,
      onchange: async ev => {
        try { await api('feedback:status', { id: x.id, status: ev.target.value }); flash('', 'Zapisano status'); x.status = ev.target.value; load(); }
        catch (e) { flash('', 'Nie udało się zapisać: ' + (e.message || 'błąd')); ev.target.value = x.status; }
      } }, Object.entries(STATUS).map(([v, l]) => el('option', { value: v, selected: x.status === v }, l)));
    let tech = null;
    try { tech = x.tech ? JSON.parse(x.tech) : null; } catch (e) { /* uszkodzone */ }
    return el('div', { class: 'fbk-item' + (x.status === 'zamkniete' ? ' closed' : ''), 'data-id': String(x.id) },
      el('div', { class: 'fbk-head' }, el('span', { class: 'tag' }, TYPE[x.type] || x.type), el('span', null, x.email), el('span', { class: 'nw' }, ms(x.ms)),
        x.mailed ? null : el('span', { class: 'tag bad tip', title: 'E-mail do administratora jeszcze nie wyszedł — Worker ponawia próbę co kilkanaście minut' }, 'bez e-maila'), sel),
      el('div', { class: 'fbk-text' }, x.text),
      tech ? el('details', null, el('summary', { class: 'small muted', title: 'Trasa, wersja, przeglądarka i ostatnie błędy dołączone przez zgłaszającego' }, 'Informacje techniczne'),
        el('pre', { class: 'fb-preview' }, ['Trasa: ' + tech.route, 'Wersja: ' + tech.version, 'Przeglądarka: ' + tech.browser, ...(tech.errors || []).map(e => ' • ' + e.message + (e.count > 1 ? ' (×' + e.count + ')' : ''))].join('\n'))) : null);
  }));
}

function renderErrors(items) {
  if (!items.length) return el('div', { class: 'empty' }, 'Brak błędów z przeglądarek w ostatnich 7 dniach.');
  const tips = ['Komunikat błędu (bez danych osobowych)', 'Wersja panelu, w której wystąpił — pozwala wykryć błąd po wdrożeniu', 'Ile razy wystąpił w ostatnich 7 dniach', 'Kiedy ostatnio'];
  const head = ['Błąd', 'Wersja panelu', 'Razy', 'Ostatnio'].map((h, i) => el('th', { title: tips[i] }, h));
  return el('div', { class: 'table-wrap' }, el('table', { id: 'errTable' }, el('thead', null, el('tr', null, head)),
    el('tbody', null, items.map(e => el('tr', null, el('td', null, el('span', { class: 'tag tip', title: KIND_TIP[e.kind] || '' }, e.kind), ' ' + e.message, e.route ? el('div', { class: 'small muted' }, e.route) : null),
      el('td', { class: 'nw' }, e.version), el('td', { class: 'num' }, String(e.count)), el('td', { class: 'nw' }, ms(e.lastMs)))))));
}

function renderHealth(h) {
  if (!h) return el('div', { class: 'small muted' }, 'Stan Workera jeszcze nie został oceniony (ocena co 10 minut).');
  const lines = (h.issues || []).map(i => el('div', { class: 'notice ' + (i.level === 'broken' ? 'error' : 'warn') }, el('strong', null, i.title), ' — ' + i.detail));
  return el('div', { class: 'fbk-health' }, ...(lines.length ? lines : [el('div', { class: 'notice ok' }, 'Worker: wszystko działa (sprawdzono ' + ms(h.checkedMs) + ').')]),
    h.notifyFailedMs ? el('div', { class: 'notice warn' }, 'Ostatnie powiadomienie e-mail nie dotarło (Apps Script nie odpowiedział) — sprawdź wyzwalacze i wdrożenie backendu Apps Script.') : null);
}

async function load() {
  const my = ++S.seq, u = S.ui;
  if (!S.loaded) u.items.replaceChildren(loadingBox('Pobieram zgłoszenia…'));
  try {
    const [f, e, h] = await Promise.all([api('feedback:list', {}), api('client:errors:list', {}).catch(() => ({ items: [] })), api('health:get', {}).catch(() => ({ health: null }))]);
    if (my !== S.seq) return;
    S.loaded = true;
    u.items.replaceChildren(renderItems(f.items || []));
    u.errors.replaceChildren(renderErrors(e.items || []));
    u.health.replaceChildren(renderHealth(h.health));
  } catch (err) {
    if (my !== S.seq) return;
    u.items.replaceChildren(el('div', { class: 'empty error' }, isUnavailable(err) ? 'Ten moduł wymaga backendu Cloudflare — chwilowo niedostępny. Zgłoszenia wysłane zapasową drogą są w arkuszu „Zgłoszenia” i w e-mailu.' : 'Nie udało się pobrać zgłoszeń: ' + (err.message || 'błąd'),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => { S.loaded = false; load(); } }, 'Spróbuj ponownie'))));
  }
}

function build() {
  const filter = el('select', { id: 'fbkFilter', 'aria-label': 'Filtr statusu', title: 'Pokaż tylko zgłoszenia o wybranym statusie', onchange: ev => { S.filter = ev.target.value; S.loaded = false; load(); } },
    el('option', { value: '' }, 'Wszystkie'), ...Object.entries(STATUS).map(([v, l]) => el('option', { value: v }, l)));
  S.ui = { items: el('div'), errors: el('div'), health: el('div') };
  S.root.replaceChildren(
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Stan systemu'), el('div', { class: 'sub' }, 'Ocena co 10 minut: synchronizacja z Selly, baza D1, Apps Script, błędy w przeglądarkach. O problemach przychodzi e-mail.')), S.ui.health),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Zgłoszenia z panelu'), el('div', { class: 'sub' }, 'Uwagi, pomysły i pytania wysyłane przyciskiem „Zgłoś”. Do każdego możesz ustawić status.')),
      el('div', { class: 'ord-filter-row' }, field('Status', filter, 'Filtr listy według statusu')), S.ui.items),
    el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h2', null, 'Błędy w przeglądarkach (7 dni)'),
      el('div', { class: 'sub' }, 'Zbierane automatycznie, bez danych osobowych; powtarzające się błędy są zliczane razem.')), S.ui.errors));
}

export default {
  id: 'zgloszenia-osa',
  title: 'Zgłoszenia z panelu',
  routes: [''],
  mount(el0) {
    if (!S.root) S.root = el0;
    if (!isAdmin()) { S.ui = null; S.root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Ten moduł jest dostępny tylko dla administratora panelu.'))); return; }
    if (!S.ui || !S.ui.items.isConnected) { S.loaded = false; build(); }
    load();
  },
  unmount() { S.seq++; },
};
