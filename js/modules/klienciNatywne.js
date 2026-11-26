// Klienci — dodatki karty przez natywne ekrany Selly (P6; shared/native/klienci.js, sesja Selly zalogowanego użytkownika):
// status i data notatki (`klient-notatka`), rabaty wg producentów (`klient-rabaty-prod`, zmiana procentu istniejącego rabatu),
// producenci zablokowani (`klient-producenci`, tylko podgląd), ekrany „Notatki klientów” (`klienci-notatki`) i „Uprawnienia subkont”
// (`subkonta-uprawnienia`). Każdy zapis: tylko zmienione pola z allowlisty → podgląd (dryRun) → potwierdzenie → zapis → weryfikacja.
// Dodawanie i usuwanie rabatów, zmiana listy zablokowanych producentów — w Selly (↗). Treść z Selly tylko przez el() / textContent.
import { el, flash, sellyLink } from '../core/ui.js?v=5281496';
import { confirmDialog } from '../core/confirm.js?v=5281496';
import { sellyCall, createNative } from './sellyNative.js?v=5281496';
import { lazyFold } from './klienciExtra.js?v=5281496';

const shown = f => f.type === 'select' || f.type === 'radio' ? (((f.options || []).find(o => o.value === f.value) || {}).text || f.value) : f.value;

function control(f, prefix, label, tip) {
  const common = { 'data-field': f.name, id: prefix + f.name.replace(/[^\w-]/g, '_'), title: tip || label, 'aria-label': label };
  if (f.type === 'checkbox') return el('input', { ...common, type: 'checkbox', 'data-on': f.onValue || '1', checked: f.value !== '' || null });
  if (f.type === 'select' || f.type === 'radio') return el('select', common, [f.value === '' ? el('option', { value: '' }, '— nie ustawiono —') : null,
    (f.options || []).map(o => el('option', { value: o.value, selected: o.value === f.value || null }, o.text || o.value))]);
  return el('input', { ...common, type: f.type === 'date' ? 'date' : 'text', value: f.value, maxlength: '200', inputmode: /procent|rabat/.test(f.name) ? 'decimal' : null });
}

/** Zmienione pola formularza (tylko różne od stanu z Selly). */
function collect(form, orig) {
  const ch = {};
  for (const i of form.querySelectorAll('[data-field]')) { const v = i.type === 'checkbox' ? (i.checked ? i.dataset.on : '') : i.value; if (v !== orig[i.dataset.field]) ch[i.dataset.field] = v; }
  return ch;
}

/**
 * Edycja kilku pól karty natywnej: { screen, id, prefix, labels, tips, title (okna potwierdzenia), onDone } → węzeł formularza.
 * fields = pola edytowalne z odczytu (view:'record'); zapis tylko zmienionych, `expect` = stan z chwili odczytu (konflikt, gdy ktoś zmienił w Selly).
 */
