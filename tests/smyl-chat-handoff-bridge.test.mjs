import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../supabase/functions/lana-inbox/index.ts', import.meta.url), 'utf8');
const handlerSource = stripTypeScriptTypes(source.replace(/^import .*;$/gm, ''));
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const tenant = id(1), agent = id(2), dentist = id(3), disabled = id(4), chat = id(5), other = id(6);
const secretNote = 'Pide que recepción le llame después de las cuatro.';

function bridge({failProjectionOnce = false, branchBlocked = new Set(), ineligibleTargets = new Set(), pipelineRows = new Map(), remoteStage = null} = {}) {
  const modes = new Map([[tenant,'coordinator'],[agent,'agent'],[dentist,'agent'],[disabled,'none']]);
  const users = [...modes.keys()].map((id, index) => ({id,tenant_id:tenant,nombre:'Integrante '+index,activo:true,rol:'staff'}));
  const assignments = [{tenant_id:tenant,conversation_id:chat,assignee_id:agent,version:1}];
  const notes = [];
  const transport = [];
  const tables = {camila_usuarios:users, smyl_chat_assignments:assignments, smyl_chat_handoffs:notes};
  function from(name) {
    let rows = (tables[name] || []).slice();
    const query = {
      select() { return query; }, order() { return query; },
      eq(key,value) { rows = rows.filter(row => row[key] === value); return query; },
      in(key,values) { rows = rows.filter(row => values.includes(row[key])); return query; },
      gte(key,value) { rows = rows.filter(row => row[key] >= value); return query; },
      limit(size) { rows = rows.slice(0,size); return query; },
      maybeSingle() { return Promise.resolve({data:rows[0] || null,error:null}); },
      then(done,fail) { return Promise.resolve({data:rows,error:null}).then(done,fail); },
    };
    return query;
  }
  function visible(actorId, conversation) {
    return modes.get(actorId) !== 'none' && !branchBlocked.has(actorId + ':' + conversation) &&
      (actorId === tenant || assignments.some(row=>row.conversation_id === conversation && row.assignee_id === actorId));
  }
  async function rpc(name,p) {
    if(name === 'smyl_chat_visible_ids') return {data:p.p_conversations.filter(id=>p.p_tenant === tenant && visible(p.p_actor,id))};
    if(name === 'smyl_chat_request_context') {
      assert.equal(p.p_tenant,tenant); assert.equal(p.p_actor,tenant); assert.equal(p.p_conversation,chat);
      return {data:{linked:true,items:[{id:'1',status:'pending',branch:{name:'Sede de la cita'},appointment:null}]}};
    }
    if(name === 'smyl_chat_scope_changed') return {data:false};
    const stageContext = id => pipelineRows.get(id) || {conversation_id:id,manual_revision:0,stage_source:'lana',effective_stage_id:null,appointment:null};
    if(name === 'smyl_chat_pipeline_context') return {data:p.p_conversations.filter(id=>visible(p.p_actor,id)).map(stageContext)};
    if(name === 'smyl_chat_pipeline_changed') return {data:p.p_conversations.some(id=>visible(p.p_actor,id) && pipelineRows.has(id))};
    if(name === 'smyl_chat_set_pipeline_stage') {
      if(!visible(p.p_actor,p.p_conversation)) return {error:{code:'42501'}};
      const current = stageContext(p.p_conversation);
      if(current.manual_revision !== p.p_expected_revision) return {error:{code:'40001'}};
      const updated = {...current,stage_source:'manual',manual_revision:current.manual_revision+1,effective_stage_id:p.p_stage_id};
      pipelineRows.set(p.p_conversation,updated);
      return {data:updated};
    }
    if(name === 'smyl_chat_route_allowed') return {data:false};
    if(name === 'smyl_chat_clinic_wide') return {data:p.p_tenant === tenant && p.p_user === tenant};
    if(name === 'smyl_chat_visible') return {data:p.p_tenant === tenant && visible(p.p_actor, p.p_conversation)};
    if(name === 'smyl_chat_mode') return {data:modes.get(p.p_user) || 'none'};
    if(name === 'smyl_chat_assistants' || name === 'smyl_chat_recipients') return {data:users.filter(user=>modes.get(user.id)!=='none' &&
      (name === 'smyl_chat_assistants' || !ineligibleTargets.has(user.id)))
      .map(user=>({id:user.id,name:user.nombre,chat_mode:modes.get(user.id),kind:'staff'}))};
    if(name === 'smyl_transfer_chat') {
      const row=assignments[0];
      if(row.version!==p.p_expected_version) return {error:{code:'40001'}};
      const from_user_id=row.assignee_id;
      row.assignee_id=p.p_target; row.version++;
      notes.unshift({tenant_id:tenant,conversation_id:chat,version:row.version,from_user_id,to_user_id:p.p_target,note:p.p_note});
      return {data:{assignee_id:p.p_target,version:row.version,updated_at:new Date().toISOString()}};
    }
    throw Error('Unexpected RPC '+name);
  }
  let handle, remoteOwner=agent;
  async function lanaRequest(tenantId,path,options) {
    assert.equal(tenantId,tenant);
    transport.push({path,body:options.body});
    const conversation = {id:chat,stage_id:remoteStage,contact_name:'Contacto de prueba',can_operate:true,assigned_actor_id:remoteOwner};
    let body;
    if(path.startsWith('/inbox?')) body={conversations:[conversation,{id:other,last_message:'Otro chat'}],page:{has_more:false,total:2}};
    else if(path === '/inbox/stages') body={stages:[{id:id(13),name:'Seguimiento',archived:false},{id:id(14),name:'Archivada',archived:true}]};
    else if(path.startsWith('/inbox/sync?')) body={conversations:[conversation],removed_conversation_ids:[],synced_at:new Date().toISOString()};
    else if(path.includes('/messages') && options.method === 'GET') body={conversation,messages:[{content:'Hola'}],page:{has_more:false}};
    else if(path.endsWith('/assign')) {
      if(failProjectionOnce) { failProjectionOnce=false; return {response:new Response(null,{status:503}),body:{}}; }
      remoteOwner=JSON.parse(options.body).target_actor_id; body={assigned_actor_id:remoteOwner};
    }
    else if(path.endsWith('/release')) { remoteOwner=null; body={}; }
    else throw Error('Unexpected transport route '+path);
    return {response:new Response(),body};
  }
  vm.runInNewContext(handlerSource,{Deno:{env:{get:()=>''},serve:fn=>{handle=fn;}},createClient:()=>({from,rpc}),
    requireUser:async req=>({user:{id:req.headers.get('x-test-user')},tenantId:tenant}),makeCors:()=>({}),
    lanaRequest,matchBranch:()=>null,matchBranchInMessages:()=>null,Request,Response,Headers,URL,URLSearchParams,crypto,console});
  async function call(user,query,body) {
    const headers={'x-test-user':user,'Idempotency-Key':crypto.randomUUID(),'Content-Type':'application/json'};
    const response=await handle(new Request('https://example.invalid/inbox?'+new URLSearchParams(query),
      {method:body?'POST':'GET',headers,body:body ? JSON.stringify(body) : undefined}));
    return {status:response.status,body:await response.json()};
  }
  return {call,transport,notes};
}

