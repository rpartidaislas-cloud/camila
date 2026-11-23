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
import { PLAN_KEYS, resolverPlan, estadoSuscripcion, vencimientoConGracia } from './openpay-plans.mjs';

// Límites de diagnósticos vigentes en el servidor mientras no existan los entitlements nuevos (tokens, GB, timbres).
export const LIMITE_DIAGNOSTICOS = { esencial: 15, profesional: 40, premium: 100 };
export const DIAS_GRACIA = 3;

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

export class BillingError extends Error {
  constructor(message, code, http) { super(message); this.code = code || 'billing_error'; this.http = http || 400; }
}

function errorDeOpenpay(response, fallback) {
  const data = response && response.data ? response.data : {};
  const mapped = ERRORES_TARJETA[Number(data.error_code)];
  return new BillingError(mapped || fallback, 'openpay_' + (data.error_code || response.status), mapped ? 402 : 502);
}

function fechaDia(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function createBilling(deps) {
  const op = deps.op, store = deps.store, now = deps.now || function () { return new Date(); };

  async function ensureCustomer(input) {
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

  async function addCard(customerId, tokenId, deviceSessionId) {
    const card = await op('POST', '/customers/' + customerId + '/cards', { token_id: tokenId, device_session_id: deviceSessionId });
    if (card.status >= 300 || !card.data.id) throw errorDeOpenpay(card, 'No se pudo guardar la tarjeta.');
    const number = String(card.data.card_number || '');
    return { card_id: card.data.id, card_brand: card.data.brand || null, card_last4: number.slice(-4) || null };
  }

  // Estado de la suscripción en Openpay → fila de SMYL.
  function filaDeSuscripcion(remote, keep) {
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

  async function applyAccess(tenantId, row, resetUsage) {
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
