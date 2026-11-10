import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261109110000_smyl_dental_study_archives.sql');
const record = read('smyl-dental-record.js');
const workspace = read('smyl-case-workspace.js');
const app = read('app.html');
const mobileApp = read('mobile/www/app.html');
const mobileRecord = read('mobile/www/smyl-dental-record.js');
const mobileWorkspace = read('mobile/www/smyl-case-workspace.js');

test('archive is reversible, permission-scoped and never deletes the original', () => {
  assert.match(migration, /create table public\.smyl_dental_study_archives/);
  assert.match(migration, /smyl_has_permission\(v_tenant,'clinical\.write'\)/);
  assert.match(migration, /smyl_can_access_patient\(v_tenant,p_patient_id,'clinical'\)/);
  assert.match(migration, /smyl_archive_dental_study/);
  assert.match(migration, /smyl_restore_dental_study/);
  assert.match(migration, /smyl_dental_study_archives_audit/);
  assert.doesNotMatch(migration, /delete\s+from\s+(?:public\.)?smyl_dental_records/i);
  assert.doesNotMatch(migration, /delete\s+from\s+storage\.objects/i);
});

test('active clinical views exclude archived evidence and expose exact duplicates without hashes', () => {
  assert.match(record, /function activeStudies\(ctx\)/);
  assert.match(record, /function duplicateCounts\(ctx\)/);
  assert.match(record, /isDuplicate:/);
  assert.match(record, /archiveStudy\(tenant,patient,studyId\)/);
  assert.match(record, /Evidencia archivada/);
  assert.match(record, /El original no se borrará/);
  assert.match(workspace, /\['duplicates','Duplicados'\]/);
  assert.match(workspace, /Posible duplicado exacto/);
  assert.match(workspace, /archiveStudy\(ctx\.tenant,ctx\.patient,study\.id\)/);
  assert.doesNotMatch(workspace, /sha256/);
});

test('web and packaged mobile use the same archive UX release', () => {
  assert.equal(record, mobileRecord);
  assert.equal(workspace, mobileWorkspace);
  for (const html of [app, mobileApp]) {
    assert.match(html, /smyl-dental-record\.js\?v=23/);
    assert.match(html, /smyl-dental-record\.css\?v=5/);
    assert.match(html, /smyl-case-workspace\.js\?v=28/);
    assert.match(html, /smyl-case-workspace\.css\?v=24/);
  }
});
