// „Wysyłka SpeedMail” → zakładka Ustawienia (sekcje 2–4, 6–8 specyfikacji): jedna strona, wszystkie części zwinięte.
// Lista produktów SpeedMail (ID Selly, opakowanie, kolumna w pliku, ilość wysłana, minimum, prognoza), rozbicia zestawów, terminy sezonu,
// formy dostawy liczone jako „Kurier”, statusy w Selly, progi alertów, plik dla SM, krzywa prognozy. Wspólne dla wszystkich (D1);
// zapis tylko administrator panelu (sm:configSave z wersją — dwie osoby nie nadpiszą sobie zmian). Walidacja: shared/speedmail.js.
// W „Tempo sprzedaży”: propozycje szczytów sprzedaży z poprzednich sezonów (sm:history, SM.peaks) — „Użyj” wstawia punkty prognozy do szkicu.
import { el, dateInput, flash } from '../core/ui.js?v=196affa';
import { S, SM, nf, dmy, notice, statusName, fold, save, reload, jobBusy, loadError } from './speedmailKit.js?v=196affa';

let draft = null;   // { of: wersja, cfg: kopia robocza, info: '' }
let peakYears = null;   // lata wybrane do propozycji szczytów (null = wszystkie z danymi)
const clone = x => JSON.parse(JSON.stringify(x));
const dirty = () => !!draft && JSON.stringify(draft.cfg) !== JSON.stringify(S.d.v.cfg);
function markDirty() {
  const bar = document.getElementById('smSetBar');
  if (bar) bar.hidden = !dirty();
}
const idsText = ids => ids.map(x => x.id + (Number(x.per) !== 1 ? '×' + nf(x.per).replace(/\s/g, '') : '')).join(', ');
const parseIds = t => String(t).split(/[,;\s]+/).filter(Boolean).map(x => { const m = /^(\d+)(?:[x×*]([\d.,]+))?$/i.exec(x); return m ? { id: m[1], per: m[2] ? m[2].replace(',', '.') : 1 } : { id: x, per: 1 }; });
const pointsText = pts => pts.map(p => p.day + ' = ' + nf(p.pct)).join('\n');
const parsePoints = t => String(t).split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => { const m = /^(\d{4}-\d{2}-\d{2})\s*[=:;]\s*([\d.,]+)\s*%?$/.exec(x); return m ? { day: m[1], pct: m[2] } : { day: x, pct: '' }; });

/** Pole tekstowe / liczbowe związane z polem obiektu roboczego (bez przerysowania przy pisaniu). */
function inp(obj, field, o = {}) {
  const e = el('input', { type: 'text', inputmode: o.num ? 'decimal' : null, class: 'sm-in' + (o.num ? ' n' : '') + (o.wide ? ' wide' : ''), value: o.get ? o.get(obj[field]) : (obj[field] == null ? '' : String(obj[field]).replace('.', o.num ? ',' : '.')),
    'aria-label': o.label, title: o.tip || null, maxlength: String(o.max || 120), placeholder: o.ph || null });
  e.addEventListener('input', () => { obj[field] = o.set ? o.set(e.value) : e.value.trim(); markDirty(); });
  return e;
}
const check = (obj, field, label, tip, o = {}) => {
  const c = el('input', { type: 'checkbox', disabled: o.disabled || null });
  c.checked = !!obj[field];
  c.addEventListener('change', () => { obj[field] = c.checked; markDirty(); });
  return el('label', { class: 'sm-check', title: tip || null }, c, ' ', el('span', { class: tip ? 'tip' : null }, label));
};
const thh = (label, tip) => el('th', null, el('span', { class: tip ? 'tip' : null, title: tip || label }, label));

