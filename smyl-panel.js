/* Professional product shell. Existing authentication, permissions and loaders stay authoritative. */
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
    var settings = node('details', 'pro-settings'); settings.append(node('summary', '', 'Herramientas y configuración'));
    ['historial','notificaciones','precios','sim-config','mi-cuenta'].forEach(function (route, index) {
      settings.append(take(route, ['Simulaciones anteriores','Notificaciones','Precios de la clínica','Marca y simulación','Mi cuenta'][index]));
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
    hero.innerHTML = '<div class="pro-welcome-copy"><p class="pro-eyebrow">TU MESA DE TRABAJO</p><h1>Continúa donde<br>lo dejaste.</h1><p>Abre la ficha del paciente y SMYL te mostrará la etapa pendiente, sin perder de vista tu criterio clínico.</p><div class="pro-welcome-actions"><a class="btn btn-primary" href="#" data-open-patients>Ver pacientes <span aria-hidden="true">→</span></a><a class="btn btn-secondary" href="simulacion-rapida.html?workspace=professional">Nueva simulación</a></div></div><aside class="pro-path"><span class="pro-step-number">RUTA CLÍNICA</span><ol class="pro-path-list"><li><span>01</span><div><strong>Evidencias</strong><small>Fotografías y simulaciones del caso</small></div></li><li><span>02</span><div><strong>Revisión clínica</strong><small>Hallazgos que tú confirmas</small></div></li><li><span>03</span><div><strong>Plan de tratamiento</strong><small>Borrador revisado y aprobado</small></div></li><li><span>04</span><div><strong>Compartir</strong><small>Presentación preparada para el paciente</small></div></li></ol></aside>';
    hero.querySelector('[data-open-patients]').addEventListener('click', function (event) { event.preventDefault(); window.ir('pacientes'); });
    home.prepend(hero);
    var actions = node('section', 'pro-action-grid'); actions.setAttribute('aria-label', 'Acciones principales');
    actions.innerHTML = '<article class="pro-action-card"><span>EMPEZAR</span><h2>Registrar evidencias</h2><p>Abre una nueva sesión fotográfica y guárdala en la ficha del paciente.</p><a href="simulacion-rapida.html?workspace=professional">Nueva simulación →</a></article><article class="pro-action-card"><span>CONTINUAR</span><h2>Revisar expedientes</h2><p>Consulta la etapa pendiente de cada caso y continúa desde ahí.</p><button type="button" data-action-patients>Ver pacientes →</button></article><article class="pro-action-card"><span>PRESENTAR</span><h2>Preparar propuesta</h2><p>Revisa el plan, los importes y lo que verá el paciente antes de aprobar.</p><button type="button" data-action-proposals>Ver presentaciones →</button></article>';
    actions.querySelector('[data-action-patients]').addEventListener('click', function () { window.ir('pacientes'); });
    actions.querySelector('[data-action-proposals]').addEventListener('click', function () { window.ir('propuestas'); });
    hero.after(actions);
    var stats = home.querySelector('.stats-grid');
    stats.classList.add('pro-stats');
    var statLabels = stats.querySelectorAll('.stat-lbl');
    if (statLabels[0]) statLabels[0].textContent = 'Créditos disponibles';
    if (statLabels[2]) statLabels[2].textContent = 'Pacientes';
    if (statLabels[3]) statLabels[3].textContent = 'Casos guardados';
    var columns = stats.nextElementSibling; columns.classList.add('pro-dashboard-columns');
    var recentTitle = columns.querySelector('.card-title');
    if (recentTitle) recentTitle.textContent = 'Actividad reciente';
    var recentLink = columns.querySelector('.card-header a');
    if (recentLink) { recentLink.textContent = 'Abrir pacientes →'; recentLink.setAttribute('onclick', "ir('pacientes')"); }
    var future = node('section', 'pantalla'); future.id = 'p-propuestas';
    future.innerHTML = '<div class="pro-coming"><span class="pro-eyebrow">PRESENTACIONES</span><h1>Una propuesta que acompaña tu criterio.</h1><p>Aquí reunirás el tratamiento revisado, las fotografías y la cotización para presentarlos al paciente.</p><div class="pro-coming-grid"><article><h2>Preparar en SMYL</h2><p>Valorar, ajustar el tratamiento y aprobar la propuesta clínica.</p></article><article><h2>Continuar en LANA</h2><p>Atender el chat de Meta y dar seguimiento sin duplicar la conversación.</p></article></div><p class="pro-status-note">La conexión con LANA se administra por clínica. El envío clínico seguirá requiriendo tu revisión y aprobación.</p><div class="pro-welcome-actions"><button type="button" class="btn btn-primary" onclick="ir(\'conexiones\')">Configurar LANA</button><button type="button" class="btn btn-secondary" onclick="ir(\'historial\')">Consultar casos actuales</button></div></div>';
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
    var panelRows = Array.from(document.querySelectorAll('.pam-row'));
    panelRows.forEach(function (row) {
      var label = row.querySelector('.pam-row-label');
      if (!label) return;
      if (label.textContent.trim() === 'Dashboard') label.textContent = 'Inicio';
      if (label.textContent.trim() === 'Nuevo Diseño') {
        label.textContent = 'Nueva simulación';
        row.setAttribute('onclick', "window.location.href='simulacion-rapida.html?workspace=professional'");
      }
      if (label.textContent.trim() === 'Colaboraciones') {
        label.textContent = 'Marca y simulación';
        row.setAttribute('onclick', "pamIr('sim-config')");
        var badge = row.querySelector('.pam-row-badge'); if (badge) badge.remove();
      }
    });
    var patientMobileRow = panelRows.find(function (row) { var label = row.querySelector('.pam-row-label'); return label && label.textContent.trim() === 'Pacientes'; });
    if (patientMobileRow && !document.querySelector('[data-mobile-proposals]')) {
      var proposalMobileRow = patientMobileRow.cloneNode(true);
      proposalMobileRow.dataset.mobileProposals = 'true';
      proposalMobileRow.setAttribute('onclick', "pamIr('propuestas')");
      proposalMobileRow.querySelector('.pam-row-label').textContent = 'Presentaciones';
      var proposalIcon = proposalMobileRow.querySelector('.pam-row-icon');
      if (proposalIcon) proposalIcon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>';
      patientMobileRow.after(proposalMobileRow);
    }
    document.querySelectorAll('.pam-row[onclick]').forEach(function (el) {
      el.setAttribute('role','button'); el.tabIndex = 0;
      el.addEventListener('keydown',function (e) { if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();} });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
