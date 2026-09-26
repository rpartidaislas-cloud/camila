import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const js=fs.readFileSync(new URL('../case-views.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../simulacion-rapida.html',import.meta.url),'utf8');
const state={photos:[{view:'intraoral',b64:'principal'}],results:{left:'old'},dentalDesignMaster:{view:'left'}};
const ctx=vm.createContext({S:state,document:{querySelectorAll:()=>[],getElementById:()=>null},fotoPropiaPermitida:()=>true,leerFotoPropia:async()=>'',redimensionarFotoB64:async()=> 'new',actualizarReferenciaOpcional(){},saveProgress(){},mostrarAvisoAplicacion(){}});
vm.runInContext(js,ctx);
assert.equal(ctx.CASE_VIEW_GROUPS.flatMap(g=>g.views).length,8);
for(const view of ['frontal','left','right','tresCuartos','extraoral','intraoralLeft','intraoralRight']){
 ctx.optionalViewSelected=view;
 await ctx.cargarVistaOpcional({files:[{}],value:'x'});
}
assert.equal(state.photos.length,8);
assert.equal(state.photos[0].view,'intraoral');
assert.equal(state.photos[0].b64,'principal');
assert.equal(state.results.left,undefined);
ctx.optionalViewSelected='left';
await ctx.cargarVistaOpcional({files:[{}]});
assert.equal(state.photos.length,8);
ctx.redimensionarFotoB64=async()=>{throw Error('decode');};
await ctx.cargarVistaOpcional({files:[{}]});
assert.equal(state.photos.find(p=>p.view==='left').b64,'new');
assert.doesNotMatch(js,/fetch\(|generateSimulation\(|processPhotos\(/);
assert.match(html,/S.quickGuided \? S.photos\[0\]/);
assert.match(html,/Generar esta vista/);
assert.match(html,/var esIntraoral = \/\^intraoral\/.test\(view\)/);
console.log('Eight views: optional upload, replacement, failure, primary order and no API calls passed.');
