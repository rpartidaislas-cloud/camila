import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'simulacion-rapida.html'), 'utf8');
const visual = fs.readFileSync(path.join(root, 'visual-simulation.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/claude/index.ts'), 'utf8');

assert.match(html, /dentalDesignMaster:\s*null/);
assert.doesNotMatch(html, /diseno_maestro_intraoral/);
assert.match(html, /role:'original-anatomy'/);
assert.match(visual, /same-patient-original-v1/);
assert.match(edge, /isOriginalAnatomyGuide/);
assert.match(html, /referenciaDentalMaestraParaVista\(view\)/);
assert.match(html, /masterGuide:masterGuide,multiviewReference:!!masterGuide/);
assert.match(html, /dentalDesignMaster:\s*S\.dentalDesignMaster/);
assert.match(html, /snap\.dentalDesignMaster/);
assert.match(html, /Cargar mis fotos · frontal \+ intraoral/);
assert.match(html, /id="paired-own-frontal"/);
assert.match(html, /id="paired-own-intraoral"/);
assert.match(html, /function confirmarCargaParPropio\(button\)/);
assert.match(html, /S\.testPairedGeneration=true/);
assert.match(html, /Ejemplo precargado · frontal \+ intraoral/);
assert.match(html, /class="advanced-entry-btn debug-test-only"[^>]*hidden[^>]*>Ejemplo precargado/);
assert.match(html, /some\(function\(photo\)\{ return !!photo\.synthetic; \}\)/);
assert.match(html, /element\.hidden=!debugUi/);

assert.match(visual, /visual-preview-v3-tooth-lock/);
assert.match(visual, /MULTI-VIEW DENTAL IDENTITY LOCK/);
assert.match(visual, /same-patient-master-v2/);
assert.match(visual, /TOOTH-COUNT AND BOUNDARY LOCK/);
assert.match(visual, /const scale=Math\.min/);
assert.match(visual, /guideImageBase64:guide\?\.b64/);
assert.match(visual, /change only what perspective and natural photographic visibility require/);

assert.match(edge, /isSamePatientMasterGuide/);
assert.match(edge, /MULTI-VIEW SAME-PATIENT DENTAL DESIGN TRANSFER/);
assert.match(edge, /STRICT TOOTH IDENTITY/);
assert.match(edge, /same-patient-master-design\.png/);

const functionSource=html.slice(html.indexOf('function referenciaDentalMaestraParaVista(view)'),html.indexOf('async function generarAproximacionVisualIA'));
const state={photos:[{view:'intraoral',dataUrl:'data:image/png;base64,original'}],dentalDesignMaster:{view:'frontal',revision:1},results:{frontal:'data:image/png;base64,accepted'}};
const context=vm.createContext({S:state});
vm.runInContext(functionSource,context);
for(const view of ['frontal','perfil-derecho','perfil-izquierdo','tres-cuartos','extraoral']){
  const reference=context.referenciaDentalMaestraParaVista(view);
  assert.equal(reference.role,'original-anatomy');
  assert.equal(reference.result,state.photos[0].dataUrl);
}
assert.equal(context.referenciaDentalMaestraParaVista('intraoral').role,'accepted-design');
state.photos=[];
assert.equal(context.referenciaDentalMaestraParaVista('frontal'),null);
state.dentalDesignMaster=null;
assert.equal(context.referenciaDentalMaestraParaVista('extraoral'),null);
const prompts=vm.createContext({SmylSmileModes:{prompt:()=> 'ALIGNMENT ONLY'}});
vm.runInContext(visual,prompts);
assert.match(prompts.SmylVisualSimulation.prompt({referenceRole:'original-anatomy'}),/ORIGINAL untreated intraoral/);
assert.match(prompts.SmylVisualSimulation.prompt({referenceRole:'original-anatomy'}),/ALIGNMENT ONLY/);
console.log('SMYL reference roles: original anatomy, optional reference, target view and alignment prompt verified. No anatomical accuracy claim.');
