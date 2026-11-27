-- SMYL · Ortodoncia longitudinal canónica v1.
--
-- El plan ortodóntico pertenece a un capítulo de tratamiento; cada modificación
-- conserva una versión y cada control apunta a una nota clínica firmable. La
-- creación del control y de su nota ocurre en una sola transacción. Las tablas
-- sólo se escriben mediante RPC y nunca duplican los binarios del Centro de
-- evidencia.

begin;

-- Las llaves compuestas impiden que una relación válida por UUID cruce clínicas.
create unique index if not exists smyl_treatments_tenant_id_id_uidx
  on public.smyl_treatments (tenant_id, id);
create unique index if not exists smyl_informed_consents_tenant_id_id_uidx
  on public.smyl_informed_consents (tenant_id, id);

create table if not exists public.smyl_orthodontic_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  treatment_chapter_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  modality text check (modality is null or modality in ('fixed','aligner','mixed','retention')),
  arches text check (arches is null or arches in ('upper','lower','both')),
  phase text not null default 'records'
    check (phase in ('records','planning','active','finishing','retention','closed')),
  document jsonb not null default '{"schema":1}'::jsonb
    check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 65536),
  consent_id uuid,
  started_on date,
  expected_end_on date,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, treatment_chapter_id),
  foreign key (tenant_id, patient_id)
    references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, treatment_chapter_id)
    references public.smyl_treatments(tenant_id, id),
  foreign key (tenant_id, consent_id)
    references public.smyl_informed_consents(tenant_id, id),
  check (expected_end_on is null or started_on is null or expected_end_on >= started_on)
);
create index if not exists smyl_orthodontic_cases_patient_idx
  on public.smyl_orthodontic_cases (tenant_id, patient_id, updated_at desc);

create table if not exists public.smyl_orthodontic_case_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  orthodontic_case_id uuid not null,
  revision integer not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, orthodontic_case_id, revision),
  foreign key (tenant_id, orthodontic_case_id)
    references public.smyl_orthodontic_cases(tenant_id, id) on delete cascade
);

create table if not exists public.smyl_orthodontic_controls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  orthodontic_case_id uuid not null,
  clinical_note_id uuid not null,
  sequence integer not null check (sequence > 0),
  occurred_at timestamptz not null default now(),
  control_type text not null check (control_type in (
    'baseline','bonding','adjustment','aligner_delivery','aligner_change',
    'refinement','emergency','deband','retention'
  )),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinical_note_id),
  unique (tenant_id, orthodontic_case_id, sequence),
  foreign key (tenant_id, patient_id)
    references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, orthodontic_case_id)
    references public.smyl_orthodontic_cases(tenant_id, id),
  foreign key (tenant_id, clinical_note_id)
    references public.smyl_clinical_notes(tenant_id, id)
);
create index if not exists smyl_orthodontic_controls_case_idx
  on public.smyl_orthodontic_controls (tenant_id, orthodontic_case_id, sequence desc);

alter table public.smyl_orthodontic_cases enable row level security;
alter table public.smyl_orthodontic_case_versions enable row level security;
alter table public.smyl_orthodontic_controls enable row level security;

revoke all on public.smyl_orthodontic_cases,
  public.smyl_orthodontic_case_versions,
  public.smyl_orthodontic_controls from public, anon, authenticated;
grant select on public.smyl_orthodontic_cases,
  public.smyl_orthodontic_case_versions,
  public.smyl_orthodontic_controls to authenticated;

drop policy if exists smyl_orthodontic_cases_read on public.smyl_orthodontic_cases;
create policy smyl_orthodontic_cases_read on public.smyl_orthodontic_cases
  for select to authenticated using (
    public.smyl_has_permission(tenant_id, 'clinical.read')
    and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical')
  );
drop policy if exists smyl_orthodontic_case_versions_read on public.smyl_orthodontic_case_versions;
create policy smyl_orthodontic_case_versions_read on public.smyl_orthodontic_case_versions
  for select to authenticated using (exists (
    select 1 from public.smyl_orthodontic_cases c
     where c.tenant_id = smyl_orthodontic_case_versions.tenant_id
       and c.id = smyl_orthodontic_case_versions.orthodontic_case_id
       and public.smyl_has_permission(c.tenant_id, 'clinical.read')
       and public.smyl_can_access_patient(c.tenant_id, c.patient_id, 'clinical')
  ));
