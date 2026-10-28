-- SMYL radiografía asistida — Etapa 7: infraestructura de validación clínica y monitoreo.
-- Conjuntos de evaluación independientes, anotación de referencia por varios odontólogos con
-- consenso y adjudicación, métricas por tarea / tipo de estudio / motor (sensibilidad,
-- especificidad, precisión, calibración, FP/FN, desacuerdo profesional), monitoreo de deriva e
-- incidentes, informe de validación versionado e inmutable con criterios de salida, pausa por
-- clínica (botón de desactivación) y divulgación de modelo / límites / fecha para la interfaz.
-- No decide uso clínico: produce evidencia versionada para que la clínica y la revisión regulatoria
-- lo decidan. Idempotente y aditivo; no se aplica sin autorización.
begin;

create table if not exists public.smyl_radiograph_eval_sets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  intended_use text not null check (char_length(intended_use) between 10 and 2000),
  population text not null default '' check (char_length(population) <= 2000),
  exclusions text not null default '' check (char_length(exclusions) <= 2000),
  split text not null default 'test' check (split in ('test','pilot')),
  locked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);
-- Cada fuente del conjunto declara si pudo haber sido vista por el proveedor al entrenar:
-- un conjunto de prueba sólo es válido si todas sus fuentes son independientes del entrenamiento.
create table if not exists public.smyl_radiograph_eval_members (
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  set_id uuid not null,
  source_id uuid not null,
  training_exposure boolean not null default false,
  added_by uuid not null references auth.users(id),
  added_at timestamptz not null default now(),
  primary key (tenant_id, set_id, source_id),
  foreign key (tenant_id, set_id) references public.smyl_radiograph_eval_sets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade
);
-- Referencia anotada por varios profesionales, independiente de los candidatos del modelo.
create table if not exists public.smyl_radiograph_reference_annotations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  source_id uuid not null,
  annotator_id uuid not null references auth.users(id),
  professional_id uuid,
  kind text not null check (kind in ('tooth','finding')),
  fdi text not null check (public.smyl_radiograph_fdi_valid(fdi)),
  category text not null default '' check (category = '' or category in ('restoration','crown','implant','endodontic','apparently_missing','density','contour','support','development','other')),
  present boolean not null,
  geometry jsonb check (geometry is null or public.smyl_radiograph_geometry_valid(geometry, false)),
  adjudicated boolean not null default false,
  note text not null default '' check (char_length(note) <= 600),
  created_at timestamptz not null default now(),
  check ((kind = 'finding') = (category <> '')),
  -- Una anotación y, aparte, una adjudicación por (anotador, pieza, categoría): ambas inmutables.
  unique (tenant_id, source_id, annotator_id, kind, fdi, category, adjudicated),
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete cascade,
  foreign key (tenant_id, professional_id) references public.smyl_professionals(tenant_id, id)
);
create index if not exists smyl_radiograph_reference_source_idx on public.smyl_radiograph_reference_annotations(tenant_id, source_id, kind);

create table if not exists public.smyl_radiograph_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  source_id uuid,
  run_id uuid,
  severity text not null check (severity in ('low','moderate','high','critical')),
  category text not null check (category in ('wrong_numbering','missed_structure','false_signal','quality_misjudged','ui_error','latency','other')),
  description text not null check (char_length(btrim(description)) between 5 and 2000),
  status text not null default 'open' check (status in ('open','closed')),
  resolution text not null default '' check (char_length(resolution) <= 2000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  foreign key (tenant_id, source_id) references public.smyl_radiograph_sources(tenant_id, id) on delete set null (source_id)
);
create index if not exists smyl_radiograph_incidents_tenant_idx on public.smyl_radiograph_incidents(tenant_id, status, created_at desc);

-- Informe de validación: snapshot inmutable de métricas + criterios de salida, aprobado por un
-- profesional con permiso clínico de aprobación. Versiona por conjunto.
create table if not exists public.smyl_radiograph_validation_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  set_id uuid not null,
  version integer not null check (version > 0),
  engines jsonb not null check (jsonb_typeof(engines) = 'array'),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  exit_criteria jsonb not null check (jsonb_typeof(exit_criteria) = 'array' and jsonb_array_length(exit_criteria) between 1 and 20),
  criteria_met boolean not null,
  verdict text not null check (verdict in ('approved_for_pilot','not_approved')),
  notes text not null default '' check (char_length(notes) <= 4000),
  approved_by uuid not null references auth.users(id),
  approved_professional_id uuid,
  approved_at timestamptz not null default now(),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  unique (tenant_id, set_id, version),
  foreign key (tenant_id, set_id) references public.smyl_radiograph_eval_sets(tenant_id, id) on delete cascade,
  foreign key (tenant_id, approved_professional_id) references public.smyl_professionals(tenant_id, id)
);
drop trigger if exists smyl_radiograph_validation_reports_immutable on public.smyl_radiograph_validation_reports;
create trigger smyl_radiograph_validation_reports_immutable before update or delete on public.smyl_radiograph_validation_reports
  for each row execute function public.smyl_radiograph_forbid_change();
