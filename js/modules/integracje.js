// Konfiguracja → Integracje: jedna lista wszystkich integracji Selly ze stanem (włączona / skonfigurowana / brak danych) + podgląd każdej
// (natywne ekrany `int-<slug>`, tylko do odczytu; sekrety maskuje serwer — tu trafia wyłącznie „••• (ustawione)” / „(puste)”).
// Stan to wyłącznie wartość logiczna wyliczona z już zamaskowanej odpowiedzi; sprawdzany na żądanie (przycisk), po jednej stronie naraz.
// Także: Sprzedaż hurtowa (grupy rabatowe) i Edytor tłumaczeń.
import { el, loadingBox } from '../core/ui.js?v=802d849';
import { sellyCall, createNative } from './sellyNative.js?v=802d849';
import { createSettings } from './sellyNativeSettings.js?v=802d849';
import { sellyUrl } from './_placeholder.js?v=802d849';

/** Katalog: [slug, nazwa, grupa, strona w Selly]. Musi się zgadzać z shared/native/integracje.js (test integracje.test.js). */
export const CATALOG = [
  ['porownywarki', 'Porównywarki cen', 'Opinie i porównywarki', 'configuration.integracje', 'int-porownywarki'],
  ['ceneo', 'Ceneo — ankieta po zakupie', 'Opinie i porównywarki', 'scripts.integracjaCeneo', 'ceneo-opinie'],
  ['opineo', 'Opineo', 'Opinie i porównywarki', 'scripts.integracjaOpineo'],
  ['okazjeinfo', 'Okazje.info', 'Opinie i porównywarki', 'scripts.integracjaOkazjeinfo'],
  ['trustisto', 'Trustisto', 'Opinie i porównywarki', 'scripts.integracjaTrustisto'],
  ['trustmate', 'TrustMate', 'Opinie i porównywarki', 'scripts.integracjaTrustmate'],
  ['przesylki', 'Apaczka — przesyłki', 'Przesyłki', 'configuration.shipping', 'int-przesylki'],
  ['apaczka', 'Apaczka — InPost International', 'Przesyłki', 'configuration.integracjaapaczka'],
  ['furgonetka', 'Furgonetka', 'Przesyłki', 'configuration.integracjaFurgonetka'],
  ['inpost', 'InPost', 'Przesyłki', 'configuration.integracjaInpost'],
  ['orlen', 'Orlen Paczka', 'Przesyłki', 'configuration.integracjaOrlenPaczka'],
  ['dpd', 'DPD', 'Przesyłki', 'configuration.integracjaDPD'],
  ['ups', 'UPS', 'Przesyłki', 'configuration.integracjaUPS'],
  ['dhl', 'DHL', 'Przesyłki', 'configuration.integracjaDHL'],
  ['schenker', 'DB Schenker', 'Przesyłki', 'configuration.integracjaSchenker'],
  ['suus', 'Suus', 'Przesyłki', 'configuration.integracjaSuus'],
  ['gls', 'GLS', 'Przesyłki', 'configuration.integracjaGLS'],
  ['fk', 'Programy F/K (wFirma)', 'Księgowość i magazyn', 'configuration.programsFK', 'int-fk'],
  ['wfirma', 'wFirma', 'Księgowość i magazyn', 'configuration.integracjawFirma'],
  ['ifirma', 'iFirma', 'Księgowość i magazyn', 'configuration.integracjaiFirma'],
  ['fakturownia', 'Fakturownia', 'Księgowość i magazyn', 'configuration.integracjaFakturownia'],
  ['pcmarket', 'PC-Market', 'Księgowość i magazyn', 'configuration.integracjaPCMarket'],
  ['subiekt', 'Subiekt GT', 'Księgowość i magazyn', 'configuration.integracjaSubiektGT'],
  ['wfmag', 'wFirma — magazyn', 'Księgowość i magazyn', 'configuration.integracjaWFMag'],
  ['apilo', 'Apilo', 'Sprzedaż wielokanałowa', 'scripts.integracjaApilo'],
  ['baselinker', 'BaseLinker', 'Sprzedaż wielokanałowa', 'scripts.integracjaBaselinker'],
  ['dodatkowe', 'Google — opcje', 'Marketing i analityka', 'scripts.integracjaOpcje', 'int-dodatkowe'],
  ['google', 'Google', 'Marketing i analityka', 'scripts.integracjaGoogle'],
  ['facebook', 'Facebook', 'Marketing i analityka', 'scripts.integracjaFacebook'],
  ['head', 'Marketizator — kod w nagłówku', 'Marketing i analityka', 'scripts.integracjaHead'],
  ['edrone', 'Edrone', 'Marketing i analityka', 'scripts.integracjaEdrone'],
  ['salesmanago', 'SALESmanago', 'Marketing i analityka', 'scripts.integracjaSalesmanago'],
  ['webepartners', 'WebePartners', 'Marketing i analityka', 'scripts.integracjaWebePartners'],
  ['pragmago', 'Pragmago', 'Marketing i analityka', 'scripts.integracjaPragmago'],
  ['subskrypcje', 'Subskrypcje', 'Marketing i analityka', 'scripts.integracjaSubskrypcje'],
  ['raty', 'Systemy ratalne', 'Płatności i raty', 'scripts.integracjaSystemyRatalne'],
  ['eopisy', 'eOpisy', 'Treści i zabezpieczenia', 'scripts.integracjaEopisy'],
  ['easyprotect', 'EasyProtect', 'Treści i zabezpieczenia', 'scripts.integracjaEasyprotect'],
].map(([slug, title, group, a, screen]) => ({ slug, title, group, a, screen: screen || 'int-' + slug }));

