// Finanzas: la llave de un cobro o cargo se conserva hasta conocer el resultado (auditoría 2026-11-26, P1 «idempotencia»).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../smyl-finance.js', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const block = ui.slice(ui.indexOf('// ── Intento de cobro o de cargo'), ui.indexOf('  async function rpc(n,a){'));
assert.ok(block.length > 800, 'no se encontró el bloque del intento');

function world(state, store = new Map()) {
  const windowStub = { sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } };
  let n = 0;
  const cryptoStub = { randomUUID: () => 'uuid-' + (++n) };
  const api = new Function('window', 'crypto', 'state', 'Date', 'q', block + ';return {attemptFingerprint,attemptOpen,attemptClose,attemptRead,isDefiniteError,similarRecentPayment,ATTEMPT_TTL,paymentStatus,checkPayment,paymentRequest,savedAttempt};');
  const clock = { now: 1_000_000 };
  const DateStub = Object.assign(function (...a) { return new Date(...a); }, { now: () => clock.now });
  DateStub.prototype = Date.prototype;
  windowStub.tenantId=state?.tenant;
  const q=async builder=>{const result=await builder;if(result.error)throw result.error;return result.data;};
  return { f: api(windowStub, cryptoStub, state || { payments: [] }, DateStub, q), store, clock, windowStub };
}

test('los mismos datos reutilizan la misma llave: un reintento tras perder la respuesta no duplica el cobro', () => {
  const { f } = world();
  const fp = f.attemptFingerprint(['p1', 'b1', 's1', 500, 'cash', '', [['c1', 300], ['c2', 200]]]);
  const first = f.attemptOpen('payment', fp), again = f.attemptOpen('payment', fp);
  assert.equal(first.reused, false); assert.equal(again.reused, true);
  assert.equal(again.id, first.id); assert.equal(again.key, first.key);
});

test('el orden de las aplicaciones no cambia la huella; cambiar importe, método, paciente o aplicación sí', () => {
  const { f } = world();
  const base = ['p1', 'b1', 's1', 500, 'cash', '', [['c1', 300], ['c2', 200]]];
  assert.equal(f.attemptFingerprint(base), f.attemptFingerprint(['p1', 'b1', 's1', 500, 'cash', '', [['c2', 200], ['c1', 300]]]));
  for (const changed of [['p2', 'b1', 's1', 500, 'cash', '', base[6]], ['p1', 'b1', 's1', 600, 'cash', '', base[6]], ['p1', 'b1', 's1', 500, 'card', '', base[6]], ['p1', 'b1', 's1', 500, 'cash', 'REF', base[6]], ['p1', 'b1', 's1', 500, 'cash', '', [['c1', 500]]]]) {
    assert.notEqual(f.attemptFingerprint(changed), f.attemptFingerprint(base));
  }
});

test('datos distintos obtienen una llave nueva (un cobro corregido es otro intento)', () => {
  const { f } = world();
  const a = f.attemptOpen('payment', f.attemptFingerprint(['p1', 500]));
  const b = f.attemptOpen('payment', f.attemptFingerprint(['p1', 450]));
  assert.equal(b.reused, false); assert.notEqual(b.key, a.key); assert.notEqual(b.id, a.id);
});

test('al conocer el resultado el intento se cierra y el siguiente cobro igual ya es otro', () => {
  const { f } = world();
  const fp = f.attemptFingerprint(['p1', 500]);
  const a = f.attemptOpen('payment', fp); f.attemptClose('payment');
  const b = f.attemptOpen('payment', fp);
  assert.equal(b.reused, false); assert.notEqual(b.key, a.key);
});

test('un pago pendiente conserva su llave después de 30 minutos; los cargos caducan aparte', () => {
  const { f, clock } = world();
  const fp = f.attemptFingerprint(['p1', 500]);
  const a = f.attemptOpen('payment', fp);
  const charge = f.attemptOpen('charge', fp);
  assert.notEqual(charge.key, a.key, 'cada tipo guarda su propio intento');
  clock.now += f.ATTEMPT_TTL + 1;
  assert.equal(f.attemptOpen('payment', fp).key, a.key);
  assert.equal(f.attemptOpen('charge', fp).reused, false);
});

test('sin almacenamiento de sesión conserva el intento en memoria', () => {
  const { f, windowStub } = world();
  windowStub.sessionStorage = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } };
  const a = f.attemptOpen('payment', 'x');
  assert.equal(a.reused, false); assert.ok(a.key);
  assert.doesNotThrow(() => f.attemptClose('payment'));
});

