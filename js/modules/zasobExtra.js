// Dodatki ekranu zasobu (zasob.js): składniki zestawu, podgląd logo, moderacja opinii (przyciski w wierszu).
// Osobny plik, żeby zasob.js został czytelny; każdy element dostaje dane i wywołania z zasob.js.
import { el, debounce, flash, money } from '../core/ui.js?v=6bba789';
import { api } from '../core/client.js?v=6bba789';

const num = v => (v === '' || v == null || !isFinite(Number(v)) ? 0 : Number(v));
const fmtQty = v => (v == null ? '—' : String(Math.round(Number(v) * 1000) / 1000));

/** Logo / obrazek tylko z adresu http(s) — inne wartości (np. javascript:) nie trafiają do src. */
export function imageBox(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return el('div', { class: 'muted zs-img-none' }, 'Brak logo');
  return el('div', { class: 'zs-img' }, el('img', { src: u, alt: 'Logo producenta', loading: 'lazy', referrerpolicy: 'no-referrer' }),
    el('div', { class: 'muted zs-img-url', title: u }, u.length > 70 ? u.slice(0, 70) + '…' : u));
}

/**
 * Karta „Składniki zestawu”: tabela składników z nazwą, stanem i ilością w zestawie (edycja ilości, zwiększania, usuwanie),
 * wiersz dodawania z wyszukiwarką produktów oraz podsumowanie: ile zestawów da się złożyć ze stanów i ile wynosi suma cen składników.
 * data = odpowiedź res:get (items z polami _name/_stock/_can, setStock, item).
 */
