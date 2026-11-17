(function () {
  'use strict';

  var REQUEST_TIMEOUTS = { status: 20000, connect: 40000, verify: 40000, provision: 50000, disconnect: 40000 };
  var CHANNEL_TIMEOUT_MS = 30000;
  var state = { loading: false, loaded: false, status: null, channels: [], disconnectingChannel: '', channelLoadGeneration: 0, channelLoadController: null, trainingLoaded: false, training: null, published: null, draftRevision: 0, publishedVersion: 0, validation: null, dirty: false, previewHistory: [] };

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
      '<header class="connections-hero"><div><p class="pro-eyebrow">COMUNICACIÓN</p>' +
      '<h1>Canales</h1>' +
      '<p>Conecta una cuenta y configura cómo atiende SMYL.</p></div>' +
      '<div class="connections-status-card" role="status" aria-live="polite" aria-atomic="true"><span class="connections-status-label">ESTADO</span>' +
      '<div class="connections-status-row"><span class="connections-status-dot"></span><strong data-lana-status>Cargando…</strong></div>' +
      '<p data-lana-summary>Comprobando la configuración de esta clínica.</p><small data-lana-verified></small></div></header>' +
      '<section class="connections-flow" aria-labelledby="connections-flow-title"><div class="connections-section-heading"><span>FLUJO SEGURO</span><h2 id="connections-flow-title">Un canal, dos responsabilidades claras</h2></div>' +
      '<ol><li><span>01</span><div><strong>El paciente escribe</strong><p>SMYL recibe y organiza la conversación de tus canales.</p></div></li>' +
      '<li><span>02</span><div><strong>El dentista revisa</strong><p>SMYL prepara la evidencia y el caso para revisión profesional.</p></div></li>' +
      '<li><span>03</span><div><strong>El equipo decide</strong><p>Nada clínico se entrega automáticamente sin aprobación humana.</p></div></li></ol></section>' +
      '<div class="connections-grid"><section class="connections-card connections-card-main"><div class="connections-card-head"><div><span>CONEXIÓN</span><h2>Infraestructura de canales</h2></div><span class="connections-badge" data-lana-badge>Pendiente</span></div>' +
      '<p data-lana-detail>SMYL puede preparar automáticamente la mensajería segura de esta clínica.</p>' +
      '<div class="connections-provision" data-provision-wrap><button type="button" class="btn btn-primary" data-provision-lana>Activar canales para mi clínica</button><p>La activación crea una conexión técnica protegida. No tendrás que copiar claves ni contraseñas.</p></div>' +
      '<div class="connections-actions connections-connected-actions" data-connected-actions hidden><button type="button" class="btn btn-secondary" data-verify-lana>Verificar conexión</button><button type="button" class="btn btn-secondary connections-unlink-button" data-unlink-lana>Desvincular mensajería</button></div>' +
      '<details class="connections-manual" data-manual-link><summary>Configuración avanzada de migración</summary><form data-lana-form autocomplete="off"><label for="lana-link-code">Código de enlace</label><div class="connections-secret-row"><input id="lana-link-code" name="lana-link-code" type="password" inputmode="text" spellcheck="false" autocomplete="new-password" placeholder="Pega el código una sola vez"><button type="button" class="btn btn-secondary" data-toggle-secret aria-label="Mostrar código">Mostrar</button></div>' +
      '<p class="connections-help">Utiliza esta opción únicamente si soporte te proporcionó un código. Se cifra en el servidor.</p><div class="connections-actions"><button type="submit" class="btn btn-secondary" data-connect-lana>Usar código existente</button></div></form></details><p class="connections-form-message" data-lana-message role="status"></p>' +
      '<div class="connections-staff-note" data-staff-note hidden>Solo el dueño de la clínica puede cambiar esta conexión. El equipo sí puede consultar su estado.</div></section>' +
      '<section class="connections-card"><div class="connections-card-head"><div><span>CANALES</span><h2>Conecta las cuentas de la clínica</h2></div></div>' +
      '<div class="connections-channel-list" role="list" aria-label="Canales de mensajería"><div role="listitem" data-channel-row="whatsapp"><span class="connections-channel-icon connections-channel-icon--whatsapp" aria-hidden="true"><img src="icons/brands/whatsapp.svg" alt=""></span><p><strong>Cuenta de la clínica</strong><small data-channel-state>Activa la mensajería para continuar</small></p><button type="button" class="btn btn-secondary" data-channel-primary-action data-connect-channel="whatsapp" disabled>Conectar</button><section class="connections-whatsapp-modes" data-whatsapp-modes aria-labelledby="whatsapp-mode-title"><header><span>TIPO DE CONEXIÓN</span><h3 id="whatsapp-mode-title">¿Cómo quieres usar tu número?</h3><p>Elige una opción. Podrás revisar los requisitos antes de abrir Meta.</p></header><div class="connections-whatsapp-mode-grid"><article class="connections-whatsapp-mode is-featured"><span class="connections-whatsapp-mode-label">Mismo número</span><h4>Conservar mi WhatsApp</h4><p>Usa el mismo número en la app Business y en SMYL.</p><div class="connections-mode-reqs"><strong>Requisitos y límites</strong><ul><li>Necesitas la app WhatsApp Business actualizada.</li><li>Grupos y llamadas continúan sólo en el celular.</li><li>Los chats anteriores no se importan todavía; los mensajes nuevos sí llegan a SMYL.</li><li>Responder desde el celular pausa al asistente en esa conversación.</li></ul></div><button type="button" class="btn btn-primary" data-connect-channel="whatsapp" data-connection-mode="coexistence" disabled>Conectar mi número actual</button></article><article class="connections-whatsapp-mode"><span class="connections-whatsapp-mode-label">Línea separada</span><h4>Usar un número exclusivo</h4><p>Para una línea nueva administrada desde SMYL.</p><div class="connections-mode-reqs"><strong>Requisitos y límites</strong><ul><li>El número debe estar libre de WhatsApp y WhatsApp Business.</li><li>Si ya está en una app, la migración puede perder su historial local.</li><li>Recomendamos una línea nueva para este modo.</li></ul></div><button type="button" class="btn btn-secondary" data-connect-channel="whatsapp" data-connection-mode="dedicated" disabled>Conectar número nuevo</button></article></div></section></div><div role="listitem" data-channel-row="messenger"><span class="connections-channel-icon connections-channel-icon--brand" aria-hidden="true"><img src="icons/brands/messenger.svg" alt=""></span><p><strong>Messenger</strong><small data-channel-state>Activa la mensajería para continuar</small></p><button type="button" class="btn btn-secondary" data-channel-primary-action data-connect-channel="messenger" disabled>Conectar</button></div><div role="listitem" data-channel-row="instagram"><span class="connections-channel-icon connections-channel-icon--brand" aria-hidden="true"><img src="icons/brands/instagram.svg" alt=""></span><p><strong>Instagram</strong><small data-channel-state>Activa la mensajería para continuar</small></p><button type="button" class="btn btn-secondary" data-channel-primary-action data-connect-channel="instagram" disabled>Conectar</button></div></div>' +
      '<div class="connections-channel-retry" data-channel-retry hidden role="status"><span>No pudimos consultar los canales.</span><button type="button" class="btn btn-secondary" data-retry-channels>Reintentar</button></div>' +
      '<p class="connections-boundary">Los tokens de Meta se procesan en una capa privada y nunca se muestran en el navegador ni se mezclan con el expediente clínico.</p></section></div>' +
      '<dialog class="connections-disconnect-dialog" data-disconnect-dialog><form method="dialog"><span class="connections-status-label">DESCONECTAR CANAL</span><h2 data-disconnect-title>¿Desconectar este canal?</h2><p data-disconnect-copy>El asistente dejará de recibir y enviar mensajes. El historial se conservará y podrás conectar otra cuenta después.</p><div class="connections-disconnect-summary"><span class="connections-channel-icon" data-disconnect-icon>I</span><div><strong data-disconnect-name>Instagram</strong><small data-disconnect-account></small></div></div><footer><button type="button" class="btn btn-secondary" data-disconnect-cancel>Cancelar</button><button type="button" class="btn connections-danger-button" data-disconnect-confirm>Desconectar</button></footer></form></dialog>' +
      '<dialog class="connections-disconnect-dialog" data-unlink-dialog aria-labelledby="connections-unlink-title"><form method="dialog"><span class="connections-status-label">DESVINCULAR MENSAJERÍA</span><h2 id="connections-unlink-title">¿Desvincular la mensajería de esta clínica?</h2><p>SMYL dejará de leer y enviar mensajes por WhatsApp, Messenger e Instagram para esta clínica, y pausará los recordatorios por WhatsApp.</p><div class="connections-disconnect-summary"><span class="connections-channel-icon" aria-hidden="true">L</span><div><strong>Enlace de mensajería</strong><small data-unlink-code></small></div></div><p class="connections-help"><strong>No se borra ninguna cuenta ni conversación, ni en tu plataforma de mensajería ni en Meta.</strong> Tus canales siguen funcionando allá. Podrás volver a vincular cuando quieras.</p><footer><button type="button" class="btn btn-secondary" data-unlink-cancel>Cancelar</button><button type="button" class="btn connections-danger-button" data-unlink-confirm>Desvincular</button></footer></form></dialog>' +
      '<section class="connections-context connections-training" aria-labelledby="lana-training-title"><div class="connections-section-heading"><span>CAPACITAR IA</span><h2 id="lana-training-title">Prepara a SMYL Asistente para atender pacientes</h2><p>Trabaja en borrador, valida la información y publica cuando esté lista. Solo la versión publicada responde en WhatsApp, Messenger e Instagram.</p></div>' +
      '<div class="connections-training-bar" role="status" aria-live="polite" aria-atomic="true"><div><span class="connections-training-state" data-training-state>Borrador sin guardar</span><small data-training-version>Sin versión publicada</small></div><div class="connections-training-score"><span data-training-score>0%</span><small>capacitación completa</small></div></div>' +
      '<form data-lana-training-form><fieldset><legend>Identidad y voz</legend><div class="connections-context-grid"><label>Nombre del asistente<input name="assistant_name" maxlength="50" value="SMYL Asistente"></label><label>Tono<select name="tone"><option value="profesional">Profesional y claro</option><option value="cercano">Cercano y empático</option><option value="breve">Breve y directo</option></select></label><label class="full">Mensaje de bienvenida<textarea name="welcome_message" maxlength="350" rows="2" placeholder="Hola, soy el asistente de la clínica. Puedo orientarte y ayudarte con el siguiente paso."></textarea></label></div></fieldset>' +
      '<fieldset><legend>La clínica</legend><div class="connections-context-grid"><label class="full">Descripción y enfoque<textarea name="clinic_description" maxlength="1600" rows="3" placeholder="Especialidad, enfoque, tipo de pacientes y qué distingue a la clínica."></textarea></label><label class="full">Especialidades confirmadas<textarea name="specialties" maxlength="1200" rows="2" placeholder="Odontología general, ortodoncia, implantología…"></textarea></label><label>Ubicación principal<input name="location" maxlength="500" placeholder="Dirección o zona de atención"></label><label>Horarios<input name="hours" maxlength="500" placeholder="Lun–Vie 9:00–18:00"></label><label>Idiomas<input name="languages" maxlength="300" placeholder="Español, inglés"></label><label>Canales de contacto<input name="contact_channels" maxlength="700" placeholder="Teléfono y medios autorizados"></label><label class="full">Acceso, estacionamiento y accesibilidad<textarea name="access_info" maxlength="900" rows="2"></textarea></label><label class="full">Política para menores y acompañantes<textarea name="minor_policy" maxlength="900" rows="2"></textarea></label></div></fieldset>' +
      '<fieldset><legend>Sucursales y operación</legend><div class="connections-context-grid"><label class="full">Sucursales, direcciones y cobertura<textarea name="branches" maxlength="2400" rows="4" placeholder="Una sucursal por bloque: dirección, horario, especialidades y profesionales disponibles."></textarea></label>' +
      '<div class="full connections-branch-tools" data-branch-tools hidden><div class="connections-branch-tools-row"><button type="button" class="btn btn-secondary" data-import-branches>Traer mis sucursales</button><label class="connections-inline-check"><input type="checkbox" data-ask-branch> Que el asistente pregunte la sucursal antes de agendar</label></div><p class="connections-branch-sync" data-branch-sync aria-live="polite"></p><p class="connections-fieldset-help">Tu clínica tiene varias sucursales. «Traer mis sucursales» llena este campo con sus direcciones, horarios y dentistas de Mi clínica. Cuando el paciente diga cuál prefiere, la conversación se asigna sola a esa sucursal.</p></div><label class="full">Reglas de agenda<textarea name="scheduling_rules" maxlength="1600" rows="3" placeholder="Anticipación, duración, confirmación, reprogramación y horarios especiales."></textarea></label><label class="full">Promociones autorizadas y vigencia<textarea name="approved_promotions" maxlength="1200" rows="2" placeholder="Sólo promociones aprobadas; indica fecha de vencimiento."></textarea></label></div></fieldset>' +
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
    document.querySelectorAll('[data-connect-lana],[data-provision-lana],[data-verify-lana],[data-unlink-lana]').forEach(function (button) { button.disabled = busy; });
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
    document.querySelector('.connections-status-card').setAttribute('aria-label', attention ? 'Estado: requiere atención' : (connected ? 'Estado: mensajería activa' : 'Estado: pendiente de conexión'));
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
    manualLink.hidden = connected || !status.can_manage;
    manualLink.open = false;
    manualLink.querySelector('summary').textContent = attention ? 'Reemplazar enlace' : 'Configuración avanzada de migración';
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
      cancelChannelLoad();
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
    var timeout = REQUEST_TIMEOUTS[action] || REQUEST_TIMEOUTS.connect;
    var timer = setTimeout(function () { controller.abort(); }, timeout);
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
      if (error && error.name === 'AbortError') {
        var timeoutError = new Error('La conexión tardó demasiado. Comprobaremos si la operación sí terminó.');
        timeoutError.isTimeout = true;
        timeoutError.action = action;
        throw timeoutError;
      }
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

  async function channelRequest(method, payload, options) {
    var controller = new AbortController();
    var externalSignal = options && options.signal;
    var cancelledByCaller = false;
    var abortFromCaller = function () { cancelledByCaller = true; controller.abort(); };
    if (externalSignal) {
      if (externalSignal.aborted) abortFromCaller();
      else externalSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
    var timer = setTimeout(function () { controller.abort(); }, CHANNEL_TIMEOUT_MS);
    try {
      var response = await fetch(SUPA_URL + '/functions/v1/lana-channels', {
        method: method,
        headers: { 'Authorization': 'Bearer ' + await sessionToken(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
        signal: controller.signal,
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación del canal.');
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        var channelError = new Error(cancelledByCaller ? 'Consulta reemplazada por una más reciente.' : 'Los canales tardaron demasiado en responder. Reintenta.');
        channelError.cancelled = cancelledByCaller;
        channelError.isTimeout = !cancelledByCaller;
        throw channelError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', abortFromCaller);
    }
  }

  function cancelChannelLoad() {
    state.channelLoadGeneration += 1;
    if (state.channelLoadController) state.channelLoadController.abort();
    state.channelLoadController = null;
  }

  function showChannelRetry(show) {
    var retry = document.querySelector('[data-channel-retry]');
    if (retry) retry.hidden = !show;
  }

  function historyStateLabel(value, coexistence) {
    if (!coexistence) return 'No aplica';
    if (value === 'completed') return 'Sincronizado';
    if (value === 'requested' || value === 'processing') return 'En proceso';
    if (value === 'failed') return 'Requiere revisión';
    return 'No importado';
  }

  function renderChannelWorkspaceState(name, item, connected, connectedToLana) {
    var pane = document.querySelector('[data-connection-pane="' + name + '"]');
    if (!pane) return;
    var coexistence = Boolean(item && item.connection_mode === 'coexistence');
    pane.dataset.channelState = connected ? 'connected' : 'pending';
    pane.dataset.lana = connectedToLana ? 'true' : 'false';
    var stepStates = { activate: connectedToLana ? 'done' : 'current', connect: connected ? 'done' : (connectedToLana ? 'current' : 'pending'), configure: connected ? 'current' : 'pending' };
    pane.querySelectorAll('[data-channel-steps] [data-step]').forEach(function (li) { li.dataset.state = stepStates[li.dataset.step] || 'pending'; });
    var accountTitle = pane.querySelector('.connections-channel-account > header h3');
    if (accountTitle) { if (!accountTitle.dataset.pending) accountTitle.dataset.pending = accountTitle.textContent; accountTitle.textContent = connected ? 'Cuenta conectada' : accountTitle.dataset.pending; }
    var dot = document.querySelector('[data-tab-dot="' + name + '"]');
    if (dot) { dot.dataset.state = connected ? 'connected' : 'pending'; dot.parentNode.setAttribute('title', channelName(name) + (connected ? ': conectado' : ': sin conectar')); }
    pane.dataset.connectionMode = coexistence ? 'coexistence' : (connected ? 'dedicated' : '');
    var status = pane.querySelector('[data-channel-pane-status]');
    if (status) {
      status.textContent = connected ? 'Conectado' : (connectedToLana ? 'Sin conectar' : 'Activa canales');
      status.dataset.state = connected ? 'connected' : 'pending';
    }
    var scopeTitle = pane.querySelector('[data-channel-scope-title]');
    var scopeCopy = pane.querySelector('[data-channel-scope-copy]');
    var mode = pane.querySelector('[data-channel-mode]');
    var history = pane.querySelector('[data-channel-history]');
    if (scopeTitle) scopeTitle.textContent = connected ? 'Disponible para la clínica' : 'Se configura al conectar';
    if (scopeCopy) scopeCopy.textContent = connected
      ? 'La cuenta pertenece a esta clínica y el equipo la usa según sus permisos.'
      : 'Primero conecta la cuenta. Después podrás revisar su alcance y herramientas.';
    if (mode) mode.textContent = connected
      ? (name === 'whatsapp' ? (coexistence ? 'WhatsApp + SMYL' : 'Sólo SMYL') : 'Cuenta conectada')
      : 'Pendiente';
    if (history) history.textContent = connected
      ? (name === 'whatsapp' ? historyStateLabel(item && item.history_sync_status, coexistence) : 'Conservado')
      : 'Pendiente';
    pane.querySelectorAll('[data-requires-channel]').forEach(function (button) {
      button.disabled = !connected;
      button.setAttribute('aria-disabled', String(!connected));
      var toolState = button.querySelector('[data-tool-state]');
      if (toolState) toolState.textContent = connected ? 'Disponible' : 'Conecta el canal';
    });
  }

  function renderChannels(channels) {
    state.channels = Array.isArray(channels) ? channels : [];
    showChannelRetry(false);
    var connectedToLana = Boolean(state.status && state.status.connected);
    var owner = Boolean(state.status && state.status.can_manage);
    document.querySelectorAll('[data-channel-row]').forEach(function (row) {
      var name = row.dataset.channelRow;
      var item = state.channels.find(function (value) { return value.channel === name; });
      var connected = Boolean(item && item.connected);
      var coexistence = Boolean(item && item.connection_mode === 'coexistence');
      var statusText = row.querySelector('[data-channel-state]');
      var button = row.querySelector('[data-channel-primary-action]');
      var choices = row.querySelector('[data-whatsapp-modes]');
      var choiceButtons = row.querySelectorAll('[data-whatsapp-modes] [data-connection-mode]');
      row.dataset.state = connected ? 'connected' : 'pending';
      row.dataset.activeConnectionMode = coexistence ? 'coexistence' : (connected ? 'dedicated' : '');
      row.dataset.historyState = item && item.history_sync_status || '';
      statusText.textContent = connected
        ? ((item.display_name || item.display_phone_number || 'Cuenta conectada') + ' · ' + (name === 'whatsapp' ? (coexistence ? 'WhatsApp + SMYL' : 'Sólo SMYL') : 'Canal activo'))
        : (connectedToLana ? (name === 'whatsapp' ? 'Elige cómo conectar el número' : 'Listo para conectar') : 'Activa la mensajería para continuar');
      if (choices) choices.hidden = connected;
      choiceButtons.forEach(function (choice) { choice.disabled = connected || !connectedToLana || !owner; });

      // Messenger e Instagram se revocan canal por canal. WhatsApp no: su cuenta
      // vive en el motor de mensajería y borrarla podría apagar un WhatsApp real,
      // así que aquí sólo se puede desvincular el enlace completo de SMYL.
      var canDisconnect = connected && name !== 'whatsapp' && owner;
      var canUnlink = connected && name === 'whatsapp' && owner;
      var rowAction = canDisconnect ? 'disconnect' : canUnlink ? 'unlink' : 'connect';
      if (button) {
        button.hidden = name === 'whatsapp' && !connected;
        button.textContent = state.disconnectingChannel === name ? 'Desconectando…' : canDisconnect ? 'Desconectar' : canUnlink ? 'Desvincular' : connected ? 'Conectado' : 'Conectar';
        button.setAttribute('aria-label', button.textContent + ' ' + channelName(name));
        button.dataset.channelAction = rowAction;
        button.classList.toggle('connections-channel-disconnect', canDisconnect || canUnlink);
        button.disabled = state.disconnectingChannel === name || (connected ? !(canDisconnect || canUnlink) : (!connectedToLana || !owner));
      }
      renderChannelWorkspaceState(name, item, connected, connectedToLana);
    });
  }

  async function loadChannels() {
    var generation = state.channelLoadGeneration + 1;
    state.channelLoadGeneration = generation;
    if (state.channelLoadController) state.channelLoadController.abort();
    var controller = new AbortController();
    state.channelLoadController = controller;
    showChannelRetry(false);
    try {
      var data = await channelRequest('GET', null, { signal: controller.signal });
      if (generation !== state.channelLoadGeneration) return;
      renderChannels(data.channels || []);
    } catch (error) {
      if (generation !== state.channelLoadGeneration || error.cancelled) return;
      document.querySelectorAll('[data-channel-state]').forEach(function (el) { el.textContent = 'No se pudo consultar · reintenta'; });
      showChannelRetry(true);
      setMessage(error.message || 'No se pudo consultar el estado de los canales.', 'error');
    } finally {
      if (generation === state.channelLoadGeneration) state.channelLoadController = null;
    }
  }

  async function connectChannel(event) {
    var selected = event.currentTarget.dataset.connectChannel;
    var connectionMode = selected === 'whatsapp' && event.currentTarget.dataset.connectionMode === 'coexistence' ? 'coexistence' : 'dedicated';
    var button = event.currentTarget;
    var popup = window.open('', 'smyl-lana-' + selected + '-' + connectionMode, 'width=560,height=760');
    if (!popup) { setMessage('Permite las ventanas emergentes para conectar este canal.', 'error'); return; }
    popup.document.title = 'Preparando conexión…';
    popup.document.body.textContent = 'Preparando conexión segura con el canal…';
    button.disabled = true;
    setMessage(connectionMode === 'coexistence' ? 'Preparando tu número actual…' : 'Preparando la conexión de ' + selected + '…', '');
    try {
      var data = await channelRequest('POST', { action: 'setup', channel: selected, connection_mode: connectionMode });
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
    } finally {
      button.disabled = false;
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
    var disconnectIcon = dialog.querySelector('[data-disconnect-icon]');
    disconnectIcon.classList.add('connections-channel-icon--brand');
    disconnectIcon.innerHTML = '<img src="icons/brands/' + (channel === 'instagram' ? 'instagram' : 'messenger') + '.svg" alt="">';
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
    if (event.currentTarget.dataset.channelAction === 'unlink') {
      openUnlinkDialog();
      return;
    }
    connectChannel(event);
  }

  function openUnlinkDialog() {
    var dialog = document.querySelector('[data-unlink-dialog]');
    var status = state.status;
    if (!dialog || !status || !status.can_manage || !(status.connected || status.estado === 'requiere_atencion')) return;
    dialog.querySelector('[data-unlink-code]').textContent = 'Código verificado · ' + (status.fingerprint || 'enlace protegido');
    dialog.showModal();
  }

  async function confirmUnlink() {
    var dialog = document.querySelector('[data-unlink-dialog]');
    if (state.loading) return;
    if (dialog && dialog.open) dialog.close();
    setBusy(true); setMessage('Desvinculando la mensajería de forma segura…', '');
    var done = 'La mensajería quedó desvinculada. No se borró ninguna cuenta ni conversación; puedes volver a vincularla cuando quieras.';
    try {
      renderStatus(await request('disconnect'));
      setMessage(done, 'success');
    } catch (error) {
      if (error.isTimeout) {
        var reconciled = await reconcileConnectionStatus();
        if (reconciled && !reconciled.connected && reconciled.estado === 'pendiente') {
          setMessage(done, 'success');
          return;
        }
      }
      setMessage(error.message || 'No se pudo desvincular la mensajería.', 'error');
    } finally {
      setBusy(false);
    }
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

  // Sucursales en el entrenamiento: texto con direcciones y horarios, y la instrucción de preguntar la sede.
  var ASK_BRANCH_LINE = 'Si la clínica tiene más de una sucursal y el paciente aún no dijo en cuál quiere atenderse, pregúntaselo en una frase corta, con los nombres exactos de las sucursales, antes de hablar de horarios o de agendar.';
  var DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  function hourLabel(value) { var m = /^(\d{1,2}):(\d{2})/.exec(String(value || '')); return m ? Number(m[1]) + ':' + m[2] : ''; }
  function hoursSummary(rows) {
    var byDay = {};
    (rows || []).forEach(function (row) { (byDay[row.weekday] = byDay[row.weekday] || []).push(hourLabel(row.starts_at) + '–' + hourLabel(row.ends_at)); });
    var order = [1, 2, 3, 4, 5, 6, 0], groups = [];
    order.forEach(function (day) {
      if (!byDay[day]) return;
      var label = byDay[day].join(' y '), last = groups[groups.length - 1];
      if (last && last.label === label && last.next === order.indexOf(day)) { last.end = day; last.next = order.indexOf(day) + 1; }
      else groups.push({ start: day, end: day, label: label, next: order.indexOf(day) + 1 });
    });
    return groups.map(function (g) { return (g.start === g.end ? DAY_SHORT[g.start] : DAY_SHORT[g.start] + '–' + DAY_SHORT[g.end]) + ' ' + g.label; }).join('; ');
  }
  // team = [{ branch_id, name, specialty }]: dentistas de cada sucursal (opcional; sin él, el texto es el de siempre).
  function branchesDescription(branches, hours, team) {
    function build(level) {
      return (branches || []).map(function (branch) {
        var address = [branch.address_line, branch.city, branch.state].filter(Boolean).join(', ');
        var schedule = hoursSummary((hours || []).filter(function (row) { return row.branch_id === branch.id; }));
        var people = level > 1 ? [] : (team || []).filter(function (row) { return row.branch_id === branch.id; }).map(function (row) {
          return level === 0 && row.specialty ? row.name + ' (' + row.specialty + ')' : row.name;
        });
        var dentists = people.length ? 'Dentistas: ' + people.slice(0, 8).join(', ') + (people.length > 8 ? ' y ' + (people.length - 8) + ' más' : '') : '';
        return [branch.name, address, branch.phone ? 'Tel. ' + branch.phone : '', schedule ? 'Horario: ' + schedule : '', dentists].filter(Boolean).join(' · ');
      }).join('\n');
    }
    // Si no cabe en el campo, se quitan primero las especialidades y luego los dentistas, nunca direcciones u horarios.
    var text = build(0);
    if (text.length > 2400) text = build(1);
    if (text.length > 2400) text = build(2);
    return text.slice(0, 2400);
  }
  // ¿Lo que dice el campo coincide con las sucursales de Mi clínica ahora mismo?
  function branchesSyncState(current, fresh) {
    var norm = function (value) { return String(value || '').replace(/\s+/g, ' ').trim(); };
    if (!norm(fresh)) return 'none';
    if (!norm(current)) return 'empty';
    return norm(current) === norm(fresh) ? 'ok' : 'stale';
  }
  function setAskBranchLine(text, on) {
    var lines = String(text || '').split('\n').filter(function (line) { return line.trim() !== ASK_BRANCH_LINE; });
    if (on) lines.push(ASK_BRANCH_LINE);
    return lines.join('\n').trim().slice(0, 1600);
  }
  async function loadClinicBranches() {
    try {
      var tenant = window.tenantId;
      var branches = await window.sb.from('smyl_branches').select('id,name,address_line,city,state,phone,is_default').eq('tenant_id', tenant).eq('active', true).order('is_default', { ascending: false }).order('name');
      var hours = await window.sb.from('smyl_clinic_hours').select('branch_id,weekday,starts_at,ends_at,active').eq('tenant_id', tenant).eq('active', true);
      state.clinicBranches = branches && branches.data || [];
      state.clinicHours = hours && hours.data || [];
      state.clinicTeam = [];
      try {
        var links = await window.sb.from('smyl_professional_branches').select('professional_id,branch_id').eq('tenant_id', tenant);
        var pros = await window.sb.from('smyl_professionals').select('id,display_name,specialty').eq('tenant_id', tenant).eq('active', true).order('display_name');
        var byId = {}; ((pros && pros.data) || []).forEach(function (row) { byId[row.id] = row; });
        state.clinicTeam = ((links && links.data) || []).filter(function (row) { return byId[row.professional_id]; }).map(function (row) {
          return { branch_id: row.branch_id, name: byId[row.professional_id].display_name, specialty: byId[row.professional_id].specialty || '' };
        }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      } catch (_) { state.clinicTeam = []; }
    } catch (_) { state.clinicBranches = []; state.clinicHours = []; state.clinicTeam = []; }
    syncBranchTools();
  }
  function syncBranchTools() {
    var tools = document.querySelector('[data-branch-tools]'), form = document.querySelector('[data-lana-training-form]');
    if (!tools || !form) return;
    tools.hidden = !(state.clinicBranches && state.clinicBranches.length > 1);
    var check = tools.querySelector('[data-ask-branch]');
    if (check && form.elements.intake_questions) check.checked = String(form.elements.intake_questions.value || '').indexOf(ASK_BRANCH_LINE) !== -1;
    var note = tools.querySelector('[data-branch-sync]');
    if (note && form.elements.branches) {
      var status = branchesSyncState(form.elements.branches.value, branchesDescription(state.clinicBranches, state.clinicHours, state.clinicTeam));
      note.dataset.state = status;
      note.textContent = status === 'ok' ? 'Sucursales al día: el asistente tiene las direcciones, horarios y dentistas actuales de Mi clínica.'
        : status === 'stale' ? 'Tus sucursales, horarios o dentistas ya no coinciden con este texto. Pulsa «Traer mis sucursales» y publica para que el asistente use lo actual.'
        : status === 'empty' ? 'El asistente aún no conoce tus sucursales. Pulsa «Traer mis sucursales».' : '';
    }
  }
  function bindBranchTools(root) {
    root.addEventListener('click', function (event) {
      var button = event.target.closest && event.target.closest('[data-import-branches]');
      if (!button) return;
      var form = document.querySelector('[data-lana-training-form]'), field = form && form.elements.branches;
      if (!field) return;
      if (String(field.value || '').trim() && !window.confirm('Esto reemplaza lo que escribiste en «Sucursales, direcciones y cobertura». ¿Continuar?')) return;
      field.value = branchesDescription(state.clinicBranches, state.clinicHours, state.clinicTeam);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    root.addEventListener('change', function (event) {
      var check = event.target.closest && event.target.closest('[data-ask-branch]');
      if (!check) return;
      var form = document.querySelector('[data-lana-training-form]'), field = form && form.elements.intake_questions;
      if (!field) return;
      field.value = setAskBranchLine(field.value, check.checked);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  // Ejemplos: texto de una clínica dental típica para cada campo difícil. Lo que va entre [corchetes] hay que completarlo con datos reales.
  var TRAIN_EXAMPLES = {
    welcome_message: 'Hola, soy el asistente virtual de [nombre de la clínica]. Puedo resolver dudas sobre servicios, horarios y ubicación, y ayudarte a dar el siguiente paso con nuestro equipo. ¿En qué te ayudo?',
    clinic_description: 'Somos una clínica dental en [ciudad] enfocada en [odontología general, ortodoncia y estética dental]. Nos distinguimos por explicar cada tratamiento con claridad, cuidar la comodidad del paciente y dar seguimiento después de cada visita.',
    specialties: 'Odontología general, limpieza dental, resinas, endodoncia, ortodoncia y estética dental. [Quita o agrega según lo que realmente ofrezcas].',
    access_info: 'La clínica está en [calle y número, colonia]. Hay estacionamiento [en la calle / propio / cercano]. El acceso es [a nivel de calle / por elevador] y [sí / no] contamos con acceso para silla de ruedas.',
    minor_policy: 'Los menores de edad deben venir acompañados por su madre, padre o tutor, quien firma el consentimiento. Para agendar una cita de un menor, pedimos el nombre del tutor y un teléfono de contacto.',
    scheduling_rules: 'Las citas se agendan con [24 horas] de anticipación. La valoración inicial dura aproximadamente [30 minutos]. Confirmamos la cita por mensaje el día anterior. Para mover una cita, avisar con al menos [12 horas].',
    approved_promotions: '[Describe solo promociones vigentes, por ejemplo: «Limpieza dental con valoración sin costo en [mes]. Vigente hasta el [fecha]»]. Si no hay promociones, deja este campo vacío.',
    attention_objective: 'Resolver dudas básicas del paciente, orientarlo sobre servicios y horarios, y ayudarlo a agendar una valoración. Cuando el caso requiera criterio clínico, pasarlo con el equipo.',
    appointment_policy: 'Para agendar pide nombre completo, teléfono, servicio de interés y horario preferido, una o dos preguntas por mensaje. No confirmes la cita por tu cuenta: ofrece los horarios disponibles y pasa los datos al equipo para confirmarla.',
    cancellation_policy: 'Pedimos avisar con al menos [12 horas] de anticipación para cancelar o mover una cita. Si no se avisa y el paciente no asiste, el equipo revisa cada caso; no prometas cobros ni exenciones.',
    pricing_policy: 'Solo comparte los precios que aparecen en la lista de servicios y aclara que son de referencia. El costo final lo define el profesional después de valorar al paciente. Nunca inventes ni redondees importes.',
    payment_policy: 'Aceptamos [efectivo, transferencia y tarjeta]. Algunos tratamientos pueden pagarse en [parcialidades]; el equipo confirma las condiciones. No pidas datos bancarios por este chat.',
    invoice_policy: 'La factura se solicita al equipo dentro del mes de la consulta, con [constancia de situación fiscal y uso de CFDI]. Nunca pidas contraseñas ni documentos completos por este chat.',
    insurance_policy: '[Indica si trabajas con seguros o reembolsos]. Si el paciente pregunta por su seguro, explica que el equipo revisa la cobertura y que no puedes asegurar reembolsos.',
    followup_policy: 'Después de un tratamiento podemos escribir al paciente para preguntar cómo se siente y recordarle su siguiente cita. Respeta si pide no recibir mensajes.',
    intake_questions: 'Nombre completo, tratamiento de interés, horario preferido y sucursal. Una o dos preguntas por mensaje; no pidas historial clínico detallado por chat.',
    emergency_policy: 'Si el paciente describe dolor intenso, inflamación en cara o cuello, sangrado abundante, fiebre o dificultad para respirar, indícale que llame de inmediato a la clínica al [teléfono] o acuda a urgencias, y avisa al equipo. No des diagnósticos ni recetes medicamentos.',
    handoff_rules: 'Pasa la conversación a una persona cuando el paciente lo pida, cuando hable de síntomas o dolor, cuando haya una queja, cuando pregunte por cobros o facturas específicas, o cuando no tengas la información confirmada.',
    human_response_policy: 'Nuestro equipo responde de [lunes a viernes de 9:00 a 18:00]. Fuera de ese horario, el asistente avisa que el mensaje quedó registrado y que lo atenderán a la brevedad.',
    allowed_memory: 'Nombre del paciente, servicio de interés, sucursal elegida y horario preferido, para no volver a preguntarlos en la conversación.',
    prohibited_memory: 'Datos de salud, diagnósticos, medicamentos, datos bancarios, contraseñas y documentos de identidad.'
  };
  var TRAIN_FAQ_EXAMPLES = [
    { q: '¿Cuáles son sus horarios?', a: 'Atendemos [días] de [hora] a [hora]. Si necesitas otro horario, el equipo te ayuda a revisar opciones.' },
    { q: '¿Cuánto cuesta una valoración?', a: 'La valoración inicial cuesta [monto]. En ella el profesional revisa tu caso y te explica el plan y su costo.' },
    { q: '¿Dónde están ubicados?', a: 'Estamos en [dirección]. [Indica referencias y estacionamiento].' },
    { q: '¿Qué formas de pago aceptan?', a: 'Aceptamos [efectivo, transferencia y tarjeta]. El equipo te confirma si el tratamiento permite pagos parciales.' },
    { q: '¿Puedo llevar a mi hijo o hija?', a: 'Sí, atendemos niños y niñas. Deben venir acompañados por su madre, padre o tutor.' }
  ];
  function hasPlaceholders(value) { return /\[[^\]]{2,}\]/.test(String(value || '')); }
  function trainingPlaceholders(form) {
    var found = [];
    Object.keys(TRAIN_EXAMPLES).concat(['clinic_description', 'specialties']).forEach(function (name) { if (form.elements[name] && hasPlaceholders(form.elements[name].value) && found.indexOf(name) === -1) found.push(name); });
    form.querySelectorAll('.connections-repeat-row textarea, .connections-repeat-row input').forEach(function (control) { if (hasPlaceholders(control.value) && found.indexOf('rows') === -1) found.push('rows'); });
    return found;
  }
  function initTrainingExamples(root) {
    var form = root.querySelector('[data-lana-training-form]');
    if (!form || form.dataset.examplesReady) return;
    form.dataset.examplesReady = 'true';
    Object.keys(TRAIN_EXAMPLES).forEach(function (name) {
      var field = form.elements[name], label = field && field.closest('label');
      if (!label) return;
      var wrap = node('div', 'connections-example-wrap'); wrap.dataset.exampleFor = name;
      var open = node('button', 'connections-example-link', 'Ver ejemplo'); open.type = 'button'; open.dataset.exampleOpen = name;
      var box = node('div', 'connections-example-box'); box.hidden = true;
      var text = node('p', '', TRAIN_EXAMPLES[name]);
      var use = node('button', 'btn btn-secondary', 'Usar este ejemplo'); use.type = 'button'; use.dataset.exampleUse = name;
      var close = node('button', 'connections-example-link', 'Cerrar'); close.type = 'button'; close.dataset.exampleClose = name;
      var note = node('small', '', hasPlaceholders(TRAIN_EXAMPLES[name]) ? 'Reemplaza lo que está entre [corchetes] con los datos reales de tu clínica antes de publicar.' : 'Es una guía: edítalo para que suene a tu clínica.');
      box.append(text, note, node('div', 'connections-example-actions')); box.lastChild.append(use, close);
      wrap.append(open, box); label.after(wrap);
    });
    var faqAdd = form.querySelector('[data-add-faq]');
    if (faqAdd) {
      var faqExamples = node('button', 'connections-example-link', 'Agregar preguntas de ejemplo'); faqExamples.type = 'button'; faqExamples.dataset.faqExamples = 'true';
      faqAdd.after(faqExamples);
    }
    form.addEventListener('click', function (event) {
      var target = event.target.closest && event.target.closest('[data-example-open],[data-example-use],[data-example-close],[data-faq-examples]');
      if (!target) return;
      if (target.dataset.faqExamples) {
        var list = form.querySelector('[data-faq-list]'), current = collectRepeatRows('[data-faq-list]', 'faq');
        var missing = TRAIN_FAQ_EXAMPLES.filter(function (example) { return !current.some(function (row) { return row.question === example.q; }); }).slice(0, Math.max(0, 20 - current.length));
        if (!missing.length || !list) return;
        var rows = current.concat(missing.map(function (example) { return { id: undefined, question: example.q, answer: example.a }; }));
        renderRepeatRows('[data-faq-list]', 'faq', rows);
        markTrainingDirty(); updateTrainingSteps();
        contextStatus('Agregamos ' + missing.length + ' preguntas de ejemplo. Completa lo que está entre [corchetes].', '');
        return;
      }
      var name = target.dataset.exampleOpen || target.dataset.exampleUse || target.dataset.exampleClose;
      var wrap = form.querySelector('[data-example-for="' + name + '"]'), box = wrap && wrap.querySelector('.connections-example-box');
      if (!box) return;
      if (target.dataset.exampleOpen) { box.hidden = !box.hidden; return; }
      if (target.dataset.exampleClose) { box.hidden = true; return; }
      var field = form.elements[name];
      if (String(field.value || '').trim() && !window.confirm('Esto reemplaza lo que ya escribiste en este campo. ¿Usar el ejemplo?')) return;
      field.value = TRAIN_EXAMPLES[name];
      field.dispatchEvent(new Event('input', { bubbles: true }));
      box.hidden = true; field.focus();
    });
  }

  // Capacitar IA por etapas: el mismo formulario se reparte en 6 pasos; cada paso muestra solo lo suyo y su avance.
  var TRAIN_STEPS = [
    { key: 1, title: 'Identidad', hint: 'Cómo se llama y cómo habla tu asistente.' },
    { key: 2, title: 'Tu clínica', hint: 'Lo que puede decir de tu clínica: solo información confirmada.' },
    { key: 3, title: 'Sedes y servicios', hint: 'Dónde atiendes y qué ofreces.' },
    { key: 4, title: 'Preguntas frecuentes', hint: 'Las respuestas que tu equipo repite todos los días.' },
    { key: 5, title: 'Reglas de atención', hint: 'Cómo agenda, qué cobra, cuándo pasa con una persona.' },
    { key: 6, title: 'Revisar y publicar', hint: 'Valida el borrador y publícalo cuando esté listo.' }
  ];
  var TRAIN_FIELD_STEP = { 'Identidad y voz': 1, 'La clínica': 2, 'Sucursales y operación': 3, 'Servicios confirmados': 3, 'Preguntas frecuentes': 4, 'Flujo de atención': 5, 'Memoria administrativa': 5 };
  function trainingStepDone(key, form) {
    var filled = function (name) { return Boolean(form.elements[name] && String(form.elements[name].value || '').trim() && !hasPlaceholders(form.elements[name].value)); };
    var rows = function (selector) { return form.querySelectorAll(selector + ' .connections-repeat-row').length; };
    if (key === 1) return filled('assistant_name') && filled('welcome_message');
    if (key === 2) return filled('clinic_description') && filled('specialties') && (filled('location') || filled('hours'));
    if (key === 3) return filled('branches') || rows('[data-service-list]') > 0;
    if (key === 4) return rows('[data-faq-list]') > 0 && !Array.prototype.some.call(form.querySelectorAll('[data-faq-list] textarea, [data-faq-list] input'), function (control) { return hasPlaceholders(control.value); });
    if (key === 5) return filled('appointment_policy') && filled('pricing_policy') && filled('emergency_policy');
    return false;
  }
  // Avisos del paso final cuando la clínica tiene varias sucursales.
  function multiBranchNotes(form) {
    if (!(state.clinicBranches && state.clinicBranches.length > 1)) return '';
    var notes = [];
    var status = branchesSyncState(form.elements.branches && form.elements.branches.value, branchesDescription(state.clinicBranches, state.clinicHours, state.clinicTeam));
    if (status === 'stale' || status === 'empty') notes.push(['Sucursales', status === 'empty' ? 'El asistente aún no conoce tus sucursales: usa «Traer mis sucursales» en el paso 3.' : 'El texto de sucursales no coincide con Mi clínica: usa «Traer mis sucursales» en el paso 3.']);
    if (!(form.elements.intake_questions && String(form.elements.intake_questions.value || '').indexOf(ASK_BRANCH_LINE) !== -1)) notes.push(['Pregunta de sucursal', 'El asistente no preguntará a qué sucursal quiere ir el paciente. Actívalo en el paso 3.']);
    return notes.map(function (note) { return '<li data-state="pending"><span aria-hidden="true">!</span><div><strong>' + note[0] + '</strong><small>' + note[1] + '</small></div></li>'; }).join('');
  }
  function goTrainingStep(key) {
    var form = document.querySelector('[data-lana-training-form]');
    if (!form) return;
    state.trainStep = Math.max(1, Math.min(TRAIN_STEPS.length, Number(key) || 1));
    if (state.dirty) scheduleTrainingAutosave(true);
    updateTrainingSteps();
    var top = document.querySelector('[data-train-steps]');
    if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function updateTrainingSteps() {
    var form = document.querySelector('[data-lana-training-form]'), nav = document.querySelector('[data-train-steps]');
    if (!form || !nav) return;
    var current = state.trainStep || 1;
    form.dataset.step = String(current);
    nav.querySelectorAll('[data-train-go]').forEach(function (button) {
      var key = Number(button.dataset.trainGo), done = key < 6 && trainingStepDone(key, form);
      button.dataset.state = key === current ? 'current' : (done ? 'done' : 'pending');
      button.querySelector('b').textContent = done && key !== current ? '✓' : String(key);
      if (key === current) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
    var info = TRAIN_STEPS[current - 1], intro = document.querySelector('[data-train-intro]');
    if (intro) intro.innerHTML = '<span>Paso ' + current + ' de ' + TRAIN_STEPS.length + '</span><strong>' + info.title + '</strong><p>' + info.hint + '</p>';
    var review = form.querySelector('[data-train-review]');
    if (review) {
      review.innerHTML = '<h3>Antes de publicar</h3><ul>' + TRAIN_STEPS.slice(0, 5).map(function (step) {
        var done = trainingStepDone(step.key, form);
        return '<li data-state="' + (done ? 'done' : 'pending') + '"><span aria-hidden="true">' + (done ? '✓' : '!') + '</span><div><strong>' + step.title + '</strong><small>' + (done ? 'Listo' : 'Falta información en este paso') + '</small></div><button type="button" data-train-go="' + step.key + '">' + (done ? 'Editar' : 'Completar') + '</button></li>';
      }).join('') + (multiBranchNotes(form)) + '</ul>';
    }
    var back = form.querySelector('[data-train-back]'), next = form.querySelector('[data-train-next]');
    if (back) { back.hidden = current === 1; back.disabled = false; }
    if (next) { next.hidden = current === TRAIN_STEPS.length; next.disabled = false; }
  }
  function initTrainingSteps(root) {
    var form = root.querySelector('[data-lana-training-form]');
    if (!form || form.dataset.stepsReady) return;
    form.dataset.stepsReady = 'true';
    form.querySelectorAll('fieldset').forEach(function (fieldset) {
      var legend = fieldset.querySelector('legend'), key = legend && TRAIN_FIELD_STEP[legend.textContent.trim()];
      if (key) fieldset.dataset.trainStep = String(key);
    });
    var guard = form.querySelector('.connections-context-guard'); if (guard) guard.dataset.trainStep = '5';
    var validation = form.querySelector('[data-training-validation]'); if (validation) validation.dataset.trainStep = '6';
    var review = node('div', 'connections-train-review'); review.dataset.trainReview = 'true'; review.dataset.trainStep = '6';
    if (validation) validation.before(review); else form.append(review);
    var nav = node('ol', 'connections-train-steps'); nav.dataset.trainSteps = 'true'; nav.setAttribute('aria-label', 'Etapas de la capacitación');
    TRAIN_STEPS.forEach(function (step) {
      var item = node('li'), button = node('button'); button.type = 'button'; button.dataset.trainGo = String(step.key);
      button.append(node('b', '', String(step.key)), node('span', '', step.title)); item.append(button); nav.append(item);
    });
    var intro = node('div', 'connections-train-intro'); intro.dataset.trainIntro = 'true'; intro.setAttribute('aria-live', 'polite');
    form.before(nav, intro);
    var actions = form.querySelector('.connections-training-actions');
    var back = node('button', 'btn btn-secondary', '← Atrás'); back.type = 'button'; back.dataset.trainBack = 'true'; back.dataset.trainNav = 'true';
    var next = node('button', 'btn btn-primary', 'Continuar →'); next.type = 'button'; next.dataset.trainNext = 'true'; next.dataset.trainNav = 'true';
    if (actions) { actions.prepend(back); actions.querySelector('[data-save-training]').after(next); }
    root.addEventListener('click', function (event) {
      var go = event.target.closest && event.target.closest('[data-train-go]');
      if (go) { goTrainingStep(go.dataset.trainGo); return; }
      if (event.target.closest && event.target.closest('[data-train-back]')) goTrainingStep((state.trainStep || 1) - 1);
      else if (event.target.closest && event.target.closest('[data-train-next]')) goTrainingStep((state.trainStep || 1) + 1);
    });
    form.addEventListener('input', function () { updateTrainingSteps(); syncBranchTools(); });
    state.trainStep = 1;
    updateTrainingSteps();
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
    syncBranchTools();
    form.querySelectorAll('[data-train-nav]').forEach(function (control) { control.disabled = false; });
    updateTrainingSteps();
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
    state.editSeq = (state.editSeq || 0) + 1;
    scheduleTrainingAutosave();
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
    var seq = state.editSeq || 0;
    state.savingDraft = true;
    var button = document.querySelector('[data-save-training]');
    if (button) button.disabled = true;
    contextStatus('Guardando borrador…', '');
    try {
      var training = trainingFromForm();
      var data = await trainingRequest('PUT', 'draft', { training: training, expected_revision: state.draftRevision });
      state.training = data.draft || training; state.draftRevision = Number(data.draft_revision); state.dirty = (state.editSeq || 0) !== seq; renderValidation(null); resetPreview(); renderTrainingMeta();
      if (showSuccess !== false) contextStatus('Borrador guardado. Todavía no cambia las respuestas a pacientes.', 'success');
      return state.training;
    } catch (error) {
      contextStatus(error.message, 'error');
      throw error;
    } finally {
      state.savingDraft = false;
      if (button) button.disabled = !state.status || !state.status.connected || !state.status.can_manage;
      if (state.dirty) scheduleTrainingAutosave();
    }
  }

  // Guardado automático: unos segundos después de dejar de escribir (y al cambiar de etapa) se guarda el borrador, nunca la publicación.
  var AUTOSAVE_MS = 4000;
  function canAutosaveTraining() { return Boolean(state.status && state.status.connected && state.status.can_manage && state.trainingLoaded); }
  function scheduleTrainingAutosave(immediate) {
    if (!canAutosaveTraining()) return;
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(runTrainingAutosave, immediate ? 200 : AUTOSAVE_MS);
  }
  async function runTrainingAutosave() {
    if (!state.dirty || state.savingDraft || state.autosaveFailed || !canAutosaveTraining()) return;
    try {
      await saveTrainingDraft(false);
      var now = new Date(), hh = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      if (!state.dirty) contextStatus('Guardado automáticamente a las ' + hh + '. Todavía no cambia las respuestas a pacientes.', 'success');
    } catch (_) {
      state.autosaveFailed = true;
      contextStatus('No se pudo guardar automáticamente. Usa «Guardar borrador» para reintentar.', 'error');
    }
  }
  function initTrainingAutosave() {
    window.addEventListener('beforeunload', function (event) {
      if (!state.dirty || !canAutosaveTraining()) return;
      event.preventDefault(); event.returnValue = '';
    });
  }

  async function saveTraining(event) {
    event.preventDefault();
    state.autosaveFailed = false;
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
      var pending = trainingPlaceholders(document.querySelector('[data-lana-training-form]'));
      if (pending.length && !window.confirm('Todavía hay textos de ejemplo con [corchetes] sin completar. El asistente podría repetirlos a los pacientes. ¿Publicar de todas formas?')) return;
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

  async function reconcileConnectionStatus() {
    setMessage('La operación tardó, estamos comprobando el estado real…', '');
    try {
      var status = await request('status');
      renderStatus(status);
      return status;
    } catch (_) {
      return null;
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
      if (error.isTimeout) {
        var reconciled = await reconcileConnectionStatus();
        if (reconciled && reconciled.connected) {
          setMessage('La mensajería sí quedó activa. Ya puedes conectar los canales de la clínica.', 'success');
          return;
        }
      }
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
      if (error.isTimeout) {
        var reconciled = await reconcileConnectionStatus();
        if (reconciled && reconciled.connected) {
          setMessage('Conexión verificada.', 'success');
          return;
        }
      }
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
    bindBranchTools(page);
    initTrainingSteps(page);
    initTrainingExamples(page);
    initTrainingAutosave();
    loadClinicBranches();
    page.querySelector('[data-lana-form]').addEventListener('submit', connect);
    page.querySelector('[data-provision-lana]').addEventListener('click', provision);
    page.querySelector('[data-retry-channels]').addEventListener('click', loadChannels);
    page.querySelectorAll('[data-connect-channel]').forEach(function (button) { button.addEventListener('click', channelAction); });
    page.querySelector('[data-disconnect-cancel]').addEventListener('click', function () { page.querySelector('[data-disconnect-dialog]').close(); });
    page.querySelector('[data-disconnect-confirm]').addEventListener('click', confirmDisconnect);
    page.querySelector('[data-unlink-lana]').addEventListener('click', openUnlinkDialog);
    page.querySelector('[data-unlink-cancel]').addEventListener('click', function () { page.querySelector('[data-unlink-dialog]').close(); });
    page.querySelector('[data-unlink-confirm]').addEventListener('click', confirmUnlink);
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
