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
context.SIM_ACCEPTANCE_V105 = {
  version:'v105',
  minimumSourcePieces:6,
  minimumSourceCoverage:.88,
  minimumTargetCoverage:.82,
  minimumChangedRatio:.32,
  minimumMeanDifference:8,
  minimumTextureDeviation:7.5,
  maximumA1Yellow:17,
  minimumChangedRatioPerTooth:.28,
  maximumMaskOutsideEnvelopeRatio:.003,
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
  extractFunction('construirPiezasBandaDentalV1'),
  extractFunction('construirPlanoGeometricoDental'),
  extractFunction('evaluarCapturaDentalV104'),
  extractFunction('emparejarPiezasDentales'),
  extractFunction('evaluarAnatomiaSegmentada'),
  extractFunction('consolidarHallazgosRevision'),
  extractFunction('medirDiferenciasFueraMascara'),
  extractFunction('firmaEntradaDental'),
  extractFunction('evaluarContratoPresentacionV105'),
  extractFunction('evaluarIntegridadVisualV104'),
  extractFunction('construirPrescripcionNumericaV104'),
  extractFunction('limitarCanalCarillaV1'),
  extractFunction('resolverMaterialCarillaV1'),
].join('\n'), context);

assert.match(html, /var SMYL_DESIGN_ENGINE_V1_ENABLED = true/);
assert.match(html, /var SIM_QUALITY_VERSION = 29/);
const motorBiblioteca=extractFunction('renderizarSimulacionBibliotecaV1');
assert.match(motorBiblioteca, /plano\.pieces\.forEach/);
assert.match(motorBiblioteca, /trazarSiluetaPlanoDental/);
assert.match(motorBiblioteca, /suavizarMascaraHaciaDentroV104/);
assert.match(motorBiblioteca, /outsideTreatment:'original-pixel-source'/);
assert.match(motorBiblioteca, /continuousCrowns/);
assert.doesNotMatch(motorBiblioteca, /sourceMask|editMaskBase64|resultadoIA/);
const materialNatural=context.resolverMaterialCarillaV1(
  {code:'A1',screenRgb:[236,234,233]},
  {finish:'natural',intensity:'balanced',vitaMode:'vita'},
);
assert.deepEqual(Array.from(Object.values(materialNatural.rgb)),[236,234,233]);
assert.ok(materialNatural.opacity>.94&&materialNatural.opacity<.98);
const materialTranslucido=context.resolverMaterialCarillaV1(
  {code:'A1',screenRgb:[236,234,233]},
  {finish:'translucent',intensity:'notable',vitaMode:'vita'},
);
assert.ok(materialTranslucido.incisalCool>materialNatural.incisalCool);
assert.ok(materialTranslucido.opacity>materialNatural.opacity);

