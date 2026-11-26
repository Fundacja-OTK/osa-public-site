// Wspólny komponent listy (E4): tabela z sortowaniem, wyszukiwarka, panel filtrów (ui.filterLayout), „Na stronie” + „Strona X z Y”,
// zaznaczenie przetrwające zmianę strony z przyklejonym paskiem akcji, stan w adresie, stany ładowania / pusto / błąd,
// opcjonalnie świeżość (core/liveRefresh.js) i pamięć odczytów (core/cache.js). Logika bez DOM: core/listLogic.js.
// API i przykład: docs/list-view.md. Identyfikatory elementów = prefiks `id` + nazwa (np. cliTable, cliSelCount, zsPrev).
import { el, debounce, store, cnt, loadingBox, sortTh, pager, field, filterLayout, filterSection, columnMenu, tapOpen, selOffNote, colWidths } from './ui.js?v=802d849';
import { go } from './router.js?v=802d849';
import { cachedRead } from './cache.js?v=802d849';
import { liveRefresh } from './liveRefresh.js?v=802d849';
import * as LL from './listLogic.js?v=802d849';

const td = (c, v) => (v instanceof Node && v.tagName === 'TD' ? v : el('td', { class: [c.num ? 'n' : '', c.cls || ''].filter(Boolean).join(' ') || null }, v == null ? '' : v));

