// ARCHIVO GENERADO por scripts/bundle-edge-function.mjs — no lo edites a mano.
// Es supabase/functions/openpay-billing-webhook/index.ts con sus archivos de _shared incluidos,
// para pegarlo en el editor de Edge Functions del panel de Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

// ── _shared/openpay-plans.mjs ──
const { PLAN_KEYS, PERIODOS, PLANES_SMYL, openpayBase, resolverPlan, planDeOpenpay, estadoSuscripcion, vencimientoConGracia, basicValido } = (() => {
// SMYL · Catálogo de planes de suscripción y utilidades puras de Openpay.
// Fuente única del precio: el navegador NUNCA manda precio ni plan_id; solo plan_key + periodo.
// Sin Deno ni red, para poder probarlo con Node. (Parámetros sin desestructurar: el empaquetador anota tipos.)

const PLAN_KEYS = ['esencial', 'profesional', 'premium'];
const PERIODOS = ['mensual', 'anual'];

const PLANES_SMYL = [
  { plan_key: 'esencial', periodo: 'mensual', name: 'SMYL Esencial mensual', amount: 299, repeat_unit: 'month' },
  { plan_key: 'esencial', periodo: 'anual', name: 'SMYL Esencial anual', amount: 2990, repeat_unit: 'year' },
  { plan_key: 'profesional', periodo: 'mensual', name: 'SMYL Profesional mensual', amount: 899, repeat_unit: 'month' },
  { plan_key: 'profesional', periodo: 'anual', name: 'SMYL Profesional anual', amount: 8990, repeat_unit: 'year' },
  { plan_key: 'premium', periodo: 'mensual', name: 'SMYL Premium mensual', amount: 1499, repeat_unit: 'month' },
  // Openpay limita cada cobro de un plan a $10,000: el anual de Premium ($14,990) se cobra en 2 pagos semestrales que suman lo mismo.
  { plan_key: 'premium', periodo: 'anual', name: 'SMYL Premium anual (2 pagos semestrales)', amount: 7495, repeat_every: 6, repeat_unit: 'month', total_anual: 14990 },
];

function openpayBase(env: any) {
  return env === 'production' ? 'https://api.openpay.mx/v1' : 'https://sandbox-api.openpay.mx/v1';
}

// Plan pedido por el cliente → definición del servidor, o null si no existe.
function resolverPlan(planKey: any, periodo: any) {
  if (typeof planKey !== 'string' || typeof periodo !== 'string') return null;
  return PLANES_SMYL.find((item) => item.plan_key === planKey && item.periodo === periodo) || null;
}

// Plan de SMYL al que corresponde un plan_id de Openpay, según la tabla smyl_billing_plans (filas {plan_key, periodo, openpay_plan_id}).
function planDeOpenpay(openpayPlanId: any, filas: any) {
  if (!openpayPlanId || !Array.isArray(filas)) return null;
  const fila = filas.find((item) => item.openpay_plan_id === openpayPlanId);
  return fila ? { plan_key: fila.plan_key, periodo: fila.periodo } : null;
}

// Estado de SMYL a partir del estado de la suscripción en Openpay.
function estadoSuscripcion(openpayStatus: any) {
  const estado = String(openpayStatus || '').toLowerCase();
  if (estado === 'active' || estado === 'trial') return 'active';
  if (estado === 'past_due' || estado === 'unpaid') return 'past_due';
  if (estado === 'cancelled' || estado === 'canceled') return 'cancelled';
  return 'unknown';
}

// Fecha de vencimiento del acceso: el fin del periodo pagado (+ 3 días de gracia). Entrada/salida ISO.
function vencimientoConGracia(periodEndIso: any, dias: any) {
  const fin = new Date(periodEndIso);
  if (Number.isNaN(fin.getTime())) return null;
  const gracia = Number.isFinite(dias) ? dias : 3;
  return new Date(fin.getTime() + gracia * 86400000).toISOString();
}

// Los webhooks de Openpay no van firmados: se autentican con usuario y contraseña (HTTP Basic) que SMYL define al darlos de alta.
function basicValido(headerAuthorization: any, usuario: any, contrasena: any) {
  if (!usuario || !contrasena || !headerAuthorization) return false;
  const m = /^Basic\s+(.+)$/i.exec(String(headerAuthorization));
  if (!m) return false;
  let decoded = '';
  try { decoded = atob(m[1]); } catch { return false; }
  const esperado = usuario + ':' + contrasena;
  if (decoded.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i += 1) diff |= decoded.charCodeAt(i) ^ esperado.charCodeAt(i);
  return diff === 0;
}

return { PLAN_KEYS, PERIODOS, PLANES_SMYL, openpayBase, resolverPlan, planDeOpenpay, estadoSuscripcion, vencimientoConGracia, basicValido };
})();

