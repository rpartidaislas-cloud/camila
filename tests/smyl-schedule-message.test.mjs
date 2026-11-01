import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const require = createRequire(import.meta.url);
const message = require('../smyl-schedule-message.js');
const catalog = require('../smyl-template-catalog.js');

const ctx = {
  appointment: { starts_at: '2026-10-23T23:00:00Z', status: 'confirmed' },
  patient: { id: 'p1', first: 'Ricardo', last: 'Partida' },
  service: 'Extracción simple', professional: 'Dr Hernán Partida',
  branch: { name: 'Círculo Médico Dental', timezone: 'America/Mexico_City', phone: '33 1234 5678' },
  clinic: 'Bordados Express'
};

test('las variables salen de la cita con el mismo formato del recordatorio automático', () => {
  assert.equal(message.render('patient_first_name', ctx), 'Ricardo');
  assert.equal(message.render('date', ctx), 'viernes 23 de octubre');
  assert.equal(message.render('time', ctx), '5:00 pm');
  assert.equal(message.render('service', ctx), 'Extracción simple');
  assert.equal(message.render('branch_phone', ctx), '33 1234 5678');
  assert.equal(message.render('clinic', { ...ctx, clinic: '' }), 'tu clínica');
  assert.equal(message.fill('Hola {{1}}, tu cita es el {{2}}.', ['Ana', 'lunes']), 'Hola Ana, tu cita es el lunes.');
});

test('solo se ofrecen plantillas aprobadas y se ordenan según el estado de la cita', () => {
  const approved = [
    { id: 'u1', name: 'cita_como_llegar_v1', variable_count: 4, body: 'Hola {{1}}, ... {{2}} ... {{3}} ... {{4}}' },
    { id: 'u2', name: 'cita_confirmada_v1', variable_count: 4, body: 'Hola {{1}}, tu cita en {{2}} quedó para el {{3}} a las {{4}}.' },
    { id: 'u3', name: 'promo_propia', variable_count: 1, body: 'Hola {{1}}' }
  ];
  const list = message.options(approved, catalog.TEMPLATES, 'confirmed', ctx);
  assert.deepEqual(list.map(item => item.name), ['cita_confirmada_v1', 'cita_como_llegar_v1', 'promo_propia']);
  assert.equal(list[0].suggested, true);
  assert.deepEqual(JSON.parse(JSON.stringify(list[0].fields.map(field => field.value))).slice(0, 1), ['Ricardo']);
  assert.equal(list[0].fields.every(field => field.editable === false), true);
  // Un dato libre (ej. cómo llegar) o una plantilla ajena al catálogo se pide al equipo, nunca se inventa.
  assert.equal(list[1].fields.some(field => field.editable), true);
  assert.equal(list[2].fields[0].editable, true);
  assert.equal(list[2].fields[0].value, '');
  assert.deepEqual(message.options([], catalog.TEMPLATES, 'confirmed', ctx), []);
  const missed = message.options([{ id: 'u4', name: 'cita_no_asistio_v1', variable_count: 3, body: 'x' }], catalog.TEMPLATES, 'no_show', ctx);
  assert.equal(missed[0].suggested, true);
});

test('un dato que falta (teléfono de la sucursal) queda editable en lugar de enviarse vacío', () => {
  const list = message.options([{ id: 'u5', name: 'cita_como_llegar_v1', variable_count: 4, body: 'x' }], catalog.TEMPLATES, 'confirmed', { ...ctx, branch: { ...ctx.branch, phone: '' } });
  assert.equal(list[0].fields[3].editable, true);
  assert.equal(list[0].fields[3].value, '');
});

test('el chat del paciente se elige por canal sin repetir y WhatsApp va primero', () => {
  const links = message.pickLinks([
    { lana_channel: 'instagram', lana_conversation_id: 'i1' },
    { lana_channel: 'whatsapp', lana_conversation_id: 'w1' },
    { lana_channel: 'whatsapp', lana_conversation_id: 'w0' },
    { lana_channel: 'telegram', lana_conversation_id: 't1' }
  ]);
  assert.deepEqual(links.map(link => link.lana_conversation_id), ['w1', 'i1']);
  assert.deepEqual(message.pickLinks(null), []);
});

test('el envío pasa por lana-inbox con permiso, plantilla aprobada e Idempotency-Key', () => {
  const source = read('smyl-schedule-message.js');
  assert.match(source, /\/functions\/v1\/lana-inbox/);
  assert.match(source, /action: 'send', conversation_id: conversation\(\), type: 'template', template_id: item\.id, template_variables: values/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /from\('camila_lana_handoffs'\)/);
  assert.match(source, /if \(!host \|\| !ctx \|\| !ctx\.canMessage\)/);
  assert.doesNotMatch(source, /META_TOKEN|graph\.facebook|meta-send/);
  assert.match(source, /send\.disabled = state\.sending \|\| values\.some/);
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /state\.canMessage=owner\|\|perms\.has\('messages\.respond'\)/);
  assert.match(schedule, /SmylScheduleMessage\.mount\(/);
});

test('cancelar pide un motivo con opciones y ya no usa ventanas del navegador', () => {
  const schedule = read('smyl-schedule.js');
  assert.doesNotMatch(schedule, /window\.prompt/);
  assert.match(schedule, /function openCancel\(a\)/);
  assert.match(schedule, /status==='cancelled'&&!reason\)\{openCancel\(a\)/);
  assert.match(schedule, /El paciente avisó/);
});

test('la agenda oculta los filtros con una sola opción y la franja de pendientes sin nada que hacer', () => {
  const schedule = read('smyl-schedule.js');
  assert.match(schedule, /\[\[branch,state\.branches\.filter\(function\(x\)\{return x\.active;\}\)\.length<2\]/);
  assert.match(schedule, /\[prof,state\.professionals\.length<2\]/);
  assert.match(schedule, /\[room,state\.rooms\.filter/);
  assert.match(schedule, /closest\('\.schedule-filter'\)/);
  assert.match(schedule, /if\(!pending\)\{host\.hidden=true/);
  assert.match(read('smyl-schedule.css'), /\.schedule-focus\[hidden\]\{display:none\}/);
});

test('el módulo de mensajes se distribuye igual en web, móvil y PWA', () => {
  for (const file of ['smyl-schedule-message.js', 'smyl-schedule.js', 'smyl-schedule.css', 'app.html', 'sw.js']) {
    assert.equal(read(path.join('mobile', 'www', file)), read(file), `${file} difiere en mobile/www`);
  }
  assert.match(read('app.html'), /smyl-schedule-message\.js\?v=2/);
  assert.match(read('sw.js'), /\/camila\/smyl-schedule-message\.js\?v=2/);
});
