import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const inbox = read('supabase/functions/lana-inbox/index.ts');
const ui = read('smyl-inbox.js');
const migration = read('supabase/migrations/20261130100000_smyl_purge_unlinked_lana_credentials.sql');

test('la pausa de emergencia es solo del dueño con alcance de toda la clínica y exige llave de idempotencia', () => {
  const block = inbox.slice(inbox.indexOf('if (action === "pause_all")'), inbox.indexOf('if (action === "stage_create"'));
  assert.match(block, /actor\.role !== "owner" \|\| actor\.scopes\.messages !== "clinic"\) return json\(403/);
  assert.match(block, /Idempotency-Key debe ser un UUID válido/);
  assert.match(block, /pauseAllAutomaticReplies\(actor, auth\.tenantId\)/);
});

test('pausa cada conversación con la ruta de pausa de LANA y deja auditoría sin datos de pacientes', () => {
  const fn = inbox.slice(inbox.indexOf('async function pauseAllAutomaticReplies('), inbox.indexOf('async function patientLinkPreview('));
  assert.match(fn, /pauseAllConversations\(\{/);
  assert.match(fn, /`\/inbox\/conversations\/\$\{conversationId\}\/pause`/);
  assert.match(fn, /if \(!uuid\(conversationId\)\) return false/, 'no pausa ids que no sean uuid');
  assert.match(fn, /entity_type: "chat_pause_all"/);
  const audit = fn.slice(fn.indexOf('smyl_audit_events'));
  assert.doesNotMatch(audit, /contact|phone|telefono|nombre|mensaje|content/i);
  assert.match(inbox, /import \{ pauseAllConversations \} from "\.\.\/_shared\/pause-all-core\.mjs"/);
  assert.ok(read('docs/bundles/lana-inbox.single-file.ts').includes('pauseAllAutomaticReplies'), 'el bundle está regenerado');
});

test('la pantalla de Operación muestra el botón solo al dueño, confirma y dice con números y sin exagerar lo que logró', () => {
  assert.match(ui, /if \(canManagePilot\) content\.append\(buildEmergencyPause\(\)\)/);
  const fn = ui.slice(ui.indexOf('function buildEmergencyPause()'), ui.indexOf('async function pauseAllReplies()'));
  assert.match(fn, /Pausar respuestas automáticas/);
  assert.match(fn, /Una conversación nueva que llegue después no queda pausada/, 'dice el límite');
  assert.match(fn, /result\.complete \? 'Listo: todas las conversaciones están pausadas' : 'Pausa incompleta: revisa y repite'/);
  assert.match(fn, /result\.paused \+ ' pausadas ahora/);
  assert.match(fn, /Hay más conversaciones de las que se pudieron revisar/);
  const run = ui.slice(ui.indexOf('async function pauseAllReplies()'), ui.indexOf('async function pauseAllReplies()') + 900);
  assert.match(run, /window\.confirm\(/);
  assert.match(run, /action: 'pause_all' \}, uuid\(\)/);
});

test('la migración borra solo las credenciales guardadas tras desvincular y no toca el enlace activo', () => {
  assert.match(migration, /'\{integraciones,lana_desvinculada\}'/);
  assert.match(migration, /- 'api_key_ciphertext' - 'api_key_iv'/);
  assert.match(migration, /'credencial_borrada', true/);
  assert.doesNotMatch(migration, /\{integraciones,lana\}'(?!_)|integraciones,lana\}[^_]/, 'no toca integraciones.lana');
  assert.doesNotMatch(migration, /drop |truncate|delete from/i);
  assert.match(migration, /\? 'api_key_ciphertext'/, 'solo actualiza filas que aún guardan la credencial (idempotente)');
});

test('web, móvil y PWA publican desvincular y pausar', () => {
  for (const file of ['smyl-inbox.js', 'smyl-inbox.css', 'smyl-connections.js', 'smyl-connections.css', 'app.html', 'sw.js']) assert.equal(read(file), read(`mobile/www/${file}`), file);
});
