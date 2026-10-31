// Cuadros punteados por señal, dos vistas de la radiografía y «Diente por indicar».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.window = {};
globalThis.SmylDentalModel = require('../smyl-dental-model.js');
const M = require('../smyl-radiograph-review-model.js');
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const study = { id: '11111111-1111-4111-8111-111111111111', type: 'panoramic', asset: { sha256: 'a'.repeat(64) } };
const report = { schema: 1, quality: 'limited', qualityNote: 'Límites.', limitations: [],
  observations: [{ id: 'r1', category: 'density', tooth: '36', observation: 'Zona por comprobar.', evidence: 'Posterior.' },
    { id: 'r2', category: 'support', tooth: null, observation: 'Soporte por valorar.', evidence: 'Anterior.' }] };
const run = (locations) => { const requested = M.requested(M.create(study)); return M.completed(requested, { model: 'claude-opus-5-5', at: new Date().toISOString(), requestId: 'msg_t', report, locations }); };

test('las señales guardan el tamaño del cuadro cuando la IA lo propone, y siguen válidas sin él', () => {
  const doc = run({ r1: { x: 0.3, y: 0.6, w: 0.08, h: 0.14 }, r2: { x: 0.7, y: 0.5 } });
  assert.deepEqual([doc.items[0].w, doc.items[0].h], [0.08, 0.14]);
  assert.ok(!('w' in doc.items[1]) && !('h' in doc.items[1]));
  assert.ok(M.validate(doc, study));
  assert.ok(M.validate(run({}), study), 'sin ubicación sigue siendo válido');
});

test('el contrato rechaza tamaños incompletos, fuera de rango o sin ubicación', () => {
  const bad = (mutate) => { const doc = run({ r1: { x: 0.3, y: 0.6, w: 0.08, h: 0.14 }, r2: { x: 0.7, y: 0.5 } }); mutate(doc); return M.validate(doc, study); };
  assert.equal(bad(d => { delete d.items[0].h; }), false);
  assert.equal(bad(d => { d.items[0].w = 0.9; }), false);
  assert.equal(bad(d => { d.items[0].w = '0.1'; }), false);
  assert.equal(bad(d => { d.items[1].w = 0.1; d.items[1].h = 0.1; d.items[1].x = null; d.items[1].y = null; }), false);
  assert.equal(bad(d => { d.items[0].extra = 1; }), false);
});

test('el visor dibuja cuadros punteados y ofrece dos vistas sin tocar la imagen', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /function marksToggle\(stage\)/);
  assert.match(js, /button\('Sin marcas'/);
  assert.match(js, /button\('Con observaciones'/);
  assert.match(js, /item\.x===null\|\|item\.state==='rejected'\)return;/, 'las descartadas no se dibujan');
  assert.match(js, /n\('div','rr-box rr-box-'\+item\.state/);
  assert.match(js, /if\(run\.placing\)run\.view\.marks=true;/, 'ubicar una señal fuerza la vista con marcas');
  assert.match(js, /marks:true\}/);
  assert.match(js, /querySelector\('\.rr-actions'\)\?\.scrollIntoView/, 'la señal abierta baja hasta sus botones');
  const css = read('smyl-radiograph-workbench.css');
  assert.match(css, /\.rr-box \{[^}]*border: 2px dashed/);
  assert.match(css, /\.rr-box \{[^}]*pointer-events: none/, 'los cuadros no capturan clics de ubicación');
  assert.match(css, /\.rr-marks-off > \.rr-box, \.rr-marks-off > \.rr-mark \{ display: none; \}/);
});

test('cuando falta el diente se dice «Diente por indicar»', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /item\.tooth\?'Pieza FDI '\+item\.tooth:'Diente por indicar'/);
  assert.match(js, /new Option\('Diente por indicar',''\)/);
  assert.doesNotMatch(js, /Región general/);
});

test('la migración acepta w y h opcionales y juntos, solo con ubicación', () => {
  const sql = read('supabase/migrations/20261031140000_smyl_radiograph_item_box.sql');
  assert.match(sql, /i-array\['id','sourceId','tooth','text','x','y','state','w','h'\]<>'\{\}'::jsonb/);
  assert.match(sql, /or not\(i \?& array\['id','sourceId','tooth','text','x','y','state'\]\)/, 'siguen siendo obligatorios los siete campos de siempre');
  assert.match(sql, /\(i \? 'w'\) is distinct from \(i \? 'h'\)/);
  assert.match(sql, /between 0\.02 and 0\.6/);
  assert.match(sql, /claude-opus-5-5/, 'conserva la aceptación de Opus');
  assert.match(sql, /revoke all on function public\.smyl_validate_radiograph_review\(jsonb,jsonb\) from public,anon,authenticated/);
});

test('las copias móviles siguen idénticas', () => {
  for (const f of ['app.html', 'sw.js', 'smyl-radiograph-review.js', 'smyl-radiograph-review-model.js', 'smyl-radiograph-analysis-client.js', 'smyl-radiograph-workbench.css']) {
    assert.equal(read('mobile/www/' + f), read(f), f);
  }
});
