// „Wysyłka SpeedMail” → zakładka Paczki zleceń (sekcja 7 specyfikacji): każda przekazana paczka jest zapisana (Zlecenia_SM) —
// plik .xlsx w stałym układzie kolumn do pobrania w każdej chwili, statusy w Selly („Złożone SpeedMail” → „Przyjęte SpeedMail”) z ponowieniem,
// anulowanie zlecenia (towar wraca na stan) i świadome ponowne przekazanie (z powodem — blokada duplikatów).
import { el, cnt, sortTh, flash } from '../core/ui.js?v=7646b3d';
import { api } from '../core/client.js?v=7646b3d';
import { go } from '../core/router.js?v=7646b3d';
import { S, WRITE, STATUS_WRITE, dmy, notice, statusName, needText, freshBar, loadError, skeleton, timeOf, save, reload, runStatus, jobBusy, downloadBatch, copyBatch } from './speedmailKit.js?v=7646b3d';

const SORTS = { no: b => b.no, day: b => b.day, orders: b => b.orders, cancelled: b => b.cancelled, author: b => b.author };
const details = new Map();   // nr paczki → { t, v } | { err } | { loading }
const collator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

function readQ(q) {
  const sort = SORTS[q.get('sort')] ? q.get('sort') : 'no', no = parseInt(q.get('paczka'), 10);
  return { no: no > 0 ? no : 0, sort, dir: q.get('dir') === 'asc' ? 'asc' : 'desc' };
}
function hrefOf(Q) {
  const p = new URLSearchParams();
  if (Q.no) p.set('paczka', String(Q.no));
  if (Q.sort !== 'no' || Q.dir !== 'desc') { p.set('sort', Q.sort); p.set('dir', Q.dir); }
  const s = p.toString();
  return '#/speedmail/paczki' + (s ? '?' + s : '');
}

async function fetchBatch(no, force) {
  const cur = details.get(no);
  if (cur && (cur.loading || (!force && cur.v))) return;
  details.set(no, { ...(cur || {}), loading: true, err: '' });
  try { details.set(no, { t: Date.now(), v: await api('sm:get', { no }) }); } catch (e) { details.set(no, { ...(cur || {}), loading: false, err: (e && e.message) || 'Nie udało się pobrać paczki.' }); }
  S.rerender();
}

export function viewBatches() {
  const Q = readQ(S.query), e = S.list, box = el('div', { id: 'smBatches' });
  const err = loadError('list', 'paczki zleceń');
  if (err) box.append(err);
  if (S.dlg && (S.dlg.kind === 'cancel' || S.dlg.kind === 'resend')) box.append(dialog());
  if (Q.no) box.append(detail(Q));
  if (!e) { if (!err) box.append(skeleton(5)); return box; }
  const val = SORTS[Q.sort], sign = Q.dir === 'desc' ? -1 : 1;
  const rows = e.v.batches.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' ? x - y : collator.compare(x, y)) * sign || b.no - a.no; });
  const cols = [
    { label: 'Paczka', sort: 'no', num: true, tip: 'Numer kolejny paczki zleceń w sezonie — jest też w nazwie pliku', tipHeader: true },
    { label: 'Data', sort: 'day', tip: 'Dzień przekazania paczki do SpeedMail', firstDir: 'desc' },
    { label: 'Zamówień', sort: 'orders', num: true, tip: 'Ile zamówień jest w paczce (jedno zamówienie = jeden wiersz pliku)', tipHeader: true },
    { label: 'Anulowane', sort: 'cancelled', num: true, tip: 'Ile zleceń z tej paczki anulowano po przekazaniu (towar wrócił na stan; w pliku ich nie ma)', tipHeader: true },
    { label: 'Kto', sort: 'author', tip: 'Kto przekazał paczkę' },
  ];
  box.append(el('div', { class: 'card' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('h3', { style: 'margin:0' }, 'Przekazane paczki zleceń'), el('span', { class: 'spacer' }), freshBar('list')),
    el('p', { class: 'muted small', style: 'margin:var(--s1) 0 0' }, 'Każde zamówienie może być tylko w jednej paczce — panel nie pozwoli przekazać go drugi raz przez pomyłkę.'),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smBatchTable' },
      el('thead', null, el('tr', null, ...cols.map(c => sortTh(c, Q, (sort, dir) => go(hrefOf({ ...Q, sort, dir }).slice(1)))), el('th', null, el('span', { title: 'Plik dla SpeedMail' }, 'Plik')))),
      el('tbody', null, rows.length ? rows.map(b => el('tr', { 'data-no': String(b.no), class: Q.no === b.no ? 'sel' : null },
        el('td', { class: 'n nw' }, el('a', { href: hrefOf({ ...Q, no: b.no }), title: 'Pokaż zamówienia paczki ' + b.ref + ' — statusy, anulowanie zlecenia' }, 'nr ' + b.no),
          b.resent ? el('span', { class: 'ord-st warn', title: 'Paczka zawiera zamówienia przekazane ponownie (świadomie, z powodem): ' + b.resent }, 'ponownie') : null,
          b.short ? el('span', { class: 'ord-st warn', title: 'Zamówienia przekazane mimo braku towaru w SpeedMail (ręczna decyzja): ' + b.short }, 'mimo braku') : null),
        el('td', { class: 'nw', title: 'Zapisano o ' + timeOf(b.ms) }, dmy(b.day)), el('td', { class: 'n' }, String(b.orders)), el('td', { class: 'n' }, b.cancelled ? String(b.cancelled) : ''), el('td', null, b.author),
        el('td', { class: 'nw' }, el('button', { type: 'button', class: 'ghost small', title: 'Pobierz tabelę zleceń tej paczki (.xlsx) — ilości w opakowaniach SpeedMail, stały układ kolumn', onclick: () => downloadBatch(b.no) }, 'Pobierz .xlsx'))))
        : el('tr', null, el('td', { colspan: '6', class: 'empty' }, 'Nie przekazano jeszcze żadnej paczki. ', el('a', { href: '#/speedmail/zamowienia?dec=sm' }, 'Wybierz zamówienia do SpeedMail →'))))))));
  return box;
}