drop trigger if exists smyl_radiograph_reference_annotations_immutable on public.smyl_radiograph_reference_annotations;
create trigger smyl_radiograph_reference_annotations_immutable before update or delete on public.smyl_radiograph_reference_annotations
  for each row execute function public.smyl_radiograph_forbid_change();

-- Conjunto de evaluación: sólo cambia al bloquearse (locked_at) y nunca se borra directo; los miembros
-- no cambian ni se quitan una vez bloqueado; los incidentes sólo pasan de abiertos a cerrados.
create or replace function public.smyl_radiograph_guard_eval_set_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception using errcode = '42501', message = 'Los conjuntos de evaluación no se borran.';
  end if;
  if old.locked_at is null and new.locked_at is not null and (to_jsonb(new) - 'locked_at') = (to_jsonb(old) - 'locked_at') then return new; end if;
  raise exception using errcode = '42501', message = 'El conjunto de evaluación es inmutable.';
end;
$$;
drop trigger if exists smyl_radiograph_eval_sets_guard on public.smyl_radiograph_eval_sets;
create trigger smyl_radiograph_eval_sets_guard before update or delete on public.smyl_radiograph_eval_sets
  for each row execute function public.smyl_radiograph_guard_eval_set_change();
create or replace function public.smyl_radiograph_guard_eval_member_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if exists (select 1 from public.smyl_radiograph_eval_sets s where s.tenant_id = old.tenant_id and s.id = old.set_id and s.locked_at is not null) then
    raise exception using errcode = '42501', message = 'El conjunto está bloqueado por un informe de validación.'; end if;
  if tg_op = 'DELETE' then raise exception using errcode = '42501', message = 'Los miembros del conjunto no se quitan directamente.'; end if;
  if new.tenant_id <> old.tenant_id or new.set_id <> old.set_id or new.source_id <> old.source_id then
    raise exception using errcode = '42501', message = 'La identidad del miembro es inmutable.'; end if;
  return new;
end;
$$;
drop trigger if exists smyl_radiograph_eval_members_guard on public.smyl_radiograph_eval_members;
create trigger smyl_radiograph_eval_members_guard before update or delete on public.smyl_radiograph_eval_members
  for each row execute function public.smyl_radiograph_guard_eval_member_change();
create or replace function public.smyl_radiograph_guard_incident_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception using errcode = '42501', message = 'Los incidentes no se borran.';
  end if;
  if pg_trigger_depth() > 1 and new.source_id is null and old.source_id is not null and (to_jsonb(new) - 'source_id') = (to_jsonb(old) - 'source_id') then return new; end if;
  if old.status = 'open' and new.status = 'closed' and (to_jsonb(new) - 'status' - 'resolution' - 'closed_by' - 'closed_at') = (to_jsonb(old) - 'status' - 'resolution' - 'closed_by' - 'closed_at') then return new; end if;
  raise exception using errcode = '42501', message = 'El incidente sólo puede cerrarse una vez.';
end;
$$;
drop trigger if exists smyl_radiograph_incidents_guard on public.smyl_radiograph_incidents;
create trigger smyl_radiograph_incidents_guard before update or delete on public.smyl_radiograph_incidents
  for each row execute function public.smyl_radiograph_guard_incident_change();

alter table public.smyl_radiograph_eval_sets enable row level security;
alter table public.smyl_radiograph_eval_members enable row level security;
alter table public.smyl_radiograph_reference_annotations enable row level security;
alter table public.smyl_radiograph_incidents enable row level security;
alter table public.smyl_radiograph_validation_reports enable row level security;
revoke all on public.smyl_radiograph_eval_sets, public.smyl_radiograph_eval_members, public.smyl_radiograph_reference_annotations,
  public.smyl_radiograph_incidents, public.smyl_radiograph_validation_reports from public, anon, authenticated;
revoke truncate on public.smyl_radiograph_eval_sets, public.smyl_radiograph_eval_members, public.smyl_radiograph_reference_annotations,
  public.smyl_radiograph_incidents, public.smyl_radiograph_validation_reports from service_role;
grant select on public.smyl_radiograph_eval_sets, public.smyl_radiograph_eval_members, public.smyl_radiograph_reference_annotations,
  public.smyl_radiograph_incidents, public.smyl_radiograph_validation_reports to authenticated;
-- Lectura: la validación es responsabilidad clínica de aprobación; las anotaciones de referencia por paciente.
drop policy if exists smyl_radiograph_eval_sets_read on public.smyl_radiograph_eval_sets;
create policy smyl_radiograph_eval_sets_read on public.smyl_radiograph_eval_sets for select to authenticated using (public.smyl_has_permission(tenant_id, 'clinical.approve'));
drop policy if exists smyl_radiograph_eval_members_read on public.smyl_radiograph_eval_members;
create policy smyl_radiograph_eval_members_read on public.smyl_radiograph_eval_members for select to authenticated using (public.smyl_has_permission(tenant_id, 'clinical.approve'));
drop policy if exists smyl_radiograph_reference_annotations_read on public.smyl_radiograph_reference_annotations;
create policy smyl_radiograph_reference_annotations_read on public.smyl_radiograph_reference_annotations for select to authenticated
  using (public.smyl_has_permission(tenant_id, 'clinical.read') and exists (select 1 from public.smyl_radiograph_sources s where s.tenant_id = smyl_radiograph_reference_annotations.tenant_id and s.id = smyl_radiograph_reference_annotations.source_id and public.smyl_can_access_patient(s.tenant_id, s.patient_id, 'clinical')));
