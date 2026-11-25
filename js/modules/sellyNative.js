// Wspólny ekran „natywny” dla sekcji Selly bez API (docs/selly-embed.md): lista z filtrami → karta rekordu → bezpieczny zapis / dodawanie.
// Dane: serwer główny panelu (Worker) otwiera strony Selly SESJĄ ZALOGOWANEGO UŻYTKOWNIKA (jego uprawnienia i jego wpis w historii Selly),
// czyta je i zwraca strukturę (sekrety zamaskowane po stronie serwera); zapis tylko z allowlisty pól, zawsze przez podgląd zmian (dryRun)
// i potwierdzenie (docs/selly-embed.md, docs/auth.md). „Tylko do podglądu” = flaga `readOnly` z odpowiedzi serwera (jedna, z silnika).
// Strony ustawień (jedna strona-formularz) obsługuje modules/sellyNativeSettings.js.
import { el, loadingBox, tapOpen } from '../core/ui.js?v=70a8836';
import { api } from '../core/client.js?v=70a8836';
import { sellyUrl } from './_placeholder.js?v=70a8836';
import { sanitizeHtml } from '../lib/htmlSanitize.js?v=70a8836';
import { addLeaveGuard } from '../core/router.js?v=70a8836';
import { nl, stripReport, reportText, lineDiff, hunks, contentStats } from './tresciEdytor.js?v=70a8836';

/** Żądanie do Workera: native:read / native:save / native:create → { ok, data } albo { ok:false, code, error } (nigdy nie rzuca). */
export function sellyCall(req) {
  return api('native:' + req.op, req).catch(e => ({ ok: false, code: e.code === 403 ? 'forbidden' : e.code === 501 ? 'unavailable' : 'backend', error: e.code === 501
    ? 'Ten ekran działa tylko przez serwer główny panelu, który chwilowo nie odpowiada — spróbuj za kilka minut albo otwórz go w Selly.' : e.message }));
}

/**
 * Podgląd treści HTML z Selly (L3): oczyszczony (sanitizeHtml) i dodatkowo — w obojętnym <template> (obrazki się nie ładują) — linki tylko
 * w nowej karcie (rel noopener noreferrer), obrazki zdalne zamienione na link „obraz ↗” (bez pobierania z obcych serwerów), bez atrybutów
 * stylu pozycjonowania. CSS .nat-html: position:relative, overflow:hidden, contain:paint; potomkowie position:static — treść nie nakryje panelu.
 */
