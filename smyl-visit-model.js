/* SMYL · Recorrido de la visita: qué pasos tiene una visita y en qué estado está cada uno.
 * Función pura (sin DOM ni red): recibe lo ya leído del paciente, su historia y sus archivos, y devuelve los pasos.
 * Es una lista, no un candado: ningún paso bloquea a otro. El progreso cuenta solo los pasos de captura (no la simulación). */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylVisitModel=api;})(globalThis,function(){
  'use strict';
  var PENDING_PREFIX='Por registrar · ';
  function plural(n,one,many){return n+' '+(n===1?one:many);}
  function isPending(p){return !!p&&(p.registro_estado==='pendiente'||String(p.nombre||'').indexOf(PENDING_PREFIX)===0);}

  function dataStep(p,canManage){
    var base={key:'datos',title:'Datos del paciente',counts:true};
    /* Con permiso para gestionar pacientes, lo más rápido es que la persona los llene sola desde su celular (código QR). */
    if(isPending(p))return Object.assign(base,{state:'todo',text:'Falta su nombre y sus datos.',actions:canManage?[{id:'qr',label:'Mostrar código QR',primary:true},{id:'complete',label:'Completar datos'},{id:'link',label:'Enviar enlace'}]:[{id:'complete',label:'Completar datos',primary:true},{id:'link',label:'Enviar enlace'}]});
    if(p&&p.registro_estado==='por_verificar')return Object.assign(base,{state:'todo',text:'Los llenó el paciente. Falta confirmarlos.',actions:(canManage?[{id:'confirm',label:'Confirmar datos',primary:true}]:[]).concat([{id:'complete',label:'Revisar y editar',primary:!canManage}])});
    return Object.assign(base,{state:'done',text:'Completos.',actions:[{id:'complete',label:'Editar datos'}]});
  }

  /* history: undefined = no se pudo leer, null = aún no existe, objeto = el documento de la historia. H = SmylHistoryModel.
   * canWrite: puede guardar datos clínicos (clinical.write); solo entonces se ofrece la entrevista. */
  function historyStep(history,H,canWrite){
    var base={key:'historia',title:'Historia clínica',counts:true};
    var open=function(primary,label){return {id:'history',label:label||'Abrir historia clínica',primary:!!primary};};
    if(history===undefined||!H)return Object.assign(base,{state:'unknown',text:'Ábrela para ver cómo va.',actions:[open(true)]});
    if(history===null)return Object.assign(base,{state:'todo',text:'Todavía no se empieza.',actions:canWrite?[{id:'interview',label:'Empezar la historia',primary:true},open(false,'Abrir historia completa')]:[open(true)]});
    var pending=H.pendingLabels(history),done=H.coverage(history),total=done+pending.length;
    if(!pending.length)return Object.assign(base,{state:'done',text:'Completa: '+done+' de '+total+' confirmadas.',actions:canWrite?[{id:'interview',label:'Revisar de nuevo'},open(false)]:[open(false)]});
    return Object.assign(base,{state:'todo',text:done+' de '+total+' confirmadas. Falta: '+pending.slice(0,3).join(', ')+(pending.length>3?' y '+(pending.length-3)+' más':'')+'.',actions:canWrite?[{id:'interview',label:'Completar la historia',primary:true},open(false,'Abrir historia completa')]:[open(true)]});
  }

  /* files: undefined = no se pudo leer, o la lista de {category}. */
  function studiesStep(files){
    var base={key:'estudios',title:'Fotos y radiografía',counts:true,actions:[{id:'files',label:'Subir o ver estudios',primary:true}]};
    if(!Array.isArray(files))return Object.assign(base,{state:'unknown',text:'Ábrelos para ver qué hay.'});
    var photos=files.filter(function(f){return f&&f.category==='clinical_photo';}).length,xrays=files.filter(function(f){return f&&f.category==='radiograph';}).length;
    if(!photos&&!xrays)return Object.assign(base,{state:'todo',text:'Todavía no hay fotos ni radiografías.'});
    return Object.assign(base,{state:'done',text:[photos?plural(photos,'foto','fotos'):'',xrays?plural(xrays,'radiografía','radiografías'):''].filter(Boolean).join(' y ')+'.',actions:[{id:'files',label:'Subir o ver estudios'}]});
  }

  /* consent: undefined = no se pudo leer, {signed:false} o {signed:true,…}. summary: texto ya armado de quién y cuándo firmó. */
  function consentStep(consent,o){
    var base={key:'privacidad',title:'Aviso de privacidad',counts:true},sign={id:'consent',label:'Pedir firma',primary:true};
    if(consent===undefined)return Object.assign(base,{state:'unknown',text:'Ábrelo para ver si está firmado.',actions:o.canSign?[sign]:[]});
    if(consent&&consent.signed)return Object.assign(base,{state:'done',text:o.summary||'Firmado.',actions:o.canView?[{id:'consent-view',label:'Ver firma'}]:[]});
    return Object.assign(base,{state:'todo',text:'Falta su firma.',actions:o.canSign?[sign]:[]});
  }

  function simulationStep(){return {key:'simulacion',title:'Simulación',counts:false,state:'optional',text:'Para mostrársela al paciente.',actions:[{id:'simulator',label:'Abrir el simulador'}]};}

  function build(input){
    input=input||{};
    var steps=[dataStep(input.patient,!!input.canManage),consentStep(input.consent,{canSign:!!input.canSignConsent,canView:!!input.canViewConsent,summary:input.consentSummary}),historyStep(input.history,input.historyModel,!!input.canWriteClinical),studiesStep(input.files),simulationStep()];
    var counted=steps.filter(function(s){return s.counts;}),done=counted.filter(function(s){return s.state==='done';}).length;
    var current=counted.filter(function(s){return s.state==='todo';})[0];
    steps.forEach(function(s){s.current=!!current&&s.key===current.key;});
    return {steps:steps,done:done,total:counted.length,current:current?current.key:null};
  }
  /* Cierre de la visita: qué quedó hecho y qué falta de los pasos de captura. «unknown» = no se pudo comprobar (no se da por hecho ni por faltante). */
  function closing(model){
    var counted=(model&&model.steps||[]).filter(function(st){return st.counts;});
    return {items:counted.map(function(st){return {key:st.key,title:st.title,state:st.state,text:st.text};}),
      missing:counted.filter(function(st){return st.state==='todo';}).length,
      unchecked:counted.filter(function(st){return st.state==='unknown';}).length};
  }
  /* Mensaje de despedida para el paciente. Solo cortesía y la próxima cita: nunca datos clínicos, diagnósticos ni cobros.
   * name: nombre completo o vacío (una ficha por registrar no tiene nombre). nextText: «martes 17 de noviembre a las 4:00 pm» o vacío. */
  function farewell(o){
    o=o||{};
    var first=String(o.name||'').trim().split(/\s+/)[0]||'';
    var hello=first&&!isPending({nombre:o.name})?'Hola '+first+', gracias por tu visita.':'Hola, gracias por tu visita.';
    var next=String(o.nextText||'').trim();
    return hello+' '+(next?'Tu próxima cita es el '+next+'.':'Cuando quieras agendar tu próxima cita, escríbenos por aquí.')+' ¡Hasta pronto!';
  }
  return {build:build,closing:closing,farewell:farewell,isPending:isPending};
});