drop policy if exists smyl_orthodontic_controls_read on public.smyl_orthodontic_controls;
create policy smyl_orthodontic_controls_read on public.smyl_orthodontic_controls
  for select to authenticated using (
    public.smyl_has_permission(tenant_id, 'clinical.read')
    and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical')
  );

create or replace function public.smyl_orthodontic_append_only_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using errcode = '55000',
    message = 'El historial ortodóntico es inmutable.';
end;
$$;
drop trigger if exists smyl_orthodontic_case_versions_guard on public.smyl_orthodontic_case_versions;
create trigger smyl_orthodontic_case_versions_guard
  before update or delete on public.smyl_orthodontic_case_versions
  for each row execute function public.smyl_orthodontic_append_only_guard();
drop trigger if exists smyl_orthodontic_controls_guard on public.smyl_orthodontic_controls;
create trigger smyl_orthodontic_controls_guard
  before update or delete on public.smyl_orthodontic_controls
  for each row execute function public.smyl_orthodontic_append_only_guard();

create or replace function public.smyl_orthodontic_case_delete_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() = 1
     and coalesce(current_setting('smyl.retention_purge', true), '') <> 'nom004-5y' then
    raise exception using errcode = '55000',
      message = 'Un caso ortodóntico no se puede eliminar.';
  end if;
  return old;
end;
$$;
drop trigger if exists smyl_orthodontic_cases_delete_guard on public.smyl_orthodontic_cases;
create trigger smyl_orthodontic_cases_delete_guard
  before delete on public.smyl_orthodontic_cases
  for each row execute function public.smyl_orthodontic_case_delete_guard();

drop trigger if exists smyl_orthodontic_cases_audit on public.smyl_orthodontic_cases;
create trigger smyl_orthodontic_cases_audit
  after insert or update or delete on public.smyl_orthodontic_cases
  for each row execute function public.smyl_audit_row();
drop trigger if exists smyl_orthodontic_controls_audit on public.smyl_orthodontic_controls;
create trigger smyl_orthodontic_controls_audit
  after insert or update or delete on public.smyl_orthodontic_controls
  for each row execute function public.smyl_audit_row();

