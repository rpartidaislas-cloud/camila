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
  assert.match(js, /button\('Original'/);
  assert.match(js, /button\('Señales'/);
  assert.match(js, /item\.x===null\|\|item\.state==='rejected'\)return;/, 'las descartadas no se dibujan');
  assert.match(js, /n\('div','rr-box rr-box-'\+item\.state/);
  assert.match(js, /if\(run\.placing\)run\.view\.marks=true;/, 'ubicar una señal fuerza la vista con marcas');
  assert.match(js, /marks:false\}/, 'la comprobación inicial abre sin marcas de IA');
  assert.doesNotMatch(js, /querySelector\('\.rr-actions'\)\?\.scrollIntoView/, 'cambiar de señal no desplaza la mesa de trabajo');
  const css = read('smyl-radiograph-workbench.css');
  assert.match(css, /\.rr-box \{[^}]*border: 2px dashed/);
  assert.match(css, /\.rr-box \{[^}]*pointer-events: none/, 'los cuadros no capturan clics de ubicación');
  assert.match(css, /\.rr-marks-off > \.rr-box, \.rr-marks-off > \.rr-mark \{ display: none; \}/);
  assert.match(css, /\.rr-image-stage > \.rr-mark\.is-selected \{[^}]*visibility: hidden;/s, 'el círculo de selección se oculta y permanece el recuadro editable');
});

