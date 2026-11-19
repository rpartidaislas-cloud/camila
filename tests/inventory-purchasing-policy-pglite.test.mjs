import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID as uuid} from 'node:crypto';
const require=createRequire(path.resolve(process.env.SMYL_PGLITE_DIR||'../.tmp/inventory-tools','loader.cjs'));
let PGlite;try{({PGlite}=require('@electric-sql/pglite'));}catch(e){if(process.env.SMYL_REQUIRE_PGLITE==='1')throw e;}
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
test('modalidad de compras, autorización y abastecimiento entre sucursales', {skip:!PGlite},async t=>{
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
  await exec(await read('supabase/migrations/20261119150000_smyl_inventory_purchasing_policy.sql'));
  await exec(await read('supabase/migrations/20261119150000_smyl_inventory_purchasing_policy.sql'));
  await t.test('el administrador habilita el modo y la sucursal no puede cambiarlo',async()=>{
    await as(A);assert.equal((await q('select smyl_inventory_purchasing_context() c')).rows[0].c.configured,false);
    await assert.rejects(save(uuid(),0,document([line()],'branch'),true),/habilitar/);
    await as(buyer);await assert.rejects(q("select smyl_save_purchasing_settings(0,'branch',null)"),{code:'42501'});
    await as(A);await q("select smyl_save_purchasing_settings(0,'branch',null)");
    await as(buyer);await save(uuid(),0,document([line()],'branch'),true);
    await assert.rejects(q("select smyl_create_purchase_order($1,$2,$3,'FUERA',null,'',$4::jsonb)",[uuid(),p1,l2,JSON.stringify([{item_id:i1,quantity:1,unit_cost:2}])]),{code:'42501'});
    await assert.rejects(save(uuid(),0,document([line()]),true),/modalidad/);
    await as(A);await q("select smyl_save_purchasing_settings(1,'centralized',$1)",[l2]);
    await as(buyer);await assert.rejects(save(uuid(),0,document([line()],'branch'),true),{code:'42501'});
    await assert.rejects(q("select smyl_create_purchase_order($1,$2,$3,'EVASION',null,'',$4::jsonb)",[uuid(),p1,l1,JSON.stringify([{item_id:i1,quantity:1,unit_cost:2}])]),{code:'42501'});
  });
  let request=uuid(),requestLine;
  const requestDoc={destination_location_id:l1,priority:'urgent',notes:'Necesidades de Centro',lines:[{item_id:i1,quantity:10}]};
  await t.test('solicitud de sucursal: permiso, revisión y aislamiento',async()=>{
    await as(buyer);await q('select smyl_save_supply_request($1,0,$2::jsonb,true)',[request,JSON.stringify(requestDoc)]);
    await q('select smyl_save_supply_request($1,0,$2::jsonb,true)',[request,JSON.stringify(requestDoc)]);
    requestLine=(await q('select * from smyl_supply_request_lines where request_id=$1',[request])).rows[0];
    assert.equal((await q('select count(*)::int n from smyl_supply_requests')).rows[0].n,1);
    await assert.rejects(q('select smyl_review_supply_request($1,1,$2::jsonb)',[request,JSON.stringify([{line_id:requestLine.id,quantity:10}])]),{code:'42501'});
    await as(B);assert.equal((await q('select count(*)::int n from smyl_supply_requests')).rows[0].n,0);
    await as(A);await q('select smyl_review_supply_request($1,1,$2::jsonb)',[request,JSON.stringify([{line_id:requestLine.id,quantity:8}])]);
    await assert.rejects(q("select smyl_save_purchasing_settings(2,'branch',null)"),/solicitudes pendientes/);
    await assert.rejects(q('update smyl_inventory_locations set active=false where id=$1',[l1]),/solicitudes|pendientes/);
  });
  let purchase=uuid();
  await t.test('el centro consolida sin duplicar ni perder las cantidades de las solicitudes',async()=>{
    await as(A);await q('select smyl_prepare_supply_purchase($1,$2::uuid[])',[purchase,[request]]);
    await q('select smyl_prepare_supply_purchase($1,$2::uuid[])',[purchase,[request]]);
    await assert.rejects(q('select smyl_prepare_supply_purchase($1,$2::uuid[])',[uuid(),[request]]),/otra compra/);
    let b=(await q('select * from smyl_purchase_batches where id=$1',[purchase])).rows[0];
    assert.equal(b.lines[0].quantity,8);assert.equal(b.lines[0].destination_location_id,l2);
    await assert.rejects(save(purchase,1,{...b,lines:[{...b.lines[0],quantity:7,supplier_id:p1}]},true),/cantidades vinculadas/);
    await save(purchase,1,{...b,lines:[{...b.lines[0],supplier_id:p1}]},true);
    assert.ok((await q('select purchase_order_line_id from smyl_supply_purchase_allocations where batch_id=$1',[purchase])).rows[0].purchase_order_line_id);
  });
  await t.test('recibir, entregar y confirmar no duplican existencias ni atribuyen compras pendientes a stock',async()=>{
    await as(A);const ol=(await q('select ol.* from smyl_purchase_order_lines ol join smyl_purchase_orders o on o.id=ol.purchase_order_id where o.batch_id=$1',[purchase])).rows[0];
    const deliver=(id,qty,rev=2)=>q('select smyl_deliver_supply_request($1,$2,$3,$4::jsonb)',[id,request,rev,JSON.stringify([{line_id:requestLine.id,quantity:qty}])]);
    await assert.rejects(deliver(uuid(),1),/compra pendiente/);
    await q('select smyl_receive_purchase_order($1,$2,$3,$4::jsonb)',[ol.purchase_order_id,uuid(),uuid(),JSON.stringify([{line_id:ol.id,quantity:8}])]);
    const delivery=uuid();await deliver(delivery,8);await deliver(delivery,8);
    assert.equal((await q('select delivered_quantity from smyl_supply_request_lines where id=$1',[requestLine.id])).rows[0].delivered_quantity,'8.000');
    assert.equal((await q('select status from smyl_supply_requests where id=$1',[request])).rows[0].status,'delivered');
    await as(buyer);await q('select smyl_confirm_supply_delivery($1)',[delivery]);await q('select smyl_confirm_supply_delivery($1)',[delivery]);
    assert.equal((await q('select status from smyl_supply_requests where id=$1',[request])).rows[0].status,'fulfilled');
    await server();assert.equal(Number((await q('select smyl_inventory_balance($1,$2,$3,null) n',[A,l1,i1])).rows[0].n),8);
    assert.equal(Number((await q('select smyl_inventory_balance($1,$2,$3,null) n',[A,l2,i1])).rows[0].n),0);
  });
  await t.test('recibir órdenes anteriores no exige comprar ni cambiar la modalidad',async()=>{
    await server();await q("delete from smyl_role_permissions where role_id=$1 and permission_key='inventory.purchase'",[roleBuyer]);
    await as(buyer);let context=(await q('select smyl_inventory_purchasing_context() c')).rows[0].c;
    assert.equal(context.can_buy,false);assert.equal(context.can_receive,true);
    const old=(await q("select ol.* from smyl_purchase_order_lines ol join smyl_purchase_orders o on o.id=ol.purchase_order_id where o.destination_location_id=$1 and o.status='ordered'",[l1])).rows[0];
    await q('select smyl_receive_purchase_order($1,$2,$3,$4::jsonb)',[old.purchase_order_id,uuid(),uuid(),JSON.stringify([{line_id:old.id,quantity:2}])]);
    await server();await q("insert into smyl_role_permissions values($1,$2,'inventory.purchase')",[A,roleBuyer]);
  });
  let r1=uuid(),r2=uuid(),rl1,rl2;
  await t.test('solicitar y confirmar se pueden delegar sin administrar ni comprar',async()=>{
    await server();await q("insert into smyl_role_permissions values($1,$2,'inventory.request'),($1,$2,'inventory.receive')",[A,roleReader]);
    await q('insert into smyl_member_branches(tenant_id,user_id,branch_id) values($1,$2,$3)',[A,reader,b1]);
    await as(reader);
    await assert.rejects(q('select smyl_save_supply_request($1,0,$2::jsonb,true)',[uuid(),JSON.stringify({...requestDoc,destination_location_id:l3})]),{code:'42501'});
    await assert.rejects(save(uuid(),0,document([line()],'branch'),true),{code:'42501'});
    for(const [id,quantity] of [[r1,5],[r2,7]])await q('select smyl_save_supply_request($1,0,$2::jsonb,true)',[id,JSON.stringify({...requestDoc,lines:[{item_id:i1,quantity}]})]);
    rl1=(await q('select id from smyl_supply_request_lines where request_id=$1',[r1])).rows[0].id;
    rl2=(await q('select id from smyl_supply_request_lines where request_id=$1',[r2])).rows[0].id;
    await assert.rejects(q('select smyl_prepare_supply_purchase($1,$2::uuid[])',[uuid(),[r1]]),{code:'42501'});
    await as(A);for(const [id,lid,qty] of [[r1,rl1,5],[r2,rl2,7]])await q('select smyl_review_supply_request($1,1,$2::jsonb)',[id,JSON.stringify([{line_id:lid,quantity:qty}])]);
  });
  await t.test('cancelar una consolidación libera la demanda y exige permiso del centro',async()=>{
    const bid=uuid();await as(A);await q('select smyl_prepare_supply_purchase($1,$2::uuid[])',[bid,[r1,r2]]);
    assert.equal((await q('select lines from smyl_purchase_batches where id=$1',[bid])).rows[0].lines[0].quantity,12);
    await server();await q("insert into smyl_role_permissions values($1,$2,'branches.all')",[A,roleBuyer]);await as(buyer);
    await assert.rejects(q('select smyl_cancel_purchase_batch($1,1)',[bid]),{code:'42501'});
    await as(A);await q('select smyl_cancel_purchase_batch($1,1)',[bid]);
    await server();await q("delete from smyl_role_permissions where role_id=$1 and permission_key='branches.all'",[roleBuyer]);
  });
  await t.test('entregas y recepciones parciales conservan el reparto de dos solicitudes del mismo insumo',async()=>{
    await as(A);await q("select smyl_post_inventory_movement($1,$2,'adjustment_in',null,$3,null,null,null,'Existencia inicial',$4::jsonb)",[uuid(),uuid(),l2,JSON.stringify([{item_id:i1,quantity:3,unit_cost:2}])]);
    const deliver=(id,req,rev,lid,qty)=>q('select smyl_deliver_supply_request($1,$2,$3,$4::jsonb)',[id,req,rev,JSON.stringify([{line_id:lid,quantity:qty}])]);
    await deliver(uuid(),r1,2,rl1,2);const bid=uuid();await q('select smyl_prepare_supply_purchase($1,$2::uuid[])',[bid,[r1,r2]]);
    let b=(await q('select * from smyl_purchase_batches where id=$1',[bid])).rows[0];assert.equal(b.lines[0].quantity,10);
    await save(bid,1,{...b,lines:[{...b.lines[0],supplier_id:p1}]},true);
    const ol=(await q('select ol.* from smyl_purchase_order_lines ol join smyl_purchase_orders o on o.id=ol.purchase_order_id where o.batch_id=$1',[bid])).rows[0];
    const receive=qty=>q('select smyl_receive_purchase_order($1,$2,$3,$4::jsonb)',[ol.purchase_order_id,uuid(),uuid(),JSON.stringify([{line_id:ol.id,quantity:qty}])]);
    await receive(4);await deliver(uuid(),r1,3,rl1,3);
    await assert.rejects(deliver(uuid(),r2,2,rl2,2),/compra pendiente/);
    assert.equal((await q('select delivered_quantity from smyl_supply_request_lines where id=$1',[rl2])).rows[0].delivered_quantity,'0.000');
    await deliver(uuid(),r2,2,rl2,1);await receive(6);await deliver(uuid(),r2,3,rl2,6);
    await server();await q("delete from smyl_role_permissions where role_id=$1 and permission_key='inventory.request'",[roleReader]);
    await as(reader);const deliveries=(await q('select id from smyl_supply_deliveries where request_id=any($1::uuid[])',[[r1,r2]])).rows;assert.equal(deliveries.length,4);
    for(const d of deliveries)await q('select smyl_confirm_supply_delivery($1)',[d.id]);
    await assert.rejects(q('select smyl_cancel_supply_request($1,1)',[r1]),{code:'42501'});
    assert.equal((await q("select count(*)::int n from smyl_supply_requests where id=any($1::uuid[]) and status='fulfilled'",[[r1,r2]])).rows[0].n,2);
    await server();assert.equal(Number((await q('select smyl_inventory_balance($1,$2,$3,null) n',[A,l2,i1])).rows[0].n),1);
  });
  await t.test('la configuración usa revisión, conserva órdenes históricas y no restaura permisos retirados',async()=>{
    await as(A);await assert.rejects(q("select smyl_save_purchasing_settings(0,'branch',null)"),{code:'40001'});await q("select smyl_save_purchasing_settings(2,'branch',null)");
    await as(reader);await assert.rejects(q('select smyl_save_supply_request($1,0,$2::jsonb,true)',[uuid(),JSON.stringify(requestDoc)]),/no están habilitadas/);
    await server();await q("delete from smyl_role_permissions where role_id=$1 and permission_key='inventory.receive'",[roleBuyer]);
    await exec(await read('supabase/migrations/20261119150000_smyl_inventory_purchasing_policy.sql'));
    assert.equal((await q("select count(*)::int n from smyl_role_permissions where role_id=$1 and permission_key='inventory.receive'",[roleBuyer])).rows[0].n,0);
    const newRole=uuid();await q("insert into smyl_roles(id,tenant_id,code,name,system_role) values($1,$2,'inventario','Inventario nuevo',true)",[newRole,A]);
    assert.equal((await q("select count(*)::int n from smyl_role_permissions where role_id=$1 and permission_key in ('inventory.request','inventory.receive')",[newRole])).rows[0].n,2);
    await as(buyer);const old=(await q("select ol.* from smyl_purchase_order_lines ol join smyl_purchase_orders o on o.id=ol.purchase_order_id where o.destination_location_id=$1 and o.status='partially_received'",[l1])).rows[0];
    await assert.rejects(q('select smyl_receive_purchase_order($1,$2,$3,$4::jsonb)',[old.purchase_order_id,uuid(),uuid(),JSON.stringify([{line_id:old.id,quantity:1}])]),{code:'42501'});
    await assert.rejects(q('select smyl_save_purchase_batch_v1($1,0,$2::jsonb,false)',[uuid(),JSON.stringify(document([line()],'branch'))]),{code:'42501'});
  });

});
