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
assert.match(studio, /GUÍA VITA CLASSICAL/);
assert.match(studio, /Desliza para elegir el tono/);
assert.match(studio, /Continuar con este tono/);
assert.match(studio, /data-shade-step/);
assert.match(studio, /Abrir guía VITA/);
assert.match(studio, /openToneSelection/);
assert.doesNotMatch(studio, /chooseTone\(choice\.code\);advanceGuided/);
const vitaBlock = html.match(/var VITA_CLASSICAL = \[([\s\S]*?)\n\];/);
assert.ok(vitaBlock, 'VITA Classical source should remain available');
assert.deepEqual(
  [...vitaBlock[1].matchAll(/\{code:'([^']+)'/g)].map((match) => match[1]),
  ['B1','A1','B2','D2','A2','C1','C2','D4','A3','D3','B3','A3.5','B4','C3','A4','C4']
);
assert.match(css, /\.flow-tone-presets/);
assert.match(css, /\.flow-vita-shell/);
assert.match(css, /\.flow-tone-continue/);

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
assert.match(studio, /flow-result-dock/);
assert.match(css, /\.flow-result-intro/);
assert.match(css, /\.flow-result-variant/);
assert.match(css, /One visual policy/);

assert.match(html, /smyl-studio\.css\?v=23/);
assert.match(html, /smyl-studio\.js\?v=22/);

console.log('SMYL simulator: progressive guidance and patient-friendly choices are verified');
