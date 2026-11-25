// Moduł „Zmiany w Selly” (tylko administrator): co zmieniło się w strukturze panelu Selly od ostatnich sprawdzeń
// (menu, strony, kolumny, pola formularzy, przyciski). Źródła: rozszerzenie Chrome, specyfikacja API i serwerowe sprawdzanie panelu; backend: map:latest, map:history, map:retry.
import { el, loadingBox, isUnavailable, dateStr } from '../core/ui.js?v=c5d5baa';
import { api, ctx } from '../core/client.js?v=c5d5baa';
import { ITEMS } from '../core/nav.js?v=c5d5baa';

const TYPES = {
  'page+': 'Nowa strona', 'page-': 'Zniknęła strona', 'menu+': 'Nowa pozycja menu', 'menu-': 'Zniknęła pozycja menu', 'menu~': 'Zmieniona nazwa w menu',
  'col+': 'Nowa kolumna', 'col-': 'Zniknęła kolumna', 'field+': 'Nowe pole', 'field-': 'Zniknęło pole', 'field~': 'Zmienione pole',
  'opt+': 'Nowe opcje na liście', 'opt-': 'Zniknęły opcje z listy', optn: 'Zmieniła się liczba opcji', 'act+': 'Nowy przycisk / akcja', 'act-': 'Zniknął przycisk / akcja',
  'ep+': 'Nowy endpoint API', 'ep-': 'Zniknął endpoint API', 'par+': 'Nowy parametr API', 'par-': 'Zniknął parametr API', 'par~': 'Zmieniony parametr API', 'req+': 'Nowe pole w żądaniu API', 'req-': 'Zniknęło pole z żądania API', 'req~': 'Zmienione pole żądania API', 'res+': 'Nowe pole / odpowiedź API', 'res-': 'Zniknęło pole / odpowiedź API', 'res~': 'Zmienione pole odpowiedzi API', 'sch+': 'Nowe pole w schemacie API', 'sch-': 'Zniknęło pole ze schematu API', 'sch~': 'Zmienione pole w schemacie API',
  'tab+': 'Nowa zakładka', 'tab-': 'Zniknęła zakładka', 'head+': 'Nowy nagłówek', 'head-': 'Zniknął nagłówek', 'view+': 'Nowy widok', 'view-': 'Zniknął widok',
  'form+': 'Nowy formularz', 'form-': 'Zniknął formularz', 'table+': 'Nowa tabela', 'table-': 'Zniknęła tabela',
};
const API_TIP = 'Zmiana dotyczy endpointu API Selly, którego używa serwer panelu OSA — może wymagać poprawki w kodzie.';
const MAJOR_TIP = 'Zmiana dotyczy strony, którą odwzorowuje już panel OSA (pozycja menu z własnym ekranem) — może zepsuć naszą wersję albo warto ją odwzorować.';

/** Trasy Selly (parametr a=), które panel OSA już obsługuje własnym ekranem. */
const implemented = () => ITEMS.filter(i => i.a && (i.kind === 'osa' || i.kind === 'resource')).map(i => i.a);
export const touchesOurs = (route, ours) => !!route && ours.some(a => route === a || route.startsWith(a + '.'));

