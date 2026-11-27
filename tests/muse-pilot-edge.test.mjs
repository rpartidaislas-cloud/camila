import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import * as core from '../supabase/functions/_shared/muse-core.mjs';
const require=createRequire(path.resolve(process.env.SMYL_PGLITE_DIR || '../promodesk-calendar-voice/node_modules','loader.cjs'));
const ts=require('typescript');
function load(relative,modules,serve,env=()=>undefined){
  const file=new URL('../supabase/functions/'+relative,import.meta.url);
  const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports={};new Function('require','exports','Deno',js)(name=>{if(!(name in modules))throw new Error('Unexpected import '+name);return modules[name];},exports,{serve,env:{get:env}});return exports;
}
function setup({claim=true,permitted=true,transportStatus=200,transportBody={ok:true},transportThrows=false}={}){
  const c={id:randomUUID(),tenant_id:randomUUID(),user_id:randomUUID()};
  const conversation=randomUUID(),draft=randomUUID(),calls=[],saved=[];
  const db={
    rpc:async(name,args)=>{calls.push([name,args]);if(name==='smyl_muse_authenticate')return {data:[c]};if(name==='smyl_muse_allowed')return {data:permitted};
      if(name==='smyl_muse_claim_draft')return {data:{id:draft,conversation_id:conversation,content:'Texto aprobado',claimed:claim,status:claim?'sending':'accepted'}};throw new Error(name);},
    from(name){let operation;const query={select(){return query;},eq(){return query;},maybeSingle:async()=>({data:{nombre:'Doctora de prueba'}}),
      update(data){operation=data;saved.push([name,data]);return query;},insert(data){saved.push([name,data]);return Promise.resolve({error:null});},
      then(resolve){return Promise.resolve({error:null,data:operation}).then(resolve);}};return query;}
  };
  const lanaRequest=async(tenant,url,init)=>{calls.push(['transport',{tenant,url,init}]);if(transportThrows)throw new Error('timeout');return {response:new Response('{}',{status:transportStatus}),body:transportBody};};
  const shared={'./lana-linked.ts':{smylAdmin:db,lanaRequest},'./muse-core.mjs':core};
  const inbox=load('_shared/muse-inbox.ts',shared);
  let handler;load('muse-connector/index.ts',{'../_shared/lana-linked.ts':{smylAdmin:db,lanaRequest},'../_shared/muse-core.mjs':core,'../_shared/muse-inbox.ts':inbox},fn=>handler=fn);
  const request=(route,body,credential='smyl_muse_'+core.token())=>handler(new Request('https://test.invalid/functions/v1/muse-connector'+route,{method:'POST',headers:{Authorization:'Bearer '+credential},body:JSON.stringify(body)}));
  return {request,calls,saved,draft,conversation,c};
}
test('actual edge handler refuses tenant injection, action smuggling and missing confirmation',async()=>{
  const s=setup();
  for(const [route,body] of [['/chats',{tenant_id:randomUUID()}],['/chats',{action:'send_reply'}],['/reply/send',{draft_id:s.draft,confirmation_token:core.token(),confirmed:false}]]){
    assert.equal((await s.request(route,body)).status,400);
  }
  assert.equal((await s.request('/chats',{},'foreign-secret')).status,401);
  assert.equal(s.calls.some(([name])=>name==='transport'),false);
});
test('approved immutable reply uses doctor identity and stable request ID; replay does not send',async()=>{
  const s=setup();const response=await s.request('/reply/send',{draft_id:s.draft,confirmation_token:core.token(),confirmed:true});
  assert.equal((await response.json()).status,'accepted');
  const sent=s.calls.find(([n])=>n==='transport')[1];
  assert.equal(sent.tenant,s.c.tenant_id);assert.equal(sent.url,`/inbox/conversations/${s.conversation}/messages`);
  assert.equal(sent.init.headers.get('X-SMYL-Actor-Id'),s.c.user_id);
  assert.equal(sent.init.headers.get('Idempotency-Key'),s.draft);
  assert.deepEqual(JSON.parse(sent.init.body),{type:'text',content:'Texto aprobado'});
  const retry=setup({claim:false});assert.equal((await (await retry.request('/reply/send',{draft_id:retry.draft,confirmation_token:core.token(),confirmed:true})).json()).duplicate,true);
  assert.equal(retry.calls.some(([n])=>n==='transport'),false);
});
test('revocation before transport prevents send; uncertain delivery is not reported as failure',async()=>{
  for(const options of [{permitted:false},{transportThrows:true},{transportStatus:409,transportBody:{code:'send_unknown'}},{transportStatus:409,transportBody:{code:'whatsapp_window_expired'}}]){
    const s=setup(options);const body=await (await s.request('/reply/send',{draft_id:s.draft,confirmation_token:core.token(),confirmed:true})).json();
    const uncertain=options.transportThrows || options.transportBody?.code==='send_unknown';
    assert.equal(body.status,uncertain?'unknown':'failed');
    if(options.permitted===false)assert.equal(s.calls.some(([n])=>n==='transport'),false);
    assert.equal(s.saved.some(([name,data])=>name==='smyl_muse_drafts' && data.content==='[contenido retirado]'),true);
  }
});
test('alert worker uses only generic approved template, linked doctor and stable job ID',async()=>{
  for(const permitted of [true,false]){
    const user=randomUUID(),tenant=randomUUID(),chat=randomUUID(),doctorChannel=randomUUID(),job=randomUUID(),saved=[],sent=[];
    const data={
      smyl_muse_connections:{id:randomUUID(),tenant_id:tenant,user_id:user,whatsapp_alerts:true},
      smyl_chat_assignments:{assignee_id:user,version:2},
      smyl_professionals:{id:randomUUID()},
      smyl_professional_whatsapp_links:{lana_conversation_id:doctorChannel,linked_by:user}
    };
    const db={rpc:async name=>({data:name==='smyl_muse_claim_alerts'?[{id:job,tenant_id:tenant,user_id:user,conversation_id:chat,assignment_version:2,attempts:1}]:null}),
      from(name){const q={select(){return q;},eq(){return q;},is(){return q;},maybeSingle:async()=>({data:data[name]}),
        update(payload){saved.push(payload);return q;},then(resolve){return Promise.resolve({error:null}).then(resolve);}};return q;}};
    const lanaRequest=async(t,url,init)=>{if(init.method==='GET')return {response:new Response('{}'),body:{templates:[{id:'template-id',name:'smyl_chat_pendiente_profesional_v1',status:'APPROVED',category:'UTILITY'}]}};
      sent.push({t,url,init});return {response:new Response('{}'),body:{ok:true}};};
    let handler;load('muse-alerts/index.ts',{'../_shared/lana-linked.ts':{smylAdmin:db,lanaRequest},'../_shared/muse-core.mjs':core,
      '../_shared/muse-inbox.ts':{allowed:async()=>permitted}},fn=>handler=fn,name=>name==='SUPABASE_SERVICE_ROLE_KEY'?'worker-test-key':undefined);
    assert.equal((await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer invalid'}}))).status,401);
    assert.equal((await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer worker-test-key'}}))).status,200);
    assert.equal(sent.length,permitted?1:0);
    if(permitted){assert.equal(sent[0].url,`/inbox/conversations/${doctorChannel}/messages`);assert.equal(sent[0].init.headers.get('Idempotency-Key'),job);
      assert.deepEqual(JSON.parse(sent[0].init.body),{type:'template',template_id:'template-id',template_variables:[]});}
    assert.equal(saved[0].status,permitted?'accepted':'skipped');
  }
});
