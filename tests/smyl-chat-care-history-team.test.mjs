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

test('roster and assignment use one gate for active SMYL inbox users, not directory-only dentists', () => {
  const fnText = edge.slice(edge.indexOf('type TeamCandidate ='),edge.indexOf('// Las claves foráneas compuestas'));
  const eligible = vm.runInNewContext(stripTypeScriptTypes(fnText)+'; eligibleTeamMember', { text:v=>String(v??'') });
  const role = (active,...grants) => ({smyl_roles:{active,smyl_role_permissions:grants.map(permission_key=>({permission_key}))}});
  const member = {id:'staff',tenant_id:'clinic',activo:true,rol:'staff',nombre:'Test',smyl_member_roles:[role(true,'messages.read'),role(true,'messages.respond')]};
  assert.equal(eligible(member,'clinic').kind,'staff');
  assert.equal(eligible({...member,smyl_professionals:[{active:true,display_name:'Profesional sintético'}]},'clinic').kind,'professional');
  assert.equal(eligible({...member,smyl_member_roles:[],id:'clinic'},'clinic').kind,'owner');
  assert.equal(eligible({...member,smyl_member_roles:[role(true,'messages.read'),role(false,'messages.respond')]},'clinic'),null);
  assert.equal(eligible({...member,smyl_member_roles:[role(true,'messages.respond')]},'clinic'),null);
  assert.equal(eligible({...member,activo:false},'clinic'),null);
  assert.equal(eligible(member,'other'),null);
  assert.match(edge,/members: await assignableTeam\(tenantId\)/);
  assert.match(edge,/await assignableTeam\(auth\.tenantId, targetId\)/);
  assert.match(edge,/if \(targetId\) query = query.eq\("id", targetId\)/);
});
