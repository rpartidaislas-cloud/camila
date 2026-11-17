import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js = fs.readFileSync(new URL('../smyl-connections.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../smyl-connections.css', import.meta.url), 'utf8');

function extract(...names) {
  const parts = names.map((name) => {
    const m = js.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\r?\\n  \\}\\r?\\n')) || js.match(new RegExp('  function ' + name + '\\([^\\n]*\\r?\\n'));
    assert.ok(m, 'falta ' + name);
    return m[0];
  });
  return parts.join('\n');
}
const consts = [
  js.match(/var SERVICE_IMPORT_LIMIT = \d+;/)[0],
  js.match(/var DAY_SHORT = [^\n]*\n/)[0],
  js.match(/var DIFF_FIELDS = \[[\s\S]*?\n  \];/)[0],
].join('\n');

const lib = new Function(consts + extract('moneyLabel', 'hourLabel', 'hoursSummary', 'importServiceRows', 'clinicLocationHours', 'diffGet', 'diffList', 'diffTraining', 'readinessItems') +
  ';return { moneyLabel, importServiceRows, clinicLocationHours, diffTraining, readinessItems };')();

const branches = [
  { id: 'b1', name: 'Centro', address_line: 'Juárez 10', city: 'Puebla', state: 'Pue.' },
  { id: 'b2', name: 'Norte', address_line: 'Reforma 5', city: 'Puebla', state: '' },
];
const hours = [
  { branch_id: 'b1', weekday: 1, starts_at: '09:00:00', ends_at: '18:00:00' },
  { branch_id: 'b1', weekday: 2, starts_at: '09:00:00', ends_at: '18:00:00' },
];

test('traer servicios: nombre, duración y precio; no duplica ni inventa precios', () => {
  const services = [
    { id: 's1', name: 'Limpieza', category: 'general', duration_minutes: 45, reference_price: 800 },
    { id: 's2', name: 'Resina', category: 'restaurativa', duration_minutes: 60, reference_price: 1200.5 },
    { id: 's3', name: 'Valoración', category: 'general', duration_minutes: 30, reference_price: null },
    { id: 's4', name: 'Ortodoncia', category: 'general', duration_minutes: 60, reference_price: null },
  ];
  const prices = [{ service_id: 's1', branch_id: 'b1', price: 900 }, { service_id: 's1', branch_id: 'b2', price: 750 }];
  const out = lib.importServiceRows(services, prices, branches, [{ name: ' valoración ' }], () => 'id');
  assert.equal(out.skipped, 1);
  assert.deepEqual(out.rows.map((r) => r.name), ['Limpieza', 'Resina', 'Ortodoncia']);
  assert.match(out.rows[0].pricing_note, /Por sucursal: Centro \$900; Norte \$750/);
  assert.match(out.rows[0].description, /Duración aproximada: 45 min/);
  assert.match(out.rows[1].pricing_note, /Desde \$1,200\.50|Desde \$1\.200,50/);
  assert.match(out.rows[1].description, /^Restaurativa\./);
  assert.equal(out.rows[2].pricing_note, 'Requiere valoración.');
});

test('traer servicios: respeta el máximo de filas', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ id: 's' + i, name: 'Servicio ' + i }));
  const out = lib.importServiceRows(many, [], [], [], () => 'x');
  assert.equal(out.rows.length, 30);
  assert.equal(out.over, 5);
});

test('traer ubicación y horarios: una sucursal o varias', () => {
  assert.deepEqual(lib.clinicLocationHours([], []), { location: '', hours: '' });
  const one = lib.clinicLocationHours([branches[0]], hours);
  assert.equal(one.location, 'Juárez 10, Puebla, Pue.');
  assert.match(one.hours, /Lun–Mar 9:00–18:00/);
  const two = lib.clinicLocationHours(branches, hours);
  assert.match(two.location, /Centro: Juárez 10, Puebla, Pue\. · Norte: Reforma 5, Puebla/);
  assert.match(two.hours, /^Centro: Lun–Mar/);
  assert.doesNotMatch(two.hours, /Norte/);
});

