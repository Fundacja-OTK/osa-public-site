// Uniwersalny ekran zasobu Selly: lista (#/<id>) → karta (#/<id>/<ID>) → dodawanie (#/<id>/nowy), edycja, usuwanie.
// Definicje: core/resources.js; dane na żywo z Selly przez backend (akcje res:*). Używany dla pozycji menu z kind 'resource'.
import { el, tapOpen, debounce, flash, loadingBox, sellyLink, sortTh, money, dateStr, isUnavailable, cnt } from '../core/ui.js?v=c270c3b';
import { api, ctx } from '../core/client.js?v=c270c3b';
import { cachedRead, invalidate, cacheKey } from '../core/cache.js?v=c270c3b';
import { go, setLeaveGuard } from '../core/router.js?v=c270c3b';
import { RESOURCES } from '../core/resources.js?v=c270c3b';
import { registerListKeys } from '../core/listKeys.js?v=c270c3b';
import { imageBox, setComponentsCard, reviewToggle, marginsCard } from './zasobExtra.js?v=c270c3b';

const SELLY_FALLBACK = 'https://takimarket.pl/adm/';
const MSG_UNAVAILABLE = 'Ten ekran wymaga backendu Cloudflare — chwilowo niedostępny, użyj panelu Selly.';
const PAGE = 50, PAGE_TREE = 200;
const adminUrl = () => (ctx.boot && ctx.boot.adminUrl) || SELLY_FALLBACK;
const isOn = v => v === true || v === 1 || v === '1' || v === 'true';
const allFields = def => def.sections.flatMap(s => s.fields);
const labelOf = (opts, v) => { const o = (opts || []).find(x => String(x[0]) === String(v)); return o ? o[1] : (v == null ? '' : String(v)); };

