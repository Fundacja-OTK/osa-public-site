// Wspólne okno potwierdzenia (obietnica → true / false). Zastępuje window.confirm i własne kopie okien „podgląd przed zapisem”.
//   const ok = await confirmDialog({ title: 'Usunąć?', body: 'Tego nie można cofnąć.', confirmLabel: 'Usuń', danger: true });
// Dostępność: role=dialog (przy danger — alertdialog), aria-modal, aria-labelledby/-describedby, pułapka Tab, Esc = anuluj,
// kliknięcie tła = anuluj, fokus wraca do elementu, który otworzył okno. Treść wyłącznie przez el()/textContent.
import { el } from './ui.js?v=4562225';

let cur = null;   // { finish } — jedno okno naraz (nowe anuluje poprzednie)
let seq = 0;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tekst z akapitami: pusta linia = nowy akapit, pojedyncze \n = łamanie wiersza (white-space: pre-line w CSS). */
const paragraphs = text => String(text).split(/\n{2,}/).map(t => el('p', { class: 'cf-msg' }, t));

/**
 * o: { title, body?: Node|string, items?: (Node|string)[], confirmLabel?, cancelLabel?, danger?, id?, write?, focus?: 'ok'|'cancel',
 *      typed?: { text, label }   — okno zamyka się dopiero po wpisaniu tekstu (np. ID przy usuwaniu),
 *      onConfirm?: async ({ close, fail }) => {}   — praca przy otwartym oknie; wyjątek / fail(msg) = błąd w oknie, okno zostaje }
 * id: id okna; przyciski dostają id+'Ok' / id+'Cancel' (selektory testów). Zwraca Promise<boolean> z metodą close().
 */
export function confirmDialog(o) {
  if (cur) cur.finish(false);
  const id = o.id || 'osaConfirm';
  const old = document.getElementById(id);
  if (old) old.remove();
  const prev = document.activeElement;
  const uid = 'cf' + (++seq);
  let done = false, resolve;
  const result = new Promise(r => { resolve = r; });

  const finish = val => {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey, true);
    wrap.remove();
    if (cur && cur.finish === finish) cur = null;
    if (prev && prev.focus && document.contains(prev)) prev.focus();
    resolve(!!val);
  };

  const err = el('div', { class: 'notice error cf-err', role: 'alert', hidden: true });
  const typed = o.typed ? el('input', { type: 'text', id: id + 'Typed', autocomplete: 'off', 'aria-label': o.typed.label || 'Potwierdzenie',
    inputmode: /^\d+$/.test(o.typed.text) ? 'numeric' : null }) : null;
  const label = o.confirmLabel || 'Potwierdź';
  const cancel = el('button', { type: 'button', class: 'secondary', id: id + 'Cancel', onclick: () => finish(false) }, o.cancelLabel || 'Anuluj');
  const ok = el('button', { type: 'button', class: o.danger ? 'primary danger-fill' : 'primary', id: id + 'Ok', write: o.write || null,
    disabled: typed ? true : null, title: typed ? 'Wpisz potwierdzenie, aby odblokować' : null,
    onclick: async () => {
      if (!o.onConfirm) { finish(true); return; }
      ok.disabled = true; err.hidden = true; ok.textContent = 'Zapisuję…';
      let failed = false;
      const fail = m => { failed = true; err.textContent = m; err.hidden = false; ok.disabled = false; ok.textContent = label; };
      try { await o.onConfirm({ close: () => finish(true), fail }); } catch (e) { fail(e && e.message ? e.message : 'Błąd zapisu.'); }
      if (!failed) finish(true);
    } }, label);
  if (typed) typed.addEventListener('input', () => { ok.disabled = typed.value.trim() !== o.typed.text; });

  const body = typeof o.body === 'string' ? paragraphs(o.body) : o.body;
  const items = o.items && o.items.length ? el('ul', { class: 'cf-items' }, o.items.map(i => el('li', null, i))) : null;
  const dlg = el('div', { class: 'cf-dialog card' + (o.danger ? ' cf-danger' : ''), role: o.danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true',
    'aria-labelledby': uid + 't', 'aria-describedby': uid + 'b' },
    el('h3', { id: uid + 't' }, o.title || 'Potwierdzenie'),
    el('div', { class: 'cf-body', id: uid + 'b' }, body, items),
    typed ? el('label', { class: 'cf-typed' }, el('span', null, o.typed.label || 'Potwierdzenie'), typed) : null,
    err, el('div', { class: 'cf-actions' }, cancel, ok));
  const wrap = el('div', { class: 'cf-overlay', id, onclick: ev => { if (ev.target === wrap) finish(false); } }, dlg);

  const onKey = ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); finish(false); return; }
    if (ev.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll(FOCUSABLE)].filter(x => !x.hidden);
    if (!f.length) { ev.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1], a = document.activeElement;
    if (!dlg.contains(a)) { ev.preventDefault(); first.focus(); }
    else if (ev.shiftKey && a === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && a === last) { ev.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(wrap);
  cur = { finish };
  (typed || (o.danger || o.focus === 'cancel' ? cancel : ok)).focus();
  result.close = () => finish(false);
  return result;
}

/** Skrót dla dawnego window.confirm(tekst): ten sam tekst, okno zamiast natywnego. opts: title, confirmLabel, danger, id… */
export const askConfirm = (message, opts) => confirmDialog({ title: 'Potwierdź', body: message, ...opts });
