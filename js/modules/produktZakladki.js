// Karta produktu — zakładki z ekranów Selly (ekrany osadzone `produkt-*`, shared/native/asortyment.js), ładowane leniwie po otwarciu zakładki:
//   „Płatności i dostawa” (edycja), „Konfigurator wymiarów” (edycja), „Dodatkowe” (podgląd: polecane w koszyku, kategorie dodatkowe, ceny indywidualne,
//   subskrypcje, aukcje), „Historia” (podgląd: historia ceny, zdarzenia). Zapis: tylko zmienione pola → podgląd (dryRun) → potwierdzenie → zapis → weryfikacja.
// Uprawnienia i allowlisty rozstrzyga serwer (panelAuth + silnik natywny); tu nic nie jest ukryte „dla ochrony”.
import { el, sellyLink, flash } from '../core/ui.js?v=4562225';
import { confirmDialog } from '../core/confirm.js?v=4562225';
import { ctx } from '../core/client.js?v=4562225';
import { sellyCall } from './sellyNative.js?v=4562225';

const str = v => (v == null ? '' : String(v));
const WHAT = { min: 'wartość minimalna', przyrost: 'przyrost', wartosc: 'wartość domyślna', max: 'wartość maksymalna' };
const sUrl = (route, id) => ((ctx.boot && ctx.boot.adminUrl) || 'https://takimarket.pl/adm/') + '?a=' + route + '&id=' + encodeURIComponent(id);
const digits = n => n.replace(/\D/g, '');

/** Etykiety pól wg ekranu: (wszystkie pola, tabele) → funkcja pole → { label, group, tip }. */
const LABELERS = {
  'produkt-opcje': (all, tables) => {
    const names = t => (t && t.rows ? t.rows.map(r => str(r[0]).trim()).filter(Boolean) : []);
    const pay = all.filter(f => /^platnosc\[\d+\]$/.test(f.name)), del = all.filter(f => /^dostawa\[\d+\]$/.test(f.name));
    const pn = names(tables[0]), dn = names(tables[1]), payName = {}, delName = {};
    // nazwy z tabel Selly tylko, gdy liczba wierszy zgadza się z liczbą pól — inaczej numer (nie zgadujemy)
    pay.forEach((f, i) => { payName[digits(f.name)] = pn.length === pay.length ? pn[i] : 'forma płatności nr ' + digits(f.name); });
    del.forEach((f, i) => { delName[digits(f.name)] = dn.length === del.length ? dn[i] : 'forma dostawy nr ' + digits(f.name); });
    return f => {
      const n = digits(f.name);
      if (f.name === 'blokada_platnosci') return { label: 'Formy płatności — skąd ustawienia', group: 'Formy płatności', tip: 'Czy o dostępnych formach płatności decyduje kategoria, czy lista zaznaczona poniżej dla tego produktu' };
      if (f.name === 'blokada_dostawy') return { label: 'Formy dostawy — skąd ustawienia', group: 'Formy dostawy', tip: 'Czy o dostępnych formach dostawy decyduje kategoria / producent, czy lista zaznaczona poniżej dla tego produktu' };
      if (/^platnosc\[/.test(f.name)) return { label: 'Dostępna: ' + payName[n], group: 'Formy płatności', tip: 'Działa tylko przy ustawieniu „wg ustawień produktu”' };
      if (/^dostawa\[/.test(f.name)) return { label: 'Dostępna: ' + delName[n], group: 'Formy dostawy', tip: 'Działa tylko przy ustawieniu „wg ustawień produktu”' };
      if (/^koszt_dostawy\[/.test(f.name)) return { label: 'Koszt dostawy (' + (delName[n] || n) + ')', group: 'Formy dostawy', tip: 'Koszt tej formy dostawy dla tego produktu (zł); puste = wg ustawień ogólnych' };
      if (f.name === 'koszt_dostawy_staly') return { label: 'Koszt dostawy niezależny od liczby sztuk', group: 'Formy dostawy', tip: 'Koszt dostawy wg ustawień produktu nie rośnie z ilością sztuk w zamówieniu' };
      return { label: f.label && f.label !== f.name ? f.label : f.name, group: 'Inne', tip: '' };
    };
  },
  'produkt-wymiary': all => {
    const pname = {};
    for (const f of all) { const m = /^parametr_min\[(\d+)\]\[(\d+)\]$/.exec(f.name); if (m && f.label && f.label !== f.name) pname[m[1] + '.' + m[2]] = f.label; }
    const L = { wymiary_cena_jm: 'Jednostka ceny', wymiary_cena: 'Cena podstawowa', wymiary_cena1: 'Cena — poziom 1', wymiary_cena2: 'Cena — poziom 2', wymiary_cena3: 'Cena — poziom 3',
      wymiary_cena_wg: 'Cena obliczana wg', wymiary_dokladnosc: 'Dokładność wymiarów', wymiary_jednostka: 'Jednostka wymiarów' };
    return f => {
      let m;
      if (L[f.name]) return { label: L[f.name], group: 'Cennik i jednostki', tip: 'Ogólne ustawienia cennika wg wymiarów' };
      if ((m = /^parametr_(min|przyrost|wartosc|max)\[(\d+)\]\[(\d+)\]$/.exec(f.name))) return { label: (pname[m[2] + '.' + m[3]] || 'parametr ' + m[3]) + ' — ' + WHAT[m[1]], group: 'Kształt ' + m[2], tip: 'Ograniczenia wymiaru, który wpisuje klient' };
      if ((m = /^px_sposob_wyswietlania\[(\d+)\]$/.exec(f.name))) return { label: 'Sposób wyświetlania pola', group: 'Kształt ' + m[1], tip: 'Jak klient wpisuje wymiar w sklepie (pole, liczba, suwak, lista)' };
      if ((m = /^pozycja\[(\d+)\]$/.exec(f.name))) return { label: 'Pozycja kształtu (niedostępny = wyłączony)', group: 'Kształt ' + m[1], tip: 'Kolejność kształtu w sklepie; „niedostępny” wyłącza go dla tego produktu' };
      if (f.name === 'prostokat_proporcjonalnie') return { label: 'Zachowaj proporcje prostokąta', group: 'Kształt 2', tip: 'Zmiana jednego boku zmienia drugi proporcjonalnie' };
      return { label: f.label && f.label !== f.name ? f.label : f.name, group: 'Inne', tip: '' };
    };
  },
};

function control(f, can) {
  const dis = can && f.editable ? null : true, id = 'pzF_' + f.name.replace(/[^\w]/g, '_');
  if (f.type === 'checkbox') return el('input', { type: 'checkbox', id, 'data-on': f.onValue || 'on', checked: str(f.value) !== '' ? true : null, disabled: dis });
  if (f.type === 'select' || f.type === 'radio') return el('select', { id, disabled: dis }, (f.options || []).map(o => el('option', { value: o.value, selected: o.value === f.value ? true : null }, o.text)));
  return el('input', { type: 'text', id, value: str(f.value), maxlength: 200, disabled: dis });
}
const valueOf = c => (c.type === 'checkbox' ? (c.checked ? c.dataset.on : '') : c.value);

const tableEl = t => el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, t.headers.map(h => el('th', null, el('span', { title: h }, h))))),
  el('tbody', null, t.rows.map(r => el('tr', null, r.map(c => el('td', null, c)))))));

