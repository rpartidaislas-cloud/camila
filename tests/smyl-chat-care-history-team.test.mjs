import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../'+p, import.meta.url), 'utf8');
const schedule = read('smyl-schedule.js');
const edge = read('supabase/functions/lana-inbox/index.ts');
const careFn = schedule.slice(schedule.indexOf('async function patientCareHistory'),schedule.indexOf('async function query'));

test('actual patient care only; historical providers, stable pagination, honest overflow and permission errors', async () => {
  async function load(length, denied) {
    const history = Array.from({length}, (_,i) => ({ id:String(i), starts_at: '2026-04-01T09:00Z', professional_id: i, branch_id: 'b',
      branch: i === 0 ? null : { name: 'Sucursal histórica' }, professional: { display_name: 'Profesional '+i } }));
    const pages = [];
    const sb = {from(table){
      assert.equal(table,'smyl_appointments');
      const filters=[], orders=[];
      return {select(cols){assert.match(cols,/branch:smyl_branches\(name\)/);return this;}, eq(k,v){filters.push([k,v]);return this;},
        order(k,v){orders.push([k,v.ascending]);return this;}, range(lo,hi){
          assert.deepEqual(filters,[['tenant_id','t'],['patient_id','p'],['status','completed']]);
          assert.deepEqual(orders,[['starts_at',false],['id',false]]);
          if (denied) throw new Error('Sin acceso');
          pages.push(lo); return history.slice(lo,hi+1);
        }};
    }};
    const fn = vm.runInNewContext('('+careFn.trim()+')', { window:{sb,tenantId:'t'}, query: async q=>q });
    const result = await fn('p');
    return {result,pages};
  }
  const {result,pages} = await load(401);
  assert.equal(result.visits.length,401);
  assert.deepEqual(pages,[0,200,400]);
  assert.equal(result.visits[0].branch_name,null);
  assert.equal(result.visits[400].professional_name,'Profesional 400');
  assert.equal(result.truncated,false);
  assert.equal((await load(1000)).result.truncated,false);
  assert.equal((await load(1001)).result.truncated,true);
  assert.equal((await load(0)).result.visits.length,0);
  await assert.rejects(load(0,true),/Sin acceso/);
});

test('roster and transfer validate the same tenant’s explicit profiles', async () => {
  const source = edge.slice(edge.indexOf('async function assignableTeam('),edge.indexOf('function projectOwner('));
  const data = [{id:'a',name:'Dra. Ana',kind:'professional',chat_mode:'agent'}];
  const eligible = vm.runInNewContext(stripTypeScriptTypes(source)+'; assignableTeam', { admin: {
    rpc: async (name, args) => { assert.equal(name,'smyl_chat_assistants'); assert.equal(args.p_tenant,'clinic'); return { data }; }
  } });
  assert.equal(await eligible('clinic'),data);
  const migration = read('supabase/migrations/20261118150000_smyl_chat_access_and_private_handoff.sql');
  assert.match(migration,/smyl_chat_mode\(p_tenant,p_target\)='none'/);
  assert.match(edge,/const recipient = roster\.find\(member => member\.id === target\)/);
});
