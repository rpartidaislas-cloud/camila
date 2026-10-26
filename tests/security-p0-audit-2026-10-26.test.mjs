// Auditoría 2026-10-26: P0-1 (alta como staff), P0-2 (XSS almacenado) y P0-3 (vista pública).
// Las migraciones se validaron además contra un Postgres real en memoria (PGlite) durante el
// desarrollo; estas pruebas fijan el contrato en el repo sin depender de un servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const trigger = read('supabase/migrations/20261026210000_smyl_security_staff_invitations.sql');
const vista = read('supabase/migrations/20261026200000_smyl_security_public_tenant_view.sql');
const app = read('app.html');
const lead = read('supabase/functions/guardar-lead-prospecto/index.ts');
const invite = read('supabase/functions/invite-staff/index.ts');

test('P0-1: el staff solo se crea si hay una invitación vigente del servidor', () => {
  assert.match(trigger, /create table if not exists public\.camila_invitaciones/);
  assert.match(trigger, /alter table public\.camila_invitaciones enable row level security;/);
  assert.match(trigger, /revoke all on public\.camila_invitaciones from public, anon, authenticated;/);
  assert.match(trigger, /i\.consumed_at is null[\s\S]*i\.expires_at > now\(\)/);
  // el INSERT de staff está dentro de `if invitacion_id is not null`
  const dentro = trigger.slice(trigger.indexOf('if invitacion_id is not null then'), trigger.indexOf('-- Sin invitación vigente'));
  assert.match(dentro, /insert into public\.camila_usuarios[\s\S]*'staff'/);
  // y no hay otro INSERT de staff fuera de esa rama
  assert.equal((trigger.match(/'staff'/g) || []).length, 1);
  // un metadato que no es UUID no aborta el alta
  assert.match(trigger, /~\* '\^\[0-9a-f\]\{8\}/);
});

test('P0-1: invite-staff registra la invitación antes de invitar y la retira si falla', () => {
  const registro = invite.indexOf('.from("camila_invitaciones")\n    .insert(');
  const invitar = invite.indexOf('inviteUserByEmail(email');
  assert.ok(registro > -1 && invitar > registro, 'la invitación se registra antes de inviteUserByEmail');
  assert.match(invite, /if \(inviteErr\) \{[\s\S]*delete\(\)\.eq\("id", invitacion\.id\)/);
});

test('P0-3: la vista pública solo expone sim y precios, no config completo', () => {
  assert.match(vista, /jsonb_build_object\(\s*'sim', config -> 'sim',\s*'precios', config -> 'precios'\s*\)/);
  assert.doesNotMatch(vista, /select\s+id,\s*nombre,\s*config\s+from/i);
  assert.match(vista, /grant select on public\.camila_tenants_publico to anon, authenticated;/);
  // Los clientes públicos solo leen estas dos llaves
  for (const file of ['simulacion.html', 'simulacion-rapida.html']) {
    const html = read(file);
    assert.match(html, /config\.sim/);
    assert.match(html, /config\.precios/);
    assert.doesNotMatch(html, /config\.integraciones/);
  }
});

test('P0-2: el Historial y el detalle del caso no interpolan datos del prospecto sin escapar', () => {
  assert.match(app, /function smylNum\(value\)/);
  assert.match(app, /smylEsc\(c\.telefono\)/);
  assert.doesNotMatch(app, /\+ c\.telefono \+ '<\/div>'/);
  assert.match(app, /var score = smylNum\(c\.score\);\n    var total = smylNum\(c\.total_cotizacion\);/);
  assert.doesNotMatch(app, /\(item\.subtotal\|\|0\)\.toLocaleString\(\)/);
  assert.doesNotMatch(app, /\(item\.precio_unit\|\|0\)\.toLocaleString\(\)/);
  assert.doesNotMatch(app, /'<tr><td>' \+ c\.procedimiento \+ '<\/td>/);
});

// Ejecuta de verdad el validador de la función pública (sin Deno).
function cargarValidador() {
  const inicio = lead.indexOf('const CAMPOS_PERMITIDOS');
  const fin = lead.indexOf('function jsonError(');
  const js = stripTypeScriptTypes(lead.slice(inicio, fin));
  return new Function(js + '\nreturn validarFila;')();
}

test('P0-2: guardar-lead-prospecto valida tipos y descarta HTML en teléfono y números', () => {
  const validar = cargarValidador();
  const base = { id: '3f2b8c1e-0000-4000-8000-000000000001', nombre_paciente: 'Ana', score: 82, total_cotizacion: 12500, telefono: '+52 (33) 1234-5678' };
  const ok = validar(base);
  assert.equal(ok.error, undefined);
  assert.equal(ok.fila.telefono, '+52 (33) 1234-5678');

  for (const malo of [
    { telefono: '<img src=x onerror=alert(1)>' },
    { telefono: '3312345678"><script>' },
    { score: '<svg onload=alert(1)>' },
    { score: 101 },
    { score: true },
    { total_cotizacion: 'abc' },
    { total_cotizacion: -1 },
    { email: 'x@y.z"><img src=x>' },
    { id: 'no-es-uuid' },
    { fotos_count: 9999 },
    { nombre_paciente: 'x'.repeat(201) },
    { diagnostico: 12345 },
  ]) {
    assert.ok(validar({ ...base, ...malo }).error, 'debe rechazar ' + JSON.stringify(malo).slice(0, 60));
  }
});

test('P0-2: el validador ignora campos fuera de la lista y el tenant_id del body', () => {
  const validar = cargarValidador();
  const { fila } = validar({ nombre_paciente: 'Ana', tenant_id: 'otra', diagnosticos_usados: 999, es_prospecto: false, score: 5 });
  assert.equal(fila.tenant_id, undefined);
  assert.equal(fila.diagnosticos_usados, undefined);
  assert.equal(fila.es_prospecto, undefined);
});

test('P0-2: guardar-lead-prospecto limita el tamaño y no deja pisar casos de otra clínica', () => {
  assert.match(lead, /const MAX_BODY_CHARS = 12_000_000;/);
  assert.match(lead, /jsonError\(413,/);
  assert.match(lead, /UUID_RE\.test\(tenantId\)/);
  assert.match(lead, /existente\.tenant_id !== tenantId \|\| existente\.es_prospecto !== true[\s\S]{0,80}jsonError\(409/);
});
