// „Zgłoś uwagę / błąd”: okno z typem, opisem i opcjonalnymi informacjami technicznymi (trasa, wersja, przeglądarka,
// ostatnie błędy — bez danych ze ekranów). Dostarczanie dwiema ścieżkami (delivery.js): A = Worker (D1 + mail),
// B = Apps Script (mail + arkusz). Gdy obie zawiodą: „Kopiuj treść” i link mailto.
import { el } from './ui.js?v=13a6ef5';
import { deliver } from './delivery.js?v=13a6ef5';

export const FB_TYPES = [
  { v: 'blad', label: 'Błąd', tip: 'Coś nie działa albo działa inaczej, niż powinno' },
  { v: 'pomysl', label: 'Pomysł', tip: 'Propozycja zmiany lub nowej funkcji' },
  { v: 'pytanie', label: 'Pytanie', tip: 'Nie wiem, jak coś zrobić albo co oznacza' },
];

/** Krótki opis przeglądarki bez pełnego User-Agenta. */
export function browserInfo(ua) {
  const m = /(Edg|Chrome|Firefox|Safari)\/(\d+)/.exec(ua || '');
  const os = /Windows/.test(ua || '') ? 'Windows' : /Android/.test(ua || '') ? 'Android' : /iPhone|iPad/.test(ua || '') ? 'iOS' : /Mac OS/.test(ua || '') ? 'macOS' : /Linux/.test(ua || '') ? 'Linux' : '';
  return ((m ? (m[1] === 'Edg' ? 'Edge' : m[1]) + ' ' + m[2] : 'przeglądarka') + (os ? ' / ' + os : '')).slice(0, 60);
}

/** Informacje techniczne do zgłoszenia — tylko te pola, nic z danych ekranów. */
export function collectTech({ route, version, ua, backend, errors }) {
  return { route: String(route || '').split('?')[0], version: String(version || ''), browser: browserInfo(ua), backend: backend || '', errors: (errors || []).slice(-20) };
}

/** Wysyła zgłoszenie (ścieżka A → B) i zwraca wynik z gotowym komunikatem dla użytkownika. */
export async function sendFeedback({ config, getToken, fetchImpl, type, text, tech }) {
  const res = await deliver({ config, getToken, fetchImpl, action: 'feedback:send', params: { type, text, tech: tech || undefined } });
  if (res.ok && res.path === 'A') {
    return { ok: true, path: 'A', message: res.data && res.data.mailed
      ? 'Wysłano. Zgłoszenie zapisane w panelu, e-mail do administratora wysłany.'
      : 'Wysłano. Zgłoszenie zapisane w panelu; e-mail do administratora ponowimy automatycznie w ciągu kilkunastu minut.' };
  }
  if (res.ok) {
    return { ok: true, path: 'B', message: 'Wysłano zapasową drogą (przez Apps Script): ' + (res.data && res.data.mailed ? 'e-mail do administratora wysłany' : 'e-mail nie wyszedł') +
      (res.data && res.data.stored ? ', zgłoszenie zapisane w arkuszu „Zgłoszenia”' : '') + '. Główny serwer chwilowo nie odpowiada' + (res.errorA ? ' (' + res.errorA + ')' : '') + '.' };
  }
  const why = res.fatal || [res.errors.A && 'serwer główny: ' + res.errors.A, res.errors.B && 'serwer zapasowy: ' + res.errors.B].filter(Boolean).join('; ') || 'nieznany błąd';
  return { ok: false, retryable: !res.code || res.code >= 500 || res.code === 403, message: 'Nie udało się wysłać zgłoszenia (' + why + ').' };
}

/** Treść do skopiowania / wiadomości mailto, gdy żadna ścieżka nie zadziałała. */
export function plainText({ type, text, tech }) {
  const t = FB_TYPES.find(x => x.v === type);
  const lines = ['Panel OSA — zgłoszenie: ' + (t ? t.label : type), '', text];
  if (tech) {
    lines.push('', '— informacje techniczne —', 'Trasa: ' + tech.route, 'Wersja: ' + tech.version, 'Przeglądarka: ' + tech.browser);
    if (tech.errors && tech.errors.length) lines.push('Ostatnie błędy:', ...tech.errors.map(e => ' • ' + e.message + (e.count > 1 ? ' (×' + e.count + ')' : '')));
  }
  return lines.join('\n');
}

