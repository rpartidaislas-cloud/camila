// Modelo puro de la Historia clínica: se EJECUTA (no se busca texto en el código). Cubre lo que antes solo se verificaba a ojo:
// normalizar registros, estados y cobertura, armar el documento que se guarda desde un FormData real y que reabrir y guardar sin
// tocar nada no pierda ningún campo (la fecha de una cirugía se perdía por un nombre de campo distinto entre dibujar y guardar).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../smyl-history-model.js');
const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

const form = (entries) => { const f = new FormData(); for (const [k, v] of entries) f.append(k, v); return f; };
const BLOCKS = ['alerts', 'allergies', 'conditions', 'medications', 'surgeries', 'dental', 'habits'];

/* Lo que envía el editor al guardar una historia ya capturada: una fila por registro (o una vacía), los estados y los campos simples. */
function formFromDocument(doc) {
  const entries = [];
  for (const [kind, spec] of Object.entries(M.RECORD_KINDS)) {
    const rows = doc[spec.records].length ? doc[spec.records] : [{}];
    for (const row of rows) for (const field of spec.fields) entries.push([M.inputName(kind, field) + '[]', row[field] || '']);
  }
  for (const block of BLOCKS) entries.push([block + '_status', doc[block + '_status']]);
  entries.push(['alerts', doc.alerts.join(', ')], ['dental_history', doc.dental_history], ['last_dental_visit', doc.last_dental_visit], ['habits', doc.habits], ['emergency_contact', doc.emergency_contact], ['notes', doc.notes]);
  return form(entries);
}

const complete = () => M.buildDocument(form([
  ['alerts', 'Marcapasos, Anticoagulantes'], ['alerts_status', 'yes'],
  ['allergy_substance[]', 'Penicilina'], ['allergy_reaction[]', 'Urticaria'], ['allergy_severity[]', 'high'], ['allergies_status', 'yes'],
  ['condition_name[]', 'Hipertensión'], ['condition_diagnosed_at[]', '2019-03'], ['condition_status[]', 'controlled'], ['conditions_status', 'yes'],
  ['medication_name[]', 'Warfarina'], ['medication_dose[]', '5 mg'], ['medication_frequency[]', 'Diaria'], ['medication_changed_at[]', '2025-01-10'], ['medications_status', 'yes'],
  ['surgery_procedure[]', 'Apendicectomía'], ['surgery_date[]', '2015-06-01'], ['surgeries_status', 'yes'],
  ['dental_history', 'Endodoncia en 36'], ['last_dental_visit', '2026-03-12'], ['dental_status', 'yes'],
  ['habits', 'Bruxismo'], ['habits_status', 'yes'],
  ['emergency_contact', 'María Pérez 3312345678'], ['notes', 'Prefiere tardes']
]));

test('records(): recorta, descarta filas vacías y prefiere los registros nuevos', () => {
  const rows = M.records({ allergy_records: [{ substance: ' Látex ', reaction: '', severity: '' }, { substance: '', reaction: '  ', severity: '' }, null, 'x'] }, 'allergy_records');
  assert.deepEqual(rows, [{ substance: 'Látex', reaction: '', severity: '' }]);
  const both = M.records({ allergy_records: [{ substance: 'Nuevo' }], allergies: ['Viejo'] }, 'allergy_records');
  assert.deepEqual(both, [{ substance: 'Nuevo' }]);
});

test('records(): reconstruye cada registro desde las listas antiguas', () => {
  assert.deepEqual(M.records({ allergies: ['Penicilina', ' ', 'Látex'] }, 'allergy_records').map((r) => r.substance), ['Penicilina', 'Látex']);
  assert.deepEqual(M.records({ conditions: ['HTA', 'DM2'], conditions_since: '2019-03' }, 'condition_records'), [
    { name: 'HTA', diagnosed_at: '2019-03', status: '' }, { name: 'DM2', diagnosed_at: '', status: '' }]);
  assert.deepEqual(M.records({ medications: ['Warfarina'], medications_changed_at: '2025-01-10' }, 'medication_records'),
    [{ name: 'Warfarina', dose: '', frequency: '', changed_at: '2025-01-10' }]);
  assert.deepEqual(M.records({ surgeries: 'Apendicectomía', surgery_date: '2015-06-01' }, 'surgery_records'), [{ procedure: 'Apendicectomía', date: '2015-06-01' }]);
  assert.deepEqual(M.records({}, 'surgery_records'), []);
});

