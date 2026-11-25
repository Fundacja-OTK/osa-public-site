// Klienci — import z pliku CSV (#/klienci/import). Kroki: plik (czytany tylko w przeglądarce) → kolumny (rozpoznane automatycznie,
// z ręczną poprawką; układ zapamiętany w tej przeglądarce — same nazwy kolumn) → sprawdzenie BEZ ZAPISU (błędne dane, duplikaty w pliku
// i w sklepie — clients:emailsExist, odczyt kopii panelu) → dodawanie po jednym kliencie z przerwami (clients:create z opId), z postępem,
// wynikiem dla każdego wiersza, ponowieniem nieudanych i raportem błędów do pobrania.
import { el, flash, field, cnt, downloadCsv, statusPill, store } from '../core/ui.js?v=0e25d7c';
import { api } from '../core/client.js?v=0e25d7c';
import { setLeaveGuard } from '../core/router.js?v=0e25d7c';
import { maskCell } from './wplatyCsv.js?v=0e25d7c';
import { FIELDS, MAX_BYTES, MAX_ROWS, IMPORT_GAP_MS, STATUS_TEXT, parseClientsFile, autoMapping, missingRequired, buildRecords, classify, summary,
  emailChunks, errorReport, templateRows, runThrottled, opIdFor, labelOf } from './klienciImportLogic.js?v=0e25d7c';
import { sellyGroups, mergeGroups } from './klienciGrupy.js?v=0e25d7c';

const MAP_KEY = 'osa-cli-imp-map';   // { podpis nagłówków → mapowanie } — bez danych z wierszy
const TONE = { new: 'acc', invalid: 'bad', exists: 'warn', dupFile: 'warn', done: 'ok', failed: 'bad', running: 'info' };
const SHOW = 200;

const S = { box: null, back: '#/klienci', meta: null, bytes: null, file: null, parsed: null, map: null, opts: { separator: '', hasHeader: null }, country: 'Polska', groupId: '',
  records: null, checked: false, running: false, stop: false, filter: 'all', runId: '', alive: () => true };
const $ = id => document.getElementById(id);

export function renderImport(box, { back, meta, isCurrent }) {
  Object.assign(S, { box, back, meta: meta || {}, bytes: null, file: null, parsed: null, map: null, records: null, checked: false, running: false, stop: false, filter: 'all', alive: isCurrent || (() => true) });
  S.opts = { separator: '', hasHeader: null };
  box.replaceChildren(el('div', { class: 'card' },
    el('div', { class: 'ord-detail-top' }, el('a', { href: back, class: 'btn-link', id: 'impBack', title: 'Wróć do listy klientów' }, '← Wróć do listy'), el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'secondary', id: 'impTemplate', title: 'Pobiera pusty plik CSV z nazwami kolumn, które panel rozpoznaje automatycznie', onclick: () => downloadCsv(templateRows(), 'klienci-wzor-importu', '') }, 'Pobierz wzór pliku')),
    el('div', { class: 'card-head' }, el('h2', { id: 'impTitle' }, 'Import klientów z pliku CSV'),
      el('div', { class: 'sub' }, 'Najpierw sprawdzimy plik bez zapisywania czegokolwiek. Klientów dodamy dopiero po Twoim potwierdzeniu.')),
    fileStep()),
  el('div', { id: 'impMapHost' }), el('div', { id: 'impCheckHost' }));
}

