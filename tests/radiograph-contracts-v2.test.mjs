// Contratos radiográficos v2: el validador del navegador (smyl-radiograph-contracts.js) y el de
// Edge Functions (_shared/radiograph-contracts.ts) deben dar el mismo veredicto sobre los
// vectores canónicos de tests/fixtures/radiograph-contracts. La prueba PGlite repite los
// mismos vectores contra los validadores SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const vectors = name => JSON.parse(read(`tests/fixtures/radiograph-contracts/${name}.json`));
const browser = require('../smyl-radiograph-contracts.js');
const tsSource = stripTypeScriptTypes(read('supabase/functions/_shared/radiograph-contracts.ts'), { mode: 'strip' });
const server = await import('data:text/javascript;base64,' + Buffer.from(tsSource).toString('base64'));

const outcome = fn => value => { try { fn(value); return 'valid'; } catch (e) { return e.message; } };
const suites = [
  ['qc', outcome(browser.parseQc), outcome(server.parseRadiographQc)],
  ['toothSet', outcome(browser.parseToothSet), outcome(server.parseToothCandidateSet)],
  ['findingSet', outcome(browser.parseFindingSet), outcome(server.parseFindingCandidateSet)],
  ['report', outcome(v => browser.parseReport(v, false)), outcome(v => server.parseRadiographReport(v, false))]
];

for (const [name, web, edge] of suites) {
  const { valid, invalid } = vectors(name);
  test(`${name}: todos los vectores válidos pasan en navegador y servidor`, () => {
    assert.ok(valid.length >= 3);
    for (const { name: label, value } of valid) {
      assert.equal(web(value), 'valid', `navegador rechazó "${label}"`);
      assert.equal(edge(value), 'valid', `servidor rechazó "${label}"`);
    }
  });
  test(`${name}: todos los vectores inválidos se rechazan con el mismo mensaje`, () => {
    assert.ok(invalid.length >= 8);
    for (const { name: label, value } of invalid) {
      const a = web(value), b = edge(value);
      assert.notEqual(a, 'valid', `navegador aceptó "${label}"`);
      assert.equal(a, b, `veredicto distinto para "${label}"`);
    }
  });
}

test('el informe con descripción vacía sólo es válido como borrador', () => {
  const { strictOnly } = vectors('report');
  for (const { value } of strictOnly) {
    assert.equal(browser.validateReportDraft(value).ok, true);
    assert.equal(browser.validateReportForSignature(value).ok, false);
    assert.throws(() => server.parseRadiographReport(value, true), /antes de firmar/);
  }
});

test('las enumeraciones cerradas coinciden entre navegador y servidor', () => {
  for (const key of ['STUDY_CLASSES', 'QUALITY_STATES', 'QC_FLAG_CODES', 'SEVERITIES', 'ANALYSES', 'VISIBILITIES', 'FINDING_CATEGORIES', 'EVIDENCE_LEVELS', 'DECISION_STATES', 'REPORT_PRIORITIES', 'REPORT_SECTIONS']) {
    assert.deepEqual([...browser[key]], [...server[key]], key);
  }
  assert.equal(browser.CONTRACT_VERSION, server.RADIOGRAPH_CONTRACT_VERSION);
  assert.deepEqual(browser.EVIDENCE_LEVELS, ['model_candidate'], 'el modelo sólo puede emitir candidatos');
});

test('la salida validada es una copia: mutarla no altera el original del modelo', () => {
  const original = vectors('qc').valid[0].value;
  const parsed = browser.parseQc(original);
  parsed.quality.status = 'usable';
  assert.equal(original.quality.status, 'limited');
});

test('decisiones: pendiente -> confirmar | corregir | descartar; sólo la corrección lleva datos', () => {
  assert.equal(browser.canTransition('pending', 'confirmed'), true);
  assert.equal(browser.canTransition('confirmed', 'rejected'), true);
  assert.equal(browser.canTransition('pending', 'pending'), false);
  assert.deepEqual(browser.parseDecisionPayload('confirmed', {}), {});
  assert.throws(() => browser.parseDecisionPayload('confirmed', { fdi: '36' }), /Sólo una corrección/);
  assert.throws(() => browser.parseDecisionPayload('corrected', {}), /Corrección no válida/);
  assert.throws(() => browser.parseDecisionPayload('corrected', { fdi: '99' }), /Corrección no válida/);
  assert.deepEqual(browser.parseDecisionPayload('corrected', { fdi: '37', label: 'Pieza renumerada' }), { fdi: '37', label: 'Pieza renumerada' });
  for (const [state, payload] of [['confirmed', {}], ['confirmed', null], ['corrected', { fdi: '37' }], ['corrected', { visibility: 'not_evaluable' }], ['corrected', { visibility: 'hidden' }], ['corrected', {}], ['rejected', { fdi: '1' }], ['pending', {}]]) {
    const a = (() => { try { return JSON.stringify(browser.parseDecisionPayload(state, payload)); } catch (e) { return e.message; } })();
    const b = (() => { try { return JSON.stringify(server.parseDecisionPayload(state, payload)); } catch (e) { return e.message; } })();
    assert.equal(a, b, `${state} ${JSON.stringify(payload)}`);
  }
});

test('el texto del modelo no puede presentarse como diagnóstico', () => {
  for (const claim of ['Diagnóstico de caries', 'caries confirmada', 'lesión definitiva', 'with certainty: definite lesion']) {
    assert.equal(browser.hasForbiddenClaim(claim), true, claim);
    assert.equal(server.hasForbiddenClaim(claim), true, claim);
  }
  assert.equal(browser.hasForbiddenClaim('Patrón radiopaco aparente que requiere comprobación profesional.'), false);
});
