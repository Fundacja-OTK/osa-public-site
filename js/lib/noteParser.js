// WYGENEROWANE z shared/noteParser.js przez scripts/sync-parser.sh — nie edytuj ręcznie.

/**
 * Orszak Selly Assist — parser notatek klienta
 *
 * Format wejściowy (z CSV Selly albo z DOM panelu):
 *   "Tytuł: Pan | Miejscowość orszaku: Wrocław | Liczba uczestników: 100 |
 *    Rodzaj podmiotu: parafia | Diecezja: wrocławska | Województwo: dolnośląskie |
 *    Szerokość geograficzna: 51,11 | Długość geograficzna: 17,03 |
 *    Strona internetowa: example.pl"
 *
 * Tolerowane warianty:
 *   - Separator "|" lub "\n|" (zapisy wielolinijkowe)
 *   - Prefiks "* " przy kluczach ("* Tytuł")
 *   - Alias "Strona internetowa podmiotu" == "Strona internetowa"
 *   - Freetext przed ustrukturyzowaną częścią (np. "Zaufany klient.")
 *   - Freetext po ostatnim polu (operacyjny, np. "zgłoszenie w Sordze")
 *   - Hashtagi w dowolnym miejscu (#bez_subskrypcji)
 *   - Pseudo-klucz "stare dane:" → wpada do pola historyczne
 *
 * Użycie:
 *   const r = parseNote(rawText);
 *   r.parsed.wojewodztwo            // "dolnośląskie" (original form)
 *   r.normalized.wojewodztwoKey     // "dolnoslaskie" (normalized for filtering)
 *   r.tags                          // ["bez_subskrypcji", ...]
 *   r.freetextPrefix, r.freetextSuffix
 *   r.historyczne                   // treść po "stare dane:"
 *   r.unknownFields                 // [{key, value}] dla pól spoza specyfikacji
 *   r.status                        // "empty" | "full" | "partial" | "no_structure"
 */

// Mapa: znormalizowany klucz z notatki → kanoniczna nazwa pola w modelu
const FIELD_ALIASES = {
  'tytul': 'tytul',
  'tytul *': 'tytul',            // tolerancja dla "* Tytuł"
  'miejscowosc orszaku': 'miejscowoscOrszaku',
  'liczba uczestnikow': 'liczbaUczestnikow',
  'rodzaj podmiotu': 'rodzajPodmiotu',
  'diecezja': 'diecezja',
  'wojewodztwo': 'wojewodztwo',
  'szerokosc geograficzna': 'szerokoscGeograficzna',
  'dlugosc geograficzna': 'dlugoscGeograficzna',
  'strona internetowa': 'stronaInternetowa',
  'strona internetowa podmiotu': 'stronaInternetowa',
};

// Słownik normalizacji wartości województwa (dla klucza filtrującego).
// Wartość oryginalna zachowana jest w r.parsed; znormalizowany klucz w r.normalized.
const WOJEWODZTWA = [
  'dolnoslaskie', 'kujawsko-pomorskie', 'lubelskie', 'lubuskie',
  'lodzkie', 'malopolskie', 'mazowieckie', 'opolskie',
  'podkarpackie', 'podlaskie', 'pomorskie', 'slaskie',
  'swietokrzyskie', 'warminsko-mazurskie', 'wielkopolskie',
  'zachodniopomorskie', 'inne - zagranica',
];

const RODZAJE_PODMIOTU = [
  'parafia', 'instytucja kultury', 'stowarzyszenie',
  'jednostka samorzadu terytorialnego i in.',
  'podmiot edukacyjny', 'fundacja', 'inny',
  'kuria', 'szkola', 'inna organizacja religijna',
];

/**
 * Zdejmuje polskie diakrytyki.
 * "Dolnośląskie" → "dolnoslaskie"
 */
function stripDiacritics(s) {
  if (!s) return '';
  const map = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
    'ó': 'o', 'ś': 's', 'ż': 'z', 'ź': 'z',
    'Ą': 'a', 'Ć': 'c', 'Ę': 'e', 'Ł': 'l', 'Ń': 'n',
    'Ó': 'o', 'Ś': 's', 'Ż': 'z', 'Ź': 'z',
  };
  return s.replace(/[ąćęłńóśżźĄĆĘŁŃÓŚŻŹ]/g, ch => map[ch] || ch);
}

/**
 * Normalizuje klucz do porównań: lowercase, bez diakrytyków, bez * i :
 * "* Miejscowość orszaku" → "miejscowosc orszaku"
 */
