// Radiografía asistida — Etapa 6: historia longitudinal (modelo de navegador, migración y cableado).
// Los RPC y la cronología se verifican en Postgres real en tests/radiograph-pglite-stage1.test.mjs;
// la pantalla, en tests/smyl-radiograph-longitudinal-browser.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const L = require('../smyl-radiograph-longitudinal.js');
const migration = read('supabase/migrations/20261028140000_smyl_radiograph_longitudinal.sql');
const cid = n => `c${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
const tooth = (id, fdi, state) => ({ candidate: { id: cid(id), kind: 'tooth', candidate_id: 't-' + fdi, payload: { fdiCandidate: fdi, fdiProbability: .9, geometry: { kind: 'bbox', coordinateSpace: 'source-normalized', points: [[.1, .1], [.2, .2]] }, visibility: 'complete', alternatives: [] } }, decision: { candidate_id: cid(id), state, revision: state === 'pending' ? 1 : 2, payload: {}, decided_by: 'd', decided_at: state === 'pending' ? null : '2026-01-01T00:00:00Z' } });
const finding = (id, fdi, category, state) => ({ candidate: { id: cid(id), kind: 'finding', candidate_id: 'f-' + id, payload: { toothCandidate: fdi, category, label: category, confidence: .8, regions: [] } }, decision: { candidate_id: cid(id), state, revision: 2, payload: {}, decided_by: 'd', decided_at: '2026-01-01T00:00:00Z' } });
const state = (...items) => ({ candidates: items.map(i => i.candidate), decisions: items.map(i => i.decision), runs: [] });

test('compatibilidad: misma regla que el servidor; los incompatibles explican por qué', () => {
  const pan = (extra) => Object.assign({ studyType: 'panoramic', qcStatus: 'usable', linkKind: null }, extra);
  assert.equal(L.compatibility(pan(), pan()).verdict, 'comparable');
  assert.deepEqual([L.compatibility(pan(), pan({ studyType: 'periapical' })).reason, L.compatibility(pan(), pan({ qcStatus: null })).reason, L.compatibility(pan(), pan({ qcStatus: 'unusable' })).reason, L.compatibility(pan(), pan({ linkKind: 'incompatible' })).reason], ['different_study_type', 'missing_qc', 'unusable_quality', 'professional_incompatible']);
  for (const code of ['different_study_type', 'missing_qc', 'unusable_quality', 'professional_incompatible']) assert.ok(L.reasonText(code).length > 20, code);
  assert.equal(L.compatibility(null, pan()).verdict, 'incompatible');
});

test('las diferencias de adquisición se separan de los cambios clínicos', () => {
  const a = { studyClass: { value: 'panoramic' }, quality: { status: 'usable', flags: [] } };
  const b = { studyClass: { value: 'panoramic' }, quality: { status: 'limited', flags: [{ code: 'anterior_blur' }] } };
  const out = L.acquisitionDifferences(a, b);
  assert.deepEqual(out, ['Calidad: usable → limited.', 'Nueva señal técnica en el estudio actual: desenfoque anterior.']);
  assert.deepEqual(L.acquisitionDifferences(a, a), ['Sin diferencias de adquisición registradas por el control de calidad.']);
});

test('emparejamiento por pieza: confirmado vs propuesto por IA vs estable vs sin decisión; nunca mediciones', () => {
  const previous = state(tooth(1, '16', 'confirmed'), tooth(2, '15', 'confirmed'), finding(3, '15', 'restoration', 'confirmed'), tooth(4, '14', 'confirmed'), tooth(5, '46', 'confirmed'), finding(6, '46', 'density', 'pending'));
  const current = state(tooth(11, '16', 'confirmed'), tooth(12, '15', 'confirmed'), tooth(14, '14', 'pending'), tooth(15, '46', 'confirmed'), finding(16, '36', 'restoration', 'pending'));
  const pairs = L.pairByTooth(previous, current);
  const by = Object.fromEntries(pairs.rows.map(r => [r.fdi, r]));
  assert.equal(by['16'].category, 'stable');
  assert.equal(by['15'].category, 'confirmed', 'señal confirmada antes y ausente ahora, ambas decididas');
  assert.match(by['15'].detail[0], /Señales confirmadas: restoration → ninguna/);
  assert.equal(by['14'].category, 'ai_proposed', 'el lado actual sólo tiene una propuesta pendiente');
  assert.equal(by['46'].category, 'ai_proposed', 'ambos decididos iguales pero hay una propuesta pendiente');
  assert.equal(by['36'].category, 'ai_proposed');
  assert.deepEqual([pairs.confirmed.length, pairs.aiProposed.length, pairs.stable.length, pairs.unverified.length], [1, 3, 1, 0]);
  assert.equal(pairs.measurements, null);
  assert.match(pairs.measurementsNote, /no están validadas/);
  assert.doesNotMatch(JSON.stringify(pairs), /progres|diagn|mm\b/i);
});

test('migración 140000: veredicto explícito, bandera obligatoria, vínculo revocable y cronología sin texto clínico', () => {
  assert.match(migration, /^begin;/m); assert.match(migration, /^commit;/m);
  assert.match(migration, /smyl_radiograph_flag_enabled\('radiograph\.longitudinal_v1', v_tenant\)/);
  assert.match(migration, /then 'different_study_type'[\s\S]*then 'missing_qc'[\s\S]*then 'unusable_quality'/);
  assert.match(migration, /revoke all on function public\.smyl_radiograph_effective_study_type\(uuid, uuid\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.smyl_radiograph_comparable_sources\(uuid\) to authenticated/);
  assert.match(migration, /update public\.smyl_radiograph_study_links set revoked_at = clock_timestamp\(\), revoked_by = auth\.uid\(\)/);
  assert.match(migration, /'compare', v_b\)/);
  const fn = migration.slice(migration.indexOf('create or replace function public.smyl_patient_timeline'), migration.indexOf('revoke all on function public.smyl_patient_timeline'));
  assert.match(fn, /'radiograph_source','Radiografía registrada para revisión asistida','registered'/);
  assert.match(fn, /'Informe radiográfico firmado' else 'Informe radiográfico en borrador'/);
  assert.doesNotMatch(fn, /report\.document|source\.storage_path|source\.sha256|signed_hash|\.consent/, 'la cronología nunca expone documento, rutas, hashes ni consentimiento');
  assert.match(fn, /smyl_has_permission\(v_tenant,'clinical\.read'\)[\s\S]*smyl_can_access_patient\(patient\.tenant_id,patient\.id,'clinical'\)/);
  for (const t of ['appointment', 'clinical_note', 'file', 'dental_record', 'photo_review', 'radiograph_review', 'clinical_plan', 'proposal', 'proposal_event', 'finance_charge', 'finance_payment', 'finance_refund', 'finance_receipt', 'cfdi', 'conversation_link', 'conversation_file']) assert.match(fn, new RegExp(`'${t}'`), 'se conservan los eventos previos: ' + t);
  const sources = read('supabase/migrations/20261028110000_smyl_radiograph_sources_v2.sql');
  assert.match(sources, /create unique index if not exists smyl_radiograph_study_links_active_idx[\s\S]*where revoked_at is null/);
  assert.doesNotMatch(sources, /unique \(tenant_id, source_a, source_b\)/);
  assert.match(sources, /'export','compare'\)/);
});

test('cableado: mesa v2 compara sólo con comparables y explica los demás; Ficha 360 resume y abre la fuente canónica', () => {
  const mesa = read('smyl-radiograph-review-v2.js'), p360 = read('smyl-patient-360.js'), app = read('app.html'), sw = read('sw.js'), ui = read('smyl-radiograph-longitudinal.js');
  assert.match(mesa, /client\.rpc\('smyl_radiograph_comparable_sources'/);
  assert.match(mesa, /c\.verdict==='comparable'&&c\.link_kind!=='incompatible'/);
  assert.match(mesa, /b\.disabled=!ok/, 'los incompatibles no se abren');
  assert.match(mesa, /'No comparable: '\+\(L\.reasonText/);
  assert.match(mesa, /client\.storage\.from\(source\.bucket\|\|'smyl-radiographs'\)\.download\(source\.storage_path\)/, 'el archivo anterior se descarga por su ruta conocida, nunca por URL');
  assert.doesNotMatch(ui, /\bmm\b|calibrat|measureBone|distance\(/i, 'ningún cálculo de distancias ni calibración');
  assert.match(ui, /MEASUREMENTS_NOTE/);
  assert.match(ui, /wrap\.addEventListener\('scroll'/, 'desplazamiento sincronizado');
  assert.match(ui, /'Alternar anterior \/ actual'/);
  assert.match(p360, /radiograph_source:'Radiografía',radiograph_report:'Informe radiográfico'/);
  assert.match(p360, /'radiograph_source','radiograph_report','clinical_plan'/);
  for (const tag of ['smyl-radiograph-longitudinal.css?v=1', 'smyl-radiograph-longitudinal.js?v=1', 'smyl-radiograph-review-v2.js?v=3', 'smyl-patient-360.js?v=15']) { assert.ok(app.includes(tag), tag); assert.ok(sw.includes('/camila/' + tag), tag); }
  assert.match(sw, /radiograph-longitudinal-v49/);
  for (const file of ['app.html', 'sw.js', 'smyl-radiograph-review-v2.js', 'smyl-radiograph-longitudinal.js', 'smyl-radiograph-longitudinal.css', 'smyl-patient-360.js']) assert.equal(read('mobile/www/' + file), read(file), 'mobile/www desincronizado: ' + file);
});
