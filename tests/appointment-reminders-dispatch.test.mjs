// Simulación de punta a punta de la Edge Function appointment-reminders.
// Ejecuta el MISMO archivo único que se despliega en Supabase, con una base de datos en memoria,
// una LANA falsa que registra cada llamada y el cifrado real de la clave de LANA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const T = '11111111-1111-4111-8111-111111111111';          // clínica (cuenta propietaria)
const STAFF = '99999999-9999-4999-8999-999999999999';
const TEMPLATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONVERSATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PATIENT = '22222222-2222-4222-8222-222222222222';
const CRON = 'x'.repeat(40);
const LANA_BASE = 'https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api';
const HOUR = 3600 * 1000;

const supportsTypeScript = Boolean(process.features && process.features.typescript) || Number(process.versions.node.split('.')[0]) >= 23;

// ── Base de datos en memoria con la parte de la API de Supabase que usa la función ──
class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.mode = 'select'; this.max = Infinity; this.sort = null; this.chainedSelect = false; }
  select() { if (this.mode !== 'select') this.chainedSelect = true; return this; }
  update(patch) { this.mode = 'update'; this.patch = patch; return this; }
  upsert(row, options) { this.mode = 'upsert'; this.row = row; this.conflict = options && options.onConflict; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  not(column, operator, value) { this.filters.push((row) => (operator === 'is' && value === null ? row[column] != null : true)); return this; }
  gte(column, value) { this.filters.push((row) => String(row[column]) >= String(value)); return this; }
  lte(column, value) { this.filters.push((row) => String(row[column]) <= String(value)); return this; }
  order(column, options) { this.sort = { column, ascending: !options || options.ascending !== false }; return this; }
  limit(count) { this.max = count; return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve, reject) {
    try { resolve(this.run()); } catch (error) { reject ? reject(error) : resolve({ data: null, error: { message: String(error) } }); }
  }
  run() {
    const rows = this.db.tables[this.table] || (this.db.tables[this.table] = []);
    if (this.mode === 'upsert') {
      const index = rows.findIndex((row) => row[this.conflict] === this.row[this.conflict]);
      if (index === -1) rows.push({ ...this.row }); else Object.assign(rows[index], this.row);
      return { data: null, error: null };
    }
    let matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.mode === 'update') {
      matched.forEach((row) => Object.assign(row, this.patch));
      return { data: this.chainedSelect ? matched.map((row) => ({ ...row })) : null, error: null };
    }
    if (this.sort) matched = matched.slice().sort((a, b) => (String(a[this.sort.column]) < String(b[this.sort.column]) ? -1 : 1) * (this.sort.ascending ? 1 : -1));
    matched = matched.slice(0, this.max).map((row) => ({ ...row }));
    return { data: this.single ? matched[0] || null : matched, error: null };
  }
}

function makeWorld() {
  const iso = (ms) => new Date(ms).toISOString();
  const world = {
    tables: {
      camila_tenants: [{ id: T, nombre: 'Dra. Torres', config: {} }],
      camila_usuarios: [{ id: STAFF, tenant_id: T }],
      camila_lana_handoffs: [{ tenant_id: T, patient_id: PATIENT, lana_channel: 'whatsapp', lana_conversation_id: CONVERSATION, updated_at: iso(Date.now()) }],
      smyl_reminder_settings: [{ tenant_id: T, enabled: true, template_id: TEMPLATE, template_name: 'recordatorio_cita_24h_v1', variables: [{ source: 'patient_first_name' }, { source: 'date' }, { source: 'time' }, { source: 'clinic' }] }],
      smyl_appointment_reminders: [],
    },
    appointments: [],
    patients: { [PATIENT]: { nombre: 'Ana', apellido: 'López' } },
    permissions: { 'owner-jwt': ['schedule.read', 'schedule.manage', 'messages.respond'], 'staff-jwt': ['schedule.read'] },
    lana: { calls: [], scheduled: [], nextId: 5000, override: null, templates: [{ id: TEMPLATE, name: 'recordatorio_cita_24h_v1', language: 'es_MX', category: 'UTILITY', variable_count: 4, body: 'Hola {{1}}' }] },
    // Una cita confirmada con su recordatorio; start/due relativos al momento actual salvo que se indique.
    addReminder(options = {}) {
      const id = options.id || crypto.randomUUID();
      const startsAt = options.startsAt || Date.now() + 3 * 24 * HOUR;
      const appointmentId = crypto.randomUUID();
      world.appointments.push({ id: appointmentId, tenant_id: T, patient_id: PATIENT, status: options.appointmentStatus || 'confirmed', starts_at: iso(startsAt), service: 'Valoración', professional: 'Dra. Torres', branch: { name: 'Sucursal Centro', phone: '55 1234 5678', timezone: 'America/Mexico_City' } });
      const row = { id, tenant_id: T, appointment_id: appointmentId, reminder_type: '24h', scheduled_for: iso(options.dueAt || startsAt - 24 * HOUR), status: options.status || 'pending', delivery_channel: 'preferred', attempt_count: options.attempts || 0, provider_reference: options.reference || null, provider_conversation_id: options.reference ? CONVERSATION : null, provider_status: '', provider_cancel_required: Boolean(options.cancelRequired), last_error: '', next_attempt_at: options.nextAttemptAt || null, sent_at: null, created_at: iso(Date.now()), updated_at: iso(Date.now()) };
      world.tables.smyl_appointment_reminders.push(row);
      return row;
    },
    reminder(id) { return world.tables.smyl_appointment_reminders.find((row) => row.id === id); }
  };
  return world;
}

