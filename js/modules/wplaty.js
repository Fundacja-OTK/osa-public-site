// Moduł „Import wpłat bankowych” (dodatek OSA; Selly ma tylko masową zmianę opłacenia). Przebieg:
// 1) wybierasz plik CSV z wyciągiem (czytany i parsowany TYLKO w tej przeglądarce — nic nie jest wysyłane ani logowane),
// 2) panel dopasowuje wpłaty do nieopłaconych zamówień (numer w tytule, kwota, nazwisko/e-mail; punktacja i powody),
// 3) przeglądasz tabelę (pewne / prawdopodobne / brak) i zaznaczasz, co oznaczyć jako opłacone,
// 4) zapis przez Worker (payments:apply — do serwera idą wyłącznie numery zamówień i kwoty „zapłacono”), podsumowanie i „Cofnij”.
import { el, money, cnt, plural, isUnavailable, loadingBox, pageToolbar, flash, store, sortTh, norm } from '../core/ui.js?v=79bd162';
import { api } from '../core/client.js?v=79bd162';
import { BANKS, FORMATS, parseStatement, skipReasons } from './wplatyUniversal.js?v=79bd162';
import { loadMapping, saveMapping } from './wplatyCsv.js?v=79bd162';
import { matchTransactions, RULES, cleanSettings, defaultSettings, newPaid, scorePair } from './wplatyMatch.js?v=79bd162';

const zl = v => money(v) + ' zł';
const SKEY = 'osa-wplaty-rules', DKEY = 'osa-wplaty-days';
const LEVEL = {
  sure: { label: 'pewne', tone: 'ok', tip: 'Numer zamówienia (lub e-mail) i kwota się zgadzają, a żadne inne zamówienie nie pasuje równie dobrze. Zaznaczone domyślnie.' },
  probable: { label: 'prawdopodobne', tone: 'warn', tip: 'Coś się zgadza, ale nie wszystko (np. brak numeru, inna kwota albo kilka podobnych zamówień). Sprawdź i zaznacz sam.' },
  none: { label: 'brak dopasowania', tone: 'neutral', tip: 'Nie znaleziono zamówienia, które pasuje do tej wpłaty. Możesz wskazać zamówienie ręcznie (numer w ostatniej kolumnie).' },
};
const S = { root: null, seq: 0, orders: null, truncated: false, days: 120, parsed: null, file: null, opts: { decimal: 'auto', separator: '', headerRow: null, mapping: null }, rules: cleanSettings(store(SKEY)),
  rows: [], filter: 'all', sort: { sort: 'level', dir: 'asc' }, running: false, result: null, undone: false };
const $ = id => document.getElementById(id);
const byNumber = () => { const m = new Map(); for (const o of S.orders || []) m.set(norm(o.number), o); return m; };
const orderLabel = o => o.number + ' · ' + ([o.firstName, o.lastName].filter(Boolean).join(' ') || o.company || o.email || '—') + ' · do zapłaty ' + zl(o.total - (o.paid || 0));