test('la sede prevalece sobre la asignación y sobre los avisos al antiguo destinatario', async () => {
  const {call,notes,transport} = bridge({branchBlocked:new Set([agent+':'+chat])});
  const since = '2026-11-01T00:00:00Z';
  notes.push({tenant_id:tenant,conversation_id:chat,to_user_id:agent,created_at:'2026-11-02T00:00:00Z'});
  assert.deepEqual((await call(agent,{action:'list'})).body.conversations,[]);
  const sync = await call(agent,{action:'sync',visible_ids:chat,since});
  assert.equal(sync.status,200);
  assert.deepEqual(sync.body.conversations,[]);
  assert.deepEqual(sync.body.received_conversation_ids,[]);
  assert.deepEqual(sync.body.removed_conversation_ids,[chat]);
  const count = transport.length;
  assert.equal((await call(agent,{action:'messages',conversation_id:chat})).status,403);
  assert.equal((await call(agent,{action:'team',conversation_id:chat})).status,403);
  assert.equal((await call(agent,{}, {action:'send',conversation_id:chat,content:'Hola'})).status,403);
  assert.equal(transport.length,count);
});

test('las transferencias y las dos acciones para cambiar sede rechazan destinos fuera de alcance', async () => {
  const {call,transport}=bridge({ineligibleTargets:new Set([dentist])});
  const roster=await call(agent,{action:'team',conversation_id:chat});
  assert.equal(roster.status,200);
  assert.ok(!roster.body.members.some(member=>member.id===dentist));
  assert.equal((await call(agent,{}, {action:'assign',conversation_id:chat,target_actor_id:dentist,expected_version:1})).status,400);
  for (const action of ['branch','set_branch']) {
    assert.equal((await call(tenant,{}, {action,conversation_id:chat,branch_id:id(8)})).status,403);
  }
  assert.equal(transport.length,0);
});

