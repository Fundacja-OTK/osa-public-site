// Faktury zamówień — wspólne elementy karty zamówienia i listy „Faktury”: status, edycja rozliczenia (było → będzie), wydruk, link do wystawienia w Selly.
// Backend: orders:invoices (faktury zamówienia z Selly), orders:invoiceUpdate (zapis rozliczenia — wspólna logika shared/failover.js).
// Numer, daty, sprzedawca, nabywca i pozycje faktury NIE są tu edytowalne: zapis odsyła je do Selly bez zmian.
import { gateWrite, el, flash, money, htmlEsc } from '../core/ui.js?v=6bba789';
import { dateInput } from '../core/datepicker.js?v=6bba789';
import { api } from '../core/client.js?v=6bba789';
import { previewBox } from './zamowieniaKarta.js?v=6bba789';

/** Stany faktury w Selly (OrderInvoice.status_id): [nazwa, ton plakietki, wyjaśnienie]. */
export const INV_STATUS = {
  1: ['rozliczona', 'ok', 'Faktura w całości zapłacona (rozliczona)'],
  2: ['nierozliczona', 'warn', 'Faktura czeka na zapłatę'],
  3: ['częściowo rozliczona', 'warn', 'Część kwoty faktury jest zapłacona'],
  4: ['anulowana', 'bad', 'Faktura anulowana w Selly — nie liczy się do sum'],
};
const EDIT_STATUSES = [1, 2, 3];
const r2 = n => Math.round(n * 100) / 100;
const num = v => Number(String(v == null ? '' : v).trim().replace(/\s/g, '').replace(',', '.'));
const fmtIn = v => (v === '' || v == null || !isFinite(Number(v)) ? '' : String(r2(Number(v))).replace('.', ','));
const day = v => (v ? String(v).slice(0, 10) : '');
const plDay = v => { const d = day(v); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : d; };
const newOpId = () => 'inv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

/** Numer faktury jak w Selly: prefiks + numer + sufiks. */
export function invNumber(inv) {
  if (!inv) return '';
  const suf = inv.sufiks != null && inv.sufiks !== '' ? inv.sufiks : inv.sufix;
  return [inv.prefix, inv.number, suf].filter(x => x != null && x !== '').join('') || (inv.invoice_id != null ? '#' + inv.invoice_id : '—');
}
/** Wartość brutto: order_values albo suma pozycji (netto + VAT). */
export function invValue(inv) {
  if (inv && inv.order_values !== '' && inv.order_values != null && isFinite(Number(inv.order_values))) return r2(Number(inv.order_values));
  const items = (inv && inv.items) || [];
  return items.length ? r2(items.reduce((s, x) => s + (Number(x.price_value_net) || 0) + (Number(x.item_vat) || 0), 0)) : null;
}
export function invStatusPill(statusId) {
  const st = INV_STATUS[Number(statusId)];
  return st ? el('span', { class: 'ord-st ' + st[1], title: st[2] }, st[0]) : el('span', { class: 'muted' }, '—');
}
/** Po terminie: nierozliczona / częściowo i termin płatności minął. */
export function isOverdue(statusId, deadline) {
  const d = day(deadline);
  return [2, 3].includes(Number(statusId)) && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < new Date().toLocaleDateString('en-CA');
}

/** Link do wystawienia faktury w Selly dla zamówienia (ekran „Utworzenie faktury do zamówienia”). */
export function issueUrl(adminUrl, orderId) { return adminUrl + '?a=zamowienia.fakturaVAT&id=' + encodeURIComponent(orderId); }

// ─── Edycja rozliczenia ─────────────────────────────────────────────────────

/**
 * Formularz rozliczenia faktury → podgląd „było → będzie” → zapis w Selly.
 * o: { orderId, inv (pełna faktura z Selly), key (unikalny w stronie), onSaved(wynik), onClose() }
 */