test('status(): con datos siempre es "yes"; sin datos vale lo guardado o "pending"', () => {
  assert.equal(M.status({ allergies_status: 'no' }, 'allergies_status', 2), 'yes');
  assert.equal(M.status({ allergies_status: 'no' }, 'allergies_status', 0), 'no');
  assert.equal(M.status({ allergies_status: 'unknown' }, 'allergies_status', 0), 'unknown');
  assert.equal(M.status({ allergies_status: 'cualquier cosa' }, 'allergies_status', 0), 'pending');
  assert.equal(M.status({}, 'allergies_status', 0), 'pending');
  assert.equal(M.status(null, 'allergies_status', 0), 'pending');
});

test('cobertura: seis secciones clínicas; contacto y notas no cuentan; "no sé" y "sí sin detalle" no cuentan', () => {
  const empty = M.defaultHistory();
  assert.equal(M.coverage(empty), 0);
  assert.deepEqual(M.pendingLabels(empty), ['Alergias', 'Condiciones', 'Medicamentos', 'Cirugías', 'Dental', 'Hábitos']);
  assert.equal(M.coverage({ ...empty, emergency_contact: 'Alguien', notes: 'Algo' }), 0, 'contacto y notas no cuentan');
  const full = complete();
  assert.equal(M.coverage(full), 6);
  assert.deepEqual(M.pendingLabels(full), []);
  assert.deepEqual(M.pendingLabels({ ...full, surgeries_status: 'unknown', surgery_records: [], surgeries: '' }), ['Cirugías']);
  assert.deepEqual(M.pendingLabels({ ...full, habits_status: 'yes', habits: '' }), ['Hábitos'], '"sí" sin detalle sigue pendiente');
  assert.deepEqual(M.pendingLabels({ ...full, allergies_status: 'no', allergy_records: [], allergies: [] }), [], '"no" confirmado cuenta como revisado');
  assert.equal(M.coverage({ ...empty, allergies: ['Penicilina'], conditions: ['HTA'] }), 2, 'las listas antiguas también cuentan');
});

test('missing(): usa los registros, no solo las listas antiguas', () => {
  assert.deepEqual(M.missing(M.defaultHistory()), ['alergias', 'condiciones médicas', 'medicamentos', 'antecedentes dentales']);
  const onlyRecords = { ...M.defaultHistory(), allergy_records: [{ substance: 'Látex', reaction: '', severity: '' }], allergies_status: 'yes' };
  assert.ok(!M.missing(onlyRecords).includes('alergias'), 'un documento con registros pero sin la lista antigua no debe marcar alergias como faltantes');
});

test('CONTRATO: cada campo de cada registro que dibuja el editor (inputName) llega al documento guardado', () => {
  for (const [kind, spec] of Object.entries(M.RECORD_KINDS)) {
    const f = form(spec.fields.map((field) => [M.inputName(kind, field) + '[]', 'valor-' + field]));
    const saved = M.buildDocument(f)[spec.records];
    assert.equal(saved.length, 1, `${kind}: debe guardar una fila`);
    for (const field of spec.fields) assert.equal(saved[0][field], 'valor-' + field, `${kind}.${field} se perdió al guardar`);
  }
});

test('buildDocument(): descarta filas sin el campo obligatorio, recorta y aplica los topes', () => {
  const f = form([['allergy_substance[]', ' Látex '], ['allergy_reaction[]', 'Rinitis'], ['allergy_severity[]', 'low'],
    ['allergy_substance[]', ''], ['allergy_reaction[]', 'huérfana'], ['allergy_severity[]', 'high']]);
  assert.deepEqual(M.buildDocument(f).allergy_records, [{ substance: 'Látex', reaction: 'Rinitis', severity: 'low' }]);
  const many = form(Array.from({ length: 30 }, (_, i) => ['condition_name[]', 'C' + i]));
  assert.equal(M.buildDocument(many).condition_records.length, M.MAX_RECORDS);
  assert.equal(M.buildDocument(form([['alerts', Array.from({ length: 60 }, (_, i) => 'a' + i).join(',')]])).alerts.length, 40);
  assert.deepEqual(M.buildDocument(form([['alerts', ' a , ,b,, ']])).alerts, ['a', 'b']);
});

