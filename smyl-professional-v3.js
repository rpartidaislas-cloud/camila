/* SMYL · Professional management shell v3. Presentation only; business rules stay in their modules. */
(function(){
  'use strict';
  var ROUTES={
    dashboard:['Inicio','Resumen operativo de la clínica'],agenda:['Agenda','Citas, llegadas y disponibilidad'],pacientes:['Pacientes','Directorio y expedientes clínicos'],
    'paciente-detalle':['Expediente','Atención clínica del paciente'],propuestas:['Cotizaciones','Seguimiento de las cotizaciones a tus pacientes'],caja:['Finanzas','Saldos, pagos y control financiero de la clínica'],
    inbox:['Mensajes','Conversaciones que requieren atención'],precios:['Servicios y tarifas','Catálogo clínico, precios y claves fiscales'],inventario:['Inventario','Existencias, compras y trazabilidad'],
    reportes:['Reportes','Indicadores operativos del negocio'],configuracion:['Configuración','Todo lo que puedes ajustar en tu clínica'],clinica:['Mi clínica','Sucursales, equipo y permisos'],conexiones:['Canales y asistente','Conexiones y automatización supervisada']
  };
  var taskDialog,taskType='',taskPatients=[],taskPlans=null,taskQuotes=null,taskQuoteFilter='ready',taskSequence=0;
  function n(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;}
  function sk(k,o){return window.SmylSkeleton?window.SmylSkeleton.html(k,o):'<p>'+((o&&o.label)||'Cargando')+'…</p>';}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function route(name){if(typeof window.ir==='function')window.ir(name);}
  function activeRoute(){var page=document.querySelector('.pantalla.activa');return page&&page.id?page.id.replace(/^p-/,''):'dashboard';}
  function openAppointment(patient){
    if(patient&&window.SmylSchedule&&window.SmylSchedule.forPatient)return window.SmylSchedule.forPatient(patient);
    route('agenda');var tries=0;(function ready(){var button=document.getElementById('schedule-new');if(button)return button.click();if(tries++<80)setTimeout(ready,50);})();
  }
  function patientName(patient){return [patient.nombre,patient.apellido].filter(Boolean).join(' ')||'Paciente';}
  function closeTask(){taskSequence++;if(!taskDialog)return;if(typeof taskDialog.close==='function'&&taskDialog.open)taskDialog.close();else taskDialog.removeAttribute('open');}
  function runTask(type,patientId){
    closeTask();
    if(type==='appointment'){if(window.SmylSchedule&&window.SmylSchedule.forPatient)return window.SmylSchedule.forPatient(patientId);return openAppointment(patientId);}
    if(type==='quote'){if(window.SmylProposals&&window.SmylProposals.forPatient)return window.SmylProposals.forPatient(patientId);return route('propuestas');}
    if(type==='payment'){if(window.SmylFinance&&window.SmylFinance.forPatient)return window.SmylFinance.forPatient(patientId);return route('caja');}
  }
  function taskPicker(){
    taskType='';taskSequence++;
    taskDialog.querySelector('[data-task-body]').innerHTML='<div class="pro-task-intro"><span>TAREAS FRECUENTES</span><h2 id="pro-task-title">¿Qué necesitas hacer?</h2><p>Elige una tarea y después al paciente. SMYL abrirá directamente el proceso correcto.</p></div><div class="pro-task-options"><button type="button" data-care-task="appointment"><i aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 14v4M10 16h4"/></svg></i><span><strong>Agendar cita</strong><small>Paciente, servicio, profesional y horario</small></span><b>1</b></button><button type="button" data-care-task="quote"><i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg></i><span><strong>Preparar cotización</strong><small>Desde el plan clínico revisado</small></span><b>2</b></button><button type="button" data-care-task="payment"><i aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg></i><span><strong>Registrar cobro</strong><small>Aplicar el pago y generar recibo interno</small></span><b>3</b></button></div><div class="pro-task-note"><strong>Un proceso a la vez.</strong><span>Ninguna acción se confirma automáticamente.</span></div>';
    taskDialog.querySelectorAll('[data-care-task]').forEach(function(button){button.onclick=function(){patientPicker(button.dataset.careTask);};});
  }
  // Cotizar: el estado de la propuesta clínica se ve antes de elegir. Listos primero; sin plan → directo a su propuesta;
  // si ya hay una cotización de esa misma propuesta, se continúa en lugar de crear un duplicado.
  var PLAN_STATES={ready:['Listo para cotizar','Se abre con sus tratamientos y precios'],draft:['Propuesta sin revisar','Te llevamos a terminarla'],none:['Sin propuesta','Te llevamos a su expediente para hacerla']};
  function shortDate(iso){var d=new Date(iso||'');return isNaN(d)?'':d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});}
  function planState(patient){if(taskType!=='quote'||!taskPlans)return '';var plan=taskPlans.get(patient.id);return plan?(plan.status==='reviewed'?'ready':'draft'):'none';}
  function existingQuote(patient){if(taskType!=='quote'||!taskQuotes||!taskPlans)return null;var quote=taskQuotes.get(patient.id),plan=taskPlans.get(patient.id);return quote&&plan&&plan.status==='reviewed'&&quote.plan_revision===plan.revision?quote:null;}
  function patientButton(patient){
    var name=patientName(patient),initials=name.split(/\s+/).slice(0,2).map(function(part){return part.charAt(0);}).join('').toUpperCase(),state=planState(patient),meta=PLAN_STATES[state],quote=existingQuote(patient),plan=taskPlans&&taskPlans.get(patient.id),chip=meta&&meta[0],sub=meta&&meta[1],attrs=state?' data-plan="'+state+'"':'';
    if(quote){chip=quote.status==='approved'?'Cotización aprobada':'Cotización en borrador';sub='Continuar la cotización del '+shortDate(quote.updated_at);attrs+=' data-quote="'+esc(quote.id)+'"';}
    else if(state==='ready'&&plan&&plan.reviewed_at)sub='Propuesta revisada el '+shortDate(plan.reviewed_at);
    return '<button type="button" data-task-patient="'+esc(patient.id)+'"'+attrs+'><i>'+esc(initials)+'</i><span><strong>'+esc(name)+'</strong>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</span>'+(chip?'<em>'+esc(chip)+'</em>':'')+'<b aria-hidden="true">→</b></button>';
  }
  function renderQuoteTabs(ready,rest,total){
    var host=taskDialog.querySelector('[data-task-tabs]');if(!host)return;
    host.hidden=false;host.innerHTML=[['ready','Listos',ready],['pending','Por completar',rest],['all','Todos',total]].map(function(tab){return '<button type="button" role="tab" data-task-tab="'+tab[0]+'" aria-selected="'+(taskQuoteFilter===tab[0])+'">'+tab[1]+' <span>'+tab[2]+'</span></button>';}).join('');
    host.querySelectorAll('[data-task-tab]').forEach(function(button){button.onclick=function(){taskQuoteFilter=button.dataset.taskTab;var input=taskDialog.querySelector('[data-task-search]');renderPatients(input?input.value:'');};});
  }
  function renderPatients(term){
    var host=taskDialog.querySelector('[data-task-patients]'),query=String(term||'').trim().toLocaleLowerCase('es-MX'),matches=taskPatients.filter(function(patient){return !query||patientName(patient).toLocaleLowerCase('es-MX').includes(query);});
    if(taskType==='quote'&&taskPlans){
      var allReady=taskPatients.filter(function(p){return planState(p)==='ready';}).length;renderQuoteTabs(allReady,taskPatients.length-allReady,taskPatients.length);
      var ready=matches.filter(function(p){return planState(p)==='ready';}),rest=matches.filter(function(p){return planState(p)!=='ready';}),filter=query?'all':taskQuoteFilter;
      if(filter==='ready')host.innerHTML=ready.length?ready.slice(0,60).map(patientButton).join(''):'<div class="pro-task-empty"><strong>Nadie listo para cotizar todavía</strong><p>Elige un paciente en «Por completar» y te llevamos a completar su propuesta clínica.</p></div>';
      else if(filter==='pending')host.innerHTML=rest.length?rest.slice(0,60).map(patientButton).join(''):'<div class="pro-task-empty"><strong>Todos tienen su propuesta revisada</strong></div>';
      else if(!matches.length)host.innerHTML='<div class="pro-task-empty"><strong>No encontramos pacientes</strong><p>Revisa la búsqueda o registra uno nuevo.</p></div>';
      else host.innerHTML=(ready.length?'<p class="pro-task-group">Listos para cotizar · '+ready.length+'</p>'+ready.slice(0,30).map(patientButton).join(''):'')+(rest.length?'<p class="pro-task-group">Necesitan propuesta · '+rest.length+'</p>'+rest.slice(0,60).map(patientButton).join(''):'');
    }else host.innerHTML=matches.length?matches.slice(0,60).map(patientButton).join(''):'<div class="pro-task-empty"><strong>No encontramos pacientes</strong><p>Revisa la búsqueda o registra uno nuevo.</p></div>';
    host.querySelectorAll('[data-task-patient]').forEach(function(button){button.onclick=function(){pickPatient(button);};});
  }
  function pickPatient(button){
    var id=button.dataset.taskPatient,P=window.SmylProposals;
    if(taskType==='quote'&&button.dataset.quote&&P&&typeof P.openSaved==='function'){closeTask();P.openSaved(button.dataset.quote);return;}
    if(taskType==='quote'&&button.dataset.plan&&button.dataset.plan!=='ready'&&P&&typeof P.openPlan==='function'){closeTask();P.openPlan(id);return;}
    runTask(taskType,id);
  }
  async function patientPicker(type,direct){
    taskType=type;taskQuoteFilter='ready';var token=++taskSequence,labels={appointment:['Agendar cita','Selecciona al paciente para precargar su cita.'],quote:['Preparar cotización','Elige al paciente. Los que tienen su propuesta clínica revisada aparecen primero.'],payment:['Registrar cobro','Selecciona al paciente para consultar y aplicar sus saldos.']},copy=labels[type];
    taskDialog.querySelector('[data-task-body]').innerHTML='<div class="pro-task-step">'+(direct?'':'<button type="button" data-task-back>← Volver</button><span>PASO 2 DE 2</span>')+'<h2 id="pro-task-title">'+esc(copy[0])+'</h2><p>'+esc(copy[1])+'</p></div><label class="pro-task-search"><span class="sr-only">Buscar paciente</span><input type="search" data-task-search placeholder="Buscar por nombre…" autocomplete="off"></label><div class="pro-task-tabs" role="tablist" aria-label="Filtrar pacientes" data-task-tabs hidden></div><div class="pro-task-patients" data-task-patients aria-live="polite"><div class="pro-task-loading">'+sk('list',{rows:4,plain:true,label:'Cargando pacientes'})+'</div></div><button type="button" class="pro-task-new-patient" data-task-new>Registrar paciente nuevo</button>';
    var back=taskDialog.querySelector('[data-task-back]');if(back)back.onclick=taskPicker;taskDialog.querySelector('[data-task-new]').onclick=function(){closeTask();route('pacientes');setTimeout(function(){if(typeof window.abrirModalPaciente==='function')window.abrirModalPaciente();},0);};
    var input=taskDialog.querySelector('[data-task-search]');input.oninput=function(){renderPatients(input.value);};input.onkeydown=function(ev){if(ev.key!=='Enter')return;var first=taskDialog.querySelector('[data-task-patient]');if(first){ev.preventDefault();pickPatient(first);}};
    try{if(!window.sb||!window.tenantId)throw new Error('La sesión de la clínica no está disponible.');var request=window.sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id',window.tenantId).order('nombre').limit(200),result=await Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(request):request);if(token!==taskSequence||taskType!==type)return;if(result&&result.error)throw result.error;taskPatients=result&&result.data||[];taskPlans=null;taskQuotes=null;if(type==='quote'&&taskPatients.length){var ids=taskPatients.map(function(p){return p.id;});try{var planReq=window.sb.from('smyl_clinical_plans').select('patient_id,status,revision,reviewed_at').eq('tenant_id',window.tenantId).in('patient_id',ids),plans=await Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(planReq):planReq);if(token!==taskSequence||taskType!==type)return;if(plans&&!plans.error){taskPlans=new Map();(plans.data||[]).forEach(function(plan){taskPlans.set(plan.patient_id,plan);});}}catch(_){taskPlans=null;}
      try{var quoteReq=window.sb.from('smyl_proposals').select('id,patient_id,status,plan_revision,updated_at').eq('tenant_id',window.tenantId).in('patient_id',ids).order('updated_at',{ascending:false}).limit(500),quotes=await Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(quoteReq):quoteReq);if(token!==taskSequence||taskType!==type)return;if(quotes&&!quotes.error){taskQuotes=new Map();(quotes.data||[]).forEach(function(q){if(!taskQuotes.has(q.patient_id))taskQuotes.set(q.patient_id,q);});}}catch(_){taskQuotes=null;}
      if(taskPlans&&!taskPatients.some(function(p){return planState(p)==='ready';}))taskQuoteFilter='all';}renderPatients('');setTimeout(function(){if(token===taskSequence)input.focus();},0);}catch(error){if(token!==taskSequence||taskType!==type)return;taskDialog.querySelector('[data-task-patients]').innerHTML='<div class="pro-task-empty"><strong>No pudimos cargar los pacientes</strong><p>Conserva tu trabajo y vuelve a intentarlo.</p><button type="button" data-task-retry>Intentar de nuevo</button></div>';taskDialog.querySelector('[data-task-retry]').onclick=function(){patientPicker(type);};}
  }
  function openTask(type,patientId){if(type&&patientId)return runTask(type,patientId);if(!taskDialog)buildTaskDialog();taskPicker();if(typeof taskDialog.showModal==='function')taskDialog.showModal();else taskDialog.setAttribute('open','');if(type)patientPicker(type,true);}
  function buildTaskDialog(){
    if(document.getElementById('pro-task-dialog')){taskDialog=document.getElementById('pro-task-dialog');return;}
    taskDialog=n('dialog','pro-task-dialog');taskDialog.id='pro-task-dialog';taskDialog.setAttribute('aria-labelledby','pro-task-title');taskDialog.innerHTML='<div class="pro-task-shell"><button type="button" class="pro-task-close" data-task-close aria-label="Cerrar">×</button><div data-task-body></div></div>';document.body.append(taskDialog);taskDialog.querySelector('[data-task-close]').onclick=closeTask;taskDialog.onclick=function(event){if(event.target===taskDialog)closeTask();};
  }
  function topbar(name){
    var meta=ROUTES[name]||[window.TITULOS&&TITULOS[name]||name,''],title=document.getElementById('topbar-title'),sub=document.getElementById('topbar-sub');
    if(title)title.textContent=meta[0];if(sub)sub.textContent=meta[1];
    var action=document.querySelector('.topbar-right .pro-global-action');
    if(action){action.textContent='Nueva tarea';action.setAttribute('aria-label','Agendar, cotizar o cobrar');action.onclick=function(){openTask();};}
  }
  function setupTopbar(){
    if(window.TITULOS)Object.keys(ROUTES).forEach(function(key){TITULOS[key]=ROUTES[key][0];});
    var right=document.querySelector('.topbar-right');if(!right)return;
    var old=right.querySelector('.btn-primary');if(old)old.remove();
    // Sin botón «Nueva tarea» ni indicador «Clínica operativa» en la barra superior (se retiraron a petición); las tareas siguen en «Nueva cita» y en la ficha del paciente.
    var logoCopy=document.querySelector('.sb-logo span');if(logoCopy)logoCopy.textContent='Gestión clínica';
  }
  function patientBar(){
    var screen=document.getElementById('p-paciente-detalle'),heading=screen&&screen.querySelector('.clinic-patient-heading');
    if(!heading||screen.querySelector('.pro-patient-workbar')||!window.pacienteActual)return;
    var bar=n('nav','pro-patient-workbar');bar.setAttribute('aria-label','Acciones del paciente');
    // Solo las dos acciones del día a día: cobrar se hace desde el saldo del Resumen y cotizar desde Tratamiento (los módulos de destino validan el permiso de cada rol).
    [['Agendar cita','calendar',function(){openTask('appointment',pacienteActual.id);}],['Nueva evolución','note',function(){if(window.SmylPatient360)window.SmylPatient360.newNote();}]].forEach(function(item){var b=n('button','',item[0]);b.type='button';b.dataset.action=item[1];b.onclick=item[2];bar.append(b);});
    heading.after(bar);
  }
  function treatmentJourney(){
    var page=document.getElementById('p-propuestas'),heading=page&&page.querySelector('.proposal-heading');
    if(!heading||page.querySelector('.pro-treatment-journey'))return;
    var flow=n('section','pro-treatment-journey');flow.innerHTML='<div><span>RECORRIDO DEL TRATAMIENTO</span><strong>Un caso, de la valoración al cierre</strong></div><ol><li>Valoración</li><li>Plan</li><li>Cotización</li><li>Aceptación</li><li>Atención</li><li>Cierre</li></ol>';
    heading.after(flow);
  }
  function enhance(){patientBar();treatmentJourney();topbar(activeRoute());}
  function init(){
    document.body.classList.add('smyl-management-v3');buildTaskDialog();setupTopbar();window.SmylCareTasks=Object.freeze({open:openTask});
    var previous=window.ir;window.ir=function(name){var result=previous(name);topbar(name);setTimeout(enhance,0);return result;};
    new MutationObserver(enhance).observe(document.querySelector('.contenido')||document.body,{childList:true,subtree:true});
    enhance();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
