// Moduł-zaślepka dla pozycji menu bez ekranu OSA: „w planie” (Selly ma API) albo „tylko w Selly”.
// Zawsze zwykły link „Otwórz w panelu Selly” (nowa karta) — panel działa bez rozszerzenia; dawne osadzanie Selly w ramce
// (rozszerzenie OSA, docs/selly-embed.md) nie jest już częścią panelu.
import { el } from '../core/ui.js?v=04d1829';

export const SELLY_ADMIN = 'https://takimarket.pl/adm/';
export const BUILDING_TIP = 'W budowie — na razie użyj panelu Selly';

export function sellyUrl(base, query) {
  const b = base || SELLY_ADMIN;
  return query ? b + query : b;
}

/** @param {{ id, title, sellyQuery?: string, adminUrl?: () => string, kind?: 'soon'|'selly', tip?: string }} def */
export function createPlaceholder(def) {
  let box = null;
  return {
    id: def.id,
    title: def.title,
    placeholder: true,
    routes: [],
    mount(root) {
      const base = def.adminUrl ? def.adminUrl() : SELLY_ADMIN;
      const url = sellyUrl(base, def.sellyQuery);
      const selly = def.kind === 'selly';
      box = el('div', { class: 'card placeholder' }, el('div', { class: 'empty' },
        el('div', { class: 'ph-tag ' + (selly ? 'ph-selly' : 'ph-soon') }, selly ? 'Tylko w panelu Selly' : 'W planie'),
        el('p', null, el('strong', null, def.title)),
        el('p', { class: 'muted' }, selly
          ? 'Selly nie udostępnia tej części przez API, więc zostaje w panelu Selly.'
          : (def.tip ? def.tip + '. ' : '') + 'Ten ekran panelu OSA jeszcze nie powstał — na razie użyj panelu Selly.'),
        el('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn-secondary', title: 'Otwiera odpowiednią stronę panelu administracyjnego Selly w nowej karcie (zaloguj się tam, jeśli Selly o to poprosi)' }, 'Otwórz w panelu Selly ↗')));
      root.replaceChildren(box);
    },
    unmount() { box = null; },
  };
}
