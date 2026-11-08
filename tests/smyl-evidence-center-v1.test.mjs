import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const model = require('../smyl-evidence-model.js');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = read('../smyl-evidence-center.js');
const styles = read('../smyl-evidence-center.css');
const fixture = read('./fixtures/smyl-evidence-center-preview.html');

const context = { window: {} };
vm.runInNewContext(source, context, { filename: 'smyl-evidence-center.js' });
const api = context.window.SmylEvidenceCenter;
const categories = Array.from(api.categories);

test('el centro separa las seis modalidades sin convertirlas en una bolsa genérica', () => {
  assert.deepEqual(categories.map(item => item.id), [
    'photograph',
    'radiograph_2d',
    'scan_model',
    'clinical_measurement',
    'document',
    'cbct_3d'
  ]);
  for (const category of categories) {
    assert.ok(category.label.length > 2, category.id);
    assert.ok(category.description.length > 12, category.id);
    assert.ok(category.types.length >= 4, category.id);
    assert.equal(new Set(category.types.map(([id]) => id)).size, category.types.length, category.id);
  }
});

test('cada ID emitido por la interfaz pertenece al contrato clínico', () => {
  for (const category of categories) {
    assert.ok(model.MODALITIES.includes(category.id), `modalidad UI no canónica: ${category.id}`);
    for (const [subtype] of category.types) {
      assert.equal(model.isSubtypeAllowed(category.id, subtype), true, `${category.id}/${subtype}`);
    }
  }
});

test('Rayos X 2D ofrece estudios clínicos diferenciados', () => {
  const radiographs = categories.find(item => item.id === 'radiograph_2d');
  assert.deepEqual(Array.from(radiographs.types, ([id]) => id), [
    'periapical',
    'bitewing',
    'panoramic',
    'occlusal',
    'fmx',
    'cephalometric_lateral',
    'cephalometric_pa',
    'tmj_series',
    'other'
  ]);
  assert.match(radiographs.fileAccept, /image\/jpeg/);
  assert.match(radiographs.fileAccept, /image\/png/);
  assert.doesNotMatch(radiographs.fileAccept, /image\/tiff/);
});

test('la evidencia no radiográfica conserva fotos, modelos, evaluaciones e informes', () => {
  const byId = Object.fromEntries(categories.map(item => [item.id, item]));
  for (const type of ['face_smile', 'intraoral_frontal', 'occlusal_upper', 'before_after']) {
    assert.ok(byId.photograph.types.some(([id]) => id === type), type);
  }
  for (const type of ['arch_upper', 'arch_lower', 'bite', 'study_model']) {
    assert.ok(byId.scan_model.types.some(([id]) => id === type), type);
  }
  for (const type of ['periodontogram', 'pulp_test', 'soft_tissue_exam', 'tmj_exam', 'caries_risk']) {
    assert.ok(byId.clinical_measurement.types.some(([id]) => id === type), type);
  }
  for (const type of ['radiology_report', 'pathology_report', 'referral', 'consent']) {
    assert.ok(byId.document.types.some(([id]) => id === type), type);
  }
});

test('CBCT queda identificado como especializado y conserva DICOM', () => {
  const cbct = categories.find(item => item.id === 'cbct_3d');
  assert.equal(cbct.advanced, true);
  assert.match(cbct.fileAccept, /\.dcm/);
  assert.match(cbct.fileAccept, /application\/dicom/);
  assert.match(source, /requieren un visor especializado/);
  assert.match(source, /no lo convertirá en una imagen plana/);
});

test('agregar evidencia es progresivo y sólo crea un borrador', () => {
  assert.match(source, /PASO \$\{this\.step \+ 1\} DE 4/);
  assert.match(source, /this\.step = Math\.min\(3, this\.step \+ 1\)/);
  assert.match(source, /status: 'draft'/);
  assert.match(source, /Guardar crea un borrador/);
  assert.match(source, /Ninguna sugerencia se incorpora al odontograma hasta que un profesional la confirme/);
  assert.doesNotMatch(source, /status:\s*['"](?:confirmed|signed)['"]/);
});

test('el flujo conserva contexto mínimo sin inventar una interpretación', () => {
  for (const field of ['Fecha del estudio', 'Pieza, superficie o región', 'Nombre descriptivo']) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /El original no se modifica/);
  assert.match(source, /Sin región vinculada/);
  assert.doesNotMatch(source, /diagnóstico automático|confirmar automáticamente/i);
});

test('la navegación expone semántica y foco accesibles', () => {
  assert.match(source, /setAttribute\('role', 'tablist'\)/);
  assert.match(source, /setAttribute\('role', 'tab'\)/);
  assert.match(source, /setAttribute\('aria-selected'/);
  assert.match(source, /setAttribute\('aria-labelledby', 'sec-dialog-title'\)/);
  assert.match(source, /setAttribute\('aria-label', `Paso \$\{this\.step \+ 1\} de 4`\)/);
  assert.match(source, /this\.returnFocus\?\.focus\?\.\(\)/);
  assert.match(styles, /@media\s*\(max-width:\s*760px\)/);
  assert.match(styles, /min-height:\s*44px/);
});

test('el fixture demuestra categorías, estados y apertura del flujo', () => {
  assert.match(fixture, /id="evidence-center"/);
  assert.match(fixture, /SmylEvidenceCenter\.mount/);
  assert.match(fixture, /modality:'radiograph_2d'/);
  assert.match(fixture, /modality:'photograph'/);
  assert.match(fixture, /status:'signed'/);
  assert.match(fixture, /status:'review'/);
  assert.match(fixture, /Evidencia agregada como borrador para revisión profesional/);
});
