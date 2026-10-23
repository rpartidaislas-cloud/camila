import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(resolve(root,name),'utf8');
const ui=read('smyl-patient-record-stage2.js');
const patient=read('smyl-patient-360.js');
const css=read('smyl-patient-record-stage2.css');

test('el expediente elimina el tablero duplicado y presenta una lectura única',()=>{
  assert.match(ui,/retira el resumen clínico duplicado/);
  assert.match(ui,/\.patient-record-stage2/);
  assert.match(css,/display:none!important/);
  assert.match(patient,/SIGUIENTE PASO/);
  assert.match(patient,/Resumen clínico/);
});

test('el asistente organiza datos sin diagnosticar ni modificar el expediente',()=>{
  for(const label of ['ASISTENTE DE FICHA','Resumen previo a la atención','Por confirmar','Siguiente paso sugerido']) assert.match(patient,new RegExp(label));
  assert.match(patient,/Apoyo, no diagnóstico/);
  assert.match(patient,/no modifica registros/);
  assert.doesNotMatch(patient,/fetch\(|openai|anthropic/i);
});

test('la historia clínica abre en lectura y edita sólo bajo demanda',()=>{
  assert.match(patient,/function historyForm\(s,editing\)/);
  assert.match(patient,/data-history-edit/);
  assert.match(patient,/data-history-cancel/);
  assert.match(patient,/historyForm\(s,false\)/);
});

test('web, móvil y PWA distribuyen la etapa dos con diseño responsive',()=>{
  const app=read('app.html'),mobile=read('mobile/www/app.html'),worker=read('sw.js');
  assert.equal(app,mobile);
  assert.match(app,/smyl-patient-record-stage2\.css\?v=2/);
  assert.match(app,/smyl-patient-record-stage2\.js\?v=2/);
  assert.match(worker,/smyl-v258-usage-api-ready/);
  assert.match(worker,/smyl-patient-record-stage2\.js\?v=2/);
  assert.equal(ui,read('mobile/www/smyl-patient-record-stage2.js'));
  assert.equal(css,read('mobile/www/smyl-patient-record-stage2.css'));
  assert.match(read('smyl-patient-360.css'),/@media\(max-width:600px\)/);
});
