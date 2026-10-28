-- Esquema mínimo para ejecutar las migraciones radiográficas v2 en un Postgres real en
-- memoria (PGlite). Replica fielmente los helpers de autorización ya desplegados
-- (smyl_current_tenant, smyl_has_permission, smyl_can_access_patient, smyl_audit_row) y
-- simula auth.uid() con request.jwt.claim.sub. Sólo para pruebas; no es una migración.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, is_anonymous boolean not null default false);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public, auth to authenticated, anon, service_role;

create table public.camila_tenants (id uuid primary key references auth.users(id) on delete cascade, nombre text, activo boolean default true, config jsonb default '{}'::jsonb);
create table public.camila_usuarios (id uuid primary key references auth.users(id) on delete cascade, tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  rol text not null default 'staff' check (rol in ('dueño','staff')), nombre text, email text, activo boolean not null default true, unique (tenant_id, id));
create table public.camila_pacientes (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade, nombre text, unique (tenant_id, id));
create table public.smyl_branches (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade, name text, unique (tenant_id, id));
create table public.smyl_roles (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade, code text not null, name text not null, active boolean not null default true, unique (tenant_id, code), unique (tenant_id, id));
create table public.smyl_role_permissions (tenant_id uuid not null, role_id uuid not null, permission_key text not null, primary key (tenant_id, role_id, permission_key), foreign key (tenant_id, role_id) references public.smyl_roles(tenant_id, id) on delete cascade);
create table public.smyl_member_roles (tenant_id uuid not null, user_id uuid not null, role_id uuid not null, primary key (tenant_id, user_id), foreign key (tenant_id, role_id) references public.smyl_roles(tenant_id, id) on delete cascade);
create table public.smyl_member_branches (tenant_id uuid not null, user_id uuid not null, branch_id uuid not null, is_primary boolean default false, primary key (tenant_id, user_id, branch_id));
create table public.smyl_professionals (id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.camila_tenants(id) on delete cascade, user_id uuid, display_name text not null, active boolean not null default true, unique (tenant_id, id));
create table public.smyl_role_scopes (tenant_id uuid not null, role_id uuid not null, domain text not null, scope text not null, primary key (tenant_id, role_id, domain));
create table public.smyl_patient_care_team (tenant_id uuid not null, patient_id uuid not null, professional_id uuid not null, active boolean not null default true, starts_at timestamptz not null default now(), ends_at timestamptz, primary key (tenant_id, patient_id, professional_id));
create table public.smyl_appointments (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, patient_id uuid, branch_id uuid, professional_id uuid);
create table public.smyl_audit_events (id bigint generated always as identity primary key, tenant_id uuid not null, actor_id uuid, action text not null, entity_type text not null, entity_id text not null default '', before_data jsonb, after_data jsonb, request_id uuid not null default gen_random_uuid(), created_at timestamptz not null default now());
create table public.smyl_dental_records (patient_id uuid primary key, tenant_id uuid not null, revision integer not null, document jsonb not null, updated_at timestamptz not null default now(), updated_by uuid);
alter table public.camila_tenants enable row level security;
alter table public.camila_usuarios enable row level security;
alter table public.camila_pacientes enable row level security;
alter table public.smyl_dental_records enable row level security;
alter table public.smyl_audit_events enable row level security;
alter table public.smyl_professionals enable row level security;
grant select on public.camila_pacientes to authenticated;
create policy pacientes_read on public.camila_pacientes for select to authenticated using (tenant_id = auth.uid());

create or replace function public.smyl_current_tenant() returns uuid language sql security definer stable set search_path = pg_catalog, public as $$
  select coalesce(
    (select cu.tenant_id from public.camila_usuarios cu where cu.id = auth.uid() and cu.activo limit 1),
    (select ct.id from public.camila_tenants ct where ct.id = auth.uid() and ct.activo limit 1));
$$;
create or replace function public.smyl_has_permission(p_tenant_id uuid, p_permission text) returns boolean language sql security definer stable set search_path = pg_catalog, public as $$
  select exists (select 1 from public.camila_tenants ct where ct.id = p_tenant_id and ct.id = auth.uid() and ct.activo)
    or exists (select 1 from public.camila_usuarios cu
      join public.smyl_member_roles mr on mr.tenant_id = cu.tenant_id and mr.user_id = cu.id
      join public.smyl_roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id and r.active
      join public.smyl_role_permissions rp on rp.tenant_id = r.tenant_id and rp.role_id = r.id
      where cu.id = auth.uid() and cu.tenant_id = p_tenant_id and cu.activo and rp.permission_key = p_permission);
$$;
create or replace function public.smyl_scope_rank(p_scope text) returns integer language sql immutable set search_path = pg_catalog as $$
  select case p_scope when 'clinic' then 4 when 'branches' then 3 when 'care_team' then 2 else 1 end $$;
create or replace function public.smyl_current_professional_id(p_tenant uuid) returns uuid language sql stable security definer set search_path = pg_catalog, public as $$
  select p.id from public.smyl_professionals p where p.tenant_id = p_tenant and p.user_id = auth.uid() and p.active limit 1 $$;
