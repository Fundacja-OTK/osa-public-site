// Wspólny ekran „strona ustawień” Selly (etap 2, docs/selly-embed.md → „Tryb strona ustawień”): sekcje z polami formularza Selly,
// edycja tylko pól dozwolonych (allowlista w extension/lib/sellyNative.js), podgląd zmian (było → będzie) i potwierdzenie przed zapisem.
// Pola poufne (hasła, klucze, SMTP…) Worker maskuje po stronie serwera — tu widać tylko „••• (ustawione)” / „(puste)”, bez edycji.
// Użycie: createSettings({ id, title, screen, a, intro? }) → moduł panelu (mount / unmount), tak jak createNative.
import { el, loadingBox } from '../core/ui.js?v=866aaea';
import { sellyCall } from './sellyNative.js?v=866aaea';
import { sellyUrl } from './_placeholder.js?v=866aaea';

/** cfg: { id, title, screen (klucz w SCREENS), a (trasa strony w Selly), intro? (krótki opis ekranu) } */
export function createSettings(cfg) {
  let root = null, seq = 0, open = {};
  const sellyLink = (label, tip) => el('a', { href: sellyUrl('', '?a=' + cfg.a), target: '_blank', rel: 'noopener', class: 'btn-link', id: 'cfgSelly', title: tip || 'Otwiera ten sam ekran w panelu Selly, w nowej karcie' }, label);

  function mount(host) { root = host; open = {}; load(); }
  function unmount() { seq++; root = null; }

  const toolbar = (sub, extra, canSave) => el('div', { class: 'page-toolbar' }, el('div', { class: 'pt-title' }, el('h2', null, cfg.title), sub ? el('div', { class: 'sub' }, sub) : null),
    el('div', { class: 'pt-actions' }, extra, sellyLink(canSave === false ? 'Zmień w Selly ↗' : 'Otwórz w Selly ↗',
      canSave === false ? 'Tego ekranu nie zmieniasz z panelu OSA — otwiera go w panelu Selly, w nowej karcie' : null)));

  function errorBox(r) {
    const title = r.code === 'login' ? 'Selly nie otworzyło tego ekranu' : r.code === 'forbidden' ? 'Brak dostępu' : 'Nie udało się pobrać danych z Selly';
    return el('div', { class: 'card nat-err', id: 'cfgErr' }, el('p', null, el('strong', null, title)), el('p', { class: 'muted' }, r.error || 'Nieznany błąd'),
      el('div', { class: 'nat-actions' }, sellyLink('Otwórz w Selly ↗'), el('button', { type: 'button', class: 'secondary', onclick: load, title: 'Pobiera dane z Selly ponownie' }, 'Odśwież')));
  }

  async function load(message) {
    const my = ++seq;
    root.replaceChildren(toolbar(''), loadingBox('Pobieram ustawienia z Selly…'));
    const r = await sellyCall({ op: 'read', screen: cfg.screen, view: 'settings' });
    if (my !== seq || !root) return;
    if (!r.ok) { root.replaceChildren(toolbar('', null), errorBox(r)); return; }
    paint(r.data, message);
  }

  const shownValue = f => f.type === 'secret' ? f.value
    : f.type === 'select' || f.type === 'radio' ? (((f.options || []).find(o => o.value === f.value) || {}).text || f.value)
    : f.type === 'checkbox' ? (f.value ? 'włączone' : 'wyłączone') : f.value;

  function control(f) {
    const id = 'cfgF_' + f.name.replace(/[^\w]/g, '_'), common = { 'data-field': f.name, id, title: f.help || f.label };
    if (f.type === 'select') return el('select', common, f.options.map(o => el('option', { value: o.value, selected: o.value === f.value || null }, o.text)));
    if (f.type === 'radio') return el('div', { class: 'cfg-radios', role: 'radiogroup', 'aria-label': f.label }, f.options.map(o => el('label', { class: 'nat-check' },
      el('input', { type: 'radio', name: 'cfgR_' + f.name, value: o.value, 'data-field': f.name, checked: o.value === f.value || null }), ' ' + o.text)));
    if (f.type === 'checkbox') return el('label', { class: 'nat-check' }, el('input', { type: 'checkbox', 'data-field': f.name, 'data-on': f.onValue, id, checked: f.checked || null }), ' ' + (f.checked ? 'włączone' : 'wyłączone'));
    if (f.type === 'textarea') return el('textarea', { ...common, rows: 3 }, f.value);
    return el('input', { ...common, type: 'text', value: f.value });
  }

  function row(f) {
    const lbl = el('span', { class: 'cfg-lbl' + (f.help ? ' tip' : ''), title: f.help || (f.editable ? 'Możesz zmienić to ustawienie z panelu OSA' : f.secret ? 'Dane poufne — panel ich nie pokazuje i nie zmienia' : 'Tylko do podglądu — zmiana w Selly') }, f.label);
    const body = f.editable ? control(f)
      : el('span', { class: 'cfg-val' + (f.secret ? ' cfg-secret' : ''), title: f.secret ? 'Wartość ukryta z powodów bezpieczeństwa' : 'Tylko do podglądu' }, shownValue(f) || '—');
    return el('div', { class: 'cfg-row' + (f.editable ? ' cfg-edit' : ''), 'data-name': f.name }, lbl, body);
  }

  function paint(d, message) {
    const orig = {};
    for (const s of d.sections) for (const f of s.fields) if (f.editable) orig[f.name] = f.value;
    const collect = () => {
      const ch = {};
      for (const i of root.querySelectorAll('[data-field]')) {
        const n = i.dataset.field;
        if (i.type === 'radio') { if (i.checked && i.value !== orig[n]) ch[n] = i.value; continue; }
        const v = i.type === 'checkbox' ? (i.checked ? i.dataset.on : '') : i.value;
        if (v !== orig[n]) ch[n] = v;
      }
      return ch;
    };
    const tip0 = 'Najpierw zmień któreś z ustawień — przed zapisem pokażemy dokładnie, co się zmieni';
    const save = el('button', { type: 'button', class: 'primary', id: 'cfgSave', disabled: true, title: tip0 }, 'Zapisz w Selly…');
    const sync = () => { const n = Object.keys(collect()).length; save.disabled = !n; save.title = n ? 'Pokaże podsumowanie zmian do potwierdzenia, potem zapisze w Selly' : tip0; };
    save.addEventListener('click', () => confirmSave(collect(), orig));
    const many = d.sections.length > 1;
    const secs = d.sections.map((s, i) => {
      const ne = s.fields.filter(f => f.editable).length;
      const det = el('details', { class: 'cfg-sec card', 'data-sec': s.title, open: (open[s.title] != null ? open[s.title] : (!many || i === 0 || ne > 0)) || null },
        el('summary', { title: 'Rozwija / zwija sekcję „' + s.title + '”' }, el('span', { class: 'cfg-sec-t' }, s.title),
          el('span', { class: 'muted cfg-sec-n', title: ne ? 'Liczba ustawień, które możesz zmienić z panelu OSA' : 'Wszystkie ustawienia w tej sekcji są tylko do podglądu' },
            s.fields.length + ' · ' + (ne ? ne + ' do edycji' : 'podgląd'))),
        el('div', { class: 'cfg-rows' }, s.fields.map(row)));
      det.addEventListener('toggle', () => { open[s.title] = det.open; });
      return det;
    });
    const info = !d.canSave ? el('div', { class: 'card cfg-note', id: 'cfgReadonly' }, el('p', { class: 'muted' }, (d.note ? d.note + ' ' : '') + 'Ten ekran jest tylko do podglądu — wartości poufne są ukryte.'),
      el('p', null, sellyLink('Zmień w Selly ↗', 'Tego ekranu nie zmieniasz z panelu OSA — otwiera go w panelu Selly, w nowej karcie'))) : (d.note ? el('p', { class: 'muted cfg-intro' }, d.note) : null);
    root.replaceChildren(
      toolbar(d.canSave ? 'Ustawienia na żywo z Selly — zmieniasz tylko oznaczone pola' : 'Podgląd ustawień z Selly',
        el('button', { type: 'button', class: 'secondary', id: 'cfgRefresh', title: 'Pobiera ustawienia z Selly ponownie', onclick: () => load() }, 'Odśwież'), d.canSave),
      message || null, cfg.intro ? el('p', { class: 'muted cfg-intro' }, cfg.intro) : null, info,
      d.missing ? el('div', { class: 'card nat-err', id: 'cfgNoForm' }, el('p', null, 'Formularz w Selly wygląda inaczej niż oczekiwano — ekran niedostępny. Użyj panelu Selly.')) : null,
      el('div', { id: 'cfgForm', oninput: sync, onchange: sync }, secs),
      d.canSave ? el('div', { class: 'nat-actions cfg-actions' }, save) : null);
  }

  function modal(title, body, okLabel, onOk) {
    const prev = document.activeElement;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    const cancel = el('button', { type: 'button', class: 'secondary', id: 'cfgConfirmCancel', onclick: close }, 'Anuluj');
    const ok = el('button', { type: 'button', class: 'primary', id: 'cfgConfirmOk', onclick: () => { ok.disabled = true; onOk(close); } }, okLabel);
    const wrap = el('div', { class: 'nat-modal', id: 'cfgConfirm' }, el('div', { class: 'nat-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, el('h3', null, title), body, el('div', { class: 'nat-actions nat-dlg-actions' }, cancel, ok)));
    document.addEventListener('keydown', onKey, true); document.body.append(wrap); cancel.focus();
  }

  const msg = (text, cls) => el('div', { class: 'card ' + (cls || ''), id: 'cfgMsg' }, text);

  async function confirmSave(changes, orig) {
    const expect = Object.fromEntries(Object.keys(changes).map(k => [k, orig[k]]));
    const pre = await sellyCall({ op: 'save', screen: cfg.screen, view: 'settings', changes, expect, dryRun: true });
    if (!pre.ok) { load(msg(pre.error || 'Nie udało się przygotować zapisu', 'nat-err')); return; }
    if (!pre.data.diff.length) { load(msg('Bez zmian — wartości są już takie w Selly.')); return; }
    const body = el('div', null, el('p', null, 'Do Selly zostanie zapisane:'),
      el('table', { id: 'cfgDiff' }, el('thead', null, el('tr', null, el('th', null, 'Ustawienie'), el('th', null, 'Było'), el('th', null, 'Będzie'))),
        el('tbody', null, pre.data.diff.map(x => el('tr', null, el('td', null, x.label), el('td', { class: 'nat-before' }, x.beforeText || '—'), el('td', null, el('strong', null, x.afterText || '—')))))),
      pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null);
    modal('Zapisać zmiany w Selly?', body, 'Zapisz w Selly', async close => {
      const r = await sellyCall({ op: 'save', screen: cfg.screen, view: 'settings', changes, expect });
      close();
      if (!r.ok) { load(msg((r.code === 'conflict' ? '' : 'Zapis nie powiódł się: ') + (r.error || 'błąd'), 'nat-err')); return; }
      const v = r.data.verified;
      load(msg(v ? 'Zapisano w Selly i sprawdzono: wartości zgadzają się.' : 'Selly przyjęło zapis, ale nie potwierdziło wszystkich pól (' + r.data.mismatches.join(', ') + '). Sprawdź ekran w Selly.', v ? 'nat-ok' : 'nat-err'));
    });
  }

  return { id: cfg.id, title: cfg.title, routes: [], mount, unmount, native: true };
}
