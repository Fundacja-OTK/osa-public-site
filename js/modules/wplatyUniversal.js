// Import wpłat bankowych — jedno wejście dla każdego formatu: camt.053/052 (XML), MT940, CSV/TXT (auto-wykrywanie + mapowanie).
// Plik jest przetwarzany wyłącznie lokalnie. Wynik ma kształt zgodny z parserem CSV (patrz wplatyCsv.parseStatement).
import { decodeBytes, parseStatement as parseCsvStatement, BANKS } from './wplatyCsv.js?v=a753217';
import { sniffFormat, parseCamt, parseMt940 } from './wplatyFormats.js?v=a753217';

export { BANKS };
export const FORMATS = { 'camt.053': 'ISO 20022 camt.053', 'camt.052': 'ISO 20022 camt.052', mt940: 'MT940', csv: 'CSV / TXT' };

export function parseStatement(input, opts = {}) {
  const dec = typeof input === 'string' ? { text: input.replace(/^﻿/, ''), encoding: 'tekst' } : decodeBytes(input);
  const kind = sniffFormat(dec.text);
  if (kind === 'csv') return parseCsvStatement(input, opts);
  const r = kind === 'camt' ? parseCamt(dec.text) : parseMt940(dec.text);
  return { format: kind === 'camt' ? r.variant : 'mt940', encoding: dec.encoding, separator: '', bank: '', confidence: 'standard', headerRow: -1, headers: [], signature: '', mapping: null,
    needsMapping: false, suggest: null, sample: [], txs: r.txs, skipped: r.skipped, total: r.total, rows: [] };
}

/** Powody pominięcia wierszy (do podsumowania w UI): [{ n, text }] tylko dla n > 0. */
export function skipReasons(sk) {
  const L = [['debits', 'obciążeń (wydatki — nie dotyczą wpłat)'], ['foreign', 'wpływów w innej walucie niż PLN'], ['status', 'operacji niezrealizowanych (oczekujące / odrzucone)'],
    ['zero', 'operacji na 0,00'], ['summary', 'wierszy opisowych lub podsumowań (nagłówki, stopka)'], ['invalid', 'wierszy z nieczytelną datą lub kwotą']];
  return L.filter(([k]) => sk[k] > 0).map(([k, text]) => ({ n: sk[k], text }));
}
