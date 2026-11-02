import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const html = fs.readFileSync('simulacion-rapida.html', 'utf8');
const studio = fs.readFileSync('smyl-studio.js', 'utf8');
const css = fs.readFileSync('smyl-studio.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const samplesSource = fs.readFileSync('smyl-vita-samples.js', 'utf8');
const localTone = fs.readFileSync('smyl-local-tone.js', 'utf8');
const photoBatch = fs.readFileSync('smyl-photo-batch.js', 'utf8');
const caseModel = fs.readFileSync('smyl-case-model.js', 'utf8');
const composition = fs.readFileSync('visual-composition.js', 'utf8');
const simulation = fs.readFileSync('visual-simulation.js', 'utf8');
const mobileSync = fs.readFileSync('mobile/scripts/sync-web.js', 'utf8');

const mobileHtml = fs.readFileSync('mobile/www/simulacion-rapida.html', 'utf8');
const mobileStudio = fs.readFileSync('mobile/www/smyl-studio.js', 'utf8');
const mobileCss = fs.readFileSync('mobile/www/smyl-studio.css', 'utf8');
const mobileSw = fs.readFileSync('mobile/www/sw.js', 'utf8');
const mobileMirrors = new Map([
  ['smyl-vita-samples.js', samplesSource],
  ['smyl-local-tone.js', localTone],
  ['smyl-photo-batch.js', photoBatch],
  ['smyl-case-model.js', caseModel],
  ['visual-composition.js', composition],
  ['visual-simulation.js', simulation]
]);

function arrayCodes(source, variable) {
  const block = source.match(new RegExp(`var ${variable} = \\[([\\s\\S]*?)\\n\\];`));
  assert.ok(block, `${variable} must be declared as its own shade guide`);
  return [...block[1].matchAll(/\{code:'([^']+)'/g)].map((match) => match[1]);
}

// Classical remains unchanged and continues to be the safe default for old
// cases. The bleaching scale is a separate clinical reference, never an
// extension silently appended to the Classical array.
assert.deepEqual(arrayCodes(html, 'VITA_CLASSICAL'), [
  'B1','A1','B2','D2','A2','C1','C2','D4','A3','D3','B3','A3.5','B4','C3','A4','C4'
]);
assert.deepEqual(arrayCodes(html, 'VITA_BLEACHEDGUIDE'), [
  '0M1','0.5M1','1M1','1M1.5','1M2','1.5M2','2M2','2.5M2','3M2','3.5M2','4M2','4.5M2','5M2','5M2.5','5M3'
]);
const bleachShortcuts = html.match(/var VITA_BLEACHED_SHADES = \[([\s\S]*?)\n\];/);
assert.ok(bleachShortcuts, 'VITA_BLEACHED_SHADES must remain a separate patient shortcut set');
assert.match(bleachShortcuts[1], /VITA_BLEACHEDGUIDE\[0\]/, '0M1 should reuse the canonical Bleachedguide sample');
assert.deepEqual(
  ['0M1', ...[...bleachShortcuts[1].matchAll(/\{code:'([^']+)'/g)].map((match) => match[1])],
  ['0M1','0M2','0M3']
);

// Display samples are finite, in gamut and individually addressable for the
// complete professional scale. The three quick choices remain supported but
// do not alter the canonical 15-code guide above.
const samples = require('../smyl-vita-samples.js');
const fullBleachedGuide = arrayCodes(html, 'VITA_BLEACHEDGUIDE');
const renderedBleached = fullBleachedGuide.map((code) => {
  assert.equal(samples.has(code), true, `display sample missing for ${code}`);
  assert.equal(samples.guide(code), 'bleached', `${code} must resolve to the Bleach system`);
  const rgb = samples.rgb(code);
  assert.equal(rgb.length, 3);
  assert.ok(rgb.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255));
  return rgb.join(',');
});
assert.equal(new Set(renderedBleached).size, fullBleachedGuide.length, 'all 15 Bleachedguide samples must remain visually distinguishable');
for (const code of ['0M1','0M2','0M3']) {
  assert.equal(samples.has(code), true, `quick Bleach sample missing for ${code}`);
  assert.equal(samples.guide(code), 'bleached');
}
assert.match(samplesSource, /display approximation/i);

// State and compatibility: new cases start in Classical A2, old snapshots
// without a guide restore as Classical, and both guide and tone persist.
assert.match(html, /shadeGuide:\s*'classical'/);
assert.match(html, /shadeGuide:\s*S\.shadeGuide/);
assert.match(html, /normalizarGuiaTono\(snap\.shadeGuide\s*\|\|\s*guiaDeCodigoTono\(snap\.vitaTone\)\)/);
assert.match(html, /function normalizarGuiaTono\(value\)/);
assert.match(html, /return value\s*===\s*'bleached'\s*\?\s*'bleached'\s*:\s*'classical'/);
assert.match(studio, /S\.vitaTone='A2'/);
assert.match(studio, /shadeGuide/);
assert.match(studio, /classical/);
assert.match(studio, /bleached/);

// Locally saved per-photo shade adjustments are schema-versioned. Records
// created before shadeGuide existed restore as Classical; schema 2 keeps the
// explicit guide. Case exports and cache keys carry the same distinction.
assert.match(localTone, /\[1,2\]\.includes\(record\.schema\)/);
assert.match(localTone, /shadeGuide:record\.schema===1\?'classical':normalizeGuide\(record\.shadeGuide\)/);
assert.match(localTone, /schema:\s*2[\s\S]*?shadeGuide/);
assert.match(caseModel, /shadeGuide:\s*state\.shadeGuide\s*===\s*'bleached'\s*\?\s*'bleached'\s*:\s*'classical'/);
assert.match(photoBatch, /S\.shadeGuide\s*\|\|\s*'classical'/);
assert.match(composition, /record\.options\.shadeGuide\s*\|\|\s*'classical'/);

// The guided surface separates both systems and keeps current tone as a
// distinct action. Patient copy must not imply calibrated shade measurement.
assert.match(studio, /Naturales/);
assert.match(studio, /Blanqueamiento/);
assert.match(studio, /VITA Bleachedguide 3D-MASTER/);
assert.match(studio, /Representaci[oó]n digital orientativa/i);
assert.match(studio, /gu[ií]a f[ií]sica/i);
assert.match(studio, /Mi tono/);
assert.match(css, /flow-shade-guide/);

// Review/result labels retain the selected system rather than presenting a
// Bleachedguide code as Classical. Generation must also name the active system.
assert.match(studio, /VITA Classical/);
assert.match(studio, /Bleachedguide/);
assert.match(html, /SHADE SYSTEM:\s*VITA Bleachedguide 3D-MASTER/);
assert.match(html, /SHADE SYSTEM:\s*VITA Classical/);
assert.match(html, /S\.shadeGuide\s*===\s*'bleached'/);
assert.match(html, /function buscarTonoVita\(code, guide\)/);
assert.match(html, /VITA_BLEACHEDGUIDE\.concat\(VITA_BLEACHED_SHADES\)/);
assert.match(simulation, /guide\s*===\s*'bleached'\s*\?\s*'0M2'\s*:\s*'A1'/, 'a missing Bleach tone must never degrade silently to Classical A1');
assert.match(simulation, /shadeGuide/);
assert.match(simulation, /shadeSystem/);
assert.match(simulation, /baseShadeGuide/);
assert.match(simulation, /VITA Bleachedguide 3D-MASTER/);
assert.match(simulation, /VITA Bleached Shades/);

// Publication safety: web/mobile mirrors and service-worker versions must be
// synchronized so the added guide cannot disappear only in the installed app.
assert.equal(mobileHtml, html, 'simulator HTML must match the mobile mirror');
assert.equal(mobileStudio, studio, 'studio controller must match the mobile mirror');
assert.equal(mobileCss, css, 'studio styles must match the mobile mirror');
assert.equal(mobileSw, sw, 'service worker must match the mobile mirror');
for (const [file, rootSource] of mobileMirrors) {
  assert.ok(mobileSync.includes(`copyFile(path.join(ROOT, '${file}')`), `${file} must be part of the repeatable mobile sync`);
  assert.equal(fs.readFileSync(`mobile/www/${file}`, 'utf8'), rootSource, `${file} must match its mobile mirror`);
}
assert.match(sw, /bleach-guide-v8/);

console.log('SMYL simulator: Classical and Bleachedguide shade systems are separated, persisted and generation-aware');
