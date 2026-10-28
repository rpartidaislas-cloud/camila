-- SMYL radiografía asistida — Etapa 1a: fuentes inmutables, correcciones, vínculos y auditoría.
-- La fuente v2 referencia el estudio v1 ya guardado en smyl_dental_records.document.studies:
-- el archivo original, su hash y su ruta privada no se vuelven a subir ni se aceptan desde el
-- navegador; se copian desde el expediente al registrar. Nada se aplica sin autorización.
begin;

-- Reutilizable: bloquea UPDATE/DELETE directos en tablas de evidencia inmutable. El DELETE en
-- cascada (borrado del paciente o de la clínica) sí pasa: la evidencia sigue el ciclo de vida
-- del expediente al que pertenece (pg_trigger_depth() > 1 sólo ocurre dentro de la cascada RI).
create or replace function public.smyl_radiograph_forbid_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception using errcode = '42501', message = format('%s es inmutable.', tg_table_name);
end;
$$;

-- Recorte alineado con String.prototype.trim (espacios, saltos, NBSP, BOM y espacios Unicode).
create or replace function public.smyl_radiograph_trim(p text) returns text
language sql immutable set search_path = pg_catalog as $$
  select regexp_replace(p, '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$', '', 'g');
$$;

-- Auditoría ligera: sólo ids, estado y revisión. Nunca copia el documento clínico, el consentimiento
-- ni rutas de Storage a smyl_audit_events (smyl_audit_row copia la fila completa).
create or replace function public.smyl_radiograph_audit_lean()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row jsonb := to_jsonb(new);
begin
  insert into public.smyl_audit_events(tenant_id, actor_id, action, entity_type, entity_id, after_data)
  values ((v_row->>'tenant_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, coalesce(v_row->>'id', ''),
    jsonb_strip_nulls(jsonb_build_object('status', v_row->'status', 'revision', v_row->'revision', 'patient_id', v_row->'patient_id', 'source_id', coalesce(v_row->'source_id', v_row->'id'))));
  return new;
end;
$$;
revoke all on function public.smyl_radiograph_audit_lean() from public, anon, authenticated;

revoke all on function public.smyl_radiograph_trim(text), public.smyl_radiograph_forbid_change() from public, anon, authenticated;

create table if not exists public.smyl_radiograph_sources (
  id uuid primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  study_id uuid not null,
  bucket text not null default 'smyl-radiographs' check (bucket = 'smyl-radiographs'),
  storage_path text not null check (
    char_length(storage_path) between 10 and 900
    and storage_path !~ '^[a-z]+://' and storage_path !~ '(^|/)\.\.?(/|$)' and storage_path !~ '^/'
  ),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg','image/png')),
  size_bytes bigint not null check (size_bytes between 16 and 20971520),
  width integer check (width is null or width between 64 and 12000),
  height integer check (height is null or height between 64 and 12000),
  study_type_declared text not null check (study_type_declared in ('panoramic','periapical','bitewing','intraoral_series','unknown')),
  captured_at timestamptz,
  consent jsonb not null check (
    jsonb_typeof(consent) = 'object' and octet_length(consent::text) <= 2048
    and consent ?& array['version','acceptedAt'] and jsonb_typeof(consent->'version') = 'number'
  ),
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object' and octet_length(provenance::text) <= 4096),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, patient_id, study_id, sha256),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade
);
create index if not exists smyl_radiograph_sources_patient_idx
  on public.smyl_radiograph_sources(tenant_id, patient_id, created_at desc);

-- Corrección profesional del tipo de estudio: append-only, nunca altera la fuente ni la
-- salida del modelo. El tipo vigente es la última corrección o, si no hay, el declarado.
create table if not exists public.smyl_radiograph_source_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  source_id uuid not null,
  field text not null check (field in ('study_type')),
  value text not null check (value in ('panoramic','periapical','bitewing','intraoral_series','unknown')),
  reason text not null default '' check (char_length(reason) <= 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade
);
create index if not exists smyl_radiograph_source_corrections_idx
  on public.smyl_radiograph_source_corrections(tenant_id, source_id, created_at desc);

-- Vínculos longitudinales entre fuentes comparables del mismo paciente (Etapa 6 los escribe).
create table if not exists public.smyl_radiograph_study_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  source_a uuid not null,
  source_b uuid not null,
  link_kind text not null check (link_kind in ('comparable','incompatible')),
  reason text not null check (char_length(btrim(reason)) between 2 and 500),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  check (source_a < source_b),
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_a) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_b) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade
);
-- Un solo vínculo vigente por par; los revocados se conservan como historial.
create unique index if not exists smyl_radiograph_study_links_active_idx
  on public.smyl_radiograph_study_links(tenant_id, source_a, source_b) where revoked_at is null;

