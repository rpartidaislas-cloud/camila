import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('smyl-proposals.js');
const css=read('smyl-proposals.css');
const app=read('app.html');
const sw=read('sw.js');

test('el tablero distingue cada estado comercial verificable',()=>{
  for(const text of ['Completar borrador','Lista para presentar','Esperando decisión','Vigencia vencida','Preparar cambios','Aceptada'])assert.match(ui,new RegExp(text));
  assert.match(ui,/function proposalStage/);
  assert.match(ui,/valid<today/);
  assert.match(ui,/event\?\.event_type==='accepted'/);
});

test('las métricas no convierten silencios en rechazo',()=>{
  for(const text of ['Por presentar','Esperando respuesta','Requieren acción','Aceptación'])assert.match(ui,new RegExp(text));
  assert.match(ui,/decisions\.length\?Math\.round\(accepted\*100\/decisions\.length\):null/);
  assert.match(ui,/La tasa usa únicamente decisiones registradas/);
  assert.match(ui,/no interpreta silencios como rechazo/);
});

test('la cola permite filtrar y buscar sin otra fuente de datos',()=>{
  for(const text of ['Por atender','Todas','Aceptadas','Borradores','Buscar paciente o propuesta'])assert.match(ui,new RegExp(text));
  assert.match(ui,/proposalDashboard\(rows,latestEvents,list,access\)/);
  assert.match(css,/proposal-metrics/);
  assert.match(css,/proposal-list-toolbar/);
  assert.match(css,/@media\(max-width:600px\).*proposal-metrics/);
});

test('web, móvil y PWA publican el tablero comercial',()=>{
  assert.match(app,/smyl-proposals\.css\?v=9/);
  assert.match(app,/smyl-proposals\.js\?v=12/);
  assert.match(sw,/smyl-v262-checkout-return/);
  assert.equal(app,read('mobile/www/app.html'));
  assert.equal(ui,read('mobile/www/smyl-proposals.js'));
  assert.equal(css,read('mobile/www/smyl-proposals.css'));
  assert.equal(sw,read('mobile/www/sw.js'));
});
