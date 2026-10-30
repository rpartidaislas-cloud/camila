// Auditoría 2026-10-26, P1 restantes: Stripe (plan solo desde el servidor), retención y lecturas por permiso.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const loadTs = (file) => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(read(file))).toString('base64'));
const { PLAN_LIMITES, planKeyFromPriceId, resolverPlanCheckout } = await loadTs('supabase/functions/_shared/stripe-plans.ts');

const PRECIOS = { esencial: 'price_ese', profesional: 'price_pro', premium: 'price_prem' };

test('el plan sale del Price ID configurado en el servidor, no del cliente', () => {
  assert.equal(planKeyFromPriceId('price_prem', PRECIOS), 'premium');
  assert.equal(planKeyFromPriceId('price_ese', PRECIOS), 'esencial');
  // un precio barato cualquiera de la cuenta de Stripe NO es un plan
  assert.equal(planKeyFromPriceId('price_barato_de_prueba', PRECIOS), null);
  assert.equal(planKeyFromPriceId('', PRECIOS), null);
  assert.equal(planKeyFromPriceId(null, PRECIOS), null);
  // sin configurar no hay coincidencia (antes "undefined === undefined" podía coincidir)
  assert.equal(planKeyFromPriceId('price_x', {}), null);
  assert.equal(planKeyFromPriceId(undefined, {}), null);
});

