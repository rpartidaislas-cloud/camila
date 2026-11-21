\set ON_ERROR_STOP on
insert into public.camila_tenants values ('a0000000-0000-4000-8000-000000000001', 'Clínica Sonrisa'), ('b0000000-0000-4000-8000-000000000002', null);
insert into public.camila_pacientes (tenant_id, id, nombre, apellido, telefono, created_at) values
  ('a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Ana', 'Pérez', '222', now()),
  ('a0000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'Beto', 'Ruiz', '223', now() - interval '3 days'),
  ('a0000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'Carla', 'Gómez', '224', now() - interval '30 days'),
  ('a0000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000004', 'Dani', 'Luna', '225', now()),
  ('a0000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000005', 'Eva', 'Mora', '226', now()),
  ('a0000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000006', 'Fer', 'Sol', '227', now()),
  ('b0000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'Otro', 'Tenant', '999', now());
insert into public.camila_lana_handoffs (tenant_id, lana_conversation_id, lana_channel, patient_id) values
  ('a0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'whatsapp', 'a1000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002', 'whatsapp', 'a2000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000003', 'whatsapp', 'a3000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000005', 'whatsapp', 'a5000000-0000-4000-8000-000000000005'),
  ('a0000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000006', 'instagram', 'a6000000-0000-4000-8000-000000000006'),
  ('b0000000-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'whatsapp', 'b1000000-0000-4000-8000-000000000001');
insert into public.test_perms values ('11111111-1111-4111-8111-111111111111', 'patients.manage'), ('44444444-4444-4444-8444-444444444444', 'schedule.read');
create function public.t_err(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function public.t_as(p_user text, p_tenant text) returns void language plpgsql as $$ begin perform set_config('test.uid', p_user, false); perform set_config('test.tenant', p_tenant, false); end $$;

do $$
declare
  A constant uuid := 'a0000000-0000-4000-8000-000000000001'; B constant uuid := 'b0000000-0000-4000-8000-000000000002';
  ADMIN constant text := '11111111-1111-4111-8111-111111111111'; OTRO constant text := '44444444-4444-4444-8444-444444444444';
  ANA constant uuid := 'a1000000-0000-4000-8000-000000000001'; BETO constant uuid := 'a2000000-0000-4000-8000-000000000002';
  DANI constant uuid := 'a4000000-0000-4000-8000-000000000004'; EVA constant uuid := 'a5000000-0000-4000-8000-000000000005';
  r jsonb; n integer; ids uuid[];
begin
  -- ── ajustes: apagado por defecto, solo con patients.manage, auditado ──
  perform public.t_as(OTRO, A::text);
  assert public.t_err('select public.smyl_get_privacy_settings()') = '42501', 'sin permiso no ve los ajustes';
  assert public.t_err('select public.smyl_set_privacy_settings(true)') = '42501', 'sin permiso no los cambia';
  perform public.t_as(ADMIN, A::text);
  assert not (public.smyl_get_privacy_settings() ->> 'auto_send_notice')::boolean, 'apagado por defecto';
  assert public.t_err('select public.smyl_set_privacy_settings(null)') = '22023', 'valor nulo';
  assert (public.smyl_set_privacy_settings(true) ->> 'auto_send_notice')::boolean, 'se enciende';
  assert exists (select 1 from public.smyl_audit_events where entity_type = 'smyl_privacy_settings'), 'queda en la auditoría';
  assert not (public.smyl_set_privacy_settings(false) ->> 'auto_send_notice')::boolean, 'se apaga';

  -- ── a quién se le manda: nuevos, con WhatsApp ligado, sin firma ni envío previo, de su clínica ──
  select array_agg(patient_id order by patient_id) into ids from public.smyl_privacy_dispatch_candidates(A, 10);
  assert ids = array[ANA, BETO, EVA]::uuid[] or ids = array[ANA, BETO, EVA], 'candidatos: Ana, Beto y Eva. Hay ' || coalesce(ids::text, 'ninguno');
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = 'a3000000-0000-4000-8000-000000000003'), 'Carla es de hace 30 días';
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = DANI), 'Dani no tiene WhatsApp ligado';
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = 'a6000000-0000-4000-8000-000000000006'), 'Fer solo tiene Instagram';
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = 'b1000000-0000-4000-8000-000000000001'), 'no mezcla clínicas';
  assert (select count(*) from public.smyl_privacy_dispatch_candidates(A, 1)) = 1, 'respeta el límite';
  assert (select first_name from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = ANA) = 'Ana';
  assert (select conversation_id from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = ANA) = 'c1000000-0000-4000-8000-000000000001';

  -- quien negó WhatsApp no recibe nada
  insert into public.smyl_patient_privacy_events (tenant_id, patient_id, purpose, action) values (A, EVA, 'whatsapp', 'revoked');
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = EVA), 'Eva negó WhatsApp';
  -- quien ya firmó tampoco
  insert into public.smyl_patient_consents (tenant_id, patient_id, notice_version, notice_text, notice_sha256, signer_name, signature_png)
  values (A, BETO, 'v1', repeat('x', 60), repeat('a', 64), 'Beto Ruiz', 'data:image/png;base64,iVBORw0KGgo' || repeat('A', 400));
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = BETO), 'Beto ya firmó';

  -- ── un solo envío por paciente ──
  assert public.smyl_privacy_dispatch_claim(A, ANA), 'la primera reserva gana';
  assert not public.smyl_privacy_dispatch_claim(A, ANA), 'la segunda no';
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = ANA), 'reservado: ya no es candidato';
  perform public.smyl_privacy_dispatch_finish(A, ANA, false);
  assert exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = ANA), 'si falla se libera y se reintenta';
  assert public.smyl_privacy_dispatch_claim(A, ANA), 'se puede reservar otra vez';
  perform public.smyl_privacy_dispatch_finish(A, ANA, true);
  assert (select status from public.smyl_consent_dispatches where patient_id = ANA) = 'sent', 'queda enviado';
  assert not exists (select 1 from public.smyl_privacy_dispatch_candidates(A, 10) where patient_id = ANA), 'enviado: no se repite';
  assert not public.smyl_privacy_dispatch_claim(A, ANA), 'enviado: no se reserva de nuevo';
  assert (public.smyl_get_privacy_settings() ->> 'sent_30d')::integer = 1, 'cuenta el envío';
  -- una reserva caída hace más de 15 minutos se puede retomar
  update public.smyl_consent_dispatches set status = 'sending', sent_at = null, created_at = now() - interval '20 minutes' where patient_id = ANA;
  assert public.smyl_privacy_dispatch_claim(A, ANA), 'reserva caída: se retoma';

  -- ── permisos ──
  assert not has_function_privilege('authenticated', 'public.smyl_privacy_dispatch_claim(uuid,uuid)', 'execute'), 'el personal no reserva envíos';
  assert not has_function_privilege('authenticated', 'public.smyl_privacy_dispatch_candidates(uuid,integer)', 'execute'), 'ni lista candidatos';
  assert not has_function_privilege('anon', 'public.smyl_get_privacy_settings()', 'execute'), 'anon no ve ajustes';
  assert has_function_privilege('service_role', 'public.smyl_privacy_dispatch_finish(uuid,uuid,boolean)', 'execute'), 'la función del servidor sí';
  assert not has_table_privilege('authenticated', 'public.smyl_consent_dispatches', 'select'), 'tabla cerrada';
  assert not has_table_privilege('authenticated', 'public.smyl_privacy_settings', 'select'), 'tabla cerrada';
  raise notice 'ENVIO OK';
end $$;
