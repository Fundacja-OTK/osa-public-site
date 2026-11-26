// Lista kompletacyjna do druku (#/zamowienia/kompletacja?ids=1,2,3): zbiorcza lista produktów + kartki pakowania per zamówienie.
// Dane: orders:get z kopii D1 (live:false — bez zapytań do Selly) i products:list (lokalizacja magazynowa, też D1). Tylko odczyt;
// adres odbiorcy jest wyłącznie na kartce (potrzebny fizycznie), renderowany z wczytanych danych — nic nie jest zapisywane ani logowane.
import { el, loadingBox, downloadCsv, plural, dateStr, fullName } from '../core/ui.js?v=13a6ef5';
import { api } from '../core/client.js?v=13a6ef5';

const MAX_ORDERS = 100, MAX_LOOKUPS = 80, PAR = 4;
const V = { box: null, seq: 0 };

const txt = v => (v == null ? '' : String(v).trim());
const featText = v => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(featText).filter(Boolean).join(', ') : Object.values(v).map(featText).filter(Boolean).join(', ')) : String(v));
const qtyOf = p => { const n = Number(p.quantity); return isFinite(n) && n > 0 ? n : 0; };
const locKey = s => (s ? [0, s] : [1, '']);   // pusta lokalizacja na końcu
const cmpPl = (a, b) => String(a).localeCompare(String(b), 'pl', { numeric: true });

