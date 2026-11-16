// Historia por preguntas: el documento que arma debe ser EXACTAMENTE el que armaría el editor (mismo modelo), sin perder nada.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../smyl-history-model.js');
const I = require('../smyl-history-interview.js');

/* Un formulario como el del editor: mismos nombres de campo (inputName) y estados. */
function formulario({ listas = {}, valores = {} } = {}) {
  return { get: (n) => (valores[n] === undefined ? null : valores[n]), getAll: (n) => listas[n] || [] };
}
const todoNo = () => ({ allergies_status: 'no', alerts_status: 'no', conditions_status: 'no', medications_status: 'no', surgeries_status: 'no', dental_status: 'no', habits_status: 'no' });
function responderTodoNo(d) { return I.QUESTIONS.reduce((x, q) => I.setStatus(x, q.key, 'no'), d); }

test('sin historia, las siete preguntas están pendientes y en orden de seguridad', () => {
  const d = I.create(null, H);
  assert.deepEqual(I.QUESTIONS.map((q) => q.key), ['allergies', 'alerts', 'conditions', 'medications', 'surgeries', 'dental', 'habits']);
  assert.deepEqual(I.pendingKeys(null, H), I.QUESTIONS.map((q) => q.key));
  assert.equal(I.isAnswered(d, 'allergies'), false);
});

test('responder «No» a todo da el mismo documento que el editor con todo en «No»', () => {
  const doc = I.toDocument(responderTodoNo(I.create(null, H)));
  assert.deepEqual(doc, H.buildDocument(formulario({ valores: { ...todoNo(), alerts: '', dental_history: '', last_dental_visit: '', habits: '', emergency_contact: '', notes: '' } })));
  assert.equal(H.pendingLabels(doc).length, 0, 'la historia queda completa');
});

test('una alergia con detalle llega al documento como en el editor', () => {
  let d = I.setStatus(I.create(null, H), 'allergies', 'yes');
  d = I.setField(d, 'allergies', 0, 'substance', 'penicilina');
  d = I.setField(d, 'allergies', 0, 'reaction', 'urticaria');
  d = I.setField(d, 'allergies', 0, 'severity', 'high');
  const doc = I.toDocument(d);
  assert.deepEqual(doc.allergy_records, [{ substance: 'penicilina', reaction: 'urticaria', severity: 'high' }]);
  assert.deepEqual(doc.allergies, ['penicilina']);
  assert.equal(doc.allergies_status, 'yes');
});

test('ida y vuelta: una historia ya guardada, sin tocar nada, se guarda idéntica', () => {
  const rica = H.buildDocument(formulario({
    listas: { 'allergy_substance[]': ['látex'], 'allergy_reaction[]': ['picazón'], 'allergy_severity[]': ['low'], 'condition_name[]': ['hipertensión'], 'condition_diagnosed_at[]': ['2022-03'], 'condition_status[]': ['controlled'], 'medication_name[]': ['losartán'], 'medication_dose[]': ['50 mg'], 'medication_frequency[]': ['cada 24 h'], 'medication_changed_at[]': ['2026-01'], 'surgery_procedure[]': ['apendicectomía'], 'surgery_date[]': ['2015-06-01'] },
    valores: { alerts: 'anticoagulantes, marcapasos', dental_history: 'ortodoncia hace 5 años', last_dental_visit: '2026-02-10', habits: 'rechina los dientes', emergency_contact: 'Ana 33 1111 2222', notes: 'prefiere citas por la tarde', allergies_status: 'yes', conditions_status: 'yes', medications_status: 'yes', surgeries_status: 'yes', alerts_status: 'yes', dental_status: 'yes', habits_status: 'yes' }
  }));
  const d = I.create(rica, H);
  assert.deepEqual(I.toDocument(d), rica);
  assert.equal(I.isDirty(d, rica), false);
});

test('lo ya registrado se conserva con todos sus campos y se puede agregar sin perderlo', () => {
  const base = H.buildDocument(formulario({ listas: { 'medication_name[]': ['losartán'], 'medication_dose[]': ['50 mg'], 'medication_frequency[]': ['cada 24 h'], 'medication_changed_at[]': ['2026-01'] }, valores: { medications_status: 'yes' } }));
  let d = I.addRow(I.create(base, H), 'medications');
  d = I.setField(d, 'medications', 1, 'name', 'metformina');
  const doc = I.toDocument(d);
  assert.deepEqual(doc.medication_records.map((r) => r.name), ['losartán', 'metformina']);
  assert.equal(doc.medication_records[0].dose, '50 mg');
  assert.equal(doc.medications_changed_at, '2026-01');
});

test('responder «No» no borra lo ya registrado: hay que quitarlo fila por fila', () => {
  const base = H.buildDocument(formulario({ listas: { 'allergy_substance[]': ['látex'], 'allergy_reaction[]': [''], 'allergy_severity[]': [''] }, valores: { allergies_status: 'yes' } }));
  let d = I.setStatus(I.create(base, H), 'allergies', 'no');
  assert.equal(I.toDocument(d).allergy_records.length, 1, 'sigue la alergia');
  assert.equal(d.answers.allergies.status, 'yes', 'el borrador sigue diciendo que hay alergia, no «No»');
  assert.equal(I.isAnswered(d, 'allergies'), true);
  d = I.removeRow(d, 'allergies', 0);
  assert.equal(d.answers.allergies.status, 'pending');
  d = I.setStatus(d, 'allergies', 'no');
  assert.deepEqual(I.toDocument(d).allergy_records, []);
  assert.equal(I.toDocument(d).allergies_status, 'no');
});

