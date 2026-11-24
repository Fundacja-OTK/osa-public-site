// Pole daty i zakres dat (dołączane do core/ui.js przez re-eksport).
// dateInput({ id, value, label, title, min, max, onChange }) → element z właściwością .value (RRRR-MM-DD lub ''), jak zwykłe pole.
// Wpisujesz „dd.mm.rrrr” (albo RRRR-MM-DD) lub wybierasz z kalendarza (pon. pierwszy; klawiatura: strzałki, PgUp/PgDn, Home/End, Enter, Esc).
// Zmiana użytkownika wywołuje zdarzenia input i change na elemencie; ustawienie .value z kodu jest ciche (jak w natywnym polu).
// Na telefonie (≤ 640 px) zwraca natywne <input type=date> — systemowy wybór daty jest tam wygodniejszy.
import { el, menuButton } from './ui.js?v=64a1b3e';

const MONTHS_PL = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const DAYS_PL = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const pad2 = n => String(n).padStart(2, '0');
export const isoDate = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const localToday = () => isoDate(new Date());
const parseIso = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; const d = new Date(+m[1], +m[2] - 1, +m[3]); return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null; };
export const isoToPl = s => { const d = parseIso(s); return d ? pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() : ''; };
/** „dd.mm.rrrr” / RRRR-MM-DD → RRRR-MM-DD; '' dla pustego; null dla niepoprawnego. */
export function plToIso(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  let m = /^(\d{1,2})[.\-/ ](\d{1,2})[.\-/ ](\d{4})$/.exec(t);
  if (m) { const d = parseIso(m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1])); return d ? isoDate(d) : null; }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) { const d = parseIso(m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3])); return d ? isoDate(d) : null; }
  return null;
}
const isPhone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
/** Zmiana wartości „jak od użytkownika” (ze zdarzeniami) — dla presetów i przycisków. */
export function setDateValue(ctl, v) { ctl.value = v || ''; ctl.dispatchEvent(new Event('input', { bubbles: true })); ctl.dispatchEvent(new Event('change', { bubbles: true })); }

