import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const fiscal=require('../smyl-dental-fiscal-model.js');
const root=resolve(import.meta.dirname,'..');

test('limits the fiscal model to dental concepts',()=>{
  assert.ok(fiscal.serviceKinds.every(x=>x[0].includes('dental')||['oral_surgery','orthodontics'].includes(x[0])));
  assert.deepEqual(fiscal.dentalSatKeys.orthodontics,['85122005']);
  assert.equal(fiscal.suggestedPolicy({sat_product_service_code:'85122004'}).fiscal_service_kind,'oral_surgery');
});

test('professional dental care is suggested as object of tax with exempt IVA, never auto-reviewed',()=>{
  const policy=fiscal.suggestedPolicy({key:'preventive-prophylaxis',sat_product_service_code:'85122002'});
  assert.equal(policy.tax_treatment,'exempt');
  assert.equal(policy.tax_object_code,'02');
  assert.equal(policy.tax_rate,null);
  assert.equal(policy.professional_title_required,true);
});

test('rejects inconsistent tax combinations and unrelated SAT keys',()=>{
  assert.ok(fiscal.validate({fiscal_service_kind:'orthodontics',tax_treatment:'exempt',tax_object_code:'01',sat_product_service_code:'85122005'}).length>0);
  assert.ok(fiscal.validate({fiscal_service_kind:'orthodontics',tax_treatment:'exempt',tax_object_code:'02',sat_product_service_code:'01010101'}).length>0);
  assert.equal(fiscal.validate({fiscal_service_kind:'orthodontics',tax_treatment:'exempt',tax_object_code:'02',sat_product_service_code:'85122005'}).length,0);
});

test('decides PUE or PPD from confirmed money, not from a UI choice',()=>{
  assert.deepEqual(fiscal.paymentDecision(1000,[{amount:1000,payment_form:'03',status:'confirmed'}]),{payment_method:'PUE',payment_form:'03',paid:1000,balance:0});
  assert.deepEqual(fiscal.paymentDecision(1000,[{amount:300,payment_form:'04',status:'confirmed'}]),{payment_method:'PPD',payment_form:'99',paid:300,balance:700});
});

test('distinguishes a treatment partial payment from a true advance and warns about cash deductions',()=>{
  assert.equal(fiscal.depositKind(true,true),'partial_payment');
  assert.equal(fiscal.depositKind(false,true),'advance');
  assert.ok(fiscal.deductionGuidance({cfdi_use:'D01',receiver_person_type:'individual',payment_form:'01'}).warnings.length);
  assert.ok(fiscal.deductionGuidance({cfdi_use:'D01',receiver_person_type:'company',payment_form:'03'}).warnings.length);
});

test('migration is additive and enforces reviewed tax consistency',()=>{
  const sql=readFileSync(resolve(root,'supabase/migrations/20261014010000_smyl_dental_fiscal_policy.sql'),'utf8');
  assert.match(sql,/add column fiscal_service_kind/);
  assert.match(sql,/smyl_services_tax_consistency/);
  assert.match(sql,/smyl_services_no_review_while_tax_pending/);
  assert.doesNotMatch(sql,/drop table|drop column/i);
});
