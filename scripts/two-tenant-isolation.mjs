import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const REQUIRED_CONFIRMATION = 'DISPOSABLE_TWO_TENANT_PROJECT';
const PRODUCTION_PROJECT_REF = 'rpxshsiwoxdbuevjjpfw';
const env = process.env;

function stop(message, code = 1) {
  console.error(`ABORTADO · ${message}`);
  process.exit(code);
}

function requireValue(name) {
  const value = String(env[name] || '').trim();
  if (!value) stop(`Falta ${name}.`);
  return value;
}

const baseUrl = requireValue('SMYL_ISOLATION_PROJECT_URL').replace(/\/$/, '');
const anonKey = requireValue('SMYL_ISOLATION_ANON_KEY');
const accountA = { email: requireValue('SMYL_ISOLATION_USER_A_EMAIL'), password: requireValue('SMYL_ISOLATION_USER_A_PASSWORD') };
const accountB = { email: requireValue('SMYL_ISOLATION_USER_B_EMAIL'), password: requireValue('SMYL_ISOLATION_USER_B_PASSWORD') };
const cleanObjectB = String(env.SMYL_ISOLATION_CLEAN_OBJECT_B || '').trim();
const reportArg = process.argv.find((arg) => arg.startsWith('--report='));

if (env.SMYL_ISOLATION_CONFIRM !== REQUIRED_CONFIRMATION) stop(`Define SMYL_ISOLATION_CONFIRM=${REQUIRED_CONFIRMATION}.`);
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl)) stop('La URL debe ser un proyecto Supabase HTTPS explícito.');
if (baseUrl.includes(PRODUCTION_PROJECT_REF)) stop('El arnés nunca puede ejecutarse contra producción.');
if (accountA.email.toLowerCase() === accountB.email.toLowerCase()) stop('Las cuentas A y B deben ser distintas.');

const results = [];
const record = (area, scenario, status, detail) => results.push({ area, scenario, status, detail });
const runId = randomUUID();
const marker = `SMYL-SEC-${runId.slice(0, 8)}`;

async function jsonRequest(pathname, { token, method = 'GET', body, prefer } = {}) {
  const headers = { apikey: anonKey, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { ok: response.ok, status: response.status, data };
}

async function signIn(account) {
  const response = await jsonRequest('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: account.email, password: account.password },
  });
  if (!response.ok || !response.data?.access_token || !response.data?.user?.id) stop('No fue posible autenticar una cuenta sintética.');
  return { token: response.data.access_token, userId: response.data.user.id };
}

async function tenantFor(token) {
  const response = await jsonRequest('/rest/v1/rpc/smyl_current_tenant', { token, method: 'POST', body: {} });
  if (!response.ok || typeof response.data !== 'string') stop('No fue posible resolver la clínica desde la sesión.');
  return response.data;
}

async function createPatient(session, tenantId, suffix) {
  const id = randomUUID();
  const response = await jsonRequest('/rest/v1/camila_pacientes', {
    token: session.token, method: 'POST', prefer: 'return=representation',
    body: { id, tenant_id: tenantId, nombre: marker, apellido: suffix, email: '', telefono: '', notas: 'Dato sintético para aislamiento; proyecto desechable.' },
  });
  if (!response.ok || !Array.isArray(response.data) || response.data[0]?.id !== id) stop(`No fue posible crear el paciente sintético ${suffix}.`);
  return id;
}

async function createInventoryItem(session, tenantId, suffix) {
  const id = randomUUID();
  const response = await jsonRequest('/rest/v1/smyl_inventory_items', {
    token: session.token, method: 'POST', prefer: 'return=representation',
    body: { id, tenant_id: tenantId, sku: `${marker}-${suffix}`, name: `Material sintético ${suffix}`, category: 'material', unit: 'pieza', description: 'Prueba desechable', track_lot: false, track_expiry: false, track_serial: false, requires_patient_trace: false },
  });
  if (!response.ok || !Array.isArray(response.data) || response.data[0]?.id !== id) stop(`No fue posible crear el inventario sintético ${suffix}.`);
  return id;
}

async function expectHidden(table, id, token, area) {
  const response = await jsonRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id`, { token });
  const pass = response.ok && Array.isArray(response.data) && response.data.length === 0;
  record(area, 'lectura cruzada', pass ? 'PASS' : 'FAIL', pass ? 'La consulta no devolvió filas.' : `Respuesta inesperada ${response.status}.`);
}

async function expectCrossUpdateBlocked(table, id, token, body, area) {
  const response = await jsonRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { token, method: 'PATCH', prefer: 'return=representation', body });
  const pass = (!response.ok) || (Array.isArray(response.data) && response.data.length === 0);
  record(area, 'escritura cruzada', pass ? 'PASS' : 'FAIL', pass ? 'No se modificó ninguna fila.' : 'La actualización devolvió una fila ajena.');
}

async function expectForeignInsertBlocked(table, token, body, area) {
  const response = await jsonRequest(`/rest/v1/${table}`, { token, method: 'POST', prefer: 'return=representation', body });
  record(area, 'inserción con tenant falsificado', response.ok ? 'FAIL' : 'PASS', response.ok ? 'El servidor aceptó el tenant ajeno.' : `Rechazada con HTTP ${response.status}.`);
}

async function realtimeProbe(listener, updater, targetId, shouldReceive) {
  if (typeof WebSocket !== 'function') return { status: 'SKIP', detail: 'El runtime no ofrece WebSocket.' };
  const wsUrl = `${baseUrl.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
  const socket = new WebSocket(wsUrl);
  let received = false;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Realtime no abrió conexión.')), 6000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Realtime rechazó conexión.')); }, { once: true });
    });
    socket.send(JSON.stringify({ topic: `realtime:public:camila_pacientes:id=eq.${targetId}`, event: 'phx_join', ref: '1', payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'camila_pacientes', filter: `id=eq.${targetId}` }] }, access_token: listener.token } }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data));
        const row = message?.payload?.data?.record || message?.payload?.data?.old_record;
        if (message.event === 'postgres_changes' && row?.id === targetId) received = true;
      } catch {}
    });
    await jsonRequest(`/rest/v1/camila_pacientes?id=eq.${targetId}`, { token: updater.token, method: 'PATCH', prefer: 'return=minimal', body: { apellido: `RT-${Date.now()}` } });
    await new Promise((resolve) => setTimeout(resolve, 2800));
    return received === shouldReceive
      ? { status: 'PASS', detail: shouldReceive ? 'El evento propio fue visible.' : 'El evento de otra clínica no fue entregado.' }
      : { status: 'FAIL', detail: shouldReceive ? 'No llegó el evento de control propio.' : 'Se recibió un evento de otra clínica.' };
  } catch (error) {
    return { status: 'FAIL', detail: error.message };
  } finally {
    socket.close();
  }
}

