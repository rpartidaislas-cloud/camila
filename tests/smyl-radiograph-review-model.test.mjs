import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { default: model } = await import('../smyl-radiograph-review-model.js').then(module => ({ default: module.default || globalThis.SmylRadiographReviewModel }));
const api = model || globalThis.SmylRadiographReviewModel;
const study = { id: '11111111-1111-4111-8111-111111111111', type: 'panoramic', asset: { sha256: 'a'.repeat(64) } };
const report = {
  schema: 1,
  quality: 'limited',
  qualityNote: 'La imagen permite revisión con limitaciones.',
  observations: [
    { id: 'r1', category: 'density', tooth: '46', observation: 'Cambio de densidad por comprobar.', evidence: 'Zona radiolúcida delimitada.' },
    { id: 'r2', category: 'development', tooth: null, observation: 'Desarrollo dental por comprobar.', evidence: 'Estructura visible en región posterior.' }
  ],
  limitations: ['La superposición limita la lectura de la región anterior.']
};

const ready = api.create(study);
assert(api.validate(ready, study));
const requested = api.requested(ready);
assert(api.validate(requested, study));
const completed = api.completed(requested, { model: 'claude-sonnet-4-6', at: new Date().toISOString(), requestId: 'msg_test', report });
assert(api.validate(completed, study));
assert.equal(completed.items.length, 2);
assert(completed.items.every(item => item.state === 'pending' && item.x === null));

const confirmed = structuredClone(completed);
confirmed.items[0].text = 'Valoración confirmada por el dentista.';
confirmed.items[0].x = .45;
confirmed.items[0].y = .55;
confirmed.items[0].state = 'confirmed';
assert(api.validate(confirmed, study));
assert(!api.validate({ ...confirmed, unexpected: true }, study));

const unusable = structuredClone(report);
unusable.quality = 'unusable';
assert.throws(() => api.completed(requested, { model: 'claude-sonnet-4-6', at: new Date().toISOString(), requestId: '', report: unusable }), /no puede producir observaciones/);
assert.equal(ready.workflow.state, 'ready');
assert.equal(requested.workflow.state, 'requested');

console.log('Radiograph review model safety contracts passed');
