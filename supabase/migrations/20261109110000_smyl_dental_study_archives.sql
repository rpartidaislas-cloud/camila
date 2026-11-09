-- Retiro reversible de evidencia radiográfica del expediente activo.
-- El archivo original y todas sus revisiones permanecen inmutables y auditables.
begin;

create table public.smyl_dental_study_archives (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  patient_id uuid not null,
  study_id uuid not null,
  status text not null default 'archived' check (status in ('active','archived')),
  reason text not null check (reason in ('duplicate','wrong_patient','poor_quality','upload_error','other')),
  note text not null default '' check (length(note) <= 500),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  restored_at timestamptz,
  restored_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, patient_id, study_id),
  foreign key (tenant_id,patient_id) references public.camila_pacientes(tenant_id,id) on delete cascade
);

create index smyl_dental_study_archives_patient_idx
  on public.smyl_dental_study_archives(tenant_id,patient_id,status,updated_at desc);

alter table public.smyl_dental_study_archives enable row level security;
revoke all on public.smyl_dental_study_archives from public,anon,authenticated;
grant select on public.smyl_dental_study_archives to authenticated;

create policy smyl_dental_study_archives_read on public.smyl_dental_study_archives
for select to authenticated using (
  tenant_id=public.smyl_current_tenant()
  and public.smyl_has_permission(tenant_id,'clinical.read')
  and public.smyl_can_access_patient(tenant_id,patient_id,'clinical')
);

create trigger smyl_dental_study_archives_audit
after insert or update or delete on public.smyl_dental_study_archives
for each row execute function public.smyl_audit_row();

create or replace function public.smyl_archive_dental_study(
  p_patient_id uuid,
  p_study_id uuid,
  p_reason text,
  p_note text default ''
) returns public.smyl_dental_study_archives
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_actor uuid:=auth.uid();
  v_record public.smyl_dental_records;
  v_result public.smyl_dental_study_archives;
begin
  if v_actor is null or v_tenant is null
     or not public.smyl_has_permission(v_tenant,'clinical.write')
     or not public.smyl_can_access_patient(v_tenant,p_patient_id,'clinical')
  then raise exception 'Dental access denied' using errcode='42501'; end if;
  if p_study_id is null or coalesce(p_reason,'') not in ('duplicate','wrong_patient','poor_quality','upload_error','other')
     or coalesce(length(p_note),0)>500
  then raise exception 'Invalid archive request' using errcode='22023'; end if;

  select * into v_record from public.smyl_dental_records
    where tenant_id=v_tenant and patient_id=p_patient_id for share;
  if v_record.patient_id is null or not exists(
    select 1 from jsonb_array_elements(v_record.document->'studies') study
    where study->>'id'=p_study_id::text
  ) then raise exception 'Radiograph unavailable' using errcode='22023'; end if;

  insert into public.smyl_dental_study_archives(
    tenant_id,patient_id,study_id,status,reason,note,archived_at,archived_by,restored_at,restored_by,updated_at
  ) values(
    v_tenant,p_patient_id,p_study_id,'archived',p_reason,coalesce(p_note,''),clock_timestamp(),v_actor,null,null,clock_timestamp()
  )
  on conflict(tenant_id,patient_id,study_id) do update set
    status='archived',reason=excluded.reason,note=excluded.note,
    archived_at=excluded.archived_at,archived_by=excluded.archived_by,
    restored_at=null,restored_by=null,updated_at=excluded.updated_at
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.smyl_restore_dental_study(
  p_patient_id uuid,
  p_study_id uuid
) returns public.smyl_dental_study_archives
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.smyl_current_tenant();
  v_actor uuid:=auth.uid();
  v_result public.smyl_dental_study_archives;
begin
  if v_actor is null or v_tenant is null
     or not public.smyl_has_permission(v_tenant,'clinical.write')
     or not public.smyl_can_access_patient(v_tenant,p_patient_id,'clinical')
  then raise exception 'Dental access denied' using errcode='42501'; end if;

  update public.smyl_dental_study_archives set
    status='active',restored_at=clock_timestamp(),restored_by=v_actor,updated_at=clock_timestamp()
  where tenant_id=v_tenant and patient_id=p_patient_id and study_id=p_study_id and status='archived'
  returning * into v_result;
  if v_result.id is null then raise exception 'Archived radiograph unavailable' using errcode='22023'; end if;
  return v_result;
end;
$$;

revoke all on function public.smyl_archive_dental_study(uuid,uuid,text,text) from public,anon;
revoke all on function public.smyl_restore_dental_study(uuid,uuid) from public,anon;
grant execute on function public.smyl_archive_dental_study(uuid,uuid,text,text) to authenticated;
grant execute on function public.smyl_restore_dental_study(uuid,uuid) to authenticated;

comment on table public.smyl_dental_study_archives is
  'Reversible active-view state for immutable dental radiographs. Originals, versions and clinical reviews are never deleted.';

commit;
