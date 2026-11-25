// Karta administratora „Czego wciąż szukasz w Selly”: najczęściej otwierane ekrany Selly z linków „↗” (client:exits:list, 30 dni).
import { el, loadingBox } from '../core/ui.js?v=9f3bf7d';
import { api } from '../core/client.js?v=9f3bf7d';
import { ITEMS } from '../core/nav.js?v=9f3bf7d';

/** Przyjazna nazwa ekranu Selly: pozycja menu o tej trasie, inaczej ekran nadrzędny (przed kropką) albo sama trasa. */
export function screenName(route) {
  const hit = ITEMS.find(i => i.a === route) || ITEMS.find(i => i.a === String(route).split('.')[0]);
  return hit ? hit.title : '';
}

const PRIVACY = 'Zliczamy tylko nazwę ekranu Selly i ekran panelu, z którego kliknięto — bez danych użytkownika, numerów rekordów i adresów.';

export function sellyExitsCard() {
  const body = el('div', { class: 'small muted' }, 'Rozwiń, żeby zobaczyć.');
  let loaded = false;
  const load = async () => {
    body.replaceChildren(loadingBox('Pobieram statystykę…'));
    try {
      const d = await api('client:exits:list', { days: 30 });
      const items = d.items || [];
      if (!items.length) { body.replaceChildren(el('div', { class: 'empty' }, 'Brak danych — statystyka zbiera się od wdrożenia tej funkcji.')); return; }
      const tips = ['Ekran Selly (nazwa z menu, gdy znana) i jego trasa', 'Ile razy otwarto go z panelu OSA w ostatnich 30 dniach', 'Z jakich ekranów panelu OSA najczęściej kliknięto (ekran: liczba)'];
      body.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { id: 'exitsTable' },
        el('thead', null, el('tr', null, ['Ekran Selly', 'Wyjść', 'Najczęściej z'].map((h, i) => el('th', { title: tips[i] }, h)))),
        el('tbody', null, items.map(r => el('tr', null,
          el('td', null, screenName(r.route) || r.route, screenName(r.route) ? el('span', { class: 'small muted' }, ' · ' + r.route) : null),
          el('td', { class: 'num' }, String(r.n)),
          el('td', { class: 'small muted' }, (r.from || []).map(f => f.panel + ' (' + f.n + ')').join(', '))))))));
    } catch (e) { body.replaceChildren(el('div', { class: 'empty error' }, 'Nie udało się pobrać statystyki: ' + (e.message || 'błąd'))); }
  };
  return el('details', { class: 'card', id: 'exitsCard', ontoggle: ev => { if (ev.target.open && !loaded) { loaded = true; load(); } } },
    el('summary', { title: PRIVACY }, el('h2', { class: 'tip', style: 'display:inline', title: PRIVACY }, 'Czego wciąż szukasz w Selly'),
      el('span', { class: 'small muted' }, ' — najczęściej otwierane ekrany Selly (30 dni)')),
    body);
}
