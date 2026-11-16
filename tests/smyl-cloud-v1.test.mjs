import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const cloud = createRequire(import.meta.url)('../smyl-cloud.js');
const sql = read('supabase/migrations/20261116170000_smyl_cloud_v1.sql');

test('helpers de la Nube: formato, nombres seguros y validación de archivos', () => {
  assert.equal(cloud.formatBytes(1800000), '1.7 MB');
  assert.equal(cloud.safeName('Radiografía final (1).jpg'), 'Radiograf_a_final_1_.jpg');
  assert.equal(cloud.guessCategory({ type: 'application/pdf' }), 'document');
  assert.equal(cloud.guessCategory({ type: 'image/jpeg' }), '');
  assert.match(cloud.checkFile({ type: 'application/x-msdownload', size: 100 }), /Formato no permitido/);
  assert.match(cloud.checkFile({ type: 'image/png', size: 21 * 1024 * 1024 }), /20 MB/);
  assert.equal(cloud.checkFile({ type: 'image/png', size: 1000 }), '');
  assert.equal(cloud.trashDaysLeft(new Date().toISOString()), 30);
  assert.equal(cloud.trashDaysLeft(new Date(Date.now() - 40 * 86400000).toISOString()), 0);
  assert.equal(cloud.escapeLike('a%b,c(d)'), 'a b c d');
});

test('la migración define permisos propios y exige lo clínico además del permiso de la Nube', () => {
  for (const key of ['cloud.read', 'cloud.upload', 'cloud.manage', 'cloud.share']) assert.match(sql, new RegExp(`'${key.replace('.', '\\.')}'`));
  assert.match(sql, /smyl_cloud_can_see\(p_tenant uuid, p_patient uuid, p_category text\)/);
  assert.match(sql, /smyl_has_permission\(p_tenant, 'clinical\.read'\)/);
  assert.match(sql, /smyl_can_access_patient\(p_tenant, p_patient, 'clinical'\)/);
  assert.match(sql, /where r\.system_role and r\.code in \('propietario', 'administrador'\)/);
});

test('la migración no permite escribir tablas directo, reutiliza la cuarentena y no altera smyl_patient_files', () => {
  assert.match(sql, /revoke all on public\.smyl_cloud_folders, public\.smyl_cloud_files from public, anon, authenticated;\s+grant select on/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*smyl_cloud_(files|folders)/i);
  assert.match(sql, /'smyl-professional-cases', 'smyl-cloud'/);
  assert.match(sql, /smyl_file_is_usable\('smyl-cloud', p_storage_path\)/);
  assert.match(sql, /when 'smyl-cloud' then\s+return exists \(select 1 from public\.smyl_cloud_files/);
  assert.doesNotMatch(sql, /alter table public\.smyl_patient_files|on public\.smyl_patient_files/);
  assert.match(sql, /bucket_id = 'smyl-cloud' and public\.smyl_cloud_path_readable\(name\)/);
  assert.match(sql, /smyl_cloud_path_orphan/);
});

test('el límite de almacenamiento es opcional y la papelera solo borra desde la papelera', () => {
  assert.match(sql, /to_regprocedure\('public\.smyl_storage_used_bytes\(uuid\)'\) is not null/);
  assert.match(sql, /to_regclass\('public\.smyl_storage_settings'\) is not null/);
  assert.match(sql, /f\.status = 'trashed'\s+and public\.smyl_cloud_can_see/);
  assert.match(read('supabase/functions/file-lifecycle-maintenance/index.ts'), /eq\('status','trashed'\)\.lte\('trashed_at',cutoff\)/);
  assert.match(read('supabase/functions/_shared/file-security.ts'), /'smyl-cloud': \{ max: 20 \* 1024 \* 1024/);
});

test('la pantalla llega a web, PWA y móvil, usa solo RPC con permisos y registra el permiso en Equipo', () => {
  for (const file of ['smyl-cloud.js', 'smyl-cloud.css', 'smyl-clinic-admin.js', 'smyl-navigation.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
  assert.match(read('app.html'), /smyl-cloud\.js\?v=2/);
  assert.match(read('sw.js'), /smyl-cloud\.js\?v=2/);
  assert.match(read('smyl-navigation.js'), /\['Nube', 'nube', 'cloud'\]/);
  assert.match(read('smyl-clinic-admin.js'), /'cloud\.read': 'Ver la Nube'/);
  const src = read('smyl-cloud.js');
  for (const rpc of ['smyl_cloud_summary', 'smyl_cloud_upload_check', 'smyl_cloud_register_file', 'smyl_cloud_update_file', 'smyl_cloud_set_trashed', 'smyl_cloud_delete_forever']) assert.match(src, new RegExp(rpc));
  assert.match(src, /SmylSecureFiles\.verify\(sb\(\), BUCKET, path, file, sha\)/);
  assert.match(src, /remove\(\[path\]\)/);
});
