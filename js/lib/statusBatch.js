// Zmiana statusu wielu zamówień w Selly porcjami (orders:setStatus: Worker, a gdy nie działa — Apps Script; ta sama logika shared/failover.js).
// Wspólne dla „Zamówień” (zmiana masowa) i kreatora SpeedMail. Bez DOM — testowane w Node (tests/unit/sharedAndFrontend.test.js).

/** Domyślna porcja = MAX_STATUS_BATCH backendu (orders:meta → maxStatusBatch); serwer i tak odrzuci większą. */
export const STATUS_BATCH = 20;

/**
 * ids: id zamówień; apiFn(action, params) → Promise. Porcje po `batch`, kolejno (bez równoległych zapisów — oszczędza limit Selly).
 * Zamówienie bez potwierdzenia w odpowiedzi = nieudane (nie zgadujemy). onProgress(zrobione, wszystkie) po każdej porcji.
 * → { done: [id], failed: [{ id, error }] }
 */
export async function setStatusInChunks(apiFn, ids, statusId, { batch = STATUS_BATCH, onProgress } = {}) {
  const list = [...new Set((ids || []).map(String).filter(Boolean))];
  const size = Math.max(1, Number(batch) || STATUS_BATCH);
  const done = [], failed = [];
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size);
    try {
      const r = (await apiFn('orders:setStatus', { ids: chunk, statusId: String(statusId) })) || {};
      const ok = new Set((r.done || []).map(String));
      const bad = new Map((r.failed || []).map(f => [String(f.id), f.error || 'błąd']));
      for (const id of chunk) {
        if (ok.has(id)) done.push(id);
        else failed.push({ id, error: bad.get(id) || 'brak potwierdzenia z serwera' });
      }
    } catch (e) { for (const id of chunk) failed.push({ id, error: (e && e.message) || 'błąd połączenia' }); }
    if (onProgress) onProgress(done.length + failed.length, list.length);
  }
  return { done, failed };
}
