-- SMYL radiografía asistida — Etapa 1c: informes, firma inmutable, adendas y exportación.
-- El informe sólo puede firmarse con hallazgos confirmados o corregidos por el profesional.
-- Firmado = inmutable (hash); después sólo adendas. Nada se aplica sin autorización.
begin;

create table if not exists public.smyl_radiograph_reports (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  source_id uuid not null,
  status text not null default 'draft' check (status in ('draft','signed')),
  revision integer not null default 1 check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object' and octet_length(document::text) <= 65536),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  signed_by uuid references auth.users(id),
  signed_professional_id uuid,
  signed_at timestamptz,
  signed_hash text check (signed_hash is null or signed_hash ~ '^[a-f0-9]{64}$'),
  unique (tenant_id, id),
  unique (tenant_id, source_id),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade,
  foreign key (tenant_id, signed_professional_id) references public.smyl_professionals(tenant_id, id),
  check ((status = 'signed') = (signed_by is not null and signed_at is not null and signed_hash is not null))
);
create table if not exists public.smyl_radiograph_report_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  report_id uuid not null,
  revision integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, report_id, revision),
  foreign key (tenant_id, report_id) references public.smyl_radiograph_reports(tenant_id, id) on delete cascade
);
create table if not exists public.smyl_radiograph_report_addenda (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  report_id uuid not null,
  content text not null check (char_length(btrim(content)) between 2 and 8000),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, report_id) references public.smyl_radiograph_reports(tenant_id, id) on delete cascade
);

-- Un informe firmado no cambia por ninguna vía (ni siquiera service_role por UPDATE directo).
create or replace function public.smyl_radiograph_guard_report_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then raise exception using errcode = '42501', message = 'Los informes radiográficos no se borran.'; end if;
  if old.status = 'signed' then raise exception using errcode = '42501', message = 'Un informe firmado sólo admite adendas.'; end if;
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.source_id <> old.source_id or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception using errcode = '42501', message = 'La identidad del informe es inmutable.'; end if;
  return new;
end;
$$;
drop trigger if exists smyl_radiograph_reports_guard on public.smyl_radiograph_reports;
create trigger smyl_radiograph_reports_guard before update or delete on public.smyl_radiograph_reports
  for each row execute function public.smyl_radiograph_guard_report_change();
drop trigger if exists smyl_radiograph_report_versions_immutable on public.smyl_radiograph_report_versions;
create trigger smyl_radiograph_report_versions_immutable before update or delete on public.smyl_radiograph_report_versions
  for each row execute function public.smyl_radiograph_forbid_change();
drop trigger if exists smyl_radiograph_report_addenda_immutable on public.smyl_radiograph_report_addenda;
create trigger smyl_radiograph_report_addenda_immutable before update or delete on public.smyl_radiograph_report_addenda
  for each row execute function public.smyl_radiograph_forbid_change();
drop trigger if exists smyl_radiograph_reports_audit on public.smyl_radiograph_reports;
create trigger smyl_radiograph_reports_audit after insert or update on public.smyl_radiograph_reports
  for each row execute function public.smyl_audit_row();

alter table public.smyl_radiograph_reports enable row level security;
alter table public.smyl_radiograph_report_versions enable row level security;
alter table public.smyl_radiograph_report_addenda enable row level security;
revoke all on public.smyl_radiograph_reports, public.smyl_radiograph_report_versions, public.smyl_radiograph_report_addenda from public, anon, authenticated;
grant select on public.smyl_radiograph_reports, public.smyl_radiograph_report_versions, public.smyl_radiograph_report_addenda to authenticated;
drop policy if exists smyl_radiograph_reports_scoped_read on public.smyl_radiograph_reports;
create policy smyl_radiograph_reports_scoped_read on public.smyl_radiograph_reports for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_radiograph_report_versions_scoped_read on public.smyl_radiograph_report_versions;
create policy smyl_radiograph_report_versions_scoped_read on public.smyl_radiograph_report_versions for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and exists (
    select 1 from public.smyl_radiograph_reports r where r.tenant_id = smyl_radiograph_report_versions.tenant_id and r.id = smyl_radiograph_report_versions.report_id
      and public.smyl_can_access_patient(r.tenant_id, r.patient_id, 'clinical')));
