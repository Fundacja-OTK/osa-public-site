// „Wysyłka SpeedMail” — import plików (logika: speedmailImportLogic.js):
//   deliveryCard() w zakładce Stan: plik dostawy od dostawcy → podgląd (do dodania / nierozpoznane / błędne z powodami) → dosyłki sm:move porcjami (opId),
//   shipCard() w zakładce Paczki: raport wysyłek SpeedMail → które zamówienia paczek SM wysłał, a które nie (sm:shipMatch, tylko numery) →
//   na żądanie, po podglądzie i potwierdzeniu: numery przesyłek w Selly (orders:update tracking_code) i status (orders:setStatus).
// Pliki czytane wyłącznie w przeglądarce; nie są nigdzie zapisywane. Nic nie dzieje się automatycznie.
import { el, cnt, flash } from '../core/ui.js?v=d6bfd64';
import { api } from '../core/client.js?v=d6bfd64';
import { S, SM, WRITE, STATUS_WRITE, nf, dmy, notice, tile, prodOf, fold, reload, runStatus, jobBusy, statusName } from './speedmailKit.js?v=d6bfd64';
import * as L from './speedmailImportLogic.js?v=d6bfd64';
import { runThrottled } from './klienciImportLogic.js?v=d6bfd64';

const ORD_WRITE = ['zamowienia'];               // jak reguła orders:update (shared/panelAuth.js)
const TRACK_GAP_MS = 400;                       // przerwa między zapisami w Selly (limit API ~500/min)
const ls = () => { try { return window.localStorage; } catch (e) { return null; } };
const runId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rr = () => S.rerender();

/** Wspólne: wybór pliku, wiersz nagłówków i przypisanie kolumn (kind = 'delivery' | 'ship'). */
function fileBlock(st, kind, prefix, onLoaded, label, tip) {
  const input = el('input', { type: 'file', id: prefix + 'File', accept: '.xlsx,.csv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'aria-label': label, title: tip });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    st.err = ''; st.busy = true; rr();
    try {
      const t = await L.readTable(new Uint8Array(await f.arrayBuffer()));
      Object.assign(st, { name: f.name.slice(0, 80), raw: t, head: L.guessHeaderRow(t.rows, kind), result: null, match: null });
      remap(st, kind, true);
      onLoaded();
    } catch (e) { Object.assign(st, { raw: null, err: (e && e.message) || 'Nie udało się odczytać pliku.' }); }
    st.busy = false; rr();
  });
  return el('label', { class: 'sm-imp-file' }, el('span', { class: 'tip', title: tip }, label), input);
}
/** Tabela po wyborze nagłówka + przypisanie kolumn: zapamiętane (podpis nagłówków) albo rozpoznane. */
function remap(st, kind, fresh) {
  st.tab = L.tableOf(st.raw.rows, st.head);
  const saved = fresh ? L.loadMap(ls(), kind, st.tab.signature) : null;
  st.map = saved && Array.isArray(saved.map) && saved.map.length === st.tab.headers.length ? saved.map.slice() : L.autoMap(kind, st.tab);
  st.remembered = !!saved;
  if (saved && saved.qtyUnit) st.qtyUnit = saved.qtyUnit;
}
function mappingBlock(st, kind, prefix, mask) {
  const fields = kind === 'delivery' ? L.DELIVERY_FIELDS : L.SHIP_FIELDS, miss = L.missingFields(kind, st.map);
  const head = el('select', { id: prefix + 'Head', 'aria-label': 'Wiersz z nazwami kolumn', title: 'W którym wierszu pliku są nazwy kolumn (wiersze nad nim są pomijane)' },
    el('option', { value: '-1' }, 'bez nazw kolumn'), Array.from({ length: Math.min(15, st.raw.rows.length) }, (_, i) => el('option', { value: String(i) }, 'wiersz ' + (i + 1))));
  head.value = String(st.head);
  head.addEventListener('change', () => { st.head = Number(head.value); remap(st, kind, true); st.result = null; st.match = null; rr(); });
  const sample = i => st.tab.body.slice(0, 3).map(r => String(r.cells[i] == null ? '' : r.cells[i])).filter(Boolean).map(v => (mask ? L.maskCell(v) : v).slice(0, 30)).join(' · ');
  const rows = st.tab.headers.map((h, i) => {
    const s = el('select', { id: prefix + 'Map' + i, 'aria-label': 'Co zawiera kolumna ' + h }, el('option', { value: '' }, '— pomiń —'), fields.map(f => el('option', { value: f.key, title: f.tip }, f.label + (f.req ? ' *' : ''))));
    s.value = st.map[i] || '';
    s.addEventListener('change', () => {
      const v = s.value;
      st.map = st.map.map((x, j) => (j === i ? v : x === v && v ? '' : x));   // każde pole najwyżej raz
      L.saveMap(ls(), kind, st.tab.signature, { map: st.map, qtyUnit: st.qtyUnit });
      st.result = null; st.match = null; rr();
    });
    return el('tr', null, el('td', null, h), el('td', { class: 'muted small' }, sample(i)), el('td', null, s));
  });
  return el('div', { class: 'sm-imp-map' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('label', null, 'Nazwy kolumn: ', head),
      el('span', { class: 'muted small' }, st.name + ' · ' + (st.raw.kind === 'xlsx' ? 'Excel' : 'CSV' + (st.raw.encoding ? ', ' + st.raw.encoding : '')) + ' · ' + cnt(st.tab.total, 'wiersz', 'wiersze', 'wierszy') + (st.tab.truncated ? ' (czytam pierwsze ' + L.MAX_ROWS + ')' : '')),
      st.remembered ? el('span', { class: 'ord-st acc', title: 'Przypisanie kolumn zapamiętane z poprzedniego pliku o tych samych nagłówkach (w tej przeglądarce)' }, 'zapamiętane kolumny') : null),
    fold(prefix + 'Cols', ['Kolumny pliku', miss.length ? ' — przypisz: ' + miss.map(k => L.labelOf(kind, k)).join(', ') : ' — ' + st.map.filter(Boolean).length + ' przypisanych; zmień, jeśli panel się pomylił'],
      el('p', { class: 'muted small' }, 'Wybierz, co jest w każdej kolumnie (* = wymagane). Kolumny „— pomiń —” nie są nigdzie używane. Wybór zapamiętamy w tej przeglądarce dla plików o tych samych nagłówkach.' +
        (mask ? ' Przykładowe wartości są zamaskowane — plik może zawierać dane odbiorców.' : '')),
      el('div', { class: 'table-wrap' }, el('table', { id: prefix + 'MapTable' }, el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Nazwa kolumny w pliku' }, 'Kolumna w pliku')),
        el('th', null, el('span', { title: 'Pierwsze wartości z tej kolumny' + (mask ? ' (zamaskowane)' : '') }, 'Przykład')), el('th', null, el('span', { title: 'Co zawiera ta kolumna' }, 'Znaczenie')))), el('tbody', null, rows)))),
    miss.length ? notice('warn', 'Przypisz kolumny: ' + miss.map(k => L.labelOf(kind, k)).join(', ') + '.') : null);
}

