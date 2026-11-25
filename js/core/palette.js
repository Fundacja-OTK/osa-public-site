// Szybkie wyszukiwanie (Ctrl+K): okno w środku ekranu — ekrany panelu, ostatnio otwarte miejsca i rekordy na żywo
// (zamówienia, klienci, produkty z istniejących akcji API), prefiksy zam: kli: prod: ekran:. Oraz okno pomocy „?” ze skrótami.
import { el } from './ui.js?v=6d8ea70';
import { api } from './client.js?v=6d8ea70';
import { go } from './router.js?v=6d8ea70';
import { ITEMS, itemById, icon, menuModel, groupOf, groupById, keywordsOf } from './nav.js?v=6d8ea70';
import { highlightParts, matchScreens, parseQuery, PREFIXES } from './search.js?v=6d8ea70';
import { loadRecents, noteVisit, hashOf, TYPES } from './recents.js?v=6d8ea70';
import { shortcuts, GOTO } from './shortcuts.js?v=6d8ea70';

const MIN_Q = 2, DEBOUNCE = 250, TOP = 5;
const GOTO_KEY = Object.fromEntries(Object.entries(GOTO).map(([k, id]) => [id, 'G ' + k.toUpperCase()]));
let cfg = { sellyHref: () => '#', isAdmin: () => false, canSee: () => true };
const RECENT_TOP = 5;   // „Ostatnio otwierane” w oknie szukania
let open = null;   // { close } — bieżące okno (paleta albo pomoc)

const hl = (text, q) => highlightParts(text, q).map(p => (p.hit ? el('mark', null, p.t) : p.t));
const kbd = t => el('kbd', null, t);
const closeAny = () => { if (open) open.close(); };

function overlay(cls, label, node) {
  const ov = el('div', { class: 'pal-overlay ' + cls, onmousedown: e => { if (e.target === ov) closeAny(); } }, node);
  node.setAttribute('role', 'dialog'); node.setAttribute('aria-modal', 'true'); node.setAttribute('aria-label', label);
  document.body.append(ov);
  return ov;
}

// ─── Paleta ─────────────────────────────────────────────────────────────────

const REC = {
  orders: { title: 'Zamówienia', type: 'order', run: q => api('orders:list', { q, pageSize: TOP }),
    row: r => ({ id: r.id, label: r.number || r.id, sub: [[r.firstName, r.lastName].filter(Boolean).join(' ') || r.company || '', r.total != null ? r.total + ' zł' : ''].filter(Boolean).join(' · ') }) },
  clients: { title: 'Klienci', type: 'client', run: q => api('clients:list', { q, pageSize: TOP }),
    row: r => ({ id: r.id, label: r.name || r.company || ('Klient ' + r.id), sub: [r.company && r.company !== r.name ? r.company : '', r.city].filter(Boolean).join(' · ') }) },
  products: { title: 'Produkty', type: 'product', run: q => api('products:list', { q, pageSize: TOP }),
    row: r => ({ id: r.id, label: r.name || ('Produkt ' + r.id), sub: [r.code, r.ean].filter(Boolean).join(' · ') }) },
};

function screenRows(q, limit) {
  const ok = i => (!i.admin || cfg.isAdmin()) && cfg.canSee(i.id);
  const vis = ITEMS.filter(ok);
  const sec = i => { const g = groupById(groupOf(i.id)); return g ? g.title : 'Menu główne'; };
  // bez zapytania: menu główne; z zapytaniem: nazwa, grupa, synonimy i nazwy z Selly
  const list = q ? matchScreens(vis, q, sec, limit, keywordsOf) : menuModel(ok).primary.slice(0, limit);
  return list.map(i => ({ type: 'screen', label: i.title, sub: sec(i) + (i.kind === 'soon' ? ' · wkrótce' : ''), icon: i.kind === 'selly' ? 'external' : 'sliders', ext: i.kind === 'selly',
    href: i.kind === 'selly' ? cfg.sellyHref(i.a) : '#/' + i.id, hint: GOTO_KEY[i.id] || '', tip: i.tip || (i.kind === 'soon' ? 'W planie w panelu OSA — na razie strona z linkiem do panelu Selly' : ''), _id: i.id }));
}