drop policy if exists smyl_radiograph_report_addenda_scoped_read on public.smyl_radiograph_report_addenda;
create policy smyl_radiograph_report_addenda_scoped_read on public.smyl_radiograph_report_addenda for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and exists (
    select 1 from public.smyl_radiograph_reports r where r.tenant_id = smyl_radiograph_report_addenda.tenant_id and r.id = smyl_radiograph_report_addenda.report_id
      and public.smyl_can_access_patient(r.tenant_id, r.patient_id, 'clinical')));

-- Contrato del documento (RadiographReportV1). Los hallazgos referencian candidatos (uuid de
-- smyl_radiograph_candidates); el estado de su decisión se comprueba al firmar.
create or replace function public.smyl_radiograph_validate_report(p jsonb, p_strict boolean) returns void
language plpgsql immutable set search_path = pg_catalog, public as $$
declare s jsonb; f jsonb; k text; ids text[] := array[]::text[];
begin
  if jsonb_typeof(p) is distinct from 'object' or p - array['schema','sections','findings'] <> '{}'::jsonb or not (p ?& array['schema','sections','findings'])
     or p->'schema' <> '1'::jsonb or jsonb_typeof(p->'findings') is distinct from 'array' or jsonb_array_length(p->'findings') > 48 then
    raise exception using errcode = '22023', message = 'Informe radiográfico no válido.'; end if;
  s := p->'sections';
  if jsonb_typeof(s) is distinct from 'object' or s - array['description','technicalLimitations','clinicalCorrelation','missingInformation','complementaryStudies'] <> '{}'::jsonb
     or not (s ?& array['description','technicalLimitations','clinicalCorrelation','missingInformation','complementaryStudies']) then
    raise exception using errcode = '22023', message = 'Secciones del informe no válidas.'; end if;
  for k in select jsonb_object_keys(s) loop
    if not public.smyl_radiograph_text_valid(s->k, 0, 4000) then raise exception using errcode = '22023', message = 'Sección del informe demasiado larga.'; end if;
  end loop;
  if p_strict and char_length(btrim(s->>'description')) < 2 then raise exception using errcode = '23514', message = 'Completa la descripción radiográfica antes de firmar.'; end if;
  for f in select value from jsonb_array_elements(p->'findings') loop
    if jsonb_typeof(f) is distinct from 'object' or f - array['candidateId','tooth','text','priority'] <> '{}'::jsonb or not (f ?& array['candidateId','tooth','text','priority'])
       or coalesce(f->>'candidateId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or f->>'candidateId' = any(ids)
       or not (f->'tooth' = 'null'::jsonb or (jsonb_typeof(f->'tooth') = 'string' and public.smyl_radiograph_fdi_valid(f->>'tooth')))
       or not public.smyl_radiograph_text_valid(f->'text', 1, 600) or coalesce(f->>'priority','') not in ('routine','soon','urgent') then
      raise exception using errcode = '22023', message = 'Hallazgo del informe no válido.'; end if;
    ids := array_append(ids, f->>'candidateId');
  end loop;
end;
$$;

create or replace function public.smyl_radiograph_report_hash(p jsonb) returns text
language sql immutable set search_path = pg_catalog as $$ select encode(sha256(convert_to(p::text, 'UTF8')), 'hex'); $$;

create or replace function public.smyl_radiograph_save_report_draft(p_report_id uuid, p_source_id uuid, p_expected_revision integer, p_document jsonb)
returns public.smyl_radiograph_reports
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_source public.smyl_radiograph_sources; v_tenant uuid; v_old public.smyl_radiograph_reports; v_row public.smyl_radiograph_reports;
begin
  select * into v_source from public.smyl_radiograph_sources where id = p_source_id;
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_source.patient_id, 'clinical.write');
  if v_source.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  if not public.smyl_radiograph_flag_enabled('radiograph.report_v1', v_tenant) then
    raise exception using errcode = '42501', message = 'El informe radiográfico no está habilitado para esta clínica.'; end if;
  perform public.smyl_radiograph_validate_report(p_document, false);
  if exists (select 1 from jsonb_array_elements(p_document->'findings') f
             where not exists (select 1 from public.smyl_radiograph_candidates c where c.tenant_id = v_tenant and c.source_id = p_source_id and c.id = (f.value->>'candidateId')::uuid)) then
    raise exception using errcode = '22023', message = 'Un hallazgo referencia un candidato de otra fuente.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('radiograph-report:' || p_source_id::text, 31));
  select * into v_old from public.smyl_radiograph_reports where tenant_id = v_tenant and source_id = p_source_id for update;
  if not found then
    if p_expected_revision <> 0 then raise exception using errcode = 'PT409', message = 'El informe no existe con esa revisión.'; end if;
    insert into public.smyl_radiograph_reports(id, tenant_id, patient_id, source_id, document, created_by, updated_by)
    values (p_report_id, v_tenant, v_source.patient_id, p_source_id, p_document, auth.uid(), auth.uid()) returning * into v_row;
  else
    if v_old.id <> p_report_id then raise exception using errcode = '22023', message = 'La fuente ya tiene otro informe.'; end if;
    if v_old.status = 'signed' then raise exception using errcode = '42501', message = 'Un informe firmado sólo admite adendas.'; end if;
    if v_old.revision = p_expected_revision + 1 and v_old.document = p_document then return v_old; end if;
    if v_old.revision <> p_expected_revision then raise exception using errcode = 'PT409', message = 'El informe cambió en otra sesión. Actualiza la revisión.'; end if;
    update public.smyl_radiograph_reports set revision = v_old.revision + 1, document = p_document, updated_by = auth.uid(), updated_at = clock_timestamp()
    where tenant_id = v_tenant and id = p_report_id returning * into v_row;
  end if;
  insert into public.smyl_radiograph_report_versions(tenant_id, report_id, revision, snapshot, actor_id)
  values (v_tenant, v_row.id, v_row.revision, to_jsonb(v_row) - 'tenant_id', auth.uid());
  perform public.smyl_radiograph_log_event(v_tenant, v_source.patient_id, p_source_id, 'report_draft', v_row.id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_save_report_draft(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.smyl_radiograph_save_report_draft(uuid, uuid, integer, jsonb) to authenticated;

-- Firma: clinical.approve, sólo hallazgos confirmados/corregidos, hash del documento.
create or replace function public.smyl_radiograph_sign_report(p_report_id uuid, p_expected_revision integer)
returns public.smyl_radiograph_reports
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_old public.smyl_radiograph_reports; v_tenant uuid; v_row public.smyl_radiograph_reports; v_bad integer;
begin
  select * into v_old from public.smyl_radiograph_reports where id = p_report_id;
  if not found then raise exception using errcode = '42501', message = 'El informe no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_old.patient_id, 'clinical.approve');
  if v_old.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'El informe no está disponible.'; end if;
  if not public.smyl_radiograph_flag_enabled('radiograph.report_v1', v_tenant) then
    raise exception using errcode = '42501', message = 'El informe radiográfico no está habilitado para esta clínica.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('radiograph-report:' || v_old.source_id::text, 31));
  select * into v_old from public.smyl_radiograph_reports where tenant_id = v_tenant and id = p_report_id for update;
  if v_old.status = 'signed' then
    if v_old.revision = p_expected_revision + 1 then return v_old; end if;
    raise exception using errcode = '42501', message = 'Un informe firmado sólo admite adendas.'; end if;
  if v_old.revision <> p_expected_revision then raise exception using errcode = 'PT409', message = 'El informe cambió en otra sesión. Actualiza la revisión.'; end if;
  perform public.smyl_radiograph_validate_report(v_old.document, true);
  select count(*) into v_bad from jsonb_array_elements(v_old.document->'findings') f
  left join public.smyl_radiograph_decisions d on d.tenant_id = v_tenant and d.candidate_id = (f.value->>'candidateId')::uuid and d.source_id = v_old.source_id
  where d.candidate_id is null or d.state not in ('confirmed','corrected');
  if v_bad > 0 then raise exception using errcode = '23514', message = 'Sólo se firman hallazgos confirmados o corregidos; retira los pendientes o descartados.'; end if;
  update public.smyl_radiograph_reports set status = 'signed', revision = v_old.revision + 1, signed_by = auth.uid(),
    signed_professional_id = public.smyl_current_professional_id(v_tenant), signed_at = clock_timestamp(),
    signed_hash = public.smyl_radiograph_report_hash(v_old.document), updated_by = auth.uid(), updated_at = clock_timestamp()
  where tenant_id = v_tenant and id = p_report_id returning * into v_row;
  insert into public.smyl_radiograph_report_versions(tenant_id, report_id, revision, snapshot, actor_id)
  values (v_tenant, v_row.id, v_row.revision, to_jsonb(v_row) - 'tenant_id', auth.uid());
  perform public.smyl_radiograph_log_event(v_tenant, v_row.patient_id, v_row.source_id, 'sign_report', v_row.id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_sign_report(uuid, integer) from public, anon;
grant execute on function public.smyl_radiograph_sign_report(uuid, integer) to authenticated;

create or replace function public.smyl_radiograph_add_report_addendum(p_report_id uuid, p_content text, p_reason text)
returns public.smyl_radiograph_report_addenda
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_report public.smyl_radiograph_reports; v_tenant uuid; v_row public.smyl_radiograph_report_addenda;
begin
  select * into v_report from public.smyl_radiograph_reports where id = p_report_id;
  if not found then raise exception using errcode = '42501', message = 'El informe no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_report.patient_id, 'clinical.approve');
  if v_report.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'El informe no está disponible.'; end if;
  if v_report.status <> 'signed' then raise exception using errcode = '23514', message = 'Las adendas sólo se agregan a informes firmados.'; end if;
  insert into public.smyl_radiograph_report_addenda(tenant_id, report_id, content, reason, created_by)
  values (v_tenant, p_report_id, p_content, p_reason, auth.uid()) returning * into v_row;
  perform public.smyl_radiograph_log_event(v_tenant, v_report.patient_id, v_report.source_id, 'addendum', v_row.id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_add_report_addendum(uuid, text, text) from public, anon;
grant execute on function public.smyl_radiograph_add_report_addendum(uuid, text, text) to authenticated;

-- Exportación con trazabilidad (original, motor, versiones, decisiones, adendas). Audita.
create or replace function public.smyl_radiograph_export_report(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_report public.smyl_radiograph_reports; v_tenant uuid; v_source public.smyl_radiograph_sources;
begin
  select * into v_report from public.smyl_radiograph_reports where id = p_report_id;
  if not found then raise exception using errcode = '42501', message = 'El informe no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_report.patient_id, 'clinical.read');
  if v_report.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'El informe no está disponible.'; end if;
  if v_report.status <> 'signed' then raise exception using errcode = '23514', message = 'Sólo se exportan informes firmados.'; end if;
  select * into v_source from public.smyl_radiograph_sources where tenant_id = v_tenant and id = v_report.source_id;
  perform public.smyl_radiograph_log_event(v_tenant, v_report.patient_id, v_report.source_id, 'export', v_report.id);
  return jsonb_build_object(
    'schema', 1,
    'report', to_jsonb(v_report) - 'tenant_id',
    'source', jsonb_build_object('id', v_source.id, 'sha256', v_source.sha256, 'mimeType', v_source.mime_type, 'sizeBytes', v_source.size_bytes,
      'studyTypeDeclared', v_source.study_type_declared, 'capturedAt', v_source.captured_at,
      'studyTypeCurrent', coalesce((select c.value from public.smyl_radiograph_source_corrections c where c.tenant_id = v_tenant and c.source_id = v_source.id order by c.created_at desc limit 1), v_source.study_type_declared)),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'engine', r.engine, 'contractVersion', r.contract_version, 'status', r.status, 'completedAt', r.completed_at) order by r.requested_at)
      from public.smyl_radiograph_ai_runs r where r.tenant_id = v_tenant and r.source_id = v_source.id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('candidateId', d.candidate_id, 'state', d.state, 'revision', d.revision, 'payload', d.payload, 'decidedBy', d.decided_by, 'decidedAt', d.decided_at))
      from public.smyl_radiograph_decisions d where d.tenant_id = v_tenant and d.source_id = v_source.id), '[]'::jsonb),
    'addenda', coalesce((select jsonb_agg(to_jsonb(a) - 'tenant_id' order by a.created_at) from public.smyl_radiograph_report_addenda a where a.tenant_id = v_tenant and a.report_id = v_report.id), '[]'::jsonb),
    'notice', 'Revisión asistida: los hallazgos provienen de decisiones profesionales confirmadas. No constituye diagnóstico automático.'
  );
end;
$$;
revoke all on function public.smyl_radiograph_export_report(uuid) from public, anon;
grant execute on function public.smyl_radiograph_export_report(uuid) to authenticated;

comment on table public.smyl_radiograph_reports is 'Informe radiográfico profesional: borrador versionado, firma con hash inmutable, adendas.';
commit;
