// Dane orszaków („OSA”) z notatki klienta: pasek filtrów, oznaczenia (badge) i helpery wspólne dla modułów Zamówienia i Klienci.
import { el, store, multiSelect } from './ui.js?v=58f006c';
import { postcodeWojewodztwo } from '../lib/noteParser.js?v=58f006c';

export const NONE = '__none';
const WOJ_NAMES = {
  'dolnoslaskie': 'Dolnośląskie', 'kujawsko-pomorskie': 'Kujawsko-pomorskie', 'lubelskie': 'Lubelskie', 'lubuskie': 'Lubuskie', 'lodzkie': 'Łódzkie',
  'malopolskie': 'Małopolskie', 'mazowieckie': 'Mazowieckie', 'opolskie': 'Opolskie', 'podkarpackie': 'Podkarpackie', 'podlaskie': 'Podlaskie',
  'pomorskie': 'Pomorskie', 'slaskie': 'Śląskie', 'swietokrzyskie': 'Świętokrzyskie', 'warminsko-mazurskie': 'Warmińsko-mazurskie',
  'wielkopolskie': 'Wielkopolskie', 'zachodniopomorskie': 'Zachodniopomorskie', 'inne - zagranica': 'Inne — zagranica',
};
export const wojLabel = key => WOJ_NAMES[key] || key || '';

// ─── Adres ↔ parametry listy ────────────────────────────────────────────────

export const OSA_KEYS = ['woj', 'kind', 'title', 'tag'];
export function readOsa(g) { return { woj: g('woj'), kind: g('kind'), title: g('title'), tag: g('tag'), nodata: g('nodata') === '1', lic: g('lic') === '1' }; }
export function writeOsa(Q, p) {
  for (const k of OSA_KEYS) if (Q[k]) p.set(k, Q[k]);
  if (Q.nodata) p.set('nodata', '1');
  if (Q.lic) p.set('lic', '1');
}
export function osaParams(Q) {
  const p = {};
  for (const k of OSA_KEYS) if (Q[k]) p[k] = Q[k];
  if (Q.nodata) p.includeNoData = true;
  if (Q.lic) p.license = true;
  return p;
}
export const osaActive = Q => OSA_KEYS.some(k => Q[k]) || !!Q.lic;
export const OSA_CLEAR = { woj: '', kind: '', title: '', tag: '', nodata: false, lic: false };

// ─── Widoczność oznaczeń („Pokaż:”) ─────────────────────────────────────────

export const BADGE_KINDS = [
  { k: 'woj', label: 'woj.', tip: 'Województwo z notatki klienta' },
  { k: 'typ', label: 'typ', tip: 'Rodzaj podmiotu (szkoła, parafia…) z notatki klienta' },
  { k: 'tytul', label: 'tytuł', tip: 'Tytuł orszaku z notatki klienta' },
  { k: 'tag', label: '#tagi', tip: 'Tagi z notatki klienta' },
  { k: 'lic', label: 'licencja → woj.', tip: 'Przy zamówieniach z licencją: województwo klienta (z notatki, a gdy brak — przybliżone z kodu pocztowego dostawy)' },
];
const BKEY = 'osa-badges';
export const badgePrefs = () => { const s = store(BKEY) || {}; const o = {}; for (const b of BADGE_KINDS) o[b.k] = s[b.k] !== false; return o; };
export function applyBadgePrefs(prefs = badgePrefs()) {
  for (const b of BADGE_KINDS) document.body.classList.toggle('osa-hide-' + b.k, !prefs[b.k]);
}

// ─── Oznaczenia w wierszach ─────────────────────────────────────────────────

const tagList = tags => String(tags || '').split(',').map(s => s.trim()).filter(Boolean);
const badge = (kind, text, title, onPick) => el('button', { type: 'button', class: 'osa-badge osa-badge--' + kind, title: title + (onPick ? '\n\nKliknij, aby filtrować tą wartością' : ''), onclick: onPick || null }, text);

/** Województwo klienta zamówienia: z notatki, a gdy brak — przybliżenie z kodu pocztowego dostawy. */
export function licenseWoj(r) {
  if (r.wojKey) return { key: r.wojKey, label: wojLabel(r.wojKey), approx: false };
  const k = postcodeWojewodztwo(r.postcode, r.country || 'PL');
  return k ? { key: k, label: wojLabel(k), approx: true } : null;
}

