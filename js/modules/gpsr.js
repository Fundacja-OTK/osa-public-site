// Dane GPSR (bezpieczeństwo produktu): lista / dodawanie / edycja wpisów (natywny ekran `gpsr`) oraz sekcja w karcie produktu
// (osadzony ekran `produkt-gpsr`: przypisanie wpisu producenta i podmiotu odpowiedzialnego + opis). Sesja Selly zalogowanego użytkownika.
// Zapis: tylko zmienione pola → podgląd (dryRun) → potwierdzenie → zapis → weryfikacja. Usuwanie wpisów i import CSV zostają w Selly.
import { el, sellyLink, flash } from '../core/ui.js?v=1c81125';
import { confirmDialog } from '../core/confirm.js?v=1c81125';
import { createNative, sellyCall } from './sellyNative.js?v=1c81125';

export const GPSR_TIP = 'GPSR to unijne rozporządzenie o bezpieczeństwie produktów: każdy produkt w sklepie musi mieć dane producenta oraz podmiotu odpowiedzialnego w UE (nazwa, adres, e-mail, telefon).';

export const screens = {
  gpsr: createNative({
    id: 'gpsr', title: 'Dane GPSR', screen: 'gpsr', a: 'bezpieczenstwoProduktu', recordRoute: 'bezpieczenstwoProduktu.edytuj', noun: 'wpisu',
    recordTitle: id => 'Wpis GPSR nr ' + id,
    remove: { title: 'Usunąć wpis GPSR?', tip: 'Usuwa ten wpis z Selly (tylko administrator, po potwierdzeniu). Produkty z tym wpisem stracą przypisanie.', body: id => 'Wpis GPSR nr ' + id + ' zostanie usunięty z Selly.' },
    create: { title: 'Nowy wpis GPSR', label: 'Dodaj wpis GPSR', tip: 'Dodaje producenta lub podmiot odpowiedzialny do listy w Selly (przed wysłaniem pokażemy podsumowanie). ' + GPSR_TIP },
    labels: { name: 'Nazwa (skrót, widoczna na listach)', full_name: 'Pełna nazwa firmy', street: 'Ulica i numer', postal_code: 'Kod pocztowy', city: 'Miasto', email: 'E-mail', phone: 'Telefon', country: 'Kraj' },
    fieldTips: { name: 'Krótka nazwa do wyboru przy produkcie', full_name: 'Pełna nazwa firmy, która pojawi się w informacji o bezpieczeństwie produktu', email: 'Adres kontaktowy w sprawach bezpieczeństwa produktu', country: 'Kraj siedziby' },
    headerTips: { 'Id': 'Numer wpisu GPSR w Selly', 'Nazwa': 'Krótka nazwa wpisu', 'Pełna nazwa': 'Pełna nazwa firmy pokazywana w sklepie', 'Kraj': 'Kraj siedziby', 'Działanie': 'Dostępne działania w Selly' },
  }),
};

const FIELDS = [['producent_odpowiedzialny', 'Producent', 'Firma, która wyprodukowała produkt'],
  ['podmiot_odpowiedzialny', 'Podmiot odpowiedzialny w UE', 'Firma w UE odpowiedzialna za bezpieczeństwo produktu (często ten sam co producent)']];

