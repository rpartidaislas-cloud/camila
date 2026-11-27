import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseAllConversations } from '../supabase/functions/_shared/pause-all-core.mjs';

// Simulador de LANA: N conversaciones, algunas ya pausadas, con paginación y fallos configurables.
function lana({ total = 12, pausedIds = [], failIds = [], pageFails = false } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `c${i}`, paused: pausedIds.includes(`c${i}`) }));
  const calls = { pages: [], paused: [] };
  return {
    calls,
    io: {
      fetchPage: async (offset, take) => { calls.pages.push([offset, take]); if (pageFails) throw new Error('LANA no responde'); const slice = rows.slice(offset, offset + take); return { conversations: slice, hasMore: offset + take < rows.length }; },
      pause: async (id) => { calls.paused.push(id); return !failIds.includes(id); }
    }
  };
}

test('pausa solo las que no estaban pausadas y cuenta cada caso', async () => {
  const sim = lana({ total: 12, pausedIds: ['c1', 'c2'] });
  const result = await pauseAllConversations(sim.io, { pageSize: 5 });
  assert.equal(result.scanned, 12); assert.equal(result.paused, 10); assert.equal(result.already_paused, 2); assert.equal(result.failed, 0);
  assert.equal(result.complete, true);
  assert.deepEqual(sim.calls.pages, [[0, 5], [5, 5], [10, 5]], 'recorre toda la bandeja paginando');
  assert.ok(!sim.calls.paused.includes('c1') && !sim.calls.paused.includes('c2'), 'no vuelve a pausar las ya pausadas');
});

test('un fallo de LANA en una conversación no se oculta ni da por completa la pausa', async () => {
  const sim = lana({ total: 6, failIds: ['c3'] });
  const result = await pauseAllConversations(sim.io);
  assert.equal(result.paused, 5); assert.equal(result.failed, 1); assert.deepEqual(result.failed_ids, ['c3']);
  assert.equal(result.complete, false);
});

test('si no se puede consultar la bandeja, el resultado lo dice y no es completo', async () => {
  const result = await pauseAllConversations(lana({ pageFails: true }).io);
  assert.equal(result.complete, false); assert.equal(result.truncated, true); assert.match(result.list_error, /LANA no responde/); assert.equal(result.scanned, 0);
});

test('el tope de conversaciones marca el resultado como truncado: hay que repetir', async () => {
  const sim = lana({ total: 30 });
  const result = await pauseAllConversations(sim.io, { maxConversations: 10, pageSize: 5 });
  assert.equal(result.truncated, true); assert.equal(result.complete, false); assert.equal(result.scanned, 10); assert.equal(result.paused, 10);
});

test('el presupuesto de tiempo corta la revisión y lo informa', async () => {
  let t = 0; const sim = lana({ total: 50 });
  const result = await pauseAllConversations({ ...sim.io, now: () => (t += 20000) }, { pageSize: 5, budgetMs: 45000 });
  assert.equal(result.truncated, true); assert.equal(result.complete, false);
});

test('ignora duplicados y filas inválidas y respeta la concurrencia', async () => {
  let running = 0, peak = 0; const seen = [];
  const io = {
    fetchPage: async (offset) => ({ conversations: offset ? [] : [{ id: 'a' }, { id: 'a' }, null, { id: 5 }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }, { id: 'g' }], hasMore: false }),
    pause: async (id) => { running += 1; peak = Math.max(peak, running); seen.push(id); await new Promise((r) => setTimeout(r, 5)); running -= 1; return true; }
  };
  const result = await pauseAllConversations(io, { concurrency: 3 });
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(result.paused, 7); assert.ok(peak <= 3, `concurrencia ${peak}`);
});

test('una bandeja vacía es completa y no pausa nada', async () => {
  const result = await pauseAllConversations(lana({ total: 0 }).io);
  assert.deepEqual({ scanned: result.scanned, paused: result.paused, complete: result.complete }, { scanned: 0, paused: 0, complete: true });
});
