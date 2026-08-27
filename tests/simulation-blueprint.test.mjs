import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../simulacion.html', import.meta.url), 'utf8');

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
vm.runInContext([
  extractFunction('clasificarErrorParaUsuario'),
  extractFunction('medianaNumerica'),
  extractFunction('agruparMascarasDentales'),
  extractFunction('resumirPiezasDentales'),
  extractFunction('seleccionarSeisPiezasAnteriores'),
  extractFunction('seleccionarPiezasArcadaSuperior'),
  extractFunction('mascarasDePiezasDentales'),
  extractFunction('limitarPlanoDental'),
  extractFunction('construirPlanoGeometricoDental'),
  extractFunction('emparejarPiezasDentales'),
  extractFunction('evaluarAnatomiaSegmentada'),
].join('\n'), context);

const originales = [200, 275, 350, 425, 500, 575].map((x, index) => ({
  x,
  y: 300,
  w: 70,
  h: 80,
  fdi: String([13, 12, 11, 21, 22, 23][index]),
}));
const plano = context.construirPlanoGeometricoDental(originales, 900, 700, {
  family: 'rectangular-soft',
  sizeFactor: 1,
});

assert.deepEqual(Array.from(plano.pieces, (piece) => piece.id), ['13', '12', '11', '21', '22', '23']);
assert.ok(Math.abs(plano.targetMetrics.centralWidthHeight - 0.79) < 0.035);
assert.ok(Math.abs(plano.targetMetrics.lateralToCentral - 0.74) < 0.001);
assert.ok(Math.abs(plano.targetMetrics.canineToCentral - 0.80) < 0.001);

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

console.log('simulation blueprint: 13-23 geometry, 46-fragment consolidation and quality gates passed');
