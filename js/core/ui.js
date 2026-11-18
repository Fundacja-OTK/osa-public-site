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

export function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (attrs[k] == null || attrs[k] === false) continue;
    if (k === 'class') e.className = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c);
  return e;
}


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
export function progressToast(text) {
  const t = el('div', { class: 'toast-item', role: 'status' }, text);
  $('toasts').append(t);
  return { set: s => { t.textContent = s; }, done: s => { if (s) t.textContent = s; setTimeout(() => t.remove(), 2800); } };
}

export function flash(_id, text) {
  const t = el('div', { class: 'toast-item' }, text);
  $('toasts').append(t);
  setTimeout(() => t.remove(), 2800);
}

// ─── Menu rozwijane (Kopiuj ▾ / Pobierz ▾) ─────────────────────────────────

/**
 * Przycisk z menu: aria-haspopup/expanded, role=menu/menuitem, Esc / klik poza / wybór pozycji / utrata fokusu zamykają,
 * strzałki góra/dół + Home/End przenoszą fokus, po zamknięciu fokus wraca na przycisk.
 * items() jest wywoływane przy każdym otwarciu (liczniki zawsze aktualne): [{ label, count, title, run }].
 * Zwraca element z metodą setDisabled(bool).
 */
export function menuButton({ id, label, cls, title, items, disabled }) {
  const btn = el('button', { type: 'button', class: cls, id, title, 'aria-haspopup': 'menu', 'aria-expanded': 'false', disabled: !!disabled },
    label, el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
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
    if (btn.disabled) return;
    pop.replaceChildren(...items().map(it => el('button', {
      type: 'button', role: 'menuitem', class: 'menu-item', tabindex: '-1', title: it.title, disabled: it.count === 0,
      onclick: () => { close(true); it.run(); },
    }, it.label, it.count == null ? null : el('span', { class: 'menu-count' }, ' · ' + it.count))));
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
