// Kreator „Wysyłka SpeedMail” — czysta logika (bez DOM; testy: tests/unit/speedmail.test.js).
// Sklep liczy SZTUKI, SpeedMail (SM) KOMPLETY: packs[productId].size = sztuk w komplecie (brak wpisu = 1).

/** Nazwa bez polskich znaków, małymi literami (dopasowanie statusów i magazynów po nazwie). */
export const plain = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Przelicznik produktu: { size ≥ 1, smName, pos }. */
export function packOf(packs, pid) {
  const p = (packs || {})[pid];
  return { size: p && p.size >= 1 ? p.size : 1, smName: (p && p.smName) || '', pos: (p && Number(p.pos)) || 0 };
}

/**
 * Domyślne ustawienia z nazw statusów i magazynów Selly (gdy użytkownik nic nie wybrał):
 *   st  — „Złożone SpeedMail” (zamówienia przekazywane do SM),  acc — „Przyjęte SpeedMail” (SM przyjął),
 *   otk — „Złożone OTK” (realizacja na miejscu),  open — statusy kandydatów (nowe / złożone / opłacone, bez statusów SM i OTK),
 *   wh  — magazyn z „speed” w nazwie.
 */
export function defaultSettings(statuses, warehouses) {
  const st = statuses || [], ws = warehouses || [];
  const find = test => { const s = st.find(x => test(plain(x.name))); return s ? String(s.id) : ''; };
  const sm = find(n => n.includes('speed') && n.includes('zloz'));
  const acc = find(n => n.includes('speed') && n.includes('przyj'));
  const otk = find(n => n.includes('otk') && n.includes('zloz'));
  const special = new Set([sm, acc, otk].filter(Boolean));
  const open = st.filter(x => !special.has(String(x.id)) && /^(nowe|nowe zamowienie|zlozone|oplacone|zaplacone)$/.test(plain(x.name))).map(x => String(x.id));
  const w = ws.find(x => plain(x.name).includes('speed'));
  return { st: sm, acc, otk, open, wh: w ? String(w.id) : '' };
}

/** Zapotrzebowanie zamówienia: { productId: sztuk } (+ nazwy). Pozycje już wydane (settled) pomijane. */
export function needOf(order) {
  const need = {}, names = {};
  for (const it of order.items || []) {
    if (it.settled) continue;
    need[it.productId] = (need[it.productId] || 0) + (Number(it.qty) || 0);
    names[it.productId] = it.name;
  }
  return { need, names };
}

/** Stan SM w sztukach: { productId: max(0, fizycznie w magazynie wh) }. */
export function stockOf(products, wh) {
  const out = {};
  for (const p of products || []) out[p.id] = Math.max(0, (p.phys && p.phys[wh]) || 0);
  return out;
}

/**
 * Krok 1 — kandydaci. reserved = towar zarezerwowany przez zamówienia już w „Złożone SpeedMail” (niewydane pozycje);
 * avail = stan − reserved. Dla każdego kandydata: fits (sam mieści się w avail), missing (czego brakuje).
 * Zamówienia bez pozycji (np. same usługi) pomijane. Najstarsze pierwsze.
 */
export function checkCandidates(candidates, smOrders, stock) {
  const reserved = {};
  for (const o of smOrders || []) { const { need } = needOf(o); for (const pid in need) reserved[pid] = (reserved[pid] || 0) + need[pid]; }
  const avail = {};
  for (const pid of new Set(Object.keys(stock || {}).concat(Object.keys(reserved)))) avail[pid] = (stock[pid] || 0) - (reserved[pid] || 0);
  const rows = (candidates || []).slice().sort(byDate).map(o => {
    const { need, names } = needOf(o);
    const missing = Object.keys(need).filter(pid => need[pid] > Math.max(0, avail[pid] || 0))
      .map(pid => ({ pid, name: names[pid], lack: need[pid] - Math.max(0, avail[pid] || 0) }));
    return { o, need, names, fits: !missing.length && Object.keys(need).length > 0, missing };
  }).filter(r => Object.keys(r.need).length);
  return { rows, reserved, avail };
}

/** „Zaznacz wszystkie, które SM zrealizuje”: najstarsze pierwsze, dopóki ŁĄCZNIE mieszczą się w dostępnym stanie. → [orderId]. */
export function autoPick(rows, avail) {
  const rem = Object.assign({}, avail), out = [];
  for (const r of rows) {
    if (!Object.keys(r.need).every(pid => r.need[pid] <= Math.max(0, rem[pid] || 0))) continue;
    for (const pid in r.need) rem[pid] = (rem[pid] || 0) - r.need[pid];
    out.push(r.o.orderId);
  }
  return out;
}

/** Suma zapotrzebowania wybranych wierszy i produkty, których zabraknie: { use, over: [pid] }. */
export function selectionUse(rows, selected, avail) {
  const use = {};
  for (const r of rows) if (selected.has(r.o.orderId)) for (const pid in r.need) use[pid] = (use[pid] || 0) + r.need[pid];
  return { use, over: Object.keys(use).filter(pid => use[pid] > Math.max(0, avail[pid] || 0)) };
}

/**
 * Krok 2 — podział zamówień „Złożone SpeedMail”: najstarsze pierwsze; do SM trafia zamówienie, którego WSZYSTKIE niewydane pozycje
 * mieszczą się w pozostałym stanie SM. forced: Map(orderId → 'sm' | 'otk') — ręczne przeniesienia.
 */
