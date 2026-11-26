// Zamówienia → Kolumny ▾ → „Ustawienia listy…”: kolory komentarzy (własne tej przeglądarki albo — administrator — dla całego sklepu)
// i nazwy poziomów cen klientów (sklep, administrator). Zapis sklepu: orders:prefsSave (D1, tylko administrator — serwer sprawdza);
// odczyt: orders:meta → prefs. Kolory działają też w Wysyłce SpeedMail i karcie zamówienia (lib/orderCells.js).
import { el, store, flash } from '../core/ui.js?v=ad8c30d';
import { api, ctx } from '../core/client.js?v=ad8c30d';
import { COMMENT_TYPES, DEFAULT_COLORS, USER_COLORS_KEY, normColors, applyCommentColors, PRICE_LEVELS, commentNote, applyPrefs, shopPrefsNow } from '../lib/orderCells.js?v=ad8c30d';

/** Okno ustawień w `host`. o: { prefs() → bieżące ustawienia sklepu, onSaved(prefs) — po zapisie sklepu / zmianie własnych kolorów }. */
export function openPrefs(host, o) {
  const admin = !!(ctx.boot && ctx.boot.isAdmin);
  const shop = (o.prefs && o.prefs()) || shopPrefsNow() || {};
  const shopColors = normColors(shop.colors), userColors = normColors(store(USER_COLORS_KEY));
  const eff = { ...DEFAULT_COLORS, ...shopColors, ...userColors };
  const close = () => { host.replaceChildren(); applyPrefs(); };
  const inputs = {};
  const preview = el('div', { class: 'ord-info-cell', id: 'ordPrefsPreview' }, COMMENT_TYPES.map(t => commentNote(t.key, 'Przykładowa treść — tak wygląda ' + t.label.toLowerCase() + '.')));
  const live = () => applyCommentColors(Object.fromEntries(COMMENT_TYPES.map(t => [t.key, inputs[t.key].value])));
  const colorRows = COMMENT_TYPES.map(t => {
    inputs[t.key] = el('input', { type: 'color', id: 'ordPrefC_' + t.key, value: eff[t.key], 'aria-label': 'Kolor: ' + t.label, oninput: live });
    return el('label', { class: 'field-inline', title: t.tip }, el('span', null, t.icon + ' ' + t.label), inputs[t.key]);
  });
  const lvInputs = PRICE_LEVELS.map((d, i) => el('input', { type: 'text', id: 'ordPrefL' + i, maxlength: '60', value: (shop.levels && shop.levels[i]) || '', placeholder: d,
    disabled: !admin, 'aria-label': 'Nazwa poziomu cen ' + i, title: admin ? 'Puste = nazwa domyślna („' + d + '”)' : 'Nazwy poziomów cen zmienia administrator panelu' }));
  const msg = el('div', { role: 'status', class: 'muted small' });
  const colors = () => Object.fromEntries(COMMENT_TYPES.map(t => [t.key, inputs[t.key].value.toLowerCase()]));
  const saveMine = () => { store(USER_COLORS_KEY, colors()); applyPrefs(); if (o.onSaved) o.onSaved(null); host.replaceChildren(); flash('', 'Zapisano Twoje kolory komentarzy (ta przeglądarka)'); };
  const resetMine = () => { try { localStorage.removeItem(USER_COLORS_KEY); } catch (e) { /* bez pamięci */ } applyPrefs(); if (o.onSaved) o.onSaved(null); host.replaceChildren(); flash('', 'Przywrócono kolory sklepu'); };
  const saveShop = async () => {
    const levels = lvInputs.map(x => x.value.trim().slice(0, 60));
    try {
      const r = await api('orders:prefsSave', { colors: colors(), levels });
      applyPrefs(r && r.prefs); if (o.onSaved) o.onSaved(r && r.prefs); host.replaceChildren(); flash('', 'Zapisano ustawienia listy dla całego sklepu');
    } catch (e) { msg.textContent = 'Nie zapisano ustawień: ' + ((e && e.message) || 'błąd') + ' — spróbuj ponownie.'; msg.className = 'notice error'; }
  };
  const box = el('div', { class: 'card ord-dialog', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Ustawienia listy zamówień', id: 'ordPrefs' },
    el('h3', null, 'Ustawienia listy zamówień'),
    el('h4', { title: 'Każdy rodzaj komentarza ma własny kolor (pasek po lewej i lekkie tło), żeby się nie zlewały — na liście Zamówień, w Wysyłce SpeedMail i w karcie zamówienia' }, 'Kolory komentarzy'),
    el('div', { class: 'toolbar' }, colorRows), preview,
    el('p', { class: 'muted small' }, Object.keys(userColors).length ? 'Używasz własnych kolorów (tylko ta przeglądarka). ' : 'Używasz kolorów ' + (Object.keys(shopColors).length ? 'ustawionych dla sklepu. ' : 'domyślnych. '),
      Object.keys(userColors).length ? el('button', { type: 'button', class: 'link', id: 'ordPrefsReset', onclick: resetMine, title: 'Usuwa Twoje kolory z tej przeglądarki — wracają kolory sklepu' }, 'Przywróć kolory sklepu') : null),
    el('h4', { title: 'Nazwy poziomów cen klientów (kolumna „Poziom cen”) — wspólne dla sklepu' }, 'Nazwy poziomów cen'),
    el('div', { class: 'ord-pref-levels' }, lvInputs.map((x, i) => el('label', { class: 'field-inline' }, 'Poziom ' + i, x))),
    admin ? null : el('p', { class: 'muted small' }, 'Kolory dla całego sklepu i nazwy poziomów zmienia administrator panelu.'),
    msg,
    el('div', { class: 'ord-actions' },
      el('button', { type: 'button', class: 'secondary', id: 'ordPrefsCancel', onclick: close }, 'Anuluj'),
      el('span', { class: 'spacer' }),
      admin ? el('button', { type: 'button', class: 'secondary', id: 'ordPrefsShop', title: 'Kolory i nazwy poziomów dla wszystkich użytkowników panelu (osoby z własnymi kolorami nadal widzą swoje)', onclick: saveShop }, 'Zapisz dla całego sklepu') : null,
      el('button', { type: 'button', class: 'primary', id: 'ordPrefsMine', title: 'Kolory komentarzy tylko dla Ciebie, w tej przeglądarce', onclick: saveMine }, 'Zapisz kolory dla mnie')));
  host.replaceChildren(box);
  inputs.client.focus();
}
