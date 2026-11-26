import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('migración: tipo 48h, interruptor apagado por omisión y reclamo que lo programa 48 h antes', () => {
  const sql = read('supabase/migrations/20261128110000_smyl_reminder_48h.sql');
  assert.match(sql, /reminder_type in \('24h', '2h', '48h', 'custom', 'confirmation'\)/);
  assert.match(sql, /add column if not exists reminder_48h_enabled boolean not null default false/);
  assert.match(sql, /'48h', a\.starts_at - interval '48 hours'/);
  assert.match(sql, /s\.enabled and s\.reminder_48h_enabled and s\.template_id is not null/);
  // el aviso de 24 h ya no se confunde con el de 48 h al decidir si falta uno
  assert.match(sql, /r\.reminder_type in \('24h', '2h', 'custom'\) and r\.status in/);
  assert.match(sql, /grant execute on function public\.smyl_claim_appointment_reminders\(uuid, integer\) to service_role/);
});

test('función: el aviso de 48 h solo sale con el interruptor y se cancela al apagar', () => {
  const fn = read('supabase/functions/appointment-reminders/index.ts');
  assert.match(fn, /REMINDER_TYPES = \["24h", "2h", "48h", "custom"\]/);
  assert.match(fn, /is48h && settings\.reminder_48h_enabled !== true/);
  assert.match(fn, /reminder_48h_enabled: body\.reminder_48h === true/);
});

test('pantalla: interruptor «48 h antes» que viaja al guardar', () => {
  const ui = read('smyl-reminders.js');
  assert.match(ui, /name="reminder_48h"/);
  assert.match(ui, /reminder_48h: form\.elements\.reminder_48h\.checked/);
  assert.equal(read('mobile/www/smyl-reminders.js'), ui);
  assert.match(read('app.html'), /smyl-reminders\.js\?v=6/);
});
