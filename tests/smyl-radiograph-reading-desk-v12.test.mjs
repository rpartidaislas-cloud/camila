import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const record = read('smyl-dental-record.js');
const css = read('smyl-radiograph-workbench.css');
const app = read('app.html');
const sw = read('sw.js');

test('la mesa radiografica presenta una sola revision profesional y deja MILA como apoyo', () => {
  assert.doesNotMatch(record, /dr-panel-tabs|role','tablist|\['ai','IA'/);
  assert.match(record, /Revisión clínica/);
  assert.match(record, /Aún no hay observaciones clínicas/);
  assert.match(record, /Buscar sugerencias con MILA/);
  assert.match(record, /MILA no sustituye tu revisión ni incorpora observaciones sin aprobación profesional/);
  assert.match(record, /Nota general del estudio/);
  assert.match(record, /Original protegido/);
});

test('la imagen puede ampliarse y el panel vuelve sin perder la revision', () => {
  assert.match(record, /workspace\.classList\.toggle\('is-panel-collapsed'\)/);
  assert.match(record, /panelToggle\.setAttribute\('aria-expanded'/);
  assert.match(css, /\.dr-reading-workspace\.is-panel-collapsed/);
  assert.match(css, /\.dr-panel-toggle/);
});

test('controles y estados son legibles en escritorio y movil', () => {
  assert.match(record, /dr-review-status/);
  assert.match(record, /dr-zoom-group/);
  assert.match(record, /Guardar cambios/);
  assert.match(css, /\.dr-review-body/);
  assert.match(css, /\.dr-ai-support/);
  assert.match(css, /\.dr-study-notes/);
  assert.match(css, /\.dr-viewer-footer/);
  assert.match(css, /@media \(max-width: 639px\)/);
});

test('web, PWA y aplicacion movil distribuyen la version visual vigente', () => {
  assert.match(app, /smyl-radiograph-workbench\.css\?v=26/);
  assert.match(app, /smyl-radiograph-review\.js\?v=33/);
  assert.match(app, /smyl-dental-record\.js\?v=35/);
  assert.match(sw, /radiograph-guided-process-v15/);
  assert.match(sw, /radiograph-anatomic-odontogram-v20/);
  for (const file of ['smyl-dental-record.js', 'smyl-radiograph-workbench.css', 'app.html', 'sw.js']) {
    assert.equal(read(file), read('mobile/www/' + file), file + ' debe coincidir en mobile/www');
  }
});
