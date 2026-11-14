import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('la conclusión radiográfica ofrece escritura y DICTAR CON MILA sin crear otra nota clínica', () => {
  const ui = read('smyl-radiograph-review.js');
  assert.match(ui, /button\('Escribir'/);
  assert.match(ui, /DICTAR CON MILA/);
  assert.match(ui, /Cada dictado consume MILA/);
  assert.match(ui, /tokens técnicos del procesamiento/);
  assert.match(ui, /text\.dispatchEvent\(new Event\('input'/);
  assert.doesNotMatch(ui, /mila_clinical_notes|mila_transcripts|mila_recordings/);
});

test('el servicio transcribe de forma efímera y registra consumo real e idempotente', () => {
  const service = read('supabase/functions/mila-clinical-dictation/index.ts');
  assert.match(service, /requirePermission\(auth, CORS, "clinical\.write"\)/);
  assert.match(service, /p_resource: "mila_seconds"/);
  assert.match(service, /p_source_type: "mila_clinical_dictation"/);
  assert.match(service, /token_usage: tokenUsage/);
  assert.match(service, /mila-clinical-dictation:\$\{requestId\}/);
  assert.doesNotMatch(service, /\.storage\.|mila_recordings|mila_transcripts|mila_clinical_notes/);
});

test('web, PWA y móvil publican la misma versión de la experiencia', () => {
  for (const file of ['app.html', 'sw.js', 'mobile/www/app.html', 'mobile/www/sw.js']) {
    const source = read(file);
    assert.match(source, /smyl-radiograph-review\.js\?v=30/, file);
    assert.match(source, /smyl-radiograph-workbench\.css\?v=24/, file);
  }
  for (const file of ['smyl-radiograph-review.js', 'smyl-radiograph-workbench.css', 'smyl-consumption.js']) {
    assert.equal(read('mobile/www/' + file), read(file), 'mobile/www desincronizado: ' + file);
  }
});

test('el historial de consumo identifica el dictado clínico', () => {
  assert.match(read('smyl-consumption.js'), /mila_clinical_dictation:'MILA · Dictado clínico'/);
});
