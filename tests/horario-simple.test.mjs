import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Equipo: el horario del dentista se edita en modo simple (días + un horario + atajos) con aviso previo de la sucursal', () => {
  const js = read('smyl-clinic-admin.js');
  assert.match(js, /function simpleHoursEditor\(/);
  for (const label of ['Igual que la sucursal', 'Lunes a viernes', 'Lunes a sábado', '¿Qué días atiende?', '¿En qué horario?', 'Ajustar día por día', 'Volver a lo simple']) assert.ok(js.includes(label), label);
  assert.match(js, /function branchProblem\(draft, branch\)/);
  assert.match(js, /la sucursal no abre ese día/);
  assert.match(js, /var problem = draftProblem\(draft\) \|\| branchProblem\(draft, branch\)/);
  // Los días con horarios distintos o varios bloques caen solos al modo «día por día».
  assert.match(js, /if \(draft\.detail !== true && uniform\) return simpleHoursEditor/);
  assert.match(js, /function compactWeek\(rows\)/);
  assert.doesNotMatch(js, /Editar horarios en la Agenda/);
});

test('Agenda: una sola vía para el horario; la lista resume por profesional y sede y abre la ficha', () => {
  const agenda = read('smyl-schedule.js');
  assert.doesNotMatch(agenda, /schedule-add-hours|Disponibilidad profesional|function openHours|function deactivateHour/);
  assert.match(agenda, /Horario de tu equipo/);
  assert.match(agenda, /window\.SmylClinicAdmin\.editHours\(r\.p\.id,r\.br\.id\)/);
  assert.match(agenda, /Poner horario/);
  const admin = read('smyl-clinic-admin.js');
  assert.match(admin, /editHours: editHours/);
  assert.match(admin, /window\.ir\('clinica'\)/, 'la ficha vive en Mi clínica: hay que ir allí para que se vea');
});

test('Configuración: «Horarios y servicios» ya no se repite (Servicios y tarifas vive en Catálogo)', () => {
  const hub = read('smyl-settings-hub.js');
  assert.doesNotMatch(hub, /Define quién atiende, dónde y en qué horarios/);
  assert.doesNotMatch(hub, /title: 'Horarios y servicios'/);
  assert.match(hub, /title: 'Servicios y tarifas', desc: 'Tratamientos, duración, precios y datos fiscales\.'/);
});

test('web y móvil publican los mismos archivos del editor de horarios', () => {
  for (const f of ['smyl-clinic-admin.js', 'smyl-clinic-admin.css', 'smyl-schedule.js', 'smyl-settings-hub.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
  assert.match(read('app.html'), /smyl-clinic-admin\.js\?v=31/);
  assert.match(read('app.html'), /smyl-schedule\.js\?v=68/);
});
