import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../simulacion.html', import.meta.url), 'utf8');
const backend = fs.readFileSync(new URL('../supabase/functions/claude/index.ts', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `No se encontró ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < html.length; i += 1) {
    const char = html[i];
    const next = html[i + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`No se pudo extraer ${name}`);
}

const context = {};
vm.createContext(context);
context.SIM_ACCEPTANCE_V102 = {
  version:'v102',
  minimumSourcePieces:6,
  minimumSourceCoverage:.88,
  minimumTargetCoverage:.82,
  minimumChangedRatio:.32,
  minimumMeanDifference:8,
  minimumTextureDeviation:7.5,
  maximumA1Yellow:17,
  minimumChangedRatioPerTooth:.28,
};
vm.runInContext([
  extractFunction('clasificarErrorParaUsuario'),
  extractFunction('evaluarProteccionInferiorMascara'),
  extractFunction('medianaNumerica'),
  extractFunction('agruparMascarasDentales'),
  extractFunction('resumirPiezasDentales'),
  extractFunction('seleccionarSeisPiezasAnteriores'),
  extractFunction('seleccionarPiezasArcadaSuperior'),
  extractFunction('mascarasDePiezasDentales'),
  extractFunction('limitarPlanoDental'),
  extractFunction('construirPlanoGeometricoDental'),
  extractFunction('evaluarCapturaDentalV102'),
  extractFunction('emparejarPiezasDentales'),
  extractFunction('evaluarAnatomiaSegmentada'),
  extractFunction('consolidarHallazgosRevision'),
  extractFunction('medirDiferenciasFueraMascara'),
  extractFunction('firmaEntradaDental'),
  extractFunction('evaluarContratoPresentacionV102'),
  extractFunction('evaluarIntegridadVisualV102'),
  extractFunction('construirPrescripcionNumericaV102'),
].join('\n'), context);

const compositorSeguro = extractFunction('componerConMascaraAnatomicaContinua');
assert.doesNotMatch(compositorSeguro, /segmentarParDental\s*\(/);
assert.match(compositorSeguro, /deliveryGate:'v102-six-veneer-render-contract'/);
assert.match(compositorSeguro, /generatedPieces:\[\]/);
assert.match(compositorSeguro, /evaluarContratoPresentacionV102/);
assert.match(compositorSeguro, /throw errorContrato/);
assert.match(compositorSeguro, /contract:'post-safety-clip'/);
assert.match(compositorSeguro, /mask:coberturaContrato/);
assert.doesNotMatch(compositorSeguro, /mask:tratamientoActual\.metrics/);
assert.match(html, /contractVersion:'v102'/);
const generadorV102=extractFunction('generateSimulation');
assert.doesNotMatch(generadorV102, /IMAGE 2 already fixes/);
assert.doesNotMatch(generadorV102, /guideImageBase64:/);
assert.match(generadorV102, /There is NO second reference image and no visual blueprint/);
assert.match(generadorV102, /Never treat premolars, lower teeth or any unlisted tooth/);
assert.match(html, /function resumirDiagnosticoCalibracion/);
assert.match(html, /proc-error-diagnostics/);
assert.match(html, /proc-error-preview/);
assert.match(html, /get\('debugUI'\)!=='1'/);
assert.match(extractFunction('prepararMascaraTratamiento'), /construirMascaraDestinoV102/);
assert.match(extractFunction('construirMascaraDestinoV102'), /drawImage\(sourceMask/);
assert.match(extractFunction('construirMascaraDestinoV102'), /drawImage\(targetMask/);
assert.match(extractFunction('construirMascaraDestinoV102'), /destination-in/);
assert.match(extractFunction('construirMascaraDestinoV102'), /regionExpandida/);
assert.match(extractFunction('construirMascaraDestinoV102'), /alturaMediana\*\.16/);
assert.match(extractFunction('prepararMascaraTratamiento'), /stage:'mask-preflight'/);
assert.match(backend, /X-SMYL-Contract/);
assert.match(backend, /contract:\s*simulationContract/);
assert.match(backend, /simulationContract === "v101" \|\| simulationContract === "v102"/);
assert.match(backend, /simulationContract === "v102"/);
assert.match(backend, /contrato v102 requiere GPT Image 2/i);
assert.match(backend, /The patient smile crop is the ONE AND ONLY visual reference/);
assert.match(backend, /guideImageBase64 && !isMeasuredMaskOnlyContract/);
assert.match(backend, /numeric-geometry-only/);

const pixelOriginal = new Uint8ClampedArray([
  10,20,30,255,
  40,50,60,255,
]);
const pixelSalidaInterior = new Uint8ClampedArray([
  10,20,30,255,
  200,210,220,255,
]);
const mascaraInterior = new Uint8ClampedArray([
  255,255,255,0,
  255,255,255,255,
]);
const exteriorIntacto = context.medirDiferenciasFueraMascara(pixelOriginal,pixelSalidaInterior,mascaraInterior);
assert.equal(exteriorIntacto.identical,true);
assert.equal(exteriorIntacto.changedPixels,0);

const pixelSalidaExterior = new Uint8ClampedArray(pixelSalidaInterior);
pixelSalidaExterior[0] = 11;
const exteriorAlterado = context.medirDiferenciasFueraMascara(pixelOriginal,pixelSalidaExterior,mascaraInterior);
assert.equal(exteriorAlterado.identical,false);
assert.equal(exteriorAlterado.changedPixels,1);
assert.equal(exteriorAlterado.maxDelta,1);

const firmaPacienteA=context.firmaEntradaDental({dataUrl:'data:image/jpeg;base64,AAAA1111BBBB'});
const firmaPacienteB=context.firmaEntradaDental({dataUrl:'data:image/jpeg;base64,AAAA2222BBBB'});
assert.notEqual(firmaPacienteA,firmaPacienteB);
assert.equal(firmaPacienteA,context.firmaEntradaDental({dataUrl:'data:image/jpeg;base64,AAAA1111BBBB'}));

const validacionRecibida = extractFunction('validarResultadoIARecibido');
assert.match(validacionRecibida, /errorSinCambio[\s\S]{0,300}throw errorSinCambio/);
assert.match(validacionRecibida, /contrato visual v102/i);

const evidenciaValida = {
  trace:{provider:'openai',model:'gpt-image-2-2026-04-21',contract:'v102'},
  outsideMask:{identical:true,changedPixels:0},
  sourcePieces:6,
  mask:{sourceCoverage:.96,targetCoverage:.94},
  visual:{changed:.58,meanDifference:24,texture:15,yellow:8,artifacts:{detected:false},independentTeeth:{confirmed:true}},
  perToothChange:['13','12','11','21','22','23'].map((id)=>({id,changedRatio:.52})),
  vitaTone:'A1',
};
const contratoValido = context.evaluarContratoPresentacionV102(evidenciaValida);
assert.equal(contratoValido.accepted,true);
assert.equal(contratoValido.status,'ready-for-clinical-review');

const evidenciaInerte = structuredClone(evidenciaValida);
evidenciaInerte.visual.changed=.05;
evidenciaInerte.visual.meanDifference=2;
evidenciaInerte.perToothChange[3].changedRatio=.02;
const contratoInerte=context.evaluarContratoPresentacionV102(evidenciaInerte);
assert.equal(contratoInerte.accepted,false);
assert.ok(contratoInerte.failures.some((item)=>/cambio dental visible/.test(item)));
assert.ok(contratoInerte.failures.some((item)=>/carillas no muestran/.test(item)));

const evidenciaFuera=structuredClone(evidenciaValida);
evidenciaFuera.outsideMask={identical:false,changedPixels:1};
assert.equal(context.evaluarContratoPresentacionV102(evidenciaFuera).accepted,false);

const evidenciaSinTraza=structuredClone(evidenciaValida);
evidenciaSinTraza.trace={provider:'openai',model:'desconocido'};
assert.equal(context.evaluarContratoPresentacionV102(evidenciaSinTraza).accepted,false);

// Regresión v102: seis coronas naturales deben conservar separaciones finas;
// un plano copiado con líneas rojizas o una placa blanca fusionada se bloquean.
function crearCoronasSinteticas(modo) {
  const width=170,height=82;
  const pixels=new Uint8ClampedArray(width*height*4);
  const mask=new Uint8ClampedArray(width*height*4);
  const pieces=[0,1,2,3,4,5].map((index)=>({
    x:10+index*25,y:16,w:25,h:50,fdi:String([13,12,11,21,22,23][index]),
  }));
  for(let y=0;y<height;y+=1)for(let x=0;x<width;x+=1){
    const i=(y*width+x)*4;
    pixels[i]=42;pixels[i+1]=28;pixels[i+2]=28;pixels[i+3]=255;
  }
  pieces.forEach((piece)=>{
    for(let y=piece.y;y<piece.y+piece.h;y+=1)for(let x=piece.x;x<piece.x+piece.w;x+=1){
      const i=(y*width+x)*4;
      const base=modo==='flat'?238:176+((x*7+y*11)%41);
      pixels[i]=Math.min(255,base+10);pixels[i+1]=Math.min(255,base+6);pixels[i+2]=base;pixels[i+3]=255;
      mask[i]=255;mask[i+1]=255;mask[i+2]=255;mask[i+3]=255;
    }
  });
  if(modo!=='flat'){
    pieces.slice(1).forEach((piece)=>{
      for(let y=piece.y+8;y<piece.y+piece.h-7;y+=1){
        const x=piece.x,i=(y*width+x)*4;
        pixels[i]=92;pixels[i+1]=86;pixels[i+2]=82;
      }
    });
  }
  if(modo==='blueprint'){
    pieces.forEach((piece)=>{
      for(let y=piece.y+7;y<piece.y+piece.h-7;y+=1){
        const x=piece.x+5+((y-piece.y)>>3);
        for(let dx=0;dx<2;dx+=1){
          const i=(y*width+x+dx)*4;
          pixels[i]=126;pixels[i+1]=54;pixels[i+2]=49;
        }
      }
    });
  }
  return {width,height,pixels,mask,pieces};
}

const natural=crearCoronasSinteticas('natural');
const integridadNatural=context.evaluarIntegridadVisualV102(
  natural.pixels,natural.mask,natural.width,natural.height,natural.pieces,natural.width,natural.height,
);
assert.equal(integridadNatural.artifacts.detected,false);
assert.equal(integridadNatural.independentTeeth.confirmed,true);
assert.equal(integridadNatural.independentTeeth.separators,5);

const planoCopiado=crearCoronasSinteticas('blueprint');
const integridadPlano=context.evaluarIntegridadVisualV102(
  planoCopiado.pixels,planoCopiado.mask,planoCopiado.width,planoCopiado.height,planoCopiado.pieces,planoCopiado.width,planoCopiado.height,
);
assert.equal(integridadPlano.artifacts.detected,true);
assert.ok(integridadPlano.artifacts.reasons.some((item)=>/líneas rojizas/.test(item)));
const evidenciaConPlano=structuredClone(evidenciaValida);
evidenciaConPlano.visual.artifacts=integridadPlano.artifacts;
assert.equal(context.evaluarContratoPresentacionV102(evidenciaConPlano).accepted,false);

const placa=crearCoronasSinteticas('flat');
const integridadPlaca=context.evaluarIntegridadVisualV102(
  placa.pixels,placa.mask,placa.width,placa.height,placa.pieces,placa.width,placa.height,
);
assert.equal(integridadPlaca.artifacts.detected,true);
assert.equal(integridadPlaca.artifacts.flatPlate,true);
assert.equal(integridadPlaca.independentTeeth.confirmed,false);

const originales = [200, 275, 350, 425, 500, 575].map((x, index) => ({
  x,
  y: 300,
  w: 70,
  h: 80,
  fdi: String([13, 12, 11, 21, 22, 23][index]),
}));
const capturaValida=context.evaluarCapturaDentalV102(originales,900,700);
assert.equal(capturaValida.accepted,true);
const capturaLejana=context.evaluarCapturaDentalV102(originales.map((p)=>({...p,w:10,h:12})),900,700);
assert.equal(capturaLejana.accepted,false);
assert.ok(capturaLejana.failures.some((item)=>/pocos píxeles/.test(item)));
const plano = context.construirPlanoGeometricoDental(originales, 900, 700, {
  family: 'rectangular-soft',
  sizeFactor: 1,
});

assert.deepEqual(Array.from(plano.pieces, (piece) => piece.id), ['13', '12', '11', '21', '22', '23']);
assert.ok(Math.abs(plano.targetMetrics.centralWidthHeight - 0.79) < 0.035);
assert.ok(Math.abs(plano.targetMetrics.lateralToCentral - 0.74) < 0.001);
assert.ok(Math.abs(plano.targetMetrics.canineToCentral - 0.80) < 0.001);

const prescripcionNumerica=context.construirPrescripcionNumericaV102(plano);
assert.match(prescripcionNumerica,/NO SECOND IMAGE IS SUPPLIED/);
assert.match(prescripcionNumerica,/FDI 13,role=canine,centerX=/);
assert.match(prescripcionNumerica,/FDI 11,role=central,centerX=/);
assert.match(prescripcionNumerica,/FDI 23,role=canine,centerX=/);
assert.equal((prescripcionNumerica.match(/FDI /g)||[]).length,6);
assert.doesNotMatch(extractFunction('prepararPlanoDentalIndividual'),/guideBase64|renderizarGuiaPlanoDental/);

const sinCambio = context.evaluarAnatomiaSegmentada({
  expectedPieces: originales,
  generatedPieces: originales,
  usedOriginalMaskFallback: false,
}, 'frontal', plano);
assert.ok(sinCambio.critical.length > 0);

// Una segmentación inconclusa del render no debe borrar una generación ya
// pagada. La máscara original sigue siendo la barrera determinista y el control
// visual evalúa la imagen usando las seis cajas fuente.
const lecturaInconclusa = {
  expectedPieces: originales,
  generatedPieces: originales.slice(0, 3),
  usedOriginalMaskFallback: true,
};
const conRespaldo = context.evaluarAnatomiaSegmentada(lecturaInconclusa, 'frontal', plano);
assert.equal(conRespaldo.critical.length, 0);
assert.equal(lecturaInconclusa.useGeneratedGeometryForQuality, false);
assert.equal(conRespaldo.metrics.verification, 'inconclusive');

const lecturaParcial = {
  expectedPieces: originales,
  generatedPieces: originales.slice(0, 4),
  usedOriginalMaskFallback: false,
};
const parcial = context.evaluarAnatomiaSegmentada(lecturaParcial, 'frontal', plano);
assert.equal(parcial.critical.length, 0);
assert.equal(lecturaParcial.useGeneratedGeometryForQuality, false);

const mensajeAnatomico = context.clasificarErrorParaUsuario(
  new Error('La simulación no superó la protección anatómica: anatomía dental inválida: fila plana con dientes repetidos.'),
);
assert.equal(mensajeAnatomico.titulo, 'La anatomía dental no es presentable');

const mensajeArtefacto = context.clasificarErrorParaUsuario(
  new Error('La simulación no superó el contrato visual v102: se detectaron líneas rojizas, recortes oscuros o una superficie blanca plana.'),
);
assert.equal(mensajeArtefacto.titulo, 'La propuesta contiene bordes artificiales');

const mensajeVersion = context.clasificarErrorParaUsuario(
  new Error('La simulación no superó el contrato visual v102: el backend no confirmó el contrato v102.'),
);
assert.equal(mensajeVersion.titulo, 'La actualización del simulador está incompleta');

const mensajeVisualCompatibilidad = context.clasificarErrorParaUsuario(
  new Error('La simulación no alcanzó el estándar visual de carillas: tono A1 demasiado amarillo.'),
);
assert.equal(mensajeVisualCompatibilidad.titulo, 'La propuesta requiere revisión visual');

const hallazgosRevision = context.consolidarHallazgosRevision(
  {critical:['fila plana'],warnings:['tono desigual','fila plana']},
  {status:'rejected',issues:['proporción central','tono desigual']},
  ['revisión clínica'],
);
assert.deepEqual(Array.from(hallazgosRevision), [
  'fila plana',
  'tono desigual',
  'proporción central',
  'revisión clínica',
]);

const recorteInferior = context.evaluarProteccionInferiorMascara(
  {y:100,h:50},
  {y:95,h:75},
  {y:63,h:94},
);
assert.equal(recorteInferior.clipped, true);
assert.equal(recorteInferior.protected, true);

const escapeInferior = context.evaluarProteccionInferiorMascara(
  {y:100,h:50},
  {y:95,h:75},
  {y:63,h:97},
);
assert.equal(escapeInferior.protected, false);

const ejecutado = context.evaluarAnatomiaSegmentada({
  expectedPieces: originales,
  generatedPieces: plano.pieces,
  usedOriginalMaskFallback: false,
}, 'frontal', plano);
assert.equal(ejecutado.critical.length, 0);
assert.ok(ejecutado.metrics.blueprint.improvement > 0.8);

// Una salida real puede traer decenas de componentes: coronas principales y
// pequeñas islas asignadas con parentFdi. No deben contarse como 46 dientes ni
// ampliar la máscara a la mandíbula; se consolidan en seis piezas anteriores.
const fragmentadas = [];
const superiores = ['14','13','12','11','21','22','23','24'];
superiores.forEach((fdi,index) => {
  const x = 60 + index * 60;
  fragmentadas.push({fdi,parentFdi:null,bbox:[x,100,50,68],pixelCount:1800,maskUrl:`upper-${fdi}`});
  fragmentadas.push({fdi:null,parentFdi:fdi,bbox:[x+4,104,12,10],pixelCount:80,maskUrl:`upper-frag-a-${fdi}`});
  fragmentadas.push({fdi:null,parentFdi:fdi,bbox:[x+29,151,14,9],pixelCount:70,maskUrl:`upper-frag-b-${fdi}`});
});
['43','42','41','31','32','33'].forEach((fdi,index) => {
  const x = 120 + index * 65;
  fragmentadas.push({fdi,parentFdi:null,bbox:[x,235,52,55],pixelCount:1500,maskUrl:`lower-${fdi}`});
  fragmentadas.push({fdi:null,parentFdi:fdi,bbox:[x+18,243,10,8],pixelCount:60,maskUrl:`lower-frag-${fdi}`});
});
while (fragmentadas.length < 46) {
  const i = fragmentadas.length;
  fragmentadas.push({fdi:null,parentFdi:'11',bbox:[270+(i%4),110+(i%7),6,5],pixelCount:20,maskUrl:`noise-${i}`});
}
const seis = context.seleccionarPiezasArcadaSuperior(fragmentadas,0,600,300);
assert.equal(seis.length,6);
assert.deepEqual(Array.from(seis,p => p.fdi),['13','12','11','21','22','23']);
assert.ok(context.mascarasDePiezasDentales(seis).length < fragmentadas.length);
assert.ok(context.mascarasDePiezasDentales(seis).length > 6);

const ausentesSuperiores = new Set(['22','23','24']);
const superiorIncompleta = fragmentadas.filter((mask) => !ausentesSuperiores.has(mask.parentFdi) && !ausentesSuperiores.has(mask.fdi));
assert.equal(context.seleccionarPiezasArcadaSuperior(superiorIncompleta,0,600,300).length,0);

console.log('simulation v102: alpha-only render, six numeric envelopes and six-crown contract passed');