-- Auditoría de acceso y exportación (quién abrió, envió al motor, decidió, firmó, exportó).
create table if not exists public.smyl_radiograph_access_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  source_id uuid not null,
  action text not null check (action in ('register','open','send_to_engine','engine_result','correct','decide','report_draft','sign_report','addendum','export','compare')),
  actor_id uuid, -- sin FK: la evidencia de auditoría no se reescribe si se elimina al usuario
  reference_id uuid,
  request_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade
);
create index if not exists smyl_radiograph_access_events_idx
  on public.smyl_radiograph_access_events(tenant_id, source_id, created_at desc);

drop trigger if exists smyl_radiograph_sources_immutable on public.smyl_radiograph_sources;
create trigger smyl_radiograph_sources_immutable before update or delete on public.smyl_radiograph_sources
  for each row execute function public.smyl_radiograph_forbid_change();
drop trigger if exists smyl_radiograph_source_corrections_immutable on public.smyl_radiograph_source_corrections;
create trigger smyl_radiograph_source_corrections_immutable before update or delete on public.smyl_radiograph_source_corrections
  for each row execute function public.smyl_radiograph_forbid_change();
drop trigger if exists smyl_radiograph_access_events_immutable on public.smyl_radiograph_access_events;
create trigger smyl_radiograph_access_events_immutable before update or delete on public.smyl_radiograph_access_events
  for each row execute function public.smyl_radiograph_forbid_change();
drop trigger if exists smyl_radiograph_sources_audit on public.smyl_radiograph_sources;
create trigger smyl_radiograph_sources_audit after insert on public.smyl_radiograph_sources
  for each row execute function public.smyl_radiograph_audit_lean();
-- Vínculos: sólo se puede revocar (una vez); nada más cambia ni se borra directamente.
create or replace function public.smyl_radiograph_guard_link_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception using errcode = '42501', message = 'Los vínculos entre estudios no se borran.';
  end if;
  if old.revoked_at is null and new.revoked_at is not null and (to_jsonb(new) - 'revoked_at' - 'revoked_by') = (to_jsonb(old) - 'revoked_at' - 'revoked_by') then return new; end if;
  raise exception using errcode = '42501', message = 'Un vínculo sólo puede revocarse.';
end;
$$;
drop trigger if exists smyl_radiograph_study_links_guard on public.smyl_radiograph_study_links;
create trigger smyl_radiograph_study_links_guard before update or delete on public.smyl_radiograph_study_links
  for each row execute function public.smyl_radiograph_guard_link_change();

alter table public.smyl_radiograph_sources enable row level security;
alter table public.smyl_radiograph_source_corrections enable row level security;
alter table public.smyl_radiograph_study_links enable row level security;
alter table public.smyl_radiograph_access_events enable row level security;
revoke all on public.smyl_radiograph_sources, public.smyl_radiograph_source_corrections,
  public.smyl_radiograph_study_links, public.smyl_radiograph_access_events from public, anon, authenticated;
-- TRUNCATE no dispara triggers de fila: ni una llave de servicio comprometida vacía la evidencia.
revoke truncate on public.smyl_radiograph_sources, public.smyl_radiograph_source_corrections,
  public.smyl_radiograph_study_links, public.smyl_radiograph_access_events from service_role;
grant select on public.smyl_radiograph_sources, public.smyl_radiograph_source_corrections,
  public.smyl_radiograph_study_links, public.smyl_radiograph_access_events to authenticated;