drop policy if exists smyl_radiograph_incidents_read on public.smyl_radiograph_incidents;
create policy smyl_radiograph_incidents_read on public.smyl_radiograph_incidents for select to authenticated using (public.smyl_has_permission(tenant_id, 'clinical.approve'));
drop policy if exists smyl_radiograph_validation_reports_read on public.smyl_radiograph_validation_reports;
create policy smyl_radiograph_validation_reports_read on public.smyl_radiograph_validation_reports for select to authenticated using (public.smyl_has_permission(tenant_id, 'clinical.read'));

-- Guardia de validación: tenant con permiso de aprobación clínica.
create or replace function public.smyl_radiograph_validation_guard()
returns uuid language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant();
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.approve') then
    raise exception using errcode = '42501', message = 'La validación del motor requiere permiso de aprobación clínica.';
  end if;
  return v_tenant;
end;
$$;
revoke all on function public.smyl_radiograph_validation_guard() from public, anon, authenticated;

create or replace function public.smyl_radiograph_create_eval_set(p_name text, p_intended_use text, p_population text default '', p_exclusions text default '', p_split text default 'test')
returns public.smyl_radiograph_eval_sets language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_radiograph_validation_guard(); v_row public.smyl_radiograph_eval_sets;
begin
  select * into v_row from public.smyl_radiograph_eval_sets where tenant_id = v_tenant and name = p_name;
  if found then return v_row; end if;
  insert into public.smyl_radiograph_eval_sets(tenant_id, name, intended_use, population, exclusions, split, created_by)
  values (v_tenant, p_name, p_intended_use, coalesce(p_population, ''), coalesce(p_exclusions, ''), p_split, auth.uid()) returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_create_eval_set(text, text, text, text, text) from public, anon;
grant execute on function public.smyl_radiograph_create_eval_set(text, text, text, text, text) to authenticated;

create or replace function public.smyl_radiograph_add_eval_member(p_set_id uuid, p_source_id uuid, p_training_exposure boolean)
returns public.smyl_radiograph_eval_members language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_radiograph_validation_guard(); v_set public.smyl_radiograph_eval_sets; v_row public.smyl_radiograph_eval_members;
begin
  if p_training_exposure is null then raise exception using errcode = '22023', message = 'Declara si la fuente pudo haber sido vista por el proveedor al entrenar.'; end if;
  select * into v_set from public.smyl_radiograph_eval_sets where tenant_id = v_tenant and id = p_set_id for update;
  if not found then raise exception using errcode = '42501', message = 'El conjunto de evaluación no está disponible.'; end if;
  if v_set.locked_at is not null then raise exception using errcode = '23514', message = 'El conjunto está bloqueado por un informe de validación.'; end if;
  if not exists (select 1 from public.smyl_radiograph_sources s where s.tenant_id = v_tenant and s.id = p_source_id and public.smyl_can_access_patient(v_tenant, s.patient_id, 'clinical')) then
    raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  insert into public.smyl_radiograph_eval_members(tenant_id, set_id, source_id, training_exposure, added_by)
  values (v_tenant, p_set_id, p_source_id, p_training_exposure, auth.uid())
  on conflict (tenant_id, set_id, source_id) do update set training_exposure = excluded.training_exposure returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_add_eval_member(uuid, uuid, boolean) from public, anon;
grant execute on function public.smyl_radiograph_add_eval_member(uuid, uuid, boolean) to authenticated;

-- Anotación de referencia: cualquier profesional con clinical.write y alcance del paciente; una por
-- (anotador, pieza, categoría); inmutable (para cambiar de opinión se anota adjudicando).
create or replace function public.smyl_radiograph_annotate_reference(p_source_id uuid, p_kind text, p_fdi text, p_category text, p_present boolean, p_geometry jsonb default null, p_note text default '', p_adjudicated boolean default false)
returns public.smyl_radiograph_reference_annotations language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_source public.smyl_radiograph_sources; v_tenant uuid; v_row public.smyl_radiograph_reference_annotations;
begin
  select * into v_source from public.smyl_radiograph_sources s where s.id = p_source_id and s.tenant_id = public.smyl_current_tenant();
  if not found then raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  v_tenant := public.smyl_radiograph_guard(v_source.patient_id, 'clinical.write');
  if public.smyl_current_professional_id(v_tenant) is null then raise exception using errcode = '42501', message = 'Sólo un profesional registrado en la clínica puede anotar la referencia.'; end if;
  if p_adjudicated and not public.smyl_has_permission(v_tenant, 'clinical.approve') then raise exception using errcode = '42501', message = 'Adjudicar requiere permiso de aprobación clínica.'; end if;
  if exists (select 1 from public.smyl_radiograph_reference_annotations a where a.tenant_id = v_tenant and a.source_id = p_source_id and a.annotator_id = auth.uid() and a.kind = p_kind and a.fdi = p_fdi and a.category = coalesce(p_category, '') and a.adjudicated = coalesce(p_adjudicated, false)) then
    raise exception using errcode = '23505', message = 'Ya anotaste esta pieza; la referencia es inmutable. Usa una adjudicación para resolver.'; end if;
  insert into public.smyl_radiograph_reference_annotations(tenant_id, source_id, annotator_id, professional_id, kind, fdi, category, present, geometry, adjudicated, note)
  values (v_tenant, p_source_id, auth.uid(), public.smyl_current_professional_id(v_tenant), p_kind, p_fdi, coalesce(p_category, ''), p_present, p_geometry, coalesce(p_adjudicated, false), coalesce(p_note, '')) returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_annotate_reference(uuid, text, text, text, boolean, jsonb, text, boolean) from public, anon;
