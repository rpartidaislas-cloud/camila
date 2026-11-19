import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const preview = new URL('./fixtures/smyl-inbox-stage7-preview.html?pipeline-preview',import.meta.url);
let browser;
before(async () => {
  try { browser = await createRequire(import.meta.url)('playwright').chromium.launch({executablePath:process.env.SMYL_CHROMIUM,args:['--allow-file-access-from-files']}); }
  catch (err) { if (process.env.SMYL_CHROMIUM) throw err; }
});
after(async () => browser?.close());

// Fixture con agenda independiente y control de concurrencia como en el servicio real.
async function prepare(t, width, agent=false) {
  const page = await browser.newPage({viewport:{width,height:850},hasTouch:width<500});
  t.after(()=>page.close()); page.setDefaultTimeout(5000);
  await page.addInitScript(agent => {
    document.addEventListener('DOMContentLoaded', () => {
      const original = window.fetch;
      const state = window.stageTest = {stage:'smyl:confirmed',revision:0,reads:[],writes:[],opens:[],lists:0,fail:0};
      const actor={id:'owner-preview',name:'Recepción',chat_access:'agent',role:'staff'};
      const appointment={id:'visit-before',status:'confirmed',timezone:'America/Mexico_City',starts_at:'2026-11-19T17:00:00Z'};
      const canonical=()=>({stage_id:state.stage,pipeline:{stage_id:state.stage,source:state.revision?'manual':'agenda',revision:state.revision,provider_stage_id:null},appointment});
      window.fetch=async(url,init)=>{
        const query=new URL(url,document.baseURI).searchParams;
        const body=typeof init?.body==='string'?JSON.parse(init.body):{};
        const action=query.get('action')||body.action;
        if (action==='list') state.lists++;
        const id=query.get('conversation_id')||body.conversation_id;
        if (action==='read') state.reads.push(id);
        if (action==='messages') state.opens.push([id,Number(query.get('limit'))]);
        if (init?.method==='POST') state.writes.push({...body});
        if (action==='access'&&agent) return Response.json({actor});
        if (action==='stages') return Response.json({stages:[{id:'next-call',name:'Llamar después',position:1},{id:'retired',name:'Retirada',archived:true}]});
        if (action==='stage') {
          if (state.fail===403) return Response.json({error:'No tienes permiso para cambiar la etapa.'},{status:403});
          if (state.fail===409) {
            state.fail=0; state.revision++; state.stage=null;
            return Response.json({error:'Otra persona guardó un cambio'},{status:409});
          }
          if (body.expected_revision!==state.revision) return Response.json({error:'Revisión desactualizada'},{status:409});
          state.stage=body.target_stage_id; state.revision++;
          return Response.json(canonical());
        }
        const response=await original(url,init);
        if (!['list','messages'].includes(action)) return response;
        const data=await response.json();
        if (agent) data.actor=actor;
        for(const card of data.conversations||[data.conversation]) {
          if (agent) card.assignment={actor_id:card.id==='c-preview'?actor.id:'someone-else',name:'Equipo'};
          if(card.id==='c-preview') Object.assign(card,canonical(),{unread_count:2});
        }
        return Response.json(data);
      };
    },{once:true});
  },agent);
  await page.goto(preview.href); await page.waitForSelector('html[data-preview-ready=true]');
  await page.locator('[data-inbox-view=list]').click();
  return page;
}

