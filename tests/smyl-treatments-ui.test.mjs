import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const M = require('../smyl-treatments.js');

test('textos y etiquetas de los capítulos', () => {
  assert.equal(M.statusLabel('active'), 'En curso');
  assert.equal(M.statusLabel('abandoned'), 'Abandonado');
  assert.match(M.chapterMeta({ status: 'active', opened_at: '2026-11-05T10:00:00Z' }), /^En curso · desde nov 2026$/);
  assert.match(M.chapterMeta({ status: 'closed', opened_at: '2025-03-02T10:00:00Z', closed_at: '2025-03-14T10:00:00Z' }), /^Terminado · mar 2025$/);
});

test('el motivo se convierte en título y el cierre por abandono exige la nota de egreso', () => {
  assert.equal(M.titleFrom('  Le   sangran\nlas encías '), 'Le sangran las encías');
  assert.equal(M.titleFrom('ab'), '');
  assert.equal(M.titleFrom('x'.repeat(200)).length, 118);
  assert.match(M.closeError('abandoned', 'corta'), /qué fase quedó/);
  assert.equal(M.closeError('abandoned', 'Quedó en profilaxis; faltan 2 sesiones.'), '');
  assert.equal(M.closeError('closed', ''), '');
  assert.match(M.closeError('active', ''), /Elige cómo termina/);
});

test('la revisión sugerida sale del riesgo de caries', () => {
  assert.deepEqual([M.suggestedRecall('low'), M.suggestedRecall('medium'), M.suggestedRecall('high'), M.suggestedRecall('x')], [12, 6, 3, null]);
});

test('el plan congelado se resume sin romperse con datos incompletos', () => {
  const s = M.snapshotSummary({ reason: 'Dolor', assessment: 'Pulpitis', treatments: [{ name: 'Endodoncia', teeth: ['46'], phase: 'treat' }, {}] });
  assert.equal(s.items.length, 2);
  assert.deepEqual(s.items[0], { name: 'Endodoncia', teeth: ['46'], phase: 'Tratamiento' });
  assert.equal(s.items[1].name, 'Tratamiento sin nombre');
  assert.deepEqual(M.snapshotSummary(null).items, []);
});

test('si la migración no está aplicada la franja se oculta sola', () => {
  assert.equal(M.listError({ code: 'PGRST202', message: 'x' }), 'missing');
  assert.equal(M.listError({ code: '42883' }), 'missing');
  assert.equal(M.listError({ code: '500', message: 'boom' }), 'error');
});

test('el expediente monta la franja y llama a las funciones del servidor', () => {
  const ui = read('smyl-treatments.js');
  for (const fn of ['smyl_list_treatments', 'smyl_get_treatment', 'smyl_open_treatment', 'smyl_update_treatment', 'smyl_close_treatment']) {
    assert.match(ui, new RegExp(fn));
  }
  const workspace = read('smyl-case-workspace.js');
  assert.match(workspace, /window\.SmylTreatments\?\.attach\?\.\(ctx\)/);
  assert.match(workspace, /window\.SmylTreatments\?\.sync\?\.\(ctx,\{planSaved:!!clinical\?\.saved\}\)/);
  assert.match(read('smyl-case-workspace.css'), /\.cw-viewing-closed \.cw-nav/);
});

test('los hallazgos se separan en nuevos y de antes según el odontograma vigente al abrir el tratamiento', () => {
  const findings = [{ id: 'a', tooth: '46' }, { id: 'b', tooth: '36' }, { id: 'c', tooth: '36' }];
  const doc = { findings: { schema: 2, events: [{ id: 'a' }, { id: 'zzz' }, null, {}] } };
  assert.deepEqual(M.baselineIdsFrom(doc), ['a', 'zzz']);
  const groups = M.splitFindings(findings, M.baselineIdsFrom(doc));
  assert.deepEqual(groups.before.map((f) => f.id), ['a']);
  assert.deepEqual(groups.fresh.map((f) => f.id), ['b', 'c']);
  assert.deepEqual(M.splitFindings(findings, []).before, [], 'el primer tratamiento no tiene hallazgos de antes');
  assert.deepEqual(M.baselineIdsFrom(null), []);
  assert.equal(M.findingText({ tooth: '36', surface: 'O', condition: 'Caries' }), 'Pieza 36 · O · Caries');
});

test('la sección de hallazgos se monta en Revisión profesional y se refresca con el odontograma', () => {
  const workspace = read('smyl-case-workspace.js');
  assert.match(workspace, /window\.SmylTreatments\?\.attachFindings\?\.\(ctx\)/);
  assert.match(workspace, /ctx\.reviewPart\.body\.prepend\(findingsBox\)/);
  assert.match(workspace, /window\.SmylTreatments\?\.syncFindings\?\.\(ctx,mapSnapshot\)/);
  const ui = read('smyl-treatments.js');
  assert.match(ui, /from\('smyl_dental_versions'\)/);
  assert.match(ui, /\.lte\('updated_at', treatment\.opened_at\)/);
  assert.match(read('smyl-case-workspace.css'), /\.cw-ch-find-list\.is-old li/);
});

test('web, móvil y PWA distribuyen la franja de tratamientos', () => {
  for (const file of ['app.html', 'sw.js']) {
    assert.match(read(file), /smyl-treatments\.js\?v=3/);
    assert.match(read(file), /smyl-case-workspace\.js\?v=50/);
  }
  assert.ok(read('app.html').indexOf('smyl-treatments.js') < read('app.html').indexOf('smyl-case-workspace.js'), 'la franja carga antes del expediente');
  assert.match(read('sw.js'), /-tratamientos-capitulos-v1-hallazgos-nuevos-v1-verificacion-anestesia-v1';/);
  for (const file of ['smyl-treatments.js', 'smyl-case-workspace.js', 'smyl-case-workspace.css', 'app.html', 'sw.js']) {
    assert.equal(read(`mobile/www/${file}`), read(file), `mobile/www/${file} difiere`);
  }
});
