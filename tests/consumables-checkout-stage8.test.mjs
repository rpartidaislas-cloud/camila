import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');

const migration = read('supabase/migrations/20261024090000_smyl_consumables_checkout.sql');
const checkout = read('supabase/functions/smyl-consumables-checkout/index.ts');
const status = read('supabase/functions/smyl-consumables-checkout-status/index.ts');
const webhook = read('supabase/functions/smyl-consumables-webhook/index.ts');
const subscriptionCheckout = read('supabase/functions/stripe-checkout/index.ts');
const subscriptionWebhook = read('supabase/functions/stripe-webhook/index.ts');
const config = read('supabase/config.toml');

function sqlFunction(name) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `no se encontró ${name}`);
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end);
}

test('separación comercial: las funciones de suscripción no cambian y las nuevas no tocan camila_tenants.plan', () => {
  assert.match(subscriptionCheckout, /mode: 'subscription'/);
  assert.doesNotMatch(subscriptionWebhook, /smyl_consumables|smyl_credit|smyl_checkout_sessions/);
  for (const source of [checkout, status, webhook]) {
    assert.doesNotMatch(source, /camila_tenants'\)\.update|limite_diagnosticos|stripe_subscription_id/);
  }
  assert.match(checkout, /mode: "payment"/);
  assert.match(webhook, /STRIPE_CONSUMABLES_WEBHOOK_SECRET/);
  assert.doesNotMatch(webhook, /STRIPE_WEBHOOK_SECRET[^_]/);
});

test('JWT obligatorio en checkout y estado; webhook público sólo por firma, sin CORS como autenticación', () => {
  assert.match(config, /\[functions\.smyl-consumables-checkout\]\s*\nverify_jwt = true/);
  assert.match(config, /\[functions\.smyl-consumables-checkout-status\]\s*\nverify_jwt = true/);
  assert.match(config, /\[functions\.smyl-consumables-webhook\]\s*\nverify_jwt = false/);
  assert.match(checkout, /requireUser\(req, CORS\)/);
  assert.match(status, /requireUser\(req, CORS\)/);
  assert.doesNotMatch(webhook, /Access-Control-Allow-Origin/);
  assert.match(webhook, /const payload = await req\.text\(\);[\s\S]*?constructEventAsync\(payload, signature, secret\)/,
    'la firma se verifica sobre el cuerpo crudo antes de interpretar el evento');
  assert.ok(webhook.indexOf('constructEventAsync') < webhook.indexOf('ALLOWED_EVENTS.has(event.type)'));
});

test('el navegador sólo envía product_id e idempotency_key; tenant, precio, moneda y unidades salen del servidor', () => {
  assert.match(checkout, /const productId = body\.product_id;/);
  assert.match(checkout, /const idempotencyKey = body\.idempotency_key;/);
  assert.doesNotMatch(checkout, /body\.(tenant_id|price|price_minor|currency|units|unit_amount|balance|resource)/);
  assert.match(checkout, /isProductId\(productId\) \|\| !isUuid\(idempotencyKey\)/);
  assert.match(checkout, /MAX_BODY_BYTES = 2048/);
  assert.match(checkout, /unit_amount: Number\(session\.price_minor\)/, 'el precio viene del snapshot del servidor');
  assert.match(checkout, /currency: String\(session\.currency\)\.toLowerCase\(\)/);
  assert.match(checkout, /smyl_consumables_can_purchase/, 'exige permiso comercial');
  assert.match(sqlFunction('smyl_consumables_can_purchase'), /finance\.manage[\s\S]*?clinic\.manage/);
});

test('idempotencia de compra: una clave repetida reutiliza la sesión y nunca crea dos cobros', () => {
  const begin = sqlFunction('smyl_consumables_checkout_begin');
  assert.match(begin, /pg_advisory_xact_lock/);
  assert.match(begin, /where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key/);
  assert.match(begin, /if v_existing\.product_id <> p_product_id then[\s\S]*?raise exception/);
  assert.match(migration, /unique \(tenant_id, idempotency_key\)/);
  assert.match(migration, /create unique index if not exists smyl_checkout_sessions_provider_idx[\s\S]*?\(provider, provider_checkout_id\)/);
  assert.match(checkout, /idempotencyKey: `smyl-consumable-\$\{session\.id\}`/, 'Stripe también recibe clave idempotente');
  assert.match(checkout, /session\.status === "pending" && session\.provider_checkout_id[\s\S]*?sessions\.retrieve/,
    'un reintento con checkout abierto devuelve la misma URL');
  assert.match(checkout, /\["completed", "refunded", "failed", "expired"\]\.includes\(session\.status\)[\s\S]*?409/);
});

test('el snapshot es inmutable y el catálogo posterior no lo altera', () => {
  const begin = sqlFunction('smyl_consumables_checkout_begin');
  assert.match(begin, /v_product\.resource, v_product\.unit_amount, v_product\.price_minor, v_product\.currency/);
  assert.match(begin, /where id = p_product_id and active/);
  assert.match(begin, /v_product\.price_minor is null or v_product\.price_minor <= 0/);
  const freeze = sqlFunction('smyl_checkout_sessions_freeze_snapshot');
  assert.match(freeze, /new\.price_minor <> old\.price_minor/);
  assert.match(freeze, /new\.unit_amount <> old\.unit_amount/);
  assert.match(freeze, /new\.currency <> old\.currency/);
  assert.match(migration, /price_minor integer not null check \(price_minor > 0\)/);
  assert.match(migration, /unit_amount bigint not null check \(unit_amount > 0\)/);
  assert.match(migration, /currency text not null check \(currency in \('MXN', 'USD'\)\)/);
  assert.match(migration, /resource text not null check \(resource in \('mila_seconds', 'whatsapp_messages', 'ai_credits'\)\)/);
});

test('sólo el webhook firmado acredita: checkout=success y el estado no escriben saldo', () => {
  assert.doesNotMatch(status, /smyl_credit|smyl_consumables_confirm_payment|\.insert\(|\.update\(/);
  assert.doesNotMatch(checkout, /smyl_credit|smyl_consumables_confirm_payment/);
  assert.match(webhook, /smyl_consumables_confirm_payment/);
  assert.match(webhook, /session\.payment_status === "paid"/, 'completed sin pago (OXXO/SPEI) no acredita');
  assert.match(webhook, /session\.metadata\?\.smyl_kind !== "consumable"/, 'ignora sesiones de suscripción');
  const confirm = sqlFunction('smyl_consumables_confirm_payment');
  assert.match(confirm, /for update;/);
  assert.match(confirm, /amount_mismatch/);
  assert.match(confirm, /currency_mismatch/);
  assert.match(confirm, /metadata_checkout_mismatch/);
  assert.match(confirm, /metadata_tenant_mismatch/);
  assert.ok(confirm.indexOf('v_reason is not null') < confirm.indexOf('public.smyl_credit('),
    'las discordancias se rechazan antes de acreditar');
  assert.match(confirm, /'purchase:' \|\| v_row\.id::text/, 'clave determinista por checkout');
  assert.match(confirm, /if v_row\.status in \('completed', 'refunded'\) then[\s\S]*?already_completed/);
  assert.match(confirm, /set status = 'completed'[\s\S]*?ledger_entry_id = v_ledger/);
});

test('eventos duplicados y fuera de orden convergen sin duplicar movimientos', () => {
  const record = sqlFunction('smyl_payment_event_record');
  assert.match(record, /exception when unique_violation then[\s\S]*?attempt = attempt \+ 1/);
  assert.match(migration, /unique \(provider, provider_event_id\)/);
  const closed = sqlFunction('smyl_consumables_mark_closed');
  assert.match(closed, /if v_row\.status in \('completed', 'refunded', 'failed', 'expired'\) then[\s\S]*?'ignored'/,
    'un expired/failed tardío no revierte un checkout completado');
  assert.doesNotMatch(closed, /smyl_credit|smyl_usage_ledger/, 'fallo y expiración no crean movimientos');
  const guard = sqlFunction('smyl_checkout_sessions_guard_transition');
  assert.match(guard, /old\.status = 'completed' and new\.status = 'refunded'/);
  assert.match(guard, /Transición de checkout no permitida/);
});

test('reembolso append-only: reverso como adjustment, repetido una sola vez, original intacto', () => {
  const refund = sqlFunction('smyl_consumables_refund');
  assert.match(refund, /'refund:' \|\| v_row\.id::text \|\| ':' \|\| p_provider_event_id/);
  assert.match(refund, /already_refunded/);
  assert.match(refund, /'adjustment', v_reverse/);
  assert.match(refund, /'package_refund'/);
  assert.match(refund, /original_ledger_entry_id/);
  assert.doesNotMatch(refund, /delete from public\.smyl_usage_ledger|update public\.smyl_usage_ledger/);
  assert.match(refund, /refund_shortfall_units/);
  assert.match(migration, /refund_ledger_entry_id uuid references public\.smyl_usage_ledger\(id\)/);
});

test('RLS: nadie autenticado escribe ni lee directamente sesiones o eventos; estado sólo por RPC con tenant y permiso', () => {
  assert.match(migration, /alter table public\.smyl_checkout_sessions enable row level security;\s*\nrevoke all on table public\.smyl_checkout_sessions from public, anon, authenticated;/);
  assert.match(migration, /alter table public\.smyl_payment_events enable row level security;\s*\nrevoke all on table public\.smyl_payment_events from public, anon, authenticated;/);
  assert.doesNotMatch(migration, /create policy[^\n]*smyl_(checkout_sessions|payment_events)/);
  for (const fn of ['smyl_consumables_checkout_begin', 'smyl_consumables_checkout_attach', 'smyl_payment_event_record',
    'smyl_consumables_confirm_payment', 'smyl_consumables_mark_closed', 'smyl_consumables_refund']) {
    const grant = migration.match(new RegExp(`grant execute on function public\\.${fn}\\([^;]*;`));
    assert.ok(grant, `falta grant de ${fn}`);
    assert.match(grant[0], /to service_role;/);
    assert.doesNotMatch(grant[0], /\b(anon|authenticated)\b/);
  }
  const statusFn = sqlFunction('smyl_consumables_checkout_status');
  assert.match(statusFn, /s\.tenant_id = public\.smyl_current_tenant\(\)/);
  assert.match(statusFn, /public\.smyl_consumables_can_purchase\(s\.tenant_id\)/);
  assert.doesNotMatch(statusFn, /provider_checkout_id|provider_payment_id|price_minor|idempotency_key/);
  assert.match(status, /\/\^chk_\[a-f0-9\]\{32\}\$\//);
  assert.match(status, /"Cache-Control": "no-store"/);
  assert.match(status, /return json\(CORS, 404, \{ error: "No encontramos esa compra\." \}\)/);
  assert.match(status, /status: row\.status,\s*credited_resource: row\.credited_resource \?\? null,\s*credited_units: row\.credited_units \?\? null,\s*confirmed_at: row\.confirmed_at \?\? null,/);
});

test('metadata y logs sin PHI: sólo identificadores internos', () => {
  assert.match(checkout, /const metadata = \{ smyl_checkout_id: session\.id, smyl_tenant_id: tenantId, smyl_product_id: productId, smyl_kind: "consumable" \};/);
  for (const source of [checkout, status, webhook]) {
    assert.doesNotMatch(source, /patient|paciente|telefono|phone|prompt|diagnos|conversation|transcript/i);
  }
  assert.match(migration, /error_message text check \(error_message is null or char_length\(error_message\) <= 300\)/);
  assert.doesNotMatch(migration, /payload jsonb|raw_body|card_number|last4/);
});

test('URLs de regreso desde variable permitida con host explícito y HTTPS', () => {
  assert.match(checkout, /ALLOWED_RETURN_HOSTS = new Set\(\["app\.smyldesign\.ai", "rpartidaislas-cloud\.github\.io", "localhost"\]\)/);
  assert.match(checkout, /url\.protocol !== "https:" && url\.hostname !== "localhost"/);
  assert.match(checkout, /consumos\.html\?checkout=success&checkout_id=\$\{session\.public_ref\}/);
  assert.match(checkout, /consumos\.html\?checkout=cancel&checkout_id=\$\{session\.public_ref\}/);
  assert.match(checkout, /created\.url\.startsWith\("https:\/\/"\)/);
});

test('la migración es reversible y declara su rollback completo', () => {
  assert.match(migration, /\/\* ROLLBACK/);
  for (const obj of ['smyl_consumables_checkout_status', 'smyl_consumables_refund', 'smyl_consumables_mark_closed',
    'smyl_consumables_confirm_payment', 'smyl_payment_event_record', 'smyl_consumables_checkout_attach',
    'smyl_consumables_checkout_begin', 'smyl_payment_events', 'smyl_checkout_sessions', 'smyl_consumables_can_purchase']) {
    assert.match(migration, new RegExp(`drop (table|function) if exists public\\.${obj}`), `rollback sin ${obj}`);
  }
});

test('el enforcement sigue apagado y los productos sin venta', () => {
  assert.doesNotMatch(migration, /update public\.smyl_consumable_products set active = true/);
  assert.doesNotMatch(migration, /SMYL_CONSUMABLES_ENFORCED/);
  for (const source of [checkout, status, webhook]) assert.doesNotMatch(source, /SMYL_CONSUMABLES_ENFORCED/);
});
