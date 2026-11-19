const test=require('node:test');const assert=require('node:assert/strict');const {model:m}=require('../smyl-inventory-procurement.js');
test('precio de caja se transforma a unidades de inventario sin multiplicar el costo dos veces',()=>{
  const l=m.payloadLine({item_id:'glove',supplier_id:'p',destination_location_id:'a',quantity:'3',unit_cost:'200',purchase_unit:'pack'},{package_quantity:100});
  assert.equal(l.quantity,300);assert.equal(l.unit_cost,2);assert.deepEqual(m.total([l]),{amount:600,missing:0});
  assert.deepEqual(m.documentLine({...l,package_quantity:100,package_label:'caja'},{unit:'pieza'}),{quantity:3,price:200,label:'caja de 100 pieza',packed:true});
});
test('precio cero es válido y un precio desconocido no se presenta como total completo',()=>{
  assert.deepEqual(m.total([{quantity:2,unit_cost:0},{quantity:3,unit_cost:null}]),{amount:0,missing:1});
  assert.equal(m.payloadLine({quantity:1,unit_cost:'',purchase_unit:'unit'},{}).unit_cost,null);
});
test('proveedores asociados y habituales no incluyen pedidos cancelados ni proveedores inactivos',()=>{
  const suppliers=[{id:'a',active:true},{id:'b',active:true},{id:'c',active:true},{id:'d',active:false}];
  assert.deepEqual(m.supplierChoices('i',[{id:'i',preferred_supplier_id:'d'}],suppliers,[{item_id:'i',supplier_id:'a'}],[{id:'o',supplier_id:'b',status:'received'},{id:'x',supplier_id:'c',status:'cancelled'}],[{item_id:'i',purchase_order_id:'o'},{item_id:'i',purchase_order_id:'x'}]).map(x=>x.id),['a','b']);
});
test('agrupación por proveedor conserva entregas independientes y plantillas no evalúan código',()=>{
  const lines=[{supplier_id:'a',location:'1'},{supplier_id:'a',location:'2'},{supplier_id:'b',location:'1'}];
  assert.equal(m.groupLines(lines,l=>l.supplier_id)[0].lines.length,2);
  assert.equal(m.template('Hola {contacto}: {insumos} {desconocido}',{contacto:'$& <script>',insumos:'2 guantes'}),'Hola $& <script>: 2 guantes {desconocido}');
});
