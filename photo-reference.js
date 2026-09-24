(function(root){
  'use strict';
  const names={frontal:'Frontal',intraoral:'Intraoral',extraoral:'Extraoral',right:'Lateral derecho',left:'Lateral izquierdo',tresCuartos:'Vista 3/4'};
  function defaultView(photos){return (photos.find(p=>p.view==='intraoral')||photos.find(p=>p.view==='frontal')||photos[0]||{}).view||null;}
  async function choose(photos){
    if(photos.length<2)return defaultView(photos);
    return new Promise(resolve=>{
      const d=document.createElement('dialog');d.style.cssText='box-sizing:border-box;font:16px/1.5 system-ui;max-width:560px;width:90vw;max-height:85dvh;overflow:auto;background:#101b26;color:white;border:1px solid #456070;border-radius:16px;padding:20px';
      const title=document.createElement('h2');title.textContent='Diseño con varias vistas';d.append(title);
      const p=document.createElement('p');p.textContent='Elige la foto más clara como referencia. La intraoral es opcional. Cada generación requiere tu autorización; las vistas no permiten conocer con exactitud la anatomía oculta.';d.append(p);
      const select=document.createElement('select');select.setAttribute('aria-label','Fotografía de referencia');select.style.cssText='width:100%;padding:12px;font:inherit';
      photos.forEach(photo=>{const o=document.createElement('option');o.value=photo.view;o.textContent=names[photo.view]||photo.view;select.append(o);});select.value=defaultView(photos);d.append(select);
      const img=document.createElement('img');img.alt='Fotografía de referencia seleccionada';img.style.cssText='display:block;max-width:100%;max-height:38dvh;margin:16px auto';d.append(img);
      function update(){const photo=photos.find(p=>p.view===select.value);img.src=photo.dataUrl||('data:'+(photo.mimeType||'image/jpeg')+';base64,'+photo.b64);}select.onchange=update;update();
      function close(value){d.close();d.remove();resolve(value);}
      for(const [label,accept] of [['Volver',false],['Usar como referencia',true]]){const b=document.createElement('button');b.textContent=label;b.style.cssText='padding:12px;margin:8px;font:inherit';b.onclick=()=>close(accept?select.value:null);d.append(b);}
      d.oncancel=e=>{e.preventDefault();close(null);};document.body.append(d);d.showModal();
    });
  }
  function independent(){return root.confirm('La referencia seleccionada no está disponible. ¿Continuar como simulación independiente? No se garantiza coincidencia entre vistas. La siguiente generación pedirá tu autorización y puede consumir cupo.');}
  root.SmylPhotoReference={defaultView,choose,independent};
})(typeof window==='undefined'?globalThis:window);
