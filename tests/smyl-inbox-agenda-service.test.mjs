import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('smyl-inbox.js');
const css = read('smyl-inbox.css');

test('al abrir «Agendar cita» se elige el primer servicio que sí tiene profesionales', () => {
  assert.match(js, /function serviceHasProfessionals\(catalog, serviceId\)/);
  // Solo cuentan los profesionales activos del catálogo.
  assert.match(js, /var active = new Set\(\(\(catalog && catalog\.professionals\) \|\| \[\]\)/);
  assert.match(js, /orderedServices\.forEach\(function \(row\) \{ services\.append\(new Option\(row\.name .* ' · sin profesional'\)/);
  assert.match(js, /if \(orderedServices\.length\) services\.value = orderedServices\[0\]\.id;/);
  assert.doesNotMatch(js, /services\.value = catalog\.services\[0\]\.id/, 'ya no se elige el primer servicio por orden alfabético');
});

test('elegir un servicio sin profesionales avisa en lugar de mostrar un calendario vacío', () => {
  assert.match(js, /availabilityEmptyReason = serviceHasProfessionals\(state\.availabilityCatalog, serviceId\) \? '' : 'no_professionals'/);
  assert.match(js, /no tiene profesionales asignados/);
  assert.match(js, /'Ver horarios de ' \+ alternativeService\.name/);
});

test('el aviso de configuración no ocupa un diálogo de pantalla completa y se publica en web y móvil', () => {
  assert.match(css, /\.smyl-inbox-availability-dialog\.has-config-issue\{height:auto;min-height:0/);
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-inbox\.js\?v=84/);
    assert.match(read(file), /smyl-inbox\.css\?v=71/);
  }
  for (const file of ['smyl-inbox.js', 'smyl-inbox.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
