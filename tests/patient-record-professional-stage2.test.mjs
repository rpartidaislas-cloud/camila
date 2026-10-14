import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(resolve(root,name),'utf8');
const ui=read('smyl-patient-record-stage2.js');
const css=read('smyl-patient-record-stage2.css');

test('el expediente presenta una lectura clínica única sin interpretar hallazgos',()=>{
  for(const label of ['ESTADO CLÍNICO ACTUAL','Antecedentes','Odontograma','Plan de tratamiento','Seguimiento']){
    assert.match(ui,new RegExp(label));
  }
  assert.match(ui,/El profesional confirma cada hallazgo y decisión/);
  assert.doesNotMatch(ui,/diagnóstico automático|tratamiento recomendado/i);
});

test('la siguiente acción conserva el orden antecedentes, mapa, plan y evolución',()=>{
  const order=['Completar antecedentes','Revisar odontograma','Construir plan','Registrar evolución'];
  let previous=-1;
  for(const label of order){const current=ui.indexOf(label);assert.ok(current>previous,label);previous=current;}
  assert.match(ui,/SmylPatient360&&window\.SmylPatient360\.open/);
  assert.match(ui,/scrollIntoView/);
});

test('el resumen deriva estados del expediente existente sin otra fuente clínica',()=>{
  assert.match(ui,/\.p360-metrics article:first-child strong/);
  assert.match(ui,/\.dr-map \.dr-tooth\.dr-noted/);
  assert.match(ui,/\.clinic-treatment/);
  assert.match(ui,/\.p360-timeline i\[data-type="clinical_note"\]/);
  assert.doesNotMatch(ui,/\.from\(|fetch\(/);
});

test('web, móvil y PWA distribuyen la etapa dos con diseño responsive',()=>{
  const app=read('app.html'),mobile=read('mobile/www/app.html'),worker=read('sw.js');
  assert.equal(app,mobile);
  assert.match(app,/smyl-patient-record-stage2\.css\?v=1/);
  assert.match(app,/smyl-patient-record-stage2\.js\?v=1/);
  assert.match(worker,/smyl-v216-executive-dashboard-stage7/);
  assert.match(worker,/smyl-patient-record-stage2\.js\?v=1/);
  assert.equal(ui,read('mobile/www/smyl-patient-record-stage2.js'));
  assert.equal(css,read('mobile/www/smyl-patient-record-stage2.css'));
  assert.match(css,/@media\(max-width:600px\)/);
});
