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
