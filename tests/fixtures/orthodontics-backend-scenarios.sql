-- Escenario funcional para la migración canónica de ortodoncia.
-- Se ejecuta después de radiograph-contracts/pglite-base.sql,
-- orthodontics-backend-stubs.sql y la migración bajo prueba.

insert into auth.users(id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') on conflict do nothing;
insert into public.camila_tenants(id,nombre) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Clínica A') on conflict do nothing;
insert into public.camila_usuarios(id,tenant_id,rol,nombre,activo) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dueño','Propietaria',true)
  on conflict do nothing;
insert into public.camila_pacientes(id,tenant_id,nombre) values
  ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Paciente')
  on conflict do nothing;
insert into public.smyl_professionals(id,tenant_id,display_name,active) values
  ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Dra. Prueba',true)
  on conflict do nothing;
insert into public.smyl_treatments(id,tenant_id,patient_id,seq,title,status) values
  ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111',1,'Ortodoncia','active')
  on conflict do nothing;
insert into public.smyl_informed_consents(id,tenant_id,patient_id) values
  ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111')
  on conflict do nothing;
insert into public.smyl_clinical_evidence_studies(id,tenant_id,patient_id,status) values
  ('66666666-6666-4666-8666-666666666666','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '11111111-1111-4111-8111-111111111111','draft')
  on conflict do nothing;

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
set role authenticated;

do $$
declare
  v_case jsonb;
  v_again jsonb;
  v_active jsonb;
  v_control jsonb;
  v_retry jsonb;
  v_link jsonb;
  v_link_retry jsonb;
  v_count integer;
begin
  v_case := public.smyl_create_orthodontic_case(
    '22222222-2222-4222-8222-222222222222',
    '{"schema":1,"mechanics":{"applianceType":"aligner","arches":"both"}}'::jsonb
  );
  if v_case->>'phase' <> 'records' or (v_case->>'revision')::integer <> 1 then
    raise exception 'el caso no inició en records/revisión 1: %', v_case;
  end if;
  v_again := public.smyl_create_orthodontic_case(
    '22222222-2222-4222-8222-222222222222',
    '{"schema":1,"mechanics":{"applianceType":"aligner","arches":"both"}}'::jsonb
  );
  if v_again->>'id' <> v_case->>'id' then raise exception 'el alta no fue idempotente'; end if;

  begin
    perform public.smyl_create_orthodontic_control(
      (v_case->>'id')::uuid,'77777777-7777-4777-8777-777777777777',null,
      '33333333-3333-4333-8333-333333333333','adjustment',null,
      '{"subjective":"Sin molestias","objective":"Control","assessment":"Evolución estable","plan":"Continuar","orthodontics":{"schema":1}}'::jsonb
    );
    raise exception 'un ajuste no debe guardarse antes de activar';
  exception when check_violation then
    null;
  end;

  v_active := public.smyl_activate_orthodontic_case(
    (v_case->>'id')::uuid,1,'44444444-4444-4444-8444-444444444444'
  );
  if v_active->>'phase' <> 'active' or (v_active->>'revision')::integer <> 2 then
    raise exception 'la activación no avanzó versión: %', v_active;
  end if;
  if v_active->>'consent_id' <> '44444444-4444-4444-8444-444444444444'
     or v_active#>>'{document,consentId}' <> '44444444-4444-4444-8444-444444444444' then
    raise exception 'la activación no vinculó el consentimiento: %', v_active;
  end if;
  v_control := public.smyl_create_orthodontic_control(
    (v_case->>'id')::uuid,'55555555-5555-4555-8555-555555555555',null,
    '33333333-3333-4333-8333-333333333333','adjustment',null,
    '{"subjective":"Sin molestias","objective":"Control","assessment":"Evolución estable","plan":"Continuar","orthodontics":{"schema":1,"phase":"records"}}'::jsonb
  );
  if v_control#>>'{note,document,orthodontics,phase}' <> 'active'
     or v_control#>>'{note,document,orthodontics,caseId}' <> v_case->>'id' then
    raise exception 'la nota no recibió el contexto canónico: %', v_control;
  end if;
  v_retry := public.smyl_create_orthodontic_control(
    (v_case->>'id')::uuid,'55555555-5555-4555-8555-555555555555',null,
    '33333333-3333-4333-8333-333333333333','adjustment',null,
    '{"subjective":"Sin molestias","objective":"Control","assessment":"Evolución estable","plan":"Continuar","orthodontics":{"schema":1}}'::jsonb
  );
  if v_retry#>>'{control,id}' <> v_control#>>'{control,id}' then
    raise exception 'el reintento duplicó el control';
  end if;
  select count(*) into v_count from public.smyl_list_orthodontic_controls((v_case->>'id')::uuid);
  if v_count <> 1 then raise exception 'se esperó un control, hay %', v_count; end if;

  v_link := public.smyl_link_orthodontic_evidence(
    (v_case->>'id')::uuid,'66666666-6666-4666-8666-666666666666',
    '55555555-5555-4555-8555-555555555555','progress'
  );
  v_link_retry := public.smyl_link_orthodontic_evidence(
    (v_case->>'id')::uuid,'66666666-6666-4666-8666-666666666666',
    '55555555-5555-4555-8555-555555555555','progress'
  );
  if v_link->>'case_link_id' <> v_link_retry->>'case_link_id'
     or v_link->>'clinical_note_link_id' <> v_link_retry->>'clinical_note_link_id' then
    raise exception 'el vínculo de evidencia no fue idempotente';
  end if;

  begin
    perform public.smyl_update_orthodontic_case(
      (v_case->>'id')::uuid,1,
      '{"schema":1,"mechanics":{"applianceType":"fixed","arches":"both"}}'::jsonb
    );
    raise exception 'la revisión obsoleta debió fallar';
  exception when serialization_failure then
    null;
  end;
end;
$$;

reset role;
