import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const src = read('smyl-inventory.js');
const pick = (re) => { const m = src.match(re); assert.ok(m, 'no se encontró ' + re); return m[0]; };
const helpers = new Function('state', [
  pick(/function invNum\(v\)\{[^\n]*\r?\n/), pick(/function invRound\(n\)\{[^\n]*\r?\n/), pick(/function invUnitCost\(packCost,packQty\)\{[^\n]*\r?\n/), pick(/function invPackCost\(unitCost,packQty\)\{[^\n]*\r?\n/),
  pick(/function stockValue\(rows,costs\)\{[^\n]*\r?\n/), pick(/function usageSummary\(rows,totals\)\{[\s\S]*?\r?\n  \}\r?\n/), pick(/function usagePeriod\(kind,now\)\{[\s\S]*?\r?\n  \}\r?\n/),
  pick(/function myProfessionalId\(\)\{[^\n]*\r?\n/),
].join('\n') + ';return {invNum,invUnitCost,invPackCost,stockValue,usageSummary,usagePeriod,myProfessionalId};');

test('costos: acepta $ y comas, y convierte entre costo de la presentación y costo por unidad', () => {
  const h = helpers({});
  assert.equal(h.invNum('$1,250.50'), 1250.5);
  assert.equal(h.invNum(''), null);
  assert.ok(Number.isNaN(h.invNum('abc')));
  assert.equal(h.invUnitCost(1250, 50), 25);
  assert.equal(h.invPackCost(25, 50), 1250);
  assert.equal(h.invUnitCost(100, 3), 33.3333);
  assert.equal(h.invUnitCost(100, 0), null);
  assert.equal(h.invUnitCost(null, 50), null);
});

test('valor en existencia: existencia × costo; lo que no tiene costo se cuenta aparte, no vale cero', () => {
  const h = helpers({});
  const v = h.stockValue([
    { item_id: 'a', on_hand: 20 }, { item_id: 'b', on_hand: 4 }, { item_id: 'c', on_hand: 0 }, { item_id: 'd', on_hand: 7 }, { item_id: 'd', on_hand: 1 },
  ], { a: 12.5, b: 3 });
  assert.deepEqual(v, { total: 262, missing: 1 });
});

test('consumo por profesional y tratamiento: costos, unidades sin costo y registros sin doble conteo', () => {
  const h = helpers({});
  const rows = [
    { professional_id: 'p1', professional_name: 'Dra. Ruiz', service_id: 's1', service_name: 'Resina', item_name: 'Resina A2', unit: 'pieza', quantity: 6, cost: 75, uncosted_quantity: 0 },
    { professional_id: 'p1', professional_name: 'Dra. Ruiz', service_id: 's1', service_name: 'Resina', item_name: 'Guantes', unit: 'par', quantity: 4, cost: null, uncosted_quantity: 4 },
    { professional_id: 'p2', professional_name: 'Dr. Soto', service_id: null, service_name: 'Sin tratamiento', item_name: 'Resina A2', unit: 'pieza', quantity: 2, cost: 25, uncosted_quantity: 0 },
  ];
  const totals = [{ professional_id: 'p1', service_id: 's1', movements: 3 }, { professional_id: 'p2', service_id: null, movements: 1 }];
  const s = h.usageSummary(rows, totals);
  assert.deepEqual(s.professionals.map((p) => [p.name, p.cost, p.uncosted, p.movements]), [['Dra. Ruiz', 75, 4, 3], ['Dr. Soto', 25, 0, 1]]);
  assert.deepEqual(s.professionals[0].items.map((i) => i.name), ['Resina A2', 'Guantes']);
  assert.deepEqual(s.services.map((v) => [v.name, v.cost, v.movements]), [['Resina', 75, 3], ['Sin tratamiento', 25, 1]]);
  assert.deepEqual(s.total, { cost: 100, uncosted: 4 });
  assert.deepEqual(h.usageSummary([], []).professionals, []);
});

test('periodos del reporte: 30 días, este mes y mes anterior', () => {
  const h = helpers({});
  const now = new Date(2026, 10, 14, 12, 0);
  assert.deepEqual([h.usagePeriod('30', now).from, h.usagePeriod('30', now).to], ['2026-10-16', '2026-11-14']);
  assert.deepEqual([h.usagePeriod('month', now).from, h.usagePeriod('month', now).to], ['2026-11-01', '2026-11-14']);
  assert.deepEqual([h.usagePeriod('lastMonth', now).from, h.usagePeriod('lastMonth', now).to], ['2026-10-01', '2026-10-31']);
  assert.deepEqual([h.usagePeriod('90', now).from, h.usagePeriod('90', now).to], ['2026-08-17', '2026-11-14']);
});

test('el profesional por omisión del consumo es el del usuario con sesión', () => {
  const st = { actor: 'u2', professionals: [{ id: 'p1', user_id: 'u1' }, { id: 'p2', user_id: 'u2' }] };
  assert.equal(helpers(st).myProfessionalId(), 'p2');
  assert.equal(helpers({ actor: 'x', professionals: [{ id: 'p1', user_id: 'u1' }] }).myProfessionalId(), '');
});

test('la ventana del insumo (web y móvil): costo IVA incluido, presentación, proveedor, mínimos, existencia inicial, edición y consumo', () => {
  for (const base of ['', 'mobile/www/']) {
    const j = read(base + 'smyl-inventory.js');
    assert.match(j, /function openItem\(editId\)\{/);
    assert.match(j, /typeof editId==='string'\?by\(state\.items,editId\):null/, 'el botón Agregar pasa un evento: no debe tratarse como id');
    assert.match(j, /Costo de la presentación <span class="inventory-optional">\(IVA incluido\)/);
    assert.match(j, /Costo por <span data-unit-text>pieza<\/span><\/span> <span class="inventory-optional">\(IVA incluido\)/);
    assert.match(j, /Ya tengo existencia de este insumo/);
    assert.match(j, /rpc\('smyl_register_initial_stock',\{p_item_id:created\.id,p_location_id:loc,p_quantity:stockQty/);
    assert.match(j, /from\('smyl_inventory_reorder_levels'\)\.upsert\(/);
    assert.match(j, /reference_cost:cost,package_label:qty!=null\?label:'',package_quantity:qty,preferred_supplier_id:/);
    assert.match(j, /\.update\(Object\.assign\(\{\},payload,\{updated_at:/);
    assert.match(j, /Las salidas ya registradas conservan su costo/);
    assert.match(j, /El insumo se guardó, pero faltó un paso/);
    assert.match(j, /data-edit-item/);
    assert.match(j, /Para usar una presentación escribe su nombre/);
    // costos con respaldo, valor del inventario y compras con costo precargado
    assert.match(j, /if\(index\[item\.id\]==null&&item\.reference_cost!=null\)index\[item\.id\]=Number\(item\.reference_cost\)/);
    assert.match(j, /VALOR EN EXISTENCIA/);
    assert.match(j, /Costo unit\. \(IVA incl\.\)/);
    assert.match(j, /draft\[lineIndex\]\.unit_cost=String\(Number\(chosen\.reference_cost\)\)/);
    assert.match(j, /usualSupplier\(itemId\)\{var pref=by\(state\.items,itemId\),prefSup=pref&&pref\.preferred_supplier_id/);
    // fase 2: profesional por omisión, botón de uso y reporte
    assert.match(j, /options\(state\.professionals,'display_name',context\.professionalId\|\|myProfessionalId\(\)\)/);
    assert.match(j, /select\('id,display_name,user_id'\)/);
    assert.match(j, /id="inventory-use-material">Registrar uso de material/);
    assert.match(j, /use\.hidden=!state\.canConsume/);
    assert.match(j, /rpc\('smyl_inventory_consumption_report',\{p_from:period\.from,p_to:period\.to\}\)/);
    assert.match(j, /rpc\('smyl_inventory_consumption_totals',/);
    assert.match(j, /Quién usó qué material/);
  }
  assert.equal(read('smyl-inventory.js'), read('mobile/www/smyl-inventory.js'));
  assert.equal(read('smyl-inventory.css'), read('mobile/www/smyl-inventory.css'));
});

test('migración de inventario: costo IVA incluido opcional, respaldo de costo sin revaluar, existencia inicial y reporte con permiso', () => {
  const mig = read('supabase/migrations/20261114140000_smyl_inventory_item_costs.sql');
  assert.match(mig, /add column if not exists reference_cost numeric\(14,4\)/);
  assert.match(mig, /smyl_inventory_items_package_check/);
  assert.match(mig, /\(select i\.reference_cost from public\.smyl_inventory_items i where i\.tenant_id = p_tenant and i\.id = p_item\)/);
  assert.match(mig, /revoke all on function public\.smyl_inventory_historical_unit_cost\(uuid, uuid, uuid, timestamptz\) from public, anon, authenticated;/);
  assert.match(mig, /smyl_has_permission\(v_tenant, 'inventory\.manage'\)/);
  assert.match(mig, /Los insumos con número de serie se dan de alta con una compra/);
  assert.match(mig, /return public\.smyl_post_inventory_movement\(/);
  assert.match(mig, /smyl_has_permission\(v_tenant, 'inventory\.read'\)/);
  assert.match(mig, /not exists \(select 1 from public\.smyl_inventory_movements r where r\.tenant_id = m\.tenant_id and r\.reversal_of = m\.id\)/);
  assert.match(mig, /p_to - p_from > 400/);
  assert.doesNotMatch(mig, /update public\.smyl_inventory_movement_lines/i, 'no revalúa lo ya confirmado');
  const wf = read('.github/workflows/smyl-inventario-migracion.yml');
  assert.match(wf, /20261114140000/);
  assert.match(wf, /REPAIR_FLAG="--remote --yes"/);
  assert.match(wf, /costo_referencia_ok/);
});