grant execute on function public.smyl_radiograph_annotate_reference(uuid, text, text, text, boolean, jsonb, text, boolean) to authenticated;

-- Verdad de referencia por (fuente, tipo, pieza, categoría): adjudicación > mayoría de anotadores;
-- empate = desacuerdo sin resolver (se excluye de las métricas y se cuenta).
create or replace function public.smyl_radiograph_reference_truth(p_tenant uuid, p_source_id uuid)
returns table (kind text, fdi text, category text, present boolean, annotators integer, disagreement boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with votes as (
    select a.kind, a.fdi, a.category,
      bool_or(a.adjudicated) as adjudicated,
      bool_or(a.adjudicated and a.present) as adjudicated_present, bool_or(a.adjudicated and not a.present) as adjudicated_absent,
      count(*) filter (where a.present) as yes, count(*) filter (where not a.present) as no, count(distinct a.annotator_id) as annotators
    from public.smyl_radiograph_reference_annotations a
    where a.tenant_id = p_tenant and a.source_id = p_source_id
    group by a.kind, a.fdi, a.category)
  select v.kind, v.fdi, v.category,
    case when v.adjudicated then (v.adjudicated_present and not v.adjudicated_absent) when v.yes > v.no then true when v.no > v.yes then false else null end,
    v.annotators::integer,
    ((not v.adjudicated and v.yes = v.no) or (v.adjudicated_present and v.adjudicated_absent))
  from votes v;
$$;
revoke all on function public.smyl_radiograph_reference_truth(uuid, uuid) from public, anon, authenticated;

-- Métricas por tarea, tipo de estudio efectivo y motor (proveedor/nombre/versión). Verdad =
-- referencia consensuada cuando existe; si una fuente no tiene referencia, se usan las decisiones
-- profesionales (confirmed/corrected) y se marca `truthSource`. Piezas: universo FDI permanente (32)
-- → sensibilidad, especificidad, precisión, FP, FN. Señales: sin universo negativo fijo →
-- sensibilidad, precisión, FP, FN (especificidad null). Calibración en 5 franjas de confianza.
create or replace function public.smyl_radiograph_validation_metrics(p_set_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_radiograph_validation_guard(); v_set public.smyl_radiograph_eval_sets; v_result jsonb;
begin
  select * into v_set from public.smyl_radiograph_eval_sets where tenant_id = v_tenant and id = p_set_id;
  if not found then raise exception using errcode = '42501', message = 'El conjunto de evaluación no está disponible.'; end if;
  with members as (
    select m.source_id, m.training_exposure, public.smyl_radiograph_effective_study_type(v_tenant, m.source_id) as study_type
    from public.smyl_radiograph_eval_members m where m.tenant_id = v_tenant and m.set_id = p_set_id),
  runs as (
    select r.id as run_id, r.source_id, r.kind, r.engine, r.status, r.failure_code, r.requested_at, r.completed_at
    from public.smyl_radiograph_ai_runs r join members m on m.source_id = r.source_id where r.tenant_id = v_tenant and r.kind <> 'qc'),
  -- Candidatos del modelo (positivos) con su decisión
  cand as (
    select c.source_id, r.kind as task, r.engine, c.kind as ckind, c.id as candidate_id,
      case when c.kind = 'tooth' then c.payload->>'fdiCandidate' else coalesce(c.payload->>'toothCandidate', '') end as fdi,
      case when c.kind = 'tooth' then '' else c.payload->>'category' end as category,
      coalesce((c.payload->>'fdiProbability')::numeric, (c.payload->>'confidence')::numeric) as confidence,
      d.state, d.payload as decision_payload
    from public.smyl_radiograph_candidates c
    join runs r on r.run_id = c.run_id and r.status = 'completed'
    left join public.smyl_radiograph_decisions d on d.tenant_id = c.tenant_id and d.candidate_id = c.id
    where c.tenant_id = v_tenant),
  model_pos as (select distinct source_id, task, engine, ckind, fdi, category from cand where fdi is not null),
  -- Verdad por fuente: referencia consensuada o decisiones profesionales
  ref as (
    select m.source_id, t.kind as ckind, t.fdi, t.category, t.present, t.disagreement
    from members m cross join lateral public.smyl_radiograph_reference_truth(v_tenant, m.source_id) t),
  ref_sources as (select distinct source_id from ref),
  truth as (
    select source_id, ckind, fdi, category from ref where present and not disagreement
    union
    select c.source_id, c.ckind, case when c.decision_payload ? 'fdi' then coalesce(c.decision_payload->>'fdi', '') else c.fdi end, c.category from cand c
    where c.state in ('confirmed','corrected') and c.source_id not in (select source_id from ref_sources)),
  -- Universo = fuentes del conjunto × ejecuciones completadas: una fuente donde el modelo no propuso
  -- nada también cuenta (sus omisiones son falsos negativos), no sólo donde acertó o falló.
  source_engine as (select distinct r.source_id, r.kind as task, r.engine, case when r.kind = 'tooth_localization' then 'tooth' else 'finding' end as ckind
    from runs r where r.status = 'completed'),
  joined as (
    select se.source_id, se.task, se.engine, se.ckind, m.study_type,
      (select count(*) from model_pos p join truth t on t.source_id = p.source_id and t.ckind = p.ckind and t.fdi = p.fdi and t.category = p.category where p.source_id = se.source_id and p.task = se.task and p.engine = se.engine) as tp,
      (select count(*) from model_pos p where p.source_id = se.source_id and p.task = se.task and p.engine = se.engine and not exists (select 1 from truth t where t.source_id = p.source_id and t.ckind = p.ckind and t.fdi = p.fdi and t.category = p.category)) as fp,
      (select count(*) from truth t where t.source_id = se.source_id and t.ckind = se.ckind and not exists (select 1 from model_pos p where p.source_id = t.source_id and p.task = se.task and p.engine = se.engine and p.ckind = t.ckind and p.fdi = t.fdi and p.category = t.category)) as fn,
      (select count(*) from model_pos p where p.source_id = se.source_id and p.task = se.task and p.engine = se.engine) as positives,
      (select count(*) from truth t where t.source_id = se.source_id and t.ckind = se.ckind) as truths,
      exists (select 1 from ref_sources r where r.source_id = se.source_id) as has_reference
    from source_engine se join members m on m.source_id = se.source_id),
  groups as (
    select task, engine, study_type,
      count(*) as sources, count(*) filter (where has_reference) as with_reference,
      sum(tp) as tp, sum(fp) as fp, sum(fn) as fn,
      case when ckind = 'tooth' then sum(32 - (positives + fn)) else null end as tn, ckind
    from joined group by task, engine, study_type, ckind),
  calib as (
    select task, engine, width_bucket(confidence, 0, 1.0000001, 5) as bin, count(*) as n,
      count(*) filter (where state in ('confirmed','corrected')) as confirmed
    from cand where state in ('confirmed','corrected','rejected') group by task, engine, bin),
  disagreement as (
    select task, engine, count(*) filter (where state in ('confirmed','corrected','rejected')) as decided,
      count(*) filter (where state in ('rejected','corrected')) as disagreed, count(*) filter (where state = 'pending') as pending
    from cand group by task, engine),
  runstats as (
    select kind as task, engine, count(*) as runs, count(*) filter (where status = 'failed') as failed,
      count(*) filter (where status = 'unconfirmed') as unconfirmed,
      round(avg(extract(epoch from (completed_at - requested_at)) * 1000) filter (where status = 'completed'))::integer as mean_latency_ms
    from runs group by kind, engine)
  select jsonb_build_object(
    'schema', 1, 'setId', v_set.id, 'setName', v_set.name, 'split', v_set.split, 'intendedUse', v_set.intended_use,
    'sources', (select count(*) from members),
    'sourceIds', coalesce((select jsonb_agg(source_id order by source_id) from members), '[]'::jsonb),
    'trainingExposure', (select count(*) from members where training_exposure),
    'referenceDisagreements', (select count(*) from ref where disagreement),
    'groups', coalesce((select jsonb_agg(jsonb_build_object(
        'task', g.task, 'engine', g.engine, 'studyType', g.study_type, 'sources', g.sources, 'withReference', g.with_reference,
        'tp', g.tp, 'fp', g.fp, 'fn', g.fn, 'tn', g.tn,
        'sensitivity', case when g.tp + g.fn > 0 then round(g.tp::numeric / (g.tp + g.fn), 4) else null end,
        'specificity', case when g.tn is not null and g.tn + g.fp > 0 then round(g.tn::numeric / (g.tn + g.fp), 4) else null end,
        'precision', case when g.tp + g.fp > 0 then round(g.tp::numeric / (g.tp + g.fp), 4) else null end,
        'truthSource', case when g.with_reference = g.sources then 'reference' when g.with_reference = 0 then 'professional_decisions' else 'mixed' end
      ) order by g.task, g.engine->>'version', g.study_type) from groups g), '[]'::jsonb),
    'calibration', coalesce((select jsonb_agg(jsonb_build_object('task', c.task, 'engine', c.engine, 'bin', c.bin, 'lower', round((c.bin - 1) * 0.2, 1), 'upper', round(c.bin * 0.2, 1), 'n', c.n, 'confirmedRate', round(c.confirmed::numeric / c.n, 4)) order by c.task, c.bin) from calib c), '[]'::jsonb),
    'disagreement', coalesce((select jsonb_agg(jsonb_build_object('task', d.task, 'engine', d.engine, 'decided', d.decided, 'disagreed', d.disagreed, 'pending', d.pending, 'rate', case when d.decided > 0 then round(d.disagreed::numeric / d.decided, 4) else null end)) from disagreement d), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('task', r.task, 'engine', r.engine, 'runs', r.runs, 'failed', r.failed, 'unconfirmed', r.unconfirmed, 'meanLatencyMs', r.mean_latency_ms)) from runstats r), '[]'::jsonb),
    'limitations', jsonb_build_array(
      'Las métricas de señales no tienen universo negativo fijo: la especificidad no se calcula.',
      'Cuando no hay referencia multi-profesional, la verdad son las decisiones del propio revisor (sesgo de confirmación posible).',
      'Sin mediciones de nivel óseo ni distancias: método no validado.')
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.smyl_radiograph_validation_metrics(uuid) from public, anon;
grant execute on function public.smyl_radiograph_validation_metrics(uuid) to authenticated;

-- Monitoreo del motor desplegado (deriva): series semanales de volumen, fallos, timeouts, latencia y desacuerdo.
create or replace function public.smyl_radiograph_monitoring(p_days integer default 90)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_radiograph_validation_guard(); v_days integer := greatest(7, least(coalesce(p_days, 90), 365)); v_result jsonb;
begin
  with runs as (
    select r.*, date_trunc('week', r.requested_at) as week from public.smyl_radiograph_ai_runs r
    where r.tenant_id = v_tenant and r.requested_at >= now() - make_interval(days => v_days)),
  decided as (
    select r.kind, r.engine, date_trunc('week', d.decided_at) as week, count(*) as decided, count(*) filter (where d.state in ('rejected','corrected')) as disagreed
    from public.smyl_radiograph_decisions d join public.smyl_radiograph_candidates c on c.tenant_id = d.tenant_id and c.id = d.candidate_id
    join public.smyl_radiograph_ai_runs r on r.tenant_id = c.tenant_id and r.id = c.run_id
    where d.tenant_id = v_tenant and d.decided_at >= now() - make_interval(days => v_days) group by r.kind, r.engine, week),
  weekly as (
    select kind, engine, week, count(*) as runs, count(*) filter (where status = 'failed') as failed, count(*) filter (where status = 'unconfirmed') as unconfirmed,
      round(avg(extract(epoch from (completed_at - requested_at)) * 1000) filter (where status = 'completed'))::integer as mean_latency_ms
    from runs group by kind, engine, week)
  select jsonb_build_object(
    'schema', 1, 'days', v_days,
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('task', w.kind, 'engine', w.engine, 'week', to_char(w.week, 'YYYY-MM-DD'), 'runs', w.runs, 'failed', w.failed, 'unconfirmed', w.unconfirmed, 'meanLatencyMs', w.mean_latency_ms,
        'decided', coalesce(d.decided, 0), 'disagreed', coalesce(d.disagreed, 0), 'disagreementRate', case when coalesce(d.decided, 0) > 0 then round(d.disagreed::numeric / d.decided, 4) else null end) order by w.week, w.kind)
      from weekly w left join decided d on d.kind = w.kind and d.engine = w.engine and d.week = w.week), '[]'::jsonb),
    'openIncidents', (select count(*) from public.smyl_radiograph_incidents i where i.tenant_id = v_tenant and i.status = 'open'),
    'engines', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'provider', e.provider, 'name', e.name, 'version', e.version, 'enabled', e.enabled) order by e.kind) from public.smyl_radiograph_engines e where e.enabled), '[]'::jsonb),
    'flags', (select jsonb_object_agg(f.key, public.smyl_radiograph_flag_enabled(f.key, v_tenant)) from public.smyl_radiograph_feature_flags f)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.smyl_radiograph_monitoring(integer) from public, anon;