function detail(Q) {
  const no = Q.no, d = details.get(no);
  if (!d || (!d.v && !d.loading && !d.err)) { fetchBatch(no); return skeleton(4); }
  if (!d.v) return d.err ? notice('error', d.err, ' ', el('button', { type: 'button', class: 'secondary', onclick: () => fetchBatch(no, true) }, 'Spróbuj ponownie')) : skeleton(4);
  const { batch, orders } = d.v, use = S.d.v.use;
  const act = orders.filter(o => !o.cancelled);
  const toSm = use.sm ? act.filter(o => use.open.includes(o.statusId)) : [];
  const toAcc = use.acc ? act.filter(o => o.statusId && o.statusId !== use.acc && (o.statusId === use.sm || use.open.includes(o.statusId))) : [];
  const numOf = new Map(orders.map(o => [o.orderId, o.orderNumber]));
  const setSt = (list, target, title, question) => {
    if (!confirm(question)) return;
    runStatus({ ids: list.map(o => o.orderId), target, title, numOf, then: () => fetchBatch(no, true) });
  };
  return el('div', { class: 'card', id: 'smBatch' },
    el('div', { class: 'toolbar', style: 'margin-top:0' }, el('h3', { style: 'margin:0' }, 'Paczka zleceń nr ' + batch.no),
      el('span', { class: 'muted small' }, batch.ref + ' · ' + dmy(batch.day) + ' · ' + batch.author), el('span', { class: 'spacer' }),
      d.loading ? el('span', { class: 'muted small', role: 'status' }, el('span', { class: 'spinner' }), ' odświeżam…') : null,
      el('button', { type: 'button', class: 'ghost small', title: 'Pobierz ponownie statusy zamówień tej paczki', onclick: () => fetchBatch(no, true) }, '↻ Odśwież'),
      el('a', { href: hrefOf({ ...Q, no: 0 }), class: 'btn-secondary', title: 'Zamknij szczegóły paczki' }, 'Zamknij')),
    d.err ? notice('error', d.err) : null,
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', title: 'Kopiuje tę samą tabelę do schowka (do wklejenia w Excelu)', onclick: () => copyBatch(no) }, 'Kopiuj tabelę'),
      toSm.length ? el('button', { type: 'button', class: 'secondary', id: 'smBatchSm', write: STATUS_WRITE, disabled: jobBusy(), title: 'Te zamówienia są w paczce, ale w Selly mają jeszcze poprzedni status (zmiana się nie udała albo została przerwana)',
        onclick: () => setSt(toSm, use.sm, 'Paczka nr ' + no, 'Zmienić w Selly status ' + cnt(toSm.length, 'zamówienia', 'zamówień', 'zamówień') + ' na „' + statusName(use.sm) + '”?') }, 'Dokończ: ustaw „' + statusName(use.sm) + '” (' + toSm.length + ')') : null,
      use.acc ? el('button', { type: 'button', class: 'secondary', id: 'smBatchAcc', write: STATUS_WRITE, disabled: !toAcc.length || jobBusy(),
        title: toAcc.length ? 'Gdy SpeedMail potwierdzi przyjęcie zleceń: zmienia w Selly status zamówień tej paczki na „' + statusName(use.acc) + '”' : 'Wszystkie zamówienia paczki mają już ten status (albo inny, późniejszy)',
        onclick: () => setSt(toAcc, use.acc, 'Paczka nr ' + no + ' — SpeedMail przyjął', 'SpeedMail przyjął paczkę? Zmienić w Selly status ' + cnt(toAcc.length, 'zamówienia', 'zamówień', 'zamówień') + ' na „' + statusName(use.acc) + '”?') },
      'SpeedMail przyjął → „' + statusName(use.acc) + '”' + (toAcc.length ? ' (' + toAcc.length + ')' : '')) : null,
      el('button', { type: 'button', class: 'primary', id: 'smBatchFile', title: 'Tabela zleceń: jeden wiersz = jedno zamówienie, produkty w kolumnach, ilości w opakowaniach SpeedMail. Zawsze ten sam układ kolumn.', onclick: () => downloadBatch(no) }, 'Pobierz plik dla SpeedMail (.xlsx)')),
    el('div', { class: 'table-wrap' }, el('table', { id: 'smBatchOrders' },
      el('thead', null, el('tr', null, ['Zamówienie', 'Data', 'Status w Selly', 'Produkty SpeedMail', 'Uwagi', 'Zlecenie'].map((h, i) => el('th', null, el('span', { class: i >= 3 ? 'tip' : null,
        title: [h, 'Data złożenia zamówienia', 'Obecny status zamówienia w Selly', 'Zamówienie przeliczone na produkty SpeedMail (zestawy rozbite), w sztukach', 'Czy zamówienie przekazano ręcznie, mimo braku towaru albo ponownie', 'Anulowanie zlecenia zwraca towar na stan; ponowne przekazanie tworzy nową paczkę'][i] }, h))))),
      el('tbody', null, orders.map(o => el('tr', { 'data-id': o.orderId, class: o.cancelled ? 'muted' : null },
        el('td', { class: 'nw' }, el('a', { href: '#/zamowienia/' + encodeURIComponent(o.orderId), title: 'Otwórz kartę zamówienia ' + o.orderNumber }, o.orderNumber)),
        el('td', { class: 'nw' }, dmy(o.date)), el('td', null, o.statusId ? statusName(o.statusId) : '—'), el('td', null, needText(o.need)),
        el('td', null, [o.cancelled ? 'zlecenie anulowane' : '', o.manual ? 'decyzja ręczna' : '', o.short ? 'mimo braku towaru' : '', o.note ? 'ponownie: ' + o.note : ''].filter(Boolean).join(' · ')),
        el('td', { class: 'nw' }, o.cancelled
          ? el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Przekaż to zamówienie do SpeedMail jeszcze raz (nowa paczka) — wymaga podania powodu', onclick: () => { S.dlg = { kind: 'resend', orderId: o.orderId, num: o.orderNumber, no }; S.rerender(); } }, 'Przekaż ponownie…')
          : el('button', { type: 'button', class: 'ghost small', write: WRITE, title: 'Zamówienie wycofane po przekazaniu: towar wraca na stan SpeedMail (korekta „anulowanie zlecenia”), zamówienie znika z pliku', onclick: () => { S.dlg = { kind: 'cancel', orderId: o.orderId, num: o.orderNumber, no }; S.rerender(); } }, 'Anuluj zlecenie…'))))))));
}