// ─── 1. Plik dostawy → dosyłki ──────────────────────────────────────────────
const D = { name: '', raw: null, tab: null, map: [], head: 0, qtyUnit: 'unit', label: '', err: '', busy: false, result: null, run: '', saving: false };

function deliveryRows(cfg) {
  if (!D.tab || L.missingFields('delivery', D.map).length) return null;
  return L.buildDelivery(D.tab, D.map, cfg, { qtyUnit: D.qtyUnit, aliases: L.loadAliases(ls()), label: D.label });
}
const STATUS_TXT = { ok: 'do dodania', unmatched: 'nierozpoznany produkt', invalid: 'błędne dane', skip: 'pominięty' };

export function deliveryCard(v) {
  const body = [notice('info', 'Wzoru pliku od dostawcy jeszcze nie znamy — panel sam rozpozna kolumny (produkt, ilość, jednostka, kartony, paleta), a jeśli się pomyli, przypisz je ręcznie. ',
    'Plik jest czytany tylko w tej przeglądarce. Najpierw zobaczysz podgląd; nic nie zostanie zapisane bez potwierdzenia.')];
  body.push(el('div', { class: 'mag-form' }, fileBlock(D, 'delivery', 'smImp', () => { D.run = runId(); }, 'Plik dostawy (Excel lub CSV)', 'Lista towaru wysłanego do SpeedMail: produkt (nazwa albo ID z Selly), ilość, opcjonalnie jednostka, kartony, paleta')));
  if (D.busy) body.push(el('p', { role: 'status' }, el('span', { class: 'spinner' }), ' Czytam plik…'));
  if (D.err) body.push(notice('error', D.err));
  if (D.raw && D.tab) {
    body.push(mappingBlock(D, 'delivery', 'smImp', false));
    const hasUnit = D.map.includes('unit');
    const unitSel = el('select', { id: 'smImpUnit', 'aria-label': 'Jednostka ilości w pliku', disabled: hasUnit || null,
      title: hasUnit ? 'Plik ma kolumnę „Jednostka” — jednostkę bierzemy z każdego wiersza' : 'W czym podano ilości: w sztukach (OrszaKrówki w kg) czy w opakowaniach SpeedMail (wiązki, paczki, rolki — przeliczamy wg Ustawień)' },
    el('option', { value: 'unit' }, 'w sztukach (krówki w kg)'), el('option', { value: 'pack' }, 'w opakowaniach SpeedMail (wiązki, paczki…)'));
    unitSel.value = D.qtyUnit;
    unitSel.addEventListener('change', () => { D.qtyUnit = unitSel.value; L.saveMap(ls(), 'delivery', D.tab.signature, { map: D.map, qtyUnit: D.qtyUnit }); D.result = null; rr(); });
    const labelIn = el('input', { type: 'text', id: 'smImpLabel', maxlength: '60', value: D.label, placeholder: 'np. WZ 12/11, dostawa 2', 'aria-label': 'Opis dostawy' });
    labelIn.addEventListener('change', () => { D.label = labelIn.value.trim(); rr(); });
    body.push(el('div', { class: 'mag-form' },
      el('label', null, el('span', { class: 'tip', title: 'Dotyczy plików bez kolumny „Jednostka”' }, 'Ilości w pliku są'), unitSel),
      el('label', null, el('span', { class: 'tip', title: 'Trafia do opisu każdej dosyłki (historia korekt) — razem z paletą i numerem wiersza pliku' }, 'Opis dostawy (opcjonalnie)'), labelIn)));
    const rows = deliveryRows(v.cfg);
    if (rows) body.push(deliveryPreview(rows, v));
  }
  return el('div', { class: 'card sm-foldcard', id: 'smImp' }, fold('smImpFold', ['Import dosyłki z pliku dostawcy', ' — Excel lub CSV: produkt, ilość (sztuki / opakowania / kg), kartony, paleta'], ...body));
}

