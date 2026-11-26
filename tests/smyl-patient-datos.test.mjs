import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const p360 = read('smyl-patient-360.js');
const bar = read('smyl-professional-v3.js');

test('la barra del paciente ya no esconde acciones en «Más acciones»', () => {
  assert.doesNotMatch(bar, /pro-patient-more|<summary>Más acciones/);
  for (const label of ["'Agendar cita'", "'Nueva evolución'"]) assert.ok(bar.includes(label), label);
  for (const label of ["'Cotizar'", "'Cobrar'", "'Enviar mensaje'"]) assert.ok(!bar.includes(label), `${label} ya no va en la barra`);
});

test('«Datos del paciente» muestra datos generales y edita con el formulario de alta existente', () => {
  const datos = p360.slice(p360.indexOf('function renderDatos('), p360.indexOf('function refreshPatientIdentity('));
  for (const label of ['Teléfono / WhatsApp', 'Correo', 'Fecha de nacimiento', 'Sucursal', 'Profesional de cabecera', 'Cómo nos conoció', 'Mensajes por WhatsApp']) assert.ok(datos.includes(label), label);
  assert.match(p360, /function editPatient\(\)\{var s=state;if\(s&&s\.drawer&&s\.drawer\.open\)closeDatos\(s\);if\(canEditPatient\(\)\)window\.editarPacienteActual\(\);\}/);
  assert.doesNotMatch(datos, /from\('camila_pacientes'\)\.update/, 'no duplica el guardado del paciente');
});

test('los datos fiscales usan el mismo formulario de Cobros y respetan permisos', () => {
  assert.match(p360, /window\.SmylFiscalCapture\.open\(\{tenant:s\.tenant,actor:s\.actor,patientId:s\.patient/);
  assert.match(p360, /if\(s\.canFinanceRead\)\{var f=s\.fiscal/);
  assert.match(p360, /canCapture=s\.canFinanceManage&&window\.SmylFiscalCapture&&R/);
  assert.doesNotMatch(p360, /p360-billing-form|name="regime" pattern/, 'se retiró el formulario fiscal básico');
  assert.match(p360, /R\.perfilListo\(f\)/, 'el estado «Listos para facturar» usa las reglas del SAT');
});

test('el contacto vive solo en Datos del paciente (con Agregar si falta) y la ficha se refresca tras editar', () => {
  assert.doesNotMatch(p360, /p360-contact-line|\+ Agregar teléfono o correo|function contactLine/, 'el encabezado ya no repite el contacto');
  assert.match(p360, /function contactRow\(label,value\)\{if\(value\|\|!canEditPatient\(\)\)return dataRow\(label,value\)/);
  assert.match(p360, /contactRow\('Teléfono \/ WhatsApp',p\.telefono\)\+contactRow\('Correo',p\.email\)/);
  assert.match(p360, /data-p360-edit-patient>Agregar<\/button>/);
  assert.match(p360, /state\.identityStamp!==window\.pacienteActual\.updated_at/);
  assert.match(p360, /if\(key==='billing'\|\|key==='datos'\)\{openDatos\(s\);return;\}/, 'los accesos antiguos a facturación abren el panel de datos');
});

test('web, móvil y PWA publican Datos del paciente', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-patient-360\.js\?v=41/);
    assert.match(read(file), /smyl-patient-360\.css\?v=23/);
    assert.match(read(file), /smyl-professional-v3\.js\?v=15/);
    assert.match(read(file), /smyl-professional-v3\.css\?v=13/);
  }
  for (const file of ['smyl-patient-360.js', 'smyl-patient-360.css', 'smyl-professional-v3.js', 'smyl-professional-v3.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});

test('organización v2: pestañas clínicas en orden de consulta y lo administrativo fuera de ellas', () => {
  const tabs = [...p360.matchAll(/data-p360-tab="([a-z]+)"[^>]*>([^<]+)</g)].map((m) => m[2]);
  assert.deepEqual(tabs, ['Resumen', 'Historia clínica', 'Consulta', 'Tratamiento', 'Diseño de sonrisa', 'Imágenes y estudios']);
  assert.match(p360, /visits:\['notes','appointments'\]/, 'evoluciones y citas dejan de estar escondidas');
  assert.match(p360, /<dialog class="p360-drawer"/, 'datos del paciente en panel lateral');
  assert.match(p360, /function renderFlags\(s\)/);
  assert.match(p360, /if\(s\.canFinanceRead\)\{var a=s\.account/, 'saldo y datos fiscales solo con finance.read');
  assert.match(p360, /function accountCard\(s\)\{var a=s\.account,F=window\.SmylFinance;if\(!s\.canFinanceRead\)return '';/);
});