function client(getWorld, jwt) {
  return {
    from: (table) => new Query(getWorld(), table),
    rpc: async (name, args) => {
      const world = getWorld();
      if (name === 'smyl_has_permission') return { data: (world.permissions[jwt] || []).includes(args.p_permission), error: null };
      if (name !== 'smyl_claim_appointment_reminders') return { data: null, error: { message: 'rpc desconocida' } };
      const now = Date.now();
      const rows = world.tables.smyl_appointment_reminders;
      const appointment = (row) => world.appointments.find((item) => item.id === row.appointment_id);
      // Misma lógica que la RPC SQL: cancelar recordatorios de citas que ya no aplican y reclamar los listos.
      rows.filter((row) => row.status === 'pending').forEach((row) => { const a = appointment(row); if (a.status !== 'confirmed' || new Date(a.starts_at).getTime() <= now) { row.status = 'cancelled'; row.next_attempt_at = null; row.last_error = 'La cita ya no está confirmada o ya ocurrió.'; } });
      const picked = rows.filter((row) => row.status === 'pending' && (!row.next_attempt_at || new Date(row.next_attempt_at).getTime() <= now)).sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)).slice(0, 25);
      picked.forEach((row) => { row.status = 'processing'; row.attempt_count = Math.min(row.attempt_count + 1, 20); row.next_attempt_at = null; });
      return { data: picked.map((row) => { const a = appointment(row); const p = world.patients[a.patient_id]; return { reminder_id: row.id, appointment_id: a.id, reminder_type: row.reminder_type, scheduled_for: row.scheduled_for, attempt_count: row.attempt_count, starts_at: a.starts_at, patient_id: a.patient_id, patient_first_name: p.nombre, patient_last_name: p.apellido, service_name: a.service, professional_name: a.professional, branch_name: a.branch.name, branch_phone: a.branch.phone, branch_timezone: a.branch.timezone }; }), error: null };
    },
    auth: { getUser: async (token) => (token === 'owner-jwt' ? { data: { user: { id: T, email: 'dra@clinica.mx' } } } : token === 'staff-jwt' ? { data: { user: { id: STAFF, email: 'recepcion@clinica.mx' } } } : { data: null }) }
  };
}

// ── LANA falsa ──
function fakeFetch(world) {
  return async (url, init = {}) => {
    const target = String(url);
    assert.ok(target.startsWith(LANA_BASE), 'solo debe hablar con LANA: ' + target);
    const pathName = target.slice(LANA_BASE.length);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = init.body ? JSON.parse(init.body) : null;
    const call = { method: init.method || 'GET', path: pathName, headers, body };
    world.lana.calls.push(call);
    const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (world.lana.override) { const custom = world.lana.override(call, reply); if (custom) return custom; }
    if (call.method === 'GET' && pathName === '/inbox/whatsapp/templates') return reply(200, { templates: world.lana.templates });
    if (call.method === 'POST' && /^\/inbox\/conversations\/[^/]+\/scheduled$/.test(pathName)) {
      const item = { id: world.lana.nextId += 1, status: 'pendiente', send_at: body.send_at, type: body.type };
      world.lana.scheduled.push(item);
      return reply(201, { scheduled: item });
    }
    if (call.method === 'GET' && /\/scheduled$/.test(pathName)) return reply(200, { scheduled: world.lana.scheduled });
    if (call.method === 'POST' && /\/scheduled\/\d+\/cancel$/.test(pathName)) {
      const item = world.lana.scheduled.find((entry) => pathName.includes('/' + entry.id + '/'));
      if (!item) return reply(404, { error: 'No existe' });
      item.status = 'cancelado';
      return reply(200, { scheduled: item });
    }
    return reply(404, { error: 'ruta no simulada: ' + pathName });
  };
}

