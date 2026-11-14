import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const record = read('smyl-dental-record.js');
const css = read('smyl-radiograph-workbench.css');
const app = read('app.html');
const sw = read('sw.js');

test('la mesa radiografica organiza la revision por tarea sin duplicar el original', () => {
  assert.match(record, /\['findings','Hallazgos',findingsPanel\]/);
  assert.match(record, /\['ai','IA',aiPanel\]/);
  assert.match(record, /\['notes','Notas',notesPanel\]/);
  assert.match(record, /Observa, registra y confirma bajo control profesional/);
  assert.match(record, /Nada se incorpora sin tu confirmación profesional/);
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
  assert.match(css, /\.dr-panel-tabs/);
  assert.match(css, /\.dr-viewer-footer/);
  assert.match(css, /@media \(max-width: 639px\)/);
});

test('web, PWA y aplicacion movil distribuyen la version visual vigente', () => {
  assert.match(app, /smyl-radiograph-workbench\.css\?v=23/);
  assert.match(app, /smyl-radiograph-review\.js\?v=28/);
  assert.match(app, /smyl-dental-record\.js\?v=31/);
  assert.match(sw, /radiograph-guided-process-v15/);
  assert.match(sw, /radiograph-anatomic-odontogram-v20/);
  for (const file of ['smyl-dental-record.js', 'smyl-radiograph-workbench.css', 'app.html', 'sw.js']) {
    assert.equal(read(file), read('mobile/www/' + file), file + ' debe coincidir en mobile/www');
  }
});
