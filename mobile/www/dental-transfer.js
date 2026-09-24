/* Deterministic, local, assisted transfer. No network and no inferred tooth IDs. */
(function(root){
  'use strict';
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  function affine(s,t){
    if(s.length!==3||t.length!==3||[...s,...t].some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('Marca tres puntos válidos en cada imagen.');
    const det=cross(...s);
    if(Math.abs(det)<4||Math.abs(cross(...t))<4||det*cross(...t)<=0)throw Error('Los puntos están alineados o invertidos. Revisa el orden.');
    function solve(k){const u=t[1][k]-t[0][k],v=t[2][k]-t[0][k];const a=(u*(s[2].y-s[0].y)-v*(s[1].y-s[0].y))/det,b=((s[1].x-s[0].x)*v-(s[2].x-s[0].x)*u)/det;return [a,b,t[0][k]-a*s[0].x-b*s[0].y];}
    const x=solve('x'),y=solve('y');return [x[0],y[0],x[1],y[1],x[2],y[2]];
  }
  const map=(p,m)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
  function validPolygon(p){
    if(p.length<3||p.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)))return false;
    let area=0;
    for(let i=0;i<p.length;i++){
      const a=p[i],b=p[(i+1)%p.length];area+=a.x*b.y-b.x*a.y;
      for(let j=i+2;j<p.length;j++){
        if(i===0&&j===p.length-1)continue;
        const c=p[j],d=p[(j+1)%p.length];
        if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(a.x,b.x)>=Math.min(c.x,d.x)&&Math.max(c.x,d.x)>=Math.min(a.x,b.x)&&Math.max(a.y,b.y)>=Math.min(c.y,d.y)&&Math.max(c.y,d.y)>=Math.min(a.y,b.y))return false;
      }
    }
    return Math.abs(area)>8;
  }
  function path(ctx,p){ctx.beginPath();p.forEach((q,i)=>i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.closePath();}
  function render(source,target,entries){
    const canvas=document.createElement('canvas');canvas.width=target.naturalWidth||target.width;canvas.height=target.naturalHeight||target.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(target,0,0);
    entries.forEach(e=>{const m=affine(e.source,e.target);ctx.save();path(ctx,e.visible);ctx.clip();ctx.transform(...m);path(ctx,e.contour);ctx.clip();ctx.drawImage(source,0,0);ctx.restore();});return canvas;
  }
  function load(url){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('No se pudo abrir la fotografía.'));img.src=url;});}
  async function open({source,original,target,anatomy}){
    const [src,dst,ori,ref]=await Promise.all([source,target,original,anatomy].map(load));
    if(dst.naturalWidth!==ori.naturalWidth||dst.naturalHeight!==ori.naturalHeight)throw Error('La vista y su original deben tener las mismas dimensiones.');
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='dt-dialog';
      dialog.innerHTML='<h2>Vincular dientes entre vistas</h2><p>Transferencia asistida · sin generar otra imagen. Trabaja una pieza a la vez. La iluminación de la intraoral también se transfiere: revisa la integración antes de guardar.</p><label>Pieza <select aria-label="Pieza dental"></select></label><p class="dt-step" role="status"></p><div class="dt-grid"><figure><figcaption>Intraoral · diseño aprobado</figcaption><canvas class="dt-source"></canvas></figure><figure><figcaption>Vista actual · destino</figcaption><canvas class="dt-target"></canvas></figure></div><details><summary>Consultar intraoral original</summary><img class="dt-anatomy" alt="Intraoral original para identificar cada pieza"></details><div class="dt-actions"><button data-act="undo">Deshacer punto</button><button data-act="next">Continuar</button><button data-act="reset">Reiniciar esta pieza</button><button data-act="remove">Quitar pieza aplicada</button></div><p class="dt-count"></p><label><input type="checkbox" class="dt-reviewed"> Comparé las piezas y confirmé límites, labios y encía.</label><div class="dt-actions"><button data-act="cancel">Cancelar</button><button data-act="save" disabled>Guardar transferencia</button></div>';
      const select=dialog.querySelector('select');['13','12','11','21','22','23','43','42','41','31','32','33'].forEach(id=>{const o=document.createElement('option');o.value=id;o.textContent=id;select.append(o);});
      let stage=0,contour=[],s=[],t=[],visible=[],entries=[],result=render(src,dst,[]);
      const zoomLabel=document.createElement('label');zoomLabel.textContent='Ampliar para marcar: ';
      const zoom=document.createElement('select');zoom.setAttribute('aria-label','Ampliación');
      [1,2,3,4].forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n+'×';zoom.append(o);});zoomLabel.append(zoom);dialog.querySelector('.dt-grid').before(zoomLabel);
      const a=dialog.querySelector('.dt-source'),b=dialog.querySelector('.dt-target'),status=dialog.querySelector('.dt-step'),check=dialog.querySelector('.dt-reviewed'),save=dialog.querySelector('[data-act="save"]');
      a.width=src.naturalWidth;a.height=src.naturalHeight;b.width=dst.naturalWidth;b.height=dst.naturalHeight;dialog.querySelector('.dt-anatomy').src=anatomy;
      [a,b].forEach(c=>{const scroller=document.createElement('div');scroller.style.cssText='overflow:auto;max-height:55dvh';c.before(scroller);scroller.append(c);});
      zoom.onchange=()=>{[a,b].forEach(c=>{c.style.width=(Number(zoom.value)*100)+'%';});};
      const steps=['1. En la intraoral, marca alrededor del contorno de UNA corona, en orden. No incluyas encía. Luego pulsa Continuar.','2. En la intraoral marca: 1 centro cervical, 2 esquina incisal izquierda, 3 esquina incisal derecha (izquierda de la imagen).','3. En el destino marca los mismos tres puntos, en el mismo orden. Ajusta el tamaño al espacio de esa pieza.','4. En el destino delimita la zona visible permitida para esa corona. Excluye labios y encía; esta zona recortará la transferencia. Luego pulsa Aplicar pieza.'];
      function points(){return [contour,s,t,visible][stage];}
      function draw(canvas,img,p){const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0);if(!p.length)return;c.strokeStyle='#36e0c4';c.fillStyle='#36e0c4';c.lineWidth=canvas.width/350;c.beginPath();p.forEach((q,i)=>{if(i)c.lineTo(q.x,q.y);else c.moveTo(q.x,q.y);});c.stroke();p.forEach((q,i)=>{c.beginPath();c.arc(q.x,q.y,canvas.width/180,0,Math.PI*2);c.fill();c.font=Math.max(12,canvas.width/65)+'px sans-serif';c.fillText(String(i+1),q.x+canvas.width/90,q.y);});}
      function paint(){draw(a,src,stage===0?contour:s);draw(b,result,stage===2?t:visible);status.textContent=steps[stage];dialog.querySelector('[data-act="next"]').textContent=stage===3?'Aplicar pieza':'Continuar';dialog.querySelector('.dt-count').textContent=entries.length?'Piezas transferidas: '+entries.map(e=>e.id).join(', '):'Aún no has transferido ninguna pieza.';save.disabled=!entries.length||!check.checked;}
      function reset(){stage=0;contour=[];s=[];t=[];visible=[];paint();}
      [a,b].forEach((canvas,index)=>canvas.addEventListener('pointerdown',event=>{if((stage<2?0:1)!==index)return;const p=points();if((stage===1||stage===2)&&p.length>=3)return;const r=canvas.getBoundingClientRect();p.push({x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height});check.checked=false;paint();}));
      select.onchange=reset;check.onchange=()=>{save.disabled=!entries.length||!check.checked;};
      dialog.querySelector('[data-act="undo"]').onclick=()=>{points().pop();paint();};dialog.querySelector('[data-act="reset"]').onclick=reset;
      dialog.querySelector('[data-act="remove"]').onclick=()=>{entries=entries.filter(e=>e.id!==select.value);result=render(src,dst,entries);check.checked=false;reset();};
      dialog.querySelector('[data-act="next"]').onclick=()=>{try{
        if(stage===0&&!validPolygon(contour))throw Error('Dibuja un contorno cerrado sin cruces, con al menos tres puntos.');
        if(stage===1&&s.length!==3)throw Error('Faltan los tres puntos de referencia.');
        if(stage===2)affine(s,t);
        if(stage<3){stage++;paint();return;}
        if(!validPolygon(visible))throw Error('Marca la zona visible sin cruces, con al menos tres puntos.');
        const m=affine(s,t),mapped=contour.map(p=>map(p,m));
        if(mapped.some(p=>p.x<0||p.y<0||p.x>b.width||p.y>b.height))throw Error('La pieza queda fuera de la foto; revisa los puntos.');
        entries=entries.filter(e=>e.id!==select.value).concat({id:select.value,contour:contour.slice(),source:s.slice(),target:t.slice(),visible:visible.slice()});result=render(src,dst,entries);check.checked=false;reset();
      }catch(e){status.textContent=e.message;}};
      function finish(value){dialog.close();dialog.remove();resolve(value);}
      dialog.querySelector('[data-act="cancel"]').onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};save.onclick=()=>{if(entries.length&&check.checked)finish({url:result.toDataURL('image/png'),entries,version:'assisted-affine-v1'});};
      document.body.append(dialog);dialog.showModal();paint();
    });
  }
  root.SmylDentalTransfer={affine,map,validPolygon,render,open};
})(typeof window==='undefined'?globalThis:window);