// ── Carga del archivo único desplegable ──
let handler = null; let world = null; let loadError = null;

async function load() {
  if (handler || loadError) return;
  try {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update('clave-de-lana-de-prueba', 'utf8'), cipher.final(), cipher.getAuthTag()]);
    globalThis.__lanaConfig = { api_key_ciphertext: encrypted.toString('base64'), api_key_iv: iv.toString('base64'), estado: 'conectada' };
    const env = { SUPABASE_URL: 'http://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', SMYL_LANA_ENCRYPTION_KEY: key.toString('base64'), SMYL_REMINDERS_CRON_SECRET: CRON };
    globalThis.Deno = { env: { get: (name) => env[name] }, serve: (fn) => { handler = fn; } };
    const source = fs.readFileSync(new URL('../docs/bundles/appointment-reminders.single-file.ts', import.meta.url), 'utf8')
      .replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'const createClient = globalThis.__createClient;');
    globalThis.__createClient = (_url, _key, options) => {
      const authorization = options && options.global && options.global.headers && options.global.headers.Authorization;
      return client(() => world, authorization ? authorization.replace(/^Bearer\s+/i, '') : 'service');
    };
    const file = path.join(os.tmpdir(), 'appointment-reminders-' + process.pid + '.mts');
    fs.writeFileSync(file, source);
    await import(pathToFileURL(file).href);
    fs.rmSync(file, { force: true });
  } catch (error) { loadError = error; }
}

function reset() {
  world = makeWorld();
  world.tables.camila_tenants[0].config = { consultorio: 'Clínica Dental Sonríe', integraciones: { lana: globalThis.__lanaConfig } };
  globalThis.fetch = fakeFetch(world);
}

