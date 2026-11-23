/* SMYL · Pagos en línea (Openpay vía LANA). Configuración → Finanzas → «Pagos en línea».
   La clínica conecta SU cuenta Openpay a su cuenta de LANA sin entrar al panel de LANA (task-id smyl-openpay-config).
   - Todo pasa por la función smyl-pay (acciones openpay_*). Las llaves viajan solo hacia LANA, que las verifica con Openpay;
     nunca se guardan en SMYL ni vuelven al navegador (solo se muestran los últimos 4 del ID de comercio).
   - Consultar: quien puede cobrar. Conectar, cambiar métodos y desconectar: solo el dueño (el servidor lo vuelve a exigir).
   - El modo (pruebas/producción) lo decide LANA; aquí solo se muestra. Paynet (efectivo en tiendas) sí; meses sin intereses aún no.
   - Por pedido de Ricardo, la pantalla SÍ nombra a LANA: Openpay validó a LANA como plataforma y SMYL usa su pasarela como
     aplicación externa. Es la única excepción a la marca blanca (ver tests/smyl-branding-isolation.test.mjs). */
(function () {
  'use strict';
  var state = { loading: false, data: null, owner: false, error: '', busy: false, showKey: false };

  // Íconos de trazo (sin emojis), mismo estilo que el resto de SMYL.
  var ICONS = {
    card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
    bank: '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>',
    store: '<svg viewBox="0 0 24 24"><path d="M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    receipt: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>'
  };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(text, cls, fn) { var b = el('button', cls || 'btn btn-secondary', text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }

  // Diagnóstico visible: si el servidor no devuelve un error legible, se muestra el código HTTP y lo que respondió,
  // en lugar de un mensaje genérico que esconde la causa (las llaves nunca forman parte de este texto).
  var ACTION_LABEL = { openpay_status: 'consultar', openpay_connect: 'conectar', openpay_methods: 'guardar los métodos', openpay_disconnect: 'desconectar' };
  async function call(action, extra) {
    if (!window.sb || !window.sb.functions) throw new Error('Sin conexión con SMYL.');
    var res = await window.sb.functions.invoke('smyl-pay', { body: Object.assign({ action: action }, extra || {}) });
    var data = res && res.data, err = res && res.error, detail = '';
    if (err) {
      var ctx = err.context, status = ctx && typeof ctx.status === 'number' ? ctx.status : 0;
      if (ctx && typeof ctx.text === 'function') {
        try { var raw = await ctx.text(); try { data = JSON.parse(raw); } catch (e) { detail = String(raw || '').replace(/\s+/g, ' ').slice(0, 160); } } catch (e) {}
      }
      if (!data || !data.error) detail = (status ? 'HTTP ' + status + ' · ' : '') + (detail || String(err.message || err.name || 'sin respuesta'));
    } else if (typeof data === 'string') {
      detail = 'respuesta inesperada: ' + data.replace(/\s+/g, ' ').slice(0, 160); data = null;
    }
    if (data && data.error) throw new Error(data.error);
    if (!data || !data.openpay) throw new Error('No se pudo ' + (ACTION_LABEL[action] || 'completar') + ' Openpay' + (detail ? ' (' + detail + ')' : '') + '. Si se repite, manda una captura de este mensaje.');
    return data;
  }

  function holder() {
    var sec = document.getElementById('online-pay-setup');
    if (sec) return sec;
    var h = el('div', ''); h.id = 'online-pay-setup-holder'; h.hidden = true;
    sec = el('section', 'online-pay'); sec.id = 'online-pay-setup';
    h.append(sec); document.body.append(h);
    return sec;
  }

  function switchRow(icon, title, desc, checked, disabled, onChange, note) {
    var row = el('label', 'online-pay-method' + (disabled ? ' is-disabled' : ''));
    var ic = el('span', 'online-pay-method-icon'); ic.setAttribute('aria-hidden', 'true'); ic.innerHTML = ICONS[icon] || '';
    var copy = el('span', 'online-pay-method-copy'); copy.append(el('strong', '', title), el('small', '', desc));
    var side = el('span', 'online-pay-method-side');
    var input = el('input'); input.type = 'checkbox'; input.className = 'online-pay-switch'; input.checked = !!checked; input.disabled = !!disabled;
    input.setAttribute('aria-label', title);
    if (onChange) input.addEventListener('change', function () { onChange(input.checked, input); });
    side.append(input, el('small', 'online-pay-method-state', note || (checked ? 'Visible' : 'Oculto')));
    row.append(ic, copy, side);
    return row;
  }

  function field(label, name, placeholder, secret) {
    var wrap = el('label', 'online-pay-field'); wrap.append(el('span', '', label));
    var box = el('span', 'online-pay-input');
    var input = el('input'); input.name = name; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = placeholder;
    input.type = secret && !state.showKey ? 'password' : 'text';
    box.append(input);
    if (secret) box.append(btn(state.showKey ? 'Ocultar' : 'Mostrar', 'online-pay-reveal', function () { state.showKey = !state.showKey; input.type = state.showKey ? 'text' : 'password'; this.textContent = state.showKey ? 'Ocultar' : 'Mostrar'; }));
    wrap.append(box);
    return wrap;
  }

  function notice(text, tone) { var n = el('p', 'online-pay-notice', text); if (tone) n.dataset.tone = tone; n.setAttribute('role', tone === 'error' ? 'alert' : 'status'); return n; }

  async function run(action, extra, okText) {
    if (state.busy) return;
    state.busy = true; state.error = ''; state.flash = ''; render();
    try { var r = await call(action, extra); state.data = r.openpay; state.owner = !!r.owner; state.flash = okText || ''; state.showKey = false; }
    catch (e) { state.error = String(e && e.message || e); }
    finally { state.busy = false; render(); }
  }

  function credentialsForm(connected) {
    var form = el('form', 'online-pay-credentials'); form.noValidate = true;
    var hint = connected ? 'Ya configurado — escribe uno nuevo para reemplazarlo' : '';
    form.append(
      field('ID de comercio', 'merchant_id', connected ? hint : 'Ej. mzdtln0bmtms6o3kck8f', false),
      el('small', 'online-pay-help', 'Identifica tu cuenta de Openpay.')
    );
    var pair = el('div', 'online-pay-pair');
    pair.append(field('Llave pública', 'public_key', connected ? 'Ya configurada — escribe una nueva' : 'pk_…', false), field('Llave privada', 'private_key', connected ? 'Ya configurada — escribe una nueva' : 'sk_…', true));
    form.append(pair);
    var actions = el('div', 'online-pay-actions');
    if (connected) actions.append(btn('Desconectar', 'btn online-pay-danger', function () {
      if (!confirm('¿Desconectar Openpay? Se borran las llaves y el botón «Enlace de pago» deja de aparecer. Los enlaces ya enviados no se podrán pagar.')) return;
      run('openpay_disconnect', {}, 'Openpay quedó desconectado.');
    }));
    var submit = el('button', 'btn btn-primary', state.busy ? 'Verificando con Openpay…' : (connected ? 'Actualizar credenciales' : 'Conectar Openpay')); submit.type = 'submit'; submit.disabled = state.busy;
    actions.append(submit); form.append(actions);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = new FormData(form), body = { merchant_id: String(f.get('merchant_id') || '').trim(), public_key: String(f.get('public_key') || '').trim(), private_key: String(f.get('private_key') || '').trim() };
      if (!body.merchant_id || !body.public_key || !body.private_key) { state.error = 'Escribe el ID de comercio, la llave pública y la llave privada.'; render(); return; }
      run('openpay_connect', body, 'Openpay quedó conectado. Ya puedes mandar enlaces de pago.');
    });
    return form;
  }

  function iconEl(name, cls) { var i = el('span', cls || 'online-pay-flow-icon'); i.setAttribute('aria-hidden', 'true'); i.innerHTML = ICONS[name] || ''; return i; }

  // Cómo funciona: quién hace qué. Openpay validó a LANA como plataforma de pagos; SMYL la usa como aplicación externa.
  function howItWorks() {
    var sec = el('section', 'online-pay-card online-pay-how');
    sec.append(el('h3', '', 'Cómo funciona'));
    var flow = el('ol', 'online-pay-flow');
    [['phone', 'Tu paciente paga', 'Con tarjeta, transferencia SPEI o efectivo en tienda, desde el enlace que le mandas.'],
     ['link', 'LANA procesa el cobro', 'La pasarela de LANA, validada por Openpay, cobra con TU cuenta Openpay.'],
     ['receipt', 'SMYL registra el pago', 'Al confirmarse, el pago se aplica a la cuenta del paciente y se emite el recibo.']
    ].forEach(function (s, i) {
      var li = el('li', 'online-pay-flow-step');
      var txt = el('span', ''); txt.append(el('strong', '', (i + 1) + '. ' + s[1]), el('small', '', s[2]));
      li.append(iconEl(s[0]), txt); flow.append(li);
    });
    sec.append(flow);
    var note = el('p', 'online-pay-provider');
    note.append(iconEl('shield', 'online-pay-provider-icon'), el('span', '', 'Openpay opera en SMYL a través de LANA como aplicación externa: Openpay validó a LANA como plataforma de pagos y SMYL usa esa integración. El dinero llega directo a la cuenta Openpay de tu clínica; ni SMYL ni LANA lo retienen.'));
    sec.append(note);
    return sec;
  }

  function summary(d) {
    var box = el('dl', 'online-pay-summary');
    var activos = [d.methods.card && 'Tarjeta', d.methods.spei && 'SPEI', d.methods.paynet && 'Tiendas'].filter(Boolean);
    [['Comercio', d.merchant_id_hint || '—'], ['Modo', d.mode === 'production' ? 'Producción' : 'Pruebas'], ['Métodos visibles', activos.length ? activos.join(' · ') : 'Ninguno'], ['Procesado por', 'LANA · Openpay']].forEach(function (r) {
      var item = el('div', ''); item.append(el('dt', '', r[0]), el('dd', '', r[1])); box.append(item);
    });
    return box;
  }

  function render() {
    var root = holder(); root.replaceChildren();
    var d = state.data, connected = !!(d && d.connected), test = !d || d.mode !== 'production';
    var head = el('header', 'online-pay-head');
    var copy = el('div', ''); copy.append(el('span', 'pro-eyebrow', 'PAGOS EN LÍNEA · OPENPAY'), el('h2', '', connected ? 'Openpay conectado' : 'Conecta tu cuenta Openpay'), el('p', '', 'Cobra con un enlace: tus pacientes pagan con tarjeta, transferencia SPEI o efectivo en tiendas, y SMYL registra el pago y emite el recibo en cuanto se confirma.'));
    var chip = el('span', 'online-pay-chip', state.loading ? 'Consultando…' : connected ? (d.active ? 'Activo' : 'En pausa') + ' · ' + (test ? 'modo pruebas' : 'producción') : 'No conectado');
    chip.dataset.state = connected ? (d.active ? 'on' : 'paused') : 'off';
    head.append(copy, chip); root.append(head);

    if (state.error) root.append(notice(state.error, 'error'));
    if (state.flash) root.append(notice(state.flash, 'success'));
    if (state.loading) { root.append(notice('Consultando el estado de Openpay…')); return; }
    if (!d) { root.append(btn('Volver a intentar', 'btn btn-secondary', load)); return; }

    if (test) root.append(notice('Modo pruebas: los cobros no son reales. Usa las llaves del panel sandbox de Openpay (sandbox-dashboard.openpay.mx). El cambio a producción lo activa el equipo de soporte de SMYL cuando lo pidas.', 'info'));
    if (!state.owner) root.append(notice('Solo el dueño de la clínica puede conectar o cambiar Openpay. Aquí puedes consultar el estado.', 'info'));

    if (connected) {
      root.append(summary(d));
      var status = el('p', 'online-pay-merchant', d.active ? 'El botón «Enlace de pago» aparece en Cobrar, en la cuenta del paciente y al iniciar un tratamiento.' : 'En pausa: no se pueden generar enlaces nuevos. Los que ya enviaste siguen funcionando.');
      root.append(status);
      var methods = el('section', 'online-pay-card');
      methods.append(el('h3', '', 'Métodos disponibles'), el('p', 'online-pay-help', 'Activa únicamente las formas de pago que quieres ofrecer.'));
      var list = el('div', 'online-pay-methods');
      var lock = !state.owner || state.busy;
      list.append(
        switchRow('card', 'Tarjeta', 'Crédito y débito con tokenización segura y 3D Secure', d.methods.card, lock, function (v) { run('openpay_methods', { card: v }, v ? 'Tarjeta visible para tus pacientes.' : 'Tarjeta oculta.'); }),
        switchRow('bank', 'Transferencia SPEI', 'CLABE única por pago y conciliación automática', d.methods.spei, lock, function (v) { run('openpay_methods', { spei: v }, v ? 'SPEI visible para tus pacientes.' : 'SPEI oculto.'); }),
        switchRow('store', 'Efectivo en tiendas Paynet', 'Referencia y código de barras para pagar en 7-Eleven, farmacias y supermercados afiliados. Se acredita cuando el paciente paga (hasta 3 días).', d.methods.paynet, lock, function (v) { run('openpay_methods', { paynet: v }, v ? 'Efectivo en tiendas visible para tus pacientes.' : 'Efectivo en tiendas oculto.'); })
      );
      methods.append(list); root.append(methods);
      var msi = el('section', 'online-pay-card');
      msi.append(switchRow('calendar', 'Meses sin intereses', 'Próximamente: plazos con tarjetas de crédito participantes.', false, true, null, 'Próximamente'));
      root.append(msi);
      var pause = el('section', 'online-pay-card');
      pause.append(switchRow('pause', 'Cobro en línea activo', 'Si lo pausas, no se generan enlaces nuevos; tus llaves se conservan.', d.active, lock, function (v) { run('openpay_methods', { active: v }, v ? 'Cobro en línea activo.' : 'Cobro en línea en pausa.'); }, d.active ? 'Activo' : 'En pausa'));
      root.append(pause);
      root.append(howItWorks());
    } else {
      root.append(howItWorks());
      var steps = el('ol', 'online-pay-steps');
      ['Entra a tu panel de Openpay (en pruebas: sandbox-dashboard.openpay.mx).', 'Ve a Configuración → Llaves de API y copia el ID de comercio, la llave pública (pk_…) y la llave privada (sk_…).', 'Pégalas aquí y pulsa «Conectar Openpay». Las verificamos con Openpay antes de guardarlas.'].forEach(function (t) { steps.append(el('li', '', t)); });
      root.append(steps);
    }

    if (state.owner) {
      var creds = el('details', 'online-pay-card online-pay-secure'); creds.open = !connected;
      creds.append(el('summary', '', 'Credenciales y seguridad'));
      creds.append(notice('Las llaves se guardan en un almacén privado del servidor de pagos, que solo el servidor puede leer, y nunca vuelven a mostrarse en pantalla.', 'info'), credentialsForm(connected));
      root.append(creds);
    }
  }

  async function load() {
    if (state.loading) return;
    state.loading = true; state.error = ''; render();
    try { var r = await call('openpay_status'); state.data = r.openpay; state.owner = !!r.owner; }
    catch (e) { state.error = String(e && e.message || e); state.data = null; }
    finally { state.loading = false; render(); }
  }

  holder();
  window.SmylOnlinePay = Object.freeze({ ensure: function () { state.flash = ''; return load(); } });
})();
