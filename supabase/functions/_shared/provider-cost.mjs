// SMYL · Costo de una llamada a un proveedor de IA en pesos. Mismo cálculo que smyl_price_per_unit_mxn / smyl_operation_cost_mxn
// (migración 20261124120000), pero sobre el uso REAL de una llamada (tokens, imágenes, segundos) para registrar el costo de cada operación.
// Lógica pura, sin red ni base de datos. Los parámetros son objetos simples (el empaquetador del panel de Supabase anota tipos).
//
// prices:   filas de smyl_provider_prices  {provider, model, metric, per_units, price, currency, effective_from}
// settings: fila de smyl_cost_settings     {fx_usd_mxn, fx_buffer_pct, credit_value_mxn}

export const METRICS = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'image', 'audio_seconds', 'request'];

function day(value) { return String(value || new Date().toISOString()).slice(0, 10); }

// Precio de UNA unidad de la métrica en MXN, o null si falta el precio (o el tipo de cambio para precios en USD).
export function unitPriceMxn(prices, settings, provider, model, metric, at) {
  const when = day(at);
  let best = null;
  for (const row of prices || []) {
    if (row.provider !== provider || row.model !== model || row.metric !== metric) continue;
    if (String(row.effective_from).slice(0, 10) > when) continue;
    if (!best || String(row.effective_from) > String(best.effective_from)) best = row;
  }
  if (!best || best.price == null) return null;
  const perUnit = Number(best.price) / Number(best.per_units || 1);
  if (!Number.isFinite(perUnit)) return null;
  if (best.currency === 'MXN') return perUnit;
  const fx = settings && settings.fx_usd_mxn != null ? Number(settings.fx_usd_mxn) : null;
  if (!(fx > 0)) return null;
  const buffer = settings && settings.fx_buffer_pct != null ? Number(settings.fx_buffer_pct) : 0;
  return perUnit * fx * (1 + buffer / 100);
}

// Costo de una llamada concreta. usage = { input_tokens, cached_input_tokens, output_tokens, image, audio_seconds, request }.
// Devuelve { cost_mxn, complete, missing[] }: si falta el precio de algo que sí se usó, no se inventa: complete = false.
export function usageCostMxn(prices, settings, provider, model, usage, at) {
  let total = 0; const missing = [];
  for (const metric of METRICS) {
    const quantity = Number(usage && usage[metric] || 0);
    if (!(quantity > 0)) continue;
    const unit = unitPriceMxn(prices, settings, provider, model, metric, at);
    if (unit == null) { missing.push(provider + '/' + model + '/' + metric); continue; }
    total += unit * quantity;
  }
  const complete = missing.length === 0;
  return { cost_mxn: complete ? Math.round(total * 1e6) / 1e6 : null, complete, missing };
}

// Costo estimado de una operación definida por componentes [{provider, model, metric, quantity}].
export function operationCostMxn(prices, settings, components, at) {
  let total = 0; const missing = [];
  for (const part of components || []) {
    const unit = unitPriceMxn(prices, settings, part.provider, part.model, part.metric, at);
    if (unit == null) { missing.push(part.provider + '/' + part.model + '/' + part.metric); continue; }
    total += unit * Number(part.quantity || 0);
  }
  const complete = missing.length === 0;
  const credit = settings && Number(settings.credit_value_mxn) > 0 ? Number(settings.credit_value_mxn) : 0.5;
  return { cost_mxn: complete ? Math.round(total * 1e4) / 1e4 : null, complete, missing, credits_suggested: complete ? Math.max(1, Math.ceil(total / credit)) : null };
}

// Créditos que debería valer un costo ya calculado (mínimo 1).
export function creditsForCost(costMxn, settings) {
  const credit = settings && Number(settings.credit_value_mxn) > 0 ? Number(settings.credit_value_mxn) : 0.5;
  return Number.isFinite(Number(costMxn)) ? Math.max(1, Math.ceil(Number(costMxn) / credit)) : null;
}
