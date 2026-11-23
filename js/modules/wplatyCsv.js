// Import wpłat bankowych — parser wyciągów CSV (czysta logika, działa w przeglądarce i w Node; bez sieci i bez zapisu czegokolwiek).
// Wyciąg zawiera dane osobowe, więc jest przetwarzany WYŁĄCZNIE lokalnie: nic stąd nie jest wysyłane ani logowane.
// Obsługa: kodowanie (UTF-8 / Windows-1250), separator (; , tabulator |), przecinek dziesiętny, wiersze opisowe przed nagłówkiem,
// rozpoznanie banku po nagłówkach (mBank, PKO BP, ING, Santander, Millennium, Pekao) oraz ręczne mapowanie kolumn dla innych formatów.

export const BANKS = {
  mbank: 'mBank', pko: 'PKO BP', ing: 'ING', santander: 'Santander', millennium: 'Millennium', pekao: 'Pekao', generic: 'Inny bank (ręczne mapowanie)',
};

/** Tekst z bajtów: UTF-8, a gdy to nie UTF-8 — Windows-1250 (polskie eksporty bankowe). Zwraca { text, encoding }. */
export function decodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return { text: text.replace(/^﻿/, ''), encoding: 'UTF-8' };
  } catch (e) { /* nie UTF-8 */ }
  let enc = 'windows-1250';
  try { new TextDecoder(enc); } catch (e) { enc = 'iso-8859-2'; }
  return { text: new TextDecoder(enc).decode(u8), encoding: 'Windows-1250' };
}

/** Separator: ten z (; , tab |), który daje najbardziej równą liczbę kolumn (≥2) w pierwszych liniach (poza cudzysłowami). */
export function detectSeparator(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  let best = ';', bestScore = -1;
  for (const sep of [';', '\t', ',', '|']) {
    const counts = lines.map(l => { let n = 0, q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) n++; } return n; }).filter(n => n > 0);
    if (!counts.length) continue;
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    const score = counts.filter(n => n === mode).length * 1000 + mode;
    if (mode >= 1 && score > bestScore) { best = sep; bestScore = score; }
  }
  return best;
}

