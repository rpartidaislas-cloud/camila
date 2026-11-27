// SMYL · Plan y suscripción con tarjeta (Openpay).
// La tarjeta se convierte en un token directamente con Openpay (openpay.js); a SMYL solo llega el token. El precio y el plan_id
// los decide el servidor (Edge Function openpay-billing): aquí solo se manda plan_key + periodo.
// Se muestra dentro del modal «Elige tu plan» (#modal-planes) que ya existe en app.html.
(function () {
  'use strict';
  var SDK = 'https://resources.openpay.mx/lib/openpay-js/1.2.38/openpay.v1.min.js';
  var SDK_DATA = 'https://resources.openpay.mx/lib/openpay-data-js/1.2.38/openpay-data.v1.min.js';
  var state = { config: null, busy: false, deviceId: '' };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function host() { return document.getElementById('mp-planes-grid'); }
  function title(text) { var h = document.querySelector('#modal-planes .modal-header h3'); if (h) h.textContent = text; }
  function money(n) { return '$' + Number(n).toLocaleString('es-MX'); }
  function plans() { return window.PLANES || {}; }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-smyl-billing-src="' + src + '"]')) { resolve(); return; }
      var tag = document.createElement('script'); tag.src = src; tag.async = true; tag.dataset.smylBillingSrc = src;
      tag.onload = function () { resolve(); }; tag.onerror = function () { tag.remove(); reject(new Error('No se pudo cargar el módulo de pago seguro. Revisa tu internet e intenta de nuevo.')); };
      document.head.appendChild(tag);
    });
  }

  async function call(action, body) {
    var session = await window.sb.auth.getSession();
    var token = session && session.data && session.data.session ? session.data.session.access_token : null;
    if (!token) throw new Error('Tu sesión expiró, vuelve a iniciar sesión.');
    var response;
    try {
      response = await fetch(window.SUPA_URL + '/functions/v1/openpay-billing', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(Object.assign({ action: action }, body || {}))
      });
    } catch (_) { throw new Error('No se pudo conectar con el servidor de pagos. Intenta de nuevo en unos minutos.'); }
    var data = {}; try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) { var error = new Error(data.error || 'No se pudo completar la operación.'); error.code = data.code; error.status = response.status; throw error; }
    return data;
  }

  function message(kind, text) { return '<p class="bill-msg is-' + kind + '" role="' + (kind === 'error' ? 'alert' : 'status') + '">' + esc(text) + '</p>'; }
  function backButton(label, action) { return '<button type="button" class="bill-back" data-bill="' + action + '">← ' + esc(label) + '</button>'; }

  function chargeText(planKey, periodo) {
    var p = plans()[planKey]; if (!p) return '';
    if (periodo === 'anual' && planKey === 'premium') return 'Se cobra hoy ' + money(p.anual / 2) + ' y otros ' + money(p.anual / 2) + ' en 6 meses (' + money(p.anual) + ' al año).';
    if (periodo === 'anual') return 'Se cobra hoy ' + money(p.anual) + ' y se renueva cada año.';
    return 'Se cobra hoy ' + money(p.mensual) + ' y se renueva cada mes.';
  }
  function firstChargeAmount(planKey, periodo) { var p = plans()[planKey]; return periodo === 'anual' ? (planKey === 'premium' ? p.anual / 2 : p.anual) : p.mensual; }

  // ── Elegir plan → formulario de tarjeta ──
  async function choose(planKey) {
    if (state.busy || !plans()[planKey]) return;
    var periodo = window.planPeriodoElegido === 'anual' ? 'anual' : 'mensual';
    host().innerHTML = '<p class="bill-wait">Preparando el pago seguro…</p>';
    try {
      state.config = state.config || await call('config');
      await loadScript(SDK); await loadScript(SDK_DATA);
    } catch (error) {
      host().innerHTML = backButton('Volver a los planes', 'plans') + message('error', error.message); bind(); return;
    }
    renderForm(planKey, periodo, '');
  }

  function renderForm(planKey, periodo, errorText) {
    var p = plans()[planKey], cfg = state.config || {};
    title('Pago con tarjeta');
    host().innerHTML = backButton('Cambiar de plan', 'plans') +
      '<div class="bill-summary"><strong>' + esc(p.label) + ' · ' + (periodo === 'anual' ? 'anual' : 'mensual') + '</strong><span>' + esc(chargeText(planKey, periodo)) + '</span></div>' +
      (cfg.sandbox ? '<p class="bill-sandbox">Modo de pruebas: usa la tarjeta 4111 1111 1111 1111, cualquier fecha futura y CVV 123. No se hace ningún cobro real.</p>' : '') +
      (errorText ? message('error', errorText) : '') +
      '<form id="bill-form" autocomplete="on" novalidate>' +
        '<label>Nombre en la tarjeta<input name="holder" autocomplete="cc-name" maxlength="80" required></label>' +
        '<label>Número de tarjeta<input name="number" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="0000 0000 0000 0000" required></label>' +
        '<div class="bill-row"><label>Mes<input name="month" inputmode="numeric" autocomplete="cc-exp-month" maxlength="2" placeholder="MM" required></label>' +
        '<label>Año<input name="year" inputmode="numeric" autocomplete="cc-exp-year" maxlength="2" placeholder="AA" required></label>' +
        '<label>CVV<input name="cvv" inputmode="numeric" autocomplete="cc-csc" maxlength="4" placeholder="123" required></label></div>' +
        '<button class="btn btn-primary bill-pay" type="submit">Pagar ' + money(firstChargeAmount(planKey, periodo)) + '</button>' +
        '<p class="bill-safe">🔒 Pago seguro con Openpay. Tu tarjeta no se guarda en SMYL; puedes cancelar la renovación cuando quieras.</p>' +
      '</form>';
    bind();
    var form = document.getElementById('bill-form');
    form.addEventListener('submit', function (event) { event.preventDefault(); pay(planKey, periodo, form); });
    var number = form.elements.number; number.addEventListener('input', function () { number.value = number.value.replace(/[^\d]/g, '').replace(/(.{4})/g, '$1 ').trim(); });
    try { state.deviceId = window.OpenPay.deviceData.setup('bill-form', 'bill_device_id'); } catch (_) { state.deviceId = ''; }
    number.focus();
  }

  function tokenize(form) {
    return new Promise(function (resolve, reject) {
      var OP = window.OpenPay, cfg = state.config;
      OP.setId(cfg.merchant_id); OP.setApiKey(cfg.public_key); OP.setSandboxMode(Boolean(cfg.sandbox));
      var raw = String(form.elements.number.value).replace(/\s/g, '');
      if (!OP.card.validateCardNumber(raw)) { reject(new Error('El número de tarjeta no es válido.')); return; }
      if (!OP.card.validateExpiry(form.elements.month.value, form.elements.year.value)) { reject(new Error('La fecha de vencimiento no es válida.')); return; }
      if (!OP.card.validateCVC(form.elements.cvv.value, raw)) { reject(new Error('El código de seguridad (CVV) no es válido.')); return; }
      if (String(form.elements.holder.value).trim().length < 3) { reject(new Error('Escribe el nombre como aparece en la tarjeta.')); return; }
      OP.token.create({ card_number: raw, holder_name: String(form.elements.holder.value).trim(), expiration_year: form.elements.year.value, expiration_month: form.elements.month.value, cvv2: form.elements.cvv.value },
        function (response) { resolve(response.data.id); },
        function (error) { reject(new Error(error && error.data && error.data.description ? 'No se pudo validar la tarjeta. Revisa los datos.' : 'No se pudo validar la tarjeta.')); });
    });
  }

  async function pay(planKey, periodo, form) {
    if (state.busy) return;
    state.busy = true;
    var button = form.querySelector('.bill-pay'), label = button.textContent; button.disabled = true; button.textContent = 'Procesando el pago…';
    try {
      var tokenId = await tokenize(form);
      var deviceId = state.deviceId || (form.elements.bill_device_id ? form.elements.bill_device_id.value : '');
      var result = await call('subscribe', { plan_key: planKey, periodo: periodo, token_id: tokenId, device_session_id: deviceId });
      await refreshTenant();
      var p = plans()[planKey]; title('Listo');
      host().innerHTML = '<div class="bill-done"><div class="bill-check">✓</div><h4>Tu plan ' + esc(p.label) + ' está activo</h4>' +
        '<p>Tarjeta terminación ' + esc(result.card_last4 || '····') + '. ' + (result.next_charge_date ? 'Próximo cobro: ' + esc(fechaLarga(result.next_charge_date)) + '.' : '') + '</p>' +
        '<button type="button" class="btn btn-primary" data-bill="close">Listo</button></div>';
      bind();
    } catch (error) {
      state.busy = false; renderForm(planKey, periodo, error.message || 'No se pudo completar el pago.'); return;
    }
    state.busy = false;
  }

  function fechaLarga(day) { var d = new Date(String(day).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? day : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }); }

  async function refreshTenant() {
    try {
      var res = await window.sb.from('camila_tenants').select('*').eq('id', window.tenantId).maybeSingle();
      if (res && res.data && window.tenantData) Object.assign(window.tenantData, res.data);
      if (typeof window.renderPlan === 'function') window.renderPlan();
      if (typeof window.renderSidebar === 'function') window.renderSidebar();
    } catch (_) { /* la pantalla se actualiza al recargar */ }
  }

  // ── Gestionar la suscripción ──
  var STATUS = { active: 'Activa', past_due: 'Pago pendiente', cancelled: 'Cancelada', unknown: 'En revisión' };
  async function manage() {
    if (typeof window.abrirModalPlanes === 'function') window.abrirModalPlanes();
    title('Tu suscripción'); host().innerHTML = '<p class="bill-wait">Consultando tu suscripción…</p>';
    var summary;
    try { summary = await call('summary'); } catch (error) { host().innerHTML = message('error', error.message); return; }
    if (!summary.has_subscription) {
      host().innerHTML = '<p class="bill-wait">Todavía no tienes una suscripción con tarjeta.</p><button type="button" class="btn btn-primary" data-bill="plans">Ver planes</button>'; bind(); return;
    }
    var p = plans()[summary.plan_key] || { label: summary.plan_key };
    host().innerHTML = '<div class="bill-summary"><strong>Plan ' + esc(p.label) + ' · ' + (summary.periodo === 'anual' ? 'anual' : 'mensual') + '</strong>' +
      '<span>Estado: ' + esc(STATUS[summary.status] || summary.status) + (summary.cancel_at_period_end ? ' · no se renovará' : '') + '</span></div>' +
      '<ul class="bill-facts"><li><span>Próximo cobro</span><strong>' + (summary.cancel_at_period_end ? 'Ninguno (cancelada)' : (summary.next_charge_date ? esc(fechaLarga(summary.next_charge_date)) : '—')) + '</strong></li>' +
      '<li><span>Tarjeta</span><strong>' + esc((summary.card_brand || 'Tarjeta') + ' ···· ' + (summary.card_last4 || '')) + '</strong></li></ul>' +
      '<div id="bill-feedback"></div>' +
      '<div class="bill-actions"><button type="button" class="btn btn-secondary" data-bill="plans">Cambiar de plan</button>' +
      '<button type="button" class="btn btn-secondary" data-bill="card">Cambiar tarjeta</button>' +
      (summary.cancel_at_period_end ? '<button type="button" class="btn btn-primary" data-bill="resume">Reactivar renovación</button>'
        : '<button type="button" class="btn btn-secondary bill-danger" data-bill="cancel">Cancelar renovación</button>') + '</div>' +
      '<p class="bill-safe">Si cancelas, conservas el acceso hasta el final del periodo que ya pagaste.</p>';
    bind();
  }

  async function act(action) {
    var box = document.getElementById('bill-feedback');
    if (state.busy) return; state.busy = true;
    try {
      if (action === 'cancel' && !window.confirm('¿Cancelar la renovación? Conservarás el acceso hasta el final del periodo pagado.')) { state.busy = false; return; }
      await call(action);
      await refreshTenant(); state.busy = false; await manage();
      var done = document.getElementById('bill-feedback'); if (done) done.innerHTML = message('ok', action === 'cancel' ? 'Listo: ya no se renovará tu plan.' : 'Listo: tu plan se renovará con normalidad.');
    } catch (error) { state.busy = false; if (box) box.innerHTML = message('error', error.message); }
  }

  function changeCard() {
    var form;
    title('Cambiar tarjeta');
    Promise.resolve().then(async function () {
      state.config = state.config || await call('config'); await loadScript(SDK); await loadScript(SDK_DATA);
      host().innerHTML = backButton('Volver', 'manage') + '<div id="bill-feedback"></div>' +
        '<form id="bill-form" autocomplete="on" novalidate>' +
        '<label>Nombre en la tarjeta<input name="holder" autocomplete="cc-name" maxlength="80" required></label>' +
        '<label>Número de tarjeta<input name="number" inputmode="numeric" autocomplete="cc-number" maxlength="23" required></label>' +
        '<div class="bill-row"><label>Mes<input name="month" inputmode="numeric" autocomplete="cc-exp-month" maxlength="2" placeholder="MM" required></label>' +
        '<label>Año<input name="year" inputmode="numeric" autocomplete="cc-exp-year" maxlength="2" placeholder="AA" required></label>' +
        '<label>CVV<input name="cvv" inputmode="numeric" autocomplete="cc-csc" maxlength="4" required></label></div>' +
        '<button class="btn btn-primary bill-pay" type="submit">Guardar tarjeta</button></form>';
      bind(); form = document.getElementById('bill-form');
      try { state.deviceId = window.OpenPay.deviceData.setup('bill-form', 'bill_device_id'); } catch (_) { state.deviceId = ''; }
      form.addEventListener('submit', async function (event) {
        event.preventDefault(); if (state.busy) return; state.busy = true;
        var button = form.querySelector('.bill-pay'); button.disabled = true; button.textContent = 'Guardando…';
        try {
          var tokenId = await tokenize(form);
          await call('change_card', { token_id: tokenId, device_session_id: state.deviceId || (form.elements.bill_device_id ? form.elements.bill_device_id.value : '') });
          state.busy = false; await manage(); var fb = document.getElementById('bill-feedback'); if (fb) fb.innerHTML = message('ok', 'Tu tarjeta se actualizó.');
        } catch (error) { state.busy = false; button.disabled = false; button.textContent = 'Guardar tarjeta'; document.getElementById('bill-feedback').innerHTML = message('error', error.message); }
      });
    }).catch(function (error) { host().innerHTML = backButton('Volver', 'manage') + message('error', error.message); bind(); });
  }

  function bind() {
    Array.prototype.forEach.call(host().querySelectorAll('[data-bill]'), function (node) {
      node.addEventListener('click', function () {
        var action = node.dataset.bill;
        if (action === 'plans') { title('Elige tu plan'); if (typeof window.renderModalPlanes === 'function') window.renderModalPlanes(); }
        else if (action === 'close') { if (typeof window.cerrarModalPlanes === 'function') window.cerrarModalPlanes(); }
        else if (action === 'manage') manage();
        else if (action === 'card') changeCard();
        else if (action === 'cancel' || action === 'resume') act(action);
      });
    });
  }

  window.SmylBilling = Object.freeze({ choose: choose, manage: manage });
})();
