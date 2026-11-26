// Moduł „Strażnik Selly” (tylko administrator): stan każdej strony Selly, na której opiera się panel (ekrany natywne, formularze przewoźników,
// formularz faktury) — sprawdzanej automatycznie przez serwer kontem technicznym — oraz trasy Selly znalezione na tych stronach (same nazwy).
// Backend: guard:status (odczyt), guard:reset (ponowne sprawdzenie; obejście diagnostyczne). Worker: modules/sellyGuard.js.
import { el, dateStr } from '../core/ui.js?v=5281496';
import { api } from '../core/client.js?v=5281496';
import { listView } from '../core/listView.js?v=5281496';
import { confirmDialog } from '../core/confirm.js?v=5281496';

const STATUS = {
  ok: ['działa', 'Budowa strony zgodna z zapisanym wzorcem — funkcja panelu działa.'],
  suspect: ['do potwierdzenia', 'Jeden odczyt pokazał inną budowę — strażnik potwierdza ją ponownym odczytem w następnym przebiegu; do tego czasu funkcja działa jak dotąd.'],
  changed: ['zmienione', 'Selly zmieniło budowę tej strony — funkcja panelu wstrzymana (zrób to w Selly), zmiana zgłoszona do aktualizacji (selly-zmiana).'],
  invalid: ['nie potwierdzone', 'Strona nie przeszła automatycznej walidacji (np. brak formularza zapisu, nieznane pole wymagane, nieznana trasa zapisu) — strażnik nie zapisał wzorca. Ekrany i faktura działają jak dotąd; przewoźnik pozostaje wyłączony (jak przed strażnikiem).'],
  'no-access': ['brak dostępu', 'Konto techniczne nie ma w Selly uprawnienia do tej strony — nadaj je w Selly (Konto → Uprawnienia), kolumna „Uprawnienie”.'],
  'no-sample': ['brak próbki', 'Nie było rekordu do podejrzenia (np. pusta lista, zamówienie ma już fakturę) — sprawdzenie w następnym obiegu.'],
  pending: ['czeka', 'Jeszcze nie sprawdzono (pierwszy obieg strażnika trwa kilka godzin, porcjami).'],
};
const VIEW = { list: 'lista', record: 'karta', settings: 'ustawienia', new: 'dodawanie', form: 'formularz' };
const KIND = { native: 'ekran', ship: 'przewoźnik', inv: 'faktura' };
const RKIND = { delete: 'usuwanie', save: 'zapis', edit: 'edycja', moderate: 'moderacja', other: 'inna' };
const when = ms => (ms ? dateStr(new Date(Number(ms)).toISOString()) : '—');
const S = { data: null, seq: 0, lvS: null, lvR: null, root: null, head: null, box: null };

async function load(force) {
  if (!S.data || force) S.data = await api('guard:status', {});
  return S.data;
}

function tabs(part) {
  return el('div', { class: 'toolbar' },
    el('a', { href: '#/straznik-selly', class: part ? 'btn-secondary' : 'btn-primary', title: 'Stan każdej pilnowanej strony Selly' }, 'Strony'),
    el('a', { href: '#/straznik-selly/trasy', class: part ? 'btn-primary' : 'btn-secondary', title: 'Trasy Selly (np. usuwanie, zapis) znalezione na stronach — do podłączenia w kolejnych etapach' }, 'Znalezione trasy'));
}