async function storageProbe(sessionA, sessionB, objectPath) {
  if (!objectPath) return { status: 'SKIP', detail: 'Falta una ruta limpia sintética de la clínica B.' };
  const encoded = objectPath.split('/').map(encodeURIComponent).join('/');
  const fetchObject = (token) => fetch(`${baseUrl}/storage/v1/object/authenticated/smyl-clinical-files/${encoded}`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  const own = await fetchObject(sessionB.token);
  const foreign = await fetchObject(sessionA.token);
  const pass = own.ok && !foreign.ok;
  return { status: pass ? 'PASS' : 'FAIL', detail: pass ? 'La clínica propietaria leyó el objeto y la clínica ajena fue rechazada.' : `Control propio ${own.status}; intento ajeno ${foreign.status}.` };
}

const sessionA = await signIn(accountA);
const sessionB = await signIn(accountB);
const tenantA = await tenantFor(sessionA.token);
const tenantB = await tenantFor(sessionB.token);
if (!tenantA || !tenantB || tenantA === tenantB || sessionA.userId === sessionB.userId) stop('Las cuentas no representan dos clínicas independientes.');

const patientA = await createPatient(sessionA, tenantA, 'A');
const patientB = await createPatient(sessionB, tenantB, 'B');
await expectHidden('camila_pacientes', patientB, sessionA.token, 'Pacientes');
await expectCrossUpdateBlocked('camila_pacientes', patientB, sessionA.token, { notas: 'intento cruzado' }, 'Pacientes');
await expectForeignInsertBlocked('camila_pacientes', sessionA.token, { id: randomUUID(), tenant_id: tenantB, nombre: marker, apellido: 'Falso' }, 'Pacientes');

const rpc = await jsonRequest('/rest/v1/rpc/smyl_save_clinical_plan_v2', { token: sessionA.token, method: 'POST', body: { p_tenant_id: tenantB, p_patient_id: patientB, p_expected_revision: 0, p_document: { schema: 2, reason: '', background: '', assessment: '', treatments: [] }, p_review: false } });
record('RPC clínica', 'tenant ajeno en parámetros', rpc.ok ? 'FAIL' : 'PASS', rpc.ok ? 'La RPC aceptó el tenant ajeno.' : `Rechazada con HTTP ${rpc.status}.`);

await createInventoryItem(sessionA, tenantA, 'A');
const itemB = await createInventoryItem(sessionB, tenantB, 'B');
await expectHidden('smyl_inventory_items', itemB, sessionA.token, 'Inventario');
await expectCrossUpdateBlocked('smyl_inventory_items', itemB, sessionA.token, { description: 'intento cruzado' }, 'Inventario');
await expectForeignInsertBlocked('smyl_inventory_items', sessionA.token, { id: randomUUID(), tenant_id: tenantB, sku: `${marker}-F`, name: 'Material falso', category: 'material', unit: 'pieza', track_lot: false }, 'Inventario');

const ownRealtime = await realtimeProbe(sessionA, sessionA, patientA, true);
record('Realtime', 'evento propio de control', ownRealtime.status, ownRealtime.detail);
if (ownRealtime.status === 'PASS') {
  const crossRealtime = await realtimeProbe(sessionA, sessionB, patientB, false);
  record('Realtime', 'evento entre clínicas', crossRealtime.status, crossRealtime.detail);
} else record('Realtime', 'evento entre clínicas', 'SKIP', 'Sin control positivo no se afirma aislamiento Realtime.');

const storage = await storageProbe(sessionA, sessionB, cleanObjectB);
record('Storage', 'objeto limpio de clínica B', storage.status, storage.detail);

const failed = results.filter((item) => item.status === 'FAIL');
const skipped = results.filter((item) => item.status === 'SKIP');
const report = {
  schema: 1,
  run_at: new Date().toISOString(),
  run_id: runId,
  project_fingerprint: createHash('sha256').update(new URL(baseUrl).hostname).digest('hex').slice(0, 16),
  synthetic_only: true,
  totals: { pass: results.filter((item) => item.status === 'PASS').length, fail: failed.length, skip: skipped.length },
  decision: failed.length ? 'BLOCKED' : skipped.length ? 'INCOMPLETE' : 'PASS',
  results,
};

console.log(JSON.stringify(report, null, 2));
if (reportArg) {
  const destination = path.resolve(reportArg.slice('--report='.length));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
process.exitCode = failed.length ? 1 : skipped.length ? 2 : 0;
