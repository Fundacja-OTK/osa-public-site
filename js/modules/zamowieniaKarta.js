// Karta zamówienia z edycją (moduł Zamówienia): sekcje edytowalne, pozycje z edycją inline, dodawanie produktu, podsumowanie płatności, faktury.
// Backend: orders:update / orders:updateItem / orders:addItem / orders:invoices / orders:invoiceUpdate / orders:get, products:list (wyszukiwarka produktów).
import { gateWrite, el, flash, money, dateStr, fullName, dl, sellyLink, store, debounce, dateInput } from '../core/ui.js?v=79bd162';
import { api } from '../core/client.js?v=79bd162';
import { invoiceEditor, invNumber, invValue, invStatusPill, isOverdue, issueUrl, printButton } from './zamowieniaFakturyKit.js?v=79bd162';
const gw = e => gateWrite(e, 'zamowienia');   // bez prawa zmian w sekcji: wyszarzone z podpowiedzią (core/ui.js)

const EDIT_KEY = 'osa-ord-edit';
const r2 = n => Math.round(n * 100) / 100;
const num = v => Number(String(v == null ? '' : v).trim().replace(',', '.'));
const isMoney = v => String(v).trim() !== '' && isFinite(num(v)) && num(v) >= 0;
const fmtIn = n => String(r2(n)).replace('.', ',');
const str = v => (v == null ? '' : String(v));
const dayOf = d => (d ? String(d).slice(0, 10) : '');
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ─── Wyszukiwarka produktów (karta: dodawanie pozycji; lista: filtr „Produkt”) ──

/** { node, clear() }; onPick(wiersz z products:list: id, name, code, price, qty, hasVariants). */
export function productPicker({ id, onPick, placeholder, tip }) {
  let seq = 0;
  const list = el('div', { class: 'ord-pick-list', hidden: true, role: 'listbox', 'aria-label': 'Wyniki wyszukiwania produktów' });
  const input = el('input', { type: 'search', id, placeholder: placeholder || 'Szukaj produktu: nazwa, kod, EAN…', 'aria-label': 'Szukaj produktu', autocomplete: 'off',
    title: tip || 'Wpisz co najmniej 2 znaki: nazwę, kod lub EAN produktu', oninput: debounce(() => search(), 250) });
  async function search() {
    const q = input.value.trim(), my = ++seq;
    if (q.length < 2) { list.hidden = true; list.replaceChildren(); return; }
    list.hidden = false; list.replaceChildren(el('div', { class: 'muted small ord-pick-msg' }, 'Szukam…'));
    try {
      const r = await api('products:list', { q, pageSize: 10 });
      if (my !== seq) return;
      const rows = r.rows || [];
      list.replaceChildren(...(rows.length ? rows.map(p => el('button', { type: 'button', role: 'option', class: 'ord-pick-item', 'data-pid': p.id,
        title: 'Wybierz: ' + p.name + (p.code ? ' (' + p.code + ')' : ''), onclick: () => { list.hidden = true; input.value = ''; onPick(p); } },
      el('strong', null, p.name || ('Produkt ' + p.id)), el('span', { class: 'muted small' }, [p.code, p.price != null && p.price !== '' ? money(p.price) + ' zł' : '', p.qty != null ? 'stan: ' + p.qty : ''].filter(Boolean).join(' · ')))) :
        [el('div', { class: 'muted small ord-pick-msg' }, 'Brak produktów pasujących do „' + q + '”.')]));
    } catch (e) { if (my === seq) list.replaceChildren(el('div', { class: 'notice error ord-pick-msg' }, 'Nie udało się wyszukać produktów: ' + (e.message || 'błąd'))); }
  }
  return { node: el('div', { class: 'ord-pick' }, input, list), input, clear: () => { input.value = ''; list.hidden = true; list.replaceChildren(); } };
}

// ─── Sumy ───────────────────────────────────────────────────────────────────

export function orderTotals(o) {
  const items = (o.products || []).reduce((a, p) => a + (isFinite(Number(p.price_total)) && p.price_total !== '' && p.price_total != null ? Number(p.price_total) : (Number(p.price_with_tax) || 0) * (Number(p.quantity) || 0)), 0);
  const delivery = Number(o.delivery_price) || 0, payment = Number(o.payment_price) || 0, discount = Number(o.discount_price) || 0, paid = Number(o.paid_price) || 0;
  const total = r2(items + delivery + payment - discount);
  return { items: r2(items), delivery, payment, discount, total, paid, diff: r2(total - paid) };
}

// ─── Pola formularza ────────────────────────────────────────────────────────

const CHECKS = {
  email: v => (v && !EMAIL.test(v) ? { err: true, msg: 'To nie wygląda na poprawny adres e-mail (np. jan@domena.pl).' } : null),
  money: v => (!isMoney(v) && String(v).trim() !== '' ? { err: true, msg: 'Podaj kwotę jako liczbę nieujemną, np. 12,50.' } : null),
  postcode: v => (v && !/^\d{2}-\d{3}$/.test(v) ? { err: false, msg: 'Kod pocztowy zwykle ma format 00-000 (możesz zapisać mimo to).' } : null),
  nip: v => { const d = String(v || '').replace(/^PL/i, '').replace(/\D/g, ''); return v && d.length !== 10 ? { err: false, msg: 'NIP zwykle ma 10 cyfr (możesz zapisać mimo to).' } : null; },
};

function buildControl(C, f, o) {
  const raw = f.get ? f.get(o) : o[f.k];
  let orig = f.type === 'flag' ? (Number(raw) ? '1' : '0') : f.type === 'date' ? dayOf(raw) : f.type === 'number' ? (raw == null || raw === '' ? '' : fmtIn(Number(raw))) : str(raw);
  const id = 'ordF-' + f.k;
  let ctl;
  if (f.type === 'select') {
    const opts = (f.options(C) || []).map(x => ({ value: String(x.id), label: x.name }));
    if (orig && !opts.some(x => x.value === orig)) opts.push({ value: orig, label: '#' + orig + ' (obecna)' });
    ctl = el('select', { id }, el('option', { value: '' }, '— nie wybrano —'), opts.map(x => el('option', { value: x.value }, x.label)));
    ctl.value = orig;
  } else if (f.type === 'flag') {
    ctl = el('input', { type: 'checkbox', id, checked: orig === '1' });
  } else if (f.type === 'textarea') {
    ctl = el('textarea', { id, rows: '3', class: f.cls || null }, orig);
  } else {
    ctl = f.type === 'date' ? dateInput({ id, value: orig, label: f.label, title: f.tip }) : el('input', { type: 'text', id, inputmode: f.type === 'number' ? 'decimal' : null, autocomplete: 'off', value: orig, list: f.list || null });
  }
  const val = () => (f.type === 'flag' ? (ctl.checked ? '1' : '0') : f.type === 'select' || f.type === 'date' ? ctl.value : ctl.value.trim());
  const changed = () => {
    const v = val();
    if (f.type === 'number') { const a = v === '' ? '' : r2(num(v)), b = orig === '' ? '' : r2(num(orig)); return a !== b && !(a === '' && b === ''); }
    if (f.type === 'select') return v !== '' && v !== orig;
    return v !== orig;
  };
  const send = () => { const v = val(); return f.type === 'number' ? (v === '' ? 0 : r2(num(v))) : f.type === 'flag' ? (v === '1' ? 1 : 0) : f.type === 'select' ? (f.text ? v : Number(v)) : v; };
  return { ctl, val, changed, send, orig, f };
}

