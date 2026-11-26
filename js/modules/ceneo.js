// Widok „Ceneo”: produkty widoczne w sklepie — które trafiają do plików dla porównywarek cen (pole „Eksportuj do porównywarek cen”)
// i którym brakuje danych potrzebnych Ceneo. Dane z kopii w D1 (ceneo:overview, bez zapytań do Selly).
// Zmiana flagi dla zaznaczonych produktów: ta sama masowa zmiana danych co w „Masowa zmiana danych” (bulk:* — podgląd, potwierdzenie, audyt, cofanie).
import { el, money, plural, isUnavailable, flash, progressToast } from '../core/ui.js?v=196affa';
import { listView } from '../core/listView.js?v=196affa';
import { confirmDialog } from '../core/confirm.js?v=196affa';
import { api } from '../core/client.js?v=196affa';

const CAP = 200;   // produktów na jedno wywołanie z tego widoku (większe zmiany: Masowa zmiana danych)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VIEWS = [['feed', 'w feedzie Ceneo'], ['notfeed', 'poza feedem'], ['missing', 'w feedzie, z brakami danych']];
const noun = n => plural(n, 'produkt', 'produkty', 'produktów');

async function setExport(rows, on, l) {
  const ids = rows.map(r => r.id);
  if (!ids.length) return;
  if (ids.length > CAP) { flash(null, 'Za dużo produktów naraz (maks. ' + CAP + ') — zawęź zaznaczenie albo użyj „Masowa zmiana danych”.'); return; }
  const op = { kind: 'field', field: 'ads_compare_export', value: on };
  let pv;
  try { pv = await api('bulk:preview', { ids, op }); } catch (e) { flash(null, 'Nie udało się policzyć podglądu: ' + (e.message || e)); return; }
  const n = pv.counts.changed;
  if (!n) { flash(null, 'Nic do zmiany — wszystkie zaznaczone produkty mają już to ustawienie.'); return; }
  const yes = await confirmDialog({ id: 'cnConfirm', title: (on ? 'Włączysz' : 'Wyłączysz') + ' eksport do porównywarek dla ' + n + ' ' + noun(n),
    body: el('div', null, el('p', null, 'Zmiana zostanie zapisana w Selly (' + (pv.counts.unchanged ? pv.counts.unchanged + ' z zaznaczonych ma już to ustawienie i zostanie pominięte; ' : '') + 'zapisujemy po kolei). Zmienia tylko pole produktu — plik dla Ceneo generuje Selly.'),
      el('p', { class: 'muted' }, 'Poprzednie wartości zapamiętamy — zmianę cofniesz w „Masowa zmiana danych” (historia partii).')),
    confirmLabel: (on ? 'Włącz' : 'Wyłącz') + ' dla ' + n + ' ' + noun(n), focus: 'cancel', write: 'zmiana-danych' });
  if (!yes) return;
  const pt = progressToast('Zapisuję… 0 z ' + n);
  try {
    const r = await api('bulk:start', { ids, op, expect: n, label: 'Ceneo: eksport do porównywarek' });
    let b = r.batch;
    while (b && b.status === 'running') {
      const s = await api('bulk:step', { batchId: b.id, n: 4 });
      b = s.batch; pt.set('Zapisuję… ' + (b.ok + b.errors) + ' z ' + b.total);
      const pace = s.wait || Math.round((s.processed || 0) * (r.reqPerItem || 2) * 60000 / (r.perMin || 120));
      if (pace) await sleep(pace);
    }
    pt.done(b && b.errors ? 'Gotowe, błędy: ' + b.errors + ' (szczegóły w „Masowa zmiana danych”).' : 'Gotowe — zmieniono ' + (b ? b.ok : 0) + ' ' + noun(b ? b.ok : 0) + '.');
  } catch (e) { pt.done('Nie zapisano: ' + (e.message || e)); }
  l.clearSelection(); l.reload();
}

