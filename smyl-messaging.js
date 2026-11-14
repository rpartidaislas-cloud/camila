/* SMYL · Módulos de mensajería. Los envíos reales permanecen en sus servicios seguros. */
(function () {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function go(route) {
    if (typeof window.ir === 'function') window.ir(route);
  }

  function action(label, route, primary) {
    var button = el('button', primary ? 'btn btn-primary' : 'btn btn-secondary', label);
    button.type = 'button';
    button.addEventListener('click', function () { go(route); });
    return button;
  }

  function page(route, eyebrow, title, description) {
    var section = el('section', 'pantalla messaging-page');
    section.id = 'p-' + route;
    var header = el('header', 'messaging-head');
    var copy = el('div');
    copy.append(el('span', 'pro-eyebrow', eyebrow), el('h1', '', title), el('p', '', description));
    header.append(copy, el('span', 'messaging-status', 'Controlado por la clínica'));
    section.append(header);
    return section;
  }

  function checklist(items) {
    var list = el('ul', 'messaging-checklist');
    items.forEach(function (item, index) {
      var row = el('li');
      var copy = el('div');
      copy.append(el('strong', '', item[0]), el('span', '', item[1]));
      row.append(el('i', '', String(index + 1).padStart(2, '0')), copy);
      list.append(row);
    });
    return list;
  }

  function buildEmail() {
    var section = page('correo', 'MENSAJERÍA · CORREO', 'Correo', 'Conecta el remitente de la clínica y consulta la actividad de propuestas enviadas.');
    var grid = el('div', 'messaging-grid');
    var host = el('div', 'messaging-email-host'); host.id = 'messaging-email-host';
    var guide = el('aside', 'messaging-card messaging-guardrail');
    guide.append(el('strong', '', 'Correo bajo control'), el('p', '', 'SMYL utiliza el servicio conectado para entregar enlaces autorizados. No expone contraseñas ni envía contenido clínico sin una acción del equipo.'));
    grid.append(host, guide); section.append(grid);
    return section;
  }

  function buildBulk() {
    var section = page('mensajes-masivos', 'MENSAJERÍA · AUDIENCIAS', 'Mensajes masivos', 'Prepara comunicaciones para grupos con consentimiento, revisión humana y una plantilla aprobada.');
    var grid = el('div', 'messaging-grid');
    var card = el('article', 'messaging-card');
    var head = el('header'); var headCopy = el('div');
    headCopy.append(el('h2', '', 'Antes de enviar'), el('p', '', 'La preparación se separa del envío para evitar mensajes accidentales.'));
    head.append(headCopy); card.append(head);
    var body = el('div', 'messaging-card-body');
    body.append(checklist([
      ['Elige una audiencia verificable', 'Pacientes vinculados, con canal disponible y permiso vigente.'],
      ['Usa una plantilla aprobada', 'Fuera de la ventana de 24 horas WhatsApp exige una plantilla de Meta.'],
      ['Revisa y confirma', 'El equipo valida destinatarios, variables y horario antes de cualquier envío.']
    ]));
    var actions = el('div', 'messaging-actions');
    actions.append(action('Revisar plantillas', 'plantillas', true), action('Abrir Chat', 'inbox', false));
    body.append(actions); card.append(body);
    var safety = el('aside', 'messaging-card messaging-guardrail');
    safety.append(el('strong', '', 'Sin envíos automáticos'), el('p', '', 'Este espacio prepara el flujo. El envío masivo quedará bloqueado hasta validar audiencia, consentimiento, plantilla y capacidad del canal.'));
    grid.append(card, safety); section.append(grid);
    return section;
  }

  function buildCampaigns() {
    var section = page('campanas', 'MENSAJERÍA · CAMPAÑAS', 'Campañas', 'Organiza objetivos, audiencia, mensajes y seguimiento sin mezclar la comunicación con el expediente clínico.');
    var grid = el('div', 'messaging-grid');
    var empty = el('article', 'messaging-card messaging-empty');
    empty.append(el('span', 'messaging-empty-icon', '◎'), el('h2', '', 'Crea la base de tu primera campaña'), el('p', '', 'Empieza por una plantilla aprobada y una audiencia con consentimiento. Después podrás revisar resultados y dar seguimiento desde Chat.'));
    var actions = el('div', 'messaging-actions');
    actions.append(action('Explorar plantillas', 'plantillas', true), action('Preparar audiencia', 'mensajes-masivos', false));
    empty.append(actions);
    var guide = el('aside', 'messaging-card messaging-guardrail');
    guide.append(el('strong', '', 'Separación profesional'), el('p', '', 'Las campañas usan datos mínimos de contacto y consentimiento; no muestran diagnósticos, radiografías ni notas del expediente.'));
    grid.append(empty, guide); section.append(grid);
    return section;
  }

  function init() {
    var content = document.querySelector('.contenido');
    if (!content || document.getElementById('p-correo')) return;
    content.append(buildEmail(), buildBulk(), buildCampaigns());
    window.TITULOS = window.TITULOS || {};
    window.TITULOS.correo = 'Correo';
    window.TITULOS['mensajes-masivos'] = 'Mensajes masivos';
    window.TITULOS.campanas = 'Campañas';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