test('el selector FDI gráfico relaciona la señal con una pieza sin duplicar el odontograma clínico', () => {
  const js = read('smyl-radiograph-review.js');
  assert.equal(SmylDentalModel.teeth.length, 32, 'conserva las 32 piezas permanentes FDI');
  assert.equal(new Set(SmylDentalModel.teeth).size, 32, 'ninguna pieza FDI se duplica');
  assert.deepEqual(SmylDentalModel.upper.map(String), ['18','17','16','15','14','13','12','11','21','22','23','24','25','26','27','28']);
  assert.deepEqual(SmylDentalModel.lower.map(String), ['48','47','46','45','44','43','42','41','31','32','33','34','35','36','37','38']);
  assert.match(js, /item\.tooth\?'Pieza FDI '\+item\.tooth:'Diente por indicar'/);
  assert.match(js, /function toothPicker\(item\)/);
  assert.match(js, /function toothPickerDock\(item,source\)/);
  assert.match(js, /n\('section','rr-tooth-dock'\)/, 'el odontograma se acopla fuera de la radiografía');
  assert.match(js, /canvas\.classList\.add\('has-tooth-dock'\)/);
  assert.match(js, /trigger\.dataset\.rrToothTrigger=item\.id/);
  assert.match(js, /quadrant:'1',teeth:SmylDentalModel\.upper\.slice\(0,8\)/);
  assert.match(js, /quadrant:'2',teeth:SmylDentalModel\.upper\.slice\(8\)/);
  assert.match(js, /quadrant:'4',teeth:SmylDentalModel\.lower\.slice\(0,8\)/);
  assert.match(js, /quadrant:'3',teeth:SmylDentalModel\.lower\.slice\(8\)/);
  assert.match(js, /row\.dataset\.quadrant=group\.quadrant/);
  assert.match(js, /row\.setAttribute\('aria-label','Cuadrante '\+group\.quadrant/);
  assert.match(js, /chart\.setAttribute\('role','radiogroup'\)/);
  assert.match(js, /chart\.setAttribute\('aria-label','Pieza relacionada en odontograma FDI'\)/);
  assert.match(js, /control\.setAttribute\('role','radio'\)/);
  assert.match(js, /control\.setAttribute\('aria-label','Pieza FDI '\+tooth\)/);
  assert.match(js, /control\.setAttribute\('aria-checked',String\(item\.tooth===tooth\)\)/);
  assert.match(js, /item\.tooth=String\(value\|\|''\);run\.toothPickerOpen=null;markDirty\(item\);render\(\)/, 'la pieza usa el mismo item clínico como fuente de verdad');
  assert.match(js, /button\('Dejar pieza por indicar'/);
  assert.doesNotMatch(js, /select\.add\(new Option\('Diente por indicar'/, 'el desplegable largo dejó de ser la interfaz principal');
  assert.doesNotMatch(js, /Región general/);

  const css = read('smyl-radiograph-workbench.css');
  assert.match(css, /\.rr-tooth-chart \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\)/s, 'cuatro cuadrantes en una matriz anatómica');
  assert.match(css, /\.rr-tooth-chart::before,[\s\S]*\.rr-tooth-chart::after \{/);
  assert.match(css, /\.rr-tooth-chart::before \{[^}]*left: 50%;[^}]*width: 2px/s, 'línea media entre derecha e izquierda');
  assert.match(css, /\.rr-tooth-chart::after \{[^}]*top: 50%;[^}]*height: 2px/s, 'línea oclusal entre superior e inferior');
  assert.match(css, /\.rr-tooth-options \{[^}]*grid-template-columns: repeat\(8, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.rr-tooth-option \{[^}]*min-height: 64px/s);
  assert.match(css, /@media \(max-width: 639px\)[\s\S]*\.rr-tooth-option \{ min-height: 58px;/);
  assert.match(css, /\.rr-tooth-option\.is-selected \{/);
  assert.match(css, /\.rr-tooth-option\.is-suggested::after \{[\s\S]*content: 'IA'/);
});

test('cada familia dental usa una silueta SVG propia y conserva el número FDI accesible', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /function toothGlyph\(value,arch\)/);
  assert.match(js, /outlines=\{[\s\S]*incisor:[\s\S]*canine:[\s\S]*premolar:[\s\S]*molar:/);
  assert.match(js, /document\.createElementNS\(ns,'svg'\)/);
  assert.match(js, /svg\.setAttribute\('viewBox','0 0 32 60'\)/);
  assert.match(js, /svg\.setAttribute\('aria-hidden','true'\)/);
  assert.match(js, /svg\.classList\.add\('rr-tooth-glyph','rr-tooth-glyph-'\+kind\)/);
  assert.match(js, /if\(arch==='Inferior'\)svg\.classList\.add\('is-lower'\)/);
  assert.match(js, /control\.dataset\.kind=digit<=2\?'incisor':digit===3\?'canine':digit<=5\?'premolar':'molar'/);
  assert.match(js, /control\.append\(toothGlyph\(tooth,group\.arch\),n\('span','rr-tooth-number',tooth\)\)/);

  const css = read('smyl-radiograph-workbench.css');
  for (const family of ['incisor', 'canine', 'premolar', 'molar']) assert.match(css, new RegExp('\\.rr-tooth-glyph-' + family + ' \\{'));
  assert.match(css, /\.rr-tooth-glyph\.is-lower \{ transform: rotate\(180deg\); \}/);
});

test('el selector FDI se recorre por teclado y devuelve el foco sin desplazar la mesa', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /\['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'\]\.includes\(key\)/);
  assert.match(js, /const rowStart=Math\.floor\(at\/16\)\*16,rowEnd=rowStart\+15/);
  assert.match(js, /if\(key==='ArrowLeft'\)next=Math\.max\(rowStart,at-1\)/, 'la flecha izquierda puede cruzar 11 hacia 21 sin salir de la arcada');
  assert.match(js, /if\(key==='ArrowRight'\)next=Math\.min\(rowEnd,at\+1\)/, 'la flecha derecha puede cruzar 41 hacia 31 sin salir de la arcada');
  assert.match(js, /if\(key==='ArrowUp'\)next=at>=16\?at-16:at/);
  assert.match(js, /if\(key==='ArrowDown'\)next=at<16\?at\+16:at/);
  assert.match(js, /if\(key==='Home'\)next=rowStart/);
  assert.match(js, /if\(key==='End'\)next=rowEnd/);
  assert.match(js, /const nextControl=controls\[next\]/);
  assert.match(js, /nextControl\.focus\(\)/);
  assert.match(js, /item\.tooth=nextTooth/);
  assert.match(js, /option\.setAttribute\('aria-checked',String\(checked\)\)/);
  assert.match(js, /\[data-rr-tooth-trigger="'\+item\.id\+'"\]'\)\?\.focus\(\{preventScroll:true\}\)/);
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
  assert.match(js, /canvas\.append\(qualityPopover\(report\)\)/, 'el chip flota sobre la imagen');
  assert.match(js, /LIMITACIONES DEL ANÁLISIS/);
  assert.doesNotMatch(js, /rr-safety-note|rr-review-head|Ver limitaciones del análisis/);
  assert.match(js, /head\.append\(copy\);if\(clickable\)head\.append\(marksToggle\(stage\)\)/, 'el interruptor sólo aparece durante la revisión de señales');
  assert.match(js, /n\('details','rr-image-adjustments'\)/, 'los ajustes de imagen quedan plegados');
  assert.match(js, /if\(report\.quality==='unusable'\)quality\.open=true;/);
  assert.match(js, /panel\.append\(footer\)/, 'la barra de guardado vive dentro del panel de señales');
  const css = read('smyl-radiograph-workbench.css');
  assert.match(css, /\.rr-image-wrap \{ position: absolute; inset: 0;/);
  assert.match(css, /\.rr-view-tools \{ position: absolute;[^}]*width: max-content;/);
  assert.match(css, /\.rr-canvas \.rr-qpop \{ position: absolute;/);
  assert.match(css, /clamp\(420px, 27vw, 450px\)/);
  assert.match(css, /@media \(min-width: 960px\)/);
  for (const match of css.matchAll(/font-size:\s*([0-9.]+)px/g)) assert.ok(Number(match[1]) >= 10, 'Texto menor de 10 px: ' + match[0]);
});

test('barra superior con tres pasos y una sola señal activa', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /\['Imagen','Señales','Resumen'\]/);
  assert.match(js, /run\.phase==='image'\?1:run\.phase==='summary'\?3:2/);
  assert.match(js, /list\.append\(editItem\(selected,selectedIndex\)\)/, 'sólo monta la señal activa');
  assert.match(js, /n\('details','rr-signal-queue'\)/, 'la cola completa es secundaria y plegable');
  assert.doesNotMatch(js, /'rr-filter rr-tab'/);
  assert.match(js, /decided\+' de '\+items\.length\+' revisadas'/);
  assert.match(js, /run\.phase='summary'/);
  assert.match(js, /professionalText=item\.text&&item\.text!==source\?\.observation/, 'el resumen no presenta una sugerencia descartada como conclusión profesional');
  assert.match(js, /n\('p','rr-save-note','Cada decisión se guarda al confirmarla o descartarla\. La IA nunca valida por sí sola\.'\)/);
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
  assert.match(js, /wrap\.clientHeight-72/);
  assert.match(js, /Math\.round\(fit\*run\.view\.zoom\)\+'px'/);
  assert.match(js, /new ResizeObserver\(\(\)=>applyImageView\(stage,img\)\)\.observe\(wrap\)/);
});

test('al ampliar, el contenedor no encoge la imagen (el escenario no se contrae)', () => {
  assert.match(read('smyl-radiograph-workbench.css'), /\.rr-image-stage \{ flex: none; margin: auto; \}/);
});

test('el cuadro de la señal abierta se mueve y cambia de tamaño (ratón, tacto y teclado) dentro del contrato', () => {
  const js = read('smyl-radiograph-review.js');
  assert.match(js, /function makeBoxEditable\(item,index,view\)/);
  assert.match(js, /if\(clickable&&selected&&!run\.placing&&run\.view\.marks\)makeBoxEditable\(/, 'solo la señal abierta, fuera del modo ubicar y con marcas visibles');
  assert.match(js, /\['nw','n','ne','e','se','s','sw','w'\]\.forEach/, 'ocho asas');
  assert.match(js, /MIN=\.02,MAX=\.6/, 'mismos límites que el contrato guardado');
  assert.match(js, /setPointerCapture/);
  assert.match(js, /event\.stopPropagation\(\)/, 'arrastrar el cuadro no desplaza la imagen');
  assert.match(js, /event\.key==='ArrowLeft'/);
  assert.match(js, /event\.shiftKey\)apply\(/, 'Mayús + flechas cambian el tamaño');
  assert.match(js, /item\.x=round\(rect\.left\+rect\.width\/2\);item\.y=round\(rect\.top\+rect\.height\/2\);item\.w=round\(rect\.width\);item\.h=round\(rect\.height\)/);
  assert.match(js, /markDirty\(item\);if\(issue!==issueBefore\)/, 'queda como cambio del dentista y se revisa la coherencia pieza-posición');
  assert.match(js, /Ajusta el recuadro directamente sobre la radiografía/);
  const css = read('smyl-radiograph-workbench.css');
  assert.match(css, /\.rr-box\.is-editable \{[^}]*pointer-events: auto;[^}]*touch-action: none;/);
  assert.match(css, /\.rr-handle\[data-handle="se"\] \{[^}]*cursor: nwse-resize;/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.rr-handle \{ width: 20px; height: 20px; \}/, 'asas más grandes al tacto');
  assert.match(css, /\.rr-image-stage > \.rr-mark \{[^}]*min-height: 26px;/, 'el número es un círculo, no un óvalo');
});

test('un cuadro editado sigue siendo una revisión válida', () => {
  const doc = run({ r1: { x: 0.3, y: 0.6, w: 0.08, h: 0.16 }, r2: { x: 0.7, y: 0.5 } });
  doc.items[1].x = 0.72; doc.items[1].y = 0.52; doc.items[1].w = 0.12; doc.items[1].h = 0.24; doc.items[1].state = 'pending';
  assert.ok(M.validate(doc, study), 'una señal sin cuadro que el dentista dibuja con asas pasa a tener w y h');
  doc.items[0].w = 0.7;
  assert.equal(M.validate(doc, study), false, 'más allá del máximo del contrato se rechaza');
});