function deliveryPreview(rows, v) {
  const s = L.deliverySummary(rows), res = D.result || {}, print = L.contentPrint(rows), before = L.importedAt(ls(), print);
  const out = [el('div', { class: 'tabs', id: 'smImpSum', style: 'margin-top:var(--s3)' },
    tile(s.ok, 'do dodania', 'Wiersze rozpoznane i poprawne — po potwierdzeniu każdy zapisze się jako dosyłka (zwiększa stan w SpeedMail)', 'smImpOk'),
    tile(s.unmatched, 'nierozpoznane', 'Wiersze, których produktu nie ma na liście SpeedMail albo nazwa pasuje do kilku — przypisz produkt niżej', 'smImpUnm'),
    tile(s.invalid, 'błędne', 'Wiersze z błędną ilością albo jednostką (np. sztuki dla produktu liczonego w kg) — popraw plik', 'smImpBad'),
    tile(s.skip, 'pominięte', 'Puste wiersze i wiersze podsumowania („Razem”) — nie są importowane', 'smImpSkip'))];
  if (s.products.length) out.push(el('p', { class: 'small', id: 'smImpTotals' }, 'Razem: ', s.products.map(p => p.name + ' +' + nf(p.qty) + ' ' + p.unit).join(', ')));
  // nierozpoznane nazwy — ręczne przypisanie (zapamiętane w tej przeglądarce)
  const names = [...new Map(rows.filter(r => r.status === 'unmatched' && r.text).map(r => [r.text, r])).values()].slice(0, 30);
  if (names.length) {
    const prods = SM.tableProducts(v.cfg);
    out.push(el('div', { class: 'card', id: 'smImpAliases', style: 'margin-top:var(--s2)' }, el('h4', { style: 'margin:0' }, 'Przypisz nierozpoznane produkty'),
      el('p', { class: 'muted small' }, 'Wybierz produkt SpeedMail dla nazwy z pliku. Panel zapamięta to w tej przeglądarce i następnym razem rozpozna nazwę sam.'),
      names.map((r, i) => {
        const sel = el('select', { id: 'smImpAlias' + i, 'aria-label': 'Produkt dla „' + r.text + '”' }, el('option', { value: '' }, '— nie importuj —'),
          (r.candidates || []).length ? el('optgroup', { label: 'Podobne' }, r.candidates.map(k => el('option', { value: k }, (prodOf(k) || { name: k }).name))) : null,
          el('optgroup', { label: 'Wszystkie' }, prods.map(p => el('option', { value: p.key }, p.name))));
        sel.addEventListener('change', () => { L.saveAlias(ls(), r.text, sel.value); D.result = null; rr(); });
        return el('div', { class: 'toolbar' }, el('span', { title: r.reasons.join('; ') }, '„' + r.text.slice(0, 60) + '”'), sel);
      })));
  }
  if (before) out.push(notice('warn', 'Te same pozycje z tego pliku zapisano już ' + dmy(before.day) + ' (' + cnt(before.n, 'dosyłka', 'dosyłki', 'dosyłek') + '). Zapisz ponownie tylko, jeśli to naprawdę druga dostawa.'));
  const shown = rows.filter(r => r.status !== 'skip').slice(0, 300);
  out.push(el('div', { class: 'table-wrap' }, el('table', { id: 'smImpRows' },
    el('thead', null, el('tr', null, [['Wiersz', 'Numer wiersza w pliku'], ['Z pliku', 'Nazwa albo ID produktu z pliku'], ['Produkt SpeedMail', 'Rozpoznany produkt z listy SpeedMail (i jak go rozpoznano)'],
      ['Ilość', 'Ilość po przeliczeniu na jednostkę produktu (sztuki; OrszaKrówki w kg) — tyle zwiększy się stan'], ['Opakowań', 'Ta sama ilość w opakowaniach SpeedMail (jak w tabeli zleceń)'], ['Wynik', 'Status wiersza w podglądzie, a po zapisie — wynik zapisu']]
      .map(([h, t], i) => el('th', { class: i === 3 || i === 4 ? 'n' : null }, el('span', { class: i >= 2 ? 'tip' : null, title: t }, h))))),
    el('tbody', null, shown.map(r => {
      const done = res[r.line];
      return el('tr', { 'data-line': String(r.line), 'data-status': done ? done.state : r.status },
        el('td', { class: 'n' }, String(r.line)), el('td', null, r.text.slice(0, 60)),
        el('td', { title: r.how ? 'Rozpoznano: ' + r.how : null }, r.name || '—'),
        el('td', { class: 'n nw' }, r.status === 'ok' ? '+' + nf(r.qty) + ' ' + r.unit : ''), el('td', { class: 'n' }, r.status === 'ok' ? nf(r.packs) : ''),
        el('td', null, done ? el('span', { class: done.state === 'done' ? 'ok' : 'diffbad' }, done.state === 'done' ? 'zapisano' : 'nie zapisano: ' + done.error)
          : [STATUS_TXT[r.status], r.reasons.length ? ' — ' + r.reasons.join('; ') : '', r.warns.length ? el('span', { class: 'muted small', title: r.warns.join('\n') }, ' ⚠ ' + r.warns[0]) : null]));
    })))));
  if (rows.filter(r => r.status !== 'skip').length > shown.length) out.push(el('p', { class: 'muted small' }, 'Pokazuję pierwsze ' + shown.length + ' wierszy; zapis obejmie wszystkie „do dodania”.'));
  const todo = rows.filter(r => r.status === 'ok' && !(res[r.line] && res[r.line].state === 'done'));
  const failed = Object.values(res).filter(x => x.state === 'failed').length;
  out.push(el('div', { class: 'ord-actions' },
    el('button', { type: 'button', class: 'secondary', id: 'smImpClear', onclick: () => { Object.assign(D, { raw: null, tab: null, name: '', result: null, err: '' }); rr(); } }, 'Wyczyść'),
    el('button', { type: 'button', class: 'primary', id: 'smImpSave', write: WRITE, disabled: !todo.length || D.saving || jobBusy() || null,
      title: todo.length ? 'Zapisuje ' + todo.length + ' dosyłek w rejestrze SpeedMail (stan rośnie od razu). Wiersze nierozpoznane i błędne są pomijane.' : 'Brak wierszy do zapisania',
      onclick: () => saveDelivery(rows, todo, print) }, D.saving ? 'Zapisuję…' : failed ? 'Ponów nieudane (' + todo.length + ')' : 'Zapisz dosyłki (' + todo.length + ')')));
  return el('div', { id: 'smImpPreview' }, out);
}

