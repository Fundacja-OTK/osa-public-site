// Import wpłat bankowych — parser wyciągów CSV (czysta logika, działa w przeglądarce i w Node; bez sieci i bez zapisu czegokolwiek).
// Wyciąg zawiera dane osobowe, więc jest przetwarzany WYŁĄCZNIE lokalnie: nic stąd nie jest wysyłane ani logowane.
// Obsługa: kodowanie (UTF-8 / Windows-1250), separator (; , tabulator |), przecinek dziesiętny, wiersze opisowe przed nagłówkiem,
// rozpoznanie banku po nagłówkach (mBank, PKO BP, ING, Santander, Millennium, Pekao) oraz ręczne mapowanie kolumn dla innych formatów.

export const BANKS = {
  mbank: 'mBank', pko: 'PKO BP', ing: 'ING', santander: 'Santander', millennium: 'Millennium', pekao: 'Pekao',
  alior: 'Alior Bank', bnp: 'BNP Paribas', ca: 'Credit Agricole', nest: 'Nest Bank', velo: 'VeloBank', revolut: 'Revolut', wise: 'Wise',
  generic: 'Inny bank (ręczne mapowanie)',
};

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, ODD = /[±¶¼¦¬«»ˇ˘šťžŠŤŽ¤§©®°Ľľ]/g;
/** Tekst z bajtów: UTF-8 (z BOM lub bez), UTF-16 (BOM), a w innym razie Windows-1250 albo ISO-8859-2 (wybór po liczbie polskich liter). */
export function decodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && ((u8[0] === 0xFF && u8[1] === 0xFE) || (u8[0] === 0xFE && u8[1] === 0xFF))) {
    try { return { text: new TextDecoder(u8[0] === 0xFF ? 'utf-16le' : 'utf-16be').decode(u8).replace(/^﻿/, ''), encoding: 'UTF-16' }; } catch (e) { /* dalej */ }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return { text: text.replace(/^﻿/, ''), encoding: 'UTF-8' };
  } catch (e) { /* nie UTF-8 */ }
  const cands = [];
  for (const [label, name] of [['windows-1250', 'Windows-1250'], ['iso-8859-2', 'ISO-8859-2']]) {
    try { const t = new TextDecoder(label).decode(u8); cands.push({ text: t, encoding: name, score: (t.match(POLISH) || []).length - 2 * (t.match(ODD) || []).length }); } catch (e) { /* brak dekodera */ }
  }
  if (!cands.length) return { text: Array.from(u8, c => String.fromCharCode(c)).join(''), encoding: 'Windows-1250' };
  cands.sort((x, y) => y.score - x.score);
  return { text: cands[0].text, encoding: cands[0].encoding };
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
  else if ((m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2})(?!\d)/.exec(s))) { d = +m[1]; mo = +m[2]; y = 2000 + +m[3]; }
  else return '';
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}


