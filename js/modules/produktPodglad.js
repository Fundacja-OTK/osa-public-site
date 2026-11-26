// Okno „podgląd zmian przed zapisem” dla karty produktu, wariantów i ustawień magazynów (było → będzie, potwierdzenie).
// Jedno okno naraz; Esc / „Wróć do edycji” zamyka bez zapisu. Opcjonalnie wymaga wpisania tekstu (np. ID przy usuwaniu).
import { el } from '../core/ui.js?v=63d59bb';
import { confirmDialog } from '../core/confirm.js?v=63d59bb';

const short = (v, max = 120) => { const s = v == null || v === '' ? '—' : String(v); return s.length > max ? s.slice(0, max - 1) + '…' : s; };

/**
 * o: { id, title, intro?, rows: [{ label, before, after }], note?, okLabel, danger?, write?, confirmText?, confirmLabel?, onOk: async (close, fail) => {} }
 * fail(msg) pokazuje błąd w oknie i odblokowuje przycisk (okno zostaje otwarte).
 */
export function previewModal(o) {
  const rows = o.rows || [];
  const table = rows.length ? el('div', { class: 'table-wrap pk-diff-wrap' }, el('table', { class: 'pk-diff', id: o.id + 'Diff' },
    el('thead', null, el('tr', null, el('th', null, el('span', { title: 'Zmieniane pole' }, 'Pole')), el('th', null, el('span', { title: 'Wartość zapisana teraz w Selly' }, 'Było')), el('th', null, el('span', { title: 'Wartość po zapisie' }, 'Będzie')))),
    el('tbody', null, rows.map(r => el('tr', null, el('td', null, r.label), el('td', { class: 'pk-before' }, short(r.before)), el('td', null, el('strong', null, short(r.after)))))))) : null;
  return confirmDialog({ id: o.id, title: o.title, confirmLabel: o.okLabel, cancelLabel: 'Wróć do edycji', danger: o.danger, write: o.write,
    typed: o.confirmText ? { text: o.confirmText, label: o.confirmLabel || 'Potwierdzenie' } : null,
    body: el('div', null, o.intro ? el('p', null, o.intro) : null, table, o.note ? el('p', { class: 'muted small' }, o.note) : null),
    onConfirm: ({ close, fail }) => o.onOk(close, fail) });
}

/** Wartość do pokazania w podglądzie: tak/nie, tekst z listy wyboru, długość opisu HTML. */
export function shownValue(kind, v, input) {
  if (kind === 'check' || kind === 'meta-check') return v ? 'tak' : 'nie';
  if (kind === 'select' && input && input.options) { const o = [...input.options].find(x => x.value === String(v)); return o && v !== '' ? o.textContent : '—'; }
  if (kind === 'html') return v ? String(v).length + ' znaków HTML' : '(pusto)';
  return v;
}
