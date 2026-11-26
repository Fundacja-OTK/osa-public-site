// Przełącznik „Blokada zamówień” w karcie klienta: stan i zapis przez natywny ekran `klient-blokada` (sesja Selly zalogowanego użytkownika;
// formularz klienta w Selly, zmieniane tylko pole blokada_zamawiania). Zapis: podgląd zmian (dryRun) → potwierdzenie → zapis → weryfikacja.
// Gdy odczyt się nie uda (brak uprawnień, serwer niedostępny) zostaje zwykły link do karty w Selly.
import { el, sellyLink, flash } from '../core/ui.js?v=a9a0d42';
import { confirmDialog } from '../core/confirm.js?v=a9a0d42';
import { sellyCall } from './sellyNative.js?v=a9a0d42';

const SCREEN = 'klient-blokada', FIELD = 'blokada_zamawiania';
const isOn = v => v !== '' && v != null && v !== '0';

function modal(title, body, okLabel, onOk) {
  return confirmDialog({ id: 'cliBlockConfirm', title, body, confirmLabel: okLabel, focus: 'cancel', onConfirm: ({ close }) => onOk(close) }).close;
}

/** host: element do wypełnienia; fallbackLink: link do karty w Selly (zostaje, gdy odczyt się nie uda). */
export async function mountBlockToggle(host, id, fallbackLink) {
  host.replaceChildren(fallbackLink());
  const r = await sellyCall({ op: 'read', screen: SCREEN, view: 'record', id });
  const f = r && r.ok && r.data && r.data.canSave ? r.data.fields.find(x => x.name === FIELD && x.editable) : null;
  if (!f) return;
  paint(host, id, isOn(f.value) ? f.onValue || '1' : '', fallbackLink, f.onValue || '1');
}

function paint(host, id, cur, fallbackLink, onValue) {
  const blocked = cur !== '';
  const btn = el('button', { type: 'button', id: 'cliBlockBtn', class: blocked ? 'secondary' : 'danger',
    title: blocked ? 'Zdejmuje blokadę — klient znów będzie mógł składać zamówienia (zapis w Selly na Twojej sesji, po potwierdzeniu)'
      : 'Klient nie będzie mógł składać nowych zamówień w sklepie (zapis w Selly na Twojej sesji, po potwierdzeniu)',
    onclick: () => change(host, id, cur, blocked ? '' : onValue, fallbackLink, onValue) }, blocked ? 'Odblokuj zamówienia' : 'Zablokuj zamówienia');
  host.replaceChildren(
    el('span', { id: 'cliBlockState', class: 'tip' + (blocked ? ' error' : ''), title: 'Pole „Zablokowane składanie zamówień przez klienta” z karty klienta w Selly' }, blocked ? 'Zamówienia: zablokowane' : 'Zamówienia: dozwolone'),
    ' ', btn, ' ', fallbackLink());
}

async function change(host, id, cur, next, fallbackLink, onValue) {
  const changes = { [FIELD]: next }, expect = { [FIELD]: cur };
  const pre = await sellyCall({ op: 'save', screen: SCREEN, id, changes, expect, dryRun: true });
  if (!pre || !pre.ok) { flash('', (pre && pre.error) || 'Nie udało się przygotować zapisu'); return; }
  if (!pre.data.diff.length) { flash('', 'Bez zmian — wartość jest już taka w Selly'); return; }
  const body = el('div', null, el('p', null, 'Do Selly zostanie zapisane:'),
    el('p', null, el('strong', null, next ? 'Zablokowane składanie zamówień przez klienta: TAK' : 'Zablokowane składanie zamówień przez klienta: NIE')),
    pre.data.warn ? el('p', { class: 'muted' }, pre.data.warn) : null);
  modal(next ? 'Zablokować zamówienia klienta?' : 'Odblokować zamówienia klienta?', body, 'Zapisz w Selly', async close => {
    const r = await sellyCall({ op: 'save', screen: SCREEN, id, changes, expect });
    close();
    if (!r || !r.ok) { flash('', (r && r.code === 'conflict' ? '' : 'Zapis nie powiódł się: ') + ((r && r.error) || 'błąd')); return; }
    flash('', r.data.verified ? 'Zapisano w Selly i sprawdzono' : 'Selly przyjęło zapis, ale nie potwierdziło pola — sprawdź kartę w Selly');
    paint(host, id, r.data.verified ? next : cur, fallbackLink, onValue);
  });
}
