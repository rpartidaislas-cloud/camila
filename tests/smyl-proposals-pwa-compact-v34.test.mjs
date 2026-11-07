import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('cotizaciones usa una densidad proporcionada en escritorio y PWA',()=>{
  const css=read('smyl-proposals.css');
  const block=css.slice(css.indexOf('PWA Cotizaciones v3.4'));
  assert.match(block,/\.proposal-metrics article\{min-height:78px;padding:12px 14px/);
  assert.match(block,/\.proposal-list-row\{[\s\S]*?min-height:74px;[\s\S]*?padding:12px 14px/);
  assert.match(block,/\.proposal-layout\{grid-template-columns:minmax\(0,1fr\) 310px/);
  assert.match(block,/@media screen and \(max-width:700px\)/);
  assert.match(block,/\.proposal-filters\{display:flex;flex-wrap:nowrap/);
  assert.match(block,/@media screen and \(max-width:420px\)[\s\S]*?\.proposal-metrics\{grid-template-columns:1fr 1fr\}/);
});

test('seguimiento y activación son acciones progresivas sin perder controles',()=>{
  const js=read('smyl-proposals.js');
  const css=read('smyl-proposals.css');
  assert.match(js,/n\('details','proposal-tracking proposal-fold'\)/);
  assert.match(js,/n\('details','proposal-activation proposal-fold'\)/);
  assert.match(js,/latest\?\.event_type==='presented'\)tracking\.open=true/);
  assert.match(js,/activationFold\.open=true/);
  assert.match(css,/\.proposal-fold-head\{[\s\S]*?min-height:58px/);
});

test('versiones PWA y espejos móviles quedan sincronizados',()=>{
  const app=read('app.html');
  const worker=read('sw.js');
  assert.match(app,/smyl-proposals\.css\?v=11/);
  assert.match(app,/smyl-proposals\.js\?v=13/);
  assert.match(app,/smyl-treatment-quote-stage3\.css\?v=3/);
  assert.match(worker,/proposal-pwa-compact-v1/);
  for(const file of ['app.html','sw.js','smyl-proposals.css','smyl-proposals.js','smyl-treatment-quote-stage3.css']){
    assert.equal(read(file),read('mobile/www/'+file));
  }
});
