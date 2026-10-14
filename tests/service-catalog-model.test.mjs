import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require=createRequire(import.meta.url);
const model=require('../smyl-service-catalog-model.js');
const root=resolve(import.meta.dirname,'..');

test('offers a complete multi-specialty opt-in menu',()=>{
  assert.ok(model.presets.length>=55);
  const categories=new Set(model.presets.map(x=>x.category));
  ['preventive','restorative','endodontic','periodontic','surgery','prosthodontic','aesthetic','orthodontic','implantology','pediatric','emergency','imaging'].forEach(x=>assert.ok(categories.has(x),x));
  assert.equal(new Set(model.presets.map(x=>x.key)).size,model.presets.length);
});

test('presets remain fiscally pending until reviewed by the issuer',()=>{
  const row=model.presetInsert(model.presets.find(x=>x.key==='aesthetic-ceramic-veneer'),'tenant','actor');
  assert.equal(row.fiscal_status,'pending');
  assert.equal(row.sat_product_service_code,'85122001');
  assert.equal(row.sat_unit_code,null);
  assert.equal(model.validate(row).length,0);
});

test('validates clinical and fiscal codes without inventing treatment decisions',()=>{
  const bad={name:'X',category:'invented',scope_type:'magic',pricing_mode:'free',duration_minutes:1,sat_product_service_code:'ABC'};
  assert.ok(model.validate(bad).length>=5);
  const clean=model.normalize({name:'Consulta',category:'diagnostic',scope_type:'session',pricing_mode:'fixed',duration_minutes:30,reference_price:'850'});
  assert.equal(clean.reference_price,850);
  assert.equal(clean.active,true);
});

test('ships additive versioning, RLS, offline assets and mobile parity',()=>{
  const migration=readFileSync(resolve(root,'supabase/migrations/20261013000000_smyl_service_catalog.sql'),'utf8');
  assert.match(migration,/alter table public\.smyl_services/);
  assert.match(migration,/create table public\.smyl_service_versions/);
  assert.match(migration,/smyl_has_permission\(tenant_id, 'schedule\.read'\)/);
  assert.doesNotMatch(migration,/drop table|drop column/i);
  const app=readFileSync(resolve(root,'app.html'),'utf8');
  const mobile=readFileSync(resolve(root,'mobile/www/app.html'),'utf8');
  const worker=readFileSync(resolve(root,'sw.js'),'utf8');
  assert.equal(app,mobile);
  assert.match(app,/smyl-service-catalog-model\.js\?v=1/);
  assert.match(worker,/smyl-v235-clinical-browser-privacy/);
  for(const name of ['smyl-service-catalog-model.js','smyl-service-catalog.js','smyl-service-catalog.css']){
    assert.equal(readFileSync(resolve(root,name),'utf8'),readFileSync(resolve(root,'mobile/www',name),'utf8'));
    const version=name==='smyl-service-catalog.js'?'3':'1';
    assert.match(worker,new RegExp(name.replaceAll('.','\\.')+'\\?v='+version));
  }
});