// ── _shared/openpay-billing-core.mjs ──
const { LIMITE_DIAGNOSTICOS, DIAS_GRACIA, BillingError, createBilling } = (() => {
// SMYL · Lógica de suscripciones con Openpay (sin Deno ni red propia: todo entra por `deps`, para probarla con Node).
//
// deps = {
//   op(method, path, body) -> Promise<{ status:number, data:object }>   // llamada a la API de Openpay con la llave privada del servidor
//   store: {                                                             // base de datos (service role)
//     planId(planKey, periodo) -> openpay_plan_id | null
//     planFilas() -> [{plan_key, periodo, openpay_plan_id}]
//     customer(tenantId) -> {openpay_customer_id, card_id, card_brand, card_last4} | null
//     saveCustomer(tenantId, row)
//     subscription(tenantId) -> {openpay_subscription_id, plan_key, periodo, status, ...} | null
//     saveSubscription(tenantId, row)
//     tenantByCustomer(openpayCustomerId) -> tenantId | null
//     recordEvent(key, type, tenantId) -> boolean   // true si es nuevo (idempotencia del webhook)
//     applyToTenant(tenantId, patch)
//   },
//   now() -> Date
// }
// Los parámetros son objetos simples, sin desestructurar en la firma (el empaquetador del panel de Supabase anota tipos).

// Límites de diagnósticos vigentes en el servidor mientras no existan los entitlements nuevos (tokens, GB, timbres).
const LIMITE_DIAGNOSTICOS = { esencial: 15, profesional: 40, premium: 100 };
const DIAS_GRACIA = 3;

const ERRORES_TARJETA = {
  3001: 'El banco rechazó la tarjeta. Prueba con otra.',
  3002: 'La tarjeta está vencida.',
  3003: 'La tarjeta no tiene fondos suficientes.',
  3004: 'La tarjeta fue reportada como perdida o robada.',
  3005: 'El banco la marcó como sospechosa. Usa otra tarjeta.',
  3006: 'La operación no está permitida para esta tarjeta.',
  3009: 'La tarjeta fue reportada como perdida.',
  3010: 'El banco restringió la tarjeta.',
  3011: 'El banco pidió retener la tarjeta.',
  2004: 'El número de tarjeta no es válido.',
  2005: 'La fecha de vencimiento no es válida.',
  2006: 'Falta el código de seguridad de la tarjeta.',
};

class BillingError extends Error {
  constructor(message, code, http) { super(message); this.code = code || 'billing_error'; this.http = http || 400; }
}

function errorDeOpenpay(response: any, fallback: any) {
  const data = response && response.data ? response.data : {};
  const mapped = ERRORES_TARJETA[Number(data.error_code)];
  return new BillingError(mapped || fallback, 'openpay_' + (data.error_code || response.status), mapped ? 402 : 502);
}

function fechaDia(value: any) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function createBilling(deps: any) {
  const op = deps.op, store = deps.store, now = deps.now || function () { return new Date(); };

  async function ensureCustomer(input: any) {
    const current = await store.customer(input.tenantId);
    if (current && current.openpay_customer_id) return current;
    const created = await op('POST', '/customers', {
      name: String(input.name || 'Clínica').slice(0, 100), last_name: 'SMYL',
      email: input.email, external_id: input.tenantId, requires_account: false,
    });
    if (created.status >= 300 || !created.data.id) throw errorDeOpenpay(created, 'No se pudo crear tu cuenta de pago.');
    const row = { openpay_customer_id: created.data.id, card_id: null, card_brand: null, card_last4: null };
    await store.saveCustomer(input.tenantId, row);
    return row;
  }

  async function addCard(customerId: any, tokenId: any, deviceSessionId: any) {
    const card = await op('POST', '/customers/' + customerId + '/cards', { token_id: tokenId, device_session_id: deviceSessionId });
    if (card.status >= 300 || !card.data.id) throw errorDeOpenpay(card, 'No se pudo guardar la tarjeta.');
    const number = String(card.data.card_number || '');
    return { card_id: card.data.id, card_brand: card.data.brand || null, card_last4: number.slice(-4) || null };
  }

  // Estado de la suscripción en Openpay → fila de SMYL.
  function filaDeSuscripcion(remote: any, keep: any) {
    const plan = keep && keep.plan_key ? { plan_key: keep.plan_key, periodo: keep.periodo } : null;
    return {
      openpay_subscription_id: remote.id,
      plan_key: plan ? plan.plan_key : null, periodo: plan ? plan.periodo : null,
      status: estadoSuscripcion(remote.status),
      cancel_at_period_end: Boolean(remote.cancel_at_period_end),
      next_charge_date: fechaDia(remote.charge_date),
      period_end_date: fechaDia(remote.period_end_date),
    };
  }

  async function applyAccess(tenantId: any, row: any, resetUsage: any) {
    const stamp = now();
    const patch = {};
    if (row.plan_key && PLAN_KEYS.indexOf(row.plan_key) >= 0 && row.status !== 'cancelled') {
      patch.plan = row.plan_key;
      patch.limite_diagnosticos = LIMITE_DIAGNOSTICOS[row.plan_key];
    }
    const hasta = row.next_charge_date ? vencimientoConGracia(row.next_charge_date + 'T23:59:59Z', DIAS_GRACIA) : null;
    if (row.status === 'active') {
      patch.activo = true;
      if (hasta) patch.vence_en = hasta;
      if (resetUsage) patch.diagnosticos_usados = 0;
    } else if (row.status === 'past_due') {
      // Cobro fallido: sigue activo durante la gracia; si venció, se apaga.
      const limite = hasta ? new Date(hasta).getTime() : 0;
      patch.activo = limite > stamp.getTime();
    } else if (row.status === 'cancelled') {
      // Cancelada: conserva el acceso hasta el final del periodo ya pagado.
      const fin = row.period_end_date ? new Date(row.period_end_date + 'T23:59:59Z').getTime() : 0;
      patch.activo = fin > stamp.getTime();
      if (row.period_end_date) patch.vence_en = new Date(row.period_end_date + 'T23:59:59Z').toISOString();
    }
    if (Object.keys(patch).length) await store.applyToTenant(tenantId, patch);
    return patch;
  }

  const api = {
    // Contrata o cambia de plan. El plan_id sale del servidor; el navegador solo manda plan_key + periodo + token de tarjeta.
    async subscribe(input) {
      const plan = resolverPlan(input.planKey, input.periodo);
      if (!plan) throw new BillingError('Plan no válido.', 'plan_invalido', 400);
      const planId = await store.planId(plan.plan_key, plan.periodo);
      if (!planId) throw new BillingError('Este plan todavía no está disponible para contratar.', 'plan_no_configurado', 503);
      if (!input.tokenId || !input.deviceSessionId) throw new BillingError('Faltan los datos de la tarjeta.', 'tarjeta_incompleta', 400);

      const previous = await store.subscription(input.tenantId);
      if (previous && previous.status === 'active' && previous.plan_key === plan.plan_key && previous.periodo === plan.periodo && !previous.cancel_at_period_end) {
        throw new BillingError('Ya tienes este plan activo.', 'ya_contratado', 409);
      }
      const customer = await ensureCustomer(input);
      const card = await addCard(customer.openpay_customer_id, input.tokenId, input.deviceSessionId);
      await store.saveCustomer(input.tenantId, { openpay_customer_id: customer.openpay_customer_id, card_id: card.card_id, card_brand: card.card_brand, card_last4: card.card_last4 });

      // La suscripción nueva cobra de inmediato; si el banco la rechaza, no cambia nada.
      const created = await op('POST', '/customers/' + customer.openpay_customer_id + '/subscriptions', { plan_id: planId, card_id: card.card_id });
      if (created.status >= 300 || !created.data.id) throw errorDeOpenpay(created, 'No se pudo cobrar el plan. Intenta de nuevo.');

      // Al cambiar de plan se cancela la suscripción anterior (sin prorrata: el plan nuevo cobra completo desde hoy).
      if (previous && previous.openpay_subscription_id && previous.status !== 'cancelled') {
        await op('DELETE', '/customers/' + customer.openpay_customer_id + '/subscriptions/' + previous.openpay_subscription_id);
      }
      const row = filaDeSuscripcion(created.data, { plan_key: plan.plan_key, periodo: plan.periodo });
      await store.saveSubscription(input.tenantId, row);
      await applyAccess(input.tenantId, row, true);
      return { ok: true, plan_key: plan.plan_key, periodo: plan.periodo, status: row.status, next_charge_date: row.next_charge_date, card_last4: card.card_last4 };
    },

    // Reconsulta Openpay (fuente de verdad) y deja a la clínica con el estado correcto.
    async sync(tenantId) {
      const current = await store.subscription(tenantId);
      const customer = await store.customer(tenantId);
      if (!current || !customer) return { ok: true, status: 'none' };
      const remote = await op('GET', '/customers/' + customer.openpay_customer_id + '/subscriptions/' + current.openpay_subscription_id);
      if (remote.status >= 300 || !remote.data.id) throw new BillingError('No se pudo consultar tu suscripción.', 'consulta_fallida', 502);
      const row = filaDeSuscripcion(remote.data, current);
      await store.saveSubscription(tenantId, row);
      await applyAccess(tenantId, row, false);
      return { ok: true, status: row.status, cancel_at_period_end: row.cancel_at_period_end, next_charge_date: row.next_charge_date };
    },

    // Cancelar = dejar de renovar; el acceso sigue hasta el final del periodo ya pagado.
    async cancel(tenantId) {
      const current = await store.subscription(tenantId), customer = await store.customer(tenantId);
      if (!current || !customer || current.status === 'cancelled') throw new BillingError('No tienes una suscripción activa.', 'sin_suscripcion', 404);
      const done = await op('PUT', '/customers/' + customer.openpay_customer_id + '/subscriptions/' + current.openpay_subscription_id, { cancel_at_period_end: true });
      if (done.status >= 300) throw errorDeOpenpay(done, 'No se pudo cancelar. Intenta de nuevo.');
      return api.sync(tenantId);
    },

    async resume(tenantId) {
      const current = await store.subscription(tenantId), customer = await store.customer(tenantId);
      if (!current || !customer || current.status === 'cancelled') throw new BillingError('Esta suscripción ya terminó: elige un plan para contratar de nuevo.', 'terminada', 409);
      const done = await op('PUT', '/customers/' + customer.openpay_customer_id + '/subscriptions/' + current.openpay_subscription_id, { cancel_at_period_end: false });
      if (done.status >= 300) throw errorDeOpenpay(done, 'No se pudo reactivar. Intenta de nuevo.');
      return api.sync(tenantId);
    },

    async changeCard(input) {
      const current = await store.subscription(input.tenantId), customer = await store.customer(input.tenantId);
      if (!current || !customer) throw new BillingError('Aún no tienes una suscripción.', 'sin_suscripcion', 404);
      if (!input.tokenId || !input.deviceSessionId) throw new BillingError('Faltan los datos de la tarjeta.', 'tarjeta_incompleta', 400);
      const card = await addCard(customer.openpay_customer_id, input.tokenId, input.deviceSessionId);
      const done = await op('PUT', '/customers/' + customer.openpay_customer_id + '/subscriptions/' + current.openpay_subscription_id, { card_id: card.card_id });
      if (done.status >= 300) throw errorDeOpenpay(done, 'No se pudo cambiar la tarjeta.');
      await store.saveCustomer(input.tenantId, { openpay_customer_id: customer.openpay_customer_id, card_id: card.card_id, card_brand: card.card_brand, card_last4: card.card_last4 });
      return { ok: true, card_last4: card.card_last4, card_brand: card.card_brand };
    },

    // Aviso de Openpay: nunca se confía en el contenido; solo identifica a la clínica y se reconsulta la API.
    async handleWebhook(event) {
      const type = String(event && event.type || '').slice(0, 80);
      if (type === 'verification') return { ok: true, verification: true };
      const tx = event && event.transaction ? event.transaction : {};
      const customerId = String(tx.customer_id || '');
      const eventKey = type + ':' + String(tx.id || (event && event.event_date) || '');
      if (!customerId) return { ok: true, ignored: 'sin_cliente' };
      const tenantId = await store.tenantByCustomer(customerId);
      if (!tenantId) return { ok: true, ignored: 'cliente_desconocido' }; // p. ej. cobros de pacientes de LANA en el mismo comercio
      const isNew = await store.recordEvent(eventKey, type, tenantId);
      if (!isNew) return { ok: true, duplicate: true };
      return api.sync(tenantId);
    },

    async summary(tenantId) {
      const sub = await store.subscription(tenantId), customer = await store.customer(tenantId);
      if (!sub) return { has_subscription: false };
      return {
        has_subscription: true, plan_key: sub.plan_key, periodo: sub.periodo, status: sub.status,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end), next_charge_date: sub.next_charge_date,
        card_brand: customer ? customer.card_brand : null, card_last4: customer ? customer.card_last4 : null,
      };
    },
  };
  return api;
}

return { LIMITE_DIAGNOSTICOS, DIAS_GRACIA, BillingError, createBilling };
})();

