import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261022120000_smyl_appointment_extra_time.sql');

test('migración de tiempo extra limita 0-240 min en bloques de 15 y lo valida en servidor', () => {
  assert.match(sql, /extra_minutes between 0 and 240 and extra_minutes%15=0/);
  assert.match(sql, /p_extra_minutes integer default 0\n\) returns void/);
  assert.match(sql, /v_duration\+coalesce\(p_extra_minutes,0\)/);
  assert.match(sql, /'extra_time_changed'/);
});

test('crear, reprogramar y ampliar usan el mismo validador con el tiempo extra', () => {
  assert.match(sql, /smyl_create_appointment[\s\S]*smyl_validate_service_appointment_slot\([^)]*v_extra\)/);
  assert.match(sql, /smyl_reschedule_appointment[\s\S]*v_row\.extra_minutes\)/);
  assert.match(sql, /smyl_set_appointment_extra[\s\S]*smyl_validate_service_appointment_slot/);
  assert.match(sql, /revoke all on function public\.smyl_validate_service_appointment_slot[\s\S]*from public,anon,authenticated/);
});

test('la agenda envía p_extra_minutes sólo cuando hay tiempo extra', () => {
  for (const f of ['smyl-schedule.js', 'mobile/www/smyl-schedule.js']) {
    const js = read(f);
    assert.match(js, /name="extra"/);
    assert.match(js, /p_extra_minutes:Number\(f\.get\('extra'\)\|\|0\)\|\|undefined/);
  }
});

test('la ficha de la cita ofrece +15/+30/+60 y usa smyl_set_appointment_extra', () => {
  for (const f of ['smyl-schedule.js', 'mobile/www/smyl-schedule.js']) {
    const js = read(f);
    assert.match(js, /\[15,30,60\]/);
    assert.match(js, /rpc\('smyl_set_appointment_extra'/);
  }
});