export function invoiceEditor({ orderId, inv, key, onSaved, onClose }) {
  const k = String(key || inv.invoice_id);
  const box = el('div', { class: 'inv-edit', id: 'invEdit-' + k, role: 'region', 'aria-label': 'Rozliczenie faktury ' + invNumber(inv) });
  const value = invValue(inv);
  const orig = { status_id: String(inv.status_id == null ? '' : inv.status_id), paid: fmtIn(inv.paid), payment_deadline: day(inv.payment_deadline),
    payment_method: String(inv.payment_method == null ? '' : inv.payment_method), attention: String(inv.attention == null ? '' : inv.attention) };
  const opId = newOpId();   // jeden klucz na otwarty formularz: powtórka po zerwanym połączeniu nie zapisze drugi raz

  if (Number(inv.status_id) === 4) {
    box.append(el('div', { class: 'notice', role: 'status' }, 'Ta faktura jest anulowana — jej rozliczenia nie zmienia się w panelu OSA (tylko w panelu Selly).'),
      el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', onclick: () => onClose && onClose() }, 'Zamknij')));
    return box;
  }

  const status = el('select', { id: 'invSt-' + k, title: 'Stan rozliczenia faktury w Selly. Anulowanie faktury — tylko w panelu Selly.' },
    EDIT_STATUSES.map(s => el('option', { value: String(s) }, INV_STATUS[s][0])));
  if (!EDIT_STATUSES.includes(Number(orig.status_id))) status.prepend(el('option', { value: orig.status_id }, '(obecny: ' + (orig.status_id || 'brak') + ')'));
  status.value = orig.status_id;
  const paid = el('input', { type: 'text', id: 'invPaid-' + k, inputmode: 'decimal', autocomplete: 'off', value: orig.paid, title: 'Kwota zapłacona za tę fakturę (zł)' });
  const fill = value != null ? el('button', { type: 'button', class: 'small-btn secondary', id: 'invPaidAll-' + k, title: 'Wpisuje pełną wartość faktury jako zapłaconą i ustawia status „rozliczona”',
    onclick: () => { paid.value = fmtIn(value); status.value = '1'; } }, 'Całość (' + money(value) + ' zł)') : null;
  const deadline = dateInput({ id: 'invDl-' + k, value: orig.payment_deadline, label: 'Termin płatności', title: 'Termin płatności podany na fakturze' });
  const method = el('input', { type: 'text', id: 'invMeth-' + k, autocomplete: 'off', value: orig.payment_method, maxlength: '100', title: 'Forma płatności podana na fakturze, np. przelew, gotówka' });
  const notes = el('textarea', { id: 'invNote-' + k, rows: '2', maxlength: '1000', title: 'Uwagi wydrukowane na fakturze (pole „uwagi” w Selly)' }, orig.attention);
  const err = el('div', { class: 'notice error', role: 'alert', hidden: true });
  const lbl = (text, ctl, tip) => el('label', { class: 'inv-f', title: tip || null }, el('span', { class: tip ? 'tip' : null }, text), ctl);

  const cur = () => ({ status_id: status.value, paid: paid.value.trim(), payment_deadline: deadline.value || '', payment_method: method.value.trim(), attention: notes.value });
  const LABELS = { status_id: 'Status', paid: 'Zapłacono', payment_deadline: 'Termin płatności', payment_method: 'Forma płatności', attention: 'Uwagi' };
  const show = (f, v) => (v === '' || v == null ? '(puste)' : f === 'status_id' ? (INV_STATUS[Number(v)] || [v])[0] : f === 'paid' ? money(num(v)) + ' zł' : f === 'payment_deadline' ? plDay(v) : String(v));
  const same = (f, a, b) => (f === 'paid' ? (a === '' && b === '') || (a !== '' && b !== '' && r2(num(a)) === r2(num(b))) : String(a) === String(b));

  function validate(c) {
    if (c.paid !== '' && !(isFinite(num(c.paid)) && num(c.paid) >= 0)) return 'Zapłacono: podaj kwotę jako liczbę nieujemną, np. 120,50.';
    if (!c.payment_deadline) return 'Termin płatności jest wymagany na fakturze.';
    if (!c.payment_method) return 'Forma płatności nie może być pusta.';
    return '';
  }

  const form = el('div', { class: 'inv-form' },
    el('div', { class: 'inv-grid' },
      lbl('Status', status, 'Rozliczona = zapłacona w całości; częściowo = zapłacona część kwoty'),
      lbl('Zapłacono (zł)', el('span', { class: 'inv-paid' }, paid, fill)),
      lbl('Termin płatności', deadline),
      lbl('Forma płatności', method),
      el('label', { class: 'inv-f inv-wide' }, el('span', null, 'Uwagi'), notes)),
    el('p', { class: 'muted small' }, 'Numer, daty, dane sprzedawcy i nabywcy oraz pozycje faktury zostają bez zmian. Zmienisz je w panelu Selly.'),
    err);
  const next = gateWrite(el('button', { type: 'button', class: 'primary', id: 'invNext-' + k, title: 'Pokazuje listę zmian do sprawdzenia — nic jeszcze nie zapisuje' }, 'Dalej: sprawdź zmiany'), 'zamowienia');
  const cancel = el('button', { type: 'button', class: 'secondary', id: 'invCancel-' + k, onclick: () => onClose && onClose() }, 'Anuluj');
  next.addEventListener('click', () => {
    const c = cur(), msg = validate(c);
    err.hidden = !msg; err.textContent = msg;
    if (msg) return;
    const changed = Object.keys(c).filter(f => !same(f, c[f], orig[f]));
    if (!changed.length) { err.hidden = false; err.textContent = 'Nic się nie zmieniło — nie ma czego zapisać.'; return; }
    const rows = changed.map(f => [LABELS[f], show(f, orig[f]), show(f, c[f])]);
    const fields = {}, expect = {};
    for (const f of changed) { fields[f] = f === 'status_id' ? Number(c[f]) : f === 'paid' ? (c[f] === '' ? 0 : r2(num(c[f]))) : c[f]; expect[f] = inv[f] == null ? '' : inv[f]; }
    const prev = previewBox('inv-' + k, rows, {
      note: el('p', { class: 'muted small' }, 'Zapis zmienia tylko pola z listy. Selly może wysłać klientowi powiadomienie zgodnie ze swoimi ustawieniami.'),
      onBack: () => box.replaceChildren(form, actions),
      onConfirm: async () => {
        const r = await api('orders:invoiceUpdate', { orderId: String(orderId), invoiceId: String(inv.invoice_id), fields, expect, opId });
        flash('ordToast', 'Zapisano rozliczenie faktury ' + invNumber(inv));
        if (r && r.numberKept === false) flash('ordToast', 'Uwaga: Selly zwrócił inny numer faktury po zapisie — sprawdź fakturę w panelu Selly.');
        if (onSaved) onSaved(r);
      } });
    box.replaceChildren(prev);
  });
  const actions = el('div', { class: 'ord-actions' }, next, cancel);
  box.append(form, actions);
  return box;
}

// ─── Wydruk ─────────────────────────────────────────────────────────────────

/** HTML wydruku faktury z danych Selly (wszystkie wartości escapowane). Dane sprzedawcy pochodzą z samej faktury w Selly. */
export function invoicePrintHtml(inv, { orderNumber } = {}) {
  const e = v => htmlEsc(v == null ? '' : String(v));
  const m = v => (v == null || v === '' || !isFinite(Number(v)) ? '' : money(v));
  const lines = (...xs) => xs.filter(x => x != null && String(x).trim() !== '').map(e).join('<br>');
  const items = inv.items || [];
  const byVat = new Map();
  let net = 0, vat = 0;
  const rows = items.map((it, i) => {
    const q = Number(it.quantity) || 0, vn = Number(it.price_value_net) || r2((Number(it.price_net) || 0) * q), iv = Number(it.item_vat) || 0;
    net += vn; vat += iv;
    const rate = it.vat != null && it.vat !== '' ? String(it.vat) + (/%$/.test(String(it.vat)) || !isFinite(Number(it.vat)) ? '' : '%') : '';
    const g = byVat.get(rate) || { net: 0, vat: 0 }; g.net += vn; g.vat += iv; byVat.set(rate, g);
    return '<tr><td>' + e(it.no != null ? it.no : i + 1) + '</td><td>' + e(it.product_name) + (it.product_parameters ? '<div class="small">' + e(it.product_parameters) + '</div>' : '') +
      '</td><td class="n">' + e(q) + ' ' + e(it.unit_of_measure || '') + '</td><td class="n">' + m(it.price_net) + '</td><td class="n">' + m(vn) + '</td><td class="n">' + e(rate) +
      '</td><td class="n">' + m(iv) + '</td><td class="n">' + m(vn + iv) + '</td></tr>';
  }).join('');
  const total = invValue(inv) != null ? invValue(inv) : r2(net + vat);
  const vatRows = [...byVat].map(([rate, g]) => '<tr><td>' + e(rate) + '</td><td class="n">' + m(g.net) + '</td><td class="n">' + m(g.vat) + '</td><td class="n">' + m(g.net + g.vat) + '</td></tr>').join('');
  const st = INV_STATUS[Number(inv.status_id)];
  return '<div class="ip-doc">' +
    '<div class="ip-head"><h1>Faktura ' + e(invNumber(inv)) + '</h1><div>Data wystawienia: ' + e(plDay(inv.created_at)) + (orderNumber ? '<br>Zamówienie: ' + e(orderNumber) : '') + '</div></div>' +
    '<div class="ip-parties"><div><h2>Sprzedawca</h2>' + lines(inv.seller_name, inv.seller_address, [inv.seller_postcode, inv.seller_city].filter(Boolean).join(' '),
      inv.seller_nip ? 'NIP: ' + inv.seller_nip : '', inv.seller_bank, inv.seller_iban ? 'Konto: ' + inv.seller_iban : '') + '</div>' +
    '<div><h2>Nabywca</h2>' + lines(inv.buyer_name, inv.buyer_address, [inv.buyer_postcode, inv.buyer_city].filter(Boolean).join(' '), inv.buyer_nip ? 'NIP: ' + inv.buyer_nip : '') + '</div></div>' +
    '<table class="ip-items"><thead><tr><th>Lp.</th><th>Nazwa</th><th class="n">Ilość</th><th class="n">Cena netto</th><th class="n">Wartość netto</th><th class="n">VAT</th><th class="n">Kwota VAT</th><th class="n">Wartość brutto</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">Brak pozycji w danych z Selly.</td></tr>') + '</tbody></table>' +
    (vatRows ? '<table class="ip-vat"><thead><tr><th>Stawka VAT</th><th class="n">Netto</th><th class="n">VAT</th><th class="n">Brutto</th></tr></thead><tbody>' + vatRows + '</tbody></table>' : '') +
    '<div class="ip-sum"><div>Razem do zapłaty: <strong>' + m(total) + ' zł</strong></div>' +
      (inv.paid != null && inv.paid !== '' ? '<div>Zapłacono: ' + m(inv.paid) + ' zł</div>' : '') +
      '<div>Forma płatności: ' + e(inv.payment_method) + (inv.payment_deadline ? ', termin: ' + e(plDay(inv.payment_deadline)) : '') + '</div>' +
      (st ? '<div>Status: ' + e(st[0]) + '</div>' : '') + '</div>' +
    (inv.attention ? '<div class="ip-note"><h2>Uwagi</h2>' + e(inv.attention) + '</div>' : '') +
    (inv.authorized_person ? '<div class="ip-sign">Wystawił(a): ' + e(inv.authorized_person) + '</div>' : '') +
    '<div class="ip-foot">Wydruk z danych faktury zapisanej w Selly (panel OSA). Oryginalny wydruk — w panelu Selly.</div></div>';
}

