import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../segmentacion-dental-poc.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../segmentacion-dental-poc.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../segmentacion-dental-worker.js', import.meta.url), 'utf8');

assert.match(html, /Fase 2A · laboratorio local/);
assert.match(html, /La fotografía permanece en este dispositivo/);
assert.match(html, /id="file-input"[^>]+accept="image\/jpeg,image\/png,image\/webp"/);
assert.match(html, /id="mask"/);
assert.match(html, /Descargar máscara PNG/);
assert.match(html, /id="synthetic-demo"/);

assert.match(main, /new Worker\(new URL\('\.\/segmentacion-dental-worker\.js'/);
assert.match(main, /maxSide = 1600/);
assert.match(main, /function syntheticSmile\(\)/);
assert.match(main, /Math\.max\(0, Math\.min\(1, scores\[best\]\)\)/);
assert.match(main, /ui\.input\.disabled = true; ui\.demo\.disabled = true/);
assert.match(main, /worker\.postMessage\(\{ type: 'segment', data: image\.url \}\)/);
assert.doesNotMatch(main, /fetch\(|XMLHttpRequest|supabase|authorization/i);

assert.match(worker, /Xenova\/slimsam-77-uniform/);
assert.match(worker, /env\.allowLocalModels = false/);
assert.match(worker, /get_image_embeddings/);
assert.match(worker, /post_process_masks/);
assert.doesNotMatch(worker, /HF_TOKEN|api[_-]?key|authorization/i);

console.log('SMYL Phase 2A: private in-browser segmentation laboratory verified');
