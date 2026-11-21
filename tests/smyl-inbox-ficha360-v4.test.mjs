import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('smyl-inbox.js');
const ficha = read('smyl-inbox-ficha.js');
const finance = read('smyl-finance.js');
const schedule = read('smyl-schedule.js');

const build = js.slice(js.indexOf('function buildFicha360('), js.indexOf('function wrapPanel('));

test('el perfil ordena resumen, cuenta, citas y atenciones sin repetir la pestaña Archivos ni Agendar', () => {
  const order = ["id: 'summary'", "id: 'cuenta'", "id: 'citas'", "sections.push(careHistorySection("].map((key) => build.indexOf(key));
  assert.ok(order.every((index) => index > 0), 'faltan bloques');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'el orden cambió');
  assert.doesNotMatch(build, /sections\.push\(\{\s*id: 'files'|id: 'clinico'|id: 'timeline'|id: 'atencion'/);
  // La ficha ya no lleva botones grandes: ni Expediente, ni Cobrar (vive en Cuenta), ni Agendar.
  const shell = build.match(/F\.shell\(\{[\s\S]*?\n\s*\}\)/)?.[0];
  assert.ok(shell, 'se construye la ficha');
  assert.doesNotMatch(shell, /\bactions\s*:|'record'|'payment'|'schedule'|Agendar cita|Expediente/);
});

test('cada bloque cerrado muestra su dato clave y el abierto no lo repite', () => {
  assert.match(js, /function accountPeek\(conversation, linked\)/);
  assert.match(js, /' pendiente', tone: data\.overdueCount > 0 \? 'danger' : 'warn'/);
  assert.match(js, /function visitsPeek\(conversation, linked\)/);
  assert.match(js, /'Próx: ' \+ availabilityDate/);
  assert.match(read('smyl-inbox.css'), /\.smyl-f360-section\.is-open \.smyl-f360-peek\{display:none\}/);
});

test('se retiran tarjetas que no son del paciente y la capacitación deja de ser un botón principal', () => {
  assert.doesNotMatch(js, /SIGUIENTE ACCIÓN|'smyl-inbox-context-card smyl-inbox-copilot-card'|'Agenda disponible'|ficha360Tiles/);
  assert.doesNotMatch(ficha, /Publicar capacitación|function tiles\(/);
  assert.match(js, /badge: 'IA'/, 'el resumen con IA se conserva');
});

test('sin pie de enlaces en la ficha: los ajustes siguen en el menú de herramientas del chat', () => {
  assert.doesNotMatch(js, /smyl-f360-tools|Acciones de la ficha/);
  assert.match(js, /querySelector\('\[data-compose-tools\]'\)\.append\(settings\)/);
  assert.match(js, /settings\.dataset\.threadSettings/);
  assert.match(js, /settings\.onclick = openConversationSettings/);
  assert.match(js, /data-settings-dialog/);
  assert.match(js, /function buildConversationSettings\(conversation\)/);
  const settings = js.slice(js.indexOf('function buildConversationSettings('), js.indexOf('function renderConversationSettings('));
  for (const card of ["'Responsable'", "'Organización'", "'SMYL Asistente'", "'Ventana de WhatsApp'", "'Reactivación controlada'", "'Programados'"]) assert.ok(settings.includes(card), card);
  assert.match(js, /if \(keep\) return; \/\/ No reconstruye mientras alguien elige una opción\./);
});

test('citas y movimientos llegan por Agenda y Cobros; el chat no toca tablas ni guarda en el navegador', () => {
  assert.match(schedule, /patientVisits:async function\(patientId,limit\)/);
  assert.match(schedule, /from\('smyl_appointments'\)\.select\('id,starts_at,ends_at,status,service_id,professional_id,branch_id'\)\.eq\('tenant_id',t\)\.eq\('patient_id',patientId\)/);
  assert.match(finance, /async function recentMovements\(patientId,limit\)/);
  assert.match(finance, /async function appointmentConcepts\(appointmentIds\)/);
  assert.match(finance, /recentMovements:recentMovements,appointmentConcepts:appointmentConcepts\}\);/);
  const loaders = js.slice(js.indexOf('async function loadPatientVisits'), js.indexOf('function openCareTask'));
  assert.match(loaders, /schedule\.patientVisits\(patientId, 30\)/);
  assert.match(loaders, /hasPermission\('finance\.read'\) && finance && typeof finance\.appointmentConcepts === 'function'/);
  assert.match(loaders, /finance\.recentMovements\(patientId, 8\)/);
  assert.doesNotMatch(js, /localStorage|window\.tenantId|\.from\('smyl_/);
  assert.doesNotMatch(js.slice(js.indexOf('var F360_OPEN_DEFAULT'), js.indexOf('function f360Money')), /sessionStorage/);
});

test('la lista de citas separa próximas y anteriores, con tratamiento, dentista, sucursal y asistencia', () => {
  for (const label of ['Próximas', 'Anteriores', 'Tratamiento: ', 'No asistió', 'Atendida', 'Cancelada']) assert.ok(ficha.includes(label), label);
  assert.match(ficha, /past\.slice\(0, 4\)/);
  assert.match(ficha, /'Ver todas las anteriores \(' \+ past\.length \+ '\)'/);
});

test('web, móvil y PWA publican la ficha 360 v4', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-inbox-ficha\.js\?v=12/);
    assert.match(read(file), /smyl-inbox\.js\?v=89/);
    assert.match(read(file), /smyl-inbox\.css\?v=75/);
    assert.match(read(file), /smyl-schedule\.js\?v=56/);
    assert.match(read(file), /smyl-finance\.js\?v=62/);
  }
  assert.match(read('sw.js'), /-ficha360-v4-finanzas-workspace-v5-datos-paciente-v1-expediente-orden-v2-constancia-domicilio-v1-constancia-chat-v1[-';]/);
  assert.match(read('sw.js'), /-chat-access-v1-citas-pipeline-v2-panel-v2';/);
  for (const file of ['smyl-inbox.js', 'smyl-inbox-ficha.js', 'smyl-inbox.css', 'smyl-schedule.js', 'smyl-finance.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});

test('el resumen con IA es opcional: solo se lee el guardado y se genera a petición', () => {
  const load = js.slice(js.indexOf('async function loadStoredSummary'), js.indexOf('function storedBasis'));
  assert.match(load, /action: 'conversation_summary'/);
  assert.doesNotMatch(load, /requestConversationSummary\(/);
  assert.match(js, /var F360_OPEN_DEFAULT = \{ summary: false,/);
  assert.match(js, /\{ text: 'Opcional', tone: 'muted' \}/);
  assert.match(ficha, /'Resumir conversación'/);
});
