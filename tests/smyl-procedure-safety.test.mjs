import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const P = require('../smyl-procedure-safety.js');

test('la dosis de anestesia se calcula con el peso y respeta el máximo de cada anestésico', () => {
  // Articaína 4%: 72 mg por cartucho, 7 mg/kg, tope 500 mg. 62 kg -> máximo 434 mg.
  assert.deepEqual(P.dose('articaine', 2, 62), { level: 'ok', mg: 144, maxMg: 434, pct: 33, cartridges: 2 });
  assert.equal(P.dose('articaine', 6, 62).level, 'warn');       // 432 mg = 100% del máximo, sin pasarlo
  assert.equal(P.dose('articaine', 7, 62).level, 'over');       // 504 mg > 434 mg
  // El tope absoluto manda en pacientes pesados: 120 kg × 7 = 840 mg, pero el máximo es 500 mg.
  assert.equal(P.dose('lidocaine', 1, 120).maxMg, 500);
  // Mepivacaína: 6,6 mg/kg y tope 400 mg.
  assert.equal(P.dose('mepivacaine', 1, 50).maxMg, 330);
  assert.equal(P.dose('mepivacaine', 1, 100).maxMg, 400);
});

test('sin peso o sin anestesia no se inventa un máximo', () => {
  assert.equal(P.dose('lidocaine', 2, null).level, 'noweight');
  assert.equal(P.dose('lidocaine', 2, null).maxMg, null);
  assert.equal(P.dose('lidocaine', 2, '').level, 'noweight');
  assert.equal(P.dose('lidocaine', 2, 0).level, 'noweight');
  assert.equal(P.dose('none', 2, 60).level, 'none');
  assert.equal(P.dose('lidocaine', 0, 60).level, 'none');
  assert.equal(P.dose('lidocaine', 99, 60).cartridges, 12, 'los cartuchos se limitan a 12');
});

test('la presión arterial se valida y la sistólica debe ser mayor que la diastólica', () => {
  assert.deepEqual(P.bpFrom('128', '82'), { systolic: 128, diastolic: 82 });
  assert.equal(P.bpFrom('', ''), null);
  assert.equal(P.bpFrom('80', '90'), false);
  assert.equal(P.bpFrom('300', '80'), false);
  assert.equal(P.bpFrom('120', ''), false);
});

test('el sitio debe ser una pieza válida (permanente o temporal) o una zona de la lista', () => {
  assert.match(P.siteError(''), /pieza o elige/);
  assert.match(P.siteError('jh'), /piezas válidas/);
  assert.match(P.siteError('19'), /piezas válidas/);
  assert.match(P.siteError('49'), /piezas válidas/);
  for (const ok of ['36', '16, 17', '16-17', '16 y 17', '55', '85', 'Cuadrante inferior izquierdo', 'Boca completa']) assert.equal(P.siteError(ok), '', ok);
});

test('el aviso de presión no bloquea: avisa cuando está muy alta o muy baja', () => {
  assert.equal(P.bpAlert({ systolic: 120, diastolic: 80 }), null);
  assert.equal(P.bpAlert({ systolic: 185, diastolic: 95 }).kind, 'high');
  assert.equal(P.bpAlert({ systolic: 150, diastolic: 112 }).kind, 'high');
  assert.equal(P.bpAlert({ systolic: 80, diastolic: 43 }).kind, 'low');
  assert.equal(P.bpAlert(null), null);
});

test('cada tipo pide solo lo que corresponde: la presión es obligatoria en cirugía y, con anestesia, si el paciente es ASA II o más', () => {
  const base = { tooth: '36', siteConfirmed: true, allergiesReviewed: true };
  assert.equal(P.needsBp('none', 'IV'), false);
  assert.equal(P.needsBp('anesthesia', null), false);
  assert.equal(P.needsBp('anesthesia', 'I'), false);
  assert.equal(P.needsBp('anesthesia', 'II'), true);
  assert.equal(P.needsBp('surgery', null), true);
  // Sin anestesia: ni anestésico ni presión, aunque sea ASA IV.
  const none = P.build({ ...base, type: 'none' }, { asa: 'IV' }).value;
  assert.equal(none.type, 'none');
  assert.equal(none.anesthesia, undefined);
  // Con anestesia: exige el anestésico.
  assert.match(P.build({ ...base, type: 'anesthesia' }, { asa: 'I' }).error, /anestésico/);
  assert.match(P.build({ ...base, type: 'anesthesia', agent: 'lidocaine', cartridges: 2, weightKg: 70 }, { asa: 'II' }).error, /ASA II/);
  assert.ok(P.build({ ...base, type: 'anesthesia', agent: 'lidocaine', cartridges: 2, weightKg: 70 }, { asa: 'I' }).value);
  // Cirugía: la presión siempre; el anestésico es opcional.
  assert.match(P.build({ ...base, type: 'surgery' }, {}).error, /cirugía/);
  assert.ok(P.build({ ...base, type: 'surgery', systolic: '120', diastolic: '80' }, {}).value);
});