grant execute on function public.smyl_radiograph_monitoring(integer) to authenticated;

create or replace function public.smyl_radiograph_report_incident(p_severity text, p_category text, p_description text, p_source_id uuid default null, p_run_id uuid default null)
returns public.smyl_radiograph_incidents language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_row public.smyl_radiograph_incidents;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.write') then raise exception using errcode = '42501', message = 'No tienes permiso para registrar incidentes.'; end if;
  if p_source_id is not null and not exists (select 1 from public.smyl_radiograph_sources s where s.tenant_id = v_tenant and s.id = p_source_id and public.smyl_can_access_patient(v_tenant, s.patient_id, 'clinical')) then
    raise exception using errcode = '42501', message = 'La fuente radiográfica no está disponible.'; end if;
  if p_run_id is not null and not exists (select 1 from public.smyl_radiograph_ai_runs r where r.tenant_id = v_tenant and r.id = p_run_id and (p_source_id is null or r.source_id = p_source_id)
       and public.smyl_can_access_patient(v_tenant, r.patient_id, 'clinical')) then
    raise exception using errcode = '42501', message = 'La ejecución no está disponible.'; end if;
  insert into public.smyl_radiograph_incidents(tenant_id, source_id, run_id, severity, category, description, created_by)
  values (v_tenant, p_source_id, p_run_id, p_severity, p_category, p_description, auth.uid()) returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_report_incident(text, text, text, uuid, uuid) from public, anon;
