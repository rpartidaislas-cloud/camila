// Optional original photographs; loading never calls a generation service.
var CASE_VIEW_GROUPS=[
  {name:'Rostro y sonrisa',views:[['frontal','Frontal sonriendo'],['left','Perfil izquierdo'],['right','Perfil derecho'],['tresCuartos','Vista 3/4'],['extraoral','Detalle de sonrisa']]},
  {name:'Intraorales',views:[['intraoral','Frontal intraoral'],['intraoralLeft','Lateral intraoral izquierda'],['intraoralRight','Lateral intraoral derecha']]}
];
var optionalViewSelected=null,optionalViewBusy=false;
function renderVistasOpcionales(){
  var host=document.getElementById('optional-view-categories');if(!host)return;
  host.replaceChildren();
  CASE_VIEW_GROUPS.forEach(function(group){
    var title=document.createElement('h4');title.textContent=group.name;host.append(title);
    group.views.forEach(function(entry){
      var photo=S.photos.find(function(p){return p.view===entry[0];});
      var row=document.createElement('div');row.style.cssText='padding:12px;border:1px solid #485266;border-radius:12px;margin-bottom:10px';
      var label=document.createElement('p');label.textContent=entry[1]+(S.photos[0]?.view===entry[0]?' · Principal':'');row.append(label);
      if(photo&&(photo.dataUrl||photo.b64)){var img=document.createElement('img');img.src=photo.dataUrl||('data:'+(photo.mimeType||'image/jpeg')+';base64,'+photo.b64);img.alt=entry[1];img.style.cssText='display:block;width:100%;height:90px;object-fit:contain';row.append(img);}
      var button=document.createElement('button');button.type='button';button.className='advanced-entry-btn';button.textContent=photo?'Cambiar foto':'Tomar o cargar foto';button.disabled=optionalViewBusy;
      button.onclick=function(){optionalViewSelected=entry[0];document.getElementById('optional-view-file').click();};row.append(button);
      if(photo&&S.photos[0]!==photo){var remove=document.createElement('button');remove.type='button';remove.className='advanced-entry-btn';remove.textContent='Quitar';remove.disabled=optionalViewBusy;remove.onclick=function(){S.photos=S.photos.filter(function(p){return p!==photo;});invalidarVistaCargada(entry[0]);renderVistasOpcionales();actualizarReferenciaOpcional();saveProgress('s-vita');};row.append(remove);}
      host.append(row);
    });
  });
}
function invalidarVistaCargada(view){
  S.pendingGeneratedByView={};
  ['results','veneerBaseByView','visualCurrentByView','simulationQualityByView','alignedPreviewByView'].forEach(function(key){if(S[key])delete S[key][view];});
  if(S.dentalDesignMaster?.view===view)S.dentalDesignMaster=null;
}
async function cargarVistaOpcional(input){
  var file=input.files?.[0],view=optionalViewSelected;
  if(!file||optionalViewBusy||!CASE_VIEW_GROUPS.some(function(g){return g.views.some(function(v){return v[0]===view;});}))return;
  if(!fotoPropiaPermitida(file)){input.value='';mostrarAvisoAplicacion('Archivo no válido','Usa JPG, PNG o WebP de hasta 20 MB.');return;}
  optionalViewBusy=true;
  var controls=Array.from(document.querySelectorAll('#quick-config button'));var disabled=controls.map(function(b){return b.disabled;});controls.forEach(function(b){b.disabled=true;});
  try{
    var url=await leerFotoPropia(file),b64=await redimensionarFotoB64(url,1280,.92);
    var photo={view:view,b64:b64,mimeType:'image/jpeg'},index=S.photos.findIndex(function(p){return p.view===view;});
    if(index<0)S.photos.push(photo);else S.photos[index]=photo;
    invalidarVistaCargada(view);actualizarReferenciaOpcional();saveProgress('s-vita');
  }catch(error){mostrarAvisoAplicacion('No se pudo cargar','La foto anterior se conserva. Prueba otro archivo.');}
  finally{optionalViewBusy=false;input.value='';controls.forEach(function(b,i){b.disabled=disabled[i];});renderVistasOpcionales();}
}