export function nativeEditor(fields, { screen, id, prefix, labels = {}, tips = {}, title, onDone, warn }) {
  const orig = Object.fromEntries(fields.map(f => [f.name, f.value]));
  const lab = f => labels[f.name] || f.label || f.name;
  const form = el('div', { class: 'kf-grid', id: prefix + 'Form' }, fields.map(f => el('label', { class: 'nat-field' },
    el('span', { class: 'nat-lbl tip', title: tips[f.name] || lab(f) }, lab(f)), control(f, prefix, lab(f), tips[f.name]))));
  const msg = el('div', { role: 'status', id: prefix + 'Msg' });
  const save = el('button', { type: 'button', class: 'primary', write: 'klienci', id: prefix + 'Save', disabled: true, title: 'Najpierw zmień któreś pole — przed zapisem pokażemy dokładnie, co trafi do Selly' }, 'Zapisz w Selly…');
  const sync = () => { save.disabled = !Object.keys(collect(form, orig)).length; };
  form.addEventListener('input', sync); form.addEventListener('change', sync);
  save.addEventListener('click', async () => {
    const changes = collect(form, orig), expect = Object.fromEntries(Object.keys(changes).map(k => [k, orig[k]]));
    save.disabled = true;
    const pre = await sellyCall({ op: 'save', screen, id, changes, expect, dryRun: true });
    save.disabled = false;
    if (!pre.ok) { msg.replaceChildren(el('div', { class: 'notice error' }, pre.error || 'Nie udało się przygotować zapisu')); return; }
    if (!pre.data.diff.length) { msg.replaceChildren(el('div', { class: 'notice' }, 'Bez zmian — wartości są już takie w Selly.')); return; }
    const table = el('table', { id: prefix + 'Diff' }, el('thead', null, el('tr', null, el('th', { title: 'Pole w Selly' }, 'Pole'), el('th', { title: 'Wartość teraz w Selly' }, 'Było'), el('th', { title: 'Wartość po zapisie' }, 'Będzie'))),
      el('tbody', null, pre.data.diff.map(d => el('tr', null, el('td', null, labels[d.name] || d.label || d.name), el('td', { class: 'nat-before' }, d.beforeText || '—'), el('td', null, el('strong', null, d.afterText || '—'))))));
    const dlg = confirmDialog({ id: prefix + 'Confirm', title, body: el('div', null, table, (pre.data.warn || warn) ? el('p', { class: 'muted' }, pre.data.warn || warn) : null),
      confirmLabel: 'Zapisz w Selly', focus: 'cancel', onConfirm: async ({ close }) => {
        const res = await sellyCall({ op: 'save', screen, id, changes, expect });
        close();
        if (!res.ok) { msg.replaceChildren(el('div', { class: 'notice error' }, (res.code === 'conflict' ? '' : 'Zapis nie powiódł się: ') + (res.error || 'błąd'))); return; }
        flash('', res.data.verified ? 'Zapisano w Selly i sprawdzono' : 'Selly przyjęło zapis, ale nie potwierdziło wszystkich pól — sprawdź w Selly');
        if (onDone) onDone();
      } });
    return dlg;
  });
  return el('div', null, form, msg, el('div', { class: 'ord-actions' }, save));
}

// ─── Status i data notatki ──────────────────────────────────────────────────

const NOTE_LABELS = { notatki_status: 'Status notatki', notatki_data: 'Data notatki' };
const NOTE_TIPS = { notatki_status: 'Otwarte = sprawa do załatwienia; zamknięte = załatwione. Lista „Notatki klientów” filtruje po tym statusie.', notatki_data: 'Data notatki w Selly (np. kiedy wróci sprawa)' };

export function noteStatusFold(id, sellyUrl) {
  return lazyFold('cliNoteStFold', 'Status notatki', 'Otwarta / zamknięta i data — z Selly (treść notatki edytujesz wyżej)', async (body, reload) => {
    const link = sellyLink('Notatka w Selly ↗', sellyUrl + '?a=klienci.edit&id=' + encodeURIComponent(id), 'Otwiera kartę klienta w Selly — sekcja notatki');
    const r = await sellyCall({ op: 'read', screen: 'klient-notatka', view: 'record', id });
    if (!r.ok) { body.replaceChildren(el('div', { class: 'notice warn', id: 'cliNoteStErr' }, r.error || 'Nie udało się odczytać notatki z Selly'), link); return; }
    const fields = (r.data.fields || []).filter(f => f.editable);
    if (!r.data.canSave || !fields.length) { body.replaceChildren(el('p', { class: 'muted', id: 'cliNoteStNone' }, 'Formularz klienta w Selly nie ma pól statusu notatki w oczekiwanym układzie — zmień to w Selly. '), link); return; }
    const now = fields.map(f => (NOTE_LABELS[f.name] || f.label) + ': ' + (shown(f) || '—')).join(' · ');
    body.replaceChildren(el('p', { class: 'muted small', id: 'cliNoteStNow' }, 'Teraz w Selly: ' + now),
      nativeEditor(fields, { screen: 'klient-notatka', id, prefix: 'cliNoteSt', labels: NOTE_LABELS, tips: NOTE_TIPS, title: 'Zapisać status notatki w Selly?', onDone: reload }),
      el('div', { class: 'ord-actions' }, link, el('a', { href: '#/klienci/notatki', class: 'btn-secondary', title: 'Wszyscy klienci z notatkami — filtr otwarte / zamknięte' }, 'Notatki wszystkich klientów')));
  });
}

