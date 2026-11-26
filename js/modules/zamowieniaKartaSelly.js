// Karta zamówienia — to, czego REST API Selly nie zapisuje (P5): opiekun, data sprzedaży, zwrot transakcji, numer paczki i waga, dodatkowe koszty netto,
// notatka grupowa (z grupami) i zaplanowana zmiana statusu oraz usuwanie pozycji (tylko administrator panelu). Zapis formularzem karty zamówienia
// w Selly na sesji zalogowanego użytkownika (Worker: orders:cardForm / orders:cardSave / orders:itemDelete; ekran `zamowienie-karta`).
// Przebieg: dane z Selly dopiero po rozwinięciu sekcji (jedna strona Selly) → zmiany → podgląd z serwera (dryRun, nic nie wysyła) → potwierdzenie
// → zapis z kluczem opId (powtórka po zerwanym połączeniu nie wysyła drugi raz) → weryfikacja. Treść z Selly wyłącznie przez el() / textContent.
import { gateWrite, el, flash, sellyLink } from '../core/ui.js?v=5a962d8';
import { confirmDialog } from '../core/confirm.js?v=5a962d8';
import { dateInput } from '../core/datepicker.js?v=5a962d8';
import { api } from '../core/client.js?v=5a962d8';
import { newOpId } from '../core/api.js?v=5a962d8';

const gw = e => gateWrite(e, 'zamowienia');
const GROUP = /^notatki_grupy\[\d+\]$/;
// [etykieta, podpowiedź] — nazwy pól formularza Selly (docs/selly-screens/zamowienia.view.rekord.md)
const LABELS = {
  opiekun_id: ['Opiekun zamówienia', 'Pracownik odpowiedzialny za to zamówienie (lista kont administratorów z Selly)'],
  data_sprzedazy: ['Data sprzedaży', 'Data sprzedaży zapisana w zamówieniu (trafia m.in. na dokument sprzedaży)'],
  zwrot_transakcji: ['Zwrot transakcji (zł)', 'Kwota zwrócona klientowi, zapisana w zamówieniu w Selly'],
  paczka: ['Numer paczki', 'Numer paczki z karty zamówienia w Selly (inne pole niż „Nr przesyłki” zapisywany przez API)'],
  przesylka_waga: ['Waga przesyłki (kg)', 'Waga paczki zapisana w zamówieniu w Selly'],
  zamowienie_dodatkowe_koszty_netto: ['Dodatkowe koszty netto (zł)', 'Dodatkowe koszty zamówienia netto (pole karty zamówienia w Selly)'],
  notatki_grupowe: ['Notatka grupowa', 'Notatka widoczna tylko dla zaznaczonych niżej grup administratorów Selly'],
  cron_zamowienie_status_id: ['Nowy status', 'Status, który Selly ustawi samo we wskazanym dniu i godzinie. „- wybierz -” = bez zaplanowanej zmiany. Bez e-maila do klienta.'],
  cron_data: ['Dzień zmiany', 'Dzień, w którym Selly zmieni status zamówienia'],
  cron_godzina: ['Godzina zmiany', 'Godzina (0–23), o której Selly zmieni status'],
};
const MAIN = ['opiekun_id', 'data_sprzedazy', 'paczka', 'przesylka_waga', 'zwrot_transakcji', 'zamowienie_dodatkowe_koszty_netto'];
const CRON = ['cron_zamowienie_status_id', 'cron_data', 'cron_godzina'];
const labelOf = f => (LABELS[f.name] || [GROUP.test(f.name) ? 'Widoczna dla grupy: ' + (f.label || f.name) : (f.label || f.name)])[0];
const errText = r => (r && r.error) || 'nieznany błąd';