// ── _shared/openpay-runtime.ts ──
const { OPENPAY_ENV, OPENPAY_PUBLIC_KEY, OPENPAY_MERCHANT_ID, openpayConfigured, billing, billingAdmin, billingStore } = (() => {
// SMYL · Piezas de Deno para las suscripciones con Openpay: llamada a la API y acceso a la base (rol de servicio).
// La lógica de cobro vive en openpay-billing-core.mjs (pura, con pruebas); aquí solo se conecta a Openpay y a Supabase.
//
// Secrets de la función (Project Settings → Edge Functions → Secrets):
//   OPENPAY_MERCHANT_ID, OPENPAY_PRIVATE_KEY (sk_…, SOLO servidor), OPENPAY_PUBLIC_KEY (pk_…, se entrega al navegador),
//   OPENPAY_ENV = sandbox | production, y para el aviso de pagos OPENPAY_WEBHOOK_USER / OPENPAY_WEBHOOK_PASSWORD.

const SB_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
const SB_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_ROLE_KEY") || "";
const admin = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

const OPENPAY_ENV = Deno.env.get("OPENPAY_ENV") === "production" ? "production" : "sandbox";
const MERCHANT = Deno.env.get("OPENPAY_MERCHANT_ID") || "";
const PRIVATE_KEY = Deno.env.get("OPENPAY_PRIVATE_KEY") || "";
const OPENPAY_PUBLIC_KEY = Deno.env.get("OPENPAY_PUBLIC_KEY") || "";
const OPENPAY_MERCHANT_ID = MERCHANT;

function openpayConfigured(): boolean {
  return Boolean(MERCHANT && PRIVATE_KEY && OPENPAY_PUBLIC_KEY);
}

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

async function op(method: string, path: string, body?: unknown): Promise<{ status: number; data: Json }> {
  const response = await fetch(`${openpayBase(OPENPAY_ENV)}/${MERCHANT}${path}`, {
    method,
    headers: { Authorization: "Basic " + btoa(PRIVATE_KEY + ":"), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await response.text();
  let data: Json = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  return { status: response.status, data };
}

const store = {
  async planId(planKey: string, periodo: string): Promise<string | null> {
    const { data } = await admin.from("smyl_billing_plans").select("openpay_plan_id")
      .eq("plan_key", planKey).eq("periodo", periodo).eq("environment", OPENPAY_ENV).maybeSingle();
    return data?.openpay_plan_id || null;
  },
  async planFilas(): Promise<Json[]> {
    const { data } = await admin.from("smyl_billing_plans").select("plan_key,periodo,openpay_plan_id").eq("environment", OPENPAY_ENV);
    return data || [];
  },
  async customer(tenantId: string): Promise<Json | null> {
    const { data } = await admin.from("smyl_billing_customers").select("openpay_customer_id,card_id,card_brand,card_last4")
      .eq("tenant_id", tenantId).eq("environment", OPENPAY_ENV).maybeSingle();
    return data || null;
  },
  async saveCustomer(tenantId: string, row: Json): Promise<void> {
    const { error } = await admin.from("smyl_billing_customers").upsert(
      { tenant_id: tenantId, environment: OPENPAY_ENV, ...row, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,environment" });
    if (error) throw new Error("No se pudo guardar tu cuenta de pago.");
  },
  async subscription(tenantId: string): Promise<Json | null> {
    const { data } = await admin.from("smyl_billing_subscriptions")
      .select("openpay_subscription_id,plan_key,periodo,status,cancel_at_period_end,next_charge_date,period_end_date")
      .eq("tenant_id", tenantId).eq("environment", OPENPAY_ENV).maybeSingle();
    return data || null;
  },
  async saveSubscription(tenantId: string, row: Json): Promise<void> {
    const { error } = await admin.from("smyl_billing_subscriptions").upsert(
      { tenant_id: tenantId, environment: OPENPAY_ENV, ...row, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,environment" });
    if (error) throw new Error("No se pudo guardar tu suscripción.");
  },
  async tenantByCustomer(openpayCustomerId: string): Promise<string | null> {
    const { data } = await admin.from("smyl_billing_customers").select("tenant_id")
      .eq("environment", OPENPAY_ENV).eq("openpay_customer_id", openpayCustomerId).maybeSingle();
    return data?.tenant_id || null;
  },
  async recordEvent(key: string, type: string, tenantId: string | null): Promise<boolean> {
    const { error } = await admin.from("smyl_billing_events").insert({ event_key: key, environment: OPENPAY_ENV, event_type: type, tenant_id: tenantId });
    if (!error) return true;
    if ((error as Json).code === "23505") return false; // ya procesado
    throw new Error("No se pudo registrar el aviso de pago.");
  },
  async applyToTenant(tenantId: string, patch: Json): Promise<void> {
    const { error } = await admin.from("camila_tenants").update(patch).eq("id", tenantId);
    if (error) throw new Error("No se pudo actualizar tu plan.");
  },
};

const billing = createBilling({ op, store, now: () => new Date() });

return { OPENPAY_ENV, OPENPAY_PUBLIC_KEY, OPENPAY_MERCHANT_ID, openpayConfigured, billing, billingAdmin: admin, billingStore: store };
})();

// ── openpay-billing-webhook/index.ts ──
// Aviso de pagos de Openpay para las suscripciones de SMYL (servidor a servidor, SIN JWT: despliégala con la verificación de JWT apagada).
//
// Openpay no firma sus avisos: se autentican con el usuario y la contraseña (HTTP Basic) que se definen al dar de alta el webhook
// (OPENPAY_WEBHOOK_USER / OPENPAY_WEBHOOK_PASSWORD). Aun así NO se confía en el contenido: solo identifica a la clínica y se reconsulta la API.
// Alta del webhook en Openpay: URL = https://<proyecto>.supabase.co/functions/v1/openpay-billing-webhook, eventos:
//   charge.succeeded, charge.failed, subscription.charge.failed (y los de suscripción que ofrezca el panel).
// Al registrarlo Openpay manda un evento `verification` con un código: queda en los registros de la función y en smyl_billing_events.

const USER = Deno.env.get("OPENPAY_WEBHOOK_USER") || "";
const PASSWORD = Deno.env.get("OPENPAY_WEBHOOK_PASSWORD") || "";
const MAX_BODY = 16384;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });
  if (!basicValido(req.headers.get("authorization"), USER, PASSWORD)) return reply(401, { error: "unauthorized" });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, { error: "too_large" });
  // deno-lint-ignore no-explicit-any
  let event: Record<string, any> = {};
  try { event = JSON.parse(raw); } catch { return reply(400, { error: "invalid_json" }); }

  try {
    if (event.type === "verification") {
      const code = String(event.verification_code || "").slice(0, 40);
      console.log("[openpay-billing-webhook] código de verificación:", code);
      if (code) await billingAdmin.from("smyl_billing_events").upsert({ event_key: "verification:" + code, environment: OPENPAY_ENV, event_type: "verification" }, { onConflict: "event_key,environment", ignoreDuplicates: true });
      return reply(200, { ok: true });
    }
    return reply(200, await billing.handleWebhook(event));
  } catch (error) {
    // 500 → Openpay reintenta el aviso más tarde.
    console.error("[openpay-billing-webhook]", (error as Error)?.message);
    return reply(500, { error: "No se pudo procesar el aviso." });
  }
});