// ─── Podgląd zmian przed zapisem ────────────────────────────────────────────

const EMPTY = '(puste)';
/** Wartość pola w czytelnej postaci (podgląd zmian): etykieta opcji, tak/nie, kwota w zł. */
function showVal(c, v) {
  const f = c.f;
  if (f.type === 'flag') return v === '1' ? 'tak' : 'nie';
  if (v === '' || v == null) return EMPTY;
  if (f.type === 'select') { const o = [...c.ctl.options].find(x => x.value === v); return o ? o.textContent : v; }
  if (f.type === 'number') return money(num(v)) + ' zł';
  return String(v);
}

/**
 * Podgląd zmian: lista „co: było → będzie” + „Zatwierdź i zapisz w Selly” / „Wróć do edycji”.
 * rows: [[etykieta, było, będzie]]; onConfirm() — błąd (wyjątek) zostaje w podglądzie, można ponowić albo wrócić.
 */
export function previewBox(key, rows, { onConfirm, onBack, note }) {
  const err = el('div', { class: 'notice error', role: 'alert', hidden: true });
  const back = el('button', { type: 'button', class: 'secondary', id: 'ordBackEdit-' + key, title: 'Wraca do formularza — nic nie zostało zapisane', onclick: () => onBack() }, 'Wróć do edycji');
  const ok = gw(el('button', { type: 'button', class: 'primary', id: 'ordConfirm-' + key, title: 'Zapisuje w Selly dokładnie zmiany z listy powyżej' }, 'Zatwierdź i zapisz w Selly'));
  ok.addEventListener('click', async () => {
    const label = ok.textContent;
    ok.disabled = back.disabled = true; ok.textContent = 'Zapisuję…'; err.hidden = true;
    try { await onConfirm(); } catch (e) {
      err.textContent = 'Nie udało się zapisać: ' + (e.message || 'błąd') + '. Nic nie zostało utracone — spróbuj ponownie albo wróć do edycji.';
      err.hidden = false; ok.disabled = back.disabled = false; ok.textContent = label;
    }
  });
  const box = el('div', { class: 'ord-preview', id: 'ordPreview-' + key, role: 'region', 'aria-label': 'Podgląd zmian przed zapisem' },
    el('div', { class: 'ord-preview-h' }, 'Sprawdź zmiany przed zapisem (' + rows.length + ')'),
    el('ul', { class: 'ord-diff' }, rows.map(([label, was, will]) => el('li', null, el('span', { class: 'ord-diff-l' }, label), ' ',
      el('span', { class: 'ord-diff-old', title: 'Obecna wartość w Selly' }, String(was)), el('span', { class: 'ord-diff-arr', 'aria-label': 'zmieni się na' }, ' → '),
      el('strong', { class: 'ord-diff-new', title: 'Nowa wartość po zapisie' }, String(will))))),
    note || null, err, el('div', { class: 'ord-actions' }, ok, back));
  // Podgląd na środek ekranu (formularz znika, strona się przesuwa; przyklejony nagłówek nie może go zasłonić) i fokus na „Zatwierdź”
  setTimeout(() => { try { box.scrollIntoView({ block: 'center' }); ok.focus({ preventScroll: true }); } catch (e) { /* bez przewijania */ } }, 0);
  return box;
}

/** Sekcja formularza: podgląd z przyciskiem „Edytuj” albo od razu pola (tryb „Domyślnie w trybie edycji”). cfg: { id, title, sub, fields, view(o), extraView(o), attention } */
function section(C, cfg) {
  const host = el('div', { class: 'card ord-sec' + (cfg.attention ? ' ord-sec-attn' : ''), id: 'ordSec-' + cfg.id });
  let editing = C.editDefault, ctls = [], errBox = null, saveBtn = null, flag = null;
  const sec = { host, dirty: () => editing && ctls.some(c => c.changed()), render, setEditing };

  const checkOne = c => {
    const chk = c.f.check ? CHECKS[c.f.check](c.val()) : null;
    if (c.warn) { c.warn.textContent = chk ? chk.msg : ''; c.warn.className = 'ord-warn' + (chk && chk.err ? ' err' : ''); c.warn.hidden = !chk; }
    return chk;
  };
  const refreshState = () => {
    const n = ctls.filter(c => c.changed()).length, blocked = ctls.some(c => { const k = checkOne(c); return k && k.err; });
    if (saveBtn) { saveBtn.disabled = !n || blocked; saveBtn.title = !n ? 'Nie ma zmian do zapisania' : blocked ? 'Popraw zaznaczone pola, aby zapisać' : 'Pokaże podgląd zmienionych pól (' + n + ') — zapis w Selly dopiero po zatwierdzeniu'; }
    if (flag) flag.hidden = !n;
    const asShip = ctls.find(c => c.f.k === 'invoice_as_ship');
    if (asShip) for (const c of ctls) if (/^invoice_(company|nip|first|last|post|city|addr)/.test(c.f.k)) { c.ctl.disabled = asShip.ctl.checked; c.ctl.title = asShip.ctl.checked ? 'Wyłączone: dane do faktury są takie same jak adres wysyłki' : ''; }
  };
  function setEditing(on) { editing = on; render(); }

  // Zapis po potwierdzeniu w podglądzie; błąd → wyjątek (zostaje w podglądzie z możliwością ponowienia)
  async function save(changed) {
    const fields = {};
    for (const c of changed) fields[c.f.k] = c.send();
    await api('orders:update', { id: C.id, fields });
    flash('', 'Zapisano w Selly: ' + cfg.title.toLowerCase() + ' (' + changed.length + ' ' + (changed.length === 1 ? 'pole' : 'pól') + ')');
    editing = C.editDefault;
    try { await C.refresh(); } catch (e) { /* zapis się udał; dane odświeży ponowne otwarcie karty */ }
    sec.render();
  }

  function render() {
    const o = C.o;
    const head = (actions) => el('div', { class: 'card-head ord-sec-head' }, el('div', null, el('h2', null, cfg.title), cfg.sub ? el('div', { class: 'sub' }, cfg.sub) : null), actions);
    if (!editing) {
      ctls = [];
      host.replaceChildren(head(gw(el('button', { type: 'button', class: 'secondary', id: 'ordEdit-' + cfg.id, title: 'Edytuj: ' + cfg.title.toLowerCase() + ' (przed zapisem w Selly pokażemy podgląd zmian)', onclick: () => setEditing(true) }, 'Edytuj'))),
        cfg.view(o), cfg.extraView ? cfg.extraView(o) : null);
      return;
    }
    ctls = cfg.fields.map(f => buildControl(C, f, o));
    errBox = el('div', { class: 'notice error', role: 'alert', hidden: true });
    flag = el('span', { class: 'ord-dirty tip', hidden: true, title: 'W tej sekcji są niezapisane zmiany' }, '● niezapisane zmiany');
    saveBtn = gw(el('button', { type: 'button', class: 'primary', id: 'ordSave-' + cfg.id, onclick: () => showPreview() }, 'Zapisz…'));
    const cancel = el('button', { type: 'button', class: 'secondary', id: 'ordCancel-' + cfg.id, title: 'Odrzuć zmiany w tej sekcji', onclick: () => setEditing(false) }, 'Anuluj');
    const pv = el('div', { hidden: true });
    let form = null, actions = null;
    function showPreview() {
      const changed = ctls.filter(c => c.changed());
      if (!changed.length || ctls.some(c => { const k = checkOne(c); return k && k.err; })) { refreshState(); return; }
      errBox.hidden = true; form.hidden = actions.hidden = true; pv.hidden = false;
      pv.replaceChildren(previewBox(cfg.id, changed.map(c => [c.f.label, showVal(c, c.orig), showVal(c, c.val())]), {
        onConfirm: () => save(changed),
        onBack: () => { pv.hidden = true; pv.replaceChildren(); form.hidden = actions.hidden = false; refreshState(); },
      }));
    }
    form = el('div', { class: 'ord-form' }, ctls.map(c => {
      c.warn = el('div', { class: 'ord-warn', hidden: true, role: 'status' });
      const lab = el('span', { class: 'ord-f-l' + (c.f.tip ? ' tip' : '') }, c.f.label);
      const wrap = el('label', { class: 'ord-f' + (c.f.wide ? ' wide' : '') + (c.f.type === 'flag' ? ' flag' : ''), title: c.f.tip || null }, c.f.type === 'flag' ? [c.ctl, lab] : [lab, c.ctl]);
      c.ctl.addEventListener('input', refreshState); c.ctl.addEventListener('change', refreshState);
      return el('div', { class: 'ord-fw' + (c.f.wide ? ' wide' : '') }, wrap, c.f.after ? c.f.after(c, C) : null, c.warn);
    }));
    actions = el('div', { class: 'ord-actions' }, saveBtn, cancel);
    host.replaceChildren(head(flag), errBox, form, actions, pv);
    refreshState();
  }
  render();
  return sec;
}

