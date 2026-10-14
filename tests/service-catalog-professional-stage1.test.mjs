import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(resolve(root,name),'utf8');
const ui=read('smyl-service-catalog.js');
const css=read('smyl-service-catalog-stage1.css');

test('el catálogo explica cuánto falta para quedar operativo',()=>{
  assert.match(ui,/CONFIGURACIÓN DEL CATÁLOGO/);
  assert.match(ui,/Listos para operar/);
  assert.match(ui,/Servicios activos/);
  assert.match(ui,/Sin precio/);
  assert.match(ui,/Fiscal pendiente/);
  assert.match(ui,/ready\/active\*100/);
});

test('los filtros llevan directamente a servicios incompletos',()=>{
  assert.match(ui,/data-catalog-show="incomplete"/);
  assert.match(ui,/state\.show==='incomplete'/);
  assert.match(ui,/reference_price==null/);
  assert.match(ui,/Completar/);
});

test('cada servicio comunica su estado y conserva control humano fiscal',()=>{
  assert.match(ui,/Listo para operar/);
  assert.match(ui,/Por completar/);
  assert.match(ui,/La clave SAT es una sugerencia editable/);
  assert.match(ui,/Sólo lectura/);
});

test('la etapa uno es responsive y se distribuye igual en web, móvil y PWA',()=>{
  const app=read('app.html'),mobile=read('mobile/www/app.html'),worker=read('sw.js');
  assert.equal(app,mobile);
  assert.match(app,/smyl-service-catalog-stage1\.css\?v=1/);
  assert.match(app,/smyl-service-catalog\.js\?v=3/);
  assert.match(worker,/smyl-v236-secure-clinical-files/);
  assert.match(worker,/smyl-service-catalog-stage1\.css\?v=1/);
  assert.equal(ui,read('mobile/www/smyl-service-catalog.js'));
  assert.equal(css,read('mobile/www/smyl-service-catalog-stage1.css'));
  assert.match(css,/@media\(max-width:600px\)/);
});
