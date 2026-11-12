import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const serviceSource = read('../smyl-evidence-categories.js');
const center = read('../smyl-evidence-center.js');
const integration = read('../smyl-evidence-center-integration.js');
const migration = read('../supabase/migrations/20261112120000_smyl_evidence_categories.sql');

function categoryApi() {
  const window = { dispatchEvent() {} };
  vm.runInNewContext(serviceSource, { window, dispatchEvent() {}, CustomEvent: class {} }, { filename: 'smyl-evidence-categories.js' });
  return window.SmylEvidenceCategories;
}

test('las sugerencias son optativas y se activan con un clic', () => {
  const api = categoryApi();
  assert.deepEqual(Array.from(api.suggestions, item => item.name), [
    'Diagnóstico inicial','Ortodoncia','Endodoncia','Periodoncia',
    'Implantes','Cirugía','Rehabilitación','Seguimiento'
  ]);
  assert.match(center, /sec-suggested-chip/);
  assert.match(center, /Activar categoría/);
  assert.match(center, /onActivateCategory/);
  assert.doesNotMatch(serviceSource, /insert\(/);
});

test('las categorías clínicas no reemplazan el tipo técnico', () => {
  assert.match(center, /categoryIds/);
  assert.match(center, /modality:/);
  assert.match(center, /Categorías clínicas · opcional/);
  assert.match(integration, /applyCategoryAssignments/);
  assert.match(integration, /modality: 'radiograph_2d'/);
  assert.match(migration, /La modalidad técnica del archivo permanece/);
});

test('la clasificación conserva historial y nunca elimina el original', () => {
  assert.match(migration, /revoked_at timestamptz/);
  assert.match(migration, /archived_at timestamptz/);
  assert.match(migration, /on delete restrict/);
  assert.match(migration, /smyl_can_access_patient/);
  assert.match(migration, /clinical\.write/);
  assert.doesNotMatch(migration, /delete from public\.smyl_evidence_category/);
});

test('Evidencia es archivo y Valoración sólo consulta', () => {
  assert.match(center, /ARCHIVO CLÍNICO/);
  assert.match(center, /Evidencia del paciente/);
  assert.match(integration, /Los originales se cargan y clasifican en Evidencia\. Aquí sólo se consultan/);
  assert.match(integration, /seci-valuation-item/);
});

test('web y móvil comparten el mismo servicio de categorías', () => {
  assert.equal(serviceSource, read('../mobile/www/smyl-evidence-categories.js'));
  assert.match(read('../app.html'), /smyl-evidence-categories\.js\?v=1/);
  assert.match(read('../sw.js'), /smyl-evidence-categories\.js\?v=1/);
});
