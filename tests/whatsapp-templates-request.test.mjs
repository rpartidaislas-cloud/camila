// Simulación de la Edge Function whatsapp-templates (ver y solicitar plantillas de WhatsApp por LANA).
// Ejecuta el archivo único desplegable con una base en memoria y una LANA falsa con el cifrado real.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const catalog = require('../smyl-template-catalog.js');

const T = '11111111-1111-4111-8111-111111111111';
const STAFF = '99999999-9999-4999-8999-999999999999';
const LANA_BASE = 'https://lgjdzaqjrmmzyrenevfm.supabase.co/functions/v1/camila-api';
const supportsTypeScript = Boolean(process.features && process.features.typescript) || Number(process.versions.node.split('.')[0]) >= 23;

let handler = null; let loadError = null; let world = null;

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; }
  select() { return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  maybeSingle() { this.single = true; return this; }
  then(resolve) {
    const rows = (this.db.tables[this.table] || []).filter((row) => this.filters.every((filter) => filter(row)));
    resolve({ data: this.single ? (rows[0] ? { ...rows[0] } : null) : rows, error: null });
  }
}

function makeWorld() {
  return {
    tables: {
      camila_tenants: [{ id: T, nombre: 'Dra. Torres', config: { integraciones: { lana: globalThis.__lanaConfig } } }],
      camila_usuarios: [{ id: STAFF, tenant_id: T, rol: 'recepcion', activo: true }],
    },
    permissions: { 'staff-jwt': ['messages.read'], 'nada-jwt': [] },
    lana: { calls: [], override: null },
  };
}

function client(jwt) {
  return {
    from: (table) => new Query(world, table),
    rpc: async (name, args) => ({ data: name === 'smyl_has_permission' && (world.permissions[jwt] || []).includes(args.p_permission), error: null }),
    auth: { getUser: async (token) => ({ data: token === 'owner-jwt' ? { user: { id: T, email: 'dra@clinica.mx' } } : token === 'staff-jwt' ? { user: { id: STAFF, email: 'recepcion@clinica.mx' } } : token === 'nada-jwt' ? { user: { id: STAFF, email: 'x@clinica.mx' } } : null }) },
  };
}

function fakeFetch() {
  return async (url, init = {}) => {
    const target = String(url);
    assert.ok(target.startsWith(LANA_BASE), 'solo debe hablar con LANA: ' + target);
    const call = { method: init.method || 'GET', path: target.slice(LANA_BASE.length), headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(init.body) : null };
    world.lana.calls.push(call);
    const reply = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (world.lana.override) return world.lana.override(call, reply);
    if (call.method === 'GET') return reply(200, { ok: true, templates: [
      { id: 'a', name: 'recordatorio_cita_24h_v1', language: 'es_MX', category: 'UTILITY', status: 'APPROVED', rejection_reason: null, access_token: 'no-debe-salir' },
      { id: 'b', name: 'cita_confirmada_v1', language: 'es_MX', category: 'UTILITY', status: 'PENDING', rejection_reason: null },
      { id: 'c', name: 'promo_blanqueamiento_v1', language: 'es_MX', category: 'MARKETING', status: 'REJECTED', rejection_reason: 'Contenido promocional no permitido' },
    ] });
    return reply(201, { ok: true, existing: false, template: { status: 'PENDING', meta_template_id: 'interno' } });
  };
}

