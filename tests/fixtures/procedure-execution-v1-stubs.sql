-- Esquema mínimo adicional para ejecutar 20261128150000 en PGlite.
alter table public.smyl_appointments add constraint smyl_appointments_tenant_id_uq unique(tenant_id,id);

alter table public.smyl_clinical_notes
  add column appointment_id uuid,
  add column professional_id uuid,
  add column note_type text not null default 'progress',
  add column document jsonb not null default '{}'::jsonb,
  add column created_by uuid references auth.users(id),
  add column updated_by uuid references auth.users(id),
  add column signed_by uuid references auth.users(id),
  add column signed_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint smyl_clinical_notes_tenant_id_uq unique(tenant_id,id);

create table public.smyl_clinical_note_versions(
  tenant_id uuid not null,note_id uuid not null,revision integer not null,snapshot jsonb not null,
  actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
  primary key(tenant_id,note_id,revision)
);
create table public.smyl_informed_consents(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,patient_id uuid not null,
  procedure_title text not null,revoked_at timestamptz,
  foreign key(tenant_id,patient_id) references public.camila_pacientes(tenant_id,id)
);
create table public.smyl_clinical_evidence_studies(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,patient_id uuid not null,
  status text not null default 'draft',unique(tenant_id,patient_id,id)
);
create table public.smyl_clinical_evidence_context_links(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null,patient_id uuid not null,study_id uuid not null,
  context_type text not null constraint smyl_clinical_evidence_context_links_context_type_check
    check(context_type in('clinical_note')),
  context_id uuid not null,relationship text not null default 'supports',created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),revoked_at timestamptz,revoked_by uuid,clinical_role text
);
create unique index smyl_clinical_evidence_context_active_unique
  on public.smyl_clinical_evidence_context_links(tenant_id,study_id,context_type,context_id,relationship)
  where revoked_at is null;
create or replace function public.smyl_evidence_log_event(uuid,uuid,uuid,text,uuid) returns void
language sql as $$ select $$;

grant select on public.smyl_clinical_notes,public.smyl_clinical_note_versions,
  public.smyl_informed_consents,public.smyl_clinical_evidence_studies,
  public.smyl_clinical_evidence_context_links to authenticated;
