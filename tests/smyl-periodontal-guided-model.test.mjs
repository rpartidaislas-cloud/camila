import test from 'node:test';
import assert from 'node:assert/strict';
import guide from '../smyl-periodontal-guided-model.js';
import dental from '../smyl-dental-model.js';

function setup(initial={},options={}) {
  const clinical=structuredClone(initial),writes=[];
  const session=guide.create({
    tooth:'16',face:'V',autoAdvance:true,
    getDepth:(tooth,site)=>clinical[tooth]?.[site] ?? null,
    onApplyBatch(patches) {
      writes.push(structuredClone(patches));
      for (const {tooth,changes} of patches) {
        clinical[tooth] ||= {};
        for (const change of changes) clinical[tooth][change.site]=change.value;
      }
      return true;
    },
    ...options
  });
  return {session,clinical,writes};
}

test('dicta un cuadrante, corrige una pieza anterior, pausa y recupera la cara incompleta',()=>{
  const {session,clinical,writes}=setup({}, {tooth:'18'});
  for (const tooth of ['18','17','16']) {
    assert.equal(session.getState().tooth,tooth);
    session.hear('tres cuatro cinco');
  }
  let state=session.hear('dos tres');
  assert.deepEqual(state.values,[2,3,null]);
  assert.equal(state.nextSite,'DB');
  state=session.hear('Corrige la dieciséis, vestibular, central a seis.');
  assert.equal(state.tooth,'15');
  assert.equal(state.nextSite,'DB');
  assert.equal(state.changes.find(item=>item.tooth==='16' && item.site==='B').value,6);
  session.hear('pausa');
  session.hear('cinco');
  assert.equal(session.getState().status,'paused');
  assert.equal(session.resume().nextSite,'DB');
  assert.equal(session.hear('cinco').tooth,'14');
  for (const tooth of ['14','13','12','11']) {
    assert.equal(session.getState().tooth,tooth);
    session.hear('dos tres cuatro');
  }
  assert.equal(session.getState().tooth,'21');
  assert.deepEqual(clinical,{});
  session.apply();
  assert.equal(writes.length,0,'voice and automatic progression stay in the guide');
  session.review();
  assert.equal(session.getPatches().length,8);
  assert.equal(session.apply().status,'complete');
  assert.deepEqual(clinical['16'],{MB:3,B:6,DB:5});
  assert.deepEqual(clinical['15'],{MB:2,B:3,DB:5});
  assert.deepEqual(session.getPatches(),[]);
  session.apply();
  assert.equal(writes.length,1);
});

test('reconoce órdenes completas, orden explícito y ceros sin inferir valores de charla o de otros campos',()=>{
  const {session}=setup({}, {autoAdvance:false});
  const rejected=['','-3','−3','3.5','3,4','veintiuno','ciento dos','3 4 5 6','sangrado mesial',
    'margen mesial 3','señora espere tres minutos','pieza 15 vestibular 3 4 5','36 palatina tres cuatro sí',
    'distal tres y mesial 20.5','mesial 4 dos','mesial 3 mesial 4','tres cuatro y','corrige 16 y 18 vestibular central a cuatro'];
  for (const phrase of rejected) {
    session.hear(phrase);
    assert.deepEqual(session.getPatches(),[],phrase);
  }
  let state=session.hear('Pieza dieciséis vestibular de distal a mesial cuatro tres cero.');
  assert.equal(state.tooth,'16');
  assert.deepEqual(state.values,[0,3,4]);
  session.hear('siguiente');
  state=session.hear('distal cinco, mesial dos y central cuatro');
  assert.deepEqual(state.values,[2,4,5]);
  session.hear('corrige el central a uno');
  assert.deepEqual(session.getState().values,[2,1,5]);
});

test('omite sitios y piezas ausentes, permite retomarlos y respeta dirección y cara',()=>{
  const {session}=setup({}, {face:'I',direction:'reverse',missingTeeth:['17','48']});
  assert.equal(session.getState().total,60);
  assert.equal(session.hear('saltar sitio').nextSite,'L');
  assert.equal(session.hear('tres cuatro').tooth,'18');
  const pending=session.getState().pending.find(entry=>entry.tooth==='16'&&entry.face==='I');
  assert.deepEqual(pending.sites,['ML']);
  assert.equal(session.hear('saltar').face,'V');
  session.review();
  assert.equal(session.goTo('16','I').nextSite,'ML');
  session.hear('dos');
  session.review();
  const state=session.edit('16','DL',0);
  assert.equal(state.status,'review');
  assert.equal(state.changes.find(item=>item.site==='DL').value,0);
  assert.deepEqual(session.getPatches()[0].changes.map(change=>change.field),['depth','depth','depth']);
});

test('vuelve sobre una profundidad previa únicamente tras confirmación, en una sola operación',()=>{
  const {session,clinical,writes}=setup({'16':{MB:0,B:4}}, {autoAdvance:false});
  let state=session.hear('dos tres cinco');
  assert.deepEqual(session.getPatches(),[]);
  assert.equal(state.conflict.original,0);
  session.hear('sí');  // No interpretar una conversación casual como autorización.
  assert.equal(session.getState().conflict.original,0);
  state=session.cancelOverwrite();
  assert.equal(state.conflict.site,'B');
  state=session.hear('confirmar reemplazo');
  assert.deepEqual(state.values,[0,3,5]);
  session.review(); session.apply();
  assert.deepEqual(clinical['16'],{MB:0,B:3,DB:5});
  assert.equal(writes.length,1);
});

test('revalida valores editados durante el recorrido y asegura que la respuesta sigue siendo actual',()=>{
  const {session,clinical,writes}=setup({});
  session.hear('tres cuatro cinco');
  clinical['16']={B:8};
  session.review();
  let state=session.apply();
  assert.equal(writes.length,0);
  assert.equal(state.conflict.original,8);
  state=session.confirmOverwrite();
  assert.equal(state.status,'review');
  clinical['16'].B=9;
  assert.equal(session.apply().conflict.original,9);
  session.cancelOverwrite();
  state=session.apply();
  assert.equal(state.status,'complete');
  assert.deepEqual(clinical['16'],{MB:3,B:9,DB:5});
});

test('un error al aplicar conserva la propuesta y permite reintentar sin guardar parcialmente',()=>{
  let attempt=0;
  const {session}=setup({}, {onApplyBatch:()=> ++attempt>1});
  session.hear('dos tres cuatro');
  session.hear('tres tres tres');
  session.review();
  assert.equal(session.apply().status,'review');
  assert.equal(session.getPatches().length,2);
  assert.equal(session.apply().status,'complete');
  assert.equal(attempt,2);
});

test('el recorrido acaba y cada cara de cada pieza presente aparece exactamente una vez',()=>{
  for (const face of ['V','I']) {
    for (const direction of ['forward','reverse']) {
      const {session}=setup({}, {tooth:'36',face,direction,missingTeeth:['18','24']});
      const visited=[];
      while (session.getState().status==='active') {
        const state=session.getState();
        visited.push(state.tooth+state.face);
        assert.ok(visited.length<=60);
        session.next();
      }
      assert.equal(visited[0],'36'+face);
      assert.equal(new Set(visited).size,60);
      assert.equal(session.getState().pending.length,60);
    }
  }
  const empty=setup({}, {missingTeeth:dental.teeth}).session;
  assert.equal(empty.getState().status,'review');
  assert.equal(empty.getState().nextSite,null);
  assert.equal(empty.getState().total,0);
});
