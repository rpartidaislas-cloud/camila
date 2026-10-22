import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SecureFiles = require('../smyl-secure-files.js');
const read = (path) => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('private uploads are verified with authoritative metadata before use', async () => {
  const file = new Blob([new Uint8Array([0xff,0xd8,0xff,1,2,0xff,0xd9])],{type:'image/jpeg'});
  const expected = await SecureFiles.sha256(file);
  let sent;
  const client = { functions:{ invoke:async (name,payload) => {
    sent={name,...payload.body};
    return {data:{ok:true,mime_type:file.type,size_bytes:file.size,sha256:expected},error:null};
  }}};
  const result = await SecureFiles.verify(client,'smyl-clinical-files','tenant/patient/file/photo.jpg',file);
  assert.equal(result.sha256,expected);
  assert.deepEqual(sent,{name:'secure-clinical-file',bucket:'smyl-clinical-files',path:'tenant/patient/file/photo.jpg',mime_type:'image/jpeg',size_bytes:file.size,sha256:expected});
});

test('client rejects an unconfirmed or altered verification response', async () => {
  const file = new Blob(['safe'],{type:'application/pdf'});
  const client = { functions:{ invoke:async () => ({data:{ok:true,mime_type:file.type,size_bytes:file.size,sha256:'0'.repeat(64)},error:null}) }};
  await assert.rejects(()=>SecureFiles.verify(client,'smyl-professional-cv','tenant/pro/cv.pdf',file),/No se confirmó/);
});

test('database quarantines protected buckets and gates every clinical consumer', () => {
  const sql=read('supabase/migrations/20261014150000_smyl_secure_clinical_files.sql');
  for(const bucket of ['smyl-case-photos','smyl-radiographs','smyl-clinical-files','smyl-proposal-photos','smyl-professional-cv','smyl-professional-cases']) assert.match(sql,new RegExp(bucket));
  for(const table of ['smyl_patient_files','smyl_patient_case_archive','smyl_dental_records','smyl_proposals','smyl_professional_profiles','smyl_professional_cases']) assert.match(sql,new RegExp('on public\\.'+table));
  assert.match(sql,/status in \('pending','clean','rejected','legacy'\)/);
  assert.match(sql,/smyl_file_is_usable\(bucket_id,name\)/);
});

test('server verifier authenticates, checks bytes and removes rejected objects', () => {
  const source=read('supabase/functions/secure-clinical-file/index.ts');
  const shared=read('supabase/functions/_shared/file-security.ts');
  assert.match(source,/requireUser\(req,CORS\)/);
  assert.match(source,/inspectFile\(bytes,claimedMime,claimedSize,claimedSha\)/);
  assert.match(shared,/crypto\.subtle\.digest\('SHA-256',bytes\)/);
  assert.match(shared,/JavaScript\|JS\|OpenAction\|Launch\|EmbeddedFile\|RichMedia\|XFA/);
  assert.match(source,/\.remove\(\[path\]\)/);
});

test('segmentation URLs expire in five minutes instead of one year', () => {
  const source=read('supabase/functions/segment-teeth/index.ts');
  assert.match(source,/createSignedUrl\(path, 60 \* 5\)/);
  assert.doesNotMatch(source,/60 \* 60 \* 24 \* 365/);
  assert.match(source,/maskPath: path/);
  const signer=read('supabase/functions/sign-segmentation-masks/index.ts');
  assert.match(signer,/requireUser\(req,CORS\)/);
  assert.match(signer,/\.eq\('tenant_id',auth\.tenantId\)/);
  assert.match(signer,/createSignedUrls\(paths,300\)/);
  assert.match(read('revision-clinica.html'),/await renovarMascarasPrivadas\(casoId\)/);
  assert.equal(read('revision-clinica.html'),read('mobile/www/revision-clinica.html'));
});

test('web, mobile and offline bundles ship the same security gate', () => {
  assert.equal(read('smyl-secure-files.js'),read('mobile/www/smyl-secure-files.js'));
  assert.match(read('app.html'),/smyl-secure-files\.js\?v=2/);
  assert.match(read('mobile/www/app.html'),/smyl-secure-files\.js\?v=2/);
  assert.match(read('sw.js'),/smyl-v255-professional-profile-v1/);
  assert.equal(read('sw.js'),read('mobile/www/sw.js'));
});
