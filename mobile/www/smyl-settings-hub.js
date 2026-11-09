/* SMYL · Configuración: centro administrativo por tarea.
   Cada tarjeta lleva a la pantalla que ya existe y no cambia ningún dato. Canales abre un
   espacio propio por cuenta para que conexión, herramientas y automatizaciones no se mezclen.
   Los avisos de estado son de solo lectura y salen de verificaciones reales. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.SmylSettingsHub = factory(root);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var STORE_KEY = 'smyl_settings_section';

  // `check` enlaza una tarjeta con una verificación; `soon` marca lo que todavía no existe en SMYL.
  var SECTIONS = [
    { id: 'clinica', title: 'Clínica', blurb: 'Identidad, sedes y experiencia del paciente.', items: [
      { title: 'Sucursales y espacios', desc: 'Direcciones, sillones, consultorios y horario de cada sede.', route: 'clinica', embed: true, target: '[data-ca-tab="operacion"]', check: 'hours' },
      { title: 'Marca y experiencia', desc: 'Nombre, colores y mensaje del espacio que ven tus pacientes.', route: 'sim-config' },
      { title: 'Directorio profesional', desc: 'Perfil público para recibir solicitudes de cita.', route: 'directorio' }
    ] },
    { id: 'equipo', title: 'Equipo', blurb: 'Personas, invitaciones y permisos.', items: [
      { title: 'Profesionales y roles', desc: 'Invita al equipo y define qué puede ver o hacer cada persona.', route: 'clinica', embed: true, target: '[data-ca-tab="equipo"]' },
      { title: 'Mi cuenta', desc: 'Tus datos personales y preferencias de acceso.', route: 'mi-cuenta' }
    ] },
    { id: 'agenda', title: 'Agenda', blurb: 'Disponibilidad, calendarios y avisos de cita.', items: [
      { title: 'Horarios y servicios', desc: 'Quién atiende, dónde y en qué horarios.', route: 'agenda', target: '[data-schedule-tab="settings"]' },
      { title: 'Google Calendar', desc: 'Conecta el calendario profesional y revisa cambios externos.', route: 'agenda', target: '#schedule-google-calendar' },
      { title: 'Confirmaciones', desc: 'Revisa solicitudes que todavía necesitan horario o aprobación.', route: 'agenda', target: '[data-schedule-tab="requests"]' },
      { title: 'Recordatorios de cita', desc: 'Avisos automáticos antes de cada cita para que no falten.', route: 'agenda', embed: true, element: '#schedule-reminders-card', check: 'reminders' }
    ] },
    { id: 'catalogo', title: 'Catálogo', blurb: 'Servicios, precios y materiales.', items: [
      { title: 'Servicios y tarifas', desc: 'Tratamientos, duración, precio y claves fiscales.', route: 'precios', check: 'services' },
      { title: 'Materiales e inventario', desc: 'Existencias, compras y material utilizado por tratamiento.', route: 'inventario' }
    ] },
    { id: 'canales', title: 'Canales', blurb: 'Cada canal tiene su conexión, herramientas y automatizaciones.', items: [
      { title: 'WhatsApp Business', desc: 'Número, conexión, plantillas y herramientas de atención.', route: 'conexiones', target: '[data-connection-tab="whatsapp"]', check: 'whatsapp' },
      { title: 'Messenger', desc: 'Cuenta de Facebook, asistente y pruebas del canal.', route: 'conexiones', target: '[data-connection-tab="messenger"]' },
      { title: 'Instagram', desc: 'Mensajes directos, asistente y estado de la cuenta.', route: 'conexiones', target: '[data-connection-tab="instagram"]' },
      { title: 'SMYL Asistente', desc: 'Información, tono y reglas con las que responde.', route: 'conexiones', target: '[data-connection-tab="assistant"]' },
      { title: 'Plantillas de WhatsApp', desc: 'Mensajes aprobados para citas, cobros y seguimiento.', route: 'plantillas', check: 'template' },
      { title: 'Automatizaciones', desc: 'Recordatorios, entrega al equipo y reglas compartidas.', route: 'conexiones', target: '[data-connection-tab="automations"]' },
      { title: 'Probar al asistente', desc: 'Escribe como paciente y revisa la respuesta antes de activar.', route: 'conexiones', target: '[data-connection-tab="lab"]' }
    ] },
    { id: 'cobros', title: 'Cobros', blurb: 'Pagos, anticipos y datos fiscales.', items: [
      { title: 'Cobros y pagos', desc: 'Pagos recibidos, recibos y reembolsos.', route: 'caja', embed: true, target: '[data-finance-tab="payments"]' },
      { title: 'Corte de caja', desc: 'Cierra el día y cuadra lo cobrado.', route: 'caja', embed: true, target: '[data-finance-tab="cash"]' },
      { title: 'Facturación', desc: 'Datos fiscales de la clínica y preparación de facturas.', route: 'caja', embed: true, target: '[data-finance-tab="fiscal"]' },
      { title: 'Formas de pago y anticipo', desc: 'Qué formas de pago aceptas y cuánto pides por adelantado.', soon: true }
    ] },
    { id: 'cuenta', title: 'Cuenta y seguridad', blurb: 'Plan, protección y preparación operativa.', items: [
      { title: 'Plan y consumo', desc: 'Consulta el uso de tu plan y los límites disponibles.', route: 'mi-cuenta' },
      { title: 'Seguridad', desc: 'Accesos, señales y revisiones de tu cuenta.', route: 'seguridad' },
      { title: 'Preparación operativa', desc: 'Controles pendientes antes de atender pacientes.', route: 'lanzamiento' }
    ] }
  ];

  // Estado de una tarjeta a partir de los resultados verificados (o nada si no se pudo verificar).
  function status(check, results, services) {
    if (check === 'services') return services == null ? null : services > 0 ? { text: services + (services === 1 ? ' activo' : ' activos'), tone: 'ok' } : { text: 'Sin servicios', tone: 'todo' };
    var r = results && results[check];
    if (!r || r.unknown) return null;
    if (check === 'hours') return r.done ? { text: 'Horario listo', tone: 'ok' } : { text: 'Falta el horario', tone: 'todo' };
    if (check === 'whatsapp') return r.done ? { text: 'Conectado', tone: 'ok' } : { text: 'Sin conectar', tone: 'todo' };
    if (check === 'template') return r.done ? { text: 'Hay una aprobada', tone: 'ok' } : r.waiting ? { text: 'Meta la revisa', tone: 'wait' } : { text: 'Sin plantilla aprobada', tone: 'todo' };
    if (check === 'reminders') return r.done ? { text: 'Activos', tone: 'ok' } : { text: 'Apagados', tone: 'todo' };
    return null;
  }

  function pendingCount(section, results, services) {
    return section.items.filter(function (i) { var s = i.check && status(i.check, results, services); return s && s.tone === 'todo'; }).length;
  }

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function read() { try { return win.localStorage.getItem(STORE_KEY); } catch (_) { return null; } }
  function save(value) { try { win.localStorage.setItem(STORE_KEY, value); } catch (_) {} }

  function mount() {
    var state = { section: read() || 'clinica', services: null, loadedAt: 0, from: '', detail: null };
    if (!SECTIONS.some(function (s) { return s.id === state.section; })) state.section = 'clinica';
    var page = el('section', 'pantalla settings-hub'); page.id = 'p-configuracion';
    var head = el('header', 'settings-hub-head');
    head.append(el('span', 'settings-hub-kicker', 'CENTRO ADMINISTRATIVO'), el('h1', '', 'Configuración'), el('p', '', 'Elige un área y completa una tarea a la vez.'));
    var layout = el('div', 'settings-hub-layout');
    var nav = el('nav', 'settings-hub-nav'); nav.setAttribute('aria-label', 'Secciones de configuración');
    var panel = el('section', 'settings-hub-panel'); panel.setAttribute('aria-live', 'polite');
    layout.append(nav, panel); page.append(head, layout);
    document.querySelector('.contenido').append(page);

    function results() { var s = win.SmylClinicSetup; return s && typeof s.results === 'function' ? s.results() : null; }

    // Muestra una pantalla existente (o una tarjeta suya) dentro de Configuración, sin copiarla: se reubica el mismo elemento y,
    // al salir, vuelve a su lugar exacto (una marca de posición guarda dónde estaba). Los módulos siguen encontrándolo por su id.
    function detailNode(item) { return item.element ? document.querySelector(item.element) : document.getElementById('p-' + item.route); }

    function restoreDetail() {
      var d = state.detail; if (!d) return;
      state.detail = null;
      if (d.page) d.node.classList.remove('activa');
      if (d.mark.parentNode) { d.mark.parentNode.insertBefore(d.node, d.mark); d.mark.remove(); }
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
      var d = state.detail;
      var bar = el('div', 'settings-hub-detail-bar');
      var back = el('button', 'settings-hub-detail-back'); back.type = 'button';
      back.append(el('span', '', '←'), document.createTextNode(' ' + current.title));
      back.addEventListener('click', function () { restoreDetail(); render(); });
      bar.append(back, el('h2', '', d.item.title));
      var host = el('div', 'settings-hub-embed');
      panel.append(bar, host);
      host.append(d.node);
      if (d.page) d.node.classList.add('activa');
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

    function card(item) {
      var s = item.check ? status(item.check, results(), state.services) : null;
      var node = el(item.soon ? 'div' : 'button', 'settings-hub-card');
      if (!item.soon) node.type = 'button'; else node.setAttribute('aria-disabled', 'true');
      node.dataset.soon = String(Boolean(item.soon));
      var top = el('span', 'settings-hub-card-top'); top.append(el('strong', '', item.title));
      if (item.soon) top.append(el('em', 'settings-hub-chip', 'Próximamente'));
      else if (s) { var chip = el('em', 'settings-hub-chip', s.text); chip.dataset.tone = s.tone; top.append(chip); }
      node.append(top, el('span', 'settings-hub-card-desc', item.desc));
      if (!item.soon) { node.append(el('span', 'settings-hub-card-go', 'Abrir')); node.addEventListener('click', function () { if (item.embed) openDetail(item); else go(item); }); }
      return node;
    }

    function render() {
      var res = results(), current = SECTIONS.filter(function (s) { return s.id === state.section; })[0];
      nav.replaceChildren();
      SECTIONS.forEach(function (section) {
        var b = el('button', 'settings-hub-nav-item'); b.type = 'button'; b.dataset.section = section.id;
        if (section.id === state.section) b.setAttribute('aria-current', 'true');
        var label = el('span', 'settings-hub-nav-copy'); label.append(el('strong', '', section.title), el('small', '', section.blurb));
        b.append(label);
        var open = pendingCount(section, res, state.services);
        if (open) { var badge = el('i', 'settings-hub-badge', String(open)); badge.setAttribute('aria-label', open + (open === 1 ? ' pendiente' : ' pendientes')); b.append(badge); }
        b.addEventListener('click', function () { restoreDetail(); state.section = section.id; save(section.id); render(); });
        nav.append(b);
      });
      panel.replaceChildren();
      if (state.detail) { renderDetail(current); return; }
      var title = el('div', 'settings-hub-panel-head');
      var copy = el('div', ''); copy.append(el('span', 'settings-hub-path', 'Configuración / ' + current.title), el('h2', '', current.title), el('p', '', current.blurb));
      title.append(copy, el('span', 'settings-hub-count', current.items.length + (current.items.length === 1 ? ' opción' : ' opciones')));
      var grid = el('div', 'settings-hub-grid');
      current.items.forEach(function (item) { grid.append(card(item)); });
      panel.append(title, grid);
    }

    async function refresh() {
      var setup = win.SmylClinicSetup;
      var jobs = [];
      if (setup && typeof setup.reload === 'function') jobs.push(Promise.resolve(setup.reload()).catch(function () {}));
      if (win.tenantId && win.sb) {
        var query = win.sb.from('smyl_services').select('id', { count: 'exact', head: true }).eq('tenant_id', win.tenantId).eq('active', true);
        jobs.push(Promise.resolve(typeof win.sbTimeout === 'function' ? win.sbTimeout(query) : query).then(function (r) { if (r && !r.error && typeof r.count === 'number') state.services = r.count; }).catch(function () {}));
      }
      await Promise.all(jobs);
      state.loadedAt = Date.now();
      if (page.classList.contains('activa') && !state.detail) render();
    }

    // «Volver a Configuración»: aparece arriba de la pantalla a la que llegaste desde aquí y desaparece al ir a otra.
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
      open: function (section) { if (section && SECTIONS.some(function (s) { return s.id === section; })) { state.section = section; save(section); } win.ir('configuracion'); },
      sections: function () { return SECTIONS.map(function (s) { return s.id; }); },
      refresh: refresh
    });
    var previous = win.ir;
    win.ir = function (route) {
      if (route !== 'configuracion') restoreDetail();
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
    // Con `defer`, readyState puede ser «interactive»: espera un turno para que el valor
    // exportado por la fábrica no reemplace la API montada (`open`, `refresh`).
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else setTimeout(init, 0);
  }

  return { SECTIONS: SECTIONS, status: status, pendingCount: pendingCount };
});
