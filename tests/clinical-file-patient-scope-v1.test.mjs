// Archivos clínicos privados — alcance efectivo por paciente.
// El contrato estático siempre corre. La prueba funcional usa PGlite cuando está
// disponible y demuestra que tener permiso clínico no basta para abrir otro paciente.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20261112130000_smyl_clinical_file_patient_scope.sql');

test('la ruta clínica exige tenant, permiso, paciente existente y alcance clínico', () => {
  assert.match(migration, /v_tenant=public\.smyl_current_tenant\(\)/);
  assert.match(migration, /public\.smyl_has_permission\(v_tenant,p_permission\)/);
  assert.match(migration, /from public\.camila_pacientes patient[\s\S]*patient\.tenant_id=v_tenant[\s\S]*patient\.id=v_patient/);
  assert.match(migration, /public\.smyl_can_access_patient\(v_tenant,v_patient,'clinical'\)/);
  assert.doesNotMatch(migration, /for (select|insert|update|delete)/i, 'no amplía las operaciones permitidas en Storage');
});

test('la función falla cerrada ante rutas inválidas y no se concede a anon', () => {
  assert.match(migration, /if array_length\(v_parts,1\)<4/);
  assert.match(migration, /exception when others then\s+return false/);
  assert.match(migration, /revoke all on function public\.smyl_clinical_file_path_allowed\(text,text\) from public,anon/);
  assert.match(migration, /grant execute on function public\.smyl_clinical_file_path_allowed\(text,text\) to authenticated/);
});

async function loadPglite() {
  try { return await import('@electric-sql/pglite'); } catch {}
  const dir = process.env.SMYL_PGLITE_DIR;
  if (!dir) return null;
  try {
    return await import(pathToFileURL(createRequire(path.join(dir, 'noop.js')).resolve('@electric-sql/pglite')).href);
  } catch {
    return null;
  }
}

const pglite = await loadPglite();
if (!pglite && process.env.SMYL_REQUIRE_PGLITE === '1') {
  throw new Error('SMYL_REQUIRE_PGLITE=1 pero @electric-sql/pglite no está disponible.');
}
const skip = pglite ? false : 'Instala @electric-sql/pglite o define SMYL_PGLITE_DIR para correr esta suite.';

test('Postgres: un profesional sólo accede a los archivos de pacientes dentro de su alcance', { skip }, async () => {
  const db = new pglite.PGlite();
  const exec = sql => db.exec(sql);
  const rows = async sql => (await db.query(sql)).rows;
  const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const dentist = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const patientAllowed = '11111111-1111-4111-8111-111111111111';
  const patientDenied = '22222222-2222-4222-8222-222222222222';
  const patientOtherTenant = '33333333-3333-4333-8333-333333333333';
  const role = 'f1000000-0000-4000-8000-000000000001';
  const professional = 'd1000000-0000-4000-8000-000000000001';
  const fileId = 'e1000000-0000-4000-8000-000000000001';

  await exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await exec(migration);
  await exec(migration);
  await exec(`
    insert into auth.users(id) values ('${tenant}'),('${dentist}');
    insert into public.camila_tenants(id,nombre) values ('${tenant}','Clínica A');
    insert into public.camila_usuarios(id,tenant_id,rol,activo) values ('${dentist}','${tenant}','staff',true);
    insert into public.camila_pacientes(id,tenant_id,nombre) values
      ('${patientAllowed}','${tenant}','Paciente asignado'),
      ('${patientDenied}','${tenant}','Paciente no asignado');
    insert into public.smyl_roles(id,tenant_id,code,name,active) values ('${role}','${tenant}','odontologo','Odontólogo',true);
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key) values
      ('${tenant}','${role}','clinical.read'),('${tenant}','${role}','clinical.write');
    insert into public.smyl_role_scopes(tenant_id,role_id,domain,scope) values ('${tenant}','${role}','clinical','care_team');
    insert into public.smyl_member_roles(tenant_id,user_id,role_id) values ('${tenant}','${dentist}','${role}');
    insert into public.smyl_professionals(id,tenant_id,user_id,display_name,active) values
      ('${professional}','${tenant}','${dentist}','Dra. Prueba',true);
    insert into public.smyl_patient_care_team(tenant_id,patient_id,professional_id,active) values
      ('${tenant}','${patientAllowed}','${professional}',true);
    select set_config('request.jwt.claim.sub','${dentist}',false);
    set role authenticated;
  `);

  const allowedPath = `${tenant}/${patientAllowed}/${fileId}/foto.jpg`;
  const deniedPath = `${tenant}/${patientDenied}/${fileId}/foto.jpg`;
  const missingPath = `${tenant}/${patientOtherTenant}/${fileId}/foto.jpg`;
  const result = await rows(`select
    public.smyl_clinical_file_path_allowed('${allowedPath}','clinical.read') as allowed,
    public.smyl_clinical_file_path_allowed('${deniedPath}','clinical.read') as denied,
    public.smyl_clinical_file_path_allowed('${missingPath}','clinical.read') as missing,
    public.smyl_clinical_file_path_allowed('ruta-invalida','clinical.read') as malformed,
    public.smyl_clinical_file_path_allowed('${allowedPath}','clinical.approve') as no_permission`);

  assert.deepEqual(result, [{ allowed: true, denied: false, missing: false, malformed: false, no_permission: false }]);
  await exec('reset role;');
  await db.close();
});
