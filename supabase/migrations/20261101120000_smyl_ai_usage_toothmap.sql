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