export const STATE = { on: 'włączona', set: 'skonfigurowana', none: 'brak danych', na: 'nie sprawdzono', err: 'niedostępna' };
const STATE_TIP = {
  on: 'W formularzu integracji jest włączony przełącznik aktywności (wartość logiczna z zamaskowanej strony — bez żadnych danych dostępowych)',
  set: 'Wypełnione są pola z danymi integracji, ale nie widać włączonego przełącznika aktywności',
  none: 'Pola integracji są puste — integracja nie jest skonfigurowana',
  na: 'Stan sprawdzasz przyciskiem „Sprawdź stany” (po jednej stronie Selly naraz)',
  err: 'Selly nie otworzyło tej strony (brak uprawnienia, brak modułu albo inny układ strony)',
};
const MASK_EMPTY = '(puste)';
const ACTIVE = /aktyw|w[łl]acz|enabled?|active|\buse\b|_use|status/i;

/** Czysta funkcja: odpowiedź `settings` (już zamaskowana) → 'on' | 'set' | 'none'. Zwraca tylko stan, nigdy wartości pól. */
export function stateOf(data) {
  const fields = ((data && data.sections) || []).flatMap(s => s.fields || []);
  let filled = false, on = false;
  for (const f of fields) {
    if (f.type === 'checkbox' || f.type === 'radio') {
      const checked = f.type === 'checkbox' ? !!f.checked : !!f.value && f.value !== '0';
      if (checked && ACTIVE.test(f.name + ' ' + (f.label || ''))) on = true;
      continue;
    }
    if (f.type === 'select' || f.type === 'hidden' || f.type === 'submit') continue;
    const v = String(f.value == null ? '' : f.value).trim();
    if (v && v !== MASK_EMPTY) filled = true;
  }
  return on ? 'on' : filled ? 'set' : 'none';
}