function normalizeKey(raw) {
  let k = (raw || '').trim().toLowerCase();
  k = k.replace(/^\*+\s*/, '');   // strip leading "* "
  k = k.replace(/\s*:\s*$/, '');   // strip trailing ":"
  k = stripDiacritics(k);
  k = k.replace(/\s+/g, ' ').trim();
  return k;
}

/**
 * Normalizuje wartość do klucza filtru (lowercase, bez diakrytyków,
 * ujednolicenie _ → spacja).
 * "Instytucja_kultury" → "instytucja kultury"
 * "Dolnośląskie" → "dolnoslaskie"
 */
function normalizeValue(raw) {
  let v = (raw || '').trim().toLowerCase();
  v = stripDiacritics(v);
  v = v.replace(/_/g, ' ');
  v = v.replace(/\s+/g, ' ').trim();
  return v;
}

/**
 * Ekstraktuje wszystkie hashtagi (#foo_bar) z dowolnego miejsca w tekście.
 */
function extractTags(text) {
  if (!text) return [];
  const re = /#([a-zA-ZąćęłńóśżźĄĆĘŁŃÓŚŻŹ][a-zA-ZąćęłńóśżźĄĆĘŁŃÓŚŻŹ0-9_]*)/g;
  const tags = [];
  let m;
  while ((m = re.exec(text)) !== null) tags.push(m[1].toLowerCase());
  return [...new Set(tags)];   // dedup
}

/**
 * Główna funkcja — parsuje surowy tekst notatki.
 */
