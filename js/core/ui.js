// Wspólne narzędzia interfejsu: el/$, toasty, menu ▾, eksport tabel (xlsx/csv/schowek), localStorage.

export const $ = id => document.getElementById(id);

// Błędy skryptu strony pokazujemy na stronie (raz każdy) — bez konsoli nie da się ich inaczej zgłosić
const seenErrors = new Set();
export function pageError(msg) {
  msg = String(msg || 'nieznany błąd').slice(0, 300);
  if (seenErrors.has(msg) || seenErrors.size > 3 || !$('pageErrors')) return;
  seenErrors.add(msg);
  const d = document.createElement('div');
  d.className = 'notice error';
  d.textContent = 'Błąd strony — część funkcji może nie działać. Przekaż ten opis administratorowi: ' + msg + ' (' + navigator.userAgent.replace(/.*(Chrome|Firefox|Edg)\/(\d+).*/, '$1 $2') + ')';
  $('pageErrors').append(d);
}

// Zabezpieczenie: null / undefined / false przekazane do replaceChildren, append i prepend nie mogą wyciec na stronę jako tekst „null”
for (const m of ['replaceChildren', 'append', 'prepend']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.filter(n => n != null && n !== false)); };
}

// ---- Bramka zapisu: sterowania zmieniające dane są wyłączone, gdy użytkownik nie ma prawa zmian w sekcji (docs/auth.md) ----
export const WRITE_TIP = 'Zmiany w tej sekcji wymagają zgody administratora panelu (nadaje ją w „Kto się logował”)';
let bootSource = () => null, grantable = [];
/** client.js podaje źródło stanu logowania (ctx.boot) i listę sekcji ze zgodami (GRANTABLE) — ui.js niczego nie importuje. */
export function bindWriteState(fn, grantableSections) { bootSource = fn; grantable = grantableSections || []; }
/**
 * Czy wolno zmieniać w sekcji (albo w którejkolwiek z listy — jak reguły serwera). Ta sama lista `write`, której używa serwer;
 * brak listy (stary backend) = decyduje serwer, więc nie blokujemy. Administrator i sekcje spoza zgód (natywne, tylko odczyty) — zawsze.
 */
export function canWrite(section, boot) {
  const b = boot === undefined ? bootSource() : boot;
  if (!b || !Array.isArray(b.write) || b.isAdmin) return true;
  const secs = (Array.isArray(section) ? section : [section]).filter(Boolean).map(String);
  if (!secs.length) return true;
  return secs.some(s => !grantable.includes(s) || b.write.includes(s));
}
function applyGate(e) {
  const locked = !canWrite(String(e.dataset.writeSection || '').split(','));
  const was = e.classList.contains('write-locked');
  if (locked === was) return;
  e.classList.toggle('write-locked', locked);
  if (locked) { e.dataset.writeTitle = e.getAttribute('title') || ''; e.setAttribute('aria-disabled', 'true'); e.title = WRITE_TIP; }
  else {
    e.removeAttribute('aria-disabled');
    if (e.dataset.writeTitle) e.title = e.dataset.writeTitle; else e.removeAttribute('title');
    delete e.dataset.writeTitle;
  }
}
/**
 * Oznacza sterowanie zapisu: bez prawa zmian jest wyszarzone (aria-disabled — zostaje fokusowalne, więc podpowiedź działa z klawiatury),
 * kliknięcie / Enter nic nie robi. Serwer i tak sprawdza uprawnienia. Zwraca element (można owijać el(...)).
 */
export function gateWrite(e, section) {
  e.dataset.writeSection = (Array.isArray(section) ? section : [section]).join(',');
  e.addEventListener('click', ev => { if (e.classList.contains('write-locked')) { ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);
  applyGate(e);
  return e;
}
/** Po zmianie uprawnień w trakcie sesji (odświeżenie startu): ponownie ocenia wszystkie oznaczone sterowania. */
export function refreshWriteGates(root) { for (const e of (root || document).querySelectorAll('[data-write-section]')) applyGate(e); }

export function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (attrs[k] == null || attrs[k] === false) continue;
    if (k === 'write') continue;   // sekcja zapisu — niżej (po title, który bramka podmienia)
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c);
  if (attrs && attrs.write) gateWrite(e, attrs.write);   // el('button', { write: 'produkty', … }) = sterowanie zapisu (bramka uprawnień)
  return e;
}


/*
 * Klik w wiersz listy, który otwiera szczegóły — tylko „prawdziwy” klik:
 *  - kursor przesunął się między wciśnięciem a puszczeniem o ≤ 6 px (przeciąganie = zaznaczanie tekstu, nie otwieranie),
 *  - nic nie jest zaznaczone (kopiowanie tekstu z wiersza nie otwiera szczegółów),
 *  - nie dwuklik (dwuklik zaznacza słowo — otwarcie czeka 220 ms i jest anulowane przy drugim kliknięciu),
 *  - nie na kontrolce (pole, link, przycisk, lista, etykieta).
 */
let tapDown = null, tapTimer = 0;
if (typeof document !== 'undefined') document.addEventListener('pointerdown', ev => { tapDown = { x: ev.clientX, y: ev.clientY }; }, true);
const TAP_SKIP = 'input,a,button,select,textarea,label,summary,[contenteditable]';
export function tapOpen(fn) {
  return ev => {
    if (ev.target.closest && ev.target.closest(TAP_SKIP)) return;
    clearTimeout(tapTimer);
    if (ev.detail > 1) return;
    if (tapDown && Math.hypot(ev.clientX - tapDown.x, ev.clientY - tapDown.y) > 6) return;
    const sel = window.getSelection ? String(window.getSelection()) : '';
    if (sel.trim()) return;
    tapTimer = setTimeout(() => { const s = window.getSelection ? String(window.getSelection()) : ''; if (!s.trim()) fn(ev); }, 220);
  };
}

// Przycięty tekst (.clip / .ellip): przy najechaniu dopisujemy pełną treść jako title (jeśli jest naprawdę ucięta i nie ma własnego title)
if (typeof document !== 'undefined') document.addEventListener('mouseover', ev => {
  const t = ev.target.closest && ev.target.closest('.clip, .ellip');
  if (t && !t.title && t.scrollWidth > t.clientWidth + 1) t.title = t.textContent.trim();
}, true);

export function plural(n, one, few, many) {
  const d = n % 10, h = n % 100;
  if (n === 1) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { return null; }
}

// ─── Eksport ───────────────────────────────────────────────────────────────

