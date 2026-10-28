// Radiografía asistida — Etapas 0 y 1 en un Postgres real en memoria (PGlite).
// Aplica tests/fixtures/radiograph-contracts/pglite-base.sql (helpers de autorización ya
// desplegados) y las cuatro migraciones nuevas, y verifica: banderas apagadas, aislamiento
// entre clínicas, miembro desactivado, rol sin acceso, conflicto de revisión, idempotencia,
// inmutabilidad de la salida del modelo e informe firmado, y los vectores de contrato en SQL.
//
// Requiere @electric-sql/pglite (no está en el repo). Opciones:
//   npm install --no-save --no-package-lock @electric-sql/pglite      (en la raíz del repo)
//   SMYL_PGLITE_DIR=/ruta/con/node_modules node --test tests/radiograph-pglite-stage1.test.mjs
// Si no está disponible, la suite se marca como omitida y no falla.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
async function loadPglite() {
  try { return await import('@electric-sql/pglite'); } catch (e) {}
  const dir = process.env.SMYL_PGLITE_DIR;
  if (!dir) return null;
  try { return await import(pathToFileURL(createRequire(path.join(dir, 'noop.js')).resolve('@electric-sql/pglite')).href); } catch (e) { return null; }
}
const pglite = await loadPglite();
const skip = pglite ? false : 'Instala @electric-sql/pglite o define SMYL_PGLITE_DIR para correr esta suite.';

const U = {
  ownerA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', ownerB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  dentist: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', outsider: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  reception: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', inactive: 'ffffffff-ffff-4fff-8fff-fffffffffff1'
};
const P1 = '11111111-1111-4111-8111-111111111111', P2 = '22222222-2222-4222-8222-222222222222', P3 = '33333333-3333-4333-8333-333333333333';
const STUDY = '44444444-4444-4444-8444-444444444444', SRC = '55555555-5555-4555-8555-555555555555', RPT = '66666666-6666-4666-8666-666666666666';
const SHA = 'ab'.repeat(32);
const ENGINE = { provider: 'simulated', name: 'smyl-sim-xray', version: '0.1.0' };
const vectors = name => JSON.parse(read(`tests/fixtures/radiograph-contracts/${name}.json`));
const withSource = v => Object.assign(structuredClone(v), { sourceId: SRC, model: structuredClone(ENGINE) });

let db;
const sql = (q, params) => db.query(q, params);
const exec = q => db.exec(q);
const as = uid => exec(`select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`);
const asServer = () => exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
async function rejects(promise, code, pattern) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `se esperaba el error ${code}`);
  const sqlstate = err.code || (err.message.match(/\b([0-9A-Z]{5})\b/) || [])[1];
  assert.equal(sqlstate, code, `${err.message}`);
  if (pattern) assert.match(err.message, pattern);
}
const rows = async (q, params) => (await sql(q, params)).rows;
const one = async (q, params) => (await rows(q, params))[0];