export const mailtoHref = (to, subject, body) => 'mailto:' + (to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(String(body).slice(0, 1500));

// ─── Okno ───────────────────────────────────────────────────────────────────

/**
 * @param {{ button: HTMLElement, config, getToken, getRoute: ()=>string, getBackend: ()=>string, getErrors: ()=>object[], fetchImpl? }} o
 */
export function initFeedback(o) {
  let overlay = null, draft = { type: 'blad', text: '', withTech: true };

  function close() { if (overlay) { overlay.remove(); overlay = null; } document.removeEventListener('keydown', onKey); o.button.focus(); }
  const onKey = e => { if (e.key === 'Escape') close(); };

  function open() {
    if (overlay) return;
    const tech = () => collectTech({ route: o.getRoute(), version: o.config.version, ua: navigator.userAgent, backend: o.getBackend(), errors: o.getErrors() });
    const type = el('select', { id: 'fbType', 'aria-label': 'Rodzaj zgłoszenia', title: 'Co zgłaszasz?' }, FB_TYPES.map(t => el('option', { value: t.v, title: t.tip }, t.label)));
    type.value = draft.type;
    const text = el('textarea', { id: 'fbText', rows: '6', maxlength: '4000', 'aria-label': 'Opis zgłoszenia', placeholder: 'Opisz, co się stało, czego brakuje albo o co chcesz zapytać. Nie wpisuj haseł.' });
    text.value = draft.text;
    const withTech = el('input', { type: 'checkbox', id: 'fbTech' });
    withTech.checked = draft.withTech;
    const preview = el('pre', { class: 'fb-preview', id: 'fbPreview' });
    const showPreview = () => { preview.textContent = withTech.checked ? plainText({ type: type.value, text: '(tu Twój opis)', tech: tech() }).split('\n').slice(3).join('\n') : ''; };
    withTech.addEventListener('change', showPreview);
    const status = el('div', { role: 'status', id: 'fbStatus', class: 'fb-status' });
    const actions = el('div', { class: 'ord-actions' });
    const body = el('div', { class: 'fb-body' });

    const send = el('button', { type: 'button', class: 'primary', id: 'fbSend', title: 'Wysyła zgłoszenie do administratora panelu', onclick: async () => {
      const t = text.value.trim();
      if (t.length < 3) { status.replaceChildren(el('div', { class: 'notice error' }, 'Opisz krótko, czego dotyczy zgłoszenie.')); text.focus(); return; }
      draft = { type: type.value, text: text.value, withTech: withTech.checked };
      send.disabled = true; status.replaceChildren(el('div', { class: 'notice' }, 'Wysyłam…'));
      const techInfo = withTech.checked ? tech() : null;
      const r = await sendFeedback({ config: o.config, getToken: o.getToken, fetchImpl: o.fetchImpl, type: type.value, text: t, tech: techInfo });
      if (r.ok) { draft = { type: 'blad', text: '', withTech: draft.withTech }; done(r); return; }
      send.disabled = false;
      const plain = plainText({ type: type.value, text: t, tech: techInfo });
      status.replaceChildren(el('div', { class: 'notice error', id: 'fbFail' }, r.message + ' Możesz skopiować treść i wysłać ją sam.'),
        el('div', { class: 'ord-actions' },
          el('button', { type: 'button', class: 'secondary', id: 'fbCopy', title: 'Kopiuje treść zgłoszenia do schowka', onclick: () => { try { navigator.clipboard.writeText(plain); } catch (e) { /* bez schowka */ } } }, 'Kopiuj treść'),
          el('a', { class: 'btn-link', id: 'fbMailto', href: mailtoHref(o.config.ownerEmail, 'Panel OSA — zgłoszenie', plain), title: 'Otwiera program pocztowy z gotową wiadomością' }, 'Napisz e-mail')));
    } }, 'Wyślij');

    function done(r) {
      body.replaceChildren(el('div', { class: 'notice ok', id: 'fbDone' }, r.message, el('span', { class: 'fb-path', id: 'fbPath', title: r.path === 'A' ? 'Serwer główny (Cloudflare)' : 'Serwer zapasowy (Apps Script)' }, r.path === 'A' ? 'ścieżka A' : 'ścieżka B (zapasowa)')));
      actions.replaceChildren(el('button', { type: 'button', class: 'primary', id: 'fbClose', onclick: close }, 'Zamknij'));
    }

    body.append(
      el('label', { class: 'field-inline', title: 'Co zgłaszasz?' }, 'Rodzaj', type),
      text,
      el('label', { class: 'fb-check tip', title: 'Dołącza: adres strony w panelu (bez parametrów), wersję panelu, nazwę przeglądarki i komunikaty ostatnich błędów. Nie dołącza żadnych danych z ekranów (zamówień, klientów).' }, withTech, ' Dołącz informacje techniczne'),
      el('details', { class: 'fb-details' }, el('summary', { title: 'Dokładnie to zostanie dołączone do zgłoszenia' }, 'Co zostanie dołączone?'), preview),
      status);
    actions.append(send, el('button', { type: 'button', class: 'secondary', id: 'fbCancel', onclick: close }, 'Anuluj'));
    showPreview();
    overlay = el('div', { class: 'fb-overlay', id: 'fbOverlay', onclick: e => { if (e.target === overlay) close(); } },
      el('div', { class: 'card fb-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Zgłoś uwagę lub błąd' },
        el('h3', null, 'Zgłoś uwagę lub błąd'), body, actions));
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    text.focus();
  }

  o.button.addEventListener('click', open);
  return { open, close };
}
