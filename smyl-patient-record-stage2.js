/* SMYL · Compatibilidad: retira el resumen clínico duplicado de la etapa 2. */
(function(){
  'use strict';
  function clean(){document.querySelectorAll('.patient-record-stage2').forEach(function(node){node.remove();});}
  function init(){var screen=document.getElementById('p-paciente-detalle');if(!screen)return;new MutationObserver(clean).observe(screen,{childList:true,subtree:true});clean();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
