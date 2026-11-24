// Moduł „Magazyny”: stany, wysyłka SpeedMail, do rozliczenia, nowy ruch, inwentaryzacja, historia.
// Trasy: #/magazyny/stany, #/magazyny/speedmail, #/magazyny/rozliczenie, #/magazyny/ruch, #/magazyny/inwentaryzacja, #/magazyny/historia.
// Dane i zapisy: backend Warehouses.gs (akcje mag:init, mag:moves).
import { $, el, plural, debounce, store, flash, norm, tableTsv, tableHtml, menuButton, downloadXlsx, downloadCsv, tableMatrix, copyToClipboard, today, htmlEsc, dateInput } from '../core/ui.js?v=094b3e3';
import { api } from '../core/client.js?v=094b3e3';
import { go } from '../core/router.js?v=094b3e3';

const TEMPLATE = `<div id="modMag"><nav class="viewnav" aria-label="Widok magazynów" id="magnav"></nav><div id="magBody"></div></div>`;

// Adres widoku w hashu ↔ klucz widoku (SpeedMail ma w adresie czytelną nazwę)
const SLUGS = { wysylka: 'speedmail' };
const viewOfSlug = slug => { const k = Object.keys(SLUGS).find(x => SLUGS[x] === slug); return k || slug; };
const goView = k => go('/magazyny/' + (SLUGS[k] || k));


const mag = {
  data: null, loading: false, view: 'stany', err: '',
  q: '', onlyDiff: false, hideEmpty: false, sort: { key: 'name', dir: 1 },
  sel: new Map(),                      // „Do rozliczenia”: klucz pozycji → { on, wh }
  form: { type: 'przyjecie', product: '', qty: '', from: '', to: '', note: '' },
  inv: { wh: '', counts: {}, q: '', paste: '', unmatched: [], startDate: '', sort: { key: 'name', dir: 1 } },
  hist: { sort: { key: 'ms', dir: -1 } },
};
const MAG_VIEWS = [
  ['stany', 'Stany', 'Ile sztuk każdego produktu jest fizycznie w każdym magazynie (z ruchów wpisanych w panelu) i czym to się różni od stanu w Selly'],
  ['wysylka', 'Wysyłka SpeedMail', 'Podział zamówień „Złożone SpeedMail” na wysyłane do SpeedMail i realizowane na miejscu, plik dla SpeedMail i zatwierdzenie wysyłki'],
  ['rozliczenie', 'Do rozliczenia', 'Wysłane zamówienia, z których jeszcze nie zapisano wydania towaru z magazynu'],
  ['ruch', 'Nowy ruch', 'Przyjęcie towaru, przesunięcie między magazynami albo ręczna korekta stanu'],
  ['inwentaryzacja', 'Inwentaryzacja', 'Policz towar w magazynie i wpisz, ile faktycznie jest — panel sam wyliczy korekty'],
  ['historia', 'Historia', 'Ostatnie ruchy magazynowe (przyjęcia, przesunięcia, wydania, korekty)'],
];
const MOVE_NAMES = { przyjecie: 'Przyjęcie', przesuniecie: 'Przesunięcie', wydanie: 'Wydanie', korekta: 'Korekta' };
const MOVE_TIPS = {
  przyjecie: 'Towar dotarł do magazynu (np. dostawa, produkcja) — stan wybranego magazynu rośnie',
  przesuniecie: 'Towar przenosisz z jednego magazynu do drugiego — razem nic się nie zmienia',
  korekta: 'Ręczna poprawka stanu jednego magazynu (np. zgubiony lub znaleziony towar): + dodaje, − odejmuje',
};

const nf = n => (n == null || n === '' ? '—' : String(Math.round(n * 1000) / 1000).replace('.', ','));
const whName = id => { const w = mag.data && mag.data.warehouses.find(x => x.id === id); return w ? w.name : (id || ''); };
const prodLabel = p => p.name + (p.code ? ' · ' + p.code : '');
const isPartial = () => !(mag.data && mag.data.startMs);
const magDate = ms => (ms ? new Date(ms).toLocaleDateString('pl-PL') : '—');
const magKey = it => it.orderId + '|' + it.productOrderId;

async function magLoad(extra) {
  mag.loading = true; mag.err = '';
  magRender();
  try {
    const ids = store('osa-mag-shipped');
    const p = Object.assign({}, extra);
    if (Array.isArray(ids)) p.shippedStatusIds = ids;
    mag.data = await api('mag:init', p);
    const keys = new Set(mag.data.pending.map(magKey));
    for (const k of [...mag.sel.keys()]) if (!keys.has(k)) mag.sel.delete(k);
    if (!mag.inv.wh && mag.data.warehouses.length) mag.inv.wh = (mag.data.warehouses.find(w => w.isDefault) || mag.data.warehouses[0]).id;
  } catch (e) { mag.err = e.message || 'Nie udało się pobrać danych magazynów.'; }
  mag.loading = false;
  magRender();
}

/** Zapis ruchów → toast, odświeżenie danych. Zwraca true przy sukcesie; błąd (np. walidacji backendu) pokazuje w msgBox. */
async function magSave(moves, msgBox, btn, startMs) {
  msgBox.replaceChildren();
  if (btn) btn.disabled = true;
  try {
    const params = { moves };
    if (startMs != null) params.startMs = startMs;
    const r = await api('mag:moves', params);
    flash('', 'Zapisano ruchów: ' + r.saved + (r.skipped ? ' (pominięto ' + r.skipped + ' — już rozliczone)' : ''));
    await magLoad();
    return true;
  } catch (e) {
    msgBox.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, e.message));
    if (btn) btn.disabled = false;
    return false;
  }
}

function magRender() {
  const root = $('magBody'), nav = $('magnav');
  if (!root) return;
  nav.replaceChildren(...MAG_VIEWS.map(([k, label, tip]) => {
    const cnt = k === 'rozliczenie' && mag.data && !isPartial() ? ' (' + mag.data.pending.length + ')' : '';
    return el('button', { type: 'button', 'aria-pressed': String(mag.view === k), title: tip + (cnt ? '\n\nLiczba w nawiasie = pozycje zamówień czekające na rozliczenie' : ''),
      onclick: () => goView(k) }, label + cnt);
  }));
  if (mag.loading && !mag.data) { root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), 'Pobieram stany magazynów…')))); return; }
  if (!mag.data) {
    root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się otworzyć magazynów: ' + mag.err, el('div', null, el('button', { type: 'button', class: 'secondary', onclick: () => magLoad() }, 'Spróbuj ponownie')))));
    return;
  }
  const v = { stany: magStany, wysylka: magWysylka, rozliczenie: magRozliczenie, ruch: magRuch, inwentaryzacja: magInwent, historia: magHistoria }[mag.view];
  const parts = [];
  if (mag.err) parts.push(el('div', { class: 'notice error' }, mag.err));
  if (isPartial() && (mag.view === 'stany' || mag.view === 'rozliczenie')) parts.push(magStartInfo());
  else parts.push(v());
  root.replaceChildren(...parts);
}

