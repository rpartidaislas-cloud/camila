import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID as uuid} from 'node:crypto';
const require=createRequire(path.resolve(process.env.SMYL_PGLITE_DIR||'../.tmp/inventory-tools','loader.cjs'));
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch(e){if(process.env.SMYL_REQUIRE_PGLITE==='1')throw e;}
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
test('catálogo y compras: transacciones, sucursales, costos y aislamiento', {skip:!PGlite},async t=>{
  const db=new PGlite();t.after(()=>db.close());
  const q=(sql,args=[])=>db.query(sql,args),exec=sql=>db.exec(sql);
  await exec(await read('tests/fixtures/radiograph-contracts/pglite-base.sql'));
  await exec(`
    alter table smyl_branches add column active boolean default true, add column created_by uuid,
      add column created_at timestamptz default now(),add column is_default boolean default false;
    alter table smyl_roles add column system_role boolean default false;
    alter table smyl_appointments add constraint app_tenant_id unique(tenant_id,id),add column service_id uuid;
    create table smyl_rooms(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,name text,active boolean default true,unique(tenant_id,id));
    create table smyl_services(id uuid primary key default gen_random_uuid(),tenant_id uuid,name text,active boolean default true,reference_price numeric,unique(tenant_id,id));
    create function smyl_touch_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end$$;
  `);
  const migrations=['20261012300000_smyl_dental_inventory.sql','20261012310000_smyl_dental_inventory_actions.sql','20261012320000_smyl_dental_inventory_hardening.sql','20261015010000_smyl_inventory_costing_v1.sql','20261114120000_smyl_inventory_role_permissions.sql','20261114140000_smyl_inventory_item_costs.sql','20261118140000_smyl_branch_scope.sql','20261119100000_smyl_inventory_procurement.sql'];
  for(const m of migrations){try{await exec(await read('supabase/migrations/'+m));}catch(e){throw new Error(m+': '+e.message,{cause:e});}}
  await exec(await read('supabase/migrations/20261119100000_smyl_inventory_procurement.sql'));
  const A=uuid(),B=uuid(),reader=uuid(),buyer=uuid(),roleReader=uuid(),roleBuyer=uuid(),b1=uuid(),b2=uuid(),b3=uuid(),p1=uuid(),p2=uuid(),p3=uuid(),i1=uuid(),i2=uuid(),i3=uuid(),service=uuid();
  await q('insert into auth.users(id) values($1),($2),($3),($4)',[A,B,reader,buyer]);
  await q("insert into camila_tenants(id,nombre) values($1,'Clínica A'),($2,'Clínica B')",[A,B]);
  await q("insert into camila_usuarios(id,tenant_id) values($1,$3),($2,$3)",[reader,buyer,A]);
  await q("insert into smyl_roles(id,tenant_id,code,name) values($1,$3,'reader','Lector'),($2,$3,'buyer','Comprador')",[roleReader,roleBuyer,A]);
  await q('insert into smyl_member_roles(tenant_id,user_id,role_id) values($1,$2,$3),($1,$4,$5)',[A,reader,roleReader,buyer,roleBuyer]);
  await q("insert into smyl_role_permissions(tenant_id,role_id,permission_key) values($1,$2,'inventory.read'),($1,$3,'inventory.read'),($1,$3,'inventory.manage'),($1,$3,'inventory.purchase')",[A,roleReader,roleBuyer]);
  await q("insert into smyl_branches(id,tenant_id,name) values($1,$4,'Centro'),($2,$4,'Norte'),($3,$5,'Otra clínica')",[b1,b2,b3,A,B]);
  await q('insert into smyl_member_branches(tenant_id,user_id,branch_id) values($1,$2,$3)',[A,buyer,b1]);
  const locs=(await q('select id,branch_id from smyl_inventory_locations')).rows;
  const l1=locs.find(x=>x.branch_id===b1).id,l2=locs.find(x=>x.branch_id===b2).id,l3=locs.find(x=>x.branch_id===b3).id;
  await q("insert into smyl_inventory_suppliers(id,tenant_id,name) values($1,$4,'Dental Uno'),($2,$4,'Dental Dos'),($3,$5,'Dental Ajeno')",[p1,p2,p3,A,B]);
  await q("insert into smyl_inventory_items(id,tenant_id,sku,name,unit,track_lot,reference_cost) values($1,$4,'G','Guantes','pieza',false,2),($2,$4,'R','Resina','jeringa',false,150),($3,$5,'G','Ajeno','pieza',false,3)",[i1,i2,i3,A,B]);
  await q("insert into smyl_services(id,tenant_id,name) values($1,$2,'Restauración')",[service,A]);
  const as=async user=>{await exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);await exec('set role authenticated');};
  const server=async()=>{await exec('reset role');await q("select set_config('request.jwt.claim.sub','',false)");};
  const save=(id,revision,doc,issue=false)=>q('select smyl_save_purchase_batch($1,$2,$3::jsonb,$4) id',[id,revision,JSON.stringify(doc),issue]);
  const line=(item=i1,supplier=p1,dest=l1,quantity=10,price=2)=>({item_id:item,supplier_id:supplier,destination_location_id:dest,quantity,unit_cost:price});
  const document=(lines,mode='consolidated')=>({reference:'OC-'+uuid().slice(0,8),mode,branch_id:mode==='branch'?b1:null,lines,notes:'Prueba',expected_on:'2026-12-01'});
  let batch=uuid(),doc=document([line(),line(i1,p1,l2,20),line(i2,p2,l1,2,150)]);
  await t.test('catálogo admite varios proveedores y rechaza cambios concurrentes o de otra clínica',async()=>{
    await as(A);const entries=[{item_id:i1,supplier_sku:'GU-100',unit_cost:2,lead_days:3}];
    await q('select smyl_save_supplier_catalog($1,$2::jsonb,$3::jsonb)',[p1,JSON.stringify(entries),'[]']);
    await assert.rejects(q('select smyl_save_supplier_catalog($1,$2::jsonb,$3::jsonb)',[p1,'[]','[]']),{code:'40001'});
    await assert.rejects(q('select smyl_save_supplier_catalog($1,$2::jsonb,$3::jsonb)',[p2,JSON.stringify([{...entries[0],item_id:i3}]),'[]']),/insumo.*activo/);
    await as(reader);assert.equal((await q('select * from smyl_supplier_items')).rows.length,0);
    await assert.rejects(q('select smyl_save_supplier_catalog($1,$2::jsonb,$3::jsonb)',[p1,'[]','[]']),{code:'42501'});
  });
  await t.test('kit completo se guarda atómicamente y permite retirar materiales',async()=>{
    await as(A);const lines=[{item_id:i1,expected_quantity:2},{item_id:i2,expected_quantity:0.5}].sort((a,b)=>a.item_id.localeCompare(b.item_id));
    await q('select smyl_save_treatment_kit($1,$2::jsonb,$3::jsonb)',[service,JSON.stringify(lines),'[]']);
    await assert.rejects(q('select smyl_save_treatment_kit($1,$2::jsonb,$3::jsonb)',[service,JSON.stringify([{item_id:i1,expected_quantity:-1}]),JSON.stringify(lines)]),/cantidades/);
    assert.equal((await q('select * from smyl_service_materials')).rows.length,2);
    await q('select smyl_save_treatment_kit($1,$2::jsonb,$3::jsonb)',[service,JSON.stringify(lines.slice(0,1)),JSON.stringify(lines)]);
    assert.equal((await q('select * from smyl_service_materials')).rows.length,1);
    await assert.rejects(q('select smyl_save_treatment_kit($1,$2::jsonb,$3::jsonb)',[service,'[]',JSON.stringify(lines)]),{code:'40001'});
  });
  await t.test('borradores aceptan precios pendientes; emitir requiere todos y no duplica tras reintento',async()=>{
    await as(A);const draft={...doc,lines:doc.lines.map((l,i)=>({...l,unit_cost:i?l.unit_cost:null}))};
    await save(batch,0,draft);
    await assert.rejects(save(batch,1,draft,true),/proveedor y precio/);
    assert.equal((await q('select * from smyl_purchase_orders')).rows.length,0);
    await save(batch,1,doc,true);await save(batch,1,doc,true);
    assert.equal((await q('select * from smyl_purchase_orders where batch_id=$1',[batch])).rows.length,3);
    await assert.rejects(save(batch,2,doc),{code:'40001'});
    await server();assert.equal((await q('select count(*)::int n from smyl_inventory_movements')).rows[0].n,0);
  });
  await t.test('una compra por clínica no acepta destinos externos; comprador limitado no consolida otra sede',async()=>{
    await as(A);await assert.rejects(save(uuid(),0,document([line(i1,p1,l2)],'branch'),true),/clínica elegida/);
    await assert.rejects(save(uuid(),0,document([line(i1,p1,l3)]),true),{code:'42501'});
    await assert.rejects(save(uuid(),0,document([line(i1,p3,l1)]),true),/proveedores/);
    await assert.rejects(save(uuid(),0,document([line(i3,p1,l1)]),true),/insumo/);
    await as(buyer);await assert.rejects(save(uuid(),0,document([line(),line(i1,p1,l2)]),true),{code:'42501'});
    assert.equal((await q('select * from smyl_purchase_batches where id=$1',[batch])).rows.length,0);
    await save(uuid(),0,document([line()],'branch'));
  });
  await t.test('recepción parcial y completa afecta sólo su almacén y congela el costo',async()=>{
    await as(A);const o=(await q('select * from smyl_purchase_orders where batch_id=$1 and destination_location_id=$2 and supplier_id=$3',[batch,l2,p1])).rows[0];
    const l=(await q('select * from smyl_purchase_order_lines where purchase_order_id=$1',[o.id])).rows[0];
    const receive=(qty,key=uuid())=>q('select smyl_receive_purchase_order($1,$2,$3,$4::jsonb)',[o.id,uuid(),key,JSON.stringify([{line_id:l.id,quantity:qty,lot_code:'',serial_number:''}])]);
    await as(buyer);await assert.rejects(receive(1),{code:'42501'});await as(A);
    const key=uuid();await receive(7,key);await receive(7,key);
    assert.equal((await q('select received_quantity from smyl_purchase_order_lines where id=$1',[l.id])).rows[0].received_quantity,'7.000');
    await assert.rejects(receive(14),/supera/);await receive(13);
    assert.equal((await q('select status from smyl_purchase_orders where id=$1',[o.id])).rows[0].status,'received');
    const movementLines=(await q('select l.unit_cost,l.quantity,m.destination_location_id from smyl_inventory_movement_lines l join smyl_inventory_movements m on m.id=l.movement_id')).rows;
    assert.equal(movementLines.reduce((sum,x)=>sum+Number(x.quantity),0),20);assert.ok(movementLines.every(x=>x.destination_location_id===l2&&Number(x.unit_cost)===2));
    await assert.rejects(q('select smyl_cancel_purchase_batch($1,$2)',[batch,2]),/material recibido/);
    assert.equal((await q("select count(*)::int n from smyl_purchase_orders where batch_id=$1 and status='cancelled'",[batch])).rows[0].n,0);
  });
  await t.test('almacenes editables: archivar con saldo o pedidos se rechaza y los vacíos se reactivan',async()=>{
    await as(A);await q("update smyl_inventory_locations set name='Bodega Norte' where id=$1",[l2]);
    await assert.rejects(q('update smyl_inventory_locations set active=false where id=$1',[l2]),/existencias/);
    await assert.rejects(q('update smyl_inventory_locations set active=false where id=$1',[l1]),/compras pendientes/);
    const empty=uuid();await q("insert into smyl_inventory_locations(id,tenant_id,branch_id,name) values($1,$2,$3,'Almacén temporal')",[empty,A,b1]);
    await q('update smyl_inventory_locations set active=false where id=$1',[empty]);await q('update smyl_inventory_locations set active=true where id=$1',[empty]);
    await assert.rejects(q('update smyl_inventory_locations set branch_id=$2 where id=$1',[l2,b1]),/existencias/);
  });
  await t.test('cancelación total conserva historial y no genera movimientos',async()=>{
    await as(A);const id=uuid();await save(id,0,document([line(),line(i2,p2,l2,1,150)]),true);
    await q('select smyl_cancel_purchase_batch($1,$2)',[id,1]);
    assert.ok((await q('select status from smyl_purchase_orders where batch_id=$1',[id])).rows.every(x=>x.status==='cancelled'));
    await as(B);assert.equal((await q('select * from smyl_purchase_batches')).rows.length,0);await assert.rejects(save(batch,2,doc),{code:'40001'});
    await as(reader);await assert.rejects(save(uuid(),0,doc),{code:'42501'});
  });
  await t.test('alta de insumo, proveedor, existencia y mínimos se confirma completa o se revierte',async()=>{
    const create=(id,item,setup)=>q('select smyl_create_inventory_item($1,$2::jsonb,$3::jsonb)',[id,JSON.stringify(item),JSON.stringify(setup)]);
    const item={sku:'VASOS',name:'Vasos',category:'material',unit:'pieza',reference_cost:2,package_label:'bolsa',package_quantity:50,preferred_supplier_id:p1,track_lot:false};
    await as(A);const id=uuid(),setup={location_id:l1,quantity:100,minimum:20,target:150};
    await create(id,item,setup);await create(id,item,setup);
    assert.equal((await q('select count(*)::int n from smyl_inventory_items where id=$1',[id])).rows[0].n,1);
    assert.equal((await q('select count(*)::int n from smyl_inventory_movements where idempotency_key=$1',[id])).rows[0].n,1);
    assert.equal((await q('select unit_cost from smyl_supplier_items where item_id=$1',[id])).rows[0].unit_cost,'2.0000');
    assert.equal((await q('select target_quantity from smyl_inventory_reorder_levels where item_id=$1',[id])).rows[0].target_quantity,'150.000');
    await q('update smyl_inventory_items set preferred_supplier_id=$2 where id=$1',[id,p2]);
    assert.equal((await q('select count(*)::int n from smyl_supplier_items where item_id=$1',[id])).rows[0].n,2);
    const bad=uuid();await assert.rejects(create(bad,{...item,sku:'CAD',track_lot:true,track_expiry:true},setup),/caducidad/);
    await assert.rejects(create(uuid(),{...item,sku:'INVALIDO',reference_cost:'NaN'},{}),/precio/);
    assert.equal((await q('select count(*)::int n from smyl_inventory_items where id=$1',[bad])).rows[0].n,0);
    assert.equal((await q('select count(*)::int n from smyl_supplier_items where item_id=$1',[bad])).rows[0].n,0);
    await as(buyer);const denied=uuid();await assert.rejects(create(denied,{...item,sku:'SIN-AJUSTE'},setup),{code:'42501'});
    assert.equal((await q('select count(*)::int n from smyl_inventory_items where id=$1',[denied])).rows[0].n,0);
  });
  await t.test('precios y presentaciones quedan fijos en el pedido, sin permitir renglones duplicados',async()=>{
    await as(A);await q("update smyl_inventory_items set package_label='caja',package_quantity=100 where id=$1",[i1]);
    const id=uuid(),pack={...line(i1,p1,l1,300,2),purchase_unit:'pack',package_quantity:999};
    await save(id,0,document([pack]),true);await q("update smyl_inventory_items set package_quantity=50 where id=$1",[i1]);
    const saved=(await q('select lines from smyl_purchase_batches where id=$1',[id])).rows[0].lines[0];
    assert.equal(saved.package_quantity,100);assert.equal(saved.purchase_unit,'pack');assert.equal(saved.quantity,300);assert.equal(saved.unit_cost,2);
    await assert.rejects(save(uuid(),0,document([line(),line()]),true),/repetidos/);
    await assert.rejects(save(uuid(),0,document([line(i1,p1,l1,10,-1)]),true),/precios/);
    await assert.rejects(save(uuid(),0,document([{...line(i2,p2,l1),purchase_unit:'pack'}]),true),/presentación/);
    await assert.rejects(q("insert into smyl_purchase_batches(id,tenant_id,reference,mode,branch_id,created_by) values($1,$2,'DIRECTA','branch',$3,$2)",[uuid(),A,b1]),{code:'42501'});
    await assert.rejects(q('update smyl_supplier_items set unit_cost=0'),{code:'42501'});
  });
});
