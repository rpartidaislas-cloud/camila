-- SMYL · Centro de evidencia clínica multimodal — fundación v1.
-- Nueva capa compatible con el expediente actual. No migra, reescribe ni elimina evidencia previa.
-- Las fuentes radiográficas v2 y los archivos privados existentes se vinculan por referencia; el
-- original conserva su ruta, hash, controles de acceso y ciclo de vida actuales.
begin;

create or replace function public.smyl_evidence_subtype_allowed(p_modality text, p_subtype text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case p_modality
    when 'photograph' then p_subtype = any(array[
      'face_rest','face_smile','face_profile_right','face_profile_left','intraoral_frontal',
      'intraoral_right','intraoral_left','occlusal_upper','occlusal_lower','localized','before_after'])
    when 'radiograph_2d' then p_subtype = any(array[
      'periapical','bitewing','panoramic','occlusal','fmx','cephalometric_lateral',
      'cephalometric_pa','tmj_series','other'])
    when 'scan_model' then p_subtype = any(array[
      'arch_upper','arch_lower','bite','restorative_preparation','study_model','facial_scan','other'])
    when 'clinical_measurement' then p_subtype = any(array[
      'periodontogram','pulp_test','percussion_palpation','bite_test','mobility','occlusion',
      'tmj_exam','soft_tissue_exam','caries_risk','other'])
    when 'document' then p_subtype = any(array[
      'radiology_report','pathology_report','laboratory_report','referral','consent',
      'dental_lab_document','medical_clearance','other'])
    when 'cbct_3d' then p_subtype = any(array['cbct_dicom','medical_ct','mri','other'])
    else false
  end;
$$;

create or replace function public.smyl_evidence_fdi_valid(p_fdi text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select p_fdi ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$';
$$;

-- La geometría es deliberadamente opaca en esta etapa; el visor específico valida su contrato.
create or replace function public.smyl_evidence_anatomy_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare v_scope text; v_fdi text; v_surface text; v_region text;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 8192 then return false; end if;
  if p - array['scope','fdi','surface','regionCode','geometry'] <> '{}'::jsonb then return false; end if;
  v_scope := coalesce(p->>'scope','');
  v_fdi := nullif(p->>'fdi','');
  v_surface := nullif(upper(p->>'surface'),'');
  v_region := nullif(btrim(p->>'regionCode'),'');
  if v_scope not in ('whole_mouth','arch','quadrant','tooth','surface','soft_tissue_region','anatomical_region') then return false; end if;
  if v_fdi is not null and not public.smyl_evidence_fdi_valid(v_fdi) then return false; end if;
  if v_surface is not null and v_surface not in ('M','D','O','I','V','B','L','P','C','R') then return false; end if;
  if coalesce(char_length(v_region),0) > 120 then return false; end if;
  if p ? 'geometry' and p->'geometry' <> 'null'::jsonb and jsonb_typeof(p->'geometry') is distinct from 'object' then return false; end if;
  return case v_scope
    when 'whole_mouth' then v_fdi is null and v_surface is null
    when 'tooth' then v_fdi is not null and v_surface is null
    when 'surface' then v_fdi is not null and v_surface is not null
    when 'arch' then v_fdi is null and v_surface is null and v_region is not null
    when 'quadrant' then v_fdi is null and v_surface is null and v_region is not null
    else v_fdi is null and v_surface is null and v_region is not null
  end;
end;
$$;

create or replace function public.smyl_evidence_quality_valid(p jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare v_flag jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>8192 then return false; end if;
  if coalesce(p->>'status','') not in ('pending','usable','limited','unusable') then return false; end if;
  if jsonb_typeof(coalesce(p->'flags','[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p->'flags','[]'::jsonb))>20 then return false; end if;
  if p ? 'notes' and p->'notes'<>'null'::jsonb
     and (jsonb_typeof(p->'notes') is distinct from 'string' or char_length(p->>'notes')>2000) then return false; end if;
  for v_flag in select value from jsonb_array_elements(coalesce(p->'flags','[]'::jsonb)) loop
    if jsonb_typeof(v_flag) is distinct from 'object' or jsonb_typeof(v_flag->'code') is distinct from 'string'
       or char_length(btrim(coalesce(v_flag->>'code',''))) not between 1 and 80 then return false; end if;
    if v_flag ? 'note' and v_flag->'note'<>'null'::jsonb
       and (jsonb_typeof(v_flag->'note') is distinct from 'string' or char_length(v_flag->>'note')>300) then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function public.smyl_evidence_forbid_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception using errcode = '42501', message = format('%s es inmutable.', tg_table_name);
end;
$$;

revoke all on function public.smyl_evidence_subtype_allowed(text,text),
  public.smyl_evidence_fdi_valid(text), public.smyl_evidence_anatomy_valid(jsonb),
  public.smyl_evidence_quality_valid(jsonb),
  public.smyl_evidence_forbid_change() from public, anon, authenticated;

create table public.smyl_clinical_evidence_studies (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  appointment_id uuid,
  modality text not null check (modality in ('photograph','radiograph_2d','scan_model','clinical_measurement','document','cbct_3d')),
  subtype text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 180),
  clinical_indication text not null default '' check (char_length(clinical_indication) <= 2000),
  acquired_at timestamptz,
  source_provider text not null default '' check (char_length(source_provider) <= 180),
  region jsonb not null default '{}'::jsonb check (jsonb_typeof(region) = 'object' and octet_length(region::text) <= 4096),
  quality jsonb not null default '{"status":"pending","flags":[],"notes":""}'::jsonb check (public.smyl_evidence_quality_valid(quality)),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 32768),
  status text not null default 'draft' check (status in ('draft','ready','under_review','signed','superseded')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, patient_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, appointment_id) references public.smyl_appointments(tenant_id, id),
  check (public.smyl_evidence_subtype_allowed(modality, subtype))
);
create index smyl_clinical_evidence_patient_idx
  on public.smyl_clinical_evidence_studies(tenant_id, patient_id, acquired_at desc nulls last, created_at desc);
create index smyl_clinical_evidence_review_idx
  on public.smyl_clinical_evidence_studies(tenant_id, patient_id, status, modality) where status in ('ready','under_review');

-- Un estudio puede reutilizar un archivo clínico o una fuente radiográfica ya inmutable.
-- Exactamente una de ambas referencias debe estar presente; nunca se duplica la ruta privada.
create table public.smyl_clinical_evidence_assets (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  asset_role text not null check (asset_role in ('original','derived','thumbnail','report','segmentation')),
  patient_file_id uuid,
  radiograph_source_id uuid,
  label text not null default '' check (char_length(label) <= 180),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id) references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade,
  foreign key (tenant_id, patient_file_id) references public.smyl_patient_files(tenant_id, id),
  foreign key (tenant_id, radiograph_source_id) references public.smyl_radiograph_sources(tenant_id, id),
  check ((patient_file_id is not null)::integer + (radiograph_source_id is not null)::integer = 1)
);
create unique index smyl_clinical_evidence_asset_file_unique
  on public.smyl_clinical_evidence_assets(tenant_id, study_id, patient_file_id, asset_role) where patient_file_id is not null;
create unique index smyl_clinical_evidence_asset_radiograph_unique
  on public.smyl_clinical_evidence_assets(tenant_id, study_id, radiograph_source_id, asset_role) where radiograph_source_id is not null;

create table public.smyl_clinical_evidence_anatomy_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  scope text not null check (scope in ('whole_mouth','arch','quadrant','tooth','surface','soft_tissue_region','anatomical_region')),
  fdi text,
  surface text,
  region_code text not null default '' check (char_length(region_code) <= 120),
  geometry jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id) references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade,
  check (public.smyl_evidence_anatomy_valid(jsonb_strip_nulls(jsonb_build_object(
    'scope',scope,'fdi',fdi,'surface',surface,'regionCode',nullif(region_code,''),'geometry',geometry))))
);
create index smyl_clinical_evidence_anatomy_idx
  on public.smyl_clinical_evidence_anatomy_links(tenant_id, patient_id, fdi, surface) where revoked_at is null;