export function listView(o) {
  const p = o.id;
  const cols = o.columns;
  const spec = {
    // kolumna z kilkoma sortowaniami (`sorts: [{ label, sort, tip, num?, firstDir? }]`, np. „Nr i status”: Nr / Data / Status)
    sorts: cols.flatMap(c => [...(LL.sortKeyOf(c) ? [{ key: LL.sortKeyOf(c), num: !!c.num, firstDir: c.firstDir }] : []), ...(c.sorts || []).map(x => ({ key: x.sort, num: !!x.num, firstDir: x.firstDir }))]),
    defaultSort: o.defaultSort || null, filters: (o.filters || []).map(f => ({ key: f.key, param: f.param })), filterPrefix: o.filterPrefix || '',
    sizes: o.sizes || [25, 50, 100, 200], defaultSize: o.defaultSize || 50, extra: o.extra,
  };
  const S = { st: null, data: null, view: [], total: 0, err: null, seq: 0, sel: new Map(), built: false, filterOpts: {}, only: false };   // only = widok „tylko zaznaczone”
  const u = {};
  const rowId = r => String(o.rowId ? o.rowId(r) : r.id);
  const noSel = r => (o.select && o.select.disabled && o.select.disabled(r)) || '';   // powód, dla którego wiersza nie można zaznaczyć (albo '')
  const nFilters = () => LL.activeFilters(S.st) + (o.panelActive ? o.panelActive(S.st) : 0) + (spec.extra && spec.extra.panel ? spec.extra.panel(S.st) : 0);   // filtry w panelu: z `filters` + własne (`panelNodes`)
  const visibleCols = () => cols.filter(c => (!u.cols || u.cols.isOn(c.key)) && !(o.hideCol && o.hideCol(c)));

  // ─── Stan ↔ adres ────────────────────────────────────────────────────────
  function set(patch, opts) {
    S.only = false;
    const n = LL.patchState(S.st, patch);
    const h = o.route + LL.writeState(n, spec);
    if (location.hash === '#' + h) { S.st = n; sync(); load(); } else go(h, opts && opts.replace ? { replace: true } : undefined);
  }
  const setFilter = (key, v) => { const f = { ...S.st.filters }; if (LL.isEmptyVal(v)) delete f[key]; else f[key] = String(v).trim(); if (JSON.stringify(f) !== JSON.stringify(S.st.filters)) set({ filters: f }); };
  const clear = () => set({ q: '', filters: {}, ...((spec.extra && spec.extra.clear) || {}) });

  // ─── Budowa ──────────────────────────────────────────────────────────────
  function filterControl(f) {
    const id = f.id || p + 'F_' + f.key;
    if (f.type === 'text' || f.type === 'date') {
      const inp = el('input', { type: f.type, id, 'aria-label': f.label, title: f.tip || f.label, placeholder: f.placeholder || null });
      inp.addEventListener(f.type === 'date' ? 'change' : 'input', f.type === 'date' ? () => setFilter(f.key, inp.value) : debounce(() => setFilter(f.key, inp.value), 450));
      return { f, input: inp, node: field(f.label, inp, f.tip || f.label) };
    }
    const sel = el('select', { id, 'aria-label': f.label, onchange: () => setFilter(f.key, sel.value) });
    const c = { f, input: sel, node: field(f.label, sel, f.tip || f.label) };
    fillSelect(c, typeof f.options === 'function' ? [] : f.options || []);
    if (typeof f.options === 'function') Promise.resolve(f.options()).then(opts => fillSelect(c, opts || [])).catch(() => {});
    return c;
  }
  function fillSelect(c, opts) {
    const head = c.f.all === false ? [] : [['', c.f.all || 'wszystkie']];
    c.input.replaceChildren(...[...head, ...opts].map(([v, t]) => el('option', { value: String(v) }, t)));
    S.filterOpts[c.f.key] = opts;
    if (S.st) c.input.value = S.st.filters[c.f.key] || '';
  }
  function build() {
    S.built = true;
    u.search = o.search === false ? null : el('input', { type: 'search', id: p + 'Search', placeholder: (o.search && o.search.placeholder) || 'Szukaj…',
      'aria-label': (o.search && o.search.label) || (o.search && o.search.placeholder) || 'Szukaj', title: (o.search && o.search.tip) || null,
      oninput: debounce(() => { const v = u.search.value.trim(); if (v !== S.st.q) set({ q: v }, { replace: true }); }, 350) });
    u.filters = (o.filters || []).map(filterControl);
    u.clearBtn = el('button', { type: 'button', class: 'ghost', id: p + 'Clear', title: 'Usuń wyszukiwanie i wszystkie filtry', onclick: clear }, 'Wyczyść wyszukiwanie i filtry');
    const groups = [];
    for (const c of u.filters) { const t = c.f.section || 'Filtry'; let g = groups.find(x => x.t === t); if (!g) groups.push(g = { t, fold: !!c.f.fold, nodes: [] }); g.nodes.push(c.node); }
    const hasPanel = u.filters.length > 0 || (o.panelNodes && o.panelNodes.length);
    u.cols = o.columnsStore ? columnMenu({ id: o.columnsId || p + 'Cols', storeKey: o.columnsStore, cols: cols.map(c => ({ key: c.key, label: c.label, tip: c.tip, def: c.def, locked: c.locked, unavailable: c.unavailable })), extra: o.columnsExtra, onChange: () => render() }) : null;
    // szerokości kolumn (core/ui.js colWidths): uchwyt na krawędzi nagłówka, zapis per lista w tej przeglądarce; `resize: false` wyłącza
    u.widths = o.resize === false ? null : colWidths('osa-colw-' + (o.storeKey || p));
    u.live = o.live ? liveRefresh({ id: p, ...o.live, reload: kind => load(kind),
      busy: () => (o.live.pauseOnSelect !== false && S.sel.size > 0) || !!(o.live.busy && o.live.busy()) }) : null;
    u.filtersBtn = hasPanel ? el('button', { type: 'button', class: 'secondary fbtn', id: p + 'FiltersBtn', 'aria-controls': p + 'Filters', 'aria-expanded': 'false',
      title: o.filtersTip || 'Pokaż lub ukryj panel filtrów', onclick: () => { u.layout.setOpen(!u.layout.isOpen()); syncFiltersBtn(); } }, 'Filtry') : null;
    u.results = el('div', { id: p + 'Results' });
    u.bar = o.select ? el('div', { class: 'save-bar lv-bar', id: p + 'Bulk', role: 'region', 'aria-label': 'Akcje dla zaznaczonych', hidden: true }) : null;
    const toolbar = el('div', { class: 'toolbar lv-toolbar' }, u.search, u.filtersBtn, u.cols && u.cols.node, ...(o.actions || []), el('span', { class: 'spacer' }), u.live && u.live.node, o.info || null);
    const panelNodes = [...groups.map(g => filterSection(g.t, el('div', { class: 'fp-list' }, g.nodes), { fold: g.fold })), ...(o.panelNodes || []), u.clearBtn];
    u.layout = filterLayout({ key: o.storeKey || p, panelId: p + 'Filters', panelNodes: hasPanel ? panelNodes : [], mainNodes: [...(o.top || []), u.results, u.bar] });
    if (!hasPanel) u.layout.setOpen(false, false);
    const head = o.title ? el('div', { class: 'toolbar head lv-head' }, el('h2', { id: o.titleId || null }, o.title), ...(o.headActions || [])) : null;
    api.node = el('div', { class: 'card lv' }, head, ...(o.intro || []), toolbar, u.layout.node);
  }
  function syncFiltersBtn() {
    if (!u.filtersBtn) return;
    const n = nFilters(), open = u.layout.isOpen();
    u.filtersBtn.textContent = 'Filtry' + (n ? ' (' + n + ')' : '') + (open ? ' ◂' : ' ▸');
    u.filtersBtn.setAttribute('aria-expanded', String(open));
    u.filtersBtn.classList.toggle('on', n > 0);
  }
  function sync() {
    if (u.search && u.search.value.trim() !== S.st.q) u.search.value = S.st.q;
    for (const c of u.filters) if (document.activeElement !== c.input) c.input.value = S.st.filters[c.f.key] || '';
    if (nFilters() > 0 && !u.layout.isOpen()) u.layout.setOpen(true, false);   // aktywny filtr zawsze widać
    u.clearBtn.hidden = !LL.isFiltered(S.st, spec);
    syncFiltersBtn();
    if (o.onSync) o.onSync(S.st);
  }

  // ─── Dane ────────────────────────────────────────────────────────────────
  function fetchData(st, kind) {
    if (o.source) return cachedRead(o.source.action, o.source.params(st), { ttl: o.source.ttl, personal: o.source.personal, onUpdate: d => { S.data = d; prepare(); if (o.onData) o.onData(d, S.st); render(); } });
    return o.load(st, kind || {});
  }
  /** Lista w całości (o.local): wyszukiwanie, filtry, sortowanie i strona po stronie przeglądarki; zaznaczenie przycinane do pasujących. */
  function prepare() {
    const d = S.data || { rows: [] }, st = S.st;
    if (!o.local) { S.view = d.rows || []; S.total = d.total; return; }
    let rows = (d.rows || []).filter(r => LL.matchQuery(r, st.q, o.local.searchFields || (x => Object.values(x))) && (!o.local.match || o.local.match(r, st)));
    if (o.select) LL.pruneSelection(S.sel, rows.map(rowId));
    const c = cols.find(x => LL.sortKeyOf(x) === st.sort);
    if (c) rows = LL.sortRows(rows, { value: c.value || c.key, num: c.num, dir: st.dir });
    S.total = rows.length;
    S.view = LL.pageSlice(rows, LL.clampPage(st.page, rows.length, st.size), st.size);
  }
  async function load(kind) {
    const my = ++S.seq;
    S.err = null;
    if (!S.data) u.results.replaceChildren(loadingBox(o.loadingText || 'Wczytuję…'));
    else if (!(kind && kind.background)) u.results.classList.add('fade');
    let d;
    try { d = await fetchData(S.st, kind); } catch (e) {
      if (my !== S.seq) return;
      S.err = e; u.results.classList.remove('fade');
      if (!S.data) { renderError(e); return; }
      render(); return;
    }
    if (my !== S.seq) return;
    S.data = d || { rows: [] };
    u.results.classList.remove('fade');
    if (!o.local && S.data.total != null) {
      const pages = LL.pageCount(S.data.total, S.data.pageSize || S.st.size);
      if (S.st.page > pages && S.data.total > 0) { set({ page: pages }, { replace: true }); return; }
    }
    prepare();
    if (u.live) u.live.loaded(S.data.stamp);
    if (o.onData) o.onData(S.data, S.st);
    if (kind && (kind.background || kind.manual)) keepScroll(render); else render();
  }
  /** Odświeżenie bez skoku: przewinięcie strony i poziome przewinięcie tabeli zostają. */
  function keepScroll(fn) {
    const y = window.scrollY, w = u.results.querySelector('.table-wrap'), x = w ? w.scrollLeft : 0;
    fn();
    const w2 = u.results.querySelector('.table-wrap');
    if (w2 && x) w2.scrollLeft = x;
    if (Math.abs(window.scrollY - y) > 1) window.scrollTo(window.scrollX, y);
  }
  function retryBtn() { return el('button', { type: 'button', class: 'secondary', id: p + 'Retry', onclick: () => load() }, 'Spróbuj ponownie'); }
  function renderError(e) {
    const custom = o.errorBox && o.errorBox(e, () => load());
    u.results.replaceChildren(custom || el('div', { class: 'empty error', role: 'alert' }, (o.errorText || 'Nie udało się wczytać listy') + ': ' + ((e && e.message) || 'błąd') + ' ',
      ...(o.errorExtra ? [o.errorExtra()] : []), el('div', null, retryBtn())));
    renderBar();
  }

  // ─── Widok ───────────────────────────────────────────────────────────────
  function headCell(c) {
    const key = LL.sortKeyOf(c);
    const col = { label: c.label, tip: c.tip || c.label, num: c.num, firstDir: c.firstDir, sort: key || null, sorts: c.sorts, tipHeader: c.tipHeader != null ? c.tipHeader : !!c.tip && c.tip !== c.label };
    const th = sortTh(col, S.st, (sort, dir) => set({ sort, dir }));
    return u.widths ? u.widths.decorate(th, c.key, c.label) : th;
  }
  function render() {
    if (!S.data) { if (S.err) renderError(S.err); return; }
    const st = S.st, vc = visibleCols();
    if (S.only && !S.sel.size) S.only = false;
    const rows = S.only ? [...S.sel.values()] : o.view ? o.view(S.view, S.data) : S.view;
    const ids = rows.map(rowId);
    const head = el('tr', null, o.select ? el('th', { class: 'c' }, el('input', { type: 'checkbox', id: p + 'SelAll', 'aria-label': 'Zaznacz wszystkie na tej stronie',
      title: 'Zaznacz lub odznacz wszystkie pozycje na tej stronie (zaznaczenie z innych stron zostaje)',
      onchange: ev => { for (const r of rows) { if (noSel(r)) continue; if (ev.target.checked) S.sel.set(rowId(r), r); else S.sel.delete(rowId(r)); } syncSel(); } })) : null, vc.map(headCell));
    const body = el('tbody');
    for (const r of rows) {
      const id = rowId(r);
      body.append(el('tr', { ...(o.rowAttrs ? o.rowAttrs(r) : {}), class: [o.open ? 'pick' : '', S.sel.has(id) ? 'sel' : '', o.rowClass ? o.rowClass(r) : ''].filter(Boolean).join(' ') || null, 'data-id': id, 'data-nosel': noSel(r) ? '1' : null, onclick: o.open ? tapOpen(() => o.open(r)) : null },
        o.select ? el('td', { class: 'c' }, el('input', { type: 'checkbox', 'aria-label': 'Zaznacz: ' + (o.select.label ? o.select.label(r) : id), checked: S.sel.has(id) && !noSel(r), disabled: !!noSel(r), title: noSel(r) || null,
          onchange: ev => { if (ev.target.checked) S.sel.set(id, r); else S.sel.delete(id); syncSel(); } })) : null,
        vc.map(c => td(c, c.cell ? c.cell(r, api) : r[c.key]))));
    }
    if (!rows.length) {
      const filtered = LL.isFiltered(st, spec);
      body.append(el('tr', null, el('td', { colspan: String(vc.length + (o.select ? 1 : 0)), class: 'empty', id: p + 'Empty' },
        ...(o.emptyBox ? [].concat(o.emptyBox(st, filtered)) : [filtered ? (o.emptyFiltered || 'Brak wyników dla wyszukiwania i filtrów.') : (o.empty || 'Brak pozycji.'), ' ',
        filtered ? el('button', { type: 'button', class: 'secondary', id: p + 'EmptyClear', onclick: clear }, 'Wyczyść filtry') : (o.emptyAction ? o.emptyAction() : null)]))));
    }
    u.results.replaceChildren(S.err ? el('div', { class: 'notice error', role: 'alert' }, 'Nie udało się odświeżyć — pokazuję poprzednie dane. ', retryBtn()) : null,
      ...(o.above ? [].concat(o.above(S.data, st) || []) : []),
      S.only ? el('div', { class: 'notice info', id: p + 'OnlySel', role: 'status' }, 'Pokazuję tylko zaznaczone (' + rows.length + ') — ze wszystkich stron. ',
        el('button', { type: 'button', class: 'link', onclick: () => { S.only = false; render(); } }, 'Wróć do listy')) : null,
      el('div', { class: 'table-wrap' }, el('table', { id: p + 'Table', class: 'lv-table' + (o.tableClass ? ' ' + o.tableClass : '') }, el('thead', null, head), body)),
      S.only ? null : pagerNode());
    syncSel();
  }
  function pagerNode() {
    const d = S.data, st = S.st, size = o.local ? st.size : (d.pageSize || st.size);
    const onSize = n => { if (o.sizeStore) store(o.sizeStore, n); set({ size: n }); };
    const sizes = spec.sizes.length > 1 ? spec.sizes : null;
    const total = o.local ? S.total : d.total;
    if (total != null) return pager({ prefix: p, page: LL.clampPage(st.page, total, size), pages: LL.pageCount(total, size), total, noun: o.noun || ['pozycja', 'pozycje', 'pozycji'], onPage: n => set({ page: n }), sizes, size: st.size, onSize });
    // Liczba wszystkich nieznana (API podaje tylko „jest następna strona”)
    const hasNext = !!d.hasNext, hasPrev = st.page > 1;
    return el('div', { class: 'ord-pager' },
      el('div', { class: 'pg-nav' },
        el('button', { type: 'button', class: 'secondary pg-btn', id: p + 'Prev', disabled: !hasPrev, 'aria-label': 'Poprzednia strona', title: hasPrev ? 'Poprzednia strona' : 'To pierwsza strona', onclick: () => set({ page: st.page - 1 }) }, '‹'),
        el('span', { class: 'muted', id: p + 'PageNo', title: 'Selly nie podaje liczby wszystkich pozycji w tej sekcji — tylko czy jest następna strona' }, 'Strona ' + st.page),
        el('button', { type: 'button', class: 'secondary pg-btn', id: p + 'Next', disabled: !hasNext, 'aria-label': 'Następna strona', title: hasNext ? 'Następna strona' : 'To ostatnia strona', onclick: () => set({ page: st.page + 1 }) }, '›')),
      el('span', { class: 'muted' }, cnt((d.rows || []).length, ...(o.noun || ['pozycja', 'pozycje', 'pozycji'])) + ' na stronie'),
      sizes ? el('label', { class: 'field-inline', title: 'Ile pozycji pokazać na jednej stronie' }, 'Na stronie',
        el('select', { id: p + 'PageSize', 'aria-label': 'Pozycji na stronie', onchange: ev => onSize(Number(ev.target.value)) }, sizes.map(n => el('option', { value: String(n), selected: n === st.size }, String(n))))) : null);
  }

  // ─── Zaznaczenie ─────────────────────────────────────────────────────────
  function syncSel() {
    if (!o.select) return;
    const trs = [...u.results.querySelectorAll('#' + p + 'Table > tbody > tr[data-id]:not([data-nosel])')];
    for (const tr of trs) {
      const on = S.sel.has(tr.dataset.id); tr.classList.toggle('sel', on);
      const cb = tr.querySelector('td.c input[type=checkbox]'); if (cb) cb.checked = on;
    }
    const all = u.results.querySelector('#' + p + 'SelAll');
    if (all) { const i = LL.selectionInfo(S.sel, trs.map(t => t.dataset.id)); all.checked = i.all; all.indeterminate = i.some; }
    renderBar();
  }
  function renderBar() {
    if (!u.bar) return;
    const n = S.sel.size;
    u.bar.hidden = n === 0;
    if (!n) { u.bar.replaceChildren(); return; }
    const pageIds = [...u.results.querySelectorAll('#' + p + 'Table > tbody > tr[data-id]:not([data-nosel])')].map(t => t.dataset.id);
    const i = LL.selectionInfo(S.sel, pageIds);
    const noun = o.select.noun || ['pozycję', 'pozycje', 'pozycji'];
    u.bar.replaceChildren(
      el('span', null, el('strong', { id: p + 'SelCount' }, 'Zaznaczono: ' + cnt(n, ...noun)),
        selOffNote({ prefix: p, off: i.off, only: S.only, onShow: () => { S.only = true; render(); }, onBack: () => { S.only = false; render(); },
          onUnselOff: () => { for (const k of [...S.sel.keys()]) if (!pageIds.includes(k)) S.sel.delete(k); syncSel(); } })),
      el('button', { type: 'button', class: 'ghost', id: p + 'SelClear', title: 'Odznacz wszystko (na wszystkich stronach)', onclick: () => { S.sel.clear(); if (o.select.onClear) o.select.onClear(); syncSel(); } }, 'Wyczyść zaznaczenie'),
      el('span', { class: 'spacer' }),
      ...[].concat(o.select.actions ? o.select.actions([...S.sel.values()], api) : []));
  }

  const api = {
    node: null, spec, u,
    get state() { return S.st; },
    get data() { return S.data; },
    get rows() { return S.view; },
    get total() { return S.total; },
    selection: S.sel,
    selectedRows: () => [...S.sel.values()],
    clearSelection() { S.sel.clear(); syncSel(); },
    /** Po zmianie `selection` z zewnątrz (np. usunięcie obsłużonych): odśwież pola wyboru i pasek. */
    syncSelection: () => syncSel(),
    /** Wejście na listę (z routera): stan z adresu, wczytanie danych. */
    mount(query) {
      if (!S.built) build();
      S.st = LL.readState(k => (query && query.get(k)) || '', spec, o.sizeStore ? store(o.sizeStore) : undefined);
      sync();
      if (u.live) u.live.start();
      return load();
    },
    stop() { S.seq++; if (u.live) u.live.stop(); },
    reload: kind => load(kind),
    /** Otwarcie / zwinięcie panelu filtrów z kodu modułu (persist = zapamiętaj wybór). */
    openFilters(open, persist) { u.layout.setOpen(open, !!persist); syncFiltersBtn(); },
    /** Odświeżenie widoku bez pobierania (np. zwinięcie gałęzi drzewa, nowe nazwy w kolumnie). */
    render: () => { prepare(); render(); },
    set, setFilter, clear,
    /** Opcje listy filtra (np. z meta po wczytaniu): [[wartość, etykieta]]. */
    setOptions(key, opts) { const c = u.filters && u.filters.find(x => x.f.key === key); if (c && JSON.stringify(S.filterOpts[key]) !== JSON.stringify(opts)) fillSelect(c, opts); },
    hrefOf: st => '#' + o.route + LL.writeState(st || S.st, spec),
  };
  build();
  return api;
}