// ─── Rabaty wg producentów ──────────────────────────────────────────────────

export function producerDiscountsFold(id, sellyUrl) {
  return lazyFold('cliProdDiscFold', 'Rabaty wg producentów', 'Rabat procentowy klienta dla produktów wybranych producentów — z Selly', async (body, reload) => {
    const link = sellyLink('Dodaj / usuń w Selly ↗', sellyUrl + '?a=klienci.discounts&id=' + encodeURIComponent(id), 'Dodawanie nowego rabatu i usuwanie — w panelu Selly');
    const r = await sellyCall({ op: 'read', screen: 'klient-rabaty-prod', view: 'list', query: { id: String(id) } });
    if (!r.ok) { body.replaceChildren(el('div', { class: 'notice warn', id: 'cliProdDiscErr' }, r.error || 'Nie udało się odczytać rabatów z Selly'), link); return; }
    const d = r.data, edit = el('div', { id: 'cliProdDiscEdit' });
    const open = async row => {
      edit.replaceChildren(el('p', { class: 'muted small' }, 'Pobieram rabat z Selly…'));
      const rec = await sellyCall({ op: 'read', screen: 'klient-rabaty-prod', view: 'record', id: row.id });
      const fields = rec.ok ? (rec.data.fields || []).filter(f => f.editable) : [];
      if (!rec.ok || !rec.data.canSave || !fields.length) { edit.replaceChildren(el('div', { class: 'notice warn' }, (rec.ok ? 'Selly nie podało formularza rabatu w oczekiwanym układzie.' : rec.error) + ' Zmień rabat w Selly.')); return; }
      const prod = (rec.data.fields || []).find(f => f.name === 'producent_id');
      edit.replaceChildren(el('div', { class: 'opts-box kf-inline' }, el('strong', null, 'Zmień rabat: ' + (prod ? shown(prod) : (row.cells[0] || {}).text || '')),
        nativeEditor(fields, { screen: 'klient-rabaty-prod', id: row.id, prefix: 'cliProdDisc', labels: { rabat_procent: 'Rabat (%)' },
          tips: { rabat_procent: 'Rabat procentowy dla produktów tego producenta, np. 10 (producent rabatu się nie zmienia)' }, title: 'Zapisać rabat w Selly?', onDone: reload }),
        el('button', { type: 'button', class: 'ghost', onclick: () => edit.replaceChildren() }, 'Anuluj')));
    };
    const rows = d.rows || [];
    const table = rows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'cliProdDiscTable' },
      el('thead', null, el('tr', null, d.headers.slice(0, 2).map(h => el('th', { title: h === 'Producent' ? 'Producent, którego produkty obejmuje rabat' : h === 'Rabat procentowy' ? 'Rabat klienta na produkty tego producenta' : h }, h)),
        el('th', { title: 'Działania' }, 'Działania'))),
      el('tbody', null, rows.map(row => el('tr', { 'data-id': row.id || null }, row.cells.slice(0, 2).map(c => el('td', null, c.text)),
        el('td', { class: 'nw' }, row.id ? el('button', { type: 'button', class: 'secondary', write: 'klienci', title: 'Zmień procent rabatu (przed zapisem pokażemy podgląd)', onclick: () => open(row) }, 'Zmień')
          : el('span', { class: 'muted small tip', title: 'Selly nie podało odnośnika do edycji tego rabatu — zmień go w Selly' }, '—')))))))
      : el('div', { class: 'empty', id: 'cliProdDiscEmpty' }, 'Klient nie ma rabatów wg producentów.');
    body.replaceChildren(table, edit, el('div', { class: 'ord-actions' }, link), d.warn ? el('p', { class: 'muted small' }, d.warn) : null);
  });
}

// ─── Producenci zablokowani ─────────────────────────────────────────────────

