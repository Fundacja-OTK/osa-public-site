// Import klientów z pliku CSV — czysta logika (bez DOM i bez sieci; działa w przeglądarce i w Node).
// Plik zawiera dane osobowe, więc jest czytany WYŁĄCZNIE w przeglądarce: nic stąd nie jest wysyłane ani logowane.
// Do serwera panelu trafiają tylko: lista adresów e-mail (sprawdzenie duplikatów, clients:emailsExist — odczyt kopii, bez Selly)
// i — dopiero po potwierdzeniu — pojedyncze, sprawdzone rekordy (clients:create z kluczem idempotencji opId).
// Parser CSV, kodowanie i nagłówki: wspólne z importem wpłat (wplatyCsv.js). Walidatory: wspólne z formularzem klienta (klienciValid.js).
import { decodeBytes, detectSeparator, parseCsv, normHeader, headerSignature } from './wplatyCsv.js?v=5a4d554';
import { nipError, postcodeError, emailError, phoneError, fixPostcode } from './klienciValid.js?v=5a4d554';

export { headerSignature };
export const MAX_ROWS = 1000;                // jeden import; większe pliki — podziel (przy limicie API to i tak ~35 minut)
export const MAX_BYTES = 5 * 1024 * 1024;
export const EMAILS_PER_CHECK = 500;         // clients:emailsExist przyjmuje najwyżej 500 adresów naraz
// Tempo zapisu: Selly ma ~500 zapytań/min wspólne dla całego panelu i synchronizacji. Dodanie klienta = 1–2 zapytania (POST + ewentualny
// odczyt rekordu), zmiana grupy = 1–2 (PUT + ewentualny odczyt). Przerwy poniżej trzymają import ≤ ~60, a zmianę grup ≤ ~100 zapytań/min.
export const IMPORT_GAP_MS = 2000;
export const GROUP_GAP_MS = 1200;
export const MAX_FAILS_IN_ROW = 3;           // tyle błędów z rzędu = wstrzymanie (np. limit API, wylogowanie, awaria) — reszta czeka na „Wznów”

const L = s => normHeader(s);
/** Pola importu: klucz pola klienta w Selly (jak w clients:create), etykieta, wymagane, limit długości, nazwy kolumn rozpoznawane automatycznie. */
export const FIELDS = [
  { key: 'first_name', label: 'Imię', req: 1, max: 100, names: ['imie', 'first name', 'firstname', 'imie klienta', 'given name'] },
  { key: 'last_name', label: 'Nazwisko', req: 1, max: 100, names: ['nazwisko', 'last name', 'lastname', 'surname', 'nazwisko klienta', 'family name'] },
  { key: 'full_name', label: 'Imię i nazwisko (jedna kolumna)', max: 200, virtual: 1, tip: 'Gdy plik ma imię i nazwisko w jednej kolumnie: ostatni wyraz trafi do nazwiska, reszta do imienia.',
    names: ['imie i nazwisko', 'imie nazwisko', 'nazwisko i imie', 'klient', 'osoba', 'name', 'full name', 'osoba kontaktowa', 'nazwa klienta'] },
  { key: 'email', label: 'E-mail', req: 1, max: 150, names: ['e-mail', 'email', 'adres e-mail', 'adres email', 'mail', 'e mail', 'login', 'email address'] },
  { key: 'phone', label: 'Telefon', req: 1, max: 30, names: ['telefon', 'tel', 'tel.', 'phone', 'nr telefonu', 'numer telefonu', 'komorka', 'telefon komorkowy', 'mobile'] },
  { key: 'ship_address', label: 'Adres (ulica i numer)', req: 1, max: 200, names: ['adres', 'ulica', 'ulica i numer', 'address', 'street', 'adres wysylki', 'adres dostawy'] },
  { key: 'ship_postcode', label: 'Kod pocztowy', req: 1, max: 12, names: ['kod pocztowy', 'kod', 'postcode', 'zip', 'zip code', 'kod pocztowy wysylki', 'kod pocztowy dostawy'] },
  { key: 'ship_city', label: 'Miejscowość', req: 1, max: 100, names: ['miejscowosc', 'miasto', 'city', 'miejscowosc wysylki', 'miasto wysylki', 'poczta'] },
  { key: 'country', label: 'Państwo', max: 80, names: ['kraj', 'panstwo', 'country'] },
  { key: 'ship_company', label: 'Firma (adres wysyłki)', max: 150, names: ['firma wysylka', 'firma (wysylka)', 'firma dostawy'] },
  { key: 'invoice_company', label: 'Firma (faktura)', max: 150, names: ['firma', 'nazwa firmy', 'company', 'firma faktura', 'nazwa podmiotu', 'parafia', 'instytucja'] },
  { key: 'invoice_nip', label: 'NIP', max: 20, names: ['nip', 'numer nip', 'nip/vat', 'vat', 'vat id', 'nip faktura'] },
  { key: 'invoice_address', label: 'Adres (faktura)', max: 200, names: ['adres faktury', 'adres do faktury', 'adres faktura'] },
  { key: 'invoice_postcode', label: 'Kod pocztowy (faktura)', max: 12, names: ['kod pocztowy faktury', 'kod faktura', 'kod pocztowy faktura'] },
  { key: 'invoice_city', label: 'Miejscowość (faktura)', max: 100, names: ['miasto faktury', 'miejscowosc faktury', 'miasto faktura', 'miejscowosc faktura'] },
  { key: 'newsletter', label: 'Newsletter (tak/nie)', flag: 1, names: ['newsletter', 'zgoda newsletter', 'zgoda na newsletter'] },
  { key: 'notes', label: 'Notatka', max: 5000, names: ['notatka', 'uwagi', 'notes', 'opis', 'komentarz'] },
  { key: 'group_id', label: 'Grupa (numer)', int: 1, names: ['grupa', 'id grupy', 'nr grupy', 'group', 'group id'] },
];
export const REQUIRED = FIELDS.filter(f => f.req).map(f => f.key);
const BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));
export const labelOf = k => (BY_KEY[k] ? BY_KEY[k].label : k);

