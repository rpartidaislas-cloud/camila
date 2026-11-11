-- SMYL · Fotografías clínicas canónicas y análisis asistido v1.
-- El original permanece una sola vez en smyl_patient_files / smyl-clinical-files.
-- Esta capa sólo lo indexa como evidencia y conserva los candidatos de IA pendientes
-- hasta que un profesional registrado los confirme, corrija o descarte.
begin;

alter table public.smyl_ai_usage_log drop constraint if exists smyl_ai_usage_log_feature_check;
alter table public.smyl_ai_usage_log add constraint smyl_ai_usage_log_feature_check
  check (feature in ('radiograph_analysis','radiograph_toothmap','clinical_photo_analysis'));

create table public.smyl_clinical_photo_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  request_id text not null check (char_length(request_id) between 1 and 120),
  provider text not null check (char_length(btrim(provider)) between 1 and 60),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  study_ids uuid[] not null check (cardinality(study_ids) between 1 and 4),
  report jsonb not null check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 65536),
  result_summary jsonb not null check (jsonb_typeof(result_summary) = 'object' and octet_length(result_summary::text) <= 16384),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, request_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);
create index smyl_clinical_photo_analysis_patient_idx
  on public.smyl_clinical_photo_analysis_runs(tenant_id, patient_id, created_at desc);

alter table public.smyl_clinical_photo_analysis_runs enable row level security;
revoke all on public.smyl_clinical_photo_analysis_runs from public, anon, authenticated;
grant select on public.smyl_clinical_photo_analysis_runs to authenticated;
grant select on public.smyl_clinical_photo_analysis_runs to service_role;
create policy smyl_clinical_photo_analysis_runs_read
  on public.smyl_clinical_photo_analysis_runs for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read')
    and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));

-- Reserva corta para que dos reintentos concurrentes con la misma llave no
-- ejecuten dos llamadas pagadas al proveedor. El resultado clínico final vive
-- únicamente en la tabla inmutable de runs; esta fila es sólo coordinación.
create table public.smyl_clinical_photo_analysis_requests (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 120),
  patient_id uuid not null,
  study_ids uuid[] not null check (cardinality(study_ids) between 1 and 4),
  actor_id uuid not null references auth.users(id),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  status text not null check (status in ('processing','completed','failed')),
  lease_until timestamptz,
  last_error text not null default '' check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, request_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);
create index smyl_clinical_photo_analysis_requests_lease_idx
  on public.smyl_clinical_photo_analysis_requests(status,lease_until) where status='processing';
alter table public.smyl_clinical_photo_analysis_requests enable row level security;
revoke all on public.smyl_clinical_photo_analysis_requests from public, anon, authenticated;
grant select,insert,update on public.smyl_clinical_photo_analysis_requests to service_role;

-- Cierre profesional del estudio fotográfico. Cada cambio crea una revisión
-- inmutable: una fotografía puede resolverse aunque no exista un hallazgo de IA,
-- sin convertir la ausencia de sugerencias automáticas en un diagnóstico.
create table public.smyl_clinical_photo_study_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  revision integer not null check (revision > 0),
  state text not null check (state in ('reviewed_no_findings','not_evaluable','manual_only')),
  reason text not null check (reason in (
    'no_visible_findings','focus_insufficient','exposure_insufficient','orientation_uncertain',
    'region_not_visible','artifact_or_obstruction','other','professional_manual_review'
  )),
  note text not null default '' check (char_length(note) <= 1000),
  reviewer_id uuid not null references auth.users(id),
  reviewer_professional_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, study_id, revision),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id, study_id)
    references public.smyl_clinical_evidence_studies(tenant_id, patient_id, id) on delete cascade,
  foreign key (tenant_id, reviewer_professional_id)
    references public.smyl_professionals(tenant_id, id),
  check (
    (state='reviewed_no_findings' and reason='no_visible_findings')
    or (state='manual_only' and reason='professional_manual_review')
    or (state='not_evaluable' and reason in (
      'focus_insufficient','exposure_insufficient','orientation_uncertain',
      'region_not_visible','artifact_or_obstruction','other'
    ))
  ),
  check (reason<>'other' or char_length(btrim(note)) between 2 and 1000)
);
create index smyl_clinical_photo_study_reviews_latest_idx
  on public.smyl_clinical_photo_study_reviews(tenant_id, study_id, revision desc);

alter table public.smyl_clinical_photo_study_reviews enable row level security;
revoke all on public.smyl_clinical_photo_study_reviews from public, anon, authenticated;
grant select on public.smyl_clinical_photo_study_reviews to authenticated;
create policy smyl_clinical_photo_study_reviews_read
  on public.smyl_clinical_photo_study_reviews for select to authenticated
  using (public.smyl_has_permission(tenant_id,'clinical.read')
    and public.smyl_can_access_patient(tenant_id,patient_id,'clinical'));