function magStartInfo() {
  return el('div', { class: 'card' }, el('div', { class: 'empty' },
    el('p', null, el('strong', null, 'Zacznij od inwentaryzacji')),
    el('p', null, 'Wpisz, ile faktycznie masz w każdym magazynie; od tej daty panel liczy stany i pokazuje zamówienia do rozliczenia.'),
    el('button', { type: 'button', onclick: () => goView('inwentaryzacja') }, 'Przejdź do inwentaryzacji')));
}

/** Tabela z sortowaniem po kliknięciu w nagłówek. cols: { key, label, tip, num, val(row), cell(row) }. */
function magTable(cols, rows, sort, redraw, empty) {
  const c = cols.find(x => x.key === sort.key);
  if (c) rows = rows.slice().sort((a, b) => {
    const x = c.val(a), y = c.val(b), ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    return (c.num ? x - y : String(x).localeCompare(String(y), 'pl')) * sort.dir;
  });
  const head = el('tr', null, cols.map(col => {
    const active = sort.key === col.key, tip = col.tip || col.label;
    return el('th', { class: col.num ? 'n' : null, 'aria-sort': active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: col.tip ? 'tip' : null, title: tip + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
        onclick: () => { sort.dir = active ? -sort.dir : (col.num ? -1 : 1); sort.key = col.key; redraw(); } },
        col.label + (active ? (sort.dir > 0 ? ' ↑' : ' ↓') : '')));
  }));
  const body = el('tbody');
  if (!rows.length) body.append(el('tr', null, el('td', { colspan: String(cols.length), class: 'empty' }, empty || 'Brak danych.')));
  for (const r of rows) body.append(el('tr', null, cols.map(col => el('td', { class: col.num ? 'n' : null }, col.cell(r)))));
  return el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, head), body));
}

const prodCell = p => [el('div', { class: 'cell-name' }, p.name), p.code ? el('div', { class: 'muted small' }, p.code) : null];

// ── Stany ───────────────────────────────────────────────────────────────
function magStany() {
  const d = mag.data, box = el('div'), out = el('div');
  const q = el('input', { type: 'search', placeholder: 'Szukaj po nazwie lub kodzie…', 'aria-label': 'Szukaj produktu', value: mag.q });
  const od = el('input', { type: 'checkbox' }); od.checked = mag.onlyDiff;
  const he = el('input', { type: 'checkbox' }); he.checked = mag.hideEmpty;
  const count = el('span', { class: 'count' });
  const draw = () => {
    const qn = norm(mag.q);
    let whs = d.warehouses;
    if (mag.hideEmpty) whs = whs.filter(w => d.products.some(p => (p.phys[w.id] || 0) !== 0));
    const tot = p => d.warehouses.reduce((s, w) => s + (p.phys[w.id] || 0), 0);
    const diff = p => (p.selly == null ? null : tot(p) - p.selly);
    let rows = d.products.filter(p => !qn || norm(p.name + ' ' + p.code).includes(qn));
    if (mag.onlyDiff) rows = rows.filter(p => diff(p) != null && diff(p) !== 0);
    count.textContent = rows.length + ' ' + plural(rows.length, 'produkt', 'produkty', 'produktów');
    const cols = [{ key: 'name', label: 'Produkt', tip: 'Nazwa produktu i jego kod', val: p => p.name, cell: prodCell }];
    for (const w of whs) cols.push({ key: 'wh:' + w.id, label: w.name, num: true, tip: 'Ile sztuk jest fizycznie w magazynie „' + w.name + '” (z ruchów wpisanych w panelu od startu ewidencji)',
      val: p => p.phys[w.id] || 0, cell: p => nf(p.phys[w.id] || 0) });
    cols.push({ key: 'tot', label: 'Razem fizycznie', num: true, tip: 'Suma stanów fizycznych ze wszystkich magazynów' + (mag.hideEmpty ? ' (także ukrytych)' : ''), val: tot, cell: p => el('strong', null, nf(tot(p))) });
    cols.push({ key: 'selly', label: 'Selly', num: true, tip: 'Stan produktu wg Selly (łącznie, wszystkie magazyny Selly)', val: p => p.selly, cell: p => nf(p.selly) });
    cols.push({ key: 'diff', label: 'Różnica', num: true, tip: 'Fizycznie − Selly. Różna od zera = stan w Selly nie zgadza się z tym, co panel zna z ruchów', val: diff,
      cell: p => { const x = diff(p); return x == null ? '—' : el('span', { class: x !== 0 ? 'diffbad' : 'muted', title: x !== 0 ? (x > 0 ? 'Fizycznie jest więcej niż w Selly' : 'Fizycznie jest mniej niż w Selly') : null }, (x > 0 ? '+' : '') + nf(x)); } });
    out.replaceChildren(magTable(cols, rows, mag.sort, draw, mag.onlyDiff ? 'Brak różnic — stany zgadzają się z Selly.' : 'Brak produktów.'));
  };
  q.addEventListener('input', () => { mag.q = q.value; draw(); });
  od.addEventListener('change', () => { mag.onlyDiff = od.checked; draw(); });
  he.addEventListener('change', () => { mag.hideEmpty = he.checked; draw(); });
  box.append(el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, q,
      el('label', { title: 'Pokaż tylko produkty, w których stan fizyczny różni się od stanu w Selly' }, od, 'tylko z różnicą'), count,
      el('span', { class: 'sp' }),
      el('button', { type: 'button', class: 'secondary', title: 'Pobierz ponownie stany z panelu i z Selly', onclick: () => magLoad() }, '↻ Odśwież')),
    d.stockError ? el('div', { class: 'notice warn' }, 'Nie udało się pobrać stanów z Selly: ' + d.stockError + ' Kolumny „Selly” i „Różnica” mogą być puste.') : null,
    el('div', { class: 'muted small', style: 'margin-top:8px' }, (d.stockAt ? 'Stany Selly z: ' + d.stockAt + '. ' : 'Brak stanów z Selly. ') + 'Stan fizyczny liczymy z ruchów wpisanych w panelu od ' + magDate(d.startMs) + '.'),
    el('details', { class: 'fold' }, el('summary', null, el('span', null, 'Ustawienia zaawansowane')),
      el('label', { title: 'Chowa kolumny magazynów, w których wszystkie produkty mają stan 0 (suma „Razem fizycznie” nadal liczy wszystkie magazyny)', style: 'display:block;margin-top:8px' }, he, 'Ukryj magazyny, w których wszędzie jest 0')),
    out));
  draw();
  return box;
}

