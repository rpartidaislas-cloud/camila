/* SMYL · Configuración: espacio administrativo por tarea.
   La interfaz organiza accesos existentes; no duplica pantallas, no cambia datos y no maneja credenciales. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.SmylSettingsHub = factory(root);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var STORE_KEY = 'smyl_settings_section';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Los grupos crean separación visual sin inventar nuevas pantallas ni fuentes de datos.
  var SECTIONS = [
    { id: 'clinica', title: 'Clínica', blurb: 'Identidad, sedes y experiencia del paciente.', icon: 'clinic', items: [
      { title: 'Datos de la clínica', desc: 'Nombre, doctor o doctora titular y ciudad.', group: 'Identidad', icon: 'clinic', action: 'Editar', route: 'mi-consultorio', ownerOnly: true },
      { title: 'Sucursales y espacios', desc: 'Direcciones, consultorios y horarios por sede.', group: 'Operación', icon: 'location', action: 'Administrar', route: 'clinica', embed: true, target: '[data-ca-tab="operacion"]', check: 'hours' },
      { title: 'Modalidad de compras', desc: 'Elige si las sucursales compran a proveedores o solicitan insumos al centro.', group: 'Operación', icon: 'inventory', action: 'Configurar', route: 'inventario', target: '#inventory-purchasing-settings' },
      { title: 'Marca y experiencia', desc: 'Nombre, colores y mensajes que ven tus pacientes.', group: 'Presencia', icon: 'sparkles', action: 'Personalizar', route: 'sim-config' },
      { title: 'Directorio profesional', desc: 'Perfil público para recibir solicitudes de cita.', group: 'Presencia', icon: 'profile', action: 'Editar perfil', route: 'directorio' }
    ] },
    { id: 'equipo', title: 'Equipo', blurb: 'Personas, invitaciones y permisos.', icon: 'team', items: [
      { title: 'Integrantes', desc: 'Invita personas y administra su acceso a la clínica.', group: 'Personas', icon: 'team', action: 'Administrar', route: 'clinica', embed: true, target: '[data-ca-team-view="people"]' },
      { title: 'Roles y permisos', desc: 'Define qué puede consultar y hacer cada rol.', group: 'Acceso', icon: 'security', action: 'Configurar', route: 'clinica', embed: true, target: '[data-ca-team-view="roles"]' }
    ] },
    { id: 'agenda', title: 'Agenda', blurb: 'Quién atiende, calendarios y avisos al paciente.', icon: 'calendar', items: [
      { title: 'Profesionales', desc: 'Define quién atiende, sus sedes y preparación para recibir citas.', group: 'Disponibilidad', icon: 'team', action: 'Administrar', route: 'clinica', embed: true, target: '[data-ca-team-view="professionals"]' },
      { title: 'Google Calendar', desc: 'Sincroniza el calendario profesional y revisa cambios.', group: 'Calendarios', icon: 'sync', action: 'Administrar', route: 'agenda', target: '#schedule-google-calendar' },
      { title: 'Avisos de cita', desc: 'Plantilla que se ofrece al confirmar, reprogramar o cancelar.', group: 'Avisos al paciente', icon: 'calendar', action: 'Configurar', route: 'avisos-cita' },
      { title: 'Recordatorios de cita', desc: 'Aviso automático antes de cada cita.', group: 'Avisos al paciente', icon: 'bell', action: 'Configurar', route: 'agenda', embed: true, element: '#schedule-reminders-card', check: 'reminders' }
    ] },
    { id: 'catalogo', title: 'Catálogo', blurb: 'Servicios, precios y materiales.', icon: 'catalog', items: [
      { title: 'Servicios y tarifas', desc: 'Tratamientos, duración, precios y datos fiscales.', group: 'Atención', icon: 'service', action: 'Administrar', route: 'precios', check: 'services' },
      { title: 'Materiales e inventario', desc: 'Existencias, compras y material por tratamiento.', group: 'Operación', icon: 'inventory', action: 'Abrir', route: 'inventario' }
    ] },
    { id: 'canales', title: 'Canales', blurb: 'Administra las cuentas y los mensajes de tu clínica.', icon: 'channels', items: [
      { title: 'WhatsApp Business', desc: 'Número de la clínica', group: 'Cuentas de mensajería', icon: 'whatsapp', channel: 'whatsapp', route: 'conexiones', target: '[data-connection-tab="whatsapp"]', check: 'whatsapp' },
      { title: 'Messenger', desc: 'Página de Facebook', group: 'Cuentas de mensajería', icon: 'messenger', channel: 'messenger', route: 'conexiones', target: '[data-connection-tab="messenger"]' },
      { title: 'Instagram', desc: 'Cuenta profesional', group: 'Cuentas de mensajería', icon: 'instagram', channel: 'instagram', route: 'conexiones', target: '[data-connection-tab="instagram"]' },
      { title: 'SMYL Asistente', desc: 'Información de la clínica, tono y respuestas.', group: 'Asistente', icon: 'bot', action: 'Configurar', route: 'conexiones', target: '[data-connection-tab="assistant"]' },
      { title: 'Plantillas de WhatsApp', desc: 'Textos aprobados para enviar a pacientes.', group: 'Plantillas y reglas', icon: 'template', action: 'Administrar', route: 'plantillas', check: 'template' },
      { title: 'Reglas del asistente', desc: 'Cuándo responde SMYL y cuándo pasa el chat a una persona.', group: 'Plantillas y reglas', icon: 'automation', action: 'Configurar', route: 'conexiones', target: '[data-connection-tab="automations"]' }
    ] },
    { id: 'cobros', title: 'Finanzas', blurb: 'Cuentas, pagos, caja y facturación.', icon: 'payments', items: [
      { title: 'Facturación', desc: 'Datos fiscales de la clínica y conexión con Facturapi.', group: 'Facturación y reglas', icon: 'template', action: 'Configurar', route: 'caja', embed: true, element: '#billing-setup', ensure: 'billing' },
      { title: 'Pagos en línea (Openpay)', desc: 'Conecta tu cuenta Openpay para cobrar con enlace: tarjeta y SPEI.', group: 'Facturación y reglas', icon: 'payments', action: 'Configurar', route: 'caja', embed: true, element: '#online-pay-setup', ensure: 'online-pay' }
    ] },
    { id: 'cuenta', title: 'Cuenta y seguridad', blurb: 'Plan, protección y preparación operativa.', icon: 'security', items: [
      { title: 'Plan y suscripción', desc: 'Tu plan, cambios de plan y pago de la suscripción.', group: 'Suscripción', icon: 'plan', action: 'Consultar', route: 'plan', ownerOnly: true },
      { title: 'Almacenamiento', desc: 'Espacio usado por fotos, radiografías y documentos.', group: 'Suscripción', icon: 'plan', action: 'Consultar', route: 'almacenamiento' },
      { title: 'Seguridad', desc: 'Accesos, señales y revisiones de la cuenta.', group: 'Protección', icon: 'security', action: 'Revisar', route: 'seguridad' },
      { title: 'Cumplimiento sanitario', desc: 'Bitácoras y carpeta para una visita de COFEPRIS.', group: 'Protección', icon: 'security', action: 'Abrir', route: 'cumplimiento' },
      { title: 'Preparación operativa', desc: 'Controles pendientes antes de atender pacientes.', group: 'Protección', icon: 'launch', action: 'Revisar', route: 'lanzamiento' }
    ] }
  ];

  var ICONS = {
    settings: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
    clinic: ['M3 21h18', 'M6 21V3h12v18', 'M9 7h.01M9 11h.01M9 15h.01M15 7h.01M15 11h.01M15 15h.01'],
    team: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    calendar: ['M3 5h18v16H3z', 'M16 3v4M8 3v4M3 11h18'],
    catalog: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
    channels: ['M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z'],
    payments: ['M3 6h18v14H3z', 'M3 10h18', 'M7 15h4'],
    security: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
    location: ['M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z', 'M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
    sparkles: ['M12 3l1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2z', 'M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8z', 'M19 14l.6 1.4L21 16l-1.4.6L19 18l-.6-1.4L17 16l1.4-.6z'],
    profile: ['M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
    clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 6v6l4 2'],
    sync: ['M20 7h-5V2', 'M20 7a9 9 0 0 0-15.5-3', 'M4 17h5v5', 'M4 17a9 9 0 0 0 15.5 3'],
    check: ['M21 11.5a9 9 0 1 1-5.3-8.2', 'M21 4l-10 10-3-3'],
    bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
    service: ['M12 2v20M2 12h20', 'M5 5l14 14M19 5L5 19'],
    inventory: ['M21 8l-9 5-9-5 9-5z', 'M3 8v8l9 5 9-5V8', 'M12 13v8'],
    bot: ['M5 8h14v11H5z', 'M9 12h.01M15 12h.01', 'M9 16h6', 'M12 8V5', 'M10 3h4'],
    template: ['M6 2h9l5 5v15H6z', 'M14 2v6h6', 'M9 13h6M9 17h6'],
    automation: ['M13 2L4 14h7l-1 8 9-12h-7z'],
    lab: ['M9 3h6', 'M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3', 'M8 15h8'],
    cash: ['M3 7h18v12H3z', 'M7 11h.01M17 15h.01', 'M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
    plan: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
    launch: ['M5 16c-1 1-2 4-2 5 1 0 4-1 5-2', 'M9 15l-3-3 8-8c3-3 6-2 7-2 0 1 1 4-2 7l-8 8-3-3', 'M14 7l3 3']
  };

  function status(check, results, services) {
    if (check === 'services') return services == null ? null : services > 0 ? { text: services + (services === 1 ? ' activo' : ' activos'), tone: 'ok' } : { text: 'Sin servicios', tone: 'todo' };
    var result = results && results[check];
    if (!result || result.unknown) return null;
    if (check === 'hours') return result.done ? { text: 'Horario listo', tone: 'ok' } : { text: 'Falta el horario', tone: 'todo' };
    if (check === 'whatsapp') return result.done ? { text: 'Conectado', tone: 'ok' } : { text: 'Sin conectar', tone: 'todo' };
    if (check === 'template') return result.done ? { text: 'Aprobada', tone: 'ok' } : result.waiting ? { text: 'En revisión', tone: 'wait' } : { text: 'Sin plantilla', tone: 'todo' };
    if (check === 'reminders') return result.done ? { text: 'Activos', tone: 'ok' } : { text: 'Apagados', tone: 'todo' };
    return null;
  }

  function pendingCount(section, results, services) {
    return section.items.filter(function (item) { var itemStatus = item.check && status(item.check, results, services); return itemStatus && itemStatus.tone === 'todo'; }).length;
  }

  function groupedItems(section) {
    var groups = [];
    section.items.forEach(function (item) {
      // Lo que es solo del dueño (plan y pagos) no se muestra al resto del equipo.
      if (item.ownerOnly && typeof window !== 'undefined' && window.miRolEquipo && window.miRolEquipo !== 'dueño') return;
      var name = item.group || 'Ajustes';
      var current = groups.filter(function (group) { return group.name === name; })[0];
      if (!current) { current = { name: name, items: [] }; groups.push(current); }
      current.items.push(item);
    });
    return groups;
  }

  function el(tag, cls, text) { var node = document.createElement(tag); if (cls) node.className = cls; if (text != null) node.textContent = text; return node; }
  function read() { try { return win.localStorage.getItem(STORE_KEY); } catch (_) { return null; } }
  function save(value) { try { win.localStorage.setItem(STORE_KEY, value); } catch (_) {} }

  function icon(name, cls) {
    var wrap = el('span', cls || 'settings-hub-icon');
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (ICONS[name] || ICONS.settings).forEach(function (data) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', data);
      svg.append(path);
    });
    wrap.append(svg);
    return wrap;
  }

  function mount() {
    var state = { section: read() || 'clinica', services: null, loadedAt: 0, from: '', detail: null };
    if (!SECTIONS.some(function (section) { return section.id === state.section; })) state.section = 'clinica';
    var page = el('section', 'pantalla settings-hub'); page.id = 'p-configuracion';
    var layout = el('div', 'settings-hub-layout');
    var aside = el('aside', 'settings-hub-aside');
    var navLabel = el('span', 'settings-hub-nav-label', 'AJUSTES');
    var nav = el('nav', 'settings-hub-nav'); nav.setAttribute('aria-label', 'Secciones de configuración');
    var picker = el('label', 'settings-hub-picker');
    var pickerSelect = el('select', 'settings-hub-picker-select'); pickerSelect.setAttribute('aria-label', 'Área de configuración');
    SECTIONS.forEach(function (section) { var option = el('option', '', section.title); option.value = section.id; pickerSelect.append(option); });
    picker.append(icon('settings', 'settings-hub-picker-icon'), pickerSelect);
    pickerSelect.addEventListener('change', function () { restoreDetail(); state.section = pickerSelect.value; save(state.section); render(); });
    var panel = el('section', 'settings-hub-panel'); panel.setAttribute('aria-live', 'polite');
    aside.append(navLabel, picker, nav); layout.append(aside, panel); page.append(layout);
    document.querySelector('.contenido').append(page);

    function results() { var setup = win.SmylClinicSetup; return setup && typeof setup.results === 'function' ? setup.results() : null; }
    function detailNode(item) { return item.element ? document.querySelector(item.element) : document.getElementById('p-' + item.route); }

    function restoreDetail() {
      var detail = state.detail; if (!detail) return;
      state.detail = null;
      if (detail.page) detail.node.classList.remove('activa');
      if (detail.mark.parentNode) { detail.mark.parentNode.insertBefore(detail.node, detail.mark); detail.mark.remove(); }
    }

    function openDetail(item) {
      restoreDetail();
      state.from = '';
      if (!item.element) win.ir(item.route);
      var node = detailNode(item);
      if (!node) return go(item);
      var mark = document.createComment('settings-hub');
      node.parentNode.insertBefore(mark, node);
      state.detail = { item: item, node: node, mark: mark, page: !item.element };
      win.ir('configuracion');
      if (item.ensure === 'online-pay' && win.SmylOnlinePay && typeof win.SmylOnlinePay.ensure === 'function') Promise.resolve(win.SmylOnlinePay.ensure()).catch(function () {});
      if (item.ensure === 'billing' && win.SmylFinance && typeof win.SmylFinance.ensureBilling === 'function') Promise.resolve(win.SmylFinance.ensureBilling()).catch(function () {});
      if (item.element && win.SmylReminders && typeof win.SmylReminders.reload === 'function') Promise.resolve(win.SmylReminders.reload()).catch(function () {});
      if (item.target) {
        var tries = 0;
        (function ready() {
          var tab = node.querySelector(item.target);
          if (tab) return tab.click();
          if (tries++ < 80) setTimeout(ready, 50);
        })();
      }
    }

    function renderDetail(current) {
      var detail = state.detail;
      panel.classList.add('settings-hub-panel--detail');
      var bar = el('header', 'settings-hub-detail-bar');
      var back = el('button', 'settings-hub-detail-back'); back.type = 'button';
      back.append(el('span', '', '←'), document.createTextNode(' ' + current.title));
      back.addEventListener('click', function () { restoreDetail(); render(); });
      var heading = el('div', 'settings-hub-detail-heading');
      heading.append(icon(detail.item.icon || current.icon, 'settings-hub-panel-icon'));
      var copy = el('div', 'settings-hub-detail-copy');
      copy.append(el('h1', '', detail.item.title), el('p', '', detail.item.desc));
      heading.append(copy); bar.append(back, heading);
      var host = el('div', 'settings-hub-embed');
      panel.append(bar, host); host.append(detail.node);
      if (detail.page) detail.node.classList.add('activa');
    }

    function go(item) {
      if (item.soon || !item.route) return;
      state.from = item.route;
      win.ir(item.route);
      if (item.target) {
        var tries = 0;
        (function ready() {
          var tab = document.querySelector('.pantalla.activa ' + item.target) || document.querySelector(item.target);
          if (tab) return tab.click();
          if (tries++ < 80) setTimeout(ready, 50);
        })();
      }
    }

    function actionLabel(item, itemStatus) {
      if (item.check === 'whatsapp' && itemStatus && itemStatus.tone === 'todo') return 'Conectar';
      if (item.check === 'reminders' && itemStatus && itemStatus.tone === 'todo') return 'Activar';
      if (item.check === 'services' && itemStatus && itemStatus.tone === 'todo') return 'Configurar';
      return item.action || 'Abrir';
    }

    // Las cuentas abren la misma pestaña de conexión que el resto de la aplicación.
    var channelView = null;
    function accountButton(item) {
      var button = el('button', 'settings-account');
      button.type = 'button'; button.dataset.account = item.channel;
      var logo = el('img', 'settings-account-logo');
      logo.alt = ''; logo.width = 42; logo.height = 42; logo.src = 'icons/brands/' + item.channel + '.svg';
      var identity = el('span', 'settings-account-id');
      var name = el('small', 'settings-account-name', item.desc); name.dataset.fallback = item.desc;
      identity.append(el('strong', '', item.title), name);
      var stateText = el('span', 'settings-account-status', 'Sin verificar');
      var action = el('span', 'settings-account-action', 'Ver canal');
      button.append(logo, identity, stateText, action);
      button.addEventListener('click', function () { go(item); });
      return button;
    }

    function paintAccounts(view) {
      if (channelView !== view || view.tenant !== win.tenantId || view.actor !== win.miUsuario?.id) return;
      var accounts = view.overview?.accounts || {};
      panel.querySelectorAll('[data-account]').forEach(function (button) {
        var id = button.dataset.account, account = accounts[id];
        var name = button.querySelector('.settings-account-name');
        name.textContent = account?.name || name.dataset.fallback;
        button.dataset.state = account ? (account.connected ? 'connected' : 'disconnected') : 'unknown';
        button.querySelector('.settings-account-status').textContent = account ? (account.connected ? 'Conectada' : 'Sin conectar') : view.loading ? 'Consultando…' : 'Sin verificar';
        button.querySelector('.settings-account-action').textContent = account && view.overview.canManage ? (account.connected ? 'Administrar' : 'Conectar') : 'Ver canal';
      });
      var count = panel.querySelector('.settings-account-count');
      if (!count) return;
      var known = Object.values(accounts);
      count.textContent = known.length === 3 ? (known.filter(function (a) { return a.connected; }).length + ' de 3 conectadas') : '';
      var retry = panel.querySelector('.settings-accounts-retry');
      retry.hidden = !view.error;
    }

    function loadAccounts() {
      var tenant = win.tenantId, actor = win.miUsuario?.id;
      if (channelView && channelView.tenant === tenant && channelView.actor === actor) { paintAccounts(channelView); return; }
      var view = { tenant:tenant, actor:actor, loading:true };
      channelView = view;
      paintAccounts(view);
      Promise.resolve().then(function () { return win.SmylClinicSetup.readChannels(); }).then(function (overview) {
        view.overview = overview;
      }).catch(function () { view.error = true; }).finally(function () { view.loading = false; paintAccounts(view); });
    }

    function row(item, current) {
      var itemStatus = item.check ? status(item.check, results(), state.services) : null;
      var node = el(item.soon ? 'div' : 'button', 'settings-hub-row');
      if (!item.soon) node.type = 'button'; else node.setAttribute('aria-disabled', 'true');
      node.dataset.soon = String(Boolean(item.soon));
      node.append(icon(item.icon || current.icon, 'settings-hub-row-icon'));
      var copy = el('span', 'settings-hub-row-copy');
      copy.append(el('strong', '', item.title), el('small', '', item.desc));
      var meta = el('span', 'settings-hub-row-meta');
      if (item.soon) meta.append(el('em', 'settings-hub-chip', 'Próximamente'));
      else {
        if (itemStatus) { var chip = el('em', 'settings-hub-chip', itemStatus.text); chip.dataset.tone = itemStatus.tone; meta.append(chip); }
        meta.append(el('span', 'settings-hub-row-action', actionLabel(item, itemStatus)));
        node.addEventListener('click', function () { if (item.embed) openDetail(item); else go(item); });
      }
      node.append(copy, meta);
      return node;
    }

    function render() {
      var res = results();
      var current = SECTIONS.filter(function (section) { return section.id === state.section; })[0];
      panel.dataset.section = current.id;
      if (current.id !== 'canales' || state.detail) channelView = null;
      nav.replaceChildren();
      SECTIONS.forEach(function (section) {
        var button = el('button', 'settings-hub-nav-item'); button.type = 'button'; button.dataset.section = section.id;
        if (section.id === state.section) button.setAttribute('aria-current', 'true');
        button.append(icon(section.icon, 'settings-hub-nav-icon'), el('span', 'settings-hub-nav-copy', section.title));
        var open = pendingCount(section, res, state.services);
        if (open) { var badge = el('i', 'settings-hub-badge', String(open)); badge.setAttribute('aria-label', open + (open === 1 ? ' pendiente' : ' pendientes')); button.append(badge); }
        button.addEventListener('click', function () { restoreDetail(); state.section = section.id; save(section.id); render(); });
        nav.append(button);
      });
      // Acceso permanente a la lista de puesta en marcha mientras falten pasos obligatorios.
      var setup = win.SmylClinicSetup, progress = setup && typeof setup.summary === 'function' ? setup.summary() : null;
      if (progress && progress.done < progress.total) {
        var guide = el('button', 'settings-hub-nav-item settings-hub-setup'); guide.type = 'button';
        guide.append(el('span', 'settings-hub-nav-copy', 'Puesta en marcha'), el('i', 'settings-hub-badge', progress.percent + ' %'));
        guide.setAttribute('aria-label', 'Puesta en marcha, ' + progress.percent + ' por ciento. Ver los pasos');
        guide.addEventListener('click', function () { setup.open(guide); });
        nav.append(guide);
      }
      pickerSelect.value = state.section;
      panel.replaceChildren();
      panel.classList.remove('settings-hub-panel--detail');
      if (state.detail) { renderDetail(current); return; }

      var title = el('header', 'settings-hub-panel-head');
      title.append(icon(current.icon, 'settings-hub-panel-icon'));
      var titleCopy = el('div', 'settings-hub-panel-copy');
      titleCopy.append(el('h1', '', current.title), el('p', '', current.blurb));
      title.append(titleCopy);
      var currentPending = pendingCount(current, res, state.services);
      if (currentPending && current.id !== 'canales') { var summary = el('span', 'settings-hub-summary', currentPending + (currentPending === 1 ? ' pendiente' : ' pendientes')); summary.dataset.tone = 'todo'; title.append(summary); }
      panel.append(title);

      var groups = el('div', 'settings-hub-groups');
      groupedItems(current).forEach(function (entry) {
        var group = el('section', 'settings-hub-group');
        var groupHead = el('header', 'settings-hub-group-head');
        groupHead.append(el('h2', '', entry.name));
        var list = el('div', 'settings-hub-list');
        if (entry.items[0].channel) {
          group.classList.add('settings-accounts');
          var count = el('span', 'settings-account-count');
          var retry = el('button', 'settings-accounts-retry', 'Reintentar consulta'); retry.type = 'button'; retry.hidden = true;
          retry.onclick = function () { channelView = null; loadAccounts(); };
          groupHead.append(count, retry);
          entry.items.forEach(function (item) { list.append(accountButton(item)); });
        } else {
          entry.items.forEach(function (item) { list.append(row(item, current)); });
        }
        group.append(groupHead, list); groups.append(group);
      });
      panel.append(groups);
      if (current.id === 'canales' && page.classList.contains('activa')) loadAccounts();
    }

    async function refresh() {
      var setup = win.SmylClinicSetup;
      var jobs = [];
      if (setup && typeof setup.reload === 'function') jobs.push(Promise.resolve(setup.reload()).catch(function () {}));
      if (win.tenantId && win.sb) {
        var query = win.sb.from('smyl_services').select('id', { count: 'exact', head: true }).eq('tenant_id', win.tenantId).eq('active', true);
        jobs.push(Promise.resolve(typeof win.sbTimeout === 'function' ? win.sbTimeout(query) : query).then(function (response) { if (response && !response.error && typeof response.count === 'number') state.services = response.count; }).catch(function () {}));
      }
      await Promise.all(jobs);
      state.loadedAt = Date.now();
      if (page.classList.contains('activa') && !state.detail) {
        var focused = page.contains(document.activeElement) ? document.activeElement : null;
        var focusIndex = focused ? Array.from(page.querySelectorAll('button, select')).indexOf(focused) : -1;
        var account = focused?.dataset.account;
        render();
        // La consulta puede terminar mientras el usuario recorre las cuentas con el teclado.
        if (account) panel.querySelector('[data-account="' + account + '"]')?.focus({preventScroll:true});
        else if (focusIndex >= 0 && !focused.isConnected) page.querySelectorAll('button, select')[focusIndex]?.focus({preventScroll:true});
      }
    }

    var back = el('button', 'settings-back'); back.type = 'button'; back.hidden = true;
    back.append(el('span', '', '←'), document.createTextNode(' Volver a Configuración'));
    back.addEventListener('click', function () { win.ir('configuracion'); });
    function placeBack(route) {
      if (route !== state.from) { back.hidden = true; state.from = ''; return; }
      var host = document.getElementById('p-' + route);
      if (!host) { back.hidden = true; return; }
      host.prepend(back); back.hidden = false;
    }

    render();
    win.SmylSettingsHub = Object.freeze({
      open: function (section) { if (section && SECTIONS.some(function (item) { return item.id === section; })) { state.section = section; save(section); } win.ir('configuracion'); },
      openItem: function (section, title) {
        var sec = SECTIONS.filter(function (x) { return x.id === section; })[0]; if (!sec) return;
        var item = sec.items.filter(function (x) { return x.title === title && !x.soon; })[0]; if (!item) return;
        state.section = section; save(section); if (item.channel) go(item); else openDetail(item);
      },
      sections: function () { return SECTIONS.map(function (section) { return section.id; }); },
      refresh: refresh
    });
    var previous = win.ir;
    win.ir = function (route) {
      if (route !== 'configuracion') { channelView = null; restoreDetail(); }
      var out = previous.apply(this, arguments);
      if (route === 'configuracion') { render(); if (Date.now() - state.loadedAt > 30000) refresh(); }
      placeBack(route);
      return out;
    };
  }

  function init() {
    if (!win || !win.ir || document.getElementById('p-configuracion') || !document.querySelector('.contenido')) return;
    if (win.TITULOS) win.TITULOS.configuracion = 'Configuración';
    mount();
  }

  if (win && typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
  }

  return { SECTIONS: SECTIONS, status: status, pendingCount: pendingCount, groupedItems: groupedItems };
});
