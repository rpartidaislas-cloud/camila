import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const read=(name)=>readFileSync(resolve(root,name),'utf8');
const ui=read('smyl-service-catalog.js');
const css=read('smyl-service-catalog-stage1.css');

test('el catálogo explica cuánto falta para quedar operativo en una sola franja',()=>{
  assert.match(ui,/id="catalog-readiness-title"/);
  assert.match(ui,/servicios sin precio/);
  assert.match(ui,/con revisión fiscal pendiente/);
  assert.match(ui,/Catálogo listo: precio y revisión fiscal al día/);
  assert.match(ui,/ready\/active\*100/);
  assert.doesNotMatch(ui,/catalog-summary|CONFIGURACIÓN DEL CATÁLOGO|Listos para operar/);
});

test('los filtros llevan directamente a servicios sin precio o con fiscal pendiente, con contador',()=>{
  assert.match(ui,/data-catalog-show="noprice"/);
  assert.match(ui,/data-catalog-show="pending"/);
  assert.match(ui,/state\.show==='noprice'/);
  assert.match(ui,/data-catalog-count="noprice"/);
  assert.match(ui,/reference_price==null/);
  assert.match(ui,/Falta precio/);
  assert.match(ui,/Falta fiscal/);
});

test('cada servicio comunica su estado y conserva control humano fiscal',()=>{
  assert.match(ui,/Listo para operar/);
  assert.match(ui,/La clave SAT es una sugerencia editable/);
  assert.match(ui,/Sólo lectura/);
});

test('la etapa uno es responsive y se distribuye igual en web, móvil y PWA',()=>{
  const app=read('app.html'),mobile=read('mobile/www/app.html'),worker=read('sw.js');
  assert.equal(app,mobile);
  assert.match(app,/smyl-service-catalog-stage1\.css\?v=3/);
  assert.match(app,/smyl-service-catalog\.js\?v=5/);
  assert.match(worker,/smyl-v263-lana-connection-recovery/);
  assert.match(worker,/smyl-service-catalog-stage1\.css\?v=3/);
  assert.equal(ui,read('mobile/www/smyl-service-catalog.js'));
  assert.equal(css,read('mobile/www/smyl-service-catalog-stage1.css'));
  assert.match(css,/@media\(max-width:600px\)/);
});
