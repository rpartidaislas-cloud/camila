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

test('el procedimiento exige sitio confirmado y alergias revisadas; la presión solo si el paciente es ASA II o más', () => {
  const ok = { tooth: '36', siteConfirmed: true, allergiesReviewed: true, consentVerified: true, systolic: '120', diastolic: '80' };
  assert.match(P.build({ ...ok, tooth: ' ' }).error, /pieza o el sitio/);
  assert.match(P.build({ ...ok, siteConfirmed: false }).error, /Confirma el sitio/);
  assert.match(P.build({ ...ok, allergiesReviewed: false }).error, /alergias/);
  assert.match(P.build({ ...ok, systolic: '', diastolic: '' }, { requireBp: true }).error, /ASA II/);
  assert.ok(P.build({ ...ok, systolic: '', diastolic: '' }, { requireBp: false }).value, 'sin ASA de riesgo la presión es opcional');
  const built = P.build({ ...ok, anesthesia: { agent: 'lidocaine', cartridges: 2 }, weightKg: 70 }).value;
  assert.equal(built.v, 1);
  assert.deepEqual(built.site, { tooth: '36', confirmed: true });
  assert.deepEqual(built.bp, { systolic: 120, diastolic: 80 });
  assert.equal(built.anesthesia.mg, 72);
  assert.equal(built.anesthesia.max_mg, 490);
  assert.match(P.build({ ...ok, anesthesia: { agent: 'lidocaine', cartridges: 0 }, weightKg: 70 }).error, /cartuchos/);
});

test('una dosis sobre el máximo se registra tal como fue, marcada en la nota (no se oculta ni se bloquea)', () => {
  const v = P.build({ tooth: '16', siteConfirmed: true, allergiesReviewed: true, anesthesia: { agent: 'articaine', cartridges: 8 }, weightKg: 62 }).value;
  assert.equal(v.anesthesia.over_max, true);
  assert.match(P.line(v), /sobre el máximo/);
});

test('el resumen de la nota es legible', () => {
  const v = P.build({ tooth: '36', siteConfirmed: true, allergiesReviewed: true, systolic: '128', diastolic: '82', anesthesia: { agent: 'articaine', cartridges: 2 }, weightKg: 62 }).value;
  assert.equal(P.line(v), 'Sitio 36 confirmado · PA 128/82 · Articaína 4% con epinefrina · 2 cartuchos (144 mg)');
  assert.equal(P.line(P.build({ tooth: '21', siteConfirmed: true, allergiesReviewed: true }).value), 'Sitio 21 confirmado · sin anestesia');
  assert.equal(P.line(null), '');
});

test('la nota guarda el bloque dentro del documento firmado, sin tocar la base de datos', () => {
  const note = read('smyl-patient-360.js');
  assert.match(note, /window\.SmylProcedureSafety\.enhance\(dlg\.querySelector\('form'\)/);
  assert.match(note, /doc\.procedure=proc\.value/);
  assert.match(note, /Procedimiento: /);
  assert.match(read('smyl-treatments.js'), /current: current/);
  assert.match(read('smyl-patient-360.css'), /\.p360-proc-meter\[data-level=over\] span/);
});

test('web, móvil y PWA distribuyen la verificación y anestesia', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-procedure-safety\.js\?v=1/);
    assert.match(read(file), /smyl-patient-360\.js\?v=38/);
    assert.match(read(file), /smyl-treatments\.js\?v=3/);
  }
  assert.ok(read('app.html').indexOf('smyl-procedure-safety.js') < read('app.html').indexOf('smyl-patient-360.js'));
  assert.match(read('sw.js'), /-verificacion-anestesia-v1';/);
  for (const file of ['smyl-procedure-safety.js', 'smyl-patient-360.js', 'smyl-patient-360.css', 'smyl-treatments.js', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
