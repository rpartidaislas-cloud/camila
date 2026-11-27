// Pausa de emergencia: pausa a la IA en TODAS las conversaciones de la clínica que aún no están pausadas.
//
// Límite honesto: el contrato de LANA solo ofrece pausa POR conversación (POST /inbox/conversations/:id/pause), no un
// interruptor global. Esto cubre las conversaciones que existen en este momento; una conversación NUEVA que llegue
// después no queda pausada hasta que se vuelva a ejecutar. El resultado lo dice con números verificables.
//
// Módulo puro (sin Deno ni red) para poder probarlo con simuladores.

export const DEFAULT_LIMITS = Object.freeze({ maxConversations: 500, pageSize: 100, concurrency: 5, budgetMs: 45000 });

/**
 * @param {object} io
 * @param {(offset:number, take:number)=>Promise<{conversations:Array<{id:string,paused?:boolean}>, hasMore:boolean}>} io.fetchPage
 * @param {(id:string)=>Promise<boolean>} io.pause   true si LANA aceptó la pausa
 * @param {()=>number} [io.now]
 * @param {Partial<typeof DEFAULT_LIMITS>} [limits]
 */
export async function pauseAllConversations(io, limits = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  const now = io.now || Date.now;
  const started = now();
  const seen = new Set();
  const toPause = [];
  let scanned = 0, alreadyPaused = 0, offset = 0, hasMore = true, truncated = false, listError = '';

  while (hasMore) {
    if (scanned >= cfg.maxConversations) { truncated = true; break; }
    if (now() - started > cfg.budgetMs) { truncated = true; break; }
    let page;
    try { page = await io.fetchPage(offset, cfg.pageSize); }
    catch (error) { listError = error instanceof Error ? error.message : 'No se pudo consultar la bandeja.'; truncated = true; break; }
    const rows = Array.isArray(page && page.conversations) ? page.conversations : [];
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || seen.has(row.id)) continue;
      seen.add(row.id); scanned += 1;
      if (row.paused === true) alreadyPaused += 1; else toPause.push(row.id);
    }
    offset += rows.length;
    hasMore = Boolean(page && page.hasMore) && rows.length > 0;
  }

  let paused = 0; const failedIds = [];
  let cursor = 0;
  async function worker() {
    while (cursor < toPause.length) {
      const id = toPause[cursor++];
      if (now() - started > cfg.budgetMs * 2) { failedIds.push(id); continue; }
      let ok = false;
      try { ok = (await io.pause(id)) === true; } catch { ok = false; }
      if (ok) paused += 1; else failedIds.push(id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cfg.concurrency, toPause.length) }, worker));

  const failed = failedIds.length;
  return {
    scanned, paused, already_paused: alreadyPaused, failed,
    failed_ids: failedIds.slice(0, 20),
    truncated, list_error: listError,
    // «Completa» solo si se vio toda la bandeja y nada falló: es lo único que permite decir «todas están pausadas».
    complete: !truncated && failed === 0 && !listError,
  };
}
