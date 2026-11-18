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
  for (const label of ['Todo al día','Mi jornada','en clínica','por llegar','terminada','Mensajes recientes','ATENCIÓN REQUERIDA','CONVERSACIONES','Resumen del mes','Nueva cita']) assert.match(script, new RegExp(label));
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
  assert.match(app, /smyl-daily-home\.css\?v=16/);
  assert.match(app, /smyl-daily-home\.js\?v=17/);
  assert.match(app, /smyl-dashboard-v2\.css\?v=1/);
  assert.ok(app.indexOf('smyl-dashboard-v2.css?v=1') > app.indexOf('smyl-ui-template-v3.css?v=8'), 'la capa del dashboard debe gobernar después de la plantilla global');
  assert.match(app, /smyl-clinic-setup\.js\?v=6/);
  assert.match(app, /smyl-lana-attention\.js\?v=4/);
  assert.match(worker, /meta-cards-v13/);
  assert.match(worker, /patient-simulations-v70/);
  assert.match(worker, /smyl-daily-home\.js\?v=17/);
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
  assert.match(script, /function renderPriorities\(tasks\)[\s\S]*?data-home-priority-title/);
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
  const title = { textContent: '' };
  const dayState = { textContent: '', dataset: {} };
  const document = {
    querySelector(selector) {
      return ({
        '[data-home-priorities]': host,
        '[data-home-priority-title]': title,
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
  assert.equal(title.textContent, '1 pendiente');
  assert.equal(dayState.textContent, '1 requiere atención');
});

test('el Inicio y el panel reservan su espacio para no «saltar» mientras cargan', () => {
  assert.match(app, /<body class="smyl-professional smyl-management-v3 smyl-ui-governed">/);
  assert.match(app, /smyl_sidebar_collapsed[^<]*smyl-sidebar-collapsed/);
  assert.match(script, /if\(!state\.loaded\)renderLoading\(\);/);
  assert.match(script, /flag\('month'\)==='1'/);
  assert.match(styles, /\.daily-home-chat-skeleton\{height:104px/);
  assert.match(read('../smyl-clinic-setup.js'), /function reserveSpace\(\)/);
  assert.match(read('../smyl-clinic-setup.js'), /bar\.after\(section\)/, 'en una clínica nueva la configuración va después de la barra del Inicio');
  assert.doesNotMatch(read('../smyl-clinic-setup.js'), /hero\.after/);
});

test('la bandeja de Mensajes se precarga y no abre una conversación en segundo plano', () => {
  const inbox = read('../smyl-inbox.js');
  assert.match(inbox, /function autoOpenFirst\(\)/);
  assert.match(inbox, /classList\.contains\('activa'\)/);
  assert.match(inbox, /loadList\(true\); loadTeam\(\); loadBranches\(\); loadStages\(\);\s*\}, 2500\)/);
  assert.match(inbox, /else \{ sync\(\); loadOperations\(false\); autoOpenFirst\(\); \}/);
});

test('Inicio paso 1: barra compacta, chips en la jornada, una columna y «Configura tu clínica» solo si hace falta', () => {
  const setup = read('../smyl-clinic-setup.js');
  assert.match(script, /class="daily-home-bar"/);
  assert.doesNotMatch(script, /daily-home-hero|daily-home-kpi-section|function metric\(/, 'sin banner ni tarjetas de conteo repetidas');
  assert.match(script, /function chip\(kind,count,one,many,tone\)/);
  assert.match(script, /class="daily-home-fold"/, 'las citas terminadas se pliegan en una línea');
  assert.match(script, /daily-home-stat/);
  assert.match(styles, /\.daily-home-next-list\.daily-home-timeline\{display:block\}/, 'la jornada es una sola columna en todos los anchos');
  assert.match(setup, /state\.operating = rows\[0\]\.ok/);
  assert.match(setup, /!pending\.length \|\| state\.operating \|\| hiddenToday\(\)/, 'la tarjeta se oculta cuando la clínica ya opera o se ocultó hoy');
  assert.match(setup, /Ocultar por hoy/);
  assert.match(setup, /smyl_clinic_setup_hidden_/);
});

test('Inicio por rol: oculta lo que el rol no puede usar y limita la jornada a las citas propias si no administra la agenda', () => {
  assert.match(script, /function can\(key\)/);
  assert.match(script, /from\('smyl_member_roles'\)\.select\('role_id'\)/);
  assert.match(script, /from\('smyl_role_permissions'\)\.select\('permission_key'\)/);
  assert.match(script, /from\('smyl_professionals'\)\.select\('id'\)\.eq\('tenant_id',tenant\)\.eq\('user_id',uid\)/);
  assert.match(script, /professional_id/);
  assert.match(script, /function mineOnly\(\)[\s\S]*?can\('schedule\.manage'\)\?flag\('mine'\)==='1':true/);
  assert.match(script, /now\.hidden=!read/);
  assert.match(script, /create\.hidden=!can\('schedule\.manage'\)/);
  assert.match(script, /chats\.hidden=!messages/);
  assert.match(script, /if\(!can\('schedule\.read'\)\)return tasks;/);
  assert.match(script, /Solo mis citas/);
  // Si no se pueden leer los permisos se muestra todo: la base de datos (RLS) sigue siendo la que decide qué datos llegan.
  assert.match(script, /catch\(_\) \{ state\.access=null; \}/);
  assert.match(styles, /\.daily-home-workbench\.is-solo/);
  assert.doesNotMatch(script, /insert\(|update\(|delete\(/);
});
