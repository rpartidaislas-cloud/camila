-- SMYL radiografía asistida — Etapa 1b: ejecuciones del motor, candidatos y decisiones.
-- La salida del modelo es inmutable y versionada; la decisión profesional vive aparte y
-- nunca la sobrescribe. Los validadores SQL replican los contratos de
-- smyl-radiograph-contracts.js / _shared/radiograph-contracts.ts (vectores en
-- tests/fixtures/radiograph-contracts). No se llama a ningún proveedor desde SQL.
begin;

create table if not exists public.smyl_radiograph_ai_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  source_id uuid not null,
  kind text not null check (kind in ('qc','tooth_localization','finding_candidates')),
  engine_id uuid not null references public.smyl_radiograph_engines(id),
  engine jsonb not null check (jsonb_typeof(engine) = 'object' and engine ?& array['provider','name','version']),
  contract_version integer not null check (contract_version > 0),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  status text not null default 'requested' check (status in ('requested','completed','failed','unconfirmed')),
  output jsonb check (output is null or octet_length(output::text) <= 262144),
  failure_code text not null default '' check (failure_code in ('','timeout','provider_error','invalid_output','blocked_by_qc','size_limit','source_invalid','disabled')),
  cost jsonb not null default '{}'::jsonb check (jsonb_typeof(cost) = 'object' and octet_length(cost::text) <= 1024),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade,
  foreign key (tenant_id, patient_id) references public.camila_pacientes(tenant_id, id) on delete cascade,
  check ((status = 'completed') = (output is not null)),
  check ((status in ('completed','failed','unconfirmed')) = (completed_at is not null))
);
-- Idempotencia: una sola ejecución viva (solicitada o completada) por fuente+motor+contrato.
create unique index if not exists smyl_radiograph_ai_runs_idempotent_idx
  on public.smyl_radiograph_ai_runs(tenant_id, source_id, kind, idempotency_key) where status in ('requested','completed');
create index if not exists smyl_radiograph_ai_runs_source_idx
  on public.smyl_radiograph_ai_runs(tenant_id, source_id, kind, requested_at desc);

create table if not exists public.smyl_radiograph_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  patient_id uuid not null,
  source_id uuid not null,
  run_id uuid not null,
  kind text not null check (kind in ('tooth','finding')),
  candidate_id text not null check (candidate_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, run_id, candidate_id),
  foreign key (tenant_id, run_id) references public.smyl_radiograph_ai_runs(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade
);
create index if not exists smyl_radiograph_candidates_source_idx
  on public.smyl_radiograph_candidates(tenant_id, source_id, kind);

create table if not exists public.smyl_radiograph_decisions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  candidate_id uuid not null,
  patient_id uuid not null,
  source_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  state text not null default 'pending' check (state in ('pending','confirmed','corrected','rejected')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  note text not null default '' check (char_length(note) <= 600),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  primary key (tenant_id, candidate_id),
  foreign key (tenant_id, candidate_id) references public.smyl_radiograph_candidates(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade,
  check ((state = 'pending') = (decided_at is null)),
  check (state = 'corrected' or payload = '{}'::jsonb)
);
create table if not exists public.smyl_radiograph_decision_versions (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  candidate_id uuid not null,
  revision integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, candidate_id, revision),
  foreign key (tenant_id, candidate_id) references public.smyl_radiograph_candidates(tenant_id, id) on delete cascade
);

drop trigger if exists smyl_radiograph_candidates_immutable on public.smyl_radiograph_candidates;
create trigger smyl_radiograph_candidates_immutable before update or delete on public.smyl_radiograph_candidates
  for each row execute function public.smyl_radiograph_forbid_change();
drop trigger if exists smyl_radiograph_decision_versions_immutable on public.smyl_radiograph_decision_versions;
create trigger smyl_radiograph_decision_versions_immutable before update or delete on public.smyl_radiograph_decision_versions
  for each row execute function public.smyl_radiograph_forbid_change();

