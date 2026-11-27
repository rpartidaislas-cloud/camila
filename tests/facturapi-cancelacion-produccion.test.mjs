import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { puedeCancelarEnProduccion, CONFIRM_LIVE_CANCEL_TEXT } from '../supabase/functions/_shared/facturapi-core.mjs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('en sandbox no se pide nada extra para cancelar', () => {
  assert.equal(puedeCancelarEnProduccion({ live: false }).ok, true);
  assert.equal(puedeCancelarEnProduccion({ live: false, enabled: false, confirmText: '' }).ok, true);
});

test('en producción exige el interruptor del servidor y el texto exacto', () => {
  assert.match(puedeCancelarEnProduccion({ live: true, enabled: false, confirmText: CONFIRM_LIVE_CANCEL_TEXT }).error, /no está habilitada/);
  assert.match(puedeCancelarEnProduccion({ live: true, enabled: true, confirmText: '' }).error, /CANCELAR EN PRODUCCION/);
  assert.match(puedeCancelarEnProduccion({ live: true, enabled: true, confirmText: 'cancelar' }).error, /CANCELAR EN PRODUCCION/);
  assert.equal(puedeCancelarEnProduccion({ live: true, enabled: true, confirmText: '  cancelar en produccion ' }).ok, true);
});

test('la función aplica la compuerta antes de enviar, apagada por defecto, y audita si fue en vivo', () => {
  const fn = read('supabase/functions/facturapi/index.ts');
  assert.match(fn, /LIVE_CANCELLATION = Deno\.env\.get\("FACTURAPI_LIVE_CANCELLATION"\) === "1"/);
  const gate = fn.indexOf('puedeCancelarEnProduccion({ live');
  const send = fn.indexOf('method: "DELETE"');
  assert.ok(gate > 0 && send > gate, 'la compuerta va antes del DELETE a Facturapi');
  assert.doesNotMatch(fn, /todavía solo está disponible en pruebas/);
  assert.match(fn, /motive: plan\.reason_code, live \}/);
});

test('la pantalla pide escribir la confirmación y la manda al servidor solo en producción', () => {
  const js = read('smyl-finance.js');
  assert.match(js, /name="confirm_text"/);
  assert.match(js, /action:'cancel',draft_id:draft\.id,confirm_text:typed/);
  assert.match(js, /live_cancellation!==true/);
});
