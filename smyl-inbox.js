(function () {
  'use strict';

  // Skeletons de carga (smyl-skeleton.js) con respaldo si el asistente no está cargado.
  function sk(kind, options) { return window.SmylSkeleton ? window.SmylSkeleton.html(kind, options) : '<p class="smyl-inbox-productivity-state">' + ((options && options.label) || 'Cargando…') + '</p>'; }
  function skNode(kind, options) { var holder = document.createElement('div'); holder.innerHTML = sk(kind, options); return holder.firstElementChild; }

  var inboxScriptUrl = document.currentScript && document.currentScript.src;
  var emojiCatalogPromise;
  var recentEmoji = [];
  var messageMenu = null;
  var messageMenuSequence = 0;

  var CONTEXT_DOCK_STORAGE_KEY = 'smyl_inbox_context_docked';
  function initialDockedContextPreference() {
    try {
      var saved = window.sessionStorage.getItem(CONTEXT_DOCK_STORAGE_KEY);
      if (saved === 'open') return true;
      if (saved === 'closed') return false;
    } catch (_) {}
    // On a wide clinical workstation the Ficha 360 is useful workspace, not a
    // modal interruption. Null means "automatic" until the user decides.
    return null;
  }

  var state = {
    conversations: [], total: 0, offset: 0, limit: 30, hasMore: false, pipelineToday: false,
    filter: 'all', channel: '', search: '', selectedId: null, filterPanelOpen: false, branches: [], branchFilter: '', branchMenu: null,
    messages: {}, pages: {}, pending: {}, loadingList: false, loadingThread: false,
    listError: '', threadError: '', syncedAt: null, actor: null, stages: [], stageCatalogStatus: 'idle',
    threadController: null, contextOpen: false, contextSections: {}, contextReturnFocus: null, f360Open: null, f360Tab: {}, f360Visits: {}, f360VisitsAll: {}, f360Movements: {}, f360File: {}, f360Filter: {}, f360Shared: {}, f360Summary: {}, contextDockedPreferred: initialDockedContextPreference(), polling: false,
    replyTo: null, attachment: null, clinical: {}, clinicalLoading: {},
    copilot: {}, copilotLoading: {},
    templates: [], templatesLoaded: false, templatesLoading: false,
    scheduled: {}, scheduledLoading: {},
    operations: null, operationsLoading: false, operationsError: '', pilotLoading: false,
    quickSession: null,
    bulkMode: false, bulkSelected: new Set(), bulkRunning: false,
    threadSearchResults: [], threadSearchPage: null, threadSearchLoading: false,
    sharedItems: [], sharedPage: null, sharedLoading: false,
    notificationsEnabled: false, didAutoOpen: false,
    view: 'list', pipelineDragId: null, pipelineChatId: null, pipelineOpening: false, actionsOpenId: null, badgeFailures: 0,
    draftSaveTimer: null,
    recorder: null, recorderStream: null, recorderChunks: [], recorderStartedAt: 0, recorderTimer: null, recordingCancelled: false,
    suggestShown: [], suggestResult: null, suggestBusy: false, availabilityCatalog: null, availabilityMode: 'calendar', availabilityLoading: false, availabilitySlots: [], availabilityRequests: [], availabilitySelected: [], availabilityAction: '', availabilityError: '', availabilityEmptyReason: '', appointmentContext: {}, appointmentContextLoading: {}, patientLinking: {}, patientLinkChecked: {},
  };

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  var accessEpoch = 0, accessRequest = null, accessUser = null;
  var threadEpoch = new Map(), openSequence = 0, routingRevision = 0;
  var teamsByConversation = new Map();
  var pendingPipelineSnapshots = new Set();
  var threadNewCount = 0, threadPaintDeferred = false;
  var mediaSession = null;
  function closeChatMedia() {
    closeMessageMenu(false);
    if (!mediaSession) return;
    mediaSession.abort();
    mediaSession = null;
  }
  function chatEnabled() {
    return !!state.actor && ['agent', 'coordinator'].includes(state.actor.chat_access);
  }

  function forgetChat(id) {
    if (!id) return;
    if (state.selectedId === id) { closeChatMedia(); closeThreadOptions(false); resetThreadJump(); }
    teamsByConversation.delete(id);
    pendingPipelineSnapshots.delete(id);
    routingRevision++;
    threadEpoch.set(id, (threadEpoch.get(id) || 0) + 1);
    if (state.selectedId !== id) persistEncryptedDraft(id, '').catch(function () {});
    state.conversations = state.conversations.filter(function (item) { return item.id !== id; });
    ['messages','pages','pending','clinical','clinicalLoading','copilot','scheduled','appointmentContext','patientLinkChecked',
      'f360Tab','f360Visits','f360VisitsAll','f360Movements','f360File','f360Filter','f360Shared','f360Summary'].forEach(function (key) { delete state[key][id]; });
    state.bulkSelected.delete(id);
    window.dispatchEvent(new CustomEvent('smyl:inbox-removed',{detail:{id:id}}));
    if (state.pipelineChatId === id) {
      closePipelineChat(true);
      document.querySelector('[data-pipeline-status]').textContent = 'Esta conversación ya no está disponible.';
    }
    if (state.selectedId !== id) return;
    if (state.recorder) stopVoiceRecording(true);
    if (state.threadController) { state.threadController.abort(); state.threadController = null; }
    state.selectedId = null; state.contextOpen = false; state.replyTo = null; state.attachment = null;
    state.threadSearchResults = []; state.sharedItems = []; state.loadingThread = false;
    if (state.accountContext) delete state.accountContext[id];
    var page = document.getElementById('p-inbox');
    if (!page) return;
    page.classList.remove('show-thread');
    var input = page.querySelector('[name="message"]'); if (input) input.value = '';
    clearEncryptedDraft(id);
    document.querySelectorAll('#p-inbox dialog[open], dialog[data-chat-transfer][open], dialog.smyl-inbox-branch-dialog[open]').forEach(function (dialog) { dialog.close(); });
    renderHandoffNote(null);
    page.querySelector('[data-thread-name]').textContent = '';
    page.querySelector('[data-thread-meta]').textContent = '';
    page.querySelector('[data-thread-messages]').replaceChildren();
    renderFileSuggestion([]);
    var owner = page.querySelector('[data-thread-assign]'); delete owner.dataset.conversationId;
    page.querySelector('[data-thread-owner-name]').textContent = 'Sin asignar';
    render();
  }

  function setChatActor(actor) {
    var next = actor && ['agent','coordinator'].includes(actor.chat_access) ? actor : null;
    var mode = next ? next.chat_access : 'none';
    var old = state.actor;
    if (document.documentElement.dataset.smylChatAccess === mode && (!next || old && old.id === next.id)) {
      state.actor = next;
      var label = document.querySelector('[data-chat-access-status]');
      if (!next && label) label.textContent = 'Tu perfil no tiene acceso al chat.';
      return;
    }
    accessEpoch++; state.actor = next; state.badgeFailures = 0;
    state.stages = []; state.stageCatalogStatus = 'idle';
    teamsByConversation.clear();
    pendingPipelineSnapshots.clear();
    if (old) {
      if (state.pipelineChatId) closePipelineChat(false);
      threadEpoch.clear();
      forgetChat(state.selectedId);
      state.conversations = []; state.operations = null;
      state.f360Tab = {}; state.f360Filter = {}; state.f360File = {}; state.f360Shared = {};
      state.messages = {}; state.clinical = {}; state.syncedAt = null; state.total = 0;
      state.didAutoOpen = false; state.filter = 'all'; state.pipelineToday = false; renderNavBadge(0);
    }
    document.documentElement.dataset.smylChatAccess = mode;
    var status = document.querySelector('[data-chat-access-status]');
    if (status) status.textContent = next ? '' : 'Tu perfil no tiene acceso al chat.';
    if (!next && document.getElementById('p-inbox')) render();
    window.dispatchEvent(new CustomEvent('smyl:inbox-access', { detail: { mode: mode } }));
  }

  function refreshAccess() {
    if (accessRequest) return accessRequest;
    var epoch = accessEpoch;
    accessRequest = request('GET', { action: 'access' }).then(function (data) {
      if (epoch === accessEpoch) setChatActor(data.actor);
      return chatEnabled();
    }).catch(function () {
      if (epoch === accessEpoch) {
        setChatActor(null);
        var status = document.querySelector('[data-chat-access-status]');
        if (status) {
          status.textContent = 'No pudimos verificar tu acceso. ';
          var retry = node('button', 'btn btn-secondary', 'Reintentar');
          retry.type = 'button'; retry.onclick = function () { window.ir('inbox'); }; status.append(retry);
        }
      }
      return false;
    }).finally(function () { accessRequest = null; });
    return accessRequest;
  }

  function hasPermission(permission) {
    if (!state.actor) return false;
    if (permission === 'messages.manage') return state.actor.chat_access === 'coordinator';
    if (permission === 'messages.read' || permission === 'messages.respond') return chatEnabled();
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

  function showSaveWarning(visible) {
    var warning = document.querySelector('[data-compose-save-warning]');
    if (warning) warning.hidden = !visible;
  }

  async function persistEncryptedDraft(conversationId, content) {
    if (!conversationId || !window.crypto || !window.crypto.subtle) return;
    var revision = threadEpoch.get(conversationId), epoch = accessEpoch;
    var envelope = draftEnvelope();
    if (!content) {
      delete envelope[conversationId]; window.sessionStorage.setItem(DRAFT_STORE, JSON.stringify(envelope)); return;
    }
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var payload = JSON.stringify({ conversation_id: conversationId, content: content.slice(0, 4000), expires_at: Date.now() + 7 * 86400000 });
    var ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, await draftKey(), new TextEncoder().encode(payload));
    if (epoch !== accessEpoch || revision !== threadEpoch.get(conversationId)) return;
    envelope = draftEnvelope();
    envelope[conversationId] = { iv: base64Bytes(iv), ciphertext: base64Bytes(new Uint8Array(ciphertext)) };
    window.sessionStorage.setItem(DRAFT_STORE, JSON.stringify(envelope));
  }

  function scheduleDraftSave(value) {
    var conversationId = state.selectedId; if (!conversationId) return;
    clearTimeout(state.draftSaveTimer);
    state.draftSaveTimer = setTimeout(function () {
      persistEncryptedDraft(conversationId, value.trim()).then(function () {
        if (state.selectedId === conversationId) showSaveWarning(false);
      }).catch(function () {
        if (state.selectedId === conversationId) showSaveWarning(true);
      });
    }, 450);
  }

  function setEditorExpanded(form, button, expanded) {
    form.classList.toggle('is-editor-expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.title = expanded ? 'Reducir editor' : 'Ampliar editor';
    button.setAttribute('aria-label', button.title);
    button.innerHTML = composeIcon(expanded ? 'collapse' : 'expand');
  }

  function measureComposerText(input) {
    input.style.setProperty('--smyl-reply-height', '44px');
    input.style.setProperty('--smyl-reply-height', input.scrollHeight + 'px');
  }

  function fitComposerText(input) {
    if (!input) return;
    var form = input.form, button = form.querySelector('[data-compose-expand]');
    var manualSizing = input.clientWidth && !window.CSS.supports('field-sizing', 'content');
    if (manualSizing) measureComposerText(input);
    if (!button) return;
    var longDraft = false;
    if (input.value && !input.disabled && input.clientWidth && window.matchMedia('(max-width: 760px)').matches) {
      var style = getComputedStyle(input);
      var threeLines = 3 * parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      longDraft = input.scrollHeight > threeLines + 1;
    }
    if (!longDraft && form.classList.contains('is-editor-expanded')) setEditorExpanded(form, button, false);
    if (form.classList.contains('is-long-reply') !== longDraft) {
      form.classList.toggle('is-long-reply', longDraft);
      if (manualSizing) measureComposerText(input);
    }
    button.hidden = !longDraft;
  }

  async function restoreEncryptedDraft(conversationId) {
    var input = document.querySelector('[name="message"]'); if (!input) return;
    input.value = ''; fitComposerText(input); showSaveWarning(false);
    var envelope = draftEnvelope(); var stored = envelope[conversationId]; if (!stored) return;
    try {
      var plain = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesFromBase64(stored.iv) }, await draftKey(), bytesFromBase64(stored.ciphertext));
      var draft = JSON.parse(new TextDecoder().decode(plain));
      if (draft.conversation_id !== conversationId || Number(draft.expires_at) < Date.now()) throw new Error('expired');
      if (state.selectedId === conversationId && !input.value) {
        input.value = String(draft.content || '').slice(0, 4000);
        fitComposerText(input);
      }
    } catch (_) {
      delete envelope[conversationId]; window.sessionStorage.setItem(DRAFT_STORE, JSON.stringify(envelope));
    }
  }

  function clearEncryptedDraft(conversationId) {
    clearTimeout(state.draftSaveTimer); state.draftSaveTimer = null;
    return persistEncryptedDraft(conversationId, '').catch(function () {});
  }

  function setComposerText(value) {
    var input = document.getElementById('smyl-inbox-message'); if (!input) return;
    input.value = String(value || '').slice(0, 4000);
    fitComposerText(input); scheduleDraftSave(input.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  async function request(method, query, payload, key, timeoutMs, requestController) {
    var epoch = accessEpoch;
    var threadId = query && query.conversation_id || payload && payload.conversation_id;
    var revision = threadEpoch.get(threadId);
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
      if (epoch !== accessEpoch || revision !== threadEpoch.get(threadId)) throw new Error('El acceso al chat cambió.');
      if (!response.ok) {
        var error = new Error(typeof data.error === 'string' ? data.error : 'No se pudo completar la operación.');
        error.code = data.code || ''; error.status = response.status;
        if (error.code === 'chat_access_denied') setChatActor(null);
        if (error.code === 'conversation_scope_denied') forgetChat((query && query.conversation_id) || (payload && payload.conversation_id));
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
    var epoch = accessEpoch;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 60000);
    try {
      var headers = { 'Authorization': 'Bearer ' + await token(), 'apikey': SUPA_KEY, 'Idempotency-Key': key };
      var response = await fetch(SUPA_URL + '/functions/v1/lana-inbox', { method: 'POST', headers: headers, body: form, signal: controller.signal });
      var data = await response.json().catch(function () { return {}; });
      if (epoch !== accessEpoch) throw new Error('El acceso al chat cambió.');
      if (!response.ok) {
        if (data.code === 'chat_access_denied') setChatActor(null);
        if (data.code === 'conversation_scope_denied') forgetChat(form.get('conversation_id'));
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

  var CHANNEL_MARKS = {
    whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#25D366"/><path fill="#fff" d="M12.04 5.2a6.8 6.8 0 0 0-5.84 10.3L5.3 18.8l3.4-.9a6.8 6.8 0 1 0 3.34-12.7Zm3.9 9.6c-.17.47-.97.9-1.35.95-.35.05-.78.07-1.26-.08-.29-.09-.66-.22-1.14-.43-2-.87-3.3-2.9-3.4-3.04-.1-.13-.81-1.08-.81-2.06 0-.98.51-1.46.7-1.66.18-.2.39-.25.52-.25h.38c.12 0 .29-.05.45.35.17.4.57 1.38.62 1.48.05.1.08.22.02.35-.07.13-.1.22-.2.33-.1.12-.2.26-.29.35-.1.1-.2.2-.09.4.12.2.52.86 1.12 1.39.77.69 1.42.9 1.62 1 .2.1.32.08.44-.05.12-.14.5-.58.64-.78.13-.2.27-.17.45-.1.18.07 1.17.55 1.37.65.2.1.33.15.38.23.05.09.05.5-.12.97Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="smyl-ig-gradient" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEC053"/><stop offset=".35" stop-color="#F2203E"/><stop offset=".7" stop-color="#B729A8"/><stop offset="1" stop-color="#5342D6"/></linearGradient></defs><circle cx="12" cy="12" r="12" fill="url(#smyl-ig-gradient)"/><rect x="6.3" y="6.3" width="11.4" height="11.4" rx="3.4" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="12" cy="12" r="2.7" fill="none" stroke="#fff" stroke-width="1.6"/><circle cx="15.6" cy="8.4" r="1" fill="#fff"/></svg>',
    messenger: '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="smyl-ms-gradient" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0059ff"/><stop offset="1" stop-color="#A033FF"/></linearGradient></defs><circle cx="12" cy="12" r="12" fill="url(#smyl-ms-gradient)"/><path fill="#fff" d="M12 5.2c-3.9 0-6.8 2.86-6.8 6.73 0 2 .8 3.7 2.12 4.9v2.17l1.98-1.1c.8.23 1.6.34 2.7.34 3.9 0 6.8-2.86 6.8-6.7S15.9 5.2 12 5.2Z"/><path fill="#7B3CFF" d="m7.6 13.6 2.7-2.9 1.5 1.5 2.6-1.5-2.7 2.9-1.5-1.5-2.6 1.5Z"/></svg>'
  };

  // Insignia con la marca del canal; se coloca en la esquina del avatar.
  function channelBadge(channel) {
    var badge = node('span', 'smyl-inbox-channel-badge'); badge.dataset.channel = channel;
    badge.setAttribute('role', 'img'); badge.setAttribute('aria-label', channelLabel(channel)); badge.title = channelLabel(channel);
    badge.innerHTML = CHANNEL_MARKS[channel] || '';
    return badge;
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

  var transcriptClock = new Intl.DateTimeFormat('es-MX', {hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

  function messageStatus(item) {
    var delivery = {sending: 'Enviando…', failed: 'No se envió', unknown: 'Confirmación pendiente'};
    if (delivery[item.status]) return node('span', 'smyl-inbox-message-status', delivery[item.status]);
    var date = new Date(item.created_at || '');
    var stamp = node('time', 'smyl-inbox-message-status', '');
    if (Number.isFinite(date.getTime())) {
      stamp.dateTime = date.toISOString();
      stamp.textContent = transcriptClock.format(date);
    }
    return stamp;
  }

  function scheduledStatusLabel(status) {
    return status === 'pendiente' ? 'Pendiente'
      : status === 'enviando' ? 'Enviando'
      : status === 'retrying' ? 'Reintento automático'
      : status === 'enviado' ? 'Enviado'
      : status === 'dead_letter' || status === 'fallido' ? 'Requiere revisión'
      : status === 'cancelado' ? 'Cancelado' : String(status || 'Pendiente');
  }

  var COMPOSE_ICONS = {
    attach: '<path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.3 9.3a2 2 0 1 1-2.8-2.8l8.6-8.6"></path>',
    quick: '<path d="M4 5h16v11H8l-4 4V5Z"></path><path d="M8 9h8M8 12h5"></path>',
    smile: '<circle cx="12" cy="12" r="9"></circle><path d="M8.5 14.5c1 1 2.1 1.5 3.5 1.5s2.5-.5 3.5-1.5M9 9.5h.01M15 9.5h.01"></path>',
    more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
    plus: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path>',
    rewrite: '<path d="M4 20h4l11-11-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4M5 4h5M7.5 1.5v5"></path>',
    mila: '<path d="m12 3 .9 3.1a4.5 4.5 0 0 0 3 3L19 10l-3.1.9a4.5 4.5 0 0 0-3 3L12 17l-.9-3.1a4.5 4.5 0 0 0-3-3L5 10l3.1-.9a4.5 4.5 0 0 0 3-3L12 3Z"></path><path d="m18 16 .4 1.4a2 2 0 0 0 1.2 1.2L21 19l-1.4.4a2 2 0 0 0-1.2 1.2L18 22l-.4-1.4a2 2 0 0 0-1.2-1.2L15 19l1.4-.4a2 2 0 0 0 1.2-1.2L18 16Z"></path>',
    send: '<path d="m4 4 17 8-17 8 3-8-3-8Z"></path><path d="M7 12h14"></path>',
    template: '<path d="M6 3h9l4 4v14H6V3Z"></path><path d="M14 3v5h5M9 12h6M9 16h6"></path>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"></path>',
    moveStage: '<path d="M3 4h7v6H3zM14 14h7v6h-7zM13 7h5v4m-3-3 3 3 3-3"></path>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"></path>',
    location: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle>',
    bot: '<rect x="4" y="7" width="16" height="13" rx="3"></rect><path d="M12 3v4M2 12v4M22 12v4M8 16h8"></path><circle cx="8.5" cy="11.5" r=".5"></circle><circle cx="15.5" cy="11.5" r=".5"></circle>',
    person: '<circle cx="10" cy="8" r="3.5"></circle><path d="M3 20v-2a7 7 0 0 1 12.2-4.7M16 17l2 2 4-5"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
    settings: '<path d="M3 7h6m4 0h8M3 17h10m4 0h4"></path><circle cx="11" cy="7" r="2"></circle><circle cx="15" cy="17" r="2"></circle>',
    expand: '<path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"></path>',
    collapse: '<path d="M20 4l-7 7m0-6v6h6M4 20l7-7m-6 0h6v6"></path>',
    chevron: '<path d="m9 18 6-6-6-6"></path>'
  };

  function composeIcon(name) {
    return '<svg class="smyl-inbox-compose-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (COMPOSE_ICONS[name] || '') + '</svg>';
  }

  function shell() {
    var page = node('section', 'pantalla smyl-inbox-page');
    page.id = 'p-inbox';
    page.innerHTML =
      '<div class="smyl-inbox-sync-warning" data-inbox-live role="status" hidden><span></span></div>' +
      '<header class="smyl-inbox-top">' +
        '<h1 class="smyl-inbox-sr">Mensajes</h1>' +
        '<div class="smyl-inbox-view-toggle" role="tablist" aria-label="Vista de Mensajes"><button type="button" role="tab" data-inbox-view="list" aria-selected="true" aria-controls="smyl-inbox-workspace" tabindex="0">Conversaciones</button><button type="button" role="tab" data-inbox-view="pipeline" aria-selected="false" aria-controls="smyl-inbox-pipeline" tabindex="-1">Pipeline</button></div>' +
      '</header>' +
      '<section class="smyl-inbox-pipeline" id="smyl-inbox-pipeline" data-inbox-pipeline aria-label="Pipeline de pacientes por etapa" hidden>' +
        '<div class="smyl-inbox-pipeline-bar"><div class="smyl-inbox-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input type="search" placeholder="Buscar paciente" aria-label="Buscar en el pipeline" data-pipeline-search></div><div class="smyl-inbox-pipeline-filters" role="tablist" aria-label="Filtrar pipeline"><button type="button" role="tab" aria-selected="true" tabindex="0" data-inbox-filter="all" class="active">Todas</button><button type="button" role="tab" aria-selected="false" tabindex="-1" data-inbox-filter="unread">Sin leer</button><button type="button" role="tab" aria-selected="false" tabindex="-1" data-inbox-filter="attention">Por atender</button><button type="button" role="tab" aria-selected="false" tabindex="-1" data-inbox-filter="mine">Mías</button></div><button type="button" class="smyl-inbox-pipeline-today" data-pipeline-today aria-pressed="false">' + composeIcon('calendar') + 'Citas de hoy</button><button type="button" class="smyl-inbox-pipeline-more" data-pipeline-more hidden>Cargar más</button></div>' +
        '<p class="smyl-inbox-pipeline-status" data-pipeline-status role="status" aria-live="polite"></p><div class="smyl-inbox-pipeline-board" data-pipeline-board></div>' +
      '</section>' +
      '<div class="smyl-inbox-workspace" id="smyl-inbox-workspace">' +
        '<aside class="smyl-inbox-list-pane" aria-label="Bandeja de conversaciones">' +
          '<div class="smyl-inbox-list-head"><div class="smyl-inbox-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg><input type="search" placeholder="Buscar paciente" aria-label="Buscar conversación" data-inbox-search></div><div class="smyl-inbox-branchbar" data-inbox-branchbar hidden></div><button type="button" class="smyl-inbox-filter-toggle" data-inbox-filter-more aria-expanded="false" aria-controls="smyl-inbox-filter-panel" aria-label="Filtros" title="Filtros"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"></path></svg></button></div>' +
          '<div class="smyl-inbox-filters" role="tablist" aria-label="Filtrar conversaciones">' +
            '<div class="smyl-inbox-filter-pair" role="presentation"><button type="button" role="tab" aria-selected="true" tabindex="0" data-inbox-filter="all" class="active">Todas</button><button type="button" role="tab" aria-selected="false" tabindex="-1" data-inbox-filter="unread">Sin leer</button></div>' +
            '<div class="smyl-inbox-filter-pair" role="presentation"><button type="button" role="tab" aria-selected="false" tabindex="-1" data-inbox-filter="attention">Por atender</button><button type="button" role="tab" aria-selected="false" tabindex="-1" data-inbox-filter="mine">Mías</button></div>' +
          '</div>' +
          '<div class="smyl-inbox-branch-strip" data-inbox-branch-strip hidden></div>' +
          '<section class="smyl-inbox-filter-panel" id="smyl-inbox-filter-panel" data-inbox-filter-panel aria-label="Filtros de conversaciones" hidden><fieldset><legend>Estado</legend><div class="smyl-inbox-secondary-filters"><button type="button" data-inbox-filter="unassigned">Sin asignar</button><button type="button" data-inbox-filter="paused">En atención</button><button type="button" data-inbox-filter="pinned">Fijadas</button></div></fieldset><div class="smyl-inbox-channel-filter"><span class="smyl-inbox-channel-label" id="smyl-inbox-channel-label">Canal</span><div class="smyl-inbox-channel-chips" data-inbox-channel role="group" aria-labelledby="smyl-inbox-channel-label">' +
          ['whatsapp', 'messenger', 'instagram'].map(function (c) { return '<button type="button" class="smyl-inbox-channel-chip" data-channel-value="' + c + '" aria-pressed="false" aria-label="' + channelLabel(c) + '" title="' + channelLabel(c) + '">' + CHANNEL_MARKS[c] + '</button>'; }).join('') + '</div></div></section>' +
          '<div class="smyl-inbox-queue-summary" data-inbox-queue-summary role="status" aria-live="polite"></div><div class="smyl-inbox-queue-summary" data-inbox-handoff-status role="status" aria-live="polite" hidden></div>' +
          '<div class="smyl-inbox-list" data-inbox-list></div>' +
          '<div class="smyl-inbox-bulkbar" data-inbox-bulkbar hidden></div>' +
          '<button type="button" class="smyl-inbox-more" data-inbox-more hidden>Cargar más conversaciones</button>' +
        '</aside>' +
        '<div class="smyl-inbox-resizer" data-inbox-resizer role="separator" aria-orientation="vertical" aria-label="Cambiar el ancho de la lista de conversaciones. Arrastra o usa las flechas." tabindex="0" title="Arrastra para cambiar el ancho · doble clic para restablecer"></div>' +
        '<main class="smyl-inbox-thread-pane" id="smyl-inbox-thread-pane" data-inbox-thread-pane>' +
          '<div class="smyl-inbox-pipeline-loading" data-pipeline-opening hidden><button type="button" data-pipeline-cancel>Volver al Pipeline</button><p role="status">Abriendo conversación…</p></div>' +
          '<div class="smyl-inbox-thread-empty" data-inbox-thread-empty><div class="smyl-inbox-empty-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg></div><span class="smyl-inbox-eyebrow">CENTRO DE ATENCIÓN</span><h2>Continúa el siguiente caso</h2><p>Abre una conversación para responder, consultar el expediente y coordinar la cita sin cambiar de pantalla.</p><div class="smyl-inbox-empty-steps"><span><b>1</b>Revisa el motivo</span><span><b>2</b>Consulta agenda</span><span><b>3</b>Confirma el seguimiento</span></div><button type="button" class="btn btn-primary" data-inbox-open-next>Abrir siguiente conversación</button></div>' +
          '<div class="smyl-inbox-thread" data-inbox-thread hidden>' +
            '<header class="smyl-inbox-thread-head">' +
              '<div class="smyl-inbox-thread-contact"><button type="button" class="smyl-inbox-back" data-inbox-back aria-label="Volver a la bandeja"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button><button type="button" class="smyl-inbox-patient-summary" data-inbox-context aria-label="Abrir paciente y atención" title="Ver la ficha del paciente" aria-expanded="false" aria-controls="smyl-inbox-context-panel"><div class="smyl-inbox-avatar" data-thread-avatar></div><div class="smyl-inbox-thread-person"><strong data-thread-name></strong><span data-thread-meta></span></div><span class="smyl-inbox-med-flag" data-thread-medical hidden></span></button>' +
                '<button type="button" class="smyl-inbox-owner-control" data-thread-owner aria-haspopup="dialog" aria-controls="smyl-chat-owner">' + composeIcon('person') + '<span class="smyl-inbox-owner-copy"><small>Atiende el chat</small><strong data-thread-owner-name>Sin asignar</strong></span></button></div>' +
              '<div class="smyl-inbox-thread-actions">' +
                '<div class="smyl-inbox-thread-branchwrap" data-thread-branch-wrap hidden><button type="button" class="smyl-inbox-iconchip is-labeled" data-thread-branch-chip aria-haspopup="menu" aria-expanded="false"></button></div>' +
                '<button type="button" class="smyl-inbox-mode-button" data-thread-mode role="switch" aria-checked="true"><span class="smyl-inbox-mode-mark" aria-hidden="true">' + composeIcon('bot') + '<svg class="smyl-inbox-mode-status is-paused" viewBox="0 0 12 12"><path d="M4 3v6M8 3v6"></path></svg><svg class="smyl-inbox-mode-status is-active" viewBox="0 0 12 12"><path d="m4 2 5 4-5 4Z"></path></svg></span><span class="smyl-inbox-switch" aria-hidden="true"><i></i></span><span data-thread-state>IA activa</span></button>' +
                '<nav class="smyl-inbox-carebar" data-thread-carebar aria-label="Siguiente acción del paciente"></nav>' +
                '<button type="button" data-thread-options aria-label="Opciones del chat" title="Opciones del chat" aria-controls="smyl-thread-options" aria-expanded="false" hidden>' + composeIcon('settings') + '</button>' +
              '</div>' +
              '<div id="smyl-thread-options" data-thread-options-panel role="group" aria-label="Opciones del chat" tabindex="-1" hidden></div>' +
            '</header>' +
            '<div class="smyl-inbox-transcript"><div class="smyl-inbox-thread-body" data-thread-body tabindex="-1" aria-label="Historial de mensajes" role="region"><button type="button" class="smyl-inbox-older" data-thread-older hidden>Cargar mensajes anteriores</button><div id="smyl-thread-log" data-thread-messages role="log" aria-live="polite" aria-relevant="additions text" aria-atomic="false"></div></div>' +
              '<button type="button" class="smyl-inbox-jump" data-thread-jump aria-controls="smyl-thread-log" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6"/></svg><span>Ir al final</span></button><span class="smyl-inbox-sr" role="status" data-thread-jump-status></span></div>' +
            '<section class="smyl-inbox-copilot-draft" data-copilot-draft hidden></section>' +
            '<form class="smyl-inbox-composer" data-inbox-composer><label class="smyl-inbox-sr" for="smyl-inbox-message">Responder como equipo</label><div class="smyl-inbox-window" data-wa-window aria-live="polite" hidden></div><div class="media-reply-offer" data-media-offer aria-live="polite" hidden></div><div class="smyl-inbox-compose-context" data-compose-context hidden></div><p class="smyl-compose-save-warning" data-compose-save-warning role="status" hidden>No se pudo guardar el texto para esta sesión.</p><div class="smyl-inbox-compose-surface" data-compose-surface><div class="smyl-inbox-compose-main"><div class="smyl-inbox-compose-card"><div class="smyl-inbox-message-row"><textarea id="smyl-inbox-message" name="message" rows="2" maxlength="4000" placeholder="Escribe una respuesta…"></textarea></div><div class="smyl-inbox-compose-bar" role="group" aria-label="Acciones de respuesta"><div class="smyl-inbox-compose-primary"><button type="button" class="smyl-inbox-compose-more" data-compose-more aria-expanded="false" aria-haspopup="menu" aria-controls="smyl-inbox-compose-tools" aria-label="Abrir herramientas de mensaje" title="Herramientas">' + composeIcon('plus') + '</button></div><input type="file" data-compose-file accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf,text/plain,.doc,.docx,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg" hidden><div class="smyl-inbox-compose-actions"><button type="button" class="smyl-inbox-compose-copilot" title="Sugerir con MILA" data-compose-copilot aria-label="Sugerir con MILA">' + composeIcon('mila') + '<span>Sugerir con MILA</span></button><button type="submit" class="smyl-inbox-send" data-compose-send aria-label="Enviar mensaje"><span>Enviar</span>' + composeIcon('send') + '</button></div></div></div><div class="smyl-inbox-compose-tools" id="smyl-inbox-compose-tools" data-compose-tools role="menu" aria-label="Herramientas de mensaje" hidden><button type="button" data-compose-attach role="menuitem" aria-label="Adjuntar archivo">' + composeIcon('attach') + '<span><strong>Adjuntar</strong><small>Foto, archivo o audio</small></span></button><button type="button" data-compose-quick role="menuitem" aria-label="Respuesta rápida">' + composeIcon('quick') + '<span><strong>Respuesta rápida</strong><small>Insertar texto del equipo</small></span></button><button type="button" data-compose-rewrite role="menuitem" aria-label="Mejorar redacción con MILA">' + composeIcon('rewrite') + '<span><strong>Mejorar redacción</strong><small>Corregir el texto actual de la caja</small></span></button><button type="button" data-compose-emoji role="menuitem" aria-label="Agregar emoji">' + composeIcon('smile') + '<span><strong>Emoji</strong><small>Insertar en el mensaje</small></span></button><button type="button" data-compose-template role="menuitem">' + composeIcon('template') + '<span><strong>Plantilla</strong><small>Mensaje aprobado</small></span></button><button type="button" data-compose-schedule role="menuitem">' + composeIcon('calendar') + '<span><strong>Programar</strong><small>Enviar después</small></span></button><button type="button" data-compose-record role="menuitem" aria-pressed="false">' + composeIcon('mic') + '<span><strong>Nota de voz</strong><small>Grabar audio</small></span></button><button type="button" data-compose-location role="menuitem" aria-label="Enviar ubicación actual">' + composeIcon('location') + '<span><strong>Enviar ubicación</strong><small>Ubicación actual o enlace de Maps</small></span></button></div></div></div></form>' +
          '</div>' +
        '</main>' +
        '<section class="smyl-inbox-offline" data-inbox-offline hidden aria-live="polite"></section>' +
        '<button type="button" class="smyl-inbox-context-scrim" data-context-close aria-label="Cerrar ficha del paciente" tabindex="-1" hidden></button>' +
        '<aside class="smyl-inbox-context" id="smyl-inbox-context-panel" data-inbox-context-panel role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="smyl-inbox-context-title" tabindex="-1" inert><div data-inbox-context-content></div></aside>' +
        '<dialog class="smyl-inbox-forward-dialog" data-inbox-forward><form method="dialog"><span class="smyl-inbox-eyebrow">REENVIAR MENSAJE</span><h2>Elige una conversación</h2><p>El contenido se enviará de nuevo por el canal del destinatario.</p><select data-forward-target aria-label="Conversación de destino"></select><div><button value="cancel" class="btn btn-secondary">Cancelar</button><button value="confirm" class="btn btn-primary" data-forward-confirm>Reenviar</button></div></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog" data-copilot-resume><form><span class="smyl-inbox-eyebrow">REANUDAR CON CONTEXTO</span><h2>Revisa lo que recibirá el asistente</h2><p>Copilot resume el episodio humano. Corrige cualquier inferencia antes de reactivar la atención automática.</p><textarea data-resume-summary maxlength="2000" rows="7" aria-label="Resumen para reanudar"></textarea><div class="smyl-inbox-copilot-notes" data-resume-notes></div><footer><button type="button" class="btn btn-secondary" data-resume-cancel>Cancelar</button><button type="submit" class="btn btn-primary" data-resume-confirm>Reanudar asistente</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog" data-copilot-feedback><form><span class="smyl-inbox-eyebrow">CALIDAD DE IA</span><h2>Evalúa esta respuesta</h2><p>Tu comentario queda para revisión; no modifica ni publica la capacitación automáticamente.</p><label>Resultado<select data-feedback-rating required><option value="helpful">Útil</option><option value="needs_improvement">Necesita mejora</option><option value="unsafe">Insegura o fuera de límites</option></select></label><label>¿Qué mejorarías?<textarea data-feedback-comment maxlength="1000" rows="3"></textarea></label><label>Respuesta ideal · opcional<textarea data-feedback-ideal maxlength="4000" rows="4"></textarea></label><footer><button type="button" class="btn btn-secondary" data-feedback-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Guardar evaluación</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog smyl-inbox-template-dialog" data-template-dialog><form><span class="smyl-inbox-eyebrow">WHATSAPP · PLANTILLA APROBADA</span><h2>Volver a contactar</h2><p>Meta permite estas plantillas incluso cuando la ventana de 24 horas ya venció.</p><label>Plantilla<select data-template-select required></select></label><div class="smyl-inbox-template-preview" data-template-preview></div><div data-template-variables></div><footer><button type="button" class="btn btn-secondary" data-template-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Enviar plantilla</button></footer></form></dialog>' +
        '<dialog class="smyl-inbox-copilot-dialog smyl-inbox-schedule-dialog" data-schedule-dialog><form><span class="smyl-inbox-eyebrow">WHATSAPP · ENVÍO PROGRAMADO</span><h2>Programar seguimiento</h2><p>El envío se procesa una sola vez. Si el texto libre quedaría fuera de la ventana, usa una plantilla aprobada.</p><label>Fecha y hora<input type="datetime-local" data-schedule-at required></label><label>Tipo<select data-schedule-type><option value="text">Texto libre</option><option value="template">Plantilla aprobada</option></select></label><label data-schedule-text-wrap>Mensaje<textarea data-schedule-text maxlength="4000" rows="4"></textarea></label><div data-schedule-template-wrap hidden><label>Plantilla<select data-schedule-template></select></label><div class="smyl-inbox-template-preview" data-schedule-preview></div><div data-schedule-variables></div></div><footer><button type="button" class="btn btn-secondary" data-schedule-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Programar</button></footer></form></dialog>' +
        '<dialog class="smyl-v2-dialog smyl-inbox-productivity-dialog smyl-inbox-availability-dialog" data-availability-dialog><header><div class="smyl-inbox-availability-heading"><h2 tabindex="-1">Agendar cita</h2><p class="smyl-inbox-availability-context"><span data-availability-patient>Paciente por vincular</span><span aria-hidden="true">·</span><span data-availability-location>Tu clínica</span></p></div><button type="button" class="smyl-inbox-dialog-close" data-availability-close aria-label="Cerrar agenda"><span aria-hidden="true">×</span></button></header><aside class="smyl-inbox-availability-patient-alert" data-availability-patient-alert hidden><div><strong>Confirma la identidad del paciente</strong><span>Vincula esta conversación para registrar la cita en el expediente correcto.</span></div><button type="button" class="btn btn-secondary btn-sm" data-availability-link-patient>Vincular paciente</button></aside><form data-availability-form><div class="smyl-inbox-availability-primary-fields"><label>Servicio<select data-availability-service required></select></label><label>Sucursal<select data-availability-branch title="Todas las sucursales"><option value="">Todas las sucursales</option></select></label><label>Profesional<select data-availability-professional><option value="">Todo el equipo</option></select></label></div><div class="smyl-inbox-availability-period"><div class="smyl-inbox-availability-presets" aria-label="Periodo de búsqueda"><span>Periodo</span><button type="button" data-availability-preset="7">7 días</button><button type="button" data-availability-preset="14">15 días</button><button type="button" data-availability-preset="next">Próxima semana</button><button type="button" data-availability-custom>Fechas personalizadas</button></div><div class="smyl-inbox-availability-dates" data-availability-date-fields hidden><label>Desde<input type="date" data-availability-from required></label><label>Hasta<input type="date" data-availability-to required></label></div><button class="btn btn-primary" type="submit">Buscar horarios</button></div></form><section class="smyl-inbox-availability-suggest" data-availability-suggest aria-label="Sugerencia de horarios"><div class="smyl-suggest-head"><div><strong>Sugerir horarios al paciente</strong><span>Tres opciones variadas, de una sola sucursal, ya ordenadas.</span></div><div class="smyl-suggest-buttons"><button type="button" class="btn btn-secondary" data-availability-suggest-run>Sugerir 3 horarios</button><button type="button" class="btn btn-secondary" data-availability-waitlist title="Si no encuentra horario o quiere uno más pronto">Poner en lista de espera</button></div></div><div class="smyl-suggest-body" data-availability-suggest-results aria-live="polite"></div></section><section class="smyl-inbox-availability-board"><header><div><strong data-availability-scope>Disponibilidad del equipo</strong><span data-availability-period-label></span></div><div class="smyl-inbox-availability-modes" role="group" aria-label="Vista de disponibilidad"><button type="button" data-availability-mode="calendar" aria-pressed="true">Calendario</button><button type="button" data-availability-mode="list" aria-pressed="false">Lista</button></div></header><div data-availability-results></div></section><footer class="smyl-inbox-availability-offer" hidden><span data-availability-selection>0 horarios seleccionados</span><label class="smyl-inbox-availability-notify" data-availability-notify-wrap hidden><input type="checkbox" data-availability-notify checked> Preparar el mensaje de confirmación en el chat</label><button type="button" class="btn btn-primary" data-availability-book hidden>Confirmar cita</button><button type="button" class="btn btn-primary" data-availability-prepare disabled>Agregar opciones al mensaje</button></footer></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog inbox-tool-dialog" id="smyl-chat-owner" data-owner-dialog aria-labelledby="smyl-owner-heading"><header><h2 id="smyl-owner-heading">Atiende el chat</h2><button type="button" data-owner-close aria-label="Cerrar responsable del chat">×</button></header>' +
          '<div class="smyl-chat-owner-body"><label>Responsable<select data-thread-assign aria-label="Asignar responsable del chat"></select></label><p class="smyl-chat-owner-status" data-owner-status role="status" hidden></p><button type="button" class="btn btn-secondary" data-thread-owner-retry hidden>Reintentar</button>' +
          '<section class="smyl-chat-note-content" data-handoff aria-labelledby="smyl-owner-note-title" hidden><h3 id="smyl-owner-note-title">Nota privada de relevo</h3><p></p></section></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog inbox-tool-dialog" data-quick-dialog aria-labelledby="smyl-quick-heading"><header><div><span class="smyl-quick-kicker">BIBLIOTECA DEL EQUIPO</span><h2 id="smyl-quick-heading">Respuestas rápidas</h2><p>Inserta un mensaje preparado sin enviarlo automáticamente.</p></div><button type="button" data-quick-close aria-label="Cerrar respuestas rápidas"><span aria-hidden="true">×</span></button></header>' +
          '<div data-quick-content><section data-quick-library><div class="smyl-quick-toolbar"><label class="smyl-quick-search"><span class="smyl-inbox-sr">Buscar una respuesta</span><input type="search" data-quick-search placeholder="Buscar por atajo o texto" aria-label="Buscar por atajo o texto"></label><button type="button" data-quick-new><span aria-hidden="true">＋</span> Nueva respuesta</button></div><div class="smyl-quick-overview"><p data-quick-summary aria-live="polite">Consultando biblioteca…</p><small>Consejo: escribe <b>/atajo</b> en el mensaje para abrir esta lista.</small></div><div class="smyl-quick-list" data-quick-list role="list"></div></section>' +
          '<form class="smyl-quick-editor" data-quick-form hidden><div class="smyl-quick-editor-heading"><span>RESPUESTA DEL EQUIPO</span><strong data-quick-editor-title>Nueva respuesta</strong><p>Guárdala para reutilizarla o insértala sólo en esta conversación.</p></div><label data-quick-name>Atajo<div class="smyl-quick-shortcut-field"><span aria-hidden="true">/</span><input name="shortcut" type="text" placeholder="bienvenida" maxlength="40" autocapitalize="none" autocomplete="off" spellcheck="false"></div><small>Usa letras, números, guiones o guiones bajos.</small></label><label>Mensaje<textarea name="replyText" rows="5" maxlength="4000" required placeholder="Escribe la respuesta…"></textarea></label>' +
          '<div class="smyl-quick-actions"><button type="button" data-quick-back>Volver</button><button type="button" data-quick-delete hidden>Eliminar</button><button type="button" data-quick-save>Guardar para el equipo</button><button type="submit" data-quick-use>Insertar en el chat</button></div></form><p data-quick-status role="status" hidden></p></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog smyl-inbox-emoji-dialog" data-emoji-dialog aria-labelledby="smyl-emoji-heading"><header><h2 id="smyl-emoji-heading">Emojis</h2><button type="button" data-emoji-close aria-label="Cerrar emojis">×</button></header><div data-emoji-content></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog" data-search-dialog><header><div><span class="smyl-inbox-eyebrow">HISTORIAL CANÓNICO</span><h2>Buscar dentro del hilo</h2><p>La búsqueda se realiza en el historial completo, incluso sobre mensajes no cargados.</p></div><button type="button" data-search-close>Cerrar</button></header><form data-thread-search-form><input type="search" data-thread-search-input minlength="2" maxlength="160" placeholder="Ej. valoración, cita o presupuesto" required><button class="btn btn-primary" type="submit">Buscar</button></form><div data-search-results></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog" data-shared-dialog><header><div><span class="smyl-inbox-eyebrow">BIBLIOTECA DEL HILO</span><h2>Archivos y enlaces compartidos</h2><p>Contenido del historial real de esta conversación.</p></div><button type="button" data-shared-close>Cerrar</button></header><div data-shared-content></div></dialog>' +
        '<dialog class="smyl-inbox-productivity-dialog smyl-inbox-settings-dialog" data-settings-dialog aria-labelledby="smyl-inbox-settings-title"><header><div><span class="smyl-inbox-eyebrow">ESTA CONVERSACIÓN</span><h2 id="smyl-inbox-settings-title">Ajustes de la conversación</h2><p>Responsable, etapa, asistente y mensajes de WhatsApp de este hilo.</p></div><button type="button" data-settings-close>Cerrar</button></header><div class="smyl-inbox-settings-content" data-settings-content></div></dialog>' +
        '<dialog class="smyl-inbox-operations-dialog" data-operations-dialog><header><div><span class="smyl-inbox-eyebrow">OPERACIÓN Y PILOTO</span><h2>Estado del Inbox</h2><p>Métricas del tenant, consumo y bloqueos que deben resolverse antes del piloto.</p></div><button type="button" data-operations-close aria-label="Cerrar estado operativo">Cerrar</button></header><div data-operations-content></div><footer><span>La activación del piloto siempre es manual.</span><div><button type="button" class="btn btn-secondary" data-pilot-report disabled>Ver informe</button><button type="button" class="btn btn-secondary" data-operations-refresh>Actualizar estado</button></div></footer></dialog>' +
        '<dialog class="smyl-inbox-report-dialog" data-pilot-report-dialog><header><div><span class="smyl-inbox-eyebrow">INFORME OPERATIVO</span><h2>Resultado del piloto</h2><p>Resumen para dirección y soporte, sin conversaciones ni datos clínicos.</p></div><button type="button" data-pilot-report-close aria-label="Cerrar informe del piloto">Cerrar</button></header><div data-pilot-report-content></div><footer><span>Revisa la evidencia antes de compartir este documento.</span><div><button type="button" class="btn btn-secondary" data-pilot-report-back>Volver al estado</button><button type="button" class="btn btn-primary" data-pilot-report-print>Imprimir o guardar PDF</button></div></footer></dialog>' +
      '</div>';
    return page;
  }

  function mergeConversations(items, replace) {
    if (!chatEnabled()) return;
    items = (items || []).filter(function (item) { return state.actor.chat_access === 'coordinator' || item.assignment && item.assignment.actor_id === state.actor.id; });
    var previous = new Map(state.conversations.map(function (item) { return [item.id, item]; }));
    var map = replace ? new Map() : new Map(previous);
    items.forEach(function (item) {
      var old = previous.get(item.id);
      var merged = Object.assign({}, old || {}, item);
      if (old?.pipeline && item.pipeline && item.pipeline.revision < old.pipeline.revision) {
        merged.stage_id = old.stage_id; merged.pipeline = old.pipeline; merged.appointment = old.appointment;
      }
      if (old && item.assignment_version !== old.assignment_version && !Object.hasOwn(item, 'private_handoff_note')) delete merged.private_handoff_note;
      map.set(item.id, merged);
    });
    state.conversations = Array.from(map.values()).sort(function (a, b) {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (Boolean(a.needs_human) !== Boolean(b.needs_human)) return a.needs_human ? -1 : 1;
      if (Boolean(a.unread_count) !== Boolean(b.unread_count)) return a.unread_count ? -1 : 1;
      var mineA = Boolean(a.assignment && state.actor && a.assignment.actor_id === state.actor.id);
      var mineB = Boolean(b.assignment && state.actor && b.assignment.actor_id === state.actor.id);
      if (mineA !== mineB) return mineA ? -1 : 1;
      return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
    });
    if (replace && state.pipelineChatId && !map.has(state.pipelineChatId)) closePipelineChat(false);
  }

  function visibleConversations() {
    var query = state.search.toLocaleLowerCase('es-MX').trim();
    return state.conversations.filter(function (item) {
      if (state.channel && item.channel !== state.channel) return false;
      var keepOpen = item.id === state.selectedId && (state.view !== 'pipeline' || state.pipelineChatId === item.id);
      if (state.filter === 'unread' && !item.unread_count && !keepOpen) return false;
      if (state.filter === 'attention' && !item.needs_human && !keepOpen) return false;
      if (state.filter === 'mine' && (!item.assignment || item.assignment.actor_id !== (state.actor && state.actor.id))) return false;
      if (state.filter === 'unassigned' && item.assignment) return false;
      if (state.filter === 'pinned' && !item.pinned) return false;
      if (state.filter === 'paused' && !item.paused) return false;
      if (state.branchFilter === 'none' && item.branch) return false;
      if (state.branchFilter && state.branchFilter !== 'none' && !(item.branch && item.branch.id === state.branchFilter)) return false;
      if (query && !(item.contact_name + ' ' + item.last_message).toLocaleLowerCase('es-MX').includes(query)) return false;
      return true;
    });
  }

  var CLINIC_PIPELINE_STAGES = [
    { id: 'smyl:confirmed', name: 'Cita confirmada', color: '#3045cf' },
    { id: 'smyl:arrived', name: 'Llegó', color: '#9A650E' },
    { id: 'smyl:attended', name: 'Atendido', color: '#1d31b9' }
  ];
  var pendingStageMoves = new Set();

  function pipelineStages() {
    var external = state.stages.slice().sort(function (a, b) { return (Number(a.position ?? a.order) || 0) - (Number(b.position ?? b.order) || 0); });
    return CLINIC_PIPELINE_STAGES.concat(external);
  }

  function stageName(stageId) {
    var stage = CLINIC_PIPELINE_STAGES.find(function (item) { return item.id === stageId; }) || state.stages.find(function (item) { return item.id === stageId; });
    return stage ? stage.name : 'Sin etapa';
  }

  function stageSelectFor(item, inList) {
    var select = document.createElement('select');
    select.setAttribute('aria-label', 'Cambiar etapa de ' + item.contact_name);
    if (inList) select.dataset.listStage = item.id;
    select.append(new Option('Sin etapa', ''));
    pipelineStages().filter(function (stage) { return !stage.archived || stage.id === item.stage_id; }).forEach(function (stage) {
      var option = new Option(stage.name + (stage.archived ? ' · Archivada' : ''), stage.id);
      option.disabled = Boolean(stage.archived); select.append(option);
    });
    if (item.stage_id && !Array.from(select.options).some(function (option) { return option.value === item.stage_id; })) {
      var unknown = new Option('Etapa actual sin identificar', item.stage_id); unknown.disabled = true; select.append(unknown);
    }
    if (state.stageCatalogStatus === 'error') {
      var retry = new Option('Reintentar carga de etapas del equipo', ''); retry.dataset.retryStages = ''; select.append(retry);
    }
    select.disabled = pendingStageMoves.has(item.id);
    select.value = item.stage_id || '';
    select.onchange = function () {
      if (select.selectedOptions[0]?.hasAttribute('data-retry-stages')) {
        select.value = item.stage_id || ''; loadStages(); return;
      }
      if (select.value !== (item.stage_id || '')) moveConversationStage(item, select.value, select);
    };
    return select;
  }

  function renderBulkBar() {
    var bar = document.querySelector('[data-inbox-bulkbar]');
    if (!bar) return;
    if (!hasPermission('messages.manage')) { state.bulkMode = false; state.bulkSelected.clear(); }
    bar.hidden = !state.bulkMode;
    if (!state.bulkMode) { bar.innerHTML = ''; return; }
    var priorAssignee = bar.querySelector('[aria-label="Responsable para seleccionadas"]')?.value;
    bar.innerHTML = '';
    var count = node('strong', '', state.bulkSelected.size + ' seleccionadas');
    var assignee = document.createElement('select'); assignee.setAttribute('aria-label', 'Responsable para seleccionadas');
    var rosters = Array.from(state.bulkSelected, function (id) {
      return teamFor(state.conversations.find(function (item) { return item.id === id; }));
    });
    var ready = rosters.length > 0 && rosters.every(function (r) { return r.status === 'ready'; });
    var members = ready ? rosters[0].members.filter(function (member) {
      return rosters.every(function (r) { return r.members.some(function (other) { return other.id === member.id; }); });
    }) : [];
    var failed = rosters.some(function (r) { return r.status === 'error'; });
    assignee.append(new Option(ready && !members.length ? 'Sin responsable en común' : !ready && rosters.length && !failed ? 'Consultando equipo…' : 'Responsable…', ''));
    members.forEach(function (member) { assignee.append(new Option(member.name, member.id)); });
    if (priorAssignee && members.some(function (member) { return member.id === priorAssignee; })) assignee.value = priorAssignee;
    assignee.disabled = !members.length || state.bulkRunning;
    var stage = document.createElement('select'); stage.setAttribute('aria-label', 'Etapa para seleccionadas');
    stage.append(new Option('Etapa…', '')); pipelineStages().filter(function (item) { return !item.archived; }).forEach(function (item) { stage.append(new Option(item.name, item.id)); });
    var assign = node('button', 'btn btn-secondary btn-sm', 'Asignar'); assign.type = 'button';
    assign.disabled = !assignee.value || state.bulkRunning;
    assignee.onchange = function () { assign.disabled = !assignee.value || state.bulkRunning; };
    assign.onclick = function () { if (assignee.value) applyBulkAction('assign', assignee.value); };
    var move = node('button', 'btn btn-secondary btn-sm', 'Mover'); move.type = 'button';
    move.disabled = !state.bulkSelected.size || state.bulkRunning; move.onclick = function () { if (stage.value) applyBulkAction('stage', stage.value); };
    var clear = node('button', 'smyl-inbox-bulk-clear', 'Limpiar'); clear.type = 'button'; clear.onclick = function () { state.bulkSelected.clear(); renderList(); };
    var branchButton = node('button', 'btn btn-secondary btn-sm', 'Sucursal…'); branchButton.type = 'button';
    branchButton.hidden = !multiBranch(); branchButton.disabled = !state.bulkSelected.size || state.bulkRunning;
    branchButton.onclick = function () { openBranchDialog(Array.from(state.bulkSelected).map(function (id) { return state.conversations.find(function (item) { return item.id === id; }); })); };
    bar.append(count, assignee, assign, stage, move, branchButton, clear);
    if (failed) {
      var retry = node('button', 'smyl-inbox-bulk-clear', 'Reintentar equipo'); retry.type = 'button';
      retry.onclick = function () {
        state.bulkSelected.forEach(function (id) { if (teamsByConversation.get(id)?.status === 'error') teamsByConversation.delete(id); });
        renderBulkBar();
      };
      bar.append(retry);
    }
  }

  function filterCount(filter) {
    return state.conversations.filter(function (item) {
      if (filter === 'unassigned') return !item.assignment;
      if (filter === 'attention') return item.needs_human;
      if (filter === 'mine') return item.assignment && item.assignment.actor_id === (state.actor && state.actor.id);
      if (filter === 'unread') return item.unread_count;
      if (filter === 'paused') return item.paused;
      if (filter === 'pinned') return item.pinned;
      return true;
    }).length;
  }

  // Sucursales: la barra y los avisos solo aparecen cuando la clínica tiene más de una sede.
  function multiBranch() { return state.branches.length > 1; }
  function seesWholeClinic() { return Boolean(state.actor && state.actor.scopes && state.actor.scopes.messages === 'clinic'); }
  // ── Sucursal: un botón compacto junto al buscador (filtrar) y otro en la cabecera de la conversación (asignar) ──
  var BRANCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>';
  // Una sola pasada por la lista (antes se recorría una vez por cada sucursal). Cuenta lo ya cargado.
  function branchCounts() {
    var counts = { all: 0, none: 0, byId: {} };
    state.conversations.forEach(function (item) {
      counts.all += 1;
      if (!item.branch) counts.none += 1; else counts.byId[item.branch.id] = (counts.byId[item.branch.id] || 0) + 1;
    });
    return counts;
  }
  function branchLabel(value) {
    if (value === 'none') return 'Sin sucursal';
    if (!value) return 'Todas';
    var found = state.branches.find(function (branch) { return branch.id === value; });
    return found ? found.name : 'Sucursal';
  }
  function closeBranchMenu(restoreFocus) {
    var open = state.branchMenu;
    if (!open) return;
    state.branchMenu = null;
    document.removeEventListener('mousedown', outsideBranchMenu, true);
    if (open.menu && open.menu.parentNode) open.menu.remove();
    if (open.button) { open.button.setAttribute('aria-expanded', 'false'); if (restoreFocus) open.button.focus(); }
  }

  function closeThreadOptions(restoreFocus) {
    var panel = document.querySelector('[data-thread-options-panel]');
    if (!panel || panel.hidden) return;
    var trigger = document.querySelector('[data-thread-options]');
    if (state.branchMenu && panel.contains(state.branchMenu.wrap)) closeBranchMenu(false);
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({preventScroll:true});
  }

  function initThreadOptions(page) {
    var head = page.querySelector('.smyl-inbox-thread-head');
    var contact = head.querySelector('.smyl-inbox-thread-contact');
    var actions = head.querySelector('.smyl-inbox-thread-actions');
    var owner = head.querySelector('[data-thread-owner]');
    var branch = head.querySelector('[data-thread-branch-wrap]');
    var mode = head.querySelector('[data-thread-mode]');
    var primary = head.querySelector('[data-thread-carebar]');
    var trigger = head.querySelector('[data-thread-options]');
    var panel = head.querySelector('[data-thread-options-panel]');

    // El panel de Pipeline y la ficha pueden estrechar el hilo en un monitor grande.
    // Mover los controles existentes mantiene su estado y sus permisos al cambiar de ancho.
    function fitHeader() {
      var width = head.clientWidth;
      if (!width) { closeThreadOptions(false); return; }
      var compact = width <= 700;
      if (compact === head.classList.contains('is-compact')) return;
      var focused = document.activeElement;
      var focusInControls = owner.contains(focused) || branch.contains(focused) || mode.contains(focused);
      if (state.branchMenu && state.branchMenu.wrap === branch) closeBranchMenu(false);
      closeThreadOptions(false);
      trigger.hidden = !compact;
      head.classList.toggle('is-compact', compact);
      if (compact) {
        panel.append(owner, branch, mode);
        if (focusInControls) trigger.focus({preventScroll:true});
      } else {
        contact.append(owner);
        primary.before(branch, mode);
        if (focusInControls || focused === trigger || focused === panel) {
          var target = focusInControls && focused.isConnected ? focused : (owner.disabled ? contact.querySelector('[data-inbox-context]') : owner);
          target.focus({preventScroll:true});
        }
      }
    }
    trigger.addEventListener('click', function () {
      if (!panel.hidden) { closeThreadOptions(true); return; }
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      var first = Array.from(panel.querySelectorAll('button:enabled')).find(function (button) { return button.getClientRects().length; });
      (first || panel).focus({preventScroll:true});
    });
    document.addEventListener('pointerdown', function (event) {
      if (!panel.hidden && !panel.contains(event.target) && !trigger.contains(event.target) && !event.target.closest('dialog[open]')) closeThreadOptions(false);
    }, true);
    document.addEventListener('focusin', function (event) {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== trigger && !event.target.closest('dialog[open]')) closeThreadOptions(false);
    });
    head.addEventListener('keydown', function (event) {
      if (panel.hidden || event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (state.branchMenu && panel.contains(state.branchMenu.wrap)) closeBranchMenu(true);
      else closeThreadOptions(true);
    });
    fitHeader();
    if (window.ResizeObserver) new ResizeObserver(fitHeader).observe(head);
    else window.addEventListener('resize', fitHeader);
  }
  function outsideBranchMenu(event) {
    if (state.branchMenu && !state.branchMenu.wrap.contains(event.target)) closeBranchMenu(false);
  }
  // items: [{label, count?, checked, warn?, run}] o {divider:true}
  function toggleBranchMenu(kind, wrap, button, items) {
    if (state.branchMenu && state.branchMenu.button === button) { closeBranchMenu(true); return; }
    closeBranchMenu(false);
    var menu = node('div', 'smyl-inbox-menu'); menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', kind === 'filter' ? 'Filtrar por sucursal' : 'Sucursal de la conversación');
    items.forEach(function (item) {
      if (item.divider) { menu.append(document.createElement('hr')); return; }
      var option = node('button', 'smyl-inbox-menu-option' + (item.warn ? ' is-warn' : ''));
      option.type = 'button'; option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', item.checked ? 'true' : 'false');
      option.append(node('span', '', item.label));
      if (item.count !== undefined) option.append(node('small', '', String(item.count)));
      option.onclick = function () { closeBranchMenu(true); item.run(); };
      menu.append(option);
    });
    menu.dataset.kind = kind;
    wrap.append(menu); button.setAttribute('aria-expanded', 'true');
    state.branchMenu = { menu: menu, button: button, wrap: wrap };
    document.addEventListener('mousedown', outsideBranchMenu, true);
    menu.addEventListener('keydown', function (event) { menuKeydown(event, menu, closeBranchMenu); });
    var start = menu.querySelector('[aria-checked="true"]') || menu.querySelector('button');
    if (start) start.focus();
  }
  function filterMenuItems() {
    var counts = branchCounts(), items = [{ label: 'Todas las sucursales', count: counts.all, checked: !state.branchFilter, run: function () { state.branchFilter = ''; renderList(); } }];
    state.branches.forEach(function (branch) {
      items.push({ label: branch.name, count: counts.byId[branch.id] || 0, checked: state.branchFilter === branch.id, run: function () { state.branchFilter = branch.id; renderList(); } });
    });
    if (seesWholeClinic()) {
      items.push({ divider: true });
      items.push({ label: 'Sin sucursal', count: counts.none, warn: counts.none > 0, checked: state.branchFilter === 'none', run: function () { state.branchFilter = 'none'; renderList(); } });
    }
    return items;
  }
  function renderBranchBar() {
    var host = document.querySelector('[data-inbox-branchbar]'), strip = document.querySelector('[data-inbox-branch-strip]');
    if (!host) return;
    host.hidden = !multiBranch();
    if (!multiBranch()) {
      closeBranchMenu(false); host.innerHTML = ''; state.branchFilter = '';
      if (strip) { strip.hidden = true; strip.innerHTML = ''; }
      return;
    }
    if (state.branchFilter && state.branchFilter !== 'none' && !state.branches.some(function (branch) { return branch.id === state.branchFilter; })) state.branchFilter = '';
    var counts = branchCounts(), label = branchLabel(state.branchFilter);
    var button = host.querySelector('[data-inbox-branch-chip]');
    if (!button) {
      // Se crea una sola vez y después se actualiza en su sitio: un refresco de la lista ya no cierra el menú abierto.
      button = node('button', 'smyl-inbox-iconchip'); button.type = 'button'; button.setAttribute('data-inbox-branch-chip', '');
      button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
      button.innerHTML = BRANCH_ICON + '<i class="smyl-inbox-chip-dot" hidden></i>';
      button.onclick = function () { toggleBranchMenu('filter', host, button, filterMenuItems()); };
      host.append(button);
    }
    var needsBranch = seesWholeClinic() && counts.none > 0 && state.branchFilter !== 'none';
    button.dataset.active = state.branchFilter ? 'true' : 'false';
    button.querySelector('.smyl-inbox-chip-dot').hidden = !needsBranch;
    button.setAttribute('aria-label', 'Sucursal: ' + label + (needsBranch ? '. ' + counts.none + (counts.none === 1 ? ' conversación sin sucursal' : ' conversaciones sin sucursal') : ''));
    button.title = 'Sucursal: ' + label + (needsBranch ? ' · ' + counts.none + ' sin sucursal' : '');
    if (strip) {
      strip.hidden = !state.branchFilter; strip.innerHTML = '';
      if (state.branchFilter) {
        var shown = state.branchFilter === 'none' ? counts.none : (counts.byId[state.branchFilter] || 0);
        var clear = node('button', 'smyl-inbox-strip-clear', 'Quitar'); clear.type = 'button'; clear.setAttribute('aria-label', 'Quitar el filtro de sucursal');
        clear.onclick = function () { state.branchFilter = ''; renderList(); };
        strip.append(node('span', '', 'Sucursal: ' + label + ' · ' + shown + (shown === 1 ? ' conversación' : ' conversaciones')), clear);
      }
    }
  }
  // Asignar la sucursal de UNA conversación con un clic, sin pasar por el menú «⋯» ni el cuadro de opciones.
  async function setConversationBranch(conversation, branchId) {
    try {
      var data = await request('POST', {}, { action: 'set_branch', conversation_id: conversation.id, branch_id: branchId || null }, uuid());
      var current = state.conversations.find(function (item) { return item.id === conversation.id; });
      if (current) current.branch = data.branch || null;
      renderList(); if (state.selectedId === conversation.id) { renderThreadHeader(); renderContext(); }
      await loadList(true);
    } catch (error) { window.alert((error && error.message) || 'No se pudo asignar la sucursal.'); }
  }
  function threadBranchMenuItems(conversation) {
    var items = state.branches.map(function (branch) {
      return { label: branch.name, checked: Boolean(conversation.branch && conversation.branch.id === branch.id), run: function () { setConversationBranch(conversation, branch.id); } };
    });
    if (seesWholeClinic() && conversation.branch) { items.push({ divider: true }); items.push({ label: 'Sin sucursal (quitar)', warn: true, run: function () { setConversationBranch(conversation, null); } }); }
    return items;
  }
  function renderThreadBranchChip(conversation) {
    var wrap = document.querySelector('[data-thread-branch-wrap]'), button = document.querySelector('[data-thread-branch-chip]');
    if (!wrap || !button) return;
    wrap.hidden = !multiBranch();
    if (!multiBranch()) { closeBranchMenu(false); return; }
    var current = conversation.branch, canAssign = hasPermission('messages.manage');
    button.innerHTML = BRANCH_ICON;
    var copy = node('span', 'smyl-thread-branch-copy');
    copy.append(node('small', 'smyl-thread-option-label', 'Sucursal'), node('span', '', current ? current.name : 'Sin sucursal'));
    button.append(copy);
    button.dataset.state = current ? 'set' : 'none';
    button.disabled = !canAssign;
    button.title = current && current.source === 'ai' ? 'La eligió el paciente en la conversación' : canAssign ? 'Cambiar la sucursal de esta conversación' : 'Sucursal de esta conversación';
    button.setAttribute('aria-label', 'Sucursal de la conversación: ' + (current ? current.name : 'sin sucursal') + (canAssign ? '. Cambiar' : ''));
    button.onclick = function () { toggleBranchMenu('thread', wrap, button, threadBranchMenuItems(conversation)); };
  }
  async function loadBranches() {
    try { var data = await request('GET', { action: 'branches' }); state.branches = data.branches || []; if (data.actor && data.actor.chat_access) setChatActor(data.actor); render(); } catch (_) {}
  }
  function openBranchDialog(conversations) {
    var list = conversations.filter(Boolean);
    if (!list.length || !multiBranch()) return;
    var dialog = document.createElement('dialog');
    dialog.className = 'smyl-inbox-branch-dialog';
    var current = list.length === 1 && list[0].branch ? list[0].branch.id : '';
    var choices = state.branches.map(function (branch) { return [branch.id, branch.name]; });
    if (seesWholeClinic()) choices.push(['', 'Sin sucursal (quitar la sucursal)']);
    dialog.innerHTML = '<form method="dialog"><h2>' + (list.length === 1 ? 'Sucursal de esta conversación' : 'Sucursal para ' + list.length + ' conversaciones') + '</h2><p>Quienes pertenecen a esa sucursal la verán en su bandeja y recibirán sus avisos. Quienes no, dejarán de verla.</p><div class="smyl-inbox-branch-options">' + choices.map(function (choice) {
      return '<label><input type="radio" name="branch" value="' + choice[0] + '"' + (current && choice[0] === current ? ' checked' : '') + '> <span>' + choice[1].replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span></label>';
    }).join('') + '</div><p class="smyl-inbox-branch-error" data-branch-error role="alert" hidden></p><footer><button type="button" class="btn btn-secondary" data-branch-cancel>Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></footer></form>';
    document.body.append(dialog);
    dialog.querySelector('[data-branch-cancel]').onclick = function () { dialog.close(); };
    dialog.addEventListener('close', function () { dialog.remove(); });
    dialog.querySelector('form').onsubmit = async function (event) {
      event.preventDefault();
      var picked = dialog.querySelector('input[name=branch]:checked');
      var error = dialog.querySelector('[data-branch-error]');
      if (!picked) { error.textContent = 'Elige una sucursal.'; error.hidden = false; return; }
      var submit = dialog.querySelector('[type=submit]'); submit.disabled = true;
      var failed = 0;
      for (var i = 0; i < list.length; i += 1) {
        try {
          var data = await request('POST', {}, { action: 'set_branch', conversation_id: list[i].id, branch_id: picked.value || null }, uuid());
          var currentChat = state.conversations.find(function (item) { return item.id === list[i].id; });
          if (currentChat) currentChat.branch = data.branch || null;
        } catch (err) { failed += 1; error.textContent = (err && err.message) || 'No se pudo asignar la sucursal.'; error.hidden = false; }
      }
      submit.disabled = false;
      if (failed) { await loadList(true); render(); return; }
      dialog.close(); state.bulkSelected.clear(); state.bulkMode = false;
      await loadList(true); render();
    };
    dialog.showModal();
  }

  function renderFilterControls() {
    document.querySelectorAll('[data-channel-value]').forEach(function (chip) { chip.setAttribute('aria-pressed', String(chip.dataset.channelValue === state.channel)); });
    var advanced = ['paused', 'pinned', 'unassigned'].indexOf(state.filter) !== -1 || Boolean(state.channel);
    document.querySelectorAll('[data-inbox-filter]').forEach(function (button) {
      var filter = button.dataset.inboxFilter;
      var coord = state.actor && state.actor.chat_access === 'coordinator';
      if (filter === 'mine' || filter === 'unassigned') button.hidden = !coord;
      var labels = { all: coord ? 'Del equipo' : 'Mis chats', unassigned: 'Sin asignar', attention: 'Por atender', mine: 'Mías', unread: 'Sin leer', paused: 'En atención', pinned: 'Fijadas' };
      var selected = filter === state.filter;
      button.classList.toggle('active', selected);
      if (button.getAttribute('role') === 'tab') {
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
        if (filter === 'all' && ['unassigned', 'paused', 'pinned'].indexOf(state.filter) !== -1) button.tabIndex = 0;
      } else button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      // Counts belong to queue tabs. The popover is a compact choice, not another queue summary.
      var shownCount = button.getAttribute('role') === 'tab' ? filterCount(filter) : 0;
      button.innerHTML = '<span>' + labels[filter] + '</span>' + (shownCount || filter === 'all' ? '<b>' + shownCount + '</b>' : '');
    });
    var toggle = document.querySelector('[data-inbox-filter-more]');
    var panel = document.querySelector('[data-inbox-filter-panel]');
    if (toggle) {
      toggle.setAttribute('aria-expanded', state.filterPanelOpen ? 'true' : 'false');
      toggle.dataset.active = advanced ? 'true' : 'false';
      toggle.setAttribute('aria-label', advanced ? 'Filtros activos' : 'Filtros');
      toggle.title = toggle.getAttribute('aria-label');
    }
    if (panel) panel.hidden = !state.filterPanelOpen;
  }

  function toggleInboxFilters() {
    state.filterPanelOpen = !state.filterPanelOpen;
    renderFilterControls();
    if (state.filterPanelOpen) {
      var panel = document.querySelector('[data-inbox-filter-panel]');
      (panel.querySelector('[aria-pressed="true"]:not([hidden])') || panel.querySelector('button:not([hidden])') || panel.querySelector('select')).focus({preventScroll:true});
    }
  }

  function rovingTabsKeydown(event) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) === -1) return;
    var tabs = Array.from(event.currentTarget.querySelectorAll('[role="tab"]')).filter(function (tab) { return !tab.disabled && !tab.hidden; });
    if (!tabs.length) return;
    var current = Math.max(0, tabs.indexOf(document.activeElement));
    var next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }

  // Sin canales conectados (o sin respuesta del servicio de mensajería) no hay conversaciones ni hilo que mostrar:
  // se reemplaza todo el espacio de trabajo por una sola explicación con la acción para resolverlo.
  function renderOffline(host) {
    host.innerHTML = '';
    var card = node('div', 'smyl-inbox-offline-card');
    var marks = node('div', 'smyl-inbox-offline-channels');
    ['whatsapp', 'instagram', 'messenger'].forEach(function (channel) {
      var mark = node('span', 'smyl-inbox-offline-mark'); mark.title = channelLabel(channel); mark.innerHTML = CHANNEL_MARKS[channel] || ''; marks.append(mark);
    });
    var detail = String(state.listError || '').replace(/\bde LANA\b/g, 'del servicio de mensajería').replace(/\bLANA\b/g, 'el servicio de mensajería').trim();
    card.append(
      marks,
      node('span', 'smyl-inbox-eyebrow', 'MENSAJES'),
      node('h2', '', 'Conecta tus canales para atender mensajes aquí'),
      node('p', '', 'Cuando conectes WhatsApp, Instagram o Messenger, las conversaciones de tus pacientes aparecerán en este espacio y podrás responderlas sin salir de SMYL.')
    );
    var actions = node('div', 'smyl-inbox-offline-actions');
    var connect = node('button', 'btn btn-primary', 'Conectar canales'); connect.type = 'button';
    connect.onclick = function () { if (typeof window.ir === 'function') window.ir('conexiones'); };
    var retry = node('button', 'btn btn-secondary', 'Intentar de nuevo'); retry.type = 'button';
    retry.onclick = function () { loadList(true); };
    actions.append(connect, retry); card.append(actions);
    if (detail) card.append(node('small', 'smyl-inbox-offline-detail', 'Detalle: ' + detail));
    host.append(card);
  }

  function renderList() {
    var list = document.querySelector('[data-inbox-list]');
    var more = document.querySelector('[data-inbox-more]');
    var summary = document.querySelector('[data-inbox-queue-summary]');
    if (!list) return;
    renderBulkBar(); renderFilterControls(); renderBranchBar();
    var focusedStage = list.contains(document.activeElement) && document.activeElement.dataset.listStage;
    list.innerHTML = '';
    if (state.loadingList && !state.conversations.length) {
      list.innerHTML = sk('list', { rows: 6, label: 'Cargando conversaciones' });
      renderPipeline();
      return;
    }
    var workspace = document.querySelector('.smyl-inbox-workspace');
    var offlinePane = document.querySelector('[data-inbox-offline]');
    var offline = Boolean(state.listError && !state.conversations.length);
    if (workspace) { if (offline) workspace.dataset.state = 'offline'; else delete workspace.dataset.state; }
    if (offlinePane) { offlinePane.hidden = !offline; if (offline) renderOffline(offlinePane); }
    if (offline) { renderPipeline(); return; }
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
      var personal = state.actor && state.actor.chat_access === 'agent' && state.filter === 'all' && !state.search && !state.channel && !state.branchFilter;
      empty.append(node('strong', '', state.hasMore ? 'Hay más conversaciones por consultar' : personal ? 'Aún no tienes chats asignados' : 'No hay conversaciones aquí'), node('p', '', state.hasMore ? 'Usa Cargar más conversaciones para continuar la búsqueda.' : personal ? 'Las conversaciones que te transfiera el equipo aparecerán aquí.' : 'Prueba otro filtro o espera un mensaje nuevo de tus canales.'));
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
      avatar.append(channelBadge(item.channel));
      var copy = node('span', 'smyl-inbox-row-copy');
      var top = node('span', 'smyl-inbox-row-top');
      var identity = node('span', 'smyl-inbox-row-identity');
      if (item.pinned) identity.append(node('span', 'smyl-inbox-pin-mark', '●'));
      identity.append(node('strong', '', item.contact_name));
      top.append(identity, node('time', '', timeLabel(item.last_message_at)));
      var preview = node('span', 'smyl-inbox-preview', item.last_message || 'Conversación sin vista previa');
      var meta = node('span', 'smyl-inbox-row-meta');
      if (item.needs_human) meta.append(node('span', 'smyl-inbox-attention', 'Por atender'));
      else if (item.paused) meta.append(node('span', 'smyl-inbox-state is-paused', 'Con el equipo'));
      if (item.assignment) meta.append(node('span', 'smyl-inbox-assignee', item.assignment.name));
      if (multiBranch()) meta.append(item.branch ? node('span', 'smyl-inbox-branch', item.branch.name) : node('span', 'smyl-inbox-branch is-none', 'Sin sucursal'));
      if (multiBranch() && item.branch && item.branch.source === 'ai') meta.lastChild.title = 'La eligió el paciente en la conversación';
      if (multiBranch() && !item.branch) { meta.lastChild.title = 'Sin sucursal'; meta.lastChild.setAttribute('role', 'img'); meta.lastChild.setAttribute('aria-label', 'Sin sucursal'); }
      copy.append(top, preview, meta);
      var canPickStage = !state.bulkMode && canTransfer(item);
      var currentStage = stageName(item.stage_id);
      var appointmentLine = appointmentCardLine(item.appointment);
      var sharesAppointmentStatus = canPickStage && appointmentLine &&
        CLINIC_PIPELINE_STAGES.some(function (stage) { return stage.id === item.stage_id; }) &&
        currentStage === appointmentStatusLabel(item.appointment.status);
      if (sharesAppointmentStatus) button.setAttribute('aria-description', appointmentLine.textContent);
      else if (appointmentLine) copy.append(appointmentLine);
      else if (item.appointment) button.title = appointmentStatusLabel(item.appointment.status);
      if (!canPickStage && currentStage !== 'Sin etapa' && (item.pipeline?.source !== 'agenda' || !appointmentLine)) {
        copy.append(node('span', 'smyl-inbox-row-stage-line', currentStage));
      }
      button.append(avatar, copy);
      if (item.unread_count) button.append(node('span', 'smyl-inbox-unread', String(Math.min(99, item.unread_count))));
      button.addEventListener('click', function () {
        if (state.bulkMode) {
          if (state.bulkSelected.has(item.id)) state.bulkSelected.delete(item.id); else state.bulkSelected.add(item.id);
          renderList(); return;
        }
        openConversation(item.id);
      });
      if (canPickStage) {
        var card = node('article', 'smyl-inbox-list-card');
        card.dataset.listConversationId = item.id;
        if (pendingStageMoves.has(item.id)) card.setAttribute('aria-busy', 'true');
        var footer = node('div', 'smyl-inbox-list-card-footer');
        var stageControl = node('div', 'smyl-inbox-list-stage');
        stageControl.append(stageSelectFor(item, true));
        footer.append(stageControl);
        var date = sharesAppointmentStatus && appointmentLine.querySelector('time');
        if (date) { date.title = appointmentLine.textContent; footer.append(date); }
        card.append(button, footer); list.append(card);
      } else list.append(button);
    });
    if (focusedStage) list.querySelector('[data-list-stage="' + CSS.escape(focusedStage) + '"]')?.focus({preventScroll:true});
    if (more) { more.hidden = !state.hasMore; more.disabled = state.loadingList; more.textContent = state.loadingList ? 'Cargando…' : 'Cargar más conversaciones'; }
    renderPipeline();
  }

  var PIPELINE_COLORS = ['#2F6FA3', '#394ab9', '#7A5AA6', '#B7791F', '#2E8B57', '#B4536A', '#5B6B7A'];

  function appointmentStatusLabel(status) {
    var labels = { confirmed:'Cita confirmada', arrived:'Llegó', checked_in:'Llegó', in_progress:'En consulta', completed:'Atendido', attended:'Atendido',
      cancelled:'Cita cancelada', no_show:'No asistió', scheduled:'Cita agendada', pending:'Cita por confirmar' };
    return labels[status] || 'Cita';
  }

  // La fecha operativa es la de la sede, incluso cuando el equipo abre el chat desde otro huso.
  var pipelineDayFormats = new Map();
  function appointmentIsToday(appointment, now) {
    if (!appointment?.id || !['scheduled','confirmed','arrived','checked_in','in_progress','completed','attended'].includes(appointment.status)) return false;
    var starts = new Date(appointment.starts_at || '');
    if (!Number.isFinite(starts.getTime())) return false;
    var zone = appointment.timezone || 'UTC';
    var format = pipelineDayFormats.get(zone);
    if (!format) {
      try { format = new Intl.DateTimeFormat('en-CA', { timeZone:zone }); }
      catch (_) { format = new Intl.DateTimeFormat('en-CA', { timeZone:'UTC' }); }
      pipelineDayFormats.set(zone, format);
    }
    return format.format(starts) === format.format(now);
  }

  function appointmentCardLine(appointment, columnStage) {
    if (!appointment?.id || ['cancelled','no_show'].includes(appointment.status)) return null;
    var completed = ['attended','completed'].includes(appointment.status);
    if (completed && (columnStage === undefined || !state.pipelineToday)) return null;
    var line = node('span', 'smyl-inbox-card-appointment');
    line.dataset.status = appointment.status || '';
    var date = new Date(appointment.starts_at || '');
    var stageDate = Number.isFinite(date.getTime()) && ((columnStage === 'smyl:confirmed' && appointment.status === 'confirmed') ||
      (columnStage === 'smyl:arrived' && ['arrived','checked_in'].includes(appointment.status)) || (columnStage === 'smyl:attended' && completed));
    if (stageDate) {
      line.classList.add('is-stage-date');
      line.innerHTML = composeIcon('calendar');
    } else line.append(node('strong', '', appointmentStatusLabel(appointment.status)));
    if (Number.isFinite(date.getTime())) {
      var options = { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' };
      if (appointment.timezone) options.timeZone = appointment.timezone;
      var formatted;
      try { formatted = date.toLocaleString('es-MX', options); }
      catch (_) { delete options.timeZone; formatted = date.toLocaleString('es-MX', options); }
      var time = node('time', '', formatted); time.dateTime = date.toISOString();
      var atClinic = ['arrived','checked_in','in_progress'].includes(appointment.status);
      if (!stageDate) line.append(document.createTextNode(atClinic ? ' · Cita ' : ' · '));
      line.append(time);
    }
    return line;
  }

  function pipelineColumns() {
    var stages = pipelineStages();
    var known = new Set(stages.map(function (stage) { return stage.id; }));
    var visible = visibleConversations();
    if (state.pipelineToday && hasPermission('schedule.read')) {
      var now = new Date();
      visible = visible.filter(function (item) { return appointmentIsToday(item.appointment, now); });
      visible.sort(function (a, b) { return Date.parse(a.appointment.starts_at) - Date.parse(b.appointment.starts_at); });
    }
    var columns = [];
    var unstaged = visible.filter(function (item) { return !item.stage_id || !known.has(item.stage_id); });
    columns.push({ id: '', name: 'Sin etapa', color: '#94A3B8', items: unstaged });
    stages.forEach(function (stage, index) {
      var items = visible.filter(function (item) { return item.stage_id === stage.id; });
      if (stage.archived && !items.length) return;
      columns.push({ id: stage.id, name: stage.name + (stage.archived ? ' · Archivada' : ''), archived: stage.archived, color: stage.color || PIPELINE_COLORS[index % PIPELINE_COLORS.length], items: items });
    });
    return columns;
  }

  function pipelineCard(item, color) {
    var movable = canTransfer(item);
    var busy = pendingStageMoves.has(item.id);
    var current = state.pipelineChatId === item.id;
    var card = node('article', 'smyl-inbox-pipeline-card' + (item.needs_human ? ' is-attention' : '') + (current ? ' is-current' : ''));
    card.dataset.conversationId = item.id; card.draggable = movable && !busy; card.style.setProperty('--stage-color', color);
    if (busy) card.setAttribute('aria-busy', 'true');
    var open = node('button', 'smyl-inbox-pipeline-open'); open.type = 'button'; open.setAttribute('aria-label', 'Abrir conversación con ' + item.contact_name);
    open.setAttribute('aria-controls', 'smyl-inbox-thread-pane'); open.setAttribute('aria-expanded', String(current));
    var top = node('span', 'smyl-inbox-pipeline-card-top');
    var avatar = node('span', 'smyl-inbox-avatar', initials(item.contact_name)); avatar.dataset.channel = item.channel; avatar.append(channelBadge(item.channel));
    top.append(avatar, node('strong', '', item.contact_name), node('time', '', timeLabel(item.last_message_at)));
    var meta = node('span', 'smyl-inbox-pipeline-card-meta');
    if (item.needs_human) meta.append(node('span', 'smyl-inbox-pipeline-badge is-attention', 'Por atender'));
    else if (item.paused) meta.append(node('span', 'smyl-inbox-pipeline-badge is-team', 'Con el equipo'));
    else meta.append(node('span', 'smyl-inbox-pipeline-badge is-ai', 'IA activa'));
    if (item.assignment) meta.append(node('span', 'smyl-inbox-pipeline-assignee', item.assignment.name));
    if (item.unread_count) meta.append(node('span', 'smyl-inbox-pipeline-unread', String(Math.min(99, item.unread_count))));
    open.append(top, node('span', 'smyl-inbox-pipeline-preview', item.last_message || 'Conversación sin vista previa'), meta);
    var appointmentLine = appointmentCardLine(item.appointment, item.stage_id);
    if (appointmentLine) open.append(appointmentLine);
    else if (item.appointment) {
      open.title = appointmentStatusLabel(item.appointment.status);
      open.setAttribute('aria-description', open.title);
    }
    open.onclick = function () { openConversation(item.id); };
    card.append(open);
    if (movable) {
      // Alternativa al arrastre para pantallas táctiles y teclado.
      var move = node('label', 'smyl-inbox-pipeline-move'); move.title = 'Mover a otra etapa';
      var moveIcon = node('span'); moveIcon.setAttribute('aria-hidden', 'true'); moveIcon.innerHTML = composeIcon('moveStage');
      var select = stageSelectFor(item, false);
      move.append(moveIcon, select); card.append(move);
      card.addEventListener('dragstart', function (event) {
        if (!card.draggable || event.target.closest('select, label')) { event.preventDefault(); return; }
        state.pipelineDragId = item.id; card.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id);
      });
      card.addEventListener('dragend', function () {
        state.pipelineDragId = null; card.classList.remove('is-dragging');
        document.querySelectorAll('.smyl-inbox-pipeline-column.is-drop').forEach(function (column) { column.classList.remove('is-drop'); });
      });
    }
    return card;
  }

  function renderPipeline() {
    var section = document.querySelector('[data-inbox-pipeline]');
    var board = document.querySelector('[data-pipeline-board]');
    if (!section || !board) return;
    section.hidden = state.view !== 'pipeline';
    if (state.view !== 'pipeline' || state.pipelineDragId) return;
    // On phones the open conversation temporarily hides the board. Preserve its
    // scroll containers until they have a visible size again.
    if (state.pipelineChatId && !board.clientWidth && board.childElementCount) return;
    var today = section.querySelector('[data-pipeline-today]');
    today.hidden = !hasPermission('schedule.read');
    today.setAttribute('aria-pressed', String(state.pipelineToday && !today.hidden));
    var more = section.querySelector('[data-pipeline-more]');
    more.hidden = !state.hasMore && !state.listError;
    more.disabled = state.loadingList;
    more.textContent = state.listError ? 'Reintentar' : state.loadingList ? 'Cargando…' : 'Cargar más';
    if (state.pipelineToday && !today.hidden && state.hasMore && !state.loadingList && !state.listError) {
      setTimeout(function () {
        if (state.view === 'pipeline' && state.pipelineToday && state.hasMore && !state.loadingList && !state.listError && document.visibilityState === 'visible' && section.closest('.pantalla.activa')) loadList(false);
      }, 0);
    }
    var focus = document.activeElement, focusedCard = board.contains(focus) && focus.closest('[data-conversation-id]');
    var focusedId = focusedCard && focusedCard.dataset.conversationId, focusedControl = focus?.tagName === 'SELECT' ? 'select' : 'button';
    var scroll = board.scrollLeft;
    var columnScroll = new Map(Array.from(board.querySelectorAll('[data-pipeline-stage]'), function (column) {
      return [column.dataset.pipelineStage, column.querySelector('.smyl-inbox-pipeline-cards').scrollTop];
    }));
    board.innerHTML = '';
    if (state.loadingList && !state.conversations.length) { board.innerHTML = sk('cards', { count: 4, label: 'Cargando el tablero de conversaciones' }); return; }
    if (state.listError && !state.conversations.length) {
      var error = node('div', 'smyl-inbox-list-state');
      error.append(node('strong', '', 'No pudimos abrir el pipeline'), node('p', '', state.listError));
      board.append(error); return;
    }
    pipelineColumns().forEach(function (column) {
      var columnNode = node('section', 'smyl-inbox-pipeline-column'); columnNode.style.setProperty('--stage-color', column.color);
      columnNode.dataset.pipelineStage = column.id;
      columnNode.setAttribute('aria-label', column.name + ': ' + column.items.length + ' conversaciones');
      var head = node('header'); head.append(node('i'), node('strong', '', column.name), node('span', '', String(column.items.length)));
      var cards = node('div', 'smyl-inbox-pipeline-cards');
      if (!column.items.length) cards.append(node('p', 'smyl-inbox-pipeline-empty',
        state.pipelineToday ? (state.hasMore ? 'Sin citas cargadas' : 'Sin citas de hoy') : 'Sin conversaciones'));
      column.items.forEach(function (item) { cards.append(pipelineCard(item, column.color)); });
      columnNode.addEventListener('dragover', function (event) {
        if (!state.pipelineDragId || column.archived) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; columnNode.classList.add('is-drop');
      });
      columnNode.addEventListener('dragleave', function (event) { if (!columnNode.contains(event.relatedTarget)) columnNode.classList.remove('is-drop'); });
      columnNode.addEventListener('drop', function (event) {
        event.preventDefault(); columnNode.classList.remove('is-drop');
        var id = state.pipelineDragId; state.pipelineDragId = null;
        var conversation = state.conversations.find(function (item) { return item.id === id; });
        if (!column.archived && conversation && (conversation.stage_id || '') !== column.id) moveConversationStage(conversation, column.id);
        else renderPipeline();
      });
      columnNode.append(head, cards); board.append(columnNode);
      cards.scrollTop = columnScroll.get(column.id) || 0;
    });
    board.scrollLeft = scroll;
    if (focusedId) board.querySelector('[data-conversation-id="' + CSS.escape(focusedId) + '"] ' + focusedControl)?.focus({preventScroll:true});
  }

  async function saveConversationStage(conversation, stageId) {
    if (!canTransfer(conversation)) throw new Error('Este chat está fuera de tu alcance.');
    if (pendingStageMoves.has(conversation.id)) throw new Error('El cambio de etapa sigue en curso.');
    var epoch = accessEpoch;
    pendingStageMoves.add(conversation.id);
    try {
      var revision = conversation.pipeline?.revision ?? 0;
      var data = await request('POST', {}, { action: 'stage', conversation_id: conversation.id, target_stage_id: stageId || null, expected_revision: revision }, uuid());
      if (epoch !== accessEpoch) return;
      var current = state.conversations.find(function (item) { return item.id === conversation.id; });
      if (current) applyConversationResult(current, data);
    } catch (error) {
      if (epoch === accessEpoch && error.status === 409) {
        var fresh = await request('GET', { action:'messages', conversation_id:conversation.id, limit:1 });
        if (epoch === accessEpoch && fresh.conversation?.id === conversation.id) mergeConversations([fresh.conversation], false);
        throw new Error('La etapa cambió mientras la editabas. Revisa la etapa actual y vuelve a elegir.');
      }
      throw error;
    } finally { pendingStageMoves.delete(conversation.id); }
  }

  async function moveConversationStage(conversation, stageId, origin) {
    var board = document.querySelector('[data-pipeline-board]');
    var status = document.querySelector('[data-pipeline-status]');
    var fromList = Boolean(origin?.hasAttribute('data-list-stage'));
    var view = state.view, epoch = accessEpoch;
    var control = origin || board?.querySelector('[data-conversation-id="' + CSS.escape(conversation.id) + '"] select');
    var hadFocus = control && control === document.activeElement;
    if (control) { control.disabled = true; control.closest('article').setAttribute('aria-busy','true'); }
    var feedback;
    try {
      await saveConversationStage(conversation, stageId);
      feedback = 'Etapa guardada · ' + stageName(stageId);
    } catch (error) {
      feedback = error.message || 'No se pudo cambiar la etapa.';
    }
    if (epoch !== accessEpoch) return;
    renderList();
    if (state.selectedId === conversation.id) renderThreadHeader();
    if (fromList) announceHandoff(feedback);
    else if (status && state.view === 'pipeline') status.textContent = feedback;
    else if (document.querySelector('[data-settings-dialog][open] [data-stage-status]')) document.querySelector('[data-settings-dialog] [data-stage-status]').textContent = feedback;
    else announceHandoff(feedback);
    if (hadFocus && state.view === view && document.activeElement === document.body) {
      var next = fromList ? document.querySelector('[data-list-stage="' + CSS.escape(conversation.id) + '"]')
        : board?.querySelector('[data-conversation-id="' + CSS.escape(conversation.id) + '"] select');
      next?.focus({preventScroll:true});
    }
  }

  function setPipelineChat(id, loading) {
    var board = document.querySelector('[data-pipeline-board]');
    if (id && !state.pipelineChatId) state.pipelineReturnScroll = board.scrollLeft;
    state.pipelineChatId = id;
    state.pipelineOpening = Boolean(id && loading);
    var page = document.getElementById('p-inbox');
    page.classList.toggle('pipeline-chat-open', Boolean(id));
    page.classList.toggle('pipeline-chat-opening', state.pipelineOpening);
    page.querySelector('[data-pipeline-opening]').hidden = !state.pipelineOpening;
    page.querySelector('[data-inbox-thread-empty]').inert = state.pipelineOpening;
    page.querySelector('[data-inbox-thread]').inert = state.pipelineOpening;
    var back = page.querySelector('[data-inbox-back]');
    back.title = id ? 'Volver al Pipeline' : 'Volver a la bandeja';
    back.setAttribute('aria-label', back.title);
    board.querySelectorAll('.smyl-inbox-pipeline-open').forEach(function (button) {
      var card = button.closest('[data-conversation-id]');
      var active = card.dataset.conversationId === id;
      card.classList.toggle('is-current', active);
      button.setAttribute('aria-expanded', String(active));
      if (active && loading && board.clientWidth) {
        var area = board.getBoundingClientRect(), rect = card.getBoundingClientRect();
        if (rect.right > area.right) board.scrollLeft += rect.right - area.right + 8;
        else if (rect.left < area.left) board.scrollLeft += rect.left - area.left - 8;
      }
    });
    if (!id && state.pipelineReturnScroll != null) {
      board.scrollLeft = state.pipelineReturnScroll;
      state.pipelineReturnScroll = null;
    }
  }

  function closePipelineChat(restoreFocus) {
    closeMessageMenu(false);
    var id = state.pipelineChatId;
    if (!id) return;
    closeChatMedia(); closeThreadOptions(false);
    openSequence++;
    var page = document.getElementById('p-inbox');
    closeComposerTools(false); closeBranchMenu(false);
    if (state.recorder) stopVoiceRecording(true);
    state.contextOpen = false; state.contextReturnFocus = null;
    syncContextAccessibility();
    setPipelineChat(null, false);
    page.classList.remove('show-thread');
    renderPipeline();
    if (restoreFocus) {
      var card = page.querySelector('[data-pipeline-board] [data-conversation-id="' + CSS.escape(id) + '"] .smyl-inbox-pipeline-open');
      (card || page.querySelector('[data-pipeline-search]')).focus({preventScroll:true});
    }
  }

  function setInboxView(view) {
    closeMessageMenu(false);
    var nextView = view === 'pipeline' ? 'pipeline' : 'list';
    var page = document.getElementById('p-inbox');
    if (state.view !== nextView) {
      closeChatMedia(); closeThreadOptions(false);
      if (state.pipelineChatId) closePipelineChat(false); else openSequence++;
      state.contextOpen = false; state.contextReturnFocus = null;
      closeBranchMenu(false); closeComposerTools(false);
      if (state.recorder) stopVoiceRecording(true);
      page.classList.toggle('show-thread', nextView === 'list' && Boolean(state.selectedId));
      syncContextAccessibility();
    }
    state.view = nextView;
    try { window.sessionStorage.setItem('smyl_inbox_view', state.view); } catch (_) {}
    if (page) page.classList.toggle('view-pipeline', state.view === 'pipeline');
    document.querySelectorAll('[data-inbox-view]').forEach(function (button) {
      var selected = button.dataset.inboxView === state.view;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
    var search = document.querySelector('[data-pipeline-search]'); if (search) search.value = state.search;
    renderPipeline();
  }

  function selectedConversation() {
    return state.conversations.find(function (item) { return item.id === state.selectedId; }) || null;
  }

  function mergeMessages(conversationId, items, prepend) {
    var existing = state.messages[conversationId] || [];
    var map = new Map(existing.map(function (item) { return [String(item.id), item]; }));
    var added = 0;
    (items || []).forEach(function (item) {
      var localEcho = false;
      if (item.client_request_id) {
        (state.pending[conversationId] || []).forEach(function (pending) {
          if (pending.key === item.client_request_id) { pending.reconciled = true; localEcho = true; pending.onMediaConfirmed?.(); }
        });
      }
      if (!prepend && !item.deleted && !localEcho && !map.has(String(item.id))) added++;
      map.set(String(item.id), item);
    });
    state.messages[conversationId] = Array.from(map.values()).sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
    state.pending[conversationId] = (state.pending[conversationId] || []).filter(function (item) { return !item.reconciled; });
    return added;
  }

  function atThreadBottom() {
    var body = document.querySelector('[data-thread-body]');
    return !body || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  }

  function updateThreadJump(away) {
    var jump = document.querySelector('[data-thread-jump]'); if (!jump) return;
    var label = threadNewCount ? threadNewCount + (threadNewCount === 1 ? ' mensaje nuevo' : ' mensajes nuevos') : 'Ir al final';
    var copy = jump.querySelector('span'); if (copy.textContent !== label) copy.textContent = label;
    jump.classList.toggle('has-new-messages', threadNewCount > 0);
    jump.setAttribute('aria-label', threadNewCount ? label + ' · Ir al final' : label);
    var announce = document.querySelector('[data-thread-jump-status]');
    var announcement = threadNewCount ? label : '';
    if (announce.textContent !== announcement) announce.textContent = announcement;
    jump.hidden = !away && !threadNewCount;
  }

  function resetThreadJump() {
    threadNewCount = 0; threadPaintDeferred = false;
    updateThreadJump(false);
  }

  function scrollThreadBottom() {
    var body = document.querySelector('[data-thread-body]');
    if (threadPaintDeferred && state.selectedId) renderMessages(false);
    if (body) body.scrollTop = body.scrollHeight;
    resetThreadJump();
  }

  function renderComposerContext() {
    var box = document.querySelector('[data-compose-context]');
    if (!box) return;
    box.innerHTML = '';
    var value = state.attachment || state.replyTo;
    box.hidden = !value;
    if (!value) return;
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.dataset.kind = state.attachment ? 'attachment' : 'reply';
    var copy = node('div', 'smyl-inbox-compose-context-copy');
    var sender = state.replyTo && (state.replyTo.author_type === 'patient' || state.replyTo.role === 'user')
      ? (selectedConversation()?.contact_name || 'Paciente') : state.replyTo?.author_type === 'team' ? 'Equipo de la clínica' : 'SMYL Asistente';
    copy.append(node('strong', '', state.attachment ? 'Adjunto listo' : 'Respondiendo a ' + sender));
    copy.append(node('span', '', state.attachment ? (state.attachment.name + ' · ' + Math.max(1, Math.round(state.attachment.size / 1024)) + ' KB') : replyPreview(state.replyTo)));
    if (state.attachment && attachmentKind(state.attachment) === 'audio') {
      var preview = document.createElement('audio'); preview.controls = true; preview.preload = 'metadata';
      preview.src = URL.createObjectURL(state.attachment); preview.onloadedmetadata = function () { URL.revokeObjectURL(preview.src); };
      copy.append(preview);
    }
    var clear = node('button', 'smyl-inbox-compose-context-clear', '×'); clear.type = 'button';
    clear.setAttribute('aria-label', state.attachment ? 'Quitar adjunto' : 'Cancelar respuesta');
    clear.title = clear.getAttribute('aria-label');
    clear.onclick = function () { state.attachment = null; state.replyTo = null; var input = document.querySelector('[data-compose-file]'); if (input) input.value = ''; renderComposerContext(); document.querySelector('#smyl-inbox-message')?.focus({preventScroll:true}); };
    box.append(copy, clear);
  }

  function replyPreview(item) {
    if (!item) return '';
    if (chatLocation(item)) return 'Ubicación compartida';
    var content = String(item.content || '').trim();
    var kind = {image:'Fotografía', audio:'Audio', document:'Documento', video:'Video', location:'Ubicación'}[item.media_type];
    return (kind ? kind + (item.media_filename ? ' · ' + item.media_filename : content ? ' · ' + content : '') : content || 'Mensaje').slice(0, 180);
  }

  function closeMessageMenu(restoreFocus) {
    var open = messageMenu; if (!open) return;
    messageMenu = null; state.actionsOpenId = null;
    document.removeEventListener('pointerdown', outsideMessageMenu, true);
    document.removeEventListener('focusin', outsideMessageMenu, true);
    window.removeEventListener('scroll', scrollMessageMenu, true);
    window.removeEventListener('resize', dismissMessageMenu);
    window.visualViewport?.removeEventListener('resize', dismissMessageMenu);
    open.menu.remove(); open.row.classList.remove('show-actions');
    open.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && open.button.isConnected) open.button.focus({preventScroll:true});
  }

  function outsideMessageMenu(event) {
    if (messageMenu && !messageMenu.menu.contains(event.target) && !messageMenu.button.contains(event.target)) closeMessageMenu(false);
  }
  function dismissMessageMenu() { closeMessageMenu(false); }
  function scrollMessageMenu(event) {
    if (messageMenu && !messageMenu.menu.contains(event.target)) closeMessageMenu(false);
  }

  function openMessageMenu(button, menu, row, item) {
    var wasOpen = messageMenu?.button === button;
    closeMessageMenu(false); if (wasOpen) return;
    closeComposerTools(false); closeBranchMenu(false);
    messageMenu = {button:button, menu:menu, row:row}; state.actionsOpenId = String(item.id);
    row.classList.add('show-actions'); button.setAttribute('aria-expanded', 'true');
    document.body.append(menu);
    // The top layer avoids clipping by the scrolling history and the Pipeline pane.
    if (typeof menu.showPopover === 'function') { menu.setAttribute('popover', 'manual'); menu.showPopover(); }
    var anchor = button.getBoundingClientRect(), bounds = row.closest('[data-thread-body]').getBoundingClientRect();
    var width = menu.offsetWidth, height = menu.offsetHeight, inset = 8;
    var leftEdge = Math.max(inset, bounds.left + inset), rightEdge = Math.min(innerWidth - inset, bounds.right - inset);
    var incoming = row.classList.contains('is-patient'), left = incoming ? anchor.right + 4 : anchor.left - width - 4;
    var sideFits = left >= leftEdge && left + width <= rightEdge;
    if (!sideFits) left = Math.max(leftEdge, Math.min(incoming ? anchor.left : anchor.right - width, rightEdge - width));
    var bubbleBounds = row.querySelector('.smyl-inbox-bubble').getBoundingClientRect();
    var top = sideFits ? anchor.top : Math.max(anchor.bottom, bubbleBounds.bottom) + 4;
    var floor = Math.min(innerHeight - inset, bounds.bottom - inset), ceiling = Math.max(inset, bounds.top + inset);
    if (top + height > floor) top = (sideFits ? anchor.bottom : Math.min(anchor.top, bubbleBounds.top) - 4) - height;
    menu.style.left = Math.max(inset, Math.min(left, innerWidth - width - inset)) + 'px';
    menu.style.top = Math.max(ceiling, Math.min(top, floor - height)) + 'px';
    menu.style.maxHeight = Math.max(44, floor - ceiling) + 'px';
    menuItems(menu)[0]?.focus({preventScroll:true});
    document.addEventListener('pointerdown', outsideMessageMenu, true);
    document.addEventListener('focusin', outsideMessageMenu, true);
    window.addEventListener('scroll', scrollMessageMenu, {capture:true, passive:true});
    window.addEventListener('resize', dismissMessageMenu);
    window.visualViewport?.addEventListener('resize', dismissMessageMenu);
  }

  function messageActions(item, row) {
    var menu = node('div', 'smyl-inbox-message-menu');
    menu.id = 'smyl-message-menu-' + (++messageMenuSequence);
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Opciones del mensaje');
    function action(label, run, className) {
      var control = node('button', className || '', label); control.type = 'button';
      control.setAttribute('role', 'menuitem'); control.tabIndex = -1;
      control.onclick = function () { closeMessageMenu(true); run(); }; menu.append(control);
    }
    if (hasPermission('messages.respond')) {
      action('Responder', function () { state.replyTo = item; state.attachment = null; renderComposerContext(); document.querySelector('#smyl-inbox-message')?.focus(); }, 'is-primary');
      action(item.starred ? 'Quitar estrella' : 'Destacar', function () { mutateMessage(item, item.starred ? 'unstar' : 'star'); });
      action('Reenviar', function () { openForward(item); });
    }
    if (item.media_type === 'image' && hasPermission('clinical.write')) action('Enviar a revisión clínica', function () { linkClinicalImage(item); }, 'is-clinical');
    if (item.author_type === 'assistant' && hasPermission('messages.respond')) action('Evaluar IA', function () { openFeedback(item); }, 'is-copilot');
    if (hasPermission('messages.manage')) action('Ocultar en el panel', function () { mutateMessage(item, 'delete'); }, 'is-danger');
    if (!menu.childNodes.length) return null;
    var rail = node('div', 'smyl-inbox-message-actions');
    var button = node('button', 'smyl-inbox-message-more'); button.type = 'button';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
    button.setAttribute('aria-label', 'Opciones del mensaje'); button.title = 'Opciones del mensaje';
    button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', menu.id); button.setAttribute('aria-expanded', 'false');
    button.onclick = function () { openMessageMenu(button, menu, row, item); };
    button.onkeydown = function (event) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMessageMenu(button, menu, row, item); if (event.key === 'ArrowUp') menuItems(menu).at(-1)?.focus(); } };
    menu.onkeydown = function (event) { if (event.key === 'Tab') { closeMessageMenu(true); return; } menuKeydown(event, menu, closeMessageMenu); };
    rail.append(button); return rail;
  }

  function renderCopilotDraft() {
    var panel = document.querySelector('[data-copilot-draft]');
    if (!panel) return;
    panel.innerHTML = '';
    var conversationId = state.selectedId;
    var result = conversationId && state.copilot[conversationId];
    var loadingMode = conversationId && state.copilotLoading[conversationId];
    var loading = loadingMode === 'draft' || loadingMode === 'rewrite';
    var appliedRewrite = Boolean(result && result.mode === 'rewrite_applied');
    var isRewrite = loadingMode === 'rewrite' || Boolean(result && (result.mode === 'rewrite' || result.mode === 'rewrite_applied'));
    panel.hidden = !loading && !(result && (result.mode === 'draft' || result.mode === 'rewrite' || result.mode === 'rewrite_applied'));
    if (panel.hidden) return;
    var head = node('div', 'smyl-inbox-copilot-head');
    head.append(
      node('strong', '', isRewrite ? 'MILA · Redacción' : 'SMYL Copilot'),
      node('span', '', appliedRewrite ? 'Aplicada en la caja · no enviada' : isRewrite ? 'Ortografía y claridad · no enviado' : 'Borrador interno · no enviado')
    );
    panel.append(head);
    if (loading) {
      panel.append(skNode('text', { lines: 3, label: isRewrite ? 'Corrigiendo ortografía y claridad sin cambiar el sentido' : 'Revisando el hilo y la capacitación publicada' }));
      return;
    }
    if (appliedRewrite) {
      panel.append(node('p', 'smyl-inbox-rewrite-applied', 'Texto corregido en la caja. Revísalo antes de enviar.'));
      var appliedActions = node('div', 'smyl-inbox-copilot-actions');
      var undo = node('button', 'btn btn-secondary btn-sm', 'Deshacer'); undo.type = 'button';
      undo.onclick = function () { setComposerText(result.original_text || ''); delete state.copilot[conversationId]; renderCopilotDraft(); };
      var done = node('button', 'btn btn-primary btn-sm', 'Listo'); done.type = 'button';
      done.onclick = function () { delete state.copilot[conversationId]; renderCopilotDraft(); document.querySelector('[name="message"]')?.focus(); };
      appliedActions.append(undo, done); panel.append(appliedActions); return;
    }
    if (result.requires_human) panel.append(node('p', 'is-warning', 'Copilot detectó contenido que requiere atención humana. Revisa con especial cuidado.'));
    var suggestion = result.rewritten_text || result.draft || '';
    panel.append(node('p', 'smyl-inbox-copilot-copy', suggestion));
    var tools = node('div', 'smyl-inbox-copilot-tools');
    (result.tools || []).filter(function (tool) { return tool.available; }).forEach(function (tool) { tools.append(node('span', '', tool.label)); });
    if (isRewrite && result.token_usage && Number(result.token_usage.total_tokens) > 0) {
      tools.append(node('span', '', Number(result.token_usage.total_tokens) + ' tokens registrados'));
    }
    if (tools.childNodes.length) panel.append(tools);
    var actions = node('div', 'smyl-inbox-copilot-actions');
    var use = node('button', 'btn btn-primary btn-sm', isRewrite ? 'Reemplazar borrador' : 'Usar como borrador'); use.type = 'button';
    use.onclick = function () { setComposerText(suggestion); delete state.copilot[conversationId]; renderCopilotDraft(); };
    var discard = node('button', 'btn btn-secondary btn-sm', 'Descartar'); discard.type = 'button'; discard.onclick = function () { delete state.copilot[conversationId]; renderCopilotDraft(); };
    actions.append(discard, use); panel.append(actions);
  }

  async function requestCopilot(mode) {
    var conversation = selectedConversation();
    if (!conversation || !canOperate(conversation, 'messages.respond') || state.copilotLoading[conversation.id]) return null;
    state.copilotLoading[conversation.id] = mode; renderCopilotDraft(); renderContext();
    try {
      var data = await request('POST', {}, { action: 'copilot', conversation_id: conversation.id, mode: mode, basis_at: mode === 'summary' ? (conversation.last_message_at || null) : undefined }, null, 35000);
      state.copilot[conversation.id] = data;
      if (mode === 'summary') state.f360Summary[conversation.id] = { data: data, basis: summaryBasis(conversation), at: data.generated_at || new Date().toISOString(), by: data.stored ? (data.generated_by_name || '') : '', loading: false, error: '' };
      return data;
    } catch (error) {
      window.alert(error.message || 'Copilot no pudo preparar una sugerencia.');
      return null;
    } finally {
      delete state.copilotLoading[conversation.id]; renderCopilotDraft(); renderContext();
    }
  }

  async function rewriteComposerText() {
    var conversation = selectedConversation();
    var input = document.querySelector('[name="message"]');
    var source = input && input.value;
    if (!source || !source.trim()) {
      window.alert('Escribe primero el mensaje que quieres mejorar.');
      if (input) input.focus();
      return null;
    }
    if (!conversation || !canOperate(conversation, 'messages.respond') || state.copilotLoading[conversation.id]) return null;
    state.copilotLoading[conversation.id] = 'rewrite'; renderCopilotDraft();
    try {
      var data = await request('POST', {}, {
        action: 'rewrite_message',
        conversation_id: conversation.id,
        source_text: source,
      }, uuid(), 35000);
      if (state.selectedId !== conversation.id) return null;
      var suggestion = String(data && data.rewritten_text || '').trim();
      if (!suggestion) throw new Error('MILA no devolvió una versión corregida.');
      if (input.value === source) {
        setComposerText(suggestion);
        state.copilot[conversation.id] = Object.assign({}, data, { mode: 'rewrite_applied', original_text: source, rewritten_text: suggestion });
      } else {
        state.copilot[conversation.id] = Object.assign({ mode: 'rewrite' }, data);
      }
      return data;
    } catch (error) {
      window.alert(error.message || 'MILA no pudo mejorar la redacción. Tu texto original no cambió.');
      return null;
    } finally {
      delete state.copilotLoading[conversation.id]; renderCopilotDraft();
    }
  }

  async function prepareResume() {
    var conversation = selectedConversation(); if (!conversation || !conversation.paused) return;
    var data = freshConversationSummary(conversation) || await requestCopilot('summary'); if (!data || state.selectedId !== conversation.id) return;
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

  function chatFileUrl(value) {
    if (typeof value !== 'string' || !/^(?:https?:\/\/|\/|\.\.?\/)/i.test(value)) return '';
    try {
      var url = new URL(value, location.href);
      if (url.username || url.password) return '';
      if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin)) return url.href;
    } catch (_) {}
    return '';
  }

  function chatMediaKind(item) {
    if (!item || item.deleted) return '';
    if (item.media_type === 'image') return 'image';
    if (item.media_type !== 'document') return '';
    var name = item.media_filename || (item.file && item.file.name) || item.content || '';
    var mime = item.media_mime_type || item.mime_type || (item.file && item.file.type) || '';
    if (mime.split(';')[0].trim().toLowerCase() === 'application/pdf' || /\.pdf\s*$/i.test(name)) return 'pdf';
    var url = chatFileUrl(item.media_url);
    if (url && /\.pdf$/i.test(new URL(url).pathname)) return 'pdf';
    return '';
  }

  function mediaThumbnail(item, description) {
    var preview = node('span', 'smyl-chat-thumbnail');
    var source = item.file && item.file instanceof Blob ? item.media_url : chatFileUrl(item.media_url);
    if (source) {
      var image = document.createElement('img');
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
      image.onerror = function () { preview.replaceChildren(node('span', 'smyl-chat-thumbnail-fallback', description)); };
      image.src = source; preview.append(image);
    } else preview.append(node('span', 'smyl-chat-thumbnail-fallback', description));
    return preview;
  }

  function canAttachMediaCopy(conversation, kind) {
    if (!canOperate(conversation, 'messages.respond') || (kind === 'pdf' && conversation.channel === 'instagram')) return false;
    var windowInfo = liveWhatsappWindow(conversation);
    return !windowInfo || windowInfo.freeform_allowed;
  }

  function openChatAttachment(item, conversationId, trigger) {
    var viewer = window.SmylChatMediaViewer, kind = chatMediaKind(item);
    if (!kind || conversationId !== state.selectedId || !chatEnabled()) return;
    if (!viewer) { window.alert('El visor no se ha cargado. Vuelve a abrir Mensajes e inténtalo de nuevo.'); return; }
    closeChatMedia();
    var session = new AbortController();
    mediaSession = session;
    var epoch = accessEpoch, revision = threadEpoch.get(conversationId), sequence = openSequence;
    function checkScope() {
      if (session.signal.aborted || !chatEnabled() || state.selectedId !== conversationId || sequence !== openSequence || epoch !== accessEpoch || revision !== threadEpoch.get(conversationId)) {
        throw new Error('La conversación cambió. Abre el archivo desde su chat.');
      }
    }
    async function loadBlob(signal) {
      checkScope();
      if (item.file instanceof Blob) return item.file;
      var url = chatFileUrl(item.media_url);
      async function download(source) {
        var response = await fetch(source, { signal: signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
        if (!response.ok) throw new Error('No se pudo descargar el archivo.');
        var blob = await response.blob();
        checkScope();
        return blob;
      }
      if (url) {
        try { return await download(url); }
        catch (error) { if (signal && signal.aborted) throw error; }
      }
      // La biblioteca entrega enlaces privados temporales. Solicitar el mismo mensaje
      // por fecha también cubre adjuntos antiguos, fuera de la primera página del hilo.
      checkScope();
      var time = Date.parse(item.created_at);
      if (!Number.isFinite(time)) throw new Error('Este archivo ya no está disponible.');
      var result = await request('GET', {
        action: 'messages', conversation_id: conversationId, since: item.created_at,
        before: new Date(time + 1).toISOString(), limit: 100,
      });
      checkScope();
      if (signal && signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      var refreshed = (result.messages || []).find(function (entry) { return String(entry.id) === String(item.id) && !entry.deleted && entry.media_type === item.media_type; });
      var freshUrl = refreshed && chatFileUrl(refreshed.media_url);
      if (!freshUrl) throw new Error('Este archivo ya no está disponible.');
      item.media_url = freshUrl;
      try { return await download(freshUrl); }
      catch (error) {
        checkScope();
        // Algunos proveedores permiten abrir un enlace firmado pero restringen su
        // lectura desde JavaScript. Solo ofrecemos ese enlace tras renovar el acceso.
        if (error instanceof TypeError && new URL(freshUrl).origin !== location.origin && !signal?.aborted) {
          error.originalUrl = freshUrl;
          error.allowImagePreview = kind === 'image';
          error.allowOpenOriginal = true;
        }
        throw error;
      }
    }
    function attach(file) {
      checkScope();
      if (!canAttachMediaCopy(selectedConversation(), kind)) throw new Error('Este chat ya no permite adjuntar la copia. Puedes descargarla.');
      if (state.attachment && !window.confirm('¿Reemplazar el adjunto que ya preparaste para este chat?')) return false;
      if (!chooseAttachment(file)) return false;
      var sharedDialog = document.querySelector('[data-shared-dialog][open]');
      if (sharedDialog) sharedDialog.close();
      if (state.contextOpen && !contextDocked()) closeContext(false);
      requestAnimationFrame(function () {
        if (state.selectedId === conversationId && !document.querySelector('dialog[open]')) document.querySelector('[data-inbox-composer] textarea')?.focus();
      });
      return true;
    }
    viewer.open({
      kind: kind, name: item.media_filename || (item.file && item.file.name) || (kind === 'pdf' ? 'Documento.pdf' : 'Imagen'),
      url: chatFileUrl(item.media_url), loadBlob: loadBlob, returnFocus: trigger, signal: session.signal,
      onAttach: canAttachMediaCopy(selectedConversation(), kind) ? attach : undefined,
    });
  }

  function chatMediaButton(item, conversationId, withThumbnail) {
    var kind = chatMediaKind(item);
    var label = kind === 'image' ? 'Abrir imagen' : 'Abrir PDF';
    var name = item.media_filename || (item.file && item.file.name) || '';
    var button = node('button', 'smyl-chat-media-open' + (withThumbnail && kind === 'image' ? ' has-thumbnail' : ''));
    button.type = 'button'; button.dataset.chatMediaOpen = kind; button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', label + (name ? ' · ' + name : ''));
    if (withThumbnail && kind === 'image') button.append(mediaThumbnail(item, label));
    else {
      var glyph = node('span', 'smyl-chat-file-icon'); glyph.innerHTML = composeIcon(kind === 'pdf' ? 'template' : 'attach');
      button.append(glyph, node('span', 'smyl-chat-file-name', kind === 'pdf' && name ? name : label));
    }
    button.onclick = function () { openChatAttachment(item, conversationId, button); };
    return button;
  }

  function locationCoordinate(value, limit) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()))) return null;
    var n = Number(value);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
  }

  function coordinateMap(lat, lng) {
    var latitude = locationCoordinate(lat, 90), longitude = locationCoordinate(lng, 180);
    if (latitude === null || longitude === null) return '';
    return 'https://www.google.com/maps?q=' + encodeURIComponent(latitude + ',' + longitude);
  }

  function chatMapLink(raw) {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\s\\]/.test(raw)) return '';
    try {
      var url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      // Never expand short links or request a map preview; only allow official map hosts.
      if (url.hostname === 'maps.app.goo.gl' && /^\/[A-Za-z0-9_-]{5,100}\/?$/.test(url.pathname)) return url.origin + url.pathname;
      if (!/^(?:(?:www\.)?google\.com(?:\.mx)?|maps\.google\.com(?:\.mx)?)$/.test(url.hostname)) return '';
      if (!/^\/maps(?:\/search)?\/?$/.test(url.pathname) && !(url.hostname.startsWith('maps.') && url.pathname === '/')) return '';
      var pair = (url.searchParams.get('query') || url.searchParams.get('q') || '').split(',');
      return pair.length === 2 ? coordinateMap(pair[0], pair[1]) : '';
    } catch (_) { return ''; }
  }

  function chatLocation(item) {
    if (!item || item.deleted || (item.media_type && item.media_type !== 'text' && item.media_type !== 'location')) return null;
    var native = item.media_type === 'location';
    var text = String(item.content || '').trim(), lines = text.split(/\r?\n/);
    var url = '', caption = text, candidate = chatMapLink(lines[lines.length - 1].trim());
    if (native) {
      var loc = item.location || item;
      url = coordinateMap(loc.latitude, loc.longitude) || chatMapLink(item.media_url);
    }
    if (candidate && (!url || candidate === url)) {
      url = candidate; caption = lines.slice(0, -1).join('\n').trim();
    }
    if (!url) return null;
    var generic = /^(?:📍\s*)?(?:ubicaci[oó]n(?: actual| compartida)?|location)$/i.test(caption);
    return { url: url, caption: generic ? '' : caption };
  }

  function chatLocationCard(place) {
    var link = node('a', 'smyl-inbox-attachment smyl-chat-location');
    link.href = place.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
    link.setAttribute('aria-label', 'Abrir mapa de la ubicación compartida (se abre en otra pestaña)');
    var icon = node('span', 'smyl-chat-location-icon'); icon.innerHTML = composeIcon('location');
    var copy = node('span', 'smyl-chat-location-copy');
    copy.append(node('strong', '', 'Ubicación compartida'), node('span', '', 'Abrir mapa ↗'));
    link.append(icon, copy); return link;
  }

  function appendMessageMedia(bubble, item) {
    if (item.deleted) { bubble.append(node('p', 'smyl-inbox-deleted', 'Mensaje eliminado del panel')); return; }
    if (item.reply_to) {
      var quote = node('div', 'smyl-inbox-quote'); quote.append(node('strong', '', 'Respuesta a'), node('span', '', item.reply_to.preview || 'Mensaje citado')); bubble.append(quote);
    }
    if (item.forwarded) bubble.append(node('span', 'smyl-inbox-forwarded', '↪ Reenviado'));
    var place = chatLocation(item);
    if (place) {
      if (place.caption) bubble.append(node('p', '', place.caption));
      bubble.append(chatLocationCard(place)); return;
    }
    var kind = chatMediaKind(item);
    var mediaUrl = item.file && item.file instanceof Blob ? item.media_url : chatFileUrl(item.media_url);
    if (kind) {
      bubble.append(chatMediaButton(item, state.selectedId, true));
    } else if (item.media_type === 'audio' && mediaUrl) {
      var audio = document.createElement('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = mediaUrl; bubble.append(audio);
    } else if (item.media_type === 'video' && mediaUrl) {
      var video = document.createElement('video'); video.controls=true; video.playsInline=true; video.preload='metadata'; video.src=mediaUrl; bubble.append(video);
    } else if (item.media_type === 'document' && mediaUrl) {
      var attachment = document.createElement('a'); attachment.className = 'smyl-inbox-attachment'; attachment.href = mediaUrl; attachment.target = '_blank'; attachment.rel = 'noopener noreferrer';
      attachment.textContent = '📄 ' + (item.media_filename || 'Abrir documento'); bubble.append(attachment);
    }
    var content = (item.content || '').trim();
    var defaultCaption = (kind === 'image' && /^(?:📷|📸|🖼️?)?\s*(?:imagen|foto(?:grafía)?)$/i.test(content))
      || (kind === 'pdf' && content.replace(/^📄\s*/, '') === (item.media_filename || (item.file && item.file.name)));
    if (!defaultCaption && (content || !item.media_type)) bubble.append(node('p', '', content || 'Mensaje sin texto'));
    else if (item.media_type === 'location' && !content) bubble.append(node('p', '', 'Ubicación sin enlace disponible'));
  }

  async function mutateMessage(item, action) {
    var conversation = selectedConversation(); if (!conversation) return;
    if (action === 'delete' && !window.confirm('Esto solo oculta el mensaje en el panel. NO se borra del teléfono del paciente ni de WhatsApp, Messenger o Instagram (Meta no permite a un negocio borrar mensajes ya enviados). ¿Ocultarlo en el panel?')) return;
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

  const suggestedAttachments = new WeakSet();
  let mediaLookup = '', checkedMediaAt = 0, mediaSequence = 0;
  function renderFileSuggestion(items) {
    const box = document.querySelector('[data-media-offer]');
    if (!box || !window.SmylMediaReplies || typeof window.sb?.rpc !== 'function') return;
    const conv = selectedConversation(), epoch = accessEpoch;
    const last = [...items].reverse().find(m => !m.deleted && (m.role === 'user' || m.author_type === 'patient' || m.author_type === 'team'));
    const allowed = conv && canOperate(conv,'messages.respond') && liveWhatsappWindow(conv)?.freeform_allowed !== false;
    const key = allowed && last && (last.role==='user'||last.author_type==='patient') && last.content
      ? [epoch,conv.id,last.id,last.content].join('|') : '';
    if(key && mediaLookup===key && Date.now()-checkedMediaAt<60000) return;
    const seq=++mediaSequence;
    mediaLookup=key;checkedMediaAt=Date.now();box.hidden=true;box.replaceChildren();
    if(!key) return;
    const current=()=>seq===mediaSequence && epoch===accessEpoch && state.selectedId===conv.id && canOperate(selectedConversation(),'messages.respond');
    const lookup=()=>window.sb.rpc('smyl_suggest_media_reply',{p_message:last.content,p_channel:conv.channel});
    Promise.resolve(lookup()).then(({data,error})=>{
      if(error || !current() || !data?.length) return;
      const title=node('span','',data.length===1?'Sugerencia · '+data[0].title:'Respuesta sugerida');
      const picker=document.createElement('select');picker.setAttribute('aria-label','Respuesta con archivo');
      data.forEach(r=>picker.add(new Option(r.title,r.id)));picker.hidden=data.length===1;
      const use=node('button','','Preparar respuesta');use.type='button';
      use.onclick=async()=>{
        const input=document.getElementById('smyl-inbox-message');
        if(!current()||input.disabled) return;
        const prior=input.value, attachment=state.attachment, reply=state.replyTo, choice=picker.value;
        if((prior.trim()||attachment||reply) && !window.confirm('¿Reemplazar la respuesta que estás preparando?'))return;
        use.disabled=true;
        try {
          const refreshed=await lookup();
          const active=refreshed.data?.find(r=>r.id===choice);
          if(refreshed.error||!active)throw new Error('Esta sugerencia ya no está disponible.');
          const media=await window.sb.storage.from(window.SmylMediaReplies.bucket).download(active.asset);
          if(media.error||!media.data)throw new Error('No se pudo cargar el archivo. Intenta de nuevo.');
          if(!current()||input.disabled)return;
          if(input.value!==prior||state.attachment!==attachment||state.replyTo!==reply)throw new Error('El mensaje cambió. Vuelve a preparar la respuesta.');
          const file=new File([media.data],window.SmylMediaReplies.filename(active.asset),{type:media.data.type});
          suggestedAttachments.add(file);
          if(!chooseAttachment(file))return;
          setComposerText(active.reply_text);box.hidden=true;
        } catch(err){if(current())title.textContent=err.message;}
        finally{use.disabled=false;}
      };
      box.append(title,picker,use);box.hidden=false;
    }).catch(()=>{});
  }
  window.addEventListener('smyl:media-rules-changed',()=>{mediaLookup='';if(state.selectedId)renderMessages(true);});

  function renderMessages(keepPosition) {
    var wrap = document.querySelector('[data-thread-messages]'); var older = document.querySelector('[data-thread-older]');
    if (!wrap || !state.selectedId) return;
    var menuFocusId = messageMenu && (messageMenu.menu.contains(document.activeElement) || messageMenu.button === document.activeElement) ? state.actionsOpenId : null;
    closeMessageMenu(false);
    var body = document.querySelector('[data-thread-body]'); var oldHeight = body.scrollHeight, priorTop = body.scrollTop;
    threadPaintDeferred = false;
    var server = state.messages[state.selectedId] || []; var pending = (state.pending[state.selectedId] || []).filter(function (item) { return !item.reconciled; });
    var items = server.concat(pending).sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); });
    // El historial se reconstruye completo. Silenciamos el live region durante esa operación
    // para que lectores de pantalla no vuelvan a anunciar cada mensaje como si fuera nuevo.
    var liveMode = wrap.dataset.liveMode || wrap.getAttribute('aria-live') || 'polite';
    var renderSequence = String((Number(wrap.dataset.renderSequence) || 0) + 1);
    wrap.dataset.liveMode = liveMode;
    wrap.dataset.renderSequence = renderSequence;
    wrap.setAttribute('aria-busy', 'true');
    wrap.setAttribute('aria-live', 'off');
    wrap.innerHTML = '';
    if (state.loadingThread && !items.length) wrap.innerHTML = '<div class="sk-region smyl-inbox-thread-sk" role="status" aria-live="polite"><span class="sk-sr">Cargando mensajes</span><div aria-hidden="true"><span class="sk sk-bubble"></span><span class="sk sk-bubble is-out"></span><span class="sk sk-bubble is-short"></span><span class="sk sk-bubble is-out is-short"></span><span class="sk sk-bubble"></span></div></div>';
    else if (state.threadError && !items.length) {
      var error = node('div', 'smyl-inbox-thread-state'); error.append(node('strong', '', 'No pudimos cargar el hilo'), node('p', '', state.threadError));
      var retry = node('button', 'btn btn-secondary btn-sm', 'Reintentar'); retry.type = 'button'; retry.onclick = function () { loadThread(state.selectedId, false); }; error.append(retry); wrap.append(error);
    } else if (!items.length) wrap.append(node('div', 'smyl-inbox-thread-state', 'Todavía no hay mensajes en esta conversación.'));
    var lastDay = '', previousSender = null;
    items.forEach(function (item) {
      var date = new Date(item.created_at || Date.now()); var day = dayLabel(date);
      if (day !== lastDay) { wrap.append(node('div', 'smyl-inbox-day', day)); lastDay = day; previousSender = null; }
      var authorType = item.author_type || (item.role === 'user' ? 'patient' : 'assistant');
      var hasError = item.status === 'failed' || item.status === 'unknown';
      var row = node('div', 'smyl-inbox-message is-' + authorType + (hasError ? ' has-error' : ''));
      row.dataset.messageId = String(item.id);
      var senderId = item.author_id || item.sender_id;
      var sender = null;
      if (!item.deleted && !hasError && item.role !== 'system' && ['patient', 'assistant', 'team'].includes(authorType)) {
        // Un hilo tiene un paciente y un asistente, pero puede tener varios miembros del equipo.
        if (authorType !== 'team' || senderId) sender = authorType + ':' + (senderId || '');
      }
      if (sender && sender === previousSender) row.classList.add('is-continuation');
      previousSender = sender;
      var bubble = node('div', 'smyl-inbox-bubble'); var author = authorType === 'patient' ? 'Paciente' : authorType === 'team' ? 'Equipo de la clínica' : 'SMYL Asistente';
      // El lado y el color ya dicen quién escribió; solo se rotula a SMYL Asistente (y se deja el nombre para lectores de pantalla).
      if (authorType === 'patient' || authorType === 'team') bubble.append(node('span', 'smyl-inbox-sr', author + ': '));
      if (!(authorType === 'patient' || authorType === 'team') || item.starred) {
        var top = node('div', 'smyl-inbox-message-top');
        if (!(authorType === 'patient' || authorType === 'team')) top.append(node('small', '', author));
        if (item.starred) top.append(node('span', '', '★'));
        bubble.append(top);
      }
      appendMessageMedia(bubble, item);
      var stamp = messageStatus(item);
      var plainText = bubble.lastElementChild;
      if (stamp.dateTime && bubble.childElementCount === 2 && bubble.firstElementChild.classList.contains('smyl-inbox-sr') && plainText.tagName === 'P' && plainText.textContent.length <= 30) {
        bubble.classList.add('is-brief');
      }
      bubble.append(stamp);
      if (item.status === 'failed') { var retryPendingButton = node('button', '', 'Reintentar'); retryPendingButton.type = 'button'; retryPendingButton.onclick = function () { retryPending(item); }; bubble.append(retryPendingButton); }
      else if (item.status === 'unknown') { var refresh = node('button', '', 'Actualizar hilo'); refresh.type = 'button'; refresh.onclick = function () { loadThread(state.selectedId, false); }; bubble.append(refresh); }
      else if (!item.id.toString().startsWith('pending:') && !item.deleted) {
        var actions = messageActions(item, row);
        if (actions) { row.classList.add('has-message-actions'); row.append(actions); }
      }
      row.append(bubble); wrap.append(row);
    });
    var page = state.pages[state.selectedId] || {}; if (older) { older.hidden = !page.hasMore; older.disabled = state.loadingThread; }
    if (keepPosition) body.scrollTop = priorTop + body.scrollHeight - oldHeight;
    if (menuFocusId) Array.from(wrap.querySelectorAll('[data-message-id]')).find(function (row) { return row.dataset.messageId === menuFocusId; })?.querySelector('.smyl-inbox-message-more')?.focus({preventScroll:true});

    renderPrivacyNotice(items, body);
    renderFileSuggestion(items);

    var finishAccessibleRender = function () {
      if (!wrap.isConnected || wrap.dataset.renderSequence !== renderSequence) return;
      wrap.setAttribute('aria-busy', 'false');
      setTimeout(function () {
        if (wrap.isConnected && wrap.dataset.renderSequence === renderSequence) wrap.setAttribute('aria-live', liveMode);
      }, 0);
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(finishAccessibleRender);
    else setTimeout(finishAccessibleRender, 0);
  }

  /* Solicitudes de derechos (ARCO) escritas por el paciente: SMYL avisa y el personal las registra con un clic. No contesta solo. */
  function renderPrivacyNotice(items, body) {
    var P = window.SmylPrivacyInbox, conversation = selectedConversation();
    if (!P || !conversation || !body) return;
    var ficha = state.clinical[conversation.id];
    try {
      P.show({
        conversationId: conversation.id, channel: conversation.channel, contactName: conversation.contact_name, contactPhone: conversation.contact_phone || '',
        patientId: ficha && ficha.linked && ficha.patient ? ficha.patient.id : null, canManage: hasPermission('patients.manage'), anchor: body,
        messages: items.filter(function (item) { return item.author_type === 'patient' && !item.deleted && typeof item.content === 'string'; }).map(function (item) { return { id: String(item.id), text: item.content, at: item.created_at }; })
      });
    } catch (e) { /* el aviso es una ayuda: si falla, el hilo sigue igual */ }
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
    // Con la ventana abierta no hay nada que avisar; solo molesta cuando vence o está por vencer.
    notice.hidden = !isWhatsapp || windowState.status === 'open';
    if (isWhatsapp) {
      notice.dataset.state = windowState.status;
      notice.innerHTML = '';
      var noticeText = node('span', '', windowState.status === 'expired'
        ? 'Ventana de 24 h vencida · usa una plantilla aprobada para contactar al paciente.'
        : windowState.status === 'expiring'
        ? 'La ventana de WhatsApp vence en ' + durationLabel(windowState.remaining_seconds) + '. Puedes programar una plantilla para después.'
        : 'Ventana de WhatsApp abierta · ' + durationLabel(windowState.remaining_seconds) + ' disponibles para texto libre.');
      notice.append(noticeText);
    }
    var freeformAllowed = !isWhatsapp || windowState.freeform_allowed;
    var input = form.elements.message; var send = form.querySelector('[data-compose-send]');
    var attach = form.querySelector('[data-compose-attach]'); var location = form.querySelector('[data-compose-location]');
    var rewrite = form.querySelector('[data-compose-rewrite]');
    var record = form.querySelector('[data-compose-record]');
    var copilot = form.querySelector('[data-compose-copilot]'); var template = form.querySelector('[data-compose-template]');
    var schedule = form.querySelector('[data-compose-schedule]'); var quick = form.querySelector('[data-compose-quick]');
    var emoji = form.querySelector('[data-compose-emoji]');
    var more = form.querySelector('[data-compose-more]'); var tools = form.querySelector('[data-compose-tools]');
    var templateOnly = Boolean(isWhatsapp && !freeformAllowed);
    form.dataset.mode = templateOnly ? 'template' : 'message';
    var wasDisabled = input.disabled;
    input.disabled = !canRespond || !freeformAllowed; send.disabled = !canRespond;
    if (input.disabled !== wasDisabled) fitComposerText(input);
    send.innerHTML = templateOnly
      ? '<span>Elegir plantilla</span>' + composeIcon('template')
      : '<span>Enviar</span>' + composeIcon('send');
    send.setAttribute('aria-label', templateOnly ? 'Elegir plantilla aprobada' : 'Enviar mensaje');
    attach.disabled = !canRespond || !freeformAllowed; location.disabled = !canRespond || !freeformAllowed;
    rewrite.hidden = templateOnly; rewrite.disabled = !canRespond || !freeformAllowed;
    record.hidden = !isWhatsapp; record.disabled = !canRespond || !freeformAllowed;
    copilot.disabled = !canRespond || !freeformAllowed;
    if (quick) quick.disabled = !canRespond || !freeformAllowed;
    if (emoji) emoji.disabled = !canRespond || !freeformAllowed;
    template.hidden = !isWhatsapp; template.disabled = !canRespond;
    schedule.hidden = !isWhatsapp; schedule.disabled = !canRespond;
    var hasSecondaryTool = Array.from(tools.querySelectorAll('button')).some(function (button) { return !button.hidden && !button.disabled; });
    more.hidden = !hasSecondaryTool;
    if (!hasSecondaryTool) closeComposerTools(false);
    input.placeholder = isWhatsapp && !freeformAllowed ? 'Ventana vencida: selecciona una plantilla aprobada' : 'Responder…';
  }

  async function loadTemplates() {
    if (state.templatesLoaded || state.templatesLoading) return;
    state.templatesLoading = true;
    try {
      var data = await request('GET', { action: 'templates' });
      state.templates = data.templates || []; state.templatesLoaded = true;
    } finally { state.templatesLoading = false; }
  }

  // ── Cobros por WhatsApp: variables de las plantillas de cobro tomadas de la cuenta del paciente ──
  // ── Cobros por WhatsApp: reglas de contacto (preferencia «no contactar», BAJA, horario y tope semanal) ──
  function normalizeText(value) { return String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  // El paciente respondió BAJA y nadie lo ha vuelto a permitir después de ese mensaje.
  function cobroBlock(conversation) {
    var info = state.accountContext && state.accountContext[conversation.id]; var pref = info && info.pref;
    if (pref && pref.whatsapp_blocked) return { blocked: true, reason: pref.reason || 'Marcado como no contactar por cobros.', source: 'pref' };
    var inbound = (state.messages[conversation.id] || []).filter(function (item) { return item.author_type === 'patient' && /^\s*baja[\s.!]*$/.test(normalizeText(item.content)); });
    var baja = inbound[inbound.length - 1];
    if (baja && !(pref && new Date(pref.updated_at || 0).getTime() > new Date(baja.created_at || 0).getTime())) return { blocked: true, reason: 'El paciente respondió BAJA.', source: 'baja' };
    return { blocked: false, reason: '', source: '' };
  }

  function daysSince(iso) { var time = new Date(iso || 0).getTime(); return Number.isFinite(time) && time > 0 ? Math.floor((Date.now() - time) / 86400000) : null; }

  function outsideCollectionHours(date) { var hour = (date || new Date()).getHours(); return hour < 9 || hour >= 20; }

  async function setCobroPref(conversation, blocked, reason) {
    var info = state.accountContext && state.accountContext[conversation.id]; var patientId = info && info.patientId; if (!patientId) return;
    try {
      var result = await window.sb.rpc('smyl_set_collection_pref', { p_patient_id: patientId, p_blocked: blocked, p_reason: reason || null });
      if (result && result.error) throw result.error;
      info.pref = { whatsapp_blocked: blocked, reason: reason || null, updated_at: new Date().toISOString() };
      renderContext();
    } catch (error) { window.alert(error.message || 'No se pudo guardar la preferencia.'); }
  }

  // Registra el recordatorio enviado (tope semanal compartido entre personas y dispositivos). Si falla, el envío ya se hizo: sólo se omite el registro.
  async function logCobroReminder(conversation, templateName) {
    var info = state.accountContext && state.accountContext[conversation.id]; var patientId = info && info.patientId; if (!patientId) return;
    try {
      var result = await window.sb.rpc('smyl_log_collection_reminder', { p_patient_id: patientId, p_template: templateName, p_conversation_id: conversation.id });
      if (result && result.error) throw result.error;
      info.lastReminder = { sent_at: new Date().toISOString(), template_name: templateName };
      if (state.selectedId === conversation.id) renderContext();
    } catch (_) {}
  }

  var QUOTE_PLANTILLAS = ['cotizacion_lista_v1', 'cotizacion_seguimiento_v1'];
  var COBRO_PLANTILLAS = ['pago_pendiente_v1', 'plan_pagos_proximo_v1', 'saldo_actualizado_v1', 'estado_cuenta_v1', 'saldo_vencido_aviso_v1', 'pago_recibido_v1', 'comprobante_pago_v1'];

  function cobroVariables(templateName, conversation) {
    if (!conversation || COBRO_PLANTILLAS.indexOf(templateName) === -1) return null;
    var info = state.accountContext && state.accountContext[conversation.id]; var summary = info && info.data;
    if (!summary) return null;
    var ficha = state.clinical[conversation.id];
    var fullName = (ficha && ficha.patient && ficha.patient.name) || conversation.contact_name || '';
    var first = String(fullName).trim().split(/\s+/)[0] || '';
    var clinic = availabilityClinicName();
    var money = function (value) { return Number(value || 0) > 0 ? Number(value).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : ''; };
    var due = summary.nextDue ? new Date(summary.nextDue + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }) : '';
    switch (templateName) {
      case 'pago_pendiente_v1': return [first, money(summary.due), clinic, due];
      case 'plan_pagos_proximo_v1': return [first, money(summary.nextBalance || summary.due), clinic, due];
      case 'saldo_actualizado_v1': return [first, clinic, money(summary.due)];
      case 'estado_cuenta_v1': return [first, clinic, money(summary.due), due];
      case 'saldo_vencido_aviso_v1': return [first, money(summary.overdueAmount || summary.due), clinic, due];
      case 'pago_recibido_v1': return [first, money(summary.lastPaymentAmount), clinic];
      case 'comprobante_pago_v1': return [first, '', money(summary.lastPaymentAmount), clinic];
      default: return null;
    }
  }

  function cobroPreferidas(summary) {
    if (summary && summary.overdueCount > 0) return ['saldo_vencido_aviso_v1', 'pago_pendiente_v1', 'estado_cuenta_v1'];
    if (summary && summary.due > 0) return ['pago_pendiente_v1', 'estado_cuenta_v1', 'saldo_actualizado_v1', 'plan_pagos_proximo_v1'];
    return ['pago_recibido_v1', 'comprobante_pago_v1', 'estado_cuenta_v1'];
  }

  async function openCobroTemplate() {
    var conversation = selectedConversation();
    if (!conversation || conversation.channel !== 'whatsapp' || !canOperate(conversation, 'messages.respond')) return;
    var info = state.accountContext && state.accountContext[conversation.id];
    var rule = cobroBlock(conversation);
    if (rule.blocked) { window.alert('No se envían recordatorios de cobro a este paciente: ' + rule.reason); return; }
    var preferred = cobroPreferidas(info && info.data);
    await openTemplateDialog(preferred);
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
    // Plantillas de cobro: monto, vencimiento y nombre salen de la cuenta del paciente (se pueden corregir antes de enviar).
    var auto = cobroVariables(template.name, selectedConversation());
    if (auto) Array.from(variables.querySelectorAll('[data-variable-index]')).forEach(function (field, index) { if (auto[index]) field.value = auto[index]; });
    // Plantillas enviadas desde otras pantallas (p. ej. Cotizaciones): sus variables vienen ya resueltas.
    var preset = state.templatePreset;
    if (preset && Array.isArray(preset.names) && preset.names.indexOf(template.name) !== -1 && Array.isArray(preset.variables)) {
      Array.from(variables.querySelectorAll('[data-variable-index]')).forEach(function (field, index) { if (preset.variables[index]) field.value = String(preset.variables[index]).slice(0, 1000); });
    }
  }

  function fillTemplateSelect(select) {
    select.innerHTML = '';
    if (!state.templates.length) {
      var empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No hay plantillas aprobadas'; select.append(empty); return;
    }
    state.templates.forEach(function (template) { var option = document.createElement('option'); option.value = template.id; option.textContent = template.name + ' · ' + template.language; select.append(option); });
  }

  async function openTemplateDialog(preferred, preset) {
    state.templatePreset = preset && Array.isArray(preferred) ? { names: preferred, variables: preset.variables || [], onSent: preset.onSent || null } : null;
    var conversation = selectedConversation(); if (!conversation || conversation.channel !== 'whatsapp' || !canOperate(conversation, 'messages.respond')) return;
    try { await loadTemplates(); } catch (error) { window.alert(error.message || 'No se pudieron cargar las plantillas.'); return; }
    var dialog = document.querySelector('[data-template-dialog]'); var select = dialog.querySelector('[data-template-select]');
    if (!dialog.dataset.presetBound) { dialog.dataset.presetBound = '1'; dialog.addEventListener('close', function () { setTimeout(function () { state.templatePreset = null; }, 0); }); }
    fillTemplateSelect(select);
    if (Array.isArray(preferred)) {
      var match = null;
      preferred.some(function (name) { match = state.templates.find(function (item) { return item.name === name; }) || null; return Boolean(match); });
      if (!match) {
        state.templatePreset = null;
        var missingCopy = (preset && preset.missingText) || 'No hay una plantilla de cobro aprobada todavía. Solicítala en Mensajería → Plantillas; Meta suele tardar de unos minutos a 48 horas.';
        if (window.SmylTemplateSuggest) window.SmylTemplateSuggest.offerMissing(preferred, missingCopy); else window.alert(missingCopy);
        return;
      }
      select.value = match.id;
    }
    renderTemplateFields(select, dialog.querySelector('[data-template-preview]'), dialog.querySelector('[data-template-variables]'), 'send');
    dialog.showModal();
  }

  async function sendTemplate(event) {
    event.preventDefault(); var conversation = selectedConversation(); if (!conversation) return;
    var dialog = event.currentTarget.closest('dialog'); var select = dialog.querySelector('[data-template-select]'); var template = templateById(select.value);
    if (!template) { window.alert('Selecciona una plantilla aprobada.'); return; }
    var variables = Array.from(dialog.querySelectorAll('[data-variable-index]')).map(function (input) { return input.value.trim(); });
    if (variables.some(function (value) { return !value; })) { window.alert('Completa todas las variables de la plantilla.'); return; }
    var content = variables.reduce(function (copy, value, index) { return copy.split('{{' + (index + 1) + '}}').join(value); }, template.body || template.name);
    var isCobro = COBRO_PLANTILLAS.indexOf(template.name) !== -1;
    var isQuote = QUOTE_PLANTILLAS.indexOf(template.name) !== -1;
    if (isCobro || isQuote) {
      var rule = cobroBlock(conversation);
      if (rule.blocked) { window.alert('No se envían mensajes de ' + (isQuote ? 'cotización' : 'cobro') + ' a este paciente: ' + rule.reason); return; }
      if (outsideCollectionHours() && !window.confirm('Son las ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) + ': fuera del horario recomendado (9:00 a 20:00). ¿Enviar de todos modos?')) return;
    }
    if (isCobro) {
      var lastInfo = state.accountContext && state.accountContext[conversation.id]; var lastReminder = lastInfo && lastInfo.lastReminder; var lastDays = lastReminder ? daysSince(lastReminder.sent_at) : null;
      if (lastDays !== null && lastDays < 7 && !window.confirm('Ya se envió un recordatorio de cobro a este paciente ' + (lastDays === 0 ? 'hoy' : lastDays === 1 ? 'ayer' : 'hace ' + lastDays + ' días') + '. ¿Enviar otro?')) return;
    }
    if (isCobro) {
      var weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      var repeated = (state.messages[conversation.id] || []).filter(function (item) { return item.author_type === 'team' && item.content === content && new Date(item.created_at || 0).getTime() > weekAgo; })[0];
      if (repeated && !window.confirm('Ya enviaste este mismo mensaje el ' + availabilityDate(repeated.created_at).split(' · ')[0] + '. ¿Enviarlo de nuevo?')) return;
    }
    var key = uuid(); var extra = { type: 'template', template_id: template.id, template_variables: variables };
    var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: content, created_at: new Date().toISOString(), status: 'sending', extra: extra };
    if (isCobro) pending.onSent = function () { logCobroReminder(conversation, template.name); };
    var preset = state.templatePreset; state.templatePreset = null;
    if (preset && Array.isArray(preset.names) && preset.names.indexOf(template.name) !== -1 && typeof preset.onSent === 'function') {
      var previousSent = pending.onSent;
      pending.onSent = function () { if (typeof previousSent === 'function') previousSent(); preset.onSent(); };
    }
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
    var content = document.querySelector('[data-operations-content]');
    if (!content) return;
    var reportButton = document.querySelector('[data-pilot-report]'); if (reportButton) reportButton.disabled = !state.operations;
    content.innerHTML = '';
    if (state.operationsLoading && !state.operations) {
      content.append(skNode('panel', { lines: 4, label: 'Calculando salud operativa' }));
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
    if (canManagePilot) content.append(buildEmergencyPause());
  }

  // Pausa de emergencia (solo el dueño). Pausa a la IA en cada conversación EXISTENTE y dice con números qué pasó.
  function buildEmergencyPause() {
    var section = node('section', 'smyl-inbox-operations-section smyl-inbox-emergency');
    section.append(node('h3', '', 'Respuestas automáticas'));
    section.append(node('p', '', 'Si algo sale mal, pausa a la IA en todas las conversaciones de la clínica. Seguirás viendo los mensajes y podrás responder tú.'));
    section.append(node('small', 'smyl-inbox-pilot-safety', 'Cubre las conversaciones que existen ahora. Una conversación nueva que llegue después no queda pausada: vuelve a pulsar el botón o pide a soporte la pausa general. Cada conversación se reanuda por separado.'));
    var button = node('button', 'btn connections-danger-button', state.pauseAllLoading ? 'Pausando…' : 'Pausar respuestas automáticas'); button.type = 'button'; button.disabled = Boolean(state.pauseAllLoading);
    button.onclick = pauseAllReplies; section.append(button);
    var result = state.pauseAllResult;
    if (result) {
      var box = node('div', 'smyl-inbox-emergency-result is-' + (result.error ? 'error' : result.complete ? 'ok' : 'warn')); box.setAttribute('role', 'status');
      if (result.error) box.append(node('strong', '', 'No se pudo completar'), node('p', '', result.error));
      else {
        box.append(node('strong', '', result.complete ? 'Listo: todas las conversaciones están pausadas' : 'Pausa incompleta: revisa y repite'));
        box.append(node('p', '', result.paused + ' pausadas ahora · ' + result.already_paused + ' ya estaban pausadas · ' + result.failed + ' con error · ' + result.scanned + ' revisadas.'));
        if (result.truncated) box.append(node('p', '', 'Hay más conversaciones de las que se pudieron revisar. Vuelve a pulsar el botón para continuar.'));
        if (result.failed) box.append(node('p', '', 'No se pudo pausar ' + result.failed + ' conversación(es). Vuelve a intentarlo; si persiste, pausa esas conversaciones a mano o pide ayuda a soporte.'));
      }
      section.append(box);
    }
    return section;
  }

  async function pauseAllReplies() {
    if (state.pauseAllLoading) return;
    if (!window.confirm('¿Pausar las respuestas automáticas en TODAS las conversaciones de la clínica?\n\nLa IA dejará de contestar hasta que reanudes cada conversación. Tú y tu equipo pueden seguir respondiendo.')) return;
    state.pauseAllLoading = true; state.pauseAllResult = null; renderOperations();
    try {
      state.pauseAllResult = await request('POST', {}, { action: 'pause_all' }, uuid(), 90000);
      try { loadList(true); } catch (_) {}
    } catch (error) { state.pauseAllResult = { error: error.message || 'No se pudo pausar las respuestas automáticas.' }; }
    finally { state.pauseAllLoading = false; renderOperations(); }
  }

  async function loadOperations(force) {
    if (!hasPermission('messages.manage')) return;
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
    reportWindow.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SMYL · Informe operativo del piloto</title><style>body{max-width:820px;margin:0 auto;padding:36px;font-family:Arial,sans-serif;color:#173149}h1{margin:0 0 6px;font-size:26px}.meta{margin:0 0 24px;color:#607286}.smyl-inbox-report-summary{position:relative;padding:18px;border:1px solid #bbcedc;border-radius:10px;background:#f4faf8}.smyl-inbox-report-summary>span{font-size:10px;font-weight:bold;letter-spacing:.08em;color:#4c6085}.smyl-inbox-report-summary h3{margin:7px 0 4px;font-size:20px}.smyl-inbox-report-summary p{margin:0;color:#5c6d7c}.smyl-inbox-report-status{margin-top:12px;font-weight:bold}.smyl-inbox-report-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.smyl-inbox-operations-metric{padding:12px;border:1px solid #d9e0e8;border-radius:8px}.smyl-inbox-operations-metric span,.smyl-inbox-operations-metric strong,.smyl-inbox-operations-metric small{display:block}.smyl-inbox-operations-metric span,.smyl-inbox-operations-metric small{color:#657687;font-size:11px}.smyl-inbox-operations-metric strong{margin:5px 0;font-size:20px}.smyl-inbox-report-section{margin-top:22px}.smyl-inbox-report-section h3{padding-bottom:8px;border-bottom:1px solid #dce4ea;font-size:15px}.smyl-inbox-report-list,.smyl-inbox-report-evidence,.smyl-inbox-report-alerts{padding:0;list-style:none}.smyl-inbox-report-list li,.smyl-inbox-report-evidence li,.smyl-inbox-report-alerts li{display:flex;gap:10px;margin:9px 0;padding:10px;background:#f8fafb;border-radius:7px}.smyl-inbox-report-list i,.smyl-inbox-report-evidence i,.smyl-inbox-report-alerts i{font-style:normal;font-weight:bold}.smyl-inbox-report-list strong,.smyl-inbox-report-list span,.smyl-inbox-report-evidence strong,.smyl-inbox-report-evidence span,.smyl-inbox-report-alerts strong,.smyl-inbox-report-alerts span{display:block}.smyl-inbox-report-list span,.smyl-inbox-report-evidence span,.smyl-inbox-report-alerts span{margin-top:3px;color:#657687;font-size:12px}.smyl-inbox-report-disclaimer{margin-top:24px;padding:12px;border-left:3px solid #72899a;background:#f4f6f9;color:#526474;font-size:11px;line-height:1.5}@media print{body{padding:0}@page{margin:16mm}}@media(max-width:600px){body{padding:20px}.smyl-inbox-report-metrics{grid-template-columns:1fr 1fr}}</style></head><body><h1>Informe operativo del piloto</h1><p class="meta">SMYL · Mensajes</p>' + content.innerHTML + '</body></html>');
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
    closeContext(false);
    var composer = document.querySelector('[name="message"]');
    if (composer && !composer.disabled && composer.getClientRects().length) composer.focus();
    else {
      var send = document.querySelector('[data-compose-send]');
      if (send && !send.disabled && send.getClientRects().length) send.focus();
    }
  }

  function openPatientContext(conversationId) {
    if (!hasPermission('clinical.read')) return;
    // Ya vinculada: directo al expediente (con «Volver al chat»); sin ventana intermedia. Sin vincular: «Vincular paciente».
    var ficha = state.clinical[conversationId];
    var linkedId = ficha && ficha.linked && ficha.patient && ficha.patient.id;
    if (linkedId && window.SmylLanaHandoff && typeof window.SmylLanaHandoff.openPatient === 'function') { window.SmylLanaHandoff.openPatient(linkedId, conversationId); return; }
    if (window.SmylLanaHandoff) window.SmylLanaHandoff.open(conversationId);
  }

  function focusableWithin(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('a[href],button:not([disabled]),select:not([disabled]),textarea:not([disabled]),input:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')).filter(function (element) {
      return !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length;
    });
  }

  function captureContextFocus(panel) {
    var active = document.activeElement;
    if (!state.contextOpen || !panel || !active || !panel.contains(active)) return null;
    var section = active.closest && active.closest('[data-section]');
    var scope = section || panel; var items = focusableWithin(scope);
    return {
      conversationId: state.selectedId, view: state.f360Tab[state.selectedId] || 'profile',
      section: section && section.dataset.section || '',
      index: Math.max(0, items.indexOf(active)),
      label: active.getAttribute && active.getAttribute('aria-label') || '',
      name: active.getAttribute && active.getAttribute('name') || '',
      tag: active.tagName || '',
      text: active.tagName === 'BUTTON' ? active.textContent.trim() : '',
    };
  }

  function restoreContextFocus(snapshot) {
    if (!snapshot) return;
    setTimeout(function () {
      var panel = document.querySelector('[data-inbox-context-panel]');
      if (!state.contextOpen || !panel || panel.getAttribute('aria-hidden') === 'true' || state.selectedId !== snapshot.conversationId || (state.f360Tab[state.selectedId] || 'profile') !== snapshot.view) return;
      if (document.activeElement !== document.body && !panel.contains(document.activeElement)) return;
      var scope = panel;
      if (snapshot.section) {
        scope = Array.from(panel.querySelectorAll('[data-section]')).find(function (section) { return section.dataset.section === snapshot.section; }) || panel;
      }
      var items = focusableWithin(scope);
      var target = items.find(function (item) { return snapshot.label && item.getAttribute('aria-label') === snapshot.label; })
        || items.find(function (item) { return snapshot.name && item.getAttribute('name') === snapshot.name; })
        || items.find(function (item) { return snapshot.text && item.tagName === snapshot.tag && item.textContent.trim() === snapshot.text; })
        || items[Math.min(snapshot.index, Math.max(0, items.length - 1))]
        || panel.querySelector('.smyl-inbox-context-close') || panel;
      if (target && typeof target.focus === 'function') target.focus({preventScroll:true});
    }, 0);
  }

  // En pantallas anchas la ficha se ancla como tercera columna: no tapa el chat ni atrapa el foco.
  var CONTEXT_DOCK_QUERY = '(min-width: 1440px)';
  function contextDocked() {
    return Boolean(state.view !== 'pipeline' && window.matchMedia && window.matchMedia(CONTEXT_DOCK_QUERY).matches);
  }

  function syncContextAccessibility() {
    var page = document.getElementById('p-inbox');
    var panel = document.querySelector('[data-inbox-context-panel]');
    var scrim = document.querySelector('[data-context-close]');
    var trigger = document.querySelector('[data-inbox-context]');
    if (!page || !panel) return;
    var open = Boolean(state.contextOpen && selectedConversation());
    var docked = contextDocked();
    page.classList.toggle('context-open', open);
    page.classList.toggle('context-docked', open && docked);
    panel.setAttribute('role', docked ? 'complementary' : 'dialog');
    if (docked) panel.removeAttribute('aria-modal'); else panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    panel.inert = !open;
    if (open) panel.removeAttribute('inert'); else panel.setAttribute('inert', '');
    if (scrim) {
      scrim.hidden = !open || docked;
      scrim.tabIndex = open && !docked ? 0 : -1;
    }
    if (trigger) {
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      trigger.setAttribute('aria-label', open && docked ? 'Ocultar Ficha 360 del paciente' : 'Abrir Ficha 360 del paciente');
    }
  }

  function openContext(trigger) {
    if (!selectedConversation()) return;
    state.contextReturnFocus = trigger || document.activeElement;
    state.contextOpen = true;
    rememberDockedContext(true);
    renderContext();
    setTimeout(function () {
      var panel = document.querySelector('[data-inbox-context-panel]');
      var target = panel && (panel.querySelector('.smyl-inbox-context-close') || focusableWithin(panel)[0] || panel);
      if (target) target.focus();
    }, 0);
  }

  // Preferencia de vista solo en memoria: si dejaste la ficha abierta en pantalla ancha, sigue abierta al cambiar de chat.
  function rememberDockedContext(open) {
    if (!contextDocked()) return;
    state.contextDockedPreferred = Boolean(open);
    try { window.sessionStorage.setItem(CONTEXT_DOCK_STORAGE_KEY, open ? 'open' : 'closed'); } catch (_) {}
  }
  function dockedContextPreferred() {
    return Boolean(contextDocked() && state.contextDockedPreferred !== false);
  }

  function closeContext(restoreFocus) {
    var target = state.contextReturnFocus;
    state.contextOpen = false;
    state.contextReturnFocus = null;
    rememberDockedContext(false);
    renderContext();
    if (restoreFocus !== false) {
      if (!target || !document.contains(target)) target = document.querySelector('[data-inbox-context]');
      if (target && typeof target.focus === 'function') target.focus({preventScroll:true});
    }
  }

  function trapContextFocus(event) {
    if (!state.contextOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeContext(true); return; }
    if (event.key !== 'Tab' || contextDocked()) return;
    var panel = event.currentTarget; var items = focusableWithin(panel);
    if (!items.length) { event.preventDefault(); panel.focus(); return; }
    var first = items[0]; var last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
      else if (key === 'record') hint = state.patientLinking[conversation.id] ? 'Identificando' : ficha && ficha.linked ? 'Vinculado' : 'Revisar identidad';
      else if (key === 'whatsapp') hint = liveWhatsappWindow(conversation).status === 'expired' ? 'Ventana vencida' : 'Ventana abierta';
      else if (key === 'responsable') hint = conversation.assignment ? conversation.assignment.name : 'Sin responsable';
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
      details.open = state.contextSections[storageKey] === undefined ? (key === 'record' || (urgent && key !== 'responsable')) : state.contextSections[storageKey];
      details.addEventListener('toggle', function () { state.contextSections[storageKey] = details.open; });
    });
  }

  function renderContext() {
    var wrap = document.querySelector('[data-inbox-context-content]');
    if (!wrap) return;
    var panel = document.querySelector('[data-inbox-context-panel]');
    var focusSnapshot = captureContextFocus(panel);
    wrap.innerHTML = '';
    var conversation = selectedConversation();
    if (!conversation) {
      wrap.append(node('div', 'smyl-inbox-context-empty', 'Selecciona una conversación para administrar su atención.'));
      syncContextAccessibility();
      return;
    }
    var header = node('div', 'smyl-inbox-context-head');
    var contextTitle = node('h2', '', conversation.contact_name); contextTitle.id = 'smyl-inbox-context-title';
    header.append(node('span', 'smyl-inbox-eyebrow', 'FICHA 360 DEL PACIENTE'), contextTitle);
    var close = node('button', 'smyl-inbox-context-close'); close.type = 'button';
    close.title = 'Cerrar ficha del paciente'; close.setAttribute('aria-label', close.title);
    close.innerHTML = composeIcon('close'); close.onclick = function () { closeContext(true); };
    header.append(close); wrap.append(header);
    var ficha = state.clinical[conversation.id];
    var showFiles = hasPermission('messages.read') && typeof window.SmylInboxFicha?.files === 'function';
    var view = showFiles && state.f360Tab[conversation.id] === 'files' ? 'files' : 'profile';
    var content = showFiles ? appendContextTabs(wrap, header, conversation.id, view) : wrap;
    if (view === 'files') {
      content.append(buildFichaFiles(conversation, ficha));
      if (state.contextOpen) loadFicha360Files(conversation.id, false);
    } else {
      renderProfileView(content, conversation, ficha);
      prepareFicha360Data(conversation, ficha);
    }
    renderConversationSettings();
    syncContextAccessibility();
    restoreContextFocus(focusSnapshot);
  }

  function appendContextTabs(wrap, header, id, view) {
    var tabs = node('div', 'smyl-f360-tabs');
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Vistas del paciente');
    tabs.addEventListener('keydown', rovingTabsKeydown);
    header.append(tabs);
    var activePanel;
    ['profile', 'files'].forEach(function (key) {
      var active = key === view;
      var tab = node('button', '', key === 'profile' ? 'Ficha' : 'Archivos');
      tab.type = 'button'; tab.dataset.f360Tab = key; tab.id = 'smyl-f360-tab-' + key;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      var panel = node('div', 'smyl-f360-tab-panel');
      panel.dataset.f360Panel = key; panel.id = 'smyl-f360-panel-' + key; panel.tabIndex = 0;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
      panel.hidden = !active; tab.setAttribute('aria-controls', panel.id);
      tab.onclick = function () {
        if (active || state.selectedId !== id || !tab.isConnected) return;
        state.f360Tab[id] = key; tab.focus({preventScroll:true});
        var side = wrap.closest('[data-inbox-context-panel]'); if (side) side.scrollTop = 0;
        renderContext();
      };
      tabs.append(tab); wrap.append(panel);
      if (active) activePanel = panel;
    });
    return activePanel;
  }

  function renderProfileView(wrap, conversation, ficha) {
    var summaryZone = document.createDocumentFragment();
    var citasZone = document.createDocumentFragment();
    var cobrosZone = document.createDocumentFragment();

    if (hasPermission('schedule.read')) {
      var appointmentCard = node('section', 'smyl-inbox-context-card smyl-inbox-appointment-card');
      // Solo la elección de horario hecha en este chat; las citas del paciente se listan aparte (F.visits).
      appointmentCard.append(node('h3', '', 'Solicitud desde el chat'));
      var appointmentData = state.appointmentContext[conversation.id];
      if (appointmentData && appointmentData.linked && (appointmentData.items || []).length) {
        var currentAppointment = appointmentData.items[0]; var actualAppointment = currentAppointment.appointment || {};
        var serviceName = currentAppointment.service && currentAppointment.service.name || 'Servicio dental';
        var professionalName = currentAppointment.professional && currentAppointment.professional.display_name || 'Profesional por confirmar';
        var branchName = currentAppointment.branch && currentAppointment.branch.name || 'Sucursal por confirmar';
        var relevant = conversation.appointment;
        if (relevant && relevant.id === actualAppointment.id) actualAppointment = Object.assign({}, actualAppointment, relevant);
        var effectiveStatus = actualAppointment.status || currentAppointment.status;
        if (actualAppointment.id) appointmentCard.dataset.appointmentId = actualAppointment.id;
        var statusText = effectiveStatus === 'confirmed' || effectiveStatus === 'accepted' ? 'Cita confirmada' : effectiveStatus === 'arrived' ? 'Llegó' : effectiveStatus === 'in_progress' ? 'En consulta' : effectiveStatus === 'completed' ? 'Atendido' : effectiveStatus === 'no_show' ? 'No asistió' : effectiveStatus === 'cancelled' ? 'Cita cancelada' : effectiveStatus === 'rejected' || effectiveStatus === 'expired' ? 'Elección cerrada' : 'Elección pendiente de confirmación';
        appointmentCard.append(node('strong', 'smyl-inbox-appointment-status is-' + effectiveStatus, statusText));
        appointmentCard.append(node('p', '', serviceName + ' · ' + availabilityDate(actualAppointment.starts_at || currentAppointment.requested_start, actualAppointment.timezone || currentAppointment.branch?.timezone)));
        appointmentCard.append(node('small', '', professionalName + ' · ' + branchName));
        var draftAppointment = node('button', 'btn btn-secondary btn-sm', effectiveStatus === 'confirmed' || effectiveStatus === 'accepted' ? 'Preparar confirmación' : 'Preparar seguimiento');
        draftAppointment.type = 'button'; draftAppointment.disabled = !canOperate(conversation, 'messages.respond');
        draftAppointment.onclick = function () {
          var confirmed = effectiveStatus === 'confirmed' || effectiveStatus === 'accepted';
          setComposerText((confirmed ? 'Tu cita para ' : 'Registramos tu elección para ') + serviceName + ' ' + (confirmed ? 'quedó confirmada' : 'y está pendiente de confirmación por la clínica') + ' el ' + availabilityDate(actualAppointment.starts_at || currentAppointment.requested_start, actualAppointment.timezone || currentAppointment.branch?.timezone) + ' con ' + professionalName + ' en ' + branchName + '.');
        };
        if (statusText === 'Elección pendiente de confirmación' || (statusText === 'Cita confirmada' && new Date(actualAppointment.ends_at || actualAppointment.starts_at || currentAppointment.requested_start) >= new Date())) appointmentCard.append(draftAppointment);
        citasZone.append(appointmentCard);
      }
    }

    if (hasPermission('finance.read') && window.SmylFinance && typeof window.SmylFinance.accountSummary === 'function') {
      var accountCard = node('section', 'smyl-inbox-context-card smyl-inbox-account-card');
      var accountPatient = ficha && ficha.linked && ficha.patient && ficha.patient.id;
      var accountInfo = state.accountContext && state.accountContext[conversation.id];
      var accountMoney = function (value) { return Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); };
      // Fila superior: el estado de la cuenta a la izquierda y «Cobrar» (compacto) a la derecha, donde se mira el saldo.
      var accountTop = node('div', 'smyl-inbox-account-top');
      var accountStatus = node('div', 'smyl-inbox-account-status');
      if (!accountPatient) accountStatus.append(node('p', '', 'Vincula al paciente para ver su saldo y cobrar desde esta conversación.'));
      else if (state.accountLoading && state.accountLoading[conversation.id]) accountStatus.append(skNode('text', { lines: 2, label: 'Consultando cuenta' }));
      else if (!accountInfo || !accountInfo.data) {
        accountStatus.append(node('strong', 'is-unavailable', 'Saldo no disponible'), node('small', '', 'No pudimos cargar la cuenta.'));
        var retryAccount = node('button', 'smyl-inbox-link', 'Reintentar'); retryAccount.type = 'button';
        retryAccount.onclick = function () { loadAccountContext(conversation.id); }; accountStatus.append(retryAccount);
      }
      else {
        var summary = accountInfo.data;
        if (!summary.chargeCount && !summary.credit) accountStatus.append(node('strong', '', 'Sin cargos'), node('small', '', 'Todavía no tiene cargos registrados.'));
        else {
          accountStatus.append(node('strong', '', summary.due > 0 ? accountMoney(summary.due) + ' por cobrar' : 'Al corriente'));
          var accountLines = [];
          if (summary.overdueCount > 0) accountLines.push(summary.overdueCount + (summary.overdueCount === 1 ? ' cargo vencido' : ' cargos vencidos') + ' (' + accountMoney(summary.overdueAmount) + ')');
          else if (summary.nextDue) accountLines.push('Próximo vencimiento: ' + availabilityDate(summary.nextDue + 'T12:00:00').split(' · ')[0]);
          if (summary.credit > 0) accountLines.push(accountMoney(summary.credit) + ' a favor');
          if (summary.truncated) accountLines.push('Resumen parcial: abre la cuenta para ver todo.');
          accountLines.forEach(function (line) { accountStatus.append(node('small', '', line)); });
        }
        var contactRule = cobroBlock(conversation);
        if (contactRule.blocked) accountStatus.append(node('small', 'smyl-inbox-account-blocked', 'No contactar por cobros: ' + contactRule.reason));
        else if (accountInfo.lastReminder) {
          var daysAgo = daysSince(accountInfo.lastReminder.sent_at);
          accountStatus.append(node('small', '', 'Último recordatorio: ' + (daysAgo === 0 ? 'hoy' : daysAgo === 1 ? 'ayer' : 'hace ' + daysAgo + ' días')));
        }
      }
      accountTop.append(accountStatus);
      if (hasPermission('finance.manage') && canOperate(conversation, 'finance.manage')) {
        var chargeButton = node('button', 'btn btn-primary btn-sm smyl-inbox-charge', 'Cobrar'); chargeButton.type = 'button';
        chargeButton.title = 'Cobrar a este paciente sin salir del chat';
        chargeButton.onclick = function () { openCareTask('payment'); }; accountTop.append(chargeButton);
      }
      accountCard.append(accountTop);
      if (accountPatient) {
        var accountActions = node('div', 'smyl-inbox-account-actions');
        var accountRule = accountInfo && accountInfo.data ? cobroBlock(conversation) : { blocked: false };
        var viewAccount = node('button', 'btn btn-secondary btn-sm', 'Ver cuenta completa'); viewAccount.type = 'button';
        viewAccount.onclick = function () { window.SmylFinance.account(accountPatient); }; accountActions.append(viewAccount);
        if (conversation.channel === 'whatsapp' && !accountRule.blocked && hasPermission('messages.respond') && canOperate(conversation, 'messages.respond')) {
          var sendWhatsapp = node('button', 'btn btn-secondary btn-sm', 'Enviar por WhatsApp'); sendWhatsapp.type = 'button';
          sendWhatsapp.title = 'Elige una plantilla de cobro aprobada; el monto y la fecha se llenan solos.';
          sendWhatsapp.onclick = function () { openCobroTemplate(); }; accountActions.append(sendWhatsapp);
        }
        accountCard.append(accountActions);
        // Lo poco frecuente (permitir o evitar recordatorios) queda en «Más» para no sumar botones.
        if (accountInfo && accountInfo.data && conversation.channel === 'whatsapp') {
          var accountMore = node('details', 'smyl-inbox-account-more'); accountMore.append(node('summary', '', 'Más opciones de cobranza'));
          if (accountRule.blocked && hasPermission('finance.manage') && canOperate(conversation, 'finance.manage')) {
            var allowAgain = node('button', 'btn btn-secondary btn-sm', 'Permitir recordatorios'); allowAgain.type = 'button';
            allowAgain.onclick = function () { if (window.confirm('¿Volver a permitir recordatorios de cobro por WhatsApp a este paciente?')) setCobroPref(conversation, false, null); };
            accountMore.append(allowAgain); accountCard.append(accountMore);
          } else if (!accountRule.blocked && (hasPermission('messages.respond') || hasPermission('finance.manage'))) {
            var blockAccount = node('button', 'btn btn-secondary btn-sm', 'No contactar por cobros'); blockAccount.type = 'button';
            blockAccount.onclick = function () { if (window.confirm('¿Dejar de enviar recordatorios de cobro por WhatsApp a este paciente?')) setCobroPref(conversation, true, 'Marcado desde el chat'); };
            accountMore.append(blockAccount); accountCard.append(accountMore);
          }
        }
      }
      cobrosZone.append(accountCard);
    }

    if (conversation.needs_human) {
      var attention = node('section', 'smyl-inbox-context-card is-attention');
      attention.append(node('h3', '', 'Intervención solicitada'), node('p', '', 'El asistente marcó esta conversación para seguimiento humano. Resolverla no reactiva la IA.'));
      var resolve = node('button', 'btn btn-primary btn-sm', 'Marcar solicitud resuelta'); resolve.type = 'button'; resolve.disabled = !canOperate(conversation, 'messages.manage'); resolve.onclick = function () { mutateConversation('resolve'); };
      attention.append(resolve); summaryZone.insertBefore(attention, summaryZone.firstChild);
    }

    wrap.append(buildFicha360(conversation, ficha, { summary: summaryZone, citas: citasZone, cobros: cobrosZone }));
  }

  // Herramientas operativas del hilo. El responsable se edita únicamente desde la cabecera.
  function buildConversationSettings(conversation) {
    var zone = document.createDocumentFragment();
    var status = node('section', 'smyl-inbox-context-card');
    status.append(node('h3', '', 'Responsable'));
    status.append(node('p', '', conversation.assignment ? conversation.assignment.name : 'Sin responsable'));
    zone.append(status);

    var organization = node('section', 'smyl-inbox-context-card smyl-inbox-organization');
    organization.append(node('h3', '', 'Organización'));
    var stageLabel = node('label', '', 'Etapa de atención');
    var stageSelect = document.createElement('select'); stageSelect.setAttribute('aria-label', 'Cambiar etapa de atención');
    var noStage = document.createElement('option'); noStage.value = ''; noStage.textContent = 'Sin etapa'; stageSelect.append(noStage);
    pipelineStages().filter(function (stage) { return !stage.archived || stage.id === conversation.stage_id; }).forEach(function (stage) {
      var option = document.createElement('option'); option.value = stage.id; option.textContent = stage.name + (stage.archived ? ' · Archivada' : ''); stageSelect.append(option);
    });
    stageSelect.value = conversation.stage_id || '';
    stageSelect.disabled = !canTransfer(conversation);
    stageSelect.onchange = async function () {
      stageSelect.disabled = true;
      await moveConversationStage(conversation, stageSelect.value);
      var current = selectedConversation();
      if (current?.id === conversation.id) stageSelect.value = current.stage_id || '';
      stageSelect.disabled = !canTransfer(current);
    };
    var stageStatus = node('span', 'smyl-inbox-stage-status'); stageStatus.dataset.stageStatus = ''; stageStatus.setAttribute('role', 'status');
    stageLabel.append(stageSelect); organization.append(stageLabel, stageStatus);
    var pinButton = node('button', 'btn btn-secondary btn-sm', conversation.pinned ? 'Quitar de fijadas' : 'Fijar arriba');
    pinButton.type = 'button'; pinButton.disabled = !canOperate(conversation, 'messages.manage');
    pinButton.onclick = function () { mutateConversation(conversation.pinned ? 'unpin' : 'pin'); };
    organization.append(pinButton);
    var searchButton = node('button', 'btn btn-secondary btn-sm', 'Buscar en el hilo');
    searchButton.type = 'button'; searchButton.dataset.threadSearch = ''; searchButton.onclick = openThreadSearch;
    organization.append(searchButton);
    var sharedButton = node('button', 'btn btn-secondary btn-sm', 'Ver archivos compartidos');
    sharedButton.type = 'button'; sharedButton.onclick = openSharedItems;
    organization.append(sharedButton);
    if (conversation.channel === 'whatsapp' && hasPermission('schedule.read')) {
      var professionalLink = node('button', 'btn btn-secondary btn-sm', 'Usar como mi WhatsApp profesional');
      professionalLink.type = 'button'; professionalLink.dataset.threadLinkProfessional = ''; professionalLink.onclick = linkProfessionalWhatsApp;
      organization.append(professionalLink);
    }
    zone.append(organization);

    var assistant = node('section', 'smyl-inbox-context-card'); assistant.append(node('h3', '', 'SMYL Asistente'));
    assistant.append(node('p', '', conversation.paused ? 'Pausado. El equipo atiende este hilo.' : 'Activo. SMYL Asistente puede responder según su capacitación.'));
    var toggle = node('button', conversation.paused ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm', conversation.paused ? (state.copilotLoading[conversation.id] === 'summary' ? 'Preparando contexto…' : 'Preparar reanudación') : 'Pausar y tomar control');
    toggle.type = 'button'; toggle.disabled = !canOperate(conversation, 'messages.manage') || Boolean(state.copilotLoading[conversation.id]); toggle.onclick = function () { conversation.paused ? prepareResume() : mutateConversation('pause'); };
    assistant.append(toggle); zone.append(assistant);

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
      waActions.append(templateButton, scheduleButton); waCard.append(waActions); zone.append(waCard);

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
      zone.append(automationCard);

      var scheduledCard = node('section', 'smyl-inbox-context-card smyl-inbox-scheduled-card'); scheduledCard.append(node('h3', '', 'Programados'));
      if (state.scheduledLoading[conversation.id]) scheduledCard.append(skNode('text', { lines: 2, label: 'Consultando agenda' }));
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
      var newScheduled = node('button', 'btn btn-secondary btn-sm', 'Programar seguimiento'); newScheduled.type = 'button'; newScheduled.disabled = !canOperate(conversation, 'messages.respond'); newScheduled.onclick = openScheduleDialog; scheduledCard.append(newScheduled); zone.append(scheduledCard);
    }

    return zone;
  }

  function renderConversationSettings() {
    var dialog = document.querySelector('[data-settings-dialog]');
    if (!dialog || !dialog.open) return;
    var conversation = selectedConversation(); var content = dialog.querySelector('[data-settings-content]');
    if (!conversation) { dialog.close(); return; }
    var active = document.activeElement; var keep = active && content.contains(active) && active.tagName === 'SELECT';
    if (keep) return; // No reconstruye mientras alguien elige una opción.
    content.innerHTML = ''; content.append(buildConversationSettings(conversation));
  }

  function openConversationSettings() {
    var dialog = document.querySelector('[data-settings-dialog]'); if (!dialog || !selectedConversation()) return;
    if (!dialog.open) dialog.showModal(); renderConversationSettings();
  }

  // Qué bloques de la ficha deja abiertos la persona; vive en memoria durante la sesión (el chat no persiste nada en el navegador).
  var F360_OPEN_DEFAULT = { summary: false, cuenta: true, citas: true };
  function f360OpenState() {
    if (!state.f360Open) state.f360Open = Object.assign({}, F360_OPEN_DEFAULT);
    return state.f360Open;
  }
  function toggleF360Section(sectionId) {
    var open = f360OpenState(); open[sectionId] = !open[sectionId];
    renderContext();
    var conversation = selectedConversation(); var ficha = conversation && state.clinical[conversation.id];
    if (conversation) prepareFicha360Data(conversation, ficha);
  }

  function f360Money(value) { return Number(value || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }); }

  // Lo que se ve con el bloque cerrado: el dato que contesta la pregunta típica («¿cuánto debo?», «¿cuándo es mi cita?»).
  function accountPeek(conversation, linked) {
    if (!linked) return { text: 'Sin vincular', tone: 'muted' };
    if (state.accountLoading && state.accountLoading[conversation.id]) return { text: 'Consultando…', tone: 'muted' };
    var account = state.accountContext && state.accountContext[conversation.id];
    var data = account && account.data;
    if (!data) return { text: 'Sin datos', tone: 'muted' };
    if (data.due > 0) return { text: f360Money(data.due) + ' pendiente', tone: data.overdueCount > 0 ? 'danger' : 'warn' };
    if (data.credit > 0) return { text: f360Money(data.credit) + ' a favor', tone: 'ok' };
    return { text: data.chargeCount ? 'Al corriente' : 'Sin cargos', tone: data.chargeCount ? 'ok' : 'muted' };
  }

  function visitsPeek(conversation, linked) {
    var relevant = conversation.appointment;
    if (relevant && relevant.starts_at) {
      var status = { confirmed: 'Próxima', scheduled: 'Próxima', arrived: 'Llegó', checked_in: 'Llegó', in_progress: 'En consulta', completed: 'Atendido', attended: 'Atendido' }[relevant.status];
      if (status) return { text: status + ' · ' + availabilityDate(relevant.starts_at, relevant.timezone), tone: 'ok' };
    }
    var visits = state.f360Visits[conversation.id];
    var upcoming = visits && visits.items ? visits.items.filter(isUpcomingVisit) : [];
    if (upcoming.length) {
      var next = upcoming[upcoming.length - 1];
      return { text: 'Próx: ' + availabilityDate(next.starts_at, next.timezone), tone: 'ok' };
    }
    var request = state.appointmentContext[conversation.id]; var first = request && (request.items || [])[0];
    var pending = first && !first.appointment?.status && first.status === 'pending';
    if (pending) return { text: 'Solicitud por confirmar', tone: 'warn' };
    if (!linked) return { text: 'Sin vincular', tone: 'muted' };
    if (visits && visits.loading && !visits.items) return { text: 'Consultando…', tone: 'muted' };
    return { text: 'Sin próxima cita', tone: 'muted' };
  }

  function isUpcomingVisit(visit) {
    var end = new Date(visit.ends_at || visit.starts_at);
    var present = ['arrived', 'checked_in', 'in_progress'].includes(visit.status);
    if (!present && !['confirmed', 'scheduled'].includes(visit.status)) return false;
    if (end.getTime() >= Date.now()) return true;
    if (!present || !Number.isFinite(end.getTime())) return false;
    try {
      var clinicDay = new Intl.DateTimeFormat('es-MX', { timeZone: visit.timezone || undefined });
      return clinicDay.format(end) === clinicDay.format(new Date());
    } catch (_) { return availabilityDayKey(end) === availabilityDayKey(Date.now()); }
  }

  function careDate(value) {
    if (!value) return '';
    var dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    var day = new Date(dateOnly ? value + 'T12:00:00Z' : value);
    return Number.isFinite(day.getTime()) ? day.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: dateOnly ? 'UTC' : undefined }) : '';
  }

  // Este historial solo muestra atenciones realizadas. Ni la asignación del chat ni
  // el profesional de una próxima cita acreditan que el paciente haya sido atendido.
  function indexCareHistory(visits) {
    var branches = new Map();
    visits.forEach(function (v) {
      var branchKey = v.branch_id || v.branch_name || '', doctorKey = v.professional_id || v.professional_name || '';
      var who = v.professional_name || (v.professional_id ? 'Profesional no disponible' : 'Profesional no registrado');
      var where = v.branch_name || (v.branch_id ? 'Sucursal no disponible' : 'Sucursal no registrada');
      if (!branches.has(branchKey)) branches.set(branchKey, { name:where, latestName:who, latestAt:v.attended_at, doctors:new Map(), count:0 });
      var branch = branches.get(branchKey); branch.count += 1;
      if (!branch.doctors.has(doctorKey)) branch.doctors.set(doctorKey, { name:who, dates:[] });
      branch.doctors.get(doctorKey).dates.push(v.attended_at);
    });
    var first = branches.values().next().value, peek = 'Sin visitas visibles';
    if (first) {
      peek = first.name + ' · ' + first.latestName;
      var others = Array.from(branches.keys()).filter(function (key) { return key && branches.get(key) !== first; }).length;
      if (others) peek += ' · +' + others + (others === 1 ? ' sede' : ' sedes');
    }
    return { branches:branches, peek:peek };
  }

  function careHistorySection(entry, open, onRetry) {
    var index = entry && entry.index;
    var peek = index ? index.peek : entry && entry.error ? 'No disponible' : 'Consultando…';
    var section = { id:'careHistory', title:'Historial de visitas', peek:{ text:peek, tone:'muted' } };
    if (!open) return section;
    var body = node('div', 'smyl-f360-care'); section.node = body;
    if (!index || !index.branches.size) {
      var hint = entry && entry.error ? 'No se pudo consultar el historial.' : index ? 'No hay visitas completadas visibles.' : 'Consultando visitas…';
      body.append(!index && !(entry && entry.error) ? skNode('text', { lines: 2, label: 'Consultando visitas' }) : node('p', 'smyl-f360-note', hint));
      if (entry && entry.error) {
        var retry = node('button', 'smyl-f360-link', 'Reintentar'); retry.type = 'button'; retry.onclick = onRetry; body.append(retry);
      }
      return section;
    }
    function disclosure(detail, key, initial, populate) {
      var filled = false;
      function fillOnce() { if (detail.open && !filled) { filled = true; populate(); } }
      detail.open = Object.prototype.hasOwnProperty.call(entry.disclosures, key) ? entry.disclosures[key] : initial;
      fillOnce();
      detail.ontoggle = function () { if (detail.isConnected) { entry.disclosures[key] = detail.open; fillOnce(); } };
    }
    function dateNode(stamp) {
      var label = careDate(stamp), el = node(label ? 'time' : 'span', '', label || 'Fecha no registrada');
      if (label) el.dateTime = stamp;
      return el;
    }
    index.branches.forEach(function (branch, branchKey) {
      var group = node('details', 'smyl-f360-care-group'), heading = node('summary', 'smyl-f360-care-heading');
      heading.append(node('strong', '', branch.name), node('span', '', branch.count === 1 ? '1 visita' : branch.count + ' visitas'));
      if (index.branches.size > 1) heading.append(node('small', '', branch.latestName + ' · ' + (careDate(branch.latestAt) || 'Fecha no registrada')));
      group.append(heading);
      disclosure(group, JSON.stringify(['branch', branchKey]), index.branches.size === 1, function () {
        var list = node('ul', 'smyl-f360-care-list');
        branch.doctors.forEach(function (doctor, doctorKey) {
          var row = node('li', 'smyl-f360-care-row'); row.append(node('strong', '', doctor.name));
          if (doctor.dates.length === 1) row.append(dateNode(doctor.dates[0]));
          else {
            var dates = node('details', 'smyl-f360-care-dates');
            dates.append(node('summary', '', doctor.dates.length + ' visitas · Última: ' + (careDate(doctor.dates[0]) || 'fecha no registrada')));
            disclosure(dates, JSON.stringify(['dates', branchKey, doctorKey]), false, function () {
              var dateList = node('ul', 'smyl-f360-care-days');
              doctor.dates.forEach(function (stamp) { var li = node('li'); li.append(dateNode(stamp)); dateList.append(li); });
              dates.append(dateList);
            });
            row.append(dates);
          }
          list.append(row);
        });
        group.append(list);
      });
      body.append(group);
    });
    if (entry.truncated) body.append(node('p', 'smyl-f360-note', 'Se muestran las 1,000 visitas completadas más recientes a las que tienes acceso.'));
    return section;
  }

  function buildFicha360(conversation, ficha, zones) {
    var F = window.SmylInboxFicha; var id = conversation.id;
    if (!F) {
      var fallback = node('section', 'smyl-inbox-context-card smyl-inbox-ficha-fallback');
      fallback.append(node('h3', '', 'Paciente y atención'), node('p', '', 'La ficha clínica no está disponible en este momento. La conversación permanece activa.'));
      return fallback;
    }
    var linked = Boolean(ficha && ficha.linked && ficha.patient && ficha.patient.id);
    var linkedFicha = Boolean(linked && hasPermission('clinical.read'));
    var patient = linkedFicha && ficha.patient || null;
    // Solo avisos que piden algo; lo «normal» (identificado, origen) ya no ocupa espacio.
    var chips = [];
    if (linkedFicha) {
      if (ficha.provisional_contact) chips.push({ text: 'Contacto provisional', tone: 'warn' });
      if (patient && typeof patient.whatsapp_consent === 'boolean' && !patient.whatsapp_consent) chips.push({ text: 'Sin consentimiento de WhatsApp', tone: 'warn' });
    }
    var subtitle = patient ? [patient.phone, patient.email].filter(Boolean).join(' · ') : (conversation.contact_phone || '');
    var lastSeen = conversation.last_message_at
      ? F && typeof F.shortDate === 'function' ? F.shortDate(conversation.last_message_at, true) : availabilityDate(conversation.last_message_at)
      : '';
    var meta = 'Escribe por ' + channelLabel(conversation.channel) + (lastSeen ? ' · último mensaje ' + lastSeen.toLowerCase() : '');
    var open = f360OpenState(); var sections = [];

    // 1. Resumen de la conversación con IA (se queda) y, si aplica, la solicitud de intervención.
    if (hasPermission('messages.read') && F.conversationSummary) {
      var entry = state.f360Summary[id] || {};
      var canGenerate = hasPermission('messages.respond');
      var stale = Boolean(entry.data && entry.basis !== summaryBasis(conversation));
      var summaryBody = wrapPanel(zones.summary);
      summaryBody.append(F.conversationSummary({
        data: entry.data || null, loading: Boolean(entry.loading), error: entry.error || '', at: entry.at, by: entry.by || '', canGenerate: canGenerate, stale: stale,
        onRefresh: canGenerate ? function () { requestConversationSummary(id, true); } : null,
        needsTraining: Boolean(!entry.data && entry.error && isTrainingMissing(entry)),
        onOpenTraining: hasPermission('settings.manage') ? openAssistantTraining : null,
        onCopy: entry.data ? function (event) { copyConversationSummary(entry.data, event && event.currentTarget); } : null,
      }));
      sections.push({ id: 'summary', title: 'Resumen de la conversación', badge: 'IA', peek: conversation.needs_human ? { text: 'Requiere atención', tone: 'danger' } : stale ? { text: 'Hay mensajes nuevos', tone: 'warn' } : entry.data ? { text: 'Disponible', tone: 'ok' } : { text: 'Opcional', tone: 'muted' }, node: summaryBody });
    } else if (zones.summary.childNodes.length) {
      sections.push({ id: 'summary', title: 'Atención', node: wrapPanel(zones.summary) });
    }

    // 2. Cuenta: saldo, vencidos y últimos movimientos.
    if (hasPermission('finance.read') && zones.cobros.childNodes.length) {
      var cuenta = wrapPanel(zones.cobros);
      if (linked && F.movements) {
        var moves = state.f360Movements[id] || {};
        cuenta.append(F.movements({ items: (moves.items || []).slice(0, 3), loading: Boolean(moves.loading) && !moves.items, error: moves.error || '', onRetry: function () { loadPatientMovements(id, ficha.patient.id, true); } }));
      }
      sections.push({ id: 'cuenta', title: 'Cuenta', peek: accountPeek(conversation, linked), node: cuenta });
    }

    // 3. Citas: próximas y anteriores con tratamiento, dentista y sucursal.
    if (hasPermission('schedule.read')) {
      var citas = wrapPanel(zones.citas);
      var cardVisit = conversation.appointment;
      if ((linked || cardVisit) && F.visits) {
        var visits = state.f360Visits[id] || {};
        var requestCard = citas.querySelector('[data-appointment-id]');
        var requestId = requestCard && requestCard.dataset.appointmentId;
        var items = (visits.items || []).filter(function (visit) { return visit.id !== requestId; });
        if (cardVisit && cardVisit.id !== requestId) {
          var saved = items.find(function (visit) { return visit.id === cardVisit.id; });
          var current = Object.assign({ service: 'Cita en Agenda' }, saved, cardVisit);
          items = items.filter(function (visit) { return visit.id !== current.id; }).concat(current);
          items.sort(function (a, b) { return new Date(b.starts_at) - new Date(a.starts_at); });
        }
        if (!citas.childElementCount || visits.loading || visits.error || items.length) citas.append(F.visits({
          items: items, loading: Boolean(visits.loading) && !items.length, error: visits.error || '', showAll: Boolean(state.f360VisitsAll[id]),
          isUpcoming: isUpcomingVisit, formatDate: availabilityDate,
          onManage: hasPermission('schedule.manage') && window.SmylSchedule && typeof window.SmylSchedule.openAppointmentAction === 'function' ? manageVisit : null,
          onShowAll: function () { state.f360VisitsAll[id] = !state.f360VisitsAll[id]; renderContext(); },
          onRetry: function () { if (linked) loadPatientVisits(id, ficha.patient.id, true); },
        }));
      } else if (!linked && !citas.childElementCount) citas.append(F.notice('Vincula al paciente para ver sus citas anteriores y próximas.'));
      sections.push({ id: 'citas', title: 'Citas', peek: visitsPeek(conversation, linked), node: citas });
    }

    if (linked && !ficha.clinical_restricted && hasPermission('schedule.read')) {
      var patientId = ficha.patient.id, historyKey = careHistoryKey(id, patientId);
      // Sin visitas completadas no hay nada que mostrar: la sección se omite (mientras consulta o si falla, sí se ve).
      var historyEntry = careHistoryCache.get(historyKey);
      if (!(historyEntry && historyEntry.index && !historyEntry.index.branches.size)) sections.push(careHistorySection(historyEntry, open.careHistory, function () { loadCareHistory(id, patientId, true); }));
    }

    sections.forEach(function (section) { section.open = Boolean(open[section.id]); });
    return F.shell({
      initials: initials(conversation.contact_name), subtitle: subtitle, meta: meta, chips: chips,
      medical: patient && patient.medical_alerts && typeof patient.medical_alerts === 'object' ? patient.medical_alerts
        : hasPermission('clinical.read') && !linked && !state.patientLinking[conversation.id] ? { unlinked: true, onLink: function () { openPatientContext(conversation.id); } } : null,
      onCompleteHistory: function () { openPatientContext(conversation.id); },
      sections: sections, onToggle: toggleF360Section,
    });
  }

  function buildFichaFiles(conversation, ficha) {
    var id = conversation.id;
    var cache = state.f360Shared[id] || {};
    var reviewed = {}; ((ficha && ficha.clinical_images) || []).forEach(function (link) { if (link.lana_message_id) reviewed[link.lana_message_id] = true; });
    return window.SmylInboxFicha.files({
      items: cache.items || [], loading: !state.f360Shared[id] || (Boolean(cache.loading) && !cache.items), error: cache.error || '', filter: state.f360Filter[id] || 'all', selectedId: state.f360File[id] || '',
      reviewed: reviewed, canReview: hasPermission('clinical.write') && canOperate(conversation, 'clinical.write'), channelLabel: channelLabel(conversation.channel),
      onFilter: function (value) { state.f360Filter[id] = value; state.f360File[id] = ''; renderContext(); },
      onSelect: function (value) { state.f360File[id] = value; renderContext(); },
      makeOpenButton: function (item) { return chatMediaKind(item) ? chatMediaButton(item, id, false) : null; },
      thumbnail: function (item) { return mediaThumbnail(item, 'Foto'); },
      fileUrl: chatFileUrl,
      onReview: function (item) { if (state.selectedId === id) linkClinicalImage(item); },
      onRetry: function () { loadFicha360Files(id, true); },
    });
  }

  function wrapPanel(fragment) {
    var body = document.createElement('div'); body.className = 'smyl-f360-body'; body.append(fragment); return body;
  }

  // Carga perezosa por bloque: el resumen al abrirlo; citas siempre (su dato se ve cerrado); movimientos al abrir Cuenta.
  function prepareFicha360Data(conversation, ficha) {
    if (!state.contextOpen) return;
    var id = conversation.id; var open = f360OpenState();
    if (open.summary && hasPermission('messages.read') && !state.f360Summary[id]) loadStoredSummary(id);
    var patientId = ficha && ficha.linked && ficha.patient && ficha.patient.id;
    if (!patientId) return;
    if (!ficha.clinical_restricted && hasPermission('schedule.read')) loadCareHistory(id, patientId, false);
    var visits = state.f360Visits[id];
    if (hasPermission('schedule.read') && (!visits || (!visits.loading && Date.now() - (visits.at || 0) > 60000))) loadPatientVisits(id, patientId, false);
    var moves = state.f360Movements[id];
    if (open.cuenta && hasPermission('finance.read') && (!moves || (!moves.loading && Date.now() - (moves.at || 0) > 60000))) loadPatientMovements(id, patientId, false);
  }

  var careHistoryCache = new Map();
  function careHistoryKey(id, patientId) { return JSON.stringify([state.actor && state.actor.id, id, patientId]); }
  async function loadCareHistory(id, patientId, force) {
    if (!state.contextOpen || state.selectedId !== id || !patientId || !hasPermission('schedule.read')) return;
    var key = careHistoryKey(id, patientId), previous = careHistoryCache.get(key);
    if (previous && (previous.loading || (!force && Date.now() - previous.at < 60000))) return;
    var entry = { loading:true, at:Date.now(), index:previous && previous.index, disclosures:previous && previous.disclosures || Object.create(null) };
    careHistoryCache.set(key, entry);
    try {
      var result = await window.SmylSchedule.patientCareHistory(patientId);
      if (!result || !Array.isArray(result.visits)) throw new Error('unavailable');
      entry.index = indexCareHistory(result.visits); entry.truncated = result.truncated === true;
    } catch (_) { entry.index = null; entry.error = true; }
    entry.loading = false; entry.at = Date.now();
    var current = state.clinical[id];
    if (careHistoryKey(id, patientId) !== key || !current || !current.linked || !current.patient || current.patient.id !== patientId || current.clinical_restricted || !hasPermission('schedule.read')) { careHistoryCache.delete(key); return; }
    if (state.contextOpen && state.selectedId === id) renderContext();
  }

  // Resumen con IA opcional: se genera solo cuando alguien pulsa «Resumir conversación» o «Actualizar».
  // Vive en memoria (no en el navegador) porque contiene datos del paciente.
  function summaryBasis(conversation) {
    return conversation ? storedBasis(conversation.last_message_at) : '';
  }

  // Solo lee el resumen guardado en el servidor (lo ve todo el equipo con acceso al chat); generarlo es opcional.
  async function loadStoredSummary(conversationId) {
    if (state.f360Summary[conversationId]) return;
    state.f360Summary[conversationId] = { loading: true, error: '' };
    var stored = null;
    try { stored = await request('GET', { action: 'conversation_summary', conversation_id: conversationId }); } catch (error) { stored = null; }
    if (stored && stored.summary && typeof stored.summary === 'object') {
      state.f360Summary[conversationId] = { data: stored.summary, basis: storedBasis(stored.basis_at), at: stored.generated_at, by: stored.generated_by_name || '', loading: false, error: '' };
      if (state.selectedId === conversationId && state.contextOpen) renderContext();
      return;
    }
    // Opcional: sin resumen guardado no se gasta IA; el equipo lo pide con «Resumir conversación».
    state.f360Summary[conversationId] = { loading: false, error: '' };
    if (state.selectedId === conversationId && state.contextOpen) renderContext();
  }

  // El servidor devuelve la fecha normalizada (ISO); se compara contra last_message_at normalizado igual.
  function storedBasis(value) {
    var date = value ? new Date(value) : null;
    return date && !isNaN(date.getTime()) ? date.toISOString() : '';
  }

  async function requestConversationSummary(conversationId, force) {
    var conversation = state.conversations.find(function (item) { return item.id === conversationId; });
    var entry = state.f360Summary[conversationId];
    if (!conversation || (entry && entry.loading) || (!force && entry)) return null;
    var basis = summaryBasis(conversation);
    state.f360Summary[conversationId] = Object.assign({}, entry, { loading: true, error: '' });
    if (state.selectedId === conversationId && state.contextOpen) renderContext();
    try {
      var data = await request('POST', {}, { action: 'copilot', conversation_id: conversationId, mode: 'summary', basis_at: conversation.last_message_at || null }, null, 35000);
      state.f360Summary[conversationId] = { data: data, basis: basis, at: data.generated_at || new Date().toISOString(), by: data.stored ? (data.generated_by_name || '') : '', loading: false, error: '' };
    } catch (error) {
      state.f360Summary[conversationId] = Object.assign({}, state.f360Summary[conversationId], { loading: false, error: (error && error.message) || 'No se pudo resumir la conversación.', code: (error && error.code) || '' });
    }
    if (state.selectedId === conversationId && state.contextOpen) renderContext();
    return state.f360Summary[conversationId].data || null;
  }

  // LANA rechaza Copilot sin capacitación publicada; se reconoce por código o, si no viene, por el texto del error.
  function isTrainingMissing(entry) {
    return /training/i.test(String(entry.code || '')) || /capacitaci[oó]n/i.test(String(entry.error || ''));
  }

  function openAssistantTraining() {
    closeContext(false);
    window.ir('conexiones');
    setTimeout(function () {
      var tab = document.querySelector('#p-conexiones [data-connection-tab="assistant"]');
      if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
      var target = document.getElementById('lana-training-title');
      if (target) { target.scrollIntoView({ block: 'start' }); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
    }, 350);
  }

  function freshConversationSummary(conversation) {
    var entry = conversation && state.f360Summary[conversation.id];
    return entry && entry.data && !entry.loading && entry.basis === summaryBasis(conversation) ? entry.data : null;
  }

  function copyConversationSummary(data, trigger) {
    var parts = [data.summary || ''];
    if (data.next_step) parts.push('Siguiente paso: ' + data.next_step);
    if ((data.open_questions || []).length) parts.push('Falta confirmar: ' + data.open_questions.join('; '));
    if ((data.unconfirmed_facts || []).length) parts.push('No confirmado: ' + data.unconfirmed_facts.join('; '));
    var textValue = parts.filter(Boolean).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textValue).then(function () { if (trigger) { trigger.textContent = 'Copiado ✓'; setTimeout(function () { if (trigger.isConnected) trigger.textContent = 'Copiar'; }, 1800); } }, function () { window.prompt('Copia el resumen:', textValue); });
    else window.prompt('Copia el resumen:', textValue);
  }

  async function loadFicha360Files(conversationId, force) {
    if (!hasPermission('messages.read') || state.selectedId !== conversationId) return;
    var epoch = accessEpoch, revision = threadEpoch.get(conversationId);
    var cache = state.f360Shared[conversationId];
    if (cache && (cache.loading || (!force && Date.now() - cache.at < 30000))) return;
    state.f360Shared[conversationId] = Object.assign({}, cache, { loading: true, error: '', at: Date.now() });
    if (force && state.selectedId === conversationId) renderContext();
    try {
      var data = await request('GET', { action: 'shared', conversation_id: conversationId, limit: 60 });
      if (epoch !== accessEpoch || revision !== threadEpoch.get(conversationId)) return;
      state.f360Shared[conversationId] = { items: data.items || [], loading: false, error: '', at: Date.now() };
    } catch (error) {
      if (epoch !== accessEpoch || revision !== threadEpoch.get(conversationId)) return;
      state.f360Shared[conversationId] = Object.assign({}, state.f360Shared[conversationId], { loading: false, error: (error && error.message) || 'No se pudieron consultar los archivos.', at: Date.now() });
    }
    if (state.selectedId === conversationId && state.contextOpen) renderContext();
  }

  // Citas del paciente (no solo las pedidas por el chat). Las consulta Agenda (SmylSchedule) y Cobros (SmylFinance)
  // agrega qué se cobró en cada una; el chat no toca tablas y RLS aplica el alcance del rol y de la sucursal.
  async function loadPatientVisits(conversationId, patientId, force) {
    var schedule = window.SmylSchedule;
    if (!patientId || !schedule || typeof schedule.patientVisits !== 'function') return;
    var cache = state.f360Visits[conversationId];
    if (cache && cache.loading) return;
    state.f360Visits[conversationId] = Object.assign({}, cache, { loading: true, error: '', at: Date.now() });
    if (force && state.selectedId === conversationId) renderContext();
    try {
      var items = await schedule.patientVisits(patientId, 30);
      var finance = window.SmylFinance; var concepts = {};
      if (items.length && hasPermission('finance.read') && finance && typeof finance.appointmentConcepts === 'function') {
        try { concepts = await finance.appointmentConcepts(items.map(function (item) { return item.id; })); } catch (_) { concepts = {}; }
      }
      state.f360Visits[conversationId] = { loading: false, error: '', at: Date.now(), items: items.map(function (item) { return Object.assign({}, item, { treatments: concepts[item.id] || [] }); }) };
    } catch (error) {
      state.f360Visits[conversationId] = Object.assign({}, state.f360Visits[conversationId], { loading: false, error: 'No se pudieron consultar las citas.', at: Date.now() });
    }
    if (state.selectedId === conversationId && state.contextOpen) renderContext();
  }

  // Últimos cargos y pagos (los da Cobros); el detalle completo se abre con «Ver cuenta completa».
  async function loadPatientMovements(conversationId, patientId, force) {
    var finance = window.SmylFinance;
    if (!patientId || !finance || typeof finance.recentMovements !== 'function') return;
    var cache = state.f360Movements[conversationId];
    if (cache && cache.loading) return;
    state.f360Movements[conversationId] = Object.assign({}, cache, { loading: true, error: '', at: Date.now() });
    if (force && state.selectedId === conversationId) renderContext();
    try {
      state.f360Movements[conversationId] = { items: await finance.recentMovements(patientId, 8), loading: false, error: '', at: Date.now() };
    } catch (error) {
      state.f360Movements[conversationId] = Object.assign({}, state.f360Movements[conversationId], { loading: false, error: 'No se pudieron consultar los movimientos.', at: Date.now() });
    }
    if (state.selectedId === conversationId && state.contextOpen) renderContext();
  }

  function openCareTask(type) {
    var conversation = selectedConversation();
    var permission = type === 'quote' ? 'proposal.write' : 'finance.manage';
    if (!conversation || !hasPermission(permission) || !canOperate(conversation, permission)) return;
    // Cobrar se hace aquí mismo: con el paciente de la conversación ya elegido (o con el buscador del cobro si aún no hay uno),
    // sin lista intermedia de pacientes y sin salir del chat.
    if (type === 'payment' && window.SmylFinance && typeof window.SmylFinance.collect === 'function') {
      var ficha = state.clinical[conversation.id];
      var linked = ficha && ficha.linked && ficha.patient || null;
      window.SmylFinance.collect(linked && linked.id || '', linked).then(function (result) {
        if (result && result.ok) return;
        window.alert(result && result.reason === 'role' ? 'Tu rol puede consultar Cobros, pero no registrar cobros.' : 'No pudimos abrir el cobro. Revisa tu conexión e inténtalo de nuevo.');
      });
      return;
    }
    if (window.SmylCareTasks && typeof window.SmylCareTasks.open === 'function') window.SmylCareTasks.open(type);
    else window.ir(type === 'quote' ? 'propuestas' : 'caja');
  }

  // Tras cobrar, la «Cuenta del paciente» del chat se actualiza sola.
  window.addEventListener('smyl:finance-updated', function () {
    if (state.selectedId) loadAccountContext(state.selectedId);
  });

  function permittedCareActions(conversation) {
    var actions = [];
    if (hasPermission('schedule.manage') && canOperate(conversation, 'schedule.manage')) actions.push({ id: 'schedule', label: 'Agendar cita', run: openAvailabilityDialog });
    if (hasPermission('clinical.read')) {
      var careFicha = state.clinical[conversation.id];
      var careLinked = Boolean(careFicha && careFicha.linked && careFicha.patient && careFicha.patient.id);
      actions.push({ id: 'record', label: careLinked ? 'Expediente' : 'Vincular paciente', run: function () { openPatientContext(conversation.id); } });
    }
    if (hasPermission('proposal.write') && canOperate(conversation, 'proposal.write')) actions.push({ id: 'quote', label: 'Cotizar', run: function () { openCareTask('quote'); } });
    if (hasPermission('finance.manage') && canOperate(conversation, 'finance.manage')) actions.push({ id: 'payment', label: 'Cobrar', run: function () { openCareTask('payment'); } });
    return actions;
  }

  function primaryCareAction(conversation, actions) {
    var canRespond = canOperate(conversation, 'messages.respond');
    // La plantilla vive solo en el compositor (aviso de ventana vencida); el encabezado tiene una sola acción principal.
    var scheduleAction = actions.find(function (action) { return action.id === 'schedule'; });
    if (scheduleAction) return scheduleAction;
    if (canRespond && (conversation.needs_human || conversation.unread_count)) return { id: 'respond', label: 'Responder ahora', run: focusComposer };
    var stage = stageName(conversation.stage_id).toLowerCase();
    var preferred = /cobr|pag|factur|caja/.test(stage) ? 'payment' : /cotiz|valor|plan|propuest/.test(stage) ? 'quote' : 'schedule';
    return actions.find(function (action) { return action.id === preferred; }) || actions[0] || (canRespond ? { id: 'respond', label: 'Responder', run: focusComposer } : null);
  }

  function menuItems(menu) {
    return menu ? Array.from(menu.querySelectorAll('[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])')).filter(function (item) { return !item.hidden && item.getClientRects().length; }) : [];
  }

  function menuKeydown(event, menu, close) {
    if (event.target && event.target.closest && event.target.closest('select,input,textarea,[contenteditable="true"]')) return;
    var items = menuItems(menu); var current = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (!items.length || ['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) === -1) return;
    event.preventDefault();
    var next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (Math.max(0, current) + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  }

  function renderCareBar() {
    var host = document.querySelector('[data-thread-carebar]');
    var conversation = selectedConversation();
    if (!host) return;
    host.innerHTML = '';
    host.hidden = !conversation;
    if (!conversation) return;
    var actions = permittedCareActions(conversation);
    var primary = primaryCareAction(conversation, actions);
    if (primary) {
      var primaryButton = node('button', 'smyl-inbox-care-action is-primary', primary.label);
      if (primary.id === 'schedule') {
        primaryButton.setAttribute('aria-label', primary.label);
        primaryButton.title = primary.label;
        primaryButton.innerHTML = composeIcon('calendar') + '<span class="smyl-inbox-care-label" aria-hidden="true">Agendar</span>';
      }
      primaryButton.type = 'button'; primaryButton.dataset.threadPrimaryAction = primary.id; primaryButton.onclick = primary.run; host.append(primaryButton);
    }
  }

  function closeComposerTools(restoreFocus) {
    var tools = document.querySelector('[data-compose-tools]'); var trigger = document.querySelector('[data-compose-more]');
    var wasOpen = Boolean(tools && !tools.hidden);
    if (tools) tools.hidden = true;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus && wasOpen) trigger.focus();
    }
  }

  function toggleComposerTools() {
    var tools = document.querySelector('[data-compose-tools]'); var trigger = document.querySelector('[data-compose-more]');
    if (!tools || !trigger) return;
    var open = tools.hidden; tools.hidden = !open; trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) setTimeout(function () { var first = menuItems(tools)[0]; if (first) first.focus(); }, 0);
  }

  function renderThreadHeader() {
    var conversation = selectedConversation();
    renderHandoffNote(conversation);
    var empty = document.querySelector('[data-inbox-thread-empty]');
    var thread = document.querySelector('[data-inbox-thread]');
    if (!conversation) {
      if (empty) empty.hidden = false; if (thread) thread.hidden = true;
      var openNext = document.querySelector('[data-inbox-open-next]');
      if (openNext) { openNext.disabled = !visibleConversations().length; openNext.onclick = function () { var next = visibleConversations()[0]; if (next) openConversation(next.id); }; }
      renderCareBar(); renderContext(); return;
    }
    empty.hidden = true; thread.hidden = false;
    var headerAvatar = document.querySelector('[data-thread-avatar]');
    headerAvatar.textContent = initials(conversation.contact_name);
    headerAvatar.dataset.channel = conversation.channel;
    document.querySelector('[data-thread-name]').textContent = conversation.contact_name;
    var threadFicha = state.clinical[conversation.id];
    var actorRole = state.actor && state.actor.role_name;
    var continuityLabel = state.patientLinking[conversation.id] ? 'Identificando paciente' : threadFicha && threadFicha.linked ? 'Paciente vinculado' : 'Identidad por revisar';
    var patientSummary = document.querySelector('[data-inbox-context]');
    patientSummary.setAttribute('aria-label', 'Abrir paciente y atención · ' + continuityLabel + (actorRole ? ' · ' + actorRole : ''));
    var headerWindow = liveWhatsappWindow(conversation);
    var threadMeta = [channelLabel(conversation.channel)];
    renderThreadBranchChip(conversation);
    if (headerWindow && headerWindow.status !== 'expired') threadMeta.push('Ventana 24 h: quedan ' + durationLabel(headerWindow.remaining_seconds));
    var meta = document.querySelector('[data-thread-meta]');
    var channelLogo = node('span', 'smyl-inbox-thread-channel-logo');
    channelLogo.setAttribute('aria-hidden', 'true');
    channelLogo.innerHTML = (CHANNEL_MARKS[conversation.channel] || '').replace(/smyl-(ig|ms)-gradient/g, 'smyl-thread-$1-gradient');
    channelLogo.hidden = !CHANNEL_MARKS[conversation.channel];
    meta.replaceChildren(channelLogo, node('span', 'smyl-inbox-thread-channel-text', threadMeta.join(' · ')));
    // Aviso visible aunque la ficha esté cerrada; solo con permiso clínico (el servidor ya filtra el alcance).
    var medicalFlag = document.querySelector('[data-thread-medical]');
    var medicalItems = hasPermission('clinical.read') && threadFicha && threadFicha.linked && threadFicha.patient && threadFicha.patient.medical_alerts ? (threadFicha.patient.medical_alerts.items || []) : [];
    if (medicalFlag) {
      medicalFlag.hidden = !medicalItems.length;
      medicalFlag.textContent = medicalItems.length ? '⚠ ' + (medicalItems.length === 1 ? (medicalItems[0].kind === 'allergy' ? 'Alergia: ' : '') + medicalItems[0].label : medicalItems.length + ' alertas médicas') : '';
      if (medicalItems.length) patientSummary.setAttribute('aria-label', patientSummary.getAttribute('aria-label') + ' · ' + medicalFlag.textContent.replace('⚠ ', 'Alerta médica: '));
    }
    // Un solo interruptor sustituye al chip de estado y al botón Tomar control / Reanudar IA.
    var stateLabel = document.querySelector('[data-thread-state]');
    var mode = document.querySelector('[data-thread-mode]');
    stateLabel.textContent = conversation.paused ? (state.copilotLoading[conversation.id] === 'summary' ? 'Preparando…' : 'IA pausada') : 'IA activa';
    mode.dataset.state = conversation.paused ? 'resume' : 'pause';
    mode.title = stateLabel.textContent + (conversation.paused ? ' · Activar IA' : ' · Pausar IA');
    mode.setAttribute('aria-checked', conversation.paused ? 'false' : 'true');
    mode.setAttribute('aria-label', conversation.paused ? 'IA pausada: activar para que SMYL Asistente vuelva a responder' : 'IA activa: desactivar para tomar el control de la conversación');
    mode.disabled = !canOperate(conversation, 'messages.manage') || Boolean(state.copilotLoading[conversation.id]);
    var composer = document.querySelector('[data-inbox-composer]');
    Array.from(composer.elements).forEach(function (control) { control.disabled = !canOperate(conversation, 'messages.respond'); });
    renderChatOwner(conversation);
    renderComposerContext(); renderWhatsappWindow(); renderCareBar(); renderContext();
  }

  async function linkProfessionalWhatsApp(){var conversation=selectedConversation();if(!conversation||conversation.channel!=='whatsapp')return;if(!window.confirm('¿Usar esta conversación para recibir tus confirmaciones de citas como profesional?'))return;try{var result=await window.sb.functions.invoke('appointment-negotiations',{body:{action:'link_my_professional',conversation_id:conversation.id}});if(result.error)throw result.error;if(result.data&&result.data.error)throw new Error(result.data.error);window.alert('WhatsApp profesional vinculado. Las nuevas solicitudes podrán llegar a esta conversación.');}catch(error){window.alert(error.message||'No se pudo vincular este WhatsApp profesional.');}}

  // Conversaciones sin leer junto a «Mensajes» en el menú, como en LANA. Consulta solo el total, sin abrir nada.
  function renderNavBadge(count) {
    document.querySelectorAll('.pro-app-nav [data-route="inbox"]').forEach(function (button) {
      var badge = button.querySelector('.pro-nav-count');
      if (!badge) { badge = node('span', 'pro-nav-count'); button.append(badge); }
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = !count;
      badge.setAttribute('aria-label', count + (count === 1 ? ' conversación sin leer' : ' conversaciones sin leer'));
    });
  }

  async function refreshUnreadBadge() {
    if (!chatEnabled() || document.visibilityState !== 'visible' || state.badgeFailures >= 3 || state.loadingList) return;
    try {
      var data = await request('GET', { action: 'list', filter: 'unread', limit: 1, offset: 0 }, null, null, 12000);
      state.badgeFailures = 0;
      renderNavBadge(Number(data.page && data.page.total) || 0);
    } catch (_) { state.badgeFailures += 1; }
  }

  function dayLabel(date) {
    var startOf = function (value) { return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime(); };
    var diff = Math.round((startOf(new Date()) - startOf(date)) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function render() {
    renderList(); renderThreadHeader(); renderMessages(false); renderCopilotDraft();
  }

  function renderHandoffNote(conversation) {
    var note = document.querySelector('[data-handoff]');
    if (!note) return;
    var dialog = note.closest('dialog');
    var allowed = conversation && conversation.id === state.selectedId && canTransfer(conversation);
    if (dialog.open && (!allowed || dialog.dataset.thread !== conversation.id)) {
      var transfer = document.querySelector('dialog[data-chat-transfer][open]');
      if (transfer && transfer.dataset.chatTransfer === dialog.dataset.thread) transfer.close();
      dialog.close();
    }
    var text = allowed ? (conversation.private_handoff_note || '').trim() : '';
    var body = note.querySelector('p');
    if (body.textContent !== text) body.textContent = text;
    note.hidden = !text;
  }

  function renderChatOwner(conversation) {
    var wrap = document.querySelector('[data-thread-owner]');
    if (!wrap || !conversation) return;
    var dialog = document.querySelector('[data-owner-dialog]');
    var select = dialog.querySelector('select'), retry = dialog.querySelector('[data-thread-owner-retry]');
    var assignment = conversation.assignment, current = assignment ? (assignment.actor_id || '__legacy') : '';
    var name = assignment && assignment.name || 'Sin asignar';
    var allowed = canTransfer(conversation);
    var roster = teamFor(conversation);
    var canChoose = allowed && roster.status === 'ready' && Boolean(roster.members.some(function (m) { return m.id !== current; }) || (assignment && state.actor.chat_access === 'coordinator'));
    // Avoid replacing options under an open native picker when the conversation polls.
    var signature = JSON.stringify([conversation.id, current, name, state.actor && state.actor.chat_access, roster.status, roster.members.map(function (m) { return [m.id, m.name, m.kind]; })]);
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature; select.replaceChildren();
      if (!current || state.actor.chat_access === 'coordinator') select.add(new Option('Sin asignar', ''));
      roster.members.forEach(function (member) {
        var kind = {owner:'Titular', professional:'Profesional clínico', staff:'Equipo de atención'}[member.kind];
        select.add(new Option(member.name + (kind ? ' · ' + kind : ''), member.id));
      });
      if (current && !roster.members.some(function (m) { return m.id === current; })) {
        var prior = new Option(name, current); prior.disabled = true; select.add(prior);
      }
    }
    select.value = current; select.disabled = !canChoose; select.dataset.conversationId = conversation.id;
    wrap.querySelector('[data-thread-owner-name]').textContent = name;
    var description = 'Responsable del chat: ' + name;
    wrap.setAttribute('aria-label', 'Atiende el chat: ' + name);
    wrap.title = description;
    var unavailable = allowed && roster.status === 'error';
    select.setAttribute('aria-label', description + (canChoose ? '. Cambiar responsable' : ''));
    wrap.disabled = !allowed;
    var status = dialog.querySelector('[data-owner-status]');
    var hint = unavailable ? 'No se pudo cargar el equipo.' : roster.status === 'loading' ? 'Cargando equipo…' :
      allowed && !canChoose ? 'No hay otros responsables disponibles.' : '';
    if (status.textContent !== hint) status.textContent = hint;
    status.hidden = !hint;
    retry.hidden = !unavailable; retry.setAttribute('aria-label', 'Reintentar carga del equipo');
  }

  function announceHandoff(message, conversationId) {
    var alert = document.querySelector('[data-inbox-handoff-status]');
    if (!alert) return;
    clearTimeout(state.handoffTimer); alert.hidden = false; alert.textContent = message;
    if (conversationId) {
      var open = node('button', 'smyl-inbox-bulk-clear', 'Abrir chat');
      open.type = 'button'; open.onclick = function () { alert.hidden = true; openConversation(conversationId); };
      alert.append(document.createTextNode(' '), open);
    }
    state.handoffTimer = setTimeout(function () { if (!alert.contains(document.activeElement)) { alert.hidden = true; alert.textContent = ''; } }, 12000);
  }

  function canTransfer(conversation) {
    return Boolean(state.actor && conversation && (state.actor.chat_access === 'coordinator' ||
      state.actor.chat_access === 'agent' && conversation.assignment && conversation.assignment.actor_id === state.actor.id));
  }

  function changeChatOwner(conversationId, targetId) {
    var conversation = selectedConversation();
    if (!conversation || conversation.id !== conversationId || !canTransfer(conversation)) return;
    renderChatOwner(conversation);
    var roster = teamFor(conversation);
    if (roster.status !== 'ready') return;
    var member = roster.members.find(function (item) { return item.id === targetId; });
    if (targetId ? !member : state.actor.chat_access !== 'coordinator') return;
    if ((conversation.assignment && conversation.assignment.actor_id || '') === targetId) return;
    var version = conversation.assignment_version;
    var dialog = node('dialog', 'smyl-chat-transfer');
    var isTransfer = Boolean(conversation.assignment && targetId);
    var heading = node('h2', '', targetId ? (isTransfer ? 'Transferir conversación' : 'Asignar conversación') : 'Devolver a la bandeja sin asignar');
    heading.id = 'smyl-transfer-title'; dialog.setAttribute('aria-labelledby', heading.id);
    dialog.dataset.chatTransfer = conversationId;
    var form = node('form');
    var recipient = node('p', '', (conversation.contact_name || 'Conversación') + ' → ' + (member ? member.name : 'Sin asignar'));
    var label = node('label', '', 'Nota privada de relevo (opcional)');
    var note = node('textarea'); note.rows = 3; note.maxLength = 500; note.name = 'private_note';
    note.placeholder = '¿Qué necesita saber quien recibe el chat?'; label.append(note);
    var help = node('small', '', 'Solo visible para el equipo que puede abrir este chat.');
    var error = node('p'); error.setAttribute('role', 'alert'); error.hidden = true;
    var actions = node('footer'), cancel = node('button', 'btn btn-secondary', 'Cancelar');
    cancel.type = 'button'; cancel.onclick = function () { dialog.close(); };
    var save = node('button', 'btn btn-primary', targetId ? (isTransfer ? 'Transferir chat' : 'Confirmar asignación') : 'Devolver chat');
    save.type = 'submit'; actions.append(cancel, save); form.append(heading, recipient, label, help, error, actions);
    dialog.append(form); document.body.append(dialog);
    dialog.addEventListener('close', function () { dialog.remove(); }, { once: true });
    form.onsubmit = async function (event) {
      event.preventDefault();
      if (save.disabled || state.selectedId !== conversationId || !canTransfer(selectedConversation())) return;
      var latest = teamFor(selectedConversation());
      if (latest.branchId !== roster.branchId || (targetId && (latest.status !== 'ready' || !latest.members.some(function (m) { return m.id === targetId; })))) {
        error.textContent = 'Cambió el equipo disponible. Cierra esta ventana y elige de nuevo.';
        error.hidden = false; save.disabled = true; return;
      }
      var payload = { action: targetId ? 'assign' : 'release', conversation_id: conversationId,
        expected_version: version, private_note: note.value.trim() };
      if (member) payload.target_actor_id = member.id;
      save.disabled = true; cancel.disabled = true; error.hidden = true;
      try {
        var result = await request('POST', {}, payload, uuid());
        if (dialog.open) dialog.close();
        if (state.selectedId !== conversationId) return;
        var ownerDialog = document.querySelector('[data-owner-dialog]');
        if (ownerDialog.open && ownerDialog.dataset.thread === conversationId) ownerDialog.close();
        routingRevision++;
        window.dispatchEvent(new Event('smyl:chat-routing-changed'));
        if (result.can_operate === false || state.actor.chat_access === 'agent' && result.assigned_actor_id !== state.actor.id) forgetChat(conversationId);
        else {
          var current = selectedConversation();
          if (!current) return;
          current.assignment = result.assigned_actor_id ? { source: 'smyl', actor_id: result.assigned_actor_id, name: result.assigned_actor_name || member && member.name } : null;
          current.assignment_version = result.assignment_version;
          if (typeof result.can_operate === 'boolean') current.can_operate = result.can_operate;
          current.private_handoff_note = Object.hasOwn(result, 'private_handoff_note') ? result.private_handoff_note : payload.private_note;
          render();
        }
        var confirmation = member ? 'Chat asignado a ' + member.name + '.' : 'Chat devuelto a Sin asignar.';
        if (result.provider_sync === 'pending') confirmation += ' Pendiente de sincronizar con el canal.';
        announceHandoff(confirmation);
        await loadList(true);
      } catch (reason) {
        if (!dialog.open) return;
        error.textContent = reason.status === 409 ? 'La asignación cambió. Cierra esta ventana y elige de nuevo.' : reason.message;
        error.hidden = false; save.disabled = reason.status === 409 || reason.status === 400;
        if (save.disabled) {
          teamsByConversation.delete(conversationId);
          await loadThread(conversationId, false, null, true);
          if (state.selectedId === conversationId) renderChatOwner(selectedConversation());
        }
      } finally { cancel.disabled = false; }
    };
    dialog.addEventListener('cancel', function (event) { if (cancel.disabled) event.preventDefault(); });
    dialog.showModal(); note.focus();
  }

  function teamFor(conversation) {
    if (!canTransfer(conversation)) return { status: 'unavailable', members: [] };
    var id = conversation.id, branchId = conversation.branch?.id || '';
    var entry = teamsByConversation.get(id);
    if (!entry || entry.branchId !== branchId || (entry.status === 'ready' && Date.now() - entry.loadedAt > 120000)) {
      entry = { branchId: branchId, status: 'loading', members: [], loadedAt: 0 };
      teamsByConversation.set(id, entry); loadTeam(id, entry);
    }
    return entry;
  }

  async function loadTeam(id, entry) {
    try {
      var data = await request('GET', { action: 'team', conversation_id: id });
      if (teamsByConversation.get(id) !== entry) return;
      if (!Array.isArray(data.members)) throw new Error('Equipo no disponible');
      entry.members = data.members; entry.status = 'ready'; entry.loadedAt = Date.now();
    } catch (_) {
      if (teamsByConversation.get(id) !== entry) return;
      entry.status = 'error';
    }
    if (id === state.selectedId) renderChatOwner(selectedConversation());
    if (state.bulkSelected.has(id)) renderBulkBar();
  }

  async function loadStages() {
    if (!chatEnabled() || state.stageCatalogStatus === 'loading') return;
    var epoch = accessEpoch;
    state.stageCatalogStatus = 'loading';
    try {
      var data = await request('GET', { action: 'stages' });
      if (epoch !== accessEpoch) return;
      state.stages = Array.isArray(data.stages) ? data.stages : [];
      state.stageCatalogStatus = 'ready';
    } catch (_) {
      if (epoch !== accessEpoch) return;
      state.stageCatalogStatus = 'error';
    }
    renderList(); renderConversationSettings();
  }

  async function loadClinicalContext(conversationId) {
    if (!conversationId || !hasPermission('clinical.read')) return;
    state.clinicalLoading[conversationId] = true; renderContext();
    try {
      var loaded = await request('GET', { action: 'clinical_context', conversation_id: conversationId });
      var prior = state.clinical[conversationId] || {};
      state.clinical[conversationId] = Object.assign({}, prior, loaded, {
        provisional_contact: Boolean(prior.provisional_contact)
      });
    }
    catch (error) {
      var previous = state.clinical[conversationId] || {};
      state.clinical[conversationId] = Object.assign({}, previous, {
        linked: Boolean(previous.linked), unavailable: true,
        clinical_restricted: error && error.code === 'patient_scope_denied'
      });
    }
    finally { state.clinicalLoading[conversationId] = false; if (state.selectedId === conversationId) { renderThreadHeader(); renderContext(); } }
  }

  async function autoLinkConversationPatient(conversationId) {
    if (!conversationId || state.patientLinkChecked[conversationId] || state.patientLinking[conversationId] || !hasPermission('patients.manage')) return;
    state.patientLinking[conversationId] = true;
    if (state.selectedId === conversationId) { renderCareBar(); renderContext(); }
    try {
      var data = await request('POST', {}, { action: 'auto_patient_link', conversation_id: conversationId }, uuid());
      if (data.linked) {
        state.clinical[conversationId] = Object.assign({}, state.clinical[conversationId] || {}, {
          linked: true, patient: data.patient || null, automatic_link: true,
          provisional_contact: Boolean(data.created_patient)
        });
        state.patientLinkChecked[conversationId] = true;
      } else {
        state.clinical[conversationId] = { linked: false, auto_link_reason: data.reason || 'needs_identity' };
      }
    } catch (error) {
      state.clinical[conversationId] = Object.assign({}, state.clinical[conversationId] || {}, { linked: false, auto_link_reason: error.code === 'permission_denied' ? 'permission' : 'unavailable' });
    } finally {
      state.patientLinking[conversationId] = false;
      if (state.selectedId === conversationId) { renderCareBar(); renderThreadHeader(); renderContext(); refreshAvailabilityPatientIdentity(); }
    }
  }

  async function loadAccountContext(conversationId) {
    var ficha = state.clinical[conversationId];
    var patientId = ficha && ficha.linked && ficha.patient && ficha.patient.id;
    if (!patientId || !hasPermission('finance.read') || !window.SmylFinance || typeof window.SmylFinance.accountSummary !== 'function') return;
    state.accountContext = state.accountContext || {}; state.accountLoading = state.accountLoading || {};
    state.accountLoading[conversationId] = true; renderContext();
    try {
      var results = await Promise.all([
        window.SmylFinance.accountSummary(patientId),
        typeof window.SmylFinance.contactContext === 'function' ? window.SmylFinance.contactContext(patientId) : Promise.resolve({ pref: null, lastReminder: null })
      ]);
      state.accountContext[conversationId] = { patientId: patientId, data: results[0], pref: results[1] && results[1].pref || null, lastReminder: results[1] && results[1].lastReminder || null };
    }
    catch (_) { state.accountContext[conversationId] = { patientId: patientId, data: null, pref: null, lastReminder: null }; }
    finally { state.accountLoading[conversationId] = false; if (state.selectedId === conversationId) renderContext(); }
  }

  async function prepareConversationPatient(conversationId) {
    await autoLinkConversationPatient(conversationId);
    await Promise.all([loadClinicalContext(conversationId), loadAppointmentContext(conversationId)]);
    if (state.selectedId === conversationId) { renderCareBar(); renderThreadHeader(); renderContext(); }
    await loadAccountContext(conversationId);
  }

  async function loadAppointmentContext(conversationId) {
    if (!conversationId || !hasPermission('schedule.read')) return;
    state.appointmentContextLoading[conversationId] = true; renderContext();
    try { state.appointmentContext[conversationId] = await request('GET', { action: 'appointment_context', conversation_id: conversationId }); }
    catch (_) { state.appointmentContext[conversationId] = { linked: false, unavailable: true, items: [] }; }
    finally { state.appointmentContextLoading[conversationId] = false; if (state.selectedId === conversationId) { renderContext(); } }
  }

  function availabilityDate(value, timeZone) {
    var date = new Date(value); if (!Number.isFinite(date.getTime())) return '';
    var day = { weekday: 'short', day: 'numeric', month: 'short' }, time = { hour: '2-digit', minute: '2-digit' };
    if (timeZone) { day.timeZone = timeZone; time.timeZone = timeZone; }
    try { return date.toLocaleDateString('es-MX', day) + ' · ' + date.toLocaleTimeString('es-MX', time); }
    catch (error) { if (timeZone && error instanceof RangeError) return availabilityDate(value); throw error; }
  }

  function availabilityInputDate(date) {
    function pad(value) { return String(value).padStart(2, '0'); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function availabilityDayKey(value) {
    var date = new Date(value); if (!Number.isFinite(date.getTime())) return '';
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function availabilityDayParts(value) {
    var date = new Date(value); if (!Number.isFinite(date.getTime())) return { weekday: '', day: '', month: '' };
    return {
      weekday: date.toLocaleDateString('es-MX', { weekday: 'short' }).replace('.', ''),
      day: date.toLocaleDateString('es-MX', { day: 'numeric' }),
      month: date.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''),
    };
  }

  function availabilityTime(value) {
    var date = new Date(value); if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  function availabilityClinicName() {
    var tenant = window.tenantData || {}; var config = tenant.config || {};
    return String(config.consultorio || tenant.nombre || 'Tu clínica dental').trim();
  }

  function refreshAvailabilityHeading() {
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog) return;
    var branchSelect = dialog.querySelector('[data-availability-branch]');
    var clinicName = availabilityClinicName(); var location = clinicName;
    if (branchSelect && branchSelect.value) location = branchSelect.options[branchSelect.selectedIndex].text;
    else if (state.availabilityCatalog && (state.availabilityCatalog.branches || []).length > 1) location = clinicName + ' · todas las sucursales';
    var locationNode = dialog.querySelector('[data-availability-location]'); if (locationNode) { locationNode.textContent = location; locationNode.title = location; }
    if (branchSelect) branchSelect.title = branchSelect.options[branchSelect.selectedIndex] ? branchSelect.options[branchSelect.selectedIndex].text : 'Todas las sucursales';
    var fromInput = dialog.querySelector('[data-availability-from]'); var toInput = dialog.querySelector('[data-availability-to]');
    var period = dialog.querySelector('[data-availability-period-label]');
    if (period && fromInput && toInput && fromInput.value && toInput.value) {
      period.textContent = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(fromInput.value + 'T12:00:00')) + ' – ' + new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(new Date(toInput.value + 'T12:00:00'));
    }
  }

  function setAvailabilityCustomDates(visible) {
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog) return;
    var fields = dialog.querySelector('[data-availability-date-fields]'); var custom = dialog.querySelector('[data-availability-custom]');
    if (fields) fields.hidden = !visible;
    if (custom) custom.classList.toggle('is-active', visible);
  }

  function setAvailabilityPeriod(mode) {
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog) return;
    var from = new Date(); var to = new Date();
    if (mode === 'next') {
      var weekday = from.getDay(); var distance = weekday === 0 ? 1 : 8 - weekday;
      from.setDate(from.getDate() + distance); to = new Date(from); to.setDate(to.getDate() + 6);
    } else {
      to.setDate(to.getDate() + (Number(mode || 7) - 1));
    }
    dialog.querySelector('[data-availability-from]').value = availabilityInputDate(from);
    dialog.querySelector('[data-availability-to]').value = availabilityInputDate(to);
    setAvailabilityCustomDates(false);
    dialog.querySelectorAll('[data-availability-preset]').forEach(function (button) { button.classList.toggle('is-active', button.dataset.availabilityPreset === String(mode)); });
    refreshAvailabilityHeading();
    dialog.querySelector('[data-availability-form]').requestSubmit();
  }

  function findNextAvailability() {
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog) return;
    var fromInput = dialog.querySelector('[data-availability-from]'); var toInput = dialog.querySelector('[data-availability-to]');
    var from = new Date((toInput.value || fromInput.value) + 'T00:00:00');
    if (!Number.isFinite(from.getTime())) from = new Date(); else from.setDate(from.getDate() + 1);
    var to = new Date(from); to.setDate(to.getDate() + 30);
    fromInput.value = availabilityInputDate(from); toInput.value = availabilityInputDate(to);
    setAvailabilityCustomDates(false);
    dialog.querySelectorAll('[data-availability-preset]').forEach(function (button) { button.classList.remove('is-active'); });
    refreshAvailabilityHeading();
    dialog.querySelector('[data-availability-form]').requestSubmit();
  }

  function openAvailabilityPatientLink() {
    var dialog = document.querySelector('[data-availability-dialog]');
    if (dialog && dialog.open) dialog.close();
    // Al terminar de vincular se vuelve a abrir «Agendar cita» (ver el evento smyl:chat-patient-linked).
    state.availabilityResume = { id: state.selectedId, at: Date.now() };
    openPatientContext(state.selectedId);
  }

  // Vincular un paciente desde el chat (ventana «Vincular paciente»): actualiza el chat sin sacarte de él.
  window.addEventListener('smyl:chat-patient-linked', function (event) {
    var detail = (event && event.detail) || {}; var id = detail.conversationId;
    if (!id || !detail.patientId) return;
    var prior = state.clinical[id] || {};
    state.clinical[id] = Object.assign({}, prior, { linked: true, patient: { id: detail.patientId, name: detail.patientName || (prior.patient && prior.patient.name) || '' }, provisional_contact: Boolean(detail.created), unavailable: false });
    delete state.clinical[id].auto_link_reason;
    state.patientLinkChecked[id] = true;
    if (state.selectedId === id) { renderCareBar(); renderThreadHeader(); renderContext(); refreshAvailabilityPatientIdentity(); }
    loadClinicalContext(id);
    var resume = state.availabilityResume; state.availabilityResume = null;
    if (resume && resume.id === id && Date.now() - resume.at < 15 * 60 * 1000 && state.selectedId === id) openAvailabilityDialog();
  });

  function resetAvailabilityScope() {
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog) return;
    dialog.querySelector('[data-availability-branch]').value = '';
    dialog.querySelector('[data-availability-professional]').value = '';
    refreshAvailabilityHeading(); dialog.querySelector('[data-availability-form]').requestSubmit();
  }

  function renderAvailabilityResults() {
    var host = document.querySelector('[data-availability-results]'); if (!host) return;
    host.innerHTML = '';
    renderAvailabilityOffer();
    var dialog = document.querySelector('[data-availability-dialog]');
    if (dialog) {
      dialog.classList.toggle('is-calendar', state.availabilityMode === 'calendar');
      dialog.classList.toggle('is-empty', !state.availabilityLoading && !state.availabilitySlots.length && !(state.availabilityMode === 'calendar' && ['no_services', 'no_branches', 'no_professionals', 'query_error'].indexOf(state.availabilityEmptyReason) < 0));
      dialog.classList.toggle('is-loading', state.availabilityLoading);
      dialog.classList.toggle('has-results', !state.availabilityLoading && Boolean(state.availabilitySlots.length));
      dialog.classList.toggle('has-selection', Boolean(state.availabilitySelected.length));
      dialog.classList.toggle('has-config-issue', ['no_services', 'no_branches', 'no_professionals'].indexOf(state.availabilityEmptyReason) >= 0);
    }
    var professional = dialog && dialog.querySelector('[data-availability-professional]');
    var scope = dialog && dialog.querySelector('[data-availability-scope]');
    if (scope) scope.textContent = professional && professional.value ? professional.options[professional.selectedIndex].text : 'Disponibilidad por profesional y especialidad';
    if (state.availabilityLoading) {
      host.style.setProperty('--availability-days', 1);
      var loading = node('div', 'smyl-inbox-availability-loading'); loading.innerHTML = sk('cards', { count: 3, media: true, label: 'Consultando horarios disponibles' });
      host.append(loading); return;
    }
    if (state.availabilityMode === 'calendar' && window.SmylInboxCalendar && ['no_services', 'no_branches', 'no_professionals', 'query_error'].indexOf(state.availabilityEmptyReason) < 0) {
      host.style.setProperty('--availability-days', 1);
      window.SmylInboxCalendar.render(host, availabilityCalendarContext());
      return;
    }
    if (!state.availabilitySlots.length) {
      host.style.setProperty('--availability-days', 1);
      var empty = node('div', 'smyl-inbox-availability-empty');
      var emptyMark = node('div', 'smyl-inbox-availability-empty-mark'); emptyMark.append(node('i'), node('i'), node('i'));
      var emptyActions = node('div', 'smyl-inbox-availability-empty-actions');
      var noProfessionalsService = null; var alternativeService = null;
      if (state.availabilityEmptyReason === 'no_professionals' && state.availabilityCatalog) {
        var currentServiceId = dialog.querySelector('[data-availability-service]').value;
        noProfessionalsService = (state.availabilityCatalog.services || []).find(function (row) { return row.id === currentServiceId; }) || null;
        alternativeService = (state.availabilityCatalog.services || []).find(function (row) { return row.id !== currentServiceId && serviceHasProfessionals(state.availabilityCatalog, row.id); }) || null;
      }
      var emptyTitle = state.availabilityEmptyReason === 'no_services' ? 'Falta configurar los servicios de Agenda'
        : state.availabilityEmptyReason === 'no_branches' ? 'Falta configurar una sucursal'
        : state.availabilityEmptyReason === 'no_professionals' ? (noProfessionalsService ? '«' + noProfessionalsService.name + '» no tiene profesionales asignados' : 'Este servicio no tiene profesionales asignados')
        : state.availabilityEmptyReason === 'query_error' ? 'No pudimos consultar la Agenda'
        : state.availabilityEmptyReason === 'no_slots' ? 'No hay espacios en este periodo'
        : state.availabilityError ? 'No hay espacios en este periodo' : 'Preparando la disponibilidad';
      var emptyCopy = state.availabilityError || 'Selecciona un servicio para consultar la agenda de la clínica.';
      if (state.availabilityEmptyReason === 'no_slots') emptyCopy = 'La agenda puede estar completa, cerrada o bloqueada. Busca el siguiente espacio o amplía el equipo.';
      if (state.availabilityEmptyReason === 'no_services') emptyCopy = 'Agrega al menos un servicio con duración antes de ofrecer una cita.';
      if (state.availabilityEmptyReason === 'no_branches') emptyCopy = 'La clínica necesita una sucursal activa para calcular disponibilidad.';
      if (state.availabilityEmptyReason === 'no_professionals') emptyCopy = alternativeService
        ? 'Elige otro servicio para ver horarios, o asígnale un odontólogo en la configuración de Agenda.'
        : 'Asigna este servicio a un odontólogo o integrante del equipo para mostrar horarios.';
      if (['no_services', 'no_branches', 'no_professionals'].indexOf(state.availabilityEmptyReason) >= 0) {
        var configureAgenda = node('button', alternativeService ? 'smyl-inbox-text-action' : 'btn btn-primary btn-sm', 'Abrir configuración de Agenda'); configureAgenda.type = 'button';
        configureAgenda.onclick = function () { dialog.close(); window.ir('agenda'); };
        if (alternativeService) {
          var useOther = node('button', 'btn btn-primary btn-sm', 'Ver horarios de ' + alternativeService.name); useOther.type = 'button';
          useOther.onclick = function () {
            var serviceSelect = dialog.querySelector('[data-availability-service]'); serviceSelect.value = alternativeService.id;
            filterAvailabilityProfessionals(); dialog.querySelector('[data-availability-form]').requestSubmit();
          };
          emptyActions.append(useOther);
        }
        emptyActions.append(configureAgenda);
      } else if (state.availabilityEmptyReason === 'query_error') {
        var retry = node('button', 'btn btn-primary btn-sm', 'Volver a intentar'); retry.type = 'button'; retry.onclick = function () { dialog.querySelector('[data-availability-form]').requestSubmit(); };
        emptyActions.append(retry);
      } else {
        var nextWeek = node('button', 'btn btn-primary btn-sm', 'Ver siguientes 7 días'); nextWeek.type = 'button'; nextWeek.onclick = findNextAvailability;
        var allTeam = node('button', 'smyl-inbox-text-action', 'Cambiar filtros'); allTeam.type = 'button'; allTeam.onclick = resetAvailabilityScope;
        emptyActions.append(nextWeek, allTeam);
      }
      empty.append(emptyMark, node('strong', '', emptyTitle), node('p', '', emptyCopy), emptyActions);
      host.append(empty); return;
    }
    var groups = {};
    state.availabilitySlots.slice().sort(function (left, right) { return new Date(left.starts_at) - new Date(right.starts_at); }).forEach(function (slot) {
      var key = availabilityDayKey(slot.starts_at); if (!groups[key]) groups[key] = []; groups[key].push(slot);
    });
    host.style.setProperty('--availability-days', Math.min(Object.keys(groups).length, 4));
    Object.keys(groups).forEach(function (key) {
      var day = node('section', 'smyl-inbox-availability-day');
      var parts = availabilityDayParts(groups[key][0].starts_at);
      var dayHead = node('header'); var dayLabel = node('div');
      dayLabel.append(node('span', '', parts.weekday), node('strong', '', parts.day), node('small', '', parts.month));
      dayHead.append(dayLabel, node('em', '', groups[key].length + (groups[key].length === 1 ? ' espacio' : ' espacios'))); day.append(dayHead);
      var lane = node('div', 'smyl-inbox-availability-lane');
      groups[key].forEach(function (slot) {
      var selected = state.availabilitySelected.some(function (item) { return availabilitySlotKey(item) === availabilitySlotKey(slot); });
      var row = node('article', 'smyl-inbox-availability-slot' + (selected ? ' is-selected' : ''));
      row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-pressed', String(selected));
      row.setAttribute('aria-label', (selected ? 'Quitar' : 'Seleccionar') + ' horario de las ' + availabilityTime(slot.starts_at) + ' con ' + slot.professional_name);
      row.onclick = function () { toggleAvailabilityOption(slot); };
      row.onkeydown = function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleAvailabilityOption(slot); } };
      var time = node('div', 'smyl-inbox-availability-time');
      time.append(node('strong', '', availabilityTime(slot.starts_at)), node('small', '', slot.duration_minutes + ' min'));
      var copy = node('div', 'smyl-inbox-availability-person');
      copy.append(node('strong', '', slot.professional_name), node('span', '', slot.specialty || 'Profesional dental'), node('small', '', slot.branch_name));
      var selection = node('span', 'smyl-inbox-availability-selection-mark', selected ? 'Seleccionado' : 'Seleccionar');
      var actions = node('div', 'smyl-inbox-availability-actions'); actions.append(selection);
      if (hasPermission('schedule.manage')) {
        var requestRow = state.availabilityRequests.find(function (requestRow) {
          return requestRow.service_id === slot.service_id && requestRow.preferred_branch_id === slot.branch_id && requestRow.preferred_professional_id === slot.professional_id && new Date(requestRow.requested_start).getTime() === new Date(slot.starts_at).getTime();
        });
        if (requestRow) {
          var manage = node('button', 'btn btn-primary btn-sm', requestRow && requestRow.status === 'pending' ? 'Confirmar cita' : requestRow && requestRow.status === 'accepted' ? 'Cita confirmada' : 'Registrar elección');
          manage.type = 'button'; manage.disabled = Boolean(state.availabilityAction) || Boolean(requestRow && requestRow.status === 'accepted');
          manage.onclick = function (event) { event.stopPropagation(); if (requestRow && requestRow.status === 'pending') confirmAvailabilityRequest(requestRow); else recordAvailabilityChoice(slot); };
          actions.append(manage);
        }
      }
      row.append(time, copy, actions); lane.append(row);
      });
      day.append(lane); host.append(day);
    });
  }

  function availabilitySlotKey(slot) {
    return [slot.service_id, slot.branch_id, slot.professional_id, new Date(slot.starts_at).toISOString()].join('|');
  }

  function renderAvailabilityOffer() {
    var count = document.querySelector('[data-availability-selection]'); var prepare = document.querySelector('[data-availability-prepare]'); var footer = prepare && prepare.closest('.smyl-inbox-availability-offer');
    if (footer) footer.hidden = !state.availabilitySelected.length;
    if (count) count.textContent = state.availabilitySelected.length + (state.availabilitySelected.length === 1 ? ' horario seleccionado' : ' horarios seleccionados');
    if (prepare) prepare.disabled = !state.availabilitySelected.length || !canOperate(selectedConversation(), 'messages.respond');
    var conversationNow = selectedConversation(); var book = document.querySelector('[data-availability-book]'); var notifyWrap = document.querySelector('[data-availability-notify-wrap]');
    var canBook = state.availabilitySelected.length === 1 && hasPermission('schedule.manage') && canOperate(conversationNow, 'schedule.manage');
    var liveWindow = conversationNow ? liveWhatsappWindow(conversationNow) : null;
    if (book) { book.hidden = !canBook; book.disabled = !canBook || Boolean(state.availabilityAction); book.textContent = state.availabilityAction === 'confirm' ? 'Confirmando…' : 'Confirmar cita'; }
    if (notifyWrap) notifyWrap.hidden = !canBook || Boolean(liveWindow && !liveWindow.freeform_allowed);
    if (prepare) prepare.className = canBook ? 'btn btn-secondary' : 'btn btn-primary';
  }

  function toggleAvailabilityOption(slot) {
    var key = availabilitySlotKey(slot); var index = state.availabilitySelected.findIndex(function (item) { return availabilitySlotKey(item) === key; });
    if (index >= 0) state.availabilitySelected.splice(index, 1);
    else if (state.availabilitySelected.length >= 3) { window.alert('Puedes compartir hasta tres alternativas por mensaje.'); return; }
    else state.availabilitySelected.push(slot);
    renderAvailabilityResults();
  }

  // «Sugerir horarios»: el servidor calcula lo libre; SmylScheduleSuggest solo elige y ordena hasta tres opciones.
  var SUGGEST_DAYS = 14;
  function suggestHost() { return document.querySelector('[data-availability-suggest-results]'); }
  function suggestMessage(text, tone) {
    var host = suggestHost(); if (!host) return;
    host.innerHTML = ''; host.dataset.state = tone || 'info';
    var p = document.createElement('p'); p.className = 'smyl-suggest-note'; p.textContent = text; host.append(p);
  }
  function resetSuggestion() {
    state.suggestShown = []; state.suggestResult = null;
    var host = suggestHost(); if (host) { host.innerHTML = ''; delete host.dataset.state; }
    var run = document.querySelector('[data-availability-suggest-run]'); if (run) run.textContent = 'Sugerir 3 horarios';
  }
  function renderSuggestion(result) {
    var host = suggestHost(); if (!host) return;
    host.innerHTML = ''; host.dataset.state = result.options.length ? 'ready' : 'empty';
    var period = 'en los próximos ' + SUGGEST_DAYS + ' días';
    if (!result.options.length) { suggestMessage(window.SmylScheduleSuggest.describe(result, period), 'empty'); return; }
    var list = document.createElement('ol'); list.className = 'smyl-suggest-list';
    result.options.forEach(function (option, index) {
      var slot = option.slot, item = document.createElement('li');
      var n = document.createElement('span'); n.className = 'smyl-suggest-n'; n.textContent = String(index + 1); n.setAttribute('aria-hidden', 'true');
      var body = document.createElement('div'); var when = document.createElement('strong'); when.textContent = availabilityDate(slot.starts_at, slot.timezone);
      var who = document.createElement('small'); who.textContent = [slot.professional_name, slot.branch_name].filter(Boolean).join(' · ');
      body.append(when, who);
      var tag = document.createElement('em'); tag.textContent = option.tag;
      item.append(n, body, tag); list.append(item);
    });
    host.append(list);
    var note = window.SmylScheduleSuggest.describe(result, period);
    if (note) { var few = document.createElement('p'); few.className = 'smyl-suggest-note'; few.textContent = note; host.append(few); host.dataset.state = 'few'; }
    if (result.other_branches) { var branches = document.createElement('p'); branches.className = 'smyl-suggest-note'; branches.textContent = 'Hay espacios en otras sucursales. Elige una sucursal arriba si el paciente prefiere otra.'; host.append(branches); }
    var actions = document.createElement('div'); actions.className = 'smyl-suggest-actions';
    var use = document.createElement('button'); use.type = 'button'; use.className = 'btn btn-primary'; use.dataset.availabilitySuggestUse = ''; use.textContent = 'Pasar al mensaje';
    use.disabled = !canOperate(selectedConversation(), 'messages.respond');
    if (use.disabled) use.title = 'Tu rol no permite escribir mensajes en este chat.';
    var more = document.createElement('button'); more.type = 'button'; more.className = 'btn btn-secondary'; more.dataset.availabilitySuggestMore = ''; more.textContent = 'Otras opciones';
    more.disabled = result.reason === 'few';
    actions.append(use, more); host.append(actions);
  }
  async function runSuggestion(more) {
    if (state.suggestBusy) return;
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog || !window.SmylScheduleSuggest) return;
    var serviceId = dialog.querySelector('[data-availability-service]').value;
    if (!serviceId) { suggestMessage('Elige primero el servicio para el que quieres sugerir horarios.', 'info'); return; }
    var run = dialog.querySelector('[data-availability-suggest-run]');
    state.suggestBusy = true; if (run) { run.disabled = true; run.textContent = 'Buscando…'; }
    suggestMessage('Buscando los mejores espacios de los próximos ' + SUGGEST_DAYS + ' días…', 'loading');
    try {
      var from = new Date(Date.now() + 60 * 1000); var to = new Date(); to.setDate(to.getDate() + SUGGEST_DAYS - 1); to.setHours(23, 59, 59, 0);
      var slots = await availabilityCalendarContext().fetchDay(from, to);
      var branchId = dialog.querySelector('[data-availability-branch]').value, professionalId = dialog.querySelector('[data-availability-professional]').value;
      var result = window.SmylScheduleSuggest.suggest(slots, { now: new Date(), branchId: branchId || '', professionalId: professionalId || '', exclude: more ? state.suggestShown : [] });
      if (more && !result.options.length) { state.suggestShown = []; suggestMessage('Ya te mostré todos los espacios de este periodo. Vuelve a empezar o amplía las fechas.', 'info'); return; }
      state.suggestResult = result;
      if (!more) state.suggestShown = [];
      result.options.forEach(function (option) { state.suggestShown.push(option.key); });
      renderSuggestion(result);
    } catch (error) {
      suggestMessage('No pudimos consultar la Agenda para sugerir horarios. Intenta de nuevo.', 'error');
    } finally {
      state.suggestBusy = false; if (run) { run.disabled = false; run.textContent = state.suggestResult && state.suggestResult.options.length ? 'Sugerir de nuevo' : 'Sugerir 3 horarios'; }
    }
  }
  function useSuggestion() {
    var result = state.suggestResult; if (!result || !result.options.length) return;
    state.availabilitySelected = result.options.map(function (option) { return option.slot; });
    renderAvailabilityResults();
    prepareAvailabilityOptions();
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

  // Datos de la sucursal y del servicio para el mensaje de confirmación: los lee el módulo de Agenda (con su tenant y permisos); si algo falla se usa el mensaje corto.
  async function visitConfirmationText(firstName, slot) {
    if (!window.SmylVisitMessage || !window.SmylSchedule || typeof window.SmylSchedule.visitInfo !== 'function') return '';
    var info = await window.SmylSchedule.visitInfo(slot.branch_id, slot.service_id);
    var branch = info && info.branch, service = info && info.service;
    if (!branch && !service) return '';
    return window.SmylVisitMessage.build({ firstName: firstName, slot: slot, branch: branch || { name: slot.branch_name }, service: service || {} }).text;
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

  // Contexto que el calendario mensual (smyl-inbox-calendar.js) necesita del Inbox; el servidor sigue calculando la disponibilidad.
  function availabilityCalendarContext() {
    var dialog = document.querySelector('[data-availability-dialog]');
    return {
      params: function () { return { serviceId: dialog.querySelector('[data-availability-service]').value, branchId: dialog.querySelector('[data-availability-branch]').value, professionalId: dialog.querySelector('[data-availability-professional]').value }; },
      fetchDay: async function (from, to) {
        var params = this.params(); var all = []; var seen = {}; var cursor = from; var truncated = false;
        // El servidor devuelve como máximo 30 horarios por consulta, ordenados por hora: si llegan 30, pedimos el resto desde el último.
        for (var page = 0; page < 6; page += 1) {
          var data = await request('GET', { action: 'availability', service_id: params.serviceId, branch_id: params.branchId, professional_id: params.professionalId, from: cursor.toISOString(), to: to.toISOString(), limit: '30' });
          var rows = data.slots || []; var fresh = 0;
          rows.forEach(function (slot) { var id = availabilitySlotKey(slot); if (!seen[id]) { seen[id] = true; all.push(slot); fresh += 1; } });
          if (rows.length < 30) break;
          if (!fresh || page === 5) { truncated = true; break; }
          cursor = new Date(rows[rows.length - 1].starts_at);
        }
        all.truncated = truncated;
        return all;
      },
      isSelected: function (slot) { var key = availabilitySlotKey(slot); return state.availabilitySelected.some(function (item) { return availabilitySlotKey(item) === key; }); },
      toggle: toggleAvailabilityOption,
      time: availabilityTime,
      loadAgenda: loadAvailabilityAgendaDay,
      canReadAgenda: hasPermission('schedule.read') || hasPermission('schedule.manage'),
      openAgenda: function () { dialog.close(); if (typeof window.ir === 'function') window.ir('agenda'); },
    };
  }

  // Agenda del día en solo lectura: la lee el módulo de Agenda (con su tenant y permisos); si el rol no puede leerla, el calendario avisa sin romperse.
  async function loadAvailabilityAgendaDay(key) {
    if (!window.SmylSchedule || typeof window.SmylSchedule.dayAppointments !== 'function') throw new Error('sin agenda');
    var rows = await window.SmylSchedule.dayAppointments(key); var catalog = state.availabilityCatalog || {};
    return rows.map(function (row) {
      var service = (catalog.services || []).find(function (item) { return item.id === row.service_id; });
      var professional = (catalog.professionals || []).find(function (item) { return item.id === row.professional_id; });
      return { starts_at: row.starts_at, ends_at: row.ends_at, status: row.status, patient: row.patient, service: service && service.name, professional: professional && professional.display_name };
    });
  }

  // Cita directa desde el chat: la misma solicitud + confirmación que ya existían (el servidor vuelve a comprobar la disponibilidad).
  async function bookAvailabilitySlot(slot) {
    var conversation = selectedConversation();
    if (!slot || !conversation || !hasPermission('schedule.manage') || !canOperate(conversation, 'schedule.manage')) return;
    var dialog = document.querySelector('[data-availability-dialog]');
    if (!window.confirm('¿Confirmar la cita de ' + conversation.contact_name + ' el ' + availabilityDate(slot.starts_at) + ' con ' + slot.professional_name + '? SMYL volverá a comprobar la disponibilidad antes de guardarla.')) return;
    state.availabilityAction = 'confirm'; renderAvailabilityOffer();
    try {
      var created = await request('POST', {}, { action: 'appointment_request', conversation_id: state.selectedId, service_id: slot.service_id, branch_id: slot.branch_id, professional_id: slot.professional_id, starts_at: slot.starts_at }, uuid());
      var confirmedBooking = await request('POST', {}, { action: 'appointment_confirm', conversation_id: state.selectedId, request_id: created.request_id }, uuid());
      announceAppointmentsChanged();
      loadAppointmentContext(state.selectedId);
      if (window.SmylReminders) window.SmylReminders.dispatch(true);
      var notify = dialog && dialog.querySelector('[data-availability-notify]');
      var windowNow = liveWhatsappWindow(conversation);
      if (notify && notify.checked && (!windowNow || windowNow.freeform_allowed)) {
        var firstName = String(conversation.contact_name || '').split(' ')[0];
        var basic = 'Listo' + (firstName ? ', ' + firstName : '') + ': tu cita quedó confirmada el ' + availabilityDate(slot.starts_at) + ' con ' + slot.professional_name + ' en ' + slot.branch_name + '. ¡Te esperamos!';
        setComposerText(basic);
        // Mensaje completo (dónde, cómo llegar, qué hacer antes, calendario): reemplaza al básico solo si el redactor y los datos están listos.
        visitConfirmationText(firstName, slot).then(function (full) { if (full && selectedConversation() && selectedConversation().id === conversation.id) setComposerText(full); }).catch(function () {});
      }
      state.availabilitySelected = [];
      if (window.SmylInboxCalendar) window.SmylInboxCalendar.invalidate();
      if (dialog) dialog.close();
      announceBookedAppointment(slot.starts_at, slot.branch_id, slot.professional_id, slot.branch_name, notify && notify.checked ? 'El mensaje de confirmación quedó escrito en el chat para que lo revises y lo envíes.' : 'El chat no envió ningún mensaje automáticamente.');
      offerAppointmentNotice('confirmed', confirmedBooking && confirmedBooking.appointment_id);
    } catch (error) { window.alert(error.message || 'No se pudo confirmar la cita. Consulta nuevamente la disponibilidad.'); }
    finally { state.availabilityAction = ''; renderAvailabilityResults(); }
  }

  function syncAvailabilityMode() {
    document.querySelectorAll('[data-availability-mode]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.availabilityMode === state.availabilityMode)); });
  }

  // «¿Avisar?»: tras confirmar una cita desde el chat, ofrece la plantilla por defecto al paciente y al dentista. Nunca envía solo.
  function offerAppointmentNotice(event, appointmentId) {
    if (!appointmentId || !window.SmylAppointmentNotice || !(hasPermission('messages.respond') || hasPermission('schedule.manage'))) return;
    try { Promise.resolve(window.SmylAppointmentNotice.offerById({ event: event, appointmentId: appointmentId })).catch(function () {}); } catch (_) {}
  }

  // Desde la Ficha 360: lleva a la Agenda y abre «Cambiar horario» o «Cancelar» de esa cita; allí se ofrece el aviso al terminar.
  function manageVisit(visit, action) {
    var schedule = window.SmylSchedule;
    if (!schedule || typeof schedule.openAppointmentAction !== 'function') return;
    Promise.resolve(schedule.openAppointmentAction(visit.id, action)).catch(function (error) { window.alert((error && error.message) || 'No se pudo abrir la cita.'); });
  }

  // Dice dónde quedó la cita (día, hora, sucursal) y ofrece abrir la Agenda justo ahí: así no parece que la cita no se hizo.
  function announceBookedAppointment(startsAt, branchId, professionalId, branchName, extraText) {
    var name = branchName;
    if (!name && state.availabilityCatalog) { var found = (state.availabilityCatalog.branches || []).find(function (row) { return row.id === branchId; }); name = found && found.name; }
    var text = 'Cita confirmada: ' + availabilityDate(startsAt) + (name ? ' en ' + name : '') + '.' + (extraText ? ' ' + extraText : '');
    var schedule = window.SmylSchedule;
    var canOpen = schedule && typeof schedule.focusAppointment === 'function' && typeof window.ir === 'function' && (hasPermission('schedule.read') || hasPermission('schedule.manage'));
    if (!canOpen) { window.alert(text); return; }
    if (window.confirm(text + '\n\n¿Abrir la Agenda en ese día para verla?')) {
      Promise.resolve(schedule.focusAppointment(startsAt, branchId, professionalId)).catch(function () {}).then(function () { window.ir('agenda'); });
    }
  }

  // Avisa a la Agenda (y a quien escuche) que el chat creó una cita: así la Agenda no muestra datos viejos al abrirla.
  function announceAppointmentsChanged() {
    try { window.dispatchEvent(new CustomEvent('smyl:appointments-changed', { detail: { source: 'inbox' } })); } catch (_) {}
  }

  async function confirmAvailabilityRequest(requestRow) {
    if (!window.confirm('¿Confirmar esta cita? SMYL volverá a comprobar la disponibilidad antes de guardarla.')) return;
    state.availabilityAction = 'confirm'; renderAvailabilityResults();
    try {
      var data = await request('POST', {}, { action: 'appointment_confirm', conversation_id: state.selectedId, request_id: requestRow.id }, uuid());
      requestRow.status = 'accepted'; requestRow.appointment_id = data.appointment_id;
      announceAppointmentsChanged();
      loadAppointmentContext(state.selectedId);
      if (window.SmylReminders) window.SmylReminders.dispatch(true);
      announceBookedAppointment(requestRow.requested_start, requestRow.preferred_branch_id, requestRow.preferred_professional_id, '', 'El chat no envió ningún mensaje automáticamente; si los recordatorios están activos, el paciente recibirá uno 24 horas antes.');
      offerAppointmentNotice('confirmed', data && data.appointment_id);
    } catch (error) { window.alert(error.message || 'No se pudo confirmar la cita. Consulta nuevamente la disponibilidad.'); }
    finally { state.availabilityAction = ''; renderAvailabilityResults(); }
  }

  // Un servicio solo ofrece horarios si tiene al menos un profesional activo asignado.
  function serviceProfessionalIds(catalog, serviceId) {
    var active = new Set(((catalog && catalog.professionals) || []).map(function (row) { return row.id; }));
    return ((catalog && catalog.professional_services) || []).filter(function (row) { return row.service_id === serviceId && active.has(row.professional_id); }).map(function (row) { return row.professional_id; });
  }

  function serviceHasProfessionals(catalog, serviceId) {
    return serviceProfessionalIds(catalog, serviceId).length > 0;
  }

  function filterAvailabilityProfessionals() {
    var dialog = document.querySelector('[data-availability-dialog]'); var catalog = state.availabilityCatalog; if (!dialog || !catalog) return;
    var serviceId = dialog.querySelector('[data-availability-service]').value;
    var allowed = new Set((catalog.professional_services || []).filter(function (row) { return row.service_id === serviceId; }).map(function (row) { return row.professional_id; }));
    var select = dialog.querySelector('[data-availability-professional]'); var current = select.value;
    select.innerHTML = '<option value="">Todo el equipo</option>';
    (catalog.professionals || []).filter(function (row) { return allowed.has(row.id); }).forEach(function (row) { select.append(new Option(row.display_name + (row.specialty ? ' · ' + row.specialty : ''), row.id)); });
    if (allowed.has(current)) select.value = current;
  }

  function refreshAvailabilityPatientIdentity() {
    var dialog = document.querySelector('[data-availability-dialog]'); var conversation = selectedConversation();
    if (!dialog || !conversation) return;
    var patient = dialog.querySelector('[data-availability-patient]'); var clinical = state.clinical[conversation.id];
    var patientLinking = Boolean(state.patientLinking[conversation.id]);
    var patientLinked = Boolean(clinical && clinical.linked && clinical.patient && clinical.patient.name);
    if (patient) {
      patient.textContent = patientLinked
        ? (clinical.provisional_contact ? 'Paciente nuevo: ' : 'Paciente vinculado: ') + clinical.patient.name
        : patientLinking ? 'Identificando paciente…' : 'Identidad por confirmar';
    }
    var patientAlert = dialog.querySelector('[data-availability-patient-alert]');
    if (!patientAlert) return;
    patientAlert.hidden = patientLinked || patientLinking;
    var alertTitle = patientAlert.querySelector('strong'); var alertCopy = patientAlert.querySelector('span');
    var reason = clinical && clinical.auto_link_reason;
    var title = 'No pudimos identificar al paciente';
    var copy = 'Revisa la identidad para crear o vincular el expediente correcto.';
    if (reason === 'ambiguous') {
      title = 'Encontramos más de un expediente coincidente';
      copy = 'Confirma cuál expediente corresponde antes de registrar la cita.';
    } else if (reason === 'needs_identity') {
      title = 'Falta teléfono o correo verificable';
      copy = 'Completa un dato de contacto para vincular este chat sin duplicar pacientes.';
    } else if (reason === 'permission') {
      title = 'Tu rol no puede vincular pacientes';
      copy = 'Solicita apoyo a un administrador de la clínica para continuar.';
    } else if (reason === 'unavailable') {
      title = 'No pudimos validar al paciente ahora';
      copy = 'Puedes consultar la agenda; confirma la identidad antes de registrar la cita.';
    }
    if (alertTitle) alertTitle.textContent = title;
    if (alertCopy) alertCopy.textContent = copy;
  }

  async function openAvailabilityDialog() {
    var dialog = document.querySelector('[data-availability-dialog]'); if (!dialog) return;
    var conversation = selectedConversation(); if (!conversation) return;
    if (!hasPermission('schedule.manage') || !canOperate(conversation, 'schedule.manage')) return;
    var controls = Array.from(dialog.querySelectorAll('[data-availability-form] select,[data-availability-form] input,[data-availability-form] button'));
    refreshAvailabilityPatientIdentity();
    refreshAvailabilityHeading();
    syncAvailabilityMode();
    resetSuggestion();
    if (window.SmylInboxCalendar) window.SmylInboxCalendar.invalidate();
    if (!dialog.open) dialog.showModal();
    var dialogTitle = dialog.querySelector('h2'); if (dialogTitle) dialogTitle.focus({ preventScroll: true });
    controls.forEach(function (control) { control.disabled = true; });
    state.availabilityLoading = true; state.availabilityError = ''; state.availabilityEmptyReason = ''; state.availabilitySlots = []; state.availabilitySelected = []; renderAvailabilityResults();
    try {
      if (!state.availabilityCatalog) state.availabilityCatalog = await request('GET', { action: 'availability_catalog' });
      await loadAvailabilityRequests();
      var catalog = state.availabilityCatalog; var services = dialog.querySelector('[data-availability-service]'); var branches = dialog.querySelector('[data-availability-branch]');
      var orderedServices = (catalog.services || []).slice().sort(function (left, right) { return Number(serviceHasProfessionals(catalog, right.id)) - Number(serviceHasProfessionals(catalog, left.id)); });
      services.innerHTML = '<option value="">Selecciona un servicio</option>'; orderedServices.forEach(function (row) { services.append(new Option(row.name + ' · ' + row.duration_minutes + ' min' + (serviceHasProfessionals(catalog, row.id) ? '' : ' · sin profesional'), row.id)); });
      branches.innerHTML = '<option value="">Todas las sucursales</option>'; (catalog.branches || []).forEach(function (row) { branches.append(new Option(row.name, row.id)); });
      if ((catalog.branches || []).length === 1) branches.value = catalog.branches[0].id;
      var start = new Date(); var end = new Date(Date.now() + 6 * 86400000);
      dialog.querySelector('[data-availability-from]').value = availabilityInputDate(start); dialog.querySelector('[data-availability-to]').value = availabilityInputDate(end);
      setAvailabilityCustomDates(false);
      dialog.querySelectorAll('[data-availability-preset]').forEach(function (button) { button.classList.toggle('is-active', button.dataset.availabilityPreset === '7'); });
      if (orderedServices.length) services.value = orderedServices[0].id;
      filterAvailabilityProfessionals();
      refreshAvailabilityHeading();
      state.availabilityLoading = false;
      if (!(catalog.services || []).length) { state.availabilityEmptyReason = 'no_services'; renderAvailabilityResults(); }
      else if (!(catalog.branches || []).length) { state.availabilityEmptyReason = 'no_branches'; renderAvailabilityResults(); }
      else if (!dialog.querySelector('[data-availability-professional]').options.length || dialog.querySelector('[data-availability-professional]').options.length === 1) { state.availabilityEmptyReason = 'no_professionals'; renderAvailabilityResults(); }
      else await searchAvailability({ preventDefault: function () {}, currentTarget: dialog.querySelector('[data-availability-form]') });
    } catch (error) {
      state.availabilityLoading = false;
      state.availabilityEmptyReason = 'query_error'; state.availabilityError = error.message || 'No se pudo consultar la configuración de Agenda.'; renderAvailabilityResults();
    } finally { controls.forEach(function (control) { control.disabled = false; }); }
  }

  async function searchAvailability(event) {
    event.preventDefault(); var form = event.currentTarget; var serviceId = form.querySelector('[data-availability-service]').value;
    if (!serviceId) { window.alert('Selecciona el servicio que necesita el paciente.'); return; }
    refreshAvailabilityHeading();
    if (state.availabilityMode === 'calendar') {
      if (window.SmylInboxCalendar) window.SmylInboxCalendar.invalidate();
      state.availabilityLoading = false; state.availabilityError = ''; state.availabilityEmptyReason = serviceHasProfessionals(state.availabilityCatalog, serviceId) ? '' : 'no_professionals'; state.availabilitySlots = []; state.availabilitySelected = []; renderAvailabilityResults();
      return;
    }
    var from = new Date(form.querySelector('[data-availability-from]').value + 'T00:00:00'); var to = new Date(form.querySelector('[data-availability-to]').value + 'T23:59:59');
    state.availabilityLoading = true; state.availabilityError = ''; state.availabilityEmptyReason = ''; state.availabilitySlots = []; state.availabilitySelected = []; renderAvailabilityResults();
    try {
      var data = await request('GET', {
        action: 'availability', service_id: serviceId,
        branch_id: form.querySelector('[data-availability-branch]').value,
        professional_id: form.querySelector('[data-availability-professional]').value,
        from: from.toISOString(), to: to.toISOString(), limit: '12'
      });
      state.availabilitySlots = data.slots || [];
      if (!state.availabilitySlots.length) state.availabilityEmptyReason = 'no_slots';
    } catch (error) { state.availabilityEmptyReason = 'query_error'; state.availabilityError = error.message || 'No se pudo consultar disponibilidad.'; }
    finally { state.availabilityLoading = false; renderAvailabilityResults(); }
  }

  // Abre la primera conversación solo cuando el Inbox está a la vista: abrirla marca como leída y no debe pasar
  // en segundo plano (pipeline, o precarga mientras la persona sigue en otro módulo).
  function autoOpenFirst() {
    if (state.didAutoOpen) return;
    var page = document.getElementById('p-inbox');
    if (!page || !page.classList.contains('activa')) return;
    state.didAutoOpen = true;
    var next = visibleConversations()[0];
    if (next && window.innerWidth > 760 && state.view !== 'pipeline') openConversation(next.id);
  }

  var listResetPending = false;
  async function loadList(reset) {
    if (!chatEnabled()) return;
    if (state.loadingList) { if (reset) listResetPending = true; return; }
    var revision = routingRevision, epoch = accessEpoch;
    state.loadingList = true; state.listError = '';
    if (reset) { state.offset = 0; state.hasMore = false; }
    renderList();
    try {
      var limit = state.view === 'pipeline' && state.pipelineToday ? 100 : state.limit;
      var previousOffset = state.offset;
      var data = await request('GET', { action: 'list', filter: state.filter, channel: state.channel, q: state.search, limit: limit, offset: previousOffset });
      if (revision !== routingRevision || epoch !== accessEpoch || listResetPending) return;
      if (data.actor && data.actor.chat_access) setChatActor(data.actor);
      if (state.stageCatalogStatus === 'idle') loadStages();
      mergeConversations(data.conversations || [], reset);
      state.total = data.page && Number(data.page.total) || state.conversations.length;
      state.hasMore = Boolean(data.page && data.page.has_more);
      if (reset || !state.syncedAt) state.syncedAt = data.synced_at || new Date().toISOString();
      if (data.page && Number.isInteger(data.page.next_offset)) state.offset = data.page.next_offset;
      else if (!reset) state.offset += (data.conversations || []).length;
      else state.offset = (data.conversations || []).length;
      if (state.hasMore && state.offset <= previousOffset) throw new Error('No se pudo cargar la siguiente página.');
    } catch (error) { state.listError = error.message; }
    finally {
      state.loadingList = false; renderList(); renderContext();
      var refresh = listResetPending || revision !== routingRevision || epoch !== accessEpoch;
      listResetPending = false;
      if (refresh && chatEnabled()) loadList(true);
      else if (reset) autoOpenFirst();
    }
  }

  async function loadThread(conversationId, older, since, background, initialPage) {
    if (!conversationId || !chatEnabled()) return;
    var quiet = Boolean(since || background);
    if (!older && !quiet && state.threadController) state.threadController.abort();
    var controller = quiet ? null : new AbortController();
    if (controller) state.threadController = controller;
    state.loadingThread = !quiet; state.threadError = '';
    if (!quiet) renderMessages(Boolean(older));
    var query = { action: 'messages', conversation_id: conversationId, limit: older ? 40 : (since ? 50 : 50) };
    if (older && state.pages[conversationId] && state.pages[conversationId].before) query.before = state.pages[conversationId].before;
    if (since) query.since = since;
    try {
      var data = initialPage || await request('GET', query, null, null, 20000, controller);
      if (conversationId !== state.selectedId) return;
      var wasBottom = atThreadBottom();
      var added = mergeMessages(conversationId, data.messages || [], older);
      if (!quiet) state.pages[conversationId] = { hasMore: Boolean(data.page && data.page.has_more), before: data.page && data.page.before };
      var updated = data.conversation;
      if (updated && state.actor.chat_access === 'agent' && (!updated.assignment || updated.assignment.actor_id !== state.actor.id)) { forgetChat(conversationId); return; }
      if (updated) mergeConversations([updated], false);
      if (!quiet && controller === state.threadController) state.loadingThread = false;
      // El sondeo siempre conserva los datos recibidos. Solo aplaza el repintado destructivo
      // mientras la persona escribe, usa un menú o consulta la Ficha 360.
      var deferVisualRefresh = quiet && inboxInteractionProtected();
      if (updated && deferVisualRefresh && document.querySelector('[data-owner-dialog][open]')) {
        var current = selectedConversation();
        renderHandoffNote(current);
        renderChatOwner(current);
      }
      if (quiet && added && (!wasBottom || deferVisualRefresh)) threadNewCount += added;
      if (!deferVisualRefresh) {
        renderList(); renderThreadHeader(); renderMessages(Boolean(older));
        if (!older && (wasBottom || !quiet)) requestAnimationFrame(function () { if (state.selectedId === conversationId) scrollThreadBottom(); });
        else updateThreadJump(!atThreadBottom());
      } else if (added) {
        threadPaintDeferred = true; updateThreadJump(!wasBottom);
      }
    } catch (error) {
      if (controller && controller !== state.threadController) return;
      if (conversationId === state.selectedId && !quiet) { state.threadError = error.message; renderMessages(Boolean(older)); }
    } finally {
      if (controller && controller === state.threadController) {
        state.loadingThread = false;
        state.threadController = null;
        if (conversationId === state.selectedId) renderMessages(Boolean(older));
      }
    }
  }

  async function openConversation(id) {
    closeChatMedia();
    if (id !== state.selectedId) {
      closeThreadOptions(false);
      renderHandoffNote(null);
      var previousLibrary = document.querySelector('[data-shared-dialog][open]');
      if (previousLibrary) previousLibrary.close();
    }
    var sequence = ++openSequence;
    if (!chatEnabled() && !await refreshAccess()) return;
    if (sequence !== openSequence) return;
    var page = document.getElementById('p-inbox'), fromBoard = state.view === 'pipeline';
    if (fromBoard) {
      state.contextOpen = false; state.contextReturnFocus = null;
      syncContextAccessibility(); closeComposerTools(false); closeBranchMenu(false);
      page.querySelector('[data-pipeline-status]').textContent = '';
      setPipelineChat(id, true);
      page.querySelector('[data-pipeline-cancel]').focus({preventScroll:true});
    }
    var lookup, epoch = accessEpoch, revision = threadEpoch.get(id);
    try {
      lookup = await request('GET', { action:'messages', conversation_id:id, limit:50 });
      if (lookup.conversation?.id !== id) throw new Error('No se pudo abrir esta conversación.');
    }
    catch (error) {
      var message = error.code === 'conversation_scope_denied' ? 'Ya no tienes acceso a esta conversación.' : error.message;
      if (fromBoard && state.pipelineChatId === id && sequence === openSequence) {
        closePipelineChat(true);
        page.querySelector('[data-pipeline-status]').textContent = message;
      } else if (sequence === openSequence) {
        renderHandoffNote(selectedConversation());
        announceHandoff(message);
      }
      return;
    }
    if (sequence !== openSequence || !chatEnabled() || epoch !== accessEpoch || revision !== threadEpoch.get(id)) return;
    if (state.actor.chat_access === 'agent' && (!lookup.conversation.assignment || lookup.conversation.assignment.actor_id !== state.actor.id)) { forgetChat(id); return; }
    mergeConversations([lookup.conversation], false);
    if (state.recorder && state.recorder.state === 'recording') stopVoiceRecording(true);
    closeComposerTools(); closeBranchMenu(false);
    var previousId = state.selectedId; var previousInput = document.querySelector('[name="message"]');
    if (previousId && previousInput && previousInput.value.trim()) await persistEncryptedDraft(previousId, previousInput.value.trim()).catch(function () {});
    if (sequence !== openSequence || epoch !== accessEpoch || revision !== threadEpoch.get(id)) return;
    state.selectedId = id; state.contextOpen = dockedContextPreferred(); state.contextReturnFocus = null; state.threadError = '';
    if (previousId !== id) resetThreadJump();
    if (previousId !== id) { state.replyTo = null; state.attachment = null; }
    if (fromBoard) setPipelineChat(id, false);
    page.classList.add('show-thread');
    render();
    if (fromBoard) page.querySelector('[data-inbox-back]').focus({preventScroll:true});
    if (previousId !== id) await restoreEncryptedDraft(id);
    if (sequence !== openSequence || state.selectedId !== id) return;
    var patientReady = prepareConversationPatient(id); loadScheduled(id); await loadThread(id, false, null, false, lookup); await patientReady;
    var conversation = selectedConversation();
    if (sequence === openSequence && page.classList.contains('activa') && conversation && conversation.id === id && conversation.unread_count) {
      try {
        await request('POST', {}, { action: 'read', conversation_id: id }, uuid());
        conversation.unread_count = 0; renderList(); refreshUnreadBadge();
      } catch (_) {}
    }
  }

  function applyConversationResult(conversation, data) {
    if (Object.hasOwn(data, 'paused')) conversation.paused = Boolean(data.paused);
    if (Object.hasOwn(data, 'needs_human')) conversation.needs_human = Boolean(data.needs_human);
    if (Object.hasOwn(data, 'unread_count')) conversation.unread_count = Number(data.unread_count) || 0;
    if (Object.prototype.hasOwnProperty.call(data, 'pinned')) conversation.pinned = Boolean(data.pinned);
    if (data.pipeline) applyPipelineUpdate(conversation, data);
    else if (Object.hasOwn(data, 'stage_id')) conversation.stage_id = data.stage_id || null;
    if (typeof data.can_operate === 'boolean') conversation.can_operate = data.can_operate;
  }

  function applyPipelineUpdate(conversation, update) {
    var prior = conversation.pipeline || {}, next = update.pipeline;
    if (!next || (next.revision ?? 0) < (prior.revision ?? 0)) return;
    var provider = Object.hasOwn(next, 'provider_stage_id') ? next.provider_stage_id : prior.provider_stage_id;
    var stage = next.source === 'lana' ? next.stage_id || provider || null : next.stage_id || null;
    conversation.pipeline = Object.assign({}, next, { stage_id: stage, provider_stage_id: provider || null });
    conversation.stage_id = stage;
    if (Object.hasOwn(update, 'appointment')) conversation.appointment = update.appointment;
  }

  function applyPipelineUpdates(updates) {
    if (!updates?.length) return;
    var loaded = new Map(state.conversations.map(function (item) { return [item.id, item]; }));
    updates.forEach(function (update) {
      var conversation = loaded.get(update.id);
      if (conversation) applyPipelineUpdate(conversation, update);
    });
  }

  async function syncAdditionalPipelineCards(ids, since, epoch) {
    var loadedIds = new Set(ids);
    pendingPipelineSnapshots.forEach(function (id) { if (!loadedIds.has(id)) pendingPipelineSnapshots.delete(id); });
    var jobs = [];
    function enqueue(group, cursor) {
      for (var start = 0; start < group.length; start += 100) {
        jobs.push({ ids:group.slice(start, start + 100), cursor:cursor });
      }
    }
    // Recuperar los IDs que fallaron aunque ya pasaron a la primera página.
    enqueue(Array.from(pendingPipelineSnapshots), null);
    enqueue(ids.slice(100).filter(function (id) { return !pendingPipelineSnapshots.has(id); }), since);
    var changed = false, removed = false;
    async function checkPage(job) {
      var query = { action:'pipeline_updates', visible_ids:job.ids.join(',') };
      if (job.cursor) query.since = job.cursor;
      try {
        var data = await request('GET', query, null, null, 15000);
        if (epoch !== accessEpoch) return;
        if (!Array.isArray(data.pipeline_updates) || !Array.isArray(data.removed_conversation_ids)) throw new Error('Respuesta de etapas incompleta');
        applyPipelineUpdates(data.pipeline_updates);
        data.removed_conversation_ids.forEach(forgetChat);
        if (data.removed_conversation_ids.length) removed = true;
        if (data.pipeline_updates.length || data.removed_conversation_ids.length) changed = true;
        job.ids.forEach(function (id) { pendingPipelineSnapshots.delete(id); });
      } catch (_) {
        if (epoch === accessEpoch) job.ids.forEach(function (id) { pendingPipelineSnapshots.add(id); });
      }
    }
    for (var i = 0; i < jobs.length && epoch === accessEpoch; i += 2) {
      await Promise.all(jobs.slice(i, i + 2).map(checkPage));
    }
    if (epoch !== accessEpoch) return;
    if (removed) window.dispatchEvent(new Event('smyl:chat-routing-changed'));
    if (changed) { renderList(); renderThreadHeader(); }
  }

  async function applyBulkAction(action, targetId) {
    if (state.bulkRunning || !state.bulkSelected.size) return;
    var ids = Array.from(state.bulkSelected); state.bulkRunning = true; renderList();
    var failed = 0;
    for (var index = 0; index < ids.length; index += 1) {
      var conversation = state.conversations.find(function (item) { return item.id === ids[index]; });
      if (!conversation) continue;
      try {
        if (action === 'stage') await saveConversationStage(conversation, targetId);
        else {
          var payload = { action: action, conversation_id: conversation.id, target_actor_id: targetId, expected_version: conversation.assignment_version };
          var data = await request('POST', {}, payload, uuid()); applyConversationResult(conversation, data);
        }
      } catch (_) { failed += 1; }
    }
    if (action === 'assign') { window.dispatchEvent(new Event('smyl:chat-routing-changed')); await loadList(true); }
    state.bulkRunning = false;
    if (!failed) { state.bulkSelected.clear(); state.bulkMode = false; }
    render();
    if (failed) window.alert((ids.length - failed) + ' conversaciones actualizadas; ' + failed + ' no pudieron modificarse por permisos o estado.');
  }

  async function mutateConversation(action) {
    var conversation = selectedConversation();
    if (!conversation) return;
    try {
      var payload = { action: action, conversation_id: conversation.id };
      var data = await request('POST', {}, payload, uuid());
      applyConversationResult(conversation, data);
      render();
    } catch (error) { window.alert(error.message || 'No se pudo actualizar la conversación.'); }
  }

  function emojiSearchKey(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  function loadEmojiCatalog() {
    if (!emojiCatalogPromise) {
      var url = new URL('assets/emoji/catalog-es-v1.json', inboxScriptUrl || document.baseURI);
      emojiCatalogPromise = fetch(url.href, { credentials: 'omit' }).then(function (response) {
        if (!response.ok) throw new Error('emoji');
        return response.json();
      }).then(function (catalog) {
        return { groups: catalog.groups, items: catalog.items.map(function (entry) {
          return { glyph: entry[0], group: String(entry[1]), name: entry[2],
            search: emojiSearchKey(entry[0] + ' ' + entry[2] + ' ' + entry[3]) };
        }) };
      }).catch(function (error) { emojiCatalogPromise = null; throw error; });
    }
    return emojiCatalogPromise;
  }

  async function openEmojiDialog() {
    var dialog = document.querySelector('[data-emoji-dialog]');
    var wrap = dialog && dialog.querySelector('[data-emoji-content]');
    var input = document.querySelector('[data-inbox-composer] [name="message"]');
    if (!wrap || !input || input.disabled || !state.selectedId) return;
    var conversationId = state.selectedId;
    var controls = node('div', 'smyl-emoji-controls');
    var search = node('input'); search.type = 'search'; search.placeholder = 'Buscar emoji';
    search.setAttribute('aria-label', 'Buscar emoji'); search.autocomplete = 'off';
    var category = node('select'); category.setAttribute('aria-label', 'Categoría de emojis');
    category.add(new Option('Todas las categorías', 'all'));
    controls.append(search, category);
    var grid = node('div', 'smyl-emoji-grid'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Emojis');
    var footer = node('div', 'smyl-emoji-footer');
    var status = node('span', 'smyl-emoji-status', 'Cargando emojis…'); status.setAttribute('role', 'status');
    var previous = node('button', '', 'Anterior'); previous.type = 'button'; previous.hidden = true;
    var next = node('button', '', 'Siguiente'); next.type = 'button'; next.hidden = true;
    footer.append(status, previous, next);
    wrap.replaceChildren(controls, grid, footer);
    if (!dialog.open) dialog.showModal();
    search.focus();
    var catalog;
    try { catalog = await loadEmojiCatalog(); }
    catch (_) {
      if (!wrap.contains(controls)) return;
      status.textContent = 'No se pudo cargar el catálogo.';
      next.textContent = 'Reintentar'; next.hidden = false; next.onclick = openEmojiDialog;
      return;
    }
    if (!dialog.open || !wrap.contains(controls)) return;
    if (recentEmoji.length) {
      category.add(new Option('Recientes', 'recent'));
      if (!search.value) category.value = 'recent';
    }
    catalog.groups.forEach(function (name, index) { category.add(new Option(name, String(index))); });
    var page = 0; var perPage = 40;

    function insert(item) {
      if (state.selectedId !== conversationId || input.disabled) { dialog.close(); return; }
      if (input.value.length - (input.selectionEnd - input.selectionStart) + item.glyph.length > input.maxLength) {
        status.textContent = 'Se alcanzó el límite de caracteres del mensaje.'; return;
      }
      input.setRangeText(item.glyph, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      recentEmoji = [item.glyph].concat(recentEmoji.filter(function (glyph) { return glyph !== item.glyph; })).slice(0, 24);
      dialog.close(); input.focus();
    }
    function renderPage() {
      var words = emojiSearchKey(search.value).split(/\s+/).filter(Boolean);
      var items = catalog.items.filter(function (item) {
        var inGroup = category.value === 'all' || category.value === item.group ||
          (category.value === 'recent' && recentEmoji.includes(item.glyph));
        return inGroup && words.every(function (word) { return item.search.includes(word); });
      });
      if (category.value === 'recent') items.sort(function (a, b) { return recentEmoji.indexOf(a.glyph) - recentEmoji.indexOf(b.glyph); });
      var start = page * perPage;
      var end = Math.min(start + perPage, items.length);
      var fragment = document.createDocumentFragment();
      items.slice(start, end).forEach(function (item) {
        var button = node('button', 'smyl-emoji-item', item.glyph);
        button.type = 'button'; button.title = item.name; button.setAttribute('aria-label', 'Insertar ' + item.name);
        button.onclick = function () { insert(item); }; fragment.append(button);
      });
      grid.replaceChildren(fragment); grid.scrollTop = 0;
      status.textContent = items.length ? (start + 1) + '–' + end + ' de ' + items.length : 'No se encontraron emojis.';
      previous.hidden = next.hidden = items.length <= perPage;
      previous.disabled = page === 0; next.disabled = end >= items.length;
    }
    function resetPage() { page = 0; renderPage(); }
    search.oninput = function () {
      if (search.value.trim() && category.value === 'recent') category.value = 'all';
      resetPage();
    };
    category.onchange = resetPage;
    previous.onclick = function () { page--; renderPage(); };
    next.onclick = function () { page++; renderPage(); };
    renderPage();
  }

  function recordingMimeType() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
    return ['audio/ogg;codecs=opus', 'audio/mp4', 'audio/aac', 'audio/mpeg'].find(function (type) { return window.MediaRecorder.isTypeSupported(type); }) || '';
  }

  function renderRecordingButton() {
    var button = document.querySelector('[data-compose-record]'); if (!button) return;
    var active = Boolean(state.recorder && state.recorder.state === 'recording'); button.setAttribute('aria-pressed', active ? 'true' : 'false');
    var label = button.querySelector('strong'); var detail = button.querySelector('small');
    if (label) label.textContent = active ? 'Detener grabación' : 'Nota de voz';
    if (detail) detail.textContent = active ? Math.max(1, Math.floor((Date.now() - state.recorderStartedAt) / 1000)) + ' s grabados' : 'Grabar audio';
    button.setAttribute('aria-label', active ? 'Detener grabación de voz' : 'Grabar nota de voz');
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
    var sequence = openSequence, epoch = accessEpoch;
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (sequence !== openSequence || epoch !== accessEpoch || state.selectedId !== conversation.id || state.recorder) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      state.recorderStream = stream; state.recorderChunks = []; state.recordingCancelled = false;
      var recorder = new MediaRecorder(stream, { mimeType: mime }); state.recorder = recorder;
      recorder.ondataavailable = function (event) { if (event.data && event.data.size) state.recorderChunks.push(event.data); };
      recorder.onstop = function () {
        var cancelled = state.recordingCancelled; var chunks = state.recorderChunks.slice(); state.recorderChunks = []; releaseRecorder();
        if (cancelled || !chunks.length || sequence !== openSequence || state.selectedId !== conversation.id) return;
        var type = mime.split(';')[0]; var extension = type === 'audio/ogg' ? 'ogg' : type === 'audio/mp4' ? 'm4a' : type === 'audio/aac' ? 'aac' : 'mp3';
        var file = new File(chunks, 'nota-de-voz-' + Date.now() + '.' + extension, { type: type });
        chooseAttachment(file);
      };
      recorder.start(250); state.recorderStartedAt = Date.now(); renderRecordingButton(); state.recorderTimer = setInterval(renderRecordingButton, 1000);
    } catch (error) {
      if (sequence !== openSequence || epoch !== accessEpoch) return;
      releaseRecorder(); window.alert(error && error.name === 'NotAllowedError' ? 'Permite el acceso al micrófono para grabar una nota de voz.' : 'No se pudo iniciar la grabación de audio.');
    }
  }

  function toggleVoiceRecording() {
    if (state.recorder && state.recorder.state === 'recording') stopVoiceRecording(false); else startVoiceRecording();
  }

  function refreshSentConversation(conversationId, content, sentAt) {
    var conversation = state.conversations.find(function (item) { return item.id === conversationId; });
    if (conversation) {
      conversation.paused = true;
      if (!conversation.last_message_at || Date.parse(sentAt) >= Date.parse(conversation.last_message_at)) {
        conversation.last_message = content; conversation.last_message_at = sentAt;
      }
    }
    if (state.selectedId !== conversationId) { renderList(); return; }
    var follow = !window.matchMedia('(max-width: 760px)').matches || atThreadBottom();
    render();
    if (follow) requestAnimationFrame(function () { if (state.selectedId === conversationId) scrollThreadBottom(); });
  }

  async function submitMessage(content, key, pending, extra) {
    var conversationId = state.selectedId;
    var epoch = accessEpoch, revision = threadEpoch.get(conversationId);
    try {
      var payload = Object.assign({ action: 'send', type: 'text', conversation_id: conversationId, content: content }, extra || {});
      var data = await request('POST', {}, payload, key, 35000);
      if (epoch !== accessEpoch || revision !== threadEpoch.get(conversationId)) return;
      pending.reconciled = true;
      pending.onMediaConfirmed?.();
      if (typeof pending.onSent === 'function') { try { pending.onSent(); } catch (_) {} }
      mergeMessages(conversationId, data.message ? [data.message] : [], false);
      refreshSentConversation(conversationId, content, data.message?.created_at || pending.created_at);
    } catch (error) {
      pending.status = error.code === 'send_unknown' || error.code === 'send_in_progress' ? 'unknown' : 'failed';
      pending.error = error.message;
      if (state.selectedId === conversationId) renderMessages(false);
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
    var mediaFile = state.attachment;
    if (mediaFile && (!suggestedAttachments.has(mediaFile) || !content)) { sendAttachment(mediaFile); return; }
    if (!content) return;
    var key = uuid();
    var reply = state.replyTo;
    var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: content, reply_to: reply ? { id: reply.id, preview: replyPreview(reply), type: reply.media_type || 'text' } : null, created_at: new Date().toISOString(), status: 'sending' };
    if (mediaFile) {
      var sendEpoch = accessEpoch;
      state.attachment = null;
      pending.onMediaConfirmed = function () {
        pending.onMediaConfirmed = null;
        if (sendEpoch === accessEpoch) sendAttachment(mediaFile, conversation);
      };
    }
    state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending);
    input.value = ''; fitComposerText(input); clearEncryptedDraft(conversation.id); state.replyTo = null; renderComposerContext(); renderMessages(false); requestAnimationFrame(scrollThreadBottom);
    submitMessage(content, key, pending, reply ? { reply_to_message_id: reply.id } : null);
  }

  function attachmentKind(file) {
    return String(file.type || '').startsWith('image/') ? 'image' : String(file.type || '').startsWith('audio/') ? 'audio' : file.type === 'video/mp4' ? 'video' : 'document';
  }

  function attachmentUploadKind(file) {
    const kind = attachmentKind(file);
    return kind === 'audio' && suggestedAttachments.has(file) ? 'audio_clip' : kind;
  }

  function chooseAttachment(file) {
    if (!file) return;
    var kind = attachmentKind(file); var max = kind === 'audio' || kind === 'video' ? 16 : kind === 'image' ? 10 : 25;
    if (file.size > max * 1024 * 1024) { window.alert('El archivo supera el límite de ' + max + ' MB.'); return; }
    var conversation = selectedConversation();
    if (kind === 'audio' && conversation && conversation.channel !== 'whatsapp' && !suggestedAttachments.has(file)) { window.alert('Las notas de voz solo están disponibles en WhatsApp.'); return; }
    if (kind === 'document' && conversation && conversation.channel === 'instagram') { window.alert('Instagram no permite enviar documentos.'); return; }
    state.attachment = file; state.replyTo = null; renderComposerContext(); return true;
  }

  async function sendAttachment(file, destination) {
    var conversation = destination || selectedConversation(); if (!conversation || !file) return;
    var waWindow = liveWhatsappWindow(conversation); if (waWindow && !waWindow.freeform_allowed) { window.alert('La ventana de WhatsApp venció. Usa una plantilla aprobada.'); return; }
    var kind = attachmentKind(file); var key = uuid(); var previewUrl = ['image','audio','video'].includes(kind) ? URL.createObjectURL(file) : null;
    var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: kind === 'video' ? 'Video' : kind === 'image' ? '📷 Imagen' : kind === 'audio' ? (suggestedAttachments.has(file) ? 'Audio' : '🎤 Nota de voz') : '📄 ' + file.name, media_type: kind, media_url: previewUrl, created_at: new Date().toISOString(), status: 'sending', file: file };
    state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending);
    if (!destination) state.attachment = null;
    if (state.selectedId === conversation.id) { renderComposerContext(); renderMessages(false); requestAnimationFrame(scrollThreadBottom); }
    try {
      var form = new FormData(); form.append('conversation_id', conversation.id); form.append('kind', attachmentUploadKind(file)); form.append('file', file, file.name);
      var data = await requestForm(form, key, 60000); pending.reconciled = true;
      mergeMessages(conversation.id, data.message ? [data.message] : [], false);
      refreshSentConversation(conversation.id, pending.content, data.message?.created_at || pending.created_at);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    } catch (error) { pending.status = error.code === 'send_unknown' || error.code === 'send_in_progress' ? 'unknown' : 'failed'; pending.error = error.message; if (state.selectedId === conversation.id) renderMessages(false); }
  }

  async function sendLocation() {
    var conversation = selectedConversation(); if (!conversation) return;
    var waWindow = liveWhatsappWindow(conversation); if (waWindow && !waWindow.freeform_allowed) { window.alert('La ventana de WhatsApp venció. Usa una plantilla aprobada.'); return; }
    if (!navigator.geolocation) { window.alert('Este dispositivo no puede obtener la ubicación.'); return; }
    if (!window.confirm('¿Enviar la ubicación actual de este dispositivo?')) return;
    navigator.geolocation.getCurrentPosition(async function (position) {
      if (state.selectedId !== conversation.id) {
        window.alert('Cambiaste de conversación. La ubicación no se envió.');
        return;
      }
      var key = uuid();
      var latitude = position.coords.latitude; var longitude = position.coords.longitude;
      var isWhatsapp = conversation.channel === 'whatsapp';
      var content = isWhatsapp ? '📍 Ubicación actual' : '📍 Ubicación actual\nhttps://www.google.com/maps?q=' + encodeURIComponent(latitude + ',' + longitude);
      var pending = { id: 'pending:' + key, key: key, client_request_id: key, role: 'assistant', author_type: 'team', content: content, media_type: isWhatsapp ? 'location' : 'text', location: { latitude: latitude, longitude: longitude }, created_at: new Date().toISOString(), status: 'sending' };
      state.pending[conversation.id] = (state.pending[conversation.id] || []).concat(pending); renderMessages(false);
      try {
        if (isWhatsapp) {
          var data = await request('POST', {}, { action: 'send', type: 'location', conversation_id: conversation.id, latitude: latitude, longitude: longitude, name: 'Ubicación actual' }, key, 35000);
          pending.reconciled = true; mergeMessages(conversation.id, data.message ? [data.message] : [], false); render(); requestAnimationFrame(scrollThreadBottom);
        } else {
          submitMessage(content, key, pending);
        }
      } catch (error) { pending.status = error.code === 'send_unknown' ? 'unknown' : 'failed'; pending.error = error.message; renderMessages(false); }
    }, function () { window.alert('No se pudo obtener la ubicación. Revisa el permiso del navegador.'); }, { enableHighAccuracy: true, timeout: 12000 });
  }

  function retryPending(item) {
    item.status = 'sending'; renderMessages(false);
    if (item.file) {
      var conversationId = state.selectedId; var kind = attachmentUploadKind(item.file); var form = new FormData();
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

  function inboxInteractionProtected() {
    var page = document.getElementById('p-inbox'); if (!page) return false;
    if (messageMenu) return true;
    if (document.querySelector('[data-smyl-media-dialog][open]')) return true;
    if (page.querySelector('dialog[open]')) return true;
    if (state.contextOpen || state.filterPanelOpen) return true;
    var composeTools = page.querySelector('[data-compose-tools]');
    if (composeTools && !composeTools.hidden) return true;
    if (state.recorder && state.recorder.state === 'recording') return true;
    var active = document.activeElement;
    if (active?.matches('[data-list-stage]') && (!CSS.supports('selector(select:open)') || active.matches(':open'))) return true;
    return Boolean(active && page.contains(active) && active.closest('[data-inbox-composer],[data-inbox-context-panel],[data-thread-owner]'));
  }

  async function sync() {
    if (!chatEnabled() || state.polling || !state.syncedAt || !document.getElementById('p-inbox').classList.contains('activa') || document.visibilityState !== 'visible') return;
    state.polling = true;
    var live = document.querySelector('[data-inbox-live]');
    try {
      var selected = selectedConversation();
      var appointmentBefore = selected && JSON.stringify(selected.appointment || null);
      var previousUnread = state.conversations.reduce(function (total, item) { return total + (Number(item.unread_count) || 0); }, 0);
      var epoch = accessEpoch, since = state.syncedAt;
      var ids = Array.from(new Set([state.selectedId].concat(state.conversations.map(function (item) { return item.id; })))).filter(Boolean);
      var data = await request('GET', { action: 'sync', since: since, visible_ids: ids.slice(0,100).join(',') }, null, null, 15000);
      // Sin cambios el sondeo se espacia (5 s → 30 s) para no saturar el servidor con muchas sesiones abiertas; cualquier cambio o interacción lo devuelve a 5 s.
      state.syncDelay = ((data.conversations || []).length || data.pipeline_changed || (data.removed_conversation_ids || []).length) ? 5000 : Math.min(30000, Math.round((state.syncDelay || 5000) * 1.5));
      var deferVisualRefresh = inboxInteractionProtected();
      mergeConversations(data.conversations || [], false);
      if (data.pipeline_changed) applyPipelineUpdates(data.pipeline_updates);
      (data.removed_conversation_ids || []).forEach(forgetChat);
      var current = selectedConversation();
      if (current && selected && current.id === selected.id && appointmentBefore !== JSON.stringify(current.appointment || null) && hasPermission('schedule.read')) {
        loadAppointmentContext(current.id);
        var patient = state.clinical[current.id]?.patient;
        if (patient && state.contextOpen) loadPatientVisits(current.id, patient.id, true);
      }
      // Si el lote quedó truncado durante una interacción, conservamos el cursor anterior para
      // pedir nuevamente el tramo completo cuando ya sea seguro repintar la interfaz.
      if (!(data.truncated && deferVisualRefresh)) state.syncedAt = data.synced_at || new Date().toISOString();
      // Alguien cambió la sucursal de una conversación: se recarga la lista para que cada sede vea solo lo suyo.
      if (data.branch_changed || (data.removed_conversation_ids || []).length) window.dispatchEvent(new Event('smyl:chat-routing-changed'));
      if (data.branch_changed) { state.syncDelay = 5000; await loadList(true); }
      if (!deferVisualRefresh) { renderList(); renderThreadHeader(); }
      else if (state.view === 'pipeline' && (data.pipeline_changed || data.conversations?.length)) renderList();
      if (data.truncated && !deferVisualRefresh) await loadList(true);
      var latest = latestMessageTime();
      var threadVisible = state.view !== 'pipeline' || (!state.pipelineOpening && state.pipelineChatId === state.selectedId);
      if (threadVisible && state.selectedId && latest) await loadThread(state.selectedId, false, latest);
      else if (threadVisible && state.selectedId && (data.conversations || []).some(function (item) { return item.id === state.selectedId; })) await loadThread(state.selectedId, false, null, true);
      if ((data.received_conversation_ids || []).length) {
        announceHandoff('Te asignaron ' + (data.received_conversation_ids.length === 1 ? 'una conversación.' : data.received_conversation_ids.length + ' conversaciones.'), data.received_conversation_ids[0]);
      }
      var currentUnread = state.conversations.reduce(function (total, item) { return total + (Number(item.unread_count) || 0); }, 0);
      if (currentUnread > previousUnread) playInboxNotice();
      if (ids.length > 100 || pendingPipelineSnapshots.size) await syncAdditionalPipelineCards(ids, since, epoch);
      if (epoch !== accessEpoch) return;
      if (live) {
        live.hidden = !pendingPipelineSnapshots.size;
        live.querySelector('span').textContent = pendingPipelineSnapshots.size ? 'Algunas tarjetas están pendientes de actualizar' : '';
      }
    } catch (_) {
      state.syncDelay = Math.min(30000, (state.syncDelay || 5000) * 2);
      if (live) { live.hidden = false; live.querySelector('span').textContent = 'Reconectando…'; }
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

  function quickNotice(session, message) {
    var status = session.dialog.querySelector('[data-quick-status]');
    status.textContent = message; status.hidden = !message;
  }

  function quickShortcutAtCaret(input) {
    if (!input || input.selectionStart !== input.selectionEnd) return null;
    var caret = input.selectionStart; var before = input.value.slice(0, caret);
    var match = before.match(/(^|\s)\/([a-z0-9_-]{1,40})$/i);
    if (!match) return null;
    return { start: caret - match[2].length - 1, end: caret, query: match[2] };
  }

  function insertQuickReply(session, text) {
    var input = document.querySelector('[data-inbox-composer] [name="message"]');
    if (state.quickSession !== session || state.selectedId !== session.conversation || !input || input.disabled) {
      quickNotice(session, 'Vuelve a abrir la conversación para insertar el mensaje.'); return;
    }
    var start = input.selectionStart; var end = input.selectionEnd;
    if (input.value === session.inputValue && Number.isInteger(session.insertStart) && Number.isInteger(session.insertEnd)) {
      start = session.insertStart; end = session.insertEnd;
    }
    if (input.value.length - (end - start) + text.length > input.maxLength) {
      quickNotice(session, 'Acorta el texto. El mensaje admite hasta 4000 caracteres.'); return;
    }
    session.dialog.close();
    input.setRangeText(text, start, end, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
  }

  function renderQuickReplies(session) {
    var dialog = session.dialog;
    var list = dialog.querySelector('[data-quick-list]'); list.replaceChildren();
    var search = normalizeText(dialog.querySelector('[data-quick-search]').value.trim());
    var replies = session.team.concat(session.legacy).filter(function (item) {
      return item && typeof item.text === 'string' && typeof item.shortcut === 'string' &&
        normalizeText('/' + item.shortcut + ' ' + item.text).includes(search);
    });
    var summary = dialog.querySelector('[data-quick-summary]');
    if (summary) summary.textContent = session.loading.size ? 'Actualizando biblioteca…' : replies.length + (replies.length === 1 ? ' respuesta disponible' : ' respuestas disponibles');
    replies.forEach(function (item) {
      var row = node('div', 'smyl-quick-item');
      var insert = node('button', 'smyl-inbox-quick-row'); insert.type = 'button';
      insert.setAttribute('aria-label', 'Usar /' + item.shortcut + ': ' + item.text);
      var copy = node('span', 'smyl-quick-row-copy'); copy.append(node('strong', '', '/' + item.shortcut), node('span', '', item.text));
      insert.append(copy, node('span', 'smyl-quick-use-label', 'Usar'));
      insert.onclick = function () { insertQuickReply(session, item.text); };
      row.append(insert);
      if (session.canManage && session.team.includes(item)) {
        var edit = node('button', 'smyl-quick-edit', 'Editar'); edit.type = 'button'; edit.dataset.quickEdit = '';
        edit.setAttribute('aria-label', 'Editar /' + item.shortcut);
        edit.onclick = function () { showQuickEditor(session, item); };
        row.append(edit);
      }
      list.append(row);
    });
    if (session.errors.size) {
      var retry = node('button', 'smyl-quick-retry', 'Reintentar'); retry.type = 'button';
      retry.onclick = function () { Array.from(session.errors).forEach(function (source) { loadQuickSource(session, source); }); };
      list.append(node('p', 'smyl-quick-empty', 'No se pudo cargar toda la biblioteca.'), retry);
    } else if (!replies.length) {
      var empty = session.loading.size ? 'Cargando respuestas…' : search ? 'No hay coincidencias.' : 'Aún no hay respuestas guardadas.';
      list.append(session.loading.size ? skNode('list', { rows: 4, plain: true, label: 'Cargando respuestas' }) : node('p', 'smyl-quick-empty', empty));
    }
  }

  async function loadQuickSource(session, source) {
    var generation = session.teamGeneration;
    session.errors.delete(source); session.loading.add(source); renderQuickReplies(session);
    try {
      if (source === 'team') {
        var result = await sb.rpc('smyl_list_quick_replies');
        if (generation !== session.teamGeneration) return;
        if (result.error) throw result.error;
        session.team = result.data || [];
      } else {
        var data = await request('GET', { action: 'quick_replies' });
        session.legacy = data.quick_replies || [];
      }
    } catch (_) { if (source !== 'team' || generation === session.teamGeneration) session.errors.add(source); }
    finally {
      if (source !== 'team' || generation === session.teamGeneration) {
        session.loading.delete(source);
        if (state.quickSession === session && session.dialog.open) renderQuickReplies(session);
      }
    }
  }

  function showQuickLibrary(session, notice) {
    var dialog = session.dialog;
    session.editing = null; dialog.querySelector('[data-quick-form]').hidden = true;
    dialog.querySelector('[data-quick-library]').hidden = false;
    quickNotice(session, notice || ''); renderQuickReplies(session);
    dialog.querySelector('[data-quick-search]').focus();
  }

  function showQuickEditor(session, item) {
    var dialog = session.dialog; var form = dialog.querySelector('[data-quick-form]');
    session.editing = item; dialog.querySelector('[data-quick-library]').hidden = true;
    form.hidden = false; form.elements.shortcut.value = item ? item.shortcut : '';
    form.elements.replyText.value = item ? item.text : '';
    form.querySelector('[data-quick-editor-title]').textContent = item ? 'Editar /' + item.shortcut : 'Nueva respuesta';
    form.querySelector('[data-quick-name]').hidden = !session.canManage;
    form.querySelector('[data-quick-save]').hidden = !session.canManage;
    form.querySelector('[data-quick-delete]').hidden = !item;
    quickNotice(session, '');
    (session.canManage ? form.elements.shortcut : form.elements.replyText).focus();
  }

  async function writeQuickReply(session, remove) {
    if (!session || !session.canManage || session.busy) return;
    var form = session.dialog.querySelector('[data-quick-form]');
    var item = session.editing;
    var shortcut = normalizeText(form.elements.shortcut.value.trim()).replace(/^\/+/, '').replace(/\s+/g, '-');
    var message = form.elements.replyText.value.trim();
    if (remove) {
      if (!item || !window.confirm('¿Eliminar /' + item.shortcut + ' para el equipo?')) return;
    } else {
      if (!/^[a-z0-9_-]{1,40}$/.test(shortcut)) {
        quickNotice(session, 'Escribe un atajo con letras, números, guiones o guiones bajos.'); form.elements.shortcut.focus(); return;
      }
      if (!message) { quickNotice(session, 'Escribe el mensaje que quieres guardar.'); form.elements.replyText.focus(); return; }
      if (session.legacy.some(function (entry) { return entry.shortcut === shortcut; })) {
        quickNotice(session, 'El equipo ya usa ese atajo. Elige otro.'); return;
      }
    }
    var params = { p_id: item ? item.id : null, p_version: item ? item.version : null };
    if (!remove) { params.p_shortcut = shortcut; params.p_text = message; }
    session.busy = true;
    Array.from(form.elements).forEach(function (field) { field.disabled = true; });
    quickNotice(session, remove ? 'Eliminando…' : 'Guardando…');
    try {
      var result = await sb.rpc(remove ? 'smyl_delete_quick_reply' : 'smyl_save_quick_reply', params);
      if (result.error) throw result.error;
      if (state.quickSession !== session || !session.dialog.open) return;
      session.teamGeneration += 1;
      session.team = session.team.filter(function (entry) { return !item || entry.id !== item.id; });
      if (!remove) session.team.push(result.data);
      session.team.sort(function (a, b) { return a.shortcut.localeCompare(b.shortcut, 'es'); });
      session.dialog.querySelector('[data-quick-search]').value = '';
      showQuickLibrary(session, remove ? 'Respuesta eliminada.' : 'Respuesta guardada para el equipo.');
      loadQuickSource(session, 'team');
    } catch (error) {
      if (state.quickSession !== session || !session.dialog.open) return;
      if (error.code === '40001') loadQuickSource(session, 'team');
      var messages = { '23505': 'El equipo ya usa ese atajo. Elige otro.', '42501': 'Tu rol no permite gestionar las respuestas del equipo.', '40001': 'Esta respuesta cambió. Vuelve a la lista y ábrela de nuevo.' };
      quickNotice(session, messages[error.code] || 'No se pudo completar el cambio. Inténtalo de nuevo.');
    } finally {
      session.busy = false;
      if (state.quickSession === session) Array.from(form.elements).forEach(function (field) { field.disabled = false; });
    }
  }

  function openQuickReplies(options) {
    options = options && options.quickReplyTrigger ? options : {};
    var dialog = document.querySelector('[data-quick-dialog]');
    if (!dialog || dialog.open || !canOperate(selectedConversation(), 'messages.respond')) return;
    var form = dialog.querySelector('[data-quick-form]'); var input = document.querySelector('[data-inbox-composer] [name="message"]');
    var inline = options.range || quickShortcutAtCaret(input);
    var session = { dialog: dialog, conversation: state.selectedId, canManage: hasPermission('messages.manage'),
      team: [], legacy: [], teamGeneration: 0, errors: new Set(), loading: new Set(), editing: null, busy: false,
      inputValue: input ? input.value : '', insertStart: inline ? inline.start : input && input.selectionStart,
      insertEnd: inline ? inline.end : input && input.selectionEnd };
    state.quickSession = session;
    Array.from(form.elements).forEach(function (field) { field.disabled = false; });
    dialog.querySelector('[data-quick-search]').value = options.query || (inline && inline.query) || '';
    dialog.querySelector('[data-quick-search]').oninput = function () { renderQuickReplies(session); };
    dialog.querySelector('[data-quick-search]').onkeydown = function (event) {
      if (event.key !== 'Enter') return;
      var first = dialog.querySelector('.smyl-inbox-quick-row');
      if (first) { event.preventDefault(); first.click(); }
    };
    dialog.querySelector('[data-quick-new]').onclick = function () { showQuickEditor(session, null); };
    form.querySelector('[data-quick-back]').onclick = function () { showQuickLibrary(session); };
    form.querySelector('[data-quick-save]').onclick = function () { writeQuickReply(session, false); };
    form.querySelector('[data-quick-delete]').onclick = function () { writeQuickReply(session, true); };
    form.onsubmit = function (event) {
      event.preventDefault();
      var text = form.elements.replyText.value.trim();
      if (text) insertQuickReply(session, text);
      else { quickNotice(session, 'Escribe el mensaje que quieres insertar.'); form.elements.replyText.focus(); }
    };
    dialog.onclose = function () {
      if (state.quickSession === session) state.quickSession = null;
      if (input && !input.disabled) input.focus();
    };
    dialog.showModal(); showQuickLibrary(session);
    loadQuickSource(session, 'team'); loadQuickSource(session, 'legacy');
  }

  function maybeOpenQuickReplies(event) {
    if (!event.isTrusted || document.querySelector('[data-quick-dialog][open]')) return;
    var range = quickShortcutAtCaret(event.currentTarget);
    if (!range || range.query.length < 2) return;
    openQuickReplies({ quickReplyTrigger: true, range: range, query: range.query });
  }

  function renderThreadSearchResults() {
    var wrap = document.querySelector('[data-search-results]'); if (!wrap) return; wrap.innerHTML = '';
    if (state.threadSearchLoading) { wrap.append(skNode('list', { rows: 3, plain: true, label: 'Buscando en el historial' })); return; }
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
    if (state.sharedLoading) { wrap.append(skNode('media', { count: 6, label: 'Consultando biblioteca' })); return; }
    if (!state.sharedItems.length) { wrap.append(node('p', 'smyl-inbox-productivity-state', 'No hay imágenes, documentos o enlaces en este hilo.')); return; }
    state.sharedItems.forEach(function (item) {
      var card = node('article', 'smyl-inbox-shared-item'); var target = chatFileUrl(item.media_url || firstUrl(item.content)); var label = item.media_type === 'image' ? 'Imagen' : item.media_type === 'document' ? 'Documento' : item.media_type === 'audio' ? 'Audio' : 'Enlace';
      var kind = chatMediaKind(item);
      if (kind) card.append(chatMediaButton(item, state.selectedId, true));
      card.append(node('strong', '', label), node('span', '', new Date(item.created_at).toLocaleDateString('es-MX')));
      if (item.content) card.append(node('p', '', item.content));
      if (!kind && target) { var link = node('a', '', 'Abrir'); link.href = target; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
      wrap.append(card);
    });
  }

  async function openSharedItems() {
    var id = state.selectedId, sequence = openSequence;
    if (!id) return; var dialog = document.querySelector('[data-shared-dialog]'); dialog.showModal(); state.sharedLoading = true; state.sharedItems = []; renderSharedItems();
    try {
      var data = await request('GET', { action: 'shared', conversation_id: id, limit: 60 });
      if (state.selectedId === id && sequence === openSequence) { state.sharedItems = data.items || []; state.sharedPage = data.page || null; }
    } catch (error) { if (state.selectedId === id && sequence === openSequence) window.alert(error.message || 'No se pudo abrir la biblioteca.'); }
    finally { if (state.selectedId === id && sequence === openSequence) { state.sharedLoading = false; renderSharedItems(); } }
  }

  // Ancho de la lista de conversaciones: se arrastra el borde entre la lista y el chat (o con las flechas del teclado).
  // Se guarda solo el número, por pestaña (sessionStorage), como la preferencia de la ficha acoplada.
  var LIST_WIDTH_KEY = 'smyl_inbox_list_width', LIST_MIN = 260, LIST_MAX = 560, THREAD_MIN = 380;
  function initListResizer(page) {
    var workspace = page.querySelector('.smyl-inbox-workspace'), handle = page.querySelector('[data-inbox-resizer]'), listPane = page.querySelector('.smyl-inbox-list-pane');
    if (!workspace || !handle || !listPane) return;
    var wanted = null, natural = null, drag = null;
    try { var saved = Number(window.sessionStorage.getItem(LIST_WIDTH_KEY)); if (saved >= LIST_MIN && saved <= LIST_MAX) wanted = saved; } catch (_) {}
    function wide() { return window.matchMedia('(min-width: 901px)').matches && listPane.offsetParent !== null; }
    // Mide las columnas «naturales» del CSS (con o sin ficha acoplada) para cambiar solo la primera.
    function measure() {
      workspace.style.gridTemplateColumns = '';
      var tracks = window.getComputedStyle(workspace).gridTemplateColumns.split(' ').map(parseFloat).filter(function (n) { return !isNaN(n); });
      natural = tracks.length ? tracks : null;
      return natural;
    }
    function clamp(value) {
      var tracks = natural || [LIST_MIN + 80, 800];
      var rest = tracks.slice(2).reduce(function (sum, n) { return sum + n; }, 0);
      var max = Math.min(LIST_MAX, workspace.clientWidth - rest - THREAD_MIN);
      return Math.round(Math.max(LIST_MIN, Math.min(max, value)));
    }
    function place() {
      if (!wide()) { handle.hidden = true; return; }
      handle.hidden = false;
      var width = listPane.getBoundingClientRect().width;
      handle.style.left = (listPane.offsetLeft + width - 5) + 'px';
      handle.setAttribute('aria-valuemin', String(LIST_MIN)); handle.setAttribute('aria-valuemax', String(LIST_MAX)); handle.setAttribute('aria-valuenow', String(Math.round(width)));
    }
    function apply(width) {
      if (!wide()) { workspace.style.gridTemplateColumns = ''; place(); return; }
      var tracks = measure();
      if (width == null || !tracks) { place(); return; }
      var next = clamp(width), rest = tracks.slice(2).map(function (n) { return n + 'px'; });
      workspace.style.gridTemplateColumns = [next + 'px', 'minmax(0, 1fr)'].concat(rest).join(' ');
      place();
    }
    function save(value) { try { if (value == null) window.sessionStorage.removeItem(LIST_WIDTH_KEY); else window.sessionStorage.setItem(LIST_WIDTH_KEY, String(value)); } catch (_) {} }
    function current() { return Math.round(listPane.getBoundingClientRect().width); }
    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || !wide()) return;
      event.preventDefault(); var startWidth = current(); measure();
      drag = { x: event.clientX, width: startWidth };
      workspace.classList.add('is-resizing'); handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', function (event) {
      if (!drag) return;
      wanted = clamp(drag.width + event.clientX - drag.x);
      var tracks = natural, rest = tracks ? tracks.slice(2).map(function (n) { return n + 'px'; }) : [];
      workspace.style.gridTemplateColumns = [wanted + 'px', 'minmax(0, 1fr)'].concat(rest).join(' '); place();
    });
    function endDrag(event) {
      if (!drag) return; drag = null; workspace.classList.remove('is-resizing');
      try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
      if (wanted != null) save(wanted);
    }
    handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('dblclick', function () { wanted = null; save(null); apply(null); });
    handle.addEventListener('keydown', function (event) {
      var step = event.shiftKey ? 48 : 16;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); var base = current(); measure();
        wanted = clamp(base + (event.key === 'ArrowRight' ? step : -step)); save(wanted); apply(wanted);
      } else if (event.key === 'Home' || event.key === 'Escape') { event.preventDefault(); wanted = null; save(null); apply(null); }
    });
    // El ancho elegido se vuelve a aplicar cuando cambia la ventana o se abre/cierra la ficha acoplada.
    var relayout = function () { apply(wanted); };
    window.addEventListener('resize', relayout);
    if (window.ResizeObserver) new ResizeObserver(function () { if (!drag) place(); }).observe(workspace);
    if (window.MutationObserver) new MutationObserver(relayout).observe(page, { attributes: true, attributeFilter: ['class'] });
    relayout();
  }

  function initThreadViewport(page) {
    var body = page.querySelector('[data-thread-body]');
    var viewport = window.visualViewport;
    var mobile = window.matchMedia('(max-width: 760px)');
    var reading = null, layoutScrollTop = null;
    function mobileThreadOpen() {
      return mobile.matches && page.matches('.activa.show-thread, .activa.pipeline-chat-open');
    }
    function preserveReadingPosition() {
      if (!state.selectedId || !mobileThreadOpen() || !body.clientHeight || (viewport && Math.abs(viewport.scale - 1) > 0.02)) {
        reading = null;
        layoutScrollTop = null;
        return;
      }
      var height = body.clientHeight, width = body.clientWidth;
      if (reading && reading.id === state.selectedId && reading.height !== height) {
        // Un cambio de altura mueve el borde inferior. Quien lee arriba conserva su línea,
        // incluso si el navegador intentó compensar el cambio con su propio desplazamiento.
        if (reading.atEnd) body.scrollTop = body.scrollHeight;
        else if (reading.width === width) body.scrollTop = reading.top;
        layoutScrollTop = body.scrollTop;
      }
      reading = { id:state.selectedId, height:height, width:width, top:body.scrollTop,
        atEnd:body.scrollHeight - height - body.scrollTop <= 2 };
    }
    function fitMobileThread() {
      if (!mobileThreadOpen()) {
        page.style.removeProperty('--smyl-thread-available-height');
        reading = null;
        layoutScrollTop = null;
        return;
      }
      // En Safari el teclado puede reducir sólo la ventana visual.
      if (viewport && Math.abs(viewport.scale - 1) > 0.02) return;
      var top = Math.max(0, page.getBoundingClientRect().top - (viewport ? viewport.offsetTop : 0));
      var available = (viewport ? viewport.height : window.innerHeight) - top;
      if (available > 0) page.style.setProperty('--smyl-thread-available-height', Math.floor(available) + 'px');
      preserveReadingPosition();
    }
    body.addEventListener('scroll', function () {
      preserveReadingPosition();
      var layoutOnly = layoutScrollTop === body.scrollTop;
      layoutScrollTop = null;
      if (atThreadBottom() && !layoutOnly) {
        if (threadPaintDeferred) scrollThreadBottom(); else resetThreadJump();
      } else updateThreadJump(!atThreadBottom());
    }, {passive:true});
    page.querySelector('[data-inbox-composer]').addEventListener('focusin', preserveReadingPosition);
    if (window.ResizeObserver) new ResizeObserver(preserveReadingPosition).observe(body);
    if (viewport) {
      viewport.addEventListener('resize', fitMobileThread);
      viewport.addEventListener('scroll', fitMobileThread);
    }
    window.addEventListener('resize', fitMobileThread);
    if (window.MutationObserver) new MutationObserver(fitMobileThread).observe(page, { attributes:true, attributeFilter:['class'] });
    fitMobileThread();
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
        var advanced = !!button.closest('[data-inbox-filter-panel]');
        state.filter = advanced && state.filter === button.dataset.inboxFilter ? 'all' : button.dataset.inboxFilter;
        if (!advanced) state.filterPanelOpen = false;
        renderFilterControls();
        loadList(true);
      });
    });
    page.querySelectorAll('[role="tablist"]').forEach(function (tablist) { tablist.addEventListener('keydown', rovingTabsKeydown); });
    page.querySelector('[data-inbox-filter-more]').addEventListener('click', toggleInboxFilters);
    page.querySelector('[data-inbox-filter-panel]').addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.preventDefault(); state.filterPanelOpen = false; renderFilterControls(); page.querySelector('[data-inbox-filter-more]').focus();
    });
    page.querySelector('[data-inbox-filter-panel]').addEventListener('focusout', function (event) {
      if (state.filterPanelOpen && event.relatedTarget && !event.relatedTarget.closest('[data-inbox-filter-panel],[data-inbox-filter-more]')) {
        state.filterPanelOpen = false; renderFilterControls();
      }
    });
    var searchTimer = null;
    function searchConversations(value) {
      state.search = value; renderList(); clearTimeout(searchTimer); searchTimer = setTimeout(function () { loadList(true); }, 320);
    }
    page.querySelector('[data-inbox-search]').addEventListener('input', function (event) { searchConversations(event.target.value); });
    page.querySelector('[data-pipeline-search]').addEventListener('input', function (event) { page.querySelector('[data-inbox-search]').value = event.target.value; searchConversations(event.target.value); });
    page.querySelectorAll('[data-inbox-view]').forEach(function (button) { button.addEventListener('click', function () { setInboxView(button.dataset.inboxView); }); });
    page.querySelector('[data-pipeline-today]').addEventListener('click', function () {
      if (!hasPermission('schedule.read')) return;
      state.pipelineToday = !state.pipelineToday;
      renderPipeline();
    });
    page.querySelector('[data-pipeline-more]').addEventListener('click', function () { loadList(!state.hasMore); });
    var savedView = null; try { savedView = window.sessionStorage.getItem('smyl_inbox_view'); } catch (_) {}
    setInboxView(savedView);
    page.querySelector('[data-inbox-channel]').addEventListener('click', function (event) { var chip = event.target.closest('[data-channel-value]'); if (!chip) return; state.channel = state.channel === chip.dataset.channelValue ? '' : chip.dataset.channelValue; renderFilterControls(); loadList(true); });
    page.querySelector('[data-inbox-more]').addEventListener('click', function () { loadList(false); });
    page.querySelector('[data-thread-older]').addEventListener('click', function () { loadThread(state.selectedId, true); });
    page.querySelector('[data-thread-jump]').addEventListener('click', function () {
      scrollThreadBottom(); page.querySelector('[data-thread-body]').focus({preventScroll:true});
    });
    page.querySelector('[data-inbox-composer]').addEventListener('submit', sendMessage);
    var replyInput = page.querySelector('[name="message"]');
    var mobileReply = window.matchMedia('(max-width: 760px)');
    var followReplyEnd = false;
    function revealReplyEnd() {
      if (followReplyEnd && mobileReply.matches && (document.activeElement === replyInput || document.activeElement === expandReply) &&
          replyInput.selectionStart === replyInput.value.length && replyInput.selectionEnd === replyInput.value.length) {
        replyInput.scrollTop = replyInput.scrollHeight;
      }
    }
    var expandReply = node('button'); expandReply.type = 'button'; expandReply.hidden = true;
    expandReply.dataset.composeExpand = '';
    expandReply.setAttribute('aria-controls', replyInput.id);
    setEditorExpanded(replyInput.form, expandReply, false);
    page.querySelector('[data-compose-more]').before(expandReply);
    expandReply.addEventListener('click', function () {
      followReplyEnd = replyInput.scrollHeight - replyInput.clientHeight - replyInput.scrollTop < 2;
      setEditorExpanded(replyInput.form, expandReply, expandReply.getAttribute('aria-expanded') !== 'true');
      fitComposerText(replyInput);
      revealReplyEnd();
    });
    // Preserva el teclado en el gesto original. Una confirmación de red posterior no debe recuperar el foco.
    function keepReplyFocus(event) {
      if (event.button === 0 && mobileReply.matches && !replyInput.disabled && document.activeElement === replyInput) event.preventDefault();
    }
    page.querySelector('[data-compose-send]').addEventListener('pointerdown', keepReplyFocus);
    expandReply.addEventListener('pointerdown', keepReplyFocus);
    // Una selección o desplazamiento dentro del texto tiene prioridad sobre seguir el último renglón.
    function readReplyPosition() { followReplyEnd = false; }
    replyInput.addEventListener('blur', readReplyPosition);
    replyInput.addEventListener('pointerdown', readReplyPosition);
    replyInput.addEventListener('wheel', readReplyPosition, {passive:true});
    replyInput.addEventListener('click', function () {
      followReplyEnd = replyInput.scrollHeight - replyInput.clientHeight - replyInput.scrollTop < parseFloat(getComputedStyle(replyInput).lineHeight);
      revealReplyEnd();
    });
    replyInput.addEventListener('input', function (event) {
      followReplyEnd = replyInput.selectionStart === replyInput.value.length && replyInput.selectionEnd === replyInput.value.length;
      fitComposerText(replyInput);
      revealReplyEnd();
      scheduleDraftSave(replyInput.value);
      maybeOpenQuickReplies(event);
    });
    mobileReply.addEventListener('change', function () { fitComposerText(replyInput); });
    if (window.ResizeObserver) {
      var lastReplyWidth = 0;
      new ResizeObserver(function () {
        if (replyInput.clientWidth !== lastReplyWidth) {
          lastReplyWidth = replyInput.clientWidth;
          fitComposerText(replyInput);
        }
        revealReplyEnd();
      }).observe(replyInput);
    }
    page.querySelector('[data-compose-more]').addEventListener('click', toggleComposerTools);
    var settings = node('button'); settings.type = 'button'; settings.dataset.threadSettings = '';
    settings.setAttribute('role', 'menuitem'); settings.setAttribute('aria-haspopup', 'dialog');
    settings.innerHTML = composeIcon('settings') + '<span><strong>Ajustes del chat</strong><small>Opciones de esta conversación</small></span>';
    settings.onclick = openConversationSettings; page.querySelector('[data-compose-tools]').append(settings);
    page.querySelector('[data-compose-tools]').addEventListener('click', function (event) { if (event.target.closest('button')) closeComposerTools(); });
    page.querySelector('[data-compose-tools]').addEventListener('keydown', function (event) { menuKeydown(event, event.currentTarget, closeComposerTools); });
    page.querySelector('[data-compose-emoji]').addEventListener('click', openEmojiDialog);
    page.querySelector('[data-compose-record]').addEventListener('click', toggleVoiceRecording);
    page.querySelector('[data-compose-copilot]').addEventListener('click', function () { requestCopilot('draft'); });
    page.querySelector('[data-compose-rewrite]').addEventListener('click', rewriteComposerText);
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
    page.querySelector('[data-availability-service]').addEventListener('change', function () { filterAvailabilityProfessionals(); page.querySelector('[data-availability-form]').requestSubmit(); });
    page.querySelector('[data-availability-branch]').addEventListener('change', function () { refreshAvailabilityHeading(); page.querySelector('[data-availability-form]').requestSubmit(); });
    page.querySelector('[data-availability-professional]').addEventListener('change', function () { page.querySelector('[data-availability-form]').requestSubmit(); });
    page.querySelectorAll('[data-availability-preset]').forEach(function (button) { button.addEventListener('click', function () { setAvailabilityPeriod(button.dataset.availabilityPreset); }); });
    page.querySelector('[data-availability-custom]').addEventListener('click', function () {
      page.querySelectorAll('[data-availability-preset]').forEach(function (button) { button.classList.remove('is-active'); });
      setAvailabilityCustomDates(true);
      page.querySelector('[data-availability-from]').focus();
    });
    page.querySelectorAll('[data-availability-from],[data-availability-to]').forEach(function (input) { input.addEventListener('change', function () { page.querySelectorAll('[data-availability-preset]').forEach(function (button) { button.classList.remove('is-active'); }); setAvailabilityCustomDates(true); refreshAvailabilityHeading(); }); });
    page.querySelector('[data-availability-link-patient]').addEventListener('click', openAvailabilityPatientLink);
    page.querySelector('[data-availability-close]').addEventListener('click', function () { page.querySelector('[data-availability-dialog]').close(); });
    page.querySelector('[data-availability-prepare]').addEventListener('click', prepareAvailabilityOptions);
    page.querySelector('[data-availability-suggest-run]').addEventListener('click', function () { runSuggestion(false); });
    page.querySelector('[data-availability-waitlist]').addEventListener('click', function () {
      var dlg = page.querySelector('[data-availability-dialog]');
      if (!window.SmylWaitlist) return;
      window.SmylWaitlist.openAdd({ conversationId: state.selectedId, serviceId: dlg.querySelector('[data-availability-service]').value, branchId: dlg.querySelector('[data-availability-branch]').value, professionalId: dlg.querySelector('[data-availability-professional]').value, source: 'chat' });
    });
    page.querySelector('[data-availability-suggest-results]').addEventListener('click', function (event) {
      if (event.target.closest('[data-availability-suggest-use]')) useSuggestion();
      else if (event.target.closest('[data-availability-suggest-more]')) runSuggestion(true);
    });
    ['[data-availability-service]', '[data-availability-branch]', '[data-availability-professional]'].forEach(function (selector) { page.querySelector(selector).addEventListener('change', resetSuggestion); });
    page.querySelector('[data-availability-book]').addEventListener('click', function () { bookAvailabilitySlot(state.availabilitySelected[0]); });
    page.querySelectorAll('[data-availability-mode]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (state.availabilityMode === button.dataset.availabilityMode) return;
        state.availabilityMode = button.dataset.availabilityMode; state.availabilitySelected = []; syncAvailabilityMode();
        page.querySelector('[data-availability-form]').requestSubmit();
      });
    });
    page.querySelector('[data-operations-close]').addEventListener('click', function () { page.querySelector('[data-operations-dialog]').close(); });
    page.querySelector('[data-operations-refresh]').addEventListener('click', function () { loadOperations(true); });
    page.querySelector('[data-pilot-report]').addEventListener('click', openPilotReport);
    page.querySelector('[data-pilot-report-close]').addEventListener('click', function () { page.querySelector('[data-pilot-report-dialog]').close(); });
    page.querySelector('[data-pilot-report-back]').addEventListener('click', function () { page.querySelector('[data-pilot-report-dialog]').close(); openOperations(); });
    page.querySelector('[data-pilot-report-print]').addEventListener('click', printPilotReport);
    page.querySelector('[data-pipeline-cancel]').addEventListener('click', function () { closePipelineChat(true); });
    page.querySelector('[data-inbox-back]').addEventListener('click', function () {
      closeChatMedia(); closeThreadOptions(false);
      if (state.pipelineChatId) closePipelineChat(true);
      else { page.classList.remove('show-thread'); closeContext(false); }
    });
    initListResizer(page);
    initThreadViewport(page);
    initThreadOptions(page);
    page.querySelector('[data-inbox-context]').addEventListener('click', function (event) {
      if (state.contextOpen && contextDocked()) closeContext(false);
      else openContext(event.currentTarget);
    });
    page.querySelector('[data-thread-mode]').addEventListener('click', function () { var conversation = selectedConversation(); if (!conversation) return; conversation.paused ? prepareResume() : mutateConversation('pause'); });
    page.querySelector('[data-settings-close]').addEventListener('click', function () { page.querySelector('[data-settings-dialog]').close(); });
    var ownerDialog = page.querySelector('[data-owner-dialog]');
    page.querySelector('[data-thread-owner]').addEventListener('click', function () {
      var conversation = selectedConversation();
      if (!canTransfer(conversation) || ownerDialog.open) return;
      renderChatOwner(conversation);
      renderHandoffNote(conversation);
      ownerDialog.dataset.thread = conversation.id;
      ownerDialog.showModal();
    });
    page.querySelector('[data-owner-close]').addEventListener('click', function () { ownerDialog.close(); });
    page.querySelector('[data-thread-assign]').addEventListener('change', function (event) { changeChatOwner(event.target.dataset.conversationId, event.target.value); });
    page.querySelector('[data-thread-owner-retry]').addEventListener('click', function () {
      teamsByConversation.delete(state.selectedId); renderChatOwner(selectedConversation());
    });
    page.querySelector('[data-thread-search-form]').addEventListener('submit', searchThread);
    page.querySelector('[data-search-close]').addEventListener('click', function () { page.querySelector('[data-search-dialog]').close(); });
    page.querySelector('[data-shared-close]').addEventListener('click', function () { page.querySelector('[data-shared-dialog]').close(); });
    page.querySelector('[data-quick-close]').addEventListener('click', function () { page.querySelector('[data-quick-dialog]').close(); });
    page.querySelector('[data-emoji-close]').addEventListener('click', function () { page.querySelector('[data-emoji-dialog]').close(); });
    page.querySelectorAll('[data-quick-dialog], [data-emoji-dialog], [data-settings-dialog]').forEach(function (dialog) {
      dialog.addEventListener('close', function () {
        // The browser may return focus to the tool menu after it has collapsed.
        if (!dialog.open && (document.activeElement === document.body || document.activeElement.closest('[data-compose-tools][hidden]'))) {
          page.querySelector('[data-compose-more]').focus();
        }
      });
    });
    page.querySelector('[data-context-close]').addEventListener('click', function () { closeContext(true); });
    page.querySelector('[data-inbox-context-panel]').addEventListener('keydown', trapContextFocus);
    if (window.matchMedia) {
      var dockQuery = window.matchMedia(CONTEXT_DOCK_QUERY);
      var onDockChange = function () { syncContextAccessibility(); };
      if (dockQuery.addEventListener) dockQuery.addEventListener('change', onDockChange); else if (dockQuery.addListener) dockQuery.addListener(onDockChange);
    }
    page.addEventListener('pointerdown', function (event) {
      if (!event.target.closest('[data-compose-tools],[data-compose-more]')) closeComposerTools(false);
      if (state.filterPanelOpen && !event.target.closest('[data-inbox-filter-panel],[data-inbox-filter-more]')) { state.filterPanelOpen = false; renderFilterControls(); }
    });
    page.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented || state.contextOpen || document.querySelector('dialog[open]')) return;
      if (state.branchMenu) { event.preventDefault(); closeBranchMenu(true); return; }
      var toolsOpen = !page.querySelector('[data-compose-tools]').hidden;
      closeComposerTools(true);
      if (state.filterPanelOpen) { state.filterPanelOpen = false; renderFilterControls(); page.querySelector('[data-inbox-filter-more]').focus(); }
      else if (state.pipelineChatId && !toolsOpen) { event.preventDefault(); closePipelineChat(true); }
    });

    var notice = node('p', 'smyl-chat-access-status', 'Comprobando acceso al chat…'); notice.dataset.chatAccessStatus = ''; notice.setAttribute('role', 'status'); page.prepend(notice);
    var previous = window.ir;
    window.ir = function (route) {
      var result = previous.apply(this, arguments);
      if (route === 'inbox') {
        refreshAccess().then(function (allowed) {
          if (!allowed || !page.classList.contains('activa')) return;
          if (state.stageCatalogStatus !== 'ready') loadStages();
          if (!state.conversations.length) { loadList(true); loadBranches(); loadOperations(true); }
          else { sync(); loadOperations(false); autoOpenFirst(); }
        });
      } else {
        closeChatMedia(); closeThreadOptions(false);
        if (ownerDialog.open) renderHandoffNote(null);
        if (state.pipelineChatId) closePipelineChat(false);
        if (state.recorder && state.recorder.state === 'recording') stopVoiceRecording(true); closeContext(false);
      }
      return result;
    };
    window.addEventListener('smyl:chat-access-changed', function () {
      teamsByConversation.clear();
      refreshAccess().then(function () { renderChatOwner(selectedConversation()); renderBulkBar(); });
    });
    if (typeof sb !== 'undefined' && sb.auth && typeof sb.auth.onAuthStateChange === 'function') {
      sb.auth.onAuthStateChange(function (event, session) {
        var id = session && session.user && session.user.id;
        if (id !== accessUser) {
          accessUser = id; accessEpoch++; accessRequest = null; setChatActor(null);
          if (id) setTimeout(refreshAccess, 0);
        }
      });
    }
    setTimeout(refreshAccess, 0);
    setTimeout(function () {
      if (!chatEnabled() || state.conversations.length || state.loadingList || document.visibilityState !== 'visible') return;
      loadList(true); loadBranches(); loadStages();
    }, 2500);
    setInterval(function () { if (document.visibilityState === 'visible') refreshAccess(); }, 60000);
    setTimeout(refreshUnreadBadge, 6000);
    setInterval(refreshUnreadBadge, 90000);
    function scheduleSync() {
      clearTimeout(state.syncTimer);
      state.syncTimer = setTimeout(function () { Promise.resolve(sync()).then(scheduleSync, scheduleSync); }, state.syncDelay || 5000);
    }
    function wakeSync() { state.syncDelay = 5000; }
    scheduleSync();
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { wakeSync(); refreshAccess().then(function (allowed) { if (allowed) sync(); }); } });
    var inboxPage = document.getElementById('p-inbox');
    if (inboxPage) ['pointerdown', 'keydown'].forEach(function (name) { inboxPage.addEventListener(name, wakeSync, { passive: true }); });
    setInterval(function () {
      if (document.visibilityState === 'visible' && document.getElementById('p-inbox').classList.contains('activa')) loadOperations(true);
    }, 60000);
    setInterval(function () { if (state.selectedId && !inboxInteractionProtected()) { renderWhatsappWindow(); renderContext(); } }, 60000);
  }

  window.SmylInbox = {
    canAccess: chatEnabled,
    open: function (conversationId) { window.ir('inbox'); return openConversation(conversationId); },
    // Abre la conversación y, ya dentro, «Agendar cita» (con «Sugerir horarios»). Solo prepara: la persona revisa y envía.
    offerSlots: async function (conversationId) { window.ir('inbox'); await openConversation(conversationId); if (state.selectedId !== conversationId) return false; await openAvailabilityDialog(); return true; },
    // Abre la conversación para que una persona revise y envíe (nunca envía por sí solo).
    //  · Con la ventana de 24 h de WhatsApp abierta (o en otros canales): deja `text` escrito en el compositor y devuelve true.
    //  · Con la ventana cerrada y `options.template` = { names, variables, missingText }: abre esa plantilla aprobada con las variables ya llenas
    //    y devuelve 'template' (`options.onSent` se llama solo si la persona la envía). Sin la plantilla aprobada avisa y devuelve false.
    compose: async function (conversationId, text, options) {
      options = options || {}; window.ir('inbox'); await openConversation(conversationId);
      if (state.selectedId !== conversationId) return false;
      var conversation = selectedConversation(), windowNow = conversation ? liveWhatsappWindow(conversation) : null;
      if (options.template && conversation && conversation.channel === 'whatsapp' && windowNow && !windowNow.freeform_allowed) {
        var names = Array.isArray(options.template.names) ? options.template.names : [];
        try { await loadTemplates(); } catch (_) { return false; }
        if (!state.templates.some(function (item) { return names.indexOf(item.name) !== -1; })) {
          var missingCopy = options.template.missingText || 'No hay una plantilla aprobada para este mensaje. Solicítala en Mensajería → Plantillas; Meta suele tardar de unos minutos a 48 horas.';
          if (window.SmylTemplateSuggest) window.SmylTemplateSuggest.offerMissing(names, missingCopy); else window.alert(missingCopy);
          return false;
        }
        await openTemplateDialog(names, { variables: options.template.variables || [], onSent: options.onSent || null });
        return 'template';
      }
      setComposerText(text); return true;
    },
    sendTemplate: async function (conversationId, options) { options = options || {}; window.ir('inbox'); await openConversation(conversationId); if (state.selectedId !== conversationId || !chatEnabled()) return; await openTemplateDialog(options.preferred, options); },
    collect: async function (conversationId) { window.ir('inbox'); await openConversation(conversationId); if (state.selectedId !== conversationId || !chatEnabled()) return; await openCobroTemplate(); },
    openOperations: async function () { window.ir('inbox'); if (await refreshAccess() && hasPermission('messages.manage')) openOperations(); },
    refresh: function () { loadList(true); },
    loadOperations: loadOperations,
    getOperationsSummary: operationsSummary,
    // Para el Inicio: últimas conversaciones sin tocar la lista ni el filtro del buzón, y sin abrir ninguna.
    fetchRecent: async function (limit) {
      if (!chatEnabled()) return [];
      var data = await request('GET', { action: 'list', filter: 'all', limit: Math.max(1, Math.min(12, Number(limit) || 6)), offset: 0 }, null, null, 12000);
      return Array.isArray(data.conversations) ? data.conversations : [];
    },
    buildAvatar: function (item) {
      var avatar = node('span', 'smyl-inbox-avatar', initials(item.contact_name)); avatar.dataset.channel = item.channel;
      avatar.append(channelBadge(item.channel));
      return avatar;
    },
    timeLabel: timeLabel,
    channelLabel: channelLabel,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