// ─── Pozycje ────────────────────────────────────────────────────────────────

function itemsCard(C) {
  const host = el('div', { class: 'card', id: 'ordItemsCard' });
  let editing = C.editDefault, rows = [], addOpen = false;
  const sec = { host, dirty: () => editing && rows.some(r => r.fields()), render, setEditing: on => { editing = on; render(); } };
  const vatName = id => { const v = (C.meta.vat || []).find(x => String(x.id) === String(id)); return v ? v.name : (id == null || id === '' ? '—' : '#' + id); };

  function mkRow(p, idx) {
    const price0 = Number(p.price_with_tax) || 0, qty0 = Number(p.quantity) || 0;
    const hasBase = p.pricetax_without_discount != null && p.pricetax_without_discount !== '' && Number(p.pricetax_without_discount) > 0;
    const row = { p, base: hasBase ? Number(p.pricetax_without_discount) : price0, qty0, price0 };
    const disc0 = row.base > price0 ? r2((1 - price0 / row.base) * 100) : 0;
    row.disc0 = disc0;
    const pid = p.product_order_id;
    const tag = k => 'ordItem' + k + '-' + pid;
    row.qty = el('input', { type: 'text', inputmode: 'numeric', class: 'ord-in qty', id: tag('Qty'), value: String(qty0), 'aria-label': 'Nowa ilość: ' + (p.name || ''), title: 'Nowa ilość sztuk (liczba całkowita większa od 0)' });
    row.disc = el('input', { type: 'text', inputmode: 'decimal', class: 'ord-in disc', id: tag('Disc'), value: disc0 ? fmtIn(disc0) : '0', 'aria-label': 'Rabat %: ' + (p.name || ''), title: 'Rabat w procentach od ceny przed rabatem (' + money(row.base) + ' zł). Zmiana rabatu od razu przelicza cenę.' });
    row.price = el('input', { type: 'text', inputmode: 'decimal', class: 'ord-in price', id: tag('Price'), value: fmtIn(price0), 'aria-label': 'Cena brutto: ' + (p.name || ''), title: 'Cena jednostkowa brutto po rabacie. Zmiana ceny od razu przelicza rabat.' });
    row.vat = el('select', { class: 'ord-in vat', id: tag('Vat'), 'aria-label': 'Stawka VAT: ' + (p.name || ''), title: 'Stawka VAT pozycji' },
      el('option', { value: '' }, p.vat_rate_id == null || p.vat_rate_id === '' ? '—' : vatName(p.vat_rate_id)), (C.meta.vat || []).filter(v => String(v.id) !== String(p.vat_rate_id)).map(v => el('option', { value: String(v.id) }, v.name)));
    row.vat.value = '';
    if (p.vat_rate_id != null && p.vat_rate_id !== '') { row.vat.firstChild.value = String(p.vat_rate_id); row.vat.value = String(p.vat_rate_id); }
    row.comment = el('input', { type: 'text', class: 'ord-in cmt', id: tag('Cmt'), value: str(p.personel_comment), 'aria-label': 'Komentarz: ' + (p.name || ''), title: 'Wewnętrzny komentarz do pozycji (niewidoczny dla klienta)' });
    row.nv = el('td', { class: 'n nw ord-nv' });
    row.err = el('div', { class: 'ord-warn err', hidden: true });
    const calc = () => { const q = parseInt(row.qty.value, 10), pr = num(row.price.value); row.nv.textContent = q > 0 && isMoney(row.price.value) ? money(q * pr) : '—'; };
    row.disc.addEventListener('input', () => { const d = num(row.disc.value); if (row.disc.value.trim() !== '' && isFinite(d) && d >= 0 && d <= 100) { row.price.value = fmtIn(row.base * (1 - d / 100)); } after(); });
    row.price.addEventListener('input', () => {
      if (isMoney(row.price.value)) { const pr = num(row.price.value); if (pr > row.base) row.base = pr; row.disc.value = row.base > 0 ? fmtIn((1 - pr / row.base) * 100) : '0'; } after();
    });
    for (const x of [row.qty, row.vat, row.comment]) { x.addEventListener('input', after); x.addEventListener('change', after); }
    function after() { calc(); row.tr.classList.toggle('chg', !!row.fields()); updateFoot(); sec.onChange && sec.onChange(); }
    row.fields = () => {
      const f = {}, q = parseInt(row.qty.value, 10), pr = num(row.price.value);
      if (String(q) === row.qty.value.trim() && q > 0 && q !== qty0) f.quantity = q;
      if (isMoney(row.price.value) && r2(pr) !== r2(price0)) { f.price_with_tax = r2(pr); if (!hasBase || r2(row.base) !== r2(Number(p.pricetax_without_discount))) f.pricetax_without_discount = r2(row.base); }
      if (row.vat.value !== '' && row.vat.value !== String(p.vat_rate_id == null ? '' : p.vat_rate_id)) f.vat_rate_id = Number(row.vat.value);
      if (row.comment.value.trim() !== str(p.personel_comment)) f.personel_comment = row.comment.value.trim();
      return Object.keys(f).length ? f : null;
    };
    row.invalid = () => {
      const q = parseInt(row.qty.value, 10);
      if (!(String(q) === row.qty.value.trim() && q > 0)) return 'Ilość musi być liczbą całkowitą większą od 0 (usunięcie pozycji — w panelu Selly).';
      if (!isMoney(row.price.value)) return 'Cena musi być liczbą nieujemną, np. 12,50.';
      const d = num(row.disc.value); if (!isFinite(d) || d < 0 || d > 100) return 'Rabat musi być między 0 a 100%.';
      return '';
    };
    const nm = el('div', null, el('div', { class: 'cell-name' }, p.name || '—'),
      el('div', { class: 'cell-sub' }, [p.producer_code || p.symbol, textFeat(p.variant_features)].filter(Boolean).join(' · ')), row.err);
    row.tr = el('tr', { 'data-pid': pid },
      el('td', { class: 'n' }, String(idx + 1)), el('td', null, nm), el('td', { class: 'n' }, str(p.quantity)),
      editing ? el('td', null, row.qty) : null,
      editing ? el('td', null, row.disc) : el('td', { class: 'n' }, disc0 ? fmtIn(disc0) + '%' : ''),
      editing ? el('td', null, row.price) : el('td', { class: 'n nw' }, money(p.price_with_tax)),
      editing ? el('td', null, row.vat) : el('td', null, vatName(p.vat_rate_id)),
      el('td', { class: 'n nw' }, money(p.price_total)),
      editing ? row.nv : null,
      editing ? el('td', null, row.comment) : el('td', null, str(p.personel_comment)),
      el('td', null, (p.warehouses || []).map(w => (w.name || w.warehouse_id) + ' × ' + w.quantity).join(', ')));
    calc();
    return row;
  }
  const textFeat = v => (v == null ? '' : typeof v === 'object' ? (Array.isArray(v) ? v.map(textFeat).filter(Boolean).join(', ') : Object.values(v).map(textFeat).filter(Boolean).join(', ')) : String(v));

  let foot = null;
  function updateFoot() {
    if (!foot) return;
    const saved = orderTotals(C.o).items;
    const nu = rows.reduce((a, r) => { const q = parseInt(r.qty.value, 10), pr = num(r.price.value); return a + (q > 0 && isMoney(r.price.value) ? q * pr : (Number(r.p.price_total) || 0)); }, 0);
    const changed = editing && rows.some(r => r.fields());
    foot.replaceChildren(el('td', { colspan: editing ? '7' : '6', class: 'n' }, el('strong', null, 'Razem pozycje')), el('td', { class: 'n nw' }, el('strong', null, money(saved))),
      editing ? el('td', { class: 'n nw', title: 'Suma pozycji po wprowadzonych (jeszcze niezapisanych) zmianach' }, changed ? el('strong', { id: 'ordItemsNew' }, money(r2(nu))) : '') : null, el('td', { colspan: '2' }));
  }

  // Opis zmian pozycji do podglądu: [etykieta, było, będzie]
  function diffRows(r) {
    const f = r.fields() || {}, nm = r.p.name || ('Pozycja ' + r.p.product_order_id), out = [];
    if ('quantity' in f) out.push([nm + ' — ilość', String(r.qty0), String(f.quantity)]);
    if ('price_with_tax' in f) {
      const d = num(r.disc.value);
      if (isFinite(d) && r2(d) !== r2(r.disc0)) out.push([nm + ' — rabat', fmtIn(r.disc0) + '%', fmtIn(d) + '%']);
      out.push([nm + ' — cena brutto', money(r.price0) + ' zł', money(f.price_with_tax) + ' zł']);
    }
    if ('vat_rate_id' in f) out.push([nm + ' — VAT', vatName(r.p.vat_rate_id), vatName(f.vat_rate_id)]);
    if ('personel_comment' in f) out.push([nm + ' — komentarz', str(r.p.personel_comment) || EMPTY, f.personel_comment || EMPTY]);
    return out;
  }
  const lockInputs = on => {
    for (const r of rows) for (const x of [r.qty, r.disc, r.price, r.vat, r.comment]) x.disabled = on;
    for (const x of host.querySelectorAll('#ordBulkItems input, #ordBulkItems select, #ordBulkItems button')) x.disabled = on;
  };

  // „Zapisz zmiany w pozycjach…” → walidacja → podgląd (pola zablokowane) → zatwierdzenie → zapis
  function preview(actions, pv, box) {
    const todo = rows.filter(r => r.fields());
    let bad = 0;
    for (const r of todo) { const m = r.invalid(); r.err.hidden = !m; r.err.textContent = m; if (m) bad++; }
    if (bad) { flash('', 'Popraw zaznaczone pozycje, aby zapisać'); return; }
    if (!todo.length) return;
    box.hidden = true; lockInputs(true); actions.hidden = true; pv.hidden = false;
    pv.replaceChildren(previewBox('items', todo.flatMap(diffRows), {
      note: todo.length > 1 ? el('p', { class: 'muted small' }, 'Selly zapisuje pozycje po jednej (' + todo.length + ' zapisy). Jeśli któraś się nie zapisze, pokażemy którą.') : null,
      onBack: () => { pv.hidden = true; pv.replaceChildren(); actions.hidden = false; lockInputs(false); },
      onConfirm: () => runSave(todo),
    }));
  }

  async function runSave(todo) {
    const fails = []; let done = 0;
    for (const r of todo) {
      try { await api('orders:updateItem', { id: C.id, productOrderId: String(r.p.product_order_id), fields: r.fields() }); done++; } catch (e) { fails.push((r.p.name || r.p.product_order_id) + ' — ' + (e.message || 'błąd')); }
    }
    if (!done) throw new Error(fails.join('; '));   // nic się nie zapisało → błąd zostaje w podglądzie
    flash('', 'Pozycje: zapisano ' + done + ' z ' + todo.length + (fails.length ? ', błędy: ' + fails.length : ''));
    try { await C.refresh(); } catch (e) { /* karta zostaje; dane odświeży ponowne otwarcie */ }
    editing = C.editDefault; render();
    if (fails.length) { const b = host.querySelector('#ordItemsMsg'); if (b) { b.hidden = false; b.replaceChildren(el('strong', null, 'Nie zapisano ' + fails.length + ' z ' + todo.length + ' pozycji:'), el('ul', null, fails.map(f => el('li', null, f)))); } }
  }

  // „Zmień wszystkie pozycje naraz” (jak „Ustaw rabat na produkty” i „Zmień VAT” w Selly) — wypełnia pola, zapis jak zwykle (podgląd → zatwierdzenie)
  function bulkTools() {
    const disc = el('input', { type: 'text', inputmode: 'decimal', id: 'ordBulkDisc', class: 'ord-in disc', placeholder: '%', 'aria-label': 'Rabat % dla wszystkich pozycji' });
    const vat = el('select', { id: 'ordBulkVat', class: 'ord-in vat', 'aria-label': 'Stawka VAT dla wszystkich pozycji' }, el('option', { value: '' }, '— wybierz —'), (C.meta.vat || []).map(v => el('option', { value: String(v.id) }, v.name)));
    const fire = (x, ev) => x.dispatchEvent(new Event(ev, { bubbles: true }));
    return el('details', { class: 'ord-bulk-items', id: 'ordBulkItems' },
      el('summary', { title: 'Ustaw ten sam rabat albo tę samą stawkę VAT we wszystkich pozycjach naraz. Pola wypełnią się od razu, a zapis — jak zwykle, po podglądzie zmian.' }, 'Zmień wszystkie pozycje naraz ▾'),
      el('div', { class: 'ord-add-row' },
        el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l tip', title: 'Rabat w procentach liczony od ceny przed rabatem każdej pozycji' }, 'Rabat % na wszystkie'), disc),
        el('button', { type: 'button', class: 'secondary small-btn', id: 'ordBulkDiscApply', title: 'Wpisuje ten rabat we wszystkich pozycjach i przelicza ich ceny', onclick: () => {
          const d = num(disc.value);
          if (disc.value.trim() === '' || !isFinite(d) || d < 0 || d > 100) { flash('', 'Rabat musi być liczbą od 0 do 100'); return; }
          for (const r of rows) { r.disc.value = fmtIn(d); fire(r.disc, 'input'); }
        } }, 'Przelicz'),
        el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l' }, 'VAT na wszystkie'), vat),
        el('button', { type: 'button', class: 'secondary small-btn', id: 'ordBulkVatApply', title: 'Ustawia wybraną stawkę VAT we wszystkich pozycjach (kwoty netto przeliczy Selly)', onclick: () => {
          if (!vat.value) { flash('', 'Wybierz stawkę VAT'); return; }
          for (const r of rows) { if (![...r.vat.options].some(o => o.value === vat.value)) r.vat.append(el('option', { value: vat.value }, vatName(vat.value))); r.vat.value = vat.value; fire(r.vat, 'change'); }
        } }, 'Ustaw')));
  }

  function addPanel() {
    const box = el('div', { class: 'ord-add', id: 'ordAddBox' });
    const picked = el('div', { class: 'ord-add-form', hidden: true });
    let prod = null;
    const picker = productPicker({ id: 'ordAddSearch', onPick: p => {
      prod = p; picked.hidden = false;
      qty.value = '1'; price.value = p.price != null && p.price !== '' ? fmtIn(Number(p.price)) : ''; cmt.value = ''; vat.value = '';
      title.textContent = p.name + (p.code ? ' (' + p.code + ')' : '');
      varNote.hidden = !Number(p.hasVariants);
      err.hidden = true; qty.focus();
    } });
    const title = el('strong', { id: 'ordAddName' });
    const varNote = el('div', { class: 'notice warn', hidden: true }, 'Ten produkt ma warianty. Panel dodaje pozycję bez wyboru wariantu — jeśli Selly go wymaga, dodaj tę pozycję w panelu Selly.');
    const qty = el('input', { type: 'text', inputmode: 'numeric', id: 'ordAddQty', class: 'ord-in qty', value: '1', 'aria-label': 'Ilość' });
    const price = el('input', { type: 'text', inputmode: 'decimal', id: 'ordAddPrice', class: 'ord-in price', 'aria-label': 'Cena brutto', title: 'Cena brutto za sztukę — domyślnie cena produktu; puste = cena z Selly' });
    const vat = el('select', { id: 'ordAddVat', class: 'ord-in vat', 'aria-label': 'Stawka VAT', title: 'Puste = stawka domyślna produktu w Selly' }, el('option', { value: '' }, 'domyślna'), (C.meta.vat || []).map(v => el('option', { value: String(v.id) }, v.name)));
    const cmt = el('input', { type: 'text', id: 'ordAddCmt', class: 'ord-in cmt', placeholder: 'Komentarz (opcjonalnie)', 'aria-label': 'Komentarz do pozycji' });
    const err = el('div', { class: 'notice error', role: 'alert', hidden: true });
    const submit = gw(el('button', { type: 'button', class: 'primary', id: 'ordAddSubmit', onclick: async () => {
      const q = parseInt(qty.value, 10);
      if (!(String(q) === qty.value.trim() && q > 0)) { err.textContent = 'Ilość musi być liczbą całkowitą większą od 0.'; err.hidden = false; return; }
      if (price.value.trim() !== '' && !isMoney(price.value)) { err.textContent = 'Cena musi być liczbą nieujemną.'; err.hidden = false; return; }
      const fields = { product_id: Number(prod.id), quantity: q };
      if (price.value.trim() !== '') fields.price_with_tax = r2(num(price.value));
      if (vat.value) fields.vat_rate_id = Number(vat.value);
      if (cmt.value.trim()) fields.personel_comment = cmt.value.trim();
      submit.disabled = true; err.hidden = true;
      try { await api('orders:addItem', { id: C.id, fields }); flash('', 'Dodano produkt do zamówienia'); addOpen = false; await C.refresh(); render(); }
      catch (e) { err.textContent = 'Nie udało się dodać produktu: ' + (e.message || 'błąd'); err.hidden = false; submit.disabled = false; }
    } }, 'Dodaj do zamówienia'));
    picked.append(title, varNote, el('div', { class: 'ord-add-row' },
      el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l' }, 'Ilość'), qty), el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l tip', title: 'Domyślnie cena produktu z katalogu' }, 'Cena brutto (zł)'), price),
      el('label', { class: 'ord-f' }, el('span', { class: 'ord-f-l' }, 'Stawka VAT'), vat), el('label', { class: 'ord-f grow' }, el('span', { class: 'ord-f-l' }, 'Komentarz'), cmt)), err, el('div', { class: 'ord-actions' }, submit));
    box.append(el('div', { class: 'ord-f-l' }, 'Dodaj produkt do zamówienia'), picker.node, picked);
    return box;
  }

  function render() {
    const prods = C.o.products || [];
    rows = prods.map(mkRow);
    const addBtn = gw(el('button', { type: 'button', class: 'secondary', id: 'ordAddToggle', disabled: sec.dirty(), title: 'Wyszukaj produkt i dodaj go jako nową pozycję zamówienia', onclick: () => { addOpen = !addOpen; render(); } }, addOpen ? 'Zwiń dodawanie' : 'Dodaj produkt'));
    const msg = el('div', { class: 'notice warn', id: 'ordItemsMsg', hidden: true });
    const pv = el('div', { hidden: true });
    let actions = null;
    const saveBtn = gw(el('button', { type: 'button', class: 'primary', id: 'ordSave-items', disabled: true, onclick: () => preview(actions, pv, msg) }, 'Zapisz zmiany w pozycjach…'));
    const dirtyFlag = el('span', { class: 'ord-dirty tip', hidden: true, title: 'W pozycjach są niezapisane zmiany' }, '● niezapisane zmiany');
    sec.onChange = () => {
      const n = rows.filter(r => r.fields()).length;
      saveBtn.disabled = !n; dirtyFlag.hidden = !n; addBtn.disabled = !!n;
      saveBtn.title = n ? 'Pokaże podgląd zmian w pozycjach (' + n + ') — zapis w Selly dopiero po zatwierdzeniu' : 'Nie ma zmian do zapisania';
      addBtn.title = n ? 'Najpierw zapisz lub anuluj zmiany w pozycjach' : 'Wyszukaj produkt i dodaj go jako nową pozycję zamówienia';
    };
    const th = (label, tip, cls, tipped) => el('th', { class: cls || null }, el('span', { title: tip, class: tipped ? 'tip' : null }, label));
    const head = el('tr', null, th('Nr', 'Numer pozycji w zamówieniu', 'n'), th('Produkt', 'Nazwa produktu, kod i wariant'),
      th('Ilość', 'Zamówiona liczba sztuk (zapisana w Selly)', 'n', true), editing ? th('Nowa ilość', 'Wpisz nową ilość — zapisze się po kliknięciu „Zapisz zmiany w pozycjach”', null, true) : null,
      th('Rabat %', editing ? 'Rabat od ceny przed rabatem. Zmiana rabatu od razu przelicza cenę, a zmiana ceny — rabat.' : 'Rabat od ceny przed rabatem', editing ? null : 'n', true),
      th('Cena brutto (zł)', 'Cena jednostkowa brutto po rabacie', editing ? null : 'n'), th('VAT', 'Stawka VAT pozycji'),
      th('Wartość (zł)', 'Zapisana wartość pozycji: cena razy ilość', 'n', true), editing ? th('Nowa wartość (zł)', 'Wartość po wprowadzonych zmianach (liczona na żywo, jeszcze niezapisana)', 'n', true) : null,
      th('Komentarz', 'Wewnętrzny komentarz do pozycji'), th('Magazyn wg Selly', 'Z którego magazynu Selly pobiera towar (według przypisania w Selly, nie według ruchów z panelu)', null, true));
    foot = el('tr');
    const body = el('tbody', null, rows.map(r => r.tr));
    updateFoot();
    host.replaceChildren(
      el('div', { class: 'card-head ord-sec-head' }, el('div', null, el('h2', null, 'Pozycje (' + prods.length + ')'),
        editing ? el('div', { class: 'sub' }, 'Zmień ilość, rabat, cenę, VAT lub komentarz — wartości przeliczają się na żywo. ',
          sellyLink('Usunięcie pozycji — w panelu Selly ↗', C.sellyUrl, 'API Selly nie pozwala usuwać pozycji zamówienia — otwiera to zamówienie w panelu Selly w nowej karcie')) : null),
      el('div', { class: 'ord-head-actions' }, dirtyFlag, addBtn, editing ? null : gw(el('button', { type: 'button', class: 'secondary', id: 'ordEdit-items', title: 'Edytuj pozycje: ilość, cenę, rabat, VAT, komentarz', disabled: !prods.length, onclick: () => sec.setEditing(true) }, 'Edytuj pozycje')))),
      addOpen ? addPanel() : null, editing && prods.length > 1 ? bulkTools() : null, msg,
      prods.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'ordItems' }, el('thead', null, head), body, el('tfoot', null, foot))) : el('div', { class: 'empty' }, 'Zamówienie nie ma pozycji.'),
      editing && prods.length ? (actions = el('div', { class: 'ord-actions' }, saveBtn, el('button', { type: 'button', class: 'secondary', id: 'ordCancel-items', title: 'Odrzuć niezapisane zmiany w pozycjach', onclick: () => sec.setEditing(false) }, 'Anuluj'))) : null, pv);
    sec.onChange();
  }
  render();
  return sec;
}

