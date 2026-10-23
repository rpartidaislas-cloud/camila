import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(resolve(root,name),'utf8');
const control=read('smyl-treatment-quote-stage3.js');
const print=read('smyl-proposal-print.js');
const css=read('smyl-treatment-quote-stage3.css');

test('el editor comprueba conceptos, mapa, precios y revisión fiscal',()=>{
  for(const label of ['Conceptos','Con mapa dental','Precios pendientes','Fiscal pendiente']){
    assert.match(control,new RegExp(label));
  }
  assert.match(control,/data-field="price"/);
  assert.match(control,/service_snapshot\.fiscal_status/);
  assert.match(control,/meta\.teeth/);
});

test('la siguiente acción lleva al primer pendiente sin aprobar automáticamente',()=>{
  for(const label of ['Completar precios','Revisar información fiscal','Relacionar piezas','Revisar y guardar']){
    assert.match(control,new RegExp(label));
  }
  assert.match(control,/scrollIntoView/);
  assert.doesNotMatch(control,/proposal-approve.*click|smyl_save_proposal/);
});

test('la propuesta para el paciente relaciona conceptos con piezas y superficies',()=>{
  assert.match(print,/proposal-dental-legend/);
  assert.match(print,/Piezas /);
  assert.match(print,/Superficies /);
  assert.match(print,/Dónde se realizará el tratamiento/);
  assert.match(print,/No muestra antecedentes ni notas internas/);
  assert.doesNotMatch(print,/allerg|medication|clinical_note/i);
});

test('web, móvil, impresión y PWA distribuyen la etapa tres',()=>{
  const app=read('app.html'),mobile=read('mobile/www/app.html'),worker=read('sw.js');
  assert.equal(app,mobile);
  assert.match(app,/smyl-proposal-print\.js\?v=4/);
  assert.match(app,/smyl-treatment-quote-stage3\.js\?v=1/);
  assert.match(app,/smyl-treatment-quote-stage3\.css\?v=1/);
  assert.match(worker,/smyl-v259-usage-alerts/);
  assert.equal(control,read('mobile/www/smyl-treatment-quote-stage3.js'));
  assert.equal(print,read('mobile/www/smyl-proposal-print.js'));
  assert.equal(css,read('mobile/www/smyl-treatment-quote-stage3.css'));
  assert.match(css,/@media print/);
  assert.match(css,/@media\(max-width:600px\)/);
});
