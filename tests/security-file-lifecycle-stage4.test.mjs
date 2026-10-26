import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('cleanup only selects stale or unlinked files and rechecks references before audit',()=>{
  const sql=read('supabase/migrations/20261014160000_smyl_file_lifecycle.sql');
  assert.match(sql,/smyl_file_retention_policies/);
  assert.match(sql,/linked_auto_delete boolean not null default false check\(linked_auto_delete=false\)/);
  assert.match(sql,/status='pending' and s\.created_at<now\(\)-\(p\.pending_hours\*interval '1 hour'\)/);
  assert.match(sql,/status='clean' and s\.created_at<now\(\)-\(p\.unlinked_days\*interval '1 day'\)/);
  assert.match(sql,/not public\.smyl_file_is_referenced/);
  assert.match(sql,/or public\.smyl_file_is_referenced\(p_bucket,p_path\)/);
  assert.match(sql,/smyl_file_deletion_log/);
  assert.match(sql,/status='deleted'/);
});

test('all protected consumers participate in reference detection',()=>{
  const sql=read('supabase/migrations/20261014160000_smyl_file_lifecycle.sql');
  for(const table of ['smyl_patient_files','smyl_patient_case_archive','smyl_dental_records','smyl_proposals','smyl_professional_profiles','smyl_professional_cases'])assert.match(sql,new RegExp('public\\.'+table));
});

test('legacy rescan preserves questionable historical evidence for human review',()=>{
  const edge=read('supabase/functions/file-lifecycle-maintenance/index.ts');
  assert.match(edge,/status:reason\?'legacy_review':'clean'/);
  assert.doesNotMatch(edge,/legacy[\s\S]{0,500}\.remove\(/);
  assert.match(read('supabase/migrations/20261014160000_smyl_file_lifecycle.sql'),/status in \('clean','legacy','legacy_review'\)/);
});

test('maintenance requires a real session, is tenant scoped and throttled',()=>{
  const edge=read('supabase/functions/file-lifecycle-maintenance/index.ts');
  assert.match(edge,/requireUser\(req,CORS\)/);
  assert.match(edge,/p_tenant:tenant/);
  assert.match(edge,/12\*60\*60\*1000/);
  assert.match(edge,/download\(item\.object_path\)/);
  assert.match(edge,/smyl_record_file_deletion/);
});

test('web and mobile start the same opportunistic lifecycle worker',()=>{
  assert.equal(read('smyl-secure-files.js'),read('mobile/www/smyl-secure-files.js'));
  assert.match(read('app.html'),/SmylSecureFiles\.startMaintenance\(sb\)/);
  assert.match(read('mobile/www/app.html'),/SmylSecureFiles\.startMaintenance\(sb\)/);
  assert.equal(read('sw.js'),read('mobile/www/sw.js'));
  assert.match(read('sw.js'),/smyl-v263-lana-connection-recovery/);
});
