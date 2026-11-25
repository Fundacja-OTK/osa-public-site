// „Nowe zamówienie” (#/zamowienia/nowe) — odpowiednik ekranu Selly zamowienia.add, krótki przepływ:
// klient (wyszukaj istniejącego albo wpisz dane) → produkty (wyszukiwarka, ilość, cena z katalogu, rabat %) → dostawa i płatność → podsumowanie → zapis.
// Backend: orders:create (POST /api/orders w Selly, shared/failover.js), słowniki z orders:meta, wyszukiwarki clients:list / products:list,
// dane klienta clients:get, opcjonalnie clients:create (konto klienta). Moduł montuje zamowienia.js dla trasy „nowe”.
import { el, gateWrite, flash, money, debounce, loadingBox, pageToolbar, cnt } from '../core/ui.js?v=650da05';
import { api } from '../core/client.js?v=650da05';
import { go, addLeaveGuard } from '../core/router.js?v=650da05';
import { num, r2, fmtIn, discounted, totals, validate, payload, clientToForm } from './zamowienieNoweLogika.js?v=650da05';

// ─── Widok ───────────────────────────────────────────────────────────────────

const newOpId = () => 'on-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
const W = 'zamowienia';
const V = { box: null, root: null, dirty: false, visible: false, seq: 0 };
const isNewHash = h => /^#\/zamowienia\/nowe(\?|$)/.test(h || '');
addLeaveGuard(hash => (V.visible && V.dirty && !isNewHash(hash) ? 'Formularz nowego zamówienia nie został zapisany. Opuścić go i odrzucić dane?' : null));
window.addEventListener('beforeunload', ev => { if (V.visible && V.dirty && isNewHash(location.hash)) { ev.preventDefault(); ev.returnValue = ''; } });
// Wyjście z formularza potwierdzone przez strażnika routera (przy „Anuluj” router od razu przywraca adres — stąd sprawdzenie po chwili): dane są odrzucane
window.addEventListener('hashchange', () => setTimeout(() => { if (V.visible && !isNewHash(location.hash)) { V.visible = false; if (V.dirty) { V.root = null; V.dirty = false; } } }, 0));

/** Wywoływane przez zamowienia.js: pokazuje (true) albo chowa formularz w kontenerze modułu Zamówienia. */
export function showNewOrder(host, on) {
  if (!V.box) { V.box = el('div', { id: 'onRoot', class: 'on-root' }); host.append(V.box); }
  V.box.hidden = !on; V.visible = !!on;
  if (on && !V.root) start();
  return V.box;
}

async function start() {
  const my = ++V.seq;
  V.box.replaceChildren(el('div', { class: 'card' }, loadingBox('Przygotowuję formularz…')));
  let meta;
  try { meta = await api('orders:meta'); }
  catch (e) {
    if (my !== V.seq) return;
    V.box.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'notice error', role: 'alert' }, 'Nie udało się wczytać słowników zamówień: ' + (e.message || 'błąd')),
      el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', onclick: () => start() }, 'Spróbuj ponownie'), el('a', { href: '#/zamowienia', class: 'btn-link' }, '← Wróć do listy'))));
    return;
  }
  if (my !== V.seq) return;
  V.root = buildForm(meta || {});
  V.box.replaceChildren(V.root);
}

function reset() { V.root = null; V.dirty = false; if (V.visible) start(); }