// ─── Plik → wiersze ─────────────────────────────────────────────────────────
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const isEmail = v => EMAIL_RE.test(String(v || '').trim());

/**
 * Bajty pliku → { encoding, separator, hasHeader, headers, rows, signature, truncated }. opts: { separator?, hasHeader? (true/false; brak = rozpoznaj) }.
 * Nagłówek rozpoznany, gdy pierwszy wiersz nie zawiera adresu e-mail, a któryś z kolejnych zawiera (albo nazwy kolumn pasują do pól).
 */
export function parseClientsFile(bytes, opts = {}) {
  const { text, encoding } = decodeBytes(bytes);
  const separator = opts.separator || detectSeparator(text);
  const all = parseCsv(text, separator);
  if (!all.length) return { encoding, separator, hasHeader: false, headers: [], rows: [], signature: '', truncated: false };
  let hasHeader = opts.hasHeader;
  if (hasHeader == null) {
    const first = all[0], known = first.filter(h => findField(h)).length;
    hasHeader = known >= 2 || (!first.some(isEmail) && all.slice(1, 6).some(r => r.some(isEmail)));
  }
  const width = Math.max(...all.slice(0, 200).map(r => r.length));
  const headers = hasHeader ? Array.from({ length: width }, (_, i) => String(all[0][i] || '').trim()) : Array.from({ length: width }, (_, i) => 'kolumna ' + (i + 1));
  const body = hasHeader ? all.slice(1) : all;
  return { encoding, separator, hasHeader, headers, rows: body.slice(0, MAX_ROWS), total: body.length, truncated: body.length > MAX_ROWS, signature: hasHeader ? headerSignature(headers) : '' };
}

function findField(header) {
  const h = L(header).replace(/[*:]+$/g, '').trim();
  if (!h) return null;
  return FIELDS.find(f => f.names.includes(h)) || null;
}

/** Zawartość kolumny — podpowiedź pola dla kolumn bez rozpoznanej nazwy (e-mail, kod pocztowy, NIP, telefon). */
function sniff(rows, i) {
  const vals = rows.slice(0, 60).map(r => String(r[i] == null ? '' : r[i]).trim()).filter(Boolean);
  if (vals.length < 2) return null;
  const share = re => vals.filter(v => re(v)).length / vals.length;
  if (share(isEmail) >= 0.6) return 'email';
  if (share(v => /^\d{2}-?\d{3}$/.test(v)) >= 0.8) return 'ship_postcode';
  if (share(v => /^(PL)?[\d\s-]{10,13}$/i.test(v) && !nipError(v, 'Polska')) >= 0.6) return 'invoice_nip';
  if (share(v => /^[+\d][\d\s()./-]{5,24}$/.test(v) && v.replace(/\D/g, '').length >= 9) >= 0.8) return 'phone';
  return null;
}

