-- SMYL · Ejecución clínica por procedimiento aceptado (v1).
--
-- Convierte cada concepto aceptado de una propuesta en una unidad clínica trazable.
-- La aceptación económica no equivale a procedimiento realizado: el estado sólo
-- pasa a completado cuando la nota vinculada se firma profesionalmente.
begin;

create table public.smyl_procedure_executions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete restrict,
  patient_id uuid not null,
  treatment_id uuid not null,
  decision_id uuid not null,
  proposal_id uuid not null references public.smyl_proposals(id) on delete restrict,
  proposal_revision integer not null check (proposal_revision > 0),
  proposal_item_id text not null check (proposal_item_id ~ '^[A-Za-z0-9-]{1,80}$'),
  plan_revision integer not null check (plan_revision > 0),
  plan_item_id text,
  branch_id uuid,
  accepted_quantity numeric(10,3) not null check (accepted_quantity > 0),
  item_snapshot jsonb not null check (jsonb_typeof(item_snapshot) = 'object'),
  status text not null default 'accepted'
    check (status in ('accepted','in_progress','deferred','cancelled','completed')),
  status_reason text not null default '' check (char_length(status_reason) <= 500),
  appointment_id uuid,
  professional_id uuid,
  informed_consent_id uuid references public.smyl_informed_consents(id) on delete restrict,
  clinical_note_id uuid,
  revision integer not null default 1 check (revision > 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, decision_id, proposal_item_id),
  unique (tenant_id, clinical_note_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete restrict,
  foreign key (tenant_id, patient_id, treatment_id) references public.smyl_treatments(tenant_id, patient_id, id) on delete restrict,
  foreign key (tenant_id, decision_id) references public.smyl_proposal_decisions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, branch_id) references public.smyl_branches(tenant_id, id) on delete restrict,
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id) on delete restrict,
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id) on delete restrict,
  foreign key (tenant_id, clinical_note_id) references public.smyl_clinical_notes(tenant_id, id) on delete restrict,
  check ((status = 'completed' and clinical_note_id is not null and completed_at is not null)
      or (status <> 'completed' and completed_at is null)),
  check ((status = 'in_progress' and clinical_note_id is not null and started_at is not null)
      or status <> 'in_progress')
);

create index smyl_procedure_executions_patient_idx
  on public.smyl_procedure_executions(tenant_id, patient_id, treatment_id, status, created_at);

alter table public.smyl_procedure_executions enable row level security;
create policy smyl_procedure_executions_read on public.smyl_procedure_executions
  for select to authenticated
  using (
    public.smyl_has_permission(tenant_id, 'clinical.read')
    and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical')
  );
revoke all on public.smyl_procedure_executions from public, anon, authenticated;
grant select on public.smyl_procedure_executions to authenticated;

create or replace function public.smyl_procedure_execution_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '55000', message = 'El historial del procedimiento no se elimina.';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.patient_id is distinct from old.patient_id
     or new.treatment_id is distinct from old.treatment_id
     or new.decision_id is distinct from old.decision_id
     or new.proposal_id is distinct from old.proposal_id
     or new.proposal_revision is distinct from old.proposal_revision
     or new.proposal_item_id is distinct from old.proposal_item_id
     or new.plan_revision is distinct from old.plan_revision
     or new.plan_item_id is distinct from old.plan_item_id
     or new.branch_id is distinct from old.branch_id
     or new.accepted_quantity is distinct from old.accepted_quantity
     or new.item_snapshot is distinct from old.item_snapshot
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '55000', message = 'El origen aceptado del procedimiento es inmutable.';
  end if;
  if old.status in ('completed','cancelled') and new.status is distinct from old.status then
    raise exception using errcode = '55000', message = 'Un procedimiento cerrado no puede reabrirse.';
  end if;
  if old.status = 'accepted' and new.status not in ('accepted','in_progress','deferred','cancelled')
     or old.status = 'deferred' and new.status not in ('deferred','accepted','cancelled')
     or old.status = 'in_progress' and new.status not in ('in_progress','completed') then
    raise exception using errcode = '23514', message = 'La transición del procedimiento no es válida.';
  end if;
  if new.status = 'completed' and not exists (
    select 1 from public.smyl_clinical_notes n
     where n.tenant_id = new.tenant_id and n.id = new.clinical_note_id
       and n.patient_id = new.patient_id and n.status = 'signed'
  ) then
    raise exception using errcode = '23514', message = 'Firma la nota clínica antes de completar el procedimiento.';
  end if;
  if new.informed_consent_id is not null and not exists (
    select 1 from public.smyl_informed_consents c
     where c.tenant_id = new.tenant_id and c.patient_id = new.patient_id
       and c.id = new.informed_consent_id and c.revoked_at is null
  ) then
    raise exception using errcode = '23514', message = 'El consentimiento no está vigente para este paciente.';
  end if;
  return new;