test('el procedimiento exige sitio confirmado y alergias revisadas, y guarda la hora de cada paso', () => {
  const ok = { type: 'anesthesia', tooth: '36', siteConfirmed: true, siteAt: '2026-11-23T10:42:00Z', allergiesReviewed: true, consentVerified: true, systolic: '120', diastolic: '80', agent: 'lidocaine', cartridges: 2, anesthesiaAt: '2026-11-23T10:47:00Z', weightKg: 70 };
  assert.match(P.build({ ...ok, tooth: ' ' }).error, /pieza/);
  assert.match(P.build({ ...ok, siteConfirmed: false }).error, /Confirma el sitio/);
  assert.match(P.build({ ...ok, allergiesReviewed: false }).error, /alergias/);
  assert.match(P.build({ ...ok, systolic: '80', diastolic: '90' }).error, /sistólica/);
  assert.match(P.build({ ...ok, cartridges: 0 }).error, /cartuchos/);
  const built = P.build(ok, { asa: 'II' }).value;
  assert.equal(built.v, 2);
  assert.deepEqual(built.site, { tooth: '36', confirmed: true, at: '2026-11-23T10:42:00Z' });
  assert.deepEqual(built.bp, { systolic: 120, diastolic: 80 });
  assert.equal(built.anesthesia.mg, 72);
  assert.equal(built.anesthesia.max_mg, 490);
  assert.equal(built.anesthesia.at, '2026-11-23T10:47:00Z');
});

test('una dosis sobre el máximo se registra tal como fue, marcada en la nota (no se oculta ni se bloquea)', () => {
  const v = P.build({ type: 'anesthesia', tooth: '16', siteConfirmed: true, allergiesReviewed: true, agent: 'articaine', cartridges: 8, weightKg: 62 }, { asa: 'I' }).value;
  assert.equal(v.anesthesia.over_max, true);
  assert.match(P.line(v), /sobre el máximo/);
});

test('el resumen y el texto de la nota salen ya redactados', () => {
  const v = P.build({ type: 'anesthesia', tooth: '36', siteConfirmed: true, allergiesReviewed: true, consentVerified: true, systolic: '128', diastolic: '82', agent: 'articaine', cartridges: 2, weightKg: 62 }, { asa: 'II' }).value;
  assert.equal(P.line(v), 'Sitio 36 confirmado · PA 128/82 · Articaína 4% con epinefrina · 2 cartuchos (144 mg)');
  assert.equal(P.objectiveText(v), 'Procedimiento. Sitio 36 confirmado · PA 128/82 · Articaína 4% con epinefrina · 2 cartuchos (144 mg). Alergias revisadas; consentimiento informado firmado.');
  const low = P.build({ type: 'none', tooth: '21', siteConfirmed: true, allergiesReviewed: true, systolic: '80', diastolic: '43' }, {}).value;
  assert.equal(P.line(low), 'Sitio 21 confirmado · PA 80/43 (baja) · sin anestesia');
  assert.equal(low.bp.alert, 'low');
  assert.equal(P.line(P.build({ type: 'none', tooth: '21', siteConfirmed: true, allergiesReviewed: true }, {}).value), 'Sitio 21 confirmado · sin anestesia');
  assert.equal(P.line(null), '');
});

test('es una pantalla propia con tres entradas: herramientas, pestaña Consulta y etapa En tratamiento; ya no vive dentro de la nota', () => {
  const tools = read('smyl-clinical-tools.js');
  assert.match(tools, /id: 'procedure', label: 'Procedimiento'/);
  assert.match(tools, /window\.SmylProcedureSafety\?\.open\(\{tenant:s\.tenant,patient:person\.id/);
  const note = read('smyl-patient-360.js');
  assert.match(note, /data-p360-tab="visits" data-p360-clinical>Consulta<\/button>/);
  assert.match(note, /CONSULTA DE HOY/);
  assert.match(note, /data-new-procedure/);
  assert.doesNotMatch(note, /SmylProcedureSafety\.enhance|SmylProcedureSafety\.collect/, 'el formulario de la nota ya no lleva el bloque');
  assert.match(note, /if\(row&&d&&d\.procedure\)doc\.procedure=d\.procedure;/, 'un borrador que ya traía procedimiento lo conserva');
  assert.match(note, /smyl:clinical-note-created/);
  assert.match(read('smyl-case-workspace.js'), /btn\('Registrar procedimiento'/);
  const ui = read('smyl-procedure-safety.js');
  assert.match(ui, /smyl_create_clinical_note/);
  assert.match(ui, /p_note_type: 'progress'/);
  assert.match(read('smyl-patient-360.css'), /\.ps-dialog\{/);
});

test('web, móvil y PWA distribuyen la pantalla de procedimiento', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-procedure-safety\.js\?v=2/);
    assert.match(read(file), /smyl-patient-360\.js\?v=41/);
    assert.match(read(file), /smyl-clinical-tools\.js\?v=2/);
  }
  assert.ok(read('app.html').indexOf('smyl-procedure-safety.js') < read('app.html').indexOf('smyl-patient-360.js'));
  assert.match(read('sw.js'), /-procedimiento-herramienta-v1(?:-|')/);
  for (const file of ['smyl-procedure-safety.js', 'smyl-patient-360.js', 'smyl-patient-360.css', 'smyl-clinical-tools.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