// ─── Role kolumn: słownik synonimów (PL + EN), wzorce na znormalizowanych nagłówkach, w kolejności ważności ───
export const ROLES = ['date', 'credit', 'debit', 'amount', 'party', 'account', 'title', 'desc', 'currency', 'status'];
const ROLE = {
  date: [/^data ksiegowania/, /^(booking|posting) date/, /^data zaksiegowania/, /^completed date/, /^data operacji/, /^data transakcji/, /^transaction date/, /^data rozliczenia/, /^data (zlecenia|realizacji|obciazenia|uznania)/, /^data waluty/, /^value date/, /^started date/, /^data$/, /^date$/, /^data\b/, /^date\b/],
  credit: [/^(kwota )?(uznania|uznanie)$/, /^(wplyw|wplywy|przychod|przychody)$/, /^ma$/, /^(credit|paid in|money in)$/],
  debit: [/^(kwota )?(obciazenia|obciazenie)$/, /^(wydatek|wydatki|rozchod|rozchody|winien)$/, /^(debit|paid out|money out)$/],
  amount: [/^kwota( operacji| transakcji)?( \(.*\))?$/, /^kwota w walucie rachunku/, /^kwota transakcji/, /^kwota\b(?!.*(waluc|oryginal|prowizj|oplat))/, /^wartosc( transakcji| operacji)?$/, /^amount$/, /^amount\b(?!.*(fee|orig))/, /^kwota/],
  party: [/^nadawca\/odbiorca$/, /^dane (nadawcy|kontrahenta|przeciwnej strony|nadawcy\/odbiorcy)/, /^nazwa (nadawcy|kontrahenta|platnika|odbiorcy)/, /^(odbiorca\/zleceniodawca|zleceniodawca\/odbiorca)$/, /^(nadawca|zleceniodawca|platnik|kontrahent|odbiorca)\b/, /^(payer|sender|counterparty|beneficiary|merchant|payee)( name)?$/, /^nazwa/, /^(payer|sender|counterparty)\b/],
  account: [/^(numer|nr) (rachunku|konta)( nadawcy| kontrahenta| zrodlowy| przeciwnej strony)?$/, /^rachunek (nadawcy|kontrahenta|zrodlowy|przeciwnej strony|nadawcy\/odbiorcy)/, /^(na konto\/z konta|z konta|numer konta)$/, /^(counterparty |payer |sender )?(iban|account number|account no)/, /^iban/, /^rachunek$/, /^(konto|numer rachunku)\b/],
  title: [/^tytul( operacji| przelewu| platnosci)?$/, /^tytulem$/, /^(payment )?reference$/, /^opis transakcji$/, /^szczegoly( transakcji| operacji)?$/, /^(opis|description|details|remittance|memo|narrative|message|tresc)\b/, /^tytul/, /^payment reference/],
  desc: [/^opis operacji$/, /^(typ|rodzaj) (operacji|transakcji)$/, /^(type|transaction type|kategoria)$/],
  currency: [/^waluta( operacji| transakcji)?$/, /^(currency|ccy)$/],
  status: [/^(status|state|stan)( operacji| transakcji)?$/],
};
const BALANCE = /^saldo|^balance|saldo po|running balance/;

// Presety znanych banków — wykrywane po zestawie nagłówków. NIEZWERYFIKOWANE: układy kolumn spisane z pamięci według publicznie opisanych
// eksportów CSV (mogą się różnić między wersjami bankowości); służą tylko do zwiększenia pewności — parser ogólny działa bez nich.
const PRESETS = [
  { key: 'mbank', sig: h => h.raw.some(x => x.startsWith('#')) && h.has('data ksiegowania') && (h.has('tytul') || h.has('opis operacji')) },
  { key: 'pko', sig: h => h.has('typ transakcji', 'saldo po transakcji') && (h.has('opis transakcji') || h.has('data waluty')) },
  { key: 'ing', sig: h => h.has('dane kontrahenta') && (h.has('nr rachunku') || h.has('nr transakcji') || h.has('szczegoly')) },
  { key: 'millennium', sig: h => h.has('uznania', 'obciazenia') },
  { key: 'revolut', sig: h => h.has('started date', 'completed date') && h.has('amount') },
  { key: 'wise', sig: h => h.has('transferwise id') || h.has('payer name', 'payment reference') },
  { key: 'alior', sig: h => h.has('data ksiegowania', 'kwota') && (h.has('adres nadawcy/odbiorcy') || h.has('typ operacji', 'kategoria')) },
  { key: 'bnp', sig: h => h.has('rodzaj transakcji', 'rachunek kontrahenta') || h.has('nazwa kontrahenta/opis') },
  { key: 'velo', sig: h => h.has('data ksiegowania', 'kwota') && h.has('rachunek nadawcy/odbiorcy') },
  { key: 'nest', sig: h => h.has('data ksiegowania', 'nazwa kontrahenta', 'kwota') && h.has('opis') },
  { key: 'ca', sig: h => h.has('data ksiegowania', 'data operacji', 'kwota') && h.has('opis operacji') && h.has('rachunek') },
  { key: 'pekao', sig: h => h.has('tytulem', 'kwota operacji') || h.has('rachunek zrodlowy', 'rachunek docelowy') },
  { key: 'santander', sig: h => h.has('nadawca/odbiorca', 'data ksiegowania') && (h.has('kwota') || h.has('numer konta') || h.has('opis operacji')) },
];

/** Rozpoznanie banku po nagłówkach. Zwraca klucz z BANKS albo ''. */
export function detectBank(headersRaw) {
  const raw = headersRaw.map(h => String(h || '').trim().toLowerCase());
  const set = new Set(headersRaw.map(normHeader));
  const h = { raw, has: (...k) => k.every(x => set.has(x)) };
  for (const p of PRESETS) if (p.sig(h)) return p.key;
  return '';
}

