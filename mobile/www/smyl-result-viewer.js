/* Read-only result inspection. Both layers share ONE transform.
 * No export, generation, network, or writes to case/photographic state.
 */
(function(){
 'use strict';
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const source=p=>p.dataUrl||'data:'+(p.mimeType||'image/jpeg')+';base64,'+p.b64;
 let active=null;
 function photo(){return S.photos.find(p=>p.view===S.baVistaActual&&S.results?.[p.view]);}
 function load(url){return new Promise((resolve,reject)=>{
  if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url||''))return reject(Error('Esta imagen no está disponible en el dispositivo.'));
  const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo abrir la fotografía.'));img.src=url;
 });}
 async function open(){
  const p=photo();if(active||!p||document.getElementById('ba-wrap').classList.contains('ba-regenerating')||!document.getElementById('s-res').classList.contains('active'))return;
  const original=source(p),result=S.results[p.view],owner=progressKey(),caseId=S.casoId,focus=document.activeElement;
  const current=()=>progressKey()===owner&&S.casoId===caseId&&photo()===p&&source(p)===original&&S.results[p.view]===result&&!document.getElementById('ba-wrap').classList.contains('ba-regenerating')&&document.getElementById('s-res').classList.contains('active');
  const d=document.createElement('dialog');d.className='rv-dialog';d.setAttribute('aria-labelledby','rv-title');active=d;
  d.innerHTML='<header><div><h2 id="rv-title">Explora tu simulación</h2><p>Acerca la sonrisa y compárala con la foto original.</p></div><button type="button" class="rv-close" aria-label="Cerrar vista ampliada">×</button></header><div class="rv-stage" tabindex="0" aria-label="Fotografías superpuestas. Pellizca para ampliar y arrastra para mover. Con teclado, usa más, menos y flechas."><div class="rv-images"><img class="rv-before" alt="Fotografía original" draggable="false"><img class="rv-after" alt="Simulación" draggable="false"></div><span class="rv-status" aria-live="polite">Simulación</span><div class="rv-loading" role="status">Abriendo fotografías…</div></div><footer class="rv-controls"><div class="rv-control"><label for="rv-zoom">Acercar <output id="rv-zoom-value">1×</output></label><input id="rv-zoom" type="range" min="1" max="4" step="0.05" value="1" disabled></div><div class="rv-control rv-blend-control"><label for="rv-blend">Desvanecer simulación <output id="rv-blend-value">100%</output></label><input id="rv-blend" type="range" min="0" max="100" step="1" value="100" disabled><div class="rv-ends"><span>Foto original</span><span>Simulación</span></div></div><button type="button" class="rv-reset" disabled>Restablecer vista</button><p>Pellizca para ampliar y arrastra para explorar. Solo cambia la visualización; tus fotos se conservan.</p></footer>';
  const $=s=>d.querySelector(s),stage=$('.rv-stage'),layers=$('.rv-images'),pointers=new Map();
  let ready=false,closed=false,zoom=1,blend=100,x=0,y=0,fw=1,fh=1,ratio=1,gesture=null;
  function close(){if(closed)return;closed=true;clearInterval(watch);resize.disconnect();pointers.clear();d.close();d.remove();active=null;focus?.focus({preventScroll:true});}
  function paint(){
   const maxX=Math.max(0,(fw*zoom-stage.clientWidth)/2),maxY=Math.max(0,(fh*zoom-stage.clientHeight)/2);
   x=clamp(x,-maxX,maxX);y=clamp(y,-maxY,maxY);layers.style.transform='translate('+x+'px,'+y+'px) scale('+zoom+')';
   $('.rv-after').style.opacity=blend/100;$('#rv-zoom').value=zoom;$('#rv-blend').value=blend;
   $('#rv-zoom-value').textContent=zoom.toFixed(2).replace(/\.?0+$/,'')+'×';$('#rv-blend-value').textContent=blend+'%';
   $('.rv-status').textContent=blend===0?'Foto original':blend===100?'Simulación':'Mezcla · '+blend+'% de simulación';
  }
  function fit(){if(!ready||closed)return;fw=Math.max(1,Math.min(stage.clientWidth,stage.clientHeight*ratio));fh=fw/ratio;layers.style.width=fw+'px';layers.style.height=fh+'px';layers.style.marginLeft=-fw/2+'px';layers.style.marginTop=-fh/2+'px';paint();}
  function zoomTo(value,px=0,py=0){const next=clamp(value,1,4),k=next/zoom;x=px-(px-x)*k;y=py-(py-y)*k;zoom=next;paint();}
  function local(event){const r=stage.getBoundingClientRect();return {x:event.clientX-r.left-r.width/2,y:event.clientY-r.top-r.height/2};}
  function startGesture(){
   const ps=[...pointers.values()];
   gesture=ps.length>=2?{type:'pinch',distance:Math.max(1,Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)),mx:(ps[0].x+ps[1].x)/2,my:(ps[0].y+ps[1].y)/2,zoom,x,y}:ps.length?{type:'pan',px:ps[0].x,py:ps[0].y,x,y}:null;
  }
  stage.onpointerdown=e=>{if(!ready||e.button>0)return;pointers.set(e.pointerId,local(e));stage.setPointerCapture(e.pointerId);startGesture();e.preventDefault();};
  stage.onpointermove=e=>{
   if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,local(e));const ps=[...pointers.values()];
   if(gesture.type==='pinch'&&ps.length>=2){const k=clamp(gesture.zoom*Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)/gesture.distance,1,4)/gesture.zoom;zoom=gesture.zoom*k;x=(ps[0].x+ps[1].x)/2-(gesture.mx-gesture.x)*k;y=(ps[0].y+ps[1].y)/2-(gesture.my-gesture.y)*k;}
   else if(gesture.type==='pan'&&ps.length===1){x=gesture.x+ps[0].x-gesture.px;y=gesture.y+ps[0].y-gesture.py;}
   paint();e.preventDefault();
  };
  stage.onpointerup=stage.onpointercancel=stage.onlostpointercapture=e=>{pointers.delete(e.pointerId);startGesture();};
  stage.addEventListener('wheel',e=>{if(!ready)return;e.preventDefault();const pt=local(e);zoomTo(zoom*Math.exp(-e.deltaY*.002),pt.x,pt.y);},{passive:false});
  stage.onkeydown=e=>{if(!ready)return;if(['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();else return;
   if(e.key==='+'||e.key==='=')zoomTo(zoom+.25);else if(e.key==='-')zoomTo(zoom-.25);else if(e.key==='0'){zoom=1;x=y=0;paint();}else{x+=e.key==='ArrowRight'?-24:e.key==='ArrowLeft'?24:0;y+=e.key==='ArrowDown'?-24:e.key==='ArrowUp'?24:0;paint();}
  };
  $('#rv-zoom').oninput=e=>{if(ready)zoomTo(+e.target.value);};$('#rv-blend').oninput=e=>{if(ready){blend=+e.target.value;paint();}};
  $('.rv-reset').onclick=()=>{zoom=1;blend=100;x=y=0;paint();};$('.rv-close').onclick=close;d.oncancel=e=>{e.preventDefault();close();};
  const resize=new ResizeObserver(fit),watch=setInterval(()=>{if(!current())close();},200);
  document.body.append(d);d.showModal();resize.observe(stage);
  try{
   const [before,after]=await Promise.all([load(original),load(result)]);if(closed)return;if(!current()){close();return;}
   $('.rv-before').src=before.src;$('.rv-after').src=after.src;ratio=before.naturalWidth/before.naturalHeight;ready=true;$('.rv-loading').hidden=true;
   d.querySelectorAll('input,.rv-reset').forEach(el=>el.disabled=false);fit();
  }catch(error){if(!closed){$('.rv-loading').textContent=error.message+' Cierra este visor para volver al resultado.';}}
 }
 function init(){
  const toolbar=document.createElement('div');toolbar.className='rv-launch';toolbar.id='rv-launch';toolbar.hidden=true;
  const button=document.createElement('button');button.type='button';button.className='flow-secondary';button.id='rv-open';button.textContent='Ampliar y desvanecer';button.onclick=open;toolbar.append(button);
  document.getElementById('ba-wrap').before(toolbar);
  const refresh=()=>{toolbar.hidden=!photo();button.disabled=!photo()||document.getElementById('ba-wrap').classList.contains('ba-regenerating');};
  const previous=window.renderControlCalidadSimulacion;window.renderControlCalidadSimulacion=function(){const r=previous.apply(this,arguments);refresh();return r;};
  new MutationObserver(refresh).observe(document.getElementById('ba-wrap'),{attributes:true,attributeFilter:['class']});refresh();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