export function blockedProducersFold(id, sellyUrl) {
  return lazyFold('cliProdBlkFold', 'Producenci zablokowani', 'Producenci, których produktów klient nie widzi w sklepie — z Selly (podgląd)', async body => {
    const link = sellyLink('Zmień w Selly ↗', sellyUrl + '?a=klienci.producenci&id=' + encodeURIComponent(id), 'Listę zablokowanych producentów zmienisz w panelu Selly');
    const r = await sellyCall({ op: 'read', screen: 'klient-producenci', view: 'record', id });
    if (!r.ok) { body.replaceChildren(el('div', { class: 'notice warn', id: 'cliProdBlkErr' }, r.error || 'Nie udało się odczytać producentów z Selly'), link); return; }
    const f = (r.data.fields || []).find(x => /^producenci_blokowani/.test(x.name));
    const names = f && f.value ? String(f.value).split(', ').filter(Boolean) : [];
    body.replaceChildren(names.length
      ? el('ul', { class: 'kf-list', id: 'cliProdBlkList' }, names.map(n => el('li', null, n)))
      : el('p', { class: 'muted', id: 'cliProdBlkNone' }, f ? 'Brak zablokowanych producentów — klient widzi produkty wszystkich producentów.' : 'Selly nie podało listy w oczekiwanym układzie — sprawdź w Selly.'),
    el('p', { class: 'muted small' }, 'Tylko podgląd: listę zmienisz w Selly (formularz Selly przenosi producentów skryptem — panel go nie wysyła). '), link);
  });
}

// ─── Ekrany: Notatki klientów, Uprawnienia subkont ──────────────────────────

const clientLink = href => {
  try { const u = new URL(href); const a = u.searchParams.get('a'), id = u.searchParams.get('id');
    return /^klienci\.(edit|view)$/.test(a || '') && /^\d{1,12}$/.test(id || '') ? { href: '#/klienci/' + id, tip: 'Otwiera kartę klienta w panelu OSA' } : null; } catch (e) { return null; }
};

function subView(box, back, title, sub, native) {
  const host = el('div', { id: 'cliNatHost' });
  box.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'ord-detail-top' }, el('a', { href: back, class: 'btn-link', id: 'cliNatBack' }, '← Wróć do listy klientów')),
    el('div', { class: 'card-head' }, el('h2', null, title), el('div', { class: 'sub' }, sub))), host);
  native.mount(host);
  return native;
}

export function renderNotes(box, { back }) {
  return subView(box, back, 'Notatki klientów', 'Klienci z wpisaną notatką (z Selly, na Twojej sesji). Treść notatki zmienisz na karcie klienta, status — w sekcji „Status notatki”.',
    createNative({ id: 'klienci-notatki', title: 'Notatki klientów', screen: 'klienci-notatki', a: 'klienci.notatki', recordRoute: null, noun: 'notatki', cellLink: clientLink,
      headerTips: { 'Data Status': 'Data notatki i jej status (otwarte / zamknięte)', Notatki: 'Treść notatki klienta', 'Imię i nazwisko E-mail': 'Klient — kliknij, aby otworzyć kartę', 'Działania': 'Działania' },
      labels: { st: 'Status', s: 'Sortuj według', o: 'Kolejność' } }));
}

const PERM_PART = { allowed: 'dozwolone', scope: 'zakres danych' };
export function renderSubPerms(box, { back }) {
  return subView(box, back, 'Uprawnienia subkont', 'Co mogą robić w sklepie subkonta na poziomie pełnym, średnim i niskim. Zmiana działa od razu dla wszystkich subkont z danym poziomem.',
    createNative({ id: 'subkonta-uprawnienia', title: 'Uprawnienia subkont', screen: 'subkonta-uprawnienia', a: 'subClientPermissions', recordRoute: 'subClientPermissions.edit', noun: 'poziomu uprawnień',
      recordTitle: () => 'Poziom uprawnień subkont', headerTips: { 'Poziom uprawnień': 'Poziom przypisywany subkontu na karcie klienta', Akcje: 'Działania' },
      labelOf: f => { const m = /^rules\[([^\]]+)\]\[(allowed|scope)\]$/.exec(f.name); return m ? m[1] + ' — ' + PERM_PART[m[2]] : ''; } }));
}