// ── Do rozliczenia ─────────────────────────────────────────────────────────
/** Magazyny wg Selly przeliczone na id naszych magazynów (backend może podać id albo nazwę). */
function sellyParts(it) {
  const ws = mag.data.warehouses;
  return (it.selly || []).map(s => { const w = ws.find(x => x.id === s.wh) || ws.find(x => norm(x.name) === norm(s.wh)); return { wh: w ? w.id : '', qty: s.qty, name: w ? w.name : String(s.wh) }; });
}
function selFor(it) {
  const k = magKey(it);
  if (!mag.sel.has(k)) {
    const parts = sellyParts(it);
    mag.sel.set(k, { on: false, wh: parts.length > 1 && parts.every(p => p.wh) ? 'split' : (parts.length === 1 ? parts[0].wh : '') });
  }
  return mag.sel.get(k);
}

function magRozliczenie() {
  const d = mag.data, box = el('div'), msg = el('div');
  const groups = new Map();
  for (const it of d.pending) { if (!groups.has(it.orderId)) groups.set(it.orderId, []); groups.get(it.orderId).push(it); }
  const checks = [];
  const ok = el('button', { type: 'button', title: 'Zapisuje wydanie towaru z wybranych magazynów dla zaznaczonych pozycji' }, 'Zatwierdź zaznaczone');
  const all = el('button', { type: 'button', class: 'secondary', title: 'Zaznacza (albo odznacza, gdy wszystkie są już zaznaczone) wszystkie pozycje na liście' }, 'Zaznacz wszystkie');
  const updBtn = () => { const n = d.pending.filter(it => selFor(it).on).length; ok.textContent = 'Zatwierdź zaznaczone' + (n ? ' (' + n + ')' : ''); ok.disabled = !n; };
  all.addEventListener('click', () => {
    const on = !d.pending.every(it => selFor(it).on);
    for (const it of d.pending) selFor(it).on = on;
    for (const c of checks) c.checked = on;
    updBtn();
  });
  ok.addEventListener('click', async () => {
    const moves = [];
    for (const it of d.pending) {
      const s = selFor(it); if (!s.on) continue;
      const base = { type: 'wydanie', productId: it.productId, productName: it.name, to: '', orderId: it.orderId, orderNumber: it.orderNumber, productOrderId: it.productOrderId, note: '' };
      if (s.wh === 'split') for (const p of sellyParts(it)) moves.push(Object.assign({}, base, { qty: p.qty, from: p.wh }));
      else if (!s.wh) { msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Wybierz magazyn („Wydano z”) przy pozycji: ' + it.name + ' (zamówienie ' + it.orderNumber + ').')); return; }
      else moves.push(Object.assign({}, base, { qty: it.qty, from: s.wh }));
    }
    await magSave(moves, msg, ok);
  });

  const list = el('div');
  const th = (t, tip, n) => el('th', { class: n ? 'n' : null }, el('span', { class: 'tip', title: tip }, t));
  for (const items of groups.values()) {
    const rows = items.map(it => {
      const s = selFor(it), parts = sellyParts(it);
      const cb = el('input', { type: 'checkbox', 'aria-label': 'Zaznacz: ' + it.name }); cb.checked = s.on;
      cb.addEventListener('change', () => { s.on = cb.checked; updBtn(); });
      checks.push(cb);
      const sel = el('select', { 'aria-label': 'Wydano z — ' + it.name });
      if (parts.length > 1) sel.append(el('option', { value: 'split' }, 'wg Selly: ' + parts.map(p => p.qty + '×' + p.name).join(' + ')));
      if (!s.wh) sel.append(el('option', { value: '' }, '— wybierz magazyn —'));
      for (const w of d.warehouses) sel.append(el('option', { value: w.id }, w.name));
      sel.value = s.wh;
      sel.addEventListener('change', () => { s.wh = sel.value; });
      return el('tr', null, el('td', null, cb), el('td', null, prodCell(it), it.variant ? el('div', { class: 'muted small' }, it.variant) : null), el('td', { class: 'n' }, nf(it.qty)), el('td', null, sel));
    });
    list.append(el('section', { class: 'card' },
      el('h3', null, 'Zamówienie ' + items[0].orderNumber, el('span', { class: 'muted small', style: 'font-weight:400' }, ' · ' + items[0].date)),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, th('✓', 'Zaznacz, aby zatwierdzić tę pozycję'), th('Produkt', 'Produkt z zamówienia'), th('Ilość', 'Ile sztuk w zamówieniu', true), th('Wydano z', 'Z którego magazynu wyszedł towar. Domyślnie tak, jak w Selly; wybór jednego magazynu zapisuje całą ilość z niego'))),
        el('tbody', null, rows)))));
  }
  const ids = store('osa-mag-shipped'), set = new Set(Array.isArray(ids) ? ids : d.statuses.filter(s => s.shipped).map(s => s.id));
  const stBox = el('div', { class: 'statuses' }, d.statuses.map(s => {
    const c = el('input', { type: 'checkbox', value: s.id }); c.checked = set.has(s.id);
    c.addEventListener('change', () => { store('osa-mag-shipped', [...stBox.querySelectorAll('input:checked')].map(i => i.value)); magLoad(); });
    return el('label', null, c, s.name);
  }));
  box.append(el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('strong', { class: 'count' }, d.pending.length + ' ' + plural(d.pending.length, 'pozycja', 'pozycje', 'pozycji') + ' do rozliczenia'), el('span', { class: 'sp' }), all, ok),
    el('div', { class: 'muted small' }, 'Wysłane zamówienia od ' + magDate(d.startMs) + ', z których nie zapisano jeszcze wydania towaru.'),
    msg,
    el('details', { class: 'fold' }, el('summary', null, el('span', null, 'Ustawienia zaawansowane')),
      el('p', { class: 'muted small' }, 'Które statusy zamówień uznajemy za „wysłane”. Zmiana odświeża listę.'), stBox)),
    d.pending.length ? list : el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Wszystko rozliczone.')));
  updBtn();
  return box;
}

// ── Wysyłka SpeedMail ──────────────────────────────────────────────────────
// Sklep liczy sztuki, SpeedMail (SM) komplety (mag.data.packs[productId].size = sztuk w komplecie; brak wpisu = 1).
const sm = { orders: null, loading: false, err: '', forStatus: '', forced: new Map(), ref: '', done: null, editPid: '', sort: { key: 'name', dir: 1 } };
const smPack = pid => { const p = (mag.data.packs || {})[pid]; return { size: p && p.size >= 1 ? p.size : 1, smName: (p && p.smName) || '' }; };
const smSettings = () => {
  const d = mag.data;
  let st = store('osa-sm-status'); if (!d.statuses.some(s => s.id === st)) { const f = d.statuses.find(s => norm(s.name).includes('speed') && norm(s.name).includes('zloz')); st = f ? f.id : ''; }
  let wh = store('osa-sm-wh'); if (!d.warehouses.some(w => w.id === wh)) { const f = d.warehouses.find(w => norm(w.name).includes('speed')); wh = f ? f.id : ''; }
  return { st, wh };
};