// ─── Podsumowanie płatności ─────────────────────────────────────────────────

function totalsCard(C) {
  const host = el('div', { class: 'card', id: 'ordTotals' });
  function render() {
    const t = orderTotals(C.o), tip = (label, text) => el('span', { class: 'tip', title: text }, label);
    let verdict;
    if (Math.abs(t.diff) < 0.005) verdict = el('strong', { class: 'ord-ok', id: 'ordPayState' }, 'Opłacone w całości');
    else if (t.diff > 0) verdict = el('strong', { class: 'ord-under', id: 'ordPayState', title: 'Wartość zamówienia jest większa niż kwota zapłacona' }, 'Niedopłata: ' + money(t.diff) + ' zł');
    else verdict = el('strong', { class: 'ord-over', id: 'ordPayState', title: 'Zapłacono więcej niż wartość zamówienia' }, 'Nadpłata: ' + money(-t.diff) + ' zł');
    host.replaceChildren(el('div', { class: 'card-head' }, el('h2', null, 'Podsumowanie płatności'), el('div', { class: 'sub' }, 'Liczone z zapisanych danych zamówienia (po zapisie zmian odświeża się samo).')),
      dl([[tip('Pozycje (zł)', 'Suma wartości wszystkich pozycji'), money(t.items)], [tip('Dostawa (zł)', 'Koszt dostawy'), money(t.delivery)],
        t.payment ? [tip('Koszt płatności (zł)', 'Dopłata za wybrany sposób płatności (np. pobranie)'), money(t.payment)] : null,
        [tip('Rabat (zł)', 'Rabat na całe zamówienie — odejmowany od sumy'), t.discount ? '− ' + money(t.discount) : money(0)],
        [tip('Razem do zapłaty (zł)', 'Pozycje + dostawa + koszt płatności − rabat'), el('strong', { id: 'ordTotalSum' }, money(t.total))], [tip('Zapłacono (zł)', 'Kwota, którą Selly uznaje za zapłaconą'), el('span', { id: 'ordPaidSum' }, money(t.paid))], ['Stan', verdict]]));
  }
  render();
  return { host, render, dirty: () => false, setEditing: () => {} };
}

