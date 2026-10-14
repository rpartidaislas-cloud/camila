import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const clinical=require('../smyl-clinical-model.js'),proposal=require('../smyl-proposal-model.js');
const read=p=>readFileSync(resolve(root,p),'utf8');

const service={name:'Resina de una superficie',patient_name:'Restauración estética',category:'restorative',specialty:'restorative',scope_type:'surface',pricing_mode:'per_surface',reference_price:1250,currency:'MXN',sat_product_service_code:'85122001',sat_unit_code:'E48',tax_object_code:'02',fiscal_status:'reviewed'};
const plan={revision:4,document:{schema:2,reason:'Molestia localizada',background:'',assessment:'Lesión confirmada por el profesional.',treatments:[{id:'tx-1',name:'Resina',area:'',notes:'',phase:'treat',service_id:'11111111-1111-4111-8111-111111111111',service_revision:3,service_snapshot:service,teeth:['16','26'],surfaces:['O']}]}};

test('schema 2 conserva servicio, revisión y objetivos FDI explícitos',()=>{
  const doc=clinical.normalize(plan.document);
  assert.equal(doc.schema,2);assert.deepEqual(doc.treatments[0].teeth,['16','26']);assert.deepEqual(doc.treatments[0].surfaces,['O']);
  assert.equal(doc.treatments[0].service_revision,3);assert.equal(clinical.reviewError(doc),'');assert.equal(clinical.areaLabel(doc.treatments[0]),'Piezas 16, 26 · Superficies O');
});

test('la cotización congela el catálogo y calcula por superficie',()=>{
  const doc=proposal.fromPlan(plan),item=doc.items[0];
  assert.equal(doc.schema,2);assert.equal(item.quantity,2);assert.equal(item.unit_cents,125000);assert.equal(item.treatment_id,'tx-1');assert.equal(item.service_snapshot.fiscal_status,'reviewed');
  doc.valid_until='2099-12-31';doc.terms='Sujeto a revisión clínica y consentimiento informado.';assert.equal(proposal.valid(doc,true),'');
});

test('el servidor verifica snapshots y que la cotización coincida con el plan revisado',()=>{
  const sql=read('supabase/migrations/20261013010000_smyl_treatment_proposal_v2.sql');
  assert.match(sql,/smyl_save_clinical_plan_v2/);assert.match(sql,/Service snapshot mismatch/);assert.match(sql,/Quote source does not match reviewed plan/);
  assert.match(sql,/jsonb_array_elements_text\(item->'teeth'\)/);assert.match(sql,/catalog_revision=/);assert.match(sql,/revoke all[\s\S]*from public,anon/);
  assert.doesNotMatch(sql,/drop table|drop column/i);
});

test('la interfaz permite señalar dientes y la propuesta imprime un mapa sin historia clínica',()=>{
  const clinic=read('smyl-clinic.js'),print=read('smyl-proposal-print.js'),app=read('app.html'),worker=read('sw.js');
  assert.match(clinic,/Señalar en odontograma/);assert.match(clinic,/SmylToothMap\.render/);assert.match(clinic,/smyl_save_clinical_plan_v2/);
assert.match(print,/Dónde se realizará el tratamiento/);assert.match(print,/No muestra antecedentes ni notas internas/);assert.match(app,/smyl-proposal-model\.js\?v=2/);assert.match(worker,/smyl-v204-proposal-followup/);
  for(const file of ['app.html','sw.js','smyl-clinical-model.js','smyl-clinic.js','smyl-clinic.css','smyl-proposal-model.js','smyl-proposal-print.js','smyl-proposals.js','smyl-proposals.css'])assert.equal(read(file),read('mobile/www/'+file));
});
