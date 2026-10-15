import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261015010000_smyl_inventory_costing_v1.sql');
const script = read('../smyl-inventory.js');
const styles = read('../smyl-inventory.css');

test('el servidor deriva y congela el costo de cada salida', () => {
  assert.match(migration, /smyl_inventory_historical_unit_cost/);
  assert.match(migration, /sum\(l\.quantity\*l\.unit_cost\)\/nullif\(sum\(l\.quantity\),0\)/);
  assert.match(migration, /m\.movement_type in \('receipt','adjustment_in'\)/);
  assert.match(migration, /reversal\.reversal_of=m\.id/);
  assert.match(migration, /if p_movement_type='adjustment_in' then[\s\S]*v_unit_cost:=v_line\.unit_cost;[\s\S]*else[\s\S]*smyl_inventory_historical_unit_cost/);
  assert.match(migration, /values\(v_tenant,p_id,v_line\.item_id,v_line\.lot_id,v_line\.quantity,v_unit_cost\)/);
});

test('el costeo no reescribe movimientos históricos inmutables', () => {
  assert.doesNotMatch(migration, /update public\.smyl_inventory_movement_lines/);
  assert.doesNotMatch(migration, /alter table public\.smyl_inventory_movement_lines/);
  assert.match(migration, /No revaloriza ni modifica movimientos confirmados existentes/);
});

test('retirar materiales del kit exige permiso, tenant y deja auditoría', () => {
  assert.match(migration, /smyl_remove_service_material\(p_service_id uuid,p_item_id uuid\)/);
  assert.match(migration, /smyl_has_permission\(v_tenant,'inventory\.manage'\)/);
  assert.match(migration, /where tenant_id=v_tenant and service_id=p_service_id and item_id=p_item_id/);
  assert.match(migration, /insert into public\.smyl_audit_events/);
  assert.match(migration, /grant execute on function public\.smyl_remove_service_material\(uuid,uuid\) to authenticated/);
  assert.doesNotMatch(migration, /grant delete on table public\.smyl_service_materials/);
});

test('la interfaz distingue costo congelado de referencia y permite retirar del kit', () => {
  assert.match(script, /line\.unit_cost==null\?costs\[line\.item_id\]:Number\(line\.unit_cost\)/);
  assert.match(script, /costo histórico congelado/);
  assert.match(script, /Los anteriores no se reescriben/);
  assert.match(script, /smyl_remove_service_material/);
  assert.match(script, /Los consumos ya registrados no cambiarán/);
  assert.match(styles, /inventory-kit-material>button/);
});
