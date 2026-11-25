// Reklamacje (Selly ?a=reklamacje) — natywny ekran: serwer główny czyta i zapisuje Selly sesją zalogowanego użytkownika (docs/selly-embed.md, docs/auth.md).
import { createNative } from './sellyNative.js?v=650da05';

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
