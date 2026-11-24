// Adres miniatury produktu z pola `main_photo` (lista produktów Selly / D1). Czysta funkcja — bez DOM i sieci.
// Pełny adres (http/https) zwracamy bez zmian; adres względny ("/pliki/a.jpg", "pliki/a.jpg", "//cdn/a.jpg")
// dopełniamy domeną sklepu. Puste / nie-tekst → null (wtedy lista pokazuje zastępczą literę).
export function photoSrc(raw, shopBase) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || /^(javascript|data|blob):/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return 'https:' + s;
  const base = String(shopBase || '').replace(/\/adm\/?$/, '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return null;
  return base + '/' + s.replace(/^\/+/, '');
}
