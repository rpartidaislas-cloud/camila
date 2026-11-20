\set ON_ERROR_STOP on
-- Datos: dos clínicas (A y B), un paciente en cada una y tres personas: admin (todo), recepción (solo agenda) y nadie (sin permisos).
insert into public.camila_tenants values ('a0000000-0000-4000-8000-000000000001'), ('b0000000-0000-4000-8000-000000000002');
insert into public.camila_pacientes values
  ('a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'Ana', 'Pérez', '2221112233'),
  ('b0000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000002', 'Beto', 'Ruiz', '2229998877');
insert into public.test_perms values
  ('11111111-1111-4111-8111-111111111111', 'patients.manage'), ('11111111-1111-4111-8111-111111111111', 'patients.read'),
  ('11111111-1111-4111-8111-111111111111', 'schedule.read'), ('11111111-1111-4111-8111-111111111111', 'finance.read'),
  ('22222222-2222-4222-8222-222222222222', 'patients.manage'), ('22222222-2222-4222-8222-222222222222', 'schedule.read'),
  ('44444444-4444-4444-8444-444444444444', 'patients.manage'), ('44444444-4444-4444-8444-444444444444', 'patients.read');
insert into public.smyl_services values ('a0000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'Limpieza');
insert into public.smyl_professionals values ('a0000000-0000-4000-8000-000000000001', 'dd000000-0000-4000-8000-000000000001', 'Dra. Ana');
insert into public.smyl_appointments values ('a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001',
  'cc000000-0000-4000-8000-000000000001', 'dd000000-0000-4000-8000-000000000001', '2026-11-20 16:00+00', '2026-11-20 17:00+00', 'confirmed');
insert into public.smyl_finance_charges values ('a0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'Limpieza', 1, 800, 'open', now());
insert into public.smyl_finance_payments values ('a0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 800, 'cash', now());
insert into public.smyl_patient_fiscal_profiles values ('a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'ANA PEREZ', 'PEPA800101AB1', '612', '72000', 'D01', 'ana@correo.mx');

-- Ayuda: ejecuta algo y devuelve el SQLSTATE del error (o 'ok').
create function public.t_err(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function public.t_as(p_user text, p_tenant text) returns void language plpgsql as $$ begin perform set_config('test.uid', p_user, false); perform set_config('test.tenant', p_tenant, false); end $$;

do $$
declare
  A constant text := 'a0000000-0000-4000-8000-000000000001'; B constant text := 'b0000000-0000-4000-8000-000000000002';
  ADMIN constant text := '11111111-1111-4111-8111-111111111111'; RECEP constant text := '22222222-2222-4222-8222-222222222222';
  NADIE constant text := '33333333-3333-4333-8333-333333333333'; GERENTE constant text := '44444444-4444-4444-8444-444444444444';
  PAC constant uuid := 'aa000000-0000-4000-8000-000000000001'; PACB constant uuid := 'bb000000-0000-4000-8000-000000000002';
  v_id uuid; v_id2 uuid; v_status jsonb; v_req uuid; v_row record; v_export jsonb; v_n integer;
begin
  -- ── días hábiles ──
  assert public.smyl_add_business_days('2026-11-20', 1) = date '2026-11-23', 'viernes + 1 hábil = lunes';
  assert public.smyl_add_business_days('2026-11-20', 5) = date '2026-11-27', 'viernes + 5 hábiles';
  assert public.smyl_add_business_days('2026-11-02', 20) = date '2026-11-30', 'lunes + 20 hábiles = 4 semanas';
  assert public.smyl_add_business_days('2026-11-21', 1) = date '2026-11-23', 'sábado + 1 hábil = lunes';
  assert public.t_err('select public.smyl_add_business_days(date ''2026-11-20'', -1)') = '22023', 'días negativos';
  assert public.t_err('select public.smyl_add_business_days(null, 5)') = '22023', 'fecha nula';

  -- ── elecciones de privacidad ──
  perform public.t_as(NADIE, A);
  assert public.t_err(format('select public.smyl_set_patient_privacy_choice(%L, ''ai_processing'', ''granted'')', PAC)) = '42501', 'sin permiso no registra';
  perform public.t_as(ADMIN, A);
  v_status := public.smyl_patient_privacy_status(PAC);
  assert v_status->'ai_processing'->>'state' = 'unknown', 'sin registrar = unknown';
  v_id := public.smyl_set_patient_privacy_choice(PAC, 'ai_processing', 'granted', 'Lo aceptó en recepción');
  v_id2 := public.smyl_set_patient_privacy_choice(PAC, 'ai_processing', 'granted');
  assert v_id = v_id2, 'repetir el mismo estado no agrega fila';
  assert (select count(*) from public.smyl_patient_privacy_events where patient_id = PAC::uuid) = 1;
  assert public.smyl_patient_privacy_status(PAC)->'ai_processing'->>'state' = 'granted';
  assert public.smyl_patient_privacy_status(PAC)->'whatsapp'->>'state' = 'unknown', 'otras finalidades no cambian';
  perform public.smyl_set_patient_privacy_choice(PAC, 'ai_processing', 'revoked');
  assert public.smyl_patient_privacy_status(PAC)->'ai_processing'->>'state' = 'revoked', 'retirar queda como estado actual';
  assert (select count(*) from public.smyl_patient_privacy_events where patient_id = PAC::uuid) = 2, 'el historial conserva las dos decisiones';
  perform public.smyl_set_patient_privacy_choice(PAC, 'ai_processing', 'granted');
  assert public.smyl_patient_privacy_state(A::uuid, PAC::uuid, 'ai_processing') = 'granted', 'helper para las Edge Functions';
  assert public.smyl_patient_privacy_state(A::uuid, PAC::uuid, 'marketing') = 'unknown';
  assert public.t_err(format('select public.smyl_set_patient_privacy_choice(%L, ''ventas'', ''granted'')', PAC)) = '22023', 'finalidad inválida';
  assert public.t_err(format('select public.smyl_set_patient_privacy_choice(%L, ''whatsapp'', ''quizas'')', PAC)) = '22023', 'acción inválida';
  assert public.t_err(format('update public.smyl_patient_privacy_events set action = ''revoked'' where patient_id = %L', PAC)) = '55000', 'el historial no se edita';
  assert (select count(*) from public.smyl_audit_events where entity_type = 'smyl_patient_privacy_events') = 3, 'cada cambio queda en la auditoría';
  -- aislamiento entre clínicas
  perform public.t_as(ADMIN, B);
  assert public.t_err(format('select public.smyl_set_patient_privacy_choice(%L, ''ai_processing'', ''revoked'')', PAC)) = 'P0002', 'la clínica B no ve pacientes de A';
  assert public.t_err(format('select public.smyl_patient_privacy_status(%L)', PAC)) in ('42501', 'P0002'), 'ni su estado';
  assert public.smyl_patient_privacy_state(B::uuid, PAC::uuid, 'ai_processing') = 'unknown', 'el helper filtra por clínica';

  -- ── solicitudes ARCO ──
  perform public.t_as(ADMIN, A);
  v_req := public.smyl_open_data_request(PAC::uuid, 'opposition', 'in_person', 'Ana Pérez', '2221112233', 'No quiere que use su foto en IA', current_date);
  select * into v_row from public.smyl_data_rights_requests where id = v_req;
  assert v_row.status = 'received' and v_row.due_on = public.smyl_add_business_days(current_date, 20), 'plazo de 20 días hábiles';
  assert public.t_err(format('select public.smyl_open_data_request(%L, ''borrar_todo'', ''phone'', ''Ana Pérez'')', PAC)) = '22023', 'derecho inválido';
  assert public.t_err(format('select public.smyl_open_data_request(%L, ''access'', ''phone'', ''A'')', PAC)) = '22023', 'nombre muy corto';
  assert public.t_err(format('select public.smyl_open_data_request(%L, ''access'', ''phone'', ''Ana Pérez'', '''', '''', current_date + 3)', PAC)) = '22023', 'fecha futura';
  assert public.t_err(format('select public.smyl_open_data_request(%L, ''access'', ''phone'', ''Ana Pérez'', '''', '''', current_date - 200)', PAC)) = '22023', 'fecha muy vieja';
  assert public.t_err(format('select public.smyl_open_data_request(%L, ''access'', ''phone'', ''Ana Pérez'')', PACB)) = 'P0002', 'paciente de otra clínica';
  perform public.t_as(NADIE, A);
  assert public.t_err(format('select public.smyl_update_data_request(%L, ''in_review'')', v_req)) = '42501', 'sin permiso no atiende';
  perform public.t_as(ADMIN, A);
  perform public.smyl_update_data_request(v_req, 'in_review', '', true);
  assert (select status from public.smyl_data_rights_requests where id = v_req) = 'in_review';
  assert (select identity_verified from public.smyl_data_rights_requests where id = v_req) = true;
  assert public.t_err(format('select public.smyl_update_data_request(%L, ''completed'', ''corto'')', v_req)) = '22023', 'cerrar exige resolución';
  assert public.t_err(format('select public.smyl_update_data_request(%L, ''pendiente'')', v_req)) = '22023', 'estado inválido';
  assert public.t_err(format('select public.smyl_update_data_request(%L, ''completed'', ''Se retiró el uso de IA y se avisó a la paciente.'', null, array[''ventas''])', v_req)) = '22023', 'finalidad inválida al cerrar';
  perform public.smyl_update_data_request(v_req, 'completed', 'Se retiró el uso de IA y se avisó a la paciente.', null, array['ai_processing', 'marketing']);
  select * into v_row from public.smyl_data_rights_requests where id = v_req;
  assert v_row.status = 'completed' and v_row.resolved_at is not null and v_row.resolved_by = ADMIN::uuid, 'queda cerrada con fecha y quién la cerró';
  assert public.smyl_patient_privacy_state(A::uuid, PAC::uuid, 'ai_processing') = 'revoked', 'la oposición retiró la IA';
  assert public.smyl_patient_privacy_state(A::uuid, PAC::uuid, 'marketing') = 'revoked', 'y mercadotecnia';
  assert (select source from public.smyl_patient_privacy_events where patient_id = PAC::uuid and purpose = 'marketing') = 'data_request', 'con origen «solicitud»';
  assert public.t_err(format('select public.smyl_update_data_request(%L, ''rejected'', ''Intento de reabrir la solicitud ya cerrada.'')', v_req)) = '55000', 'una solicitud cerrada no se cambia';
  assert public.t_err(format('update public.smyl_data_rights_requests set resolution = ''x'' where id = %L', v_req)) = '55000', 'ni por SQL directo';
  -- retirar finalidades solo en oposición/revocación
  v_req := public.smyl_open_data_request(PAC::uuid, 'access', 'email', 'Ana Pérez');
  assert public.t_err(format('select public.smyl_update_data_request(%L, ''completed'', ''Se entregó una copia de los datos.'', null, array[''whatsapp''])', v_req)) = '22023', 'un acceso no retira finalidades';
  perform public.smyl_update_data_request(v_req, 'rejected', 'No se pudo verificar la identidad de quien solicita.');
  assert (select status from public.smyl_data_rights_requests where id = v_req) = 'rejected';
  -- solicitud sin paciente identificado
  v_req := public.smyl_open_data_request(null, 'revocation', 'whatsapp', 'Alguien sin ficha');
  assert public.t_err(format('select public.smyl_update_data_request(%L, ''completed'', ''Se retiró lo solicitado por la persona.'', null, array[''whatsapp''])', v_req)) = '22023', 'sin paciente no se puede retirar finalidades';

  -- ── exportación ──
  v_export := public.smyl_export_patient_data(PAC::uuid);
  assert v_export->'patient'->>'nombre' = 'Ana' and not (v_export->'patient' ? 'tenant_id'), 'la ficha va sin el identificador interno';
  assert jsonb_array_length(v_export->'appointments') = 1 and v_export->'appointments'->0->>'service' = 'Limpieza';
  assert jsonb_array_length(v_export->'charges') = 1 and jsonb_array_length(v_export->'payments') = 1 and v_export->'fiscal_profile'->>'rfc' = 'PEPA800101AB1';
  assert jsonb_array_length(v_export->'privacy_choices') >= 3, 'incluye el historial de privacidad';
  assert jsonb_array_length(v_export->'data_requests') = 2, 'y las solicitudes del paciente';
  assert (v_export->'included') @> '["ficha","citas","cobros","privacidad"]'::jsonb;
  assert (v_export->'excluded') @> '["Historia clínica y notas"]'::jsonb, 'dice qué NO incluye';
  assert position('signature' in v_export::text) = 0, 'no se filtra ninguna firma';
  perform public.t_as(RECEP, A);
  v_export := public.smyl_export_patient_data(PAC::uuid);
  assert v_export ? 'appointments' and not (v_export ? 'charges') and not (v_export ? 'fiscal_profile'), 'sin finanzas, no se exportan cobros';
  perform public.t_as(NADIE, A);
  assert public.t_err(format('select public.smyl_export_patient_data(%L)', PAC)) = '42501', 'sin permiso no exporta';
  perform public.t_as(ADMIN, B);
  assert public.t_err(format('select public.smyl_export_patient_data(%L)', PAC)) = 'P0002', 'otra clínica no exporta';
  assert (select count(*) from public.smyl_audit_events where entity_type = 'smyl_privacy_export') = 2, 'cada exportación queda auditada';
  raise notice 'ESCENARIOS OK';
end $$;

-- ── permisos de tabla: nadie escribe directo; solo se lee con permiso ──
set session authorization authenticated;
select set_config('test.uid', '33333333-3333-4333-8333-333333333333', false), set_config('test.tenant', 'a0000000-0000-4000-8000-000000000001', false) \gset
do $$ begin
  assert public.t_err('insert into public.smyl_patient_privacy_events (tenant_id, patient_id, purpose, action) values (''a0000000-0000-4000-8000-000000000001'', ''aa000000-0000-4000-8000-000000000001'', ''ai_processing'', ''granted'')') = '42501', 'no se inserta directo';
  assert public.t_err('select * from public.smyl_patient_privacy_events') = '42501', 'el historial no se lee directo';
  assert public.t_err('update public.smyl_data_rights_requests set status = ''completed''') = '42501', 'las solicitudes no se editan directo';
  assert (select count(*) from public.smyl_data_rights_requests) = 0, 'sin permiso la política no deja ver solicitudes';
end $$;
select set_config('test.uid', '11111111-1111-4111-8111-111111111111', false) \gset
do $$ begin
  assert (select count(*) from public.smyl_data_rights_requests) = 3, 'con permiso se ven las solicitudes de su clínica';
end $$;
select set_config('test.tenant', 'b0000000-0000-4000-8000-000000000002', false) \gset
do $$ begin
  assert (select count(*) from public.smyl_data_rights_requests) = 0, 'otra clínica no ve las solicitudes ajenas';
  raise notice 'PERMISOS OK';
end $$;