// ─── Krok 1: plik ───────────────────────────────────────────────────────────
function fileStep() {
  const input = el('input', { type: 'file', id: 'impFile', accept: '.csv,.txt,text/csv,text/plain', 'aria-label': 'Plik CSV z klientami', title: 'Plik CSV/TXT z klientami (np. eksport z Excela: „Zapisz jako → CSV”)',
    onchange: () => { if (input.files[0]) loadFile(input.files[0]); } });
  const drop = el('div', { class: 'wp-drop', id: 'impDrop', title: 'Upuść tu plik CSV albo kliknij „Wybierz plik”' }, el('div', null, 'Upuść plik CSV z klientami tutaj albo'), input);
  ['dragover', 'dragenter'].forEach(t => drop.addEventListener(t, ev => { ev.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', ev => { const f = ev.dataTransfer && ev.dataTransfer.files[0]; if (f) loadFile(f); });
  return el('div', null,
    el('p', { class: 'wp-privacy', id: 'impPrivacy', title: 'Plik jest czytany w pamięci tej karty przeglądarki. Do serwera panelu trafia lista adresów e-mail (sprawdzenie duplikatów), a po potwierdzeniu — każdy klient osobno.' },
      '🔒 Plik zostaje w Twojej przeglądarce. Do sklepu trafiają tylko pojedyncze, sprawdzone rekordy — dopiero po potwierdzeniu.'),
    drop,
    el('p', { class: 'muted small' }, 'Wymagane kolumny: ' + FIELDS.filter(f => f.req).map(f => f.label).join(', ') + ' (imię i nazwisko mogą być w jednej kolumnie). Kodowanie, separator i nazwy kolumn rozpoznajemy sami. Do ' + MAX_ROWS + ' wierszy w jednym imporcie.'),
    el('div', { id: 'impFileInfo' }));
}

async function loadFile(file) {
  if (file.size > MAX_BYTES) { info('Plik jest za duży (maks. 5 MB). Podziel go na mniejsze części.', true); return; }
  S.file = file; S.opts = { separator: '', hasHeader: null }; S.map = null; S.records = null; S.checked = false;
  try { S.bytes = new Uint8Array(await file.arrayBuffer()); } catch (e) { info('Nie udało się odczytać pliku.', true); return; }
  reparse();
}

function info(text, bad) { const b = $('impFileInfo'); if (b) b.replaceChildren(el('p', { class: bad ? 'empty error' : 'muted', id: 'impFileMsg' }, text)); }

function reparse() {
  const o = {}; if (S.opts.separator) o.separator = S.opts.separator; if (S.opts.hasHeader != null) o.hasHeader = S.opts.hasHeader;
  try { S.parsed = parseClientsFile(S.bytes, o); } catch (e) { S.parsed = null; info('Nie udało się odczytać tego pliku (nieznany lub uszkodzony format).', true); return; }
  const p = S.parsed;
  if (!p.rows.length) { info('W pliku nie ma wierszy z danymi.', true); $('impMapHost').replaceChildren(); $('impCheckHost').replaceChildren(); return; }
  const mem = p.signature ? memory()[p.signature] : null;
  S.map = mem && mem.length === p.headers.length ? mem.slice() : autoMapping(p.headers, p.rows);
  S.remembered = !!(mem && mem.length === p.headers.length);
  S.records = null; S.checked = false;
  $('impFileInfo').replaceChildren(el('p', { id: 'impDetected' }, el('b', null, S.file.name), ' — ', cnt(p.total, 'wiersz', 'wiersze', 'wierszy') + ' z danymi, kodowanie ' + p.encoding + ', separator „' + (p.separator === '\t' ? 'tabulator' : p.separator) + '”' + (p.hasHeader ? ', z wierszem nagłówków.' : ', bez nagłówków.'),
    p.truncated ? el('strong', { class: 'error' }, ' Wczytano pierwsze ' + MAX_ROWS + ' wierszy — resztę zaimportuj osobnym plikiem.') : null));
  paintMapping();
  $('impCheckHost').replaceChildren();
}

function memory() { const m = store(MAP_KEY); return m && typeof m === 'object' ? m : {}; }
function remember() { if (!S.parsed.signature) return; const m = memory(); m[S.parsed.signature] = S.map.slice(); const keys = Object.keys(m); if (keys.length > 20) delete m[keys[0]]; store(MAP_KEY, m); }

// ─── Krok 2: kolumny ────────────────────────────────────────────────────────
function paintMapping() {
  const p = S.parsed;
  const opts = [['', '— pomiń kolumnę —'], ...FIELDS.map(f => [f.key, f.label + (f.req ? ' *' : '')])];
  const sample = i => p.rows.slice(0, 3).map(r => maskCell(r[i])).filter(Boolean).join(' · ');
  const rows = p.headers.map((h, i) => el('tr', null,
    el('td', null, el('strong', null, h || 'kolumna ' + (i + 1))),
    el('td', { class: 'muted small', title: 'Pierwsze wartości z kolumny (zamaskowane — tylko po to, żeby rozpoznać kolumnę)' }, sample(i)),
    el('td', null, el('select', { 'data-col': String(i), id: 'impMap-' + i, 'aria-label': 'Pole dla kolumny ' + (h || i + 1), onchange: ev => { S.map[i] = ev.target.value; dedupe(i); paintMapping(); } },
      opts.map(([v, t]) => el('option', { value: v, selected: v === S.map[i] || null }, t))))));
  const miss = missingRequired(S.map);
  const groups = mergeGroups((S.meta && S.meta.groups) || [], []);
  const grpSel = el('select', { id: 'impGroup', onchange: ev => { S.groupId = ev.target.value; S.records = null; S.checked = false; $('impCheckHost').replaceChildren(); } },
    el('option', { value: '' }, '— bez grupy —'), groups.map(g => el('option', { value: g.id, selected: g.id === S.groupId || null }, g.name)));
  sellyGroups().then(r => { if (!r.ok || !document.body.contains(grpSel)) return; const all = mergeGroups((S.meta && S.meta.groups) || [], r.groups); grpSel.replaceChildren(el('option', { value: '' }, '— bez grupy —'), ...all.map(g => el('option', { value: g.id, selected: g.id === S.groupId || null }, g.name))); });
  const country = el('input', { type: 'text', id: 'impCountry', value: S.country, maxlength: '80', onchange: ev => { S.country = ev.target.value.trim() || 'Polska'; S.records = null; $('impCheckHost').replaceChildren(); } });
  $('impMapHost').replaceChildren(el('section', { class: 'card', id: 'impStep2' },
    el('h2', null, el('span', { class: 'bm-num' }, '2'), ' Sprawdź kolumny'),
    el('p', { class: 'muted' }, S.remembered ? 'Ten układ kolumn już importowałeś — użyto zapamiętanego przypisania (tylko w tej przeglądarce). ' : 'Kolumny dopasowaliśmy po nazwach i zawartości — sprawdź i popraw, jeśli trzeba. ',
      'Pola z gwiazdką są wymagane przez Selly.'),
    el('div', { class: 'table-wrap' }, el('table', { id: 'impMapTable' }, el('thead', null, el('tr', null,
      el('th', { title: 'Nazwa kolumny w pliku' }, 'Kolumna w pliku'), el('th', null, el('span', { class: 'tip', title: 'Pierwsze wartości z kolumny, zamaskowane (dane osobowe nie są tu pokazywane w całości)' }, 'Przykład')),
      el('th', null, el('span', { class: 'tip', title: 'Pole klienta w Selly, do którego trafi ta kolumna' }, 'Pole w Selly')))), el('tbody', null, rows))),
    miss.length ? el('p', { class: 'notice warn', id: 'impMissing' }, 'Brakuje wymaganych kolumn: ' + miss.map(labelOf).join(', ') + '. Wskaż je powyżej.') : null,
    el('details', { class: 'bm-opts', id: 'impOpts' }, el('summary', { title: 'Grupa dla wszystkich importowanych klientów, domyślne państwo, separator i wiersz nagłówków' }, 'Ustawienia importu (zaawansowane)'),
      el('div', { class: 'kf-grid' },
        field('Grupa dla wszystkich', grpSel, 'Każdy dodany klient trafi do tej grupy (kolumna „Grupa” w pliku ma pierwszeństwo)'),
        field('Państwo, gdy puste', country, 'Wpisywane klientom bez kolumny „Państwo”. Dla Polski sprawdzamy format kodu pocztowego i sumę kontrolną NIP.'),
        field('Separator', el('select', { id: 'impSep', onchange: ev => { S.opts.separator = ev.target.value; reparse(); } },
          [['', 'rozpoznaj automatycznie'], [';', 'średnik ;'], [',', 'przecinek ,'], ['\t', 'tabulator'], ['|', 'kreska |']].map(([v, l]) => el('option', { value: v, selected: v === S.opts.separator || null }, l))), 'Znak oddzielający kolumny w pliku'),
        field('Pierwszy wiersz', el('select', { id: 'impHdr', onchange: ev => { S.opts.hasHeader = ev.target.value === '' ? null : ev.target.value === '1'; reparse(); } },
          [['', 'rozpoznaj automatycznie'], ['1', 'to nazwy kolumn'], ['0', 'to już dane klienta']].map(([v, l]) => el('option', { value: v, selected: v === (S.opts.hasHeader == null ? '' : S.opts.hasHeader ? '1' : '0') || null }, l))), 'Czy pierwszy wiersz pliku zawiera nazwy kolumn'))),
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'primary', id: 'impCheck', disabled: !!miss.length || null,
      title: miss.length ? 'Najpierw wskaż wszystkie wymagane kolumny' : 'Sprawdza dane i duplikaty — niczego nie zapisuje', onclick: check }, 'Sprawdź plik (bez zapisu)'))));
}
/** Każde pole najwyżej raz: ta sama wartość w innej kolumnie zostaje wyczyszczona. */
function dedupe(i) { const k = S.map[i]; if (!k) return; S.map.forEach((v, j) => { if (j !== i && v === k) S.map[j] = ''; }); S.records = null; S.checked = false; $('impCheckHost').replaceChildren(); }

