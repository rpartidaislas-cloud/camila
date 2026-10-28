// Radiografía asistida — Etapa 7: infraestructura de validación clínica (migración, panel, divulgación).
// Las métricas, el consenso de referencia, el informe inmutable y la pausa por clínica se verifican
// en Postgres real en tests/radiograph-pglite-stage1.test.mjs; la pantalla, en el navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const V = require('../smyl-radiograph-validation.js');
const migration = read('supabase/migrations/20261028150000_smyl_radiograph_validation.sql');
const protocol = read('docs/RADIOGRAPH_VALIDATION_PROTOCOL.md');

test('divulgación: motor (y si es simulado), validación y límites; sin informe se declara uso piloto', () => {
  const d = V.disclosureSummary({ engines: [{ kind: 'qc', provider: 'simulated', name: 'smyl-sim-xray', version: '0.1.0', updatedAt: '2026-10-28T00:00:00Z', simulated: true }], validation: null, openIncidents: 2, limits: ['L1'] });
  assert.match(d.engines, /Control de calidad: simulated \/ smyl-sim-xray 0\.1\.0 \(simulado\) · actualizado 2026-10-28/);
  assert.match(d.validation, /Sin informe de validación aprobado: uso piloto/);
  assert.equal(d.simulated, true); assert.equal(d.openIncidents, 2);
  const ok = V.disclosureSummary({ engines: [], validation: { version: 2, verdict: 'approved_for_pilot', approvedAt: '2026-11-01T00:00:00Z', setName: 'Piloto' }, limits: [] });
  assert.match(ok.validation, /Validación v2 \(Piloto\): aprobada para piloto · 2026-11-01/);
  assert.equal(V.disclosureSummary(null).validation, 'Validación: sin informe.');
});

test('criterios de salida: el peor grupo de cada tarea decide, igual que el servidor', () => {
  const metrics = { groups: [{ task: 'tooth_localization', sensitivity: .97, specificity: .99, precision: .96 }, { task: 'tooth_localization', sensitivity: .91, specificity: .99, precision: .97 }], disagreement: [{ task: 'finding_candidates', rate: .3 }], runs: [{ task: 'tooth_localization', runs: 50, unconfirmed: 2 }] };
  const ev = V.evaluateCriteria(metrics, V.DEFAULT_CRITERIA);
  const by = Object.fromEntries(ev.map(c => [c.metric + ':' + c.task, c]));
  assert.deepEqual([by['sensitivity:tooth_localization'].value, by['sensitivity:tooth_localization'].met], [.91, false]);
  assert.deepEqual([by['specificity:tooth_localization'].value, by['specificity:tooth_localization'].met], [.99, true]);
  assert.deepEqual([by['disagreementRate:finding_candidates'].value, by['disagreementRate:finding_candidates'].met], [.3, true]);
  assert.deepEqual([by['unconfirmedRate:tooth_localization'].value, by['unconfirmedRate:tooth_localization'].met], [.04, false]);
  assert.equal(by['sensitivity:finding_candidates'].value, null, 'sin datos no se cumple');
  assert.equal(by['sensitivity:finding_candidates'].met, false);
  assert.throws(() => V.parseCriteria('nope'), /arreglo JSON/);
  assert.throws(() => V.parseCriteria('[{"metric":"accuracy","task":"tooth_localization","min":1}]'), /no válido/);
  assert.equal(V.parseCriteria(JSON.stringify(V.DEFAULT_CRITERIA)).length, 7);
});

