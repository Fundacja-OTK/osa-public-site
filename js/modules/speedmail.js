// Moduł „Wysyłka SpeedMail” (#/speedmail/<zakładka>) — nadzór stanów SpeedMail wg docs/speedmail-spec.md.
// Zakładki (linki): zamowienia — kto pakuje (SpeedMail czy my) z powodem, przekazanie paczki zleceń; stan — towar w SM i alerty;
// paczki — przekazane paczki zleceń (plik .xlsx, statusy, anulowanie); tempo — sprzedaż wobec prognozy; ustawienia — lista produktów SM,
// rozbicia, terminy, progi. Dane i zapisy: akcje sm:* (Worker + D1), zmiana statusu: orders:setStatus porcjami (lib/statusBatch.js).
// Logika bez DOM: shared/speedmail.js → lib/speedmailLogic.js (ta sama na serwerze). Bez danych osobowych.
import { $, el } from '../core/ui.js?v=3bb5e1e';
import { go, addLeaveGuard } from '../core/router.js?v=3bb5e1e';
import { S, SM, ensure, plan, skeleton, loadError, notice, jobCard, liveCtl, liveStop } from './speedmailKit.js?v=3bb5e1e';
import { viewOrders } from './speedmailZam.js?v=3bb5e1e';
// Zakładki poza domyślną (Zamówienia) ładują się dopiero po otwarciu — mniej plików przy pierwszym wejściu.
const LAZY = {
  stan: () => import('./speedmailStan.js?v=3bb5e1e').then(m => m.viewStock),
  paczki: () => import('./speedmailPaczki.js?v=3bb5e1e').then(m => m.viewBatches),
  tempo: () => import('./speedmailTempo.js?v=3bb5e1e').then(m => m.viewPace),
  ustawienia: () => import('./speedmailUst.js?v=3bb5e1e').then(m => { settingsDirty = m.settingsDirty; return m.viewSettings; }),
};
const VIEWS = { zamowienia: viewOrders };
let settingsDirty = () => false;

const TABS = [
  ['zamowienia', 'Zamówienia', 'Wszystkie otwarte zamówienia z podpowiedzią, kto je pakuje — SpeedMail czy my — i dlaczego. Stąd przekazujesz zamówienia do SpeedMail.', viewOrders, []],
  ['stan', 'Stan w SpeedMail', 'Ile towaru ma SpeedMail (wysłane + dosyłki − zlecone ± korekty), na ile dni wystarczy i co wymaga dosyłki', null, ['list']],
  ['paczki', 'Paczki zleceń', 'Paczki zamówień przekazane do SpeedMail: plik Excel, statusy w Selly, anulowanie zlecenia', null, ['list']],
  ['tempo', 'Tempo sprzedaży', 'Sprzedaż narastająco wobec prognozy — sygnał do dodruku albo zmiany ceny', null, ['pace']],
  ['ustawienia', 'Ustawienia', 'Lista produktów SpeedMail, rozbicia zestawów, terminy sezonu, formy dostawy, statusy, progi alertów, prognozy', null, []],
];
// Dawne kroki kreatora → nowe zakładki (stare linki i zakładki przeglądarki działają dalej)
const OLD = { kandydaci: 'zamowienia', podzial: 'zamowienia', plik: 'paczki', zatwierdz: 'paczki', historia: 'paczki' };
const tabOf = k => TABS.find(t => t[0] === k);

function counts() {
  const out = {}, p = plan();
  if (p) out.zamowienia = p.rows.filter(r => r.result === 'sm').length;
  if (S.d) out.stan = SM.stockRows(S.d.v.cfg, S.d.v.totals, S.d.v.today).filter(r => r.level === 'red' || r.level === 'stop' || r.presaleAlert).length;
  if (S.list) out.paczki = S.list.v.batches.length;
  return out;
}
const COUNT_TIP = { zamowienia: 'zamówienia, które wg reguł idą do SpeedMail', stan: 'produkty z czerwonym alertem', paczki: 'przekazane paczki zleceń' };