export function openPalette(initial) {
  closeAny();
  let seq = 0, timer = 0, active = 0, rows = [];
  const input = el('input', { type: 'text', class: 'pal-input', id: 'palInput', placeholder: 'Szukaj ekranów, zamówień, klientów, produktów…', autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'Szukaj w panelu', 'aria-controls': 'palList', title: 'Wpisz nazwę ekranu, numer zamówienia, nazwisko klienta albo nazwę produktu' });
  const list = el('div', { class: 'pal-list', id: 'palList', role: 'listbox' });
  const box = el('div', { class: 'pal' },
    el('div', { class: 'pal-top' }, icon('search'), input, el('span', { class: 'pal-esc', title: 'Esc zamyka okno' }, kbd('Esc'))),
    list,
    el('div', { class: 'pal-foot' }, el('span', null, kbd('↑↓'), ' nawigacja · ', kbd('Enter'), ' otwórz · ', kbd('Esc'), ' zamknij')));
  const ov = overlay('pal-search', 'Szukaj w panelu', box);

  function close() { clearTimeout(timer); seq++; ov.remove(); open = null; }
  open = { close };

  const rowEl = (r, idx) => el('a', { class: 'pal-row' + (idx === active ? ' on' : ''), role: 'option', 'aria-selected': String(idx === active), 'data-i': String(idx), href: r.href || '#', title: r.tip || (r.ext ? 'Otwiera panel Selly w nowej karcie' : null),
    target: r.ext ? '_blank' : null, rel: r.ext ? 'noopener' : null, onmousemove: () => { if (active !== idx) { active = idx; paintActive(); } },
    onclick: e => { e.preventDefault(); activate(r); } },
    icon(r.icon || 'box'), el('span', { class: 'pal-label' }, hl(r.label, r.q)), r.sub ? el('span', { class: 'pal-sub' }, hl(r.sub, r.q)) : null,
    r.ext ? el('span', { class: 'pal-ext', title: 'Tylko w panelu Selly — nowa karta', 'aria-hidden': 'true' }, '↗') : null,
    r.hint ? el('span', { class: 'pal-hint', title: 'Skrót klawiszowy przejścia do tego ekranu' }, r.hint.split(' ').map(kbd)) : null);

  function paintActive() {
    for (const a of list.querySelectorAll('.pal-row')) {
      const on = Number(a.dataset.i) === active;
      a.classList.toggle('on', on); a.setAttribute('aria-selected', String(on));
      if (on) a.scrollIntoView({ block: 'nearest' });
    }
  }

  /** groups: [{ title, rows, note? }] → lista; rows dostają indeksy do nawigacji strzałkami. */
  function paint(groups) {
    rows = []; const nodes = [];
    for (const g of groups) {
      if (g.rows && g.rows.length) nodes.push(el('div', { class: 'pal-group' }, g.title));
      for (const r of g.rows || []) { nodes.push(rowEl(r, rows.length)); rows.push(r); }
      if (g.note) nodes.push(el('div', { class: 'pal-note', 'data-note': g.noteKey || '' }, g.note));
      if (g.tips) nodes.push(g.tips);
    }
    if (!nodes.length) nodes.push(el('div', { class: 'pal-note' }, 'Brak wyników.'));
    active = Math.min(active, Math.max(0, rows.length - 1));
    list.replaceChildren(...nodes);
    paintActive();
  }

  const tips = () => el('div', { class: 'pal-tips' }, ...PREFIXES.map(p => el('button', { type: 'button', class: 'pal-tip tip', title: p.tip + '. Kliknij, aby wstawić prefiks.',
    onclick: () => { input.value = p.key + ': '; input.focus(); update(); } }, el('code', null, p.key + ':'), ' ' + p.title)));

  const recentRows = () => loadRecents().slice(0, RECENT_TOP).map(e => ({ type: e.t, label: e.label, sub: TYPES[e.t].name, icon: TYPES[e.t].icon, href: hashOf(e), recent: e, q: '' }));

  let recGroups = {};   // wyniki rekordów z ostatniego zapytania: scope → { rows, state }
  function render() {
    const { scope, q } = parseQuery(input.value);
    const groups = [];
    if (!q && !scope) {
      groups.push({ title: 'Ostatnio otwierane', rows: recentRows() });
      groups.push({ title: 'Wskazówki', rows: [], tips: el('div', null, el('div', { class: 'pal-group' }, 'Wskazówki'), tips(), el('div', { class: 'pal-note' }, 'Wpisz prefiks, aby szukać tylko w jednej grupie. Skrót ? pokazuje wszystkie skróty klawiszowe.')) });
      groups.push({ title: 'Menu główne', rows: screenRows('', 12).map(r => ({ ...r, q: '' })) });
    } else {
      if (!scope || scope === 'screens') groups.push({ title: 'Ekrany', rows: screenRows(q, 8).map(r => ({ ...r, q })) });
      for (const k of ['orders', 'clients', 'products']) {
        if (scope && scope !== k) continue;
        const st = recGroups[k];
        if (q.length < MIN_Q) { if (scope === k) groups.push({ title: REC[k].title, rows: [], note: 'Wpisz co najmniej ' + MIN_Q + ' znaki.' }); continue; }
        const g = { title: REC[k].title, rows: st && st.rows ? st.rows.map(r => ({ ...r, q })) : [] };
        if (!st || st.loading) g.note = 'Szukam: ' + REC[k].title.toLowerCase() + '…'; else if (st.err) g.note = REC[k].title + ': nie udało się wyszukać.';
        else if (!st.rows.length && scope === k) g.note = 'Brak wyników.';
        groups.push(g);
      }
    }
    paint(groups);
  }

  function fetchRecords() {
    clearTimeout(timer); const my = ++seq;
    const { scope, q } = parseQuery(input.value);
    recGroups = {};
    if (q.length < MIN_Q || scope === 'screens') { render(); return; }
    const kinds = ['orders', 'clients', 'products'].filter(k => !scope || scope === k);
    for (const k of kinds) recGroups[k] = { loading: true };
    render();
    timer = setTimeout(() => {
      for (const k of kinds) {
        Promise.resolve().then(() => REC[k].run(q)).then(d => {
          if (my !== seq) return;   // nieaktualny wynik (zapytanie zmieniło się albo okno zamknięto)
          const r = REC[k];
          recGroups[k] = { rows: ((d && d.rows) || []).slice(0, TOP).map(x => { const v = r.row(x); return { type: r.type, label: String(v.label), sub: v.sub, icon: TYPES[r.type].icon, href: hashOf({ t: r.type, id: v.id }), recent: { t: r.type, id: v.id, label: String(v.label) } }; }) };
          render();
        }).catch(() => { if (my !== seq) return; recGroups[k] = { err: true, rows: [] }; render(); });
      }
    }, DEBOUNCE);
  }

  function update() { active = 0; fetchRecords(); }

  function activate(r) {
    if (!r) return;
    close();
    if (r.ext) { window.open(r.href, '_blank', 'noopener'); return; }
    if (r.recent) noteVisit(r.recent);
    go(r.href.replace(/^#/, ''));
  }

  input.addEventListener('input', update);
  box.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (rows.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; paintActive(); } }
    else if (e.key === 'Enter') { e.preventDefault(); activate(rows[active]); }
    else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  });
  input.value = initial || '';
  update();
  input.focus();
}