create trigger smyl_clinical_photo_analysis_runs_immutable
before update or delete on public.smyl_clinical_photo_analysis_runs
for each row execute function public.smyl_evidence_forbid_change();
create trigger smyl_clinical_photo_study_reviews_immutable
before update or delete on public.smyl_clinical_photo_study_reviews
for each row execute function public.smyl_evidence_forbid_change();

-- Registra el significado clínico del archivo ya verificado. Si el mismo archivo
-- ya fue indexado, devuelve su estudio actual y no crea una segunda referencia.
create or replace function public.smyl_evidence_register_photo_file(
  p_study_id uuid,
  p_asset_id uuid,
  p_patient_file_id uuid,
  p_patient_id uuid,
  p_subtype text,
  p_display_name text,
  p_acquired_at timestamptz default null,
  p_region jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns public.smyl_clinical_evidence_studies
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_file public.smyl_patient_files;
  v_existing public.smyl_clinical_evidence_studies;
  v_study public.smyl_clinical_evidence_studies;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant,'clinical.write') then
    raise exception using errcode='42501',message='No tienes permiso para incorporar fotografías al expediente.';
  end if;
  if p_study_id is null or p_asset_id is null or p_patient_file_id is null or p_patient_id is null
     or not public.smyl_evidence_subtype_allowed('photograph',p_subtype)
     or char_length(btrim(coalesce(p_display_name,''))) not between 1 and 180
     or jsonb_typeof(coalesce(p_region,'{}'::jsonb)) is distinct from 'object'
     or octet_length(coalesce(p_region,'{}'::jsonb)::text)>4096
     or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) is distinct from 'object'
     or octet_length(coalesce(p_metadata,'{}'::jsonb)::text)>24000
     or coalesce(p_metadata,'{}'::jsonb) ?| array['analysis','source','patientFileId','sha256','mimeType','sizeBytes'] then
    raise exception using errcode='22023',message='La clasificación de la fotografía no es válida.';
  end if;

  select * into v_file from public.smyl_patient_files
   where tenant_id=v_tenant and id=p_patient_file_id for update;
  if not found or v_file.status<>'active' or v_file.category<>'clinical_photo'
     or v_file.mime_type not in ('image/jpeg','image/png','image/webp') or v_file.sha256 is null then
    raise exception using errcode='23514',message='El original privado no está disponible o no fue verificado.';
  end if;
  if v_file.patient_id<>p_patient_id then
    raise exception using errcode='42501',message='El original no pertenece al paciente seleccionado.';
  end if;
  perform public.smyl_evidence_guard(v_file.patient_id,'clinical.write');

  select s.* into v_existing
    from public.smyl_clinical_evidence_assets a
    join public.smyl_clinical_evidence_studies s
      on s.tenant_id=a.tenant_id and s.patient_id=a.patient_id and s.id=a.study_id
   where a.tenant_id=v_tenant and a.patient_file_id=p_patient_file_id and a.asset_role='original'
     and s.modality='photograph' and s.status<>'superseded'
   order by s.created_at desc limit 1;
  if found then
    if v_existing.patient_id<>p_patient_id or v_existing.subtype<>p_subtype then
      raise exception using errcode='23514',message='El original ya fue clasificado con otra vista clínica.';
    end if;
    return v_existing;
  end if;

  if exists(select 1 from public.smyl_clinical_evidence_studies where id=p_study_id)
     or exists(select 1 from public.smyl_clinical_evidence_assets where id=p_asset_id) then
    raise exception using errcode='22023',message='Identificador de evidencia no disponible.';
  end if;

  insert into public.smyl_clinical_evidence_studies(
    id,tenant_id,patient_id,appointment_id,modality,subtype,display_name,
    acquired_at,source_provider,region,quality,metadata,status,created_by,updated_by
  ) values (
    p_study_id,v_tenant,v_file.patient_id,v_file.appointment_id,'photograph',p_subtype,btrim(p_display_name),
    coalesce(p_acquired_at,v_file.captured_at,v_file.created_at),'SMYL',coalesce(p_region,'{}'::jsonb),
    '{"status":"pending","flags":[],"notes":""}'::jsonb,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'schema',1,'source','patient_file','patientFileId',p_patient_file_id,
      'sha256',v_file.sha256,'mimeType',v_file.mime_type,'sizeBytes',v_file.size_bytes
    ),'ready',auth.uid(),auth.uid()
  ) returning * into v_study;

  insert into public.smyl_clinical_evidence_assets(
    id,tenant_id,patient_id,study_id,asset_role,patient_file_id,label,created_by
  ) values (
    p_asset_id,v_tenant,v_file.patient_id,v_study.id,'original',v_file.id,btrim(p_display_name),auth.uid()
  );
  perform public.smyl_evidence_log_event(v_tenant,v_file.patient_id,v_study.id,'create',v_study.id);
  perform public.smyl_evidence_log_event(v_tenant,v_file.patient_id,v_study.id,'attach',p_asset_id);
  return v_study;
end;
$$;

