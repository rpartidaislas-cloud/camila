import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONSULTA_ERRORES_24H, resumirErrores } from '../scripts/client-error-digest.mjs';

test('sin errores: no hay alerta', () => {
  const r = resumirErrores([]);
  assert.equal(r.alerta, false);
  assert.equal(r.total, 0);
  assert.match(r.texto, /Sin errores/);
});

test('con errores: resume por grupo, recorta textos largos y alerta', () => {
  const r = resumirErrores([
    { kind: 'error', message: 'x'.repeat(400), source: 'https://app.smyldesign.ai/smyl-finance.js?v=10', line: 22, n: 5, usuarios: 2, clinicas: 1, ultimo: '2026-11-08T10:00:00Z', ruta: 'caja' },
    { kind: 'promise', message: 'fallo de red', source: '', line: 0, n: 1, usuarios: 1, clinicas: 1, ultimo: '2026-11-08T09:00:00Z', ruta: '' },
  ]);
  assert.equal(r.alerta, true);
  assert.equal(r.total, 6);
  assert.equal(r.grupos, 2);
  assert.match(r.texto, /6 en 2 grupo/);
  assert.match(r.texto, /smyl-finance\.js\?v=10:22/);
  assert.match(r.texto, /pantalla: caja/);
  assert.ok(r.texto.split('\n')[1].length < 330);
});

test('el umbral evita alertar por un único error cuando se configura más alto', () => {
  const g = [{ kind: 'error', message: 'a', n: 1, usuarios: 1, clinicas: 1 }];
  assert.equal(resumirErrores(g, 1).alerta, true);
  assert.equal(resumirErrores(g, 3).alerta, false);
  assert.equal(resumirErrores(g, 'basura').alerta, true);
});

test('la consulta sólo lee las últimas 24 h y no trae datos de pacientes ni la pila', () => {
  assert.match(CONSULTA_ERRORES_24H, /interval '24 hours'/);
  assert.doesNotMatch(CONSULTA_ERRORES_24H, /\bstack\b|user_agent|paciente/i);
  assert.match(CONSULTA_ERRORES_24H, /limit 20/);
});

test('el workflow es de solo lectura, programado a diario y con umbral configurable', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/smyl-alertas-errores-cliente.yml', import.meta.url), 'utf8');
  assert.match(wf, /schedule:\s*\n\s*- cron: "0 14 \* \* \*"/);
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /ALERTA_ERRORES_MINIMO/);
  assert.match(wf, /ALERTA_WEBHOOK_URL/);
  assert.doesNotMatch(wf, /insert into|delete from|drop |alter table|migration repair/i);
});
