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

test('coherencia entre la pieza y su ubicación en una panorámica (derecha del paciente = izquierda de la imagen)', () => {
  const check = M.positionIssue;
  assert.equal(check('panoramic', '18', 0.1, 0.2), '', 'derecha superior: izquierda arriba');
  assert.equal(check('panoramic', '28', 0.9, 0.2), '');
  assert.equal(check('panoramic', '38', 0.9, 0.8), '');
  assert.equal(check('panoramic', '48', 0.1, 0.8), '');
  assert.equal(check('panoramic', '31', 0.44, 0.7), '', 'cerca de la línea media no avisa');
  // el plano de mordida se curva hacia arriba en los extremos: los terceros molares inferiores quedan altos y no son un error
  assert.equal(check('panoramic', '48', 0.07, 0.32), '', 'tercer molar inferior alto en el extremo');
  assert.equal(check('panoramic', '38', 0.75, 0.33), '');
  assert.equal(check('panoramic', '18', 0.1, 0.45), '', 'tercer molar superior en el extremo');
  assert.equal(check('panoramic', '18', 0.9, 0.2), 'side', 'lado equivocado');
  assert.equal(check('panoramic', '38', 0.1, 0.8), 'side');
  assert.equal(check('panoramic', '18', 0.1, 0.9), 'arch', 'arcada equivocada');
  assert.equal(check('panoramic', '48', 0.1, 0.1), 'arch');
  // no aplica fuera de panorámicas ni sin diente o sin ubicación
  assert.equal(check('periapical', '18', 0.9, 0.2), '');
  assert.equal(check('panoramic', '', 0.9, 0.2), '');
  assert.equal(check('panoramic', '18', null, null), '');
  assert.equal(check('panoramic', '99', 0.9, 0.2), '');
});

test('el visor avisa cuando la pieza no coincide con la posición, sin cambiar los datos', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /SmylRadiographReviewModel\.positionIssue\(study\.type,item\.tooth,item\.x,item\.y\)/);
  assert.match(js, /rr-box-warn/);
  assert.match(js, /Comprobar: la posición en la imagen no coincide con el lado de esta pieza\./);
  assert.match(js, /Comprobar: la posición en la imagen no coincide con la arcada de esta pieza\./);
});

test('mesa de luz: la imagen ocupa el campo oscuro y los controles flotan encima', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /n\('details','rr-qpop rr-qpop-'\+report\.quality\)/, 'la calidad vive en un chip');
  assert.match(js, /canvas\.append\(quality\)/, 'el chip flota sobre la imagen');
  assert.match(js, /LIMITACIONES DEL ANÁLISIS/);
  assert.doesNotMatch(js, /rr-safety-note|rr-review-head|Ver limitaciones del análisis/);
  assert.match(js, /head\.append\(copy,marksToggle\(stage\)\)/, 'el interruptor de vista va en la cabecera de la imagen');
  assert.match(js, /if\(report\.quality==='unusable'\)quality\.open=true;/);
  assert.match(js, /panel\.append\(footer\)/, 'la barra de guardado vive dentro del panel de señales');
  const css = read('smyl-radiograph-workbench.css');
  assert.match(css, /\.rr-image-wrap \{ position: absolute; inset: 0;/);
  assert.match(css, /\.rr-view-tools \{ position: absolute;[^}]*width: max-content;/);
  assert.match(css, /\.rr-canvas \.rr-qpop \{ position: absolute;/);
  assert.match(css, /clamp\(432px, 28vw, 480px\)/);
  assert.match(css, /@media \(min-width: 960px\)/);
  for (const match of css.matchAll(/font-size:\s*([0-9.]+)px/g)) assert.ok(Number(match[1]) >= 12, 'Texto menor de 12 px: ' + match[0]);
});

test('barra superior con pasos y panel con pestañas con conteo', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /\['Imagen','Señales','Resumen'\]/);
  assert.match(js, /setStep\(run\.doc&&run\.doc\.workflow\.state==='completed'\?2:1\)/);
  assert.match(js, /'rr-filter rr-tab'/);
  assert.match(js, /badge\.dataset\.rrCount=key/);
  assert.match(js, /host\.querySelectorAll\('\[data-rr-count\]'\)\.forEach/, 'los conteos se actualizan sin recargar');
  assert.match(js, /' revisadas'|'\s*\/\s*'\+items\.length\+' revisadas'/);
  assert.match(js, /n\('p','rr-save-note','Revisión privada: no se convierte automáticamente en diagnóstico\.'\)/);
});

test('atajos de teclado: J/K recorren, C confirma, V cambia de vista, y no actúan al escribir', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /document\.addEventListener\('keydown',run\.keyHandler\)/);
  assert.match(js, /document\.removeEventListener\('keydown',run\.keyHandler\)/, 'se retira al cerrar');
  assert.match(js, /\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(target\.tagName\)/);
  assert.match(js, /key==='j'\|\|key==='k'/);
  assert.match(js, /key==='c'/);
  assert.match(js, /key==='v'/);
});

test('el servidor razona más y espera más antes de cortar', () => {
  const ts = read('supabase/functions/_shared/radiograph-claude.ts');
  assert.match(ts, /export const RADIOGRAPH_EFFORT = "high";/);
  assert.match(ts, /export const RADIOGRAPH_TIMEOUT_MS = 120_000;/);
  assert.match(ts, /de 0\.03 a 0\.10 \(una o dos piezas\)/);
});

test('la imagen se ajusta al área libre entre los controles flotantes y el zoom parte de ese ajuste', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /function fitWidth\(wrap,img\)/);
  assert.match(js, /matchMedia\?\.\('\(min-width: 960px\)'\)/, 'solo en escritorio');
  assert.match(js, /wrap\.clientHeight-176/);
  assert.match(js, /Math\.round\(fit\*run\.view\.zoom\)\+'px'/);
  assert.match(js, /new ResizeObserver\(\(\)=>applyImageView\(stage,img\)\)\.observe\(wrap\)/);
});

test('al ampliar, el contenedor no encoge la imagen (el escenario no se contrae)', () => {
  assert.match(read('smyl-radiograph-workbench.css'), /\.rr-image-stage \{ flex: none; margin: auto; \}/);
});