-- Resuelve el estudio aun cuando la IA se abstuvo o no produjo sugerencias.
-- El control optimista evita que dos profesionales registren cierres divergentes
-- desde sesiones distintas. Las revisiones previas nunca se sobrescriben.
create or replace function public.smyl_evidence_set_photo_disposition(
  p_study_id uuid,
  p_expected_revision integer,
  p_state text,
  p_reason text,
  p_note text default ''
) returns public.smyl_clinical_photo_study_reviews
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_study public.smyl_clinical_evidence_studies;
  v_professional uuid;
  v_revision integer;
  v_row public.smyl_clinical_photo_study_reviews;
begin
  if p_study_id is null or p_expected_revision is null or p_expected_revision<0
     or p_state not in ('reviewed_no_findings','not_evaluable','manual_only')
     or p_reason not in (
       'no_visible_findings','focus_insufficient','exposure_insufficient','orientation_uncertain',
       'region_not_visible','artifact_or_obstruction','other','professional_manual_review'
     ) or char_length(coalesce(p_note,''))>1000
     or (p_reason='other' and char_length(btrim(coalesce(p_note,'')))<2)
     or (p_state='reviewed_no_findings' and p_reason<>'no_visible_findings')
     or (p_state='manual_only' and p_reason<>'professional_manual_review')
     or (p_state='not_evaluable' and p_reason not in (
       'focus_insufficient','exposure_insufficient','orientation_uncertain',
       'region_not_visible','artifact_or_obstruction','other'
     )) then
    raise exception using errcode='22023',message='La resolución profesional de la fotografía no es válida.';
  end if;

  select * into v_study from public.smyl_clinical_evidence_studies
   where tenant_id=v_tenant and id=p_study_id for update;
  if not found or v_study.modality<>'photograph' then
    raise exception using errcode='42501',message='La fotografía no está disponible.';
  end if;
  v_tenant:=public.smyl_evidence_guard(v_study.patient_id,'clinical.approve');
  v_professional:=public.smyl_current_professional_id(v_tenant);
  if v_professional is null then
    raise exception using errcode='23514',message='Sólo un profesional clínico registrado puede resolver una fotografía.';
  end if;
  if v_study.status in ('signed','superseded') then
    raise exception using errcode='23514',message='La fotografía pertenece a un estudio finalizado.';
  end if;
  if exists(
    select 1 from public.smyl_clinical_evidence_findings f
     where f.tenant_id=v_tenant and f.patient_id=v_study.patient_id
       and f.study_id=v_study.id and f.origin='ai'
       and not exists(
         select 1 from public.smyl_clinical_evidence_decisions d
          where d.tenant_id=f.tenant_id and d.finding_id=f.id
       )
  ) then
    raise exception using errcode='23514',message='Decide o descarta las sugerencias pendientes antes de cerrar la fotografía.';
  end if;
  if p_state='reviewed_no_findings' and exists(
    select 1 from public.smyl_clinical_evidence_findings f
     where f.tenant_id=v_tenant and f.patient_id=v_study.patient_id and f.study_id=v_study.id
       and (f.origin='professional' or exists(
         select 1 from public.smyl_clinical_evidence_decisions d
          where d.tenant_id=f.tenant_id and d.finding_id=f.id and d.state in ('confirmed','corrected')
       ))
  ) then
    raise exception using errcode='23514',message='La fotografía ya contiene observaciones profesionales confirmadas.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('clinical-photo-resolution:'||p_study_id::text,47));
  select coalesce(max(revision),0) into v_revision
    from public.smyl_clinical_photo_study_reviews
   where tenant_id=v_tenant and study_id=p_study_id;
  if v_revision is distinct from p_expected_revision then
    raise exception using errcode='PT409',message='La fotografía cambió en otra sesión. Actualiza la valoración.';
  end if;
  v_revision:=v_revision+1;
  insert into public.smyl_clinical_photo_study_reviews(
    tenant_id,patient_id,study_id,revision,state,reason,note,
    reviewer_id,reviewer_professional_id
  ) values (
    v_tenant,v_study.patient_id,v_study.id,v_revision,p_state,p_reason,
    coalesce(p_note,''),auth.uid(),v_professional
  ) returning * into v_row;

  update public.smyl_clinical_evidence_studies set
    status='under_review',revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp()
   where tenant_id=v_tenant and id=v_study.id;
  perform public.smyl_evidence_log_event(v_tenant,v_study.patient_id,v_study.id,'decide',v_row.id);
  return v_row;
end;
$$;

-- La Edge Function usa service_role para abrir los originales privados. Este helper
-- reproduce el alcance por paciente del actor real antes de descargar un solo byte.
create or replace function public.smyl_actor_can_access_patient_explicit(
  p_actor uuid,p_tenant uuid,p_patient uuid,p_domain text default 'clinical'
) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_scope text;
  v_professional uuid;
