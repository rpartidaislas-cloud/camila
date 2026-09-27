/* Presentation and photo navigation only. Generation stays in the existing pipeline. */
(function () {
  'use strict';
  var busy = false, selected = 'frontal';
  var byId = function (id) { return document.getElementById(id); };
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(text, action, cls) {
    var node = element('button', cls || 'flow-secondary', text);
    node.type = 'button'; node.onclick = action; return node;
  }
  function label(view) {
    return CASE_VIEW_GROUPS.flatMap(function(g){return g.views;}).find(function(v){return v[0] === view;})?.[1] || view;
  }
  function steps(active) {
    var nav = element('nav', 'flow-steps'); nav.setAttribute('aria-label', 'Progreso del caso');
    ['Fotografías', 'Opciones', 'Resultado'].forEach(function(text, index) {
      var item = element('span', index === active ? 'current' : '', (index + 1) + '  ' + text);
      if(index === active) item.setAttribute('aria-current', 'step');
      nav.append(item);
    }); return nav;
  }
  function openPhotos() {
    if(busy)return;
    S.quickGuided = true; S.vitaReturnToResult = false;
    render(); show('s-photos');
    if(S.photos.length) saveProgress('s-vita');
  }
  function pick(view, camera) {
    if(busy)return;
    selected = view;
    var input = byId('flow-upload');
    if(camera) input.setAttribute('capture', 'environment'); else input.removeAttribute('capture');
    input.click();
  }
  async function upload() {
    var input = byId('flow-upload'), file = input.files[0], view = selected;
    if(!file || busy)return;
    if(!fotoPropiaPermitida(file)) {
      input.value = ''; mostrarAvisoAplicacion('Fotografía no válida', 'Usa JPG, PNG o WebP de hasta 20 MB.'); return;
    }
    busy = true; render();
    try {
      var data = await leerFotoPropia(file);
      var b64 = await redimensionarFotoB64(data, 1280, .92);
      var photo = {view:view, b64:b64, mimeType:'image/jpeg'};
      var index = S.photos.findIndex(function(p){return p.view === view;});
      if(index < 0) S.photos.push(photo); else S.photos[index] = photo;
      invalidarVistaCargada(view);
      S.quickGuided = true;
      S.independentIntraoral = S.photos.length === 1 && view === 'intraoral';
      saveProgress('s-vita');
    } catch(error) {
      mostrarAvisoAplicacion('No se pudo cargar la foto', 'La fotografía anterior se conserva. Intenta con otro archivo.');
    } finally {busy = false; input.value = ''; render();}
  }
  function render() {
    var host = byId('flow-photo-groups'); host.replaceChildren();
    CASE_VIEW_GROUPS.forEach(function(group) {
      var section = element('section', 'flow-photo-section');
      section.append(element('h2', '', group.name));
      section.append(element('p', 'flow-muted', group.name === 'Intraorales'
        ? 'Puedes simularlas por separado. También aportan referencias a las vistas del rostro.'
        : 'Añade las vistas que quieras. Puedes empezar con cualquiera.'));
      var grid = element('div', 'flow-photo-grid');
      group.views.forEach(function(entry) {
        var photo = S.photos.find(function(p){return p.view === entry[0];});
        var card = element('article', 'flow-photo-card' + (photo ? ' loaded' : ''));
        if(photo) {
          var image = element('img'); image.alt = entry[1];
          image.src = photo.dataUrl || 'data:' + (photo.mimeType || 'image/jpeg') + ';base64,' + photo.b64;
          card.append(image);
        } else {var placeholder = element('div', 'flow-photo-empty', '+'); placeholder.setAttribute('aria-hidden', 'true'); card.append(placeholder);}
        card.append(element('h3', '', entry[1]));
        if(photo && S.photos[0] === photo) card.append(element('span', 'flow-badge', 'Primera en generar'));
        var actions = element('div', 'flow-card-actions');
        actions.append(button(photo ? 'Cambiar' : 'Subir foto', function(){pick(entry[0], false);}));
        if(!photo) actions.append(button('Tomar foto', function(){pick(entry[0], true);}, 'flow-text'));
        else {
          if(S.photos[0] !== photo) actions.append(button('Generar primero', function(){S.photos = [photo].concat(S.photos.filter(function(p){return p!==photo;})); saveProgress('s-vita'); render();}, 'flow-text'));
          actions.append(button('Quitar', function(){S.photos = S.photos.filter(function(p){return p!==photo;}); invalidarVistaCargada(entry[0]); saveProgress('s-vita'); render();}, 'flow-text'));
        }
        card.append(actions); grid.append(card);
      }); section.append(grid); host.append(section);
    });
    byId('flow-photo-count').textContent = busy ? 'Preparando fotografía…' : S.photos.length + (S.photos.length === 1 ? ' fotografía añadida' : ' fotografías añadidas');
    byId('flow-continue').disabled = busy || !S.photos.length;
    byId('flow-photo-groups').querySelectorAll('button').forEach(function(b){b.disabled=busy;});
  }
  function configure() {
    if(busy || !S.photos.length)return;
    S.baVistaActual = S.photos[0].view;
    byId('flow-config-summary').textContent = 'Primero: ' + label(S.photos[0].view) + '. Las demás vistas se generan cuando las elijas.';
    abrirConfiguracionRapida();
  }
  function init() {
    document.body.classList.add('smyl-organized');
    var intro = byId('s-intro');
    var hero = element('section', 'flow-home');
    hero.innerHTML = '<div class="flow-eyebrow">SMYL · ESTUDIO DE SONRISA</div><h1>Una nueva sonrisa.<br>Un proceso sencillo.</h1><p>Reúne las fotografías, elige el efecto y compara el resultado con tu paciente.</p><div class="flow-home-route"><span><b>01</b> Fotografías</span><span><b>02</b> Opciones</span><span><b>03</b> Resultado</span></div>';
    hero.append(button('Crear simulación', openPhotos, 'flow-primary'));
    var logo = element('img', 'flow-home-logo'); logo.src='icons/smyl_logo.png'; logo.alt='SMYL'; hero.prepend(logo);
    hero.append(element('p', 'flow-home-note', 'Rostro o intraorales. Una foto es suficiente para comenzar.'));
    intro.prepend(hero);
    var screen = element('div', 'screen'); screen.id = 's-photos';
    var shell = element('div', 'flow-shell');
    shell.innerHTML = '<header class="flow-heading"><img src="icons/smyl_logo.png" alt="SMYL"><span>Nuevo caso</span></header>';
    shell.append(steps(0));
    var title = element('div','flow-title');
    title.append(element('h1','','Las fotografías de tu caso'));
    title.append(element('p','flow-muted','Usa fotos de la misma persona. Derecha e izquierda corresponden al paciente.'));
    shell.append(title);
    var groups = element('div'); groups.id = 'flow-photo-groups'; shell.append(groups);
    var footer = element('footer','flow-footer');
    var status = element('span'); status.id='flow-photo-count'; status.setAttribute('role','status'); footer.append(status);
    footer.append(button('Volver',function(){if(!busy)show('s-intro');},'flow-text'));
    var next=button('Continuar a opciones',configure,'flow-primary'); next.id='flow-continue';footer.append(next);shell.append(footer);
    var input=element('input');input.type='file';input.id='flow-upload';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;input.onchange=upload;shell.append(input);
    screen.append(shell);document.body.append(screen);
    var config=byId('quick-config');
    var back=button('← Fotografías',openPhotos,'flow-text');config.prepend(back);
    var summary=element('p','flow-muted');summary.id='flow-config-summary';back.after(summary);
    byId('s-vita').querySelector('.vita-shell').prepend(steps(1));
    byId('quick-config-title').textContent='Elige el resultado';
    var toneLabel=config.querySelector('label[for="quick-vita-tone"]');
    var toneDetails=element('details','flow-tones');
    toneDetails.append(element('summary','','Ver todos los tonos VITA'));
    toneLabel.before(toneDetails);toneDetails.append(toneLabel,byId('quick-vita-tone'));
    var oldDetails=config.querySelector('details');oldDetails.hidden=true;
    var resHeader=byId('s-res').querySelector('.res-header');
    var oldNewPhoto=resHeader.querySelector('button[onclick="repetirFotografias()"]');
    if(oldNewPhoto)oldNewPhoto.hidden=true;
    var tools=element('details','flow-result-tools');tools.append(element('summary','','Más herramientas'));
    var toolBody=element('div','flow-tool-body');tools.append(toolBody);
    Array.from(resHeader.querySelectorAll('.res-vita-btn')).forEach(function(control){if(control.id!=='res-vita-btn')toolBody.append(control);});
    var resultBody=byId('s-res').querySelector('.res-body');
    ['btn-editor-diseno','btn-revision-clinica','diag-request-box'].forEach(function(id){if(byId(id))toolBody.append(byId(id));});
    resultBody.prepend(tools);
    var photoButton=button('Fotografías del caso',openPhotos,'flow-secondary');resHeader.append(photoButton);
    byId('s-res').querySelector('.res-logo').after(steps(2));
    render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
