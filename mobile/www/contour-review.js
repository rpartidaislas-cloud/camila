/* Local-only review. No image upload, persistence or generation in this module. */
(function(root){
  'use strict';
  const ids=['13','12','11','21','22','23'];
  const labels=['Canino 13','Lateral 12','Central 11','Central 21','Lateral 22','Canino 23'];
  function trace(ctx,points){
    ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
    points.forEach((p,i)=>{const a=points[(i+7)%8],b=points[(i+1)%8],c=points[(i+2)%8];
      ctx.bezierCurveTo(p.x+(b.x-a.x)/6,p.y+(b.y-a.y)/6,b.x-(c.x-p.x)/6,b.y-(c.y-p.y)/6,b.x,b.y);
    });ctx.closePath();
  }
  function cross(a,b,c){return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
  function sample(p){
    const out=[];
    p.forEach((b,i)=>{const a=p[(i+7)%8],c=p[(i+1)%8],d=p[(i+2)%8];
      for(let k=0;k<8;k++){const t=k/8,t2=t*t,t3=t2*t;
        const axis=q=>.5*((2*b[q])+(-a[q]+c[q])*t+(2*a[q]-5*b[q]+4*c[q]-d[q])*t2+(-a[q]+3*b[q]-3*c[q]+d[q])*t3);
        out.push({x:axis('x'),y:axis('y')});}
    });return out;
  }
  function intersects(a,b,c,d){return cross(a,b,c)*cross(a,b,d)<-1e-14&&cross(c,d,a)*cross(c,d,b)<-1e-14;}
  function inside(p,poly){
    let yes=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];
      if(Math.abs(cross(a,b,p))<1e-10&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x)&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y))return false;
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;
    }return yes;
  }
  function validTooth(t){
    if(!t||!Array.isArray(t.points)||t.points.length!==8)return false;
    const p=t.points;
    if(p.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<0||q.x>1||q.y<0||q.y>1))return false;
    const width=Math.max(...p.map(q=>q.x))-Math.min(...p.map(q=>q.x));
    const height=Math.max(...p.map(q=>q.y))-Math.min(...p.map(q=>q.y));
    if(width<.003||height<.003)return false;
    // Control-polygon crossings are invalid; this is not anatomical validation.
    for(let i=0;i<8;i++)for(let j=i+2;j<8;j++){
      if(i===0&&j===7)continue;
      const a=p[i],b=p[(i+1)%8],c=p[j],d=p[(j+1)%8];
      if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&
        Math.max(a.x,b.x)>=Math.min(c.x,d.x)&&Math.max(c.x,d.x)>=Math.min(a.x,b.x)&&
        Math.max(a.y,b.y)>=Math.min(c.y,d.y)&&Math.max(c.y,d.y)>=Math.min(a.y,b.y))return false;
    }
    const curve=sample(p);
    if(curve.some(q=>q.x<0||q.x>1||q.y<0||q.y>1))return false;
    for(let i=0;i<curve.length;i++)for(let j=i+2;j<curve.length;j++){
      if(intersects(curve[i],curve[(i+1)%curve.length],curve[j],curve[(j+1)%curve.length]))return false;
    }
    return true;
  }
  function valid(model){
    if(!(model&&model.version===1&&model.teeth&&model.teeth.length===6&&model.teeth.every((t,i)=>t.id===ids[i]&&validTooth(t))))return false;
    const curves=model.teeth.map(t=>sample(t.points));
    for(let i=0;i<6;i++)for(let j=i+1;j<6;j++){
      const a=curves[i],b=curves[j];
      if(a.some(p=>inside(p,b))||b.some(p=>inside(p,a)))return false;
      const center=a.reduce((p,q)=>({x:p.x+q.x/a.length,y:p.y+q.y/a.length}),{x:0,y:0});
      if(inside(center,b))return false;
      for(let k=0;k<a.length;k++)for(let l=0;l<b.length;l++)if(intersects(a[k],a[(k+1)%a.length],b[l],b[(l+1)%b.length]))return false;
    }return true;
  }
  function move(model,tooth,point,x,y){
    model.teeth[tooth].points[point]={x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
  }
  let busy=false;
  async function review({imageUrl,model,detectionOnly=false}){
    if(busy)throw new Error('Ya hay una revisión de contornos abierta.');
    if(!model||!model.teeth||model.teeth.length!==6)throw new Error('Faltan seis contornos para revisar.');
    busy=true;
    const draft=JSON.parse(JSON.stringify(model)),initial=JSON.parse(JSON.stringify(model));
    const reviewed=Array(6).fill(false);let selected=0,handle=0,zoom=false,drag=false;
    const img=new Image();
    try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('No se pudo abrir la foto para revisar contornos.'));img.src=imageUrl;});}
    catch(e){busy=false;throw e;}
    return new Promise((resolve,reject)=>{
      const dialog=document.createElement('dialog');dialog.className='smyl-contour-review';
      dialog.setAttribute('aria-labelledby','scr-title');
      dialog.innerHTML=`<h2 id="scr-title">Revisa los contornos antes de generar</h2>
        <p>Son una propuesta automática, no límites exactos detectados. Ajusta cada línea a la unión con la encía, los lados y el borde inferior. No incluyas encía ni dientes inferiores.</p>
        <div class="scr-teeth" aria-label="Seleccionar diente"></div>
        <div class="scr-layout"><div><canvas aria-label="Foto original con contornos ajustables"></canvas>
        <button type="button" data-action="zoom">Ampliar diente</button><button type="button" data-action="reset">Restablecer este diente</button></div>
        <div><p><strong data-role="tooth"></strong> · arrastra sus puntos o usa los controles.</p>
        <label>Punto <select aria-label="Punto del contorno">${['Superior izquierdo','Superior central','Superior derecho','Lateral derecho','Inferior derecho','Inferior central','Inferior izquierdo','Lateral izquierdo'].map((s,i)=>`<option value="${i}">${s}</option>`).join('')}</select></label>
        <div class="scr-arrows"><button type="button" data-dx="-1" data-dy="0" aria-label="Mover punto a la izquierda">←</button><button type="button" data-dx="0" data-dy="-1" aria-label="Subir punto">↑</button><button type="button" data-dx="0" data-dy="1" aria-label="Bajar punto">↓</button><button type="button" data-dx="1" data-dy="0" aria-label="Mover punto a la derecha">→</button></div>
        <button type="button" data-action="review">Confirmar este diente y seguir</button>
        <p data-role="status" role="status" aria-live="polite"></p>
        <p>Confirmar es una revisión visual, no una certificación de precisión. Si no distingues el borde, cancela y utiliza una foto más clara.</p></div></div>
        <footer><button type="button" data-action="cancel">Cancelar sin generar</button><button type="button" data-action="continue" disabled>Continuar con estos contornos</button></footer>
        <p class="scr-note">Esta revisión es local y no envía fotos. El análisis previo puede haber usado el servicio. Al continuar se retoma la generación, que puede consumir cupo.</p>`;
      document.body.appendChild(dialog);
      if(detectionOnly){
        dialog.querySelector('h2').textContent='Prueba local de bordes originales';
        dialog.querySelector('[data-action="continue"]').textContent='Terminar revisión sin generar';
        dialog.querySelector('.scr-note').textContent='Prueba local: no se envía la foto ni se llama a la IA. Los ajustes de esta prueba no se transfieren a la simulación.';
      }
      const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d'),select=dialog.querySelector('select');
      canvas.width=1000;canvas.height=Math.max(180,Math.round(1000*img.naturalHeight/img.naturalWidth));
      let view={x:0,y:0,w:1,h:1};
      const buttons=ids.map((id,i)=>{const b=document.createElement('button');b.type='button';b.onclick=()=>{selected=i;draw();};dialog.querySelector('.scr-teeth').appendChild(b);return b;});
      function pos(p){return {x:(p.x-view.x)/view.w*canvas.width,y:(p.y-view.y)/view.h*canvas.height};}
      function draw(){
        view={x:0,y:0,w:1,h:1};
        if(zoom){const p=initial.teeth[selected].points,xs=p.map(q=>q.x),ys=p.map(q=>q.y);
          const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
          const h=Math.min(1,Math.max(.12,(Math.max(...ys)-Math.min(...ys))*1.7));
          const w=Math.min(1,Math.max(h,(Math.max(...xs)-Math.min(...xs))*1.7));
          // Same fraction on each axis preserves the source-image aspect ratio.
          const size=Math.max(w,h);view={x:Math.max(0,Math.min(1-size,cx-size/2)),y:Math.max(0,Math.min(1-size,cy-size/2)),w:size,h:size};
        }
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,view.x*img.naturalWidth,view.y*img.naturalHeight,view.w*img.naturalWidth,view.h*img.naturalHeight,0,0,canvas.width,canvas.height);
        draft.teeth.forEach((t,i)=>{const p=t.points.map(pos);trace(ctx,p);ctx.strokeStyle=i===selected?'#36efd0':reviewed[i]?'#e7bc62':'#fff';ctx.lineWidth=i===selected?3:2;ctx.stroke();
          if(i===selected)p.forEach((q,j)=>{ctx.beginPath();ctx.arc(q.x,q.y,j===handle?9:7,0,Math.PI*2);ctx.fillStyle=t.boundaryEvidence&&t.boundaryEvidence[j]==='uncertain'?'#ffb454':j===handle?'#fff':'#36efd0';ctx.fill();ctx.strokeStyle='#142331';ctx.stroke();});
        });
        buttons.forEach((b,i)=>{b.textContent=labels[i]+(reviewed[i]?' ✓':'');b.setAttribute('aria-pressed',String(i===selected));});
        select.value=String(handle);dialog.querySelector('[data-role="tooth"]').textContent=labels[selected];
        const count=reviewed.filter(Boolean).length;
        dialog.querySelector('[data-role="status"]').textContent=`${count} de 6 revisados. `+(validTooth(draft.teeth[selected])?'Revisa visualmente todo el borde.':'Corrige los puntos: el contorno se cruza, sale de la imagen o es demasiado pequeño.');
        if(draft.teeth[selected].boundaryEvidence)dialog.querySelector('[data-role="status"]').textContent+=' Naranja: no se encontró contraste suficiente; el punto es una estimación. Verde: hay contraste, no certeza anatómica.';
        dialog.querySelector('[data-action="review"]').disabled=!validTooth(draft.teeth[selected]);
        const allValid=count===6&&valid(draft);
        if(count===6&&!allValid)dialog.querySelector('[data-role="status"]').textContent='Revisa los contactos: hay contornos superpuestos o una curva inválida. Selecciona los dientes y separa sus límites.';
        dialog.querySelector('[data-action="continue"]').disabled=!allValid;
      }
      function change(x,y){move(draft,selected,handle,x,y);reviewed[selected]=false;draw();}
      function point(e){const r=canvas.getBoundingClientRect();return {x:view.x+(e.clientX-r.left)/r.width*view.w,y:view.y+(e.clientY-r.top)/r.height*view.h};}
      canvas.onpointerdown=e=>{const p=point(e),r=canvas.getBoundingClientRect();let nearest=-1,dist=23;
        draft.teeth[selected].points.forEach((q,i)=>{const d=Math.hypot((p.x-q.x)/view.w*r.width,(p.y-q.y)/view.h*r.height);if(d<dist){nearest=i;dist=d;}});
        if(nearest>=0){handle=nearest;drag=true;canvas.setPointerCapture(e.pointerId);draw();}
      };
      canvas.onpointermove=e=>{if(drag){const p=point(e);change(p.x,p.y);}};
      canvas.onpointerup=canvas.onpointercancel=()=>{drag=false;};
      select.onchange=()=>{handle=Number(select.value);draw();};
      dialog.querySelectorAll('[data-dx]').forEach(b=>b.onclick=()=>{const p=draft.teeth[selected].points[handle];change(p.x+Number(b.dataset.dx)/img.naturalWidth,p.y+Number(b.dataset.dy)/img.naturalHeight);});
      dialog.querySelector('[data-action="zoom"]').onclick=e=>{zoom=!zoom;e.target.textContent=zoom?'Ver los seis':'Ampliar diente';draw();};
      dialog.querySelector('[data-action="reset"]').onclick=()=>{draft.teeth[selected]=JSON.parse(JSON.stringify(initial.teeth[selected]));reviewed[selected]=false;draw();};
      dialog.querySelector('[data-action="review"]').onclick=()=>{if(!validTooth(draft.teeth[selected]))return;reviewed[selected]=true;const next=reviewed.indexOf(false);if(next>=0)selected=next;draw();};
      const cleanup=()=>{busy=false;dialog.close();dialog.remove();};
      const cancel=()=>{cleanup();const e=new Error('Revisión cancelada. No se solicitó la generación de imagen.');e.requiresNewGeneration=false;reject(e);};
      dialog.oncancel=e=>{e.preventDefault();cancel();};
      dialog.querySelector('[data-action="cancel"]').onclick=cancel;
      dialog.querySelector('[data-action="continue"]').onclick=()=>{if(!reviewed.every(Boolean)||!valid(draft))return;cleanup();resolve(draft);};
      dialog.showModal();draw();
    });
  }
  root.SmylContourReview={review,valid,validTooth,move,trace};
})(typeof window==='undefined'?globalThis:window);