const S = { root: null, seq: 0 };
const when = ms => (ms ? dateStr(new Date(Number(ms)).toISOString()) : '—');
const SRC = { ext: 'rozszerzenie', api: 'API', panel: 'panel Selly (serwer)' };
const SRC_TIP = {
  ext: 'Sprawdzenie robione przez rozszerzenie Chrome w przeglądarce osoby, która ma otwarty panel Selly (struktura strony: menu, kolumny, pola).',
  api: 'Porównanie publicznej specyfikacji REST API Selly (endpointy, parametry, pola odpowiedzi). Serwer robi je co tydzień sam.',
  panel: 'Serwer sam loguje się dedykowanym kontem do panelu Selly i co tydzień, małymi porcjami, odczytuje strukturę stron (bez danych klientów).',
};
const STATUS_TEXT = {
  'no-config': 'Sprawdzanie panelu Selly przez serwer jest wyłączone — brak konta (SELLY_ADMIN_LOGIN / SELLY_ADMIN_PASSWORD w konfiguracji wdrożenia).',
  'login-failed': 'Logowanie do Selly nie powiodło się — sprawdź login i hasło konta administracyjnego (kolejna próba najwcześniej za 24 h).',
  '2fa': 'Konto Selly wymaga kodu 2FA — wyłącz 2FA dla tego konta (serwer nie potrafi go podać). Kolejna próba najwcześniej za 24 h.',
  'login-unknown': 'Logowanie do Selly zakończyło się nieoczekiwaną odpowiedzią — sprawdź konto. Kolejna próba najwcześniej za 24 h.',
  'too-few-pages': 'Konto widzi za mało stron panelu Selly — sprawdź jego uprawnienia (powinno mieć podgląd wszystkich działów).',
};

function changeRows(changes, ours, src) {
  const rows = (changes || []).map(c => ({ ...c, ours: src === 'api' ? !!c.o : touchesOurs(c.r, ours) }));
  rows.sort((a, b) => (b.ours - a.ours) || (a.lvl === b.lvl ? 0 : a.lvl === 'major' ? -1 : 1));
  return rows.map(c => el('tr', null,
    el('td', null, c.ours ? el('span', { class: 'tag tip', title: src === 'api' ? API_TIP : MAJOR_TIP }, 'ważne') : null),
    el('td', null, TYPES[c.t] || c.t),
    el('td', { class: 'nw' }, c.r || ''),
    el('td', null, c.d || '')));
}

/** Wiersz „źródło: ostatnie udane sprawdzenie” (+ co robi). */
function sourceLine(src, l) {
  return el('div', { class: 'sub' },
    el('span', { class: 'tag tip', title: SRC_TIP[src] }, SRC[src]), ' ',
    l ? [el('span', { class: 'tip', title: 'Kiedy źródło ostatnio z powodzeniem sprawdziło Selly' }, 'ostatnie udane sprawdzenie: ' + when(l.receivedMs)),
      ' · ', el('span', { class: 'tip', title: src === 'api' ? 'Liczba endpointów w specyfikacji API' : 'Liczba stron panelu Selly, które zostały obejrzane (sama struktura, bez danych klientów)' }, (src === 'api' ? 'endpointów: ' : 'stron: ') + l.pages),
      l.complete ? '' : ' · przejście niekompletne', ' · ', l.baseline ? 'zapamiętano stan wyjściowy' : (l.nChanges ? 'zmian: ' + l.nChanges : 'bez zmian')]
      : 'jeszcze nie sprawdzono');
}

function healthLines(watch, latestBy) {
  const out = [];
  const p = watch.panel || {};
  if (STATUS_TEXT[p.status]) out.push({ text: STATUS_TEXT[p.status], retry: p.status !== 'no-config' });
  else if (p.progress) out.push({ text: 'Trwa tygodniowe sprawdzanie panelu Selly przez serwer: obejrzano ' + p.progress.pages + ' stron, w kolejce ' + p.progress.queue + '.', info: true });
  const a = watch.api || {};
  if (a.errMs && (!a.okMs || a.errMs > a.okMs)) out.push({ text: 'Nie udało się pobrać specyfikacji API Selly (' + when(a.errMs) + '): ' + (a.err || 'błąd') + '. Serwer spróbuje ponownie.', info: true });
  return out;
}

