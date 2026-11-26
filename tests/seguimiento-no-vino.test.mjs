import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

test('migración: mensaje de inasistencia solo desde que se enciende, un solo mensaje por cita y respuesta «rebook»', () => {
  const sql = read('supabase/migrations/20261128120000_smyl_no_show_followup.sql');
  assert.match(sql, /reminder_type in \('24h', '2h', '48h', 'custom', 'confirmation', 'no_show'\)/);
  assert.match(sql, /response in \('confirmed', 'reschedule', 'rebook'\)/);
  assert.match(sql, /add column if not exists no_show_enabled boolean not null default false/);
  assert.match(sql, /'no_show', now\(\) \+ interval '2 hours'/);
  assert.match(sql, /a\.status = 'no_show'[\s\S]*a\.updated_at >= s\.no_show_since/);
  assert.match(sql, /r\.reminder_type = 'no_show'\s+and r\.status in \('pending', 'processing', 'sent'\)/);
  assert.match(sql, /a\.starts_at >= now\(\) - interval '3 days'/);
  // los avisos normales siguen cancelándose si la cita ya no está confirmada; el de inasistencia sigue su propia regla
  assert.match(sql, /r\.reminder_type <> 'no_show'\s+and a\.tenant_id = r\.tenant_id/);
  assert.match(sql, /\(r\.reminder_type = 'no_show' and a\.status = 'no_show'\)/);
  // la respuesta jamás agenda ni mueve: solo inserta en la tabla de respuestas
  const rpc = sql.slice(sql.indexOf('create or replace function public.smyl_apply_patient_attendance_response'));
  assert.doesNotMatch(rpc, /update public\.smyl_appointments|insert into public\.smyl_appointments/);
  assert.match(sql, /grant execute on function public\.smyl_apply_patient_attendance_response[^;]+to service_role/);
});

test('función: el seguimiento no se omite por «cita a menos de 2 h», vence al día y se cancela al apagar', () => {
  const fn = read('supabase/functions/appointment-reminders/index.ts');
  assert.match(fn, /!isNoShow && startsAt - now < MIN_NOTICE_MS/);
  assert.match(fn, /NO_SHOW_WINDOW_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(fn, /no_show_since = previous\?\.no_show_enabled/);
  assert.match(fn, /kind !== "no_show"/);
  assert.match(fn, /byNoShow/);
  const hook = read('supabase/functions/appointment-negotiations/index.ts');
  assert.match(hook, /"quiero reagendar", "reagendar", "rebook"/);
  for (const bundle of ['appointment-reminders', 'appointment-negotiations', 'whatsapp-templates']) {
    assert.ok(read(`docs/bundles/${bundle}.single-file.ts`).length > 1000, bundle);
  }
  assert.match(read('docs/bundles/appointment-reminders.single-file.ts'), /isNoShow/);
});

test('plantilla nueva con botón «Quiero reagendar» válida para Meta, igual en SMYL y en la función', async () => {
  const catalog = require('../smyl-template-catalog.js');
  const item = catalog.TEMPLATES.find(t => t.id === 'cita_no_asistio_reagendar_v1');
  assert.ok(item, 'está en el catálogo');
  assert.deepEqual(item.buttons.map(b => b.text), ['Quiero reagendar']);
  assert.equal(item.category, 'UTILITY');
  assert.deepEqual(catalog.validate(item), []);
  const shared = await import('../supabase/functions/_shared/whatsapp-template-catalog.mjs');
  assert.ok((shared.TEMPLATES || shared.default?.TEMPLATES).some(t => t.id === 'cita_no_asistio_reagendar_v1'));
});

test('pantalla: sección de seguimiento, respuesta «Quiere reagendar» en la Agenda y copias móviles', () => {
  const ui = read('smyl-reminders.js');
  assert.match(ui, /templateSection\('no_show'/);
  assert.match(ui, /kind: 'no_show', enabled: form\.elements\.no_show_enabled\.checked/);
  const agenda = read('smyl-schedule.js');
  assert.match(agenda, /label:'Quiere reagendar'/);
  assert.match(agenda, /Pidió reagendar su cita/);
  for (const f of ['smyl-reminders.js', 'smyl-schedule.js', 'smyl-template-catalog.js', 'app.html', 'sw.js']) assert.equal(read('mobile/www/' + f), read(f), f);
});
