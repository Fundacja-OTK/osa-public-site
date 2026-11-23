// Reklamacje (Selly ?a=reklamacje) — natywny ekran przez rozszerzenie OSA; bez rozszerzenia ramka / link (docs/selly-embed.md, etap 2).
import { createNative } from './sellyNative.js?v=be6c33d';

export default createNative({
  id: 'reklamacje', title: 'Reklamacje', screen: 'reklamacje', a: 'reklamacje', recordRoute: 'reklamacje.edycja', noun: 'reklamacji',
  recordTitle: id => 'Reklamacja nr ' + id,
  headerTips: {
    'Data wpisania': 'Kiedy reklamacja została wpisana w Selly',
    'Dane reklamacji': 'Numer RMA, numer seryjny i inne dane zgłoszenia',
    'Zamówienie': 'Zamówienie, którego dotyczy reklamacja',
    'Status': 'Etap obsługi reklamacji (nowa, przyjęta, w trakcie, zakończona…)',
    'Działanie': 'Dostępne czynności w Selly',
  },
});
