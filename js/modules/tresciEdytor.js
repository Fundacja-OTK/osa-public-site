// Edytor treści HTML natywnych ekranów (strony informacyjne, bloki HTML, aktualności) — czysta logika bez DOM (testy: tests/unit/tresciEdytor.test.js).
// Zasada: do Selly idzie DOKŁADNIE wpisany tekst. Oczyszczanie (sanitizeHtml) służy wyłącznie podglądowi w panelu — `stripReport` mówi,
// co podgląd pominął (skrypty, ramki, zdarzenia, style…), żeby było jasne, co naprawdę dostanie sklep.
import { sanitizeHtml } from '../lib/htmlSanitize.js?v=6d8ea70';

/** Nowe linie jak w polu tekstowym przeglądarki (CRLF / CR → LF) — do porównań, nigdy do zmiany wysyłanej treści. */
export const nl = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n');

// Kopia listy z shared/htmlSanitize.js (DROP_WITH_CONTENT): elementy usuwane z podglądu RAZEM z treścią. Zgodność pilnuje test.
export const DROPPED = ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'select',
  'title', 'head', 'form', 'button', 'applet', 'audio', 'video', 'canvas'];
const DROP = new Set(DROPPED);
// Elementy i atrybuty, które w sklepie DZIAŁAJĄ (wykonują kod, osadzają obce strony, zmieniają działanie strony)
const ACTIVE_TAGS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math', 'base', 'meta', 'link', 'form']);
const TAG_RE = /<!--[\s\S]*?-->|<!--[\s\S]*$|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<[!?][^>]*>|</g;   // jak w sanitizeHtml
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

