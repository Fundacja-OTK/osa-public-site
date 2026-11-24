// Logika formularza „Nowe zamówienie” bez DOM (testy: tests/unit/orderNew.test.js): sumy, walidacja, ciało orders:create, dane klienta → formularz.

export const num = v => { const s = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'); return s === '' ? NaN : Number(s); };
export const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
export const fmtIn = v => (v == null || v === '' || !isFinite(Number(v)) ? '' : r2(v).toFixed(2).replace('.', ','));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Cena po rabacie procentowym (brutto za sztukę). */
export const discounted = (price, pct) => r2(price * (1 - (Number(pct) || 0) / 100));

/** Sumy zamówienia: pozycje, dostawa, opłata za płatność, rabat kwotowy → do zapłaty. */
export function totals(items, { delivery = 0, payment = 0, discount = 0 } = {}) {
  const goods = r2(items.reduce((s, it) => s + discounted(num(it.price) || 0, num(it.disc) || 0) * (parseInt(it.qty, 10) || 0), 0));
  const d = isFinite(num(delivery)) ? num(delivery) : 0, p = isFinite(num(payment)) ? num(payment) : 0, x = isFinite(num(discount)) ? num(discount) : 0;
  return { goods, delivery: r2(d), payment: r2(p), discount: r2(x), total: r2(goods + d + p - x), qty: items.reduce((s, it) => s + (parseInt(it.qty, 10) || 0), 0) };
}

/**
 * Walidacja formularza przed wysłaniem: lista błędów [{ key, msg }] (key = id pola do podświetlenia).
 * f — pola formularza (teksty), items — pozycje [{ id, name, qty, price, disc }].
 */
export function validate(f, items) {
  const e = [];
  const need = (k, label) => { if (!String(f[k] || '').trim()) e.push({ key: k, msg: 'Uzupełnij pole „' + label + '”.' }); };
  need('ship_first_name', 'Imię'); need('ship_last_name', 'Nazwisko'); need('email', 'E-mail'); need('phone', 'Telefon');
  need('ship_address', 'Ulica i nr domu'); need('ship_postcode', 'Kod pocztowy'); need('ship_city', 'Miejscowość');
  if (f.email && !EMAIL.test(String(f.email).trim())) e.push({ key: 'email', msg: 'Adres e-mail wygląda na niepoprawny (np. jan@domena.pl).' });
  if (f.ship_postcode && !/^\d{2}-\d{3}$/.test(String(f.ship_postcode).trim())) e.push({ key: 'ship_postcode', msg: 'Kod pocztowy ma format 00-000.' });
  if (f.invoice_type === 'faktura') {
    const nip = String(f.invoice_nip || '').replace(/^PL/i, '').replace(/[\s-]/g, '');
    if (nip && !/^\d{10}$/.test(nip)) e.push({ key: 'invoice_nip', msg: 'NIP ma 10 cyfr (np. 123-456-32-18).' });
    if (!f.invoice_as_ship) {
      if (!String(f.invoice_company || '').trim() && !(String(f.invoice_first_name || '').trim() && String(f.invoice_last_name || '').trim())) e.push({ key: 'invoice_company', msg: 'Dane do faktury: podaj nazwę firmy albo imię i nazwisko.' });
      for (const [k, l] of [['invoice_address', 'Ulica i nr domu (faktura)'], ['invoice_postcode', 'Kod pocztowy (faktura)'], ['invoice_city', 'Miejscowość (faktura)']]) need(k, l);
      if (f.invoice_postcode && !/^\d{2}-\d{3}$/.test(String(f.invoice_postcode).trim())) e.push({ key: 'invoice_postcode', msg: 'Kod pocztowy (faktura) ma format 00-000.' });
    }
  }
  if (!items.length) e.push({ key: 'onSearch', msg: 'Dodaj co najmniej jeden produkt.' });
  items.forEach((it, i) => {
    const q = String(it.qty).trim(), p = num(it.price), d = num(it.disc);
    if (!/^\d+$/.test(q) || !(Number(q) > 0)) e.push({ key: 'onQty' + i, msg: 'Pozycja ' + (i + 1) + ' (' + it.name + '): ilość musi być liczbą całkowitą większą od 0.' });
    if (!(p >= 0)) e.push({ key: 'onPrice' + i, msg: 'Pozycja ' + (i + 1) + ' (' + it.name + '): podaj cenę (liczba nieujemna, np. 12,50).' });
    if (String(it.disc || '').trim() !== '' && !(d >= 0 && d <= 100)) e.push({ key: 'onDisc' + i, msg: 'Pozycja ' + (i + 1) + ': rabat to liczba od 0 do 100 (%).' });
  });
  if (!f.delivery_id) e.push({ key: 'delivery_id', msg: 'Wybierz sposób dostawy.' });
  if (!f.payment_id) e.push({ key: 'payment_id', msg: 'Wybierz formę płatności.' });
  for (const [k, l] of [['delivery_price', 'Koszt dostawy'], ['payment_price', 'Opłata za płatność'], ['discount_price', 'Rabat kwotowy'], ['paid_price', 'Wpłacono']]) {
    if (String(f[k] || '').trim() !== '' && !(num(f[k]) >= 0)) e.push({ key: k, msg: l + ': podaj kwotę jako liczbę nieujemną, np. 12,50.' });
  }
  if (!f.status_id) e.push({ key: 'status_id', msg: 'Wybierz status zamówienia (Opcje zaawansowane).' });
  if (f.date && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(String(f.date).trim())) e.push({ key: 'date', msg: 'Data zamówienia ma format rrrr-mm-dd gg:mm (puste = teraz).' });
  if (f.required_completion_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.required_completion_date)) e.push({ key: 'required_completion_date', msg: 'Wymagana data realizacji ma format rrrr-mm-dd.' });
  return e;
}

