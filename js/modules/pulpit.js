// Pulpit: sprzedaż z 30 dni (wykres wartość / ilość), liczniki z trendem, „Do zrobienia” (otwarte statusy),
// najnowsze zamówienia, ostatnie zmiany i szybkie skróty. Dane: jedna akcja dashboard:get (tylko odczyt).
import { el, loadingBox, money, isUnavailable, syncedLabel, store } from '../core/ui.js?v=1a6db82';
import { api } from '../core/client.js?v=1a6db82';

const MODE_KEY = 'osa-pulpit-mode';
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

let root = null, seq = 0, mode = 'value';

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
  const big = n => [el('span', { class: 'pl-big' }, n.toLocaleString('pl-PL'))];
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
  const max = niceMax(Math.max(...vals, 0));
  const fmt = m === 'value' ? zl0 : v => String(Math.round(v));
  const s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'pl-svg', role: 'img', 'aria-label': 'Wykres sprzedaży z ostatnich 30 dni' });
  for (let i = 0; i <= 4; i++) {
    const y = T + ih - ih * i / 4;
    s.append(svg('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'pl-grid' }), svg('text', { x: L - 6, y: y + 4, class: 'pl-axis', 'text-anchor': 'end' }, fmt(max * i / 4)));
  }
  const bw = iw / d.days.length;
  const tip = document.createElement('div');
  tip.className = 'pl-tip'; tip.hidden = true;
  const wrap = el('div', { class: 'pl-chart-wrap' }, s, tip);
  d.days.forEach((x, i) => {
    const v = vals[i], h = max ? ih * v / max : 0, bx = L + i * bw;
    const g = svg('g', { class: 'pl-barg', 'data-date': x.date });
    g.append(svg('rect', { x: bx, y: T, width: bw, height: ih, class: 'pl-hit' }),
      svg('rect', { x: bx + bw * 0.16, y: T + ih - h, width: bw * 0.68, height: Math.max(h, v > 0 ? 1.5 : 0), rx: 2, class: 'pl-bar' + (x.date === d.today ? ' today' : '') + (v ? '' : ' zero') }));
    const show = () => {
      tip.replaceChildren(el('strong', null, dayLabel(x.date)), el('div', null, x.count + ' ' + (x.count === 1 ? 'zamówienie' : 'zamówień')), el('div', null, 'wartość: ' + zl(x.value)));
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
  const draw = () => { body.replaceChildren(chart(d, mode)); };
  const segs = el('div', { class: 'pl-segs', role: 'group', 'aria-label': 'Co pokazać na wykresie' });
  const seg = (m, label, tip) => el('button', { type: 'button', class: 'pl-seg', 'data-mode': m, 'aria-pressed': String(mode === m), title: tip,
    onclick: () => { mode = m; store(MODE_KEY, m); for (const b of segs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m)); draw(); } }, label);
  segs.append(seg('value', 'Wartości zamówień', 'Słupki = suma wartości zamówień danego dnia (pozycje + dostawa, brutto, bez anulowanych)'),
    seg('count', 'Ilość zamówień', 'Słupki = liczba zamówień złożonych danego dnia (bez anulowanych)'));
  draw();
  return el('section', { class: 'card pl-card pl-chart' },
    el('div', { class: 'pl-head' }, el('h2', null, 'Sprzedaż — ostatnie 30 dni'), segs,
      el('a', { class: 'pl-more', href: '#/raporty', title: 'Raporty sprzedaży (na razie w panelu Selly)' }, 'Raporty sprzedaży ›')), body);
}

// ─── Listy ──────────────────────────────────────────────────────────────────

function todoCard(d) {
  const rows = d.byStatus.length ? d.byStatus.map(s => el('a', { class: 'pl-row pl-todo', href: '#/zamowienia?status=' + encodeURIComponent(s.statusId), 'data-status': s.statusId,
    title: 'Pokaż zamówienia w statusie „' + s.name + '” (' + s.count + ' z ostatnich 60 dni)' }, el('span', null, s.name), el('span', { class: 'pl-count' }, String(s.count))))
    : [el('div', { class: 'muted pl-none' }, 'Brak otwartych zamówień z ostatnich 60 dni.')];
  return el('section', { class: 'card pl-card', id: 'plTodo' }, el('div', { class: 'pl-head' }, el('h2', { class: 'tip', title: 'Zamówienia z ostatnich 60 dni w statusach, które jeszcze nie są zamknięte (poza wysłanymi, zrealizowanymi, anulowanymi i zwrotami).' }, 'Do zrobienia')), ...rows);
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
    el('div', { class: 'pl-top' }, el('span', { class: 'muted tip', title: 'Dane z ostatniej synchronizacji z Selly (co kilka minut)' }, 'Dane z synchronizacji: ' + syncedLabel(d.syncedMs))),
    tiles(d), chartCard(d),
    el('div', { class: 'pl-cols' }, el('div', null, todoCard(d), eventsCard(d)), latestCard(d)),
    quick());
}

function load() {
  const my = ++seq;
  root.replaceChildren(loadingBox('Wczytywanie pulpitu…'));
  api('dashboard:get').then(d => { if (my === seq && root) render(d); }).catch(err => {
    if (my !== seq || !root) return;
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
    load();
  },
  unmount() { seq++; root = null; },
};
