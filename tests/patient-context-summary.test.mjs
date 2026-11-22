// Ficha del paciente: «Contexto del paciente» en el Resumen y encabezado sin contacto repetido (contrato del frontend).
// La conducta completa se comprueba en navegador con tests/qa/ficha-contexto-smoke.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const p360 = read('smyl-patient-360.js');
const css = read('smyl-patient-360.css');
const block = p360.slice(p360.indexOf('// Contexto del paciente (Resumen)'), p360.indexOf('function renderOverview(s){'));

test('el Resumen muestra saldo, próxima cita, última visita y el recorrido de citas', () => {
  assert.ok(block.length > 3000, 'no se encontró el bloque de contexto');
  for (const name of ['balanceCard', 'nextCard', 'lastVisitCard', 'contextHtml', 'visitsHtml', 'bindContext']) assert.match(block, new RegExp(`function ${name}\\(`));
  assert.match(p360, /contextHtml\(s\)\+\s*'<section class="p360-summary-section" aria-labelledby="p360-today-title">/, 'el contexto va antes de «Hoy»');
  assert.match(p360, /visitsHtml\(s\)\+\s*'<section class="p360-summary-section" aria-labelledby="p360-activity-title">/, 'las citas van antes de la actividad');
  assert.match(p360, /bindOverview\(s\);bindContext\(s\);/);
  assert.match(block, /Citas y visitas/);
  assert.match(block, /Próximas/);
  assert.match(block, /Anteriores/);
});

test('el saldo solo lo ve quien tiene acceso a Cobros y se actualiza cuando llega la cuenta', () => {
  assert.match(block, /function balanceCard\(s\)\{\s*if\(!s\.canFinanceRead\)return '';/);
  assert.match(p360, /renderFlags\(s\);if\(s\.canRead&&s\.overview\)renderOverview\(s\);/, 'al llegar la cuenta el Resumen se vuelve a pintar con el saldo');
  assert.match(block, /sk\('text',\{lines:2,label:'Consultando saldo'\}\)/);
  assert.match(block, /due\?'Cobrar':'Abrir cuenta'/);
});

test('las inasistencias y cancelaciones cuentan como citas anteriores y las próximas excluyen lo ya cerrado', () => {
  assert.match(block, /\['cancelled','no_show','completed'\]\.indexOf\(a\.status\)<0&&new Date\(a\.starts_at\)\.getTime\(\)>=now/);
  assert.match(block, /no_show:'No vino'/);
  assert.match(block, /pluralize\(missed,'inasistencia','inasistencias'\)/);
});

test('los datos del paciente se escriben escapados en el contexto', () => {
  // Todo dato variable pasa por esc(); los números y etiquetas fijas no necesitan escape.
  for (const piece of ['esc(apptWhen(', 'esc(apptService(', 'esc(apptWho(', 'esc(date(', 'esc(next.status)', 'esc(VISIT_STATUS[']) assert.ok(block.includes(piece), `falta escapar ${piece}`);
  assert.doesNotMatch(block, /\+\s*(?:a|next|last)\.(?:service_id|professional_id|notes|notas)\b/);
});

test('el encabezado ya no repite teléfono y correo y la barra solo lleva Agendar cita y Nueva evolución', () => {
  assert.doesNotMatch(p360, /p360-contact-line|function contactLine|\+ Agregar teléfono o correo|bindContactLink/);
  assert.match(p360, /function contactRow\(label,value\)\{if\(value\|\|!canEditPatient\(\)\)return dataRow\(label,value\);/);
  const bar = read('smyl-professional-v3.js');
  const items = bar.slice(bar.indexOf('function patientBar()'), bar.indexOf('function treatmentJourney()'));
  assert.match(items, /\['Agendar cita','calendar'/);
  assert.match(items, /\['Nueva evolución','note'/);
  for (const label of ['Cotizar', 'Cobrar', 'Enviar mensaje']) assert.doesNotMatch(items, new RegExp(`\\['${label}','`));
});

test('el CSS nuevo no baja de 12 px y se apila en pantallas angostas', () => {
  const nuevo = css.slice(css.indexOf('/* ── Contexto del paciente en el Resumen'));
  assert.ok(nuevo.length > 1500);
  const chicos = [...nuevo.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)].filter(m => Number(m[1]) < 12);
  assert.equal(chicos.length, 0, `texto menor a 12 px: ${chicos.map(m => m[0]).join(', ')}`);
  assert.match(nuevo, /@media\(max-width:900px\)\{\.p360-context-grid,\.p360-visits-grid\{grid-template-columns:1fr\}/);
});

test('la copia móvil y la caché publican las mismas versiones', () => {
  for (const file of ['smyl-patient-360.js', 'smyl-patient-360.css', 'smyl-professional-v3.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), `mobile/www/${file} difiere`);
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-patient-360\.js\?v=38/);
    assert.match(read(file), /smyl-patient-360\.css\?v=22/);
    assert.match(read(file), /smyl-professional-v3\.js\?v=15/);
  }
});