drop policy if exists smyl_radiograph_sources_scoped_read on public.smyl_radiograph_sources;
create policy smyl_radiograph_sources_scoped_read on public.smyl_radiograph_sources for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_radiograph_source_corrections_scoped_read on public.smyl_radiograph_source_corrections;
create policy smyl_radiograph_source_corrections_scoped_read on public.smyl_radiograph_source_corrections for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and exists (
    select 1 from public.smyl_radiograph_sources s
    where s.tenant_id = smyl_radiograph_source_corrections.tenant_id and s.id = smyl_radiograph_source_corrections.source_id
      and public.smyl_can_access_patient(s.tenant_id, s.patient_id, 'clinical')));
drop policy if exists smyl_radiograph_study_links_scoped_read on public.smyl_radiograph_study_links;
create policy smyl_radiograph_study_links_scoped_read on public.smyl_radiograph_study_links for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_radiograph_access_events_audit_read on public.smyl_radiograph_access_events;
create policy smyl_radiograph_access_events_audit_read on public.smyl_radiograph_access_events for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'audit.read'));

-- Guardia común: tenant activo, permiso y alcance del paciente. Devuelve el tenant.
create or replace function public.smyl_radiograph_guard(p_patient uuid, p_permission text)
returns uuid language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, p_permission) then
    raise exception using errcode = '42501', message = 'No tienes permiso para esta acción radiográfica.';
  end if;
  if not exists (select 1 from public.camila_pacientes p where p.tenant_id = v_tenant and p.id = p_patient)
     or not public.smyl_can_access_patient(v_tenant, p_patient, 'clinical') then
    raise exception using errcode = '42501', message = 'El paciente no está disponible para tu rol.';
  end if;
  return v_tenant;
end;
$$;
revoke all on function public.smyl_radiograph_guard(uuid, text) from public, anon, authenticated;

create or replace function public.smyl_radiograph_log_event(p_tenant uuid, p_patient uuid, p_source uuid, p_action text, p_reference uuid default null)
returns void language sql security definer set search_path = pg_catalog, public as $$
  insert into public.smyl_radiograph_access_events(tenant_id, patient_id, source_id, action, actor_id, reference_id)
  values (p_tenant, p_patient, p_source, p_action, auth.uid(), p_reference);