/** Jedno pole → { f, node, val(), changed() }. */
function control(f) {
  const id = 'ordSF-' + f.name.replace(/[^\w-]/g, '_');
  const [label, tip] = LABELS[f.name] || [labelOf(f), ''];
  let ctl;
  if (f.type === 'select') {
    ctl = el('select', { id }, (f.options || []).map(o => el('option', { value: o.value }, o.text || o.value)));
    ctl.value = f.value;
  } else if (f.type === 'checkbox') {
    ctl = el('input', { type: 'checkbox', id, checked: !!f.checked });
  } else if (f.type === 'textarea') {
    ctl = el('textarea', { id, rows: '3' }, f.value || '');
  } else if (f.type === 'date') {
    ctl = dateInput({ id, value: f.value || '', label, title: tip || null });
  } else {
    ctl = el('input', { type: 'text', id, autocomplete: 'off', value: f.value || '', inputmode: /waga|koszty|zwrot/.test(f.name) ? 'decimal' : null });
  }
  const val = () => (f.type === 'checkbox' ? (ctl.checked ? (f.onValue || '1') : '') : f.type === 'select' || f.type === 'date' ? ctl.value : String(ctl.value).trim());
  const node = f.type === 'checkbox'
    ? el('label', { class: 'ord-f flag osa-chk', title: tip || 'Notatka grupowa będzie widoczna dla tej grupy administratorów Selly' }, ctl, ' ', label)
    : el('label', { class: 'ord-f' + (f.type === 'textarea' ? ' grow' : '') }, el('span', { class: 'ord-f-l' + (tip ? ' tip' : ''), title: tip || null }, label), ctl);
  return { f, ctl, node, val, changed: () => val() !== (f.value || '') };
}

/** Wypełnia sekcję „Opiekun, data sprzedaży, paczka…” (host w zamowieniaKarta.js, moduł ładowany dopiero po rozwinięciu). C: kontekst karty (id, sellyUrl). */
export function mountSellyFields(C, body) {
  let ctls = [];
  load();

  async function load() {
    body.replaceChildren(el('p', { class: 'muted' }, 'Wczytuję z Selly…'));
    let r;
    try { r = await api('orders:cardForm', { orderId: C.id }); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || r.ok === false || !r.data) {
      body.replaceChildren(el('div', { class: 'notice warn', id: 'ordSFErr' }, 'Nie udało się wczytać pól z Selly: ' + errText(r) + ' '),
        el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', onclick: () => load() }, 'Spróbuj ponownie'),
          sellyLink('Zmień w Selly ↗', C.sellyUrl, 'Otwiera to zamówienie w panelu Selly w nowej karcie')));
      return;
    }
    render(r.data);
  }

  function render(d) {
    const by = Object.fromEntries((d.fields || []).map(f => [f.name, f]));
    ctls = (d.fields || []).map(control);
    const pick = names => ctls.filter(c => names.includes(c.f.name));
    const groups = ctls.filter(c => GROUP.test(c.f.name));
    const save = gw(el('button', { type: 'button', class: 'primary', id: 'ordSFSave', disabled: true, onclick: () => preview() }, 'Zapisz zmiany…'));
    const upd = () => { const n = ctls.filter(c => c.changed()).length; save.disabled = !n || !d.canSave; save.title = !d.canSave ? 'Selly nie pozwala zapisać tego formularza z panelu — zmień w Selly' : n ? 'Pokaże podgląd zmian (' + n + ') — zapis w Selly dopiero po potwierdzeniu' : 'Nie ma zmian do zapisania'; };
    for (const c of ctls) { c.ctl.addEventListener('input', upd); c.ctl.addEventListener('change', upd); }
    const cron = pick(CRON);
    body.replaceChildren(
      el('p', { class: 'muted small' }, 'Te pola zapisuje tylko formularz karty zamówienia w Selly. Zapisujemy wyłącznie zmienione pola; e-mail, SMS i proforma do klienta są wyłączone.'),
      el('div', { class: 'ord-grid' }, pick(MAIN).map(c => c.node)),
      by.notatki_grupowe ? el('div', { class: 'ord-sf-notes' }, pick(['notatki_grupowe']).map(c => c.node),
        groups.length ? el('div', { class: 'ord-add-row', title: 'Grupy administratorów Selly, które zobaczą notatkę grupową' }, groups.map(c => c.node)) : null) : null,
      cron.length ? el('details', { class: 'ord-bulk-items', id: 'ordSFCron' },
        el('summary', { title: 'Selly samo zmieni status zamówienia we wskazanym dniu i godzinie (bez e-maila do klienta)' }, 'Zaplanowana zmiana statusu ▾'),
        el('div', { class: 'ord-grid' }, cron.map(c => c.node))) : null,
      !ctls.length ? el('p', { class: 'muted' }, 'Selly nie pokazało żadnego z tych pól do zmiany (brak uprawnień w Selly albo inny układ formularza).') : null,
      el('div', { class: 'ord-actions' }, save, sellyLink('Otwórz w Selly ↗', C.sellyUrl, 'Otwiera to zamówienie w panelu Selly w nowej karcie')));
    upd();
  }

  async function preview() {
    const ch = ctls.filter(c => c.changed());
    if (!ch.length) return;
    const changes = Object.fromEntries(ch.map(c => [c.f.name, c.val()]));
    const expect = Object.fromEntries(ch.map(c => [c.f.name, c.f.value || '']));
    let pre;
    try { pre = await api('orders:cardSave', { orderId: C.id, changes, expect, dryRun: true }); } catch (e) { pre = { ok: false, error: e.message }; }
    if (!pre || pre.ok === false) { flash('', 'Nie udało się przygotować zapisu: ' + errText(pre), 'error'); return; }
    const diff = (pre.data && pre.data.diff) || [];
    if (!diff.length) { flash('', 'Bez zmian — wartości są już takie w Selly'); return; }
    const byName = Object.fromEntries(ctls.map(c => [c.f.name, c.f]));
    const items = diff.map(x => el('span', null, el('strong', null, labelOf(byName[x.name] || { name: x.name }) + ': '),
      String(x.beforeText || x.before || '(puste)'), ' → ', el('strong', null, String(x.afterText || x.after || '(puste)'))));
    const opId = newOpId();   // jeden klucz na otwarte okno: ponowienie po błędzie sieci nie wyśle drugi raz
    confirmDialog({ id: 'ordSFConfirm', title: 'Zapisać zmiany w Selly?', body: (pre.data && pre.data.warn) || '', items, confirmLabel: 'Zapisz w Selly', write: 'zamowienia',
      onConfirm: async ({ fail }) => {
        const r = await api('orders:cardSave', { orderId: C.id, changes, expect, confirm: true, opId });
        if (!r || r.ok === false) { fail('Zapis nie powiódł się: ' + errText(r)); return; }
        flash('', r.data && r.data.verified === false ? 'Selly przyjęło zapis, ale nie potwierdziło wszystkich pól — sprawdź w Selly' : 'Zapisano w Selly');
        load();
      } });
  }
}

