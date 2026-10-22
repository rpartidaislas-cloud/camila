import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Nueva cita: el paciente se busca en una caja (nombre, teléfono o correo) y puede
// registrarse ahí mismo; los errores aparecen dentro del diálogo y el control de
// reserva avisa cuando faltan horarios semanales.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const schedule = read('smyl-schedule.js');

test('la cita nueva usa una caja de búsqueda accesible en lugar de un desplegable', () => {
  assert.match(schedule, /function patientField\(selectedId,seed\)/);
  assert.match(schedule, /role="combobox" aria-expanded="false" aria-controls="schedule-patient-list" aria-autocomplete="list"/);
  assert.match(schedule, /role="listbox" aria-label="Pacientes encontrados"/);
  assert.match(schedule, /placeholder="Buscar por nombre, teléfono o correo"/);
  // Reprogramar o revisar una solicitud conserva el paciente fijo.
  assert.match(schedule, /\(appointment\|\|request\)\?'<label>Paciente<select name="patient" required disabled>/);
  assert.match(schedule, /camila_pacientes'\)\.select\('id,nombre,apellido,telefono,email'\)/);
});

test('la búsqueda ignora acentos y mayúsculas, y encuentra por teléfono', () => {
  assert.ok(schedule.includes("normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase()"));
  assert.match(schedule, /function phoneKey\(v\)\{var d=digitsOf\(v\);if\(d\.length===10\)return d;if\(d\.length===12&&d\.slice\(0,2\)==='52'\)return d\.slice\(2\);if\(d\.length===13&&d\.slice\(0,3\)==='521'\)return d\.slice\(3\)/, 'misma regla que smyl_normalize_contact_phone');
  assert.match(schedule, /e\.key==='ArrowDown'\|\|e\.key==='ArrowUp'/);
  assert.match(schedule, /e\.key==='Escape'&&open/);
});

test('el alta rápida avisa de duplicados y guarda en la clínica de la sesión', () => {
  assert.match(schedule, /rpc\('smyl_patient_duplicates',\{p_tenant_id:state\.tenant/);
  assert.match(schedule, /insert\(\[\{tenant_id:state\.tenant,nombre:nombre,apellido:apellido,telefono:tel,email:mail\}\]\)/);
  assert.match(schedule, /Ya existe un paciente con estos datos/);
  assert.match(schedule, /Es otra persona, registrar de todos modos/);
  assert.match(schedule, /code==='42501'\?'Tu rol no permite registrar pacientes/);
  assert.match(schedule, /if\(!request&&!e\.currentTarget\.elements\.patient\.value\)\{/, 'no se confirma sin un paciente elegido');
});

test('los errores se muestran dentro del diálogo y no detrás de él', () => {
  assert.match(schedule, /function dialogError\(text\)/);
  assert.match(schedule, /function notify\(text,tone\)\{if\(tone==='error'\)dialogError\(text\);/);
  assert.match(schedule, /box\.setAttribute\('role','alert'\)/);
});

test('el control de reserva avisa cuando faltan horarios o la cita queda fuera de ellos', () => {
  assert.match(schedule, /function hoursIssues\(branch,professional,start,end\)/);
  assert.match(schedule, /La sucursal no tiene horario semanal configurado\. Agrégalo en Agenda, Disponibilidad/);
  assert.match(schedule, /El profesional no tiene horario semanal en esta sucursal/);
  assert.match(schedule, /La cita queda fuera del horario de la sucursal\./);
  assert.match(schedule, /La cita queda fuera de la disponibilidad del profesional\./);
  assert.match(schedule, /timeZone:tz\|\|'America\/Mexico_City'/, 'usa la hora de la sucursal, como la base');
  assert.match(schedule, /hoursIssues\(branch,professional,start,end\)\.forEach/);
});

test('web, móvil y PWA publican la misma Agenda', () => {
  for (const file of ['smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-schedule\.js\?v=1[2-9]/);
    assert.match(read(file), /smyl-schedule\.css\?v=(?:[7-9]|1[0-9])/);
  }
  const css = read('smyl-schedule.css');
  assert.match(css, /\.schedule-dialog-error\{/);
  assert.match(css, /#schedule-patient-list\{position:absolute/);
});