// Krótkie powiadomienie (toast) na dole ekranu; pierwszy argument zachowany dla zgodności wywołań
/** Jedno powiadomienie z aktualizowanym tekstem (postęp dłuższych operacji, np. eksportu). */
/** Toasty nad przyklejonym dolnym paskiem akcji (Zapisz / Zaznaczono…), a nie na jego przyciskach. */
const STICKY_BOTTOM = '.save-bar, .sel-bar, .sm-setbar, .zs-actions, .cfg-actions';
function placeToasts(host) {
  let top = innerHeight;
  for (const b of document.querySelectorAll(STICKY_BOTTOM)) {
    const r = b.getBoundingClientRect();
    if (r.height && !b.closest('[hidden]') && r.bottom >= innerHeight - 24 && r.top < innerHeight) top = Math.min(top, r.top);
  }
  host.style.bottom = top < innerHeight ? Math.round(innerHeight - top + 8) + 'px' : '';
}
export function progressToast(text) {
  const t = el('div', { class: 'toast-item', role: 'status' }, text);
  placeToasts($('toasts'));
  $('toasts').append(t);
  return { set: s => { t.textContent = s; }, done: s => { if (s) t.textContent = s; setTimeout(() => t.remove(), 2800); } };
}

/**
 * Krótki komunikat na dole ekranu. Błąd (kind 'error' albo tekst zaczynający się od „Nie udało…”, „Nie zapisano…”, „Błąd…”)
 * ma własny wygląd, zostaje dłużej (9 s; odliczanie stoi, gdy kursor / fokus jest na nim) i da się go zamknąć — zwykły znika po 2,8 s.
 */
const ERR_TOAST = /^(Nie udało|Nie pobrano|Nie zapisano|Nie usunięto|Nie dodano|Nie znaleziono|Nie można|Zapis nie|Błąd|Uzupełnianie przerwane)/;
export function flash(_id, text, kind) {
  const host = $('toasts');
  if (!host) return;
  const err = kind === 'error' || (kind == null && ERR_TOAST.test(String(text || '').trim()));
  const t = el('div', { class: 'toast-item' + (err ? ' err' : ''), role: err ? 'alert' : null }, text);
  if (err) t.append(el('button', { type: 'button', class: 'toast-x', 'aria-label': 'Zamknij komunikat', title: 'Zamknij komunikat', onclick: () => t.remove() }, '×'));
  placeToasts(host);
  host.append(t);
  while (host.children.length > 4) host.firstElementChild.remove();   // seria kliknięć nie zasypuje ekranu
  if (!err) { setTimeout(() => t.remove(), 2800); return; }
  // Błąd: 9 s, ale odliczanie stoi, gdy kursor lub fokus jest na komunikacie (czytanie / kopiowanie treści)
  let timer = 0;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => t.remove(), 9000); };
  const hold = () => clearTimeout(timer);
  t.addEventListener('mouseenter', hold); t.addEventListener('focusin', hold);
  t.addEventListener('mouseleave', () => { if (!t.contains(document.activeElement)) arm(); });
  t.addEventListener('focusout', ev => { if (!t.contains(ev.relatedTarget) && !t.matches(':hover')) arm(); });
  arm();
}

// ─── Okna dialogowe: wspólne zachowanie fokusu i klawiatury (wszystkie moduły, także te bez własnej obsługi) ───
// • nowe okno → fokus do środka (pierwsze pole; bez pól — bezpieczny przycisk, nie „Usuń”); po podmianie treści okna
//   (krok „Zapisuję…” → wynik) fokus zostaje w oknie, zamiast spaść na <body>;
// • Esc w oknie = jego „Anuluj” / „Zamknij” (przycisk z data-dismiss albo o takiej nazwie);
// • zamknięcie → fokus wraca tam, skąd okno otwarto (przycisk / menu), jeśli tylko jeszcze istnieje;
// • Tab w oknie modalnym (aria-modal) krąży po jego elementach.
export const DIALOG_SEL = '.ord-dialog, .bm-dialog, .nat-dialog, .pk-dialog';
const FOCUSABLE = 'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';
const shown = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && !e.closest('[hidden]');
const focusablesIn = d => [...d.querySelectorAll(FOCUSABLE)].filter(shown);
function firstFocus(d) {
  const list = focusablesIn(d);
  return d.querySelector('[autofocus]:not(:disabled)') || list.find(e => e.matches('input, select, textarea') && !e.closest('.menu'))
    || list.find(e => e.matches('button') && !e.matches('.danger')) || list[0] || null;
}
const dismissOf = d => [...d.querySelectorAll('[data-dismiss], button')].find(b => !b.disabled && shown(b) && (b.hasAttribute('data-dismiss') || /^(Anuluj|Zamknij|Wróć|Nie|×)$/.test(b.textContent.trim())));
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  let lastFocus = null;
  const open = new Set();
  const lost = () => { const a = document.activeElement; return !a || a === document.body || !a.isConnected; };
  document.addEventListener('focusin', ev => { if (ev.target.closest && !ev.target.closest(DIALOG_SEL)) lastFocus = ev.target; }, true);
  const sweep = () => {
    for (const d of document.querySelectorAll(DIALOG_SEL)) {
      const fresh = !open.has(d);
      if (fresh) { open.add(d); d.__prev = lastFocus; d.__prevId = lastFocus && lastFocus.id; }
      if (!shown(d) || d.contains(document.activeElement)) continue;
      if (fresh || lost()) { const t = firstFocus(d); if (t) t.focus({ preventScroll: true }); }
    }
    for (const d of [...open]) {
      if (d.isConnected && shown(d)) continue;
      open.delete(d);
      if (!lost() && !d.contains(document.activeElement)) continue;
      const back = d.__prev && d.__prev.isConnected ? d.__prev : (d.__prevId ? document.getElementById(d.__prevId) : null);
      if (back && shown(back)) back.focus({ preventScroll: true });
    }
  };
  const start = () => new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  document.addEventListener('keydown', ev => {
    if (ev.defaultPrevented) return;
    const d = ev.target.closest && ev.target.closest(DIALOG_SEL);
    if (ev.key === 'Escape' && d) {
      const b = dismissOf(d);
      if (b) { ev.preventDefault(); b.click(); }
      return;
    }
    if (ev.key !== 'Tab') return;
    const m = [...document.querySelectorAll('[aria-modal="true"]')].filter(shown).pop();
    if (!m || !m.matches(DIALOG_SEL)) return;
    const list = focusablesIn(m);
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    if (ev.shiftKey && i <= 0) { ev.preventDefault(); list[list.length - 1].focus(); }
    else if (!ev.shiftKey && (i === -1 || i === list.length - 1)) { ev.preventDefault(); list[0].focus(); }
  });
}

