-- SMYL · Etapa 3: Ficha clínica 360.
-- Antecedentes versionados, notas clínicas firmables, archivos privados y línea de tiempo.
begin;

create table public.smyl_patient_histories (
  patient_id uuid not null,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  document jsonb not null default '{}'::jsonb check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 65536),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, patient_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);

create table public.smyl_patient_history_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  revision integer not null,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null,
  primary key (tenant_id, patient_id, revision),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);

create table public.smyl_clinical_notes (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  appointment_id uuid,
  professional_id uuid,
  note_type text not null default 'progress' check (note_type in ('initial','progress','procedure','postoperative','emergency','consultation')),
  status text not null default 'draft' check (status in ('draft','signed','voided')),
  revision integer not null default 1 check (revision > 0),
  document jsonb not null default '{}'::jsonb check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 65536),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  signed_by uuid references auth.users(id),
  signed_at timestamptz,
  void_reason text not null default '' check (char_length(void_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id),
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id),
  check ((status = 'signed' and signed_by is not null and signed_at is not null) or status <> 'signed')
);
create index smyl_clinical_notes_patient_idx on public.smyl_clinical_notes(tenant_id, patient_id, created_at desc);

create table public.smyl_clinical_note_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  note_id uuid not null,
  revision integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, note_id, revision),
  foreign key (tenant_id, note_id) references public.smyl_clinical_notes(tenant_id, id) on delete cascade
);

create table public.smyl_clinical_note_addenda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  note_id uuid not null,
  content text not null check (char_length(btrim(content)) between 2 and 8000),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, note_id) references public.smyl_clinical_notes(tenant_id, id) on delete cascade
);

create table public.smyl_patient_files (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  appointment_id uuid,
  category text not null check (category in ('clinical_photo','radiograph','laboratory','consent','referral','prescription','other')),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 180),
  storage_path text not null check (char_length(storage_path) between 10 and 900),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  notes text not null default '' check (char_length(notes) <= 1000),
  status text not null default 'active' check (status in ('active','archived')),
  captured_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, storage_path),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id)
);
create index smyl_patient_files_patient_idx on public.smyl_patient_files(tenant_id, patient_id, created_at desc) where status = 'active';

-- El auditor general también identifica recursos cuyo PK natural es patient_id.
create or replace function public.smyl_audit_row()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_before jsonb; v_after jsonb; v_row jsonb;
begin
  v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row := coalesce(v_after, v_before, '{}'::jsonb);
  insert into public.smyl_audit_events(tenant_id,actor_id,action,entity_type,entity_id,before_data,after_data)
  values((v_row->>'tenant_id')::uuid,auth.uid(),lower(tg_op),tg_table_name,
    coalesce(v_row->>'id',v_row->>'patient_id',v_row->>'user_id',v_row->>'role_id',v_row->>'branch_id',''),v_before,v_after);
  if tg_op='DELETE' then return old; end if; return new;
end; $$;

create trigger smyl_patient_histories_audit after insert or update or delete on public.smyl_patient_histories for each row execute function public.smyl_audit_row();
create trigger smyl_clinical_notes_audit after insert or update or delete on public.smyl_clinical_notes for each row execute function public.smyl_audit_row();
create trigger smyl_patient_files_audit after insert or update or delete on public.smyl_patient_files for each row execute function public.smyl_audit_row();
create trigger smyl_patient_files_touch before update on public.smyl_patient_files for each row execute function public.smyl_touch_updated_at();

alter table public.smyl_patient_histories enable row level security;
alter table public.smyl_patient_history_versions enable row level security;
alter table public.smyl_clinical_notes enable row level security;
alter table public.smyl_clinical_note_versions enable row level security;
alter table public.smyl_clinical_note_addenda enable row level security;
alter table public.smyl_patient_files enable row level security;

create policy smyl_patient_histories_read on public.smyl_patient_histories for select to authenticated using (public.smyl_has_permission(tenant_id,'clinical.read'));
create policy smyl_patient_history_versions_read on public.smyl_patient_history_versions for select to authenticated using (public.smyl_has_permission(tenant_id,'clinical.read'));
create policy smyl_clinical_notes_read on public.smyl_clinical_notes for select to authenticated using (public.smyl_has_permission(tenant_id,'clinical.read'));
create policy smyl_clinical_note_versions_read on public.smyl_clinical_note_versions for select to authenticated using (public.smyl_has_permission(tenant_id,'clinical.read'));
create policy smyl_clinical_note_addenda_read on public.smyl_clinical_note_addenda for select to authenticated using (public.smyl_has_permission(tenant_id,'clinical.read'));
create policy smyl_patient_files_read on public.smyl_patient_files for select to authenticated using (public.smyl_has_permission(tenant_id,'clinical.read'));

revoke all on table public.smyl_patient_histories,public.smyl_patient_history_versions,public.smyl_clinical_notes,public.smyl_clinical_note_versions,public.smyl_clinical_note_addenda,public.smyl_patient_files from anon,authenticated;
grant select on table public.smyl_patient_histories,public.smyl_patient_history_versions,public.smyl_clinical_notes,public.smyl_clinical_note_versions,public.smyl_clinical_note_addenda,public.smyl_patient_files to authenticated;

-- Amplía solo lectura de módulos clínicos existentes al equipo autorizado.
do $$ declare v_table text;
begin
  foreach v_table in array array['smyl_dental_records','smyl_dental_versions','smyl_photo_reviews','smyl_photo_review_versions','smyl_radiograph_reviews','smyl_radiograph_review_versions','smyl_clinical_plans','smyl_clinical_versions','smyl_patient_case_archive','smyl_proposals','smyl_proposal_versions'] loop
    if to_regclass('public.'||v_table) is not null then
      execute format('drop policy if exists smyl_clinical_team_read on public.%I',v_table);
      execute format('create policy smyl_clinical_team_read on public.%I for select to authenticated using (public.smyl_has_permission(tenant_id,''clinical.read''))',v_table);
    end if;
  end loop;
end $$;

commit;
