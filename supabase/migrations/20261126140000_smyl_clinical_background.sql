-- Historia clínica completa (NOM-004-SSA3-2012 6.1; NOM-013-SSA2-2015):
--   * Antecedentes y exploración: heredofamiliares, interrogatorio por aparatos y sistemas, gineco-obstétricos
--     (embarazo/lactancia) y exploración de tejidos blandos y ATM. Un documento por paciente, con revisión y versiones.
--   * Signos vitales: registro fechado (tensión arterial, frecuencias, temperatura, peso, talla). Solo se agregan.
--   * Ficha de identificación: domicilio y CURP del paciente.
-- Leer: clinical.read + acceso al paciente. Escribir: solo por funciones con clinical.write.
-- Idempotente.

alter table public.camila_pacientes
  add column if not exists domicilio text not null default '' check (char_length(domicilio) <= 300),
  add column if not exists curp text not null default '';
do $$ begin
  alter table public.camila_pacientes drop constraint if exists camila_pacientes_curp_check;
  alter table public.camila_pacientes add constraint camila_pacientes_curp_check
    check (curp = '' or curp ~ '^[A-Z][AEIOUX][A-Z]{2}[0-9]{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z][0-9]$');
end $$;

create table if not exists public.smyl_patient_clinical_background (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  document jsonb not null default '{}'::jsonb check (jsonb_typeof(document) = 'object' and pg_column_size(document) <= 60000),
  revision integer not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, patient_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id)
);
create table if not exists public.smyl_patient_clinical_background_versions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  patient_id uuid not null,
  revision integer not null,
  document jsonb not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.smyl_patient_vital_signs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  measured_at timestamptz not null default now(),
  systolic smallint check (systolic is null or systolic between 50 and 260),
  diastolic smallint check (diastolic is null or diastolic between 30 and 160),
  heart_rate smallint check (heart_rate is null or heart_rate between 20 and 250),
  respiratory_rate smallint check (respiratory_rate is null or respiratory_rate between 4 and 80),
  temperature numeric(4,1) check (temperature is null or temperature between 30 and 45),
  weight_kg numeric(5,1) check (weight_kg is null or weight_kg between 1 and 400),
  height_cm numeric(5,1) check (height_cm is null or height_cm between 30 and 250),
  notes text not null default '' check (char_length(notes) <= 500),
  recorded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, patient_id) references public.camila_pacientes (tenant_id, id)
);
create index if not exists smyl_patient_vital_signs_patient_idx on public.smyl_patient_vital_signs (tenant_id, patient_id, measured_at desc);

alter table public.smyl_patient_clinical_background enable row level security;
alter table public.smyl_patient_clinical_background_versions enable row level security;
alter table public.smyl_patient_vital_signs enable row level security;
revoke all on public.smyl_patient_clinical_background, public.smyl_patient_clinical_background_versions, public.smyl_patient_vital_signs from public, anon, authenticated;
grant select on public.smyl_patient_clinical_background, public.smyl_patient_clinical_background_versions, public.smyl_patient_vital_signs to authenticated;

drop policy if exists smyl_background_read on public.smyl_patient_clinical_background;
create policy smyl_background_read on public.smyl_patient_clinical_background for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_background_versions_read on public.smyl_patient_clinical_background_versions;
create policy smyl_background_versions_read on public.smyl_patient_clinical_background_versions for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_vital_signs_read on public.smyl_patient_vital_signs;
create policy smyl_vital_signs_read on public.smyl_patient_vital_signs for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));

-- Los signos vitales no se editan ni se borran (se corrige con un registro nuevo).
create or replace function public.smyl_vital_signs_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' and (pg_trigger_depth() > 1 or coalesce(current_setting('smyl.retention_purge', true), '') = 'nom004-5y') then return old; end if;
  raise exception using errcode = '55000', message = 'Los signos vitales registrados no se modifican; agrega una medición nueva.';
end;
$$;
drop trigger if exists smyl_vital_signs_immutable on public.smyl_patient_vital_signs;
create trigger smyl_vital_signs_immutable before update or delete on public.smyl_patient_vital_signs
  for each row execute function public.smyl_vital_signs_immutable();

-- Guardar antecedentes (con control de revisión: no pisa cambios hechos en otra sesión).
create or replace function public.smyl_save_clinical_background(p_patient_id uuid, p_expected_revision integer, p_document jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_rev integer;
  v_doc jsonb := '{}'::jsonb;
  v_key text;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id)
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes permiso para editar la historia clínica de este paciente.';
  end if;
  if jsonb_typeof(p_document) <> 'object' then
    raise exception using errcode = '22023', message = 'Documento inválido.';
  end if;
  -- Solo claves conocidas y texto acotado.
  foreach v_key in array array['family_history','family_notes','systems_review','gyneco','pregnancy','lactation','soft_tissue','tmj','other'] loop
    if p_document ? v_key then
      if jsonb_typeof(p_document->v_key) = 'object' then
        v_doc := v_doc || jsonb_build_object(v_key, (select coalesce(jsonb_object_agg(k, left(btrim(v), 1000)), '{}'::jsonb)
                                                     from jsonb_each_text(p_document->v_key) as e(k, v) where k ~ '^[a-z_]{1,40}$'));
      else
        v_doc := v_doc || jsonb_build_object(v_key, left(btrim(coalesce(p_document->>v_key, '')), 3000));
      end if;
    end if;
  end loop;

  select revision into v_rev from public.smyl_patient_clinical_background where tenant_id = v_tenant and patient_id = p_patient_id for update;
  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception using errcode = '40001', message = 'La historia cambió en otra sesión. Actualiza la ficha.';
    end if;
    insert into public.smyl_patient_clinical_background (tenant_id, patient_id, document, revision, updated_by)
    values (v_tenant, p_patient_id, v_doc, 1, auth.uid());
    v_rev := 1;
  else
    if v_rev <> p_expected_revision then
      raise exception using errcode = '40001', message = 'La historia cambió en otra sesión. Actualiza la ficha.';
    end if;
    v_rev := v_rev + 1;
    update public.smyl_patient_clinical_background set document = v_doc, revision = v_rev, updated_by = auth.uid(), updated_at = now()
     where tenant_id = v_tenant and patient_id = p_patient_id;
  end if;
  insert into public.smyl_patient_clinical_background_versions (tenant_id, patient_id, revision, document, actor_id)
  values (v_tenant, p_patient_id, v_rev, v_doc, auth.uid());
  return v_rev;