const compositorSeguro = extractFunction('componerConMascaraAnatomicaContinua');
assert.doesNotMatch(compositorSeguro, /segmentarParDental\s*\(/);
assert.match(compositorSeguro, /deliveryGate:'v105-safe-delivery-clinical-review'/);
assert.match(compositorSeguro, /generatedPieces:\[\]/);
assert.match(compositorSeguro, /evaluarContratoPresentacionV105/);
assert.match(compositorSeguro, /throw errorContrato/);
assert.match(compositorSeguro, /contract:'post-safety-clip-six-crowns'/);
assert.match(compositorSeguro, /mask:coberturaContrato/);
assert.doesNotMatch(compositorSeguro, /mask:tratamientoActual\.metrics/);
assert.match(html, /contractVersion:'v105'/);
const generadorV105=extractFunction('generateSimulation');
assert.match(generadorV105, /SMYL_DESIGN_ENGINE_V1_ENABLED/);
assert.match(generadorV105, /renderizarSimulacionBibliotecaV1/);
assert.match(generadorV105, /provider:'smyl-local'/);
assert.match(generadorV105, /deliveryGate:'six-complete-parametric-crowns'/);
assert.match(generadorV105, /if \(!SMYL_DESIGN_ENGINE_V1_ENABLED\)[\s\S]*autorizacion_ia/);
assert.ok(
  generadorV105.indexOf("if (SMYL_DESIGN_ENGINE_V1_ENABLED)") < generadorV105.indexOf("var tratamiento ="),
  'El motor determinista debe ejecutarse antes de construir la máscara fragmentable o llamar al proveedor',
);
assert.doesNotMatch(generadorV105, /IMAGE 2 already fixes/);
assert.doesNotMatch(generadorV105, /guideImageBase64:/);
assert.match(generadorV105, /There is NO second reference image and no visual blueprint/);
assert.match(generadorV105, /Never treat premolars, lower teeth or any unlisted tooth/);
assert.match(generadorV105, /The gingiva is outside the editable mask/);
assert.doesNotMatch(generadorV105, /requiresNewGeneration[\s\S]{0,180}delete S\.pendingGeneratedByView/);
assert.match(generadorV105, /localValidationContract:'v105'/);
assert.match(generadorV105, /revalidationMode:'cached-paid-proposal'/);
assert.match(extractFunction('saveProgress'), /pendingGeneratedByView/);
assert.match(extractFunction('continuarProgreso'), /revalidateCached:coincide/);
assert.doesNotMatch(extractFunction('processPhotos'), /processOptions\.revalidateCached[\s\S]{0,180}delete S\.pendingGeneratedByView/);
const procesoLocal=extractFunction('processPhotos');
assert.match(procesoLocal,/!SMYL_DESIGN_ENGINE_V1_ENABLED[\s\S]*CFG\.limiteDiagnosticos/);
assert.match(procesoLocal,/if \(!SMYL_DESIGN_ENGINE_V1_ENABLED\)[\s\S]*asegurarAutorizacionIA/);
assert.match(procesoLocal,/!processOptions\.revalidateCached && !SMYL_DESIGN_ENGINE_V1_ENABLED/);
assert.match(html, /function resumirDiagnosticoCalibracion/);
assert.match(html, /proc-error-diagnostics/);
assert.match(html, /proc-error-preview/);
const preparadorMascara=extractFunction('prepararMascaraTratamiento');
assert.match(preparadorMascara, /construirMascaraDestinoV104/);
assert.doesNotMatch(preparadorMascara, /solicitarSegmentacion\s*\(/);
const mascaraV104=extractFunction('construirMascaraDestinoV104');
assert.match(mascaraV104, /drawImage\(sourceMask/);
assert.match(mascaraV104, /drawImage\(targetMask/);
assert.match(mascaraV104, /destination-in/);
assert.match(mascaraV104, /fuenteExpandida/);
assert.match(mascaraV104, /alturaMediana\*\.13/);
assert.match(mascaraV104, /evaluarMascaraCoronalV104/);
assert.match(mascaraV104, /suavizarMascaraHaciaDentroV104/);
assert.doesNotMatch(mascaraV104, /fillRect|regionExpandida/);
assert.match(preparadorMascara, /stage:'v105-single-mask-preflight'/);
assert.match(backend, /X-SMYL-Contract/);
assert.match(backend, /contract:\s*simulationContract/);
assert.match(backend, /simulationContract === "v101" \|\| simulationContract === "v102" \|\| simulationContract === "v103" \|\| simulationContract === "v104" \|\| simulationContract === "v105"/);
assert.match(backend, /simulationContract === "v105"/);
assert.match(backend, /V105 REVIEWABLE SINGLE-MASK CROWN-ONLY DENTAL EDIT/);
assert.match(backend, /The mask contains no gingiva/);
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
assert.doesNotMatch(validacionRecibida, /throw errorSinCambio/);
assert.doesNotMatch(validacionRecibida, /throw errorMarcas/);
assert.match(validacionRecibida, /posibles marcas técnicas; la propuesta se muestra con revisión recomendada/i);
assert.match(validacionRecibida, /cambio dental conservador; se entrega con revisión recomendada/i);

const evidenciaValida = {
  trace:{provider:'openai',model:'gpt-image-2-2026-04-21',contract:'v105'},
  outsideMask:{identical:true,changedPixels:0},
  sourcePieces:6,
  mask:{sourceCoverage:.96,targetCoverage:.94},
  visual:{changed:.58,meanDifference:24,texture:15,yellow:8,artifacts:{detected:false},independentTeeth:{confirmed:true}},
  perToothChange:['13','12','11','21','22','23'].map((id)=>({id,changedRatio:.52})),
  vitaTone:'A1',
};
const contratoValido = context.evaluarContratoPresentacionV105(evidenciaValida);
assert.equal(contratoValido.accepted,true);
assert.equal(contratoValido.status,'ready-for-clinical-review');

const evidenciaRevalidadaV104=structuredClone(evidenciaValida);
evidenciaRevalidadaV104.trace={
  provider:'openai',model:'gpt-image-2-2026-04-21',contract:'v104',
  localValidationContract:'v105',revalidationMode:'cached-paid-proposal',
};
const contratoRevalidadoV104=context.evaluarContratoPresentacionV105(evidenciaRevalidadaV104);
assert.equal(contratoRevalidadoV104.accepted,true);

const evidenciaInerte = structuredClone(evidenciaValida);
evidenciaInerte.visual.changed=.05;
evidenciaInerte.visual.meanDifference=2;
evidenciaInerte.perToothChange[3].changedRatio=.02;
const contratoInerte=context.evaluarContratoPresentacionV105(evidenciaInerte);
assert.equal(contratoInerte.accepted,true);
assert.ok(contratoInerte.reviewFindings.some((item)=>/cambio dental visible/.test(item)));
assert.ok(contratoInerte.reviewFindings.some((item)=>/carillas muestran/.test(item)));

const evidenciaFuera=structuredClone(evidenciaValida);
evidenciaFuera.outsideMask={identical:false,changedPixels:1};
assert.equal(context.evaluarContratoPresentacionV105(evidenciaFuera).accepted,false);

const evidenciaSinTraza=structuredClone(evidenciaValida);
evidenciaSinTraza.trace={provider:'openai',model:'desconocido'};
assert.equal(context.evaluarContratoPresentacionV105(evidenciaSinTraza).accepted,false);

const evidenciaMascaraRectangular=structuredClone(evidenciaValida);
evidenciaMascaraRectangular.mask.outsideEnvelopeRatio=.08;
const contratoMascaraRectangular=context.evaluarContratoPresentacionV105(evidenciaMascaraRectangular);
assert.equal(contratoMascaraRectangular.accepted,false);
assert.ok(contratoMascaraRectangular.failures.some((item)=>/seis coronas protegidas/.test(item)));

// Regresión v105: seis coronas naturales deben conservar separaciones finas.
// Los indicios visuales se conservan como revisión; nunca ocultan la propuesta.
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
  if(modo==='edge-outline'){
    pieces.forEach((piece)=>{
      for(let y=piece.y;y<piece.y+piece.h;y+=1)for(let x=piece.x;x<piece.x+piece.w;x+=1){
        const borde=x===piece.x||x===piece.x+piece.w-1||y===piece.y||y===piece.y+piece.h-1;
        if(!borde)continue;
        const i=(y*width+x)*4;
        pixels[i]=128;pixels[i+1]=65;pixels[i+2]=52;
      }
    });
  }
  if(modo==='cervical-natural'){
    pieces.forEach((piece)=>{
      for(let y=piece.y;y<piece.y+Math.round(piece.h*.22);y+=1)for(let x=piece.x;x<piece.x+piece.w;x+=1){
        const i=(y*width+x)*4;
        pixels[i]=138;pixels[i+1]=82;pixels[i+2]=72;
      }
    });
  }
  return {width,height,pixels,mask,pieces};
}

const natural=crearCoronasSinteticas('natural');
const integridadNatural=context.evaluarIntegridadVisualV104(
  natural.pixels,natural.mask,natural.width,natural.height,natural.pieces,natural.width,natural.height,
);
assert.equal(integridadNatural.artifacts.detected,false);
assert.equal(integridadNatural.independentTeeth.confirmed,true);
assert.equal(integridadNatural.independentTeeth.separators,5);

const cervicalNatural=crearCoronasSinteticas('cervical-natural');
const integridadCervical=context.evaluarIntegridadVisualV104(
  cervicalNatural.pixels,cervicalNatural.mask,cervicalNatural.width,cervicalNatural.height,cervicalNatural.pieces,cervicalNatural.width,cervicalNatural.height,
);
assert.equal(integridadCervical.artifacts.detected,false);

const planoCopiado=crearCoronasSinteticas('blueprint');
const integridadPlano=context.evaluarIntegridadVisualV104(
  planoCopiado.pixels,planoCopiado.mask,planoCopiado.width,planoCopiado.height,planoCopiado.pieces,planoCopiado.width,planoCopiado.height,
);
assert.equal(integridadPlano.artifacts.detected,true);
assert.ok(integridadPlano.artifacts.reasons.some((item)=>/líneas rojizas/.test(item)));
const evidenciaConPlano=structuredClone(evidenciaValida);
evidenciaConPlano.visual.artifacts=integridadPlano.artifacts;
const contratoConPlano=context.evaluarContratoPresentacionV105(evidenciaConPlano);
assert.equal(contratoConPlano.accepted,true);
assert.ok(contratoConPlano.reviewFindings.some((item)=>/líneas rojizas/.test(item)));

const contornoTecnico=crearCoronasSinteticas('edge-outline');
const integridadContorno=context.evaluarIntegridadVisualV104(
  contornoTecnico.pixels,contornoTecnico.mask,contornoTecnico.width,contornoTecnico.height,contornoTecnico.pieces,contornoTecnico.width,contornoTecnico.height,
);
assert.equal(integridadContorno.artifacts.detected,true,JSON.stringify(integridadContorno.artifacts));
assert.ok(integridadContorno.artifacts.boundaryRedAffectedTeeth>=2);
assert.ok(integridadContorno.artifacts.reasons.some((item)=>/bordes técnicos/.test(item)));
const evidenciaConContorno=structuredClone(evidenciaValida);
evidenciaConContorno.visual.artifacts=integridadContorno.artifacts;
assert.equal(context.evaluarContratoPresentacionV105(evidenciaConContorno).accepted,true);

const placa=crearCoronasSinteticas('flat');
const integridadPlaca=context.evaluarIntegridadVisualV104(
  placa.pixels,placa.mask,placa.width,placa.height,placa.pieces,placa.width,placa.height,
);
assert.equal(integridadPlaca.artifacts.detected,true);
assert.equal(integridadPlaca.artifacts.flatPlate,true);
assert.equal(integridadPlaca.independentTeeth.confirmed,false);
const evidenciaConPlaca=structuredClone(evidenciaValida);
evidenciaConPlaca.visual.artifacts=integridadPlaca.artifacts;
evidenciaConPlaca.visual.independentTeeth=integridadPlaca.independentTeeth;
const contratoConPlaca=context.evaluarContratoPresentacionV105(evidenciaConPlaca);
assert.equal(contratoConPlaca.accepted,true);
assert.ok(contratoConPlaca.reviewFindings.some((item)=>/superficie blanca plana/.test(item)));

const originales = [200, 275, 350, 425, 500, 575].map((x, index) => ({
  x,
  y: 300,
  w: 70,
  h: 80,
  fdi: String([13, 12, 11, 21, 22, 23][index]),
}));
const capturaValida=context.evaluarCapturaDentalV104(originales,900,700);
assert.equal(capturaValida.accepted,true);
const capturaLejana=context.evaluarCapturaDentalV104(originales.map((p)=>({...p,w:10,h:12})),900,700);
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
assert.ok(plano.pieces.every((piece,index)=>piece.y===originales[index].y));
assert.ok(plano.pieces.every((piece,index)=>piece.h<=originales[index].h*1.12+0.001));

const piezasLocales=context.construirPiezasBandaDentalV1(
  {x:180,y:260,w:540,h:150,cx:450,cy:335,confidence:.82},900,700,
);
assert.equal(piezasLocales.length,6);
assert.deepEqual(Array.from(piezasLocales,p=>p.fdi),['13','12','11','21','22','23']);
assert.ok(piezasLocales.every(p=>p.x>=0&&p.y>=0&&p.x+p.w<=900&&p.y+p.h<=700));
assert.ok(piezasLocales[2].w>piezasLocales[1].w);
assert.ok(piezasLocales[2].h>piezasLocales[0].h);
assert.ok(Math.abs((piezasLocales[2].x+piezasLocales[2].w)-(piezasLocales[3].x))<10);

const planoEditor = context.construirPlanoGeometricoDental(originales, 900, 700, {
  family: 'oval',
  sizeFactor: 1,
  heightAdjustments: [-12, -6, 8, 8, -6, -12],
});
assert.equal(planoEditor.family, 'oval');
assert.ok(planoEditor.pieces[2].h > plano.pieces[2].h);
assert.ok(planoEditor.pieces[0].h < plano.pieces[0].h);
assert.ok(planoEditor.pieces.every((piece,index)=>piece.y===originales[index].y));
assert.ok(planoEditor.pieces.every((piece,index)=>piece.h<=originales[index].h*1.12+0.001));
const preparadorPlano=extractFunction('prepararPlanoDentalIndividual');
assert.match(preparadorPlano,/S\.editorParams/);
assert.match(preparadorPlano,/heightAdjustments/);
assert.match(preparadorPlano,/rectangular:'rectangular-soft'/);
assert.match(preparadorPlano,/construirMapaDentalLocalV1/);
assert.match(preparadorPlano,/locator==='local-band-v1'/);
assert.match(extractFunction('elegirTonoDesdeResultado'),/SMYL_DESIGN_ENGINE_V1_ENABLED[\s\S]*regenerarSimulacion/);
assert.match(extractFunction('edAplicarDiseno'),/!SMYL_DESIGN_ENGINE_V1_ENABLED/);

const prescripcionNumerica=context.construirPrescripcionNumericaV104(plano);
assert.match(prescripcionNumerica,/NO SECOND IMAGE IS SUPPLIED/);
assert.match(prescripcionNumerica,/FDI 13,role=canine,centerX=/);
assert.match(prescripcionNumerica,/FDI 11,role=central,centerX=/);
assert.match(prescripcionNumerica,/FDI 23,role=canine,centerX=/);
assert.equal((prescripcionNumerica.match(/FDI /g)||[]).length,6);
assert.doesNotMatch(preparadorPlano,/guideBase64|renderizarGuiaPlanoDental/);

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
  new Error('La simulación no superó el contrato visual v105: se detectaron líneas rojizas, recortes oscuros o una superficie blanca plana.'),
);
assert.equal(mensajeArtefacto.titulo, 'La propuesta contiene bordes artificiales');

const mensajeVersion = context.clasificarErrorParaUsuario(
  new Error('La simulación no superó el contrato visual v105: el backend no confirmó el contrato v105.'),
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

console.log('SMYL Design Engine v1: six complete crowns render locally with deterministic editor controls');