-- Vínculo a otros módulos. El destino conserva su propio RLS y ciclo de vida; esta fila sólo
-- registra la relación clínica y no concede acceso al destino.
create table public.smyl_clinical_evidence_context_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  context_type text not null check (context_type in ('odontogram','periodontogram','clinical_note','treatment_plan','appointment','diagnosis','comparison')),
  context_id uuid not null,
  relationship text not null default 'supports' check (relationship in ('supports','derived_from','compares_with','supersedes')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id) references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade
);
create unique index smyl_clinical_evidence_context_active_unique
  on public.smyl_clinical_evidence_context_links(tenant_id, study_id, context_type, context_id, relationship)
  where revoked_at is null;

-- El hallazgo original es inmutable. Una IA sólo crea un candidato pending; la decisión
-- profesional vive en la tabla append-only de decisiones.
create table public.smyl_clinical_evidence_findings (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  origin text not null check (origin in ('professional','ai','imported')),
  category text not null check (category in ('quality','anatomy','caries_candidate','restoration','periodontal_support','endodontic','periapical','pathology','implant','orthodontic','trauma','prosthetic','temporomandibular','development','soft_tissue','occlusion','other')),
  evidence_level text not null check (evidence_level in ('clinical_observation','measurement','image_observation','report_extract','model_candidate')),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  anatomy jsonb not null default '{"scope":"whole_mouth"}'::jsonb check (public.smyl_evidence_anatomy_valid(anatomy)),
  confidence numeric(6,5),
  initial_state text not null check (initial_state in ('pending','confirmed')),
  model jsonb,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  created_by uuid not null references auth.users(id),
  created_professional_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, patient_id, study_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id) references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade,
  foreign key (tenant_id, created_professional_id) references public.smyl_professionals(tenant_id, id),
  check (confidence is null or confidence between 0 and 1),
  check ((origin = 'ai' and initial_state = 'pending' and confidence is not null and model is not null and jsonb_typeof(model) = 'object'
      and octet_length(model::text) <= 4096
      and jsonb_typeof(model->'provider') = 'string' and jsonb_typeof(model->'name') = 'string'
      and char_length(btrim(coalesce(model->>'provider',''))) between 1 and 60
      and char_length(btrim(coalesce(model->>'name',''))) between 1 and 100 and created_professional_id is null)
      or (origin = 'professional' and confidence is null and model is null and initial_state = 'confirmed' and created_professional_id is not null)
      or (origin = 'imported' and confidence is null and model is null and initial_state = 'pending' and created_professional_id is null))
);
create index smyl_clinical_evidence_findings_study_idx
  on public.smyl_clinical_evidence_findings(tenant_id, study_id, created_at);

create table public.smyl_clinical_evidence_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  finding_id uuid not null,
  revision integer not null check (revision > 0),
  state text not null check (state in ('confirmed','corrected','rejected')),
  correction jsonb not null default '{}'::jsonb check (jsonb_typeof(correction) = 'object' and octet_length(correction::text) <= 16384),
  note text not null default '' check (char_length(note) <= 1000),
  decided_by uuid not null references auth.users(id),
  decided_professional_id uuid not null,
  decided_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, finding_id, revision),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id) references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id, finding_id) references public.smyl_clinical_evidence_findings(tenant_id, patient_id, study_id, id) on delete cascade,
  foreign key (tenant_id, decided_professional_id) references public.smyl_professionals(tenant_id, id),
  check ((state = 'corrected' and correction <> '{}'::jsonb) or (state <> 'corrected' and correction = '{}'::jsonb))
);
create index smyl_clinical_evidence_decisions_latest_idx
  on public.smyl_clinical_evidence_decisions(tenant_id, finding_id, revision desc);

create table public.smyl_clinical_evidence_reports (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  status text not null default 'draft' check (status in ('draft','signed')),
  revision integer not null default 1 check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 65536),
  signed_findings jsonb not null default '[]'::jsonb check (jsonb_typeof(signed_findings) = 'array'),
  signed_hash text check (signed_hash is null or signed_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  signed_by uuid references auth.users(id),
  signed_professional_id uuid,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, patient_id, id),
  unique (tenant_id, study_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id) references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade,
  foreign key (tenant_id, signed_professional_id) references public.smyl_professionals(tenant_id, id),
  check ((status = 'signed' and signed_by is not null and signed_professional_id is not null and signed_at is not null and signed_hash is not null)
      or (status = 'draft' and signed_by is null and signed_professional_id is null and signed_at is null and signed_hash is null))
);

create table public.smyl_clinical_evidence_report_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  report_id uuid not null,
  revision integer not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, report_id, revision),
  foreign key (tenant_id, patient_id, report_id) references public.smyl_clinical_evidence_reports(tenant_id, patient_id, id) on delete cascade
);

create table public.smyl_clinical_evidence_report_addenda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  report_id uuid not null,
  content text not null check (char_length(btrim(content)) between 2 and 8000),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references auth.users(id),
  created_professional_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, report_id) references public.smyl_clinical_evidence_reports(tenant_id, patient_id, id) on delete cascade,
  foreign key (tenant_id, created_professional_id) references public.smyl_professionals(tenant_id, id)
);

create table public.smyl_clinical_evidence_access_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  action text not null check (action in ('create','update','attach','link','revoke','supersede','open','finding','decide','report_draft','sign_report','addendum','compare','export')),
  actor_id uuid,
  actor_professional_id uuid,
  reference_id uuid,
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_professional_id) references public.smyl_professionals(tenant_id, id),
  foreign key (tenant_id, patient_id, study_id) references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade
);
create index smyl_clinical_evidence_access_idx
  on public.smyl_clinical_evidence_access_events(tenant_id, study_id, created_at desc);

-- Evidencia primaria, candidatos, decisiones y versiones nunca se reescriben.
do $$ declare v_table text;
begin
  foreach v_table in array array[
    'smyl_clinical_evidence_assets','smyl_clinical_evidence_findings','smyl_clinical_evidence_decisions',
    'smyl_clinical_evidence_report_versions','smyl_clinical_evidence_report_addenda',
    'smyl_clinical_evidence_access_events'
  ] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.smyl_evidence_forbid_change()', v_table || '_immutable', v_table);
  end loop;
end $$;

create or replace function public.smyl_evidence_guard_link_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception using errcode = '42501', message = 'Los vínculos clínicos no se borran; se revocan.';
  end if;
  if old.revoked_at is null and new.revoked_at is not null
     and new.revoked_by is not null
     and (to_jsonb(new) - 'revoked_at' - 'revoked_by') = (to_jsonb(old) - 'revoked_at' - 'revoked_by') then return new; end if;
  raise exception using errcode = '42501', message = 'Un vínculo clínico sólo puede revocarse una vez.';