function render(data, history) {
  const ours = implemented();
  const by = data.bySource || { ext: data.latest };
  const watch = data.watch || {};
  const lastWithChanges = history.filter(h => (h.changes || []).length);
  const isOurs = (h, c) => ((h.src || 'ext') === 'api' ? !!c.o : touchesOurs(c.r, ours));
  const important = lastWithChanges.reduce((n, h) => n + h.changes.filter(c => isOurs(h, c)).length, 0);
  const health = healthLines(watch, by).map(h => el('div', { class: 'notice ' + (h.info ? '' : 'warn') },
    h.text, h.retry ? [' ', el('button', { type: 'button', class: 'secondary', title: 'Zdejmuje przerwę w próbach logowania — serwer spróbuje zalogować się przy najbliższym sprawdzeniu (do 10 min).', onclick: retry }, 'Spróbuj ponownie')] : null));
  const blocks = lastWithChanges.map(h => {
    const src = h.src || 'ext';
    return el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Zmiany z ' + when(h.receivedMs)),
        el('div', { class: 'sub' }, el('span', { class: 'tag tip', title: SRC_TIP[src] }, SRC[src]), ' ' + h.changes.length + ' zmian' + (h.truncated ? ' (lista ucięta)' : ''))),
      el('div', { class: 'table-wrap' }, el('table', { class: 'szm-table' },
        el('thead', null, el('tr', null,
          el('th', { title: 'Czy zmiana dotyczy ekranu albo endpointu API, których już używa panel OSA' }, 'Ważność'),
          el('th', { title: 'Rodzaj zmiany' }, 'Rodzaj'),
          el('th', { title: 'Trasa Selly (parametr a= w adresie strony) albo endpoint / schemat API' }, 'Gdzie'),
          el('th', { title: 'Co dokładnie się zmieniło (nazwa kolumny, pola, przycisku, parametru…)' }, 'Szczegóły'))),
        el('tbody', null, changeRows(h.changes, ours, src)))));
  });
  const any = SRC && Object.keys(SRC).some(s => by[s]);
  S.root.replaceChildren(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, 'Zmiany w Selly'),
        el('div', { class: 'sub' }, 'Selly bywa aktualizowany. Co tydzień sprawdzamy to na trzy sposoby (źródła poniżej) i zgłaszamy różnice tutaj oraz e-mailem. Zbierana jest tylko struktura, bez danych klientów.')),
      ...health,
      important ? el('div', { class: 'notice warn tip', title: MAJOR_TIP + ' Dla API: zmiana dotyczy endpointu, którego używa nasz serwer.' }, 'Ważnych zmian (dotyczą tego, co już mamy w panelu): ' + important) : null,
      ...Object.keys(SRC).map(s => sourceLine(s, by[s])),
      any ? null : el('div', { class: 'empty' }, 'Jeszcze nic nie sprawdzono — pierwsze sprawdzenie serwera nastąpi automatycznie w ciągu godziny.')),
    ...(blocks.length ? blocks : any ? [el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Nie wykryto żadnych zmian.'))] : []));
}

async function retry() {
  try { await api('map:retry'); } catch (e) { /* ekran pokaże stan przy odświeżeniu */ }
  load();
}

async function load() {
  const my = ++S.seq;
  S.root.replaceChildren(loadingBox('Pobieram zmiany…'));
  try {
    const [l, h] = await Promise.all([api('map:latest'), api('map:history')]);
    if (my !== S.seq) return;
    render(l, h.history || []);
  } catch (e) {
    if (my !== S.seq) return;
    S.root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, isUnavailable(e) ? 'Moduł wymaga backendu Cloudflare — chwilowo niedostępny.' : e.code === 403 ? 'Ten moduł jest dostępny tylko dla administratora panelu.' : 'Nie udało się pobrać zmian: ' + (e.message || 'błąd'),
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: load }, 'Spróbuj ponownie')))));
  }
}

export default {
  id: 'selly-zmiany',
  title: 'Zmiany w Selly',
  routes: [''],
  mount(root) {
    S.root = root;
    if (!(ctx.boot && ctx.boot.isAdmin)) { root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Ten moduł jest dostępny tylko dla administratora panelu.'))); return; }
    load();
  },
  unmount() { S.seq++; },
};
