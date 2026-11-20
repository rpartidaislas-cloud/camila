-- Esquema MÍNIMO para probar las migraciones de privacidad en un PostgreSQL real (sin Supabase). Solo lo que las funciones tocan.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema public, auth to authenticated, anon, service_role;

create table public.camila_tenants (id uuid primary key);
create table public.camila_pacientes (tenant_id uuid not null references public.camila_tenants(id), id uuid not null, nombre text, apellido text, telefono text, primary key (tenant_id, id));
create table public.smyl_audit_events (id bigint generated always as identity primary key, tenant_id uuid, actor_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')), entity_type text not null, entity_id text not null default '',
  before_data jsonb, after_data jsonb, created_at timestamptz not null default now());
create table public.smyl_services (tenant_id uuid, id uuid, name text);
create table public.smyl_professionals (tenant_id uuid, id uuid, display_name text);
create table public.smyl_appointments (tenant_id uuid, id uuid, patient_id uuid, service_id uuid, professional_id uuid, starts_at timestamptz, ends_at timestamptz, status text);
create table public.smyl_finance_charges (tenant_id uuid, id uuid, patient_id uuid, concept text, quantity numeric, total_amount numeric, status text, created_at timestamptz default now());
create table public.smyl_finance_payments (tenant_id uuid, id uuid, patient_id uuid, amount numeric, method text, paid_at timestamptz);
create table public.smyl_patient_fiscal_profiles (tenant_id uuid, patient_id uuid, legal_name text, rfc text, fiscal_regime text, tax_postal_code text, cfdi_use text, email text);

-- Permisos simulados: test.uid (quién llama), test.tenant (su clínica) y la tabla test_perms (qué puede hacer).
create table public.test_perms (user_id uuid, perm text);
create function public.smyl_current_tenant() returns uuid language sql stable security definer as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.smyl_has_permission(p_tenant uuid, p_perm text) returns boolean language sql stable security definer
  as $$ select p_tenant = nullif(current_setting('test.tenant', true), '')::uuid and exists (select 1 from public.test_perms where user_id = auth.uid() and perm = p_perm) $$;
create function public.smyl_can_access_patient(p_tenant uuid, p_patient uuid, p_domain text default null) returns boolean language sql stable security definer
  as $$ select exists (select 1 from public.camila_pacientes where tenant_id = p_tenant and id = p_patient) $$;
