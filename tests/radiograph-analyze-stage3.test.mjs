// Radiografía asistida — Etapa 3: localización dental y odontograma asistido.
// Proveedor dental simulado (determinista, no inventa señales), radiograph-analyze (núcleo
// genérico con QC previo obligatorio) y el modelo v2 del navegador: el dentista puede corregir
// toda numeración, el original no cambia, cada corrección conserva autor/fecha/candidato/modelo,
// "no visible" nunca se convierte en "ausente" y sólo lo confirmado llega al odontograma.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smyl-radiograph-analyze-'));
for (const name of ['radiograph-contracts', 'radiograph-image', 'radiograph-provider', 'radiograph-qc-core']) {
  fs.writeFileSync(path.join(dir, `${name}.mjs`), stripTypeScriptTypes(read(`supabase/functions/_shared/${name}.ts`), { mode: 'strip' }).replace(/^import type .*$/gm, '').replace(/from '\.\/([\w-]+)\.ts'/g, "from './$1.mjs'"));
}
const load = name => import(pathToFileURL(path.join(dir, `${name}.mjs`)).href);
const contracts = await load('radiograph-contracts');
const image = await load('radiograph-image');
const providers = await load('radiograph-provider');
const core = await load('radiograph-qc-core');
const Model = require('../smyl-radiograph-review-model-v2.js');

const be32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const ascii = s => [...Buffer.from(s, 'latin1')];
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png({ width, height, hints = [] }) {
  const chunk = (type, data) => [...be32(data.length), ...ascii(type), ...data, ...be32(crc32([...ascii(type), ...data]))];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be32(width), ...be32(height), 8, 0, 0, 0, 0]),
    ...(hints.length ? chunk('tEXt', [...ascii('smyl.sim'), 0, ...ascii(hints.join(','))]) : []), ...chunk('IDAT', new Array(2048).fill(7)), ...chunk('IEND', [])]);
}
const SRC = '55555555-5555-4555-8555-555555555555';
const input = (w, h, hints = [], declared = 'panoramic') => ({ sourceId: SRC, sha256: 'ab'.repeat(32), mimeType: 'image/png', width: w, height: h, orientation: 1, studyTypeDeclared: declared, bytes: png({ width: w, height: h, hints }), hints });

test('el proveedor dental simulado emite piezas válidas por clase de estudio y nunca afirma ausencias', () => {
  const pan = contracts.parseToothCandidateSet(providers.simulateTeeth(input(2400, 1200)));
  assert.equal(pan.candidates.length, 32);
  assert.deepEqual(new Set(pan.candidates.map(c => c.fdiCandidate)).size, 32);
  assert.ok(pan.candidates.every(c => contracts.isFdi(c.fdiCandidate) && contracts.isGeometry(c.geometry, false)));
  assert.deepEqual(pan.candidates.filter(c => c.visibility === 'partial').map(c => c.fdiCandidate), ['18', '28', '48', '38']);
  assert.equal(contracts.parseToothCandidateSet(providers.simulateTeeth(input(900, 650))).candidates.length, 8, 'bitewing');
  assert.equal(contracts.parseToothCandidateSet(providers.simulateTeeth(input(600, 800, [], 'periapical'))).candidates.length, 3, 'periapical');
  const missing = providers.simulateTeeth(input(2400, 1200, ['missing:36', 'uncertain:46']));
  assert.equal(missing.candidates.find(c => c.fdiCandidate === '36'), undefined, 'una pieza no vista simplemente no se emite');
  assert.deepEqual(missing.candidates.find(c => c.fdiCandidate === '46').alternatives, [{ fdi: '47', probability: 0.35 }]);
  assert.equal(JSON.stringify(missing).includes('ausen'), false);
});

test('el proveedor dental simulado no inventa señales: sólo las pistas de prueba, siempre con región y limitaciones', () => {
  assert.deepEqual(contracts.parseFindingCandidateSet(providers.simulateFindings(input(2400, 1200))).candidates, []);
  const f = contracts.parseFindingCandidateSet(providers.simulateFindings(input(2400, 1200, ['finding:restoration@36', 'finding:apparently_missing@12', 'finding:caries@11'])));
  assert.deepEqual(f.candidates.map(c => [c.category, c.toothCandidate, c.evidenceLevel]), [['restoration', '36', 'model_candidate'], ['apparently_missing', '12', 'model_candidate']]);
  assert.ok(f.candidates.every(c => c.regions.length === 1 && c.limitations.length === 1 && !contracts.hasForbiddenClaim(c.label + c.explanation)));
});

