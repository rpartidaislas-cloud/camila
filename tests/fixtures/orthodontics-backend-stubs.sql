-- Dependencias mínimas adicionales para ejecutar la migración ortodóntica
-- sobre tests/fixtures/radiograph-contracts/pglite-base.sql.

drop table if exists public.smyl_clinical_notes cascade;
create table public.smyl_clinical_notes (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  appointment_id uuid,
  professional_id uuid,
  note_type text not null default 'progress',
  status text not null default 'draft',
  revision integer not null default 1,
  document jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  signed_by uuid references auth.users(id),
  signed_at timestamptz,
  void_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id)
);
create table public.smyl_clinical_note_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  note_id uuid not null,
  revision integer not null,
  snapshot jsonb not null,
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, note_id, revision),
  foreign key (tenant_id, note_id) references public.smyl_clinical_notes(tenant_id, id)
);

create table public.smyl_treatments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  seq integer not null,
  title text not null,
  status text not null default 'active',
  opened_at timestamptz not null default now(),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id),
  unique (tenant_id, patient_id, seq)
);

create table public.smyl_informed_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  revoked_at timestamptz,
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id)
);

create table public.smyl_clinical_evidence_studies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  status text not null default 'draft',
  unique (tenant_id, id),
  unique (tenant_id, patient_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id)
);
create table public.smyl_clinical_evidence_context_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  context_type text not null check (context_type in (
    'odontogram','periodontogram','clinical_note','treatment_plan','appointment','diagnosis','comparison'
  )),
  context_id uuid not null,
  relationship text not null default 'supports',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id, study_id)
    references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id)
);
create unique index smyl_clinical_evidence_context_active_unique
  on public.smyl_clinical_evidence_context_links(
    tenant_id, study_id, context_type, context_id, relationship
  ) where revoked_at is null;

create or replace function public.smyl_evidence_log_event(
  p_tenant uuid,
  p_patient uuid,
  p_study uuid,
  p_action text,
  p_entity uuid
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  return;
end;
$$;