function render() {
  const root = $('smBody'), nav = $('smNav');
  if (!root) return;
  const c = counts();
  nav.replaceChildren(...TABS.map(([k, label, tip]) => el('a', { href: '#/speedmail/' + k, 'aria-current': S.view === k ? 'page' : null,
    title: tip + (c[k] != null ? '\n\nLiczba w nawiasie: ' + COUNT_TIP[k] : '') }, label + (c[k] ? ' (' + c[k] + ')' : ''))));
  // fokus i kursor w polu (np. wyszukiwarka) przeżywają przerysowanie
  const a = document.activeElement, keep = a && a.id && root.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  const parts = [];
  const err = loadError('init', 'zamówienia i stan SpeedMail');
  if (err) parts.push(err);
  if (!S.d) { if (!err) parts.push(skeleton(8)); root.replaceChildren(...parts); return; }
  if (S.err) parts.push(notice('error', S.err, ' ', el('button', { type: 'button', class: 'link', onclick: () => { S.err = ''; render(); } }, 'Zamknij')));
  if (S.job) parts.push(jobCard());
  const cfgOk = S.d.v && S.d.v.cfg && Array.isArray(S.d.v.cfg.products);
  if (!cfgOk) { parts.push(notice('error', 'Serwer zwrócił niepełne dane SpeedMail (brak ustawień produktów). Odśwież stronę; jeśli problem wraca, sprawdź wdrożenie backendu.')); root.replaceChildren(...parts); return; }
  const view = VIEWS[S.view];
  if (!view) {
    const k = S.view;
    parts.push(skeleton(6)); root.replaceChildren(...parts);
    LAZY[k]().then(fn => { VIEWS[k] = fn; if (S.view === k) render(); }).catch(() => { if (S.view === k) root.replaceChildren(notice('error', 'Nie udało się wczytać zakładki. Odśwież stronę.')); });
    return;
  }
  parts.push(view());
  root.replaceChildren(...parts);
  if (keep) { const n = $(keep.id); if (n && n !== document.activeElement) { n.focus(); try { if (keep.s != null) n.setSelectionRange(keep.s, keep.e); } catch (e) { /* pole bez zaznaczenia */ } } }
}
S.rerender = render;

addLeaveGuard(hash => (S.view === 'ustawienia' && settingsDirty() && !String(hash || '').startsWith('#/speedmail/ustawienia') ? 'W ustawieniach SpeedMail są niezapisane zmiany. Wyjść i je odrzucić?' : null));

let root = null;
export default {
  id: 'speedmail',
  title: 'Wysyłka SpeedMail',
  routes: TABS.map(t => t[0]).concat(Object.keys(OLD)),
  mount(host, params) {
    if (!root) { root = host; host.replaceChildren(el('div', { id: 'modSm' }, el('nav', { class: 'viewnav', id: 'smNav', 'aria-label': 'Zakładki wysyłki SpeedMail' }), el('div', { id: 'smBody' }))); }
    const v = params && params.view;
    if (OLD[v]) { go('/speedmail/' + OLD[v], { replace: true }); return; }
    if (!tabOf(v)) { go('/speedmail/' + (tabOf(S.view) ? S.view : 'zamowienia'), { replace: true }); return; }
    if (S.view !== v) S.dlg = null;   // okno potwierdzenia należy do zakładki
    S.view = v; S.query = (params && params.query) || new URLSearchParams();
    // Dane zakładki równolegle; każda część rysuje się, gdy tylko przyjdzie (z kopii — od razu)
    ensure('init');
    for (const k of tabOf(v)[4]) ensure(k);
    if (v === 'zamowienia') liveCtl().start(); else liveStop();
    render();
  },
  unmount() { liveStop(); /* stan zostaje — kontener jest tylko ukrywany */ },
};