grant execute on function public.smyl_radiograph_report_incident(text, text, text, uuid, uuid) to authenticated;

create or replace function public.smyl_radiograph_close_incident(p_incident_id uuid, p_resolution text)
returns public.smyl_radiograph_incidents language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_radiograph_validation_guard(); v_row public.smyl_radiograph_incidents;
begin
  update public.smyl_radiograph_incidents set status = 'closed', resolution = coalesce(p_resolution, ''), closed_by = auth.uid(), closed_at = clock_timestamp()
  where tenant_id = v_tenant and id = p_incident_id and status = 'open' returning * into v_row;
  if not found then raise exception using errcode = '23514', message = 'El incidente no está abierto o no está disponible.'; end if;
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_close_incident(uuid, text) from public, anon;
grant execute on function public.smyl_radiograph_close_incident(uuid, text) to authenticated;

-- Informe de validación: snapshot de métricas + criterios de salida evaluados en el servidor.
-- Cada criterio: {"metric":"sensitivity|specificity|precision|disagreementRate|unconfirmedRate","task":"...","min":0.9} o {"max":...}.
create or replace function public.smyl_radiograph_record_validation_report(p_set_id uuid, p_exit_criteria jsonb, p_notes text default '')
returns public.smyl_radiograph_validation_reports language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_radiograph_validation_guard(); v_metrics jsonb; v_c jsonb; v_g jsonb; v_value numeric; v_met boolean := true; v_any boolean := false; v_row public.smyl_radiograph_validation_reports; v_version integer; v_engines jsonb; v_professional uuid;
begin
  if jsonb_typeof(p_exit_criteria) is distinct from 'array' or jsonb_array_length(p_exit_criteria) not between 1 and 20 then raise exception using errcode = '22023', message = 'Define entre 1 y 20 criterios de salida.'; end if;
  v_professional := public.smyl_current_professional_id(v_tenant);
  if v_professional is null then raise exception using errcode = '23514', message = 'Sólo un profesional registrado puede aprobar un informe de validación.'; end if;
  perform 1 from public.smyl_radiograph_eval_sets where tenant_id = v_tenant and id = p_set_id for update;
  v_metrics := public.smyl_radiograph_validation_metrics(p_set_id);
  if (v_metrics->>'sources')::integer = 0 then raise exception using errcode = '23514', message = 'El conjunto no tiene fuentes.'; end if;
  if (v_metrics->>'trainingExposure')::integer > 0 then raise exception using errcode = '23514', message = 'El conjunto contiene fuentes con posible exposición al entrenamiento; no es un conjunto de prueba independiente.'; end if;
  if (v_metrics->>'sources')::integer < coalesce((public.smyl_radiograph_setting('validation_min_sources'))::integer, 30) then
    raise exception using errcode = '23514', message = format('Un informe de validación requiere al menos %s fuentes independientes.', coalesce((public.smyl_radiograph_setting('validation_min_sources'))::integer, 30)); end if;
  if exists (select 1 from jsonb_array_elements(v_metrics->'groups') g where g->>'truthSource' is distinct from 'reference') then
    raise exception using errcode = '23514', message = 'Todas las fuentes necesitan referencia multi-profesional: las decisiones del propio revisor no validan al motor.'; end if;
  if exists (select 1 from jsonb_array_elements(v_metrics->'groups') g where g->'engine'->>'provider' = 'simulated') then
    raise exception using errcode = '23514', message = 'Un motor simulado no puede validarse: produce geometría sintética.'; end if;
  if exists (select 1 from jsonb_array_elements_text(v_metrics->'sourceIds') sid(id) where (
      select count(distinct a.annotator_id) from public.smyl_radiograph_reference_annotations a where a.tenant_id = v_tenant and a.source_id = sid.id::uuid and not a.adjudicated)
      < coalesce((public.smyl_radiograph_setting('validation_min_annotators'))::integer, 2)) then
    raise exception using errcode = '23514', message = 'Cada fuente necesita referencia de al menos el mínimo de profesionales independientes.'; end if;
  for v_c in select value from jsonb_array_elements(p_exit_criteria) loop
    if jsonb_typeof(v_c) is distinct from 'object' or coalesce(v_c->>'metric','') not in ('sensitivity','specificity','precision','disagreementRate','unconfirmedRate') or coalesce(v_c->>'task','') not in ('tooth_localization','finding_candidates')
       or not ((v_c ? 'min') or (v_c ? 'max')) then raise exception using errcode = '22023', message = 'Criterio de salida no válido.'; end if;
    v_value := null;
    if v_c->>'metric' in ('sensitivity','specificity','precision') then
      -- el peor grupo (motor × tipo de estudio) de esa tarea decide
      select min((g->>(v_c->>'metric'))::numeric) into v_value from jsonb_array_elements(v_metrics->'groups') g where g->>'task' = v_c->>'task' and g->>(v_c->>'metric') is not null;
    elsif v_c->>'metric' = 'disagreementRate' then
      select max((d->>'rate')::numeric) into v_value from jsonb_array_elements(v_metrics->'disagreement') d where d->>'task' = v_c->>'task' and d->>'rate' is not null;
    else
      select max(case when (r->>'runs')::numeric > 0 then (r->>'unconfirmed')::numeric / (r->>'runs')::numeric else null end) into v_value from jsonb_array_elements(v_metrics->'runs') r where r->>'task' = v_c->>'task';
    end if;
    v_any := true;
    if v_value is null or (v_c ? 'min' and v_value < (v_c->>'min')::numeric) or (v_c ? 'max' and v_value > (v_c->>'max')::numeric) then v_met := false; end if;
  end loop;
  select coalesce(jsonb_agg(distinct g->'engine'), '[]'::jsonb) into v_engines from jsonb_array_elements(v_metrics->'groups') g;
  select coalesce(max(version), 0) + 1 into v_version from public.smyl_radiograph_validation_reports where tenant_id = v_tenant and set_id = p_set_id;
  insert into public.smyl_radiograph_validation_reports(tenant_id, set_id, version, engines, metrics, exit_criteria, criteria_met, verdict, notes, approved_by, approved_professional_id, content_hash)
  values (v_tenant, p_set_id, v_version, v_engines, v_metrics, p_exit_criteria, v_met and v_any, case when v_met and v_any then 'approved_for_pilot' else 'not_approved' end, coalesce(p_notes, ''), auth.uid(), v_professional,
    encode(sha256(convert_to((v_metrics::text || p_exit_criteria::text), 'UTF8')), 'hex')) returning * into v_row;
  update public.smyl_radiograph_eval_sets set locked_at = clock_timestamp() where tenant_id = v_tenant and id = p_set_id and locked_at is null;
  return v_row;
