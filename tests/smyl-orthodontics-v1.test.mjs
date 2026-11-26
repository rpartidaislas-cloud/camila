import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const M = require('../smyl-orthodontics.js');

test('el resumen longitudinal usa hechos objetivos y no porcentajes genéricos', () => {
  assert.equal(M.noteLine({ phase: 'active', appliance: { type: 'aligner', currentAligner: 12, totalAligners: 24 }, changes: ['Se entregó el siguiente juego'] }), 'Tratamiento activo · Alineador 12 de 24 · Se entregó el siguiente juego');
  assert.equal(M.noteLine({ phase: 'retention', appliance: { type: 'retention' } }), 'Retención · Retenedor');
  assert.equal(M.noteLine(null), 'Control ortodóntico');
  assert.doesNotMatch(read('smyl-orthodontics.js'), /porcentaje de progreso|progress\s*%|avance\s*%/i);
});

test('el módulo se integra en En tratamiento y no crea otra agenda o biblioteca', () => {
  const workspace = read('smyl-case-workspace.js');
  const ui = read('smyl-orthodontics.js');
  assert.match(workspace, /window\.SmylOrthodontics\?\.attach\?\.\(ctx\)/);
  assert.match(workspace, /followup\.body\.append\(ctx\.orthodontics\)/);
  assert.match(workspace, /window\.SmylOrthodontics\?\.sync\?\.\(ctx,/);
  assert.match(ui, /openChairside\('guided-photos'/);
  assert.match(ui, /SmylPatient360\.open\('files'\)/);
  assert.doesNotMatch(ui, /window\.ir\(['"]agenda|SmylSchedule|smyl_appointments[^'"\n]*\.(?:insert|update|delete)/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|indexedDB/);
});

test('guardar un control crea un borrador estructurado y nunca firma por el profesional', () => {
  const ui = read('smyl-orthodontics.js');
  assert.match(ui, /smyl_create_clinical_note/);
  assert.match(ui, /p_note_type:\s*'progress'/);
  assert.match(ui, /orthodontics:\s*ortho/);
  assert.match(ui, /schema:\s*1/);
  assert.match(ui, /treatmentId:/);
  assert.match(ui, /controlType:/);
  assert.match(ui, /nextControl:/);
  assert.match(ui, /Guardar crea un borrador/);
  assert.doesNotMatch(ui, /smyl_sign_clinical_note|smyl_update_clinical_note/);
});

test('el historial queda consultable pero la captura falla cerrada sin plan vigente', () => {
  const ui = read('smyl-orthodontics.js');
  assert.match(ui, /function canCreate\(st\) \{ return context\(st\)\.canWrite === true && eligible\(st\.info && st\.info\.clinical\) && !!activeTreatment\(st\); \}/);
  assert.match(ui, /var show = eligible\(st\.info\.clinical\) \|\| controls\(st\)\.length > 0/);
  assert.match(ui, /if \(!canCreate\(st\) \|\| st\.saving\) return/);
  assert.match(ui, /Historial disponible en modo de consulta/);
});

test('los reintentos reutilizan el mismo identificador y comprueban la respuesta', () => {
  const ui = read('smyl-orthodontics.js');
  assert.match(ui, /form\.dataset\.noteId \|\|/);
  assert.match(ui, /form\.dataset\.noteId = id/);
  assert.match(ui, /savedId !== id/);
  assert.match(ui, /evitar duplicados/);
});

test('Ficha 360 expone sólo el contrato ortodóntico seguro y lo conserva al editar SOAP', () => {
  const patient = read('smyl-patient-360.js');
  assert.match(patient, /orthodonticControls:function\(tenant,patient\)/);
  assert.match(patient, /orthodonticContext:function\(tenant,patient\)/);
  assert.match(patient, /if\(row&&d&&d\.orthodontics\)doc\.orthodontics=d\.orthodontics/);
  assert.match(patient, /window\.SmylOrthodontics&&window\.SmylOrthodontics\.noteLine/);
  assert.doesNotMatch(patient.match(/function orthodonticControls\(s\)[\s\S]*?\n  }\n  function orthodonticContext/)?.[0] || '', /subjective|objective|assessment|diagnosis|prognosis/);
});

test('la activación depende de la categoría canónica del servicio y de un plan revisado', () => {
  const clinic = read('smyl-clinic.js');
  assert.match(clinic, /snapshot\.category === 'orthodontic' \|\| snapshot\.specialty === 'orthodontic'/);
  assert.match(clinic, /eligible:\s*!!review && orthodonticItems\.length > 0/);
  assert.doesNotMatch(clinic.match(/var orthodonticItems[\s\S]*?return \{ ready:/)?.[0] || '', /includes\(['"]ortodon|match\([^)]*ortodon/i);
});

test('web, caché PWA y copia móvil distribuyen exactamente los mismos activos', () => {
  const app = read('app.html'), sw = read('sw.js');
  for (const asset of ['smyl-orthodontics.css?v=1', 'smyl-orthodontics.js?v=1', 'smyl-clinic.js?v=28', 'smyl-patient-360.js?v=41', 'smyl-case-workspace.js?v=52']) {
    assert.ok(app.includes(asset), `falta ${asset} en app.html`);
    assert.ok(sw.includes(`/camila/${asset}`), `falta ${asset} en sw.js`);
  }
  assert.ok(app.indexOf('smyl-treatments.js?v=3') < app.indexOf('smyl-orthodontics.js?v=1'));
  assert.ok(app.indexOf('smyl-orthodontics.js?v=1') < app.indexOf('smyl-case-workspace.js?v=52'));
  assert.match(sw, /ortodoncia-longitudinal-v1/);
  for (const file of ['smyl-orthodontics.js', 'smyl-orthodontics.css', 'smyl-clinic.js', 'smyl-patient-360.js', 'smyl-case-workspace.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});

test('el contrato deja explícitos los límites y la siguiente etapa backend', () => {
  const contract = read('docs/SMYL_ORTHODONTICS_CONTRACT_V1.md');
  for (const statement of ['smyl_orthodontic_cases', 'smyl_orthodontic_controls', 'smyl_orthodontic_case_versions', 'orthodontic_case', 'Agenda queda fuera', 'referencia visual no clínica']) assert.match(contract, new RegExp(statement));
  assert.match(contract, /sin una migración adicional/i);
});
