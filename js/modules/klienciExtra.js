// Klienci — sekcje karty ładowane na żądanie (adresy dodatkowe, ceny indywidualne, program partnerski, subkonta, rozwiązania „tylko w Selly”)
// (ekran „Grupy klientów”, zmiana grupy i limit zamówień: klienciGrupy.js). Sekcje pobierają dane dopiero po rozwinięciu (oszczędność limitu Selly).
import { el, flash, loadingBox, sellyLink, field, money, fullName, debounce } from '../core/ui.js?v=6d8ea70';
import { api } from '../core/client.js?v=6d8ea70';
import { nipError, postcodeError } from './klienciForm.js?v=6d8ea70';

const errBox = (host, e) => host.replaceChildren(el('div', { class: 'notice error' }, (e && e.message) || 'Nie udało się pobrać danych.'));

/** Sekcja zwijana, której treść ładuje się przy pierwszym rozwinięciu: load(body, reload). */
export function lazyFold(id, title, sub, load) {
  const body = el('div', { class: 'kf-fold-body' });
  const d = el('details', { class: 'card fold', id }, el('summary', { title: sub }, el('h2', null, title), el('span', { class: 'muted small' }, sub)), body);
  let done = false;
  const reload = async () => { body.replaceChildren(loadingBox('Pobieram…')); try { await load(body, reload); } catch (e) { errBox(body, e); } };
  d.addEventListener('toggle', () => { if (d.open && !done) { done = true; reload(); } });
  return d;
}

const TYPES = { DELIVERY: 'dostawy', INVOICE: 'faktury', RECIPIENT: 'odbiorcy' };
const addrId = a => a.id != null ? a.id : (a.address_id != null ? a.address_id : a.additional_address_id);

// ─── Adresy dodatkowe ───────────────────────────────────────────────────────

export function addressesFold(id, sellyUrl) {
  return lazyFold('cliAddrFold', 'Adresy dodatkowe', 'Dodatkowe adresy dostawy, faktury i odbiorcy klienta', async (body, reload) => {
    const r = await api('clients:addresses', { id });
    const rows = (r && r.rows) || [];
    const formHost = el('div');
    const openForm = a => {
      const x = a || { type: 'DELIVERY' }, inp = (k, label, tip) => field(label, el('input', { type: 'text', id: 'cliAd_' + k, value: x[k] || '', maxlength: '200', autocomplete: 'off' }), tip);
      const type = el('select', { id: 'cliAd_type' }, Object.entries(TYPES).map(([v, t]) => el('option', { value: v, selected: v === (x.type || 'DELIVERY') }, 'adres ' + t)));
      const msg = el('div', { role: 'alert' });
      const save = el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'cliAdSave', onclick: async () => {
        const g = k => document.getElementById('cliAd_' + k).value.trim();
        const addr = { type: type.value, firstname: g('firstname'), lastname: g('lastname'), company: g('company'), address: g('address'), postcode: g('postcode'), city: g('city'), nip: g('nip') };
        const bad = !addr.firstname ? 'Podaj imię.' : !addr.lastname ? 'Podaj nazwisko.' : !addr.address ? 'Podaj adres.' : !addr.city ? 'Podaj miejscowość.' : postcodeError(addr.postcode || '00-000', '') || (!addr.postcode ? 'Podaj kod pocztowy.' : '') || nipError(addr.nip, '');
        if (bad) { msg.replaceChildren(el('div', { class: 'notice error' }, bad)); return; }
        save.disabled = true;
        try { await api('clients:addressSave', { id, addressId: a ? addrId(a) : undefined, address: addr }); flash('', 'Adres zapisany w Selly'); reload(); }
        catch (e) { save.disabled = false; msg.replaceChildren(el('div', { class: 'notice error' }, e.message || 'Nie udało się zapisać.')); }
      } }, a ? 'Zapisz adres' : 'Dodaj adres');
      formHost.replaceChildren(el('div', { class: 'opts-box kf-inline' }, el('div', { class: 'kf-grid' }, field('Rodzaj', type, 'Do czego służy adres: dostawa, faktura albo odbiorca'),
        inp('firstname', 'Imię'), inp('lastname', 'Nazwisko'), inp('company', 'Firma'), inp('address', 'Adres'), inp('postcode', 'Kod pocztowy'), inp('city', 'Miejscowość'), inp('nip', 'NIP', 'Tylko dla adresu faktury')),
        msg, el('div', { class: 'ord-actions' }, save, el('button', { type: 'button', class: 'secondary', onclick: () => formHost.replaceChildren() }, 'Anuluj'))));
    };
    const table = rows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'cliAddrTable' }, el('thead', null, el('tr', null,
      ['Rodzaj', 'Firma', 'Imię i nazwisko', 'Adres', 'Kod', 'Miasto', 'NIP', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(a => el('tr', null, el('td', null, TYPES[a.type] || a.type || ''), el('td', null, a.company || ''), el('td', null, fullName(a.firstname, a.lastname)), el('td', null, a.address || ''),
        el('td', { class: 'nw' }, a.postcode || ''), el('td', null, a.city || ''), el('td', { class: 'nw' }, a.nip || ''),
        el('td', { class: 'nw' }, addrId(a) == null ? el('span', { class: 'muted small', title: 'Selly nie podało numeru adresu — edytuj w panelu Selly' }, '—') : [
          el('button', { type: 'button', class: 'ghost', write: 'klienci', title: 'Edytuj ten adres', onclick: () => openForm(a) }, 'Edytuj'), ' ',
          el('button', { type: 'button', class: 'ghost', write: 'klienci', title: 'Usuń ten adres z konta klienta', onclick: async () => {
            if (!confirm('Usunąć ten adres klienta?')) return;
            try { await api('clients:addressDelete', { id, addressId: addrId(a) }); flash('', 'Adres usunięty'); reload(); } catch (e) { flash('', e.message || 'Nie udało się usunąć'); }
          } }, 'Usuń')]))))))
      : el('div', { class: 'empty' }, 'Klient nie ma dodatkowych adresów.');
    body.replaceChildren(table, el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', write: 'klienci', id: 'cliAddrAdd', onclick: () => openForm(null) }, 'Dodaj adres'),
      sellyLink('Adresy w Selly ↗', sellyUrl + '?a=klienci.addresses&id=' + encodeURIComponent(id), 'Otwiera adresy klienta w panelu Selly')), formHost);
  });
}

