import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const script = read('../smyl-daily-home.js');
const styles = read('../smyl-daily-home.css');
const dashboardStyles = read('../smyl-dashboard-v2.css');
const attention = read('../smyl-lana-attention.js');
const worker = read('../sw.js');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `no se encontró ${name}`);
  const body = source.indexOf('{', start);
  let depth = 0;
  for (let index = body; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`la función ${name} quedó incompleta`);
}

test('Inicio prioriza la jornada, atención y mensajes sin duplicar el menú', () => {
  for (const label of ['La jornada está al día','Mi jornada','Citas hoy','En clínica','Solicitudes','Mensajes recientes','Atención requerida','CONVERSACIONES','Resumen del mes']) assert.match(script, new RegExp(label));
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
  assert.match(app, /smyl-daily-home\.js\?v=15/);
  assert.match(app, /smyl-dashboard-v2\.css\?v=1/);
  assert.ok(app.indexOf('smyl-dashboard-v2.css?v=1') > app.indexOf('smyl-ui-template-v3.css?v=8'), 'la capa del dashboard debe gobernar después de la plantilla global');
  assert.match(app, /smyl-clinic-setup\.js\?v=5/);
  assert.match(app, /smyl-lana-attention\.js\?v=4/);
  assert.match(worker, /meta-cards-v13/);
  assert.match(worker, /patient-simulations-v70/);
  assert.match(worker, /smyl-daily-home\.js\?v=15/);
  assert.match(worker, /smyl-dashboard-v2\.css\?v=1/);
  assert.match(worker, /dashboard-operativo-v2/);
  assert.match(styles, /daily-home-metrics/);
  assert.match(styles, /--smyl-primary/);
  assert.match(dashboardStyles, /daily-home-workbench/);
  assert.match(dashboardStyles, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(dashboardStyles, /@media\(max-width:560px\)/);
  assert.match(read('./fixtures/smyl-daily-home-stage4-preview.html'), /smyl-dashboard-v2\.css/);
  assert.equal(script, read('../mobile/www/smyl-daily-home.js'));
  assert.equal(styles, read('../mobile/www/smyl-daily-home.css'));
  assert.equal(dashboardStyles, read('../mobile/www/smyl-dashboard-v2.css'));
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
  assert.match(dashboardStyles, /\.daily-home-chat-strip\{[\s\S]*grid-template-columns:repeat\(auto-fit,minmax\(220px,1fr\)\)/);
  const inbox = read('../smyl-inbox.js');
  assert.match(inbox, /fetchRecent: async function \(limit\)/);
  assert.match(inbox, /filter: 'all', limit: Math\.max\(1, Math\.min\(12/);
});

test('Inicio comparte pendientes con el Centro de alertas y calcula los indicadores del mes con permisos del servidor', () => {
  const center = read('../smyl-task-center.js');
  assert.match(center, /getTasks:function\(\)\{return state\.loaded\?tasks\(\):null;\}/);
  assert.match(center, /detail:\{pending:items\.length,unread_news:unread,items:items\}/);
  assert.match(script, /SmylTaskCenter/);
  assert.match(script, /function renderPriorities\(tasks\)[\s\S]*?data-home-priority-count/);
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

test('la prioridad compartida se renderiza sin referencias fuera de alcance', () => {
  const host = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const summary = { textContent: '' };
  const title = { textContent: '' };
  const count = { textContent: '', dataset: {}, setAttribute() {} };
  const dayState = { textContent: '', dataset: {} };
  const document = {
    querySelector(selector) {
      return ({
        '[data-home-priorities]': host,
        '[data-home-summary]': summary,
        '[data-home-priority-title]': title,
        '[data-home-priority-count]': count,
        '[data-home-day-state]': dayState,
      })[selector] || null;
    },
  };
  const renderPriorities = new Function(
    'document', 'taskItems', 'resolvePriorityTasks', 'esc', 'route', 'window', 'setTimeout',
    `${functionSource(script, 'renderPriorities')}; return renderPriorities;`,
  )(
    document,
    () => [{ source: 'Agenda' }],
    () => [],
    value => String(value),
    () => {},
    {},
    setTimeout,
  );
  assert.doesNotThrow(() => renderPriorities([{
    label: 'AGENDA', name: 'Cita por confirmar', detail: 'El paciente espera respuesta.',
    action: 'Revisar', route: 'agenda', urgent: true,
  }]));
  assert.equal(summary.textContent, '1 acción necesita tu atención hoy.');
  assert.equal(title.textContent, 'Atención requerida');
  assert.equal(count.textContent, '1');
  assert.equal(dayState.textContent, '1 pendiente');
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