/** Fabryka modułu dla jednego zasobu. */
export function createResource(id) {
  const def = RESOURCES[id];
  if (!def) throw new Error('Nieznany zasób: ' + id);
  const S = { root: null, seq: 0, rows: new Map(), opts: new Map(), lists: {}, dirty: false, collapsed: new Set() };
  const pageSize = () => (def.tree ? PAGE_TREE : PAGE);
  // Opinie: produkt opinii z wiersza albo z filtra „Produkt (ID)” (gdy to jeden numer) — potrzebny do moderacji
  const parentOf = row => {
    if (!def.parent || !row) return null;
    if (row.product_id != null && row.product_id !== '') return row.product_id;
    const f = String((S.Q && S.Q.filters && S.Q.filters.product_ids) || '').trim();
    return /^\d{1,12}$/.test(f) ? f : null;
  };

  const listHref = () => '#/' + id + (S.listQs || '');
  const sellyUrl = () => adminUrl() + '?a=' + def.a;

  function unavailable(retry) {
    return el('div', { class: 'card' }, el('div', { class: 'empty error' },
      el('p', null, el('strong', null, MSG_UNAVAILABLE)),
      el('p', null, sellyLink('Otwórz w panelu Selly ↗', sellyUrl(), 'Otwiera odpowiednią stronę panelu administracyjnego Selly w nowej karcie')),
      el('p', null, el('button', { type: 'button', class: 'secondary', onclick: retry }, 'Spróbuj ponownie'))));
  }
  const failBox = (e, retry, what) => isUnavailable(e) ? unavailable(retry) : el('div', { class: 'card' }, el('div', { class: 'empty error' },
    'Nie udało się pobrać ' + what + ': ' + ((e && e.message) || 'błąd'), el('div', null, el('button', { type: 'button', class: 'secondary', onclick: retry }, 'Spróbuj ponownie'))));

  // ─── Słowniki (listy wyboru) ───────────────────────────────────────────────
  async function options(ref) {
    // słowniki z Selly (każde pobranie = zapytania do Selly): od razu z pamięci (core/cache.js; sessionStorage tylko dla słowników z PERSIST),
    // odświeżane w tle po przeładowaniu i po 10 min — kolejne użycie dostaje świeże
    if (!S.opts.has(ref)) S.opts.set(ref, cachedRead('res:options', { res: ref }, { ttl: 10 * 60e3, personal: false, onUpdate: r => { S.lists[ref] = r.options || []; S.opts.set(ref, Promise.resolve(S.lists[ref])); } }).then(r => { S.lists[ref] = r.options || []; return S.lists[ref]; }, e => { S.opts.delete(ref); throw e; }));
    return S.opts.get(ref);
  }

  // ─── Wartości w komórkach ──────────────────────────────────────────────────
  function cell(col, r, refOpts) {
    const v = r[col.key];
    const fieldOpts = () => { const f = allFields(def).find(x => x.key === col.key); return (col.options && col.options.length ? col.options : f && f.options) || []; };
    if (col.type === 'order') {
      const t = v == null ? '' : String(v);
      return el('td', { class: 'nw' }, r.order_id ? el('a', { href: '#/zamowienia/' + encodeURIComponent(r.order_id), class: 'cell-name', title: 'Otwórz zamówienie ' + t + ' w panelu' }, t || String(r.order_id)) : t);
    }
    if (col.type === 'toggle') {
      const td0 = el("td", { class: "nw" });
      td0.append(reviewToggle(r, parentOf(r), () => loadList()));
      return td0;
    }
    if (col.type === 'bool') return el('td', { class: 'nw' }, isOn(v) ? el('span', { class: 'tag ok' }, 'tak') : el('span', { class: 'muted' }, 'nie'));
    if (col.type === 'enum') return el('td', null, labelOf(fieldOpts(), v));
    if (col.type === 'ref') { const o = (refOpts[col.ref] || []).find(x => String(x.value) === String(v)); return el('td', null, o ? o.label : (v == null || v === '' ? '' : String(v))); }
    if (col.type === 'money') return el('td', { class: 'n nw' }, v == null || v === '' ? '—' : money(v));
    if (col.type === 'date') return el('td', { class: 'nw' }, dateStr(v));
    if (col.type === 'stars') return el('td', { class: 'nw', title: v + ' / 5' }, v ? '★'.repeat(Math.min(5, Number(v))) + '☆'.repeat(5 - Math.min(5, Number(v))) : '');
    if (col.type === 'excerpt') { const t = String(v || ''); return el('td', { title: t.length > 80 ? t : null }, t.length > 80 ? t.slice(0, 80) + '…' : t); }
    if (col.tree) {
      const d = r._depth || 0;
      return el('td', null, el('span', { class: 'zs-indent', style: 'padding-left:' + d * 20 + 'px' }, d ? el('span', { class: 'muted', 'aria-hidden': 'true' }, '└ ') : null,
        el('a', { href: '#/' + id + '/' + encodeURIComponent(r[def.idField]), class: 'cell-name' }, r[col.key] == null || r[col.key] === '' ? '(bez nazwy)' : String(r[col.key]))));
    }
    return el('td', { class: col.num ? 'n nw' : null }, v == null ? '' : String(v));
  }

  // ─── Lista ─────────────────────────────────────────────────────────────────
  function readQ(query) {
    const g = k => (query && query.get(k)) || '';
    const colKeys = def.columns.map(c => c.key);
    const sort = colKeys.includes(g('sort')) ? g('sort') : (def.defaultSort ? def.defaultSort.key : '');
    const dir = g('dir') === 'asc' || g('dir') === 'desc' ? g('dir') : (def.defaultSort && sort === def.defaultSort.key ? def.defaultSort.dir : 'asc');
    const filters = {};
    for (const f of def.filters || []) if (g('f_' + f.key) !== '') filters[f.key] = g('f_' + f.key);
    return { q: g('q'), page: Math.max(1, parseInt(g('page'), 10) || 1), sort, dir, filters };
  }
  function qsOf(Q) {
    const p = new URLSearchParams();
    if (Q.q) p.set('q', Q.q);
    for (const [k, v] of Object.entries(Q.filters)) p.set('f_' + k, v);
    if (Q.page > 1) p.set('page', String(Q.page));
    const ds = def.defaultSort;
    if (Q.sort && (!ds || Q.sort !== ds.key || Q.dir !== ds.dir)) { p.set('sort', Q.sort); p.set('dir', Q.dir); }
    const s = p.toString();
    return s ? '?' + s : '';
  }
  function setQ(patch) {
    const n = Object.assign({}, S.Q, patch);
    if (!('page' in patch)) n.page = 1;
    const h = '/' + id + qsOf(n);
    if (location.hash === '#' + h) { S.Q = n; S.listQs = qsOf(n); loadList(); } else go(h);
  }

  function buildList(box) {
    const u = S.ui = {};
    u.search = el('input', { type: 'search', id: 'zsSearch', placeholder: def.searchHint, 'aria-label': def.searchHint, title: def.searchTip || def.searchHint, value: S.Q.q });
    u.search.addEventListener('input', debounce(() => { if (u.search.value.trim() !== S.Q.q) setQ({ q: u.search.value.trim() }); }, 350));
    const filterBox = (def.filters || []).length ? el('details', { class: 'zs-filters', id: 'zsFilters', open: Object.keys(S.Q.filters).length ? true : null },
      el('summary', { title: 'Dodatkowe filtry listy' }, 'Filtry'), el('div', { class: 'zs-filter-row' }, def.filters.map(f => filterControl(f)))) : null;
    u.results = el('div', { id: 'zsResults' });
    registerListKeys({ screen: 'zasob', table: 'zsTable', search: 'zsSearch', back: 'zsBack', extra: [{ keys: ['n'], label: 'N', desc: 'Dodaj nowy rekord', id: 'zsAdd' }] });
    const add = def.canCreate ? el('a', { href: '#/' + id + '/nowy', write: id, id: 'zsAdd', class: 'zs-add', title: 'Otwiera pusty formularz — nowy rekord zapisze się w Selly' }, '+ ' + def.addLabel) : null;
    box.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'toolbar head zs-head' }, el('h2', { id: 'zsTitle' }, def.many), add),
      def.readOnlyNote ? el('div', { class: 'sub muted zs-note' }, def.readOnlyNote) : null,
      el('div', { class: 'toolbar' }, u.search), filterBox, u.results));
  }
  function filterControl(f) {
    const sel = el('select', { id: 'zsF-' + f.key, 'aria-label': f.label, title: f.tip || f.label }, el('option', { value: '' }, 'wszystkie'));
    const fill = opts => { for (const [v, l] of opts) sel.append(el('option', { value: String(v) }, l)); sel.value = S.Q.filters[f.key] != null ? S.Q.filters[f.key] : ''; };
    if (f.type === 'date' || f.type === 'text') {
      const inp = el('input', { type: f.type === 'date' ? 'date' : 'text', id: 'zsF-' + f.key, 'aria-label': f.label, title: f.tip || f.label, value: S.Q.filters[f.key] || '' });
      const apply = () => { const filters = Object.assign({}, S.Q.filters); if (inp.value.trim() === '') delete filters[f.key]; else filters[f.key] = inp.value.trim(); if (JSON.stringify(filters) !== JSON.stringify(S.Q.filters)) setQ({ filters }); };
      inp.addEventListener(f.type === 'date' ? 'change' : 'input', f.type === 'date' ? apply : debounce(apply, 450));
      return el('label', { class: 'field-inline', title: f.tip || null }, f.label, ' ', inp);
    }
    if (f.type === 'ref') options(f.ref).then(o => fill(o.map(x => [x.value, x.label]))).catch(() => {}); else fill(f.options);
    sel.addEventListener('change', () => { const filters = Object.assign({}, S.Q.filters); if (sel.value === '') delete filters[f.key]; else filters[f.key] = sel.value; setQ({ filters }); });
    return el('label', { class: 'field-inline', title: f.tip || null }, f.label, ' ', sel);
  }

  async function loadList() {
    const my = ++S.seq, Q = S.Q, u = S.ui;
    u.results.replaceChildren(loadingBox('Pobieram ' + def.many.toLowerCase() + ' z Selly…'));
    let d, refOpts = {};
    try {
      d = await api('res:list', { res: id, page: Q.page, pageSize: pageSize(), q: Q.q, sort: Q.sort, dir: Q.dir, filters: Q.filters });
      for (const c of def.columns) if (c.type === 'ref') refOpts[c.ref] = await options(c.ref).catch(() => []);
    } catch (e) {
      if (my !== S.seq) return;
      u.results.replaceChildren(failBox(e, loadList, def.many.toLowerCase()));
      return;
    }
    if (my !== S.seq) return;
    S.data = d;
    S.rows = new Map(d.rows.map(r => [String(r[def.idField]), r]));
    renderRows(d, refOpts);
  }

  function renderRows(d, refOpts) {
    const Q = S.Q, u = S.ui;
    const head = el('tr', null, def.columns.map(c => sortTh({ label: c.label, sort: c.key, num: c.num, tip: c.tip + (S.data && S.data.pageOnlySearch ? '' : ''), firstDir: c.firstDir, tipHeader: c.tip && c.tip !== c.label },
      Q, (sort, dir) => setQ({ sort, dir }))));
    const body = el('tbody');
    const treeMode = !!def.tree && !Q.q && !Q.sort;
    let skipBelow = null;
    d.rows.forEach((r, i) => {
      const rid = String(r[def.idField]);
      const depth = r._depth || 0, hasKids = treeMode && d.rows[i + 1] && (d.rows[i + 1]._depth || 0) > depth;
      if (treeMode) {
        if (skipBelow != null && depth > skipBelow) return;
        skipBelow = S.collapsed.has(rid) && hasKids ? depth : null;
      }
      body.append(el('tr', { class: 'pick', 'data-id': rid, onclick: tapOpen(() => go('/' + id + '/' + encodeURIComponent(rid))) },
        def.columns.map((c, i) => {
          const td = cell(c, r, refOpts);
          if (i === 0 && !c.tree) { const t = td.textContent; td.replaceChildren(el('a', { href: '#/' + id + '/' + encodeURIComponent(rid), class: 'cell-name' }, t || '(bez nazwy)')); }
          if (i === 0 && hasKids) {
            const open = !S.collapsed.has(rid);
            const lead = td.querySelector('.zs-indent');
            (lead || td).prepend(el('button', { type: 'button', class: 'zs-fold', 'aria-expanded': String(open), title: open ? 'Zwiń podkategorie' : 'Rozwiń podkategorie',
              onclick: ev => { ev.stopPropagation(); if (open) S.collapsed.add(rid); else S.collapsed.delete(rid); renderRows(d, refOpts); } }, open ? '▾' : '▸'));
          }
          return td;
        })));
    });
    if (!d.rows.length) body.append(el('tr', null, el('td', { colspan: String(def.columns.length), class: 'empty' },
      Q.q || Object.keys(Q.filters).length ? 'Brak wyników dla wyszukiwania i filtrów. ' : 'Brak pozycji. ',
      Q.q || Object.keys(Q.filters).length ? el('button', { type: 'button', class: 'secondary', onclick: () => setQ({ q: '', filters: {} }) }, 'Wyczyść filtry')
        : (def.canCreate ? el('a', { write: id, href: '#/' + id + '/nowy' }, def.addLabel) : null))));
    const hasPrev = Q.page > 1;
    const hasNext = d.total != null ? Q.page * d.pageSize < d.total : !!d.hasNext;
    const foldAll = treeMode && d.rows.some((r, i) => d.rows[i + 1] && (d.rows[i + 1]._depth || 0) > (r._depth || 0))
      ? el('div', { class: 'toolbar zs-fold-bar' }, el('button', { type: 'button', class: 'secondary', id: 'zsFoldAll', title: 'Zwija wszystkie kategorie do najwyższego poziomu',
        onclick: () => { for (const r of d.rows) S.collapsed.add(String(r[def.idField])); renderRows(d, refOpts); } }, 'Zwiń wszystko'),
      el('button', { type: 'button', class: 'secondary', id: 'zsUnfoldAll', title: 'Rozwija całe drzewo kategorii', onclick: () => { S.collapsed.clear(); renderRows(d, refOpts); } }, 'Rozwiń wszystko')) : null;
    const pages = d.total != null ? Math.max(1, Math.ceil(d.total / d.pageSize)) : null;
    u.results.replaceChildren(
      d.truncated ? el('div', { class: 'notice warn' }, 'Lista jest bardzo długa — pokazuję pierwsze 1000 pozycji. Użyj wyszukiwania, aby znaleźć resztę.') : null,
      d.pageOnlySearch ? el('div', { class: 'notice warn', id: 'zsPageOnly', title: 'API Selly nie ma wyszukiwania w tej sekcji' }, 'Selly nie ma wyszukiwania w tej sekcji — przeszukana została tylko bieżąca strona listy.') : null,
      foldAll,
      el('div', { class: 'table-wrap' }, el('table', { id: 'zsTable' }, el('thead', null, head), body)),
      el('div', { class: 'ord-pager' },
        el('button', { type: 'button', class: 'secondary', id: 'zsPrev', disabled: !hasPrev, title: hasPrev ? 'Poprzednia strona' : 'To pierwsza strona', onclick: () => setQ({ page: Q.page - 1 }) }, '← Poprzednia'),
        el('span', { class: 'muted' }, 'Strona ' + Q.page + (pages ? ' z ' + pages + ' · ' + cnt(d.total, 'pozycja', 'pozycje', 'pozycji') : ' · ' + cnt(d.rows.length, 'pozycja', 'pozycje', 'pozycji') + ' na stronie')),
        el('button', { type: 'button', class: 'secondary', id: 'zsNext', disabled: !hasNext, title: hasNext ? 'Następna strona' : 'To ostatnia strona', onclick: () => setQ({ page: Q.page + 1 }) }, 'Następna →')));
  }

  // ─── Karta / formularz ─────────────────────────────────────────────────────
  function setDirty(v) { S.dirty = v; }

  function fieldControl(f, value, ctl) {
    // zwraca { node, get() } — get() daje wartość „surową” (string / 0|1) do porównania z oryginałem
    const idAttr = 'zsF-' + f.key;
    const common = { id: idAttr, name: f.key, title: f.help || f.label, 'aria-label': f.label };
    if (f.type === 'bool') {
      const cb = el('input', { type: 'checkbox', ...common, checked: isOn(value) ? true : null, disabled: f.readOnly ? true : null });
      cb.addEventListener('change', ctl.changed);
      return { node: cb, get: () => (cb.checked ? 1 : 0), norm: v => (isOn(v) ? 1 : 0) };
    }
    if (f.type === 'select' || f.type === 'ref') {
      const sel = el('select', { ...common, disabled: f.readOnly ? true : null });
      const fill = opts => {
        sel.replaceChildren();
        if (f.type === 'ref' && f.rootLabel) sel.append(el('option', { value: '0' }, f.rootLabel));
        else if (!f.required) sel.append(el('option', { value: '' }, '— wybierz —'));
        for (const [v, l] of opts) sel.append(el('option', { value: String(v) }, l));
        if (value != null && value !== '' && ![...sel.options].some(o => o.value === String(value))) sel.append(el('option', { value: String(value) }, String(value) + ' (wartość z Selly)'));
        sel.value = value == null || value === '' ? (f.rootLabel ? '0' : '') : String(value);
        ctl.refreshed();
      };
      if (f.type === 'ref') {
        fill([]);
        options(f.ref).then(o => {
          const banned = f.tree && ctl.itemId != null ? descendants(o, ctl.itemId) : new Set();
          fill(o.filter(x => !banned.has(String(x.value))).map(x => [x.value, (f.tree ? '  '.repeat(x.depth || 0) : '') + x.label]));
        }).catch(() => { ctl.refreshed(); });
      } else fill(f.options || []);
      sel.addEventListener('change', ctl.changed);
      return { node: sel, get: () => sel.value, norm: v => (v == null || v === '' ? (f.rootLabel ? '0' : '') : String(v)), el: sel };
    }
    if (f.type === 'image') return { node: imageBox(value), get: () => null, norm: () => null };
    if (f.type === 'rows') {
      const rows = Array.isArray(value) ? value : [];
      const t = el('table', { id: idAttr, class: 'zs-rows' }, el('thead', null, el('tr', null, f.columns.map(c => el('th', { class: c.num ? 'n' : null }, el('span', { title: c.tip || c.label }, c.label))))),
        el('tbody', null, rows.length ? rows.map(r => el('tr', null, f.columns.map(c => el('td', { class: c.num ? 'n nw' : null }, c.type === 'money' ? money(r[c.key]) : (r[c.key] == null ? '' : String(r[c.key])))))) :
          el('tr', null, el('td', { colspan: String(f.columns.length), class: 'empty' }, 'Brak pozycji.'))));
      return { node: el('div', { class: 'table-wrap' }, t), get: () => null, norm: () => null };
    }
    const multi = f.type === 'textarea' || f.type === 'html';
    const num = f.type === 'number' || f.type === 'money';
    const inp = multi ? el('textarea', { ...common, rows: f.type === 'html' ? '9' : '4', class: f.type === 'html' ? 'zs-html' : null, readonly: f.readOnly ? true : null })
      : el('input', { ...common, type: num ? 'number' : 'text', step: num ? 'any' : null, readonly: f.readOnly ? true : null, placeholder: f.key === 'next_date' ? 'RRRR-MM-DD' : null });
    inp.value = value == null ? '' : String(value);
    inp.addEventListener('input', ctl.changed);
    return { node: inp, get: () => inp.value, norm: v => (v == null ? '' : String(v)) };
  }

  function descendants(opts, rootId) {
    const out = new Set([String(rootId)]);
    let grew = true;
    while (grew) { grew = false; for (const o of opts) if (!out.has(String(o.value)) && out.has(String(o.parent))) { out.add(String(o.value)); grew = true; } }
    return out;
  }

  function buildForm(box, item, meta) {
    const create = item == null;
    const fields = allFields(def);
    const ctls = new Map(), orig = new Map();
    const msg = el('div', { id: 'zsMsg', role: 'status' });
    const save = el('button', { type: 'button', class: 'primary', write: id, id: 'zsSave', title: create ? 'Dodaje rekord w Selly' : 'Zapisuje zmiany w Selly', disabled: true }, create ? 'Dodaj' : 'Zapisz zmiany');
    const markDirty = () => {
      let any = false;
      for (const f of fields) {
        const c = ctls.get(f.key); if (!c || f.readOnly || f.type === 'rows' || f.type === 'image') continue;
        if (String(c.get()) !== String(c.norm(orig.get(f.key)))) { any = true; break; }
      }
      setDirty(any);
      save.disabled = !(def.canEdit && (create ? true : any));
      save.title = save.disabled && !create ? 'Brak zmian do zapisania' : (create ? 'Dodaje rekord w Selly' : 'Zapisuje zmiany w Selly');
    };
    const ctl = { changed: markDirty, refreshed: markDirty, itemId: create ? null : item[def.idField] };
    const pid = def.parent && !create ? parentOf(item) : null;
    const editable = create ? def.canCreate : (def.canEdit && (!def.parent || !!pid));

    const secs = def.sections.map(s => {
      const grid = el('div', { class: 'zs-grid' });
      for (const f0 of s.fields) {
        const f = editable ? f0 : { ...f0, readOnly: true };
        const raw = create ? (f.type === 'bool' && (f.key === 'display' || f.key === 'visible') ? 1 : (f.key === 'parent_id' && S.newParent ? S.newParent : null)) : item[f.key];
        const c = fieldControl(f, raw, ctl);
        ctls.set(f.key, c); orig.set(f.key, raw);
        if (f.readOnly && f.type !== 'rows' && f.type !== 'bool' && f.type !== 'image') {
          const ro = c.node.tagName === 'SELECT' ? c.node : c.node;
          if (ro.tagName === 'INPUT' || ro.tagName === 'TEXTAREA') ro.setAttribute('readonly', '');
        }
        grid.append(el('div', { class: 'zs-field' + (f.wide || f.type === 'rows' || f.type === 'html' || f.type === 'textarea' ? ' wide' : '') + (f.readOnly ? ' ro' : '') },
          el('label', { for: 'zsF-' + f.key, class: 'zs-label' + (f.help ? ' tip' : ''), title: f.help ? f.help + (f.readOnly && f.type !== 'rows' ? ' (tylko do odczytu)' : '') : (f.readOnly ? 'Tylko do odczytu' : null) },
            f.label, f.required ? el('span', { class: 'req', title: 'Pole wymagane', 'aria-hidden': 'true' }, ' *') : null), c.node,
          f.help && !f.readOnly ? el('div', { class: 'zs-help muted' }, f.help) : null));
      }
      if (s.advanced) return el('details', { class: 'card zs-sec', 'data-sec': s.title }, el('summary', { title: 'Rzadziej potrzebne ustawienia — kliknij, aby rozwinąć' }, s.title + ' (zaawansowane)'), grid);
      return el('div', { class: 'card zs-sec', 'data-sec': s.title }, el('div', { class: 'card-head' }, el('h2', null, s.title)), grid);
    });
    markDirty();

    save.addEventListener('click', async () => {
      msg.replaceChildren();
      const changed = {};
      const fail = t => { msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, t)); };
      for (const f of fields) {
        const c = ctls.get(f.key); if (!c || f.readOnly || f.type === 'rows' || f.type === 'image') continue;
        const v = c.get();
        if (!create && String(v) === String(c.norm(orig.get(f.key)))) continue;
        if (v === '' && create) continue;
        if (v === '' && ['number', 'money', 'date', 'select', 'ref'].includes(f.type)) { fail('Pole „' + f.label + '” nie może być puste.'); return; }
        if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) { fail('Pole „' + f.label + '”: wpisz datę jako RRRR-MM-DD.'); return; }
        changed[f.key] = v;
      }
      for (const f of fields) {
        if (!f.required || f.readOnly) continue;
        const cur = f.key in changed ? changed[f.key] : (create ? '' : orig.get(f.key));
        if (!String(cur == null ? '' : cur).trim()) { fail('Pole „' + f.label + '” jest wymagane.'); ctls.get(f.key).node.focus(); return; }
      }
      if (!Object.keys(changed).length) { msg.replaceChildren(el('div', { class: 'notice warn' }, 'Brak zmian do zapisania.')); return; }
      save.disabled = true;
      try {
        const r = await api('res:save', { res: id, id: create ? undefined : item[def.idField], fields: changed, productId: pid || undefined });
        setDirty(false);
        if (def.tree || id === 'kategorie') { S.opts.delete('kategorie'); invalidate(cacheKey('res:options', { res: 'kategorie' })); }
        invalidate(cacheKey('res:options', { res: id }));
        flash('', create ? 'Dodano w Selly: ' + def.one : 'Zapisano w Selly');
        if (create) go(r.id ? '/' + id + '/' + encodeURIComponent(r.id) : '/' + id);
        else renderCard(String(item[def.idField]));
      } catch (e) {
        save.disabled = false;
        msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Nie udało się zapisać: ' + ((e && e.message) || 'błąd')));
      }
    });

    const cancel = el('a', { href: listHref(), id: 'zsCancel', class: 'btn-link zs-cancel', title: 'Wraca do listy bez zapisywania' }, 'Anuluj');
    let del = null;
    if (!create && def.canDelete && meta && meta.canDelete && (!def.parent || pid)) {
      del = el('button', { type: 'button', class: 'secondary danger', write: id, id: 'zsDelete', title: 'Usuwa rekord z Selly — tego nie da się cofnąć',
        onclick: async () => {
          const name = String(item[def.titleField] || item[def.idField]);
          const u = meta && meta.usage ? meta.usage : null;
          const used = u && ((u.products || 0) > 0 || u.children);
          const usedTxt = used ? 'UWAGA: ' + (u.products ? 'przypisanych produktów: ' + u.products + (u.productsExact ? '' : ' lub więcej') + '. ' : '') + (u.children ? 'Ma podkategorie. ' : '') + '\n\n' : '';
          if (!confirm('Usunąć „' + name + '” z Selly?\n\n' + usedTxt + (def.deleteWarn ? def.deleteWarn + '\n\n' : '') + 'Tego nie można cofnąć.')) return;
          del.disabled = true;
          try { await api('res:delete', { res: id, id: item[def.idField], force: used ? true : undefined, productId: pid || undefined }); setDirty(false); S.opts.delete(id); invalidate(cacheKey('res:options', { res: id })); flash('', 'Usunięto z Selly'); go('/' + id); }
          catch (e) { del.disabled = false; msg.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, 'Nie udało się usunąć: ' + ((e && e.message) || 'błąd'))); }
        } }, 'Usuń');
    }
    const actions = editable ? el('div', { class: 'zs-actions' }, save, cancel, el('span', { class: 'spacer' }), del) : el('div', { class: 'zs-actions' }, el('a', { href: listHref(), class: 'btn-link', id: 'zsCancel' }, '← Wróć do listy'));
    const form = el('form', { id: 'zsForm', novalidate: true, onsubmit: ev => ev.preventDefault() }, ...secs, msg, actions);
    return form;
  }

  function itemsCard(gid, items, meta) {
    const cfg = def.items;
    const host = el('div', { class: 'card zs-sec', id: 'zsItems' });
    const draw = rows => {
      const tbody = el('tbody');
      const mkRow = (r) => {
        const nm = el('input', { type: 'text', value: r ? r.name || '' : '', 'aria-label': 'Nazwa wartości', title: 'Nazwa wartości (np. „XL”, „czerwony”)' });
        const pos = el('input', { type: 'number', value: r && r.position != null ? String(r.position) : '', 'aria-label': 'Kolejność', title: 'Pozycja wartości — mniejsza liczba = wyżej', class: 'zs-pos' });
        const rm = el('span', { class: 'zs-item-msg muted', role: 'status' });
        const btn = el('button', { type: 'button', class: 'secondary', write: id, title: r ? 'Zapisuje zmiany tej wartości w Selly' : 'Dodaje wartość do grupy w Selly' }, r ? 'Zapisz' : 'Dodaj');
        btn.addEventListener('click', async () => {
          if (!nm.value.trim()) { rm.textContent = 'Wpisz nazwę.'; return; }
          const fields = { name: nm.value.trim() };
          if (pos.value !== '') fields.position = Number(pos.value);
          btn.disabled = true;
          try { await api('res:itemSave', { res: id, id: gid, itemId: r ? r[cfg.idField] : undefined, fields }); flash('', r ? 'Zapisano wartość' : 'Dodano wartość'); reloadItems(); }
          catch (e) { btn.disabled = false; rm.textContent = 'Błąd: ' + ((e && e.message) || ''); }
        });
        const del = r && meta && meta.canDelete ? el('button', { type: 'button', class: 'secondary danger', write: id, title: 'Usuwa wartość z grupy w Selly — tego nie da się cofnąć',
          onclick: async () => {
            if (!confirm('Usunąć wartość „' + (r.name || r[cfg.idField]) + '” z Selly? Tego nie można cofnąć.')) return;
            try { await api('res:itemDelete', { res: id, id: gid, itemId: r[cfg.idField] }); flash('', 'Usunięto wartość'); reloadItems(); }
            catch (e) { rm.textContent = 'Błąd: ' + ((e && e.message) || ''); }
          } }, 'Usuń') : null;
        return el('tr', { 'data-item': r ? String(r[cfg.idField]) : 'new' }, el('td', null, nm), el('td', { class: 'n' }, pos), el('td', { class: 'nw' }, btn, ' ', del, ' ', rm));
      };
      for (const r of rows) tbody.append(mkRow(r));
      tbody.append(mkRow(null));
      host.replaceChildren(el('div', { class: 'card-head' }, el('h2', null, cfg.title + ' (' + rows.length + ')'), el('div', { class: 'sub' }, 'Wartości, z których klient wybiera wariant lub opcję produktu. Zmiany zapisują się od razu w Selly (każdy wiersz osobno).')),
        el('div', { class: 'table-wrap' }, el('table', { id: 'zsItemsTable' }, el('thead', null, el('tr', null, cfg.columns.map(c => el('th', { class: c.num ? 'n' : null }, el('span', { title: c.tip }, c.label))), el('th', null, el('span', { title: 'Zapisz, dodaj albo usuń wartość' }, 'Akcje')))), tbody)));
    };
    const reloadItems = async () => {
      try { const r = await api('res:get', { res: id, id: gid }); draw(r.items || []); } catch (e) { host.replaceChildren(el('div', { class: 'notice error' }, 'Nie udało się odświeżyć wartości: ' + ((e && e.message) || ''))); }
    };
    draw(items);
    return host;
  }

  // Ostrzeżenie o użyciu (kategorie, producenci) i skrót „dodaj podkategorię”
  function usageBox(meta, item) {
    const u = meta && meta.usage;
    const kids = def.tree ? childCount(item[def.idField]) : null;
    const parts = [];
    if (u && u.products != null) parts.push(el('span', { id: 'zsUsageProducts', title: 'Tyle produktów jest przypisanych do tej pozycji w Selly' }, 'Produktów: ' + u.products + (u.productsExact ? '' : '+')));
    if (kids != null) parts.push(el('span', { id: 'zsUsageKids', title: 'Liczba bezpośrednich podkategorii' }, 'Podkategorii: ' + kids));
    const sub = def.addSub ? el('a', { href: '#/' + id + '/nowy?parent=' + encodeURIComponent(item[def.idField]), write: id, id: 'zsAddSub', class: 'btn-link', title: 'Otwiera pusty formularz z tą kategorią jako nadrzędną' }, '+ Dodaj podkategorię') : null;
    if (!parts.length && !sub) return null;
    return el('div', { class: 'zs-usage' }, ...parts, sub);
  }
  function childCount(pid) {
    const o = S.lists[id];
    return o ? o.filter(x => String(x.parent) === String(pid)).length : null;
  }
  function cardLinks(item) {
    const links = (def.cardLinks || []).filter(l => item[l.key] && String(item[l.key]) !== '0');
    if (!links.length) return null;
    return el('div', { class: 'zs-links' }, links.map(l => el('a', { href: '#/zamowienia/' + encodeURIComponent(item[l.key]), class: 'btn-link', title: l.tip }, l.label)));
  }
  // Szybkie akcje karty (np. „Anuluj subskrypcję”): jedno kliknięcie = zapis wskazanych pól w Selly
  function quickActions(item) {
    const acts = (def.quickActions || []).filter(a => !a.when || a.when(item));
    if (!acts.length) return null;
    const msg = el('span', { class: 'zs-item-msg muted', role: 'status' });
    return el('div', { class: 'zs-links' }, acts.map(a => el('button', { type: 'button', class: 'secondary' + (a.danger ? ' danger' : ''), write: id, id: 'zsQuick-' + a.id, title: a.tip, onclick: async ev => {
      if (a.confirm && !confirm(a.confirm)) return;
      const b = ev.currentTarget; b.disabled = true;
      try { await api('res:save', { res: id, id: item[def.idField], fields: a.fields }); flash('', 'Zapisano w Selly'); renderCard(String(item[def.idField])); }
      catch (e) { b.disabled = false; msg.textContent = 'Błąd: ' + ((e && e.message) || ''); }
    } }, a.label)), msg);
  }

  async function renderCard(itemId, query) {
    S.newParent = itemId === 'nowy' && query && /^\d{1,12}$/.test(query.get('parent') || '') ? query.get('parent') : null;
    const my = ++S.seq, box = S.cardBox;
    setLeaveGuard(null); setDirty(false);
    const create = itemId === 'nowy';
    box.replaceChildren(el('div', { class: 'card' }, loadingBox('Pobieram z Selly…')));
    let item = null, meta = { canDelete: false }, items = null;
    if (!create) {
      if (def.noGet) {
        item = S.rows.get(String(itemId)) || null;
        if (!item) { box.replaceChildren(el('div', { class: 'card' }, el('div', { class: 'empty' }, 'Tej pozycji nie ma w ostatnio wczytanej liście. ', el('a', { href: listHref() }, '← Wróć do listy'), ' i wybierz ją ponownie.'))); return; }
      } else {
        try { const r = await api('res:get', { res: id, id: itemId }); item = r.item; meta = r; items = r.items; S.cardData = r; }
        catch (e) {
          if (my !== S.seq) return;
          box.replaceChildren(failBox(e, () => renderCard(itemId), 'rekordu'), el('p', null, el('a', { href: listHref(), class: 'btn-link' }, '← Wróć do listy')));
          return;
        }
      }
    } else if (!def.canCreate) { go('/' + id, { replace: true }); return; }
    if (def.tree) await options(id).catch(() => []);
    if (my !== S.seq) return;
    const title = create ? def.newTitle : String(item[def.titleField] == null || item[def.titleField] === '' ? def.one + ' ' + itemId : item[def.titleField]);
    box.replaceChildren(
      el('div', { class: 'card' },
        el('div', { class: 'ord-detail-top' }, el('a', { href: listHref(), class: 'btn-link', id: 'zsBack', title: 'Wraca do listy z zachowanym wyszukiwaniem' }, '← Wróć do listy'), el('span', { class: 'spacer' }),
          sellyLink('Edytuj w Selly ↗', sellyUrl(), 'Otwiera odpowiednią sekcję panelu administracyjnego Selly w nowej karcie — tam zmienisz to, czego nie da się tu (np. ' + (def.parent ? 'edycja opinii bez numeru produktu' : def.readOnlyNote ? 'pozycje, statusy, usuwanie' : 'pliki i obrazki') + ')')),
        el('div', { class: 'card-head' }, el('h2', { id: 'zsCardTitle' }, title), create ? null : el('div', { class: 'sub' }, 'ID ' + itemId)),
        !create && def.editNote ? el('div', { class: 'sub muted zs-note' }, def.editNote) : null,
        create && def.createNote ? el('div', { class: 'sub muted zs-note', id: 'zsCreateNote' }, def.createNote) : null,
        def.readOnlyNote && (!def.canEdit || def.parent) ? el('div', { class: 'sub muted zs-note' }, def.readOnlyNote) : null,
        !create ? usageBox(meta, item) : null, !create ? cardLinks(item) : null, !create ? quickActions(item) : null),
      buildForm(box, create ? null : item, meta));
    if (def.items && !create) box.append(def.setCard ? setComponentsCard(itemId, S.cardData || { items: items || [], item }, () => renderCard(itemId)) : itemsCard(itemId, items || [], meta));
    if (def.margins && !create) box.append(marginsCard(id, itemId, def.canEdit));
    setLeaveGuard(() => (S.dirty ? 'Masz niezapisane zmiany. Wyjść bez zapisywania?' : null));
  }

  // ─── Trasa ─────────────────────────────────────────────────────────────────
  return {
    id, title: def.many, routes: ['', '<id>', 'nowy'],
    mount(host, params) {
      if (!S.root) {
        S.root = host;
        S.listBox = el('div'); S.cardBox = el('div');
        host.replaceChildren(S.listBox, S.cardBox);
      }
      const part = (params && params.parts && params.parts[0]) || '';
      S.listBox.hidden = !!part; S.cardBox.hidden = !part;
      if (part) { renderCard(part, params && params.query); return; }
      setLeaveGuard(null); setDirty(false);
      S.Q = readQ(params && params.query);
      S.listQs = qsOf(S.Q);
      buildList(S.listBox);
      loadList();
    },
    unmount() { S.seq++; setLeaveGuard(null); setDirty(false); },
  };
}
