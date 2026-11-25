// Formularz klienta (dodawanie i edycja) — walidacja po stronie przeglądarki lustrzana do Workera (clients.js), który i tak sprawdza wszystko.
// Podstawy na wierzchu, reszta w zwijanych sekcjach (faktura, ceny i grupa, zaawansowane). Zapis wysyła tylko zmienione pola.
import { el, dateInput } from '../core/ui.js?v=3bb5e1e';

const isOn = v => v === true || v === 1 || v === '1' || v === 'true';
// Walidatory (czysta logika, wspólna z importem CSV): klienciValid.js
export { nipError, postcodeError, emailError, phoneError, fixPostcode } from './klienciValid.js?v=3bb5e1e';
import { nipError, postcodeError, emailError, phoneError, fixPostcode } from './klienciValid.js?v=3bb5e1e';

/** Opis pól: sec = sekcja, req = wymagane przy dodawaniu, kind = rodzaj kontrolki. */
const SPEC = [
  { key: 'first_name', label: 'Imię', req: 1, sec: 'base' }, { key: 'last_name', label: 'Nazwisko', req: 1, sec: 'base' },
  { key: 'email', label: 'E-mail', kind: 'email', req: 1, sec: 'base', tip: 'Adres e-mail = login klienta w sklepie' },
  { key: 'phone', label: 'Telefon', kind: 'tel', req: 1, sec: 'base' },
  { key: 'ship_company', label: 'Firma (przy adresie wysyłki)', sec: 'base' }, { key: 'country', label: 'Państwo', sec: 'base', def: 'Polska', tip: 'Od państwa zależy sprawdzanie NIP i kodu pocztowego (dla Polski: format 00-000 i suma kontrolna NIP).' },
  { key: 'ship_address', label: 'Adres (ulica i numer)', req: 1, sec: 'base' }, { key: 'ship_postcode', label: 'Kod pocztowy', req: 1, sec: 'base', ph: '00-000' },
  { key: 'ship_city', label: 'Miejscowość', req: 1, sec: 'base' },

  { key: 'invoice_as_ship', label: 'Dane do faktury takie same jak adres wysyłki', kind: 'flag', sec: 'inv', tip: 'Zaznaczone: faktura wystawiana na dane z adresu wysyłki, pola poniżej są nieaktywne.' },
  { key: 'invoice_company', label: 'Nazwa firmy', sec: 'inv' }, { key: 'invoice_nip', label: 'NIP', sec: 'inv', tip: 'Dla Polski 10 cyfr; myślniki i spacje są dozwolone. Zapisywany bez myślników.', ph: '123-456-32-18' },
  { key: 'invoice_first_name', label: 'Imię (faktura)', sec: 'inv' }, { key: 'invoice_last_name', label: 'Nazwisko (faktura)', sec: 'inv' },
  { key: 'invoice_address', label: 'Adres (faktura)', sec: 'inv' }, { key: 'invoice_postcode', label: 'Kod pocztowy (faktura)', sec: 'inv', ph: '00-000' }, { key: 'invoice_city', label: 'Miejscowość (faktura)', sec: 'inv' },
  { key: 'sell_document', label: 'Dokument sprzedaży', kind: 'select', opts: [['', '— domyślny —'], ['faktura', 'faktura'], ['paragon', 'paragon']], sec: 'inv' },
  { key: 'vat_ue', label: 'Klient VAT UE (kupuje wg stawki 0% WDT)', kind: 'flag', sec: 'inv', tip: 'Zaznacz tylko dla firm z innego kraju UE z ważnym numerem VAT UE.' },

  { key: 'activate_account', label: 'Konto aktywne', kind: 'flag', sec: 'acc', def: 1, tip: 'Odznaczone: konto jest nieaktywne (klient nie zaloguje się).' },
  { key: 'newsletter', label: 'Zgoda na newsletter', kind: 'flag', sec: 'acc' }, { key: 'marketing_agree', label: 'Zgoda marketingowa', kind: 'flag', sec: 'acc' },

  { key: 'notes', label: 'Notatka', kind: 'area', sec: 'note', tip: 'W sklepie notatka klienta to zwykle opis orszaku: województwo, miejscowość, rodzaj podmiotu.' },
  { key: 'notes_date', label: 'Data notatki', kind: 'date', sec: 'note' },

  { key: 'group_id', label: 'Grupa klientów', kind: 'group', sec: 'price', tip: 'Grupa decyduje m.in. o limitach zamówień. Grupy tworzy się w Selly.' },
  { key: 'price_level', label: 'Poziom cen', kind: 'select', sec: 'price', opts: [['0', 'detaliczny'], ['1', 'rabaty — poziom 1'], ['2', 'rabaty — poziom 2'], ['3', 'rabaty — poziom 3']], tip: 'Który cennik stosuje sklep wobec klienta (jak w Selly: klient detaliczny / z rabatami poziom 1–3).' },
  { key: 'discount', label: 'Indywidualny rabat (%)', kind: 'num', sec: 'price', tip: 'Rabat procentowy 0–100 na całe zamówienie klienta. Zostaw 0, jeśli klient go nie ma.' },
  { key: 'salesperson_id', label: 'Opiekun klienta (ID pracownika)', kind: 'int', sec: 'price', tip: 'Numer pracownika z Selly; 0 = brak opiekuna.' },

  { key: 'client_type', label: 'Rodzaj konta', kind: 'select', sec: 'adv', opts: [['CLIENT', 'konto podstawowe'], ['SUBACCOUNT_CLIENT', 'subkonto']], tip: 'Subkonto należy do konta głównego (poniżej podaj jego e-mail).' },
  { key: 'subclient_parent', label: 'Subkonto dla konta (e-mail)', kind: 'email', sec: 'adv', opt: 1 },
  { key: 'subclient_permission', label: 'Poziom uprawnień subkonta', kind: 'select', sec: 'adv', opts: [['', '—'], ['FULL', 'dostęp pełny'], ['MEDIUM', 'poziom średni'], ['LOW', 'poziom niski']] },
  { key: 'shop_restriction_login', label: 'Ograniczenia logowania', kind: 'select', sec: 'adv', opts: [['0', 'brak'], ['1', 'tylko sklep podstawowy']] },
  { key: 'acronym', label: 'Akronim', sec: 'adv', tip: 'Krótka nazwa klienta (np. do wyszukiwania w Selly).' },
  { key: 'label', label: 'Etykieta / PESEL', sec: 'adv', tip: 'Pole „PESEL / etykieta” z Selly. Wpisuj tylko, gdy to konieczne (dane osobowe).' },
  { key: 'birth_date', label: 'Data urodzenia', kind: 'date', sec: 'adv' }, { key: 'identification', label: 'Numer dokumentu tożsamości', sec: 'adv' },
];
const SECTIONS = { base: 'Dane podstawowe', inv: 'Dane do faktury', acc: 'Konto i zgody', note: 'Notatka', price: 'Ceny, grupa i opiekun', adv: 'Zaawansowane' };
const FOLDED = { inv: 'Faktura, NIP, VAT UE', price: 'Poziom cen, rabat, grupa, opiekun', adv: 'Subkonta, PESEL, dodatkowe pola' };

