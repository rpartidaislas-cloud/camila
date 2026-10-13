-- Stage 3, PREPARED ONLY: review and test in staging before applying to production.
-- Requires camila_tenants.sql and camila_team.sql. Intentionally fails if an
-- untracked camila_pacientes table already exists: reconcile its schema/RLS first.
-- No imports, account changes, case relinking, LANA delivery or quota changes.
begin;

create table public.camila_pacientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id),
  nombre text not null check (length(trim(nombre)) between 1 and 150),
  apellido text not null default '' check (length(apellido) <= 150),
  email text not null default '' check (length(email) <= 254),
  telefono text not null default '' check (length(telefono) <= 60),
  fecha_nacimiento date,
  genero text check (genero in ('femenino', 'masculino', 'otro')),
  notas text not null default '' check (length(notas) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index camila_pacientes_tenant_idx on public.camila_pacientes(tenant_id, created_at desc);
alter table public.camila_pacientes enable row level security;
revoke all on public.camila_pacientes from anon, authenticated;
grant select, insert, update on public.camila_pacientes to authenticated;
create policy pacientes_read on public.camila_pacientes for select to authenticated
  using (public.camila_es_miembro(tenant_id));
create policy pacientes_create on public.camila_pacientes for insert to authenticated
  with check (public.camila_es_miembro(tenant_id));
create policy pacientes_edit on public.camila_pacientes for update to authenticated
  using (public.camila_es_miembro(tenant_id)) with check (public.camila_es_miembro(tenant_id));

create function public.smyl_patient_identity_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'Patient identity cannot be reassigned' using errcode = '42501';
  end if;
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger smyl_patient_identity_guard before update on public.camila_pacientes
  for each row execute function public.smyl_patient_identity_guard();

-- A current plan per patient, separate from image simulation and its AI output.
-- Until explicit professional roles exist, ONLY the clinic owner can read/write
-- clinical content. Generic staff must never be treated as a dentist automatically.
create table public.smyl_clinical_plans (
  patient_id uuid primary key,
  tenant_id uuid not null,
  document jsonb not null,
  revision integer not null check (revision > 0),
  status text not null check (status in ('draft', 'reviewed')),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id),
  check ((status = 'reviewed' and reviewed_by is not null and reviewed_at is not null)
    or (status = 'draft' and reviewed_by is null and reviewed_at is null))
);
create table public.smyl_clinical_versions (
  patient_id uuid not null,
  tenant_id uuid not null,
  revision integer not null,
  document jsonb not null,
  status text not null check (status in ('draft', 'reviewed')),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  primary key (patient_id, revision),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id)
);
alter table public.smyl_clinical_plans enable row level security;
alter table public.smyl_clinical_versions enable row level security;
revoke all on public.smyl_clinical_plans, public.smyl_clinical_versions from anon, authenticated;
grant select on public.smyl_clinical_plans, public.smyl_clinical_versions to authenticated;
create policy clinical_read_owner on public.smyl_clinical_plans for select to authenticated
  using (tenant_id = (select auth.uid()));
create policy clinical_versions_read_owner on public.smyl_clinical_versions for select to authenticated
  using (tenant_id = (select auth.uid()));

-- Single atomic entry point. Caller cannot set authors, versions or dates, bypass
-- clinical review checks, erase history, or overwrite a concurrent revision.
create function public.smyl_save_clinical_plan(
  p_tenant_id uuid, p_patient_id uuid, p_expected_revision integer,
  p_document jsonb, p_review boolean default false
) returns public.smyl_clinical_plans
language plpgsql security definer set search_path = '' as $$
declare
  result public.smyl_clinical_plans;
  item jsonb;
  stamp timestamptz := clock_timestamp();
begin
  if auth.uid() is null or p_tenant_id is distinct from auth.uid() then
    raise exception 'Clinical access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.camila_pacientes where id = p_patient_id and tenant_id = p_tenant_id) then
    raise exception 'Patient not available' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_review is null
    or p_document is null or jsonb_typeof(p_document) <> 'object'
    or octet_length(p_document::text) > 100000
    or (p_document->'schema') is distinct from '1'::jsonb
    or jsonb_typeof(p_document->'reason') is distinct from 'string'
    or jsonb_typeof(p_document->'background') is distinct from 'string'
    or jsonb_typeof(p_document->'assessment') is distinct from 'string'
    or jsonb_typeof(p_document->'treatments') is distinct from 'array' then
    raise exception 'Invalid clinical document' using errcode = '22023';
  end if;
  if length(p_document->>'reason') > 2000 or length(p_document->>'background') > 8000
    or length(p_document->>'assessment') > 8000 or jsonb_array_length(p_document->'treatments') > 20
    or p_document - array['schema','reason','background','assessment','treatments'] <> '{}'::jsonb then
    raise exception 'Invalid clinical document' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(p_document->'treatments') loop
    if jsonb_typeof(item) <> 'object'
      or jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'area') is distinct from 'string'
      or jsonb_typeof(item->'notes') is distinct from 'string'
      or length(item->>'name') > 200 or length(item->>'area') > 200 or length(item->>'notes') > 2000
      or item - array['name','area','notes'] <> '{}'::jsonb
      or (p_review and length(trim(item->>'name')) = 0) then
      raise exception 'Invalid treatment' using errcode = '22023';
    end if;
  end loop;
  if p_review and (length(trim(p_document->>'assessment')) = 0 or jsonb_array_length(p_document->'treatments') = 0) then
    raise exception 'Review requires assessment and plan' using errcode = '22023';
  end if;
  -- Also serializes two simultaneous first saves where there is no row to lock yet.
  perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text, 0));
  select * into result from public.smyl_clinical_plans where patient_id = p_patient_id for update;
  if coalesce(result.revision, 0) <> p_expected_revision then
    raise exception 'Clinical revision conflict' using errcode = '40001';
  end if;
  insert into public.smyl_clinical_plans
    (patient_id, tenant_id, document, revision, status, updated_by, updated_at, reviewed_by, reviewed_at)
  values (p_patient_id, p_tenant_id, p_document, p_expected_revision + 1,
    case when p_review then 'reviewed' else 'draft' end, auth.uid(), stamp,
    case when p_review then auth.uid() end, case when p_review then stamp end)
  on conflict (patient_id) do update set
    document = excluded.document, revision = excluded.revision, status = excluded.status,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at,
    reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at
  returning * into result;
  insert into public.smyl_clinical_versions
    (patient_id, tenant_id, document, revision, status, updated_by, updated_at, reviewed_by, reviewed_at)
  values (result.patient_id, result.tenant_id, result.document, result.revision, result.status,
    result.updated_by, result.updated_at, result.reviewed_by, result.reviewed_at);
  return result;
end;
$$;
revoke all on function public.smyl_save_clinical_plan(uuid, uuid, integer, jsonb, boolean) from public, anon;
grant execute on function public.smyl_save_clinical_plan(uuid, uuid, integer, jsonb, boolean) to authenticated;
comment on table public.camila_pacientes is 'SMYL contact registry. No automatic name/phone matching to LANA. Clinical notes belong in smyl_clinical_plans.';
comment on table public.smyl_clinical_versions is 'Immutable to clients. New edits create a draft; previous reviews remain in history, not approval of the new content.';
commit;