async function smLoad() {
  const { st } = smSettings();
  sm.loading = true; sm.err = ''; sm.forStatus = st; sm.forced.clear();
  magRender();
  try { sm.orders = (await api('mag:orders', { statusIds: [st] })).orders || []; }
  catch (e) { sm.err = e.message || 'Nie udało się pobrać zamówień.'; sm.orders = []; }
  sm.loading = false;
  magRender();
}

/** Podział: najstarsze zamówienia pierwsze; do SM trafia zamówienie, którego WSZYSTKIE pozycje mieszczą się w pozostałym stanie SM. */
function smCompute(orders, wh) {
  const stock = {}; for (const p of mag.data.products) stock[p.id] = Math.max(0, (p.phys && p.phys[wh]) || 0);
  const rem = Object.assign({}, stock), rows = [];
  for (const o of orders) {
    const need = {}, names = {};
    for (const it of o.items) { need[it.productId] = (need[it.productId] || 0) + it.qty; names[it.productId] = it.name; }
    const miss = Object.keys(need).filter(pid => need[pid] > (rem[pid] || 0)).map(pid => names[pid] + ' (brakuje ' + nf(need[pid] - (rem[pid] || 0)) + ' szt.)');
    if (!miss.length) for (const pid in need) rem[pid] -= need[pid];
    const auto = miss.length ? 'otk' : 'sm', group = sm.forced.get(o.orderId) || auto;
    rows.push({ o, need, names, auto, group, reason: miss.join(', '), forced: group !== auto });
  }
  const send = rows.filter(r => r.group === 'sm'), local = rows.filter(r => r.group === 'otk');
  const use = {}; for (const r of send) for (const pid in r.need) use[pid] = (use[pid] || 0) + r.need[pid];
  for (const r of send) r.over = Object.keys(r.need).filter(pid => use[pid] > (stock[pid] || 0));
  return { rows, send, local, stock, use };
}

function smXlsxTable(res) {
  const prods = [], seen = new Set();
  for (const r of res.send) for (const it of r.o.items) if (!seen.has(it.productId)) { seen.add(it.productId); prods.push({ id: it.productId, name: it.name }); }
  const cols = [{ header: 'Nr zamówienia', type: 'text' }, { header: 'Data', type: 'text' }].concat(prods.map(p => ({ header: smPack(p.id).smName || p.name, type: 'number' })));
  const rows = res.send.map(r => [r.o.orderNumber, r.o.date].concat(prods.map(p => (r.need[p.id] || 0) ? (r.need[p.id] / smPack(p.id).size) : null)));
  rows.push(['Razem', ''].concat(prods.map(p => (res.use[p.id] || 0) / smPack(p.id).size)));
  return { file: 'wysylka-speedmail', sheet: 'Wysyłka SM', columns: cols, rows };
}

function smListCard(title, tip, nums, empty) {
  return el('div', { class: 'card' }, el('h3', { title: tip }, el('span', { class: 'tip' }, title)),
    nums.length ? [el('div', { class: 'toolbar', style: 'margin-top:0' }, el('strong', { class: 'count' }, nums.length + ' ' + plural(nums.length, 'zamówienie', 'zamówienia', 'zamówień')), el('span', { class: 'sp' }),
      el('button', { type: 'button', class: 'secondary', title: 'Kopiuje numery zamówień, po jednym w wierszu — wklej je w Selly przy zmianie statusu', onclick: () => copyToClipboard(nums.join('\n'), null, 'Skopiowano ' + nums.length + ' numerów zamówień') }, 'Kopiuj numery')),
      el('div', { class: 'muted small smnums' }, nums.join(', '))] : el('div', { class: 'muted small' }, empty));
}

