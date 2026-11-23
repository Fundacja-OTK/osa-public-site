// Import wpłat bankowych — dopasowanie wpłat do nieopłaconych zamówień (czysta logika, bez sieci).
// Każda wpłata dostaje listę kandydatów z punktacją 0–100 i listą powodów; poziom: pewne / prawdopodobne / brak dopasowania.
// Reguły są konfigurowalne (wagi, progi, tolerancja kwoty) — domyślne wartości i opisy: RULES.

/** Reguły: klucz → { def, min, max, step, label, tip }. Wagi sumują się do maks. 100. */
export const RULES = {
  number: { def: 60, min: 0, max: 100, label: 'Numer zamówienia w tytule', tip: 'Punkty za pełny numer zamówienia (np. 1234/2026) znaleziony w tytule przelewu.' },
  numberPart: { def: 35, min: 0, max: 100, label: 'Sam początek numeru z hasłem', tip: 'Punkty, gdy w tytule jest numer bez roku, ale po słowie „zamówienie”, „zam.”, „nr” lub „#” (np. „zam. 1234”).' },
  numberBare: { def: 15, min: 0, max: 100, label: 'Sama liczba pasująca do numeru', tip: 'Punkty, gdy w tytule jest liczba równa początkowi numeru zamówienia, ale bez żadnego hasła przed nią. Mało pewne — łatwo o przypadek.' },
  amount: { def: 30, min: 0, max: 100, label: 'Kwota zgodna', tip: 'Punkty, gdy kwota wpłaty równa się kwocie do zapłaty (wartość zamówienia minus już zapłacone), z tolerancją poniżej.' },
  amountTotal: { def: 20, min: 0, max: 100, label: 'Kwota równa wartości zamówienia', tip: 'Punkty, gdy kwota równa się pełnej wartości zamówienia, choć część jest już zapłacona.' },
  email: { def: 25, min: 0, max: 100, label: 'E-mail klienta w opisie', tip: 'Punkty, gdy w tytule lub danych płatnika jest adres e-mail klienta z zamówienia.' },
  name: { def: 15, min: 0, max: 100, label: 'Imię i nazwisko / firma', tip: 'Punkty, gdy dane płatnika zawierają imię i nazwisko (lub nazwę firmy) z zamówienia. Samo nazwisko daje połowę punktów.' },
  sure: { def: 85, min: 40, max: 100, label: 'Próg „pewne”', tip: 'Wpłaty z wynikiem co najmniej tyle są zaznaczane do oznaczenia automatycznie. Podnieś, jeśli chcesz zaznaczać mniej.' },
  probable: { def: 30, min: 5, max: 100, label: 'Próg „prawdopodobne”', tip: 'Wpłaty z wynikiem od tego progu są pokazywane jako prawdopodobne (wymagają Twojej decyzji, nie są zaznaczone). Poniżej — „brak dopasowania”.' },
  tolerance: { def: 0.01, min: 0, max: 5, step: 0.01, label: 'Tolerancja kwoty (zł)', tip: 'O ile złotych kwota wpłaty może się różnić od kwoty do zapłaty, żeby nadal uznać ją za zgodną. 0,01 zł zabezpiecza przed błędami zaokrągleń.' },
  ambiguity: { def: 10, min: 0, max: 50, label: 'Różnica do drugiego kandydata', tip: 'Gdy dwa zamówienia mają niemal tyle samo punktów (różnica mniejsza niż ta wartość), wpłata jest tylko „prawdopodobna” — nie wiadomo, które wybrać.' },
};
export const defaultSettings = () => Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.def]));
export function cleanSettings(s) {
  const out = defaultSettings();
  for (const k of Object.keys(RULES)) if (s && s[k] != null && s[k] !== '' && isFinite(Number(s[k]))) out[k] = Math.min(RULES[k].max, Math.max(RULES[k].min, Number(s[k])));
  return out;
}