for (const width of [390, 1440]) {
  test('Cambiar etapa en Conversaciones no abre ni lee otro hilo y conserva la cita, a '+width+' px',async t=>{
    if (!browser) return t.skip('Se necesita Chromium.');
    const page=await prepare(t,width);
    const list=page.locator('[data-inbox-list]');
    await list.locator('.smyl-inbox-row[data-conversation-id=c-elena]').click();
    await page.locator('[data-thread-name]').getByText('Elena Cruz',{exact:true}).waitFor();
    if (width<500) await page.locator('[data-inbox-back]').click();
    const group=list.locator('[data-list-conversation-id=c-preview]'), open=group.locator('button.smyl-inbox-row');
    const stage=group.getByRole('combobox',{name:'Cambiar etapa de Ana López'}), notice=page.locator('[data-inbox-handoff-status]');
    const appointment=await open.locator('.smyl-inbox-card-appointment').innerText();
    assert.match(appointment,/Cita confirmada/);
    assert.equal(await stage.inputValue(),'smyl:confirmed');
    assert.equal(await stage.locator('option[value=retired]').count(),0);
    assert.equal(await stage.evaluate(el=>el.closest('button,[role=button]')===null),true);
    await stage.click({trial:true}); await stage.focus();
    await stage.selectOption('next-call'); await notice.getByText(/Etapa guardada/).waitFor();
    assert.equal(await stage.inputValue(),'next-call');
    assert.equal(await open.locator('.smyl-inbox-unread').innerText(),'2');
    assert.equal(await open.locator('.smyl-inbox-card-appointment').innerText(),appointment);
    assert.equal(await page.locator('[data-thread-name]').textContent(),'Elena Cruz');
    assert.equal(await page.locator('[data-inbox-view=list]').getAttribute('aria-selected'),'true');
    const moves=await page.evaluate(()=>window.stageTest.writes.filter(x=>x.action==='stage'));
    assert.deepEqual(moves.map(x=>[x.conversation_id,x.target_stage_id,x.expected_revision]),[['c-preview','next-call',0]]);
    await page.locator('[data-inbox-view=pipeline]').click();
    await page.locator('[data-pipeline-stage=next-call] [data-conversation-id=c-preview]').waitFor();
    await page.locator('[data-inbox-view=list]').click();
    if (width<500 && await page.locator('#p-inbox').evaluate(el=>el.classList.contains('show-thread'))) await page.locator('[data-inbox-back]').click();
    const before=await page.evaluate(()=>{const count=window.stageTest.lists; window.SmylInbox.refresh(); return count;});
    await page.waitForFunction(count=>window.stageTest.lists>count,before);
    assert.equal(await stage.inputValue(),'next-call');
    await page.evaluate(()=>{window.stageTest.fail=409;});
    await stage.selectOption('smyl:attended'); await notice.getByText(/La etapa cambió/).waitFor();
    assert.equal(await stage.inputValue(),'','recupera la etapa real y no reintenta por cuenta propia');
    await page.evaluate(()=>{window.stageTest.fail=403;});
    await stage.selectOption('next-call'); await notice.getByText(/permiso/i).waitFor();
    assert.equal(await stage.inputValue(),'');
    assert.equal(await open.locator('.smyl-inbox-card-appointment').innerText(),appointment);
    assert.equal(await page.locator('[data-thread-name]').textContent(),'Elena Cruz');
    const history=await page.evaluate(()=>window.stageTest);
    assert.equal(history.reads.includes('c-preview'),false);
    assert.ok(history.opens.every(([id,limit])=>id!=='c-preview'||limit===1),'un conflicto sólo permite releer la etapa; no navega al hilo');
    assert.ok(history.writes.every(p=>!p.action.startsWith('appointment')),'el selector no escribe en agenda');
  });
}

test('Un agente sólo puede cambiar las etapas de los chats propios presentes en su bandeja',async t=>{
  if (!browser) return t.skip('Se necesita Chromium.');
  const page=await prepare(t,1440,true);
  const list=page.locator('[data-inbox-list]');
  const own=list.getByRole('combobox',{name:'Cambiar etapa de Ana López'});
  await own.waitFor(); assert.equal(await list.locator('[data-list-stage]').count(),1);
  assert.equal(await list.locator('[data-list-conversation-id=c-elena]').count(),0);
  await own.selectOption('next-call');
  await page.locator('[data-inbox-handoff-status]').getByText(/Etapa guardada/).waitFor();
});
