import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const schema = read('../supabase/migrations/20261012300000_smyl_dental_inventory.sql');
const actions = read('../supabase/migrations/20261012310000_smyl_dental_inventory_actions.sql');
const hardening = read('../supabase/migrations/20261012320000_smyl_dental_inventory_hardening.sql');
const app = read('../app.html');
const script = read('../smyl-inventory.js');
const styles = read('../smyl-inventory.css');
const worker = read('../sw.js');

test('inventory owns the complete dental purchasing and stock domain in SMYL', () => {
  for (const table of ['smyl_inventory_suppliers','smyl_inventory_locations','smyl_inventory_items','smyl_inventory_reorder_levels','smyl_inventory_lots','smyl_purchase_orders','smyl_purchase_order_lines','smyl_inventory_movements','smyl_inventory_movement_lines','smyl_service_materials']) {
    assert.match(schema, new RegExp(`create table public\\.${table}\\b`));
    assert.match(schema, new RegExp(`alter table public\\.%I enable row level security|alter table public\\.${table} enable row level security`));
  }
  assert.match(schema, /foreign key\(tenant_id,patient_id\) references public\.camila_pacientes/);
  assert.match(schema, /foreign key\(tenant_id,appointment_id\) references public\.smyl_appointments/);
});

test('lots support expiry, serial and patient traceability', () => {
  assert.match(schema, /track_lot boolean/);
  assert.match(schema, /track_expiry boolean/);
  assert.match(schema, /track_serial boolean/);
  assert.match(schema, /requires_patient_trace boolean/);
  assert.match(actions, /No se puede consumir un lote caducado/);
  assert.match(actions, /Este insumo exige trazabilidad por paciente/);
});

test('stock is ledger-derived and confirmed movements are immutable', () => {
  assert.match(actions, /smyl_inventory_balance/);
  assert.match(actions, /destination_location_id=p_location then l\.quantity/);
  assert.match(actions, /source_location_id=p_location then l\.quantity/);
  assert.match(hardening, /smyl_inventory_movements_immutable/);
  assert.match(hardening, /movimientos confirmados son inmutables/);
  assert.match(actions, /smyl_reverse_inventory_movement/);
  assert.doesNotMatch(schema, /current_stock|stock_quantity/);
});

test('sensitive stock and purchase actions are atomic and idempotent', () => {
  assert.match(actions, /smyl_post_inventory_movement/);
  assert.match(actions, /smyl_receive_purchase_order/);
  assert.match(actions, /idempotency_key=p_idempotency_key/);
  assert.match(actions, /pg_advisory_xact_lock/);
  assert.match(actions, /Existencia insuficiente/);
  assert.match(schema, /unique\(tenant_id,idempotency_key\)/);
});

test('browser can manage catalog but cannot write ledger or purchases directly', () => {
  assert.match(schema, /grant insert,update on table public\.smyl_inventory_suppliers[\s\S]*smyl_service_materials to authenticated/);
  assert.match(schema, /grant select on table[\s\S]*smyl_inventory_movements[\s\S]*to authenticated/);
  const directWriteGrant = schema.match(/grant insert,update on table[^;]+;/)?.[0] || '';
  assert.doesNotMatch(directWriteGrant, /smyl_inventory_movements|smyl_purchase_orders/);
  assert.match(schema, /smyl_has_permission\(tenant_id,''inventory\.read''\)/);
  assert.match(schema, /smyl_has_permission\(tenant_id,'inventory\.manage'\)/);
});

test('inventory interface covers stock, movements, purchasing and configuration', () => {
  assert.match(app, /smyl-inventory\.css\?v=1/);
  assert.match(app, /smyl-inventory\.js\?v=1/);
  assert.match(script, /Existencias/);
  assert.match(script, /Libro de movimientos/);
  assert.match(script, /Órdenes y recepciones/);
  assert.match(script, /Catálogo y configuración/);
  assert.match(script, /inventory\.read/);
  assert.match(script, /inventory\.manage/);
  assert.doesNotMatch(script, /LANA/i);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /@media\(max-width:440px\)/);
});

test('web, mobile and offline inventory assets stay in lockstep', () => {
  assert.equal(app, read('../mobile/www/app.html'));
  assert.equal(script, read('../mobile/www/smyl-inventory.js'));
  assert.equal(styles, read('../mobile/www/smyl-inventory.css'));
assert.match(worker, /smyl-v203-delegated-proposals/);
  assert.match(worker, /smyl-inventory\.js\?v=1/);
  assert.match(worker, /smyl-inventory\.css\?v=1/);
});
