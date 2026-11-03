/* Two-moment workspace. Existing consent, persistence and generation remain authoritative. */
(function () {
  'use strict';
  var busy=false, selected='frontal', generating=false, addedView=null, pickerFocus=null, shadeCarousels={classical:null,bleached:null}, shadeRenderedGuide=null, returnSettings=null, guidedStage=0, instructionRecognition=null, instructionListening=false, instructionBaseText='', instructionTranscript='';
  var patientToneChoices=[
    {code:'current',label:'Mi tono actual',detail:'Sin cambiar el color'},
    {code:'A2',label:'Natural',detail:'Cambio discreto'},
    {code:'A1',label:'Claro natural',detail:'Más luminoso'},
    {code:'B1',label:'Muy claro',detail:'El más brillante natural'}
  ];
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
  function instructionText(value,persist){
    var note=String(value||'').replace(/\s+/g,' ').trimStart().slice(0,500),field=byId('flow-instructions'),legacy=document.querySelector('#smile-design-options textarea');
    if(field&&field.value!==note)field.value=note;
    S.smileDesign=SmylSmileModes.normalize(Object.assign({},S.smileDesign,{instructions:note}));
    if(legacy&&legacy.value!==note)legacy.value=note;
    if(byId('flow-instruction-count'))byId('flow-instruction-count').textContent=note.length+'/500';
    if(byId('flow-instruction-clear'))byId('flow-instruction-clear').hidden=!note.trim();
    if(persist!==false)saveProgress('s-vita');
    return note;
  }
  function instructionStatus(message,state){
    var status=byId('flow-instruction-voice-status');if(!status)return;
    status.textContent=message||'';status.dataset.state=state||'';
  }
  function instructionListeningState(active){
    instructionListening=!!active;
    var control=byId('flow-instruction-mic');if(!control)return;
    control.setAttribute('aria-pressed',String(instructionListening));
    control.querySelector('.flow-note-voice-label').textContent=instructionListening?'Detener y usar':'Grabar voz';
    control.querySelector('.flow-note-voice-icon').textContent=instructionListening?'■':'●';
  }
  function instructionVoiceConstructor(){return window.SpeechRecognition||window.webkitSpeechRecognition||null;}
  function stopInstructionVoice(){
    if(!instructionListening||!instructionRecognition)return;
    try{instructionRecognition.stop();}catch(_){instructionListeningState(false);}
  }
  function toggleInstructionVoice(){
    if(busy||generating)return;
    if(instructionListening){stopInstructionVoice();return;}
    var Recognition=instructionVoiceConstructor();
    if(!Recognition){instructionStatus('El dictado no está disponible en este navegador. Puedes escribir la indicación.','attention');return;}
    instructionRecognition=new Recognition();instructionRecognition.lang='es-MX';instructionRecognition.continuous=false;instructionRecognition.interimResults=true;instructionRecognition.maxAlternatives=1;
    instructionBaseText=(byId('flow-instructions')?.value||'').trim();instructionTranscript='';
    instructionRecognition.onstart=function(){instructionListeningState(true);instructionStatus('Escuchando… habla con naturalidad. Podrás corregir el texto antes de generar.','recording');};
    instructionRecognition.onresult=function(event){
      var parts=[];for(var i=0;i<event.results.length;i++){var phrase=event.results[i]?.[0]?.transcript;if(phrase)parts.push(phrase.trim());}
      instructionTranscript=parts.join(' ').replace(/\s+/g,' ').trim();
      var separator=instructionBaseText&&instructionTranscript&&!/[.!?]$/.test(instructionBaseText)?'. ':instructionBaseText&&instructionTranscript?' ':'';
      instructionText(instructionBaseText+separator+instructionTranscript,false);
    };
    instructionRecognition.onerror=function(event){
      var copy=event.error==='not-allowed'||event.error==='service-not-allowed'?'Activa el permiso del micrófono para dictar. También puedes escribir la indicación.':event.error==='no-speech'?'No escuché una instrucción. Intenta de nuevo o escríbela.':'No pude convertir la voz. Tu texto se conserva.';
      instructionStatus(copy,'attention');
    };
    instructionRecognition.onend=function(){
      instructionListeningState(false);instructionText(byId('flow-instructions')?.value||'',true);
      if(instructionTranscript)instructionStatus('Dictado añadido. Revísalo o edítalo antes de generar.','success');
      else if(byId('flow-instruction-voice-status')?.dataset.state==='recording')instructionStatus('No se añadió texto. Puedes volver a grabar o escribirlo.','attention');
      instructionRecognition=null;
    };
    try{instructionRecognition.start();}catch(_){instructionRecognition=null;instructionListeningState(false);instructionStatus('No pude iniciar el micrófono. Intenta de nuevo o escribe la indicación.','attention');}
  }
  function addInstructionPreset(text){
    if(busy||generating)return;
    var current=(byId('flow-instructions')?.value||'').trim(),exists=current.toLocaleLowerCase('es-MX').includes(text.toLocaleLowerCase('es-MX'));
    instructionText(exists?current:[current,text].filter(Boolean).join(current&&!/[.!?]$/.test(current)?'. ':current?' ':'') ,true);
    instructionStatus(exists?'Esta indicación ya estaba incluida.':'Indicación añadida. Puedes editarla antes de generar.',exists?'':'success');
    byId('flow-instructions')?.focus();
  }
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
  function patientToneLabel(code){
    var choice=patientToneChoices.find(function(item){return item.code===code;});
    if(choice)return choice.label;
    var shade=typeof buscarTonoVita==='function'?buscarTonoVita(code,S.shadeGuide):(typeof VITA_CLASSICAL!=='undefined'&&VITA_CLASSICAL.find(function(item){return item.code===code;}));
    return shade?(typeof etiquetaTonoVita==='function'?etiquetaTonoVita(code,S.shadeGuide):'VITA '+shade.code):'Tono personalizado';
  }
  function patientToneDetail(code){
    if(code==='current')return 'Conservar el color observado';
    var shade=typeof buscarTonoVita==='function'?buscarTonoVita(code,S.shadeGuide):(typeof VITA_CLASSICAL!=='undefined'&&VITA_CLASSICAL.find(function(item){return item.code===code;}));
    if(!shade)return patientToneLabel(code);
    if(currentShadeGuide()==='bleached'){
      var system=typeof nombreSistemaTono==='function'?nombreSistemaTono(code,'bleached'):'Ivoclar Bleach BL';
      return 'Bleach '+code+' · '+system;
    }
    var intent=code==='B1'?'Muy claro':(['A1','B2','D2'].includes(code)?'Claro natural':(['A2','C1','C2'].includes(code)?'Natural':'Matiz natural'));
    return intent+' · VITA Classical '+code;
  }
  function currentShadeGuide(){return typeof normalizarGuiaTono==='function'?normalizarGuiaTono(S.shadeGuide):S.shadeGuide==='bleached'?'bleached':'classical';}
  function ensureShadeState(){
    if(typeof asegurarEstadoGuiaTono==='function')asegurarEstadoGuiaTono();
    else{
      S.shadeGuide=currentShadeGuide();
      S.shadeToneByGuide=Object.assign({classical:'A2',bleached:'BL2'},S.shadeToneByGuide||{});
      if(S.vitaMode!=='current'&&!S.vitaTone)S.vitaTone=S.shadeToneByGuide[S.shadeGuide];
    }
  }
  function shadePool(guide){
    if(guide!=='bleached')return typeof tonosGuiaTono==='function'?tonosGuiaTono('classical'):(window.VITA_CLASSICAL||[]);
    return (window.BLEACH_BL_SHADES||(typeof tonosGuiaTono==='function'?tonosGuiaTono('bleached'):[])||[]).slice().sort(function(a,b){return Number(b.L||0)-Number(a.L||0);});
  }
  function shadeCard(shade,guide){
    var b=button('',function(){shadeCarousels[guide]?.pick(shade.code);},'flow-vita-card');
    b.dataset.flowTone=shade.code;b.dataset.flowGuide=guide;b.setAttribute('aria-label','Seleccionar '+(guide==='bleached'?'Bleaches ':'VITA ')+shade.code);
    b.innerHTML='<span class="flow-veneer-stage" aria-hidden="true"><span class="flow-veneer-holder"></span><span class="flow-veneer"><img src="icons/vita/veneer-ceramic-v2.webp" width="560" height="724" alt="" draggable="false"></span><span class="flow-holder-brand"><img src="icons/smyl_logo.png" alt="" draggable="false"><b>'+shade.code+'</b></span></span><span class="flow-shade-check" aria-hidden="true">✓</span>';
    SmylVitaSamples.attachFilter(b.querySelector('.flow-veneer img'),shade.code);
    b.append(element('strong','',shade.code),element('small','',shade.copy||''));
    return b;
  }
  function selectedToneLabel(code){
    if(code==='current')return 'Mi tono actual';
    return (currentShadeGuide()==='bleached'?'Bleaches · ':'Guía VITA · ')+code;
  }
  function renderShadeGuides(){
    var tracks={classical:byId('flow-vita-classical-track'),bleached:byId('flow-vita-bleached-track')};
    if(!tracks.classical||!tracks.bleached)return;
    ensureShadeState();
    ['classical','bleached'].forEach(function(guide){
      shadeCarousels[guide]?.destroy();shadeCarousels[guide]=null;tracks[guide].replaceChildren();
      shadePool(guide).forEach(function(shade){tracks[guide].append(shadeCard(shade,guide));});
      shadeCarousels[guide]=SmylShadeCarousel.attach({track:tracks[guide],selector:'.flow-vita-card',key:'data-flow-tone',onSelect:function(code){chooseShadeToneForGuide(guide,code);},onSettle:function(){saveProgress('s-vita');},enabled:function(){return !busy&&!generating&&SmylSmileModes.normalize(S.smileDesign).mode!=='alignment';}});
      shadeCarousels[guide].sync(S.shadeToneByGuide?.[guide]||(guide==='bleached'?'BL2':'A2'));
    });
    shadeRenderedGuide='dual';
  }
  function chooseShadeToneForGuide(guide,code){
    if(busy||generating)return;
    ensureShadeState();S.shadeGuide=guide;S.shadeToneByGuide[guide]=code;
    seleccionarAparienciaRapida(code,null,false);syncPreferences();saveProgress('s-vita');
  }
  function chooseShadeTone(code){
    chooseShadeToneForGuide(typeof guiaDeCodigoTono==='function'?guiaDeCodigoTono(code):currentShadeGuide(),code);
  }
  function guidedObjectiveLabel(mode){return {veneers:'Alinear y mejorar',alignment:'Alinear',combined:'Alinear y mejorar'}[mode]||'Alinear y mejorar';}
  function guidedArchLabel(arch){return {upper:'Arriba',lower:'Abajo',both:'Ambos'}[arch]||'Arriba';}
  function guidedMeta(stage){
    return [
      ['Paso 1 de 5 · Fotografía','Empieza con una fotografía','Te recomendamos una foto frontal sonriendo y con buena luz.'],
      ['Paso 2 de 5 · Cambio','¿Qué quieres explorar?','Elige la opción que más se parezca al cambio que quieres comparar.'],
      ['Paso 3 de 5 · Zona','¿Dónde quieres verlo?','Puedes aplicarlo arriba, abajo o en ambas arcadas.'],
      ['Paso 4 de 5 · Claridad','Elige el tono','Compara tonos naturales o de blanqueamiento. A2 es un punto de partida natural; el tono clínico se confirma físicamente.'],
      ['Paso 5 de 5 · Revisión','Revisa tu propuesta','Comprueba tus elecciones antes de generar la comparación.']
    ][stage]||[];
  }
  function previousGuidedStage(){
    var design=SmylSmileModes.normalize(S.smileDesign);
    if(guidedStage===4)return design.mode==='alignment'?2:3;
    return Math.max(1,guidedStage-1);
  }
  function advanceGuided(stage,moveFocus){
    guidedStage=stage;
    renderProgressive();
    if(moveFocus)requestAnimationFrame(function(){
      var config=byId('quick-config');
      config?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      byId('quick-config-title')?.focus({preventScroll:true});
    });
  }
  function renderProgressive(){
    var config=byId('quick-config');if(!config||!byId('flow-progress'))return;
    if(!S.photos.length)guidedStage=0;else if(guidedStage===0)guidedStage=1;
    var design=SmylSmileModes.normalize(S.smileDesign),tone=S.vitaMode==='current'?'current':S.vitaTone||(typeof tonoPredeterminadoGuia==='function'?tonoPredeterminadoGuia(currentShadeGuide()):(currentShadeGuide()==='bleached'?'BL2':'A2'));
    if(design.mode==='alignment'&&guidedStage===3)guidedStage=4;
    var meta=guidedMeta(guidedStage);
    var alignmentFlow=design.mode==='alignment';
    if(alignmentFlow&&guidedStage===2)meta=['Paso 3 de 4 · Zona',meta[1],meta[2]];
    if(alignmentFlow&&guidedStage===4)meta=['Paso 4 de 4 · Revisión',meta[1],'Comprueba tus elecciones antes de generar la comparación.'];
    byId('flow-progress-kicker').textContent=meta[0];
    byId('quick-config-title').textContent=meta[1];
    byId('flow-progress-copy').textContent=meta[2];
    byId('flow-progress-back').hidden=guidedStage<2;
    config.dataset.guidedStage=String(guidedStage);
    var panels=[byId('flow-stage-photo'),byId('flow-stage-objective'),byId('flow-stage-arch'),byId('flow-tone-group'),byId('flow-stage-review')];
    panels.forEach(function(panel,index){if(panel)panel.hidden=index!==guidedStage;});
    if(byId('flow-original-tone'))byId('flow-original-tone').hidden=true;
    byId('flow-progress-track').classList.toggle('is-alignment',alignmentFlow);
    byId('flow-progress-track').setAttribute('aria-valuenow',String(alignmentFlow&&guidedStage===4?4:guidedStage+1));
    byId('flow-progress-track').setAttribute('aria-valuemax',alignmentFlow?'4':'5');
    byId('flow-progress-track').setAttribute('aria-valuetext',meta[0]);
    document.querySelectorAll('#flow-progress-track span').forEach(function(dot,index){
      dot.classList.toggle('done',index<guidedStage);dot.classList.toggle('current',index===guidedStage);dot.classList.toggle('skipped',design.mode==='alignment'&&index===3);
    });
    byId('flow-review-objective').textContent=guidedObjectiveLabel(design.mode);
    byId('flow-review-arch').textContent=guidedArchLabel(design.arch);
    byId('flow-review-tone').textContent=design.mode==='alignment'?'Conservar tono actual':selectedToneLabel(tone);
    byId('flow-review-tone-row').hidden=design.mode==='alignment';
  }
  function illustrateChoices(){
    var groups=[
      {id:'quick-objective-options',label:'Elige el cambio',key:'quickObjective',options:{
        alignment:['Alinear','Conserva tu tono'],
        combined:['Alinear y mejorar','Forma y tono en una propuesta']
      }},
      {id:'quick-arch-options',label:'¿Dónde aplicamos el cambio?',key:'quickArch',options:{
        upper:['Arriba',''],
        lower:['Abajo',''],
        both:['Ambos','']
      }}
    ];
    groups.forEach(function(group){
      var root=byId(group.id);root.setAttribute('role','group');root.setAttribute('aria-label',group.label);
      root.querySelectorAll('button').forEach(function(b){
        var kind=b.dataset[group.key],copy=group.options[kind];
        if(!copy)return;
        b.classList.add('flow-visual-choice');b.setAttribute('aria-label',copy[0]);
        b.innerHTML='<span class="flow-choice-check" aria-hidden="true">✓</span>'+realDentalArt(kind)+'<strong>'+copy[0]+'</strong>';
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
  function openPhotos(){if(busy||generating)return;S.quickGuided=true;window.abrirConfiguracionRapida();}
  function openToneSelection(){
    if(busy||generating)return;
    openPhotos();
    requestAnimationFrame(function(){advanceGuided(3,true);});
  }
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
    var batch=window.SmylPhotoBatch.summary(),remaining=batch.count-batch.ready,newCount=remaining-batch.review;
    byId('flow-generate').textContent=batch.count&&remaining===0?'Ver simulaciones':batch.review===remaining&&remaining>0?'Revisar simulaciones generadas':newCount>1?'Generar '+newCount+' fotos':batch.count>1?'Generar 1 foto pendiente':S.results?.[S.photos[0]?.view]?'Generar nueva propuesta':'Generar mi propuesta';
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
  function choose(view,referenceOnly){
    if(busy||generating)return;pickerFocus=document.activeElement;
    selected=photoGuides[view]?view:firstAvailable(CASE_VIEW_GROUPS[0]);
    byId('flow-picker-simulate').checked=referenceOnly!==true;
    updatePicker();byId('flow-picker').showModal();
    byId('flow-picker-body').scrollTop=0;
    byId('flow-picker').querySelector('[data-photo-view="'+selected+'"]').focus({preventScroll:true});
  }
  function pick(camera){
    byId('flow-picker').close();var input=byId('flow-upload');
    if(camera)input.setAttribute('capture','environment');else input.removeAttribute('capture');input.click();
  }
  function pickPrimary(camera){
    if(busy||generating)return;
    selected='frontal';
    var input=byId('flow-upload');
    if(camera)input.setAttribute('capture','user');else input.removeAttribute('capture');
    input.click();
  }
  async function upload(){
    var input=byId('flow-upload'),file=input.files[0],view=selected,firstPhoto=!S.photos.length;if(!file||busy||generating)return;
    if(!fotoPropiaPermitida(file)){input.value='';mostrarAvisoAplicacion('Fotografía no válida','Usa JPG, PNG o WebP de hasta 20 MB.');return;}
    if(S.photos.some(function(p){return p.view===view;})&&!window.confirm('Ya hay una foto de '+label(view).toLowerCase()+'. ¿Reemplazarla? Su simulación anterior se retirará de este caso.')){input.value='';return;}
    busy=true;render();
    try{
      var data=await leerFotoPropia(file),b64=await redimensionarFotoB64(data,1280,.92);
      var photo={view:view,b64:b64,mimeType:'image/jpeg',referenceOnly:!byId('flow-picker-simulate').checked},index=S.photos.findIndex(function(p){return p.view===view;});
      if(index<0)S.photos.push(photo);else S.photos[index]=photo;
      invalidarVistaCargada(view);S.quickGuided=true;S.independentIntraoral=S.photos.length===1&&view==='intraoral';addedView=view;saveProgress('s-vita');
    }catch(error){mostrarAvisoAplicacion('No se pudo cargar la foto','La fotografía anterior se conserva. Intenta con otro archivo.');}
    finally{busy=false;input.value='';render();if(firstPhoto&&S.photos.length)advanceGuided(1,true);}
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
    ensureShadeState();
    if(shadeRenderedGuide!=='dual')renderShadeGuides();
    var design=SmylSmileModes.normalize(S.smileDesign);
    instructionText(design.instructions,false);
    byId('flow-tone-group').hidden=design.mode==='alignment';byId('flow-original-tone').hidden=design.mode!=='alignment';
    var tone=S.vitaMode==='current'?'current':S.vitaTone||(typeof tonoPredeterminadoGuia==='function'?tonoPredeterminadoGuia(currentShadeGuide()):(currentShadeGuide()==='bleached'?'BL2':'A2'));
    byId('flow-tone-selected').innerHTML='<span>TONO ELEGIDO</span><strong>'+selectedToneLabel(tone)+'</strong>';
    document.querySelectorAll('[data-flow-tone]').forEach(function(b){var chosen=b.dataset.flowGuide===currentShadeGuide()&&b.dataset.flowTone===tone;b.classList.toggle('selected',chosen);b.setAttribute('aria-pressed',String(chosen));b.disabled=busy||generating||design.mode==='alignment';});
    document.querySelectorAll('[data-shade-guide-step]').forEach(function(control){control.disabled=busy||generating||design.mode==='alignment';});
    ['classical','bleached'].forEach(function(guide){shadeCarousels[guide]?.sync(S.shadeToneByGuide?.[guide]||(guide==='bleached'?'BL2':'A2'));});
    document.querySelectorAll('#quick-config .quick-choice').forEach(function(el){el.setAttribute('aria-pressed',String(el.classList.contains('selected')));});
    if(byId('flow-tone-continue'))byId('flow-tone-continue').disabled=busy||generating||design.mode==='alignment';
    renderProgressive();
  }
  function render(){
    var stage=byId('flow-main-photo'),strip=byId('flow-photo-strip');stage.replaceChildren();strip.replaceChildren();var primary=S.photos[0];
    var photoWorkspace=byId('flow-photo-workspace'),prepareGrid=photoWorkspace?.parentElement;
    if(photoWorkspace)photoWorkspace.hidden=!primary;
    if(prepareGrid)prepareGrid.classList.toggle('photo-first',!primary);
    if(primary){
      var image=element('img');image.src=source(primary);image.alt=label(primary.view)+(primary.adjustOriginal?' · fotografía ajustada':' · fotografía original');stage.append(image,element('span','flow-photo-caption',(primary.referenceOnly?'Solo referencia':'Incluida en la simulación')+' · '+label(primary.view)));
      var readiness=element('div','flow-photo-readiness');readiness.innerHTML='<strong>Comprueba antes de seguir</strong><span>Sonrisa visible</span><span>Buena luz</span><span>Rostro centrado</span>';stage.append(readiness);
      S.photos.forEach(function(photo){var item=button('',function(){select(photo);},'flow-thumb'+(photo===primary?' selected':''));item.setAttribute('aria-label','Seleccionar '+label(photo.view));item.setAttribute('aria-pressed',String(photo===primary));var thumb=element('img');thumb.src=source(photo);thumb.alt='';item.append(thumb,element('span','',label(photo.view)),element('small','',photo.referenceOnly?'Solo referencia':SmylPhotoBatch.state(photo)==='ready'?'✓ Lista':'✓ A simular'));strip.append(item);});
    }else{
      var empty=element('div','flow-empty');empty.innerHTML='<span class="flow-empty-symbol" aria-hidden="true">＋</span><h2>Empieza con una fotografía</h2><p>Del rostro o intraoral.<br>La vista que quieras trabajar primero.</p>';empty.append(button('Tomar o subir foto',function(){choose();},'flow-primary'));stage.append(empty);
    }
    var photoMenu=byId('flow-photo-actions-menu');photoMenu.hidden=!primary;photoMenu.dataset.disabled=String(busy||generating);
    photoMenu.querySelector('summary').setAttribute('aria-disabled',String(!primary||busy||generating));
    if(!primary||busy||generating)photoMenu.removeAttribute('open');
    byId('flow-restore-photo').hidden=!primary?.adjustOriginal;byId('flow-add-photo').hidden=!primary;
    renderAnalysis();
    renderReturn();
    var added=S.photos.find(function(p){return p.view===addedView;});
    byId('flow-photo-count').textContent=busy?'Preparando fotografía…':added?'Foto lista · '+label(added.view):S.photos.length+' '+(S.photos.length===1?'fotografía':'fotografías')+' en este caso';
    var batch=SmylPhotoBatch.summary(),remaining=batch.count-batch.ready-batch.review;
    byId('flow-photo-role').hidden=!primary;
    byId('flow-photo-simulate').checked=!!primary&&!primary.referenceOnly;
    byId('flow-photo-simulate').disabled=busy||generating;
    byId('flow-generate').disabled=busy||generating||!batch.count;
    byId('flow-generate').classList.toggle('is-loading',generating);
    byId('flow-generate').setAttribute('aria-busy',String(generating));
    byId('flow-generation-note').textContent=!primary?'Añadir la fotografía no consume simulaciones.':!batch.count?'Marca al menos una fotografía para simular.':remaining?(remaining===1?'Generar esta propuesta usa 1 simulación.':'Se generarán '+remaining+' fotos marcadas; cada una usa 1 simulación.'):batch.review?'Hay resultados listos para revisar. Abrirlos no consume otra simulación.':'Tus simulaciones están listas. Volver a verlas no consume otra simulación.';
    var ref=primary&&referenciaDentalMaestraParaVista(primary.view);
    byId('flow-reference-status').textContent=ref?.role==='original-anatomy'?'Apoyo para esta vista: '+label(ref.view)+'. Su original ayuda a interpretar los dientes. Se simula también si está marcada.':'Intraorales opcionales: pueden apoyar las fotos del rostro y también tener su propia simulación. Usa «Solo referencia» si no quieres simularlas.';
    byId('flow-reference-add').hidden=!!(ref?.role==='original-anatomy');
    var reviewPhoto=byId('flow-review-photo');if(reviewPhoto){reviewPhoto.hidden=!primary;if(primary)reviewPhoto.src=source(primary);}
    document.querySelectorAll('#flow-photo-workspace button').forEach(function(el){el.disabled=busy||generating;});syncPreferences();
    document.querySelectorAll('#quick-objective-options button,#quick-arch-options button,#flow-instructions,#flow-instruction-mic,#flow-instruction-clear,.flow-note-chip,.flow-shade-arrow').forEach(function(el){el.disabled=busy||generating;});
    if((busy||generating)&&instructionListening)stopInstructionVoice();
    renderProgressive();
  }
  async function generate(){if(busy||generating||!SmylPhotoBatch.targets().length)return;generating=true;render();try{await confirmarConfiguracionRapida();}catch(error){mostrarAvisoAplicacion('No se completó la selección',error.message+' Las fotos y las simulaciones aceptadas se conservan.');}finally{if(returnSettings&&S.results[returnSettings.view]!==returnSettings.result)returnSettings=null;generating=false;render();}}
  function init(){
    document.body.classList.add('smyl-organized');
    ensureShadeState();
    var initialDesign=SmylSmileModes.normalize(S.smileDesign);
    if(initialDesign.mode==='veneers')S.smileDesign=SmylSmileModes.normalize(Object.assign({},initialDesign,{mode:'combined'}));
    if(!S.vitaTone&&S.vitaMode!=='current')S.vitaTone='A2';
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
    var actions=photos.querySelector('.flow-photo-toolbar');
    var photoMenu=element('details','flow-photo-actions-menu');photoMenu.id='flow-photo-actions-menu';
    var photoMenuSummary=element('summary','','Editar foto');photoMenuSummary.setAttribute('aria-label','Abrir opciones para editar la fotografía');
    var photoMenuBody=element('div','flow-photo-actions-popover');
    function closePhotoMenu(){photoMenu.removeAttribute('open');}
    var adjust=button('Reencuadrar',function(){closePhotoMenu();adjustPhoto();},'flow-photo-action');adjust.id='flow-adjust-photo';adjust.title='Ampliar, encuadrar y enderezar';
    var edit=button('Reemplazar',function(){var photo=S.photos[0];if(!photo)return;closePhotoMenu();choose(photo.view,photo.referenceOnly);},'flow-photo-action');edit.id='flow-edit-photo';
    var restore=button('Restaurar original',function(){closePhotoMenu();restorePhoto();},'flow-photo-action');restore.id='flow-restore-photo';
    var remove=button('Quitar foto',function(){var photo=S.photos[0];if(!photo)return;closePhotoMenu();if(!window.confirm('¿Quitar '+label(photo.view).toLowerCase()+' de este caso? Se retirará también su resultado asociado.'))return;S.photos=S.photos.filter(function(p){return p!==photo;});invalidarVistaCargada(photo.view);saveProgress('s-vita');render();},'flow-photo-action flow-photo-action-danger');remove.id='flow-remove-photo';
    photoMenuBody.append(adjust,edit,restore,remove);photoMenu.append(photoMenuSummary,photoMenuBody);
    var add=button('Añadir otra foto',function(){choose();},'flow-secondary');add.id='flow-add-photo';actions.append(photoMenu,add);
    var role=element('label','flow-photo-role');role.id='flow-photo-role';var simulate=element('input');simulate.type='checkbox';simulate.id='flow-photo-simulate';simulate.onchange=function(){if(busy||generating||!S.photos[0])return;S.photos[0].referenceOnly=!simulate.checked;saveProgress('s-vita');render();};role.append(simulate,element('span','','Simular esta foto'),element('small','','Desmárcala para usarla solo como referencia.'));photos.append(role);
    var analysis=element('section','flow-analysis-entry');analysis.id='flow-analysis-entry';analysis.hidden=true;
    var analysisCopy=element('div');analysisCopy.append(element('strong','','Análisis avanzado'));var analysisStatus=element('small');analysisStatus.id='flow-analysis-status';analysisStatus.setAttribute('role','status');analysisCopy.append(analysisStatus);
    var analysisOpen=button('Mostrar guías',analyzePhoto);analysisOpen.id='flow-analysis-open';analysis.append(analysisCopy,analysisOpen);
    var reference=element('aside','flow-reference');reference.innerHTML='<p id="flow-reference-status"></p><small>Usa fotos de la misma persona. El apoyo no garantiza exactitud anatómica.</small>';
    var refAdd=button('Añadir intraoral de referencia',function(){choose('intraoral',true);},'flow-text');refAdd.id='flow-reference-add';reference.append(refAdd);photos.append(reference);layout.append(photos);
    var config=byId('quick-config');config.querySelector('details').hidden=true;
    var progress=element('div','flow-progress');progress.id='flow-progress';progress.innerHTML='<div class="flow-progress-line"><span id="flow-progress-kicker"></span><button id="flow-progress-back" type="button">← Atrás</button></div><div id="flow-progress-track" class="flow-progress-track" role="progressbar" aria-label="Progreso de la simulación" aria-valuemin="1" aria-valuemax="5" aria-valuenow="1"><span></span><span></span><span></span><span></span><span></span></div>';config.prepend(progress);
    byId('flow-progress-back').onclick=function(){advanceGuided(previousGuidedStage(),true);};
    var configTitle=config.querySelector('h3'),configCopy=configTitle.nextElementSibling;configTitle.tabIndex=-1;configCopy.id='flow-progress-copy';
    var photoPrompt=element('section','flow-guided-photo');photoPrompt.id='flow-stage-photo';photoPrompt.innerHTML='<div class="flow-photo-coach" aria-hidden="true"><img src="icons/ui/smyl-face-capture-guide-v1.png" width="1254" height="1254" alt="" draggable="false"></div><div class="flow-guided-photo-copy"><span class="flow-stage-badge">PRIMER PASO</span><strong>Usa una foto frontal sonriendo</strong><p>De frente, con buena luz y sin filtros. Conservamos siempre el original.</p><ul><li>Rostro centrado</li><li>Dientes visibles</li><li>Imagen nítida</li></ul></div>';
    var photoActions=element('div','flow-guided-photo-actions');photoActions.append(button('Tomar foto',function(){pickPrimary(true);},'flow-primary'),button('Elegir archivo',function(){pickPrimary(false);},'flow-secondary'),button('Usar otra vista',function(){choose();},'flow-text'));photoPrompt.append(photoActions,element('small','flow-upload-help','JPG, PNG o WebP · máximo 20 MB · subirla no consume simulaciones'));configCopy.after(photoPrompt);
    var objectiveTitle=config.querySelector(':scope > .quick-choice-title'),objectiveOptions=byId('quick-objective-options'),objectiveStage=element('section','flow-guided-section');objectiveStage.id='flow-stage-objective';objectiveTitle.textContent='Elige una opción';objectiveTitle.before(objectiveStage);objectiveStage.append(objectiveTitle,objectiveOptions);
    var archOptions=byId('quick-arch-options'),archTitle=archOptions.previousElementSibling,archStage=element('section','flow-guided-section');archStage.id='flow-stage-arch';archTitle.textContent='Selecciona la zona';archTitle.before(archStage);archStage.append(archTitle,archOptions);
    illustrateChoices();
    objectiveOptions.querySelectorAll('button').forEach(function(control){control.addEventListener('click',function(){setTimeout(function(){advanceGuided(2,true);},0);});});
    archOptions.querySelectorAll('button').forEach(function(control){control.addEventListener('click',function(){setTimeout(function(){advanceGuided(SmylSmileModes.normalize(S.smileDesign).mode==='alignment'?4:3,true);},0);});});
    var appearanceLabel=byId('quick-appearance-options').previousElementSibling,tones=element('div');tones.id='flow-tone-group';appearanceLabel.before(tones);
    appearanceLabel.textContent='Elige un tono';tones.append(appearanceLabel);
    byId('quick-appearance-options').hidden=true;config.querySelector('label[for="quick-vita-tone"]').hidden=true;byId('quick-vita-tone').hidden=true;
    var selectedTone=element('div','flow-tone-selected');selectedTone.id='flow-tone-selected';selectedTone.setAttribute('aria-live','polite');
    var vitaShell=element('section','flow-vita-shell');vitaShell.id='flow-shade-panel';vitaShell.setAttribute('aria-label','Comparar tonos naturales y de blanqueamiento');
    var comparison=element('div','flow-shade-comparison');
    [['classical','Guía VITA','Tonos naturales'],['bleached','Bleaches','BL1 a BL4']].forEach(function(entry){
      var guide=entry[0],row=element('section','flow-shade-row');row.dataset.guide=guide;row.setAttribute('aria-labelledby','flow-shade-title-'+guide);
      var head=element('div','flow-shade-row-head');head.innerHTML='<div><span>'+entry[1]+'</span><strong id="flow-shade-title-'+guide+'">'+entry[2]+'</strong></div><div class="flow-shade-controls"><button type="button" class="flow-shade-arrow" data-shade-guide-step="'+guide+'" data-shade-step="-1" aria-label="'+entry[1]+' anterior">‹</button><button type="button" class="flow-shade-arrow" data-shade-guide-step="'+guide+'" data-shade-step="1" aria-label="'+entry[1]+' siguiente">›</button></div>';
      var track=element('div','flow-vita-track');track.id='flow-vita-'+guide+'-track';track.setAttribute('aria-label',entry[1]+' · '+entry[2]);
      row.append(head,track);comparison.append(row);
    });
    vitaShell.append(comparison,selectedTone);
    var toneContinue=button('Continuar con este tono',function(){advanceGuided(4,true);},'flow-primary flow-tone-continue');toneContinue.id='flow-tone-continue';
    tones.append(vitaShell,toneContinue,element('p','flow-tone-help','Referencia digital orientativa. Confirma VITA y Bleach BL con sus guías físicas.'));
    tones.classList.add('flow-guided-section');tones.dataset.stage='tone';
    vitaShell.querySelectorAll('[data-shade-guide-step]').forEach(function(control){control.onclick=function(){shadeCarousels[control.dataset.shadeGuideStep]?.step(Number(control.dataset.shadeStep));};});
    window.addEventListener('smyl:shadeguidechange',function(){renderShadeGuides();syncPreferences();});
    renderShadeGuides();
    var originalTone=element('p','flow-muted','Se conserva el color original de los dientes.');originalTone.id='flow-original-tone';tones.after(originalTone);
    var notes=element('details','flow-notes');notes.innerHTML='<summary>Añadir una indicación <span>Opcional</span></summary><div class="flow-note-heading"><div><strong>¿Quieres personalizar el resultado?</strong><span>Escribe o graba una indicación. Siempre podrás revisarla antes de generar.</span></div></div><label for="flow-instructions">Indicaciones adicionales</label><textarea id="flow-instructions" rows="3" maxlength="500" placeholder="Por ejemplo: conservar el tamaño de los dientes y un acabado natural." aria-describedby="flow-instruction-help flow-instruction-voice-status flow-instruction-count"></textarea><div class="flow-note-actions"><button id="flow-instruction-mic" class="flow-note-voice" type="button" aria-pressed="false"><span class="flow-note-voice-icon" aria-hidden="true">●</span><span class="flow-note-voice-label">Grabar voz</span></button><button id="flow-instruction-clear" class="flow-note-clear" type="button" hidden>Limpiar</button></div><p id="flow-instruction-voice-status" class="flow-note-status" role="status" aria-live="polite">La voz se convierte en texto editable. SMYL conserva únicamente el texto que decidas usar.</p><div class="flow-note-chips" aria-label="Indicaciones sugeridas"><button type="button" class="flow-note-chip" data-flow-instruction="Conservar el tamaño individual de los dientes.">Conservar tamaño</button><button type="button" class="flow-note-chip" data-flow-instruction="Mantener un acabado natural y preservar la encía.">Acabado natural</button><button type="button" class="flow-note-chip" data-flow-instruction="Cerrar todos los espacios visibles sin fusionar las piezas.">Contactos cerrados</button></div><div class="flow-note-help"><small id="flow-instruction-help">Complementan tus selecciones; no cambian la arcada ni sustituyen la valoración clínica.</small><small id="flow-instruction-count">0/500</small></div>';
    var review=element('section','flow-review');review.id='flow-stage-review';review.innerHTML='<div class="flow-review-ready"><img id="flow-review-photo" alt="Fotografía que se utilizará" hidden><span aria-hidden="true">✓</span><div><strong>Todo listo para comparar</strong><small>Revisa la propuesta. Podrás volver y cambiar cualquier elección.</small></div></div><div class="flow-review-list"><div><span>Cambio</span><strong id="flow-review-objective"></strong><button type="button" data-edit-stage="1">Cambiar</button></div><div><span>Zona</span><strong id="flow-review-arch"></strong><button type="button" data-edit-stage="2">Cambiar</button></div><div id="flow-review-tone-row"><span>Claridad</span><strong id="flow-review-tone"></strong><button type="button" data-edit-stage="3">Cambiar</button></div></div><p class="flow-review-safety"><span aria-hidden="true">i</span> Es una comparación visual orientativa, no un diagnóstico ni una predicción clínica.</p>';
    review.querySelectorAll('[data-edit-stage]').forEach(function(control){control.onclick=function(){advanceGuided(Number(control.dataset.editStage),true);};});
    var gen=config.querySelector('.quick-generate');gen.before(review);review.append(notes,gen);gen.id='flow-generate';gen.textContent='Generar mi propuesta';gen.removeAttribute('onclick');gen.onclick=generate;
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
    var footer=element('footer','flow-picker-footer');footer.innerHTML='<strong id="flow-picker-selected"></strong><p id="flow-picker-hint"></p><p id="flow-picker-replace" hidden>Ya añadida. Tomar o subir otra foto reemplazará esta vista.</p><label class="flow-photo-role"><input id="flow-picker-simulate" type="checkbox" checked><span>Simular esta foto</span><small>Desmárcala para usarla solo como referencia.</small></label>';
    var pickerActions=element('div','flow-picker-actions');pickerActions.append(button('Tomar foto',function(){pick(true);},'flow-primary'),button('Subir foto',function(){pick(false);}));footer.append(pickerActions,element('small','','Cargar fotos no consume simulaciones.'));picker.append(pickerBody,footer);
    picker.addEventListener('close',function(){if(pickerFocus?.isConnected)pickerFocus.focus({preventScroll:true});});
    var input=element('input');input.type='file';input.id='flow-upload';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;input.onchange=upload;shell.append(input);screen.append(shell);document.body.append(screen,picker);
    byId('flow-instructions').addEventListener('input',function(){instructionText(this.value,true);});
    byId('flow-instruction-mic').addEventListener('click',toggleInstructionVoice);
    byId('flow-instruction-clear').addEventListener('click',function(){stopInstructionVoice();instructionText('',true);instructionStatus('Indicación eliminada. Puedes escribir o grabar otra.','');byId('flow-instructions').focus();});
    document.querySelectorAll('.flow-note-chip').forEach(function(control){control.addEventListener('click',function(){addInstructionPreset(control.dataset.flowInstruction||'');});});
    var previousSync=window.sincronizarConfiguracionRapida;window.sincronizarConfiguracionRapida=function(){previousSync();syncPreferences();};
    var previousOpen=window.abrirConfiguracionRapida;window.abrirConfiguracionRapida=function(){
      var photo=existingResultPhoto();
      if(byId('s-res').classList.contains('active')&&photo){
        var settings={smileDesign:JSON.parse(JSON.stringify(S.smileDesign||{}))};
        ['vitaTone','vitaMode','vitaFinish','vitaIntensity','vitaConstruction','shadeGuide','shadeToneByGuide','shadeCompareByGuide'].forEach(function(key){settings[key]=(key==='shadeToneByGuide'||key==='shadeCompareByGuide')?Object.assign({},S[key]||{}):S[key];});
        returnSettings={owner:progressKey(),caseId:S.casoId,view:photo.view,result:S.results[photo.view],settings:settings};
      }
      guidedStage=photo?4:(S.photos.length?1:0);
      previousOpen();render();show('s-photos');
    };
    var previousQuality=window.renderControlCalidadSimulacion;window.renderControlCalidadSimulacion=function(){var result=previousQuality.apply(this,arguments);renderAnalysis();return result;};
    var resHeader=byId('s-res').querySelector('.res-header');var oldNewPhoto=resHeader.querySelector('button[onclick="repetirFotografias()"]');if(oldNewPhoto)oldNewPhoto.hidden=true;
    var tools=element('details','flow-result-tools');tools.append(element('summary','','Más opciones'));var toolBody=element('div','flow-tool-body');tools.append(toolBody);
    toolBody.append(analysis);
    Array.from(resHeader.querySelectorAll('.res-vita-btn')).forEach(function(control){toolBody.append(control);});
    if(byId('btn-regenerar'))toolBody.append(byId('btn-regenerar'));
    ['btn-editor-diseno','btn-revision-clinica','diag-request-box'].forEach(function(id){if(byId(id))toolBody.append(byId(id));});byId('s-res').querySelector('.res-body').prepend(tools);
    var alignment=byId('ba-align-btn');
    if(alignment){alignment.removeAttribute('style');alignment.className='flow-secondary';alignment.textContent='Ajustar encuadre';toolBody.append(alignment);}
    var resultIntro=element('section','flow-result-intro');resultIntro.innerHTML='<div class="flow-result-kicker">TU PROPUESTA VISUAL</div><div class="flow-result-heading"><div><h1>Compara el cambio a tu ritmo</h1><p>Desliza horizontalmente sobre la imagen. Para seguir bajando, desliza en vertical.</p></div><div class="flow-result-actions"><button type="button" class="flow-secondary" id="flow-result-adjust">Ajustar diseño</button><button type="button" class="flow-primary" id="flow-result-save">Guardar resultado</button></div></div><div id="flow-result-status" class="flow-result-status" role="status" aria-live="polite"></div><div class="flow-result-summary" aria-label="Resumen de la propuesta"><span id="flow-result-objective"></span><span id="flow-result-arch"></span><span id="flow-result-tone"></span></div><div class="flow-result-modes" role="tablist" aria-label="Modo de comparación"><button type="button" role="tab" data-result-mode="compare" aria-selected="true">Comparación</button><button type="button" role="tab" data-result-mode="original" aria-selected="false">Original</button><button type="button" role="tab" data-result-mode="proposal" aria-selected="false">Propuesta</button></div>';
    var baWrap=byId('ba-wrap');baWrap.before(resultIntro);byId('flow-result-adjust').onclick=openPhotos;
    function setResultMode(mode){var position=mode==='original'?100:mode==='proposal'?0:50,over=byId('ba-over'),line=byId('ba-line');if(over)over.style.clipPath='inset(0 0 0 '+position+'%)';if(line)line.style.left=position+'%';document.querySelectorAll('[data-result-mode]').forEach(function(control){control.setAttribute('aria-selected',String(control.dataset.resultMode===mode));});}
    resultIntro.querySelectorAll('[data-result-mode]').forEach(function(control){control.onclick=function(){setResultMode(control.dataset.resultMode);};});
    var viewsHead=element('div','flow-result-section-head');viewsHead.id='flow-result-views-head';viewsHead.innerHTML='<div><span>OTRAS VISTAS</span><strong>Cambia de fotografía sin perder tu comparación</strong></div>';byId('res-photos').before(viewsHead);
    var toneTool=button('Cambiar tono VITA',openToneSelection,'flow-secondary');toneTool.id='flow-result-tone-tool';toolBody.append(toneTool);
    var mobileDock=element('nav','flow-result-dock');mobileDock.setAttribute('aria-label','Acciones del resultado');var dockAdjust=button('Ajustar diseño',openPhotos,'flow-secondary'),dockPrimary=button('Guardar resultado',runResultPrimary,'flow-primary');dockPrimary.id='flow-result-dock-primary';mobileDock.append(dockAdjust,dockPrimary);byId('res-photos').after(mobileDock);
    var resultPrimary=byId('flow-result-save'),resultStatus=byId('flow-result-status'),resultActionBusy=false;
    resultPrimary.onclick=runResultPrimary;
    function setResultStatus(message,state){resultStatus.textContent=message||'';resultStatus.dataset.state=state||'';}
    function updateResultPrimary(saved){var actionLabel=saved?'Compartir resultado':'Guardar resultado';resultPrimary.textContent=actionLabel;dockPrimary.textContent=actionLabel;resultPrimary.disabled=resultActionBusy;dockPrimary.disabled=resultActionBusy;resultPrimary.setAttribute('aria-busy',String(resultActionBusy));dockPrimary.setAttribute('aria-busy',String(resultActionBusy));}
    function focusPatientName(){var target=byId('case-actions-box')||byId('fn');if(target)target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});setTimeout(function(){byId('fn')?.focus();},250);}
    async function runResultPrimary(){
      if(resultActionBusy)return;
      if(S._casoGuardado){resultActionBusy=true;updateResultPrimary(true);setResultStatus('Abriendo opciones para compartir…','working');try{var shared=await window.compartirResultadoGuardado();setResultStatus(shared?'Resultado listo para compartir.':'No se compartió el resultado.','');}finally{resultActionBusy=false;updateResultPrimary(true);}return;}
      var name=byId('fn');if(!name||!name.value.trim()){setResultStatus('Completa el nombre del paciente para guardar el resultado.','attention');focusPatientName();return;}
      resultActionBusy=true;updateResultPrimary(false);setResultStatus('Guardando el resultado en el expediente…','working');
      try{var saved=await window.guardarCaso();if(saved){updateResultPrimary(true);setResultStatus('Resultado guardado. Ya puedes compartirlo.','success');}else setResultStatus('No se pudo guardar. Revisa tu conexión e intenta de nuevo.','attention');}
      catch(error){S._guardandoCaso=false;window.restaurarBotonGuardado?.(byId('btn-guardar'));console.error('[SMYL] Error al guardar desde el resultado:',error);setResultStatus('No se pudo guardar. Tu simulación sigue disponible.','attention');}
      finally{resultActionBusy=false;updateResultPrimary(!!S._casoGuardado);}
    }
    window.addEventListener('smyl:case-saved',function(){resultActionBusy=false;updateResultPrimary(true);setResultStatus('Resultado guardado. Ya puedes compartirlo.','success');});
    function renderResultExperience(){var design=SmylSmileModes.normalize(S.smileDesign),tone=S.vitaMode==='current'?'current':S.vitaTone||'A2',guide=currentShadeGuide();byId('flow-result-objective').textContent=guidedObjectiveLabel(design.mode);byId('flow-result-arch').textContent='Zona: '+guidedArchLabel(design.arch);byId('flow-result-tone').textContent=design.mode==='alignment'?'Tono original':selectedToneLabel(tone);toneTool.textContent=guide==='bleached'?'Cambiar tono Bleached':'Cambiar tono VITA';updateResultPrimary(!!S._casoGuardado);}
    var resultQuality=window.renderControlCalidadSimulacion;window.renderControlCalidadSimulacion=function(){var result=resultQuality.apply(this,arguments);renderResultExperience();return result;};
    byId('s-res').querySelector('.res-logo').after(steps(1));updateResultPrimary(!!S._casoGuardado);renderResultExperience();render();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
