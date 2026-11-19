// WYGENEROWANE z shared/htmlSanitize.js przez scripts/sync-parser.sh — nie edytuj ręcznie.

// Czyszczenie HTML opisów produktów (lista dozwolonych znaczników i atrybutów; bez skryptów, ramek, zdarzeń on*, adresów javascript:).
// Źródło: shared/htmlSanitize.js; kopie generuje scripts/sync-parser.sh (panel/backend/HtmlSanitize.gs, panel/worker/src/lib/htmlSanitize.js, panel/app/js/lib/htmlSanitize.js).
// Zasada: wszystko spoza listy znika (treść znaczników zwykłych zostaje, treść script/style/iframe… znika razem ze znacznikiem).

const OK_TAGS = new Set(('p br b strong i em u s strike del ins sub sup small mark ul ol li dl dt dd a img h1 h2 h3 h4 h5 h6 table thead tbody tfoot tr td th caption ' +
  'colgroup col blockquote hr div span pre code figure figcaption center').split(' '));
const VOID = new Set(['br', 'hr', 'img', 'col']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'select',
  'title', 'head', 'form', 'button', 'applet', 'audio', 'video', 'canvas']);
const ATTRS = { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'], td: ['colspan', 'rowspan', 'align'], th: ['colspan', 'rowspan', 'align'], col: ['span'], '*': ['style', 'align'] };
const URL_ATTRS = new Set(['href', 'src']);
const SAFE_STYLE = /^[\w\s:;#%.,()'"!-]*$/;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function decodeEntities(s) {
  return s.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10FFFF)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10FFFF)))
    .replace(/&(colon|tab|newline|lpar|rpar);?/gi, (_, n) => ({ colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')' })[n.toLowerCase()])
    .replace(/&amp;/gi, '&');
}

/** Adres dozwolony: http(s), mailto, tel (tylko href), adresy względne i kotwice. */
function safeUrl(raw, attr) {
  const v = decodeEntities(String(raw)).replace(/[\u0000-\u0020\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]+/g, '');
  if (!v) return null;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!m) return String(raw).trim().replace(/[\u0000-\u001F\u007F]/g, '');
  const scheme = m[1].toLowerCase();
  if (scheme === 'http' || scheme === 'https' || (attr === 'href' && (scheme === 'mailto' || scheme === 'tel'))) return String(raw).trim().replace(/[\u0000-\u001F\u007F]/g, '');
  return null;
}

function cleanAttrs(tag, rest) {
  const allowed = new Set([...(ATTRS[tag] || []), ...ATTRS['*']]);
  const out = [];
  let target = '';
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let m;
  while ((m = re.exec(rest))) {
    const name = m[1].toLowerCase();
    if (!allowed.has(name)) continue;
    let val = m[2] == null ? '' : m[2].replace(/^["']|["']$/g, '');
    if (URL_ATTRS.has(name)) { val = safeUrl(val, name); if (val == null) continue; }
    else if (name === 'style') { const d = decodeEntities(val); if (!SAFE_STYLE.test(d) || /url\s*\(|expression|javascript|@import|behavior|-moz-binding/i.test(d)) continue; val = d; }
    else if (name === 'target') { target = /^_blank$/i.test(val) ? '_blank' : ''; if (!target) continue; val = '_blank'; }
    else if (name === 'rel') continue;
    else val = decodeEntities(val);
    out.push(name + '="' + esc(val) + '"');
  }
  if (tag === 'a' && target) out.push('rel="noopener noreferrer"');
  return out.length ? ' ' + out.join(' ') : '';
}

function sanitizeHtml(input) {
  const s = String(input == null ? '' : input);
  let out = '', i = 0;
  const re = /<!--[\s\S]*?-->|<!--[\s\S]*$|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<[!?][^>]*>|</g;
  let m;
  while ((m = re.exec(s))) {
    out += s.slice(i, m.index);
    i = re.lastIndex;
    if (m[0][1] === '!' || m[0][1] === '?') continue;   // komentarze, <!DOCTYPE>, instrukcje
    if (m[2] === undefined) { out += '&lt;'; continue; }          // goły „<” w tekście
    const closing = m[1] === '/', tag = m[2].toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing) {                                                // pomiń do znacznika zamykającego (albo do końca)
        const end = new RegExp('</' + tag + '\s*>', 'i'); end.lastIndex = 0;
        const rest = s.slice(i), e = end.exec(rest);
        i = e ? i + e.index + e[0].length : s.length;
        re.lastIndex = i;
      }
      continue;
    }
    if (!OK_TAGS.has(tag)) continue;
    if (closing) { if (!VOID.has(tag)) out += '</' + tag + '>'; continue; }
    out += '<' + tag + cleanAttrs(tag, m[3]) + (VOID.has(tag) ? '>' : '>');
  }
  return out + s.slice(i).replace(/</g, '&lt;');
}

export { sanitizeHtml, safeUrl };