/** Mapowanie ról na indeksy kolumn wg słownika synonimów (każda kolumna tylko raz). */
export function autoMapping(headers, bank) {
  const norm = headers.map(normHeader), used = new Set(), m = {};
  for (const role of ROLES) {
    m[role] = -1;
    for (const re of ROLE[role]) {
      const i = norm.findIndex((h, k) => !used.has(k) && h && re.test(h) && !(role !== 'date' && BALANCE.test(h)));
      if (i >= 0) { m[role] = i; used.add(i); break; }
    }
  }
  // PKO: tytuł i dane kontrahenta są w „Opis transakcji” (kolejne kolumny); „Typ transakcji” to rodzaj
  if (bank === 'pko') { const i = norm.indexOf('opis transakcji'); if (i >= 0) m.title = i; }
  // brak osobnego „Tytułu” — opis operacji pełni jego rolę
  if (m.title < 0 && m.desc >= 0) { m.title = m.desc; m.desc = -1; }
  return m;
}

/** Skrót nagłówków — klucz zapamiętanego mapowania (nie zawiera żadnych danych z wierszy). */
export function headerSignature(headers) {
  const s = headers.map(normHeader).join('|'); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return 'h' + headers.length + '-' + h.toString(36);
}

const isNum = v => /^[+\-−(]?[\d\s.,]*\d[\d\s.,]*[-)]?\s*(PLN|zł)?$/i.test(String(v).trim()) && isFinite(parseAmount(v));
const cell = (r, i) => (i >= 0 && i < r.length ? String(r[i] == null ? '' : r[i]).replace(/\s+/g, ' ').trim() : '');
const SUMMARY = /^(suma|razem|total|podsumowanie|saldo|sum|obroty|liczba)\b/i;
const BAD_STATE = /reverted|declined|failed|cancel|pending|odrzucon|anulowan|oczekuj|niezrealizowan/i;

