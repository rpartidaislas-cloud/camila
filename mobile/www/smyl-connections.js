(function () {
  'use strict';

  var state = { loading: false, loaded: false, status: null, channels: [], disconnectingChannel: '', trainingLoaded: false, training: null, published: null, draftRevision: 0, publishedVersion: 0, validation: null, dirty: false, previewHistory: [] };

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function connectionButton() {
    var button = node('button', 'nav-item', 'Canales e IA');
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
      '<header class="connections-hero"><div><p class="pro-eyebrow">COMUNICACIÓN CON PACIENTES</p>' +
      '<h1>Tus canales y tu asistente,<br>dentro de SMYL.</h1>' +
      '<p>Conecta WhatsApp, Messenger e Instagram, define cómo debe responder SMYL Asistente y entrega la conversación a tu equipo cuando haga falta.</p></div>' +
      '<div class="connections-status-card" aria-live="polite"><span class="connections-status-label">ESTADO</span>' +
      '<div class="connections-status-row"><span class="connections-status-dot"></span><strong data-lana-status>Cargando…</strong></div>' +
      '<p data-lana-summary>Comprobando la configuración de esta clínica.</p><small data-lana-verified></small></div></header>' +
      '<section class="connections-flow" aria-labelledby="connections-flow-title"><div class="connections-section-heading"><span>FLUJO SEGURO</span><h2 id="connections-flow-title">Un canal, dos responsabilidades claras</h2></div>' +
      '<ol><li><span>01</span><div><strong>El paciente escribe</strong><p>SMYL recibe y organiza la conversación de tus canales.</p></div></li>' +
      '<li><span>02</span><div><strong>El dentista revisa</strong><p>SMYL prepara la evidencia y el caso para revisión profesional.</p></div></li>' +
      '<li><span>03</span><div><strong>El equipo decide</strong><p>Nada clínico se entrega automáticamente sin aprobación humana.</p></div></li></ol></section>' +
      '<div class="connections-grid"><section class="connections-card connections-card-main"><div class="connections-card-head"><div><span>CONEXIÓN</span><h2>Infraestructura de canales</h2></div><span class="connections-badge" data-lana-badge>Pendiente</span></div>' +
      '<p data-lana-detail>SMYL puede preparar automáticamente la mensajería segura de esta clínica.</p>' +
      '<div class="connections-provision" data-provision-wrap><button type="button" class="btn btn-primary" data-provision-lana>Activar canales para mi clínica</button><p>La activación crea una conexión técnica protegida. No tendrás que copiar claves ni contraseñas.</p></div>' +
      '<div class="connections-actions connections-connected-actions" data-connected-actions hidden><button type="button" class="btn btn-secondary" data-verify-lana>Verificar conexión</button></div>' +
      '<details class="connections-manual" data-manual-link><summary>Configuración avanzada de migración</summary><form data-lana-form autocomplete="off"><label for="lana-link-code">Código de enlace</label><div class="connections-secret-row"><input id="lana-link-code" name="lana-link-code" type="password" inputmode="text" spellcheck="false" autocomplete="new-password" placeholder="Pega el código una sola vez"><button type="button" class="btn btn-secondary" data-toggle-secret aria-label="Mostrar código">Mostrar</button></div>' +
      '<p class="connections-help">Utiliza esta opción únicamente si soporte te proporcionó un código. Se cifra en el servidor.</p><div class="connections-actions"><button type="submit" class="btn btn-secondary" data-connect-lana>Usar código existente</button></div></form></details><p class="connections-form-message" data-lana-message role="status"></p>' +
      '<div class="connections-staff-note" data-staff-note hidden>Solo el dueño de la clínica puede cambiar esta conexión. El equipo sí puede consultar su estado.</div></section>' +
      '<section class="connections-card"><div class="connections-card-head"><div><span>CANALES</span><h2>Conecta las cuentas de la clínica</h2></div></div>' +
      '<div class="connections-channel-list"><div data-channel-row="whatsapp"><span class="connections-channel-icon">W</span><p><strong>WhatsApp Business</strong><small data-channel-state>Activa la mensajería para continuar</small></p><button type="button" class="btn btn-secondary" data-connect-channel="whatsapp" disabled>Conectar</button></div><div data-channel-row="messenger"><span class="connections-channel-icon">M</span><p><strong>Messenger</strong><small data-channel-state>Activa la mensajería para continuar</small></p><button type="button" class="btn btn-secondary" data-connect-channel="messenger" disabled>Conectar</button></div><div data-channel-row="instagram"><span class="connections-channel-icon">I</span><p><strong>Instagram</strong><small data-channel-state>Activa la mensajería para continuar</small></p><button type="button" class="btn btn-secondary" data-connect-channel="instagram" disabled>Conectar</button></div></div>' +
      '<p class="connections-boundary">Los tokens de Meta se procesan en una capa privada y nunca se muestran en el navegador ni se mezclan con el expediente clínico.</p></section></div>' +
      '<dialog class="connections-disconnect-dialog" data-disconnect-dialog><form method="dialog"><span class="connections-status-label">DESCONECTAR CANAL</span><h2 data-disconnect-title>¿Desconectar este canal?</h2><p data-disconnect-copy>El asistente dejará de recibir y enviar mensajes. El historial se conservará y podrás conectar otra cuenta después.</p><div class="connections-disconnect-summary"><span class="connections-channel-icon" data-disconnect-icon>I</span><div><strong data-disconnect-name>Instagram</strong><small data-disconnect-account></small></div></div><footer><button type="button" class="btn btn-secondary" data-disconnect-cancel>Cancelar</button><button type="button" class="btn connections-danger-button" data-disconnect-confirm>Desconectar</button></footer></form></dialog>' +
      '<section class="connections-context connections-training" aria-labelledby="lana-training-title"><div class="connections-section-heading"><span>CAPACITAR IA</span><h2 id="lana-training-title">Prepara a SMYL Asistente para atender pacientes</h2><p>Trabaja en borrador, valida la información y publica cuando esté lista. Solo la versión publicada responde en WhatsApp, Messenger e Instagram.</p></div>' +
      '<div class="connections-training-bar"><div><span class="connections-training-state" data-training-state>Borrador sin guardar</span><small data-training-version>Sin versión publicada</small></div><div class="connections-training-score"><span data-training-score>0%</span><small>capacitación completa</small></div></div>' +
      '<form data-lana-training-form><fieldset><legend>Identidad y voz</legend><div class="connections-context-grid"><label>Nombre del asistente<input name="assistant_name" maxlength="50" value="SMYL Asistente"></label><label>Tono<select name="tone"><option value="profesional">Profesional y claro</option><option value="cercano">Cercano y empático</option><option value="breve">Breve y directo</option></select></label><label class="full">Mensaje de bienvenida<textarea name="welcome_message" maxlength="350" rows="2" placeholder="Hola, soy el asistente de la clínica. Puedo orientarte y ayudarte con el siguiente paso."></textarea></label></div></fieldset>' +
      '<fieldset><legend>La clínica</legend><div class="connections-context-grid"><label class="full">Descripción y enfoque<textarea name="clinic_description" maxlength="1600" rows="3" placeholder="Especialidad, enfoque, tipo de pacientes y qué distingue a la clínica."></textarea></label><label class="full">Especialidades confirmadas<textarea name="specialties" maxlength="1200" rows="2" placeholder="Odontología general, ortodoncia, implantología…"></textarea></label><label>Ubicación principal<input name="location" maxlength="500" placeholder="Dirección o zona de atención"></label><label>Horarios<input name="hours" maxlength="500" placeholder="Lun–Vie 9:00–18:00"></label><label>Idiomas<input name="languages" maxlength="300" placeholder="Español, inglés"></label><label>Canales de contacto<input name="contact_channels" maxlength="700" placeholder="Teléfono y medios autorizados"></label><label class="full">Acceso, estacionamiento y accesibilidad<textarea name="access_info" maxlength="900" rows="2"></textarea></label><label class="full">Política para menores y acompañantes<textarea name="minor_policy" maxlength="900" rows="2"></textarea></label></div></fieldset>' +
      '<fieldset><legend>Sucursales y operación</legend><div class="connections-context-grid"><label class="full">Sucursales, direcciones y cobertura<textarea name="branches" maxlength="2400" rows="4" placeholder="Una sucursal por bloque: dirección, horario, especialidades y profesionales disponibles."></textarea></label><label class="full">Reglas de agenda<textarea name="scheduling_rules" maxlength="1600" rows="3" placeholder="Anticipación, duración, confirmación, reprogramación y horarios especiales."></textarea></label><label class="full">Promociones autorizadas y vigencia<textarea name="approved_promotions" maxlength="1200" rows="2" placeholder="Sólo promociones aprobadas; indica fecha de vencimiento."></textarea></label></div></fieldset>' +
      '<fieldset><legend>Servicios confirmados</legend><p class="connections-fieldset-help">Incluye solo servicios reales. Si agregas precio, debe ser información confirmada o indicar que requiere valoración.</p><div class="connections-repeat-list" data-service-list></div><button type="button" class="connections-add-row" data-add-service>+ Agregar servicio</button></fieldset>' +
      '<fieldset><legend>Preguntas frecuentes</legend><p class="connections-fieldset-help">El asistente respetará estas respuestas y no inventará una política distinta.</p><div class="connections-repeat-list" data-faq-list></div><button type="button" class="connections-add-row" data-add-faq>+ Agregar pregunta</button></fieldset>' +
      '<fieldset><legend>Flujo de atención</legend><div class="connections-context-grid"><label class="full">Objetivo de la conversación<textarea name="attention_objective" maxlength="900" rows="2"></textarea></label><label class="full">Política de citas<textarea name="appointment_policy" maxlength="1200" rows="3" placeholder="Qué puede explicar, qué datos pedir y cuándo debe confirmar una persona."></textarea></label><label class="full">Cancelación e inasistencia<textarea name="cancellation_policy" maxlength="1200" rows="2"></textarea></label><label class="full">Política de precios<textarea name="pricing_policy" maxlength="1200" rows="3" placeholder="Qué precios están confirmados y cuándo se requiere valoración. El asistente nunca inventa importes."></textarea></label><label class="full">Pagos, anticipos y financiamiento<textarea name="payment_policy" maxlength="1200" rows="2"></textarea></label><label class="full">Facturación CFDI<textarea name="invoice_policy" maxlength="1200" rows="2" placeholder="Plazo, canal y datos que solicita el equipo; nunca recopilar contraseñas ni documentos completos."></textarea></label><label class="full">Seguros y reembolsos<textarea name="insurance_policy" maxlength="900" rows="2"></textarea></label><label class="full">Seguimientos y recordatorios<textarea name="followup_policy" maxlength="1200" rows="2"></textarea></label><label class="full">Datos administrativos que puede solicitar<textarea name="intake_questions" maxlength="1600" rows="3" placeholder="Ej. nombre, tratamiento de interés, horario preferido y sucursal. Una o dos preguntas por mensaje."></textarea></label><label class="full">Protocolo administrativo de urgencias<textarea name="emergency_policy" maxlength="1200" rows="3" placeholder="Señales que exigen atención inmediata y texto aprobado por la clínica; nunca diagnosticar ni prescribir."></textarea></label><label class="full">Cuándo pasar la conversación a una persona<textarea name="handoff_rules" maxlength="1600" rows="3" placeholder="Ej. inconformidad, solicitud de hablar con el dentista o excepción administrativa. Dolor, urgencias y dudas clínicas ya escalan siempre."></textarea></label><label class="full">Expectativa de respuesta humana<textarea name="human_response_policy" maxlength="900" rows="2" placeholder="Indica tiempos sólo si la clínica realmente los mide."></textarea></label><label>Autonomía<select name="autonomy_level"><option value="1">1 · Solo bienvenida</option><option value="2">2 · Información y FAQ</option><option value="3">3 · Atención asistida</option><option value="4">4 · Gestión administrativa confirmada</option></select></label></div></fieldset>' +
      '<fieldset><legend>Memoria administrativa</legend><div class="connections-context-grid"><label class="full">Datos que puede recordar<textarea name="allowed_memory" maxlength="1200" rows="2"></textarea></label><label class="full">Datos que nunca debe recordar ni repetir<textarea name="prohibited_memory" maxlength="1200" rows="2"></textarea></label></div></fieldset>' +
      '<div class="connections-context-guard"><strong>Límites clínicos fijos · no se pueden editar</strong><ul><li>No diagnosticar, prescribir ni recomendar dosis.</li><li>No interpretar fotografías o radiografías ni prometer resultados.</li><li>No revelar expedientes ni compartir archivos clínicos sin revisión profesional.</li><li>Escalar síntomas, dolor, urgencias, incertidumbre y solicitudes clínicas.</li></ul></div>' +
      '<div class="connections-validation" data-training-validation hidden></div><div class="connections-training-actions"><button type="submit" class="btn btn-secondary" data-save-training>Guardar borrador</button><button type="button" class="btn btn-secondary" data-validate-training>Validar</button><button type="button" class="btn btn-primary" data-publish-training>Publicar capacitación</button><span class="connections-context-status" data-lana-context-status role="status"></span></div></form>' +
      '<details class="connections-versions"><summary>Historial de versiones publicadas</summary><div data-training-versions><p>Aún no hay versiones publicadas.</p></div></details>' +
      '<div class="connections-preview"><div class="connections-preview-head"><div><span>LABORATORIO PRIVADO</span><h3>Prueba cómo responderá tu asistente</h3><p>Usa el mismo motor de producción. Puedes probar el borrador sin cambiar lo que reciben los pacientes. Ningún mensaje sale de esta pantalla.</p></div><div class="connections-preview-badges"><span>IA de producción</span><span>Sin envío</span></div></div>' +
      '<div class="connections-preview-source"><label for="lana-preview-source">Versión a probar</label><select id="lana-preview-source" data-preview-source><option value="draft">Borrador actual</option><option value="published">Versión publicada</option></select><small data-preview-version>Borrador sin guardar</small></div>' +
      '<div class="connections-preview-suggestions" aria-label="Escenarios sugeridos"><button type="button" data-lana-scenario="¿Cuánto cuesta una valoración y en qué horarios atienden?">Precio y horario</button><button type="button" data-lana-scenario="Me duele mucho una muela desde anoche, ¿qué medicamento debo tomar?">Dolor y urgencia</button><button type="button" data-lana-scenario="Si les mando una foto, ¿pueden decirme si necesito carillas?">Foto y diagnóstico</button></div>' +
      '<div class="connections-preview-chat" data-lana-preview-chat aria-live="polite"><div class="connections-preview-empty"><span>S</span><div><strong>Conversación de prueba</strong><p>Escribe como paciente para revisar el tono, la información y cuándo el asistente debe pasar con una persona.</p></div></div></div>' +
      '<form class="connections-preview-form" data-lana-preview-form><label for="lana-preview-message">Mensaje de prueba</label><div><textarea id="lana-preview-message" name="message" maxlength="1000" rows="2" placeholder="Ej. Hola, quisiera saber si manejan blanqueamiento…"></textarea><button type="submit" class="btn btn-primary" data-send-lana-preview>Probar respuesta</button></div><footer><span>Usa datos ficticios. La prueba consume IA del plan y no se guarda como conversación.</span><button type="button" data-clear-lana-preview>Limpiar prueba</button></footer><p class="connections-preview-status" data-lana-preview-status role="status"></p></form></div></section>' +
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
    document.querySelectorAll('[data-connect-lana],[data-provision-lana],[data-verify-lana]').forEach(function (button) { button.disabled = busy; });
  }

  function renderStatus(status) {
    state.status = status;
    state.loaded = true;
    var connected = Boolean(status && status.connected);
    var attention = status && status.estado === 'requiere_atencion';
    var linked = connected || attention;
    var statusEl = document.querySelector('[data-lana-status]');
    var summary = document.querySelector('[data-lana-summary]');
    var detail = document.querySelector('[data-lana-detail]');
    var badge = document.querySelector('[data-lana-badge]');
    var verified = document.querySelector('[data-lana-verified]');
    var form = document.querySelector('[data-lana-form]');
    var staffNote = document.querySelector('[data-staff-note]');
    var provisionWrap = document.querySelector('[data-provision-wrap]');
    var manualLink = document.querySelector('[data-manual-link]');
    var connectedActions = document.querySelector('[data-connected-actions]');
    var input = document.getElementById('lana-link-code');

    document.querySelector('.connections-status-card').dataset.state = attention ? 'attention' : (connected ? 'connected' : 'pending');
    statusEl.textContent = attention ? 'Requiere atención' : (connected ? 'Mensajería activa' : 'Pendiente de conexión');
    summary.textContent = attention ? 'La conexión existe, pero no pudo validarse.' : (connected ? 'La clínica puede usar sus canales y el asistente de forma segura.' : 'La infraestructura de mensajería aún no está activa para esta clínica.');
    badge.textContent = attention ? 'Revisar' : (connected ? 'Conectada' : 'Pendiente');
    badge.dataset.state = attention ? 'attention' : (connected ? 'connected' : 'pending');
    detail.textContent = connected
      ? 'Código verificado · ' + (status.fingerprint || 'enlace protegido')
      : (attention ? (status.last_error || 'Vuelve a verificar o reemplaza el código de enlace.') : 'Activa la mensajería automáticamente; no necesitas crear ni copiar una API key.');
    verified.textContent = status && status.last_verified_at
      ? 'Última verificación: ' + new Date(status.last_verified_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    provisionWrap.hidden = linked || !status.can_manage;
    manualLink.hidden = linked || !status.can_manage;
    connectedActions.hidden = !linked || !status.can_manage;
    form.hidden = false;
    staffNote.hidden = Boolean(status.can_manage);
    input.value = '';
    var trainingForm = document.querySelector('[data-lana-training-form]');
    if (trainingForm) {
      trainingForm.dataset.connected = String(connected);
      trainingForm.querySelectorAll('input,textarea,select,button').forEach(function (control) { control.disabled = !connected || !status.can_manage; });
    }
    var previewForm = document.querySelector('[data-lana-preview-form]');
    if (previewForm) {
      previewForm.dataset.connected = String(connected);
      previewForm.querySelectorAll('textarea,button').forEach(function (control) { control.disabled = !connected || !status.can_manage; });
    }
    var previewSource = document.querySelector('[data-preview-source]');
    if (previewSource) previewSource.disabled = !connected || !status.can_manage;
    if (connected) {
      loadTraining(true);
      loadChannels();
    } else {
      renderChannels([]);
    }
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

  async function trainingRequest(method, action, payload, idempotencyKey) {
    var url = SUPA_URL + '/functions/v1/lana-training' + (method === 'GET' && action === 'versions' ? '?action=versions' : '');
    var headers = { 'Authorization': 'Bearer ' + await sessionToken(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    var response = await fetch(url, {
      method: method,
      headers: headers,
      body: method === 'GET' ? undefined : JSON.stringify(Object.assign({ action: action }, payload || {})),
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(data.error || 'No se pudo sincronizar la capacitación.');
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function channelRequest(method, payload) {
    var response = await fetch(SUPA_URL + '/functions/v1/lana-channels', {
      method: method,
      headers: { 'Authorization': 'Bearer ' + await sessionToken(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación del canal.');
    return data;
  }

  function renderChannels(channels) {
    state.channels = Array.isArray(channels) ? channels : [];
    var connectedToLana = Boolean(state.status && state.status.connected);
    document.querySelectorAll('[data-channel-row]').forEach(function (row) {
      var name = row.dataset.channelRow;
      var item = state.channels.find(function (value) { return value.channel === name; });
      var connected = Boolean(item && item.connected);
      var statusText = row.querySelector('[data-channel-state]');
      var button = row.querySelector('[data-connect-channel]');
      row.dataset.state = connected ? 'connected' : 'pending';
      statusText.textContent = connected
        ? ((item.display_name || 'Cuenta conectada') + ' · Canal activo')
        : (connectedToLana ? 'Listo para conectar' : 'Activa la mensajería para continuar');
      var canDisconnect = connected && name !== 'whatsapp' && Boolean(state.status && state.status.can_manage);
      button.textContent = state.disconnectingChannel === name ? 'Desconectando…' : canDisconnect ? 'Desconectar' : connected ? 'Conectado' : 'Conectar';
      button.dataset.channelAction = canDisconnect ? 'disconnect' : 'connect';
      button.classList.toggle('connections-channel-disconnect', canDisconnect);
      button.disabled = state.disconnectingChannel === name || (connected ? !canDisconnect : (!connectedToLana || !state.status.can_manage));
    });
  }

  async function loadChannels() {
    try {
      var data = await channelRequest('GET');
      renderChannels(data.channels || []);
    } catch (error) {
      document.querySelectorAll('[data-channel-state]').forEach(function (el) { el.textContent = 'No se pudo consultar'; });
      setMessage(error.message || 'No se pudo consultar el estado de los canales.', 'error');
    }
  }

  async function connectChannel(event) {
    var selected = event.currentTarget.dataset.connectChannel;
    var popup = window.open('', 'smyl-lana-' + selected, 'width=560,height=760');
    if (!popup) { setMessage('Permite las ventanas emergentes para conectar este canal.', 'error'); return; }
    popup.document.title = 'Preparando conexión…';
    popup.document.body.textContent = 'Preparando conexión segura con el canal…';
    event.currentTarget.disabled = true;
    setMessage('Preparando la conexión de ' + selected + '…', '');
    try {
      var data = await channelRequest('POST', { action: 'setup', channel: selected });
      var setupOrigin = new URL(data.setup_url).origin;
      var finished = false;
      var onMessage = function (messageEvent) {
        if (messageEvent.source !== popup || messageEvent.origin !== setupOrigin || !messageEvent.data || messageEvent.data.type !== 'smyl-lana-channel' || messageEvent.data.channel !== selected) return;
        finished = true;
        window.removeEventListener('message', onMessage);
        if (messageEvent.data.ok) {
          setMessage(messageEvent.data.message || 'Canal conectado.', 'success');
          loadChannels();
        } else {
          setMessage(messageEvent.data.message || 'No se pudo conectar el canal.', 'error');
          loadChannels();
        }
      };
      window.addEventListener('message', onMessage);
      popup.location.replace(data.setup_url);
      var closeWatch = setInterval(function () {
        if (!popup.closed) return;
        clearInterval(closeWatch);
        setTimeout(function () {
          window.removeEventListener('message', onMessage);
          if (!finished) loadChannels();
        }, 600);
      }, 500);
    } catch (error) {
      popup.close();
      setMessage(error.message || 'No se pudo iniciar la conexión.', 'error');
      loadChannels();
    }
  }

  function channelName(channel) {
    return channel === 'instagram' ? 'Instagram' : channel === 'messenger' ? 'Messenger' : 'WhatsApp Business';
  }

  function openDisconnectDialog(channel) {
    var dialog = document.querySelector('[data-disconnect-dialog]');
    var item = state.channels.find(function (value) { return value.channel === channel; });
    if (!dialog || !item || !item.connected) return;
    dialog.dataset.channel = channel;
    dialog.querySelector('[data-disconnect-title]').textContent = '¿Desconectar ' + channelName(channel) + '?';
    dialog.querySelector('[data-disconnect-name]').textContent = channelName(channel);
    dialog.querySelector('[data-disconnect-icon]').textContent = channel.charAt(0).toUpperCase();
    dialog.querySelector('[data-disconnect-account]').textContent = item.display_name || 'Cuenta conectada';
    dialog.showModal();
  }

  async function confirmDisconnect() {
    var dialog = document.querySelector('[data-disconnect-dialog]');
    var channel = dialog && dialog.dataset.channel;
    if (!channel || state.disconnectingChannel) return;
    state.disconnectingChannel = channel;
    dialog.close();
    renderChannels(state.channels);
    setMessage('Desconectando ' + channelName(channel) + ' de forma segura…', '');
    try {
      await channelRequest('POST', { action: 'disconnect', channel: channel });
      setMessage(channelName(channel) + ' quedó desconectado. El historial de conversaciones se conservó.', 'success');
      await loadChannels();
    } catch (error) {
      setMessage(error.message || 'No se pudo desconectar el canal.', 'error');
    } finally {
      state.disconnectingChannel = '';
      renderChannels(state.channels);
    }
  }

  function channelAction(event) {
    if (event.currentTarget.dataset.channelAction === 'disconnect') {
      openDisconnectDialog(event.currentTarget.dataset.connectChannel);
      return;
    }
    connectChannel(event);
  }

  function contextStatus(text, tone) {
    var el = document.querySelector('[data-lana-context-status]');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.tone = tone || '';
  }

  function rowId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return prefix + '-' + window.crypto.randomUUID();
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function mutationKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (value) {
      var random = Math.random() * 16 | 0;
      return (value === 'x' ? random : (random & 3 | 8)).toString(16);
    });
  }

  function repeatInput(labelText, name, value, max, rows, placeholder) {
    var label = node('label', '', labelText);
    var control = rows ? document.createElement('textarea') : document.createElement('input');
    control.name = name; control.value = value || ''; control.maxLength = max;
    if (rows) control.rows = rows;
    if (placeholder) control.placeholder = placeholder;
    label.append(control);
    return label;
  }

  function repeatRow(type, item) {
    var row = node('div', 'connections-repeat-row');
    row.dataset.rowId = item.id || rowId(type);
    var fields = node('div', 'connections-repeat-fields');
    if (type === 'service') {
      fields.append(repeatInput('Servicio', 'service_name', item.name, 120, 0, 'Ej. Valoración estética'));
      fields.append(repeatInput('Descripción confirmada', 'service_description', item.description, 700, 2, 'Qué incluye y para quién suele ser útil, sin diagnosticar.'));
      fields.append(repeatInput('Información de precio', 'service_pricing', item.pricing_note, 350, 2, 'Ej. Desde $___ o requiere valoración. Solo datos confirmados.'));
    } else {
      fields.append(repeatInput('Pregunta', 'faq_question', item.question, 280, 0, '¿La valoración tiene costo?'));
      fields.append(repeatInput('Respuesta confirmada', 'faq_answer', item.answer, 900, 2, 'Respuesta que el asistente debe respetar.'));
    }
    var remove = node('button', 'connections-remove-row', 'Quitar');
    remove.type = 'button'; remove.setAttribute('aria-label', type === 'service' ? 'Quitar servicio' : 'Quitar pregunta frecuente');
    remove.addEventListener('click', function () { row.remove(); markTrainingDirty(); });
    row.append(fields, remove);
    return row;
  }

  function renderRepeatRows(selector, type, items) {
    var list = document.querySelector(selector);
    if (!list) return;
    list.innerHTML = '';
    (Array.isArray(items) ? items : []).forEach(function (item) { list.append(repeatRow(type, item)); });
  }

  function trainingStatusLabel() {
    if (state.dirty) return 'Cambios sin guardar';
    if (!state.draftRevision) return 'Borrador nuevo';
    if (state.publishedVersion && state.published && JSON.stringify(state.training) === JSON.stringify(state.published)) return 'Publicado';
    if (!state.draftRevision && state.published) return 'Contexto anterior';
    return 'Borrador guardado';
  }

  function renderTrainingMeta() {
    var badge = document.querySelector('[data-training-state]');
    var version = document.querySelector('[data-training-version]');
    var score = document.querySelector('[data-training-score]');
    var source = document.querySelector('[data-preview-source]');
    var previewVersion = document.querySelector('[data-preview-version]');
    if (badge) { badge.textContent = trainingStatusLabel(); badge.dataset.state = state.dirty ? 'dirty' : (state.publishedVersion && state.published && JSON.stringify(state.training) === JSON.stringify(state.published) ? 'published' : 'draft'); }
    if (version) version.textContent = state.publishedVersion ? 'Versión ' + state.publishedVersion + ' activa con pacientes' : (state.published ? 'Contexto anterior activo · publícalo para versionarlo' : 'Sin versión publicada');
    if (score) score.textContent = (state.validation && state.validation.score ? state.validation.score.percent : 0) + '%';
    if (source) {
      var publishedOption = source.querySelector('option[value="published"]');
      if (publishedOption) publishedOption.disabled = !state.published;
      if (source.value === 'published' && !state.published) source.value = 'draft';
      if (previewVersion) previewVersion.textContent = source.value === 'published'
        ? (state.publishedVersion ? 'Versión ' + state.publishedVersion + ' activa' : 'Contexto anterior activo')
        : 'Borrador r' + state.draftRevision;
    }
  }

  function renderValidation(validation) {
    state.validation = validation || null;
    var box = document.querySelector('[data-training-validation]');
    if (!box) return;
    if (!validation) { box.hidden = true; box.innerHTML = ''; renderTrainingMeta(); return; }
    box.hidden = false;
    box.dataset.state = validation.valid ? 'valid' : 'invalid';
    box.innerHTML = '';
    var title = node('strong', '', validation.valid ? 'Borrador válido para publicar' : 'Hay cambios necesarios antes de publicar');
    var summary = node('p', '', 'Capacitación ' + validation.score.percent + '% completa · ' + (validation.errors || []).length + ' errores · ' + (validation.warnings || []).length + ' recomendaciones.');
    box.append(title, summary);
    var issues = [].concat(validation.errors || [], validation.warnings || []);
    if (issues.length) {
      var list = node('ul');
      issues.slice(0, 12).forEach(function (issue) { list.append(node('li', issue.code && (validation.errors || []).includes(issue) ? 'is-error' : '', issue.message)); });
      box.append(list);
    }
    renderTrainingMeta();
  }

  function fillTraining(data) {
    var form = document.querySelector('[data-lana-training-form]');
    var training = data && data.draft ? data.draft : {};
    if (!form) return;
    state.training = training;
    state.published = data.published || null;
    state.draftRevision = Number(data.draft_revision) || 0;
    state.publishedVersion = Number(data.published_version) || 0;
    state.dirty = false;
    form.elements.assistant_name.value = training.assistant && training.assistant.name || 'SMYL Asistente';
    form.elements.tone.value = training.assistant && training.assistant.tone || 'profesional';
    form.elements.welcome_message.value = training.assistant && training.assistant.welcome_message || '';
    form.elements.clinic_description.value = training.clinic && training.clinic.description || '';
    form.elements.location.value = training.clinic && training.clinic.location || '';
    form.elements.hours.value = training.clinic && training.clinic.hours || '';
    form.elements.specialties.value = training.clinic && training.clinic.specialties || '';
    form.elements.contact_channels.value = training.clinic && training.clinic.contact_channels || '';
    form.elements.access_info.value = training.clinic && training.clinic.access_info || '';
    form.elements.minor_policy.value = training.clinic && training.clinic.minor_policy || '';
    form.elements.languages.value = training.clinic && training.clinic.languages || 'Español';
    var operations = training.operations || {};
    form.elements.branches.value = operations.branches || '';
    form.elements.scheduling_rules.value = operations.scheduling_rules || '';
    form.elements.approved_promotions.value = operations.approved_promotions || '';
    form.elements.allowed_memory.value = operations.allowed_memory || '';
    form.elements.prohibited_memory.value = operations.prohibited_memory || '';
    form.elements.attention_objective.value = training.attention && training.attention.objective || '';
    form.elements.appointment_policy.value = training.attention && training.attention.appointment_policy || '';
    form.elements.pricing_policy.value = training.attention && training.attention.pricing_policy || '';
    form.elements.intake_questions.value = training.attention && training.attention.intake_questions || '';
    form.elements.handoff_rules.value = training.attention && training.attention.handoff_rules || '';
    ['cancellation_policy','payment_policy','invoice_policy','insurance_policy','followup_policy','emergency_policy','human_response_policy'].forEach(function (name) { form.elements[name].value = training.attention && training.attention[name] || ''; });
    form.elements.autonomy_level.value = String(training.autonomy_level || 2);
    renderRepeatRows('[data-service-list]', 'service', training.services || []);
    renderRepeatRows('[data-faq-list]', 'faq', training.faq || []);
    var editable = Boolean(state.status && state.status.connected && state.status.can_manage);
    form.querySelectorAll('input,textarea,select,button').forEach(function (control) { control.disabled = !editable; });
    renderValidation(data.validation || null);
    renderTrainingMeta();
    contextStatus(state.draftRevision ? 'Borrador sincronizado. Publicar es una acción separada.' : 'Completa y guarda tu primer borrador.', state.draftRevision ? 'success' : '');
  }

  function collectRepeatRows(selector, type) {
    return Array.from(document.querySelectorAll(selector + ' .connections-repeat-row')).map(function (row) {
      if (type === 'service') return { id: row.dataset.rowId, name: row.querySelector('[name="service_name"]').value.trim(), description: row.querySelector('[name="service_description"]').value.trim(), pricing_note: row.querySelector('[name="service_pricing"]').value.trim() };
      return { id: row.dataset.rowId, question: row.querySelector('[name="faq_question"]').value.trim(), answer: row.querySelector('[name="faq_answer"]').value.trim() };
    }).filter(function (item) { return type === 'service' ? (item.name || item.description || item.pricing_note) : (item.question || item.answer); });
  }

  function trainingFromForm() {
    var form = document.querySelector('[data-lana-training-form]');
    return {
      schema_version: 2,
      assistant: { name: form.elements.assistant_name.value.trim(), tone: form.elements.tone.value, welcome_message: form.elements.welcome_message.value.trim() },
      clinic: { description: form.elements.clinic_description.value.trim(), location: form.elements.location.value.trim(), hours: form.elements.hours.value.trim(), specialties: form.elements.specialties.value.trim(), contact_channels: form.elements.contact_channels.value.trim(), access_info: form.elements.access_info.value.trim(), minor_policy: form.elements.minor_policy.value.trim(), languages: form.elements.languages.value.trim() },
      services: collectRepeatRows('[data-service-list]', 'service'),
      faq: collectRepeatRows('[data-faq-list]', 'faq'),
      attention: { objective: form.elements.attention_objective.value.trim(), appointment_policy: form.elements.appointment_policy.value.trim(), pricing_policy: form.elements.pricing_policy.value.trim(), intake_questions: form.elements.intake_questions.value.trim(), handoff_rules: form.elements.handoff_rules.value.trim(), cancellation_policy: form.elements.cancellation_policy.value.trim(), payment_policy: form.elements.payment_policy.value.trim(), invoice_policy: form.elements.invoice_policy.value.trim(), insurance_policy: form.elements.insurance_policy.value.trim(), followup_policy: form.elements.followup_policy.value.trim(), emergency_policy: form.elements.emergency_policy.value.trim(), human_response_policy: form.elements.human_response_policy.value.trim() },
      operations: { branches: form.elements.branches.value.trim(), scheduling_rules: form.elements.scheduling_rules.value.trim(), approved_promotions: form.elements.approved_promotions.value.trim(), allowed_memory: form.elements.allowed_memory.value.trim(), prohibited_memory: form.elements.prohibited_memory.value.trim() },
      autonomy_level: Number(form.elements.autonomy_level.value),
    };
  }

  function markTrainingDirty() {
    state.dirty = true;
    state.validation = null;
    renderValidation(null);
    renderTrainingMeta();
    contextStatus('Cambios locales. Guarda el borrador para no perderlos.', '');
  }

  async function loadTraining(force) {
    if (!state.status || !state.status.connected || (state.trainingLoaded && !force)) return;
    if (state.dirty) { contextStatus('Conservamos tus cambios locales sin guardar.', ''); return; }
    contextStatus('Cargando capacitación…', '');
    try { fillTraining(await trainingRequest('GET', 'training')); state.trainingLoaded = true; await loadTrainingVersions(); }
    catch (error) { contextStatus(error.message, 'error'); }
  }

  async function saveTrainingDraft(showSuccess) {
    if (!state.dirty && state.draftRevision > 0) return state.training;
    var button = document.querySelector('[data-save-training]');
    if (button) button.disabled = true;
    contextStatus('Guardando borrador…', '');
    try {
      var training = trainingFromForm();
      var data = await trainingRequest('PUT', 'draft', { training: training, expected_revision: state.draftRevision });
      state.training = data.draft || training; state.draftRevision = Number(data.draft_revision); state.dirty = false; renderValidation(null); resetPreview(); renderTrainingMeta();
      if (showSuccess !== false) contextStatus('Borrador guardado. Todavía no cambia las respuestas a pacientes.', 'success');
      return state.training;
    } catch (error) {
      contextStatus(error.message, 'error');
      throw error;
    } finally {
      if (button) button.disabled = !state.status || !state.status.connected || !state.status.can_manage;
    }
  }

  async function saveTraining(event) {
    event.preventDefault();
    try { await saveTrainingDraft(true); } catch (error) {}
  }

  async function runValidation() {
    await saveTrainingDraft(false);
    contextStatus('Validando estructura y límites clínicos…', '');
    var data = await trainingRequest('POST', 'validate', { expected_revision: state.draftRevision });
    renderValidation(data);
    contextStatus(data.valid ? 'Validación aprobada. Revisa las recomendaciones o publica.' : 'Corrige los errores marcados antes de publicar.', data.valid ? 'success' : 'error');
    return data;
  }

  async function validateTraining() {
    var button = document.querySelector('[data-validate-training]');
    if (button) button.disabled = true;
    try { await runValidation(); }
    catch (error) { if (error.payload && error.payload.validation) renderValidation(error.payload.validation); contextStatus(error.message, 'error'); }
    finally { if (button) button.disabled = !state.status || !state.status.connected || !state.status.can_manage; }
  }

  async function publishTraining() {
    var button = document.querySelector('[data-publish-training]');
    if (button) button.disabled = true;
    try {
      var validation = await runValidation();
      if (!validation.valid) return;
      if (!window.confirm('¿Publicar esta capacitación? La versión publicada comenzará a usarse en las respuestas nuevas del asistente a pacientes.')) return;
      contextStatus('Publicando la nueva versión…', '');
      var data = await trainingRequest('POST', 'publish', { expected_revision: state.draftRevision }, mutationKey());
      state.published = data.published || state.training; state.publishedVersion = Number(data.published_version) || state.publishedVersion; state.dirty = false; renderTrainingMeta(); resetPreview();
      contextStatus('Versión ' + state.publishedVersion + ' publicada. Ya es la capacitación activa con pacientes.', 'success');
      await loadTrainingVersions();
    } catch (error) {
      if (error.payload && error.payload.validation) renderValidation(error.payload.validation);
      contextStatus(error.message, 'error');
    } finally {
      if (button) button.disabled = !state.status || !state.status.connected || !state.status.can_manage;
    }
  }

  async function loadTrainingVersions() {
    var wrap = document.querySelector('[data-training-versions]');
    if (!wrap || !state.status || !state.status.connected) return;
    try {
      var data = await trainingRequest('GET', 'versions');
      wrap.innerHTML = '';
      if (!data.versions || !data.versions.length) { wrap.append(node('p', '', 'Aún no hay versiones publicadas.')); return; }
      data.versions.forEach(function (item) {
        var row = node('div', 'connections-version-row');
        var detail = node('div');
        detail.append(node('strong', '', 'Versión ' + item.version), node('small', '', new Date(item.published_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) + ' · ' + String(item.content_hash || '').slice(0, 10)));
        row.append(detail);
        if (state.status.can_manage && Number(item.version) !== state.publishedVersion) {
          var restore = node('button', 'btn btn-secondary', 'Restaurar como borrador'); restore.type = 'button';
          restore.addEventListener('click', function () { restoreTraining(Number(item.version)); }); row.append(restore);
        } else if (Number(item.version) === state.publishedVersion) row.append(node('span', 'connections-version-active', 'Activa'));
        wrap.append(row);
      });
    } catch (error) { wrap.innerHTML = ''; wrap.append(node('p', '', error.message)); }
  }

  async function restoreTraining(version) {
    if (!window.confirm('¿Restaurar la versión ' + version + ' como borrador? La versión activa con pacientes no cambiará hasta que vuelvas a publicar.')) return;
    contextStatus('Restaurando versión ' + version + '…', '');
    try {
      var restored = await trainingRequest('POST', 'restore', { version: version, expected_revision: state.draftRevision }, mutationKey());
      // La confirmación autoriza sustituir incluso cambios locales sin guardar.
      // Libera el candado de conservación para cargar el borrador restaurado.
      state.dirty = false;
      state.draftRevision = Number(restored.draft_revision) || state.draftRevision;
      await loadTraining(true); resetPreview(); contextStatus('Versión ' + version + ' restaurada como borrador. Revísala y publícala cuando esté lista.', 'success');
    } catch (error) { contextStatus(error.message, 'error'); }
  }

  function previewStatus(text, tone) {
    var el = document.querySelector('[data-lana-preview-status]');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.tone = tone || '';
  }

  function renderPreview() {
    var chat = document.querySelector('[data-lana-preview-chat]');
    if (!chat) return;
    if (!state.previewHistory.length) {
      chat.innerHTML = '<div class="connections-preview-empty"><span>S</span><div><strong>Conversación de prueba</strong><p>Escribe como paciente para revisar el tono, la información y cuándo el asistente debe pasar con una persona.</p></div></div>';
      return;
    }
    chat.innerHTML = '';
    state.previewHistory.forEach(function (turn) {
      var row = node('div', 'connections-preview-turn connections-preview-turn--' + turn.role);
      var bubble = node('div', 'connections-preview-bubble');
      var label = node('small', '', turn.role === 'user' ? 'Paciente de prueba' : 'SMYL Asistente');
      bubble.append(label, node('p', '', turn.content));
      if (turn.requiresHuman) bubble.append(node('span', 'connections-preview-escalation', 'Requiere intervención humana'));
      row.append(bubble); chat.append(row);
    });
    chat.scrollTop = chat.scrollHeight;
  }

  function resetPreview() {
    state.previewHistory = [];
    var input = document.getElementById('lana-preview-message');
    if (input) input.value = '';
    previewStatus('', '');
    renderPreview();
  }

  async function sendPreview(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var input = form.elements.message;
    var button = form.querySelector('[data-send-lana-preview]');
    var source = document.querySelector('[data-preview-source]');
    var mode = source ? source.value : 'draft';
    var message = input.value.trim();
    if (!message) { previewStatus('Escribe un mensaje de paciente para iniciar la prueba.', 'error'); input.focus(); return; }
    button.disabled = true;
    try {
      if (mode === 'draft' && (state.dirty || !state.draftRevision)) await saveTrainingDraft(false);
      var historyForRequest = state.previewHistory.slice(-8).map(function (turn) { return { role: turn.role, content: turn.content }; });
      state.previewHistory.push({ role: 'user', content: message });
      input.value = ''; renderPreview(); previewStatus('El asistente está preparando una respuesta privada…', '');
      var data = await trainingRequest('POST', 'preview', { message: message, history: historyForRequest, mode: mode });
      state.previewHistory.push({ role: 'assistant', content: data.reply || 'No se recibió una respuesta.', requiresHuman: Boolean(data.requires_human) });
      renderPreview(); previewStatus((data.requires_human ? 'El asistente escalaría este caso a una persona. ' : '') + (mode === 'draft' ? 'Respuesta generada con el borrador r' + data.config_version + '.' : 'Respuesta generada con la versión publicada ' + data.config_version + '.'), 'success');
    } catch (error) {
      if (state.previewHistory[state.previewHistory.length - 1] && state.previewHistory[state.previewHistory.length - 1].role === 'user') state.previewHistory.pop();
      renderPreview(); input.value = message; previewStatus(error.message || 'No se pudo probar la respuesta.', 'error');
    } finally {
      button.disabled = !state.status || !state.status.connected || !state.status.can_manage;
    }
  }

  async function loadStatus(force) {
    if (state.loading || (state.loaded && !force)) return;
    setBusy(true);
    try {
      renderStatus(await request('status'));
    } catch (error) {
      setMessage(error.message || 'No se pudo consultar el estado de la mensajería.', 'error');
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
    if (!apiKey) { setMessage('Pega el código de enlace proporcionado por soporte.', 'error'); input.focus(); return; }
    setBusy(true); setMessage('Validando el enlace seguro…', '');
    try {
      var status = await request('connect', { api_key: apiKey });
      renderStatus(status);
      setMessage('La mensajería quedó conectada de forma segura.', 'success');
    } catch (error) {
      setMessage(error.message || 'No se pudo conectar la mensajería.', 'error');
    } finally {
      input.value = '';
      input.type = 'password';
      var toggle = document.querySelector('[data-toggle-secret]');
      if (toggle) { toggle.textContent = 'Mostrar'; toggle.setAttribute('aria-label', 'Mostrar código'); }
      setBusy(false);
    }
  }

  async function provision() {
    setBusy(true); setMessage('Preparando la infraestructura de canales para esta clínica…', '');
    try {
      var status = await request('provision');
      renderStatus(status);
      setMessage('La mensajería quedó activa. Ya puedes conectar los canales de la clínica.', 'success');
    } catch (error) {
      setMessage(error.message || 'No se pudo activar la mensajería.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true); setMessage('Verificando la conexión segura…', '');
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
    row.querySelector('.pam-row-label').textContent = 'Canales e IA';
    var icon = row.querySelector('.pam-row-icon');
    if (icon) icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/></svg>';
    reference.after(row);
  }

  function init() {
    if (!window.TITULOS || !window.ir || document.getElementById('p-conexiones')) return;
    TITULOS.conexiones = 'Canales e IA';
    var primary = document.querySelector('.pro-primary-nav');
    var button = connectionButton();
    if (primary) {
      var inbox = primary.querySelector('[onclick="ir(\'inbox\')"]');
      if (inbox) inbox.after(button); else primary.insertBefore(button, primary.children[1] || null);
    }
    var mobile = document.querySelector('.pro-mobile-nav');
    if (mobile && !mobile.querySelector('[onclick="ir(\'conexiones\')"]')) {
      var mobileButton = connectionButton();
      mobileButton.textContent = 'Canales';
      var mobileInbox = mobile.querySelector('[onclick="ir(\'inbox\')"]');
      if (mobileInbox) mobileInbox.after(mobileButton); else mobile.append(mobileButton);
    }

    var page = node('section', 'pantalla');
    page.id = 'p-conexiones';
    page.innerHTML = pageMarkup();
    document.querySelector('.contenido').append(page);
    page.querySelector('[data-lana-form]').addEventListener('submit', connect);
    page.querySelector('[data-provision-lana]').addEventListener('click', provision);
    page.querySelectorAll('[data-connect-channel]').forEach(function (button) { button.addEventListener('click', channelAction); });
    page.querySelector('[data-disconnect-cancel]').addEventListener('click', function () { page.querySelector('[data-disconnect-dialog]').close(); });
    page.querySelector('[data-disconnect-confirm]').addEventListener('click', confirmDisconnect);
    var trainingForm = page.querySelector('[data-lana-training-form]');
    trainingForm.addEventListener('submit', saveTraining);
    trainingForm.addEventListener('input', markTrainingDirty);
    page.querySelector('[data-add-service]').addEventListener('click', function () { page.querySelector('[data-service-list]').append(repeatRow('service', { id: rowId('service'), name: '', description: '', pricing_note: '' })); markTrainingDirty(); });
    page.querySelector('[data-add-faq]').addEventListener('click', function () { page.querySelector('[data-faq-list]').append(repeatRow('faq', { id: rowId('faq'), question: '', answer: '' })); markTrainingDirty(); });
    page.querySelector('[data-validate-training]').addEventListener('click', validateTraining);
    page.querySelector('[data-publish-training]').addEventListener('click', publishTraining);
    page.querySelector('[data-lana-preview-form]').addEventListener('submit', sendPreview);
    page.querySelector('[data-clear-lana-preview]').addEventListener('click', resetPreview);
    page.querySelector('[data-preview-source]').addEventListener('change', function () { resetPreview(); renderTrainingMeta(); });
    page.querySelectorAll('[data-lana-scenario]').forEach(function (button) {
      button.addEventListener('click', function () {
        var input = document.getElementById('lana-preview-message');
        input.value = button.dataset.lanaScenario || '';
        input.focus(); previewStatus('Escenario listo. Presiona “Probar respuesta” cuando quieras usar IA.', '');
      });
    });
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
