/* Manual photographic landmarks, not automatic segmentation or a clinical count. */
(function(root){
  'use strict';
  const clamp=n=>Math.max(0,Math.min(1,n));
  const arches=o=>o.arch==='both'?['upper','lower']:[o.arch==='lower'?'lower':'upper'];
  function validRow(row){
    return !!row && (row.uncertain===true || (Array.isArray(row.points)&&row.points.length>=2&&row.points.length<=17&&row.points.every((p,i,a)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1&&(!i||p.x-a[i-1].x>=.002))));
  }
  function valid(model,o){return model?.version===1&&model.coordinateSpace==='normalized-input-image'&&arches(o).every(a=>validRow(model[a]));}
  function instruction(model,o){
    if(!valid(model,o))return '';
    const rows=arches(o).map(arch=>{const r=model[arch];return r.uncertain?{arch,uncertain:true}:{arch,visibleIntervals:r.points.length-1,boundaries:r.points.map(p=>({x:+p.x.toFixed(4),y:+p.y.toFixed(4)}))};});
    return '\nMANUAL PHOTOGRAPHIC REVIEW: '+JSON.stringify(rows)+'. Coordinates are normalized to IMAGE 1, left to right as seen in the photograph. First and last points bound the reviewed visible span; interior points mark separations, not tooth centers. Use these manual landmarks as evidence of separate visible units; do not merge neighboring intervals or invent hidden teeth. They are approximate, not clinical segmentation, FDI identification, final crown widths or permission to alter tissues. Uncertain arches have NO confirmed count: preserve ambiguous evidence instead of inventing anatomy. Do not draw markers in the output. Photographic evidence and protected tissue take priority over inaccurate manual marks.';
  }
  async function open(input,options={}){
    const img=new Image();await new Promise((yes,no)=>{img.onload=yes;img.onerror=()=>no(new Error('No se pudo abrir la fotografía para revisar los dientes.'));img.src=input.dataUrl;});
    return new Promise(resolve=>{
      const previous=document.activeElement, dialog=document.createElement('dialog');dialog.className='dr-dialog';
      dialog.innerHTML='<h2>Revisa los dientes visibles</h2><p>Marca los dos extremos de la arcada visible y después cada separación entre dientes. No marques centros ni adivines piezas ocultas. Las marcas son una guía manual, no una garantía de anatomía.</p><p class="dr-reference"></p><div class="dr-tabs"></div><div class="dr-tools"><button data-do="locate">Reencuadrar boca</button><button data-do="remove">Quitar marca seleccionada</button><button data-do="clear">Limpiar esta arcada</button></div><p class="dr-help" aria-live="polite"></p><canvas tabindex="0" aria-label="Fotografía: toca para añadir una separación; arrastra para moverla"></canvas><p class="dr-count" aria-live="polite"></p><div class="dr-nudge"><span>Mover marca:</span><button data-dx="-1" aria-label="Mover marca a la izquierda">←</button><button data-dx="1" aria-label="Mover marca a la derecha">→</button><button data-dy="-1" aria-label="Mover marca arriba">↑</button><button data-dy="1" aria-label="Mover marca abajo">↓</button></div><label><input class="dr-uncertain" type="checkbox"> No distingo bien esta arcada: continuar sin confirmar su número de dientes</label><label><input class="dr-confirm" type="checkbox"> Revisé ambas opciones: las marcas visibles o la incertidumbre de cada arcada seleccionada</label><p>Sin intraoral no se puede conocer la anatomía oculta. Incluso con referencia, esta revisión no valida correspondencia exacta entre vistas.</p><footer><button data-do="cancel">Volver sin generar</button><button data-do="accept" disabled>Continuar a autorización</button></footer>';
      dialog.querySelector('.dr-reference').textContent=options.masterGuide?'Hay una referencia del caso; estas marcas corresponden solo a la fotografía que se va a editar.':'Revisión de esta fotografía. No hay una referencia adicional en este envío.';
      const model={version:1,coordinateSpace:'normalized-input-image'}, activeArches=arches(options);
      activeArches.forEach(a=>model[a]={points:[],uncertain:false});
      let arch=activeArches[0],selected=null,drag=null,locating=false;
      const region=input.mouthRegion;
      let crop=region&&region.w>0&&region.h>0?{x:clamp(region.x-region.w*.15),y:clamp(region.y-region.h*.3),w:Math.min(1,region.w*1.3),h:Math.min(1,region.h*1.6)}:{x:0,y:0,w:1,h:1};
      const canvas=dialog.querySelector('canvas'),g=canvas.getContext('2d'),confirm=dialog.querySelector('.dr-confirm'),uncertain=dialog.querySelector('.dr-uncertain'),yes=dialog.querySelector('[data-do=accept]');
      function invalidate(){confirm.checked=false;yes.disabled=true;}
      function draw(){
        crop.w=Math.min(crop.w,1-crop.x);crop.h=Math.min(crop.h,1-crop.y);
        canvas.width=1000;canvas.height=Math.max(100,Math.round(1000*img.naturalHeight*crop.h/(img.naturalWidth*crop.w)));
        g.drawImage(img,crop.x*img.naturalWidth,crop.y*img.naturalHeight,crop.w*img.naturalWidth,crop.h*img.naturalHeight,0,0,canvas.width,canvas.height);
        for(const a of activeArches){if(model[a].uncertain)continue;model[a].points.forEach((p,i)=>{const x=(p.x-crop.x)/crop.w*canvas.width,y=(p.y-crop.y)/crop.h*canvas.height;g.strokeStyle=a===arch?'#56efd0':'#bfa8ff';g.fillStyle=g.strokeStyle;g.lineWidth=p===selected?6:3;g.beginPath();g.moveTo(x,y-22);g.lineTo(x,y+22);g.stroke();g.beginPath();g.arc(x,y,p===selected?10:6,0,Math.PI*2);g.fill();g.font='bold 22px sans-serif';g.fillText(String(i+1),x+10,y-12);});}
        uncertain.checked=model[arch].uncertain;
        dialog.querySelector('.dr-count').textContent=activeArches.map(a=>(a==='upper'?'Superior':'Inferior')+': '+(model[a].uncertain?'sin conteo confirmado':model[a].points.length<2?'faltan los extremos':(model[a].points.length-1)+' intervalos visibles marcados')).join(' · ');
        dialog.querySelector('.dr-help').textContent=locating?'Toca el centro de la boca para ampliarla.':(model[arch].uncertain?'Esta arcada está marcada como incierta. Desmarca la opción para editar.':'Arcada '+(arch==='upper'?'superior':'inferior')+': toca para añadir; arrastra una marca para corregir.');
        dialog.querySelector('[data-do=remove]').disabled=!selected;yes.disabled=!confirm.checked||!valid(model,options);
      }
      function point(e){const r=canvas.getBoundingClientRect();return{x:clamp(crop.x+(e.clientX-r.left)/r.width*crop.w),y:clamp(crop.y+(e.clientY-r.top)/r.height*crop.h)};}
      function sorted(){model[arch].points.sort((a,b)=>a.x-b.x);}
      canvas.onpointerdown=e=>{if(e.button&&e.button!==0)return;const p=point(e);
        if(locating){crop={x:Math.max(0,Math.min(.6,p.x-.2)),y:Math.max(0,Math.min(.8,p.y-.1)),w:.4,h:.2};locating=false;draw();return;}
        if(model[arch].uncertain)return;
        const r=canvas.getBoundingClientRect();selected=model[arch].points.find(q=>Math.hypot((q.x-p.x)/crop.w*r.width,(q.y-p.y)/crop.h*r.height)<22)||null;
        if(!selected&&model[arch].points.length<17){selected=p;model[arch].points.push(p);}
        if(selected){drag=selected;canvas.setPointerCapture(e.pointerId);invalidate();sorted();draw();}
      };
      canvas.onpointermove=e=>{if(drag){Object.assign(drag,point(e));invalidate();sorted();draw();}};
      canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
      function nudge(dx,dy){if(selected){selected.x=clamp(selected.x+dx*crop.w*.005);selected.y=clamp(selected.y+dy*crop.h*.01);invalidate();sorted();draw();}}
      canvas.onkeydown=e=>{const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(d){e.preventDefault();nudge(...d);}};
      dialog.querySelectorAll('[data-dx],[data-dy]').forEach(b=>b.onclick=()=>nudge(Number(b.dataset.dx)||0,Number(b.dataset.dy)||0));
      activeArches.forEach(a=>{const b=document.createElement('button');b.textContent=a==='upper'?'Superiores':'Inferiores';b.setAttribute('aria-pressed',String(a===arch));b.onclick=()=>{arch=a;selected=null;dialog.querySelectorAll('.dr-tabs button').forEach(t=>t.setAttribute('aria-pressed',String(t===b)));draw();};dialog.querySelector('.dr-tabs').append(b);});
      uncertain.onchange=()=>{model[arch].uncertain=uncertain.checked;selected=null;invalidate();draw();};confirm.onchange=draw;
      dialog.querySelector('[data-do=remove]').onclick=()=>{model[arch].points=model[arch].points.filter(p=>p!==selected);selected=null;invalidate();draw();};
      dialog.querySelector('[data-do=clear]').onclick=()=>{model[arch]={points:[],uncertain:false};selected=null;invalidate();draw();};
      dialog.querySelector('[data-do=locate]').onclick=()=>{locating=true;crop={x:0,y:0,w:1,h:1};draw();};
      function close(value){dialog.close();dialog.remove();previous?.focus();resolve(value);}
      yes.onclick=()=>{if(confirm.checked&&valid(model,options))close(model);};dialog.querySelector('[data-do=cancel]').onclick=()=>close(null);
      dialog.oncancel=e=>{e.preventDefault();close(null);};document.body.append(dialog);dialog.showModal();draw();dialog.querySelector('[data-do=locate]').focus();
    });
  }
  root.SmylDentalReview={open,valid,validRow,instruction};
})(typeof window==='undefined'?globalThis:window);