function magWysylka() {
  const d = mag.data, box = el('div'), { st, wh } = smSettings();
  const whSel = el('select', { 'aria-label': 'Magazyn SpeedMail', title: 'Magazyn, z którego liczymy dostępny towar i z którego zapiszemy wydanie' }, el('option', { value: '' }, '— wybierz —'), d.warehouses.map(w => el('option', { value: w.id }, w.name)));
  const stSel = el('select', { 'aria-label': 'Status zamówień do SpeedMail', title: 'Zamówienia w tym statusie w Selly są kandydatami do wysłania do SpeedMail' }, el('option', { value: '' }, '— wybierz —'), d.statuses.map(s => el('option', { value: s.id }, s.name)));
  whSel.value = wh; stSel.value = st;
  whSel.addEventListener('change', () => { store('osa-sm-wh', whSel.value); magRender(); });
  stSel.addEventListener('change', () => { store('osa-sm-status', stSel.value); sm.orders = null; sm.done = null; magRender(); });
  box.append(el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('strong', null, 'Wysyłka do SpeedMail'), el('span', { class: 'sp' }),
      el('button', { type: 'button', class: 'secondary', title: 'Pobierz ponownie zamówienia i stany magazynów', onclick: async () => { await magLoad(); smLoad(); } }, '↻ Odśwież')),
    el('details', { class: 'fold', open: !st || !wh }, el('summary', null, el('span', null, 'Ustawienia wysyłki')),
      el('div', { class: 'mag-form' }, el('label', null, 'Status zamówień „do SpeedMail”', stSel), el('label', null, 'Magazyn SpeedMail', whSel)))));

  if (!st || !wh) { box.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, !wh && !st ? 'Wybierz w ustawieniach status zamówień i magazyn SpeedMail.' : !wh ? 'Nie znaleziono magazynu SpeedMail — wybierz go w ustawieniach wysyłki.' : 'Nie znaleziono statusu „Złożone SpeedMail” — wybierz go w ustawieniach wysyłki.'))); return box; }
  if (sm.orders === null || sm.forStatus !== st) { if (!sm.loading) smLoad(); }
  if (sm.loading || sm.orders === null) { box.append(el('div', { class: 'card' }, el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), 'Pobieram zamówienia…')))); return box; }
  if (sm.err) box.append(el('div', { class: 'notice error', role: 'alert' }, sm.err));
  if (isPartial()) box.append(el('div', { class: 'notice warn' }, 'Stan magazynu SpeedMail jest nieznany — nie było jeszcze inwentaryzacji, więc wszystkie zamówienia trafią „na miejscu”. ',
    el('a', { href: '#', onclick: ev => { ev.preventDefault(); goView('inwentaryzacja'); } }, 'Przejdź do inwentaryzacji')));

  const all = sm.orders, open = all.map(o => Object.assign({}, o, { items: o.items.filter(i => !i.settled) })).filter(o => o.items.length), settledN = all.length - open.length;
  if (sm.done) box.append(smDoneCard());
  if (!open.length) {
    box.append(el('div', { class: 'card' }, el('div', { class: 'empty' }, all.length ? 'Wszystkie zamówienia w tym statusie mają już zapisane wydanie (' + all.length + ').' : 'Brak zamówień w wybranym statusie.')));
    return box;
  }
  const res = smCompute(open, wh);
  const prods = new Map();
  for (const o of open) for (const it of o.items) {
    if (!prods.has(it.productId)) prods.set(it.productId, { id: it.productId, name: it.name, code: it.code || '', total: 0 });
    prods.get(it.productId).total += it.qty;
  }
  const lacking = [...prods.values()].filter(p => p.total > (res.stock[p.id] || 0)).length;
  const tile = (n, label, title) => el('div', { class: 'tab static', title }, el('b', null, String(n)), el('span', null, label));
  box.append(el('div', { class: 'tabs', style: 'margin-top:var(--s3)' },
    tile(res.send.length, 'do SpeedMail', 'Zamówienia, które w całości mieszczą się w stanie magazynu SpeedMail (lub zostały tam ręcznie przeniesione)'),
    tile(res.local.length, 'na miejscu (Złożone OTK)', 'Zamówienia, których SpeedMail nie zrealizuje w całości — realizujesz je u siebie'),
    tile(lacking, 'produktów z brakiem', 'Produkty, których w otwartych zamówieniach jest więcej niż w magazynie SpeedMail')));
  if (settledN) box.append(el('div', { class: 'muted small', style: 'margin-top:8px' }, 'Pominięto ' + settledN + ' ' + plural(settledN, 'zamówienie', 'zamówienia', 'zamówień') + ' z już zapisanym wydaniem.'));

  const flip = (r, to) => { if (to === r.auto) sm.forced.delete(r.o.orderId); else sm.forced.set(r.o.orderId, to); magRender(); };
  const ordTable = (rows, toSm) => el('div', { class: 'table-wrap' }, el('table', null,
    el('thead', null, el('tr', null,
      el('th', null, el('span', { class: 'tip', title: 'Numer zamówienia w Selly' }, 'Zamówienie')), el('th', null, el('span', { title: 'Data zamówienia' }, 'Data')),
      el('th', null, el('span', { class: 'tip', title: 'Pozycje zamówienia w sztukach' }, 'Pozycje')),
      el('th', null, el('span', { class: 'tip', title: toSm ? 'Ostrzeżenie pojawia się, gdy zamówienie przeniesiono do SpeedMail mimo braku towaru' : 'Które produkty nie mieszczą się w stanie SpeedMail' }, toSm ? 'Uwagi' : 'Powód')),
      el('th', null, el('span', { title: 'Ręczne przeniesienie zamówienia do drugiej grupy' }, 'Przenieś')))),
    el('tbody', null, rows.length ? rows.map(r => el('tr', null,
      el('td', null, r.o.orderNumber), el('td', null, r.o.date || ''),
      el('td', null, r.o.items.map(i => i.name + ' × ' + nf(i.qty)).join(', ')),
      el('td', null, toSm ? (r.over.length ? el('span', { class: 'diffbad', title: 'SpeedMail nie ma tyle towaru — przeniesiono ręcznie mimo braku' }, '⚠ brak towaru: ' + r.over.map(pid => r.names[pid]).join(', ')) : (r.forced ? 'przeniesiono ręcznie' : '')) : (r.reason || (r.forced ? 'przeniesiono ręcznie' : ''))),
      el('td', null, el('button', { type: 'button', class: 'secondary', title: toSm ? 'Przenieś to zamówienie na miejscu (Złożone OTK)' : 'Przenieś to zamówienie do SpeedMail (nawet gdy brakuje towaru)', onclick: () => flip(r, toSm ? 'otk' : 'sm') }, toSm ? '→ na miejscu' : '→ do SM')))) :
      el('tr', null, el('td', { colspan: '5', class: 'empty' }, 'Brak zamówień w tej grupie.')))));
  box.append(el('div', { class: 'card' }, el('h3', null, 'Wyślij do SpeedMail (' + res.send.length + ')'), ordTable(res.send, true)));
  box.append(el('div', { class: 'card' }, el('h3', null, 'Na miejscu — Złożone OTK (' + res.local.length + ')'), ordTable(res.local, false),
    el('div', { style: 'margin-top:var(--s3)' }, smListCard('Zmień w Selly status na „Złożone OTK”', 'Numery zamówień, które realizujesz na miejscu', res.local.map(r => r.o.orderNumber), 'Brak.'))));

  const cols = [
    { key: 'name', label: 'Produkt', tip: 'Nazwa produktu i jego kod', val: p => p.name, cell: p => [prodCell(p), el('button', { type: 'button', class: 'secondary', style: 'margin-top:4px', title: 'Edytuj przelicznik: ile sztuk jest w komplecie i jak produkt nazywa się w pliku dla SpeedMail', onclick: () => { sm.editPid = sm.editPid === p.id ? '' : p.id; magRender(); } }, '✎ komplet: ' + smPack(p.id).size + ' szt.')] },
    { key: 'need', label: 'Potrzeba (szt.)', num: true, tip: 'Ile sztuk tego produktu jest w zamówieniach z grupy „Wyślij do SpeedMail”', val: p => res.use[p.id] || 0, cell: p => nf(res.use[p.id] || 0) },
    { key: 'needK', label: 'Potrzeba (komplety)', num: true, tip: 'Sztuki ÷ sztuk w komplecie — tyle kompletów trafia do pliku dla SpeedMail. Wyróżnione, gdy zamówienie nie jest wielokrotnością kompletu', val: p => (res.use[p.id] || 0) / smPack(p.id).size,
      cell: p => { const k = (res.use[p.id] || 0) / smPack(p.id).size; return Number.isInteger(k) ? nf(k) : el('span', { class: 'diffbad', title: 'Zamówienie nie jest wielokrotnością kompletu (' + smPack(p.id).size + ' szt.) — sprawdź przelicznik' }, nf(k)); } },
    { key: 'stock', label: 'Stan SM (szt.)', num: true, tip: 'Ile sztuk jest w magazynie SpeedMail wg panelu (z inwentaryzacji i ruchów)', val: p => res.stock[p.id] || 0, cell: p => nf(res.stock[p.id] || 0) },
    { key: 'stockK', label: 'Stan SM (komplety)', num: true, tip: 'Stan magazynu SpeedMail w kompletach', val: p => (res.stock[p.id] || 0) / smPack(p.id).size, cell: p => nf((res.stock[p.id] || 0) / smPack(p.id).size) },
    { key: 'left', label: 'Zostanie po wysyłce (szt.)', num: true, tip: 'Stan SpeedMail minus potrzeba. Ujemny = brakuje towaru', val: p => (res.stock[p.id] || 0) - (res.use[p.id] || 0),
      cell: p => { const x = (res.stock[p.id] || 0) - (res.use[p.id] || 0); return el('span', { class: x < 0 ? 'diffbad' : null }, nf(x)); } },
  ];
  const sumBox = el('div');
  box.append(el('div', { class: 'card' }, el('h3', null, 'Podsumowanie produktów'), magTable(cols, [...prods.values()], sm.sort, magRender, 'Brak produktów.'), sumBox));
  const ep = sm.editPid && prods.get(sm.editPid);
  if (ep) {
    const pk = smPack(ep.id);
    const size = el('input', { type: 'number', min: '1', step: '1', value: String(pk.size), 'aria-label': 'Sztuk w komplecie' }), nm = el('input', { type: 'text', value: pk.smName, placeholder: ep.name, 'aria-label': 'Nazwa w pliku dla SpeedMail' });
    const pmsg = el('div');
    const save = el('button', { type: 'button', id: 'smPackSave', onclick: async () => {
      const n = Number(size.value);
      if (!Number.isInteger(n) || n < 1) { pmsg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Liczba sztuk w komplecie musi być całkowita, co najmniej 1.')); return; }
      save.disabled = true;
      try { await api('mag:packs', { packs: [{ productId: ep.id, name: ep.name, size: n, smName: nm.value.trim() }] }); flash('', 'Zapisano przelicznik'); sm.editPid = ''; await magLoad(); }
      catch (e) { pmsg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, e.message)); save.disabled = false; }
    } }, 'Zapisz przelicznik');
    sumBox.append(el('div', { class: 'mag-form', id: 'smPackEdit' }, el('strong', null, 'Przelicznik: ' + ep.name),
      el('label', { title: 'Ile sztuk sklepu to jeden komplet w SpeedMail (np. 50 chorągiewek)' }, 'Sztuk w komplecie', size),
      el('label', { title: 'Nazwa produktu w nagłówku kolumny pliku dla SpeedMail; puste = nazwa ze sklepu' }, 'Nazwa w pliku dla SM', nm), pmsg,
      el('div', { class: 'toolbar', style: 'margin-top:0' }, save, el('button', { type: 'button', class: 'secondary', onclick: () => { sm.editPid = ''; magRender(); } }, 'Anuluj'))));
  }

  const tbl = smXlsxTable(res);
  const ref = el('input', { type: 'text', id: 'smRef', placeholder: 'SM-' + today().replace(/-/g, '') + '-1', value: sm.ref, 'aria-label': 'Numer referencyjny wysyłki', title: 'Unikalny numer, który nadajesz wysyłce — po nim zidentyfikujesz paczki w raporcie SpeedMail' });
  ref.addEventListener('input', () => { sm.ref = ref.value; });
  const msg = el('div');
  const go = el('button', { type: 'button', id: 'smConfirm', disabled: !res.send.length, title: 'Zapisuje wydanie towaru z magazynu SpeedMail dla wszystkich zamówień z grupy „Wyślij do SpeedMail”' }, 'Zatwierdź wysyłkę do SM');
  go.addEventListener('click', async () => {
    const r = sm.ref.trim();
    if (!r) { msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Wpisz numer referencyjny wysyłki.')); return; }
    if (!confirm('Zatwierdzić wysyłkę ' + r + ' (' + res.send.length + ' ' + plural(res.send.length, 'zamówienie', 'zamówienia', 'zamówień') + ') i zapisać wydanie z magazynu SpeedMail?')) return;
    go.disabled = true; msg.replaceChildren();
    try {
      const out = await api('mag:confirm', { ref: r, whId: wh, orderIds: res.send.map(x => x.o.orderId) });
      flash('', 'Zatwierdzono wysyłkę ' + (out.ref || r) + ' (zamówień: ' + out.orders + ')');
      sm.done = { ref: out.ref || r, sent: res.send.map(x => x.o.orderNumber), local: res.local.map(x => x.o.orderNumber) };
      sm.ref = ''; sm.forced.clear();
      await magLoad(); await smLoad();
    } catch (e) { msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, e.message)); go.disabled = false; }
  });
  box.append(el('div', { class: 'card' }, el('h3', null, 'Plik i zatwierdzenie'),
    el('div', { class: 'toolbar', style: 'margin-top:0' },
      el('button', { type: 'button', class: 'secondary', id: 'smXlsx', disabled: !res.send.length, title: 'Wiersze: zamówienia do SpeedMail; kolumny: po jednej na produkt (liczba kompletów). Format pliku można dopasować do wzoru SpeedMail — adresy do wysyłki dojdą później', onclick: () => downloadXlsx(tbl, '') }, 'Pobierz plik dla SpeedMail (.xlsx)'),
      el('button', { type: 'button', class: 'secondary', id: 'smCopy', disabled: !res.send.length, title: 'Ta sama tabela jako tekst do wklejenia w arkusz', onclick: () => copyToClipboard(tableTsv(tbl), tableHtml(tbl), 'Skopiowano tabelę dla SpeedMail — wklej w arkuszu') }, 'Kopiuj')),
    el('div', { class: 'mag-form' }, el('label', null, 'Numer referencyjny wysyłki', ref), msg, el('div', null, go))));
  return box;
}