-- Una ejecución sólo cambia una vez: requested -> terminal. Después es inmutable.
create or replace function public.smyl_radiograph_guard_run_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception using errcode = '42501', message = 'Las ejecuciones del motor no se borran.';
  end if;
  if old.status <> 'requested' then raise exception using errcode = '42501', message = 'La salida original del motor es inmutable.'; end if;
  if new.status = 'requested' or new.id <> old.id or new.tenant_id <> old.tenant_id or new.source_id <> old.source_id
     or new.kind <> old.kind or new.engine_id <> old.engine_id or new.engine <> old.engine
     or new.contract_version <> old.contract_version or new.idempotency_key <> old.idempotency_key
     or new.requested_by <> old.requested_by or new.requested_at <> old.requested_at then
    raise exception using errcode = '42501', message = 'Sólo se puede cerrar una ejecución solicitada.';
  end if;
  return new;
end;
$$;
-- Decisiones: sólo avanzan de una en una revisión, conservan identidad y no se borran directo.
create or replace function public.smyl_radiograph_guard_decision_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception using errcode = '42501', message = 'Las decisiones profesionales no se borran.';
  end if;
  if new.revision <> old.revision + 1 or new.candidate_id <> old.candidate_id or new.tenant_id <> old.tenant_id
     or new.patient_id <> old.patient_id or new.source_id <> old.source_id or new.state = 'pending' then
    raise exception using errcode = '42501', message = 'Las decisiones sólo cambian con una revisión nueva.';
  end if;
  return new;
end;
$$;
drop trigger if exists smyl_radiograph_decisions_guard on public.smyl_radiograph_decisions;
create trigger smyl_radiograph_decisions_guard before update or delete on public.smyl_radiograph_decisions
  for each row execute function public.smyl_radiograph_guard_decision_change();

drop trigger if exists smyl_radiograph_ai_runs_guard on public.smyl_radiograph_ai_runs;
create trigger smyl_radiograph_ai_runs_guard before update or delete on public.smyl_radiograph_ai_runs
  for each row execute function public.smyl_radiograph_guard_run_change();

alter table public.smyl_radiograph_ai_runs enable row level security;
alter table public.smyl_radiograph_candidates enable row level security;
alter table public.smyl_radiograph_decisions enable row level security;
alter table public.smyl_radiograph_decision_versions enable row level security;
revoke all on public.smyl_radiograph_ai_runs, public.smyl_radiograph_candidates,
  public.smyl_radiograph_decisions, public.smyl_radiograph_decision_versions from public, anon, authenticated;
revoke truncate on public.smyl_radiograph_ai_runs, public.smyl_radiograph_candidates,
  public.smyl_radiograph_decisions, public.smyl_radiograph_decision_versions from service_role;
grant select on public.smyl_radiograph_ai_runs, public.smyl_radiograph_candidates,
  public.smyl_radiograph_decisions, public.smyl_radiograph_decision_versions to authenticated;

drop policy if exists smyl_radiograph_ai_runs_scoped_read on public.smyl_radiograph_ai_runs;
create policy smyl_radiograph_ai_runs_scoped_read on public.smyl_radiograph_ai_runs for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_radiograph_candidates_scoped_read on public.smyl_radiograph_candidates;
create policy smyl_radiograph_candidates_scoped_read on public.smyl_radiograph_candidates for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_radiograph_decisions_scoped_read on public.smyl_radiograph_decisions;
create policy smyl_radiograph_decisions_scoped_read on public.smyl_radiograph_decisions for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and public.smyl_can_access_patient(tenant_id, patient_id, 'clinical'));
drop policy if exists smyl_radiograph_decision_versions_scoped_read on public.smyl_radiograph_decision_versions;
create policy smyl_radiograph_decision_versions_scoped_read on public.smyl_radiograph_decision_versions for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and exists (
    select 1 from public.smyl_radiograph_candidates c
    where c.tenant_id = smyl_radiograph_decision_versions.tenant_id and c.id = smyl_radiograph_decision_versions.candidate_id
      and public.smyl_can_access_patient(c.tenant_id, c.patient_id, 'clinical')));