// ─── Ceny indywidualne ──────────────────────────────────────────────────────

export function pricesFold(id, sellyUrl) {
  return lazyFold('cliPriceFold', 'Ceny indywidualne produktów', 'Cena tego klienta zamiast ceny katalogowej', async (body, reload) => {
    const r = await api('clients:prices', { id });
    const rows = (r && r.rows) || [];
    const msg = el('div', { role: 'alert' });
    const savePrice = async (productId, price, exists) => {
      try { await api('clients:priceSave', { id, productId, price, exists }); flash('', 'Cena zapisana w Selly'); reload(); }
      catch (e) { msg.replaceChildren(el('div', { class: 'notice error' }, e.message || 'Nie udało się zapisać.')); }
    };
    const table = rows.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'cliPriceTable' }, el('thead', null, el('tr', null,
      el('th', null, el('span', { title: 'Produkt z kopii katalogu panelu' }, 'Produkt')), el('th', { class: 'n' }, el('span', { title: 'Zwykła cena produktu w Selly' }, 'Cena katalogowa')),
      el('th', { class: 'n' }, el('span', { title: 'Cena, którą widzi i płaci ten klient' }, 'Cena klienta')), el('th', null, ''))),
      el('tbody', null, rows.map(p => {
        const inp = el('input', { type: 'text', class: 'inl', inputmode: 'decimal', value: String(p.price == null ? '' : p.price).replace('.', ','), 'aria-label': 'Cena klienta: ' + (p.name || p.productId), 'data-pid': p.productId });
        return el('tr', null, el('td', null, p.name || ('Produkt ' + p.productId), el('div', { class: 'cell-sub' }, (p.code ? p.code + ' · ' : '') + 'ID ' + p.productId)),
          el('td', { class: 'n nw' }, p.catalogPrice == null ? '—' : money(p.catalogPrice)), el('td', { class: 'n nw' }, inp),
          el('td', { class: 'nw' }, el('button', { type: 'button', class: 'secondary', write: 'klienci', title: 'Zapisz zmienioną cenę w Selly', onclick: () => savePrice(p.productId, inp.value, true) }, 'Zapisz'), ' ',
            el('button', { type: 'button', class: 'ghost', write: 'klienci', title: 'Usuń cenę indywidualną — klient wróci do ceny katalogowej', onclick: async () => {
              if (!confirm('Usunąć cenę indywidualną tego produktu?')) return;
              try { await api('clients:priceDelete', { id, productId: p.productId }); flash('', 'Cena usunięta'); reload(); } catch (e) { flash('', e.message || 'Nie udało się usunąć'); }
            } }, 'Usuń')));
      }))))
      : el('div', { class: 'empty' }, 'Klient nie ma cen indywidualnych — płaci ceny katalogowe.');

    // dodawanie: wyszukiwarka produktów z kopii katalogu
    const q = el('input', { type: 'search', id: 'cliPriceSearch', placeholder: 'Szukaj produktu: nazwa, kod, EAN', 'aria-label': 'Szukaj produktu do ceny indywidualnej', autocomplete: 'off' });
    const hits = el('div', { class: 'kf-hits' });
    const price = el('input', { type: 'text', id: 'cliPriceNew', inputmode: 'decimal', placeholder: '0,00', 'aria-label': 'Cena klienta' });
    let chosen = null;
    const chosenBox = el('div', { class: 'muted small', id: 'cliPriceChosen' }, 'Wybierz produkt z listy.');
    const add = el('button', { type: 'button', class: 'primary', write: 'klienci', id: 'cliPriceAdd', disabled: true, onclick: async () => {
      add.disabled = true; await savePrice(chosen.id, price.value, rows.some(x => String(x.productId) === String(chosen.id))); add.disabled = false;
    } }, 'Dodaj cenę');
    const search = debounce(async () => {
      const v = q.value.trim();
      if (v.length < 2) { hits.replaceChildren(); return; }
      try {
        const res = await api('products:list', { q: v, pageSize: 10 });
        hits.replaceChildren(...((res && res.rows) || []).map(p => el('button', { type: 'button', class: 'kf-hit', onclick: () => {
          chosen = p; chosenBox.textContent = 'Wybrano: ' + p.name + ' (' + (p.code || 'ID ' + p.id) + '), cena katalogowa ' + money(p.price); hits.replaceChildren(); add.disabled = false; price.focus();
        } }, p.name, el('span', { class: 'muted small' }, ' ' + (p.code || '') + ' · ' + money(p.price)))));
      } catch (e) { hits.replaceChildren(); }
    }, 300);
    q.addEventListener('input', search);
    body.replaceChildren(table, msg, el('div', { class: 'opts-box kf-inline' }, el('strong', null, 'Dodaj lub zmień cenę produktu'), el('div', { class: 'kf-grid' }, field('Produkt', q, 'Wpisz co najmniej 2 znaki'), field('Cena klienta', price, 'Kwota w złotych, np. 12,50')),
      hits, chosenBox, el('div', { class: 'ord-actions' }, add)),
      el('div', { class: 'muted small' }, 'Kwota ma ten sam charakter (netto/brutto) co cena produktu w Selly. ', sellyLink('Ceny klienta w Selly ↗', sellyUrl + '?a=klienci.produktyCeny&id=' + encodeURIComponent(id), 'Otwiera ceny indywidualne klienta w panelu Selly (z kolumną VAT)')));
  });
}