/** Klucz tytułu do filtra: z listy tytułów (facets), a gdy nie ma — znormalizowany tekst. */
const titleKey = (F, t) => { const l = String(t).toLowerCase(), f = F && (F.titles || []).find(x => String(x.label || x.key).toLowerCase() === l); return f ? f.key : l; };

/** Zestaw oznaczeń dla wiersza listy. setFilter(patch) ustawia filtr klikniętą wartością; license: czy pokazywać oznaczenie licencji (zamówienia). */
export function osaBadges(r, setFilter, license, facets) {
  const out = [];
  const src = 'Źródło: notatka klienta.';
  if (r.wojKey) out.push(badge('woj', wojLabel(r.wojKey), 'Województwo. ' + src, () => setFilter({ woj: r.wojKey })));
  if (r.kindKey) out.push(badge('typ', r.kind || r.kindKey, 'Rodzaj podmiotu. ' + src, () => setFilter({ kind: r.kindKey })));
  if (r.orszakTitle) out.push(badge('tytul', r.orszakTitle, 'Tytuł orszaku. ' + src, () => setFilter({ title: titleKey(facets, r.orszakTitle) })));
  for (const t of tagList(r.tags)) out.push(badge('tag', '#' + t, 'Tag. ' + src, () => setFilter({ tag: t })));
  if (license && Number(r.hasLicense)) {
    const w = licenseWoj(r);
    if (!w) out.unshift(badge('lic', 'licencja · brak woj.', 'Zamówienie z licencją. Klient nie ma województwa w notatce, a kod pocztowy dostawy nie pozwolił go ustalić.'));
    else if (w.approx) out.unshift(badge('lic', 'licencja · woj. ' + w.label, 'Przybliżenie z kodu pocztowego dostawy — klient nie ma województwa w notatce', () => setFilter({ lic: true })));
    else out.unshift(badge('lic', 'licencja · woj. ' + w.label, 'Zamówienie z licencją. Województwo z notatki klienta.', () => setFilter({ lic: true, woj: w.key })));
  }
  return out.length ? el('div', { class: 'osa-badges' }, out) : null;
}

/** Wartości do eksportu. */
export const osaExport = r => ({ woj: r.wojKey ? wojLabel(r.wojKey) : (r.woj || ''), kind: r.kind || '', title: r.orszakTitle || '', tags: tagList(r.tags).join(', ') });
export function licenseExport(r) {
  if (!Number(r.hasLicense)) return '';
  const w = licenseWoj(r);
  return w ? w.label + (w.approx ? ' (z kodu pocztowego)' : '') : 'brak woj.';
}

/** Pary do dl() dla sekcji „Orszak (z notatki)”. r — wiersz listy (z polami OSA). */
export function osaDetailPairs(r) {
  const lab = osaExport(r), tip = 'Z notatki klienta';
  return [['Województwo', lab.woj, tip], ['Rodzaj podmiotu', lab.kind, tip], ['Tytuł orszaku', lab.title, tip], ['Miejscowość', r.town || '', tip],
    ['Tagi', tagList(r.tags).map(t => '#' + t).join(' '), tip]];
}

// ─── Pasek filtrów ──────────────────────────────────────────────────────────

/**
 * o: { prefix, withLicense, getQ(), apply(patch), facets() → facets | null }
 * Zwraca { node, sync() }. sync() odświeża listy wyboru i stan kontrolek z getQ().
 */
