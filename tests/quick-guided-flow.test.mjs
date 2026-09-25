import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'simulacion-rapida.html'), 'utf8');

assert.match(html, /Nueva simulación rápida/);
assert.match(html, /Foto[\s\S]*Resultado[\s\S]*Revisa/);
assert.match(html, /id="quick-config"/);
assert.match(html, /data-quick-objective="veneers"/);
assert.match(html, /data-quick-objective="alignment"/);
assert.match(html, /data-quick-objective="combined"/);
assert.match(html, /data-quick-appearance="current"/);
assert.match(html, /data-quick-appearance="A1"/);
assert.match(html, /data-quick-appearance="B1"/);
assert.match(html, /data-quick-arch="upper"/);
assert.match(html, /data-quick-arch="lower"/);
assert.match(html, /data-quick-arch="both"/);
assert.match(html, /id="quick-vita-tone"/);
assert.doesNotMatch(html, /<script src="dental-review/);
const visual=fs.readFileSync(path.join(root,'visual-simulation.js'),'utf8');
assert.doesNotMatch(visual,/await root\.SmylDentalReview\.open/);
const objective=html.slice(html.indexOf('function seleccionarObjetivoRapido'),html.indexOf('function seleccionarArcadaRapida'));
assert.doesNotMatch(objective,/\[name=smile-arch\]/);
assert.match(html, /function comenzarFlujoAvanzado\(\)/);
assert.match(html, /S\.quickGuided && view\.id === 'frontal'/);
assert.match(html, /S\.quickGuided && VIEWS\[S\.currentPhoto - 1\]\?\.id === 'frontal'/);
assert.match(html, /if\(S\.quickGuided && S\.photos\.some[\s\S]*await processPhotos\(\);return;/);
assert.match(html, /Propuesta visual orientativa\. No diagnostica ni sustituye la valoración clínica\./);
assert.match(html, /Cambiar apariencia/);
assert.match(html, /data-res-appearance="current"/);
assert.match(html, /data-res-appearance="A1"/);
assert.match(html, /data-res-appearance="B1"/);
assert.match(html, /function aplicarTonoDesdeResultado\(\)/);
assert.doesNotMatch(html.slice(html.indexOf('function abrirGuiaVitaDesdeResultado'), html.indexOf('function activarModoVitaFullscreen')), /activarModoVitaFullscreen\(\)/);

console.log('SMYL quick guided flow: camera-first route, simple choices and advanced fallback verified');
