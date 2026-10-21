import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// La cuenta titular (id = clínica) sin fila de dueño en camila_usuarios caía en
// el alcance 'own': guardar un paciente fallaba con 42501 al pedir la fila de
// vuelta y la lista aparecía vacía. La migración le da alcance de clínica y la
// pantalla distingue falta de permiso de falta de alcance.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('la migración da alcance de clínica al titular y conserva el resto de la regla', () => {
  const sql = read('supabase/migrations/20261021004700_smyl_titular_effective_scope.sql');
  assert.match(sql, /create or replace function public\.smyl_effective_scope\(p_tenant uuid, p_domain text\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path to 'pg_catalog', 'public'/);
  const titular = sql.indexOf('p_tenant = auth.uid()');
  assert.ok(titular > 0, 'debe reconocer al titular por auth.uid()');
  assert.match(sql.slice(titular - 80, titular + 240), /camila_tenants ct where ct\.id = p_tenant and ct\.activo[\s\S]*?return 'clinic'/, 'sólo si la clínica está activa');
  // Lo anterior sigue vigente: fila de dueño y alcance por roles.
  assert.match(sql, /u\.rol='dueño'\) then\s*return 'clinic'/);
  assert.match(sql, /smyl_role_scopes rs/);
  assert.match(sql, /return coalesce\(v_scope,'own'\)/);
  assert.doesNotMatch(sql, /p_tenant is null then return 'clinic'/, 'un tenant nulo nunca recibe alcance');
});

test('la pantalla distingue falta de permiso de falta de alcance ante un 42501', () => {
  const clinic = read('smyl-clinic.js');
  assert.match(clinic, /if \(reason === 'scope'\) return 'Tu cuenta tiene permiso para dar de alta pacientes, pero el alcance de datos/);
  assert.match(clinic, /var recheck = await patientPermissionCheck\(tenantId\)/);
  assert.match(clinic, /patientBlockMessage\(recheck && recheck\.ok \? 'scope'/);
  assert.doesNotMatch(clinic, /error\.code === '42501' \? patientBlockMessage\('permission'\)/, 'ya no culpa siempre al permiso');
});

test('web, móvil y PWA publican la misma pantalla', () => {
  for (const file of ['smyl-clinic.js', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  for (const file of ['app.html', 'sw.js']) assert.match(read(file), /smyl-clinic\.js\?v=11/);
});
