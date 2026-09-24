import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'simulacion-rapida.html'), 'utf8');
const visual = fs.readFileSync(path.join(root, 'visual-simulation.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/claude/index.ts'), 'utf8');

assert.match(html, /dentalDesignMaster:\s*null/);
assert.match(html, /diseno_maestro_intraoral/);
assert.match(html, /S\.dentalDesignMaster=\{view:'intraoral'/);
assert.match(html, /referenciaDentalMaestraParaVista\(view\)/);
assert.match(html, /masterGuide:masterGuide,multiviewReference:!!masterGuide/);
assert.match(html, /dentalDesignMaster:\s*S\.dentalDesignMaster/);
assert.match(html, /snap\.dentalDesignMaster/);
assert.match(html, /Cargar mis fotos · frontal \+ intraoral/);
assert.match(html, /id="paired-own-frontal"/);
assert.match(html, /id="paired-own-intraoral"/);
assert.match(html, /function confirmarCargaParPropio\(button\)/);
assert.match(html, /S\.testPairedGeneration=true/);
assert.match(html, /Ejemplo precargado · frontal \+ intraoral/);
assert.match(html, /class="advanced-entry-btn debug-test-only"[^>]*hidden[^>]*>Ejemplo precargado/);
assert.match(html, /some\(function\(photo\)\{ return !!photo\.synthetic; \}\)/);
assert.match(html, /element\.hidden=!debugUi/);

assert.match(visual, /visual-preview-v2-multiview/);
assert.match(visual, /MULTI-VIEW DENTAL IDENTITY LOCK/);
assert.match(visual, /same-patient-master-v1/);
assert.match(visual, /guideImageBase64:guide\?\.b64/);
assert.match(visual, /change only what perspective and natural photographic visibility require/);

assert.match(edge, /isSamePatientMasterGuide/);
assert.match(edge, /MULTI-VIEW SAME-PATIENT DENTAL DESIGN TRANSFER/);
assert.match(edge, /same-patient-master-design\.png/);

console.log('SMYL multiview: one master dental identity is reused across frontal, intraoral, profiles and 3/4 views.');
