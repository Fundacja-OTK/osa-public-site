// Moduł „Licencje”: raport licencji członkowskich — przedłużenia, orszaki wg województw, anomalie, dziennik zmian.
// Trasy: #/licencje (lista przedłużeń), #/licencje/orszaki (orszaki wg województw).
import { $, el, plural, debounce, store, flash, pageError, norm, menuButton, copyMenuButton, downloadMenuButton, downloadXlsx, downloadCsv, tableMatrix, cellText, uniqNonEmpty, htmlEsc, today, tableTsv, tableHtml, copyToClipboard, saveBlob } from '../core/ui.js?v=fb40452';
import { api, ctx } from '../core/client.js?v=fb40452';
import { loadingBox } from '../core/ui.js?v=fb40452';

let BOOT = null;          // z backendu: { email, year, codePrefix, statuses, products, sync }

const TEMPLATE = `
<div id="notices"></div>

<section class="card" id="cardChanges" aria-label="Aktualność danych i zmiany" hidden>
  <div class="data-bar">
    <div class="meta">
      <span class="dot" id="dataDot" aria-hidden="true"></span>
      <div>
        <h2>Dane ze sklepu</h2>
        <div class="muted small" id="dataInfo">—</div>
      </div>
    </div>
    <button type="button" class="secondary" id="refreshBtn" title="Pobierz ze sklepu nowe i zmienione zamówienia (oraz notatki klientów, jeśli starsze niż godzina)">↻ Odśwież dane</button>
  </div>
  <div id="dataMsg" role="status" aria-live="polite"></div>
  <details class="fold" id="changesDet">
    <summary id="changesSummary"><span>Co się zmieniło</span> <span class="sum" id="changesSum">sprawdzam…</span></summary>
    <div class="changes-tools"><span class="seg wrap" role="group" aria-label="Od kiedy" id="changesRange"></span></div>
    <div id="changesBody"><div class="loading"><div class="line"><span class="spinner"></span>Sprawdzam zmiany…</div></div></div>
  </details>
</section>

<nav class="viewnav" aria-label="Widok raportu" id="viewnav" hidden>
  <a href="#/licencje" data-view="list">Przedłużenia licencji</a>
  <a href="#/licencje/orszaki" data-view="orszaki">Orszaki wg województw</a>
</nav>
<p class="intro" id="intro"></p>

<div id="settings" hidden>
  <section class="settingsbar" aria-label="Ustawienia raportu">
    <div class="field-inline">
      <span class="label" id="yearLabel">Rok licencji</span>
      <span class="field-inline" id="fromWrap" hidden>
        <span class="muted small">od</span>
        <div class="year" role="group" aria-label="Od roku licencji">
          <button type="button" id="fromPrev" aria-label="Wcześniejszy rok początkowy">‹</button>
          <input type="number" id="yearFrom" min="2000" max="2100" aria-label="Od roku licencji" title="Pierwszy rok licencji w zestawieniu — każdy rok od tego do roku „do” to osobna kolumna tabeli">
          <button type="button" id="fromNext" aria-label="Późniejszy rok początkowy">›</button>
        </div>
        <span class="muted small">do</span>
      </span>
      <div class="year" role="group" aria-labelledby="yearLabel">
        <button type="button" id="yearPrev" aria-label="Poprzedni rok">‹</button>
        <input type="number" id="year" min="2000" max="2100" aria-labelledby="yearLabel" title="Rok licencji (licencja na rok R obowiązuje od 1 lipca R−1). W widoku orszaków: ostatni rok zakresu i sezon zamówień">
        <button type="button" id="yearNext" aria-label="Następny rok">›</button>
      </div>
    </div>
    <div class="muted small" id="seasonHint"></div>
    <span class="sp"></span>
    <!-- Jeden przycisk i jeden panel na wszystkie opcje zaawansowane. Panel pokazywany przez style.display
         (nie <details> ani atrybut hidden) — w Chrome na stronie Apps Script panel się nie rozwijał. -->
    <button type="button" class="secondary" id="optsToggle" aria-expanded="false" aria-controls="moreOpts"
      title="Kogo liczymy, które produkty są licencją, które statusy zamówień są zakupem">⚙ Ustawienia zaawansowane <span class="caret" aria-hidden="true">▾</span></button>
  </section>
  <div id="moreOpts" style="display:none">
    <div class="opts-box">
      <div id="orsOpts"></div>
      <div class="opts-grid">
        <div class="field">
          <span class="label">Które produkty liczą się jako licencja członkowska</span>
          <p class="muted small" id="productsHint"></p>
          <div class="products" id="products"></div>
          <button type="button" class="secondary small" id="productReset" style="margin-top:8px">Przywróć domyślne</button>
        </div>
        <div class="field" id="packsField" hidden>
          <span class="label">Pakiety startowe</span>
          <label title="Przed licencjami organizatorzy kupowali pakiet startowy (zestaw: śpiewniki + korony). Po włączeniu pakiet z roku R liczy się tak samo jak licencja na rok R — w tabelach ma znacznik „pakiet”. Dotyczy tylko lat do 2024: od 2025 jako licencja liczy się wyłącznie licencja."><input type="checkbox" id="packsOn" checked> Licz pakiet startowy jak licencję z tego roku (dawna forma, lata do 2024)</label>
          <p class="muted small" id="packsHint"></p>
        </div>
        <div class="field">
          <span class="label">Które zamówienia liczą się jako zakup</span>
          <p class="muted small">Zaznaczone statusy zamówień. Domyślnie bez anulowanych, zwrotów i nieopłaconych.</p>
          <div class="statuses" id="statuses"></div>
          <button type="button" class="secondary small" id="statusReset" style="margin-top:8px">Przywróć domyślne</button>
        </div>
      </div>
    </div>
  </div>
</div>

<section class="card" aria-live="polite" id="cardList" hidden>
  <div id="resultList"><div class="loading"><div class="line"><span class="spinner"></span>Przygotowuję raport…</div></div></div>
</section>
<section class="view-stack" id="cardOrszaki" hidden>
  <div id="resultOrszaki"><div class="loading"><div class="line"><span class="spinner"></span>Przygotowuję zestawienie…</div></div></div>
</section>
`;

const state = {
  view: 'list',      // list | orszaki
  report: null,      // ostatnia odpowiedź „report” (wszystkie osoby z bazy)
  list: 'notBought', // notBought | bought | all
  query: '',
  woj: '',           // filtr województwa na liście przedłużeń
  sort: { key: 'name', dir: 1 },
  requestId: 0,
  orszaki: null,     // ostatnia odpowiedź „orszaki”
  stale: { list: true, orszaki: true }, // zmiana ustawień → widok pobiera dane od nowa przy otwarciu
};


const people = n => n + ' ' + plural(n, 'osoba', 'osoby', 'osób');
const orszakow = n => n + ' ' + plural(n, 'orszak', 'orszaki', 'orszaków');

const seasonLabel = y => (y - 1) + '/' + String(y).slice(2);
// [2025, 2026] → „2025–2026”, [2026] → „2026”
const yearsLabel = ys => (ys.length > 1 ? ys[0] + '–' + ys[ys.length - 1] : String(ys[0]));
// [2025, 2026, 2027] → „2025, 2026 lub 2027”
const orList = (xs, word) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' ' + (word || 'lub') + ' ' + xs[xs.length - 1] : String(xs[0]));

// ─── Ustawienia ────────────────────────────────────────────────────────────

function year() { return parseInt($('year').value, 10); }

function init() {
  $('year').value = BOOT.year;

  for (const s of BOOT.statuses) {
    const cb = el('input', { type: 'checkbox', value: s.id });
    cb.checked = s.counted;
    cb.addEventListener('change', settingsChanged);
    $('statuses').append(el('label', null, cb, s.name));
  }
  if (!BOOT.statuses.length) $('statuses').append(el('p', { class: 'muted small' }, 'Lista statusów pojawi się po pierwszej synchronizacji z Selly.'));
  renderProducts();
  renderPacksField();

  const onYear = () => {
    const y = year();
    if (!(y >= 2000 && y <= 2100)) return;
    updateTexts();
    // Lista przedłużeń liczy się na serwerze; zestawienie orszaków ma już wszystkie lata — liczy się od razu
    state.stale.list = true;
    if (state.view === 'list') scheduleRun();
    else if (state.orszaki) renderOrszaki();
  };
  $('year').addEventListener('input', onYear);
  $('yearPrev').addEventListener('click', () => { $('year').value = year() - 1; onYear(); });
  $('yearNext').addEventListener('click', () => { $('year').value = year() + 1; onYear(); });
  // Zakres lat licencji (widok orszaków): „od” zapamiętujemy jako liczbę lat wstecz, więc przesuwa się razem z „do”
  const setFrom = v => {
    if (!(v >= 2000 && v <= 2100)) return;
    ors.span = Math.max(0, Math.min(MAX_SPAN, year() - v));
    saveOrs();
    updateTexts();
    if (state.orszaki) renderOrszaki();
  };
  $('yearFrom').addEventListener('change', () => setFrom(parseInt($('yearFrom').value, 10)));
  $('fromPrev').addEventListener('click', () => setFrom(year() - ors.span - 1));
  $('fromNext').addEventListener('click', () => setFrom(year() - ors.span + 1));
  // W Chrome (strona Apps Script) kliknięcie nie docierało do przycisku, w Firefoksie tak. Dlatego reagujemy też na
  // puszczenie przycisku myszy w obszarze przycisku (faza przechwytywania na dokumencie) — działa, nawet gdy
  // coś przykrywa przycisk albo zdarzenie „click” nie powstanie. „click” tuż po obsłużonym pointerup to to samo kliknięcie — pomijamy.
  let advSkipClick = 0;
  const toggleAdv = how => {
    setAdvanced($('moreOpts').style.display === 'none');
    if (how) console.info('Ustawienia zaawansowane: przełączone przez', how);
  };
  // Autodiagnostyka (Chrome: „klikam, podświetla się, i nic”): gdy kliknięcie miało otworzyć panel, a po chwili
  // panelu nie widać — komunikat na stronie z kolejnością zdarzeń i stanem panelu (do przekazania administratorowi)
  const advLog = [];
  let advWant = null;
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    $('optsToggle').addEventListener(t, () => {
      if (t === 'pointerdown' || (t === 'click' && advWant === null)) {
        advWant = $('moreOpts').style.display === 'none';
        advLog.length = 0;
        setTimeout(advCheck, 500);
      }
      advLog.push(t);
    }, true);
  }
  function advCheck() {
    const want = advWant;
    advWant = null;
    if (!want) return;
    const p = $('moreOpts'), r = p.getBoundingClientRect(), cs = getComputedStyle(p);
    const open = $('optsToggle').getAttribute('aria-expanded') === 'true';
    if (open && r.height > 20 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0) return;
    const top = document.elementFromPoint(Math.max(1, r.left + 20), Math.min(Math.max(1, r.top + 20), innerHeight - 2));
    pageError('Diagnostyka „Ustawienia zaawansowane”: otwarte=' + open + ', zdarzenia=' + advLog.join('>') +
      ', display=' + cs.display + ', styl=' + (p.getAttribute('style') || '-') + ', wysokość=' + Math.round(r.height) +
      ', góra=' + Math.round(r.top) + ', okno=' + innerWidth + '×' + innerHeight +
      ', zawartość=' + (p.firstElementChild ? p.firstElementChild.className + ':' + getComputedStyle(p.firstElementChild).display : '-') +
      ', na wierzchu=' + (top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (top.className ? '.' + String(top.className).split(' ')[0] : '') : '-'));
  }
  $('optsToggle').addEventListener('click', () => {
    if (Date.now() - advSkipClick < 400) { advSkipClick = 0; return; }
    toggleAdv();
  });
  document.addEventListener('pointerup', ev => {
    if (ev.button !== 0) return;
    const b = $('optsToggle'), r = b.getBoundingClientRect();
    if (!r.width || ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    if (!b.contains(ev.target)) console.warn('Przycisk „Ustawienia zaawansowane” przykrywa:', ev.target);
    advSkipClick = Date.now();
    toggleAdv(b.contains(ev.target) ? '' : 'pointerup (przykryty)');
  }, true);
  $('statusReset').addEventListener('click', () => {
    for (const cb of $('statuses').querySelectorAll('input')) cb.checked = BOOT.statuses.find(s => s.id === cb.value).counted;
    settingsChanged();
  });
  $('productReset').addEventListener('click', () => {
    for (const cb of $('products').querySelectorAll('input')) cb.checked = BOOT.products.find(p => p.code === cb.value).counted;
    settingsChanged();
  });

  renderBanners(BOOT.sync);
  initChanges();
}

/** Czy pakiety startowe są zdefiniowane i włączone (opcja w ustawieniach zaawansowanych). */
// Pakiety (legacy, do 2024) mają znaczenie tylko, gdy wyświetlane lata obejmują rok z pakietem — od 2025 liczy się wyłącznie licencja
const packsActive = ys => !!(BOOT && BOOT.packs && BOOT.packs.length && $('packsOn') && $('packsOn').checked &&
  (!ys || BOOT.packs.some(p => ys.indexOf(p.year) >= 0)));   // ys = lata widoczne w danym miejscu

function renderPacksField() {
  if (!BOOT.packs || !BOOT.packs.length) return;
  $('packsField').hidden = false;
  $('packsOn').addEventListener('change', settingsChanged);
  $('packsHint').replaceChildren(
    'Orszak ma pakiet na rok R, gdy w sezonie R (1 lipca R−1 – 30 czerwca R) suma sztuk każdego składnika ze wszystkich jego zamówień ' +
    'jest co najmniej taka jak w zestawie — także gdy składniki kupił osobno. Pakiety: ' +
    BOOT.packs.map(p => p.year + ' — ' + p.name).join('; ') + '. Definicje: zakładka „Pakiety startowe” w arkuszu danych. ' +
    'Pakiety to dawna forma (do 2024) — od 2025 jako licencja liczy się wyłącznie licencja.');
}

/** Podpowiedź przy znaczniku „pakiet”: reguła i kupione składniki. p: { name|n, parts, orders, lic }. */
function packTip(p, y) {
  const orders = (p.orders || []).map(o => (o && o.number) || o).join(', ');
  return 'Pakiet startowy „' + (p.name || p.n) + '” na rok ' + y + ' (sezon ' + seasonLabel(y) + '). Reguła: w sezonie suma sztuk każdego składnika ze wszystkich zamówień ≥ ilość w zestawie. ' +
    'Składniki kupione osobno: ' + (p.parts || []).map(x => x.name + ' ×' + x.got + ' (w zestawie ' + x.need + ')').join(', ') +
    (orders ? '. Zamówienia: ' + orders : '') + (p.lic ? '. Ten sam rok: jest też licencja.' : '.');
}

