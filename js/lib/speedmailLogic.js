// WYGENEROWANE z shared/speedmail.js przez scripts/sync-parser.sh — nie edytuj ręcznie.

/**
 * Panel OSA — nadzór stanów SpeedMail (akcje sm:*): wspólna, czysta logika wg docs/speedmail-spec.md.
 * Źródło: shared/speedmail.js; kopie generuje scripts/sync-parser.sh — nie edytuj ich ręcznie:
 *   panel/worker/src/lib/speedmailLogic.js (moduł ES, Worker)   panel/app/js/lib/speedmailLogic.js (moduł ES, przeglądarka)
 * Bez wejścia/wyjścia i bez danych osobowych: zamówienie = { orderId, orderNumber, date, statusId, delivery, items: [{ productId, name, variant, qty }] }.
 * Testy (w tym testy akceptacyjne z sekcji 10 specyfikacji): tests/unit/speedmail.test.js.
 *
 * Pojęcia:
 *   produkt SM  — pozycja listy SpeedMail (klucz `key`); może mieć kilka ID w Selly (np. edycje 2026 i 2027) albo żadnego (gazety).
 *                 Ilości zawsze w jednostce produktu (sztuki; OrszaKrówki w kg). `per` = ile jednostek to 1 szt. sprzedana w Selly.
 *   rozbicie    — pozycja zamówienia (ID Selly), którą zamienia się na produkty SM (licencja → korony + śpiewniki + naklejki + gazety).
 *   opakowanie  — `pack` jednostek; w tabeli zleceń dla SM ilość = jednostki ÷ pack (wiązki, paczki).
 *   stan        = wysłane (sent) + dosyłki − zlecone + korekty (korekty ze znakiem: zwrot od klienta i anulowanie zlecenia +, uszkodzenie −,
 *                 inwentaryzacja ±) — sekcja 1 i 5 specyfikacji.
 */
