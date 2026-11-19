/* Sólo la vista de prueba. No se carga desde app.html. Datos ficticios, sin red. */
(function(){
  const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),T=id(1),B=id(2),B2=id(3),L=id(4),L2=id(5),P=id(6),P2=id(7),I=id(8),I2=id(9),I3=id(10),S=id(11);
  const now=new Date().toISOString(),stamp=x=>Object.assign({tenant_id:T,active:true,created_at:now,updated_at:now},x);
  const db={
    smyl_branches:[stamp({id:B,name:'Clínica Centro'}),stamp({id:B2,name:'Clínica Lomas'})],
    smyl_rooms:[stamp({id:id(12),branch_id:B,name:'Gabinete 1'}),stamp({id:id(13),branch_id:B2,name:'Gabinete Lomas'})],
    smyl_inventory_locations:[stamp({id:L,branch_id:B,name:'Almacén principal',location_type:'central',room_id:null}),stamp({id:L2,branch_id:B2,name:'Almacén principal',location_type:'central',room_id:null})],
    smyl_inventory_suppliers:[stamp({id:P,name:'Dental del Centro',contact_name:'Equipo de ventas',email:'pedidos@example.test',phone:'+52 33 0000 0000',notes:'Entrega de lunes a viernes.'}),stamp({id:P2,name:'Distribuidora Clínica',contact_name:'Compras',email:'ventas@example.test',phone:'+52 55 0000 0000',notes:''})],
    smyl_inventory_items:[stamp({id:I,sku:'GUA-M',name:'Guantes de nitrilo medianos',category:'material',unit:'pieza',reference_cost:2,package_label:'caja',package_quantity:100,preferred_supplier_id:P,track_lot:false}),stamp({id:I2,sku:'RES-A2',name:'Resina compuesta A2',category:'material',unit:'jeringa',reference_cost:420,package_label:'',package_quantity:null,preferred_supplier_id:P2,track_lot:true,track_expiry:true}),stamp({id:I3,sku:'GAS-5',name:'Gasas estériles 5 × 5 cm',category:'material',unit:'pieza',reference_cost:1.5,package_label:'paquete',package_quantity:50,preferred_supplier_id:P,track_lot:true})],
    smyl_supplier_items:[{tenant_id:T,supplier_id:P,item_id:I,supplier_sku:'GN-M-100',unit_cost:2,lead_days:2},{tenant_id:T,supplier_id:P,item_id:I3,supplier_sku:'GS-50',unit_cost:1.5,lead_days:2},{tenant_id:T,supplier_id:P2,item_id:I2,supplier_sku:'RA2',unit_cost:420,lead_days:3}],
    smyl_services:[stamp({id:S,name:'Restauración con resina',reference_price:1200})],
    smyl_service_materials:[{tenant_id:T,service_id:S,item_id:I,expected_quantity:2},{tenant_id:T,service_id:S,item_id:I2,expected_quantity:0.25}],
    smyl_inventory_reorder_levels:[{tenant_id:T,location_id:L,item_id:I,minimum_quantity:100,target_quantity:300},{tenant_id:T,location_id:L2,item_id:I,minimum_quantity:100,target_quantity:200}],
    smyl_purchase_batches:[],smyl_purchase_orders:[],smyl_purchase_order_lines:[],smyl_inventory_movements:[],smyl_inventory_movement_lines:[],smyl_role_permissions:[],smyl_member_roles:[],smyl_appointments:[],smyl_professionals:[],camila_pacientes:[]
  };
  window.__inventoryDB=db;window.__inventoryCalls=[];window.__inventoryIDs={T,B,B2,L,L2,P,P2,I,I2,I3,S};
  function builder(table){let filters=[],single=false,verb='select',data,range=null,sort=[];let api={
    select(){return api;},eq(k,v){filters.push(r=>r[k]===v);return api;},in(k,v){filters.push(r=>v.includes(r[k]));return api;},order(k,opts={}){sort.push([k,opts.ascending!==false]);return api;},limit(n){range=[0,n-1];return api;},range(a,b){range=[a,b];return api;},single(){single=true;return api;},maybeSingle(){single=true;return api;},insert(x){verb='insert';data=x;return api;},update(x){verb='update';data=x;return api;},upsert(x){verb='upsert';data=x;return api;},
    then(resolve,reject){return Promise.resolve().then(()=>{let rows=(db[table]||[]).filter(r=>filters.every(f=>f(r)));
      if(verb==='insert'){let inserted=(Array.isArray(data)?data:[data]).map(r=>stamp({id:crypto.randomUUID(),...r}));db[table]??=[];db[table].push(...inserted);rows=inserted;}
      if(verb==='update')rows.forEach(r=>Object.assign(r,data));
      if(verb==='upsert'){db[table]??=[];let row=db[table].find(r=>r.id&&r.id===data.id);if(row)Object.assign(row,data);else db[table].push(stamp(data));rows=[row||data];}
      if(verb==='select'){rows=[...rows];sort.reverse().forEach(([k,asc])=>rows.sort((a,b)=>String(a[k]).localeCompare(String(b[k]))*(asc?1:-1)));if(range)rows=rows.slice(range[0],range[1]+1);}
      window.__inventoryCalls.push({table,verb,data:structuredClone(data)});return {data:structuredClone(single?rows[0]||null:rows),error:null};}).then(resolve,reject);}
  };return api;}
  function snapshot(){return [{item_id:I,location_id:L,item_name:'Guantes de nitrilo medianos',sku:'GUA-M',category:'material',unit:'pieza',location_name:'Clínica Centro · Almacén principal',on_hand:80,minimum_quantity:100,below_minimum:true},{item_id:I,location_id:L2,item_name:'Guantes de nitrilo medianos',sku:'GUA-M',category:'material',unit:'pieza',location_name:'Clínica Lomas · Almacén principal',on_hand:30,minimum_quantity:100,below_minimum:true}];}
  async function rpc(name,p){window.__inventoryCalls.push({rpc:name,args:structuredClone(p)});if(window.__inventoryFail===name)return {error:{message:'Error de prueba: no se guardaron cambios.'},data:null};let data=[];
    if(name==='smyl_my_branches')data=db.smyl_branches.map(b=>({branch_id:b.id,name:b.name,can_all:true}));
    if(name==='smyl_inventory_snapshot')data=snapshot();
    if(name==='smyl_save_supplier_catalog'){db.smyl_supplier_items=db.smyl_supplier_items.filter(x=>x.supplier_id!==p.p_supplier_id).concat(p.p_items.map(x=>({...x,supplier_id:p.p_supplier_id,tenant_id:T})));}
    if(name==='smyl_save_treatment_kit'){db.smyl_service_materials=db.smyl_service_materials.filter(x=>x.service_id!==p.p_service_id).concat(p.p_lines.map(x=>({...x,service_id:p.p_service_id,tenant_id:T})));}
    if(name==='smyl_create_inventory_item'){db.smyl_inventory_items.push(stamp({id:p.p_id,...p.p_item}));data=p.p_id;}
    if(name==='smyl_save_purchase_batch'){
      let existing=db.smyl_purchase_batches.find(x=>x.id===p.p_id),batch=stamp({id:p.p_id,...p.p_document,revision:existing?existing.revision+1:1,status:p.p_issue?'ordered':'draft'});batch.lines=batch.lines.map(l=>{const item=db.smyl_inventory_items.find(i=>i.id===l.item_id);return {...l,package_label:l.purchase_unit==='pack'?item.package_label:'',package_quantity:l.purchase_unit==='pack'?item.package_quantity:null};});db.smyl_purchase_batches=db.smyl_purchase_batches.filter(x=>x.id!==p.p_id).concat(batch);
      if(p.p_issue){let groups=new Map();batch.lines.forEach(l=>{let key=l.supplier_id+'|'+l.destination_location_id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(l);});let n=0;for(let lines of groups.values()){let order=stamp({id:crypto.randomUUID(),batch_id:batch.id,reference:batch.reference+'-'+(++n),supplier_id:lines[0].supplier_id,destination_location_id:lines[0].destination_location_id,status:'ordered',revision:1,ordered_at:now,notes:batch.notes,expected_on:batch.expected_on});db.smyl_purchase_orders.push(order);lines.forEach(l=>db.smyl_purchase_order_lines.push(stamp({id:crypto.randomUUID(),purchase_order_id:order.id,item_id:l.item_id,ordered_quantity:l.quantity,received_quantity:0,unit_cost:l.unit_cost})));}}
      data=p.p_id;
    }
    if(name==='smyl_cancel_purchase_batch'){db.smyl_purchase_batches.find(x=>x.id===p.p_id).status='cancelled';db.smyl_purchase_orders.filter(o=>o.batch_id===p.p_id).forEach(o=>o.status='cancelled');}
    if(name==='smyl_receive_purchase_order'){p.p_receipt_lines.forEach(x=>{db.smyl_purchase_order_lines.find(l=>l.id===x.line_id).received_quantity+=x.quantity;});let order=db.smyl_purchase_orders.find(o=>o.id===p.p_order_id);order.status=db.smyl_purchase_order_lines.filter(l=>l.purchase_order_id===order.id).every(l=>l.received_quantity===l.ordered_quantity)?'received':'partially_received';}
    return {data:structuredClone(data),error:null};
  }
  window.tenantId=T;window.miRolEquipo='dueño';window.TITULOS={};window.sbTimeout=p=>p;window.sb={auth:{getUser:async()=>({data:{user:{id:T}}})},from:builder,rpc};
  window.ir=route=>{document.querySelectorAll('.pantalla').forEach(p=>p.classList.toggle('activa',p.id==='p-'+route));};
})();