end;
$$;

create or replace function public.smyl_evidence_guard_signed_report()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op='DELETE' then
    if pg_trigger_depth()>1 then return old; end if;
    raise exception using errcode='42501',message='Los informes clínicos no se borran.';
  end if;
  if old.status='signed' then
    raise exception using errcode='42501',message='Un informe firmado es inmutable; registra una adenda.'; end if;
  return new;
end;
$$;

create or replace function public.smyl_evidence_guard_child_insert()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_status text;
begin
  select status into v_status from public.smyl_clinical_evidence_studies
    where tenant_id=new.tenant_id and patient_id=new.patient_id and id=new.study_id for key share;
  if v_status is null then raise exception using errcode='23503',message='El estudio clínico no existe.'; end if;
  if v_status in ('signed','superseded') then
    raise exception using errcode='23514',message='Un estudio final no admite evidencia ni decisiones nuevas.'; end if;
  return new;
end;
$$;

create or replace function public.smyl_evidence_guard_study_update()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status='superseded' then
    raise exception using errcode='42501',message='Un estudio sustituido es inmutable.'; end if;
  if old.status='signed' then
    if new.status='superseded'
       and (to_jsonb(new)-array['status','revision','updated_by','updated_at'])=(to_jsonb(old)-array['status','revision','updated_by','updated_at']) then return new; end if;
    raise exception using errcode='42501',message='Un estudio firmado sólo puede marcarse como sustituido.';
  end if;
  if new.status='signed' and not exists(select 1 from public.smyl_clinical_evidence_reports r
      where r.tenant_id=new.tenant_id and r.patient_id=new.patient_id and r.study_id=new.id and r.status='signed') then
    raise exception using errcode='23514',message='El estudio sólo se firma junto con su informe.'; end if;
  return new;
end;
$$;
create trigger smyl_clinical_evidence_anatomy_links_guard before update or delete on public.smyl_clinical_evidence_anatomy_links
  for each row execute function public.smyl_evidence_guard_link_change();
create trigger smyl_clinical_evidence_context_links_guard before update or delete on public.smyl_clinical_evidence_context_links
  for each row execute function public.smyl_evidence_guard_link_change();
create trigger smyl_clinical_evidence_reports_guard before update or delete on public.smyl_clinical_evidence_reports
  for each row execute function public.smyl_evidence_guard_signed_report();
create trigger smyl_clinical_evidence_studies_guard before update on public.smyl_clinical_evidence_studies
  for each row execute function public.smyl_evidence_guard_study_update();
do $$ declare v_table text;
begin
  foreach v_table in array array['smyl_clinical_evidence_assets','smyl_clinical_evidence_anatomy_links',
    'smyl_clinical_evidence_context_links','smyl_clinical_evidence_findings','smyl_clinical_evidence_decisions'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.smyl_evidence_guard_child_insert()',
      v_table || '_parent_guard',v_table);
  end loop;
end $$;