function summary(d) {
  const c = (d.summary && d.summary.counts) || {};
  const perms = (d.summary && d.summary.perms) || [];
  const cyc = d.cycle ? 'obieg w toku: ' + d.cycle.done + ' z ' + d.cycle.total + ' stron' : 'następny obieg: ' + when(d.nextMs);
  return el('div', { class: 'card' },
    el('p', null, 'Serwer sam, kontem technicznym Selly, odczytuje budowę każdej strony, na której opiera się panel (tylko nazwy pól i przycisków, bez danych). ',
      'Zmiana budowy wstrzymuje tylko tę jedną funkcję i trafia do zgłoszenia „selly-zmiana”. Nic nie trzeba klikać.'),
    el('p', { class: 'sub' },
      ...Object.keys(STATUS).map(k => el('span', { class: 'tag tip', title: STATUS[k][1] }, STATUS[k][0] + ': ' + (c[k] || 0))), ' · ',
      el('span', { class: 'tip', title: 'Strażnik sprawdza wszystkie strony raz na dobę, kilka stron na przebieg (limit zapytań do Selly)' }, cyc),
      d.run ? ' · ostatni przebieg: ' + when(d.run.ms) : ''),
    d.configured ? null : el('p', { class: 'notice' }, 'Brak konta technicznego (SELLY_ADMIN_LOGIN / SELLY_ADMIN_PASSWORD) — strażnik nie działa.'),
    perms.length ? el('p', { class: 'notice' }, 'Konto techniczne nie widzi części stron. Nadaj jego grupie w Selly (Konto → Uprawnienia) uprawnienia do tras: ', perms.join(', '), '.') : null);
}

function screensList() {
  return listView({
    id: 'grd', route: '/straznik-selly', title: 'Strażnik Selly', noun: ['strona', 'strony', 'stron'],
    columns: [
      { key: 'title', label: 'Funkcja', sort: true, tip: 'Ekran panelu / przewoźnik / faktura, którego dotyczy strona Selly', cell: r => el('span', { title: r.key }, r.title) },
      { key: 'view', label: 'Strona', sort: true, tip: 'Która strona Selly: lista, karta rekordu, ustawienia, formularz dodawania albo formularz przewoźnika / faktury', value: r => VIEW[r.view] || r.view, cell: r => (KIND[r.kind] || '') + ' · ' + (VIEW[r.view] || r.view) },
      { key: 'route', label: 'Trasa', sort: true, tip: 'Trasa Selly (?a=) odczytywana przez strażnika', cls: 'nw' },
      { key: 'status', label: 'Stan', sort: true, tip: 'Wynik ostatniego sprawdzenia (najedź na stan, żeby zobaczyć, co znaczy)',
        cell: r => el('span', { class: 'tag tip', title: (STATUS[r.status] || ['', ''])[1] + (r.reason ? ' — ' + r.reason : '') }, (STATUS[r.status] || [r.status])[0]) },
      { key: 'diff', label: 'Zmiany', tip: 'Co się zmieniło względem wzorca (same nazwy pól i przycisków: + nowe, − zniknęło, ~ inny typ)', value: r => r.diff.length, cell: r => r.diff.length ? el('span', { class: 'tip', title: r.diff.join('\n') }, r.diff.slice(0, 3).join(', ') + (r.diff.length > 3 ? ' …' : '')) : '' },
      { key: 'perm', label: 'Uprawnienie', sort: true, tip: 'Trasa, do której trzeba nadać uprawnienie grupie konta technicznego w Selly (tylko przy „brak dostępu”)', cls: 'nw' },
      { key: 'checkedMs', label: 'Sprawdzono', sort: true, num: true, tip: 'Kiedy strażnik ostatnio odczytał tę stronę', cell: r => when(r.checkedMs) },
      { key: 'act', label: 'Ponów', tip: 'Ponów: kasuje wzorzec i prosi strażnika o ponowne automatyczne sprawdzenie (przy następnym przebiegu). Tylko diagnostyka — normalnie nie jest potrzebne.',
        cell: r => el('button', { class: 'ghost', title: 'Sprawdź tę stronę od nowa (nowy wzorzec po automatycznej walidacji)', onclick: e => { e.stopPropagation(); reset(r.key); } }, 'Ponów') },
    ],
    defaultSort: null, search: { placeholder: 'Szukaj funkcji lub trasy' },
    local: { searchFields: ['title', 'route', 'key', 'perm'], match: (r, st) => (!st.filters.status || r.status === st.filters.status) && (!st.filters.kind || r.kind === st.filters.kind) },
    filters: [{ key: 'status', label: 'Stan', tip: 'Pokaż tylko strony w wybranym stanie', options: Object.keys(STATUS).map(k => [k, STATUS[k][0]]) },
      { key: 'kind', label: 'Rodzaj', tip: 'Ekrany natywne, formularze przewoźników albo faktura', options: Object.keys(KIND).map(k => [k, KIND[k]]) }],
    load: async (st, kind) => { const d = await load(kind && kind.manual); S.head.replaceChildren(summary(d)); return { rows: d.screens, total: d.screens.length }; },
    empty: 'Brak pilnowanych stron.',
  });
}

