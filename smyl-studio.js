/* Two-moment workspace. Existing consent, persistence and generation remain authoritative. */
(function () {
  'use strict';
  var busy=false, selected='frontal', generating=false;
  var byId=function(id){return document.getElementById(id);};
  function element(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;}
  function button(text,action,cls){var el=element('button',cls||'flow-secondary',text);el.type='button';el.onclick=action;return el;}
  function label(view){var entry=CASE_VIEW_GROUPS.flatMap(function(g){return g.views;}).find(function(v){return v[0]===view;});return entry?entry[1]:view;}
  function source(photo){return photo.dataUrl||'data:'+(photo.mimeType||'image/jpeg')+';base64,'+photo.b64;}
  function steps(active){
    var nav=element('nav','flow-steps');nav.setAttribute('aria-label','Momentos de la simulación');
    ['Preparar','Comparar'].forEach(function(text,index){var item=element('span',index===active?'current':'',(index+1)+'  '+text);if(index===active)item.setAttribute('aria-current','step');nav.append(item);});return nav;
  }
  function openPhotos(){if(busy||generating)return;S.quickGuided=true;abrirConfiguracionRapida();}
  function choose(view){if(busy||generating)return;byId('flow-view-type').value=view||'frontal';byId('flow-picker').showModal();}
  function pick(camera){
    selected=byId('flow-view-type').value;byId('flow-picker').close();var input=byId('flow-upload');
    if(camera)input.setAttribute('capture','environment');else input.removeAttribute('capture');input.click();
  }
  async function upload(){
    var input=byId('flow-upload'),file=input.files[0],view=selected;if(!file||busy||generating)return;
    if(!fotoPropiaPermitida(file)){input.value='';mostrarAvisoAplicacion('Fotografía no válida','Usa JPG, PNG o WebP de hasta 20 MB.');return;}
    busy=true;render();
    try{
      var data=await leerFotoPropia(file),b64=await redimensionarFotoB64(data,1280,.92);
      var photo={view:view,b64:b64,mimeType:'image/jpeg'},index=S.photos.findIndex(function(p){return p.view===view;});
      if(index<0)S.photos.push(photo);else S.photos[index]=photo;
      invalidarVistaCargada(view);S.quickGuided=true;S.independentIntraoral=S.photos.length===1&&view==='intraoral';saveProgress('s-vita');
    }catch(error){mostrarAvisoAplicacion('No se pudo cargar la foto','La fotografía anterior se conserva. Intenta con otro archivo.');}
    finally{busy=false;input.value='';render();}
  }
  function select(photo){S.photos=[photo].concat(S.photos.filter(function(p){return p!==photo;}));S.baVistaActual=photo.view;saveProgress('s-vita');render();}
  function syncPreferences(){
    var design=SmylSmileModes.normalize(S.smileDesign);
    byId('flow-instructions').value=design.instructions;byId('flow-instruction-count').textContent=design.instructions.length+'/500';
    byId('flow-tone-group').hidden=design.mode==='alignment';byId('flow-original-tone').hidden=design.mode!=='alignment';
    document.querySelectorAll('#quick-config .quick-choice').forEach(function(el){el.setAttribute('aria-pressed',String(el.classList.contains('selected')));});
  }
  function render(){
    var stage=byId('flow-main-photo'),strip=byId('flow-photo-strip');stage.replaceChildren();strip.replaceChildren();var primary=S.photos[0];
    if(primary){
      var image=element('img');image.src=source(primary);image.alt=label(primary.view)+' · fotografía original';stage.append(image,element('span','flow-photo-caption',label(primary.view)+' · Original'));
      S.photos.forEach(function(photo){var item=button('',function(){select(photo);},'flow-thumb'+(photo===primary?' selected':''));item.setAttribute('aria-label','Seleccionar '+label(photo.view));item.setAttribute('aria-pressed',String(photo===primary));var thumb=element('img');thumb.src=source(photo);thumb.alt='';item.append(thumb,element('span','',label(photo.view)));strip.append(item);});
    }else{
      var empty=element('div','flow-empty');empty.innerHTML='<span class="flow-empty-symbol" aria-hidden="true">＋</span><h2>Empieza con una fotografía</h2><p>Del rostro o intraoral.<br>La vista que quieras trabajar primero.</p>';empty.append(button('Tomar o subir foto',function(){choose();},'flow-primary'));stage.append(empty);
    }
    byId('flow-edit-photo').hidden=!primary;byId('flow-remove-photo').hidden=!primary;byId('flow-add-photo').hidden=!primary;
    byId('flow-photo-count').textContent=busy?'Preparando fotografía…':S.photos.length+' '+(S.photos.length===1?'fotografía':'fotografías')+' en este caso';
    byId('flow-generate').disabled=busy||generating||!primary;
    byId('flow-generation-note').textContent=primary?'Se generará solo '+label(primary.view).toLowerCase()+'. Las demás vistas quedan disponibles.':'Añade una fotografía para generar tu propuesta.';
    var ref=primary&&referenciaDentalMaestraParaVista(primary.view);
    byId('flow-reference-status').textContent=ref?.role==='original-anatomy'?'Apoyo para esta vista: '+label(ref.view)+'. Su original ayudará a interpretar los dientes; no se generará otra imagen.':'Intraorales opcionales: añádelas como apoyo para distinguir mejor los dientes. También puedes generar su propia simulación.';
    byId('flow-reference-add').hidden=!!(ref?.role==='original-anatomy');
    document.querySelectorAll('#flow-photo-workspace button').forEach(function(el){el.disabled=busy||generating;});syncPreferences();
  }
  async function generate(){if(busy||generating||!S.photos.length)return;generating=true;render();try{await confirmarConfiguracionRapida();}finally{generating=false;render();}}
  function init(){
    document.body.classList.add('smyl-organized');
    var intro=byId('s-intro'),hero=element('section','flow-home');
    hero.innerHTML='<img class="flow-home-logo" src="icons/smyl_logo.png" alt="SMYL"><div class="flow-eyebrow">ESTUDIO DE SONRISA</div><h1>Una fotografía.<br>Una nueva posibilidad.</h1><p>Elige el cambio que buscas y compara la propuesta. Puedes comenzar con cualquier vista.</p>';
    hero.append(button('Crear simulación',openPhotos,'flow-primary'));
    var panelLink=element('a','flow-panel-link','Ir a mi panel profesional');panelLink.href='app.html';hero.append(panelLink,element('p','flow-home-note','Las intraorales son opcionales y también pueden servir como referencia.'));intro.prepend(hero);
    var screen=element('div','screen quick-guided-active');screen.id='s-photos';var shell=element('div','flow-shell');
    shell.innerHTML='<header class="flow-heading"><a href="app.html" aria-label="Volver al panel profesional"><img src="icons/smyl_logo.png" alt="SMYL"></a><a class="flow-panel-link" href="app.html">Panel profesional</a></header>';shell.append(steps(0));
    var heading=element('div','flow-title');heading.innerHTML='<h1>Prepara tu simulación</h1><p class="flow-muted">Tus fotos, tu objetivo. Todo en un mismo lugar.</p>';shell.append(heading);
    var layout=element('div','flow-prepare-grid'),photos=element('section','flow-photo-workspace');photos.id='flow-photo-workspace';
    photos.innerHTML='<div id="flow-main-photo" class="flow-main-photo"></div><div class="flow-photo-toolbar"><span id="flow-photo-count" role="status"></span></div><div id="flow-photo-strip" class="flow-photo-strip"></div>';
    var actions=photos.querySelector('.flow-photo-toolbar'),add=button('Añadir foto',function(){choose();});add.id='flow-add-photo';
    var edit=button('Cambiar',function(){choose(S.photos[0].view);},'flow-text');edit.id='flow-edit-photo';
    var remove=button('Quitar',function(){var photo=S.photos[0];if(!window.confirm('¿Quitar '+label(photo.view).toLowerCase()+' de este caso? Se retirará también su resultado asociado.'))return;S.photos=S.photos.filter(function(p){return p!==photo;});invalidarVistaCargada(photo.view);saveProgress('s-vita');render();},'flow-text');remove.id='flow-remove-photo';actions.append(add,edit,remove);
    var reference=element('aside','flow-reference');reference.innerHTML='<p id="flow-reference-status"></p><small>Usa fotos de la misma persona. El apoyo no garantiza exactitud anatómica.</small>';
    var refAdd=button('Añadir intraoral',function(){choose('intraoral');},'flow-text');refAdd.id='flow-reference-add';reference.append(refAdd);photos.append(reference);layout.append(photos);
    var config=byId('quick-config');config.querySelector('details').hidden=true;
    config.querySelector('h3').textContent='¿Qué quieres cambiar?';config.querySelector('h3').nextElementSibling.textContent='Elige el resultado para la foto seleccionada.';
    config.querySelector(':scope > .quick-choice-title').textContent='Cambio';
    var appearanceLabel=byId('quick-appearance-options').previousElementSibling,tones=element('div');tones.id='flow-tone-group';appearanceLabel.before(tones);
    var details=element('details','flow-tones');details.append(element('summary','','Ver guía VITA completa'));tones.append(appearanceLabel,byId('quick-appearance-options'));
    details.append(config.querySelector('label[for="quick-vita-tone"]'),byId('quick-vita-tone'));tones.append(details);
    var originalTone=element('p','flow-muted','Se conserva el color original de los dientes.');originalTone.id='flow-original-tone';tones.after(originalTone);
    var notes=element('details','flow-notes');notes.innerHTML='<summary>¿Algo más? <span>Opcional</span></summary><label for="flow-instructions">Indicaciones adicionales</label><textarea id="flow-instructions" rows="3" maxlength="500" placeholder="Por ejemplo: conservar el tamaño de los dientes y un acabado natural." aria-describedby="flow-instruction-help flow-instruction-count"></textarea><div class="flow-note-help"><small id="flow-instruction-help">Complementan tus selecciones; no cambian la arcada ni sustituyen la valoración clínica.</small><small id="flow-instruction-count">0/500</small></div>';
    var gen=config.querySelector('.quick-generate');gen.before(notes);gen.id='flow-generate';gen.textContent='Generar esta foto';gen.removeAttribute('onclick');gen.onclick=generate;
    var genNote=element('p','flow-muted');genNote.id='flow-generation-note';gen.after(genNote);layout.append(config);shell.append(layout);
    var picker=element('dialog','flow-picker');picker.id='flow-picker';picker.setAttribute('aria-labelledby','flow-picker-title');
    picker.innerHTML='<h2 id="flow-picker-title">Añadir una fotografía</h2><p>Elige qué vista vas a cargar. Derecha e izquierda corresponden al paciente.</p><label for="flow-view-type">Tipo de fotografía</label><select id="flow-view-type"></select><p class="flow-muted">Puedes empezar con cualquiera. Subirla no genera imágenes.</p>';
    CASE_VIEW_GROUPS.forEach(function(group){var optgroup=element('optgroup');optgroup.label=group.name;group.views.forEach(function(entry){var option=element('option','',entry[1]);option.value=entry[0];optgroup.append(option);});picker.querySelector('select').append(optgroup);});
    var pickerActions=element('div','flow-picker-actions');pickerActions.append(button('Subir foto',function(){pick(false);},'flow-primary'),button('Tomar foto',function(){pick(true);}),button('Cancelar',function(){picker.close();},'flow-text'));picker.append(pickerActions);
    var input=element('input');input.type='file';input.id='flow-upload';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;input.onchange=upload;shell.append(input);screen.append(shell);document.body.append(screen,picker);
    byId('flow-instructions').addEventListener('input',function(){var note=this.value.slice(0,500);S.smileDesign=SmylSmileModes.normalize(Object.assign({},S.smileDesign,{instructions:note}));document.querySelector('#smile-design-options textarea').value=note;byId('flow-instruction-count').textContent=note.length+'/500';saveProgress('s-vita');});
    var previousSync=window.sincronizarConfiguracionRapida;window.sincronizarConfiguracionRapida=function(){previousSync();syncPreferences();};
    var previousOpen=window.abrirConfiguracionRapida;window.abrirConfiguracionRapida=function(){previousOpen();render();show('s-photos');};
    var resHeader=byId('s-res').querySelector('.res-header');var oldNewPhoto=resHeader.querySelector('button[onclick="repetirFotografias()"]');if(oldNewPhoto)oldNewPhoto.hidden=true;
    var tools=element('details','flow-result-tools');tools.append(element('summary','','Herramientas de revisión'));var toolBody=element('div','flow-tool-body');tools.append(toolBody);
    Array.from(resHeader.querySelectorAll('.res-vita-btn')).forEach(function(control){toolBody.append(control);});
    if(byId('btn-regenerar'))toolBody.append(byId('btn-regenerar'));
    ['btn-editor-diseno','btn-revision-clinica','diag-request-box'].forEach(function(id){if(byId(id))toolBody.append(byId(id));});byId('s-res').querySelector('.res-body').prepend(tools);
    var alignment=byId('ba-align-btn');
    if(alignment){alignment.removeAttribute('style');alignment.className='flow-secondary';alignment.textContent='Ajustar encuadre';toolBody.append(alignment);}
    resHeader.append(button('Ajustar propuesta',openPhotos,'flow-secondary'));byId('s-res').querySelector('.res-logo').after(steps(1));render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
