import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const clinic = read('smyl-clinic.js');

test('la lista de pacientes se pide por páginas para no perder a nadie pasando de 1,000', () => {
  assert.match(clinic, /async function fetchAllPatients\(tenant\)/);
  assert.match(clinic, /\.range\(page \* size, page \* size \+ size - 1\)/);
  assert.match(clinic, /if \(chunk\.length < size\) return \{ rows: rows, truncated: false \}/);
  assert.match(clinic, /page < 10/);
  assert.match(clinic, /Mostramos los más recientes/);
  assert.doesNotMatch(clinic, /select\('\*'\)\.eq\('tenant_id', tenant\)\.order\('created_at', \{ ascending: false \}\)\);/);
});

test('la búsqueda ignora acentos, acepta varias palabras y teléfonos con espacios', () => {
  assert.match(clinic, /normalize\('NFD'\)\.replace\(\/\[\\u0300-\\u036f\]\/g, ''\)/);
  assert.match(clinic, /tokens\.every\(function \(t\) \{ return hay\.indexOf\(t\) !== -1; \}\)/);
  assert.match(clinic, /replace\(\/\\D\/g, ''\)\.indexOf\(digits\)/);
  assert.match(clinic, /window\.filtrarPacientes = filterPatients/);
});

test('cada paciente muestra su próxima cita o última visita sin depender de la agenda', () => {
  assert.match(clinic, /\.in\('status', \['confirmed', 'arrived', 'in_progress'\]\)\.gte\('starts_at', nowIso\)/);
  assert.match(clinic, /Próxima cita: /);
  assert.match(clinic, /Última visita: /);
  assert.match(clinic, /Sin citas todavía/);
  // Si la agenda no responde (permiso o red) la lista sigue funcionando.
  assert.match(clinic, /catch \(_\) \{ \/\* sin permiso de agenda/);
});

test('Agendar cita abre Nueva cita con el paciente ya elegido y sin la marca de cotización aceptada', () => {
  assert.match(clinic, /window\.SmylSchedule\.bookFor\(p\)/);
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /bookFor:function\(p\)/);
  assert.match(schedule, /cachePatients\(\[p\]\);openNew\(null,null\);/);
  // forPatient (cotización aceptada) sigue siendo el único camino con p_source accepted_proposal.
  assert.match(schedule, /p_source:patientId\?'accepted_proposal':'manual'/);
  assert.match(read('app.html'), /placeholder="Buscar por nombre, teléfono o correo"/);
});

test('la lista de pacientes se distribuye igual en web, móvil y PWA', () => {
  for (const file of ['smyl-clinic.js', 'smyl-clinic.css', 'smyl-schedule.js', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  assert.match(read('app.html'), /smyl-clinic\.js\?v=12/);
  assert.match(read('sw.js'), /smyl-clinic\.js\?v=12/);
});