function routesList() {
  return listView({
    id: 'grr', route: '/straznik-selly/trasy', title: 'Trasy znalezione przez strażnika', noun: ['trasa', 'trasy', 'tras'],
    columns: [
      { key: 'route', label: 'Trasa', sort: true, tip: 'Nazwa trasy Selly (moduł.akcja) — bez parametrów i wartości', cls: 'nw' },
      { key: 'kind', label: 'Rodzaj', sort: true, tip: 'Rozpoznany po nazwie: usuwanie, zapis, edycja, moderacja, inna', value: r => RKIND[r.kind] || r.kind, cell: r => RKIND[r.kind] || r.kind },
      { key: 'known', label: 'W panelu', sort: true, tip: 'Czy panel OSA już używa tej trasy (tak = podłączona w definicjach)', value: r => (r.known ? 1 : 0), cell: r => (r.known ? 'tak' : 'nie') },
      { key: 'via', label: 'Skąd', sort: true, tip: 'Gdzie była na stronie: link, formularz albo skrypt Selly' },
      { key: 'screens', label: 'Na stronach', tip: 'Strony strażnika, na których ją widziano', value: r => r.screens.length, cell: r => el('span', { class: 'tip', title: r.screens.join('\n') }, r.screens.slice(0, 2).join(', ') + (r.screens.length > 2 ? ' …' : '')) },
      { key: 'lastMs', label: 'Ostatnio', sort: true, num: true, tip: 'Kiedy ostatnio widziana', cell: r => when(r.lastMs) },
    ],
    defaultSort: null, search: { placeholder: 'Szukaj trasy' },
    local: { searchFields: ['route'], match: (r, st) => (!st.filters.kind || r.kind === st.filters.kind) && (!st.filters.known || String(r.known ? 1 : 0) === st.filters.known) },
    filters: [{ key: 'kind', label: 'Rodzaj', tip: 'Tylko trasy danego rodzaju', options: Object.keys(RKIND).map(k => [k, RKIND[k]]) },
      { key: 'known', label: 'W panelu', tip: 'Tylko trasy już używane albo jeszcze niepodłączone', options: [['0', 'niepodłączone'], ['1', 'używane']] }],
    load: async (st, kind) => { const d = await load(kind && kind.manual); return { rows: d.routes, total: d.routes.length }; },
    empty: 'Strażnik nie znalazł jeszcze tras (pierwszy obieg trwa kilka godzin).',
  });
}

async function reset(key) {
  const ok = await confirmDialog({ title: 'Sprawdzić stronę od nowa?', body: 'Wzorzec tej strony zostanie skasowany, a strażnik przy następnym przebiegu zapisze nowy po automatycznej walidacji (tylko diagnostyka).', confirmLabel: 'Sprawdź od nowa' });
  if (!ok) return;
  await api('guard:reset', { key });
  S.data = null;
  if (S.lvS) S.lvS.reload();
}

export default {
  id: 'straznik-selly', title: 'Strażnik Selly', routes: ['', 'trasy'],
  mount(host, params) {
    const part = (params && params.parts && params.parts[0]) || '';
    if (!S.root || !S.root.isConnected) { S.root = host; S.head = el('div'); S.box = el('div'); S.tabs = el('div'); host.replaceChildren(S.tabs, S.head, S.box); }
    S.tabs.replaceChildren(tabs(part));
    if (part === 'trasy') { S.head.replaceChildren(); if (!S.lvR) S.lvR = routesList(); S.box.replaceChildren(S.lvR.node); S.lvR.mount(params && params.query); }
    else { if (!S.lvS) S.lvS = screensList(); S.box.replaceChildren(S.lvS.node); S.lvS.mount(params && params.query); }
  },
  unmount() { S.seq++; if (S.lvS) S.lvS.stop(); if (S.lvR) S.lvR.stop(); },
};
