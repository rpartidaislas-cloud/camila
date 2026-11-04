import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');

const cases = read('smyl-patient-cases.js');
const workspace = read('smyl-case-workspace.js');

// Regresión: al abrir cualquier paciente la página se congelaba. smyl-patient-cases creaba la
// galería "Simulaciones" dentro de su panel de la ficha 360 y smyl-case-workspace la sacaba de
// ahí para esconderla; como ambos observan el mismo contenedor con MutationObserver, uno la
// recreaba y el otro la movía, en un bucle de microtareas que bloquea el hilo principal.

test('la galería se crea sólo si no existe ninguna en la pantalla, esté donde esté', () => {
  const mount = cases.slice(cases.indexOf('function mount() {'), cases.indexOf('const gallery = node('));
  assert.match(mount, /screen\.querySelector\('\.pc-gallery'\)/);
  assert.doesNotMatch(mount, /host\.querySelector\('\.pc-gallery'\)/,
    'una guarda limitada al panel se rompe si otro módulo reubica la galería');
});

test('el espacio de trabajo no saca la galería de su panel de Simulaciones', () => {
  const adopt = workspace.slice(workspace.indexOf('function adopt(ctx){'), workspace.indexOf('function select(ctx,entry){'));
  assert.match(adopt, /gallery&&!gallery\.closest\('\[data-p360-panel="simulations"\]'\)&&!ctx\.evidencePart\.body\.contains\(gallery\)/);
});

test('el espacio de trabajo sigue leyendo las sesiones desde la galería del panel', () => {
  const refresh = workspace.slice(workspace.indexOf('function refresh(){'), workspace.indexOf('ctx.entries.forEach'));
  assert.match(refresh, /ctx\.root\.querySelector\('\.pc-gallery'\)\|\|document\.querySelector\('#p-paciente-detalle \[data-p360-panel="simulations"\] \.pc-gallery'\)/);
});

test('web y móvil quedan sincronizados', () => {
  for (const file of ['smyl-patient-cases.js', 'smyl-case-workspace.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
