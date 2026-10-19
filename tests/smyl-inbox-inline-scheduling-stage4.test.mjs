import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const inbox = read('../smyl-inbox.js');
const mobileInbox = read('../mobile/www/smyl-inbox.js');
const app = read('../app.html');
const worker = read('../sw.js');
const styles = read('../smyl-inbox.css');

test('todos los accesos para agendar permanecen dentro del chat', () => {
  assert.match(inbox, /'Agendar cita'\); agenda\.type = 'button'; agenda\.onclick = openAvailabilityDialog/);
  assert.match(inbox, /'Agendar cita'\);\s*appointment\.type = 'button'; appointment\.onclick = openAvailabilityDialog/);
  const flow = inbox.slice(inbox.indexOf('async function openAvailabilityDialog'), inbox.indexOf('async function searchAvailability'));
  assert.doesNotMatch(flow, /window\.ir\('agenda'\)/);
});

test('la ventana aparece antes de consultar la agenda y conserva al paciente', () => {
  const start = inbox.indexOf('async function openAvailabilityDialog');
  const end = inbox.indexOf('async function searchAvailability', start);
  const flow = inbox.slice(start, end);
  assert.ok(flow.indexOf('dialog.showModal()') < flow.indexOf("request('GET', { action: 'availability_catalog'"));
  assert.doesNotMatch(flow, /conversation\.contact_name/);
  assert.match(flow, /refreshAvailabilityPatientIdentity\(\)/);
  assert.match(inbox, /clinical\.patient\.name/);
  assert.match(flow, /control\.disabled = true/);
  assert.match(flow, /control\.disabled = false/);
  assert.match(flow, /await searchAvailability/);
});

test('el espacio central muestra una agenda visual por día, profesional y especialidad', () => {
  assert.match(inbox, /Disponibilidad del equipo/);
  assert.match(inbox, /Disponibilidad por profesional y especialidad/);
  assert.match(inbox, /smyl-inbox-availability-day/);
  assert.match(inbox, /slot\.professional_name/);
  assert.match(inbox, /slot\.specialty \|\| 'Profesional dental'/);
  assert.match(styles, /availability-board>\[data-availability-results\]\{display:grid/);
  assert.match(styles, /smyl-inbox-availability-board/);
  assert.match(styles, /position:fixed;inset:0;margin:auto/);
  assert.match(inbox, /availabilityClinicName/);
  assert.match(inbox, /todas las sucursales/);
  assert.match(inbox, /Ver siguientes 7 días/);
  assert.match(inbox, /Fechas personalizadas/);
  assert.match(inbox, /data-availability-patient-alert/);
  assert.match(inbox, /Vincular paciente/);
  assert.match(inbox, /availabilityEmptyReason = 'no_slots'/);
  assert.match(inbox, /Este servicio no tiene profesionales asignados/);
  assert.match(styles, /smyl-inbox-availability-dialog\.is-empty/);
  assert.match(styles, /availability-offer\[hidden\]/);
});

test('la agenda embebida mantiene paridad móvil y una versión pública nueva', () => {
  assert.equal(mobileInbox, inbox);
  assert.match(app, /smyl-design-system-v2\.css\?v=1/);
  assert.match(app, /smyl-inbox\.js\?v=26/);
  assert.match(app, /smyl-inbox\.css\?v=23/);
  assert.match(worker, /smyl-design-system-v2\.css\?v=1/);
  assert.match(worker, /smyl-inbox\.js\?v=26/);
  assert.match(worker, /smyl-inbox\.css\?v=23/);
});
