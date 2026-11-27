/* SMYL · Seguridad en lenguaje simple: una pregunta por cada aviso, con botones Sí / No.
 * El monitoreo (sin datos de pacientes) sigue igual en el servidor; esta pantalla solo lo explica y deja responder con un clic.
 * «Sí» cierra el aviso como actividad normal; «No» lo marca en investigación y dice qué hacer. Un aviso no confirma por sí solo un incidente. */
(function(){
  'use strict';
  var state={client:null,loading:false,loaded:false,denied:false,data:null,error:'',observed:false,busy:false,message:''};
  var NOTE_YES='Confirmado por la persona que revisó: actividad normal.';
  var NOTE_NO='La persona que revisó indicó que no reconoce esta actividad.';
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function date(v){return v?new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'Sin registro';}
  function day(v){return v?new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'long'}).format(new Date(v)):'';}
  function num(e,key){return Number(e&&e.evidence&&e.evidence[key])||0;}
  /* Cada tipo de aviso, dicho como lo diría una persona: qué pasó, y qué se le pregunta. kind: 'yesno' (¿fuiste tú?) o 'ok' (solo enterarse). */
  function plain(e){
    var when=day(e.last_seen_at),n;
    switch(e.event_type){
      case 'access_fingerprint_velocity':n=num(e,'fingerprints_24h');return {kind:'yesno',title:'Entraron a una cuenta desde varios aparatos',text:'El '+when+' se entró a una cuenta de tu clínica desde '+(n||'varios')+' aparatos o navegadores distintos en un solo día. Por ejemplo: la computadora, el celular, una ventana de incógnito o la app instalada.',ask:'¿Fuiste tú o tu equipo trabajando normalmente?',yes:'Sí, fuimos nosotros',no:'No, no lo reconozco'};
      case 'export_volume':n=num(e,'exports_15m');return {kind:'yesno',title:'Se descargaron varios documentos seguidos',text:'El '+when+' se descargaron '+(n||'varios')+' documentos o reportes en pocos minutos.',ask:'¿Fue trabajo normal de tu clínica?',yes:'Sí, fue normal',no:'No, no lo reconozco'};
      case 'rejected_file_volume':n=num(e,'rejected_15m');return {kind:'yesno',title:'Se bloquearon varios archivos por seguridad',text:'El '+when+' SMYL no dejó subir '+(n||'varios')+' archivos en pocos minutos, porque podían ser peligrosos o de un tipo no permitido.',ask:'¿Estabas subiendo archivos tú o tu equipo?',yes:'Sí, éramos nosotros',no:'No, no lo reconozco'};
      case 'privilege_change_volume':n=num(e,'changes_1h');return {kind:'yesno',title:'Cambiaron los permisos de varias personas',text:'El '+when+' se cambiaron permisos o roles '+(n||'varias')+' veces en una hora.',ask:'¿Fuiste tú o alguien de confianza?',yes:'Sí, fuimos nosotros',no:'No, no lo reconozco'};
      case 'file_maintenance_error':return {kind:'ok',title:'Un archivo tuvo un problema al revisarse',text:'La revisión automática de archivos terminó con un error. No pierdes nada y no tienes que hacer algo ahora; si se repite varios días, avísanos.',ask:'',yes:'Entendido'};
      case 'legacy_file_review':n=num(e,'files');return {kind:'ok',title:'Hay archivos antiguos por revisar',text:(n?n+(n===1?' archivo guardado de antes quedó':' archivos guardados de antes quedaron'):'Hay archivos guardados de antes que quedaron')+' pendientes de una revisión de seguridad. No se borró nada.',ask:'',yes:'Entendido'};
      default:return {kind:'yesno',title:e.title||'Actividad por confirmar',text:e.summary||'SMYL notó algo distinto a lo habitual.',ask:'¿Reconoces esta actividad?',yes:'Sí, la reconozco',no:'No, no la reconozco'};
    }
  }
  function isOpen(e){return e.status!=='resolved';}
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
  async function call(action,payload){if(!state.client)throw new Error('La sesión de seguridad aún no está lista.');var r=await state.client.functions.invoke('security-monitor',{body:Object.assign({action:action},payload||{})});if(r.error){var m='No se pudo completar la acción.';try{var j=r.error.context&&await r.error.context.json();if(j&&j.error)m=j.error;}catch(e){}throw new Error(m);}return r.data;}
  function build(){
    if(document.getElementById('p-seguridad'))return;
    var page=el('section','pantalla security-page');page.id='p-seguridad';
    page.innerHTML='<header class="security-head"><div><span class="security-eyebrow">Tu clínica y tus datos</span><h1>Seguridad</h1><p>SMYL vigila en silencio que nadie use tu cuenta o se lleve información sin permiso. Si nota algo distinto, te lo pregunta aquí.</p></div><button type="button" class="btn btn-secondary" data-security-refresh>Actualizar</button></header><div data-security-feedback aria-live="polite"></div><section data-security-status></section><section data-security-events></section><section data-security-more></section>';
    document.querySelector('.contenido').append(page);
    page.querySelector('[data-security-refresh]').onclick=function(){state.message='';load(true);};
  }
  function statusCard(open){
    var host=document.querySelector('[data-security-status]');host.replaceChildren();
    var ok=!open.length,card=el('div','security-status'+(ok?' is-ok':' is-ask'));
    var mark=el('i','',ok?'✓':'!');mark.setAttribute('aria-hidden','true');
    var copy=el('div');
    copy.append(el('strong','',ok?'Todo en orden':open.length===1?'Hay 1 cosa que revisar':'Hay '+open.length+' cosas que revisar'),el('p','',ok?'No encontramos nada raro en tu clínica.':'Responde con un clic. Si fuiste tú, se cierra en un segundo.'));
    card.append(mark,copy);host.append(card);
  }
  function answer(e,yes,button){
    if(state.busy)return;state.busy=true;button.disabled=true;
    call('update_event',{event_id:e.id,status:yes?'resolved':'investigating',note:yes?NOTE_YES:NOTE_NO}).then(function(){
      state.message=yes?'Listo, lo marcamos como normal.':'Gracias por avisar. Sigue los pasos de abajo.';state.loaded=false;return load(true);
    }).catch(function(err){state.message=err.message;render();}).then(function(){state.busy=false;});
  }
  function allSame(rows,type){
    if(state.busy)return;
    if(!window.confirm('¿Marcar '+rows.length+' avisos iguales como actividad normal?'))return;
    state.busy=true;var i=0,failed=0;
    function next(){var e=rows[i++];if(!e)return Promise.resolve();return call('update_event',{event_id:e.id,status:'resolved',note:NOTE_YES}).catch(function(){failed++;}).then(next);}
    Promise.all([next(),next(),next()]).then(function(){state.message=failed?'Se cerraron '+(rows.length-failed)+' de '+rows.length+'. Intenta con el resto.':'Listo, los '+rows.length+' avisos quedaron como normales.';state.loaded=false;return load(true);}).catch(function(err){state.message=err.message;render();}).then(function(){state.busy=false;});
  }
  function questionCard(e){
    var p=plain(e),card=el('article','security-question');card.dataset.severity=e.severity||'warning';card.dataset.status=e.status||'open';
    var head=el('div','security-question-head');
    if(e.severity==='high'||e.severity==='critical')head.append(el('span','security-tag','Importante'));
    if(e.status==='investigating')head.append(el('span','security-tag is-wait','Dijiste que no lo reconoces'));
    head.append(el('time','',date(e.last_seen_at)));
    card.append(head,el('h3','',p.title),el('p','security-question-text',p.text));
    var actions=el('div','security-actions');
    if(p.kind==='ok'){
      var okb=el('button','btn btn-primary',p.yes);okb.type='button';okb.onclick=function(){answer(e,true,okb);};actions.append(okb);
    }else if(e.status==='investigating'){
      card.append(el('p','security-question-ask','¿Ya lo aclaraste?'));
      var done=el('button','btn btn-primary','Sí, ya está resuelto');done.type='button';done.onclick=function(){answer(e,true,done);};actions.append(done);
    }else{
      card.append(el('p','security-question-ask',p.ask));
      var yes=el('button','btn btn-primary security-yes',p.yes);yes.type='button';yes.onclick=function(){answer(e,true,yes);};
      var no=el('button','btn btn-secondary security-no',p.no);no.type='button';no.onclick=function(){answer(e,false,no);};
      actions.append(yes,no);
    }
    card.append(actions);
    var detail=el('details','security-detail');detail.append(el('summary','','Ver detalle'));
    var list=el('dl');
    Object.keys(e.evidence||{}).forEach(function(k){list.append(el('dt','',k.replace(/_/g,' ')),el('dd','',String(e.evidence[k])));});
    list.append(el('dt','','Primera vez'),el('dd','',date(e.first_seen_at||e.last_seen_at)),el('dt','','Última vez'),el('dd','',date(e.last_seen_at)),el('dt','','Código'),el('dd','',String(e.event_type||'')));
    detail.append(list);card.append(detail);
    return card;
  }
  function help(){
    var box=el('aside','security-help');box.setAttribute('role','note');
    box.append(el('strong','','Si no reconoces la actividad'));
    var ol=el('ol');['Cambia tu contraseña ahora.','Revisa quién tiene acceso a tu clínica en Configuración → Equipo y quita a quien ya no deba estar.','No borres nada. Si crees que alguien vio expedientes de pacientes, escríbenos para ayudarte.'].forEach(function(t){ol.append(el('li','',t));});
    box.append(ol);return box;
  }
  function events(){
    var host=document.querySelector('[data-security-events]');host.replaceChildren();
    var rows=state.data&&state.data.events||[],open=rows.filter(isOpen),closed=rows.filter(function(e){return !isOpen(e);});
    statusCard(open);
    if(state.message)host.append(el('p','security-flash',state.message));
    var order={critical:0,high:1,warning:2,info:3};
    open.sort(function(a,b){return (order[a.severity]-order[b.severity])||String(b.last_seen_at).localeCompare(String(a.last_seen_at));});
    // Muchos avisos iguales pendientes (por ejemplo, tus propios navegadores): se pueden cerrar juntos.
    var byType={};open.forEach(function(e){if(e.status==='open'&&plain(e).kind==='yesno'&&e.severity!=='high'&&e.severity!=='critical')(byType[e.event_type]=byType[e.event_type]||[]).push(e);});
    Object.keys(byType).forEach(function(t){var list=byType[t];if(list.length<3)return;var bar=el('div','security-bulk');bar.append(el('span','',list.length+' avisos de este tipo esperan tu respuesta.'));var b=el('button','btn btn-secondary','Todos fueron normales');b.type='button';b.onclick=function(){allSame(list,t);};bar.append(b);host.append(bar);});
    open.slice(0,12).forEach(function(e){host.append(questionCard(e));});
    if(open.length>12)host.append(el('p','security-more-note','Mostramos los 12 más importantes. Al responderlos aparecen los demás.'));
    if(open.some(function(e){return e.status==='investigating';}))host.append(help());
    if(closed.length){var d=el('details','security-closed');d.append(el('summary','','Ya revisados ('+closed.length+')'));var ul=el('ul');closed.slice(0,15).forEach(function(e){var li=el('li');li.append(el('span','',plain(e).title),el('time','',date(e.resolved_at||e.last_seen_at)));ul.append(li);});d.append(ul);host.append(d);}
  }
  function exportsView(){
    var host=document.querySelector('[data-security-more]');host.replaceChildren();
    var rows=state.data&&state.data.exports||[],labels={clinical_pdf:'PDF clínico',proposal_pdf:'Propuesta PDF',receipt_pdf:'Recibo PDF',executive_csv:'Reporte CSV'},purposes={patient_copy:'copia para el paciente',clinical_continuity:'continuidad clínica',administration:'administración',fiscal:'fiscal'};
    var d=el('details','security-closed');d.append(el('summary','','Documentos descargados esta semana'+(rows.length?' ('+rows.length+')':'')));
    if(!rows.length){d.append(el('p','security-more-note','Todavía no se ha descargado nada.'));}
    else{var ul=el('ul');rows.forEach(function(x){var li=el('li');li.append(el('span','',(labels[x.export_type]||x.export_type)+' · '+(purposes[x.purpose]||x.purpose)+' · '+Number(x.count||0)+(Number(x.count||0)===1?' vez':' veces')),el('time','',date(x.last_at)));ul.append(li);});d.append(ul);}
    host.append(d);
  }
  function render(){
    var page=document.getElementById('p-seguridad');if(!page)return;
    var feedback=page.querySelector('[data-security-feedback]'),refresh=page.querySelector('[data-security-refresh]');
    refresh.disabled=state.loading;refresh.textContent=state.loading?'Actualizando…':'Actualizar';
    feedback.replaceChildren();
    if(state.denied){var n=el('div','security-notice');n.append(el('strong','','Esta sección es para quien administra la clínica'),el('span','','Pídele a la persona responsable que la revise.'));feedback.append(n);['status','events','more'].forEach(function(k){page.querySelector('[data-security-'+k+']').replaceChildren();});return;}
    if(state.error){var er=el('div','security-notice is-error');er.append(el('strong','','No pudimos actualizar'),el('span','',state.error));feedback.append(er);}
    if(state.loading&&!state.data){var s=page.querySelector('[data-security-events]');s.innerHTML=window.SmylSkeleton?window.SmylSkeleton.html('list',{rows:3,action:true,label:'Cargando seguridad'}):'<p>Cargando…</p>';return;}
    if(state.data){events();exportsView();var m=state.data.metrics||{};window.dispatchEvent(new CustomEvent('smyl:security-updated',{detail:{open:Number(m.open_events||0),high:Number(m.high_events||0)}}));}
  }
  async function load(force){if(!state.client||state.loading||(!force&&state.loaded))return state.data;state.loading=true;state.error='';render();try{var r=await call('dashboard');state.data=r.dashboard;state.loaded=true;state.denied=false;}catch(e){state.error=e.message;state.denied=/rol|auditor/i.test(e.message);}finally{state.loading=false;render();}return state.data;}
  async function recordExport(details){var r=await call('record_export',details);if(!r.ok)throw new Error('La exportación no quedó registrada.');state.loaded=false;return r;}
  function start(client){if(state.client||!client)return;state.client=client;function observe(session){if(!session||state.observed)return;state.observed=true;call('observe').catch(function(){});}client.auth.getSession().then(function(r){observe(r&&r.data&&r.data.session);}).catch(function(){});client.auth.onAuthStateChange(function(event,session){if(event==='SIGNED_IN')observe(session);});}
  function init(){build();window.TITULOS.seguridad='Seguridad';var previous=window.ir;window.ir=function(route){var result=previous(route);if(route==='seguridad')load(false);return result;};}
  window.SmylSecurity=Object.freeze({start:start,load:load,loadSummary:function(){return load(false);},recordExport:recordExport,plain:plain});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