export const norm = s => String(s == null ? '' : s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const alnum = s => norm(s).replace(/[^a-z0-9@. -]+/g, ' ').replace(/\s+/g, ' ').trim();
const cents = v => Math.round(Number(v) * 100);
const zl = v => Number(v).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;

/** Numer zamówienia: „1234/2026” → { left: '1234', year: '2026' }; sam „1234” → { left: '1234', year: '' }. */
function splitNumber(n) {
  const m = /^\s*(\d+)\s*[/\-.]\s*(\d{2,4})\s*$/.exec(String(n || ''));
  return m ? { left: m[1], year: m[2] } : { left: (String(n || '').match(/\d+/) || [''])[0], year: '' };
}

/** Szukanie numeru zamówienia w tekście: 'full' (pełny numer), 'part' (po haśle), 'bare' (sama liczba), '' (brak). */
export function numberHit(text, number) {
  const { left, year } = splitNumber(number);
  if (!left) return '';
  const t = ' ' + norm(text).replace(/[_]+/g, ' ') + ' ';
  const L = left.replace(/^0+(?=\d)/, '');
  const lead = '(?:^|[^0-9])0*' + L;
  if (year) {
    const yy = year.length === 4 ? '(?:' + year + '|' + year.slice(2) + ')' : year;
    if (new RegExp(lead + '\\s*[/\\-.\\\\]\\s*' + yy + '(?![0-9])').test(t)) return 'full';
  }
  if (new RegExp('(?:zamowieni[a-z]*|zam\\.?|nr\\.?|numer(?:em)?|order|#)\\s*:?\\s*(?:nr\\.?\\s*)?0*' + L + '(?![0-9])').test(t)) return 'part';
  if (new RegExp(lead + '(?![0-9]|\\s*[,.]\\s*[0-9])').test(t) && L.length >= 3) return 'bare';
  return '';
}

function nameHit(text, o) {
  const t = ' ' + alnum(text) + ' ';
  const has = w => w && w.length >= 3 && t.includes(' ' + w + ' ') || (w && w.length >= 3 && t.includes(w));
  const people = [[o.firstName, o.lastName], [o.shipFirstName, o.shipLastName]];
  for (const [f, l] of people) {
    const fn = alnum(f), ln = alnum(l);
    if (ln && fn && has(ln) && has(fn)) return 'full';
  }
  const co = alnum(o.company);
  if (co.length >= 4 && t.includes(co)) return 'full';
  for (const [, l] of people) { const ln = alnum(l); if (ln.length >= 3 && has(ln)) return 'part'; }
  return '';
}

/** Punktacja jednej pary wpłata × zamówienie. */
export function scorePair(tx, o, S) {
  const reasons = []; let score = 0;
  const text = [tx.title, tx.desc].join(' ');
  const payer = [tx.party, tx.title].join(' ');
  const nh = numberHit(text, o.number);
  if (nh === 'full') { score += S.number; reasons.push({ k: 'number', t: 'numer zamówienia ' + o.number + ' w tytule', pts: S.number }); }
  else if (nh === 'part') { score += S.numberPart; reasons.push({ k: 'number', t: 'numer zamówienia po haśle „zamówienie / nr” (bez roku)', pts: S.numberPart }); }
  else if (nh === 'bare') { score += S.numberBare; reasons.push({ k: 'number', t: 'w tytule jest liczba z numeru zamówienia (bez hasła)', pts: S.numberBare }); }
  const due = Math.max(0, Number(o.total) - Number(o.paid || 0));
  const tol = Math.round(S.tolerance * 100);
  let amountState = 'none';
  if (Math.abs(cents(tx.amount) - cents(due)) <= tol) { score += S.amount; amountState = 'due'; reasons.push({ k: 'amount', t: 'kwota ' + zl(tx.amount) + ' = do zapłaty', pts: S.amount }); }
  else if (Number(o.paid) > 0 && Math.abs(cents(tx.amount) - cents(o.total)) <= tol) { score += S.amountTotal; amountState = 'total'; reasons.push({ k: 'amount', t: 'kwota równa wartości zamówienia (część już zapłacona)', pts: S.amountTotal }); }
  else if (cents(tx.amount) < cents(due)) { amountState = 'less'; reasons.push({ k: 'amount', t: 'wpłata ' + zl(tx.amount) + ' jest mniejsza niż do zapłaty ' + zl(due), pts: 0, warn: true }); }
  else { amountState = 'more'; reasons.push({ k: 'amount', t: 'wpłata ' + zl(tx.amount) + ' jest większa niż do zapłaty ' + zl(due), pts: 0, warn: true }); }
  if (o.email) {
    const em = norm(o.email);
    if (em && (' ' + norm(payer + ' ' + tx.desc) + ' ').includes(em)) { score += S.email; reasons.push({ k: 'email', t: 'e-mail klienta w opisie', pts: S.email }); }
  }
  const nm = nameHit(payer, o);
  if (nm === 'full') { score += S.name; reasons.push({ k: 'name', t: 'imię i nazwisko / firma zgodne z płatnikiem', pts: S.name }); }
  else if (nm === 'part') { const p = Math.round(S.name / 2); score += p; reasons.push({ k: 'name', t: 'nazwisko zgodne z płatnikiem', pts: p }); }
  return { order: o, score: Math.min(100, Math.round(score)), reasons, amountState, due, number: nh };
}

/**
 * Dopasowanie wszystkich wpłat. orders: [{ id, number, total, paid, email, firstName, lastName, company, shipFirstName, shipLastName }].
 * Zwraca tablicę wyników w kolejności wpłat: { tx, level: 'sure'|'probable'|'none', best, candidates (≤5, malejąco), notes: [tekst], dupOf }.
 * Zasady: jedno zamówienie ↔ jedna wpłata (przy konflikcie wygrywa wyższy wynik, reszta spada do „prawdopodobne”); powtórzona wpłata
 * (ta sama data, kwota i tytuł) jest oznaczona jako możliwy duplikat; wpłata bez zgodnej kwoty i bez numeru nigdy nie jest „pewna”.
 */
export function matchTransactions(txs, orders, settings) {
  const S = cleanSettings(settings);
  const byNum = new Map(), byCents = new Map(), byEmail = new Map(), byWord = new Map();
  const add = (m, k, o) => { if (!k) return; let a = m.get(k); if (!a) m.set(k, a = []); a.push(o); };
  for (const o of orders) {
    add(byNum, splitNumber(o.number).left.replace(/^0+(?=\d)/, ''), o);
    add(byCents, cents(Math.max(0, o.total - (o.paid || 0))), o); if (o.paid > 0) add(byCents, cents(o.total), o);
    if (o.email) add(byEmail, norm(o.email), o);
    for (const w of new Set([o.lastName, o.shipLastName, o.company].flatMap(x => alnum(x).split(' ')).filter(w => w.length >= 3))) add(byWord, w, o);
  }
  const results = txs.map(tx => {
    const cand = new Set();
    const text = norm([tx.title, tx.desc, tx.party].join(' '));
    for (const m of text.matchAll(/\d{1,12}/g)) for (const o of byNum.get(m[0].replace(/^0+(?=\d)/, '')) || []) cand.add(o);
    for (const o of byCents.get(cents(tx.amount)) || []) cand.add(o);
    for (const e of text.match(EMAIL_RE) || []) for (const o of byEmail.get(e) || []) cand.add(o);
    const words = new Set(alnum(tx.party + ' ' + tx.title).split(' ').filter(w => w.length >= 3));
    for (const w of words) for (const o of byWord.get(w) || []) cand.add(o);
    const candidates = [...cand].map(o => scorePair(tx, o, S)).filter(c => c.score > 0).sort((a, b) => b.score - a.score || String(b.order.date).localeCompare(String(a.order.date))).slice(0, 5);
    return { tx, candidates, best: candidates[0] || null, notes: [], level: 'none', dupOf: -1 };
  });
  // powtórzone wpłaty
  const seen = new Map();
  results.forEach((r, i) => { const k = [r.tx.date, cents(r.tx.amount), norm(r.tx.title), norm(r.tx.party)].join('|'); if (seen.has(k)) { r.dupOf = seen.get(k); r.notes.push('możliwy duplikat wpłaty nr ' + (seen.get(k) + 1) + ' (ta sama data, kwota i tytuł)'); } else seen.set(k, i); });
  // poziom wg progów
  for (const r of results) {
    const b = r.best;
    if (!b || b.score < S.probable) continue;
    const second = r.candidates[1];
    const numberOrEmail = b.reasons.some(x => (x.k === 'number' || x.k === 'email') && x.pts > 0);
    let level = b.score >= S.sure ? 'sure' : 'probable';
    if (level === 'sure' && !(b.amountState === 'due') ) { level = 'probable'; r.notes.push('kwota nie zgadza się z kwotą do zapłaty — sprawdź ręcznie'); }
    if (level === 'sure' && !numberOrEmail && b.reasons.filter(x => x.pts > 0).length < 3) { level = 'probable'; r.notes.push('brak numeru zamówienia i e-maila w opisie'); }
    if (second && second.score >= S.probable && b.score - second.score < S.ambiguity) { level = 'probable'; r.notes.push('podobny wynik ma też zamówienie ' + second.order.number + ' — wybierz właściwe'); }
    if (r.dupOf >= 0 && level === 'sure') level = 'probable';
    r.level = level;
  }
  // jedno zamówienie ↔ jedna wpłata
  const claim = new Map();
  results.forEach((r, i) => { if (r.level === 'none' || !r.best) return; const id = r.best.order.id; const prev = claim.get(id); if (prev == null || results[prev].best.score < r.best.score) claim.set(id, i); });
  results.forEach((r, i) => {
    if (r.level === 'none' || !r.best) return;
    const w = claim.get(r.best.order.id);
    if (w !== i) { r.level = 'probable'; r.notes.push('zamówienie ' + r.best.order.number + ' pasuje też do innej wpłaty z wyższym wynikiem'); }
    else if (results.some((x, j) => j !== i && x.level !== 'none' && x.best && x.best.order.id === r.best.order.id && x.best.score === r.best.score)) { r.level = 'probable'; r.notes.push('zamówienie ' + r.best.order.number + ' pasuje do kilku wpłat z takim samym wynikiem'); }
  });
  return results;
}

/** Kwota „zapłacono” do zapisania w Selly: pełna wartość, gdy wpłata pokrywa należność; inaczej dotychczasowa kwota + wpłata. */
export function newPaid(order, txAmount, tolerance = 0.01) {
  const due = Math.max(0, order.total - (order.paid || 0));
  const full = cents(txAmount) >= cents(due) - Math.round(tolerance * 100);
  return Math.round((full ? order.total : (order.paid || 0) + txAmount) * 100) / 100;
}