create or replace function public.smyl_effective_scope(p_tenant uuid, p_domain text) returns text language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_scope text;
begin
  if exists (select 1 from public.camila_usuarios u where u.id = auth.uid() and u.tenant_id = p_tenant and u.activo and u.rol = 'dueño') then return 'clinic'; end if;
  select rs.scope into v_scope from public.smyl_member_roles mr
  join public.smyl_roles r on r.tenant_id = mr.tenant_id and r.id = mr.role_id and r.active
  left join public.smyl_role_scopes rs on rs.tenant_id = r.tenant_id and rs.role_id = r.id and rs.domain = p_domain
  where mr.tenant_id = p_tenant and mr.user_id = auth.uid()
  order by public.smyl_scope_rank(coalesce(rs.scope, 'own')) desc limit 1;
  return coalesce(v_scope, 'own');
end; $$;
create or replace function public.smyl_can_access_patient(p_tenant uuid, p_patient uuid, p_domain text default 'patients') returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_scope text := public.smyl_effective_scope(p_tenant, p_domain); v_professional uuid := public.smyl_current_professional_id(p_tenant);
begin
  if p_tenant is null or p_patient is null then return false; end if;
  if v_scope = 'clinic' then return true; end if;
  if v_scope = 'branches' then
    return exists (select 1 from public.smyl_appointments a join public.smyl_member_branches mb on mb.tenant_id = a.tenant_id and mb.branch_id = a.branch_id and mb.user_id = auth.uid()
      where a.tenant_id = p_tenant and a.patient_id = p_patient);
  end if;
  if v_professional is null then return false; end if;
  return exists (select 1 from public.smyl_patient_care_team ct where ct.tenant_id = p_tenant and ct.patient_id = p_patient and ct.professional_id = v_professional and ct.active and (ct.ends_at is null or ct.ends_at > now()))
    or exists (select 1 from public.smyl_appointments a where a.tenant_id = p_tenant and a.patient_id = p_patient and a.professional_id = v_professional);
end; $$;
create or replace function public.smyl_audit_row() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_before jsonb; v_after jsonb; v_row jsonb;
begin
  v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row := coalesce(v_after, v_before, '{}'::jsonb);
  insert into public.smyl_audit_events(tenant_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values ((v_row->>'tenant_id')::uuid, auth.uid(), lower(tg_op), tg_table_name,
    coalesce(v_row->>'id', v_row->>'patient_id', v_row->>'user_id', v_row->>'role_id', v_row->>'branch_id', ''), v_before, v_after);
  if tg_op = 'DELETE' then return old; end if; return new;
end; $$;
revoke all on function public.smyl_current_tenant(), public.smyl_has_permission(uuid, text), public.smyl_can_access_patient(uuid, uuid, text) from public, anon;
grant execute on function public.smyl_current_tenant(), public.smyl_has_permission(uuid, text), public.smyl_can_access_patient(uuid, uuid, text), public.smyl_current_professional_id(uuid), public.smyl_effective_scope(uuid, text), public.smyl_scope_rank(text) to authenticated;

-- Stubs mínimos para ejecutar smyl_patient_timeline (Etapa 6) en PGlite: sólo las columnas que la
-- función lee; en producción estas tablas y funciones ya existen con su esquema completo.
create table public.smyl_clinical_notes (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, status text, revision integer default 1, created_at timestamptz default now());
create table public.smyl_patient_files (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, status text, created_at timestamptz default now());
create table public.smyl_dental_versions (tenant_id uuid, patient_id uuid, revision integer, updated_at timestamptz default now());
create table public.smyl_photo_reviews (tenant_id uuid, patient_id uuid, case_id uuid, revision integer, updated_at timestamptz default now());
create table public.smyl_radiograph_reviews (tenant_id uuid, patient_id uuid, study_id uuid, revision integer, updated_at timestamptz default now());
create table public.smyl_clinical_versions (tenant_id uuid, patient_id uuid, status text, revision integer, updated_at timestamptz default now());
create table public.smyl_proposals (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, status text, revision integer, updated_at timestamptz default now());
create table public.smyl_proposal_events (id uuid primary key default gen_random_uuid(), tenant_id uuid, proposal_id uuid, event_type text, proposal_revision integer, channel text, occurred_at timestamptz default now());
create table public.smyl_finance_charges (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, branch_id uuid, status text, voided_at timestamptz, created_at timestamptz default now());
create table public.smyl_finance_payments (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, branch_id uuid, paid_at timestamptz default now());
create table public.smyl_finance_refunds (id uuid primary key default gen_random_uuid(), tenant_id uuid, payment_id uuid, refunded_at timestamptz default now());
create table public.smyl_finance_receipts (id uuid primary key default gen_random_uuid(), tenant_id uuid, payment_id uuid, issued_at timestamptz default now());
create table public.smyl_cfdi_drafts (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, status text, created_at timestamptz default now());
create table public.camila_lana_handoffs (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, lana_channel text, created_at timestamptz default now());
create table public.camila_lana_clinical_links (id uuid primary key default gen_random_uuid(), tenant_id uuid, patient_id uuid, status text, lana_channel text, created_at timestamptz default now());
alter table public.smyl_appointments add column if not exists starts_at timestamptz default now(), add column if not exists status text default 'scheduled';
create or replace function public.smyl_can_access_schedule_row(p_tenant uuid, p_branch uuid, p_professional uuid, p_patient uuid default null) returns boolean language sql stable as $$ select true $$;
create or replace function public.smyl_can_access_finance_patient(p_tenant uuid, p_patient uuid, p_branch uuid) returns boolean language sql stable as $$ select true $$;
