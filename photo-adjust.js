(function(){
'use strict';
var state=null,ready=false,pointers=new Map(),lastDistance=0,lastCenter=null;
function el(id){return document.getElementById(id);}
function frameAspect(st){
 if(st.full||st.view?.preserveAspect){var original=st.img.naturalWidth/st.img.naturalHeight;return st.quarter%2?1/original:original;}
 return st.view?.aspectRatio||(st.view?.orientation==='landscape'?4/3:4/5);
}
function cover(st,w,h){var a=(st.quarter*90+st.angle)*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));return Math.max((w*c+h*s)/st.img.naturalWidth,(w*s+h*c)/st.img.naturalHeight);}
function boundedPan(st,w,h,sc,x,y){
 var a=(st.quarter*90+st.angle)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
 var mx=Math.max(0,(st.img.naturalWidth*sc-w*Math.abs(c)-h*Math.abs(s))/2),my=Math.max(0,(st.img.naturalHeight*sc-w*Math.abs(s)-h*Math.abs(c))/2);
 var px=Math.max(-mx,Math.min(mx,c*x+s*y)),py=Math.max(-my,Math.min(my,-s*x+c*y));return{x:c*px-s*py,y:s*px+c*py};
}
function paintPhoto(st,canvas,x,y){
 var ctx=canvas.getContext('2d'),sc=cover(st,canvas.width,canvas.height)*st.zoom,pan=boundedPan(st,canvas.width,canvas.height,sc,x,y);
 ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(canvas.width/2+pan.x,canvas.height/2+pan.y);ctx.rotate((st.quarter*90+st.angle)*Math.PI/180);ctx.scale(sc,sc);ctx.drawImage(st.img,-st.img.naturalWidth/2,-st.img.naturalHeight/2);ctx.restore();return pan;
}
function drawGuides(st){
 if(!st.guides||st.full)return;var c=st.canvas,ctx=c.getContext('2d');ctx.save();ctx.lineWidth=1;
 if(st.view?.formatLabel){
  ctx.strokeStyle='rgba(255,255,255,.45)';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(c.width/2,0);ctx.lineTo(c.width/2,c.height);ctx.stroke();
  var lines=st.view.guide==='face'?[[.36,'Ojos'],[.68,'Sonrisa']]:[[.5,'Centro de la sonrisa']];
  lines.forEach(function(line){var y=c.height*line[0];ctx.strokeStyle='rgba(255,255,255,.65)';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();
   if(c.width>=170&&c.height>=140){ctx.font='10px sans-serif';var tw=ctx.measureText(line[1]).width;ctx.fillStyle='rgba(8,15,36,.7)';ctx.fillRect(6,y-18,tw+12,15);ctx.fillStyle='#fff';ctx.fillText(line[1],12,y-7);}
  });
 }else{ctx.strokeStyle='rgba(255,255,255,.52)';[1/3,2/3].forEach(function(p){ctx.beginPath();ctx.moveTo(c.width*p,0);ctx.lineTo(c.width*p,c.height);ctx.stroke();ctx.beginPath();ctx.moveTo(0,c.height*p);ctx.lineTo(c.width,c.height*p);ctx.stroke();});}
 ctx.setLineDash([]);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(1,1,c.width-2,c.height-2);ctx.restore();
}
function render(){if(!state)return;var pan=paintPhoto(state,state.canvas,state.x,state.y);state.x=pan.x;state.y=pan.y;drawGuides(state);if(el('photo-adjust-zoom'))el('photo-adjust-zoom').value=state.zoom;}
function fitCanvas(st){
 var stage=el('photo-adjust-stage'),mw=Math.max(1,stage.clientWidth-36),mh=Math.max(1,stage.clientHeight-36);
 var aspect=frameAspect(st);
 var w=mw,h=w/aspect;if(h>mh){h=mh;w=h*aspect;}
 var oldWidth=st.canvas.width||1,oldHeight=st.canvas.height||1;
 st.canvas.width=Math.max(1,Math.round(w));st.canvas.height=Math.max(1,Math.round(h));
 st.x*=st.canvas.width/oldWidth;st.y*=st.canvas.height/oldHeight;
}
function syncControls(){
 if(!state)return;var st=state,hasFormat=!!st.view?.formatLabel;
 el('photo-adjust-format').hidden=!hasFormat;el('photo-adjust').dataset.full=String(st.full);el('photo-adjust').dataset.format=st.full?'original':st.view?.ratioLabel||'legacy';
 el('photo-adjust-recommended').textContent=st.view?.formatLabel||'Encuadre recomendado';el('photo-adjust-recommended').setAttribute('aria-pressed',String(!st.full));el('photo-adjust-full').setAttribute('aria-pressed',String(st.full));
 el('photo-adjust-format-note').textContent=st.full?'Se conserva todo el encuadre. Puedes girar la foto.':'Ajusta dentro del marco sin cortar '+(st.view?.guide==='face'?'frente ni mentón.':'dientes ni encías.');
 el('photo-adjust-guides').hidden=!hasFormat;el('photo-adjust-guides').disabled=st.full;el('photo-adjust-guides').setAttribute('aria-pressed',String(st.guides&&!st.full));
 el('photo-adjust-zoom').disabled=st.full;el('photo-adjust-range').disabled=st.full;el('photo-adjust-range').value=st.angle;el('photo-adjust-angle').textContent=st.angle.toFixed(1).replace('.0','')+'°';
 el('photo-adjust-canvas').tabIndex=st.full?-1:0;
 document.querySelector('.photo-adjust-help').textContent=st.full?'Foto completa · sin recortar':'Arrastra para encuadrar · pellizca para ampliar';
}
function reset(){if(!state)return;state.quarter=0;state.angle=0;state.zoom=1;state.x=0;state.y=0;state.cropDraft=null;pointers.clear();syncControls();fitCanvas(state);render();}
function setFull(full){
 if(!state||state.full===full)return;var st=state;pointers.clear();lastDistance=0;lastCenter=null;
 if(full){st.cropDraft={quarter:st.quarter,angle:st.angle,zoom:st.zoom,x:st.x/st.canvas.width,y:st.y/st.canvas.height};st.angle=0;st.zoom=1;st.x=st.y=0;}
 st.full=full;
 if(!full&&st.cropDraft){st.quarter=st.cropDraft.quarter;st.angle=st.cropDraft.angle;st.zoom=st.cropDraft.zoom;}
 syncControls();fitCanvas(st);
 if(!full&&st.cropDraft){st.x=st.cropDraft.x*st.canvas.width;st.y=st.cropDraft.y*st.canvas.height;}
 render();
}
function exportPhoto(){
 var st=state;if(st.full&&st.quarter===0)return st.source;
 var aspect=frameAspect(st),out=document.createElement('canvas');out.width=aspect>=1?1280:Math.round(1280*aspect);out.height=aspect>=1?Math.round(1280/aspect):1280;
 // The output uses the exact target ratio, independent of rounded preview dimensions.
 if(st.full){var ctx=out.getContext('2d');ctx.translate(out.width/2,out.height/2);ctx.rotate(st.quarter*Math.PI/2);var scale=out.width/(st.quarter%2?st.img.naturalHeight:st.img.naturalWidth);ctx.scale(scale,scale);ctx.drawImage(st.img,-st.img.naturalWidth/2,-st.img.naturalHeight/2);}
 else paintPhoto(st,out,st.x*out.width/st.canvas.width,st.y*out.height/st.canvas.height);
 return out.toDataURL('image/jpeg',.92);
}
function close(value){var st=state;if(!st)return;el('photo-adjust').classList.remove('open');el('photo-adjust').dataset.ready='false';state=null;pointers.clear();lastDistance=0;lastCenter=null;st.resolve(value);}
function center(){var a=Array.from(pointers.values());return{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};}
function distance(){var a=Array.from(pointers.values());return Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}
function init(){
 if(ready)return;ready=true;var canvas=el('photo-adjust-canvas');
 canvas.addEventListener('pointerdown',function(e){
  if(!state||state.full||pointers.size>=2)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(canvas.setPointerCapture)canvas.setPointerCapture(e.pointerId);
  if(pointers.size===2){lastDistance=distance();lastCenter=center();}e.preventDefault();
 });
 canvas.addEventListener('pointermove',function(e){
  if(!state||state.full||!pointers.has(e.pointerId))return;
  var prev=pointers.get(e.pointerId),rect=canvas.getBoundingClientRect(),fx=canvas.width/rect.width,fy=canvas.height/rect.height;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===1){state.x+=(e.clientX-prev.x)*fx;state.y+=(e.clientY-prev.y)*fy;}
  else if(pointers.size===2){var d=distance(),c=center();if(lastDistance)state.zoom=Math.max(1,Math.min(5,state.zoom*d/lastDistance));if(lastCenter){state.x+=(c.x-lastCenter.x)*fx;state.y+=(c.y-lastCenter.y)*fy;}lastDistance=d;lastCenter=c;}
  render();e.preventDefault();
 });
 function end(e){pointers.delete(e.pointerId);lastDistance=0;lastCenter=null;}
 ['pointerup','pointercancel','lostpointercapture'].forEach(function(event){canvas.addEventListener(event,end);});
 el('photo-adjust-range').addEventListener('input',function(){if(!state||state.full)return;state.angle=Number(this.value)||0;el('photo-adjust-angle').textContent=state.angle.toFixed(1).replace('.0','')+'°';render();});
 el('photo-adjust-rotate').addEventListener('click',function(){if(!state)return;state.quarter=(state.quarter+1)%4;state.x=0;state.y=0;state.zoom=1;fitCanvas(state);render();});
 el('photo-adjust-reset').addEventListener('click',reset);
 el('photo-adjust-cancel').addEventListener('click',function(){close(null);});
 el('photo-adjust-use').addEventListener('click',function(){if(state)close(exportPhoto());});
 window.addEventListener('resize',function(){if(state){fitCanvas(state);render();}});
}
function extraControls(){if(el('photo-adjust-zoom'))return;var label=document.createElement('label'),zoom=document.createElement('input');label.textContent='Acercar / recortar';label.className='photo-adjust-zoom-label';zoom.id='photo-adjust-zoom';zoom.type='range';zoom.min=1;zoom.max=5;zoom.step=.05;zoom.value=1;zoom.setAttribute('aria-label','Acercar fotografía');label.append(zoom);document.querySelector('.photo-adjust-panel').prepend(label);zoom.oninput=function(){if(state&&!state.full){state.zoom=Number(this.value);render();}};
 var format=document.createElement('div');format.id='photo-adjust-format';format.className='photo-adjust-format';format.hidden=true;
 format.innerHTML='<div class="photo-adjust-format-options" role="group" aria-label="Encuadre de fotografía"><button type="button" id="photo-adjust-recommended"></button><button type="button" id="photo-adjust-full">Foto completa</button></div><p id="photo-adjust-format-note"></p>';
 document.querySelector('.photo-adjust-head').after(format);el('photo-adjust-recommended').onclick=function(){setFull(false);};el('photo-adjust-full').onclick=function(){setFull(true);};
 var guides=document.createElement('button');guides.id='photo-adjust-guides';guides.type='button';guides.textContent='Guías';guides.title='Mostrar guías de encuadre; no se guardan en la foto';guides.onclick=function(){if(state&&!state.full){state.guides=!state.guides;syncControls();render();}};document.querySelector('.photo-adjust-actions').append(guides);
 var canvas=el('photo-adjust-canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','Encuadre: usa las flechas para mover la foto');canvas.onkeydown=function(e){var moves={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};if(state&&!state.full&&moves[e.key]){e.preventDefault();state.x+=moves[e.key][0];state.y+=moves[e.key][1];render();}};
 el('photo-adjust').addEventListener('keydown',function(e){if(!state)return;if(e.key==='Escape'){e.preventDefault();close(null);}if(e.key==='Tab'){var controls=Array.from(el('photo-adjust').querySelectorAll('button,input,canvas')).filter(function(c){return !c.disabled&&c.tabIndex>=0&&c.getClientRects().length;}),i=controls.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();controls[controls.length-1].focus();}else if(!e.shiftKey&&i===controls.length-1){e.preventDefault();controls[0].focus();}}});
}
var loading=false;
window.ajustarFotoAntesDeGuardar=function(dataUrl,view){
 if(state||loading)return Promise.reject(new Error('Editor already open'));
 loading=true;
 return new Promise(function(resolve,reject){
  var img=new Image(),focus=document.activeElement,timer=setTimeout(function(){loading=false;img.onload=img.onerror=null;reject(new Error('Image timeout'));},15000);
  img.onload=function(){
   clearTimeout(timer);init();extraControls();
   var modal=el('photo-adjust'),stage=el('photo-adjust-stage'),canvas=el('photo-adjust-canvas'),controls=Array.from(modal.querySelectorAll('button,input'));
   modal.dataset.ready='false';controls.forEach(function(control){control.disabled=true;});
   el('photo-adjust-title').textContent='Ajustar '+((view&&view.label)||'fotografía').split('—')[0].trim().toLowerCase();
   el('photo-adjust-format').hidden=!view?.formatLabel;modal.dataset.full='false';
   modal.classList.add('open');
   requestAnimationFrame(function(){
    state={img:img,source:dataUrl,canvas:canvas,view:view,quarter:0,angle:0,zoom:1,x:0,y:0,full:false,guides:true,cropDraft:null,resolve:function(value){resolve(value);requestAnimationFrame(function(){if(focus?.isConnected)focus.focus();});}};
    controls.forEach(function(control){control.disabled=false;});reset();loading=false;modal.dataset.ready='true';el('photo-adjust-cancel').focus();
   });
  };
  img.onerror=function(){clearTimeout(timer);loading=false;reject(new Error('Image unavailable'));};img.src=dataUrl;
 });
};
})();