end;
$$;
revoke all on function public.smyl_radiograph_record_validation_report(uuid, jsonb, text) from public, anon;
grant execute on function public.smyl_radiograph_record_validation_report(uuid, jsonb, text) to authenticated;

-- (La bandera efectiva y la pausa por clínica viven en 20261028100000.)

-- Divulgación para la interfaz: motor activo por tarea, último informe de validación de la clínica,
-- fecha de actualización y límites. Nunca credenciales ni config.
create or replace function public.smyl_radiograph_model_disclosure()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid := public.smyl_current_tenant(); v_result jsonb;
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinical.read') then raise exception using errcode = '42501', message = 'No tienes permiso para consultar el motor.'; end if;
  select jsonb_build_object(
    'schema', 1,
    'engines', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'provider', e.provider, 'name', e.name, 'version', e.version, 'updatedAt', e.updated_at,
        'simulated', e.provider = 'simulated') order by e.kind) from public.smyl_radiograph_engines e where e.enabled), '[]'::jsonb),
    'validation', (select jsonb_build_object('version', r.version, 'verdict', r.verdict, 'criteriaMet', r.criteria_met, 'approvedAt', r.approved_at, 'setName', s.name, 'engines', r.engines,
        'matchesActiveEngines', not exists (select 1 from public.smyl_radiograph_engines e where e.enabled and e.kind <> 'qc'
          and not (r.engines @> jsonb_build_array(jsonb_build_object('provider', e.provider, 'name', e.name, 'version', e.version)))))
      from public.smyl_radiograph_validation_reports r join public.smyl_radiograph_eval_sets s on s.tenant_id = r.tenant_id and s.id = r.set_id
      where r.tenant_id = v_tenant order by r.approved_at desc limit 1),
    'openIncidents', (select count(*) from public.smyl_radiograph_incidents i where i.tenant_id = v_tenant and i.status = 'open'),
    'limits', jsonb_build_array(
      'Revisión asistida: candidatos para confirmar, no diagnóstico.',
      'Un motor simulado produce geometría sintética, no anatomía.',
      'Sin mediciones de nivel óseo ni distancias.',
      'Sin informe de validación aprobado, el uso es piloto bajo supervisión profesional.')
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.smyl_radiograph_model_disclosure() from public, anon;
grant execute on function public.smyl_radiograph_model_disclosure() to authenticated;

comment on table public.smyl_radiograph_validation_reports is 'Informe de validación versionado e inmutable: snapshot de métricas, criterios de salida, veredicto y hash.';
comment on table public.smyl_radiograph_reference_annotations is 'Referencia anotada por varios profesionales, independiente del modelo; consenso por mayoría y adjudicación.';
commit;