-- ---------------------------------------------------------------------------------------
-- Validadores de contrato (v2, schema 1). Lanzan 22023 con mensaje concreto.
-- ---------------------------------------------------------------------------------------
create or replace function public.smyl_radiograph_fdi_valid(p text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$';
$$;

-- Variante estricta sobre jsonb: un número 36 no es una pieza FDI aunque ->> lo convierta.
create or replace function public.smyl_radiograph_fdi_valid(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select jsonb_typeof(p) = 'string' and public.smyl_radiograph_fdi_valid(p#>>'{}');
$$;

create or replace function public.smyl_radiograph_id_valid(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p) = 'string' and (p#>>'{}') ~ '^[a-z0-9][a-z0-9_-]{0,63}$';
$$;

create or replace function public.smyl_radiograph_prob_valid(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p) = 'number' and (p#>>'{}')::numeric between 0 and 1;
$$;

-- Longitud en code points y recorte Unicode, igual que [...s].length / s.trim() en JS/TS.
create or replace function public.smyl_radiograph_text_valid(p jsonb, p_min integer, p_max integer) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select jsonb_typeof(p) = 'string' and char_length(public.smyl_radiograph_trim(p#>>'{}')) between p_min and p_max and char_length(p#>>'{}') <= p_max;
$$;

-- Afirmaciones no permitidas en texto del modelo: no es diagnóstico ni certeza clínica.
create or replace function public.smyl_radiograph_claim_forbidden(p text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p ~* '(diagn[oó]s|confirmad[oa]|certeza|definitiv|inequ[ií]voc|sin duda|diagnosis|confirmed|definite)';
$$;

create or replace function public.smyl_radiograph_model_valid(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog, public as $$
  select jsonb_typeof(p) = 'object' and p - array['provider','name','version'] = '{}'::jsonb and p ?& array['provider','name','version']
    and public.smyl_radiograph_text_valid(p->'provider', 1, 60) and public.smyl_radiograph_text_valid(p->'name', 1, 80)
    and public.smyl_radiograph_text_valid(p->'version', 1, 60);
$$;

create or replace function public.smyl_radiograph_geometry_valid(p jsonb, p_allow_point boolean) returns boolean
language plpgsql immutable set search_path = pg_catalog, public as $$
declare v_kind text; v_n integer; i integer; x0 numeric; y0 numeric; x1 numeric; y1 numeric; pt jsonb; prev jsonb; area numeric := 0;
begin
  if jsonb_typeof(p) is distinct from 'object' or p - array['kind','coordinateSpace','points'] <> '{}'::jsonb
     or not (p ?& array['kind','coordinateSpace','points']) or p->>'coordinateSpace' is distinct from 'source-normalized'
     or jsonb_typeof(p->'points') is distinct from 'array' then return false; end if;
  v_kind := p->>'kind'; v_n := jsonb_array_length(p->'points');
  if v_kind not in ('point','bbox','polygon') or (v_kind = 'point' and not p_allow_point) then return false; end if;
  for i in 0..v_n-1 loop
    pt := p->'points'->i;
    if jsonb_typeof(pt) is distinct from 'array' or jsonb_array_length(pt) <> 2
       or not public.smyl_radiograph_prob_valid(pt->0) or not public.smyl_radiograph_prob_valid(pt->1) then return false; end if;
    if prev is not null and prev = pt then return false; end if;
    prev := pt;
  end loop;
  if v_kind = 'point' then return v_n = 1; end if;
  if v_kind = 'bbox' then
    if v_n <> 2 then return false; end if;
    x0 := (p->'points'->0->>0)::numeric; y0 := (p->'points'->0->>1)::numeric;
    x1 := (p->'points'->1->>0)::numeric; y1 := (p->'points'->1->>1)::numeric;
    return x1 > x0 and y1 > y0;
  end if;
  if v_n < 3 or v_n > 64 or p->'points'->0 = p->'points'->(v_n-1) then return false; end if;
  for i in 0..v_n-1 loop
    x0 := (p->'points'->i->>0)::numeric; y0 := (p->'points'->i->>1)::numeric;
    x1 := (p->'points'->((i+1) % v_n)->>0)::numeric; y1 := (p->'points'->((i+1) % v_n)->>1)::numeric;
    area := area + (x0 * y1 - x1 * y0);
  end loop;
  return abs(area) / 2 >= 0.000001;
end;
$$;

create or replace function public.smyl_radiograph_validate_qc(p jsonb) returns void
language plpgsql immutable set search_path = pg_catalog, public as $$
declare v jsonb; seen text[] := array[]::text[]; applicable text[] := array[]::text[];
begin
  if jsonb_typeof(p) is distinct from 'object' or p - array['schema','studyClass','quality','applicableAnalyses','blockedAnalyses','model'] <> '{}'::jsonb
     or not (p ?& array['schema','studyClass','quality','applicableAnalyses','blockedAnalyses','model']) or p->'schema' <> '1'::jsonb
     or not public.smyl_radiograph_model_valid(p->'model') then
    raise exception using errcode = '22023', message = 'Resultado de control de calidad no válido.'; end if;
  v := p->'studyClass';
  if jsonb_typeof(v) is distinct from 'object' or v - array['value','probability','alternatives'] <> '{}'::jsonb or not (v ?& array['value','probability','alternatives'])
     or coalesce(v->>'value','') not in ('panoramic','periapical','bitewing','intraoral_series','unknown') or not public.smyl_radiograph_prob_valid(v->'probability')
     or jsonb_typeof(v->'alternatives') is distinct from 'array' or jsonb_array_length(v->'alternatives') > 4 then
    raise exception using errcode = '22023', message = 'Clase de estudio no válida.'; end if;
  seen := array[v->>'value'];
  for v in select value from jsonb_array_elements(p->'studyClass'->'alternatives') loop
    if jsonb_typeof(v) is distinct from 'object' or v - array['value','probability'] <> '{}'::jsonb or not (v ?& array['value','probability'])
       or coalesce(v->>'value','') not in ('panoramic','periapical','bitewing','intraoral_series','unknown') or v->>'value' = any(seen)
       or not public.smyl_radiograph_prob_valid(v->'probability') then
      raise exception using errcode = '22023', message = 'Alternativa de clase de estudio no válida.'; end if;
    seen := array_append(seen, v->>'value');
  end loop;
  v := p->'quality';
  if jsonb_typeof(v) is distinct from 'object' or v - array['status','flags'] <> '{}'::jsonb or not (v ?& array['status','flags'])
     or coalesce(v->>'status','') not in ('usable','limited','unusable') or jsonb_typeof(v->'flags') is distinct from 'array' or jsonb_array_length(v->'flags') > 12 then
    raise exception using errcode = '22023', message = 'Calidad radiográfica no válida.'; end if;
  for v in select value from jsonb_array_elements(p->'quality'->'flags') loop
    if jsonb_typeof(v) is distinct from 'object' or v - array['code','severity','region','explanation'] <> '{}'::jsonb or not (v ?& array['code','severity','region','explanation'])
       or coalesce(v->>'code','') not in ('motion_blur','anterior_blur','anatomical_cropping','underexposure','overexposure','low_contrast','overlap','compression_artifacts','orientation_suspect','foreign_object','unknown_study_class')
       or coalesce(v->>'severity','') not in ('low','moderate','high') or not public.smyl_radiograph_text_valid(v->'explanation', 1, 300)
       or not (v->'region' = 'null'::jsonb or public.smyl_radiograph_geometry_valid(v->'region', true)) then
      raise exception using errcode = '22023', message = 'Bandera de calidad no válida.'; end if;
  end loop;
  if jsonb_typeof(p->'applicableAnalyses') is distinct from 'array' or jsonb_typeof(p->'blockedAnalyses') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Análisis aplicables no válidos.'; end if;
  for v in select value from jsonb_array_elements(p->'applicableAnalyses') loop
    if jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') not in ('tooth_localization','finding_candidates') or (v#>>'{}') = any(applicable) then
      raise exception using errcode = '22023', message = 'Análisis aplicable no válido.'; end if;
    applicable := array_append(applicable, v#>>'{}');
  end loop;
  seen := array[]::text[];
  for v in select value from jsonb_array_elements(p->'blockedAnalyses') loop
    if jsonb_typeof(v) is distinct from 'object' or v - array['code','reason'] <> '{}'::jsonb or not (v ?& array['code','reason'])
       or coalesce(v->>'code','') not in ('tooth_localization','finding_candidates') or v->>'code' = any(applicable) or v->>'code' = any(seen)
       or not public.smyl_radiograph_text_valid(v->'reason', 1, 300) then
      raise exception using errcode = '22023', message = 'Análisis bloqueado no válido.'; end if;
    seen := array_append(seen, v->>'code');
  end loop;
  if p->'quality'->>'status' = 'unusable' and cardinality(applicable) > 0 then
    raise exception using errcode = '22023', message = 'Una imagen no utilizable no habilita análisis.'; end if;
end;
$$;

create or replace function public.smyl_radiograph_validate_tooth_set(p jsonb) returns void
language plpgsql immutable set search_path = pg_catalog, public as $$
declare c jsonb; a jsonb; ids text[] := array[]::text[]; alts text[];
begin
  if jsonb_typeof(p) is distinct from 'object' or p - array['schema','sourceId','model','candidates'] <> '{}'::jsonb
     or not (p ?& array['schema','sourceId','model','candidates']) or p->'schema' <> '1'::jsonb
     or coalesce(p->>'sourceId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
     or not public.smyl_radiograph_model_valid(p->'model') or jsonb_typeof(p->'candidates') is distinct from 'array' or jsonb_array_length(p->'candidates') > 64 then
    raise exception using errcode = '22023', message = 'Conjunto de piezas candidatas no válido.'; end if;
  for c in select value from jsonb_array_elements(p->'candidates') loop
    if jsonb_typeof(c) is distinct from 'object' or c - array['candidateId','fdiCandidate','fdiProbability','geometry','visibility','alternatives'] <> '{}'::jsonb
       or not (c ?& array['candidateId','fdiCandidate','fdiProbability','geometry','visibility','alternatives'])
       or not public.smyl_radiograph_id_valid(c->'candidateId') or c->>'candidateId' = any(ids)
       or not public.smyl_radiograph_fdi_valid(c->'fdiCandidate') or not public.smyl_radiograph_prob_valid(c->'fdiProbability')
       or not public.smyl_radiograph_geometry_valid(c->'geometry', false)
       or coalesce(c->>'visibility','') not in ('complete','partial','not_evaluable')
       or jsonb_typeof(c->'alternatives') is distinct from 'array' or jsonb_array_length(c->'alternatives') > 3 then
      raise exception using errcode = '22023', message = 'Pieza candidata no válida.'; end if;
    ids := array_append(ids, c->>'candidateId'); alts := array[c->>'fdiCandidate'];
    for a in select value from jsonb_array_elements(c->'alternatives') loop
      if jsonb_typeof(a) is distinct from 'object' or a - array['fdi','probability'] <> '{}'::jsonb or not (a ?& array['fdi','probability'])
         or not public.smyl_radiograph_fdi_valid(a->'fdi') or a->>'fdi' = any(alts) or not public.smyl_radiograph_prob_valid(a->'probability') then
        raise exception using errcode = '22023', message = 'Alternativa FDI no válida.'; end if;
      alts := array_append(alts, a->>'fdi');
    end loop;
  end loop;
end;
$$;

create or replace function public.smyl_radiograph_validate_finding_set(p jsonb) returns void
language plpgsql immutable set search_path = pg_catalog, public as $$
declare c jsonb; r jsonb; ids text[] := array[]::text[];
begin
  if jsonb_typeof(p) is distinct from 'object' or p - array['schema','sourceId','model','candidates'] <> '{}'::jsonb
     or not (p ?& array['schema','sourceId','model','candidates']) or p->'schema' <> '1'::jsonb
     or coalesce(p->>'sourceId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
     or not public.smyl_radiograph_model_valid(p->'model') or jsonb_typeof(p->'candidates') is distinct from 'array' or jsonb_array_length(p->'candidates') > 48 then
    raise exception using errcode = '22023', message = 'Conjunto de señales candidatas no válido.'; end if;
  for c in select value from jsonb_array_elements(p->'candidates') loop
    if jsonb_typeof(c) is distinct from 'object'
       or c - array['candidateId','toothCandidate','category','label','confidence','evidenceLevel','regions','explanation','limitations'] <> '{}'::jsonb
       or not (c ?& array['candidateId','toothCandidate','category','label','confidence','evidenceLevel','regions','explanation','limitations'])
       or not public.smyl_radiograph_id_valid(c->'candidateId') or c->>'candidateId' = any(ids)
       or not (c->'toothCandidate' = 'null'::jsonb or public.smyl_radiograph_fdi_valid(c->'toothCandidate'))
       or coalesce(c->>'category','') not in ('restoration','crown','implant','endodontic','apparently_missing','density','contour','support','development','other')
       or not public.smyl_radiograph_text_valid(c->'label', 1, 120) or not public.smyl_radiograph_prob_valid(c->'confidence')
       or c->>'evidenceLevel' is distinct from 'model_candidate'
       or jsonb_typeof(c->'regions') is distinct from 'array' or jsonb_array_length(c->'regions') not between 1 and 4
       or not public.smyl_radiograph_text_valid(c->'explanation', 1, 300)
       or jsonb_typeof(c->'limitations') is distinct from 'array' or jsonb_array_length(c->'limitations') > 6 then
      raise exception using errcode = '22023', message = 'Señal candidata no válida.'; end if;
    if public.smyl_radiograph_claim_forbidden(c->>'label') or public.smyl_radiograph_claim_forbidden(c->>'explanation') then
      raise exception using errcode = '22023', message = 'El modelo no puede presentar una señal como diagnóstico o certeza.'; end if;
    ids := array_append(ids, c->>'candidateId');
    for r in select value from jsonb_array_elements(c->'regions') loop
      if not public.smyl_radiograph_geometry_valid(r, false) then raise exception using errcode = '22023', message = 'Región de señal no válida.'; end if;
    end loop;
    for r in select value from jsonb_array_elements(c->'limitations') loop
      if not public.smyl_radiograph_text_valid(r, 1, 200) then raise exception using errcode = '22023', message = 'Limitación de señal no válida.'; end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.smyl_radiograph_validate_output(p_kind text, p jsonb) returns void
language plpgsql immutable set search_path = pg_catalog, public as $$
begin
  if p_kind = 'qc' then perform public.smyl_radiograph_validate_qc(p);
  elsif p_kind = 'tooth_localization' then perform public.smyl_radiograph_validate_tooth_set(p);
  elsif p_kind = 'finding_candidates' then perform public.smyl_radiograph_validate_finding_set(p);
  else raise exception using errcode = '22023', message = 'Tipo de análisis desconocido.'; end if;
end;
$$;
revoke all on function public.smyl_radiograph_validate_output(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------
-- Solicitud (navegador, clinical.write). Bandera + motor activo + QC previo cuando aplica.
-- Idempotente: devuelve la ejecución viva si ya existe. Tras 'unconfirmed' (timeout
-- incierto) exige reconocimiento explícito: nunca reintenta sola.
create or replace function public.smyl_radiograph_request_ai_run(p_source_id uuid, p_kind text, p_acknowledge_unconfirmed boolean default false)
returns public.smyl_radiograph_ai_runs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_source public.smyl_radiograph_sources; v_tenant uuid; v_engine record; v_flag text; v_key text; v_row public.smyl_radiograph_ai_runs; v_qc jsonb;
begin
  if p_kind not in ('qc','tooth_localization','finding_candidates') then raise exception using errcode = '22023', message = 'Tipo de análisis desconocido.'; end if;
  select * into v_source from public.smyl_radiograph_sources where id = p_source_id and tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_source.patient_id, 'clinical.write');
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
  select * into v_row from public.smyl_radiograph_ai_runs
  where tenant_id = v_tenant and source_id = p_source_id and kind = p_kind and idempotency_key = v_key and status in ('requested','completed');
  if found then return v_row; end if;
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
revoke all on function public.smyl_radiograph_request_ai_run(uuid, text, boolean) from public, anon;
grant execute on function public.smyl_radiograph_request_ai_run(uuid, text, boolean) to authenticated;

-- Cierre (sólo servidor / service_role). Valida con el contrato, guarda el original completo
-- y siembra candidatos con decisión pendiente. Idempotente si se repite con el mismo cierre.
create or replace function public.smyl_radiograph_complete_ai_run(p_run_id uuid, p_status text, p_output jsonb, p_failure_code text default '', p_cost jsonb default '{}'::jsonb)
returns public.smyl_radiograph_ai_runs
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.smyl_radiograph_ai_runs; c jsonb; v_candidate uuid; v_kind text;
begin
  if p_status not in ('completed','failed','unconfirmed') then raise exception using errcode = '22023', message = 'Estado de cierre no válido.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('radiograph-run-close:' || p_run_id::text, 31));
  select * into v_row from public.smyl_radiograph_ai_runs where id = p_run_id for update;
  if not found then raise exception using errcode = '42501', message = 'Ejecución desconocida.'; end if;
  if v_row.status <> 'requested' then
    if v_row.status = p_status and v_row.output is not distinct from p_output and v_row.failure_code = coalesce(p_failure_code, '') then return v_row; end if;
    raise exception using errcode = '42501', message = 'La salida original del motor es inmutable.';
  end if;
  if p_status = 'completed' then
    if p_failure_code <> '' then raise exception using errcode = '22023', message = 'Un cierre completado no lleva código de falla.'; end if;
    perform public.smyl_radiograph_validate_output(v_row.kind, p_output);
    if v_row.kind <> 'qc' and p_output->>'sourceId' <> v_row.source_id::text then
      raise exception using errcode = '22023', message = 'La salida no corresponde a la fuente.'; end if;
    if p_output->'model' <> v_row.engine then raise exception using errcode = '22023', message = 'La salida no identifica el motor registrado.'; end if;
  elsif p_output is not null then raise exception using errcode = '22023', message = 'Un cierre fallido no guarda salida.';
  elsif coalesce(p_failure_code, '') = '' then raise exception using errcode = '22023', message = 'Indica el código de falla.';
  end if;
  update public.smyl_radiograph_ai_runs set status = p_status, output = p_output, failure_code = coalesce(p_failure_code, ''),
    cost = coalesce(p_cost, '{}'::jsonb), completed_at = clock_timestamp() where id = p_run_id returning * into v_row;
  if p_status = 'completed' and v_row.kind <> 'qc' then
    v_kind := case when v_row.kind = 'tooth_localization' then 'tooth' else 'finding' end;
    for c in select value from jsonb_array_elements(p_output->'candidates') loop
      insert into public.smyl_radiograph_candidates(tenant_id, patient_id, source_id, run_id, kind, candidate_id, payload)
      values (v_row.tenant_id, v_row.patient_id, v_row.source_id, v_row.id, v_kind, c->>'candidateId', c) returning id into v_candidate;
      insert into public.smyl_radiograph_decisions(tenant_id, candidate_id, patient_id, source_id)
      values (v_row.tenant_id, v_candidate, v_row.patient_id, v_row.source_id);
    end loop;
  end if;
  insert into public.smyl_radiograph_access_events(tenant_id, patient_id, source_id, action, actor_id, reference_id)
  values (v_row.tenant_id, v_row.patient_id, v_row.source_id, 'engine_result', null, v_row.id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_complete_ai_run(uuid, text, jsonb, text, jsonb) from public, anon, authenticated;

-- Decisión profesional. Conserva el candidato original; cada cambio crea una versión.
create or replace function public.smyl_radiograph_decide_candidate(p_candidate_id uuid, p_expected_revision integer, p_state text, p_payload jsonb default '{}'::jsonb, p_note text default '')
returns public.smyl_radiograph_decisions
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_candidate public.smyl_radiograph_candidates; v_tenant uuid; v_old public.smyl_radiograph_decisions; v_row public.smyl_radiograph_decisions;
  v_payload jsonb := case when p_payload is null or p_payload = 'null'::jsonb then '{}'::jsonb else p_payload end;
begin
  if p_state not in ('confirmed','corrected','rejected') then raise exception using errcode = '22023', message = 'Estado de decisión no válido.'; end if;
  select * into v_candidate from public.smyl_radiograph_candidates where id = p_candidate_id and tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'El candidato no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_candidate.patient_id, 'clinical.write');
  if v_candidate.tenant_id <> v_tenant then raise exception using errcode = '42501', message = 'El candidato no está disponible.'; end if;
  -- Un hallazgo incluido en un informe firmado queda congelado: cualquier reconsideración va por adenda.
  if exists (select 1 from public.smyl_radiograph_reports r where r.tenant_id = v_tenant and r.source_id = v_candidate.source_id and r.status = 'signed'
             and r.document->'findings' @> jsonb_build_array(jsonb_build_object('candidateId', p_candidate_id::text))) then
    raise exception using errcode = '23514', message = 'El hallazgo forma parte de un informe firmado; registra una adenda.'; end if;
  if p_state <> 'corrected' then
    if v_payload <> '{}'::jsonb then raise exception using errcode = '22023', message = 'Sólo una corrección lleva datos.'; end if;
  else
    if jsonb_typeof(v_payload) is distinct from 'object' or v_payload = '{}'::jsonb or v_payload - array['fdi','label','geometry'] <> '{}'::jsonb
       or (v_payload ? 'fdi' and not (v_payload->'fdi' = 'null'::jsonb or (jsonb_typeof(v_payload->'fdi') = 'string' and public.smyl_radiograph_fdi_valid(v_payload->>'fdi'))))
       or (v_payload ? 'label' and not public.smyl_radiograph_text_valid(v_payload->'label', 1, 200))
       or (v_payload ? 'geometry' and not public.smyl_radiograph_geometry_valid(v_payload->'geometry', false)) then
      raise exception using errcode = '22023', message = 'Corrección no válida.'; end if;
  end if;
  if coalesce(p_note, '') <> '' and not public.smyl_radiograph_text_valid(to_jsonb(p_note), 0, 600) then raise exception using errcode = '22023', message = 'Nota demasiado larga.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('radiograph-decision:' || p_candidate_id::text, 31));
  select * into v_old from public.smyl_radiograph_decisions where tenant_id = v_tenant and candidate_id = p_candidate_id for update;
  if not found then raise exception using errcode = '42501', message = 'El candidato no está disponible.'; end if;
  if v_old.revision = p_expected_revision + 1 and v_old.state = p_state and v_old.payload = v_payload and v_old.note = coalesce(p_note, '') then return v_old; end if;
  if v_old.revision <> p_expected_revision then raise exception using errcode = 'PT409', message = 'La decisión cambió en otra sesión. Actualiza la revisión.'; end if;
  update public.smyl_radiograph_decisions set revision = v_old.revision + 1, state = p_state, payload = v_payload, note = coalesce(p_note, ''),
    decided_by = auth.uid(), decided_at = clock_timestamp() where tenant_id = v_tenant and candidate_id = p_candidate_id returning * into v_row;
  insert into public.smyl_radiograph_decision_versions(tenant_id, candidate_id, revision, snapshot, actor_id)
  values (v_tenant, p_candidate_id, v_row.revision, to_jsonb(v_row) - 'tenant_id', auth.uid());
  perform public.smyl_radiograph_log_event(v_tenant, v_candidate.patient_id, v_candidate.source_id, 'decide', p_candidate_id);
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_decide_candidate(uuid, integer, text, jsonb, text) from public, anon;
grant execute on function public.smyl_radiograph_decide_candidate(uuid, integer, text, jsonb, text) to authenticated;

comment on table public.smyl_radiograph_ai_runs is 'Ejecuciones del motor radiográfico: salida original inmutable, motor y contrato versionados, idempotencia por hash.';
comment on table public.smyl_radiograph_candidates is 'Candidatos (pieza/señal) tal como los emitió el modelo. Nunca son diagnóstico.';
comment on table public.smyl_radiograph_decisions is 'Decisión profesional por candidato: pending -> confirmed | corrected | rejected, con versiones.';
commit;