test('resolverPlanCheckout toma el Price ID del servidor y rechaza planes inventados', () => {
  assert.deepEqual(resolverPlanCheckout('premium', PRECIOS), { planKey: 'premium', priceId: 'price_prem' });
  for (const malo of ['gratis', 'PREMIUM', '', null, undefined, 42, {}, ['premium'], '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.deepEqual(resolverPlanCheckout(malo, PRECIOS), { error: 'plan_invalido' }, String(malo));
  }
  // plan válido pero sin Price ID configurado: se niega, no se improvisa
  assert.deepEqual(resolverPlanCheckout('premium', { esencial: 'a' }), { error: 'plan_no_configurado' });
  assert.deepEqual(resolverPlanCheckout('esencial', { esencial: '' }), { error: 'plan_no_configurado' });
});

test('los límites por plan coinciden con los de camila_tenants (15/40/100)', () => {
  assert.deepEqual(PLAN_LIMITES, { esencial: 15, profesional: 40, premium: 100 });
  const cuota = read('supabase/migrations/20261026240000_smyl_security_tenant_quota_guard.sql');
  assert.match(cuota, /"esencial":15,"profesional":40,"premium":100/);
});

test('stripe-checkout ignora el priceId del cliente y solo cobra el dueño', () => {
  const src = read('supabase/functions/stripe-checkout/index.ts');
  assert.match(src, /resolverPlanCheckout\(body\?\.planKey/);
  assert.doesNotMatch(src, /const \{ priceId, planKey \} = await req\.json\(\)/);
  assert.match(src, /const \{ planKey, priceId \} = plan;/);
  assert.match(src, /authUser\.id !== auth\.tenantId[\s\S]{0,260}status: 403/);
  assert.doesNotMatch(src, /error: e\.message/);
});

test('stripe-portal solo lo abre el dueño y no filtra errores internos', () => {
  const src = read('supabase/functions/stripe-portal/index.ts');
  assert.match(src, /requireUser\(req, CORS\)/);
  assert.match(src, /authUser\.id !== auth\.tenantId[\s\S]{0,260}status: 403/);
  assert.doesNotMatch(src, /error: e\.message/);
});

test('stripe-webhook ya no cae al plan de la metadata ni a un límite por defecto', () => {
  const src = read('supabase/functions/stripe-webhook/index.ts');
  assert.doesNotMatch(src, /metadata\?\.plan_key/);
  assert.doesNotMatch(src, /LIMITES\[planKey\] \|\| 40/);
  assert.match(src, /Price ID desconocido; el plan no se modificó/);
  assert.match(src, /Firma inválida/);
  assert.doesNotMatch(src, /error: e\.message/);
  assert.doesNotMatch(src, /Webhook signature error/);
});

test('retención: las purgas SQL se programan con pg_cron sin fallar si la extensión no está', () => {
  const sql = read('supabase/migrations/20261030100000_smyl_retention_purge_schedule.sql');
  assert.match(sql, /if not exists \(select 1 from pg_extension where extname = 'pg_cron'\) then[\s\S]{0,300}return;/);
  assert.match(sql, /cron\.unschedule\(v_job\.jobid\)/); // idempotente
  assert.match(sql, /smyl_purge_expired_public_appointment_intakes\(1000\)/);
  assert.match(sql, /smyl_purge_expired_assistant_conversations\(2000\)/);
  assert.match(sql, /'17 3 \* \* \*'/);
});

test('retención: el mantenimiento por clínica purga el audio vencido de MILA', () => {
  const src = read('supabase/functions/file-lifecycle-maintenance/index.ts');
  assert.match(src, /from\('mila_recordings'\)\.select\('id,object_path'\)\.eq\('tenant_id',tenant\)\.lte\('retention_until'/);
  assert.match(src, /storage\.from\('mila-audio'\)\.remove\(\[recording\.object_path\]\)/);
  // primero el archivo y luego la fila, siempre acotado a la clínica
  assert.ok(src.indexOf("remove([recording.object_path])") < src.indexOf("from('mila_recordings').delete()"));
  assert.match(src, /delete\(\)\.eq\('id',recording\.id\)\.eq\('tenant_id',tenant\)/);
});

test('lecturas por permiso: chat -> messages.read, MILA -> clinical.read; casos y pacientes no se tocan', () => {
  const sql = read('supabase/migrations/20261030110000_smyl_membership_reads_to_permissions.sql');
  assert.match(sql, /camila_conv_select_miembros[\s\S]{0,160}smyl_has_permission\(tenant_id, 'messages\.read'\)/);
  assert.match(sql, /camila_conv_update_miembros[\s\S]{0,260}smyl_has_permission\(tenant_id, 'messages\.respond'\)/);
  assert.match(sql, /smyl_has_permission\(c\.tenant_id, 'messages\.read'\)/);
  assert.match(sql, /camila_lana_handoffs_read[\s\S]{0,160}messages\.read/);
  assert.match(sql, /camila_lana_clinical_links_read[\s\S]{0,160}messages\.read/);
  for (const t of ['mila_sessions', 'mila_recordings', 'mila_transcripts', 'mila_clinical_notes', 'mila_confirmations', 'mila_tool_calls']) {
    assert.match(sql, new RegExp(`'${t}:`), t);
  }
  assert.match(sql, /'clinical\.read'/);
  // no debe volver a usar la membresía simple en las políticas que crea
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /using \(public\.camila_es_miembro/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /camila_casos|camila_pacientes/);
  // cada tabla se protege con to_regclass: no falla si alguna no existe
  assert.match(sql, /to_regclass\('public\.camila_conversaciones'\) is not null/);
});

test('el workflow P1 aplica y verifica las dos migraciones y avisa si falta pg_cron', () => {
  const wf = read('.github/workflows/smyl-seguridad-p1-migracion.yml');
  for (const v of ['20261030100000', '20261030110000']) assert.match(wf, new RegExp(v));
  assert.match(wf, /pg_cron no está habilitado/);
  assert.match(wf, /politicas_por_membresia/);
  assert.match(wf, /on:\s+workflow_dispatch:/);
});

test('los bundles de Stripe y mantenimiento están al día', () => {
  assert.match(read('docs/bundles/stripe-checkout.single-file.ts'), /resolverPlanCheckout/);
  assert.match(read('docs/bundles/stripe-portal.single-file.ts'), /Solo el dueño de la clínica puede gestionar la suscripción/);
  assert.match(read('docs/bundles/stripe-webhook.single-file.ts'), /Price ID desconocido; el plan no se modificó/);
  assert.match(read('docs/bundles/file-lifecycle-maintenance.single-file.ts'), /mila-audio/);
});
