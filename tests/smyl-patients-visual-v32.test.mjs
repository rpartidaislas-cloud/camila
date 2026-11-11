import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.html');
const clinic = read('smyl-clinic.js');
const css = read('smyl-clinic.css');
const directory = read('smyl-patients-directory.css');

test('Pacientes usa un directorio clínico con resumen accionable y una acción primaria', () => {
  const section = app.match(/<!-- ═══ PACIENTES ═══ -->([\s\S]*?)<!-- ═══ DETALLE PACIENTE ═══ -->/)?.[1] || '';
  assert.match(section, /patient-directory-v4/);
  assert.match(section, /Continuidad de atención/);
  assert.match(section, /<label for="buscar-pac">Buscar en el directorio<\/label>/);
  assert.match(section, /class="patient-search-icon"/);
  assert.match(section, />Nuevo paciente<\/span>/);
  assert.match(section, /patient-directory-insights/);
  assert.match(section, /data-patient-filter-value="upcoming"/);
  assert.match(section, /data-patient-filter-value="without-appointment"/);
  assert.match(section, /data-patient-filter-value="incomplete"/);
  assert.doesNotMatch(section, /🔍|👥/);
  assert.doesNotMatch(section, /<div class="card">/);
});

test('el directorio crea una tabla clínica enfocada en continuidad y acciones contextuales', () => {
  assert.match(clinic, /el\('table', 'clinic-patient-table'\)/);
  assert.match(clinic, /el\('div', 'clinic-patient-identity-inner'\)/);
  assert.match(clinic, /\['Paciente', 'Atención', 'Estado', 'Acciones'\]/);
  assert.match(clinic, /Abrir expediente/);
  assert.match(clinic, /clinic-patient-menu-panel/);
  assert.match(clinic, /Cita programada/);
  assert.match(clinic, /Seguimiento pendiente/);
  assert.match(clinic, /Datos por completar/);
  assert.match(clinic, /Agendar cita para /);
  assert.match(clinic, /Abrir expediente de /);
  assert.match(clinic, /patientEmptyState\('Sin resultados'/);
  assert.match(clinic, /patientEmptyState\('Aún no hay pacientes'/);
  assert.match(clinic, /Cargando pacientes/);
});

test('la capa visual final gobierna escritorio, tablet y móvil sin depender de estilos globales', () => {
  assert.match(app, /smyl-patients-directory\.css\?v=2[\s\S]*smyl-ui-datta-v4\.css\?v=2/);
  assert.match(directory, /#p-pacientes \.patient-directory-header/);
  assert.match(directory, /#p-pacientes \.clinic-patient-table/);
  assert.match(directory, /@media\(max-width:820px\)/);
  assert.match(directory, /@media\(max-width:620px\)/);
  assert.match(directory, /\.clinic-patient-table \.clinic-patient-row\{[\s\S]*?display:grid/);
  assert.match(directory, /min-height:44px/);
  assert.match(directory, /prefers-reduced-motion:reduce/);
});

test('Ficha 360 hereda navy, controles legibles y root sin tarjeta exterior', () => {
  assert.match(css, /#p-paciente-detalle \.p360-root\{[\s\S]*?--p360-blue:var\(--smyl-ui-primary/);
  assert.match(css, /#p-paciente-detalle \.p360-root\{[\s\S]*?border:0;[\s\S]*?box-shadow:none/);
  assert.match(css, /p360-form-grid :is\(input,select,textarea\)\{min-height:48px/);
});

test('Nuevo paciente sigue la política visual y revela lo opcional al final', () => {
  const modal = app.match(/<!-- ═══ MODAL PACIENTE ═══ -->([\s\S]*?)<!-- ═══ MODAL CAMBIAR DE PLAN ═══ -->/)?.[1] || '';
  assert.match(modal, /Información básica/);
  assert.match(modal, /Asignación y seguimiento/);
  assert.match(modal, /Autorizó mensajes por WhatsApp/);
  assert.match(modal, /Alerta para la atención/);
  assert.match(modal, /<details class="clinic-secondary clinic-patient-extra/);
  assert.match(modal, />Crear y abrir expediente</);
  assert.match(clinic, /id \? 'Guardar cambios' : 'Crear y abrir expediente'/);
  assert.match(css, /width:min\(720px,calc\(100vw - 32px\)\)/);
  assert.match(css, /#modal-paciente \.mp-body/);
  assert.match(css, /#modal-paciente \.fg>:is\(input,select,textarea\)[\s\S]*?min-height:46px/);
  assert.match(clinic, /Hay datos sin guardar/);
  assert.match(clinic, /updateWhatsAppConsent/);
});

test('la fixture visual del directorio sólo usa datos sintéticos', () => {
  const fixture = read('tests/fixtures/smyl-patients-v32-preview.html');
  assert.match(fixture, /Directorio de pacientes/);
  assert.match(fixture, /example\.test/);
  assert.doesNotMatch(fixture, /Bordados Express|Doña|Pepe/);
});

test('la fixture de alta reutiliza la ventana real sin datos clínicos', () => {
  const fixture = read('tests/fixtures/smyl-patient-intake-v33-preview.html');
  assert.match(fixture, /fetch\('\.\.\/\.\.\/app\.html'\)/);
  assert.match(fixture, /insertAdjacentHTML/);
  assert.match(fixture, /Clínica de prueba/);
  assert.doesNotMatch(fixture, /Bordados Express|Doña|Pepe/);
});
