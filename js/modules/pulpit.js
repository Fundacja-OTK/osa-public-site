// Pulpit: sprzedaż z 30 dni (wykres wartość / ilość), liczniki z trendem, „Do zrobienia” (otwarte statusy),
// najnowsze zamówienia, ostatnie zmiany i szybkie skróty. Dane: jedna akcja dashboard:get (tylko odczyt).
import { el, loadingBox, money, isUnavailable, syncedLabel, store } from '../core/ui.js?v=ad8c30d';
import { api } from '../core/client.js?v=ad8c30d';
import { liveRefresh } from '../core/liveRefresh.js?v=ad8c30d';
import { costShown, costValue, costDefs, costBar, costTip, costLegend } from './chartCost.js?v=ad8c30d';

const MODE_KEY = 'osa-pulpit-mode';
const TODO_KEY = 'osa-pulpit-todo';
const TODO_DEF = { unpaidDays: 3, lowStock: 5 };
const zl = v => money(v) + ' zł';
const zl0 = v => Math.round(Number(v) || 0).toLocaleString('pl-PL') + ' zł';
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, ...kids) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c);
  return n;
};
const orderHref = id => '#/zamowienia/' + encodeURIComponent(id);
const ddmm = d => d.slice(8, 10) + '.' + d.slice(5, 7);
const PL_DAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const dayLabel = d => PL_DAYS[new Date(d + 'T12:00:00Z').getUTCDay()] + ' ' + ddmm(d) + '.' + d.slice(0, 4);

const QUICK = [
  ['zamowienia', 'Zamówienia', 'Lista zamówień z filtrami i zmianą statusu'],
  ['produkty', 'Produkty', 'Katalog produktów i stany'],
  ['klienci', 'Klienci', 'Lista klientów i notatki orszaków'],
  ['magazyny', 'Magazyny', 'Stany magazynowe i wysyłka SpeedMail'],
  ['przesylki', 'Przesyłki', 'Kolejka do nadania i etykiety'],
  ['licencje', 'Raport licencji', 'Licencje na orszaki'],
];

let root = null, seq = 0, mode = 'value', live = null, touchedAt = 0;
const touchHosts = new WeakSet();

/** Progi „Dziś do zrobienia” zapamiętane w przeglądarce (z domyślnymi i w dozwolonych granicach). */
export function todoSettings() {
  const v = store(TODO_KEY) || {};
  const n = (x, lo, hi, d) => { const k = Math.floor(Number(x)); return Number.isFinite(k) ? Math.min(hi, Math.max(lo, k)) : d; };
  return { unpaidDays: n(v.unpaidDays, 1, 30, TODO_DEF.unpaidDays), lowStock: n(v.lowStock, 1, 1000, TODO_DEF.lowStock) };
}
const shiftDay = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

