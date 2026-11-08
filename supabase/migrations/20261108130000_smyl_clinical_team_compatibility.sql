-- SMYL · Compatibilidad segura del expediente/radiografías heredados con roles clínicos.
-- No cambia la fuente de verdad ni relaja RLS: tenant, actor y alcance del paciente
-- se resuelven siempre del JWT y de las asignaciones del servidor.
begin;

-- Storage heredado: la lectura requiere clinical.read; la carga, clinical.write.
-- El cuarto segmento sigue siendo el SHA-256 y los originales continúan sin update/delete.
create or replace function public.smyl_radiograph_path_allowed(p_name text, p_permission text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_patient uuid;
begin
  if auth.uid() is null or v_tenant is null
     or p_permission not in ('clinical.read','clinical.write')
     or not public.smyl_has_permission(v_tenant,p_permission)
     or p_name !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(png|jpeg)$'
     or split_part(p_name,'/',1) <> v_tenant::text then
    return false;
  end if;
  begin
    v_patient := split_part(p_name,'/',2)::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists(
    select 1 from public.camila_pacientes p
    where p.tenant_id=v_tenant and p.id=v_patient
  ) and public.smyl_can_access_patient(v_tenant,v_patient,'clinical');
end;
$$;
revoke all on function public.smyl_radiograph_path_allowed(text,text) from public,anon;
grant execute on function public.smyl_radiograph_path_allowed(text,text) to authenticated;

-- Compatibilidad para cualquier llamada heredada: esta firma sólo representa lectura.
create or replace function public.smyl_radiograph_path(p_name text)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select public.smyl_radiograph_path_allowed(p_name,'clinical.read');
$$;
revoke all on function public.smyl_radiograph_path(text) from public,anon;
grant execute on function public.smyl_radiograph_path(text) to authenticated;

drop policy if exists rx_read on storage.objects;
drop policy if exists rx_insert on storage.objects;
drop policy if exists rx_read_guard on storage.objects;
drop policy if exists rx_insert_guard on storage.objects;

create policy rx_read on storage.objects for select to authenticated
  using(
    bucket_id='smyl-radiographs'
    and public.smyl_radiograph_path_allowed(name,'clinical.read')
    and public.smyl_file_is_usable(bucket_id,name)
  );
create policy rx_insert on storage.objects for insert to authenticated
  with check(
    bucket_id='smyl-radiographs'
    and public.smyl_radiograph_path_allowed(name,'clinical.write')
  );
-- Las guardas restrictivas impiden que una política permisiva futura abra el bucket
-- sin respetar alcance del paciente o cuarentena.
create policy rx_read_guard on storage.objects as restrictive for select to public
  using(
    bucket_id<>'smyl-radiographs'
    or (
      auth.uid() is not null
      and public.smyl_radiograph_path_allowed(name,'clinical.read')
      and public.smyl_file_is_usable(bucket_id,name)
    )
  );
create policy rx_insert_guard on storage.objects as restrictive for insert to public
  with check(
    bucket_id<>'smyl-radiographs'
    or (
      auth.uid() is not null
      and public.smyl_radiograph_path_allowed(name,'clinical.write')
    )
  );

-- Expediente dental heredado: conserva su contrato y validaciones, pero separa
-- la clínica (current_tenant) de la persona que guarda (auth.uid).
create or replace function public.smyl_save_dental_record(p_patient_id uuid,p_expected_revision integer,p_document jsonb)
returns public.smyl_dental_records language plpgsql security definer set search_path = pg_catalog, public as $$
declare
 v_tenant uuid:=public.smyl_current_tenant(); v_actor uuid:=auth.uid(); result public.smyl_dental_records;
 item jsonb; k text; a jsonb; mark jsonb; seen text[]:=array[]::text[]; mark_ids text[];
 expected text; metadata jsonb; old_study jsonb;
begin
 if v_actor is null or v_tenant is null
    or not public.smyl_has_permission(v_tenant,'clinical.write')
    or not exists(select 1 from public.camila_pacientes where id=p_patient_id and tenant_id=v_tenant)
    or not public.smyl_can_access_patient(v_tenant,p_patient_id,'clinical')
 then raise exception 'Dental access denied' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 or p_document is null
 or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>500000
 or p_document-array['schema','teeth','studies']<>'{}'::jsonb or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'teeth') is distinct from 'object' or jsonb_typeof(p_document->'studies') is distinct from 'array'
 then raise exception 'Invalid dental record' using errcode='22023'; end if;
 if jsonb_array_length(p_document->'studies')>20 then raise exception 'Too many studies' using errcode='22023'; end if;
 for k,item in select key,value from jsonb_each(p_document->'teeth') loop
  if k !~ '^[1-4][1-8]$' or jsonb_typeof(item) is distinct from 'object'
   or item-array['observation','action','status']<>'{}'::jsonb
   or jsonb_typeof(item->'observation') is distinct from 'string' or length(item->>'observation')>2000
   or jsonb_typeof(item->'action') is distinct from 'string' or length(item->>'action')>2000
   or coalesce(item->>'status','') not in ('pending','following','done')
  then raise exception 'Invalid tooth note' using errcode='22023'; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_document->'studies') loop
  if jsonb_typeof(item) is distinct from 'object' or item-array['id','type','label','date','asset','notes','marks']<>'{}'::jsonb
   or coalesce(item->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or (item->>'id')=any(seen) or coalesce(item->>'type','') not in ('panoramic','periapical','bitewing','other')
   or jsonb_typeof(item->'label') is distinct from 'string' or length(item->>'label')>100
   or jsonb_typeof(item->'notes') is distinct from 'string' or length(item->>'notes')>4000
   or jsonb_typeof(item->'date') is distinct from 'string' or (item->>'date'<>'' and item->>'date' !~ '^\d{4}-\d{2}-\d{2}$')
   or jsonb_typeof(item->'marks') is distinct from 'array'
  then raise exception 'Invalid study' using errcode='22023'; end if;
  seen:=array_append(seen,item->>'id');
  if item->>'date'<>'' then perform (item->>'date')::date; end if;
  a:=item->'asset';
  if a is null or jsonb_typeof(a) is distinct from 'object' or a-array['path','sha256','mime','bytes']<>'{}'::jsonb
   or coalesce(a->>'sha256','') !~ '^[0-9a-f]{64}$' or coalesce(a->>'mime','') not in ('image/png','image/jpeg')
   or jsonb_typeof(a->'bytes') is distinct from 'number' or coalesce(a->>'bytes','') !~ '^[0-9]{1,8}$'
  then raise exception 'Invalid radiograph' using errcode='22023'; end if;
  if (a->>'bytes')::bigint not between 16 and 20971520 then raise exception 'Invalid size' using errcode='22023'; end if;
  expected:=v_tenant::text||'/'||p_patient_id::text||'/'||(item->>'id')||'/'||(a->>'sha256')||'.'||split_part(a->>'mime','/',2);
  if a->>'path' is distinct from expected then raise exception 'Foreign radiograph' using errcode='42501'; end if;
  select o.metadata into metadata from storage.objects o where bucket_id='smyl-radiographs' and name=expected;
  if not found or metadata->>'mimetype' is distinct from a->>'mime' or (metadata->>'size')::bigint is distinct from (a->>'bytes')::bigint
  then raise exception 'Radiograph unavailable' using errcode='22023'; end if;
  if jsonb_array_length(item->'marks')>50 then raise exception 'Too many marks' using errcode='22023'; end if;
  mark_ids:=array[]::text[];
  for mark in select value from jsonb_array_elements(item->'marks') loop
   if jsonb_typeof(mark) is distinct from 'object' or mark-array['id','x','y','tooth','note']<>'{}'::jsonb
    or coalesce(mark->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (mark->>'id')=any(mark_ids)
    or jsonb_typeof(mark->'x') is distinct from 'number' or jsonb_typeof(mark->'y') is distinct from 'number'
    or jsonb_typeof(mark->'note') is distinct from 'string' or length(mark->>'note')>2000
    or jsonb_typeof(mark->'tooth') is distinct from 'string' or (mark->>'tooth'<>'' and mark->>'tooth' !~ '^[1-4][1-8]$')
   then raise exception 'Invalid mark' using errcode='22023'; end if;
   if (mark->>'x')::numeric not between 0 and 1 or (mark->>'y')::numeric not between 0 and 1 then raise exception 'Invalid coordinates' using errcode='22023'; end if;
   mark_ids:=array_append(mark_ids,mark->>'id');
  end loop;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended(p_patient_id::text,13));
 select * into result from public.smyl_dental_records where tenant_id=v_tenant and patient_id=p_patient_id for update;
 -- Idempotent acknowledgement of a successful save whose response was lost.
 if result.revision=p_expected_revision+1 and result.document=p_document then return result; end if;
 if coalesce(result.revision,0)<>p_expected_revision then raise exception 'Dental revision conflict' using errcode='40001'; end if;
 for old_study in select value from jsonb_array_elements(coalesce(result.document->'studies','[]'::jsonb)) loop
  if not exists(select 1 from jsonb_array_elements(p_document->'studies') v where v->>'id'=old_study->>'id' and v->'asset'=old_study->'asset')
  then raise exception 'Original radiographs are immutable' using errcode='22023'; end if;
 end loop;
 insert into public.smyl_dental_records(patient_id,tenant_id,revision,document,updated_by,updated_at)
 values(p_patient_id,v_tenant,p_expected_revision+1,p_document,v_actor,clock_timestamp())
 on conflict(patient_id) do update set revision=excluded.revision,document=excluded.document,updated_by=excluded.updated_by,updated_at=excluded.updated_at
   where smyl_dental_records.tenant_id=excluded.tenant_id
 returning * into result;
 if result.patient_id is null then raise exception 'Dental access denied' using errcode='42501'; end if;
 insert into public.smyl_dental_versions select result.*;
 return result;
end;
$$;
revoke all on function public.smyl_save_dental_record(uuid,integer,jsonb) from public,anon;
grant execute on function public.smyl_save_dental_record(uuid,integer,jsonb) to authenticated;

-- Guarda reutilizable para cualquier Edge Function clínica futura. Debe invocarse
-- con el JWT de la persona (no con service_role) y con source_id cuando exista.
-- La migración NO cambia ninguna Edge Function ni abre el proveedor de IA.
create or replace function public.smyl_authorize_clinical_ai(p_patient_id uuid,p_source_id uuid default null)
returns uuid language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid;
begin
  v_tenant:=public.smyl_radiograph_guard(p_patient_id,'clinical.write');
  perform public.smyl_radiograph_guard(p_patient_id,'clinical.approve');
  if p_source_id is not null and not exists(
    select 1 from public.smyl_radiograph_sources s
    where s.tenant_id=v_tenant and s.patient_id=p_patient_id and s.id=p_source_id
  ) then
    raise exception using errcode='42501',message='La fuente radiográfica no está disponible.';
  end if;
  return v_tenant;
end;
$$;
revoke all on function public.smyl_authorize_clinical_ai(uuid,uuid) from public,anon;
grant execute on function public.smyl_authorize_clinical_ai(uuid,uuid) to authenticated;

-- Solicitar una ejecución conserva banderas, motor, QC, topes, idempotencia y
-- tratamiento de estados inciertos; sólo añade clinical.approve al permiso de escritura.
create or replace function public.smyl_radiograph_request_ai_run(p_source_id uuid, p_kind text, p_acknowledge_unconfirmed boolean default false)
returns public.smyl_radiograph_ai_runs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_source public.smyl_radiograph_sources; v_tenant uuid; v_engine record; v_flag text; v_key text; v_row public.smyl_radiograph_ai_runs; v_qc jsonb;
begin
  if p_kind not in ('qc','tooth_localization','finding_candidates') then raise exception using errcode = '22023', message = 'Tipo de análisis desconocido.'; end if;
  select * into v_source from public.smyl_radiograph_sources where id = p_source_id and tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_authorize_clinical_ai(v_source.patient_id,p_source_id);
  if v_source.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_flag := case when p_kind = 'qc' then 'radiograph.qc_v2' else 'radiograph.tooth_ai_v1' end;
  if not public.smyl_radiograph_flag_enabled(v_flag, v_tenant) then
    raise exception using errcode = '42501', message = 'Este análisis radiográfico no está habilitado para esta clínica.'; end if;
  select * into v_engine from public.smyl_radiograph_active_engine(p_kind);
  if not found then raise exception using errcode = '42501', message = 'No hay un motor activo para este análisis.'; end if;
  if p_kind <> 'qc' then
    select r.output into v_qc from public.smyl_radiograph_ai_runs r
    where r.tenant_id = v_tenant and r.source_id = p_source_id and r.kind = 'qc' and r.status = 'completed'
    order by r.completed_at desc limit 1;
    if v_qc is null or v_qc->'quality'->>'status' = 'unusable' or not (v_qc->'applicableAnalyses' ? p_kind) then
      raise exception using errcode = '23514', message = 'El control de calidad no habilita este análisis para esta imagen.'; end if;
  end if;
  v_key := encode(sha256(convert_to(v_source.sha256 || '|' || v_engine.provider || '|' || v_engine.name || '|' || v_engine.version || '|' || v_engine.contract_version::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('radiograph-run:' || p_source_id::text || p_kind, 31));
  update public.smyl_radiograph_ai_runs set status = 'unconfirmed', failure_code = 'timeout', completed_at = clock_timestamp()
  where tenant_id = v_tenant and source_id = p_source_id and kind = p_kind and status = 'requested' and claimed_at is not null and claimed_at < clock_timestamp() - interval '5 minutes';
  update public.smyl_radiograph_ai_runs set status = 'failed', failure_code = 'provider_error', completed_at = clock_timestamp()
  where tenant_id = v_tenant and source_id = p_source_id and kind = p_kind and status = 'requested' and claimed_at is null and requested_at < clock_timestamp() - interval '30 minutes';
  select * into v_row from public.smyl_radiograph_ai_runs
  where tenant_id = v_tenant and source_id = p_source_id and kind = p_kind and idempotency_key = v_key and status in ('requested','completed');
  if found then return v_row; end if;
  if (select count(*) from public.smyl_radiograph_ai_runs r where r.tenant_id = v_tenant and r.requested_at > clock_timestamp() - interval '24 hours')
       >= coalesce((public.smyl_radiograph_setting('daily_run_cap'))::integer, 500) then
    raise exception using errcode = '23514', message = 'La clínica alcanzó el tope diario de ejecuciones del motor.'; end if;
  if (select count(*) from public.smyl_radiograph_ai_runs r where r.tenant_id = v_tenant and r.source_id = p_source_id and r.kind = p_kind and r.idempotency_key = v_key
        and r.status = 'failed' and r.requested_at > clock_timestamp() - interval '24 hours') >= coalesce((public.smyl_radiograph_setting('failed_retry_cap'))::integer, 3) then
    raise exception using errcode = '23514', message = 'Esta imagen falló varias veces con el motor; revisa la calidad o contacta a soporte antes de reintentar.'; end if;
  if not p_acknowledge_unconfirmed and exists (
    select 1 from public.smyl_radiograph_ai_runs where tenant_id = v_tenant and source_id = p_source_id and kind = p_kind and idempotency_key = v_key and status = 'unconfirmed') then
    raise exception using errcode = '23514', message = 'Hay una ejecución sin confirmar; revísala antes de solicitar otra.'; end if;
  insert into public.smyl_radiograph_ai_runs(tenant_id, patient_id, source_id, kind, engine_id, engine, contract_version, idempotency_key, requested_by)
  values (v_tenant, v_source.patient_id, p_source_id, p_kind, v_engine.id,
    jsonb_build_object('provider', v_engine.provider, 'name', v_engine.name, 'version', v_engine.version), v_engine.contract_version, v_key, auth.uid())
  returning * into v_row;
  perform public.smyl_radiograph_log_event(v_tenant, v_source.patient_id, p_source_id, 'send_to_engine', v_row.id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_request_ai_run(uuid,text,boolean) from public,anon;
grant execute on function public.smyl_radiograph_request_ai_run(uuid,text,boolean) to authenticated;

-- La decisión profesional conserva todas las validaciones y además exige write+approve.
create or replace function public.smyl_radiograph_decide_candidate(p_candidate_id uuid, p_expected_revision integer, p_state text, p_payload jsonb default '{}'::jsonb, p_note text default '')
returns public.smyl_radiograph_decisions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_candidate public.smyl_radiograph_candidates; v_tenant uuid; v_old public.smyl_radiograph_decisions; v_row public.smyl_radiograph_decisions;
  v_payload jsonb := case when p_payload is null or p_payload = 'null'::jsonb then '{}'::jsonb else p_payload end;
begin
  if p_state is null or p_state not in ('confirmed','corrected','rejected') then raise exception using errcode = '22023', message = 'Estado de decisión no válido.'; end if;
  if p_expected_revision is null then raise exception using errcode = '22023', message = 'Indica la revisión que estás decidiendo.'; end if;
  select * into v_candidate from public.smyl_radiograph_candidates where id = p_candidate_id and tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'El candidato no está disponible.'; end if;
  v_tenant := public.smyl_authorize_clinical_ai(v_candidate.patient_id,v_candidate.source_id);
  if v_candidate.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'El candidato no está disponible.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('radiograph-decision:' || p_candidate_id::text, 31));
  select * into v_old from public.smyl_radiograph_decisions where tenant_id = v_tenant and candidate_id = p_candidate_id for update;
  if not found then raise exception using errcode = '42501', message = 'El candidato no está disponible.'; end if;
  if exists (select 1 from public.smyl_radiograph_reports r where r.tenant_id = v_tenant and r.source_id = v_candidate.source_id and r.status = 'signed'
             and r.document->'findings' @> jsonb_build_array(jsonb_build_object('candidateId', p_candidate_id::text))) then
    raise exception using errcode = '23514', message = 'El hallazgo forma parte de un informe firmado; registra una adenda.'; end if;
  if p_state <> 'corrected' then
    if v_payload <> '{}'::jsonb then raise exception using errcode = '22023', message = 'Sólo una corrección lleva datos.'; end if;
  else
    if jsonb_typeof(v_payload) is distinct from 'object' or v_payload = '{}'::jsonb or v_payload - array['fdi','label','geometry','visibility'] <> '{}'::jsonb
       or (v_payload ? 'fdi' and not (v_payload->'fdi' = 'null'::jsonb or (jsonb_typeof(v_payload->'fdi') = 'string' and public.smyl_radiograph_fdi_valid(v_payload->>'fdi'))))
       or (v_payload ? 'label' and not public.smyl_radiograph_text_valid(v_payload->'label', 1, 200))
       or (v_payload ? 'geometry' and not public.smyl_radiograph_geometry_valid(v_payload->'geometry', false))
       or (v_payload ? 'visibility' and coalesce(v_payload->>'visibility', '') not in ('complete','partial','not_evaluable')) then
      raise exception using errcode = '22023', message = 'Corrección no válida.'; end if;
  end if;
  if coalesce(p_note, '') <> '' and not public.smyl_radiograph_text_valid(to_jsonb(p_note), 0, 600) then raise exception using errcode = '22023', message = 'Nota demasiado larga.'; end if;
  if p_expected_revision is not null and v_old.revision = p_expected_revision + 1 and v_old.state = p_state and v_old.payload = v_payload and v_old.note = coalesce(p_note, '') then return v_old; end if;
  if v_old.revision is distinct from p_expected_revision then raise exception using errcode = 'PT409', message = 'La decisión cambió en otra sesión. Actualiza la revisión.'; end if;
  update public.smyl_radiograph_decisions set revision = v_old.revision + 1, state = p_state, payload = v_payload, note = coalesce(p_note, ''),
    decided_by = auth.uid(), decided_at = clock_timestamp() where tenant_id = v_tenant and candidate_id = p_candidate_id returning * into v_row;
  insert into public.smyl_radiograph_decision_versions(tenant_id, candidate_id, revision, snapshot, actor_id)
  values (v_tenant, p_candidate_id, v_row.revision, to_jsonb(v_row) - 'tenant_id', auth.uid());
  perform public.smyl_radiograph_log_event(v_tenant, v_candidate.patient_id, v_candidate.source_id, 'decide', p_candidate_id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_decide_candidate(uuid,integer,text,jsonb,text) from public,anon;
grant execute on function public.smyl_radiograph_decide_candidate(uuid,integer,text,jsonb,text) to authenticated;

comment on function public.smyl_authorize_clinical_ai(uuid,uuid) is
  'Guarda de write+approve y alcance de paciente/fuente. Debe llamarse con el JWT del actor; no sustituye la autorización de una Edge Function.';

commit;
