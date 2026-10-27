/* SMYL · Etapa 7: navegación global y cierre accesible del workspace. */
(function(){
  'use strict';
  var GROUPS=[
    {label:'Trabajo diario',items:[['Inicio','dashboard','Resumen y prioridades de hoy'],['Pacientes','pacientes','Directorio y expedientes'],['Agenda','agenda','Citas, llegadas y solicitudes'],['Mensajes','inbox','WhatsApp, Messenger e Instagram']]},
    {label:'Clínica',items:[['Nueva simulación','__simulation','Registrar fotografías y propuesta'],['Simulaciones anteriores','historial','Casos y resultados guardados']]},
    {label:'Negocio',items:[['Servicios y tarifas','precios','Catálogo clínico, precios y claves fiscales'],['Inventario','inventario','Existencias, lotes y compras'],['Caja y cobros','caja','Pagos, saldos y cortes'],['Reportes','reportes','Indicadores agregados de operación']]},
    {label:'Configuración',items:[['Mi clínica','clinica','Sucursales, equipo y permisos'],['Directorio profesional','directorio','Perfil, CV, enlace y QR'],['Canales y asistente','conexiones','Meta, contexto y laboratorio'],['Preparación operativa','lanzamiento','Controles antes del piloto'],['Marca y simulación','sim-config','Identidad y presentación'],['Mi cuenta','mi-cuenta','Plan y acceso']]}
  ];
  var dialog,input,trigger,lastFocus;
  function esc(value){return String(value).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
  function normalize(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function build(){
    if(document.getElementById('smyl-command-dialog'))return;
    var top=document.querySelector('.topbar-right');trigger=document.createElement('button');trigger.type='button';trigger.className='smyl-command-trigger';trigger.setAttribute('aria-label','Ir a una sección');trigger.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Ir a…</span><kbd>Ctrl K</kbd>';if(top)top.prepend(trigger);
    var skip=document.createElement('button');skip.type='button';skip.className='smyl-skip-link';skip.textContent='Saltar al contenido';skip.onclick=focusActive;document.body.prepend(skip);
    dialog=document.createElement('dialog');dialog.id='smyl-command-dialog';dialog.className='smyl-command-dialog';dialog.setAttribute('aria-labelledby','smyl-command-title');dialog.innerHTML='<div class="smyl-command-shell"><header><div><span>IR A</span><h2 id="smyl-command-title">Encuentra tu siguiente tarea</h2></div><button type="button" data-command-close aria-label="Cerrar">×</button></header><label class="smyl-command-search"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="sr-only">Buscar módulo</span><input type="search" placeholder="Buscar agenda, pacientes, inventario…" autocomplete="off"></label><div class="smyl-command-results" data-command-results></div><footer><span>↑↓ para elegir</span><span>Enter para abrir</span><span>Esc para cerrar</span></footer></div>';document.body.append(dialog);input=dialog.querySelector('input');
    trigger.onclick=open;dialog.querySelector('[data-command-close]').onclick=close;dialog.addEventListener('click',function(event){if(event.target===dialog)close();});input.addEventListener('input',render);dialog.addEventListener('keydown',navigate);dialog.addEventListener('close',function(){if(lastFocus)lastFocus.focus();});render();
  }
  function render(){
    if(!dialog)return;var q=normalize(input&&input.value),host=dialog.querySelector('[data-command-results]'),visible=0;host.innerHTML='';
    GROUPS.forEach(function(group){var items=group.items.filter(function(item){return !q||normalize(item.join(' ')).includes(q);});if(!items.length)return;visible+=items.length;var section=document.createElement('section');section.innerHTML='<h3>'+esc(group.label)+'</h3><div>'+items.map(function(item){return '<button type="button" data-command-route="'+esc(item[1])+'"><span><strong>'+esc(item[0])+'</strong><small>'+esc(item[2])+'</small></span><i aria-hidden="true">→</i></button>';}).join('')+'</div>';host.append(section);});
    if(!visible)host.innerHTML='<div class="smyl-command-empty"><strong>Sin coincidencias</strong><p>Prueba con el nombre de una tarea o módulo.</p></div>';
    host.querySelectorAll('[data-command-route]').forEach(function(button){button.onclick=function(){go(button.dataset.commandRoute);};});
  }
  function open(){if(!dialog)return;lastFocus=document.activeElement;input.value='';render();if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');setTimeout(function(){input.focus();},0);}
  function close(){if(!dialog)return;if(typeof dialog.close==='function'&&dialog.open)dialog.close();else dialog.removeAttribute('open');}
  function go(route){close();if(route==='__simulation'){window.location.href='simulacion-rapida.html?workspace=professional';return;}if(typeof window.ir==='function')window.ir(route);setTimeout(focusActive,0);}
  function focusActive(){var panel=document.querySelector('.pantalla.activa');if(!panel)return;var heading=panel.querySelector('h1,h2,.card-title');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:false});}else{panel.tabIndex=-1;panel.focus();}}
  function navigate(event){if(event.key!=='ArrowDown'&&event.key!=='ArrowUp'&&event.key!=='Enter')return;var buttons=Array.from(dialog.querySelectorAll('[data-command-route]'));if(!buttons.length)return;var index=buttons.indexOf(document.activeElement);if(event.key==='Enter'){event.preventDefault();buttons[index>=0?index:0].click();return;}event.preventDefault();if(event.key==='ArrowDown')buttons[index<0?0:(index+1)%buttons.length].focus();else buttons[index<=0?buttons.length-1:index-1].focus();}
  function init(){build();document.addEventListener('keydown',function(event){if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();dialog&&dialog.open?close():open();}});var previous=window.ir;window.ir=function(route){var result=typeof previous==='function'?previous(route):undefined;document.title=(window.TITULOS&&window.TITULOS[route]?window.TITULOS[route]:'SMYL')+' · SMYL';return result;};}
  window.SmylCommandMenu=Object.freeze({open:open,close:close});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
