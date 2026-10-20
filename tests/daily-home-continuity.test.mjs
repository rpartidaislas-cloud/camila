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
  for (const label of ['Todo lo importante de tu clínica, en orden','Agendar cita','Citas hoy','En clínica','Solicitudes','Mensajes','Qué requiere atención','Siguiente en el día']) assert.match(script, new RegExp(label));
  for (const route of ["route('agenda')","route('pacientes')","data-route=\"inbox\""]) assert.match(script, new RegExp(route.replace(/[()]/g,'\\$&')));
  for (const task of ['appointment','quote','payment']) assert.match(script,new RegExp('data-home-task="'+task+'"'));
  assert.match(script,/SmylCareTasks\.open/);
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
  assert.match(app, /smyl-daily-home\.css\?v=6/);
  assert.match(app, /smyl-daily-home\.js\?v=5/);
  assert.match(app, /smyl-lana-attention\.js\?v=4/);
assert.match(worker, /smyl-v254-visible-shell-v4/);
  assert.match(worker, /smyl-daily-home\.js\?v=5/);
  assert.match(styles, /daily-home-metrics/);
  assert.match(styles, /--smyl-primary/);
  assert.match(styles, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /font-size:24px/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(read('./fixtures/smyl-daily-home-stage4-preview.html'), /smyl-daily-home\.js/);
  assert.equal(script, read('../mobile/www/smyl-daily-home.js'));
  assert.equal(styles, read('../mobile/www/smyl-daily-home.css'));
});

test('Inicio muestra los chats recientes como tarjetas compactas y los botones de acción son pequeños', () => {
  assert.match(script, /Chats recientes/);
  assert.match(script, /fetchRecent\(6\)/);
  assert.match(script, /Necesita asesor/);
  assert.match(script, /inbox\.open\(item\.id\)/);
  assert.doesNotMatch(script, /loadList|openConversation|insert\(|update\(/);
  assert.match(styles, /#lana-attention-dashboard\{display:none!important\}/);
  assert.match(styles, /\.daily-home-actions \.btn\{width:auto;min-height:32px;height:32px/);
  assert.match(styles, /\.daily-home-chat-strip\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(220px,1fr\)\)/);
  const inbox = read('../smyl-inbox.js');
  assert.match(inbox, /fetchRecent: async function \(limit\)/);
  assert.match(inbox, /filter: 'all', limit: Math\.max\(1, Math\.min\(12/);
});
