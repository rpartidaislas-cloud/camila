-- SMYL · Catálogo dental clínico-fiscal v1 (aditivo).
-- Las claves SAT son configurables; la clínica/emisor conserva la responsabilidad de validarlas.
begin;

alter table public.smyl_services
  add column template_key text,
  add column patient_name text,
  add column description text not null default '',
  add column specialty text not null default 'general',
  add column scope_type text not null default 'session',
  add column pricing_mode text not null default 'fixed',
  add column currency text not null default 'MXN',
  add column sat_product_service_code text,
  add column sat_unit_code text,
  add column tax_object_code text,
  add column fiscal_status text not null default 'pending',
  add column fiscal_reviewed_by uuid references auth.users(id) on delete set null,
  add column fiscal_reviewed_at timestamptz,
  add column featured boolean not null default false,
  add column catalog_revision integer not null default 1;

alter table public.smyl_services
  add constraint smyl_services_template_key_format check (template_key is null or template_key ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  add constraint smyl_services_patient_name_length check (patient_name is null or char_length(btrim(patient_name)) between 2 and 120),
  add constraint smyl_services_description_length check (char_length(description) <= 2000),
  add constraint smyl_services_specialty_length check (char_length(specialty) between 2 and 50),
  add constraint smyl_services_scope_type check (scope_type in ('general','session','tooth','teeth','surface','quadrant','arch','phase','package')),
  add constraint smyl_services_pricing_mode check (pricing_mode in ('fixed','per_tooth','per_surface','per_quadrant','per_arch','per_session','per_phase','package','from')),
  add constraint smyl_services_currency check (currency ~ '^[A-Z]{3}$'),
  add constraint smyl_services_sat_product check (sat_product_service_code is null or sat_product_service_code ~ '^\d{8}$'),
  add constraint smyl_services_sat_unit check (sat_unit_code is null or sat_unit_code ~ '^[A-Z0-9]{1,8}$'),
  add constraint smyl_services_tax_object check (tax_object_code is null or tax_object_code ~ '^\d{2}$'),
  add constraint smyl_services_fiscal_status check (fiscal_status in ('pending','reviewed')),
  add constraint smyl_services_fiscal_review check (
    (fiscal_status = 'pending' and fiscal_reviewed_by is null and fiscal_reviewed_at is null)
    or (fiscal_status = 'reviewed' and fiscal_reviewed_by is not null and fiscal_reviewed_at is not null)
  ),
  add constraint smyl_services_catalog_revision check (catalog_revision > 0);

create unique index smyl_services_template_idx on public.smyl_services(tenant_id, template_key) where template_key is not null;

create table public.smyl_service_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  service_id uuid not null,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (tenant_id, service_id, revision),
  foreign key (tenant_id, service_id) references public.smyl_services(tenant_id, id) on delete cascade
);

create or replace function public.smyl_service_catalog_revision()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if row(new.name,new.patient_name,new.description,new.category,new.specialty,new.duration_minutes,
    new.reference_price,new.currency,new.scope_type,new.pricing_mode,new.sat_product_service_code,
    new.sat_unit_code,new.tax_object_code,new.fiscal_status,new.featured,new.active)
    is distinct from
    row(old.name,old.patient_name,old.description,old.category,old.specialty,old.duration_minutes,
    old.reference_price,old.currency,old.scope_type,old.pricing_mode,old.sat_product_service_code,
    old.sat_unit_code,old.tax_object_code,old.fiscal_status,old.featured,old.active) then
    new.catalog_revision := old.catalog_revision + 1;
  end if;
  if new.fiscal_status = 'reviewed' and old.fiscal_status is distinct from 'reviewed' then
    new.fiscal_reviewed_by := auth.uid(); new.fiscal_reviewed_at := clock_timestamp();
  elsif new.fiscal_status = 'pending' then
    new.fiscal_reviewed_by := null; new.fiscal_reviewed_at := null;
  end if;
  return new;
end; $$;

create or replace function public.smyl_capture_service_version()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.smyl_service_versions(tenant_id,service_id,revision,snapshot,changed_by,changed_at)
  values(new.tenant_id,new.id,new.catalog_revision,to_jsonb(new),auth.uid(),coalesce(new.updated_at,clock_timestamp()))
  on conflict (tenant_id,service_id,revision) do nothing;
  return new;
end; $$;

create trigger smyl_services_catalog_revision before update on public.smyl_services
  for each row execute function public.smyl_service_catalog_revision();

insert into public.smyl_service_versions(tenant_id,service_id,revision,snapshot,changed_by,changed_at)
select tenant_id,id,catalog_revision,to_jsonb(s),created_by,created_at from public.smyl_services s;

create trigger smyl_services_capture_version after insert or update on public.smyl_services
  for each row execute function public.smyl_capture_service_version();

alter table public.smyl_service_versions enable row level security;
create policy smyl_service_versions_read on public.smyl_service_versions for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'schedule.read'));
revoke all on table public.smyl_service_versions from anon, authenticated;
grant select on table public.smyl_service_versions to authenticated;

commit;
