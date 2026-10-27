import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const patient=read('smyl-patient-360.js');
const css=read('smyl-patient-360.css');
const schedule=read('smyl-schedule.js');
const actions=read('supabase/migrations/20261012280000_smyl_patient_360_actions.sql');
const app=read('app.html');
const sw=read('sw.js');

test('la agenda abre una evolución sólo durante o después de la atención',()=>{
  assert.match(schedule,/\['arrived','in_progress','completed'\]\.includes\(a\.status\)/);
  assert.match(schedule,/Registrar la consulta/);
  assert.match(schedule,/SmylPatient360\.forAppointment\(a\)/);
  assert.match(schedule,/Ficha del paciente/);
});

test('la evolución queda vinculada a paciente, cita y profesional',()=>{
  assert.match(patient,/forAppointment:function\(appointment\)/);
  assert.match(patient,/p_appointment_id:appointment\?appointment\.id:null/);
  assert.match(patient,/appointment&&appointment\.professional_id/);
  assert.match(patient,/Evolución vinculada a la cita y guardada como borrador/);
  assert.match(actions,/La cita no pertenece a este paciente/);
});

test('no duplica la evolución y conserva firma y adenda como controles clínicos',()=>{
  assert.match(patient,/note\.appointment_id===appointment\.id/);
  assert.match(patient,/existing\.status==='draft'&&s\.canWrite/);
  assert.match(patient,/ya tiene una evolución firmada/);
  assert.match(patient,/Tu rol puede consultar la atención, pero no crear una evolución clínica/);
  assert.match(actions,/Una nota firmada no puede modificarse; agrega una adenda/);
});

test('web, móvil y PWA distribuyen el seguimiento clínico',()=>{
  assert.match(app,/smyl-patient-360\.js\?v=9/);
  assert.match(app,/smyl-patient-360\.css\?v=7/);
  assert.match(app,/smyl-schedule\.js\?v=(?:1[1-9]|[2-9][0-9])/);
  assert.match(sw,/smyl-v263-lana-connection-recovery/);
  assert.match(css,/\.p360-dialog\{overflow:auto;overscroll-behavior:contain\}/);
  for(const file of ['app.html','sw.js','smyl-patient-360.js','smyl-patient-360.css','smyl-schedule.js'])assert.equal(read(file),read('mobile/www/'+file));
});
