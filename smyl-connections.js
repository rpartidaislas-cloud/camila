(function () {
  'use strict';

  var state = { loading: false, loaded: false, status: null, contextLoaded: false };

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function connectionButton() {
    var button = node('button', 'nav-item', 'LANA y canales');
    button.type = 'button';
    button.setAttribute('onclick', "ir('conexiones')");
    button.setAttribute('role', 'button');
    button.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
    });
    return button;
  }

  function pageMarkup() {
    return '<div class="connections-shell">' +
      '<header class="connections-hero"><div><p class="pro-eyebrow">ETAPA 2 · INTEGRACIONES</p>' +
      '<h1>LANA atiende el chat.<br>SMYL cuida el caso clínico.</h1>' +
      '<p>Conecta una cuenta de LANA sin compartir credenciales de Meta con SMYL. WhatsApp, Messenger e Instagram siguen administrados en LANA; aquí solo validamos el enlace seguro entre ambos productos.</p></div>' +
      '<div class="connections-status-card" aria-live="polite"><span class="connections-status-label">ESTADO</span>' +
      '<div class="connections-status-row"><span class="connections-status-dot"></span><strong data-lana-status>Cargando…</strong></div>' +
      '<p data-lana-summary>Comprobando la configuración de esta clínica.</p><small data-lana-verified></small></div></header>' +
      '<section class="connections-flow" aria-labelledby="connections-flow-title"><div class="connections-section-heading"><span>FLUJO SEGURO</span><h2 id="connections-flow-title">Un canal, dos responsabilidades claras</h2></div>' +
      '<ol><li><span>01</span><div><strong>El paciente escribe</strong><p>LANA recibe y organiza la conversación de Meta.</p></div></li>' +
      '<li><span>02</span><div><strong>El dentista revisa</strong><p>SMYL prepara la evidencia y el caso para revisión profesional.</p></div></li>' +
      '<li><span>03</span><div><strong>El equipo decide</strong><p>Nada clínico se entrega automáticamente sin aprobación humana.</p></div></li></ol></section>' +
      '<div class="connections-grid"><section class="connections-card connections-card-main"><div class="connections-card-head"><div><span>CONEXIÓN</span><h2>Enlazar con LANA</h2></div><span class="connections-badge" data-lana-badge>Pendiente</span></div>' +
      '<p data-lana-detail>Necesitas un código de enlace generado para esta clínica en LANA.</p>' +
      '<form data-lana-form autocomplete="off"><label for="lana-link-code">Código de enlace de LANA</label><div class="connections-secret-row"><input id="lana-link-code" name="lana-link-code" type="password" inputmode="text" spellcheck="false" autocomplete="new-password" placeholder="Pega el código una sola vez"><button type="button" class="btn btn-secondary" data-toggle-secret aria-label="Mostrar código">Mostrar</button></div>' +
      '<p class="connections-help">El código se cifra en el servidor. No se guarda en este navegador ni se vuelve a mostrar.</p><div class="connections-actions"><button type="submit" class="btn btn-primary" data-connect-lana>Conectar LANA</button><button type="button" class="btn btn-secondary" data-verify-lana hidden>Verificar conexión</button><a class="btn btn-secondary" href="https://app.get-lana.com/admin.html" target="_blank" rel="noopener noreferrer">Abrir LANA ↗</a></div><p class="connections-form-message" data-lana-message role="status"></p></form>' +
      '<div class="connections-staff-note" data-staff-note hidden>Solo el dueño de la clínica puede cambiar esta conexión. El equipo sí puede consultar su estado.</div></section>' +
      '<section class="connections-card"><div class="connections-card-head"><div><span>CANALES</span><h2>Meta permanece en LANA</h2></div></div>' +
      '<div class="connections-channel-list"><div><span class="connections-channel-icon">W</span><p><strong>WhatsApp</strong><small data-channel-state>Se configura en LANA</small></p></div><div><span class="connections-channel-icon">M</span><p><strong>Messenger</strong><small data-channel-state>Se configura en LANA</small></p></div><div><span class="connections-channel-icon">I</span><p><strong>Instagram</strong><small data-channel-state>Se configura en LANA</small></p></div></div>' +
      '<p class="connections-boundary">SMYL no solicita ni almacena tokens de Meta. LANA conserva la bandeja, las respuestas y la configuración de cada canal.</p></section></div>' +
      '<section class="connections-context" aria-labelledby="lana-context-title"><div class="connections-section-heading"><span>CONTEXTO DE ATENCIÓN</span><h2 id="lana-context-title">Enséñale a LANA cómo atender a tus pacientes</h2><p>Esta información se guarda en la cuenta LANA conectada y entra en las respuestas reales de WhatsApp, Messenger e Instagram.</p></div>' +
      '<form data-lana-context-form><div class="connections-context-grid"><label class="full">Descripción de la clínica<textarea name="clinic_description" maxlength="1600" rows="3" placeholder="Especialidad, enfoque, tipo de pacientes y qué distingue a la clínica."></textarea></label>' +
      '<label class="full">Servicios que puede explicar<textarea name="services" maxlength="3000" rows="4" placeholder="Ej. valoración estética, limpieza, blanqueamiento, carillas. No escribas precios que no estén confirmados."></textarea></label>' +
      '<label>Ubicación<input name="location" maxlength="500" placeholder="Dirección o zona de atención"></label><label>Horarios<input name="hours" maxlength="500" placeholder="Lun–Vie 9:00–18:00"></label>' +
      '<label class="full">Preguntas frecuentes confirmadas<textarea name="faq" maxlength="4000" rows="5" placeholder="Pregunta: ¿La valoración tiene costo? Respuesta: ..."></textarea></label>' +
      '<label class="full">Cuándo pasar la conversación a una persona<textarea name="handoff_rules" maxlength="1600" rows="3" placeholder="Ej. dolor agudo, urgencias, dudas clínicas, inconformidad o solicitud de hablar con el dentista."></textarea></label>' +
      '<label>Tono<select name="tone"><option value="profesional">Profesional y claro</option><option value="cercano">Cercano y empático</option><option value="breve">Breve y directo</option></select></label>' +
      '<label>Autonomía<select name="autonomy_level"><option value="1">1 · Solo bienvenida</option><option value="2">2 · Preguntas frecuentes</option><option value="3">3 · Atención asistida</option><option value="4">4 · Autónoma</option></select></label></div>' +
      '<div class="connections-context-guard"><strong>Límites clínicos siempre activos</strong><p>LANA puede orientar sobre la clínica, servicios y citas. No diagnostica, prescribe, promete resultados ni comparte expedientes, simulaciones o propuestas clínicas sin revisión profesional.</p></div>' +
      '<div class="connections-actions"><button type="submit" class="btn btn-primary" data-save-lana-context>Guardar y activar en LANA</button><span class="connections-context-status" data-lana-context-status role="status"></span></div></form></section>' +
      '<section class="connections-safety"><strong>Control clínico</strong><p>La conexión habilita el puente entre productos; no autoriza a enviar diagnósticos, simulaciones ni propuestas sin que el dentista los revise y apruebe.</p></section></div>';
  }

  function setMessage(text, tone) {
    var el = document.querySelector('[data-lana-message]');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.tone = tone || '';
  }

  function setBusy(busy) {
    state.loading = busy;
    document.querySelectorAll('[data-connect-lana],[data-verify-lana]').forEach(function (button) { button.disabled = busy; });
  }

  function renderStatus(status) {
    state.status = status;
    state.loaded = true;
    var connected = Boolean(status && status.connected);
    var attention = status && status.estado === 'requiere_atencion';
    var statusEl = document.querySelector('[data-lana-status]');
    var summary = document.querySelector('[data-lana-summary]');
    var detail = document.querySelector('[data-lana-detail]');
    var badge = document.querySelector('[data-lana-badge]');
    var verified = document.querySelector('[data-lana-verified]');
    var form = document.querySelector('[data-lana-form]');
    var staffNote = document.querySelector('[data-staff-note]');
    var connectButton = document.querySelector('[data-connect-lana]');
    var verifyButton = document.querySelector('[data-verify-lana]');
    var input = document.getElementById('lana-link-code');
    var channelText = connected ? 'Administrado en LANA' : 'Se configura en LANA';

    document.querySelector('.connections-status-card').dataset.state = attention ? 'attention' : (connected ? 'connected' : 'pending');
    statusEl.textContent = attention ? 'Requiere atención' : (connected ? 'LANA conectada' : 'Pendiente de conexión');
    summary.textContent = attention ? 'El enlace existe, pero LANA no pudo validarlo.' : (connected ? 'La clínica puede usar el puente seguro con LANA.' : 'Todavía no hay una cuenta de LANA enlazada a esta clínica.');
    badge.textContent = attention ? 'Revisar' : (connected ? 'Conectada' : 'Pendiente');
    badge.dataset.state = attention ? 'attention' : (connected ? 'connected' : 'pending');
    detail.textContent = connected
      ? 'Código verificado · ' + (status.fingerprint || 'enlace protegido')
      : (attention ? (status.last_error || 'Vuelve a verificar o reemplaza el código de enlace.') : 'Necesitas un código de enlace generado para esta clínica en LANA.');
    verified.textContent = status && status.last_verified_at
      ? 'Última verificación: ' + new Date(status.last_verified_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    document.querySelectorAll('[data-channel-state]').forEach(function (el) { el.textContent = channelText; });
    form.hidden = !status.can_manage;
    staffNote.hidden = Boolean(status.can_manage);
    connectButton.textContent = connected || attention ? 'Reemplazar código' : 'Conectar LANA';
    verifyButton.hidden = !connected && !attention;
    input.value = '';
    var contextForm = document.querySelector('[data-lana-context-form]');
    if (contextForm) {
      contextForm.dataset.connected = String(connected);
      contextForm.querySelectorAll('input,textarea,select,button').forEach(function (control) { control.disabled = !connected || !status.can_manage; });
    }
    if (connected) loadContext(true);
  }

  async function sessionToken() {
    if (!window.sb || !sb.auth) throw new Error('No se pudo iniciar la conexión con el servidor.');
    var result = await sb.auth.getSession();
    var token = result && result.data && result.data.session && result.data.session.access_token;
    if (!token) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    return token;
  }

  async function request(action, payload) {
    var controller = new AbortController();
    // La primera invocación de una Edge Function recién despertada puede
    // tardar más que las siguientes. Damos margen al arranque en frío sin
    // dejar la pantalla esperando indefinidamente.
    var timer = setTimeout(function () { controller.abort(); }, 20000);
    try {
      var method = action === 'status' ? 'GET' : 'POST';
      var response = await fetch(SUPA_URL + '/functions/v1/lana-connection' + (method === 'GET' ? '?action=status' : ''), {
        method: method,
        headers: { 'Authorization': 'Bearer ' + await sessionToken(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(Object.assign({ action: action }, payload || {})) : undefined,
        signal: controller.signal,
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(data.error || 'No se pudo completar la operación.');
        error.statusData = data;
        throw error;
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('La conexión tardó demasiado. Intenta de nuevo.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function contextRequest(method, payload) {
    var response = await fetch(SUPA_URL + '/functions/v1/lana-context', {
      method: method,
      headers: { 'Authorization': 'Bearer ' + await sessionToken(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify({ context: payload }) : undefined,
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'No se pudo sincronizar el contexto.');
    return data;
  }

  function contextStatus(text, tone) {
    var el = document.querySelector('[data-lana-context-status]');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.tone = tone || '';
  }

  function fillContext(context) {
    var form = document.querySelector('[data-lana-context-form]');
    if (!form) return;
    ['clinic_description','services','location','hours','faq','handoff_rules','tone','autonomy_level'].forEach(function (name) {
      if (form.elements[name]) form.elements[name].value = context && context[name] !== undefined ? context[name] : (name === 'autonomy_level' ? '2' : name === 'tone' ? 'profesional' : '');
    });
    if (context && context.updated_at) contextStatus('Sincronizado ' + new Date(context.updated_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }), 'success');
    else contextStatus('Aún no hay contexto guardado. Completa lo que LANA debe conocer.', '');
  }

  async function loadContext(force) {
    if (!state.status || !state.status.connected || (state.contextLoaded && !force)) return;
    contextStatus('Cargando contexto…', '');
    try { var data = await contextRequest('GET'); fillContext(data.context || {}); state.contextLoaded = true; }
    catch (error) { contextStatus(error.message, 'error'); }
  }

  async function saveContext(event) {
    event.preventDefault();
    var form = event.currentTarget, button = form.querySelector('[data-save-lana-context]'), context = {};
    ['clinic_description','services','location','hours','faq','handoff_rules','tone'].forEach(function (name) { context[name] = form.elements[name].value.trim(); });
    context.autonomy_level = Number(form.elements.autonomy_level.value);
    button.disabled = true; contextStatus('Guardando en LANA…', '');
    try { var data = await contextRequest('PUT', context); fillContext(data.context || context); contextStatus('Contexto activo en las respuestas de LANA.', 'success'); }
    catch (error) { contextStatus(error.message, 'error'); }
    finally { button.disabled = !state.status || !state.status.connected || !state.status.can_manage; }
  }

  async function loadStatus(force) {
    if (state.loading || (state.loaded && !force)) return;
    setBusy(true);
    try {
      renderStatus(await request('status'));
    } catch (error) {
      setMessage(error.message || 'No se pudo consultar el estado de LANA.', 'error');
      var statusEl = document.querySelector('[data-lana-status]');
      if (statusEl) statusEl.textContent = 'No disponible';
    } finally {
      setBusy(false);
    }
  }

  async function connect(event) {
    event.preventDefault();
    var input = document.getElementById('lana-link-code');
    var apiKey = input.value.trim();
    if (!apiKey) { setMessage('Pega el código de enlace de LANA.', 'error'); input.focus(); return; }
    setBusy(true); setMessage('Validando el enlace con LANA…', '');
    try {
      var status = await request('connect', { api_key: apiKey });
      renderStatus(status);
      setMessage('LANA quedó conectada de forma segura.', 'success');
    } catch (error) {
      setMessage(error.message || 'No se pudo conectar LANA.', 'error');
    } finally {
      input.value = '';
      input.type = 'password';
      var toggle = document.querySelector('[data-toggle-secret]');
      if (toggle) { toggle.textContent = 'Mostrar'; toggle.setAttribute('aria-label', 'Mostrar código'); }
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true); setMessage('Verificando con LANA…', '');
    try {
      var status = await request('verify');
      renderStatus(status);
      setMessage('Conexión verificada.', 'success');
    } catch (error) {
      if (error.statusData && error.statusData.estado) renderStatus(error.statusData);
      setMessage(error.message || 'La conexión requiere atención.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function addMobileRow() {
    var rows = Array.from(document.querySelectorAll('.pam-row'));
    if (document.querySelector('[data-mobile-connections]')) return;
    var reference = rows.find(function (row) {
      var label = row.querySelector('.pam-row-label');
      return label && label.textContent.trim() === 'Marca y simulación';
    });
    if (!reference) return;
    var row = reference.cloneNode(true);
    row.dataset.mobileConnections = 'true';
    row.setAttribute('onclick', "pamIr('conexiones')");
    row.querySelector('.pam-row-label').textContent = 'LANA y canales';
    var icon = row.querySelector('.pam-row-icon');
    if (icon) icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>';
    reference.after(row);
  }

  function init() {
    if (!window.TITULOS || !window.ir || document.getElementById('p-conexiones')) return;
    TITULOS.conexiones = 'LANA y canales';
    var settings = document.querySelector('.pro-settings');
    var account = Array.from(settings.querySelectorAll('.nav-item')).find(function (el) { return el.getAttribute('onclick') === "ir('mi-cuenta')"; });
    var button = connectionButton();
    if (account) settings.insertBefore(button, account); else settings.append(button);

    var page = node('section', 'pantalla');
    page.id = 'p-conexiones';
    page.innerHTML = pageMarkup();
    document.querySelector('.contenido').append(page);
    page.querySelector('[data-lana-form]').addEventListener('submit', connect);
    page.querySelector('[data-lana-context-form]').addEventListener('submit', saveContext);
    page.querySelector('[data-verify-lana]').addEventListener('click', verify);
    page.querySelector('[data-toggle-secret]').addEventListener('click', function () {
      var input = document.getElementById('lana-link-code');
      var visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      this.textContent = visible ? 'Mostrar' : 'Ocultar';
      this.setAttribute('aria-label', visible ? 'Mostrar código' : 'Ocultar código');
    });
    addMobileRow();

    var previous = window.ir;
    window.ir = function (route) {
      previous(route);
      if (route === 'conexiones') loadStatus(true);
    };
  }

  window.SmylConnections = { loadStatus: loadStatus };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
