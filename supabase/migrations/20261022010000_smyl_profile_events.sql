-- SMYL · Métricas del perfil público profesional.
-- Registra vistas y clics de la ficha pública (dentista.html) sin datos
-- personales: visitor_key es un hash diario de IP+navegador que rota cada día.
-- Solo la Edge Function pública (service_role) inserta; el dentista o la
-- administración consultan vía smyl_profile_metrics.

begin;

create table if not exists public.smyl_profile_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.camila_tenants(id) on delete cascade,
  professional_id uuid not null,
  event_kind text not null check (event_kind in ('view','whatsapp_click','cta_click','share_click','request_sent')),
  visitor_key text not null default '' check (char_length(visitor_key) <= 64),
  referrer_host text not null default '' check (char_length(referrer_host) <= 120),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, professional_id)
    references public.smyl_professionals(tenant_id, id) on delete cascade
);

create index if not exists smyl_profile_events_lookup_idx
  on public.smyl_profile_events (tenant_id, professional_id, created_at desc);

alter table public.smyl_profile_events enable row level security;

drop policy if exists smyl_profile_events_read on public.smyl_profile_events;
create policy smyl_profile_events_read on public.smyl_profile_events
  for select to authenticated
  using (public.smyl_can_edit_professional_profile(tenant_id, professional_id));

revoke all on table public.smyl_profile_events from public, anon;
grant select on table public.smyl_profile_events to authenticated;

create or replace function public.smyl_profile_metrics(
  p_professional_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.smyl_current_tenant();
  v_days integer := greatest(1, least(365, coalesce(p_days, 30)));
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => v_days - 1);
  v_result jsonb;
begin
  if v_tenant is null or not public.smyl_can_edit_professional_profile(v_tenant, p_professional_id) then
    raise exception using errcode = '42501', message = 'No tienes permiso para ver las métricas de este perfil.';
  end if;

  select jsonb_build_object(
    'days', v_days,
    'since', v_since,
    'views', count(*) filter (where e.event_kind = 'view'),
    'unique_visitors', count(distinct e.visitor_key) filter (where e.event_kind = 'view' and e.visitor_key <> ''),
    'whatsapp_clicks', count(*) filter (where e.event_kind = 'whatsapp_click'),
    'cta_clicks', count(*) filter (where e.event_kind = 'cta_click'),
    'share_clicks', count(*) filter (where e.event_kind = 'share_click'),
    'requests', count(*) filter (where e.event_kind = 'request_sent'),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'views', d.views, 'requests', d.requests) order by d.day)
      from (
        select (x.created_at at time zone 'America/Mexico_City')::date as day,
               count(*) filter (where x.event_kind = 'view') as views,
               count(*) filter (where x.event_kind = 'request_sent') as requests
        from public.smyl_profile_events x
        where x.tenant_id = v_tenant and x.professional_id = p_professional_id and x.created_at >= v_since
        group by 1
      ) d
    ), '[]'::jsonb),
    'top_referrers', coalesce((
      select jsonb_agg(jsonb_build_object('host', r.host, 'views', r.views) order by r.views desc)
      from (
        select x.referrer_host as host, count(*) as views
        from public.smyl_profile_events x
        where x.tenant_id = v_tenant and x.professional_id = p_professional_id
          and x.created_at >= v_since and x.event_kind = 'view' and x.referrer_host <> ''
        group by 1 order by 2 desc limit 5
      ) r
    ), '[]'::jsonb)
  )
  into v_result
  from public.smyl_profile_events e
  where e.tenant_id = v_tenant and e.professional_id = p_professional_id and e.created_at >= v_since;

  return v_result;
end;
$$;

revoke all on function public.smyl_profile_metrics(uuid, integer) from public, anon;
grant execute on function public.smyl_profile_metrics(uuid, integer) to authenticated;

comment on table public.smyl_profile_events is
  'Eventos anónimos de la ficha pública profesional (vistas y clics). Sin datos personales; visitor_key rota a diario.';

commit;