begin
  if p_actor is null or p_tenant is null or p_patient is null
     or p_domain not in ('patients','schedule','clinical','messages','finance')
     or not exists(select 1 from public.camila_pacientes p where p.tenant_id=p_tenant and p.id=p_patient) then
    return false;
  end if;
  if exists(select 1 from public.camila_tenants t where t.id=p_tenant and t.id=p_actor and t.activo)
     or exists(select 1 from public.camila_usuarios u
       where u.id=p_actor and u.tenant_id=p_tenant and u.activo and u.rol='dueño') then
    return true;
  end if;
  if not exists(select 1 from public.camila_usuarios u
      where u.id=p_actor and u.tenant_id=p_tenant and u.activo) then return false; end if;
  select coalesce(rs.scope,'own') into v_scope
    from public.smyl_member_roles mr
    join public.smyl_roles r on r.tenant_id=mr.tenant_id and r.id=mr.role_id and r.active
    left join public.smyl_role_scopes rs
      on rs.tenant_id=r.tenant_id and rs.role_id=r.id and rs.domain=p_domain
   where mr.tenant_id=p_tenant and mr.user_id=p_actor
   order by public.smyl_scope_rank(coalesce(rs.scope,'own')) desc limit 1;
  v_scope:=coalesce(v_scope,'own');
  if v_scope='clinic' then return true; end if;
  if v_scope='branches' then
    return exists(select 1 from public.smyl_appointments a
      join public.smyl_member_branches mb
        on mb.tenant_id=a.tenant_id and mb.branch_id=a.branch_id and mb.user_id=p_actor
      where a.tenant_id=p_tenant and a.patient_id=p_patient);
  end if;
  select p.id into v_professional from public.smyl_professionals p
    where p.tenant_id=p_tenant and p.user_id=p_actor and p.active limit 1;
  if v_professional is null then return false; end if;
  return exists(select 1 from public.smyl_patient_care_team ct
      where ct.tenant_id=p_tenant and ct.patient_id=p_patient and ct.professional_id=v_professional
        and ct.active and (ct.ends_at is null or ct.ends_at>now()))
    or exists(select 1 from public.smyl_appointments a
      where a.tenant_id=p_tenant and a.patient_id=p_patient and a.professional_id=v_professional);
end;
$$;