export function osaBar(o) {
  const id = n => o.prefix + n;
  const mkMs = (suffix, field, all, short, noun, tip) => multiSelect({ id: id(suffix), all, short, noun, tip, onChange: csv => o.apply({ [field]: csv }) });
  const woj = mkMs('Woj', 'woj', 'Wszystkie województwa', 'Woj.', 'Województwo', 'Tylko klienci z wybranych województw (z notatki klienta) — można zaznaczyć kilka. Liczby to liczba klientów.');
  const kind = mkMs('Kind', 'kind', 'Wszystkie podmioty', 'Rodzaj', 'Rodzaj podmiotu', 'Tylko klienci wybranych rodzajów podmiotu (szkoła, parafia…) — można zaznaczyć kilka. Liczby to liczba klientów.');
  const tag = mkMs('Tag', 'tag', 'Wszystkie tagi', 'Tagi', 'Tag', 'Tylko klienci z którymkolwiek z wybranych tagów w notatce (#tag) — można zaznaczyć kilka. Liczby to liczba klientów.');
  const title = mkMs('Title', 'title', 'Wszystkie tytuły orszaku', 'Tytuł', 'Tytuł orszaku', 'Tylko klienci z wybranymi tytułami orszaku — można zaznaczyć kilka; wyszukiwarka na liście pomaga znaleźć tytuł. „— bez danych —” pokazuje klientów bez tytułu.');
  const nodata = el('input', { type: 'checkbox', id: id('NoData'), onchange: ev => o.apply({ nodata: ev.target.checked }) });
  const nodataL = el('label', { class: 'osa-chk', id: id('NoDataL') }, nodata, ' pokaż bez danych');
  const lic = el('input', { type: 'checkbox', id: id('Lic'), onchange: ev => o.apply({ lic: ev.target.checked }) });
  const licL = o.withLicense ? el('label', { class: 'osa-chk', title: 'Tylko zamówienia zawierające licencję (produkt z kodem LCN…)' }, lic, ' tylko z licencją') : null;
  const clear = el('button', { type: 'button', class: 'ghost', id: id('Clear'), onclick: () => o.apply(OSA_CLEAR) }, 'Wyczyść');
  const viewBtn = el('button', { type: 'button', class: 'secondary', id: id('ViewBtn'), 'aria-expanded': 'false', 'aria-controls': id('View'),
    title: 'Wybierz, które oznaczenia pokazywać przy wierszach (zapamiętane w tej przeglądarce)' }, 'Widok ▾');
  const prefs = badgePrefs();
  const view = el('div', { class: 'osa-view', id: id('View'), hidden: true }, el('span', { class: 'muted small' }, 'Pokaż oznaczenia:'),
    BADGE_KINDS.filter(b => b.k !== 'lic' || o.withLicense).map(b => el('label', { class: 'osa-chk', title: b.tip },
      el('input', { type: 'checkbox', 'data-pref': b.k, checked: prefs[b.k], onchange: ev => { const p = badgePrefs(); p[b.k] = ev.target.checked; store(BKEY, p); applyBadgePrefs(p); } }), ' ' + b.label)));
  viewBtn.onclick = () => { view.hidden = !view.hidden; viewBtn.setAttribute('aria-expanded', String(!view.hidden)); viewBtn.textContent = view.hidden ? 'Widok ▾' : 'Widok ▴'; };
  // plain: wiersz w zwykłym panelu „Filtry” (Zamówienia) — bez wyróżnionego paska i napisu „★ OSA”
  const star = o.plain ? el('span', { class: 'label tip', title: 'Dane z notatki klienta w sklepie: województwo, rodzaj podmiotu, tytuł orszaku i tagi. Liczby to liczba klientów.' }, 'Orszak') : el('span', { class: 'osa-star tip', title: 'Filtry z notatki klienta w sklepie: województwo, rodzaj podmiotu, tytuł orszaku i tagi. Liczby to liczba klientów.' }, '★ OSA');
  const node = el('div', { class: o.plain ? 'osa-inline' : 'osa-bar', id: id('Bar') },
    el('div', { class: 'osa-row' }, star, woj.node, kind.node, title.node, tag.node, nodataL, licL, clear, viewBtn), view);

  function sync() {
    const Q = o.getQ(), F = o.facets() || {};
    woj.set((F.woj || []).map(x => ({ key: x.key, label: wojLabel(x.key), n: x.n })), Q.woj);
    kind.set((F.kinds || []).map(x => ({ key: x.key, label: x.label || x.key, n: x.n })), Q.kind);
    tag.set((F.tags || []).map(x => ({ key: x.key, label: '#' + x.key, n: x.n })), Q.tag);
    title.set((F.titles || []).map(x => ({ key: x.key, label: x.label || x.key, n: x.n })), Q.title);
    const filt = !!(Q.woj || Q.kind || Q.title || Q.tag);
    nodata.checked = !!Q.nodata; nodata.disabled = !filt;
    nodataL.title = filt ? 'Oprócz pasujących pokazuje też rekordy, które w wybranym polu nie mają żadnych danych (np. klienci bez województwa w notatce)'
      : 'Najpierw wybierz województwo, rodzaj, tytuł lub tag — ta opcja dołącza do wyniku rekordy bez danych w wybranym polu';
    lic.checked = !!Q.lic;
    clear.disabled = !(filt || Q.lic || Q.nodata);
    clear.title = clear.disabled ? 'Brak aktywnych filtrów z notatek klientów' : 'Usuń filtry województwa, rodzaju, tytułu, tagu i licencji (wyszukiwanie i statusy zostają)';
    node.classList.toggle('on', filt || !!Q.lic);
  }
  return { node, sync };
}
