import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261013050000_smyl_proposal_permissions_v1.sql');
const proposals = read('../smyl-proposals.js');
const flow = read('../smyl-case-workspace.js');
const app = read('../app.html');
const worker = read('../sw.js');

test('cotizaciones tiene permisos separados del expediente y de Caja', () => {
  for (const permission of ['proposal.read','proposal.write','proposal.approve']) {
    assert.match(migration, new RegExp(permission.replace('.', '\\.')));
  }
  assert.match(migration, /\('odontologo','proposal\.approve'\)/);
  assert.match(migration, /\('finanzas','proposal\.read'\)/);
  assert.doesNotMatch(migration, /\('odontologo','finance\.manage'\)/);
});

test('RLS protege propuestas, versiones y fotografías por permiso y tenant', () => {
  assert.match(migration, /proposals_permission_read/);
  assert.match(migration, /proposal_versions_permission_read/);
  assert.match(migration, /proposal_photos_permission_read/);
  assert.match(migration, /proposal_photos_permission_insert/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\]=public\.smyl_current_tenant\(\)::text/);
});

test('guardar y aprobar se validan también en servidor', () => {
  assert.match(migration, /not public\.smyl_has_permission\(p_tenant_id, 'proposal\.write'\)/);
  assert.match(migration, /p_approve and not public\.smyl_has_permission\(p_tenant_id, 'proposal\.approve'\)/);
  assert.match(migration, /smyl_proposal_for_export/);
});

test('la interfaz habilita capacidades de lectura, escritura y aprobación', () => {
  assert.match(proposals, /proposal\.read/);
  assert.match(proposals, /proposal\.write/);
  assert.match(proposals, /proposal\.approve/);
  assert.match(proposals, /!ctx\.access\.write/);
  assert.match(proposals, /!ctx\.access\.approve/);
  assert.doesNotMatch(flow, /La cotización comercial requiere la cuenta titular/);
});

test('web, móvil y PWA publican la delegación segura', () => {
  assert.match(app, /smyl-proposals\.js\?v=12/);
  assert.match(app, /smyl-case-workspace\.js\?v=18/);
  assert.match(worker, /smyl-v263-lana-connection-recovery/);
  for (const file of ['app.html','sw.js','smyl-proposals.js','smyl-case-workspace.js']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
