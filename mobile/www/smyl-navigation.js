/* Central information architecture for the professional workspace. */
(function () {
  'use strict';

  var ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    patients: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m9 15 2 2 4-4"/>',
    messages: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.5-5A7 7 0 0 1 3 13V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>',
    alerts: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    inventory: '<path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
    cash: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 15h4"/><circle cx="16" cy="14" r="2"/>',
    reports: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
    clinic: '<path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 10h2M13 10h2M9 14h2M13 14h2M11 21v-4h2v4"/>',
    directory: '<circle cx="9" cy="8" r="4"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0M17 8h5M19.5 5.5v5"/><path d="M17 15h4M17 18h4"/>',
    channels: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2A5 5 0 0 0 12 4l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    launch: '<path d="M12 2 9 9l-7 3 7 3 3 7 3-7 7-3-7-3-3-7Z"/>',
    history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M3 12H1"/>',
    quote: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    presentation: '<path d="M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="m8 21 4-4 4 4M8 8h8M8 12h5"/>',
    pricing: '<circle cx="12" cy="12" r="9"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 6v12"/>',
    brand: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    templates: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9.5 3.5h5v2.5h-5zM9 11h6M9 15h4"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    broadcast: '<path d="m3 11 16-7-5 16-3.5-6.5L3 11Z"/><path d="m10.5 13.5 3.5-3.5"/>',
    campaign: '<path d="M4 13v-2l12-5v12L4 13Z"/><path d="M8 14v5a2 2 0 0 0 2 2h1v-6M18 9a3 3 0 0 1 0 6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    plus: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>'
  };

  // PRIMARY contiene únicamente módulos persistentes. La simulación se abre
  // como acción contextual y desde Simulaciones; no ocupa un módulo propio.
  var PRIMARY = [
    ['Inicio', 'dashboard', 'home'],
    ['Agenda', 'agenda', 'calendar'],
    ['Pacientes', 'pacientes', 'patients'],
    ['Cobros', 'caja', 'cash'],
    ['Cotizaciones', 'propuestas', 'quote']
  ];
  // Centro de comunicación: una sola jerarquía para conversar, preparar plantillas
  // y organizar envíos. Cada ruta conserva su propia autorización y fuente de datos.
  var MESSAGING = [
    ['Chat', 'inbox', 'messages'],
    ['Correo', 'correo', 'email'],
    ['Mensajes masivos', 'mensajes-masivos', 'broadcast'],
    ['Plantillas WhatsApp', 'plantillas', 'templates'],
    ['Campañas', 'campanas', 'campaign']
  ];
  var MOBILE_PRIMARY = [PRIMARY[0], PRIMARY[1], PRIMARY[2], MESSAGING[0]];
  var BUSINESS = [
    ['Servicios y tarifas', 'precios', 'pricing'],
    ['Inventario', 'inventario', 'inventory'],
    ['Reportes', 'reportes', 'reports'],
    ['Simulaciones', 'historial', 'history']
  ];
  // Todos los ajustes viven ahora en la pantalla Configuración (smyl-settings-hub.js), ordenada como el panel de LANA.
  // El menú solo tiene ese acceso; se marca mientras estás en cualquiera de las pantallas a las que lleva.
  var SETTINGS_ROUTES = ['clinica', 'directorio', 'colaboraciones', 'conexiones', 'lanzamiento', 'seguridad', 'sim-config', 'mi-cuenta'];
  var SETTINGS = [['Configuración', 'configuracion', 'settings']];
  // Otros módulos agregan su propio botón al menú cuando no lo encuentran. Estas rutas ya no tienen botón visible,
  // pero se dejan registradas (ocultas) para que no reaparezcan sueltas en el menú.
  var REGISTRY = [
    ['Mi clínica', 'clinica', 'clinic'],
    ['Directorio profesional', 'directorio', 'directory'],
    ['Colaboraciones', 'colaboraciones', 'patients'],
    ['Canales y asistente', 'conexiones', 'channels'],
    ['Preparación operativa', 'lanzamiento', 'launch'],
    ['Seguridad', 'seguridad', 'shield'],
    ['Marca y simulación', 'sim-config', 'brand'],
    ['Mi cuenta', 'mi-cuenta', 'account'],
    // La ruta permanece registrada para impedir que otros módulos agreguen un acceso duplicado.
    ['Plantillas de WhatsApp', 'plantillas', 'templates']
  ];

  var CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function icon(name, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  function navItem(entry, mobile) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = mobile ? 'pam-row' : 'nav-item pro-nav-item';
    button.dataset.route = entry[1];
    if (entry[1] === 'configuracion') button.dataset.also = SETTINGS_ROUTES.join(' ');
    if (entry[1] === 'pacientes') button.dataset.also = ((button.dataset.also || '') + ' paciente-detalle').trim();
    button.setAttribute('onclick', mobile ? "pamIr('" + entry[1] + "')" : "ir('" + entry[1] + "')");
    if (mobile) {
      button.innerHTML = '<span class="pam-row-icon">' + icon(entry[2], 20) + '</span><span class="pam-row-label">' + entry[0] + '</span><span class="pam-row-chevron" aria-hidden="true">›</span>';
    } else {
      button.innerHTML = '<span class="pro-nav-icon">' + icon(entry[2], 18) + '</span><span class="pro-nav-label">' + entry[0] + '</span>';
      button.title = entry[0];
      button.dataset.tooltip = entry[0];
      button.setAttribute('aria-label', entry[0]);
    }
    return button;
  }

  function sectionLabel(text) {
    var label = document.createElement('div');
    label.className = 'pro-nav-section';
    label.textContent = text;
    return label;
  }

  function detailsGroup(label, entries, open, iconName) {
    var details = document.createElement('details');
    details.className = 'pro-nav-group';
    details.dataset.routes = entries.map(function (entry) { return entry[1]; }).join(' ');
    details.open = Boolean(open);
    var summary = document.createElement('summary');
    summary.innerHTML = '<span class="pro-nav-group-icon">' + icon(iconName || 'reports', 18) + '</span><span class="pro-nav-group-label">' + label + '</span><span class="pro-nav-group-count" hidden></span><span class="pro-nav-chevron" aria-hidden="true">' + CHEVRON + '</span>';
    summary.dataset.tooltip = label;
    summary.setAttribute('aria-label', label);
    details.append(summary);
    var flyout = document.createElement('div');
    flyout.className = 'pro-nav-flyout';
    flyout.setAttribute('aria-label', label);
    entries.forEach(function (entry) { flyout.append(navItem(entry, false)); });
    details.append(flyout);
    return details;
  }

  function activeRoute() {
    var active = document.querySelector('.pantalla.activa');
    return active && active.id ? active.id.replace(/^p-/, '') : 'dashboard';
  }

  function syncActive(route) {
    var primaryRoute = MOBILE_PRIMARY.some(function (entry) {
      return entry[1] === route || (entry[1] === 'pacientes' && route === 'paciente-detalle');
    });
    document.querySelectorAll('.pro-app-nav [data-route],.pro-mobile-nav [data-route],.pam-scroll [data-route]').forEach(function (item) {
      var isMore = item.dataset.mobileMore === 'true';
      var isActive = isMore
        ? !primaryRoute
        : item.dataset.route === route || (' ' + (item.dataset.also || '') + ' ').indexOf(' ' + route + ' ') !== -1;
      item.classList.toggle('activo', isActive);
      if (isActive) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    // Mensajería y Negocio se abren solos al entrar a una de sus pantallas y se cierran al salir.
    document.querySelectorAll('.pro-nav-group').forEach(function (group) {
      var contains = (' ' + group.dataset.routes + ' ').indexOf(' ' + route + ' ') !== -1;
      group.classList.toggle('has-active', contains);
      group.open = contains;
    });
    document.querySelectorAll('.pam-collapsible-group').forEach(function (group) {
      var contains = (' ' + group.dataset.routes + ' ').indexOf(' ' + route + ' ') !== -1;
      group.classList.toggle('has-active', contains);
      if (contains) group.open = true;
    });
  }

  function organizeDesktop() {
    var host = document.querySelector('.sidebar .nav-items');
    if (!host) return;
    var nav = document.createElement('nav');
    nav.className = 'pro-app-nav pro-primary-nav';
    nav.setAttribute('aria-label', 'Navegación principal');
    nav.append(sectionLabel('Trabajo diario'));
    PRIMARY.forEach(function (entry) { nav.append(navItem(entry, false)); });
    nav.append(sectionLabel('Comunicación'));
    nav.append(detailsGroup('Mensajería', MESSAGING, false, 'messages'));
    nav.append(detailsGroup('Negocio', BUSINESS, false, 'reports'));
    SETTINGS.forEach(function (entry) { nav.append(navItem(entry, false)); });
    var registry = document.createElement('div');
    registry.className = 'pro-nav-registry'; registry.hidden = true; registry.style.display = 'none'; registry.setAttribute('aria-hidden', 'true');
    REGISTRY.forEach(function (entry) { registry.append(navItem(entry, false)); });
    nav.append(registry);
    host.replaceChildren(nav);
  }

  function organizeMobileBar() {
    var host = document.querySelector('.pro-mobile-nav');
    if (!host) return;
    host.classList.add('pro-mobile-navigation');
    host.setAttribute('aria-label', 'Navegación móvil principal');
    host.replaceChildren();
    MOBILE_PRIMARY.forEach(function (entry) {
      var item = navItem(entry, false);
      item.dataset.mobilePrimary = 'true';
      host.append(item);
    });
    var more = navItem(['Más', '__more', 'more'], false);
    more.removeAttribute('onclick');
    more.dataset.mobilePrimary = 'true';
    more.dataset.mobileMore = 'true';
    more.setAttribute('aria-haspopup', 'dialog');
    more.setAttribute('aria-controls', 'panel-admin-mobile');
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', function () {
      if (typeof window.openPanelAdmin === 'function') window.openPanelAdmin();
    });
    host.append(more);
  }

  function mobileGroup(label, entries) {
    var group = document.createElement('section');
    group.className = 'pam-group';
    var heading = document.createElement('div');
    heading.className = 'pam-group-label';
    heading.textContent = label;
    group.append(heading);
    entries.forEach(function (entry) { group.append(navItem(entry, true)); });
    return group;
  }

  function mobileDetailsGroup(label, entries, open) {
    var details = document.createElement('details');
    details.className = 'pam-group pam-collapsible-group';
    details.dataset.routes = entries.map(function (entry) { return entry[1]; }).join(' ');
    details.open = Boolean(open);
    var summary = document.createElement('summary');
    summary.className = 'pam-group-label pam-group-summary';
    summary.innerHTML = '<span>' + label + '</span><span class="pam-group-toggle" aria-hidden="true">⌄</span>';
    details.append(summary);
    var body = document.createElement('div');
    body.className = 'pam-group-body';
    entries.forEach(function (entry) { body.append(navItem(entry, true)); });
    details.append(body);
    return details;
  }

  function organizeMobileSheet() {
    var host = document.querySelector('.pam-scroll');
    if (!host) return;
    var daily = PRIMARY.slice(1);
    var quick = [['Nueva simulación', '__new_simulation', 'presentation']];
    host.replaceChildren(
      mobileGroup('Trabajo diario', daily),
      mobileDetailsGroup('Mensajería', MESSAGING, true),
      mobileGroup('Negocio', BUSINESS),
      mobileGroup('Configuración', SETTINGS),
      mobileGroup('Acción rápida', quick)
    );
    var quickButton = host.querySelector('[data-route="__new_simulation"]');
    if (quickButton) {
      quickButton.removeAttribute('onclick');
      quickButton.addEventListener('click', function () { window.location.href = 'simulacion-rapida.html?workspace=professional'; });
    }
  }

  function setupMobileSheetModal() {
    var panel = document.getElementById('panel-admin-mobile');
    var sheet = document.getElementById('pam-sheet');
    var more = document.querySelector('.pro-mobile-nav [data-mobile-more="true"]');
    if (!panel || !sheet || panel.dataset.navigationModalReady === 'true') return;
    panel.dataset.navigationModalReady = 'true';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Más opciones');
    panel.setAttribute('aria-hidden', 'true');
    sheet.tabIndex = -1;

    var closeButton = panel.querySelector('.pam-close');
    var backdrop = panel.querySelector('.pam-backdrop');
    if (closeButton) closeButton.setAttribute('aria-label', 'Cerrar menú');
    if (backdrop) backdrop.setAttribute('aria-hidden', 'true');

    var previousOpen = window.openPanelAdmin;
    var previousClose = window.closePanelAdmin;
    var returnFocus = null;
    var closeTimer = null;

    function focusableElements() {
      return Array.prototype.slice.call(panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
        .filter(function (element) { return element.getAttribute('aria-hidden') !== 'true'; });
    }

    window.openPanelAdmin = function () {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : more;
      if (closeTimer) window.clearTimeout(closeTimer);
      if (typeof previousOpen === 'function') previousOpen.apply(this, arguments);
      panel.setAttribute('aria-hidden', 'false');
      document.body.classList.add('smyl-mobile-sheet-open');
      if (more) more.setAttribute('aria-expanded', 'true');
      syncActive(activeRoute());
      var defer = window.requestAnimationFrame || function (callback) { window.setTimeout(callback, 0); };
      defer(function () {
        var target = closeButton || focusableElements()[0] || sheet;
        if (target && typeof target.focus === 'function') target.focus();
      });
    };

    window.closePanelAdmin = function () {
      if (typeof previousClose === 'function') previousClose.apply(this, arguments);
      if (more) more.setAttribute('aria-expanded', 'false');
      if (closeTimer) window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(function () {
        panel.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('smyl-mobile-sheet-open');
        var target = returnFocus && returnFocus.isConnected ? returnFocus : more;
        if (target && typeof target.focus === 'function') target.focus();
        returnFocus = null;
      }, 260);
    };

    panel.addEventListener('keydown', function (event) {
      if (!panel.classList.contains('visible')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        window.closePanelAdmin();
        return;
      }
      if (event.key !== 'Tab') return;
      var focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        sheet.focus();
        return;
      }
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  function splitConnections() {
    var shell = document.querySelector('.connections-shell');
    var flow = shell && shell.querySelector('.connections-flow');
    var grid = shell && shell.querySelector('.connections-grid');
    var training = shell && shell.querySelector('.connections-training');
    var safety = shell && shell.querySelector('.connections-safety');
    var preview = training && training.querySelector('.connections-preview');
    if (!shell || !flow || !grid || !training || !safety || !preview || shell.querySelector('.connections-tabs')) return;

    var intro = document.createElement('div');
    intro.className = 'connections-workspace-intro';
    intro.innerHTML = '<div><span>CONFIGURACIÓN DE COMUNICACIÓN</span><strong>Un espacio para cada canal.</strong></div><p>Conexión, herramientas y automatizaciones sin mezclar configuraciones.</p>';

    var workspace = document.createElement('div');
    workspace.className = 'connections-workspace';
    var tabs = document.createElement('nav');
    tabs.className = 'connections-tabs';
    tabs.setAttribute('aria-label', 'Configuración de canales');
    var paneHost = document.createElement('div');
    paneHost.className = 'connections-pane-host';
    var entries = [
      ['channels','Resumen','R'],
      ['whatsapp','WhatsApp','W'],
      ['messenger','Messenger','M'],
      ['instagram','Instagram','I'],
      ['assistant','SMYL Asistente','A'],
      ['templates','Plantillas','P'],
      ['automations','Automatizaciones','⌁'],
      ['lab','Probar al asistente','T']
    ];
    entries.forEach(function (entry, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.connectionTab = entry[0];
      button.setAttribute('aria-selected', String(index === 0));
      button.innerHTML = '<span aria-hidden="true">' + entry[2] + '</span><strong>' + entry[1] + '</strong>';
      tabs.append(button);
    });

    var overviewPane = document.createElement('section');
    overviewPane.className = 'connections-pane connections-overview-pane';
    overviewPane.dataset.connectionPane = 'channels';
    overviewPane.innerHTML = '<header class="connections-pane-head"><span>RESUMEN</span><h2>Canales de la clínica</h2><p>Activa la infraestructura y abre cada canal para completar sus herramientas.</p></header>';
    var infrastructure = grid.querySelector('.connections-card-main');
    var channelCard = grid.querySelector('.connections-card:not(.connections-card-main)');
    var retry = channelCard && channelCard.querySelector('[data-channel-retry]');
    var boundary = channelCard && channelCard.querySelector('.connections-boundary');
    if (infrastructure) overviewPane.append(infrastructure);
    if (retry) overviewPane.append(retry);
    if (boundary) overviewPane.append(boundary);
    overviewPane.append(flow, safety);
    paneHost.append(overviewPane);

    var channelCopy = {
      whatsapp: ['WhatsApp Business', 'Número, plantillas, recordatorios y atención de pacientes.'],
      messenger: ['Messenger', 'Mensajes de Facebook y entrega de conversaciones al equipo.'],
      instagram: ['Instagram', 'Mensajes directos y reglas de respuesta para la cuenta conectada.']
    };
    Object.keys(channelCopy).forEach(function (name) {
      var copy = channelCopy[name];
      var pane = document.createElement('section');
      pane.className = 'connections-pane connections-channel-pane';
      pane.dataset.connectionPane = name;
      pane.hidden = true;
      pane.innerHTML = '<header class="connections-pane-head"><span>CANAL</span><h2>' + copy[0] + '</h2><p>' + copy[1] + '</p></header>' +
        '<div class="connections-channel-config"><article class="connections-card"><div class="connections-card-head"><div><span>CONEXIÓN</span><h2>Cuenta conectada</h2></div></div><div class="connections-channel-list" data-channel-slot="' + name + '"></div></article>' +
        '<article class="connections-card connections-channel-scope"><div class="connections-card-head"><div><span>ALCANCE</span><h2>Uso dentro de SMYL</h2></div><span class="connections-badge">Clínica</span></div><p>La conexión pertenece a este tenant. Después podrás asignarla a una o varias sucursales sin compartir credenciales con los profesionales.</p><div class="connections-scope-row"><span>Sucursales</span><strong>Toda la clínica</strong></div><div class="connections-scope-row"><span>Responsables</span><strong>Según roles y asignación</strong></div></article></div>' +
        '<section class="connections-channel-tools"><header><span>HERRAMIENTAS</span><h3>Configura este canal</h3></header><div data-channel-tools="' + name + '"></div></section>';
      var row = channelCard && channelCard.querySelector('[data-channel-row="' + name + '"]');
      var slot = pane.querySelector('[data-channel-slot="' + name + '"]');
      if (row && slot) slot.append(row);
      paneHost.append(pane);
    });

    training.classList.add('connections-pane');
    training.dataset.connectionPane = 'assistant';
    training.hidden = true;
    paneHost.append(training);

    var templatesPane = document.createElement('section');
    templatesPane.className = 'connections-pane connections-tools-pane';
    templatesPane.dataset.connectionPane = 'templates';
    templatesPane.hidden = true;
    templatesPane.innerHTML = '<header class="connections-pane-head"><span>WHATSAPP</span><h2>Plantillas</h2><p>Mensajes aprobados por Meta, ordenados por el momento de atención.</p></header><div class="connections-tools-grid"><article class="connections-tool-card"><span>CITAS</span><h3>Confirmaciones y cambios</h3><p>Nueva cita, confirmación, cambio de horario, rechazo y cancelación.</p></article><article class="connections-tool-card"><span>SEGUIMIENTO</span><h3>Recordatorios</h3><p>Avisos previos y mensajes posteriores a la consulta.</p></article><article class="connections-tool-card"><span>COBROS</span><h3>Pagos y anticipos</h3><p>Solicitudes, vencimientos y confirmaciones de pago.</p></article></div><button type="button" class="btn btn-primary" data-open-templates>Abrir plantillas de WhatsApp</button>';
    paneHost.append(templatesPane);

    var automationsPane = document.createElement('section');
    automationsPane.className = 'connections-pane connections-tools-pane';
    automationsPane.dataset.connectionPane = 'automations';
    automationsPane.hidden = true;
    automationsPane.innerHTML = '<header class="connections-pane-head"><span>REGLAS COMPARTIDAS</span><h2>Automatizaciones</h2><p>Define qué hace SMYL y en qué momento debe intervenir una persona.</p></header><div class="connections-tools-grid"><button type="button" class="connections-tool-card" data-open-reminders><span>AGENDA</span><h3>Recordatorios de cita</h3><p>Plantilla, anticipación y estado de los avisos.</p><em>Abrir configuración →</em></button><button type="button" class="connections-tool-card" data-select-workspace="assistant"><span>ASISTENTE</span><h3>Reglas de atención</h3><p>Qué puede responder y cuándo debe entregar la conversación.</p><em>Configurar →</em></button><button type="button" class="connections-tool-card" data-select-workspace="lab"><span>CONTROL</span><h3>Prueba antes de activar</h3><p>Simula una conversación sin escribirle a un paciente real.</p><em>Probar →</em></button></div>';
    paneHost.append(automationsPane);

    var labPane = document.createElement('section');
    labPane.className = 'connections-context connections-pane connections-preview-panel';
    labPane.dataset.connectionPane = 'lab';
    labPane.hidden = true;
    paneHost.append(labPane);
    labPane.append(preview);

    grid.remove();
    shell.querySelector('.connections-hero').after(intro, workspace);
    workspace.append(tabs, paneHost);

    function tool(label, copy, target) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'connections-tool-card';
      button.dataset.selectWorkspace = target;
      button.innerHTML = '<span>HERRAMIENTA</span><h3>' + label + '</h3><p>' + copy + '</p><em>Abrir →</em>';
      return button;
    }
    shell.querySelectorAll('[data-channel-tools]').forEach(function (host) {
      var name = host.dataset.channelTools;
      if (name === 'whatsapp') host.append(tool('Plantillas', 'Citas, seguimientos y cobros aprobados por Meta.', 'templates'));
      host.append(tool('SMYL Asistente', 'Información, tono y reglas de atención.', 'assistant'));
      host.append(tool('Automatizaciones', 'Recordatorios y entrega al equipo.', 'automations'));
      host.append(tool('Probar canal', 'Revisa una respuesta antes de activar.', 'lab'));
    });

    function select(name) {
      if (!paneHost.querySelector('[data-connection-pane="' + name + '"]')) name = 'channels';
      tabs.querySelectorAll('[data-connection-tab]').forEach(function (button) {
        var selected = button.dataset.connectionTab === name;
        button.setAttribute('aria-selected', String(selected));
      });
      shell.querySelectorAll('[data-connection-pane]').forEach(function (pane) { pane.hidden = pane.dataset.connectionPane !== name; });
      try { window.localStorage.setItem('smyl_connections_workspace', name); } catch (_) {}
      if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) paneHost.scrollIntoView({ block: 'start' });
    }
    tabs.addEventListener('click', function (event) {
      var button = event.target.closest('[data-connection-tab]');
      if (button) select(button.dataset.connectionTab);
    });
    shell.addEventListener('click', function (event) {
      var jump = event.target.closest('[data-select-workspace]');
      if (jump) { select(jump.dataset.selectWorkspace); return; }
      if (event.target.closest('[data-open-templates]')) { window.ir('plantillas'); return; }
      if (event.target.closest('[data-open-reminders]')) {
        window.ir('agenda');
        window.setTimeout(function () {
          var settings = document.querySelector('[data-schedule-tab="settings"]');
          if (settings) settings.click();
          var reminders = document.getElementById('schedule-reminders-card');
          if (reminders) reminders.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    });
    ['whatsapp','messenger','instagram'].forEach(function (name) {
      var source = shell.querySelector('[data-channel-row="' + name + '"]');
      var button = tabs.querySelector('[data-connection-tab="' + name + '"]');
      if (!source || !button || !window.MutationObserver) return;
      function syncState() { button.dataset.state = source.dataset.state || 'pending'; }
      syncState();
      new MutationObserver(syncState).observe(source, { attributes: true, attributeFilter: ['data-state'] });
    });
    var saved = 'channels';
    try { saved = window.localStorage.getItem('smyl_connections_workspace') || 'channels'; } catch (_) {}
    select(saved);
    window.SmylConnectionsWorkspace = Object.freeze({ select: select });
  }

  // Flecha para contraer el sidebar a solo iconos; la preferencia se recuerda en este navegador.
  function setupCollapse() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar || sidebar.querySelector('.pro-sidebar-toggle')) return;
    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'pro-sidebar-toggle';
    toggle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
    function apply(collapsed) {
      document.body.classList.toggle('smyl-sidebar-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral');
      toggle.title = collapsed ? 'Expandir menú' : 'Contraer menú';
    }
    var saved = false;
    try { saved = window.localStorage.getItem('smyl_sidebar_collapsed') === '1'; } catch (_) {}
    apply(saved);
    toggle.addEventListener('click', function () {
      var collapsed = !document.body.classList.contains('smyl-sidebar-collapsed');
      apply(collapsed);
      try { window.localStorage.setItem('smyl_sidebar_collapsed', collapsed ? '1' : '0'); } catch (_) {}
    });
    sidebar.append(toggle);
  }

  function openNewAppointment() {
    if (typeof window.ir !== 'function') return;
    window.ir('agenda');
    window.setTimeout(function () {
      var create = document.getElementById('schedule-new');
      if (create) create.click();
    }, 0);
  }

  // «Nueva cita» va arriba, bajo la cabecera, como botón con borde y atajo N.
  function setupQuickAction() {
    var sidebar = document.querySelector('.sidebar');
    var logo = sidebar && sidebar.querySelector('.sb-logo');
    if (!sidebar || !logo) return;
    var button = sidebar.querySelector('.smyl-sidebar-quick');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'smyl-sidebar-quick';
    }
    button.removeAttribute('onclick');
    button.dataset.tooltip = 'Nueva cita (N)';
    button.setAttribute('aria-label', 'Nueva cita');
    button.setAttribute('aria-keyshortcuts', 'N');
    button.innerHTML = '<span aria-hidden="true">' + icon('plus', 17) + '</span><span class="smyl-sidebar-quick-label">Nueva cita</span><kbd class="smyl-sidebar-quick-key" aria-hidden="true">N</kbd>';
    if (button.dataset.quickReady !== 'true') {
      button.dataset.quickReady = 'true';
      button.addEventListener('click', openNewAppointment);
    }
    var wrap = sidebar.querySelector('.sb-quick');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'sb-quick';
      logo.after(wrap);
    }
    wrap.append(button);
  }

  function isTypingTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return Boolean(target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]'));
  }

  // Atajo N para «Nueva cita»: solo en escritorio, sin modificadores, fuera de campos de texto y sin diálogos abiertos.
  function setupNewAppointmentShortcut() {
    if (document.documentElement.dataset.smylQuickShortcut === 'true') return;
    document.documentElement.dataset.smylQuickShortcut = 'true';
    document.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'n' && event.key !== 'N') return;
      if (isTypingTarget(event.target)) return;
      var button = document.querySelector('.sidebar .smyl-sidebar-quick');
      if (!button || !button.offsetParent) return;
      var dialogs = document.querySelectorAll('dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"]');
      for (var i = 0; i < dialogs.length; i += 1) {
        if (dialogs[i].getAttribute('aria-hidden') !== 'true' && dialogs[i].getClientRects().length) return;
      }
      var gate = document.getElementById('auth-gate-overlay');
      if (gate && gate.offsetParent) return;
      event.preventDefault();
      openNewAppointment();
    });
  }

  // Cabecera única: logo de SMYL y, debajo, el nombre de la clínica (el mismo que antes iba en la tarjeta de usuario).
  function setupShellHeader() {
    var logo = document.querySelector('.sidebar .sb-logo > div');
    var source = document.getElementById('sb-consultorio');
    if (!logo || !source || logo.querySelector('.sb-clinic-name')) return;
    var name = document.createElement('span');
    name.className = 'sb-clinic-name';
    function sync() {
      var text = source.textContent.trim();
      name.textContent = text && text !== 'Consultorio' ? text : 'Mi Consultorio';
      name.title = name.textContent;
    }
    sync();
    logo.append(name);
    if (window.MutationObserver) new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true });
  }

  // Usuario abajo: avatar y nombre llevan a Mi cuenta; el menú ⋯ ofrece Mi cuenta y Cerrar sesión.
  function setupUserFooter() {
    var sidebar = document.querySelector('.sidebar');
    var foot = sidebar && sidebar.querySelector('.sb-foot');
    var user = sidebar && sidebar.querySelector('.sb-user');
    if (!foot || !user || foot.querySelector('.sb-user-menu')) return;
    var info = user.querySelector('.sb-user-info');
    if (info && !info.querySelector('.sb-user-role')) {
      var role = document.createElement('div');
      role.className = 'sb-user-role';
      role.textContent = 'Mi cuenta';
      info.append(role);
    }
    var holder = document.createElement('div');
    holder.className = 'sb-account';
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'sb-user-more';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', 'Opciones de la cuenta');
    more.innerHTML = icon('more', 16);
    var menu = document.createElement('div');
    menu.className = 'sb-user-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    var account = document.createElement('button');
    account.type = 'button';
    account.setAttribute('role', 'menuitem');
    account.className = 'sb-user-menu-item';
    account.innerHTML = icon('account', 16) + '<span>Mi cuenta</span>';
    account.addEventListener('click', function () { close(); if (typeof window.ir === 'function') window.ir('mi-cuenta'); });
    menu.append(account);
    var logout = foot.querySelector('.btn-cerrar');
    if (logout) {
      logout.setAttribute('role', 'menuitem');
      logout.classList.add('sb-user-menu-item');
      menu.append(logout);
    }
    function close() {
      menu.hidden = true;
      more.setAttribute('aria-expanded', 'false');
    }
    function open() {
      menu.hidden = false;
      more.setAttribute('aria-expanded', 'true');
      var first = menu.querySelector('[role="menuitem"]');
      if (first) first.focus();
    }
    more.addEventListener('click', function (event) {
      event.stopPropagation();
      if (menu.hidden) open(); else close();
    });
    menu.addEventListener('keydown', function (event) {
      var items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
      var index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); more.focus(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
    });
    document.addEventListener('click', function (event) {
      if (!menu.hidden && !holder.contains(event.target)) close();
    });
    holder.append(user, more, menu);
    foot.append(holder);
  }

  // Con un grupo cerrado, su cabecera suma los pendientes de sus opciones (p. ej. chats sin leer).
  function setupGroupCounts() {
    document.querySelectorAll('.pro-app-nav .pro-nav-group').forEach(function (group) {
      var badge = group.querySelector('.pro-nav-group-count');
      var flyout = group.querySelector('.pro-nav-flyout');
      if (!badge || !flyout || group.dataset.countReady === 'true') return;
      group.dataset.countReady = 'true';
      function sync() {
        var total = 0, overflow = false;
        flyout.querySelectorAll('.pro-nav-count').forEach(function (count) {
          if (count.hidden) return;
          var text = count.textContent.trim();
          if (/\+$/.test(text)) overflow = true;
          total += parseInt(text, 10) || 0;
        });
        badge.textContent = overflow || total > 99 ? '99+' : String(total);
        badge.hidden = !total;
        if (total) badge.setAttribute('aria-label', total + ' pendientes'); else badge.removeAttribute('aria-label');
      }
      sync();
      if (window.MutationObserver) new MutationObserver(sync).observe(flyout, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    });
  }

  function init() {
    organizeDesktop();
    setupCollapse();
    setupShellHeader();
    setupQuickAction();
    setupNewAppointmentShortcut();
    setupUserFooter();
    setupGroupCounts();
    organizeMobileBar();
    organizeMobileSheet();
    setupMobileSheetModal();
    splitConnections();
    var previous = window.ir;
    window.ir = function (route) {
      if (typeof previous === 'function') previous(route);
      syncActive(route);
    };
    syncActive(activeRoute());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