/** Produkty licencji pogrupowane wg roku; bez roku — osobno, z informacją, gdzie go uzupełnić. */
function renderProducts() {
  $('productsHint').replaceChildren(
    'Licencje rozpoznajemy po ', el('b', null, 'kodzie producenta'), ' zaczynającym się od „' + BOOT.codePrefix + '”. ',
    'Rok licencji odczytujemy z nazwy produktu (np. „Licencja Członkowska 2025”) albo z kodu. ',
    'Błędny lub brakujący rok popraw w arkuszu danych (zakładka „Produkty licencji”). Pole wyboru zmienia ustawienie tylko na tej stronie.');
  const box = $('products');
  box.replaceChildren();
  if (!BOOT.products.length) {
    box.append(el('p', { class: 'muted small' }, 'Lista produktów pojawi się po pierwszej synchronizacji z Selly.'));
    $('productReset').hidden = true;
    return;
  }
  const groups = new Map();
  for (const p of BOOT.products) {
    const k = p.year || 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  for (const y of [...groups.keys()].sort((a, b) => (b || -1) - (a || -1))) {
    const items = groups.get(y).map(p => {
      const cb = el('input', { type: 'checkbox', value: p.code, disabled: !y });
      cb.checked = !!y && p.counted;
      cb.addEventListener('change', settingsChanged);
      return el('label', { title: y ? '' : 'Bez roku licencji produkt się nie liczy' }, cb, p.name || '(bez nazwy)', ' ', el('code', null, p.code));
    });
    box.append(el('div', { class: 'pgroup' + (y ? '' : ' noyear') },
      el('b', null, y ? String(y) : 'bez roku'),
      el('div', null, items, y ? null : el('p', { class: 'small muted' }, 'Nie liczą się — uzupełnij „Rok licencji” w arkuszu danych.'))));
  }
}

/** Otwiera / zamyka panel „Ustawienia zaawansowane” (opcjonalnie przewija do niego). */
function setAdvanced(open, scroll) {
  $('moreOpts').style.display = open ? '' : 'none';
  $('optsToggle').setAttribute('aria-expanded', String(open));
  $('optsToggle').classList.toggle('on', open);
  if (open && scroll) $('optsToggle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectedProducts() {
  if (!BOOT.products.length) return undefined; // backend: domyślne z arkusza
  return [...$('products').querySelectorAll('input:checked')].map(c => c.value);
}

function settingsChanged() {
  state.stale.list = state.stale.orszaki = true;
  scheduleRun();
}

function setView(view) {
  state.view = view;
  store('otk-view', view);
  for (const b of $('viewnav').querySelectorAll('a')) { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  $('cardList').hidden = view !== 'list';
  $('cardOrszaki').hidden = view !== 'orszaki';
  $('yearLabel').textContent = view === 'list' ? 'Rok licencji' : 'Lata licencji';
  $('fromWrap').hidden = view !== 'orszaki';
  $('orsOpts').style.display = view === 'orszaki' ? '' : 'none';
  updateTexts();
  if (state.lastSync) renderBanners(state.lastSync);
  if (state.stale[view]) run();
  else if (view === 'orszaki' && state.orszaki) renderOrszaki(); // rok mógł się zmienić w drugim widoku
}

function updateTexts() {
  const y = year();
  $('intro').textContent = state.view === 'list'
    ? 'Lista osób, które miały licencję w ' + (y - 2) + ' lub ' + (y - 1) +
      ' — z informacją, czy kupiły już licencję na ' + y + '. Osoby rozpoznajemy po adresie e-mail z zamówienia w sklepie.'
    : 'Ile orszaków w każdym województwie ma licencję z wybranych lat — zakres „od–do” ustawiasz powyżej, każdy rok to osobna kolumna. ' +
      'Województwo pochodzi z notatki klienta w Selly.';
  $('yearFrom').value = y - ors.span;
  $('fromNext').disabled = ors.span === 0;
  $('seasonHint').textContent = state.view === 'list'
    ? 'Sezon ' + seasonLabel(y) + ' (1 lip ' + (y - 1) + ' – 30 cze ' + y + ')' + (y === BOOT.year ? ' · bieżący' : '') +
      ' · porównanie z licencjami ' + (y - 2) + ' i ' + (y - 1)
    : (ors.span + 1) + ' ' + plural(ors.span + 1, 'rok', 'lata', 'lat') + ' licencji' +
      ' · sezon ' + seasonLabel(y) + (y === BOOT.year ? ' (bieżący)' : '');
}

const STALE_MS = 36 * 60 * 60 * 1000;

function renderBanners(s) {
  state.lastSync = s;
  const stale = s.phase === 'inc' && s.lastRunMs && Date.now() - s.lastRunMs > STALE_MS;
  if ($('dataInfo')) {
    $('dataInfo').textContent = s.phase === 'inc'
      ? 'stan sklepu z ' + (s.dataUntil || '—') + (s.clientsAt ? ' · notatki klientów: ' + s.clientsAt : '')
      : 'Trwa pierwsze pobieranie danych';
    $('dataDot').className = 'dot' + (s.lastError ? ' err' : stale || s.phase !== 'inc' ? ' stale' : '');
  }
  const box = $('notices');
  box.replaceChildren();
  if (stale) {
    box.append(el('div', { class: 'notice warn', role: 'alert' },
      el('b', null, 'Dane nie były aktualizowane od ' + fmtMs(s.lastRunMs) + '. '),
      'Spróbuj „↻ Odśwież dane”. Jeśli to nie pomaga, automatyczna synchronizacja mogła przestać działać — daj znać administratorowi (wyzwalacz czasowy w projekcie backendu).'));
  }
  if (s.phase === 'full') {
    box.append(el('div', { class: 'notice warn' },
      el('b', null, 'Trwa pierwsze pobieranie danych ze sklepu. '),
      'Raport może być jeszcze niepełny — odśwież stronę za kilka–kilkanaście minut ' +
      '(pobrano zamówienia od ' + s.from.slice(0, 10) + (s.progress ? ' do ' + s.progress.slice(0, 10) : '') + ').'));
  } else if (s.clientsPending && state.view === 'orszaki') {
    box.append(el('div', { class: 'notice warn' },
      el('b', null, 'Trwa pobieranie notatek klientów (województwa). '),
      'Zestawienie może być jeszcze niepełne' + (s.clients ? ' — pobrano ' + s.clients + ' klientów' : '') + '. Odśwież stronę za kilka minut.'));
  }
  if (s.lastError) {
    box.append(el('div', { class: 'notice error' },
      el('b', null, 'Ostatnia synchronizacja ze sklepem nie powiodła się'), ' (' + s.lastErrorAt + '). ',
      'Dane mogą być nieaktualne — daj znać administratorowi. Szczegóły: ' + s.lastError));
  }
  renderHealth(s.health, box);
}

// Health check backendu (Health.gs): problemy z danymi z Selly. Błąd synchronizacji i nieaktualne dane
// mają własne paski wyżej. Ostrzeżenia można ukryć (zapamiętane per problem), awarii nie.
const DISMISS_KEY = 'osa-dismissed';
function renderHealth(h, box) {
  if (!h || !h.issues) return;
  const dismissed = store(DISMISS_KEY) || {};
  for (const i of h.issues) {
    if (i.id === 'sync-error' || i.id === 'stale') continue;
    if (i.level !== 'broken' && dismissed[i.id]) continue;
    const hide = i.level === 'broken' ? null : el('button', { type: 'button', class: 'linkbtn small', title: 'Ukryj to ostrzeżenie na tym urządzeniu (wróci, jeśli problem się pogorszy)' }, 'Ukryj');
    const n = el('div', { class: 'notice ' + (i.level === 'broken' ? 'error' : 'warn'), role: i.level === 'broken' ? 'alert' : null },
      el('b', null, i.title + '. '), i.detail + ' ', hide);
    if (hide) hide.addEventListener('click', () => { dismissed[i.id] = 1; store(DISMISS_KEY, dismissed); n.remove(); });
    box.append(n);
  }
}

// ─── Pobieranie ────────────────────────────────────────────────────────────

const scheduleRun = debounce(run, 400);

function commonParams() {
  const statusIds = [...$('statuses').querySelectorAll('input:checked')].map(c => c.value);
  if (BOOT.statuses.length && !statusIds.length) return { error: 'Zaznacz co najmniej jeden status zamówienia w ustawieniach zaawansowanych.' };
  const out = { statusIds, products: selectedProducts() };
  if (BOOT.packs && BOOT.packs.length && !$('packsOn').checked) out.packs = false; // domyślnie pakiety się liczą
  return out;
}

// Parametry niezależnie od kolejności list (statusy, produkty) — do porównania z widokiem policzonym w init
const canonParams = p => JSON.stringify(p, (k, v) => (Array.isArray(v) && (k === 'statusIds' || k === 'products') ? v.slice().sort()
  : v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o, x) => { o[x] = v[x]; return o; }, {}) : v));

function run() {
  const view = state.view;
  const params = commonParams();
  if (params.error) { showMessage(view, params.error); return; }
  const id = ++state.requestId;
  showLoading(view);
  const action = view === 'list' ? 'report' : 'orszaki';
  const reqParams = view === 'list'
    // catalog / packDefs: konfiguracja z init (arkusz Apps Script / jego kopia w D1) — oba backendy liczą raport tym samym kodem
    ? Object.assign({ year: year(), mode: 'all', catalog: BOOT.products.map(p => ({ code: p.code, name: p.name, year: p.year, counted: p.counted })),
      packDefs: BOOT.packs || [] }, params)
    : params;
  // Pierwsze wyświetlenie: backend policzył już ten widok w init (prefetch) — bez drugiego zapytania, jeśli ustawienia te same
  const pf = BOOT.prefetch;
  BOOT.prefetch = null;
  const req = pf && pf.action === action && canonParams(pf.params) === canonParams(reqParams) ? Promise.resolve(pf.data) : api(action, reqParams);
  req.then(r => {
    if (id !== state.requestId) return;
    state.stale[view] = false;
    if (view === 'list') { state.report = r; render(); } else { state.orszaki = r; renderOrszaki(); }
    renderBanners(r.sync);
  }).catch(err => {
    if (id === state.requestId) showMessage(view, 'Nie udało się przygotować raportu: ' + (err.message || err), true);
  });
}

const resultBox = view => $(view === 'list' ? 'resultList' : 'resultOrszaki');

function showLoading(view) {
  // Przy zmianie ustawień zostaw poprzedni widok, tylko go przygaś
  const wrap = resultBox(view);
  if (view === 'list' ? state.report : state.orszaki) { wrap.style.opacity = .5; return; }
  wrap.replaceChildren(el('div', { class: 'loading' },
    el('div', { class: 'line' }, el('span', { class: 'spinner' }), view === 'list' ? 'Przygotowuję raport…' : 'Przygotowuję zestawienie orszaków…'),
    el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' }), el('div', { class: 'skel' })));
}

function showMessage(view, text, isError) {
  const wrap = resultBox(view);
  wrap.style.opacity = 1;
  if (view === 'list') state.report = null; else state.orszaki = null;
  state.stale[view] = true;
  wrap.replaceChildren(el('div', { class: 'empty' + (isError ? ' error' : '') }, text));
}

// ─── Widok: przedłużenia licencji ──────────────────────────────────────────

function visibleRows() {
  const r = state.report;
  const q = norm(state.query).trim();
  let rows = listSource(r).filter(row =>
    state.list === 'all' || state.list === 'first' || (state.list === 'bought') === row.licenses[2]);
  if (state.woj) rows = rows.filter(row => (row.woj || '') === state.woj);
  if (q) rows = rows.filter(row => norm([row.email, row.firstName, row.lastName, row.phone, wojText(row), row.town].join(' ')).includes(q));
  const { key, dir } = state.sort;
  const val = row => key === 'name' ? norm(row.lastName + ' ' + row.firstName + ' ' + row.email)
    : key === 'date' ? row.purchaseDate || '9999'
    : key === 'woj' ? (wojText(row) ? norm(wojText(row)) : '~')
    : key === 'lic' ? row.licenses.filter(Boolean).length
    : norm(row[key]);
  return rows.slice().sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
}

/** Zakres lat „wcześniejszych” dla kafelka pierwszej licencji, np. „2022–2025” (wg najwcześniejszego roku w danych). */
const listSource = r => state.list === 'first' ? (r.firstRows || []) : state.list === 'all' ? r.rows.concat(r.extraRows || []) : r.rows;

function render() {
  const r = state.report;
  const wrap = $('resultList');
  wrap.style.opacity = 1;
  const [y2, y1, y] = r.years;
  const c = r.counts;

  const tab = (view, n, label, title) => el('button', {
    class: 'tab', type: 'button', 'aria-pressed': String(state.list === view), title,
    onclick: () => { state.list = view; render(); },
  }, el('b', null, String(n)), el('span', null, label));

  const tabs = el('div', { class: 'tabs' },
    tab('notBought', c.notBought, 'nie przedłużyło jeszcze na ' + y + ' (mieli ' + (packsActive([y2, y1, y]) ? 'licencję lub pakiet ' : 'licencję ') + y2 + ' lub ' + y1 + ')', 'Mieli licencję' + (packsActive([y2, y1, y]) ? ' lub pakiet startowy ' : ' ') + y2 + ' lub ' + y1 + ', a licencji ' + y + ' jeszcze nie kupili — do przypomnienia'),
    tab('bought', c.bought, 'przedłużyło na ' + y + ' (mieli ' + (packsActive([y2, y1, y]) ? 'licencję lub pakiet ' : 'licencję ') + y2 + ' lub ' + y1 + ')', 'Mieli licencję' + (packsActive([y2, y1, y]) ? ' lub pakiet startowy ' : ' ') + y2 + ' lub ' + y1 + ' i kupili już licencję ' + y + ' — bez nowych (ci są w kafelku „nowych w ' + y + '”)'),
    tab('first', c.newcomers, 'nowych w ' + y + ' (bez licencji ' + y2 + ' i ' + y1 + ')', 'Kupili licencję ' + y + ', a nie mieli licencji' + (packsActive([y2, y1, y]) ? ' ani pakietu startowego ' : ' ') + y2 + ' ani ' + y1 + ' — nowi względem listy przedłużeń (wcześniejsze lata nie są sprawdzane). Osoby po e-mailu; wliczeni też w „wszyscy”.'),
    tab('all', c.everyone, 'wszyscy z licencją ' + (packsActive([y2, y1, y]) ? 'lub pakietem ' : '') + y2 + ', ' + y1 + ' lub ' + y, 'Wszyscy: osoby (po e-mailu) z licencją' + (packsActive([y2, y1, y]) ? ' lub pakietem startowym ' : ' ') + y2 + ', ' + y1 + ' lub ' + y + ' — czyli lista przedłużeń (' + y2 + ' lub ' + y1 + ') oraz osoby z licencją tylko w ' + y + '. Liczby „nie kupiło” i „kupiło już” dotyczą tylko osób z ' + y2 + ' lub ' + y1 + '.'));

  if (c.base === 0 && state.list !== 'first' && state.list !== 'all') {
    const missing = r.years.slice(0, 2).filter((_, i) => !r.names[i].length);
    wrap.replaceChildren(tabs, el('div', { class: 'empty' },
      r.sync.lines === 0
        ? 'Brak danych o licencjach — sklep nie został jeszcze zsynchronizowany. Spróbuj ponownie za kilka minut.'
        : missing.length
          ? 'Żaden produkt nie liczy się jako licencja ' + missing.join(' ani ') + '. Sprawdź listę produktów w ustawieniach zaawansowanych.'
          : 'Nikt nie kupił licencji ' + y2 + ' ani ' + y1 + ' (w zaznaczonych statusach zamówień).'));
    return;
  }

  const rows = visibleRows();
  const search = el('input', { type: 'search', placeholder: 'Szukaj: nazwisko, e-mail, telefon, województwo…', 'aria-label': 'Szukaj na liście' });
  search.value = state.query;
  search.addEventListener('input', debounce(() => { state.query = search.value; renderTable(); }, 150));
  const wojSel = el('select', { 'aria-label': 'Województwo' });
  const present = new Set(listSource(r).map(row => row.woj || ''));
  wojSel.append(new Option('Wszystkie województwa', ''));
  for (const [k, label] of WOJ) if (present.has(k)) wojSel.append(new Option(label, k));
  if (state.woj && !present.has(state.woj)) state.woj = '';
  wojSel.value = state.woj || '';
  wojSel.addEventListener('change', () => { state.woj = wojSel.value; renderTable(); });

  const sortSel = el('select', { 'aria-label': 'Sortuj według', id: 'sortSel' });
  for (const [k, label] of SORT_LABELS) sortSel.append(new Option('Sortuj: ' + label(r.years[2]), k));
  sortSel.value = state.sort.key;
  sortSel.addEventListener('change', () => { state.sort = { key: sortSel.value, dir: 1 }; renderTable(); });
  const dirBtn = el('button', { type: 'button', class: 'ghost icon', id: 'sortDir', 'aria-label': 'Zmień kierunek sortowania', title: 'Zmień kierunek sortowania',
    onclick: () => { state.sort = { key: state.sort.key, dir: -state.sort.dir }; renderTable(); } });

  const copyMenu = copyMenuButton('copyMenu', () => {
    const rows = visibleRows();
    return { emails: rows.map(r => r.email), phones: rows.map(r => r.phone), table: listTable(rows) };
  }, 'toast');
  const dlMenu = downloadMenuButton('dlMenu', () => listTable(visibleRows()), 'toast');
  state.menus = [copyMenu, dlMenu];

  const toolbar = el('div', { class: 'toolbar' },
    search, wojSel, sortSel, dirBtn,
    el('span', { class: 'muted count', id: 'count' }),
    el('span', { class: 'spacer' }),
    copyMenu, dlMenu);

  const notes = [];
  notes.push('Województwo — z notatki orszaku w Selly (konto kupującego, a gdy go brak — po e-mailu lub telefonie); bez notatki — z kodu pocztowego zamówienia licencji (oznaczenie „kod”).');
  if (c.skippedNoEmail) notes.push('Pominięto ' + c.skippedNoEmail + ' ' + plural(c.skippedNoEmail, 'zakup', 'zakupy', 'zakupów') + ' bez adresu e-mail.');
  notes.push('Dane: ' + (r.sync.dataUntil ? 'stan sklepu z ' + r.sync.dataUntil : 'w trakcie pobierania') + '.');

  wrap.replaceChildren(tabs, toolbar,
    el('div', { class: 'table-wrap' }, el('table', { id: 'table' })),
    el('p', { class: 'muted small', style: 'margin-top:8px' }, notes.join(' ')));
  renderTable(rows);
}

const SORT_LABELS = [
  ['name', () => 'nazwisko'], ['email', () => 'e-mail'], ['woj', () => 'województwo'], ['date', y => 'data zakupu ' + y], ['lic', () => 'liczba licencji'],
];

const wojText = r => WOJ_LABEL[r.woj] || r.wojLabel || '';
function wojCell(r) {
  const t = wojText(r);
  if (!t) return el('span', { class: 'muted' }, '—');
  return el('span', { title: r.town ? 'Orszak: ' + r.town : null }, t,
    r.wojFrom ? el('span', { class: 'tag', style: 'margin-left:6px', title: 'Brak województwa w notatce — przybliżenie wg kodu pocztowego ' + r.wojFrom + ' z zamówienia licencji' }, 'kod') : null,
    r.town ? el('div', { class: 'cell-sub' }, r.town) : null);
}
const orderUrl = id => BOOT.adminUrl + '?a=zamowienia.view&id=' + encodeURIComponent(id);
const clientUrl = id => BOOT.adminUrl + '?a=klienci.view&id=' + encodeURIComponent(id);
function orderLinksCell(r) {
  const links = r.orderLinks || [];
  if (!links.length) return r.orders || '';
  return el('span', null, links.map((o, i) => [i ? ', ' : null,
    el('a', { class: 'ext', href: orderUrl(o.id), target: '_blank', rel: 'noopener', title: 'Otwórz zamówienie w panelu Selly' }, o.number || o.id)]));
}

const yesNo = (v, yes, no) => el('span', { class: 'pill ' + (v ? 'yes' : 'no'), title: v ? yes : no }, v ? '✓' : '—');
/** Licencje z kilku lat jako jedna komórka: małe „pigułki” z rokiem i ✓ / —. */
const LIC_WORD = ys => (packsActive(ys) ? 'Licencja lub pakiet' : 'Licencja');
const licPills = (flags, years, packs) => el('div', { class: 'stack' }, years.map((y, i) => {
  const pk = packs && packs[i];
  if (pk) {
    return el('span', { class: 'lp yes pk', title: packTip(pk, y) }, y + ' ✓ ' + (pk.lic ? 'licencja + pakiet' : 'pakiet'));
  }
  return el('span', { class: 'lp' + (flags[i] ? ' yes' : ''), title: flags[i] ? 'Licencja ' + y + ': kupiona' : 'Licencja ' + y + ': brak' }, y + ' ' + (flags[i] ? '✓' : '—'));
}));
/** Osoba/orszak: pogrubiona nazwa, pod spodem e-mail (mailto, ucinany z title) i telefon (tel). */
function contactLines(email, phone) {
  return [
    email ? el('div', { class: 'cell-sub' }, el('a', { class: 'ell', href: 'mailto:' + email, title: email }, email)) : null,
    phone ? el('div', { class: 'cell-sub' }, el('a', { href: 'tel:' + String(phone).replace(/[^\d+]/g, '') }, phone)) : null,
  ];
}

function columns() {
  const [y2, y1, y] = state.report.years;
  return [
    { key: 'name', label: 'Osoba', render: r => el('div', null,
      el('div', { class: 'cell-name' }, [r.lastName, r.firstName].filter(Boolean).join(' ') || el('span', { class: 'muted' }, '—')),
      contactLines(r.email, r.phone)) },
    { key: 'woj', label: 'Województwo', tip: 'Województwo z notatki orszaku w Selly; „kod” — przybliżenie wg kodu pocztowego z zamówienia licencji. Pod spodem miejscowość orszaku.', render: r => wojCell(r) },
    { key: 'lic', label: packsActive([y2, y1, y]) ? 'Licencja lub pakiet' : 'Licencje', tip: (packsActive([y2, y1, y]) ? 'Licencja lub pakiet startowy ' : 'Licencje ') + y2 + ', ' + y1 + ' i ' + y + ': ✓ kupiona, — brak' +
      (packsActive([y2, y1, y]) ? '; „pakiet” = pakiet startowy (najedź, by zobaczyć składniki)' : '') + '. Sortowanie wg liczby kupionych.', render: r => licPills(r.licenses, [y2, y1, y], r.packs) },
    { key: 'date', label: 'Zakup ' + y, tip: 'Data zakupu licencji ' + y + ', numer zamówienia (link do panelu Selly) i jego status', render: r => r.purchaseDate || r.orders
      ? el('div', null, el('div', { class: 'nw' }, r.purchaseDate || ''),
          el('div', { class: 'cell-sub' }, orderLinksCell(r)),
          r.status ? el('div', { class: 'cell-sub', title: 'Status zamówienia' }, r.status) : null)
      : el('span', { class: 'muted' }, '—') },
  ];
}

function renderTable(rows) {
  rows = rows || visibleRows();
  const table = $('table');
  if (!table) return;
  const r = state.report;
  const total = state.list === 'first' ? r.counts.newcomers : state.list === 'all' ? (r.counts.everyone != null ? r.counts.everyone : r.counts.base) : state.list === 'bought' ? r.counts.bought : r.counts.notBought;
  $('count').textContent = state.query ? 'Znaleziono: ' + rows.length + ' z ' + total : people(rows.length);
  for (const m of state.menus || []) m.setDisabled(rows.length === 0);
  if ($('sortSel')) $('sortSel').value = state.sort.key;
  if ($('sortDir')) $('sortDir').textContent = state.sort.dir > 0 ? '↑' : '↓';

  const cols = columns();
  const head = el('tr');
  for (const col of cols) {
    const tip = col.tip || col.label;
    if (!col.key) { head.append(el('th', null, el('span', { class: col.tip ? 'tip' : null, title: tip }, col.label))); continue; }
    const active = state.sort.key === col.key;
    head.append(el('th', { 'aria-sort': active ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: col.tip ? 'tip' : null, title: tip + '\n\n' + (active ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'), onclick: () => {
        state.sort = { key: col.key, dir: active ? -state.sort.dir : 1 };
        renderTable();
      } }, col.label + (active ? (state.sort.dir > 0 ? ' ↑' : ' ↓') : ''))));
  }

  const body = el('tbody');
  if (!rows.length) {
    const msg = state.query ? 'Nikt nie pasuje do wyszukiwania „' + state.query + '”.'
        : state.list === 'first' ? 'Nikt nie kupił licencji ' + r.year + ' po raz pierwszy.'
      : state.list === 'notBought' ? 'Wszyscy z listy kupili już licencję ' + r.year + '. 🎉'
      : 'Nikt z listy nie kupił jeszcze licencji ' + r.year + '.';
    body.append(el('tr', null, el('td', { colspan: cols.length, class: 'empty' }, msg)));
  }
  for (const row of rows) {
    const tr = el('tr');
    for (const col of cols) tr.append(el('td', null, col.render(row)));
    body.append(tr);
  }
  table.replaceChildren(el('thead', null, head), body);
}

/** Tabela eksportu listy przedłużeń (ten sam układ dla CSV, Excela i schowka). */
function listTable(rowsIn) {
  const r = state.report;
  const [y2, y1, y] = r.years;
  const yn = b => (b ? 'tak' : 'nie');
  const columns = [
    { header: 'Email', type: 'text' }, { header: 'Imię', type: 'text' }, { header: 'Nazwisko', type: 'text' }, { header: 'Telefon', type: 'text' },
    { header: 'client_id', type: 'text' }, { header: 'Województwo', type: 'text' }, { header: 'Województwo wg', type: 'text' }, { header: 'Miejscowość orszaku', type: 'text' },
    { header: LIC_WORD([y2]) + ' ' + y2, type: 'center' }, { header: LIC_WORD([y1]) + ' ' + y1, type: 'center' }, { header: LIC_WORD([y]) + ' ' + y, type: 'center' },
    { header: 'Data zakupu ' + y, type: 'date' }, { header: 'Zamówienie ' + y, type: 'link' }, { header: 'Kolejne zamówienia ' + y, type: 'text' },
    { header: 'Status ' + y, type: 'text' }, { header: 'Sztuk ' + y, type: 'number' },
  ];
  const rows = (rowsIn || visibleRows()).map(row => {
    const links = row.orderLinks || [];
    const first = links[0];
    const order = first ? { text: first.number || first.id, url: orderUrl(first.id) } : row.orders || '';
    return [row.email, row.firstName, row.lastName, row.phone, row.clientId,
      wojText(row), row.wojFrom ? 'kod pocztowy ' + row.wojFrom : wojText(row) ? 'notatka' : '', row.town || '',
      yn(row.licenses[0]), yn(row.licenses[1]), yn(row.licenses[2]),
      row.purchaseDate, order, links.slice(1).map(o => o.number || o.id).join(', '), row.status, row.quantity || ''];
  });
  const name = { notBought: 'nie-kupili', bought: 'kupili', all: 'wszyscy', first: 'pierwsza-licencja' }[state.list];
  return { file: 'licencje-otk-' + r.year + '-' + name, sheet: 'Przedłużenia ' + r.year, columns, rows };
}

// ─── Widok: orszaki wg województw ──────────────────────────────────────────
//
// Serwer zwraca fakty o każdym orszaku (lata licencji, sezony z zamówieniem, notatka, tagi);
// kryteria liczymy tutaj, więc przełączanie opcji działa od razu. Każdy orszak liczy się
// w zestawieniu raz — także gdy spełnia kilka kryteriów naraz (nie sumujemy kryteriów).

const WOJ = [
  ['dolnoslaskie', 'dolnośląskie'], ['kujawsko-pomorskie', 'kujawsko-pomorskie'], ['lubelskie', 'lubelskie'],
  ['lubuskie', 'lubuskie'], ['lodzkie', 'łódzkie'], ['malopolskie', 'małopolskie'], ['mazowieckie', 'mazowieckie'],
  ['opolskie', 'opolskie'], ['podkarpackie', 'podkarpackie'], ['podlaskie', 'podlaskie'], ['pomorskie', 'pomorskie'],
  ['slaskie', 'śląskie'], ['swietokrzyskie', 'świętokrzyskie'], ['warminsko-mazurskie', 'warmińsko-mazurskie'],
  ['wielkopolskie', 'wielkopolskie'], ['zachodniopomorskie', 'zachodniopomorskie'], ['inne - zagranica', 'zagranica'],
];
const WOJ_LABEL = Object.fromEntries(WOJ);
const NO_WOJ = '';    // notatka bez województwa (albo kupujący bez notatki)
const UNKNOWN = '?';  // województwo w notatce, ale nie da się go dopasować do żadnego z 16
const UNLINKED = '!'; // lista kupujących spełniających kryteria, którzy nie są orszakami (bez notatki i licencji)
// Wiersz zestawienia dla orszaka. Starsze dane z backendu mogą mieć klucz typu „mazowieckie.” — to też „nierozpoznane”.
const wojGroup = e => (WOJ_LABEL[e.woj] ? e.woj : e.woj || e.wojLabel ? UNKNOWN : NO_WOJ);
// Orszak = klient z miejscowością / województwem w notatce albo kupujący licencję (także bez konta w sklepie)
const isOrszak = e => !!(e.reg || (e.lic && e.lic.length));

const ORS_PREFS = 'otk-orszaki-v2';
const MAX_SPAN = 10; // najwyżej tyle lat wstecz w zakresie „od–do”
const ors = Object.assign(
  { lic: true, span: 0, ord: false, mode: 'any', reg: true, excl: [], stEx: [], cols: { u: false, known: true }, filt: {} },
  store(ORS_PREFS) || {},
  { woj: null, list: 'active', query: '', sort: 'main', sortDir: 0, dsort: { key: 'town', dir: 1 }, stOpen: false, reopen: null });

function saveOrs() {
  store(ORS_PREFS, { lic: ors.lic, span: ors.span, ord: ors.ord, mode: ors.mode, reg: ors.reg, excl: ors.excl, stEx: ors.stEx,
    cols: ors.cols, filt: ors.filt });
}

/**
 * Status licencji orszaka z lat `years`: status najnowszego liczonego zamówienia licencji
 * (licOrders są posortowane po dacie); '?' gdy brak szczegółów zamówienia; null gdy brak licencji.
 */
const licStatus = (e, years) => {
  if (!e.lic || !years.some(y => e.lic.indexOf(y) >= 0)) return null;
  const os = (e.licOrders || []).filter(o => !o.x && years.indexOf(o.y) >= 0);
  return os.length ? String(os[os.length - 1].st) : '?';
};

/** Lata licencji z zakresu u góry strony: od (Y − span) do Y. */
const rangeYears = Y => { const ys = []; for (let y = Y - ors.span; y <= Y; y++) ys.push(y); return ys; };

/**
 * Warunki zestawienia = kolumny tabeli województw: każdy rok licencji z zakresu osobno, potem
 * (opcjonalnie) zamówienie w sezonie. Orszak „liczony” (lista, kolumna unikatowych) spełnia
 * którykolwiek albo wszystkie warunki — ors.mode.
 */
function units(Y) {
  const ex = new Set(ors.stEx);
  const out = [];
  if (ors.lic) for (const y of rangeYears(Y)) {
    out.push({ grp: packsActive([y]) ? 'Licencja lub pakiet' : 'Licencja', head: String(y), short: LIC_WORD([y]) + ' ' + y,
      title: 'Orszaki z licencją członkowską ' + (packsActive([y]) ? '(lub pakietem startowym) ' : '') + y + (ex.size ? ' (bez odznaczonych statusów zamówień)' : '') + '. Orszak z licencjami z kilku lat jest w kilku kolumnach.',
      test: e => { const s = licStatus(e, [y]); return s !== null && !ex.has(s); } });
  }
  if (ors.ord) out.push({ grp: 'Zamówienie', head: seasonLabel(Y), short: 'Zamówienie ' + seasonLabel(Y),
    title: 'Dowolne zamówienie (dowolny produkt) od 1 lipca ' + (Y - 1) + ' do 30 czerwca ' + Y,
    test: e => (e.ord || []).indexOf(Y) >= 0 });
  return out;
}

const PRESETS = Y => [
  { label: 'Licencja ' + Y, set: { lic: true, span: 0, ord: false }, title: 'Tylko licencja ' + Y + ' — jedna kolumna' },
  { label: 'Licencje z ostatnich 3 lat', set: { lic: true, span: 2, ord: false, mode: 'any' }, title: 'Lata ' + (Y - 2) + '–' + Y + ', każdy rok w osobnej kolumnie' },
  { label: 'Przedłużyli licencję', set: { lic: true, span: 1, ord: false, mode: 'all' }, title: 'Licencja ' + (Y - 1) + ' i licencja ' + Y },
  { label: 'Kupowali w sezonie ' + seasonLabel(Y), set: { lic: false, ord: true }, title: 'Dowolne zamówienie (np. korony) od 1 lipca ' + (Y - 1) + ' do 30 czerwca ' + Y + ', bez względu na licencję' },
  { label: 'Wszystkie znane orszaki', set: { lic: false, ord: false, reg: true }, title: 'Każdy orszak (notatka orszaku albo zakupiona licencja), bez warunków' },
];

function presetMatches(set) {
  const n = (ors.lic ? ors.span + 1 : 0) + (ors.ord ? 1 : 0);
  for (const k in set) {
    if (k === 'mode' && n < 2) continue; // przy jednym warunku łączenie nie ma znaczenia
    if (k === 'span' && !ors.lic) continue;
    if (ors[k] !== set[k]) return false;
  }
  return true;
}

/**
 * Nazwa grupy orszaków „liczonych” (dawniej „aktywne”) zależna od konfiguracji — żeby w każdym
 * ustawieniu było jasne, kto to jest. { yes: „z licencją 2025–2027”, no: „bez licencji 2025–2027” }.
 */
function countedName(C) {
  const ys = C.ys, all = ors.mode === 'all' && C.U.length > 1;
  if (!C.U.length) return { yes: 'wszystkie znane orszaki', no: 'pozostałe' };
  const pk = packsActive(ys), L = pk ? 'licencją lub pakietem' : 'licencją';
  const lic = !ors.lic ? '' : ys.length === 1 ? L + ' ' + ys[0] : all ? L + ' co roku ' + yearsLabel(ys) : L + ' ' + yearsLabel(ys);
  const ord = ors.ord ? 'zamówieniem ' + seasonLabel(C.Y) : '';
  if (lic && !ord) {
    if (all && ys.length === 2) return { yes: 'przedłużyli (' + (pk ? 'licencja lub pakiet ' : 'licencja ') + ys[0] + ' i ' + ys[1] + ')', no: 'nie przedłużyli' };
    return { yes: 'z ' + lic, no: all ? 'pozostałe' : 'bez ' + lic.replace(L, pk ? 'licencji lub pakietu' : 'licencji') };
  }
  if (ord && !lic) return { yes: 'z ' + ord, no: 'bez ' + ord.replace('zamówieniem', 'zamówienia') };
  return { yes: 'z ' + lic + (all ? ' i ' : ' lub ') + ord, no: 'pozostałe' };
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// Kolumna unikatowych: tylko gdy jest co scalać (kilka kolumn); bez warunków to jedyna kolumna liczb
const uShown = C => !C.U.length || (C.U.length > 1 && !!ors.cols.u);
const uTitle = C => !C.U.length ? 'Wszystkie znane orszaki w wierszu (bez warunków)'
  : ors.mode === 'any'
    ? 'Każdy orszak liczony raz — także gdy ma licencje z kilku lat' + (ors.ord ? ' albo też zamówienie w sezonie' : '') +
      '. Suma kolumn obok bywa większa, bo jeden orszak może być w kilku.'
    : 'Orszaki spełniające wszystkie warunki naraz: ' + C.U.map(t => t.short).join(' + ') + '.';
const KNOWN_TITLE = 'Wszystkie znane orszaki w wierszu — niezależnie od wybranych lat i warunków: klienci z miejscowością lub województwem w notatce ' +
  'oraz kupujący licencję z dowolnego roku (bez pominiętych tagami). Zmienia się tylko po zmianie tagów lub danych w sklepie.';

/** Liczy zestawienie dla bieżących opcji. */
function computeOrszaki() {
  const Y = year();
  const ys = rangeYears(Y);
  const U = units(Y);
  const excl = new Set(ors.excl), stEx = new Set(ors.stEx);
  const groups = new Map();
  const group = key => {
    if (!groups.has(key)) groups.set(key, { key, u: 0, tc: U.map(() => 0), known: 0, label: '', values: new Map() });
    return groups.get(key);
  };
  const stats = { pop: 0, u: 0, multi: 0, known: 0, tc: U.map(() => 0), licAny: 0, fromPostcode: 0,
    status: new Map() }; // liczniki statusów licencji — także odznaczonych, żeby było widać, ile odpada
  const tagCounts = new Map();
  const activeSet = new Set();
  const unlinked = [];

  for (const e of state.orszaki.orszaki) {
    // Wpisy tylko z zamówieniami licencji w nieliczonych statusach (licOrders) służą wyłącznie do „Do sprawdzenia”
    if (!e.reg && !(e.lic && e.lic.length) && !(e.ord && e.ord.length)) continue;
    if (isOrszak(e)) for (const t of e.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    if ((e.tags || []).some(t => excl.has(t))) continue;
    const hits = U.map(t => t.test(e));
    const n = hits.filter(Boolean).length;
    const active = U.length === 0 ? true : ors.mode === 'any' ? n > 0 : n === U.length;
    if (ors.reg && !isOrszak(e)) {
      // Spełnia warunki, ale nie wiemy, z którego jest województwa — pokazujemy osobno, nie gubimy po cichu
      if (U.length && active) unlinked.push(e);
      continue;
    }
    stats.pop++;
    const g = group(wojGroup(e));
    if (g.key === UNKNOWN) { const v = e.wojLabel || e.woj; g.values.set(v, (g.values.get(v) || 0) + 1); }
    if (isOrszak(e)) { g.known++; stats.known++; if (e.wojFrom) stats.fromPostcode++; }
    hits.forEach((h, j) => { if (h) { g.tc[j]++; stats.tc[j]++; } });
    if (ors.lic) {
      const st = licStatus(e, ys);
      if (st !== null) {
        stats.status.set(st, (stats.status.get(st) || 0) + 1);
        if (!stEx.has(st)) stats.licAny++;
      }
    }
    if (active) {
      activeSet.add(e);
      stats.u++;
      g.u++;
      if (n > 1) stats.multi++;
    }
  }
  for (const [k] of WOJ) group(k).label = WOJ_LABEL[k];
  group(UNKNOWN).label = 'nierozpoznane województwo';
  group(NO_WOJ).label = 'bez województwa';
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  for (const t of ors.excl) if (!tags.some(x => x[0] === t)) tags.push([t, 0]);
  return { Y, ys, U, groups: [...groups.values()], stats, tags, activeSet, unlinked };
}

/** Zdanie: kogo liczymy na liście „liczone” i w kolumnie unikatowych. */
function definitionText(C) {
  const excl = ors.excl.length ? ' (bez oznaczonych ' + ors.excl.map(t => '#' + t).join(', ') + ')' : '';
  if (!C.U.length) return 'Liczymy każdy ' + (ors.reg ? 'znany orszak' : 'klient sklepu') + excl + ' — bez warunków.';
  const parts = [];
  if (ors.lic) {
    const st = ors.stEx.length ? ' (bez statusu ' + ors.stEx.map(s => '„' + (s === '?' ? 'nieznany' : statusName(s)) + '”').join(', ') + ')' : '';
    parts.push((C.ys.length === 1 ? 'licencję ' + C.ys[0]
      : ors.mode === 'any' ? 'licencję ' + orList(C.ys) : 'licencję z każdego roku: ' + orList(C.ys, 'i')) + st);
  }
  if (ors.ord) parts.push('zamówienie w sezonie ' + seasonLabel(C.Y));
  return (ors.reg ? 'Orszak' : 'Klient sklepu') + excl + ' jest liczony, jeśli ma ' + parts.join(ors.mode === 'any' ? ' lub ' : ' oraz ') + '.';
}

function renderOrszaki() {
  const wrap = $('resultOrszaki');
  wrap.style.opacity = 1;
  const data = state.orszaki;
  if (!data.orszaki.length) {
    wrap.replaceChildren(el('div', { class: 'empty' }, data.sync.clientsPending
      ? 'Notatki klientów jeszcze się pobierają — spróbuj ponownie za kilka minut.'
      : 'Brak danych o klientach i zamówieniach.'));
    return;
  }
  const C = computeOrszaki();
  const { Y, U } = C;
  const set = patch => { Object.assign(ors, patch); saveOrs(); updateTexts(); renderOrszaki(); };
  advancedPanel(C, set); // treść w panelu „Ustawienia zaawansowane” u góry strony

  if (!U.length && !ors.reg) {
    wrap.replaceChildren(el('div', { class: 'empty' },
      'Zaznacz licencję, zamówienie w sezonie albo „Tylko orszaki” (wtedy policzymy wszystkie znane orszaki) — w „⚙ Ustawienia zaawansowane” u góry strony.'));
    afterRender();
    return;
  }

  let missing = null;
  if (C.unlinked.length) {
    const n = C.unlinked.length;
    missing = el('div', { class: 'notice warn' },
      el('b', null, '⚠ ' + n + ' ' + plural(n, 'kupujący spełnia', 'kupujących spełnia', 'kupujących spełnia') + ' warunki, ale nie ma ' +
        plural(n, 'go', 'ich', 'ich') + ' w zestawieniu. '),
      'Nie są orszakami: nie mają notatki orszaku ani zakupionej licencji (np. kupili tylko korony). ' +
      'Jeśli to orszak — uzupełnij notatkę u klienta w Selly. ',
      el('button', { type: 'button', class: 'link', onclick: () => {
        ors.woj = UNLINKED; ors.list = 'active'; ors.query = ''; renderOrszaki();
        const d = $('detail'); if (d) d.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } }, 'Pokaż listę'));
  }
  const what = ors.lic ? 'z licencją ' + (packsActive(C.ys) ? 'lub pakietem ' : '') + yearsLabel(C.ys) : ors.ord ? 'z zamówieniem w sezonie ' + seasonLabel(Y) : '';
  // replaceChildren zamienia null na tekst „null” — puste sekcje odfiltrowujemy
  const result = sectionCard(1, 'Orszaki ' + (what ? what + ' ' : '') + 'wg województw',
    'Każda kolumna liczona osobno. Kliknij wiersz, żeby w sekcji 2 zobaczyć listę orszaków z tego województwa.', '',
    ...[summaryTiles(C), missing, renderWojTable(C)].filter(Boolean));
  wrap.replaceChildren(result, renderDetail(C), renderAnomalies(Y));
  afterRender();
}

// Menu z polami wyboru było otwarte przed przeliczeniem — DOM jest budowany od nowa, więc otwieramy je ponownie
function afterRender() {
  const r = ors.reopen;
  ors.reopen = null;
  if (r && $(r.id) && $(r.id).menuOpen) $(r.id).menuOpen(r.idx);
}

/** Kafelki nad tabelą: liczba orszaków w każdej kolumnie (rok licencji, zamówienie), unikatowe, w bazie. */
function summaryTiles(C) {
  const { U, stats } = C;
  const tile = (n, label, title) => el('div', { class: 'tab static', title }, el('b', null, String(n)), el('span', null, label));
  const tiles = U.map((t, j) => tile(stats.tc[j], t.short, t.title));
  if (uShown(C)) tiles.push(tile(stats.u, U.length ? cap(countedName(C).yes) + ' (unikatowe)' : 'orszaki', uTitle(C)));
  if (ors.cols.known) tiles.push(tile(stats.known, 'w bazie (wszystkie znane)', KNOWN_TITLE));
  return el('div', { id: 'orsSummary' }, el('div', { class: 'tabs' }, tiles));
}

/** „Kogo liczymy” w panelu „Ustawienia zaawansowane” (widok orszaków): szybkie wybory, warunki, łączenie, zawężenie. */
function advancedPanel(C, set) {
  const { Y, ys, U, stats } = C;

  const presets = el('div', { class: 'presets' }, el('span', { class: 'muted small' }, 'Szybki wybór:'),
    PRESETS(Y).map(p => el('button', { type: 'button', class: 'chip', title: p.title, 'aria-pressed': String(presetMatches(p.set)),
      onclick: () => set(p.set) }, p.label)));

  const critCard = c => {
    const cb = el('input', { type: 'checkbox', 'aria-describedby': 'crit-' + c.key + '-d', 'aria-labelledby': 'crit-' + c.key + '-t' });
    cb.checked = c.on;
    cb.addEventListener('change', () => set({ [c.key]: cb.checked }));
    // Cała karta przełącza warunek — poza kontrolkami w środku (statusy)
    return el('div', { class: 'crit' + (c.on ? ' on' : ''),
      onclick: ev => { if (!ev.target.closest('input, button, a, details')) cb.click(); } },
      el('span', { class: 'count', title: 'Ile orszaków spełnia ten warunek' }, c.on ? String(c.count) : ''),
      el('div', { class: 'title' }, cb, el('span', { id: 'crit-' + c.key + '-t' }, c.title)),
      el('div', { class: 'desc', id: 'crit-' + c.key + '-d' }, c.desc),
      c.extra, c.warn ? el('div', { class: 'hint warn' }, c.warn) : null);
  };
  const cards = [
    critCard({ key: 'lic', on: ors.lic, count: stats.licAny,
      title: (packsActive(ys) ? 'Licencja lub pakiet z ' : 'Licencja z ') + (ys.length > 1 ? 'lat ' + yearsLabel(ys) : 'roku ' + Y),
      desc: 'Kupił licencję członkowską' + (packsActive(ys) ? ' albo pakiet startowy ' : ' ') + orList(ys) + '. Zakres lat ustawiasz u góry strony (od–do); każdy rok to osobna kolumna tabeli.',
      extra: ors.lic ? statusFilter(stats.status, set) : null,
      warn: ors.lic ? coverageWarning(ys[0], state.orszaki.dataFrom, 'licencji ' + ys[0]) : '' }),
    critCard({ key: 'ord', on: ors.ord, count: ors.ord ? stats.tc[U.length - 1] : 0,
      title: 'Zamówienie w sezonie ' + seasonLabel(Y),
      desc: 'Dowolne zamówienie (dowolny produkt) od 1 lipca ' + (Y - 1) + ' do 30 czerwca ' + Y + '. Osobna kolumna tabeli.',
      warn: ors.ord ? coverageWarning(Y, state.orszaki.dataFrom, 'tego sezonu') : '' }),
  ];

  const modeRow = el('div', { class: 'row' },
    el('span', { class: 'small', style: 'font-weight:600' }, 'Gdy warunków jest kilka (kilka lat, zamówienie):'),
    el('span', { class: 'seg', role: 'group', 'aria-label': 'Łączenie warunków' },
      el('button', { type: 'button', 'aria-pressed': String(ors.mode === 'any'), disabled: U.length < 2,
        title: 'Orszak jest liczony, jeśli spełnia co najmniej jeden warunek (np. licencja z któregokolwiek roku)', onclick: () => set({ mode: 'any' }) },
        'wystarczy którykolwiek (LUB)'),
      el('button', { type: 'button', 'aria-pressed': String(ors.mode === 'all'), disabled: U.length < 2,
        title: 'Orszak jest liczony, jeśli spełnia wszystkie warunki (np. licencja z każdego roku)', onclick: () => set({ mode: 'all' }) },
        'muszą być wszystkie (I)')),
    el('span', { class: 'small muted' }, U.length < 2 ? 'dotyczy kilku lat lub licencji z zamówieniem'
      : 'wpływa na kolumnę „(unikatowe)” i podział listy orszaków'));

  // Zawężenie: notatka orszaku + tagi
  const regCb = el('input', { type: 'checkbox' });
  regCb.checked = ors.reg;
  regCb.addEventListener('change', () => set({ reg: regCb.checked }));
  const scope = el('div', { class: 'row' },
    el('label', { title: 'Orszak = klient Selly z miejscowością orszaku lub województwem w notatce albo kupujący licencję (także bez konta). Bez tej opcji liczą się też pozostali kupujący (np. tylko korony), w wierszu „bez województwa”.' },
      regCb, 'Tylko orszaki: z miejscowością lub województwem w notatce albo z zakupioną licencją (także bez konta)'),
    C.tags.length ? el('span', { class: 'presets' }, el('span', { class: 'small muted' }, 'Pomiń oznaczonych:'),
      C.tags.map(([t, n]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(ors.excl.indexOf(t) >= 0),
        title: n + ' ' + plural(n, 'orszak', 'orszaki', 'orszaków') + ' z tagiem #' + t,
        onclick: () => set({ excl: ors.excl.indexOf(t) >= 0 ? ors.excl.filter(x => x !== t) : ors.excl.concat(t) }) }, '#' + t))) : null);

  $('orsOpts').replaceChildren(el('div', { id: 'orsOptsBody' },
    el('span', { class: 'label' }, 'Kogo liczymy w zestawieniu orszaków'),
    el('p', { class: 'muted small' }, definitionText(C)),
    el('fieldset', null, el('legend', { class: 'sr-only' }, 'Kogo liczymy'),
      presets, el('div', { class: 'crit-grid' }, cards), modeRow, scope)));
}

/**
 * Zwijany wybór statusów licencji w karcie warunku. Liczby = orszaki z licencją z lat zakresu
 * wg statusu najnowszego zamówienia licencji (także odznaczone statusy — widać, ile odpada).
 */
function statusFilter(counts, set) {
  const ex = ors.stEx;
  const ids = [...counts.keys()].concat(ex.filter(s => !counts.has(s)));
  if (!ids.length) return null;
  ids.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
  const name = s => (s === '?' ? 'nieznany' : statusName(s));
  const update = next => set({ stEx: next });
  const on = ids.filter(s => ex.indexOf(s) < 0);
  const sum = ex.length
    ? el('span', { class: 'sum' }, el('b', null, on.length + ' z ' + ids.length), ' — bez: ' + ex.map(name).join(', '))
    : el('span', { class: 'sum' }, 'wszystkie (' + ids.length + ')');
  const det = el('details', { class: 'fold st-fold', open: !!ors.stOpen },
    el('summary', null, el('span', null, 'Statusy licencji'), sum),
    el('div', { class: 'st-list' },
      ids.map(s => {
        const box = el('input', { type: 'checkbox', value: s });
        box.checked = ex.indexOf(s) < 0;
        box.addEventListener('change', () => update(box.checked ? ex.filter(x => x !== s) : ex.concat(s)));
        return el('label', null, box, name(s) + ' ', el('b', null, String(counts.get(s) || 0)));
      }),
      ex.length ? el('button', { type: 'button', class: 'link', onclick: () => update([]) }, 'zaznacz wszystkie') : null));
  det.addEventListener('toggle', () => { ors.stOpen = det.open; });
  return det;
}

/** Karta sekcji widoku orszaków: numer kroku, tytuł, jednozdaniowe wyjaśnienie. */
function sectionCard(step, title, sub, extraClass, ...body) {
  return el('section', { class: 'card' + (extraClass ? ' ' + extraClass : '') },
    el('div', { class: 'card-head' },
      el('h2', null, step ? el('span', { class: 'step', 'aria-hidden': 'true' }, String(step)) : null, title),
      sub ? el('p', { class: 'sub' }, sub) : null),
    ...body);
}

// Licencję na rok L kupuje się zwykle od lipca L−1; zamówienia sezonu Y — od 1 lipca Y−1
function coverageWarning(first, dataFrom, what) {
  if (!dataFrom) return '';
  return dataFrom > (first - 1) + '-07-01' ? 'Dane ze sklepu są od ' + dataFrom + ' — wynik dla ' + what + ' może być niepełny.' : '';
}

/**
 * Menu z polami wyboru (Kolumny ▾ / Filtry ▾). Zmiana pola przelicza widok (rerender), a menu
 * otwiera się ponownie z fokusem na tym samym polu. items(): [{ label, note, title, checked, disabled, count, onChange }].
 */
function checkMenu({ id, label, title, cls, items, rerender }) {
  const btn = el('button', { type: 'button', class: cls || 'secondary', id, title, 'aria-haspopup': 'true', 'aria-expanded': 'false' },
    label, el('span', { class: 'caret', 'aria-hidden': 'true' }, '▾'));
  const pop = el('div', { class: 'menu-pop wide', role: 'group', 'aria-label': label, hidden: true });
  const wrap = el('span', { class: 'menu' }, btn, pop);
  const isOpen = () => !pop.hidden;
  const onDoc = ev => { if (!wrap.isConnected || !wrap.contains(ev.target)) close(false); };
  function close(refocus) {
    if (!isOpen()) return;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', onDoc, true);
    if (refocus) btn.focus();
  }
  function open(focusIdx) {
    pop.replaceChildren(...items().map((it, i) => {
      const cb = el('input', { type: 'checkbox', disabled: !!it.disabled });
      cb.checked = !!it.checked;
      cb.addEventListener('change', () => { it.onChange(cb.checked); saveOrs(); ors.reopen = { id, idx: i }; rerender(); });
      return el('label', { class: 'menu-check' + (it.disabled ? ' dis' : ''), title: it.title },
        cb, el('span', null, it.label, it.note ? el('span', { class: 'menu-note' }, it.note) : null),
        it.count == null ? null : el('span', { class: 'menu-count', title: 'Ile pozycji to dotyczy' }, String(it.count)));
    }));
    pop.style.transform = '';
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const r = pop.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.left < 8) dx = 8 - r.left;
    if (r.right + dx > vw - 8) dx = vw - 8 - r.right;
    if (dx) pop.style.transform = 'translateX(' + Math.round(dx) + 'px)';
    document.addEventListener('mousedown', onDoc, true);
    const boxes = [...pop.querySelectorAll('input')];
    const f = boxes[focusIdx || 0];
    (f && !f.disabled ? f : boxes.find(b => !b.disabled) || btn).focus();
  }
  btn.addEventListener('click', () => (isOpen() ? close(true) : open()));
  wrap.addEventListener('keydown', ev => { if (ev.key === 'Escape' && isOpen()) { ev.preventDefault(); ev.stopPropagation(); close(true); } });
  wrap.addEventListener('focusout', ev => { if (isOpen() && ev.relatedTarget && !wrap.contains(ev.relatedTarget)) close(false); });
  btn.menuOpen = open;
  return wrap;
}

/**
 * Tabela: 16 województw + zagranica, „Razem w województwach”, potem wiersze spoza województw
 * (nierozpoznane, bez województwa) i „Razem” = suma WSZYSTKICH wierszy powyżej — każdy orszak
 * jest w dokładnie jednym wierszu, więc sumy się zgadzają. Kolumny: każdy rok licencji z zakresu,
 * zamówienie w sezonie, opcjonalnie unikatowe i „w bazie” (menu „Kolumny”).
 */
function renderWojTable(C) {
  const { stats, U } = C;
  const cols = U.map((t, j) => ({ key: 'c' + j, grp: t.grp, head: t.head, title: t.title, val: g => g.tc[j] }));
  if (uShown(C)) cols.push({ key: 'u', head: U.length ? cap(countedName(C).yes) + ' (unikatowe)' : 'Orszaki', title: uTitle(C), val: g => g.u });
  if (ors.cols.known) cols.push({ key: 'known', head: 'W bazie', title: KNOWN_TITLE, val: g => g.known });
  // Kolumna z paskiem: unikatowe, a bez nich — najnowszy rok (ostatnia kolumna warunków)
  const mainKey = uShown(C) ? 'u' : 'c' + (U.length - 1);
  if (ors.sort !== 'name' && ors.sort !== 'main' && !cols.some(c => c.key === ors.sort)) { ors.sort = 'main'; ors.sortDir = 0; }
  const sortKey = ors.sort === 'main' ? mainKey : ors.sort;
  const sortCol = cols.find(c => c.key === sortKey);
  // Kierunek: domyślnie nazwy rosnąco, liczby malejąco; ponowny klik w ten sam nagłówek odwraca
  const sortDir = ors.sortDir || (sortKey === 'name' ? 1 : -1);
  const mainCol = cols.find(c => c.key === mainKey);

  const byLabel = (a, b) => a.label.localeCompare(b.label, 'pl');
  const main = C.groups.filter(g => WOJ_LABEL[g.key])
    .sort(sortKey === 'name' ? (a, b) => byLabel(a, b) * sortDir : (a, b) => (sortCol.val(a) - sortCol.val(b)) * sortDir || byLabel(a, b));
  const extra = [UNKNOWN, NO_WOJ].map(k => C.groups.find(g => g.key === k)).filter(g => g && (g.u || g.known || g.tc.some(Boolean)));
  const max = Math.max(1, ...main.concat(extra).map(mainCol.val));
  const barW = cols.length >= 4 ? 70 : 120;
  const sum = (gs, f) => gs.reduce((s, g) => s + f(g), 0);
  const sepAt = j => j === 0 || cols[j - 1].grp !== cols[j].grp || !cols[j].grp;
  const cls = (c, j) => (c.key === mainKey ? 'bar-cell' : 'n') + ' tc' + (sepAt(j) ? ' sep' : '');

  const ariaSort = key => (sortKey === key ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
  // Tooltip z wyjaśnieniem kolumny musi być na przycisku — jego własny „Sortuj” przykrywał tooltip nagłówka
  const sortBtn = (key, label, tip) => el('button', { type: 'button', class: tip ? 'tip' : null, title: (tip ? tip + '\n\n' : '') + (sortKey === key ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
    onclick: () => { if (sortKey === key) ors.sortDir = -sortDir; else { ors.sort = key; ors.sortDir = 0; } renderOrszaki(); } },
    label + (sortKey === key ? (sortDir > 0 ? ' ↑' : ' ↓') : ''));
  const two = cols.some(c => c.grp);
  const rs = two ? { rowspan: '2' } : {};
  const r1 = [el('th', Object.assign({ 'aria-sort': ariaSort('name') }, rs), sortBtn('name', 'Województwo',
    'Województwo orszaku z notatki klienta w Selly (gdy brak — z kodu pocztowego zamówienia licencji). Kliknij wiersz, żeby zobaczyć listę orszaków.'))];
  for (let j = 0; j < cols.length;) {
    const c = cols[j];
    if (c.grp) {
      // Wspólny nagłówek nad kolejnymi kolumnami z tej samej grupy (Licencja / Zamówienie)
      let k = j; while (k < cols.length && cols[k].grp === c.grp) k++;
      const grpTip = (c.grp === 'Licencja' ? 'Liczba orszaków z licencją członkowską z danego roku.' : 'Liczba orszaków z dowolnym zamówieniem w sezonie.') +
        (k - j > 1 ? ' Każda kolumna liczona osobno — orszak może być w kilku.' : '');
      r1.push(el('th', { class: 'grp sep', colspan: String(k - j) }, el('span', { class: 'tip', title: grpTip }, c.grp)));
      j = k;
    } else {
      r1.push(el('th', Object.assign({ class: cls(c, j) + ' wrap', 'aria-sort': ariaSort(c.key) }, rs), sortBtn(c.key, c.head, c.title)));
      j++;
    }
  }
  const head = [el('tr', null, r1)];
  if (two) head.push(el('tr', { class: 'sub' }, cols.map((c, j) => c.grp
    ? el('th', { class: cls(c, j), 'aria-sort': ariaSort(c.key) }, sortBtn(c.key, c.head, c.title)) : null)));

  const cell = (c, j, n) => el('td', { class: cls(c, j) }, c.key === mainKey
    ? [el('b', null, String(n)), el('span', { class: 'bar', style: 'width:' + Math.round((n / max) * barW) + 'px' })]
    : String(n));
  const row = g => {
    const selected = ors.woj === g.key;
    let label = g.label;
    if (g.key === UNKNOWN) {
      const vals = [...g.values.entries()].sort((a, b) => b[1] - a[1]);
      label = el('span', null, el('span', { class: 'muted' }, g.label), el('br'),
        el('span', { class: 'small muted' }, vals.slice(0, 4).map(([v, n]) => '„' + v + '”' + (n > 1 ? ' ×' + n : '')).join(', ') +
          (vals.length > 4 ? ' i ' + (vals.length - 4) + ' innych' : '')));
    } else if (g.key === NO_WOJ) label = el('span', { class: 'muted' }, g.label);
    return el('tr', { class: 'pick' + (selected ? ' sel' : '') + (cols.some(c => c.val(g)) ? '' : ' muted'), tabindex: '0', 'aria-selected': String(selected),
      title: (g.key === UNKNOWN ? 'Województwo w notatce zapisane tak, że nie pasuje do żadnego z 16 — popraw notatkę w Selly.\n'
        : g.key === NO_WOJ ? 'Ani notatka, ani kod pocztowy z zamówienia licencji nie wskazują województwa.\n' : '') +
        'Kliknij, aby zobaczyć listę orszaków: ' + g.label,
      onclick: () => { ors.woj = selected ? null : g.key; ors.query = ''; renderOrszaki(); },
      onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click(); } } },
      el('td', { style: 'white-space:normal' }, label),
      cols.map((c, j) => cell(c, j, c.val(g))));
  };
  const totalRow = (label, gs, trCls) => el('tr', { class: trCls },
    el('td', null, label), cols.map((c, j) => el('td', { class: cls(c, j) }, String(sum(gs, c.val)))));

  const body = el('tbody', null, main.map(row));
  const parts = [el('thead', null, head), body];
  if (extra.length) {
    parts.push(el('tbody', { class: 'subtotal' }, totalRow('Razem w województwach', main, 'sum')));
    parts.push(el('tbody', null,
      el('tr', null, el('td', { colspan: String(1 + cols.length), class: 'small muted', style: 'padding-top:12px' }, 'Poza województwami — notatka nie wskazuje województwa:')),
      extra.map(row)));
  }
  parts.push(el('tfoot', null, totalRow(extra.length ? 'Razem (wszystkie wiersze)' : 'Razem', main.concat(extra))));

  const notes = [];
  if (U.length > 1) {
    notes.push('Każda kolumna liczona osobno — orszak z licencjami z kilku lat jest w kilku kolumnach' +
      (uShown(C) ? '; w kolumnie „(unikatowe)” jest raz.' : '. Liczbę unikatowych orszaków włączysz w menu „Kolumny”.'));
  }
  if (extra.some(g => g.key === UNKNOWN)) {
    notes.push('„Nierozpoznane” — w notatce jest województwo, ale zapisane tak, że nie pasuje do żadnego z 16 (wartości pod nazwą wiersza); popraw notatkę w Selly.');
  }
  if (extra.some(g => g.key === NO_WOJ)) {
    notes.push('„Bez województwa” — ani notatka, ani adres zamówienia licencji nie wskazują województwa' +
      (ors.reg ? '.' : ' (tu także kupujący, którzy nie są orszakami).'));
  }
  if (stats.fromPostcode) {
    notes.push(orszakow(stats.fromPostcode) + ' bez województwa w notatce (np. licencja kupiona bez konta) przypisano wg kodu pocztowego z zamówienia licencji — to przybliżenie, oznaczone na liście „wg kodu pocztowego”.');
  }
  notes.push('Kliknij wiersz, żeby zobaczyć listę orszaków.');
  const L = state.orszaki.link;
  if (L) {
    notes.push('Zakupy licencji połączone z klientem: po koncie ' + L.byAccount + ', po e-mailu ' + L.byEmail +
      ', po telefonie ' + L.byPhone + ', niepołączone ' + L.none + '.');
  }
  const s = state.orszaki.sync;
  notes.push('Dane: ' + (s.dataUntil ? 'zamówienia z ' + s.dataUntil : 'zamówienia w trakcie pobierania') +
    (s.clientsAt ? ', notatki klientów z ' + s.clientsAt : '') + '.');

  const colMenu = checkMenu({ id: 'wojCols', label: 'Kolumny', title: 'Pokaż lub ukryj kolumny tabeli', rerender: renderOrszaki, items: () => [
    { label: U.length < 2 ? 'Orszaki unikatowe' : cap(countedName(C).yes) + ' (unikatowe)', title: uTitle(C), checked: uShown(C), disabled: U.length < 2,
      note: U.length < 2 ? 'Dostępne przy kilku kolumnach (kilka lat licencji lub zamówienie) — przy jednej byłoby jej powtórzeniem.'
        : ors.mode === 'any' ? 'Każdy orszak raz, nawet z licencjami z kilku lat.' : 'Orszaki spełniające wszystkie warunki naraz.',
      onChange: v => { ors.cols = Object.assign({}, ors.cols, { u: v }); } },
    { label: 'W bazie (wszystkie znane orszaki)', title: KNOWN_TITLE, checked: !!ors.cols.known,
      note: 'Nie zależy od wybranych lat ani warunków.',
      onChange: v => { ors.cols = Object.assign({}, ors.cols, { known: v }); } },
  ] });

  return el('div', null,
    el('div', { class: 'toolbar' },
      el('span', { class: 'small muted' }, definitionText(C), ' ',
        el('button', { type: 'button', class: 'link', title: 'Otwórz „Ustawienia zaawansowane”: kogo liczymy, łączenie warunków, statusy, tagi', onclick: () => setAdvanced(true, true) }, 'Zmień')),
      el('span', { class: 'spacer' }),
      el('span', { class: 'toast', id: 'wojToast', role: 'status' }),
      colMenu,
      downloadMenuButton('wojMenu', () => wojTable(C, cols, main, extra), 'wojToast')),
    el('div', { class: 'table-wrap', style: 'max-height:none' }, el('table', { class: 'woj' + (cols.length >= 4 ? ' many' : '') }, parts)),
    el('p', { class: 'muted small', style: 'margin-top:8px' }, notes.join(' ')));
}

// Filtry listy orszaków (menu „Filtry”) — zapamiętywane
const DETAIL_FILTERS = [
  { key: 'noData', label: 'Pomiń bez danych kontaktowych', note: 'brak e-maila i telefonu', test: e => !e.email && !e.phone },
  { key: 'noEmail', label: 'Pomiń bez e-maila', test: e => !e.email },
  { key: 'noPhone', label: 'Pomiń bez telefonu', test: e => !e.phone },
  { key: 'noName', label: 'Pomiń bez nazwy orszaku / klienta', test: e => !e.name },
  { key: 'noTown', label: 'Pomiń bez miejscowości', test: e => !e.town },
  { key: 'noWoj', label: 'Pomiń bez województwa', note: 'także z nierozpoznanym województwem', test: e => !WOJ_LABEL[e.woj] },
  { key: 'postcode', label: 'Pomiń z województwem wg kodu pocztowego', note: 'brak województwa w notatce — przybliżenie', test: e => !!e.wojFrom },
];

/** Lista orszaków wybranego województwa (albo wszystkich): liczone / pozostałe znane. */
function renderDetail(C) {
  const box = el('div', { id: 'detail' });
  const card = el('section', { class: 'card' }, box);
  if (ors.woj === UNLINKED && !C.unlinked.length) ors.woj = null;
  const unlinkedView = ors.woj === UNLINKED;
  const inWoj = e => ors.woj === null || wojGroup(e) === ors.woj;
  const excl = new Set(ors.excl);
  const activeAll = unlinkedView ? C.unlinked : [...C.activeSet].filter(inWoj);
  const inactiveAll = unlinkedView ? [] : state.orszaki.orszaki.filter(e => isOrszak(e) && inWoj(e) && !C.activeSet.has(e) && !(e.tags || []).some(t => excl.has(t)));
  if (unlinkedView) ors.list = 'active';
  const fOn = DETAIL_FILTERS.filter(f => ors.filt[f.key]);
  const pass = e => !fOn.some(f => f.test(e));
  const active = activeAll.filter(pass), inactive = inactiveAll.filter(pass);
  const listAll = ors.list === 'inactive' ? inactiveAll : activeAll;
  const names = countedName(C);
  const list = ors.list === 'inactive' ? inactive : active;
  const wojName = (C.groups.find(g => g.key === ors.woj) || {}).label;
  const label = ors.woj === null ? 'cała Polska'
    : unlinkedView ? 'kupujący bez przypisanego orszaku'
    : WOJ_LABEL[ors.woj] ? 'województwo ' + wojName : wojName;

  const search = el('input', { type: 'search', placeholder: 'Szukaj: nazwa, miejscowość, e-mail…', 'aria-label': 'Szukaj orszaku' });
  search.value = ors.query;
  search.addEventListener('input', debounce(() => { ors.query = search.value; fill(); }, 150));

  const Y = C.Y;
  // Pigułki licencji: lata z zakresu, ale co najmniej trzy ostatnie
  const licYears = [];
  for (let y = Math.min(Y - 2, C.ys[0]); y <= Y; y++) licYears.push(y);
  const visible = () => {
    const q = norm(ors.query).trim();
    const { key, dir } = ors.dsort;
    const txt = e => norm(key === 'name' ? e.name || e.email : key === 'tags' ? (e.tags || []).join(' ') : e.town || e.name || e.email);
    const num = e => (key === 'lic' ? licYears.filter(y => (e.lic || []).indexOf(y) >= 0).length : (e.ord || []).indexOf(Y) >= 0 ? 1 : 0);
    // Puste wartości zawsze na końcu, niezależnie od kierunku
    const cmp = key === 'lic' || key === 'ord'
      ? (a, b) => (num(a) - num(b)) * dir || txt(a).localeCompare(txt(b), 'pl')
      : (a, b) => (!txt(a) - !txt(b)) || txt(a).localeCompare(txt(b), 'pl') * dir;
    return list.filter(e => !q || norm([e.name, e.town, e.email, e.phone, e.wojLabel].join(' ')).includes(q)).sort(cmp);
  };
  // Nagłówek z sortowaniem w obie strony: ponowny klik odwraca; tooltip opisuje kolumnę
  const dHead = (key, label, tip, firstDir) => {
    const on = ors.dsort.key === key, dir = ors.dsort.dir;
    return el('th', { 'aria-sort': on ? (dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', class: tip !== label ? 'tip' : null, title: tip + '\n\n' + (on ? 'Kliknij, aby odwrócić kolejność' : 'Kliknij, aby posortować'),
        onclick: () => { ors.dsort = { key, dir: on ? -dir : firstDir || 1 }; fill(); } },
        label + (on ? (dir > 0 ? ' ↑' : ' ↓') : '')));
  };
  const table = el('table');
  const count = el('span', { class: 'muted' });
  const copyBtn = copyMenuButton('detailCopyMenu', () => {
    const rows = visible();
    return { emails: rows.map(e => e.email), phones: rows.map(e => e.phone), table: detailTable(rows, licYears, label, C) };
  }, 'detailToast');
  const csvBtn = downloadMenuButton('detailDlMenu', () => detailTable(visible(), licYears, label, C), 'detailToast');
  const filtBtn = checkMenu({ id: 'detailFilt', label: 'Filtry' + (fOn.length ? ' (' + fOn.length + ')' : ''), cls: fOn.length ? 'secondary on' : 'secondary',
    title: 'Ukryj na liście orszaki bez danych (e-maila, telefonu, nazwy…)', rerender: renderOrszaki,
    items: () => DETAIL_FILTERS.map(f => ({ label: f.label, note: f.note, checked: !!ors.filt[f.key], count: listAll.filter(f.test).length,
      title: 'Na liście „' + (ors.list === 'inactive' ? names.no : names.yes) + '” pasuje: ' + listAll.filter(f.test).length,
      onChange: v => { ors.filt = Object.assign({}, ors.filt, { [f.key]: v }); } })) });

  function fill() {
    const rows = visible();
    const hidden = listAll.length - list.length;
    count.textContent = (ors.query ? 'Znaleziono: ' + rows.length + ' z ' + list.length : orszakow(rows.length)) +
      (hidden ? ' · ukryto filtrami: ' + hidden : '');
    copyBtn.setDisabled(rows.length === 0);
    csvBtn.setDisabled(rows.length === 0);
    const head = el('tr', null,
      dHead('name', 'Orszak / klient', 'Orszak / klient'),
      dHead('town', ors.woj === null ? 'Miejscowość · województwo' : 'Miejscowość',
        'Miejscowość orszaku z notatki klienta w Selly' + (ors.woj === null ? '; pod nią województwo' : '')),
      dHead('lic', packsActive(licYears) ? 'Licencja lub pakiet' : 'Licencje', (packsActive(licYears) ? 'Licencje i pakiety startowe z lat ' : 'Licencje z lat ') + yearsLabel(licYears) + ': ✓ kupiona, — brak' +
        (packsActive(licYears) ? '; „pakiet” = pakiet startowy (najedź, by zobaczyć składniki)' : '') + '. Sortowanie wg liczby kupionych.', -1),
      dHead('ord', 'Zam. ' + seasonLabel(Y), 'Czy orszak złożył dowolne zamówienie w sezonie ' + seasonLabel(Y) + ' (1 lipca ' + (Y - 1) + ' – 30 czerwca ' + Y + ')', -1),
      dHead('tags', 'Tagi', 'Tagi z notatki klienta w Selly (np. #nieaktywny)'));
    const body = el('tbody');
    if (!rows.length) {
      body.append(el('tr', null, el('td', { colspan: 5, class: 'empty' },
        ors.query ? 'Nic nie pasuje do wyszukiwania „' + ors.query + '”.'
          : hidden ? 'Wszystkie ukryte filtrami (menu „Filtry”).'
          : 'Brak orszaków: ' + (ors.list === 'inactive' ? names.no : names.yes) + '.')));
    }
    for (const e of rows.slice(0, 2000)) {
      const hasOrd = (e.ord || []).indexOf(Y) >= 0;
      body.append(el('tr', null,
        el('td', null, el('div', { class: 'cell-name' }, e.name || el('span', { class: 'muted' }, '—')), contactLines(e.email, e.phone)),
        el('td', null, e.town || el('span', { class: 'muted' }, '—'),
          ors.woj === null && (WOJ_LABEL[e.woj] || e.wojLabel) ? el('div', { class: 'cell-sub' }, WOJ_LABEL[e.woj] || e.wojLabel) : null,
          // Województwo z kodu pocztowego to nie tag — opis pod miejscowością (jak kolumna „Województwo wg” w eksporcie)
          e.wojFrom ? el('div', { class: 'cell-sub', title: 'Brak województwa w notatce — przybliżenie wg kodu pocztowego z zamówienia licencji' }, 'wg kodu pocztowego ' + e.wojFrom) : null),
        el('td', null, licPills(licYears.map(y => (e.lic || []).indexOf(y) >= 0), licYears, licYears.map(y => (e.packs || []).find(p => p.y === y)))),
        el('td', null, el('span', { class: 'lp' + (hasOrd ? ' yes' : ''), title: hasOrd ? 'Zamówienie w sezonie' : 'Bez zamówień w sezonie' }, hasOrd ? '✓' : '—')),
        el('td', null, (e.tags || []).map(t => el('span', { class: 'tag', title: 'Tag z notatki klienta w Selly — można go pominąć w opcjach zaawansowanych' }, '#' + t)))));
    }
    if (rows.length > 2000) body.append(el('tr', null, el('td', { colspan: 5, class: 'muted small' }, 'Pokazano 2000 z ' + rows.length + ' — zawęź wyszukiwaniem albo pobierz CSV.')));
    table.replaceChildren(el('thead', null, head), body);
  }

  const tab = (key, n, text, title) => el('button', { type: 'button', 'aria-pressed': String(ors.list === key), title,
    onclick: () => { ors.list = key; renderOrszaki(); } }, text + ' (' + n + ')');
  box.append(
    el('div', { class: 'card-head' },
      el('h2', null, el('span', { class: 'step', 'aria-hidden': 'true' }, '2'), 'Lista orszaków — ' + label,
        ors.woj !== null ? el('button', { type: 'button', class: 'link small', style: 'font-weight:600',
          onclick: () => { ors.woj = null; renderOrszaki(); } }, '← pokaż całą Polskę') : null),
      el('p', { class: 'sub' }, unlinkedView
        ? 'Kupili coś w sezonie, ale nie mają notatki orszaku ani licencji — nie wiemy, z którego są województwa.'
        : definitionText(C) + ' Druga zakładka („' + names.no + '”) to pozostałe znane orszaki, np. do kontaktu. ' +
          'Województwo wybierasz kliknięciem w tabelę w sekcji 1.')),
    el('div', { class: 'detail-head' },
      unlinkedView ? el('span', { class: 'small muted' }, 'Wyszukaj ich w Selly po e-mailu lub telefonie i uzupełnij notatkę u właściwego klienta.')
        : el('span', { class: 'seg', role: 'group', 'aria-label': 'Które orszaki pokazać' },
          tab('active', active.length, names.yes, definitionText(C)),
          tab('inactive', inactive.length, names.no, 'Inne znane orszaki — nie spełniają warunków')),
      el('span', { class: 'spacer' })),
    el('div', { class: 'toolbar', style: 'margin-top:8px' }, search, count, el('span', { class: 'spacer' }),
      el('span', { class: 'toast', id: 'detailToast', role: 'status' }), filtBtn, copyBtn, csvBtn),
    el('div', { class: 'table-wrap' }, table));
  fill();
  return card;
}

function wojTable(C, cols, main, extra) {
  const columns = [{ header: 'Województwo', type: 'text' }]
    .concat(cols.map(c => ({ header: c.grp ? c.grp + ' ' + c.head : c.head, type: 'number' })));
  const line = (label, gs) => [label].concat(cols.map(c => gs.reduce((n, g) => n + c.val(g), 0)));
  const rows = main.map(g => line(g.label, [g]));
  if (extra.length) {
    rows.push(line('Razem w województwach', main));
    for (const g of extra) rows.push(line(g.label, [g]));
  }
  rows.push(line(extra.length ? 'Razem (wszystkie wiersze)' : 'Razem', main.concat(extra)));
  const span = C.ys.length > 1 ? C.ys[0] + '-' + C.Y : String(C.Y);
  return { file: 'orszaki-wojewodztwa-' + span, sheet: 'Województwa ' + span, columns, rows, note: 'Liczone: ' + definitionText(C) };
}

function detailTable(rows, licYears, label, C) {
  const Y = licYears[licYears.length - 1];
  const yn = b => (b ? 'tak' : 'nie');
  const T = h => ({ header: h, type: 'text' }), Cn = h => ({ header: h, type: 'center' });
  const columns = [T('Orszak / klient'), T('Miejscowość orszaku'), T('Województwo'), T('Województwo wg'), T('Rodzaj podmiotu'), T('Email'), T('Telefon')]
    .concat(licYears.map(y => Cn(LIC_WORD([y]) + ' ' + y)), [Cn('Zamówienie w sezonie ' + seasonLabel(Y)), T('Tagi'), Cn(cap(countedName(C).yes))]);
  const data = rows.map(e => [e.name, e.town, WOJ_LABEL[e.woj] || e.wojLabel || '',
    e.wojFrom ? 'kod pocztowy ' + e.wojFrom : e.woj || e.wojLabel ? 'notatka' : '', e.kind, e.email, e.phone]
    .concat(licYears.map(y => { const p = (e.packs || []).find(x => x.y === y); return p ? (p.lic ? 'licencja + pakiet' : 'pakiet') : yn((e.lic || []).indexOf(y) >= 0); }),
      [yn((e.ord || []).indexOf(Y) >= 0), (e.tags || []).map(t => '#' + t).join(' '), ors.list === 'inactive' ? 'nie' : 'tak']));
  const slug = norm(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const kind = ors.list === 'inactive' ? 'pozostale' : 'liczone';
  return { file: 'orszaki-' + slug + '-' + kind + '-' + Y, sheet: ('Orszaki ' + (ors.list === 'inactive' ? 'pozostałe' : 'liczone') + ' ' + Y), columns, rows: data };
}

// ─── Do sprawdzenia: anomalie w danych ─────────────────────────────────────
//
// Liczone po stronie strony z orszak.licOrders (wszystkie zakupy licencji połączone z orszakiem,
// także w nieliczonych statusach). To lista kontroli jakości danych — nie zależy od kryteriów
// aktywności ani od pomijanych tagów.

// excl: grupy pominięte w głównym „Pobierz” (menu „Grupy w pliku”) — zapamiętywane
const an = { open: new Set(), full: new Set(), excl: new Set(store('otk-an-excl') || []) };
const AN_LIMIT = 50;
const EARLY_STATUS = /zlozon|nowe\b|nowy\b|oczekuj|niepotwierdz|w trakcie|przyjet/;
const CANCEL_STATUS = /anul|odrzuc|zwrot|zwroc|usuni/;
const VIA = { a: 'konto', e: 'e-mail', p: 'telefon', g: 'gość' };
const statusName = id => { const s = (BOOT.statuses || []).find(s => String(s.id) === String(id)); return s ? s.name : 'status ' + id; };
const clientIdOf = e => { const m = /^c(\d+)$/.exec(e.id || ''); return m ? m[1] : ''; };
const uniqOrders = os => { const seen = new Set(); return os.filter(o => !seen.has(o.id) && seen.add(o.id)); };

function computeAnomalies(Y) {
  const defs = [
    { key: 'multi', sev: 'warn', short: 'Kilka zakupów', title: 'Kilka zakupów licencji ' + Y + ' u jednego orszaku',
      why: 'Co najmniej dwa różne zamówienia z licencją ' + Y + ' w liczonych statusach przypisano do jednego orszaku. Raport liczy orszak raz.' },
    { key: 'qty', sev: 'info', short: 'Kilka sztuk', title: 'Kilka sztuk licencji w jednym zamówieniu',
      why: 'Zamówienie zawiera więcej niż jedną licencję ' + Y + ' — to może być zakup dla kilku orszaków.' },
    { key: 'uncounted', sev: 'warn', short: 'Status się nie liczy', title: 'Licencja w statusie, który się nie liczy',
      why: 'Zamówienie z licencją ' + Y + ' ma status wyłączony z zakupów (np. „Nieopłacone – Dostarczone”) i nie wchodzi do raportu. Anulowane i zwrócone pomijamy.' },
    { key: 'noreg', sev: 'warn', short: 'Bez notatki orszaku', title: 'Licencja bez notatki orszaku',
      why: 'Orszak kupił licencję ' + Y + ', ale klient nie ma notatki orszaku — województwo pochodzi tylko z kodu pocztowego zamówienia albo go brak.' },
    { key: 'phone', sev: 'info', short: 'Tylko po telefonie', title: 'Połączone tylko po telefonie',
      why: 'Zamówienie z licencją ' + Y + ' dopasowano do orszaka wyłącznie po numerze telefonu (nie po koncie ani e-mailu) — dopasowanie bywa błędne.' },
    { key: 'wojbad', sev: 'warn', short: 'Nierozpoznane woj.', title: 'Nierozpoznane województwo w notatce',
      why: 'W notatce jest województwo, ale zapisane tak, że nie pasuje do żadnego z 16 (dotyczy wszystkich sezonów).' },
    { key: 'nowoj', sev: 'info', short: 'Notatka bez woj.', title: 'Notatka bez województwa',
      why: 'Klient ma notatkę orszaku (miejscowość), ale bez województwa — orszak wpada do „bez województwa” (dotyczy wszystkich sezonów).' },
  ];
  const G = Object.fromEntries(defs.map(d => [d.key, Object.assign(d, { items: [] })]));
  for (const e of state.orszaki.orszaki) {
    const lo = e.licOrders || [];
    const licY = lo.filter(o => o.y === Y);
    const counted = uniqOrders(licY.filter(o => !o.x));
    if (counted.length >= 2) {
      const anyM = counted.some(o => o.m);
      const early = counted.filter(o => EARLY_STATUS.test(norm(statusName(o.st))));
      let action;
      if (!anyM && early.length && early.length < counted.length) {
        action = 'Prawdopodobny duplikat — rozważ anulowanie niepotwierdzonego zamówienia (' + early.map(o => '#' + o.n).join(', ') + ').';
      } else if (anyM) {
        action = 'Jeden klient, kilka e-maili — możliwe kilka orszaków jednego organizatora (raport liczy orszak raz). Sprawdź, czy to jeden orszak.';
      } else {
        action = 'Dwa zakupy z tego samego e-maila — duplikat albo licencje dla kilku orszaków. Sprawdź zamówienia; duplikat anuluj.';
      }
      G.multi.items.push({ e, orders: counted, action });
    }
    const qty = uniqOrders(licY.filter(o => !o.x && o.q > 1));
    if (qty.length) G.qty.items.push({ e, orders: qty, action: 'Sprawdź, dla ilu orszaków kupiono licencje; w razie potrzeby załóż osobne konta lub notatki.' });
    const unc = uniqOrders(licY.filter(o => o.x && !CANCEL_STATUS.test(norm(statusName(o.st)))));
    if (unc.length) G.uncounted.items.push({ e, orders: unc, action: 'Sprawdź w Selly, czy zamówienie jest opłacone; jeśli tak — zmień status na liczony albo włącz ten status w ustawieniach zaawansowanych.' });
    if (counted.length && !e.reg && (!e.woj || e.wojFrom)) {
      G.noreg.items.push({ e, orders: counted, action: 'Uzupełnij notatkę orszaku u klienta w Selly (miejscowość, województwo) albo załóż konto.' });
    }
    const ph = uniqOrders(licY.filter(o => !o.x && o.v === 'p'));
    if (ph.length) G.phone.items.push({ e, orders: ph, action: 'Zweryfikuj, czy zamówienie na pewno należy do tego orszaka (ten sam telefon może mieć kilku organizatorów).' });
    if (wojGroup(e) === UNKNOWN && isOrszak(e)) {
      G.wojbad.items.push({ e, orders: [], note: 'W notatce: „' + (e.wojLabel || e.woj) + '”', action: 'Popraw zapis województwa w notatce klienta w Selly (np. „mazowieckie”).' });
    }
    if (e.reg && !e.woj && !e.wojLabel) {
      G.nowoj.items.push({ e, orders: [], action: 'Dopisz województwo w notatce klienta w Selly.' });
    }
  }
  const groups = defs.filter(d => d.items.length);
  return { Y, groups, total: groups.reduce((n, g) => n + g.items.length, 0) };
}

function anomalyItem(it) {
  const e = it.e;
  const cid = clientIdOf(e);
  const place = [e.town, WOJ_LABEL[e.woj] || e.wojLabel, e.wojFrom ? '(z kodu pocztowego)' : ''].filter(Boolean).join(' · ');
  return el('div', { class: 'an-item' },
    el('div', null,
      el('span', { class: 'cell-name' }, e.name || e.email || e.id || '—'),
      place ? el('span', { class: 'muted small' }, ' · ' + place) : null,
      cid ? [' ', el('a', { class: 'ext small', href: clientUrl(cid), target: '_blank', rel: 'noopener', title: 'Otwórz klienta w panelu Selly' }, 'klient ' + cid)] : null),
    e.email || e.phone ? el('div', { class: 'cell-sub' }, [e.email, e.phone].filter(Boolean).join(' · ')) : null,
    it.note ? el('div', { class: 'cell-sub' }, it.note) : null,
    it.orders.length ? el('div', { class: 'an-orders' }, it.orders.map(o => el('span', { class: 'an-order' },
      el('a', { class: 'ext', href: orderUrl(o.id), target: '_blank', rel: 'noopener', title: 'Otwórz zamówienie w panelu Selly' }, '#' + (o.n || o.id)),
      el('span', { class: 'muted' }, statusName(o.st) + ' · ' + o.d),
      o.q > 1 ? el('span', null, '×' + o.q) : null,
      o.m ? el('span', { class: 'muted', title: 'E-mail w zamówieniu różni się od e-maila orszaka' }, 'inny e-mail') : null,
      el('span', { class: 'muted', title: 'Jak połączono zamówienie z orszakiem' }, '(' + (VIA[o.v] || o.v) + ')')))) : null,
    el('div', { class: 'an-action' }, it.action));
}

function renderAnomalies(Y) {
  const A = computeAnomalies(Y);
  const box = el('section', { class: 'anom', id: 'anomalies', 'aria-label': 'Dane do poprawienia w Selly' });
  const card = el('section', { class: 'card card-anom' }, box);
  box.append(el('div', { class: 'section-title card-head' },
    el('div', null,
      el('h2', null, el('span', { class: 'step', 'aria-hidden': 'true' }, '3'), 'Dane do poprawienia w Selly',
        el('span', { class: 'muted small', style: 'font-weight:400' }, 'licencje ' + Y + ' i notatki orszaków')),
      el('p', { class: 'sub' }, 'Zamówienia i notatki, przez które zestawienie może być niedokładne: zdublowane zakupy, licencje bez orszaku, brak województwa. ' +
        'Pokazujemy wszystko, niezależnie od ustawień zestawienia. Linki otwierają zamówienie lub klienta w panelu Selly. ' +
        'Pobierz wszystko jednym plikiem albo jedną grupę przyciskiem w jej środku.')),
    A.total ? el('div', { class: 'toolbar', style: 'margin-top:0' }, anGroupsMenu(A), anDownload(A)) : null));
  if (!A.total) {
    box.append(el('div', { class: 'an-ok' }, '✓ Nic do poprawienia — dane wyglądają spójnie.'));
    return card;
  }
  box.append(el('div', { class: 'an-sum' }, el('span', { class: 'muted small', style: 'align-self:center' }, 'Do poprawienia: ' + A.total),
    A.groups.map(g => el('button', { type: 'button', class: 'chip', title: g.title, onclick: () => {
      const d = $('an-' + g.key);
      if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } }, g.short, el('b', null, String(g.items.length))))));
  for (const g of A.groups) {
    const full = an.full.has(g.key);
    const shown = full ? g.items : g.items.slice(0, AN_LIMIT);
    const d = el('details', { class: 'an-group sev-' + g.sev, id: 'an-' + g.key, open: an.open.has(g.key) },
      el('summary', null, el('span', { class: 'an-count' }, String(g.items.length)),
        el('span', null, el('b', null, g.title), el('div', { class: 'muted small' }, g.why))),
      el('div', { class: 'an-body' },
        el('div', { class: 'toolbar', style: 'margin-top:0;justify-content:flex-end' },
          downloadMenuButton('anDl-' + g.key, () => anomaliesTable(A, [g]), 'anToast', false,
            { label: 'Pobierz tę grupę', cls: 'secondary small', title: 'Pobierz tylko „' + g.title + '” (' + g.items.length + ') jako plik' })),
        shown.map(anomalyItem),
        g.items.length > shown.length ? el('div', { style: 'padding-top:12px' },
          el('button', { type: 'button', class: 'link', onclick: () => { an.full.add(g.key); an.open.add(g.key); renderOrszaki(); } },
            'Pokaż wszystkie (' + g.items.length + ')')) : null));
    d.addEventListener('toggle', () => { if (d.open) an.open.add(g.key); else an.open.delete(g.key); });
    box.append(d);
  }
  return card;
}

/** Główne „Pobierz”: grupy zaznaczone w „Grupy w pliku” (domyślnie wszystkie). */
const anSelected = A => A.groups.filter(g => !an.excl.has(g.key));
function anDownload(A) {
  const sel = anSelected(A), n = sel.reduce((s, g) => s + g.items.length, 0);
  return downloadMenuButton('anMenu', () => anomaliesTable(A, anSelected(A)), 'anToast', !sel.length, {
    label: sel.length === A.groups.length ? 'Pobierz wszystko' : 'Pobierz zaznaczone',
    title: sel.length ? 'Pobierz jednym plikiem: ' + sel.map(g => g.short).join(', ') + ' (' + n + ' pozycji). Kolumna „Grupa” mówi, czego dotyczy wiersz.'
      : 'Zaznacz co najmniej jedną grupę w „Grupy w pliku”' });
}
function anGroupsMenu(A) {
  const sel = anSelected(A).length;
  return checkMenu({ id: 'anGroups', label: 'Grupy w pliku: ' + (sel === A.groups.length ? 'wszystkie' : sel + ' z ' + A.groups.length),
    cls: sel === A.groups.length ? 'secondary' : 'secondary on',
    title: 'Wybierz, które grupy problemów trafią do pobieranego pliku', rerender: renderOrszaki,
    items: () => A.groups.map(g => ({ label: g.title, title: g.why, count: g.items.length, checked: !an.excl.has(g.key),
      onChange: v => { if (v) an.excl.delete(g.key); else an.excl.add(g.key); store('otk-an-excl', [...an.excl]); } })) });
}

function anomaliesTable(A, groups) {
  groups = groups || A.groups;
  const columns = ['Grupa', 'Orszak / klient', 'Miejscowość', 'Województwo', 'Email', 'Telefon', 'client_id', 'Zamówienia', 'Wyjaśnienie', 'Zalecane działanie']
    .map(h => ({ header: h, type: 'text' }));
  const rows = [];
  for (const g of groups) for (const it of g.items) {
    const e = it.e;
    rows.push([g.title, e.name || '', e.town || '', WOJ_LABEL[e.woj] || e.wojLabel || '', e.email || '', e.phone || '', clientIdOf(e),
      it.orders.map(o => o.n + ' (' + statusName(o.st) + ', ' + o.d + (o.q > 1 ? ', ×' + o.q : '') + ')').join('; '),
      g.why + (it.note ? ' ' + it.note + '.' : ''), it.action]);
  }
  const part = groups.length === 1 && A.groups.length > 1 ? '-' + groups[0].key : groups.length < A.groups.length ? '-wybrane' : '';
  return { file: 'orszaki-do-poprawienia' + part + '-' + A.Y, sheet: 'Do poprawienia ' + A.Y, columns, rows };
}

// ─── Dane i zmiany ─────────────────────────────────────────────────────────
//
// Backend zapisuje zmiany z każdej synchronizacji (nowe licencje, statusy, notatki orszaków).
// „Od Twojej ostatniej wizyty” = od poprzedniego otwarcia strony w tej przeglądarce.
// „Odśwież dane” pobiera ze sklepu zmiany od razu (backend: nie częściej niż co 3 min).

const DAY = 24 * 60 * 60 * 1000;
const CHG_KINDS = {
  'lic-new': ['lic', 'nowa licencja', 'lic'], 'lic-status': ['lic', 'status licencji', 'lic'],
  'lic-removed': ['lic', 'licencja usunięta', 'lic-bad'], 'client-new': ['client', 'nowy orszak', 'client'],
  'client-note': ['client', 'notatka', 'client'], 'order-new': ['order', 'zamówienie', 'order'],
};
const CHG_GROUPS = [['lic', 'Licencje'], ['client', 'Notatki orszaków'], ['order', 'Inne zamówienia']];
const chg = { rows: null, runs: [], range: 'visit', show: { lic: true, client: true, order: false }, all: false, refreshSince: 0, msg: '' };

function initChanges() {
  chg.prevVisit = Number(store('otk-seen-ms')) || 0;
  store('otk-seen-ms', Date.now());
  if (!chg.prevVisit) chg.range = '7';
  $('cardChanges').hidden = false;
  $('refreshBtn').addEventListener('click', refreshData);
  $('changesSummary').addEventListener('click', () => { chg.touched = true; });
  loadChanges();
}

function loadChanges() {
  const since = Math.min(Date.now() - 31 * DAY, chg.prevVisit || Infinity);
  return api('changes', { sinceMs: since }).then(d => { chg.rows = d.rows; chg.runs = d.runs; renderChanges(); })
    .catch(err => { $('changesBody').replaceChildren(el('div', { class: 'empty error' }, 'Nie udało się wczytać zmian: ' + err.message)); });
}

function rangeSince() {
  if (chg.range === 'visit') return chg.prevVisit;
  if (chg.range === 'refresh') return chg.refreshSince;
  if (chg.range === 'last') return chg.runs.length ? chg.runs[0].ms - 1 : Date.now();
  return Date.now() - Number(chg.range) * DAY;
}
const fmtMs = ms => { const d = new Date(ms), z = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()); };

function renderDataMsg() {
  const box = $('dataMsg');
  if (!chg.msg) { box.replaceChildren(); return; }
  const kind = chg.msgKind || (chg.msgError ? 'error' : 'info');
  box.replaceChildren(el('div', { class: 'msg ' + kind },
    chg.busy ? el('span', { class: 'spinner', style: 'margin-top:4px' }) : el('span', { 'aria-hidden': 'true' }, kind === 'ok' ? '✓' : kind === 'error' ? '⚠' : 'ℹ'),
    el('span', null, chg.msg)));
}

function renderChanges() {
  renderDataMsg();
  const ranges = [];
  if (chg.refreshSince) ranges.push(['refresh', 'to odświeżenie']);
  if (chg.prevVisit) ranges.push(['visit', 'od ostatniej wizyty']);
  if (chg.runs.length) ranges.push(['last', 'ostatnie pobranie']);
  ranges.push(['7', '7 dni'], ['30', '30 dni']);
  if (!ranges.some(r => r[0] === chg.range)) chg.range = ranges[0][0];
  $('changesRange').replaceChildren(...ranges.map(([k, label]) => el('button', { type: 'button', 'aria-pressed': String(chg.range === k),
    onclick: () => { chg.range = k; chg.all = false; renderChanges(); } }, label)));

  const since = rangeSince();
  const inRange = (chg.rows || []).filter(c => c.ms > since);
  const n = t => inRange.filter(c => c.type === t).length;
  const g = k => inRange.filter(c => (CHG_KINDS[c.type] || [])[0] === k).length;
  const when = chg.range === 'visit' ? 'Od Twojej ostatniej wizyty (' + fmtMs(chg.prevVisit) + ')'
    : chg.range === 'refresh' ? 'Z tego odświeżenia'
    : chg.range === 'last' ? 'Z ostatniego pobrania danych' + (chg.runs[0] ? ' (' + chg.runs[0].at + ')' : '')
    : 'Z ostatnich ' + chg.range + ' dni';
  const parts = [];
  const part = (k, one, few, many) => { const v = n(k); if (v) parts.push(el('span', null, el('b', null, String(v)), ' ' + plural(v, one, few, many))); };
  part('lic-new', 'nowa licencja', 'nowe licencje', 'nowych licencji');
  part('lic-status', 'zmiana statusu licencji', 'zmiany statusu licencji', 'zmian statusu licencji');
  part('lic-removed', 'usunięta licencja', 'usunięte licencje', 'usuniętych licencji');
  part('client-new', 'nowy orszak', 'nowe orszaki', 'nowych orszaków');
  part('client-note', 'zmiana w notatce', 'zmiany w notatkach', 'zmian w notatkach');
  part('order-new', 'inne zamówienie', 'inne zamówienia', 'innych zamówień');
  const list = parts.length ? parts.map((x, i) => (i ? [', ', x] : [x])).flat() : ['bez zmian'];
  // Podsumowanie w jednej linii (widoczne także po zwinięciu)
  $('changesSum').replaceChildren('· ', ...list, chg.range === 'visit' ? ' od ostatniej wizyty' : '');

  const box = $('changesBody');
  const kids = [el('p', { class: 'muted small' }, when + ': ', parts.length ? parts.map((x, i) => [i ? ', ' : null, x]) : 'bez zmian', '.')];
  if (inRange.length) {
    const chips = el('div', { class: 'presets' }, el('span', { class: 'small muted' }, 'Pokaż:'),
      CHG_GROUPS.map(([k, label]) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(chg.show[k]),
        onclick: () => { chg.show[k] = !chg.show[k]; renderChanges(); } }, label + ' (' + g(k) + ')')));
    const shown = inRange.filter(c => chg.show[(CHG_KINDS[c.type] || ['order'])[0]]);
    const limit = chg.all ? shown.length : 50;
    const body = el('tbody', null, shown.slice(0, limit).map(c => {
      const k = CHG_KINDS[c.type] || ['order', c.type, 'order'];
      const isClient = k[0] === 'client';
      const ref = isClient
        ? el('a', { class: 'ext', href: clientUrl(c.id), target: '_blank', rel: 'noopener', title: 'Otwórz klienta w panelu Selly' }, 'klient ' + c.id)
        : el('a', { class: 'ext', href: orderUrl(c.id), target: '_blank', rel: 'noopener', title: 'Otwórz zamówienie w panelu Selly' }, c.number || c.id);
      const woj = WOJ_LABEL[c.woj] || c.woj || '';
      return el('tr', null,
        el('td', { class: 'cell-sub nw' }, c.at),
        el('td', null, el('span', { class: 'kind ' + k[2] }, k[1]), el('div', null, ref)),
        el('td', null, el('div', { class: 'cell-name' }, c.name || ''),
          c.email ? el('div', { class: 'cell-sub' }, el('span', { class: 'ell', title: c.email }, c.email)) : null,
          woj ? el('div', { class: 'cell-sub' }, woj) : null),
        el('td', null, c.desc));
    }));
    if (!shown.length) body.append(el('tr', null, el('td', { colspan: 4, class: 'empty' }, 'Zaznacz rodzaj zmian powyżej.')));
    if (shown.length > limit) body.append(el('tr', null, el('td', { colspan: 4 },
      el('button', { type: 'button', class: 'link', onclick: () => { chg.all = true; renderChanges(); } }, 'Pokaż wszystkie (' + shown.length + ')'))));
    kids.push(el('div', { class: 'row' }, chips), el('div', { class: 'table-wrap', style: 'max-height:420px' },
      el('table', null, el('thead', null, el('tr', null, [['Czas', 'Kiedy zmianę wykryła synchronizacja ze sklepem'], ['Zmiana', 'Rodzaj zmiany: zakup licencji, notatka klienta, zamówienie'], ['Kto', 'Kto'], ['Co się zmieniło', 'Co się zmieniło']].map(([h, t]) => el('th', null, el('span', { class: t !== h ? 'tip' : null, title: t }, h))))), body)));
  }
  if (chg.range !== 'refresh' && state.lastSync && state.lastSync.lastRunMs) {
    kids.push(el('p', { class: 'muted small', style: 'margin-top:8px' }, 'Ostatnie pobranie ze sklepu: ' + fmtMs(state.lastSync.lastRunMs) +
      '. Zmiany zapisujemy od włączenia tej funkcji; województwo przy zamówieniach — z kodu pocztowego dostawy.'));
  }
  box.replaceChildren(...kids.filter(Boolean));
}

