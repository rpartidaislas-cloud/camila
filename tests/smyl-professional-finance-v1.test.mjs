import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const finance = read('smyl-finance.js');
const admin = read('smyl-clinic-admin.js');
const migration = read('supabase/migrations/20261113123000_smyl_professional_finance_roles.sql');
const workflow = read('.github/workflows/smyl-finanzas-profesionales-migracion.yml');

test('los roles separan cobros, caja, supervisión y facturación', () => {
  for (const permission of ['finance.cash', 'finance.cash.supervise', 'finance.invoice']) {
    assert.match(migration, new RegExp(permission.replace('.', '\\.')));
    assert.match(admin, new RegExp(permission.replace('.', '\\.')));
    assert.match(finance, new RegExp(permission.replace('.', '\\.')));
  }
  for (const label of ['Abrir y operar su caja', 'Supervisar cajas del equipo', 'Preparar facturas']) {
    assert.match(admin, new RegExp(label));
  }
});

test('la migración conserva acceso y protege operaciones sensibles en el servidor', () => {
  assert.match(migration, /where rp\.permission_key = 'finance\.manage'/);
  assert.match(migration, /smyl_cash_role_guard/);
  assert.match(migration, /new\.opened_by is distinct from auth\.uid\(\)/);
  assert.match(migration, /No puedes registrar efectivo en la caja de otra persona/);
  assert.match(migration, /smyl_invoice_role_guard/);
  for (const table of ['smyl_patient_fiscal_profiles', 'smyl_issuer_fiscal_profiles', 'smyl_cfdi_pac_readiness', 'smyl_cfdi_drafts', 'smyl_cfdi_cancellation_plans']) {
    assert.match(migration, new RegExp(table + '_invoice_guard'));
  }
});

test('Caja muestra responsabilidad individual y supervisión explícita', () => {
  for (const copy of ['Mi caja abierta', 'Responsable:', 'Cajas abiertas del equipo', 'Revisar corte', 'Abrir mi caja']) {
    assert.match(finance, new RegExp(copy));
  }
  assert.match(finance, /opened_by===state\.actor/);
  assert.match(finance, /state\.canSuperviseCash/);
  assert.match(finance, /function actorName\(id\)/);
});

test('Recibos queda primero y el libro de pagos pasa a movimientos secundarios', () => {
  assert.match(finance, /nav\.prepend\(receiptTab\)/);
  assert.match(finance, /if\(paymentTab\)paymentTab\.remove\(\)/);
  assert.match(finance, /Movimientos y correcciones/);
  assert.match(finance, /data-receipt-ledger/);
  assert.match(finance, /state\.tab='receipts'/);
});

test('web y PWA conservan paridad de código y caché', () => {
  for (const file of ['smyl-finance.js', 'smyl-finance.css', 'smyl-clinic-admin.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read('mobile/www/' + file), file);
  }
  assert.match(read('sw.js'), /professional-finance-v1/);
});

test('producción aplica la migración sólo de forma manual y verifica el resultado', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /20261113123000_smyl_professional_finance_roles\.sql/);
  assert.match(workflow, /smyl_cash_role_guard/);
  assert.match(workflow, /smyl_cfdi_drafts_invoice_guard/);
  assert.match(workflow, /schema_migrations/);
  assert.doesNotMatch(workflow, /pull_request|push:/);
});
