// SMYL · Catálogo de planes de suscripción y utilidades puras de Openpay.
// Fuente única del precio: el navegador NUNCA manda precio ni plan_id; solo plan_key + periodo.
// Sin Deno ni red, para poder probarlo con Node. (Parámetros sin desestructurar: el empaquetador anota tipos.)

export const PLAN_KEYS = ['esencial', 'profesional', 'premium'];
export const PERIODOS = ['mensual', 'anual'];

export const PLANES_SMYL = [
  { plan_key: 'esencial', periodo: 'mensual', name: 'SMYL Esencial mensual', amount: 299, repeat_unit: 'month' },
  { plan_key: 'esencial', periodo: 'anual', name: 'SMYL Esencial anual', amount: 2990, repeat_unit: 'year' },
  { plan_key: 'profesional', periodo: 'mensual', name: 'SMYL Profesional mensual', amount: 899, repeat_unit: 'month' },
  { plan_key: 'profesional', periodo: 'anual', name: 'SMYL Profesional anual', amount: 8990, repeat_unit: 'year' },
  { plan_key: 'premium', periodo: 'mensual', name: 'SMYL Premium mensual', amount: 1499, repeat_unit: 'month' },
  // Openpay limita cada cobro de un plan a $10,000: el anual de Premium ($14,990) se cobra en 2 pagos semestrales que suman lo mismo.
  { plan_key: 'premium', periodo: 'anual', name: 'SMYL Premium anual (2 pagos semestrales)', amount: 7495, repeat_every: 6, repeat_unit: 'month', total_anual: 14990 },
];

export function openpayBase(env) {
  return env === 'production' ? 'https://api.openpay.mx/v1' : 'https://sandbox-api.openpay.mx/v1';
}

// Plan pedido por el cliente → definición del servidor, o null si no existe.
export function resolverPlan(planKey, periodo) {
  if (typeof planKey !== 'string' || typeof periodo !== 'string') return null;
  return PLANES_SMYL.find((item) => item.plan_key === planKey && item.periodo === periodo) || null;
}

// Plan de SMYL al que corresponde un plan_id de Openpay, según la tabla smyl_billing_plans (filas {plan_key, periodo, openpay_plan_id}).
export function planDeOpenpay(openpayPlanId, filas) {
  if (!openpayPlanId || !Array.isArray(filas)) return null;
  const fila = filas.find((item) => item.openpay_plan_id === openpayPlanId);
  return fila ? { plan_key: fila.plan_key, periodo: fila.periodo } : null;
}

// Estado de SMYL a partir del estado de la suscripción en Openpay.
export function estadoSuscripcion(openpayStatus) {
  const estado = String(openpayStatus || '').toLowerCase();
  if (estado === 'active' || estado === 'trial') return 'active';
  if (estado === 'past_due' || estado === 'unpaid') return 'past_due';
  if (estado === 'cancelled' || estado === 'canceled') return 'cancelled';
  return 'unknown';
}

// Fecha de vencimiento del acceso: el fin del periodo pagado (+ 3 días de gracia). Entrada/salida ISO.
export function vencimientoConGracia(periodEndIso, dias) {
  const fin = new Date(periodEndIso);
  if (Number.isNaN(fin.getTime())) return null;
  const gracia = Number.isFinite(dias) ? dias : 3;
  return new Date(fin.getTime() + gracia * 86400000).toISOString();
}

// Los webhooks de Openpay no van firmados: se autentican con usuario y contraseña (HTTP Basic) que SMYL define al darlos de alta.
export function basicValido(headerAuthorization, usuario, contrasena) {
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
