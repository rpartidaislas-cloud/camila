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
    TITULOS.dashboard = 'Inicio'; TITULOS.historial = 'Casos';
    TITULOS.propuestas = 'Propuestas'; TITULOS['nuevo-diseno'] = 'Valoración y diseño';
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
    primary.append(take('dashboard', 'Inicio'), take('pacientes', 'Pacientes'), take('historial', 'Casos'));
    var proposals = navButton('Propuestas', 'propuestas');
    proposals.append(node('small', 'pro-next', 'Próximamente')); primary.append(proposals);
    var settings = node('details', 'pro-settings'); settings.append(node('summary', '', 'Configuración y herramientas'));
    ['nuevo-diseno','colaboraciones','notificaciones','precios','sim-config','mi-cuenta'].forEach(function (route, index) {
      settings.append(take(route, ['Valoración y diseño','Equipo y colaboraciones','Notificaciones','Precios de la clínica','Marca y simulación','Mi cuenta'][index]));
    });
    sidebar.replaceChildren(primary, settings);
    var topButton = document.querySelector('.topbar-right .btn-primary');
    topButton.replaceWith(link('Nueva simulación', 'simulacion-rapida.html?workspace=professional', 'btn btn-primary'));
    document.querySelector('.sb-logo span').textContent = 'Panel profesional';
    var main = document.querySelector('.contenido');
    var mobile = node('nav', 'pro-mobile-nav'); mobile.setAttribute('aria-label', 'Panel profesional móvil');
    [['Inicio','dashboard'],['Pacientes','pacientes'],['Casos','historial'],['Propuestas','propuestas']].forEach(function (entry) {
      mobile.append(navButton(entry[0], entry[1]));
    });
    main.before(mobile);
    var home = document.getElementById('p-dashboard');
    var hero = node('section', 'pro-welcome');
    hero.innerHTML = '<div><p class="pro-eyebrow">TU ESPACIO DE CONSULTA</p><h1>De una fotografía<br>a una nueva posibilidad.</h1><p>Prepara una simulación con tu paciente y continúa su caso a tu ritmo.</p><a class="btn btn-primary" href="simulacion-rapida.html?workspace=professional">Nueva simulación <span aria-hidden="true">↗</span></a></div><aside><span class="pro-step-number">01 — 02</span><h2>Prepara. Compara.</h2><p>Una foto es suficiente para empezar. Puedes añadir otras vistas e intraorales como apoyo.</p><span class="pro-welcome-note">Las decisiones clínicas siempre son tuyas.</span></aside>';
    home.prepend(hero);
    var stats = home.querySelector('.stats-grid');
    stats.classList.add('pro-stats');
    var columns = stats.nextElementSibling; columns.classList.add('pro-dashboard-columns');
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
