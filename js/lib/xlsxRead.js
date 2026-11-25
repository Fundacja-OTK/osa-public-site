// Odczyt pierwszego arkusza pliku Excel (.xlsx) w przeglądarce — bez bibliotek: ZIP (wpisy STORED i DEFLATE przez DecompressionStream),
// sharedStrings + arkusz (komórki tekstowe, liczbowe, logiczne, inline). Formuły — zapamiętana wartość. Bez wysyłania pliku gdziekolwiek.
// Działa też w Node ≥ 18 (testy jednostkowe). Zapis plików .xlsx: core/ui.js buildXlsx.

export const MAX_XLSX_BYTES = 40 * 1024 * 1024;   // suma rozpakowanych części, które czytamy (ochrona przed „bombą ZIP”)

/** Czy bajty wyglądają na plik ZIP (xlsx)? */
export const isZip = u8 => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04;

function entries(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('To nie jest poprawny plik Excel (.xlsx) — zapisz go ponownie w Excelu albo jako CSV.');
  const count = dv.getUint16(eocd + 10, true), out = new Map();
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < count && p + 46 <= u8.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    out.set(dec.decode(u8.subarray(p + 46, p + 46 + nlen)), { method, csize, usize, off });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

async function inflate(data, limit) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ta przeglądarka nie umie rozpakować pliku .xlsx — zapisz go w Excelu jako CSV.');
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > limit) { try { await reader.cancel(); } catch (e) { /* ok */ } throw new Error('Plik Excel jest za duży.'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

async function part(u8, list, name, budget) {
  const e = list.get(name);
  if (!e) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(e.off, true) !== 0x04034b50) throw new Error('Uszkodzony plik Excel.');
  const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
  const raw = u8.subarray(start, start + e.csize);
  let bytes;
  if (e.method === 0) bytes = raw;
  else if (e.method === 8) bytes = await inflate(raw, budget.left);
  else throw new Error('Nieobsługiwany format kompresji w pliku Excel — zapisz go ponownie albo jako CSV.');
  budget.left -= bytes.length;
  if (budget.left < 0) throw new Error('Plik Excel jest za duży.');
  return new TextDecoder().decode(bytes);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unxml = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => (g[0] === '#'
  ? String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ENT[g.toLowerCase()]));
/** Tekst z elementu z przebiegami (<r><t>…</t></r>) albo jednego <t>; pomija fonetykę (<rPh>). */
const textOf = xml => { let s = ''; const x = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''); for (const m of x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1]; return unxml(s); };
const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const numText = v => { const n = Number(v); return isFinite(n) ? String(Number(n.toPrecision(15))) : String(v); };

/**
 * Bajty pliku .xlsx → { rows: [[tekst komórki]], sheet: nazwa pierwszego arkusza }. Wiersze puste w środku zostają (puste tablice),
 * maxRows ogranicza liczbę wierszy (reszta pominięta, truncated: true).
 */
export async function readXlsx(bytes, { maxRows = 5000 } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const list = entries(u8), budget = { left: MAX_XLSX_BYTES };
  let sheetPath = 'xl/worksheets/sheet1.xml', sheetName = '';
  const wb = await part(u8, list, 'xl/workbook.xml', budget);
  if (wb) {
    const first = /<sheet\b[^>]*>/.exec(wb);
    if (first) {
      sheetName = unxml((/\bname="([^"]*)"/.exec(first[0]) || [])[1] || '');
      const rid = (/\br:id="([^"]*)"/.exec(first[0]) || /\bid="([^"]*)"/.exec(first[0]) || [])[1];
      const rels = rid ? await part(u8, list, 'xl/_rels/workbook.xml.rels', budget) : null;
      if (rels) {
        for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
          if ((/\bId="([^"]*)"/.exec(m[0]) || [])[1] !== rid) continue;
          const t = (/\bTarget="([^"]*)"/.exec(m[0]) || [])[1] || '';
          sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
        }
      }
    }
  }
  if (!list.has(sheetPath)) sheetPath = [...list.keys()].find(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n)) || sheetPath;
  const sst = [];
  const ss = await part(u8, list, 'xl/sharedStrings.xml', budget);
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) sst.push(m[1] ? textOf(m[1]) : '');
  const xml = await part(u8, list, sheetPath, budget);
  if (xml == null) throw new Error('W pliku Excel nie ma arkusza z danymi.');
  const rows = [];
  let truncated = false, next = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]), ri = rAttr ? Number(rAttr[1]) - 1 : next;
    next = ri + 1;
    if (ri >= maxRows) { truncated = true; break; }
    while (rows.length < ri) rows.push([]);
    const row = [];
    let ci = 0;
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1], body = cm[2] || '';
      const ref = (/\br="([A-Z]+\d+)"/.exec(a) || [])[1], t = (/\bt="(\w+)"/.exec(a) || [])[1] || 'n';
      const idx = ref ? colIndex(ref) : ci;
      ci = idx + 1;
      const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
      let val = '';
      if (t === 's') val = v == null ? '' : (sst[Number(v)] || '');
      else if (t === 'inlineStr') val = textOf((/<is>([\s\S]*?)<\/is>/.exec(body) || [])[1] || '');
      else if (t === 'str' || t === 'e') val = v == null ? '' : unxml(v);
      else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else val = v == null ? '' : numText(unxml(v));
      while (row.length < idx) row.push('');
      row[idx] = val;
    }
    rows.push(row);
  }
  while (rows.length && !rows[rows.length - 1].some(x => String(x).trim())) rows.pop();
  return { rows, sheet: sheetName, truncated };
}