export function setComponentsCard(id, data, reload) {
  const items = data.items || [], st = data.setStock || {}, set = data.item || {};
  const host = el('div', { class: 'card zs-sec', id: 'zsItems' });
  const sum = items.reduce((a, it) => a + num(it.quantity) * num(it._price), 0);
  const priceInfo = Number(set.price_type) === 1 ? 'Cena zestawu liczona ze składników (z rabatem).'
    : (sum > 0 && num(set.price) > 0 ? 'Suma cen składników: ' + money(sum) + ' · cena zestawu: ' + money(set.price) + (sum > num(set.price) ? ' (oszczędność klienta: ' + money(sum - num(set.price)) + ')' : '') : '');
  const lim = items.find(it => String(it.product_id) === String(st.limiting));
  const stockLine = !items.length ? 'Zestaw nie ma jeszcze składników — dodaj je poniżej.'
    : st.max == null ? 'Nie znam stanów składników z kopii produktów — liczy je Selly (pole „Stan”).'
      : 'Ze stanów składników można złożyć maksymalnie ' + st.max + ' zestawów' + (lim && lim._name ? ' — ogranicza „' + lim._name + '”' : '') + (st.partial ? ' (nie licząc wariantów i produktów spoza kopii)' : '') + '. Stan zestawu liczy Selly.';

  const msg = el('div', { role: 'status', class: 'zs-item-msg muted' });
  const rowFor = it => {
    const q = el('input', { type: 'number', step: 'any', min: '0', value: String(it.quantity == null ? 1 : it.quantity), 'aria-label': 'Ilość w zestawie', title: 'Ile sztuk tego produktu wchodzi do jednego zestawu', class: 'zs-pos' });
    const inc = el('input', { type: 'checkbox', checked: Number(it.allow_increase) ? true : null, 'aria-label': 'Klient może zwiększyć ilość', title: 'Klient może zwiększyć ilość tego składnika przy zamawianiu zestawu' });
    const btn = el('button', { type: 'button', class: 'secondary', write: 'zestawy', title: 'Zapisuje ilość i ustawienia tego składnika w Selly' }, 'Zapisz');
    btn.addEventListener('click', async () => {
      if (!(num(q.value) > 0)) { msg.textContent = 'Ilość musi być większa od zera.'; return; }
      btn.disabled = true;
      try { await api('res:itemSave', { res: 'zestawy', id, itemId: it.id, fields: { quantity: num(q.value), allow_increase: inc.checked ? 1 : 0 } }); flash('', 'Zapisano składnik'); reload(); }
      catch (e) { btn.disabled = false; msg.textContent = 'Błąd: ' + ((e && e.message) || ''); }
    });
    const del = el('button', { type: 'button', class: 'secondary danger', write: 'zestawy', title: 'Usuwa składnik z zestawu w Selly (sam produkt zostaje w sklepie)' }, 'Usuń');
    del.addEventListener('click', async () => {
      if (!confirm('Usunąć „' + (it._name || 'produkt ' + it.product_id) + '” z zestawu? Sam produkt zostanie w sklepie.')) return;
      del.disabled = true;
      try { await api('res:itemDelete', { res: 'zestawy', id, itemId: it.id }); flash('', 'Usunięto składnik'); reload(); }
      catch (e) { del.disabled = false; msg.textContent = 'Błąd: ' + ((e && e.message) || ''); }
    });
    const isLim = String(it.product_id) === String(st.limiting) && items.length > 1;
    return el('tr', { 'data-item': String(it.id), class: isLim ? 'zs-limit' : null },
      el('td', null, el('a', { href: '#/produkty/' + encodeURIComponent(it.product_id), class: 'cell-name', title: 'Otwórz kartę produktu' }, it._name || ('Produkt ' + it.product_id)),
        el('div', { class: 'cell-sub' }, (it._code ? it._code + ' · ' : '') + 'ID ' + it.product_id + (Number(it.variant_id) ? ' · wariant ' + it.variant_id : ''))),
      el('td', { class: 'n' }, q), el('td', { class: 'n' }, inc),
      el('td', { class: 'n nw' }, it._stock == null ? '—' : fmtQty(it._stock)),
      el('td', { class: 'n nw', title: isLim ? 'To najmniejsza wartość — ten składnik ogranicza liczbę zestawów' : null }, it._can === undefined ? '—' : String(it._can) + (isLim ? ' ◄' : '')),
      el('td', { class: 'n nw' }, it._price == null ? '—' : money(it._price)),
      el('td', { class: 'n nw' }, it._price == null ? '—' : money(num(it._price) * num(it.quantity))),
      el('td', { class: 'nw' }, btn, ' ', del));
  };

  // wiersz dodawania: wyszukiwarka produktów (kopia katalogu w D1 — bez zapytań do Selly)
  const search = el('input', { type: 'search', id: 'zsCompSearch', placeholder: 'Szukaj produktu: nazwa, kod, EAN lub ID', 'aria-label': 'Szukaj produktu do dodania', title: 'Wpisz co najmniej 2 znaki — pokażę pasujące produkty z katalogu' });
  const pick = el('select', { id: 'zsCompPick', 'aria-label': 'Wybierz produkt', title: 'Wybierz produkt do dodania do zestawu', disabled: true }, el('option', { value: '' }, '— najpierw wyszukaj —'));
  const qty = el('input', { type: 'number', id: 'zsCompQty', step: 'any', min: '0', value: '1', 'aria-label': 'Ilość', title: 'Ile sztuk w jednym zestawie', class: 'zs-pos' });
  const variant = el('input', { type: 'number', id: 'zsCompVar', min: '0', placeholder: '0', 'aria-label': 'ID wariantu', title: 'Numer wariantu produktu (puste lub 0 = produkt bez wariantu)', class: 'zs-pos' });
  const incAdd = el('input', { type: 'checkbox', id: 'zsCompInc', 'aria-label': 'Klient może zwiększyć ilość', title: 'Klient może zwiększyć ilość tego składnika przy zamawianiu zestawu' });
  const add = el('button', { type: 'button', class: 'primary', write: 'zestawy', id: 'zsCompAdd', disabled: true, title: 'Dodaje wybrany produkt do zestawu w Selly' }, 'Dodaj składnik');
  let found = [];
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (q.length < 2) { pick.replaceChildren(el('option', { value: '' }, '— najpierw wyszukaj —')); pick.disabled = true; add.disabled = true; return; }
    try {
      const r = await api('products:list', { q, page: 1, pageSize: 20 });
      found = (r.rows || []).filter(x => String(x.id) !== String(id));
      pick.replaceChildren(el('option', { value: '' }, found.length ? '— wybierz (' + found.length + ') —' : '— brak wyników —'),
        ...found.map(x => el('option', { value: String(x.id) }, x.name + (x.code ? ' (' + x.code + ')' : '') + ' · stan ' + fmtQty(x.qty))));
      pick.disabled = !found.length;
    } catch (e) { pick.replaceChildren(el('option', { value: '' }, 'Nie udało się wyszukać')); }
    add.disabled = true;
  }, 300));
  pick.addEventListener('change', () => { add.disabled = !pick.value; });
  add.addEventListener('click', async () => {
    if (!pick.value) return;
    if (!(num(qty.value) > 0)) { msg.textContent = 'Ilość musi być większa od zera.'; return; }
    if (items.some(it => String(it.product_id) === pick.value && String(it.variant_id || 0) === String(num(variant.value))) && !confirm('Ten produkt jest już w zestawie. Dodać jeszcze raz?')) return;
    add.disabled = true;
    try { await api('res:itemSave', { res: 'zestawy', id, fields: { product_id: Number(pick.value), variant_id: num(variant.value), quantity: num(qty.value), allow_increase: incAdd.checked ? 1 : 0 } }); flash('', 'Dodano składnik'); reload(); }
    catch (e) { add.disabled = false; msg.textContent = 'Błąd: ' + ((e && e.message) || ''); }
  });

  const th = (label, tip, n) => el('th', { class: n ? 'n' : null }, el('span', { title: tip, class: tip === label ? null : 'tip' }, label));
  host.replaceChildren(
    el('div', { class: 'card-head' }, el('h2', null, 'Składniki zestawu (' + items.length + ')'), el('div', { class: 'sub', id: 'zsSetStock' }, stockLine + (priceInfo ? ' ' + priceInfo : ''))),
    el('div', { class: 'table-wrap' }, el('table', { id: 'zsItemsTable' },
      el('thead', null, el('tr', null, th('Produkt', 'Składnik zestawu: nazwa, kod i numer produktu'), th('Ilość w zestawie', 'Ile sztuk tego produktu wchodzi do jednego zestawu', true),
        th('Zwiększanie', 'Czy klient może zwiększyć ilość tego składnika przy zamawianiu', true), th('Stan produktu', 'Dostępna ilość produktu (kopia katalogu w panelu OSA; stany wariantów nie są wliczone)', true),
        th('Wystarczy na', 'Ile zestawów da się złożyć z samego tego składnika (stan ÷ ilość w zestawie). Najmniejsza wartość ogranicza cały zestaw.', true),
        th('Cena szt.', 'Cena jednostkowa brutto składnika', true), th('Wartość', 'Ilość w zestawie × cena jednostkowa', true), th('Akcje', 'Zapisz zmianę ilości albo usuń składnik'))),
      el('tbody', null, items.length ? items.map(rowFor) : el('tr', null, el('td', { colspan: '8', class: 'empty' }, 'Brak składników.'))))),
    el('div', { class: 'zs-comp-add' }, el('h3', null, 'Dodaj składnik'),
      el('div', { class: 'zs-comp-row' }, search, pick, el('label', { class: 'field-inline', title: 'Ile sztuk w jednym zestawie' }, 'Ilość ', qty),
        el('details', { class: 'zs-comp-more' }, el('summary', { title: 'Wariant produktu i zwiększanie ilości przez klienta' }, 'Więcej'),
          el('label', { class: 'field-inline' }, 'ID wariantu ', variant), el('label', { class: 'field-inline' }, incAdd, ' klient może zwiększyć ilość')), add)),
    msg);
  return host;
}

