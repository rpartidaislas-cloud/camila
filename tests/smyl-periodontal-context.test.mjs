import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import model from '../smyl-dental-model.js';

const browser = {};
runInNewContext(readFileSync(new URL('../smyl-periodontal-context.js',import.meta.url),'utf8'),{window:browser,structuredClone});
function setup(overrides={}) {
  const ctx = {doc:model.empty(),savedDoc:model.empty(),ready:true,canWrite:true,busy:false,dirty:false};
  const bridge = browser.SmylPeriodontalContext.create(ctx,{
    model, readable:()=>true, markDirty:()=>{ctx.dirty=true;}, saveDocument:async()=>false,
    readHistory:async()=>[], getFindings:()=>[], notify:()=>{}, ...overrides
  });
  return {ctx,bridge};
}

test('Las tres medidas se aplican juntas y un fallo al cerrar permite revisar el mismo borrador',async()=>{
  const {ctx,bridge}=setup();
  bridge.onStart('2026-11-20');
  const change=(site,value)=>({site,field:'depth',value});
  assert.equal(bridge.onChange({tooth:16,changes:[change('MB',3),change('B',4),change('DB',90)]}),false);
  assert.equal(Object.keys(ctx.doc.periodontogram.teeth).length,0);
  assert.equal(bridge.onChange({tooth:16,changes:[change('MB',3),change('B',4),change('DB',5)]}),true);
  assert.equal(bridge.getState().confirmed,null);
  assert.equal(await bridge.onSave({close:true}),false);
  assert.equal(bridge.getState().current.status,'draft');
  assert.equal(bridge.getState().current.teeth[16].B.depth,4);
  assert.equal(bridge.getState().dirty,true);
  assert.throws(()=>{bridge.getState().current.teeth[16].B.depth=0;},TypeError);
});

test('Un historial que llega después de cambiar de paciente se descarta',async()=>{
  let resolve, allowed=true, requests=0, notifications=0;
  const {bridge}=setup({
    readable:()=>allowed,readHistory:()=>{requests++;return new Promise(done=>{resolve=done;});},
    notify:()=>{notifications++;}
  });
  const first=bridge.onHistory(),second=bridge.onHistory();
  allowed=false;resolve([]);
  assert.equal(await first,false);
  assert.equal(await second,false);
  assert.equal(requests,1);
  assert.equal(notifications,0);
  assert.equal(bridge.getState().canRead,false);
  assert.equal(bridge.onStart('2026-11-20'),false);
});

test('Confirmar un recorrido completo sólo modifica el borrador, de manera atómica',()=>{
  let edits=0;
  const {ctx,bridge}=setup({markDirty:()=>{edits++;}});
  bridge.onStart('2026-11-20');
  bridge.onChange({tooth:'16',site:'MB',field:'bleeding',value:true});
  const before=ctx.doc.periodontogram, baseline=edits;
  const reading=(tooth,value)=>({tooth,changes:[{site:'MB',field:'depth',value}]});
  assert.equal(bridge.onApplyBatch([reading('16',3),reading('15',21)]),false);
  assert.equal(edits,baseline);
  assert.equal(ctx.doc.periodontogram,before);
  assert.equal(bridge.onApplyBatch([reading('16',0),reading('15',5)]),true);
  assert.equal(edits,baseline+1);
  assert.equal(ctx.savedDoc.periodontogram,undefined);
  assert.deepEqual(ctx.doc.periodontogram.teeth['16'].MB,{depth:0,margin:null,bleeding:true});
  assert.equal(ctx.doc.periodontogram.teeth['15'].MB.depth,5);
  ctx.perioConflict=true;
  assert.equal(bridge.onApplyBatch([reading('14',2)]),false);
});

test('La gráfica respeta ausencias confirmadas, mediciones previas, implantes y la fecha del registro',()=>{
  const {ctx,bridge}=setup();
  const event=(id,tooth,conditionCode)=>model.createFinding({id,tooth,conditionCode,surface:'whole'});
  ctx.savedDoc.findings={schema:2,events:[
    event('a','27','missing'),event('b','28','missing'),event('c','28','implant'),event('d','18','missing')
  ]};
  bridge.onStart('2026-11-20');
  bridge.onChange({tooth:'18',site:'MB',field:'depth',value:3});
  assert.deepEqual([...bridge.getState().missingTeeth],['27']);
  ctx.doc.periodontogram={...ctx.doc.periodontogram,status:'closed'};
  assert.deepEqual([...bridge.getState().missingTeeth],[]);
});
