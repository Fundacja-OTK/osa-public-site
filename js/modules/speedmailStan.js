// „Wysyłka SpeedMail” → zakładka Stan w SpeedMail (sekcje 5–6 specyfikacji): stan = wysłane + dosyłki − zlecone ± korekty,
// zlecone w ostatnich 7 dniach, dni zapasu, przewidywane wyczerpanie, alert (zielony / żółty / czerwony / stop), alert przedsprzedaży.
// Dosyłki i korekty (zwrot od klienta, uszkodzenie, inwentaryzacja) — formularz w zwijanym panelu; import dosyłki z pliku dostawcy
// (speedmailImport.js); historia z sm:list.
import { el, sortTh, statusPill, store } from '../core/ui.js?v=04d1829';
import { go } from '../core/router.js?v=04d1829';
import { S, SM, WRITE, nf, dmy, notice, tile, prodOf, freshBar, loadError, fold, save, reload, jobBusy } from './speedmailKit.js?v=04d1829';
import { deliveryCard } from './speedmailImport.js?v=04d1829';

const LEVEL_ORDER = { stop: 0, red: 1, yellow: 2, green: 3, none: 4 };
const SORTS = { name: r => r.name, level: r => LEVEL_ORDER[r.level], stock: r => r.stock, packs: r => r.packs, sent: r => r.sent, topups: r => r.topups, ordered: r => r.ordered, corr: r => r.corr,
  o7: r => r.ordered7, days: r => r.days, run: r => r.runOut || null, pre: r => r.presalePct };
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });
const form = { key: '', kind: 'dosylka', qty: '', note: '' };