/** Mapowanie: indeks kolumny → klucz pola ('' = pomiń). Najpierw nazwy kolumn, potem zawartość; każde pole najwyżej raz. */
export function autoMapping(headers, rows) {
  const map = headers.map(() => ''), used = new Set();
  headers.forEach((h, i) => { const f = findField(h); if (f && !used.has(f.key)) { map[i] = f.key; used.add(f.key); } });
  headers.forEach((h, i) => {
    if (map[i]) return;
    const k = sniff(rows, i);
    if (k && !used.has(k)) { map[i] = k; used.add(k); }
  });
  // jedna kolumna „imię i nazwisko” zamiast dwóch — tylko gdy brak osobnych
  if (used.has('full_name') && used.has('first_name') && used.has('last_name')) map[map.indexOf('full_name')] = '';
  return map;
}

/** Brakujące wymagane pola przy danym mapowaniu (imię + nazwisko mogą pochodzić z jednej kolumny). */
export function missingRequired(map) {
  const has = new Set(map.filter(Boolean));
  return REQUIRED.filter(k => !has.has(k) && !((k === 'first_name' || k === 'last_name') && has.has('full_name')));
}

// ─── Wiersze → rekordy (walidacja) ──────────────────────────────────────────
const YES = /^(1|tak|t|yes|y|true|x|prawda|zgoda)$/i;

/**
 * Rekordy do dodania. opts: { country (domyślne państwo), groupId (grupa dla wszystkich; kolumna „Grupa” ma pierwszeństwo) }.
 * → [{ line (numer wiersza w pliku, od 1), fields, errors: [tekst], name, email }]
 */
export function buildRecords(parsed, map, opts = {}) {
  const firstLine = parsed.hasHeader ? 2 : 1;
  return parsed.rows.map((r, n) => {
    const raw = {};
    map.forEach((k, i) => { if (k) { const v = String(r[i] == null ? '' : r[i]).replace(/\s+/g, ' ').trim(); if (v) raw[k] = v; } });
    const f = {}, errors = [];
    for (const [k, v] of Object.entries(raw)) {
      const spec = BY_KEY[k];
      if (spec.virtual) continue;
      if (spec.flag) { f[k] = YES.test(v) ? 1 : 0; continue; }
      if (spec.int) { if (/^\d+$/.test(v)) f[k] = v; else errors.push(spec.label + ': to nie jest numer grupy'); continue; }
      if (v.length > spec.max) errors.push(spec.label + ': za długie (maks. ' + spec.max + ' znaków)');
      f[k] = v;
    }
    if (raw.full_name && (!f.first_name || !f.last_name)) {
      const parts = raw.full_name.split(' ');
      if (parts.length >= 2) { if (!f.last_name) f.last_name = parts.pop(); if (!f.first_name) f.first_name = parts.join(' '); }
      else if (!f.last_name) f.last_name = raw.full_name;
    }
    if (!f.country) f.country = opts.country || 'Polska';
    if (!f.group_id && opts.groupId && /^\d+$/.test(String(opts.groupId))) f.group_id = String(opts.groupId);
    if (f.email) f.email = f.email.toLowerCase();
    for (const k of ['ship_postcode', 'invoice_postcode']) if (f[k]) f[k] = fixPostcode(f[k], f.country);
    for (const k of REQUIRED) if (!f[k]) errors.push('brak: ' + labelOf(k));
    if (f.email) { const e = emailError(f.email); if (e) errors.push('E-mail: nieprawidłowy adres'); }
    if (f.phone) { const e = phoneError(f.phone); if (e) errors.push('Telefon: ' + e.replace(/\.$/, '').toLowerCase()); }
    for (const [k, label] of [['ship_postcode', 'Kod pocztowy'], ['invoice_postcode', 'Kod pocztowy (faktura)']]) if (f[k] && postcodeError(f[k], f.country)) errors.push(label + ': format 00-000');
    if (f.invoice_nip) { const e = nipError(f.invoice_nip, f.country); if (e) errors.push(e.replace(/\.$/, '')); }
    return { line: firstLine + n, fields: f, errors, name: [f.first_name, f.last_name].filter(Boolean).join(' '), email: f.email || '' };
  });
}

/**
 * Podgląd importu (bez żadnego zapisu): status każdego rekordu i podsumowanie.
 * existing: { email → ID klienta } (z clients:emailsExist). Status: 'new' | 'invalid' | 'exists' (już w sklepie) | 'dupFile' (powtórzony w pliku).
 */