async function saveDelivery(rows, todo, print) {
  const sum = L.deliverySummary(todo);
  if (!confirm('Zapisać ' + cnt(todo.length, 'dosyłkę', 'dosyłki', 'dosyłek') + ' w stanie SpeedMail?\n\n' + sum.products.map(p => p.name + ': +' + nf(p.qty) + ' ' + p.unit).join('\n') +
    (rows.length - todo.length ? '\n\nPominięte wiersze (nierozpoznane, błędne, puste, już zapisane): ' + (rows.length - todo.length) : ''))) return;
  D.saving = true; D.result = D.result || {}; rr();
  // porcje liczone z całego podglądu (stałe numery) — ponowienie nieudanej porcji ma ten sam opId, więc serwer nie zapisze jej drugi raz
  const all = L.moveChunks(rows), want = new Set(todo.map(r => r.line));
  let ok = 0;
  for (const ch of all) {
    if (!ch.lines.some(l => want.has(l))) continue;
    try {
      await api('sm:move', { moves: ch.moves, opId: L.moveOpId(D.run, ch.n) });
      for (const l of ch.lines) D.result[l] = { state: 'done' };
      ok += ch.lines.length;
    } catch (e) { for (const l of ch.lines) D.result[l] = { state: 'failed', error: ((e && e.message) || 'błąd').slice(0, 160) }; }
    rr();
  }
  D.saving = false;
  if (ok) {
    L.rememberImport(ls(), print, { day: S.d ? S.d.v.today : new Date().toISOString().slice(0, 10), n: Object.values(D.result).filter(x => x.state === 'done').length });
    flash('', 'Zapisano dosyłki z pliku: ' + ok);
    await reload('init', 'list');
  }
  rr();
}