export function safePreview(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitizeHtml(html) || '';
  const frag = tpl.content;
  for (const a of frag.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
  for (const img of frag.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    const link = document.createElement('a');
    link.textContent = '[obraz' + (img.getAttribute('alt') ? ': ' + img.getAttribute('alt') : '') + '] ↗';
    if (/^https?:\/\//i.test(src)) { link.href = src; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = 'Obraz z treści — otwiera się w nowej karcie (podgląd go nie pobiera)'; }
    img.replaceWith(link);
  }
  for (const n of frag.querySelectorAll('[style]')) n.removeAttribute('style');
  return frag;
}

const numeric = vals => vals.length > 0 && vals.every(v => v === '' || /^-?[\d\s.,]+(\s?(zł|PLN|szt\.?))?$/.test(v));
const num = s => parseFloat(String(s).replace(/\s/g, '').replace(',', '.')) || 0;

/**
 * cfg: { id, title, screen, a (trasa listy), recordRoute (brak/null = tylko lista), idParam?, noun, recordTitle(id), headerTips: {nagłówek: opis},
 *  opcjonalnie: labels {pole: etykieta}, fieldTips {pole: opis}, cellLink(href) → { href, tip } (link do panelu OSA zamiast Selly),
 *  create: { label, title?, tip } (przycisk „dodaj”: pusty formularz z Selly → podgląd → potwierdzenie → native:create),
 *  quick(rec) → [{ key, label, tip, changes }] (szybkie akcje na karcie — przez to samo potwierdzenie zmian),
 *  advanced: [pole | RegExp] (pola schowane w zwijanym panelu „Ustawienia zaawansowane”), advancedTitle, labelOf(f) → etykieta (pola o zmiennych nazwach),
 *  contentTitle (nagłówek edytora treści HTML — pola `content` z odpowiedzi serwera; edytor: tresciEdytor.js) }
 */
export function createNative(cfg) {
  let root = null, seq = 0, dirty = null;   // dirty() → czy karta z edytorem treści ma niezapisane zmiany (strażnik wyjścia)
  const S = { q: {}, page: 1, sort: null, dir: 'asc', data: null, rec: null };
  const sellyList = () => sellyUrl('', '?a=' + cfg.a);
  const sellyRecord = id => sellyUrl('', '?a=' + cfg.recordRoute + (id == null ? '' : '&' + (cfg.idParam || 'id') + '=' + encodeURIComponent(id)));
  const lab = f => (cfg.labels && cfg.labels[f.name]) || (cfg.labelOf && cfg.labelOf(f)) || f.label || f.name;
  const ftip = f => (cfg.fieldTips && cfg.fieldTips[f.name]) || lab(f);
  const headerTips = cfg.headerTips || {};
  const isAdv = n => (cfg.advanced || []).some(e => e instanceof RegExp ? e.test(n) : e === n);
  const LEAVE = 'Masz niezapisane zmiany (' + cfg.title + '). Opuścić bez zapisywania?';
  const isDirty = () => !!(root && dirty && dirty());
  addLeaveGuard(() => (isDirty() ? LEAVE : null));
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', ev => { if (isDirty()) { ev.preventDefault(); ev.returnValue = ''; } });
  const mayLeave = () => !isDirty() || confirm(LEAVE);
  const backToList = () => { if (mayLeave()) { dirty = null; showList(); } };
  /** Komunikat nad kartą bez przerysowania formularza (wpisana treść zostaje w edytorze). */
  const showMsg = node => { if (!root) return; const old = root.querySelector('#natMsg'); if (old) old.remove(); const t = root.querySelector('.page-toolbar'); if (t) t.after(node); else root.prepend(node); };

  function mount(host) {
    root = host; S.q = {}; S.page = 1; S.sort = null; S.data = null; dirty = null;
    showList();
  }
  function unmount() { seq++; root = null; dirty = null; }

  const RO_TIP = 'Ten ekran w panelu OSA służy tylko do podglądu — niczego tu nie zmienisz. Zmiany wprowadzisz w Selly.';
  const isRO = () => !!(S.data && S.data.readOnly);
  const toolbar = (sub, extra) => el('div', { class: 'page-toolbar' }, el('div', { class: 'pt-title' }, el('h2', null, cfg.title, isRO() ? el('span', { class: 'pill tip nat-ro', id: 'natRo', title: RO_TIP }, 'tylko podgląd') : null), sub ? el('div', { class: 'sub' }, sub) : null),
    el('div', { class: 'pt-actions' }, extra,
      el('a', { href: sellyList(), target: '_blank', rel: 'noopener', class: 'btn-link', title: isRO() ? RO_TIP : 'Otwiera ten sam ekran w panelu Selly, w nowej karcie' }, isRO() ? 'Zmień w Selly ↗' : 'Otwórz w Selly ↗')));

  function errorBox(r, retry) {
    const title = r.code === 'login' ? 'Selly nie otworzyło tego ekranu' : r.code === 'forbidden' ? 'Brak dostępu' : 'Nie udało się pobrać danych z Selly';
    return el('div', { class: 'card nat-err', id: 'natErr' }, el('p', null, el('strong', null, title)),
      el('p', { class: 'muted' }, r.error || 'Nieznany błąd'),
      el('div', { class: 'nat-actions' },
        el('a', { href: sellyList(), target: '_blank', rel: 'noopener', class: 'btn-link', title: 'Otwiera ten sam ekran w panelu Selly, w nowej karcie' }, 'Otwórz w Selly ↗'),
        el('button', { type: 'button', class: 'secondary', onclick: retry, title: 'Pobiera dane z Selly ponownie' }, 'Odśwież')));
  }

  // ─── Lista ──────────────────────────────────────────────────────────────
  async function showList() {
    const my = ++seq; dirty = null;
    root.replaceChildren(toolbar('Dane na żywo z Selly — z Twoimi uprawnieniami w Selly'), loadingBox('Pobieram listę z Selly…'));
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
        el('button', { type: 'button', class: 'th-sort', title: (headerTips[h] || h) + ' — kliknij, aby posortować', onclick: () => {
          const isNum = numeric(d.rows.map(r => (r.cells[i] || {}).text || ''));
          if (S.sort === i) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = i; S.dir = isNum ? 'desc' : 'asc'; }
          paintList();
        } }, el('span', { class: headerTips[h] ? 'tip' : null }, h), act ? el('span', { class: 'sort-ind' }, S.dir === 'asc' ? ' ↑' : ' ↓') : null));
    };
    const cards = !!cfg.recordRoute && (!d.readOnly || rows.some(r => r.id));
    const open = r => { if (cfg.recordRoute && r.id) showRecord(r.id); };
    const anchor = (href, text) => {
      const l = cfg.cellLink && cfg.cellLink(href);
      return l ? el('a', { href: l.href, title: l.tip }, text || '→') : el('a', { href, target: '_blank', rel: 'noopener', title: 'Otwiera w Selly' }, text || '↗');
    };
    const cellBody = c => c.links ? [el('span', null, c.text), el('div', { class: 'nat-links' }, c.links.map(l => [anchor(l.href, l.text), ' ']))] : c.href ? anchor(c.href, c.text) : c.text;
    const table = rows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'natTable' },
      el('thead', null, el('tr', null, d.headers.map(th), cards ? el('th', { title: 'Otwiera kartę w panelu OSA' }, 'Karta') : null)),
      el('tbody', null, rows.map(r => el('tr', { class: cards && r.id ? 'pick' : null, 'data-id': r.id || null, onclick: tapOpen(() => open(r)) },
        r.cells.map(c => el('td', null, cellBody(c))),
        cards ? el('td', null, r.id ? el('button', { type: 'button', class: 'secondary small', 'data-open': r.id, title: 'Otwiera kartę ' + cfg.noun + ' w panelu OSA', onclick: ev => { ev.stopPropagation(); open(r); } }, 'Otwórz') : '') : null))))) :
      el('div', { class: 'empty', id: 'natEmpty' }, el('p', { class: 'muted' }, d.readOnly && !(d.extra || []).length && !(d.settings || []).length
        ? 'Selly nie pokazuje tu listy do odczytu (strona może być zbudowana inaczej albo nic tu jeszcze nie ma). Otwórz ją w Selly.' : 'Brak pozycji dla tych filtrów.'));
    const pager = d.pages > 1 ? el('div', { class: 'nat-pager' },
      el('button', { type: 'button', class: 'secondary', disabled: S.page <= 1 || null, title: 'Poprzednia strona', onclick: () => { S.page--; showList(); } }, '‹ Poprzednia'),
      el('span', { class: 'muted' }, 'Strona ' + S.page + ' z ' + d.pages),
      el('button', { type: 'button', class: 'secondary', disabled: S.page >= d.pages || null, title: 'Następna strona', onclick: () => { S.page++; showList(); } }, 'Następna ›')) : null;
    const add = cfg.create && d.canCreate ? el('button', { type: 'button', class: 'primary', id: 'natNew', title: cfg.create.tip || 'Dodaje nową pozycję w Selly (przed wysłaniem pokażemy podsumowanie)', onclick: showCreate }, cfg.create.label || 'Dodaj') : null;
    root.replaceChildren(
      toolbar(rows.length + ' ' + (rows.length === 1 ? 'pozycja' : 'pozycji') + ' na tej stronie', [add, el('button', { type: 'button', class: 'secondary', id: 'natRefresh', title: 'Pobiera listę z Selly ponownie', onclick: showList }, 'Odśwież')]),
      d.filters.length || !d.readOnly ? el('div', { class: 'card' }, filterBox(d)) : null, el('div', { class: 'card nat-tablecard' }, table, pager),
      (d.settings || []).length ? el('div', { class: 'card', id: 'natSettings' }, el('h3', null, 'Ustawienia (tylko podgląd)'), el('dl', { class: 'ord-dl' }, d.settings.flatMap(f => [el('dt', null, f.label || f.name), el('dd', null, f.value)]))) : null,
      (d.extra || []).map(t => el('div', { class: 'card nat-extra' }, el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, t.headers.map(h => el('th', { title: h }, h)))), el('tbody', null, t.rows.map(r => el('tr', null, r.map(c => el('td', null, c))))))))));
  }

  // ─── Karta rekordu / nowy rekord (ten sam formularz) ────────────────────
  async function showRecord(id) {
    const my = ++seq; dirty = null;
    root.replaceChildren(toolbar(''), loadingBox('Pobieram kartę z Selly…'));
    const r = await sellyCall({ op: 'read', screen: cfg.screen, view: 'record', id });
    if (my !== seq || !root) return;
    if (!r.ok) { root.replaceChildren(toolbar(''), el('button', { type: 'button', class: 'secondary', onclick: showList }, '← Wróć do listy'), errorBox(r, () => showRecord(id))); return; }
    S.rec = r.data; paintRecord(id);
  }
  async function showCreate() {
    const my = ++seq; dirty = null;
    root.replaceChildren(toolbar(''), loadingBox('Pobieram formularz dodawania z Selly…'));
    const r = await sellyCall({ op: 'read', screen: cfg.screen, view: 'new' });
    if (my !== seq || !root) return;
    if (!r.ok) { root.replaceChildren(toolbar(''), el('button', { type: 'button', class: 'secondary', onclick: showList }, '← Wróć do listy'), errorBox(r, showCreate)); return; }
    S.rec = r.data; paintRecord(null);
  }

  const ctl = (f, isNew) => {
    const common = { 'data-field': f.name, id: 'natF_' + f.name, title: ftip(f), required: isNew && (S.rec.required || []).includes(f.name) || null };
    if (f.type === 'checkbox') return el('input', { ...common, type: 'checkbox', 'data-on': f.onValue || 'on', checked: f.value !== '' || null });
    if (f.type === 'select' || f.type === 'radio') return el('select', common, (f.options || []).map(o => el('option', { value: o.value, selected: o.value === f.value || null }, o.text)));
    if (f.type === 'textarea') return el('textarea', { ...common, rows: 3 }, f.value);
    return el('input', { ...common, type: f.type === 'date' || f.type === 'time' ? f.type : 'text', value: f.value });
  };

  // ─── Edytor treści HTML (pola `content`): źródło + podgląd oczyszczony na żywo; do Selly idzie DOKŁADNIE wpisany tekst ───
  const PREVIEW_TIP = 'Podgląd w panelu jest oczyszczony (bez skryptów, ramek, zdarzeń i stylów; obrazy jako linki). Sklep dostanie treść dokładnie taką, jak w polu obok.';
  function stripNotice(v, idSuffix) {
    const r = stripReport(v);
    if (!r.total) return null;
    return el('div', { class: 'nat-strip' + (r.active.length ? ' nat-strip-active' : ''), id: 'natStrip' + (idSuffix || ''), role: 'status' },
      r.active.length ? el('p', null, el('strong', null, 'Podgląd nie pokazuje elementów, które w sklepie zadziałają: '), reportText(r.active),
        '. Selly zapisze je dokładnie tak, jak są wpisane — upewnij się, że to zamierzone.') : null,
      r.other.length ? el('p', { class: 'muted' }, 'Podgląd pomija też: ' + reportText(r.other) + ' — w sklepie zostaną bez zmian.') : null);
  }
  function contentEditor(f, d, isNew, onChange) {
    const max = d.contentMax || 0;
    const ta = el('textarea', { 'data-field': f.name, id: 'natF_' + f.name, class: 'nat-code', rows: 18, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
      'aria-label': lab(f) + ' — kod HTML', title: 'Kod HTML treści — trafi do Selly dokładnie w tej postaci (nic nie jest poprawiane ani usuwane)' });
    ta.value = f.value;
    const stats = el('span', { class: 'muted nat-cstats', id: 'natStats_' + f.name, title: max ? 'Limit panelu: ' + max.toLocaleString('pl-PL') + ' znaków (dłuższą treść zmienisz w Selly)' : null });
    const prev = el('div', { class: 'nat-html nat-cprev', 'data-preview': f.name, title: PREVIEW_TIP });
    const notice = el('div', { 'data-strip': f.name });
    let timer = 0;
    const refresh = () => {
      timer = 0;
      prev.replaceChildren(safePreview(ta.value));
      notice.replaceChildren(stripNotice(ta.value, '_' + f.name) || '');
      const st = contentStats(ta.value, max);
      stats.textContent = st.chars.toLocaleString('pl-PL') + (max ? ' / ' + max.toLocaleString('pl-PL') : '') + ' znaków · ' + st.lines + ' wierszy' + (st.over ? ' — za długa' : '');
      stats.classList.toggle('nat-over', st.over);
    };
    ta.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(refresh, 200); });
    refresh();
    const reset = el('button', { type: 'button', class: 'secondary small', id: 'natReset_' + f.name, title: 'Wstawia z powrotem treść z chwili otwarcia karty (Twoje zmiany w treści znikną)', onclick: () => {
      if (nl(ta.value) !== nl(f.value) && !confirm('Przywrócić treść z Selly? Twoje zmiany w treści znikną.')) return;
      ta.value = f.value; refresh(); onChange();
    } }, isNew ? 'Wyczyść' : 'Przywróć treść z Selly');
    return el('details', { class: 'nat-opts nat-content', id: 'natContent_' + f.name, open: isNew || null },
      el('summary', { title: 'Rozwiń, aby edytować kod HTML i zobaczyć podgląd' }, (cfg.contentTitle || lab(f)) + ' — edytor HTML'),
      el('p', { class: 'muted' }, 'Edytujesz kod HTML. Po lewej kod, po prawej podgląd (bez skryptów i stylów). Do Selly trafi dokładnie to, co wpiszesz.'),
      el('div', { class: 'nat-cgrid' },
        el('label', { class: 'nat-field' }, el('span', { class: 'nat-lbl' }, 'Kod HTML'), ta),
        el('div', { class: 'nat-field' }, el('span', { class: 'nat-lbl tip', title: PREVIEW_TIP }, 'Podgląd'), prev)),
      el('div', { class: 'nat-actions' }, stats, reset), notice);
  }
  /** Karta treści tylko do podglądu (bez edycji): oczyszczony podgląd + powód (np. treść wygląda na sekret, encje, formularz skryptowy). */
  function contentReadOnly(f, id, reason) {
    const box = f.type === 'secret' || !f.value ? null : el('div', { class: 'nat-html', 'data-html': f.name, title: 'Podgląd treści z Selly (oczyszczony z niebezpiecznych elementów); treść edytujesz w Selly' });
    if (box) box.append(safePreview(f.value));
    return el('div', { class: 'card', 'data-content-ro': f.name }, el('h3', null, lab(f) + ' (tylko do odczytu)'),
      reason ? el('p', { class: 'muted', id: 'natWhy_' + f.name }, reason) : null, box,
      id == null ? null : el('p', { class: 'muted' }, el('a', { href: sellyRecord(id), target: '_blank', rel: 'noopener', class: 'btn-secondary', title: 'Treść HTML zmienisz w Selly' }, 'Edytuj w Selly ↗')));
  }

  function paintRecord(id, message) {
    const d = S.rec, isNew = id == null, orig = Object.fromEntries(d.fields.map(f => [f.name, f.value]));
    const cNames = d.content || [], isC = f => cNames.includes(f.name) || !!f.content;
    const edit = d.fields.filter(f => f.editable && !isC(f)), cEdit = d.canSave ? d.fields.filter(f => f.editable && isC(f)) : [];
    const basic = edit.filter(f => !isAdv(f.name)), adv = edit.filter(f => isAdv(f.name));
    const htmlNames = d.html || [];
    const info = isNew ? [] : d.fields.filter(f => !f.editable && !isC(f) && f.value !== '' && !htmlNames.includes(f.name) && (d.readOnly || f.type === 'secret' || (f.type !== 'checkbox' && f.type !== 'radio')));
    const htmlCards = isNew ? [] : d.fields.filter(f => htmlNames.includes(f.name) && f.value).map(f => {
      const box = el('div', { class: 'nat-html', 'data-html': f.name, title: 'Podgląd treści z Selly (oczyszczony z niebezpiecznych elementów); treść edytujesz w Selly' });
      box.append(safePreview(f.value));
      return el('div', { class: 'card' }, el('h3', null, lab(f) + ' (tylko do odczytu)'), box,
        el('p', { class: 'muted' }, el('a', { href: sellyRecord(id), target: '_blank', rel: 'noopener', class: 'btn-link', title: 'Treść HTML edytujesz w Selly — panel nie zmienia jej, żeby nic nie zepsuć' }, 'Edytuj w Selly ↗')));
    });
    const contentRO = d.fields.filter(f => isC(f) && !cEdit.includes(f) && (f.value || f.reason)).map(f => contentReadOnly(f, id, f.reason || (d.canSave ? '' : 'Edycja wyłączona — formularz w Selly wygląda inaczej niż oczekiwano.')));
    const shown = f => f.type === 'select' || f.type === 'radio' ? (((f.options || []).find(o => o.selected) || {}).text || f.value) : f.value;
    const tip0 = 'Najpierw ' + (isNew ? 'wypełnij' : 'zmień') + ' któreś z pól — przed ' + (isNew ? 'wysłaniem' : 'zapisem') + ' pokażemy dokładnie, co trafi do Selly';
    const save = el('button', { type: 'button', class: 'primary', id: 'natSave', disabled: true, title: tip0 }, isNew ? 'Dodaj w Selly…' : 'Zapisz w Selly…');
    const quick = !isNew && cfg.quick ? cfg.quick(d) : [];
    const collect = () => {
      const ch = {};
      for (const i of root.querySelectorAll('#natEdit [data-field]')) {
        const n = i.dataset.field, v = i.type === 'checkbox' ? (i.checked ? i.dataset.on : '') : i.value;
        if (cNames.includes(n) ? nl(v) !== nl(orig[n]) : v !== orig[n]) ch[n] = v;
      }
      return ch;
    };
    const over = () => cEdit.some(f => { const i = root.querySelector('#natF_' + CSS.escape(f.name)); return i && contentStats(i.value, d.contentMax).over; });
    const sync = () => {
      const n = Object.keys(collect()).length, tooLong = over();
      save.disabled = !n || tooLong;
      save.title = tooLong ? 'Treść przekracza limit panelu (' + (d.contentMax || 0).toLocaleString('pl-PL') + ' znaków) — skróć ją albo zmień w Selly' : n ? 'Pokaże podsumowanie do potwierdzenia, potem wyśle do Selly' : tip0;
    };
    dirty = cEdit.length ? () => !!root && !!root.querySelector('#natEdit') && Object.keys(collect()).length > 0 : null;
    save.addEventListener('click', () => isNew ? confirmCreate(collect()) : confirmSave(id, collect(), orig));
    const fieldEl = f => el('label', { class: 'nat-field' + (f.type === 'checkbox' ? ' nat-check' : '') },
      el('span', { class: 'nat-lbl' + (cfg.fieldTips && cfg.fieldTips[f.name] ? ' tip' : ''), title: cfg.fieldTips && cfg.fieldTips[f.name] ? cfg.fieldTips[f.name] : null }, lab(f) + (isNew && (d.required || []).includes(f.name) ? ' *' : '')), ctl(f, isNew));
    const editable = (edit.length || cEdit.length) && d.canSave;
    root.replaceChildren(
      toolbar(isNew ? ((cfg.create && cfg.create.title) || 'Nowa pozycja') : cfg.recordTitle(id)),
      message || null,
      el('p', null, el('button', { type: 'button', class: 'secondary', id: 'natBack', onclick: backToList, title: 'Wraca do listy' }, '← Wróć do listy'),
        isNew || !cfg.recordRoute ? null : [' ', el('a', { href: sellyRecord(id), target: '_blank', rel: 'noopener', class: 'btn-link', title: 'Pełna karta w Selly (wszystkie pola, załączniki, wysyłka e-maila)' }, 'Pełna karta w Selly ↗')]),
      d.canSave || d.readOnly ? null : el('div', { class: 'card nat-err', id: 'natNoSave' }, el('p', null, 'Formularz w Selly wygląda inaczej niż oczekiwano — ' + (isNew ? 'dodawanie' : 'edycja') + ' wyłączona. Użyj Selly.')),
      info.length ? el('div', { class: 'card' }, el('h3', null, 'Dane'), el('dl', { class: 'ord-dl', id: 'natInfo' }, info.flatMap(f => [el('dt', null, lab(f)), el('dd', { class: f.type === 'secret' ? 'tip' : null, title: f.type === 'secret' ? 'Wartość poufna — ukryta przez serwer panelu; zobaczysz ją tylko w Selly' : null }, shown(f))]))) : null,
      ...htmlCards,
      editable ? el('div', { class: 'card', id: 'natEdit', oninput: sync, onchange: sync }, el('h3', null, isNew ? 'Nowa pozycja' : 'Edycja'),
        el('p', { class: 'muted' }, isNew ? 'Wypełnij pola (z gwiazdką — wymagane). Przed wysłaniem pokażemy podsumowanie.' : 'Zmieniasz tylko wybrane pola. Wysyłka e-maila i załączniki z tego ekranu są wyłączone.'),
        basic.length ? el('div', { class: 'nat-form' }, basic.map(fieldEl)) : null,
        adv.length ? el('details', { class: 'nat-opts', id: 'natAdv' }, el('summary', { title: 'Pola rzadziej zmieniane — rozwiń, aby je zobaczyć i edytować' }, cfg.advancedTitle || 'Ustawienia zaawansowane'),
          el('div', { class: 'nat-form' }, adv.map(fieldEl))) : null,
        cEdit.map(f => contentEditor(f, d, isNew, sync)),
        el('div', { class: 'nat-actions' }, save, quick.map(q => el('button', { type: 'button', class: 'secondary', 'data-quick': q.key || null, title: q.tip, onclick: () => confirmSave(id, q.changes, orig) }, q.label)))) : null,
      ...contentRO,
      (d.tables || []).map((t, i) => t.rows.length ? el('div', { class: 'card' }, el('h3', null, i === 0 && d.tables.length > 1 ? 'Pozycje' : 'Historia zdarzeń'),
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
  const diffTable = (diff, head) => el('table', { id: 'natDiff' }, el('thead', null, el('tr', null, el('th', null, 'Pole'), head.map(h => el('th', null, h)))),
    el('tbody', null, diff.map(x => el('tr', null, el('td', null, (cfg.labels && cfg.labels[x.name]) || x.label),
      head.length > 1 ? el('td', { class: 'nat-before' }, x.beforeText || '—') : null, el('td', null, el('strong', null, x.afterText || '—'))))));
  /** Zmiany treści HTML w oknie potwierdzenia: różnica wierszy (zwinięta) + ostrzeżenie o elementach aktywnych. Liczone z wpisanego tekstu w przeglądarce. */
  function contentDiffs(changes, before) {
    const names = Object.keys(changes).filter(n => (S.rec.content || []).includes(n));
    return names.map(n => {
      const ld = lineDiff(before ? before[n] : '', changes[n]), h = hunks(ld.ops);
      const f = S.rec.fields.find(x => x.name === n) || { name: n };
      const rows = h.items.map(o => o.gap ? el('div', { class: 'nat-ld-gap' }, '… ' + o.gap + ' niezmienionych wierszy …')
        : el('div', { class: 'nat-ld nat-ld-' + (o.t === '+' ? 'add' : o.t === '-' ? 'del' : 'eq') }, el('span', { class: 'nat-ld-sign', 'aria-hidden': 'true' }, o.t), o.s || ' '));
      return el('div', { 'data-cdiff': n },
        before ? el('details', { class: 'nat-opts', id: 'natLineDiff_' + n }, el('summary', { title: 'Pokazuje dodane (+) i usunięte (−) wiersze kodu HTML' }, lab(f) + ': zmienione wiersze (+' + ld.added + ' / −' + ld.removed + ')' + (ld.approx ? ' — w przybliżeniu' : '')),
          el('div', { class: 'nat-ldiff' }, rows, h.cut ? el('div', { class: 'nat-ld-gap' }, '… dalsze zmiany pominięte (zobacz w edytorze) …') : null)) : null,
        stripNotice(changes[n], 'Dlg_' + n));
    });
  }

  async function confirmSave(id, changes, orig) {
    const hasContent = !!(S.rec.content && S.rec.content.length);
    // ekran z treścią: oczekiwany stan WSZYSTKICH edytowalnych pól z chwili otwarcia — zmiana czegokolwiek w Selly od tamtej pory = odmowa (konflikt)
    const keys = hasContent ? S.rec.fields.filter(f => f.editable).map(f => f.name) : Object.keys(changes);
    const expect = Object.fromEntries(keys.map(k => [k, orig[k]]));
    const fail = (node) => hasContent ? showMsg(node) : paintRecord(id, node);
    const conflictBox = msg => el('div', { class: 'card nat-err', id: 'natMsg' }, el('p', null, msg),
      el('p', { class: 'muted' }, 'Twoje zmiany są nadal w formularzu — skopiuj treść, jeśli chcesz ją zachować, a potem pobierz aktualną wersję z Selly.'),
      el('div', { class: 'nat-actions' }, el('button', { type: 'button', class: 'secondary', id: 'natReload', title: 'Pobiera kartę z Selly od nowa (niezapisane zmiany znikną)', onclick: () => { if (mayLeave()) { dirty = null; showRecord(id); } } }, 'Pobierz aktualną wersję')));
    const errBox = (r, pre) => r.code === 'conflict' && hasContent ? conflictBox(r.error) : el('div', { class: 'card nat-err', id: 'natMsg' }, (r.code === 'conflict' || pre ? '' : 'Zapis nie powiódł się: ') + (r.error || (pre ? 'Nie udało się przygotować zapisu' : 'błąd')));
    const pre = await sellyCall({ op: 'save', screen: cfg.screen, id, changes, expect, dryRun: true });
    if (!root) return;
    if (!pre.ok) { fail(errBox(pre, true)); return; }
    if (!pre.data.diff.length) { fail(el('div', { class: 'card', id: 'natMsg' }, 'Bez zmian — wartości są już takie w Selly.')); return; }
    const body = el('div', null, el('p', null, 'Do Selly zostanie zapisane:'), diffTable(pre.data.diff, ['Było', 'Będzie']), contentDiffs(changes, orig), pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null);
    modal('Zapisać zmiany w Selly?', body, 'Zapisz w Selly', async close => {
      const r = await sellyCall({ op: 'save', screen: cfg.screen, id, changes, expect });
      close();
      if (!root) return;
      if (!r.ok) { fail(errBox(r, false)); return; }
      const v = r.data.verified;
      dirty = null;
      await showRecord(id);
      const m = el('div', { class: 'card ' + (v ? 'nat-ok' : 'nat-err'), id: 'natMsg' }, v ? 'Zapisano w Selly i sprawdzono: wartości zgadzają się.' : 'Selly przyjęło zapis, ale nie potwierdziło wszystkich pól (' + r.data.mismatches.join(', ') + '). Sprawdź kartę w Selly.');
      if (root) root.querySelector('.page-toolbar').after(m);
    });
  }

  async function confirmCreate(values) {
    const hasContent = !!(S.rec.content && S.rec.content.length);
    const fail = node => hasContent ? showMsg(node) : paintRecord(null, node);
    const pre = await sellyCall({ op: 'create', screen: cfg.screen, values, dryRun: true });
    if (!root) return;
    if (!pre.ok) { fail(el('div', { class: 'card nat-err', id: 'natMsg' }, pre.error || 'Nie udało się przygotować dodawania')); return; }
    const body = el('div', null, el('p', null, 'Do Selly zostanie wysłane:'), diffTable(pre.data.diff, ['Wartość']), contentDiffs(values, null), pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null);
    modal('Dodać w Selly?', body, 'Dodaj w Selly', async close => {
      const r = await sellyCall({ op: 'create', screen: cfg.screen, values });
      close();
      if (!root) return;
      if (!r.ok || r.data.failed) {
        const m = r.ok ? ((r.data.notices.find(n => n.kind === 'error') || {}).text || 'Selly odrzuciło dane') : r.error;
        fail(el('div', { class: 'card nat-err', id: 'natMsg' }, 'Dodawanie nie powiodło się: ' + (m || 'błąd'))); return;
      }
      const notes = (r.data.notices || []).map(n => n.text).join(' ');
      dirty = null;
      await showList();
      if (root) root.querySelector('.page-toolbar').after(el('div', { class: 'card nat-ok', id: 'natMsg' }, 'Dodano w Selly.' + (notes ? ' Selly: ' + notes + '.' : '') + ' Sprawdź listę (nowa pozycja może być na innej stronie).'));
    });
  }

  return { id: cfg.id, title: cfg.title, routes: [], mount, unmount, native: true };
}
