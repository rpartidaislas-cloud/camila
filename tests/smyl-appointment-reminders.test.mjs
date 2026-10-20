import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = read('../supabase/migrations/20261019010000_smyl_appointment_reminder_delivery.sql');
const fn = read('../supabase/functions/appointment-reminders/index.ts');
const ui = read('../smyl-reminders.js');
const schedule = read('../smyl-schedule.js');
const inbox = read('../smyl-inbox.js');
const app = read('../app.html');
const worker = read('../sw.js');
const config = read('../supabase/config.toml');

test('mover o cancelar una cita cancela su recordatorio, también en LANA', () => {
  assert.match(sql, /after update of starts_at, status on public\.smyl_appointments/);
  assert.match(sql, /new\.status in \('cancelled', 'no_show', 'completed'\) or new\.starts_at is distinct from old\.starts_at/);
  assert.match(sql, /provider_cancel_required = r\.provider_reference is not null/);
  assert.match(fn, /function processCancellations/);
  assert.match(fn, /\/scheduled\/\$\{scheduledId\}\/cancel/);
});

test('el reclamo de recordatorios es exclusivo del servidor y no duplica envíos', () => {
  assert.match(sql, /for update of r skip locked/);
  assert.match(sql, /revoke all on function public\.smyl_claim_appointment_reminders\(uuid, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.smyl_claim_appointment_reminders\(uuid, integer\) to service_role/);
  assert.match(sql, /revoke insert, update, delete on table public\.smyl_reminder_settings from authenticated/);
  // La clave de idempotencia hacia LANA es el id del recordatorio.
  assert.match(fn, /headers: systemHeaders\(tenantId, row\.reminder_id\)/);
  assert.match(fn, /\.eq\("id", row\.reminder_id\)\.eq\("status", "processing"\)/);
});

test('solo envía plantillas aprobadas a conversaciones de WhatsApp vinculadas', () => {
  assert.match(fn, /type: "template"/);
  assert.doesNotMatch(fn, /type: "text"/);
  assert.match(fn, /\.eq\("lana_channel", "whatsapp"\)/);
  assert.match(fn, /NO_WHATSAPP/);
  assert.match(fn, /La plantilla necesita \$\{template\.variable_count\} variables/);
  assert.match(ui, /no es de utilidad/);
});

test('los permisos se validan en el servidor con las funciones de RLS', () => {
  assert.match(fn, /requireUser\(req, CORS\)/);
  assert.match(fn, /rpc\("smyl_has_permission"/);
  assert.match(fn, /can\["schedule\.manage"\] && can\["messages\.respond"\]/);
  assert.match(fn, /if \(!can\["schedule\.read"\]\)/);
  assert.match(fn, /expected\.length < 32/);
  // Verify JWT apagado a propósito (el cron no tiene sesión): el handler autentica todo.
  assert.match(config, /\[functions\.appointment-reminders\]\nverify_jwt = false/);
  const handler = fn.slice(fn.indexOf('Deno.serve('));
  const firstAuth = Math.min(handler.indexOf('sameSecret('), handler.indexOf('requireUser('));
  assert.ok(firstAuth > 0);
  assert.doesNotMatch(handler.slice(0, firstAuth), /admin\.from|admin\.rpc|lanaRequest/, 'nada toca datos antes de autenticar');
});

test('toda consulta a LANA lleva la identidad de quien la hace', () => {
  // Sin X-SMYL-Actor-Id, LANA responde "Falta la identidad autenticada del miembro de SMYL".
  const calls = fn.match(/lanaRequest\(tenantId, [^;]*?\}, \d+\)/gs) || [];
  assert.ok(calls.length >= 4);
  for (const call of calls) assert.match(call, /headers/, call.slice(0, 90));
  assert.match(fn, /async function templates\(tenantId: string, headers: Headers\)/);
  assert.match(fn, /"X-SMYL-Actor-Id": user\.id/);
});

test('desactivar los recordatorios cancela lo que estaba en cola', () => {
  assert.match(fn, /async function cancelQueued/);
  assert.match(fn, /if \(!enabled\) \{/);
  assert.match(fn, /enabled: false, updated_by: auth\.user!\.id/);
  assert.match(fn, /cancelled_in_lana: await cancelQueued\(tenantId\)/);
  // Apagar no debe depender de LANA: la validación de plantilla va después.
  assert.ok(fn.indexOf('enabled: false, updated_by') < fn.indexOf('La plantilla ya no está disponible en LANA'));
});

test('la Agenda configura los recordatorios y dispara la entrega al cambiar citas', () => {
  assert.match(ui, /\[data-schedule-panel="settings"\] \.schedule-settings-grid/);
  assert.match(ui, /Recordatorios por WhatsApp/);
  assert.doesNotMatch(ui, /localStorage/);
  assert.match(schedule, /function remindersChanged\(\)\{if\(window\.SmylReminders\)window\.SmylReminders\.dispatch\(true\);\}/);
  assert.equal((schedule.match(/remindersChanged\(\);/g) || []).length, 3);
  assert.match(schedule, /select\('id,appointment_id,reminder_type,scheduled_for,status/);
  assert.match(inbox, /window\.SmylReminders\.dispatch\(true\)/);
});

test('sin plantillas aprobadas, el diálogo lleva a las propuestas de Mensajería', () => {
  assert.match(ui, /data-open-templates>Ver plantillas propuestas/);
  assert.match(ui, /window\.ir\('plantillas'\)/);
});

test('web, móvil y PWA publican el módulo de recordatorios', () => {
  assert.match(app, /<script defer src="smyl-reminders\.js\?v=2"><\/script>/);
  assert.match(worker, /'\/camila\/smyl-reminders\.js\?v=2'/);
  assert.equal(read('../mobile/www/smyl-reminders.js'), ui);
  assert.equal(read('../mobile/www/smyl-schedule.js'), schedule);
  assert.equal(read('../mobile/www/app.html'), app);
});

test('el archivo único para el panel de Supabase está al día con la función y sus archivos compartidos', async () => {
  const { execFileSync } = await import('node:child_process');
  const bundlePath = new URL('../docs/bundles/appointment-reminders.single-file.ts', import.meta.url);
  const before = fs.readFileSync(bundlePath, 'utf8');
  execFileSync(process.execPath, [new URL('../scripts/bundle-edge-function.mjs', import.meta.url).pathname, 'appointment-reminders'], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(bundlePath, 'utf8'), before, 'Regenera con: node scripts/bundle-edge-function.mjs appointment-reminders');
  assert.doesNotMatch(before, /from "\.\.?\//);
  assert.equal((before.match(/^import /gm) || []).length, 1);
});
