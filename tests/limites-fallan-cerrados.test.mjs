import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ts = fs.readFileSync(new URL('../supabase/functions/_shared/limits.ts', import.meta.url), 'utf8');

// Ejecuta la función REAL ipDelRequest (quitando los tipos de TypeScript) para comprobar de qué cabecera sale la IP.
const src = ts.match(/export function ipDelRequest\(req: Request\): string \{[\s\S]*?\n\}\n/)[0].replace('(req: Request): string', '(req)').replace('export ', '');
const ipDelRequest = new Function(src + '\nreturn ipDelRequest;')();
const req = (headers) => ({ headers: new Headers(headers) });

test('la IP del tope sale de la cabecera de Cloudflare y no de una que el cliente pueda escribir', () => {
  assert.equal(ipDelRequest(req({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })), '203.0.113.9');
  assert.equal(ipDelRequest(req({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.2.3.4' })), '198.51.100.7');
  assert.equal(ipDelRequest(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })), '1.2.3.4');
  assert.equal(ipDelRequest(req({})), 'sin-ip');
  assert.equal(ipDelRequest(req({ 'cf-connecting-ip': '  ' , 'x-forwarded-for': '9.9.9.9' })), '9.9.9.9');
});

test('si no se puede verificar un límite se rechaza (503); ya no hay rutas de error que dejen pasar', () => {
  assert.match(ts, /function limiteNoVerificable\(cors: Record<string, string>\): LimitResult/);
  assert.match(ts, /limitDeny\(cors, 503, 'No pudimos verificar tu límite de uso/);
  for (const marca of ['error verificando tenant', 'error RPC camila_consumir_diagnostico', 'error RPC camila_anon_rate_check']) {
    const i = ts.indexOf(marca);
    assert.ok(i > 0, marca);
    const bloque = ts.slice(i, i + 200);
    assert.match(bloque, /return limiteNoVerificable\(cors\)/, marca);
    assert.doesNotMatch(bloque, /allowed: true/, marca);
  }
});

test('el mensaje de «no verificable» no revela detalles internos', () => {
  const m = ts.match(/No pudimos verificar tu límite de uso[^']*/)[0];
  assert.doesNotMatch(m, /rpc|camila_|error:|supabase/i);
});
