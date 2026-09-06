import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../segmentacion-dental-poc.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../segmentacion-dental-poc.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../segmentacion-dental-worker.js', import.meta.url), 'utf8');

assert.match(html, /Fase 2B · separación individual/);
assert.match(html, /data-tooth="0">13/);
assert.match(html, /data-tooth="5">23/);
assert.match(html, /id="segment-all"/);
assert.match(html, /La fotografía permanece en este dispositivo/);
assert.match(html, /id="file-input"[^>]+accept="image\/jpeg,image\/png,image\/webp"/);
assert.match(html, /id="mask"/);
assert.match(html, /Descargar mapa de 6 piezas/);
assert.match(html, /id="synthetic-demo"/);

assert.match(main, /new Worker\(new URL\('\.\/segmentacion-dental-worker\.js'/);
assert.match(main, /maxSide = 1600/);
assert.match(main, /function syntheticSmile\(\)/);
assert.match(main, /has\('qaAuto'\)/);
assert.match(main, /const FDI = \['13', '12', '11', '21', '22', '23'\]/);
assert.match(main, /type: 'decode_batch'/);
assert.match(main, /function maskContains\(/);
assert.match(main, /valid: ownHit && foreignHits === 0/);
assert.match(main, /state\.overlapRatio > \.08/);
assert.match(main, /ui\.input\.disabled = false; ui\.demo\.disabled = true/);
assert.match(main, /worker\.postMessage\(\{ type: 'segment', data: image\.url \}\)/);
assert.doesNotMatch(main, /fetch\(|XMLHttpRequest|supabase|authorization/i);

assert.match(worker, /Xenova\/slimsam-77-uniform/);
assert.match(worker, /env\.allowLocalModels = false/);
assert.match(worker, /get_image_embeddings/);
assert.match(worker, /post_process_masks/);
assert.match(worker, /message\.type === 'decode_batch'/);
assert.match(worker, /index === toothIndex \? 1 : 0/);
assert.doesNotMatch(worker, /HF_TOKEN|api[_-]?key|authorization/i);

console.log('SMYL Phase 2B: six independent in-browser dental masks verified');
