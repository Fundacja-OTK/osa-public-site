// Import wpłat bankowych — formaty standardowe (czysta logika, przeglądarka i Node; bez sieci, bez zapisu).
// ISO 20022 camt.053 / camt.052 (XML), MT940 (SWIFT, w tym polskie podpola :86: ~20…~38) oraz rozpoznanie formatu po treści.
// Parser XML jest własny i minimalny (bez DOMParser; encje DOCTYPE NIE są rozwijane — brak XXE / „billion laughs”).
// Wyciąg zawiera dane osobowe: nic stąd nie jest wysyłane ani logowane.
import { parseAmount, parseDate } from './wplatyCsv.js?v=5a962d8';

/** Format po treści: 'camt' | 'mt940' | 'csv'. */
export function sniffFormat(text) {
  const head = String(text || '').replace(/^﻿/, '').slice(0, 6000);
  if (/^\s*(<\?xml|<)/.test(head) && /<(?:\w+:)?(BkToCstmrStmt|BkToCstmrAcctRpt|Stmt|Rpt)\b/.test(String(text).slice(0, 60000))) return 'camt';
  if (/(^|\n)\s*:(20|25|28C?|60[FM]|61):/.test(head) && /(^|\n):61:/.test(String(text))) return 'mt940';
  return 'csv';
}

// ─── XML (minimalny) ────────────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unent = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch (x) { return ''; } }
  return ENT[e.toLowerCase()] || m;
});
function parseXml(src) {
  const root = { n: '#', k: [], t: '', a: {} }, st = [root];
  const s = String(src).replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '');
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<(\/)?([^\s>\/!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const top = st[st.length - 1];
    if (m[1] != null) top.t += m[1];
    else if (m[6] != null) top.t += unent(m[6]);
    else if (m[3]) {
      const name = m[3].replace(/^.*:/, '');
      if (m[2]) { if (st.length > 1) st.pop(); continue; }
      const a = {}; String(m[4] || '').replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (x, k, v1, v2) => { a[k.replace(/^.*:/, '')] = unent(v1 != null ? v1 : v2); return ''; });
      const node = { n: name, k: [], t: '', a };
      top.k.push(node);
      if (!m[5]) st.push(node);
    }
    if (st.length > 200) throw new Error('XML zbyt zagnieżdżony');
  }
  return root;
}
const kid = (n, ...path) => { let c = n; for (const p of path) { c = c && c.k.find(x => x.n === p); if (!c) return null; } return c; };
const kids = (n, name) => (n ? n.k.filter(x => x.n === name) : []);
const txt = n => (n ? n.t.replace(/\s+/g, ' ').trim() : '');
const deepText = n => (n ? (n.t + ' ' + n.k.map(deepText).join(' ')).replace(/\s+/g, ' ').trim() : '');
function collect(n, name, out = []) { for (const c of n.k) { if (c.n === name) out.push(c); else collect(c, name, out); } return out; }

const zero = () => ({ debits: 0, invalid: 0, summary: 0, foreign: 0, status: 0, zero: 0 });
const r2 = v => Math.round(v * 100) / 100;