// Dependencias falsas con la semántica del RPC: QC completado y aplicable es prerrequisito.
function harness({ bytes, qc = { status: 'usable', applicable: ['tooth_localization', 'finding_candidates'] }, dental = new providers.SimulatedDentalXrayProvider(), timeoutMs = 2000 }) {
  const runs = new Map(); const logs = []; let calls = 0;
  const wrapped = dental && { model: dental.model, localizeTeeth: (i, s) => { calls++; return dental.localizeTeeth(i, s); }, analyzeCandidates: (i, s) => { calls++; return dental.analyzeCandidates(i, s); } };
  const ready = image.sha256Hex(bytes);
  const deps = {
    requestRun: async (id, kind) => {
      if (id !== SRC) return { data: null, error: { code: '42501', message: 'La fuente radiográfica no está disponible.' } };
      if (!qc || qc.status === 'unusable' || !qc.applicable.includes(kind)) return { data: null, error: { code: '23514', message: 'El control de calidad no habilita este análisis para esta imagen.' } };
      const live = [...runs.values()].find(r => r.kind === kind && ['requested', 'completed'].includes(r.status));
      if (live) return { data: structuredClone(live), error: null };
      const run = { id: `run-${runs.size + 1}`, tenant_id: 't-a', patient_id: 'p-1', source_id: id, kind, status: 'requested', engine: { ...providers.SIMULATED_DENTAL_MODEL }, contract_version: 1, output: null, failure_code: '' };
      runs.set(run.id, run); return { data: structuredClone(run), error: null };
    },
    claimRun: async id => {
      const run = runs.get(id);
      if (!run) return { data: null, error: { code: '42501', message: 'Ejecución desconocida.' } };
      if (run.status !== 'requested' || run.claimed) return { data: null, error: { code: 'PT409', message: 'in_progress' } };
      run.claimed = true; return { data: structuredClone(run), error: null };
    },
    loadSource: async id => ({ id, tenant_id: 't-a', patient_id: 'p-1', bucket: 'smyl-radiographs', storage_path: 't-a/p-1/s/x.png', sha256: await ready, mime_type: 'image/png', size_bytes: bytes.length, study_type_declared: 'panoramic' }),
    download: async () => bytes,
    completeRun: async (id, status, output, failureCode) => { const run = runs.get(id); if (run.status !== 'requested') return { data: null, error: { code: '42501', message: 'inmutable' } }; Object.assign(run, { status, output, failure_code: failureCode }); return { data: structuredClone(run), error: null }; },
    provider: null, dentalProvider: wrapped, timeoutMs, log: e => logs.push(e),
  };
  return { deps, runs, logs, calls: () => calls, run: kind => core.runRadiographAnalysis(kind, { sourceId: SRC }, deps) };
}

test('radiograph-analyze: localización completa, candidatos con geometría normalizada y motor registrado', async () => {
  const h = harness({ bytes: png({ width: 2400, height: 1200, hints: ['uncertain:36'] }) });
  const r = await h.run('tooth_localization');
  assert.equal(r.status, 200);
  assert.equal(r.body.run.kind, 'tooth_localization');
  assert.equal(r.body.run.output.candidates.length, 32);
  assert.deepEqual(r.body.run.engine, providers.SIMULATED_DENTAL_MODEL);
  assert.equal((await h.run('tooth_localization')).body.reused, true);
  assert.equal(h.calls(), 1);
  const f = await h.run('finding_candidates');
  assert.equal(f.status, 200); assert.deepEqual(f.body.run.output.candidates, []);
  assert.deepEqual(h.logs.map(l => l.event), ['run_completed', 'run_reused', 'run_completed']);
});

test('sin QC aplicable (bloqueado o no utilizable) la base rechaza y el motor no se llama', async () => {
  for (const qc of [{ status: 'limited', applicable: ['tooth_localization'] }, { status: 'unusable', applicable: [] }, null]) {
    const h = harness({ bytes: png({ width: 2400, height: 1200 }), qc });
    const r = await h.run('finding_candidates');
    assert.equal(r.status, 409); assert.match(r.body.error, /control de calidad/); assert.equal(h.calls(), 0); assert.equal(h.runs.size, 0);
  }
});

