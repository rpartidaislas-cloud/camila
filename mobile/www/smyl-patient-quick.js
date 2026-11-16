/* SMYL · Alta rápida de paciente: reglas puras (sin DOM ni red) para el consultorio.
 * Mismas reglas que el alta rápida de la agenda: el teléfono es lo único obligatorio; sin nombre, la ficha queda
 * «por registrar» con un nombre provisional (camila_pacientes.nombre es NOT NULL). */
(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SmylPatientQuick=api;})(globalThis,function(){
  'use strict';
  var PENDING_PREFIX='Por registrar · ';
  function digits(v){return String(v==null?'':v).replace(/\D/g,'');}
  /* Clave comparable de un teléfono mexicano: 10 dígitos, con o sin lada de país (+52 / +521). Otros formatos: 8 a 15 dígitos. */
  function phoneKey(v){var d=digits(v);if(d.length===10)return d;if(d.length===12&&d.slice(0,2)==='52')return d.slice(2);if(d.length===13&&d.slice(0,3)==='521')return d.slice(3);return d.length>=8&&d.length<=15?d:'';}
  function composePhone(v){var raw=String(v==null?'':v).trim(),d=digits(raw);if(!raw)return '';if(raw.charAt(0)==='+')return raw;return d.length===10?'+52 '+d:raw;}
  function pendingName(tel){return PENDING_PREFIX+String(tel||'').trim();}
  function isPending(p){return !!p&&(p.registro_estado==='pendiente'||String(p.nombre||'').indexOf(PENDING_PREFIX)===0);}
  function displayName(p){return p?[p.nombre,p.apellido].filter(Boolean).join(' '):'';}
  /* Nombre para listas: la ficha provisional se muestra como «Por registrar» (el teléfono va aparte). */
  function listName(p){return isPending(p)?'Por registrar':displayName(p);}
  function initials(name){var parts=String(name||'').replace(PENDING_PREFIX,'').trim().split(/\s+/).filter(Boolean);if(!parts.length||/^[\d+()\s-]+$/.test(parts.join(' ')))return '?';return (parts[0].charAt(0)+(parts.length>1?parts[parts.length-1].charAt(0):'')).toUpperCase();}
  /* Valida lo que escribió la persona y devuelve la fila a guardar. Sin nombre = ficha pendiente. */
  function prepare(input){
    input=input||{};
    var nombre=String(input.nombre==null?'':input.nombre).trim().slice(0,150),tel=composePhone(input.tel);
    if(!nombre&&!tel)return {ok:false,field:'tel',error:'Escribe el teléfono de la persona (o su nombre).'};
    if(tel&&!phoneKey(tel))return {ok:false,field:'tel',error:'Revisa el teléfono: usa 10 dígitos o el número con lada de país.'};
    var pending=!nombre;
    return {ok:true,pending:pending,row:{nombre:pending?pendingName(tel):nombre,apellido:'',telefono:tel,email:''}};
  }
  /* Enlace de WhatsApp para un teléfono mexicano (10 dígitos → 52…) o internacional; '' si no sirve. */
  function whatsappUrl(tel,text){var d=digits(tel);if(d.length===10)d='52'+d;if(d.length<11||d.length>15)return '';return 'https://wa.me/'+d+(text?'?text='+encodeURIComponent(text):'');}
  return {PENDING_PREFIX:PENDING_PREFIX,digits:digits,phoneKey:phoneKey,composePhone:composePhone,pendingName:pendingName,isPending:isPending,displayName:displayName,listName:listName,initials:initials,prepare:prepare,whatsappUrl:whatsappUrl};
});
