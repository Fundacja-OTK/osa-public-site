// Kupony rabatowe (Selly ?a=rabaty.kuponyRabatowe) — natywny ekran: lista z filtrami, karta kuponu, dodawanie i edycja (rabat, ważność, limity).
// Usuwanie, kopiowanie, raport wykorzystania i „naliczaj automatycznie” zostają w Selly (osobne formularze / akcje niszczące).
import { createNative } from './sellyNative.js?v=9efbcf3';

const pad = n => String(n).padStart(2, '0');
/** Wczorajsza data w tym samym zapisie, w jakim Selly podaje daty kuponu (RRRR-MM-DD albo DD.MM.RRRR); inny zapis → null (bez szybkiej akcji). */
export function yesterdayLike(sample, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  if (/^\d{2}\.\d{2}\.\d{4}/.test(sample)) return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  return null;
}

export default createNative({
  id: 'kupony', title: 'Kupony rabatowe', screen: 'kupony', a: 'rabaty.kuponyRabatowe', recordRoute: 'rabaty.kuponyRabatoweEdycja', noun: 'kuponu',
  recordTitle: id => 'Kupon nr ' + id,
  create: { label: '+ Dodaj kupon', title: 'Nowy kupon', tip: 'Otwiera pusty formularz kuponu; przed wysłaniem do Selly pokażemy podsumowanie' },
  quick: d => {
    const f = n => d.fields.find(x => x.name === n && x.editable);
    const to = f('kupon_do'); if (!to) return [];
    const out = [];
    const y = yesterdayLike(to.value || (f('kupon_od') || {}).value || '');
    if (y && to.value !== y) out.push({ key: 'off', label: 'Wyłącz kupon', tip: 'Ustawia datę końca ważności na wczoraj — kupon przestaje działać w sklepie (nic nie jest usuwane)', changes: { kupon_do: y } });
    if (to.value) out.push({ key: 'on', label: 'Włącz bezterminowo', tip: 'Czyści datę końca ważności — kupon działa bez terminu (od daty początku, jeśli jest ustawiona)', changes: { kupon_do: '' } });
    return out;
  },
  headerTips: {
    'Kupon': 'Kod kuponu (albo prefiks, gdy kupon ma wiele kodów)',
    'Opis': 'Opis kuponu widoczny tylko w Selly',
    'Naliczaj w koszyku automatycznie': 'Czy kupon jest doliczany w koszyku bez wpisywania kodu',
    'Rabat': 'Rodzaj i wysokość rabatu',
    'Data ważności': 'Od kiedy do kiedy kupon działa',
    'Ograniczenia wartości / ilości': 'Minimalna / maksymalna wartość lub liczba produktów w koszyku',
    'Liczba kuponów (dostępne / wszystkie)': 'Ile kodów zostało do wykorzystania z ilu wszystkich',
    'Działanie': 'Dostępne czynności w Selly (edycja, kopiowanie, usuwanie)',
  },
});
