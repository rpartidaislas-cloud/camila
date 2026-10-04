/* Conservative local selection suggestion, not an anatomical/clinical model.
 * Changed enamel-like components are evidence, not proof of generated teeth.
 * No face models, network, or mutation of source pixels. Uncertainty returns no mask.
 */
(function(root){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function enamel(r,g,b){
    const hi=Math.max(r,g,b),lo=Math.min(r,g,b),chroma=hi-lo;
    const lum=.2126*r+.7152*g+.0722*b;
    let hue=chroma?(hi===r?60*((g-b)/chroma):hi===g?60*((b-r)/chroma+2):60*((r-g)/chroma+4)):0;
    if(hue<0)hue+=360;
    return lum>88&&g>68&&b>44&&r-g<37&&g-b<77&&chroma/Math.max(1,hi)<.43&&
      (chroma<16||(hue>=24&&hue<=82))&&b-r<15;
  }
  function analyze({data,original,width:W,height:H,region}){
    if(!Number.isInteger(W)||!Number.isInteger(H)||W<4||H<4||W*H>8388608||data?.length!==W*H*4)throw Error('Imagen no válida para selección local.');
    if(original&&original.length!==data.length)throw Error('Las fotografías no tienen el mismo encuadre.');
    const N=W*H,labels=new Int32Array(N),queue=new Int32Array(N),candidates=new Uint8Array(N),changes=new Uint8Array(N);
    let x0=1,y0=1,x1=W-2,y1=H-2;
    if(region){
      if(!['x','y','w','h'].every(k=>Number.isFinite(region[k]))||region.w<=0||region.h<=0)throw Error('Zona de búsqueda no válida.');
      x0=clamp(Math.floor(region.x),1,W-2);y0=clamp(Math.floor(region.y),1,H-2);
      x1=clamp(Math.ceil(region.x+region.w),x0,W-2);y1=clamp(Math.ceil(region.y+region.h),y0,H-2);
    }
    let globallyChanged=0;
    const delta=i=>Math.max(Math.abs(data[i]-original[i]),Math.abs(data[i+1]-original[i+1]),Math.abs(data[i+2]-original[i+2]));
    if(original)for(let i=0;i<data.length;i+=4)if(delta(i)>18)globallyChanged++;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const p=y*W+x,i=p*4;
      if(data[i+3]>240&&enamel(data[i],data[i+1],data[i+2]))candidates[p]=1;
      if(original&&delta(i)>12)changes[p]=1;
    }
    const components=[];let id=0;
    for(let p=0;p<N;p++){
      if(!candidates[p]||labels[p])continue;
      id++;let head=0,tail=1,changed=0,minX=W,minY=H,maxX=0,maxY=0;queue[0]=p;labels[p]=id;
      while(head<tail){
        const at=queue[head++],y=Math.floor(at/W),x=at-y*W;
        minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        if(original&&delta(at*4)>18)changed++;
        for(const n of [at-1,at+1,at-W,at+W]){
          if(n<0||n>=N||labels[n]||!candidates[n]||Math.abs(n%W-x)>1)continue;
          labels[n]=id;queue[tail++]=n;
        }
      }
      const w=maxX-minX+1,h=maxY-minY+1,area=(x1-x0+1)*(y1-y0+1);
      // Reject flat backgrounds, tiny highlights, large connected skin areas.
      if(tail<Math.max(12,N*.000025)||w<3||h<3||tail>area*.55||tail>N*.18||w/h>16||h/w>8)continue;
      components.push({id,size:tail,changed,x:minX,y:minY,w,h});
    }
    return {width:W,height:H,labels,changes,components,globalChange:globallyChanged/N,hasOriginal:!!original};
  }
  function maskFor(analysis,ids,changedOnly=false){
    const {width:W,height:H,labels}=analysis,out=new Uint8ClampedArray(W*H*4),keep=new Set(ids);
    let count=0;
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
      const p=y*W+x,id=labels[p];if(!id||!keep.has(id)||(changedOnly&&!analysis.changes[p]))continue;
      // Soften inward only; never expand into tissue or a dark tooth gap.
      const edge=[p-1,p+1,p-W,p+W].some(n=>labels[n]!==id||(changedOnly&&!analysis.changes[n]));
      out[p*4]=out[p*4+1]=out[p*4+2]=255;out[p*4+3]=edge?150:255;count++;
    }
    return {data:out,count};
  }
  function suggest(analysis){
    const none=reason=>({data:new Uint8ClampedArray(analysis.width*analysis.height*4),count:0,reason});
    if(!analysis.hasOriginal)return none('No hay una comparación compatible. Toca los dientes que quieras seleccionar.');
    if(analysis.globalChange>.32)return none('El encuadre o la luz cambiaron demasiado para sugerir una zona segura. Toca los dientes.');
    const eligible=analysis.components.filter(c=>c.changed>=Math.max(6,c.size*.16));
    if(!eligible.length)return none('No se distinguió una zona dental modificada. Toca los dientes para seleccionarlos.');
    // Group neighboring enamel components; do not select distant eyes/jewelry.
    const groups=[],seen=new Set();
    for(const first of eligible){
      if(seen.has(first.id))continue;
      const group=[first];seen.add(first.id);
      for(let i=0;i<group.length;i++)for(const b of eligible){
        if(seen.has(b.id))continue;
        const a=group[i],gapX=Math.max(0,a.x-b.x-b.w,b.x-a.x-a.w),gapY=Math.max(0,a.y-b.y-b.h,b.y-a.y-a.h);
        if(gapX<=Math.max(a.h,b.h)*1.2&&gapY<=Math.min(a.h,b.h)*.8){group.push(b);seen.add(b.id);}
      }
      const x=Math.min(...group.map(c=>c.x)),y=Math.min(...group.map(c=>c.y));
      groups.push({parts:group,x,y,w:Math.max(...group.map(c=>c.x+c.w))-x,h:Math.max(...group.map(c=>c.y+c.h))-y,score:group.reduce((s,c)=>s+c.changed,0)});
    }
    groups.sort((a,b)=>b.score-a.score);const best=groups[0];
    const joinedRow=best.parts.length===1&&best.w/best.h>=1.8&&best.w/analysis.width<.8;
    if((best.parts.length<2&&!joinedRow)||best.w<best.h*.9||best.score<analysis.width*analysis.height*.0005||(groups[1]&&groups[1].score>best.score*.65))return none('La zona no está clara. Toca los dientes y revisa la selección.');
    return {...maskFor(analysis,best.parts.map(c=>c.id),true),reason:'Selección sugerida. Revisa que incluya solo los dientes y la arcada que quieres cambiar.'};
  }
  function at(analysis,x,y){
    const id=analysis.labels[clamp(Math.round(y),0,analysis.height-1)*analysis.width+clamp(Math.round(x),0,analysis.width-1)];
    if(!analysis.components.some(c=>c.id===id))return null;
    return maskFor(analysis,[id]);
  }
  root.SmylToothSelection={analyze,suggest,at,enamel};
  if(typeof module!=='undefined')module.exports=root.SmylToothSelection;
})(typeof window==='undefined'?globalThis:window);