// ─── Menu rozwijane (Kopiuj ▾ / Pobierz ▾) ─────────────────────────────────

/**
 * Przycisk z menu: aria-haspopup/expanded, role=menu/menuitem, Esc / klik poza / wybór pozycji / utrata fokusu zamykają,
 * strzałki góra/dół + Home/End przenoszą fokus, po zamknięciu fokus wraca na przycisk.
 * items() jest wywoływane przy każdym otwarciu (liczniki zawsze aktualne): [{ label, count, title, run }].
 * Zwraca element z metodą setDisabled(bool).
 */
export function menuButton({ id, label, cls, title, items, disabled, write }) {
  const btn = el('button', { type: 'button', class: cls, id, title, 'aria-haspopup': 'menu', 'aria-expanded': 'false', disabled: !!disabled },
    label, el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
  if (write) gateWrite(btn, write);   // menu zmieniające dane: bez prawa zapisu nie otwiera się
  const pop = el('div', { class: 'menu-pop', role: 'menu', 'aria-label': label, hidden: true });
  const wrap = el('span', { class: 'menu' }, btn, pop);
  const enabled = () => [...pop.querySelectorAll('.menu-item:not(:disabled)')];
  const isOpen = () => !pop.hidden;
  const onDoc = ev => { if (!wrap.isConnected || !wrap.contains(ev.target)) close(false); };

  function close(refocus) {
    if (!isOpen()) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDoc, true);
    if (refocus) btn.focus();
  }
  function open() {
    if (btn.disabled || btn.classList.contains('write-locked')) return;
    pop.replaceChildren(...items().map(it => it.heading ? el('div', { class: 'menu-head', role: 'presentation' }, it.heading) : el('button', {
      type: 'button', role: 'menuitem', class: 'menu-item', tabindex: '-1', title: it.title, disabled: it.count === 0 || !!it.disabled,
      'data-active': it.active ? '1' : null, id: it.id || null,
      onclick: () => { close(true); it.run(); },
    }, it.label, it.count == null ? null : el('span', { class: 'menu-count' }, ' · ' + it.count), it.desc ? el('span', { class: 'menu-desc' }, it.desc) : null)));
    pop.style.transform = '';
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    // Wyrównanie do prawej krawędzi przycisku, ale zawsze w obrębie ekranu (telefon)
    const r = pop.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.left < 8) dx = 8 - r.left;
    if (r.right + dx > vw - 8) dx = vw - 8 - r.right;
    if (dx) pop.style.transform = 'translateX(' + Math.round(dx) + 'px)';
    document.addEventListener('mousedown', onDoc, true);
    const first = enabled()[0];
    if (first) first.focus();
  }
  btn.addEventListener('click', () => { if (isOpen()) close(true); else open(); });
  wrap.addEventListener('keydown', ev => {
    const k = ev.key;
    if (!isOpen()) {
      if (ev.target === btn && (k === 'ArrowDown' || k === 'ArrowUp')) { ev.preventDefault(); open(); }
      return;
    }
    if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); return; }
    const list = enabled();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    let next = null;
    if (k === 'ArrowDown') next = list[(i + 1) % list.length];
    else if (k === 'ArrowUp') next = list[(i <= 0 ? list.length : i) - 1];
    else if (k === 'Home') next = list[0];
    else if (k === 'End') next = list[list.length - 1];
    if (next) { ev.preventDefault(); next.focus(); }
  });
  wrap.addEventListener('focusout', ev => { if (isOpen() && ev.relatedTarget && !wrap.contains(ev.relatedTarget)) close(false); });
  wrap.setDisabled = b => { btn.disabled = !!b; if (b) close(false); };
  return wrap;
}

// ─── Tabela eksportu: { file, sheet, columns: [{ header, type }], rows, note? } ───
// Komórka linku: { text, url }. Ta sama tabela zasila CSV, Excel i schowek.

export const cellText = v => (v == null ? '' : typeof v === 'object' ? String(v.text == null ? '' : v.text) : String(v));
export const tableMatrix = t => [t.columns.map(c => c.header), ...t.rows.map(r => t.columns.map((_, i) => cellText(r[i])))];
export const uniqNonEmpty = xs => [...new Set(xs.map(x => String(x == null ? '' : x).trim()).filter(Boolean))];
export const htmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const today = () => new Date().toISOString().slice(0, 10);

export function copyMenuButton(id, getData, toastId) {
  return menuButton({ id, label: 'Kopiuj', cls: 'secondary', title: 'Skopiuj widoczną listę do schowka', items: () => {
    const d = getData();
    const emails = uniqNonEmpty(d.emails), phones = uniqNonEmpty(d.phones), t = d.table;
    const cp = (text, html, msg) => copyToClipboard(text, html, msg, toastId);
    return [
      { label: 'E-maile (kolumna)', count: emails.length, title: 'Jeden adres w wierszu — wklejony do arkusza wypełni kolumnę',
        run: () => cp(emails.join('\n'), null, 'Skopiowano ' + emails.length + ' ' + plural(emails.length, 'e-mail', 'e-maile', 'e-maili') + ' — wklej w arkuszu jako kolumnę') },
      { label: 'E-maile do pola UDW / Do', count: emails.length, title: 'Adresy oddzielone przecinkami — do pola „UDW” lub „Do” w programie pocztowym',
        run: () => cp(emails.join(', '), null, 'Skopiowano ' + emails.length + ' ' + plural(emails.length, 'adres', 'adresy', 'adresów') + ' — wklej w pole UDW lub Do') },
      { label: 'Telefony (kolumna)', count: phones.length, title: 'Jeden numer w wierszu — wklejony do arkusza wypełni kolumnę',
        run: () => cp(phones.join('\n'), null, 'Skopiowano ' + phones.length + ' ' + plural(phones.length, 'telefon', 'telefony', 'telefonów') + ' — wklej w arkuszu jako kolumnę') },
      { label: 'Całą tabelę', count: t.rows.length, title: 'Z nagłówkami — wklejona do Arkuszy Google lub Excela zachowa kolumny',
        run: () => cp(tableTsv(t), tableHtml(t), 'Skopiowano tabelę (' + t.rows.length + ' ' + plural(t.rows.length, 'wiersz', 'wiersze', 'wierszy') + ') — wklej w arkuszu') },
    ];
  } });
}