function parseNote(rawNote) {
  const result = {
    parsed: {},                  // oryginalne wartości, np. "Dolnośląskie"
    normalized: {},              // klucze filtrujące, np. wojewodztwoKey: "dolnoslaskie"
    tags: [],
    freetextPrefix: '',
    freetextSuffix: '',
    historyczne: '',
    unknownFields: [],
    status: 'empty',
    rawFragments: 0,
  };

  if (!rawNote || !rawNote.trim()) return result;

  // Wyciągnij tagi z całej notatki (zanim pociąć)
  result.tags = extractTags(rawNote);

  // Split po OBU separatorach: "|" oraz "\n".
  // Dzięki temu tagi w osobnych liniach i freetext po pustym wierszu są dobrze
  // rozdzielane od pól "Klucz: Wartość".
  const working = rawNote.trim();
  const fragments = working
    .split(/\s*[|\n]\s*/)
    .map(f => f.trim())
    .filter(Boolean)
    .filter(f => !/^#/.test(f));  // hashtag-only fragments już wyciągnięte przez extractTags
  result.rawFragments = fragments.length;

  // Czy pierwszy fragment to freetext (brak ":" w rozsądnej pozycji)?
  const isFieldShape = (frag) => /^[^:]{1,40}:/.test(frag);

  let startIdx = 0;
  if (fragments.length > 0 && !isFieldShape(fragments[0])) {
    result.freetextPrefix = fragments[0];
    startIdx = 1;
  }

  for (let i = startIdx; i < fragments.length; i++) {
    const frag = fragments[i];
    const colonIdx = frag.indexOf(':');
    if (colonIdx === -1) {
      // Fragment nie ma ":" — jest sufiksowym freetextem lub częścią poprzedniego
      result.freetextSuffix += (result.freetextSuffix ? ' | ' : '') + frag;
      continue;
    }
    const rawKey = frag.substring(0, colonIdx).trim();
    // Hashtagi są już w result.tags — nie zostawiaj ich w wartości pola
    const rawVal = frag.substring(colonIdx + 1)
      .replace(/(^|\s)#[a-zA-ZąćęłńóśżźĄĆĘŁŃÓŚŻŹ][a-zA-ZąćęłńóśżźĄĆĘŁŃÓŚŻŹ0-9_]*/g, '')
      .trim();
    const normKey = normalizeKey(rawKey);

    if (normKey === 'stare dane') {
      result.historyczne = rawVal;
      continue;
    }

    const canonical = FIELD_ALIASES[normKey];
    if (canonical) {
      if (!(canonical in result.parsed)) {
        result.parsed[canonical] = rawVal;
      } else {
        // Duplikat — już mamy wartość, zapamiętaj jako unknown
        result.unknownFields.push({ key: 'DUPLICATE:' + rawKey, value: rawVal });
      }
    } else {
      result.unknownFields.push({ key: rawKey, value: rawVal });
    }
  }

  // Dodaj znormalizowane klucze filtrujące dla pól kategorycznych
  if (result.parsed.wojewodztwo) {
    result.normalized.wojewodztwoKey = normalizeValue(result.parsed.wojewodztwo);
  }
  if (result.parsed.rodzajPodmiotu) {
    result.normalized.rodzajPodmiotuKey = normalizeValue(result.parsed.rodzajPodmiotu);
  }
  if (result.parsed.tytul) {
    result.normalized.tytulKey = normalizeValue(result.parsed.tytul);
  }
  if (result.parsed.diecezja) {
    result.normalized.diecezjaKey = normalizeValue(result.parsed.diecezja);
  }

  // Spróbuj skonwertować liczbę uczestników
  if (result.parsed.liczbaUczestnikow) {
    const cleaned = result.parsed.liczbaUczestnikow.replace(/[\s,]/g, '');
    if (/^\d+$/.test(cleaned)) {
      result.normalized.liczbaUczestnikowNum = parseInt(cleaned, 10);
    }
    // else: zostaw bez normalized — front-end wyświetli oryginał, ale filtr ilościowy go pominie
  }

  // Ustal status
  const coreFields = ['tytul', 'miejscowoscOrszaku', 'rodzajPodmiotu',
                      'wojewodztwo', 'diecezja', 'liczbaUczestnikow'];
  const hits = coreFields.filter(k => k in result.parsed).length;
  if (hits === 0 && !result.freetextPrefix && result.unknownFields.length === 0) {
    result.status = 'empty';
  } else if (hits >= 5) {
    result.status = 'full';
  } else if (hits > 0) {
    result.status = 'partial';
  } else {
    result.status = 'no_structure';
  }

  return result;
}

/**
 * Eksport — współdzielony kontrakt między Chrome Extension i Apps Script.
 * W Apps Scripcie użyj `parseNote`; w extension content script — importuj jako moduł
 * lub wklej inline (Manifest V3 nie wymaga bundlera dla tak prostego modułu).
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseNote, normalizeKey, normalizeValue, stripDiacritics,
                     extractTags, WOJEWODZTWA, RODZAJE_PODMIOTU, FIELD_ALIASES,
                     postcodeWojewodztwo };
}// Województwo z kodu pocztowego (pierwsze dwie cyfry; wyjątki — trzy). Przybliżenie: granice obszarów
// pocztowych nie pokrywają się dokładnie z granicami województw. Używane, gdy notatka nie
// podaje województwa (np. licencja kupiona bez konta).
const PNA_2 = [
  [0, 9, 'mazowieckie'], [10, 14, 'warminsko-mazurskie'], [15, 18, 'podlaskie'], [19, 19, 'warminsko-mazurskie'],
  [20, 24, 'lubelskie'], [25, 29, 'swietokrzyskie'], [30, 34, 'malopolskie'], [35, 39, 'podkarpackie'],
  [40, 44, 'slaskie'], [45, 49, 'opolskie'], [50, 59, 'dolnoslaskie'], [60, 64, 'wielkopolskie'],
  [65, 69, 'lubuskie'], [70, 78, 'zachodniopomorskie'], [80, 84, 'pomorskie'], [85, 89, 'kujawsko-pomorskie'],
  [90, 99, 'lodzkie'],
];
const PNA_3 = {
  '085': 'lubelskie', '191': 'podlaskie', '192': 'podlaskie', '263': 'lodzkie', '264': 'mazowieckie',
  '265': 'mazowieckie', '266': 'mazowieckie', '267': 'mazowieckie', '268': 'mazowieckie', '269': 'mazowieckie',
  '271': 'mazowieckie', '273': 'mazowieckie', '343': 'slaskie', '474': 'slaskie', '672': 'dolnoslaskie',
  '762': 'pomorskie', '763': 'pomorskie', '771': 'pomorskie', '772': 'pomorskie', '773': 'pomorskie',
  '774': 'wielkopolskie', '823': 'warminsko-mazurskie', '893': 'wielkopolskie', '896': 'pomorskie',
  '963': 'mazowieckie', '965': 'mazowieckie',
};

/** „31-042”, kraj „PL” → „malopolskie”; inny kraj → „inne - zagranica”; brak kodu → ''. */
function postcodeWojewodztwo(postcode, country) {
  if (country && country !== 'PL') return 'inne - zagranica';
  const d = String(postcode || '').replace(/\D/g, '');
  if (d.length !== 5) return '';
  if (PNA_3[d.slice(0, 3)]) return PNA_3[d.slice(0, 3)];
  const p2 = Number(d.slice(0, 2));
  const r = PNA_2.find(([a, b]) => p2 >= a && p2 <= b);
  return r ? r[2] : '';
}



export { parseNote, normalizeValue, extractTags, postcodeWojewodztwo, WOJEWODZTWA, RODZAJE_PODMIOTU };
