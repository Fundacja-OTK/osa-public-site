// Karta produktu → zakładka „Warianty”: edycja w wierszu (z polami zaawansowanymi), dodawanie i usuwanie wariantów.
// API Selly: PUT/POST/DELETE /api/products/{id}/variants[/{variant_id}] (akcje products:variantUpdate / variantAdd / variantDelete).
// Wartości wariantu (np. Kolor: czerwony) pochodzą z „Warianty i opcje” (res:options / res:get 'atrybuty' — słownik dostępny dla każdego).
// Każdy zapis: walidacja → podgląd zmian (było → będzie) → potwierdzenie.
import { el, flash, money, filterSection } from '../core/ui.js?v=64a1b3e';
import { api } from '../core/client.js?v=64a1b3e';
import { previewModal } from './produktPodglad.js?v=64a1b3e';

const str = v => (v == null ? '' : String(v));
const isOn = v => v === true || v === 1 || v === '1' || v === 'true';
const th = (label, tip, cls) => el('th', { class: cls || null }, el('span', { title: tip || label, class: tip && tip !== label ? 'tip' : null }, label));

// Pola wiersza (widoczne od razu) i zaawansowane (rozwijane) — klucze jak VARIANT_FIELDS w shared/failover.js
const MAIN = [['code', 'Kod', 'text'], ['ean', 'EAN', 'text'], ['price', 'Cena (zł)', 'money'], ['quantity', 'Stan', 'int'], ['position', 'Pozycja', 'int']];
const MORE = [
  ['price_discount_group_1', 'Cena hurtowa – poziom 1 (zł)', 'money', 'Cena wariantu dla klientów z poziomem cenowym 1 (hurt). Puste lub 0 = bez osobnej ceny.'],
  ['price_discount_group_2', 'Cena hurtowa – poziom 2 (zł)', 'money', 'Cena wariantu dla klientów z poziomem cenowym 2'],
  ['price_discount_group_3', 'Cena hurtowa – poziom 3 (zł)', 'money', 'Cena wariantu dla klientów z poziomem cenowym 3'],
  ['vat', 'Stawka VAT (%)', 'vat', 'Stawka VAT wariantu (np. 23, 8, 5, 0)'],
  ['delivery_time', 'Czas dostawy', 'text', 'Tekst o czasie dostawy tego wariantu, np. „3 dni”'],
  ['warehouse_localisation', 'Lokalizacja w magazynie', 'text', 'Miejsce składowania wariantu, np. regał i półka'],
];
const LABEL = Object.fromEntries([...MAIN, ...MORE].map(x => [x[0], x[1]]).concat([['default', 'Domyślny'], ['is_promotion', 'Promocja']]));