/** Sekcja zakładki „GPSR” w karcie produktu. host: element do wypełnienia. */
export async function mountProductGpsr(host, id) {
  host.replaceChildren(el('p', { class: 'muted' }, 'Wczytuję dane GPSR z Selly…'));
  const r = await sellyCall({ op: 'read', screen: 'produkt-gpsr', view: 'record', id });
  const fields = r && r.ok && r.data ? r.data.fields || [] : [];
  const by = n => fields.find(f => f.name === n);
  if (!r || !r.ok || !by('producent_odpowiedzialny') || !by('podmiot_odpowiedzialny')) {
    host.replaceChildren(el('p', { class: 'muted' }, (r && r.error) || 'Nie udało się wczytać danych GPSR (brak uprawnień lub Selly nie odpowiada).'),
      sellyLink('Otwórz GPSR produktu w Selly ↗', '?a=produkty.bezpieczenstwoProduktu&id=' + encodeURIComponent(id), 'Otwiera ten sam ekran w Selly, w nowej karcie'));
    return;
  }
  const can = !!r.data.canSave;
  const ctl = new Map(), orig = {};
  const rows = FIELDS.map(([name, label, tip]) => {
    const f = by(name); orig[name] = f.value == null ? '' : String(f.value);
    const sel = el('select', { id: 'gpsrF_' + name, disabled: can && f.editable ? null : true, title: tip },
      (f.options || []).map(o => el('option', { value: o.value }, o.text)));
    sel.value = orig[name]; ctl.set(name, sel);
    return el('label', { class: 'field' }, el('span', { class: 'tip', title: tip }, label), sel);
  });
  const d = by('description'); orig.description = d && d.value != null ? String(d.value) : '';
  if (d) {
    const ta = el('textarea', { id: 'gpsrF_description', rows: 4, maxlength: 5000, disabled: can && d.editable ? null : true, title: 'Dodatkowy opis bezpieczeństwa tego produktu (opcjonalnie)' });
    ta.value = orig.description; ctl.set('description', ta);
    rows.push(el('label', { class: 'field' }, el('span', { class: 'tip', title: 'Dodatkowy opis bezpieczeństwa tego produktu (opcjonalnie)' }, 'Dodatkowy opis'), ta));
  }
  const labelOf = n => (FIELDS.find(x => x[0] === n) || [n, n === 'description' ? 'Dodatkowy opis' : n])[1];
  const textOf = (n, v) => { const c = ctl.get(n); const o = c && c.tagName === 'SELECT' ? [...c.options].find(x => x.value === v) : null; return o ? o.textContent : v; };
  const save = async () => {
    const changes = {}, expect = {};
    for (const [n, c] of ctl) if (c.value !== orig[n]) { changes[n] = c.value; expect[n] = orig[n]; }
    if (!Object.keys(changes).length) { flash('', 'Bez zmian — nic do zapisania'); return; }
    const pre = await sellyCall({ op: 'save', screen: 'produkt-gpsr', id, changes, expect, dryRun: true });
    if (!pre || !pre.ok) { flash('', (pre && pre.error) || 'Nie udało się przygotować zapisu'); return; }
    if (!pre.data.diff.length) { flash('', 'Bez zmian — wartości są już takie w Selly'); return; }
    const body = el('div', null, el('p', null, 'Do Selly zostanie zapisane:'),
      el('ul', null, pre.data.diff.map(x => el('li', null, el('strong', null, labelOf(x.name) + ': '), (x.beforeText || textOf(x.name, x.before) || '(puste)') + ' → ' + (x.afterText || textOf(x.name, x.after) || '(puste)')))),
      pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null);
    confirmDialog({ id: 'gpsrConfirm', title: 'Zapisać dane GPSR produktu?', body, confirmLabel: 'Zapisz w Selly', focus: 'cancel', onConfirm: async ({ close }) => {
      const w = await sellyCall({ op: 'save', screen: 'produkt-gpsr', id, changes, expect });
      close();
      if (!w || !w.ok) { flash('', (w && w.code === 'conflict' ? '' : 'Zapis nie powiódł się: ') + ((w && w.error) || 'błąd')); return; }
      flash('', w.data.verified ? 'Zapisano w Selly i sprawdzono' : 'Selly przyjęło zapis, ale nie potwierdziło pól — sprawdź w Selly');
      mountProductGpsr(host, id);
    } });
  };
  host.replaceChildren(
    el('p', { class: 'muted small tip', title: GPSR_TIP }, 'Dane producenta i podmiotu odpowiedzialnego (GPSR) tego produktu — wybierz z listy wpisów.'),
    ...rows,
    el('div', { class: 'ord-actions' },
      can ? el('button', { type: 'button', class: 'primary', id: 'gpsrSave', write: 'produkty', title: 'Pokaże podsumowanie zmian, a po potwierdzeniu zapisze je w Selly', onclick: save }, 'Zapisz GPSR') : null,
      el('a', { href: '#/gpsr', class: 'btn-secondary', id: 'gpsrList', title: 'Lista wpisów GPSR: dodawanie i edycja producentów oraz podmiotów odpowiedzialnych' }, 'Wpisy GPSR (lista)')),
    can ? null : el('p', { class: 'muted small' }, 'Tylko podgląd — zapis niedostępny. Zmienisz w Selly.'));
}