-- Auditoría general sin copiar indicaciones, hallazgos, informes ni rutas privadas.
create or replace function public.smyl_evidence_audit_lean()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
begin
  insert into public.smyl_audit_events(tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values ((v_row->>'tenant_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, coalesce(v_row->>'id',''),
    jsonb_strip_nulls(jsonb_build_object('patient_id',v_row->'patient_id','study_id',coalesce(v_row->'study_id',v_row->'id'),
      'status',v_row->'status','revision',v_row->'revision','modality',v_row->'modality','subtype',v_row->'subtype')));
  return new;
end;
$$;
revoke all on function public.smyl_evidence_guard_link_change(), public.smyl_evidence_guard_signed_report(),
  public.smyl_evidence_guard_child_insert(), public.smyl_evidence_guard_study_update(),
  public.smyl_evidence_audit_lean() from public, anon, authenticated;
create trigger smyl_clinical_evidence_studies_audit after insert or update on public.smyl_clinical_evidence_studies
  for each row execute function public.smyl_evidence_audit_lean();
create trigger smyl_clinical_evidence_reports_audit after insert or update on public.smyl_clinical_evidence_reports
  for each row execute function public.smyl_evidence_audit_lean();

do $$ declare v_table text;
begin
  foreach v_table in array array[
    'smyl_clinical_evidence_studies','smyl_clinical_evidence_assets','smyl_clinical_evidence_anatomy_links',
    'smyl_clinical_evidence_context_links','smyl_clinical_evidence_findings','smyl_clinical_evidence_decisions',
    'smyl_clinical_evidence_reports','smyl_clinical_evidence_report_versions',
    'smyl_clinical_evidence_report_addenda','smyl_clinical_evidence_access_events'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated', v_table);
    execute format('revoke truncate on public.%I from service_role', v_table);
    execute format('grant select on public.%I to authenticated', v_table);
  end loop;
end $$;

create policy smyl_clinical_evidence_studies_read on public.smyl_clinical_evidence_studies for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_assets_read on public.smyl_clinical_evidence_assets for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_anatomy_links_read on public.smyl_clinical_evidence_anatomy_links for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_context_links_read on public.smyl_clinical_evidence_context_links for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_findings_read on public.smyl_clinical_evidence_findings for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_decisions_read on public.smyl_clinical_evidence_decisions for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_reports_read on public.smyl_clinical_evidence_reports for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_report_versions_read on public.smyl_clinical_evidence_report_versions for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_report_addenda_read on public.smyl_clinical_evidence_report_addenda for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read') and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));
create policy smyl_clinical_evidence_access_events_read on public.smyl_clinical_evidence_access_events for select to authenticated
  using (public.smyl_has_permission(tenant_id,'audit.read'));

create or replace function public.smyl_evidence_guard(p_patient_id uuid, p_permission text)
returns uuid language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,p_permission) then
    raise exception using errcode = '42501', message = 'No tienes permiso para esta acción clínica.';
  end if;
  if not exists(select 1 from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = p_patient_id)
     or not public.smyl_can_access_patient(v_tenant,p_patient_id,'clinical') then
    raise exception using errcode = '42501', message = 'El paciente no está disponible para tu rol.';
  end if;
  return v_tenant;
end;
$$;

create or replace function public.smyl_evidence_log_event(p_tenant uuid,p_patient uuid,p_study uuid,p_action text,p_reference uuid default null)
returns void language sql security definer set search_path = pg_catalog, public as $$
  insert into public.smyl_clinical_evidence_access_events(tenant_id,patient_id,study_id,action,actor_id,actor_professional_id,reference_id)
  values(p_tenant,p_patient,p_study,p_action,auth.uid(),public.smyl_current_professional_id(p_tenant),p_reference);
$$;
revoke all on function public.smyl_evidence_guard(uuid,text), public.smyl_evidence_log_event(uuid,uuid,uuid,text,uuid)
  from public, anon, authenticated;

create or replace function public.smyl_evidence_create_study(
  p_id uuid,p_patient_id uuid,p_appointment_id uuid,p_modality text,p_subtype text,p_display_name text,
  p_clinical_indication text default '',p_acquired_at timestamptz default null,p_source_provider text default '',
  p_region jsonb default '{}'::jsonb,p_metadata jsonb default '{}'::jsonb
) returns public.smyl_clinical_evidence_studies
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_evidence_guard(p_patient_id,'clinical.write'); v_row public.smyl_clinical_evidence_studies;
begin
  if p_id is null then raise exception using errcode='22023',message='Falta el identificador del estudio.'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.smyl_appointments a where a.tenant_id=v_tenant and a.id=p_appointment_id and a.patient_id=p_patient_id) then
    raise exception using errcode='23514',message='La cita no pertenece al paciente.'; end if;
  select * into v_row from public.smyl_clinical_evidence_studies where tenant_id=v_tenant and id=p_id;
  if found then
    if v_row.patient_id <> p_patient_id then raise exception using errcode='22023',message='Identificador no disponible.'; end if;
    return v_row;
  end if;
  if exists(select 1 from public.smyl_clinical_evidence_studies where id=p_id) then raise exception using errcode='22023',message='Identificador no disponible.'; end if;
  insert into public.smyl_clinical_evidence_studies(id,tenant_id,patient_id,appointment_id,modality,subtype,display_name,
    clinical_indication,acquired_at,source_provider,region,metadata,created_by,updated_by)
  values(p_id,v_tenant,p_patient_id,p_appointment_id,p_modality,p_subtype,btrim(p_display_name),coalesce(p_clinical_indication,''),
    p_acquired_at,coalesce(p_source_provider,''),coalesce(p_region,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb),auth.uid(),auth.uid()) returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,p_patient_id,p_id,'create',p_id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_update_study(
  p_id uuid,p_expected_revision integer,p_modality text,p_subtype text,p_display_name text,p_clinical_indication text,
  p_acquired_at timestamptz,p_source_provider text,p_region jsonb,p_quality jsonb,p_metadata jsonb,p_status text
) returns public.smyl_clinical_evidence_studies
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.smyl_clinical_evidence_studies; v_tenant uuid;
begin
  select * into v_row from public.smyl_clinical_evidence_studies where tenant_id=public.smyl_current_tenant() and id=p_id for update;
  if not found then raise exception using errcode='42501',message='El estudio no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_row.patient_id,'clinical.write');
  if v_row.status in ('signed','superseded') then raise exception using errcode='23514',message='Un estudio firmado no se modifica; registra una adenda o un nuevo estudio.'; end if;
  if v_row.revision is distinct from p_expected_revision then raise exception using errcode='PT409',message='El estudio cambió en otra sesión. Actualiza la ficha.'; end if;
  if p_status not in ('draft','ready','under_review') then raise exception using errcode='22023',message='Estado del estudio no válido.'; end if;
  update public.smyl_clinical_evidence_studies set modality=p_modality,subtype=p_subtype,display_name=btrim(p_display_name),
    clinical_indication=coalesce(p_clinical_indication,''),acquired_at=p_acquired_at,source_provider=coalesce(p_source_provider,''),
    region=coalesce(p_region,v_row.region),quality=coalesce(p_quality,v_row.quality),metadata=coalesce(p_metadata,v_row.metadata),
    status=p_status,revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
  where tenant_id=v_tenant and id=p_id returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,v_row.patient_id,p_id,'update',p_id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_attach_asset(
  p_asset_id uuid,p_study_id uuid,p_asset_role text,p_patient_file_id uuid default null,
  p_radiograph_source_id uuid default null,p_label text default ''
) returns public.smyl_clinical_evidence_assets
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_study public.smyl_clinical_evidence_studies; v_tenant uuid; v_row public.smyl_clinical_evidence_assets;
begin
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=public.smyl_current_tenant() and id=p_study_id for update;
  if not found then raise exception using errcode='42501',message='El estudio no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_study.patient_id,'clinical.write');
  if v_study.status in ('signed','superseded') then raise exception using errcode='23514',message='No se agregan archivos a un estudio firmado.'; end if;
  if (p_patient_file_id is not null)::integer + (p_radiograph_source_id is not null)::integer <> 1 then
    raise exception using errcode='22023',message='Selecciona un único archivo original.'; end if;
  if p_patient_file_id is not null and not exists(select 1 from public.smyl_patient_files f where f.tenant_id=v_tenant and f.id=p_patient_file_id and f.patient_id=v_study.patient_id) then
    raise exception using errcode='42501',message='El archivo no pertenece a este expediente.'; end if;
  if p_radiograph_source_id is not null and not exists(select 1 from public.smyl_radiograph_sources s where s.tenant_id=v_tenant and s.id=p_radiograph_source_id and s.patient_id=v_study.patient_id) then
    raise exception using errcode='42501',message='La fuente radiográfica no pertenece a este expediente.'; end if;
  select * into v_row from public.smyl_clinical_evidence_assets where tenant_id=v_tenant and id=p_asset_id;
  if found then
    if v_row.patient_id<>v_study.patient_id or v_row.study_id<>p_study_id then
      raise exception using errcode='22023',message='Identificador no disponible.'; end if;
    return v_row;
  end if;
  if exists(select 1 from public.smyl_clinical_evidence_assets where id=p_asset_id) then
    raise exception using errcode='22023',message='Identificador no disponible.'; end if;
  insert into public.smyl_clinical_evidence_assets(id,tenant_id,patient_id,study_id,asset_role,patient_file_id,radiograph_source_id,label,created_by)
  values(p_asset_id,v_tenant,v_study.patient_id,p_study_id,p_asset_role,p_patient_file_id,p_radiograph_source_id,coalesce(p_label,''),auth.uid()) returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,v_study.patient_id,p_study_id,'attach',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_link_anatomy(
  p_study_id uuid,p_scope text,p_fdi text default null,p_surface text default null,
  p_region_code text default '',p_geometry jsonb default null
) returns public.smyl_clinical_evidence_anatomy_links
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_study public.smyl_clinical_evidence_studies; v_tenant uuid; v_row public.smyl_clinical_evidence_anatomy_links; v_anatomy jsonb;
begin
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=public.smyl_current_tenant() and id=p_study_id for update;
  if not found then raise exception using errcode='42501',message='El estudio no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_study.patient_id,'clinical.write');
  if v_study.status in ('signed','superseded') then raise exception using errcode='23514',message='No se cambia la anatomía de un estudio firmado.'; end if;
  v_anatomy := jsonb_strip_nulls(jsonb_build_object('scope',p_scope,'fdi',nullif(p_fdi,''),'surface',nullif(upper(p_surface),''),
    'regionCode',nullif(btrim(coalesce(p_region_code,'')),''),'geometry',p_geometry));
  if not public.smyl_evidence_anatomy_valid(v_anatomy) then raise exception using errcode='22023',message='El vínculo anatómico no es válido.'; end if;
  insert into public.smyl_clinical_evidence_anatomy_links(tenant_id,patient_id,study_id,scope,fdi,surface,region_code,geometry,created_by)
  values(v_tenant,v_study.patient_id,p_study_id,p_scope,nullif(p_fdi,''),nullif(upper(p_surface),''),coalesce(p_region_code,''),p_geometry,auth.uid()) returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,v_study.patient_id,p_study_id,'link',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_link_context(
  p_study_id uuid,p_context_type text,p_context_id uuid,p_relationship text default 'supports'
) returns public.smyl_clinical_evidence_context_links
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_study public.smyl_clinical_evidence_studies; v_tenant uuid; v_row public.smyl_clinical_evidence_context_links;
begin
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=public.smyl_current_tenant() and id=p_study_id for update;
  if not found then raise exception using errcode='42501',message='El estudio no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_study.patient_id,'clinical.write');
  if v_study.status in ('signed','superseded') then raise exception using errcode='23514',message='No se cambia el contexto de un estudio firmado.'; end if;
  if p_context_id is null or p_context_type not in ('odontogram','periodontogram','clinical_note','treatment_plan','appointment','diagnosis','comparison')
     or p_relationship not in ('supports','derived_from','compares_with','supersedes') then
    raise exception using errcode='22023',message='El vínculo de contexto no es válido.'; end if;
  if p_relationship='supersedes' then
    raise exception using errcode='22023',message='La sustitución de estudios usa su acción clínica dedicada.'; end if;
  -- Every polymorphic target is resolved server-side before the link is stored.
  -- Patient-level singletons (odontogram and treatment plan) use patient_id as
  -- their canonical record identifier. Unsupported targets stay closed rather
  -- than accepting an arbitrary UUID and corrupting the clinical graph.
  if p_context_type='comparison' then
    if not exists(select 1 from public.smyl_clinical_evidence_studies s
        where s.tenant_id=v_tenant and s.patient_id=v_study.patient_id and s.id=p_context_id) then
      raise exception using errcode='22023',message='El estudio comparado no pertenece a este expediente.'; end if;
  elsif p_context_type='appointment' then
    if not exists(select 1 from public.smyl_appointments a
        where a.tenant_id=v_tenant and a.patient_id=v_study.patient_id and a.id=p_context_id) then
      raise exception using errcode='22023',message='La cita vinculada no pertenece a este expediente.'; end if;
  elsif p_context_type='clinical_note' then
    if not exists(select 1 from public.smyl_clinical_notes n
        where n.tenant_id=v_tenant and n.patient_id=v_study.patient_id and n.id=p_context_id) then
      raise exception using errcode='22023',message='La nota clínica vinculada no pertenece a este expediente.'; end if;
  elsif p_context_type='odontogram' then
    if p_context_id is distinct from v_study.patient_id or not exists(select 1 from public.smyl_dental_records d
        where d.tenant_id=v_tenant and d.patient_id=v_study.patient_id) then
      raise exception using errcode='22023',message='El odontograma vinculado no pertenece a este expediente.'; end if;
  elsif p_context_type='treatment_plan' then
    if p_context_id is distinct from v_study.patient_id or not exists(select 1 from public.smyl_clinical_plans p
        where p.tenant_id=v_tenant and p.patient_id=v_study.patient_id) then
      raise exception using errcode='22023',message='El plan vinculado no pertenece a este expediente.'; end if;
  elsif p_context_type in ('periodontogram','diagnosis') then
    raise exception using errcode='0A000',message='Este tipo de contexto no tiene todavía un almacén clínico canónico y permanece deshabilitado.';
  end if;
  select * into v_row from public.smyl_clinical_evidence_context_links
    where tenant_id=v_tenant and study_id=p_study_id and context_type=p_context_type
      and context_id=p_context_id and relationship=p_relationship and revoked_at is null;
  if found then return v_row; end if;
  insert into public.smyl_clinical_evidence_context_links(tenant_id,patient_id,study_id,context_type,context_id,relationship,created_by)
  values(v_tenant,v_study.patient_id,p_study_id,p_context_type,p_context_id,p_relationship,auth.uid()) returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,v_study.patient_id,p_study_id,'link',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_revoke_link(p_link_kind text,p_link_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_patient uuid; v_study uuid; v_status text;
begin
  if p_link_kind = 'anatomy' then
    select l.patient_id,l.study_id,s.status into v_patient,v_study,v_status
      from public.smyl_clinical_evidence_anatomy_links l
      join public.smyl_clinical_evidence_studies s on s.tenant_id=l.tenant_id and s.id=l.study_id
      where l.tenant_id=v_tenant and l.id=p_link_id and l.revoked_at is null for update of l,s;
  elsif p_link_kind = 'context' then
    select l.patient_id,l.study_id,s.status into v_patient,v_study,v_status
      from public.smyl_clinical_evidence_context_links l
      join public.smyl_clinical_evidence_studies s on s.tenant_id=l.tenant_id and s.id=l.study_id
      where l.tenant_id=v_tenant and l.id=p_link_id and l.revoked_at is null for update of l,s;
  else
    raise exception using errcode='22023',message='El tipo de vínculo no es válido.';
  end if;
  if v_patient is null then raise exception using errcode='42501',message='El vínculo no está disponible.'; end if;
  perform public.smyl_evidence_guard(v_patient,'clinical.write');
  if v_status in ('signed','superseded') then raise exception using errcode='23514',message='No se cambia un estudio firmado.'; end if;
  if p_link_kind = 'anatomy' then
    update public.smyl_clinical_evidence_anatomy_links set revoked_at=clock_timestamp(),revoked_by=auth.uid()
      where tenant_id=v_tenant and id=p_link_id and revoked_at is null;
  else
    update public.smyl_clinical_evidence_context_links set revoked_at=clock_timestamp(),revoked_by=auth.uid()
      where tenant_id=v_tenant and id=p_link_id and revoked_at is null;
  end if;
  perform public.smyl_evidence_log_event(v_tenant,v_patient,v_study,'revoke',p_link_id);
end;
$$;

create or replace function public.smyl_evidence_supersede_study(p_previous_study_id uuid,p_replacement_study_id uuid)
returns public.smyl_clinical_evidence_studies
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_previous public.smyl_clinical_evidence_studies;
  v_replacement public.smyl_clinical_evidence_studies; v_professional uuid;
begin
  if p_previous_study_id is null or p_replacement_study_id is null or p_previous_study_id=p_replacement_study_id then
    raise exception using errcode='22023',message='Selecciona dos estudios distintos.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('evidence-supersede:'||least(p_previous_study_id::text,p_replacement_study_id::text)
    ||':'||greatest(p_previous_study_id::text,p_replacement_study_id::text),31));
  perform 1 from public.smyl_clinical_evidence_studies
    where tenant_id=v_tenant and id in (p_previous_study_id,p_replacement_study_id)
    order by id for update;
  select * into v_previous from public.smyl_clinical_evidence_studies
    where tenant_id=v_tenant and id=p_previous_study_id;
  select * into v_replacement from public.smyl_clinical_evidence_studies
    where tenant_id=v_tenant and id=p_replacement_study_id;
  if v_previous.id is null or v_replacement.id is null or v_previous.patient_id<>v_replacement.patient_id then
    raise exception using errcode='42501',message='Los estudios no están disponibles en el mismo expediente.';
  end if;
  perform public.smyl_evidence_guard(v_previous.patient_id,'clinical.approve');
  v_professional := public.smyl_current_professional_id(v_tenant);
  if v_professional is null then
    raise exception using errcode='23514',message='Sólo un profesional clínico registrado puede sustituir un estudio.'; end if;
  if v_previous.status='superseded' then
    if exists(select 1 from public.smyl_clinical_evidence_context_links l where l.tenant_id=v_tenant
        and l.patient_id=v_previous.patient_id and l.study_id=p_replacement_study_id and l.context_type='comparison'
        and l.context_id=p_previous_study_id and l.relationship='supersedes' and l.revoked_at is null) then return v_previous; end if;
    raise exception using errcode='PT409',message='El estudio ya fue sustituido por otra versión.';
  end if;
  if v_replacement.status in ('signed','superseded') then
    raise exception using errcode='23514',message='El estudio sustituto debe permanecer editable.'; end if;
  insert into public.smyl_clinical_evidence_context_links(tenant_id,patient_id,study_id,context_type,context_id,relationship,created_by)
  values(v_tenant,v_previous.patient_id,p_replacement_study_id,'comparison',p_previous_study_id,'supersedes',auth.uid())
  on conflict (tenant_id,study_id,context_type,context_id,relationship) where revoked_at is null do nothing;
  update public.smyl_clinical_evidence_studies set status='superseded',revision=revision+1,
    updated_by=auth.uid(),updated_at=clock_timestamp()
    where tenant_id=v_tenant and id=p_previous_study_id returning * into v_previous;
  perform public.smyl_evidence_log_event(v_tenant,v_previous.patient_id,p_previous_study_id,'supersede',p_replacement_study_id);
  return v_previous;