export function viewSettings() {
  const v = S.d.v, admin = !!v.isAdmin;
  if (!draft || draft.of !== v.version) draft = { of: v.version, cfg: clone(v.cfg), info: '' };
  const c = draft.cfg, box = el('div', { id: 'smSettings' });
  const rerender = () => S.rerender();

  box.append(el('div', { class: 'card' },
    el('h3', { style: 'margin-top:0' }, 'Ustawienia SpeedMail'),
    el('p', { class: 'muted small', style: 'margin:0' }, 'Wspólne dla wszystkich użytkowników panelu. ' + (v.isDefault ? 'To ustawienia startowe ze specyfikacji — jeszcze nikt ich nie zapisał.' : 'Ostatnia zmiana: ' + (v.savedBy || '—') + ', ' + (v.savedMs ? new Date(v.savedMs).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—') + '.') +
      (admin ? '' : ' Zmienia je administrator panelu — tu widzisz je tylko do podglądu.')),
    draft.info ? notice('warn', draft.info) : null,
    el('div', { class: 'sm-setbar', id: 'smSetBar', hidden: !dirty() },
      el('strong', null, 'Masz niezapisane zmiany.'),
      el('button', { type: 'button', class: 'secondary', id: 'smSetUndo', onclick: () => { draft = null; rerender(); } }, 'Cofnij zmiany'),
      el('button', { type: 'button', class: 'primary', id: 'smSetSave', disabled: !admin || jobBusy(), title: admin ? 'Zapisuje ustawienia dla wszystkich użytkowników' : 'Ustawienia zapisuje tylko administrator panelu', onclick: saveCfg }, 'Zapisz ustawienia'))));

  const body = el('fieldset', { class: 'sm-set', disabled: admin ? null : true, 'aria-label': 'Ustawienia SpeedMail' });
  box.append(el('div', { class: 'card' }, body));

  // 1. Produkty
  const prefill = (field, variant, what) => el('button', { type: 'button', class: 'secondary small', title: 'Wstawia do kolumny „' + what + '” liczby z wariantu ' + variant + ' specyfikacji (plik v3). To tylko propozycja — sprawdź, popraw i zapisz. Bez zapisu nic się nie zmieni.',
    onclick: () => { for (const p of c.products) p[field] = variant === 'A' ? p.propA : p.propB; draft.info = 'Wstawiono PROPOZYCJĘ ze specyfikacji (wariant ' + variant + ') do kolumny „' + what + '”. Sprawdź liczby z faktycznie skompletowanym towarem, popraw i kliknij „Zapisz ustawienia” — dopiero wtedy zaczną obowiązywać.'; rerender(); } }, 'Propozycja ' + variant);
  body.append(fold('smSetProducts', ['Produkty SpeedMail', ' — ' + c.products.length + ' pozycji: ID w Selly, opakowanie, ilość wysłana, minimum, prognoza'],
    el('p', { class: 'muted small' }, 'Zamówienie idzie do SpeedMail tylko wtedy, gdy wszystkie jego produkty są na tej liście. Ilości w sztukach (OrszaKrówki w kg). „Wysłane” = ile towaru trafiło do SpeedMail na start sezonu.'),
    el('div', { class: 'toolbar', style: 'margin-top:0' },
      el('span', { class: 'tip', title: 'Liczby z tabeli w specyfikacji (kolumna „Do SM: A / B”). Wstawiane tylko na Twoje kliknięcie, jako propozycja do potwierdzenia.' }, 'Wstaw do „Wysłane”:'), prefill('sent', 'A', 'Wysłane'), prefill('sent', 'B', 'Wysłane'),
      el('span', { class: 'tip', title: 'Prognoza sezonu nie jest podana w specyfikacji osobno — jako punkt wyjścia można przyjąć ilości wariantu A / B i je poprawić.' }, 'do „Prognoza”:'), prefill('forecast', 'A', 'Prognoza sezonu'), prefill('forecast', 'B', 'Prognoza sezonu')),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smSetProdTable', class: 'sm-edit' },
      el('thead', null, el('tr', null,
        thh('Produkt'), thh('ID w Selly', 'Numery produktów w Selly, po przecinku. Gdy jedna sztuka w sklepie to kilka sztuk towaru, dopisz mnożnik: 146×50. Puste = produkt tylko w SpeedMail (np. gazety).'),
        thh('Jedn.', 'Jednostka, w której liczymy stan: szt., kg, kpl'), thh('Opakowanie', 'Ile jednostek ma jedno opakowanie SpeedMail (wiązka 50, paczka 100…). W pliku dla SpeedMail ilości są w opakowaniach.'), thh('Nazwa opak.', 'Jak nazywa się opakowanie: wiązka, paczka, rolka'),
        thh('Kolumna w pliku', 'Nagłówek kolumny tego produktu w tabeli zleceń dla SpeedMail'), thh('Kolejność', 'Kolejność kolumny w pliku (rosnąco). Jeden stały układ na cały sezon.'),
        thh('Wysłane', 'Ile wysłano do SpeedMail na start sezonu (stan początkowy). Dosyłki zapisuj w zakładce „Stan w SpeedMail”.'), thh('Minimum', 'Stałe minimum: poniżej tej ilości alert jest czerwony'),
        thh('Typowe zam.', 'Ile zwykle jest w jednym zamówieniu — do alertu żółtego (stan mniejszy niż kilka typowych zamówień)'), thh('Przedsprz.', 'Produkt z przedsprzedaży: SpeedMail wysyła go od dnia startu przedsprzedaży'),
        thh('Prognoza sezonu', 'Prognoza sprzedaży do końca sezonu — do zakładki „Tempo sprzedaży”'), thh('Usuń'))),
      el('tbody', null, c.products.map((p, i) => el('tr', { 'data-key': p.key },
        el('td', null, inp(p, 'name', { label: 'Nazwa produktu', wide: true })),
        el('td', null, inp(p, 'ids', { label: 'ID w Selly: ' + p.name, get: idsText, set: parseIds, ph: 'np. 8953, 8993' })),
        el('td', null, inp(p, 'unit', { label: 'Jednostka: ' + p.name, max: 10 })), el('td', null, inp(p, 'pack', { label: 'Opakowanie: ' + p.name, num: true })), el('td', null, inp(p, 'packName', { label: 'Nazwa opakowania: ' + p.name, max: 30 })),
        el('td', null, inp(p, 'col', { label: 'Kolumna w pliku: ' + p.name, wide: true })), el('td', null, inp(p, 'pos', { label: 'Kolejność: ' + p.name, num: true })),
        el('td', null, inp(p, 'sent', { label: 'Wysłane: ' + p.name, num: true, tip: 'Propozycja ze specyfikacji: wariant A ' + nf(p.propA) + ', wariant B ' + nf(p.propB) })),
        el('td', null, inp(p, 'min', { label: 'Minimum: ' + p.name, num: true })), el('td', null, inp(p, 'typical', { label: 'Typowe zamówienie: ' + p.name, num: true })),
        el('td', null, check(p, 'presale', '', 'Produkt z przedsprzedaży')), el('td', null, inp(p, 'forecast', { label: 'Prognoza sezonu: ' + p.name, num: true })),
        el('td', null, el('button', { type: 'button', class: 'ghost small', title: 'Usuń produkt z listy SpeedMail (nie da się, gdy ma już zapisane zlecenia albo korekty)', 'aria-label': 'Usuń ' + p.name,
          onclick: () => { c.products.splice(i, 1); for (const b of c.bundles) b.parts = b.parts.filter(x => x.key !== p.key); rerender(); } }, '✕'))))))),
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'smSetAddProd', onclick: () => {
      c.products.push({ key: 'p' + Date.now().toString(36), name: '', unit: 'szt.', pack: 1, packName: '', col: '', pos: (Math.max(0, ...c.products.map(x => Number(x.pos) || 0)) + 10), ids: [], sent: 0, min: 0, typical: 1, presale: false, forecast: 0, propA: 0, propB: 0 });
      rerender();
    } }, '+ Dodaj produkt'))));

  // 2. Rozbicia
  const prodSel = part => { const s = el('select', { 'aria-label': 'Składnik' }, c.products.map(p => el('option', { value: p.key }, p.name || '(bez nazwy)'))); s.value = part.key; s.addEventListener('change', () => { part.key = s.value; markDirty(); }); return s; };
  body.append(fold('smSetBundles', ['Rozbicia zestawów', ' — ' + c.bundles.length + ': pozycja zamówienia zamieniana na produkty SpeedMail (np. licencja)'],
    el('p', { class: 'muted small' }, 'Gdy Selly pokazuje zestaw jako jedną linię zamówienia, panel rozbija go na składniki wg tej listy. Gdy Selly sam rozbija zestaw w koszyku, składniki są zwykłymi pozycjami — oba przypadki działają.'),
    c.bundles.map((b, i) => el('div', { class: 'sm-bundle', 'data-id': String(b.id) },
      el('div', { class: 'toolbar', style: 'margin-top:0' }, el('label', { class: 'field-inline' }, 'ID w Selly', inp(b, 'id', { label: 'ID zestawu w Selly', max: 12 })), el('label', { class: 'field-inline' }, 'Nazwa', inp(b, 'name', { label: 'Nazwa zestawu', wide: true })),
        el('button', { type: 'button', class: 'ghost small', title: 'Usuń to rozbicie', onclick: () => { c.bundles.splice(i, 1); rerender(); } }, '✕ usuń')),
      el('ul', { class: 'sm-parts' }, b.parts.map((part, k) => el('li', null, inp(part, 'qty', { label: 'Ilość składnika', num: true }), ' × ', prodSel(part),
        el('button', { type: 'button', class: 'ghost small', title: 'Usuń składnik', 'aria-label': 'Usuń składnik', onclick: () => { b.parts.splice(k, 1); rerender(); } }, '✕'))),
      el('li', null, el('button', { type: 'button', class: 'ghost small', onclick: () => { if (c.products.length) { b.parts.push({ key: c.products[0].key, qty: 1 }); rerender(); } } }, '+ składnik'))))),
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', onclick: () => { c.bundles.push({ id: '', name: '', parts: [] }); rerender(); } }, '+ Dodaj rozbicie'))));

  // 3. Terminy
  const dateF = (obj, field, label, tip, id) => el('label', { class: 'field-inline', title: tip }, el('span', { class: 'tip' }, label), dateInput({ id, value: obj[field], label, title: tip, onChange: val => { obj[field] = val; markDirty(); } }));
  body.append(fold('smSetDates', ['Terminy sezonu', ' — SpeedMail pakuje od ' + dmy(c.dates.smStart) + ', przedsprzedaż od ' + dmy(c.dates.presaleStart) + ', ostatnie przekazanie ' + dmy(c.dates.lastHandover)],
    el('div', { class: 'mag-form' },
      dateF(c.dates, 'smStart', 'SpeedMail pakuje zamówienia bez przedsprzedaży od', 'Zamówienia bez przedsprzedaży złożone przed tym dniem pakujemy sami', 'smSetStart'),
      dateF(c.dates, 'presaleStart', 'Start wysyłki przedsprzedaży', 'Zamówienia z przedsprzedażą SpeedMail wysyła od tego dnia (także złożone wcześniej); do tego dnia zlecenia czekają', 'smSetPresale'),
      dateF(c.dates, 'lastHandover', 'Ostatni dzień przekazania zamówień do SpeedMail', 'Zamówienia złożone później — i wszystkie od następnego dnia — pakujemy sami', 'smSetLast'))));

  // 4. Formy dostawy
  const names = [...new Set(c.couriers.concat(v.deliveries))].sort((a, b) => a.localeCompare(b, 'pl'));
  body.append(fold('smSetDelivery', ['Formy dostawy „Kurier”', ' — do SpeedMail idą tylko: ' + (c.couriers.join(', ') || '—')],
    el('p', { class: 'muted small' }, 'Zaznacz formy dostawy, przy których zamówienie może pakować SpeedMail. Pozostałe (paczkomaty, odbiór osobisty, Orlen Paczka, Kurier DPD / UPS / PALETA, Ceneo) zawsze pakujemy sami. „SpeedMail” to forma dostawy licencji — liczona jak kurier (założenie ze specyfikacji).'),
    el('div', { class: 'statuses', id: 'smSetCouriers' }, names.map(n => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = c.couriers.includes(n);
      cb.addEventListener('change', () => { c.couriers = cb.checked ? c.couriers.concat([n]) : c.couriers.filter(x => x !== n); markDirty(); });
      return el('label', null, cb, ' ', n);
    })),
    el('label', { class: 'field-inline', title: 'Produkt, w którego nazwie albo wariancie występuje to słowo, uznajemy za „produkt z lokalizacją” — takie zamówienie zawsze pakujemy sami. Puste = nie sprawdzaj.' },
      el('span', { class: 'tip' }, 'Słowo oznaczające produkt z lokalizacją'), inp(c, 'locationWord', { label: 'Słowo oznaczające produkt z lokalizacją', max: 40 }))));

  // 5. Statusy
  const stSel = (field, label, tip) => { const s = el('select', { 'aria-label': label }, el('option', { value: '' }, '— dobierz po nazwie (' + (statusName(v.use[field]) || 'brak') + ') —'), v.statuses.map(x => el('option', { value: x.id }, x.name))); s.value = c.statuses[field] || '';
    s.addEventListener('change', () => { c.statuses[field] = s.value; markDirty(); }); return el('label', { title: tip }, el('span', { class: 'tip' }, label), s); };
  body.append(fold('smSetStatuses', ['Statusy w Selly', ' — zamówienia z: ' + (v.use.open.map(statusName).join(', ') || '—')],
    el('div', { class: 'mag-form' },
      stSel('sm', 'Status po przekazaniu do SpeedMail', 'Ustawiany, gdy zapisujesz paczkę zleceń (domyślnie „Złożone SpeedMail”)'),
      stSel('acc', 'Status, gdy SpeedMail przyjął', 'Ustawiany przyciskiem w zakładce „Paczki zleceń” (domyślnie „Przyjęte SpeedMail”; w 2025 było „ZREALIZOWANO SpeedMail”)'),
      stSel('otk', 'Status dla zamówień pakowanych u nas', 'Ustawiany przyciskiem „Zostają u nas” (domyślnie „Złożone OTK”)')),
    el('p', { class: 'muted small', style: 'margin-top:var(--s3)' }, el('span', { class: 'tip', title: 'Zakładka „Zamówienia” pokazuje zamówienia w zaznaczonych statusach (oraz w statusie „po przekazaniu do SpeedMail”). Nic nie zaznaczone = statusy o nazwach Nowe / Złożone / Opłacone.' }, 'Z jakich statusów panel bierze zamówienia do decyzji:')),
    el('div', { class: 'statuses', id: 'smSetOpen' }, v.statuses.map(x => {
      const cb = el('input', { type: 'checkbox' }); cb.checked = c.statuses.open.includes(x.id);
      cb.addEventListener('change', () => { c.statuses.open = cb.checked ? c.statuses.open.concat([x.id]) : c.statuses.open.filter(y => y !== x.id); markDirty(); });
      return el('label', null, cb, ' ', x.name);
    }))));

  // 6. Progi
  const T = c.thresholds, numF = (field, label, tip) => el('label', { title: tip }, el('span', { class: 'tip' }, label), inp(T, field, { label, num: true }));
  body.append(fold('smSetAlerts', ['Progi alertów', ' — zielony powyżej ' + nf(T.greenDays) + ' dni, czerwony poniżej ' + nf(T.redDays) + ' dni'],
    el('p', { class: 'muted small' }, 'Progi ze specyfikacji są założeniem do potwierdzenia. Minimum i typowe zamówienie każdego produktu ustawiasz w „Produkty SpeedMail”.'),
    el('div', { class: 'mag-form' },
      numF('greenDays', 'Zielony: zapas na więcej niż (dni)', 'Dni zapasu = stan ÷ średnia dzienna zleconych z ostatnich 7 dni'), numF('redDays', 'Czerwony: zapas na mniej niż (dni)', 'Między czerwonym a zielonym progiem alert jest żółty'),
      numF('typicalFactor', 'Żółty: stan mniejszy niż tyle typowych zamówień', 'Np. 2 = alert żółty, gdy w SpeedMail zostało mniej niż 2 typowe zamówienia'),
      numF('presalePct', 'Przedsprzedaż: alert, gdy zlecone przekroczą (% towaru w SpeedMail)', 'Zlecenia z przedsprzedażą czekają w SpeedMail do startu wysyłki — alert, gdy zajmą prawie cały towar'),
      numF('pacePct', 'Tempo sprzedaży: sygnał przy różnicy ponad (%)', 'Sygnał „szybciej / wolniej niż prognoza” w zakładce „Tempo sprzedaży”'))));

  // 7. Plik
  body.append(fold('smSetFile', ['Plik dla SpeedMail', ' — kolumny przed produktami'],
    el('p', { class: 'muted small' }, 'Jeden wiersz = jedno zamówienie, produkty w kolumnach w stałej kolejności (z „Produkty SpeedMail”), ilości w opakowaniach. Nazwa pliku: data i numer paczki.'),
    el('div', { class: 'statuses' },
      check(c.file, 'orderNo', 'Numer zamówienia', 'Kolumna z numerem zamówienia z Selly'), check(c.file, 'date', 'Data zamówienia', 'Kolumna z datą złożenia zamówienia'),
      check(c.file, 'batch', 'Numer paczki zleceń', 'Kolumna z numerem paczki (ten sam w każdym wierszu pliku)'), check(c.file, 'total', 'Wiersz „Razem”', 'Ostatni wiersz z sumą opakowań każdego produktu'),
      check({ address: false }, 'address', 'Dane do wysyłki (adres, telefon) — wyłączone', 'Wyłączone do czasu potwierdzenia szablonu SpeedMail: nie wiemy jeszcze, czy SpeedMail wymaga danych adresowych w tabeli i w jakim układzie (pytanie otwarte nr 1 ze specyfikacji). Panel nie eksportuje danych osobowych klientów, dopóki tego nie ustalimy.', { disabled: true }))));

  // 8. Tempo
  body.append(fold('smSetPace', ['Tempo sprzedaży', ' — od ' + dmy(c.pace.from) + ' do ' + dmy(c.pace.to) + (c.pace.points.length ? ', ' + c.pace.points.length + ' punkty prognozy' : ', prognoza liniowa (założenie)')],
    el('div', { class: 'mag-form' },
      dateF(c.pace, 'from', 'Początek sprzedaży sezonu', 'Od tego dnia liczymy sprzedaż narastająco', 'smSetPaceFrom'), dateF(c.pace, 'to', 'Koniec sezonu', 'Dzień, w którym sprzedaż powinna osiągnąć 100% prognozy', 'smSetPaceTo')),
    el('label', { title: 'Jak sprzedaż rozkłada się w czasie. Jeden punkt w wierszu: data = procent prognozy sprzedany do tego dnia, np. „2026-12-01 = 40”. Bez punktów panel przyjmuje równą sprzedaż każdego dnia (prosta) — to uproszczenie.' },
      el('span', { class: 'tip' }, 'Punkty prognozy (data = % prognozy sprzedany do tego dnia)'),
      (() => { const t = el('textarea', { id: 'smSetPoints', rows: '4', 'aria-label': 'Punkty prognozy', placeholder: '2026-11-16 = 15\n2026-12-01 = 45\n2026-12-15 = 85' }); t.value = pointsText(c.pace.points); t.addEventListener('input', () => { c.pace.points = parsePoints(t.value); markDirty(); }); return t; })()),
    peakBox(c, v.cfg, rerender)));

  // 9. Zaawansowane
  if (admin) {
    box.append(el('div', { class: 'card sm-foldcard' }, fold('smSetTools', ['Narzędzia administratora', ' — przeliczenie sum stanu'],
      el('p', { class: 'muted small' }, 'Stan SpeedMail jest liczony na bieżąco z sum aktualizowanych przy każdym zapisie. Przeliczenie odbudowuje te sumy z rejestru zleceń i korekt — użyj, gdy liczby budzą wątpliwość.'),
      el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'smRecount', disabled: jobBusy(), onclick: async () => { const r = await save('sm:recount', {}, 'Przeliczono sumy stanu'); if (r) await reload('init'); } }, 'Przelicz sumy stanu')))));
  }
  return box;
}