const lv = listView({
  id: 'cn', route: '/ceneo', title: 'Ceneo — produkty w feedzie', noun: ['produkt', 'produkty', 'produktów'], loadingText: 'Wczytuję produkty…',
  columns: [
    { key: 'name', label: 'Produkt', tip: 'Nazwa produktu (tylko produkty widoczne w sklepie)', cell: r => el('a', { href: '#/produkty/' + r.id, class: 'cell-name' }, r.name || '(bez nazwy)') },
    { key: 'code', label: 'Kod', tip: 'Kod producenta', cell: r => r.code || '—' },
    { key: 'ean', label: 'EAN', tip: 'Kod EAN — Ceneo łączy oferty po EAN, bez niego produkt trudniej dopasować', cell: r => r.ean || '—' },
    { key: 'price', label: 'Cena', num: true, tip: 'Cena brutto w sklepie (zł)', cell: r => money(r.price) },
    { key: 'feed', label: 'Feed Ceneo', tip: 'Czy produkt ma włączone „Eksportuj do porównywarek cen” (trafia do plików dla Ceneo i innych porównywarek)', cell: r => (r.feed ? 'tak' : 'nie') },
    { key: 'problems', label: 'Braki', tip: 'Czego brakuje produktowi do dobrego wpisu w Ceneo (EAN, cena, zdjęcie, producent, kategoria)', cell: r => (r.problems.length ? el('span', { class: 'bm-warn' }, r.problems.join(', ')) : '—') },
  ],
  search: { placeholder: 'Szukaj: nazwa, kod lub EAN', label: 'Szukaj', tip: 'Szuka w nazwie, kodzie producenta i EAN' },
  filters: [{ key: 'view', label: 'Pokaż', tip: 'Wszystkie widoczne produkty albo wybrana grupa', options: VIEWS, all: 'wszystkie widoczne' }],
  load: async st => {
    const r = await api('ceneo:overview', { view: st.filters.view || 'all', q: st.q || '', page: st.page });
    paintTiles(r.counts);
    return { rows: r.rows, total: r.total, pageSize: r.pageSize };
  },
  select: { noun: ['produkt', 'produkty', 'produktów'], actions: (rows, l) => [
    el('button', { type: 'button', class: 'secondary', write: 'zmiana-danych', id: 'cnOn', title: 'Włącz „Eksportuj do porównywarek cen” dla zaznaczonych (do ' + CAP + ' naraz; najpierw podgląd i potwierdzenie)', onclick: () => setExport(rows, true, l) }, 'Włącz eksport do Ceneo'),
    el('button', { type: 'button', class: 'secondary', write: 'zmiana-danych', id: 'cnOff', title: 'Wyłącz eksport do porównywarek dla zaznaczonych (do ' + CAP + ' naraz; najpierw podgląd i potwierdzenie)', onclick: () => setExport(rows, false, l) }, 'Wyłącz eksport')] },
  actions: [el('a', { class: 'btn-secondary', href: '#/zmiana-danych', title: 'Masowa zmiana danych — większe zmiany, filtry i historia' }, 'Masowa zmiana danych'),
    el('a', { class: 'btn-secondary', href: '#/ceneo-opinie', title: 'Ustawienia integracji z Ceneo (ankieta po zakupie)' }, 'Ustawienia Ceneo')],
  top: el('div', { id: 'cnTiles', class: 'bm-row' }),
  empty: 'Brak produktów w tej grupie.', emptyFiltered: 'Żaden produkt nie pasuje do filtra.',
  errorBox: (e, retry) => el('div', { class: 'empty error', id: 'cnError' }, isUnavailable(e) ? 'Widok Ceneo wymaga backendu Cloudflare — chwilowo niedostępny.' : 'Nie udało się wczytać: ' + (e.message || e), ' ',
    el('button', { type: 'button', class: 'secondary', onclick: retry }, 'Spróbuj ponownie')),
});

function paintTiles(c) {
  const box = document.getElementById('cnTiles');
  if (!box || !c) return;
  const t = (label, n, tip) => el('span', { class: 'chip tip', title: tip }, label + ' ', el('b', null, String(n)));
  box.replaceChildren(t('Widoczne', c.visible, 'Produkty widoczne w sklepie'), t('W feedzie', c.inFeed, 'Widoczne produkty z włączonym „Eksportuj do porównywarek cen”'),
    t('Poza feedem', c.notInFeed, 'Widoczne produkty bez eksportu do porównywarek'), t('Z brakami', c.missing, 'Produkty w feedzie, którym brakuje EAN, ceny, zdjęcia, producenta lub kategorii'),
    t('Bez EAN', c.noEan, 'Produkty w feedzie bez kodu EAN'), t('Bez zdjęcia', c.noPhoto, 'Produkty w feedzie bez zdjęcia (wg kopii zdjęć; produkty jeszcze niesprawdzone nie są liczone)'));
}

export default {
  id: 'ceneo', title: 'Ceneo',
  mount(host, params) { if (!lv.node.isConnected) host.append(lv.node); lv.mount(params && params.query); },
  unmount() { lv.stop(); },
};
