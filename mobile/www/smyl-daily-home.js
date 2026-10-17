/* SMYL · Etapa 4: tablero diario de la clínica. */
(function () {
  'use strict';

  var state = { loading:false, loaded:false, tenant:null, appointments:[], requests:[], patients:[], services:[], messages:null, error:'' };

  function el(tag, cls, text) { var node=document.createElement(tag); if(cls)node.className=cls; if(text!=null)node.textContent=text; return node; }
  function esc(value) { return String(value==null?'':value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function startDay(value) { var d=new Date(value); d.setHours(0,0,0,0); return d; }
  function iso(value) { return new Date(value).toISOString(); }
  function fmtTime(value) { return new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
  function fmtDate(value) { return new Intl.DateTimeFormat('es-MX',{weekday:'long',day:'numeric',month:'long'}).format(value); }
  function capitalize(value) { value=String(value||''); return value.charAt(0).toUpperCase()+value.slice(1); }
  function byId(rows,id) { return rows.find(function(row){return row.id===id;}); }
  function patientName(id) { var p=byId(state.patients,id); return p?[p.nombre,p.apellido].filter(Boolean).join(' '):'Paciente'; }
  function serviceName(id) { var s=byId(state.services,id); return s&&s.name?s.name:'Cita dental'; }
  function activeAppointments() { return state.appointments.filter(function(row){return row.status!=='cancelled';}); }
  function query(builder) { return Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(builder):builder).then(function(result){if(result&&result.error)throw result.error;return result&&result.data||[];}); }
  function route(name) { if(typeof window.ir==='function')window.ir(name); }

  function greeting() {
    var hour=new Date().getHours();
    return hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches';
  }

  function build() {
    var home=document.getElementById('p-dashboard');
    if(!home||document.getElementById('smyl-daily-home'))return;
    home.classList.add('has-daily-home');
    var section=el('section','daily-home'); section.id='smyl-daily-home';
    section.innerHTML='<header class="daily-home-hero"><div class="daily-home-hero-copy"><span class="daily-home-eyebrow">Hoy · <b data-home-date></b></span><h1><span data-home-greeting></span>. Todo lo importante de tu clínica, en orden.</h1><p>Revisa lo que necesita atención y continúa con la siguiente tarea sin perder contexto.</p></div><div class="daily-home-actions"><button type="button" class="btn btn-primary" data-home-task="appointment">Agendar cita</button><button type="button" class="btn btn-secondary" data-home-task="quote">Cotizar</button><button type="button" class="btn btn-secondary" data-home-task="payment">Cobrar</button><button type="button" class="daily-home-patient-link" data-home-patient>Registrar paciente</button><small data-home-updated aria-live="polite">Preparando la jornada…</small></div></header><div class="daily-home-metrics" data-home-metrics aria-live="polite"></div><div class="daily-home-grid"><section class="daily-home-card daily-home-priorities"><header><div><span>Prioridades</span><h2>Qué requiere atención</h2></div><button type="button" data-home-open-agenda>Ver agenda</button></header><div data-home-priorities></div></section><aside class="daily-home-card daily-home-next"><header><div><span>Agenda</span><h2>Siguiente en el día</h2></div></header><div data-home-next></div></aside></div><nav class="daily-home-shortcuts" aria-label="Continuar la jornada"><button type="button" data-route="agenda"><span>Agenda</span><strong>Organizar citas y llegadas</strong><small aria-hidden="true">→</small></button><button type="button" data-route="inbox"><span>Mensajes</span><strong>Atender conversaciones</strong><small aria-hidden="true">→</small></button><button type="button" data-route="pacientes"><span>Pacientes</span><strong>Continuar expedientes</strong><small aria-hidden="true">→</small></button><button type="button" data-route="notificaciones"><span>Alertas</span><strong>Revisar pendientes</strong><small aria-hidden="true">→</small></button></nav>';
    section.querySelector('[data-home-date]').textContent=capitalize(fmtDate(new Date()));
    section.querySelector('[data-home-greeting]').textContent=greeting();
    section.querySelector('[data-home-open-agenda]').onclick=function(){route('agenda');};
    section.querySelectorAll('[data-home-task]').forEach(function(button){button.onclick=function(){if(window.SmylCareTasks)return window.SmylCareTasks.open(button.dataset.homeTask);route(button.dataset.homeTask==='appointment'?'agenda':button.dataset.homeTask==='quote'?'propuestas':'caja');};});
    section.querySelector('[data-home-patient]').onclick=function(){route('pacientes');setTimeout(function(){if(typeof window.abrirModalPaciente==='function')window.abrirModalPaciente();},0);};
    section.querySelectorAll('[data-route]').forEach(function(button){button.onclick=function(){route(button.dataset.route);};});
    home.prepend(section);
    renderLoading();
  }

  function metric(value,label,detail,routeName,tone) {
    return '<button type="button" class="daily-home-metric" data-route="'+routeName+'" data-tone="'+(tone||'neutral')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></button>';
  }

  function renderLoading() {
    var metrics=document.querySelector('[data-home-metrics]'), priorities=document.querySelector('[data-home-priorities]'), next=document.querySelector('[data-home-next]');
    if(metrics)metrics.innerHTML='<div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div>';
    if(priorities)priorities.innerHTML='<div class="daily-home-loading"><i></i><i></i><i></i></div>';
    if(next)next.innerHTML='<div class="daily-home-loading compact"><i></i><i></i><i></i></div>';
  }

  function priorityRows() {
    var now=Date.now(), tasks=[];
    activeAppointments().forEach(function(a){
      var time=new Date(a.starts_at).getTime();
      if(a.status==='in_progress')tasks.push({rank:1,label:'EN ATENCIÓN',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · '+serviceName(a.service_id),action:'Abrir agenda'});
      else if(a.status==='arrived')tasks.push({rank:2,label:'PACIENTE EN CLÍNICA',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · recepción registrada',action:'Abrir agenda'});
      else if(a.status==='confirmed'&&time<now)tasks.push({rank:3,label:'ESTADO POR ACTUALIZAR',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · la hora ya pasó',action:'Revisar cita'});
      else if(a.status==='no_show')tasks.push({rank:6,label:'SEGUIMIENTO',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · no asistió',action:'Dar seguimiento'});
    });
    state.requests.filter(function(r){return r.status==='pending';}).forEach(function(r){tasks.push({rank:4,label:'SOLICITUD DE CITA',name:patientName(r.patient_id),detail:r.requested_start?'Prefiere '+fmtTime(r.requested_start):'Horario por acordar',action:'Revisar solicitud'});});
    return tasks.sort(function(a,b){return a.rank-b.rank;});
  }

  function renderMetrics() {
    var rows=activeAppointments(), clinic=rows.filter(function(a){return a.status==='arrived'||a.status==='in_progress';}).length, pending=state.requests.filter(function(r){return r.status==='pending';}).length;
    var messageValue=state.messages&&state.messages.loaded?state.messages.total:'—';
    var host=document.querySelector('[data-home-metrics]'); if(!host)return;
    host.innerHTML=metric(rows.length,'Citas hoy',rows.filter(function(a){return a.status==='confirmed';}).length+' por recibir','agenda')+metric(clinic,'En clínica',clinic?'requieren seguimiento':'recepción al día','agenda',clinic?'active':'neutral')+metric(pending,'Solicitudes',pending?'por revisar':'sin pendientes','agenda',pending?'attention':'neutral')+metric(messageValue,'Mensajes',state.messages&&state.messages.loaded?(state.messages.unread+' sin leer'):'actualizando bandeja','inbox',state.messages&&state.messages.total?'attention':'neutral');
    host.querySelectorAll('[data-route]').forEach(function(button){button.onclick=function(){route(button.dataset.route);};});
  }

  function renderPriorities() {
    var host=document.querySelector('[data-home-priorities]'); if(!host)return;
    var tasks=priorityRows();
    if(!tasks.length){host.innerHTML='<div class="daily-home-empty"><span>✓</span><div><strong>La operación está al día</strong><p>No hay citas ni solicitudes que requieran acción inmediata.</p></div></div>';return;}
    host.innerHTML='<div class="daily-home-priority-list">'+tasks.slice(0,5).map(function(task){return '<article><i></i><div><span>'+esc(task.label)+'</span><strong>'+esc(task.name)+'</strong><small>'+esc(task.detail)+'</small></div><button type="button">'+esc(task.action)+'</button></article>';}).join('')+'</div>';
    host.querySelectorAll('button').forEach(function(button){button.onclick=function(){route('agenda');};});
  }

  function renderNext() {
    var host=document.querySelector('[data-home-next]'); if(!host)return;
    var now=Date.now(), rows=activeAppointments().filter(function(a){return new Date(a.starts_at).getTime()>=now&&a.status!=='completed'&&a.status!=='no_show';}).sort(function(a,b){return new Date(a.starts_at)-new Date(b.starts_at);});
    if(!rows.length){host.innerHTML='<div class="daily-home-next-empty"><strong>Sin más citas por hoy</strong><p>Puedes revisar solicitudes o preparar la jornada siguiente.</p><button type="button">Abrir agenda</button></div>';host.querySelector('button').onclick=function(){route('agenda');};return;}
    host.innerHTML='<div class="daily-home-next-list">'+rows.slice(0,4).map(function(a,index){return '<button type="button"><time>'+esc(fmtTime(a.starts_at))+'</time><span><strong>'+esc(patientName(a.patient_id))+'</strong><small>'+esc(serviceName(a.service_id))+'</small></span>'+(index===0?'<i>PRÓXIMA</i>':'')+'</button>';}).join('')+'</div>';
    host.querySelectorAll('button').forEach(function(button){button.onclick=function(){route('agenda');};});
  }

  function renderError() {
    var priorities=document.querySelector('[data-home-priorities]'), next=document.querySelector('[data-home-next]'), updated=document.querySelector('[data-home-updated]');
    if(priorities)priorities.innerHTML='<div class="daily-home-error"><strong>No pudimos actualizar la jornada</strong><p>'+esc(state.error||'Revisa tu conexión e intenta nuevamente.')+'</p><button type="button">Intentar de nuevo</button></div>';
    if(priorities&&priorities.querySelector('button'))priorities.querySelector('button').onclick=function(){load(true);};
    if(next)next.innerHTML='<div class="daily-home-next-empty"><strong>Agenda no disponible</strong><p>Los módulos siguen disponibles desde los accesos inferiores.</p></div>';
    if(updated)updated.textContent='Actualización pendiente';
    renderMetrics();
  }

  function render() {
    if(state.error){renderError();return;}
    renderMetrics(); renderPriorities(); renderNext();
    var updated=document.querySelector('[data-home-updated]'); if(updated)updated.textContent='Actualizado '+new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(new Date());
  }

  async function load(force) {
    if(!window.tenantId||!window.sb||state.loading||(state.loaded&&state.tenant===window.tenantId&&!force))return;
    state.loading=true; state.error=''; state.tenant=window.tenantId; renderLoading();
    var start=startDay(new Date()), end=new Date(start); end.setDate(end.getDate()+1);
    try {
      var rows=await Promise.all([
        query(window.sb.from('smyl_appointments').select('id,patient_id,service_id,starts_at,ends_at,status').eq('tenant_id',state.tenant).gte('starts_at',iso(start)).lt('starts_at',iso(end)).order('starts_at')),
        query(window.sb.from('smyl_appointment_requests').select('id,patient_id,requested_start,status').eq('tenant_id',state.tenant).eq('status','pending').order('created_at')),
        query(window.sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id',state.tenant).order('nombre')),
        query(window.sb.from('smyl_services').select('id,name').eq('tenant_id',state.tenant).eq('active',true).order('name'))
      ]);
      state.appointments=rows[0]||[]; state.requests=rows[1]||[]; state.patients=rows[2]||[]; state.services=rows[3]||[]; state.loaded=true;
      if(window.SmylLanaAttention&&typeof window.SmylLanaAttention.getSummary==='function')state.messages=window.SmylLanaAttention.getSummary();
      render();
    } catch(error) { state.error=(error&&error.message)||'Revisa tu conexión e intenta nuevamente.'; renderError(); }
    finally { state.loading=false; }
  }

  function init() {
    build();
    window.addEventListener('smyl:attention-updated',function(event){state.messages=event.detail||null;if(state.loaded)renderMetrics();});
    var previous=window.ir;
    window.ir=function(routeName){var result=previous(routeName);if(routeName==='dashboard')load(true);return result;};
    var originalDashboard=window.cargarDashboard;
    if(typeof originalDashboard==='function')window.cargarDashboard=async function(){var result=await originalDashboard.apply(this,arguments);await load(false);return result;};
    if(window.tenantId)load(false);
  }

  window.SmylDailyHome=Object.freeze({reload:function(){state.loaded=false;return load(true);}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
