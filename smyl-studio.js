/* Two-moment workspace. Existing consent, persistence and generation remain authoritative. */
(function () {
  'use strict';
  var busy=false, selected='frontal', generating=false, addedView=null, pickerFocus=null, shadeCarousel=null, returnSettings=null;
  // Framing examples only. Never inserted into S.photos or sent to generation.
  var photoGuides={
    frontal:['icons/capture-frontal-v2.webp','Rostro de frente, sonrisa visible y cabeza recta.'],
    left:['icons/capture-left-v2.webp','Fotografía el lado izquierdo del paciente, sin inclinar la cabeza.'],
    right:['icons/capture-right-v2.webp','Fotografía el lado derecho del paciente, sin inclinar la cabeza.'],
    tresCuartos:['icons/capture-three-quarter-v2.webp','Rostro en diagonal, aproximadamente a 45°, con sonrisa visible.'],
    extraoral:['icons/capture-extraoral-v3.webp','Acerca la sonrisa y conserva los labios completos en el encuadre.'],
    intraoral:['icons/capture-intraoral-v3.webp','Dientes y encías de frente, con buena luz y enfoque.'],
    intraoralLeft:['icons/ui/capture-intraoral-left-v1.webp','Encuadra los dientes del lado izquierdo del paciente.'],
    intraoralRight:['icons/ui/capture-intraoral-right-v1.webp','Encuadra los dientes del lado derecho del paciente.']
  };
  var byId=function(id){return document.getElementById(id);};
  function element(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;}
  function button(text,action,cls){var el=element('button',cls||'flow-secondary',text);el.type='button';el.onclick=action;return el;}
  function realDentalArt(kind){
    var asset='icons/ui/dental-miniature-v1.webp',prefix='flow-real-'+kind;
    // Trace only the contact seam for emphasis; all crowns retain their raster geometry.
    var seam='M0 464 L96 464 Q120 491 151 485 Q197 519 236 503 Q293 549 352 526 L382 503 Q426 536 499 529 L526 523 Q540 549 604 550 L738 551 L768 548 L798 551 L932 550 Q996 549 1010 523 L1037 529 Q1110 536 1154 503 L1184 526 Q1243 549 1300 503 Q1339 519 1385 485 Q1416 491 1440 464 L1536 464';
    var upper=seam+' L1536 0 H0Z',lower=seam+' L1536 1024 H0Z';
    var defs='<defs><clipPath id="'+prefix+'-upper"><path d="'+upper+'"/></clipPath><clipPath id="'+prefix+'-lower"><path d="'+lower+'"/></clipPath>';
    function img(cls,clip){return '<image class="'+cls+'" href="'+asset+'" width="1536" height="1024"'+(clip?' clip-path="url(#'+clip+')"':'')+'/>';}
    var content='';
    if(kind==='alignment'){
      var edges=[239,374,523,768,1013,1162,1297],offsets=['-35px,35px','20px,-40px','-20px,45px','18px,-35px','-20px,40px','35px,-20px'];
      for(var i=0;i<6;i++){
        var clip=prefix+'-tooth-'+i;
        defs+='<clipPath id="'+clip+'"><rect x="'+edges[i]+'" y="180" width="'+(edges[i+1]-edges[i])+'" height="400"/></clipPath>';
        content+='<g class="flow-real-tooth" style="--tooth-motion:'+offsets[i]+';--tooth-turn:'+(i%2?5:-5)+'deg"><g clip-path="url(#'+prefix+'-upper)">'+img('',clip)+'</g></g>';
      }
    }else{
      content=img('flow-real-base');
      if(kind==='upper'||kind==='lower')content+=img('flow-real-focus',prefix+'-'+kind);
      var mark='';
      if(kind!=='lower')mark+='<path d="M350 181 Q768 117 1186 181"/>';
      if(kind!=='upper')mark+='<path d="M350 734 Q768 777 1186 734"/>';
      content+='<g class="flow-real-indicator">'+mark+'</g>';
    }
    return '<svg class="flow-choice-art flow-real-art flow-real-'+kind+'" data-arch-focus="'+kind+'" viewBox="'+(kind==='alignment'?'200 170 1136 460':'0 115 1536 685')+'" aria-hidden="true" focusable="false">'+defs+'</defs>'+content+'</svg>';
  }
  function playChoice(control){
    if(control.disabled||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    clearTimeout(control._flowMotionTimer);control.classList.remove('flow-choice-playing');
    void control.offsetWidth;control.classList.add('flow-choice-playing');
    control._flowMotionTimer=setTimeout(function(){control.classList.remove('flow-choice-playing');},850);
  }
  // UI illustrations only: never used to edit a patient photo or a generation prompt.
  function choiceSvg(kind){
    if(kind!=='veneers')return realDentalArt(kind);
    var id='flow-enamel-'+kind;
    var defs='<defs><linearGradient id="'+id+'" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fffdf2"/><stop offset=".55" stop-color="#e9e3d1"/><stop offset="1" stop-color="#cacbbf"/></linearGradient></defs>';
    var enamel='fill="url(#'+id+')" stroke="#b9beb1" stroke-width=".8"';
    var crown='M4 2 Q14 -1 24 2 C28 7 29 19 30 29 Q31 36 26 38 Q14 42 2 38 Q-2 36 0 29 C1 18 0 8 4 2Z';
    var drawing='';
    if(kind==='veneers'){
      drawing='<path class="flow-art-guide" d="M16 52 Q51 60 89 52"/>'+
        '<g transform="translate(24 18) rotate(-12 14 20) scale(.77)"><path class="flow-art-outline" d="'+crown+'"/></g>'+
        '<g transform="translate(51 17) rotate(12 14 20) scale(.78)"><path class="flow-art-outline" d="'+crown+'"/></g>'+
        '<g class="flow-art-shell"><g transform="translate(37 9)"><path '+enamel+' d="'+crown+'"/><path d="M7 8 Q4 21 5 30 M24 12 Q27 26 24 34" fill="none" stroke="#fffdf5" stroke-width="1.4" opacity=".7"/><path d="M7 35 Q15 38 23 35" fill="none" stroke="#a7b9b3" opacity=".65"/></g></g>';
    }
    return '<svg class="flow-choice-art flow-art-'+kind+'" viewBox="0 0 104 66" aria-hidden="true" focusable="false">'+defs+drawing+'</svg>';
  }
  function illustrateChoices(){
    var groups=[{id:'quick-objective-options',label:'Elige el cambio',key:'quickObjective',options:{veneers:['Carillas','Sin alinear'],alignment:['Alinear','Conserva el tono'],combined:['Alinear + carillas','En una simulación']}},{id:'quick-arch-options',label:'¿Dónde aplicamos el cambio?',key:'quickArch',options:{upper:['Arriba',''],lower:['Abajo',''],both:['Ambos','']}}];
    groups.forEach(function(group){
      var root=byId(group.id);root.setAttribute('role','group');root.setAttribute('aria-label',group.label);
      root.querySelectorAll('button').forEach(function(b){
        var kind=b.dataset[group.key],copy=group.options[kind];
        b.classList.add('flow-visual-choice');b.setAttribute('aria-label',copy[0]);
        b.innerHTML='<span class="flow-choice-check" aria-hidden="true">✓</span>'+choiceSvg(kind)+'<strong>'+copy[0]+'</strong>';
        if(copy[1]){var detail=element('small','',copy[1]);detail.id='flow-choice-detail-'+kind;b.append(detail);b.setAttribute('aria-describedby',detail.id);}
        b.addEventListener('click',function(){playChoice(b);});
      });
    });
  }
  function label(view){var entry=CASE_VIEW_GROUPS.flatMap(function(g){return g.views;}).find(function(v){return v[0]===view;});return entry?entry[1]:view;}
  function source(photo){return photo.dataUrl||'data:'+(photo.mimeType||'image/jpeg')+';base64,'+photo.b64;}
  function steps(active){
    var nav=element('nav','flow-steps');nav.setAttribute('aria-label','Momentos de la simulación');
    ['Preparar','Comparar'].forEach(function(text,index){var item=element('span',index===active?'current':'',(index+1)+'  '+text);if(index===active)item.setAttribute('aria-current','step');nav.append(item);});return nav;
  }
  function openPhotos(){if(busy||generating)return;S.quickGuided=true;abrirConfiguracionRapida();}
  function existingResultPhoto(){return S.photos.find(function(p){return p.view===S.baVistaActual&&S.results?.[p.view];})||S.photos.find(function(p){return S.results?.[p.view];});}
  async function returnToResult(){
    if(busy||generating)return;
    var photo=existingResultPhoto();if(!photo){render();return;}
    if(returnSettings?.owner===progressKey()&&returnSettings.caseId===S.casoId&&returnSettings.result===S.results[returnSettings.view]){
      Object.assign(S,returnSettings.settings);window.SmylSmileModes?.sync();sincronizarOpcionesVita();sincronizarConfiguracionRapida();
    }
    returnSettings=null;
    // Navigation only: use the accepted pixels, never processPhotos/regenerate.
    await cambiarVistaBA(photo.view);renderDiagnostico();show('s-res');initBASlider();
  }
  function renderReturn(){
    var photo=existingResultPhoto();
    ['flow-return-result','flow-return-result-bottom'].forEach(function(id){var b=byId(id);if(b){b.hidden=!photo;b.disabled=busy||generating;}});
    byId('flow-existing-note').hidden=!photo;
    byId('flow-generate').textContent=S.results?.[S.photos[0]?.view]?'Generar nueva propuesta':'Generar mi propuesta';
  }
  function pickerGroup(view){return CASE_VIEW_GROUPS.findIndex(function(g){return g.views.some(function(v){return v[0]===view;});});}
  function firstAvailable(group){return (group.views.find(function(v){return !S.photos.some(function(p){return p.view===v[0];});})||group.views[0])[0];}
  function updatePicker(){
    var groupIndex=pickerGroup(selected),loaded=S.photos.some(function(p){return p.view===selected;});
    document.querySelectorAll('[data-photo-group]').forEach(function(tab){var active=Number(tab.dataset.photoGroup)===groupIndex;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;});
    document.querySelectorAll('[data-photo-panel]').forEach(function(panel){panel.hidden=Number(panel.dataset.photoPanel)!==groupIndex;});
    document.querySelectorAll('[data-photo-view]').forEach(function(card){
      var view=card.dataset.photoView,photo=S.photos.find(function(p){return p.view===view;}),chosen=view===selected,img=card.querySelector('img');
      card.setAttribute('aria-checked',String(chosen));card.tabIndex=chosen?0:-1;
      card.setAttribute('aria-label',label(view)+(photo?' · Añadida':''));
      img.src=photo?source(photo):photoGuides[view][0];
      card.querySelector('.flow-view-state').textContent=photo?'Añadida':'Ejemplo';
      card.classList.toggle('has-photo',!!photo);
    });
    byId('flow-picker-selected').textContent=label(selected);
    byId('flow-picker-hint').textContent=photoGuides[selected][1];
    byId('flow-picker-replace').hidden=!loaded;
  }
  function choose(view){
    if(busy||generating)return;pickerFocus=document.activeElement;
    selected=photoGuides[view]?view:firstAvailable(CASE_VIEW_GROUPS[0]);
    updatePicker();byId('flow-picker').showModal();
    byId('flow-picker-body').scrollTop=0;
    byId('flow-picker').querySelector('[data-photo-view="'+selected+'"]').focus({preventScroll:true});
  }
  function pick(camera){
    byId('flow-picker').close();var input=byId('flow-upload');
    if(camera)input.setAttribute('capture','environment');else input.removeAttribute('capture');input.click();
  }
  async function upload(){
    var input=byId('flow-upload'),file=input.files[0],view=selected;if(!file||busy||generating)return;
    if(!fotoPropiaPermitida(file)){input.value='';mostrarAvisoAplicacion('Fotografía no válida','Usa JPG, PNG o WebP de hasta 20 MB.');return;}
    if(S.photos.some(function(p){return p.view===view;})&&!window.confirm('Ya hay una foto de '+label(view).toLowerCase()+'. ¿Reemplazarla? Su simulación anterior se retirará de este caso.')){input.value='';return;}
    busy=true;render();
    try{
      var data=await leerFotoPropia(file),b64=await redimensionarFotoB64(data,1280,.92);
      var photo={view:view,b64:b64,mimeType:'image/jpeg'},index=S.photos.findIndex(function(p){return p.view===view;});
      if(index<0)S.photos.push(photo);else S.photos[index]=photo;
      invalidarVistaCargada(view);S.quickGuided=true;S.independentIntraoral=S.photos.length===1&&view==='intraoral';addedView=view;saveProgress('s-vita');
    }catch(error){mostrarAvisoAplicacion('No se pudo cargar la foto','La fotografía anterior se conserva. Intenta con otro archivo.');}
    finally{busy=false;input.value='';render();}
  }
  function select(photo){if(busy||generating)return;S.photos=[photo].concat(S.photos.filter(function(p){return p!==photo;}));S.baVistaActual=photo.view;saveProgress('s-vita');render();}
  function professionalAnalysis(){return !CFG.modoProspecto&&(new URLSearchParams(location.search).get('workspace')==='professional'||(!!CFG.userId&&CFG.userId===CFG.tenantId));}
  function analysisPhoto(){var view=S.baVistaActual||'frontal';return S.results?.[view]?S.photos.find(function(p){return p.view===view;}):null;}
  function renderAnalysis(){
    var photo=analysisPhoto(),entry=byId('flow-analysis-entry');if(!entry)return;
    entry.hidden=!photo||!professionalAnalysis();
    var guideCount=photo?.analysisGuides?.items?.length||0;
    byId('flow-analysis-status').textContent=(photo?label(photo.view)+' · ':'')+(guideCount?guideCount+' guías en avance local (24 h) · aún sin enviar al expediente':'Guías opcionales sobre la foto original de esta vista');
    byId('flow-analysis-open').textContent=guideCount?'Revisar guías':'Mostrar guías';
    byId('flow-analysis-open').disabled=busy||generating;
  }
  async function analyzePhoto(){
    var photo=analysisPhoto();if(!photo||busy||generating||!professionalAnalysis()||!byId('s-res').classList.contains('active'))return;
    var original=photo.adjustOriginal||source(photo),result=S.results[photo.view],ownerKey=progressKey(),focus=document.activeElement;
    var current=function(){return professionalAnalysis()&&progressKey()===ownerKey&&analysisPhoto()===photo&&S.results[photo.view]===result&&byId('s-res').classList.contains('active')&&(photo.adjustOriginal||source(photo))===original;};
    busy=true;render();
    try{
      await SmylAnalysisGuides.open({source:original,view:photo.view,label:label(photo.view),record:photo.analysisGuides,isCurrent:current,onSave:function(record){
        if(!current())return false;
        var prior=photo.analysisGuides,storage=progressStorage(),backup=null;
        try{
          backup=storage.getItem(ownerKey);photo.analysisGuides=record;saveProgress('s-res');
          var saved=JSON.parse(storage.getItem(ownerKey)||'null'),stored=saved?.photos?.find(function(p){return p.view===photo.view;});
          if(JSON.stringify(stored?.analysisGuides)===JSON.stringify(record))return true;
        }catch(_){}
        if(prior)photo.analysisGuides=prior;else delete photo.analysisGuides;
        try{if(backup!==null)storage.setItem(ownerKey,backup);}catch(_){}
        return false;
      }});
    }catch(_){mostrarAvisoAplicacion('No se pudieron abrir las guías','La fotografía se conserva. Verifica la sesión e intenta de nuevo.');}
    finally{busy=false;render();if(focus?.isConnected)focus.focus();}
  }
  async function adjustPhoto(photo){
    photo=photo||S.photos[0];if(!photo||busy||generating)return;
    busy=true;render();
    try{
      var original=photo.adjustOriginal||source(photo);
      var isFace=['frontal','left','right','tresCuartos'].includes(photo.view);
      var adjusted=await ajustarFotoAntesDeGuardar(original,{label:label(photo.view),aspectRatio:isFace?4/5:4/3,formatLabel:isFace?'Rostro · 4:5':'Sonrisa · 4:3',ratioLabel:isFace?'4:5':'4:3',guide:isFace?'face':'smile'});
      if(!adjusted||!S.photos.includes(photo)||adjusted===source(photo))return;
      if(S.results?.[photo.view]&&!confirm('El encuadre cambiará. Tendrás que generar de nuevo esta vista. ¿Aplicar ajuste?'))return;
      if(adjusted===original)delete photo.adjustOriginal;else photo.adjustOriginal=original;
      photo.b64=adjusted.split(',')[1];photo.mimeType=adjusted.slice(5,adjusted.indexOf(';'));delete photo.dataUrl;
      invalidarVistaCargada(photo.view);saveProgress('s-vita');
    }catch(e){mostrarAvisoAplicacion('No se pudo ajustar','Tu fotografía se conserva. Intenta de nuevo.');}
    finally{busy=false;render();}
  }
  function restorePhoto(){var photo=S.photos[0];if(!photo?.adjustOriginal||busy||generating)return;if(!confirm('¿Volver a la foto sin ajustar? Se retirará la simulación de esta vista, si existe.'))return;var original=photo.adjustOriginal;photo.b64=original.split(',')[1];photo.mimeType=original.slice(5,original.indexOf(';'));delete photo.dataUrl;delete photo.adjustOriginal;invalidarVistaCargada(photo.view);saveProgress('s-vita');render();}
  function syncPreferences(){
    var design=SmylSmileModes.normalize(S.smileDesign);
    byId('flow-instructions').value=design.instructions;byId('flow-instruction-count').textContent=design.instructions.length+'/500';
    byId('flow-tone-group').hidden=design.mode==='alignment';byId('flow-original-tone').hidden=design.mode!=='alignment';
    var tone=S.vitaMode==='current'?'current':S.vitaTone||'A1';
    byId('flow-tone-selected').textContent=tone==='current'?'Color original':'VITA '+tone;
    document.querySelectorAll('[data-flow-tone]').forEach(function(b){var chosen=b.dataset.flowTone===tone;b.classList.toggle('selected',chosen);b.setAttribute('aria-pressed',String(chosen));b.disabled=busy||generating||design.mode==='alignment';});
    shadeCarousel?.sync(tone);
    document.querySelectorAll('#quick-config .quick-choice').forEach(function(el){el.setAttribute('aria-pressed',String(el.classList.contains('selected')));});
  }
  function render(){
    var stage=byId('flow-main-photo'),strip=byId('flow-photo-strip');stage.replaceChildren();strip.replaceChildren();var primary=S.photos[0];
    if(primary){
      var image=element('img');image.src=source(primary);image.alt=label(primary.view)+(primary.adjustOriginal?' · fotografía ajustada':' · fotografía original');stage.append(image,element('span','flow-photo-caption','Foto a simular · '+label(primary.view)));
      S.photos.forEach(function(photo){var item=button('',function(){select(photo);},'flow-thumb'+(photo===primary?' selected':''));item.setAttribute('aria-label','Seleccionar '+label(photo.view));item.setAttribute('aria-pressed',String(photo===primary));var thumb=element('img');thumb.src=source(photo);thumb.alt='';item.append(thumb,element('span','',label(photo.view)));if(photo===primary)item.append(element('small','','A simular'));strip.append(item);});
    }else{
      var empty=element('div','flow-empty');empty.innerHTML='<span class="flow-empty-symbol" aria-hidden="true">＋</span><h2>Empieza con una fotografía</h2><p>Del rostro o intraoral.<br>La vista que quieras trabajar primero.</p>';empty.append(button('Tomar o subir foto',function(){choose();},'flow-primary'));stage.append(empty);
    }
    byId('flow-edit-photo').hidden=!primary;byId('flow-remove-photo').hidden=!primary;byId('flow-add-photo').hidden=!primary;
    byId('flow-adjust-photo').hidden=!primary;byId('flow-restore-photo').hidden=!primary?.adjustOriginal;
    renderAnalysis();
    renderReturn();
    byId('flow-photo-count').textContent=busy?'Preparando fotografía…':S.photos.length+' '+(S.photos.length===1?'fotografía':'fotografías')+' en este caso';
    var added=S.photos.find(function(p){return p.view===addedView;}),notice=byId('flow-photo-notice');notice.hidden=!added;
    byId('flow-photo-notice-text').textContent=added?'Foto añadida · '+label(added.view)+'. Puedes dejarla así o ajustar su encuadre.':'';
    byId('flow-generate').disabled=busy||generating||!primary;
    byId('flow-generation-note').textContent=primary?'Se generará solo '+label(primary.view).toLowerCase()+'. Cada foto generada consume una simulación; subir fotos no genera ni consume simulaciones.':'Añade una fotografía para generar tu propuesta.';
    var ref=primary&&referenciaDentalMaestraParaVista(primary.view);
    byId('flow-reference-status').textContent=ref?.role==='original-anatomy'?'Apoyo para esta vista: '+label(ref.view)+'. Su original ayudará a interpretar los dientes; no se generará otra imagen.':'Intraorales opcionales: añádelas como apoyo para distinguir mejor los dientes. También puedes generar su propia simulación.';
    byId('flow-reference-add').hidden=!!(ref?.role==='original-anatomy');
    document.querySelectorAll('#flow-photo-workspace button').forEach(function(el){el.disabled=busy||generating;});syncPreferences();
    document.querySelectorAll('#quick-objective-options button,#quick-arch-options button,#flow-instructions,.flow-shade-arrow').forEach(function(el){el.disabled=busy||generating;});
  }
  async function generate(){if(busy||generating||!S.photos.length)return;generating=true;render();try{await confirmarConfiguracionRapida();}finally{if(returnSettings&&S.results[returnSettings.view]!==returnSettings.result)returnSettings=null;generating=false;render();}}
  function init(){
    document.body.classList.add('smyl-organized');
    var intro=byId('s-intro'),hero=element('section','flow-home');
    hero.innerHTML='<img class="flow-home-logo" src="icons/smyl_logo.png" alt="SMYL"><div class="flow-eyebrow">ESTUDIO DE SONRISA</div><h1>Una fotografía.<br>Una nueva posibilidad.</h1><p>Elige el cambio que buscas y compara la propuesta. Puedes comenzar con cualquier vista.</p>';
    hero.append(button('Crear simulación',openPhotos,'flow-primary'));
    var panelLink=element('a','flow-panel-link','Ir a mi panel profesional');panelLink.href='app.html';hero.append(panelLink,element('p','flow-home-note','Las intraorales son opcionales y también pueden servir como referencia.'));intro.prepend(hero);
    var screen=element('div','screen quick-guided-active');screen.id='s-photos';var shell=element('div','flow-shell');
    shell.innerHTML='<header class="flow-heading"><a href="app.html" aria-label="Volver al panel profesional"><img src="icons/smyl_logo.png" alt="SMYL"></a><a class="flow-panel-link" href="app.html">Panel profesional</a></header>';shell.append(steps(0));
    var returnButton=button('← Volver a mi simulación',returnToResult,'flow-secondary flow-return-result');returnButton.id='flow-return-result';returnButton.hidden=true;shell.append(returnButton);
    var heading=element('div','flow-title');heading.innerHTML='<h1>Prepara tu simulación</h1><p class="flow-muted">Tus fotos, tu objetivo. Todo en un mismo lugar.</p>';shell.append(heading);
    var layout=element('div','flow-prepare-grid'),photos=element('section','flow-photo-workspace');photos.id='flow-photo-workspace';
    photos.innerHTML='<div id="flow-main-photo" class="flow-main-photo"></div><div class="flow-photo-toolbar"><span id="flow-photo-count" role="status"></span></div><div id="flow-photo-strip" class="flow-photo-strip"></div>';
    var actions=photos.querySelector('.flow-photo-toolbar'),add=button('Añadir foto',function(){choose();});add.id='flow-add-photo';
    var edit=button('Cambiar',function(){choose(S.photos[0].view);},'flow-text');edit.id='flow-edit-photo';
    var adjust=button('Ajustar foto',function(){adjustPhoto();});adjust.id='flow-adjust-photo';adjust.title='Ampliar, encuadrar y enderezar por grados';var restore=button('Volver al original',restorePhoto,'flow-text');restore.id='flow-restore-photo';actions.append(adjust,restore);
    var remove=button('Quitar',function(){var photo=S.photos[0];if(!window.confirm('¿Quitar '+label(photo.view).toLowerCase()+' de este caso? Se retirará también su resultado asociado.'))return;S.photos=S.photos.filter(function(p){return p!==photo;});invalidarVistaCargada(photo.view);saveProgress('s-vita');render();},'flow-text');remove.id='flow-remove-photo';actions.append(add,edit,remove);
    var analysis=element('section','flow-analysis-entry');analysis.id='flow-analysis-entry';analysis.hidden=true;
    var analysisCopy=element('div');analysisCopy.append(element('strong','','Análisis avanzado'));var analysisStatus=element('small');analysisStatus.id='flow-analysis-status';analysisStatus.setAttribute('role','status');analysisCopy.append(analysisStatus);
    var analysisOpen=button('Mostrar guías',analyzePhoto);analysisOpen.id='flow-analysis-open';analysis.append(analysisCopy,analysisOpen);
    var notice=element('div','flow-photo-notice');notice.id='flow-photo-notice';notice.hidden=true;
    var noticeText=element('p');noticeText.id='flow-photo-notice-text';noticeText.setAttribute('role','status');notice.append(noticeText);
    var noticeAdjust=button('Encuadrar y enderezar',function(){var photo=S.photos.find(function(p){return p.view===addedView;});if(photo)adjustPhoto(photo);},'flow-text');noticeAdjust.id='flow-new-photo-adjust';notice.append(noticeAdjust);
    var dismiss=button('×',function(){addedView=null;render();},'flow-text');dismiss.setAttribute('aria-label','Cerrar sugerencia de ajuste');notice.append(dismiss);photos.querySelector('#flow-photo-strip').before(notice);
    var reference=element('aside','flow-reference');reference.innerHTML='<p id="flow-reference-status"></p><small>Usa fotos de la misma persona. El apoyo no garantiza exactitud anatómica.</small>';
    var refAdd=button('Añadir intraoral',function(){choose('intraoral');},'flow-text');refAdd.id='flow-reference-add';reference.append(refAdd);photos.append(reference);layout.append(photos);
    var config=byId('quick-config');config.querySelector('details').hidden=true;
    config.querySelector('h3').textContent='Diseña tu sonrisa';config.querySelector('h3').nextElementSibling.textContent='Elige el cambio que quieres explorar.';
    config.querySelector(':scope > .quick-choice-title').textContent='Elige el cambio';
    byId('quick-arch-options').previousElementSibling.textContent='¿Dónde aplicamos el cambio?';
    illustrateChoices();
    var appearanceLabel=byId('quick-appearance-options').previousElementSibling,tones=element('div');tones.id='flow-tone-group';appearanceLabel.before(tones);
    appearanceLabel.textContent='Elige el tono';tones.append(appearanceLabel);
    byId('quick-appearance-options').hidden=true;config.querySelector('label[for="quick-vita-tone"]').hidden=true;byId('quick-vita-tone').hidden=true;
    var shadeHeader=element('div','flow-shade-header'),selectedTone=element('strong');selectedTone.id='flow-tone-selected';selectedTone.setAttribute('aria-live','polite');shadeHeader.append(selectedTone);
    var track=element('div','flow-vita-track');track.id='flow-vita-track';track.setAttribute('aria-label','Tonos VITA Classical');
    function chooseTone(code){seleccionarAparienciaRapida(code,null,false);syncPreferences();}
    [-1,1].forEach(function(direction){var b=button(direction<0?'‹':'›',function(){shadeCarousel.step(direction);},'flow-shade-arrow');b.setAttribute('aria-label',direction<0?'Ver tonos anteriores':'Ver más tonos');shadeHeader.append(b);});
    VITA_CLASSICAL.forEach(function(shade){var b=button('',function(){shadeCarousel.pick(shade.code);},'flow-vita-card');b.dataset.flowTone=shade.code;b.setAttribute('aria-label','Seleccionar tono VITA '+shade.code);
      b.innerHTML='<span class="flow-veneer-stage" aria-hidden="true"><span class="flow-veneer-holder"></span><span class="flow-veneer"><img src="icons/vita/veneer-ceramic-v2.webp" width="560" height="724" alt="" draggable="false"></span><span class="flow-holder-brand"><img src="icons/smyl_logo.png" alt="" draggable="false"><b>VITA '+shade.code+'</b></span></span><span class="flow-shade-check" aria-hidden="true">✓</span>';
      SmylVitaSamples.attachFilter(b.querySelector('.flow-veneer img'),shade.code);
      b.append(element('strong','',shade.code));track.append(b);
    });
    var currentTone=button('Conservar color original',function(){chooseTone('current');},'flow-keep-tone');currentTone.dataset.flowTone='current';
    tones.append(shadeHeader,track,currentTone,element('p','flow-tone-help','Desliza: la carilla del centro queda seleccionada. También puedes tocarla. Tonos aproximados en pantalla; confirma con la guía VITA física.'));
    shadeCarousel=SmylShadeCarousel.attach({track:track,selector:'.flow-vita-card',key:'data-flow-tone',onSelect:chooseTone,onSettle:function(){saveProgress('s-vita');},enabled:function(){return !busy&&!generating&&SmylSmileModes.normalize(S.smileDesign).mode!=='alignment';}});
    var originalTone=element('p','flow-muted','Se conserva el color original de los dientes.');originalTone.id='flow-original-tone';tones.after(originalTone);
    var notes=element('details','flow-notes');notes.innerHTML='<summary>Añadir una indicación <span>Opcional</span></summary><label for="flow-instructions">Indicaciones adicionales</label><textarea id="flow-instructions" rows="3" maxlength="500" placeholder="Por ejemplo: conservar el tamaño de los dientes y un acabado natural." aria-describedby="flow-instruction-help flow-instruction-count"></textarea><div class="flow-note-help"><small id="flow-instruction-help">Complementan tus selecciones; no cambian la arcada ni sustituyen la valoración clínica.</small><small id="flow-instruction-count">0/500</small></div>';
    var gen=config.querySelector('.quick-generate');gen.before(notes);gen.id='flow-generate';gen.textContent='Generar mi propuesta';gen.removeAttribute('onclick');gen.onclick=generate;
    var genNote=element('p','flow-muted');genNote.id='flow-generation-note';gen.after(genNote);
    var existingNote=element('p','flow-muted','Puedes volver sin generar. Al volver se conservan la simulación y sus opciones anteriores; los cambios de esta pantalla no se aplican.');existingNote.id='flow-existing-note';existingNote.hidden=true;gen.before(existingNote);
    var returnBottom=button('Volver a mi simulación',returnToResult,'flow-secondary');returnBottom.id='flow-return-result-bottom';returnBottom.hidden=true;genNote.after(returnBottom);layout.append(config);shell.append(layout);
    var picker=element('dialog','flow-picker');picker.id='flow-picker';picker.setAttribute('aria-labelledby','flow-picker-title');
    picker.innerHTML='<header class="flow-picker-head"><div><h2 id="flow-picker-title">¿Qué foto añadimos?</h2><p>Elige una vista. Después, toma o sube tu foto.</p></div></header>';
    var closePicker=button('×',function(){picker.close();},'flow-text');closePicker.setAttribute('aria-label','Cancelar');picker.querySelector('header').append(closePicker);
    var tabs=element('div','flow-photo-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Categorías de fotografías');picker.append(tabs);
    var pickerBody=element('div','flow-picker-body');pickerBody.id='flow-picker-body';
    CASE_VIEW_GROUPS.forEach(function(group,i){
      var tab=button(group.name,function(){if(pickerGroup(selected)!==i)selected=firstAvailable(group);updatePicker();pickerBody.scrollTop=0;},'flow-photo-tab');tab.id='flow-photo-tab-'+i;tab.dataset.photoGroup=i;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','flow-photo-panel-'+i);tabs.append(tab);
      tab.addEventListener('keydown',function(e){var next;if(e.key==='ArrowRight'||e.key==='ArrowLeft')next=1-i;else if(e.key==='Home')next=0;else if(e.key==='End')next=1;else return;e.preventDefault();var target=byId('flow-photo-tab-'+next);target.click();target.focus();});
      var panel=element('section','flow-photo-panel');panel.id='flow-photo-panel-'+i;panel.dataset.photoPanel=i;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);
      panel.append(element('p','flow-gallery-help',i?'Opcionales: puedes simularlas o usarlas como apoyo para las fotos de rostro.':'Empieza con una sola foto. Las demás vistas son opcionales.'));
      var grid=element('div','flow-view-grid');grid.setAttribute('role','radiogroup');grid.setAttribute('aria-label','Vista de '+group.name.toLowerCase());
      group.views.forEach(function(entry,index){
        var view=entry[0],card=button('',function(){selected=view;updatePicker();},'flow-view-card');card.dataset.photoView=view;card.setAttribute('role','radio');
        var img=element('img');img.alt='';img.width=512;img.height=512;img.draggable=false;
        var visual=element('span','flow-view-visual');visual.append(img);
        card.append(visual,element('span','flow-view-check','✓'),element('strong','',entry[1]),element('small','flow-view-state','Ejemplo'));card.querySelector('.flow-view-check').setAttribute('aria-hidden','true');
        card.addEventListener('keydown',function(e){var delta={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[e.key],next;if(delta)next=(index+delta+group.views.length)%group.views.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=group.views.length-1;else return;e.preventDefault();var target=grid.children[next];target.click();target.focus();});grid.append(card);
      });panel.append(grid);pickerBody.append(panel);
    });
    pickerBody.append(element('p','flow-example-note','Ejemplos ilustrativos, no fotos de pacientes. Izquierda y derecha siempre son las del paciente.'));
    var footer=element('footer','flow-picker-footer');footer.innerHTML='<strong id="flow-picker-selected"></strong><p id="flow-picker-hint"></p><p id="flow-picker-replace" hidden>Ya añadida. Tomar o subir otra foto reemplazará esta vista.</p>';
    var pickerActions=element('div','flow-picker-actions');pickerActions.append(button('Tomar foto',function(){pick(true);},'flow-primary'),button('Subir foto',function(){pick(false);}));footer.append(pickerActions,element('small','','Cargar fotos no consume simulaciones.'));picker.append(pickerBody,footer);
    picker.addEventListener('close',function(){if(pickerFocus?.isConnected)pickerFocus.focus({preventScroll:true});});
    var input=element('input');input.type='file';input.id='flow-upload';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;input.onchange=upload;shell.append(input);screen.append(shell);document.body.append(screen,picker);
    byId('flow-instructions').addEventListener('input',function(){var note=this.value.slice(0,500);S.smileDesign=SmylSmileModes.normalize(Object.assign({},S.smileDesign,{instructions:note}));document.querySelector('#smile-design-options textarea').value=note;byId('flow-instruction-count').textContent=note.length+'/500';saveProgress('s-vita');});
    var previousSync=window.sincronizarConfiguracionRapida;window.sincronizarConfiguracionRapida=function(){previousSync();syncPreferences();};
    var previousOpen=window.abrirConfiguracionRapida;window.abrirConfiguracionRapida=function(){
      var photo=existingResultPhoto();
      if(byId('s-res').classList.contains('active')&&photo){
        var settings={smileDesign:JSON.parse(JSON.stringify(S.smileDesign||{}))};
        ['vitaTone','vitaMode','vitaFinish','vitaIntensity','vitaConstruction'].forEach(function(key){settings[key]=S[key];});
        returnSettings={owner:progressKey(),caseId:S.casoId,view:photo.view,result:S.results[photo.view],settings:settings};
      }
      previousOpen();render();show('s-photos');
    };
    var previousQuality=window.renderControlCalidadSimulacion;window.renderControlCalidadSimulacion=function(){var result=previousQuality.apply(this,arguments);renderAnalysis();return result;};
    var resHeader=byId('s-res').querySelector('.res-header');var oldNewPhoto=resHeader.querySelector('button[onclick="repetirFotografias()"]');if(oldNewPhoto)oldNewPhoto.hidden=true;
    var tools=element('details','flow-result-tools');tools.append(element('summary','','Herramientas de revisión'));var toolBody=element('div','flow-tool-body');tools.append(toolBody);
    toolBody.append(analysis);
    Array.from(resHeader.querySelectorAll('.res-vita-btn')).forEach(function(control){toolBody.append(control);});
    if(byId('btn-regenerar'))toolBody.append(byId('btn-regenerar'));
    ['btn-editor-diseno','btn-revision-clinica','diag-request-box'].forEach(function(id){if(byId(id))toolBody.append(byId(id));});byId('s-res').querySelector('.res-body').prepend(tools);
    var alignment=byId('ba-align-btn');
    if(alignment){alignment.removeAttribute('style');alignment.className='flow-secondary';alignment.textContent='Ajustar encuadre';toolBody.append(alignment);}
    resHeader.append(button('Ajustar propuesta',openPhotos,'flow-secondary'));byId('s-res').querySelector('.res-logo').after(steps(1));render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