function buildForm(meta) {
  const statuses = (meta.statuses || []).slice().sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  const S = { items: [], client: null, opId: newOpId(), busy: false, confirm: false, clientDiscount: 0 };
  const inputs = {};
  const touch = () => { V.dirty = true; S.confirm = false; renderSummary(); };

  // pole tekstowe z etykietą i podpowiedzią
  function fld(k, label, { tip, req, type = 'text', inputmode, cls, placeholder, autocomplete } = {}) {
    const i = el('input', { type, id: 'on-' + k, inputmode: inputmode || null, autocomplete: autocomplete || 'off', placeholder: placeholder || null, 'aria-required': req ? 'true' : null, oninput: touch });
    inputs[k] = i;
    return el('label', { class: 'ord-f' + (cls ? ' ' + cls : '') }, el('span', { class: 'ord-f-l' + (tip ? ' tip' : ''), title: tip || null }, label + (req ? ' *' : '')), i);
  }
  function sel(k, label, opts, { tip, req, empty = '— wybierz —' } = {}) {
    const s = el('select', { id: 'on-' + k, 'aria-required': req ? 'true' : null, onchange: touch }, empty != null ? el('option', { value: '' }, empty) : null, opts.map(o => el('option', { value: String(o.id) }, o.name)));
    inputs[k] = s;
    return el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l' + (tip ? ' tip' : ''), title: tip || null }, label + (req ? ' *' : '')), s);
  }
  const val = k => { const i = inputs[k]; if (!i) return ''; return i.type === 'checkbox' ? i.checked : i.value; };
  const setVal = (k, v) => { const i = inputs[k]; if (!i) return; if (i.type === 'checkbox') i.checked = !!v; else i.value = v == null ? '' : String(v); };

  // ── 1. Klient ──
  const cliList = el('div', { class: 'ord-pick-list', id: 'onCliList', hidden: true, role: 'listbox', 'aria-label': 'Znalezieni klienci' });
  let cliSeq = 0;
  const cliSearch = el('input', { type: 'search', id: 'onCliSearch', placeholder: 'Szukaj klienta: nazwisko, e-mail, telefon, firma…', autocomplete: 'off', 'aria-label': 'Szukaj klienta',
    title: 'Wpisz co najmniej 2 znaki. Wybrany klient uzupełni dane poniżej; zamówienie zostanie przypisane do jego konta.', oninput: debounce(searchClients, 250) });
  async function searchClients() {
    const q = cliSearch.value.trim(), my = ++cliSeq;
    if (q.length < 2) { cliList.hidden = true; cliList.replaceChildren(); return; }
    cliList.hidden = false; cliList.replaceChildren(el('div', { class: 'muted small ord-pick-msg' }, 'Szukam…'));
    try {
      const r = await api('clients:list', { q, pageSize: 10 });
      if (my !== cliSeq) return;
      const rows = r.rows || [];
      cliList.replaceChildren(...(rows.length ? rows.map(c => el('button', { type: 'button', role: 'option', class: 'ord-pick-item', 'data-cid': c.id, title: 'Wybierz tego klienta — jego dane uzupełnią formularz', onclick: () => pickClient(c) },
        el('strong', null, c.name || c.email || ('Klient ' + c.id)), el('span', { class: 'muted small' }, [c.email, c.company, c.city].filter(Boolean).join(' · ')))) :
        [el('div', { class: 'muted small ord-pick-msg' }, 'Brak klientów pasujących do „' + q + '”. Wpisz dane nowego klienta poniżej.')]));
    } catch (e) { if (my === cliSeq) cliList.replaceChildren(el('div', { class: 'notice error ord-pick-msg' }, 'Nie udało się wyszukać klientów: ' + (e.message || 'błąd'))); }
  }
  const cliChosen = el('div', { class: 'on-chosen', id: 'onCliChosen', hidden: true });
  async function pickClient(row) {
    cliList.hidden = true; cliSearch.value = '';
    cliChosen.hidden = false; cliChosen.replaceChildren(el('span', { class: 'muted' }, 'Wczytuję dane klienta…'));
    try {
      const r = await api('clients:get', { id: row.id });
      const c = r.client || {};
      const f = clientToForm(c, c.user_id != null ? c.user_id : r.userId);
      for (const k of Object.keys(f)) setVal(k, f[k]);
      S.client = { id: String(row.id), name: row.name || c.email || '' };
      S.clientDiscount = Number(c.discount) > 0 && Number(c.discount) <= 100 ? Number(c.discount) : 0;
      newAccount.checked = false; newAccountRow.hidden = true;
      cliChosen.replaceChildren(el('span', null, 'Klient: ', el('strong', null, S.client.name), S.client.name && c.email && S.client.name !== c.email ? ' (' + c.email + ')' : ''),
        S.clientDiscount ? el('span', { class: 'on-tag tip', title: 'Rabat procentowy z karty klienta w Selly — wpisuje się przy produktach dodawanych od teraz (możesz go zmienić przy pozycji)' }, 'rabat klienta ' + S.clientDiscount + '%') : null,
        el('a', { href: '#/klienci/' + encodeURIComponent(S.client.id), class: 'btn-link', target: '_blank', rel: 'noopener', title: 'Otwiera kartę klienta w nowej karcie' }, 'Karta klienta ↗'),
        el('button', { type: 'button', class: 'secondary small-btn', id: 'onCliClear', title: 'Odłącz klienta — dane w formularzu zostają, zamówienie nie będzie przypisane do konta', onclick: clearClient }, 'Odłącz'));
      syncInvoice(); touch();
    } catch (e) { cliChosen.replaceChildren(el('span', { class: 'notice error' }, 'Nie udało się wczytać klienta: ' + (e.message || 'błąd'))); }
  }
  function clearClient() { S.client = null; S.clientDiscount = 0; setVal('user_id', ''); cliChosen.hidden = true; cliChosen.replaceChildren(); newAccountRow.hidden = false; touch(); }
  inputs.user_id = el('input', { type: 'hidden', id: 'on-user_id' });

  const invType = el('div', { class: 'seg on-seg', role: 'group', 'aria-label': 'Dokument sprzedaży' });
  inputs.invoice_type = { type: 'seg', value: 'paragon' };
  const segBtn = (v, label, tip) => el('button', { type: 'button', 'data-v': v, title: tip, 'aria-pressed': 'false', onclick: () => { inputs.invoice_type.value = v; syncInvoice(); touch(); } }, label);
  invType.append(segBtn('paragon', 'Paragon', 'Dokument sprzedaży: paragon (klient indywidualny)'), segBtn('faktura', 'Faktura', 'Dokument sprzedaży: faktura — podaj NIP i dane firmy'));
  const sameAs = el('input', { type: 'checkbox', id: 'on-invoice_as_ship', checked: true, onchange: () => { syncInvoice(); touch(); } });
  inputs.invoice_as_ship = sameAs;
  const invBox = el('div', { class: 'ord-form', id: 'onInvoiceBox' },
    fld('invoice_company', 'Nazwa firmy (faktura)'), fld('invoice_first_name', 'Imię (faktura)'), fld('invoice_last_name', 'Nazwisko (faktura)'),
    fld('invoice_address', 'Ulica i nr domu (faktura)', { req: true }), fld('invoice_postcode', 'Kod pocztowy (faktura)', { req: true, placeholder: '00-000' }), fld('invoice_city', 'Miejscowość (faktura)', { req: true }));
  const fvBox = el('div', { id: 'onFvBox' }, el('div', { class: 'ord-form' }, fld('invoice_nip', 'NIP', { tip: 'NIP nabywcy na fakturze (10 cyfr; myślniki i prefiks PL są dozwolone)', inputmode: 'numeric' })),
    el('label', { class: 'ord-f flag on-flag', title: 'Odznacz, gdy faktura ma być wystawiona na inne dane niż adres dostawy' }, sameAs, 'Dane do faktury takie same jak do dostawy'), invBox);
  function syncInvoice() {
    const fv = inputs.invoice_type.value === 'faktura';
    for (const b of invType.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === inputs.invoice_type.value));
    fvBox.hidden = !fv; invBox.hidden = !fv || sameAs.checked;
  }
  const newAccount = el('input', { type: 'checkbox', id: 'onNewAccount', onchange: touch });
  const newAccountRow = el('label', { class: 'ord-f flag on-flag', id: 'onNewAccountRow', title: 'Przed zamówieniem panel zakłada klientowi konto w sklepie (jak „Dodaj klienta” w module Klienci, z losowym hasłem). Selly może wysłać klientowi e-mail o nowym koncie — zależnie od ustawień sklepu. Bez zaznaczenia zamówienie powstaje bez konta (jak zakup gościa).' },
    newAccount, el('span', { class: 'tip' }, 'Załóż też konto klienta w sklepie'));

  const secClient = el('section', { class: 'card on-sec', id: 'onSecClient' },
    el('h3', null, el('span', { class: 'on-step' }, '1'), 'Klient'),
    el('p', { class: 'muted small' }, 'Wyszukaj klienta ze sklepu albo od razu wpisz dane nowego.'),
    el('div', { class: 'ord-pick' }, cliSearch, cliList), cliChosen, inputs.user_id,
    el('div', { class: 'ord-form' },
      fld('ship_first_name', 'Imię', { req: true, autocomplete: 'off' }), fld('ship_last_name', 'Nazwisko', { req: true }), fld('email', 'E-mail', { req: true, type: 'email', tip: 'Adres klienta — Selly wysyła na niego wiadomości o zamówieniu (zależnie od ustawień sklepu)' }),
      fld('phone', 'Telefon', { req: true, type: 'tel', inputmode: 'tel' }), fld('ship_company', 'Firma', { tip: 'Nazwa firmy w adresie dostawy (opcjonalnie)' }), fld('ship_address', 'Ulica i nr domu', { req: true }),
      fld('ship_postcode', 'Kod pocztowy', { req: true, placeholder: '00-000', inputmode: 'numeric' }), fld('ship_city', 'Miejscowość', { req: true })),
    el('div', { class: 'on-row' }, el('span', { class: 'ord-f-l tip', title: 'Rodzaj dokumentu sprzedaży zapisany w zamówieniu (Selly: „faktura” / „paragon”)' }, 'Dokument:'), invType),
    fvBox, newAccountRow);

  // ── 2. Produkty ──
  const vatOpts = meta.vat || [];
  const showMore = el('input', { type: 'checkbox', id: 'onItemMore', onchange: () => renderItems() });
  const prodList = el('div', { class: 'ord-pick-list', id: 'onProdList', hidden: true, role: 'listbox', 'aria-label': 'Znalezione produkty' });
  let prodSeq = 0;
  const prodSearch = el('input', { type: 'search', id: 'onSearch', placeholder: 'Szukaj produktu: nazwa, kod, EAN…', autocomplete: 'off', 'aria-label': 'Szukaj produktu',
    title: 'Wpisz co najmniej 2 znaki: nazwę, kod lub EAN. Wybrany produkt trafia do listy pozycji z ceną z katalogu.', oninput: debounce(searchProducts, 250) });
  async function searchProducts() {
    const q = prodSearch.value.trim(), my = ++prodSeq;
    if (q.length < 2) { prodList.hidden = true; prodList.replaceChildren(); return; }
    prodList.hidden = false; prodList.replaceChildren(el('div', { class: 'muted small ord-pick-msg' }, 'Szukam…'));
    try {
      const r = await api('products:list', { q, pageSize: 10 });
      if (my !== prodSeq) return;
      const rows = r.rows || [];
      prodList.replaceChildren(...(rows.length ? rows.map(p => el('button', { type: 'button', role: 'option', class: 'ord-pick-item', 'data-pid': p.id, title: 'Dodaj do zamówienia: ' + p.name + (p.code ? ' (' + p.code + ')' : ''), onclick: () => addItem(p) },
        el('strong', null, p.name || ('Produkt ' + p.id)), el('span', { class: 'muted small' }, [p.code, p.price != null && p.price !== '' ? money(p.price) + ' zł' : '', p.qty != null ? 'stan: ' + p.qty : ''].filter(Boolean).join(' · ')))) :
        [el('div', { class: 'muted small ord-pick-msg' }, 'Brak produktów pasujących do „' + q + '”.')]));
    } catch (e) { if (my === prodSeq) prodList.replaceChildren(el('div', { class: 'notice error ord-pick-msg' }, 'Nie udało się wyszukać produktów: ' + (e.message || 'błąd'))); }
  }
  function addItem(p) {
    prodList.hidden = true; prodSearch.value = '';
    const same = S.items.find(it => it.id === String(p.id));
    if (same) { same.qty = String((parseInt(same.qty, 10) || 0) + 1); flash('', 'Zwiększono ilość: ' + same.name); }
    else S.items.push({ id: String(p.id), name: p.name || ('Produkt ' + p.id), code: p.code || '', qty: '1', price: fmtIn(p.price), catalog: p.price, disc: S.clientDiscount ? String(S.clientDiscount) : '', vat: '', cmt: '', variants: !!Number(p.hasVariants), stock: p.qty });
    renderItems(); touch();
    const last = itemsBox.querySelector('.on-item:last-child .qty'); if (last && !same) last.focus();
  }
  const itemsBox = el('div', { class: 'on-items', id: 'onItems' });
  function renderItems() {
    if (!S.items.length) { itemsBox.replaceChildren(el('p', { class: 'muted', id: 'onNoItems' }, 'Nie dodano jeszcze produktów — użyj wyszukiwarki powyżej.')); renderSummary(); return; }
    const more = showMore.checked;
    itemsBox.replaceChildren(...S.items.map((it, i) => {
      const value = el('span', { class: 'on-val', title: 'Wartość pozycji: cena po rabacie × ilość' });
      const upd = () => { const v = discounted(num(it.price) || 0, num(it.disc) || 0) * (parseInt(it.qty, 10) || 0); value.textContent = money(r2(v)) + ' zł'; };
      const inp = (k, cls, label, tip, attrs = {}) => el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l' + (tip ? ' tip' : ''), title: tip || null }, label),
        el('input', Object.assign({ type: 'text', class: 'ord-in ' + cls, id: 'on' + k[0].toUpperCase() + k.slice(1) + i, value: it[k], autocomplete: 'off', oninput: ev => { it[k] = ev.target.value; upd(); touch(); } }, attrs)));
      upd();
      return el('div', { class: 'on-item', 'data-pid': it.id },
        el('div', { class: 'on-item-name' }, el('strong', null, it.name), el('span', { class: 'muted small' }, [it.code, it.catalog != null && it.catalog !== '' ? 'cena katalogowa ' + money(it.catalog) + ' zł' : '', it.stock != null ? 'stan: ' + it.stock : ''].filter(Boolean).join(' · ')),
          it.variants ? el('span', { class: 'on-tag warn tip', title: 'Panel dodaje produkt bez wyboru wariantu. Jeśli wariant jest potrzebny, uzupełnij go w panelu Selly po utworzeniu zamówienia.' }, 'ma warianty') : null),
        el('div', { class: 'on-item-f' },
          inp('qty', 'qty', 'Ilość', null, { inputmode: 'numeric' }),
          inp('price', 'price', 'Cena brutto (zł)', 'Cena brutto za sztukę przed rabatem — domyślnie cena z katalogu produktów', { inputmode: 'decimal' }),
          inp('disc', 'disc', 'Rabat %', 'Rabat procentowy na tę pozycję: cena w zamówieniu = cena × (100 − rabat) / 100', { inputmode: 'decimal', placeholder: '0' }),
          more ? el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l tip', title: 'Stawka VAT pozycji; „domyślna” = stawka produktu w Selly' }, 'VAT'),
            el('select', { class: 'ord-in vat', id: 'onVat' + i, onchange: ev => { it.vat = ev.target.value; touch(); } }, el('option', { value: '' }, 'domyślna'), vatOpts.map(v => el('option', { value: String(v.id), selected: String(v.id) === it.vat }, v.name)))) : null,
          more ? inp('cmt', 'cmt', 'Komentarz', 'Komentarz do pozycji (widoczny dla obsługi w Selly)') : null,
          el('div', { class: 'on-item-end' }, value, el('button', { type: 'button', class: 'secondary small-btn', title: 'Usuń pozycję ' + it.name, 'aria-label': 'Usuń ' + it.name, onclick: () => { S.items.splice(i, 1); renderItems(); touch(); } }, '✕'))));
    }));
    renderSummary();
  }
  const secItems = el('section', { class: 'card on-sec', id: 'onSecItems' },
    el('h3', null, el('span', { class: 'on-step' }, '2'), 'Produkty'),
    el('div', { class: 'ord-pick' }, prodSearch, prodList), itemsBox,
    el('label', { class: 'ord-f flag on-flag muted small', title: 'Pokazuje przy każdej pozycji stawkę VAT i komentarz' }, showMore, 'Pokaż VAT i komentarz przy pozycjach'));

  // ── 3. Dostawa i płatność ──
  const secShip = el('section', { class: 'card on-sec', id: 'onSecShip' },
    el('h3', null, el('span', { class: 'on-step' }, '3'), 'Dostawa i płatność'),
    el('div', { class: 'ord-form' },
      sel('delivery_id', 'Sposób dostawy', meta.deliveries || [], { req: true, tip: 'Formy dostawy ze sklepu (słownik Selly)' }),
      fld('delivery_price', 'Koszt dostawy (zł)', { inputmode: 'decimal', placeholder: '0,00', tip: 'Kwota brutto doliczana do zamówienia; Selly nie wylicza jej tu automatycznie' }),
      sel('payment_id', 'Forma płatności', meta.payments || [], { req: true, tip: 'Formy płatności ze sklepu (słownik Selly)' })),
    el('div', { class: 'ord-form' }, el('label', { class: 'ord-f ord-fw wide' }, el('span', { class: 'ord-f-l tip', title: 'Komentarz zapisany w zamówieniu jako komentarz klienta (pole „Komentarz” w Selly)' }, 'Komentarz do zamówienia'),
      inputs.client_comment = el('textarea', { id: 'on-client_comment', rows: '2', oninput: touch }))));

  // ── Opcje zaawansowane ──
  const firstStatus = statuses[0];
  const adv = el('details', { class: 'card on-sec on-opts', id: 'onOpts' },
    el('summary', { title: 'Status, data, rabat kwotowy, opłata za płatność, wpłata, uwagi wewnętrzne' }, 'Opcje zaawansowane'),
    el('div', { class: 'ord-form' },
      sel('status_id', 'Status', statuses, { req: true, empty: null, tip: 'Status nowego zamówienia; domyślnie pierwszy na liście statusów sklepu' }),
      fld('date', 'Data zamówienia', { placeholder: 'rrrr-mm-dd gg:mm', tip: 'Puste = teraz. Format: rrrr-mm-dd gg:mm' }),
      fld('payment_price', 'Opłata za płatność (zł)', { inputmode: 'decimal', placeholder: '0,00', tip: 'Dodatkowa opłata za formę płatności (np. pobranie), doliczana do zamówienia' }),
      fld('discount_price', 'Rabat kwotowy (zł)', { inputmode: 'decimal', placeholder: '0,00', tip: 'Rabat na całe zamówienie, odejmowany od sumy (niezależnie od rabatów % przy pozycjach)' }),
      fld('discount_description', 'Opis rabatu', { tip: 'Opis rabatu kwotowego widoczny w zamówieniu' }),
      fld('paid_price', 'Wpłacono (zł)', { inputmode: 'decimal', placeholder: '0,00', tip: 'Kwota już zapłacona przez klienta; puste = 0 (zamówienie nieopłacone)' }),
      fld('required_completion_date', 'Wymagana data realizacji', { type: 'date', tip: 'Termin, do którego zamówienie ma być zrealizowane (opcjonalnie)' })),
    el('div', { class: 'ord-form' }, el('label', { class: 'ord-f ord-fw wide' }, el('span', { class: 'ord-f-l tip', title: 'Uwagi wewnętrzne dla obsługi sklepu (pole „Uwagi” w Selly) — wyróżniane w karcie zamówienia' }, 'Uwagi wewnętrzne'),
      inputs.order_attention = el('textarea', { id: 'on-order_attention', rows: '2', class: 'ord-attn-in', oninput: touch }))));
  if (firstStatus) inputs.status_id.value = String(firstStatus.id);

  // ── 4. Podsumowanie i zapis ──
  const sumBox = el('div', { class: 'on-sum', id: 'onSummary' });
  const errBox = el('div', { class: 'notice error', id: 'onErrors', role: 'alert', hidden: true });
  const actBox = el('div', { class: 'ord-actions', id: 'onActions' });
  const collect = () => {
    const f = {};
    for (const k of Object.keys(inputs)) f[k] = val(k);
    f.invoice_type = inputs.invoice_type.value;
    f.invoice_as_ship = sameAs.checked;
    return f;
  };
  function renderSummary() {
    const f = collect(), t = totals(S.items, { delivery: f.delivery_price, payment: f.payment_price, discount: f.discount_price });
    const row = (label, v, tip, cls) => el('div', { class: 'on-sum-row' + (cls ? ' ' + cls : '') }, el('span', { class: tip ? 'tip' : null, title: tip || null }, label), el('strong', null, v));
    const nm = id => { const all = [...(meta.deliveries || []), ...(meta.payments || []), ...statuses]; const x = all.find(y => String(y.id) === String(id)); return x ? x.name : ''; };
    sumBox.replaceChildren(
      row('Produkty (' + cnt(t.qty, 'sztuka', 'sztuki', 'sztuk') + ')', money(t.goods) + ' zł', 'Suma pozycji: cena po rabacie × ilość'),
      row('Dostawa' + (f.delivery_id ? ' — ' + nm(f.delivery_id) : ''), money(t.delivery) + ' zł', 'Koszt dostawy wpisany w kroku 3'),
      t.payment ? row('Opłata za płatność', money(t.payment) + ' zł', 'Z opcji zaawansowanych') : null,
      t.discount ? row('Rabat kwotowy', '− ' + money(t.discount) + ' zł', 'Z opcji zaawansowanych') : null,
      row('Do zapłaty', money(t.total) + ' zł', 'Produkty + dostawa + opłata za płatność − rabat kwotowy (ostateczną kwotę wylicza Selly)', 'total'),
      el('div', { class: 'muted small' }, [f.payment_id ? 'Płatność: ' + nm(f.payment_id) : '', f.status_id ? 'Status: ' + nm(f.status_id) : '', f.invoice_type === 'faktura' ? 'Faktura' : 'Paragon', S.client ? 'Konto klienta: ' + S.client.name : (newAccount.checked ? 'Nowe konto klienta' : 'Bez konta (gość)')].filter(Boolean).join(' · ')));
    renderActions(t);
  }
  function renderActions(t) {
    if (S.busy) return;
    if (!S.confirm) {
      actBox.replaceChildren(gateWrite(el('button', { type: 'button', class: 'primary', id: 'onSubmit', title: 'Sprawdza formularz i prosi o potwierdzenie przed utworzeniem zamówienia w Selly', onclick: askConfirm }, 'Utwórz zamówienie'), W),
        el('a', { href: '#/zamowienia', class: 'btn-link', id: 'onCancel' }, 'Anuluj'));
      return;
    }
    const f = collect();
    actBox.replaceChildren(el('div', { class: 'notice warn on-confirm', id: 'onConfirm' },
      el('p', null, el('strong', null, 'Utworzyć zamówienie w Selly na ' + money(t.total) + ' zł'), ' dla ' + [f.ship_first_name, f.ship_last_name].filter(Boolean).join(' ') + ' (' + f.email + ')?'),
      el('p', { class: 'small' }, 'Zamówienie od razu pojawi się w sklepie. Selly może wysłać klientowi e-mail z potwierdzeniem — zależnie od ustawień powiadomień sklepu.'),
      el('div', { class: 'ord-actions' },
        gateWrite(el('button', { type: 'button', class: 'primary', id: 'onConfirmYes', onclick: submit }, 'Tak, utwórz zamówienie'), W),
        el('button', { type: 'button', class: 'secondary', id: 'onConfirmNo', onclick: () => { S.confirm = false; renderSummary(); } }, 'Wróć do edycji'))));
  }
  function showErrors(list) {
    for (const x of V.root.querySelectorAll('.on-bad')) x.classList.remove('on-bad');
    if (!list.length) { errBox.hidden = true; errBox.replaceChildren(); return; }
    errBox.hidden = false;
    errBox.replaceChildren(el('strong', null, 'Popraw przed zapisem:'), el('ul', null, list.map(x => el('li', null, x.msg))));
    for (const x of list) { const i = V.root.querySelector('#on-' + x.key) || V.root.querySelector('#' + x.key); if (i) i.classList.add('on-bad'); }
    if (list.some(x => ['status_id', 'date', 'required_completion_date', 'payment_price', 'discount_price', 'paid_price'].includes(x.key))) adv.open = true;
    errBox.scrollIntoView({ block: 'nearest' });
  }
  function askConfirm() {
    const list = validate(collect(), S.items);
    showErrors(list);
    if (list.length) return;
    S.confirm = true; renderSummary();
    const y = V.root.querySelector('#onConfirmYes'); if (y) y.focus();
  }
  async function submit() {
    const f = collect();
    const list = validate(f, S.items);
    showErrors(list);
    if (list.length) { S.confirm = false; renderSummary(); return; }
    S.busy = true;
    actBox.replaceChildren(el('div', { class: 'muted', id: 'onSaving' }, 'Tworzę zamówienie w Selly…'));
    try {
      if (!S.client && newAccount.checked && !S.accountDone) {
        const cf = { first_name: f.ship_first_name, last_name: f.ship_last_name, email: f.email, phone: f.phone, ship_company: f.ship_company, ship_address: f.ship_address, ship_postcode: f.ship_postcode, ship_city: f.ship_city };
        if (f.invoice_type === 'faktura' && f.invoice_nip) cf.invoice_nip = f.invoice_nip;
        for (const k of Object.keys(cf)) if (!String(cf[k] || '').trim()) delete cf[k];
        try { await api('clients:create', { fields: cf }); S.accountDone = true; }
        catch (e) { if (e.code !== 409 && !/już istnieje/i.test(e.message || '')) throw Object.assign(new Error('Nie udało się założyć konta klienta (zamówienie NIE zostało utworzone): ' + (e.message || 'błąd')), { keep: true }); S.accountDone = true; }
      }
      const date = String(f.date || '').trim();
      const body = payload(f, S.items);
      if (date) body.fields.date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(date) ? date + ':00' : date;
      const r = await api('orders:create', Object.assign(body, { opId: S.opId }));
      V.dirty = false;
      flash('', r && r.replayed ? 'To zamówienie zostało już utworzone wcześniej' + (r.number ? ' (' + r.number + ')' : '') : 'Utworzono zamówienie' + (r && r.number ? ' ' + r.number : ''));
      V.root = null;   // następne wejście w „Nowe zamówienie” = czysty formularz
      go(r && r.id ? '/zamowienia/' + encodeURIComponent(r.id) : '/zamowienia');
    } catch (e) {
      S.busy = false; S.confirm = false;
      errBox.hidden = false;
      errBox.replaceChildren(el('strong', null, e.keep ? e.message : 'Nie utworzono zamówienia: ' + (e.message || 'błąd')),
        e.code === 409 || e.code === 'timeout' ? el('p', { class: 'small' }, 'Zanim spróbujesz ponownie, sprawdź na ', el('a', { href: '#/zamowienia', target: '_blank', rel: 'noopener' }, 'liście zamówień ↗'), ', czy zamówienie nie powstało.') : null);
      renderSummary();
      errBox.scrollIntoView({ block: 'nearest' });
    }
  }

  const root = el('div', { class: 'on-wrap' },
    el('div', { class: 'card' }, pageToolbar({ title: 'Nowe zamówienie', sub: 'Dodaj zamówienie ręcznie: klient, produkty, dostawa i płatność. Pola z * są wymagane.',
      actions: [el('a', { href: '#/zamowienia', class: 'btn-link', id: 'onBack', title: 'Wróć do listy zamówień (niezapisany formularz — z pytaniem)' }, '← Lista zamówień'),
        el('button', { type: 'button', class: 'secondary', id: 'onReset', title: 'Wyczyść formularz i zacznij od nowa', onclick: () => { if (!V.dirty || confirm('Wyczyścić formularz?')) reset(); } }, 'Wyczyść')] })),
    secClient, secItems, secShip, adv,
    el('section', { class: 'card on-sec', id: 'onSecSum' }, el('h3', null, el('span', { class: 'on-step' }, '4'), 'Podsumowanie'), sumBox, errBox, actBox));
  syncInvoice(); renderItems();
  return root;
}