(() => {
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const plain = s => String(s == null ? '' : s).toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(Date.parse(s + 'T00:00:00Z'));
  const dayNum = d => Math.round(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 864e5);
  const dayOf = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const addDays = (d, n) => dayOf(dayNum(d) + n);
  const r3 = n => Math.round((Number(n) || 0) * 1000) / 1000;
  const ddmm = d => String(d).slice(8, 10) + '.' + String(d).slice(5, 7);
  const nf = n => String(r3(n)).replace('.', ',');

  // Rodzaje ruchów stanu SM (poza zleceniami): znak wpływu na stan. Inwentaryzacja = różnica po policzeniu (±).
  const MOVE_KINDS = {
    dosylka: { label: 'Dosyłka', sign: 1, tip: 'Towar dosłany do SpeedMail — zwiększa stan' },
    zwrot: { label: 'Zwrot od klienta', sign: 1, tip: 'Towar, który wrócił od klienta do SpeedMail — zwiększa stan' },
    uszkodzenie: { label: 'Uszkodzenie', sign: -1, tip: 'Towar uszkodzony lub zagubiony w SpeedMail — zmniejsza stan' },
    inwentaryzacja: { label: 'Inwentaryzacja', sign: 0, tip: 'Różnica po policzeniu towaru w SpeedMail (stan policzony minus stan w panelu) — może być na plus albo na minus' },
    anulowanie: { label: 'Anulowanie zlecenia', sign: 1, tip: 'Zamówienie anulowane po przekazaniu do SpeedMail — towar wraca na stan' },
  };
  const ORDERED = 'zlecone';
  const LIMITS = { products: 200, ids: 10, bundles: 100, parts: 20, couriers: 30, open: 30, points: 30, text: 120, orders: 500, moves: 200, note: 200, qty: 1e7 };

  // ─── Konfiguracja domyślna (sekcje 2, 3, 4, 6 i 8 specyfikacji) ─────────────────────────────────────────────

  /** [klucz, nazwa, [ID Selly | [ID, przelicznik]], opakowanie, nazwa opakowania, jednostka, propozycja A, propozycja B, flagi] */
  const SEED = [
    ['korona', 'Korona OTK 2027', ['9003'], 150, 'paczka', 'szt.', 300000, 300000, 'P'],
    ['spiewnik-otk', 'Śpiewnik OTK 2027', ['9013'], 50, 'paczka', 'szt.', 120000, 120000, 'P'],
    ['naklejka', 'Naklejka OTK 2027', ['8997'], 100, 'rolka', 'szt.', 104000, 104000, 'P'],
    ['gazety', 'Gazety', [], 100, 'paczka', 'szt.', 190000, 190000, 'P'],
    ['flaga-afryka', 'Chorągiewki AFRYKA', ['8953', '8993'], 50, 'wiązka', 'szt.', 12200, 14000, ''],
    ['flaga-azja', 'Chorągiewki AZJA', ['8954', '8994'], 50, 'wiązka', 'szt.', 11900, 13650, ''],
    ['flaga-europa', 'Chorągiewki EUROPA', ['8955', '8995'], 50, 'wiązka', 'szt.', 11900, 13650, ''],
    ['sztandar-afryka', 'Sztandar Afryka', ['210'], 1, '', 'szt.', 66, 66, ''],
    ['sztandar-azja', 'Sztandar Azja', ['211'], 1, '', 'szt.', 66, 66, ''],
    ['sztandar-europa', 'Sztandar Europa', ['212'], 1, '', 'szt.', 66, 66, ''],
    ['sztandar-wielki', 'Sztandar Trzech Króli – wielki', ['54'], 1, '', 'szt.', 33, 33, ''],
    ['sztandar-maly', 'Sztandar Trzech Króli – mały', ['53'], 1, '', 'szt.', 56, 64, ''],
    ['balon', 'Balon kolorowy z nadrukiem', ['8818'], 100, 'paczka', 'szt.', 6200, 6000, ''],
    ['patyczki', 'Patyczki z koszyczkami (kpl 100)', ['45'], 1, '', 'kpl', 63, 73, ''],
    ['krowki', 'OrszaKrówki', ['8821'], 2.5, 'paczka', 'kg', 182.5, 180, ''],
    ['identyfikator', 'Identyfikator OTK 2027', ['8998'], 25, 'paczka', 'szt.', 625, 700, 'P'],
    ['lizak', 'Lizak OTK', ['9024'], 50, 'paczka', 'szt.', 650, 750, ''],
    ['premium', 'Zestaw Premium C+M+B', [['146', 50], ['319', 5]], 1, '', 'szt.', 175, 235, ''],
    ['kubek', 'Kubek złoty OTK z grawerem', ['8926'], 1, '', 'szt.', 114, 129, ''],
    ['spiewnik-domowy', 'Śpiewnik domowy z kolędami', ['313'], 50, 'paczka', 'szt.', 1800, 1750, ''],
    ['smycz-czerwona', 'Smycz czerwona', ['51'], 1, '', 'szt.', 446, 449, ''],
    ['smycz-granatowa', 'Smycz granatowa', ['8968'], 1, '', 'szt.', 119, 136, ''],
    ['smycz-jasnozielona', 'Smycz jasnozielona', ['8869'], 1, '', 'szt.', 226, 255, ''],
    ['opaska-zielona', 'Opaska silikonowa zielona', ['291'], 1, '', 'szt.', 219, 221, ''],
    ['opaska-granatowa', 'Opaska silikonowa granatowa', ['39'], 1, '', 'szt.', 115, 131, ''],
    ['opaska-zolta', 'Opaska silikonowa żółta', ['8732'], 1, '', 'szt.', 57, 59, ''],
    ['moneta', 'Moneta Orszaku Trzech Króli', ['31'], 10, 'paczka', 'szt.', 120, 120, ''],
    ['szalik', 'Szalik kibica Orszaku', ['8888'], 1, '', 'szt.', 13, 12, 'S'],
    ['czapka', 'Czapka OTK', ['9019'], 1, '', 'szt.', 43, 42, 'S'],
    ['dyplom', 'Dyplom A4 poziomy', ['8892'], 1, '', 'szt.', 39, 45, ''],
    ['teczka', 'Teczka tekturowa', ['8758'], 1, '', 'szt.', 24, 28, 'S'],
    ['okladka', 'Elegancka okładka', ['8902'], 1, '', 'szt.', 13, 14, 'S'],
    ['korona-krola', 'Korona Króla złota regulowana', ['8797'], 1, '', 'szt.', 17, 19, 'S'],
    ['skrzynia', 'Skrzynia na skarby', ['8882'], 1, '', 'szt.', 7, 8, 'S'],
  ];
  const SEED_BUNDLES = [
    ['8989', 'Licencja Członkowska OTK 2027', [['korona', 150], ['spiewnik-otk', 50], ['naklejka', 100], ['gazety', 200]]],
    ['9004', 'Pakiet 150 koron', [['korona', 150]]],
    ['9005', 'Pakiet 300 koron', [['korona', 300]]],
    ['9016', 'Pakiet 50 śpiewników', [['spiewnik-otk', 50]]],
    ['9014', 'Pakiet 100 śpiewników', [['spiewnik-otk', 100]]],
    ['9017', 'Naklejki OTK 2027 (100 szt.)', [['naklejka', 100]]],
    ['8992', 'Pakiet 4 sztandarów', [['sztandar-afryka', 1], ['sztandar-azja', 1], ['sztandar-europa', 1], ['sztandar-wielki', 1]]],
    ['8596', 'Sztandary – pakiet 3', [['sztandar-afryka', 1], ['sztandar-azja', 1], ['sztandar-europa', 1]]],
    ['8996', 'Chorągiewki – zestaw 150', [['flaga-afryka', 50], ['flaga-azja', 50], ['flaga-europa', 50]]],
  ];

  /**
   * Konfiguracja startowa z sekcji 4 specyfikacji. Ilości wysłane do SM (sent) i prognozy = 0 — wpisuje je właściciel;
   * liczby z wariantów A / B specyfikacji są tylko PROPOZYCJĄ (propA / propB), wstawianą w ustawieniach jednym kliknięciem.
   */
  function defaultConfig() {
    return {
      v: 1,
      dates: { smStart: '2026-11-16', presaleStart: '2026-12-10', lastHandover: '2026-12-15' },
      couriers: ['Kurier', 'SpeedMail'],
      locationWord: 'lokalizacj',
      statuses: { open: [], sm: '', acc: '', otk: '' },
      thresholds: { greenDays: 7, redDays: 3, typicalFactor: 2, presalePct: 90, pacePct: 15 },
      file: { orderNo: true, date: true, batch: false, total: true },
      pace: { from: '2026-10-01', to: '2027-01-06', points: [] },
      products: SEED.map(([key, name, ids, pack, packName, unit, a, b, fl], i) => ({
        key, name, unit, pack, packName, col: pack > 1 ? name + ' ' + nf(pack) + ' ' + unit : name, pos: (i + 1) * 10,
        ids: ids.map(x => (Array.isArray(x) ? { id: x[0], per: x[1] } : { id: x, per: 1 })),
        sent: 0, min: fl === 'S' ? 1 : 0, typical: fl === 'S' ? 1 : pack, presale: fl === 'P', forecast: 0, propA: a, propB: b,
      })),
      bundles: SEED_BUNDLES.map(([id, name, parts]) => ({ id, name, parts: parts.map(([key, qty]) => ({ key, qty })) })),
    };
  }

  // ─── Walidacja konfiguracji (lista dozwolonych pól, typy, długości, limity) ───────────────────────────────

  const only = (o, keys, where) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw fail(400, 'Nieprawidłowe dane: ' + where + '.');
    for (const k of Object.keys(o)) if (!keys.includes(k)) throw fail(400, 'Nieznane pole w ustawieniach (' + where + '): ' + String(k).slice(0, 40));
    return o;
  };
  const text = (v, max, where, req) => {
    if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'number') throw fail(400, 'Nieprawidłowy tekst: ' + where + '.');
    const s = String(v == null ? '' : v).trim();
    if (s.length > max) throw fail(400, 'Za długi tekst (' + where + ', maks. ' + max + ' znaków).');
    if (req && !s) throw fail(400, 'Brak wartości: ' + where + '.');
    return s;
  };
  const num = (v, where, { min = 0, max = LIMITS.qty, int = false } = {}) => {
    const n = typeof v === 'string' ? Number(v.replace(/[\s ]/g, '').replace(',', '.') || NaN) : Number(v);   // „12 200” i „182,5” z formularza
    if (typeof v === 'boolean' || v === '' || v === null || v === undefined || !isFinite(n) || n < min || n > max || (int && Math.floor(n) !== n)) {
      throw fail(400, 'Nieprawidłowa liczba: ' + where + ' (dozwolone ' + min + '–' + max + (int ? ', całkowita' : '') + ').');
    }
    return n;
  };
  const day = (v, where) => { if (!isDay(v)) throw fail(400, 'Nieprawidłowa data: ' + where + ' (format RRRR-MM-DD).'); return String(v); };
  const list = (v, max, where) => {
    if (!Array.isArray(v)) throw fail(400, 'Nieprawidłowa lista: ' + where + '.');
    if (v.length > max) throw fail(400, 'Za długa lista: ' + where + ' (maks. ' + max + ').');
    return v;
  };
  const sellyId = (v, where) => { const s = text(v, 12, where, true); if (!/^\d{1,12}$/.test(s)) throw fail(400, 'ID Selly musi być liczbą: ' + where + '.'); return s; };

  /** Ustawienia z panelu → znormalizowana konfiguracja; błąd 400 z opisem po polsku. Nieznane pola są odrzucane. */
  function checkConfig(input) {
    const c = only(input, ['v', 'dates', 'couriers', 'locationWord', 'statuses', 'thresholds', 'file', 'pace', 'products', 'bundles'], 'ustawienia');
    const d = only(c.dates, ['smStart', 'presaleStart', 'lastHandover'], 'terminy');
    const dates = { smStart: day(d.smStart, 'start pakowania w SM'), presaleStart: day(d.presaleStart, 'start przedsprzedaży'), lastHandover: day(d.lastHandover, 'ostatni dzień przekazania') };
    if (dates.smStart > dates.lastHandover || dates.presaleStart > dates.lastHandover) throw fail(400, 'Ostatni dzień przekazania zamówień do SM musi być po pozostałych terminach.');
    const couriers = [...new Set(list(c.couriers, LIMITS.couriers, 'formy dostawy').map((x, i) => text(x, 80, 'forma dostawy ' + (i + 1), true)))];
    const st = only(c.statuses || {}, ['open', 'sm', 'acc', 'otk'], 'statusy');
    const sid = (v, w) => { const s = text(v, 20, w); if (s && !/^[\w-]+$/.test(s)) throw fail(400, 'Nieprawidłowy status: ' + w + '.'); return s; };
    const statuses = { open: [...new Set(list(st.open || [], LIMITS.open, 'statusy zamówień do wyboru').map(x => sid(x, 'status')).filter(Boolean))], sm: sid(st.sm, 'status SM'), acc: sid(st.acc, 'status przyjęte'), otk: sid(st.otk, 'status OTK') };
    const t = only(c.thresholds, ['greenDays', 'redDays', 'typicalFactor', 'presalePct', 'pacePct'], 'progi alertów');
    const thresholds = { greenDays: num(t.greenDays, 'próg zielony (dni)', { min: 1, max: 365 }), redDays: num(t.redDays, 'próg czerwony (dni)', { min: 0, max: 365 }),
      typicalFactor: num(t.typicalFactor, 'krotność typowego zamówienia', { min: 0, max: 100 }), presalePct: num(t.presalePct, 'próg przedsprzedaży (%)', { min: 1, max: 1000 }),
      pacePct: num(t.pacePct, 'próg tempa (%)', { min: 1, max: 1000 }) };
    if (thresholds.redDays > thresholds.greenDays) throw fail(400, 'Próg czerwony (dni) nie może być większy niż zielony.');
    const f = only(c.file || {}, ['orderNo', 'date', 'batch', 'total', 'address'], 'plik dla SM');
    if (f.address) throw fail(400, 'Dane adresowe w pliku dla SM są wyłączone do czasu potwierdzenia szablonu SpeedMail.');
    const file = { orderNo: f.orderNo !== false, date: !!f.date, batch: !!f.batch, total: f.total !== false };
    const pc = only(c.pace || {}, ['from', 'to', 'points'], 'tempo sprzedaży');
    const pace = { from: day(pc.from, 'początek sprzedaży'), to: day(pc.to, 'koniec sezonu'),
      points: list(pc.points || [], LIMITS.points, 'punkty prognozy').map((p, i) => { only(p, ['day', 'pct'], 'punkt prognozy'); return { day: day(p.day, 'punkt prognozy ' + (i + 1)), pct: num(p.pct, 'punkt prognozy ' + (i + 1) + ' (%)', { max: 100 }) }; })
        .sort((a, b) => (a.day < b.day ? -1 : 1)) };
    if (pace.from >= pace.to) throw fail(400, 'Koniec sezonu musi być po początku sprzedaży.');
    for (let i = 0; i < pace.points.length; i++) {
      const p = pace.points[i];
      if (p.day <= pace.from || p.day >= pace.to) throw fail(400, 'Punkty prognozy muszą leżeć między początkiem sprzedaży a końcem sezonu.');
      if (i && (p.day === pace.points[i - 1].day || p.pct < pace.points[i - 1].pct)) throw fail(400, 'Punkty prognozy muszą rosnąć (kolejne dni, coraz większy procent).');
    }
    const keys = new Set(), ids = new Set();
    const products = list(c.products, LIMITS.products, 'produkty SM').map((p, i) => {
      const w = 'produkt ' + (i + 1);
      only(p, ['key', 'name', 'unit', 'pack', 'packName', 'col', 'pos', 'ids', 'sent', 'min', 'typical', 'presale', 'forecast', 'propA', 'propB'], w);
      const key = text(p.key, 40, w + ': klucz', true);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw fail(400, 'Klucz produktu: tylko małe litery, cyfry i myślnik (' + w + ').');
      if (keys.has(key)) throw fail(400, 'Powtórzony klucz produktu: ' + key);
      keys.add(key);
      const name = text(p.name, LIMITS.text, w + ': nazwa', true);
      const out = { key, name, unit: text(p.unit, 10, w + ': jednostka') || 'szt.', pack: num(p.pack, name + ': opakowanie', { min: 0.001, max: 1e5 }), packName: text(p.packName, 30, name + ': nazwa opakowania'),
        col: text(p.col, LIMITS.text, name + ': kolumna w tabeli SM'), pos: num(p.pos == null ? 0 : p.pos, name + ': kolejność kolumny', { max: 1e5, int: true }),
        ids: list(p.ids || [], LIMITS.ids, name + ': ID Selly').map(x => { only(x, ['id', 'per'], name + ': ID Selly'); return { id: sellyId(x.id, name), per: num(x.per == null ? 1 : x.per, name + ': przelicznik', { min: 0.001, max: 1e5 }) }; }),
        sent: num(p.sent == null ? 0 : p.sent, name + ': wysłane do SM'), min: num(p.min == null ? 0 : p.min, name + ': minimum'), typical: num(p.typical == null ? 0 : p.typical, name + ': typowe zamówienie'),
        presale: p.presale === true, forecast: num(p.forecast == null ? 0 : p.forecast, name + ': prognoza'),
        propA: num(p.propA == null ? 0 : p.propA, name + ': propozycja A'), propB: num(p.propB == null ? 0 : p.propB, name + ': propozycja B') };
      for (const x of out.ids) { if (ids.has(x.id)) throw fail(400, 'ID Selly ' + x.id + ' jest przypisane dwa razy.'); ids.add(x.id); }
      return out;
    });
    const bundles = list(c.bundles || [], LIMITS.bundles, 'rozbicia').map((b, i) => {
      const w = 'rozbicie ' + (i + 1);
      only(b, ['id', 'name', 'parts'], w);
      const id = sellyId(b.id, w);
      if (ids.has(id)) throw fail(400, 'ID Selly ' + id + ' jest przypisane dwa razy (produkt i rozbicie albo dwa rozbicia).');
      ids.add(id);
      const parts = list(b.parts, LIMITS.parts, w + ': składniki').map(x => {
        only(x, ['key', 'qty'], w + ': składnik');
        const key = text(x.key, 40, w + ': składnik', true);
        if (!keys.has(key)) throw fail(400, 'Rozbicie ' + id + ': nieznany produkt SM „' + key + '”.');
        return { key, qty: num(x.qty, w + ': ilość składnika', { min: 0.001 }) };
      });
      if (!parts.length) throw fail(400, 'Rozbicie ' + id + ' nie ma składników.');
      return { id, name: text(b.name, LIMITS.text, w + ': nazwa'), parts };
    });
    return { v: 1, dates, couriers, locationWord: text(c.locationWord, 40, 'słowo lokalizacji'), statuses, thresholds, file, pace, products, bundles };
  }

  // ─── Indeks, rozbicia ────────────────────────────────────────────────────────────────────────────────

  /** Indeks konfiguracji: prod (klucz → produkt), byId (ID Selly → { key, per }), bundles (ID Selly → składniki). */
  function index(cfg) {
    const prod = new Map(), byId = new Map(), bundles = new Map();
    for (const p of cfg.products || []) { prod.set(p.key, p); for (const x of p.ids || []) byId.set(String(x.id), { key: p.key, per: Number(x.per) || 1 }); }
    for (const b of cfg.bundles || []) bundles.set(String(b.id), b);
    return { prod, byId, bundles, loc: plain(cfg.locationWord) };
  }

  /**
   * Pozycje zamówienia → zapotrzebowanie w produktach SM (jednostki produktu). Obsługuje zestaw rozbity przez Selly na składniki
   * (zwykłe pozycje z ID produktów SM) i zestaw jako jedną linię (rozbicie z konfiguracji).
   * → { need: { key: ilość }, unknown: [{ productId, name }], located: [{ productId, name }], presale, bundled }
   */
  function explode(items, ix) {
    const need = {}, unknown = [], located = [];
    let presale = false, bundled = 0;
    const add = (key, q) => { need[key] = r3((need[key] || 0) + q); if (ix.prod.get(key).presale) presale = true; };
    for (const it of items || []) {
      const qty = Number(it.qty) || 0, id = String(it.productId == null ? '' : it.productId);
      if (qty <= 0) continue;
      const row = { productId: id, name: String(it.name || '') };
      if (ix.loc && (plain(it.name).includes(ix.loc) || plain(it.variant).includes(ix.loc))) { located.push(row); continue; }
      const b = ix.bundles.get(id), p = ix.byId.get(id);
      if (b) { bundled++; for (const part of b.parts) add(part.key, part.qty * qty); }
      else if (p) add(p.key, p.per * qty);
      else unknown.push(row);
    }
    return { need, unknown, located, presale, bundled };
  }

  // ─── Reguły przydziału (sekcja 3) ──────────────────────────────────────────────────────────────────────

  const REASONS = {
    ok: { rule: 0, label: 'spełnia reguły' },
    'manual-sm': { rule: 0, label: 'ręcznie: do SpeedMail' },
    delivery: { rule: 1, label: 'forma dostawy' },
    product: { rule: 2, label: 'produkt spoza listy SM' },
    location: { rule: 2, label: 'produkt z lokalizacją' },
    empty: { rule: 2, label: 'brak pozycji' },
    late: { rule: 3, label: 'złożone po terminie' },
    after: { rule: 3, label: 'po ostatnim dniu przekazania' },
    early: { rule: 3, label: 'złożone przed startem SM' },
    'manual-my': { rule: 4, label: 'ręcznie: pakujemy sami' },
    stock: { rule: 5, label: 'brak towaru w SM' },
    sent: { rule: 0, label: 'już przekazane' },
  };
  const isCourier = (cfg, name) => { const n = plain(name); return !!n && (cfg.couriers || []).some(c => plain(c) === n); };
  const names = (rows, max = 2) => rows.slice(0, max).map(r => r.name || ('#' + r.productId)).join(', ') + (rows.length > max ? ' (+' + (rows.length - max) + ')' : '');

  /** Stan dostępny produktu: wysłane + dosyłki − zlecone + korekty. totals[key] = { dosylka, zlecone, zwrot, uszkodzenie, inwentaryzacja, anulowanie }. */
  function stockOf(p, t) {
    t = t || {};
    return r3((Number(p.sent) || 0) + (t.dosylka || 0) - (t.zlecone || 0) + (t.zwrot || 0) + (t.uszkodzenie || 0) + (t.inwentaryzacja || 0) + (t.anulowanie || 0));
  }

  /**
   * Decyzja dla każdego zamówienia: do SpeedMail („sm”) albo pakujemy sami („my”) z powodem (reguła 1–5). Zamówienia nie dzielimy.
   * o: { cfg, today: 'RRRR-MM-DD', totals, marks: { orderId: { result: 'my' | 'sm', note } }, sent: { orderId: { no } } }
   * Kolejność przydziału towaru: najpierw zamówienia oznaczone ręcznie „do SM”, potem od najstarszych.
   * → wiersze w kolejności wejścia: { o, result: 'sm' | 'my' | 'sent', code, rule, reason, manual, need, presale, waits, missing, stock: 'ok' | 'brak' | '',
   *     canForce (czy wolno ręcznie przenieść do SM), batch }
   */
  function plan(orders, o) {
    const cfg = o.cfg, ix = index(cfg), today = String(o.today || '').slice(0, 10), marks = o.marks || {}, sent = o.sent || {};
    const avail = {};
    for (const p of cfg.products) avail[p.key] = stockOf(p, (o.totals || {})[p.key]);
    const D = cfg.dates, cour = (cfg.couriers || []).join(', ');
    const rows = (orders || []).map(ord => {
      const ex = explode(ord.items, ix), id = String(ord.orderId), d = String(ord.date || '').slice(0, 10);
      const row = { o: ord, need: ex.need, presale: ex.presale, waits: ex.presale && today < D.presaleStart, bundled: ex.bundled, manual: false, missing: [], stock: '', canForce: false, note: '' };
      const set = (result, code, reason) => Object.assign(row, { result, code, rule: REASONS[code].rule, reason });
      if (sent[id]) { row.batch = sent[id].no; return set('sent', 'sent', 'Przekazane do SpeedMail w paczce nr ' + sent[id].no); }
      const hasNeed = Object.keys(ex.need).length > 0;
      // Reguły 1–3 (bez stanu): pierwszy niespełniony warunek jest powodem
      let auto = null;
      if (!isCourier(cfg, ord.delivery)) auto = ['delivery', 'Dostawa „' + (ord.delivery || 'brak') + '” — do SpeedMail idą tylko: ' + (cour || '—')];
      else if (ex.located.length) auto = ['location', 'Produkt z lokalizacją: ' + names(ex.located)];
      else if (ex.unknown.length) auto = ['product', 'Produkt spoza listy SpeedMail: ' + names(ex.unknown)];
      else if (!hasNeed) auto = ['empty', 'Zamówienie nie ma pozycji do wysłania'];
      else if (d > D.lastHandover) auto = ['late', 'Złożone po ' + ddmm(D.lastHandover) + ' — pakujemy sami'];
      else if (today > D.lastHandover) auto = ['after', 'Od ' + ddmm(addDays(D.lastHandover, 1)) + ' pakujemy sami (ostatni dzień przekazania do SM: ' + ddmm(D.lastHandover) + ')'];
      else if (!ex.presale && d < D.smStart) auto = ['early', 'Bez przedsprzedaży, złożone przed ' + ddmm(D.smStart) + ' — pakujemy sami'];
      const blocked = ex.located.length > 0 || ex.unknown.length > 0 || !hasNeed;
      row.canForce = !blocked;
      const m = marks[id];
      if (m && m.result === 'my') { row.manual = true; row.note = String(m.note || ''); return set('my', 'manual-my', 'Oznaczone ręcznie: pakujemy sami' + (m.note ? ' — ' + m.note : '')); }
      if (m && m.result === 'sm' && !blocked) { row.manual = true; row.note = String(m.note || ''); row.forced = true; return row; }
      if (auto) { if (!blocked) row.stock = '?'; return set('my', auto[0], auto[1]); }
      row.eligible = true;
      return row;
    });
    const lack = need => Object.keys(need).filter(k => need[k] > Math.max(0, avail[k] || 0) + 1e-9)
      .map(k => ({ key: k, name: ix.prod.get(k).name, unit: ix.prod.get(k).unit, lack: r3(need[k] - Math.max(0, avail[k] || 0)) }));
    const take = need => { for (const k in need) avail[k] = r3((avail[k] || 0) - need[k]); };
    const lackText = miss => miss.slice(0, 3).map(x => x.name + ' (brakuje ' + nf(x.lack) + ' ' + x.unit + ')').join(', ') + (miss.length > 3 ? ' (+' + (miss.length - 3) + ')' : '');
    const waitText = r => (r.waits ? ' · przedsprzedaż: SpeedMail wyśle od ' + ddmm(D.presaleStart) : '');
    const byDate = (a, b) => (a.o.date < b.o.date ? -1 : a.o.date > b.o.date ? 1 : String(a.o.orderId) < String(b.o.orderId) ? -1 : 1);
    for (const r of rows.filter(x => x.forced).sort(byDate)) {
      r.missing = lack(r.need); r.stock = r.missing.length ? 'brak' : 'ok'; take(r.need);
      Object.assign(r, { result: 'sm', code: 'manual-sm', rule: 0, reason: 'Oznaczone ręcznie: do SpeedMail' + (r.note ? ' — ' + r.note : '') + (r.missing.length ? ' · UWAGA, brak towaru: ' + lackText(r.missing) : '') + waitText(r) });
    }
    for (const r of rows.filter(x => x.eligible).sort(byDate)) {
      r.missing = lack(r.need);
      if (r.missing.length) { Object.assign(r, { result: 'my', code: 'stock', rule: 5, stock: 'brak', reason: 'Brak towaru w SpeedMail: ' + lackText(r.missing) }); continue; }
      take(r.need);
      Object.assign(r, { result: 'sm', code: 'ok', rule: 0, stock: 'ok', reason: 'Spełnia reguły, towar jest w SpeedMail' + waitText(r) });
    }
    // Zamówienia „my” z reguł 1–3 bez produktów spoza listy: informacyjnie, czy SM miałby na nie towar (po przydziale pozostałych)
    for (const r of rows) if (r.stock === '?') { r.missing = lack(r.need); r.stock = r.missing.length ? 'brak' : 'ok'; }
    return { rows, left: avail };
  }

  /** Suma zapotrzebowania wybranych wierszy i produkty, których łącznie zabraknie (wybór ręczny). */
  function selectionUse(rows, selected, totals, cfg) {
    const use = {};
    for (const r of rows) if (selected.has(String(r.o.orderId))) for (const k in r.need) use[k] = r3((use[k] || 0) + r.need[k]);
    const over = cfg.products.filter(p => use[p.key] > Math.max(0, stockOf(p, (totals || {})[p.key])) + 1e-9).map(p => p.key);
    return { use, over };
  }

  // ─── Stan i alerty (sekcje 5 i 6) ──────────────────────────────────────────────────────────────────────

  const LEVELS = {
    none: { label: 'brak danych', tone: 'neutral', tip: 'Nie wpisano jeszcze, ile tego produktu wysłano do SpeedMail' },
    green: { label: 'zielony', tone: 'ok', tip: 'Zapas wystarcza: dni zapasu powyżej progu i stan powyżej minimum' },
    yellow: { label: 'żółty', tone: 'warn', tip: 'Rozważ dosyłkę: kończy się zapas (dni zapasu w strefie żółtej) albo stan jest mniejszy niż kilka typowych zamówień' },
    red: { label: 'czerwony', tone: 'bad', tip: 'Dosyłka albo wstrzymanie przekazywania tego produktu: zapas na mniej dni niż próg czerwony albo stan poniżej minimum' },
    stop: { label: 'stop', tone: 'bad', tip: 'W SpeedMail nie ma już tego produktu — zamówienia z nim zostają u nas' },
  };

  /**
   * Stan produktów SM z alertami. totals[key] = sumy rodzajów ruchów (+ zlecone7 = zlecone w ostatnich 7 dniach).
   * Dni zapasu = stan ÷ średnia dzienna zleconych z 7 dni; dla przedsprzedaży przed startem wysyłki nie liczymy (zlecenia czekają) —
   * zamiast tego alert, gdy zlecone > próg % towaru w SM.
   */
  function stockRows(cfg, totals, today) {
    const t = cfg.thresholds, pre = String(today) < cfg.dates.presaleStart;
    return cfg.products.map(p => {
      const x = (totals || {})[p.key] || {};
      const topups = r3(x.dosylka || 0), ordered = r3(x.zlecone || 0);
      const corr = r3((x.zwrot || 0) + (x.uszkodzenie || 0) + (x.inwentaryzacja || 0) + (x.anulowanie || 0));
      const stock = stockOf(p, x), ordered7 = r3(x.zlecone7 || 0), perDay = ordered7 / 7;
      const waiting = p.presale && pre;
      const days = waiting || perDay <= 0 ? null : stock / perDay;
      const known = (Number(p.sent) || 0) > 0 || topups !== 0 || ordered !== 0 || corr !== 0;
      const why = [];
      let level = 'green';
      if (!known) level = 'none';
      else if (stock <= 0) { level = 'stop'; why.push('stan ' + nf(stock) + ' ' + p.unit); }
      else {
        if (days !== null && days < t.redDays) why.push('zapas na ' + nf(Math.floor(days * 10) / 10) + ' dni (próg ' + nf(t.redDays) + ')');
        if (p.min > 0 && stock < p.min) why.push('stan poniżej minimum (' + nf(p.min) + ' ' + p.unit + ')');
        if (why.length) level = 'red';
        else {
          if (days !== null && days <= t.greenDays) why.push('zapas na ' + nf(Math.floor(days * 10) / 10) + ' dni (próg ' + nf(t.greenDays) + ')');
          if (p.typical > 0 && stock < t.typicalFactor * p.typical) why.push('stan mniejszy niż ' + nf(t.typicalFactor) + ' × typowe zamówienie (' + nf(p.typical) + ' ' + p.unit + ')');
          if (p.min > 0 && stock === p.min) why.push('stan równy minimum');
          if (why.length) level = 'yellow';
        }
      }
      const gross = r3((Number(p.sent) || 0) + topups + corr);
      const presalePct = p.presale && gross > 0 ? ordered / gross * 100 : null;
      return { key: p.key, name: p.name, unit: p.unit, pack: p.pack, packName: p.packName, presale: !!p.presale, sent: Number(p.sent) || 0, topups, ordered, corr, stock,
        packs: p.pack > 0 ? r3(stock / p.pack) : stock, ordered7, perDay: r3(perDay), days, runOut: days === null ? '' : addDays(today, Math.floor(days)), waiting,
        level, why, min: p.min, typical: p.typical, presalePct, presaleAlert: presalePct !== null && presalePct > t.presalePct, parts: x };
    });
  }

  // ─── Tabela zleceń dla SM (sekcja 7) ───────────────────────────────────────────────────────────────────

  const batchRef = (no, d) => 'SM-' + String(d).replace(/-/g, '') + '-' + String(no).padStart(3, '0');
  /** Kolumny produktów w JEDNYM stałym układzie sezonu: wszystkie produkty SM wg kolejności z ustawień (także puste w tej paczce). */
  const tableProducts = cfg => cfg.products.slice().sort((a, b) => (a.pos - b.pos) || a.name.localeCompare(b.name, 'pl'));

  /**
   * Tabela zleceń (format downloadXlsx): jeden wiersz = jedno zamówienie, produkty w kolumnach, ilości w OPAKOWANIACH SM (jednostki ÷ opakowanie).
   * orders: [{ orderNumber, date, need: { key: ilość } }]; batch: { no, day }. Bez danych osobowych (kolumny adresowe wyłączone — szablon SM niepotwierdzony).
   * → { file, sheet, columns, rows, partial: [{ orderNumber, name }] — niepełne opakowania (sygnał złego przelicznika) }
   */
  function smTable(cfg, orders, batch) {
    const f = cfg.file || {}, prods = tableProducts(cfg), ref = batchRef(batch.no, batch.day);
    const lead = [];
    if (f.batch) lead.push({ header: 'Paczka zleceń', type: 'text', get: () => ref });
    if (f.orderNo !== false) lead.push({ header: 'Nr zamówienia', type: 'text', get: o => String(o.orderNumber || '') });
    if (f.date) lead.push({ header: 'Data zamówienia', type: 'text', get: o => String(o.date || '').slice(0, 10) });
    if (!lead.length) lead.push({ header: 'Nr zamówienia', type: 'text', get: o => String(o.orderNumber || '') });
    const partial = [], sum = {};
    const packs = (p, q) => r3(q / p.pack);
    const rows = (orders || []).map(o => lead.map(c => c.get(o)).concat(prods.map(p => {
      const q = (o.need || {})[p.key] || 0;
      if (!q) return null;
      sum[p.key] = r3((sum[p.key] || 0) + q);
      const n = packs(p, q);
      if (Math.abs(n - Math.round(n)) > 1e-6) partial.push({ orderNumber: String(o.orderNumber || ''), name: p.name });
      return n;
    })));
    if (f.total !== false && rows.length) rows.push(lead.map((c, i) => (i === lead.length - 1 ? 'Razem' : '')).concat(prods.map(p => (sum[p.key] ? packs(p, sum[p.key]) : null))));
    return { file: 'zlecenia-SM-' + batch.day + '-paczka-' + String(batch.no).padStart(3, '0'), sheet: 'Zlecenia SM', ref,
      columns: lead.map(c => ({ header: c.header, type: c.type })).concat(prods.map(p => ({ header: p.col || p.name, type: 'number' }))), rows, partial, sum };
  }

  // ─── Monitor tempa sprzedaży (sekcja 8) ────────────────────────────────────────────────────────────────

  /** Jaka część prognozy sezonu powinna być sprzedana do dnia `d` (0–1): odcinkami liniowo przez punkty z ustawień. */
  function curveAt(cfg, d) {
    const pc = cfg.pace, pts = [{ day: pc.from, pct: 0 }].concat(pc.points || [], [{ day: pc.to, pct: 100 }]);
    const x = dayNum(d);
    if (x <= dayNum(pc.from)) return 0;
    if (x >= dayNum(pc.to)) return 1;
    for (let i = 1; i < pts.length; i++) {
      const a = dayNum(pts[i - 1].day), b = dayNum(pts[i].day);
      if (x <= b) return (pts[i - 1].pct + (pts[i].pct - pts[i - 1].pct) * (x - a) / Math.max(1, b - a)) / 100;
    }
    return 1;
  }

  /**
   * Sprzedaż narastająco wobec prognozy. sales: [{ day, productId, qty }] (zestawy rozbijane na produkty SM).
   * → [{ key, name, unit, presale, forecast, sold, expected, diffPct, signal: 'fast' | 'slow' | 'ok' | 'none', left, series: [{ day, cum }] }]
   */
  function pace(cfg, sales, today) {
    const ix = index(cfg), perKey = new Map();
    const add = (key, d, q) => { let m = perKey.get(key); if (!m) { m = new Map(); perKey.set(key, m); } m.set(d, (m.get(d) || 0) + q); };
    for (const s of sales || []) {
      const d = String(s.day).slice(0, 10), q = Number(s.qty) || 0, id = String(s.productId);
      if (!isDay(d) || d < cfg.pace.from || d > today || q <= 0) continue;
      const b = ix.bundles.get(id), p = ix.byId.get(id);
      if (b) for (const part of b.parts) add(part.key, d, part.qty * q);
      else if (p) add(p.key, d, p.per * q);
    }
    const share = curveAt(cfg, today), lim = cfg.thresholds.pacePct;
    return cfg.products.map(p => {
      const m = perKey.get(p.key) || new Map();
      let cum = 0;
      const series = [...m.keys()].sort().map(d => { cum = r3(cum + m.get(d)); return { day: d, cum }; });
      const forecast = Number(p.forecast) || 0, expected = r3(forecast * share);
      const diffPct = expected > 0 ? (cum - expected) / expected * 100 : null;
      const signal = diffPct === null ? 'none' : diffPct > lim ? 'fast' : diffPct < -lim ? 'slow' : 'ok';
      return { key: p.key, name: p.name, unit: p.unit, presale: !!p.presale, forecast, sold: cum, expected, diffPct, signal, left: forecast > 0 ? r3(forecast - cum) : null, series };
    });
  }

  // ─── Statusy i wejście akcji ───────────────────────────────────────────────────────────────────────────

  /** Statusy z nazw Selly, gdy w ustawieniach nic nie wybrano: sm „Złożone SpeedMail”, acc „Przyjęte / Zrealizowano SpeedMail”, otk „Złożone OTK”, open — nowe / złożone / opłacone. */
  function defaultStatuses(statuses) {
    const st = statuses || [];
    const find = test => { const s = st.find(x => test(plain(x.name))); return s ? String(s.id) : ''; };
    const sm = find(n => n.includes('speed') && n.includes('zloz'));
    const acc = find(n => n.includes('speed') && (n.includes('przyj') || n.includes('zrealiz')));
    const otk = find(n => n.includes('otk') && n.includes('zloz'));
    const special = new Set([sm, acc, otk].filter(Boolean));
    const open = st.filter(x => !special.has(String(x.id)) && /^(nowe|nowe zamowienie|zlozone|oplacone|zaplacone)$/.test(plain(x.name))).map(x => String(x.id));
    return { sm, acc, otk, open };
  }
  /** Statusy w użyciu: z ustawień, a gdy puste / nieistniejące — z nazw. */
  function effectiveStatuses(cfg, statuses) {
    const d = defaultStatuses(statuses), have = new Set((statuses || []).map(s => String(s.id))), c = cfg.statuses || {};
    const pick = (v, def) => (v && have.has(String(v)) ? String(v) : def);
    const sm = pick(c.sm, d.sm), acc = pick(c.acc, d.acc), otk = pick(c.otk, d.otk);
    const chosen = (c.open || []).map(String).filter(x => have.has(x));
    const open = (chosen.length ? chosen : d.open).filter(x => x !== sm && x !== acc && x !== otk);
    return { sm, acc, otk, open };
  }

  /** Lista id zamówień z panelu: teksty ≤ 32 znaki, bez powtórzeń, 1–max. */
  function orderIds(v, max) {
    if (!Array.isArray(v) || !v.length) throw fail(400, 'Nie wybrano zamówień.');
    if (v.length > (max || LIMITS.orders)) throw fail(400, 'Za dużo zamówień naraz (maks. ' + (max || LIMITS.orders) + ').');
    const out = [];
    for (const x of v) {
      if (typeof x !== 'string' && typeof x !== 'number') throw fail(400, 'Nieprawidłowy identyfikator zamówienia.');
      const s = String(x);
      if (!/^[\w-]{1,32}$/.test(s)) throw fail(400, 'Nieprawidłowy identyfikator zamówienia.');
      if (!out.includes(s)) out.push(s);
    }
    return out;
  }

  /** Ruchy stanu z panelu → [{ key, kind, qty (ze znakiem), note }]. Ilość dodatnia; znak nadaje rodzaj (inwentaryzacja: różnica ±). */
  function checkMoves(moves, cfg) {
    if (!Array.isArray(moves) || !moves.length) throw fail(400, 'Brak ruchów do zapisania.');
    if (moves.length > LIMITS.moves) throw fail(400, 'Za dużo ruchów naraz (maks. ' + LIMITS.moves + ').');
    const ix = index(cfg);
    return moves.map((m, i) => {
      const w = 'pozycja ' + (i + 1);
      only(m, ['key', 'kind', 'qty', 'note'], w);
      const key = text(m.key, 40, w + ': produkt', true), kind = text(m.kind, 20, w + ': rodzaj', true);
      if (!ix.prod.has(key)) throw fail(400, 'Nieznany produkt SM (' + w + ').');
      if (!Object.prototype.hasOwnProperty.call(MOVE_KINDS, kind) || kind === 'anulowanie') throw fail(400, 'Nieznany rodzaj ruchu (' + w + ').');
      const sign = MOVE_KINDS[kind].sign;
      const q = num(m.qty, w + ': ilość', { min: sign ? 0.001 : -LIMITS.qty });
      if (!q) throw fail(400, 'Ilość nie może być zerem (' + w + ').');
      return { key, kind, qty: r3(sign ? sign * q : q), note: text(m.note, LIMITS.note, w + ': opis') };
    });
  }

  const api = { MOVE_KINDS, ORDERED, LIMITS, REASONS, LEVELS, plain, isDay, dayNum, addDays, r3, nf, ddmm,
    defaultConfig, checkConfig, index, explode, isCourier, stockOf, plan, selectionUse, stockRows, batchRef, tableProducts, smTable, curveAt, pace,
    defaultStatuses, effectiveStatuses, orderIds, checkMoves };
  globalThis.OSA_SPEEDMAIL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

export const SM = globalThis.OSA_SPEEDMAIL;
