/* SMYL · Etapa 4: tablero diario de la clínica. */
(function () {
  'use strict';

  var state = { loading:false, loaded:false, tenant:null, appointments:[], requests:[], patients:[], services:[], messages:null, error:'', chats:null, chatsError:false, chatsLoading:false, chatsAt:0, tasks:null, month:null, monthLoading:false, monthAt:0, access:null, accessTenant:null };

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
  // Inicio por rol: lo que el rol puede ver/hacer. Si no se pudo leer (access=null) se muestra todo; quien manda siempre es la base de datos (RLS).
  function can(key) { var a=state.access; return !a||a.owner||a.perms.indexOf(key)!==-1; }
  function mineOnly() { var a=state.access; if(!a||!a.professionalId)return false; return can('schedule.manage')?flag('mine')==='1':true; }
  function activeAppointments() { var mine=mineOnly()?state.access.professionalId:null; return state.appointments.filter(function(row){return row.status!=='cancelled'&&(!mine||row.professional_id===mine);}); }
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
    section.innerHTML='<header class="daily-home-bar"><div class="daily-home-bar-copy"><h1 data-home-greeting></h1><p><span data-home-date></span> · <small data-home-updated aria-live="polite">Actualizando…</small></p></div><div class="daily-home-bar-actions"><span class="daily-home-state" data-home-day-state data-tone="clear">Revisando…</span><button type="button" class="daily-home-bar-btn" data-home-open-agenda>Ver agenda</button><button type="button" class="daily-home-bar-btn is-primary" data-home-new-appointment>+ Nueva cita</button></div></header><div class="daily-home-workbench"><section class="daily-home-card daily-home-now-card" aria-labelledby="daily-home-now-title"><header><div><span>HOY</span><h2 id="daily-home-now-title">Mi jornada</h2></div><span class="daily-home-day-count" data-home-day-count></span></header><div class="daily-home-chips" data-home-metrics aria-live="polite"></div><div data-home-next></div></section><section class="daily-home-card daily-home-priorities" aria-labelledby="daily-home-priorities-title"><header><div><span>ATENCIÓN REQUERIDA</span><h2 id="daily-home-priorities-title" data-home-priority-title>Revisando…</h2></div></header><div data-home-priorities></div><div class="daily-home-inbox-line" data-home-inbox-line hidden></div></section></div><section class="daily-home-card daily-home-chats" aria-labelledby="daily-home-chats-title"><header><div><span>CONVERSACIONES</span><h2 id="daily-home-chats-title">Mensajes recientes</h2></div><button type="button" data-home-open-inbox>Ver bandeja</button></header><div class="daily-home-chat-strip" data-home-chats aria-live="polite"></div></section><section class="daily-home-month" aria-labelledby="daily-home-month-title"><header><h2 id="daily-home-month-title">Resumen del mes</h2><button type="button" data-home-open-reports>Ver reportes <span aria-hidden="true">→</span></button></header><div class="daily-home-metrics daily-home-metrics-month" data-home-month aria-live="polite"></div></section>';
    var monthSection=section.querySelector('.daily-home-month');
    if(flag('month')==='1')section.querySelector('[data-home-month]').innerHTML='<div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div><div class="daily-home-skeleton"></div>'; else monthSection.hidden=true;
    section.querySelector('[data-home-date]').textContent=capitalize(fmtDate(new Date()));
    section.querySelector('[data-home-greeting]').textContent=greeting();
    section.querySelector('[data-home-open-agenda]').onclick=function(){route('agenda');};
    section.querySelector('[data-home-new-appointment]').onclick=function(){if(window.SmylCareTasks&&typeof window.SmylCareTasks.open==='function')window.SmylCareTasks.open('appointment');else route('agenda');};
    section.querySelector('[data-home-open-inbox]').onclick=function(){route('inbox');};
    section.querySelector('[data-home-open-reports]').onclick=function(){route('reportes');};
    home.prepend(section);
    renderLoading();
  }

  function applyAccess() {
    var root=document.getElementById('smyl-daily-home'); if(!root)return;
    var pick=function(sel){return root.querySelector(sel);};
    var read=can('schedule.read'), messages=can('messages.read');
    var now=pick('.daily-home-now-card'), chats=pick('.daily-home-chats'), agenda=pick('[data-home-open-agenda]'), create=pick('[data-home-new-appointment]'), bench=pick('.daily-home-workbench'), inboxLine=pick('[data-home-inbox-line]');
    if(now)now.hidden=!read; if(agenda)agenda.hidden=!read; if(create)create.hidden=!can('schedule.manage');
    if(chats)chats.hidden=!messages; if(inboxLine&&!messages)inboxLine.hidden=true;
    if(bench)bench.classList.toggle('is-solo',!read);
    root.dataset.scope=mineOnly()?'mine':'all';
  }

  // Permisos del rol y, si la persona está vinculada a un profesional, su id (para «Mis citas»). Solo lectura.
  async function loadAccess() {
    state.accessTenant=state.tenant;
    try {
      var owner=window.miRolEquipo==='dueño';
      var user=await window.sb.auth.getUser(), uid=user&&user.data&&user.data.user&&user.data.user.id;
      if(!uid){state.access=null;return;}
      var tenant=state.tenant;
      var res=await Promise.all([
        query(window.sb.from('smyl_member_roles').select('role_id').eq('tenant_id',tenant).eq('user_id',uid)),
        query(window.sb.from('smyl_professionals').select('id').eq('tenant_id',tenant).eq('user_id',uid).eq('active',true).limit(1))
      ]);
      var ids=(res[0]||[]).map(function(r){return r.role_id;}), perms=[];
      if(ids.length)perms=(await query(window.sb.from('smyl_role_permissions').select('permission_key').eq('tenant_id',tenant).in('role_id',ids))).map(function(r){return r.permission_key;});
      state.access={owner:owner,perms:perms,professionalId:res[1]&&res[1][0]?res[1][0].id:null};
    } catch(_) { state.access=null; }
  }

  function renderLoading() {
    var metrics=document.querySelector('[data-home-metrics]'), priorities=document.querySelector('[data-home-priorities]'), next=document.querySelector('[data-home-next]');
    if(metrics)metrics.innerHTML='';
    if(priorities)priorities.innerHTML='<div class="daily-home-loading"><i></i><i></i><i></i></div>';
    if(next)next.innerHTML='<div class="daily-home-loading compact"><i></i><i></i><i></i></div>';
    renderChats();
  }

  function priorityRows() {
    var now=Date.now(), tasks=[];
    if(!can('schedule.read'))return tasks;
    activeAppointments().forEach(function(a){
      var time=new Date(a.starts_at).getTime();
      if(a.status==='in_progress')tasks.push({rank:1,label:'EN CONSULTA',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · '+serviceName(a.service_id),action:'Abrir cita'});
      else if(a.status==='arrived')tasks.push({rank:2,label:'YA LLEGÓ',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · '+serviceName(a.service_id),action:'Abrir cita'});
      else if(a.status==='confirmed'&&time<now)tasks.push({rank:3,label:'¿YA LLEGÓ?',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · ya pasó su hora',action:'Abrir cita'});
      else if(a.status==='no_show')tasks.push({rank:6,label:'NO VINO',name:patientName(a.patient_id),detail:fmtTime(a.starts_at)+' · ofrécele otra cita',action:'Ver cita'});
    });
    if(can('schedule.manage'))state.requests.filter(function(r){return r.status==='pending';}).forEach(function(r){tasks.push({rank:4,label:'PIDIÓ CITA',name:patientName(r.patient_id),detail:r.requested_start?'Prefiere '+fmtTime(r.requested_start):'Horario por acordar',action:'Revisar solicitud'});});
    return tasks.sort(function(a,b){return a.rank-b.rank;});
  }

  // Resumen de la jornada en chips dentro de «Mi jornada»: sin tarjetas aparte que repitan la lista de atención.
  // El tipo de cada chip ('appointments','clinic','requests','messages') se conserva para pruebas y lectores de pantalla.
  function chip(kind,count,one,many,tone) {
    return '<span class="daily-home-chip" data-kind="'+kind+'" data-tone="'+tone+'"><i aria-hidden="true"></i>'+count+' '+(count===1?one:many)+'</span>';
  }

  function renderMetrics() {
    var host=document.querySelector('[data-home-metrics]'); if(!host)return;
    var rows=activeAppointments(), now=Date.now();
    var clinic=rows.filter(function(a){return a.status==='arrived'||a.status==='in_progress';}).length;
    var waiting=rows.filter(function(a){return a.status==='confirmed';}).length;
    var done=rows.filter(function(a){return a.status==='completed';}).length;
    var chips=[];
    if(clinic)chips.push(chip('clinic',clinic,'en clínica','en clínica','active'));
    if(waiting)chips.push(chip('appointments',waiting,'por llegar','por llegar','neutral'));
    if(done)chips.push(chip('completed',done,'terminada','terminadas','neutral'));
    var a=state.access, canToggle=Boolean(a&&a.professionalId&&can('schedule.manage'));
    if(canToggle)chips.push('<button type="button" class="daily-home-chip is-toggle" data-home-mine aria-pressed="'+(mineOnly()?'true':'false')+'">Solo mis citas</button>');
    host.innerHTML=chips.join('');
    host.hidden=!chips.length;
    var toggle=host.querySelector('[data-home-mine]');
    if(toggle)toggle.onclick=function(){flag('mine',mineOnly()?'0':'1');applyAccess();renderMetrics();renderNext();};
    var total=document.querySelector('[data-home-day-count]');
    if(total)total.textContent=rows.length?rows.length+(rows.length===1?' cita':' citas'):'Sin citas';
    var inboxLine=document.querySelector('[data-home-inbox-line]');
    if(inboxLine){
      var ready=Boolean(state.messages&&state.messages.loaded), unread=ready?Number(state.messages.unread||state.messages.total||0):0;
      inboxLine.hidden=!ready||!can('messages.read');
      inboxLine.innerHTML=ready?'<span>Mensajes: '+(unread?unread+' sin leer':'0 sin leer')+'</span><button type="button" data-home-open-inbox-line>Ver bandeja</button>':'';
      var go=inboxLine.querySelector('button'); if(go)go.onclick=function(){route('inbox');};
    }
  }

  function taskItems() {
    if(state.tasks)return state.tasks;
    var center=window.SmylTaskCenter;
    return center&&typeof center.getTasks==='function'?center.getTasks():null;
  }

  function resolvePriorityTasks() {
    var shared=taskItems(), tasks;
    // Misma fuente que el contador de Alertas, para que el Inicio y la campana nunca se contradigan.
    if(shared)tasks=shared.map(function(item){return {label:item.source.toUpperCase(),name:item.title,detail:item.detail,action:item.action,route:item.route,open:item.open,urgent:item.rank===1};});
    else tasks=priorityRows().map(function(item){return {label:item.label,name:item.name,detail:item.detail,action:item.action,route:'agenda',urgent:false};});
    return tasks;
  }

  function renderPriorities(tasks) {
    var host=document.querySelector('[data-home-priorities]'); if(!host)return;
    tasks=tasks||resolvePriorityTasks();
    var title=document.querySelector('[data-home-priority-title]'),dayState=document.querySelector('[data-home-day-state]');
    var label=tasks.length?tasks.length+(tasks.length===1?' pendiente':' pendientes'):'Sin pendientes';
    if(title)title.textContent=label;
    if(dayState){dayState.textContent=tasks.length?tasks.length+(tasks.length===1?' requiere atención':' requieren atención'):'Todo al día';dayState.dataset.tone=tasks.length?'attention':'clear';}
    if(!tasks.length){host.innerHTML='<div class="daily-home-empty"><span>✓</span><div><p>No tienes pendientes por ahora.</p></div></div>';return;}
    var shown=tasks.slice(0,5);
    host.innerHTML='<div class="daily-home-priority-list">'+shown.map(function(task,index){return '<article data-urgent="'+(task.urgent?'1':'0')+'"><i></i><div><span>'+esc(task.label)+'</span><strong>'+esc(task.name)+'</strong><small>'+esc(task.detail)+'</small></div><button type="button" data-index="'+index+'">'+esc(task.action)+'</button></article>';}).join('')+(tasks.length>shown.length?'<button type="button" class="daily-home-more" data-home-more-alerts>Ver todas las acciones <span aria-hidden="true">→</span></button>':'')+'</div>';
    host.querySelectorAll('button[data-index]').forEach(function(button){button.onclick=function(){var task=shown[Number(button.dataset.index)];route(task.route||'agenda');if(task.open==='operations'&&window.SmylInbox)setTimeout(window.SmylInbox.openOperations,0);};});
    var more=host.querySelector('[data-home-more-alerts]'); if(more)more.onclick=function(){route('notificaciones');};
  }

  // Jornada en una sola columna y en orden: lo pendiente por hora, «ahora» marcado y lo terminado plegado en una línea.
  function renderNext() {
    var host=document.querySelector('[data-home-next]'); if(!host)return;
    var now=Date.now(), all=activeAppointments();
    var rows=all.filter(function(a){return a.status==='arrived'||a.status==='in_progress'||(a.status==='confirmed'&&new Date(a.ends_at||a.starts_at).getTime()>=now);}).sort(function(a,b){return new Date(a.starts_at)-new Date(b.starts_at);});
    var finished=all.filter(function(a){return a.status==='completed';}).sort(function(a,b){return new Date(b.starts_at)-new Date(a.starts_at);});
    if(!rows.length&&!finished.length){
      host.innerHTML='<div class="daily-home-next-empty"><span aria-hidden="true">＋</span><div><strong>Tu agenda está libre por ahora</strong><p>'+(can('schedule.manage')?'Crea una cita cuando necesites reservar un espacio.':'Cuando tengas citas aparecerán aquí.')+'</p></div>'+(can('schedule.manage')?'<button type="button" data-go="new">Crear cita</button>':'')+'</div>';
      var createButton=host.querySelector('[data-go="new"]'); if(createButton)createButton.onclick=function(){if(window.SmylCareTasks)window.SmylCareTasks.open('appointment');else route('agenda');};
      return;
    }
    var upcoming=rows.find(function(a){return new Date(a.starts_at).getTime()>=now&&a.status==='confirmed';});
    var shown=rows.slice(0,6), marked=false, html='';
    shown.forEach(function(a){
      var start=new Date(a.starts_at).getTime();
      if(!marked&&start>=now){marked=true;html+='<div class="daily-home-now" role="separator"><span>Ahora · '+esc(fmtTime(now))+'</span></div>';}
      html+='<button type="button" data-status="'+esc(a.status)+'"'+(upcoming&&upcoming.id===a.id?' data-next="1"':'')+'><time>'+esc(fmtTime(a.starts_at))+'</time><span><strong>'+esc(patientName(a.patient_id))+'</strong><small>'+esc(serviceName(a.service_id))+'</small></span><em>'+esc(upcoming&&upcoming.id===a.id?'Próxima':(STATUS[a.status]||'Programada'))+'</em></button>';
    });
    if(rows.length&&!marked)html+='<div class="daily-home-now" role="separator"><span>Ahora · '+esc(fmtTime(now))+'</span></div>';
    if(rows.length>shown.length)html+='<button type="button" class="daily-home-more" data-go-agenda>Ver toda la agenda <span aria-hidden="true">→</span></button>';
    var fold='';
    if(finished.length){
      var last=finished[0], text=finished.length===1?'1 cita terminada hoy ('+fmtTime(last.starts_at)+' · '+patientName(last.patient_id)+')':finished.length+' citas terminadas hoy';
      fold='<div class="daily-home-fold"><span><b aria-hidden="true">✓</b> '+esc(text)+'</span><button type="button" data-go-agenda>Ver</button></div>';
    }
    host.innerHTML=(rows.length?'<div class="daily-home-next-list daily-home-timeline">'+html+'</div>':'<div class="daily-home-next-empty"><strong>No quedan citas por atender hoy</strong></div>')+fold;
    host.querySelectorAll('button').forEach(function(button){button.onclick=function(){route('agenda');};});
  }

  function chatCard(item) {
    var inbox=window.SmylInbox, urgent=Boolean(item.needs_human), unread=Number(item.unread_count)||0;
    var card=el('button','daily-home-chat'); card.type='button'; card.dataset.priority=urgent?'human':unread?'unread':'normal';
    var avatar=inbox&&inbox.buildAvatar?inbox.buildAvatar(item):el('span','smyl-inbox-avatar',String(item.contact_name||'P').charAt(0).toUpperCase());
    var top=el('span','daily-home-chat-top');
    top.append(el('strong','',item.contact_name||'Paciente'),el('time','',inbox&&inbox.timeLabel?inbox.timeLabel(item.last_message_at):''));
    var meta=el('span','daily-home-chat-meta');
    meta.append(el('span','daily-home-chat-channel',inbox&&inbox.channelLabel?inbox.channelLabel(item.channel):'Canal'));
    if(urgent)meta.append(el('span','daily-home-chat-flag','Necesita asesor'));
    else if(unread)meta.append(el('span','daily-home-chat-flag is-unread',unread+(unread===1?' sin leer':' sin leer')));
    var copy=el('span','daily-home-chat-copy'); copy.append(top,meta);
    card.append(avatar,copy);
    card.onclick=function(){if(inbox&&inbox.open)inbox.open(item.id);else route('inbox');};
    return card;
  }

  function renderChats() {
    var host=document.querySelector('[data-home-chats]'); if(!host)return;
    host.innerHTML='';
    if(state.chatsLoading&&!state.chats){host.innerHTML='<div class="daily-home-chat-skeleton"></div><div class="daily-home-chat-skeleton"></div><div class="daily-home-chat-skeleton"></div>';return;}
    if(state.chatsError&&!state.chats){
      var box=el('div','daily-home-chats-note'); box.append(el('span','','Mensajes no disponibles por el momento.'));
      var retry=el('button','','Reintentar'); retry.type='button'; retry.onclick=function(){loadChats(true);}; box.append(retry); host.append(box); return;
    }
    if(!state.chats||!state.chats.length){
      var empty=el('div','daily-home-empty'); empty.append(el('span','','✓'));var emptyCopy=el('div');emptyCopy.append(el('strong','','Sin conversaciones recientes'),el('p','','Los mensajes de WhatsApp, Instagram y Messenger aparecerán aquí.'));empty.append(emptyCopy);
      host.append(empty); return;
    }
    state.chats.forEach(function(item){host.append(chatCard(item));});
  }

  async function loadChats(force) {
    var inbox=window.SmylInbox;
    if(!inbox||typeof inbox.fetchRecent!=='function'||state.chatsLoading||!can('messages.read'))return;
    if(!force&&state.chats&&Date.now()-state.chatsAt<30000)return;
    state.chatsLoading=true; state.chatsError=false; if(!state.chats)renderChats();
    try {
      var rows=await inbox.fetchRecent(12);
      state.chats=rows.slice().sort(function(a,b){
        if(Boolean(a.needs_human)!==Boolean(b.needs_human))return a.needs_human?-1:1;
        if(Boolean(Number(a.unread_count))!==Boolean(Number(b.unread_count)))return Number(a.unread_count)?-1:1;
        return new Date(b.last_message_at||0)-new Date(a.last_message_at||0);
      }).slice(0,4);
      state.chatsAt=Date.now();
    } catch(_) { state.chatsError=true; }
    finally { state.chatsLoading=false; renderChats(); }
  }

  function trend(current,previous,unit) {
    if(previous==null||current==null)return '';
    if(unit==='pts'){var diff=Math.round((current-previous)*10)/10;if(!diff)return '<span class="trend">= igual que el mes anterior</span>';return '<span class="trend '+(diff>0?'up':'down')+'">'+(diff>0?'▲ ':'▼ ')+Math.abs(diff)+' pts vs. mes anterior</span>';}
    if(!previous)return '';
    var pct=Math.round((current-previous)*100/previous);
    if(!pct)return '<span class="trend">= igual que el mes anterior</span>';
    return '<span class="trend '+(pct>0?'up':'down')+'">'+(pct>0?'▲ ':'▼ ')+Math.abs(pct)+'% vs. mes anterior</span>';
  }

  function monthTile(label,value,detail,routeName) {
    return '<button type="button" class="daily-home-stat" data-route="'+routeName+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+detail+'</small></button>';
  }

  function renderMonth() {
    var section=document.querySelector('.daily-home-month'), host=document.querySelector('[data-home-month]'); if(!section||!host)return;
    var data=state.month;
    if(!data){section.hidden=true;flag('month','0');return;}
    flag('month','1');
    var tiles=[];
    if(data.finance){
      tiles.push(monthTile('Cobrado este mes',money(data.collected),trend(data.collected,data.prevCollected)||'Ingresos confirmados','caja'));
      tiles.push(monthTile('Por cobrar',money(data.outstanding),'Saldo de pacientes','caja'));
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
    if(next)next.innerHTML='<div class="daily-home-next-empty"><strong>Agenda no disponible</strong><p>Ábrela desde el menú para continuar.</p></div>';
    if(updated)updated.textContent='Actualización pendiente';
    applyAccess(); renderMetrics(); if(can('messages.read'))loadChats(false); loadMonth(false);
  }

  function render() {
    if(state.error){renderError();return;}
    var tasks=resolvePriorityTasks();
    applyAccess(); renderMetrics(tasks); renderPriorities(tasks); renderNext(); if(can('messages.read'))loadChats(false); loadMonth(false);
    var updated=document.querySelector('[data-home-updated]'); if(updated)updated.textContent='Actualizado '+new Intl.DateTimeFormat('es-MX',{hour:'2-digit',minute:'2-digit'}).format(new Date());
  }

  // Solo los nombres que hacen falta hoy (por lotes): no depende de cuántos pacientes tenga la clínica.
  async function namesFor(tenant,ids) {
    var unique=Array.from(new Set(ids.filter(Boolean))), out=[];
    for(var i=0;i<unique.length;i+=100)out=out.concat(await query(window.sb.from('camila_pacientes').select('id,nombre,apellido').eq('tenant_id',tenant).in('id',unique.slice(i,i+100))));
    return out;
  }

  async function load(force) {
    if(!window.tenantId||!window.sb||state.loading||(state.loaded&&state.tenant===window.tenantId&&!force))return;
    state.loading=true; state.error=''; state.tenant=window.tenantId; if(!state.loaded)renderLoading();
    var start=startDay(new Date()), end=new Date(start); end.setDate(end.getDate()+1);
    try {
      var rows=await Promise.all([
        query(window.sb.from('smyl_appointments').select('id,patient_id,service_id,professional_id,starts_at,ends_at,status').eq('tenant_id',state.tenant).gte('starts_at',iso(start)).lt('starts_at',iso(end)).order('starts_at')),
        query(window.sb.from('smyl_appointment_requests').select('id,patient_id,requested_start,status').eq('tenant_id',state.tenant).eq('status','pending').order('created_at')),
        query(window.sb.from('smyl_services').select('id,name').eq('tenant_id',state.tenant).eq('active',true).order('name'))
      ]);
      state.appointments=rows[0]||[]; state.requests=rows[1]||[]; state.services=rows[2]||[];
      if(!state.access||state.accessTenant!==state.tenant)await loadAccess();
      state.patients=await namesFor(state.tenant,state.appointments.concat(state.requests).map(function(r){return r.patient_id;}));
      state.loaded=true;
      if(window.SmylLanaAttention&&typeof window.SmylLanaAttention.getSummary==='function')state.messages=window.SmylLanaAttention.getSummary();
      render();
    } catch(error) { state.error=(error&&error.message)||'Revisa tu conexión e intenta nuevamente.'; renderError(); }
    finally { state.loading=false; }
  }

  function init() {
    build();
    window.addEventListener('smyl:attention-updated',function(event){state.messages=event.detail||null;if(state.loaded){var tasks=resolvePriorityTasks();renderMetrics(tasks);renderPriorities(tasks);loadChats(false);}});
    window.addEventListener('smyl:task-center-updated',function(event){state.tasks=event.detail&&Array.isArray(event.detail.items)?event.detail.items:null;if(state.loaded){var tasks=resolvePriorityTasks();renderMetrics(tasks);renderPriorities(tasks);}});
    var previous=window.ir;
    window.ir=function(routeName){var result=previous(routeName);if(routeName==='dashboard'){load(true);loadMonth(true);}return result;};
    var originalDashboard=window.cargarDashboard;
    if(typeof originalDashboard==='function')window.cargarDashboard=async function(){var result=await originalDashboard.apply(this,arguments);await load(false);return result;};
    if(window.tenantId)load(false);
  }

  window.SmylDailyHome=Object.freeze({reload:function(){state.loaded=false;return load(true);}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