// ─── Krok 3: sprawdzenie (bez zapisu) ───────────────────────────────────────
async function check() {
  const host = $('impCheckHost'), btn = $('impCheck');
  remember();
  S.records = buildRecords(S.parsed, S.map, { country: S.country, groupId: S.groupId });
  if (btn) btn.disabled = true;
  host.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'muted', role: 'status' }, 'Sprawdzam dane i szukam duplikatów…')));
  const existing = {};
  try {
    for (const part of emailChunks(S.records)) Object.assign(existing, ((await api('clients:emailsExist', { emails: part })) || {}).found || {});
  } catch (e) {
    if (btn) btn.disabled = false;
    host.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'notice error', id: 'impCheckErr' }, 'Nie udało się sprawdzić duplikatów (' + (e.message || 'błąd') + '). Bez tego import jest wstrzymany — spróbuj za chwilę.')));
    return;
  }
  if (!S.alive()) return;
  if (btn) btn.disabled = false;
  classify(S.records, existing);
  S.checked = true; S.runId = Date.now().toString(36); S.filter = 'all';
  paintCheck();
}

function paintCheck(note) {
  const host = $('impCheckHost'), s = summary(S.records);
  const toAdd = S.records.filter(r => r.status === 'new');
  const failed = S.records.filter(r => r.status === 'failed');
  const tile = (key, label, n, tip) => el('button', { type: 'button', class: 'imp-tile' + (S.filter === key ? ' on' : ''), 'data-k': key, title: tip, 'aria-pressed': String(S.filter === key), onclick: () => { S.filter = S.filter === key ? 'all' : key; paintCheck(note); } },
    el('strong', null, String(n)), el('span', null, label));
  const done = s.done > 0 || failed.length > 0;
  const tiles = el('div', { class: 'imp-tiles', id: 'impSummary' },
    done ? tile('done', 'dodano', s.done, 'Klienci dodani do Selly w tym imporcie') : null,
    done ? tile('failed', 'nieudane', s.failed, 'Wiersze, których Selly nie przyjęło — powód w tabeli; można ponowić') : null,
    tile('new', done ? 'czeka na dodanie' : 'do dodania', s.new, 'Wiersze z poprawnymi danymi, których e-maila nie ma jeszcze w sklepie'),
    tile('exists', 'już w sklepie', s.exists, 'Klient z tym adresem e-mail już istnieje w sklepie (według kopii panelu) — pominiemy go'),
    tile('dupFile', 'powtórzone w pliku', s.dupFile, 'Ten sam e-mail pojawił się wcześniej w pliku — dodamy tylko pierwszy wiersz'),
    tile('invalid', 'błędne dane', s.invalid, 'Brak wymaganych pól albo zły format (e-mail, telefon, kod pocztowy, NIP) — popraw plik i wczytaj ponownie'));
  const list = S.records.filter(r => S.filter === 'all' || r.status === S.filter);
  const table = el('div', { class: 'table-wrap' }, el('table', { id: 'impTable' }, el('thead', null, el('tr', null,
    el('th', { class: 'n' }, el('span', { class: 'tip', title: 'Numer wiersza w pliku (licząc wiersz nagłówków)' }, 'Wiersz')), el('th', { title: 'Imię i nazwisko' }, 'Imię i nazwisko'), el('th', { title: 'E-mail' }, 'E-mail'),
    el('th', { title: 'Status' }, 'Status'), el('th', null, el('span', { class: 'tip', title: 'Powód pominięcia, błąd z Selly albo link do dodanego / istniejącego klienta' }, 'Szczegóły')))),
  el('tbody', null, list.slice(0, SHOW).map(r => el('tr', { 'data-line': String(r.line), 'data-st': r.status },
    el('td', { class: 'n' }, String(r.line)), el('td', null, r.name), el('td', null, r.email),
    el('td', { class: 'nw' }, statusPill(STATUS_TEXT[r.status] || r.status, TONE[r.status] || 'neutral')),
    el('td', null, r.reason || '', r.newId ? el('a', { href: '#/klienci/' + encodeURIComponent(r.newId), class: 'btn-link' }, 'Otwórz klienta') : null,
      r.existingId ? [' ', el('a', { href: '#/klienci/' + encodeURIComponent(r.existingId), class: 'btn-link' }, 'Otwórz istniejącego')] : null))),
  list.length > SHOW ? el('tr', null, el('td', { colspan: '5', class: 'muted' }, 'Pokazano ' + SHOW + ' z ' + list.length + ' — pełna lista pominiętych w raporcie błędów.')) : null)));
  const secs = Math.ceil(toAdd.length * IMPORT_GAP_MS / 1000);
  const bad = S.records.filter(r => r.status !== 'new' && r.status !== 'done').length;
  host.replaceChildren(el('section', { class: 'card', id: 'impStep3' },
    el('h2', null, el('span', { class: 'bm-num' }, '3'), done ? ' Wynik importu' : ' Podsumowanie (nic jeszcze nie zapisano)'),
    note || null, tiles,
    el('div', { class: 'ord-actions' },
      toAdd.length ? el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'impRun', disabled: S.running || null,
        title: 'Dodaje klientów do Selly po jednym, z przerwą (oszczędza limit zapytań sklepu). Możesz przerwać w każdej chwili.', onclick: () => confirmRun(toAdd) },
      (done ? 'Dodaj pozostałych (' : 'Dodaj ') + cnt(toAdd.length, 'klienta', 'klientów', 'klientów') + (done ? ')' : ' do Selly')) : null,
      failed.length ? el('button', { type: 'button', class: 'secondary', write: 'klienci', id: 'impRetry', disabled: S.running || null, title: 'Spróbuj ponownie dodać tylko wiersze, które się nie udały', onclick: () => run(failed) }, 'Ponów nieudane (' + failed.length + ')') : null,
      bad ? el('button', { type: 'button', class: 'secondary', id: 'impReport', title: 'Pobiera CSV z wierszami, których nie dodano: numer wiersza, status, powód i oryginalne kolumny pliku', onclick: () => downloadCsv(errorReport(S.parsed, S.records), 'klienci-import-bledy', '') }, 'Pobierz raport błędów (' + bad + ')') : null),
    toAdd.length && !done ? el('p', { class: 'muted small' }, 'Dodanie potrwa ok. ' + (secs < 90 ? secs + ' s' : Math.ceil(secs / 60) + ' min') + ' (po jednym kliencie, żeby nie przekroczyć limitu zapytań Selly). Hasła nadamy losowe — klienci ustawią własne przez „Zapomniałem hasła”.') : null,
    el('div', { id: 'impProgressHost' }), table));
}

