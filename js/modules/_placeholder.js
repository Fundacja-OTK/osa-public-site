// Moduł-zaślepka dla pozycji menu bez ekranu OSA: „w planie” (Selly ma API) albo „tylko w Selly”.
// Z rozszerzeniem OSA ekran Selly otwiera się w iframe w układzie panelu (docs/selly-embed.md); bez — link do Selly.
import { el } from '../core/ui.js?v=0ec2249';
import { hasExtension } from '../core/extBridge.js?v=0ec2249';

export const SELLY_ADMIN = 'https://takimarket.pl/adm/';
export const BUILDING_TIP = 'W budowie — na razie użyj panelu Selly';
const LOAD_TIMEOUT_MS = 12000;

export function sellyUrl(base, query) {
  const b = base || SELLY_ADMIN;
  return query ? b + query : b;
}

/** Adres ramki: ten sam ekran Selly + flaga osadzenia i motyw panelu (czytane przez content/embed.js). */
export function embedUrl(url, theme) {
  return url + (url.includes('?') ? '&' : '?') + 'osa_embed=1&osa_theme=' + (theme === 'dark' ? 'dark' : 'light');
}
function currentTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** @param {{ id, title, sellyQuery?: string, adminUrl?: () => string, kind?: 'soon'|'selly', tip?: string }} def */
export function createPlaceholder(def) {
  let box = null, onMsg = null, timer = null;
  const cleanup = () => { clearTimeout(timer); if (onMsg) window.removeEventListener('message', onMsg); onMsg = null; };

  function mountEmbed(root, url) {
    const src = embedUrl(url, currentTheme());
    const shopOrigin = new URL(url).origin;
    const frame = el('iframe', { title: def.title + ' — ekran Selly', referrerpolicy: 'no-referrer-when-downgrade' });
    const loading = el('div', { class: 'embed-msg' }, el('p', { class: 'muted' }, 'Ładuję ekran Selly…'));
    const failed = el('div', { class: 'embed-msg', hidden: true },
      el('p', null, el('strong', null, 'Zaloguj się do Selly w tej przeglądarce')),
      el('p', { class: 'muted' }, 'Ekran nie załadował się — zwykle dlatego, że nie jesteś zalogowany do Selly.'),
      el('a', { href: sellyUrl(new URL(url).origin + '/adm/'), target: '_blank', rel: 'noopener', class: 'btn-primary-link', title: 'Otwiera stronę logowania Selly w nowej karcie; po zalogowaniu wróć i kliknij „Odśwież”' }, 'Otwórz logowanie do Selly ↗'));
    const start = () => {
      cleanup(); loading.hidden = false; failed.hidden = true;
      onMsg = ev => {
        if (ev.source !== frame.contentWindow || ev.origin !== shopOrigin || !ev.data || ev.data.osa !== 'embed-ready') return;
        cleanup(); loading.hidden = true;
      };
      window.addEventListener('message', onMsg);
      timer = setTimeout(() => { loading.hidden = true; failed.hidden = false; }, LOAD_TIMEOUT_MS);
      frame.src = src;
    };
    const bar = el('div', { class: 'embed-bar' },
      el('span', { class: 'embed-title tip', title: 'Ten ekran pochodzi z panelu Selly i jest wyświetlany wewnątrz panelu OSA (dzięki rozszerzeniu OSA)' }, 'Ekran z panelu Selly'),
      el('button', { type: 'button', class: 'secondary', title: 'Wczytuje ekran Selly ponownie', onclick: start }, 'Odśwież'),
      el('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn-primary-link', title: 'Otwiera ten sam ekran w panelu Selly, w nowej karcie' }, 'Otwórz w nowej karcie ↗'));
    box = el('div', { class: 'embed-wrap' }, bar, el('div', { class: 'embed-frame-box' }, frame, loading, failed));
    root.replaceChildren(box);
    start();
  }

  return {
    id: def.id,
    title: def.title,
    placeholder: true,
    routes: [],
    mount(root) {
      const base = def.adminUrl ? def.adminUrl() : SELLY_ADMIN;
      const url = sellyUrl(base, def.sellyQuery);
      if (hasExtension()) return mountEmbed(root, url);
      const selly = def.kind === 'selly';
      box = el('div', { class: 'card placeholder' }, el('div', { class: 'empty' },
        el('div', { class: 'ph-tag ' + (selly ? 'ph-selly' : 'ph-soon') }, selly ? 'Tylko w panelu Selly' : 'W planie'),
        el('p', null, el('strong', null, def.title)),
        el('p', { class: 'muted' }, selly
          ? 'Selly nie udostępnia tej części przez API, więc zostaje w panelu Selly.'
          : (def.tip ? def.tip + '. ' : '') + 'Ten ekran panelu OSA jeszcze nie powstał — na razie użyj panelu Selly.'),
        el('a', { href: url, target: '_blank', rel: 'noopener', class: 'btn-primary-link', title: 'Otwiera odpowiednią stronę panelu administracyjnego Selly w nowej karcie' }, 'Otwórz w panelu Selly ↗'),
        el('p', { class: 'muted embed-hint tip', title: 'Rozszerzenie OSA pozwala wyświetlić ekran Selly wewnątrz panelu (w ramce), bez przełączania kart. Wymaga zalogowania do Selly w tej samej przeglądarce.' }, 'Zainstaluj rozszerzenie OSA, aby otwierać ten ekran w panelu')));
      root.replaceChildren(box);
    },
    unmount() { cleanup(); box = null; },
  };
}
