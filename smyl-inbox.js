(function () {
  'use strict';

  var state = {
    conversations: [], total: 0, offset: 0, limit: 30, hasMore: false,
    filter: 'all', channel: '', search: '', selectedId: null, filterPanelOpen: false,
    messages: {}, pages: {}, pending: {}, loadingList: false, loadingThread: false,
    listError: '', threadError: '', syncedAt: null, actor: null, team: [], stages: [],
    threadController: null, contextOpen: false, contextSections: {}, polling: false,
    replyTo: null, attachment: null, clinical: {}, clinicalLoading: {},
    copilot: {}, copilotLoading: {},
    templates: [], templatesLoaded: false, templatesLoading: false,
    scheduled: {}, scheduledLoading: {},
    operations: null, operationsLoading: false, operationsError: '', pilotLoading: false,
    quickReplies: [], quickRepliesLoaded: false, quickRepliesLoading: false,
    bulkMode: false, bulkSelected: new Set(), bulkRunning: false,
    threadSearchResults: [], threadSearchPage: null, threadSearchLoading: false,
    sharedItems: [], sharedPage: null, sharedLoading: false,
    notificationsEnabled: false, didAutoOpen: false,
    draftSaveTimer: null, draftStatus: '',
    recorder: null, recorderStream: null, recorderChunks: [], recorderStartedAt: 0, recorderTimer: null, recordingCancelled: false,
    availabilityCatalog: null, availabilityLoading: false, availabilitySlots: [], availabilityRequests: [], availabilitySelected: [], availabilityAction: '', appointmentContext: {}, appointmentContextLoading: {},
  };

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function hasPermission(permission) {
    if (!state.actor) return false;
    return state.actor.role === 'owner' || Array.isArray(state.actor.permissions) && state.actor.permissions.indexOf(permission) !== -1;
  }

  function canOperate(conversation, permission) {
    return Boolean(conversation && conversation.can_operate && hasPermission(permission));
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (value) {
      var random = Math.random() * 16 | 0;
      return (value === 'x' ? random : (random & 3 | 8)).toString(16);
    });
  }

  async function token() {
    var result = await sb.auth.getSession();
    var value = result && result.data && result.data.session && result.data.session.access_token;
    if (!value) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    return value;
  }

  var DRAFT_STORE = 'smyl:inbox:encrypted-drafts:v1';

  function draftEnvelope() {
    try { return JSON.parse(window.sessionStorage.getItem(DRAFT_STORE) || '{}') || {}; }
    catch (_) { return {}; }
  }

  function base64Bytes(bytes) {
    var value = ''; bytes.forEach(function (byte) { value += String.fromCharCode(byte); }); return btoa(value);
  }

  function bytesFromBase64(value) {
    var raw = atob(value); var bytes = new Uint8Array(raw.length);
    for (var index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes;
  }

  async function draftKey() {
    var material = new TextEncoder().encode('SMYL inbox draft v1|' + await token());
    var hash = await window.crypto.subtle.digest('SHA-256', material);
    return window.crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  function renderDraftStatus(value) {
    state.draftStatus = value || '';
    var label = document.querySelector('[data-draft-status]');
    if (label) label.textContent = state.draftStatus ? '· ' + state.draftStatus : '';
  }

  async function persistEncryptedDraft(conversationId, content) {
    if (!conversationId || !window.crypto || !window.crypto.subtle) return;
    var envelope = draftEnvelope();
    if (!content) {
      delete envelope[conversationId]; window.sessionStorage.setItem(DRAFT_STORE, JSON.stringify(envelope)); renderDraftStatus('Sin borrador'); return;
    }
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var payload = JSON.stringify({ conversation_id: conversationId, content: content.slice(0, 4000), expires_at: Date.now() + 7 * 86400000 });
    var ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, await draftKey(), new TextEncoder().encode(payload));
    envelope[conversationId] = { iv: base64Bytes(iv), ciphertext: base64Bytes(new Uint8Array(ciphertext)) };
    window.sessionStorage.setItem(DRAFT_STORE, JSON.stringify(envelope));
    if (state.selectedId === conversationId) renderDraftStatus('Borrador protegido');
  }

  function scheduleDraftSave(value) {
    var conversationId = state.selectedId; if (!conversationId) return;
    clearTimeout(state.draftSaveTimer); renderDraftStatus(value.trim() ? 'Guardando borrador…' : 'Limpiando borrador…');
    state.draftSaveTimer = setTimeout(function () {
      persistEncryptedDraft(conversationId, value.trim()).catch(function () { if (state.selectedId === conversationId) renderDraftStatus('No se pudo proteger'); });
    }, 450);
  }

  async function restoreEncryptedDraft(conversationId) {
    var input = document.querySelector('[name="message"]'); if (!input) return;
    input.value = ''; renderDraftStatus('');
    var envelope = draftEnvelope(); var stored = envelope[conversationId]; if (!stored) return;
    try {
      var plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesFromBase64(stored.iv) }, await draftKey(), bytesFromBase64(stored.ciphertext));
      var draft = JSON.parse(new TextDecoder().decode(plain));
      if (draft.conversation_id !== conversationId || Number(draft.expires_at) < Date.now()) throw new Error('expired');
      if (state.selectedId === conversationId) { input.value = String(draft.content || '').slice(0, 4000); renderDraftStatus(input.value ? 'Borrador recuperado' : ''); }
    } catch (_) {
      delete envelope[conversationId]; window.sessionStorage.setItem(DRAFT_STORE, JSON.stringify(envelope));
    }
  }

  function clearEncryptedDraft(conversationId) {
    clearTimeout(state.draftSaveTimer); state.draftSaveTimer = null;
    return persistEncryptedDraft(conversationId, '').catch(function () {});
  }

  function setComposerText(value) {
    var input = document.querySelector('[name="message"]'); if (!input) return;
    input.value = String(value || '').slice(0, 4000); scheduleDraftSave(input.value); input.focus();
  }

  async function request(method, query, payload, key, timeoutMs, requestController) {
    var params = new URLSearchParams(query || {});
    var controller = requestController || new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 20000);
    try {
      var headers = { 'Authorization': 'Bearer ' + await token(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' };
      if (key) headers['Idempotency-Key'] = key;
      var response = await fetch(SUPA_URL + '/functions/v1/lana-inbox' + (params.size ? '?' + params : ''), {
        method: method,
        headers: headers,
        body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
        signal: controller.signal,
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(typeof data.error === 'string' ? data.error : 'No se pudo completar la operación.');
        error.code = data.code || '';
        error.retryable = Boolean(data.retryable);
        throw error;
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('El servicio de mensajes tardó demasiado en responder. Intenta nuevamente.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestForm(form, key, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 60000);
    try {
      var headers = { 'Authorization': 'Bearer ' + await token(), 'apikey': SUPA_KEY, 'Idempotency-Key': key };
      var response = await fetch(SUPA_URL + '/functions/v1/lana-inbox', { method: 'POST', headers: headers, body: form, signal: controller.signal });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(typeof data.error === 'string' ? data.error : 'No se pudo enviar el adjunto.');
        error.code = data.code || ''; error.retryable = Boolean(data.retryable); throw error;
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('El adjunto tardó demasiado en enviarse. Intenta nuevamente.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function channelLabel(channel) {
    return channel === 'whatsapp' ? 'WhatsApp' : channel === 'instagram' ? 'Instagram' : channel === 'messenger' ? 'Messenger' : 'Canal';
  }

  function initials(value) {
    var parts = String(value || 'P').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (part) { return part.charAt(0).toUpperCase(); }).join('') || 'P';
  }

  function timeLabel(value) {
    var date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    var delta = Date.now() - date.getTime();
    if (delta < 60000) return 'Ahora';
    if (delta < 3600000) return Math.floor(delta / 60000) + ' min';
    if (delta < 86400000) return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    if (delta < 604800000) return date.toLocaleDateString('es-MX', { weekday: 'short' });
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }

  function scheduledStatusLabel(status) {
    return status === 'pendiente' ? 'Pendiente'
      : status === 'enviando' ? 'Enviando'
      : status === 'retrying' ? 'Reintento automático'
      : status === 'enviado' ? 'Enviado'
      : status === 'dead_letter' || status === 'fallido' ? 'Requiere revisión'
      : status === 'cancelado' ? 'Cancelado' : String(status || 'Pendiente');
  }

  function shell() {
    var page = node('section', 'pantalla smyl-inbox-page');
    page.id = 'p-inbox';
    page.innerHTML =
      '<header class="smyl-inbox-top">' +
        '<div><span class="smyl-inbox-eyebrow">CENTRO DE ATENCIÓN DENTAL</span><h1>Mensajes</h1><p>Prioriza pacientes y continúa su caso; SMYL Asistente y tu equipo responden por WhatsApp, Messenger o Instagram.</p></div>' +
        '<div class="smyl-inbox-top-actions"><button type="button" class="smyl-inbox-notify" data-inbox-notify aria-pressed="false">Avisos</button><button type="button" class="smyl-inbox-health" data-inbox-operations data-state="loading"><i></i><span>Revisando operación</span></button><div class="smyl-inbox-live" data-inbox-live><i></i><span>Sincronización segura</span></div></div>' +
        '<div class="smyl-inbox-overview" data-inbox-overview aria-label="Resumen de atención"></div>' +
      '</header>' +
      '<div class="smyl-inbox-workspace">' +
        '<aside class="smyl-inbox-list-pane" aria-label="Bandeja de conversaciones">' +
          '<div class="smyl-inbox-list-head"><div class="smyl-inbox-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input type="search" placeholder="Buscar paciente" aria-label="Buscar conversación" data-inbox-search></div><button type="button" class="smyl-inbox-filter-toggle" data-inbox-filter-more aria-expanded="false">Filtros</button></div>' +
          '<div class="smyl-inbox-filters" role="tablist" aria-label="Filtrar conversaciones">' +
            '<button type="button" data-inbox-filter="all" class="active">Todas</button><button type="button" data-inbox-filter="attention">Por atender</button><button type="button" data-inbox-filter="mine">Mías</button>' +
          '</div>' +
          '<div class="smyl-inbox-filter-panel" data-inbox-filter-panel hidden><span class="smyl-inbox-filter-label">Mostrar</span><div class="smyl-inbox-secondary-filters"><button type="button" data-inbox-filter="unread">Sin leer</button><button type="button" data-inbox-filter="paused">En atención</button><button type="button" data-inbox-filter="pinned">Fijadas</button></div><label>Canal<select data-inbox-channel aria-label="Filtrar por canal"><option value="">Todos</option><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option></select></label><div class="smyl-inbox-list-tools"><button type="button" data-inbox-bulk aria-pressed="false">Seleccionar varias</button><button type="button" data-inbox-refresh aria-label="Actualizar bandeja">Actualizar ahora</button></div></div>' +
          '<div class="smyl-inbox-queue-summary" data-inbox-queue-summary aria-live="polite"></div>' +
          '<div class="smyl-inbox-list" data-inbox-list></div>' +
          '<div class="smyl-inbox-bulkbar" data-inbox-bulkbar hidden></div>' +
          '<button type="button" class="smyl-inbox-more" data-inbox-more hidden>Cargar más conversaciones</button>' +
        '</aside>' +
        '<main class="smyl-inbox-thread-pane" data-inbox-thread-pane>' +
          '<div class="smyl-inbox-thread-empty" data-inbox-thread-empty><div class="smyl-inbox-empty-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg></div><span class="smyl-inbox-eyebrow">CENTRO DE ATENCIÓN</span><h2>Continúa el siguiente caso</h2><p>Abre una conversación para responder, consultar el expediente y coordinar la cita sin cambiar de pantalla.</p><div class="smyl-inbox-empty-steps"><span><b>1</b>Revisa el motivo</span><span><b>2</b>Consulta agenda</span><span><b>3</b>Confirma el seguimiento</span></div><button type="button" class="btn btn-primary" data-inbox-open-next>Abrir siguiente conversación</button></div>' +
          '<div class="smyl-inbox-thread" data-inbox-thread hidden>' +
            '<header class="smyl-inbox-thread-head"><button type="button" class="smyl-inbox-back" data-inbox-back aria-label="Volver a la bandeja"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"></path></svg></button><button type="button" class="smyl-inbox-patient-summary" data-inbox-context aria-label="Abrir paciente y atención"><div class="smyl-inbox-avatar" data-thread-avatar></div><div class="smyl-inbox-thread-person"><strong data-thread-name></strong><span data-thread-meta></span></div></button><span class="smyl-inbox-thread-state" data-thread-state></span><button type="button" class="smyl-inbox-mode-button" data-thread-mode></button><div class="smyl-inbox-thread-menu-wrap"><button type="button" class="smyl-inbox-thread-more" data-thread-more aria-expanded="false" aria-label="Más acciones de la conversación">•••</button><div class="smyl-inbox-thread-menu" data-thread-menu hidden><button type="button" data-thread-search>Buscar en el hilo</button><button type="button" data-thread-shared>Archivos compartidos</button><button type="button" data-thread-pin>Fijar conversación</button><button type="button" data-thread-details>Paciente y atención</button></div></div></header><nav class="smyl-inbox-carebar" data-thread-carebar aria-label="Acciones del paciente"></nav>' +
            '<div class="smyl-inbox-thread-body" data-thread-body><button type="button" class="smyl-inbox-older" data-thread-older hidden>Cargar mensajes anteriores</button><div data-thread-messages></div></div>' +
            '<button type="button" class="smyl-inbox-jump" data-thread-jump hidden>Ir al final</button>' +
            '<section class="smyl-inbox-copilot-draft" data-copilot-draft hidden></section>' +
            '<form class="smyl-inbox-composer" data-inbox-composer><label for="smyl-inbox-message">Responder como equipo <span data-draft-status></span></label><div class="smyl-inbox-window" data-wa-window hidden></div><div class="smyl-inbox-compose-context" data-compose-context hidden></div><div class="smyl-inbox-compose-main"><div class="smyl-inbox-message-row"><button type="button" class="smyl-inbox-compose-more" data-compose-more aria-expanded="false" aria-label="Abrir herramientas de respuesta">+</button><textarea id="smyl-inbox-message" name="message" rows="2" maxlength="4000" placeholder="Escribe una respuesta…"></textarea><button type="button" class="smyl-inbox-compose-copilot" data-compose-copilot aria-label="Sugerir con Copilot">Sugerir</button><button type="submit" class="btn btn-primary" data-compose-send>Enviar</button></div><div class="smyl-inbox-compose-tools" data-compose-tools aria-label="Herramientas de respuesta" hidden><button type="button" data-compose-attach>Adjuntar</button><button type="button" data-compose-quick>Respuesta rápida</button><button type="button" data-compose-template>Plantilla</button><button type="button" data-compose-schedule>Programar</button><button type="button" data-compose-record aria-pressed="false">Nota de voz</button><button type="button" data-compose-location>Ubicación</button><button type="button" data-compose-emoji>Emoji</button><input type="file" data-compose-file accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.doc,.docx,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg" hidden></div></div><small>El borrador se cifra para esta sesión; el equipo siempre revisa y decide el envío.</small></form>' +
          '</div>' +
        '</main>' +
        '<button type="button" class="smyl-inbox-context-scrim" data-context-close aria-label="Cerrar control de atención"></button>' +
        '<aside class="smyl-inbox-context" data-inbox-context-panel aria-label="Control de atención"><div data-inbox-context-content></div></aside>' +
        '<dialog class="smyl-inbox-forward-dialog" data-inbox-forward><form method="dialog"><span class="smyl-inbox-eyebrow">REENVIAR MENSAJE</span><h2>Elige una conversación</h2><p>El contenido se enviará de nuevo por el canal del destinatario.</p><select data-forward-target aria-label="Conversación de destino"></select><div><button value="cancel" class="btn btn-secondary">Cancelar</button><button value="confirm" class="btn btn-primary" data-forward-confirm>Reenviar</button></div></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog" data-copilot-resume><form><span class="smyl-inbox-eyebrow">REANUDAR CON CONTEXTO</span><h2>Revisa lo que recibirá el asistente</h2><p>Copilot resume el episodio humano. Corrige cualquier inferencia antes de reactivar la atención automática.</p><textarea data-resume-summary maxlength="2000" rows="7" aria-label="Resumen para reanudar"></textarea><div class="smyl-inbox-copilot-notes" data-resume-notes></div><footer><button type="button" class="btn btn-secondary" data-resume-cancel>Cancelar</button><button type="submit" class="btn btn-primary" data-resume-confirm>Reanudar asistente</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog" data-copilot-feedback><form><span class="smyl-inbox-eyebrow">CALIDAD DE IA</span><h2>Evalúa esta respuesta</h2><p>Tu comentario queda para revisión; no modifica ni publica la capacitación automáticamente.</p><label>Resultado<select data-feedback-rating required><option value="helpful">Útil</option><option value="needs_improvement">Necesita mejora</option><option value="unsafe">Insegura o fuera de límites</option></select></label><label>¿Qué mejorarías?<textarea data-feedback-comment maxlength="1000" rows="3"></textarea></label><label>Respuesta ideal · opcional<textarea data-feedback-ideal maxlength="4000" rows="4"></textarea></label><footer><button type="button" class="btn btn-secondary" data-feedback-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Guardar evaluación</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog smyl-inbox-template-dialog" data-template-dialog><form><span class="smyl-inbox-eyebrow">WHATSAPP · PLANTILLA APROBADA</span><h2>Volver a contactar</h2><p>Meta permite estas plantillas incluso cuando la ventana de 24 horas ya venció.</p><label>Plantilla<select data-template-select required></select></label><div class="smyl-inbox-template-preview" data-template-preview></div><div data-template-variables></div><footer><button type="button" class="btn btn-secondary" data-template-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Enviar plantilla</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog smyl-inbox-schedule-dialog" data-schedule-dialog><form><span class="smyl-inbox-eyebrow">WHATSAPP · ENVÍO PROGRAMADO</span><h2>Programar seguimiento</h2><p>El envío se procesa una sola vez. Si el texto libre quedaría fuera de la ventana, usa una plantilla aprobada.</p><label>Fecha y hora<input type="datetime-local" data-schedule-at required></label><label>Tipo<select data-schedule-type><option value="text">Texto libre</option><option value="template">Plantilla aprobada</option></select></label><label data-schedule-text-wrap>Mensaje<textarea data-schedule-text maxlength="4000" rows="4"></textarea></label><div data-schedule-template-wrap hidden><label>Plantilla<select data-schedule-template></select></label><div class="smyl-inbox-template-preview" data-schedule-preview></div><div data-schedule-variables></div></div><footer><button type="button" class="btn btn-secondary" data-schedule-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Programar</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog smyl-inbox-availability-dialog" data-availability-dialog><header><div><span class="smyl-inbox-eyebrow">AGENDA · CONSULTA EN TIEMPO REAL</span><h2>Buscar espacios disponibles</h2><p>Consulta horarios reales. Ninguna opción queda apartada hasta que la clínica confirme una cita.</p></div><button type="button" data-availability-close>Cerrar</button></header><form data-availability-form><label>Servicio<select data-availability-service required></select></label><label>Sucursal<select data-availability-branch><option value="">Cualquier sucursal</option></select></label><label>Profesional<select data-availability-professional><option value="">Cualquier profesional</option></select></label><label>Desde<input type="date" data-availability-from required></label><label>Hasta<input type="date" data-availability-to required></label><button class="btn btn-primary" type="submit">Buscar horarios</button></form><div class="smyl-inbox-availability-note">Selecciona hasta 3 alternativas para compartirlas. Los espacios pueden cambiar y SMYL vuelve a validar al confirmar.</div><div data-availability-results></div><footer class="smyl-inbox-availability-offer"><span data-availability-selection>0 de 3 opciones</span><button type="button" class="btn btn-primary" data-availability-prepare disabled>Preparar opciones para el paciente</button></footer></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog" data-quick-dialog><header><div><span class="smyl-inbox-eyebrow">ATAJOS DEL EQUIPO</span><h2>Respuestas rápidas</h2><p>Inserta un texto revisable; nunca se envía automáticamente.</p></div><button type="button" data-quick-close>Cerrar</button></header><div data-quick-content></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog smyl-inbox-emoji-dialog" data-emoji-dialog><header><div><span class="smyl-inbox-eyebrow">COMPOSITOR</span><h2>Agregar emoji</h2><p>Elige un símbolo y continúa editando antes de enviar.</p></div><button type="button" data-emoji-close>Cerrar</button></header><div data-emoji-content></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog" data-search-dialog><header><div><span class="smyl-inbox-eyebrow">HISTORIAL CANÓNICO</span><h2>Buscar dentro del hilo</h2><p>La búsqueda se realiza en LANA, incluso sobre mensajes no cargados.</p></div><button type="button" data-search-close>Cerrar</button></header><form data-thread-search-form><input type="search" data-thread-search-input minlength="2" maxlength="160" placeholder="Ej. valoración, cita o presupuesto" required><button class="btn btn-primary" type="submit">Buscar</button></form><div data-search-results></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog" data-shared-dialog><header><div><span class="smyl-inbox-eyebrow">BIBLIOTECA DEL HILO</span><h2>Archivos y enlaces compartidos</h2><p>Contenido del historial real de esta conversación.</p></div><button type="button" data-shared-close>Cerrar</button></header><div data-shared-content></div></dialog>' +
        '<dialog class="smyl-inbox-operations-dialog" data-operations-dialog><header><div><span class="smyl-inbox-eyebrow">OPERACIÓN Y PILOTO</span><h2>Estado del Inbox</h2><p>Métricas del tenant, consumo y bloqueos que deben resolverse antes del piloto.</p></div><button type="button" data-operations-close aria-label="Cerrar estado operativo">Cerrar</button></header><div data-operations-content></div><footer><span>La activación del piloto siempre es manual.</span><div><button type="button" class="btn btn-secondary" data-pilot-report disabled>Ver informe</button><button type="button" class="btn btn-secondary" data-operations-refresh>Actualizar estado</button></div></footer></dialog>' +
        '<dialog class="smyl-inbox-report-dialog" data-pilot-report-dialog><header><div><span class="smyl-inbox-eyebrow">INFORME OPERATIVO</span><h2>Resultado del piloto</h2><p>Resumen para dirección y soporte, sin conversaciones ni datos clínicos.</p></div><button type="button" data-pilot-report-close aria-label="Cerrar informe del piloto">Cerrar</button></header><div data-pilot-report-content></div><footer><span>Revisa la evidencia antes de compartir este documento.</span><div><button type="button" class="btn btn-secondary" data-pilot-report-back>Volver al estado</button><button type="button" class="btn btn-primary" data-pilot-report-print>Imprimir o guardar PDF</button></div></footer></dialog>' +
      '</div>';
    return page;
  }

  function mergeConversations(items, replace) {
    var map = new Map((replace ? [] : state.conversations).map(function (item) { return [item.id, item]; }));
    (items || []).forEach(function (item) { map.set(item.id, Object.assign({}, map.get(item.id) || {}, item)); });
    state.conversations = Array.from(map.values()).sort(function (a, b) {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (Boolean(a.needs_human) !== Boolean(b.needs_human)) return a.needs_human ? -1 : 1;
      if (Boolean(a.unread_count) !== Boolean(b.unread_count)) return a.unread_count ? -1 : 1;
      var mineA = Boolean(a.assignment && state.actor && a.assignment.actor_id === state.actor.id);
      var mineB = Boolean(b.assignment && state.actor && b.assignment.actor_id === state.actor.id);
      if (mineA !== mineB) return mineA ? -1 : 1;
      return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
    });
  }

  function visibleConversations() {
    var query = state.search.toLocaleLowerCase('es-MX').trim();
    return state.conversations.filter(function (item) {
      if (state.channel && item.channel !== state.channel) return false;
      if (state.filter === 'unread' && !item.unread_count) return false;
      if (state.filter === 'attention' && !item.needs_human) return false;
      if (state.filter === 'mine' && (!item.assignment || item.assignment.actor_id !== (state.actor && state.actor.id))) return false;
      if (state.filter === 'pinned' && !item.pinned) return false;
      if (state.filter === 'paused' && !item.paused) return false;
      if (query && !(item.contact_name + ' ' + item.last_message).toLocaleLowerCase('es-MX').includes(query)) return false;
      return true;
    });
  }

  function stageName(stageId) {
    var stage = state.stages.find(function (item) { return item.id === stageId; });
    return stage ? stage.name : 'Sin etapa';
  }

  function renderBulkBar() {
    var bar = document.querySelector('[data-inbox-bulkbar]');
    var toggle = document.querySelector('[data-inbox-bulk]');
    if (!bar || !toggle) return;
    toggle.hidden = !hasPermission('messages.manage');
    if (!hasPermission('messages.manage')) { state.bulkMode = false; state.bulkSelected.clear(); }
    toggle.setAttribute('aria-pressed', state.bulkMode ? 'true' : 'false');
    toggle.textContent = state.bulkMode ? 'Cancelar' : 'Seleccionar';
    bar.hidden = !state.bulkMode;
    if (!state.bulkMode) { bar.innerHTML = ''; return; }
    bar.innerHTML = '';
    var count = node('strong', '', state.bulkSelected.size + ' seleccionadas');
    var assignee = document.createElement('select'); assignee.setAttribute('aria-label', 'Responsable para seleccionadas');
    assignee.append(new Option('Responsable…', ''));
    state.team.forEach(function (member) { assignee.append(new Option(member.name, member.id)); });
    var stage = document.createElement('select'); stage.setAttribute('aria-label', 'Etapa para seleccionadas');
    stage.append(new Option('Etapa…', '')); state.stages.filter(function (item) { return !item.archived; }).forEach(function (item) { stage.append(new Option(item.name, item.id)); });
    var assign = node('button', 'btn btn-secondary btn-sm', 'Asignar'); assign.type = 'button';
    assign.disabled = !state.bulkSelected.size || state.bulkRunning; assign.onclick = function () { if (assignee.value) applyBulkAction('assign', assignee.value); };
    var move = node('button', 'btn btn-secondary btn-sm', 'Mover'); move.type = 'button';
    move.disabled = !state.bulkSelected.size || state.bulkRunning; move.onclick = function () { if (stage.value) applyBulkAction('stage', stage.value); };
    var clear = node('button', 'smyl-inbox-bulk-clear', 'Limpiar'); clear.type = 'button'; clear.onclick = function () { state.bulkSelected.clear(); renderList(); };
    bar.append(count, assignee, assign, stage, move, clear);
  }

  function renderInboxOverview() {
    var host = document.querySelector('[data-inbox-overview]');
    if (!host) return;
    var items = state.conversations || [];
    var attention = items.filter(function (item) { return item.needs_human; }).length;
    var unread = items.reduce(function (total, item) { return total + (Number(item.unread_count) || 0); }, 0);
    var active = items.filter(function (item) { return item.paused; }).length;
    host.innerHTML = '';
    [['Por atender', attention, 'Requieren respuesta'], ['Sin leer', unread, 'Mensajes nuevos'], ['En atención', active, 'Con el equipo']].forEach(function (metric) {
      var card = node('span', 'smyl-inbox-overview-card');
      card.append(node('small', '', metric[0]), node('strong', '', String(metric[1])), node('em', '', metric[2]));
      host.append(card);
    });
  }

  function filterCount(filter) {
    return state.conversations.filter(function (item) {
      if (filter === 'attention') return item.needs_human;
      if (filter === 'mine') return item.assignment && item.assignment.actor_id === (state.actor && state.actor.id);
      if (filter === 'unread') return item.unread_count;
      if (filter === 'paused') return item.paused;
      if (filter === 'pinned') return item.pinned;
      return true;
    }).length;
  }

  function renderFilterControls() {
    var advanced = ['unread', 'paused', 'pinned'].indexOf(state.filter) !== -1 || Boolean(state.channel);
    document.querySelectorAll('[data-inbox-filter]').forEach(function (button) {
      var filter = button.dataset.inboxFilter;
      var labels = { all: 'Todas', attention: 'Por atender', mine: 'Mías', unread: 'Sin leer', paused: 'En atención', pinned: 'Fijadas' };
      button.classList.toggle('active', filter === state.filter);
      button.innerHTML = '<span>' + labels[filter] + '</span><b>' + filterCount(filter) + '</b>';
    });
    var toggle = document.querySelector('[data-inbox-filter-more]');
    var panel = document.querySelector('[data-inbox-filter-panel]');
    if (toggle) {
      toggle.setAttribute('aria-expanded', state.filterPanelOpen ? 'true' : 'false');
      toggle.dataset.active = advanced ? 'true' : 'false';
      toggle.textContent = advanced ? 'Filtros · activos' : 'Filtros';
    }
    if (panel) panel.hidden = !state.filterPanelOpen;
  }

  function toggleInboxFilters() {
    state.filterPanelOpen = !state.filterPanelOpen;
    renderFilterControls();
  }

  function renderList() {
    var list = document.querySelector('[data-inbox-list]');
    var more = document.querySelector('[data-inbox-more]');
    var summary = document.querySelector('[data-inbox-queue-summary]');
    if (!list) return;
    renderBulkBar(); renderInboxOverview(); renderFilterControls();
    list.innerHTML = '';
    if (state.loadingList && !state.conversations.length) {
      list.innerHTML = '<div class="smyl-inbox-loading"><i></i><i></i><i></i></div>';
      return;
    }
    if (state.listError && !state.conversations.length) {
      var error = node('div', 'smyl-inbox-list-state');
      error.append(node('strong', '', 'No pudimos abrir el Inbox'), node('p', '', state.listError));
      var retry = node('button', 'btn btn-secondary btn-sm', 'Intentar de nuevo'); retry.type = 'button'; retry.onclick = function () { loadList(true); };
      error.append(retry); list.append(error); return;
    }
    var visible = visibleConversations();
    if (summary) {
      var attention = visible.filter(function (item) { return item.needs_human; }).length;
      var unread = visible.reduce(function (total, item) { return total + (Number(item.unread_count) || 0); }, 0);
      summary.dataset.state = attention ? 'attention' : unread ? 'unread' : 'clear';
      summary.textContent = attention
        ? attention + (attention === 1 ? ' conversación requiere' : ' conversaciones requieren') + ' al equipo ahora'
        : unread ? unread + (unread === 1 ? ' mensaje nuevo por revisar' : ' mensajes nuevos por revisar')
        : visible.length ? 'Esta bandeja está al día' : 'Sin conversaciones en este filtro';
    }
    if (!visible.length) {
      var empty = node('div', 'smyl-inbox-list-state');
      empty.append(node('strong', '', 'No hay conversaciones aquí'), node('p', '', 'Prueba otro filtro o espera un mensaje nuevo de tus canales.'));
      list.append(empty);
    }
    visible.forEach(function (item) {
      var isBulkSelected = state.bulkSelected.has(item.id);
      var button = node('button', 'smyl-inbox-row' + (state.selectedId === item.id ? ' active' : '') + (isBulkSelected ? ' is-selected' : '') + (state.bulkMode ? ' is-bulk' : ''));
      button.type = 'button'; button.dataset.conversationId = item.id;
      button.dataset.priority = item.needs_human ? 'human' : item.unread_count ? 'unread' : 'normal';
      if (state.selectedId === item.id) button.setAttribute('aria-current', 'true');
      var avatar = node('span', 'smyl-inbox-avatar', initials(item.contact_name)); avatar.dataset.channel = item.channel;
      if (state.bulkMode) avatar.textContent = isBulkSelected ? '✓' : '';
      var copy = node('span', 'smyl-inbox-row-copy');
      var top = node('span', 'smyl-inbox-row-top');
      var identity = node('span', 'smyl-inbox-row-identity');
      if (item.pinned) identity.append(node('span', 'smyl-inbox-pin-mark', '●'));
      identity.append(node('strong', '', item.contact_name));
      top.append(identity, node('time', '', timeLabel(item.last_message_at)));
      var preview = node('span', 'smyl-inbox-preview', item.last_message || 'Conversación sin vista previa');
      var meta = node('span', 'smyl-inbox-row-meta');
      meta.append(node('span', 'smyl-inbox-channel', channelLabel(item.channel)));
      if (item.needs_human) meta.append(node('span', 'smyl-inbox-attention', 'Por atender'));
      else if (item.paused) meta.append(node('span', 'smyl-inbox-state is-paused', 'Con el equipo'));
      else meta.append(node('span', 'smyl-inbox-state', 'IA activa'));
      if (item.assignment) meta.append(node('span', 'smyl-inbox-assignee', item.assignment.name));
      var currentStage = stageName(item.stage_id);
      copy.append(top, preview, meta);
      if (currentStage !== 'Sin etapa') copy.append(node('span', 'smyl-inbox-row-stage-line', currentStage));
      button.append(avatar, copy);
      if (item.unread_count) button.append(node('span', 'smyl-inbox-unread', String(Math.min(99, item.unread_count))));
      button.addEventListener('click', function () {
        if (state.bulkMode) {
          if (state.bulkSelected.has(item.id)) state.bulkSelected.delete(item.id); else state.bulkSelected.add(item.id);
          renderList(); return;
        }
        openConversation(item.id);
      });
      list.append(button);
    });
    if (more) { more.hidden = !state.hasMore; more.disabled = state.loadingList; more.textContent = state.loadingList ? 'Cargando…' : 'Cargar más conversaciones'; }
  }

  function selectedConversation() {
    return state.conversations.find(function (item) { return item.id === state.selectedId; }) || null;
  }

  function mergeMessages(conversationId, items, prepend) {
    var existing = state.messages[conversationId] || [];
    var map = new Map(existing.map(function (item) { return [String(item.id), item]; }));
    (items || []).forEach(function (item) {
      if (item.client_request_id) {
        (state.pending[conversationId] || []).forEach(function (pending) {
          if (pending.key === item.client_request_id) pending.reconciled = true;
        });
      }
      map.set(String(item.id), item);
    });
    state.messages[conversationId] = Array.from(map.values()).sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
    state.pending[conversationId] = (state.pending[conversationId] || []).filter(function (item) { return !item.reconciled; });
  }

  function atThreadBottom() {
    var body = document.querySelector('[data-thread-body]');
    return !body || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  }

  function scrollThreadBottom() {
    var body = document.querySelector('[data-thread-body]');
    if (body) body.scrollTop = body.scrollHeight;
    var jump = document.querySelector('[data-thread-jump]'); if (jump) jump.hidden = true;
  }

  function renderComposerContext() {
    var box = document.querySelector('[data-compose-context]');
    if (!box) return;
    box.innerHTML = '';
    var value = state.attachment || state.replyTo;
    box.hidden = !value;
    if (!value) return;
    var copy = node('div', '');
    copy.append(node('strong', '', state.attachment ? 'Adjunto listo' : 'Respondiendo a un mensaje'));
    copy.append(node('span', '', state.attachment ? (state.attachment.name + ' · ' + Math.max(1, Math.round(state.attachment.size / 1024)) + ' KB') : (state.replyTo.content || 'Adjunto').slice(0, 120)));
    if (state.attachment && attachmentKind(state.attachment) === 'audio') {
      var preview = document.createElement('audio'); preview.controls = true; preview.preload = 'metadata';
      preview.src = URL.createObjectURL(state.attachment); preview.onloadedmetadata = function () { URL.revokeObjectURL(preview.src); };
      copy.append(preview);
    }
    var clear = node('button', '', 'Quitar'); clear.type = 'button'; clear.onclick = function () { state.attachment = null; state.replyTo = null; var input = document.querySelector('[data-compose-file]'); if (input) input.value = ''; renderComposerContext(); };
    box.append(copy, clear);
  }

  function renderCopilotDraft() {
    var panel = document.querySelector('[data-copilot-draft]');
    if (!panel) return;
    panel.innerHTML = '';
    var conversationId = state.selectedId;
    var result = conversationId && state.copilot[conversationId];
    var loading = conversationId && state.copilotLoading[conversationId] === 'draft';
    panel.hidden = !loading && !(result && result.mode === 'draft');
    if (panel.hidden) return;
    var head = node('div', 'smyl-inbox-copilot-head');
    head.append(node('strong', '', 'SMYL Copilot'), node('span', '', 'Borrador interno · no enviado'));
    panel.append(head);
    if (loading) { panel.append(node('p', '', 'Revisando el hilo y la capacitación publicada…')); return; }
    if (result.requires_human) panel.append(node('p', 'is-warning', 'Copilot detectó contenido que requiere atención humana. Revisa con especial cuidado.'));
    panel.append(node('p', 'smyl-inbox-copilot-copy', result.draft || ''));
    var tools = node('div', 'smyl-inbox-copilot-tools');
    (result.tools || []).filter(function (tool) { return tool.available; }).forEach(function (tool) { tools.append(node('span', '', tool.label)); });
    if (tools.childNodes.length) panel.append(tools);
    var actions = node('div', 'smyl-inbox-copilot-actions');
    var use = node('button', 'btn btn-primary btn-sm', 'Usar como borrador'); use.type = 'button';
    use.onclick = function () { setComposerText(result.draft || ''); delete state.copilot[conversationId]; renderCopilotDraft(); };
    var discard = node('button', 'btn btn-secondary btn-sm', 'Descartar'); discard.type = 'button'; discard.onclick = function () { delete state.copilot[conversationId]; renderCopilotDraft(); };
    actions.append(discard, use); panel.append(actions);
  }

  async function requestCopilot(mode) {
    var conversation = selectedConversation();
    if (!conversation || !canOperate(conversation, 'messages.respond') || state.copilotLoading[conversation.id]) return null;
    state.copilotLoading[conversation.id] = mode; renderCopilotDraft(); renderContext();
    try {
      var data = await request('POST', {}, { action: 'copilot', conversation_id: conversation.id, mode: mode }, null, 35000);
      state.copilot[conversation.id] = data;
      return data;
    } catch (error) {
      window.alert(error.message || 'Copilot no pudo preparar una sugerencia.');
      return null;
    } finally {
      delete state.copilotLoading[conversation.id]; renderCopilotDraft(); renderContext();
    }
  }

  async function prepareResume() {
    var conversation = selectedConversation(); if (!conversation || !conversation.paused) return;
    var data = await requestCopilot('summary'); if (!data || state.selectedId !== conversation.id) return;
    var dialog = document.querySelector('[data-copilot-resume]');
    var summary = dialog.querySelector('[data-resume-summary]'); var notes = dialog.querySelector('[data-resume-notes]');
    summary.value = data.summary || ''; notes.innerHTML = '';
    if (data.next_step) notes.append(node('p', '', 'Siguiente paso sugerido: ' + data.next_step));
    if ((data.open_questions || []).length) notes.append(node('p', '', 'Pendiente por confirmar: ' + data.open_questions.join(' · ')));
    if ((data.unconfirmed_facts || []).length) notes.append(node('p', 'is-warning', 'No confirmado: ' + data.unconfirmed_facts.join(' · ')));
    dialog.dataset.conversationId = conversation.id; dialog.showModal(); summary.focus();
  }

  async function confirmResume(event) {
    event.preventDefault();
    var dialog = document.querySelector('[data-copilot-resume]'); var conversation = selectedConversation();
    if (!conversation || dialog.dataset.conversationId !== conversation.id) { dialog.close(); return; }
    var summary = dialog.querySelector('[data-resume-summary]').value.trim();
    if (!summary) { window.alert('Revisa y conserva un resumen antes de reanudar.'); return; }
    var submit = dialog.querySelector('[data-resume-confirm]'); submit.disabled = true;
    try {
      var data = await request('POST', {}, { action: 'resume_with_context', conversation_id: conversation.id, summary: summary }, uuid(), 20000);
      conversation.paused = Boolean(data.paused); conversation.needs_human = Boolean(data.needs_human); delete state.copilot[conversation.id]; dialog.close(); render();
    } catch (error) { window.alert(error.message || 'No se pudo reanudar el asistente.'); }
    finally { submit.disabled = false; }
  }

  function openFeedback(item) {
    var dialog = document.querySelector('[data-copilot-feedback]');
    dialog.dataset.messageId = item.id; dialog.querySelector('[data-feedback-rating]').value = 'helpful';
    dialog.querySelector('[data-feedback-comment]').value = ''; dialog.querySelector('[data-feedback-ideal]').value = ''; dialog.showModal();
  }

  async function submitFeedback(event) {
    event.preventDefault();
    var dialog = document.querySelector('[data-copilot-feedback]'); var conversation = selectedConversation(); if (!conversation) return;
    var submit = dialog.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      await request('POST', {}, {
        action: 'feedback', conversation_id: conversation.id, message_id: dialog.dataset.messageId,
        rating: dialog.querySelector('[data-feedback-rating]').value,
        comment: dialog.querySelector('[data-feedback-comment]').value.trim(),
        ideal_response: dialog.querySelector('[data-feedback-ideal]').value.trim(),
      }, uuid(), 20000);
      dialog.close(); window.alert('Evaluación guardada para revisión. La capacitación no cambió.');
    } catch (error) { window.alert(error.message || 'No se pudo guardar la evaluación.'); }
    finally { submit.disabled = false; }
  }

  function appendMessageMedia(bubble, item) {
    if (item.deleted) { bubble.append(node('p', 'smyl-inbox-deleted', 'Mensaje eliminado del panel')); return; }
    if (item.reply_to) {
      var quote = node('div', 'smyl-inbox-quote'); quote.append(node('strong', '', 'Respuesta a'), node('span', '', item.reply_to.preview || 'Mensaje citado')); bubble.append(quote);
    }
    if (item.forwarded) bubble.append(node('span', 'smyl-inbox-forwarded', '↪ Reenviado'));
    if (item.media_type === 'image' && item.media_url) {
      var link = document.createElement('a'); link.href = item.media_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      var image = document.createElement('img'); image.src = item.media_url; image.alt = item.content || 'Fotografía del chat'; image.loading = 'lazy'; link.append(image); bubble.append(link);
    } else if (item.media_type === 'audio' && item.media_url) {
      var audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = item.media_url; bubble.append(audio);
    } else if ((item.media_type === 'document' || item.media_type === 'location') && item.media_url) {
      var attachment = document.createElement('a'); attachment.className = 'smyl-inbox-attachment'; attachment.href = item.media_url; attachment.target = '_blank'; attachment.rel = 'noopener noreferrer';
      attachment.textContent = item.media_type === 'location' ? '📍 Abrir ubicación' : '📄 ' + (item.media_filename || 'Abrir documento'); bubble.append(attachment);
    }
    if (item.content || !item.media_type) bubble.append(node('p', '', item.content || 'Mensaje sin texto'));
  }

  async function mutateMessage(item, action) {
    var conversation = selectedConversation(); if (!conversation) return;
    if (action === 'delete' && !window.confirm('Esto solo lo ocultará en el panel; no lo retira del teléfono del paciente. ¿Continuar?')) return;
    try {
      await request('POST', {}, { action: action, conversation_id: conversation.id, message_id: item.id }, uuid());
      if (action === 'star') item.starred = true;
      if (action === 'unstar') item.starred = false;
      if (action === 'delete') { item.deleted = true; item.content = ''; item.media_url = null; item.media_type = null; }
      renderMessages(false);
    } catch (error) { window.alert(error.message || 'No se pudo actualizar el mensaje.'); }
  }

  async function linkClinicalImage(item) {
    var conversation = selectedConversation(); if (!conversation) return;
    try {
      await request('POST', {}, { action: 'clinical_link', conversation_id: conversation.id, channel: conversation.channel, message_id: item.id, label: 'Fotografía recibida por chat' });
      await loadClinicalContext(conversation.id); window.alert('Fotografía enviada a revisión clínica. La IA no la analizará hasta que el equipo lo autorice.');
    } catch (error) {
      if (error.code === 'handoff_required' && window.SmylLanaHandoff) window.SmylLanaHandoff.open(conversation.id);
      else window.alert(error.message || 'No se pudo vincular la fotografía.');
    }
  }

  function openForward(item) {
    var dialog = document.querySelector('[data-inbox-forward]'); var select = dialog && dialog.querySelector('[data-forward-target]');
    if (!dialog || !select) return;
    select.innerHTML = '';
    state.conversations.filter(function (conversation) { return conversation.id !== state.selectedId && canOperate(conversation, 'messages.respond'); }).forEach(function (conversation) {
      var option = document.createElement('option'); option.value = conversation.id; option.textContent = conversation.contact_name + ' · ' + channelLabel(conversation.channel); select.append(option);
    });
    if (!select.options.length) { window.alert('No hay otra conversación disponible para reenviar.'); return; }
    dialog.dataset.sourceConversationId = state.selectedId; dialog.dataset.sourceMessageId = item.id; dialog.showModal();
  }

  async function confirmForward(event) {
    event.preventDefault();
    var dialog = document.querySelector('[data-inbox-forward]'); var select = dialog.querySelector('[data-forward-target]');
    try {
      var data = await request('POST', {}, { action: 'send', type: 'forward', conversation_id: select.value, source_conversation_id: dialog.dataset.sourceConversationId, source_message_id: dialog.dataset.sourceMessageId }, uuid(), 45000);
      dialog.close(); mergeMessages(select.value, data.message ? [data.message] : [], false); mergeConversations([{ id: select.value, last_message: data.message && data.message.content, last_message_at: new Date().toISOString(), paused: true }], false); renderList();
    } catch (error) { window.alert(error.message || 'No se pudo reenviar el mensaje.'); }
  }

  function renderMessages(keepPosition) {
    var wrap = document.querySelector('[data-thread-messages]'); var older = document.querySelector('[data-thread-older]');
    if (!wrap || !state.selectedId) return;
    var body = document.querySelector('[data-thread-body]'); var oldHeight = body.scrollHeight;
    var server = state.messages[state.selectedId] || []; var pending = (state.pending[state.selectedId] || []).filter(function (item) { return !item.reconciled; });
    var items = server.concat(pending).sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
    wrap.innerHTML = '';
    if (state.loadingThread && !items.length) wrap.innerHTML = '<div class="smyl-inbox-thread-loading"><i></i><i></i><i></i></div>';
    else if (state.threadError && !items.length) {
      var error = node('div', 'smyl-inbox-thread-state'); error.append(node('strong', '', 'No pudimos cargar el hilo'), node('p', '', state.threadError));
      var retry = node('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { loadThread(state.selectedId, false); }; error.append(retry); wrap.append(error);
    } else if (!items.length) wrap.append(node('div', 'smyl-inbox-thread-state', 'Todavía no hay mensajes en esta conversación.'));
    var lastDay = '';
    items.forEach(function (item) {
      var date = new Date(item.created_at || Date.now()); var day = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
      if (day !== lastDay) { wrap.append(node('div', 'smyl-inbox-day', day)); lastDay = day; }
      var row = node('div', 'smyl-inbox-message is-' + (item.author_type || (item.role === 'user' ? 'patient' : 'assistant')) + (item.status === 'failed' || item.status === 'unknown' ? ' has-error' : ''));
      var bubble = node('div', 'smyl-inbox-bubble'); var author = item.author_type === 'patient' ? 'Paciente' : item.author_type === 'team' ? 'Equipo de la clínica' : 'SMYL Asistente';
      var top = node('div', 'smyl-inbox-message-top'); top.append(node('small', '', author)); if (item.starred) top.append(node('span', '', '★')); bubble.append(top); appendMessageMedia(bubble, item);
      var status = node('span', 'smyl-inbox-message-status', item.status === 'sending' ? 'Enviando…' : item.status === 'failed' ? 'No se envió' : item.status === 'unknown' ? 'Confirmación pendiente' : timeLabel(item.created_at)); bubble.append(status);
      if (item.status === 'failed') { var retryPendingButton = node('button', '', 'Reintentar'); retryPendingButton.type = 'button'; retryPendingButton.onclick = function () { retryPending(item); }; bubble.append(retryPendingButton); }
      else if (item.status === 'unknown') { var refresh = node('button', '', 'Actualizar hilo'); refresh.type = 'button'; refresh.onclick = function () { loadThread(state.selectedId, false); }; bubble.append(refresh); }
      else if (!item.id.toString().startsWith('pending:') && !item.deleted) {
        var actions = node('div', 'smyl-inbox-message-actions');
        var secondaryActions = node('div', 'smyl-inbox-message-secondary'); secondaryActions.hidden = true;
        if (hasPermission('messages.respond')) {
          var reply = node('button', 'is-primary', 'Responder'); reply.type = 'button'; reply.onclick = function () { state.replyTo = item; state.attachment = null; renderComposerContext(); document.querySelector('[name="message"]').focus(); }; actions.append(reply);
          [[item.starred ? 'Quitar estrella' : 'Destacar', function () { mutateMessage(item, item.starred ? 'unstar' : 'star'); }], ['Reenviar', function () { openForward(item); }]].forEach(function (action) { var button = node('button', '', action[0]); button.type = 'button'; button.onclick = action[1]; secondaryActions.append(button); });
        }
        if (hasPermission('messages.manage')) { var remove = node('button', '', 'Eliminar'); remove.type = 'button'; remove.onclick = function () { mutateMessage(item, 'delete'); }; secondaryActions.append(remove); }
        if (item.media_type === 'image' && hasPermission('clinical.write')) { var clinical = node('button', 'is-clinical', 'Enviar a revisión clínica'); clinical.type = 'button'; clinical.onclick = function () { linkClinicalImage(item); }; secondaryActions.append(clinical); }
        if (item.author_type === 'assistant' && hasPermission('messages.respond')) { var feedback = node('button', 'is-copilot', 'Evaluar IA'); feedback.type = 'button'; feedback.onclick = function () { openFeedback(item); }; secondaryActions.append(feedback); }
        if (secondaryActions.childNodes.length) {
          var moreActions = node('button', 'smyl-inbox-message-more', 'Más'); moreActions.type = 'button'; moreActions.setAttribute('aria-expanded', 'false');
          moreActions.onclick = function () { var open = secondaryActions.hidden; secondaryActions.hidden = !open; moreActions.setAttribute('aria-expanded', open ? 'true' : 'false'); };
          actions.append(moreActions, secondaryActions);
        }
        if (actions.childNodes.length) bubble.append(actions);
      }
      row.append(bubble); wrap.append(row);
    });
    var page = state.pages[state.selectedId] || {}; if (older) { older.hidden = !page.hasMore; older.disabled = state.loadingThread; }
    if (keepPosition) body.scrollTop = body.scrollHeight - oldHeight;
  }

  function liveWhatsappWindow(conversation) {
    if (!conversation || conversation.channel !== 'whatsapp') return null;
    var value = conversation.whatsapp_window || {};
    var expires = new Date(value.expires_at || '').getTime();
    var seconds = Number.isFinite(expires) ? Math.max(0, Math.floor((expires - Date.now()) / 1000)) : 0;
    return {
      status: seconds <= 0 ? 'expired' : seconds <= 5 * 60 * 60 ? 'expiring' : 'open',
      remaining_seconds: seconds,
      expires_at: value.expires_at || null,
      freeform_allowed: seconds > 0,
    };
  }

  function durationLabel(seconds) {
    var hours = Math.floor(seconds / 3600); var minutes = Math.floor((seconds % 3600) / 60);
    if (hours) return hours + ' h ' + minutes + ' min';
    return Math.max(1, minutes) + ' min';
  }

  function renderWhatsappWindow() {
    var conversation = selectedConversation(); var form = document.querySelector('[data-inbox-composer]');
    var notice = document.querySelector('[data-wa-window]');
    if (!form || !notice) return;
    var windowState = liveWhatsappWindow(conversation); var isWhatsapp = Boolean(windowState);
    var canRespond = canOperate(conversation, 'messages.respond');
    notice.hidden = !isWhatsapp;
    if (isWhatsapp) {
      notice.dataset.state = windowState.status;
      notice.textContent = windowState.status === 'expired'
        ? 'Ventana de 24 h vencida · usa una plantilla aprobada para contactar al paciente.'
        : windowState.status === 'expiring'
        ? 'La ventana de WhatsApp vence en ' + durationLabel(windowState.remaining_seconds) + '. Puedes programar una plantilla para después.'
        : 'Ventana de WhatsApp abierta · ' + durationLabel(windowState.remaining_seconds) + ' disponibles para texto libre.';
    }
    var freeformAllowed = !isWhatsapp || windowState.freeform_allowed;
    var input = form.elements.message; var send = form.querySelector('[data-compose-send]');
    var attach = form.querySelector('[data-compose-attach]'); var location = form.querySelector('[data-compose-location]');
    var record = form.querySelector('[data-compose-record]');
    var copilot = form.querySelector('[data-compose-copilot]'); var template = form.querySelector('[data-compose-template]');
    var schedule = form.querySelector('[data-compose-schedule]');
    input.disabled = !canRespond || !freeformAllowed; send.disabled = !canRespond || !freeformAllowed;
    attach.disabled = !canRespond || !freeformAllowed; location.disabled = !canRespond || !freeformAllowed || !isWhatsapp;
    record.hidden = !isWhatsapp; record.disabled = !canRespond || !freeformAllowed;
    copilot.disabled = !canRespond || !freeformAllowed;
    template.hidden = !isWhatsapp; template.disabled = !canRespond;
    schedule.hidden = !isWhatsapp; schedule.disabled = !canRespond;
    input.placeholder = isWhatsapp && !freeformAllowed ? 'Ventana vencida: selecciona una plantilla aprobada' : 'Escribe una respuesta…';
  }

  async function loadTemplates() {
    if (state.templatesLoaded || state.templatesLoading) return;
    state.templatesLoading = true;
    try {
      var data = await request('GET', { action: 'templates' });
      state.templates = data.templates || []; state.templatesLoaded = true;
    } finally { state.templatesLoading = false; }
  }

  function templateById(id) { return state.templates.find(function (item) { return item.id === id; }) || null; }

  function renderTemplateFields(select, preview, variables, prefix) {
    var template = templateById(select.value);
    preview.textContent = template ? (template.body || 'Plantilla sin vista previa') : '';
    variables.innerHTML = '';
    if (!template) return;
    for (var i = 0; i < template.variable_count; i += 1) {
      var meta = (template.variable_types || [])[i];
      var type = typeof meta === 'string' ? meta : meta && (meta.tipo || meta.type || meta.label);
      var label = node('label', '', 'Variable {{' + (i + 1) + '}}' + (type ? ' · ' + String(type).replace(/_/g, ' ') : ''));
      var input = document.createElement('input'); input.type = 'text'; input.maxLength = 1000; input.required = true;
      input.dataset.variableIndex = String(i); input.name = prefix + '-variable-' + i;
      if (type && String(type).toLowerCase().includes('cliente')) {
        var conversation = selectedConversation(); input.value = conversation ? conversation.contact_name : '';
      }
      label.append(input); variables.append(label);
    }
  }

  function fillTemplateSelect(select) {
    select.innerHTML = '';
    if (!state.templates.length) {
      var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No hay plantillas aprobadas'; select.append(empty); return;
    }
    state.templates.forEach(function (template) { var option = document.createElement('option'); option.value = template.id; option.textContent = template.name + ' · ' + template.language; select.append(option); });
  }

  async function openTemplateDialog() {
    var conversation = selectedConversation(); if (!conversation || conversation.channel !== 'whatsapp' || !canOperate(conversation, 'messages.respond')) return;
    try { await loadTemplates(); } catch (error) { window.alert(error.message || 'No se pudieron cargar las plantillas.'); return; }
    var dialog = document.querySelector('[data-template-dialog]'); var select = dialog.querySelector('[data-template-select]');
    fillTemplateSelect(select); renderTemplateFields(select, dialog.querySelector('[data-template-preview]'), dialog.querySelector('[data-template-variables]'), 'send');
    dialog.showModal();
  }

  async function sendTemplate(event) {
    event.preventDefault(); var conversation = selectedConversation(); if (!conversation) return;
    var dialog = event.currentTarget.closest('dialog'); var select = dialog.querySelector('[data-template-select]'); var template = templateById(select.value);
    if (!template) { window.alert('Selecciona una plantilla aprobada.'); return; }
    var variables = Array.from(dialog.querySelectorAll('[data-variable-index]')).map(function (input) { return input.value.trim(); });
    if (variables.some(function (value) { return !value; })) { window.alert('Completa todas las variables de la plantilla.'); return; }
    var content = variables.reduce(function (copy, value, index) { return copy.split('{{' + (index + 1) + '}}').join(value); }, template.body || template.name);
    var key = uuid(); var extra = { type: 'template', template_id: template.id, template_variables: variables };
    var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: content, created_at: new Date().toISOString(), status: 'sending', extra: extra };
    state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending); dialog.close(); renderMessages(false); requestAnimationFrame(scrollThreadBottom);
    submitMessage(content, key, pending, extra);
  }

  function localDateInput(date) {
    var pad = function (value) { return String(value).padStart(2, '0'); };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function renderScheduleMode() {
    var dialog = document.querySelector('[data-schedule-dialog]'); if (!dialog) return;
    var isTemplate = dialog.querySelector('[data-schedule-type]').value === 'template';
    dialog.querySelector('[data-schedule-text-wrap]').hidden = isTemplate;
    dialog.querySelector('[data-schedule-template-wrap]').hidden = !isTemplate;
    dialog.querySelector('[data-schedule-text]').required = !isTemplate;
    if (isTemplate) {
      var select = dialog.querySelector('[data-schedule-template]');
      renderTemplateFields(select, dialog.querySelector('[data-schedule-preview]'), dialog.querySelector('[data-schedule-variables]'), 'schedule');
    }
  }

  async function loadScheduled(conversationId) {
    if (!conversationId || state.scheduledLoading[conversationId]) return;
    state.scheduledLoading[conversationId] = true;
    try { var data = await request('GET', { action: 'scheduled', conversation_id: conversationId }); state.scheduled[conversationId] = data.scheduled || []; }
    catch (_) { state.scheduled[conversationId] = state.scheduled[conversationId] || []; }
    finally { state.scheduledLoading[conversationId] = false; if (state.selectedId === conversationId) renderContext(); }
  }

  async function openScheduleDialog() {
    var conversation = selectedConversation(); if (!conversation || conversation.channel !== 'whatsapp' || !canOperate(conversation, 'messages.respond')) return;
    try { await loadTemplates(); } catch (_) {}
    var dialog = document.querySelector('[data-schedule-dialog]'); var sendAt = new Date(Date.now() + 15 * 60 * 1000);
    dialog.querySelector('[data-schedule-at]').value = localDateInput(sendAt);
    dialog.querySelector('[data-schedule-at]').min = localDateInput(new Date(Date.now() + 60 * 1000));
    var windowState = liveWhatsappWindow(conversation); dialog.querySelector('[data-schedule-type]').value = windowState && !windowState.freeform_allowed ? 'template' : 'text';
    fillTemplateSelect(dialog.querySelector('[data-schedule-template]')); renderScheduleMode(); dialog.showModal();
  }

  async function createScheduled(event) {
    event.preventDefault(); var conversation = selectedConversation(); if (!conversation) return;
    var dialog = event.currentTarget.closest('dialog'); var type = dialog.querySelector('[data-schedule-type]').value; var sendAt = new Date(dialog.querySelector('[data-schedule-at]').value);
    if (!Number.isFinite(sendAt.getTime())) { window.alert('Selecciona una fecha y hora válidas.'); return; }
    var payload = { action: 'schedule', conversation_id: conversation.id, type: type, send_at: sendAt.toISOString() };
    if (type === 'template') {
      var select = dialog.querySelector('[data-schedule-template]'); var template = templateById(select.value);
      if (!template) { window.alert('Selecciona una plantilla aprobada.'); return; }
      payload.template_id = template.id;
      payload.template_variables = Array.from(dialog.querySelectorAll('[data-schedule-variables] [data-variable-index]')).map(function (input) { return input.value.trim(); });
      if (payload.template_variables.some(function (value) { return !value; })) { window.alert('Completa todas las variables de la plantilla.'); return; }
    } else {
      payload.content = dialog.querySelector('[data-schedule-text]').value.trim();
      if (!payload.content) { window.alert('Escribe el mensaje que se enviará.'); return; }
    }
    try {
      var data = await request('POST', {}, payload, uuid(), 20000);
      state.scheduled[conversation.id] = [data.scheduled].concat((state.scheduled[conversation.id] || []).filter(function (item) { return item.id !== data.scheduled.id; }));
      dialog.close(); renderContext();
    } catch (error) { window.alert(error.message || 'No se pudo programar el mensaje.'); }
  }

  async function cancelScheduled(item) {
    var conversation = selectedConversation(); if (!conversation || !window.confirm('¿Cancelar este mensaje programado?')) return;
    try {
      var data = await request('POST', {}, { action: 'cancel_scheduled', conversation_id: conversation.id, scheduled_id: item.id }, uuid(), 15000);
      state.scheduled[conversation.id] = (state.scheduled[conversation.id] || []).map(function (row) { return row.id === item.id ? data.scheduled : row; }); renderContext();
    } catch (error) { window.alert(error.message || 'No se pudo cancelar el mensaje.'); }
  }

  async function retryScheduled(item) {
    var conversation = selectedConversation();
    if (!conversation || !item.retry_safe || !window.confirm('¿Volver a colocar este mensaje en la cola?')) return;
    try {
      var data = await request('POST', {}, { action: 'retry_scheduled', conversation_id: conversation.id, scheduled_id: item.id }, uuid(), 15000);
      state.scheduled[conversation.id] = (state.scheduled[conversation.id] || []).map(function (row) { return row.id === item.id ? data.scheduled : row; });
      renderContext(); loadOperations(true);
    } catch (error) { window.alert(error.message || 'No se pudo reintentar el mensaje.'); }
  }

  function renderOperationsChip() {
    var button = document.querySelector('[data-inbox-operations]');
    if (!button) return;
    var span = button.querySelector('span');
    if (state.operationsLoading && !state.operations) { button.dataset.state = 'loading'; span.textContent = 'Revisando operación'; return; }
    if (state.operationsError && !state.operations) { button.dataset.state = 'attention'; span.textContent = 'Estado no disponible'; return; }
    var status = state.operations && state.operations.health && state.operations.health.status;
    button.dataset.state = status === 'healthy' ? 'healthy' : status === 'action_required' ? 'critical' : 'attention';
    span.textContent = status === 'healthy' ? 'Operación estable' : status === 'action_required' ? 'Requiere atención' : 'Revisar operación';
  }

  function operationsSummary() {
    var operations = state.operations;
    if (!operations) return { loaded: false, status: state.operationsError ? 'unavailable' : 'loading', alerts: [] };
    return {
      loaded: true,
      status: operations.health && operations.health.status || 'attention',
      generated_at: operations.generated_at || null,
      alerts: ((operations.health && operations.health.alerts) || []).map(function (item) {
        return { code: item.code || 'operational', severity: item.severity === 'critical' ? 'critical' : 'warning', message: item.message || 'Revisa esta señal operativa.', count: Number(item.count) || 0 };
      }),
      pilot: { status: operations.pilot && operations.pilot.status || 'preparation', readiness: operations.pilot && operations.pilot.readiness || 'blocked', all_scenarios_passed: Boolean(operations.pilot && operations.pilot.all_scenarios_passed) },
    };
  }

  function publishOperationsSummary() {
    window.dispatchEvent(new CustomEvent('smyl:inbox-operations-updated', { detail: operationsSummary() }));
  }

  function metricCard(label, value, note) {
    var card = node('div', 'smyl-inbox-operations-metric');
    card.append(node('span', '', label), node('strong', '', String(value)));
    if (note) card.append(node('small', '', note));
    return card;
  }

  function pilotStatusLabel(status) {
    return status === 'active' ? 'Piloto activo' : status === 'paused' ? 'Piloto pausado' : status === 'completed' ? 'Piloto completado' : 'En preparación';
  }

  function operationalTime(value) {
    if (!value) return 'Sin actualización';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin actualización';
    return date.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function pilotDecision(operations) {
    var health = operations.health || {}; var pilot = operations.pilot || {};
    var checks = pilot.checks || []; var scenarios = pilot.scenarios || [];
    var technicalPassed = checks.filter(function (item) { return item.passed; }).length;
    var evidencePassed = scenarios.filter(function (item) { return item.passed; }).length;
    var criticalAlerts = (health.alerts || []).filter(function (item) { return item.severity === 'critical'; }).length;
    var gates = [
      { label: 'Puerta técnica', detail: technicalPassed + ' de ' + checks.length + ' controles', passed: checks.length > 0 && technicalPassed === checks.length },
      { label: 'Pruebas en clínica', detail: evidencePassed + ' de ' + scenarios.length + ' evidencias', passed: scenarios.length > 0 && evidencePassed === scenarios.length },
      { label: 'Incidentes críticos', detail: criticalAlerts ? criticalAlerts + ' por resolver' : 'Ninguno activo', passed: criticalAlerts === 0 },
    ];
    var passedGates = gates.filter(function (item) { return item.passed; }).length;
    var decision = { state: 'blocked', label: 'No apto para aprobación', explanation: 'Resuelve los controles pendientes antes de cerrar el piloto.' };
    if (pilot.status === 'completed' && gates.every(function (item) { return item.passed; })) decision = { state: 'approved', label: 'Piloto aprobado', explanation: 'Las tres puertas permanecen confirmadas por el equipo.' };
    else if (pilot.status === 'completed') decision = { state: 'blocked', label: 'Aprobado con atención pendiente', explanation: 'El piloto fue cerrado, pero la operación actual requiere una nueva revisión.' };
    else if (pilot.status === 'paused') decision = { state: 'paused', label: 'Validación pausada', explanation: 'Reanuda el piloto cuando el equipo pueda continuar las pruebas.' };
    else if (gates.every(function (item) { return item.passed; })) decision = { state: 'ready', label: 'Listo para aprobación', explanation: 'El dueño puede revisar la evidencia y cerrar el piloto.' };
    else if (pilot.status === 'active') decision = { state: 'progress', label: 'Validación en curso', explanation: 'Completa la evidencia faltante y mantén la operación sin bloqueos.' };
    else if (pilot.readiness === 'ready') decision = { state: 'ready', label: 'Listo para iniciar', explanation: 'La puerta técnica permite comenzar la validación en clínica.' };
    return { decision: decision, gates: gates, passedGates: passedGates, technicalPassed: technicalPassed, evidencePassed: evidencePassed };
  }

  function alertControl(code) {
    var controls = {
      no_channel: 'Conecta y verifica un canal de la clínica.',
      training_missing: 'Publica la capacitación dental vigente.',
      dead_letters: 'Revisa la cola de fallos antes de continuar.',
      unknown_delivery: 'Confirma el resultado con el proveedor; no reenvíes a ciegas.',
      queue_overdue: 'Comprueba el worker y actualiza nuevamente el estado.',
      ai_limit: 'Amplía o espera la renovación del límite antes de usar IA.',
      ai_near_limit: 'Planifica capacidad antes de ampliar el piloto.',
      rate_limited: 'Reduce la cadencia y revisa los límites temporales.',
    };
    return controls[code] || 'Revisa la señal con la persona responsable de operación.';
  }

  async function mutatePilot(action, scenarioId, evidence) {
    if (state.pilotLoading) return;
    state.pilotLoading = true; renderOperations();
    try {
      await request('POST', {}, { action: 'pilot', pilot_action: action, scenario_id: scenarioId || null, evidence: evidence || null }, uuid(), 20000);
      state.operations = null;
      await loadOperations(true);
    } catch (error) {
      window.alert(error.message || 'No se pudo actualizar el piloto.');
    } finally { state.pilotLoading = false; renderOperations(); }
  }

  function renderOperations() {
    renderOperationsChip();
    var content = document.querySelector('[data-operations-content]');
    if (!content) return;
    var reportButton = document.querySelector('[data-pilot-report]'); if (reportButton) reportButton.disabled = !state.operations;
    content.innerHTML = '';
    if (state.operationsLoading && !state.operations) {
      content.append(node('div', 'smyl-inbox-operations-state', 'Calculando salud operativa…'));
      return;
    }
    if (state.operationsError && !state.operations) {
      var error = node('div', 'smyl-inbox-operations-state is-error');
      error.append(node('strong', '', 'No se pudo consultar el estado'), node('p', '', state.operationsError));
      content.append(error); return;
    }
    var operations = state.operations;
    if (!operations) return;
    var health = operations.health || {}; var alerts = health.alerts || []; var metrics = operations.metrics || {};
    var pilot = operations.pilot || {}; var assessment = pilotDecision(operations);
    var summary = node('section', 'smyl-inbox-operations-summary is-' + (health.status || 'attention'));
    summary.append(node('strong', '', health.status === 'healthy' ? 'Operación estable' : health.status === 'action_required' ? 'Hay bloqueos antes del piloto' : 'Hay puntos por revisar'));
    summary.append(node('p', '', alerts.length ? alerts.length + (alerts.length === 1 ? ' señal operativa activa.' : ' señales operativas activas.') : 'No hay alertas operativas abiertas.'));
    content.append(summary);

    var decisionPanel = node('section', 'smyl-inbox-decision is-' + assessment.decision.state);
    var decisionCopy = node('div', 'smyl-inbox-decision-copy');
    decisionCopy.append(node('span', '', 'DECISIÓN DE PILOTO'), node('strong', '', assessment.decision.label), node('p', '', assessment.decision.explanation));
    var decisionProgress = node('div', 'smyl-inbox-decision-progress');
    var progressValue = assessment.gates.length ? Math.round((assessment.passedGates / assessment.gates.length) * 100) : 0;
    var progressRing = node('div', 'smyl-inbox-decision-ring'); progressRing.style.setProperty('--progress', progressValue + '%');
    progressRing.append(node('strong', '', progressValue + '%'), node('span', '', 'puertas'));
    decisionProgress.append(progressRing, node('small', '', 'Actualizado ' + operationalTime(operations.generated_at)));
    decisionPanel.append(decisionCopy, decisionProgress);
    var gateList = node('div', 'smyl-inbox-decision-gates');
    assessment.gates.forEach(function (gate) {
      var row = node('div', gate.passed ? 'is-passed' : 'is-pending');
      row.append(node('i', '', gate.passed ? '✓' : '!'), node('span', '', gate.label), node('small', '', gate.detail)); gateList.append(row);
    });
    decisionPanel.append(gateList); content.append(decisionPanel);

    var grid = node('section', 'smyl-inbox-operations-grid');
    grid.append(
      metricCard('Por atender', metrics.needs_human || 0, (metrics.conversations || 0) + ' conversaciones'),
      metricCard('Enviados', metrics.messages_sent_24h || 0, 'Últimas 24 horas'),
      metricCard('Evidencias', assessment.evidencePassed + '/' + ((pilot.scenarios || []).length || 5), 'Pruebas de campo'),
      metricCard('Canales activos', (operations.channels || []).filter(function (item) { return item.connected; }).length, 'De ' + (operations.channels || []).length + ' disponibles'),
      metricCard('Reintentando', metrics.scheduled_retrying || 0, 'Automático y acotado'),
      metricCard('Cola de fallos', metrics.dead_letters || 0, 'Requieren revisión')
    );
    content.append(grid);

    if (alerts.length) {
      var alertSection = node('section', 'smyl-inbox-operations-section'); alertSection.append(node('h3', '', 'Alertas activas'));
      alerts.forEach(function (item) {
        var row = node('div', 'smyl-inbox-operation-alert is-' + item.severity);
        var alertCopy = node('div', ''); alertCopy.append(node('p', '', item.message || 'Revisa esta señal operativa.'), node('small', '', 'Siguiente control: ' + alertControl(item.code)));
        row.append(node('strong', '', item.severity === 'critical' ? 'Bloqueo' : 'Revisión'), alertCopy);
        alertSection.append(row);
      });
      content.append(alertSection);
    }

    var ai = operations.ai || {}; var aiSection = node('section', 'smyl-inbox-operations-section');
    aiSection.append(node('h3', '', 'Consumo de IA'));
    var aiTop = node('div', 'smyl-inbox-operations-between'); aiTop.append(node('span', '', 'Uso mensual'), node('strong', '', (Number(ai.used_percent) || 0).toLocaleString('es-MX') + '%')); aiSection.append(aiTop);
    var progress = node('div', 'smyl-inbox-operations-progress'); var bar = node('i', ''); bar.style.width = Math.max(0, Math.min(100, Number(ai.used_percent) || 0)) + '%'; progress.append(bar); aiSection.append(progress);
    aiSection.append(node('small', '', (Number(ai.used_tokens) || 0).toLocaleString('es-MX') + ' de ' + (Number(ai.limit_tokens) || 0).toLocaleString('es-MX') + ' tokens'));
    content.append(aiSection);

    var channels = node('section', 'smyl-inbox-operations-section'); channels.append(node('h3', '', 'Canales'));
    var channelList = node('div', 'smyl-inbox-operations-channels');
    (operations.channels || []).forEach(function (item) {
      var row = node('div', item.connected ? 'is-connected' : '');
      row.append(node('span', '', channelLabel(item.channel)), node('strong', '', item.connected ? 'Conectado' : 'Sin conectar')); channelList.append(row);
    });
    channels.append(channelList); content.append(channels);

    var pilotSection = node('section', 'smyl-inbox-operations-section smyl-inbox-pilot');
    var pilotHead = node('div', 'smyl-inbox-pilot-head');
    pilotHead.append(node('h3', '', 'Piloto profesional'), node('span', 'smyl-inbox-pilot-status is-' + (pilot.status || 'preparation'), pilotStatusLabel(pilot.status)));
    pilotSection.append(pilotHead);
    pilotSection.append(node('p', '', pilot.readiness === 'ready' ? 'La configuración técnica está lista para iniciar una validación controlada con una clínica.' : 'Resuelve los puntos pendientes antes de activar una clínica piloto.'));
    pilotSection.append(node('small', 'smyl-inbox-pilot-safety', 'Estas comprobaciones no envían mensajes ni simulan evidencia: registra únicamente pruebas realizadas por el equipo en dispositivos reales.'));
    var checklist = node('div', 'smyl-inbox-pilot-checks');
    (pilot.checks || []).forEach(function (item) { var row = node('div', item.passed ? 'is-ready' : 'is-blocked'); row.append(node('i', '', item.passed ? 'Listo' : 'Pendiente'), node('span', '', item.label)); checklist.append(row); });
    pilotSection.append(checklist);

    if (pilot.status !== 'preparation') {
      var tests = node('div', 'smyl-inbox-pilot-tests');
      (pilot.scenarios || []).forEach(function (scenario) {
        var row = node('article', 'smyl-inbox-pilot-test' + (scenario.passed ? ' is-passed' : ''));
        var copy = node('div', ''); copy.append(node('strong', '', scenario.label), node('p', '', scenario.description));
        if (scenario.passed) copy.append(node('small', '', 'Confirmado por ' + (scenario.checked_by || 'el equipo') + (scenario.evidence ? ' · ' + scenario.evidence : '')));
        row.append(copy);
        if (operations.actor && operations.actor.role === 'owner' && pilot.status === 'active') {
          var form = node('form', 'smyl-inbox-pilot-evidence');
          var input = document.createElement('input'); input.type = 'text'; input.maxLength = 500; input.required = true; input.minLength = 8;
          input.placeholder = scenario.passed ? 'Actualizar evidencia…' : 'Evidencia breve de la prueba…'; input.setAttribute('aria-label', 'Evidencia de ' + scenario.label);
          var verify = node('button', 'btn btn-secondary btn-sm', scenario.passed ? 'Revalidar' : 'Confirmar prueba'); verify.type = 'submit'; verify.disabled = state.pilotLoading;
          form.append(input, verify); form.onsubmit = function (event) { event.preventDefault(); mutatePilot('verify', scenario.id, input.value.trim()); };
          row.append(form);
        } else row.append(node('span', 'smyl-inbox-pilot-result', scenario.passed ? 'Aprobada' : 'Pendiente'));
        tests.append(row);
      });
      pilotSection.append(tests);
    }

    var canManagePilot = operations.actor && operations.actor.role === 'owner';
    if (canManagePilot) {
      var actions = node('div', 'smyl-inbox-pilot-actions');
      if (pilot.status === 'preparation') {
        var start = node('button', 'btn btn-primary', state.pilotLoading ? 'Iniciando…' : 'Iniciar piloto controlado'); start.type = 'button'; start.disabled = state.pilotLoading || pilot.readiness !== 'ready'; start.onclick = function () { mutatePilot('start'); }; actions.append(start);
      } else if (pilot.status === 'active') {
        var pause = node('button', 'btn btn-secondary', 'Pausar piloto'); pause.type = 'button'; pause.disabled = state.pilotLoading; pause.onclick = function () { mutatePilot('pause'); };
        var complete = node('button', 'btn btn-primary', 'Cerrar piloto aprobado'); complete.type = 'button'; complete.disabled = state.pilotLoading || !pilot.all_scenarios_passed || pilot.readiness !== 'ready'; complete.onclick = function () { if (window.confirm('¿Cerrar el piloto como aprobado?')) mutatePilot('complete'); };
        actions.append(pause, complete);
      } else if (pilot.status === 'paused') {
        var resume = node('button', 'btn btn-primary', 'Reanudar piloto'); resume.type = 'button'; resume.disabled = state.pilotLoading; resume.onclick = function () { mutatePilot('resume'); }; actions.append(resume);
      } else if (pilot.status === 'completed') {
        var reset = node('button', 'btn btn-secondary', 'Preparar nueva validación'); reset.type = 'button'; reset.disabled = state.pilotLoading; reset.onclick = function () { if (window.confirm('¿Crear un nuevo ciclo de validación?')) mutatePilot('reset'); }; actions.append(reset);
      }
      pilotSection.append(actions);
    } else pilotSection.append(node('p', 'smyl-inbox-pilot-readonly', 'Seguimiento de solo lectura. El dueño de la clínica registra y aprueba las pruebas.'));
    content.append(pilotSection);
  }

  async function loadOperations(force) {
    if (state.operationsLoading || (state.operations && !force)) { renderOperations(); return; }
    state.operationsLoading = true; state.operationsError = ''; renderOperations();
    try { state.operations = await request('GET', { action: 'operations' }, null, null, 20000); }
    catch (error) { state.operationsError = error.message || 'No se pudo calcular la salud operativa.'; }
    finally { state.operationsLoading = false; renderOperations(); publishOperationsSummary(); }
  }

  function openOperations() {
    var dialog = document.querySelector('[data-operations-dialog]'); if (!dialog) return;
    renderOperations(); dialog.showModal(); loadOperations(true);
  }

  function reportListItem(label, detail, passed) {
    var row = node('li', passed ? 'is-passed' : 'is-pending');
    row.append(node('i', '', passed ? '✓' : '!'));
    var copy = node('div', ''); copy.append(node('strong', '', label), node('span', '', detail)); row.append(copy);
    return row;
  }

  function renderPilotReport() {
    var content = document.querySelector('[data-pilot-report-content]'); if (!content || !state.operations) return;
    content.innerHTML = '';
    var operations = state.operations; var pilot = operations.pilot || {}; var assessment = pilotDecision(operations);
    var intro = node('section', 'smyl-inbox-report-summary');
    intro.append(node('span', '', 'CORTE GENERADO ' + operationalTime(operations.generated_at)), node('h3', '', assessment.decision.label), node('p', '', assessment.decision.explanation));
    var status = node('div', 'smyl-inbox-report-status is-' + assessment.decision.state, assessment.passedGates + ' de ' + assessment.gates.length + ' puertas confirmadas');
    intro.append(status); content.append(intro);

    var metrics = operations.metrics || {}; var metricGrid = node('section', 'smyl-inbox-report-metrics');
    metricGrid.append(
      metricCard('Conversaciones', metrics.conversations || 0, 'Total del canal canónico'),
      metricCard('Por atender', metrics.needs_human || 0, 'Intervención humana'),
      metricCard('Enviados', metrics.messages_sent_24h || 0, 'Últimas 24 horas'),
      metricCard('Canales activos', (operations.channels || []).filter(function (item) { return item.connected; }).length + '/' + (operations.channels || []).length, 'Cobertura disponible'),
      metricCard('Reintentando', metrics.scheduled_retrying || 0, 'Cola automática'),
      metricCard('Fallos', metrics.dead_letters || 0, 'Revisión manual')
    );
    content.append(metricGrid);

    var gatesSection = node('section', 'smyl-inbox-report-section'); gatesSection.append(node('h3', '', 'Criterios de salida'));
    var gates = node('ul', 'smyl-inbox-report-list'); assessment.gates.forEach(function (gate) { gates.append(reportListItem(gate.label, gate.detail, gate.passed)); }); gatesSection.append(gates); content.append(gatesSection);

    var evidenceSection = node('section', 'smyl-inbox-report-section'); evidenceSection.append(node('h3', '', 'Evidencia de campo'));
    var evidence = node('ol', 'smyl-inbox-report-evidence');
    (pilot.scenarios || []).forEach(function (scenario) {
      var detail = scenario.passed
        ? (scenario.evidence || 'Evidencia confirmada') + ' · ' + (scenario.checked_by || 'Equipo') + (scenario.checked_at ? ' · ' + operationalTime(scenario.checked_at) : '')
        : 'Pendiente de realizar y documentar por el equipo.';
      evidence.append(reportListItem(scenario.label, detail, scenario.passed));
    });
    evidenceSection.append(evidence); content.append(evidenceSection);

    var alertsSection = node('section', 'smyl-inbox-report-section'); alertsSection.append(node('h3', '', 'Incidencias del corte'));
    var alerts = (operations.health && operations.health.alerts) || [];
    if (!alerts.length) alertsSection.append(node('p', 'smyl-inbox-report-empty', 'Sin alertas operativas activas en este corte.'));
    else {
      var alertList = node('ul', 'smyl-inbox-report-alerts'); alerts.forEach(function (item) { alertList.append(reportListItem(item.message || 'Señal operativa', alertControl(item.code), false)); }); alertsSection.append(alertList);
    }
    content.append(alertsSection);
    content.append(node('p', 'smyl-inbox-report-disclaimer', 'Este informe documenta una validación operativa. No certifica resultados clínicos, cumplimiento normativo, entrega final de mensajes ni niveles de servicio. No contiene conversaciones ni datos de pacientes.'));
  }

  function openPilotReport() {
    if (!state.operations) return;
    renderPilotReport();
    var operationsDialog = document.querySelector('[data-operations-dialog]'); if (operationsDialog.open) operationsDialog.close();
    document.querySelector('[data-pilot-report-dialog]').showModal();
  }

  function printPilotReport() {
    var content = document.querySelector('[data-pilot-report-content]'); if (!content) return;
    var reportWindow = window.open('', '_blank');
    if (!reportWindow) { window.alert('Permite ventanas emergentes para imprimir o guardar el informe como PDF.'); return; }
    reportWindow.opener = null;
    reportWindow.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SMYL · Informe operativo del piloto</title><style>body{max-width:820px;margin:0 auto;padding:36px;font-family:Arial,sans-serif;color:#173149}h1{margin:0 0 6px;font-size:26px}.meta{margin:0 0 24px;color:#607286}.smyl-inbox-report-summary{position:relative;padding:18px;border:1px solid #bfd8d2;border-radius:10px;background:#f4faf8}.smyl-inbox-report-summary>span{font-size:10px;font-weight:bold;letter-spacing:.08em;color:#5c756f}.smyl-inbox-report-summary h3{margin:7px 0 4px;font-size:20px}.smyl-inbox-report-summary p{margin:0;color:#5c6d7c}.smyl-inbox-report-status{margin-top:12px;font-weight:bold}.smyl-inbox-report-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.smyl-inbox-operations-metric{padding:12px;border:1px solid #d9e2e8;border-radius:8px}.smyl-inbox-operations-metric span,.smyl-inbox-operations-metric strong,.smyl-inbox-operations-metric small{display:block}.smyl-inbox-operations-metric span,.smyl-inbox-operations-metric small{color:#657687;font-size:11px}.smyl-inbox-operations-metric strong{margin:5px 0;font-size:20px}.smyl-inbox-report-section{margin-top:22px}.smyl-inbox-report-section h3{padding-bottom:8px;border-bottom:1px solid #dce4ea;font-size:15px}.smyl-inbox-report-list,.smyl-inbox-report-evidence,.smyl-inbox-report-alerts{padding:0;list-style:none}.smyl-inbox-report-list li,.smyl-inbox-report-evidence li,.smyl-inbox-report-alerts li{display:flex;gap:10px;margin:9px 0;padding:10px;background:#f8fafb;border-radius:7px}.smyl-inbox-report-list i,.smyl-inbox-report-evidence i,.smyl-inbox-report-alerts i{font-style:normal;font-weight:bold}.smyl-inbox-report-list strong,.smyl-inbox-report-list span,.smyl-inbox-report-evidence strong,.smyl-inbox-report-evidence span,.smyl-inbox-report-alerts strong,.smyl-inbox-report-alerts span{display:block}.smyl-inbox-report-list span,.smyl-inbox-report-evidence span,.smyl-inbox-report-alerts span{margin-top:3px;color:#657687;font-size:12px}.smyl-inbox-report-disclaimer{margin-top:24px;padding:12px;border-left:3px solid #72899a;background:#f4f7f9;color:#526474;font-size:11px;line-height:1.5}@media print{body{padding:0}@page{margin:16mm}}@media(max-width:600px){body{padding:20px}.smyl-inbox-report-metrics{grid-template-columns:1fr 1fr}}</style></head><body><h1>Informe operativo del piloto</h1><p class="meta">SMYL · Inbox conectado con LANA</p>' + content.innerHTML + '</body></html>');
    reportWindow.document.close(); reportWindow.focus(); setTimeout(function () { reportWindow.print(); }, 250);
  }

  async function saveAutomation(hoursValue, windowValue) {
    var conversation = selectedConversation(); if (!conversation) return;
    try {
      var data = await request('POST', {}, {
        action: 'configure_automation', conversation_id: conversation.id,
        auto_reactivate_hours: hoursValue === '' ? null : Number(hoursValue),
        window_reactivation: windowValue === '' ? null : windowValue === 'true',
      }, uuid(), 15000);
      conversation.automation = conversation.automation || {};
      conversation.automation.auto_reactivate_hours = data.auto_reactivate_hours;
      conversation.automation.window_reactivation = data.window_reactivation;
      renderContext();
    } catch (error) { window.alert(error.message || 'No se pudo guardar la automatización.'); }
  }

  function focusComposer() {
    state.contextOpen = false;
    renderContext();
    var composer = document.querySelector('[name="message"]');
    if (composer) composer.focus();
  }

  function openPatientContext(conversationId) {
    if (window.SmylLanaHandoff) window.SmylLanaHandoff.open(conversationId);
  }

  function contextSectionKey(card, heading) {
    if (card.classList.contains('is-attention')) return 'attention';
    if (card.classList.contains('smyl-inbox-appointment-card')) return 'appointment';
    if (card.classList.contains('smyl-inbox-availability-card')) return 'availability';
    if (card.classList.contains('smyl-inbox-ficha')) return 'record';
    if (card.classList.contains('smyl-inbox-copilot-card')) return 'copilot';
    if (card.classList.contains('smyl-inbox-wa-card')) return 'whatsapp';
    if (card.classList.contains('smyl-inbox-automation-card')) return 'automation';
    if (card.classList.contains('smyl-inbox-scheduled-card')) return 'scheduled';
    if (card.classList.contains('smyl-inbox-organization')) return 'organization';
    return String(heading.textContent || 'section').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
  }

  function organizeContextSections(wrap, conversation, ficha) {
    Array.from(wrap.children).filter(function (child) { return child.classList.contains('smyl-inbox-context-card'); }).forEach(function (card) {
      var heading = Array.from(card.children).find(function (child) { return child.tagName === 'H3'; });
      if (!heading) return;
      var key = contextSectionKey(card, heading);
      var storageKey = conversation.id + ':' + key;
      var details = node('details', 'smyl-inbox-context-group');
      details.dataset.section = key;
      var summary = document.createElement('summary');
      summary.append(node('span', '', heading.textContent));
      var hint = '';
      if (key === 'attention') hint = 'Requiere acción';
      else if (key === 'appointment') hint = state.appointmentContextLoading[conversation.id] ? 'Consultando' : 'Agenda';
      else if (key === 'record') hint = ficha && ficha.linked ? 'Vinculado' : 'Por vincular';
      else if (key === 'whatsapp') hint = liveWhatsappWindow(conversation).status === 'expired' ? 'Ventana vencida' : 'Ventana abierta';
      else if (key === 'responsable') hint = conversation.assignment ? conversation.assignment.name : 'Sin asignar';
      if (hint) summary.append(node('small', '', hint));
      heading.remove();
      card.classList.add('smyl-inbox-context-card-body');
      wrap.insertBefore(details, card);
      details.append(summary, card);
      var appointmentData = state.appointmentContext[conversation.id];
      var urgent = key === 'attention'
        || key === 'appointment' && appointmentData && ((appointmentData.items || []).some(function (item) { return ['confirmed', 'accepted', 'cancelled', 'rejected', 'expired'].indexOf((item.appointment && item.appointment.status) || item.status) === -1; }) || !appointmentData.linked)
        || key === 'record' && !(ficha && ficha.linked)
        || key === 'responsable' && !conversation.assignment;
      details.open = state.contextSections[storageKey] === undefined ? urgent : state.contextSections[storageKey];
      details.addEventListener('toggle', function () { state.contextSections[storageKey] = details.open; });
    });
  }

  function renderContext() {
    var wrap = document.querySelector('[data-inbox-context-content]');
    var page = document.getElementById('p-inbox');
    if (!wrap || !page) return;
    page.classList.toggle('context-open', state.contextOpen);
    wrap.innerHTML = '';
    var conversation = selectedConversation();
    if (!conversation) {
      wrap.append(node('div', 'smyl-inbox-context-empty', 'Selecciona una conversación para administrar su atención.'));
      return;
    }
    var header = node('div', 'smyl-inbox-context-head');
    header.append(node('span', 'smyl-inbox-eyebrow', 'CONTROL DE ATENCIÓN'), node('h2', '', conversation.contact_name));
    var close = node('button', 'smyl-inbox-context-close', 'Cerrar'); close.type = 'button'; close.onclick = function () { state.contextOpen = false; renderContext(); };
    header.append(close); wrap.append(header);

    var ficha = state.clinical[conversation.id];
    var next = node('section', 'smyl-inbox-next');
    next.append(node('span', '', 'SIGUIENTE ACCIÓN'));
    var nextTitle = conversation.needs_human ? 'Responder y resolver la solicitud'
      : conversation.unread_count ? 'Revisar los mensajes nuevos'
      : conversation.paused ? 'Decidir si reanudas el asistente'
      : 'Conversación bajo control';
    var nextCopy = conversation.needs_human
      ? 'El asistente pidió intervención. Atiende al paciente antes de reanudar la automatización.'
      : conversation.unread_count ? 'Hay información nueva del paciente pendiente de revisión.'
      : conversation.paused ? 'El equipo conserva el control hasta que revise el contexto de reanudación.'
      : 'SMYL Asistente puede continuar dentro de la capacitación publicada.';
    next.append(node('strong', '', nextTitle), node('p', '', nextCopy));
    var nextActions = node('div', 'smyl-inbox-next-actions');
    if (conversation.needs_human || conversation.unread_count) {
      var respond = node('button', 'btn btn-primary btn-sm', 'Responder ahora'); respond.type = 'button'; respond.onclick = focusComposer; nextActions.append(respond);
    }
    var patientAction = node('button', 'btn btn-secondary btn-sm', ficha && ficha.linked ? 'Abrir expediente' : 'Vincular paciente');
    patientAction.type = 'button'; patientAction.onclick = function () { openPatientContext(conversation.id); }; nextActions.append(patientAction);
    if (ficha && ficha.case && ficha.case.lana_appointment_id) {
      var agenda = node('button', 'btn btn-secondary btn-sm', 'Ver Agenda'); agenda.type = 'button'; agenda.onclick = function () { window.ir('agenda'); }; nextActions.append(agenda);
    }
    next.append(nextActions); wrap.append(next);

    var status = node('section', 'smyl-inbox-context-card');
    status.append(node('h3', '', 'Responsable'));
    if (hasPermission('messages.manage')) {
      var select = document.createElement('select'); select.setAttribute('aria-label', 'Asignar conversación');
      var none = document.createElement('option'); none.value = ''; none.textContent = 'Sin asignar'; select.append(none);
      state.team.forEach(function (member) { var option = document.createElement('option'); option.value = member.id; option.textContent = member.name; select.append(option); });
      select.value = conversation.assignment && conversation.assignment.source === 'smyl' ? conversation.assignment.actor_id : '';
      select.disabled = !canOperate(conversation, 'messages.manage');
      select.onchange = function () { if (select.value) assignConversation(select.value); else mutateConversation('release'); };
      status.append(select);
    } else {
      status.append(node('p', '', conversation.assignment ? conversation.assignment.name : 'Sin asignar'));
      var own = conversation.assignment && state.actor && conversation.assignment.actor_id === state.actor.id;
      var assignmentButton = node('button', 'btn btn-secondary btn-sm', own ? 'Liberar conversación' : 'Tomar conversación');
      assignmentButton.type = 'button'; assignmentButton.disabled = !canOperate(conversation, 'messages.manage'); assignmentButton.onclick = function () { own ? mutateConversation('release') : assignConversation(state.actor.id); };
      status.append(assignmentButton);
    }
    wrap.append(status);

    var organization = node('section', 'smyl-inbox-context-card smyl-inbox-organization');
    organization.append(node('h3', '', 'Organización'));
    var stageLabel = node('label', '', 'Etapa de atención');
    var stageSelect = document.createElement('select'); stageSelect.setAttribute('aria-label', 'Cambiar etapa de atención');
    var noStage = document.createElement('option'); noStage.value = ''; noStage.textContent = 'Sin etapa'; stageSelect.append(noStage);
    state.stages.forEach(function (stage) {
      var option = document.createElement('option'); option.value = stage.id; option.textContent = stage.name + (stage.archived ? ' · Archivada' : ''); stageSelect.append(option);
    });
    stageSelect.value = conversation.stage_id || '';
    stageSelect.disabled = !canOperate(conversation, 'messages.manage');
    stageSelect.onchange = function () { mutateConversation('stage', stageSelect.value); };
    stageLabel.append(stageSelect); organization.append(stageLabel);
    var pinButton = node('button', 'btn btn-secondary btn-sm', conversation.pinned ? 'Quitar de fijadas' : 'Fijar arriba');
    pinButton.type = 'button'; pinButton.disabled = !canOperate(conversation, 'messages.manage');
    pinButton.onclick = function () { mutateConversation(conversation.pinned ? 'unpin' : 'pin'); };
    organization.append(pinButton);
    var sharedButton = node('button', 'btn btn-secondary btn-sm', 'Ver archivos compartidos');
    sharedButton.type = 'button'; sharedButton.onclick = openSharedItems;
    organization.append(sharedButton); wrap.append(organization);

    var assistant = node('section', 'smyl-inbox-context-card'); assistant.append(node('h3', '', 'SMYL Asistente'));
    assistant.append(node('p', '', conversation.paused ? 'Pausado. El equipo atiende este hilo.' : 'Activo. SMYL Asistente puede responder según su capacitación.'));
    var toggle = node('button', conversation.paused ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm', conversation.paused ? (state.copilotLoading[conversation.id] === 'summary' ? 'Preparando contexto…' : 'Preparar reanudación') : 'Pausar y tomar control');
    toggle.type = 'button'; toggle.disabled = !canOperate(conversation, 'messages.manage') || Boolean(state.copilotLoading[conversation.id]); toggle.onclick = function () { conversation.paused ? prepareResume() : mutateConversation('pause'); };
    assistant.append(toggle); wrap.append(assistant);

    if (conversation.channel === 'whatsapp') {
      var windowState = liveWhatsappWindow(conversation); var waCard = node('section', 'smyl-inbox-context-card smyl-inbox-wa-card');
      waCard.append(node('h3', '', 'Ventana de WhatsApp'));
      var windowCopy = windowState.status === 'expired'
        ? 'Vencida. Solo una plantilla UTILITY aprobada puede iniciar el contacto.'
        : (windowState.status === 'expiring' ? 'Vence en ' : 'Abierta por ') + durationLabel(windowState.remaining_seconds) + '.';
      waCard.append(node('p', 'is-' + windowState.status, windowCopy));
      var waActions = node('div', 'smyl-inbox-context-actions');
      var templateButton = node('button', 'btn btn-secondary btn-sm', 'Usar plantilla'); templateButton.type = 'button'; templateButton.disabled = !canOperate(conversation, 'messages.respond'); templateButton.onclick = openTemplateDialog;
      var scheduleButton = node('button', 'btn btn-secondary btn-sm', 'Programar'); scheduleButton.type = 'button'; scheduleButton.disabled = !canOperate(conversation, 'messages.respond'); scheduleButton.onclick = openScheduleDialog;
      waActions.append(templateButton, scheduleButton); waCard.append(waActions); wrap.append(waCard);

      var automation = conversation.automation || {}; var automationCard = node('section', 'smyl-inbox-context-card smyl-inbox-automation-card');
      automationCard.append(node('h3', '', 'Reactivación controlada'), node('p', '', 'Estas excepciones solo aplican a esta conversación. “Heredar” conserva la configuración general del asistente.'));
      var hoursLabel = node('label', '', 'Después de inactividad'); var hoursSelect = document.createElement('select');
      [['', 'Heredar configuración'], ['0', 'Nunca'], ['1', '1 hora'], ['2', '2 horas'], ['4', '4 horas'], ['8', '8 horas'], ['24', '24 horas']].forEach(function (optionData) { var option = document.createElement('option'); option.value = optionData[0]; option.textContent = optionData[1]; hoursSelect.append(option); });
      var configuredHours = automation.auto_reactivate_hours === null || automation.auto_reactivate_hours === undefined ? '' : String(automation.auto_reactivate_hours);
      if (configuredHours && !Array.from(hoursSelect.options).some(function (option) { return option.value === configuredHours; })) {
        var customHours = document.createElement('option'); customHours.value = configuredHours; customHours.textContent = configuredHours + ' horas (configurado)'; hoursSelect.append(customHours);
      }
      hoursSelect.value = configuredHours; hoursLabel.append(hoursSelect);
      var windowLabel = node('label', '', 'Al acercarse el cierre de ventana'); var windowSelect = document.createElement('select');
      [['', 'Heredar configuración'], ['true', 'Reactivar si corresponde'], ['false', 'No reactivar automáticamente']].forEach(function (optionData) { var option = document.createElement('option'); option.value = optionData[0]; option.textContent = optionData[1]; windowSelect.append(option); });
      windowSelect.value = automation.window_reactivation === null || automation.window_reactivation === undefined ? '' : String(automation.window_reactivation); windowLabel.append(windowSelect);
      var saveAutomationButton = node('button', 'btn btn-secondary btn-sm', 'Guardar reglas'); saveAutomationButton.type = 'button'; saveAutomationButton.disabled = !canOperate(conversation, 'messages.manage'); saveAutomationButton.onclick = function () { saveAutomation(hoursSelect.value, windowSelect.value); };
      automationCard.append(hoursLabel, windowLabel, saveAutomationButton);
      if (automation.reminder_sent_at) automationCard.append(node('small', '', 'Último recordatorio automático: ' + new Date(automation.reminder_sent_at).toLocaleString('es-MX')));
      else automationCard.append(node('small', '', 'El asistente aún no ha enviado un recordatorio en esta racha.'));
      wrap.append(automationCard);

      var scheduledCard = node('section', 'smyl-inbox-context-card smyl-inbox-scheduled-card'); scheduledCard.append(node('h3', '', 'Programados'));
      if (state.scheduledLoading[conversation.id]) scheduledCard.append(node('p', '', 'Consultando agenda…'));
      else {
        var scheduledRows = state.scheduled[conversation.id] || [];
        if (!scheduledRows.length) scheduledCard.append(node('p', '', 'No hay mensajes programados para este hilo.'));
        scheduledRows.slice(0, 6).forEach(function (item) {
          var row = node('div', 'smyl-inbox-scheduled-row'); var copy = node('div', '');
          copy.append(node('strong', '', item.type === 'template' ? 'Plantilla aprobada' : 'Texto libre'));
          copy.append(node('span', '', new Date(item.send_at).toLocaleString('es-MX') + ' · ' + scheduledStatusLabel(item.status)));
          if (item.status === 'retrying' && item.next_attempt_at) copy.append(node('small', '', 'Próximo intento: ' + new Date(item.next_attempt_at).toLocaleString('es-MX')));
          if ((item.status === 'dead_letter' || item.status === 'fallido') && item.attempt_count) copy.append(node('small', '', item.attempt_count + ' de ' + item.max_attempts + ' intentos'));
          copy.append(node('p', '', item.error || item.content)); row.append(copy);
          var actions = node('div', 'smyl-inbox-scheduled-actions');
          if (item.status === 'pendiente' || item.status === 'retrying') { var cancel = node('button', '', 'Cancelar'); cancel.type = 'button'; cancel.onclick = function () { cancelScheduled(item); }; actions.append(cancel); }
          if ((item.status === 'dead_letter' || item.status === 'fallido') && item.retry_safe) { var retry = node('button', '', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { retryScheduled(item); }; actions.append(retry); }
          if ((item.status === 'dead_letter' || item.status === 'fallido') && !item.retry_safe) actions.append(node('span', '', 'Revisar hilo'));
          if (actions.childNodes.length) row.append(actions);
          scheduledCard.append(row);
        });
      }
      var newScheduled = node('button', 'btn btn-secondary btn-sm', 'Programar seguimiento'); newScheduled.type = 'button'; newScheduled.disabled = !canOperate(conversation, 'messages.respond'); newScheduled.onclick = openScheduleDialog; scheduledCard.append(newScheduled); wrap.append(scheduledCard);
    }

    var copilot = node('section', 'smyl-inbox-context-card smyl-inbox-copilot-card');
    copilot.append(node('h3', '', 'SMYL Copilot'), node('p', '', 'Prepara borradores y resúmenes con la capacitación publicada. Nunca envía ni ejecuta acciones por sí solo.'));
    var suggest = node('button', 'btn btn-secondary btn-sm', state.copilotLoading[conversation.id] === 'draft' ? 'Preparando borrador…' : 'Sugerir respuesta');
    suggest.type = 'button'; suggest.disabled = !canOperate(conversation, 'messages.respond') || Boolean(state.copilotLoading[conversation.id]); suggest.onclick = function () { requestCopilot('draft'); };
    copilot.append(suggest); wrap.append(copilot);

    if (hasPermission('schedule.read')) {
      var appointmentCard = node('section', 'smyl-inbox-context-card smyl-inbox-appointment-card');
      appointmentCard.append(node('h3', '', 'Cita del paciente'));
      var appointmentData = state.appointmentContext[conversation.id];
      if (state.appointmentContextLoading[conversation.id]) appointmentCard.append(node('p', '', 'Consultando Agenda…'));
      else if (!appointmentData || !appointmentData.linked) appointmentCard.append(node('p', '', 'Vincula al paciente para consultar y confirmar sus citas desde esta conversación.'));
      else if (!(appointmentData.items || []).length) appointmentCard.append(node('p', '', 'Todavía no hay una elección de horario registrada en este chat.'));
      else {
        var currentAppointment = appointmentData.items[0]; var actualAppointment = currentAppointment.appointment || {};
        var serviceName = currentAppointment.service && currentAppointment.service.name || 'Servicio dental';
        var professionalName = currentAppointment.professional && currentAppointment.professional.display_name || 'Profesional por confirmar';
        var branchName = currentAppointment.branch && currentAppointment.branch.name || 'Sucursal por confirmar';
        var effectiveStatus = actualAppointment.status || currentAppointment.status;
        var statusText = effectiveStatus === 'confirmed' || effectiveStatus === 'accepted' ? 'Cita confirmada' : effectiveStatus === 'cancelled' ? 'Cita cancelada' : effectiveStatus === 'rejected' || effectiveStatus === 'expired' ? 'Elección cerrada' : 'Elección pendiente de confirmación';
        appointmentCard.append(node('strong', 'smyl-inbox-appointment-status is-' + effectiveStatus, statusText));
        appointmentCard.append(node('p', '', serviceName + ' · ' + availabilityDate(actualAppointment.starts_at || currentAppointment.requested_start)));
        appointmentCard.append(node('small', '', professionalName + ' · ' + branchName));
        var draftAppointment = node('button', 'btn btn-secondary btn-sm', effectiveStatus === 'confirmed' || effectiveStatus === 'accepted' ? 'Preparar confirmación' : 'Preparar seguimiento');
        draftAppointment.type = 'button'; draftAppointment.disabled = !canOperate(conversation, 'messages.respond');
        draftAppointment.onclick = function () {
          var confirmed = effectiveStatus === 'confirmed' || effectiveStatus === 'accepted';
          setComposerText((confirmed ? 'Tu cita para ' : 'Registramos tu elección para ') + serviceName + ' ' + (confirmed ? 'quedó confirmada' : 'y está pendiente de confirmación por la clínica') + ' el ' + availabilityDate(actualAppointment.starts_at || currentAppointment.requested_start) + ' con ' + professionalName + ' en ' + branchName + '.');
        };
        appointmentCard.append(draftAppointment);
      }
      wrap.append(appointmentCard);

      var availability = node('section', 'smyl-inbox-context-card smyl-inbox-availability-card');
      availability.append(node('h3', '', 'Agenda disponible'), node('p', '', 'Consulta espacios reales por servicio, profesional y sede sin salir del chat.'));
      var availabilityButton = node('button', 'btn btn-secondary btn-sm', 'Buscar horarios');
      availabilityButton.type = 'button'; availabilityButton.onclick = openAvailabilityDialog;
      availability.append(availabilityButton); wrap.append(availability);
    }

    if (conversation.needs_human) {
      var attention = node('section', 'smyl-inbox-context-card is-attention');
      attention.append(node('h3', '', 'Intervención solicitada'), node('p', '', 'El asistente marcó esta conversación para seguimiento humano. Resolverla no reactiva la IA.'));
      var resolve = node('button', 'btn btn-primary btn-sm', 'Marcar solicitud resuelta'); resolve.type = 'button'; resolve.disabled = !canOperate(conversation, 'messages.manage'); resolve.onclick = function () { mutateConversation('resolve'); };
      attention.append(resolve); wrap.append(attention);
    }

    if (hasPermission('clinical.read')) {
      var clinical = node('section', 'smyl-inbox-context-card smyl-inbox-ficha');
      clinical.append(node('h3', '', 'Ficha 360'));
      if (state.clinicalLoading[conversation.id]) clinical.append(node('p', '', 'Consultando expediente…'));
      else if (ficha && ficha.linked) {
        clinical.append(node('strong', '', ficha.patient && ficha.patient.name || conversation.contact_name));
        clinical.append(node('p', '', [ficha.patient && ficha.patient.phone, ficha.patient && ficha.patient.email].filter(Boolean).join(' · ') || 'Paciente confirmado'));
        var facts = node('div', 'smyl-inbox-ficha-facts');
        facts.append(node('span', '', 'Caso activo'), node('span', '', String((ficha.clinical_images || []).length) + ' fotos desde chat'));
        if (ficha.case && ficha.case.score !== null) facts.append(node('span', '', 'Score ' + ficha.case.score));
        if (ficha.case && ficha.case.lana_appointment_id) facts.append(node('span', '', 'Cita vinculada'));
        if (ficha.case && ficha.case.simulation_url) facts.append(node('span', '', 'Simulación disponible'));
        if (ficha.case && ficha.case.quote_total !== null && ficha.case.quote_total !== undefined) {
          var quote = Number(ficha.case.quote_total);
          facts.append(node('span', '', Number.isFinite(quote) ? 'Propuesta ' + quote.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }) : 'Propuesta registrada'));
        }
        clinical.append(facts);
        if (ficha.case && (ficha.case.summary || ficha.case.diagnosis)) clinical.append(node('p', 'smyl-inbox-ficha-summary', ficha.case.summary || ficha.case.diagnosis));
        var openRecord = node('button', 'btn btn-secondary btn-sm', 'Abrir expediente'); openRecord.type = 'button'; openRecord.onclick = function () { openPatientContext(conversation.id); }; clinical.append(openRecord);
      } else {
        clinical.append(node('p', '', 'Confirma paciente y caso antes de incorporar fotografías a la revisión clínica.'));
        var record = node('button', 'btn btn-secondary btn-sm', 'Preparar expediente'); record.type = 'button'; record.onclick = function () { openPatientContext(conversation.id); };
        clinical.append(record);
      }
      wrap.append(clinical);
    }
    organizeContextSections(wrap, conversation, ficha);
  }

  function renderCareBar() {
    var host = document.querySelector('[data-thread-carebar]');
    var conversation = selectedConversation();
    if (!host) return;
    host.innerHTML = '';
    host.hidden = !conversation;
    if (!conversation) return;
    var title = node('span', 'smyl-inbox-carebar-label', 'Continuar atención');
    host.append(title);
    if (hasPermission('schedule.read')) {
      var appointment = node('button', 'smyl-inbox-care-action is-primary', 'Agendar cita');
      appointment.type = 'button'; appointment.onclick = openAvailabilityDialog; host.append(appointment);
    }
    if (hasPermission('clinical.read')) {
      var record = node('button', 'smyl-inbox-care-action', 'Expediente');
      record.type = 'button'; record.onclick = function () { openPatientContext(conversation.id); }; host.append(record);
    }
    ['quote', 'payment'].forEach(function (type) {
      var copy = type === 'quote' ? 'Cotizar' : 'Cobrar';
      var button = node('button', 'smyl-inbox-care-action', copy); button.type = 'button';
      button.onclick = function () {
        if (window.SmylCareTasks && typeof window.SmylCareTasks.open === 'function') window.SmylCareTasks.open(type);
        else window.ir(type === 'quote' ? 'propuestas' : 'caja');
      };
      host.append(button);
    });
  }

  function closeThreadMenu() {
    var menu = document.querySelector('[data-thread-menu]'); var trigger = document.querySelector('[data-thread-more]');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function toggleThreadMenu() {
    var menu = document.querySelector('[data-thread-menu]'); var trigger = document.querySelector('[data-thread-more]');
    if (!menu || !trigger) return;
    var open = menu.hidden; menu.hidden = !open; trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeComposerTools() {
    var tools = document.querySelector('[data-compose-tools]'); var trigger = document.querySelector('[data-compose-more]');
    if (tools) tools.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function toggleComposerTools() {
    var tools = document.querySelector('[data-compose-tools]'); var trigger = document.querySelector('[data-compose-more]');
    if (!tools || !trigger) return;
    var open = tools.hidden; tools.hidden = !open; trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function renderThreadHeader() {
    var conversation = selectedConversation();
    var empty = document.querySelector('[data-inbox-thread-empty]');
    var thread = document.querySelector('[data-inbox-thread]');
    if (!conversation) {
      if (empty) empty.hidden = false; if (thread) thread.hidden = true;
      var openNext = document.querySelector('[data-inbox-open-next]');
      if (openNext) { openNext.disabled = !visibleConversations().length; openNext.onclick = function () { var next = visibleConversations()[0]; if (next) openConversation(next.id); }; }
      renderCareBar(); renderContext(); return;
    }
    empty.hidden = true; thread.hidden = false;
    document.querySelector('[data-thread-avatar]').textContent = initials(conversation.contact_name);
    document.querySelector('[data-thread-avatar]').dataset.channel = conversation.channel;
    document.querySelector('[data-thread-name]').textContent = conversation.contact_name;
    var threadFicha = state.clinical[conversation.id];
    var actorRole = state.actor && state.actor.role_name;
    var continuityLabel = threadFicha && threadFicha.linked ? 'Expediente vinculado' : 'Paciente sin vincular';
    var patientSummary = document.querySelector('[data-inbox-context]');
    patientSummary.setAttribute('aria-label', 'Abrir paciente y atención · ' + continuityLabel + (actorRole ? ' · ' + actorRole : ''));
    var threadMeta = [channelLabel(conversation.channel), conversation.assignment ? conversation.assignment.name : 'Sin asignar'];
    document.querySelector('[data-thread-meta]').textContent = threadMeta.join(' · ');
    var stateLabel = document.querySelector('[data-thread-state]');
    stateLabel.textContent = conversation.needs_human ? 'Requiere atención' : conversation.paused ? 'Atención humana' : 'IA activa';
    stateLabel.dataset.state = conversation.needs_human ? 'attention' : conversation.paused ? 'human' : 'assistant';
    var mode = document.querySelector('[data-thread-mode]');
    mode.textContent = conversation.paused ? (state.copilotLoading[conversation.id] === 'summary' ? 'Preparando…' : 'Reanudar IA') : 'Tomar control';
    mode.dataset.state = conversation.paused ? 'resume' : 'pause';
    mode.disabled = !canOperate(conversation, 'messages.manage') || Boolean(state.copilotLoading[conversation.id]);
    var pin = document.querySelector('[data-thread-pin]');
    pin.textContent = conversation.pinned ? 'Fijada' : 'Fijar';
    pin.dataset.active = conversation.pinned ? 'true' : 'false';
    pin.setAttribute('aria-label', conversation.pinned ? 'Quitar conversación de fijadas' : 'Fijar conversación');
    pin.disabled = !canOperate(conversation, 'messages.manage');
    var composer = document.querySelector('[data-inbox-composer]');
    Array.from(composer.elements).forEach(function (control) { control.disabled = !canOperate(conversation, 'messages.respond'); });
    renderComposerContext(); renderWhatsappWindow(); renderCareBar(); renderContext();
  }

  function render() {
    renderList(); renderThreadHeader(); renderMessages(false); renderCopilotDraft();
  }

  async function loadTeam() {
    try { var data = await request('GET', { action: 'team' }); state.team = data.members || []; renderContext(); } catch (_) {}
  }

  async function loadStages() {
    try { var data = await request('GET', { action: 'stages' }); state.stages = data.stages || []; render(); }
    catch (_) { state.stages = []; render(); }
  }

  async function loadClinicalContext(conversationId) {
    if (!conversationId || !hasPermission('clinical.read')) return;
    state.clinicalLoading[conversationId] = true; renderContext();
    try { state.clinical[conversationId] = await request('GET', { action: 'clinical_context', conversation_id: conversationId }); }
    catch (_) { state.clinical[conversationId] = { linked: false, unavailable: true }; }
    finally { state.clinicalLoading[conversationId] = false; if (state.selectedId === conversationId) renderContext(); }
  }

  async function loadAppointmentContext(conversationId) {
    if (!conversationId || !hasPermission('schedule.read')) return;
    state.appointmentContextLoading[conversationId] = true; renderContext();
    try { state.appointmentContext[conversationId] = await request('GET', { action: 'appointment_context', conversation_id: conversationId }); }
    catch (_) { state.appointmentContext[conversationId] = { linked: false, unavailable: true, items: [] }; }
    finally { state.appointmentContextLoading[conversationId] = false; if (state.selectedId === conversationId) renderContext(); }
  }

  function availabilityDate(value) {
    var date = new Date(value); if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  function availabilityInputDate(date) {
    function pad(value) { return String(value).padStart(2, '0'); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function renderAvailabilityResults() {
    var host = document.querySelector('[data-availability-results]'); if (!host) return;
    host.innerHTML = '';
    renderAvailabilityOffer();
    if (state.availabilityLoading) { host.append(node('p', 'smyl-inbox-availability-state', 'Consultando Agenda…')); return; }
    if (!state.availabilitySlots.length) { host.append(node('p', 'smyl-inbox-availability-state', 'Busca un periodo para ver alternativas verificadas.')); return; }
    state.availabilitySlots.forEach(function (slot) {
      var row = node('article', 'smyl-inbox-availability-slot');
      var copy = node('div', '');
      copy.append(node('strong', '', availabilityDate(slot.starts_at)), node('span', '', slot.professional_name + (slot.specialty ? ' · ' + slot.specialty : '')), node('small', '', slot.branch_name + ' · ' + slot.duration_minutes + ' min'));
      var actions = node('div', 'smyl-inbox-availability-actions');
      var use = node('button', 'btn btn-secondary btn-sm', 'Agregar al borrador'); use.type = 'button';
      use.onclick = function () {
        var message = 'Tengo disponible ' + availabilityDate(slot.starts_at) + ' con ' + slot.professional_name + ' en ' + slot.branch_name + '. El horario se confirma cuando elijas la opción.';
        setComposerText(message); document.querySelector('[data-availability-dialog]').close();
      };
      actions.append(use);
      var selected = state.availabilitySelected.some(function (item) { return availabilitySlotKey(item) === availabilitySlotKey(slot); });
      var selectOption = node('button', 'btn btn-secondary btn-sm' + (selected ? ' is-selected' : ''), selected ? 'Opción seleccionada' : 'Elegir opción');
      selectOption.type = 'button'; selectOption.onclick = function () { toggleAvailabilityOption(slot); };
      actions.append(selectOption);
      if (hasPermission('schedule.manage')) {
        var requestRow = state.availabilityRequests.find(function (requestRow) {
          return requestRow.service_id === slot.service_id && requestRow.preferred_branch_id === slot.branch_id && requestRow.preferred_professional_id === slot.professional_id && new Date(requestRow.requested_start).getTime() === new Date(slot.starts_at).getTime();
        });
        var manage = node('button', 'btn btn-primary btn-sm', requestRow && requestRow.status === 'pending' ? 'Confirmar cita' : requestRow && requestRow.status === 'accepted' ? 'Cita confirmada' : 'Paciente eligió');
        manage.type = 'button'; manage.disabled = Boolean(state.availabilityAction) || Boolean(requestRow && requestRow.status === 'accepted');
        manage.onclick = function () { if (requestRow && requestRow.status === 'pending') confirmAvailabilityRequest(requestRow); else recordAvailabilityChoice(slot); };
        actions.append(manage);
      }
      row.append(copy, actions); host.append(row);
    });
  }

  function availabilitySlotKey(slot) {
    return [slot.service_id, slot.branch_id, slot.professional_id, new Date(slot.starts_at).toISOString()].join('|');
  }

  function renderAvailabilityOffer() {
    var count = document.querySelector('[data-availability-selection]'); var prepare = document.querySelector('[data-availability-prepare]');
    if (count) count.textContent = state.availabilitySelected.length + ' de 3 opciones';
    if (prepare) prepare.disabled = !state.availabilitySelected.length || !canOperate(selectedConversation(), 'messages.respond');
  }

  function toggleAvailabilityOption(slot) {
    var key = availabilitySlotKey(slot); var index = state.availabilitySelected.findIndex(function (item) { return availabilitySlotKey(item) === key; });
    if (index >= 0) state.availabilitySelected.splice(index, 1);
    else if (state.availabilitySelected.length >= 3) { window.alert('Puedes compartir hasta tres alternativas por mensaje.'); return; }
    else state.availabilitySelected.push(slot);
    renderAvailabilityResults();
  }

  function prepareAvailabilityOptions() {
    if (!state.availabilitySelected.length) return;
    var ordered = state.availabilitySelected.slice().sort(function (left, right) { return new Date(left.starts_at) - new Date(right.starts_at); });
    var service = state.availabilityCatalog && (state.availabilityCatalog.services || []).find(function (row) { return row.id === ordered[0].service_id; });
    var lines = ['Te comparto estas opciones disponibles para ' + (service && service.name || 'tu cita dental') + ':'];
    ordered.forEach(function (slot, index) { lines.push((index + 1) + '. ' + availabilityDate(slot.starts_at) + ' con ' + slot.professional_name + ' en ' + slot.branch_name); });
    lines.push('Responde con el número que prefieres. La clínica confirmará el horario después de tu elección.');
    setComposerText(lines.join('\n')); document.querySelector('[data-availability-dialog]').close();
  }

  async function loadAvailabilityRequests() {
    if (!hasPermission('schedule.manage') || !state.selectedId) { state.availabilityRequests = []; return; }
    var data = await request('GET', { action: 'appointment_requests', conversation_id: state.selectedId });
    state.availabilityRequests = data.requests || [];
  }

  async function recordAvailabilityChoice(slot) {
    if (!window.confirm('¿El paciente eligió este horario? Se registrará como solicitud pendiente; todavía no será una cita.')) return;
    state.availabilityAction = 'request'; renderAvailabilityResults();
    try {
      var data = await request('POST', {}, { action: 'appointment_request', conversation_id: state.selectedId, service_id: slot.service_id, branch_id: slot.branch_id, professional_id: slot.professional_id, starts_at: slot.starts_at }, uuid());
      state.availabilityRequests.unshift({ id: data.request_id, service_id: slot.service_id, preferred_branch_id: slot.branch_id, preferred_professional_id: slot.professional_id, requested_start: slot.starts_at, requested_end: slot.ends_at, status: 'pending', appointment_id: null });
      loadAppointmentContext(state.selectedId);
    } catch (error) { window.alert(error.message || 'No se pudo registrar la elección.'); }
    finally { state.availabilityAction = ''; renderAvailabilityResults(); }
  }

  async function confirmAvailabilityRequest(requestRow) {
    if (!window.confirm('¿Confirmar esta cita? SMYL volverá a comprobar la disponibilidad antes de guardarla.')) return;
    state.availabilityAction = 'confirm'; renderAvailabilityResults();
    try {
      var data = await request('POST', {}, { action: 'appointment_confirm', conversation_id: state.selectedId, request_id: requestRow.id }, uuid());
      requestRow.status = 'accepted'; requestRow.appointment_id = data.appointment_id;
      loadAppointmentContext(state.selectedId);
      window.alert('Cita confirmada en la Agenda. El chat no envió ningún mensaje automáticamente.');
    } catch (error) { window.alert(error.message || 'No se pudo confirmar la cita. Consulta nuevamente la disponibilidad.'); }
    finally { state.availabilityAction = ''; renderAvailabilityResults(); }
  }

  function filterAvailabilityProfessionals() {
    var dialog = document.querySelector('[data-availability-dialog]'); var catalog = state.availabilityCatalog; if (!dialog || !catalog) return;
    var serviceId = dialog.querySelector('[data-availability-service]').value;
    var allowed = new Set((catalog.professional_services || []).filter(function (row) { return row.service_id === serviceId; }).map(function (row) { return row.professional_id; }));
    var select = dialog.querySelector('[data-availability-professional]'); var current = select.value;
    select.innerHTML = '<option value="">Cualquier profesional</option>';
    (catalog.professionals || []).filter(function (row) { return allowed.has(row.id); }).forEach(function (row) { select.append(new Option(row.display_name + (row.specialty ? ' · ' + row.specialty : ''), row.id)); });
    if (allowed.has(current)) select.value = current;
  }

  async function openAvailabilityDialog() {
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog) return;
    try {
      if (!state.availabilityCatalog) state.availabilityCatalog = await request('GET', { action: 'availability_catalog' });
      await loadAvailabilityRequests();
      var catalog = state.availabilityCatalog; var services = dialog.querySelector('[data-availability-service]'); var branches = dialog.querySelector('[data-availability-branch]');
      services.innerHTML = '<option value="">Selecciona un servicio</option>'; (catalog.services || []).forEach(function (row) { services.append(new Option(row.name + ' · ' + row.duration_minutes + ' min', row.id)); });
      branches.innerHTML = '<option value="">Cualquier sucursal</option>'; (catalog.branches || []).forEach(function (row) { branches.append(new Option(row.name, row.id)); });
      var start = new Date(); var end = new Date(Date.now() + 7 * 86400000);
      dialog.querySelector('[data-availability-from]').value = availabilityInputDate(start); dialog.querySelector('[data-availability-to]').value = availabilityInputDate(end);
      state.availabilitySlots = []; state.availabilitySelected = []; filterAvailabilityProfessionals(); renderAvailabilityResults(); dialog.showModal();
    } catch (error) { window.alert(error.message || 'No se pudo consultar la configuración de Agenda.'); }
  }

  async function searchAvailability(event) {
    event.preventDefault(); var form = event.currentTarget; var serviceId = form.querySelector('[data-availability-service]').value;
    if (!serviceId) { window.alert('Selecciona el servicio que necesita el paciente.'); return; }
    var from = new Date(form.querySelector('[data-availability-from]').value + 'T00:00:00'); var to = new Date(form.querySelector('[data-availability-to]').value + 'T23:59:59');
    state.availabilityLoading = true; state.availabilitySlots = []; state.availabilitySelected = []; renderAvailabilityResults();
    try {
      var data = await request('GET', {
        action: 'availability', service_id: serviceId,
        branch_id: form.querySelector('[data-availability-branch]').value,
        professional_id: form.querySelector('[data-availability-professional]').value,
        from: from.toISOString(), to: to.toISOString(), limit: '12'
      });
      state.availabilitySlots = data.slots || [];
      if (!state.availabilitySlots.length) document.querySelector('[data-availability-results]').textContent = 'No encontramos espacios con esos criterios. Amplía el periodo o cambia de profesional.';
    } catch (error) { document.querySelector('[data-availability-results]').textContent = error.message || 'No se pudo consultar disponibilidad.'; }
    finally { state.availabilityLoading = false; if (state.availabilitySlots.length) renderAvailabilityResults(); }
  }

  async function loadList(reset) {
    if (state.loadingList) return;
    state.loadingList = true; state.listError = '';
    if (reset) { state.offset = 0; state.hasMore = false; }
    renderList();
    try {
      var data = await request('GET', { action: 'list', filter: state.filter, channel: state.channel, q: state.search, limit: state.limit, offset: state.offset });
      state.actor = data.actor || state.actor;
      mergeConversations(data.conversations || [], reset);
      state.total = data.page && Number(data.page.total) || state.conversations.length;
      state.hasMore = Boolean(data.page && data.page.has_more);
      if (reset || !state.syncedAt) state.syncedAt = data.synced_at || new Date().toISOString();
      if (!reset) state.offset += (data.conversations || []).length;
      else state.offset = (data.conversations || []).length;
    } catch (error) { state.listError = error.message; }
    finally {
      state.loadingList = false; renderList(); renderContext();
      if (reset && !state.didAutoOpen) {
        state.didAutoOpen = true;
        var next = visibleConversations()[0];
        if (next && window.innerWidth > 760) openConversation(next.id);
      }
    }
  }

  async function loadThread(conversationId, older, since) {
    if (!conversationId) return;
    if (!older && !since && state.threadController) state.threadController.abort();
    var controller = since ? null : new AbortController();
    if (controller) state.threadController = controller;
    state.loadingThread = !since; state.threadError = '';
    var body = document.querySelector('[data-thread-body]');
    var wasBottom = atThreadBottom();
    if (!since) renderMessages(Boolean(older));
    var query = { action: 'messages', conversation_id: conversationId, limit: older ? 40 : (since ? 50 : 50) };
    if (older && state.pages[conversationId] && state.pages[conversationId].before) query.before = state.pages[conversationId].before;
    if (since) query.since = since;
    try {
      var data = await request('GET', query, null, null, 20000, controller);
      if (conversationId !== state.selectedId) return;
      mergeMessages(conversationId, data.messages || [], older);
      if (!since) state.pages[conversationId] = { hasMore: Boolean(data.page && data.page.has_more), before: data.page && data.page.before };
      var updated = data.conversation;
      if (updated) mergeConversations([updated], false);
      if (!since && controller === state.threadController) state.loadingThread = false;
      renderList(); renderThreadHeader(); renderMessages(Boolean(older));
      if (!older && (wasBottom || !since)) requestAnimationFrame(scrollThreadBottom);
      else if (since && (data.messages || []).length) document.querySelector('[data-thread-jump]').hidden = false;
    } catch (error) {
      if (controller && controller !== state.threadController) return;
      if (conversationId === state.selectedId && !since) { state.threadError = error.message; renderMessages(Boolean(older)); }
    } finally {
      if (controller && controller === state.threadController) {
        state.loadingThread = false;
        state.threadController = null;
        if (conversationId === state.selectedId) renderMessages(Boolean(older));
      }
    }
  }

  async function openConversation(id) {
    if (state.recorder && state.recorder.state === 'recording') stopVoiceRecording(true);
    closeThreadMenu(); closeComposerTools();
    var previousId = state.selectedId; var previousInput = document.querySelector('[name="message"]');
    if (previousId && previousInput && previousInput.value.trim()) await persistEncryptedDraft(previousId, previousInput.value.trim()).catch(function () {});
    state.selectedId = id; state.contextOpen = false; state.threadError = ''; state.replyTo = null; state.attachment = null;
    document.getElementById('p-inbox').classList.add('show-thread');
    render(); await restoreEncryptedDraft(id);
    loadClinicalContext(id); loadAppointmentContext(id); loadScheduled(id); await loadThread(id, false);
    var conversation = selectedConversation();
    if (conversation && conversation.unread_count) {
      try {
        await request('POST', {}, { action: 'read', conversation_id: id }, uuid());
        conversation.unread_count = 0; renderList();
      } catch (_) {}
    }
  }

  function applyConversationResult(conversation, data) {
    conversation.paused = Boolean(data.paused);
    conversation.needs_human = Boolean(data.needs_human);
    conversation.unread_count = Number(data.unread_count) || 0;
    if (Object.prototype.hasOwnProperty.call(data, 'pinned')) conversation.pinned = Boolean(data.pinned);
    if (Object.prototype.hasOwnProperty.call(data, 'stage_id')) conversation.stage_id = data.stage_id || null;
    conversation.assignment = data.assigned_actor_id
      ? { source: 'smyl', actor_id: data.assigned_actor_id, name: data.assigned_actor_name || 'Miembro de SMYL' }
      : (data.legacy_assigned ? { source: 'lana', actor_id: null, name: 'Asignada previamente' } : null);
    conversation.can_operate = true;
  }

  async function applyBulkAction(action, targetId) {
    if (state.bulkRunning || !state.bulkSelected.size) return;
    var ids = Array.from(state.bulkSelected); state.bulkRunning = true; renderList();
    var failed = 0;
    for (var index = 0; index < ids.length; index += 1) {
      var conversation = state.conversations.find(function (item) { return item.id === ids[index]; });
      if (!conversation) continue;
      try {
        var payload = { action: action, conversation_id: conversation.id };
        if (action === 'stage') payload.target_stage_id = targetId || null; else payload.target_actor_id = targetId;
        var data = await request('POST', {}, payload, uuid()); applyConversationResult(conversation, data);
      } catch (_) { failed += 1; }
    }
    state.bulkRunning = false;
    if (!failed) { state.bulkSelected.clear(); state.bulkMode = false; }
    render();
    if (failed) window.alert((ids.length - failed) + ' conversaciones actualizadas; ' + failed + ' no pudieron modificarse por permisos o estado.');
  }

  async function mutateConversation(action, targetId) {
    var conversation = selectedConversation();
    if (!conversation) return;
    try {
      var payload = { action: action, conversation_id: conversation.id };
      if (action === 'stage') payload.target_stage_id = targetId || null;
      else if (targetId) payload.target_actor_id = targetId;
      var data = await request('POST', {}, payload, uuid());
      applyConversationResult(conversation, data);
      render();
    } catch (error) { window.alert(error.message || 'No se pudo actualizar la conversación.'); }
  }

  function assignConversation(targetId) { return mutateConversation('assign', targetId); }

  function openEmojiDialog() {
    var dialog = document.querySelector('[data-emoji-dialog]'); var wrap = document.querySelector('[data-emoji-content]');
    if (!dialog || !wrap) return; wrap.innerHTML = '';
    ['🙂','😊','🙏','👍','✅','📅','⏰','📍','🦷','✨','💬','📎','📷','💙','🎉','👋'].forEach(function (emoji) {
      var button = node('button', '', emoji); button.type = 'button'; button.setAttribute('aria-label', 'Insertar ' + emoji);
      button.onclick = function () {
        var input = document.querySelector('[name="message"]'); var start = input.selectionStart || input.value.length; var end = input.selectionEnd || start;
        input.value = input.value.slice(0, start) + emoji + input.value.slice(end); input.selectionStart = input.selectionEnd = start + emoji.length;
        scheduleDraftSave(input.value); dialog.close(); input.focus();
      };
      wrap.append(button);
    });
    dialog.showModal();
  }

  function recordingMimeType() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
    return ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/aac', 'audio/mpeg'].find(function (type) { return window.MediaRecorder.isTypeSupported(type); }) || '';
  }

  function renderRecordingButton() {
    var button = document.querySelector('[data-compose-record]'); if (!button) return;
    var active = Boolean(state.recorder && state.recorder.state === 'recording'); button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.textContent = active ? 'Detener ' + Math.max(1, Math.floor((Date.now() - state.recorderStartedAt) / 1000)) + ' s' : 'Nota de voz';
  }

  function releaseRecorder() {
    clearInterval(state.recorderTimer); state.recorderTimer = null;
    if (state.recorderStream) state.recorderStream.getTracks().forEach(function (track) { track.stop(); });
    state.recorderStream = null; state.recorder = null; state.recorderStartedAt = 0; renderRecordingButton();
  }

  function stopVoiceRecording(cancelled) {
    if (!state.recorder || state.recorder.state !== 'recording') return;
    state.recordingCancelled = Boolean(cancelled); state.recorder.stop();
  }

  async function startVoiceRecording() {
    var conversation = selectedConversation(); if (!conversation || conversation.channel !== 'whatsapp' || !canOperate(conversation, 'messages.respond')) return;
    var windowState = liveWhatsappWindow(conversation); if (windowState && !windowState.freeform_allowed) { window.alert('La ventana de WhatsApp venció. Usa una plantilla aprobada.'); return; }
    var mime = recordingMimeType();
    if (!mime || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.alert('Este navegador no puede grabar un formato compatible con WhatsApp. Puedes adjuntar una nota de voz OGG, MP4, AAC o MP3.'); return;
    }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      state.recorderStream = stream; state.recorderChunks = []; state.recordingCancelled = false;
      var recorder = new MediaRecorder(stream, { mimeType: mime }); state.recorder = recorder;
      recorder.ondataavailable = function (event) { if (event.data && event.data.size) state.recorderChunks.push(event.data); };
      recorder.onstop = function () {
        var cancelled = state.recordingCancelled; var chunks = state.recorderChunks.slice(); state.recorderChunks = []; releaseRecorder();
        if (cancelled || !chunks.length) return;
        var type = mime.split(';')[0]; var extension = type === 'audio/ogg' ? 'ogg' : type === 'audio/mp4' ? 'm4a' : type === 'audio/aac' ? 'aac' : 'mp3';
        var file = new File(chunks, 'nota-de-voz-' + Date.now() + '.' + extension, { type: type });
        chooseAttachment(file);
      };
      recorder.start(250); state.recorderStartedAt = Date.now(); renderRecordingButton(); state.recorderTimer = setInterval(renderRecordingButton, 1000);
    } catch (error) { releaseRecorder(); window.alert(error && error.name === 'NotAllowedError' ? 'Permite el acceso al micrófono para grabar una nota de voz.' : 'No se pudo iniciar la grabación de audio.'); }
  }

  function toggleVoiceRecording() {
    if (state.recorder && state.recorder.state === 'recording') stopVoiceRecording(false); else startVoiceRecording();
  }

  async function submitMessage(content, key, pending, extra) {
    var conversationId = state.selectedId;
    try {
      var payload = Object.assign({ action: 'send', type: 'text', conversation_id: conversationId, content: content }, extra || {});
      var data = await request('POST', {}, payload, key, 35000);
      pending.reconciled = true;
      mergeMessages(conversationId, data.message ? [data.message] : [], false);
      var conversation = selectedConversation();
      if (conversation) { conversation.paused = true; conversation.last_message = content; conversation.last_message_at = new Date().toISOString(); }
      render(); requestAnimationFrame(scrollThreadBottom);
    } catch (error) {
      pending.status = error.code === 'send_unknown' || error.code === 'send_in_progress' ? 'unknown' : 'failed';
      pending.error = error.message; renderMessages(false);
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var input = form.elements.message;
    var content = input.value.trim();
    var conversation = selectedConversation();
    if (!conversation || !canOperate(conversation, 'messages.respond')) return;
    var waWindow = liveWhatsappWindow(conversation);
    if (waWindow && !waWindow.freeform_allowed) { openTemplateDialog(); return; }
    if (state.attachment) { sendAttachment(state.attachment); input.value = ''; clearEncryptedDraft(conversation.id); return; }
    if (!content) return;
    var key = uuid();
    var reply = state.replyTo;
    var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: content, reply_to: reply ? { id: reply.id, preview: reply.content || 'Adjunto', type: reply.media_type || 'text' } : null, created_at: new Date().toISOString(), status: 'sending' };
    state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending);
    input.value = ''; clearEncryptedDraft(conversation.id); state.replyTo = null; renderComposerContext(); renderMessages(false); requestAnimationFrame(scrollThreadBottom);
    submitMessage(content, key, pending, reply ? { reply_to_message_id: reply.id } : null);
  }

  function attachmentKind(file) {
    return String(file.type || '').startsWith('image/') ? 'image' : String(file.type || '').startsWith('audio/') ? 'audio' : 'document';
  }

  function chooseAttachment(file) {
    if (!file) return;
    var kind = attachmentKind(file); var max = kind === 'audio' ? 16 : kind === 'image' ? 10 : 25;
    if (file.size > max * 1024 * 1024) { window.alert('El archivo supera el límite de ' + max + ' MB.'); return; }
    var conversation = selectedConversation();
    if (kind === 'audio' && conversation && conversation.channel !== 'whatsapp') { window.alert('Las notas de voz solo están disponibles en WhatsApp.'); return; }
    if (kind === 'document' && conversation && conversation.channel === 'instagram') { window.alert('Instagram no permite enviar documentos.'); return; }
    state.attachment = file; state.replyTo = null; renderComposerContext();
  }

  async function sendAttachment(file) {
    var conversation = selectedConversation(); if (!conversation || !file) return;
    var waWindow = liveWhatsappWindow(conversation); if (waWindow && !waWindow.freeform_allowed) { window.alert('La ventana de WhatsApp venció. Usa una plantilla aprobada.'); return; }
    var kind = attachmentKind(file); var key = uuid(); var previewUrl = kind === 'image' || kind === 'audio' ? URL.createObjectURL(file) : null;
    var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: kind === 'image' ? '📷 Imagen' : kind === 'audio' ? '🎤 Nota de voz' : '📄 ' + file.name, media_type: kind, media_url: previewUrl, created_at: new Date().toISOString(), status: 'sending', file: file };
    state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending); state.attachment = null; renderComposerContext(); renderMessages(false); requestAnimationFrame(scrollThreadBottom);
    try {
      var form = new FormData(); form.append('conversation_id', conversation.id); form.append('kind', kind); form.append('file', file, file.name);
      var data = await requestForm(form, key, 60000); pending.reconciled = true;
      mergeMessages(conversation.id, data.message ? [data.message] : [], false); conversation.paused = true; conversation.last_message = pending.content; conversation.last_message_at = new Date().toISOString(); render(); requestAnimationFrame(scrollThreadBottom);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    } catch (error) { pending.status = error.code === 'send_unknown' || error.code === 'send_in_progress' ? 'unknown' : 'failed'; pending.error = error.message; renderMessages(false); }
  }

  async function sendLocation() {
    var conversation = selectedConversation(); if (!conversation || conversation.channel !== 'whatsapp') { window.alert('La ubicación solo está disponible en WhatsApp.'); return; }
    var waWindow = liveWhatsappWindow(conversation); if (waWindow && !waWindow.freeform_allowed) { window.alert('La ventana de WhatsApp venció. Usa una plantilla aprobada.'); return; }
    if (!navigator.geolocation) { window.alert('Este dispositivo no puede obtener la ubicación.'); return; }
    if (!window.confirm('¿Enviar la ubicación actual del dispositivo como ubicación de la clínica?')) return;
    navigator.geolocation.getCurrentPosition(async function (position) {
      var key = uuid(); var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: '📍 Ubicación de la clínica', media_type: 'location', created_at: new Date().toISOString(), status: 'sending' };
      state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending); renderMessages(false);
      try {
        var data = await request('POST', {}, { action: 'send', type: 'location', conversation_id: conversation.id, latitude: position.coords.latitude, longitude: position.coords.longitude, name: 'Ubicación de la clínica' }, key, 35000);
        pending.reconciled = true; mergeMessages(conversation.id, data.message ? [data.message] : [], false); render(); requestAnimationFrame(scrollThreadBottom);
      } catch (error) { pending.status = error.code === 'send_unknown' ? 'unknown' : 'failed'; pending.error = error.message; renderMessages(false); }
    }, function () { window.alert('No se pudo obtener la ubicación. Revisa el permiso del navegador.'); }, { enableHighAccuracy: true, timeout: 12000 });
  }

  function retryPending(item) {
    item.status = 'sending'; renderMessages(false);
    if (item.file) {
      var conversationId = state.selectedId; var kind = attachmentKind(item.file); var form = new FormData();
      form.append('conversation_id', conversationId); form.append('kind', kind); form.append('file', item.file, item.file.name);
      requestForm(form, item.key, 60000).then(function (data) {
        item.reconciled = true; mergeMessages(conversationId, data.message ? [data.message] : [], false); render(); requestAnimationFrame(scrollThreadBottom);
      }).catch(function (error) { item.status = error.code === 'send_unknown' || error.code === 'send_in_progress' ? 'unknown' : 'failed'; item.error = error.message; renderMessages(false); });
    } else submitMessage(item.content, item.key, item, item.extra || (item.reply_to ? { reply_to_message_id: item.reply_to.id } : null));
  }

  function latestMessageTime() {
    var messages = state.messages[state.selectedId] || [];
    return messages.length ? messages[messages.length - 1].created_at : null;
  }

  async function sync() {
    if (state.polling || !state.syncedAt || !document.getElementById('p-inbox').classList.contains('activa') || document.visibilityState !== 'visible') return;
    state.polling = true;
    var live = document.querySelector('[data-inbox-live]'); if (live) live.dataset.state = 'syncing';
    try {
      var previousUnread = state.conversations.reduce(function (total, item) { return total + (Number(item.unread_count) || 0); }, 0);
      var data = await request('GET', { action: 'sync', since: state.syncedAt }, null, null, 15000);
      mergeConversations(data.conversations || [], false);
      (data.removed_conversation_ids || []).forEach(function (id) {
        state.conversations = state.conversations.filter(function (item) { return item.id !== id; });
        delete state.messages[id]; delete state.pages[id]; delete state.pending[id];
        if (state.selectedId === id) {
          state.selectedId = null;
          document.getElementById('p-inbox').classList.remove('show-thread');
        }
      });
      state.syncedAt = data.synced_at || new Date().toISOString();
      renderList(); renderThreadHeader();
      if (data.truncated) await loadList(true);
      var latest = latestMessageTime();
      if (state.selectedId && latest) await loadThread(state.selectedId, false, latest);
      else if (state.selectedId && (data.conversations || []).some(function (item) { return item.id === state.selectedId; })) await loadThread(state.selectedId, false);
      var currentUnread = state.conversations.reduce(function (total, item) { return total + (Number(item.unread_count) || 0); }, 0);
      if (currentUnread > previousUnread) playInboxNotice();
      if (live) { live.dataset.state = 'online'; live.querySelector('span').textContent = 'Actualizado ahora'; }
    } catch (_) {
      if (live) { live.dataset.state = 'offline'; live.querySelector('span').textContent = 'Reconectando…'; }
    } finally { state.polling = false; }
  }

  function playInboxNotice() {
    if (!state.notificationsEnabled || document.visibilityState !== 'visible') return;
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      var context = new AudioContext(); var oscillator = context.createOscillator(); var gain = context.createGain();
      oscillator.frequency.value = 660; gain.gain.setValueAtTime(0.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.2); oscillator.onended = function () { context.close(); };
    } catch (_) {}
  }

  function renderNotifyButton() {
    var button = document.querySelector('[data-inbox-notify]'); if (!button) return;
    button.setAttribute('aria-pressed', state.notificationsEnabled ? 'true' : 'false');
    button.textContent = state.notificationsEnabled ? 'Avisos activos' : 'Activar avisos';
  }

  function toggleNotifications() {
    state.notificationsEnabled = !state.notificationsEnabled;
    renderNotifyButton(); if (state.notificationsEnabled) playInboxNotice();
  }

  async function loadQuickReplies() {
    if (state.quickRepliesLoading || state.quickRepliesLoaded) return;
    state.quickRepliesLoading = true;
    try { var data = await request('GET', { action: 'quick_replies' }); state.quickReplies = data.quick_replies || []; state.quickRepliesLoaded = true; }
    catch (_) { state.quickReplies = []; }
    finally { state.quickRepliesLoading = false; }
  }

  function renderQuickReplies() {
    var content = document.querySelector('[data-quick-content]'); if (!content) return;
    content.innerHTML = '';
    if (state.quickRepliesLoading) { content.append(node('p', 'smyl-inbox-productivity-state', 'Consultando respuestas…')); return; }
    if (!state.quickReplies.length) { content.append(node('p', 'smyl-inbox-productivity-state', 'Aún no hay respuestas rápidas configuradas en LANA.')); return; }
    state.quickReplies.forEach(function (item) {
      var button = node('button', 'smyl-inbox-quick-row'); button.type = 'button';
      button.append(node('strong', '', '/' + item.shortcut), node('span', '', item.text));
      button.onclick = function () { setComposerText(item.text); document.querySelector('[data-quick-dialog]').close(); };
      content.append(button);
    });
  }

  async function openQuickReplies() {
    var dialog = document.querySelector('[data-quick-dialog]'); if (!dialog) return;
    dialog.showModal(); renderQuickReplies(); await loadQuickReplies(); renderQuickReplies();
  }

  function renderThreadSearchResults() {
    var wrap = document.querySelector('[data-search-results]'); if (!wrap) return; wrap.innerHTML = '';
    if (state.threadSearchLoading) { wrap.append(node('p', 'smyl-inbox-productivity-state', 'Buscando en el historial…')); return; }
    if (!state.threadSearchResults.length) { wrap.append(node('p', 'smyl-inbox-productivity-state', 'Escribe una palabra para localizar mensajes en todo el hilo.')); return; }
    state.threadSearchResults.forEach(function (item) {
      var card = node('article', 'smyl-inbox-search-result');
      card.append(node('strong', '', item.author_type === 'patient' ? 'Paciente' : item.author_type === 'team' ? 'Equipo' : 'SMYL Asistente'));
      card.append(node('time', '', new Date(item.created_at).toLocaleString('es-MX')));
      card.append(node('p', '', item.content || (item.media_type ? 'Adjunto compartido' : 'Mensaje sin texto'))); wrap.append(card);
    });
  }

  function openThreadSearch() {
    if (!state.selectedId) return; state.threadSearchResults = []; state.threadSearchPage = null; renderThreadSearchResults();
    var dialog = document.querySelector('[data-search-dialog]'); dialog.showModal(); setTimeout(function () { dialog.querySelector('[data-thread-search-input]').focus(); }, 0);
  }

  async function searchThread(event) {
    event.preventDefault(); var input = event.currentTarget.querySelector('[data-thread-search-input]'); var query = input.value.trim(); if (query.length < 2) return;
    state.threadSearchLoading = true; renderThreadSearchResults();
    try { var data = await request('GET', { action: 'search', conversation_id: state.selectedId, q: query, limit: 40 }); state.threadSearchResults = data.results || []; state.threadSearchPage = data.page || null; }
    catch (error) { state.threadSearchResults = []; window.alert(error.message || 'No se pudo buscar en el hilo.'); }
    finally { state.threadSearchLoading = false; renderThreadSearchResults(); }
  }

  function firstUrl(value) { var match = String(value || '').match(/https?:\/\/[^\s]+/i); return match ? match[0].replace(/[),.;]+$/, '') : ''; }

  function renderSharedItems() {
    var wrap = document.querySelector('[data-shared-content]'); if (!wrap) return; wrap.innerHTML = '';
    if (state.sharedLoading) { wrap.append(node('p', 'smyl-inbox-productivity-state', 'Consultando biblioteca…')); return; }
    if (!state.sharedItems.length) { wrap.append(node('p', 'smyl-inbox-productivity-state', 'No hay imágenes, documentos o enlaces en este hilo.')); return; }
    state.sharedItems.forEach(function (item) {
      var card = node('article', 'smyl-inbox-shared-item'); var target = item.media_url || firstUrl(item.content); var label = item.media_type === 'image' ? 'Imagen' : item.media_type === 'document' ? 'Documento' : item.media_type === 'audio' ? 'Audio' : 'Enlace';
      if (item.media_type === 'image' && target) { var image = document.createElement('img'); image.src = target; image.alt = item.content || 'Imagen compartida'; image.loading = 'lazy'; card.append(image); }
      card.append(node('strong', '', label), node('span', '', new Date(item.created_at).toLocaleDateString('es-MX')));
      if (item.content) card.append(node('p', '', item.content));
      if (target) { var link = node('a', '', 'Abrir'); link.href = target; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
      wrap.append(card);
    });
  }

  async function openSharedItems() {
    if (!state.selectedId) return; var dialog = document.querySelector('[data-shared-dialog]'); dialog.showModal(); state.sharedLoading = true; state.sharedItems = []; renderSharedItems();
    try { var data = await request('GET', { action: 'shared', conversation_id: state.selectedId, limit: 60 }); state.sharedItems = data.items || []; state.sharedPage = data.page || null; }
    catch (error) { window.alert(error.message || 'No se pudo abrir la biblioteca.'); }
    finally { state.sharedLoading = false; renderSharedItems(); }
  }

  function init() {
    if (!window.ir || document.getElementById('p-inbox')) return;
    TITULOS.inbox = 'Mensajes';
    var page = shell(); document.querySelector('.contenido').append(page);
    var primary = document.querySelector('.pro-primary-nav');
    if (primary) {
      var nav = node('button', 'nav-item', 'Mensajes'); nav.type = 'button'; nav.setAttribute('onclick', "ir('inbox')");
      primary.insertBefore(nav, primary.children[1] || null);
    }
    var mobile = document.querySelector('.pro-mobile-nav');
    if (mobile) { var mobileNav = node('button', 'nav-item', 'Mensajes'); mobileNav.type = 'button'; mobileNav.setAttribute('onclick', "ir('inbox')"); var channelsNav = mobile.querySelector('[onclick="ir(\'conexiones\')"]'); if (channelsNav) channelsNav.before(mobileNav); else mobile.append(mobileNav); }

    page.querySelectorAll('[data-inbox-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.filter = button.dataset.inboxFilter;
        if (['all', 'attention', 'mine'].indexOf(state.filter) !== -1) state.filterPanelOpen = false;
        renderFilterControls();
        loadList(true);
      });
    });
    page.querySelector('[data-inbox-filter-more]').addEventListener('click', toggleInboxFilters);
    var searchTimer = null;
    page.querySelector('[data-inbox-search]').addEventListener('input', function (event) {
      state.search = event.target.value; renderList(); clearTimeout(searchTimer); searchTimer = setTimeout(function () { loadList(true); }, 320);
    });
    page.querySelector('[data-inbox-channel]').addEventListener('change', function (event) { state.channel = event.target.value; loadList(true); });
    page.querySelector('[data-inbox-bulk]').addEventListener('click', function () { state.bulkMode = !state.bulkMode; if (!state.bulkMode) state.bulkSelected.clear(); renderList(); });
    page.querySelector('[data-inbox-refresh]').addEventListener('click', function () { loadList(true); loadOperations(true); if (state.selectedId) loadThread(state.selectedId, false); });
    page.querySelector('[data-inbox-more]').addEventListener('click', function () { loadList(false); });
    page.querySelector('[data-thread-older]').addEventListener('click', function () { loadThread(state.selectedId, true); });
    page.querySelector('[data-thread-jump]').addEventListener('click', scrollThreadBottom);
    page.querySelector('[data-inbox-composer]').addEventListener('submit', sendMessage);
    page.querySelector('[name="message"]').addEventListener('input', function (event) { scheduleDraftSave(event.target.value); });
    page.querySelector('[data-compose-more]').addEventListener('click', toggleComposerTools);
    page.querySelector('[data-compose-tools]').addEventListener('click', function (event) { if (event.target.closest('button')) closeComposerTools(); });
    page.querySelector('[data-compose-emoji]').addEventListener('click', openEmojiDialog);
    page.querySelector('[data-compose-record]').addEventListener('click', toggleVoiceRecording);
    page.querySelector('[data-compose-copilot]').addEventListener('click', function () { requestCopilot('draft'); });
    page.querySelector('[data-compose-quick]').addEventListener('click', openQuickReplies);
    page.querySelector('[data-compose-template]').addEventListener('click', openTemplateDialog);
    page.querySelector('[data-compose-schedule]').addEventListener('click', openScheduleDialog);
    page.querySelector('[data-compose-attach]').addEventListener('click', function () { page.querySelector('[data-compose-file]').click(); });
    page.querySelector('[data-compose-file]').addEventListener('change', function (event) { chooseAttachment(event.target.files && event.target.files[0]); });
    page.querySelector('[data-compose-location]').addEventListener('click', sendLocation);
    page.querySelector('[data-inbox-composer]').addEventListener('dragover', function (event) { event.preventDefault(); event.currentTarget.classList.add('is-dragging'); });
    page.querySelector('[data-inbox-composer]').addEventListener('dragleave', function (event) { event.currentTarget.classList.remove('is-dragging'); });
    page.querySelector('[data-inbox-composer]').addEventListener('drop', function (event) { event.preventDefault(); event.currentTarget.classList.remove('is-dragging'); chooseAttachment(event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]); });
    page.querySelector('[name="message"]').addEventListener('paste', function (event) {
      var files = event.clipboardData && event.clipboardData.files;
      if (files && files.length && String(files[0].type || '').startsWith('image/')) { event.preventDefault(); chooseAttachment(files[0]); }
    });
    page.querySelector('[data-forward-confirm]').addEventListener('click', confirmForward);
    page.querySelector('[data-copilot-resume] form').addEventListener('submit', confirmResume);
    page.querySelector('[data-resume-cancel]').addEventListener('click', function () { page.querySelector('[data-copilot-resume]').close(); });
    page.querySelector('[data-copilot-feedback] form').addEventListener('submit', submitFeedback);
    page.querySelector('[data-feedback-cancel]').addEventListener('click', function () { page.querySelector('[data-copilot-feedback]').close(); });
    page.querySelector('[data-template-dialog] form').addEventListener('submit', sendTemplate);
    page.querySelector('[data-template-select]').addEventListener('change', function (event) { var dialog = event.target.closest('dialog'); renderTemplateFields(event.target, dialog.querySelector('[data-template-preview]'), dialog.querySelector('[data-template-variables]'), 'send'); });
    page.querySelector('[data-template-cancel]').addEventListener('click', function () { page.querySelector('[data-template-dialog]').close(); });
    page.querySelector('[data-schedule-dialog] form').addEventListener('submit', createScheduled);
    page.querySelector('[data-schedule-type]').addEventListener('change', renderScheduleMode);
    page.querySelector('[data-schedule-template]').addEventListener('change', renderScheduleMode);
    page.querySelector('[data-schedule-cancel]').addEventListener('click', function () { page.querySelector('[data-schedule-dialog]').close(); });
    page.querySelector('[data-availability-form]').addEventListener('submit', searchAvailability);
    page.querySelector('[data-availability-service]').addEventListener('change', filterAvailabilityProfessionals);
    page.querySelector('[data-availability-close]').addEventListener('click', function () { page.querySelector('[data-availability-dialog]').close(); });
    page.querySelector('[data-availability-prepare]').addEventListener('click', prepareAvailabilityOptions);
    page.querySelector('[data-inbox-operations]').addEventListener('click', openOperations);
    page.querySelector('[data-inbox-notify]').addEventListener('click', toggleNotifications);
    page.querySelector('[data-operations-close]').addEventListener('click', function () { page.querySelector('[data-operations-dialog]').close(); });
    page.querySelector('[data-operations-refresh]').addEventListener('click', function () { loadOperations(true); });
    page.querySelector('[data-pilot-report]').addEventListener('click', openPilotReport);
    page.querySelector('[data-pilot-report-close]').addEventListener('click', function () { page.querySelector('[data-pilot-report-dialog]').close(); });
    page.querySelector('[data-pilot-report-back]').addEventListener('click', function () { page.querySelector('[data-pilot-report-dialog]').close(); openOperations(); });
    page.querySelector('[data-pilot-report-print]').addEventListener('click', printPilotReport);
    page.querySelector('[data-inbox-back]').addEventListener('click', function () { page.classList.remove('show-thread'); state.contextOpen = false; renderContext(); });
    page.querySelector('[data-inbox-context]').addEventListener('click', function () { state.contextOpen = true; renderContext(); });
    page.querySelector('[data-thread-details]').addEventListener('click', function () { closeThreadMenu(); state.contextOpen = true; renderContext(); });
    page.querySelector('[data-thread-mode]').addEventListener('click', function () { var conversation = selectedConversation(); if (!conversation) return; conversation.paused ? prepareResume() : mutateConversation('pause'); });
    page.querySelector('[data-thread-more]').addEventListener('click', toggleThreadMenu);
    page.querySelector('[data-thread-pin]').addEventListener('click', function () { closeThreadMenu(); var conversation = selectedConversation(); if (conversation) mutateConversation(conversation.pinned ? 'unpin' : 'pin'); });
    page.querySelector('[data-thread-search]').addEventListener('click', function () { closeThreadMenu(); openThreadSearch(); });
    page.querySelector('[data-thread-shared]').addEventListener('click', function () { closeThreadMenu(); openSharedItems(); });
    page.querySelector('[data-thread-search-form]').addEventListener('submit', searchThread);
    page.querySelector('[data-search-close]').addEventListener('click', function () { page.querySelector('[data-search-dialog]').close(); });
    page.querySelector('[data-shared-close]').addEventListener('click', function () { page.querySelector('[data-shared-dialog]').close(); });
    page.querySelector('[data-quick-close]').addEventListener('click', function () { page.querySelector('[data-quick-dialog]').close(); });
    page.querySelector('[data-emoji-close]').addEventListener('click', function () { page.querySelector('[data-emoji-dialog]').close(); });
    page.querySelector('[data-context-close]').addEventListener('click', function () { state.contextOpen = false; renderContext(); });
    page.querySelector('[data-thread-body]').addEventListener('scroll', function () { if (atThreadBottom()) page.querySelector('[data-thread-jump]').hidden = true; });

    var previous = window.ir;
    window.ir = function (route) {
      previous(route);
      if (route === 'inbox') {
        if (!state.conversations.length) { loadList(true); loadTeam(); loadStages(); loadQuickReplies(); loadOperations(true); }
        else { sync(); loadOperations(false); }
      } else { if (state.recorder && state.recorder.state === 'recording') stopVoiceRecording(true); state.contextOpen = false; renderContext(); }
    };
    renderOperationsChip(); renderNotifyButton();
    setInterval(sync, 5000);
    setInterval(function () {
      if (document.visibilityState === 'visible' && document.getElementById('p-inbox').classList.contains('activa')) loadOperations(true);
    }, 60000);
    setInterval(function () { if (state.selectedId) { renderWhatsappWindow(); renderContext(); } }, 60000);
  }

  window.SmylInbox = {
    open: function (conversationId) { window.ir('inbox'); openConversation(conversationId); },
    openOperations: function () { window.ir('inbox'); openOperations(); },
    refresh: function () { loadList(true); },
    loadOperations: loadOperations,
    getOperationsSummary: operationsSummary,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