test('cambios sin publicar: campos, servicios y preguntas', () => {
  assert.equal(lib.diffTraining(null, {}), null);
  const published = { assistant: { name: 'LANA', tone: 'profesional' }, clinic: { hours: 'Lun 9-18' }, services: [{ name: 'Limpieza', pricing_note: '$800' }, { name: 'Resina', pricing_note: '' }], faq: [{ question: '¿Costo?', answer: 'Gratis' }] };
  assert.deepEqual(lib.diffTraining(published, JSON.parse(JSON.stringify(published))), []);
  const current = JSON.parse(JSON.stringify(published));
  current.assistant.name = 'Sofía';
  current.clinic.hours = '';
  current.clinic.location = 'Centro';
  current.services = [{ name: 'limpieza', pricing_note: '$900' }, { name: 'Blanqueamiento' }];
  current.faq = [];
  const groups = lib.diffTraining(published, current);
  const flat = Object.fromEntries(groups.map((g) => [g.section, g.items.join(' | ')]));
  assert.match(flat['Identidad'], /Nombre: cambió/);
  assert.match(flat['Tu clínica'], /Horarios: se quitó/);
  assert.match(flat['Tu clínica'], /Ubicación: nuevo/);
  assert.match(flat['Sedes'], /Servicios \(\+ Blanqueamiento · editado: limpieza · quitado: Resina\)/);
  assert.match(flat['Preguntas frecuentes'], /quitado: ¿Costo\?/);
});

test('listo para atender pacientes: cada requisito con su pista', () => {
  const all = lib.readinessItems({ connected: true, channels: 1, branches: 2, previewTurns: 3, published: true, changes: 0 });
  assert.ok(all.every((i) => i.done));
  const none = lib.readinessItems({ connected: false, channels: 0, branches: 0, previewTurns: 0, published: false, changes: 0 });
  assert.equal(none.filter((i) => !i.done).length, 5);
  const dirty = lib.readinessItems({ connected: true, channels: 1, branches: 1, previewTurns: 1, published: true, changes: 2 });
  assert.deepEqual(dirty.filter((i) => !i.done).map((i) => i.key), ['published']);
  assert.match(dirty[4].hint, /cambios sin publicar/);
});

test('interfaz: botones, nota y paso 6 conectados', () => {
  assert.match(js, /data-import-services>Traer mis servicios/);
  assert.match(js, /'Traer ubicación y horarios'/);
  assert.match(js, /importServicesFromClinic\(\); return;/);
  assert.match(js, /importLocationHours\(\); return;/);
  assert.match(js, /\(current === 6 \? readinessMarkup\(form\) : ''\)/);
  assert.match(js, /Listo para atender pacientes/);
  assert.match(css, /\.connections-import-btn/);
});

test('prueba en el mismo paso: laboratorio junto al formulario y escenarios por paso', () => {
  const lib2 = new Function(js.match(/var DEFAULT_SCENARIOS = \[[\s\S]*?\r?\n  \];/)[0] + js.match(/var STEP_SCENARIOS = \{[\s\S]*?\r?\n  \};/)[0] + js.match(/function stepScenarios\(step, faqQuestions\) \{[\s\S]*?\r?\n  \}\r?\n/)[0] + ';return stepScenarios;')();
  for (const step of [1, 2, 3, 4, 5, 6]) assert.equal(lib2(step, []).length, 3);
  assert.match(lib2(3, [])[0][1], /servicios/);
  const faq = lib2(4, ['¿La valoración tiene costo?', '', '¿Aceptan tarjeta?']);
  assert.deepEqual(faq.slice(0, 2).map((x) => x[1]), ['¿La valoración tiene costo?', '¿Aceptan tarjeta?']);
  assert.equal(faq.length, 3);
  assert.match(js, /data-step-test/);
  assert.match(js, /form\.after\(test\); test\.append\(summary, preview\)/);
  assert.match(js, /renderPreview\(\); updateTrainingSteps\(\); previewStatus/);
  assert.match(css, /\.connections-step-test/);
});
