import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const src = fs.readFileSync(new URL('../supabase/functions/_shared/ai-quota.ts', import.meta.url), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(src)).toString('base64'));
const index = fs.readFileSync(new URL('../supabase/functions/claude/index.ts', import.meta.url), 'utf8');
const env = (o) => ({ get: (k) => o[k] });

test('topes por omisión y por variable de entorno', () => {
  assert.deepEqual(mod.leerTopesRadiografia(env({})), { diario: 60, mensual: 600 });
  assert.deepEqual(mod.leerTopesRadiografia(env({ RADIOGRAPH_DAILY_LIMIT: '10', RADIOGRAPH_MONTHLY_LIMIT: '100' })), { diario: 10, mensual: 100 });
  assert.deepEqual(mod.leerTopesRadiografia(env({ RADIOGRAPH_DAILY_LIMIT: 'abc', RADIOGRAPH_MONTHLY_LIMIT: '-5' })), { diario: 60, mensual: 600 });
});

test('evaluarTope bloquea al llegar al tope diario o mensual', () => {
  const t = { diario: 5, mensual: 50 };
  assert.equal(mod.evaluarTope(4, 49, t).permitido, true);
  assert.deepEqual([mod.evaluarTope(5, 10, t).permitido, mod.evaluarTope(5, 10, t).periodo], [false, 'diario']);
  assert.deepEqual([mod.evaluarTope(1, 50, t).permitido, mod.evaluarTope(1, 50, t).periodo], [false, 'mensual']);
});

test('inicios de día y mes en UTC', () => {
  const d = new Date('2026-11-06T15:30:00Z');
  assert.equal(mod.inicioDiaUTC(d), '2026-11-06T00:00:00.000Z');
  assert.equal(mod.inicioMesUTC(d), '2026-11-01T00:00:00.000Z');
});

test('claude verifica el tope antes de llamar a Anthropic y falla cerrado', () => {
  const i = index.indexOf('evaluarTope(usoDiario');
  assert.ok(i > 0 && i < index.indexOf('api.anthropic.com/v1/messages'));
  assert.match(index, /status: 429/);
  assert.match(index, /No pudimos verificar el límite de uso[\s\S]*?status: 503/);
});

test('el cliente muestra el mensaje de tope de IA en lugar de "servicio ocupado"', () => {
  const c = fs.readFileSync(new URL('../smyl-radiograph-analysis-client.js', import.meta.url), 'utf8');
  assert.match(c, /ai_quota_exceeded/);
});
