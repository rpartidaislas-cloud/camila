(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SmylProposalModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var views={frontal:'Frontal sonriendo',left:'Perfil izquierdo',right:'Perfil derecho',tresCuartos:'Vista 3/4',extraoral:'Detalle de sonrisa',intraoral:'Frontal intraoral',intraoralLeft:'Lateral intraoral izquierda',intraoralRight:'Lateral intraoral derecha'};
  function cents(value){
    var s=String(value==null?'':value).trim();
    if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(s))return null;
    var parts=s.split('.');return Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
  }
  function money(value){return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(value/100);}
  function total(doc){return doc.items.reduce(function(sum,item){return sum+(Number.isSafeInteger(item.unit_cents)&&Number.isInteger(item.quantity)?item.unit_cents*item.quantity:0);},0);}
  function valid(doc,approve){
    if(!doc||doc.schema!==1||!doc.title.trim()||doc.title.length>150)return 'Escribe un título para la propuesta.';
    if(doc.introduction.length>3000||doc.terms.length>3000)return 'Acorta el texto de la propuesta a 3,000 caracteres por campo.';
    if(!doc.items.length||doc.items.length>20)return 'Añade entre 1 y 20 conceptos a la cotización.';
    for(var item of doc.items){
      if(!item.label.trim()||item.label.length>200||item.area.length>200)return 'Revisa el nombre y la zona de cada concepto.';
      if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>100)return 'La cantidad debe ser un número entero entre 1 y 100.';
      if(item.unit_cents!==null&&(!Number.isSafeInteger(item.unit_cents)||item.unit_cents<0||item.unit_cents>999999999))return 'Revisa el precio: usa números positivos con hasta dos decimales.';
      if(approve&&item.unit_cents===null)return 'Completa todos los precios. Escribe 0 cuando un concepto no tenga costo.';
    }
    if(doc.valid_until){var d=new Date(doc.valid_until+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(doc.valid_until)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==doc.valid_until)return 'Revisa la fecha de vigencia.';}
    var today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Mexico_City'});
    if(approve&&(!doc.valid_until||doc.valid_until<today))return 'Indica una fecha de vigencia que no haya pasado.';
    if(approve&&!doc.terms.trim())return 'Aclara qué incluye el importe y las condiciones antes de aprobar.';
    return '';
  }
  function fromPlan(plan){return {schema:1,title:'Tu propuesta de tratamiento',introduction:'',terms:'',valid_until:'',items:(plan.document.treatments||[]).map(function(t){return {label:t.name,area:t.area||'',quantity:1,unit_cents:null};}),photos:null};}
  function safeImage(src){return typeof src==='string'&&(/^(blob:|data:image\/(png|jpeg|webp);base64,)/.test(src)||/^https:\/\//.test(src));}
  return {views:views,cents:cents,money:money,total:total,valid:valid,fromPlan:fromPlan,safeImage:safeImage};
});
