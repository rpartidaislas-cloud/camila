// Recorrido de la visita: estado de cada paso a partir de datos ya leídos. Usa el modelo real de la historia clínica.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const V = require('../smyl-visit-model.js');
const H = require('../smyl-history-model.js');
const completo = { name: 'Cristian', registro_estado: 'completo', nombre: 'Cristian' };
const claves = (r) => r.steps.map((s) => s.key);

function historiaConfirmada() {
  const d = H.defaultHistory();
  ['allergies_status', 'conditions_status', 'medications_status', 'surgeries_status', 'dental_status', 'habits_status'].forEach((k) => { d[k] = 'no'; });
  return d;
}

test('cuatro pasos en orden; la simulación nunca cuenta para el progreso', () => {
  const r = V.build({ patient: completo, history: null, files: [], historyModel: H });
  assert.deepEqual(claves(r), ['datos', 'privacidad', 'historia', 'estudios', 'simulacion']);
  assert.equal(r.total, 4);
  assert.equal(r.steps[4].state, 'optional');
  assert.equal(r.steps[4].counts, false);
});

test('paciente por registrar: el primer paso pide sus datos y es el paso actual', () => {
  const r = V.build({ patient: { nombre: 'Por registrar · +52 3312345678' }, history: null, files: [], historyModel: H });
  assert.equal(r.steps[0].state, 'todo');
  assert.equal(r.current, 'datos');
  assert.deepEqual(r.steps[0].actions.map((a) => a.id), ['complete', 'link'], 'sin permiso para gestionar pacientes no hay QR');
  const conPermiso = V.build({ patient: { nombre: 'Por registrar · +52 3312345678' }, history: null, files: [], historyModel: H, canManage: true }).steps[0];
  assert.deepEqual(conPermiso.actions.map((a) => a.id + (a.primary ? '*' : '')), ['qr*', 'complete', 'link']);
});

test('datos por verificar: quien puede gestionar pacientes ve «Confirmar datos»; quien no, solo revisar', () => {
  const p = { nombre: 'Luis', registro_estado: 'por_verificar' };
  assert.deepEqual(V.build({ patient: p, canManage: true }).steps[0].actions.map((a) => a.id), ['confirm', 'complete']);
  assert.deepEqual(V.build({ patient: p, canManage: false }).steps[0].actions.map((a) => a.id), ['complete']);
  assert.equal(V.build({ patient: p, canManage: true }).steps[0].text, 'Los llenó el paciente. Falta confirmarlos.');
});

test('historia: sin empezar, a medias con lo que falta, y completa', () => {
  assert.equal(V.build({ patient: completo, history: null, historyModel: H }).steps[2].text, 'Todavía no se empieza.');
  const medias = H.defaultHistory(); medias.allergies_status = 'no';
  const r = V.build({ patient: completo, history: medias, historyModel: H }).steps[2];
  assert.equal(r.state, 'todo');
  assert.match(r.text, /^1 de 6 confirmadas\. Falta: .+\.$/);
  const full = V.build({ patient: completo, history: historiaConfirmada(), historyModel: H }).steps[2];
  assert.equal(full.state, 'done');
  assert.equal(full.text, 'Completa: 6 de 6 confirmadas.');
});

test('historia que no se pudo leer no se da por hecha ni por faltante', () => {
  assert.equal(V.build({ patient: completo, history: undefined, historyModel: H }).steps[2].state, 'unknown');
  assert.equal(V.build({ patient: completo, history: historiaConfirmada() }).steps[2].state, 'unknown', 'sin el modelo tampoco se supone nada');
});

test('estudios: cuenta fotos y radiografías con su plural; sin ninguno falta; ilegibles quedan desconocidos', () => {
  const f = (c, n) => Array.from({ length: n }, () => ({ category: c }));
  assert.equal(V.build({ patient: completo, files: [] }).steps[3].text, 'Todavía no hay fotos ni radiografías.');
  assert.equal(V.build({ patient: completo, files: f('clinical_photo', 1).concat(f('radiograph', 2)) }).steps[3].text, '1 foto y 2 radiografías.');
  assert.equal(V.build({ patient: completo, files: f('clinical_photo', 3) }).steps[3].text, '3 fotos.');
  assert.equal(V.build({ patient: completo, files: f('consent', 2) }).steps[3].state, 'todo', 'un consentimiento no es un estudio');
  assert.equal(V.build({ patient: completo, files: undefined }).steps[3].state, 'unknown');
});

test('el paso actual es el primero que falta y el progreso cuenta solo los pasos hechos', () => {
  const r = V.build({ patient: completo, history: historiaConfirmada(), files: [], historyModel: H });
  assert.equal(r.current, 'estudios');
  assert.equal(r.done, 2);
  assert.equal(r.steps.filter((s) => s.current).length, 1);
  const todo = V.build({ patient: completo, history: historiaConfirmada(), files: [{ category: 'radiograph' }], historyModel: H });
  assert.equal(todo.current, null);
  assert.equal(todo.done, 3);
});

test('cada paso lleva una acción principal, salvo los ya completos', () => {
  const r = V.build({ patient: { nombre: 'Por registrar · 1' }, history: null, files: [], historyModel: H });
  r.steps.filter((s) => s.state === 'todo').forEach((s) => assert.equal(s.actions.filter((a) => a.primary).length, 1, s.key));
});