async function load() {
  if (handler || loadError) return;
  try {
    const key = crypto.randomBytes(32); const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update('clave-de-lana-de-prueba', 'utf8'), cipher.final(), cipher.getAuthTag()]);
    globalThis.__lanaConfig = { api_key_ciphertext: encrypted.toString('base64'), api_key_iv: iv.toString('base64'), estado: 'conectada' };
    const env = { SUPABASE_URL: 'http://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', SMYL_LANA_ENCRYPTION_KEY: key.toString('base64') };
    globalThis.Deno = { env: { get: (name) => env[name] }, serve: (fn) => { handler = fn; } };
    globalThis.__createClient = (_url, _key, options) => {
      const authorization = options && options.global && options.global.headers && options.global.headers.Authorization;
      return client(authorization ? authorization.replace(/^Bearer\s+/i, '') : 'service');
    };
    const source = fs.readFileSync(new URL('../docs/bundles/whatsapp-templates.single-file.ts', import.meta.url), 'utf8')
      .replace('import { createClient } from "npm:@supabase/supabase-js@2";', 'const createClient = globalThis.__createClient;');
    const file = path.join(os.tmpdir(), 'whatsapp-templates-' + process.pid + '.mts');
    fs.writeFileSync(file, source);
    await import(file);
    fs.rmSync(file, { force: true });
  } catch (error) { loadError = error; }
}

async function scenario(t, fn) {
  await load();
  if (loadError) { if (!supportsTypeScript) { t.skip('Esta versión de Node no ejecuta TypeScript directamente.'); return; } throw loadError; }
  world = makeWorld();
  globalThis.fetch = fakeFetch();
  await fn();
}

const call = (body, token = 'owner-jwt') => handler(new Request('http://fn/', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }));
const posts = () => world.lana.calls.filter((entry) => entry.method === 'POST');

test('lista el estado de las plantillas con la identidad de quien consulta y sin filtrar campos extra', async (t) => scenario(t, async () => {
  const response = await call({ action: 'list' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.can_request, true);
  assert.deepEqual(data.templates.map((item) => [item.name, item.status]), [['recordatorio_cita_24h_v1', 'APPROVED'], ['cita_confirmada_v1', 'PENDING'], ['promo_blanqueamiento_v1', 'REJECTED']]);
  assert.equal(data.templates[2].rejection_reason, 'Contenido promocional no permitido');
  assert.doesNotMatch(JSON.stringify(data), /no-debe-salir|access_token/);
  const [lana] = world.lana.calls;
  assert.equal(lana.path, '/inbox/whatsapp/templates?status=all');
  assert.equal(lana.headers.authorization, 'Bearer clave-de-lana-de-prueba');
  assert.equal(lana.headers['x-smyl-actor-id'], T);
  assert.equal(lana.headers['x-smyl-actor-role'], 'owner');
}));

test('quien solo tiene permiso de lectura puede ver el estado pero no solicitar; sin permiso no ve nada', async (t) => scenario(t, async () => {
  const list = await (await call({ action: 'list' }, 'staff-jwt')).json();
  assert.equal(list.can_request, false);
  assert.equal(world.lana.calls[0].headers['x-smyl-actor-role'], 'staff');
  const request = await call({ action: 'request', template_id: 'cita_confirmada_v1' }, 'staff-jwt');
  assert.equal(request.status, 403);
  assert.equal((await request.json()).code, 'owner_required');
  assert.equal(posts().length, 0);
  assert.equal((await call({ action: 'list' }, 'nada-jwt')).status, 403);
  assert.equal((await call({ action: 'list' }, null)).status, 401);
  assert.equal((await call({ action: 'list' }, 'invalido')).status, 401);
}));

test('solicitar manda a LANA exactamente el texto del catálogo de SMYL, con ejemplos e idempotencia', async (t) => scenario(t, async () => {
  const template = catalog.TEMPLATES.find((item) => item.id === 'recordatorio_cita_24h_v1');
  const response = await call({ action: 'request', template_id: template.id });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, existing: false, status: 'PENDING' });
  const [sent] = posts();
  assert.equal(sent.path, '/inbox/whatsapp/templates');
  assert.match(sent.headers['idempotency-key'], /^[0-9a-f-]{36}$/);
  assert.equal(sent.headers['x-smyl-actor-role'], 'owner');
  assert.deepEqual(sent.body, { name: template.id, category: 'UTILITY', language: 'es_MX', body: template.body, examples: template.variables.map((variable) => variable.example) });
}));