end;
$$;

create or replace function public.smyl_evidence_create_finding(
  p_id uuid,p_study_id uuid,p_origin text,p_category text,p_evidence_level text,p_label text,p_description text,
  p_anatomy jsonb,p_confidence numeric default null,p_initial_state text default null,p_model jsonb default null,p_payload jsonb default '{}'::jsonb
) returns public.smyl_clinical_evidence_findings
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_study public.smyl_clinical_evidence_studies; v_tenant uuid; v_professional uuid;
  v_row public.smyl_clinical_evidence_findings; v_initial text;
begin
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=public.smyl_current_tenant() and id=p_study_id for update;
  if not found then raise exception using errcode='42501',message='El estudio no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_study.patient_id,'clinical.write');
  if v_study.status in ('signed','superseded') then raise exception using errcode='23514',message='Un estudio firmado sólo admite adendas.'; end if;
  if p_origin='ai' then
    raise exception using errcode='42501',message='Las sugerencias de IA sólo se registran desde un backend clínico verificado.'; end if;
  if p_origin='professional' then
    perform public.smyl_evidence_guard(v_study.patient_id,'clinical.approve');
    v_professional := public.smyl_current_professional_id(v_tenant);
    if v_professional is null then
      raise exception using errcode='23514',message='Sólo un profesional clínico registrado puede confirmar un hallazgo.'; end if;
  end if;
  v_initial := coalesce(p_initial_state,case when p_origin='professional' then 'confirmed' else 'pending' end);
  if p_origin='imported' and v_initial<>'pending' then
    raise exception using errcode='22023',message='Un hallazgo importado requiere revisión profesional.'; end if;
  select * into v_row from public.smyl_clinical_evidence_findings where tenant_id=v_tenant and id=p_id;
  if found then
    if v_row.patient_id<>v_study.patient_id or v_row.study_id<>p_study_id then
      raise exception using errcode='22023',message='Identificador no disponible.'; end if;
    return v_row;
  end if;
  if exists(select 1 from public.smyl_clinical_evidence_findings where id=p_id) then
    raise exception using errcode='22023',message='Identificador no disponible.'; end if;
  insert into public.smyl_clinical_evidence_findings(id,tenant_id,patient_id,study_id,origin,category,evidence_level,label,description,
    anatomy,confidence,initial_state,model,payload,created_by,created_professional_id)
  values(p_id,v_tenant,v_study.patient_id,p_study_id,p_origin,p_category,p_evidence_level,btrim(p_label),coalesce(p_description,''),
    coalesce(p_anatomy,'{"scope":"whole_mouth"}'::jsonb),p_confidence,v_initial,p_model,coalesce(p_payload,'{}'::jsonb),auth.uid(),v_professional) returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,v_study.patient_id,p_study_id,'finding',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_decide_finding(
  p_finding_id uuid,p_expected_revision integer,p_state text,p_correction jsonb default '{}'::jsonb,p_note text default ''
) returns public.smyl_clinical_evidence_decisions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_finding public.smyl_clinical_evidence_findings; v_study public.smyl_clinical_evidence_studies;
  v_tenant uuid; v_revision integer; v_professional uuid; v_row public.smyl_clinical_evidence_decisions;
  v_correction jsonb := coalesce(p_correction,'{}'::jsonb);