test('respuesta malformada, timeout o fuente distinta cierran la ejecución sin guardar salida; sin motor → 503', async () => {
  const bad = harness({ bytes: png({ width: 2400, height: 1200, hints: ['malformed'] }) });
  assert.equal((await bad.run('tooth_localization')).body.code, 'invalid_output');
  const hang = harness({ bytes: png({ width: 2400, height: 1200, hints: ['hang'] }), timeoutMs: 25 });
  assert.equal((await hang.run('tooth_localization')).body.code, 'timeout');
  assert.deepEqual([...hang.runs.values()].map(r => [r.status, r.output]), [['unconfirmed', null]]);
  const foreign = { model: providers.SIMULATED_DENTAL_MODEL, localizeTeeth: async i => Object.assign(providers.simulateTeeth(i), { sourceId: '0b3a7b6e-3a0f-4b7e-9d7c-1f2e3d4c5b6a' }), analyzeCandidates: async () => null };
  const fr = await harness({ bytes: png({ width: 2400, height: 1200 }), dental: foreign }).run('tooth_localization');
  assert.equal(fr.status, 502); assert.match(fr.body.error, /no corresponde a la fuente/);
  const none = harness({ bytes: png({ width: 2400, height: 1200 }), dental: null });
  assert.equal((await none.run('tooth_localization')).status, 503); assert.equal(none.runs.size, 0);
  assert.equal((await none.run('qc')).status, 503, 'esta función no tiene proveedor de QC');
});