const PEAK_TIP = 'Jak liczymy: dla każdego poprzedniego sezonu (te same daty, rok wcześniej) bierzemy liczbę zamówień z produktami SpeedMail na każdy dzień ' +
  '(statusy liczone jako zakup) i zamieniamy ją na udział w sprzedaży całego sezonu — żeby rok z większą sprzedażą nie zagłuszył pozostałych. Udziały uśredniamy ' +
  'i szukamy ' + SM.HIST.top + ' rozłącznych okresów po ' + SM.HIST.win + ' dni z największym średnim udziałem. Daty pokazujemy w tegorocznym kalendarzu (ten sam dzień i miesiąc). ' +
  'Dane z kopii zamówień w panelu — bez zapytań do Selly.';
const ddmm = d => dmy(d).slice(0, 5);

/** Propozycje szczytów sprzedaży z poprzednich sezonów + „Użyj” (punkty prognozy do szkicu ustawień). */
function peakBox(c, saved, rerender) {
  const e = S.hist, H = e && e.v && Array.isArray(e.v.seasons) ? e.v : null;
  const head = el('h4', { style: 'margin:var(--s4) 0 var(--s2)' }, el('span', { class: 'tip', title: PEAK_TIP }, 'Szczyty sprzedaży w poprzednich sezonach'));
  if (!H) {
    if (S.loading.hist) return el('div', { id: 'smSetPeaks' }, head, el('p', { class: 'muted small', role: 'status' }, el('span', { class: 'spinner' }), ' wczytuję sprzedaż z poprzednich sezonów…'));
    return el('div', { id: 'smSetPeaks' }, head, loadError('hist', 'sprzedaż z poprzednich sezonów') || el('p', { class: 'muted small' }, 'Brak danych z poprzednich sezonów.'));
  }
  const all = H.seasons.filter(x => x.total > 0).map(x => x.year);
  if (!all.length) return el('div', { id: 'smSetPeaks' }, head, el('p', { class: 'muted small', id: 'smSetPeaksNone' }, 'W kopii zamówień nie ma sprzedaży produktów SpeedMail w tych samych datach w poprzednich latach — nie ma z czego policzyć szczytów. Jeśli w poprzednich latach produkty miały w Selly inne ID, dopisz je w „Produkty SpeedMail”.'));
  const years = peakYears ? all.filter(y => peakYears.has(y)) : all;
  const pk = SM.peaks(H, years.length ? years : all);
  const same = H.from === c.pace.from && saved.pace.from === c.pace.from && saved.pace.to === c.pace.to;
  const why = same ? null : 'Najpierw zapisz zmienione daty sezonu — propozycje są liczone dla zapisanego zakresu dat';
  const use = (windows, what) => {
    c.pace.points = SM.peakPoints(c, pk, windows);
    draft.info = 'Wstawiono PROPOZYCJĘ punktów prognozy (' + what + ', średnia z sezonów ' + pk.years.join(', ') + '). Sprawdź je w polu „Punkty prognozy” i kliknij „Zapisz ustawienia” — dopiero wtedy zaczną obowiązywać.';
    rerender();
  };
  const useTip = 'Wstawia do „Punkty prognozy” procent sprzedaży narastająco ze średniej poprzednich sezonów: na dzień przed i na koniec tego szczytu oraz co 14 dni. Zastępuje obecne punkty; nic się nie zmieni bez „Zapisz ustawienia”.';
  const yearPick = fold('smSetPeakYears', ['Z których sezonów liczyć', ' — ' + (years.length && years.length < all.length ? years.join(', ') : 'wszystkie z danymi (' + all.join(', ') + ')')],
    el('p', { class: 'muted small' }, 'Odznacz sezon nietypowy (np. inny termin wydarzenia), żeby nie zniekształcał średniej. Wybór obowiązuje tylko na tym ekranie.'),
    el('div', { class: 'statuses', id: 'smSetPeakYearList' }, all.map(y => {
      const cb = el('input', { type: 'checkbox', value: String(y) });
      cb.checked = years.includes(y);
      cb.addEventListener('change', () => { const set = new Set(years); if (cb.checked) set.add(y); else set.delete(y); peakYears = set.size && set.size < all.length ? set : null; rerender(); });
      const s0 = H.seasons.find(x => x.year === y);
      return el('label', { title: 'Sezon ' + y + ': ' + dmy(s0.from) + '–' + dmy(s0.to) + ', ' + s0.total.toLocaleString('pl-PL') + ' zamówień z produktami SpeedMail' }, cb, ' ', String(y));
    })));
  return el('div', { id: 'smSetPeaks' }, head,
    el('p', { class: 'muted small', style: 'margin-top:0' }, 'Okresy, w których w poprzednich latach sprzedawało się najwięcej (najlepsze ' + SM.HIST.win + '-dniowe okresy, średnio z sezonów ' + pk.years.join(', ') + '). ',
      pk.core ? el('span', { class: 'tip', id: 'smSetPeakCore', title: 'Najkrótszy okres, w którym średnio przypadała połowa sprzedaży sezonu' }, 'Połowa sprzedaży przypadała zwykle na ' + ddmm(pk.core.from) + '–' + ddmm(pk.core.to) + '.') : null),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smSetPeakTable' },
      el('thead', null, el('tr', null, thh('Okres', 'Daty w tegorocznym kalendarzu (ten sam dzień i miesiąc co w poprzednich latach)'),
        thh('Udział w sezonie', 'Średni udział tych dni w liczbie zamówień całego sezonu'), thh('Zamówień w latach', 'Liczba zamówień z produktami SpeedMail w tych samych datach w każdym z sezonów'), thh('Użyj'))),
      el('tbody', null, pk.top.map((w, i) => el('tr', { 'data-from': w.from },
        el('td', { class: 'nw' }, ddmm(w.from) + '–' + ddmm(w.to)), el('td', { class: 'n' }, nf(Math.round(w.share * 10) / 10) + '%'),
        el('td', null, w.perYear.map(x => x.year + ': ' + x.orders.toLocaleString('pl-PL')).join(' · ')),
        el('td', null, el('button', { type: 'button', class: 'secondary small', id: 'smSetPeakUse' + i, disabled: why ? true : null, title: why || useTip, onclick: () => use([w], 'szczyt ' + ddmm(w.from) + '–' + ddmm(w.to)) }, 'Użyj'))))))),
    el('p', { class: 'muted small', id: 'smSetPeakEach', title: 'Najlepszy ' + SM.HIST.win + '-dniowy okres osobno w każdym roku (daty z tamtego roku)' },
      'Najlepszy tydzień w każdym roku: ' + pk.each.slice().sort((a, b) => b.year - a.year).map(x => x.year + ' — ' + ddmm(x.from) + '–' + ddmm(x.to) + ' (' + x.orders.toLocaleString('pl-PL') + ' zam.)').join('; ') + '.'),
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'smSetPeakUseAll', disabled: why ? true : null,
      title: why || 'Wstawia do „Punkty prognozy” krzywą ze średniej poprzednich sezonów: punkty na granicach wszystkich szczytów z tabeli oraz co 14 dni. Zastępuje obecne punkty; nic się nie zmieni bez „Zapisz ustawienia”.',
      onclick: () => use(pk.top, 'wszystkie szczyty') }, 'Użyj krzywej z poprzednich sezonów')),
    yearPick);
}

async function saveCfg() {
  let cfg;
  try { cfg = SM.checkConfig(clone(draft.cfg)); } catch (e) { S.err = 'Nie zapisano: ' + e.message; S.rerender(); return; }
  const r = await save('sm:configSave', { cfg, version: draft.of });
  if (!r) return;
  draft = null;
  flash('', 'Zapisano ustawienia SpeedMail');
  await reload('init', 'hist');
}

/** Czy są niezapisane zmiany ustawień (ostrzeżenie przy wyjściu z zakładki). */
export const settingsDirty = () => !!S.d && dirty();
