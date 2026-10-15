import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app=read('../app.html'), script=read('../smyl-task-center.js'), styles=read('../smyl-task-center.css'), nav=read('../smyl-navigation.js'), home=read('../smyl-daily-home.js'), worker=read('../sw.js');

test('Centro de alertas separa pendientes operativos de novedades',()=>{
  for(const label of ['CENTRO DE ALERTAS','Lo pendiente, sin ruido.','Pendientes','Novedades','Responsable:']) assert.match(script,new RegExp(label));
  assert.match(app,/notificaciones: cargarNotificaciones/);
  assert.doesNotMatch(app,/notificaciones: function\(\) \{ marcarTodasLeidas\(\)/);
  assert.match(script,/data-task-read-all/);
  assert.match(script,/camila_notis_leidas_/);
});

test('cada alerta conserva origen, responsable y destino',()=>{
  for(const source of ['Agenda','Mensajes','Inventario']) assert.match(script,new RegExp("source:'"+source+"'"));
  for(const owner of ['Recepción','Equipo clínico','Atención al paciente','Administración']) assert.match(script,new RegExp("owner:'"+owner+"'"));
  for(const route of ["route:'agenda'","route:'inbox'","route:'inventario'"]) assert.match(script,new RegExp(route));
  assert.doesNotMatch(script,/\.insert\(|\.update\(|\.delete\(/);
});

test('las fuentes operativas siguen protegidas por tenant y permisos existentes',()=>{
  for(const table of ['smyl_appointments','smyl_appointment_requests','smyl_appointment_reminders']) assert.match(script,new RegExp("from\\('"+table+"'\\)"));
  assert.match(script,/eq\('tenant_id',state\.tenant\)/);
  assert.match(script,/smyl_inventory_snapshot/);
  assert.match(script,/Promise\.allSettled/);
  assert.match(script,/SmylLanaAttention\.getSummary/);
});

test('Alertas es accesible sin ocupar la barra móvil principal',()=>{
  assert.match(nav,/var ALERTS = \['Alertas', 'notificaciones', 'alerts'\]/);
  assert.match(nav,/PRIMARY\.slice\(1\)\.concat\(\[ALERTS\]\)/);
  assert.match(home,/data-route="notificaciones"/);
  assert.match(styles,/pro-nav-count/);
});

test('etapa 5 se distribuye en web, PWA y fixture responsive',()=>{
  assert.match(app,/smyl-task-center\.css\?v=1/);assert.match(app,/smyl-task-center\.js\?v=3/);assert.match(app,/smyl-navigation\.js\?v=5/);assert.match(app,/smyl-daily-home\.js\?v=3/);
assert.match(worker,/smyl-v244-treatment-costs/);assert.match(worker,/smyl-task-center\.js\?v=3/);assert.match(styles,/@media\(max-width:700px\)/);
  assert.match(read('./fixtures/smyl-task-center-stage5-preview.html'),/smyl-task-center\.js/);
  assert.equal(script,read('../mobile/www/smyl-task-center.js'));assert.equal(styles,read('../mobile/www/smyl-task-center.css'));
});