/**
 * Buduje formularz. o: { client (rekord z Selly albo null przy dodawaniu), groups: [{id,name,count}], creating }.
 * Zwraca { node, changed() → {pole: wartość}, all(), validate() → true gdy bez błędów, dirty(), reset() }.
 */
export function clientForm(o) {
  const c = o.client || {}, creating = !!o.creating;
  const ctl = {}, errBox = {}, orig = {};
  const raw = k => (k === 'acronym' ? (c.additional_data && c.additional_data.acronym) : c[k]);
  const initial = f => {
    const v = raw(f.key);
    if (f.kind === 'flag') return v == null || v === '' ? (creating && f.def != null ? f.def : 0) : (isOn(v) ? 1 : 0);
    if (f.kind === 'select') return v == null || v === '' ? (f.key === 'client_type' ? 'CLIENT' : f.key === 'price_level' || f.key === 'shop_restriction_login' ? '0' : '') : String(v);
    if (f.kind === 'group' || f.kind === 'int') return v == null || v === '' ? '0' : String(v);
    if (f.kind === 'num') return v == null || v === '' ? '0' : String(Number(v));
    return v == null || v === '' ? (creating && f.def ? f.def : '') : String(v).replace('T', ' ').slice(0, f.kind === 'date' ? 10 : 5000);
  };
  const groups = (o.groups || []).slice();
  const cur = initial({ key: 'group_id', kind: 'group' });
  if (cur !== '0' && !groups.some(g => String(g.id) === cur)) groups.push({ id: cur, name: '', count: null });
  const read = f => { const x = ctl[f.key]; return f.kind === 'flag' ? (x.checked ? 1 : 0) : x.value; };

  for (const f of SPEC) {
    orig[f.key] = initial(f);
    const id = 'cf_' + f.key, tip = f.tip || null;
    if (f.kind === 'flag') ctl[f.key] = el('input', { type: 'checkbox', id, checked: orig[f.key] === 1 });
    else if (f.kind === 'select') ctl[f.key] = el('select', { id }, f.opts.map(([v, t]) => el('option', { value: v, selected: v === orig[f.key] }, t)));
    else if (f.kind === 'group') ctl[f.key] = el('select', { id }, el('option', { value: '0', selected: orig[f.key] === '0' }, 'brak grupy'),
      groups.map(g => el('option', { value: String(g.id), selected: String(g.id) === orig[f.key] }, (g.name || 'Grupa nr ' + g.id) + (g.count != null ? ' (' + g.count + ')' : ''))));
    else if (f.kind === 'area') { ctl[f.key] = el('textarea', { id, rows: '4', maxlength: '5000' }); ctl[f.key].value = orig[f.key]; }
    else if (f.kind === 'date') ctl[f.key] = dateInput({ id, value: orig[f.key] || '', label: f.label, title: tip });
    else ctl[f.key] = el('input', { type: f.kind === 'email' ? 'email' : f.kind === 'tel' ? 'tel' : f.kind === 'num' || f.kind === 'int' ? 'text' : 'text', id, value: orig[f.key],
      placeholder: f.ph || null, inputmode: f.kind === 'num' ? 'decimal' : f.kind === 'int' ? 'numeric' : null, autocomplete: 'off', maxlength: f.kind === 'int' || f.kind === 'num' ? '10' : '200' });
    errBox[f.key] = el('div', { class: 'kf-err', id: 'cfe_' + f.key, role: 'alert', hidden: true });
    ctl[f.key]._f = f;
  }
  // kod pocztowy wpisany jako 5 cyfr sam dostaje myślnik
  for (const k of ['ship_postcode', 'invoice_postcode']) ctl[k].addEventListener('blur', () => { const v = fixPostcode(ctl[k].value, ctl.country.value); if (v !== ctl[k].value.trim()) ctl[k].value = v; });

  const fieldNode = f => {
    const x = ctl[f.key];
    if (f.kind === 'flag') return el('label', { class: 'kf-check', title: f.tip || null }, x, el('span', null, f.label));
    return el('div', { class: 'kf-field' + (f.kind === 'area' ? ' wide' : '') }, el('label', { for: 'cf_' + f.key, class: f.tip ? 'tip' : null, title: f.tip || null }, f.label + (f.req && creating ? ' *' : '')), x, errBox[f.key]);
  };
  const section = sec => {
    const fs = SPEC.filter(f => f.sec === sec);
    const grid = el('div', { class: 'kf-grid' }, fs.map(fieldNode));
    if (!FOLDED[sec]) return el('section', { class: 'card kf-sec', id: 'cfSec_' + sec }, el('div', { class: 'card-head' }, el('h2', null, SECTIONS[sec])), grid);
    const dirty = fs.some(f => (f.kind === 'flag' ? false : orig[f.key] !== '' && orig[f.key] !== '0' && orig[f.key] !== 'CLIENT') || (f.key === 'invoice_as_ship' && orig[f.key] === 1));
    return el('details', { class: 'card kf-sec fold', id: 'cfSec_' + sec, open: dirty && !creating ? true : null },
      el('summary', { title: 'Zaawansowane — rozwiń, aby edytować: ' + FOLDED[sec] }, el('h2', null, SECTIONS[sec]), el('span', { class: 'muted small' }, FOLDED[sec])), grid);
  };

  // faktura: pola nieaktywne, gdy „takie same jak wysyłka”
  const syncInv = () => { for (const f of SPEC.filter(x => x.sec === 'inv' && !['invoice_as_ship', 'sell_document', 'vat_ue'].includes(x.key))) ctl[f.key].disabled = !!ctl.invoice_as_ship.checked; };
  ctl.invoice_as_ship.addEventListener('change', syncInv); syncInv();
  const syncSub = () => { const sub = ctl.client_type.value === 'SUBACCOUNT_CLIENT'; ctl.subclient_parent.disabled = ctl.subclient_permission.disabled = !sub;
    ctl.subclient_parent.title = sub ? '' : 'Dostępne tylko dla subkonta'; };
  ctl.client_type.addEventListener('change', syncSub); syncSub();

  const F = k => SPEC.find(f => f.key === k);
  const check = f => {
    const v = String(read(f)).trim(), country = ctl.country.value;
    if (ctl[f.key].disabled) return '';
    if (f.req && creating && !v) return 'To pole jest wymagane.';
    if (f.req && !creating && !v) return 'To pole nie może być puste.';
    if (f.key === 'email') return v || creating ? emailError(v) : '';
    if (f.key === 'subclient_parent') return v ? emailError(v) : (ctl.client_type.value === 'SUBACCOUNT_CLIENT' && creating ? 'Subkonto wymaga e-maila konta głównego.' : '');
    if (f.key === 'phone') return phoneError(v);
    if (f.key === 'invoice_nip') return nipError(v, country);
    if (f.key === 'ship_postcode' || f.key === 'invoice_postcode') return postcodeError(v, country);
    if (f.kind === 'num') { const n = Number(v.replace(',', '.')); return v && (!isFinite(n) || n < 0 || n > 100) ? 'Rabat to liczba od 0 do 100.' : ''; }
    if (f.kind === 'int') return v && !/^\d+$/.test(v) ? 'Wpisz liczbę całkowitą.' : '';
    return '';
  };
  const show = (f, msg) => { errBox[f.key].textContent = msg; errBox[f.key].hidden = !msg; ctl[f.key].setAttribute('aria-invalid', msg ? 'true' : 'false'); ctl[f.key].classList.toggle('bad', !!msg); };
  for (const f of SPEC) if (f.kind !== 'flag' && f.kind !== 'date') ctl[f.key].addEventListener('blur', () => show(f, check(f)));
  ctl.country.addEventListener('change', () => { for (const k of ['invoice_nip', 'ship_postcode', 'invoice_postcode']) if (errBox[k].textContent) show(F(k), check(F(k))); });

  const changed = () => {
    const out = {};
    for (const f of SPEC) {
      if (ctl[f.key].disabled && f.key !== 'invoice_as_ship') continue;
      const v = read(f);
      if (String(v) !== String(orig[f.key])) out[f.key] = f.kind === 'flag' ? v : (f.kind === 'num' ? String(v).replace(',', '.') : String(v).trim());
    }
    return out;
  };
  const all = () => {
    const out = {};
    for (const f of SPEC) {
      if (ctl[f.key].disabled && f.key !== 'invoice_as_ship') continue;
      const v = String(read(f)).trim();
      if (f.kind === 'flag') out[f.key] = Number(read(f)); else if (v !== '') out[f.key] = f.kind === 'num' ? v.replace(',', '.') : v;
    }
    return out;
  };
  const validate = () => {
    let first = null;
    for (const f of SPEC) if (f.kind !== 'flag' && f.kind !== 'date') { const m = check(f); show(f, m); if (m && !first) first = f; }
    if (first) { const d = ctl[first.key].closest('details'); if (d) d.open = true; ctl[first.key].focus(); }
    return !first;
  };

  const pass = creating ? el('section', { class: 'card kf-sec', id: 'cfSec_pass' }, el('div', { class: 'card-head' }, el('h2', null, 'Hasło')),
    el('div', { class: 'kf-field' }, el('label', { for: 'cf_password', class: 'tip', title: 'Zostaw puste, aby panel wygenerował losowe hasło. Klient ustawi własne przez „Zapomniałem hasła” w sklepie.' }, 'Hasło (opcjonalne)'),
      el('input', { type: 'password', id: 'cf_password', autocomplete: 'new-password', maxlength: '100', placeholder: 'puste = losowe' }), el('div', { class: 'muted small' }, 'Minimum 8 znaków. Puste pole: panel ustawi losowe hasło — klient ustawi własne przez „Zapomniałem hasła” w sklepie.'))) : null;

  const node = el('div', { class: 'kf' }, ['base', 'acc', 'note', 'inv', 'price', 'adv'].map(section), pass);
  const dirty = () => Object.keys(changed()).length > 0 || (creating && !!(node.querySelector('#cf_password') || {}).value);
  return { node, changed, all, validate, dirty, password: () => (node.querySelector('#cf_password') || {}).value || '', setError: (k, msg) => ctl[k] && show(F(k), msg), ctl };
}