export function classify(records, existing) {
  const seen = new Map(), ex = existing || {};
  for (const r of records) {
    r.existingId = '';
    if (r.errors.length) { r.status = 'invalid'; r.reason = r.errors.join('; '); continue; }
    if (ex[r.email]) { r.status = 'exists'; r.existingId = ex[r.email]; r.reason = 'Klient z tym e-mailem już jest w sklepie (ID ' + ex[r.email] + ')'; continue; }
    if (seen.has(r.email)) { r.status = 'dupFile'; r.reason = 'Ten e-mail jest już w wierszu ' + seen.get(r.email) + ' pliku'; continue; }
    seen.set(r.email, r.line); r.status = 'new'; r.reason = '';
  }
  return summary(records);
}

export function summary(records) {
  const s = { total: records.length, new: 0, invalid: 0, exists: 0, dupFile: 0, done: 0, failed: 0 };
  for (const r of records) if (r.status in s) s[r.status]++;
  return s;
}

/** Adresy do sprawdzenia w kopii klientów (bez duplikatów, porcjami po EMAILS_PER_CHECK). */
export function emailChunks(records) {
  const all = [...new Set(records.filter(r => r.email && !r.errors.length).map(r => r.email))];
  const out = [];
  for (let i = 0; i < all.length; i += EMAILS_PER_CHECK) out.push(all.slice(i, i + EMAILS_PER_CHECK));
  return out;
}

export const STATUS_TEXT = { new: 'do dodania', invalid: 'błędne dane', exists: 'już w sklepie', dupFile: 'powtórzony w pliku', done: 'dodany', failed: 'nie udało się', running: 'dodaję…' };

/** Raport błędów (CSV): wiersze, których nie dodano, z powodem i oryginalnymi kolumnami pliku. */
export function errorReport(parsed, records) {
  const first = parsed.hasHeader ? 2 : 1;
  const bad = records.filter(r => r.status !== 'done' && r.status !== 'new');
  return [['Wiersz pliku', 'Status', 'Powód', ...parsed.headers], ...bad.map(r => [String(r.line), STATUS_TEXT[r.status] || r.status, r.reason || '', ...parsed.headers.map((_, i) => String(parsed.rows[r.line - first][i] == null ? '' : parsed.rows[r.line - first][i]))])];
}

/** Wzór pliku: same nagłówki (bez danych). */
export const templateRows = () => [['Imię', 'Nazwisko', 'E-mail', 'Telefon', 'Adres', 'Kod pocztowy', 'Miejscowość', 'Państwo', 'Firma', 'NIP', 'Newsletter', 'Notatka']];

// ─── Wykonanie po kolei, z przerwami (wspólne: import i masowa zmiana grupy) ──────────────────
const realSleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Wykonuje work(item) po kolei, z przerwą gapMs między zapisami. Zatrzymuje się na żądanie (shouldStop) albo po MAX_FAILS_IN_ROW
 * błędach z rzędu (paused: true). onItem(item, result|null, error|null, index). → { done: [...], failed: [{ item, error }], rest: [...], paused, stopped }.
 */
export async function runThrottled(items, work, o = {}) {
  const gap = o.gapMs == null ? IMPORT_GAP_MS : o.gapMs, sleep = o.sleep || realSleep, maxFails = o.maxFails || MAX_FAILS_IN_ROW;
  const done = [], failed = [];
  let inRow = 0;
  for (let i = 0; i < items.length; i++) {
    if (o.shouldStop && o.shouldStop()) return { done, failed, rest: items.slice(i), paused: false, stopped: true };
    if (i > 0 && gap > 0) await sleep(gap);
    if (o.onStart) o.onStart(items[i], i);
    try {
      const res = await work(items[i]);
      done.push(items[i]); inRow = 0;
      if (o.onItem) o.onItem(items[i], res, null, i);
    } catch (e) {
      failed.push({ item: items[i], error: (e && e.message) || 'błąd' }); inRow++;
      if (o.onItem) o.onItem(items[i], null, e, i);
      if (inRow >= maxFails && i < items.length - 1) return { done, failed, rest: items.slice(i + 1), paused: true, stopped: false };
    }
  }
  return { done, failed, rest: [], paused: false, stopped: false };
}

/** Klucz idempotencji jednego rekordu (powtórka po zerwanym połączeniu nie tworzy drugiego klienta). */
export const opIdFor = (runId, line) => 'cli-imp-' + runId + '-' + line;
