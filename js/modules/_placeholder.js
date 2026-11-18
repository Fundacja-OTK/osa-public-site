// Moduł-zaślepka dla funkcji, których panel OSA jeszcze nie ma: pokazuje „W budowie” i link do panelu Selly.
import { el } from '../core/ui.js';

export const SELLY_ADMIN = 'https://takimarket.pl/adm/';
export const BUILDING_TIP = 'W budowie — na razie użyj panelu Selly';

export function sellyUrl(base, query) {
  const b = base || SELLY_ADMIN;
  return query ? b + query : b;
}

/** @param {{ id, title, sellyQuery?: string, adminUrl?: () => string }} def */
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
      box = el('div', { class: 'card' }, el('div', { class: 'empty' },
        el('p', null, el('strong', null, def.title + ' — w budowie')),
        el('p', null, 'Ta część panelu OSA jeszcze nie powstała. Na razie użyj panelu Selly.'),
        el('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn-link', title: 'Otwiera odpowiednią stronę panelu administracyjnego Selly w nowej karcie' }, 'Otwórz w panelu Selly ↗')));
      root.replaceChildren(box);
    },
    unmount() { box = null; },
  };
}