// ─── 2. Raport wysyłek SpeedMail ────────────────────────────────────────────
const R = { name: '', raw: null, tab: null, map: [], head: 0, err: '', busy: false, match: null, checking: false, overwrite: false, outside: false, target: '', trk: null, run: '' };

function defaultTarget() {
  const st = S.d ? S.d.v.statuses : [], use = S.d ? S.d.v.use : {};
  const sent = st.find(s => /wys[lł]an|nadan/i.test(s.name) && !/speed/i.test(s.name));
  return String(sent ? sent.id : use.acc || '');
}

export function shipCard() {
  const body = [notice('info', 'Wzoru raportu SpeedMail jeszcze nie znamy — panel rozpozna kolumny (numer zamówienia, numer paczki zleceń, numer przesyłki, status), a jeśli się pomyli, przypisz je ręcznie. ',
    'Raport może zawierać dane odbiorców: czytamy go tylko w tej przeglądarce i nigdzie nie zapisujemy — do serwera trafiają same numery zamówień i paczek.')];
  body.push(el('div', { class: 'mag-form' }, fileBlock(R, 'ship', 'smShip', () => { R.run = runId(); R.trk = null; }, 'Raport wysyłek SpeedMail (Excel lub CSV)', 'Lista paczek nadanych przez SpeedMail: numer zamówienia (albo paczki zleceń) i numer przesyłki')));
  if (R.busy) body.push(el('p', { role: 'status' }, el('span', { class: 'spinner' }), ' Czytam plik…'));
  if (R.err) body.push(notice('error', R.err));
  if (R.raw && R.tab) {
    body.push(mappingBlock(R, 'ship', 'smShip', true));
    const ok = !L.missingFields('ship', R.map).length;
    const rows = ok ? L.buildShipping(R.tab, R.map, SM.parseRef) : [];
    if (ok) {
      body.push(el('div', { class: 'ord-actions' },
        el('button', { type: 'button', class: R.match ? 'secondary' : 'primary', id: 'smShipRun', disabled: !rows.length || R.checking || null,
          title: 'Porównuje raport z paczkami zleceń zapisanymi w panelu. Na serwer idą tylko numery zamówień i paczek. Nic nie zapisuje.', onclick: () => checkShip(rows) },
        R.checking ? 'Sprawdzam…' : 'Porównaj z paczkami (' + cnt(rows.length, 'wiersz', 'wiersze', 'wierszy') + ')')));
      if (R.match) body.push(shipResult(rows));
    }
  }
  return el('div', { class: 'card sm-foldcard', id: 'smShip' }, fold('smShipFold', ['Raport wysyłek SpeedMail', ' — które zamówienia z paczek SpeedMail wysłał; numery przesyłek i status w Selly'], ...body));
}

