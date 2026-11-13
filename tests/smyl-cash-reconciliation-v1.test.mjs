import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const js=read('smyl-finance.js');
const css=read('smyl-finance.css');
const app=read('app.html');
const sw=read('sw.js');

test('el corte concilia todos los métodos y muestra periodo',()=>{
  for(const token of ["['cash','card','transfer','check','other']",'Hora del corte','Duración','Cierre de turno','Cierre del día','CONCILIACIÓN POR MÉTODO']) assert.match(js,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(js,/data-close-count/);
  assert.match(js,/data-close-variance/);
  assert.match(js,/data-denomination/);
});

test('una diferencia exige motivo y conserva el cierre compatible actual',()=>{
  assert.match(js,/reason\.required=hasVariance/);
  assert.match(js,/smyl_close_cash_session/);
  assert.match(js,/Diferencia total reportada/);
  assert.match(js,/Conciliación:/);
});

test('la ventana sigue la política visual y responde en móvil',()=>{
  for(const selector of ['.finance-close-head','.finance-close-period','.finance-close-methods','.finance-close-resolution','.finance-close-footer']) assert.match(css,new RegExp(selector.replace('.','\\.')));
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/height:100dvh/);
  assert.match(css,/min-width:44px/);
});

test('web, PWA y móvil publican la misma versión',()=>{
  assert.match(app,/smyl-finance\.css\?v=28/);
  assert.match(app,/smyl-finance\.js\?v=35/);
  assert.match(sw,/cash-reconciliation-v1/);
  assert.match(sw,/smyl-finance\.css\?v=28/);
  assert.match(sw,/smyl-finance\.js\?v=35/);
  assert.equal(read('mobile/www/smyl-finance.js'),js);
  assert.equal(read('mobile/www/smyl-finance.css'),css);
  assert.equal(read('mobile/www/sw.js'),sw);
});
