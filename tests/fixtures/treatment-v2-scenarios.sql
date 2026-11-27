insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') on conflict do nothing;
insert into public.camila_tenants(id,nombre) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Clínica A') on conflict do nothing;
insert into public.camila_usuarios(id,tenant_id,rol,nombre,activo) values(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dueño','Propietaria',true) on conflict do nothing;
insert into public.camila_pacientes(id,tenant_id,nombre) values(
  '11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Paciente') on conflict do nothing;
insert into public.smyl_branches(id,tenant_id,name,active) values(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Centro',true) on conflict do nothing;
insert into public.smyl_branches(id,tenant_id,name,active) values(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Norte',true) on conflict do nothing;
insert into public.smyl_treatments(id,tenant_id,patient_id,seq,title,reason,status,opened_by) values(
  '22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',1,'Tratamiento inicial','Motivo','active','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.smyl_clinical_plans(patient_id,tenant_id,document,revision,status,updated_by,updated_at,reviewed_by,reviewed_at,treatment_id)
values('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '{"schema":2,"reason":"Motivo","background":"","assessment":"Revisado","treatments":[{"id":"plan-a","name":"A","area":"","notes":"","phase":"treat","service_id":null,"service_revision":null,"service_snapshot":null,"teeth":[],"surfaces":[]},{"id":"plan-b","name":"B","area":"","notes":"","phase":"maintain","service_id":null,"service_revision":null,"service_snapshot":null,"teeth":[],"surfaces":[]}]}'::jsonb,
  7,'reviewed','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),'22222222-2222-4222-8222-222222222222');
insert into public.smyl_clinical_versions(patient_id,tenant_id,document,revision,status,updated_by,updated_at,reviewed_by,reviewed_at,treatment_id)
select patient_id,tenant_id,document,revision,status,updated_by,updated_at,reviewed_by,reviewed_at,treatment_id
from public.smyl_clinical_plans where patient_id='11111111-1111-4111-8111-111111111111';
insert into public.smyl_proposals(id,tenant_id,patient_id,plan_revision,revision,status,document,total_cents,patient_name,clinic_name,
  professional_name,updated_by,updated_at,approved_by,approved_at,branch_id,treatment_id)
values('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',7,2,'approved',
  '{"schema":2,"title":"Plan","introduction":"","terms":"Pago","valid_until":"2099-12-31","photos":null,"items":[{"id":"quote-a","treatment_id":"plan-a","service_id":null,"service_revision":null,"service_snapshot":null,"teeth":[],"surfaces":[],"label":"A","area":"","quantity":1,"unit_cents":10000,"currency":"MXN"},{"id":"quote-b","treatment_id":"plan-b","service_id":null,"service_revision":null,"service_snapshot":null,"teeth":[],"surfaces":[],"label":"B","area":"","quantity":1,"unit_cents":20000,"currency":"MXN"},{"id":"quote-c","treatment_id":null,"service_id":null,"service_revision":null,"service_snapshot":null,"teeth":[],"surfaces":[],"label":"C","area":"","quantity":1,"unit_cents":30000,"currency":"MXN"}]}'::jsonb,
  60000,'Paciente','Clínica','Doctora','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now(),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
insert into public.smyl_proposal_versions(proposal_id,revision,tenant_id,snapshot,treatment_id)
select id,revision,tenant_id,to_jsonb(p),treatment_id from public.smyl_proposals p
where id='33333333-3333-4333-8333-333333333333';
insert into public.smyl_proposal_events(id,tenant_id,proposal_id,proposal_revision,event_type,channel,note,occurred_at,created_by)
values('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333',2,'presented','in_person','',now()-interval '1 minute','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

do $$ begin
  if (select treatment_id from public.smyl_proposal_versions
      where proposal_id='c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3' and revision=1)
       is distinct from 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'::uuid
     or (select treatment_id from public.smyl_proposal_versions
      where proposal_id='c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3' and revision=2)
       is distinct from 'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2'::uuid then
    raise exception 'el backfill A→B mezcló los capítulos de las versiones históricas';
  end if;
end $$;

-- Una propuesta vencida conserva estructura válida, pero nunca admite decisión ni cargos nuevos.
insert into public.smyl_proposals(id,tenant_id,patient_id,plan_revision,revision,status,document,total_cents,patient_name,clinic_name,
  professional_name,updated_by,updated_at,approved_by,approved_at,branch_id)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',tenant_id,patient_id,plan_revision,1,'approved',
  jsonb_set(document,'{valid_until}',to_jsonb('2000-01-01'::text)),total_cents,patient_name,clinic_name,professional_name,
  updated_by,updated_at,approved_by,approved_at,branch_id
from public.smyl_proposals where id='33333333-3333-4333-8333-333333333333';
insert into public.smyl_proposal_versions(proposal_id,revision,tenant_id,snapshot)
select id,revision,tenant_id,to_jsonb(p) from public.smyl_proposals p where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
insert into public.smyl_proposal_events(id,tenant_id,proposal_id,proposal_revision,event_type,channel,note,occurred_at,created_by)
values('dddddddd-1111-4111-8111-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',1,'presented','in_person','',now()-interval '1 minute','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- Cargo de simulación de otra sucursal para comprobar que el crédito no cruza sedes.
insert into public.smyl_finance_charges(id,tenant_id,patient_id,branch_id,idempotency_key,concept,quantity,unit_price,
  discount_amount,tax_amount,total_amount,status,created_by,simulation_case_id)
values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
  'Simulación',1,50,0,0,50,'open','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-2222-4222-8222-eeeeeeeeeeee');

select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
set role authenticated;
do $$ declare d public.smyl_proposal_decisions;b public.smyl_proposal_charge_batches;r jsonb;n integer;legacy public.smyl_proposals;
begin
  legacy:=public.smyl_save_proposal_v3('abababab-abab-4bab-8bab-abababababab','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',7,0,
    (select document from public.smyl_proposals where id='33333333-3333-4333-8333-333333333333'),false,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  if legacy.treatment_id is distinct from '22222222-2222-4222-8222-222222222222'::uuid
     or (select treatment_id from public.smyl_proposal_versions where proposal_id=legacy.id and revision=legacy.revision)
        is distinct from '22222222-2222-4222-8222-222222222222'::uuid then
    raise exception 'el RPC legacy dejó la propuesta sin capítulo';
  end if;
  begin
    perform public.smyl_record_proposal_decision_v1('dddddddd-2222-4222-8222-dddddddddddd',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',1,array['quote-a'],array['quote-c'],array['quote-b'],
      'in_person','No debe guardarse',now());
    raise exception 'debió rechazar la propuesta vencida';
  exception when serialization_failure then null;end;
  d:=public.smyl_record_proposal_decision_v1('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333',2,
    array['quote-a'],array['quote-c'],array['quote-b'],'in_person','Acepta A; B pendiente',now());
  if d.decision_type<>'accepted_partial' or d.accepted_cents<>10000 or d.pending_cents<>20000 or d.declined_cents<>30000 then
    raise exception 'decisión parcial incorrecta: %',to_jsonb(d);end if;
  perform public.smyl_record_proposal_decision_v1('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333',2,
    array['quote-a'],array['quote-c'],array['quote-b'],'in_person','Acepta A; B pendiente',d.occurred_at);
  begin
    perform public.smyl_post_proposal_decision_charges_v1('66666666-1111-4111-8111-666666666666',
      '77777777-1111-4111-8111-777777777777',d.id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc',current_date+1);
    raise exception 'debió rechazar una sucursal distinta a la propuesta';
  exception when serialization_failure then null;end;
  begin
    perform public.smyl_post_proposal_decision_charges_v1('66666666-2222-4222-8222-666666666666',
      '77777777-2222-4222-8222-777777777777',d.id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',current_date+1,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    raise exception 'debió rechazar el crédito de simulación de otra sucursal';
  exception when check_violation then null;end;
  b:=public.smyl_post_proposal_decision_charges_v1('66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777',d.id,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',current_date+1);
  if b.charge_count<>1 or b.total_amount<>100 then raise exception 'cargos selectivos incorrectos: %',to_jsonb(b);end if;
  select count(*) into n from public.smyl_finance_charges where proposal_batch_id=b.id and proposal_item_id='quote-a';
  if n<>1 or exists(select 1 from public.smyl_finance_charges where proposal_batch_id=b.id and proposal_item_id in ('quote-b','quote-c')) then
    raise exception 'se cobraron conceptos no aceptados';end if;
  begin
    perform public.smyl_transition_treatment_v1('22222222-2222-4222-8222-222222222222',1,7,'closed','',
      '88888888-8888-4888-8888-888888888888','Nuevo capítulo','Nuevo',array['desconocido'],'99999999-9999-4999-8999-999999999999');
    raise exception 'debió rechazar carry desconocido';
  exception when invalid_parameter_value then null;end;
  if not exists(select 1 from public.smyl_treatments where id='22222222-2222-4222-8222-222222222222' and status='active') then
    raise exception 'la transición inválida no revirtió el cierre';end if;
  r:=public.smyl_transition_treatment_v1('22222222-2222-4222-8222-222222222222',1,7,'closed','',
    '88888888-8888-4888-8888-888888888888','Nuevo capítulo','Nuevo',array['plan-a'],'aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa');
  if (r->>'carried_count')::int<>1 or r->>'plan_revision'<>'8' then raise exception 'transición incorrecta: %',r;end if;
  if (select document#>>'{treatments,0,id}' from public.smyl_clinical_plans where patient_id='11111111-1111-4111-8111-111111111111')='plan-a' then
    raise exception 'carry no recibió id nuevo';end if;
  if (select count(*) from public.smyl_treatments where patient_id='11111111-1111-4111-8111-111111111111' and status='active')<>1 then
    raise exception 'debe existir un solo capítulo activo';end if;
end $$;
reset role;
