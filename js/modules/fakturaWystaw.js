// Wystawianie faktury VAT z panelu (karta zamówienia, lista „Faktury” → „Do wystawienia”) — tak, jak w panelu Selly: formularz
// „Utworzenie faktury do zamówienia” wypełniony przez Selly (numer, nabywca, pozycje, VAT), wysłany sesją Selly użytkownika.
// Backend: invoices:issueForm (podgląd, nic nie wysyła) i invoices:issue (opId, potwierdzenie, kwota z podglądu; serwer blokuje duplikat
// i pilnuje limitu) — panel/worker/src/modules/invoiceIssue.js. Prawo zmian: sekcja „faktury” (administrator albo zgoda administratora).
// Korekta i usunięcie faktury oraz paragon — w Selly. Treść z Selly wyłącznie przez el() / textContent.
import { gateWrite, el, flash, money, dl, sellyLink, cnt } from '../core/ui.js?v=196affa';
import { confirmDialog } from '../core/confirm.js?v=196affa';
import { api } from '../core/client.js?v=196affa';

export const BATCH_MAX = 10;   // faktur w jednej partii (serwer i tak ma twardy limit na osobę)
const newOpId = () => 'invi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const LABELS = {
  termin_platnosci: ['Termin płatności (dni)', 'Ile dni od wystawienia ma klient na zapłatę — wartość zaproponowana przez Selly'],
  forma_platnosci: ['Forma płatności', 'Np. przelew, pobranie, karta — trafia na fakturę'],
  uwagi: ['Uwagi na fakturze', 'Tekst drukowany na fakturze (opcjonalnie)'],
};
const httpsOnly = u => (/^https:\/\//.test(String(u || '')) ? u : null);
const errText = r => (r && r.error) || 'Selly odrzuciło fakturę';
const noticeText = d => ((d && d.notices) || []).filter(n => n.kind === 'error').map(n => n.text).join(' ') || '';

/** Podgląd z serwera → { ok, d } albo { ok:false, error }. */
async function loadForm(orderId) {
  const r = await api('invoices:issueForm', { orderId: String(orderId) });
  if (!r || r.ok === false) return { ok: false, error: errText(r) };
  return { ok: true, d: r.data };
}

/** Wystawienie jednej faktury → wynik serwera (data) albo wyjątek z komunikatem. */
async function issueOne(orderId, d, opId, values, expect, sendEmail) {
  const r = await api('invoices:issue', { orderId: String(orderId), opId, confirm: true, expectGross: d.totals.gross, values, expect, ...(sendEmail ? { sendEmail: true } : {}) });
  if (!r || r.ok === false) throw new Error(errText(r));
  if (!r.data || !r.data.created) throw new Error(noticeText(r.data) || 'Selly nie przyjęło faktury — sprawdź dane w Selly.');
  return r.data;
}

function itemsTable(d) {
  const th = (t, tip, n) => el('th', { class: n ? 'n' : null }, el('span', { title: tip || t, class: tip ? 'tip' : null }, t));
  return el('div', { class: 'table-wrap' }, el('table', { id: 'invIssueItems', class: 'inv-issue-items' },
    el('thead', null, el('tr', null, th('Pozycja', 'Nazwa towaru albo usługi na fakturze (z Selly)'), th('Ilość', 'Ilość z faktury', true), th('Netto (zł)', 'Wartość netto pozycji', true),
      th('VAT', 'Stawka VAT pozycji'), th('Kwota VAT (zł)', 'Kwota podatku VAT pozycji', true), th('Brutto (zł)', 'Wartość brutto pozycji', true))),
    el('tbody', null, d.items.map(x => el('tr', null, el('td', null, x.name || '—'), el('td', { class: 'n' }, x.qty), el('td', { class: 'n nw' }, x.net == null ? '—' : money(x.net)),
      el('td', { class: 'nw' }, x.vatRate), el('td', { class: 'n nw' }, x.vat == null ? '—' : money(x.vat)), el('td', { class: 'n nw' }, x.gross == null ? '—' : money(x.gross))))),
    el('tfoot', null, el('tr', null, el('th', null, 'Razem'), el('td'), el('td', { class: 'n nw', id: 'invIssueNet' }, money(d.totals.net)), el('td'),
      el('td', { class: 'n nw', id: 'invIssueVat' }, money(d.totals.vat)), el('td', { class: 'n nw' }, el('strong', { id: 'invIssueGross' }, money(d.totals.gross)))))));
}

const EMAIL_TIP = 'Selly wyśle klientowi wystawioną fakturę na adres z zamówienia. Domyślnie wyłączone — faktura tylko powstaje w Selly.';
/** Pole „Wyślij fakturę klientowi e-mailem” (domyślnie wyłączone); null, gdy Selly nie oferuje wysyłki. */
function emailBox(canEmail, id) {
  if (!canEmail) return null;
  const input = el('input', { type: 'checkbox', id, title: EMAIL_TIP });
  return { input, node: el('label', { class: 'field check', title: EMAIL_TIP }, input, el('span', { class: 'tip', title: EMAIL_TIP }, ' Wyślij fakturę klientowi e-mailem')) };
}

/** Pole edytowalne (termin / forma płatności / uwagi) z wartością zaproponowaną przez Selly. */
function editField(f) {
  const [label, tip] = LABELS[f.name] || [f.label || f.name, ''];
  const input = f.type === 'select'
    ? el('select', { id: 'invIssue-' + f.name, title: tip }, (f.options || []).map(o => el('option', { value: o.value, selected: o.selected || null }, o.text)))
    : f.type === 'textarea' ? el('textarea', { id: 'invIssue-' + f.name, rows: '2', maxlength: '500', title: tip })
      : el('input', { type: 'text', id: 'invIssue-' + f.name, maxlength: '200', title: tip, autocomplete: 'off' });
  if (f.type !== 'select') input.value = f.value || '';
  return { name: f.name, before: f.value || '', input, node: el('label', { class: 'field' }, el('span', { class: tip ? 'tip' : null, title: tip || null }, label), input) };
}

/**
 * Panel „Wystaw fakturę” (podgląd → potwierdzenie → wystawienie). o: { orderId, onDone(result), onClose() } → węzeł.
 * Jeden opId na otwarty panel: powtórka (zerwane połączenie, drugie kliknięcie) nie wystawi drugiej faktury.
 */
export function issuePanel(o) {
  const host = el('div', { class: 'card inv-issue', id: 'invIssue' });
  const opId = newOpId();
  const close = el('button', { type: 'button', class: 'ghost small-btn', id: 'invIssueClose', onclick: () => { host.remove(); if (o.onClose) o.onClose(); } }, 'Zamknij');
  const head = el('div', { class: 'card-head' }, el('h3', null, 'Wystaw fakturę VAT'),
    el('div', { class: 'sub' }, 'Podgląd faktury przygotowanej przez Selly. Numer i dane sprzedawcy nadaje Selly — sprawdź kwoty przed wystawieniem.'), close);
  host.append(head, el('p', { class: 'muted small' }, 'Wczytuję fakturę z Selly…'));
  (async () => {
    let res;
    try { res = await loadForm(o.orderId); } catch (e) { res = { ok: false, error: e.message || 'błąd' }; }
    if (!res.ok) { host.replaceChildren(head, el('div', { class: 'notice warn', role: 'status', id: 'invIssueErr' }, 'Nie udało się otworzyć faktury w Selly: ' + res.error)); return; }
    render(res.d);
  })();

  function render(d) {
    const b = d.buyer || {};
    const facts = dl([
      ['Zamówienie', d.orderNumber || d.orderId],
      [el('span', { class: 'tip', title: 'Numer, który Selly zaproponowało w formularzu. Ostateczny numer nadaje Selly przy zapisie.' }, 'Numer (wg Selly)'), el('span', { id: 'invIssueNumber' }, d.number || '—')],
      ['Nabywca', el('span', { id: 'invIssueBuyer' }, b.name || '—')],
      ['NIP', el('span', { id: 'invIssueNip' }, b.nip || '—')],
    ]);
    const parts = [head, facts];
    if (b.docType === 'paragon') parts.push(el('div', { class: 'notice warn', id: 'invIssueDocType' }, 'Klient wybrał w zamówieniu paragon, nie fakturę — upewnij się, że faktura jest potrzebna.'));
    if (d.existing && d.existing.length) parts.push(el('p', { class: 'muted small', id: 'invIssueExisting' }, 'Faktury tego zamówienia w Selly: ' + d.existing.map(x => x.number || '#' + x.invoiceId).join(', ')));
    parts.push(d.items && d.items.length ? itemsTable(d) : el('div', { class: 'empty' }, 'Brak pozycji w formularzu Selly.'));
    const edits = d.blocked ? [] : (d.fields || []).filter(f => f.editable).map(editField);
    if (edits.length) parts.push(el('div', { class: 'inv-issue-fields' }, edits.map(e => e.node)));
    const other = (d.fields || []).filter(f => !f.editable);
    if (other.length) {
      parts.push(el('details', { class: 'inv-issue-more', id: 'invIssueMore' },
        el('summary', { title: 'Pozostałe pola formularza Selly — wysyłane bez zmian, tak jak wypełniło je Selly' }, 'Pozostałe dane faktury z Selly ▾'),
        dl(other.map(f => [f.label || f.name, String(f.value == null ? '' : f.value)]))));
    }
    const selly = httpsOnly(d.url) ? sellyLink('Otwórz w Selly ↗', d.url, 'Otwiera ten sam formularz faktury w panelu Selly (nowa karta) — tam zmienisz pozycje, kwoty i dane nabywcy') : null;
    if (d.blocked) {
      parts.push(el('div', { class: 'notice warn', role: 'status', id: 'invIssueBlocked' }, d.blocked), el('div', { class: 'ord-actions' }, selly));
      host.replaceChildren(...parts);
      return;
    }
    const mail = emailBox(d.canEmail, 'invIssueEmail');
    if (mail) parts.push(mail.node);
    parts.push(el('div', { class: 'notice muted small', id: 'invIssueWarn' }, d.warn || ''));
    const btn = gateWrite(el('button', { type: 'button', class: 'primary', id: 'invIssueBtn',
      title: 'Wystawia fakturę w Selly z danymi z podglądu (Selly nada numer). Najpierw pokaże podsumowanie do potwierdzenia.' }, 'Wystaw fakturę…'), 'faktury');
    btn.addEventListener('click', () => confirmIssue(d, edits, mail));
    parts.push(el('div', { class: 'ord-actions' }, btn, selly));
    host.replaceChildren(...parts);
  }

  async function confirmIssue(d, edits, mail) {
    const sendEmail = !!(mail && mail.input.checked);
    const values = {}, expect = {};
    for (const e of edits) {
      const v = e.input.value;
      expect[e.name] = e.before;
      if (v !== e.before) values[e.name] = v;
    }
    const b = d.buyer || {};
    let result = null;
    const items = [
      'Zamówienie: ' + (d.orderNumber || d.orderId),
      'Nabywca: ' + (b.name || '—'),
      'NIP: ' + (b.nip || '— (bez NIP)'),
      'Wartość brutto: ' + money(d.totals.gross) + ' zł (netto ' + money(d.totals.net) + ' zł, VAT ' + money(d.totals.vat) + ' zł), pozycji: ' + d.totals.lines,
      'Numer nada Selly' + (d.number ? ' (proponowany: ' + d.number + ')' : ''),
      ...(sendEmail ? ['+ e-mail do klienta (Selly wyśle fakturę)'] : []),
      ...Object.keys(values).map(k => ((LABELS[k] || [k])[0]) + ': ' + (expect[k] || '(puste)') + ' → ' + (values[k] || '(puste)')),
    ];
    const ok = await confirmDialog({ id: 'invIssueConfirm', title: 'Wystawić fakturę VAT?', danger: true, write: true, confirmLabel: 'Wystaw fakturę',
      body: 'Faktura to dokument księgowy: Selly nada jej kolejny numer i z panelu nie da się jej cofnąć (korekta tylko w Selly). ' + (sendEmail ? 'Selly wyśle ją też klientowi e-mailem.' : 'Faktura nie zostanie wysłana klientowi e-mailem.'),
      items,
      onConfirm: async ({ fail }) => {
        try { result = await issueOne(d.orderId, d, opId, values, expect, sendEmail); } catch (e) { fail(e.message || 'Błąd wystawiania.'); }
      } });
    if (!ok || !result) return;
    const no = result.invoice && result.invoice.number;
    flash('ordToast', no ? 'Wystawiono fakturę nr ' + no + '.' : 'Selly przyjęło fakturę — numer pojawi się po odświeżeniu.');
    host.replaceChildren(head, el('div', { class: 'notice ok', role: 'status', id: 'invIssueDone' },
      no ? 'Wystawiono fakturę nr ' + no + ' (' + money(d.totals.gross) + ' zł brutto).' : 'Selly przyjęło fakturę, ale nie widać jej jeszcze w API — odśwież za chwilę.'));
    if (o.onDone) o.onDone(result);
  }
  return host;
}

/**
 * Partia (lista „Do wystawienia”): najpierw podgląd każdej faktury (bez wysyłania), potem JEDNO potwierdzenie z listą i wpisaniem liczby faktur,
 * potem wystawianie po kolei (osobny opId na zamówienie). rows: [{ orderId, orderNumber }] ≤ BATCH_MAX. onProgress(text). → { done, failed, skipped }
 */
export async function issueBatch(rows, onProgress, opts) {
  if (!rows.length) return { done: [], failed: [], skipped: [] };
  if (rows.length > BATCH_MAX) throw new Error('Najwyżej ' + BATCH_MAX + ' faktur w jednej partii.');
  const ready = [], skipped = [];
  for (const [i, r] of rows.entries()) {
    if (onProgress) onProgress('Sprawdzam fakturę ' + (i + 1) + ' z ' + rows.length + ' w Selly…');
    let res;
    try { res = await loadForm(r.orderId); } catch (e) { res = { ok: false, error: e.message || 'błąd' }; }
    if (!res.ok || res.d.blocked || !res.d.canSubmit) skipped.push({ ...r, why: res.ok ? res.d.blocked || 'niedostępna' : res.error });
    else ready.push({ ...r, d: res.d, opId: newOpId() });
  }
  if (onProgress) onProgress('');
  if (!ready.length) return { done: [], failed: [], skipped };
  const sum = ready.reduce((a, x) => a + x.d.totals.gross, 0);
  const n = String(ready.length);
  const mailed = opts && opts.sendEmail ? ready.filter(x => x.d.canEmail) : [];
  const ok = await confirmDialog({ id: 'invBatchConfirm', title: 'Wystawić ' + cnt(ready.length, 'fakturę', 'faktury', 'faktur') + '?', danger: true, write: true,
    confirmLabel: 'Wystaw ' + cnt(ready.length, 'fakturę', 'faktury', 'faktur'),
    body: 'Każda faktura dostanie w Selly kolejny numer — z panelu nie da się ich cofnąć. Łącznie brutto: ' + money(sum) + ' zł.' +
      (mailed.length ? '\n\n+ e-mail do klienta: Selly wyśle faktury klientom (' + mailed.length + ' z ' + ready.length + (mailed.length < ready.length ? '; pozostałe bez adresu e-mail w Selly — bez wysyłki' : '') + ').' : '') +
      (skipped.length ? '\n\nPominięte (' + skipped.length + '): faktura już jest albo formularz Selly jest niedostępny.' : ''),
    items: ready.map(x => (x.orderNumber || x.orderId) + ' — ' + ((x.d.buyer || {}).name || '—') + ((x.d.buyer || {}).nip ? ', NIP ' + x.d.buyer.nip : '') + ' — ' + money(x.d.totals.gross) + ' zł brutto (VAT ' + money(x.d.totals.vat) + ' zł)'),
    typed: { text: n, label: 'Wpisz liczbę faktur (' + n + '), aby potwierdzić' } });
  if (!ok) return { done: [], failed: [], skipped, cancelled: true };
  const done = [], failed = [];
  for (const [i, x] of ready.entries()) {
    if (onProgress) onProgress('Wystawiam ' + (i + 1) + ' z ' + ready.length + '…');
    try { done.push({ ...x, result: await issueOne(x.orderId, x.d, x.opId, {}, undefined, mailed.includes(x)) }); }
    catch (e) { failed.push({ ...x, why: e.message || 'błąd' }); if (e.code === 429) break; }
  }
  if (onProgress) onProgress('');
  return { done, failed, skipped };
}
