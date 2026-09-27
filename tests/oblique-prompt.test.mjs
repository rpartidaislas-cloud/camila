import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../smile-modes.js',import.meta.url),'utf8'),ctx);
vm.runInContext(fs.readFileSync(new URL('../visual-simulation.js',import.meta.url),'utf8'),ctx);
for(const targetView of ['left','right','tresCuartos','intraoralLeft','intraoralRight']){
 for(const mode of ['alignment','veneers','combined']){
  for(const arch of ['upper','lower','both']){
   const text=ctx.SmylVisualSimulation.prompt({targetView,mode,arch,shade:'A1'});
   assert.match(text,/OBLIQUE DENTAL PHOTO EDIT/);
   assert.doesNotMatch(text,/image-left canine|both centrals|COMPLETE NATURAL ALIGNMENT|13-12-11/);
   assert.match(text,/posterior teeth/);
   if(mode!=='veneers'){
    assert.match(text,/VISIBLE WHOLE-CROWN REPOSITIONING IS REQUIRED/);
    assert.match(text,/only obvious difference is shade/);
   }
   if(mode==='combined')assert.match(text,/color-only or whitening-only result is a failed output/);
   assert.match(text,mode==='alignment'?/No veneers, whitening or reshaping/:/Approximate VITA A1/);
  }
 }
 const material=ctx.SmylVisualSimulation.prompt({targetView,materialOnly:true});
 assert.match(material,/MATERIAL-ONLY/);
}
const html=fs.readFileSync(new URL('../simulacion-rapida.html',import.meta.url),'utf8');
const start=html.indexOf('function referenciaDentalMaestraParaVista(view)');
const end=html.indexOf('async function generarAproximacionVisualIA',start);
ctx.S={photos:[{view:'intraoralRight',b64:'opposite'}],dentalDesignMaster:{view:'frontal'},results:{frontal:'data:image/png;base64,generated'}};
vm.runInContext(html.slice(start,end),ctx);
assert.equal(ctx.referenciaDentalMaestraParaVista('left'),null);
assert.equal(ctx.referenciaDentalMaestraParaVista('intraoralLeft'),null);
ctx.S.photos.push({view:'intraoral',b64:'front'});
assert.equal(ctx.referenciaDentalMaestraParaVista('left').view,'intraoral');
ctx.S.photos.push({view:'intraoralLeft',b64:'same'});
assert.equal(ctx.referenciaDentalMaestraParaVista('left').view,'intraoralLeft');
assert.equal(ctx.referenciaDentalMaestraParaVista('intraoralLeft').view,'intraoral');
console.log('45 oblique prompt combinations, material-only and reference-side routing passed. Not a visual/anatomical validation.');
