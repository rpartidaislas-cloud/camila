-- Auditoría del panel admin (2026-11-06): los errores de JavaScript del panel sólo se mostraban con alert() al usuario y se
-- perdían: nadie del equipo sabía que algo fallaba en una clínica. Esta migración crea un registro mínimo y seguro:
--   * smyl_client_errors: mensaje, origen, línea, pila recortada, ruta y versión. Nunca datos de pacientes ni de formularios.
--   * smyl_report_client_error(): único camino de escritura (el navegador no inserta directo). La clínica y el usuario salen de
--     la sesión, no del navegador; hay un tope de 30 reportes/hora por usuario y todo se recorta.
--   * Sin lectura para clínicas ni usuarios: sólo el equipo de SMYL (service role / SQL Editor).
--   * smyl_purge_client_errors(): borra reportes de más de 90 días (se programa con pg_cron si está habilitado).
-- Idempotente.

create table if not exists public.smyl_client_errors (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.camila_tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('error', 'promise')),
  message text not null check (char_length(message) <= 500),
  source text check (source is null or char_length(source) <= 300),
  line integer,
  stack text check (stack is null or char_length(stack) <= 2000),
  route text check (route is null or char_length(route) <= 80),
  app_version text check (app_version is null or char_length(app_version) <= 80),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists smyl_client_errors_created_idx on public.smyl_client_errors (created_at desc);
create index if not exists smyl_client_errors_user_created_idx on public.smyl_client_errors (user_id, created_at desc);

alter table public.smyl_client_errors enable row level security;
revoke all on public.smyl_client_errors from public, anon, authenticated;
-- Sin políticas: nadie con sesión de clínica puede leer ni escribir directo.

create or replace function public.smyl_report_client_error(
  p_kind text,
  p_message text,
  p_source text default null,
  p_line integer default null,
  p_stack text default null,
  p_route text default null,
  p_app_version text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
begin
  if v_user is null then return; end if;
  if p_kind not in ('error', 'promise') then return; end if;
  if coalesce(btrim(p_message), '') = '' then return; end if;
  if (select count(*) from public.smyl_client_errors e where e.user_id = v_user and e.created_at > now() - interval '1 hour') >= 30 then
    return;
  end if;
  begin
    v_tenant := public.smyl_current_tenant();
  exception when others then
    v_tenant := null;
  end;
  insert into public.smyl_client_errors (tenant_id, user_id, kind, message, source, line, stack, route, app_version, user_agent)
  values (v_tenant, v_user, p_kind, left(p_message, 500), left(p_source, 300), p_line, left(p_stack, 2000), left(p_route, 80), left(p_app_version, 80), left(p_user_agent, 300));
end;
$function$;

revoke all on function public.smyl_report_client_error(text, text, text, integer, text, text, text, text) from public, anon;
grant execute on function public.smyl_report_client_error(text, text, text, integer, text, text, text, text) to authenticated;

create or replace function public.smyl_purge_client_errors(p_batch integer default 5000)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare v_rows integer;
begin
  delete from public.smyl_client_errors
   where id in (select id from public.smyl_client_errors where created_at < now() - interval '90 days' order by id limit greatest(1, least(coalesce(p_batch, 5000), 50000)));
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

revoke all on function public.smyl_purge_client_errors(integer) from public, anon, authenticated;
grant execute on function public.smyl_purge_client_errors(integer) to service_role;

do $$
declare v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron no está habilitado: la purga de errores del cliente NO quedó programada. Activa la extensión y vuelve a aplicar esta migración.';
    return;
  end if;
  for v_job in select jobid from cron.job where jobname = 'smyl-purgar-errores-cliente' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule('smyl-purgar-errores-cliente', '53 3 * * *', $job$select public.smyl_purge_client_errors(5000)$job$);
end;
$$;