// ─── Faktury ────────────────────────────────────────────────────────────────

function invoicesCard(C) {
  const host = el('div', { class: 'card', id: 'ordInvoices' });
  const pick = (inv, keys) => { for (const k of keys) if (inv[k] != null && inv[k] !== '') return inv[k]; return ''; };
  // Wystawianie zostaje w Selly: POST /api/orders/{id}/invoices wymaga podania numeru i danych sprzedawcy, a numerację prowadzi Selly
  // (numer nadany przez API mógłby się powtórzyć albo wyprzedzić licznik Selly). Panel: odczyt, rozliczenie, wydruk.
  const admin = String(C.sellyUrl || '').split('?')[0];
  const links = el('div', { class: 'ord-actions' },
    sellyLink('Wystaw fakturę w Selly ↗', issueUrl(admin, C.id), 'Otwiera w nowej karcie ekran Selly „Utworzenie faktury do zamówienia” dla tego zamówienia. To Selly nadaje kolejny numer i wpisuje dane sprzedawcy — dlatego wystawianie zostaje w Selly. Po zapisie wróć tu i kliknij „Odśwież”.'),
    el('a', { href: '#/zamowienia/faktury', class: 'btn-link', id: 'ordInvAll', title: 'Lista faktur ze wszystkich zamówień: filtry, rozliczenia, eksport' }, 'Wszystkie faktury →'));
  const refresh = el('button', { type: 'button', class: 'small-btn secondary', id: 'ordInvRefresh', title: 'Pobiera faktury tego zamówienia z Selly jeszcze raz (np. po wystawieniu faktury w Selly)', onclick: () => load() }, 'Odśwież');
  const head = el('div', { class: 'card-head' }, el('h2', null, 'Faktury i paragon'), el('div', { class: 'sub' }, 'Dokumenty sprzedaży tego zamówienia z Selly: wydruk i rozliczenie.'), refresh);
  const o = C.o || {};
  const receipt = o.receipt_number ? dl([[el('span', { class: 'tip', title: 'Numer paragonu zapisany w zamówieniu w Selly' }, 'Paragon'), el('span', { id: 'ordReceipt' }, String(o.receipt_number) + (o.receipt_date ? ' (' + dayOf(o.receipt_date) + ')' : ''))]]) : null;
  const editHost = el('div', { id: 'ordInvEditHost' });
  async function load() {
    host.replaceChildren(head, receipt, el('p', { class: 'muted small' }, 'Pobieram faktury…'));
    editHost.replaceChildren();
    try {
      const r = await api('orders:invoices', { id: C.id });
      const list = r.invoices || [];
      const cols = [['Numer', 'Numer faktury (prefiks + numer + sufiks)'], ['Data', 'Data wystawienia'], ['Wartość (zł)', 'Wartość faktury (brutto)'],
        ['Zapłacono (zł)', 'Kwota zapłacona za fakturę (pole „Zapłacono za fakturę” w Selly)'], ['Termin', 'Termin płatności z faktury'], ['Status', 'Stan rozliczenia faktury w Selly'], ['Działania', 'Działania']];
      const openEdit = inv => editHost.replaceChildren(invoiceEditor({ orderId: C.id, inv, key: 'c' + inv.invoice_id,
        onSaved: () => load(), onClose: () => editHost.replaceChildren() }));
      host.replaceChildren(head, receipt, list.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'ordInvTable' }, el('thead', null, el('tr', null, cols.map(([h, t], i) => el('th', { class: [2, 3].includes(i) ? 'n' : null }, el('span', { title: t, class: t !== h ? 'tip' : null }, h))))),
        el('tbody', null, list.map(inv => { const v = invValue(inv) ?? pick(inv, ['price', 'total', 'value']);
          return el('tr', { 'data-inv': String(inv.invoice_id) }, el('td', { class: 'nw' }, invNumber(inv)),
            el('td', { class: 'nw' }, dateStr(pick(inv, ['created_at', 'date', 'issue_date', 'invoice_date', 'created']))), el('td', { class: 'n nw' }, v === '' || v == null ? '' : money(v)),
            el('td', { class: 'n nw' }, inv.paid == null || inv.paid === '' ? '' : money(inv.paid)),
            el('td', { class: 'nw' + (isOverdue(inv.status_id, inv.payment_deadline) ? ' inv-late' : ''), title: isOverdue(inv.status_id, inv.payment_deadline) ? 'Termin płatności minął, a faktura nie jest rozliczona' : null }, dayOf(inv.payment_deadline)),
            el('td', null, invStatusPill(inv.status_id)),
            el('td', { class: 'nw inv-acts' }, printButton('ordInvPrint-' + inv.invoice_id, async () => inv, { orderNumber: o.order_number }),
              Number(inv.status_id) === 4 ? null : gw(el('button', { type: 'button', class: 'small-btn secondary', id: 'ordInvEdit-' + inv.invoice_id,
                title: 'Zmień status rozliczenia, kwotę zapłaconą, termin lub formę płatności i uwagi (numer i pozycje bez zmian)', onclick: () => openEdit(inv) }, 'Rozliczenie')))); })))) :
        el('div', { class: 'empty' }, 'Do tego zamówienia nie wystawiono faktur.'), editHost, links);
    } catch (e) { host.replaceChildren(head, receipt, el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać faktur z Selly: ' + (e.message || 'błąd')), links); }
  }
  load();
  return { host };
}