function readQ(q) {
  const sort = SORTS[q.get('sort')] ? q.get('sort') : 'level';
  return { lvl: q.get('poziom') === 'uwaga' ? 'uwaga' : '', sort, dir: q.get('dir') === 'desc' ? 'desc' : 'asc' };
}
function setQ(patch) {
  const Q = { ...readQ(S.query), ...patch }, p = new URLSearchParams();
  if (Q.lvl) p.set('poziom', Q.lvl);
  if (Q.sort !== 'level' || Q.dir !== 'asc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  go('/speedmail/stan' + (s ? '?' + s : ''));
}
const needsLook = r => r.level === 'stop' || r.level === 'red' || r.level === 'yellow' || r.presaleAlert;

export function viewStock() {
  const v = S.d.v, Q = readQ(S.query), t = v.cfg.thresholds;
  const all = SM.stockRows(v.cfg, v.totals, v.today);
  const val = SORTS[Q.sort], sign = Q.dir === 'desc' ? -1 : 1;
  const rows = all.filter(r => !Q.lvl || needsLook(r)).sort((a, b) => {
    const x = val(a), y = val(b);
    if ((x == null) !== (y == null)) return x == null ? 1 : -1;   // puste na końcu
    const c = x == null ? 0 : typeof x === 'number' ? x - y : collator.compare(String(x), String(y));
    return c * sign || collator.compare(a.name, b.name);
  });
  const n = lv => all.filter(r => r.level === lv).length;
  const parts = store('osa-sm-stan-parts') === true;
  const box = el('div', { id: 'smStock' });
  box.append(el('div', { class: 'tabs', style: 'margin-top:var(--s3)' },
    tile(n('stop') + n('red'), 'czerwony / stop', 'Produkty, których w SpeedMail już nie ma albo wystarczy na mniej niż ' + nf(t.redDays) + ' dni, albo jest ich mniej niż minimum — dosyłka albo wstrzymanie przekazywania', 'smTileRed'),
    tile(n('yellow'), 'żółty', 'Rozważ dosyłkę: zapas na ' + nf(t.redDays) + '–' + nf(t.greenDays) + ' dni albo stan mniejszy niż ' + nf(t.typicalFactor) + ' typowe zamówienia', 'smTileYellow'),
    tile(all.filter(r => r.presaleAlert).length, 'przedsprzedaż: brak towaru', 'Produkty z przedsprzedaży, których zlecone zamówienia (czekające na start wysyłki) przekroczyły ' + nf(t.presalePct) + '% towaru w SpeedMail', 'smTilePre'),
    tile(n('none'), 'bez wpisanej ilości', 'Produkty, dla których nie wpisano jeszcze, ile wysłano do SpeedMail (Ustawienia → Produkty SpeedMail)', 'smTileNone')));
  if (n('none') === all.length) box.append(notice('warn', 'Nie wpisano jeszcze ilości wysłanych do SpeedMail. ', el('a', { href: '#/speedmail/ustawienia' }, 'Wpisz je w Ustawieniach →'), ' — można wstawić propozycję ze specyfikacji i poprawić.'));

  const chip = (key, label, tip) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(Q.lvl === key), title: tip, onclick: () => setQ({ lvl: key }) }, label);
  const partsCb = el('input', { type: 'checkbox', id: 'smStockParts' }); partsCb.checked = parts;
  partsCb.addEventListener('change', () => { store('osa-sm-stan-parts', partsCb.checked); S.rerender(); });
  const cols = [
    { label: 'Produkt', sort: 'name', tip: 'Produkt z listy SpeedMail' },
    { label: 'Alert', sort: 'level', tip: 'Zielony: zapas na ponad ' + nf(t.greenDays) + ' dni i stan powyżej minimum. Żółty: ' + nf(t.redDays) + '–' + nf(t.greenDays) + ' dni albo mało na typowe zamówienia. Czerwony: mniej niż ' + nf(t.redDays) + ' dni albo poniżej minimum. Stop: brak towaru. Progi zmienisz w Ustawieniach.', tipHeader: true },
    { label: 'Stan', sort: 'stock', num: true, tip: 'Ile jest w SpeedMail: wysłane + dosyłki − zlecone ± korekty (w sztukach; OrszaKrówki w kg)', tipHeader: true },
    { label: 'Opakowań', sort: 'packs', num: true, tip: 'Stan przeliczony na opakowania SpeedMail (wiązki, paczki) — tak jak w tabeli zleceń', tipHeader: true },
    ...(parts ? [
      { label: 'Wysłane', sort: 'sent', num: true, tip: 'Ilość wysłana do SpeedMail na start sezonu (Ustawienia → Produkty SpeedMail)', tipHeader: true },
      { label: 'Dosyłki', sort: 'topups', num: true, tip: 'Suma dosyłek zapisanych w tej zakładce', tipHeader: true },
      { label: 'Zlecone', sort: 'ordered', num: true, tip: 'Suma ze wszystkich paczek zleceń przekazanych do SpeedMail', tipHeader: true },
      { label: 'Korekty', sort: 'corr', num: true, tip: 'Zwroty od klientów i anulowane zlecenia (+), uszkodzenia (−), różnice z inwentaryzacji (±)', tipHeader: true }] : []),
    { label: 'Zlecone 7 dni', sort: 'o7', num: true, tip: 'Ile przekazano do SpeedMail w ostatnich 7 dniach (z dzisiejszym) — z tego liczymy dzienne tempo', tipHeader: true },
    { label: 'Dni zapasu', sort: 'days', num: true, firstDir: 'asc', tip: 'Stan ÷ średnia dzienna z ostatnich 7 dni. Dla przedsprzedaży przed startem wysyłki nie liczymy (zlecenia czekają) — patrz ostatnia kolumna', tipHeader: true },
    { label: 'Wyczerpie się', sort: 'run', tip: 'Przewidywany dzień, w którym towar się skończy przy tempie z ostatnich 7 dni', tipHeader: true },
    { label: 'Przedsprzedaż', sort: 'pre', num: true, tip: 'Tylko produkty z przedsprzedaży: zlecone zamówienia jako % towaru w SpeedMail. Powyżej ' + nf(t.presalePct) + '% — alert (trzeba dosłać albo dodrukować)', tipHeader: true },
  ];
  box.append(el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' },
      chip('', 'Wszystkie (' + all.length + ')', 'Wszystkie produkty SpeedMail'), chip('uwaga', 'Do uwagi (' + all.filter(needsLook).length + ')', 'Tylko produkty z alertem żółtym, czerwonym, stop albo alertem przedsprzedaży'),
      el('label', { title: 'Pokazuje kolumny, z których wynika stan: wysłane, dosyłki, zlecone, korekty' }, partsCb, ' pokaż, z czego wynika stan'),
      el('span', { class: 'spacer' }), freshBar('init')),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smStockTable' },
      el('thead', null, el('tr', null, cols.map(c => sortTh(c, Q, (sort, dir) => setQ({ sort, dir }))))),
      el('tbody', null, rows.length ? rows.map(r => rowEl(r, parts, t)) : el('tr', null, el('td', { colspan: String(cols.length), class: 'empty' }, 'Żaden produkt nie wymaga uwagi.')))))));
  box.append(moveCard(v, all), deliveryCard(v), historyCard());
  return box;
}

