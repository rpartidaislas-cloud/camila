import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../smyl-evidence-model.js');
const UUID_A = '11111111-1111-4111-8111-111111111111';

test('el contrato publica seis modalidades cerradas con subtipos propios', () => {
  assert.deepEqual(model.MODALITIES, [
    'photograph',
    'radiograph_2d',
    'scan_model',
    'clinical_measurement',
    'document',
    'cbct_3d'
  ]);
  for (const modality of model.MODALITIES) {
    assert.ok(Array.isArray(model.SUBTYPES[modality]), modality);
    assert.ok(model.SUBTYPES[modality].length >= 4, modality);
    assert.equal(new Set(model.SUBTYPES[modality]).size, model.SUBTYPES[modality].length, modality);
  }
  assert.equal(model.isSubtypeAllowed('radiograph_2d', 'bitewing'), true);
  assert.equal(model.isSubtypeAllowed('photograph', 'bitewing'), false);
});

test('un estudio nuevo empieza pendiente y conserva contexto especializado separado', () => {
  const draft = model.createStudyDraft('radiograph_2d', 'periapical');
  assert.equal(draft.schema, model.SCHEMA_VERSION);
  assert.equal(draft.quality.status, 'pending');
  assert.deepEqual(draft.quality.flags, []);
  assert.deepEqual(draft.region, {});
  assert.deepEqual(draft.metadata, {});
  assert.throws(() => model.createStudyDraft('photograph', 'periapical'), /no corresponde/);

  draft.clinicalIndication = 'Valorar la pieza 36 tras exploración clínica.';
  draft.acquiredAt = '2026-11-08T12:00:00-06:00';
  draft.region = { teeth: ['36'] };
  draft.metadata = { projection: 'periapical' };
  assert.equal(model.validateStudyDraft(draft).ok, true);
});

test('los vínculos anatómicos distinguen boca, región, pieza y superficie', () => {
  assert.deepEqual(model.parseAnatomyLink({ scope: 'whole_mouth' }), {
    scope: 'whole_mouth', fdi: null, surface: null, regionCode: '', geometry: null
  });
  assert.equal(model.validateAnatomyLink({ scope: 'tooth', fdi: '36' }).ok, true);
  assert.equal(model.validateAnatomyLink({ scope: 'surface', fdi: '36', surface: 'O' }).ok, true);
  assert.equal(model.validateAnatomyLink({ scope: 'surface', fdi: '36', surface: 'X' }).ok, false);
  assert.equal(model.validateAnatomyLink({ scope: 'surface', fdi: '99', surface: 'O' }).ok, false);
  assert.equal(model.validateAnatomyLink({ scope: 'tooth', fdi: '36', surface: 'M' }).ok, false);
  assert.equal(model.validateAnatomyLink({ scope: 'arch', regionCode: 'maxilla' }).ok, true);
  assert.equal(model.validateAnatomyLink({ scope: 'arch' }).ok, false);
});

test('la IA siempre produce un candidato pendiente y nunca una confirmación', () => {
  const base = {
    origin: 'ai',
    category: 'caries_candidate',
    evidenceLevel: 'model_candidate',
    label: 'Zona radiolúcida aparente',
    description: 'Requiere correlación clínica.',
    anatomy: { scope: 'surface', fdi: '36', surface: 'D' },
    confidence: 0.72,
    model: { provider: 'example', name: 'evidence-review-v1' },
    payload: {}
  };
  const parsed = model.parseFindingDraft(base);
  assert.equal(parsed.initialState, 'pending');
  assert.equal(parsed.confidence, 0.72);
  assert.equal(model.validateFindingDraft({ ...base, initialState: 'confirmed' }).ok, false);
  assert.equal(model.validateFindingDraft({ ...base, confidence: null }).ok, false);
  assert.equal(model.validateFindingDraft({ ...base, model: null }).ok, false);
});

test('la observación profesional no recibe probabilidad de modelo', () => {
  const finding = model.parseFindingDraft({
    origin: 'professional',
    category: 'restoration',
    evidenceLevel: 'clinical_observation',
    label: 'Restauración oclusal existente',
    description: '',
    anatomy: { scope: 'surface', fdi: '16', surface: 'O' },
    payload: { material: 'composite' }
  });
  assert.equal(finding.initialState, 'confirmed');
  assert.equal(finding.confidence, null);
  assert.equal(model.validateFindingDraft({ ...finding, confidence: 0.8 }).ok, false);
});

test('confirmar, corregir y descartar son decisiones profesionales explícitas', () => {
  assert.deepEqual(model.parseDecision('confirmed', null, 'Correlacionado clínicamente.'), {
    state: 'confirmed', correction: {}, note: 'Correlacionado clínicamente.'
  });
  assert.equal(model.parseDecision('corrected', { fdi: '37' }, '').state, 'corrected');
  assert.throws(() => model.parseDecision('corrected', {}, ''), /Describe la corrección/);
  assert.throws(() => model.parseDecision('confirmed', { fdi: '37' }, ''), /Sólo una corrección/);
  assert.throws(() => model.parseDecision('pending', {}, ''), /no es válida/);
});

test('un informe puede ser borrador vacío pero requiere resumen para firma', () => {
  const report = {
    schema: model.SCHEMA_VERSION,
    summary: '',
    technicalLimitations: '',
    clinicalCorrelation: '',
    recommendations: '',
    findingIds: [UUID_A]
  };
  assert.equal(model.validateReportDraft(report).ok, true);
  assert.equal(model.validateReportForSignature(report).ok, false);
  assert.equal(model.validateReportForSignature({ ...report, summary: 'Interpretación profesional.' }).ok, true);
  assert.equal(model.validateReportDraft({ ...report, findingIds: [UUID_A, UUID_A] }).ok, false);
});

test('las salidas validadas son copias y no alteran el original', () => {
  const draft = model.createStudyDraft('scan_model', 'arch_upper');
  draft.metadata = { format: 'stl' };
  const parsed = model.parseStudyDraft(draft);
  parsed.metadata.format = 'obj';
  assert.equal(draft.metadata.format, 'stl');
});
