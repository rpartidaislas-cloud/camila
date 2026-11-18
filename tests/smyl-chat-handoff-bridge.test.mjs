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

function bridge({failProjectionOnce = false} = {}) {
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
      limit(size) { rows = rows.slice(0,size); return query; },
      maybeSingle() { return Promise.resolve({data:rows[0] || null,error:null}); },
      then(done,fail) { return Promise.resolve({data:rows,error:null}).then(done,fail); },
    };
    return query;
  }
  async function rpc(name,p) {
    if(name === 'smyl_chat_visible_ids') return {data:p.p_conversations.filter(id=>p.p_tenant === tenant && modes.get(p.p_actor) !== 'none' &&
      (p.p_actor === tenant || assignments.some(row=>row.conversation_id===id && row.assignee_id===p.p_actor)))};
    if(name === 'smyl_chat_clinic_wide') return {data:p.p_tenant === tenant && p.p_user === tenant};
    if(name === 'smyl_chat_visible') return {data:p.p_tenant === tenant && modes.get(p.p_actor) !== 'none' &&
      (p.p_actor === tenant || assignments.some(row=>row.conversation_id===p.p_conversation && row.assignee_id===p.p_actor))};
    if(name === 'smyl_chat_mode') return {data:modes.get(p.p_user) || 'none'};
    if(name === 'smyl_chat_assistants') return {data:users.filter(user=>modes.get(user.id)!=='none')
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
    const conversation = {id:chat,contact_name:'Contacto de prueba',can_operate:true,assigned_actor_id:remoteOwner};
    let body;
    if(path.startsWith('/inbox?')) body={conversations:[conversation,{id:other,last_message:'Otro chat'}],page:{has_more:false,total:2}};
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
