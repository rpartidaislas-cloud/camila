import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import nodeCrypto from 'node:crypto';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const scopes = read('supabase/migrations/20261106100000_smyl_role_scopes_seed_new_clinics.sql');
const rls = read('supabase/migrations/20261106110000_smyl_rls_read_policies_set_based.sql');
const workflow = read('.github/workflows/smyl-panel-auditoria-migracion.yml');

test('alcances de rol: los roles nuevos reciben alcance, los personalizados el mínimo y el relleno no pisa nada', () => {
  assert.match(scopes, /create trigger smyl_seed_role_scopes_after_role[\s\S]*after insert on public\.smyl_roles/);
  assert.match(scopes, /when not new\.system_role then 'own'/);
  assert.match(scopes, /on conflict do nothing/);
  assert.doesNotMatch(scopes, /on conflict[^;]*do update/i);
  assert.match(scopes, /revoke all on function public\.smyl_seed_role_scopes\(\)/);
});

test('RLS por conjuntos: ambas políticas exigen permiso Y alcance, y no usan funciones por fila para pacientes', () => {
  const pacientes = rls.slice(rls.indexOf('create policy pacientes_read'), rls.indexOf('create policy smyl_appointments_read'));
  assert.match(pacientes, /tenant_id in \(select public\.smyl_tenants_with_permission\('patients\.read'\)\)/);
  assert.match(pacientes, /\(tenant_id, id\) in \(select s\.tenant_id, s\.patient_id from public\.smyl_patient_ids_in_scope\('patients'\) s\)/);
  assert.doesNotMatch(pacientes, /smyl_has_permission|smyl_can_access_patient/);
  const citas = rls.slice(rls.indexOf('create policy smyl_appointments_read'));
  assert.match(citas, /smyl_tenants_with_permission\('schedule\.read'\)/);
  assert.match(citas, /smyl_can_access_schedule_row\(tenant_id, branch_id, professional_id, patient_id\)/);
});

test('RLS por conjuntos: ayudantes security definer con search_path fijo, sin acceso para anon', () => {
  for (const fn of ['smyl_tenants_with_permission', 'smyl_tenants_with_scope', 'smyl_my_professional_ids', 'smyl_patient_ids_in_scope']) {
    const m = rls.match(new RegExp('create or replace function public\\.' + fn + '[\\s\\S]*?\\$\\$;?\\s*(?=\\n\\n|\\ncreate|\\nrevoke|$)', 'i'));
    assert.ok(m, fn);
    assert.match(m[0], /security definer/);
    assert.match(m[0], /set search_path = pg_catalog, public/);
  }
  assert.match(rls, /revoke all on function [\s\S]*from public, anon;/);
  assert.match(rls, /grant execute on function [\s\S]*to authenticated;/);
});

test('workflow del panel aplica y verifica las dos migraciones', () => {
  assert.match(workflow, /20261106100000/);
  assert.match(workflow, /20261106110000/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /roles_sin_alcance/);
  assert.match(workflow, /smyl_tenants_with_permission/);
});

test('compactación de auditoría: no borra eventos, exige ventana mínima y solo la ejecuta service_role', () => {
  const mig = read('supabase/migrations/20261106120000_smyl_audit_events_compaction.sql');
  assert.match(mig, /set before_data = null, after_data = null/);
  assert.doesNotMatch(mig, /delete\s+from\s+public\.smyl_audit_events/i);
  assert.match(mig, /p_older_than < interval '6 months'/);
  assert.match(mig, /revoke all on function public\.smyl_compact_audit_events[\s\S]*from public, anon, authenticated/);
  assert.match(mig, /grant execute on function public\.smyl_compact_audit_events[\s\S]*to service_role/);
  assert.match(mig, /smyl-compactar-auditoria/);
  assert.match(workflow, /20261106120000/);
  assert.match(workflow, /compactacion_ok/);
});

test('supabase-js del panel se sirve desde el sitio (sin CDN), con la versión fijada y precacheado', () => {
  const crypto = nodeCrypto;
  for (const app of ['app.html', 'mobile/www/app.html']) {
    const html = read(app);
    assert.match(html, /<script src="vendor\/supabase-js-2\.117\.3\.js"><\/script>/);
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/);
  }
  for (const sw of ['sw.js', 'mobile/www/sw.js']) assert.match(read(sw), /'\/camila\/vendor\/supabase-js-2\.117\.3\.js'/);
  const file = fs.readFileSync(new URL('../vendor/supabase-js-2.117.3.js', import.meta.url));
  assert.equal(file.equals(fs.readFileSync(new URL('../mobile/www/vendor/supabase-js-2.117.3.js', import.meta.url))), true);
  assert.match(read('vendor/README.md'), new RegExp(crypto.createHash('sha256').update(file).digest('hex')));
  assert.match(file.toString('utf8', 0, 4000) + file.toString('utf8').slice(-2000), /supabase|createClient/);
});

test('anti-empalme: restricción de exclusión por profesional y sillón sobre citas activas, sin fallar si hay datos empalmados', () => {
  const mig = read('supabase/migrations/20261106130000_smyl_appointments_no_overlap.sql');
  assert.match(mig, /exclude using gist \(tenant_id with =, professional_id with =, tstzrange\(starts_at, ends_at\) with &&\)/);
  assert.match(mig, /exclude using gist \(tenant_id with =, room_id with =, tstzrange\(starts_at, ends_at\) with &&\)/);
  assert.match(mig, /status in \('confirmed','arrived','in_progress'\)/);
  assert.match(mig, /raise notice/);
  assert.match(workflow, /20261106130000/);
  assert.match(workflow, /empalme_prof_ok/);
  assert.match(read('smyl-schedule.js'), /exclusion constraint\|no_overlap/);
});