/** Edytowalna zakładka z jednego ekranu osadzonego. */
async function editable(host, id, screen, o) {
  host.replaceChildren(el('p', { class: 'muted' }, 'Wczytuję z Selly…'));
  const r = await sellyCall({ op: 'read', screen, view: 'record', id });
  const d = r && r.ok && r.data;
  const fields = d ? (d.fields || []).filter(f => f.name !== 'shopid') : [];
  const open = el('p', null, sellyLink('Otwórz w Selly ↗', sUrl(o.route, id), 'Pełny ekran w Selly, w nowej karcie'));
  if (!d || !fields.length) { host.replaceChildren(el('p', { class: 'muted' }, (r && r.error) || 'Nie udało się wczytać (brak uprawnień lub Selly nie odpowiada).'), open); return; }
  const can = !!d.canSave, lab = LABELERS[screen](fields, d.tables || []);
  const ctl = new Map(), orig = {}, info = new Map(), groups = new Map();
  for (const f of fields) {
    const li = lab(f), c = control(f, can);
    info.set(f.name, li); ctl.set(f.name, c); orig[f.name] = valueOf(c);
    const lbl = el('label', { class: 'field' + (f.type === 'checkbox' ? ' check' : '') }, el('span', { class: li.tip ? 'tip' : null, title: li.tip || null }, li.label), c);
    if (!groups.has(li.group)) groups.set(li.group, []);
    groups.get(li.group).push(lbl);
  }
  const text = (n, v) => { const c = ctl.get(n); if (c.tagName === 'SELECT') { const op = [...c.options].find(x => x.value === v); return op ? op.textContent : v; } return c.type === 'checkbox' ? (v ? 'tak' : 'nie') : v; };
  const save = async () => {
    const changes = {}, expect = {};
    for (const [n, c] of ctl) if (!c.disabled && valueOf(c) !== orig[n]) { changes[n] = valueOf(c); expect[n] = orig[n]; }
    if (!Object.keys(changes).length) { flash('', 'Bez zmian — nic do zapisania'); return; }
    const pre = await sellyCall({ op: 'save', screen, id, changes, expect, dryRun: true });
    if (!pre || !pre.ok) { flash('', (pre && pre.error) || 'Nie udało się przygotować zapisu'); return; }
    if (!pre.data.diff.length) { flash('', 'Bez zmian — wartości są już takie w Selly'); return; }
    const body = el('div', null, el('p', null, 'Do Selly zostanie zapisane:'),
      el('ul', null, pre.data.diff.map(x => el('li', null, el('strong', null, (info.get(x.name) || { label: x.name }).label + ': '),
        (x.beforeText || text(x.name, x.before) || '(puste)') + ' → ' + (x.afterText || text(x.name, x.after) || '(puste)')))),
      pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null);
    confirmDialog({ id: 'pzConfirm', title: o.confirmTitle, body, confirmLabel: 'Zapisz w Selly', focus: 'cancel', onConfirm: async ({ close }) => {
      const w = await sellyCall({ op: 'save', screen, id, changes, expect });
      close();
      if (!w || !w.ok) {
        flash('', (w && w.code === 'conflict' ? 'Dane w Selly zmieniły się w międzyczasie — wczytano je ponownie. ' : 'Zapis nie powiódł się: ') + ((w && w.error) || 'błąd'));
        if (w && w.code === 'conflict') editable(host, id, screen, o);
        return;
      }
      flash('', w.data.verified ? 'Zapisano w Selly i sprawdzono' : 'Selly przyjęło zapis, ale nie potwierdziło pól — sprawdź w Selly');
      editable(host, id, screen, o);
    } });
  };
  const ref = (d.tables || []).filter(t => t.rows.length);
  host.replaceChildren(
    el('p', { class: 'muted small tip', title: o.tip }, o.intro),
    ...[...groups].map(([g, rows]) => el('fieldset', { class: 'pz-group' }, el('legend', null, g), rows)),
    ref.length ? el('details', { class: 'pz-ref' }, el('summary', { title: 'Co Selly pokazuje o ustawieniach odziedziczonych i bieżących' }, 'Ustawienia odziedziczone (podgląd)'), ...ref.map(tableEl)) : null,
    el('div', { class: 'ord-actions' },
      can ? el('button', { type: 'button', class: 'primary', id: 'pzSave_' + screen, write: 'produkty', title: 'Pokaże podsumowanie zmian, a po potwierdzeniu zapisze je w Selly', onclick: save }, o.saveLabel) : null,
      sellyLink('Otwórz w Selly ↗', sUrl(o.route, id), 'Pełny ekran w Selly, w nowej karcie')),
    can ? null : el('p', { class: 'muted small' }, 'Tylko podgląd — zapis niedostępny. Zmienisz w Selly.'));
}

