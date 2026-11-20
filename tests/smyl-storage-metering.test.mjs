import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const storage = createRequire(import.meta.url)('../smyl-storage.js');

test('formatBytes y level dan lecturas claras y avisos al 80 % y 95 %', () => {
  assert.equal(storage.formatBytes(0), '0 B');
  assert.equal(storage.formatBytes(2048), '2 KB');
  assert.equal(storage.formatBytes(412 * 1048576), '412 MB');
  assert.equal(storage.formatBytes(3.2 * 1073741824), '3.2 GB');
  const limit = 10 * 1073741824;
  assert.equal(storage.level(1, 0).id, 'unknown');
  assert.equal(storage.level(limit * 0.5, limit).id, 'ok');
  assert.equal(storage.level(limit * 0.8, limit).id, 'warning');
  assert.equal(storage.level(limit * 0.95, limit).id, 'critical');
  assert.equal(storage.level(limit, limit).id, 'full');
});

test('las categorías con la misma etiqueta se unen y se ordenan por tamaño', () => {
  const groups = storage.groupCategories([
    { bucket: 'smyl-professional-cv', bytes: 10, files: 1 },
    { bucket: 'smyl-professional-cases', bytes: 20, files: 2 },
    { bucket: 'smyl-radiographs', bytes: 500, files: 5 },
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.bytes, g.files]), [['Radiografías', 500, 5], ['Directorio profesional', 30, 3]]);
});

test('la migración mide sobre el registro existente y no bloquea nada sin límite', () => {
  const sql = read('supabase/migrations/20261116140000_smyl_storage_metering.sql');
  assert.match(sql, /from public\.smyl_file_security s\s+join storage\.objects o/);
  assert.match(sql, /smyl_has_permission\(v_tenant,'settings\.manage'\)/);
  assert.match(sql, /public\.smyl_current_tenant\(\)/);
  assert.match(sql, /revoke all on public\.smyl_storage_settings from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.smyl_set_storage_limit\(uuid,bigint\) to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.smyl_set_storage_limit[^;]*authenticated/);
  assert.match(sql, /v_limit is not null and public\.smyl_storage_used_bytes\(new\.tenant_id\) >= v_limit/);
  assert.match(sql, /before insert on public\.smyl_patient_files/);
});

test('la pantalla de Almacenamiento llega a web, PWA y móvil y cuelga de Configuración', () => {
  for (const file of ['smyl-storage.js', 'smyl-storage.css', 'smyl-settings-hub.js', 'smyl-navigation.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
  assert.match(read('app.html'), /smyl-storage\.js\?v=1/);
  assert.match(read('sw.js'), /smyl-storage\.js\?v=1/);
  assert.match(read('smyl-settings-hub.js'), /title: 'Almacenamiento'[^}]*route: 'almacenamiento'/);
  assert.match(read('smyl-navigation.js'), /'mi-cuenta', 'almacenamiento'(, 'avisos-cita')?\]/);
  const src = read('smyl-storage.js');
  assert.match(src, /rpc\('smyl_storage_usage'\)/);
  assert.doesNotMatch(src, /tenant_id/);
});
