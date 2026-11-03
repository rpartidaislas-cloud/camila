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
// cases. The four choices offered for a new Bleach simulation use the distinct
// Ivoclar BL notation; B1-B4 remain VITA Classical and must never be relabelled
// as Bleach shades.
assert.deepEqual(arrayCodes(html, 'VITA_CLASSICAL'), [
  'B1','A1','B2','D2','A2','C1','C2','D4','A3','D3','B3','A3.5','B4','C3','A4','C4'
]);
assert.deepEqual(arrayCodes(html, 'BLEACH_BL_SHADES'), ['BL1','BL2','BL3','BL4']);
assert.match(html, /var VITA_BLEACHEDGUIDE = BLEACH_BL_SHADES;/);
assert.match(html, /var VITA_BLEACHED_SHADES = BLEACH_BL_SHADES;/);
assert.match(html, /B1.B4[\s\S]*?pertenecen a VITA Classical/);

// Historical VITA Bleached codes remain readable so an existing case is not
// silently converted to a different manufacturer's scale. They are deliberately
// excluded from tonosGuiaTono('bleached'), the source used by new selectors.
const legacyBleached = [
  '0M1','0M2','0M3','0.5M1','1M1','1M1.5','1M2','1.5M2','2M2','2.5M2','3M2','3.5M2','4M2','4.5M2','5M2','5M2.5','5M3'
];
assert.deepEqual(arrayCodes(html, 'LEGACY_BLEACHED_SHADES'), legacyBleached);
assert.match(html, /function tonosGuiaTono\(guide\)[\s\S]*?\? BLEACH_BL_SHADES : VITA_CLASSICAL/);
assert.match(html, /function tonosVitaTodos\(\)[\s\S]*?VITA_CLASSICAL\.concat\(BLEACH_BL_SHADES,LEGACY_BLEACHED_SHADES\)/);
assert.match(html, /BLEACH_BL_SHADES\.concat\(LEGACY_BLEACHED_SHADES\)/);

// The four current choices are finite, in gamut, individually addressable and
// visually ordered. Legacy samples remain available only for restored cases.
const samples = require('../smyl-vita-samples.js');
const currentBleached = arrayCodes(html, 'BLEACH_BL_SHADES');
const renderedBleached = currentBleached.map((code) => {
  assert.equal(samples.has(code), true, `display sample missing for ${code}`);
  assert.equal(samples.guide(code), 'bleached', `${code} must resolve to the Bleach system`);
  const rgb = samples.rgb(code);
  assert.equal(rgb.length, 3);
  assert.ok(rgb.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255));
  return rgb.join(',');
});
assert.equal(new Set(renderedBleached).size, 4, 'BL1-BL4 must remain visually distinguishable');
for (const code of legacyBleached) {
  assert.equal(samples.has(code), true, `legacy Bleach sample missing for ${code}`);
  assert.equal(samples.guide(code), 'bleached');
}
assert.match(samplesSource, /display approximation/i);
assert.match(samplesSource, /current Ivoclar Bleach BL range/);

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
assert.match(html, /shadeToneByGuide:\s*\{classical:'A2',bleached:'BL2'\}/);
assert.match(html, /shadeCompareByGuide:\s*\{classical:'C1',bleached:'BL1'\}/);
assert.match(html, /return normalizarGuiaTono\(guide\) === 'bleached' \? 'BL2' : 'A2'/);

// Locally saved per-photo shade adjustments are schema-versioned. Records
// created before shadeGuide existed restore as Classical; schema 2 keeps the
// explicit guide. Case exports and cache keys carry the same distinction.
assert.match(localTone, /\[1,2\]\.includes\(record\.schema\)/);
assert.match(localTone, /shadeGuide:record\.schema===1\?'classical':normalizeGuide\(record\.shadeGuide\)/);
assert.match(localTone, /schema:\s*2[\s\S]*?shadeGuide/);
assert.match(localTone, /currentBleachedCodes = \['BL1','BL2','BL3','BL4'\]/);
assert.match(localTone, /legacyBleachedCodes = \['0M3','0M2','0M1'/);
assert.match(localTone, /visibleCodes = shadeGuide === 'bleached' \? currentBleachedCodes : classicalCodes/);
assert.match(caseModel, /shadeGuide:\s*state\.shadeGuide\s*===\s*'bleached'\s*\?\s*'bleached'\s*:\s*'classical'/);
assert.match(caseModel, /state\.shadeGuide === 'bleached' \? 'BL2' : 'A1'/);
assert.match(photoBatch, /S\.shadeGuide\s*\|\|\s*'classical'/);
assert.match(composition, /record\.options\.shadeGuide\s*\|\|\s*'classical'/);

// The guided surface shows two simple, always-visible carousels. It must not
// reintroduce tabs, quick presets or an expandable professional scale.
assert.match(studio, /flow-shade-comparison/);
assert.match(studio, /\['classical','Guía VITA','Tonos naturales'\]/);
assert.match(studio, /\['bleached','Bleaches','BL1 a BL4'\]/);
assert.match(studio, /flow-vita-classical-track/);
assert.match(studio, /flow-vita-bleached-track/);
assert.match(studio, /shadeCarousels=\{classical:null,bleached:null\}/);
assert.match(studio, /chooseShadeToneForGuide\(guide,code\)/);
assert.match(studio, /dataset\.flowGuide=guide/);
assert.doesNotMatch(studio, /flow-shade-guide-tabs|flow-bleach-quick|flow-professional-guide/);
assert.match(studio, /window\.BLEACH_BL_SHADES/);
assert.doesNotMatch(studio, /VITA_BLEACHEDGUIDE\|\|\[\]\)\.concat/);
assert.match(studio, /Referencia digital orientativa/i);
assert.match(studio, /gu[ií]as f[ií]sicas/i);
assert.match(studio, /Bleaches ·/);
assert.match(studio, /Guía VITA ·/);
assert.match(css, /flow-shade-comparison/);
assert.match(css, /flow-shade-row/);
assert.doesNotMatch(css, /flow-shade-guide-tabs|flow-bleach-quick|flow-bleach-professional/);

// Review/result labels retain the selected system. Current BL choices name
// Ivoclar explicitly, while legacy VITA values keep their historical system.
assert.match(studio, /VITA Classical/);
assert.match(studio, /Ivoclar Bleach BL/);
assert.match(html, /SHADE SYSTEM:\s*Ivoclar Bleach BL/);
assert.match(html, /historical VITA Bleachedguide 3D-MASTER/);
assert.match(html, /SHADE SYSTEM:\s*VITA Classical/);
assert.match(html, /S\.shadeGuide\s*===\s*'bleached'/);
assert.match(html, /function buscarTonoVita\(code, guide\)/);
assert.match(html, /BLEACH_BL_SHADES\.concat\(LEGACY_BLEACHED_SHADES\)/);
assert.match(simulation, /guide\s*===\s*'bleached'\s*\?\s*'BL2'\s*:\s*'A1'/, 'a missing current Bleach tone must never degrade silently to Classical A1');
assert.match(simulation, /shadeGuide/);
assert.match(simulation, /shadeSystem/);
assert.match(simulation, /baseShadeGuide/);
assert.match(simulation, /currentBleachedCodes = new Set\(\['BL1','BL2','BL3','BL4'\]\)/);
assert.match(simulation, /legacyBleachedCodes = new Set\(\['0M1','0M2','0M3'/);
assert.match(simulation, /Ivoclar Bleach BL/);
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
assert.match(sw, /bleach-bl-v10/);

console.log('SMYL simulator: BL1-BL4 are the only new Bleach choices; legacy VITA cases remain readable');