function rowEl(r, parts, t) {
  const L = SM.LEVELS[r.level], u = ' ' + r.unit;
  const num = (x, cls) => el('td', { class: 'n' + (cls ? ' ' + cls : '') }, nf(x));
  return el('tr', { 'data-key': r.key, 'data-level': r.level },
    el('td', null, r.name, r.presale ? el('span', { class: 'ord-st acc', title: 'Produkt z przedsprzedaży' }, 'przedsprzedaż') : null),
    el('td', { class: 'nw' }, statusPill(L.label, L.tone, L.tip + (r.why.length ? '\n\nPowód: ' + r.why.join('; ') : ''))),
    el('td', { class: 'n nw' }, el('span', { class: r.stock < 0 ? 'diffbad' : null, title: r.stock < 0 ? 'Stan ujemny: przekazano więcej, niż wpisano jako wysłane — sprawdź ilości albo zapisz inwentaryzację' : null }, nf(r.stock) + u)),
    num(r.packs),
    ...(parts ? [num(r.sent), num(r.topups), num(r.ordered), el('td', { class: 'n', title: Object.keys(SM.MOVE_KINDS).filter(k => r.parts[k]).map(k => SM.MOVE_KINDS[k].label + ': ' + (r.parts[k] > 0 ? '+' : '') + nf(r.parts[k])).join('\n') || null }, (r.corr > 0 ? '+' : '') + nf(r.corr))] : []),
    num(r.ordered7),
    el('td', { class: 'n' }, r.waiting ? el('span', { class: 'muted tip', title: 'Przedsprzedaż: SpeedMail zacznie wysyłkę ' + dmy(S.d.v.cfg.dates.presaleStart) + ', do tego czasu zlecenia czekają' }, 'czeka') : r.days == null ? el('span', { class: 'muted', title: 'Brak zleceń w ostatnich 7 dniach — nie ma z czego policzyć tempa' }, '—') : nf(Math.floor(r.days * 10) / 10)),
    el('td', { class: 'nw' }, r.runOut ? dmy(r.runOut) : '—'),
    el('td', { class: 'n' }, r.presalePct == null ? '' : el('span', { class: r.presaleAlert ? 'diffbad' : null, title: 'Zlecone ' + nf(r.ordered) + u + ' z ' + nf(r.sent + r.topups + r.corr) + u + ' w SpeedMail' + (r.presaleAlert ? ' — powyżej progu ' + nf(t.presalePct) + '%' : '') }, nf(Math.round(r.presalePct)) + '%')));
}

