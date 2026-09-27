import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync('simulacion-rapida.html','utf8');
const extract=(name,next)=>html.slice(html.indexOf('function '+name),html.indexOf('function '+next));
const ctx=vm.createContext({});
vm.runInContext(extract('detectarBandaDentalContinua','bandaArcadasDesdeBoca'),ctx);
for(const view of ['left','right','tresCuartos','intraoralLeft','intraoralRight']){
 const width=300,height=200,pixels=new Uint8ClampedArray(width*height*4);
 for(let y=32;y<52;y++)for(let x=100;x<195;x++){let i=(y*width+x)*4;pixels.set([225,215,190,255],i);}
 const canvas={width,height,getContext:()=>({getImageData:()=>({data:pixels})})};
 const band=ctx.detectarBandaDentalContinua(canvas,view,null);
 assert.ok(band.confidence>0,view+' detects high teeth in crop');
 assert.ok(band.y<=32&&band.y+band.h>=51,view+' contains the observed crown band');
 assert.ok(band.y<height*.5,view+' does not force the band onto chin');
}
console.log('Lateral crop regression: high dental band retained for all five oblique views. Synthetic pixels only; not an anatomy test.');