function trend(cur, prev, what) {
  if (!prev) return el('span', { class: 'pl-trend flat tip', title: 'Brak zamówień w poprzednich 30 dniach — nie ma z czym porównać.' }, 'brak porównania');
  const pct = Math.round((cur - prev) / prev * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return el('span', { class: 'pl-trend tip ' + cls, title: 'Zmiana względem poprzednich 30 dni (' + what + ': ' + prev + ' → ' + cur + ').' },
    (pct > 0 ? '▲ +' : pct < 0 ? '▼ ' : '● ') + pct + '% vs poprzednie 30 dni');
}

function tile(id, label, main, sub, tip, href) {
  const body = [el('div', { class: 'pl-tile-label tip', title: tip }, label), el('div', { class: 'pl-tile-main' }, ...main), sub ? el('div', { class: 'pl-tile-sub' }, sub) : null];
  return href ? el('a', { class: 'pl-tile', id, href }, ...body) : el('div', { class: 'pl-tile', id }, ...body);
}

function tiles(d) {
  const k = d.kpi;
  const pairs = n => [el('span', { class: 'pl-big' }, String(n)), el('span', { class: 'pl-unit' }, n === 1 ? 'zamówienie' : 'zamówień')];
  const big = n => [el('span', { class: 'pl-big' }, n == null ? '—' : n.toLocaleString('pl-PL'))];
  return el('div', { class: 'pl-tiles' },
    tile('plToday', 'Dziś', pairs(k.ordersToday), 'wartość: ' + zl(k.valueToday), 'Zamówienia złożone dziś (czas sklepu), bez anulowanych. Wartość = pozycje + dostawa, brutto.'),
    tile('plWeek', 'Ostatnie 7 dni', pairs(k.orders7), 'wartość: ' + zl(k.value7), 'Zamówienia z ostatnich 7 dni łącznie z dzisiejszym, bez anulowanych. Wartość = pozycje + dostawa, brutto.'),
    tile('plMonth', 'Ostatnie 30 dni', pairs(k.orders30), el('div', null, el('div', null, 'wartość: ' + zl(k.value30)), trend(k.orders30, k.prevOrders30, 'zamówienia')),
      'Zamówienia z ostatnich 30 dni łącznie z dzisiejszym, bez anulowanych. Trend porównuje z 30 dniami wcześniej.'),
    tile('plTotal', 'Wszystkie zamówienia', big(k.totalOrders), 'w całej historii sklepu', 'Liczba wszystkich zamówień zapisanych w panelu (w każdym statusie), z ostatniej synchronizacji z Selly.', '#/zamowienia'),
    tile('plClients', 'Klienci', big(k.totalClients), 'konta i dane z zamówień', 'Liczba klientów zapisanych w panelu (z ostatniej synchronizacji z Selly).', '#/klienci'),
    tile('plProducts', 'Dostępne produkty', big(k.availableProducts),
      k.lowStock ? el('span', { class: 'pl-warn' }, k.lowStock + ' bez stanu') : 'wszystkie ze stanem',
      'Produkty widoczne w sklepie. „Bez stanu” = widoczne, ale ze stanem 0 lub mniejszym (łącznie w magazynach wg Selly).', '#/produkty'));
}

// ─── Wykres słupkowy (SVG) ──────────────────────────────────────────────────

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function chart(d, m) {
  const W = 720, H = 250, L = 56, R = 8, T = 10, B = 28, iw = W - L - R, ih = H - T - B;
  const vals = d.days.map(x => (m === 'value' ? x.value : x.count));
  const withCost = m === 'value' && costShown() && d.days.some(x => x.cost);   // koszt zakupu w słupku wartości (chartCost.js)
  const max = niceMax(Math.max(...vals, ...(withCost ? d.days.map(x => costValue(x.cost)) : []), 0));
  const fmt = m === 'value' ? zl0 : v => String(Math.round(v));
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'pl-svg', role: 'img', 'aria-label': 'Wykres sprzedaży z ostatnich 30 dni' });
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - ih * i / 4;
    s.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'pl-grid' }), svg('text', { x: L - 6, y: y + 4, class: 'pl-axis', 'text-anchor': 'end' }, fmt(max * i / 4)));
  }
  const bw = iw / d.days.length;
  const tip = document.createElement('div');
  tip.className = 'pl-tip'; tip.hidden = true;
  const wrap = el('div', { class: 'pl-chart-wrap' }, s, tip), hatch = withCost ? costDefs(svg) : null;
  if (hatch) s.append(hatch.defs);
  d.days.forEach((x, i) => {
    const v = vals[i], h = max ? ih * v / max : 0, bx = L + i * bw;
    const g = svg('g', { class: 'pl-barg', 'data-date': x.date });
    g.append(svg('rect', { x: bx, y: T, width: bw, height: ih, class: 'pl-hit' }),
      svg('rect', { x: bx + bw * 0.16, y: T + ih - h, width: bw * 0.68, height: Math.max(h, v > 0 ? 1.5 : 0), rx: 2, class: 'pl-bar' + (x.date === d.today ? ' today' : '') + (v ? '' : ' zero') }),
      withCost ? costBar(svg, { x: bx + bw * 0.16, w: bw * 0.68, base: T + ih, k: max ? ih / max : 0, barH: h, top: T, cost: x.cost, hatch: hatch.fill }) : null);
    const show = () => {
      tip.replaceChildren(el('strong', null, dayLabel(x.date)), el('div', null, x.count + ' ' + (x.count === 1 ? 'zamówienie' : 'zamówień')), el('div', null, 'wartość: ' + zl(x.value) + ' brutto'),
        ...(withCost ? costTip(x.cost, { value: x.value, withShipping: true }) : []));
      tip.hidden = false;
      tip.style.left = Math.min(Math.max((bx + bw / 2) / W * 100, 12), 88) + '%';
    };
    g.addEventListener('mouseenter', show);
    g.addEventListener('mouseleave', () => { tip.hidden = true; });
    s.append(g);
    if (i % 5 === 0 || i === d.days.length - 1) s.append(svg('text', { x: bx + bw / 2, y: H - 8, class: 'pl-axis', 'text-anchor': i === 0 ? 'start' : i === d.days.length - 1 ? 'end' : 'middle' }, ddmm(x.date)));
  });
  return wrap;
}

