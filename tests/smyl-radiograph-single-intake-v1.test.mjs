import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workspace = read('../smyl-case-workspace.js');
const integration = read('../smyl-evidence-center-integration.js');

test('Revisión profesional conserva una sola carga radiográfica canónica', () => {
  assert.ok(/ctx\.radiographShelf\.hidden=!studies\.length/.test(workspace));
  assert.equal(/btn\('Agregar radiografía',\(\)=>reviewPart\(ctx,1\)/.test(workspace), false, 'Valoración no debe abrir el cargador directamente');
  assert.equal(/label='Agregar radiografía';action=\(\)=>reviewPart\(ctx,1\)/.test(workspace), false, 'la acción contextual tampoco debe cargar desde Valoración');
  assert.equal(/No hay radiografías para revisar/.test(workspace), false, 'una cola vacía no debe competir con el archivo clínico');
  assert.ok(/openRadiographEvidence\(ctx\)/.test(workspace));
  assert.equal(/openStudy\?\.\([^)]*\)\)reviewPart\(ctx,1\)/.test(workspace), false,
    'si un estudio no abre, el flujo no debe apuntar a un editor oculto en Valoración');
});

test('el acceso contextual permanece en Revisión profesional y abre Archivos clínicos en Rayos X', () => {
  assert.ok(/function openRadiographEvidence\(ctx\)/.test(workspace));
  const start = workspace.indexOf('function openRadiographEvidence(ctx)');
  const end = workspace.indexOf('\n function ', start + 1);
  assert.ok(start > -1 && end > start, 'debe existir una ruta explícita hacia Archivos clínicos');
  const route = workspace.slice(start, end);
  assert.ok(/showEvaluationTask\(ctx,'findings'\)/.test(route));
  assert.ok(/SmylEvidenceCenterIntegration\?\.openAdd\?\.\('radiograph_2d'\)/.test(route));
  assert.equal(/reviewPart\(ctx,1\)/.test(route), false);
});

test('la creación conserva una sola puerta hacia el cargador canónico', () => {
  const calls = [...integration.matchAll(/SmylCaseWorkspace\?\.openRadiographIntake\?\.\(/g)];
  assert.equal(calls.length, 1, 'sólo la integración de Evidencia puede abrir el cargador canónico');
  assert.ok(/if \(payload\.modality === 'radiograph_2d'\) return routeRadiograph/.test(integration));
});
