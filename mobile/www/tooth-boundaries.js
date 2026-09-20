/* Experimental local boundary evidence. Not a trained dental segmenter. */
(function(root){
 'use strict';
 function detect(data,W,H,pieces){
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function pixel(x,y){
   x=clamp(Math.round(x),0,W-1);y=clamp(Math.round(y),0,H-1);
   const i=(y*W+x)*4,r=data[i],g=data[i+1],b=data[i+2];
   return {lum:.299*r+.587*g+.114*b,red:r-g};
  }
  const dirs=[[-.72,-.85],[0,-1],[.72,-.85],[1,0],[.72,.85],[0,1],[-.72,.85],[-1,0]];
  return {version:1,coordinateSpace:'normalized-smile-crop',view:'frontal',origin:'photo-boundary-evidence-v1',teeth:pieces.map((p,index)=>{
   const cx=p.x+p.w/2,cy=p.y+p.h*.48,center=pixel(cx,cy);
   const points=[],evidence=[];
   dirs.forEach(([dx,dy])=>{
    let found=null;
    // Search outward from the interior; a persistent change is needed so a
    // single highlight or noisy pixel does not become the boundary.
    for(let t=.35;t<=1.38;t+=.025){
     const x=cx+dx*p.w*.5*t,y=cy+dy*p.h*.5*t;
     const a=pixel(cx+dx*p.w*.5*(t-.12),cy+dy*p.h*.5*(t-.12));
     const b=pixel(x,y),c=pixel(cx+dx*p.w*.5*(t+.065),cy+dy*p.h*.5*(t+.065));
     const dark=a.lum-b.lum>18&&a.lum-c.lum>16&&b.lum<center.lum*.82;
     const gum=b.red-a.red>12&&c.red-a.red>10&&b.red>25;
     if(center.lum>75&&(dark||gum)){found={x,y};break;}
    }
    const point=found||{x:cx+dx*p.w*.5,y:cy+dy*p.h*.5};
    points.push({x:clamp(point.x/W,0,1),y:clamp(point.y/H,0,1)});
    evidence.push(found?'contrast':'uncertain');
   });
   return {id:['13','12','11','21','22','23'][index],role:p.role,points,basePoints:points.map(q=>({...q})),boundaryEvidence:evidence,
    bounds:{x:p.x/W,y:p.y/H,w:p.w/W,h:p.h/H}};
  })};
 }
 root.SmylToothBoundaries={detect};
})(typeof window==='undefined'?globalThis:window);
