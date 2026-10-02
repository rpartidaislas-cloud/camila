(function(){
'use strict';
var state=null,ready=false,pointers=new Map(),lastDistance=0,lastCenter=null;
function el(id){return document.getElementById(id);}
function cover(st){var a=(st.quarter*90+st.angle)*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));return Math.max((st.canvas.width*c+st.canvas.height*s)/st.img.naturalWidth,(st.canvas.width*s+st.canvas.height*c)/st.img.naturalHeight);}
function render(grid){if(!state)return;var st=state,c=st.canvas,ctx=c.getContext('2d'),a=(st.quarter*90+st.angle)*Math.PI/180;st.cover=cover(st);var sc=st.cover*st.zoom,bw=(Math.abs(st.img.naturalWidth*Math.cos(a))+Math.abs(st.img.naturalHeight*Math.sin(a)))*sc,bh=(Math.abs(st.img.naturalWidth*Math.sin(a))+Math.abs(st.img.naturalHeight*Math.cos(a)))*sc,mx=Math.max(0,(bw-c.width)/2),my=Math.max(0,(bh-c.height)/2);st.x=Math.max(-mx,Math.min(mx,st.x));st.y=Math.max(-my,Math.min(my,st.y));ctx.fillStyle='#000';ctx.fillRect(0,0,c.width,c.height);ctx.save();ctx.translate(c.width/2+st.x,c.height/2+st.y);ctx.rotate(a);ctx.scale(sc,sc);ctx.drawImage(st.img,-st.img.naturalWidth/2,-st.img.naturalHeight/2);ctx.restore();if(grid!==false){ctx.strokeStyle='rgba(255,255,255,.52)';ctx.lineWidth=1;[1/3,2/3].forEach(function(p){ctx.beginPath();ctx.moveTo(c.width*p,0);ctx.lineTo(c.width*p,c.height);ctx.stroke();ctx.beginPath();ctx.moveTo(0,c.height*p);ctx.lineTo(c.width,c.height*p);ctx.stroke();});ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(1,1,c.width-2,c.height-2);}}
function fitCanvas(st){
 var stage=el('photo-adjust-stage'),mw=Math.max(80,stage.clientWidth-36),mh=Math.max(80,stage.clientHeight-36);
 var aspect=st.view?.preserveAspect?st.img.naturalWidth/st.img.naturalHeight:st.view?.orientation==='landscape'?4/3:4/5;
 if(st.view?.preserveAspect&&st.quarter%2)aspect=1/aspect;
 var w=mw,h=w/aspect;if(h>mh){h=mh;w=h*aspect;}
 var oldWidth=st.canvas.width||1,oldHeight=st.canvas.height||1;
 st.canvas.width=Math.max(1,Math.round(w));st.canvas.height=Math.max(1,Math.round(h));
 st.x*=st.canvas.width/oldWidth;st.y*=st.canvas.height/oldHeight;
}
function reset(){if(!state)return;state.quarter=0;state.angle=0;state.zoom=1;state.x=0;state.y=0;fitCanvas(state);el('photo-adjust-range').value=0;el('photo-adjust-angle').textContent='0°';render();}
function exportPhoto(){var st=state,aspect=st.canvas.width/st.canvas.height,ow=aspect>=1?1280:Math.round(1280*aspect),oh=aspect>=1?Math.round(1280/aspect):1280,f=ow/st.canvas.width,out=document.createElement('canvas'),ctx=out.getContext('2d'),a=(st.quarter*90+st.angle)*Math.PI/180,sc=st.cover*st.zoom*f;out.width=ow;out.height=oh;ctx.fillStyle='#000';ctx.fillRect(0,0,ow,oh);ctx.save();ctx.translate(ow/2+st.x*f,oh/2+st.y*f);ctx.rotate(a);ctx.scale(sc,sc);ctx.drawImage(st.img,-st.img.naturalWidth/2,-st.img.naturalHeight/2);ctx.restore();return out.toDataURL('image/jpeg',.92);}
function close(value){var st=state;if(!st)return;el('photo-adjust').classList.remove('open');el('photo-adjust').dataset.ready='false';state=null;pointers.clear();lastDistance=0;lastCenter=null;st.resolve(value);}
function center(){var a=Array.from(pointers.values());return{x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2};}
function distance(){var a=Array.from(pointers.values());return Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}
function init(){
 if(ready)return;ready=true;var canvas=el('photo-adjust-canvas');
 canvas.addEventListener('pointerdown',function(e){
  if(!state||pointers.size>=2)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(canvas.setPointerCapture)canvas.setPointerCapture(e.pointerId);
  if(pointers.size===2){lastDistance=distance();lastCenter=center();}e.preventDefault();
 });
 canvas.addEventListener('pointermove',function(e){
  if(!state||!pointers.has(e.pointerId))return;
  var prev=pointers.get(e.pointerId),rect=canvas.getBoundingClientRect(),fx=canvas.width/rect.width,fy=canvas.height/rect.height;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===1){state.x+=(e.clientX-prev.x)*fx;state.y+=(e.clientY-prev.y)*fy;}
  else if(pointers.size===2){var d=distance(),c=center();if(lastDistance)state.zoom=Math.max(1,Math.min(5,state.zoom*d/lastDistance));if(lastCenter){state.x+=(c.x-lastCenter.x)*fx;state.y+=(c.y-lastCenter.y)*fy;}lastDistance=d;lastCenter=c;}
  render();e.preventDefault();
 });
 function end(e){pointers.delete(e.pointerId);lastDistance=0;lastCenter=null;}
 ['pointerup','pointercancel','lostpointercapture'].forEach(function(event){canvas.addEventListener(event,end);});
 el('photo-adjust-range').addEventListener('input',function(){if(!state)return;state.angle=Number(this.value)||0;el('photo-adjust-angle').textContent=state.angle.toFixed(1).replace('.0','')+'°';render();});
 el('photo-adjust-rotate').addEventListener('click',function(){if(!state)return;state.quarter=(state.quarter+1)%4;state.x=0;state.y=0;state.zoom=1;fitCanvas(state);render();});
 el('photo-adjust-reset').addEventListener('click',reset);
 el('photo-adjust-cancel').addEventListener('click',function(){close(null);});
 el('photo-adjust-use').addEventListener('click',function(){if(state)close(exportPhoto());});
 window.addEventListener('resize',function(){if(state){fitCanvas(state);render();}});
}
var originalRender=render;
render=function(grid){if(!state)return;var st=state,a=(st.quarter*90+st.angle)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),sc=cover(st)*st.zoom,w=st.canvas.width,h=st.canvas.height;
 var mx=Math.max(0,(st.img.naturalWidth*sc-w*Math.abs(c)-h*Math.abs(s))/2),my=Math.max(0,(st.img.naturalHeight*sc-w*Math.abs(s)-h*Math.abs(c))/2),x=Math.max(-mx,Math.min(mx,c*st.x+s*st.y)),y=Math.max(-my,Math.min(my,-s*st.x+c*st.y));st.x=c*x-s*y;st.y=s*x+c*y;originalRender(grid);if(el('photo-adjust-zoom'))el('photo-adjust-zoom').value=st.zoom;};