function dialog() {
  const d = S.dlg, cancel = d.kind === 'cancel', close = () => { S.dlg = null; S.rerender(); };
  const noteIn = el('input', { type: 'text', id: 'smDlgNote', maxlength: '200', style: 'width:100%', placeholder: cancel ? 'Powód (opcjonalnie), np. „klient zrezygnował”' : 'Powód ponownego przekazania', 'aria-label': 'Powód' });
  return el('div', { class: 'card ord-dialog', id: 'smDlg', role: 'dialog', 'aria-label': cancel ? 'Anulowanie zlecenia' : 'Ponowne przekazanie' },
    el('h3', null, (cancel ? 'Anulować zlecenie zamówienia ' : 'Przekazać ponownie zamówienie ') + d.num + '?'),
    el('p', { class: 'muted small' }, cancel ? 'Towar tego zamówienia wróci na stan SpeedMail, a zamówienie zniknie z pliku paczki nr ' + d.no + '. Statusu w Selly panel nie zmienia — ustaw go w karcie zamówienia.'
      : 'Powstanie nowa paczka zleceń z tym jednym zamówieniem, a stan SpeedMail zmniejszy się drugi raz. Rób to tylko, gdy SpeedMail na pewno nie realizuje wcześniejszego zlecenia.'),
    noteIn,
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', id: 'smDlgCancel', onclick: close }, 'Nie, zostaw'),
      el('button', { type: 'button', class: 'primary', id: 'smDlgOk', disabled: jobBusy(), onclick: async () => {
        const text = noteIn.value.trim();
        if (!cancel && !text) { noteIn.focus(); return; }
        const r = cancel ? await save('sm:cancel', { orderId: d.orderId, note: text }, 'Anulowano zlecenie — towar wrócił na stan') : await save('sm:batch', { orderIds: [d.orderId], resend: [d.orderId], resendNote: text });
        S.dlg = null;
        if (!r) { S.rerender(); return; }
        details.delete(d.no);
        await reload('init', 'list');
        if (!cancel) { flash('', 'Zapisano paczkę nr ' + r.no); go('/speedmail/paczki?paczka=' + r.no); }
      } }, cancel ? 'Anuluj zlecenie' : 'Przekaż ponownie')));
}

/** Po zapisaniu nowej paczki szczegóły są nieaktualne — pobierz je przy następnym otwarciu. */
export const forgetBatches = () => details.clear();
