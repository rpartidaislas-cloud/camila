import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('confirmar una solicitud del chat inserta la cita ANTES de enlazarla en la solicitud (llave foránea no diferible)', () => {
  const sql = read('supabase/migrations/20261117120000_smyl_inbox_confirm_request_order.sql');
  const insert = sql.indexOf('insert into public.smyl_appointments(');
  const link = sql.indexOf("update public.smyl_appointment_requests set status='accepted',appointment_id=p_appointment_id");
  assert.ok(insert > 0 && link > 0, 'la función contiene la inserción y la actualización');
  assert.ok(insert < link, 'primero la cita, después la solicitud');
  // mismas protecciones que antes
  assert.match(sql, /schedule\.manage/);
  assert.match(sql, /smyl_validate_service_appointment_slot/);
  assert.match(sql, /grant execute on function public\.smyl_inbox_confirm_appointment_request\(uuid,uuid,uuid,uuid\) to service_role/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated|public)\b/);
});

test('el script de pacientes y citas de prueba pone la junta en un día en que el dentista atiende', () => {
  const sql = read('docs/pruebas/pacientes-y-citas-de-prueba.sql');
  assert.match(sql, /v_dia_junta/);
  assert.match(sql, /in \(2, 4\)/);
});