/** Sekcja tylko do podglądu (tabele + wypełnione pola). */
async function readOnly(host, id, s) {
  host.replaceChildren(el('p', { class: 'muted' }, 'Wczytuję z Selly…'));
  const r = await sellyCall({ op: 'read', screen: s.screen, view: 'record', id });
  const d = r && r.ok && r.data;
  const link = el('p', null, sellyLink(s.edit || 'Otwórz w Selly ↗', sUrl(s.route, id), 'Edycja i szczegóły w Selly (nowa karta)'));
  if (!d) { host.replaceChildren(el('p', { class: 'muted' }, (r && r.error) || 'Nie udało się wczytać (brak uprawnień lub Selly nie odpowiada).'), link); return; }
  const tables = (d.tables || []).filter(t => t.rows.length);
  const shown = f => (f.type === 'checkbox' ? 'tak' : ((f.options || []).find(x => x.value === f.value) || {}).text || str(f.value));
  const info = (d.fields || []).filter(f => f.name !== 'shopid' && f.label && f.label !== f.name && str(f.value) !== '' && f.type !== 'hidden');
  host.replaceChildren(
    el('p', { class: 'muted small tip', title: s.tip }, s.intro),
    info.length ? el('dl', { class: 'ord-dl' }, info.flatMap(f => [el('dt', null, f.label), el('dd', null, shown(f))])) : null,
    ...tables.map(tableEl),
    tables.length || info.length ? null : el('p', { class: 'muted', id: 'pzEmpty_' + s.screen }, 'Brak danych w Selly dla tego produktu.'),
    link);
}