test.before(async () => {
  if (skip) return;
  db = new pglite.PGlite();
  await exec(read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  for (const file of ['20261028100000_smyl_radiograph_ai_flags', '20261028110000_smyl_radiograph_sources_v2', '20261028120000_smyl_radiograph_ai_runs', '20261028130000_smyl_radiograph_reports']) {
    const migration = read(`supabase/migrations/${file}.sql`);
    await exec(migration);
    await exec(migration); // idempotente: la segunda aplicación no falla ni cambia nada
  }
  await exec(`
    insert into auth.users(id) values ('${Object.values(U).join("'),('")}');
    insert into public.camila_tenants(id,nombre) values ('${U.ownerA}','Clínica A'),('${U.ownerB}','Clínica B');
    insert into public.camila_usuarios(id,tenant_id,rol,activo) values
      ('${U.ownerA}','${U.ownerA}','dueño',true),('${U.ownerB}','${U.ownerB}','dueño',true),
      ('${U.dentist}','${U.ownerA}','staff',true),('${U.outsider}','${U.ownerA}','staff',true),
      ('${U.reception}','${U.ownerA}','staff',true),('${U.inactive}','${U.ownerA}','staff',false);
    insert into public.camila_pacientes(id,tenant_id,nombre) values ('${P1}','${U.ownerA}','P1'),('${P2}','${U.ownerA}','P2'),('${P3}','${U.ownerB}','P3');
    insert into public.smyl_roles(id,tenant_id,code,name) values
      ('a0000000-0000-4000-8000-000000000001','${U.ownerA}','odontologo','Odontólogo'),
      ('a0000000-0000-4000-8000-000000000002','${U.ownerA}','recepcion','Recepción');
    insert into public.smyl_role_permissions(tenant_id,role_id,permission_key) values
      ('${U.ownerA}','a0000000-0000-4000-8000-000000000001','clinical.read'),('${U.ownerA}','a0000000-0000-4000-8000-000000000001','clinical.write'),
      ('${U.ownerA}','a0000000-0000-4000-8000-000000000001','clinical.approve'),('${U.ownerA}','a0000000-0000-4000-8000-000000000002','clinical.read');
    insert into public.smyl_role_scopes(tenant_id,role_id,domain,scope) values
      ('${U.ownerA}','a0000000-0000-4000-8000-000000000001','clinical','own'),('${U.ownerA}','a0000000-0000-4000-8000-000000000002','clinical','clinic');
    insert into public.smyl_member_roles(tenant_id,user_id,role_id) values
      ('${U.ownerA}','${U.dentist}','a0000000-0000-4000-8000-000000000001'),('${U.ownerA}','${U.outsider}','a0000000-0000-4000-8000-000000000001'),
      ('${U.ownerA}','${U.reception}','a0000000-0000-4000-8000-000000000002'),('${U.ownerA}','${U.inactive}','a0000000-0000-4000-8000-000000000001');
    insert into public.smyl_professionals(id,tenant_id,user_id,display_name) values
      ('b0000000-0000-4000-8000-000000000001','${U.ownerA}','${U.dentist}','Dra. D'),('b0000000-0000-4000-8000-000000000002','${U.ownerA}','${U.outsider}','Dr. O');
    insert into public.smyl_patient_care_team(tenant_id,patient_id,professional_id) values ('${U.ownerA}','${P1}','b0000000-0000-4000-8000-000000000001');
    insert into public.smyl_dental_records(patient_id,tenant_id,revision,document,updated_by) values ('${P1}','${U.ownerA}',1,
      '{"studies":[{"id":"${STUDY}","type":"panoramic","asset":{"path":"${U.ownerA}/${P1}/${STUDY}/${SHA}.jpeg","sha256":"${SHA}","bytes":123456,"mime":"image/jpeg"}}]}','${U.ownerA}');
  `);
});
test.after(async () => { if (db) await db.close(); });

const register = (patient = P1, study = STUDY, source = SRC) => one(
  `select * from public.smyl_radiograph_register_source($1::uuid,$2::uuid,$3::uuid,'panoramic','{"version":1,"acceptedAt":"2026-10-28T00:00:00Z"}'::jsonb)`, [source, patient, study]);
const request = (kind, ack = false) => one(`select * from public.smyl_radiograph_request_ai_run($1::uuid,$2,$3::boolean)`, [SRC, kind, ack]);
const complete = (runId, status, output, failure = '') => one(`select * from public.smyl_radiograph_complete_ai_run($1::uuid,$2,$3::jsonb,$4)`, [runId, status, output ? JSON.stringify(output) : null, failure]);
const decide = (candidate, rev, state, payload = {}, note = '') => one(`select * from public.smyl_radiograph_decide_candidate($1::uuid,$2::int,$3,$4::jsonb,$5)`, [candidate, rev, state, JSON.stringify(payload), note]);

test('Etapa 0: con las banderas apagadas el flujo v2 no existe para nadie, ni para la dueña', { skip }, async () => {
  await as(U.ownerA);
  const caps = (await one('select public.smyl_radiograph_ai_capabilities() as c')).c;
  assert.deepEqual(Object.values(caps.flags), [false, false, false, false, false]);
  assert.equal(caps.clinicalApprove, true);
  await rejects(register(), '42501', /no está habilitada/);
  await rejects(sql('select * from public.smyl_radiograph_feature_flags'), '42501');
  await rejects(sql('select * from public.smyl_radiograph_engines'), '42501');
  await rejects(sql(`select * from public.smyl_radiograph_active_engine('qc')`), '42501');
  await rejects(sql(`select public.smyl_radiograph_flag_enabled('radiograph.qc_v2','${U.ownerB}')`), '42501', /permission denied/);
  await asServer();
  await rejects(sql(`insert into public.smyl_radiograph_engines(kind,provider,name,version,contract_version,config) values ('qc','other','x','3',1,'{"auth":{"token":"nope"}}')`), '23514');
});

test('Etapa 0: piloto por clínica — encender qc_v2 para A no lo enciende para B', { skip }, async () => {
  await asServer();
  await exec(`insert into public.smyl_radiograph_flag_tenants(key,tenant_id,enabled) values ('radiograph.qc_v2','${U.ownerA}',true)`);
  await as(U.ownerA);
  assert.equal((await one('select public.smyl_radiograph_ai_capabilities() as c')).c.flags['radiograph.qc_v2'], true);
  await as(U.ownerB);
  assert.equal((await one('select public.smyl_radiograph_ai_capabilities() as c')).c.flags['radiograph.qc_v2'], false);
});

test('Etapa 1: registrar la fuente copia ruta/hash del expediente y es idempotente', { skip }, async () => {
  await as(U.ownerA);
  const first = await register();
  assert.equal(first.storage_path, `${U.ownerA}/${P1}/${STUDY}/${SHA}.jpeg`);
  assert.equal(first.sha256, SHA);
  assert.equal(first.provenance.origin, 'dental_record_v1');
  const again = await register(P1, STUDY, '99999999-9999-4999-8999-999999999999');
  assert.equal(again.id, SRC, 'misma fuente, sin duplicado');
  await rejects(register(P1, '00000000-0000-4000-8000-000000000000'), '42501', /no pertenece al expediente/);
  await rejects(one(`select * from public.smyl_radiograph_register_source($1::uuid,$2::uuid,$3::uuid,'panoramic','{"version":1,"acceptedAt":"ayer"}'::jsonb)`, [SRC, P1, STUDY]), '22023', /Consentimiento/);
  await rejects(sql(`update public.smyl_radiograph_sources set sha256='${'cd'.repeat(32)}' where id=$1`, [SRC]), '42501');
  await asServer();
  await rejects(sql(`update public.smyl_radiograph_sources set sha256='${'cd'.repeat(32)}' where id=$1`, [SRC]), '42501', /inmutable/);
  await rejects(sql(`delete from public.smyl_radiograph_sources where id=$1`, [SRC]), '42501');
  assert.equal((await one(`select count(*)::int as n from public.smyl_radiograph_access_events where source_id=$1 and action='register'`, [SRC])).n, 1);
  assert.equal((await one(`select count(*)::int as n from public.smyl_audit_events where entity_type='smyl_radiograph_sources'`)).n, 1);
});

test('Aislamiento: otra clínica, miembro inactivo y rol sin alcance no ven ni tocan la fuente', { skip }, async () => {
  for (const [uid, label] of [[U.ownerB, 'dueña de B'], [U.inactive, 'miembro desactivado'], [U.outsider, 'odontólogo fuera del equipo tratante']]) {
    await as(uid);
    assert.equal((await rows('select id from public.smyl_radiograph_sources')).length, 0, label);
    await rejects(sql(`select public.smyl_radiograph_log_access($1::uuid,'open')`, [SRC]), '42501', undefined);
    await rejects(sql(`select * from public.smyl_radiograph_correct_study_type($1::uuid,'bitewing','x')`, [SRC]), '42501');
  }
  // Sin oráculo de existencia: desde otra clínica, un uuid real y uno inexistente responden igual.
  await as(U.ownerB);
  const msg = async id => { try { await sql(`select * from public.smyl_radiograph_correct_study_type($1::uuid,'bitewing','x')`, [id]); } catch (e) { return e.message; } };
  assert.equal(await msg(SRC), await msg('00000000-0000-4000-8000-000000000000'));
  await rejects(register(P3, STUDY, SRC), '42501', /no está habilitada/); // B no tiene la bandera: se rechaza antes de mirar expedientes
  await as(U.dentist);
  assert.equal((await rows('select id from public.smyl_radiograph_sources')).length, 1, 'odontóloga del equipo tratante sí ve P1');
  await as(U.reception);
  assert.equal((await rows('select id from public.smyl_radiograph_sources')).length, 1, 'recepción con clinical.read ve la fuente');
  await rejects(sql(`select * from public.smyl_radiograph_correct_study_type($1::uuid,'bitewing','x')`, [SRC]), '42501', /permiso/);
  await rejects(sql(`insert into public.smyl_radiograph_sources(id,tenant_id,patient_id,study_id,storage_path,sha256,mime_type,size_bytes,study_type_declared,consent,created_by)
    values (gen_random_uuid(),'${U.ownerA}','${P1}','${STUDY}','x/y/z/w.jpeg','${SHA}','image/jpeg',100,'panoramic','{"version":1,"acceptedAt":"x"}','${U.reception}')`), '42501');
  await rejects(sql(`select public.smyl_radiograph_log_access($1::uuid,'export')`, [SRC]), '22023', /no permitida desde el cliente/);
});

test('Corrección del tipo de estudio: append-only y auditada; la fuente no cambia', { skip }, async () => {
  await as(U.dentist);
  const c = await one(`select * from public.smyl_radiograph_correct_study_type($1::uuid,'bitewing','Encuadre lateral')`, [SRC]);
  assert.equal(c.value, 'bitewing');
  assert.equal((await one('select study_type_declared from public.smyl_radiograph_sources where id=$1', [SRC])).study_type_declared, 'panoramic');
  await asServer();
  await rejects(sql(`update public.smyl_radiograph_source_corrections set value='unknown' where id=$1`, [c.id]), '42501');
});

let qcRun, toothRun;
test('Ejecución QC: exige motor activo, es idempotente y el cierre válido sólo lo hace el servidor', { skip }, async () => {
  await as(U.ownerA);
  await rejects(request('qc'), '42501', /motor activo/);
  await asServer();
  await exec(`insert into public.smyl_radiograph_engines(kind,provider,name,version,contract_version,enabled) values ('qc','simulated','smyl-sim-xray','0.1.0',1,true)`);
  await rejects(sql(`insert into public.smyl_radiograph_engines(kind,provider,name,version,contract_version,enabled) values ('qc','other','x','1',1,true)`), '23505', undefined);
  await rejects(sql(`insert into public.smyl_radiograph_engines(kind,provider,name,version,contract_version,config) values ('qc','other','x','2',1,'{"api_key":"nope"}')`), '23514');
  await as(U.reception);
  await rejects(request('qc'), '42501', /permiso/);
  await as(U.dentist);
  qcRun = await request('qc');
  assert.equal(qcRun.status, 'requested');
  assert.deepEqual(qcRun.engine, ENGINE);
  assert.equal((await request('qc')).id, qcRun.id, 'misma solicitud viva');
  await rejects(complete(qcRun.id, 'completed', vectors('qc').valid[0].value), '42501'); // el navegador no cierra ejecuciones
  await asServer();
  await rejects(complete(qcRun.id, 'completed', vectors('qc').invalid[0].value), '22023');
  assert.equal((await one('select status from public.smyl_radiograph_ai_runs where id=$1', [qcRun.id])).status, 'requested');
  const wrongModel = Object.assign(structuredClone(vectors('qc').valid[1].value), { model: { provider: 'simulated', name: 'smyl-sim-xray', version: '9.9.9' } });
  await rejects(complete(qcRun.id, 'completed', wrongModel), '22023', /no identifica el motor/);
  const done = await complete(qcRun.id, 'completed', Object.assign(structuredClone(vectors('qc').valid[1].value), { model: structuredClone(ENGINE) }));
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.output.applicableAnalyses, ['tooth_localization', 'finding_candidates']);
  const repeat = await complete(qcRun.id, 'completed', done.output);
  assert.equal(repeat.completed_at.toString(), done.completed_at.toString(), 'cierre repetido idéntico: idempotente');
  await rejects(complete(qcRun.id, 'failed', null, 'timeout'), '42501', /inmutable/);
  await rejects(sql(`update public.smyl_radiograph_ai_runs set output='{}' where id=$1`, [qcRun.id]), '42501', /inmutable/);
  await rejects(sql(`delete from public.smyl_radiograph_ai_runs where id=$1`, [qcRun.id]), '42501');
});

