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
  for (const label of ['Todo al día','Mi jornada','en clínica','por llegar','terminada','Mensajes recientes','Requiere atención','Resumen mensual de la clínica']) assert.match(script, new RegExp(label));
  for (const route of ["route('agenda')","route('inbox')","route('reportes')"]) assert.match(script, new RegExp(route.replace(/[()]/g,'\\$&')));
  assert.doesNotMatch(script, /data-home-task=|data-home-new-appointment|daily-home-shortcuts|window\.abrirModalPaciente|SmylCareTasks\.open\('appointment'\)/);
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

test('las conversaciones que necesitan asesor no se cuentan como mensajes sin leer', () => {
  const inbox = {}, metrics = {};
  const document = {querySelector: selector => ({'[data-home-metrics]': metrics, '[data-home-inbox-line]': inbox})[selector]};
  const state = {messages:{loaded:true, unread:0, total:4}};
  const render = new Function('document','state','activeAppointments','can',
    `${functionSource(script, 'renderMetrics')}; return renderMetrics;`)(document,state,() => [],() => true);
  render();
  assert.equal(inbox.hidden, true);
  state.messages.unread = 2;
  render();
  assert.equal(inbox.hidden, false);
  assert.equal(inbox.textContent, '2 sin leer');
});

test('el resumen mensual conserva los ceros reales y distingue los datos ausentes', async () => {
  const section = {}, host = { dataset:{}, style:{setProperty(){}}, querySelectorAll:() => [] };
  const document = {querySelector: selector => selector === '[data-home-month]' ? host : section};
  const state = {month:{finance:true, collected:0, outstanding:null, newPatients:null, attendance:null}};
  const render = new Function('document','state','flag','esc',
    ['money','trend','monthTile','renderMonth'].map(name => functionSource(script,name)).join('\n') + '; return renderMonth;'
  )(document,state,() => {},String);
  render();
  assert.match(host.innerHTML, /Cobrado este mes<\/span><strong>\$0<\/strong>/);
  assert.match(host.innerHTML, /Por cobrar<\/span><strong>Sin dato<\/strong>/);
  assert.match(host.innerHTML, /Pacientes nuevos<\/span><strong>Sin dato<\/strong>/);
  const count = new Function('window', 'async ' + functionSource(script,'countRows') + '; return countRows;')({});
  assert.equal(await count({count:null}), null);
  assert.equal(await count({count:0}), 0);
});

test('La mesa de trabajo se distribuye en web, PWA y vista de QA', () => {
  assert.match(app, /smyl-daily-home\.css\?v=17/);
  assert.match(app, /smyl-daily-home\.js\?v=21/);
  assert.match(app, /smyl-dashboard-v2\.css\?v=2/);
  const template = app.indexOf('smyl-ui-template-v3.css?v=');
  assert.ok(template >= 0 && app.indexOf('smyl-dashboard-v2.css?v=2') > template, 'la capa del dashboard debe gobernar después de la plantilla global');
  assert.match(app, /smyl-clinic-setup\.js\?v=9/);
  assert.match(app, /smyl-lana-attention\.js\?v=6/);
  assert.match(worker, /meta-cards-v13/);
  assert.match(worker, /patient-simulations-v70/);
  assert.match(worker, /smyl-daily-home\.js\?v=21/);
  assert.match(worker, /smyl-daily-home\.css\?v=17/);
  assert.match(worker, /inicio-sin-nueva-cita-v1/);
  assert.match(worker, /smyl-dashboard-v2\.css\?v=2/);
  assert.match(worker, /dashboard-operativo-v3/);
  assert.match(styles, /daily-home-metrics/);
  assert.match(styles, /--smyl-primary/);
  assert.match(dashboardStyles, /daily-home-workbench/);
  assert.ok(dashboardStyles.includes('grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr)'));
  assert.ok(dashboardStyles.includes('@container clinic-home (min-width: 800px)'));
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
  assert.match(dashboardStyles, /\.daily-home-chat-strip\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
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

test('atención cuenta las áreas distintas y conserva las acciones de cada aviso', () => {
  const host = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const count = { textContent: '', hidden: true };
  const state = {error:''};
  let shared = [];
  const document = {
    querySelector(selector) {
      return ({
        '[data-home-priorities]': host,
        '[data-home-priority-count]': count,
      })[selector] || null;
    },
  };
  const renderPriorities = new Function(
    'document', 'taskItems', 'resolvePriorityTasks', 'esc', 'route', 'window', 'setTimeout', 'state',
    `let renderedPriorities=null; ${functionSource(script, 'renderPriorities')}; return renderPriorities;`,
  )(
    document,
    () => shared,
    () => [],
    value => String(value),
    () => {},
    {},
    setTimeout,
    state,
  );
  const task = {
    source: 'Agenda', label: 'Agenda', name: 'Cita por confirmar', detail: 'El paciente espera respuesta.',
    action: 'Revisar', route: 'agenda', urgent: true,
  };
  renderPriorities([task, {...task, name:'6 avisos sin enviar'}]);
  assert.equal(count.textContent, '1 área');
  assert.match(host.innerHTML, /6 avisos sin enviar/);
  renderPriorities([task, {...task, source:'Seguridad', name:'25 señales'}]);
  assert.equal(count.textContent, '2 áreas');
  renderPriorities([]);
  assert.equal(count.hidden, true);
  assert.match(host.innerHTML, /Todo al día/);
  state.error = 'No disponible';
  shared = null;
  renderPriorities();
  assert.match(host.innerHTML, /Pendientes sin actualizar/);
  assert.doesNotMatch(host.innerHTML, /Todo al día/);
  shared = [task];
  renderPriorities([task]);
  assert.match(host.innerHTML, /Cita por confirmar/);
  assert.equal(count.textContent, '1 área');
});

test('el Inicio y el panel reservan su espacio para no «saltar» mientras cargan', () => {
  assert.match(app, /<body class="smyl-professional smyl-management-v3 smyl-ui-governed">/);
  assert.match(app, /smyl_sidebar_collapsed[^<]*smyl-sidebar-collapsed/);
  assert.match(script, /if\(!state\.loaded\)renderLoading\(\);/);
  assert.match(script, /flag\('month'\)==='1'/);
  assert.match(styles, /\.daily-home-chat-skeleton\{height:104px/);
  assert.match(read('../smyl-clinic-setup.js'), /host\.append\(section\)/, 'la configuración pendiente va al final de Inicio');
});

test('la bandeja de Mensajes se precarga y no abre una conversación en segundo plano', () => {
  const inbox = read('../smyl-inbox.js');
  assert.match(inbox, /function autoOpenFirst\(\)/);
  assert.match(inbox, /classList\.contains\('activa'\)/);
  assert.match(inbox, /loadList\(true\); loadBranches\(\); loadStages\(\);\s*\}, 2500\)/);
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
  assert.match(setup, /info\.done >= info\.total \|\| hiddenToday\(\)/, 'la tarjeta se oculta al completar los pasos obligatorios o cuando se ocultó hoy');
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
  assert.match(script, /chats\.hidden=!messages/);
  assert.match(script, /if\(!can\('schedule\.read'\)\)return tasks;/);
  assert.match(script, /Solo mis citas/);
  // Si no se pueden leer los permisos se muestra todo: la base de datos (RLS) sigue siendo la que decide qué datos llegan.
  assert.match(script, /catch\(_\) \{ state\.access=null; \}/);
  assert.match(styles, /\.daily-home-workbench\.is-solo/);
  assert.doesNotMatch(script, /insert\(|update\(|delete\(/);
});