function chartCard(d) {
  const body = el('div', { id: 'plChartBody' });
  const legend = el('div', { class: 'pl-legend' });
  const draw = () => { body.replaceChildren(chart(d, mode)); legend.replaceChildren(...[mode === 'value' ? costLegend(d.days.map(x => x.cost), draw, 'plCostLegend') : null].filter(Boolean)); legend.hidden = !legend.childElementCount; };
  const segs = el('div', { class: 'pl-segs', role: 'group', 'aria-label': 'Co pokazać na wykresie' });
  const seg = (m, label, tip) => el('button', { type: 'button', class: 'pl-seg', 'data-mode': m, 'aria-pressed': String(mode === m), title: tip,
    onclick: () => { mode = m; store(MODE_KEY, m); for (const b of segs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m)); draw(); } }, label);
  segs.append(seg('value', 'Wartości zamówień', 'Słupki = suma wartości zamówień danego dnia (pozycje + dostawa, brutto, bez anulowanych)'),
    seg('count', 'Ilość zamówień', 'Słupki = liczba zamówień złożonych danego dnia (bez anulowanych)'));
  draw();
  return el('section', { class: 'card pl-card pl-chart' },
    el('div', { class: 'pl-head' }, el('h2', null, 'Sprzedaż — ostatnie 30 dni'), segs,
      el('a', { class: 'pl-more', href: '#/raporty', title: 'Raporty sprzedaży: sprzedaż w czasie, produkty, klienci, regiony' }, 'Raporty sprzedaży ›')), legend, body);
}

// ─── Listy ──────────────────────────────────────────────────────────────────

function todoCard(d) {
  const rows = d.byStatus.length ? d.byStatus.map(s => el('a', { class: 'pl-row pl-todo', href: '#/zamowienia?status=' + encodeURIComponent(s.statusId), 'data-status': s.statusId,
    title: 'Pokaż zamówienia w statusie „' + s.name + '” (' + s.count + ' z ostatnich 60 dni)' }, el('span', null, s.name), el('span', { class: 'pl-count' }, String(s.count))))
    : [el('div', { class: 'muted pl-none' }, 'Brak otwartych zamówień z ostatnich 60 dni.')];
  return el('section', { class: 'card pl-card', id: 'plTodo' }, el('div', { class: 'pl-head' }, el('h2', { class: 'tip', title: 'Zamówienia z ostatnich 60 dni w statusach, które jeszcze nie są zamknięte (poza wysłanymi, zrealizowanymi, anulowanymi i zwrotami).' }, 'Otwarte zamówienia wg statusu')), ...rows);
}

// ─── Dziś do zrobienia ─────────────────────────────────────────────────────