export function downloadMenuButton(id, getTable, toastId, disabled, opts) {
  const o = opts || {};
  return menuButton({ id, label: o.label || 'Pobierz', cls: o.cls || 'primary', title: o.title || 'Pobierz widoczną listę jako plik', disabled, items: () => {
    const t = getTable();
    return [
      { label: 'Excel (.xlsx)', count: t.rows.length, title: 'Arkusz z filtrami, szerokościami kolumn i linkami do zamówień', run: () => downloadXlsx(t, toastId) },
      { label: 'CSV (.csv)', count: t.rows.length, title: 'Plik tekstowy (separator „;”, UTF-8)', run: () => downloadCsv(tableMatrix(t).concat(t.note ? [[t.note]] : []), t.file, toastId) },
    ];
  } });
}

// ─── Schowek ───────────────────────────────────────────────────────────────

export const tableTsv = t => tableMatrix(t).map(r => r.map(s => s.replace(/[\t\r\n]+/g, ' ').trim()).join('\t')).join('\n');
export function tableHtml(t) {
  const [head, ...body] = tableMatrix(t);
  return '<table><thead><tr>' + head.map(h => '<th>' + htmlEsc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    body.map(r => '<tr>' + r.map(s => '<td>' + htmlEsc(s.replace(/[\t\r\n]+/g, ' ').trim()) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}

/** text/plain (+ opcjonalnie text/html) → ClipboardItem; potem writeText; na końcu ukryte pole + execCommand. */
export function copyToClipboard(text, html, okMsg, toastId) {
  const done = () => flash(toastId, okMsg);
  const legacy = () => {
    const ta = el('textarea', { class: 'sr-only', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy') ? done() : flash(toastId, 'Nie udało się skopiować'); } catch (e) { flash(toastId, 'Nie udało się skopiować'); }
    ta.remove();
  };
  const plain = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, legacy);
    else legacy();
  };
  if (html && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    try {
      const item = new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) });
      navigator.clipboard.write([item]).then(done, plain);
    } catch (e) { plain(); }
  } else plain();
}

// Excel (PL): separator „;”, UTF-8 z BOM. Komórki zaczynające się od =,@ (i +,- poza numerami
// telefonów) dostają apostrof, żeby arkusz nie potraktował ich jak formuły.
export function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-][\d\s()-]+$/.test(s))) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function saveBlob(blob, filename, msg, toastId) {
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  flash(toastId, msg);
}

export function downloadCsv(rows, name, toastId) {
  const csv = '﻿' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name + '-' + today() + '.csv', 'Pobrano plik CSV', toastId);
}

export function downloadXlsx(t, toastId) {
  saveBlob(buildXlsx({ sheetName: t.sheet, columns: t.columns, rows: t.rows, note: t.note }), t.file + '-' + today() + '.xlsx', 'Pobrano plik Excel', toastId);
}

// ─── Excel (.xlsx) bez bibliotek: ZIP bez kompresji + minimalny OOXML ──────

export const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** ZIP z wpisami STORED (metoda 0). files: [{ name, data: Uint8Array }] → Blob. */
export function zipStored(files, mime) {
  const enc = new TextEncoder(), now = new Date();
  const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const parts = [], central = [];
  let offset = 0, cdSize = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), len = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, len, true); lh.setUint32(22, len, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, len, true); ch.setUint32(24, len, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + len;
    cdSize += 46 + name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: mime });
}

export const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const xlsxColName = i => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// Style komórek: indeksy cellXfs (styles.xml w buildXlsx). Dane mają wariant zwykły i „pasek” (co drugi wiersz).
// Czytelność: wyższe wiersze, wyśrodkowanie w pionie, wcięcie tekstu, cienka linia pod wierszem,
// „tak” zielone / „nie” szare, liczby do prawej. Ciepła paleta jak na stronie.
export const XLSX_KINDS = ['text', 'date', 'center', 'link', 'number', 'yes', 'no'];
export const XS = { head: 1, note: 2, data: (kind, band) => 3 + XLSX_KINDS.indexOf(kind) * 2 + (band ? 1 : 0) };

/**
 * buildXlsx({ sheetName, columns: [{ header, width?, type: 'text'|'number'|'date'|'center'|'link' }], rows, note? }) → Blob.
 * Wiersze: tablice wartości w kolejności kolumn. Link: { text, url } (formuła HYPERLINK z zapamiętaną wartością).
 * Nagłówek: pogrubiony, jasne tło, zamrożony, z autofiltrem. note — jedna linijka pod danymi (poza filtrem).
 */