test('la tarjeta, el filtro y el tablero usan la misma cita autorizada y la etapa efectiva', async () => {
  const commercial = id(13);
  const appointment = {id:id(12),status:'confirmed',starts_at:'2026-11-21T16:00:00Z',ends_at:'2026-11-21T16:30:00Z',timezone:'America/Mexico_City'};
  const pipelineRows = new Map([[chat,{conversation_id:chat,stage_source:'appointment',effective_stage_id:'smyl:confirmed',appointment:{...appointment,patient_note:'Dato que debe quedar fuera'},manual_revision:0}]]);
  const {call,transport}=bridge({pipelineRows,remoteStage:commercial});
  const list=await call(agent,{action:'list',stage_id:'smyl:confirmed'});
  assert.equal(list.status,200);
  const row=list.body.conversations[0];
  assert.equal(row.pipeline.provider_stage_id,commercial);
  assert.equal(row.pipeline.stage_id,'smyl:confirmed');
  assert.deepEqual(row.appointment,appointment);
  assert.deepEqual((await call(agent,{action:'list',stage_id:commercial})).body.conversations,[]);
  assert.deepEqual((await call(dentist,{action:'list'})).body.conversations,[]);
  assert.ok(transport.filter(log=>log.path.startsWith('/inbox?')).every(log=>!log.path.includes('stage_id')));
  const thread=await call(agent,{action:'messages',conversation_id:chat});
  assert.deepEqual(thread.body.conversation.appointment,appointment);
  assert.equal(thread.body.conversation.stage_id,'smyl:confirmed');
  const payload={action:'stage',conversation_id:chat,target_stage_id:commercial,expected_revision:0};
  assert.equal((await call(dentist,{},payload)).status,403);
  assert.equal((await call(agent,{}, {...payload,target_stage_id:id(14)})).status,400);
  const moved=await call(agent,{},payload);
  assert.equal(moved.status,200);
  assert.equal(moved.body.pipeline.source,'manual');
  assert.equal(moved.body.pipeline.revision,1);
  assert.equal(moved.body.stage_id,commercial);
  assert.deepEqual(moved.body.appointment,appointment);
  assert.equal((await call(agent,{}, {...payload,target_stage_id:null})).status,409);
  const manual = await call(agent,{action:'list',stage_id:commercial});
  assert.equal(manual.body.conversations[0].pipeline.source,'manual');
  const unset=await call(agent,{}, {...payload,target_stage_id:null,expected_revision:1});
  assert.equal(unset.body.stage_id,null);
  assert.equal(unset.body.pipeline.source,'manual');
  assert.ok(transport.every(entry=>!entry.path.endsWith('/stage')));
  pipelineRows.set(chat,{...pipelineRows.get(chat),stage_source:'appointment',effective_stage_id:'smyl:arrived',appointment:{...appointment,status:'arrived'}});
  const sync=await call(agent,{action:'sync',visible_ids:chat,since:'2026-11-01T00:00:00Z'});
  assert.equal(sync.body.pipeline_changed,true);
  assert.equal(sync.body.pipeline_updates[0].stage_id,'smyl:arrived');
  assert.equal(sync.body.pipeline_updates[0].appointment.status,'arrived');
});

