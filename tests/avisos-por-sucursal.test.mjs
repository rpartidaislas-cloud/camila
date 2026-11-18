import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { messageAccess, visibleConversationIds } from '../supabase/functions/_shared/messages-scope.ts';
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('el perfil y el alcance de los avisos proceden de la política de asignación de la bandeja', async () => {
  let assigned = ['norte'];
  const calls = [];
  const db = { rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: name === 'smyl_chat_mode' ? 'agent' : assigned };
  } };
  const reader = await messageAccess(db, 'clinica', 'recepcion');
  assert.equal(reader.canRead, true);
  const ids = ['norte', 'sur', 'norte'];
  assert.deepEqual([...await visibleConversationIds(db, 'clinica', reader, ids)], ['norte']);
  assert.deepEqual(calls, [
    ['smyl_chat_mode', { p_tenant: 'clinica', p_user: 'recepcion' }],
    ['smyl_chat_visible_ids', { p_tenant: 'clinica', p_actor: 'recepcion', p_conversations: ['norte','sur'] }]
  ]);
  assigned = ['sur'];
  assert.deepEqual([...await visibleConversationIds(db, 'clinica', reader, ids)], ['sur']);
});

test('sin acceso no se consulta ningún chat; los errores de autorización nunca abren la lista', async () => {
  const denied = await messageAccess({rpc: async () => ({data:'none'})}, 'clinica', 'titular');
  assert.equal(denied.canRead, false);
  assert.equal((await visibleConversationIds({rpc: assert.fail}, 'clinica', denied, ['uno'])).size, 0);
  const unavailable = {rpc: async () => ({data:null,error:{code:'42501'}})};
  await assert.rejects(messageAccess(unavailable, 'clinica', 'titular'));
  await assert.rejects(visibleConversationIds(unavailable, 'clinica', {userId:'titular',canRead:true}, ['uno']));
});

test('los totales, los vínculos de pacientes y el cierre de una alerta se limitan a resultados autorizados', () => {
  const src = read('supabase/functions/lana-attention/index.ts');
  assert.match(src, /if \(!access\.canRead\) return json\(200, \{ ok: true, total: 0, items: \[\]/);
  assert.match(src, /\.in\("lana_conversation_id", \[\.\.\.visible\]\)/);
  assert.match(src, /if \(!id \|\| !visible\.has\(id\)\) return \[\];/);
  assert.match(src, /total: items.length/);
  assert.doesNotMatch(src, /remote\.body\.total/);
  assert.match(src, /if \(!visible\.has\(conversationId\)\) return json\(403[\s\S]*?await lanaRequest\(auth.tenantId, `\/attention\/\$\{conversationId\}\/resolve`/);
});

test('la sincronización de asignaciones retira los chats invisibles y actualiza la lista', () => {
  const edge = read('supabase/functions/lana-inbox/index.ts');
  const ui = read('smyl-inbox.js');
  assert.match(edge, /admin\.rpc\("smyl_chat_scope_changed", \{ p_tenant: tenantId, p_actor: actor\.id, p_since: stamp \}\)/);
  assert.match(edge, /await attachBranchChanges\(actor, auth\.tenantId, url, scopedBody, remote\.body\)/);
  assert.match(edge, /body\.removed_conversation_ids\s*=\s*known\.filter\(id => deleted\.has\(id\) \|\| !visible\.has\(id\)\)/);
  assert.match(edge, /body\.branch_changed\s*=\s*changed.data === true/);
  assert.match(ui, /if \(data\.branch_changed\)[\s\S]{0,240}await loadList\(true\)/);
});

test('el endpoint de avisos filtra antes de consultar vínculos y antes de resolver', async () => {
  const own='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
  let mode='agent', actor='recepcion', handler;
  const providerCalls=[], linksRead=[];
  const smylAdmin={
    rpc:async (name,args)=>({data:name==='smyl_chat_mode'?mode:args.p_conversations.filter(id=>id===own)}),
    from(){return {select(){return this;},eq(){return this;},in(key,ids){linksRead.push(...ids);return {data:[]};}};}
  };
  const source=read('supabase/functions/lana-attention/index.ts').replace(/^import [^;]+;\s*/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{
    Deno:{serve:fn=>{handler=fn;}},Response,console,
    requireUser:async()=>({user:{id:actor},tenantId:'clinica'}),makeCors:()=>({}),
    smylAdmin,messageAccess,visibleConversationIds,
    lanaRequest:async (tenant,path)=>{providerCalls.push(path);return {
      response:{ok:true},body:{total:20,items:[{id:own},{id:other}]}
    };}
  });
  const get=()=>handler(new Request('https://example.test/'));
  const resolve=id=>handler(new Request('https://example.test/',{method:'POST',body:JSON.stringify({action:'resolve',conversation_id:id})}));
  const body=await (await get()).json();
  assert.deepEqual(body.items.map(x=>x.id),[own]);assert.equal(body.total,1);
  assert.deepEqual(linksRead,[own]);
  assert.equal((await resolve(own)).status,403);
  actor='clinica';mode='none';
  assert.equal((await (await get()).json()).total,0);
  assert.equal((await resolve(own)).status,403);
  mode='coordinator';
  assert.equal((await resolve(other)).status,403);
  assert.deepEqual(providerCalls,['/attention?limit=40']);
  assert.equal((await resolve(own)).status,200);
  assert.deepEqual(providerCalls,['/attention?limit=40','/attention/'+own+'/resolve']);
});