const SECTIONS = {
  dodatkowe: [
    { screen: 'produkt-polecane', route: 'produkty.koszykPolecane', title: 'Polecane w koszyku', intro: 'Produkty i kategorie proponowane klientowi w koszyku przy tym produkcie.', tip: 'Lista powiązań „kup razem”. Edycja zostaje w Selly (formularz budowany skryptem).', edit: 'Edytuj w Selly ↗' },
    { screen: 'produkt-kategorie-dod', route: 'produkty.produktKategorieDodatkowe', title: 'Kategorie dodatkowe', intro: 'Dodatkowe kategorie, w których produkt jest widoczny w sklepie.', tip: 'Główną kategorię zmieniasz w zakładce „Podstawowe”. Dodatkowe zmienisz w Selly (lista wybierana skryptem).', edit: 'Edytuj w Selly ↗' },
    { screen: 'produkt-ceny-indyw', route: 'produkty.indywidualneCeny', title: 'Ceny indywidualne', intro: 'Ceny ustalone dla wybranych klientów (adresy e-mail i telefony są maskowane).', tip: 'Ceny indywidualne ustawiasz w Selly albo w karcie klienta.', edit: 'Edytuj w Selly ↗' },
    { screen: 'produkt-subskrypcje', route: 'produkty.produktSubskrypcje', title: 'Subskrypcje', intro: 'Ustawienia sprzedaży tego produktu w subskrypcji (okresy, wzór ceny).', tip: 'Tylko podgląd — edycja w Selly.', edit: 'Edytuj w Selly ↗' },
    { screen: 'produkt-aukcje', route: 'produkty.produktAukcje', title: 'Aukcje', intro: 'Ustawienia aukcji tego produktu (tytuł, cena, limity).', tip: 'Tylko podgląd — edycja i zdjęcia w Selly.', edit: 'Edytuj w Selly ↗' },
  ],
  historia: [
    { screen: 'produkt-historia-ceny', route: 'produkty.historiaCeny', title: 'Historia ceny', intro: 'Zmiany ceny tego produktu zapisane w Selly.', tip: 'Selly udostępnia tylko historię — nie da się jej edytować.' },
    { screen: 'produkt-zdarzenia', route: 'produkty.produktZdarzenia', title: 'Zdarzenia produktu', intro: 'Dziennik zmian produktu: kto i kiedy co zmienił.', tip: 'Tylko odczyt — to dziennik Selly.' },
  ],
};

/** Zakładka „Dodatkowe” / „Historia”: sekcje zwinięte, każda wczytuje się dopiero po otwarciu. */
function sections(host, id, kind) {
  host.replaceChildren(...SECTIONS[kind].map(s => {
    const body = el('div', { class: 'pz-body' });
    let loaded = false;
    const det = el('details', { class: 'pz-sec', id: 'pzSec_' + s.screen }, el('summary', { title: s.tip }, s.title), body);
    det.addEventListener('toggle', () => { if (det.open && !loaded) { loaded = true; readOnly(body, id, s); } });
    return det;
  }));
}

/** Punkt wejścia: kind = 'platnosci' | 'konfigurator' | 'dodatkowe' | 'historia'. */
export function mountProductTab(host, id, kind) {
  if (kind === 'platnosci') return editable(host, id, 'produkt-opcje', { route: 'produkty.produktOpcje', confirmTitle: 'Zapisać formy płatności i dostawy produktu?', saveLabel: 'Zapisz płatności i dostawę',
    intro: 'Które formy płatności i dostawy są dostępne dla tego produktu oraz ich koszt. Domyślnie decyduje kategoria — własną listę włączasz przełącznikiem „wg ustawień produktu”.', tip: 'Zmiana wpływa na to, co klient zobaczy w koszyku przy tym produkcie' });
  if (kind === 'konfigurator') return editable(host, id, 'produkt-wymiary', { route: 'produkty.produktWymiary', confirmTitle: 'Zapisać konfigurator wymiarów produktu?', saveLabel: 'Zapisz wymiary',
    intro: 'Produkt sprzedawany na wymiar: cennik za jednostkę oraz kształty i zakresy wymiarów wpisywanych przez klienta.', tip: 'Dotyczy tylko produktów sprzedawanych na wymiar (np. banery, tkaniny)' });
  return sections(host, id, kind);
}
