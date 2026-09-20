(function(root){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  const load=url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('No se pudo abrir la fotografía local.'));img.src=url;});
  let records=[];
  function regionOf(region={}) {
    const w=clamp(Number(region.w)||.72,.15,.92),h=clamp(Number(region.h)||.24,.06,.60);
    return {x:clamp(Number(region.x)||0,.04,.96-w),y:clamp(Number(region.y)||0,.04,.96-h),w,h};
  }
  function validateRegion(region,anchor) {
    region=regionOf(region);anchor=regionOf(anchor||region);
    const ix=Math.max(0,Math.min(region.x+region.w,anchor.x+anchor.w)-Math.max(region.x,anchor.x));
    const iy=Math.max(0,Math.min(region.y+region.h,anchor.y+anchor.h)-Math.max(region.y,anchor.y));
    const anchorCoverage=(ix*iy)/Math.max(.0001,anchor.w*anchor.h);
    const centerY=region.y+region.h/2,anchorCenterY=anchor.y+anchor.h/2;
    const safe=anchorCoverage>=.48&&Math.abs(centerY-anchorCenterY)<=Math.max(.13,anchor.h*.65);
    return {safe,anchorCoverage,reason:safe?'':'La zona se alejó de los dientes. Restablécela y cubre la arcada antes de continuar.'};
  }
  function opacity(x,y,region,w,h) {
    const dx=Math.min(x-region.x*w,(region.x+region.w)*w-x);
    const dy=Math.min(y-region.y*h,(region.y+region.h)*h-y);
    const edge=Math.max(2,Math.min(region.w*w,region.h*h)*.10);
    const t=clamp(Math.min(dx,dy)/edge,0,1);
    return t*t*(3-2*t);
  }
  function estimate(source,target,region) {
    const W=128,H=Math.max(48,Math.min(192,Math.round(W*source.height/source.width)));
    const gradients=img=>{
      const c=canvas(W,H),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,W,H);
      const p=g.getImageData(0,0,W,H).data,gray=new Float32Array(W*H),out=new Float32Array(W*H);
      for(let i=0;i<gray.length;i++)gray[i]=.299*p[i*4]+.587*p[i*4+1]+.114*p[i*4+2];
      for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const i=y*W+x;out[i]=Math.hypot(gray[i+1]-gray[i-1],gray[i+W]-gray[i-W]);}
      return out;
    };
    const a=gradients(source),b=gradients(target);
    const score=(dx,dy)=>{
      let sa=0,sb=0,saa=0,sbb=0,sab=0,n=0;
      for(let y=8;y<H-8;y+=2)for(let x=8;x<W-8;x+=2){
        if(x/W>region.x-.03&&x/W<region.x+region.w+.03&&y/H>region.y-.03&&y/H<region.y+region.h+.03)continue;
        const xx=x-dx,yy=y-dy;if(xx<2||xx>=W-2||yy<2||yy>=H-2)continue;
        const av=a[y*W+x],bv=b[yy*W+xx];sa+=av;sb+=bv;saa+=av*av;sbb+=bv*bv;sab+=av*bv;n++;
      }
      const va=saa-sa*sa/n,vb=sbb-sb*sb/n;
      return n>80&&va/n>4&&vb/n>4?(sab-sa*sb/n)/Math.sqrt(va*vb):-1;
    };
    const baseline=score(0,0);let best={dx:0,dy:0,score:baseline};
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const s=score(dx,dy);if(s>best.score)best={dx,dy,score:s};}
    const apply=best.score>.75&&best.score-baseline>.025;
    return {dx:apply?best.dx/W:0,dy:apply?best.dy/H:0,score:best.score,needsReview:best.score<.75||Math.abs(best.dx)===4||Math.abs(best.dy)===4};
  }
  function render(source,target,region,alignment={}) {
    const W=source.width,H=source.height,out=canvas(W,H),g=out.getContext('2d',{willReadFrequently:true});
    g.drawImage(source,0,0,W,H);const original=g.getImageData(0,0,W,H);
    const layer=canvas(W,H),lg=layer.getContext('2d',{willReadFrequently:true});
    lg.drawImage(target,clamp(alignment.dx||0,-.06,.06)*W,clamp(alignment.dy||0,-.06,.06)*H,W,H);
    const generated=lg.getImageData(0,0,W,H).data,px=original.data;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=(y*W+x)*4,t=opacity(x+.5,y+.5,region,W,H)*generated[i+3]/255;
      if(!t)continue;
      for(let k=0;k<3;k++)px[i+k]=Math.round(px[i+k]*(1-t)+generated[i+k]*t);
    }
    g.putImageData(original,0,0);return out;
  }
  async function prepare(originalUrl,rawUrl,rect,sourceCropUrl,initialRegion) {
    const [original,sourceImg,targetImg]=await Promise.all([load(originalUrl),load(sourceCropUrl),load(rawUrl)]);
    if(!rect||![rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)||rect.w<1||rect.h<1||rect.x<0||rect.y<0||rect.x+rect.w>original.width+.01||rect.y+rect.h>original.height+.01)throw new Error('El recorte no coincide con la fotografía original.');
    if(Math.abs((targetImg.width/targetImg.height)/(sourceImg.width/sourceImg.height)-1)>.03)throw new Error('El resultado cambió de formato. No se puede unir con seguridad.');
    if(![rect.x,rect.y,rect.w,rect.h].every(Number.isInteger))throw new Error('El recorte debe usar coordenadas enteras de la fotografía.');
    const source=canvas(rect.w,rect.h);source.getContext('2d').drawImage(original,rect.x,rect.y,rect.w,rect.h,0,0,rect.w,rect.h);
    const region=regionOf(initialRegion),alignment=estimate(source,targetImg,region);
    return {original,source,target:targetImg,rect:{...rect},region,initialRegion:{...region},alignment};
  }
  function compose(prepared) {
    const crop=render(prepared.source,prepared.target,prepared.region,prepared.alignment);
    const out=canvas(prepared.original.width,prepared.original.height),g=out.getContext('2d');g.drawImage(prepared.original,0,0);
    // Integer placement: no resampling of the protected original crop perimeter.
    g.drawImage(crop,Math.round(prepared.rect.x),Math.round(prepared.rect.y));
    return out.toDataURL('image/png');
  }
  async function adjust(prepared) {
    const working={...prepared,region:{...prepared.region},alignment:{...prepared.alignment}};
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='smyl-visual-dialog vc-dialog';
      dialog.innerHTML='<h2>Revisar zona localizada · sin IA</h2><p class="sv-description">SMYL posicionó la línea automáticamente sobre la sonrisa. Verifica que cubra la arcada y evita piel innecesaria; puedes corregirla manualmente si hace falta. Fuera de ella se conserva la foto original.</p><canvas class="vc-preview"></canvas><div class="vc-controls"></div><p class="vc-warning" role="alert" hidden></p><label class="sv-check"><input type="checkbox"><span>Revisé que la zona cubra los dientes, sus bordes y la unión con la encía. Es una revisión visual.</span></label><div class="sv-actions"><button data-action="cancel">Cancelar</button><button data-action="accept" disabled>Usar esta unión</button></div>';
      const preview=dialog.querySelector('canvas');preview.width=prepared.source.width;preview.height=prepared.source.height;
      const check=dialog.querySelector('input'),yes=dialog.querySelector('[data-action=accept]'),warning=dialog.querySelector('.vc-warning');
      const review=()=>{const validation=validateRegion(working.region,prepared.initialRegion||prepared.region);warning.hidden=validation.safe;warning.textContent=validation.reason;check.disabled=!validation.safe;if(!validation.safe)check.checked=false;yes.disabled=!validation.safe||!check.checked;return validation;};
      const redraw=()=>{const g=preview.getContext('2d');g.drawImage(render(working.source,working.target,working.region,working.alignment),0,0);const r=working.region,v=review();g.strokeStyle=v.safe?'#52e3bc':'#ff6b6b';g.lineWidth=Math.max(1,preview.width/450);g.strokeRect(r.x*preview.width,r.y*preview.height,r.w*preview.width,r.h*preview.height);};
      for(const [key,label,min,max,step] of [['x','Zona · posición horizontal',.04,.8,.002],['y','Zona · posición vertical',.04,.88,.002],['w','Zona · ancho',.15,.92,.002],['h','Zona · alto',.06,.6,.002],['dx','Alinear resultado · horizontal',-.06,.06,.001],['dy','Alinear resultado · vertical',-.06,.06,.001]]){
        const labelEl=document.createElement('label'),input=document.createElement('input');labelEl.textContent=label;input.type='range';input.min=min;input.max=max;input.step=step;input.value=(key.length===2?working.alignment:working.region)[key];input.setAttribute('aria-label',label);labelEl.append(input);dialog.querySelector('.vc-controls').append(labelEl);
        input.addEventListener('input',()=>{if(key.length===2)working.alignment[key]=+input.value;else{working.region=regionOf({...working.region,[key]:+input.value});input.value=working.region[key];}check.checked=false;yes.disabled=true;redraw();});
      }
      const previous=document.activeElement;
      const reset=document.createElement('button');reset.type='button';reset.textContent='Restablecer detección automática';dialog.querySelector('.sv-actions').prepend(reset);
      reset.onclick=()=>{working.region={...(prepared.initialRegion||prepared.region)};dialog.querySelectorAll('.vc-controls input').forEach((input,i)=>{const key=['x','y','w','h','dx','dy'][i];input.value=(key.length===2?working.alignment:working.region)[key];});check.checked=false;yes.disabled=true;redraw();};
      const close=value=>{dialog.close();dialog.remove();previous?.focus();resolve(value);};
      check.onchange=()=>{const v=review();yes.disabled=!v.safe||!check.checked;};yes.onclick=()=>{if(check.checked&&validateRegion(working.region,prepared.initialRegion||prepared.region).safe)close(working);};
      dialog.querySelector('[data-action=cancel]').onclick=()=>close(null);dialog.oncancel=e=>{e.preventDefault();close(null);};
      document.body.append(dialog);dialog.showModal();redraw();
    });
  }
  function remember(record) {
    if(!record.options||!['layered','monolithic'].includes(record.options.construction))return;
    // Keep only a pair from exactly the same source and non-material settings.
    if(record.options.mode==='alignment'||(record.options.mode==='combined'&&record.options.stage!=='finishing'))return;
    const key=JSON.stringify([record.options.shade,record.options.current,record.options.finish,record.options.intensity,record.options.mode||'veneers',record.options.arch||'upper',record.options.stage||'initial',record.options.instructions||'']);
    records=records.filter(r=>r.original===record.original&&r.key===key&&r.options.construction!==record.options.construction);
    records.push({...record,key});
  }
  async function compare(original) {
    const pair=records.filter(r=>r.original===original);
    if(pair.length!==2)throw new Error('Falta un par comparable. Genera y acepta cada acabado con la misma foto, tono, brillo e intensidad. Esta comparación no genera imágenes ni consume cupo.');
    pair.sort((a,b)=>a.options.construction==='layered'?-1:1);
    const images=await Promise.all(pair.map(r=>load(r.after))),rect=pair[0].rect;
    if(images.some(i=>i.width!==images[0].width||i.height!==images[0].height))throw new Error('Las imágenes no tienen el mismo tamaño.');
    const crops=images.map(img=>{const c=canvas(Math.round(rect.w),Math.round(rect.h));c.getContext('2d').drawImage(img,rect.x,rect.y,rect.w,rect.h,0,0,c.width,c.height);return c.toDataURL();});
    return new Promise(resolve=>{
      const d=document.createElement('dialog');d.className='smyl-visual-dialog';d.innerHTML='<h2>Comparar acabados</h2><p class="sv-description">Misma foto, mismo recorte, escala y ajustes de tono, brillo e intensidad. Compara profundidad, transición de color y borde incisal. Las etiquetas indican lo solicitado a la IA, no un material certificado.</p><div class="sv-comparison"></div><div class="sv-actions"><button>Cerrar</button></div>';
      crops.forEach((url,i)=>{const f=document.createElement('figure'),im=document.createElement('img'),cap=document.createElement('figcaption');im.src=url;cap.textContent=im.alt=i===0?'Estratificado':'Monolítico';f.append(im,cap);d.querySelector('.sv-comparison').append(f);});
      const previous=document.activeElement;const close=()=>{d.close();d.remove();previous?.focus();resolve();};d.querySelector('button').onclick=close;d.oncancel=e=>{e.preventDefault();close();};document.body.append(d);d.showModal();
    });
  }
  root.SmylVisualComposition={regionOf,validateRegion,opacity,estimate,render,prepare,compose,adjust,remember,compare,clear:()=>{records=[];}};
})(typeof window==='undefined'?globalThis:window);
