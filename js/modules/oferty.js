// Oferty (Selly ?a=offersAdm) — natywny ekran przez rozszerzenie OSA; bez rozszerzenia ramka / link (docs/selly-embed.md, etap 2).
import { createNative } from './sellyNative.js?v=8725b34';

export default createNative({
  id: 'oferty', title: 'Oferty', screen: 'oferty', a: 'offersAdm', recordRoute: 'offersAdm.view', noun: 'oferty',
  recordTitle: id => 'Oferta nr ' + id,
  headerTips: {
    'Nr i status': 'Numer oferty i jej aktualny status (szkic, oczekuje na akceptację, zaakceptowana, odrzucona…)',
    'Produkty': 'Pozycje zawarte w ofercie',
    'Wartość': 'Wartość oferty (brutto) wg Selly',
  },
});