async function checkShip(rows) {
  R.checking = true; R.err = ''; rr();
  try {
    const parts = [];
    for (const req of L.shipRequests(rows)) parts.push(await api('sm:shipMatch', req));
    R.match = L.mergeMatch(parts); R.trk = null;
    if (!R.target) R.target = defaultTarget();
  } catch (e) { R.err = (e && e.message) || 'Nie udało się porównać raportu.'; }
  R.checking = false; rr();
}

function shipResult(rows) {
  const an = L.analyseShipping(rows, R.match), out = [];
  const tot = an.batches.reduce((a, b) => ({ total: a.total + b.total, shipped: a.shipped + b.shipped }), { total: 0, shipped: 0 });
  out.push(el('div', { class: 'tabs', id: 'smShipSum', style: 'margin-top:var(--s3)' },
    tile(tot.shipped + ' / ' + tot.total, 'wysłane z paczek', 'Ile zamówień z paczek zleceń, których dotyczy raport, SpeedMail wysłał (wg raportu) — z wszystkich czynnych zleceń tych paczek', 'smShipTileSent'),
    tile(tot.total - tot.shipped, 'niewysłane', 'Zamówienia z tych paczek, których nie ma w raporcie (albo raport podaje je jako niewysłane)', 'smShipTileNot'),
    tile(an.unknown.length, 'nieznane numery', 'Numery z raportu, których nie ma ani w paczkach SpeedMail, ani w zamówieniach panelu — sprawdź kolumnę numeru', 'smShipTileUnk'),
    tile(an.outside.length, 'spoza paczek', 'Zamówienia z raportu, których panel nie przekazał do SpeedMail w żadnej paczce', 'smShipTileOut')));
  const warns = [];
  if (an.missingRefs.length) warns.push('Raport wskazuje paczki, których nie ma w panelu: nr ' + an.missingRefs.slice(0, 10).join(', ') + '.');
  if (an.refMismatch.length) warns.push('Zamówienia przypisane w raporcie do innej paczki niż w panelu: ' + an.refMismatch.slice(0, 10).join(', ') + (an.refMismatch.length > 10 ? '…' : '') + '.');
  if (an.multi.length) warns.push('Kilka numerów przesyłki dla jednego zamówienia (' + an.multi.length + ') — w Selly wpiszemy pierwszy.');
  if (an.badTracking) warns.push('Wiersze z numerem przesyłki w nieznanym formacie: ' + an.badTracking + ' — tych numerów nie wpiszemy.');
  if (an.truncated) warns.push('Raport dotyczy ponad 50 paczek — pokazuję pierwsze 50.');
  if (warns.length) out.push(notice('warn', warns.join(' ')));
  out.push(el('div', { class: 'table-wrap' }, el('table', { id: 'smShipBatches' },
    el('thead', null, el('tr', null, [['Paczka', 'Paczka zleceń (link do szczegółów)'], ['Data', 'Dzień przekazania paczki'], ['Zamówień', 'Czynne zlecenia w paczce (bez anulowanych)'],
      ['Wysłane', 'Zamówienia z paczki, które są w raporcie jako wysłane'], ['Niewysłane', 'Zamówienia z paczki, których nie ma w raporcie albo raport podaje je jako niewysłane'], ['Anulowane', 'Zlecenia anulowane po przekazaniu (w nawiasie: ile mimo to jest w raporcie)']]
      .map(([h, t], i) => el('th', { class: i >= 2 ? 'n' : null }, el('span', { class: i >= 3 ? 'tip' : null, title: t }, h))))),
    el('tbody', null, an.batches.length ? an.batches.map(b => el('tr', { 'data-no': String(b.no) },
      el('td', { class: 'nw' }, el('a', { href: '#/speedmail/paczki?paczka=' + b.no, title: 'Szczegóły paczki ' + b.ref }, 'nr ' + b.no), el('span', { class: 'muted small' }, ' ' + b.ref)),
      el('td', { class: 'nw' }, dmy(b.day)), el('td', { class: 'n' }, String(b.total)), el('td', { class: 'n' }, String(b.shipped)),
      el('td', { class: 'n', title: b.notShipped ? 'Niewysłane: ' + b.orders.filter(o => !o.cancelled && !o.shipped).slice(0, 40).map(o => o.orderNumber + (o.reportedNotShipped ? ' (' + (o.statusText || 'niewysłane wg raportu') + ')' : '')).join(', ') : null },
        el('span', { class: b.notShipped ? 'diffbad' : null }, String(b.notShipped))),
      el('td', { class: 'n' }, b.cancelled ? b.cancelled + (b.cancelledInReport ? ' (' + b.cancelledInReport + ')' : '') : '')))
      : el('tr', null, el('td', { colspan: '6', class: 'empty' }, 'Żaden numer z raportu nie pasuje do paczek zleceń w panelu.'))))));
  const notList = an.batches.flatMap(b => b.orders.filter(o => !o.cancelled && !o.shipped).map(o => ({ ...o, no: b.no })));
  if (notList.length) {
    out.push(fold('smShipNot', ['Niewysłane zamówienia', ' — ' + notList.length], el('ul', { id: 'smShipNotList', class: 'small' }, notList.slice(0, 200).map(o => el('li', null,
      el('a', { href: '#/zamowienia/' + encodeURIComponent(o.orderId) }, o.orderNumber), ' — paczka nr ' + o.no + (o.reportedNotShipped ? ' · raport: ' + (o.statusText || 'niewysłane') : ' · brak w raporcie'))))));
  }
  if (an.unknown.length) out.push(fold('smShipUnk', ['Nieznane numery z raportu', ' — ' + an.unknown.length], el('p', { class: 'small', id: 'smShipUnkList' }, an.unknown.slice(0, 200).join(', '))));
  out.push(shipActions(an));
  return el('div', { id: 'smShipResult' }, out);
}

