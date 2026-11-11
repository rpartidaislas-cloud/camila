import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const require = createRequire(import.meta.url);
const Service = require('../smyl-clinical-photo-service.js');

const T = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const A = '44444444-4444-4444-8444-444444444444';
const F = '55555555-5555-4555-8555-555555555555';
const H = '66666666-6666-4666-8666-666666666666';
const R = '77777777-7777-4777-8777-777777777777';

class Query {
  constructor(rows) { this.rows = rows.map(row => ({ ...row })); this.filters = []; }
  select() { return this; }
  eq(key, value) { this.filters.push(row => row[key] === value); return this; }
  neq(key, value) { this.filters.push(row => row[key] !== value); return this; }
  in(key, values) { this.filters.push(row => values.includes(row[key])); return this; }
  order() { return this; }
  then(resolve, reject) {
    try { return Promise.resolve(resolve({ data: this.rows.filter(row => this.filters.every(filter => filter(row))), error: null })); }
    catch (error) { return Promise.reject(error).catch(reject); }
  }
}

function fakeClient(tables = {}, rpcImpl = async () => ({ data: null, error: null }), blob = null) {
  return {
    from(name) { return new Query(tables[name] || []); },
    rpc: rpcImpl,
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt', user: { id: T, is_anonymous: false } } }, error: null }) },
    storage: { from: name => ({ download: async path => name === 'smyl-clinical-files' && path ? { data: blob, error: null } : { data: null, error: new Error('missing') } }) }
  };
}

test('canonical taxonomy includes professional intraoral views', () => {
  assert.equal(Service.label('intraoral_frontal'), 'Intraoral frontal');
  assert.equal(Service.family('occlusal_upper'), 'intraoral');
  assert.equal(Service.family('localized'), 'intraoral');
  assert.equal(Service.isSubtype('occlusal_lower'), true);
  assert.equal(Service.isSubtype('intraoralOcclusalLower'), false);
  assert.deepEqual(Service.normalizeRegion('upper_arch'), { scope: 'arch', regionCode: 'upper_arch' });
});

test('indexes a verified patient file without uploading or copying it', async () => {
  const calls = [];
  const client = fakeClient({}, async (name, args) => {
    calls.push([name, args]);
    return { data: { id: args.p_study_id, patient_id: args.p_patient_id, subtype: args.p_subtype }, error: null };
  });
  const api = Service.create(client);
  const saved = await api.indexPatientFile({ tenant: T, patient: P, payload: {
    studyId: S, assetId: A, subtype: 'occlusal_upper', title: 'Oclusal superior', date: '2026-11-10', region: 'upper_arch'
  }, row: {
    id: F, tenant_id: T, patient_id: P, category: 'clinical_photo', status: 'active', mime_type: 'image/jpeg',
    size_bytes: 1024, sha256: 'a'.repeat(64), display_name: 'oclusal.jpg'
  }});
  assert.equal(saved.id, S);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'smyl_evidence_register_photo_file');
  assert.equal(calls[0][1].p_patient_file_id, F);
  assert.equal(calls[0][1].p_subtype, 'occlusal_upper');
  assert.deepEqual(calls[0][1].p_region, { scope: 'arch', regionCode: 'upper_arch' });
  assert.equal(Object.hasOwn(calls[0][1].p_metadata.original, 'storagePath'), false);
});

test('rejects an unverified or non-clinical original before any RPC', async () => {
  let calls = 0;
  const api = Service.create(fakeClient({}, async () => { calls += 1; return { data: null, error: null }; }));
  await assert.rejects(() => api.indexPatientFile({ subtype: 'intraoral_frontal' }, {
    id: F, patient_id: P, category: 'other', status: 'active', mime_type: 'image/jpeg', size_bytes: 10, sha256: 'a'.repeat(64)
  }), error => error.code === 'invalid_original');
  assert.equal(calls, 0);
});

test('lists studies with latest professional decision and a clear workflow state', async () => {
  const tables = {
    smyl_clinical_evidence_studies: [{ id: S, tenant_id: T, patient_id: P, modality: 'photograph', subtype: 'intraoral_right', status: 'under_review', quality: { status: 'limited' }, metadata: { analysis: { completed: true } }, acquired_at: '2026-11-10T12:00:00Z', created_at: '2026-11-10T12:00:00Z' }],
    smyl_clinical_evidence_assets: [{ id: A, tenant_id: T, patient_id: P, study_id: S, patient_file_id: F, asset_role: 'original' }],
    smyl_patient_files: [{ id: F, tenant_id: T, patient_id: P, category: 'clinical_photo', status: 'active', display_name: 'derecha.jpg', storage_path: `${T}/${P}/${F}/derecha.jpg`, mime_type: 'image/jpeg', size_bytes: 3, sha256: 'a'.repeat(64) }],
    smyl_clinical_evidence_findings: [{ id: H, tenant_id: T, patient_id: P, study_id: S, origin: 'ai', label: 'Cambio de color aparente', created_at: '2026-11-10T12:02:00Z' }],
    smyl_clinical_evidence_decisions: [{ id: crypto.randomUUID(), tenant_id: T, patient_id: P, study_id: S, finding_id: H, revision: 1, state: 'confirmed' }]
  };
  const data = await Service.create(fakeClient(tables)).list(T, P);
  assert.equal(data.available, true);
  assert.equal(data.studies.length, 1);
  assert.equal(data.studies[0].viewLabel, 'Lateral intraoral derecha');
  assert.equal(data.studies[0].confirmed, 1);
  assert.equal(data.studies[0].pending, 0);
  assert.equal(data.studies[0].reviewState, 'reviewed');
  assert.equal(data.studies[0].original.storage_path.endsWith('/derecha.jpg'), true);
});

