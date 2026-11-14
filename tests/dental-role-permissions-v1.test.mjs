import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../smyl-dental-record.js', import.meta.url), 'utf8');

test('dental record resolves configurable clinical permissions and retains the owner shortcut', () => {
  assert.match(source, /smyl_member_roles/);
  assert.match(source, /smyl_role_permissions/);
  for (const permission of ['clinical.read', 'clinical.write', 'clinical.approve']) {
    assert.ok(source.includes(`permissions.has('${permission}')`));
  }
  assert.match(source, /miRolEquipo==='dueño'&&actor===tenant/);
  assert.doesNotMatch(source, /miRolEquipo!=='dueño'/);
  assert.match(source, /RLS, storage policies and RPC checks remain authoritative/);
});

test('read permission unlocks the record, dental map and radiograph viewer without granting writes', () => {
  assert.match(source, /if\(!ctx\.canRead\)\{message\(ctx,'Tu rol no permite consultar/);
  assert.match(source, /openTooth[\s\S]*?!ctx\.canRead/);
  assert.match(source, /openStudy[\s\S]*?!ctx\.canRead/);
  assert.match(source, /planContext[\s\S]*?!ctx\.canRead/);
  assert.match(source, /await guard\(ctx,'read'\);const row=await checked\(sb\.from\('smyl_dental_records'\)/);
  assert.match(source, /button\(pendingUpload&&ctx\.canWrite\?'Añadir notas':ctx\.canWrite\?'Abrir archivo':'Ver archivo'/);
  assert.match(source, /canReviewStudies:ctx\.canWrite&&ctx\.canApprove/);
  assert.match(source, /notes\.e\.readOnly=!ctx\.canWrite/);
});

test('all local mutations and remote saves require clinical.write', () => {
  assert.match(source, /function dirty\(ctx\)\{if\(!ctx\.canWrite\)return/);
  assert.match(source, /if\(!file\|\|!ctx\.canWrite/);
  assert.match(source, /if\(!ctx\.ready\|\|!ctx\.canWrite\|\|ctx\.busy\|\|!ctx\.dirty\)return/);
  assert.match(source, /await guard\(ctx,'write'\);const doc=structuredClone/);
  assert.match(source, /await guard\(ctx,'write'\);const row=await checked\(sb\.rpc\('smyl_save_dental_record'/);
  assert.match(source, /observation\.e\.readOnly=!ctx\.canWrite/);
  assert.match(source, /if\(selected===m\.id&&ctx\.canWrite\)/);
});

test('AI review and confirmed clinical decisions require write plus approve', () => {
  assert.match(source, /ctx\.canWrite&&ctx\.canApprove&&document\.getElementById/);
  assert.match(source, /await guard\(ctx,'write'\);await guard\(ctx,'approve'\)/);
  assert.match(source, /assisted\.hidden=!\(ctx\.canWrite&&ctx\.canApprove\)/);
  assert.match(source, /perPiece\.hidden=!\(ctx\.canWrite&&ctx\.canApprove&&ok\)/);
  assert.match(source, /current:\(\)=>current\(ctx\)&&ctx\.ready&&!ctx\.dirty&&ctx\.canWrite&&ctx\.canApprove/);
});

test('auth continuity follows the signed-in team member rather than the tenant owner id', () => {
  assert.match(source, /actor:null,canRead:false,canWrite:false,canApprove:false/);
  assert.match(source, /session\.user\.id!==active\.actor/);
  assert.doesNotMatch(source, /session\?\.user\?\.id!==active\.tenant/);
});
