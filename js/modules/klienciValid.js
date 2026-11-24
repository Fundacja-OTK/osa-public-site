// Walidacja danych klienta — czysta logika (bez DOM), wspólna dla formularza klienta (klienciForm.js) i importu CSV (klienciImportLogic.js).
// Lustrzana do Workera (shared/failover.js: checkNip, checkPostcode, checkPhone), który i tak sprawdza wszystko przy zapisie.

export const isPl = c => !c || /^(polska|poland|pl)$/i.test(String(c).trim());

export function nipError(raw, country) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const clean = s.replace(/[\s-]/g, '').toUpperCase(), pl = clean.replace(/^PL/, '');
  if (isPl(country) || /^PL\d/.test(clean)) {
    if (!/^\d{10}$/.test(pl)) return 'NIP musi mieć 10 cyfr (np. 123-456-32-18).';
    const w = [6, 5, 7, 2, 3, 4, 5, 6, 7], sum = w.reduce((a, k, i) => a + k * Number(pl[i]), 0) % 11;
    return sum === 10 || sum !== Number(pl[9]) ? 'Nieprawidłowy NIP (zła suma kontrolna) — sprawdź cyfry.' : '';
  }
  return /^[A-Z0-9]{4,14}$/.test(clean) ? '' : 'Nieprawidłowy numer VAT / NIP.';
}
export const postcodeError = (raw, country) => (String(raw || '').trim() && isPl(country) && !/^\d{2}-\d{3}$/.test(String(raw).trim()) ? 'Kod pocztowy ma format 00-000.' : '');
export const emailError = raw => (/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(raw || '').trim()) ? '' : 'Podaj poprawny adres e-mail.');
export const phoneError = raw => { const s = String(raw || '').trim(); return !s || (/^[+\d][\d\s()./-]{5,24}$/.test(s) && s.replace(/\D/g, '').length >= 6) ? '' : 'Numer telefonu wygląda nieprawidłowo.'; };
/** „00001” → „00-001” (tylko dla Polski); inne wartości bez zmian. */
export const fixPostcode = (raw, country) => { const s = String(raw == null ? '' : raw).trim(); return /^\d{5}$/.test(s) && isPl(country) ? s.slice(0, 2) + '-' + s.slice(2) : s; };