const post = (body, headers = { authorization: 'Bearer owner-jwt' }) => handler(new Request('http://fn/', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const dispatch = async (extra = {}) => (await (await post({ action: 'dispatch', force: true, ...extra })).json());
const scheduledCalls = () => world.lana.calls.filter((call) => call.method === 'POST' && /\/scheduled$/.test(call.path));

async function scenario(t, fn) {
  await load();
  if (loadError) {
    if (!supportsTypeScript) { t.skip('Esta versión de Node no ejecuta TypeScript directamente.'); return; }
    throw loadError;
  }
  reset();
  await fn();
}

test('programa el recordatorio en LANA con la identidad de la clínica, la plantilla y los datos de la cita', async (t) => scenario(t, async () => {
  const start = Date.UTC(2099, 2, 4, 16, 30);
  const reminder = world.addReminder({ startsAt: start });
  const result = await dispatch();
  assert.equal(result.summary.scheduled, 1);
  const [call] = scheduledCalls();
  assert.equal(call.path, '/inbox/conversations/' + CONVERSATION + '/scheduled');
  assert.equal(call.headers.authorization, 'Bearer clave-de-lana-de-prueba');
  assert.equal(call.headers['x-smyl-actor-id'], T);
  assert.equal(call.headers['x-smyl-actor-role'], 'owner');
  assert.equal(call.headers['x-smyl-lana-contract-version'], '1.6');
  assert.equal(call.headers['idempotency-key'], reminder.id);
  assert.equal(call.body.type, 'template');
  assert.equal(call.body.template_id, TEMPLATE);
  assert.equal(call.body.send_at, new Date(start - 24 * HOUR).toISOString());
  assert.equal(call.body.template_variables[0], 'Ana');
  assert.match(call.body.template_variables[1], /^[a-zñáéíóú]+ 4 de marzo$/);
  assert.equal(call.body.template_variables[2], '10:30 am');
  assert.equal(call.body.template_variables[3], 'Clínica Dental Sonríe');
  const saved = world.reminder(reminder.id);
  assert.equal(saved.status, 'processing');
  assert.equal(saved.provider_reference, '5001');
  assert.equal(saved.delivery_channel, 'whatsapp');
  assert.equal(saved.provider_conversation_id, CONVERSATION);
  // Un segundo barrido no debe volver a programarlo.
  await dispatch();
  assert.equal(scheduledCalls().length, 1);
}));

test('un fallo de red se reintenta con la misma clave de idempotencia, sin duplicar el mensaje', async (t) => scenario(t, async () => {
  const reminder = world.addReminder();
  let attempt = 0;
  world.lana.override = (call, reply) => (call.method === 'POST' && /\/scheduled$/.test(call.path) && (attempt += 1) === 1 ? reply(503, { error: 'LANA no disponible' }) : null);
  const first = await dispatch();
  assert.equal(first.summary.waiting, 1);
  const waiting = world.reminder(reminder.id);
  assert.equal(waiting.status, 'pending');
  assert.equal(waiting.attempt_count, 1);
  assert.match(waiting.last_error, /LANA no disponible/);
  assert.ok(new Date(waiting.next_attempt_at).getTime() > Date.now());
  // Todavía no toca reintentar.
  await dispatch();
  assert.equal(scheduledCalls().length, 1);
  waiting.next_attempt_at = new Date(Date.now() - 1000).toISOString();
  const second = await dispatch();
  assert.equal(second.summary.scheduled, 1);
  const keys = scheduledCalls().map((call) => call.headers['idempotency-key']);
  assert.deepEqual(keys, [reminder.id, reminder.id]);
  assert.equal(world.reminder(reminder.id).provider_reference, '5001');
}));

test('un rechazo definitivo de LANA marca el recordatorio como fallido con su motivo', async (t) => scenario(t, async () => {
  const reminder = world.addReminder();
  world.lana.override = (call, reply) => (/\/scheduled$/.test(call.path) && call.method === 'POST' ? reply(422, { error: 'La plantilla no está aprobada.' }) : null);
  const result = await dispatch();
  assert.equal(result.summary.failed, 1);
  const saved = world.reminder(reminder.id);
  assert.equal(saved.status, 'failed');
  assert.equal(saved.last_error, 'La plantilla no está aprobada.');
  await dispatch();
  assert.equal(scheduledCalls().length, 1);
}));

test('después de cinco intentos con errores transitorios deja de reintentar', async (t) => scenario(t, async () => {
  const reminder = world.addReminder({ attempts: 4 });
  world.lana.override = (call, reply) => (/\/scheduled$/.test(call.path) && call.method === 'POST' ? reply(500, { error: 'Error interno' }) : null);
  await dispatch();
  assert.equal(world.reminder(reminder.id).status, 'failed');
}));

test('sin WhatsApp vinculado espera si aún no es la hora y falla si ya pasó', async (t) => scenario(t, async () => {
  world.tables.camila_lana_handoffs.length = 0;
  const early = world.addReminder();
  const overdue = world.addReminder({ startsAt: Date.now() + 10 * HOUR, dueAt: Date.now() - 14 * HOUR });
  const result = await dispatch();
  assert.equal(result.summary.waiting, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(world.reminder(early.id).status, 'pending');
  assert.match(world.reminder(early.id).last_error, /WhatsApp vinculada/);
  assert.ok(world.reminder(early.id).next_attempt_at);
  assert.equal(world.reminder(overdue.id).status, 'failed');
  assert.equal(scheduledCalls().length, 0);
  // Al vincular al paciente, el siguiente barrido lo programa.
  world.tables.camila_lana_handoffs.push({ tenant_id: T, patient_id: PATIENT, lana_channel: 'whatsapp', lana_conversation_id: CONVERSATION, updated_at: new Date().toISOString() });
  world.reminder(early.id).next_attempt_at = new Date(Date.now() - 1000).toISOString();
  await dispatch();
  assert.equal(scheduledCalls().length, 1);
}));

test('omite las citas a menos de dos horas y las ya canceladas', async (t) => scenario(t, async () => {
  const soon = world.addReminder({ startsAt: Date.now() + 90 * 60 * 1000, dueAt: Date.now() - 22 * HOUR });
  const cancelled = world.addReminder({ appointmentStatus: 'cancelled' });
  await dispatch();
  assert.equal(world.reminder(soon.id).status, 'cancelled');
  assert.match(world.reminder(soon.id).last_error, /menos de 2 horas/);
  assert.equal(world.reminder(cancelled.id).status, 'cancelled');
  assert.equal(scheduledCalls().length, 0);
}));

test('cancela en LANA los recordatorios de citas movidas o canceladas, y reintenta si LANA falla', async (t) => scenario(t, async () => {
  const reminder = world.addReminder({ status: 'cancelled', reference: '777', cancelRequired: true });
  world.lana.scheduled.push({ id: 777, status: 'pendiente' });
  world.lana.override = (call, reply) => (/\/cancel$/.test(call.path) ? (world.lana.failCancel ? reply(500, { error: 'caído' }) : null) : null);
  world.lana.failCancel = true;
  await dispatch();
  assert.equal(world.reminder(reminder.id).provider_cancel_required, true, 'si LANA falla se vuelve a intentar');
  world.lana.failCancel = false;
  const result = await dispatch();
  assert.equal(result.summary.cancelled_in_lana, 1);
  const cancel = world.lana.calls.filter((call) => /\/scheduled\/777\/cancel$/.test(call.path)).pop();
  assert.equal(cancel.path, '/inbox/conversations/' + CONVERSATION + '/scheduled/777/cancel');
  assert.equal(cancel.headers['x-smyl-actor-id'], T);
  assert.equal(world.reminder(reminder.id).provider_cancel_required, false);
  assert.equal(world.lana.scheduled[0].status, 'cancelado');
}));

test('si LANA ya no tiene el envío (404) o ya salió, la cancelación se da por hecha', async (t) => scenario(t, async () => {
  const reminder = world.addReminder({ status: 'cancelled', reference: '888', cancelRequired: true });
  await dispatch();
  assert.equal(world.reminder(reminder.id).provider_cancel_required, false);
}));

test('sincroniza con LANA el resultado de los envíos que ya debían salir', async (t) => scenario(t, async () => {
  const past = { startsAt: Date.now() + 5 * HOUR, dueAt: Date.now() - HOUR };
  const sent = world.addReminder({ ...past, status: 'processing', reference: '1' });
  const failed = world.addReminder({ ...past, status: 'processing', reference: '2' });
  const cancelled = world.addReminder({ ...past, status: 'processing', reference: '3' });
  const missing = world.addReminder({ ...past, status: 'processing', reference: '4' });
  const future = world.addReminder({ status: 'processing', reference: '5' });
  world.lana.scheduled.push({ id: 1, status: 'enviado', sent_at: '2026-10-20T15:00:00.000Z' }, { id: 2, status: 'dead_letter', last_error: 'Meta rechazó la plantilla' }, { id: 3, status: 'cancelado' }, { id: 5, status: 'pendiente' });
  await dispatch();
  assert.equal(world.reminder(sent.id).status, 'sent');
  assert.equal(world.reminder(sent.id).sent_at, '2026-10-20T15:00:00.000Z');
  assert.equal(world.reminder(failed.id).status, 'failed');
  assert.equal(world.reminder(failed.id).last_error, 'Meta rechazó la plantilla');
  assert.equal(world.reminder(cancelled.id).status, 'cancelled');
  assert.equal(world.reminder(missing.id).status, 'processing');
  assert.equal(world.reminder(future.id).status, 'processing', 'los que aún no llegan a su hora no se sincronizan');
}));

test('si la cita se mueve mientras LANA responde, el envío recién programado se cancela en LANA', async (t) => scenario(t, async () => {
  const reminder = world.addReminder();
  world.lana.override = (call) => {
    if (call.method === 'POST' && /\/scheduled$/.test(call.path)) world.reminder(reminder.id).status = 'cancelled';
    return null;
  };
  await dispatch();
  const cancels = world.lana.calls.filter((call) => /\/cancel$/.test(call.path));
  assert.equal(cancels.length, 1);
  assert.equal(world.lana.scheduled[0].status, 'cancelado');
  assert.equal(world.reminder(reminder.id).status, 'cancelled');
}));

test('con los recordatorios desactivados no envía nada, y al apagarlos cancela lo que estaba en cola', async (t) => scenario(t, async () => {
  const pending = world.addReminder();
  const scheduled = world.addReminder({ status: 'processing', reference: '42' });
  world.lana.scheduled.push({ id: 42, status: 'pendiente' });
  const off = await post({ action: 'save_settings', enabled: false, template_id: TEMPLATE, variables: [] });
  const body = await off.json();
  assert.equal(off.status, 200);
  assert.equal(body.cancelled_in_lana, 1);
  assert.equal(world.reminder(pending.id).status, 'cancelled');
  assert.equal(world.reminder(scheduled.id).status, 'cancelled');
  assert.equal(world.lana.scheduled[0].status, 'cancelado');
  assert.equal(world.tables.smyl_reminder_settings[0].enabled, false);
  assert.deepEqual(await dispatch(), { skipped: 'disabled' });
  assert.equal(scheduledCalls().length, 0);
}));

test('apagar los recordatorios siempre funciona, aunque LANA no responda o la plantilla ya no exista', async (t) => scenario(t, async () => {
  const queued = world.addReminder();
  world.lana.templates = [];
  world.lana.override = (call, reply) => (call.path === '/inbox/whatsapp/templates' ? reply(500, { error: 'LANA caído' }) : null);
  const off = await post({ action: 'save_settings', enabled: false, template_id: TEMPLATE, variables: [{ source: 'basura' }] });
  assert.equal(off.status, 200);
  assert.equal(world.tables.smyl_reminder_settings[0].enabled, false);
  assert.equal(world.reminder(queued.id).status, 'cancelled');
  assert.equal(world.tables.smyl_reminder_settings[0].template_id, TEMPLATE, 'conserva la plantilla elegida para volver a activar');
}));

test('guardar la configuración valida la plantilla contra el catálogo de LANA y envía lo pendiente', async (t) => scenario(t, async () => {
  world.addReminder();
  const variables = [{ source: 'patient_first_name' }, { source: 'date' }, { source: 'time' }, { source: 'clinic' }];
  const wrongCount = await post({ action: 'save_settings', enabled: true, template_id: TEMPLATE, variables: variables.slice(0, 2) });
  assert.equal(wrongCount.status, 400);
  assert.match((await wrongCount.json()).error, /necesita 4 variables/);
  const unknown = await post({ action: 'save_settings', enabled: true, template_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', variables });
  assert.equal(unknown.status, 400);
  const badSource = await post({ action: 'save_settings', enabled: true, template_id: TEMPLATE, variables: [{ source: 'contrasena' }, ...variables.slice(1)] });
  assert.equal(badSource.status, 400);
  const noTemplate = await post({ action: 'save_settings', enabled: true, variables: [] });
  assert.equal(noTemplate.status, 400);
  const ok = await post({ action: 'save_settings', enabled: true, template_id: TEMPLATE, variables });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).summary.scheduled, 1);
  const templatesCall = world.lana.calls.find((call) => call.path === '/inbox/whatsapp/templates');
  assert.equal(templatesCall.headers['x-smyl-actor-id'], T, 'LANA exige la identidad también en lecturas');
  assert.equal(templatesCall.headers['x-smyl-actor-role'], 'owner');
}));

test('los permisos se validan en el servidor', async (t) => scenario(t, async () => {
  const staff = { authorization: 'Bearer staff-jwt' };
  const read = await post({ action: 'settings' }, staff);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).can_configure, false);
  assert.equal(world.lana.calls.length, 0, 'quien no puede configurar no consulta plantillas');
  const write = await post({ action: 'save_settings', enabled: true, template_id: TEMPLATE, variables: [] }, staff);
  assert.equal(write.status, 403);
  world.permissions['staff-jwt'] = [];
  assert.equal((await post({ action: 'settings' }, staff)).status, 403);
  assert.equal((await post({ action: 'settings' }, { authorization: 'Bearer nadie' })).status, 401);
  assert.equal((await post({ action: 'settings' }, {})).status, 401);
}));

test('el modo cron exige el secreto y procesa solo las clínicas con recordatorios activos', async (t) => scenario(t, async () => {
  world.addReminder();
  assert.equal((await post({}, { 'x-smyl-cron-secret': 'incorrecto' })).status, 401);
  assert.equal((await post({}, { 'x-smyl-cron-secret': 'y'.repeat(40) })).status, 401);
  const run = await post({}, { 'x-smyl-cron-secret': CRON });
  assert.equal(run.status, 200);
  const body = await run.json();
  assert.equal(body.tenants, 1);
  assert.equal(body.results[T].scheduled, 1);
  world.tables.smyl_reminder_settings[0].enabled = false;
  assert.equal((await (await post({}, { 'x-smyl-cron-secret': CRON })).json()).tenants, 0);
}));

test('sin la clave de cifrado válida de LANA no se envía nada y el recordatorio queda pendiente de reintento', async (t) => scenario(t, async () => {
  const reminder = world.addReminder();
  world.tables.camila_tenants[0].config.integraciones.lana = { ...globalThis.__lanaConfig, estado: 'requiere_atencion' };
  const result = await dispatch();
  assert.equal(result.summary.waiting, 1);
  assert.match(world.reminder(reminder.id).last_error, /LANA todavía no está conectada/);
  assert.equal(scheduledCalls().length, 0);
}));