export function dateInput({ id, value, label, title, min, max, onChange, required } = {}) {
  if (isPhone()) {
    const n = el('input', { type: 'date', id, class: 'dp-native', 'aria-label': label, title, min, max, value: value || '' });
    if (onChange) n.addEventListener('change', () => onChange(n.value));
    return n;
  }
  const txt = el('input', { type: 'text', class: 'dp-in', id, inputmode: 'numeric', autocomplete: 'off', placeholder: 'dd.mm.rrrr', 'aria-label': label, 'aria-haspopup': 'dialog', maxlength: 10 });
  const calBtn = el('button', { type: 'button', class: 'dp-btn', tabindex: '-1', title: 'Otwórz kalendarz', 'aria-label': (label || 'Data') + ': otwórz kalendarz' }, '▦');
  const clrBtn = el('button', { type: 'button', class: 'dp-clear', tabindex: '-1', title: 'Wyczyść datę', 'aria-label': (label || 'Data') + ': wyczyść', hidden: true }, '×');
  const wrap = el('span', { class: 'dp', title: title || null }, txt, clrBtn, calBtn);
  let val = '', pop = null, view = null, focusDay = null;
  const inRange = iso => (!min || iso >= min) && (!max || iso <= max);
  const paint = () => { txt.value = isoToPl(val); clrBtn.hidden = !val || !!required; wrap.classList.toggle('has-value', !!val); };
  const commit = (iso, fire = true) => {
    if (iso && !inRange(iso)) iso = val;
    const changed = iso !== val; val = iso; paint();
    if (changed && fire) { wrap.dispatchEvent(new Event('input', { bubbles: true })); wrap.dispatchEvent(new Event('change', { bubbles: true })); if (onChange) onChange(val); }
  };
  Object.defineProperty(wrap, 'value', { get: () => val, set: v => { val = parseIso(v) ? String(v) : ''; paint(); } });
  Object.defineProperty(wrap, 'disabled', { get: () => txt.disabled, set: b => { txt.disabled = calBtn.disabled = clrBtn.disabled = !!b; } });
  for (const t of ['input', 'change']) txt.addEventListener(t, ev => ev.stopPropagation());   // zdarzenia pola tekstowego nie wychodzą na zewnątrz — emitujemy własne
  const commitText = () => { const iso = plToIso(txt.value); if (iso === null) paint(); else commit(iso); };
  txt.addEventListener('blur', commitText);
  txt.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); commitText(); if (pop) close(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'F4') { ev.preventDefault(); open(); }
    else if (ev.key === 'Escape' && pop) { ev.stopPropagation(); close(true); }
  });
  clrBtn.addEventListener('click', () => { commit(''); close(); txt.focus(); });
  calBtn.addEventListener('click', () => { if (pop) close(true); else open(); });

  const onDoc = ev => { if (pop && !pop.contains(ev.target) && !wrap.contains(ev.target)) close(false); };
  const onScroll = ev => { if (pop && !pop.contains(ev.target)) place(); };
  function close(refocus) {
    if (!pop) return;
    pop.remove(); pop = null;
    document.removeEventListener('mousedown', onDoc, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('scroll', onScroll, true);
    txt.setAttribute('aria-expanded', 'false');
    if (refocus) txt.focus();
  }
  function place() {
    if (!pop) return;
    if (!wrap.isConnected) { close(false); return; }
    const r = wrap.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const left = Math.min(Math.max(8, r.left), vw - pw - 8);
    let top = r.bottom + 6;
    if (top + ph > vh - 8 && r.top - ph - 6 > 8) top = r.top - ph - 6;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function open() {
    if (txt.disabled || pop) return;
    const base = parseIso(val) || new Date();
    view = new Date(base.getFullYear(), base.getMonth(), 1);
    focusDay = isoDate(base);
    pop = el('div', { class: 'dp-pop', role: 'dialog', 'aria-label': 'Kalendarz' });
    render();
    document.body.append(pop);
    place();
    document.addEventListener('mousedown', onDoc, true);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', onScroll, true);
    txt.setAttribute('aria-expanded', 'true');
    const f = pop.querySelector('.dp-day[tabindex="0"]'); if (f) f.focus();
  }
  const shift = months => { view = new Date(view.getFullYear(), view.getMonth() + months, 1); };
  function render() {
    const hadFocus = pop.contains(document.activeElement);
    const y = view.getFullYear(), m = view.getMonth(), todayIso = localToday();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate();
    const fd = parseIso(focusDay), focusIso = fd && fd.getFullYear() === y && fd.getMonth() === m ? focusDay : isoDate(new Date(y, m, 1));
    const nav = (t, ttl, fn) => el('button', { type: 'button', class: 'dp-nav', title: ttl, 'aria-label': ttl, onclick: () => { fn(); render(); } }, t);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(el('span', { class: 'dp-pad', 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d++) {
      const iso = y + '-' + pad2(m + 1) + '-' + pad2(d);
      cells.push(el('button', { type: 'button', class: 'dp-day' + (iso === val ? ' sel' : '') + (iso === todayIso ? ' today' : '') + ((lead + d - 1) % 7 >= 5 ? ' wknd' : ''),
        'data-iso': iso, tabindex: iso === focusIso ? '0' : '-1', disabled: !inRange(iso), 'aria-pressed': iso === val ? 'true' : 'false',
        'aria-label': d + ' ' + MONTHS_PL[m] + ' ' + y + (iso === todayIso ? ' (dziś)' : ''), onclick: () => { commit(iso); close(true); } }, String(d)));
    }
    pop.replaceChildren(
      el('div', { class: 'dp-head' }, nav('«', 'Poprzedni rok', () => shift(-12)), nav('‹', 'Poprzedni miesiąc', () => shift(-1)),
        el('strong', { class: 'dp-title', 'aria-live': 'polite' }, MONTHS_PL[m] + ' ' + y), nav('›', 'Następny miesiąc', () => shift(1)), nav('»', 'Następny rok', () => shift(12))),
      el('div', { class: 'dp-grid dp-dow', 'aria-hidden': 'true' }, DAYS_PL.map(d => el('span', {}, d))),
      el('div', { class: 'dp-grid', role: 'grid' }, cells),
      el('div', { class: 'dp-foot' },
        el('button', { type: 'button', class: 'ghost small', title: 'Wybierz dzisiejszą datę', onclick: () => { if (inRange(todayIso)) { commit(todayIso); close(true); } } }, 'Dziś'),
        required ? null : el('button', { type: 'button', class: 'ghost small', title: 'Usuń wybraną datę', onclick: () => { commit(''); close(true); } }, 'Wyczyść')));
    pop.onkeydown = ev => {
      const k = ev.key;
      if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); return; }
      if (k === 'Tab') {
        const f = [...pop.querySelectorAll('button:not(:disabled):not([tabindex="-1"])')]; if (!f.length) return;
        ev.preventDefault(); f[(f.indexOf(document.activeElement) + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus(); return;
      }
      const cur = ev.target.dataset && ev.target.dataset.iso; if (!cur) return;
      const d = parseIso(cur), wd = (d.getDay() + 6) % 7, Y = d.getFullYear(), M = d.getMonth(), D = d.getDate(); let nd = null;
      if (k === 'ArrowLeft') nd = new Date(Y, M, D - 1);
      else if (k === 'ArrowRight') nd = new Date(Y, M, D + 1);
      else if (k === 'ArrowUp') nd = new Date(Y, M, D - 7);
      else if (k === 'ArrowDown') nd = new Date(Y, M, D + 7);
      else if (k === 'Home') nd = new Date(Y, M, D - wd);
      else if (k === 'End') nd = new Date(Y, M, D + (6 - wd));
      else if (k === 'PageUp') nd = new Date(Y, M - (ev.shiftKey ? 12 : 1), D);
      else if (k === 'PageDown') nd = new Date(Y, M + (ev.shiftKey ? 12 : 1), D);
      if (!nd) return;
      ev.preventDefault();
      focusDay = isoDate(nd); view = new Date(nd.getFullYear(), nd.getMonth(), 1); render();
      const t = pop.querySelector('.dp-day[data-iso="' + focusDay + '"]'); if (t) t.focus();
    };
    if (hadFocus && !pop.contains(document.activeElement)) { const f = pop.querySelector('.dp-day[tabindex="0"]'); if (f) f.focus(); }
    place();
  }
  if (value) wrap.value = value;
  return wrap;
}

/** Zakres dat „od–do” z gotowymi zakresami. Zwraca { node, from, to, menu } — from/to to dateInput (z .value). */
export function dateRange({ idFrom, idTo, from, to, onChange, labelFrom = 'Od dnia', labelTo = 'Do dnia', titleFrom, titleTo } = {}) {
  const f = dateInput({ id: idFrom, value: from, label: labelFrom, title: titleFrom });
  const t = dateInput({ id: idTo, value: to, label: labelTo, title: titleTo });
  const fire = () => { if (onChange) onChange({ from: f.value, to: t.value }); };
  const set = (a, b) => { f.value = a; t.value = b; fire(); };
  const day = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return d; };
  const nowM = (dm, d) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth() + dm, d); };
  const presets = [
    ['Dziś', 'Tylko dzisiejszy dzień', () => [day(), day()]],
    ['Wczoraj', 'Tylko wczorajszy dzień', () => [day(-1), day(-1)]],
    ['Ostatnie 7 dni', 'Od 6 dni temu do dziś (łącznie 7 dni)', () => [day(-6), day()]],
    ['Ostatnie 30 dni', 'Od 29 dni temu do dziś (łącznie 30 dni)', () => [day(-29), day()]],
    ['Ten miesiąc', 'Od pierwszego dnia bieżącego miesiąca do dziś', () => [nowM(0, 1), day()]],
    ['Poprzedni miesiąc', 'Cały poprzedni miesiąc kalendarzowy', () => [nowM(-1, 1), nowM(0, 0)]],
    ['Ten rok', 'Od 1 stycznia bieżącego roku do dziś', () => [new Date(new Date().getFullYear(), 0, 1), day()]],
  ];
  const menu = menuButton({ id: idFrom ? idFrom + 'Presets' : undefined, label: 'Zakres', cls: 'secondary small', title: 'Gotowe zakresy dat: dziś, wczoraj, ostatnie dni, miesiące, rok',
    items: () => [...presets.map(([label, title, fn]) => ({ label, title, run: () => { const [a, b] = fn(); set(isoDate(a), isoDate(b)); } })),
      { label: 'Wyczyść daty', title: 'Usuń obie daty — bez ograniczenia zakresu', run: () => set('', '') }] });
  const node = el('div', { class: 'dp-range' }, el('label', { class: 'field-inline' }, labelFrom, f), el('label', { class: 'field-inline' }, labelTo, t), menu);
  f.addEventListener('change', fire); t.addEventListener('change', fire);
  return { node, from: f, to: t, menu };
}
