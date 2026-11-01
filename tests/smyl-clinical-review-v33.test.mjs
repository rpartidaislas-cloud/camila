import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.resolve(here, file), 'utf8');
const page = read('../revision-clinica.html');
const obsoletePage = read('../revisionclinica.html');
const css = read('../smyl-clinical-review-v33.css');
const js = read('../smyl-clinical-review-v33.js');
const fixture = read('./fixtures/smyl-clinical-review-v33-preview.html');

assert.match(page, /<body class="clinical-review-v33">/);
assert.match(page, /smyl-clinical-review-v33\.css/);
assert.match(page, /smyl-clinical-review-v33\.js/);
assert.doesNotMatch(obsoletePage, /smyl-clinical-review-v33/);

assert.match(css, /--review-control:\s*42px/);
assert.match(css, /--review-control:\s*44px/);
assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(340px,\s*420px\)/);
assert.match(css, /@media \(max-width:\s*1120px\)/);
assert.match(css, /@media \(max-width:\s*820px\)/);
assert.match(css, /@media \(max-width:\s*520px\)/);
assert.match(css, /:focus-visible/);
assert.match(css, /outline:\s*3px solid var\(--review-focus\)/);
assert.match(css, /data-review-state="loading"/);
assert.match(css, /data-review-state="empty"/);
assert.match(css, /data-review-state="error"/);
assert.match(css, /\.canvas-col2[\s\S]*var\(--review-evidence\)/);
assert.match(css, /\.panel-col2[\s\S]*var\(--review-decision\)/);
for (const match of css.matchAll(/font-size:\s*([0-9.]+)px/g)) {
  assert.ok(Number(match[1]) >= 12, `La capa v3.3 contiene microtexto: ${match[0]}`);
}

assert.match(js, /role', 'tablist'/);
assert.match(js, /aria-selected/);
assert.match(js, /tab\.disabled = unavailable/);
assert.match(js, /aria-pressed/);
assert.match(js, /ArrowRight/);
assert.match(js, /review-region-heading/);
assert.match(js, /Evidencia/);
assert.match(js, /Decisión/);
assert.match(js, /MutationObserver/);
assert.match(js, /dataset\.clinicalReviewReady/);
assert.doesNotMatch(js, /\bfetch\s*\(/);
assert.doesNotMatch(js, /supabase|openai|anthropic|replicate|DB_KEY|tenant_id|rpc\s*\(/i);

assert.match(fixture, /smyl-clinical-review-v33\.css/);
assert.match(fixture, /smyl-clinical-review-v33\.js/);
assert.match(fixture, /data-review-state="loading"/);
assert.match(fixture, /data-review-state="empty"/);
assert.match(fixture, /data-review-state="error"/);
assert.doesNotMatch(fixture, /data:image|https?:\/\//);

/* Contratos clínicos existentes: la capa de UI no reemplaza ni reimplementa
   generación, segmentación, diagnóstico, persistencia o descarga. */
for (const marker of [
  'function construirPromptCarillasIA',
  'async function generarSimulacionIA',
  'async function segmentar()',
  'async function guardarCasoCompleto()',
  'function descargarImagen()'
]) assert.ok(page.includes(marker), `Falta el contrato clínico existente: ${marker}`);

console.log('Clinical review workspace v3.3 contracts passed');
