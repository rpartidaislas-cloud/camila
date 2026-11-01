import assert from 'node:assert/strict';
import fs from 'node:fs';

const studio = fs.readFileSync('smyl-studio.js', 'utf8');
const css = fs.readFileSync('smyl-studio.css', 'utf8');
const html = fs.readFileSync('simulacion-rapida.html', 'utf8');

// All three product objectives must have a visual definition. A missing
// definition previously stopped the guided workspace before it was mounted.
for (const objective of ['veneers', 'alignment', 'combined']) {
  assert.match(studio, new RegExp(`${objective}:\\[`));
}
assert.match(studio, /if\(!copy\)return/);
assert.match(studio, /window\.abrirConfiguracionRapida\(\)/);

// The primary path is expressed in plain language. Clinical VITA codes remain
// available only through progressive disclosure for a professional choice.
for (const label of ['Mi tono actual', 'Natural', 'Claro natural', 'Muy claro']) {
  assert.match(studio, new RegExp(label));
}
assert.match(studio, /flow-tone-presets/);
assert.match(studio, /Ajuste profesional de tono/);
assert.match(studio, /Guía VITA/);
assert.match(css, /\.flow-tone-presets/);
assert.match(css, /\.flow-professional-tones/);

assert.match(html, /smyl-studio\.css\?v=20/);
assert.match(html, /smyl-studio\.js\?v=19/);

console.log('SMYL simulator: guided workspace boots and patient-friendly tone choices are verified');