// ─── Co zostaje w Selly (brak zapisu w REST API, spec. 1.11) ─────────────────

const SELLY_ONLY = [
  ['Usuwanie pozycji z zamówienia', 'API pozwala pozycje dodawać i zmieniać, ale nie usuwać.'],
  ['Wystawianie, korekta i usuwanie faktury oraz paragon', 'Numerację i dane sprzedawcy prowadzi Selly; API wymagałoby wpisania numeru ręcznie. Rozliczenie i wydruk faktury — w sekcji „Faktury i paragon”.'],
  ['Opiekun zamówienia', 'API nie udostępnia listy pracowników, z której można by wybrać opiekuna.'],
  ['Data sprzedaży, zwrot transakcji, numer paczki i waga przesyłki', 'Tych pól nie ma w zapisie zamówienia przez API.'],
  ['Notatki grupowe (widoczne dla wybranych grup)', 'API nie opisuje, jak wskazać grupy, które widzą notatkę.'],
  ['Załączniki, SMS do klienta, zaplanowana zmiana statusu', 'Brak takich operacji w API.'],
  ['Ceny zakupu pozycji w magazynach', 'Brak zapisu w API zamówień.'],
  ['Wydruki (zamówienie, list przewozowy, do magazynu), utworzenie reklamacji lub zwrotu', 'Funkcje panelu Selly bez odpowiednika w API.'],
];
function sellyOnlyCard(C) {
  return el('details', { class: 'card ord-selly-only', id: 'ordSellyOnly' },
    el('summary', { title: 'Lista rzeczy z karty zamówienia Selly, których panel OSA nie zmienia, bo API Selly na to nie pozwala' }, 'Czego tu nie zmienisz (tylko w panelu Selly) ▾'),
    el('ul', null, SELLY_ONLY.map(([what, why]) => el('li', null, el('strong', null, what), ' — ', el('span', { class: 'muted' }, why)))),
    sellyLink('Otwórz to zamówienie w panelu Selly ↗', C.sellyUrl, 'Otwiera to zamówienie w panelu administracyjnym Selly w nowej karcie'));
}