begin
  select * into v_finding from public.smyl_clinical_evidence_findings where tenant_id=public.smyl_current_tenant() and id=p_finding_id;
  if not found then raise exception using errcode='42501',message='El hallazgo no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_finding.patient_id,'clinical.approve');
  v_professional := public.smyl_current_professional_id(v_tenant);
  if v_professional is null then
    raise exception using errcode='23514',message='Sólo un profesional clínico registrado puede decidir un hallazgo.'; end if;
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=v_tenant and id=v_finding.study_id for update;
  if v_study.status in ('signed','superseded') then raise exception using errcode='23514',message='El hallazgo pertenece a un estudio firmado; registra una adenda.'; end if;
  if p_state not in ('confirmed','corrected','rejected') or jsonb_typeof(v_correction) is distinct from 'object'
     or octet_length(v_correction::text)>16384 or char_length(coalesce(p_note,''))>1000 then
    raise exception using errcode='22023',message='La decisión profesional no es válida.'; end if;
  if (p_state='corrected' and v_correction='{}'::jsonb) or (p_state<>'corrected' and v_correction<>'{}'::jsonb) then
    raise exception using errcode='22023',message='Sólo una corrección lleva datos modificados.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('evidence-decision:'||p_finding_id::text,31));
  select coalesce(max(revision),0) into v_revision from public.smyl_clinical_evidence_decisions
    where tenant_id=v_tenant and finding_id=p_finding_id;
  if v_revision is distinct from p_expected_revision then
    raise exception using errcode='PT409',message='El hallazgo cambió en otra sesión. Actualiza la revisión.'; end if;
  v_revision := v_revision+1;
  insert into public.smyl_clinical_evidence_decisions(tenant_id,patient_id,study_id,finding_id,revision,state,correction,note,decided_by,decided_professional_id)
  values(v_tenant,v_finding.patient_id,v_finding.study_id,p_finding_id,v_revision,p_state,v_correction,coalesce(p_note,''),auth.uid(),v_professional) returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,v_finding.patient_id,v_finding.study_id,'decide',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_validate_report(p jsonb,p_strict boolean default false)