/** Walidacja jednej wartości: '' = OK. */
export function checkVariantValue(kind, v, label) {
  const s = String(v == null ? '' : v).trim();
  if (kind === 'money' || kind === 'int' || kind === 'vat') {
    if (s === '') return kind === 'money' && /^Cena \(/.test(label) ? label + ': podaj cenę (może być 0).' : '';
    const n = Number(s.replace(',', '.'));
    if (!isFinite(n) || n < 0) return label + ': podaj liczbę nie mniejszą niż 0.';
    if ((kind === 'int' || kind === 'vat') && !Number.isInteger(n)) return label + ': podaj liczbę całkowitą.';
    if (kind === 'vat' && n > 100) return label + ': najwyżej 100.';
  }
  if (kind === 'text' && s.length > 255) return label + ': za długi tekst (maks. 255 znaków).';
  return '';
}
const variantName = (v, textVal) => {
  const f = Array.isArray(v.features) ? v.features.map(x => (x && x.name ? x.name + ': ' : '') + str(x && x.value)).filter(Boolean).join(', ') : '';
  return f || textVal(v.name || v.variant_name) || 'Wariant ' + str(v.variant_id != null ? v.variant_id : v.id);
};
const showVal = (k, v) => (k === 'default' || k === 'is_promotion' ? (v ? 'tak' : 'nie') : /price/.test(k) && v !== '' && v != null && isFinite(Number(v)) ? money(v) + ' zł' : v);

function input(kind, value, label, extra) {
  return el('input', Object.assign({ type: kind === 'text' ? 'text' : 'number', value: str(value), 'aria-label': label, maxlength: kind === 'text' ? '255' : null,
    min: kind === 'text' ? null : '0', step: kind === 'money' ? '0.01' : kind === 'text' ? null : '1', max: kind === 'vat' ? '100' : null, list: kind === 'vat' ? 'prodVatListV' : null }, extra || {}));
}

export function variantsPanel(host, o) {
  const { id, variants, variantsError, reload, sellyRoute, textVal } = o;
  const vs = Array.isArray(variants) ? variants : [];
  const addHost = el('div', { id: 'prodVarAddHost' });
  const addBtn = el('button', { type: 'button', class: 'secondary', write: 'produkty', id: 'prodVarAdd', title: 'Dodaje nowy wariant (np. inny kolor lub rozmiar) — wybierzesz wartości z „Warianty i opcje”, zobaczysz podgląd przed zapisem',
    onclick: () => { addBtn.hidden = true; addVariantForm(addHost, { ...o, existing: vs, onClose: () => { addHost.replaceChildren(); addBtn.hidden = false; } }); } }, '+ Dodaj wariant');
  host.append(el('datalist', { id: 'prodVatListV' }, ['0', '5', '8', '23'].map(v => el('option', { value: v }))));
  if (variantsError) host.append(el('div', { class: 'notice warn', role: 'status' }, 'Nie udało się pobrać wariantów z Selly (' + textVal(variantsError) + ').'));
  else if (!vs.length) host.append(el('div', { class: 'empty' }, 'Produkt nie ma wariantów. Dodaj pierwszy, jeśli sprzedajesz go np. w kilku kolorach lub rozmiarach.'));
  else {
    const body = el('tbody', null);
    for (const v of vs) for (const tr of variantRows(v, o)) body.append(tr);
    host.append(el('div', { class: 'table-wrap' }, el('table', { id: 'prodVariants', class: 'pk-vtable' }, el('thead', null, el('tr', null,
      th('Wariant', 'Cechy wariantu (np. kolor, rozmiar) — z „Warianty i opcje”'), th('Kod', 'Kod producenta wariantu'), th('EAN', 'Kod EAN wariantu'), th('Cena (zł)', 'Cena brutto wariantu', 'n'),
      th('Stan', 'Stan wariantu w Selly (szt.) — korekta liczby w Selly, bez ruchu w module Magazyny', 'n'), th('Poz.', 'Pozycja na liście wariantów (mniejsza = wyżej)', 'n'),
      th('Domyślny', 'Wariant wybrany domyślnie na stronie produktu'), th('Promocja', 'Wariant oznaczony jako promowany na karcie produktu'), th('Akcje', 'Więcej pól, zapis i usuwanie wariantu'))), body)));
  }
  if (!variantsError) host.append(el('div', { class: 'pk-actions pk-vadd' }, addBtn), addHost);
  host.append(el('div', { class: 'pk-note' }, 'Zmiany wiersza zapisujesz jego przyciskiem „Zapisz” (z podglądem). Zdjęcie wariantu, sposób wyświetlania wariantów w sklepie, blokady importu i blokady form dostawy — w Selly: ',
    el('a', { href: sellyRoute('produkty.produktWarianty', id), target: '_blank', rel: 'noopener', class: 'btn-link', title: 'Otwiera warianty tego produktu w Selly' }, 'Warianty w Selly ↗')));
}

function variantRows(v, o) {
  const { id, reload, textVal } = o;
  const vid = str(v.variant_id != null ? v.variant_id : v.id);
  const name = variantName(v, textVal);
  const orig = {};
  for (const [k] of [...MAIN, ...MORE]) orig[k] = str(v[k]);
  orig.default = isOn(v.default); orig.is_promotion = isOn(v.is_promotion);
  const ins = {};
  for (const [k, label, kind] of MAIN) ins[k] = input(kind, orig[k], label + ' — wariant ' + vid, { class: 'pk-vin ' + (kind === 'text' ? 'w' : 'n'), 'data-k': k });
  const more = {};
  for (const [k, label, kind, tip] of MORE) more[k] = input(kind, orig[k], label + ' — wariant ' + vid, { 'data-k': k, id: 'prodV' + vid + '_' + k, title: tip });
  const def = el('input', { type: 'checkbox', checked: orig.default, 'aria-label': 'Wariant domyślny ' + vid, 'data-k': 'default' });
  const promo = el('input', { type: 'checkbox', checked: orig.is_promotion, 'aria-label': 'Promocja ' + vid, 'data-k': 'is_promotion' });
  const kindOf = k => ([...MAIN, ...MORE].find(x => x[0] === k) || [])[2];
  const changes = () => {
    const f = {};
    for (const k of Object.keys(ins)) if (ins[k].value !== orig[k]) f[k] = ins[k].value;
    for (const k of Object.keys(more)) if (more[k].value !== orig[k]) f[k] = more[k].value;
    if (def.checked !== orig.default) f.default = def.checked;
    if (promo.checked !== orig.is_promotion) f.is_promotion = promo.checked;
    return f;
  };
  const err = el('div', { class: 'pk-err', role: 'alert', hidden: true });
  const save = el('button', { type: 'button', class: 'secondary small', write: 'produkty', 'data-variant': vid, disabled: true, title: 'Pokazuje podgląd zmian tego wariantu i zapisuje je w Selly', onclick: () => {
    const f = changes();
    const bad = Object.keys(f).map(k => (k === 'default' || k === 'is_promotion' ? '' : checkVariantValue(kindOf(k), f[k], LABEL[k]))).find(Boolean);
    err.textContent = bad || ''; err.hidden = !bad;
    if (bad) { if (moreRow.hidden && MORE.some(m => m[1] === bad.split(':')[0])) toggleMore(); return; }
    previewModal({ id: 'prodVarPreview', title: 'Zapisać wariant „' + name + '”?', write: 'produkty', okLabel: 'Zapisz w Selly',
      rows: Object.keys(f).map(k => ({ label: LABEL[k] || k, before: showVal(k, orig[k]), after: showVal(k, f[k]) })),
      note: 'default' in f && f.default ? 'Ten wariant stanie się domyślnym — Selly zdejmie oznaczenie z poprzedniego.' : 'Zmiana trafi od razu do sklepu.',
      onOk: async (close, fail) => {
        try { await api('products:variantUpdate', { id, variantId: vid, fields: f }); close(); flash('', 'Wariant zapisany w Selly'); reload(); }
        catch (e) { fail('Nie udało się zapisać wariantu: ' + (e.message || 'błąd')); }
      } });
  } }, 'Zapisz');
  const del = el('button', { type: 'button', class: 'secondary small danger', write: 'produkty', 'data-vdel': vid, title: 'Usuwa ten wariant z Selly (zapytamy o potwierdzenie)', 'aria-label': 'Usuń wariant ' + name, onclick: () =>
    previewModal({ id: 'prodVarDel', title: 'Usunąć wariant „' + name + '”?', danger: true, write: 'produkty', okLabel: 'Usuń wariant',
      intro: 'Wariant zniknie ze sklepu razem ze swoim stanem (' + (orig.quantity || '0') + ' szt.) i ceną. Tej operacji nie da się cofnąć.',
      note: 'Zamówienia, w których ten wariant już jest, zostają bez zmian.',
      onOk: async (close, fail) => {
        try { await api('products:variantDelete', { id, variantId: vid }); close(); flash('', 'Wariant usunięty'); reload(); }
        catch (e) { fail('Nie udało się usunąć wariantu: ' + (e.message || 'błąd')); }
      } }) }, 'Usuń');
  const moreBtn = el('button', { type: 'button', class: 'secondary small', 'aria-expanded': 'false', 'aria-controls': 'prodVMore' + vid, 'data-vmore': vid, title: 'Pokazuje ceny hurtowe, VAT, czas dostawy i lokalizację wariantu', onclick: () => toggleMore() }, 'Więcej ▾');
  const moreRow = el('tr', { class: 'pk-vmore', id: 'prodVMore' + vid, hidden: true }, el('td', { colspan: '9' },
    el('div', { class: 'pk-grid' }, MORE.map(([k, label, , tip]) => el('label', { class: 'pk-f', title: tip }, el('span', { class: 'pk-l tip' }, label), more[k])))));
  function toggleMore() { moreRow.hidden = !moreRow.hidden; moreBtn.setAttribute('aria-expanded', String(!moreRow.hidden)); moreBtn.textContent = moreRow.hidden ? 'Więcej ▾' : 'Mniej ▴'; }
  const chg = () => { const d = Object.keys(changes()).length > 0; save.disabled = !d; tr.classList.toggle('dirty-row', d); moreRow.classList.toggle('dirty-row', d); };
  const tr = el('tr', { 'data-variant': vid }, el('td', null, name, err), el('td', null, ins.code), el('td', null, ins.ean), el('td', { class: 'n' }, ins.price), el('td', { class: 'n' }, ins.quantity),
    el('td', { class: 'n' }, ins.position), el('td', null, def), el('td', null, promo), el('td', { class: 'nw pk-vact' }, moreBtn, save, del));
  for (const n of [tr, moreRow]) { n.addEventListener('input', chg); n.addEventListener('change', chg); }
  return [tr, moreRow];
}

// ─── Dodawanie wariantu ──────────────────────────────────────────────────────────────────────────
let groupsP = null;
const itemsCache = new Map();
const groups = () => { if (!groupsP) groupsP = api('res:options', { res: 'atrybuty' }).then(r => r.options || [], e => { groupsP = null; throw e; }); return groupsP; };
const itemsOf = gid => { if (!itemsCache.has(gid)) itemsCache.set(gid, api('res:get', { res: 'atrybuty', id: gid }).then(r => (r.items || []).slice().sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)), e => { itemsCache.delete(gid); throw e; })); return itemsCache.get(gid); };