export function splitOrders(orders, stock, forced) {
  const rem = Object.assign({}, stock), rows = [];
  for (const o of (orders || []).slice().sort(byDate)) {
    const { need, names } = needOf(o);
    if (!Object.keys(need).length) continue;
    const miss = Object.keys(need).filter(pid => need[pid] > (rem[pid] || 0));
    if (!miss.length) for (const pid in need) rem[pid] -= need[pid];
    const auto = miss.length ? 'otk' : 'sm', group = (forced && forced.get(o.orderId)) || auto;
    rows.push({ o, need, names, auto, group, forced: group !== auto, missing: miss.map(pid => ({ pid, name: names[pid], lack: need[pid] - (rem[pid] || 0) })) });
  }
  const send = rows.filter(r => r.group === 'sm'), local = rows.filter(r => r.group === 'otk');
  const use = {}; for (const r of send) for (const pid in r.need) use[pid] = (use[pid] || 0) + r.need[pid];
  for (const r of send) r.over = Object.keys(r.need).filter(pid => use[pid] > (stock[pid] || 0));
  return { rows, send, local, use };
}

/** Produkty wysyłki w kolejności kolumn pliku: najpierw z ustaloną kolejnością (pos rosnąco), potem reszta alfabetycznie. */
export function fileProducts(send, packs) {
  const seen = new Map();
  for (const r of send) for (const pid in r.need) if (!seen.has(pid)) seen.set(pid, { id: pid, name: r.names[pid] || pid });
  return [...seen.values()].sort((a, b) => {
    const pa = packOf(packs, a.id).pos, pb = packOf(packs, b.id).pos;
    if (pa && pb && pa !== pb) return pa - pb;
    if (!!pa !== !!pb) return pa ? -1 : 1;
    return a.name.localeCompare(b.name, 'pl');
  });
}

/**
 * Tabela pliku dla SM (format downloadXlsx). opts: { rows: 'orders' | 'total', orderNo, date, ref, total } — co ma być w pliku.
 * Wartości w KOMPLETACH (sztuki ÷ sztuk w komplecie). Nagłówek kolumny produktu = nazwa w pliku dla SM albo nazwa ze sklepu.
 */
export function fileTable(send, packs, opts, refNo) {
  const o = Object.assign({ rows: 'orders', orderNo: true, date: true, ref: false, total: true }, opts || {});
  const prods = fileProducts(send, packs);
  const kits = (pid, q) => q / packOf(packs, pid).size;
  const lead = [];
  if (o.ref) lead.push({ header: 'Nr referencyjny', type: 'text' });
  if (o.rows === 'orders' && o.orderNo) lead.push({ header: 'Nr zamówienia', type: 'text' });
  if (o.rows === 'orders' && o.date) lead.push({ header: 'Data', type: 'text' });
  const cols = lead.concat(prods.map(p => ({ header: packOf(packs, p.id).smName || p.name, type: 'number' })));
  const leadCells = (num, date) => {
    const c = [];
    if (o.ref) c.push(refNo || '');
    if (o.rows === 'orders' && o.orderNo) c.push(num);
    if (o.rows === 'orders' && o.date) c.push(date);
    return c;
  };
  const sum = {}; for (const r of send) for (const pid in r.need) sum[pid] = (sum[pid] || 0) + r.need[pid];
  const rows = [];
  if (o.rows === 'orders') {
    for (const r of send) rows.push(leadCells(r.o.orderNumber, String(r.o.date || '').slice(0, 10)).concat(prods.map(p => (r.need[p.id] ? kits(p.id, r.need[p.id]) : null))));
    if (o.total) {
      // Wiersz „Razem”: etykieta w kolumnie numeru zamówienia (albo w pierwszej kolumnie); bez kolumn opisowych — same sumy
      const c = lead.map(() => '');
      if (c.length) c[o.ref && c.length > 1 ? 1 : 0] = 'Razem';
      rows.push(c.concat(prods.map(p => kits(p.id, sum[p.id] || 0))));
    }
  } else {
    rows.push(leadCells('', '').concat(prods.map(p => kits(p.id, sum[p.id] || 0))));
  }
  return { file: 'wysylka-speedmail' + (refNo ? '-' + String(refNo).replace(/[^\w-]+/g, '_') : ''), sheet: 'Wysyłka SM', columns: cols, rows };
}

/** Następny numer referencyjny na dziś: SM-RRRRMMDD-n (n = 1 + liczba wysyłek z tym przedrostkiem). */
export function nextRef(shipments, isoDay) {
  const pre = 'SM-' + String(isoDay).replace(/-/g, '') + '-';
  let n = 0;
  for (const s of shipments || []) if (String(s.ref).startsWith(pre)) n = Math.max(n, Number(String(s.ref).slice(pre.length)) || 0);
  return pre + (n + 1);
}

/** Zamówienia w „Złożone SpeedMail” z wydaniem już zapisanym (wszystkie pozycje settled) — status w Selly nie został zmieniony. */
export const stuckOrders = smOrders => (smOrders || []).filter(o => (o.items || []).length && o.items.every(i => i.settled));

/** Komplety wysyłki z historii: suma kompletów po produktach. */
export function shipmentKits(s, packs) {
  let total = 0; const per = [];
  for (const pid in s.items || {}) { const k = s.items[pid] / packOf(packs, pid).size; total += k; per.push({ pid, name: (s.names || {})[pid] || pid, qty: s.items[pid], kits: k }); }
  per.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  return { total, per };
}

function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (String(a.orderId) < String(b.orderId) ? -1 : 1); }