/** Opis pozycji: tekst, podpowiedź (co dokładnie liczy liczba) i adres listy z zastosowanym filtrem. */
export function todoItem(it, d) {
  const st = encodeURIComponent(it.statusId || '');
  const t = d.todo || {};
  switch (it.key) {
    case 'new': return { text: 'Nowe zamówienia do obsługi (' + it.name + ')', href: '#/zamowienia?status=' + st,
      tip: 'Zamówienia w statusie „' + it.name + '” z ostatnich 60 dni. Kliknij, by zobaczyć listę przefiltrowaną do tego statusu.' };
    case 'paid': return { text: 'Opłacone, jeszcze nieprzetworzone (' + it.name + ')', href: '#/zamowienia?status=' + st,
      tip: 'Zamówienia w statusie „' + it.name + '” z ostatnich 60 dni — klient zapłacił, a zamówienie nie poszło dalej (np. do wysyłki).' };
    case 'unpaid': return { text: 'Nieopłacone od ponad ' + t.unpaidDays + ' ' + (t.unpaidDays === 1 ? 'dnia' : 'dni') + ' (' + it.name + ')',
      href: '#/zamowienia?status=' + st + '&from=' + shiftDay(d.today, -59) + '&to=' + shiftDay(it.olderThan, -1),
      tip: 'Zamówienia w statusie „' + it.name + '” złożone przed ' + it.olderThan + ' (starsze niż ' + t.unpaidDays + ' dni), ale nie wcześniej niż 60 dni temu. Próg zmienisz w „Ustawieniach” poniżej.' };
    case 'speedmail': return { text: 'Czekają na wysyłkę SpeedMail (' + it.name + ')', href: '#/magazyny/speedmail',
      tip: 'Zamówienia w statusie „' + it.name + '” z ostatnich 60 dni. Kliknij, by przejść do wysyłki SpeedMail.' };
    case 'zero': return { text: 'Produkty bez stanu', href: '#/produkty?seg=zero&vis=on',
      tip: 'Produkty widoczne w sklepie, których stan w Selly (łącznie) wynosi 0 lub mniej.' };
    case 'low': return { text: 'Produkty z niskim stanem (1–' + it.level + ' szt.)', href: '#/produkty?seg=low&low=' + it.level + '&vis=on',
      tip: 'Produkty widoczne w sklepie, których stan w Selly (łącznie) jest większy od 0 i nie większy niż ' + it.level + ' szt. Próg zmienisz w „Ustawieniach” poniżej.' };
    default: return null;
  }
}

function todayCard(d) {
  const items = ((d.todo && d.todo.items) || []).map(it => ({ it, v: todoItem(it, d) })).filter(x => x.v);
  const cfg = todoSettings();
  const num = (id, label, tip, key, lo, hi) => el('label', { class: 'pl-set tip', title: tip }, label,
    el('input', { type: 'number', id, min: String(lo), max: String(hi), value: String(cfg[key]), inputmode: 'numeric',
      onchange: ev => { store(TODO_KEY, { ...todoSettings(), [key]: ev.target.value }); load(); } }));
  const opts = el('details', { class: 'fold pl-opts', id: 'plTodoOpts' }, el('summary', { title: 'Progi, od których pozycje pojawiają się na liście (zapamiętane w tej przeglądarce)' }, 'Ustawienia'),
    el('div', { class: 'pl-sets' },
      num('plSetUnpaid', 'Nieopłacone od ponad (dni)', 'Zamówienia nieopłacone dłużej niż tyle dni trafiają na listę. Domyślnie ' + TODO_DEF.unpaidDays + '.', 'unpaidDays', 1, 30),
      num('plSetLow', 'Niski stan do (szt.)', 'Produkty ze stanem od 1 do tylu sztuk trafiają na listę niskich stanów. Domyślnie ' + TODO_DEF.lowStock + '.', 'lowStock', 1, 1000)));
  const rows = items.length ? items.map(({ it, v }) => el('a', { class: 'pl-row pl-act', href: v.href, 'data-key': it.key, title: v.tip },
    el('span', null, v.text), el('span', { class: 'pl-count' }, it.count.toLocaleString('pl-PL')), el('span', { class: 'pl-chev', 'aria-hidden': 'true' }, '›')))
    : [el('div', { class: 'muted pl-none', id: 'plTodayNone' }, 'Nic pilnego — nic nie czeka na Twoją reakcję. ✓')];
  return el('section', { class: 'card pl-card', id: 'plToday2' },
    el('div', { class: 'pl-head' }, el('h2', { class: 'tip', title: 'Rzeczy, które warto zrobić dziś. Liczby pochodzą z ostatniej synchronizacji z Selly; pozycje z zerem są ukryte. Kliknij pozycję, by otworzyć listę z już ustawionym filtrem.' }, 'Dziś do zrobienia')),
    ...rows, opts);
}

function latestCard(d) {
  const rows = d.latest.length ? d.latest.map(o => el('a', { class: 'pl-row pl-order', href: orderHref(o.id), 'data-id': o.id, title: 'Otwórz zamówienie ' + o.number + ' (' + o.date.slice(0, 16) + ')' },
    el('span', { class: 'pl-onum' }, o.number), el('span', { class: 'pl-oval' }, zl(o.value)), el('span', { class: 'pl-ost' }, o.statusName), el('span', { class: 'pl-chev', 'aria-hidden': 'true' }, '›')))
    : [el('div', { class: 'muted pl-none' }, 'Brak zamówień.')];
  return el('section', { class: 'card pl-card', id: 'plLatest' }, el('div', { class: 'pl-head' }, el('h2', null, 'Najnowsze zamówienia'), el('a', { class: 'pl-more', href: '#/zamowienia', title: 'Cała lista zamówień' }, 'Wszystkie ›')), ...rows);
}

