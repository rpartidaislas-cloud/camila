import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workflow = read('.github/workflows/smyl-pacientes-alta-v2-migracion.yml');
const migration = read('supabase/migrations/20261020150000_smyl_patient_intake_v2.sql');
const config = read('supabase/config.toml');

test('el flujo es manual y apunta al proyecto y a la migración de SMYL', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/, 'no debe tocar producción al fusionar');
  const ref = config.match(/project_id = "([a-z0-9]+)"/)?.[1];
  assert.ok(ref, 'supabase/config.toml debe declarar el proyecto');
  assert.ok(workflow.includes(`PROJECT_REF: ${ref}`), 'el flujo debe usar el proyecto de config.toml');
  assert.match(workflow, /MIGRATION_VERSION: "20261020150000"/);
  assert.match(workflow, /MIGRATION_FILE: supabase\/migrations\/20261020150000_smyl_patient_intake_v2\.sql/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /supabase migration repair --status applied "\$MIGRATION_VERSION"/);
});

test('el flujo verifica las columnas de la migración y se detiene si faltan prerrequisitos', () => {
  const columnas = [...(workflow.match(/const COLUMNAS = \[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const enSql = [...migration.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(columnas, enSql);
  assert.match(workflow, /no se aplicó nada/);
  for (const dependencia of ['smyl_current_tenant', 'smyl_has_permission', 'smyl_can_access_patient', 'smyl_normalize_contact_phone', 'smyl_branches', 'smyl_professionals']) {
    assert.ok(workflow.includes(`'${dependencia}'`), `falta comprobar ${dependencia}`);
    assert.ok(migration.includes(dependencia), `la migración ya no usa ${dependencia}`);
  }
  assert.match(workflow, /has_function_privilege\('authenticated'[\s\S]*?not has_function_privilege\('anon'/);
});
