/* SMYL · Etapa 6: estado de conexión y recuperación segura del workspace. */
(function(){
  'use strict';
  var forced=null,restoreTimer=null;
  function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
  function activeRoute(){var panel=document.querySelector('.pantalla.activa');return panel&&panel.id?panel.id.replace(/^p-/,''):'dashboard';}
  function isOnline(){return forced===null?navigator.onLine:!forced;}
  function build(){
    if(document.getElementById('smyl-connection-status'))return;
    var banner=el('section','smyl-connection-status');banner.id='smyl-connection-status';banner.hidden=true;banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
    banner.innerHTML='<div><i aria-hidden="true"></i><span data-resilience-message></span></div><button type="button" data-resilience-retry>Reintentar</button>';
    document.body.prepend(banner);banner.querySelector('[data-resilience-retry]').onclick=retryActive;
    var live=el('div','smyl-live-region');live.id='smyl-live-region';live.setAttribute('aria-live','polite');live.setAttribute('aria-atomic','true');document.body.append(live);
    update(false);
  }
  function announce(message){var live=document.getElementById('smyl-live-region');if(!live)return;live.textContent='';setTimeout(function(){live.textContent=message;},20);}
  function update(recovered){
    var banner=document.getElementById('smyl-connection-status');if(!banner)return;clearTimeout(restoreTimer);
    if(!isOnline()){banner.hidden=false;banner.dataset.tone='offline';banner.querySelector('[data-resilience-message]').textContent='Sin conexión. Conservamos lo que ya está visible; evita repetir envíos o cobros hasta reconectar.';banner.querySelector('button').hidden=false;announce('SMYL está sin conexión.');return;}
    if(recovered){banner.hidden=false;banner.dataset.tone='restored';banner.querySelector('[data-resilience-message]').textContent='Conexión restablecida. Actualizamos el módulo activo.';banner.querySelector('button').hidden=true;announce('Conexión restablecida.');restoreTimer=setTimeout(function(){banner.hidden=true;},5000);}else banner.hidden=true;
  }
  function reloadFor(route){
    var map={dashboard:['SmylDailyHome','reload'],agenda:['SmylSchedule','reload'],inbox:['SmylInbox','refresh'],notificaciones:['SmylTaskCenter','reload'],inventario:['SmylInventory','reload'],caja:['SmylFinance','reload'],reportes:['SmylReports','reload'],lanzamiento:['SmylReadiness','reload']};
    var target=map[route],api=target&&window[target[0]];if(api&&typeof api[target[1]]==='function')return Promise.resolve(api[target[1]]());
    if(route==='pacientes'&&typeof window.cargarPacientes==='function')return Promise.resolve(window.cargarPacientes());
    return Promise.resolve();
  }
  function retryActive(){
    if(!isOnline()){announce('Todavía no hay conexión.');return;}
    var button=document.querySelector('[data-resilience-retry]');if(button){button.disabled=true;button.textContent='Actualizando…';}
    reloadFor(activeRoute()).then(function(){update(true);},function(){announce('No fue posible actualizar. Intenta nuevamente.');}).finally(function(){if(button){button.disabled=false;button.textContent='Reintentar';}});
  }
  function setBusy(value){var panel=document.querySelector('.pantalla.activa');if(panel)panel.setAttribute('aria-busy',String(Boolean(value)));}
  function init(){
    build();window.addEventListener('offline',function(){update(false);});window.addEventListener('online',function(){update(true);reloadFor(activeRoute());});
    var show=window.showNavLoading,hide=window.hideNavLoading;if(typeof show==='function')window.showNavLoading=function(){setBusy(true);return show.apply(this,arguments);};if(typeof hide==='function')window.hideNavLoading=function(){setBusy(false);return hide.apply(this,arguments);};
  }
  window.SmylResilience=Object.freeze({retry:retryActive,announce:announce,showOffline:function(){forced=true;update(false);},showOnline:function(){forced=false;update(true);},clearTestState:function(){forced=null;update(false);}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