end;
$$;

create or replace function public.smyl_add_vital_signs(p_patient_id uuid, p_measured_at timestamptz, p_values jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_id uuid;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write')
     or not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id)
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'clinical') then
    raise exception using errcode = '42501', message = 'No tienes permiso para registrar signos vitales de este paciente.';
  end if;
  if not (p_values ?| array['systolic','diastolic','heart_rate','respiratory_rate','temperature','weight_kg','height_cm']) then
    raise exception using errcode = '22023', message = 'Registra al menos un signo vital.';
  end if;
  insert into public.smyl_patient_vital_signs (tenant_id, patient_id, measured_at, systolic, diastolic, heart_rate, respiratory_rate,
    temperature, weight_kg, height_cm, notes)
  values (v_tenant, p_patient_id, coalesce(p_measured_at, now()),
    nullif(p_values->>'systolic', '')::smallint, nullif(p_values->>'diastolic', '')::smallint,
    nullif(p_values->>'heart_rate', '')::smallint, nullif(p_values->>'respiratory_rate', '')::smallint,
    nullif(p_values->>'temperature', '')::numeric, nullif(p_values->>'weight_kg', '')::numeric,
    nullif(p_values->>'height_cm', '')::numeric, left(btrim(coalesce(p_values->>'notes', '')), 500))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.smyl_save_clinical_background(uuid, integer, jsonb) from public, anon;
revoke all on function public.smyl_add_vital_signs(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.smyl_save_clinical_background(uuid, integer, jsonb) to authenticated;
grant execute on function public.smyl_add_vital_signs(uuid, timestamptz, jsonb) to authenticated;

-- Retención: antecedentes y signos vitales también cuentan como expediente.
create or replace function public.smyl_patient_last_clinical_activity(p_tenant uuid, p_patient uuid)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select max(t) from (
    select max(greatest(created_at, updated_at)) t from public.smyl_clinical_notes where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_patient_histories where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_dental_records where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_clinical_plans where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.smyl_patient_files where tenant_id = p_tenant and patient_id = p_patient
    union all select max(created_at) from public.smyl_radiograph_sources where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.smyl_clinical_evidence_studies where tenant_id = p_tenant and patient_id = p_patient
    union all select max(greatest(created_at, updated_at)) from public.mila_clinical_notes where tenant_id = p_tenant and paciente_id = p_patient
    union all select max(signed_at) from public.smyl_informed_consents where tenant_id = p_tenant and patient_id = p_patient
    union all select max(issued_at) from public.smyl_prescriptions where tenant_id = p_tenant and patient_id = p_patient
    union all select max(updated_at) from public.smyl_patient_clinical_background where tenant_id = p_tenant and patient_id = p_patient
    union all select max(measured_at) from public.smyl_patient_vital_signs where tenant_id = p_tenant and patient_id = p_patient
    union all select case when exists (select 1 from public.smyl_patient_consents c where c.tenant_id = p_tenant and c.patient_id = p_patient)
                          then clock_timestamp() end
  ) actos;
$$;
revoke all on function public.smyl_patient_last_clinical_activity(uuid, uuid) from public, anon, authenticated;

-- Domicilio y CURP (ficha de identificación) desde la sección de antecedentes.
create or replace function public.smyl_set_patient_identification(p_patient_id uuid, p_domicilio text, p_curp text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_curp text := upper(btrim(coalesce(p_curp, '')));
begin
  if v_tenant is null or not (public.smyl_has_permission(v_tenant, 'clinical.write') or public.smyl_has_permission(v_tenant, 'patients.manage'))
     or not exists (select 1 from public.camila_pacientes where tenant_id = v_tenant and id = p_patient_id)
     or not public.smyl_can_access_patient(v_tenant, p_patient_id, 'patients') then
    raise exception using errcode = '42501', message = 'No tienes permiso para editar los datos de este paciente.';
  end if;
  if v_curp <> '' and v_curp !~ '^[A-Z][AEIOUX][A-Z]{2}[0-9]{6}[HMX][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z][0-9]$' then
    raise exception using errcode = '22023', message = 'La CURP no tiene un formato válido (18 caracteres).';
  end if;
  if char_length(btrim(coalesce(p_domicilio, ''))) > 300 then
    raise exception using errcode = '22023', message = 'El domicilio es demasiado largo.';
  end if;
  update public.camila_pacientes set domicilio = btrim(coalesce(p_domicilio, '')), curp = v_curp
   where tenant_id = v_tenant and id = p_patient_id;
end;
$$;
revoke all on function public.smyl_set_patient_identification(uuid, text, text) from public, anon;
grant execute on function public.smyl_set_patient_identification(uuid, text, text) to authenticated;