test('Localización dental: bandera propia, QC previo, candidatos inmutables con decisión pendiente', { skip }, async () => {
  await as(U.dentist);
  await rejects(request('tooth_localization'), '42501', /no está habilitado/);
  await asServer();
  await exec(`update public.smyl_radiograph_feature_flags set enabled=true where key='radiograph.tooth_ai_v1'`);
  await exec(`insert into public.smyl_radiograph_engines(kind,provider,name,version,contract_version,enabled) values ('tooth_localization','simulated','smyl-sim-xray','0.1.0',1,true),('finding_candidates','simulated','smyl-sim-xray','0.1.0',1,true)`);
  await as(U.dentist);
  toothRun = await request('tooth_localization');
  assert.equal(toothRun.kind, 'tooth_localization');
  await asServer();
  const foreign = withSource(vectors('toothSet').valid[0].value); foreign.sourceId = '0b3a7b6e-3a0f-4b7e-9d7c-1f2e3d4c5b6a';
  await rejects(complete(toothRun.id, 'completed', foreign), '22023', /no corresponde a la fuente/);
  await rejects(complete(toothRun.id, 'completed', withSource(vectors('toothSet').invalid[1].value)), '22023');
  const done = await complete(toothRun.id, 'completed', withSource(vectors('toothSet').valid[0].value));
  assert.equal(done.status, 'completed');
  const candidates = await rows('select c.id,c.candidate_id,c.payload,d.state,d.revision from public.smyl_radiograph_candidates c join public.smyl_radiograph_decisions d on d.tenant_id=c.tenant_id and d.candidate_id=c.id where c.run_id=$1 order by c.candidate_id', [toothRun.id]);
  assert.deepEqual(candidates.map(c => [c.candidate_id, c.state, c.revision]), [['t-36', 'pending', 1], ['t-46', 'pending', 1]]);
  assert.equal(candidates[0].payload.fdiCandidate, '36');
  await rejects(sql(`update public.smyl_radiograph_candidates set payload='{}' where id=$1`, [candidates[0].id]), '42501');
});

