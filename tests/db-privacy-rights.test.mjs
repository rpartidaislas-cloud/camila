import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Prueba las migraciones de privacidad EJECUTANDO el SQL en un PostgreSQL real (esquema mínimo de prueba, sin Supabase).
// Se salta sola si en esta máquina no hay un PostgreSQL local disponible.
const root = fileURLToPath(new URL('..', import.meta.url));
const sql = (file) => fs.readFileSync(root + file, 'utf8');
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

function psql(db, input) {
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', '-'];
  const r = asRoot ? spawnSync('su', ['postgres', '-c', 'psql ' + args.join(' ')], { input, encoding: 'utf8' }) : spawnSync('psql', args, { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: String(r.stdout || '') + String(r.stderr || '') };
}
function pg(command) {
  const r = asRoot ? spawnSync('su', ['postgres', '-c', command], { encoding: 'utf8' }) : spawnSync('sh', ['-c', command], { encoding: 'utf8' });
  return r.status === 0;
}
const available = pg('pg_isready -q') && pg('psql -X -tAc "select 1" postgres');

test('privacidad y derechos ARCO: las funciones, permisos y plazos funcionan en PostgreSQL real', { skip: !available && 'no hay un PostgreSQL local disponible' }, () => {
  const db = 'smyl_t_' + process.pid;
  assert.ok(pg(`createdb ${db}`), 'crear la base temporal');
  try {
    for (const file of ['tests/fixtures/db-privacy-stubs.sql', 'supabase/migrations/20261116210000_smyl_patient_consents.sql', 'supabase/migrations/20261123100000_smyl_privacy_rights.sql']) {
      const r = psql(db, sql(file));
      assert.ok(r.ok, file + '\n' + r.out);
    }
    // la migración es idempotente: aplicarla otra vez no falla ni duplica nada
    const again = psql(db, sql('supabase/migrations/20261123100000_smyl_privacy_rights.sql'));
    assert.ok(again.ok, 'segunda aplicación\n' + again.out);
    const run = psql(db, sql('tests/fixtures/db-privacy-scenarios.sql'));
    assert.ok(run.ok, run.out);
    assert.match(run.out, /ESCENARIOS OK/);
    assert.match(run.out, /PERMISOS OK/);
  } finally { pg(`dropdb --if-exists ${db}`); }
});

test('la migración solo agrega: no borra ni cambia lo existente', () => {
  const text = sql('supabase/migrations/20261123100000_smyl_privacy_rights.sql').replace(/--.*$/gm, '');
  assert.doesNotMatch(text, /\bdrop (table|column|function)\b/i);
  assert.doesNotMatch(text, /\balter table public\.(camila_|smyl_)(?!patient_privacy_events|data_rights_requests)/i);
  assert.match(text, /revoke all on public\.smyl_patient_privacy_events from public, anon, authenticated/);
  assert.match(text, /revoke all on public\.smyl_data_rights_requests from public, anon, authenticated/);
  assert.match(text, /grant select on public\.smyl_data_rights_requests to authenticated/);
  assert.doesNotMatch(text, /grant (insert|update|delete)[^;]*to authenticated/i);
  const versions = fs.readdirSync(root + 'supabase/migrations').map((f) => f.split('_')[0]);
  assert.equal(versions.filter((v) => v === '20261123100000').length, 1);
});

test('firma remota del aviso por enlace: funciona en PostgreSQL real', { skip: !available && 'no hay un PostgreSQL local disponible' }, () => {
  const db = 'smyl_c_' + process.pid;
  assert.ok(pg(`createdb ${db}`), 'crear la base temporal');
  try {
    for (const file of ['tests/fixtures/db-privacy-stubs.sql', 'supabase/migrations/20261116210000_smyl_patient_consents.sql', 'supabase/migrations/20261123100000_smyl_privacy_rights.sql', 'supabase/migrations/20261124100000_smyl_consent_remote_links.sql']) {
      const r = psql(db, sql(file));
      assert.ok(r.ok, file + '\n' + r.out);
    }
    const again = psql(db, sql('supabase/migrations/20261124100000_smyl_consent_remote_links.sql'));
    assert.ok(again.ok, 'segunda aplicación\n' + again.out);
    const run = psql(db, sql('tests/fixtures/db-consent-link-scenarios.sql'));
    assert.ok(run.ok, run.out);
    assert.match(run.out, /ENLACES OK/);
  } finally { pg(`dropdb --if-exists ${db}`); }
});

test('la migración de firma remota solo agrega y no expone tablas', () => {
  const text = sql('supabase/migrations/20261124100000_smyl_consent_remote_links.sql').replace(/--.*$/gm, '');
  assert.doesNotMatch(text, /\bdrop (table|column|function)\b/i);
  assert.match(text, /revoke all on public\.smyl_consent_links from public, anon, authenticated/);
  assert.doesNotMatch(text, /grant (select|insert|update|delete)[^;]*to (anon|authenticated)/i);
  assert.match(text, /interval '48 hours'/);
  assert.match(text, /encode\(sha256\(convert_to\(v_token/);
});