end;
$$;

create trigger smyl_procedure_execution_guard
  before update or delete on public.smyl_procedure_executions
  for each row execute function public.smyl_procedure_execution_guard();
create trigger smyl_procedure_executions_audit
  after insert or update or delete on public.smyl_procedure_executions
  for each row execute function public.smyl_audit_row();

-- Materializa exclusivamente conceptos que el paciente aceptó en la decisión
-- canónica. Es idempotente y nunca transforma pendientes o rechazados.
create or replace function public.smyl_sync_procedure_executions_v1(
  p_patient_id uuid,
  p_treatment_id uuid
) returns setof public.smyl_procedure_executions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes permiso para preparar procedimientos de este paciente.';
  end if;
  if not exists (
    select 1 from public.smyl_treatments t
     where t.tenant_id = v_tenant and t.patient_id = p_patient_id and t.id = p_treatment_id
  ) then
    raise exception using errcode = 'P0002', message = 'El capítulo de tratamiento no existe.';
  end if;

  insert into public.smyl_procedure_executions (
    tenant_id, patient_id, treatment_id, decision_id, proposal_id, proposal_revision,
    proposal_item_id, plan_revision, plan_item_id, branch_id, accepted_quantity,
    item_snapshot, created_by, updated_by
  )
  select d.tenant_id, d.patient_id, d.treatment_id, d.id, d.proposal_id, d.proposal_revision,
         i.proposal_item_id, p.plan_revision,
         nullif(coalesce(i.item_snapshot->>'plan_item_id', i.item_snapshot->>'treatment_id'), ''),
         p.branch_id, i.accepted_quantity, i.item_snapshot, auth.uid(), auth.uid()
    from public.smyl_proposal_decisions d
    join public.smyl_proposal_decision_items i
      on i.tenant_id = d.tenant_id and i.decision_id = d.id and i.item_status = 'accepted'
    join public.smyl_proposals p
      on p.tenant_id = d.tenant_id and p.id = d.proposal_id and p.revision = d.proposal_revision
   where d.tenant_id = v_tenant and d.patient_id = p_patient_id and d.treatment_id = p_treatment_id
  on conflict (tenant_id, decision_id, proposal_item_id) do nothing;

  return query
  select e.* from public.smyl_procedure_executions e
   where e.tenant_id = v_tenant and e.patient_id = p_patient_id and e.treatment_id = p_treatment_id
   order by case e.status when 'in_progress' then 0 when 'accepted' then 1 when 'deferred' then 2 else 3 end,
            e.created_at, e.proposal_item_id;
end;
$$;

create or replace function public.smyl_list_procedure_executions_v1(
  p_patient_id uuid,
  p_treatment_id uuid
) returns setof public.smyl_procedure_executions
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.read')
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  return query
  select e.* from public.smyl_procedure_executions e
   where e.tenant_id = v_tenant and e.patient_id = p_patient_id and e.treatment_id = p_treatment_id
   order by case e.status when 'in_progress' then 0 when 'accepted' then 1 when 'deferred' then 2 else 3 end,
            e.created_at, e.proposal_item_id;
end;
$$;