let cand36, cand46;
test('Decisión profesional: confirmar/corregir/descartar con concurrencia optimista, versiones y aislamiento', { skip }, async () => {
  await asServer();
  [cand36, cand46] = (await rows('select id from public.smyl_radiograph_candidates where run_id=$1 order by candidate_id', [toothRun.id])).map(r => r.id);
  await as(U.ownerB);
  await rejects(decide(cand36, 1, 'confirmed'), '42501');
  await as(U.reception);
  await rejects(decide(cand36, 1, 'confirmed'), '42501', /permiso/);
  await as(U.outsider);
  await rejects(decide(cand36, 1, 'confirmed'), '42501', /no está disponible para tu rol/);
  await as(U.dentist);
  await rejects(decide(cand36, 1, 'confirmed', { fdi: '36' }), '22023', /Sólo una corrección/);
  await rejects(decide(cand36, 1, 'corrected', {}), '22023', /Corrección no válida/);
  await rejects(decide(cand36, 1, 'corrected', { fdi: '99' }), '22023');
  const confirmed = await decide(cand36, 1, 'confirmed');
  assert.equal(confirmed.state, 'confirmed'); assert.equal(confirmed.revision, 2); assert.equal(confirmed.decided_by, U.dentist);
  assert.equal((await decide(cand36, 1, 'confirmed')).revision, 2, 'repetición idempotente');
  await rejects(decide(cand36, 1, 'rejected'), 'PT409', /otra sesión/);
  const corrected = await decide(cand46, 1, 'corrected', { fdi: '47', label: 'Renumerada por el profesional' }, 'Superposición con 46');
  assert.equal(corrected.revision, 2); assert.deepEqual(corrected.payload, { fdi: '47', label: 'Renumerada por el profesional' });
  const rejected = await decide(cand46, 2, 'rejected');
  assert.equal(rejected.state, 'rejected'); assert.deepEqual(rejected.payload, {});
  const versions = await rows('select revision,snapshot->>\'state\' as state from public.smyl_radiograph_decision_versions where candidate_id=$1 order by revision', [cand46]);
  assert.deepEqual(versions.map(v => [v.revision, v.state]), [[2, 'corrected'], [3, 'rejected']]);
  // Para el informe: 46 vuelve a 'rejected' en la revisión 5 (después de la confirmación de prueba en la 4).
  assert.equal((await one('select payload->>\'fdiCandidate\' as fdi from public.smyl_radiograph_candidates where id=$1', [cand46])).fdi, '46', 'el candidato original se conserva');
  assert.equal((await decide(cand46, 3, 'confirmed', null)).revision, 4, 'payload JSON null equivale a {}');
  await rejects(decide(cand36, 2, 'corrected', { visibility: 'hidden' }), '22023', /Corrección no válida/);
  assert.deepEqual((await decide(cand36, 2, 'corrected', { visibility: 'not_evaluable', label: 'Superposición' })).payload, { visibility: 'not_evaluable', label: 'Superposición' });
  assert.equal((await decide(cand36, 3, 'confirmed')).revision, 4, 'vuelve a confirmada para el informe');
  await asServer();
  await rejects(sql(`update public.smyl_radiograph_decisions set state='rejected' where candidate_id=$1`, [cand46]), '42501', /revisión nueva/);
  await rejects(sql(`delete from public.smyl_radiograph_decisions where candidate_id=$1`, [cand46]), '42501');
  await as(U.ownerB);
  assert.equal((await rows('select * from public.smyl_radiograph_decisions')).length, 0);
  assert.equal((await rows('select * from public.smyl_radiograph_decision_versions')).length, 0);
});

