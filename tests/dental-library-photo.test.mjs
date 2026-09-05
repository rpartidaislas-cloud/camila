import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'biblioteca-carillas.html'), 'utf8');
const simulator = fs.readFileSync(path.join(root, 'simulacion.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const assets = ['central.png', 'lateral.png', 'canine.png'];

assert.match(html, /Carillas fotográficas por pieza/);
assert.match(html, /id="photo-input"[^>]*accept="image\/\*"/);
assert.match(html, /Subir mi foto/);
assert.match(html, /function extractSprite\(img\)/);
assert.match(html, /function toothLayout\(\)/);
assert.match(html, /canvas\.toBlob/);
assert.match(html, /La fotografía se procesa en este dispositivo\. No se sube ni se guarda\./);
assert.doesNotMatch(html, /supabase\.co|openai\.com|fetch\s*\(/i);

assets.forEach((asset) => {
  const relative = `assets/dental-library/natural-a1-v1/${asset}`;
  const file = path.join(root, ...relative.split('/'));
  assert.ok(fs.existsSync(file), `Falta ${relative}`);
  assert.ok(fs.statSync(file).size > 500_000, `${relative} no parece contener la textura fotográfica completa`);
  assert.ok(html.includes(relative), `${relative} no está conectado al laboratorio`);
  assert.ok(worker.includes(`/camila/${relative}`), `${relative} no está incluido en el caché PWA`);
});

assert.match(simulator, /href="biblioteca-carillas\.html"/);
assert.match(worker, /smyl-v80/);
assert.match(worker, /\/camila\/biblioteca-carillas\.html/);

console.log('SMYL photo-library POC: assets, local compositor and integration verified');
