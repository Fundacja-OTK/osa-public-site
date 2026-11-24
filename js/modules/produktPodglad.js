// Okno „podgląd zmian przed zapisem” dla karty produktu, wariantów i ustawień magazynów (było → będzie, potwierdzenie).
// Jedno okno naraz; Esc / „Wróć do edycji” zamyka bez zapisu. Opcjonalnie wymaga wpisania tekstu (np. ID przy usuwaniu).
import { el } from '../core/ui.js?v=28c8ac7';

const short = (v, max = 120) => { const s = v == null || v === '' ? '—' : String(v); return s.length > max ? s.slice(0, max - 1) + '…' : s; };

/**
 * o: { id, title, intro?, rows: [{ label, before, after }], note?, okLabel, danger?, write?, confirmText?, confirmLabel?, onOk: async (close, fail) => {} }
 * fail(msg) pokazuje błąd w oknie i odblokowuje przycisk (okno zostaje otwarte).
 */
export function previewModal(o) {
  const old = document.getElementById(o.id);
  if (old) old.remove();
  const err = el('div', { class: 'notice error', role: 'alert', hidden: true });
  const typed = o.confirmText ? el('input', { type: 'text', id: o.id + 'Typed', autocomplete: 'off', 'aria-label': o.confirmLabel || 'Potwierdzenie', inputmode: /^\d+$/.test(o.confirmText) ? 'numeric' : null }) : null;
  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); close(); } };
  const ok = el('button', { type: 'button', class: o.danger ? 'primary danger-fill' : 'primary', id: o.id + 'Ok', write: o.write || null, disabled: typed ? true : null,
    title: typed ? 'Wpisz potwierdzenie, aby odblokować' : null, onclick: async () => {
      ok.disabled = true; err.hidden = true; ok.textContent = 'Zapisuję…';
      const fail = m => { err.textContent = m; err.hidden = false; ok.disabled = false; ok.textContent = o.okLabel; };
      try { await o.onOk(close, fail); } catch (e) { fail(e && e.message ? e.message : 'Błąd zapisu.'); }
    } }, o.okLabel);
  if (typed) typed.addEventListener('input', () => { ok.disabled = typed.value.trim() !== o.confirmText; });
  const cancel = el('button', { type: 'button', class: 'secondary', id: o.id + 'Cancel', onclick: close }, 'Wróć do edycji');
  const rows = o.rows || [];
  const table = rows.length ? el('div', { class: 'table-wrap pk-diff-wrap' }, el('table', { class: 'pk-diff', id: o.id + 'Diff' },
    el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Zmieniane pole' }, 'Pole')), el('th', null, el('span', { title: 'Wartość zapisana teraz w Selly' }, 'Było')), el('th', null, el('span', { title: 'Wartość po zapisie' }, 'Będzie')))),
    el('tbody', null, rows.map(r => el('tr', null, el('td', null, r.label), el('td', { class: 'pk-before' }, short(r.before)), el('td', null, el('strong', null, short(r.after)))))))) : null;
  const dlg = el('div', { class: 'pk-dialog card', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    el('h3', null, o.title), o.intro ? el('p', null, o.intro) : null, table, o.note ? el('p', { class: 'muted small' }, o.note) : null,
    typed ? el('label', { class: 'pk-f' }, el('span', { class: 'pk-l' }, o.confirmLabel || 'Potwierdzenie'), typed) : null,
    err, el('div', { class: 'ord-actions pk-dlg-actions' }, cancel, ok));
  const wrap = el('div', { class: 'pk-modal', id: o.id, onclick: ev => { if (ev.target === wrap) close(); } }, dlg);
  document.addEventListener('keydown', onKey, true);
  document.body.append(wrap);
  (typed || ok).focus();
  return close;
}

/** Wartość do pokazania w podglądzie: tak/nie, tekst z listy wyboru, długość opisu HTML. */
export function shownValue(kind, v, input) {
  if (kind === 'check' || kind === 'meta-check') return v ? 'tak' : 'nie';
  if (kind === 'select' && input && input.options) { const o = [...input.options].find(x => x.value === String(v)); return o && v !== '' ? o.textContent : '—'; }
  if (kind === 'html') return v ? String(v).length + ' znaków HTML' : '(pusto)';
  return v;
}
