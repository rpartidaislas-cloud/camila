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

// The configuration behaves as a progressive conversation: photo, objective,
// arch, tone and review. Only the current panel is visible, and every summary
// choice can be edited without restarting the case.
assert.match(studio, /guidedStage=0/);
assert.match(studio, /function renderProgressive\(\)/);
for (const stage of ['photo', 'objective', 'arch', 'review']) {
  assert.match(studio, new RegExp(`flow-stage-${stage}`));
}
assert.match(studio, /flow-progress-track/);
assert.match(studio, /data-edit-stage/);
assert.match(studio, /Natural suele ser un buen punto de partida/);
assert.match(css, /\.flow-progress-track/);
assert.match(css, /\.flow-review-list/);
assert.match(studio, /flow-photo-coach/);
assert.match(studio, /flow-photo-readiness/);
assert.match(studio, /flow-result-modes/);
assert.match(studio, /data-result-mode/);
assert.match(studio, /EXPLORA OTRA VERSIÓN/);
assert.match(css, /\.flow-result-intro/);
assert.match(css, /\.flow-result-variant/);

assert.match(html, /smyl-studio\.css\?v=23/);
assert.match(html, /smyl-studio\.js\?v=21/);

console.log('SMYL simulator: progressive guidance and patient-friendly choices are verified');
