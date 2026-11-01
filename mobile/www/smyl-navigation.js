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
    presentation: '<path d="M5 3h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="m8 21 4-4 4 4M8 8h8M8 12h5"/>',
    pricing: '<circle cx="12" cy="12" r="9"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 6v12"/>',
    brand: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    templates: '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9.5 3.5h5v2.5h-5zM9 11h6M9 15h4"/>',
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
    ['Finanzas', 'caja', 'cash']
  ];
  // Sección propia de mensajería (como «Mensajería/Campañas» en LANA): el chat y sus plantillas.
  var MESSAGING = [
    ['Mensajes', 'inbox', 'messages']
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
  var SETTINGS_ROUTES = ['clinica', 'directorio', 'colaboraciones', 'conexiones', 'lanzamiento', 'seguridad', 'sim-config', 'mi-cuenta', 'plantillas'];
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
    // Las plantillas de WhatsApp son parte de Canales: se llega desde Configuración o desde Mensajes.
    ['Plantillas de WhatsApp', 'plantillas', 'templates']
  ];

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

  function detailsGroup(label, entries, open) {
    var details = document.createElement('details');
    details.className = 'pro-nav-group';
    details.dataset.routes = entries.map(function (entry) { return entry[1]; }).join(' ');
    details.open = Boolean(open);
    var summary = document.createElement('summary');
    summary.innerHTML = '<span class="pro-nav-group-icon">' + icon('reports', 18) + '</span><span class="pro-nav-group-label">' + label + '</span><span class="pro-nav-chevron" aria-hidden="true">⌄</span>';
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
    document.querySelectorAll('.pro-nav-group').forEach(function (group) {
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
    nav.append(sectionLabel('Mensajería'));
    MESSAGING.forEach(function (entry) { nav.append(navItem(entry, false)); });
    nav.append(detailsGroup('Negocio', BUSINESS, true));
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

  function organizeMobileSheet() {
    var host = document.querySelector('.pam-scroll');
    if (!host) return;
    var daily = PRIMARY.slice(1);
    var quick = [['Nueva simulación', '__new_simulation', 'presentation']];
    host.replaceChildren(
      mobileGroup('Trabajo diario', daily),
      mobileGroup('Mensajería', MESSAGING),
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
    intro.innerHTML = '<div><span>CONFIGURACIÓN DE COMUNICACIÓN</span><strong>Completa una tarea a la vez.</strong></div><p>Conecta tus cuentas, prepara al asistente y prueba sus respuestas en espacios separados.</p>';
    var tabs = document.createElement('div');
    tabs.className = 'connections-tabs';
    tabs.setAttribute('role', 'tablist');
    [['channels','Canales'],['assistant','SMYL Asistente'],['lab','Laboratorio']].forEach(function (entry, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.connectionTab = entry[0];
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(index === 0));
      button.textContent = entry[1];
      tabs.append(button);
    });

    var channelsPane = document.createElement('section');
    channelsPane.className = 'connections-pane';
    channelsPane.dataset.connectionPane = 'channels';
    flow.before(intro, tabs, channelsPane);
    channelsPane.append(flow, grid, safety);
    training.classList.add('connections-pane');
    training.dataset.connectionPane = 'assistant';
    var labPane = document.createElement('section');
    labPane.className = 'connections-context connections-pane connections-preview-panel';
    labPane.dataset.connectionPane = 'lab';
    training.after(labPane);
    labPane.append(preview);

    function select(name) {
      tabs.querySelectorAll('[data-connection-tab]').forEach(function (button) {
        var selected = button.dataset.connectionTab === name;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      shell.querySelectorAll('[data-connection-pane]').forEach(function (pane) { pane.hidden = pane.dataset.connectionPane !== name; });
    }
    tabs.addEventListener('click', function (event) {
      var button = event.target.closest('[data-connection-tab]');
      if (button) select(button.dataset.connectionTab);
    });
    select('channels');
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

  function setupQuickAction() {
    var foot = document.querySelector('.sidebar .sb-foot');
    if (!foot || foot.querySelector('.smyl-sidebar-quick')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'smyl-sidebar-quick';
    button.dataset.tooltip = 'Nueva cita';
    button.setAttribute('aria-label', 'Nueva cita');
    button.innerHTML = '<span aria-hidden="true">' + icon('calendar', 18) + '</span><span class="smyl-sidebar-quick-label">Nueva cita</span>';
    button.addEventListener('click', function () {
      if (typeof window.ir !== 'function') return;
      window.ir('agenda');
      window.setTimeout(function () {
        var create = document.getElementById('schedule-new');
        if (create) create.click();
      }, 0);
    });
    foot.prepend(button);
  }

  function init() {
    organizeDesktop();
    setupCollapse();
    setupQuickAction();
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
