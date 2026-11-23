#!/usr/bin/env node
// Crea (o reutiliza) en Openpay los 6 planes de suscripción de SMYL y muestra sus ids.
// No guarda secretos: lee OPENPAY_MERCHANT_ID, OPENPAY_PRIVATE_KEY y OPENPAY_ENV (sandbox | production) del entorno.
//   OPENPAY_MERCHANT_ID=... OPENPAY_PRIVATE_KEY=sk_... OPENPAY_ENV=sandbox node scripts/openpay-create-plans.mjs
// Es idempotente: si ya existe un plan con el mismo nombre, lo reutiliza.
import { PLANES_SMYL, openpayBase } from '../supabase/functions/_shared/openpay-plans.mjs';

const merchant = process.env.OPENPAY_MERCHANT_ID, key = process.env.OPENPAY_PRIVATE_KEY, env = process.env.OPENPAY_ENV || 'sandbox';
if (!merchant || !key) { console.error('Faltan OPENPAY_MERCHANT_ID y OPENPAY_PRIVATE_KEY.'); process.exit(1); }
const base = `${openpayBase(env)}/${merchant}`;
const auth = 'Basic ' + Buffer.from(key + ':').toString('base64');

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.description || ''}`);
  return data;
}

const existing = await call('GET', '/plans?limit=100');
const out = [];
for (const plan of PLANES_SMYL) {
  const found = existing.find((item) => item.name === plan.name);
  try {
    const created = found || await call('POST', '/plans', {
      name: plan.name, amount: plan.amount, currency: 'MXN',
      repeat_every: plan.repeat_every || 1, repeat_unit: plan.repeat_unit,
      retry_times: 3, status_after_retry: 'cancelled', trial_days: 0,
    });
    out.push({ plan_key: plan.plan_key, periodo: plan.periodo, name: plan.name, amount: plan.amount, openpay_plan_id: created.id, reutilizado: Boolean(found) });
  } catch (error) {
    console.error(`✗ ${plan.name} ($${plan.amount}): ${error.message}`);
  }
}
console.table(out);
console.log('\nSQL para registrar los ids (ambiente: ' + env + '):');
for (const row of out) console.log(`insert into smyl_billing_plans(plan_key, periodo, openpay_plan_id, environment) values ('${row.plan_key}', '${row.periodo}', '${row.openpay_plan_id}', '${env}') on conflict (plan_key, periodo, environment) do update set openpay_plan_id = excluded.openpay_plan_id;`);