test('migración 150000: conjuntos independientes, referencia inmutable con consenso, métricas, informe inmutable, pausa por clínica', () => {
  assert.match(migration, /^begin;/m); assert.match(migration, /^commit;/m);
  assert.match(migration, /training_exposure boolean not null default false/);
  assert.match(migration, /El conjunto contiene fuentes con posible exposición al entrenamiento; no es un conjunto de prueba independiente\./);
  assert.match(migration, /create trigger smyl_radiograph_reference_annotations_immutable before update or delete/);
  assert.match(migration, /create trigger smyl_radiograph_validation_reports_immutable before update or delete/);
  assert.match(migration, /case when v\.adjudicated then v\.adjudicated_present when v\.yes > v\.no then true when v\.no > v\.yes then false else null end/, 'adjudicación > mayoría; empate = desacuerdo');
  assert.match(migration, /'sensitivity', case when g\.tp \+ g\.fn > 0/);
  assert.match(migration, /'specificity', case when g\.tn is not null and g\.tn \+ g\.fp > 0/);
  assert.match(migration, /sum\(32 - \(positives \+ fn\)\)/, 'universo FDI permanente de 32 para especificidad de piezas');
  assert.match(migration, /width_bucket\(confidence, 0, 1\.0000001, 5\)/);
  assert.match(migration, /'truthSource', case when g\.with_reference = g\.sources then 'reference' when g\.with_reference = 0 then 'professional_decisions' else 'mixed' end/);
  assert.match(migration, /Sin mediciones de nivel óseo ni distancias: método no validado\./);
  assert.match(migration, /select min\(\(g->>\(v_c->>'metric'\)\)::numeric\) into v_value/, 'el peor grupo decide');
  assert.match(migration, /encode\(sha256\(convert_to\(\(v_metrics::text \|\| p_exit_criteria::text\), 'UTF8'\)\), 'hex'\)/);
  assert.match(migration, /smyl_has_permission\(v_tenant, 'clinic\.manage'\)/, 'la pausa por clínica es de quien administra');
  assert.match(migration, /\(select t\.enabled from public\.smyl_radiograph_flag_tenants t where t\.key = p_key and t\.tenant_id = p_tenant\),\s*\(select f\.enabled from public\.smyl_radiograph_feature_flags f where f\.key = p_key\)/, 'la fila del tenant gana para que la pausa funcione');
  assert.doesNotMatch(migration, /e\.config|api_key/, 'la divulgación nunca expone config ni credenciales');
  for (const fn of ['smyl_radiograph_validation_guard()', 'smyl_radiograph_reference_truth(uuid, uuid)']) assert.match(migration, new RegExp(`revoke all on function public\\.${fn.replace(/[()]/g, '\\$&')} from public, anon, authenticated`));
  for (const fn of ['smyl_radiograph_validation_metrics(uuid)', 'smyl_radiograph_monitoring(integer)', 'smyl_radiograph_record_validation_report(uuid, jsonb, text)', 'smyl_radiograph_set_tenant_flag(text, boolean)', 'smyl_radiograph_model_disclosure()']) assert.match(migration, new RegExp(`grant execute on function public\\.${fn.replace(/[()]/g, '\\$&')} to authenticated`));
});

test('protocolo: uso previsto, separación entrenamiento/prueba, referencia multi-odontólogo, métricas, equipo humano+IA, criterios, monitoreo, regulatorio', () => {
  for (const h of ['## 1. Uso previsto', '## 2. Datos y separación entrenamiento / prueba', '## 3. Referencia anotada por varios odontólogos', '## 4. Métricas', '## 5. Prueba del equipo humano + IA', '## 6. Criterios de salida', '## 7. Monitoreo, incidentes y desactivación', '## 8. Divulgación en la interfaz', '## 9. Regulatorio y privacidad (México)']) assert.ok(protocol.includes(h), h);
  assert.match(protocol, /COFEPRIS/); assert.match(protocol, /no autoriza\s+uso diagnóstico/i);
  assert.match(protocol, /"metric": "sensitivity", "task": "tooth_localization", "min": 0\.95/);
});

test('cableado: divulgación en la mesa, panel sólo con aprobación clínica, web/PWA/móvil sincronizados', () => {
  const mesa = read('smyl-radiograph-review-v2.js'), app = read('app.html'), sw = read('sw.js');
  assert.match(mesa, /client\.rpc\('smyl_radiograph_model_disclosure'\)/);
  assert.match(mesa, /d\.simulated\?'Motor simulado · sin validación clínica':'Motor y validación'/);
  assert.match(mesa, /run\.api\.caps\.clinicalApprove===true&&typeof V\.open==='function'/);
  for (const tag of ['smyl-radiograph-validation.css?v=1', 'smyl-radiograph-validation.js?v=1', 'smyl-radiograph-review-v2.js?v=4', 'smyl-radiograph-review-v2.css?v=2']) { assert.ok(app.includes(tag), tag); assert.ok(sw.includes('/camila/' + tag), tag); }
  assert.match(sw, /radiograph-validation-v50/);
  for (const file of ['app.html', 'sw.js', 'smyl-radiograph-review-v2.js', 'smyl-radiograph-review-v2.css', 'smyl-radiograph-validation.js', 'smyl-radiograph-validation.css']) assert.equal(read('mobile/www/' + file), read(file), 'mobile/www desincronizado: ' + file);
});