/** Czysta logika: zamówienia (JSON z Selly) + słownik { productId: { location, code } } → wiersze listy zbiorczej (lokalizacja, potem nazwa). */
export function aggregate(orders, info) {
  const m = new Map();
  for (const o of orders) for (const p of (o.products || [])) {
    const q = qtyOf(p); if (!q) continue;
    const pid = txt(p.product_id), feat = featText(p.variant_features);
    const key = (pid || txt(p.name)) + '|' + feat;
    const i = (info && info[pid]) || {};
    let r = m.get(key);
    if (!r) { r = { name: txt(p.name) + (feat ? ' (' + feat + ')' : ''), code: txt(p.producer_code || p.symbol || p.code || i.code), location: txt(i.location), qty: 0, orders: new Set() }; m.set(key, r); }
    r.qty += q; r.orders.add(txt(o.order_number || o.order_id));
  }
  return [...m.values()].map(r => ({ ...r, orders: r.orders.size })).sort((a, b) => {
    const x = locKey(a.location), y = locKey(b.location);
    return (x[0] - y[0]) || cmpPl(x[1], y[1]) || cmpPl(a.name, b.name);
  });
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function load(ids) {
  const orders = (await pool(ids, PAR, id => api('orders:get', { id, live: false, events: false }).then(r => r && r.order, () => null))).filter(Boolean);
  const pids = [...new Set(orders.flatMap(o => (o.products || []).map(p => txt(p.product_id))).filter(Boolean))].slice(0, MAX_LOOKUPS);
  const info = {};
  await pool(pids, PAR, pid => api('products:list', { q: pid, pageSize: 10 }).then(r => { const x = ((r && r.rows) || []).find(z => String(z.id) === pid); if (x) info[pid] = { location: x.location, code: x.code || x.symbol }; }, () => {}));
  return { orders, info, missing: ids.length - orders.length };
}

function slip(o, nr) {
  const ship = k => txt(o['ship_' + k]);
  const addr = [fullName(ship('first_name'), ship('last_name')), ship('company'), ship('address'), fullName(ship('postcode'), ship('city'))].filter(Boolean);
  const locker = txt(o.inpost_parcel_locker) || txt(o.poczta_polska_pickup_point);
  const notes = [['Uwagi do zamówienia', txt(o.order_attention)], ['Komentarz klienta', txt(o.client_comment)]].filter(x => x[1]);
  const prods = (o.products || []).filter(p => qtyOf(p));
  return el('section', { class: 'pk-slip', 'data-order': txt(o.order_id) },
    el('h2', null, 'Zamówienie ' + txt(o.order_number || o.order_id)),
    el('div', { class: 'pk-meta' }, el('span', null, 'Data: ' + dateStr(o.date)), el('span', null, 'Dostawa: ' + (txt(o.delivery_name) || '—')),
      locker ? el('span', { class: 'pk-locker' }, 'Punkt odbioru / paczkomat: ' + locker) : null),
    el('div', { class: 'pk-addr' }, el('strong', null, 'Odbiorca'), addr.length ? addr.map(l => el('div', null, l)) : el('div', null, 'brak danych')),
    el('table', { class: 'pk-tbl' }, el('thead', null, el('tr', null, el('th', null, '✓'), el('th', null, 'Produkt'), el('th', null, 'Kod'), el('th', { class: 'n' }, 'Ilość'))),
      el('tbody', null, prods.map(p => el('tr', null, el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Spakowano' })),
        el('td', null, txt(p.name) + (featText(p.variant_features) ? ' (' + featText(p.variant_features) + ')' : '')), el('td', null, txt(p.producer_code || p.symbol || p.code)), el('td', { class: 'n' }, String(qtyOf(p))))))),
    notes.length ? el('div', { class: 'pk-notes' }, notes.map(([k, v]) => el('div', null, el('strong', null, k + ': '), v))) : null,
    el('div', { class: 'pk-foot' }, 'Karta ' + nr));
}

function doc(d) {
  const rows = aggregate(d.orders, d.info), total = rows.reduce((s, r) => s + r.qty, 0);
  return el('div', { class: 'pk-doc', id: 'pickDoc' },
    el('section', { class: 'pk-summary' }, el('h2', null, 'Lista kompletacyjna'),
      el('p', { class: 'muted', id: 'pickInfo' }, d.orders.length + ' ' + plural(d.orders.length, 'zamówienie', 'zamówienia', 'zamówień') + ' · ' + rows.length + ' ' + plural(rows.length, 'pozycja', 'pozycje', 'pozycji') + ' · razem ' + total + ' szt.'),
      el('table', { class: 'pk-tbl', id: 'pickTable' },
        el('thead', null, el('tr', null, el('th', { title: 'Odhacz podczas zbierania' }, '✓'), el('th', { title: 'Lokalizacja magazynowa z karty produktu (puste = nie wpisana)' }, 'Lokalizacja'), el('th', null, 'Produkt'),
          el('th', { title: 'Kod producenta / symbol produktu' }, 'Kod'), el('th', { class: 'n', title: 'Suma sztuk ze wszystkich wybranych zamówień' }, 'Ilość'), el('th', { class: 'n', title: 'W ilu wybranych zamówieniach występuje produkt' }, 'Zam.'))),
        el('tbody', null, rows.map(r => el('tr', null, el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Zebrano: ' + r.name })), el('td', null, r.location), el('td', null, r.name), el('td', null, r.code),
          el('td', { class: 'n' }, String(r.qty)), el('td', { class: 'n' }, String(r.orders))))))),
    d.orders.map((o, i) => slip(o, (i + 1) + '/' + d.orders.length)));
}

/** Wywoływane przez zamowienia.js: pokazuje (on) albo chowa widok listy kompletacyjnej w kontenerze modułu. */
export function showPick(host, on, query) {
  if (!V.box && !on) return null;
  if (!V.box) { V.box = el('div', { id: 'pickRoot', class: 'pk-root' }); host.append(V.box); }
  V.box.hidden = !on;
  if (!on) { V.seq++; return V.box; }
  const ids = [...new Set(String((query && query.get && query.get('ids')) || '').split(',').map(s => s.trim()).filter(s => /^\d{1,12}$/.test(s)))].slice(0, MAX_ORDERS);
  const my = ++V.seq;
  const back = el('a', { href: '#/zamowienia', class: 'btn-link', id: 'pickBack' }, '← Wróć do zamówień');
  if (!ids.length) { V.box.replaceChildren(el('div', { class: 'card' }, el('p', null, 'Nie wybrano zamówień. Zaznacz zamówienia na liście i wybierz „Lista kompletacyjna”.'), back)); return V.box; }
  V.box.replaceChildren(el('div', { class: 'card' }, loadingBox('Wczytuję ' + ids.length + ' ' + plural(ids.length, 'zamówienie', 'zamówienia', 'zamówień') + '…')));
  load(ids).then(d => {
    if (my !== V.seq) return;
    if (!d.orders.length) { V.box.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'notice error', role: 'alert' }, 'Nie udało się wczytać zamówień (jeszcze niezsynchronizowane?).'), back)); return; }
    const rows = aggregate(d.orders, d.info);
    const csv = () => downloadCsv([['Lokalizacja', 'Produkt', 'Kod', 'Ilość', 'Zamówień']].concat(rows.map(r => [r.location, r.name, r.code, r.qty, r.orders])), 'lista-kompletacyjna');
    V.box.replaceChildren(el('div', { class: 'card pk-bar' }, back,
      el('button', { type: 'button', class: 'primary', id: 'pickPrintBtn', title: 'Drukuje listę zbiorczą i kartki pakowania (każde zamówienie na osobnej stronie A4)', onclick: () => print(doc(d)) }, 'Drukuj'),
      el('button', { type: 'button', class: 'secondary', id: 'pickCsv', title: 'Pobiera listę zbiorczą (bez kartek pakowania i adresów) jako CSV', onclick: csv }, 'Pobierz CSV'),
      d.missing ? el('span', { class: 'notice warn' }, 'Pominięto niewczytane zamówienia: ' + d.missing) : null),
      el('div', { class: 'card pk-screen' }, doc(d)));
  });
  return V.box;
}

// Wydruk w tej samej karcie: kopia dokumentu w <body>, reszta ukryta przez css/faktury.css (body.pk-printing)
function print(content) {
  const host = el('div', { id: 'pickPrint' }, content);
  document.body.append(host);
  document.body.classList.add('pk-printing');
  const done = () => { document.body.classList.remove('pk-printing'); host.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  try { window.print(); } finally { setTimeout(() => { if (document.body.classList.contains('pk-printing') && !matchMedia('print').matches) done(); }, 1000); }
}