// ─── Program partnerski ─────────────────────────────────────────────────────

export function affiliateFold(id) {
  return lazyFold('cliAffFold', 'Program partnerski', 'Poziom, polecający, prowizje klienta', async (body, reload) => {
    const r = await api('clients:affiliate', { id });
    const a = r && r.affiliate;
    if (!a) { body.replaceChildren(el('div', { class: 'empty' }, 'Klient nie uczestniczy w programie partnerskim (albo program jest wyłączony w sklepie).')); return; }
    const num = v => (v == null ? '0' : String(v));
    const comm = a.commissions || [];
    const msg = el('div', { role: 'alert' });
    const order = el('input', { type: 'text', id: 'cliAffOrder', inputmode: 'numeric', placeholder: 'np. 1234', 'aria-label': 'ID zamówienia' });
    const amount = el('input', { type: 'text', id: 'cliAffAmount', inputmode: 'decimal', placeholder: '0,00', 'aria-label': 'Kwota prowizji' });
    body.replaceChildren(
      el('dl', { class: 'ord-dl' }, [['Numer partnera', a.partner_id], ['Poziom', a.level], ['Zarobiono', money(a.earned)], ['Do wypłaty', num(a.pending_payout)], ['Wypłacono', num(a.completed)],
        ['Polecone osoby (poziomy 1–5)', [1, 2, 3, 4, 5].map(i => num(a['referrals_count_' + i])).join(' / ')]].flatMap(([k, v]) => [el('dt', null, k), el('dd', null, v == null ? '—' : String(v))])),
      comm.length ? el('div', { class: 'table-wrap' }, el('table', { id: 'cliAffTable' }, el('thead', null, el('tr', null, ['Data', 'Zamówienie (ID)', 'Poziom', 'Prowizja', ''].map(h => el('th', null, h)))),
        el('tbody', null, comm.map(x => el('tr', null, el('td', { class: 'nw' }, String(x.created_at || '').slice(0, 10)), el('td', null, String(x.order_id || '')), el('td', null, String(x.level || '')), el('td', { class: 'n' }, money(x.commission)),
          el('td', null, x.commission_id == null ? '' : el('button', { type: 'button', class: 'ghost', write: 'klienci', onclick: async () => {
            if (!confirm('Usunąć tę prowizję?')) return;
            try { await api('clients:affiliateDelete', { id, commissionId: x.commission_id }); flash('', 'Prowizja usunięta'); reload(); } catch (e) { flash('', e.message || 'Nie udało się usunąć'); }
          } }, 'Usuń'))))))) : el('p', { class: 'muted' }, 'Brak prowizji.'),
      el('details', { class: 'fold-inline' }, el('summary', { title: 'Zaawansowane: ręczne dodanie prowizji (doładowanie) klientowi' }, 'Dodaj prowizję ręcznie'),
        el('div', { class: 'kf-grid' }, field('Zamówienie (ID)', order, 'ID zamówienia w Selly, którego dotyczy prowizja'), field('Kwota prowizji', amount, 'Kwota w złotych, większa od zera')), msg,
        el('div', { class: 'ord-actions' }, el('button', { type: 'button', class: 'secondary', write: 'klienci', id: 'cliAffAdd', onclick: async () => {
          try { await api('clients:affiliateAdd', { id, orderId: order.value.trim(), commission: amount.value }); flash('', 'Prowizja dodana'); reload(); }
          catch (e) { msg.replaceChildren(el('div', { class: 'notice error' }, e.message || 'Nie udało się dodać.')); }
        } }, 'Dodaj prowizję'))));
  });
}