returns void language plpgsql immutable set search_path = pg_catalog, public as $$
declare v_id text;
begin
  if jsonb_typeof(p) is distinct from 'object' or p - array['schema','summary','technicalLimitations','clinicalCorrelation','recommendations','findingIds'] <> '{}'::jsonb
     or not (p ?& array['schema','summary','technicalLimitations','clinicalCorrelation','recommendations','findingIds'])
     or p->'schema' <> '1'::jsonb or jsonb_typeof(p->'findingIds') is distinct from 'array'
     or jsonb_typeof(p->'summary') is distinct from 'string'
     or jsonb_typeof(p->'technicalLimitations') is distinct from 'string'
     or jsonb_typeof(p->'clinicalCorrelation') is distinct from 'string'
     or jsonb_typeof(p->'recommendations') is distinct from 'string'
     or jsonb_array_length(p->'findingIds') > 200 or octet_length(p::text) > 65536 then
    raise exception using errcode='22023',message='El informe clínico no es válido.'; end if;
  if char_length(coalesce(p->>'summary',''))>8000 or char_length(coalesce(p->>'technicalLimitations',''))>8000
     or char_length(coalesce(p->>'clinicalCorrelation',''))>8000 or char_length(coalesce(p->>'recommendations',''))>8000 then
    raise exception using errcode='22023',message='Una sección del informe es demasiado larga.'; end if;
  if p_strict and char_length(btrim(coalesce(p->>'summary','')))<2 then
    raise exception using errcode='23514',message='Completa el resumen profesional antes de firmar.'; end if;
  for v_id in select jsonb_array_elements_text(p->'findingIds') loop
    if v_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
      raise exception using errcode='22023',message='El informe contiene un identificador de hallazgo no válido.'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements_text(p->'findingIds')) <>
     (select count(distinct f.value) from jsonb_array_elements_text(p->'findingIds') as f(value)) then
    raise exception using errcode='22023',message='El informe contiene hallazgos repetidos.'; end if;
end;
$$;

create or replace function public.smyl_evidence_report_hash(p jsonb)
returns text language sql immutable set search_path = pg_catalog as $$
  select encode(sha256(convert_to(p::text,'UTF8')),'hex');
$$;
revoke all on function public.smyl_evidence_validate_report(jsonb,boolean), public.smyl_evidence_report_hash(jsonb)
  from public, anon, authenticated;