create or replace function public.smyl_orthodontic_access(
  p_patient_id uuid,
  p_permission text default 'clinical.read'
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if p_permission not in ('clinical.read','clinical.write','clinical.approve') then
    raise exception using errcode = '22023', message = 'El permiso clínico no es válido.';
  end if;
  if v_tenant is null or not public.smyl_has_permission(v_tenant, p_permission) then
    raise exception using errcode = '42501', message = 'No tienes permiso para esta acción ortodóntica.';
  end if;
  if not exists (
      select 1 from public.camila_pacientes
       where tenant_id = v_tenant and id = p_patient_id
    ) or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes acceso clínico a este paciente.';
  end if;
  return v_tenant;
end;
$$;

create or replace function public.smyl_orthodontic_validate_document(p_document jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object'
     or octet_length(p_document::text) > 65536
     or coalesce((p_document->>'schema')::integer, 0) <> 1 then
    raise exception using errcode = '22023', message = 'El plan ortodóntico no es válido.';
  end if;
exception when invalid_text_representation then
  raise exception using errcode = '22023', message = 'El plan ortodóntico no es válido.';
end;
$$;

create or replace function public.smyl_orthodontic_modality(p_document jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare v_value text := nullif(btrim(coalesce(
  p_document->>'modality', p_document#>>'{mechanics,applianceType}', ''
)), '');
begin
  if v_value is not null and v_value not in ('fixed','aligner','mixed','retention') then
    raise exception using errcode = '22023', message = 'La modalidad ortodóntica no es válida.';
  end if;
  return v_value;
end;
$$;

create or replace function public.smyl_orthodontic_arches(p_document jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare v_value text := nullif(btrim(coalesce(
  p_document->>'arches', p_document#>>'{mechanics,arches}', ''
)), '');
begin
  if v_value is not null and v_value not in ('upper','lower','both') then
    raise exception using errcode = '22023', message = 'Las arcadas ortodónticas no son válidas.';
  end if;
  return v_value;
end;
$$;

create or replace function public.smyl_orthodontic_consent_from_document(
  p_tenant uuid,
  p_patient_id uuid,
  p_document jsonb
) returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_text text := nullif(btrim(coalesce(p_document->>'consentId', '')), ''); v_id uuid;
begin
  if v_text is null then return null; end if;
  if v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = '22023', message = 'El consentimiento vinculado no es válido.';
  end if;
  v_id := v_text::uuid;
  if not exists (
    select 1 from public.smyl_informed_consents c
     where c.tenant_id = p_tenant and c.patient_id = p_patient_id
       and c.id = v_id and c.revoked_at is null
  ) then
    raise exception using errcode = '23514',
      message = 'El consentimiento no pertenece al paciente o fue revocado.';
  end if;
  return v_id;
end;
$$;

create or replace function public.smyl_orthodontic_case_snapshot(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_strip_nulls(to_jsonb(c) - 'tenant_id')
    from public.smyl_orthodontic_cases c where c.id = p_id
$$;

create or replace function public.smyl_get_orthodontic_case(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_orthodontic_access(p_patient_id, 'clinical.read'); v_result jsonb;
begin
  select jsonb_strip_nulls(to_jsonb(c) - 'tenant_id')
         || jsonb_build_object('treatment_status', t.status)
    into v_result
    from public.smyl_orthodontic_cases c
    join public.smyl_treatments t
      on t.tenant_id = c.tenant_id and t.id = c.treatment_chapter_id
   where c.tenant_id = v_tenant and c.patient_id = p_patient_id
   order by (t.status = 'active') desc, c.updated_at desc
   limit 1;
  return v_result;
end;
$$;

create or replace function public.smyl_create_orthodontic_case(
  p_treatment_chapter_id uuid,
  p_document jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_treatment public.smyl_treatments;
  v_row public.smyl_orthodontic_cases;
  v_consent uuid;
begin
  perform public.smyl_orthodontic_validate_document(p_document);
  select * into v_treatment from public.smyl_treatments
   where tenant_id = v_tenant and id = p_treatment_chapter_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'El tratamiento no existe.';
  end if;
  perform public.smyl_orthodontic_access(v_treatment.patient_id, 'clinical.write');
  if v_treatment.status <> 'active' then
    raise exception using errcode = '23514', message = 'El tratamiento debe estar activo para iniciar ortodoncia.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'orthodontic-case:' || v_tenant::text || ':' || p_treatment_chapter_id::text, 0
  ));
  select * into v_row from public.smyl_orthodontic_cases
   where tenant_id = v_tenant and treatment_chapter_id = p_treatment_chapter_id;
  if found then return public.smyl_orthodontic_case_snapshot(v_row.id); end if;

  v_consent := public.smyl_orthodontic_consent_from_document(v_tenant, v_treatment.patient_id, p_document);
  insert into public.smyl_orthodontic_cases (
    tenant_id, patient_id, treatment_chapter_id, modality, arches, document,
    consent_id, started_on, expected_end_on, created_by, updated_by
  ) values (
    v_tenant, v_treatment.patient_id, p_treatment_chapter_id,
    public.smyl_orthodontic_modality(p_document), public.smyl_orthodontic_arches(p_document), p_document,
    v_consent,
    case when nullif(p_document->>'startedOn','') ~ '^\d{4}-\d{2}-\d{2}$' then (p_document->>'startedOn')::date end,
    case when nullif(p_document->>'expectedEndOn','') ~ '^\d{4}-\d{2}-\d{2}$' then (p_document->>'expectedEndOn')::date end,
    auth.uid(), auth.uid()
  ) returning * into v_row;
  insert into public.smyl_orthodontic_case_versions (
    tenant_id, orthodontic_case_id, revision, snapshot, actor_id
  ) values (v_tenant, v_row.id, v_row.revision, public.smyl_orthodontic_case_snapshot(v_row.id), auth.uid());
  return public.smyl_orthodontic_case_snapshot(v_row.id);
end;
$$;

create or replace function public.smyl_update_orthodontic_case(
  p_id uuid,
  p_expected_revision integer,
  p_document jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_orthodontic_cases; v_consent uuid;
begin
  perform public.smyl_orthodontic_validate_document(p_document);
  select * into v_row from public.smyl_orthodontic_cases
   where tenant_id = v_tenant and id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'El caso ortodóntico no existe.'; end if;
  perform public.smyl_orthodontic_access(v_row.patient_id, 'clinical.write');
  if v_row.phase = 'closed' then
    raise exception using errcode = '55000', message = 'Un caso ortodóntico cerrado no se modifica.';
  end if;
  if v_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'El plan ortodóntico cambió en otra sesión. Actualiza la ficha.';
  end if;
  v_consent := case when p_document ? 'consentId'
    then public.smyl_orthodontic_consent_from_document(v_tenant, v_row.patient_id, p_document)
    else v_row.consent_id end;
  if v_row.phase in ('active','finishing','retention') and v_consent is null then
    raise exception using errcode = '23514', message = 'El caso activo debe conservar su consentimiento informado.';
  end if;
  update public.smyl_orthodontic_cases
     set revision = revision + 1,
         modality = public.smyl_orthodontic_modality(p_document),
         arches = public.smyl_orthodontic_arches(p_document),
         document = p_document,
         consent_id = v_consent,
         updated_by = auth.uid(), updated_at = clock_timestamp()
   where tenant_id = v_tenant and id = p_id returning * into v_row;
  insert into public.smyl_orthodontic_case_versions (
    tenant_id, orthodontic_case_id, revision, snapshot, actor_id
  ) values (v_tenant, v_row.id, v_row.revision, public.smyl_orthodontic_case_snapshot(v_row.id), auth.uid());
  return public.smyl_orthodontic_case_snapshot(v_row.id);
end;
$$;

create or replace function public.smyl_transition_orthodontic_phase(
  p_id uuid,
  p_expected_revision integer,
  p_phase text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_orthodontic_cases;
begin
  if p_phase not in ('records','planning','active','finishing','retention','closed') then
    raise exception using errcode = '22023', message = 'La fase ortodóntica no es válida.';
  end if;
  select * into v_row from public.smyl_orthodontic_cases
   where tenant_id = v_tenant and id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'El caso ortodóntico no existe.'; end if;
  perform public.smyl_orthodontic_access(v_row.patient_id, 'clinical.approve');
  if v_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'El caso cambió en otra sesión. Actualiza la ficha.';
  end if;
  if v_row.phase = 'closed' and p_phase <> 'closed' then
    raise exception using errcode = '55000', message = 'Un caso ortodóntico cerrado no se reabre.';
  end if;
  if p_phase = v_row.phase then return public.smyl_orthodontic_case_snapshot(v_row.id); end if;
  if p_phase = 'active' and (
    v_row.consent_id is null or not exists (
      select 1 from public.smyl_informed_consents c
       where c.tenant_id = v_tenant and c.patient_id = v_row.patient_id
         and c.id = v_row.consent_id and c.revoked_at is null
    )
  ) then
    raise exception using errcode = '23514',
      message = 'Vincula un consentimiento informado vigente antes de activar el caso.';
  end if;
  update public.smyl_orthodontic_cases
     set phase = p_phase, revision = revision + 1,
         started_on = case when p_phase = 'active' and started_on is null then current_date else started_on end,
         updated_by = auth.uid(), updated_at = clock_timestamp()
   where tenant_id = v_tenant and id = p_id returning * into v_row;
  insert into public.smyl_orthodontic_case_versions (
    tenant_id, orthodontic_case_id, revision, snapshot, actor_id
  ) values (v_tenant, v_row.id, v_row.revision, public.smyl_orthodontic_case_snapshot(v_row.id), auth.uid());
  return public.smyl_orthodontic_case_snapshot(v_row.id);
end;
$$;

create or replace function public.smyl_activate_orthodontic_case(
  p_id uuid,
  p_expected_revision integer,
  p_consent_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_row public.smyl_orthodontic_cases;
  v_document jsonb;
begin
  if p_consent_id is null then
    raise exception using errcode = '22023', message = 'Selecciona un consentimiento informado vigente.';
  end if;
  select * into v_row from public.smyl_orthodontic_cases
   where tenant_id = v_tenant and id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'El caso ortodóntico no existe.';
  end if;
  perform public.smyl_orthodontic_access(v_row.patient_id, 'clinical.approve');
  if v_row.revision <> p_expected_revision then
    raise exception using errcode = '40001', message = 'El caso cambió en otra sesión. Actualiza la ficha.';
  end if;
  if v_row.phase = 'closed' then
    raise exception using errcode = '55000', message = 'Un caso ortodóntico cerrado no se reabre.';
  end if;
  if v_row.phase not in ('records','planning') then
    raise exception using errcode = '55000', message = 'El caso ortodóntico ya fue activado.';
  end if;
  if not exists (
    select 1 from public.smyl_informed_consents c
     where c.tenant_id = v_tenant and c.patient_id = v_row.patient_id
       and c.id = p_consent_id and c.revoked_at is null
  ) then
    raise exception using errcode = '23514',
      message = 'El consentimiento no pertenece al paciente o fue revocado.';
  end if;
  v_document := jsonb_set(
    coalesce(v_row.document, '{"schema":1}'::jsonb),
    '{consentId}', to_jsonb(p_consent_id::text), true
  );
  perform public.smyl_orthodontic_validate_document(v_document);
  update public.smyl_orthodontic_cases
     set phase = 'active',
         revision = revision + 1,
         document = v_document,
         consent_id = p_consent_id,
         started_on = coalesce(started_on, current_date),
         updated_by = auth.uid(),
         updated_at = clock_timestamp()
   where tenant_id = v_tenant and id = p_id
   returning * into v_row;
  insert into public.smyl_orthodontic_case_versions (
    tenant_id, orthodontic_case_id, revision, snapshot, actor_id
  ) values (
    v_tenant, v_row.id, v_row.revision,
    public.smyl_orthodontic_case_snapshot(v_row.id), auth.uid()
  );
  return public.smyl_orthodontic_case_snapshot(v_row.id);
end;
$$;

create or replace function public.smyl_create_orthodontic_control(
  p_orthodontic_case_id uuid,
  p_clinical_note_id uuid,
  p_appointment_id uuid,
  p_professional_id uuid,
  p_control_type text,
  p_occurred_at timestamptz,
  p_document jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_case public.smyl_orthodontic_cases;
  v_treatment public.smyl_treatments;
  v_control public.smyl_orthodontic_controls;
  v_note public.smyl_clinical_notes;
  v_sequence integer;
  v_ortho jsonb;
  v_document jsonb;
begin
  if p_clinical_note_id is null or p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception using errcode = '22023', message = 'El control ortodóntico no es válido.';
  end if;
  if p_control_type not in (
    'baseline','bonding','adjustment','aligner_delivery','aligner_change',
    'refinement','emergency','deband','retention'
  ) then
    raise exception using errcode = '22023', message = 'El tipo de control ortodóntico no es válido.';
  end if;
  if p_occurred_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'La fecha del control no puede estar en el futuro.';
  end if;
  select * into v_case from public.smyl_orthodontic_cases
   where tenant_id = v_tenant and id = p_orthodontic_case_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'El caso ortodóntico no existe.'; end if;
  perform public.smyl_orthodontic_access(v_case.patient_id, 'clinical.write');
  if v_case.phase = 'closed' then
    raise exception using errcode = '55000', message = 'Un caso cerrado no admite controles nuevos.';
  end if;
  if v_case.phase in ('records','planning') and p_control_type not in ('baseline','emergency') then
    raise exception using errcode = '23514',
      message = 'Antes de registrar ajustes, activa el caso con un consentimiento informado vigente.';
  end if;
  if v_case.phase = 'retention' and p_control_type not in ('retention','emergency') then
    raise exception using errcode = '23514',
      message = 'En retención registra un control de retención o una urgencia.';
  end if;
  select * into v_treatment from public.smyl_treatments
   where tenant_id = v_tenant and id = v_case.treatment_chapter_id;
  if not found or v_treatment.status <> 'active' then
    raise exception using errcode = '23514', message = 'El capítulo de tratamiento ya no está activo.';
  end if;
  if p_appointment_id is not null and not exists (
    select 1 from public.smyl_appointments a
     where a.tenant_id = v_tenant and a.id = p_appointment_id and a.patient_id = v_case.patient_id
  ) then
    raise exception using errcode = '23514', message = 'La cita no pertenece a este paciente.';
  end if;
  if p_professional_id is not null and not exists (
    select 1 from public.smyl_professionals p
     where p.tenant_id = v_tenant and p.id = p_professional_id and p.active
  ) then
    raise exception using errcode = 'P0002', message = 'El profesional no existe o está inactivo.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'orthodontic-control:' || v_tenant::text || ':' || p_clinical_note_id::text, 0
  ));
  select * into v_control from public.smyl_orthodontic_controls
   where tenant_id = v_tenant and clinical_note_id = p_clinical_note_id;
  if found then
    if v_control.orthodontic_case_id <> p_orthodontic_case_id then
      raise exception using errcode = '23505', message = 'La nota ya pertenece a otro caso ortodóntico.';
    end if;
    select * into v_note from public.smyl_clinical_notes
     where tenant_id = v_tenant and id = p_clinical_note_id;
    return jsonb_build_object(
      'control', jsonb_strip_nulls(to_jsonb(v_control) - 'tenant_id'),
      'note', jsonb_strip_nulls(to_jsonb(v_note) - 'tenant_id')
    );
  end if;
  if exists (select 1 from public.smyl_clinical_notes where id = p_clinical_note_id) then
    raise exception using errcode = '23505', message = 'El identificador de nota ya está en uso.';
  end if;

  v_ortho := coalesce(p_document->'orthodontics', '{}'::jsonb);
  if jsonb_typeof(v_ortho) <> 'object' then
    raise exception using errcode = '22023', message = 'El bloque ortodóntico de la nota no es válido.';
  end if;
  v_ortho := v_ortho || jsonb_build_object(
    'schema', 1,
    'caseId', v_case.id,
    'treatmentId', v_case.treatment_chapter_id,
    'controlType', p_control_type,
    'phase', v_case.phase
  );
  v_document := jsonb_set(p_document, '{orthodontics}', v_ortho, true);
  if octet_length(v_document::text) > 65536 then
    raise exception using errcode = '22023', message = 'La nota del control es demasiado extensa.';
  end if;

  insert into public.smyl_clinical_notes (
    id, tenant_id, patient_id, appointment_id, professional_id, note_type,
    document, created_by, updated_by
  ) values (
    p_clinical_note_id, v_tenant, v_case.patient_id, p_appointment_id,
    p_professional_id, 'progress', v_document, auth.uid(), auth.uid()
  ) returning * into v_note;
  insert into public.smyl_clinical_note_versions (
    tenant_id, note_id, revision, snapshot, actor_id
  ) values (v_tenant, v_note.id, 1, to_jsonb(v_note) - 'tenant_id', auth.uid());

  perform pg_advisory_xact_lock(hashtextextended(
    'orthodontic-case-sequence:' || v_tenant::text || ':' || v_case.id::text, 0
  ));
  select coalesce(max(sequence), 0) + 1 into v_sequence
    from public.smyl_orthodontic_controls
   where tenant_id = v_tenant and orthodontic_case_id = v_case.id;
  insert into public.smyl_orthodontic_controls (
    tenant_id, patient_id, orthodontic_case_id, clinical_note_id, sequence,
    occurred_at, control_type, created_by
  ) values (
    v_tenant, v_case.patient_id, v_case.id, v_note.id, v_sequence,
    coalesce(p_occurred_at, clock_timestamp()), p_control_type, auth.uid()
  ) returning * into v_control;
  return jsonb_build_object(
    'control', jsonb_strip_nulls(to_jsonb(v_control) - 'tenant_id'),
    'note', jsonb_strip_nulls(to_jsonb(v_note) - 'tenant_id')
  );
end;
$$;

create or replace function public.smyl_list_orthodontic_controls(p_orthodontic_case_id uuid)
returns table (
  id uuid,
  clinical_note_id uuid,
  sequence integer,
  occurred_at timestamptz,
  control_type text,
  note_status text,
  note_revision integer,
  document jsonb,
  professional_id uuid,
  appointment_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_case public.smyl_orthodontic_cases;
begin
  select * into v_case from public.smyl_orthodontic_cases
   where tenant_id = v_tenant and smyl_orthodontic_cases.id = p_orthodontic_case_id;
  if not found then raise exception using errcode = 'P0002', message = 'El caso ortodóntico no existe.'; end if;
  perform public.smyl_orthodontic_access(v_case.patient_id, 'clinical.read');
  return query
  select c.id, c.clinical_note_id, c.sequence, c.occurred_at, c.control_type,
         n.status, n.revision, n.document, n.professional_id, n.appointment_id, c.created_at
    from public.smyl_orthodontic_controls c
    join public.smyl_clinical_notes n
      on n.tenant_id = c.tenant_id and n.id = c.clinical_note_id
   where c.tenant_id = v_tenant and c.orthodontic_case_id = p_orthodontic_case_id
   order by c.sequence desc;
end;
$$;

-- El Centro de evidencia admite el caso como contexto sin copiar el archivo.
alter table public.smyl_clinical_evidence_context_links
  add column if not exists clinical_role text;
alter table public.smyl_clinical_evidence_context_links
  drop constraint if exists smyl_clinical_evidence_context_links_context_type_check;
alter table public.smyl_clinical_evidence_context_links
  add constraint smyl_clinical_evidence_context_links_context_type_check
  check (context_type in (
    'odontogram','periodontogram','clinical_note','treatment_plan','appointment',
    'diagnosis','comparison','orthodontic_case'
  ));
alter table public.smyl_clinical_evidence_context_links
  drop constraint if exists smyl_clinical_evidence_context_links_clinical_role_check;
alter table public.smyl_clinical_evidence_context_links
  add constraint smyl_clinical_evidence_context_links_clinical_role_check
  check (clinical_role is null or clinical_role in ('baseline','progress','issue','final','retention'));

create or replace function public.smyl_link_orthodontic_evidence(
  p_orthodontic_case_id uuid,
  p_study_id uuid,
  p_clinical_note_id uuid default null,
  p_role text default 'progress'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_case public.smyl_orthodontic_cases;
  v_study public.smyl_clinical_evidence_studies;
  v_case_link public.smyl_clinical_evidence_context_links;
  v_note_link public.smyl_clinical_evidence_context_links;
begin
  if p_role not in ('baseline','progress','issue','final','retention') then
    raise exception using errcode = '22023', message = 'El rol de la evidencia no es válido.';
  end if;
  select * into v_case from public.smyl_orthodontic_cases
   where tenant_id = v_tenant and id = p_orthodontic_case_id;
  if not found then raise exception using errcode = 'P0002', message = 'El caso ortodóntico no existe.'; end if;
  perform public.smyl_orthodontic_access(v_case.patient_id, 'clinical.write');
  select * into v_study from public.smyl_clinical_evidence_studies
   where tenant_id = v_tenant and patient_id = v_case.patient_id and id = p_study_id for update;
  if not found then
    raise exception using errcode = '23514', message = 'El estudio no pertenece a este expediente.';
  end if;
  if v_study.status in ('signed','superseded') then
    raise exception using errcode = '23514', message = 'No se cambia el contexto de un estudio final.';
  end if;
  if p_clinical_note_id is not null and not exists (
    select 1 from public.smyl_orthodontic_controls c
     where c.tenant_id = v_tenant and c.orthodontic_case_id = v_case.id
       and c.clinical_note_id = p_clinical_note_id
  ) then
    raise exception using errcode = '23514', message = 'La nota no pertenece a un control de este caso.';
  end if;

  select * into v_case_link from public.smyl_clinical_evidence_context_links l
   where l.tenant_id = v_tenant and l.study_id = p_study_id
     and l.context_type = 'orthodontic_case' and l.context_id = v_case.id
     and l.relationship = 'supports' and l.revoked_at is null;
  if not found then
    insert into public.smyl_clinical_evidence_context_links (
      tenant_id, patient_id, study_id, context_type, context_id,
      relationship, clinical_role, created_by
    ) values (
      v_tenant, v_case.patient_id, p_study_id, 'orthodontic_case', v_case.id,
      'supports', p_role, auth.uid()
    ) returning * into v_case_link;
    perform public.smyl_evidence_log_event(v_tenant, v_case.patient_id, p_study_id, 'link', v_case_link.id);
  end if;
  if p_clinical_note_id is not null then
    select * into v_note_link from public.smyl_clinical_evidence_context_links l
     where l.tenant_id = v_tenant and l.study_id = p_study_id
       and l.context_type = 'clinical_note' and l.context_id = p_clinical_note_id
       and l.relationship = 'supports' and l.revoked_at is null;
    if not found then
      insert into public.smyl_clinical_evidence_context_links (
        tenant_id, patient_id, study_id, context_type, context_id,
        relationship, created_by
      ) values (
        v_tenant, v_case.patient_id, p_study_id, 'clinical_note', p_clinical_note_id,
        'supports', auth.uid()
      ) returning * into v_note_link;
      perform public.smyl_evidence_log_event(v_tenant, v_case.patient_id, p_study_id, 'link', v_note_link.id);
    end if;
  end if;
  return jsonb_build_object(
    'case_link_id', v_case_link.id,
    'clinical_note_link_id', case when p_clinical_note_id is null then null else v_note_link.id end,
    'role', p_role
  );
end;
$$;

revoke all on function public.smyl_orthodontic_append_only_guard() from public, anon, authenticated;
revoke all on function public.smyl_orthodontic_case_delete_guard() from public, anon, authenticated;
revoke all on function public.smyl_orthodontic_access(uuid, text) from public, anon, authenticated;
revoke all on function public.smyl_orthodontic_validate_document(jsonb) from public, anon, authenticated;
revoke all on function public.smyl_orthodontic_modality(jsonb) from public, anon, authenticated;
revoke all on function public.smyl_orthodontic_arches(jsonb) from public, anon, authenticated;
revoke all on function public.smyl_orthodontic_consent_from_document(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.smyl_orthodontic_case_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.smyl_get_orthodontic_case(uuid) from public, anon;
revoke all on function public.smyl_create_orthodontic_case(uuid, jsonb) from public, anon;
revoke all on function public.smyl_update_orthodontic_case(uuid, integer, jsonb) from public, anon;
revoke all on function public.smyl_transition_orthodontic_phase(uuid, integer, text) from public, anon;
revoke all on function public.smyl_activate_orthodontic_case(uuid, integer, uuid) from public, anon;
revoke all on function public.smyl_create_orthodontic_control(uuid, uuid, uuid, uuid, text, timestamptz, jsonb) from public, anon;
revoke all on function public.smyl_list_orthodontic_controls(uuid) from public, anon;
revoke all on function public.smyl_link_orthodontic_evidence(uuid, uuid, uuid, text) from public, anon;

grant execute on function public.smyl_get_orthodontic_case(uuid) to authenticated;
grant execute on function public.smyl_create_orthodontic_case(uuid, jsonb) to authenticated;
grant execute on function public.smyl_update_orthodontic_case(uuid, integer, jsonb) to authenticated;
grant execute on function public.smyl_transition_orthodontic_phase(uuid, integer, text) to authenticated;
grant execute on function public.smyl_activate_orthodontic_case(uuid, integer, uuid) to authenticated;
grant execute on function public.smyl_create_orthodontic_control(uuid, uuid, uuid, uuid, text, timestamptz, jsonb) to authenticated;
grant execute on function public.smyl_list_orthodontic_controls(uuid) to authenticated;
grant execute on function public.smyl_link_orthodontic_evidence(uuid, uuid, uuid, text) to authenticated;

commit;
