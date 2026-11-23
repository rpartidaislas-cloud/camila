import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('camila_casos solo para quien tiene permiso clínico (leer clinical.read, escribir clinical.write)', () => {
  const sql = read('supabase/migrations/20261125120000_smyl_camila_casos_clinical_scope.sql');
  assert.match(sql, /drop policy if exists camila_casos_select_miembros/);
  assert.match(sql, /for select to authenticated[\s\S]*?smyl_has_permission\(public\.camila_uuid_seguro\(tenant_id\), 'clinical\.read'\)/);
  assert.match(sql, /for insert to authenticated[\s\S]*?'clinical\.write'/);
  assert.match(sql, /for update to authenticated[\s\S]*?'clinical\.write'[\s\S]*?'clinical\.write'/);
  assert.match(sql, /revoke all on public\.camila_casos from anon/);
});

test('las fotos de pacientes ya no se firman por un año y se renuevan al mostrarlas', () => {
  for (const f of ['simulacion.html', 'simulacion-rapida.html', 'revision-clinica.html']) {
    const src = read(f);
    assert.doesNotMatch(src, /31536000/, f);
    assert.match(src, /expiresIn: 604800/, f);
    assert.match(src, /smyl-photo-url-refresh\.js\?v=1/, f);
  }
  assert.match(read('app.html'), /smyl-photo-url-refresh\.js\?v=1/);
  const refresh = read('smyl-photo-url-refresh.js');
  assert.match(refresh, /REFRESH_SECONDS = 3600/);
  assert.match(refresh, /img\.dataset\.smylRefreshed === '1'/, 'solo un intento por imagen');
});

test('acceso: contraseña de 10+ con letras y números, cierre por inactividad y verificación en dos pasos', () => {
  const guard = read('smyl-auth-guard.js');
  assert.match(guard, /MIN_PASSWORD = 10/);
  assert.match(guard, /IDLE_MS = 30 \* 60 \* 1000/);
  assert.match(guard, /nextLevel !== 'aal2' \|\| level\.data\.currentLevel === 'aal2'/);
  assert.match(guard, /challengeAndVerify/);
  const app = read('app.html');
  assert.match(app, /<script src="smyl-auth-guard\.js\?v=2"><\/script>/);
  assert.match(app, /SmylAuthGuard\.ensureSecondFactor\(sb\)[\s\S]{0,200}if \(!segundoPaso\)/);
  assert.match(app, /SmylAuthGuard\.startIdleLogout\(function \(\) \{ cerrarSesion\(\); \}\)/);
  assert.match(app, /id="mc-mfa"/);
  assert.doesNotMatch(app, /al menos 6 caracteres/);
  for (const f of ['simulacion.html', 'simulacion-rapida.html']) assert.match(read(f), /pass\.length < 10 \|\| !\/\[A-Za-z\]\/\.test\(pass\)/, f);
  for (const f of ['smyl-auth-guard.js', 'smyl-photo-url-refresh.js', 'app.html']) assert.equal(read('mobile/www/' + f), read(f), 'copia móvil ' + f);
  const sw = read('sw.js');
  assert.match(sw, /smyl-auth-guard\.js\?v=2/);
  assert.match(sw, /smyl-photo-url-refresh\.js\?v=1/);
});
