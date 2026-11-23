// Suscripciones con Openpay: lógica de cobro con dependencias falsas (sin red ni base de datos).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling, BillingError, LIMITE_DIAGNOSTICOS } from '../supabase/functions/_shared/openpay-billing-core.mjs';
import { PLANES_SMYL, resolverPlan, planDeOpenpay, estadoSuscripcion, vencimientoConGracia, basicValido, openpayBase } from '../supabase/functions/_shared/openpay-plans.mjs';

const T = 'tenant-1';

function setup(options) {
  const opts = options || {};
  const calls = [], db = { customer: null, sub: null, patches: [], events: new Set(), byCustomer: { cus1: T } };
  let subCounter = 0;
  const remote = { sub1: { id: 'sub1', status: 'active', cancel_at_period_end: false, charge_date: '2026-12-23', period_end_date: '2026-12-22' } };
  const store = {
    planId: async (k, p) => (opts.noPlanIds ? null : `plan-${k}-${p}`),
    planFilas: async () => [],
    customer: async () => db.customer,
    saveCustomer: async (t, row) => { db.customer = Object.assign({}, db.customer, row); },
    subscription: async () => db.sub,
    saveSubscription: async (t, row) => { db.sub = Object.assign({}, db.sub, row); },
    tenantByCustomer: async (id) => db.byCustomer[id] || null,
    recordEvent: async (key) => { if (db.events.has(key)) return false; db.events.add(key); return true; },
    applyToTenant: async (t, patch) => { db.patches.push(patch); },
  };
  const op = async (method, path, body) => {
    calls.push([method, path, body]);
    if (opts.opHook) { const hooked = opts.opHook(method, path, body); if (hooked) return hooked; }
    if (method === 'POST' && path === '/customers') return { status: 200, data: { id: 'cus1' } };
    if (method === 'POST' && /\/cards$/.test(path)) return { status: 200, data: { id: 'card' + calls.length, brand: 'visa', card_number: '411111XXXXXX1111' } };
    if (method === 'POST' && /\/subscriptions$/.test(path)) { subCounter += 1; const id = 'sub' + subCounter; remote[id] = Object.assign({}, remote.sub1, { id }); return { status: 200, data: remote[id] }; }
    if (method === 'GET' && /\/subscriptions\//.test(path)) return { status: 200, data: remote[path.split('/').pop()] || remote.sub1 };
    if (method === 'PUT' && /\/subscriptions\//.test(path)) { const id = path.split('/').pop(); Object.assign(remote[id] || (remote[id] = Object.assign({}, remote.sub1, { id })), body); return { status: 200, data: remote[id] }; }
    if (method === 'DELETE') return { status: 204, data: {} };
    return { status: 404, data: {} };
  };
  const billing = createBilling({ op, store, now: () => new Date(opts.now || '2026-11-23T12:00:00Z') });
  return { billing, calls, db, remote };
}
const base = { tenantId: T, name: 'Clínica Sonrisa', email: 'dueno@clinica.mx', planKey: 'profesional', periodo: 'mensual', tokenId: 'tok', deviceSessionId: 'dev' };

test('el catálogo respeta el tope de $10,000 por cobro de Openpay y el anual cuesta 10 meses', () => {
  for (const plan of PLANES_SMYL) assert.ok(plan.amount <= 10000, plan.name);
  const price = (k, p) => { const x = resolverPlan(k, p); return (x.total_anual || x.amount); };
  assert.equal(price('esencial', 'mensual'), 299); assert.equal(price('profesional', 'mensual'), 899); assert.equal(price('premium', 'mensual'), 1499);
  assert.equal(price('esencial', 'anual'), 299 * 10); assert.equal(price('profesional', 'anual'), 899 * 10); assert.equal(price('premium', 'anual'), 1499 * 10);
  assert.equal(resolverPlan('premium', 'anual').repeat_every, 6, 'Premium anual se cobra en dos pagos semestrales');
  assert.equal(resolverPlan('gratis', 'mensual'), null);
  assert.equal(resolverPlan('premium', 'semanal'), null);
});

test('funciones puras: estado, vencimiento con gracia, plan de Openpay y autenticación del webhook', () => {
  assert.equal(estadoSuscripcion('active'), 'active'); assert.equal(estadoSuscripcion('past_due'), 'past_due');
  assert.equal(estadoSuscripcion('unpaid'), 'past_due'); assert.equal(estadoSuscripcion('cancelled'), 'cancelled'); assert.equal(estadoSuscripcion('???'), 'unknown');
  assert.equal(vencimientoConGracia('2026-12-23T00:00:00Z', 3), '2026-12-26T00:00:00.000Z');
  assert.equal(vencimientoConGracia('no es fecha', 3), null);
  assert.deepEqual(planDeOpenpay('x', [{ plan_key: 'premium', periodo: 'anual', openpay_plan_id: 'x' }]), { plan_key: 'premium', periodo: 'anual' });
  assert.equal(planDeOpenpay('y', []), null);
  const header = 'Basic ' + Buffer.from('smyl:secreto-largo').toString('base64');
  assert.equal(basicValido(header, 'smyl', 'secreto-largo'), true);
  assert.equal(basicValido(header, 'smyl', 'otro'), false);
  assert.equal(basicValido(null, 'smyl', 'secreto-largo'), false);
  assert.equal(basicValido(header, '', ''), false, 'sin credenciales configuradas nunca autentica');
  assert.equal(openpayBase('production'), 'https://api.openpay.mx/v1'); assert.equal(openpayBase('sandbox'), 'https://sandbox-api.openpay.mx/v1'); assert.equal(openpayBase(undefined), 'https://sandbox-api.openpay.mx/v1');
});

test('contratar: crea cliente, guarda tarjeta, suscribe con el plan del servidor y activa el plan de la clínica', async () => {
  const { billing, calls, db } = setup();
  const result = await billing.subscribe(Object.assign({}, base, { planId: 'plan-malicioso', price: 1 }));
  assert.deepEqual(calls.map((c) => c[0] + ' ' + c[1].replace(/cus1/, 'C')), ['POST /customers', 'POST /customers/C/cards', 'POST /customers/C/subscriptions']);
  assert.equal(calls[2][2].plan_id, 'plan-profesional-mensual', 'el plan_id sale del servidor, nunca del navegador');
  assert.equal(result.status, 'active'); assert.equal(result.card_last4, '1111'); assert.equal(result.next_charge_date, '2026-12-23');
  assert.equal(db.sub.plan_key, 'profesional'); assert.equal(db.customer.card_brand, 'visa');
  const patch = db.patches.at(-1);
  assert.equal(patch.plan, 'profesional'); assert.equal(patch.limite_diagnosticos, LIMITE_DIAGNOSTICOS.profesional);
  assert.equal(patch.activo, true); assert.equal(patch.diagnosticos_usados, 0);
  assert.equal(patch.vence_en, '2026-12-26T23:59:59.000Z', 'fin del día del siguiente cobro (23 dic) + 3 días de gracia');
});

test('contratar rechaza plan inválido, plan sin configurar, tarjeta incompleta y plan repetido', async () => {
  const bad = (input, code) => assert.rejects(() => setup().billing.subscribe(input), (e) => e instanceof BillingError && e.code === code);
  await bad(Object.assign({}, base, { planKey: 'gratis' }), 'plan_invalido');
  await bad(Object.assign({}, base, { periodo: 'semanal' }), 'plan_invalido');
  await bad(Object.assign({}, base, { tokenId: '' }), 'tarjeta_incompleta');
  await assert.rejects(() => setup({ noPlanIds: true }).billing.subscribe(base), (e) => e.code === 'plan_no_configurado' && e.http === 503);
  const s = setup(); await s.billing.subscribe(base);
  await assert.rejects(() => s.billing.subscribe(base), (e) => e.code === 'ya_contratado' && e.http === 409);
});

test('una tarjeta rechazada explica el motivo en español y no cambia el plan', async () => {
  const hook = (m, p) => (/\/cards$/.test(p) ? { status: 422, data: { error_code: 3001, description: 'declined' } } : null);
  const s = setup({ opHook: hook });
  await assert.rejects(() => s.billing.subscribe(base), (e) => e.http === 402 && /rechazó la tarjeta/.test(e.message));
  assert.equal(s.db.patches.length, 0); assert.equal(s.db.sub, null);
});

test('si el primer cobro falla no se cambia el plan ni se cancela la suscripción anterior', async () => {
  const s = setup();
  await s.billing.subscribe(base);
  s.db.patches.length = 0;
  const hook = (m, p) => (m === 'POST' && /\/subscriptions$/.test(p) ? { status: 402, data: { error_code: 3003, description: 'insufficient' } } : null);
  const s2 = setup({ opHook: hook }); s2.db.customer = s.db.customer; s2.db.sub = s.db.sub;
  await assert.rejects(() => s2.billing.subscribe(Object.assign({}, base, { planKey: 'premium' })), (e) => /fondos/.test(e.message));
  assert.equal(s2.db.patches.length, 0); assert.ok(!s2.calls.some((c) => c[0] === 'DELETE'));
  assert.equal(s2.db.sub.plan_key, 'profesional');
});

test('cambiar de plan crea la nueva suscripción y después cancela la anterior', async () => {
  const s = setup();
  await s.billing.subscribe(base);
  const before = s.calls.length;
  await s.billing.subscribe(Object.assign({}, base, { planKey: 'premium', periodo: 'anual' }));
  const after = s.calls.slice(before).map((c) => c[0] + ' ' + c[1].split('/').slice(-1)[0]);
  assert.ok(after.indexOf('POST subscriptions') < after.findIndex((x) => x.startsWith('DELETE')), 'primero cobra la nueva, luego cancela la vieja');
  assert.equal(s.db.sub.plan_key, 'premium'); assert.equal(s.db.sub.periodo, 'anual');
  assert.equal(s.db.patches.at(-1).limite_diagnosticos, LIMITE_DIAGNOSTICOS.premium);
});

test('cancelar deja de renovar pero conserva el acceso; reactivar lo revierte', async () => {
  const s = setup(); await s.billing.subscribe(base);
  const cancelled = await s.billing.cancel(T);
  assert.equal(cancelled.cancel_at_period_end, true);
  assert.deepEqual(s.calls.find((c) => c[0] === 'PUT')[2], { cancel_at_period_end: true });
  assert.equal(s.db.patches.at(-1).activo, true, 'sigue activa hasta el final del periodo');
  assert.equal((await s.billing.summary(T)).cancel_at_period_end, true);
  const resumed = await s.billing.resume(T);
  assert.equal(resumed.cancel_at_period_end, false);
  await assert.rejects(() => setup().billing.cancel(T), (e) => e.code === 'sin_suscripcion');
});

test('cambiar tarjeta guarda la nueva y la asigna a la suscripción', async () => {
  const s = setup(); await s.billing.subscribe(base);
  const out = await s.billing.changeCard({ tenantId: T, tokenId: 't2', deviceSessionId: 'd2' });
  assert.equal(out.card_last4, '1111');
  const put = s.calls.filter((c) => c[0] === 'PUT').at(-1);
  assert.ok(put[2].card_id, 'asigna card_id a la suscripción');
  await assert.rejects(() => s.billing.changeCard({ tenantId: T, tokenId: '', deviceSessionId: '' }), (e) => e.code === 'tarjeta_incompleta');
});

test('webhook: ignora clientes ajenos (p. ej. cobros de pacientes de LANA), no duplica y reconsulta a Openpay', async () => {
  const s = setup(); await s.billing.subscribe(base);
  assert.deepEqual(await s.billing.handleWebhook({ type: 'verification', verification_code: '123' }), { ok: true, verification: true });
  assert.equal((await s.billing.handleWebhook({ type: 'charge.succeeded', transaction: { id: 'tx0', customer_id: 'otro' } })).ignored, 'cliente_desconocido');
  assert.equal((await s.billing.handleWebhook({ type: 'charge.succeeded', transaction: { id: 'tx0' } })).ignored, 'sin_cliente');
  s.remote.sub1.status = 'active'; s.remote.sub1.charge_date = '2027-01-23';
  const first = await s.billing.handleWebhook({ type: 'charge.succeeded', transaction: { id: 'tx1', customer_id: 'cus1', amount: 1 } });
  assert.equal(first.next_charge_date, '2027-01-23', 'toma la fecha de la API, no del aviso');
  assert.equal((await s.billing.handleWebhook({ type: 'charge.succeeded', transaction: { id: 'tx1', customer_id: 'cus1' } })).duplicate, true);
});

test('cobro fallido: queda en gracia y se apaga cuando vence; cancelada conserva el periodo pagado', async () => {
  const s = setup({ now: '2026-12-24T12:00:00Z' }); await s.billing.subscribe(base);
  s.remote.sub1.status = 'past_due';
  await s.billing.sync(T);
  assert.equal(s.db.patches.at(-1).activo, true, 'dentro de los 3 días de gracia sigue activa');
  const late = setup({ now: '2026-12-30T12:00:00Z' }); await late.billing.subscribe(base);
  late.remote.sub1.status = 'past_due'; await late.billing.sync(T);
  assert.equal(late.db.patches.at(-1).activo, false, 'vencida la gracia se apaga');
  const ended = setup({ now: '2026-12-01T12:00:00Z' }); await ended.billing.subscribe(base);
  ended.remote.sub1.status = 'cancelled'; await ended.billing.sync(T);
  assert.equal(ended.db.patches.at(-1).activo, true, 'cancelada pero con periodo pagado hasta el 22 de diciembre');
  assert.equal(ended.db.patches.at(-1).plan, undefined, 'una cancelación no cambia el plan');
});
