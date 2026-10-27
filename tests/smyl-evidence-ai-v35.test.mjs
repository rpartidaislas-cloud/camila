import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../app.html');
const worker = read('../sw.js');
const dental = read('../smyl-dental-record.js');
const workspace = read('../smyl-case-workspace.js');
const styles = read('../smyl-case-workspace.css');
const fixture = read('./fixtures/smyl-clinical-flow-preview.html');

test('cada imagen compatible muestra el avance de su revisión asistida', () => {
  assert.match(dental, /workflow=review\?\.document\.workflow\?\.state\|\|'ready'/);
  assert.match(dental, /quality:review\?\.document\.analysis\?\.report\?\.quality/);
  assert.match(dental, /openStudy\(tenant,patient,studyId\)/);
  for (const copy of ['IA disponible', 'por confirmar', 'Revisión completada', 'Sin resultado confirmado']) {
    assert.match(workspace, new RegExp(copy));
  }
});

test('la IA permanece separada de la confirmación profesional', () => {
  assert.match(workspace, /Nada pasa al odontograma hasta que el profesional lo confirma/);
  assert.match(workspace, /Revisión profesional/);
  assert.match(workspace, /La IA sólo propone zonas/);
  assert.doesNotMatch(workspace, /diagnóstico automático|aprobar automáticamente/i);
});

test('el acceso abre el estudio exacto y reutiliza los revisores canónicos', () => {
  assert.match(workspace, /SmylDentalProgress\?\.openStudy/);
  assert.match(workspace, /ctx\.selected\.review\(\)/);
  assert.match(dental, /viewStudy\(ctx,study\);return true/);
});

test('la revisión asistida se adapta a móvil y conserva estados legibles', () => {
  for (const selector of ['cw-evidence-assistant', 'cw-evidence-ai-stats', 'cw-evidence-review', 'cw-evidence-meta']) {
    assert.match(styles, new RegExp(selector));
  }
  assert.match(styles, /\.cw-evidence-review\[data-state=pending\]/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(fixture, /2 sugerencias por confirmar/);
  assert.match(fixture, /Revisión profesional/);
});

test('web, móvil y PWA publican la etapa 3.5', () => {
  assert.match(app, /smyl-dental-record\.js\?v=14/);
  assert.match(app, /smyl-case-workspace\.css\?v=15/);
  assert.match(app, /smyl-case-workspace\.js\?v=18/);
  assert.match(worker, /evidence-ai-v35/);
  for (const file of ['app.html', 'sw.js', 'smyl-dental-record.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