// ─── Pomocnicze ─────────────────────────────────────────────────────────
function hint(text) { return el('p', { class: 'muted wp-hint' }, text); }
function field(label, control, tip) { return el('label', { class: 'field-inline wp-f', title: tip || null }, tip ? el('span', { class: 'tip' }, label) : label, control); }
function dialog({ id, title, body, ok, okClass, onOk }) {
  const prev = document.activeElement;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  const cancel = el('button', { type: 'button', class: 'secondary', id: id + 'Cancel', onclick: close }, 'Anuluj');
  const wrap = el('div', { class: 'bm-modal', id }, el('div', { class: 'bm-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('h3', null, title), body, el('div', { class: 'bm-row bm-dlg-actions' }, cancel, el('button', { type: 'button', class: okClass || 'primary', id: id + 'Ok', onclick: () => { close(); onOk(); } }, ok))));
  document.addEventListener('keydown', onKey, true);
  document.body.append(wrap);
  cancel.focus();
}

// ─── Krok 1: plik ───────────────────────────────────────────────────────
function fileCard() {
  const input = el('input', { type: 'file', id: 'wpFile', accept: '.csv,.txt,.xml,.sta,.mt940,.940,text/csv,text/plain,text/xml,application/xml', 'aria-label': 'Plik wyciągu (camt.053 / MT940 / CSV)', title: 'Plik pobrany z bankowości internetowej (historia rachunku → eksport). Najlepiej camt.053 (XML) lub MT940, jeśli bank je oferuje; CSV też działa.',
    onchange: () => { if (input.files[0]) loadFile(input.files[0]); } });
  const drop = el('div', { class: 'wp-drop', id: 'wpDrop', title: 'Upuść tu plik wyciągu albo kliknij „Wybierz plik”' }, el('div', null, 'Upuść plik wyciągu (camt.053, MT940 lub CSV) tutaj albo'), input);
  ['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, ev => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', ev => { const f = ev.dataTransfer && ev.dataTransfer.files[0]; if (f) loadFile(f); });
  return el('section', { class: 'card bm-card', id: 'wpStep1' }, el('h2', null, el('span', { class: 'bm-num' }, '1'), 'Wczytaj wyciąg z banku'),
    el('p', { class: 'wp-privacy', id: 'wpPrivacy', title: 'Plik jest czytany i analizowany w pamięci tej karty przeglądarki. Do serwera trafiają dopiero numery zaznaczonych zamówień i kwoty zapłacone.' },
      '🔒 Wyciąg zostaje w Twojej przeglądarce — nie wysyłamy go na serwer ani nigdzie nie zapisujemy. Do Selly trafia tylko numer zamówienia i kwota zapłacona.'),
    drop, el('p', { class: 'muted wp-hint' }, 'Działa z każdym bankiem: formaty standardowe (camt.053 / camt.052 XML, MT940) oraz pliki CSV/TXT — kodowanie, separator, kolumny i zapis kwot rozpoznajemy sami. Gdy plik jest nietypowy, poprosimy o wskazanie kolumn (zapamiętamy to na przyszłość).'),
    el('details', { class: 'bm-opts', id: 'wpHelp' }, el('summary', { title: 'Jak pobrać wyciąg z bankowości internetowej' }, 'Jak pobrać wyciąg z banku?'),
      el('ol', { class: 'muted' },
        el('li', null, 'Zaloguj się do bankowości internetowej i wejdź w historię operacji (lub „Wyciągi”) rachunku, na który wpływają płatności.'),
        el('li', null, 'Ustaw zakres dat (np. ostatnie 2–4 tygodnie) i kliknij „Eksport” / „Pobierz” / „Zapisz jako”.'),
        el('li', null, 'Jeśli bank daje wybór, wybierz „camt.053” (XML) lub „MT940” — są najdokładniejsze. Inaczej wystarczy CSV (najlepiej z kolumnami: data, kwota, nadawca, tytuł).'),
        el('li', null, 'Wczytaj pobrany plik tutaj. Plik zostaje w tej przeglądarce — nie trafia na żaden serwer.'))),
    el('div', { id: 'wpFileInfo' }));
}

async function loadFile(file) {
  const my = ++S.seq;
  if (file.size > 8 * 1024 * 1024) { setInfo('Plik jest za duży (maks. 8 MB) — to raczej nie jest wyciąg bankowy.', true); return; }
  S.file = file; S.opts = { decimal: 'auto', separator: '', headerRow: null, mapping: null }; S.result = null; S.undone = false; S.remembered = false;
  try { S.bytes = new Uint8Array(await file.arrayBuffer()); } catch (e) { setInfo('Nie udało się odczytać pliku.', true); return; }
  if (my !== S.seq) return;
  reparse(); await ensureOrders(true);
}

function reparse() {
  const o = { decimal: S.opts.decimal };
  if (S.opts.separator) o.separator = S.opts.separator;
  if (S.opts.headerRow != null) o.headerRow = S.opts.headerRow;
  if (S.opts.mapping) o.mapping = S.opts.mapping;
  try {
    S.parsed = parseStatement(S.bytes, o);
    // układ kolumn już wskazany wcześniej (klucz = skrót nazw kolumn, bez danych) → użyj automatycznie
    if (S.parsed.needsMapping && !S.opts.mapping && S.parsed.format === 'csv' && S.parsed.signature) {
      const mem = loadMapping(S.parsed.signature, localStorage);
      if (mem && mem.mapping) { S.opts.mapping = mem.mapping; S.opts.headerRow = mem.headerRow; S.remembered = true; S.parsed = parseStatement(S.bytes, { ...o, mapping: mem.mapping, headerRow: mem.headerRow }); }
    }
  } catch (e) { S.parsed = null; setInfo('Nie udało się odczytać tego pliku (nieznany lub uszkodzony format).', true); return; }
  paintInfo();
  if (S.orders) rematch();
}

function setInfo(text, bad) { const b = $('wpFileInfo'); if (b) b.replaceChildren(el('p', { class: bad ? 'empty error' : 'muted', id: 'wpFileMsg' }, text)); }

function paintInfo() {
  const p = S.parsed, box = $('wpFileInfo');
  if (!box || !p) return;
  const parts = [];
  const csv = p.format === 'csv', nOps = p.total || (p.txs.length + p.skipped.debits);
  parts.push(el('p', { id: 'wpDetected' }, el('b', null, S.file.name), ' — Rozpoznano: ',
    el('span', { class: 'tip', title: csv ? 'Plik tekstowy z kolumnami. Bank rozpoznany po nazwach kolumn; „Inny bank” = kolumny dobrane automatycznie lub wskazane ręcznie.' : 'Format standardowy — nie wymaga wskazywania kolumn.' }, csv ? (p.needsMapping ? 'plik CSV/TXT (nieznany układ)' : 'CSV' + (p.bank && p.bank !== 'generic' ? ' — ' + BANKS[p.bank] : '')) : FORMATS[p.format]),
    ', kodowanie ' + p.encoding + (csv ? ', separator „' + (p.separator === '	' ? 'tabulator' : p.separator) + '”' : '') + '. ',
    p.needsMapping ? 'Nie jestem pewien, która kolumna jest którą — wskaż niżej.' : el('span', null, cnt(nOps, 'operacja', 'operacje', 'operacji') + ', ', el('b', null, cnt(p.txs.length, 'wpłata', 'wpłaty', 'wpłat') + ' (wpływy)'), '.'),
    S.remembered ? el('span', { class: 'muted', id: 'wpRemembered', title: 'Ten układ kolumn już wskazywałeś — użyto zapamiętanego mapowania (zapisanego tylko w tej przeglądarce).' }, ' Użyto zapamiętanego mapowania kolumn.') : ''));
  const why = p.needsMapping ? [] : skipReasons(p.skipped);
  if (why.length) parts.push(el('p', { class: 'muted', id: 'wpSkipped', title: 'Tylko wpływy trafiają do dopasowania. Reszta wiersza z pliku jest pomijana z podanego powodu.' }, 'Pominięto: ' + why.map(w => w.n + ' ' + w.text).join('; ') + '.'));
  if (p.needsMapping) parts.push(mappingForm(p));
  if (csv) parts.push(el('details', { class: 'bm-opts', id: 'wpFmt' }, el('summary', { title: 'Zmień rozpoznany separator, wiersz nagłówka lub zapis kwot — potrzebne tylko, gdy kwoty lub kolumny wyglądają źle' }, 'Format pliku (zaawansowane)'),
    el('div', { class: 'bm-row' },
      field('Separator', el('select', { id: 'wpSep', onchange: ev => { S.opts.separator = ev.target.value; S.opts.headerRow = null; S.opts.mapping = null; reparse(); } },
        [['', 'rozpoznaj automatycznie'], [';', 'średnik ;'], [',', 'przecinek ,'], ['\t', 'tabulator'], ['|', 'kreska |']].map(([v, l]) => el('option', { value: v, selected: v === S.opts.separator }, l))), 'Znak oddzielający kolumny w pliku'),
      field('Zapis kwot', el('select', { id: 'wpDec', onchange: ev => { S.opts.decimal = ev.target.value; reparse(); } },
        [['auto', 'rozpoznaj automatycznie'], ['comma', 'przecinek dziesiętny (12,50)'], ['dot', 'kropka dziesiętna (12.50)']].map(([v, l]) => el('option', { value: v, selected: v === S.opts.decimal }, l))), 'Jak w pliku zapisane są grosze. Zmień, jeśli kwoty wychodzą 100 razy za duże lub za małe.'),
      field('Wiersz nagłówka', el('input', { type: 'number', id: 'wpHdr', min: '1', value: String(p.headerRow + 1), class: 'wp-num', onchange: ev => { S.opts.headerRow = Math.max(0, (parseInt(ev.target.value, 10) || 1) - 1); S.opts.mapping = null; reparse(); } }), 'Numer wiersza z nazwami kolumn (od 1). Wiersze powyżej są pomijane.'))));
  box.replaceChildren(...parts);
}

function mappingForm(p) {
  const roles = [['date', 'Data', 'Data księgowania lub operacji'], ['amount', 'Kwota (wpływ dodatni)', 'Jedna kolumna z kwotą: wpływy dodatnie, wydatki ujemne'], ['credit', 'Wpływy (osobna kolumna)', 'Tylko gdy bank ma osobne kolumny uznań i obciążeń — wskaż kolumnę uznań'],
    ['debit', 'Wydatki (osobna kolumna)', 'Opcjonalnie: kolumna obciążeń, gdy jest osobno'], ['title', 'Tytuł / opis', 'Tytuł przelewu — tu szukamy numeru zamówienia'], ['party', 'Płatnik', 'Nazwa nadawcy (do porównania z klientem)'], ['account', 'Rachunek płatnika', 'Opcjonalnie: numer konta nadawcy']];
  const m = Object.assign({ date: -1, amount: -1, credit: -1, debit: -1, title: -1, party: -1, account: -1, desc: -1 }, p.suggest || {}, S.opts.mapping || {});
  const sels = roles.map(([k, label, tip]) => field(label, el('select', { id: 'wpMap-' + k, onchange: ev => { m[k] = Number(ev.target.value); } },
    el('option', { value: '-1' }, '— brak —'), p.headers.map((h, i) => el('option', { value: String(i), selected: m[k] === i }, (h || 'kolumna ' + (i + 1)).slice(0, 40)))), tip));
  const width = Math.max(p.headers.length, ...p.sample.map(r => r.length));
  const sample = el('div', { class: 'table-wrap', id: 'wpSample', title: 'Podgląd pierwszych wierszy po zamaskowaniu: imiona, nazwy i numery są ukryte (zostają pierwsze litery), daty i kwoty widać.' },
    el('table', null, el('thead', null, el('tr', null, Array.from({ length: width }, (_, i) => el('th', { title: p.headers[i] || 'kolumna ' + (i + 1) }, (p.headers[i] || 'kolumna ' + (i + 1)).slice(0, 30))))),
      el('tbody', null, p.sample.map(r => el('tr', null, Array.from({ length: width }, (_, i) => el('td', null, r[i] || '')))))));
  return el('div', { id: 'wpMapBox' }, el('p', { class: 'muted' }, 'Poniżej podgląd kilku wierszy (dane osobowe zamaskowane). Dopasowaliśmy kolumny na podstawie zawartości — sprawdź i popraw.'), sample,
    el('div', { class: 'bm-row', id: 'wpMapping' }, sels, el('button', { type: 'button', class: 'primary', id: 'wpMapOk', title: 'Wczytaj wpłaty według wskazanych kolumn i zapamiętaj ten układ w tej przeglądarce',
      onclick: () => {
        if (m.date < 0 || (m.amount < 0 && m.credit < 0)) { flash(null, 'Wskaż co najmniej kolumnę z datą i z kwotą.'); return; }
        S.opts.mapping = { ...m }; S.opts.headerRow = p.headerRow; saveMapping(p.signature, { headerRow: p.headerRow, mapping: S.opts.mapping }, localStorage); reparse();
      } }, 'Wczytaj wpłaty')));
}

// ─── Zamówienia do dopasowania ─────────────────────────────────────────
async function ensureOrders(force) {
  if (S.orders && !force) { rematch(); return; }
  const box = $('wpReview'); if (box) box.replaceChildren(loadingBox('Wczytuję nieopłacone zamówienia…'));
  const my = ++S.seq;
  try {
    const r = await api('payments:candidates', { days: S.days });
    if (my !== S.seq) return;
    S.orders = r.rows.map(o => ({ ...o, total: Number(o.total) || 0, paid: Number(o.paid) || 0 })); S.truncated = r.truncated; S.maxBatch = r.maxBatch || 12;
    rematch();
  } catch (e) {
    if (my !== S.seq) return;
    S.root.querySelector('#wpReview').replaceChildren(el('div', { class: 'empty error', id: 'wpError' }, isUnavailable(e) ? 'Import wpłat wymaga backendu Cloudflare — chwilowo niedostępny, użyj masowej zmiany w panelu Selly.' : 'Nie udało się wczytać zamówień: ' + e.message,
      ' ', el('button', { type: 'button', class: 'secondary', onclick: () => ensureOrders(true) }, 'Spróbuj ponownie')));
  }
}

function rematch() {
  if (!S.parsed || S.parsed.needsMapping || !S.orders) { paintReview(); return; }
  const res = matchTransactions(S.parsed.txs, S.orders, S.rules);
  S.rows = res.map((r, i) => ({ i, tx: r.tx, cands: r.candidates, notes: r.notes, level: r.level, sel: r.level === 'none' ? '' : r.best.order.id, checked: r.level === 'sure', status: '', manual: false }));
  paintReview();
}

const orderOf = id => (S.orders || []).find(o => o.id === id);
const selScore = r => { const c = r.cands.find(x => x.order.id === r.sel); return c ? c : (r.sel ? scorePair(r.tx, orderOf(r.sel), S.rules) : null); };

// ─── Krok 3: tabela przeglądu ───────────────────────────────────────────
const LEVEL_RANK = { sure: 0, probable: 1, none: 2 };
function sortedRows() {
  const f = S.filter, list = S.rows.filter(r => f === 'all' || r.level === f);
  const { sort, dir } = S.sort, sgn = dir === 'asc' ? 1 : -1;
  const key = {
    level: r => LEVEL_RANK[r.level] * 1000 - ((selScore(r) || {}).score || 0), date: r => r.tx.date, amount: r => r.tx.amount, payer: r => norm(r.tx.party), title: r => norm(r.tx.title),
    order: r => { const o = r.sel && orderOf(r.sel); return o ? norm(o.number) : ''; }, score: r => (selScore(r) || {}).score || 0,
  }[sort] || (() => 0);
  const empty = v => v === '' || v == null;
  return list.slice().sort((a, b) => { const x = key(a), y = key(b); if (empty(x) !== empty(y)) return empty(x) ? 1 : -1; return (x < y ? -1 : x > y ? 1 : 0) * sgn || a.i - b.i; });
}
function counts() { const c = { sure: 0, probable: 0, none: 0, checked: 0, sum: 0, done: 0 }; for (const r of S.rows) { c[r.level]++; if (r.status === 'ok') c.done++; else if (r.checked && r.sel) { c.checked++; c.sum += r.tx.amount; } } return c; }

function paintReview() {
  const box = $('wpReview'); if (!box) return;
  if (!S.parsed) { box.replaceChildren(); return; }
  if (S.parsed.needsMapping) { box.replaceChildren(); return; }
  if (!S.orders) { box.replaceChildren(loadingBox('Wczytuję nieopłacone zamówienia…')); return; }
  const c = counts();
  if (!S.rows.length) { box.replaceChildren(el('section', { class: 'card bm-card', id: 'wpStep3' }, el('div', { class: 'empty', id: 'wpEmpty' }, 'W pliku nie znaleziono żadnych wpływów (samych obciążeń albo wiersze nie do odczytania). Sprawdź format pliku wyżej.'))); return; }
  const chip = (k, label, n, tip) => el('button', { type: 'button', class: 'chip', 'data-f': k, 'aria-pressed': String(S.filter === k), title: tip, onclick: () => { S.filter = k; paintReview(); } }, label + ' ', el('b', null, String(n)));
  const cols = [
    { label: '', tip: 'Zaznacz, aby oznaczyć zamówienie jako opłacone' },
    { label: 'Data', sort: 'date', tip: 'Data księgowania wpłaty w banku' }, { label: 'Kwota', sort: 'amount', num: true, tip: 'Kwota wpłaty z wyciągu' },
    { label: 'Płatnik', sort: 'payer', tip: 'Nadawca przelewu wg wyciągu' }, { label: 'Tytuł', sort: 'title', tip: 'Tytuł przelewu — tu szukamy numeru zamówienia' },
    { label: 'Zamówienie', sort: 'order', tip: 'Dopasowane zamówienie. Możesz wybrać inne z listy kandydatów albo „nie oznaczaj”.' },
    { label: 'Wynik', sort: 'score', num: true, tipHeader: true, firstDir: 'desc', tip: 'Punktacja dopasowania 0–100 (najedź na wynik, aby zobaczyć powody). Zasady punktacji możesz zmienić w „Zasady dopasowania”.' },
  ];
  const head = el('tr', null, ...cols.map(col => col.sort ? sortTh(col, { sort: S.sort.sort, dir: S.sort.dir }, (s, d) => { S.sort = { sort: s, dir: d }; paintReview(); }) : el('th', { class: 'c' }, el('input', { type: 'checkbox', id: 'wpAll', 'aria-label': 'Zaznacz widoczne', title: 'Zaznacz lub odznacz wszystkie widoczne wiersze, które mają dopasowane zamówienie',
    onclick: ev => { for (const r of sortedRows()) if (r.sel && r.status !== 'ok') r.checked = ev.target.checked; paintReview(); } }))));
  const rows = sortedRows();
  const tbody = el('tbody', null, ...rows.map(row));
  box.replaceChildren(el('section', { class: 'card bm-card', id: 'wpStep3' }, el('h2', null, el('span', { class: 'bm-num' }, '2'), 'Przejrzyj dopasowania'),
    S.truncated ? el('p', { class: 'muted' }, 'Uwaga: zamówień do dopasowania jest bardzo dużo — wzięto najnowsze 3000. Zawęź zakres dni w zasadach.') : null,
    el('div', { class: 'bm-chips chips', role: 'group', 'aria-label': 'Filtr poziomu dopasowania' },
      chip('all', 'Wszystkie', S.rows.length, 'Wszystkie wpłaty z wyciągu'), chip('sure', 'Pewne', c.sure, LEVEL.sure.tip), chip('probable', 'Prawdopodobne', c.probable, LEVEL.probable.tip), chip('none', 'Brak dopasowania', c.none, LEVEL.none.tip)),
    el('div', { class: 'bm-row' },
      el('button', { type: 'button', class: 'secondary', id: 'wpSelSure', title: 'Zaznacz tylko wpłaty ocenione jako pewne (jak domyślnie)', onclick: () => { for (const r of S.rows) if (r.status !== 'ok') r.checked = r.level === 'sure' && !!r.sel; paintReview(); } }, 'Zaznacz tylko pewne'),
      el('button', { type: 'button', class: 'secondary', id: 'wpSelNone', title: 'Odznacz wszystkie wiersze', onclick: () => { for (const r of S.rows) r.checked = false; paintReview(); } }, 'Odznacz wszystko')),
    el('div', { class: 'table-wrap bm-wrap' }, el('table', { id: 'wpTable' }, el('thead', null, head), tbody)),
    el('p', { class: 'bm-count', id: 'wpCount', title: 'Liczba zaznaczonych wpłat i ich suma' }, `Zaznaczono ${c.checked} z ${S.rows.length}`, c.checked ? ' · razem ' + zl(c.sum) : '', c.done ? ' · już oznaczono ' + c.done : ''),
    el('div', { class: 'bm-row bm-apply' },
      el('button', { type: 'button', class: 'primary', write: 'wplaty', id: 'wpApply', disabled: !c.checked || S.running, title: c.checked ? 'Pokaże podsumowanie do potwierdzenia — nic nie jest zapisywane od razu' : 'Zaznacz co najmniej jedną wpłatę z dopasowanym zamówieniem', onclick: confirmApply },
        c.checked ? 'Oznacz jako opłacone (' + c.checked + ')' : 'Oznacz jako opłacone'))));
  paintResult();
}

function row(r) {
  const pick = r.sel ? selScore(r) : null, o = r.sel ? orderOf(r.sel) : null, lv = LEVEL[r.level];
  const cb = el('input', { type: 'checkbox', class: 'wp-cb', 'aria-label': 'Oznacz jako opłacone', checked: r.checked && !!r.sel, disabled: !r.sel || r.status === 'ok',
    title: r.status === 'ok' ? 'To zamówienie zostało już oznaczone jako opłacone' : r.sel ? 'Zaznacz, aby oznaczyć zamówienie jako opłacone' : 'Najpierw wskaż zamówienie',
    onchange: ev => { r.checked = ev.target.checked; paintCount(); } });
  const sel = el('select', { class: 'wp-sel', 'aria-label': 'Zamówienie dla wpłaty', disabled: r.status === 'ok', title: 'Wybierz właściwe zamówienie spośród najlepiej pasujących',
    onchange: ev => { r.sel = ev.target.value; r.checked = !!r.sel; r.level = !r.sel ? 'none' : r.cands[0] && r.cands[0].order.id === r.sel && r.level !== 'none' ? r.level : 'probable'; paintReview(); } },
    el('option', { value: '' }, '— nie oznaczaj —'), ...r.cands.map(c => el('option', { value: c.order.id, selected: c.order.id === r.sel }, orderLabel(c.order) + ' (' + c.score + ')')),
    r.sel && !r.cands.find(x => x.order.id === r.sel) && o ? el('option', { value: r.sel, selected: true }, orderLabel(o) + ' (ręcznie)') : null);
  const manual = !r.cands.length || r.level === 'none' ? el('input', { type: 'text', class: 'wp-manual', placeholder: 'numer zamówienia', 'aria-label': 'Wpisz numer zamówienia ręcznie', title: 'Wpisz numer zamówienia (np. 1234/2026) i naciśnij Enter, aby przypisać wpłatę ręcznie. Dotyczy tylko nieopłaconych zamówień z wczytanego zakresu.',
    onkeydown: ev => { if (ev.key !== 'Enter') return; const f = byNumber().get(norm(ev.target.value)); if (!f) { flash(null, 'Nie znaleziono nieopłaconego zamówienia o takim numerze.'); return; } r.sel = f.id; r.checked = true; r.level = 'probable'; r.manual = true; r.notes.push('zamówienie wskazane ręcznie'); paintReview(); } }) : null;
  const why = pick ? pick.reasons.map(x => x.t + (x.pts ? ' (+' + x.pts + ')' : '')).join('\n') : 'brak dopasowania';
  const pill = el('span', { class: 'ord-st ' + lv.tone + ' tip', title: lv.label + ': ' + lv.tip + (pick ? '\n\nPowody:\n' + why : '') + (r.notes.length ? '\n\nUwagi:\n' + r.notes.join('\n') : '') }, pick ? String(pick.score) : '—');
  const tr = el('tr', { 'data-i': String(r.i), 'data-level': r.level, class: r.status === 'ok' ? 'wp-done' : null },
    el('td', { class: 'c' }, cb), el('td', null, r.tx.date), el('td', { class: 'n' }, zl(r.tx.amount)),
    el('td', { title: r.tx.account || null }, r.tx.party || '—'), el('td', { class: 'wp-title', title: r.tx.title }, r.tx.title || '—'),
    el('td', null, sel, manual, r.notes.length || (pick && pick.reasons.some(x => x.warn)) ? el('div', { class: 'wp-note' }, ...r.notes.map(n => el('div', null, n)), ...(pick ? pick.reasons.filter(x => x.warn).map(x => el('div', { class: 'bm-warn' }, x.t)) : [])) : null),
    el('td', { class: 'n' }, r.status === 'ok' ? el('span', { class: 'ord-st ok', title: 'Zamówienie zostało oznaczone jako opłacone w Selly' }, 'oznaczone') : pill));
  return tr;
}
function paintCount() {
  const c = counts(), n = $('wpCount'), b = $('wpApply');
  if (n) n.replaceChildren(`Zaznaczono ${c.checked} z ${S.rows.length}`, c.checked ? ' · razem ' + zl(c.sum) : '', c.done ? ' · już oznaczono ' + c.done : '');
  if (b) { b.disabled = !c.checked || S.running; b.textContent = c.checked ? 'Oznacz jako opłacone (' + c.checked + ')' : 'Oznacz jako opłacone'; }
}

// ─── Krok 2: zasady ─────────────────────────────────────────────────────
function rulesCard() {
  const save = () => { store(SKEY, S.rules); if (S.orders) rematch(); };
  const inputs = Object.entries(RULES).map(([k, r]) => field(r.label, el('input', { type: 'number', class: 'wp-num', id: 'wpRule-' + k, min: String(r.min), max: String(r.max), step: String(r.step || 1), value: String(S.rules[k]),
    onchange: ev => { S.rules = cleanSettings({ ...S.rules, [k]: ev.target.value }); ev.target.value = String(S.rules[k]); save(); } }), r.tip));
  return el('details', { class: 'card bm-card bm-opts', id: 'wpRules' }, el('summary', { title: 'Jak panel ocenia, czy wpłata pasuje do zamówienia. Domyślne ustawienia są dobre dla większości sklepów.' }, el('b', null, 'Zasady dopasowania'), ' (zaawansowane)'),
    el('p', { class: 'muted wp-hint' }, 'Każda wpłata dostaje punkty za zgodny numer zamówienia, kwotę, e-mail i nazwisko. Wynik od progu „pewne” jest zaznaczany sam, od progu „prawdopodobne” — pokazywany do Twojej decyzji. Zmiany działają od razu.'),
    el('div', { class: 'bm-row' }, field('Zamówienia z ostatnich dni', el('select', { id: 'wpDays', onchange: ev => { S.days = Number(ev.target.value); store(DKEY, S.days); ensureOrders(true); } },
      [30, 60, 120, 365, 730].map(n => el('option', { value: String(n), selected: n === S.days }, n + ' dni'))), 'Z ilu ostatnich dni szukamy nieopłaconych zamówień. Dłuższy okres = więcej kandydatów, ale i więcej przypadkowych dopasowań.')),
    el('div', { class: 'bm-row' }, ...inputs),
    el('div', { class: 'bm-row' }, el('button', { type: 'button', class: 'secondary', id: 'wpRulesReset', title: 'Przywróć fabryczne wartości wszystkich reguł', onclick: () => { S.rules = defaultSettings(); store(SKEY, S.rules); S.root.querySelector('#wpRules').replaceWith(rulesCard()); if (S.orders) rematch(); } }, 'Przywróć domyślne')));
}

// ─── Zapis ──────────────────────────────────────────────────────────────
function plan() {
  const items = [], dup = new Set(), seen = new Set();
  for (const r of S.rows) {
    if (!r.checked || !r.sel || r.status === 'ok') continue;
    const o = orderOf(r.sel); if (!o) continue;
    if (seen.has(o.id)) dup.add(o.number); seen.add(o.id);
    items.push({ row: r, order: o, orderId: o.id, from: o.paid, to: newPaid(o, r.tx.amount, S.rules.tolerance) });
  }
  return { items, dup: [...dup] };
}
function confirmApply() {
  const { items, dup } = plan();
  if (dup.length) { flash(null, 'To samo zamówienie wybrano dla kilku wpłat: ' + dup.slice(0, 3).join(', ') + '. Zostaw jedną.'); return; }
  if (!items.length) return;
  const partial = items.filter(x => x.to < x.order.total - 0.005).length, sum = items.reduce((a, x) => a + x.row.tx.amount, 0);
  const batches = Math.ceil(items.length / (S.maxBatch || 12));
  dialog({ id: 'wpConfirm', title: 'Oznaczysz ' + items.length + ' ' + plural(items.length, 'zamówienie', 'zamówienia', 'zamówień') + ' jako opłacone',
    body: el('div', null, el('p', null, 'Suma wpłat: ', el('b', null, zl(sum)), '. W Selly zmieni się kwota „zapłacono” (' + (batches > 1 ? 'zapis w ' + batches + ' porcjach' : 'jeden zapis') + ').'),
      partial ? el('p', { class: 'bm-warn' }, partial + ' z nich to wpłaty częściowe — zamówienie zostanie z niedopłatą.') : null,
      el('p', { class: 'muted' }, 'Do serwera trafią tylko numery zamówień i kwoty. Po zapisie możesz cofnąć zmianę przyciskiem „Cofnij oznaczenie” (przywraca poprzednią kwotę zapłaconą).')),
    ok: 'Oznacz ' + items.length, onOk: () => runApply(items) });
}
const opId = () => 'wp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
async function runChunks(items, action, onProgress) {
  const size = S.maxBatch || 12, done = [], skipped = [], failed = [];
  for (let i = 0; i < items.length; i += size) {
    const part = items.slice(i, i + size), id = opId();
    let r;
    try { r = await api(action, { items: part.map(x => ({ orderId: x.orderId, from: x.from, to: x.to })), opId: id }); }
    catch (e) { part.forEach(x => failed.push({ id: x.orderId, error: e.message })); onProgress(i + part.length); continue; }
    done.push(...r.done); skipped.push(...r.skipped); failed.push(...r.failed);
    onProgress(i + part.length);
  }
  return { done, skipped, failed };
}
async function runApply(items) {
  if (S.running) return;
  S.running = true; paintCount();
  const total = items.length;
  const prog = n => { const b = $('wpRunning'); if (b) b.textContent = `Zapisuję w Selly… ${n} z ${total}`; };
  const holder = $('wpResult'); holder.replaceChildren(el('section', { class: 'card bm-card' }, el('p', { id: 'wpRunning', role: 'status' }, `Zapisuję w Selly… 0 z ${total}`)));
  const r = await runChunks(items, 'payments:apply', prog);
  S.running = false;
  const doneIds = new Set(r.done.map(d => d.id));
  for (const x of items) if (doneIds.has(x.orderId)) { x.row.status = 'ok'; x.row.checked = false; }
  for (const d of r.done) { const o = orderOf(d.id); if (o) o.paid = d.to; }
  S.result = { ...r, at: Date.now(), undone: null }; S.undone = false;
  paintReview();
  if (r.done.length) flash(null, 'Oznaczono ' + r.done.length + ' ' + plural(r.done.length, 'zamówienie', 'zamówienia', 'zamówień') + ' jako opłacone.');
}
function paintResult() {
  const box = $('wpResult'); if (!box || !S.result || S.running) return;
  const r = S.result, num = id => (orderOf(id) || (S.orders || []).find(o => o.id === id) || { number: '#' + id }).number;
  const REASON = { changed: 'kwota zapłacona została w międzyczasie zmieniona w Selly — nie ruszamy', already: 'już ma taką kwotę zapłaconą' };
  const lines = [...r.skipped.map(x => [num(x.id), 'pominięte: ' + (REASON[x.reason] || x.reason)]), ...r.failed.map(x => [num(x.id), 'błąd: ' + x.error])];
  box.replaceChildren(el('section', { class: 'card bm-card', id: 'wpSummary' }, el('h2', null, 'Podsumowanie'),
    el('p', { id: 'wpSummaryText' }, r.undone ? `Cofnięto ${r.undone.done.length} z ${r.done.length}.` : `Oznaczono ${r.done.length} ${plural(r.done.length, 'zamówienie', 'zamówienia', 'zamówień')} jako opłacone`
      + (r.skipped.length ? `, pominięto ${r.skipped.length}` : '') + (r.failed.length ? `, błędów: ${r.failed.length}` : '') + '.'),
    lines.length ? el('div', { class: 'table-wrap bm-wrap' }, el('table', { id: 'wpProblems' }, el('thead', null, el('tr', null, el('th', null, 'Zamówienie'), el('th', null, 'Co się stało'))),
      el('tbody', null, ...lines.map(([a, b]) => el('tr', null, el('td', null, a), el('td', null, b)))))) : null,
    r.undone && (r.undone.skipped.length || r.undone.failed.length) ? el('p', { class: 'bm-warn', id: 'wpUndoWarn' }, `Nie cofnięto ${r.undone.skipped.length + r.undone.failed.length} (kwota zmieniona w międzyczasie albo błąd) — sprawdź w Selly.`) : null,
    r.done.length && !r.undone ? el('div', { class: 'bm-row' }, el('button', { type: 'button', class: 'secondary danger', write: 'wplaty', id: 'wpUndo', title: 'Przywraca poprzednią kwotę zapłaconą w tych zamówieniach (jeśli ktoś jej w międzyczasie nie zmienił). Status zamówienia sprawdź w Selly.', onclick: confirmUndo }, 'Cofnij oznaczenie')) : null));
}
function confirmUndo() {
  const r = S.result, n = r.done.length;
  dialog({ id: 'wpUndoDlg', title: 'Cofnąć oznaczenie ' + n + ' ' + plural(n, 'zamówienia', 'zamówień', 'zamówień') + '?', okClass: 'danger',
    body: el('div', null, el('p', null, 'Przywrócimy kwotę zapłaconą sprzed importu. Zamówienia, w których ktoś zmienił kwotę po naszym zapisie, zostaną pominięte.'), el('p', { class: 'muted' }, 'Jeśli Selly automatycznie zmienił status zamówienia po opłaceniu, status trzeba przywrócić ręcznie.')),
    ok: 'Cofnij oznaczenie', onOk: async () => {
      S.running = true;
      const items = r.done.map(d => ({ orderId: d.id, from: d.to, to: d.from }));
      const u = await runChunks(items, 'payments:undo', () => {});
      S.running = false;
      r.undone = u; const back = new Set(u.done.map(d => d.id));
      for (const row of S.rows) if (row.sel && back.has(row.sel) && row.status === 'ok') { row.status = ''; row.checked = false; }
      for (const d of u.done) { const o = orderOf(d.id); if (o) o.paid = d.to; }
      paintReview(); flash(null, 'Cofnięto ' + u.done.length + ' z ' + n + '.');
    } });
}

// ─── Moduł ──────────────────────────────────────────────────────────────
export default {
  id: 'wplaty',
  title: 'Import wpłat bankowych',
  routes: [''],
  mount(root) {
    if (S.root === root && root.firstChild) return;
    S.root = root; S.days = Number(store(DKEY)) || 120;
    root.replaceChildren(pageToolbar({ title: 'Import wpłat bankowych', sub: 'Wczytaj wyciąg z banku (CSV) i oznacz zamówienia jako opłacone — dopasowanie po numerze, kwocie i nazwisku' }),
      fileCard(), rulesCard(), el('div', { id: 'wpReview' }), el('div', { id: 'wpResult' }));
    if (S.parsed) { paintInfo(); paintReview(); }
  },
  unmount() { S.seq++; },
};
