import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const schema=readFileSync(new URL('../supabase/migrations/20261012330000_smyl_finance.sql',import.meta.url),'utf8');
const actions=readFileSync(new URL('../supabase/migrations/20261012340000_smyl_finance_actions.sql',import.meta.url),'utf8');
const ui=readFileSync(new URL('../smyl-finance.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

test('stage 5 models immutable patient finance and cash records',()=>{
  for(const table of ['smyl_finance_charges','smyl_finance_payments','smyl_finance_payment_allocations','smyl_finance_refunds','smyl_finance_refund_allocations','smyl_cash_sessions','smyl_cash_adjustments','smyl_finance_receipts','smyl_patient_fiscal_profiles','smyl_cfdi_drafts']) assert.match(schema,new RegExp(`create table public\\.${table}`));
  assert.match(schema,/foreign key\(tenant_id,patient_id\) references public\.camila_pacientes/);
  assert.match(actions,/document_type','internal_receipt'/);
  assert.match(schema,/revoke all on table[\s\S]*from anon,authenticated/);
});

test('stage 5 mutations are permissioned, idempotent and transactional',()=>{
  for(const fn of ['smyl_post_charge','smyl_void_charge','smyl_open_cash_session','smyl_post_payment','smyl_refund_payment','smyl_post_cash_adjustment','smyl_close_cash_session','smyl_prepare_cfdi_draft']) assert.match(actions,new RegExp(`function public\\.${fn}`));
  assert.match(actions,/idempotency_key=p_idempotency_key/g);
  assert.match(actions,/finance\.manage/g);
  assert.match(actions,/Las aplicaciones superan el pago/);
  assert.match(actions,/status='closed',expected_cash=v_expected/);
  assert.doesNotMatch(actions,/stripe/i);
});

test('stage 5 UI distinguishes receipts, CFDI drafts and SaaS billing',()=>{
  assert.match(ui,/Caja y cuentas/);
  assert.match(ui,/Separado de la suscripción de SMYL/);
  assert.match(ui,/Comprobante interno de pago/);
  assert.match(ui,/no consulta, timbra ni envía información al SAT o a un PAC/);
  assert.match(ui,/smyl_prepare_cfdi_draft/);
  assert.match(app,/smyl-finance\.js\?v=6/);
  assert.match(ui,/forPatient:function\(patientId\)/);
assert.match(sw,/smyl-v230-professional-directory/);
  assert.equal(app,read('../mobile/www/app.html'));
  assert.equal(ui,read('../mobile/www/smyl-finance.js'));
  assert.equal(read('../smyl-finance.css'),read('../mobile/www/smyl-finance.css'));
});
