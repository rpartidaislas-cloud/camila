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
  assert.match(dental, /report=review\?\.document\.analysis\?\.report/);
  assert.match(dental, /quality:report\?\.quality/);
  assert.match(dental, /openStudy\(tenant,patient,studyId\)/);
  for (const copy of ['IA disponible', 'por confirmar', 'Revisión completada', 'Sin resultado confirmado']) {
    assert.match(workspace, new RegExp(copy));
  }
});

test('la IA permanece separada de la confirmación profesional', () => {
  assert.match(workspace, /La IA sugiere; el dentista confirma\./);
  assert.match(workspace, /Revisión profesional/);
  assert.match(workspace, /sugerencias pendientes/);
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
  assert.match(fixture, /2 sugerencias pendientes/);
  assert.match(fixture, /Nada pasa al odontograma hasta que lo confirmes/);
});

test('web, móvil y PWA publican la etapa 3.5', () => {
  assert.match(app, /smyl-dental-record\.js\?v=31/);
  assert.match(app, /smyl-case-workspace\.css\?v=29/);
  assert.match(app, /smyl-case-workspace\.js\?v=40/);
  assert.match(worker, /evidence-ai-v35/);
  for (const file of ['app.html', 'sw.js', 'smyl-dental-record.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css']) {
    assert.equal(read('../' + file), read('../mobile/www/' + file));
  }
});
