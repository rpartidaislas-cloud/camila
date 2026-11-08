import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../smyl-evidence-center-integration.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../smyl-evidence-center-integration.css', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./fixtures/smyl-evidence-center-integration-preview.html', import.meta.url), 'utf8');

function api() {
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { className: '', dataset: {}, append() {}, prepend() {}, setAttribute() {}, addEventListener() {} }; }
  };
  const window = { document };
  const context = { window, document, MutationObserver: class {}, addEventListener() {}, setInterval() {}, clearInterval() {}, console };
  vm.runInNewContext(source, context, { filename: 'smyl-evidence-center-integration.js' });
  return context.window.SmylEvidenceCenterIntegration;
}

test('mapea archivos heredados a modalidades canónicas sin llamarlos interpretación', () => {
  const integration = api();
  assert.equal(integration.legacyFileItem({ id: 'a', category: 'clinical_photo', name: 'Frontal.jpg' }).modality, 'photograph');
  assert.equal(integration.legacyFileItem({ id: 'b', category: 'laboratory', name: 'Lab.pdf' }).subtype, 'laboratory_report');
  assert.equal(integration.legacyFileItem({ id: 'c', category: 'consent', name: 'Firma.pdf' }).status, 'draft');
});

test('mapea radiografías existentes sin inventar firma profesional', () => {
  const integration = api();
  const pending = integration.radiographItem({ id: 'r1', type: 'bitewing', pending: 2, confirmed: 1 });
  assert.equal(pending.modality, 'radiograph_2d');
  assert.equal(pending.subtype, 'bitewing');
  assert.equal(pending.status, 'review');
  assert.equal(pending.findings, 3);
  assert.equal(integration.radiographItem({ id: 'r2', type: 'occlusal' }).subtype, 'other');
});

test('conserva el origen aunque el componente visual normalice el elemento', () => {
  const integration = api();
  const raw = integration.legacyFileItem({ id: 'file-1', category: 'clinical_photo', name: 'Frontal.jpg' });
  const origins = integration.originMap([raw]);
  const normalizedByView = {
    id: raw.id,
    modality: raw.modality,
    subtype: raw.subtype,
    title: raw.title,
    status: raw.status
  };
  const origin = origins.get(integration.itemKey(normalizedByView));
  assert.equal(origin.id, 'file-1');
  assert.equal(origin.source, 'patient_file');
});

test('las seis rutas clínicas calculan fuentes disponibles sin prescribir estudios', () => {
  const integration = api();
  assert.deepEqual(Array.from(integration.pathways, pathway => pathway.id), ['restorative', 'endodontic', 'periodontal', 'orthodontic', 'surgery', 'pathology']);
  const endo = integration.pathways.find(pathway => pathway.id === 'endodontic');
  const state = integration.pathwayState([
    { modality: 'clinical_measurement', subtype: 'pulp_test' },
    { modality: 'radiograph_2d', subtype: 'periapical' }
  ], endo);
  assert.equal(state.available, state.total);
  assert.match(source, /SMYL no indica tomar imágenes de rutina/);
  assert.doesNotMatch(source, /debes tomar|obligatorio tomar|diagnóstico automático/i);
});

test('la integración conserva una única fuente de verdad y no guarda por su cuenta', () => {
  assert.match(source, /SmylPatientEvidenceFiles\?\.all/);
  assert.match(source, /SmylPatient360\?\.files/);
  assert.match(source, /SmylDentalProgress\?\.status/);
  assert.match(source, /SmylPatientFiles\?\.add/);
  assert.match(source, /SmylDentalProgress\?\.openStudy/);
  assert.match(source, /todavía no se ha guardado/);
  assert.match(source, /No se guardó ningún dato/);
  assert.doesNotMatch(source, /\.from\(|\.rpc\(|storage\.from/);
});

test('la ruta real de Rayos X no degrada silenciosamente subtipos ni acepta TIFF', () => {
  assert.match(source, /TYPE_CAPABILITIES/);
  assert.match(source, /typeAvailability:/);
  assert.match(source, /periapical: true/);
  assert.match(source, /bitewing: true/);
  assert.match(source, /panoramic: true/);
  assert.doesNotMatch(readFileSync(new URL('../smyl-evidence-center.js', import.meta.url), 'utf8'), /image\/tiff/);
});

test('las modalidades sin infraestructura no fallan al final del formulario', () => {
  const integration = api();
  assert.equal(integration.creationAvailability.photograph.enabled, true);
  assert.equal(integration.creationAvailability.radiograph_2d.enabled, true);
  assert.equal(integration.creationAvailability.document.enabled, true);
  assert.equal(integration.creationAvailability.scan_model.enabled, false);
  assert.match(integration.creationAvailability.cbct_3d.label, /DICOM/);
  assert.match(source, /creationAvailability:/);
});

test('bloquea antes del formulario las modalidades que aún no tienen editor real', () => {
  const integration = api();
  assert.equal(integration.creationCapability('photograph').enabled, true);
  assert.equal(integration.creationCapability('radiograph_2d').enabled, true);
  assert.equal(integration.creationCapability('document').enabled, true);
  for (const modality of ['scan_model', 'clinical_measurement', 'cbct_3d']) {
    const capability = integration.creationCapability(modality);
    assert.equal(capability.enabled, false);
    assert.match(capability.reason, /no se guardar[aá] ningún dato/i);
  }
  assert.match(source, /sec-category\[data-available="false"\]/);
  assert.match(styles, /\.sec-category\[data-available="false"\]/);
});

test('sólo oculta el listado legado después de montar el centro', () => {
  const mountIndex = source.indexOf('global.SmylEvidenceCenter.mount');
  const hideIndex = source.indexOf('legacy.hidden = true');
  assert.ok(mountIndex > -1 && hideIndex > mountIndex);
  assert.match(source, /if \(state\.legacy\?\.isConnected\) state\.legacy\.hidden = false/);
});

test('el diseño mantiene rutas compactas y adaptables', () => {
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.match(styles, /overflow-x:auto/);
  assert.match(styles, /min-height:44px/);
  assert.match(fixture, /smyl-evidence-center-integration\.js/);
  assert.match(fixture, /class="cw-evidence-history"/);
});