// ─── Krok 4: zapis ──────────────────────────────────────────────────────────
function confirmRun(list) {
  if (!confirm('Dodać ' + cnt(list.length, 'klienta', 'klientów', 'klientów') + ' do Selly? Zapis zacznie się od razu; możesz go przerwać.')) return;
  run(list);
}

async function run(list) {
  if (S.running) return;
  S.running = true; S.stop = false;
  setLeaveGuard(() => (S.running ? 'Trwa import klientów. Opuszczenie strony przerwie go (dodani klienci zostaną w Selly). Opuścić?' : null));
  paintCheck();
  const bar = el('progress', { max: String(list.length), value: '0', id: 'impProgress', 'aria-label': 'Postęp importu' });
  const label = el('div', { class: 'muted small', role: 'status', id: 'impStatus' }, 'Dodaję: 0 z ' + list.length);
  $('impProgressHost').replaceChildren(el('div', { class: 'opts-box' }, bar, label,
    el('button', { type: 'button', class: 'secondary', id: 'impStop', title: 'Kończy po bieżącym kliencie; pozostali czekają na „Dodaj pozostałych”', onclick: ev => { S.stop = true; ev.target.disabled = true; } }, 'Przerwij')));
  let n = 0;
  const row = r => document.querySelector('#impTable tr[data-line="' + r.line + '"]');
  const res = await runThrottled(list, r => api('clients:create', { fields: r.fields, opId: opIdFor(S.runId, r.line) }), {
    gapMs: IMPORT_GAP_MS, shouldStop: () => S.stop || !S.alive(),
    onStart: r => { const tr = row(r); if (tr) tr.children[3].replaceChildren(statusPill(STATUS_TEXT.running, TONE.running)); },
    onItem: (r, out, e) => {
      if (e) { const dup = /już istnieje/.test(e.message || '') ? /ID (\d+)/.exec(e.message) : null; r.status = dup ? 'exists' : 'failed'; r.reason = e.message || 'błąd'; r.existingId = dup ? dup[1] : ''; }
      else { r.status = 'done'; r.reason = ''; r.newId = (out && out.id) || ''; }
      const tr = row(r); if (tr) tr.children[3].replaceChildren(statusPill(STATUS_TEXT[r.status], TONE[r.status]));
      bar.value = ++n; label.textContent = 'Dodaję: ' + n + ' z ' + list.length;
    } });
  S.running = false; setLeaveGuard(null);
  if (!S.alive()) return;
  const s = summary(S.records);
  const note = res.paused ? el('p', { class: 'notice warn', id: 'impPaused' }, 'Wstrzymano po kilku błędach z rzędu (np. limit zapytań Selly, wylogowanie albo awaria). Sprawdź powody w tabeli i kliknij „Dodaj pozostałych”.')
    : res.stopped ? el('p', { class: 'notice', id: 'impStopped' }, 'Przerwano. Pozostali klienci czekają — „Dodaj pozostałych” wznowi import.')
      : el('p', { class: 'notice ' + (s.failed ? 'warn' : 'ok'), id: 'impDone' }, 'Gotowe: dodano ' + cnt(res.done.length, 'klienta', 'klientów', 'klientów') + (res.failed.length ? ', nieudane: ' + res.failed.length : '') + '.');
  flash('', 'Import: dodano ' + res.done.length + (res.failed.length ? ', nieudane ' + res.failed.length : ''));
  paintCheck(note);
}
