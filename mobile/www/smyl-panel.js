/* Stage 2: presentation only. Existing authentication, permissions and loaders stay authoritative. */
(function () {
  'use strict';
  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  }
  function link(text, href, cls) {
    var el = node('a', cls, text); el.href = href; return el;
  }
  function navButton(text, route) {
    var el = node('button', 'nav-item', text); el.type = 'button';
    el.setAttribute('onclick', "ir('" + route + "')");
    return el;
  }
  function init() {
    document.body.classList.add('smyl-professional');
    var title = document.getElementById('topbar-title');
    TITULOS.dashboard = 'Inicio'; TITULOS.historial = 'Simulaciones anteriores';
    TITULOS.propuestas = 'Presentaciones'; TITULOS['nuevo-diseno'] = 'Valoración y diseño';
    if (title.textContent === 'Dashboard') title.textContent = 'Inicio';
    var sidebar = document.querySelector('.sidebar .nav-items');
    var old = Array.from(sidebar.querySelectorAll('.nav-item'));
    function take(route, text) {
      var el = old.find(function (item) { return item.getAttribute('onclick') === "ir('" + route + "')"; });
      if (!el) return navButton(text, route);
      Array.from(el.childNodes).filter(function (n) { return n.nodeType === 3; }).forEach(function (n) { n.remove(); });
      el.append(document.createTextNode(text));
      el.setAttribute('role', 'button'); el.tabIndex = 0;
      el.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); el.click(); }
      });
      return el;
    }
    var primary = node('nav', 'pro-primary-nav'); primary.setAttribute('aria-label', 'Panel profesional');
    primary.append(take('dashboard', 'Inicio'), take('pacientes', 'Pacientes'), navButton('Presentaciones', 'propuestas'));
    var settings = node('details', 'pro-settings'); settings.append(node('summary', '', 'Archivo y configuración'));
    ['historial','nuevo-diseno','colaboraciones','notificaciones','precios','sim-config','mi-cuenta'].forEach(function (route, index) {
      settings.append(take(route, ['Simulaciones anteriores','Valoración y diseño','Equipo y colaboraciones','Notificaciones','Precios de la clínica','Marca y simulación','Mi cuenta'][index]));
    });
    sidebar.replaceChildren(primary, settings);
    var topButton = document.querySelector('.topbar-right .btn-primary');
    topButton.replaceWith(link('Nueva simulación', 'simulacion-rapida.html?workspace=professional', 'btn btn-primary'));
    document.querySelector('.sb-logo span').textContent = 'Panel profesional';
    var main = document.querySelector('.contenido');
    var mobile = node('nav', 'pro-mobile-nav'); mobile.setAttribute('aria-label', 'Panel profesional móvil');
    [['Inicio','dashboard'],['Pacientes','pacientes'],['Presentaciones','propuestas']].forEach(function (entry) {
      mobile.append(navButton(entry[0], entry[1]));
    });
    main.before(mobile);
    var home = document.getElementById('p-dashboard');
    var hero = node('section', 'pro-welcome');
    hero.innerHTML = '<div><p class="pro-eyebrow">TU MESA DE TRABAJO</p><h1>Continúa donde<br>lo dejaste.</h1><p>Abre la ficha del paciente y SMYL te mostrará el siguiente paso, desde las fotografías hasta la presentación.</p><a class="btn btn-primary" href="#" data-open-patients>Ver pacientes <span aria-hidden="true">→</span></a></div><aside><span class="pro-step-number">UN SOLO RECORRIDO</span><h2>Fotografías. Revisión. Plan. Compartir.</h2><p>Cada caso avanza dentro del expediente. No necesitas buscarlo en varias secciones.</p><a class="pro-welcome-note" href="simulacion-rapida.html?workspace=professional">+ Iniciar una nueva simulación</a></aside>';
    hero.querySelector('[data-open-patients]').addEventListener('click', function (event) { event.preventDefault(); window.ir('pacientes'); });
    home.prepend(hero);
    var stats = home.querySelector('.stats-grid');
    stats.classList.add('pro-stats');
    var columns = stats.nextElementSibling; columns.classList.add('pro-dashboard-columns');
    var recentTitle = columns.querySelector('.card-title');
    if (recentTitle) recentTitle.textContent = 'Actividad reciente';
    var recentLink = columns.querySelector('.card-header a');
    if (recentLink) { recentLink.textContent = 'Abrir pacientes →'; recentLink.setAttribute('onclick', "ir('pacientes')"); }
    var future = node('section', 'pantalla'); future.id = 'p-propuestas';
    future.innerHTML = '<div class="pro-coming"><span class="pro-eyebrow">SIGUIENTE ETAPA</span><h1>Una propuesta que acompaña tu criterio.</h1><p>Aquí reunirás el tratamiento revisado, las fotografías y la cotización para presentarlos al paciente.</p><div class="pro-coming-grid"><article><h2>Preparar en SMYL</h2><p>Valorar, ajustar el tratamiento y aprobar la propuesta clínica.</p></article><article><h2>Gestionar con LANA</h2><p>Vincular al cliente, enviar la propuesta y dar seguimiento comercial.</p></article></div><p class="pro-status-note">Este espacio está en preparación. La conexión completa con LANA y los envíos aún no están habilitados aquí.</p><button type="button" class="btn btn-secondary" onclick="ir(\'historial\')">Consultar mis casos actuales</button></div>';
    main.append(future);
    var previous = window.ir;
    window.ir = function (route) {
      previous(route);
      document.querySelectorAll('.pro-primary-nav .nav-item,.pro-mobile-nav .nav-item').forEach(function (el) {
        var active = el.getAttribute('onclick') === "ir('" + route + "')";
        if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      });
      if (settings.querySelector('.activo')) settings.open = true;
    };
    primary.firstElementChild.setAttribute('aria-current','page');
    mobile.firstElementChild.setAttribute('aria-current','page');
    // Keep the old mobile admin sheet available for account/team settings.
    var hamburger = document.getElementById('btn-hamburger');
    hamburger.setAttribute('aria-label','Configuración y cuenta');
    document.querySelectorAll('.pam-row[onclick]').forEach(function (el) {
      el.setAttribute('role','button'); el.tabIndex = 0;
      el.addEventListener('keydown',function (e) { if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();} });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