/** Kombinacja wartości istniejących wariantów (feature_id), żeby ostrzec przed duplikatem. */
const comboOf = v => (Array.isArray(v.features) ? v.features.map(f => str(f && (f.feature_id != null ? f.feature_id : f.attribute_id))).filter(Boolean).sort().join(',') : '');

export function addVariantForm(host, o) {
  const { id, product, reload, existing } = o;
  const msg = el('div', { class: 'pk-err', role: 'alert', hidden: true });
  const pairsHost = el('div', { class: 'pk-vpairs', id: 'prodVarPairs' });
  const pairs = [];
  let groupList = [];
  function addPair() {
    const g = el('select', { 'aria-label': 'Grupa (np. Kolor)', 'data-vg': String(pairs.length) }, el('option', { value: '' }, '— grupa, np. Kolor —'), groupList.map(x => el('option', { value: str(x.value) }, x.label)));
    const v = el('select', { 'aria-label': 'Wartość', 'data-vv': String(pairs.length), disabled: true }, el('option', { value: '' }, '— najpierw wybierz grupę —'));
    const pair = { g, v };
    g.addEventListener('change', async () => {
      v.replaceChildren(el('option', { value: '' }, g.value ? 'Wczytuję wartości…' : '— najpierw wybierz grupę —')); v.disabled = true;
      if (!g.value) return;
      try {
        const items = await itemsOf(g.value);
        v.replaceChildren(el('option', { value: '' }, items.length ? '— wybierz wartość —' : 'Ta grupa nie ma wartości'), ...items.map(x => el('option', { value: str(x.attribute_id) }, str(x.name) || '#' + x.attribute_id)));
        v.disabled = !items.length;
      } catch (e) { v.replaceChildren(el('option', { value: '' }, 'Nie udało się wczytać wartości')); }
    });
    const rm = el('button', { type: 'button', class: 'secondary small', title: 'Usuń tę cechę z nowego wariantu', 'aria-label': 'Usuń cechę', onclick: () => { pairs.splice(pairs.indexOf(pair), 1); row.remove(); } }, '✕');
    const row = el('div', { class: 'pk-vpair' }, g, v, rm);
    pairs.push(pair); pairsHost.append(row);
  }
  const f = {};
  const mk = (k, label, kind, tip, val) => { f[k] = input(kind, val, label, { id: 'prodVarNew_' + k, title: tip }); return el('label', { class: 'pk-f', title: tip }, el('span', { class: 'pk-l tip' }, label), f[k]); };
  const def = el('input', { type: 'checkbox', id: 'prodVarNew_default', 'aria-label': 'Wariant domyślny' }), promo = el('input', { type: 'checkbox', id: 'prodVarNew_is_promotion', 'aria-label': 'Promocja' });
  const go = el('button', { type: 'button', class: 'primary', write: 'produkty', id: 'prodVarNewGo', title: 'Sprawdza dane i pokazuje podgląd nowego wariantu przed zapisem w Selly', onclick: () => submit() }, 'Dalej: podgląd');
  host.replaceChildren(el('div', { class: 'pk-sec card ord-dialog', role: 'group', 'aria-label': 'Nowy wariant' },
    el('h3', null, 'Nowy wariant'),
    el('p', { class: 'muted small' }, 'Wybierz cechy wariantu, np. Kolor: czerwony (i ewentualnie Rozmiar: L). Grupy i wartości ustawiasz w „Warianty i opcje”.'),
    pairsHost,
    el('button', { type: 'button', class: 'linkbtn', id: 'prodVarPairAdd', title: 'Dodaje kolejną cechę (np. rozmiar obok koloru)', onclick: addPair }, '+ kolejna cecha'),
    el('div', { class: 'pk-grid' },
      mk('price', 'Cena (zł)', 'money', 'Cena brutto wariantu. Domyślnie cena produktu.', str(product.price)),
      mk('quantity', 'Stan (szt.)', 'int', 'Stan wariantu w Selly', '0'),
      mk('code', 'Kod', 'text', 'Kod producenta wariantu (opcjonalnie)', ''),
      mk('ean', 'EAN', 'text', 'Kod kreskowy wariantu (opcjonalnie)', ''),
      el('div', { class: 'pk-f' }, el('span', { class: 'pk-l' }, 'Oznaczenia'), el('div', { class: 'pk-chks' },
        el('label', { class: 'pk-chk', title: 'Ten wariant będzie wybrany domyślnie na stronie produktu' }, def, el('span', { class: 'tip' }, 'Domyślny')),
        el('label', { class: 'pk-chk', title: 'Wariant oznaczony jako promowany na karcie produktu' }, promo, el('span', { class: 'tip' }, 'Promocja'))))),
    filterSection('Ceny hurtowe, VAT, dostawa', el('div', { class: 'pk-grid' }, MORE.map(([k, label, kind, tip]) => mk(k, label, kind, tip, k === 'vat' ? str(product.vat_rate) : ''))), { fold: true, tip: 'Opcje dodatkowe' }),
    msg,
    el('div', { class: 'ord-actions' }, go, el('button', { type: 'button', class: 'secondary', id: 'prodVarNewCancel', onclick: () => o.onClose() }, 'Anuluj'))));
  groups().then(list => { groupList = list; addPair(); }, e => { msg.textContent = 'Nie udało się wczytać grup wariantów: ' + (e.message || 'błąd'); msg.hidden = false; });

  function submit() {
    const show = t => { msg.textContent = t; msg.hidden = !t; return !t; };
    const chosen = pairs.filter(x => x.g.value || x.v.value);
    if (!chosen.length || chosen.some(x => !x.v.value)) return show('Wybierz grupę i wartość dla każdej cechy (np. Kolor: czerwony).');
    const gids = chosen.map(x => x.g.value);
    if (new Set(gids).size !== gids.length) return show('Każda grupa może wystąpić tylko raz (np. jeden kolor na wariant).');
    const attrs = chosen.map(x => x.v.value);
    if (existing.some(v => comboOf(v) && comboOf(v) === attrs.slice().sort().join(','))) return show('Wariant z takimi cechami już istnieje.');
    const fields = {};
    const kinds = Object.fromEntries([...MAIN, ...MORE].map(x => [x[0], [x[2], x[1]]]));
    for (const k of Object.keys(f)) {
      const val = f[k].value.trim(), [kind, label] = kinds[k];
      const bad = checkVariantValue(kind, val, label); if (bad) return show(bad);
      if (val !== '') fields[k] = val;
    }
    if (def.checked) fields.default = true;
    if (promo.checked) fields.is_promotion = true;
    show('');
    const txt = s => s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : '';
    const rows = chosen.map(x => ({ label: txt(x.g), before: '', after: txt(x.v) })).concat(Object.keys(fields).map(k => ({ label: LABEL[k] || k, before: '', after: showVal(k, fields[k]) })));
    previewModal({ id: 'prodVarNewPreview', title: 'Dodać wariant?', write: 'produkty', okLabel: 'Dodaj w Selly', rows,
      intro: 'Nowy wariant produktu „' + (product.name || id) + '”:', note: 'Zdjęcie wariantu ustawisz później w Selly.',
      onOk: async (close, fail) => {
        try { await api('products:variantAdd', { id, attributes: attrs, fields }); close(); flash('', 'Wariant dodany w Selly'); reload(); }
        catch (e) { fail('Nie udało się dodać wariantu: ' + (e.message || 'błąd')); }
      } });
    return true;
  }
}
