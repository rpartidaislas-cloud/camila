import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../smyl-evidence-center-integration.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../smyl-evidence-center-integration.css', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('./fixtures/smyl-evidence-center-integration-preview.html', import.meta.url), 'utf8');

function api(windowOverrides = {}) {
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { className: '', dataset: {}, append() {}, prepend() {}, setAttribute() {}, addEventListener() {} }; }
  };
  const window = { document, ...windowOverrides };
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

test('un original radiográfico indexado no aparece otra vez como archivo genérico', () => {
  const integration = api({
    SmylPatientEvidenceFiles: {
      all() {
        return {
          items: [
            { id: 'file-rx-1', category: 'radiograph', name: 'Panorámica original.png' },
            { id: 'file-consent-1', category: 'consent', name: 'Consentimiento.pdf' }
          ]
        };
      }
    },
    SmylCaseWorkspace: { context() { return { caseId: 'case-1' }; } },
    SmylDentalProgress: {
      status() {
        return {
          studyItems: [{
            id: 'study-rx-1',
            type: 'panoramic',
            label: 'Panorámica',
            original: { patientFileId: 'file-rx-1' }
          }]
        };
      }
    }
  });

  const items = integration.collectEvidence('tenant-1', 'patient-1', []);
  assert.equal(items.filter(item => item.modality === 'radiograph_2d').length, 1);
  assert.equal(items.find(item => item.modality === 'radiograph_2d')?.source, 'dental_record');
  assert.ok(items.some(item => item.id === 'file-consent-1'), 'los demás archivos clínicos deben conservarse');
});

test('deduplica con la forma compacta que entrega DentalProgress en producción', () => {
  const integration = api({
    SmylPatientEvidenceFiles: {
      all() {
        return { items: [{
          id: 'file-rx-compact',
          category: 'radiograph',
          name: 'Panorámica compacta.png',
          sha256: 'abc123',
          storagePath: 'tenant/patient/study/abc123.png'
        }] };
      }
    },
    SmylCaseWorkspace: { context() { return { caseId: 'case-compact' }; } },
    SmylDentalProgress: {
      status() {
        return { studyItems: [{
          id: 'study-compact',
          type: 'panoramic',
          patientFileId: 'file-rx-compact',
          sha256: 'abc123',
          storagePath: 'tenant/patient/study/abc123.png'
        }] };
      }
    }
  });

  const items = integration.collectEvidence('tenant-1', 'patient-1', []);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'dental_record');
  assert.ok(items[0].aliases.some(alias => alias.source === 'patient_file' && alias.id === 'file-rx-compact'));
});

test('no fusiona estudios de modalidades distintas aunque sus IDs coincidan', () => {
  const integration = api({
    SmylPatientEvidenceFiles: { all() { return { items: [] }; } },
    SmylCaseWorkspace: { context() { return { caseId: 'case-collision' }; } },
    SmylDentalProgress: {
      status() {
        return { studyItems: [{ id: 'shared-id', type: 'panoramic', label: 'Panorámica' }] };
      }
    }
  });

  const items = integration.collectEvidence('tenant-1', 'patient-1', [{
    id: 'shared-id',
    subtype: 'frontal_smile',
    display_name: 'Sonrisa frontal'
  }]);
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, item => item.modality).sort(), ['photograph', 'radiograph_2d']);
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

test('las categorías se aplican por origen sin alterar la modalidad técnica', () => {
  const integration = api();
  const items = [{id:'r1',source:'dental_record',modality:'radiograph_2d',subtype:'panoramic'}];
  const state = {categorySnapshot:{assignments:[{sourceType:'dental_record',sourceId:'r1',categoryId:'cat-1',active:true}]}};
  const [classified] = integration.applyCategoryAssignments(state, items);
  assert.deepEqual(Array.from(classified.categoryIds), ['cat-1']);
  assert.equal(classified.modality, 'radiograph_2d');
  assert.equal(integration.assignmentKey('dental_record','r1'), 'dental_record:r1');
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

test('Subir radiografía abre el editor por una API directa y no por el CTA genérico', () => {
  const routeStart = source.indexOf('function routeRadiograph');
  const routeEnd = source.indexOf('async function routeDraft', routeStart);
  assert.ok(routeStart > -1 && routeEnd > routeStart, 'debe existir la ruta de radiografía');
  const route = source.slice(routeStart, routeEnd);

  assert.match(route, /SmylCaseWorkspace\?\.openRadiographIntake\?\.\(/);
  assert.doesNotMatch(route, /\.cw-evaluation-cta/);
  assert.doesNotMatch(route, /requestAnimationFrame/);
  assert.match(route, /prefillRadiograph/);
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
  assert.match(styles, /\.sec-category\[data-available=(?:"false"|false)\]/);
});

test('sólo oculta el listado legado después de montar el centro', () => {
  const mountIndex = source.indexOf('global.SmylEvidenceCenter.mount');
  const hideIndex = source.indexOf('legacy.hidden = true');
  assert.ok(mountIndex > -1 && hideIndex > mountIndex);
  assert.match(source, /if \(state\.legacy\?\.isConnected\) state\.legacy\.hidden = false/);
});

test('Revisión profesional usa el centro canónico sin duplicar un segundo resumen', () => {
  assert.match(styles, /@media\(max-width:600px\)/);
  assert.match(styles, /overflow-x:auto/);
  const valuationStart = source.indexOf('function renderValuationArchive');
  const valuationEnd = source.indexOf('\n  function ', valuationStart + 1);
  const valuation = source.slice(valuationStart, valuationEnd);
  assert.match(valuation, /host\.replaceChildren\(\)/);
  assert.match(valuation, /host\.hidden = true/);
  assert.doesNotMatch(valuation, /openAdd/);
  assert.doesNotMatch(valuation, /Ver archivos cl[ií]nicos/);
  assert.doesNotMatch(valuation, /slice\(0,\s*3\)\.forEach/, 'no debe reconstruir una segunda lista de archivos dentro de Revisión');
  assert.ok(source.indexOf('centerHost, pathways') > -1);
  assert.match(fixture, /smyl-evidence-center-integration\.js/);
  assert.match(fixture, /class="cw-evidence-history"/);
});