test('la entrevista de historia solo se ofrece a quien puede escribir datos clínicos y cuando la historia se pudo leer', () => {
  const ids = (input) => V.build(input).steps[2].actions.map((a) => a.id + (a.primary ? '*' : ''));
  const medias = H.defaultHistory(); medias.allergies_status = 'no';
  assert.deepEqual(ids({ patient: completo, history: null, historyModel: H, canWriteClinical: true }), ['interview*', 'history']);
  assert.deepEqual(ids({ patient: completo, history: medias, historyModel: H, canWriteClinical: true }), ['interview*', 'history']);
  assert.deepEqual(ids({ patient: completo, history: historiaConfirmada(), historyModel: H, canWriteClinical: true }), ['interview', 'history']);
  assert.deepEqual(ids({ patient: completo, history: medias, historyModel: H, canWriteClinical: false }), ['history*'], 'sin permiso solo puede abrirla');
  assert.deepEqual(ids({ patient: completo, history: undefined, historyModel: H, canWriteClinical: true }), ['history*'], 'si no se pudo leer, no se escribe a ciegas');
  assert.equal(V.build({ patient: completo, history: medias, historyModel: H, canWriteClinical: true }).steps[2].actions[0].label, 'Completar la historia');
});

test('cierre: lista lo hecho, lo que falta y lo que no se pudo comprobar', () => {
  const medias = H.defaultHistory(); medias.allergies_status = 'no';
  const c = V.closing(V.build({ patient: completo, consent: { signed: true }, history: medias, files: undefined, historyModel: H }));
  assert.deepEqual(c.items.map((i) => [i.key, i.state]), [['datos', 'done'], ['privacidad', 'done'], ['historia', 'todo'], ['estudios', 'unknown']]);
  assert.equal(c.missing, 1);
  assert.equal(c.unchecked, 1);
  assert.ok(!c.items.some((i) => i.key === 'simulacion'), 'la simulación es opcional y no cuenta');
  const sinFirma = V.closing(V.build({ patient: completo, consent: { signed: false }, history: historiaConfirmada(), files: [{ category: 'radiograph' }], historyModel: H }));
  assert.deepEqual([sinFirma.missing, sinFirma.unchecked], [1, 0], 'solo falta la firma');
  const todo = V.closing(V.build({ patient: completo, consent: { signed: true }, history: historiaConfirmada(), files: [{ category: 'radiograph' }], historyModel: H }));
  assert.deepEqual([todo.missing, todo.unchecked], [0, 0]);
});

test('aviso de privacidad: firmado, sin firmar y sin poder comprobar, con sus acciones según el permiso', () => {
  const paso = (input) => V.build({ patient: completo, history: null, files: [], historyModel: H, ...input }).steps[1];
  const ids = (s) => s.actions.map((a) => a.id + (a.primary ? '*' : ''));
  assert.deepEqual([paso({}).key, paso({}).state], ['privacidad', 'unknown'], 'sin lectura no se da por firmado ni por faltante');
  assert.deepEqual(ids(paso({ canSignConsent: true })), ['consent*'], 'aun sin saberlo se puede pedir la firma (no duplica si ya estaba)');
  assert.deepEqual(ids(paso({})), []);
  const falta = paso({ consent: { signed: false }, canSignConsent: true });
  assert.deepEqual([falta.state, falta.text, ids(falta)], ['todo', 'El paciente aún no firma que conoce cómo cuidamos sus datos y que decide sobre IA, WhatsApp y promociones.', ['consent*']]);
  assert.deepEqual(ids(paso({ consent: { signed: false } })), [], 'sin permiso para firmar no hay botón');
  const hecho = paso({ consent: { signed: true }, consentSummary: 'Firmado por Ana.', canViewConsent: true, canSignConsent: true });
  assert.deepEqual([hecho.state, hecho.text, ids(hecho)], ['done', 'Firmado por Ana.', ['consent-view']]);
  assert.deepEqual(ids(paso({ consent: { signed: true }, canSignConsent: true })), [], 'sin acceso clínico no se ve la firma');
});

test('la firma cuenta para el avance y el paso actual es el primero que falta, no uno sin comprobar', () => {
  const r = V.build({ patient: completo, consent: { signed: false }, history: historiaConfirmada(), files: [{ category: 'radiograph' }], historyModel: H });
  assert.deepEqual([r.done, r.total, r.current], [3, 4, 'privacidad']);
  const sin = V.build({ patient: completo, history: historiaConfirmada(), files: [{ category: 'radiograph' }], historyModel: H });
  assert.equal(sin.current, null, 'lo que no se pudo comprobar no se señala como lo que sigue');
});

test('mensaje de despedida: cortesía y próxima cita, nunca datos clínicos', () => {
  assert.equal(V.farewell({ name: 'Cristian Partida', nextText: 'martes 17 de noviembre a las 4:00 pm' }), 'Hola Cristian, gracias por tu visita. Tu próxima cita es el martes 17 de noviembre a las 4:00 pm. ¡Hasta pronto!');
  assert.equal(V.farewell({ name: 'Ana', nextText: '' }), 'Hola Ana, gracias por tu visita. Cuando quieras agendar tu próxima cita, escríbenos por aquí. ¡Hasta pronto!');
  assert.equal(V.farewell({ name: 'Por registrar · +52 3312345678', nextText: '' }).startsWith('Hola, gracias por tu visita.'), true, 'una ficha por registrar no se saluda con su teléfono');
  assert.equal(V.farewell({}).startsWith('Hola, gracias por tu visita.'), true);
  assert.doesNotMatch(V.farewell({ name: 'Ana', nextText: 'x' }), /alerg|diagn|medic|radiograf|saldo|cobro|\$/i);
});
