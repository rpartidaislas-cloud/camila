import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const notice = require('../smyl-notice-settings.js');
const catalog = require('../smyl-template-catalog.js');
const migration = read('supabase/migrations/20261120140000_smyl_appointment_notice_defaults.sql');

const approved = (...ids) => catalog.TEMPLATES.map((t) => ({ id: t.id, status: ids.includes(t.id) ? 'APPROVED' : 'NONE' }));

test('cada aviso recomendado existe en el catálogo, es de utilidad y SMYL puede rellenarlo sola', () => {
  for (const [key, rec] of Object.entries(notice.RECOMMENDED)) {
    const [, audience] = key.split(':');
    const template = catalog.TEMPLATES.find((t) => t.id === rec.id);
    assert.ok(template, `${key} → ${rec.id} no existe`);
    assert.ok(notice.allowedFor(template, audience), `${key} no es válida para ${audience}`);
    assert.deepEqual(catalog.validate(template), [], rec.id);
  }
  assert.equal(Object.keys(notice.RECOMMENDED).length, notice.EVENTS.length * notice.AUDIENCES.length);
});

test('la plantilla del dentista no lleva datos del paciente', () => {
  const template = catalog.TEMPLATES.find((t) => t.id === 'agenda_cita_nueva_profesional_v1');
  assert.ok(template.variables.every((v) => !/patient/.test(v.source)));
  assert.doesNotMatch(template.body, /paciente\s*\{\{/i);
});

test('solo cuentan las aprobadas; sin elección se usa la recomendada cuando ya está aprobada', () => {
  const none = approved();
  assert.equal(notice.effectiveDefault('confirmed', 'patient', {}, none), null);
  const list = approved('cita_confirmada_v1', 'cita_reprogramada_v1');
  assert.deepEqual(notice.effectiveDefault('confirmed', 'patient', {}, list), { id: 'cita_confirmada_v1', source: 'recommended' });
  // La elegida gana mientras siga aprobada…
  assert.deepEqual(notice.effectiveDefault('confirmed', 'patient', { 'confirmed:patient': 'cita_reprogramada_v1' }, list), { id: 'cita_reprogramada_v1', source: 'chosen' });
  // …y si Meta la pausa, vuelve a la recomendada en vez de enviar algo no aprobado.
  assert.deepEqual(notice.effectiveDefault('confirmed', 'patient', { 'confirmed:patient': 'cita_pausada_v9' }, list), { id: 'cita_confirmada_v1', source: 'recommended' });
  assert.equal(notice.effectiveDefault('confirmed', 'professional', {}, list), null);
});

test('el selector separa paciente y dentista, agrupa por categoría y excluye marketing', () => {
  const ids = catalog.TEMPLATES.map((t) => t.id);
  const list = approved(...ids);
  const patient = notice.candidates('patient', catalog, list, 'confirmed');
  const professional = notice.candidates('professional', catalog, list, 'confirmed');
  assert.ok(patient.every((g) => g.id !== 'equipo' && g.id !== 'marketing'));
  assert.deepEqual(professional.map((g) => g.id), ['equipo']);
  assert.equal(patient[0].id, 'citas');
  assert.equal(patient[0].templates[0].id, 'cita_confirmada_v1', 'la recomendada va primero');
  const flat = [...patient, ...professional].flatMap((g) => g.templates);
  assert.ok(flat.every((t) => t.category === 'UTILITY' && notice.isFillable(t)));
  // Una plantilla que pide datos escritos a mano no se ofrece como aviso automático.
  assert.ok(!flat.some((t) => t.variables.some((v) => v.source === 'text' && v.label !== 'Horario anterior')));
  assert.ok(flat.some((t) => t.id === 'agenda_cambio_profesional_v1'));
});

test('sin aprobadas el selector queda vacío', () => {
  assert.deepEqual(notice.candidates('patient', catalog, approved(), 'confirmed'), []);
});

test('la vista previa rellena con los ejemplos de la plantilla', () => {
  const template = catalog.TEMPLATES.find((t) => t.id === 'cita_confirmada_v1');
  assert.doesNotMatch(notice.preview(template), /\{\{/);
  assert.match(notice.preview(template), /Ana/);
});

test('la migración es aditiva, con RLS y un único camino de escritura con permiso', () => {
  assert.match(migration, /create table if not exists public\.smyl_appointment_notice_defaults/);
  assert.match(migration, /primary key \(tenant_id, event, audience\)/);
  assert.match(migration, /alter table public\.smyl_appointment_notice_defaults enable row level security/);
  assert.match(migration, /revoke insert, update, delete on table public\.smyl_appointment_notice_defaults from authenticated/);
  assert.match(migration, /smyl_has_permission\(tenant_id, 'schedule\.read'\)/);
  assert.match(migration, /smyl_has_permission\(v_tenant, 'settings\.manage'\)/);
  assert.match(migration, /v_tenant uuid := public\.smyl_current_tenant\(\)/);
  assert.match(migration, /revoke all on function public\.smyl_set_appointment_notice_default\(text, text, text\) from public, anon/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from public\.(?!smyl_appointment_notice_defaults)/i);
});

test('la pantalla cuelga de Configuración y llega a web, PWA y móvil', () => {
  for (const file of ['smyl-notice-settings.js', 'smyl-notice-settings.css', 'smyl-template-catalog.js', 'smyl-settings-hub.js', 'smyl-navigation.js', 'app.html', 'sw.js']) {
    assert.equal(read(file), read(`mobile/www/${file}`), file);
  }
  assert.match(read('smyl-settings-hub.js'), /title: 'Avisos de cita'[^}]*route: 'avisos-cita'/);
  assert.match(read('smyl-navigation.js'), /'almacenamiento', 'avisos-cita'\]/);
  assert.match(read('app.html'), /smyl-notice-settings\.js\?v=1/);
  assert.match(read('sw.js'), /smyl-notice-settings\.js\?v=1/);
  assert.match(read('sw.js'), /smyl-notice-settings\.css\?v=1/);
});

test('la pantalla nunca envía mensajes ni usa innerHTML con datos', () => {
  const source = read('smyl-notice-settings.js');
  assert.doesNotMatch(source, /action: 'send'|template_variables|lana-inbox/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*(?!['"])\S/);
  for (const [, size] of read('smyl-notice-settings.css').matchAll(/font-size:(\d+)px/g)) assert.ok(Number(size) >= 12, `font-size ${size}px`);
});
