// SMYL · Plan y suscripción: consumo del mes con barras, estado de cobro y avisos.
// Solo lo que SMYL cobra o limita (IA, MILA, almacenamiento, timbres). Los mensajes de WhatsApp/Meta los paga la clínica a Meta.
// Lee lo mismo que la pantalla de Consumo (smyl_usage_overview) y el resumen de cobro (smyl_billing_summary). No inventa cifras:
// si un medidor aún no existe, se muestra lo que incluye el plan y la etiqueta «Sin medidor».
(function () {
  'use strict';
  var ROOT_ID = 'plan-usage-root';
  var state = { overview: null, billing: null, loaded: false, loading: false, failed: false };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(value, digits) { var n = Number(value); return Number.isFinite(n) ? n.toLocaleString('es-MX', { maximumFractionDigits: digits == null ? 0 : digits }) : '—'; }
  function gb(bytes) { return num(Number(bytes) / 1073741824, 2); }
  function tenant() { return window.tenantData || {}; }
  function planKey() { var p = tenant().plan; return window.PLANES && window.PLANES[p] ? p : 'profesional'; }
  function resource(name) {
    var list = state.overview && Array.isArray(state.overview.resources) ? state.overview.resources : [];
    for (var i = 0; i < list.length; i += 1) if (list[i].resource === name) return list[i];
    return null;
  }
  function pct(used, limit) { var u = Number(used), l = Number(limit); if (!(l > 0) || !Number.isFinite(u)) return null; return Math.max(0, Math.min(100, Math.round(u / l * 100))); }
  function level(percent) { if (percent == null) return 'none'; if (percent >= 100) return 'full'; if (percent >= 85) return 'high'; if (percent >= 70) return 'mid'; return 'ok'; }
  var LEVEL_TEXT = { ok: 'Todo en orden', mid: 'Va avanzado', high: 'Casi al límite', full: 'Límite alcanzado', none: '' };
  var ICONS = {
    ai: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    cloud: '<path d="M7 18a4 4 0 010-8 5.5 5.5 0 0110.6 1.5A3.3 3.3 0 0117 18z"/>',
    stamp: '<path d="M7 3h10v6H7zM4 13h16v3H4zM6 19h12"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.chart) + '</svg>'; }

  // Fracción transcurrida del mes calendario: sirve para estimar el cierre (solo orientativo).
  function monthFraction() {
    var now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), 1), end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return Math.max(0.05, (now - start) / (end - start));
  }

  // Un medidor: { key, label, icon, valueText, ofText, percent, foot, buyText, buyHref, note }
  function meters() {
    var plan = window.PLANES && window.PLANES[planKey()] ? window.PLANES[planKey()] : { label: '' };
    var rows = [];
    var t = tenant();
    // 1. Análisis con IA (lo que hoy hace cumplir el servidor)
    if (t.limite_diagnosticos) {
      var used = Number(t.diagnosticos_usados || 0), limit = Number(t.limite_diagnosticos);
      rows.push({ key: 'analisis', label: 'Análisis con IA', icon: 'ai', value: num(used), of: 'de ' + num(limit) + ' este mes', percent: pct(used, limit), remaining: Math.max(0, limit - used), unit: 'análisis', buy: true });
    }
    // 2. Créditos de IA
    var ai = resource('ai_credits');
    if (ai && (ai.limit_units != null || ai.balance_units != null)) {
      var aiLimit = ai.limit_units != null ? Number(ai.limit_units) : null, aiUsed = Number(ai.used_units || 0);
      rows.push({ key: 'ai', label: 'Créditos de IA', icon: 'ai', value: num(aiUsed), of: aiLimit ? 'de ' + num(aiLimit) + ' del periodo' : 'usados este mes', percent: aiLimit ? pct(aiUsed, aiLimit) : null, remaining: aiLimit ? Math.max(0, aiLimit - aiUsed) : (ai.balance_units != null ? Number(ai.balance_units) : null), unit: 'créditos', buy: true });
    }
    // 3. Minutos de MILA
    var mila = resource('mila_seconds');
    if (mila && (mila.limit_units != null || mila.balance_units != null)) {
      var mLimit = mila.limit_units != null ? Number(mila.limit_units) / 60 : null, mUsed = Number(mila.used_units || 0) / 60;
      rows.push({ key: 'mila', label: 'Minutos de MILA', icon: 'mic', value: num(mUsed), of: mLimit ? 'de ' + num(mLimit) + ' min' : 'min usados este mes', percent: mLimit ? pct(mUsed, mLimit) : null, remaining: mLimit ? Math.max(0, mLimit - mUsed) : (mila.balance_units != null ? Number(mila.balance_units) / 60 : null), unit: 'min', buy: true });
    }
    // Los mensajes de WhatsApp/Meta NO se muestran: se pagan directamente a Meta. Aquí solo cuenta lo que consume la IA de SMYL.
    // 5. Almacenamiento
    var st = state.overview && state.overview.storage;
    if (st && st.status === 'available' && Number(st.quota_bytes) > 0) {
      var sp = pct(st.used_bytes, st.quota_bytes);
      rows.push({ key: 'storage', label: 'Almacenamiento', icon: 'cloud', value: gb(st.used_bytes) + ' GB', of: 'de ' + gb(st.quota_bytes) + ' GB', percent: sp, remainingText: gb(Math.max(0, Number(st.quota_bytes) - Number(st.used_bytes))) + ' GB libres', buy: true });
    } else {
      rows.push({ key: 'storage', label: 'Almacenamiento', icon: 'cloud', value: 'Incluye ' + (plan.label === 'Esencial' ? '3' : plan.label === 'Premium' ? '100' : '25') + ' GB', of: 'Aún sin medidor', percent: null, buy: true, noMeter: true });
    }
    return rows;
  }

  function meterCard(m) {
    var lv = level(m.percent);
    var foot;
    if (m.noMeter) foot = '<span class="pu-muted">Medidor en preparación para tu clínica.</span>';
    else if (m.percent == null) foot = '<span class="pu-muted">Sin tope definido en tu plan.</span>';
    else {
      var left = m.remainingText || (m.remaining != null ? 'Quedan ' + num(m.remaining) + ' ' + m.unit : '');
      foot = '<span>' + esc(left) + '</span><span class="pu-lv pu-lv-' + lv + '">' + esc(LEVEL_TEXT[lv]) + '</span>';
    }
    var proj = '';
    if (m.percent != null && m.percent >= 30 && m.percent < 85) {
      var est = Math.round(m.percent / monthFraction());
      if (est >= 100) proj = '<p class="pu-proj">A este ritmo llegarás al límite antes de fin de mes.</p>';
    }
    return '<article class="pu-card pu-' + lv + '"><div class="pu-head"><span class="pu-ico">' + icon(m.icon) + '</span><strong>' + esc(m.label) + '</strong>' +
      (m.percent != null ? '<span class="pu-pct">' + m.percent + '%</span>' : '') + '</div>' +
      '<div class="pu-val">' + esc(m.value) + ' <small>' + esc(m.of) + '</small></div>' +
      '<div class="pu-bar" role="progressbar" aria-label="' + esc(m.label) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (m.percent == null ? 0 : m.percent) + '"><span style="width:' + (m.percent == null ? 0 : m.percent) + '%"></span></div>' +
      '<div class="pu-foot">' + foot + '</div>' + proj +
      (m.buy ? '<a class="pu-buy" href="consumos.html">Comprar más</a>' : '') + '</article>';
  }

  function stampsCard() {
    var key = planKey();
    var included = key === 'premium' ? '150 al mes' : key === 'profesional' ? '50 al mes' : 'Sin timbres';
    var of = key === 'esencial' ? 'incluidos: compra paquetes cuando los necesites' : 'incluidos en tu plan';
    return '<article class="pu-card pu-none"><div class="pu-head"><span class="pu-ico">' + icon('stamp') + '</span><strong>Timbres fiscales</strong></div>' +
      '<div class="pu-val">' + esc(included) + ' <small>' + esc(of) + '</small></div>' +
      '<div class="pu-bar" aria-hidden="true"><span style="width:0"></span></div>' +
      '<div class="pu-foot"><span class="pu-muted">Sin medidor: los timbres usados aparecen en Facturación.</span></div>' +
      '<a class="pu-buy" href="consumos.html">Comprar paquete</a></article>';
  }

  function billingPanel() {
    var b = state.billing, t = tenant();
    var plan = window.PLANES && window.PLANES[planKey()];
    var rows = [];
    if (b && b.has_subscription) {
      var status = { active: 'Activa', past_due: 'Pago pendiente', cancelled: 'Cancelada', unknown: 'En revisión' }[b.status] || b.status;
      rows.push(['Estado', '<span class="pu-chip pu-chip-' + esc(b.status) + '">' + esc(status) + (b.cancel_at_period_end ? ' · no se renovará' : '') + '</span>']);
      rows.push(['Facturación', esc(b.periodo === 'anual' ? 'Anual' : 'Mensual')]);
      rows.push([b.cancel_at_period_end ? 'Acceso hasta' : 'Próximo cobro', esc(fecha(b.next_charge_date))]);
      if (b.card_last4) rows.push(['Tarjeta', esc((b.card_brand || 'Tarjeta') + ' •••• ' + b.card_last4)]);
    } else {
      rows.push(['Estado', '<span class="pu-chip pu-chip-active">Plan activo</span>']);
      if (t.vence_en) rows.push(['Renovación', esc(fecha(t.vence_en))]);
      rows.push(['Pago', 'Aún sin tarjeta registrada']);
    }
    return '<article class="pu-bill"><h3>Tu suscripción</h3><dl>' + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>'; }).join('') + '</dl>' +
      '</article>';
  }
  function fecha(value) { if (!value) return '—'; var d = new Date(String(value).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? '—' : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }); }

  function upsell(rows) {
    if (planKey() === 'premium') return '';
    var hot = rows.filter(function (m) { return m.percent != null && m.percent >= 85; });
    if (!hot.length) return '';
    var labels = hot.map(function (m) { return m.label; });
    var names = labels.length > 1 ? labels.slice(0, -1).join(', ') + ' y ' + labels[labels.length - 1] : labels[0];
    return '<div class="pu-upsell" role="status"><div><strong>Estás cerca del límite en ' + esc(names) + '.</strong><span>Con un plan mayor tienes más cuota incluida cada mes y descuento en los paquetes extra.</span></div>' +
      '<button type="button" class="btn btn-primary" onclick="abrirModalPlanes()">Ver planes</button></div>';
  }

  function render() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (!state.loaded && !state.failed) { root.innerHTML = '<div class="pu-grid"><div class="sk sk-card" style="height:150px"></div><div class="sk sk-card" style="height:150px"></div><div class="sk sk-card" style="height:150px"></div><div class="sk sk-card" style="height:150px"></div></div>'; return; }
    var rows = meters();
    root.innerHTML = '<div class="pu-title"><div><h2>Consumo de este mes</h2><p>Lo que has usado de lo incluido en tu plan y lo que te queda.</p></div>' +
      '<a class="btn btn-secondary" href="consumos.html">Ver detalle y comprar extras</a></div>' +
      (state.failed ? '<p class="pu-warn" role="status">No pudimos actualizar todos los medidores. Mostramos lo último disponible.</p>' : '') +
      upsell(rows) + '<div class="pu-grid">' + rows.map(meterCard).join('') + stampsCard() + '</div>' + billingPanel();
  }

  async function load() {
    if (state.loading || !window.sb) return;
    state.loading = true; render();
    var results = await Promise.all([
      Promise.resolve(window.sb.rpc('smyl_usage_overview', { p_period: 'current' })).then(function (r) { return r; }, function () { return { error: true }; }),
      Promise.resolve(window.sb.rpc('smyl_billing_summary')).then(function (r) { return r; }, function () { return { error: true }; })
    ]);
    var overview = results[0], billing = results[1];
    var payload = overview && !overview.error ? (Array.isArray(overview.data) ? overview.data[0] : overview.data) : null;
    state.overview = payload || state.overview; state.failed = !payload;
    var summary = billing && !billing.error ? billing.data : null;
    state.billing = summary && typeof summary === 'object' ? summary : state.billing;
    state.loaded = true; state.loading = false; render();
  }

  function init() {
    if (!document.getElementById(ROOT_ID)) return;
    var original = window.renderPlan;
    if (typeof original === 'function' && !original.smylWrapped) {
      var wrapped = function () { var out = original.apply(this, arguments); render(); return out; };
      wrapped.smylWrapped = true; window.renderPlan = wrapped;
    }
    var go = window.ir;
    if (typeof go === 'function' && !go.smylPlanWrapped) {
      var navigate = function (route) { var out = go.apply(this, arguments); if (route === 'plan') load(); return out; };
      navigate.smylPlanWrapped = true; window.ir = navigate;
    }
    var screen = document.getElementById('p-plan');
    if (screen && screen.classList.contains('activa')) load();
  }

  window.SmylPlanUsage = Object.freeze({ reload: load, render: render });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