export function buildXlsx({ sheetName, columns, rows, note }) {
  // Nie pisać tu dosłownie „<” + „?” — HtmlService traktuje to jako scriptlet szablonu (SyntaxError przy otwarciu strony)
  const X = '<' + '?xml version="1.0" encoding="UTF-8" standalone="yes"?' + '>\n';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RELNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheet = (String(sheetName || 'Arkusz').replace(/[\\/?*[\]:]/g, ' ').trim() || 'Arkusz').slice(0, 31);
  const nCols = columns.length;
  const str = (ref, s, style) => '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="' + style + '"' : '') + '><is><t xml:space="preserve">' + xmlEsc(s) + '</t></is></c>';
  const serial = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569 : null; };
  const maxLen = columns.map(() => 0);

  const out = ['<row r="1" ht="30" customHeight="1">' + columns.map((c, j) => str(xlsxColName(j) + '1', c.header, XS.head)).join('') + '</row>'];
  rows.forEach((row, i) => {
    const r = i + 2, band = i % 2 === 1;
    let cells = '';
    columns.forEach((c, j) => {
      const v = row[j];
      const ref = xlsxColName(j) + r;
      const s = kind => XS.data(kind, band);
      // Puste komórki też dostają styl — inaczej pasek i linia pod wierszem miałyby dziury
      if (v == null || v === '') { cells += '<c r="' + ref + '" s="' + s(c.type === 'center' ? 'center' : 'text') + '"/>'; return; }
      const text = cellText(v);
      maxLen[j] = Math.max(maxLen[j], c.type === 'date' ? 10 : text.length);
      if (c.type === 'number' && isFinite(Number(v))) cells += '<c r="' + ref + '" s="' + s('number') + '"><v>' + Number(v) + '</v></c>';
      else if (c.type === 'date' && serial(text) != null) cells += '<c r="' + ref + '" s="' + s('date') + '"><v>' + serial(text) + '</v></c>';
      else if (c.type === 'link' && typeof v === 'object' && v.url && String(v.url).length <= 255 && text.length <= 255 && text) {
        const q = x => xmlEsc(String(x).replace(/"/g, '""'));
        cells += '<c r="' + ref + '" t="str" s="' + s('link') + '"><f>HYPERLINK("' + q(v.url) + '","' + q(text) + '")</f><v>' + xmlEsc(text) + '</v></c>';
      } else if (c.type === 'center') {
        cells += str(ref, text, s(/^tak$/i.test(text) ? 'yes' : /^nie$/i.test(text) ? 'no' : 'center'));
      } else cells += str(ref, text, s('text'));
    });
    out.push('<row r="' + r + '">' + cells + '</row>');
  });
  if (note) out.push('<row r="' + (rows.length + 3) + '">' + str('A' + (rows.length + 3), note, XS.note) + '</row>');

  const cols = columns.map((c, j) => {
    // +4: wcięcie tekstu i strzałka filtra w nagłówku
    const w = c.width || Math.min(50, Math.max(c.type === 'center' ? 12 : 10, Math.max(maxLen[j], Math.min(c.header.length, 18)) + 4));
    return '<col min="' + (j + 1) + '" max="' + (j + 1) + '" width="' + w + '" customWidth="1"/>';
  }).join('');
  const lastCell = xlsxColName(nCols - 1) + (rows.length + 1);
  const sheetXml = X + '<worksheet xmlns="' + NS + '"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20" customHeight="1"/><cols>' + cols + '</cols>' +
    '<sheetData>' + out.join('') + '</sheetData><autoFilter ref="A1:' + lastCell + '"/></worksheet>';

  const font = (opts, color) => '<font>' + (opts || '') + '<sz val="11"/><color rgb="FF' + color + '"/><name val="Calibri"/><family val="2"/></font>';
  const fonts = [font('', '2F281F'), font('<b/>', '2F281F'), font('<u/>', '0563C1'), font('<i/>', '6A5D4C'), font('<b/>', '2F6A2C'), font('', '9A8B76')];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF3E0CB"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFBF6EE"/><bgColor indexed="64"/></patternFill></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="medium"><color rgb="FFCDBB9D"/></bottom><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFEDE3D3"/></bottom><diagonal/></border>'];
  const xf = (numFmt, fontId, fillId, borderId, align) => '<xf numFmtId="' + numFmt + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId +
    '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment ' + align + '/></xf>';
  const xfs = [xf(0, 0, 0, 0, 'vertical="center"'), xf(0, 1, 2, 1, 'vertical="center" wrapText="1" indent="1"'), xf(0, 3, 0, 0, 'vertical="center"')];
  const KIND = { text: [0, 0, 'indent="1"'], date: [164, 0, 'horizontal="center"'], center: [0, 0, 'horizontal="center"'], link: [0, 2, 'indent="1"'],
    number: [3, 0, 'horizontal="right" indent="1"'], yes: [0, 4, 'horizontal="center"'], no: [0, 5, 'horizontal="center"'] };
  for (const k of XLSX_KINDS) for (const band of [0, 1]) xfs.push(xf(KIND[k][0], KIND[k][1], band ? 3 : 0, 2, 'vertical="center" ' + KIND[k][2]));
  const stylesXml = X + '<styleSheet xmlns="' + NS + '"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>' +
    '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts>' +
    '<fills count="' + fills.length + '">' + fills.join('') + '</fills>' +
    '<borders count="' + borders.length + '">' + borders.join('') + '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const q = s => "'" + sheet.replace(/'/g, "''") + "'";
  const workbookXml = X + '<workbook xmlns="' + NS + '" xmlns:r="' + RELNS + '"><bookViews><workbookView/></bookViews>' +
    '<sheets><sheet name="' + xmlEsc(sheet) + '" sheetId="1" r:id="rId1"/></sheets>' +
    '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' + xmlEsc(q() + '!$A$1:$' + xlsxColName(nCols - 1) + '$' + (rows.length + 1)) + '</definedName></definedNames></workbook>';
  const PK = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const OD = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const files = [
    ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="' + OD + 'sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="' + OD + 'worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="' + OD + 'styles+xml"/></Types>'],
    ['_rels/.rels', X + '<Relationships xmlns="' + PK + '"><Relationship Id="rId1" Type="' + RELNS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', workbookXml],
    ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="' + PK + '"><Relationship Id="rId1" Type="' + RELNS + '/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="' + RELNS + '/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', stylesXml],
    ['xl/worksheets/sheet1.xml', sheetXml],
  ];
  const enc = new TextEncoder();
  return zipStored(files.map(([name, xml]) => ({ name, data: enc.encode(xml) })), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// Tekst do porównań bez wielkości liter i polskich znaków
export const norm = s => String(s || '').toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[\u0300-\u036F]/g, '');

// ─── Wspólne elementy modułów z listą z backendu (Zamówienia, Produkty, Klienci) ───

export const money = v => (v == null || v === '' || isNaN(Number(v)) ? '—' : Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const dateStr = d => (d ? String(d).replace('T', ' ').slice(0, 16) : '');
export const fullName = (a, b) => [a, b].filter(Boolean).join(' ').trim();
export const cnt = (n, one, few, many) => n + ' ' + plural(n, one, few, many);
export const isUnavailable = e => e && (e.code === 501 || e.code === 'd1_unavailable' || /nieznana akcja|unknown action/i.test(e.message || ''));
export const syncedLabel = ms => (ms ? new Date(ms).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function loadingBox(text) {
  return el('div', { class: 'loading' }, el('div', { class: 'line' }, el('span', { class: 'spinner' }), text),
    el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' }));
}
export const sellyLink = (text, url, tip) => el('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn-link', title: tip }, text);

/** Lista „etykieta – wartość”; puste wartości pomijane. pairs: [[etykieta, wartość, tooltip?]] */
export const dl = pairs => el('dl', { class: 'ord-dl' }, pairs.filter(p => p && p[1] != null && p[1] !== '' && p[1] !== false).flatMap(([k, v, tip]) => [el('dt', { title: tip || null, class: tip ? 'tip' : null }, k), el('dd', null, v)]));

/**
 * Strzałka kierunku sortowania w nagłówku. Miejsce na nią jest zarezerwowane także w nieaktywnych kolumnach,
 * więc klik w nagłówek nie poszerza kolumny i tabela nie „skacze” (zgłoszenie właściciela). Treść: ' ↑' / ' ↓' / '' (spacja jak dawniej w „Nazwa ↓”).
 */
export const sortMark = (active, asc) => el('span', { class: 'sort-ar', 'aria-hidden': 'true' }, active ? (asc ? ' ↑' : ' ↓') : '');

/**
 * Nagłówek kolumny tabeli z sortowaniem serwerowym. col: { label, sort?, num?, tip, tipHeader?, firstDir? ('asc'|'desc') }.
 * state: { sort, dir }; onSort(sort, dir). Kolumna bez `sort` to zwykły nagłówek z tooltipem.
 */
export function sortTh(col, state, onSort) {
  const cls = col.num ? 'n' : null;
  // Kolumna z kilkoma możliwymi sortowaniami (np. „Nr i status”: Nr / Data / Status) — każde to osobny przycisk
  if (col.sorts) {
    const act = col.sorts.find(x => x.sort === state.sort);
    return el('th', { class: cls, 'aria-sort': act ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      el('span', { class: 'th-multi' }, el('span', { title: col.tip, class: 'th-lbl tip' }, col.label), ...col.sorts.map(x => {
        const a = state.sort === x.sort;
        return el('button', { type: 'button', class: 'th-sort' + (a ? ' on' : ''), title: (x.tip || x.label) + '\n\n' + (a ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
          onclick: () => onSort(x.sort, a ? (state.dir === 'asc' ? 'desc' : 'asc') : (x.firstDir || (x.num ? 'desc' : 'asc'))) }, x.label, sortMark(a, state.dir === 'asc'));
      })));
  }
  if (!col.sort) return el('th', { class: cls }, el('span', { title: col.tip, class: col.tipHeader ? 'tip' : null }, col.label));
  const active = state.sort === col.sort;
  return el('th', { class: cls, 'aria-sort': active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
    el('button', { type: 'button', class: col.tipHeader ? 'tip' : null, title: col.tip + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
      onclick: () => onSort(col.sort, active ? (state.dir === 'asc' ? 'desc' : 'asc') : (col.firstDir || (col.num ? 'desc' : 'asc'))) },
      col.label, sortMark(active, state.dir === 'asc')));
}

/** Stronicowanie: „← Poprzednia · Strona X z Y · N pozycji · Następna →”. o: { prefix, page, pages, total, noun:[1,2-4,5+], onPage } */
export function pager(o) {
  const cur = Math.min(o.page, o.pages);
  const goTo = v => { const n = Math.min(o.pages, Math.max(1, parseInt(v, 10) || cur)); if (n !== cur) o.onPage(n); };
  const inp = el('input', { type: 'number', class: 'pg-in', id: o.prefix + 'Page', min: '1', max: String(o.pages), value: String(cur), 'aria-label': 'Numer strony', title: 'Wpisz numer strony i naciśnij Enter',
    onchange: () => goTo(inp.value), onkeydown: ev => { if (ev.key === 'Enter') goTo(inp.value); } });
  const arrow = (id, label, dis, tip, to) => el('button', { type: 'button', class: 'secondary pg-btn', id: o.prefix + id, disabled: dis, 'aria-label': tip, title: dis ? (id === 'Prev' ? 'To pierwsza strona' : 'To ostatnia strona') : tip, onclick: () => o.onPage(to) }, label);
  return el('div', { class: 'ord-pager' },
    el('div', { class: 'pg-nav' }, arrow('Prev', '‹', cur <= 1, 'Poprzednia strona', cur - 1), el('span', { class: 'muted' }, 'Strona'), inp, el('span', { class: 'muted' }, 'z ' + o.pages), arrow('Next', '›', cur >= o.pages, 'Następna strona', cur + 1)),
    el('span', { class: 'muted' }, cnt(o.total, ...o.noun)),
    o.sizes ? el('label', { class: 'field-inline', title: 'Ile pozycji pokazać na jednej stronie' }, 'Na stronie',
      el('select', { id: o.prefix + 'PageSize', 'aria-label': 'Pozycji na stronie', onchange: ev => o.onSize(Number(ev.target.value)) }, o.sizes.map(n => el('option', { value: String(n), selected: n === o.size }, String(n))))) : null);
}

// ─── Wspólne klocki widoków list (Produkty, Zamówienia): pasek tytułu, panel filtrów, wiersze rozbudowane ──

/**
 * Menu „Kolumny ▾” z polami wyboru (zostaje otwarte przy przełączaniu); wybór pamiętany w localStorage (`storeKey`).
 * o: { id, storeKey, cols: [{ key, label, tip, def?: bool, locked?: bool }], onChange() }. Zwraca { node, isOn(key) }.
 */
export function columnMenu(o) {
  const saved = store(o.storeKey) || {};
  const isOn = key => { const c = o.cols.find(x => x.key === key); return !c || c.locked || (saved[key] != null ? !!saved[key] : c.def !== false); };
  const btn = el('button', { type: 'button', class: 'secondary', id: o.id, 'aria-haspopup': 'true', 'aria-expanded': 'false',
    title: 'Wybierz, które kolumny tabeli są widoczne. Wybór jest zapamiętywany w tej przeglądarce.' }, 'Kolumny', el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
  const pop = el('div', { class: 'menu-pop wide', id: o.id + 'Pop', hidden: true }, o.cols.map(c => {
    const cb = el('input', { type: 'checkbox', checked: isOn(c.key), disabled: !!c.locked, 'data-col': c.key,
      onchange: () => { saved[c.key] = cb.checked; store(o.storeKey, saved); o.onChange(); } });
    return el('label', { class: 'menu-check' + (c.locked ? ' dis' : ''), title: c.locked ? 'Ta kolumna jest zawsze widoczna' : c.tip || null }, cb, el('span', null, c.label));
  }));
  const node = el('span', { class: 'menu' }, btn, pop);
  const onDoc = ev => { if (!node.contains(ev.target)) close(); };
  function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', onDoc, true); }
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); document.addEventListener('mousedown', onDoc, true);
  });
  node.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !pop.hidden) { ev.stopPropagation(); close(); btn.focus(); } });
  return { node, isOn };
}

/**
 * Lista wielokrotnego wyboru w rozwijanym okienku: pola wyboru, wyszukiwarka (dla długich list), „Zaznacz wszystkie / Wyczyść”,
 * podsumowanie na przycisku („Woj.: mazowieckie +2”). Wartość to klucze oddzielone przecinkami (jak w adresie strony).
 * o: { id, all: 'Wszystkie województwa', short: 'Woj.', noun, tip, none?: 'bez danych', onChange(csv) }.
 * Zwraca { node, btn, set(options: [{ key, label, n? }], csv) }; `btn.value` = bieżące klucze (csv).
 */
export function multiSelect(o) {
  let opts = [], sel = new Set(), sig = '', timer = 0;
  const NONE = '__none';
  const btn = el('button', { type: 'button', id: o.id, class: 'osa-sel ms-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: o.tip || null });
  const search = el('input', { type: 'search', class: 'ms-search', placeholder: 'Szukaj…', 'aria-label': 'Szukaj na liście: ' + (o.noun || o.all), oninput: () => filter() });
  const list = el('div', { class: 'ms-list', role: 'group', 'aria-label': o.noun || o.all });
  const allBtn = el('button', { type: 'button', class: 'link small', title: 'Zaznacza wszystkie pozycje widoczne na liście (po wyszukaniu — tylko pasujące)', onclick: () => { for (const k of visibleKeys()) sel.add(k); commit(); } }, 'Zaznacz wszystkie');
  const clearBtn = el('button', { type: 'button', class: 'link small', title: 'Odznacza wszystko — filtr przestaje działać', onclick: () => { sel.clear(); commit(); } }, 'Wyczyść');
  const pop = el('div', { class: 'menu-pop wide ms-pop', hidden: true }, search, el('div', { class: 'ms-tools' }, allBtn, clearBtn), list);
  const node = el('span', { class: 'menu ms' }, btn, pop);
  const rows = new Map();
  const visibleKeys = () => [...rows].filter(([, r]) => !r.hidden).map(([k]) => k);
  const labelOf = k => k === NONE ? '— ' + (o.none || 'bez danych') + ' —' : (opts.find(x => x.key === k) || { label: k }).label;
  function paint() {
    const keys = [...sel];
    btn.value = keys.join(',');
    btn.textContent = '';
    btn.classList.toggle('on', keys.length > 0);
    const txt = !keys.length ? o.all : keys.length === 1 ? labelOf(keys[0]) : (o.short || o.noun || '') + ': ' + labelOf(keys[0]) + ' +' + (keys.length - 1);
    btn.append(el('span', { class: 'ms-txt' }, txt), el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
    btn.title = (o.tip || '') + (keys.length ? '\n\nWybrane: ' + keys.map(labelOf).join(', ') : '');
    for (const [k, r] of rows) r.cb.checked = sel.has(k);
  }
  function commit() { paint(); clearTimeout(timer); timer = setTimeout(() => o.onChange([...sel].join(',')), 250); }
  function filter() {
    const q = search.value.trim().toLowerCase();
    for (const [, r] of rows) { r.hidden = !!q && !r.text.includes(q); r.node.hidden = r.hidden; }
  }
  function build() {
    rows.clear();
    const all = o.none === false ? opts : [{ key: NONE, label: '— ' + (o.none || 'bez danych') + ' —' }, ...opts];
    list.replaceChildren(...all.map(x => {
      const cb = el('input', { type: 'checkbox', 'data-key': x.key, onchange: () => { if (cb.checked) sel.add(x.key); else sel.delete(x.key); commit(); } });
      const node = el('label', { class: 'menu-check' }, cb, el('span', null, x.label), x.n == null ? null : el('span', { class: 'menu-count' }, String(x.n)));
      rows.set(x.key, { cb, node, text: String(x.label).toLowerCase(), hidden: false });
      return node;
    }));
    search.hidden = all.length <= 8;
    filter();
  }
  const onDoc = ev => { if (!node.contains(ev.target)) close(); };
  function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', onDoc, true); }
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); document.addEventListener('mousedown', onDoc, true);
    if (!search.hidden) search.focus();
  });
  node.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !pop.hidden) { ev.stopPropagation(); close(); btn.focus(); } });
  paint();
  return {
    node, btn,
    set(options, csv) {
      opts = options;
      sel = new Set(String(csv || '').split(',').filter(Boolean));
      for (const k of sel) if (k !== NONE && !opts.some(x => x.key === k)) opts = [...opts, { key: k, label: k }];
      const s2 = opts.map(x => x.key + '|' + x.label + '|' + x.n).join('|');
      if (s2 !== sig || !rows.size) { sig = s2; build(); }
      paint();
    },
  };
}