$$;
revoke all on function public.smyl_radiograph_log_event(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- Registra una fuente v2 a partir del estudio v1 del expediente. El navegador sólo manda
-- ids: ruta, hash, MIME y tamaño se copian del expediente guardado. Idempotente por hash.
create or replace function public.smyl_radiograph_register_source(
  p_source_id uuid, p_patient_id uuid, p_study_id uuid, p_study_type text, p_consent jsonb, p_captured_at timestamptz default null
) returns public.smyl_radiograph_sources
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_radiograph_guard(p_patient_id, 'clinical.write'); v_study jsonb; v_row public.smyl_radiograph_sources;
begin
  if not public.smyl_radiograph_flag_enabled('radiograph.qc_v2', v_tenant) then
    raise exception using errcode = '42501', message = 'La revisión radiográfica v2 no está habilitada para esta clínica.';
  end if;
  if p_source_id is null or p_study_id is null then raise exception using errcode = '22023', message = 'Faltan identificadores.'; end if;
  -- El cliente sólo atestigua la versión y el hash del texto mostrado; fecha y persona las sella el servidor.
  if jsonb_typeof(p_consent) is distinct from 'object' or p_consent->'version' is distinct from '1'::jsonb
     or coalesce(p_consent->>'textHash', '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Consentimiento no válido.'; end if;
  select value into v_study from public.smyl_dental_records d, jsonb_array_elements(d.document->'studies')
  where d.tenant_id = v_tenant and d.patient_id = p_patient_id and value->>'id' = p_study_id::text;
  if v_study is null then raise exception using errcode = '42501', message = 'El estudio no pertenece al expediente.'; end if;
  if coalesce(v_study->'asset'->>'path', '') not like (v_tenant::text || '/' || p_patient_id::text || '/%') then
    raise exception using errcode = '42501', message = 'La ruta del archivo no pertenece a este paciente.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('radiograph-source:' || p_patient_id::text || p_study_id::text, 31));
  select * into v_row from public.smyl_radiograph_sources
  where tenant_id = v_tenant and patient_id = p_patient_id and study_id = p_study_id and sha256 = v_study->'asset'->>'sha256';
  if found then return v_row; end if;
  -- El id lo propone el cliente: nunca se reutiliza uno existente (evita oráculo/reserva de ids ajenos).
  if exists (select 1 from public.smyl_radiograph_sources where id = p_source_id) then raise exception using errcode = '22023', message = 'Identificador no disponible.'; end if;
  insert into public.smyl_radiograph_sources(id, tenant_id, patient_id, study_id, storage_path, sha256, mime_type, size_bytes,
    study_type_declared, captured_at, consent, provenance, created_by)
  values (p_source_id, v_tenant, p_patient_id, p_study_id, v_study->'asset'->>'path', v_study->'asset'->>'sha256',
    v_study->'asset'->>'mime', (v_study->'asset'->>'bytes')::bigint, p_study_type, p_captured_at,
    jsonb_build_object('version', 1, 'textHash', p_consent->>'textHash', 'acceptedAt', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'acceptedBy', auth.uid()),
    jsonb_build_object('origin', 'dental_record_v1', 'studyType', v_study->>'type'), auth.uid())
  returning * into v_row;
  perform public.smyl_radiograph_log_event(v_tenant, p_patient_id, v_row.id, 'register', v_row.id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_register_source(uuid, uuid, uuid, text, jsonb, timestamptz) from public, anon;
grant execute on function public.smyl_radiograph_register_source(uuid, uuid, uuid, text, jsonb, timestamptz) to authenticated;

create or replace function public.smyl_radiograph_correct_study_type(p_source_id uuid, p_value text, p_reason text default '')
returns public.smyl_radiograph_source_corrections
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_source public.smyl_radiograph_sources; v_tenant uuid; v_row public.smyl_radiograph_source_corrections;
begin
  -- Un solo mensaje para "no existe" y "es de otra clínica": sin oráculo de existencia.
  select * into v_source from public.smyl_radiograph_sources where id = p_source_id and tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_source.patient_id, 'clinical.write');
  if v_source.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  insert into public.smyl_radiograph_source_corrections(tenant_id, source_id, field, value, reason, created_by)
  values (v_tenant, p_source_id, 'study_type', p_value, coalesce(p_reason, ''), auth.uid()) returning * into v_row;
  perform public.smyl_radiograph_log_event(v_tenant, v_source.patient_id, p_source_id, 'correct', v_row.id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_correct_study_type(uuid, text, text) from public, anon;
grant execute on function public.smyl_radiograph_correct_study_type(uuid, text, text) to authenticated;

-- El navegador sólo registra aperturas; el resto (incluida la exportación) lo registra el servidor.
create or replace function public.smyl_radiograph_log_access(p_source_id uuid, p_action text)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_source public.smyl_radiograph_sources; v_tenant uuid;
begin
  if p_action not in ('open') then raise exception using errcode = '22023', message = 'Acción no permitida desde el cliente.'; end if;
  select * into v_source from public.smyl_radiograph_sources where id = p_source_id and tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_source.patient_id, 'clinical.read');
  if v_source.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  perform public.smyl_radiograph_log_event(v_tenant, v_source.patient_id, p_source_id, p_action);
end;
$$;
revoke all on function public.smyl_radiograph_log_access(uuid, text) from public, anon;
grant execute on function public.smyl_radiograph_log_access(uuid, text) to authenticated;

comment on table public.smyl_radiograph_sources is 'Fuente radiográfica 2D inmutable: ruta privada, hash y consentimiento. Nunca guarda URLs firmadas.';
comment on table public.smyl_radiograph_source_corrections is 'Decisión profesional (append-only) sobre la fuente; no altera la salida del modelo.';
comment on table public.smyl_radiograph_access_events is 'Auditoría de acceso, envío al motor, decisiones, firma y exportación.';
commit;