// ─── Subkonta i konto główne (z kopii, bez zapytań do Selly) ────────────────

export function relatedBlock(x, openClient) {
  const items = [];
  if (x && x.parent) items.push(el('p', null, 'Konto główne: ', el('a', { href: '#/klienci/' + encodeURIComponent(x.parent.id) }, x.parent.name || x.parent.email)));
  if (x && x.subaccounts && x.subaccounts.length) items.push(el('div', null, el('strong', null, 'Subkonta (' + x.subaccounts.length + '): '),
    el('ul', { class: 'kf-list' }, x.subaccounts.map(s => el('li', null, el('a', { href: '#/klienci/' + encodeURIComponent(s.id) }, s.name || s.email), el('span', { class: 'muted small' }, ' ' + (s.email || '')))))));
  return items.length ? el('div', { class: 'card', id: 'cliRelated' }, el('div', { class: 'card-head' }, el('h2', null, 'Subkonta')), items) : null;
}

/** Rzeczy, których API Selly nie udostępnia — jasne linki do dokładnych ekranów Selly. */
export function sellyOnlyBlock(id, sellyUrl) {
  const u = a => sellyUrl + '?a=' + a + '&id=' + encodeURIComponent(id);
  const li = (a, text, tip) => el('li', null, sellyLink(text, u(a), tip));
  return el('details', { class: 'card fold', id: 'cliSellyOnly' }, el('summary', { title: 'Te funkcje są dostępne tylko w panelu Selly — API sklepu ich nie udostępnia' }, el('h2', null, 'Tylko w Selly'), el('span', { class: 'muted small' }, 'Rabaty wg producentów, blokowani producenci, faktury ERP, notatki i doładowania PP')),
    el('ul', { class: 'kf-list' },
      li('klienci.discounts', 'Edytuj w Selly ↗ — rabaty wg producentów', 'Rabat procentowy klienta osobno dla każdego producenta (brak w API)'),
      li('klienci.producenci', 'Edytuj w Selly ↗ — producenci blokowani dla klienta', 'Lista producentów, których produktów klient nie widzi (brak w API)'),
      li('klienci.erpInvoices', 'Otwórz w Selly ↗ — faktury ERP klienta', 'Faktury z systemu ERP przypisane klientowi (brak w API)'),
      li('klienci.notatki', 'Edytuj w Selly ↗ — historia notatek (data, status)', 'Wiele notatek ze statusem otwarte/zamknięte; panel edytuje główną notatkę klienta'),
      li('klienci.subkonta', 'Edytuj w Selly ↗ — subkonta', 'Zarządzanie subkontami w panelu Selly')));
}