test('QC no utilizable bloquea análisis; un timeout incierto nunca se reintenta solo', { skip }, async () => {
  await asServer();
  await exec(`insert into public.smyl_dental_records(patient_id,tenant_id,revision,document,updated_by) values ('${P2}','${U.ownerA}',1,
    '{"studies":[{"id":"${STUDY}","type":"periapical","asset":{"path":"${U.ownerA}/${P2}/${STUDY}/${'ef'.repeat(32)}.png","sha256":"${'ef'.repeat(32)}","bytes":2048,"mime":"image/png"}}]}','${U.ownerA}')`);
  await as(U.ownerA);
  const src2 = '77777777-7777-4777-8777-777777777777';
  await register(P2, STUDY, src2);
  const run = await one(`select * from public.smyl_radiograph_request_ai_run($1::uuid,'qc',false)`, [src2]);
  await asServer();
  await rejects(complete(run.id, 'unconfirmed', null, ''), '22023', /código de falla/);
  await complete(run.id, 'unconfirmed', null, 'timeout');
  await as(U.ownerA);
  await rejects(sql(`select * from public.smyl_radiograph_request_ai_run($1::uuid,'qc',false)`, [src2]), '23514', /sin confirmar/);
  const retry = await one(`select * from public.smyl_radiograph_request_ai_run($1::uuid,'qc',true)`, [src2]);
  assert.notEqual(retry.id, run.id);
  await asServer();
  await complete(retry.id, 'completed', Object.assign(structuredClone(vectors('qc').valid[2].value), { model: structuredClone(ENGINE) }));
  await as(U.ownerA);
  await rejects(sql(`select * from public.smyl_radiograph_request_ai_run($1::uuid,'tooth_localization',false)`, [src2]), '23514', /control de calidad no habilita/);
  // Ciclo de vida: borrar al paciente arrastra su evidencia (cascada), pero el borrado directo sigue bloqueado.
  await asServer();
  await rejects(sql(`delete from public.smyl_radiograph_ai_runs where source_id=$1`, [src2]), '42501');
  await exec(`delete from public.camila_pacientes where id='${P2}'`);
  assert.equal((await rows('select id from public.smyl_radiograph_sources where id=$1', [src2])).length, 0);
  assert.equal((await rows('select id from public.smyl_radiograph_ai_runs where source_id=$1', [src2])).length, 0);
});