const overviewModule = () => {
  let root = null, seq = 0;
  const states = new Map();
  const chip = (slug) => { const s = states.get(slug) || 'na'; return el('span', { class: 'pill' + (s === 'on' ? ' yes' : s === 'set' ? '' : ' no') + ' tip', title: STATE_TIP[s], 'data-state': s }, STATE[s]); };

  async function check(btn) {
    const my = ++seq; btn.disabled = true;
    const queue = CATALOG.slice();
    const worker = async () => {
      for (let it = queue.shift(); it && my === seq && root; it = queue.shift()) {
        const r = await sellyCall({ op: 'read', screen: it.screen, view: 'settings' });
        if (my !== seq || !root) return;
        states.set(it.slug, r.ok && r.data && !r.data.missing ? stateOf(r.data) : 'err');
        paint();
      }
    };
    await Promise.all([worker(), worker()]);   // 2 równoległe żądania — oszczędzamy Selly
    if (my === seq && root) { btn.disabled = false; paint(); }
  }

  function paint() {
    if (!root) return;
    const btn = el('button', { type: 'button', class: 'secondary', id: 'intCheck', title: 'Otwiera po kolei strony integracji w Selly (tylko odczyt) i ustala, które są włączone lub skonfigurowane. Dane dostępowe nie trafiają do przeglądarki.' }, 'Sprawdź stany');
    btn.addEventListener('click', () => check(btn));
    const groups = [...new Set(CATALOG.map(c => c.group))];
    root.replaceChildren(
      el('div', { class: 'page-toolbar' }, el('div', { class: 'pt-title' }, el('h2', null, 'Integracje'), el('div', { class: 'sub' }, CATALOG.length + ' integracji Selly — podgląd bez danych dostępowych')),
        el('div', { class: 'pt-actions' }, btn)),
      el('p', { class: 'muted' }, 'Stan integracji wyliczamy ze stron Selly, a klucze, hasła i identyfikatory są ukryte po stronie serwera. Zmiany ustawień integracji wprowadzasz w Selly (↗).'),
      ...groups.map(gr => el('section', { class: 'card', 'data-group': gr }, el('h3', null, gr),
        el('table', { class: 'tbl' }, el('thead', null, el('tr', null,
          el('th', { title: 'Nazwa integracji; kliknięcie otwiera podgląd w panelu' }, 'Integracja'), el('th', { title: 'Stan wyliczony ze strony Selly (włączona / skonfigurowana / brak danych)' }, 'Stan'), el('th', { title: 'Ta sama strona w panelu Selly' }, 'Selly'))),
        el('tbody', null, CATALOG.filter(c => c.group === gr).map(c => el('tr', { 'data-slug': c.slug },
          el('td', null, el('a', { href: '#/' + c.screen }, c.title)), el('td', null, chip(c.slug)),
          el('td', null, el('a', { href: sellyUrl('', '?a=' + c.a), target: '_blank', rel: 'noopener', class: 'btn-quiet', title: 'Otwiera tę stronę w panelu Selly, w nowej karcie' }, '↗ Selly'))))))))
    );
  }
  return {
    id: 'integracje-przeglad', title: 'Integracje', routes: [], native: true,
    mount(host) { root = host; seq++; paint(); },
    unmount() { seq++; root = null; },
  };
};

export default overviewModule();

/** Podgląd jednej integracji (id ekranu = `int-<slug>`; istniejące ekrany mają własne id — pole `screen` katalogu). */
const EXISTING = ['int-porownywarki', 'ceneo-opinie', 'int-przesylki', 'int-fk', 'int-dodatkowe'];   // mają własne moduły w konfSklepu.js
export const previews = Object.fromEntries(CATALOG.filter(c => !EXISTING.includes(c.screen)).map(c => [c.screen, createSettings({ id: c.screen, title: 'Integracja — ' + c.title, screen: c.screen, a: c.a,
  intro: 'Tylko podgląd. Klucze, hasła i identyfikatory są ukryte po stronie serwera.' })]));

export const hurt = createNative({
  id: 'hurt', title: 'Sprzedaż hurtowa — grupy rabatowe', screen: 'hurt', a: 'rabaty.grupyRabatowe', recordRoute: 'rabaty.grupyRabatoweEdycja', noun: 'grupy rabatowej',
  recordTitle: id => 'Grupa rabatowa nr ' + id,
  remove: { title: 'Usunąć grupę rabatową?', tip: 'Usuwa grupę z Selly (tylko administrator, po potwierdzeniu). Klienci z tej grupy stracą jej rabaty.', body: id => 'Grupa rabatowa nr ' + id + ' zostanie usunięta z Selly.' },
  labels: { rabat_grupa: 'Nazwa grupy', rabat_grupa_typ: 'Typ rabatu', uwagi: 'Uwagi', rabat_typ1: 'Klient hurtowy 1 — rodzaj rabatu', rabat_wartosc1: 'Klient hurtowy 1 — rabat',
    rabat_typ2: 'Klient hurtowy 2 — rodzaj rabatu', rabat_wartosc2: 'Klient hurtowy 2 — rabat', rabat_typ3: 'Klient hurtowy 3 — rodzaj rabatu', rabat_wartosc3: 'Klient hurtowy 3 — rabat',
    zamowienia_min_liczba: 'Min. liczba zamówień', zamowienia_min_wartosc: 'Min. wartość zamówień', zamowienia_status_id: 'Status zamówień liczonych do progu', zamowienia_liczba_dni: 'Z ilu ostatnich dni' },
  headerTips: { 'ID': 'Numer grupy rabatowej w Selly', 'Nazwa grupyTyp rabatu': 'Nazwa grupy i sposób naliczania rabatu', 'Działanie': 'Dostępne działania w Selly' },
});

export const tlumaczenia = createSettings({ id: 'tlumaczenia', title: 'Edytor tłumaczeń', screen: 'tlumaczenia', a: 'translations',
  intro: 'Angielskie tłumaczenia tekstów sklepu (pierwsza strona). Zmiany pokażemy do potwierdzenia przed zapisem.' });
