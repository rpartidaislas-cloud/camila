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

test('Pacientes usa una superficie v3.2 con búsqueda etiquetada y una acción primaria', () => {
  const section = app.match(/<!-- ═══ PACIENTES ═══ -->([\s\S]*?)<!-- ═══ DETALLE PACIENTE ═══ -->/)?.[1] || '';
  assert.match(section, /patient-directory-v3/);
  assert.match(section, /<label for="buscar-pac">Buscar pacientes<\/label>/);
  assert.match(section, /class="patient-search-icon"/);
  assert.match(section, />Nuevo paciente<\/span>/);
  assert.doesNotMatch(section, /🔍|👥/);
  assert.doesNotMatch(section, /<div class="card">/);
});

test('el directorio crea una tabla clínica y nombres accesibles por paciente', () => {
  assert.match(clinic, /el\('table', 'clinic-patient-table'\)/);
  assert.match(clinic, /el\('div', 'clinic-patient-identity-inner'\)/);
  assert.match(clinic, /\['Paciente', 'Contacto', 'Próxima atención', 'Estado', 'Acción'\]/);
  assert.match(clinic, /Agendar cita para /);
  assert.match(clinic, /Abrir expediente de /);
  assert.match(clinic, /patientEmptyState\('Sin resultados'/);
  assert.match(clinic, /patientEmptyState\('Aún no hay pacientes'/);
  assert.match(clinic, /Cargando pacientes/);
});

test('escritorio usa tabla y móvil transforma cada fila en tarjeta compacta', () => {
  assert.match(css, /\.clinic-patient-table\{/);
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.clinic-patient-table \.clinic-patient-row\{[\s\S]*?display:grid/);
  assert.match(css, /td\.clinic-patient-state\{display:block\}/);
  assert.match(css, /min-height:48px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('Ficha 360 hereda navy, controles legibles y root sin tarjeta exterior', () => {
  assert.match(css, /#p-paciente-detalle \.p360-root\{[\s\S]*?--p360-blue:var\(--smyl-ui-primary/);
  assert.match(css, /#p-paciente-detalle \.p360-root\{[\s\S]*?border:0;[\s\S]*?box-shadow:none/);
  assert.match(css, /p360-form-grid :is\(input,select,textarea\)\{min-height:48px/);
});

test('Nuevo paciente sigue la política visual y revela lo opcional al final', () => {
  const modal = app.match(/<!-- ═══ MODAL PACIENTE ═══ -->([\s\S]*?)<!-- ═══ MODAL CAMBIAR DE PLAN ═══ -->/)?.[1] || '';
  assert.match(modal, /Datos esenciales/);
  assert.match(modal, /Atención/);
  assert.match(modal, /Mensajes por WhatsApp/);
  assert.match(modal, /<details class="clinic-secondary clinic-patient-extra">/);
  assert.match(modal, />Crear paciente</);
  assert.match(clinic, /id \? 'Guardar cambios' : 'Crear paciente'/);
  assert.match(css, /width:min\(680px,calc\(100vw - 32px\)\)/);
  assert.match(css, /#modal-paciente \.mp-body/);
  assert.match(css, /#modal-paciente \.fg :is\(input,select,textarea\)\{min-height:48px/);
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
