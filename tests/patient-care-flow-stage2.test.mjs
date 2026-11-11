import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const flow = read('../smyl-case-workspace.js');
const flowCss = read('../smyl-case-workspace.css');
const patient = read('../smyl-patient-360.js');
const schedule = read('../smyl-schedule.js');

test('la ficha conserva una sola identidad y accesos rápidos del paciente', () => {
  assert.match(flow, /cw-patient-head/);
  assert.match(flow, /PACIENTE ACTUAL/);
  assert.match(flow, /SmylPatient360\?\.open/);
  assert.match(flow, /smyl:patient-summary/);
  assert.match(patient, /nextAppointment/);
  assert.match(patient, /window\.SmylPatient360=Object\.freeze/);
  assert.match(flowCss, /\.cw-enhanced>\.clinic-patient-heading\{display:none\}/);
});

test('el recorrido separa evaluación, propuesta, aceptación y seguimiento', () => {
  for (const label of ['Evaluación', 'Propuesta', 'Aceptación', 'Seguimiento e historial', 'Preparar cotización']) {
    assert.match(flow, new RegExp(label));
  }
  assert.match(flow, /const approval=module\(ctx,'approval','03','Aceptación'/);
  assert.match(flow, /const followup=module\(ctx,'followup','04','Seguimiento e historial'/);
  assert.match(flow, /id==='share'\?'approval'/);
  assert.match(flow, /copy\(ctx\.planNext,'Continuar a aceptación'\)/);
  assert.match(flow, /ctx\.planNext\.onclick=\(\)=>open\('approval'\)/);
  assert.match(flow, /const quoteReady=!!clinical\?\.ready,eligible=pairs>0&&planComplete/);
  assert.match(flow, /ctx\.quoteButton\.disabled=!quoteReady/);
  assert.match(flow, /Preparar presentación mySmyl/);
  assert.match(flow, /approval\.body\.append\(actions/);
  assert.match(flow, /followup\.body\.append\(ctx\.evolution\)/);
  assert.match(flow, /no envía nada automáticamente/i);
});

test('Agenda abre la ficha para cualquier rol con clinical.read', () => {
  assert.match(schedule, /state\.canReadClinical=owner\|\|perms\.has\('clinical\.read'\)/);
  assert.match(schedule, /Ficha del paciente/);
  assert.doesNotMatch(flow, /window\.miRolEquipo==='dueño'&&document\.getElementById/);
});

test('web, móvil y PWA publican la misma etapa', () => {
  assert.match(app, /smyl-case-workspace\.js\?v=32/);
  assert.match(app, /smyl-case-workspace\.css\?v=24/);
  assert.match(app, /smyl-patient-360\.js\?v=26/);
  assert.match(app, /smyl-schedule\.js\?v=(?:1[1-9]|[2-9][0-9])/);
  assert.match(worker, /smyl-v263-lana-connection-recovery/);
  for (const file of ['app.html','sw.js','smyl-case-workspace.js','smyl-case-workspace.css','smyl-patient-360.js','smyl-schedule.js']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