async function refreshData() {
  const btn = $('refreshBtn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.replaceChildren(el('span', { class: 'spinner', style: 'margin-right:0' }), 'Pobieram…');
  chg.busy = true;
  chg.msg = 'Pobieram nowe dane ze sklepu — zwykle kilka sekund, z notatkami klientów do ok. 2 minut…';
  chg.msgKind = 'info';
  renderDataMsg();
  try {
    const r = await api('refresh');
    renderBanners(r.sync);
    if (r.status === 'done' || r.status === 'error') {
      chg.refreshSince = r.startedMs - 1;
      chg.range = 'refresh';
      chg.touched = false;
      chg.msg = r.status === 'error' ? 'Pobieranie nie powiodło się: ' + r.sync.lastError : 'Dane odświeżone (' + fmtMs(Date.now()) + ') — raport przelicza się z nowymi danymi.';
      chg.msgKind = r.status === 'error' ? 'error' : 'ok';
      state.stale.list = state.stale.orszaki = true;
      run();
    } else if (r.status === 'recent') {
      chg.msg = 'Dane pobrano przed chwilą (' + fmtMs(r.sync.lastRunMs) + ') — kolejne odświeżenie możliwe po 3 minutach.';
      chg.msgKind = 'info';
    } else if (r.status === 'busy') {
      chg.msg = 'Pobieranie danych właśnie trwa — spróbuj ponownie za minutę.';
      chg.msgKind = 'warn';
    } else {
      chg.msg = 'Trwa pierwsze pobieranie danych ze sklepu — odśwież stronę za kilka minut.';
      chg.msgKind = 'warn';
    }
    chg.busy = false;
    await loadChanges();
  } catch (err) {
    chg.busy = false;
    chg.msg = 'Nie udało się odświeżyć danych: ' + err.message;
    chg.msgKind = 'error';
    renderChanges();
  } finally {
    chg.busy = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = '↻ Odśwież dane';
    renderDataMsg();
  }
}


let root = null, pendingView = 'list', bootP = null;
/** „init” (statusy, produkty, pakiety, stan synchronizacji) pobiera tylko ten moduł — raz na sesję; powłoka startuje bez niego.
 *  prefetch: backend dokłada od razu otwierany widok z domyślnymi ustawieniami — strona startuje jednym zapytaniem. */
const loadBoot = () => bootP || (bootP = api('init', { prefetch: pendingView === 'orszaki' ? 'orszaki' : 'report' }).catch(e => { bootP = null; throw e; }));

const el0card = err => (err
  ? el('div', { class: 'card' }, el('div', { class: 'empty error' }, 'Nie udało się wczytać raportu licencji: ' + (err.message || 'błąd'), ' ', el('button', { type: 'button', class: 'secondary', onclick: () => location.reload() }, 'Spróbuj ponownie')))
  : el('div', { class: 'card' }, loadingBox('Wczytuję raport licencji…')));

export default {
  id: 'licencje',
  title: 'Licencje',
  routes: ['', 'orszaki'],
  mount(el, params) {
    pendingView = params && params.view === 'orszaki' ? 'orszaki' : 'list';
    if (BOOT) { setView(pendingView); return; }
    if (root) return;   // trwa wczytywanie — widok ustawi się po nim
    root = el;
    el.replaceChildren(el0card());
    loadBoot().then(b => {
      if (!b || !Array.isArray(b.statuses) || !Array.isArray(b.products)) throw new Error('Backend zwrócił niepełną konfigurację (brak statusów lub produktów).');
      BOOT = b;
      el.innerHTML = TEMPLATE;
      $('settings').hidden = false; $('viewnav').hidden = false;
      init();
      setView(pendingView);
    }).catch(err => {
      BOOT = null; bootP = null; root = null;   // nic nie zostaje w połowie — kolejne wejście wczytuje od nowa
      el.replaceChildren(el0card(err));
    });
  },
  unmount() { /* stan i DOM zostają — kontener jest tylko ukrywany */ },
};