/** Pasek strony: tytuł + opis po lewej, akcje po prawej (główna — ostatnia). */
export function pageToolbar({ title, sub, actions }) {
  return el('div', { class: 'page-toolbar' }, el('div', { class: 'pt-title' }, el('h2', null, title), sub ? el('div', { class: 'sub' }, sub) : null),
    el('div', { class: 'pt-actions' }, ...(actions || []).filter(Boolean)));
}

/**
 * Układ „panel filtrów po lewej + treść”. Panel jest zwijany, a wybór pamiętany (store `osa-fp2-<key>`).
 * Zwraca { node, panel, main, isOpen(), setOpen(bool) }; panel.hidden = zwinięty.
 */
// Filtry domyślnie zwinięte (prośba użytkownika); stan zapamiętywany per lista (klucz v2 — reset dawnych „otwartych” domyślnie)
export function filterLayout({ key, panelId, mainNodes, panelNodes, defaultOpen = false }) {
  const saved = store('osa-fp2-' + key);
  const panel = el('aside', { class: 'filter-panel', id: panelId, 'aria-label': 'Filtry' }, ...panelNodes);
  const main = el('div', { class: 'split-main' }, ...mainNodes);
  const L = { panel, main, node: el('div', { class: 'split' }, panel, main) };
  panel.hidden = saved == null ? !defaultOpen : !saved;
  L.isOpen = () => !panel.hidden;
  L.setOpen = (v, persist = true) => { panel.hidden = !v; if (persist) store('osa-fp2-' + key, v ? 1 : 0); };
  return L;
}
/** Sekcja panelu filtrów: tytuł + treść; `fold: true` zwija ją (opcje zaawansowane). */
export function filterSection(title, body, { fold = false, open = false, tip } = {}) {
  if (!fold) return el('section', { class: 'fp-sec' }, el('h3', { title: tip || null, class: tip ? 'tip' : null }, title), body);
  return el('details', { class: 'fp-sec fold', open }, el('summary', { title: tip || null }, title), body);
}