function eventsCard(d) {
  const when = m => m.slice(8, 10) + '.' + m.slice(5, 7) + ' ' + m.slice(11, 16);
  const rows = d.events.length ? d.events.map(e => el('a', { class: 'pl-ev', href: orderHref(e.id), title: 'Ostatnia zmiana zamówienia ' + e.number + ': ' + e.modified, 'data-id': e.id },
    el('span', { class: 'pl-evt' }, when(e.modified)), el('span', { class: 'pl-evn' }, e.number), el('span', { class: 'pl-evs' }, e.statusName)))
    : [el('div', { class: 'muted pl-none' }, 'Brak zmian.')];
  return el('section', { class: 'card pl-card', id: 'plEvents' }, el('div', { class: 'pl-head' }, el('h2', { class: 'tip', title: 'Zamówienia ostatnio zmienione w Selly (nowe, zmiana statusu lub danych) — pokazujemy aktualny status zamówienia, nie historię zdarzeń.' }, 'Ostatnie zmiany')), el('div', { class: 'pl-timeline' }, ...rows));
}

function quick() {
  return el('div', { class: 'pl-quick' }, ...QUICK.map(([id, t, tip]) => el('a', { class: 'pl-q', href: '#/' + id, title: tip }, t)));
}

// ─── Moduł ──────────────────────────────────────────────────────────────────

function render(d) {
  root.replaceChildren(
    el('div', { class: 'pl-top' }, live ? live.node : el('span', { class: 'muted tip', title: 'Dane z ostatniej synchronizacji z Selly' }, 'Dane z synchronizacji: ' + syncedLabel(d.syncedMs))),
    todayCard(d), tiles(d), chartCard(d),
    el('div', { class: 'pl-cols' }, el('div', null, todoCard(d), eventsCard(d)), latestCard(d)),
    quick());
}

/** kind: { background | manual } — odświeżenie bez ekranu wczytywania i z zachowaniem przewinięcia (core/liveRefresh.js). */
function load(kind = {}) {
  const my = ++seq, quiet = !!(kind.background || kind.manual);
  if (!quiet) root.replaceChildren(loadingBox('Wczytywanie pulpitu…'));
  return api('dashboard:get', todoSettings()).then(d => {
    if (my !== seq || !root) return;
    if (live) live.loaded(d.stamp);
    const y = window.scrollY;
    render(d);
    if (quiet && Math.abs(window.scrollY - y) > 1) window.scrollTo(window.scrollX, y);
  }).catch(err => {
    if (my !== seq || !root || quiet) return;   // w tle: zostaje poprzedni widok
    root.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty error', id: 'plError' },
      isUnavailable(err) ? 'Pulpit potrzebuje backendu Cloudflare — ten serwer go nie obsługuje.' : 'Nie udało się wczytać pulpitu: ' + err.message,
      el('div', null, el('button', { type: 'button', class: 'secondary', onclick: load }, 'Spróbuj ponownie')))));
  });
}

export default {
  id: 'pulpit',
  title: 'Pulpit',
  routes: [],
  mount(el0) {
    root = el0;
    mode = store(MODE_KEY) === 'count' ? 'count' : 'value';
    // Świeżość: znacznik wersji zamówień co 30 s (pulpit w tle najwyżej co 2 min — kilka zapytań agregujących), powrót do karty, „Odśwież”
    if (!live) live = liveRefresh({ id: 'pl', reload: kind => load(kind), bgGapMs: 120000,
      busy: () => !root || Date.now() - touchedAt < 5000 || !!(document.activeElement && root.contains(document.activeElement) && document.activeElement.matches('input, select, textarea')) });
    if (!touchHosts.has(el0)) { touchHosts.add(el0); for (const t of ['pointerdown', 'keydown']) el0.addEventListener(t, () => { touchedAt = Date.now(); }, true); }
    load();
    live.start();
  },
  unmount() { seq++; root = null; if (live) live.stop(); },
};