function smDoneCard() {
  const dn = sm.done;
  return el('div', { class: 'card', id: 'smDone' }, el('h3', null, 'Co teraz zrobić w Selly (wysyłka ' + dn.ref + ')'),
    smListCard('Zmień status na „Przyjęte SpeedMail”', 'Zamówienia wysłane do SpeedMail', dn.sent, 'Brak.'),
    el('div', { style: 'margin-top:var(--s3)' }, smListCard('Zmień status na „Złożone OTK”', 'Zamówienia realizowane na miejscu', dn.local, 'Brak.')));
}

// ── Nowy ruch ──────────────────────────────────────────────────────────────
function whSelect(value, onchange, label) {
  const s = el('select', { 'aria-label': label }, el('option', { value: '' }, '— wybierz —'), mag.data.warehouses.map(w => el('option', { value: w.id }, w.name)));
  s.value = value; s.addEventListener('change', () => onchange(s.value));
  return s;
}
function findProduct(text) {
  const t = norm(text.trim()); if (!t) return null;
  const ps = mag.data.products;
  return ps.find(p => norm(prodLabel(p)) === t) || ps.find(p => p.code && norm(p.code) === t) || ps.find(p => norm(p.name) === t) || null;
}

function magRuch() {
  const f = mag.form, d = mag.data, box = el('div'), msg = el('div'), fields = el('div', { class: 'mag-form' });
  const dl = el('datalist', { id: 'magProducts' }, d.products.map(p => el('option', { value: prodLabel(p) })));
  const draw = () => {
    const field = (label, tip, input) => el('label', { class: 'field' }, el('span', { class: 'label' }, el('span', { class: tip ? 'tip' : null, title: tip }, label)), input);
    const prod = el('input', { type: 'text', list: 'magProducts', value: f.product, placeholder: 'Zacznij pisać nazwę lub kod…', autocomplete: 'off' });
    prod.addEventListener('input', () => { f.product = prod.value; });
    const qty = el('input', { type: 'number', step: 'any', value: f.qty, inputmode: 'decimal' });
    qty.addEventListener('input', () => { f.qty = qty.value; });
    const note = el('input', { type: 'text', value: f.note, maxlength: '200', placeholder: 'np. dostawa od producenta (opcjonalnie)' });
    note.addEventListener('input', () => { f.note = note.value; });
    const kinds = el('div', { class: 'seg wrap', role: 'group', 'aria-label': 'Rodzaj ruchu' }, ['przyjecie', 'przesuniecie', 'korekta'].map(k =>
      el('button', { type: 'button', 'aria-pressed': String(f.type === k), title: MOVE_TIPS[k], onclick: () => { f.type = k; draw(); } }, MOVE_NAMES[k])));
    fields.replaceChildren(
      field('Rodzaj ruchu', null, kinds), el('div', { class: 'muted small' }, MOVE_TIPS[f.type]),
      field('Produkt', 'Wybierz z listy podpowiedzi: „nazwa · kod”', prod),
      field(f.type === 'korekta' ? 'Zmiana ilości (+ dodaje, − odejmuje)' : 'Ilość', f.type === 'korekta' ? 'Np. -2 gdy brakuje dwóch sztuk, 3 gdy znalazły się trzy' : null, qty),
      f.type === 'przesuniecie' ? field('Z magazynu', 'Magazyn, z którego zabierasz towar', whSelect(f.from, v => { f.from = v; }, 'Z magazynu')) : null,
      field(f.type === 'korekta' ? 'Magazyn' : 'Do magazynu', null, whSelect(f.to, v => { f.to = v; }, 'Magazyn docelowy')),
      field('Notatka', null, note));
  };
  const go = el('button', { type: 'button' }, 'Zapisz ruch');
  go.addEventListener('click', async () => {
    const err = t => msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, t));
    const p = findProduct(f.product), q = parseFloat(String(f.qty).replace(',', '.'));
    if (!p) return err('Wybierz produkt z listy podpowiedzi.');
    if (!isFinite(q) || q === 0) return err('Wpisz ilość (różną od zera).');
    if (f.type !== 'korekta' && q < 0) return err('Ilość musi być dodatnia.');
    if (f.type === 'przesuniecie' && !f.from) return err('Wybierz magazyn, z którego przesuwasz.');
    if (!f.to) return err('Wybierz magazyn' + (f.type === 'przesuniecie' ? ' docelowy.' : '.'));
    if (f.type === 'przesuniecie' && f.from === f.to) return err('Magazyn źródłowy i docelowy muszą być różne.');
    const ok = await magSave([{ type: f.type, productId: p.id, productName: p.name, qty: q, from: f.type === 'przesuniecie' ? f.from : '', to: f.to, orderId: '', productOrderId: '', note: f.note }], msg, go);
    if (ok) { f.product = ''; f.qty = ''; f.note = ''; }
  });
  draw();
  box.append(el('div', { class: 'card' }, el('h2', null, 'Nowy ruch magazynowy'), dl, fields, msg, el('div', { class: 'row' }, go)));
  return box;
}

