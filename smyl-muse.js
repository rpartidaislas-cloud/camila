/* Private Muse pilot. Credentials are displayed once and never persisted in the browser. */
(function(win){
  'use strict';
  var host, state, busy=false, credentialNode;
  function el(tag,text,cls){var n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
  function button(label,action){var b=el('button',label,'btn btn-outline');b.type='button';b.addEventListener('click',action);return b;}
  function check(label,checked){var wrap=el('label',null,'muse-check');var input=el('input');input.type='checkbox';input.checked=!!checked;wrap.append(input,el('span',label));return {wrap:wrap,input:input};}
  async function api(body){
    if(!win.sb)throw new Error('Inicia sesión en SMYL para continuar.');
    var result=await win.sb.functions.invoke('muse-manage',{method:body?'POST':'GET',...(body?{body:body}:{})});
    if(result.error){var data;try{data=await result.error.context.json();}catch(_){}throw new Error(data&&data.error||'El piloto aún no está disponible. Intenta actualizar.');}
    return result.data;
  }
  function clearCredential(){if(credentialNode)credentialNode.value='';credentialNode=null;}
  function status(text){var s=host.querySelector('[data-muse-status]');if(s)s.textContent=text;}
  async function run(body){
    if(busy)return;busy=true;host.setAttribute('aria-busy','true');
    host.querySelectorAll('button').forEach(function(b){b.disabled=true;});
    try{var data=await api(body);await load();if(data.credential)showCredential(data.credential);else status('Cambios guardados.');}
    catch(error){status(error.message);}
    finally{busy=false;host.removeAttribute('aria-busy');host.querySelectorAll('button').forEach(function(b){b.disabled=false;});}
  }
  function showCredential(value){
    var box=el('section',null,'muse-card');box.append(el('h3','Conecta tu cuenta en Muse'),el('p','Esta clave vence en 7 días. Colócala únicamente en el campo seguro de credenciales del conector privado de Muse. No la pegues en un mensaje.'));
    var input=el('input');input.type='password';input.readOnly=true;input.value=value;input.autocomplete='off';input.setAttribute('aria-label','Clave personal de conexión');credentialNode=input;
    var reveal=button('Mostrar clave',function(){input.type=input.type==='password'?'text':'password';reveal.textContent=input.type==='password'?'Mostrar clave':'Ocultar clave';});
    var copy=button('Copiar clave',async function(){try{await navigator.clipboard.writeText(input.value);status('Clave copiada. Úsala en el campo seguro de Muse.');}catch(_){status('No se pudo copiar. Puedes mostrarla y copiarla manualmente.');}});
    box.append(input,reveal,copy,el('p','Aún falta comprobar la conexión dentro de Muse. Crear la clave no conecta tu cuenta automáticamente.','muse-muted'));host.append(box);
  }
  async function load(){
    clearCredential();
    try{state=await api();render();}catch(error){host.replaceChildren(el('h2','Muse · Piloto'),el('p',error.message),button('Actualizar',load));}
  }
  function render(){
    host.replaceChildren(el('h2','Muse · Piloto'),el('p','Consulta tus chats asignados y prepara respuestas desde Muse, también cuando lo uses en WhatsApp.'));
    var notice=el('p','', 'muse-status');notice.dataset.museStatus='';notice.setAttribute('role','status');host.append(notice);
    var summary=el('div',null,'muse-card');summary.append(el('strong',state.settings.enabled?'Piloto habilitado para esta clínica':'Piloto desactivado'),el('p','Se conservan tus permisos de SMYL. Este piloto no da acceso a ingresos, reportes ni expedientes clínicos.'));host.append(summary);
    if(state.owner){
      var admin=el('section',null,'muse-card');admin.append(el('h3','Acceso de la clínica'));
      var enabled=check('Habilitar piloto de Muse',state.settings.enabled), replies=check('Permitir respuestas con aprobación del doctor',state.settings.allow_replies);
      admin.append(enabled.wrap,replies.wrap,button('Guardar configuración',function(){run({action:'configure',enabled:enabled.input.checked,allow_replies:replies.input.checked});}),el('h3','Personas del piloto'));
      (state.people||[]).forEach(function(person){var member=(state.members||[]).find(function(m){return m.user_id===person.id;});var row=check(person.nombre||'Integrante del equipo',member&&member.enabled);
        row.input.addEventListener('change',function(){run({action:'member',user_id:person.id,enabled:row.input.checked});});admin.append(row.wrap);});
      host.append(admin);
    }
    var personal=el('section',null,'muse-card');personal.append(el('h3','Mi conexión personal'));
    if(state.connection){personal.append(el('p','Clave emitida · vence el '+new Date(state.connection.expires_at).toLocaleDateString('es-MX')),button('Desconectar Muse',function(){run({action:'disconnect'});}));}
    if(!state.settings.enabled){personal.append(el('p','El titular de la clínica debe habilitar el piloto y tu acceso.'));}
    else{
      var send=check('Permitir que Muse envíe el texto que yo apruebe',false);send.input.disabled=!state.settings.allow_replies;
      var alerts=check('Recibir avisos en mi WhatsApp vinculado en SMYL',false);
      var consent=check('Autorizo consultar mis chats asignados desde mi cuenta de Muse.',false);
      personal.append(send.wrap,alerts.wrap,el('p','Los avisos solo indican que hay un chat pendiente. Tu WhatsApp debe estar vinculado y la plantilla aprobada. Para ver el detalle o responder desde WhatsApp, abre tu conversación con Muse.','muse-muted'),consent.wrap,
        button(state.connection?'Renovar clave personal':'Crear clave personal',function(){if(!consent.input.checked)return status('Marca la autorización de tu conexión personal.');run({action:'connect',consent:true,allow_replies:send.input.checked,whatsapp_alerts:alerts.input.checked});}));
    }
    personal.append(el('p','Desconectar impide nuevas consultas. La información ya compartida puede permanecer en el historial de Muse.','muse-muted'));host.append(personal);
    if(state.alerts&&state.alerts.length){
      var recent=el('section',null,'muse-card');recent.append(el('h3','Mis últimos avisos'),button('Actualizar estado',load));
      var labels={pending:'En espera',sending:'Procesando',accepted:'Aceptado por mensajería',skipped:'Omitido: cambió el acceso',failed:'No se pudo enviar',unknown:'Revisa WhatsApp: no se confirmó el envío'};
      state.alerts.forEach(function(a){var message=labels[a.status]||'Pendiente';if(a.result_code==='approved_template_required')message='Falta aprobar la plantilla de aviso en Meta';if(a.result_code==='whatsapp_link_required')message='Vincula tu WhatsApp en SMYL';recent.append(el('p',new Date(a.created_at).toLocaleString('es-MX')+' · '+message));});host.append(recent);
    }
  }
  function init(){
    if(!win.ir||!document.querySelector('.contenido'))return;
    var page=el('section',null,'pantalla');page.id='p-muse';host=el('div',null,'muse-panel');page.append(host);document.querySelector('.contenido').append(page);
    if(win.TITULOS)win.TITULOS.muse='Muse · Piloto';
    var previous=win.ir;win.ir=function(route){if(route!=='muse')clearCredential();var result=previous.apply(this,arguments);if(route==='muse')load();return result;};
    win.addEventListener('pagehide',clearCredential);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
