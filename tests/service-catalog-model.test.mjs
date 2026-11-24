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
  assert.match(app,/smyl-service-catalog-model\.js\?v=4/);
  assert.match(worker,/smyl-v263-lana-connection-recovery/);
  for(const name of ['smyl-service-catalog-model.js','smyl-service-catalog.js','smyl-service-catalog.css']){
    assert.equal(readFileSync(resolve(root,name),'utf8'),readFileSync(resolve(root,'mobile/www',name),'utf8'));
    const version=name==='smyl-service-catalog.js'?'17':name==='smyl-service-catalog.css'?'6':'4';
    assert.match(worker,new RegExp(name.replaceAll('.','\\.')+'\\?v='+version));
  }
});

test('el tratamiento de IVA define el objeto de impuesto y es obligatorio para marcar un servicio como revisado',()=>{
  // Reglas de la base (smyl_services_tax_consistency y smyl_services_no_review_while_tax_pending).
  const exempt=model.normalize({name:'Limpieza',tax_treatment:'exempt',tax_object_code:'01',tax_rate:0.5,sat_product_service_code:'85122001',sat_unit_code:'E48'});
  assert.equal(exempt.tax_treatment,'exempt'); assert.equal(exempt.tax_object_code,'02'); assert.equal(exempt.tax_rate,null);
  const rate=model.normalize({name:'Blanqueamiento',tax_treatment:'rate'});
  assert.equal(rate.tax_object_code,'02'); assert.equal(rate.tax_rate,0.16);
  assert.equal(model.normalize({name:'x',tax_treatment:'rate',tax_rate:0.08}).tax_rate,0.08);
  const nonObject=model.normalize({name:'Donativo',tax_treatment:'non_object',tax_object_code:'02',tax_rate:0.16});
  assert.equal(nonObject.tax_object_code,'01'); assert.equal(nonObject.tax_rate,null);
  const pending=model.normalize({name:'Pendiente',tax_object_code:'02',tax_rate:0.16});
  assert.equal(pending.tax_treatment,'pending'); assert.equal(pending.tax_object_code,'02'); assert.equal(pending.tax_rate,null);
  assert.equal(model.normalize({name:'x',tax_treatment:'invalido'}).tax_treatment,'pending');
  const reviewedPending=Object.assign(model.normalize({name:'Consulta',sat_product_service_code:'85122001',sat_unit_code:'E48'}),{fiscal_status:'reviewed'});
  assert.ok(model.validate(reviewedPending).some(e=>/tratamiento de IVA/i.test(e)));
  assert.deepEqual(model.validate(Object.assign({},reviewedPending,model.normalize({name:'Consulta',tax_treatment:'exempt',sat_product_service_code:'85122001',sat_unit_code:'E48'}),{fiscal_status:'reviewed'})),[]);
  assert.deepEqual(model.taxTreatments.map(x=>x[0]),['pending','exempt','rate','non_object']);
});