/** Maskowanie komórki do podglądu: litery → pierwsze litery słów, cyfry w tekście/rachunkach → „#”; daty i kwoty zostają. */
export function maskCell(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (parseDate(s) && /^[\d\s.:\-/T]+$/.test(s)) return s;
  if (isNum(s) && s.replace(/\D/g, '').length < 12 && !/^[A-Za-z]{2}\d/.test(s)) return s;
  if (s.replace(/\D/g, '').length >= 12 && !/[a-ząćęłńóśźż]{3}/i.test(s)) return s.replace(/\d/g, '#');
  return s.split(' ').map(w => {
    const L = w.replace(/[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '');
    return (L ? L[0] + '•••'.slice(0, Math.min(3, L.length - 1)) : '') + (/\d/.test(w) ? '#' : '');
  }).join(' ');
}

/** Podpowiedź mapowania na podstawie zawartości kolumn (do wstępnego zaznaczenia w formularzu; nie jest stosowana automatycznie). */
export function suggestMapping(rows, headerRow) {
  const data = rows.slice(headerRow + 1, headerRow + 61).filter(r => r.length >= 2);
  const width = Math.max(0, ...rows.slice(headerRow, headerRow + 20).map(r => r.length));
  const m = { date: -1, amount: -1, credit: -1, debit: -1, title: -1, party: -1, account: -1, desc: -1, currency: -1, status: -1 };
  if (!data.length) return m;
  const st = [];
  for (let c = 0; c < width; c++) {
    const vals = data.map(r => cell(r, c)).filter(Boolean), n = vals.length || 1;
    st.push({ c, n: vals.length,
      date: vals.filter(v => parseDate(v)).length / n,
      num: vals.filter(v => isNum(v) && !parseDate(v) && v.replace(/\D/g, '').length < 12).length / n,
      acct: vals.filter(v => v.replace(/\D/g, '').length >= 15 && !/[a-ząćęłńóśźż]{3}/i.test(v)).length / n,
      len: vals.reduce((a, v) => a + v.length, 0) / n, upper: vals.filter(v => v === v.toUpperCase() && /[A-Z]/.test(v)).length / n });
  }
  const used = new Set();
  const pick = (f, min) => { const b = st.filter(x => x.n && !used.has(x.c) && f(x) >= min).sort((a, b2) => f(b2) - f(a) || a.c - b2.c)[0]; if (b) used.add(b.c); return b ? b.c : -1; };
  m.date = pick(x => x.date, 0.6);
  m.account = pick(x => x.acct, 0.6);
  const hdr = rows[headerRow] || [];
  const nums = st.filter(x => x.num >= 0.6 && !used.has(x.c) && !BALANCE.test(normHeader(hdr[x.c])));
  if (nums.length) { m.amount = nums[0].c; used.add(nums[0].c); }
  m.party = pick(x => (x.len >= 4 && x.len <= 45 && x.date < 0.3 && x.num < 0.3 ? x.upper + 0.5 : 0), 0.5);
  m.title = pick(x => (x.date < 0.3 && x.num < 0.3 ? x.len : 0), 6);
  return m;
}

/** Zapamiętane mapowania (localStorage przekazywany z zewnątrz: { getItem, setItem }); wszystko w try/catch. */
export const MAP_KEY = 'osa-wplaty-mapy';
export function loadMapping(sig, st) { try { const o = JSON.parse(st.getItem(MAP_KEY) || '{}'); return o && o[sig] ? o[sig] : null; } catch (e) { return null; } }
export function saveMapping(sig, rec, st) {
  try { const o = JSON.parse(st.getItem(MAP_KEY) || '{}') || {}; o[sig] = rec; const keys = Object.keys(o); if (keys.length > 40) delete o[keys[0]]; st.setItem(MAP_KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
}

// PKO BP: opis transakcji bywa rozbity na kolejne kolumny „Rachunek nadawcy: … Nazwa nadawcy: … Tytuł: …”
function pkoText(r, from) {
  const joined = r.slice(from).map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
  const get = label => { const m = new RegExp(label + '\\s*:\\s*(.*?)(?=\\s+(?:Rachunek nadawcy|Nazwa nadawcy|Adres nadawcy|Rachunek odbiorcy|Nazwa odbiorcy|Adres odbiorcy|Tytu[łl]|Lokalizacja|Operacja|Numer referencyjny|Data i czas operacji)\\s*:|$)', 'i').exec(joined); return m ? m[1].trim() : ''; };
  return { title: get('Tytu[łl]') || joined, party: get('Nazwa nadawcy') || get('Nazwa odbiorcy'), account: get('Rachunek nadawcy') || get('Rachunek odbiorcy') };
}

/** Wiersz nagłówka: preset banku, a w razie braku wiersz z rolami data + kwota/uznania (pierwsze 60 wierszy). */
function findHeader(rows) {
  const lim = Math.min(rows.length, 60);
  for (let i = 0; i < lim; i++) { const b = detectBank(rows[i]); if (b) return { index: i, bank: b }; }
  for (let i = 0; i < lim; i++) {
    if (rows[i].length < 3) continue;
    const m = autoMapping(rows[i], '');
    if (m.date >= 0 && (m.amount >= 0 || m.credit >= 0)) return { index: i, bank: '' };
  }
  return { index: -1, bank: '' };
}

/** Zgadnięcie wiersza nagłówka bez rozpoznania: wiersz tuż przed pierwszym wierszem z datą i liczbą; inaczej najszerszy z pierwszych 15. */
function guessHeader(rows) {
  for (let j = 0; j < Math.min(rows.length, 80); j++) {
    const r = rows[j];
    if (r.length >= 3 && r.some(c => parseDate(c)) && r.some(c => { const v = String(c).trim(); return v && !parseDate(v) && isNum(v); })) {
      if (j > 0 && rows[j - 1].length >= 3 && !rows[j - 1].some(c => parseDate(c))) return j - 1;
      break;
    }
  }
  let best = 0, bi = 0; rows.slice(0, 15).forEach((r, i) => { const n = r.filter(x => String(x).trim()).length; if (n > best) { best = n; bi = i; } });
  return bi;
}

const emptySkips = () => ({ debits: 0, invalid: 0, summary: 0, foreign: 0, status: 0, zero: 0 });

/**
 * Parsuje wyciąg CSV/TXT. input: tekst albo bajty. opts: { mapping, headerRow, decimal, separator }.
 * Wynik: { format:'csv', encoding, separator, bank, confidence ('preset'|'auto'|'manual'|'none'), headerRow, headers, signature, mapping,
 *   needsMapping, suggest, sample (3 zamaskowane wiersze), txs, skipped:{debits,invalid,summary,foreign,status,zero}, total, rows }.
 * Do listy trafiają tylko WPŁYWY w PLN (kwota > 0); reszta jest pomijana i liczona w skipped.
 */
export function parseStatement(input, opts = {}) {
  const dec = typeof input === 'string' ? { text: input.replace(/^﻿/, ''), encoding: 'tekst' } : decodeBytes(input);
  const separator = opts.separator || detectSeparator(dec.text);
  const rows = parseCsv(dec.text, separator);
  let { index, bank } = opts.headerRow != null ? { index: opts.headerRow, bank: detectBank(rows[opts.headerRow] || []) } : findHeader(rows);
  const out = { format: 'csv', encoding: dec.encoding, separator, bank, confidence: bank ? 'preset' : 'none', headerRow: index, headers: [], signature: '', mapping: null, needsMapping: false, suggest: null, sample: [], txs: [], skipped: emptySkips(), total: 0, rows };
  const needMap = hdrIdx => {
    out.needsMapping = true; out.bank = out.bank || 'generic'; out.confidence = 'none';
    out.suggest = suggestMapping(rows, hdrIdx); out.sample = rows.slice(hdrIdx + 1, hdrIdx + 4).map(r => r.map(maskCell));
  };
  if (index < 0) {
    const bi = guessHeader(rows);
    out.headerRow = bi; out.headers = rows[bi] || []; out.signature = headerSignature(out.headers); out.bank = 'generic';
    if (!opts.mapping) { needMap(bi); return out; }
    index = bi;
  }
  const headers = rows[index] || [];
  out.headers = headers; out.signature = headerSignature(headers);
  const mapping = Object.assign({ date: -1, amount: -1, credit: -1, debit: -1, title: -1, party: -1, account: -1, desc: -1, currency: -1, status: -1 }, opts.mapping || autoMapping(headers, bank));
  out.mapping = mapping;
  if (opts.mapping) out.confidence = 'manual'; else if (!bank) out.confidence = 'auto';
  if (!out.bank) out.bank = 'generic';
  if (mapping.date < 0 || (mapping.amount < 0 && mapping.credit < 0)) { needMap(index); return out; }
  const dm = opts.decimal || 'auto', sk = out.skipped;
  let valid = 0, tried = 0;
  rows.slice(index + 1).forEach((r, k) => {
    const nonEmpty = r.some(x => String(x).trim());
    let amount = NaN;
    if (mapping.credit >= 0 || mapping.debit >= 0) {
      const cr = parseAmount(cell(r, mapping.credit), dm), db = parseAmount(cell(r, mapping.debit), dm);
      if (isFinite(cr) && cr !== 0) amount = Math.abs(cr);
      else if (isFinite(db) && db !== 0) amount = -Math.abs(db);
      else if (mapping.amount >= 0) amount = parseAmount(cell(r, mapping.amount), dm);
      else if (isFinite(cr) || isFinite(db)) amount = 0;
    } else amount = parseAmount(cell(r, mapping.amount), dm);
    const date = parseDate(cell(r, mapping.date));
    if (!isFinite(amount) || !date) {
      if (!nonEmpty) return;
      // wiersz bez daty: podsumowanie / stopka / powtórzony nagłówek / opis — nie licz jako błąd danych
      if (!date && (r.some(x => SUMMARY.test(String(x).trim())) || !r.some(c => parseDate(c) || isNum(c)))) sk.summary++; else { sk.invalid++; tried++; }
      return;
    }
    tried++; valid++; out.total++;
    if (mapping.status >= 0 && BAD_STATE.test(cell(r, mapping.status))) { sk.status++; return; }
    if (amount < 0) { sk.debits++; return; }
    if (amount === 0) { sk.zero++; return; }
    const ccy = cell(r, mapping.currency).toUpperCase();
    if (ccy && ccy !== 'PLN' && ccy !== 'ZŁ') { sk.foreign++; return; }
    let title = cell(r, mapping.title), party = cell(r, mapping.party), account = cell(r, mapping.account);
    if (bank === 'pko' && !opts.mapping) { const t = pkoText(r, Math.max(0, mapping.title)); title = t.title; party = party || t.party; account = account || t.account; }
    out.txs.push({ i: index + 1 + k, date, amount: Math.round(amount * 100) / 100, title, party, account, desc: cell(r, mapping.desc) });
  });
  // sprawdzenie sensowności: jeśli prawie żaden wiersz się nie sparsował, a mapowanie było automatyczne — poproś o wskazanie kolumn
  if (!opts.mapping && tried >= 3 && valid / tried < 0.5) { needMap(index); out.txs = []; out.total = 0; out.skipped = emptySkips(); }
  return out;
}