/** Drukuje fakturę w tej samej karcie (bez okien i zewnętrznych zasobów); „Zapisz jako PDF” w oknie drukowania daje plik PDF. */
export function printInvoice(inv, opts) {
  document.getElementById('invPrint')?.remove();
  const host = el('div', { id: 'invPrint', class: 'inv-print' });
  host.innerHTML = invoicePrintHtml(inv, opts);   // wszystkie wartości przeszły przez htmlEsc
  document.body.append(host);
  document.body.classList.add('inv-printing');
  const done = () => { document.body.classList.remove('inv-printing'); host.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const prevTitle = document.title;
  document.title = 'Faktura ' + invNumber(inv).replace(/[\\/:*?"<>|]+/g, '-');   // nazwa pliku przy „Zapisz jako PDF”
  try { window.print(); } finally { document.title = prevTitle; setTimeout(() => { if (document.body.classList.contains('inv-printing') && !matchMedia('print').matches) done(); }, 1000); }
}

/** Przycisk „Drukuj / PDF” dla faktury (getInv może pobrać pełną fakturę z Selly). */
export function printButton(id, getInv, opts) {
  const b = el('button', { type: 'button', class: 'small-btn secondary', id, title: 'Drukuje fakturę z danych zapisanych w Selly. W oknie drukowania wybierz „Zapisz jako PDF”, aby pobrać plik.' }, 'Drukuj / PDF');
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { const inv = await getInv(); if (inv) printInvoice(inv, opts); }
    catch (e) { flash('ordToast', 'Nie udało się przygotować wydruku: ' + (e.message || 'błąd')); }
    finally { b.disabled = false; }
  });
  return b;
}
