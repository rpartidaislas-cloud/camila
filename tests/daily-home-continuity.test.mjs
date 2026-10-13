import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-daily-home.js');
const styles = read('../smyl-daily-home.css');
const attention = read('../smyl-lana-attention.js');
const worker = read('../sw.js');

test('Inicio resume la jornada y enlaza módulos canónicos', () => {
  for (const label of ['JORNADA DE HOY','Citas hoy','En clínica','Solicitudes','Mensajes','Qué requiere atención','Siguiente en el día']) assert.match(script, new RegExp(label));
  for (const route of ["route('agenda')","route('pacientes')","data-route=\"inbox\""]) assert.match(script, new RegExp(route.replace(/[()]/g,'\\$&')));
  assert.match(script, /window\.abrirModalPaciente/);
  assert.doesNotMatch(script, /insert\(|update\(|delete\(/);
});

test('Resumen diario consulta datos protegidos por clínica', () => {
  for (const table of ['smyl_appointments','smyl_appointment_requests','camila_pacientes','smyl_services']) assert.match(script, new RegExp("from\\('"+table+"'\\)"));
  assert.match(script, /eq\('tenant_id',state\.tenant\)/);
  assert.match(script, /gte\('starts_at'/);
  assert.match(script, /lt\('starts_at'/);
});

test('Mensajería publica solo su resumen operativo al Inicio', () => {
  assert.match(attention, /smyl:attention-updated/);
  assert.match(attention, /getSummary: summary/);
  assert.match(script, /SmylLanaAttention\.getSummary/);
  assert.match(script, /smyl:attention-updated/);
});

test('Etapa 4 se distribuye en web, PWA y vista de QA', () => {
  assert.match(app, /smyl-daily-home\.css\?v=1/);
  assert.match(app, /smyl-daily-home\.js\?v=2/);
  assert.match(app, /smyl-lana-attention\.js\?v=4/);
  assert.match(worker, /smyl-v199-cfdi-lifecycle/);
  assert.match(worker, /smyl-daily-home\.js\?v=2/);
  assert.match(styles, /daily-home-metrics/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(read('./fixtures/smyl-daily-home-stage4-preview.html'), /smyl-daily-home\.js/);
  assert.equal(script, read('../mobile/www/smyl-daily-home.js'));
  assert.equal(styles, read('../mobile/www/smyl-daily-home.css'));
});
