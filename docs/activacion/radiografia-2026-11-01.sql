-- ACTIVACIÓN DE LA RADIOGRAFÍA (Mesa de Luz) — 4 migraciones en orden, para pegar de una vez en el SQL Editor de Supabase.
-- Proyecto SMYL (rpxshsiwoxdbuevjjpfw). Son idéntico a los archivos de supabase/migrations/ y todas son idempotentes:
-- si algo se corta a la mitad, se puede volver a ejecutar completo sin riesgo.

-- ====================================================================================================
-- 20261031120000_smyl_ai_usage_log.sql
-- ====================================================================================================
-- Medición de lo que consume cada análisis de IA (empieza con el análisis de radiografía).
--
-- La Edge Function `claude` guarda una fila por análisis con los tokens reales que informa Anthropic, el modelo,
-- el tiempo y un costo estimado en dólares. No guarda imágenes, respuestas del modelo ni datos de pacientes.
-- Solo la Edge Function (service role) escribe; la clínica lee únicamente el resumen de su propia clínica.
--
-- Se aplica con el SQL Editor de Supabase. Es idempotente.

create table if not exists public.smyl_ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  feature text not null check (feature in ('radiograph_analysis')),
  model text not null check (char_length(model) between 1 and 80),
  request_id text check (request_id is null or char_length(request_id) <= 120),
  outcome text not null check (outcome in ('ok', 'incomplete', 'error')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cache_read_tokens integer check (cache_read_tokens is null or cache_read_tokens >= 0),
  cache_write_tokens integer check (cache_write_tokens is null or cache_write_tokens >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  stop_reason text check (stop_reason is null or char_length(stop_reason) <= 40),
  estimated_cost_usd numeric(10, 5) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index if not exists smyl_ai_usage_log_tenant_feature_created_idx
  on public.smyl_ai_usage_log (tenant_id, feature, created_at desc);

alter table public.smyl_ai_usage_log enable row level security;
revoke all on public.smyl_ai_usage_log from public, anon, authenticated;
-- Sin políticas ni permisos para usuarios: el resumen se lee con la función de abajo.

create or replace function public.smyl_ai_usage_summary(
  p_feature text default 'radiograph_analysis',
  p_days integer default 30
)
returns table (
  analyses bigint,
  completed bigint,
  avg_input_tokens numeric,
  avg_output_tokens numeric,
  avg_seconds numeric,
  total_cost_usd numeric,
  avg_cost_usd numeric,
  max_cost_usd numeric,
  model text,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinic.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver el consumo de IA.';
  end if;
  if p_feature is distinct from 'radiograph_analysis' then
    raise exception using errcode = '22023', message = 'Función de IA no válida.';
  end if;

  return query
  select count(*)::bigint,
         count(*) filter (where l.outcome = 'ok')::bigint,
         round(avg(l.input_tokens) filter (where l.outcome <> 'error'), 0),
         round(avg(l.output_tokens) filter (where l.outcome <> 'error'), 0),
         round(avg(l.duration_ms) filter (where l.outcome <> 'error') / 1000.0, 1),
         round(coalesce(sum(l.estimated_cost_usd), 0), 4),
         round(avg(l.estimated_cost_usd) filter (where l.outcome <> 'error'), 4),
         max(l.estimated_cost_usd),
         (array_agg(l.model order by l.created_at desc))[1],
         max(l.created_at)
  from public.smyl_ai_usage_log l
  where l.tenant_id = v_tenant and l.feature = p_feature
    and l.created_at >= now() - make_interval(days => v_days);
end;
$$;

revoke all on function public.smyl_ai_usage_summary(text, integer) from public, anon;
grant execute on function public.smyl_ai_usage_summary(text, integer) to authenticated;

comment on table public.smyl_ai_usage_log is
  'Una fila por análisis de IA con tokens y costo estimado. Sin imágenes ni datos de pacientes. Solo escribe la Edge Function.';

-- ====================================================================================================
-- 20261031130000_smyl_radiograph_model_opus.sql
-- ====================================================================================================
-- La revisión de radiografías guarda con qué modelo se hizo el análisis. Hasta ahora solo aceptaba Sonnet 4.6;
-- el análisis pasa a Claude Opus 5.5, así que se aceptan los dos (las revisiones anteriores siguen siendo válidas).
-- Es la misma validación de 20261006010000_smyl_radiograph_reviews.sql con una sola condición cambiada.
--
-- Se aplica con el SQL Editor de Supabase. Es idempotente (create or replace).

create or replace function public.smyl_validate_radiograph_review(p_document jsonb,p_study jsonb)
returns void language plpgsql set search_path='' as $$
declare w jsonb; a jsonb; r jsonb; o jsonb; i jsonb; id_list text[]:=array[]::text[]; source_list text[]:=array[]::text[]; report_ids text[]:=array[]::text[];
begin
 if p_document is null or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>120000
 or p_document-array['schema','study','workflow','analysis','items']<>'{}'::jsonb
 or not(p_document ?& array['schema','study','workflow','analysis','items']) or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'study') is distinct from 'object' or (p_document->'study')-array['id','type','sha256']<>'{}'::jsonb
 or p_document->'study'->>'id' is distinct from p_study->>'id' or p_document->'study'->>'type' is distinct from p_study->>'type'
 or p_document->'study'->>'sha256' is distinct from p_study->'asset'->>'sha256'
 or jsonb_typeof(p_document->'items') is distinct from 'array' or jsonb_array_length(p_document->'items')>12
 then raise exception 'Invalid radiograph review' using errcode='22023'; end if;
 w:=p_document->'workflow';
 if jsonb_typeof(w) is distinct from 'object' or w-array['state','attempt']<>'{}'::jsonb or not(w ?& array['state','attempt'])
 or coalesce(w->>'state','') not in ('ready','requested','completed','unconfirmed')
 or jsonb_typeof(w->'attempt') is distinct from 'number' or coalesce(w->>'attempt','') !~ '^[01]$'
 then raise exception 'Invalid radiograph workflow' using errcode='22023'; end if;
 if (w->>'state'='ready' and ((w->>'attempt')::integer<>0 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 or (w->>'state' in ('requested','unconfirmed') and ((w->>'attempt')::integer<>1 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 then raise exception 'Invalid radiograph workflow state' using errcode='22023'; end if;
 a:=p_document->'analysis';
 if w->>'state'='completed' then
  if (w->>'attempt')::integer<>1 or jsonb_typeof(a) is distinct from 'object' or a-array['model','at','requestId','report']<>'{}'::jsonb
  or not(a ?& array['model','at','requestId','report']) or a->>'model' not in ('claude-sonnet-4-6','claude-opus-5-5')
  or jsonb_typeof(a->'at') is distinct from 'string' or coalesce(a->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
  or jsonb_typeof(a->'requestId') is distinct from 'string' or (a->>'requestId'<>'' and a->>'requestId' !~ '^msg_[a-zA-Z0-9_-]{1,100}$')
  then raise exception 'Invalid radiograph analysis' using errcode='22023'; end if;
  perform (a->>'at')::timestamptz; r:=a->'report';
  if jsonb_typeof(r) is distinct from 'object' or r-array['schema','quality','qualityNote','observations','limitations']<>'{}'::jsonb
  or not(r ?& array['schema','quality','qualityNote','observations','limitations']) or r->'schema' is distinct from '1'::jsonb
  or coalesce(r->>'quality','') not in ('usable','limited','unusable') or jsonb_typeof(r->'qualityNote') is distinct from 'string' or length(trim(r->>'qualityNote')) not between 1 and 400
  or jsonb_typeof(r->'observations') is distinct from 'array' or jsonb_array_length(r->'observations')>12
  or jsonb_typeof(r->'limitations') is distinct from 'array' or jsonb_array_length(r->'limitations')>8
  then raise exception 'Invalid radiograph report' using errcode='22023'; end if;
  if r->>'quality'='unusable' and jsonb_array_length(r->'observations')<>0 then raise exception 'Unusable image cannot have observations' using errcode='22023'; end if;
  for o in select value from jsonb_array_elements(r->'observations') loop
   if jsonb_typeof(o) is distinct from 'object' or o-array['id','category','tooth','observation','evidence']<>'{}'::jsonb
   or not(o ?& array['id','category','tooth','observation','evidence']) or coalesce(o->>'id','') !~ '^r([1-9]|1[0-2])$' or o->>'id'=any(report_ids)
   or coalesce(o->>'category','') not in ('density','contour','restoration','support','development','other')
   or not(o->'tooth'='null'::jsonb or (jsonb_typeof(o->'tooth')='string' and o->>'tooth' ~ '^[1-4][1-8]$'))
   or jsonb_typeof(o->'observation') is distinct from 'string' or length(trim(o->>'observation')) not between 1 and 500
   or jsonb_typeof(o->'evidence') is distinct from 'string' or length(trim(o->>'evidence')) not between 1 and 300
   then raise exception 'Invalid radiograph observation' using errcode='22023'; end if;
   report_ids:=array_append(report_ids,o->>'id');
  end loop;
  for o in select value from jsonb_array_elements(r->'limitations') loop
   if jsonb_typeof(o) is distinct from 'string' or length(trim(o#>>'{}')) not between 1 and 300 then raise exception 'Invalid radiograph limitation' using errcode='22023'; end if;
  end loop;
 elsif a<>'null'::jsonb then raise exception 'Unexpected radiograph analysis' using errcode='22023';
 end if;
 for i in select value from jsonb_array_elements(p_document->'items') loop
  if jsonb_typeof(i) is distinct from 'object' or i-array['id','sourceId','tooth','text','x','y','state']<>'{}'::jsonb
  or not(i ?& array['id','sourceId','tooth','text','x','y','state'])
  or coalesce(i->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or i->>'id'=any(id_list)
  or coalesce(i->>'sourceId','') !~ '^r([1-9]|1[0-2])$' or i->>'sourceId'=any(source_list) or not(i->>'sourceId'=any(report_ids))
  or jsonb_typeof(i->'tooth') is distinct from 'string' or (i->>'tooth'<>'' and i->>'tooth' !~ '^[1-4][1-8]$')
  or jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text')>600 or coalesce(i->>'state','') not in ('pending','confirmed','rejected')
  or not((i->'x'='null'::jsonb and i->'y'='null'::jsonb) or (jsonb_typeof(i->'x')='number' and jsonb_typeof(i->'y')='number' and (i->>'x')::numeric between 0 and 1 and (i->>'y')::numeric between 0 and 1))
  or (i->>'state'='confirmed' and (trim(i->>'text')='' or i->'x'='null'::jsonb))
  then raise exception 'Invalid reviewed radiograph item' using errcode='22023'; end if;
  id_list:=array_append(id_list,i->>'id');source_list:=array_append(source_list,i->>'sourceId');
 end loop;
 if cardinality(source_list)<>cardinality(report_ids) then raise exception 'Missing radiograph suggestion' using errcode='22023'; end if;
end;$$;

revoke all on function public.smyl_validate_radiograph_review(jsonb,jsonb) from public,anon,authenticated;

-- ====================================================================================================
-- 20261031140000_smyl_radiograph_item_box.sql
-- ====================================================================================================
-- Cada señal de una revisión de radiografía puede traer el tamaño (w = ancho, h = alto, de 0.02 a 0.6 sobre la imagen)
-- del cuadro punteado que propone la IA alrededor de la zona observada. Los campos son opcionales y van juntos: las
-- revisiones anteriores, sin tamaño, siguen siendo válidas. Solo se aceptan en señales que ya tienen ubicación (x, y).
-- Es la misma validación de 20261031130000_smyl_radiograph_model_opus.sql con esa única ampliación.
--
-- Se aplica con el SQL Editor de Supabase. Es idempotente (create or replace).

create or replace function public.smyl_validate_radiograph_review(p_document jsonb,p_study jsonb)
returns void language plpgsql set search_path='' as $$
declare w jsonb; a jsonb; r jsonb; o jsonb; i jsonb; id_list text[]:=array[]::text[]; source_list text[]:=array[]::text[]; report_ids text[]:=array[]::text[];
begin
 if p_document is null or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>120000
 or p_document-array['schema','study','workflow','analysis','items']<>'{}'::jsonb
 or not(p_document ?& array['schema','study','workflow','analysis','items']) or p_document->'schema' is distinct from '1'::jsonb
 or jsonb_typeof(p_document->'study') is distinct from 'object' or (p_document->'study')-array['id','type','sha256']<>'{}'::jsonb
 or p_document->'study'->>'id' is distinct from p_study->>'id' or p_document->'study'->>'type' is distinct from p_study->>'type'
 or p_document->'study'->>'sha256' is distinct from p_study->'asset'->>'sha256'
 or jsonb_typeof(p_document->'items') is distinct from 'array' or jsonb_array_length(p_document->'items')>12
 then raise exception 'Invalid radiograph review' using errcode='22023'; end if;
 w:=p_document->'workflow';
 if jsonb_typeof(w) is distinct from 'object' or w-array['state','attempt']<>'{}'::jsonb or not(w ?& array['state','attempt'])
 or coalesce(w->>'state','') not in ('ready','requested','completed','unconfirmed')
 or jsonb_typeof(w->'attempt') is distinct from 'number' or coalesce(w->>'attempt','') !~ '^[01]$'
 then raise exception 'Invalid radiograph workflow' using errcode='22023'; end if;
 if (w->>'state'='ready' and ((w->>'attempt')::integer<>0 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 or (w->>'state' in ('requested','unconfirmed') and ((w->>'attempt')::integer<>1 or p_document->'analysis'<>'null'::jsonb or jsonb_array_length(p_document->'items')<>0))
 then raise exception 'Invalid radiograph workflow state' using errcode='22023'; end if;
 a:=p_document->'analysis';
 if w->>'state'='completed' then
  if (w->>'attempt')::integer<>1 or jsonb_typeof(a) is distinct from 'object' or a-array['model','at','requestId','report']<>'{}'::jsonb
  or not(a ?& array['model','at','requestId','report']) or a->>'model' not in ('claude-sonnet-4-6','claude-opus-5-5')
  or jsonb_typeof(a->'at') is distinct from 'string' or coalesce(a->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
  or jsonb_typeof(a->'requestId') is distinct from 'string' or (a->>'requestId'<>'' and a->>'requestId' !~ '^msg_[a-zA-Z0-9_-]{1,100}$')
  then raise exception 'Invalid radiograph analysis' using errcode='22023'; end if;
  perform (a->>'at')::timestamptz; r:=a->'report';
  if jsonb_typeof(r) is distinct from 'object' or r-array['schema','quality','qualityNote','observations','limitations']<>'{}'::jsonb
  or not(r ?& array['schema','quality','qualityNote','observations','limitations']) or r->'schema' is distinct from '1'::jsonb
  or coalesce(r->>'quality','') not in ('usable','limited','unusable') or jsonb_typeof(r->'qualityNote') is distinct from 'string' or length(trim(r->>'qualityNote')) not between 1 and 400
  or jsonb_typeof(r->'observations') is distinct from 'array' or jsonb_array_length(r->'observations')>12
  or jsonb_typeof(r->'limitations') is distinct from 'array' or jsonb_array_length(r->'limitations')>8
  then raise exception 'Invalid radiograph report' using errcode='22023'; end if;
  if r->>'quality'='unusable' and jsonb_array_length(r->'observations')<>0 then raise exception 'Unusable image cannot have observations' using errcode='22023'; end if;
  for o in select value from jsonb_array_elements(r->'observations') loop
   if jsonb_typeof(o) is distinct from 'object' or o-array['id','category','tooth','observation','evidence']<>'{}'::jsonb
   or not(o ?& array['id','category','tooth','observation','evidence']) or coalesce(o->>'id','') !~ '^r([1-9]|1[0-2])$' or o->>'id'=any(report_ids)
   or coalesce(o->>'category','') not in ('density','contour','restoration','support','development','other')
   or not(o->'tooth'='null'::jsonb or (jsonb_typeof(o->'tooth')='string' and o->>'tooth' ~ '^[1-4][1-8]$'))
   or jsonb_typeof(o->'observation') is distinct from 'string' or length(trim(o->>'observation')) not between 1 and 500
   or jsonb_typeof(o->'evidence') is distinct from 'string' or length(trim(o->>'evidence')) not between 1 and 300
   then raise exception 'Invalid radiograph observation' using errcode='22023'; end if;
   report_ids:=array_append(report_ids,o->>'id');
  end loop;
  for o in select value from jsonb_array_elements(r->'limitations') loop
   if jsonb_typeof(o) is distinct from 'string' or length(trim(o#>>'{}')) not between 1 and 300 then raise exception 'Invalid radiograph limitation' using errcode='22023'; end if;
  end loop;
 elsif a<>'null'::jsonb then raise exception 'Unexpected radiograph analysis' using errcode='22023';
 end if;
 for i in select value from jsonb_array_elements(p_document->'items') loop
  if jsonb_typeof(i) is distinct from 'object' or i-array['id','sourceId','tooth','text','x','y','state','w','h']<>'{}'::jsonb
  or not(i ?& array['id','sourceId','tooth','text','x','y','state'])
  or ((i ? 'w') is distinct from (i ? 'h'))
  or ((i ? 'w') and not (case when jsonb_typeof(i->'w')='number' and jsonb_typeof(i->'h')='number'
       then (i->>'w')::numeric between 0.02 and 0.6 and (i->>'h')::numeric between 0.02 and 0.6 and i->'x'<>'null'::jsonb else false end))
  or coalesce(i->>'id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or i->>'id'=any(id_list)
  or coalesce(i->>'sourceId','') !~ '^r([1-9]|1[0-2])$' or i->>'sourceId'=any(source_list) or not(i->>'sourceId'=any(report_ids))
  or jsonb_typeof(i->'tooth') is distinct from 'string' or (i->>'tooth'<>'' and i->>'tooth' !~ '^[1-4][1-8]$')
  or jsonb_typeof(i->'text') is distinct from 'string' or length(i->>'text')>600 or coalesce(i->>'state','') not in ('pending','confirmed','rejected')
  or not((i->'x'='null'::jsonb and i->'y'='null'::jsonb) or (jsonb_typeof(i->'x')='number' and jsonb_typeof(i->'y')='number' and (i->>'x')::numeric between 0 and 1 and (i->>'y')::numeric between 0 and 1))
  or (i->>'state'='confirmed' and (trim(i->>'text')='' or i->'x'='null'::jsonb))
  then raise exception 'Invalid reviewed radiograph item' using errcode='22023'; end if;
  id_list:=array_append(id_list,i->>'id');source_list:=array_append(source_list,i->>'sourceId');
 end loop;
 if cardinality(source_list)<>cardinality(report_ids) then raise exception 'Missing radiograph suggestion' using errcode='22023'; end if;
end;$$;

revoke all on function public.smyl_validate_radiograph_review(jsonb,jsonb) from public,anon,authenticated;

-- ====================================================================================================
-- 20261101120000_smyl_ai_usage_toothmap.sql
-- ====================================================================================================
-- El análisis de radiografía ahora son dos llamadas a la IA: primero un mapa de piezas y después la lectura. Las dos comparten
-- el mismo request_id. Esta migración permite registrar la primera (feature 'radiograph_toothmap') y hace que el resumen de
-- Plan y consumo cuente un análisis por request_id, sumando el costo, los tokens y el tiempo de las dos llamadas.
-- Los registros anteriores (una sola llamada por análisis) se siguen contando igual.
--
-- Se aplica con el SQL Editor de Supabase. Es idempotente.

alter table public.smyl_ai_usage_log drop constraint if exists smyl_ai_usage_log_feature_check;
alter table public.smyl_ai_usage_log add constraint smyl_ai_usage_log_feature_check
  check (feature in ('radiograph_analysis', 'radiograph_toothmap'));

create or replace function public.smyl_ai_usage_summary(
  p_feature text default 'radiograph_analysis',
  p_days integer default 30
)
returns table (
  analyses bigint,
  completed bigint,
  avg_input_tokens numeric,
  avg_output_tokens numeric,
  avg_seconds numeric,
  total_cost_usd numeric,
  avg_cost_usd numeric,
  max_cost_usd numeric,
  model text,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
begin
  if v_tenant is null or not public.smyl_has_permission(v_tenant, 'clinic.manage') then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver el consumo de IA.';
  end if;
  if p_feature is distinct from 'radiograph_analysis' then
    raise exception using errcode = '22023', message = 'Función de IA no válida.';
  end if;

  return query
  with g as (
    select coalesce(l.request_id, l.id::text) as k,
           bool_or(l.feature = 'radiograph_analysis' and l.outcome = 'ok') as done,
           bool_or(l.outcome <> 'error') as ran,
           sum(l.input_tokens) as in_tokens,
           sum(l.output_tokens) as out_tokens,
           sum(l.duration_ms) as ms,
           sum(l.estimated_cost_usd) as cost,
           (array_agg(l.model order by l.created_at desc))[1] as model_name,
           max(l.created_at) as at
    from public.smyl_ai_usage_log l
    where l.tenant_id = v_tenant and l.feature in ('radiograph_analysis', 'radiograph_toothmap')
      and l.created_at >= now() - make_interval(days => v_days)
    group by 1
  )
  select count(*)::bigint,
         count(*) filter (where g.done)::bigint,
         round(avg(g.in_tokens) filter (where g.ran), 0),
         round(avg(g.out_tokens) filter (where g.ran), 0),
         round(avg(g.ms) filter (where g.ran) / 1000.0, 1),
         round(coalesce(sum(g.cost), 0), 4),
         round(avg(g.cost) filter (where g.ran), 4),
         max(g.cost),
         (array_agg(g.model_name order by g.at desc))[1],
         max(g.at)
  from g;
end;
$$;

revoke all on function public.smyl_ai_usage_summary(text, integer) from public, anon;
grant execute on function public.smyl_ai_usage_summary(text, integer) to authenticated;