// ─── Karta ──────────────────────────────────────────────────────────────────

const addr = (o, p) => {
  const g = k => o[p + '_' + k] || '';
  const lines = [fullName(g('first_name'), g('last_name')), g('company'), g('nip') ? 'NIP: ' + g('nip') : '', g('address'), fullName(g('postcode'), g('city'))].filter(Boolean);
  return lines.length ? el('div', null, lines.map(l => el('div', null, l))) : el('span', { class: 'muted' }, 'brak danych');
};
// Spec. API: invoice_type ∈ paragon | faktura
const DOC_TYPES = [{ id: 'paragon', name: 'Paragon' }, { id: 'faktura', name: 'Faktura' }];
const docName = v => { const d = DOC_TYPES.find(x => x.id === String(v)); return d ? d.name : String(v); };
const addrFields = (p, who) => [
  { k: p + '_first_name', label: 'Imię', tip: 'Imię ' + who }, { k: p + '_last_name', label: 'Nazwisko', tip: 'Nazwisko ' + who },
  { k: p + '_company', label: 'Firma', tip: 'Nazwa firmy (jeśli zamówienie na firmę)', wide: true }, { k: p + '_nip', label: 'NIP', tip: 'NIP firmy', check: 'nip' },
  { k: p + '_address', label: 'Ulica i numer', wide: true }, { k: p + '_postcode', label: 'Kod pocztowy', tip: 'Format 00-000', check: 'postcode' }, { k: p + '_city', label: 'Miejscowość' },
];

