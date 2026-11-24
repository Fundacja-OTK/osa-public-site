// Zamówienia — interfejs filtrów złożonych: szybkie widoki, zdanie z usuwalnymi plakietkami, grupy statusów, płatność, przesyłka,
// wartość, zapisane widoki. Logika (bez DOM) jest w zamFiltry.js. Moduł dostaje od zamowienia.js uchwyty `h` (stan, setQ, adres).
import { el, store, flash, menuButton, copyToClipboard } from '../core/ui.js?v=58f006c';
import { PAY_STATES, TRACK_STATES, OLDER_OPTIONS, STATUS_GROUPS, groupStatuses, toggleOption, toggleMany, csvHas, csvList, clausesOf, sentenceOf, anyFilter,
  presetsOf, presetActive, olderToDate, cleanViews, addView, renameView, removeView, viewQs, FKEYS, EMPTY_F } from './zamFiltry.js?v=58f006c';

const VIEWS_KEY = 'osa-ord-views', GROUPS_KEY = 'osa-ord-sgroups';
const loadViews = () => cleanViews(store(VIEWS_KEY));
const saveViews = v => store(VIEWS_KEY, v);
const loadOverrides = () => { const o = store(GROUPS_KEY); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; };

export function createFilterUi(h) {
  const U = {};
  let mode = 'in';           // klikanie w opcje: 'in' = pokaż, 'out' = wyklucz (NIE)
  let views = loadViews();
  let namingOpen = false;

  const Q = () => h.Q();
  const metaOf = () => h.meta();
  const groups = () => groupStatuses((metaOf().statuses || []), loadOverrides());
  const nameOf = (list, id) => { const x = (list || []).find(y => String(y.id) === String(id)); return x ? x.name : String(id); };
  const ctx = () => ({ statusName: id => nameOf(metaOf().statuses, id), payName: id => nameOf(metaOf().payments, id), deliveryName: id => nameOf(metaOf().deliveries, id),
    osaOn: h.osaOn(), osaClear: h.osaClear });
  const clauses = () => clausesOf(Q(), ctx());
  const qsNow = () => viewQs(h.qsOf(Q()));

  // ─── Plakietka opcji (pokaż / wyklucz) ─────────────────────────────────────
  function optChip({ id, label, n, tip, state, onpick }) {
    const out = state === 'out';
    const b = el('button', { type: 'button', class: 'chip fx-opt' + (out ? ' neg' : ''), 'aria-pressed': String(!!state), id, 'data-state': state || '',
      title: (tip ? tip + '\n\n' : '') + 'Klik: ' + (mode === 'out' ? 'wyklucz' : 'pokaż') + ' · Alt+klik: ' + (mode === 'out' ? 'pokaż' : 'wyklucz') + (state ? ' · kliknij ponownie, aby wyłączyć' : ''),
      onclick: ev => onpick(ev.altKey ? (mode === 'out' ? 'in' : 'out') : mode) }, out ? 'bez ' : '', label, n == null ? null : el('span', { class: 'ord-n' }, String(n)));
    return b;
  }
  const stateOf = (Fin, Fout, v) => (csvHas(Q()[Fin], v) ? 'in' : csvHas(Q()[Fout], v) ? 'out' : '');

  // ─── Szybkie widoki (zawsze widoczne) ──────────────────────────────────────
  U.presets = el('div', { class: 'fx-presets', id: 'ordPresets', role: 'group', 'aria-label': 'Szybkie widoki' });
  U.viewsMenu = menuButton({ id: 'ordViewsMenu', label: 'Moje widoki', cls: 'secondary', title: 'Zapisane przez Ciebie zestawy filtrów (w tej przeglądarce). Zapiszesz je przyciskiem „Zapisz jako widok” nad tabelą, gdy jakiś filtr jest włączony.',
    items: () => {
      const it = views.map(v => ({ label: v.name, title: 'Zastosuj zapisany widok „' + v.name + '”', run: () => applyView(v) }));
      return it.length ? it : [{ label: 'Brak zapisanych widoków', title: 'Włącz filtry i użyj „Zapisz jako widok” nad tabelą', count: 0, run: () => {} }];
    } });
  function applyPreset(p) {
    if (presetActive(p, Q())) { h.setQ({ ...EMPTY_F }); return; }
    h.setQ({ ...EMPTY_F, ...p.build(), payment: '', delivery: '', q: '', from: '', to: '', product: '', pname: '' });
  }
  function applyView(v) { h.goQs(v.qs); }

  // ─── Zdanie + usuwalne plakietki (nad tabelą) ──────────────────────────────
  U.sentence = el('p', { class: 'fx-sentence', id: 'ordFsentence', role: 'status' });
  U.chips = el('div', { class: 'fx-chips', id: 'ordFchips' });
  U.nameInput = el('input', { type: 'text', id: 'ordViewName', class: 'fx-name', maxlength: '60', placeholder: 'Nazwa widoku, np. „Do wysyłki”', 'aria-label': 'Nazwa zapisywanego widoku',
    onkeydown: ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveCurrent(); } else if (ev.key === 'Escape') { namingOpen = false; paintSummary(); } } });
  U.nameRow = el('div', { class: 'fx-namerow', hidden: true }, U.nameInput,
    el('button', { type: 'button', class: 'primary', id: 'ordViewSave', onclick: () => saveCurrent() }, 'Zapisz'),
    el('button', { type: 'button', class: 'ghost', onclick: () => { namingOpen = false; paintSummary(); } }, 'Anuluj'));
  U.saveBtn = el('button', { type: 'button', class: 'secondary', id: 'ordSaveView', title: 'Zapisz bieżący zestaw filtrów pod własną nazwą — pojawi się w „Moje widoki” (zapis w tej przeglądarce)',
    onclick: () => { namingOpen = !namingOpen; paintSummary(); if (namingOpen) U.nameInput.focus(); } }, 'Zapisz jako widok');
  U.linkBtn = el('button', { type: 'button', class: 'ghost', id: 'ordCopyLink', title: 'Kopiuje adres z tymi filtrami — po otwarciu przez inną osobę (zalogowaną w panelu) zobaczy ten sam widok',
    onclick: () => copyToClipboard(h.linkFor(qsNow()), null, 'Skopiowano link do widoku', '') }, 'Kopiuj link');
  U.clearBtn = el('button', { type: 'button', class: 'ghost', id: 'ordFclear', title: 'Usuwa wszystkie filtry i wyszukiwanie', onclick: () => h.clearAll() }, 'Wyczyść wszystko');
  U.sum = el('div', { class: 'fx-sum', id: 'ordFsum', hidden: true }, U.sentence, U.chips,
    el('div', { class: 'fx-actions' }, U.saveBtn, U.linkBtn, U.clearBtn), U.nameRow);
  function saveCurrent() {
    const name = U.nameInput.value.trim();
    if (!name) { U.nameInput.focus(); return; }
    views = addView(views, name, qsNow());
    saveViews(views);
    namingOpen = false; U.nameInput.value = '';
    flash('', 'Zapisano widok „' + name + '”');
    paintSummary(); paintViewsList();
  }
  function paintSummary() {
    const cl = clauses(), on = anyFilter(Q(), h.osaOn());
    U.sum.hidden = !on;
    if (!on) return;
    U.sentence.textContent = sentenceOf(cl);
    U.chips.replaceChildren(...cl.flatMap(c => c.items.map(i => el('button', { type: 'button', class: 'chip fx-x' + (c.neg ? ' neg' : ''), 'data-clause': c.id,
      title: 'Usuń z filtra: ' + c.name + (c.neg ? ' — bez ' : ': ') + i.label, 'aria-label': 'Usuń z filtra: ' + c.name + ' ' + i.label, onclick: () => h.setQ(i.patch) },
      el('span', { class: 'fx-k' }, c.name + (c.neg ? ' — bez' : '') + ':'), ' ' + i.label, el('span', { class: 'fx-xx', 'aria-hidden': 'true' }, ' ×')))));
    U.nameRow.hidden = !namingOpen;
    U.saveBtn.setAttribute('aria-expanded', String(namingOpen));
  }

  // ─── Panel filtrów ─────────────────────────────────────────────────────────
  const sec = (title, tip, ...body) => el('section', { class: 'fp-sec' }, el('h3', { class: tip ? 'tip' : null, title: tip || null }, title), ...body);
  U.hint = el('p', { class: 'muted small fx-hint', id: 'ordFhint', title: 'Przykład: „opłacone” ORAZ („Złożone” LUB „W realizacji”) — zamówienia opłacone i jednocześnie w jednym z dwóch statusów.' },
    'Zaznaczone opcje w jednej grupie łączą się słowem LUB, a różne grupy — słowem ORAZ. Nad tabelą zobaczysz to jako zdanie.');
  U.modeNote = el('div', { class: 'notice warn fx-modenote', id: 'ordFmodeNote', hidden: true, role: 'status' }, 'Tryb wykluczania: kliknięcie opcji ją wyklucza (pokaże zamówienia bez niej). ',
    el('button', { type: 'button', class: 'link', onclick: () => setMode('in') }, 'Wróć do pokazywania'));
  U.statusBox = el('div', { class: 'fx-groups', id: 'ordFstatus' });
  U.payBox = el('div', { class: 'fx-row', id: 'ordFpay', role: 'group', 'aria-label': 'Stan płatności' });
  U.trkBox = el('div', { class: 'fx-row', id: 'ordFtrk', role: 'group', 'aria-label': 'Numer przesyłki' });
  U.min = el('input', { type: 'number', id: 'ordMin', min: '0', step: '0.01', inputMode: 'decimal', 'aria-label': 'Wartość od (zł)', title: 'Wartość zamówienia z dostawą — od (zł, włącznie)', class: 'fx-num', onchange: () => h.setQ({ min: U.min.value.trim() }) });
  U.max = el('input', { type: 'number', id: 'ordMax', min: '0', step: '0.01', inputMode: 'decimal', 'aria-label': 'Wartość do (zł)', title: 'Wartość zamówienia z dostawą — do (zł, włącznie)', class: 'fx-num', onchange: () => h.setQ({ max: U.max.value.trim() }) });
  U.older = el('select', { id: 'ordOlder', 'aria-label': 'Złożone co najmniej tyle dni temu', title: 'Tylko zamówienia złożone co najmniej tyle dni temu (liczone od dziś, więc widok „starsze niż 7 dni” zawsze jest aktualny)',
    onchange: () => h.setQ({ older: U.older.value }) }, el('option', { value: '' }, 'dowolnie dawno'), OLDER_OPTIONS.map(n => el('option', { value: String(n) }, n === 1 ? 'co najmniej 1 dzień temu' : 'co najmniej ' + n + ' dni temu')));
  U.olderNote = el('span', { class: 'muted small', id: 'ordOlderNote' });

  U.modeIn = el('button', { type: 'button', id: 'ordModeIn', class: 'chip', 'aria-pressed': 'true', title: 'Kliknięcie opcji filtra pokazuje zamówienia z tą opcją', onclick: () => setMode('in') }, 'Pokazuj');
  U.modeOut = el('button', { type: 'button', id: 'ordModeOut', class: 'chip', 'aria-pressed': 'false', title: 'Kliknięcie opcji filtra wyklucza ją: pokaże zamówienia BEZ tej opcji (NIE). Skrót: Alt+klik w dowolną opcję.', onclick: () => setMode('out') }, 'Wykluczaj (NIE)');
  U.groupEditor = el('div', { class: 'fx-geditor', id: 'ordFgroups' });
  U.viewsList = el('div', { class: 'fx-views', id: 'ordFviews' });
  U.adv = el('details', { class: 'fp-sec fold', id: 'ordFmore' },
    el('summary', { title: 'Wykluczanie (NIE), własne grupy statusów i zarządzanie zapisanymi widokami' }, 'Zaawansowane: wykluczanie, grupy statusów, zapisane widoki'),
    el('div', { class: 'fx-more' },
      el('div', { class: 'fx-morebox' }, el('strong', null, 'Klikanie w opcje'), el('p', { class: 'muted small' }, 'Domyślnie klik pokazuje zamówienia z opcją. W trybie „Wykluczaj” pokaże te bez niej (NIE). Szybciej: Alt+klik w dowolną opcję.'),
        el('div', { class: 'fx-row' }, U.modeIn, U.modeOut)),
      el('div', { class: 'fx-morebox' }, el('strong', null, 'Grupy statusów'), el('p', { class: 'muted small' }, 'Statusy są grupowane po nazwie. Jeśli któryś trafił do złej grupy, przypisz go ręcznie (zapamiętane w tej przeglądarce).'), U.groupEditor),
      el('div', { class: 'fx-morebox' }, el('strong', null, 'Zapisane widoki'), el('p', { class: 'muted small' }, 'Zmień nazwę, usuń albo skopiuj link do widoku. Nowy widok zapiszesz przyciskiem „Zapisz jako widok” nad tabelą.'), U.viewsList)));

  function setMode(m) {
    mode = m;
    U.modeIn.setAttribute('aria-pressed', String(m === 'in')); U.modeOut.setAttribute('aria-pressed', String(m === 'out'));
    U.modeNote.hidden = m !== 'out';
    paintPanel();
  }

  U.panelNodes = (extra) => [
    U.hint, U.modeNote,
    sec('Status zamówienia', 'Statusy z Selly pogrupowane tematycznie. Kliknij nazwę grupy, aby wybrać wszystkie jej statusy naraz (LUB).', U.statusBox),
    sec('Płatność', 'Czy zamówienie jest opłacone — wyliczane z kwoty wpłaconej w Selly, niezależnie od statusu. Można łączyć np. „opłacone” ze statusem „Złożone”.', U.payBox, extra.payMethod),
    sec('Dostawa i przesyłka', 'Sposób dostawy oraz to, czy zamówienie ma już numer przesyłki.', extra.delivery, U.trkBox),
    sec('Wartość i data', 'Wartość zamówienia z dostawą oraz zakres dat złożenia.', el('div', { class: 'fx-row' },
      el('label', { class: 'field-inline' }, 'Wartość od (zł)', U.min), el('label', { class: 'field-inline' }, 'do (zł)', U.max)),
      el('div', { class: 'fx-row' }, extra.range, el('label', { class: 'field-inline' }, 'Wiek zamówienia', U.older), U.olderNote)),
    ...extra.more,
    U.adv,
  ];

  function paintPanel() {
    const Qn = Q(), M = metaOf(), counts = new Map((M.counts || []).map(c => [String(c.id), Number(c.n) || 0]));
    // grupy statusów
    U.statusBox.replaceChildren(...groups().map(g => {
      const ids = g.statuses.map(s => String(s.id));
      const allIn = ids.every(i => csvHas(Qn.status, i)), allOut = ids.every(i => csvHas(Qn.xstatus, i));
      const total = ids.reduce((a, i) => a + (counts.get(i) || 0), 0);
      return el('div', { class: 'fx-group', 'data-group': g.key },
        el('button', { type: 'button', class: 'fx-gname tip' + (allOut ? ' neg' : ''), id: 'ordFg-' + g.key, 'aria-pressed': String(allIn || allOut),
          title: g.tip + '\n\nKlik: ' + (mode === 'out' ? 'wyklucz' : 'pokaż') + ' wszystkie statusy grupy naraz (' + total + ' zam.).', onclick: ev => h.setQ(toggleMany(Qn, 'status', 'xstatus', ids, ev.altKey ? (mode === 'out' ? 'in' : 'out') : mode)) },
          g.label, el('span', { class: 'ord-n' }, String(total))),
        el('div', { class: 'fx-row' }, g.statuses.map(s => optChip({ id: 'ordFs-' + s.id, label: s.name, n: counts.get(String(s.id)) || 0, tip: 'Status „' + s.name + '” (' + (counts.get(String(s.id)) || 0) + ' zam. łącznie, niezależnie od innych filtrów)',
          state: stateOf('status', 'xstatus', String(s.id)), onpick: m => h.setQ(toggleOption(Qn, 'status', 'xstatus', String(s.id), m)) }))));
    }));
    const oc = M.optionCounts || null;
    U.payBox.replaceChildren(...PAY_STATES.map(p => optChip({ id: 'ordFp-' + p.key, label: p.label, n: oc && oc.pay ? oc.pay[p.key] : null, tip: p.tip,
      state: stateOf('pay', 'xpay', p.key), onpick: m => h.setQ(toggleOption(Qn, 'pay', 'xpay', p.key, m)) })));
    U.trkBox.replaceChildren(...TRACK_STATES.map(p => optChip({ id: 'ordFt-' + p.key, label: p.label, n: oc && oc.trk ? oc.trk[p.key] : null, tip: p.tip,
      state: csvHas(Qn.trk, p.key) ? 'in' : '', onpick: () => h.setQ({ trk: csvHas(Qn.trk, p.key) ? csvList(Qn.trk).filter(x => x !== p.key).join(',') : csvList(Qn.trk).concat(p.key).join(',') }) })));
    U.min.value = Qn.min; U.max.value = Qn.max; U.older.value = Qn.older;
    U.olderNote.textContent = Qn.older ? '→ do dnia ' + olderToDate(Qn.older) : '';
    // edytor grup statusów
    const ov = loadOverrides();
    U.groupEditor.replaceChildren(...(M.statuses || []).map(s => {
      const cur = groupStatuses([s], ov)[0].key;
      const sel = el('select', { 'aria-label': 'Grupa statusu ' + s.name, title: 'Do której grupy należy status „' + s.name + '”', onchange: () => {
        const o = loadOverrides(); if (sel.value === 'auto') delete o[String(s.id)]; else o[String(s.id)] = sel.value; store(GROUPS_KEY, o); paintPanel();
      } }, el('option', { value: 'auto' }, 'automatycznie'), STATUS_GROUPS.map(g => el('option', { value: g.key, selected: ov[String(s.id)] === g.key }, g.label)));
      if (!ov[String(s.id)]) sel.value = 'auto';
      return el('label', { class: 'fx-grow' }, el('span', null, s.name), sel);
    }));
    paintViewsList();
  }
  function paintViewsList() {
    if (!views.length) { U.viewsList.replaceChildren(el('p', { class: 'muted small' }, 'Brak zapisanych widoków.')); return; }
    U.viewsList.replaceChildren(...views.map(v => {
      const name = el('input', { type: 'text', value: v.name, maxlength: '60', 'aria-label': 'Nazwa widoku', title: 'Zmień nazwę (zatwierdź Enterem lub kliknięciem poza polem)',
        onchange: () => { views = renameView(views, v.id, name.value); saveViews(views); paintViewsList(); } });
      return el('div', { class: 'fx-view', 'data-id': v.id },
        name,
        el('button', { type: 'button', class: 'secondary', title: 'Zastosuj ten widok', onclick: () => applyView(v) }, 'Pokaż'),
        el('button', { type: 'button', class: 'ghost', title: 'Kopiuje link do tego widoku', onclick: () => copyToClipboard(h.linkFor(v.qs), null, 'Skopiowano link do widoku', '') }, 'Link'),
        el('button', { type: 'button', class: 'ghost fx-del', title: 'Usuń ten zapisany widok', onclick: () => { views = removeView(views, v.id); saveViews(views); paintViewsList(); } }, 'Usuń'));
    }));
  }

  function paintPresets() {
    const ps = presetsOf(groups()), Qn = Q();
    U.presets.replaceChildren(el('span', { class: 'fx-lbl muted small', title: 'Gotowe zestawy filtrów jednym kliknięciem. Najedź na nazwę, aby zobaczyć dokładnie, co zawiera.' }, 'Szybkie widoki:'),
      ...ps.map(p => el('button', { type: 'button', class: 'chip fx-preset', id: 'ordPre-' + p.id, 'aria-pressed': String(presetActive(p, Qn) && anyFilter(Qn, false)), title: p.tip + '\n\nKliknij ponownie, aby wyłączyć.', onclick: () => applyPreset(p) }, p.label)),
      U.viewsMenu);
  }

  U.sync = () => { paintPresets(); paintSummary(); paintPanel(); };
  U.mode = () => mode;
  U.views = () => views;
  U.FKEYS = FKEYS;
  return U;
}
