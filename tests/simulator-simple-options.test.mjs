import assert from 'node:assert/strict';
import fs from 'node:fs';

const studio = fs.readFileSync('smyl-studio.js', 'utf8');
const css = fs.readFileSync('smyl-studio.css', 'utf8');
const html = fs.readFileSync('simulacion-rapida.html', 'utf8');

// The two distinct patient objectives must have a visual definition. The
// previous veneers-only card duplicated the combined path and was removed.
for (const objective of ['alignment', 'combined']) {
  assert.match(studio, new RegExp(`${objective}:\\[`));
}
assert.doesNotMatch(studio, /options:\{[\s\S]{0,80}veneers:\[/);
assert.match(studio, /if\(!copy\)return/);
assert.match(studio, /window\.abrirConfiguracionRapida\(\)/);

// The tone step has two simple comparison rows. No tab, quick preset or
// expandable scale can hide one guide from the other.
assert.doesNotMatch(studio, /patientToneChoices\.forEach/);
assert.match(studio, /flow-shade-comparison/);
assert.match(studio, /flow-shade-row/);
assert.match(studio, /Guía VITA/);
assert.match(studio, /Bleaches/);
assert.match(studio, /flow-vita-classical-track/);
assert.match(studio, /flow-vita-bleached-track/);
assert.match(studio, /Continuar con este tono/);
assert.match(studio, /data-shade-step/);
assert.match(studio, /Cambiar tono VITA/);
assert.match(studio, /openToneSelection/);
assert.match(studio, /S\.vitaTone='A2'/);
const vitaBlock = html.match(/var VITA_CLASSICAL = \[([\s\S]*?)\n\];/);
assert.ok(vitaBlock, 'VITA Classical source should remain available');
assert.deepEqual(
  [...vitaBlock[1].matchAll(/\{code:'([^']+)'/g)].map((match) => match[1]),
  ['B1','A1','B2','D2','A2','C1','C2','D4','A3','D3','B3','A3.5','B4','C3','A4','C4']
);
assert.match(css, /\.flow-vita-shell/);
assert.match(css, /\.flow-tone-continue/);
assert.match(css, /one continuous navy studio/);
assert.match(css, /no white UI surfaces and one canonical photo entry step/);
assert.match(studio, /photoWorkspace\.hidden=!primary/);
assert.match(studio, /classList\.toggle\('photo-first',!primary\)/);

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
assert.match(studio, /A2 es un punto de partida natural/);
assert.match(css, /\.flow-progress-track/);
assert.match(css, /\.flow-review-list/);
assert.match(studio, /flow-photo-coach/);
assert.match(studio, /icons\/ui\/smyl-face-capture-guide-v1\.png/);
assert.doesNotMatch(studio, /flow-coach-frame/);
assert.match(studio, /flow-photo-readiness/);
assert.match(studio, /flow-result-modes/);
assert.match(studio, /data-result-mode/);
assert.doesNotMatch(studio, /EXPLORA OTRA VERSIÓN/);
assert.match(studio, /flow-result-dock/);
assert.match(css, /\.flow-result-intro/);
assert.match(css, /\.flow-result-variant/);
assert.match(css, /One visual policy/);

assert.match(html, /smyl-studio\.css\?v=30/);
assert.match(html, /smyl-studio\.js\?v=29/);

console.log('SMYL simulator: progressive guidance and patient-friendly choices are verified');