-- Reserva una ejecución antes de llamar al proveedor. Una reserva viva impide
-- el gasto duplicado; una reserva abandonada puede retomarse tras cinco minutos.
create or replace function public.smyl_reserve_clinical_photo_analysis(
  p_tenant uuid,
  p_actor uuid,
  p_request_id text,
  p_model text,
  p_study_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_request public.smyl_clinical_photo_analysis_requests;
  v_study_ids uuid[];
  v_patient uuid;
  v_study_count integer;
begin
  if p_tenant is null or p_actor is null
     or not public.smyl_actor_has_permission_explicit(p_actor,p_tenant,'clinical.write')
     or char_length(btrim(coalesce(p_request_id,''))) not between 1 and 120
     or char_length(btrim(coalesce(p_model,''))) not between 1 and 100
     or p_study_ids is null or cardinality(p_study_ids) not between 1 and 4
     or array_position(p_study_ids,null) is not null then
    raise exception using errcode='42501',message='No se pudo reservar el análisis clínico.';
  end if;
  select array_agg(x order by x),count(distinct x) into v_study_ids,v_study_count
    from unnest(p_study_ids) x;
  if v_study_count<>cardinality(p_study_ids) then
    raise exception using errcode='22023',message='La solicitud repite una fotografía.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('clinical-photo:'||p_tenant::text||':'||btrim(p_request_id),43));
  select * into v_request from public.smyl_clinical_photo_analysis_requests
   where tenant_id=p_tenant and request_id=btrim(p_request_id) for update;
  if found then
    if v_request.actor_id<>p_actor or v_request.model<>btrim(p_model) or v_request.study_ids<>v_study_ids then
      raise exception using errcode='22023',message='El identificador del análisis ya fue utilizado.';
    end if;
    if v_request.status='completed' then
      return jsonb_build_object('state','completed');
    end if;
    if v_request.status='processing' and v_request.lease_until>clock_timestamp() then
      return jsonb_build_object(
        'state','processing',
        'retryAfterMs',greatest(1000,ceil(extract(epoch from (v_request.lease_until-clock_timestamp()))*1000)::integer)
      );
    end if;
  end if;

  select s.patient_id into v_patient
    from public.smyl_clinical_evidence_studies s
   where s.tenant_id=p_tenant and s.id=any(v_study_ids) limit 1;
  if v_patient is null
     or (select count(*) from public.smyl_clinical_evidence_studies s
          where s.tenant_id=p_tenant and s.id=any(v_study_ids)
            and s.patient_id=v_patient and s.modality='photograph'
            and public.smyl_evidence_subtype_allowed('photograph',s.subtype)
            and s.status in ('ready','under_review')
            and coalesce(s.metadata->'analysis'->>'completed','false')<>'true')<>cardinality(v_study_ids)
     or not public.smyl_actor_can_access_patient_explicit(p_actor,p_tenant,v_patient,'clinical')
     or exists(
       select 1 from unnest(v_study_ids) requested(study_id)
       where (select count(*)
                from public.smyl_clinical_evidence_assets a
                join public.smyl_patient_files f on f.tenant_id=a.tenant_id and f.id=a.patient_file_id
               where a.tenant_id=p_tenant and a.study_id=requested.study_id and a.asset_role='original'
                 and f.patient_id=v_patient and f.status='active' and f.category='clinical_photo'
                 and f.mime_type in ('image/jpeg','image/png','image/webp') and f.sha256 is not null)<>1
     ) then
    raise exception using errcode='42501',message='Las fotografías no están disponibles para este análisis.';
  end if;

  if v_request.request_id is null then
    insert into public.smyl_clinical_photo_analysis_requests(
      tenant_id,request_id,patient_id,study_ids,actor_id,model,status,lease_until
    ) values (
      p_tenant,btrim(p_request_id),v_patient,v_study_ids,p_actor,btrim(p_model),'processing',clock_timestamp()+interval '5 minutes'
    );
  else
    update public.smyl_clinical_photo_analysis_requests set
      patient_id=v_patient,status='processing',lease_until=clock_timestamp()+interval '5 minutes',
      last_error='',updated_at=clock_timestamp()
     where tenant_id=p_tenant and request_id=btrim(p_request_id);
  end if;
  return jsonb_build_object('state','reserved','leaseSeconds',300);
end;
$$;

create or replace function public.smyl_release_clinical_photo_analysis_request(
  p_tenant uuid,p_actor uuid,p_request_id text,p_model text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_released boolean;
begin
  update public.smyl_clinical_photo_analysis_requests set
    status='failed',lease_until=null,last_error='edge_failure',updated_at=clock_timestamp()
   where tenant_id=p_tenant and request_id=btrim(p_request_id)
     and actor_id=p_actor and model=btrim(p_model) and status='processing';
  v_released:=found;
  return v_released;
end;
$$;

-- Exclusiva para el backend verificado. Valida nuevamente el contrato de IA,
-- guarda la calidad por fotografía y crea candidatos inmutables en estado pending.
create or replace function public.smyl_store_clinical_photo_ai_analysis(
  p_tenant uuid,
  p_actor uuid,
  p_request_id text,
  p_provider text,
  p_model text,
  p_report jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_run public.smyl_clinical_photo_analysis_runs;
  v_request public.smyl_clinical_photo_analysis_requests;
  v_image jsonb;
  v_finding jsonb;
  v_limit jsonb;
  v_study public.smyl_clinical_evidence_studies;
  v_patient uuid;
  v_study_id uuid;
  v_study_ids uuid[] := '{}'::uuid[];
  v_image_ids uuid[] := '{}'::uuid[];
  v_finding_ids uuid[] := '{}'::uuid[];
  v_source_ids text[] := '{}'::text[];
  v_quality_by_study jsonb := '{}'::jsonb;
  v_quality text;
  v_view text;
  v_tooth text;
  v_category text;
  v_db_category text;
  v_finding_id uuid;
  v_summary jsonb;
  v_count integer := 0;
begin
  if p_tenant is null or p_actor is null
     or not public.smyl_actor_has_permission_explicit(p_actor,p_tenant,'clinical.write') then
    raise exception using errcode='42501',message='Backend clínico no autorizado.';
  end if;

  if char_length(btrim(coalesce(p_request_id,''))) not between 1 and 120
     or char_length(btrim(coalesce(p_provider,''))) not between 1 and 60
     or char_length(btrim(coalesce(p_model,''))) not between 1 and 100
     or jsonb_typeof(p_report) is distinct from 'object' or octet_length(p_report::text)>65536
     or not (p_report ?& array['schema','images','findings','limitations'])
     or p_report - array['schema','images','findings','limitations'] <> '{}'::jsonb
     or p_report->'schema' is distinct from '1'::jsonb
     or jsonb_typeof(p_report->'images') is distinct from 'array'
     or jsonb_array_length(p_report->'images') not between 1 and 4
     or jsonb_typeof(p_report->'findings') is distinct from 'array'
     or jsonb_array_length(p_report->'findings')>32
     or jsonb_typeof(p_report->'limitations') is distinct from 'array'
     or jsonb_array_length(p_report->'limitations')>8 then
    raise exception using errcode='22023',message='El análisis fotográfico no cumple el contrato clínico.';
  end if;

  for v_limit in select value from jsonb_array_elements(p_report->'limitations') loop
    if jsonb_typeof(v_limit) is distinct from 'string'
       or char_length(btrim(v_limit #>> '{}')) not between 1 and 300
       or (v_limit #>> '{}') ~* '(caries|periodontitis|gingivitis|infecci[oó]n|absceso|fractura|necrosis|pulpitis|patolog[ií]a|diagn[oó]stico|tratamiento|urgencia|pron[oó]stico|tumor|quiste)' then
      raise exception using errcode='22023',message='Una limitación técnica no es válida.';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('clinical-photo:'||p_tenant::text||':'||btrim(p_request_id),43));

  select * into v_run from public.smyl_clinical_photo_analysis_runs
   where tenant_id=p_tenant and request_id=btrim(p_request_id);
  if found then
    if v_run.actor_id<>p_actor or v_run.provider<>btrim(p_provider) or v_run.model<>btrim(p_model)
       or v_run.report<>p_report then
      raise exception using errcode='22023',message='El identificador del análisis ya fue utilizado.';
    end if;
    return v_run.result_summary;
  end if;

  for v_image in select value from jsonb_array_elements(p_report->'images') loop
    if jsonb_typeof(v_image) is distinct from 'object'
       or v_image - array['studyId','view','quality','note'] <> '{}'::jsonb
       or jsonb_typeof(v_image->'studyId') is distinct from 'string'
       or jsonb_typeof(v_image->'view') is distinct from 'string'
       or jsonb_typeof(v_image->'quality') is distinct from 'string'
       or jsonb_typeof(v_image->'note') is distinct from 'string'
       or char_length(btrim(v_image->>'note')) not between 1 and 300
       or (v_image->>'note') ~* '(caries|periodontitis|gingivitis|infecci[oó]n|absceso|fractura|necrosis|pulpitis|patolog[ií]a|diagn[oó]stico|tratamiento|urgencia|pron[oó]stico|tumor|quiste)' then
      raise exception using errcode='22023',message='Una evaluación de calidad no es válida.';
    end if;
    begin v_study_id := (v_image->>'studyId')::uuid;
    exception when others then raise exception using errcode='22023',message='Identificador de fotografía no válido.'; end;
    if v_study_id=any(v_image_ids) then
      raise exception using errcode='22023',message='El análisis repite una fotografía.';
    end if;
    v_view := v_image->>'view';
    v_quality := v_image->>'quality';
    if v_quality not in ('usable','limited','unusable')
       or not public.smyl_evidence_subtype_allowed('photograph',v_view) then
      raise exception using errcode='22023',message='La calidad o vista fotográfica no es válida.';
    end if;
    select * into v_study from public.smyl_clinical_evidence_studies
     where tenant_id=p_tenant and id=v_study_id for update;
    if not found or v_study.modality<>'photograph' or v_study.subtype<>v_view
       or v_study.status not in ('ready','under_review') then
      raise exception using errcode='42501',message='La fotografía no está disponible para análisis.';
    end if;
    if v_study.metadata->'analysis'->>'completed'='true' then
      raise exception using errcode='23514',message='La fotografía ya cuenta con un análisis conservado.';
    end if;
    if v_patient is null then
      v_patient:=v_study.patient_id;
      if not public.smyl_actor_can_access_patient_explicit(p_actor,p_tenant,v_patient,'clinical') then
        raise exception using errcode='42501',message='El paciente no está disponible para el rol clínico del actor.';
      end if;
    elsif v_patient<>v_study.patient_id then
      raise exception using errcode='23514',message='Todas las fotografías deben pertenecer al mismo paciente.';
    end if;
    if not exists(
      select 1 from public.smyl_clinical_evidence_assets a
      join public.smyl_patient_files f on f.tenant_id=a.tenant_id and f.id=a.patient_file_id
      where a.tenant_id=p_tenant and a.study_id=v_study_id and a.asset_role='original'
        and f.patient_id=v_study.patient_id and f.status='active' and f.category='clinical_photo'
        and f.mime_type in ('image/jpeg','image/png','image/webp') and f.sha256 is not null
    ) then raise exception using errcode='23514',message='La fotografía original no está disponible.'; end if;
    v_image_ids:=array_append(v_image_ids,v_study_id);
    v_study_ids:=array_append(v_study_ids,v_study_id);
    v_quality_by_study:=v_quality_by_study||jsonb_build_object(v_study_id::text,v_quality);
  end loop;

  select array_agg(x order by x) into v_study_ids from unnest(v_study_ids) x;
  select * into v_request from public.smyl_clinical_photo_analysis_requests
   where tenant_id=p_tenant and request_id=btrim(p_request_id) for update;
  if not found or v_request.status<>'processing' or v_request.actor_id<>p_actor
     or v_request.patient_id<>v_patient or v_request.model<>btrim(p_model)
     or v_request.study_ids<>v_study_ids then
    raise exception using errcode='42501',message='La reserva del análisis no está vigente.';
  end if;

  for v_finding in select value from jsonb_array_elements(p_report->'findings') loop
    if jsonb_typeof(v_finding) is distinct from 'object'
       or not (v_finding ?& array['id','studyId','view','tooth','category','observation','evidence','confidence'])
       or v_finding - array['id','studyId','view','tooth','category','observation','evidence','confidence'] <> '{}'::jsonb
       or jsonb_typeof(v_finding->'id') is distinct from 'string'
       or (v_finding->>'id') !~ '^f([1-9]|[12][0-9]|3[0-2])$'
       or jsonb_typeof(v_finding->'studyId') is distinct from 'string'
       or jsonb_typeof(v_finding->'view') is distinct from 'string'
       or jsonb_typeof(v_finding->'category') is distinct from 'string'
       or jsonb_typeof(v_finding->'observation') is distinct from 'string'
       or jsonb_typeof(v_finding->'evidence') is distinct from 'string'
       or jsonb_typeof(v_finding->'confidence') is distinct from 'number'
       or (v_finding->'tooth'<>'null'::jsonb and jsonb_typeof(v_finding->'tooth') is distinct from 'string')
       or char_length(btrim(v_finding->>'observation')) not between 1 and 400
       or char_length(btrim(v_finding->>'evidence')) not between 1 and 250
       or (v_finding->>'observation') ~* '(caries|periodontitis|gingivitis|infecci[oó]n|absceso|fractura|necrosis|pulpitis|patolog[ií]a|diagn[oó]stico|tratamiento|urgencia|pron[oó]stico|tumor|quiste)'
       or (v_finding->>'evidence') ~* '(caries|periodontitis|gingivitis|infecci[oó]n|absceso|fractura|necrosis|pulpitis|patolog[ií]a|diagn[oó]stico|tratamiento|urgencia|pron[oó]stico|tumor|quiste)'
       or (v_finding->>'confidence')::numeric not between 0 and 1 then
      raise exception using errcode='22023',message='Una sugerencia fotográfica no es válida.';
    end if;
    if (v_finding->>'id')=any(v_source_ids) then
      raise exception using errcode='22023',message='El análisis repite una sugerencia.';
    end if;
    begin v_study_id := (v_finding->>'studyId')::uuid;
    exception when others then raise exception using errcode='22023',message='Identificador de fotografía no válido.'; end;
    v_view:=v_finding->>'view';
    v_category:=v_finding->>'category';
    v_tooth:=nullif(v_finding->>'tooth','');
    if not (v_study_id=any(v_image_ids)) or coalesce(v_quality_by_study->>v_study_id::text,'')='unusable'
       or v_category not in ('deposit','color','wear','position','gap','soft_tissue','other')
       or (v_tooth is not null and v_tooth !~ '^[1-4][1-8]$') then
      raise exception using errcode='22023',message='La sugerencia no corresponde a una fotografía utilizable.';
    end if;
    select * into v_study from public.smyl_clinical_evidence_studies
     where tenant_id=p_tenant and id=v_study_id;
    if v_study.subtype<>v_view then
      raise exception using errcode='22023',message='La sugerencia no conserva su vista de origen.';
    end if;
    v_db_category:=case
      when v_category in ('position','gap') then 'orthodontic'
      when v_category='soft_tissue' then 'soft_tissue'
      when v_category='wear' then 'occlusion'
      else 'other' end;
    v_finding_id:=gen_random_uuid();
    insert into public.smyl_clinical_evidence_findings(
      id,tenant_id,patient_id,study_id,origin,category,evidence_level,label,description,
      anatomy,confidence,initial_state,model,payload,created_by,created_professional_id
    ) values (
      v_finding_id,p_tenant,v_patient,v_study_id,'ai',v_db_category,'model_candidate',
      case v_category
        when 'deposit' then 'Depósito visible por comprobar'
        when 'color' then 'Cambio de color por comprobar'
        when 'wear' then 'Desgaste aparente por comprobar'
        when 'position' then 'Posición aparente por comprobar'
        when 'gap' then 'Espacio visible por comprobar'
        when 'soft_tissue' then 'Tejido blando por comprobar'
        else 'Observación visual por comprobar' end,
      btrim(v_finding->>'observation'),
      case when v_tooth is null then '{"scope":"whole_mouth"}'::jsonb
           else jsonb_build_object('scope','tooth','fdi',v_tooth) end,
      (v_finding->>'confidence')::numeric,'pending',
      jsonb_build_object('provider',btrim(p_provider),'name',btrim(p_model),'requestId',btrim(p_request_id)),
      jsonb_build_object(
        'schema',1,'sourceId',v_finding->>'id','photoCategory',v_category,
        'evidence',v_finding->>'evidence','view',v_view,'requestId',btrim(p_request_id)
      ),p_actor,null
    );
    v_finding_ids:=array_append(v_finding_ids,v_finding_id);
    v_source_ids:=array_append(v_source_ids,v_finding->>'id');
    v_count:=v_count+1;
    insert into public.smyl_clinical_evidence_access_events(
      tenant_id,patient_id,study_id,action,actor_id,actor_professional_id,reference_id
    ) values (
      p_tenant,v_patient,v_study_id,'finding',p_actor,
      (select p.id from public.smyl_professionals p where p.tenant_id=p_tenant and p.user_id=p_actor and p.active limit 1),
      v_finding_id
    );
  end loop;

  for v_image in select value from jsonb_array_elements(p_report->'images') loop
    v_study_id:=(v_image->>'studyId')::uuid;
    update public.smyl_clinical_evidence_studies set
      quality=case when quality->>'status'='pending'
        then jsonb_build_object('status',v_image->>'quality','flags','[]'::jsonb,'notes',v_image->>'note')
        else quality end,
      metadata=metadata||jsonb_build_object('analysis',jsonb_build_object(
        'schema',1,'completed',true,'requestId',btrim(p_request_id),'provider',btrim(p_provider),
        'model',btrim(p_model),'quality',v_image->>'quality','qualityNote',v_image->>'note','findingCount',(
          select count(*) from jsonb_array_elements(p_report->'findings') f
          where f->>'studyId'=v_study_id::text
        ),'limitations',p_report->'limitations','completedAt',clock_timestamp()
      )),status='under_review',revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp()
     where tenant_id=p_tenant and id=v_study_id;
    insert into public.smyl_clinical_evidence_access_events(
      tenant_id,patient_id,study_id,action,actor_id,actor_professional_id,reference_id
    ) values (
      p_tenant,v_patient,v_study_id,'update',p_actor,
      (select p.id from public.smyl_professionals p where p.tenant_id=p_tenant and p.user_id=p_actor and p.active limit 1),
      v_study_id
    );
  end loop;

  v_summary:=jsonb_build_object(
    'schema',1,'requestId',btrim(p_request_id),'patientId',v_patient,'studyIds',to_jsonb(v_study_ids),
    'findingIds',to_jsonb(v_finding_ids),'findingCount',v_count,'limitations',p_report->'limitations','persisted',true
  );
  insert into public.smyl_clinical_photo_analysis_runs(
    tenant_id,patient_id,request_id,provider,model,study_ids,report,result_summary,actor_id
  ) values (
    p_tenant,v_patient,btrim(p_request_id),btrim(p_provider),btrim(p_model),v_study_ids,p_report,v_summary,p_actor
  );
  update public.smyl_clinical_photo_analysis_requests set
    status='completed',lease_until=null,last_error='',updated_at=clock_timestamp()
   where tenant_id=p_tenant and request_id=btrim(p_request_id);
  return v_summary;
end;
$$;

revoke all on function public.smyl_evidence_register_photo_file(uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb,jsonb)
  from public, anon;
grant execute on function public.smyl_evidence_register_photo_file(uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb,jsonb)
  to authenticated;

revoke all on function public.smyl_evidence_set_photo_disposition(uuid,integer,text,text,text)
  from public, anon;
grant execute on function public.smyl_evidence_set_photo_disposition(uuid,integer,text,text,text)
  to authenticated;

revoke all on function public.smyl_actor_can_access_patient_explicit(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.smyl_actor_can_access_patient_explicit(uuid,uuid,uuid,text)
  to service_role;

revoke all on function public.smyl_reserve_clinical_photo_analysis(uuid,uuid,text,text,uuid[]),
  public.smyl_release_clinical_photo_analysis_request(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.smyl_reserve_clinical_photo_analysis(uuid,uuid,text,text,uuid[]),
  public.smyl_release_clinical_photo_analysis_request(uuid,uuid,text,text)
  to service_role;

revoke all on function public.smyl_store_clinical_photo_ai_analysis(uuid,uuid,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.smyl_store_clinical_photo_ai_analysis(uuid,uuid,text,text,text,jsonb)
  to service_role;

comment on table public.smyl_clinical_photo_analysis_runs is
  'Respuesta canónica e inmutable del análisis fotográfico; las sugerencias quedan pending hasta decisión profesional.';
comment on table public.smyl_clinical_photo_analysis_requests is
  'Reserva interna con lease que evita llamadas concurrentes duplicadas al proveedor de IA.';
comment on table public.smyl_clinical_photo_study_reviews is
  'Historial inmutable del cierre profesional de una fotografía, incluso cuando no es evaluable o no contiene sugerencias.';
comment on function public.smyl_evidence_register_photo_file(uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb,jsonb) is
  'Indexa un original ya verificado sin copiar el archivo ni su ruta privada.';
comment on function public.smyl_evidence_set_photo_disposition(uuid,integer,text,text,text) is
  'Registra con control optimista el cierre profesional de un estudio fotográfico sin inventar hallazgos.';
comment on function public.smyl_actor_can_access_patient_explicit(uuid,uuid,uuid,text) is
  'Comprueba el alcance de un actor real cuando una Edge Function opera con service_role.';
comment on function public.smyl_reserve_clinical_photo_analysis(uuid,uuid,text,text,uuid[]) is
  'Reserva idempotente previa al proveedor; una llave activa nunca ejecuta dos análisis simultáneos.';
comment on function public.smyl_release_clinical_photo_analysis_request(uuid,uuid,text,text) is
  'Libera una reserva fallida para permitir un reintento explícito sin esperar el vencimiento del lease.';
comment on function public.smyl_store_clinical_photo_ai_analysis(uuid,uuid,text,text,text,jsonb) is
  'Entrada service_role para calidad y candidatos de IA; nunca confirma hallazgos.';

commit;