test('Informe: borrador versionado, firma sólo con hallazgos confirmados/corregidos, hash inmutable, adendas y exportación', { skip }, async () => {
  const doc = findings => ({ schema: 1, sections: { description: 'Panorámica revisada por la profesional.', technicalLimitations: '', clinicalCorrelation: '', missingInformation: '', complementaryStudies: '' }, findings });
  const f36 = { candidateId: cand36, tooth: '36', text: 'Pieza 36 localizada y confirmada.', priority: 'routine' };
  const f46 = { candidateId: cand46, tooth: '46', text: 'Pieza descartada por la profesional.', priority: 'routine' };
  const save = (rev, d) => one(`select * from public.smyl_radiograph_save_report_draft($1::uuid,$2::uuid,$3::int,$4::jsonb)`, [RPT, SRC, rev, JSON.stringify(d)]);
  await as(U.dentist);
  await rejects(save(0, doc([f36])), '42501', /no está habilitado/);
  await asServer();
  await exec(`update public.smyl_radiograph_feature_flags set enabled=true where key='radiograph.report_v1'`);
  await as(U.dentist);
  await rejects(save(0, doc([Object.assign({}, f36, { candidateId: '0b3a7b6e-3a0f-4b7e-9d7c-1f2e3d4c5b6a' })])), '22023', /otra fuente/);
  await decide(cand46, 4, 'rejected');
  const draft = await save(0, doc([f36, f46]));
  assert.equal(draft.status, 'draft'); assert.equal(draft.revision, 1);
  await rejects(save(0, doc([f36])), 'PT409');
  await rejects(sql(`select * from public.smyl_radiograph_sign_report($1::uuid,1)`, [RPT]), '23514', /confirmados o corregidos/);
  const draft2 = await save(1, doc([f36]));
  assert.equal(draft2.revision, 2);
  await as(U.ownerA);
  await rejects(sql(`select * from public.smyl_radiograph_sign_report($1::uuid,2)`, [RPT]), '23514', /profesional registrado/);
  const blank = Object.assign(doc([f36]), { sections: Object.assign({}, doc([]).sections, { description: '\n\n\n' }) });
  assert.equal((await save(2, blank)).revision, 3, 'borrador con descripción vacía se guarda');
  await rejects(sql(`select * from public.smyl_radiograph_sign_report($1::uuid,3)`, [RPT]), '23514', /antes de firmar/);
  await as(U.dentist);
  assert.equal((await save(3, doc([f36]))).revision, 4);
  await as(U.reception);
  await rejects(sql(`select * from public.smyl_radiograph_sign_report($1::uuid,4)`, [RPT]), '42501', /permiso/);
  await as(U.ownerB);
  await rejects(sql(`select * from public.smyl_radiograph_sign_report($1::uuid,4)`, [RPT]), '42501');
  await as(U.dentist);
  const signed = await one(`select * from public.smyl_radiograph_sign_report($1::uuid,4)`, [RPT]);
  assert.equal(signed.status, 'signed'); assert.equal(signed.revision, 5); assert.match(signed.signed_hash, /^[a-f0-9]{64}$/);
  assert.equal(signed.signed_professional_id, 'b0000000-0000-4000-8000-000000000001');
  assert.deepEqual(signed.signed_decisions.map(d => [d.candidateId, d.state, d.revision]), [[cand36, 'confirmed', 4]], 'snapshot de decisiones firmadas');
  assert.equal((await one(`select * from public.smyl_radiograph_sign_report($1::uuid,4)`, [RPT])).signed_hash, signed.signed_hash, 'firma repetida: idempotente');
  await rejects(save(5, doc([])), '42501', /sólo admite adendas/);
  await rejects(decide(cand36, 4, 'rejected'), '23514', /informe firmado; registra una adenda/);
  assert.equal((await decide(cand46, 5, 'confirmed')).revision, 6, 'un candidato fuera del informe sí puede reconsiderarse');
  await asServer();
  await rejects(sql(`update public.smyl_radiograph_reports set document='{}' where id=$1`, [RPT]), '42501', /sólo admite adendas/);
  await rejects(sql(`delete from public.smyl_radiograph_reports where id=$1`, [RPT]), '42501');
  assert.equal((await one(`select public.smyl_radiograph_report_hash(document) = signed_hash as ok from public.smyl_radiograph_reports where id=$1`, [RPT])).ok, true);
  assert.deepEqual((await rows('select revision from public.smyl_radiograph_report_versions where report_id=$1 order by revision', [RPT])).map(r => r.revision), [1, 2, 3, 4, 5]);
  await as(U.dentist);
  const addendum = await one(`select * from public.smyl_radiograph_add_report_addendum($1::uuid,'Se complementa con hallazgo clínico posterior.','Correlación clínica')`, [RPT]);
  assert.equal(addendum.report_id, RPT);
  await as(U.reception);
  const exported = (await one(`select public.smyl_radiograph_export_report($1::uuid) as e`, [RPT])).e;
  assert.equal(exported.report.signed_hash, signed.signed_hash);
  assert.equal(exported.signedDecisions[0].state, 'confirmed');
  assert.equal(exported.source.sha256, SHA); assert.equal(exported.source.studyTypeCurrent, 'bitewing');
  assert.equal(exported.runs.length, 2); assert.deepEqual(exported.runs[0].engine, ENGINE);
  assert.equal(exported.addenda.length, 1); assert.match(exported.notice, /No constituye diagnóstico/);
  assert.equal(JSON.stringify(exported).includes('storage_path'), false, 'la exportación no expone rutas de Storage');
  await rejects(sql(`select * from public.smyl_radiograph_add_report_addendum($1::uuid,'x y','z w')`, [RPT]), '42501', /permiso/);
  await as(U.ownerB);
  await rejects(sql(`select public.smyl_radiograph_export_report($1::uuid)`, [RPT]), '42501');
  await as(U.ownerA);
  const actions = (await rows(`select action,count(*)::int as n from public.smyl_radiograph_access_events where source_id=$1 group by action order by action`, [SRC])).map(r => `${r.action}:${r.n}`);
  // decide:6 — la repetición idempotente de una decisión no genera evento.
  assert.deepEqual(actions, ['addendum:1', 'correct:1', 'decide:8', 'engine_result:2', 'export:1', 'register:1', 'report_draft:4', 'send_to_engine:2', 'sign_report:1']);
  await as(U.dentist);
  assert.equal((await rows('select * from public.smyl_radiograph_access_events')).length, 0, 'sin audit.read no se lee la auditoría');
});