/** Ciało akcji orders:create (pola Selly + pozycje). Puste pola opcjonalne są pomijane. */
export function payload(f, items) {
  const fields = {};
  const str = ['email', 'phone', 'ship_first_name', 'ship_last_name', 'ship_company', 'ship_address', 'ship_postcode', 'ship_city', 'client_comment', 'order_attention',
    'discount_description', 'required_completion_date', 'invoice_type'];
  for (const k of str) { const v = String(f[k] == null ? '' : f[k]).trim(); if (v) fields[k] = v; }
  for (const k of ['status_id', 'delivery_id', 'payment_id', 'user_id']) if (Number(f[k]) > 0) fields[k] = Number(f[k]);
  for (const k of ['delivery_price', 'payment_price', 'discount_price', 'paid_price']) if (String(f[k] == null ? '' : f[k]).trim() !== '') fields[k] = r2(num(f[k]));
  if (!('delivery_price' in fields)) fields.delivery_price = 0;
  if (fields.invoice_type === 'faktura') {
    const nip = String(f.invoice_nip || '').trim();
    if (nip) fields.invoice_nip = nip;
    fields.invoice_as_ship = f.invoice_as_ship ? 1 : 0;
    if (!f.invoice_as_ship) for (const k of ['invoice_company', 'invoice_first_name', 'invoice_last_name', 'invoice_address', 'invoice_postcode', 'invoice_city']) { const v = String(f[k] || '').trim(); if (v) fields[k] = v; }
  } else fields.invoice_as_ship = 1;
  const products = items.map(it => {
    const base = r2(num(it.price)), d = num(it.disc) || 0;
    const b = { product_id: Number(it.id), quantity: parseInt(it.qty, 10), price_with_tax: discounted(base, d) };
    if (d > 0) b.pricetax_without_discount = base;
    if (it.vat) b.vat_rate_id = Number(it.vat);
    if (String(it.cmt || '').trim()) b.personel_comment = String(it.cmt).trim();
    return b;
  });
  return { fields, products };
}

/** Dane klienta Selly (clients:get → client) → pola formularza zamówienia. */
export function clientToForm(c, userId) {
  const s = v => (v == null ? '' : String(v));
  const out = {
    ship_first_name: s(c.first_name || c.ship_first_name), ship_last_name: s(c.last_name || c.ship_last_name), email: s(c.email), phone: s(c.phone),
    ship_company: s(c.ship_company), ship_address: s(c.ship_address), ship_postcode: s(c.ship_postcode), ship_city: s(c.ship_city),
    invoice_type: c.sell_document === 'faktura' || (c.invoice_nip && c.sell_document !== 'paragon') ? 'faktura' : 'paragon',
    invoice_nip: s(c.invoice_nip), invoice_as_ship: c.invoice_as_ship == null ? true : !!Number(c.invoice_as_ship),
    invoice_company: s(c.invoice_company), invoice_first_name: s(c.invoice_first_name), invoice_last_name: s(c.invoice_last_name),
    invoice_address: s(c.invoice_address), invoice_postcode: s(c.invoice_postcode), invoice_city: s(c.invoice_city),
    user_id: Number(userId) > 0 ? String(userId) : '',
  };
  return out;
}