test('buildDocument(): estados — con datos "yes", valor inválido o ausente "pending", y se conserva el elegido', () => {
  const doc = M.buildDocument(form([['allergy_substance[]', 'Látex'], ['allergies_status', 'no'], ['conditions_status', 'no'], ['medications_status', 'unknown'], ['surgeries_status', 'raro']]));
  assert.equal(doc.allergies_status, 'yes', 'con datos prevalece "yes" aunque el radio diga "no"');
  assert.equal(doc.conditions_status, 'no');
  assert.equal(doc.medications_status, 'unknown');
  assert.equal(doc.surgeries_status, 'pending');
  assert.equal(doc.habits_status, 'pending');
});

test('buildDocument(): mantiene las listas y fechas antiguas por compatibilidad', () => {
  const doc = complete();
  assert.deepEqual(doc.allergies, ['Penicilina']);
  assert.deepEqual(doc.conditions, ['Hipertensión']);
  assert.equal(doc.conditions_since, '2019-03');
  assert.deepEqual(doc.medications, ['Warfarina']);
  assert.equal(doc.medications_changed_at, '2025-01-10');
  assert.equal(doc.surgeries, 'Apendicectomía');
  assert.equal(doc.surgery_date, '2015-06-01', 'la fecha de la cirugía debe llegar al documento');
  assert.equal(doc.surgery_records[0].date, '2015-06-01');
  const twoSurgeries = M.buildDocument(form([['surgery_procedure[]', 'A'], ['surgery_date[]', ''], ['surgery_procedure[]', 'B'], ['surgery_date[]', '2020-01-01']]));
  assert.equal(twoSurgeries.surgeries, 'A; B');
  assert.equal(twoSurgeries.surgery_date, '2020-01-01', 'la primera fecha no vacía');
});

test('IDA Y VUELTA: reabrir y guardar sin tocar nada no cambia ningún campo', () => {
  const doc = complete();
  const again = M.buildDocument(formFromDocument(doc));
  assert.deepEqual(again, doc);
  assert.deepEqual(M.buildDocument(formFromDocument(again)), doc, 'es estable al repetirlo');
  const empty = M.buildDocument(formFromDocument(M.defaultHistory()));
  assert.deepEqual(Object.keys(empty).sort(), Object.keys(M.defaultHistory()).sort(), 'el documento guardado y el valor por defecto tienen las mismas claves');
  assert.deepEqual(empty, M.defaultHistory());
});

test('readModel(): cinco secciones en orden, con seguridad, pendientes y cobertura', () => {
  const m = M.readModel(complete(), { updated: '4 nov 2026', revision: 3, canWrite: true });
  assert.deepEqual(m.sections.map((s) => s.key), ['safety', 'medical', 'dental', 'habits', 'admin']);
  assert.deepEqual(m.sections.map((s) => s.step), [0, 1, 2, 3, 4]);
  assert.equal(m.canWrite, true);
  assert.equal(m.revision, 3);
  assert.deepEqual(m.coverage, { done: 6, total: 6, pending: [] });
  const safety = m.sections[0];
  assert.equal(safety.state, 'alert');
  const [allergies, alerts] = safety.rows;
  assert.equal(allergies.state, 'alert');
  assert.equal(allergies.badge, 'Grave');
  assert.match(allergies.lines[0], /Penicilina · Reacción: Urticaria · Gravedad: Alta/);
  assert.deepEqual(alerts.lines, ['Marcapasos', 'Anticoagulantes']);
  const surgery = m.sections[1].rows[2];
  assert.equal(surgery.badge, '1 registro');
  assert.match(surgery.lines[0], /Apendicectomía · 1 jun\.? 2015/);
  assert.equal(m.sections[4].state, 'neutral');
});