/** Parser CSV (RFC 4180 + dowolny separator): cudzysłowy, "" jako cudzysłów, nowe linie w polach. */
export function parseCsv(text, sep) {
  const rows = []; let row = [], cur = '', q = false, i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"' && cur === '') { q = true; i++; continue; }
    if (ch === sep) { row.push(cur); cur = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; i++; continue; }
    cur += ch; i++;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/** Nagłówek w postaci porównywalnej: małe litery, bez polskich znaków, '#', zbędnych spacji; „a / b” → „a/b”. */
export const normHeader = s => String(s == null ? '' : s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/#/g, '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

/** Kwota z tekstu: „1 234,56”, „1.234,56”, „-1234.56”, „+100,00 PLN”, „(12,00)”. NaN, gdy to nie liczba. decimal: 'auto' | 'comma' | 'dot'. */
export function parseAmount(raw, decimal = 'auto') {
  let s = String(raw == null ? '' : raw).replace(/[  \s]/g, '').replace(/[A-Za-z]+$/g, '').replace(/^[A-Za-z]+/g, '');
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-') || s.startsWith('−')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
  const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
  let decSep = '';
  if (decimal === 'comma') decSep = ',';
  else if (decimal === 'dot') decSep = '.';
  else if (lastC >= 0 && lastD >= 0) decSep = lastC > lastD ? ',' : '.';
  else if (lastC >= 0 || lastD >= 0) {
    const sep = lastC >= 0 ? ',' : '.', parts = s.split(sep);
    // jeden separator: 1–2 cyfry po nim = dziesiętny; dokładnie 3 cyfry i grupa ≤3 cyfr przed = tysiące; powtórzony = tysiące
    if (parts.length > 2) decSep = '';
    else if (parts[1].length === 3 && parts[0].length >= 1 && parts[0].length <= 3 && parts[0] !== '0') decSep = '';
    else decSep = sep;
  }
  let intPart = s, frac = '';
  if (decSep) { const k = s.lastIndexOf(decSep); intPart = s.slice(0, k); frac = s.slice(k + 1); }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(frac) || (decSep && frac === '')) return NaN;
  const v = Number((intPart || '0') + (frac ? '.' + frac : ''));
  return isFinite(v) ? (neg ? -v : v) : NaN;
}

/** Data z tekstu → 'RRRR-MM-DD' ('' gdy nie rozpoznano). Obsługa: RRRR-MM-DD, DD-MM-RRRR, DD.MM.RRRR, DD/MM/RRRR, RRRR/MM/DD, RRRRMMDD (+ godzina). */
export function parseDate(raw) {
  const s = String(raw == null ? '' : raw).trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/.exec(s);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else return '';
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// Role kolumn → znormalizowane nazwy nagłówków (w kolejności ważności)
const ROLE = {
  date: ['data ksiegowania', 'data operacji', 'data transakcji', 'data waluty', 'data rozliczenia', 'data'],
  amount: ['kwota', 'kwota operacji', 'kwota transakcji (waluta rachunku)', 'kwota transakcji', 'kwota w walucie rachunku', 'wartosc'],
  credit: ['uznania', 'wplyw', 'wplywy', 'ma'],
  debit: ['obciazenia', 'wydatek', 'wydatki', 'winien'],
  title: ['tytul', 'tytulem', 'tytul operacji', 'tytul przelewu', 'opis', 'szczegoly', 'opis transakcji'],
  party: ['nadawca/odbiorca', 'dane kontrahenta', 'nazwa nadawcy/odbiorcy', 'odbiorca/zleceniodawca', 'zleceniodawca', 'kontrahent', 'nazwa kontrahenta', 'nazwa nadawcy', 'nadawca', 'dane nadawcy/odbiorcy'],
  account: ['numer konta', 'nr rachunku', 'rachunek nadawcy/odbiorcy', 'rachunek zrodlowy', 'rachunek nadawcy', 'na konto/z konta', 'numer rachunku'],
  desc: ['opis operacji', 'typ transakcji', 'rodzaj transakcji', 'typ operacji'],
};

/** Rozpoznanie banku po znormalizowanych nagłówkach (zbiór). Zwraca klucz z BANKS albo ''. */
export function detectBank(headersRaw) {
  const raw = headersRaw.map(h => String(h || '').trim().toLowerCase());
  const h = new Set(headersRaw.map(normHeader));
  const has = (...k) => k.every(x => h.has(x));
  if (raw.some(x => x.startsWith('#')) && has('data ksiegowania') && (has('tytul') || has('opis operacji'))) return 'mbank';
  if (has('typ transakcji', 'saldo po transakcji') && (has('opis transakcji') || has('data waluty'))) return 'pko';
  if (has('dane kontrahenta') && (has('nr rachunku') || has('nr transakcji') || has('szczegoly'))) return 'ing';
  if (has('uznania', 'obciazenia')) return 'millennium';
  if (has('tytulem', 'kwota operacji') || has('rachunek zrodlowy', 'rachunek docelowy')) return 'pekao';
  if (has('nadawca/odbiorca', 'data ksiegowania') && (has('kwota') || has('numer konta') || has('opis operacji'))) return 'santander';
  return '';
}

/** Wiersz nagłówka: pierwszy wiersz, w którym rozpoznano bank, a w razie braku — z rolami data+kwota (lub uznania), w pierwszych 40 wierszach. */
function findHeader(rows) {
  const lim = Math.min(rows.length, 40);
  for (let i = 0; i < lim; i++) { const b = detectBank(rows[i]); if (b) return { index: i, bank: b }; }
  for (let i = 0; i < lim; i++) {
    const h = new Set(rows[i].map(normHeader));
    const any = k => ROLE[k].some(x => h.has(x));
    if (any('date') && (any('amount') || any('credit')) && rows[i].length >= 3) return { index: i, bank: '' };
  }
  return { index: -1, bank: '' };
}

function colIndex(headers, names) {
  const norm = headers.map(normHeader);
  for (const n of names) { const i = norm.indexOf(n); if (i >= 0) return i; }
  return -1;
}
function autoMapping(headers, bank) {
  const m = {};
  for (const role of Object.keys(ROLE)) m[role] = colIndex(headers, ROLE[role]);
  // mBank: „Opis operacji” to rodzaj operacji, tytuł jest w „Tytuł”; ING: „Szczegóły” bywa pusty — tytuł zostaje w „Tytuł”
  if (bank === 'pko') m.title = headers.findIndex(h => normHeader(h) === 'opis transakcji');
  if (m.amount < 0 && m.credit < 0) m.amount = headers.findIndex(h => /^kwota/.test(normHeader(h)));
  return m;
}

const cell = (r, i) => (i >= 0 && i < r.length ? String(r[i] == null ? '' : r[i]).replace(/\s+/g, ' ').trim() : '');

// PKO BP: opis transakcji bywa rozbity na kolejne kolumny „Rachunek nadawcy: … Nazwa nadawcy: … Tytuł: …”
function pkoText(r, from) {
  const joined = r.slice(from).map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
  const get = label => { const m = new RegExp(label + '\\s*:\\s*(.*?)(?=\\s+(?:Rachunek nadawcy|Nazwa nadawcy|Adres nadawcy|Rachunek odbiorcy|Nazwa odbiorcy|Adres odbiorcy|Tytu[łl]|Lokalizacja|Operacja|Numer referencyjny|Data i czas operacji)\\s*:|$)', 'i').exec(joined); return m ? m[1].trim() : ''; };
  return { title: get('Tytu[łl]') || joined, party: get('Nazwa nadawcy') || get('Nazwa odbiorcy'), account: get('Rachunek nadawcy') || get('Rachunek odbiorcy') };
}

/**
 * Parsuje wyciąg. input: tekst albo bajty. opts: { mapping: {date, amount, credit, debit, title, party, account, desc} (indeksy kolumn), headerRow, decimal, separator }.
 * Wynik: { encoding, separator, bank, headerRow, headers, mapping, needsMapping, txs: [{ i, date, amount, title, party, account, desc }], skipped: { debits, invalid }, rows }.
 * Do listy trafiają tylko WPŁYWY (kwota > 0); obciążenia są pomijane i liczone w skipped.debits.
 */
export function parseStatement(input, opts = {}) {
  const dec = typeof input === 'string' ? { text: input.replace(/^﻿/, ''), encoding: 'tekst' } : decodeBytes(input);
  const separator = opts.separator || detectSeparator(dec.text);
  const rows = parseCsv(dec.text, separator);
  let { index, bank } = opts.headerRow != null ? { index: opts.headerRow, bank: detectBank(rows[opts.headerRow] || []) } : findHeader(rows);
  const out = { encoding: dec.encoding, separator, bank, headerRow: index, headers: [], mapping: null, needsMapping: false, txs: [], skipped: { debits: 0, invalid: 0 }, rows };
  if (index < 0) {
    // brak rozpoznanego nagłówka: zgadujemy wiersz z największą liczbą niepustych komórek wśród pierwszych 15
    let best = 0, bi = 0; rows.slice(0, 15).forEach((r, i) => { const n = r.filter(x => String(x).trim()).length; if (n > best) { best = n; bi = i; } });
    out.headerRow = bi; out.headers = rows[bi] || []; out.needsMapping = true; out.bank = 'generic';
    if (!opts.mapping) return out;
    index = bi;
  }
  const headers = rows[index] || [];
  out.headers = headers;
  const mapping = opts.mapping || autoMapping(headers, bank);
  out.mapping = mapping;
  const hasAmount = mapping.amount >= 0 || mapping.credit >= 0;
  if (mapping.date < 0 || !hasAmount) { out.needsMapping = true; if (!out.bank) out.bank = 'generic'; return out; }
  if (!out.bank) out.bank = 'generic';
  const dm = opts.decimal || 'auto';
  rows.slice(index + 1).forEach((r, k) => {
    if (r.length < 3) return;
    let amount = NaN;
    if (mapping.credit >= 0 || mapping.debit >= 0) {
      const cr = parseAmount(cell(r, mapping.credit), dm), db = parseAmount(cell(r, mapping.debit), dm);
      if (isFinite(cr) && cr !== 0) amount = Math.abs(cr);
      else if (isFinite(db) && db !== 0) amount = -Math.abs(db);
      else if (mapping.amount >= 0) amount = parseAmount(cell(r, mapping.amount), dm);
    } else amount = parseAmount(cell(r, mapping.amount), dm);
    const date = parseDate(cell(r, mapping.date));
    if (!isFinite(amount) || !date) { if (r.some(x => String(x).trim())) out.skipped.invalid++; return; }
    if (amount <= 0) { out.skipped.debits++; return; }
    let title = cell(r, mapping.title), party = cell(r, mapping.party), account = cell(r, mapping.account);
    if (bank === 'pko' && !opts.mapping) { const t = pkoText(r, Math.max(0, mapping.title)); title = t.title; party = party || t.party; account = account || t.account; }
    // Millennium trzyma nazwę kontrahenta w „Odbiorca/Zleceniodawca”, a „Na konto/Z konta” to numer rachunku — role już rozdzielone
    out.txs.push({ i: index + 1 + k, date, amount: Math.round(amount * 100) / 100, title, party, account, desc: cell(r, mapping.desc) });
  });
  return out;
}