/** Ton plakietki statusu zamówienia z jego nazwy (Selly API nie podaje kolorów statusów): ok | warn | bad | acc | info | neutral. */
export function orderStatusTone(name) {
  const n = norm(name);
  if (/anul|zwrot|odrzuc/.test(n)) return 'bad';
  if (/nieoplac|zlozon|oczek|nowe|nowy/.test(n)) return 'warn';
  if (/wyslan|nadan|kurier|w drodze/.test(n)) return 'info';
  if (/zrealiz|dostarcz|odebran|zakoncz/.test(n)) return 'ok';
  if (/oplac|realizacj|przygot|pakow|potwierdz/.test(n)) return 'acc';
  return 'neutral';
}

/** Kolorowa plakietka statusu (ton: ok | warn | bad | acc | info | neutral). */
export const statusPill = (text, tone, tip) => el('span', { class: 'ord-st ' + (tone || 'neutral'), title: tip || 'Status: ' + text }, text);

/** Miniatura (domyślnie 56 px) albo pusty kwadrat z literą, gdy brak zdjęcia. */
export function thumb(url, name, size = 56) {
  const ph = () => el('span', { class: 'thumb-l ph', 'aria-hidden': 'true' }, String(name || '?').trim().charAt(0).toUpperCase());
  const ok = typeof url === 'string' && /^https?:\/\//i.test(url);
  if (!ok) return ph();
  const img = el('img', { class: 'thumb-l', src: url, alt: '', loading: 'lazy', width: String(size), height: String(size) });
  // Zdjęcie się nie wczytało — zamień na literę (ten sam rozmiar, bez skoku układu)
  img.addEventListener('error', () => { const p = ph(); p.className = img.className.replace('thumb-l', 'thumb-l ph'); img.replaceWith(p); }, { once: true });
  return img;
}