test('uses the latest auditable study disposition as the workflow state', async () => {
  const tables = {
    smyl_clinical_evidence_studies: [{ id: S, tenant_id: T, patient_id: P, modality: 'photograph', subtype: 'intraoral_frontal', status: 'under_review', quality: { status: 'unusable' }, metadata: {}, created_at: '2026-11-10T12:00:00Z' }],
    smyl_clinical_evidence_assets: [{ id: A, tenant_id: T, patient_id: P, study_id: S, patient_file_id: F, asset_role: 'original' }],
    smyl_patient_files: [{ id: F, tenant_id: T, patient_id: P, category: 'clinical_photo', status: 'active', display_name: 'frontal.jpg', storage_path: `${T}/${P}/${F}/frontal.jpg`, mime_type: 'image/jpeg', size_bytes: 3, sha256: 'a'.repeat(64) }],
    smyl_clinical_photo_study_reviews: [
      { id: crypto.randomUUID(), tenant_id: T, patient_id: P, study_id: S, revision: 1, state: 'manual_only', reason: 'professional_manual_review' },
      { id: R, tenant_id: T, patient_id: P, study_id: S, revision: 2, state: 'not_evaluable', reason: 'focus_insufficient', note: 'Desenfoque en la zona anterior.' }
    ]
  };
  const data = await Service.create(fakeClient(tables)).list(T, P);
  assert.equal(data.studies[0].reviewState, 'not_evaluable');
  assert.equal(data.studies[0].disposition.id, R);
  assert.equal(data.studies[0].disposition.revision, 2);
});

test('records a disposition with optimistic revision and no inferred finding', async () => {
  const calls = [];
  const api = Service.create(fakeClient({}, async (name, args) => {
    calls.push([name, args]);
    return { data: { id: R, study_id: S, revision: 1, state: args.p_state, reason: args.p_reason }, error: null };
  }));
  const saved = await api.setDisposition({ studyId: S, expectedRevision: 0, state: 'not_evaluable', reason: 'orientation_uncertain', note: 'No es posible confirmar la orientación.' });
  assert.equal(saved.revision, 1);
  assert.equal(calls[0][0], 'smyl_evidence_set_photo_disposition');
  assert.equal(calls[0][1].p_expected_revision, 0);
  assert.equal(calls[0][1].p_reason, 'orientation_uncertain');
});

test('analyze sends only canonical study IDs and never image bytes', async () => {
  const api = Service.create(fakeClient(), { edgeUrl: 'https://example.supabase.co/functions/v1/claude', supabaseUrl: 'https://example.supabase.co', publicKey: 'publishable' });
  const previous = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, init) => {
    request = { ...init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ schema: 1, requestId: 'request-1', persisted: true, studies: [{ id: S, quality: 'usable', candidates: 2 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await api.analyze([S], { consent: true });
    assert.equal(response.studies[0].id, S);
    assert.deepEqual(request.body.studyIds, [S]);
    assert.equal(request.body.action, 'analyze_clinical_photos_v1');
    assert.equal(JSON.stringify(request.body).includes('base64'), false);
    assert.equal(request.headers.Authorization, 'Bearer jwt');
  } finally { globalThis.fetch = previous; }
});

test('downloads and verifies the exact private original', async () => {
  const bytes = new TextEncoder().encode('abc');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const client = fakeClient({}, async () => ({ data: null, error: null }), blob);
  const api = Service.create(client);
  const loaded = await api.loadOriginal({ id: S, tenant_id: T, patient_id: P, original: { id: F, tenant_id: T, patient_id: P, category: 'clinical_photo', status: 'active', storage_path: `${T}/${P}/${F}/photo.jpg`, mime_type: 'image/jpeg', size_bytes: blob.size, sha256: hash } });
  assert.equal(loaded.blob.size, 3);
  assert.equal(await loaded.blob.text(), 'abc');
  assert.equal(loaded.sha256, hash);
  loaded.revoke();
});

test('refuses a downloaded file whose digest changed', async () => {
  const blob = new Blob(['changed'], { type: 'image/jpeg' });
  const api = Service.create(fakeClient({}, async () => ({ data: null, error: null }), blob));
  await assert.rejects(() => api.loadOriginal({ id: S, tenant_id: T, patient_id: P, original: { id: F, tenant_id: T, patient_id: P, category: 'clinical_photo', status: 'active', storage_path: `${T}/${P}/${F}/photo.jpg`, mime_type: 'image/jpeg', size_bytes: blob.size, sha256: 'a'.repeat(64) } }), error => error.code === 'original_mismatch');
});

test('refuses to expose an original linked to a different patient', async () => {
  const blob = new Blob(['abc'], { type: 'image/jpeg' });
  const api = Service.create(fakeClient({}, async () => ({ data: null, error: null }), blob));
  await assert.rejects(() => api.loadOriginal({ id: S, tenant_id: T, patient_id: P, original: { id: F, tenant_id: T, patient_id: crypto.randomUUID(), category: 'clinical_photo', status: 'active', storage_path: `${T}/${P}/${F}/photo.jpg`, mime_type: 'image/jpeg', size_bytes: blob.size, sha256: createHash('sha256').update('abc').digest('hex') } }), error => error.code === 'invalid_original');
});