function shipActions(an) {
  const use = S.d ? S.d.v.use : {}, statuses = S.d ? S.d.v.statuses : [];
  const plan = L.trackingPlan(an, { overwrite: R.overwrite, outside: R.outside });
  const cnts = a => plan.filter(p => p.action === a).length;
  const toSet = plan.filter(p => p.action === 'set' || p.action === 'replace');
  const stPlan = R.target ? L.statusPlan(an, R.target, { outside: R.outside }) : [];
  const cb = (id, val, label, tip, on) => { const c = el('input', { type: 'checkbox', id }); c.checked = val; c.addEventListener('change', () => { on(c.checked); rr(); }); return el('label', { title: tip }, c, ' ' + label); };
  const sel = el('select', { id: 'smShipStatus', 'aria-label': 'Status docelowy' }, el('option', { value: '' }, '— wybierz —'), statuses.map(s => el('option', { value: s.id }, s.name + (s.id === use.acc ? ' (przyjęte przez SM)' : ''))));
  sel.value = R.target;
  sel.addEventListener('change', () => { R.target = sel.value; rr(); });
  const trk = R.trk;
  return el('div', { class: 'card', id: 'smShipAct', style: 'margin-top:var(--s3)' },
    el('h4', { style: 'margin:0' }, 'Zmiany w Selly (tylko po potwierdzeniu)'),
    el('p', { class: 'muted small' }, 'Dotyczą tylko zamówień wysłanych wg raportu. Panel niczego nie zmienia sam — każdą zmianę zobaczysz przed zapisem, a po zapisie wynik dla każdego zamówienia.'),
    el('div', { class: 'toolbar' },
      cb('smShipOverwrite', R.overwrite, 'zastąp inne numery przesyłek', 'Domyślnie wpisujemy numer tylko tam, gdzie w Selly pole jest puste. Zaznacz, by zastąpić inny, już wpisany numer.', x => { R.overwrite = x; }),
      cb('smShipOutside', R.outside, 'także zamówienia spoza paczek', 'Uwzględnia zamówienia z raportu, których panel nie przekazał do SpeedMail żadną paczką (' + an.outside.length + ')', x => { R.outside = x; })),
    el('p', { class: 'small', id: 'smShipTrkPlan' }, 'Numery przesyłek: do wpisania ', el('b', null, String(cnts('set'))), R.overwrite ? [' · do zastąpienia ', el('b', null, String(cnts('replace')))] : [' · inny numer w Selly (pominięte) ', el('b', null, String(cnts('differs')))],
      ' · już wpisane ', el('b', null, String(cnts('same'))), ' · bez numeru w raporcie ', el('b', null, String(cnts('none')))),
    toSet.length ? fold('smShipTrkPrev', ['Podgląd zmian numerów', ' — ' + toSet.length], el('ul', { class: 'small', id: 'smShipTrkList' }, toSet.slice(0, 100).map(p => el('li', null, p.orderNumber + ': ' + (p.current ? p.current + ' → ' : '') + p.tracking)))) : null,
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'smShipTrk', write: ORD_WRITE, disabled: !toSet.length || (trk && trk.running) || jobBusy() || null,
      title: toSet.length ? 'Wpisuje numer przesyłki w ' + toSet.length + ' zamówieniach w Selly — po kolei, z przerwami (limit API)' : 'Brak numerów do wpisania', onclick: () => runTracking(toSet) },
    trk && trk.running ? 'Wpisuję… ' + trk.n + ' z ' + trk.items.length : 'Wpisz numery przesyłek w Selly (' + toSet.length + ')')),
    trk && !trk.running ? trackResult(trk) : null,
    el('div', { class: 'toolbar', style: 'margin-top:var(--s3)' }, el('label', { title: 'Status, na który zmienić zamówienia wysłane przez SpeedMail (np. „Wysłane”)' }, el('span', { class: 'tip' }, 'Status po wysyłce: '), sel),
      el('span', { class: 'muted small', id: 'smShipStPlan' }, R.target ? 'do zmiany: ' + stPlan.length + ' (pozostałe mają już ten status)' : '')),
    el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', id: 'smShipSt', write: STATUS_WRITE, disabled: !stPlan.length || jobBusy() || null,
      title: stPlan.length ? 'Zmienia w Selly status ' + stPlan.length + ' zamówień na „' + statusName(R.target) + '”' : 'Wybierz status — albo wszystkie wysłane zamówienia już go mają',
      onclick: () => {
        if (!confirm('Zmienić w Selly status ' + cnt(stPlan.length, 'zamówienia', 'zamówień', 'zamówień') + ' wysłanych przez SpeedMail na „' + statusName(R.target) + '”?\n\n' + stPlan.slice(0, 15).map(o => o.orderNumber).join(', ') + (stPlan.length > 15 ? '…' : ''))) return;
        runStatus({ ids: stPlan.map(o => o.orderId), target: R.target, title: 'Raport wysyłek SpeedMail', numOf: new Map(stPlan.map(o => [o.orderId, o.orderNumber])), then: () => checkShip(L.buildShipping(R.tab, R.map, SM.parseRef)) });
      } }, 'Zmień status w Selly' + (stPlan.length ? ' (' + stPlan.length + ')' : ''))));
}

