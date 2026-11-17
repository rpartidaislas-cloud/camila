// Reglas puras del alta rápida del consultorio. Deben coincidir con las de la agenda (smyl-schedule.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const Q = createRequire(import.meta.url)('../smyl-patient-quick.js');
const schedule = fs.readFileSync(new URL('../smyl-schedule.js', import.meta.url), 'utf8');

test('solo el teléfono es obligatorio; sin nombre la ficha queda por registrar', () => {
  const r = Q.prepare({ tel: '33 1234 5678' });
  assert.equal(r.ok, true);
  assert.equal(r.pending, true);
  assert.deepEqual(r.row, { nombre: 'Por registrar · +52 3312345678', apellido: '', telefono: '+52 3312345678', email: '' });
});

test('con nombre no queda pendiente y el teléfono es opcional', () => {
  assert.deepEqual(Q.prepare({ nombre: '  Ana López ', tel: '' }), { ok: true, pending: false, row: { nombre: 'Ana López', apellido: '', telefono: '', email: '' } });
});

test('sin teléfono ni nombre, o con teléfono inválido, no se crea nada', () => {
  assert.equal(Q.prepare({}).ok, false);
  assert.equal(Q.prepare({ nombre: '  ', tel: ' ' }).field, 'tel');
  const mal = Q.prepare({ tel: '1234' });
  assert.equal(mal.ok, false);
  assert.match(mal.error, /Revisa el teléfono/);
});

test('el teléfono mexicano se normaliza y se compara con o sin lada', () => {
  assert.equal(Q.composePhone('3312345678'), '+52 3312345678');
  assert.equal(Q.composePhone('+1 415 555 0100'), '+1 415 555 0100');
  assert.equal(Q.phoneKey('+52 33 1234 5678'), '3312345678');
  assert.equal(Q.phoneKey('+521 33 1234 5678'), '3312345678');
  assert.equal(Q.phoneKey('12'), '');
});

test('reconoce fichas por registrar por su estado o por su nombre provisional', () => {
  assert.equal(Q.isPending({ nombre: 'Luis', registro_estado: 'pendiente' }), true);
  assert.equal(Q.isPending({ nombre: 'Por registrar · 33 1234' }), true);
  assert.equal(Q.isPending({ nombre: 'Luis', registro_estado: 'completo' }), false);
  assert.equal(Q.isPending(null), false);
});

test('las fichas provisionales se muestran como «Por registrar» en las listas', () => {
  assert.equal(Q.listName({ nombre: 'Por registrar · +52 3312345678' }), 'Por registrar');
  assert.equal(Q.listName({ nombre: 'Ana', apellido: 'López' }), 'Ana López');
});

test('iniciales y nombre visible', () => {
  assert.equal(Q.initials('Cristian Partida'), 'CP');
  assert.equal(Q.initials('Ana'), 'A');
  assert.equal(Q.initials('Por registrar · +52 33 1234 5678'), '?');
  assert.equal(Q.displayName({ nombre: 'Ana', apellido: 'López' }), 'Ana López');
});

test('enlace de WhatsApp: 10 dígitos llevan 52; sin teléfono válido no hay enlace', () => {
  assert.equal(Q.whatsappUrl('33 1234 5678', 'Hola'), 'https://wa.me/523312345678?text=Hola');
  assert.equal(Q.whatsappUrl('+52 33 1234 5678'), 'https://wa.me/523312345678');
  assert.equal(Q.whatsappUrl('1234'), '');
  assert.equal(Q.whatsappUrl(''), '');
});

test('mismas reglas que la agenda: prefijo y normalización idénticos', () => {
  assert.match(schedule, /var PENDING_PREFIX='Por registrar · '/);
  assert.match(schedule, /return d\.length===10\?'\+52 '\+d:raw/);
  assert.match(schedule, /if\(d\.length===12&&d\.slice\(0,2\)==='52'\)return d\.slice\(2\);if\(d\.length===13&&d\.slice\(0,3\)==='521'\)return d\.slice\(3\)/);
});
