// Plan y suscripción: panel de consumo con barras (contrato del frontend; la conducta se probó en navegador).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const js = read('smyl-plan-usage.js');
const app = read('app.html');

test('lee solo funciones de lectura y no inventa cifras cuando falta un medidor', () => {
  assert.match(js, /rpc\('smyl_usage_overview', \{ p_period: 'current' \}\)/);
  assert.match(js, /rpc\('smyl_billing_summary'\)/);
  assert.doesNotMatch(js, /\.insert\(|\.update\(|\.delete\(|fetch\(/, 'solo lee');
  assert.match(js, /noMeter: true/, 'almacenamiento sin medidor muestra lo incluido');
  assert.match(js, /Sin medidor/, 'los timbres dicen que no hay medidor');
  assert.match(js, /Medidor en preparación/);
});

test('cada barra es accesible, usa texto y no solo color', () => {
  assert.match(js, /role="progressbar"/);
  assert.match(js, /aria-valuenow/);
  assert.match(js, /LEVEL_TEXT = \{ ok: 'Todo en orden', mid: 'Va avanzado', high: 'Casi al límite', full: 'Límite alcanzado'/);
});

test('todo texto del usuario pasa por esc() y no se usa almacenamiento del navegador', () => {
  assert.match(js, /function esc\(/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
  assert.match(js, /esc\(m\.label\)/);
  assert.match(js, /esc\(\(b\.card_brand \|\| 'Tarjeta'\)/);
});

test('app.html carga el módulo, tiene el contenedor y conserva el elemento que renderPlan() necesita', () => {
  assert.match(app, /<script defer src="smyl-plan-usage\.js\?v=2"><\/script>/);
  assert.match(app, /id="plan-usage-root"/);
  assert.match(app, /id="mc-uso-detalle" hidden/, 'renderPlan() escribe aquí: no debe faltar');
  assert.match(read('sw.js'), /\/camila\/smyl-plan-usage\.js\?v=2/);
});

test('textos mínimos de 12 px en el panel de consumo', () => {
  const block = app.slice(app.indexOf('/* Plan y suscripción: consumo del mes */'), app.indexOf('/* Planes y suscripción */'));
  assert.ok(block.length > 1500, 'no se encontró el bloque de estilos');
  for (const m of block.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 12, 'texto menor a 12 px: ' + m[0]);
});

test('web y móvil publican los mismos archivos', () => {
  for (const file of ['smyl-plan-usage.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), `mobile/www/${file} difiere`);
});

test('los mensajes de WhatsApp/Meta no se muestran: los paga la clínica directo a Meta', () => {
  assert.doesNotMatch(js, /resource\('meta_messages'\)|resource\('whatsapp_messages'\)/);
  assert.doesNotMatch(js, /label: 'Mensajes de WhatsApp/);
});