function startTags(html, skipDropped) {
  const s = String(html || ''), out = [];
  let comments = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s))) {
    if (m[0].startsWith('<!--')) { comments++; continue; }
    if (m[2] === undefined || m[1]) continue;
    const tag = m[2].toLowerCase(), attrs = [];
    let a; ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(m[3] || ''))) attrs.push({ name: a[1].toLowerCase(), value: a[2] == null ? '' : a[2].replace(/^["']|["']$/g, '') });
    out.push({ tag, attrs });
    if (skipDropped && DROP.has(tag)) {   // jak sanitizeHtml: pomija treść do znacznika zamykającego (albo do końca)
      const end = new RegExp('</' + tag + 's*>', 'i'), rest = s.slice(TAG_RE.lastIndex), e = end.exec(rest);
      TAG_RE.lastIndex = e ? TAG_RE.lastIndex + e.index + e[0].length : s.length;
    }
  }
  return { tags: out, comments };
}

/**
 * Co podgląd pominął względem wpisanej treści → { active:[{ what, count }], other:[{ what, count }], total }.
 * active = to, co w sklepie zadziała (skrypty, ramki, zdarzenia on…, adresy javascript:/data:, base/meta/link); other = reszta (style, klasy, nieznane znaczniki, komentarze).
 */
export function stripReport(html) {
  const src = String(html || '');
  const inp = startTags(src, true), outp = startTags(sanitizeHtml(src), false);
  const active = new Map(), other = new Map();
  const add = (map, what) => map.set(what, (map.get(what) || 0) + 1);
  let j = 0;
  for (const t of inp.tags) {
    const kept = j < outp.tags.length && outp.tags[j].tag === t.tag ? outp.tags[j++] : null;
    if (!kept) {
      if (ACTIVE_TAGS.has(t.tag)) add(active, '<' + t.tag + '>');
      else add(other, '<' + t.tag + '>');
      for (const a of t.attrs) if (/^on/.test(a.name)) add(active, 'zdarzenie ' + a.name);
      continue;
    }
    const have = new Set(kept.attrs.map(a => a.name));
    for (const a of t.attrs) {
      if (have.has(a.name) || a.name === 'rel') continue;
      if (/^on/.test(a.name)) add(active, 'zdarzenie ' + a.name);
      else if ((a.name === 'href' || a.name === 'src' || a.name === 'action' || a.name === 'formaction') && /^\s*(javascript|vbscript|data):/i.test(a.value.replace(/[\u0000- ]+/g, ''))) add(active, 'adres ' + a.value.replace(/[\u0000- ]+/g, '').split(':')[0].toLowerCase() + ':');
      else add(other, a.name === 'style' ? 'styl (style)' : /^data-/.test(a.name) ? 'atrybuty data-*' : 'atrybut ' + a.name);
    }
  }
  if (inp.comments) other.set('komentarze HTML', inp.comments);
  const list = m => [...m].map(([what, count]) => ({ what, count })).sort((a, b) => b.count - a.count || a.what.localeCompare(b.what));
  const a = list(active), o = list(other);
  return { active: a, other: o, total: a.reduce((s, x) => s + x.count, 0) + o.reduce((s, x) => s + x.count, 0) };
}

/** Krótki opis listy z stripReport: „<script> ×2, zdarzenie onclick”. */
export const reportText = items => items.map(x => x.what + (x.count > 1 ? ' ×' + x.count : '')).join(', ');

/**
 * Różnica wierszy (LCS) → { ops:[{ t:' '|'-'|'+', s, a?, b? }], added, removed, approx }.
 * Wspólny początek i koniec odcinane; środek > LIMIT komórek → przybliżenie (całość środka jako usunięta + dodana).
 */
export function lineDiff(before, after, LIMIT = 4e6) {
  const A = nl(before).split('\n'), B = nl(after).split('\n');
  let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let q = 0; while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++;
  const a = A.slice(p, A.length - q), b = B.slice(p, B.length - q), ops = [];
  for (let i = 0; i < p; i++) ops.push({ t: ' ', s: A[i], a: i + 1, b: i + 1 });
  let approx = false;
  if (a.length * b.length > LIMIT) {
    approx = true;
    a.forEach((s, i) => ops.push({ t: '-', s, a: p + i + 1 }));
    b.forEach((s, i) => ops.push({ t: '+', s, b: p + i + 1 }));
  } else {
    const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let k = m - 1; k >= 0; k--) L[i][k] = a[i] === b[k] ? L[i + 1][k + 1] + 1 : Math.max(L[i + 1][k], L[i][k + 1]);
    let i = 0, k = 0;
    while (i < n || k < m) {
      if (i < n && k < m && a[i] === b[k]) { ops.push({ t: ' ', s: a[i], a: p + i + 1, b: p + k + 1 }); i++; k++; }
      else if (i < n && (k >= m || L[i + 1][k] >= L[i][k + 1])) { ops.push({ t: '-', s: a[i], a: p + i + 1 }); i++; }
      else { ops.push({ t: '+', s: b[k], b: p + k + 1 }); k++; }
    }
  }
  for (let i = 0; i < q; i++) ops.push({ t: ' ', s: A[A.length - q + i], a: A.length - q + i + 1, b: B.length - q + i + 1 });
  return { ops, added: ops.filter(o => o.t === '+').length, removed: ops.filter(o => o.t === '-').length, approx };
}

/** Fragmenty ze zmianami (+ ctx wierszy kontekstu); między nimi `{ gap: n }` (pominięte niezmienione wiersze). Najwyżej maxOps pozycji. */
export function hunks(ops, ctx = 2, maxOps = 400) {
  const keep = new Uint8Array(ops.length);
  ops.forEach((o, i) => { if (o.t !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = 1; });
  const out = []; let gap = 0, shown = 0, cut = false;
  for (let i = 0; i < ops.length; i++) {
    if (!keep[i]) { gap++; continue; }
    if (shown >= maxOps) { cut = true; break; }
    if (gap) { out.push({ gap }); gap = 0; }
    out.push(ops[i]); shown++;
  }
  if (gap && !cut) out.push({ gap });
  return { items: out, cut };
}

/** Stan treści do paska pod edytorem: { chars, lines, over } (limit z odpowiedzi serwera). */
export function contentStats(v, max) {
  const t = nl(v);
  return { chars: t.length, lines: t ? t.split('\n').length : 0, over: !!max && t.length > max };
}
