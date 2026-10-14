/* SMYL · Professional management shell v3. Presentation only; business rules stay in their modules. */
(function(){
  'use strict';
  var ROUTES={
    dashboard:['Inicio','Resumen operativo de la clínica'],agenda:['Agenda','Citas, llegadas y disponibilidad'],pacientes:['Pacientes','Directorio y expedientes clínicos'],
    'paciente-detalle':['Expediente','Atención clínica del paciente'],propuestas:['Tratamientos','Planes, cotizaciones y seguimiento'],caja:['Finanzas','Cargos, cobros y facturación'],
    inbox:['Mensajes','Conversaciones que requieren atención'],precios:['Servicios y tarifas','Catálogo clínico, precios y claves fiscales'],inventario:['Inventario','Existencias, compras y trazabilidad'],
    reportes:['Reportes','Indicadores operativos del negocio'],clinica:['Mi clínica','Sucursales, equipo y permisos'],conexiones:['Canales y asistente','Conexiones y automatización supervisada']
  };
  function n(tag,cls,text){var el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;}
  function route(name){if(typeof window.ir==='function')window.ir(name);}
  function activeRoute(){var page=document.querySelector('.pantalla.activa');return page&&page.id?page.id.replace(/^p-/,''):'dashboard';}
  function openAppointment(patient){
    if(patient&&window.SmylSchedule&&window.SmylSchedule.forPatient)return window.SmylSchedule.forPatient(patient);
    route('agenda');var tries=0;(function ready(){var button=document.getElementById('schedule-new');if(button)return button.click();if(tries++<80)setTimeout(ready,50);})();
  }
  function topbar(name){
    var meta=ROUTES[name]||[window.TITULOS&&TITULOS[name]||name,''],title=document.getElementById('topbar-title'),sub=document.getElementById('topbar-sub');
    if(title)title.textContent=meta[0];if(sub)sub.textContent=meta[1];
    var action=document.querySelector('.topbar-right .pro-global-action');
    if(action){action.textContent=name==='paciente-detalle'?'Agendar cita':'Nueva cita';action.onclick=function(){openAppointment(name==='paciente-detalle'&&window.pacienteActual&&pacienteActual.id);};}
  }
  function setupTopbar(){
    if(window.TITULOS)Object.keys(ROUTES).forEach(function(key){TITULOS[key]=ROUTES[key][0];});
    var right=document.querySelector('.topbar-right');if(!right)return;
    var old=right.querySelector('.btn-primary');if(old)old.remove();
    var action=n('button','btn btn-primary pro-global-action','Nueva cita');action.type='button';right.append(action);
    var clinic=n('span','pro-clinic-status','Clínica operativa');clinic.setAttribute('aria-label','Espacio de trabajo de la clínica');right.insertBefore(clinic,action);
    var logoCopy=document.querySelector('.sb-logo span');if(logoCopy)logoCopy.textContent='Gestión clínica';
  }
  function patientBar(){
    var screen=document.getElementById('p-paciente-detalle'),heading=screen&&screen.querySelector('.clinic-patient-heading');
    if(!heading||screen.querySelector('.pro-patient-workbar')||!window.pacienteActual)return;
    var bar=n('nav','pro-patient-workbar');bar.setAttribute('aria-label','Acciones del paciente');
    [['Agendar cita','calendar',function(){openAppointment(pacienteActual.id);}],['Tratamiento','treatment',function(){var target=document.getElementById('p360-plan')||document.querySelector('.clinic-workspace');if(target)target.scrollIntoView({behavior:'smooth',block:'start'});}],['Evolución','note',function(){if(window.SmylPatient360)window.SmylPatient360.open('notes');}],['Cobrar','cash',function(){route('caja');}],['Mensaje','message',function(){route('inbox');}]].forEach(function(item){var b=n('button','',item[0]);b.type='button';b.dataset.action=item[1];b.onclick=item[2];bar.append(b);});
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
    document.body.classList.add('smyl-management-v3');setupTopbar();
    var previous=window.ir;window.ir=function(name){var result=previous(name);topbar(name);setTimeout(enhance,0);return result;};
    new MutationObserver(enhance).observe(document.querySelector('.contenido')||document.body,{childList:true,subtree:true});
    enhance();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