-- Crea la nota y enlaza el procedimiento en una sola transacción. El navegador
-- no puede afirmar que existe consentimiento: el id se comprueba en servidor.
create or replace function public.smyl_create_procedure_note_v1(
  p_execution_id uuid,
  p_note_id uuid,
  p_appointment_id uuid,
  p_professional_id uuid,
  p_informed_consent_id uuid,
  p_document jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_execution public.smyl_procedure_executions;
  v_note public.smyl_clinical_notes;
  v_procedure jsonb;
  v_document jsonb;
begin
  if p_execution_id is null or p_note_id is null or p_document is null
     or jsonb_typeof(p_document) <> 'object' then
    raise exception using errcode = '22023', message = 'El registro del procedimiento no es válido.';
  end if;
  select * into v_execution from public.smyl_procedure_executions
   where tenant_id = v_tenant and id = p_execution_id for update;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, v_execution.patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No puedes registrar este procedimiento.';
  end if;
  if v_execution.status in ('completed','cancelled') then
    raise exception using errcode = '55000', message = 'El procedimiento ya está cerrado.';
  end if;
  if v_execution.clinical_note_id is not null then
    select * into v_note from public.smyl_clinical_notes
     where tenant_id = v_tenant and id = v_execution.clinical_note_id;
    return jsonb_build_object(
      'execution', jsonb_strip_nulls(to_jsonb(v_execution) - 'tenant_id'),
      'note', jsonb_strip_nulls(to_jsonb(v_note) - 'tenant_id')
    );
  end if;
  if exists (select 1 from public.smyl_clinical_notes where id = p_note_id) then
    raise exception using errcode = '23505', message = 'El identificador de nota ya está en uso.';
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.smyl_appointments a where a.tenant_id = v_tenant
      and a.id = p_appointment_id and a.patient_id = v_execution.patient_id
  ) then
    raise exception using errcode = '23514', message = 'La cita no pertenece a este paciente.';
  end if;
  if p_professional_id is not null and not exists (
    select 1 from public.smyl_professionals p where p.tenant_id = v_tenant
      and p.id = p_professional_id and p.active
  ) then
    raise exception using errcode = 'P0002', message = 'El profesional no existe o está inactivo.';
  end if;
  if p_informed_consent_id is not null and not exists (
    select 1 from public.smyl_informed_consents c where c.tenant_id = v_tenant
      and c.id = p_informed_consent_id and c.patient_id = v_execution.patient_id and c.revoked_at is null
  ) then
    raise exception using errcode = '23514', message = 'El consentimiento no está vigente para este paciente.';
  end if;

  v_procedure := coalesce(p_document->'procedure', '{}'::jsonb);
  if jsonb_typeof(v_procedure) <> 'object' then
    raise exception using errcode = '22023', message = 'El bloque del procedimiento no es válido.';
  end if;
  if coalesce(v_procedure->>'type', '') = 'surgery' and p_informed_consent_id is null then
    raise exception using errcode = '23514', message = 'Vincula un consentimiento informado vigente antes de registrar una cirugía.';
  end if;
  v_procedure := v_procedure || jsonb_build_object(
    'schema', 3,
    'execution_id', v_execution.id,
    'treatment_id', v_execution.treatment_id,
    'decision_id', v_execution.decision_id,
    'proposal_id', v_execution.proposal_id,
    'proposal_revision', v_execution.proposal_revision,
    'proposal_item_id', v_execution.proposal_item_id,
    'plan_revision', v_execution.plan_revision,
    'plan_item_id', v_execution.plan_item_id,
    'accepted_item', v_execution.item_snapshot,
    'informed_consent_id', p_informed_consent_id
  );
  v_document := jsonb_set(p_document, '{procedure}', v_procedure, true);
  if octet_length(v_document::text) > 65536 then
    raise exception using errcode = '22023', message = 'La nota del procedimiento es demasiado extensa.';
  end if;

  insert into public.smyl_clinical_notes (
    id, tenant_id, patient_id, appointment_id, professional_id, note_type,
    document, created_by, updated_by
  ) values (
    p_note_id, v_tenant, v_execution.patient_id, p_appointment_id,
    p_professional_id, 'procedure', v_document, auth.uid(), auth.uid()
  ) returning * into v_note;
  insert into public.smyl_clinical_note_versions (tenant_id, note_id, revision, snapshot, actor_id)
  values (v_tenant, v_note.id, 1, to_jsonb(v_note) - 'tenant_id', auth.uid());

  update public.smyl_procedure_executions
     set status = 'in_progress', status_reason = '', appointment_id = p_appointment_id,
         professional_id = p_professional_id, informed_consent_id = p_informed_consent_id,
         clinical_note_id = v_note.id, started_at = coalesce(started_at, clock_timestamp()),
         revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp()
   where tenant_id = v_tenant and id = v_execution.id
  returning * into v_execution;
  return jsonb_build_object(
    'execution', jsonb_strip_nulls(to_jsonb(v_execution) - 'tenant_id'),
    'note', jsonb_strip_nulls(to_jsonb(v_note) - 'tenant_id')
  );
end;
$$;

create or replace function public.smyl_set_procedure_execution_status_v1(
  p_execution_id uuid,
  p_expected_revision integer,
  p_status text,
  p_reason text default ''
) returns public.smyl_procedure_executions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_procedure_executions;
begin
  if p_status not in ('accepted','deferred','cancelled')
     or char_length(btrim(coalesce(p_reason, ''))) > 500 then
    raise exception using errcode = '22023', message = 'El estado del procedimiento no es válido.';
  end if;
  select * into v_row from public.smyl_procedure_executions
   where tenant_id = v_tenant and id = p_execution_id for update;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, v_row.patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No puedes actualizar este procedimiento.';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'El procedimiento cambió en otra sesión. Actualiza el expediente.';
  end if;
  if v_row.clinical_note_id is not null then
    raise exception using errcode = '23514', message = 'El procedimiento ya tiene una nota clínica; revísala en el expediente.';
  end if;
  if p_status in ('deferred','cancelled') and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Escribe el motivo clínico u operativo.';
  end if;
  update public.smyl_procedure_executions
     set status = p_status, status_reason = case when p_status = 'accepted' then '' else btrim(p_reason) end,
         revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp()
   where tenant_id = v_tenant and id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

