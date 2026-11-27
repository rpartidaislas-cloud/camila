import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const js=read('smyl-finance.js');
const css=read('smyl-finance.css');
const app=read('app.html');
const sw=read('sw.js');

test('el corte concilia todas las formas de pago y dice de quién es la caja y desde cuándo',()=>{
  for(const token of ["['cash','card','transfer','check','other']",'Cierre de turno','Cierre del día','<span role="columnheader">Debe haber</span>','<span role="columnheader">Se contó</span>','<span role="columnheader">Diferencia</span>',"' · abierta '+esc(openedLabel(s.opened_at))+' · '+esc(closeDuration(s.opened_at))"]) assert.match(js,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(js,/data-close-count/);
  assert.match(js,/data-close-variance/);
  assert.match(js,/data-denomination/);
});

test('una diferencia exige motivo y conserva el cierre compatible actual',()=>{
  assert.match(js,/reason\.required=hasVariance/);
  assert.match(js,/smyl_close_cash_session/);
  assert.match(js,/Corte guardado\. /);
  assert.match(js,/Conciliación:/);
});

test('la ventana usa el marco común de las ventanas y cabe en celular',()=>{
  for(const selector of ['.finance-cut-table','.finance-cut-row','.finance-cut-total','.finance-cut-coins','.finance-cut-issue']) assert.match(css,new RegExp(selector.replace('.','\\.')));
  // En celular no caben cuatro columnas: cada forma de pago usa dos renglones y cada cifra lleva su nombre.
  assert.match(css,/@media\(max-width:560px\)\{[^@]*\.finance-cut-head\{display:none\}[^@]*\.finance-cut-row>\[data-label\]::before\{content:attr\(data-label\)/);
  assert.doesNotMatch(css,/\.finance-close-/);
});

test('web, PWA y móvil publican la misma versión',()=>{
  assert.match(app,/smyl-finance\.css\?v=56/);
  assert.match(app,/smyl-finance\.js\?v=73/);
  assert.match(sw,/cash-reconciliation-v1/);
  assert.match(sw,/smyl-finance\.css\?v=56/);
  assert.match(sw,/smyl-finance\.js\?v=73/);
  assert.equal(read('mobile/www/smyl-finance.js'),js);
  assert.equal(read('mobile/www/smyl-finance.css'),css);
  assert.equal(read('mobile/www/sw.js'),sw);
});
