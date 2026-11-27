-- SMYL · Protección mínima de conservación del expediente clínico.
-- Impide el borrado físico accidental durante cinco años desde la actividad clínica más reciente.
-- La cancelación de una cuenta debe archivar o seudonimizar, no destruir el expediente vigente.
begin;

create table public.smyl_clinical_retention_guards (
  tenant_id uuid not null,
  patient_id uuid not null,
  last_clinical_activity_at timestamptz not null,
  retain_until timestamptz not null,
  legal_hold_until timestamptz,
  reason text not null default 'minimum_clinical_retention' check (char_length(reason) <= 120),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,patient_id),
  check (retain_until >= last_clinical_activity_at)
);

alter table public.smyl_clinical_retention_guards enable row level security;
revoke all on public.smyl_clinical_retention_guards from public,anon,authenticated;

create or replace function public.smyl_touch_clinical_retention()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_row jsonb:=to_jsonb(new);
  v_tenant uuid;
  v_patient uuid;
  v_activity timestamptz:=clock_timestamp();
begin
  v_tenant:=nullif(v_row->>'tenant_id','')::uuid;
  v_patient:=nullif(v_row->>'patient_id','')::uuid;
  if v_tenant is null or v_patient is null then return new; end if;
  v_activity:=coalesce(
    nullif(v_row->>'signed_at','')::timestamptz,
    nullif(v_row->>'captured_at','')::timestamptz,
    nullif(v_row->>'created_at','')::timestamptz,
    nullif(v_row->>'updated_at','')::timestamptz,
    clock_timestamp()
  );
  insert into public.smyl_clinical_retention_guards(
    tenant_id,patient_id,last_clinical_activity_at,retain_until,updated_at
  ) values (v_tenant,v_patient,v_activity,v_activity+interval '5 years',clock_timestamp())
  on conflict(tenant_id,patient_id) do update set
    last_clinical_activity_at=greatest(public.smyl_clinical_retention_guards.last_clinical_activity_at,excluded.last_clinical_activity_at),
    retain_until=greatest(public.smyl_clinical_retention_guards.retain_until,excluded.retain_until),
    updated_at=clock_timestamp();
  return new;
end;
$$;

create or replace function public.smyl_block_patient_delete_during_retention()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_guard public.smyl_clinical_retention_guards%rowtype;
begin
  select * into v_guard from public.smyl_clinical_retention_guards
   where tenant_id=old.tenant_id and patient_id=old.id;
  if found and (v_guard.retain_until>clock_timestamp() or coalesce(v_guard.legal_hold_until,'-infinity'::timestamptz)>clock_timestamp()) then
    raise exception using errcode='23514',
      message='El expediente clínico sigue dentro de su periodo de conservación. Archiva o seudonimiza al paciente; no borres su historial.',
      detail='retain_until='||v_guard.retain_until::text;
  end if;
  return old;
end;
$$;

drop trigger if exists smyl_patient_minimum_retention on public.camila_pacientes;
create trigger smyl_patient_minimum_retention before delete on public.camila_pacientes
  for each row execute function public.smyl_block_patient_delete_during_retention();

-- Conecta las fuentes clínicas presentes sin reescribir sus flujos de guardado.
do $$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'smyl_patient_histories','smyl_patient_history_versions','smyl_clinical_notes','smyl_patient_files',
    'smyl_dental_records','smyl_dental_versions','smyl_photo_reviews','smyl_radiograph_reviews',
    'smyl_radiograph_sources','smyl_radiograph_reports','smyl_clinical_evidence_studies',
    'smyl_clinical_evidence_assets','smyl_clinical_evidence_findings','smyl_clinical_evidence_decisions',
    'smyl_clinical_evidence_reports','smyl_dental_study_archives','smyl_periodontal_history'
  ] loop
    if to_regclass('public.'||v_table) is not null
       and exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name='patient_id')
       and exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name='tenant_id') then
      v_trigger:='smyl_retention_touch_'||substr(md5(v_table),1,16);
      execute format('drop trigger if exists %I on public.%I',v_trigger,v_table);
      execute format('create trigger %I after insert or update on public.%I for each row execute function public.smyl_touch_clinical_retention()',v_trigger,v_table);
      execute format(
        'insert into public.smyl_clinical_retention_guards(tenant_id,patient_id,last_clinical_activity_at,retain_until,updated_at) '
        'select tenant_id,patient_id,clock_timestamp(),clock_timestamp()+interval ''5 years'',clock_timestamp() from public.%I '
        'where tenant_id is not null and patient_id is not null group by tenant_id,patient_id '
        'on conflict(tenant_id,patient_id) do update set retain_until=greatest(public.smyl_clinical_retention_guards.retain_until,excluded.retain_until),updated_at=clock_timestamp()',
        v_table
      );
    end if;
  end loop;
end $$;

revoke all on function public.smyl_touch_clinical_retention() from public,anon,authenticated;
revoke all on function public.smyl_block_patient_delete_during_retention() from public,anon,authenticated;

comment on table public.smyl_clinical_retention_guards is 'Guardia técnica de conservación mínima; no almacena contenido clínico y no habilita borrados.';
comment on function public.smyl_block_patient_delete_during_retention() is 'Bloquea borrado físico del paciente mientras exista retención clínica o legal vigente.';
commit;