test('Vectores de contrato: los validadores SQL dan el mismo veredicto que navegador y servidor', { skip }, async () => {
  await asServer();
  const check = async (fn, value) => { try { await sql(`select public.${fn}($1::jsonb)`, [JSON.stringify(value)]); return 'valid'; } catch (e) { return e.message; } };
  for (const [name, fn] of [['qc', 'smyl_radiograph_validate_qc'], ['toothSet', 'smyl_radiograph_validate_tooth_set'], ['findingSet', 'smyl_radiograph_validate_finding_set']]) {
    const { valid, invalid } = vectors(name);
    for (const { name: label, value } of valid) assert.equal(await check(fn, value), 'valid', `SQL rechazó "${label}"`);
    for (const { name: label, value } of invalid) assert.notEqual(await check(fn, value), 'valid', `SQL aceptó "${label}"`);
  }
  const report = vectors('report');
  const checkReport = async (value, strict) => { try { await sql(`select public.smyl_radiograph_validate_report($1::jsonb,$2::boolean)`, [JSON.stringify(value), strict]); return 'valid'; } catch (e) { return e.message; } };
  for (const { name: label, value } of report.valid) assert.equal(await checkReport(value, true), 'valid', label);
  for (const { name: label, value } of report.invalid) assert.notEqual(await checkReport(value, false), 'valid', label);
  for (const { value } of report.strictOnly) { assert.equal(await checkReport(value, false), 'valid'); assert.notEqual(await checkReport(value, true), 'valid'); }
});
