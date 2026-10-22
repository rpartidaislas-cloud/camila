/* SMYL · Etapa 4: tablero diario de la clínica. */
(function () {
  'use strict';

  var state = { loading:false, loaded:false, tenant:null, appointments:[], requests:[], patients:[], services:[], messages:null, error:'', chats:null, chatsError:false, chatsLoading:false, chatsAt:0, tasks:null, month:null, monthLoading:false, monthAt:0 };

  function el(tag, cls, text) { var node=document.createElement(tag); if(cls)node.className=cls; if(text!=null)node.textContent=text; return node; }
  function esc(value) { return String(value==null?'':value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function startDay(value) { var d=new Date(value); d.setHours(0,0,0,0); return d; }
  function iso(value) { return new Date(value).toISOString(); }
  function fmtTime(value) { return new Intl.DateTimeFormat('es-MX',{hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(value)).replace(/\s*([ap])\.?\s?m\.?/i,function(m,x){return ' '+x.toLowerCase()+'m';}); }
  function fmtDate(value) { return new Intl.DateTimeFormat('es-MX',{weekday:'long',day:'numeric',month:'long'}).format(value); }
  function capitalize(value) { value=String(value||''); return value.charAt(0).toUpperCase()+value.slice(1); }
  function byId(rows,id) { return rows.find(function(row){return row.id===id;}); }
  function patientName(id) { var p=byId(state.patients,id); return p?[p.nombre,p.apellido].filter(Boolean).join(' '):'Paciente'; }
  function serviceName(id) { var s=byId(state.services,id); return s&&s.name?s.name:'Cita dental'; }
  function activeAppointments() { return state.appointments.filter(function(row){return row.status!=='cancelled';}); }
  function query(builder) { return Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(builder):builder).then(function(result){if(result&&result.error)throw result.error;return result&&result.data||[];}); }
  var STATUS={confirmed:'Confirmada',arrived:'Ya llegó',in_progress:'En consulta',completed:'Terminada',no_show:'No vino'};
  function ymd(d) { return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function money(v) { return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(Number(v)||0); }
  function flag(key,value) {
    try { var k='smyl_home_'+key+'_'+(window.tenantId||''); if(value===undefined)return window.localStorage.getItem(k); window.localStorage.setItem(k,value); } catch(_) {}
    return null;
  }
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
    section.innerHTML='<header class="daily-home-hero"><div class="daily-home-hero-copy"><span class="daily-home-eyebrow">Hoy · <b data-home-date></b></span><h1><span data-home-greeting></span>.<span data-home-summary></span></h1></div><div class="daily-home-actions" role="group" aria-label="Acciones rápidas"><button type="button" class="btn btn-primary btn-sm" data-home-task="appointment">Agendar cita</button><button type="button" class="btn btn-secondary btn-sm" data-home-task="quote">Cotizar</button><button type="button" class="btn btn-secondary btn-sm" data-home-task="payment">Cobrar</button><button type="button" class="daily-home-patient-link" data-home-patient>Registrar paciente</button><small data-home-updated aria-live="polite">Preparando la jornada…</small></div></header><div class="daily-home-metrics" data-home-metrics aria-live="polite"></div><section class="daily-home-chats" aria-labelledby="daily-home-chats-title"><header><h2 id="daily-home-chats-title">Chats recientes</h2><button type="button" data-home-open-inbox>Ver todos <span aria-hidden="true">→</span></button></header><div class="daily-home-chat-strip" data-home-chats aria-live="polite"></div></section><div class="daily-home-grid"><section class="daily-home-card daily-home-priorities"><header><div><h2>Pendientes de hoy</h2></div><button type="button" data-home-open-agenda>Ver agenda</button></header><div data-home-priorities></div></section><aside class="daily-home-card daily-home-next"><header><div><h2>Citas de hoy</h2></div><button type="button" data-home-open-agenda-2>Abrir</button></header><div data-home-next></div></aside></div><section class="daily-home-month" aria-labelledby="daily-home-month-title"><header><h2 id="daily-home-month-title">Este mes</h2><button type="button" data-home-open-reports>Ver reportes <span aria-hidden="true">→</span></button></header><div class="daily-home-metrics daily-home-metrics-month" data-home-month aria-live="polite"></div></section><nav class="daily-home-shortcuts" aria-label="Continuar la jornada"><button type="button" data-route="agenda"><span>Agenda</span><strong>Organizar citas y llegadas</strong><small aria-hidden="true">→</small></button><button type="button" data-route="inbox"><span>Mensajes</span><strong>Atender conversaciones</strong><small aria-hidden="true">→</small></button><button type="button" data-route="pacientes"><span>Pacientes</span><strong>Continuar expedientes</strong><small aria-hidden="true">→</small></button><button type="button" data-route="notificaciones"><span>Alertas</span><strong>Revisar pendientes</strong><small aria-hidden="true">→</small></button></nav>';
    var monthSection=section.querySelector('.daily-home-month');
    if(flag('month')==='1')section.querySelector('[data-home-month]').innerHTML='<div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div>'; else monthSection.hidden=true;
    section.querySelector('[data-home-date]').textContent=capitalize(fmtDate(new Date()));
    section.querySelector('[data-home-greeting]').textContent=greeting();
    section.querySelector('[data-home-open-agenda]').onclick=function(){route('agenda');};
    section.querySelector('[data-home-open-inbox]').onclick=function(){route('inbox');};
    section.querySelector('[data-home-open-agenda-2]').onclick=function(){route('agenda');};
    section.querySelector('[data-home-open-reports]').onclick=function(){route('reportes');};
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
    renderChats();
  }

  function priorityRows() {
    var now=Date.now(), tasks=[];
    activeAppointments().forEach(function(a){
      var time=new Date(a.starts_at).getTime();
      if(a.status==='in_progress')tasks.push({rank:1,label:'EN CONSULTA',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · '+serviceName(a.service_id),action:'Abrir cita'});
      else if(a.status==='arrived')tasks.push({rank:2,label:'YA LLEGÓ',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · '+serviceName(a.service_id),action:'Abrir cita'});
      else if(a.status==='confirmed'&&time<now)tasks.push({rank:3,label:'¿YA LLEGÓ?',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · ya pasó su hora',action:'Abrir cita'});
      else if(a.status==='no_show')tasks.push({rank:6,label:'NO VINO',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · ofrécele otra cita',action:'Ver cita'});
    });
    state.requests.filter(function(r){return r.status==='pending';}).forEach(function(r){tasks.push({rank:4,label:'PIDIÓ CITA',name:patientName(r.patient_id),detail:r.requested_start?'Prefiere '+fmtTime(r.requested_start):'Horario por acordar',action:'Revisar solicitud'});});
    return tasks.sort(function(a,b){return a.rank-b.rank;});
  }

  function renderMetrics() {
    var rows=activeAppointments(), clinic=rows.filter(function(a){return a.status==='arrived'||a.status==='in_progress';}).length, pending=state.requests.filter(function(r){return r.status==='pending';}).length;
    var messageValue=state.messages&&state.messages.loaded?state.messages.total:'—';
    var host=document.querySelector('[data-home-metrics]'); if(!host)return;
    host.innerHTML=metric(rows.length,'Citas hoy',rows.filter(function(a){return a.status==='confirmed';}).length+' faltan por llegar','agenda')+metric(clinic,'En la clínica',clinic?'ya llegaron o en consulta':'nadie por ahora','agenda',clinic?'active':'neutral')+metric(pending,'Por aprobar',pending?'citas que pidieron':'nada pendiente','agenda',pending?'attention':'neutral')+metric(messageValue,'Mensajes',state.messages&&state.messages.loaded?(state.messages.unread+' sin leer'):'cargando…','inbox',state.messages&&state.messages.total?'attention':'neutral');
    host.querySelectorAll('[data-route]').forEach(function(button){button.onclick=function(){route(button.dataset.route);};});
  }

  function taskItems() {
    if(state.tasks)return state.tasks;
    var center=window.SmylTaskCenter;
    return center&&typeof center.getTasks==='function'?center.getTasks():null;
  }

  function renderPriorities() {
    var host=document.querySelector('[data-home-priorities]'); if(!host)return;
    var shared=taskItems(), tasks;
    // Misma fuente que el contador de Alertas, para que el Inicio y la campana nunca se contradigan.
    if(shared)tasks=shared.map(function(item){return {label:item.source.toUpperCase(),name:item.title,detail:item.detail,action:item.action,route:item.route,open:item.open,urgent:item.rank===1};});
    else tasks=priorityRows().map(function(item){return {label:item.label,name:item.name,detail:item.detail,action:item.action,route:'agenda',urgent:false};});
    var summary=document.querySelector('[data-home-summary]');if(summary)summary.textContent=tasks.length?' Tienes '+tasks.length+(tasks.length===1?' pendiente':' pendientes')+' hoy.':' Todo al día por hoy.';
    if(!tasks.length){host.innerHTML='<div class="daily-home-empty"><span>✓</span><div><strong>Todo al día</strong><p>No tienes pendientes por ahora.</p></div></div>';return;}
    var shown=tasks.slice(0,5);
    host.innerHTML='<div class="daily-home-priority-list">'+shown.map(function(task,index){return '<article data-urgent="'+(task.urgent?'1':'0')+'"><i></i><div><span>'+esc(task.label)+'</span><strong>'+esc(task.name)+'</strong><small>'+esc(task.detail)+'</small></div><button type="button" data-index="'+index+'">'+esc(task.action)+'</button></article>';}).join('')+(tasks.length>shown.length?'<button type="button" class="daily-home-more" data-home-more-alerts>Ver las '+tasks.length+' alertas <span aria-hidden="true">→</span></button>':'')+'</div>';
    host.querySelectorAll('button[data-index]').forEach(function(button){button.onclick=function(){var task=shown[Number(button.dataset.index)];route(task.route||'agenda');if(task.open==='operations'&&window.SmylInbox)setTimeout(window.SmylInbox.openOperations,0);};});
    var more=host.querySelector('[data-home-more-alerts]'); if(more)more.onclick=function(){route('notificaciones');};
  }

  function renderNext() {
    var host=document.querySelector('[data-home-next]'); if(!host)return;
    var now=Date.now(), rows=activeAppointments().slice().sort(function(a,b){return new Date(a.starts_at)-new Date(b.starts_at);});
    if(!rows.length){
      host.innerHTML='<div class="daily-home-next-empty"><strong>Sin citas hoy</strong><p>Agenda una cita o revisa tu horario para que los pacientes puedan reservar.</p><div><button type="button" data-go="new">Agendar cita</button><button type="button" data-go="agenda">Abrir agenda</button></div></div>';
      host.querySelector('[data-go="new"]').onclick=function(){if(window.SmylCareTasks)window.SmylCareTasks.open('appointment');else route('agenda');};
      host.querySelector('[data-go="agenda"]').onclick=function(){route('agenda');};
      return;
    }
    var upcoming=rows.find(function(a){return new Date(a.starts_at).getTime()>=now&&a.status==='confirmed';});
    var shown=rows.slice(0,7), marked=false, html='';
    shown.forEach(function(a){
      var start=new Date(a.starts_at).getTime();
      if(!marked&&start>=now){marked=true;html+='<div class="daily-home-now" role="separator"><span>Ahora · '+esc(fmtTime(now))+'</span></div>';}
      html+='<button type="button" data-status="'+esc(a.status)+'"'+(upcoming&&upcoming.id===a.id?' data-next="1"':'')+'><time>'+esc(fmtTime(a.starts_at))+'</time><span><strong>'+esc(patientName(a.patient_id))+'</strong><small>'+esc(serviceName(a.service_id))+'</small></span><em>'+esc(upcoming&&upcoming.id===a.id?'Próxima':(STATUS[a.status]||'Programada'))+'</em></button>';
    });
    if(!marked)html+='<div class="daily-home-now" role="separator"><span>Ahora · '+esc(fmtTime(now))+'</span></div>';
    if(rows.length>shown.length)html+='<button type="button" class="daily-home-more" data-go-agenda>Ver las '+rows.length+' citas de hoy <span aria-hidden="true">→</span></button>';
    host.innerHTML='<div class="daily-home-next-list daily-home-timeline">'+html+'</div>';
    host.querySelectorAll('button').forEach(function(button){button.onclick=function(){route('agenda');};});
  }

  function chatCard(item) {
    var inbox=window.SmylInbox, urgent=Boolean(item.needs_human), unread=Number(item.unread_count)||0;
    var card=el('button','daily-home-chat'); card.type='button'; card.dataset.priority=urgent?'human':unread?'unread':'normal';
    var avatar=inbox&&inbox.buildAvatar?inbox.buildAvatar(item):el('span','smyl-inbox-avatar',String(item.contact_name||'P').charAt(0).toUpperCase());
    var top=el('span','daily-home-chat-top');
    top.append(el('strong','',item.contact_name||'Paciente'),el('time','',inbox&&inbox.timeLabel?inbox.timeLabel(item.last_message_at):''));
    var preview=el('span','daily-home-chat-preview',item.last_message||'Conversación sin vista previa');
    var meta=el('span','daily-home-chat-meta');
    meta.append(el('span','daily-home-chat-channel',inbox&&inbox.channelLabel?inbox.channelLabel(item.channel):'Canal'));
    if(urgent)meta.append(el('span','daily-home-chat-flag','Necesita asesor'));
    else if(unread)meta.append(el('span','daily-home-chat-flag is-unread',unread+(unread===1?' sin leer':' sin leer')));
    var copy=el('span','daily-home-chat-copy'); copy.append(top,preview,meta);
    card.append(avatar,copy);
    card.onclick=function(){if(inbox&&inbox.open)inbox.open(item.id);else route('inbox');};
    return card;
  }

  function renderChats() {
    var host=document.querySelector('[data-home-chats]'); if(!host)return;
    host.innerHTML='';
    if(state.chatsLoading&&!state.chats){host.innerHTML='<div class="daily-home-chat-skeleton"></div><div class="daily-home-chat-skeleton"></div><div class="daily-home-chat-skeleton"></div>';return;}
    if(state.chatsError&&!state.chats){
      var box=el('div','daily-home-chats-note'); box.append(el('span','','No pudimos cargar los chats recientes.'));
      var retry=el('button','','Reintentar'); retry.type='button'; retry.onclick=function(){loadChats(true);}; box.append(retry); host.append(box); return;
    }
    if(!state.chats||!state.chats.length){
      var empty=el('div','daily-home-chats-note'); empty.append(el('span','','Cuando un paciente escriba por WhatsApp, Messenger o Instagram, su chat aparecerá aquí.'));
      host.append(empty); return;
    }
    state.chats.forEach(function(item){host.append(chatCard(item));});
  }

  async function loadChats(force) {
    var inbox=window.SmylInbox;
    if(!inbox||typeof inbox.fetchRecent!=='function'||state.chatsLoading)return;
    if(!force&&state.chats&&Date.now()-state.chatsAt<30000)return;
    state.chatsLoading=true; state.chatsError=false; if(!state.chats)renderChats();
    try {
      var rows=await inbox.fetchRecent(6);
      state.chats=rows.slice().sort(function(a,b){
        if(Boolean(a.needs_human)!==Boolean(b.needs_human))return a.needs_human?-1:1;
        return new Date(b.last_message_at||0)-new Date(a.last_message_at||0);
      }).slice(0,6);
      state.chatsAt=Date.now();
    } catch(_) { state.chatsError=true; }
    finally { state.chatsLoading=false; renderChats(); }
  }

  function trend(current,previous,unit) {
    if(previous==null||current==null)return '';
    if(unit==='pts'){var diff=Math.round((current-previous)*10)/10;if(!diff)return '<span class="trend">Igual que el mes anterior</span>';return '<span class="trend '+(diff>0?'up':'down')+'">'+(diff>0?'▲ ':'▼ ')+Math.abs(diff)+' pts vs mes anterior</span>';}
    if(!previous)return '';
    var pct=Math.round((current-previous)*100/previous);
    if(!pct)return '<span class="trend">Igual que el mes anterior</span>';
    return '<span class="trend '+(pct>0?'up':'down')+'">'+(pct>0?'▲ ':'▼ ')+Math.abs(pct)+'% vs mes anterior</span>';
  }

  function monthTile(label,value,detail,routeName) {
    return '<button type="button" class="daily-home-metric" data-route="'+routeName+'" data-tone="neutral"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+detail+'</small></button>';
  }

  function renderMonth() {
    var section=document.querySelector('.daily-home-month'), host=document.querySelector('[data-home-month]'); if(!section||!host)return;
    var data=state.month;
    if(!data){section.hidden=true;flag('month','0');return;}
    flag('month','1');
    var tiles=[];
    if(data.finance){
      tiles.push(monthTile('Cobrado este mes',money(data.collected),trend(data.collected,data.prevCollected)||'Ingresos confirmados','caja'));
      tiles.push(monthTile('Por cobrar',money(data.outstanding),'Saldo pendiente de pacientes','caja'));
    }
    tiles.push(monthTile('Pacientes nuevos',String(data.newPatients),trend(data.newPatients,data.prevNewPatients)||'Registrados este mes','pacientes'));
    if(data.attendance!=null)tiles.push(monthTile('Asistencia',data.attendance+'%',trend(data.attendance,data.prevAttendance,'pts')||(data.attended+' de '+data.closed+' citas cerradas'),'reportes'));
    host.dataset.count=String(tiles.length); host.style.setProperty('--cols',String(tiles.length));
    host.innerHTML=tiles.join('');
    host.querySelectorAll('[data-route]').forEach(function(button){button.onclick=function(){route(button.dataset.route);};});
    section.hidden=false;
  }

  async function countRows(builder) {
    var result=await Promise.resolve(typeof window.sbTimeout==='function'?window.sbTimeout(builder):builder);
    if(result&&result.error)throw result.error;
    return result&&typeof result.count==='number'?result.count:0;
  }

  // Indicadores del mes (cobros y asistencia vienen de la función de reportes ejecutivos, que ya aplica los permisos de cada rol).
  async function loadMonth(force) {
    if(!window.tenantId||!window.sb||state.monthLoading)return;
    if(!force&&state.month&&Date.now()-state.monthAt<120000)return;
    state.monthLoading=true;
    var today=new Date(), start=new Date(today.getFullYear(),today.getMonth(),1);
    var prevStart=new Date(today.getFullYear(),today.getMonth()-1,1), prevLast=new Date(today.getFullYear(),today.getMonth(),0);
    var prevEnd=new Date(prevStart.getFullYear(),prevStart.getMonth(),Math.min(today.getDate(),prevLast.getDate()));
    try {
      var rows=await Promise.allSettled([
        query(window.sb.rpc('smyl_executive_dashboard',{p_from:ymd(start),p_to:ymd(today)})),
        query(window.sb.rpc('smyl_executive_dashboard',{p_from:ymd(prevStart),p_to:ymd(prevEnd)})),
        countRows(window.sb.from('camila_pacientes').select('id',{count:'exact',head:true}).eq('tenant_id',state.tenant||window.tenantId).gte('created_at',start.toISOString())),
        countRows(window.sb.from('camila_pacientes').select('id',{count:'exact',head:true}).eq('tenant_id',state.tenant||window.tenantId).gte('created_at',prevStart.toISOString()).lt('created_at',new Date(prevEnd.getFullYear(),prevEnd.getMonth(),prevEnd.getDate()+1).toISOString()))
      ]);
      var cur=rows[0].status==='fulfilled'?rows[0].value:null, prev=rows[1].status==='fulfilled'?rows[1].value:null;
      var m=cur&&cur.metrics||null, pm=prev&&prev.metrics||null;
      var newPatients=rows[2].status==='fulfilled'?rows[2].value:null;
      if(!m&&newPatients==null){state.month=null;}
      else {
        var closed=m?Number(m.completed||0)+Number(m.no_show||0):0;
        state.month={
          finance:Boolean(m&&m.collected!=null),
          collected:m&&m.collected!=null?Number(m.collected):null, prevCollected:pm&&pm.collected!=null?Number(pm.collected):null,
          outstanding:m&&m.outstanding!=null?Number(m.outstanding):null,
          newPatients:newPatients||0, prevNewPatients:rows[3].status==='fulfilled'?rows[3].value:null,
          attendance:m&&closed>0?Number(m.attendance_rate):null, prevAttendance:pm&&Number(pm.completed||0)+Number(pm.no_show||0)>0?Number(pm.attendance_rate):null,
          attended:m?Number(m.completed||0):0, closed:closed
        };
      }
      state.monthAt=Date.now();
    } catch(_) { state.month=null; }
    finally { state.monthLoading=false; renderMonth(); }
  }

  function renderError() {
    var priorities=document.querySelector('[data-home-priorities]'), next=document.querySelector('[data-home-next]'), updated=document.querySelector('[data-home-updated]');
    if(priorities)priorities.innerHTML='<div class="daily-home-error"><strong>No pudimos actualizar la jornada</strong><p>'+esc(state.error||'Revisa tu conexión e intenta nuevamente.')+'</p><button type="button">Intentar de nuevo</button></div>';
    if(priorities&&priorities.querySelector('button'))priorities.querySelector('button').onclick=function(){load(true);};
    if(next)next.innerHTML='<div class="daily-home-next-empty"><strong>Agenda no disponible</strong><p>Los módulos siguen disponibles desde los accesos inferiores.</p></div>';
    if(updated)updated.textContent='Actualización pendiente';
    renderMetrics(); loadChats(false); loadMonth(false);
  }

  function render() {
    if(state.error){renderError();return;}
    renderMetrics(); renderPriorities(); renderNext(); loadChats(false); loadMonth(false);
    var updated=document.querySelector('[data-home-updated]'); if(updated)updated.textContent='Actualizado '+new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(new Date());
  }

  async function load(force) {
    if(!window.tenantId||!window.sb||state.loading||(state.loaded&&state.tenant===window.tenantId&&!force))return;
    state.loading=true; state.error=''; state.tenant=window.tenantId; if(!state.loaded)renderLoading();
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
    window.addEventListener('smyl:attention-updated',function(event){state.messages=event.detail||null;if(state.loaded){renderMetrics();loadChats(false);}});
    window.addEventListener('smyl:task-center-updated',function(event){state.tasks=event.detail&&Array.isArray(event.detail.items)?event.detail.items:null;if(state.loaded)renderPriorities();});
    var previous=window.ir;
    window.ir=function(routeName){var result=previous(routeName);if(routeName==='dashboard'){load(true);loadMonth(true);}return result;};
    var originalDashboard=window.cargarDashboard;
    if(typeof originalDashboard==='function')window.cargarDashboard=async function(){var result=await originalDashboard.apply(this,arguments);await load(false);return result;};
    if(window.tenantId)load(false);
  }

  window.SmylDailyHome=Object.freeze({reload:function(){state.loaded=false;return load(true);}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
