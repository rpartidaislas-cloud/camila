// Suscripciones con Openpay: contratos de seguridad y de publicación (sin red).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const billingJs = read('smyl-billing.js');
const billingCode = billingJs.replace(/^\s*\/\/.*$/gm, '');
const fnBilling = read('supabase/functions/openpay-billing/index.ts');
const fnWebhook = read('supabase/functions/openpay-billing-webhook/index.ts');
const runtime = read('supabase/functions/_shared/openpay-runtime.ts');
const core = read('supabase/functions/_shared/openpay-billing-core.mjs');
const migration = read('supabase/migrations/20261123120000_smyl_openpay_billing.sql');
const app = read('app.html');

test('ningún secreto de Openpay está escrito en el repositorio', () => {
  const files = [billingJs, fnBilling, fnWebhook, runtime, core, migration, read('scripts/openpay-create-plans.mjs'), read('docs/OPENPAY_SUSCRIPCIONES.md')];
  for (const text of files) {
    assert.doesNotMatch(text, /\bsk_[0-9a-f]{20,}/i, 'una llave privada de Openpay');
    assert.doesNotMatch(text, /\bpk_[0-9a-f]{20,}/i, 'una llave pública de Openpay (debe venir de la función, no del código)');
  }
  assert.match(runtime, /Deno\.env\.get\("OPENPAY_PRIVATE_KEY"\)/);
});

test('el navegador no manda precio, plan_id ni número de tarjeta; la tarjeta se tokeniza con Openpay', () => {
  assert.match(billingJs, /token\.create\(/, 'la tarjeta se tokeniza en el navegador');
  assert.match(billingJs, /action: 'subscribe'|call\('subscribe', \{ plan_key: planKey, periodo: periodo, token_id: tokenId, device_session_id: deviceId \}\)/);
  assert.doesNotMatch(billingCode, /plan_id|priceId|price:|amount/, 'el servidor decide el plan y el monto');
  assert.doesNotMatch(billingJs, /localStorage|sessionStorage/, 'nada de tarjeta ni tokens en almacenamiento');
  assert.doesNotMatch(billingJs, /console\.(log|info|debug)/, 'no se escriben datos de pago en consola');
});

test('la función de cobro exige sesión y dueño, valida el cuerpo y no confía en el navegador', () => {
  assert.match(fnBilling, /requireUser\(req, cors\)/);
  assert.match(fnBilling, /user\.id !== auth\.tenantId/, 'solo el dueño de la clínica');
  assert.match(fnBilling, /MAX_BODY/);
  assert.match(fnBilling, /TOKEN_RE\.test\(tokenId\)/);
  assert.doesNotMatch(fnBilling, /body\.(plan_id|price|amount)/);
  assert.match(core, /resolverPlan\(input\.planKey, input\.periodo\)/);
  assert.match(core, /store\.planId\(plan\.plan_key, plan\.periodo\)/, 'el plan_id sale de la base del servidor');
});

test('el webhook se autentica, no confía en el contenido y no duplica', () => {
  assert.match(fnWebhook, /basicValido\(req\.headers\.get\("authorization"\), USER, PASSWORD\)/);
  assert.match(fnWebhook, /MAX_BODY/);
  assert.match(core, /store\.recordEvent\(eventKey, type, tenantId\)/);
  assert.match(core, /return api\.sync\(tenantId\)/, 'reconsulta la API de Openpay en lugar de creer el aviso');
  assert.match(core, /cliente_desconocido/, 'ignora los cobros de pacientes que LANA hace con el mismo comercio');
});

test('las tablas de cobro solo las escribe el servidor y el resumen es solo del dueño', () => {
  assert.match(migration, /revoke all on public\.smyl_billing_plans, public\.smyl_billing_customers, public\.smyl_billing_subscriptions, public\.smyl_billing_events from public, anon, authenticated/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /card_last4 text check \(card_last4 is null or card_last4 ~ '\^\[0-9\]\{4\}\$'\)/, 'solo los últimos 4 dígitos');
  assert.doesNotMatch(migration, /card_number|cvv|expiration/i, 'nunca se guardan datos completos de la tarjeta');
  assert.match(migration, /v_tenant uuid := auth\.uid\(\)/);
});

test('app.html ya no usa Stripe y carga el módulo de pago', () => {
  assert.doesNotMatch(app, /STRIPE_PRICE_IDS|STRIPE_CHECKOUT_URL|STRIPE_PORTAL_URL|stripe-checkout|stripe-portal/);
  assert.match(app, /<script defer src="smyl-billing\.js\?v=1"><\/script>/);
  assert.match(app, /window\.SmylBilling\.choose\(planKey\)/);
  assert.match(app, /window\.SmylBilling\.manage\(\)/);
  assert.match(read('sw.js'), /\/camila\/smyl-billing\.js\?v=1/);
});

test('web y móvil publican los mismos archivos de pago', () => {
  for (const file of ['smyl-billing.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + file), read(file), `mobile/www/${file} difiere`);
});

test('los paquetes empaquetados para el panel de Supabase están al día', () => {
  for (const name of ['openpay-billing', 'openpay-billing-webhook']) {
    const bundle = read(`docs/bundles/${name}.single-file.ts`);
    assert.match(bundle, /createBilling/);
    assert.match(bundle, /PLANES_SMYL/);
    assert.doesNotMatch(bundle, /from "\.\.\/_shared/, 'el paquete no debe importar archivos relativos');
  }
});