/** Przycisk „Ukryj / Pokaż” opinii w wierszu listy (moderacja jednym kliknięciem); onDone(nowaWartość) po zapisie. */
export function reviewToggle(row, productId, onDone) {
  const on = row.active === true || row.active === 1 || row.active === '1';
  if (!productId) return el('span', { class: 'muted', title: 'Wpisz w filtrze „Produkt (ID)” numer jednego produktu, aby moderować jego opinie' }, on ? 'tak' : 'nie');
  const b = el('button', { type: 'button', write: 'opinie', class: 'secondary zs-rev-toggle', title: on ? 'Opinia jest widoczna w sklepie — kliknij, aby ją ukryć' : 'Opinia jest ukryta — kliknij, aby ją pokazać w sklepie' }, on ? 'Ukryj' : 'Pokaż');
  b.addEventListener('click', async ev => {
    ev.stopPropagation(); b.disabled = true;
    try { await api('res:save', { res: 'opinie', id: row.review_id, productId, fields: { active: on ? 0 : 1 } }); flash('', on ? 'Opinia ukryta' : 'Opinia jest widoczna'); onDone(on ? 0 : 1); }
    catch (e) { b.disabled = false; flash('', 'Nie udało się: ' + ((e && e.message) || 'błąd')); }
  });
  return el('span', { class: 'nw' }, el('span', { class: on ? 'tag ok' : 'muted' }, on ? 'tak' : 'nie'), ' ', b);
}

