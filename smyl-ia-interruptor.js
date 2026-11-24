(function () {
  'use strict';
  // Interruptor de la IA de la clínica (task-id smyl-ia-interruptor). Apaga/enciende/programa las respuestas automáticas de
  // WhatsApp, Messenger, Instagram y el asistente del perfil público. Lo pueden CAMBIAR el dueño y el administrador; todo el
  // equipo lo ve. Las reglas viven en el servidor (lana-ia-interruptor → LANA); aquí solo se captura y se muestra.
  var ZONE = 'America/Mexico_City';
  var state = { data: null, loaded: false, error: '', busy: false, editing: false, form: null };
  var slot = null;
  var timer = null;

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // ── Fechas en la zona de la clínica (se capturan como hora de pared y viajan como UTC) ──
  function offsetMs(utcMs, zone) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
  }
  function localToIso(value, zone) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
    if (!m) return null;
    var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var t = guess - offsetMs(guess, zone);
    t = guess - offsetMs(t, zone);
    var d = new Date(t);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  function isoToLocal(ms, zone) {
    var p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
  }
  function pretty(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleString('es-MX', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function remaining(ms) {
    if (!(ms > 0)) return 'unos segundos';
    var min = Math.round(ms / 60000);
    if (min < 60) return Math.max(min, 1) + ' min';
    var h = Math.floor(min / 60);
    if (h < 48) return h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
    return Math.floor(h / 24) + ' d ' + (h % 24) + ' h';
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
    var t = setTimeout(function () { controller.abort(); }, 20000);
    try {
      var response = await fetch(SUPA_URL + '/functions/v1/lana-ia-interruptor', {
        method: method,
        headers: { 'Authorization': 'Bearer ' + await sessionToken(), 'apikey': SUPA_KEY, 'Content-Type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify(payload || {}) : undefined,
        signal: controller.signal,
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        var error = new Error(data.error || 'No se pudo completar la operación.');
        error.status = response.status;
        error.code = data.code;
        throw error;
      }
      return data;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('El servicio tardó demasiado en responder. Intenta nuevamente.');
      throw error;
    } finally {
      clearTimeout(t);
    }
  }

  async function load() {
    try {
      state.data = await request('GET');
      state.error = '';
    } catch (error) {
      // Clínica sin mensajería conectada: no hay interruptor que mostrar (ni error que asustar).
      state.data = null;
      state.error = (error && (error.code === 'lana_no_conectada' || error.status === 404 || error.status === 409)) ? '' : ((error && error.message) || 'No se pudo consultar el estado de la IA.');
    }
    state.loaded = true;
    render();
    renderBanner();
    window.dispatchEvent(new CustomEvent('smyl:ia-interruptor-changed'));
  }

  function view() {
    var n = (state.data && state.data.negocio) || {};
    var g = (state.data && state.data.global) || {};
    return { n: n, g: g, apagada: n.apagada === true, programada: n.programada === true, canManage: !!(state.data && state.data.can_manage) };
  }

  function defaultForm() {
    return { cuando: 'ahora', fin: 'manual', desde: '', hasta: '', viejos: true, motivo: '' };
  }

  function problem(form) {
    var now = Date.now();
    var desde = form.cuando === 'programar' ? localToIso(form.desde, ZONE) : null;
    var hasta = form.fin === 'fecha' ? localToIso(form.hasta, ZONE) : null;
    if (form.cuando === 'programar' && !desde) return 'Elige desde cuándo se apaga.';
    if (desde && Date.parse(desde) <= now) return 'El inicio debe ser en el futuro (para apagar ya, elige «Ahora»).';
    if (form.fin === 'fecha' && !hasta) return 'Elige cuándo se vuelve a encender.';
    if (hasta && Date.parse(hasta) <= now) return 'El regreso ya pasó.';
    if (hasta && desde && Date.parse(hasta) <= Date.parse(desde)) return 'El regreso debe ser después del inicio.';
    return '';
  }

  async function send(apagar) {
    var v = view();
    var form = state.form || defaultForm();
    var desde = apagar && form.cuando === 'programar' ? localToIso(form.desde, ZONE) : null;
    var hasta = apagar && form.fin === 'fecha' ? localToIso(form.hasta, ZONE) : null;
    var message;
    if (!apagar) {
      message = v.programada && !v.apagada ? '¿Cancelar el apagado programado?' :
        '¿Encender la IA ahora?\n\nVolverá a responder los mensajes nuevos de WhatsApp, Messenger e Instagram y el asistente de tu perfil público.' +
        (v.n.no_contestar_viejos ? ' Los chats que llegaron mientras estuvo apagada NO se contestarán solos: tu equipo los atiende.' : ' También responderá los mensajes que llegaron mientras estuvo apagada y siguen sin respuesta.');
    } else {
      message = '¿' + (desde ? 'Programar el apagado de' : 'Apagar ahora') + ' la IA de la clínica?\n\n' +
        (desde ? 'Se apagará el ' + pretty(desde) + '. ' : 'Dejará de responder a los pacientes en WhatsApp, Messenger e Instagram y en el asistente del perfil público. ') +
        (hasta ? 'Se encenderá sola el ' + pretty(hasta) + '.' : 'Seguirá apagada hasta que la enciendas tú.') + '\n\nTu equipo tendrá que contestar los chats a mano.';
    }
    if (!window.confirm(message)) return;
    state.busy = true; state.error = ''; render();
    try {
      var payload = { apagada: apagar };
      if (apagar) {
        payload.motivo = form.motivo || '';
        payload.no_contestar_viejos = !!form.viejos;
        if (desde) payload.desde = desde;
        if (hasta) payload.hasta = hasta;
      }
      state.data = await request('PUT', payload);
      state.editing = false; state.form = null;
      window.dispatchEvent(new CustomEvent('smyl:ia-interruptor-changed'));
    } catch (error) {
      state.error = (error && error.message) || 'No se pudo cambiar el interruptor de la IA.';
    }
    state.busy = false;
    render();
    renderBanner();
  }

  function chip(text, active, onClick) {
    var b = node('button', 'ia-sw-chip' + (active ? ' is-active' : ''), text);
    b.type = 'button';
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    if (!slot) return;
    slot.textContent = '';
    if (!state.loaded) return;
    if (!state.data) {
      if (state.error) { var e = node('p', 'ia-sw-error', state.error); e.setAttribute('role', 'alert'); slot.append(e); }
      return;
    }
    var v = view();
    var form = state.form || (state.form = defaultForm());
    var activa = v.apagada || v.programada;
    var card = node('section', 'ia-sw-card' + (v.apagada ? ' is-off' : v.programada ? ' is-scheduled' : ''));
    card.setAttribute('aria-labelledby', 'ia-sw-title');
    var head = node('div', 'ia-sw-head');
    var pill = node('span', 'ia-sw-pill', v.apagada ? 'Apagada' : v.programada ? 'Programada' : 'Encendida');
    pill.prepend(node('i', 'ia-sw-dot'));
    var title = node('h2', '', 'IA de la clínica');
    title.id = 'ia-sw-title';
    head.append(pill, title);
    var line = v.apagada
      ? (v.n.hasta ? 'Se enciende sola el ' + pretty(v.n.hasta) + ' (en ' + remaining(Date.parse(v.n.hasta) - Date.now()) + ').' : 'Sigue apagada hasta que alguien la encienda.')
      : v.programada
      ? 'Se apagará el ' + pretty(v.n.desde) + (v.n.hasta ? ' y volverá el ' + pretty(v.n.hasta) + '.' : ' y seguirá apagada hasta que alguien la encienda.')
      : 'Responde a los pacientes en WhatsApp, Messenger e Instagram y en el asistente del perfil público.';
    card.append(head, node('p', 'ia-sw-line', line));
    if (v.n.motivo && activa) card.append(node('p', 'ia-sw-reason', 'Motivo: ' + v.n.motivo));
    if (v.g.apagada) card.append(node('p', 'ia-sw-global', 'La plataforma tiene la IA apagada temporalmente para todas las clínicas.'));
    if (!v.canManage) {
      card.append(node('p', 'ia-sw-note', 'Solo el dueño o un administrador de la clínica puede cambiarlo.'));
    } else {
      if (activa) {
        var row = node('div', 'ia-sw-actions');
        var on = node('button', 'btn btn-primary', state.busy ? 'Guardando…' : (v.apagada ? 'Encender ahora' : 'Cancelar programación'));
        on.type = 'button'; on.disabled = state.busy;
        on.addEventListener('click', function () { send(false); });
        var edit = node('button', 'btn btn-secondary', state.editing ? 'Cerrar' : 'Cambiar fechas');
        edit.type = 'button';
        edit.addEventListener('click', function () {
          if (!state.editing) { form.viejos = !!v.n.no_contestar_viejos; form.motivo = v.n.motivo || ''; }
          state.editing = !state.editing; render();
        });
        row.append(on, edit);
        card.append(row);
      }
      if (!activa || state.editing) {
        var f = node('div', 'ia-sw-form');
        var g1 = node('div', 'ia-sw-group');
        g1.append(node('span', 'ia-sw-label', 'Cuándo se apaga'));
        var r1 = node('div', 'ia-sw-row');
        r1.append(chip('Ahora', form.cuando === 'ahora', function () { form.cuando = 'ahora'; render(); }));
        r1.append(chip('Programar', form.cuando === 'programar', function () { form.cuando = 'programar'; if (!form.desde) form.desde = isoToLocal(Date.now() + 3600000, ZONE); render(); }));
        if (form.cuando === 'programar') {
          var d1 = node('input'); d1.type = 'datetime-local'; d1.value = form.desde; d1.setAttribute('aria-label', 'Apagar desde');
          d1.addEventListener('input', function () { form.desde = d1.value; refreshSubmit(); });
          r1.append(d1);
        }
        g1.append(r1);
        var g2 = node('div', 'ia-sw-group');
        g2.append(node('span', 'ia-sw-label', 'Hasta cuándo'));
        var r2 = node('div', 'ia-sw-row');
        r2.append(chip('Hasta que yo la encienda', form.fin === 'manual', function () { form.fin = 'manual'; render(); }));
        r2.append(chip('Fecha y hora', form.fin === 'fecha', function () { form.fin = 'fecha'; if (!form.hasta) form.hasta = isoToLocal(Date.now() + 24 * 3600000, ZONE); render(); }));
        if (form.fin === 'fecha') {
          var d2 = node('input'); d2.type = 'datetime-local'; d2.value = form.hasta; d2.setAttribute('aria-label', 'Encender sola el');
          d2.addEventListener('input', function () { form.hasta = d2.value; refreshSubmit(); });
          r2.append(d2);
        }
        g2.append(r2);
        var lab = node('label', 'ia-sw-check');
        var cb = node('input'); cb.type = 'checkbox'; cb.checked = !!form.viejos;
        cb.addEventListener('change', function () { form.viejos = cb.checked; });
        lab.append(cb, node('span', '', 'Al volver, no contestar los chats que llegaron mientras estuvo apagada (tu equipo los atiende). Si el paciente escribe de nuevo, la IA sí responde.'));
        var motivo = node('input', 'ia-sw-reason-input'); motivo.type = 'text'; motivo.maxLength = 300;
        motivo.placeholder = 'Motivo (opcional), p. ej. vacaciones del equipo'; motivo.setAttribute('aria-label', 'Motivo (opcional)'); motivo.value = form.motivo;
        motivo.addEventListener('input', function () { form.motivo = motivo.value; });
        var zone = node('p', 'ia-sw-zone', 'Zona horaria: ' + ZONE.replace('_', ' ') + '.');
        var msg = node('p', 'ia-sw-error'); msg.setAttribute('role', 'alert');
        var submit = node('button', 'btn btn-primary ia-sw-submit', state.busy ? 'Guardando…' : (form.cuando === 'programar' ? 'Programar apagado' : 'Apagar la IA'));
        submit.type = 'button';
        function refreshSubmit() {
          var p = problem(form);
          msg.textContent = p;
          submit.disabled = state.busy || !!p;
        }
        submit.addEventListener('click', function () { send(true); });
        f.append(g1, g2, lab, motivo, zone, msg, submit);
        card.append(f);
        refreshSubmit();
      }
    }
    if (state.error) { var err = node('p', 'ia-sw-error', state.error); err.setAttribute('role', 'alert'); card.append(err); }
    slot.append(card);
  }

  // ── Franja roja en el inicio mientras la IA está apagada ──
  function renderBanner() {
    var home = document.getElementById('p-dashboard');
    if (!home) return;
    var existing = document.getElementById('ia-sw-banner');
    var v = state.data ? view() : null;
    var off = v && (v.apagada || v.g.apagada);
    if (!off) { if (existing) existing.remove(); return; }
    var text = (v.g.apagada && !v.apagada ? 'La IA está apagada temporalmente para todas las clínicas' : 'La IA de tu clínica está apagada') +
      (v.apagada && v.n.hasta ? ' hasta el ' + pretty(v.n.hasta) : '') +
      ': no responde a los pacientes ni en el asistente del perfil público. Tu equipo debe contestar los chats a mano.';
    if (!existing) {
      existing = node('div', 'ia-sw-banner');
      existing.id = 'ia-sw-banner';
      existing.setAttribute('role', 'alert');
      home.prepend(existing);
    }
    existing.textContent = '🛑 ' + text;
  }

  function mount(target) {
    if (!target || target.dataset.iaSwMounted === '1') { if (target) { slot = target; render(); } return; }
    target.dataset.iaSwMounted = '1';
    slot = target;
    load();
  }

  function init() {
    var existing = document.querySelector('[data-ia-interruptor-slot]');
    if (existing) mount(existing);
    var previous = window.ir;
    if (typeof previous === 'function') {
      window.ir = function (route) {
        previous.apply(this, arguments);
        if (route === 'conexiones' || route === 'dashboard') load();
      };
    }
    if (!timer) timer = setInterval(function () { if (document.visibilityState === 'visible' && state.loaded) load(); }, 60000);
    window.addEventListener('smyl:inbox-access', function () { load(); });
  }

  // Resumen para otras pantallas (barra del asistente): sin datos internos, solo lo que se muestra.
  function summary() {
    if (!state.loaded || !state.data) return { loaded: state.loaded, available: false };
    var v = view();
    return { loaded: true, available: true, apagada: v.apagada, programada: v.programada, canManage: v.canManage, hasta: v.n.hasta || null, hastaTexto: v.apagada && v.n.hasta ? pretty(v.n.hasta) : '' };
  }

  window.SmylIaInterruptor = { mount: mount, load: load, summary: summary, _localToIso: localToIso };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