/** deps: { id, order, meta, adminUrl, sellyUrl, onSaved() } → { sections: węzły kart, dirty(), refresh(), toggle, secs } */
export function buildOrderCard(deps) {
  const C = { id: String(deps.id), o: deps.order, meta: deps.meta, sellyUrl: deps.sellyUrl, editDefault: !!store(EDIT_KEY), secs: [], onStatus: null };
  C.dirty = () => C.secs.some(s => s.dirty());
  C.refresh = async () => {
    const r = await api('orders:get', { id: C.id, events: false });
    if (r && r.order) C.o = r.order;
    for (const s of C.secs) { if (!s.dirty()) s.render(); }
    if (deps.onSaved) deps.onSaved(C.o);
  };
  const mk = f => { const s = f(C); C.secs.push(s); return s; };

  const notes = mk(c => section(c, {
    id: 'notes', title: 'Uwagi', sub: 'Uwagi do zamówienia (wewnętrzne) i komentarz klienta', attention: true,
    fields: [{ k: 'order_attention', label: 'Uwagi do zamówienia (wewnętrzne)', type: 'textarea', wide: true, cls: 'ord-attn-in', tip: 'Wewnętrzna uwaga dla obsługi — klient jej nie widzi' },
      { k: 'client_comment', label: 'Komentarz klienta', type: 'textarea', wide: true, tip: 'Komentarz wpisany przez klienta przy składaniu zamówienia' }],
    view: o => el('div', null,
      o.order_attention ? el('div', { class: 'notice warn', id: 'ordAttention' }, el('strong', null, 'Uwagi do zamówienia: '), o.order_attention) : null,
      o.client_comment ? el('div', { class: 'notice warn', id: 'ordClientComment' }, el('strong', null, 'Komentarz klienta: '), o.client_comment) : null,
      !o.order_attention && !o.client_comment ? el('p', { class: 'muted' }, 'Brak uwag i komentarza klienta.') : null),
  }));
  const contact = mk(c => section(c, {
    id: 'contact', title: 'Klient i kontakt',
    fields: [{ k: 'email', label: 'E-mail', check: 'email', tip: 'Adres e-mail klienta (na niego Selly wysyła powiadomienia)' }, { k: 'phone', label: 'Telefon' }],
    view: o => dl([['E-mail', o.email ? el('a', { href: 'mailto:' + o.email }, o.email) : ''], ['Telefon', o.phone ? el('a', { href: 'tel:' + String(o.phone).replace(/[^\d+]/g, '') }, o.phone) : '']]),
  }));
  const ship = mk(c => section(c, { id: 'ship', title: 'Adres wysyłki', fields: addrFields('ship', 'odbiorcy'), view: o => addr(o, 'ship') }));
  const inv = mk(c => section(c, {
    id: 'invoice', title: 'Dane do faktury',
    fields: [{ k: 'invoice_as_ship', label: 'takie same jak adres wysyłki', type: 'flag', wide: true, tip: 'Po zaznaczeniu Selly użyje adresu wysyłki także na dokumencie sprzedaży' },
      { k: 'invoice_type', label: 'Dokument sprzedaży', type: 'select', text: true, wide: true, tip: 'Czy klient chce paragon, czy fakturę (Selly przyjmuje tylko te dwie wartości). Sam dokument wystawia się w panelu Selly.',
        options: () => DOC_TYPES },
      ...addrFields('invoice', 'nabywcy')],
    view: o => dl([['Dokument', o.invoice_type ? el('span', { id: 'ordInvType' }, docName(o.invoice_type)) : ''], ['Adres', Number(o.invoice_as_ship) ? el('span', { class: 'tag' }, 'takie same jak wysyłka') : ''], ['Dane', addr(o, 'invoice')]]),
  }));

  const delivery = mk(c => {
    const s = section(c, {
      id: 'delivery', title: 'Dostawa i płatność',
      fields: [
        { k: 'delivery_id', label: 'Sposób dostawy', type: 'select', options: cc => cc.meta.deliveries || [] },
        { k: 'delivery_price', label: 'Koszt dostawy (zł)', type: 'number', check: 'money' },
        { k: 'payment_id', label: 'Sposób płatności', type: 'select', options: cc => cc.meta.payments || [] },
        { k: 'payment_price', label: 'Koszt płatności (zł)', type: 'number', check: 'money', tip: 'Dopłata za wybrany sposób płatności (np. za pobranie) — doliczana do sumy zamówienia' },
        { k: 'paid_price', label: 'Zapłacono (zł)', type: 'number', check: 'money', tip: 'Kwota, którą Selly uznaje za zapłaconą',
          after: ctl => el('button', { type: 'button', class: 'ghost small-btn', id: 'ordMarkPaidEdit', title: 'Wstawia wartość zamówienia (pozycje + dostawa + koszt płatności − rabat) w pole „Zapłacono”; zapis po podglądzie i zatwierdzeniu',
            onclick: () => { ctl.ctl.value = fmtIn(orderTotals(c.o).total); ctl.ctl.dispatchEvent(new Event('input', { bubbles: true })); } }, 'Oznacz jako opłacone') },
        { k: 'discount_price', label: 'Rabat na zamówienie (zł)', type: 'number', check: 'money', tip: 'Kwota odejmowana od sumy zamówienia' },
        { k: 'discount_description', label: 'Opis rabatu' },
        { k: 'tracking_code', label: 'Nr przesyłki', tip: 'Numer listu przewozowego / śledzenia' }, { k: 'inpost_parcel_locker', label: 'Paczkomat', tip: 'Kod paczkomatu InPost' },
        { k: 'poczta_polska_pickup_point', label: 'Punkt odbioru Poczty Polskiej', tip: 'Kod punktu odbioru Poczty Polskiej (gdy klient wybrał odbiór w punkcie)' },
        { k: 'delivery_time', label: 'Termin dostawy', tip: 'Termin dostawy w formie tekstu, np. „2–3 dni robocze” (pole „Termin dostawy” w Selly)' },
        { k: 'required_completion_date', label: 'Wymagana data realizacji', type: 'date', tip: 'Termin, do którego zamówienie ma być zrealizowane. Puste pole = brak terminu.' }],
      view: o => dl([['Dostawa', o.delivery_name], ['Koszt dostawy (zł)', o.delivery_price != null && o.delivery_price !== '' ? money(o.delivery_price) : ''], ['Płatność', o.payment_name],
        ['Koszt płatności (zł)', Number(o.payment_price) ? money(o.payment_price) : '', 'Dopłata za wybrany sposób płatności'],
        ['Zapłacono (zł)', o.paid_price != null && o.paid_price !== '' ? money(o.paid_price) : '', 'Kwota, którą Selly uznaje za zapłaconą'], ['Rabat (zł)', Number(o.discount_price) ? money(o.discount_price) : ''], ['Opis rabatu', o.discount_description],
        ['Nr przesyłki', o.tracking_code], ['Paczkomat', o.inpost_parcel_locker], ['Punkt odbioru PP', o.poczta_polska_pickup_point, 'Punkt odbioru Poczty Polskiej'], ['Termin dostawy', o.delivery_time],
        ['Wymagana data realizacji', dayOf(o.required_completion_date)]]),
      // Szybkie „Oznacz jako opłacone” — też przez podgląd zmian (jedno pole: Zapłacono)
      extraView: o => {
        const t = orderTotals(o);
        if (Math.abs(t.diff) < 0.005) return null;
        const box = el('div', { class: 'ord-actions' });
        const btn = gw(el('button', { type: 'button', class: 'secondary', id: 'ordMarkPaid', title: 'Ustawia kwotę zapłaconą = wartość zamówienia (' + money(t.total) + ' zł); przed zapisem pokażemy podgląd', onclick: () => {
          box.replaceChildren(previewBox('paid', [['Zapłacono', money(t.paid) + ' zł', money(t.total) + ' zł']], {
            onBack: () => box.replaceChildren(btn),
            onConfirm: async () => { await api('orders:update', { id: c.id, fields: { paid_price: t.total } }); flash('', 'Oznaczono jako opłacone: ' + money(t.total) + ' zł'); await c.refresh(); s.render(); },
          }));
        } }, 'Oznacz jako opłacone (' + money(t.total) + ' zł)'));
        box.append(btn);
        return box;
      },
    });
    return s;
  });
  const items = mk(itemsCard);
  const totals = mk(totalsCard);
  const prevRefresh = C.refresh;
  C.refresh = async () => { await prevRefresh(); totals.render(); };
  const invoices = invoicesCard(C);

  // przełącznik „Domyślnie w trybie edycji”
  const toggle = el('label', { class: 'osa-chk ord-editdef', title: 'Po włączeniu wszystkie sekcje karty zamówienia od razu otwierają się do edycji (zapamiętane w tej przeglądarce). Domyślnie widzisz podgląd z przyciskami „Edytuj”.' },
    el('input', { type: 'checkbox', id: 'ordEditDefault', checked: C.editDefault, onchange: ev => {
      if (C.dirty() && !confirm('W karcie są niezapisane zmiany — przełączenie trybu je odrzuci. Kontynuować?')) { ev.target.checked = !ev.target.checked; return; }
      C.editDefault = ev.target.checked; store(EDIT_KEY, C.editDefault);
      for (const s of C.secs) s.setEditing && s.setEditing(C.editDefault);
    } }), ' Domyślnie w trybie edycji');
  return { C, toggle, notes: notes.host, grid: [contact.host, ship.host, inv.host, delivery.host], items: items.host, totals: totals.host, invoices: invoices.host, sellyOnly: sellyOnlyCard(C) };
}