test('«Sí» sin decir cuál no se puede guardar; «No» y «No se sabe» sí cuentan como respondidas', () => {
  const d = I.setStatus(I.create(null, H), 'conditions', 'yes');
  assert.equal(I.isAnswered(d, 'conditions'), false);
  assert.deepEqual(I.problems(d).map((p) => p.key), ['conditions']);
  assert.match(I.problems(d)[0].message, /Escribe cuál/);
  assert.equal(I.isAnswered(I.setStatus(I.create(null, H), 'conditions', 'unknown'), 'conditions'), true);
  assert.equal(I.isAnswered(I.setStatus(I.create(null, H), 'conditions', 'no'), 'conditions'), true);
  const texto = I.setStatus(I.create(null, H), 'habits', 'yes');
  assert.match(I.problems(texto)[0].message, /qué respondió/);
});

test('hábitos y antecedentes dentales (texto libre) y su estado', () => {
  let d = I.setText(I.create(null, H), 'habits', 'rechina los dientes');
  d = I.setStatus(d, 'dental', 'unknown');
  const doc = I.toDocument(d);
  assert.equal(doc.habits, 'rechina los dientes');
  assert.equal(doc.habits_status, 'yes');
  assert.equal(doc.dental_status, 'unknown');
  assert.equal(I.toDocument(I.setText(d, 'habits', '')).habits_status, 'pending', 'al borrar el texto vuelve a pendiente');
});

test('las alertas son textos cortos: una coma no las parte en dos', () => {
  let d = I.setStatus(I.create(null, H), 'alerts', 'yes');
  d = I.setField(d, 'alerts', 0, 'text', 'embarazo, 20 semanas');
  assert.deepEqual(I.toDocument(d).alerts, ['embarazo 20 semanas']);
});

test('el contacto de emergencia y las notas de la historia vigente no se pierden', () => {
  const base = { ...H.defaultHistory(), emergency_contact: 'Ana 33 1111 2222', notes: 'nota previa', last_dental_visit: '2026-02-10' };
  const doc = I.toDocument(responderTodoNo(I.create(base, H)));
  assert.equal(doc.emergency_contact, 'Ana 33 1111 2222');
  assert.equal(doc.notes, 'nota previa');
  assert.equal(doc.last_dental_visit, '2026-02-10');
});

test('solo se pregunta lo pendiente de una historia a medias', () => {
  const medias = { ...H.defaultHistory(), allergies_status: 'no', conditions_status: 'no', alerts_status: 'no' };
  assert.deepEqual(I.pendingKeys(medias, H), ['medications', 'surgeries', 'dental', 'habits']);
  assert.deepEqual(I.pendingKeys(responderToDoc(), H), [], 'completa: nada pendiente');
  function responderToDoc() { return I.toDocument(responderTodoNo(I.create(null, H))); }
});

test('una historia antigua con solo listas se reconstruye y se guarda con detalle', () => {
  const vieja = { ...H.defaultHistory(), allergies: ['penicilina', 'látex'], allergies_status: 'yes' };
  const d = I.create(vieja, H);
  assert.deepEqual(d.answers.allergies.rows.map((r) => r.substance), ['penicilina', 'látex']);
  assert.equal(I.toDocument(d).allergy_records.length, 2);
});

test('los reductores no modifican el borrador anterior', () => {
  const a = I.create(null, H);
  const copia = JSON.stringify(a.answers);
  I.setStatus(a, 'allergies', 'yes'); I.setText(a, 'habits', 'x'); I.addRow(a, 'alerts');
  assert.equal(JSON.stringify(a.answers), copia);
});

test('máximo de registros por sección y revisión legible', () => {
  let d = I.setStatus(I.create(null, H), 'medications', 'yes');
  for (let i = 0; i < 30; i++) d = I.addRow(d, 'medications');
  assert.equal(d.answers.medications.rows.length, H.MAX_RECORDS);
  let r = I.setStatus(I.create(null, H), 'allergies', 'yes');
  r = I.setField(r, 'allergies', 0, 'substance', 'penicilina'); r = I.setField(r, 'allergies', 0, 'reaction', 'urticaria');
  assert.deepEqual(I.summary(r, 'allergies'), ['penicilina, reacción: urticaria']);
  assert.deepEqual(I.summary(I.create(null, H), 'habits'), ['Sin responder']);
  assert.deepEqual(I.summary(I.setStatus(I.create(null, H), 'habits', 'no'), 'habits'), ['No']);
});

test('isDirty distingue «sin cambios» de «hay respuestas nuevas»', () => {
  const vacia = I.create(null, H);
  assert.equal(I.isDirty(vacia, null), false);
  assert.equal(I.isDirty(I.setStatus(vacia, 'habits', 'no'), null), true);
});