async function runTracking(items) {
  if (!confirm('Wpisać numer przesyłki w ' + cnt(items.length, 'zamówieniu', 'zamówieniach', 'zamówieniach') + ' w Selly?\n\n' + items.slice(0, 15).map(p => p.orderNumber + ': ' + (p.current ? p.current + ' → ' : '') + p.tracking).join('\n') + (items.length > 15 ? '\n…' : ''))) return;
  const job = R.trk = { running: true, items, n: 0, res: {} };
  rr();
  const r = await runThrottled(items, p => api('orders:update', { id: p.orderId, fields: { tracking_code: p.tracking }, opId: L.trackOpId(R.run, p.orderId + '-' + p.tracking) }), {
    gapMs: TRACK_GAP_MS,
    onItem: (p, res, err) => { job.n++; job.res[p.orderId] = err ? { ok: false, error: ((err && err.message) || 'błąd').slice(0, 160) } : { ok: true }; const b = document.getElementById('smShipTrk'); if (b) b.textContent = 'Wpisuję… ' + job.n + ' z ' + items.length; },
  });
  job.running = false; job.paused = r.paused; job.rest = r.rest;
  const ok = Object.values(job.res).filter(x => x.ok).length;
  if (ok) flash('', 'Wpisano numer przesyłki: ' + ok);
  // świeże numery z Selly → ponowne porównanie (to, co już wpisane, wypada z planu)
  if (ok) await checkShip(L.buildShipping(R.tab, R.map, SM.parseRef));
  R.trk = job; rr();
}
function trackResult(t) {
  const bad = t.items.filter(p => t.res[p.orderId] && !t.res[p.orderId].ok), ok = t.items.filter(p => t.res[p.orderId] && t.res[p.orderId].ok);
  return el('div', { id: 'smShipTrkRes' },
    el('p', null, 'Wpisano: ', el('strong', null, String(ok.length)), ' · nieudane: ', el('strong', null, String(bad.length)), t.rest && t.rest.length ? ' · wstrzymano po kilku błędach z rzędu, niewykonane: ' + t.rest.length : ''),
    bad.length ? el('ul', { class: 'ord-fails' }, bad.slice(0, 30).map(p => el('li', null, el('strong', null, p.orderNumber), ' — ' + t.res[p.orderId].error))) : null);
}