/**
 * Pole edytowane w wierszu: podświetla się, gdy wartość różni się od początkowej.
 * o: { value, type?, id?, cls?, label, tip, attrs?, onChange(dirty) }. Zwraca input z `reset()` i `isDirty()`.
 */
export function inlineInput(o) {
  const orig = o.value == null ? '' : String(o.value);
  const inp = el('input', Object.assign({ type: o.type || 'text', class: 'inl ' + (o.cls || ''), value: orig, 'aria-label': o.label, title: o.tip || null, id: o.id || null }, o.attrs || {}));
  inp.isDirty = () => inp.value !== orig;
  inp.reset = () => { inp.value = orig; inp.classList.remove('dirty'); };
  inp.addEventListener('input', () => { inp.classList.toggle('dirty', inp.isDirty()); if (o.onChange) o.onChange(inp.isDirty()); });
  return inp;
}

/** Przyklejony dolny pasek „Zapisz zmiany (N)” z „Cofnij”. o: { id, noun, onSave, onUndo }. Zwraca { node, set(n), busy(bool), say(text) }. */
export function saveBar(o) {
  const count = el('strong', { id: o.id + 'Count' });
  const msg = el('span', { class: 'muted small', id: o.id + 'Msg', role: 'status' });
  const save = el('button', { type: 'button', class: 'primary', write: o.write, id: o.id + 'Save', title: 'Zapisuje wszystkie zmienione pola naraz (w Selly)', onclick: () => o.onSave() }, 'Zapisz zmiany');
  const undo = el('button', { type: 'button', class: 'secondary', id: o.id + 'Undo', title: 'Przywraca wszystkie pola do wartości sprzed edycji', onclick: () => o.onUndo() }, 'Cofnij');
  const node = el('div', { class: 'save-bar', id: o.id, hidden: true }, el('span', null, 'Niezapisane zmiany: ', count, o.noun ? ' ' + o.noun : ''), msg, el('span', { class: 'spacer' }), undo, save);
  return {
    node,
    set(n) { node.hidden = n === 0 && !msg.textContent; count.textContent = String(n); save.textContent = 'Zapisz zmiany (' + n + ')'; save.disabled = n === 0; undo.disabled = n === 0; },
    busy(b) { save.disabled = b; undo.disabled = b; },
    say(t) { msg.textContent = t || ''; },
  };
}

/**
 * Dopisek paska „Zaznaczono…” o zaznaczeniu spoza bieżącej strony — z akcjami jak w Gmailu (jeden wzór dla wszystkich list):
 * „(w tym N z innych stron) · Pokaż zaznaczone · Odznacz je”; w widoku „tylko zaznaczone” — „Wróć do listy”.
 * o: { prefix, off, only, onShow(), onBack(), onUnselOff() }. Zwraca węzeł albo null (nic do pokazania).
 */
export function selOffNote(o) {
  const lnk = (id, label, tip, fn) => el('button', { type: 'button', class: 'link', id: o.prefix + id, title: tip, onclick: fn }, label);
  if (o.only) return el('span', { class: 'small', id: o.prefix + 'SelOff' }, ' · ', lnk('SelBack', 'Wróć do listy', 'Wraca do pełnej listy (zaznaczenie zostaje)', o.onBack));
  if (!o.off) return null;
  return el('span', { class: 'small', id: o.prefix + 'SelOff' },
    el('span', { class: 'muted tip', title: 'Zaznaczenie zostaje po przejściu na inną stronę lub zmianie filtra — akcje obejmą wszystkie zaznaczone' }, ' (w tym ' + o.off + ' z innych stron)'),
    ' · ', lnk('SelShow', 'Pokaż zaznaczone', 'Pokazuje tylko zaznaczone pozycje, wszystkie na jednej liście', o.onShow),
    ' · ', lnk('SelOffNone', 'Odznacz je', 'Odznacza pozycje zaznaczone na innych stronach (ta strona zostaje bez zmian)', o.onUnselOff));
}

/** Lista akcji przy wierszu: [{ label, href?, onclick?, icon, tip, ext? }] — małe ikony + etykiety. */
export function rowActions(items) {
  return el('ul', { class: 'row-actions' }, items.filter(Boolean).map(a => el('li', null,
    el('a', { href: a.href || '#', title: a.tip || null, target: a.ext ? '_blank' : null, rel: a.ext ? 'noopener' : null,
      onclick: a.onclick ? ev => { ev.preventDefault(); a.onclick(ev); } : null }, el('span', { class: 'ra-ico', 'aria-hidden': 'true' }, a.icon || '•'), a.label))));
}

/** Pobiera kolejne strony listy (po 200) aż do `max` wierszy: fetchPage(page) → { rows, total }. */
export async function fetchAllRows(fetchPage, max, what = 'dane') {
  const rows = []; let total = 0;
  const pt = progressToast('Pobieram ' + what + ' do pliku…');
  try {
    for (let page = 1; rows.length < max; page++) {
      const r = await fetchPage(page);
      total = r.total; rows.push(...r.rows);
      if (total > 200) pt.set('Pobieram ' + what + ' do pliku… ' + Math.min(rows.length, total) + ' z ' + total);
      if (!r.rows.length || rows.length >= total) break;
    }
    pt.done('Gotowe: ' + Math.min(rows.length, max) + ' w pliku');
  } catch (e) { pt.done(); throw e; }
  return { rows: rows.slice(0, max), total };
}

/** Pole z tooltipem: <label>tekst + kontrolka</label>. */
export const field = (label, control, tip) => el('label', { class: 'field-inline', title: tip || null }, label, control);

export * from './datepicker.js?v=a0c413f';   // pole daty i zakres dat