/** camt.053 / camt.052 → { variant, txs, skipped, total }. total = liczba wszystkich operacji w pliku. */
export function parseCamt(text) {
  const root = parseXml(text);
  const variant = collect(root, 'BkToCstmrAcctRpt').length ? 'camt.052' : 'camt.053';
  const entries = collect(root, 'Ntry');
  const txs = [], skipped = zero(); let total = 0, idx = 0;
  const partyOf = (td, credit) => {
    const side = credit ? 'Dbtr' : 'Cdtr', acct = credit ? 'DbtrAcct' : 'CdtrAcct', rp = kid(td, 'RltdPties');
    if (!rp) return { party: '', account: '' };
    const nm = txt(kid(rp, side, 'Nm')) || txt(kid(rp, side, 'Pty', 'Nm')) || txt(kid(rp, 'Ultmt' + side, 'Nm')) || txt(kid(rp, 'Ultmt' + side, 'Pty', 'Nm'));
    const ac = kid(rp, acct, 'Id');
    return { party: nm, account: txt(kid(ac, 'IBAN')) || txt(kid(ac, 'Othr', 'Id')) };
  };
  for (const e of entries) {
    idx++;
    const amtN = kid(e, 'Amt'), ccy = (amtN && amtN.a.Ccy) || '';
    const base = parseAmount(txt(amtN), 'dot');
    const ind = txt(kid(e, 'CdtDbtInd')).toUpperCase(), rev = /^(true|1)$/i.test(txt(kid(e, 'RvslInd')));
    const credit = (ind === 'CRDT') !== rev;
    const date = parseDate(txt(kid(e, 'BookgDt', 'Dt')) || txt(kid(e, 'BookgDt', 'DtTm')) || txt(kid(e, 'ValDt', 'Dt')) || txt(kid(e, 'ValDt', 'DtTm')));
    total++;
    if (!isFinite(base) || !date || !ind) { skipped.invalid++; continue; }
    if (/PDNG|FUTR/i.test(deepText(kid(e, 'Sts')))) { skipped.status++; continue; }
    if (!credit) { skipped.debits++; continue; }
    if (ccy && ccy !== 'PLN') { skipped.foreign++; continue; }
    if (base === 0) { skipped.zero++; continue; }
    const addtl = txt(kid(e, 'AddtlNtryInf'));
    const tds = collect(kid(e, 'NtryDtls') || { k: [] }, 'TxDtls');
    const ownAmt = td => { const a = kid(td, 'AmtDtls', 'TxAmt', 'Amt') || kid(td, 'AmtDtls', 'InstdAmt', 'Amt') || kid(td, 'Amt'); return a && (!a.a.Ccy || a.a.Ccy === ccy) ? parseAmount(txt(a), 'dot') : NaN; };
    const titleOf = td => {
      const rmt = kid(td, 'RmtInf');
      const u = kids(rmt, 'Ustrd').map(txt).filter(Boolean).join(' ');
      const strd = rmt ? collect(rmt, 'Ref').map(txt).filter(Boolean).join(' ') : '';
      return u || strd || txt(kid(td, 'AddtlTxInf'));
    };
    const multi = tds.length > 1 && tds.every(td => isFinite(ownAmt(td)) && ownAmt(td) > 0);
    if (multi) {
      for (const td of tds) { const p = partyOf(td, true); txs.push({ i: idx, date, amount: r2(ownAmt(td)), title: titleOf(td) || addtl, party: p.party, account: p.account, desc: '' }); }
    } else {
      const td = tds[0], p = td ? partyOf(td, true) : { party: '', account: '' };
      const title = tds.map(titleOf).filter(Boolean).join(' ') || addtl;
      txs.push({ i: idx, date, amount: r2(base), title, party: p.party, account: p.account, desc: '' });
    }
  }
  return { variant, txs, skipped, total };
}

