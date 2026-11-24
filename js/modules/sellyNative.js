// Wspólny ekran „natywny” dla sekcji Selly bez API (etap 2, docs/selly-embed.md): lista z filtrami → karta rekordu → bezpieczny zapis.
// Dane: rozszerzenie OSA pobiera strony Selly z sesją użytkownika i zwraca strukturę (core/sellyBridge.js); nic nie idzie do backendu OSA.
// Bez rozszerzenia (albo ze starą wersją) — ramka z etapu 1 / link do Selly (_placeholder.js).
import { el, loadingBox, tapOpen } from '../core/ui.js?v=094b3e3';
import { hasExtension } from '../core/extBridge.js?v=094b3e3';
import { hasNative, sellyCall } from '../core/sellyBridge.js?v=094b3e3';
import { createPlaceholder, sellyUrl } from './_placeholder.js?v=094b3e3';

const numeric = vals => vals.length > 0 && vals.every(v => v === '' || /^-?[\d\s.,]+(\s?(zł|PLN|szt\.?))?$/.test(v));
const num = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

/** cfg: { id, title, screen, a (trasa listy), recordRoute, noun, recordTitle(id), headerTips: {nagłówek: opis} } */
export function createNative(cfg) {
  const fallback = createPlaceholder({ id: cfg.id, title: cfg.title, sellyQuery: '?a=' + cfg.a, kind: 'selly' });
  let root = null, seq = 0, usingFallback = false;
  const S = { q: {}, page: 1, sort: null, dir: 'asc', data: null, rec: null };
  const sellyList = () => sellyUrl('', '?a=' + cfg.a);

  function mount(host) {
    if (!hasExtension() || !hasNative()) { usingFallback = true; return fallback.mount(host); }
    usingFallback = false; root = host; S.q = {}; S.page = 1; S.sort = null;
    showList();
  }
  function unmount() { seq++; if (usingFallback) fallback.unmount(); root = null; }

  const toolbar = (sub, extra) => el('div', { class: 'page-toolbar' }, el('div', { class: 'pt-title' }, el('h2', null, cfg.title), sub ? el('div', { class: 'sub' }, sub) : null),
    el('div', { class: 'pt-actions' }, extra,
      el('a', { href: sellyList(), target: '_blank', rel: 'noopener', class: 'btn-link', title: 'Otwiera ten sam ekran w panelu Selly, w nowej karcie' }, 'Otwórz w Selly ↗')));

  function errorBox(r, retry) {
    const login = r.code === 'login';
    return el('div', { class: 'card nat-err', id: 'natErr' }, el('p', null, el('strong', null, login ? 'Zaloguj się do Selly w zwykłej karcie' : 'Nie udało się pobrać danych z Selly')),
      el('p', { class: 'muted' }, login ? 'Rozszerzenie używa Twojej sesji Selly z tej przeglądarki. Zaloguj się w zwykłej karcie, wróć tutaj i kliknij „Odśwież”.' : (r.error || 'Nieznany błąd')),
      el('div', { class: 'nat-actions' },
        login ? el('a', { href: sellyUrl('', ''), target: '_blank', rel: 'noopener', class: 'btn-primary-link' }, 'Zaloguj się do Selly ↗') : null,
        el('button', { type: 'button', class: 'secondary', onclick: retry, title: 'Pobiera dane z Selly ponownie' }, 'Odśwież')));
  }

  // ─── Lista ──────────────────────────────────────────────────────────────
  async function showList() {
    const my = ++seq;
    root.replaceChildren(toolbar('Dane pobierane na żywo z Selly przez rozszerzenie OSA (tylko w tej przeglądarce)'), loadingBox('Pobieram listę z Selly…'));
    const query = { ...S.q }; if (S.page > 1) query.p = String(S.page);
    const r = await sellyCall({ op: 'read', screen: cfg.screen, view: 'list', query });
    if (my !== seq || !root) return;
    if (!r.ok) { root.replaceChildren(toolbar(''), errorBox(r, showList)); return; }
    S.data = r.data; paintList();
  }

  function filterBox(d) {
    const boxes = d.filters.filter(f => f.type === 'checkbox'), others = d.filters.filter(f => f.type !== 'checkbox' && f.type !== 'hidden');
    const read = () => {
      const q = {};
      for (const i of form.querySelectorAll('[data-fname]')) {
        const n = i.dataset.fname;
        if (i.type === 'checkbox') { if (i.checked) (q[n] = q[n] || []).push(i.value); } else if (i.value) q[n] = i.value;
      }
      return q;
    };
    const apply = ev => { if (ev) ev.preventDefault(); S.q = read(); S.page = 1; showList(); };
    const inputs = others.map(f => f.type === 'select'
      ? el('select', { 'data-fname': f.name, title: f.label || 'Filtr' }, f.options.map(o => el('option', { value: o.value, selected: o.value === f.value || null }, o.text)))
      : el('input', { type: f.type === 'date' ? 'date' : 'text', 'data-fname': f.name, value: f.value, placeholder: f.label || '', title: f.label || 'Filtr' }));
    const statuses = boxes.length ? el('details', { class: 'nat-opts', open: boxes.some(b => b.checked) || null },
      el('summary', { title: 'Zaznacz, które statusy mają być widoczne; bez zaznaczenia Selly pokazuje domyślny zestaw' }, 'Statusy'),
      el('div', { class: 'nat-checks' }, boxes.map(b => el('label', { class: 'nat-check' }, el('input', { type: 'checkbox', 'data-fname': b.name, value: b.value, checked: b.checked || null }), ' ' + (b.label || b.value))))) : null;
    const form = el('form', { class: 'nat-filters', id: 'natFilters', onsubmit: apply },
      el('div', { class: 'nat-frow' }, inputs, el('button', { type: 'submit', class: 'primary', title: 'Pobiera listę z Selly z wybranymi filtrami' }, 'Pokaż'),
        el('button', { type: 'button', class: 'secondary', title: 'Czyści filtry', onclick: () => { S.q = {}; S.page = 1; showList(); } }, 'Wyczyść')),
      statuses);
    return form;
  }

  function paintList() {
    const d = S.data;
    const rows = d.rows.map((r, i) => ({ ...r, i }));
    if (S.sort != null) {
      const col = S.sort, isNum = numeric(rows.map(r => (r.cells[col] || {}).text || ''));
      rows.sort((a, b) => {
        const x = (a.cells[col] || {}).text || '', y = (b.cells[col] || {}).text || '';
        if (!x && y) return 1; if (x && !y) return -1;
        const c = isNum ? num(x) - num(y) : x.localeCompare(y, 'pl');
        return S.dir === 'asc' ? c : -c;
      });
    }
    const th = (h, i) => {
      const act = S.sort === i;
      return el('th', { 'aria-sort': act ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
        el('button', { type: 'button', class: 'th-sort', title: (cfg.headerTips[h] || h) + ' — kliknij, aby posortować', onclick: () => {
          const isNum = numeric(d.rows.map(r => (r.cells[i] || {}).text || ''));
          if (S.sort === i) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = i; S.dir = isNum ? 'desc' : 'asc'; }
          paintList();
        } }, el('span', { class: cfg.headerTips[h] ? 'tip' : null }, h), act ? el('span', { class: 'sort-ind' }, S.dir === 'asc' ? ' ↑' : ' ↓') : null));
    };
    const open = r => { if (r.id) showRecord(r.id); };
    const table = rows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'natTable' },
      el('thead', null, el('tr', null, d.headers.map(th), el('th', { title: 'Otwiera kartę w panelu OSA' }, 'Karta'))),
      el('tbody', null, rows.map(r => el('tr', { class: r.id ? 'pick' : null, 'data-id': r.id || null, onclick: tapOpen(() => open(r)) },
        r.cells.map(c => el('td', null, c.href ? el('a', { href: c.href, target: '_blank', rel: 'noopener', title: 'Otwiera w Selly' }, c.text || '↗') : c.text)),
        el('td', null, r.id ? el('button', { type: 'button', class: 'secondary small', 'data-open': r.id, title: 'Otwiera kartę ' + cfg.noun + ' w panelu OSA', onclick: ev => { ev.stopPropagation(); open(r); } }, 'Otwórz') : '')))))) :
      el('div', { class: 'empty', id: 'natEmpty' }, el('p', { class: 'muted' }, 'Brak pozycji dla tych filtrów.'));
    const pager = d.pages > 1 ? el('div', { class: 'nat-pager' },
      el('button', { type: 'button', class: 'secondary', disabled: S.page <= 1 || null, title: 'Poprzednia strona', onclick: () => { S.page--; showList(); } }, '‹ Poprzednia'),
      el('span', { class: 'muted' }, 'Strona ' + S.page + ' z ' + d.pages),
      el('button', { type: 'button', class: 'secondary', disabled: S.page >= d.pages || null, title: 'Następna strona', onclick: () => { S.page++; showList(); } }, 'Następna ›')) : null;
    root.replaceChildren(
      toolbar(rows.length + ' ' + (rows.length === 1 ? 'pozycja' : 'pozycji') + ' na tej stronie', el('button', { type: 'button', class: 'secondary', id: 'natRefresh', title: 'Pobiera listę z Selly ponownie', onclick: showList }, 'Odśwież')),
      el('div', { class: 'card' }, filterBox(d)), el('div', { class: 'card nat-tablecard' }, table, pager));
  }

  // ─── Karta rekordu ──────────────────────────────────────────────────────
  async function showRecord(id) {
    const my = ++seq;
    root.replaceChildren(toolbar(''), loadingBox('Pobieram kartę z Selly…'));
    const r = await sellyCall({ op: 'read', screen: cfg.screen, view: 'record', id });
    if (my !== seq || !root) return;
    if (!r.ok) { root.replaceChildren(toolbar(''), el('button', { type: 'button', class: 'secondary', onclick: showList }, '← Wróć do listy'), errorBox(r, () => showRecord(id))); return; }
    S.rec = r.data; paintRecord(id);
  }

  function paintRecord(id, message) {
    const d = S.rec, orig = Object.fromEntries(d.fields.map(f => [f.name, f.value]));
    const ctl = f => {
      const common = { 'data-field': f.name, id: 'natF_' + f.name, title: f.label || f.name };
      if (f.type === 'select') return el('select', common, f.options.map(o => el('option', { value: o.value, selected: o.value === f.value || null }, o.text)));
      if (f.type === 'textarea') return el('textarea', { ...common, rows: 3 }, f.value);
      return el('input', { ...common, type: 'text', value: f.value });
    };
    const edit = d.fields.filter(f => f.editable);
    const info = d.fields.filter(f => !f.editable && f.value !== '' && f.type !== 'checkbox' && f.type !== 'radio');
    const shown = f => f.type === 'select' ? ((f.options.find(o => o.selected) || {}).text || f.value) : f.value;
    const tip0 = 'Najpierw zmień któreś z pól — przed zapisem pokażemy dokładnie, co się zmieni';
    const save = el('button', { type: 'button', class: 'primary', id: 'natSave', disabled: true, title: tip0 }, 'Zapisz w Selly…');
    const collect = () => {
      const ch = {};
      for (const i of root.querySelectorAll('[data-field]')) if (i.value !== orig[i.dataset.field]) ch[i.dataset.field] = i.value;
      return ch;
    };
    const sync = () => { const n = Object.keys(collect()).length; save.disabled = !n; save.title = n ? 'Pokaże podsumowanie zmian do potwierdzenia, potem zapisze w Selly' : tip0; };
    save.addEventListener('click', () => confirmSave(id, collect(), orig));
    root.replaceChildren(
      toolbar(cfg.recordTitle(id)),
      message || null,
      el('p', null, el('button', { type: 'button', class: 'secondary', id: 'natBack', onclick: showList, title: 'Wraca do listy' }, '← Wróć do listy'),
        ' ', el('a', { href: sellyUrl('', '?a=' + cfg.recordRoute + '&id=' + encodeURIComponent(id)), target: '_blank', rel: 'noopener', class: 'btn-link', title: 'Pełna karta w Selly (wszystkie pola, załączniki, wysyłka e-maila)' }, 'Pełna karta w Selly ↗')),
      d.canSave ? null : el('div', { class: 'card nat-err', id: 'natNoSave' }, el('p', null, 'Formularz w Selly wygląda inaczej niż oczekiwano — edycja wyłączona. Użyj pełnej karty w Selly.')),
      info.length ? el('div', { class: 'card' }, el('h3', null, 'Dane'), el('dl', { class: 'ord-dl', id: 'natInfo' }, info.flatMap(f => [el('dt', null, f.label || f.name), el('dd', null, shown(f))]))) : null,
      edit.length ? el('div', { class: 'card', id: 'natEdit', oninput: sync, onchange: sync }, el('h3', null, 'Edycja'),
        el('p', { class: 'muted' }, 'Zmieniasz tylko wybrane pola. Wysyłka e-maila i załączniki z tego ekranu są wyłączone.'),
        el('div', { class: 'nat-form' }, edit.map(f => el('label', { class: 'nat-field' }, el('span', { class: 'nat-lbl' }, f.label || f.name), ctl(f)))),
        el('div', { class: 'nat-actions' }, save)) : null,
      d.tables.map((t, i) => t.rows.length ? el('div', { class: 'card' }, el('h3', null, i === 0 && d.tables.length > 1 ? 'Pozycje' : 'Historia zdarzeń'),
        el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, t.headers.map(h => el('th', { title: h }, h)))),
          el('tbody', null, t.rows.map(r => el('tr', null, r.map(c => el('td', null, c)))))))) : null));
  }

  function modal(title, body, okLabel, onOk) {
    const prev = document.activeElement;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    const cancel = el('button', { type: 'button', class: 'secondary', id: 'natConfirmCancel', onclick: close }, 'Anuluj');
    const ok = el('button', { type: 'button', class: 'primary', id: 'natConfirmOk', onclick: () => { ok.disabled = true; onOk(close); } }, okLabel);
    const wrap = el('div', { class: 'nat-modal', id: 'natConfirm' }, el('div', { class: 'nat-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, el('h3', null, title), body, el('div', { class: 'nat-actions nat-dlg-actions' }, cancel, ok)));
    document.addEventListener('keydown', onKey, true); document.body.append(wrap); cancel.focus();
    return close;
  }

  async function confirmSave(id, changes, orig) {
    const expect = Object.fromEntries(Object.keys(changes).map(k => [k, orig[k]]));
    const pre = await sellyCall({ op: 'save', screen: cfg.screen, id, changes, expect, dryRun: true });
    if (!pre.ok) { paintRecord(id, el('div', { class: 'card nat-err', id: 'natMsg' }, pre.error || 'Nie udało się przygotować zapisu')); return; }
    if (!pre.data.diff.length) { paintRecord(id, el('div', { class: 'card', id: 'natMsg' }, 'Bez zmian — wartości są już takie w Selly.')); return; }
    const body = el('div', null, el('p', null, 'Do Selly zostanie zapisane:'),
      el('table', { id: 'natDiff' }, el('thead', null, el('tr', null, el('th', null, 'Pole'), el('th', null, 'Było'), el('th', null, 'Będzie'))),
        el('tbody', null, pre.data.diff.map(x => el('tr', null, el('td', null, x.label), el('td', { class: 'nat-before' }, x.beforeText || '—'), el('td', null, el('strong', null, x.afterText || '—')))))),
      pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null);
    modal('Zapisać zmiany w Selly?', body, 'Zapisz w Selly', async close => {
      const r = await sellyCall({ op: 'save', screen: cfg.screen, id, changes, expect });
      close();
      if (!r.ok) { paintRecord(id, el('div', { class: 'card nat-err', id: 'natMsg' }, (r.code === 'conflict' ? '' : 'Zapis nie powiódł się: ') + (r.error || 'błąd'))); return; }
      const v = r.data.verified;
      await showRecord(id);
      const m = el('div', { class: 'card ' + (v ? 'nat-ok' : 'nat-err'), id: 'natMsg' }, v ? 'Zapisano w Selly i sprawdzono: wartości zgadzają się.' : 'Selly przyjęło zapis, ale nie potwierdziło wszystkich pól (' + r.data.mismatches.join(', ') + '). Sprawdź kartę w Selly.');
      if (root) root.querySelector('.page-toolbar').after(m);
    });
  }

  return { id: cfg.id, title: cfg.title, routes: [], mount, unmount, native: true };
}