test('agenda del hilo usa el actor, las solicitudes permitidas y las tarjetas de la página siguiente sin volver a LANA', async () => {
  const {call,transport}=bridge();
  const panel=await call(tenant,{action:'appointment_context',conversation_id:chat});
  assert.equal(panel.body.items[0].status,'pending');
  const requests=await call(tenant,{action:'appointment_requests',conversation_id:chat});
  assert.deepEqual(requests.body.requests,[{id:'1',status:'pending'}]);
  const snapshot=await call(agent,{action:'pipeline_updates',visible_ids:[chat,other].join(',')});
  assert.deepEqual(snapshot.body.removed_conversation_ids,[other]);
  assert.equal(snapshot.body.pipeline_updates[0].id,chat);
  assert.equal(snapshot.body.pipeline_updates[0].pipeline.source,'lana');
  assert.equal((await call(agent,{action:'pipeline_updates',visible_ids:Array(101).fill(chat).join(',')})).status,400);
  assert.equal(transport.length,0);
});

test('La bandeja valida perfil y asignación antes de consultar el canal del paciente', async () => {
  const {call,transport}=bridge();
  assert.equal((await call(disabled,{action:'access'})).body.actor.chat_access,'none');
  assert.equal((await call(disabled,{action:'list'})).status,403);
  assert.equal((await call(dentist,{action:'messages',conversation_id:chat})).status,403);
  assert.equal(transport.length,0);
  const list=await call(agent,{action:'list'});
  assert.equal(list.status,200);
  assert.deepEqual(list.body.conversations.map(row=>row.id),[chat]);
  assert.equal(list.body.page.total,1);
  assert.equal(list.body.conversations[0].assignment.actor_id,agent);
});

test('El relevo versionado entrega la nota al responsable actual y la excluye del transporte', async () => {
  const {call,transport,notes}=bridge();
  const transfer={action:'assign',conversation_id:chat,target_actor_id:dentist,expected_version:1,private_note:secretNote};
  assert.equal((await call(agent,{}, {...transfer,expected_version:0})).status,409);
  assert.equal(notes.length,0);
  const result=await call(agent,{},transfer);
  assert.equal(result.status,200);
  assert.equal(result.body.assigned_actor_id,dentist);
  assert.equal(result.body.assignment_version,2);
  assert.equal(notes.length,1);
  assert.equal((await call(agent,{action:'messages',conversation_id:chat})).status,403);
  const messages=await call(dentist,{action:'messages',conversation_id:chat});
  assert.equal(messages.status,200);
  assert.equal(messages.body.conversation.private_handoff_note,secretNote);
  assert.ok(!JSON.stringify(messages.body.messages).includes(secretNote));
  assert.ok(!JSON.stringify((await call(dentist,{action:'list'})).body).includes(secretNote));
  assert.ok(!JSON.stringify(transport).includes(secretNote));
});

test('Si el canal tarda en sincronizar, el relevo conserva la nota y la privacidad al reintentarlo',async()=>{
  const {call,notes,transport}=bridge({failProjectionOnce:true});
  const result=await call(agent,{}, {action:'assign',conversation_id:chat,target_actor_id:dentist,expected_version:1,private_note:secretNote});
  assert.equal(result.status,200);
  assert.equal(result.body.provider_sync,'pending');
  assert.equal((await call(agent,{action:'messages',conversation_id:chat})).status,403);
  const received=await call(dentist,{action:'messages',conversation_id:chat});
  assert.equal(received.body.conversation.provider_sync,'synced');
  assert.equal(received.body.conversation.private_handoff_note,secretNote);
  assert.equal(notes.length,1);
  assert.ok(!JSON.stringify(transport).includes(secretNote));
});
