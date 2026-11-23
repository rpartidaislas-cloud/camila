import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const notice = require('../smyl-appointment-notice.js');
const catalog = require('../smyl-template-catalog.js');

const ALL = ['cita_confirmada_v1', 'agenda_cita_nueva_profesional_v1', 'cita_reprogramada_v1', 'agenda_cambio_profesional_v1', 'cita_cancelada_clinica_v1', 'agenda_cancelacion_profesional_v1'];
const approved = ALL.map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, name }));
const appointment = { id: 'a1', patient_id: 'p1', professional_id: 'pr1', starts_at: '2026-11-24T16:00:00.000Z', source: 'manual' };
const ctx = { patient: { first: 'Julián', last: 'Quiñonez' }, service: 'Blanqueamiento dental', professional: 'Dra. Fernanda Lozano', branch: { name: 'Sucursal Plaza Sol', timezone: 'America/Mexico_City' }, clinic: 'Clínica Sonríe' };
const base = (extra = {}) => ({ event: 'confirmed', appointment, previous: null, ctx, defaults: {}, approved, patientConversation: 'c-pat', professionalConversation: 'c-pro', autoConfirmation: false, ...extra });
const by = (rows, audience) => rows.find((row) => row.audience === audience);

test('al confirmar ofrece paciente y dentista con el mensaje ya armado y marcados por defecto', () => {
  const rows = notice.planRows(base());
  assert.equal(rows.length, 2);
  const patient = by(rows, 'patient'), pro = by(rows, 'professional');
  assert.equal(patient.state, 'ready'); assert.equal(patient.checked, true);
  assert.equal(patient.templateId, 'cita_confirmada_v1');
  assert.match(patient.preview, /Hola Julián, tu cita en Clínica Sonríe quedó confirmada para el .* a las 10:00 am/);
  assert.doesNotMatch(patient.preview, /\{\{/);
  assert.equal(pro.state, 'ready'); assert.equal(pro.templateId, 'agenda_cita_nueva_profesional_v1');
  assert.match(pro.preview, /Sucursal Plaza Sol/);
  assert.doesNotMatch(pro.preview, /Julián|Quiñonez/, 'el aviso al dentista no lleva datos del paciente');
});

test('al reprogramar el aviso al dentista incluye el horario anterior', () => {
  const rows = notice.planRows(base({ event: 'rescheduled', previous: { starts_at: '2026-11-21T16:00:00.000Z' } }));
  const pro = by(rows, 'professional');
  assert.equal(pro.state, 'ready'); assert.equal(pro.templateId, 'agenda_cambio_profesional_v1');
  assert.match(pro.preview, /la cita del .*21.* a las 10:00 am ahora está programada/);
  // Sin el horario anterior no se arma un mensaje a medias.
  const missing = by(notice.planRows(base({ event: 'rescheduled' })), 'professional');
  assert.equal(missing.state, 'blocked'); assert.match(missing.reason, /horario anterior/);
});

test('al cancelar usa las plantillas de cancelación', () => {
  const rows = notice.planRows(base({ event: 'cancelled' }));
  assert.equal(by(rows, 'patient').templateId, 'cita_cancelada_clinica_v1');
  assert.equal(by(rows, 'professional').templateId, 'agenda_cancelacion_profesional_v1');
});

test('sin plantilla aprobada el aviso no se ofrece y lleva a configurarlo', () => {
  const rows = notice.planRows(base({ approved: [] }));
  for (const row of rows) { assert.equal(row.state, 'blocked'); assert.equal(row.action.id, 'settings'); assert.equal(row.checked, false); }
});

test('sin chat del paciente o sin WhatsApp del dentista se explica y no se envía', () => {
  const rows = notice.planRows(base({ patientConversation: '', professionalConversation: '' }));
  assert.equal(by(rows, 'patient').state, 'blocked'); assert.equal(by(rows, 'patient').action.id, 'inbox');
  assert.equal(by(rows, 'professional').state, 'blocked'); assert.match(by(rows, 'professional').reason, /vincul/);
  assert.ok(rows.every((row) => !row.conversationId));
});

test('una cita sin dentista solo ofrece avisar al paciente', () => {
  const rows = notice.planRows(base({ appointment: { ...appointment, professional_id: null } }));
  assert.deepEqual(rows.map((row) => row.audience), ['patient']);
});

test('si la confirmación automática ya se la manda, no se duplica; cancelar sí se ofrece', () => {
  assert.equal(by(notice.planRows(base({ autoConfirmation: true })), 'patient').state, 'auto');
  assert.equal(by(notice.planRows(base({ autoConfirmation: true, event: 'rescheduled', previous: { starts_at: appointment.starts_at } })), 'patient').state, 'auto');
  assert.equal(by(notice.planRows(base({ autoConfirmation: true, event: 'cancelled' })), 'patient').state, 'ready');
  // Las citas del chat no entran en la automática (ya se habló ahí): sí se ofrece.
  assert.equal(by(notice.planRows(base({ autoConfirmation: true, appointment: { ...appointment, source: 'inbox' } })), 'patient').state, 'ready');
});

test('la plantilla elegida en Configuración gana mientras siga aprobada', () => {
  const rows = notice.planRows(base({ defaults: { 'confirmed:patient': 'cita_reprogramada_v1' } }));
  assert.equal(by(rows, 'patient').templateId, 'cita_reprogramada_v1');
  const paused = notice.planRows(base({ defaults: { 'confirmed:patient': 'cita_pausada_v9' } }));
  assert.equal(by(paused, 'patient').templateId, 'cita_confirmada_v1');
});

test('cada plantilla recomendada se puede armar solo con los datos de la cita', () => {
  for (const id of ALL) {
    const template = catalog.TEMPLATES.find((item) => item.id === id);
    const values = notice.valuesFor(template, { ...ctx, appointment }, { starts_at: '2026-11-21T16:00:00.000Z' });
    assert.ok(values.every(Boolean), id);
  }
});

test('la Agenda ofrece el aviso en confirmar, reprogramar (ficha, arrastre, mover) y cancelar', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /offerNotice\('confirmed',id\)/);
  assert.equal((schedule.match(/offerNotice\('rescheduled'/g) || []).length, 3);
  assert.match(schedule, /offerNotice\('cancelled',a\.id\)/);
  assert.match(schedule, /if\(!walkIn\)offerNotice/, 'quien llega sin cita está presente: no se avisa');
  assert.match(schedule, /if\(!window\.SmylAppointmentNotice\|\|!state\.canMessage\)return/);
});

test('el componente nunca envía sin clic, usa idempotencia y no inserta HTML con datos', () => {
  const source = read('smyl-appointment-notice.js');
  assert.match(source, /send\.onclick = sendAll/);
  assert.equal((source.match(/sendTemplate\(/g) || []).length, 1);
  assert.match(source, /row\.idempotency \|\| \(row\.idempotency = sms\(\)\.uuid\(\)\)/);
  assert.doesNotMatch(source, /innerHTML/);
  for (const [, size] of read('smyl-appointment-notice.css').matchAll(/font-size:(\d+)px/g)) assert.ok(Number(size) >= 12, `font-size ${size}px`);
});

test('web, móvil y PWA publican el aviso de cita', () => {
  for (const file of ['smyl-appointment-notice.js', 'smyl-appointment-notice.css', 'smyl-schedule.js', 'smyl-schedule-message.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
  assert.match(read('app.html'), /smyl-appointment-notice\.js\?v=3/);
  assert.match(read('sw.js'), /smyl-appointment-notice\.js\?v=3/);
  assert.match(read('sw.js'), /smyl-appointment-notice\.css\?v=2/);
});

test('cuando no se puede ofrecer el aviso lo dice con un mensaje discreto, sin diálogo y sin spam', () => {
  const source = read('smyl-appointment-notice.js');
  assert.match(source, /aún no hay una plantilla aprobada por Meta para este aviso/);
  assert.match(source, /No pudimos consultar tus plantillas de WhatsApp, así que no se ofreció avisar/);
  assert.match(source, /Date\.now\(\) - stamp < 120000/, 'como mucho un mensaje cada 2 minutos');
  assert.match(source, /Configurar avisos/);
  // Sin plantillas aprobadas no se abre el diálogo: solo el mensaje.
  const decision = source.slice(source.indexOf('if (!offerable &&'), source.indexOf('return show(opts, ctx, rows);'));
  assert.doesNotMatch(decision, /show\(/);
  assert.match(read('smyl-appointment-notice.css'), /\.notice-toast\{/);
});