// ─── MT940 ──────────────────────────────────────────────────────────────
const yy = n => (n < 80 ? 2000 + n : 1900 + n);
function mtDate(val, entry) {
  const vy = yy(+val.slice(0, 2)), vm = +val.slice(2, 4), vd = +val.slice(4, 6);
  let y = vy, m = vm, d = vd;
  if (entry && /^\d{4}$/.test(entry)) { m = +entry.slice(0, 2); d = +entry.slice(2, 4); if (m - vm > 6) y--; else if (vm - m > 6) y++; }
  return parseDate(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
}

/** Pole :86: → { title, party, account, desc }. Obsługuje polskie ~NN (i ?NN), strukturę /KLUCZ/ oraz wolny tekst. */
export function parseMt940Info(lines) {
  const flat = lines.map(l => l.replace(/\s+$/, ''));
  const joined = flat.join('');
  const sep = /^\s*\d{3}~\d{2}/.test(joined) || /~\d{2}/.test(joined) ? '~' : (/^\s*(\d{3})?\?\d{2}/.test(joined) ? '?' : '');
  if (sep) {
    const parts = joined.split(new RegExp('\\' + sep + '(\\d{2})')), f = {};
    const code = parts[0].trim();
    for (let i = 1; i < parts.length; i += 2) f[parts[i]] = (f[parts[i]] || '') + parts[i + 1];
    const g = (a, b, j = '') => { const v = []; for (let k = a; k <= b; k++) { const x = f[String(k).padStart(2, '0')]; if (x) v.push(x); } return v.join(j).replace(/\s+/g, ' ').trim(); };
    const title = g(20, 29) || g(60, 63) || (f['00'] || '').trim();
    const party = g(32, 33, ' ');
    const account = (f['38'] || '').replace(/\s/g, '') || ((f['30'] || '') + (f['31'] || '')).replace(/\s/g, '');
    return { title, party, account, desc: (f['00'] || '').trim() || code };
  }
  const text = flat.join(' ').replace(/\s+/g, ' ').trim();
  if (/\/(NAME|ORDP|BENM|REMI|TITL|IBAN|EREF|CNTP|ACCW)\//.test(text)) {
    const t = text.split(/\/([A-Z]{3,4})\//), f = {};
    for (let i = 1; i < t.length; i += 2) f[t[i]] = (f[t[i]] ? f[t[i]] + ' ' : '') + t[i + 1].trim();
    let party = f.NAME || f.ORDP || '', account = f.IBAN || f.ACCW || '';
    if (f.CNTP) { const c = f.CNTP.split('/'); account = account || (c[0] || '').trim(); party = party || (c[2] || '').trim(); }
    return { title: f.REMI || f.TITL || '', party, account, desc: '' };
  }
  return { title: text, party: '', account: '', desc: '' };
}

/** MT940 → { txs, skipped, total }. Tylko uznania (:61: C / RD) trafiają do txs. */
export function parseMt940(text) {
  const blocks = []; let cur = null;
  for (const ln of String(text).replace(/\r/g, '').split('\n')) {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(ln);
    if (m) { cur = { tag: m[1], v: [m[2]] }; blocks.push(cur); continue; }
    if (!cur) continue;
    if (ln.trim() === '-' || /^-?\}/.test(ln.trim())) { cur = null; continue; }
    cur.v.push(ln);
  }
  const txs = [], skipped = zero(); let total = 0, ccy = '', k = 0;
  for (let b = 0; b < blocks.length; b++) {
    const bl = blocks[b];
    if (bl.tag === '60F' || bl.tag === '60M') { const m = /^[CD]\d{6}([A-Z]{3})/.exec(bl.v[0]); if (m) ccy = m[1]; continue; }
    if (bl.tag !== '61') continue;
    k++; total++;
    const m = /^(\d{6})(\d{4})?(R?[CD])[A-Z]?(\d+,\d*)/.exec(bl.v[0].trim());
    if (!m) { skipped.invalid++; continue; }
    const amount = parseAmount(m[4], 'comma'), date = mtDate(m[1], m[2]);
    if (!isFinite(amount) || !date) { skipped.invalid++; continue; }
    const credit = m[3] === 'C' || m[3] === 'RD';
    if (!credit) { skipped.debits++; continue; }
    if (ccy && ccy !== 'PLN') { skipped.foreign++; continue; }
    if (amount === 0) { skipped.zero++; continue; }
    const nx = blocks[b + 1], info = nx && nx.tag === '86' ? parseMt940Info(nx.v) : { title: bl.v.slice(1).join(' ').trim(), party: '', account: '', desc: '' };
    txs.push({ i: k, date, amount: r2(amount), title: info.title, party: info.party, account: info.account, desc: info.desc });
  }
  return { txs, skipped, total };
}
