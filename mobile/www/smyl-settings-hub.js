/* SMYL · Configuración: un solo lugar con las secciones en el mismo orden que el panel de LANA
   (Negocio, Ventas y cobros, Catálogo, Canales y Experiencia) más Seguridad y lanzamiento.
   Es solo un índice: cada tarjeta lleva a la pantalla que ya existe y no cambia ningún dato.
   Los avisos de estado son de solo lectura y salen de las verificaciones de «Configura tu clínica». */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(null);
  else root.SmylSettingsHub = factory(root);
})(typeof self !== 'undefined' ? self : this, function (win) {
  'use strict';

  var STORE_KEY = 'smyl_settings_section';

  // `check` enlaza una tarjeta con una verificación; `soon` marca lo que todavía no existe en SMYL.
  var SECTIONS = [
    { id: 'negocio', title: 'Negocio', blurb: 'Los datos de tu clínica, tu equipo y tu plan.', items: [
      { title: 'Sucursales, sillones y horario', desc: 'Dónde atiendes, en qué espacios y a qué hora.', route: 'clinica', embed: true, target: '[data-ca-tab="operacion"]', check: 'hours' },
      { title: 'Equipo y roles', desc: 'Quién entra a tu cuenta y qué puede ver o hacer cada persona.', route: 'clinica', embed: true, target: '[data-ca-tab="equipo"]' },
      { title: 'Mi cuenta y plan', desc: 'Tus datos personales y cuánto llevas usado de tu plan.', route: 'mi-cuenta' },
      { title: 'Facturación', desc: 'Datos fiscales de la clínica y preparación de facturas. Se administra dentro de Finanzas.', route: 'caja', embed: true, target: '[data-finance-tab="fiscal"]' }
    ] },
    { id: 'cobros', title: 'Ventas y cobros', blurb: 'Cómo cobras y cómo ves lo que te deben.', items: [
      { title: 'Cobros y pagos', desc: 'Pagos recibidos, recibos y reembolsos.', route: 'caja', embed: true, target: '[data-finance-tab="payments"]' },
      { title: 'Corte de caja', desc: 'Cierra el día y cuadra lo cobrado.', route: 'caja', embed: true, target: '[data-finance-tab="cash"]' },
      { title: 'Formas de pago y anticipo', desc: 'Qué formas de pago aceptas y cuánto pides por adelantado.', soon: true }
    ] },
    { id: 'catalogo', title: 'Catálogo', blurb: 'Lo que ofreces: tratamientos, precios y materiales.', items: [
      { title: 'Servicios y tarifas', desc: 'Tratamientos, duración, precio y claves fiscales.', route: 'precios', check: 'services' },
      { title: 'Materiales e inventario', desc: 'Existencias, compras y el material que usa cada tratamiento.', route: 'inventario' },
      { title: 'Horarios y servicios de la agenda', desc: 'Quién atiende cada tratamiento y en qué horarios.', route: 'agenda', target: '[data-schedule-tab="settings"]' }
    ] },
    { id: 'canales', title: 'Canales', blurb: 'Por dónde hablas con tus pacientes y cómo los atiende tu asistente.', items: [
      { title: 'WhatsApp, Instagram y Messenger', desc: 'Conecta las cuentas con las que hablas con tus pacientes.', route: 'conexiones', target: '[data-connection-tab="channels"]', check: 'whatsapp' },
      { title: 'Asistente de mensajes', desc: 'Cómo atiende tu asistente y qué sabe de tu clínica.', route: 'conexiones', target: '[data-connection-tab="assistant"]' },
      { title: 'Probar al asistente', desc: 'Escribe como paciente y revisa cómo responde antes de activarlo.', route: 'conexiones', target: '[data-connection-tab="lab"]' },
      { title: 'Plantillas de WhatsApp', desc: 'Mensajes aprobados por Meta para escribirle primero a un paciente.', route: 'plantillas', embed: true, check: 'template' },
      { title: 'Recordatorios de cita', desc: 'Avisos automáticos antes de cada cita para que no falten.', route: 'agenda', embed: true, element: '#schedule-reminders-card', check: 'reminders' },
      { title: 'Perfil público de WhatsApp', desc: 'Descripción, dirección y foto con las que te ven tus pacientes.', soon: true }
    ] },
    { id: 'experiencia', title: 'Experiencia', blurb: 'Cómo te ven tus pacientes.', items: [
      { title: 'Marca y simulación', desc: 'Nombre, colores y mensaje de bienvenida de tu enlace para pacientes.', route: 'sim-config' },
      { title: 'Directorio profesional', desc: 'Tu perfil público para recibir solicitudes de cita.', route: 'directorio' },
      { title: 'Colaboraciones', desc: 'Trabajo conjunto con otros profesionales.', route: 'colaboraciones', soon: true }
    ] },
    { id: 'seguridad', title: 'Seguridad y lanzamiento', blurb: 'Que todo esté protegido y listo antes de atender pacientes.', items: [
      { title: 'Preparación operativa', desc: 'Lista de controles antes de empezar a operar.', route: 'lanzamiento' },
      { title: 'Seguridad', desc: 'Accesos, señales y revisiones de tu cuenta.', route: 'seguridad' }
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
    var state = { section: read() || 'negocio', services: null, loadedAt: 0, from: '', detail: null };
    if (!SECTIONS.some(function (s) { return s.id === state.section; })) state.section = 'negocio';
    var page = el('section', 'pantalla settings-hub'); page.id = 'p-configuracion';
    var head = el('header', 'settings-hub-head');
    head.append(el('h1', '', 'Configuración'), el('p', '', 'Todo lo que puedes ajustar en tu clínica, en un solo lugar.'));
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
        b.append(el('span', '', section.title));
        var open = pendingCount(section, res, state.services);
        if (open) { var badge = el('i', 'settings-hub-badge', String(open)); badge.setAttribute('aria-label', open + (open === 1 ? ' pendiente' : ' pendientes')); b.append(badge); }
        b.addEventListener('click', function () { restoreDetail(); state.section = section.id; save(section.id); render(); });
        nav.append(b);
      });
      panel.replaceChildren();
      if (state.detail) { renderDetail(current); return; }
      var title = el('div', 'settings-hub-panel-head'); title.append(el('h2', '', current.title), el('p', '', current.blurb));
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
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  }

  return { SECTIONS: SECTIONS, status: status, pendingCount: pendingCount };
});
