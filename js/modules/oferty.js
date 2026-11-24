// Oferty (Selly ?a=offersAdm) — natywny ekran: serwer główny czyta i zapisuje Selly sesją zalogowanego użytkownika (docs/selly-embed.md, docs/auth.md).
import { createNative } from './sellyNative.js?v=79bd162';

export default createNative({
  id: 'oferty', title: 'Oferty', screen: 'oferty', a: 'offersAdm', recordRoute: 'offersAdm.view', noun: 'oferty',
  recordTitle: id => 'Oferta nr ' + id,
  headerTips: {
    'Nr i status': 'Numer oferty i jej aktualny status (szkic, oczekuje na akceptację, zaakceptowana, odrzucona…)',
    'Produkty': 'Pozycje zawarte w ofercie',
    'Wartość': 'Wartość oferty (brutto) wg Selly',
  },
});
