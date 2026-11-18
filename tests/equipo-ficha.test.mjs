// Equipo: lista única, ficha de cada persona, teléfono interno y traslado entre sedes (contrato del frontend).
// La conducta completa se comprueba en navegador con tests/qa/equipo-ficha-smoke.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const js = read('smyl-clinic-admin.js');
const css = read('smyl-clinic-admin.css');
const block = js.slice(js.indexOf('// ── Equipo: una sola lista de personas'), js.indexOf('  function renderRoleGuide() {'));

test('la ficha escribe los datos de las personas como texto y no como HTML', () => {
  assert.ok(block.length > 5000, 'no se encontró el bloque de Equipo');
  assert.doesNotMatch(block, /innerHTML/, 'nombres, correos y teléfonos nunca deben insertarse como HTML');
  assert.match(block, /el\('strong', '', person\.name\)/);
  assert.match(block, /'tel:' \+ professional\.phone\.replace\(\/\[\^0-9\+\]\/g, ''\)/, 'el teléfono sólo lleva dígitos y + en el enlace');
});

test('solo quien administra edita; el resto ve la ficha en consulta', () => {
  assert.match(block, /if \(professional && state\.canTeam\)/, 'Editar datos exige team.manage');
  assert.match(block, /if \(state\.canClinic\) \{\s*var remove/, 'Quitar de una sede exige clinic.manage');
  assert.match(block, /state\.canClinic && free\.length/, 'Asignar sede exige clinic.manage');
  assert.match(block, /var canDeactivate = state\.canTeam && !\(person\.user && person\.user\.rol === 'dueño'\)/, 'nunca se desactiva al propietario');
  assert.match(block, /roleSelect\.disabled = !state\.canAssignRoles \|\| user\.rol === 'dueño'/);
  assert.match(block, /input\.disabled = !state\.canClinic/, 'el margen de traslado se bloquea para quien no administra');
});

test('la pantalla sigue funcionando si la base todavía no tiene la actualización', () => {
  assert.match(js, /async function loadProfessionals\(tenant\)/);
  assert.match(js, /state\.phoneSupported = false/);
  assert.match(js, /smyl_schedule_rules'\)\.select\('professional_travel_margin_minutes'\)[\s\S]{0,120}\.then\(function \(row\) \{ return \{ ok: true/);
  assert.match(js, /soft\(query\(window\.sb\.rpc\('smyl_professional_travel_conflicts'\)\), \[\]\)/);
  assert.match(js, /card\.hidden = !state\.travelSupported/);
});

test('los errores salen en lenguaje normal y los de carga ofrecen reintentar', () => {
  assert.match(js, /failed to fetch\|networkerror/);
  assert.match(js, /No pudimos conectar con el servidor\. Revisa tu internet e intenta de nuevo\./);
  assert.match(js, /feedback\('No se pudo cargar Mi clínica\. ' \+ errorMessage\(error\), 'error', function \(\) \{ load\(true\); \}\)/);
  assert.match(js, /actions\.append\(again\)|var again = el\('button', '', 'Reintentar'\)/);
});

test('la regla de traslado se guarda con la función de la base y se valida antes de enviar', () => {
  assert.match(block, /rpc\('smyl_set_professional_travel_margin', \{ p_minutes: minutes \}\)/);
  assert.match(block, /minutes < 0 \|\| minutes > 240/);
  assert.match(block, /Number\.isInteger\(minutes\)/);
});

test('el encabezado de Configuración sigue al área en que estás y Equipo no muestra el resumen de Sucursales', () => {
  assert.match(js, /var HUB_ITEMS = \{ operacion: \['clinica', 'Sucursales y espacios'\], equipo: \['equipo', 'Profesionales y roles'\] \}/);
  assert.match(js, /\['clinic-admin-readiness', 'clinic-admin-metrics'\]\.forEach\(function \(id\) \{ var node = document\.getElementById\(id\); if \(node\) node\.hidden = state\.tab === 'equipo'/);
  assert.match(js, /goTab\(button\.dataset\.caTabTarget\)/);
  assert.match(js, /addEventListener\('click', function \(\) \{ goTab\('equipo'\); \}\)/);
});

test('la ficha es un diálogo accesible: panel lateral en pantalla grande y completo en el celular', () => {
  assert.match(js, /<dialog id="clinic-admin-person" class="clinic-admin-sheet" aria-labelledby="clinic-admin-person-title">/);
  assert.match(js, /dialog\.showModal\(\)/);
  assert.match(js, /close\.setAttribute\('aria-label', 'Cerrar la ficha'\)/);
  assert.match(css, /\.clinic-admin-sheet\{[^}]*width:min\(500px,100vw\)/);
  assert.match(css, /@media\(max-width:700px\)\{\s*\.clinic-admin-sheet\{width:100vw;border-radius:0\}/);
});

test('el CSS nuevo no baja de 12 px ni agrega microtexto', () => {
  const nuevo = css.slice(css.indexOf('/* ── Equipo: lista única, ficha de la persona'));
  assert.ok(nuevo.length > 3000);
  const chicos = [...nuevo.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)].filter(m => Number(m[1]) < 12);
  assert.equal(chicos.length, 0, `texto menor a 12 px: ${chicos.map(m => m[0]).join(', ')}`);
});

test('la copia móvil y la caché publican la misma versión', () => {
  for (const file of ['smyl-clinic-admin.js', 'smyl-clinic-admin.css', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), `mobile/www/${file} difiere`);
  assert.match(read('app.html'), /smyl-clinic-admin\.js\?v=14/);
  assert.match(read('app.html'), /smyl-clinic-admin\.css\?v=11/);
  assert.match(read('sw.js'), /\/camila\/smyl-clinic-admin\.js\?v=14/);
  assert.match(read('sw.js'), /\/camila\/smyl-clinic-admin\.css\?v=11/);
});