/**
 * „Usuń…” przy pozycji (przycisk w zamowieniaKarta.js, tylko administrator panelu; serwer też to sprawdza): sprawdzenie w Selly, czy jest link usuwania
 * tej pozycji (dryRun), okno potwierdzenia (danger „Usuń”) → usunięcie z opId → odświeżenie karty. Brak linku w Selly = komunikat, nic nie wysyłamy.
 */
export async function deleteItem(C, p, money, btn) {
  const itemId = String(p.product_order_id);
  btn.disabled = true;
  let pre;
  try { pre = await api('orders:itemDelete', { orderId: C.id, itemId, dryRun: true }); } catch (e) { pre = { ok: false, error: e.message }; }
  btn.disabled = false;
  if (!pre || pre.ok === false) { flash('', 'Nie można usunąć pozycji z panelu: ' + errText(pre), 'error'); return; }
  const opId = newOpId();
  confirmDialog({ id: 'ordItemDelConfirm', title: 'Usunąć pozycję z zamówienia?', danger: true, confirmLabel: 'Usuń', focus: 'cancel', write: 'zamowienia',
    body: (pre.data && pre.data.warn) || 'Tego nie da się cofnąć z panelu.',
    items: [el('span', null, el('strong', null, p.name || ('Pozycja ' + itemId))), 'Ilość: ' + String(p.quantity == null ? '—' : p.quantity) + ', wartość: ' + money(p.price_total) + ' zł'],
    onConfirm: async ({ fail }) => {
      const r = await api('orders:itemDelete', { orderId: C.id, itemId, confirm: true, opId });
      if (!r || r.ok === false) { fail('Nie usunięto: ' + errText(r)); return; }
      flash('', 'Usunięto pozycję z zamówienia w Selly');
      try { await C.refresh(); } catch (e) { /* karta odświeży się przy ponownym otwarciu */ }
    } });
}