function moveCard(v, all) {
  const prods = SM.tableProducts(v.cfg);
  if (!prodOf(form.key)) form.key = prods[0] ? prods[0].key : '';
  const p = prodOf(form.key), cur = (all.find(r => r.key === form.key) || { stock: 0 }).stock, inv = form.kind === 'inwentaryzacja';
  const q = Number(String(form.qty).replace(',', '.'));
  const delta = form.qty === '' || !isFinite(q) ? null : inv ? Math.round((q - cur) * 1000) / 1000 : q;
  const sel = (id, label, value, options, on) => { const s = el('select', { id, 'aria-label': label }, options.map(([k, t]) => el('option', { value: k }, t))); s.value = value; s.addEventListener('change', () => { on(s.value); S.rerender(); }); return s; };
  const qty = el('input', { type: 'text', inputmode: 'decimal', id: 'smMoveQty', value: form.qty, 'aria-label': inv ? 'Policzona ilość' : 'Ilość', placeholder: inv ? 'ile policzono' : 'ile' });
  qty.addEventListener('input', () => { form.qty = qty.value.trim(); S.rerender(); });
  const noteIn = el('input', { type: 'text', id: 'smMoveNote', value: form.note, maxlength: '200', 'aria-label': 'Opis', placeholder: 'np. numer dostawy, powód' });
  noteIn.addEventListener('input', () => { form.note = noteIn.value; });
  const valid = delta !== null && delta !== 0 && (inv || q > 0);
  const sign = SM.MOVE_KINDS[form.kind].sign || (delta > 0 ? 1 : -1);
  const btn = el('button', { type: 'button', class: 'primary', id: 'smMoveSave', write: WRITE, disabled: !valid || jobBusy(), title: 'Zapisuje ruch w rejestrze SpeedMail — stan zmienia się od razu',
    onclick: async () => {
      const r = await save('sm:move', { moves: [{ key: form.key, kind: form.kind, qty: inv ? delta : q, note: form.note.trim() + (inv ? (form.note.trim() ? ' · ' : '') + 'policzono ' + nf(q) : '') }] }, 'Zapisano: ' + SM.MOVE_KINDS[form.kind].label.toLowerCase());
      if (!r) return;
      form.qty = ''; form.note = '';
      await reload('init', 'list');
    } }, 'Zapisz');
  return el('div', { class: 'card sm-foldcard' }, fold('smMove', ['Dosyłka lub korekta stanu', ' — dosłany towar, zwrot od klienta, uszkodzenie, inwentaryzacja'],
    el('div', { class: 'mag-form' },
      el('label', null, 'Produkt', sel('smMoveKey', 'Produkt', form.key, prods.map(x => [x.key, x.name]), val => { form.key = val; })),
      el('label', { title: SM.MOVE_KINDS[form.kind].tip }, el('span', { class: 'tip' }, 'Rodzaj'), sel('smMoveKind', 'Rodzaj ruchu', form.kind, Object.keys(SM.MOVE_KINDS).filter(k => k !== 'anulowanie').map(k => [k, SM.MOVE_KINDS[k].label]), val => { form.kind = val; })),
      el('label', { title: inv ? 'Wpisz, ile towaru policzono w SpeedMail — panel sam wyliczy różnicę wobec stanu' : 'Ilość w jednostce produktu (sztuki; OrszaKrówki w kg), nie w opakowaniach' },
        el('span', { class: 'tip' }, inv ? 'Policzona ilość (' + (p ? p.unit : 'szt.') + ')' : 'Ilość (' + (p ? p.unit : 'szt.') + ')'), qty),
      el('label', null, 'Opis (opcjonalnie)', noteIn)),
    el('p', { class: 'muted small', id: 'smMoveInfo' }, p ? 'Stan teraz: ' + nf(cur) + ' ' + p.unit + (delta !== null && valid ? ' → po zapisie: ' + nf(cur + sign * Math.abs(delta)) + ' ' + p.unit + ' (' + (sign > 0 ? '+' : '−') + nf(Math.abs(delta)) + ')' : inv && delta === 0 ? ' — zgadza się, nie ma czego zapisywać' : '') : ''),
    el('p', { class: 'muted small' }, 'Anulowanie zlecenia (zamówienie wycofane po przekazaniu) zapisujesz w zakładce ', el('a', { href: '#/speedmail/paczki' }, 'Paczki zleceń'), ' — towar wraca wtedy na stan sam. Ilość wysłaną na start sezonu zmienia administrator w Ustawieniach.'),
    el('div', { class: 'ord-actions' }, btn)));
}

function historyCard() {
  const e = S.list, err = loadError('list', 'historia korekt');
  const moves = e ? e.v.moves : [];
  return el('div', { class: 'card sm-foldcard' }, fold('smMoves', ['Historia dosyłek i korekt', e ? ' — ostatnie ' + moves.length : ' — wczytuję…'],
    err,
    el('div', { class: 'table-wrap' }, el('table', { id: 'smMovesTable' },
      el('thead', null, el('tr', null, ['Data', 'Produkt', 'Rodzaj', 'Ilość', 'Opis', 'Kto'].map((h, i) => el('th', { class: i === 3 ? 'n' : null }, el('span', { title: i === 3 ? 'Wpływ na stan: + zwiększa, − zmniejsza' : h, class: i === 3 ? 'tip' : null }, h))))),
      el('tbody', null, moves.length ? moves.map(m => el('tr', null, el('td', { class: 'nw' }, dmy(m.day)), el('td', null, (prodOf(m.key) || { name: m.key }).name),
        el('td', null, (SM.MOVE_KINDS[m.kind] || { label: m.kind }).label), el('td', { class: 'n' }, (m.qty > 0 ? '+' : '') + nf(m.qty)), el('td', null, m.note || ''), el('td', null, m.author || '')))
        : el('tr', null, el('td', { colspan: '6', class: 'empty' }, e ? 'Nie zapisano jeszcze żadnej dosyłki ani korekty.' : 'Wczytuję…')))))));
}