-- La firma profesional es la acción explícita que concluye la ejecución.
create or replace function public.smyl_complete_procedure_on_note_signature()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from 'signed' and new.status = 'signed' then
    update public.smyl_procedure_executions
       set status = 'completed', completed_at = new.signed_at, revision = revision + 1,
           updated_by = coalesce(new.signed_by, auth.uid()), updated_at = clock_timestamp()
     where tenant_id = new.tenant_id and clinical_note_id = new.id and status = 'in_progress';
  end if;
  return new;
end;
$$;
create trigger smyl_complete_procedure_on_note_signature
  after update of status on public.smyl_clinical_notes
  for each row execute function public.smyl_complete_procedure_on_note_signature();

-- Evidencia antes/después sin duplicar el archivo clínico.
alter table public.smyl_clinical_evidence_context_links
  drop constraint if exists smyl_clinical_evidence_context_links_context_type_check;
alter table public.smyl_clinical_evidence_context_links
  add constraint smyl_clinical_evidence_context_links_context_type_check
  check (context_type in (
    'odontogram','periodontogram','clinical_note','treatment_plan','appointment',
    'diagnosis','comparison','orthodontic_case','procedure_execution'
  ));

create or replace function public.smyl_link_procedure_evidence_v1(
  p_execution_id uuid,
  p_study_id uuid,
  p_relationship text default 'supports'
) returns public.smyl_clinical_evidence_context_links
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_execution public.smyl_procedure_executions;
  v_study public.smyl_clinical_evidence_studies;
  v_link public.smyl_clinical_evidence_context_links;
begin
  if p_relationship not in ('supports','derived_from') then
    raise exception using errcode = '22023', message = 'La relación de evidencia no es válida.';
  end if;
  select * into v_execution from public.smyl_procedure_executions
   where tenant_id = v_tenant and id = p_execution_id;
  if not found or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not public.smyl_can_access_patient(v_tenant, v_execution.patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No puedes vincular evidencia a este procedimiento.';
  end if;
  select * into v_study from public.smyl_clinical_evidence_studies
   where tenant_id = v_tenant and id = p_study_id and patient_id = v_execution.patient_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'El estudio no pertenece a este expediente.';
  end if;
  if v_study.status in ('signed','superseded') then
    raise exception using errcode = '23514', message = 'No se cambia el contexto de un estudio final.';
  end if;
  select * into v_link from public.smyl_clinical_evidence_context_links l
   where l.tenant_id = v_tenant and l.study_id = p_study_id
     and l.context_type = 'procedure_execution' and l.context_id = p_execution_id
     and l.relationship = p_relationship and l.revoked_at is null;
  if found then return v_link; end if;
  insert into public.smyl_clinical_evidence_context_links (
    tenant_id, patient_id, study_id, context_type, context_id, relationship, created_by
  ) values (
    v_tenant, v_execution.patient_id, p_study_id, 'procedure_execution',
    p_execution_id, p_relationship, auth.uid()
  ) returning * into v_link;
  perform public.smyl_evidence_log_event(v_tenant, v_execution.patient_id, p_study_id, 'link', v_link.id);
  return v_link;
end;
$$;

revoke all on function public.smyl_sync_procedure_executions_v1(uuid, uuid) from public, anon;
revoke all on function public.smyl_list_procedure_executions_v1(uuid, uuid) from public, anon;
revoke all on function public.smyl_create_procedure_note_v1(uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.smyl_set_procedure_execution_status_v1(uuid, integer, text, text) from public, anon;
revoke all on function public.smyl_link_procedure_evidence_v1(uuid, uuid, text) from public, anon;
grant execute on function public.smyl_sync_procedure_executions_v1(uuid, uuid) to authenticated;
grant execute on function public.smyl_list_procedure_executions_v1(uuid, uuid) to authenticated;
grant execute on function public.smyl_create_procedure_note_v1(uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.smyl_set_procedure_execution_status_v1(uuid, integer, text, text) to authenticated;
grant execute on function public.smyl_link_procedure_evidence_v1(uuid, uuid, text) to authenticated;

commit;
