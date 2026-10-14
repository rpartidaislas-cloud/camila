/* SMYL · Etapa 5: centro único de alertas y novedades. */
(function () {
  'use strict';

  var state={loading:false,loaded:false,tenant:null,tab:'pending',appointments:[],requests:[],reminders:[],inventory:[],messages:null,inboxOperations:null,security:null,announcements:[],error:''};
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function startDay(value){var d=new Date(value);d.setHours(0,0,0,0);return d;}
  function query(builder){return Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(builder):builder).then(function(result){if(result&&result.error)throw result.error;return result&&result.data||[];});}
  function readIds(){try{var value=JSON.parse(localStorage.getItem('camila_notis_leidas_'+window.tenantId)||'[]');return Array.isArray(value)?value:[];}catch(_){return[];}}
  function route(name){if(typeof window.ir==='function')window.ir(name);}

  function build(){
    var page=document.getElementById('p-notificaciones');if(!page||document.getElementById('smyl-task-center'))return;
    page.classList.add('has-task-center');
    var shell=el('section','task-center');shell.id='smyl-task-center';
    shell.innerHTML='<header class="task-center-head"><div><span>CENTRO DE ALERTAS</span><h1>Lo pendiente, sin ruido.</h1><p>Cada alerta conserva su módulo de origen. Atiéndela en Agenda, Mensajes o Inventario para que desaparezca de forma verificable.</p></div><button type="button" class="btn btn-secondary" data-task-refresh>Actualizar</button></header><section class="task-center-summary" data-task-summary aria-live="polite"></section><div class="task-center-tabs" role="tablist"><button type="button" role="tab" data-task-tab="pending" aria-selected="true">Pendientes <span data-task-pending-count></span></button><button type="button" role="tab" data-task-tab="news" aria-selected="false">Novedades <span data-task-news-count></span></button></div><section class="task-center-panel" data-task-panel="pending"><div class="task-center-section-head"><div><h2>Acciones que necesitan seguimiento</h2><p>No se marcan como atendidas desde aquí: se resuelven en el módulo responsable.</p></div></div><div data-task-list></div></section><section class="task-center-panel" data-task-panel="news" hidden><div class="task-center-section-head"><div><h2>Novedades de SMYL</h2><p>Actualizaciones informativas separadas de la operación clínica.</p></div><button type="button" data-task-read-all>Marcar como leídas</button></div><div data-task-news></div></section>';
    page.prepend(shell);
    shell.querySelector('[data-task-refresh]').onclick=function(){load(true);};
    shell.querySelector('[data-task-read-all]').onclick=markAnnouncementsRead;
    shell.querySelectorAll('[data-task-tab]').forEach(function(button){button.onclick=function(){state.tab=button.dataset.taskTab;renderTabs();};});
  }

  function tasks(){
    var now=Date.now(), list=[], active=state.appointments.filter(function(a){return a.status!=='cancelled';});
    var clinic=active.filter(function(a){return a.status==='arrived'||a.status==='in_progress';}).length;
    var overdue=active.filter(function(a){return a.status==='confirmed'&&new Date(a.starts_at).getTime()<now;}).length;
    var noShow=active.filter(function(a){return a.status==='no_show';}).length;
    var pending=state.requests.filter(function(r){return r.status==='pending';}).length;
    var reminderFailures=state.reminders.filter(function(r){return r.status==='failed'||(r.status==='pending'&&new Date(r.scheduled_for).getTime()<now);}).length;
    var low=state.inventory.filter(function(x){return x.below_minimum;}).length;
    var expiry=state.inventory.filter(function(x){return x.days_to_expiry!=null&&Number(x.days_to_expiry)<=30&&Number(x.on_hand)>0;}).length;
    if(clinic)list.push({rank:1,source:'Agenda',title:clinic+(clinic===1?' paciente está':' pacientes están')+' en clínica',detail:'Llegada o atención activa que requiere continuidad del equipo.',owner:'Equipo clínico',route:'agenda',action:'Abrir agenda'});
    if(overdue)list.push({rank:1,source:'Agenda',title:overdue+(overdue===1?' cita necesita':' citas necesitan')+' actualizar su estado',detail:'El horario ya pasó y la cita continúa confirmada.',owner:'Recepción',route:'agenda',action:'Revisar citas'});
    if(state.messages&&state.messages.loaded&&state.messages.total)list.push({rank:2,source:'Mensajes',title:state.messages.total+(state.messages.total===1?' conversación necesita':' conversaciones necesitan')+' atención',detail:state.messages.unread+' mensajes sin leer en la bandeja omnicanal.',owner:'Atención al paciente',route:'inbox',action:'Abrir mensajes'});
    if(state.inboxOperations&&state.inboxOperations.loaded){
      var inboxAlerts=state.inboxOperations.alerts||[],critical=inboxAlerts.filter(function(item){return item.severity==='critical';}),warnings=inboxAlerts.filter(function(item){return item.severity!=='critical';});
      if(critical.length)list.push({rank:1,source:'Mensajes',title:critical.length+(critical.length===1?' bloqueo operativo':' bloqueos operativos')+' en el Inbox',detail:critical[0].message+(critical.length>1?' · '+(critical.length-1)+' adicionales.':''),owner:'Administración',route:'inbox',open:'operations',action:'Revisar operación'});
      if(warnings.length)list.push({rank:2,source:'Mensajes',title:warnings.length+(warnings.length===1?' señal operativa requiere':' señales operativas requieren')+' revisión',detail:warnings[0].message+(warnings.length>1?' · '+(warnings.length-1)+' adicionales.':''),owner:'Administración',route:'inbox',open:'operations',action:'Ver diagnóstico'});
    }
    if(state.security&&state.security.open){list.push({rank:state.security.high?1:2,source:'Seguridad',title:state.security.open+(state.security.open===1?' señal requiere':' señales requieren')+' revisión',detail:state.security.high?state.security.high+' de prioridad alta. Revisa y documenta la respuesta.':'Revisa la evidencia disponible y documenta la conclusión.',owner:'Administración',route:'seguridad',action:'Abrir seguridad'});}
    if(pending)list.push({rank:2,source:'Agenda',title:pending+(pending===1?' solicitud de cita pendiente':' solicitudes de cita pendientes'),detail:'El asistente recopiló la preferencia; una persona debe confirmar.',owner:'Recepción',route:'agenda',action:'Revisar solicitudes'});
    if(reminderFailures)list.push({rank:2,source:'Agenda',title:reminderFailures+(reminderFailures===1?' recordatorio requiere':' recordatorios requieren')+' revisión',detail:'Falló el envío o venció el horario previsto.',owner:'Recepción',route:'agenda',action:'Revisar recordatorios'});
    if(noShow)list.push({rank:3,source:'Agenda',title:noShow+(noShow===1?' inasistencia requiere':' inasistencias requieren')+' seguimiento',detail:'Continúa el contacto desde la cita o desde Mensajes.',owner:'Atención al paciente',route:'agenda',action:'Dar seguimiento'});
    if(low)list.push({rank:3,source:'Inventario',title:low+(low===1?' insumo está':' insumos están')+' bajo mínimo',detail:'Revisa existencias y prepara la reposición correspondiente.',owner:'Administración',route:'inventario',action:'Abrir inventario'});
    if(expiry)list.push({rank:3,source:'Inventario',title:expiry+(expiry===1?' lote caduca':' lotes caducan')+' en 30 días o menos',detail:'Verifica consumo, lote y fecha antes de usar o reponer.',owner:'Administración',route:'inventario',action:'Revisar lotes'});
    return list.sort(function(a,b){return a.rank-b.rank;});
  }

  function renderSummary(items){
    var urgent=items.filter(function(item){return item.rank===1;}).length, clinical=items.filter(function(item){return item.owner==='Equipo clínico';}).length, reception=items.filter(function(item){return item.owner==='Recepción'||item.owner==='Atención al paciente';}).length, admin=items.filter(function(item){return item.owner==='Administración';}).length;
    var host=document.querySelector('[data-task-summary]');if(!host)return;
    host.innerHTML=[['Total',items.length,'pendientes activos'],['Prioridad alta',urgent,urgent?'atender ahora':'sin urgencias'],['Recepción',reception,'acciones'],['Clínica y administración',clinical+admin,'acciones']].map(function(x,index){return '<article data-tone="'+(index===1&&urgent?'urgent':'neutral')+'"><span>'+esc(x[0])+'</span><strong>'+x[1]+'</strong><small>'+esc(x[2])+'</small></article>';}).join('');
  }

  function renderPending(items){
    var host=document.querySelector('[data-task-list]');if(!host)return;
    if(state.error&&!state.loaded){host.innerHTML='<div class="task-center-state is-error"><strong>No pudimos reunir los pendientes</strong><p>'+esc(state.error)+'</p><button type="button">Intentar de nuevo</button></div>';host.querySelector('button').onclick=function(){load(true);};return;}
    if(!items.length){host.innerHTML='<div class="task-center-state"><span>✓</span><strong>No hay pendientes operativos</strong><p>Agenda, Mensajes e Inventario están al día con la información disponible para tu rol.</p></div>';return;}
    host.innerHTML='<div class="task-center-list">'+items.map(function(item){return '<article data-priority="'+item.rank+'"><i></i><div class="task-center-copy"><div><span>'+esc(item.source)+'</span><em>Responsable: '+esc(item.owner)+'</em></div><strong>'+esc(item.title)+'</strong><p>'+esc(item.detail)+'</p></div><button type="button" data-route="'+esc(item.route)+'"'+(item.open?' data-open="'+esc(item.open)+'"':'')+'>'+esc(item.action)+'</button></article>';}).join('')+'</div>';
    host.querySelectorAll('[data-route]').forEach(function(button){button.onclick=function(){route(button.dataset.route);if(button.dataset.open==='operations'&&window.SmylInbox)setTimeout(window.SmylInbox.openOperations,0);};});
  }

  function renderAnnouncements(){
    var host=document.querySelector('[data-task-news]');if(!host)return;var read=readIds();
    if(!state.announcements.length){host.innerHTML='<div class="task-center-state"><span>✓</span><strong>Sin novedades nuevas</strong><p>Las actualizaciones informativas de SMYL aparecerán aquí.</p></div>';return;}
    host.innerHTML='<div class="task-center-news-list">'+state.announcements.map(function(n){var isRead=read.indexOf(n.id)!==-1,date=n.created_at?new Date(n.created_at).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'}):'';return '<article data-read="'+isRead+'"><i></i><div><span>'+esc(n.tipo||'Información')+' · '+esc(date)+'</span><strong>'+esc(n.titulo||'Novedad de SMYL')+'</strong><p>'+esc(n.cuerpo||'')+'</p></div></article>';}).join('')+'</div>';
  }

  function unreadAnnouncements(){var read=readIds();return state.announcements.filter(function(n){return read.indexOf(n.id)===-1;}).length;}
  function syncBadge(count,unread){
    var total=count+unread,dot=document.getElementById('noti-dot'),bell=document.querySelector('.btn-noti');
    if(dot)dot.style.display=total?'block':'none';if(bell)bell.setAttribute('aria-label',total?total+' alertas y novedades pendientes':'Centro de alertas sin pendientes');
    document.querySelectorAll('[data-route="notificaciones"]').forEach(function(button){var badge=button.querySelector('.pro-nav-count');if(!badge){badge=el('span','pro-nav-count');button.append(badge);}badge.textContent=total>99?'99+':String(total);badge.hidden=!total;});
  }

  function renderTabs(){
    document.querySelectorAll('[data-task-tab]').forEach(function(button){var selected=button.dataset.taskTab===state.tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
    document.querySelectorAll('[data-task-panel]').forEach(function(panel){panel.hidden=panel.dataset.taskPanel!==state.tab;});
  }

  function render(){
    var items=tasks(),unread=unreadAnnouncements();renderSummary(items);renderPending(items);renderAnnouncements();renderTabs();syncBadge(items.length,unread);
    var pc=document.querySelector('[data-task-pending-count]'),nc=document.querySelector('[data-task-news-count]');if(pc)pc.textContent=items.length||'';if(nc)nc.textContent=unread||'';
    var refresh=document.querySelector('[data-task-refresh]');if(refresh){refresh.disabled=state.loading;refresh.textContent=state.loading?'Actualizando…':'Actualizar';}
    window.dispatchEvent(new CustomEvent('smyl:task-center-updated',{detail:{pending:items.length,unread_news:unread}}));
  }

  async function load(force){
    if(!window.tenantId||!window.sb||state.loading||(state.loaded&&state.tenant===window.tenantId&&!force))return;
    state.loading=true;state.error='';state.tenant=window.tenantId;render();var start=startDay(new Date()),end=new Date(start);end.setDate(end.getDate()+1);
    var results=await Promise.allSettled([
      query(window.sb.from('smyl_appointments').select('id,starts_at,status').eq('tenant_id',state.tenant).gte('starts_at',start.toISOString()).lt('starts_at',end.toISOString()).order('starts_at')),
      query(window.sb.from('smyl_appointment_requests').select('id,status').eq('tenant_id',state.tenant).eq('status','pending').order('created_at')),
      query(window.sb.from('smyl_appointment_reminders').select('id,scheduled_for,status').eq('tenant_id',state.tenant).in('status',['pending','failed']).lte('scheduled_for',end.toISOString()).order('scheduled_for',{ascending:false}).limit(50)),
      query(window.sb.rpc('smyl_inventory_snapshot',{p_location_id:null})),
      query(window.sb.from('camila_notificaciones').select('id,titulo,cuerpo,tipo,created_at').order('created_at',{ascending:false}).limit(50))
    ]);
    state.appointments=results[0].status==='fulfilled'?results[0].value:[];state.requests=results[1].status==='fulfilled'?results[1].value:[];state.reminders=results[2].status==='fulfilled'?results[2].value:[];state.inventory=results[3].status==='fulfilled'?results[3].value:[];state.announcements=results[4].status==='fulfilled'?results[4].value:[];
    var coreFailed=results.slice(0,3).every(function(result){return result.status==='rejected';});if(coreFailed)state.error='Agenda no respondió. Puedes abrir cada módulo directamente o intentar nuevamente.';
    if(window.SmylLanaAttention&&typeof window.SmylLanaAttention.getSummary==='function')state.messages=window.SmylLanaAttention.getSummary();
    if(window.SmylInbox&&typeof window.SmylInbox.getOperationsSummary==='function'){
      state.inboxOperations=window.SmylInbox.getOperationsSummary();
      window.SmylInbox.loadOperations(Boolean(force));
    }
    state.loaded=true;state.loading=false;render();
    if(window.SmylLanaAttention&&state.messages&&!state.messages.loaded)window.SmylLanaAttention.load(true);
  }

  function markAnnouncementsRead(){
    try{var read=readIds();state.announcements.forEach(function(n){if(read.indexOf(n.id)===-1)read.push(n.id);});localStorage.setItem('camila_notis_leidas_'+window.tenantId,JSON.stringify(read));}catch(_){}
    render();
  }

  function init(){
    build();window.cargarNotificaciones=load;window.marcarTodasLeidas=markAnnouncementsRead;
    window.addEventListener('smyl:attention-updated',function(event){state.messages=event.detail||null;if(state.loaded)render();});
    window.addEventListener('smyl:inbox-operations-updated',function(event){state.inboxOperations=event.detail||null;if(state.loaded)render();});
    window.addEventListener('smyl:security-updated',function(event){state.security=event.detail||null;if(state.loaded)render();});
    var previous=window.ir;window.ir=function(name){var result=previous(name);if(name==='notificaciones')load(true);return result;};
    if(window.tenantId)load(false);
    setTimeout(function(){if(window.SmylInbox&&typeof window.SmylInbox.loadOperations==='function')window.SmylInbox.loadOperations(false);},0);
    setTimeout(function(){if(window.SmylSecurity&&typeof window.SmylSecurity.loadSummary==='function')window.SmylSecurity.loadSummary();},0);
  }

  window.SmylTaskCenter=Object.freeze({reload:function(){state.loaded=false;return load(true);}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
