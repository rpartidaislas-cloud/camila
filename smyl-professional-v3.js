/* SMYL · Professional management shell v3. Presentation only; business rules stay in their modules. */
(function(){
  'use strict';
  var ROUTES={
    dashboard:['Inicio','Resumen operativo de la clínica'],agenda:['Agenda','Citas, llegadas y disponibilidad'],pacientes:['Pacientes','Directorio y expedientes clínicos'],
    'paciente-detalle':['Expediente','Atención clínica del paciente'],propuestas:['Tratamientos','Planes, cotizaciones y seguimiento'],caja:['Finanzas','Cargos, cobros y facturación'],
    inbox:['Mensajes','Conversaciones que requieren atención'],precios:['Servicios y tarifas','Catálogo clínico, precios y claves fiscales'],inventario:['Inventario','Existencias, compras y trazabilidad'],
    reportes:['Reportes','Indicadores operativos del negocio'],configuracion:['Configuración','Todo lo que puedes ajustar en tu clínica'],clinica:['Mi clínica','Sucursales, equipo y permisos'],conexiones:['Canales y asistente','Conexiones y automatización supervisada']
  };
  var taskDialog,taskType='',taskPatients=[],taskSequence=0;
  function n(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;}
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
  function renderPatients(term){
    var host=taskDialog.querySelector('[data-task-patients]'),query=String(term||'').trim().toLocaleLowerCase('es-MX'),rows=taskPatients.filter(function(patient){return !query||patientName(patient).toLocaleLowerCase('es-MX').includes(query);});
    host.innerHTML=rows.length?rows.slice(0,60).map(function(patient){var name=patientName(patient),initials=name.split(/\s+/).slice(0,2).map(function(part){return part.charAt(0);}).join('').toUpperCase();return '<button type="button" data-task-patient="'+esc(patient.id)+'"><i>'+esc(initials)+'</i><span><strong>'+esc(name)+'</strong><small>Continuar con este paciente</small></span><b aria-hidden="true">→</b></button>';}).join(''):'<div class="pro-task-empty"><strong>No encontramos pacientes</strong><p>Revisa la búsqueda o registra uno nuevo.</p></div>';
    host.querySelectorAll('[data-task-patient]').forEach(function(button){button.onclick=function(){runTask(taskType,button.dataset.taskPatient);};});
  }
  async function patientPicker(type){
    taskType=type;var token=++taskSequence,labels={appointment:['Agendar cita','Selecciona al paciente para precargar su cita.'],quote:['Preparar cotización','Selecciona al paciente. Su plan clínico debe estar revisado.'],payment:['Registrar cobro','Selecciona al paciente para consultar y aplicar sus saldos.']},copy=labels[type];
    taskDialog.querySelector('[data-task-body]').innerHTML='<div class="pro-task-step"><button type="button" data-task-back>← Volver</button><span>PASO 2 DE 2</span><h2 id="pro-task-title">'+esc(copy[0])+'</h2><p>'+esc(copy[1])+'</p></div><label class="pro-task-search"><span class="sr-only">Buscar paciente</span><input type="search" data-task-search placeholder="Buscar por nombre…" autocomplete="off"></label><div class="pro-task-patients" data-task-patients aria-live="polite"><div class="pro-task-loading">Cargando pacientes…</div></div><button type="button" class="pro-task-new-patient" data-task-new>Registrar paciente nuevo</button>';
    taskDialog.querySelector('[data-task-back]').onclick=taskPicker;taskDialog.querySelector('[data-task-new]').onclick=function(){closeTask();route('pacientes');setTimeout(function(){if(typeof window.abrirModalPaciente==='function')window.abrirModalPaciente();},0);};
    var input=taskDialog.querySelector('[data-task-search]');input.oninput=function(){renderPatients(input.value);};
    try{if(!window.sb||!window.tenantId)throw new Error('La sesión de la clínica no está disponible.');var request=window.sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id',window.tenantId).order('nombre').limit(200),result=await Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(request):request);if(token!==taskSequence||taskType!==type)return;if(result&&result.error)throw result.error;taskPatients=result&&result.data||[];renderPatients('');setTimeout(function(){if(token===taskSequence)input.focus();},0);}catch(error){if(token!==taskSequence||taskType!==type)return;taskDialog.querySelector('[data-task-patients]').innerHTML='<div class="pro-task-empty"><strong>No pudimos cargar los pacientes</strong><p>Conserva tu trabajo y vuelve a intentarlo.</p><button type="button" data-task-retry>Intentar de nuevo</button></div>';taskDialog.querySelector('[data-task-retry]').onclick=function(){patientPicker(type);};}
  }
  function openTask(type,patientId){if(type&&patientId)return runTask(type,patientId);if(!taskDialog)buildTaskDialog();taskPicker();if(typeof taskDialog.showModal==='function')taskDialog.showModal();else taskDialog.setAttribute('open','');if(type)patientPicker(type);}
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
    var action=n('button','btn btn-primary pro-global-action','Nueva tarea');action.type='button';action.setAttribute('aria-label','Agendar, cotizar o cobrar');action.onclick=function(){openTask();};right.append(action);
    var clinic=n('span','pro-clinic-status','Clínica operativa');clinic.setAttribute('aria-label','Espacio de trabajo de la clínica');right.insertBefore(clinic,action);
    var logoCopy=document.querySelector('.sb-logo span');if(logoCopy)logoCopy.textContent='Gestión clínica';
  }
  function patientBar(){
    var screen=document.getElementById('p-paciente-detalle'),heading=screen&&screen.querySelector('.clinic-patient-heading');
    if(!heading||screen.querySelector('.pro-patient-workbar')||!window.pacienteActual)return;
    var bar=n('nav','pro-patient-workbar');bar.setAttribute('aria-label','Acciones del paciente');
    [['Agendar cita','calendar',function(){openTask('appointment',pacienteActual.id);}],['Nueva evolución','note',function(){if(window.SmylPatient360)window.SmylPatient360.newNote();}]].forEach(function(item){var b=n('button','',item[0]);b.type='button';b.dataset.action=item[1];b.onclick=item[2];bar.append(b);});
    var more=n('details','pro-patient-more');more.innerHTML='<summary>Más acciones</summary><div><button type="button" data-more-action="quote">Cotizar</button><button type="button" data-more-action="payment">Cobrar</button><button type="button" data-more-action="message">Enviar mensaje</button></div>';bar.append(more);
    more.querySelector('[data-more-action="quote"]').onclick=function(){more.open=false;openTask('quote',pacienteActual.id);};
    more.querySelector('[data-more-action="payment"]').onclick=function(){more.open=false;openTask('payment',pacienteActual.id);};
    more.querySelector('[data-more-action="message"]').onclick=function(){more.open=false;route('inbox');};
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