// --- modelo v2 del navegador ----------------------------------------------------------------
const cid = n => `c${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;
function rows() {
  const set = providers.simulateTeeth(input(2400, 1200, ['uncertain:36']));
  const candidates = set.candidates.slice(0, 6).map((c, i) => ({ id: cid(i + 1), tenant_id: 't', patient_id: 'p', source_id: SRC, run_id: 'run-1', kind: 'tooth', candidate_id: c.candidateId, payload: c }));
  candidates.push({ id: cid(90), tenant_id: 't', patient_id: 'p', source_id: SRC, run_id: 'run-2', kind: 'finding', candidate_id: 'f-1', payload: providers.simulateFindings(input(2400, 1200, ['finding:apparently_missing@12', 'finding:restoration@16'])).candidates[0] });
  candidates.push({ id: cid(91), tenant_id: 't', patient_id: 'p', source_id: SRC, run_id: 'run-2', kind: 'finding', candidate_id: 'f-2', payload: providers.simulateFindings(input(2400, 1200, ['finding:restoration@16'])).candidates[0] });
  const runs = [{ id: 'run-1', engine: providers.SIMULATED_DENTAL_MODEL }, { id: 'run-2', engine: providers.SIMULATED_DENTAL_MODEL }];
  return { candidates, runs };
}
const dec = (id, state, payload = {}, revision = 2) => ({ candidate_id: id, state, revision, payload, decided_by: 'dra-d', decided_at: '2026-10-28T10:00:00Z', note: '' });

test('toothMap: confianza calibrada, estado por pieza y candidato original intacto tras renumerar', () => {
  const base = rows();
  const map = Model.toothMap({ ...base, decisions: [dec(cid(1), 'corrected', { fdi: '17' }), dec(cid(2), 'confirmed'), dec(cid(3), 'rejected')] });
  assert.equal(map.total, 6); assert.equal(map.verified, 2); assert.equal(map.pending, 3);
  const e1 = map.entries[0];
  assert.deepEqual([e1.fdiModel, e1.fdi, e1.renumbered, e1.state, e1.band, e1.decidedBy, e1.engine.version], ['18', '17', true, 'corrected', 'alta', 'dra-d', '0.1.0']);
  assert.equal(base.candidates[0].payload.fdiCandidate, '18', 'el candidato original no cambia');
  assert.deepEqual(map.conflicts, [{ fdi: '17', candidateIds: [cid(1), cid(2)] }], 'dos candidatos vivos en la misma pieza se señalan');
  assert.equal(map.entries[2].state, 'rejected');
  assert.equal(map.entries[5].band, 'media', 'anterior 0.8 → media');
  assert.equal(Model.band(0.55), 'baja');
});

test('acciones profesionales: renumerar, marcar no evaluable, geometría; dividir/unir no está soportado', () => {
  const entry = Model.toothMap(rows()).entries[0];
  assert.deepEqual(Model.renumberPayload(entry, '17'), { fdi: '17' });
  assert.throws(() => Model.renumberPayload(entry, '18'), /ya tiene esa numeración/);
  assert.throws(() => Model.renumberPayload(entry, '99'), /FDI no válida/);
  assert.deepEqual(Model.notEvaluablePayload(entry, 'Superposición'), { visibility: 'not_evaluable', label: 'Superposición' });
  assert.deepEqual(Model.geometryPayload(entry, { kind: 'bbox', coordinateSpace: 'source-normalized', points: [[0.1, 0.1], [0.2, 0.2]] }).geometry.kind, 'bbox');
  assert.throws(() => Model.geometryPayload(entry, { kind: 'bbox', coordinateSpace: 'pixels', points: [] }), /Corrección no válida/);
  assert.throws(() => Model.splitOrMerge(), /no está soportado/);
});

test('odontograma: sólo confirmadas/corregidas producen evidencia; no evaluable no entra; "no visible" nunca es "ausente"', () => {
  const base = rows();
  const out = Model.odontogramEvidence({ ...base, decisions: [
    dec(cid(1), 'confirmed'), dec(cid(2), 'corrected', { fdi: '16' }), dec(cid(3), 'rejected'), dec(cid(4), 'corrected', { visibility: 'not_evaluable' }),
    dec(cid(90), 'confirmed'), dec(cid(91), 'rejected'),
  ] });
  assert.deepEqual(out.evidence.map(e => [e.source, e.tooth, e.state]), [['radiograph_v2_tooth', '18', 'confirmed'], ['radiograph_v2_tooth', '16', 'corrected'], ['radiograph_v2_finding', '12', 'confirmed']]);
  const missing = out.evidence[2];
  assert.equal(missing.neverAutoAbsent, true);
  assert.match(missing.text, /No implica ausencia: confirmar clínicamente/);
  assert.equal(out.pending, 2);
  assert.equal(JSON.stringify(out).includes('"status"'), false, 'nunca produce un estado de doc.teeth');
  assert.equal(Model.odontogramEvidence(base).evidence.length, 0, 'sin decisiones no hay evidencia');
  assert.equal(Model.toothMap({ candidates: [{ id: 'x', kind: 'tooth', payload: {} }], decisions: [] }).total, 0, 'filas fuera de forma se ignoran');
});

test('contrato estático: función dedicada, QC previo en la base, sin segment-teeth ni escritura automática del odontograma', () => {
  const index = read('supabase/functions/radiograph-analyze/index.ts');
  const model = read('smyl-radiograph-review-model-v2.js');
  assert.match(index, /requireUser\(req, CORS\)/);
  assert.match(index, /asUser\.rpc\('smyl_radiograph_request_ai_run', \{ p_source_id: sourceId, p_kind: kind/);
  assert.match(index, /kind !== 'tooth_localization' && kind !== 'finding_candidates'/);
  assert.doesNotMatch(index, /from ['"][^'"]*segment-teeth|createSignedUrl|body\.url|body\.path/);
  assert.doesNotMatch(model, /fetch\(|\.rpc\(|doc\.teeth\[[^\]]*\]\s*=|status:\s*'(pending|following|done)'|=\s*'ausente'/i, 'el modelo no escribe el odontograma ni usa red');
  const runs = read('supabase/migrations/20261028120000_smyl_radiograph_ai_runs.sql');
  assert.match(runs, /coalesce\(v_payload->>'visibility', ''\) not in \('complete','partial','not_evaluable'\)/);
  assert.match(read('sw.js'), /smyl-radiograph-review-model-v2\.js\?v=1/, 'el modelo v2 se publica con la mesa de revisión (Etapa 4)');
});

test('los bundles de un solo archivo están sincronizados con las funciones, sin imports locales y se pueden analizar', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const name of ['radiograph-qc', 'radiograph-analyze']) {
    const file = new URL(`../docs/bundles/${name}.single-file.ts`, import.meta.url);
    const before = fs.readFileSync(file, 'utf8');
    execFileSync('node', ['scripts/bundle-edge-function.mjs', name], { cwd: new URL('..', import.meta.url) });
    assert.equal(fs.readFileSync(file, 'utf8'), before, `${name}: regenera el bundle con scripts/bundle-edge-function.mjs`);
    assert.deepEqual(before.split('\n').filter(l => /^import\s/.test(l)), ['import { createClient } from "npm:@supabase/supabase-js@2";']);
    const { stripTypeScriptTypes } = await import('node:module');
    assert.doesNotThrow(() => stripTypeScriptTypes(before, { mode: 'strip' }));
  }
});