// ─── Pomoc „?” ──────────────────────────────────────────────────────────────

export function openHelp() {
  closeAny();
  const scr = shortcuts.screen(), it = itemById(scr);
  const sect = (title, entries) => el('div', { class: 'hlp-sec' }, el('h3', null, title),
    el('dl', null, entries.map(e => [el('dt', null, String(e.label).split(' / ').map((p, i) => [i ? ' / ' : '', p.split(' ').map(kbd)])), el('dd', null, e.desc)])));
  const local = shortcuts.list(scr);
  const box = el('div', { class: 'pal hlp' },
    el('div', { class: 'pal-top' }, el('strong', null, 'Skróty klawiszowe'), el('span', { class: 'pal-esc' }, kbd('Esc'))),
    el('div', { class: 'hlp-body' },
      sect('Wszędzie', shortcuts.list('global')),
      local.length ? sect('Ten ekran' + (it ? ': ' + it.title : ''), local) : el('p', { class: 'muted small' }, 'Ten ekran nie ma własnych skrótów.'),
      el('p', { class: 'muted small' }, 'Skróty nie działają podczas pisania w polach (poza Ctrl+K i Esc) i nie zastępują skrótów przeglądarki.')));
  const ov = overlay('hlp-overlay', 'Skróty klawiszowe', box);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); open = null; };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  open = { close };
}

/** Rejestruje skróty globalne i podaje powłoce zależności (adres Selly, rola). */
export function initPalette(o) {
  cfg = { ...cfg, ...o };
  shortcuts.scope('global', [
    { keys: ['ctrl+k'], label: 'Ctrl K', desc: 'Szukaj w panelu (ekrany, zamówienia, klienci, produkty)', run: () => openPalette() },
    { keys: ['?'], label: '?', desc: 'Pokaż skróty klawiszowe', run: () => openHelp() },
    { keys: ['/'], label: '/', desc: 'Szukaj w panelu (na ekranach z listą: pole szukania listy)', run: () => openPalette() },
    ...Object.entries(GOTO).map(([k, id]) => ({ keys: ['g ' + k], label: 'G ' + k.toUpperCase(), desc: 'Przejdź do: ' + (itemById(id) || { title: id }).title, run: () => { go('/' + id); } })),
  ]);
}
export { openPalette as open };