test('una plantilla de Marketing viaja con su pie de baja y sus botones', async (t) => scenario(t, async () => {
  const template = catalog.TEMPLATES.find((item) => item.id === 'limpieza_semestral_v1');
  assert.equal((await call({ action: 'request', template_id: template.id })).status, 200);
  const [sent] = posts();
  assert.equal(sent.body.category, 'MARKETING');
  assert.match(sent.body.footer, /BAJA/);
  assert.deepEqual(sent.body.buttons, template.buttons);
}));

test('nunca acepta texto libre: solo plantillas del catálogo, aunque el navegador mande otro contenido', async (t) => scenario(t, async () => {
  const unknown = await call({ action: 'request', template_id: 'mi_plantilla_inventada', body: 'Compra ya con 90% de descuento', category: 'MARKETING' });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).code, 'unknown_template');
  assert.equal(posts().length, 0);
  const forged = await call({ action: 'request', template_id: 'cita_confirmada_v1', body: 'Texto manipulado {{1}}', category: 'MARKETING', footer: 'x', buttons: [{ type: 'URL', text: 'x' }], name: 'otro_nombre' });
  assert.equal(forged.status, 200);
  const [sent] = posts();
  const original = catalog.TEMPLATES.find((item) => item.id === 'cita_confirmada_v1');
  assert.equal(sent.body.name, 'cita_confirmada_v1');
  assert.equal(sent.body.body, original.body);
  assert.equal(sent.body.category, 'UTILITY');
  assert.equal(sent.body.footer, undefined);
  assert.equal(sent.body.buttons, undefined);
  assert.equal((await call({ action: 'request' })).status, 400);
  assert.equal((await call({ action: 'otra' })).status, 400);
}));

test('traduce las respuestas de LANA a mensajes claros y no confunde errores de cliente con caídas', async (t) => scenario(t, async () => {
  const cases = [
    [403, { error: 'x', code: 'owner_required' }, 403, /propietario/],
    [409, { error: 'x', code: 'whatsapp_not_connected' }, 409, /Conecta WhatsApp/],
    [409, { error: 'x', code: 'template_name_taken' }, 409, /ya tiene una plantilla/],
    [429, { error: 'x', code: 'template_rate_limited' }, 429, /última hora/],
    [422, { error: 'Meta rechazó la plantilla: contenido no permitido', code: 'meta_rejected' }, 422, /Meta rechazó la plantilla: contenido no permitido/],
    [500, { error: 'boom' }, 502, /boom|LANA/],
    [502, { error: 'Meta no respondió a tiempo.', code: 'meta_unreachable' }, 502, /Meta no respondió/],
  ];
  for (const [lanaStatus, payload, expectedStatus, message] of cases) {
    world.lana.override = (_call, reply) => reply(lanaStatus, payload);
    const response = await call({ action: 'request', template_id: 'cita_confirmada_v1' });
    assert.equal(response.status, expectedStatus, JSON.stringify(payload));
    assert.match((await response.json()).error, message);
  }
}));

test('reconoce una solicitud repetida y avisa si LANA no está conectada o no responde', async (t) => scenario(t, async () => {
  world.lana.override = (_call, reply) => reply(200, { ok: true, existing: true, template: { status: 'APPROVED' } });
  assert.deepEqual(await (await call({ action: 'request', template_id: 'cita_confirmada_v1' })).json(), { ok: true, existing: true, status: 'APPROVED' });
  world.lana.override = null;
  world.tables.camila_tenants[0].config.integraciones.lana = { ...globalThis.__lanaConfig, estado: 'requiere_atencion' };
  const disconnected = await call({ action: 'list' });
  assert.equal(disconnected.status, 502);
  assert.match((await disconnected.json()).error, /LANA todavía no está conectada/);
  world.tables.camila_tenants[0].config.integraciones.lana = globalThis.__lanaConfig;
  globalThis.fetch = async () => { throw new Error('red caída'); };
  const down = await call({ action: 'request', template_id: 'cita_confirmada_v1' });
  assert.equal(down.status, 502);
  assert.equal((await down.json()).code, 'lana_unreachable');
}));
