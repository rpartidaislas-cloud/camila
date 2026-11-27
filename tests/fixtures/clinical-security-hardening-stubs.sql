-- Esquema mínimo para ejecutar el cierre de seguridad clínica en PostgreSQL real
-- (PGlite). Sólo existe durante las pruebas y no forma parte de producción.
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
end;
$$;

create or replace function auth.uid()
returns uuid
language sql stable
as $$ select nullif(current_setting('test.actor_id', true), '')::uuid $$;

create table public.camila_pacientes (
  id uuid primary key,
  tenant_id uuid not null
);

create table public.smyl_informed_consents (
  id uuid primary key,
  tenant_id uuid not null,
  patient_id uuid not null,
  revoked_at timestamptz,
  revoked_reason text,
  revoked_by uuid
);

create or replace function public.smyl_informed_consents_immutable()
returns trigger
language plpgsql
as $$
begin
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger smyl_informed_consents_immutable
before update or delete on public.smyl_informed_consents
for each row execute function public.smyl_informed_consents_immutable();

create table public.smyl_prescriptions (
  id uuid primary key,
  tenant_id uuid not null,
  patient_id uuid not null,
  idempotency_key uuid not null,
  branch_id uuid,
  appointment_id uuid,
  diagnosis text,
  indications text,
  items jsonb not null default '[]'::jsonb,
  status text not null default 'issued',
  void_reason text,
  unique (tenant_id, idempotency_key)
);
alter table public.smyl_prescriptions enable row level security;

create or replace function public.smyl_current_tenant()
returns uuid
language sql stable
as $$ select nullif(current_setting('test.tenant_id', true), '')::uuid $$;

create or replace function public.smyl_has_permission(p_tenant uuid, p_permission text)
returns boolean
language sql stable
as $$ select p_tenant = public.smyl_current_tenant() and p_permission in ('clinical.read', 'clinical.write') $$;

create or replace function public.smyl_can_access_patient(p_tenant uuid, p_patient uuid, p_domain text default 'clinical')
returns boolean
language sql stable
as $$
  select p_tenant = public.smyl_current_tenant()
     and p_patient = nullif(current_setting('test.allowed_patient', true), '')::uuid
     and p_domain = 'clinical'
$$;

create or replace function public.smyl_recent_auth_method(p_max_age_seconds integer)
returns text
language sql stable
as $$
  select nullif(current_setting('test.recent_auth_method', true), '')
   where p_max_age_seconds > 0
$$;

create or replace function public.smyl_issue_prescription(
  p_id uuid, p_idempotency_key uuid, p_patient_id uuid, p_branch_id uuid, p_appointment_id uuid,
  p_diagnosis text, p_indications text, p_items jsonb, p_declare_not_controlled boolean
) returns public.smyl_prescriptions
language plpgsql
as $$
declare v_row public.smyl_prescriptions;
begin
  insert into public.smyl_prescriptions(
    id, tenant_id, patient_id, idempotency_key, branch_id, appointment_id,
    diagnosis, indications, items
  ) values (
    p_id, public.smyl_current_tenant(), p_patient_id, p_idempotency_key,
    p_branch_id, p_appointment_id, p_diagnosis, p_indications, coalesce(p_items, '[]'::jsonb)
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.smyl_void_prescription(p_id uuid, p_reason text)
returns public.smyl_prescriptions
language plpgsql
as $$
declare v_row public.smyl_prescriptions;
begin
  update public.smyl_prescriptions
     set status = 'void', void_reason = p_reason
   where tenant_id = public.smyl_current_tenant() and id = p_id
   returning * into v_row;
  return v_row;
end;
$$;