test('error del servidor = el movimiento NO se registró; red o tiempo agotado = incierto', () => {
  const { f } = world();
  for (const code of ['23514', '42501', 'P0002', '22023', '40001', 'PGRST116', 'PGRST301']) assert.equal(f.isDefiniteError({ code }), true, code);
  for (const e of [{ message: 'TypeError: Failed to fetch' }, { code: '', message: 'timeout' }, new Error('Tiempo agotado'), null, undefined, { code: 'ECONNRESET' }]) assert.equal(f.isDefiniteError(e), false, JSON.stringify(e));
});

test('pago igual reciente: mismo paciente, importe y forma en 10 minutos; con centavos y sin mezclar personas', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const state = { payments: [
    { id: 'a', patient_id: 'p1', method: 'cash', amount: 800, paid_at: '2026-11-27T11:55:00Z' },
    { id: 'b', patient_id: 'p1', method: 'cash', amount: 800, paid_at: '2026-11-27T11:30:00Z' },
    { id: 'c', patient_id: 'p2', method: 'cash', amount: 800, paid_at: '2026-11-27T11:58:00Z' },
    { id: 'd', patient_id: 'p1', method: 'card', amount: 800, paid_at: '2026-11-27T11:58:00Z' },
  ] };
  const { f } = world(state);
  const twin = f.similarRecentPayment('p1', 800, 'cash', now);
  assert.equal(twin.payment.id, 'a'); assert.equal(Math.round(twin.age / 60000), 5);
  assert.equal(f.similarRecentPayment('p1', 800.5, 'cash', now), null, 'otro importe');
  assert.equal(f.similarRecentPayment('p3', 800, 'cash', now), null, 'otra persona');
  assert.equal(f.similarRecentPayment('p1', 800, 'transfer', now), null, 'otra forma');
  assert.equal(f.similarRecentPayment('p1', 800, 'cash', now + 20 * 60000), null, 'ya pasaron más de 10 minutos');
});

test('la pantalla usa el intento al cobrar y al crear cargos, verifica antes de dar por fallido y no cambia la llave en cada clic', () => {
  assert.match(ui, /submitPayment\(savedAttempt\('payment'\)\)/);
  assert.match(ui, /rpc\('smyl_post_payment',paymentRequest\(attempt\)\)/);
  assert.match(ui, /paymentStatus\(paymentId,'unverified'\)/);
  assert.match(ui, /verifyPaymentDialog\(pendingAttempt\(\),true\)/);
  assert.match(ui, /attemptOpen\('charge'/);
});

test('un pago incierto sobrevive a una recarga y una consulta fallida; al verificarlo conserva o libera la misma llave',async()=>{
  const state={tenant:'T',actor:'A',patients:[],payments:[]};
  const first=world(state);
  const fp=first.f.attemptFingerprint(['P','B','S',13.42,'cash','',[['C',13.42]]]);
  const attempt=first.f.attemptOpen('payment',fp);
  first.f.paymentStatus(attempt.id,'unverified');
  const other=world({...state,actor:'otro'},first.store);
  assert.equal(other.f.savedAttempt('payment'),null);
  const {f,windowStub}=world(state,first.store);
  const original=f.paymentRequest(f.savedAttempt('payment'));
  let response;
  const filters=[];
  windowStub.sb={from(table){assert.equal(table,'smyl_finance_payments');return {
    select(cols){assert.equal(cols,'id');return this;},eq(k,v){filters.push([k,v]);return this;},limit(){return response;}
  };}};
  for(response of [{error:Error('Sin conexión')},{data:null},{data:{}},{data:[{id:'otro'}]}]){
    assert.equal(await f.checkPayment(attempt),'unknown');
    assert.equal(f.savedAttempt('payment').status,'unverified');
  }
  response={data:[]};assert.equal(await f.checkPayment(attempt),'missing');
  assert.deepEqual(f.paymentRequest(f.savedAttempt('payment')),original);
  assert.deepEqual(original.p_allocations,[{charge_id:'C',amount:13.42}]);
  assert.equal(original.p_idempotency_key,attempt.key);
  response={data:[{id:attempt.id}]};assert.equal(await f.checkPayment(attempt),'registered');
  assert.equal(f.savedAttempt('payment'),null);
  assert.deepEqual(filters.slice(-2),[['tenant_id','T'],['id',attempt.id]]);
});
