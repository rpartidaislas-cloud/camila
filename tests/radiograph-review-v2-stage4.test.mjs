// Radiografía asistida — Etapa 4: contrato estático de la mesa de revisión por pieza v2.
// La prueba de navegador vive en tests/smyl-radiograph-review-v2-browser.cjs (Playwright).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const ui = read('smyl-radiograph-review-v2.js');
const css = read('smyl-radiograph-review-v2.css');
const v1 = read('smyl-radiograph-review.js');
const record = read('smyl-dental-record.js');
const app = read('app.html');
const sw = read('sw.js');

test('la mesa v2 sólo abre con la bandera qc_v2 y lectura clínica; el servidor decide cada acción', () => {
  assert.match(ui, /caps\.flags\?\.\['radiograph\.qc_v2'\]!==true\|\|caps\.clinicalRead!==true/);
  assert.match(ui, /client\.rpc\('smyl_radiograph_decide_candidate',\{p_candidate_id:candidateId,p_expected_revision:revision,p_state:state,p_payload:payload,p_note:note\}\)/);
  assert.match(ui, /client\.functions\.invoke\(name,\{body\}\)/);
  assert.doesNotMatch(ui, /segment-teeth|createSignedUrl|localStorage|sessionStorage|indexedDB/, 'sin segment-teeth, sin URLs firmadas persistidas, sin respaldo inseguro en navegador');
  assert.doesNotMatch(ui, /window\.miRolEquipo/, 'no asume que sólo la dueña revisa: el permiso lo decide la base');
});

test('una tarjeta por candidato con los cuatro bloques, acciones explícitas y comparación sólo cuando sea compatible', () => {
  for (const label of ['Base visual sugerida', 'Confianza del modelo', 'Limitaciones', 'Valoración profesional']) assert.match(ui, new RegExp(`block\\('${label}'`));
  for (const action of ['Confirmar', 'Guardar corrección', 'Descartar', 'Editar contorno', 'Deshacer contorno', 'Comparar con anterior']) assert.ok(ui.includes(`'${action}`), action);
  assert.match(ui, /if\(!hasComparable\)\{compare\.disabled=true;compare\.setAttribute\('aria-disabled','true'\);compare\.title=/, 'sin estudio comparable el botón queda deshabilitado y explica por qué');
  assert.match(ui, /C\(\)\.parseDecisionPayload\('corrected',payload\)/, 'la corrección pasa por el contrato antes de enviarse');
  assert.match(ui, /const cropEl=crop\(entry\)/, 'recorte derivado al vuelo');
  assert.match(ui, /no se guarda/);
});

test('el estado nunca se indica sólo con color: símbolo + texto en tarjetas, overlay y leyenda; patrón de trazo por estado', () => {
  assert.match(ui, /const stateMark=\{pending:'○',confirmed:'✓',corrected:'✎',rejected:'✕'\}/);
  assert.match(ui, /stateMark\[entry\.state\]\+' '\+stateLabel\[entry\.state\]/);
  assert.match(ui, /label\.textContent=stateMark\[entry\.state\]\+' '\+\(index\+1\)/);
  assert.match(css, /\.rv2-shape \{[^}]*stroke-dasharray: 8 5/);
  assert.match(css, /\.rv2-shape-confirmed \{[^}]*stroke-dasharray: none/);
  assert.match(css, /\.rv2-shape-corrected \{[^}]*stroke-dasharray: 2 5/);
  assert.match(css, /min-height: 44px/);
});

test('teclado, lector de pantalla y cierre seguro', () => {
  assert.match(ui, /items\.setAttribute\('role','listbox'\)/);
  assert.match(ui, /\['ArrowDown','ArrowUp','Home','End'\]/);
  assert.match(ui, /e\.setAttribute\('aria-live','polite'\)/);
  assert.match(ui, /c\.setAttribute\('role','img'\)/);
  assert.match(ui, /const isDirty=run=>run\.drafts\.size>0\|\|!!run\.editing/);
  assert.match(ui, /Sin conexión\. Tus cambios siguen en esta pantalla/);
  assert.match(ui, /if\(e\?\.code==='PT409'\)\{try\{await reload\(\);\}catch\(_\)\{\}\}/, 'conflicto de revisión: recarga y explica');
});

test('el visor es uno solo: v1 exporta viewportNavigation y v2 lo reutiliza', () => {
  assert.match(v1, /window\.SmylRadiographReview=\{open,close:\(\)=>close\(active,true\),viewportNavigation\};/);
  assert.match(ui, /window\.SmylRadiographReview\.viewportNavigation\(viewport,stage,/);
  assert.doesNotMatch(ui, /function viewportNavigation/);
});

test('integración mínima en el expediente: botón oculto hasta que la clínica tenga la bandera', () => {
  assert.match(record, /const perPiece=button\('Revisión por pieza \(v2\)'/);
  assert.match(record, /perPiece\.hidden=true;/);
  assert.match(record, /SmylRadiographReviewV2\?\.available\?\.\(window\.sb\)\.then\(ok=>\{perPiece\.hidden=!ok;\}\)/);
  assert.match(record, /panel\.append\(panelHead,list,notes\.box,assisted,perPiece,actionFeedback,/);
  assert.match(record, /assisted=button\('Revisar con apoyo de IA'/, 'el flujo v1 sigue disponible');
});

test('cableado web, PWA y copia móvil sincronizados', () => {
  for (const tag of ['smyl-radiograph-review-v2.css?v=2', 'smyl-radiograph-contracts.js?v=1', 'smyl-radiograph-review-model-v2.js?v=1', 'smyl-radiograph-review-v2.js?v=4', 'smyl-radiograph-review.js?v=5', 'smyl-dental-record.js?v=17']) {
    assert.ok(app.includes(tag), 'app.html ' + tag);
    assert.ok(sw.includes('/camila/' + tag), 'sw.js ' + tag);
  }
  assert.match(sw, /radiograph-review-v2-v47/);
  assert.match(sw, /radiograph-report-v48/);
  assert.doesNotMatch(app, /smyl-radiograph-review\.js\?v=4|smyl-dental-record\.js\?v=16/);
  for (const file of ['app.html', 'sw.js', 'smyl-dental-record.js', 'smyl-radiograph-review.js', 'smyl-radiograph-contracts.js', 'smyl-radiograph-review-model-v2.js', 'smyl-radiograph-review-v2.js', 'smyl-radiograph-review-v2.css', 'smyl-radiograph-report.js', 'smyl-radiograph-report.css']) {
    assert.equal(read('mobile/www/' + file), read(file), 'mobile/www desincronizado: ' + file);
  }
  assert.match(read('mobile/scripts/sync-web.js'), /'smyl-radiograph-review-v2\.js', 'smyl-radiograph-review-v2\.css'/);
});
