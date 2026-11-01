import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-daily-home.js');
const styles = read('../smyl-daily-home.css');
const attention = read('../smyl-lana-attention.js');
const worker = read('../sw.js');

test('Inicio prioriza la jornada, atención y mensajes sin duplicar el menú', () => {
  for (const label of ['Todo al día por hoy','Ahora y después','Citas hoy','En la clínica','Por confirmar','Mensajes recientes','Requiere atención','META','Resumen del mes']) assert.match(script, new RegExp(label));
  for (const route of ["route('agenda')","route('inbox')","route('reportes')"]) assert.match(script, new RegExp(route.replace(/[()]/g,'\\$&')));
  assert.match(script,/SmylCareTasks\.open/);
  assert.doesNotMatch(script, /data-home-task=|daily-home-shortcuts|window\.abrirModalPaciente/);
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

test('La mesa de trabajo se distribuye en web, PWA y vista de QA', () => {
  assert.match(app, /smyl-daily-home\.css\?v=14/);
  assert.match(app, /smyl-daily-home\.js\?v=12/);
  assert.match(app, /smyl-clinic-setup\.js\?v=5/);
  assert.match(app, /smyl-lana-attention\.js\?v=4/);
  assert.match(worker, /meta-cards-v13/);
  assert.match(worker, /smyl-daily-home\.js\?v=12/);
  assert.match(styles, /daily-home-metrics/);
  assert.match(styles, /--smyl-primary/);
  assert.match(styles, /daily-home-clear/);
  assert.match(styles, /grid-template-columns:repeat\(auto-fit,minmax\(190px,1fr\)\)/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(read('./fixtures/smyl-daily-home-stage4-preview.html'), /smyl-daily-home\.js/);
  assert.equal(script, read('../mobile/www/smyl-daily-home.js'));
  assert.equal(styles, read('../mobile/www/smyl-daily-home.css'));
});

test('Inicio conserva a la vista las conversaciones recientes de Meta y prioriza atención', () => {
  assert.match(script, /Mensajes recientes/);
  assert.match(script, /fetchRecent\(12\)/);
  assert.match(script, /needs_human/);
  assert.match(script, /unread_count/);
  assert.doesNotMatch(script, /rows\.filter\(function\(item\)/);
  assert.match(script, /Necesita asesor/);
  assert.match(script, /inbox\.open\(item\.id\)/);
  assert.doesNotMatch(script, /last_message\|\|/);
  assert.doesNotMatch(script, /loadList|openConversation|insert\(|update\(/);
  assert.match(styles, /#lana-attention-dashboard\{display:none!important\}/);
  assert.match(styles, /\.daily-home-chats \.daily-home-chat-strip\{display:grid;grid-template-columns:1fr/);
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
  assert.match(script, /Ver todas las acciones/);
  assert.match(script, /class="daily-home-now"/);
  assert.match(script, /STATUS=\{confirmed:'Confirmada',arrived:'Ya llegó'/);
  assert.match(styles, /\.daily-home-timeline button\[data-status="no_show"\] em/);
});

test('el Inicio y el panel reservan su espacio para no «saltar» mientras cargan', () => {
  assert.match(app, /<body class="smyl-professional smyl-management-v3 smyl-ui-governed">/);
  assert.match(app, /smyl_sidebar_collapsed[^<]*smyl-sidebar-collapsed/);
  assert.match(script, /if\(!state\.loaded\)renderLoading\(\);/);
  assert.match(script, /flag\('month'\)==='1'/);
  assert.match(styles, /\.daily-home-chat-skeleton\{height:104px/);
  assert.match(read('../smyl-clinic-setup.js'), /function reserveSpace\(\)/);
  assert.match(read('../smyl-clinic-setup.js'), /host\.append\(section\)/);
  assert.doesNotMatch(read('../smyl-clinic-setup.js'), /hero\.after/);
});

test('la bandeja de Mensajes se precarga y no abre una conversación en segundo plano', () => {
  const inbox = read('../smyl-inbox.js');
  assert.match(inbox, /function autoOpenFirst\(\)/);
  assert.match(inbox, /classList\.contains\('activa'\)/);
  assert.match(inbox, /loadList\(true\); loadTeam\(\); loadStages\(\); loadQuickReplies\(\);\s*\}, 2500\)/);
  assert.match(inbox, /else \{ sync\(\); loadOperations\(false\); autoOpenFirst\(\); \}/);
});