/**
 * Karta „Marża minimalna producenta” — zapis przez PUT /producers/{id}/margins (NIEZWERYFIKOWANE; Selly nie pozwala tej wartości odczytać,
 * więc pole startuje puste i zapisuje się tylko po wpisaniu). Rabaty wg poziomów cen są w sekcji „Marże wg poziomów cen” formularza.
 */
export function marginsCard(id, producerId, canEdit) {
  const inp = el('input', { type: 'text', inputmode: 'decimal', id: 'zsMarginMin', 'aria-label': 'Marża minimalna (%)', disabled: !canEdit, class: 'zs-pos', placeholder: 'np. 15',
    title: 'Najniższa dozwolona marża produktów tego producenta (%). Selly nie pozwala odczytać aktualnej wartości — wpisz nową, aby ją ustawić.' });
  const msg = el('div', { role: 'status' });
  const save = el('button', { type: 'button', write: id, id: 'zsMarginsSave', disabled: !canEdit, title: canEdit ? 'Ustawia marżę minimalną producenta w Selly' : 'Brak uprawnień do edycji' }, 'Ustaw marżę minimalną');
  save.addEventListener('click', async () => {
    if (!inp.value.trim()) { msg.replaceChildren(el('div', { class: 'notice warn' }, 'Wpisz wartość marży minimalnej.')); return; }
    save.disabled = true;
    try { await api('res:marginsSave', { res: id, id: producerId, fields: { margin_minimal: inp.value.trim() } }); flash('', 'Zapisano marżę minimalną w Selly'); msg.replaceChildren(); save.disabled = false; }
    catch (e) { save.disabled = false; msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Nie udało się zapisać: ' + ((e && e.message) || 'błąd'))); }
  });
  return el('div', { class: 'card zs-sec', id: 'zsMargins' },
    el('div', { class: 'card-head' }, el('h2', null, 'Marża minimalna producenta'),
      el('div', { class: 'sub' }, 'Jak „Marża minimalna” w panelu Selly („Producenci — rabaty”). Funkcja niezweryfikowana na prawdziwym Selly: jeśli zapis zwróci błąd, ustaw ją w panelu Selly.')),
    el('label', { class: 'field-inline' }, 'Marża minimalna (%)', inp), el('div', { class: 'zs-actions' }, save), msg);
}
