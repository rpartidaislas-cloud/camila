import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const navigation=read('../smyl-navigation.js');
const shell=read('../smyl-professional-v3.js');
const styles=read('../smyl-professional-v3.css');
const app=read('../app.html');
const worker=read('../sw.js');

test('la navegación principal refleja el trabajo completo de una clínica dental',()=>{
  for(const area of ['Inicio','Agenda','Pacientes','Tratamientos','Finanzas','Mensajes']) assert.match(navigation,new RegExp("\\['"+area+"'"));
  assert.match(navigation,/Servicios y tarifas/);
  assert.match(navigation,/Inventario/);
  assert.match(navigation,/Reportes/);
  assert.match(navigation,/openPanelAdmin/);
});

test('el sistema visual reduce ruido y conserva jerarquía responsive',()=>{
  assert.match(styles,/--color-primary:#194391/);
  assert.match(styles,/\.sidebar\{width:248px;background:#102239/);
  assert.match(styles,/\.pro-mobile-nav\{grid-template-columns:repeat\(5/);
  assert.match(styles,/position:fixed;z-index:850/);
  assert.match(styles,/backdrop-filter:none/);
  assert.match(styles,/@media\(max-width:768px\)/);
  assert.match(styles,/prefers-reduced-motion/);
});

test('el expediente y los tratamientos ofrecen continuidad operativa',()=>{
  for(const action of ['Agendar','Cotizar','Cobrar','Evolución','Mensaje']) assert.match(shell,new RegExp(action));
  for(const step of ['Valoración','Plan','Cotización','Aceptación','Atención','Cierre']) assert.match(shell,new RegExp(step));
  assert.match(shell,/SmylSchedule\.forPatient/);
  assert.match(shell,/SmylProposals\.forPatient/);
  assert.match(shell,/SmylFinance\.forPatient/);
  assert.match(shell,/SmylPatient360/);
});

test('las tareas frecuentes se resuelven por proceso y paciente',()=>{
  for(const label of ['¿Qué necesitas hacer?','Agendar cita','Preparar cotización','Registrar cobro','Selecciona al paciente','Registrar paciente nuevo']) assert.match(shell,new RegExp(label));
  assert.match(shell,/from\('camila_pacientes'\)/);
  assert.match(shell,/eq\('tenant_id',window\.tenantId\)/);
  assert.match(shell,/Ninguna acción se confirma automáticamente/);
  assert.match(styles,/\.pro-task-dialog/);
  assert.match(styles,/\.pro-task-options/);
  assert.match(read('./fixtures/smyl-doctor-tasks-preview.html'),/SmylCareTasks|smyl-professional-v3\.js/);
});

test('web, móvil y PWA entregan el mismo panel profesional',()=>{
  assert.match(app,/smyl-professional-v3\.css\?v=6/);
  assert.match(app,/smyl-professional-v3\.js\?v=3/);
  assert.match(app,/smyl-navigation\.js\?v=9/);
  assert.match(worker,/smyl-v254-visible-shell-v4/);
  assert.equal(shell,read('../mobile/www/smyl-professional-v3.js'));
  assert.equal(styles,read('../mobile/www/smyl-professional-v3.css'));
  assert.equal(navigation,read('../mobile/www/smyl-navigation.js'));
});
