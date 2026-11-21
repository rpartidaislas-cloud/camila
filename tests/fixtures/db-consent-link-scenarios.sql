\set ON_ERROR_STOP on
insert into public.camila_tenants values ('a0000000-0000-4000-8000-000000000001', 'Clínica Sonrisa'), ('b0000000-0000-4000-8000-000000000002', null);
insert into public.camila_pacientes values
  ('a0000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', 'Ana', 'Pérez', '2221112233'),
  ('b0000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000002', 'Beto', 'Ruiz', '2229998877');
insert into public.test_perms values
  ('11111111-1111-4111-8111-111111111111', 'patients.manage'), ('11111111-1111-4111-8111-111111111111', 'patients.read'),
  ('44444444-4444-4444-8444-444444444444', 'schedule.read');
create function public.t_err(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function public.t_as(p_user text, p_tenant text) returns void language plpgsql as $$ begin perform set_config('test.uid', p_user, false); perform set_config('test.tenant', p_tenant, false); end $$;

do $$
declare
  A constant text := 'a0000000-0000-4000-8000-000000000001';
  ADMIN constant text := '11111111-1111-4111-8111-111111111111'; SOLOAGENDA constant text := '44444444-4444-4444-8444-444444444444';
  PAC constant uuid := 'aa000000-0000-4000-8000-000000000001'; PACB constant uuid := 'bb000000-0000-4000-8000-000000000002';
  png constant text := 'data:image/png;base64,iVBORw0KGgo' || repeat('A', 400);
  txt constant text := 'Aviso de privacidad de prueba con texto suficiente para pasar la validacion.';
  t1 text; t2 text; r jsonb; n integer; ev record;
begin
  -- ── crear el enlace: permisos y aislamiento ──
  perform public.t_as(SOLOAGENDA, A);
  assert public.t_err(format('select public.smyl_create_consent_link(%L)', PAC)) = '42501', 'sin patients.manage ni clinical.write no crea enlaces';
  perform public.t_as(ADMIN, A);
  assert public.t_err(format('select public.smyl_create_consent_link(%L)', PACB)) = 'P0002', 'no crea enlace para un paciente de otra clínica';
  t1 := public.smyl_create_consent_link(PAC);
  assert t1 ~ '^[0-9a-f]{64}$', 'token de 64 hex';
  assert not exists (select 1 from public.smyl_consent_links where token_hash = t1), 'el token no se guarda en claro';
  assert (select expires_at - created_at from public.smyl_consent_links limit 1) = interval '48 hours', 'vence a las 48 h';

  -- ── página pública (sin sesión) ──
  perform public.t_as('', '');
  r := public.smyl_consent_link_info(t1);
  assert (r ->> 'available')::boolean and r ->> 'clinic_name' = 'Clínica Sonrisa', 'info del enlace vigente';
  assert not (public.smyl_consent_link_info('xyz') ->> 'available')::boolean, 'token inválido no está disponible';
  assert not (public.smyl_consent_link_info(repeat('0', 64)) ->> 'available')::boolean, 'token desconocido no está disponible';
  assert public.t_err(format('select public.smyl_consent_link_sign(%L,%L,%L,true,%L,%L,%L,true,true,true)', t1, 'v1', txt, 'Ana Pérez', 'patient', 'data:image/png;base64,corta')) = '22023', 'firma inválida';
  assert public.t_err(format('select public.smyl_consent_link_sign(%L,%L,%L,true,%L,%L,%L,true,true,true)', t1, 'v1', 'corto', 'Ana Pérez', 'patient', png)) = '22023', 'texto demasiado corto';
  assert public.t_err(format('select public.smyl_consent_link_sign(%L,%L,%L,true,%L,%L,%L,null,true,true)', t1, 'v1', txt, 'Ana Pérez', 'patient', png)) = '22023', 'las tres decisiones son obligatorias';
  assert public.t_err(format('select public.smyl_consent_link_sign(%L,%L,%L,true,%L,%L,%L,true,true,true)', repeat('1', 64), 'v1', txt, 'Ana Pérez', 'patient', png)) = '22023', 'token desconocido no firma';

  -- ── firmar: IA no, WhatsApp sí, marketing no ──
  r := public.smyl_consent_link_sign(t1, 'v1', txt, true, 'Ana Pérez', 'patient', png, false, true, false);
  assert (r ->> 'ok')::boolean, 'firma ok';
  select count(*) into n from public.smyl_patient_consents where patient_id = PAC and method = 'remote_link';
  assert n = 1, 'quedó la firma remota';
  assert (select tenant_id from public.smyl_patient_consents where patient_id = PAC) = A::uuid, 'en la clínica del enlace';
  assert (select action from public.smyl_patient_privacy_events where patient_id = PAC and purpose = 'ai_processing') = 'revoked', 'IA: negada';
  assert (select action from public.smyl_patient_privacy_events where patient_id = PAC and purpose = 'whatsapp') = 'granted', 'WhatsApp: aceptado';
  assert (select action from public.smyl_patient_privacy_events where patient_id = PAC and purpose = 'marketing') = 'revoked', 'marketing: negado';
  assert (select count(*) from public.smyl_patient_privacy_events where source = 'patient_link') = 3, 'origen patient_link';
  assert exists (select 1 from public.smyl_audit_events where entity_type = 'smyl_patient_consents' and actor_id is null and (after_data ->> 'method') = 'remote_link'), 'auditoría sin actor';
  assert not (public.smyl_consent_link_info(t1) ->> 'available')::boolean, 'el enlace usado ya no está disponible';
  assert public.t_err(format('select public.smyl_consent_link_sign(%L,%L,%L,true,%L,%L,%L,true,true,true)', t1, 'v1', txt, 'Ana Pérez', 'patient', png)) = '22023', 'un enlace sirve una sola vez';
  assert (select count(*) from public.smyl_patient_privacy_events where patient_id = PAC) = 3, 'el reintento no agregó nada';

  -- el personal ve el estado normal (firmado) y el estado de privacidad
  perform public.t_as(ADMIN, A);
  assert (public.smyl_patient_consent_status(PAC) ->> 'signed')::boolean, 'el estado de firma lo ve el personal';
  assert public.smyl_patient_privacy_status(PAC) -> 'ai_processing' ->> 'state' = 'revoked' or public.smyl_patient_privacy_status(PAC)::text like '%revoked%', 'el estado refleja la negativa';

  -- ── vigencia y reemplazo ──
  t1 := public.smyl_create_consent_link(PAC);
  t2 := public.smyl_create_consent_link(PAC);
  perform public.t_as('', '');
  assert not (public.smyl_consent_link_info(t1) ->> 'available')::boolean, 'un enlace nuevo invalida el anterior';
  assert (public.smyl_consent_link_info(t2) ->> 'available')::boolean, 'el nuevo sirve';
  update public.smyl_consent_links set expires_at = now() - interval '1 minute' where token_hash = encode(sha256(convert_to(t2, 'utf8')), 'hex');
  assert not (public.smyl_consent_link_info(t2) ->> 'available')::boolean, 'vencido no está disponible';
  assert public.t_err(format('select public.smyl_consent_link_sign(%L,%L,%L,true,%L,%L,%L,true,true,true)', t2, 'v1', txt || ' ', 'Ana Pérez', 'patient', png)) = '22023', 'vencido no firma';

  -- ── segunda firma con el mismo texto: no duplica la firma pero registra las nuevas decisiones ──
  perform public.t_as(ADMIN, A);
  t1 := public.smyl_create_consent_link(PAC);
  perform public.t_as('', '');
  perform public.smyl_consent_link_sign(t1, 'v1', txt, true, 'Ana Pérez', 'patient', png, true, true, false);
  assert (select count(*) from public.smyl_patient_consents where patient_id = PAC) = 1, 'mismo texto no duplica la firma';
  assert (select action from public.smyl_patient_privacy_events where patient_id = PAC and purpose = 'ai_processing' order by seq desc limit 1) = 'granted', 'IA ahora sí';
  assert (select count(*) from public.smyl_patient_privacy_events where patient_id = PAC and purpose = 'whatsapp') = 1, 'sin cambio no se repite';

  -- ── permisos de ejecución y tablas ──
  assert not has_table_privilege('anon', 'public.smyl_consent_links', 'select'), 'anon no lee los enlaces';
  assert not has_table_privilege('authenticated', 'public.smyl_consent_links', 'select'), 'ni el personal los lee directo';
  assert has_function_privilege('anon', 'public.smyl_consent_link_sign(text,text,text,boolean,text,text,text,boolean,boolean,boolean)', 'execute'), 'anon firma con token';
  assert has_function_privilege('anon', 'public.smyl_consent_link_info(text)', 'execute'), 'anon consulta con token';
  assert not has_function_privilege('anon', 'public.smyl_create_consent_link(uuid)', 'execute'), 'anon no crea enlaces';
  assert has_function_privilege('authenticated', 'public.smyl_create_consent_link(uuid)', 'execute'), 'el personal crea enlaces';
  raise notice 'ENLACES OK';
end $$;