// ── Inwentaryzacja ────────────────────────────────────────────────────────
function magInwent() {
  const d = mag.data, iv = mag.inv, box = el('div'), msg = el('div'), out = el('div'), info = el('div');
  if (!iv.startDate) { const t = new Date(); iv.startDate = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
  const counts = () => (iv.counts[iv.wh] = iv.counts[iv.wh] || {});
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
  const now = p => (p.phys[iv.wh] || 0);
  const cnt = p => num(counts()[p.id]);
  const cor = p => { const c = cnt(p); return c == null ? null : c - now(p); };
  const corNode = p => { const x = cor(p); return x == null ? '—' : el('span', { class: x !== 0 ? 'diffbad' : 'muted' }, (x > 0 ? '+' : '') + nf(x)); };
  const diffs = () => d.products.map(p => ({ p, d: cor(p) })).filter(x => x.d != null && x.d !== 0);
  const save = el('button', { type: 'button' }, 'Zapisz inwentaryzację');
  const upd = () => { const n = diffs().length; save.disabled = (!n && !first) || !iv.wh; info.textContent = n ? 'Do zapisania: ' + n + ' ' + plural(n, 'korekta', 'korekty', 'korekt') + '.' : 'Wpisz ilości w kolumnie „Policzono” — zapisane zostaną tylko produkty, w których różnią się od „Teraz”.'; };
  const draw = () => {
    const qn = norm(iv.q);
    const rows = d.products.filter(p => !qn || norm(p.name + ' ' + p.code).includes(qn));
    const cols = [
      { key: 'name', label: 'Produkt', tip: 'Nazwa produktu i jego kod', val: p => p.name, cell: prodCell },
      { key: 'now', label: 'Teraz (wg panelu)', num: true, tip: 'Stan tego magazynu wg panelu: ruchy wpisane od startu ewidencji', val: now, cell: p => nf(now(p)) },
      { key: 'cnt', label: 'Policzono', num: true, tip: 'Ile faktycznie naliczyłeś. Puste pole = nie liczyłeś tego produktu (bez zmian)', val: cnt,
        cell: p => { const i = el('input', { type: 'number', step: 'any', inputmode: 'decimal', style: 'width:90px', 'aria-label': 'Policzono: ' + p.name, value: counts()[p.id] == null ? '' : counts()[p.id] });
          i.addEventListener('input', () => { counts()[p.id] = i.value; i.closest('tr').querySelector('.cor').replaceChildren(corNode(p)); upd(); }); return i; } },
      { key: 'cor', label: 'Korekta', num: true, tip: 'Policzono − Teraz. Tyle panel doda (+) albo odejmie (−) po zapisie', val: cor, cell: p => el('span', { class: 'cor' }, corNode(p)) },
    ];
    out.replaceChildren(magTable(cols, rows, iv.sort, draw, 'Brak produktów.'));
    upd();
  };

  const whSel = el('select', { 'aria-label': 'Magazyn do inwentaryzacji' }, d.warehouses.map(w => el('option', { value: w.id }, w.name)));
  whSel.value = iv.wh; whSel.addEventListener('change', () => { iv.wh = whSel.value; draw(); });
  const q = el('input', { type: 'search', placeholder: 'Szukaj po nazwie lub kodzie…', 'aria-label': 'Szukaj produktu', value: iv.q });
  q.addEventListener('input', () => { iv.q = q.value; draw(); });

  const pasteBox = el('textarea', { rows: '5', style: 'width:100%', placeholder: 'kod lub nazwa [Tab] ilość — po jednym produkcie w wierszu', 'aria-label': 'Wklej z Excela' }, iv.paste);
  const unm = el('div');
  const showUnm = () => unm.replaceChildren(iv.unmatched.length ? el('div', { class: 'notice warn' }, el('div', null, 'Nie dopasowano wierszy: ' + iv.unmatched.length), el('ul', null, iv.unmatched.map(t => el('li', null, t)))) : '');
  const load = el('button', { type: 'button', class: 'secondary', title: 'Dopasowuje wiersze po kodzie, a gdy się nie uda — po nazwie, i wpisuje ilości w kolumnę „Policzono”' }, 'Wczytaj wklejone');
  load.addEventListener('click', () => {
    iv.paste = pasteBox.value; iv.unmatched = []; let n = 0;
    for (const line of iv.paste.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let key, qty;
      const tab = line.split('\t').map(s => s.trim()).filter(s => s !== '');
      if (tab.length >= 2) { key = tab[0]; qty = tab[tab.length - 1]; } else { const m = line.trim().match(/^(.*\S)\s+(-?[\d.,]+)$/); if (m) { key = m[1]; qty = m[2]; } }
      const c = key == null ? null : num(qty), k = key && norm(key);
      const p = k && (d.products.find(x => x.code && norm(x.code) === k) || d.products.find(x => norm(x.name) === k));
      if (!p || c == null) { iv.unmatched.push(line.trim().slice(0, 120)); continue; }
      counts()[p.id] = String(c); n++;
    }
    showUnm(); draw();
    if (n) flash('', 'Wczytano ilości: ' + n);
  });

  const first = isPartial();
  const dateIn = dateInput({ value: iv.startDate, label: 'Data startu ewidencji', required: true });
  dateIn.addEventListener('input', () => { iv.startDate = dateIn.value; });
  save.addEventListener('click', async () => {
    const list = diffs();
    if (!list.length && !first) return;
    let startMs;
    if (first) { startMs = new Date(iv.startDate + 'T00:00:00').getTime(); if (!isFinite(startMs)) { msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Wpisz poprawną datę startu ewidencji.')); return; } }
    const moves = list.map(x => ({ type: 'korekta', productId: x.p.id, productName: x.p.name, qty: x.d, from: '', to: iv.wh, orderId: '', productOrderId: '', note: 'Inwentaryzacja' }));
    const done = await magSave(moves, msg, save, startMs);
    if (done) { delete iv.counts[iv.wh]; iv.unmatched = []; iv.paste = ''; }
  });

  box.append(el('div', { class: 'card' },
    el('h2', null, 'Inwentaryzacja'),
    first ? el('div', { class: 'notice warn' }, 'To pierwsza inwentaryzacja. Policz towar i zapisz — od tego momentu panel liczy stany i zamówienia do rozliczenia.') : null,
    el('div', { class: 'toolbar' }, el('label', null, 'Magazyn: ', whSel), q,
      first ? el('label', { class: 'tip', title: 'Od tej daty (godz. 00:00) panel liczy stany i pokazuje do rozliczenia wysłane zamówienia. Ustawiana tylko przy pierwszej inwentaryzacji — zwykle dzień, w którym liczysz towar.' }, 'Data startu ewidencji: ', dateIn) : null),
    el('details', { class: 'fold' }, el('summary', null, el('span', null, 'Wklej z Excela')),
      el('p', { class: 'muted small' }, 'Dwie kolumny: kod (albo nazwa produktu) i ilość. Dopasowanie najpierw po kodzie, potem po nazwie.'), pasteBox, el('div', { class: 'row' }, load), unm),
    out, el('div', { class: 'muted small', style: 'margin-top:8px' }, info), msg, el('div', { class: 'row' }, save)));
  showUnm(); draw();
  return box;
}

// ── Historia ───────────────────────────────────────────────────────────────
function magHistoria() {
  const d = mag.data, box = el('div'), out = el('div');
  const draw = () => {
    const cols = [
      { key: 'ms', label: 'Czas', num: true, tip: 'Kiedy ruch został zapisany', val: m => m.ms, cell: m => el('span', { class: 'nw' }, m.time) },
      { key: 'type', label: 'Rodzaj', tip: 'Przyjęcie, przesunięcie, wydanie (zamówienie) albo korekta', val: m => MOVE_NAMES[m.type] || m.type, cell: m => MOVE_NAMES[m.type] || m.type },
      { key: 'prod', label: 'Produkt', tip: 'Produkt, którego dotyczy ruch', val: m => m.productName, cell: m => m.productName },
      { key: 'qty', label: 'Ilość', num: true, tip: 'Ile sztuk (przy korekcie ze znakiem + lub −)', val: m => m.qty, cell: m => nf(m.qty) },
      { key: 'from', label: 'Z', tip: 'Magazyn, z którego towar ubył', val: m => whName(m.from), cell: m => whName(m.from) || '—' },
      { key: 'to', label: 'Do', tip: 'Magazyn, do którego towar trafił', val: m => whName(m.to), cell: m => whName(m.to) || '—' },
      { key: 'order', label: 'Zamówienie', tip: 'Zamówienie, z którego pochodzi wydanie', val: m => m.orderNumber || m.orderId, cell: m => m.orderNumber || m.orderId || '—' },
      { key: 'author', label: 'Autor', tip: 'Kto zapisał ruch', val: m => m.author, cell: m => m.author || '—' },
      { key: 'note', label: 'Notatka', tip: 'Notatka wpisana przy ruchu', val: m => m.note, cell: m => m.note || '' },
    ];
    out.replaceChildren(magTable(cols, d.moves, mag.hist.sort, draw, 'Nie zapisano jeszcze żadnych ruchów.'));
  };
  box.append(el('div', { class: 'card' }, el('h2', null, 'Historia ruchów'), el('div', { class: 'muted small' }, 'Ostatnie ruchy (do 200), najnowsze pierwsze.'), out));
  draw();
  return box;
}

let root = null;
const VIEW_KEYS = new Set(MAG_VIEWS.map(v => v[0]));

export default {
  id: 'magazyny',
  title: 'Magazyny',
  routes: MAG_VIEWS.map(v => SLUGS[v[0]] || v[0]),
  mount(el, params) {
    if (!root) { root = el; el.innerHTML = TEMPLATE; }
    const v = viewOfSlug(params && params.view);
    if (!VIEW_KEYS.has(v)) { go('/magazyny/' + (SLUGS[mag.view] || mag.view), { replace: true }); return; } // brak/nieznany podwidok → ostatni
    mag.view = v;
    if (!mag.data && !mag.loading) magLoad(); else magRender();
  },
  unmount() { /* stan i DOM zostają — kontener jest tylko ukrywany */ },
};