create or replace function public.smyl_evidence_save_report_draft(
  p_report_id uuid,p_study_id uuid,p_expected_revision integer,p_document jsonb
) returns public.smyl_clinical_evidence_reports
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_study public.smyl_clinical_evidence_studies; v_tenant uuid; v_old public.smyl_clinical_evidence_reports; v_row public.smyl_clinical_evidence_reports;
begin
  if p_expected_revision is null then
    raise exception using errcode='PT409',message='Indica la revisión esperada del informe.'; end if;
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=public.smyl_current_tenant() and id=p_study_id for update;
  if not found then raise exception using errcode='42501',message='El estudio no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_study.patient_id,'clinical.write');
  if v_study.status in ('signed','superseded') then raise exception using errcode='23514',message='Un estudio firmado sólo admite adendas.'; end if;
  perform public.smyl_evidence_validate_report(p_document,false);
  if exists(select 1 from jsonb_array_elements_text(p_document->'findingIds') x
    where not exists(select 1 from public.smyl_clinical_evidence_findings f where f.tenant_id=v_tenant and f.study_id=p_study_id and f.id=x.value::uuid)) then
    raise exception using errcode='22023',message='El informe referencia hallazgos de otro estudio.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('evidence-report:'||p_study_id::text,31));
  select * into v_old from public.smyl_clinical_evidence_reports where tenant_id=v_tenant and study_id=p_study_id for update;
  if not found then
    if p_expected_revision<>0 then raise exception using errcode='PT409',message='El informe no existe con esa revisión.'; end if;
    insert into public.smyl_clinical_evidence_reports(id,tenant_id,patient_id,study_id,document,created_by,updated_by)
    values(p_report_id,v_tenant,v_study.patient_id,p_study_id,p_document,auth.uid(),auth.uid()) returning * into v_row;
  else
    if v_old.id<>p_report_id or v_old.status='signed' then raise exception using errcode='23514',message='El informe firmado sólo admite adendas.'; end if;
    if v_old.revision is distinct from p_expected_revision then raise exception using errcode='PT409',message='El informe cambió en otra sesión. Actualiza la revisión.'; end if;
    update public.smyl_clinical_evidence_reports set revision=revision+1,document=p_document,updated_by=auth.uid(),updated_at=clock_timestamp()
    where tenant_id=v_tenant and id=p_report_id returning * into v_row;
  end if;
  insert into public.smyl_clinical_evidence_report_versions(tenant_id,patient_id,report_id,revision,snapshot,actor_id)
  values(v_tenant,v_row.patient_id,v_row.id,v_row.revision,to_jsonb(v_row)-'tenant_id',auth.uid());
  update public.smyl_clinical_evidence_studies set status='under_review',revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where tenant_id=v_tenant and id=p_study_id and status<>'under_review';
  perform public.smyl_evidence_log_event(v_tenant,v_study.patient_id,p_study_id,'report_draft',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_sign_report(p_report_id uuid,p_expected_revision integer)
returns public.smyl_clinical_evidence_reports
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old public.smyl_clinical_evidence_reports; v_study public.smyl_clinical_evidence_studies; v_row public.smyl_clinical_evidence_reports;
  v_tenant uuid; v_professional uuid; v_bad integer; v_snapshot jsonb; v_signed_at timestamptz;
begin
  -- Orden único de bloqueo para evitar interbloqueo con guardar borrador: estudio -> informe.
  select * into v_old from public.smyl_clinical_evidence_reports where tenant_id=public.smyl_current_tenant() and id=p_report_id;
  if not found then raise exception using errcode='42501',message='El informe no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_old.patient_id,'clinical.approve');
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=v_tenant and id=v_old.study_id for update;
  select * into v_old from public.smyl_clinical_evidence_reports where tenant_id=v_tenant and id=p_report_id for update;
  if not found then raise exception using errcode='42501',message='El informe no está disponible.'; end if;
  if v_old.status='signed' then return v_old; end if;
  if v_old.revision is distinct from p_expected_revision then raise exception using errcode='PT409',message='El informe cambió en otra sesión. Actualiza la revisión.'; end if;
  perform public.smyl_evidence_validate_report(v_old.document,true);
  v_professional := public.smyl_current_professional_id(v_tenant);
  if v_professional is null then raise exception using errcode='23514',message='Sólo un profesional clínico registrado puede firmar el informe.'; end if;
  if v_study.status='superseded' then
    raise exception using errcode='23514',message='Un estudio sustituido no puede volver a firmarse.'; end if;
  if coalesce(v_study.quality->>'status','pending') not in ('usable','limited') then
    raise exception using errcode='23514',message='Completa el control de calidad antes de firmar.'; end if;
  if v_study.modality in ('photograph','radiograph_2d','scan_model','cbct_3d') and not exists(
      select 1 from public.smyl_clinical_evidence_assets a
      where a.tenant_id=v_tenant and a.patient_id=v_study.patient_id and a.study_id=v_study.id and a.asset_role='original') then
    raise exception using errcode='23514',message='El estudio requiere un archivo original antes de firmar.'; end if;
  if v_study.quality->>'status'='limited' and char_length(btrim(coalesce(v_old.document->>'technicalLimitations','')))<2 then
    raise exception using errcode='23514',message='Documenta las limitaciones técnicas del estudio.'; end if;
  -- Todo hallazgo del informe debe conservar un estado efectivo confirmado o corregido.
  select count(*) into v_bad from public.smyl_clinical_evidence_findings f
  where f.tenant_id=v_tenant and f.study_id=v_old.study_id and f.id in
    (select value::uuid from jsonb_array_elements_text(v_old.document->'findingIds'))
    and coalesce((select d.state from public.smyl_clinical_evidence_decisions d
      where d.tenant_id=v_tenant and d.finding_id=f.id order by d.revision desc limit 1),f.initial_state) not in ('confirmed','corrected');
  if v_bad>0 then raise exception using errcode='23514',message='Confirma, corrige o retira los hallazgos pendientes antes de firmar.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('findingId',f.id,'origin',f.origin,'category',f.category,
    'evidenceLevel',f.evidence_level,'label',f.label,'description',f.description,'anatomy',f.anatomy,
    'confidence',f.confidence,'initialState',f.initial_state,'model',f.model,'payload',f.payload,
    'createdBy',f.created_by,'createdProfessionalId',f.created_professional_id,'createdAt',f.created_at,
    'decision',(select jsonb_build_object('state',d.state,'revision',d.revision,'correction',d.correction,'note',d.note,
      'decidedBy',d.decided_by,'decidedProfessionalId',d.decided_professional_id,'decidedAt',d.decided_at)
      from public.smyl_clinical_evidence_decisions d where d.tenant_id=v_tenant and d.finding_id=f.id order by d.revision desc limit 1))
    order by f.created_at,f.id),'[]'::jsonb)
  into v_snapshot from public.smyl_clinical_evidence_findings f
  where f.tenant_id=v_tenant and f.study_id=v_old.study_id and f.id in
    (select value::uuid from jsonb_array_elements_text(v_old.document->'findingIds'));
  v_signed_at := clock_timestamp();
  update public.smyl_clinical_evidence_reports set status='signed',revision=revision+1,signed_findings=v_snapshot,
    signed_hash=public.smyl_evidence_report_hash(jsonb_build_object('schema',1,'tenantId',v_tenant,'patientId',v_old.patient_id,
      'studyId',v_old.study_id,'reportId',v_old.id,'revision',v_old.revision+1,'document',v_old.document,
      'signedFindings',v_snapshot,'signedBy',auth.uid(),'signedProfessionalId',v_professional,'signedAt',v_signed_at)),
    signed_by=auth.uid(),signed_professional_id=v_professional,
    signed_at=v_signed_at,updated_by=auth.uid(),updated_at=v_signed_at
  where tenant_id=v_tenant and id=p_report_id returning * into v_row;
  insert into public.smyl_clinical_evidence_report_versions(tenant_id,patient_id,report_id,revision,snapshot,actor_id)
  values(v_tenant,v_row.patient_id,v_row.id,v_row.revision,to_jsonb(v_row)-'tenant_id',auth.uid());
  update public.smyl_clinical_evidence_studies set status='signed',revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
    where tenant_id=v_tenant and id=v_old.study_id;
  perform public.smyl_evidence_log_event(v_tenant,v_old.patient_id,v_old.study_id,'sign_report',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_add_report_addendum(p_report_id uuid,p_content text,p_reason text)
returns public.smyl_clinical_evidence_report_addenda
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_report public.smyl_clinical_evidence_reports; v_tenant uuid; v_professional uuid;
  v_row public.smyl_clinical_evidence_report_addenda;
begin
  select * into v_report from public.smyl_clinical_evidence_reports where tenant_id=public.smyl_current_tenant() and id=p_report_id;
  if not found then raise exception using errcode='42501',message='El informe no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_report.patient_id,'clinical.approve');
  v_professional := public.smyl_current_professional_id(v_tenant);
  if v_professional is null then
    raise exception using errcode='23514',message='Sólo un profesional clínico registrado puede firmar una adenda.'; end if;
  if v_report.status<>'signed' then raise exception using errcode='23514',message='Las adendas sólo se agregan a informes firmados.'; end if;
  insert into public.smyl_clinical_evidence_report_addenda(tenant_id,patient_id,report_id,content,reason,created_by,created_professional_id)
  values(v_tenant,v_report.patient_id,p_report_id,btrim(p_content),btrim(p_reason),auth.uid(),v_professional) returning * into v_row;
  perform public.smyl_evidence_log_event(v_tenant,v_report.patient_id,v_report.study_id,'addendum',v_row.id);
  return v_row;
end;
$$;

create or replace function public.smyl_evidence_log_open(p_study_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_study public.smyl_clinical_evidence_studies; v_tenant uuid;
begin
  select * into v_study from public.smyl_clinical_evidence_studies where tenant_id=public.smyl_current_tenant() and id=p_study_id;
  if not found then raise exception using errcode='42501',message='El estudio no está disponible.'; end if;
  v_tenant := public.smyl_evidence_guard(v_study.patient_id,'clinical.read');
  perform public.smyl_evidence_log_event(v_tenant,v_study.patient_id,p_study_id,'open',p_study_id);
end;
$$;

revoke all on function public.smyl_evidence_create_study(uuid,uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb),
  public.smyl_evidence_update_study(uuid,integer,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text),
  public.smyl_evidence_attach_asset(uuid,uuid,text,uuid,uuid,text),
  public.smyl_evidence_link_anatomy(uuid,text,text,text,text,jsonb),
  public.smyl_evidence_link_context(uuid,text,uuid,text),
  public.smyl_evidence_revoke_link(text,uuid),
  public.smyl_evidence_supersede_study(uuid,uuid),
  public.smyl_evidence_create_finding(uuid,uuid,text,text,text,text,text,jsonb,numeric,text,jsonb,jsonb),
  public.smyl_evidence_decide_finding(uuid,integer,text,jsonb,text),
  public.smyl_evidence_save_report_draft(uuid,uuid,integer,jsonb),
  public.smyl_evidence_sign_report(uuid,integer),
  public.smyl_evidence_add_report_addendum(uuid,text,text),
  public.smyl_evidence_log_open(uuid) from public, anon;

grant execute on function public.smyl_evidence_create_study(uuid,uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb),
  public.smyl_evidence_update_study(uuid,integer,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text),
  public.smyl_evidence_attach_asset(uuid,uuid,text,uuid,uuid,text),
  public.smyl_evidence_link_anatomy(uuid,text,text,text,text,jsonb),
  public.smyl_evidence_link_context(uuid,text,uuid,text),
  public.smyl_evidence_revoke_link(text,uuid),
  public.smyl_evidence_supersede_study(uuid,uuid),
  public.smyl_evidence_create_finding(uuid,uuid,text,text,text,text,text,jsonb,numeric,text,jsonb,jsonb),
  public.smyl_evidence_decide_finding(uuid,integer,text,jsonb,text),
  public.smyl_evidence_save_report_draft(uuid,uuid,integer,jsonb),
  public.smyl_evidence_sign_report(uuid,integer),
  public.smyl_evidence_add_report_addendum(uuid,text,text),
  public.smyl_evidence_log_open(uuid) to authenticated;

comment on table public.smyl_clinical_evidence_studies is 'Índice multimodal por paciente: fotografía, radiografía 2D, escaneo/modelo, medición clínica, documento o CBCT/3D.';
comment on table public.smyl_clinical_evidence_assets is 'Vínculos inmutables a originales ya protegidos; no duplica rutas ni hashes.';
comment on table public.smyl_clinical_evidence_findings is 'Hallazgo profesional o candidato de IA inmutable; la IA siempre inicia pendiente.';
comment on table public.smyl_clinical_evidence_decisions is 'Decisiones profesionales append-only sobre candidatos; conserva correcciones y rechazos.';
comment on table public.smyl_clinical_evidence_reports is 'Interpretación profesional versionada, firmable y con adendas.';

commit;
