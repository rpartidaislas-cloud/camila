(function () {
  'use strict';

  var state = {
    conversations: [], total: 0, offset: 0, limit: 30, hasMore: false,
    filter: 'all', channel: '', search: '', selectedId: null,
    messages: {}, pages: {}, pending: {}, loadingList: false, loadingThread: false,
    listError: '', threadError: '', syncedAt: null, actor: null, team: [],
    threadController: null, contextOpen: false, polling: false,
    replyTo: null, attachment: null, clinical: {}, clinicalLoading: {},
    copilot: {}, copilotLoading: {},
    templates: [], templatesLoaded: false, templatesLoading: false,
    scheduled: {}, scheduledLoading: {},
    operations: null, operationsLoading: false, operationsError: '',
  };

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
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
        '<div><span class="smyl-inbox-eyebrow">ATENCIÓN OMNICANAL</span><h1>Mensajes</h1><p>WhatsApp, Messenger e Instagram atendidos por SMYL Asistente y tu equipo.</p></div>' +
        '<div class="smyl-inbox-top-actions"><button type="button" class="smyl-inbox-health" data-inbox-operations data-state="loading"><i></i><span>Revisando operación</span></button><div class="smyl-inbox-live" data-inbox-live><i></i><span>Sincronización segura</span></div></div>' +
      '</header>' +
      '<div class="smyl-inbox-workspace">' +
        '<aside class="smyl-inbox-list-pane" aria-label="Bandeja de conversaciones">' +
          '<div class="smyl-inbox-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input type="search" placeholder="Buscar en esta bandeja" aria-label="Buscar conversación" data-inbox-search></div>' +
          '<div class="smyl-inbox-filters" role="tablist" aria-label="Filtrar conversaciones">' +
            '<button type="button" data-inbox-filter="all" class="active">Todas</button><button type="button" data-inbox-filter="unread">Sin leer</button><button type="button" data-inbox-filter="attention">Por atender</button><button type="button" data-inbox-filter="mine">Mías</button>' +
          '</div>' +
          '<div class="smyl-inbox-list-tools"><select data-inbox-channel aria-label="Filtrar por canal"><option value="">Todos los canales</option><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option><option value="instagram">Instagram</option></select><button type="button" data-inbox-refresh aria-label="Actualizar bandeja">Actualizar</button></div>' +
          '<div class="smyl-inbox-list" data-inbox-list></div>' +
          '<button type="button" class="smyl-inbox-more" data-inbox-more hidden>Cargar más conversaciones</button>' +
        '</aside>' +
        '<main class="smyl-inbox-thread-pane" data-inbox-thread-pane>' +
          '<div class="smyl-inbox-thread-empty" data-inbox-thread-empty><div class="smyl-inbox-empty-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg></div><h2>Selecciona una conversación</h2><p>El historial se sincroniza de forma segura y se presenta aquí, dentro de SMYL.</p></div>' +
          '<div class="smyl-inbox-thread" data-inbox-thread hidden>' +
            '<header class="smyl-inbox-thread-head"><button type="button" class="smyl-inbox-back" data-inbox-back aria-label="Volver a la bandeja"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"></path></svg></button><div class="smyl-inbox-avatar" data-thread-avatar></div><div class="smyl-inbox-thread-person"><strong data-thread-name></strong><span data-thread-meta></span></div><button type="button" class="smyl-inbox-control-button" data-inbox-context>Control de atención</button></header>' +
            '<div class="smyl-inbox-thread-body" data-thread-body><button type="button" class="smyl-inbox-older" data-thread-older hidden>Cargar mensajes anteriores</button><div data-thread-messages></div></div>' +
            '<button type="button" class="smyl-inbox-jump" data-thread-jump hidden>Ir al final</button>' +
            '<section class="smyl-inbox-copilot-draft" data-copilot-draft hidden></section>' +
            '<form class="smyl-inbox-composer" data-inbox-composer><label for="smyl-inbox-message">Responder como equipo</label><div class="smyl-inbox-window" data-wa-window hidden></div><div class="smyl-inbox-compose-context" data-compose-context hidden></div><div class="smyl-inbox-compose-main"><div class="smyl-inbox-compose-tools"><button type="button" data-compose-copilot aria-label="Sugerir respuesta con SMYL Copilot">IA</button><button type="button" data-compose-template aria-label="Enviar plantilla aprobada de WhatsApp">TPL</button><button type="button" data-compose-schedule aria-label="Programar mensaje de WhatsApp">◷</button><button type="button" data-compose-attach aria-label="Adjuntar foto, documento o audio">＋</button><button type="button" data-compose-location aria-label="Enviar ubicación actual">⌖</button><input type="file" data-compose-file accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,.doc,.docx,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg" hidden></div><textarea id="smyl-inbox-message" name="message" rows="2" maxlength="4000" placeholder="Escribe una respuesta…"></textarea><button type="submit" class="btn btn-primary" data-compose-send>Enviar</button></div><small>Copilot sólo prepara borradores. Nada se envía hasta que tú lo revises.</small></form>' +
          '</div>' +
        '</main>' +
        '<button type="button" class="smyl-inbox-context-scrim" data-context-close aria-label="Cerrar control de atención"></button>' +
        '<aside class="smyl-inbox-context" data-inbox-context-panel aria-label="Control de atención"><div data-inbox-context-content></div></aside>' +
        '<dialog class="smyl-inbox-forward-dialog" data-inbox-forward><form method="dialog"><span class="smyl-inbox-eyebrow">REENVIAR MENSAJE</span><h2>Elige una conversación</h2><p>El contenido se enviará de nuevo por el canal del destinatario.</p><select data-forward-target aria-label="Conversación de destino"></select><div><button value="cancel" class="btn btn-secondary">Cancelar</button><button value="confirm" class="btn btn-primary" data-forward-confirm>Reenviar</button></div></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog" data-copilot-resume><form><span class="smyl-inbox-eyebrow">REANUDAR CON CONTEXTO</span><h2>Revisa lo que recibirá el asistente</h2><p>Copilot resume el episodio humano. Corrige cualquier inferencia antes de reactivar la atención automática.</p><textarea data-resume-summary maxlength="2000" rows="7" aria-label="Resumen para reanudar"></textarea><div class="smyl-inbox-copilot-notes" data-resume-notes></div><footer><button type="button" class="btn btn-secondary" data-resume-cancel>Cancelar</button><button type="submit" class="btn btn-primary" data-resume-confirm>Reanudar asistente</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog" data-copilot-feedback><form><span class="smyl-inbox-eyebrow">CALIDAD DE IA</span><h2>Evalúa esta respuesta</h2><p>Tu comentario queda para revisión; no modifica ni publica la capacitación automáticamente.</p><label>Resultado<select data-feedback-rating required><option value="helpful">Útil</option><option value="needs_improvement">Necesita mejora</option><option value="unsafe">Insegura o fuera de límites</option></select></label><label>¿Qué mejorarías?<textarea data-feedback-comment maxlength="1000" rows="3"></textarea></label><label>Respuesta ideal · opcional<textarea data-feedback-ideal maxlength="4000" rows="4"></textarea></label><footer><button type="button" class="btn btn-secondary" data-feedback-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Guardar evaluación</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog smyl-inbox-template-dialog" data-template-dialog><form><span class="smyl-inbox-eyebrow">WHATSAPP · PLANTILLA APROBADA</span><h2>Volver a contactar</h2><p>Meta permite estas plantillas incluso cuando la ventana de 24 horas ya venció.</p><label>Plantilla<select data-template-select required></select></label><div class="smyl-inbox-template-preview" data-template-preview></div><div data-template-variables></div><footer><button type="button" class="btn btn-secondary" data-template-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Enviar plantilla</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog smyl-inbox-schedule-dialog" data-schedule-dialog><form><span class="smyl-inbox-eyebrow">WHATSAPP · ENVÍO PROGRAMADO</span><h2>Programar seguimiento</h2><p>El envío se procesa una sola vez. Si el texto libre quedaría fuera de la ventana, usa una plantilla aprobada.</p><label>Fecha y hora<input type="datetime-local" data-schedule-at required></label><label>Tipo<select data-schedule-type><option value="text">Texto libre</option><option value="template">Plantilla aprobada</option></select></label><label data-schedule-text-wrap>Mensaje<textarea data-schedule-text maxlength="4000" rows="4"></textarea></label><div data-schedule-template-wrap hidden><label>Plantilla<select data-schedule-template></select></label><div class="smyl-inbox-template-preview" data-schedule-preview></div><div data-schedule-variables></div></div><footer><button type="button" class="btn btn-secondary" data-schedule-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Programar</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-operations-dialog" data-operations-dialog><header><div><span class="smyl-inbox-eyebrow">OPERACIÓN Y PILOTO</span><h2>Estado del Inbox</h2><p>Métricas del tenant, consumo y bloqueos que deben resolverse antes del piloto.</p></div><button type="button" data-operations-close aria-label="Cerrar estado operativo">Cerrar</button></header><div data-operations-content></div><footer><span>La activación del piloto siempre es manual.</span><button type="button" class="btn btn-secondary" data-operations-refresh>Actualizar estado</button></footer></dialog>' +
      '</div>';
    return page;
  }

  function mergeConversations(items, replace) {
    var map = new Map((replace ? [] : state.conversations).map(function (item) { return [item.id, item]; }));
    (items || []).forEach(function (item) { map.set(item.id, Object.assign({}, map.get(item.id) || {}, item)); });
    state.conversations = Array.from(map.values()).sort(function (a, b) {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
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
      if (query && !(item.contact_name + ' ' + item.last_message).toLocaleLowerCase('es-MX').includes(query)) return false;
      return true;
    });
  }

  function renderList() {
    var list = document.querySelector('[data-inbox-list]');
    var more = document.querySelector('[data-inbox-more]');
    if (!list) return;
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
    if (!visible.length) {
      var empty = node('div', 'smyl-inbox-list-state');
      empty.append(node('strong', '', 'No hay conversaciones aquí'), node('p', '', 'Prueba otro filtro o espera un mensaje nuevo de tus canales.'));
      list.append(empty);
    }
    visible.forEach(function (item) {
      var button = node('button', 'smyl-inbox-row' + (state.selectedId === item.id ? ' active' : ''));
      button.type = 'button'; button.dataset.conversationId = item.id;
      if (state.selectedId === item.id) button.setAttribute('aria-current', 'true');
      var avatar = node('span', 'smyl-inbox-avatar', initials(item.contact_name)); avatar.dataset.channel = item.channel;
      var copy = node('span', 'smyl-inbox-row-copy');
      var top = node('span', 'smyl-inbox-row-top'); top.append(node('strong', '', item.contact_name), node('time', '', timeLabel(item.last_message_at)));
      var preview = node('span', 'smyl-inbox-preview', item.last_message || 'Conversación sin vista previa');
      var meta = node('span', 'smyl-inbox-row-meta');
      meta.append(node('span', 'smyl-inbox-channel', channelLabel(item.channel)));
      if (item.paused) meta.append(node('span', 'smyl-inbox-state is-paused', 'Atención humana'));
      else meta.append(node('span', 'smyl-inbox-state', 'Asistente activo'));
      if (item.assignment) meta.append(node('span', 'smyl-inbox-assignee', item.assignment.name));
      if (item.needs_human) meta.append(node('span', 'smyl-inbox-attention', 'Por atender'));
      copy.append(top, preview, meta);
      button.append(avatar, copy);
      if (item.unread_count) button.append(node('span', 'smyl-inbox-unread', String(Math.min(99, item.unread_count))));
      button.addEventListener('click', function () { openConversation(item.id); });
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
    use.onclick = function () { var input = document.querySelector('[name="message"]'); input.value = result.draft || ''; input.focus(); delete state.copilot[conversationId]; renderCopilotDraft(); };
    var discard = node('button', 'btn btn-secondary btn-sm', 'Descartar'); discard.type = 'button'; discard.onclick = function () { delete state.copilot[conversationId]; renderCopilotDraft(); };
    actions.append(discard, use); panel.append(actions);
  }

  async function requestCopilot(mode) {
    var conversation = selectedConversation();
    if (!conversation || !conversation.can_operate || state.copilotLoading[conversation.id]) return null;
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
    state.conversations.filter(function (conversation) { return conversation.id !== state.selectedId && conversation.can_operate; }).forEach(function (conversation) {
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
        [['Responder', function () { state.replyTo = item; state.attachment = null; renderComposerContext(); document.querySelector('[name="message"]').focus(); }], [item.starred ? 'Quitar estrella' : 'Destacar', function () { mutateMessage(item, item.starred ? 'unstar' : 'star'); }], ['Reenviar', function () { openForward(item); }], ['Eliminar', function () { mutateMessage(item, 'delete'); }]].forEach(function (action) { var button = node('button', '', action[0]); button.type = 'button'; button.onclick = action[1]; actions.append(button); });
        if (item.media_type === 'image') { var clinical = node('button', 'is-clinical', 'Enviar a revisión clínica'); clinical.type = 'button'; clinical.onclick = function () { linkClinicalImage(item); }; actions.append(clinical); }
        if (item.author_type === 'assistant') { var feedback = node('button', 'is-copilot', 'Evaluar IA'); feedback.type = 'button'; feedback.onclick = function () { openFeedback(item); }; actions.append(feedback); }
        bubble.append(actions);
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
    var canOperate = Boolean(conversation && conversation.can_operate);
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
    var copilot = form.querySelector('[data-compose-copilot]'); var template = form.querySelector('[data-compose-template]');
    var schedule = form.querySelector('[data-compose-schedule]');
    input.disabled = !canOperate || !freeformAllowed; send.disabled = !canOperate || !freeformAllowed;
    attach.disabled = !canOperate || !freeformAllowed; location.disabled = !canOperate || !freeformAllowed || !isWhatsapp;
    copilot.disabled = !canOperate || !freeformAllowed;
    template.hidden = !isWhatsapp; template.disabled = !canOperate;
    schedule.hidden = !isWhatsapp; schedule.disabled = !canOperate;
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
    var conversation = selectedConversation(); if (!conversation || conversation.channel !== 'whatsapp' || !conversation.can_operate) return;
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
    var conversation = selectedConversation(); if (!conversation || conversation.channel !== 'whatsapp' || !conversation.can_operate) return;
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

  function metricCard(label, value, note) {
    var card = node('div', 'smyl-inbox-operations-metric');
    card.append(node('span', '', label), node('strong', '', String(value)));
    if (note) card.append(node('small', '', note));
    return card;
  }

  function renderOperations() {
    renderOperationsChip();
    var content = document.querySelector('[data-operations-content]');
    if (!content) return;
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
    var summary = node('section', 'smyl-inbox-operations-summary is-' + (health.status || 'attention'));
    summary.append(node('strong', '', health.status === 'healthy' ? 'Operación estable' : health.status === 'action_required' ? 'Hay bloqueos antes del piloto' : 'Hay puntos por revisar'));
    summary.append(node('p', '', alerts.length ? alerts.length + (alerts.length === 1 ? ' señal operativa activa.' : ' señales operativas activas.') : 'No hay alertas operativas abiertas.'));
    content.append(summary);

    var grid = node('section', 'smyl-inbox-operations-grid');
    grid.append(
      metricCard('Por atender', metrics.needs_human || 0, (metrics.conversations || 0) + ' conversaciones'),
      metricCard('Enviados', metrics.messages_sent_24h || 0, 'Últimas 24 horas'),
      metricCard('Reintentando', metrics.scheduled_retrying || 0, 'Automático y acotado'),
      metricCard('Cola de fallos', metrics.dead_letters || 0, 'Requieren revisión')
    );
    content.append(grid);

    if (alerts.length) {
      var alertSection = node('section', 'smyl-inbox-operations-section'); alertSection.append(node('h3', '', 'Alertas activas'));
      alerts.forEach(function (item) {
        var row = node('div', 'smyl-inbox-operation-alert is-' + item.severity);
        row.append(node('strong', '', item.severity === 'critical' ? 'Bloqueo' : 'Revisión'), node('p', '', item.message || 'Revisa esta señal operativa.'));
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

    var pilot = operations.pilot || {}; var pilotSection = node('section', 'smyl-inbox-operations-section smyl-inbox-pilot');
    pilotSection.append(node('h3', '', 'Puerta del piloto'));
    pilotSection.append(node('p', '', pilot.readiness === 'ready' ? 'La configuración técnica está lista para iniciar una validación controlada con una clínica.' : 'Resuelve los puntos pendientes antes de activar una clínica piloto.'));
    var checklist = node('div', 'smyl-inbox-pilot-checks');
    (pilot.checks || []).forEach(function (item) { var row = node('div', item.passed ? 'is-ready' : 'is-blocked'); row.append(node('i', '', item.passed ? 'Listo' : 'Pendiente'), node('span', '', item.label)); checklist.append(row); });
    pilotSection.append(checklist); content.append(pilotSection);
  }

  async function loadOperations(force) {
    if (state.operationsLoading || (state.operations && !force)) { renderOperations(); return; }
    state.operationsLoading = true; state.operationsError = ''; renderOperations();
    try { state.operations = await request('GET', { action: 'operations' }, null, null, 20000); }
    catch (error) { state.operationsError = error.message || 'No se pudo calcular la salud operativa.'; }
    finally { state.operationsLoading = false; renderOperations(); }
  }

  function openOperations() {
    var dialog = document.querySelector('[data-operations-dialog]'); if (!dialog) return;
    renderOperations(); dialog.showModal(); loadOperations(true);
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

    var status = node('section', 'smyl-inbox-context-card');
    status.append(node('h3', '', 'Responsable'));
    if (state.actor && state.actor.role === 'owner') {
      var select = document.createElement('select'); select.setAttribute('aria-label', 'Asignar conversación');
      var none = document.createElement('option'); none.value = ''; none.textContent = 'Sin asignar'; select.append(none);
      state.team.forEach(function (member) { var option = document.createElement('option'); option.value = member.id; option.textContent = member.name; select.append(option); });
      select.value = conversation.assignment && conversation.assignment.source === 'smyl' ? conversation.assignment.actor_id : '';
      select.disabled = !conversation.can_operate && (!state.actor || state.actor.role !== 'owner');
      select.onchange = function () { if (select.value) assignConversation(select.value); else mutateConversation('release'); };
      status.append(select);
    } else {
      status.append(node('p', '', conversation.assignment ? conversation.assignment.name : 'Sin asignar'));
      var own = conversation.assignment && state.actor && conversation.assignment.actor_id === state.actor.id;
      var assignmentButton = node('button', 'btn btn-secondary btn-sm', own ? 'Liberar conversación' : 'Tomar conversación');
      assignmentButton.type = 'button'; assignmentButton.disabled = !conversation.can_operate; assignmentButton.onclick = function () { own ? mutateConversation('release') : assignConversation(state.actor.id); };
      status.append(assignmentButton);
    }
    wrap.append(status);

    var assistant = node('section', 'smyl-inbox-context-card'); assistant.append(node('h3', '', 'SMYL Asistente'));
    assistant.append(node('p', '', conversation.paused ? 'Pausado. El equipo atiende este hilo.' : 'Activo. SMYL Asistente puede responder según su capacitación.'));
    var toggle = node('button', conversation.paused ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm', conversation.paused ? (state.copilotLoading[conversation.id] === 'summary' ? 'Preparando contexto…' : 'Preparar reanudación') : 'Pausar y tomar control');
    toggle.type = 'button'; toggle.disabled = !conversation.can_operate || Boolean(state.copilotLoading[conversation.id]); toggle.onclick = function () { conversation.paused ? prepareResume() : mutateConversation('pause'); };
    assistant.append(toggle); wrap.append(assistant);

    if (conversation.channel === 'whatsapp') {
      var windowState = liveWhatsappWindow(conversation); var waCard = node('section', 'smyl-inbox-context-card smyl-inbox-wa-card');
      waCard.append(node('h3', '', 'Ventana de WhatsApp'));
      var windowCopy = windowState.status === 'expired'
        ? 'Vencida. Solo una plantilla UTILITY aprobada puede iniciar el contacto.'
        : (windowState.status === 'expiring' ? 'Vence en ' : 'Abierta por ') + durationLabel(windowState.remaining_seconds) + '.';
      waCard.append(node('p', 'is-' + windowState.status, windowCopy));
      var waActions = node('div', 'smyl-inbox-context-actions');
      var templateButton = node('button', 'btn btn-secondary btn-sm', 'Usar plantilla'); templateButton.type = 'button'; templateButton.disabled = !conversation.can_operate; templateButton.onclick = openTemplateDialog;
      var scheduleButton = node('button', 'btn btn-secondary btn-sm', 'Programar'); scheduleButton.type = 'button'; scheduleButton.disabled = !conversation.can_operate; scheduleButton.onclick = openScheduleDialog;
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
      var saveAutomationButton = node('button', 'btn btn-secondary btn-sm', 'Guardar reglas'); saveAutomationButton.type = 'button'; saveAutomationButton.disabled = !conversation.can_operate; saveAutomationButton.onclick = function () { saveAutomation(hoursSelect.value, windowSelect.value); };
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
      var newScheduled = node('button', 'btn btn-secondary btn-sm', 'Programar seguimiento'); newScheduled.type = 'button'; newScheduled.disabled = !conversation.can_operate; newScheduled.onclick = openScheduleDialog; scheduledCard.append(newScheduled); wrap.append(scheduledCard);
    }

    var copilot = node('section', 'smyl-inbox-context-card smyl-inbox-copilot-card');
    copilot.append(node('h3', '', 'SMYL Copilot'), node('p', '', 'Prepara borradores y resúmenes con la capacitación publicada. Nunca envía ni ejecuta acciones por sí solo.'));
    var suggest = node('button', 'btn btn-secondary btn-sm', state.copilotLoading[conversation.id] === 'draft' ? 'Preparando borrador…' : 'Sugerir respuesta');
    suggest.type = 'button'; suggest.disabled = !conversation.can_operate || Boolean(state.copilotLoading[conversation.id]); suggest.onclick = function () { requestCopilot('draft'); };
    copilot.append(suggest); wrap.append(copilot);

    if (conversation.needs_human) {
      var attention = node('section', 'smyl-inbox-context-card is-attention');
      attention.append(node('h3', '', 'Intervención solicitada'), node('p', '', 'El asistente marcó esta conversación para seguimiento humano. Resolverla no reactiva la IA.'));
      var resolve = node('button', 'btn btn-primary btn-sm', 'Marcar solicitud resuelta'); resolve.type = 'button'; resolve.disabled = !conversation.can_operate; resolve.onclick = function () { mutateConversation('resolve'); };
      attention.append(resolve); wrap.append(attention);
    }

    var clinical = node('section', 'smyl-inbox-context-card smyl-inbox-ficha');
    clinical.append(node('h3', '', 'Ficha 360'));
    var ficha = state.clinical[conversation.id];
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
      var openRecord = node('button', 'btn btn-secondary btn-sm', 'Abrir expediente'); openRecord.type = 'button'; openRecord.onclick = function () { if (window.SmylLanaHandoff) window.SmylLanaHandoff.open(conversation.id); }; clinical.append(openRecord);
    } else {
      clinical.append(node('p', '', 'Confirma paciente y caso antes de incorporar fotografías a la revisión clínica.'));
      var record = node('button', 'btn btn-secondary btn-sm', 'Preparar expediente'); record.type = 'button'; record.onclick = function () { if (window.SmylLanaHandoff) window.SmylLanaHandoff.open(conversation.id); };
      clinical.append(record);
    }
    wrap.append(clinical);
  }

  function renderThreadHeader() {
    var conversation = selectedConversation();
    var empty = document.querySelector('[data-inbox-thread-empty]');
    var thread = document.querySelector('[data-inbox-thread]');
    if (!conversation) { if (empty) empty.hidden = false; if (thread) thread.hidden = true; renderContext(); return; }
    empty.hidden = true; thread.hidden = false;
    document.querySelector('[data-thread-avatar]').textContent = initials(conversation.contact_name);
    document.querySelector('[data-thread-avatar]').dataset.channel = conversation.channel;
    document.querySelector('[data-thread-name]').textContent = conversation.contact_name;
    document.querySelector('[data-thread-meta]').textContent = channelLabel(conversation.channel) + ' · ' + (conversation.paused ? 'Atención humana' : 'Asistente activo');
    var composer = document.querySelector('[data-inbox-composer]');
    Array.from(composer.elements).forEach(function (control) { control.disabled = !conversation.can_operate; });
    renderComposerContext(); renderWhatsappWindow(); renderContext();
  }

  function render() {
    renderList(); renderThreadHeader(); renderMessages(false); renderCopilotDraft();
  }

  async function loadTeam() {
    try { var data = await request('GET', { action: 'team' }); state.team = data.members || []; renderContext(); } catch (_) {}
  }

  async function loadClinicalContext(conversationId) {
    if (!conversationId) return;
    state.clinicalLoading[conversationId] = true; renderContext();
    try { state.clinical[conversationId] = await request('GET', { action: 'clinical_context', conversation_id: conversationId }); }
    catch (_) { state.clinical[conversationId] = { linked: false, unavailable: true }; }
    finally { state.clinicalLoading[conversationId] = false; if (state.selectedId === conversationId) renderContext(); }
  }

  async function loadList(reset) {
    if (state.loadingList) return;
    state.loadingList = true; state.listError = '';
    if (reset) { state.offset = 0; state.hasMore = false; }
    renderList();
    try {
      var data = await request('GET', { action: 'list', filter: state.filter, channel: state.channel, limit: state.limit, offset: state.offset });
      state.actor = data.actor || state.actor;
      mergeConversations(data.conversations || [], reset);
      state.total = data.page && Number(data.page.total) || state.conversations.length;
      state.hasMore = Boolean(data.page && data.page.has_more);
      if (reset || !state.syncedAt) state.syncedAt = data.synced_at || new Date().toISOString();
      if (!reset) state.offset += (data.conversations || []).length;
      else state.offset = (data.conversations || []).length;
    } catch (error) { state.listError = error.message; }
    finally { state.loadingList = false; renderList(); renderContext(); }
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
    state.selectedId = id; state.contextOpen = false; state.threadError = ''; state.replyTo = null; state.attachment = null;
    document.getElementById('p-inbox').classList.add('show-thread');
    render();
    loadClinicalContext(id); loadScheduled(id); await loadThread(id, false);
    var conversation = selectedConversation();
    if (conversation && conversation.unread_count) {
      try {
        await request('POST', {}, { action: 'read', conversation_id: id }, uuid());
        conversation.unread_count = 0; renderList();
      } catch (_) {}
    }
  }

  async function mutateConversation(action, targetId) {
    var conversation = selectedConversation();
    if (!conversation) return;
    try {
      var payload = { action: action, conversation_id: conversation.id };
      if (targetId) payload.target_actor_id = targetId;
      var data = await request('POST', {}, payload, uuid());
      conversation.paused = Boolean(data.paused);
      conversation.needs_human = Boolean(data.needs_human);
      conversation.unread_count = Number(data.unread_count) || 0;
      conversation.assignment = data.assigned_actor_id
        ? { source: 'smyl', actor_id: data.assigned_actor_id, name: data.assigned_actor_name || 'Miembro de SMYL' }
        : (data.legacy_assigned ? { source: 'lana', actor_id: null, name: 'Asignada previamente' } : null);
      conversation.can_operate = true;
      render();
    } catch (error) { window.alert(error.message || 'No se pudo actualizar la conversación.'); }
  }

  function assignConversation(targetId) { return mutateConversation('assign', targetId); }

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
    if (!conversation || !conversation.can_operate) return;
    var waWindow = liveWhatsappWindow(conversation);
    if (waWindow && !waWindow.freeform_allowed) { openTemplateDialog(); return; }
    if (state.attachment) { sendAttachment(state.attachment); input.value = ''; return; }
    if (!content) return;
    var key = uuid();
    var reply = state.replyTo;
    var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: content, reply_to: reply ? { id: reply.id, preview: reply.content || 'Adjunto', type: reply.media_type || 'text' } : null, created_at: new Date().toISOString(), status: 'sending' };
    state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending);
    input.value = ''; state.replyTo = null; renderComposerContext(); renderMessages(false); requestAnimationFrame(scrollThreadBottom);
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
      if (live) { live.dataset.state = 'online'; live.querySelector('span').textContent = 'Actualizado ahora'; }
    } catch (_) {
      if (live) { live.dataset.state = 'offline'; live.querySelector('span').textContent = 'Reconectando…'; }
    } finally { state.polling = false; }
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
    if (mobile) { var mobileNav = node('button', 'nav-item', 'Mensajes'); mobileNav.type = 'button'; mobileNav.setAttribute('onclick', "ir('inbox')"); mobile.append(mobileNav); }

    page.querySelectorAll('[data-inbox-filter]').forEach(function (button) {
      button.addEventListener('click', function () {
        state.filter = button.dataset.inboxFilter;
        page.querySelectorAll('[data-inbox-filter]').forEach(function (item) { item.classList.toggle('active', item === button); });
        loadList(true);
      });
    });
    page.querySelector('[data-inbox-search]').addEventListener('input', function (event) { state.search = event.target.value; renderList(); });
    page.querySelector('[data-inbox-channel]').addEventListener('change', function (event) { state.channel = event.target.value; loadList(true); });
    page.querySelector('[data-inbox-refresh]').addEventListener('click', function () { loadList(true); loadOperations(true); if (state.selectedId) loadThread(state.selectedId, false); });
    page.querySelector('[data-inbox-more]').addEventListener('click', function () { loadList(false); });
    page.querySelector('[data-thread-older]').addEventListener('click', function () { loadThread(state.selectedId, true); });
    page.querySelector('[data-thread-jump]').addEventListener('click', scrollThreadBottom);
    page.querySelector('[data-inbox-composer]').addEventListener('submit', sendMessage);
    page.querySelector('[data-compose-copilot]').addEventListener('click', function () { requestCopilot('draft'); });
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
    page.querySelector('[data-inbox-operations]').addEventListener('click', openOperations);
    page.querySelector('[data-operations-close]').addEventListener('click', function () { page.querySelector('[data-operations-dialog]').close(); });
    page.querySelector('[data-operations-refresh]').addEventListener('click', function () { loadOperations(true); });
    page.querySelector('[data-inbox-back]').addEventListener('click', function () { page.classList.remove('show-thread'); state.contextOpen = false; renderContext(); });
    page.querySelector('[data-inbox-context]').addEventListener('click', function () { state.contextOpen = true; renderContext(); });
    page.querySelector('[data-context-close]').addEventListener('click', function () { state.contextOpen = false; renderContext(); });
    page.querySelector('[data-thread-body]').addEventListener('scroll', function () { if (atThreadBottom()) page.querySelector('[data-thread-jump]').hidden = true; });

    var previous = window.ir;
    window.ir = function (route) {
      previous(route);
      if (route === 'inbox') {
        if (!state.conversations.length) { loadList(true); loadTeam(); loadOperations(true); }
        else { sync(); loadOperations(false); }
      } else { state.contextOpen = false; renderContext(); }
    };
    renderOperationsChip();
    setInterval(sync, 5000);
    setInterval(function () {
      if (document.visibilityState === 'visible' && document.getElementById('p-inbox').classList.contains('activa')) loadOperations(true);
    }, 60000);
    setInterval(function () { if (state.selectedId) { renderWhatsappWindow(); renderContext(); } }, 60000);
  }

  window.SmylInbox = { open: function (conversationId) { window.ir('inbox'); openConversation(conversationId); }, refresh: function () { loadList(true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