test('readModel(): lo no confirmado sale pendiente con el motivo, y vacío da seguridad pendiente', () => {
  const m = M.readModel(M.defaultHistory(), {});
  assert.equal(m.canWrite, false);
  assert.deepEqual(m.coverage.pending, ['Alergias', 'Condiciones', 'Medicamentos', 'Cirugías', 'Dental', 'Hábitos']);
  assert.equal(m.sections[0].state, 'pending');
  assert.match(m.sections[0].copy, /Alertas por confirmar/);
  assert.ok(m.sections[1].rows.every((r) => r.state === 'pending' && r.badge === 'Por confirmar'));
  assert.equal(m.sections[1].state, 'pending');
  const unknown = M.readModel({ ...M.defaultHistory(), medications_status: 'unknown', surgeries_status: 'yes' }, {}).sections[1].rows;
  assert.equal(unknown[1].text, 'El paciente no lo sabe');
  assert.match(unknown[2].text, /falta registrar el detalle/);
  assert.equal(m.sections[4].rows[0].text, 'Sin registrar');
});

test('readModel(): "no" confirmado deja la sección en orden y sin alertas dice "Sin alertas conocidas"', () => {
  const none = { ...M.defaultHistory(), alerts_status: 'no', allergies_status: 'no', conditions_status: 'no', medications_status: 'no', surgeries_status: 'no', dental_status: 'no', habits_status: 'no' };
  const m = M.readModel(none, {});
  assert.equal(m.sections[0].state, 'ok');
  assert.match(m.sections[0].copy, /Sin alertas conocidas/);
  assert.equal(m.sections[1].state, 'ok');
  assert.equal(m.sections[0].rows[1].badge, 'Ninguna confirmada');
  assert.deepEqual(m.coverage.pending, []);
});

test('summaries y conciseValue: formato legible', () => {
  assert.equal(M.summaries.allergy({ substance: 'Látex', reaction: '', severity: 'moderate' }), 'Látex · Gravedad: Moderada');
  assert.equal(M.summaries.condition({ name: 'HTA', diagnosed_at: '2019-03', status: 'controlled' }), 'HTA · marzo de 2019 · Controlada');
  assert.equal(M.summaries.medication({ name: 'Warfarina', dose: '5 mg', frequency: 'Diaria', changed_at: '' }), 'Warfarina · 5 mg · Diaria');
  assert.equal(M.date(''), '');
  assert.equal(M.date('texto raro'), 'texto raro');
  assert.equal(M.conciseValue({ alerts: ['a', 'b'] }, 'alerts', 'alerts_status', 'Ninguna'), 'a, b');
  assert.equal(M.conciseValue({ alerts_status: 'no' }, 'alerts', 'alerts_status', 'Ninguna'), 'Ninguna');
  assert.equal(M.conciseValue({ alerts_status: 'unknown' }, 'alerts', 'alerts_status', 'Ninguna'), 'No se sabe');
  assert.equal(M.conciseValue({}, 'alerts', 'alerts_status', 'Ninguna'), 'Por confirmar');
});

test('el modelo es puro y la ficha lo carga antes que la vista y la ficha, también offline y en móvil', () => {
  const model = read('smyl-history-model.js'), patient = read('smyl-patient-360.js'), app = read('app.html'), sw = read('sw.js');
  assert.doesNotMatch(model.replace(/root\.SmylHistoryModel/, ''), /\bdocument\.|\bwindow\.|\bfetch\(|XMLHttpRequest|localStorage|\.innerHTML/, 'sin DOM ni red');
  const order = ['smyl-history-model.js', 'smyl-history-read.js', 'smyl-patient-360.js'].map((f) => app.indexOf(`src="${f}?v=`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'el modelo se carga antes que la vista y la ficha');
  assert.match(sw, /\/camila\/smyl-history-model\.js\?v=1/);
  for (const f of ['smyl-history-model.js', 'smyl-history-read.js', 'smyl-patient-360.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), `${f}: copia móvil`);
  for (const gone of ['historyRecords', 'historyStatus', 'historyCoverage', 'historyPendingLabels', 'historyMissing', 'historyFormRecords', 'historyFormStatus', 'historyReadModel', 'defaultHistory', 'allergySummary'])
    assert.doesNotMatch(patient, new RegExp(`function ${gone}\\(`), `${gone}: ya no se redefine en la ficha, se toma del modelo`);
  assert.match(patient, /if\(!H\)\{console\.error\(/, 'si falta el modelo no se rompe la página entera');
});
