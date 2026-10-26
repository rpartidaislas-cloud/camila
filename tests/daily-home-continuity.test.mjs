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
  for (const label of ['Todo al día por hoy','Tienes ','Agendar cita','Citas hoy','En la clínica','Por aprobar','Mensajes','Pendientes de hoy','Citas de hoy']) assert.match(script, new RegExp(label));
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
  assert.match(app, /smyl-daily-home\.css\?v=11/);
  assert.match(app, /smyl-daily-home\.js\?v=(?:[7-9]|1[0-9])/);
  assert.match(app, /smyl-lana-attention\.js\?v=4/);
assert.match(worker, /smyl-v263-lana-connection-recovery/);
  assert.match(worker, /smyl-daily-home\.js\?v=(?:[7-9]|1[0-9])/);
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

test('Inicio comparte pendientes con el Centro de alertas y calcula los indicadores del mes con permisos del servidor', () => {
  const center = read('../smyl-task-center.js');
  assert.match(center, /getTasks:function\(\)\{return state\.loaded\?tasks\(\):null;\}/);
  assert.match(center, /detail:\{pending:items\.length,unread_news:unread,items:items\}/);
  assert.match(script, /SmylTaskCenter/);
  assert.match(script, /smyl:task-center-updated/);
  assert.match(script, /rpc\('smyl_executive_dashboard',\{p_from:ymd\(start\),p_to:ymd\(today\)\}\)/);
  assert.match(script, /data\.finance/);
  assert.match(script, /Cobrado este mes/);
  assert.match(script, /Por cobrar/);
  assert.match(script, /Pacientes nuevos/);
  assert.match(script, /Asistencia/);
  assert.doesNotMatch(script, /smyl_finance_(charges|payments)/, 'los cobros salen de la función de reportes, no de tablas');
  assert.match(script, /Ver las '\+tasks\.length\+' alertas/);
  assert.match(script, /class="daily-home-now"/);
  assert.match(script, /STATUS=\{confirmed:'Confirmada',arrived:'Ya llegó'/);
  assert.match(styles, /\.daily-home-timeline button\[data-status="no_show"\] em/);
});

test('el Inicio y el panel reservan su espacio para no «saltar» mientras cargan', () => {
  assert.match(app, /<body class="smyl-professional smyl-management-v3">/);
  assert.match(app, /smyl_sidebar_collapsed[^<]*smyl-sidebar-collapsed/);
  assert.match(script, /if\(!state\.loaded\)renderLoading\(\);/);
  assert.match(script, /flag\('month'\)==='1'/);
  assert.match(styles, /\.daily-home-chat-skeleton\{height:104px/);
  assert.match(read('../smyl-clinic-setup.js'), /function reserveSpace\(\)/);
});

test('la bandeja de Mensajes se precarga y no abre una conversación en segundo plano', () => {
  const inbox = read('../smyl-inbox.js');
  assert.match(inbox, /function autoOpenFirst\(\)/);
  assert.match(inbox, /classList\.contains\('activa'\)/);
  assert.match(inbox, /loadList\(true\); loadTeam\(\); loadStages\(\); loadQuickReplies\(\);\s*\}, 2500\)/);
  assert.match(inbox, /else \{ sync\(\); loadOperations\(false\); autoOpenFirst\(\); \}/);
});