function extraControls(){if(el('photo-adjust-zoom'))return;var label=document.createElement('label'),zoom=document.createElement('input');label.textContent='Acercar / recortar';label.className='photo-adjust-zoom-label';zoom.id='photo-adjust-zoom';zoom.type='range';zoom.min=1;zoom.max=5;zoom.step=.05;zoom.value=1;zoom.setAttribute('aria-label','Acercar fotografía');label.append(zoom);document.querySelector('.photo-adjust-panel').prepend(label);zoom.oninput=function(){if(state){state.zoom=Number(this.value);render();}};
 var canvas=el('photo-adjust-canvas');canvas.tabIndex=0;canvas.setAttribute('aria-label','Encuadre: usa las flechas para mover la foto');canvas.onkeydown=function(e){var moves={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};if(state&&moves[e.key]){e.preventDefault();state.x+=moves[e.key][0];state.y+=moves[e.key][1];render();}};
 el('photo-adjust').addEventListener('keydown',function(e){if(!state)return;if(e.key==='Escape'){e.preventDefault();close(null);}if(e.key==='Tab'){var controls=Array.from(el('photo-adjust').querySelectorAll('button,input,canvas')),i=controls.indexOf(document.activeElement);if(e.shiftKey&&i<=0){e.preventDefault();controls[controls.length-1].focus();}else if(!e.shiftKey&&i===controls.length-1){e.preventDefault();controls[0].focus();}}});
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
   modal.classList.add('open');
   requestAnimationFrame(function(){
    var mw=Math.max(80,stage.clientWidth-36),mh=Math.max(80,stage.clientHeight-36),aspect=view?.preserveAspect?img.naturalWidth/img.naturalHeight:(view&&view.orientation==='landscape')?4/3:4/5,w=mw,h=w/aspect;
    if(h>mh){h=mh;w=h*aspect;}
    canvas.width=Math.max(1,Math.round(w));canvas.height=Math.max(1,Math.round(h));
    state={img:img,canvas:canvas,view:view,quarter:0,angle:0,zoom:1,x:0,y:0,cover:1,resolve:function(value){resolve(value);requestAnimationFrame(function(){if(focus?.isConnected)focus.focus();});}};
    reset();loading=false;controls.forEach(function(control){control.disabled=false;});modal.dataset.ready='true';el('photo-adjust-cancel').focus();
   });
  };
  img.onerror=function(){clearTimeout(timer);loading=false;reject(new Error('Image unavailable'));};img.src=dataUrl;
 });
};
})();
