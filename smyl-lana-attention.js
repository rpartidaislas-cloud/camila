(function () {
  'use strict';

  var state = { loading: false, loaded: false, items: [], total: 0, canResolve: false, error: '' };

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function channelName(channel) {
    return channel === 'whatsapp' ? 'WhatsApp' : channel === 'messenger' ? 'Messenger' : channel === 'instagram' ? 'Instagram' : 'LANA';
  }

  function channelLetter(channel) {
    return channel === 'whatsapp' ? 'W' : channel === 'messenger' ? 'M' : channel === 'instagram' ? 'I' : 'L';
  }

  function waitingLabel(value) {
    var time = new Date(value || '').getTime();
    if (!time) return 'Hora no disponible';
    var minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return 'Hace ' + minutes + ' min';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return 'Hace ' + hours + (hours === 1 ? ' h' : ' h');
    var days = Math.floor(hours / 24);
    if (days < 7) return 'Hace ' + days + (days === 1 ? ' día' : ' días');
    return new Date(time).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }

  async function sessionToken() {
    if (!window.sb || !sb.auth) throw new Error('No se pudo iniciar la conexión con el servidor.');
    var result = await sb.auth.getSession();
    var token = result && result.data && result.data.session && result.data.session.access_token;
    if (!token) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    return token;
  }

  async function request(method, payload) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 20000);
    try {
      var response = await fetch(SUPA_URL + '/functions/v1/lana-attention', {
        method: method,
        headers: { 'Authorization': 'Bearer ' + await sessionToken(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify(payload || {}) : undefined,
        signal: controller.signal,
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(data.error || 'No se pudo consultar la atención pendiente.');
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('LANA tardó demasiado en responder. Intenta nuevamente.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function shell() {
    var section = node('section', 'lana-attention');
    section.id = 'lana-attention-dashboard';
    section.setAttribute('aria-labelledby', 'lana-attention-title');
    section.innerHTML = '<header class="lana-attention-head"><div><span>ATENCIÓN CON LANA · ETAPA 6</span><h2 id="lana-attention-title">Conversaciones que necesitan a tu equipo</h2><p>Prioriza el pase a humano y continúa el caso clínico sin duplicar la bandeja de Meta.</p></div><button type="button" class="lana-attention-refresh" data-lana-attention-refresh aria-label="Actualizar conversaciones">Actualizar</button></header><div class="lana-attention-body" data-lana-attention-body><div class="lana-attention-loading"><i></i><i></i><i></i></div></div><footer class="lana-attention-privacy">SMYL recibe solo nombre, canal, estado y referencia de la conversación. Los mensajes permanecen en LANA.</footer>';
    section.querySelector('[data-lana-attention-refresh]').addEventListener('click', function () { load(true); });
    return section;
  }

  function renderMetrics(body) {
    var human = state.items.filter(function (item) { return item.attention_type === 'human_requested'; }).length;
    var unread = state.items.reduce(function (sum, item) { return sum + (Number(item.unread_count) || 0); }, 0);
    var linked = state.items.filter(function (item) { return Boolean(item.linked); }).length;
    var metrics = node('div', 'lana-attention-metrics');
    [[state.total, 'Por atender'], [unread, 'Mensajes sin leer'], [linked, 'Con expediente']].forEach(function (entry, index) {
      var card = node('div', 'lana-attention-metric');
      card.append(node('strong', index === 0 && human > 0 ? 'is-alert' : '', String(entry[0])), node('span', '', entry[1]));
      metrics.append(card);
    });
    body.append(metrics);
  }

  function renderItem(item) {
    var article = node('article', 'lana-attention-item');
    article.dataset.attentionType = item.attention_type;
    var main = node('div', 'lana-attention-main');
    var icon = node('span', 'lana-attention-channel', channelLetter(item.channel));
    icon.dataset.channel = item.channel;
    var copy = node('div', 'lana-attention-copy');
    var titleRow = node('div', 'lana-attention-title-row');
    titleRow.append(node('strong', '', item.contact_name || 'Paciente de LANA'));
    titleRow.append(node('span', 'lana-attention-time', waitingLabel(item.waiting_since)));
    var reason = node('p', '', item.reason || 'Requiere atención del equipo.');
    var meta = node('div', 'lana-attention-meta');
    meta.append(node('span', 'lana-attention-badge is-channel', channelName(item.channel)));
    meta.append(node('span', 'lana-attention-badge is-status', item.attention_type === 'human_requested' ? 'Intervención solicitada' : 'Paciente respondió'));
    if (item.unread_count > 0) meta.append(node('span', 'lana-attention-badge', item.unread_count + (item.unread_count === 1 ? ' sin leer' : ' sin leer')));
    if (item.linked) meta.append(node('span', 'lana-attention-badge is-linked', 'Expediente vinculado'));
    copy.append(titleRow, reason, meta);
    main.append(icon, copy);

    var actions = node('div', 'lana-attention-actions');
    var record = node('button', 'btn btn-secondary btn-sm', item.linked ? 'Abrir expediente' : 'Preparar expediente');
    record.type = 'button';
    record.addEventListener('click', function () {
      if (window.SmylLanaHandoff) window.SmylLanaHandoff.open(item.id);
    });
    var chat = node('button', 'btn btn-primary btn-sm', 'Abrir conversación');
    chat.type = 'button';
    chat.addEventListener('click', function () {
      if (window.SmylInbox) window.SmylInbox.open(item.id);
      else window.open(item.lana_url, '_blank', 'noopener,noreferrer');
    });
    actions.append(record, chat);
    if (state.canResolve && item.attention_type === 'human_requested') {
      var resolve = node('button', 'lana-attention-resolve', 'Marcar resuelto');
      resolve.type = 'button';
      resolve.addEventListener('click', function () { resolveItem(item, resolve); });
      actions.append(resolve);
    }
    article.append(main, actions);
    return article;
  }

  function render() {
    var body = document.querySelector('[data-lana-attention-body]');
    var refresh = document.querySelector('[data-lana-attention-refresh]');
    if (!body) return;
    if (refresh) { refresh.disabled = state.loading; refresh.textContent = state.loading ? 'Actualizando…' : 'Actualizar'; }
    body.innerHTML = '';
    if (state.loading && !state.loaded) {
      body.innerHTML = '<div class="lana-attention-loading"><i></i><i></i><i></i></div>';
      return;
    }
    if (state.error) {
      var error = node('div', 'lana-attention-state is-error');
      error.append(node('strong', '', 'No pudimos consultar LANA'), node('p', '', state.error));
      var errorActions = node('div', 'lana-attention-state-actions');
      var retry = node('button', 'btn btn-secondary btn-sm', 'Intentar de nuevo'); retry.type = 'button'; retry.onclick = function () { load(true); };
      var configure = node('button', 'btn btn-primary btn-sm', 'Revisar conexión'); configure.type = 'button'; configure.onclick = function () { window.ir('conexiones'); };
      errorActions.append(retry, configure); error.append(errorActions); body.append(error);
      return;
    }
    renderMetrics(body);
    if (!state.items.length) {
      var empty = node('div', 'lana-attention-state is-empty');
      empty.append(node('span', 'lana-attention-empty-mark', '✓'), node('strong', '', 'No hay conversaciones pendientes'), node('p', '', 'Cuando LANA solicite a una persona o un paciente responda durante una pausa, aparecerá aquí.'));
      body.append(empty);
      return;
    }
    var list = node('div', 'lana-attention-list');
    state.items.forEach(function (item) { list.append(renderItem(item)); });
    body.append(list);
  }

  async function load(force) {
    if (!document.getElementById('lana-attention-dashboard') || state.loading || (state.loaded && !force)) return;
    state.loading = true; state.error = ''; render();
    try {
      var data = await request('GET');
      state.items = Array.isArray(data.items) ? data.items : [];
      state.total = Number(data.total) || state.items.length;
      state.canResolve = Boolean(data.can_resolve);
      state.loaded = true;
    } catch (error) {
      state.error = error.message || 'No se pudo consultar la atención pendiente.';
      state.loaded = true;
      state.items = [];
      state.total = 0;
    } finally {
      state.loading = false; render();
    }
  }

  async function resolveItem(item, button) {
    if (!window.confirm('¿Confirmas que esta solicitud ya fue atendida? LANA conservará la conversación y sus mensajes.')) return;
    button.disabled = true; button.textContent = 'Guardando…';
    try {
      await request('POST', { action: 'resolve', conversation_id: item.id });
      state.items = state.items.filter(function (candidate) { return candidate.id !== item.id; });
      state.total = Math.max(0, state.total - 1);
      render();
    } catch (error) {
      button.disabled = false; button.textContent = 'Marcar resuelto';
      window.alert(error.message || 'No se pudo actualizar la conversación.');
    }
  }

  function init() {
    var home = document.getElementById('p-dashboard');
    if (!home || document.getElementById('lana-attention-dashboard')) return;
    var section = shell();
    var actions = home.querySelector('.pro-action-grid');
    var stats = home.querySelector('.stats-grid');
    if (actions) actions.after(section); else if (stats) stats.before(section); else home.prepend(section);

    var previous = window.ir;
    window.ir = function (route) {
      previous(route);
      if (route === 'dashboard') load(true);
    };
    setInterval(function () {
      var dashboard = document.getElementById('p-dashboard');
      if (dashboard && dashboard.classList.contains('activa') && document.visibilityState === 'visible') load(true);
    }, 60000);
  }

  window.SmylLanaAttention = { load: load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
