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
  assert.match(styles,/--color-primary:#126779/);
  assert.match(styles,/\.sidebar\{width:252px;background:#10283b/);
  assert.match(styles,/\.pro-mobile-nav\{grid-template-columns:repeat\(5/);
  assert.match(styles,/@media\(max-width:768px\)/);
  assert.match(styles,/prefers-reduced-motion/);
});

test('el expediente y los tratamientos ofrecen continuidad operativa',()=>{
  for(const action of ['Agendar cita','Tratamiento','Evolución','Cobrar','Mensaje']) assert.match(shell,new RegExp(action));
  for(const step of ['Valoración','Plan','Cotización','Aceptación','Atención','Cierre']) assert.match(shell,new RegExp(step));
  assert.match(shell,/SmylSchedule\.forPatient/);
  assert.match(shell,/SmylPatient360/);
});

test('web, móvil y PWA entregan el mismo panel profesional',()=>{
  assert.match(app,/smyl-professional-v3\.css\?v=1/);
  assert.match(app,/smyl-professional-v3\.js\?v=1/);
  assert.match(app,/smyl-navigation\.js\?v=4/);
  assert.match(worker,/smyl-v224-inbox-operations/);
  assert.equal(shell,read('../mobile/www/smyl-professional-v3.js'));
  assert.equal(styles,read('../mobile/www/smyl-professional-v3.css'));
  assert.equal(navigation,read('../mobile/www/smyl-navigation.js'));
});
